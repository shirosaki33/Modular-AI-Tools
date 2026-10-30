/* ================================================================
   GALLERY CORE
   PNG metadata extraction dispatcher, JSON sidecar save/batch update,
   directory loading & sorting & pagination, image open/close, and
   image zoom & pan. Loaded together with gallery_ui.js — see that
   file's header for why the split exists.
   ================================================================ */

/* ================================================================
   BLOCK 4 — PNG METADATA EXTRACTION  (dispatcher only)
   ================================================================ */

function extractTextFromBytes(buf) {
    // latin1 = 1 byte -> 1 char (igual ao loop antigo, mas sem concatenar byte a byte).
    const raw = new TextDecoder('latin1').decode(new Uint8Array(buf));
    const candidates = [];
    const jsonRe = /\{[\s\S]{10,}/g;
    let m;
    while ((m = jsonRe.exec(raw)) !== null) {
        const start = m.index;
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < raw.length && i < start + 2000000; i++) {
            const c = raw[i];
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) {
                    const candidate = raw.slice(start, i + 1);
                    if (candidate.includes('class_type') || candidate.includes('sui_image_params') ||
                        candidate.includes('v4_prompt') || candidate.includes('invokeai_metadata') ||
                        candidate.includes('base_model')) {
                        candidates.push(candidate);
                    }
                    break;
                }
            }
        }
        if (candidates.length) break;
    }

    const sdIdx = raw.indexOf('Steps:');
    if (sdIdx !== -1) {
        const win = raw.slice(Math.max(0, sdIdx - 5000), sdIdx + 2000).replace(/\0/g, '');
        candidates.push(win);
    }

    return candidates;
}

/* Each parser is optional and isolated: a missing script or a parser that
   throws on an odd file never stops the next one from trying. */
function _galleryTryParse(name, ...args) {
    const fn = window[name];
    if (typeof fn !== 'function') return null;
    try { return fn(...args) || null; }
    catch (e) { console.warn('[Gallery] ' + name + ' failed:', e); return null; }
}

const _isComfyGraph = j => !!(j && typeof j === 'object' && Object.values(j).some(n => n && n.class_type));

function _galleryParseText(text, json) {
    return _galleryTryParse('parseSwarmUI', text, json)
        || _galleryTryParse('parseInvokeAI', text, json)
        || _galleryTryParse('parseFooocus', text, json)
        || _galleryTryParse('parseNovelAI', text, json)
        || _galleryTryParse('parseStableDiffusion', text);
}

async function extractPNGMetadata(file) {
    const isPng = file.name.match(/\.png$/i);
    if (isPng) {
        if (typeof window.lerChunksPNG !== 'function') return null;
        const chunks = await window.lerChunksPNG(file);
        if (chunks.has('prompt')) {
            const promptStr = chunks.get('prompt');
            const parsed = _galleryTryParse('parseComfyNovelAI', promptStr) || _galleryTryParse('parseComfyJSON', promptStr);
            if (parsed) return parsed;
        }

        let textChunk = chunks.get('parameters') ?? '';
        if (!textChunk) {
            for (const [k, v] of chunks.entries()) {
                if (k === 'prompt' || k === 'workflow') continue;
                if (v.includes('Steps:')          ||
                    v.includes('"v4_prompt"')     ||
                    v.includes('invokeai_metadata') ||
                    v.includes('base_model')      ||
                    v.includes('sui_image_params') ||
                    (k === 'Comment' && v.includes('"uc"'))   // NovelAI V3 and older
                ) {
                    textChunk = v;
                    break;
                }
            }
        }

        if (textChunk) {
            let textChunkJson = null;
            try { textChunkJson = JSON.parse(textChunk); } catch {}
            const parsed = _galleryParseText(textChunk, textChunkJson);
            if (parsed) return parsed;
        }

        for (const [k, v] of chunks.entries()) {
            if (k === 'prompt' || k === 'workflow') continue;
            let j = null;
            try { j = JSON.parse(v); } catch {}
            if (_isComfyGraph(j)) {
                const parsed = _galleryTryParse('parseComfyJSON', v);
                if (parsed) return parsed;
            }
        }

        return null;
    }

    if (file.name.match(/\.(jpg|jpeg|webp)$/i)) {
        try {
            const buf = await file.arrayBuffer();
            const candidates = extractTextFromBytes(buf);
            for (const candidate of candidates) {
                let jsonObj = null;
                try { jsonObj = JSON.parse(candidate); } catch {}
                if (_isComfyGraph(jsonObj)) {
                    const parsed = _galleryTryParse('parseComfyNovelAI', jsonObj) || _galleryTryParse('parseComfyJSON', candidate);
                    if (parsed) return parsed;
                }
                const parsed = _galleryParseText(candidate, jsonObj);
                if (parsed) return parsed;
            }
        } catch (e) { console.warn('Non-PNG parser error:', e); }
    }

    return null;
}

/* ================================================================
   BLOCK 5 — JSON SIDECAR (save & batch update)
   ================================================================ */
async function saveSidecarFile() {
    if (!currentHandle) { alert('No directory loaded.'); return; }
    const fname = document.getElementById('file-name').value;
    if (!fname) { alert('No image selected.'); return; }

    const baseName = fname.substring(0, fname.lastIndexOf('.')) || fname;
    const sidecarName = baseName + '.json';
    // The per-image tag field was removed — tagging is now handled entirely by
    // the 🏷️ Tag button (Add/Remove). A regular "Save JSON" just keeps whatever
    // tag is already on record for this file instead of overwriting it.
    const savedTag = (typeof tagsPerFile !== 'undefined' && tagsPerFile.has(fname)) ? tagsPerFile.get(fname) : '';
    
    const lorasArray = Array.from(document.querySelectorAll('.lora-input')).map(inp => inp.value.trim()).filter(v => v !== '');
    const formattedLoras = lorasArray.join(', ');

    const notesArray = Array.from(document.querySelectorAll('.note-block')).map(block => {
        return {
            name: block.querySelector('.note-title-input').value,
            value: block.querySelector('.val-note-input').value
        };
    }).filter(n => n.value.trim() !== '');
    
    const dataObj = {
        file_name:  fname,
        positive:   document.getElementById('val-pos').value,
        negative:   document.getElementById('val-neg').value,
        tag:        savedTag,
        notes:      notesArray, 
        cfg:        document.getElementById('val-cfg').value,
        steps:      document.getElementById('val-steps').value,
        seed:       document.getElementById('val-seed').value,
        sampler:    document.getElementById('val-sampler').value,
        checkpoint: document.getElementById('val-ckpt').value,
        loras:      formattedLoras,
        size:       document.getElementById('val-size').value
    };
    
    try {
        const fh = await currentHandle.getFileHandle(sidecarName, { create: true });
        const writable = await fh.createWritable(); await writable.write(JSON.stringify(dataObj, null, 2)); await writable.close();
        
        currentJsonFiles.add(sidecarName);
        
        const btnSave = document.getElementById('btn-save');
        btnSave.textContent = 'Update JSON';
        btnSave.style.background = '#0d2a18';
        btnSave.style.borderColor = '#00aa66';
        btnSave.style.color = '#00ff99';
        
        updateGridCounters();
        
        showAlert(`✅ JSON File saved: ${sidecarName}`, 'success');
        if (typeof tagsPerFile !== 'undefined') {
            tagsPerFile.set(fname, savedTag);
            if (savedTag) allTags.add(savedTag);
            updateTagsDatalist();
        }
    } catch (e) { console.error(e); showAlert('❌ Error saving. Check directory permissions.', 'error'); }
}

/* Botão "Batch Update JSONs": o HTML chamava batchUpdateJSONs(), mas a função
   não existia em nenhum arquivo (o clique dava erro no console).
   Cria o JSON das imagens que não têm e, nas que têm, só PREENCHE campos
   vazios com os metadados da imagem — nunca apaga tag, notas ou o que o
   usuário editou. JSON inválido é deixado como está. */
async function batchUpdateJSONs() {
    if (!currentHandle) { showAlert('Load a folder first.', 'warn'); return; }
    if (!currentFiles.length) { showAlert('❌ No images in this folder.', 'warn'); return; }
    if (!confirm(`Create or update the JSON sidecar of ${currentFiles.length} image(s) in this folder?\n\nMissing JSONs are created from the image metadata. Existing JSONs only get their EMPTY fields filled — tags, notes and edited values are kept.`)) return;

    const FIELD_MAP = { positive: 'pos', negative: 'neg', cfg: 'cfg', steps: 'steps', seed: 'seed', sampler: 'sampler', checkpoint: 'ckpt', loras: 'loras', size: 'size' };
    let created = 0, updated = 0, unchanged = 0, invalid = 0, noMeta = 0;

    for (let i = 0; i < currentFiles.length; i++) {
        const fileItem = currentFiles[i];
        if (i % 10 === 0) showAlert(`Processing batch... ${i + 1} / ${currentFiles.length}`, 'info');
        const baseName = fileItem.name.substring(0, fileItem.name.lastIndexOf('.')) || fileItem.name;
        const sidecarName = baseName + '.json';

        const sc = (typeof readSidecarSafe === 'function') ? await readSidecarSafe(currentHandle, sidecarName) : { exists: false, ok: true, data: {} };
        if (!sc.ok) { invalid++; continue; }

        let meta = null;
        try { meta = await extractPNGMetadata(fileItem.file); } catch (e) {}
        if (meta && !meta.sampler && meta.scheduler) meta.sampler = meta.scheduler;
        if (meta && !meta.ckpt && meta.checkpoint) meta.ckpt = meta.checkpoint;

        const data = sc.data;
        let changed = !sc.exists;
        if (!sc.exists) {
            Object.assign(data, { file_name: fileItem.name, positive: '', negative: '', tag: '', notes: [], cfg: '', steps: '', seed: '', sampler: '', checkpoint: '', loras: '', size: '' });
        }
        if (data.file_name !== fileItem.name) { data.file_name = fileItem.name; changed = true; }
        if (meta) {
            Object.entries(FIELD_MAP).forEach(([jsonKey, metaKey]) => {
                const cur = data[jsonKey];
                const val = meta[metaKey];
                if ((cur === undefined || cur === null || String(cur).trim() === '') && val !== undefined && val !== null && String(val).trim() !== '') {
                    data[jsonKey] = String(val); changed = true;
                }
            });
            if ((!Array.isArray(data.notes) || data.notes.length === 0) && Array.isArray(meta.notes) && meta.notes.length) { data.notes = meta.notes; changed = true; }
        } else if (!sc.exists) {
            noMeta++;
        }

        if (!changed) { unchanged++; continue; }
        try {
            if (typeof writeSidecar === 'function') await writeSidecar(currentHandle, sidecarName, data);
            else {
                const fh = await currentHandle.getFileHandle(sidecarName, { create: true });
                const w = await fh.createWritable(); await w.write(JSON.stringify(data, null, 2)); await w.close();
                currentJsonFiles.add(sidecarName);
            }
            if (sc.exists) updated++; else created++;
        } catch (e) { console.error('Batch JSON failed for', sidecarName, e); }
    }

    updateGridCounters();
    const parts = [`${created} created`, `${updated} updated`, `${unchanged} already complete`];
    if (noMeta) parts.push(`${noMeta} without image metadata (empty JSON created)`);
    if (invalid) parts.push(`${invalid} invalid JSON(s) left untouched`);
    showAlert(`✅ Batch JSON: ${parts.join(' · ')}.`, invalid ? 'warn' : 'success');
}

/* ================================================================
   BLOCK 6 — DIRECTORY LOGIC & SORTING & GRID MODE (RECURSIVE CASCADING)
   ================================================================ */
const dbName    = 'GalleryDB';
const storeName = 'directories';

// LEVEL CONTROL VARIABLES
let rootHandle    = null; 
let currentHandle = null; 
let sub1Handles   = new Map(); 
let sub2Handles   = new Map(); 

let currentFiles  = [];
let currentJsonFiles = new Set(); // Stores the JSON files read in the directory
let sortMode = 1; // 0 = Normal, 1 = A-Z, 2 = Z-A (defaults to alphabetical)
let currentPage = 1;
const PAGE_SIZE_OPTIONS = [25, 50, 75, 100];
let itemsPerPage = 50;

function initDB() { return new Promise((res, rej) => { const req = indexedDB.open(dbName, 1); req.onupgradeneeded = e => e.target.result.createObjectStore(storeName); req.onsuccess = e => res(e.target.result); req.onerror   = e => rej(e.target.error); }); }
async function saveHandle(n, h) { const db = await initDB(); return new Promise(r => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(h, n); tx.oncomplete = r; }); }
async function getHandles() { const db = await initDB(); return new Promise(r => { const tx = db.transaction(storeName, 'readonly'); const store = tx.objectStore(storeName); const keysReq = store.getAllKeys(); const valsReq = store.getAll(); tx.oncomplete = () => { const result = []; for (let i = 0; i < keysReq.result.length; i++) { const name = keysReq.result[i]; if (!String(name).startsWith('path_') && !String(name).startsWith('autorename_') && !String(name).startsWith('galleryview_') && !String(name).startsWith('hiddentags_') && !String(name).startsWith('viewcounts_') && !String(name).startsWith('mergegroups_') && name !== SETTINGS_KEY) result.push({ name, handle: valsReq.result[i] }); } r(result); }; }); }
async function deleteHandle(n) { const db = await initDB(); return new Promise(r => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).delete(n); tx.objectStore(storeName).delete('path_' + n); tx.objectStore(storeName).delete('autorename_' + n); tx.objectStore(storeName).delete('galleryview_' + n); tx.objectStore(storeName).delete('hiddentags_' + n); tx.objectStore(storeName).delete('viewcounts_' + n); tx.objectStore(storeName).delete('mergegroups_' + n); tx.oncomplete = r; }); }

/* ---------------------------------------------------------------
   PERSISTED APP SETTINGS (⚙️ menu checkboxes, sorting and grid size)
   Stored in the same IndexedDB, under a reserved key that doesn't
   show up in the directory list (excluded from getHandles above).
   --------------------------------------------------------------- */
const SETTINGS_KEY = '__app_settings__';

async function saveSettingsToDB() {
    try {
        const settings = {
            extraFields:    document.getElementById('toggle-extra-fields').checked,
            filenameField:  document.getElementById('toggle-filename-field').checked,
            pathField:      document.getElementById('toggle-path-field').checked,
            pathIcon:       document.getElementById('toggle-path-icon').checked,
            countField:     document.getElementById('toggle-count-field').checked,
            jsonCountField: document.getElementById('toggle-json-count-field').checked,
            randomButtonEnabled: document.getElementById('toggle-random-button').checked,
            sortMode:       sortMode,
            itemsPerPage:   itemsPerPage,
            blockCollapse:  blockCollapsePrefs,
            gridThumbSize:  gridThumbSize,
            viewCountEnabled: viewCountEnabled,
            viewCountPaused:  viewCountPaused,
            viewCountWeeklyResetDay:   viewCountWeeklyResetDay,
            viewCountMonthlyMode:      viewCountMonthlyMode,
            viewCountMonthlyCustomDay: viewCountMonthlyCustomDay
        };
        const db = await initDB();
        await new Promise(r => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(settings, SETTINGS_KEY);
            tx.oncomplete = r;
        });
    } catch (e) { console.error('Error saving settings:', e); }
}

async function loadSettingsFromDB() {
    try {
        const db = await initDB();
        const settings = await new Promise(r => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(SETTINGS_KEY);
            req.onsuccess = () => r(req.result);
            req.onerror = () => r(null);
        });
        if (!settings) return;

        document.getElementById('toggle-extra-fields').checked    = !!settings.extraFields;
        document.getElementById('toggle-filename-field').checked  = settings.filenameField  !== undefined ? !!settings.filenameField  : true;
        document.getElementById('toggle-path-field').checked      = settings.pathField      !== undefined ? !!settings.pathField      : true;
        document.getElementById('toggle-path-icon').checked       = !!settings.pathIcon;
        document.getElementById('toggle-count-field').checked     = settings.countField     !== undefined ? !!settings.countField     : true;
        document.getElementById('toggle-json-count-field').checked = !!settings.jsonCountField;
        document.getElementById('toggle-random-button').checked = settings.randomButtonEnabled !== undefined ? !!settings.randomButtonEnabled : true;

        if (settings.sortMode === 0 || settings.sortMode === 1 || settings.sortMode === 2) {
            sortMode = settings.sortMode;
            const btnSort = document.getElementById('btn-sort');
            if (btnSort) {
                if (sortMode === 0) btnSort.innerHTML = '🔀 Normal';
                else if (sortMode === 1) btnSort.innerHTML = '⬇️ A-Z';
                else if (sortMode === 2) btnSort.innerHTML = '⬆️ Z-A';
            }
        }
        if (PAGE_SIZE_OPTIONS.includes(settings.itemsPerPage)) {
            itemsPerPage = settings.itemsPerPage;
            const btnPageSize = document.getElementById('btn-page-size');
            if (btnPageSize) btnPageSize.textContent = itemsPerPage + ' grid';
        }
        if (settings.blockCollapse && typeof settings.blockCollapse === 'object') {
            blockCollapsePrefs = settings.blockCollapse;
        }
        if (typeof settings.gridThumbSize === 'number' && settings.gridThumbSize >= 100 && settings.gridThumbSize <= 400) {
            gridThumbSize = settings.gridThumbSize;
            const slider = document.getElementById('grid-thumb-slider');
            if (slider) slider.value = gridThumbSize;
            updateGridThumbSize(gridThumbSize, true);
        }

        if (typeof viewCountEnabled !== 'undefined') {
            viewCountEnabled = settings.viewCountEnabled !== undefined ? !!settings.viewCountEnabled : true;
            viewCountPaused  = !!settings.viewCountPaused;
            viewCountWeeklyResetDay   = (typeof settings.viewCountWeeklyResetDay === 'number') ? settings.viewCountWeeklyResetDay : 0;
            viewCountMonthlyMode      = settings.viewCountMonthlyMode || 'endofmonth';
            viewCountMonthlyCustomDay = (typeof settings.viewCountMonthlyCustomDay === 'number') ? settings.viewCountMonthlyCustomDay : 1;

            const enabledCheckbox = document.getElementById('toggle-viewcount-enabled');
            if (enabledCheckbox) enabledCheckbox.checked = viewCountEnabled;
            const weeklySel = document.getElementById('viewcount-weekly-day');
            if (weeklySel) weeklySel.value = String(viewCountWeeklyResetDay);
            const monthlySel = document.getElementById('viewcount-monthly-mode');
            if (monthlySel) monthlySel.value = viewCountMonthlyMode;
            const customDayInput = document.getElementById('viewcount-monthly-customday');
            if (customDayInput) customDayInput.value = viewCountMonthlyCustomDay;

            if (typeof updateViewCountPauseButtonUI === 'function') updateViewCountPauseButtonUI();
            if (typeof updateViewCountButtonsVisibility === 'function') updateViewCountButtonsVisibility();
            if (typeof updateViewCountSettingsUI === 'function') updateViewCountSettingsUI();
        }
    } catch (e) { console.error('Error loading settings:', e); }
}

window.onload = async () => {
    try {
        await updateSelect();
        const handles = await getHandles();
        if (handles.length > 0) {
            const h = handles[0].handle;
            if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') {
                document.getElementById('dir-list').value = handles[0].name;
                loadGallery(h);
            }
        }
    } catch (e) {}
};

async function updateSelect() {
    const list = document.getElementById('dir-list'); list.innerHTML = '<option value="">Select a directory...</option>';
    const handles = await getHandles(); handles.forEach(h => { const opt = document.createElement('option'); opt.value = h.name; opt.textContent = h.name; list.appendChild(opt); });
}

async function addDirectory() { 
    try { 
        const dh = await window.showDirectoryPicker({ mode: 'readwrite' }); 
        await saveHandle(dh.name, dh); 
        await updateSelect(); 
        document.getElementById('dir-list').value = dh.name; 
        loadGallery(dh); 
    } catch (e) { if (e.name !== 'AbortError') alert('Permission error.'); } 
}

async function removeDirectory() { 
    if (!rootHandle) return; 
    await deleteHandle(rootHandle.name); 
    
    rootHandle = null; 
    currentHandle = null; 
    currentJsonFiles.clear();

    if (typeof activeGalleryTag !== 'undefined') activeGalleryTag = null;
    if (typeof hiddenGalleryTags !== 'undefined') hiddenGalleryTags.clear();
    if (typeof galleryViewMode !== 'undefined') galleryViewMode = 'solto';
    if (typeof updateViewModeButtonUI === 'function') updateViewModeButtonUI();
    if (typeof renderGallerySidebar === 'function') renderGallerySidebar();
    if (typeof viewCountsData !== 'undefined') viewCountsData = { weekKey: '', counts: {} };
    if (typeof updateViewCountButtonsVisibility === 'function') updateViewCountButtonsVisibility();

    if (typeof mergeGroups !== 'undefined') mergeGroups.clear();
    if (typeof memberToPrimary !== 'undefined') memberToPrimary.clear();
    if (typeof groupActiveIndex !== 'undefined') groupActiveIndex.clear();
    if (typeof isMergeMode !== 'undefined') isMergeMode = false;
    document.getElementById('merge-dropdown')?.classList.remove('open');

    document.getElementById('btn-remove').style.display = 'none'; 
    document.getElementById('btn-path-label').style.display = 'none'; 
    document.getElementById('path-display').textContent = '';
    document.getElementById('btn-autorename').style.display = 'none';
    document.getElementById('autorename-dropdown').classList.remove('open');
    document.getElementById('btn-batch-json').style.display = 'none'; 
    document.getElementById('btn-batch-tag').style.display = 'none'; 
    document.getElementById('btn-merge').style.display = 'none';
    document.getElementById('btn-rename-top').style.display = 'none'; 
    document.getElementById('filter-tag').style.display = 'none'; 
    document.getElementById('btn-refresh').style.display = 'none'; 
    document.getElementById('sub-dir-1').style.display = 'none';
    document.getElementById('sub-dir-2').style.display = 'none';
    
    document.getElementById('grid-view').innerHTML = ''; 
    updateGridCounters();
    backToGrid(); 
    await updateSelect(); 
}

async function loadSelectedDirectory() {
    const name = document.getElementById('dir-list').value; if (!name) return; const handles = await getHandles();
    const h = handles.find(x => x.name === name)?.handle;
    if (h) { 
        if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') await h.requestPermission({ mode: 'readwrite' }); 
        loadGallery(h); 
    }
}

/* Opções de subpasta: nomes de pasta entram como texto (não HTML) e sem
   innerHTML += em loop (que reconstruía o <select> inteiro a cada nome). */
function _fillFolderOptions(sel, names) {
    const frag = document.createDocumentFragment();
    names.sort((a, b) => a.localeCompare(b)).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        frag.appendChild(opt);
    });
    sel.appendChild(frag);
}
function _setHeaderOption(sel, text) {
    sel.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = text;
    sel.appendChild(opt);
}

/* As URLs de miniatura (createObjectURL) da pasta anterior nunca eram
   liberadas — a cada troca de pasta a memória só crescia. */
function _resetCurrentFiles() {
    // Miniaturas leves (tools/thumb_loader.js) da pasta anterior também saem da RAM.
    if (window.ThumbLoader) window.ThumbLoader.clear();
    const main = document.getElementById('main-image');
    if (main) main.removeAttribute('src');
    currentFiles.forEach(f => { try { URL.revokeObjectURL(f.url); } catch (e) {} });
    currentFiles = [];
    const strip = document.getElementById('thumbnail-strip');
    if (strip) strip.innerHTML = '';
}

// --- LOAD LEVEL 1 (ROOT) ---
async function loadGallery(dirHandle) {
    currentPage = 1;
    rootHandle = dirHandle; 
    currentHandle = dirHandle; 
    _resetCurrentFiles();
    currentJsonFiles.clear();
    
    document.getElementById('btn-remove').style.display = 'inline-block';
    if (document.getElementById('toggle-path-icon').checked) {
        document.getElementById('btn-path-label').style.display = 'inline-block';
    }
    if (typeof loadSavedPathDisplay === 'function') loadSavedPathDisplay(dirHandle);
    document.getElementById('btn-autorename').style.display = 'inline-block';
    document.getElementById('btn-batch-json').style.display = 'inline-block';
    document.getElementById('btn-batch-tag').style.display = 'inline-block';
    document.getElementById('btn-merge').style.display = 'inline-block';
    document.getElementById('btn-rename-top').style.display = 'inline-block';
    document.getElementById('btn-refresh').style.display = 'inline-block';
    document.getElementById('filter-tag').style.display = 'inline-block'; 
    document.getElementById('filter-tag').value = ''; 
    
    const sel1 = document.getElementById('sub-dir-1');
    const sel2 = document.getElementById('sub-dir-2');
    sel1.style.display = 'none';
    sel2.style.display = 'none';
    sub1Handles.clear();
    
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
            if (entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
                const file = await entry.getFile();
                const url  = URL.createObjectURL(file);
                currentFiles.push({ name: entry.name, url, file });
            } else if (entry.name.match(/\.json$/i)) {
                currentJsonFiles.add(entry.name);
            }
        } else if (entry.kind === 'directory') {
            sub1Handles.set(entry.name, entry);
        }
    }
    
    if (sub1Handles.size > 0) {
        sel1.style.display = 'inline-block';
        _setHeaderOption(sel1, '-- Root --');
        _fillFolderOptions(sel1, Array.from(sub1Handles.keys()));
    }

    // Índices da pasta ANTES do auto-rename: assim o rename atualiza tags, grupos e
    // contagens desta pasta (antes atualizava os da pasta anterior, ainda em memória).
    if (typeof loadTagsIndex === 'function') await loadTagsIndex(currentHandle);
    if (typeof loadMergeGroupsIndex === 'function') await loadMergeGroupsIndex(currentHandle);
    if (typeof loadViewCountsIndex === 'function') await loadViewCountsIndex(currentHandle);
    if (typeof autoRenameNewFiles === 'function') await autoRenameNewFiles(currentHandle);
    if (typeof updateViewCountButtonsVisibility === 'function') updateViewCountButtonsVisibility();
    renderGrid(); backToGrid();
}

// --- LOAD LEVEL 2 (IMMEDIATE SUBFOLDERS) ---
window.loadSubDir1 = async function() {
    currentPage = 1;
    const val = document.getElementById('sub-dir-1').value;
    const sel2 = document.getElementById('sub-dir-2');

    if (!val) {
        await loadGallery(rootHandle);
        return;
    }

    currentHandle = sub1Handles.get(val);
    sub2Handles.clear();
    sel2.style.display = 'none';
    _setHeaderOption(sel2, `-- [ ${val} ] --`);

    showAlert('Reading subfolders... please wait.', 'info');
    _resetCurrentFiles();
    currentJsonFiles.clear();
    
    await scanFlattened(currentHandle, "", true, 0);

    if (sub2Handles.size > 0) {
        sel2.style.display = 'inline-block';
        _fillFolderOptions(sel2, Array.from(sub2Handles.keys()));
    }

    // Índices da pasta ANTES do auto-rename: assim o rename atualiza tags, grupos e
    // contagens desta pasta (antes atualizava os da pasta anterior, ainda em memória).
    if (typeof loadTagsIndex === 'function') await loadTagsIndex(currentHandle);
    if (typeof loadMergeGroupsIndex === 'function') await loadMergeGroupsIndex(currentHandle);
    if (typeof loadViewCountsIndex === 'function') await loadViewCountsIndex(currentHandle);
    if (typeof autoRenameNewFiles === 'function') await autoRenameNewFiles(currentHandle);
    if (typeof updateViewCountButtonsVisibility === 'function') updateViewCountButtonsVisibility();
    renderGrid(); backToGrid();
    showAlert(null); 
};

// --- LOAD LEVEL 3 (RECURSION INTO THE SELECTED FOLDER) ---
window.loadSubDir2 = async function() {
    currentPage = 1;
    const val = document.getElementById('sub-dir-2').value;

    if (!val) {
        const val1 = document.getElementById('sub-dir-1').value;
        if (!val1) { await loadGallery(rootHandle); return; }
        currentHandle = sub1Handles.get(val1);
    } else {
        currentHandle = sub2Handles.get(val);
    }
    if (!currentHandle) { await loadGallery(rootHandle); return; }

    showAlert('Loading images...', 'info');
    _resetCurrentFiles();
    currentJsonFiles.clear();
    
    for await (const entry of currentHandle.values()) {
        if (entry.kind === 'file') {
            if (entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
                const file = await entry.getFile();
                const url  = URL.createObjectURL(file);
                currentFiles.push({ name: entry.name, url, file });
            } else if (entry.name.match(/\.json$/i)) {
                currentJsonFiles.add(entry.name);
            }
        }
    }

    // Índices da pasta ANTES do auto-rename: assim o rename atualiza tags, grupos e
    // contagens desta pasta (antes atualizava os da pasta anterior, ainda em memória).
    if (typeof loadTagsIndex === 'function') await loadTagsIndex(currentHandle);
    if (typeof loadMergeGroupsIndex === 'function') await loadMergeGroupsIndex(currentHandle);
    if (typeof loadViewCountsIndex === 'function') await loadViewCountsIndex(currentHandle);
    if (typeof autoRenameNewFiles === 'function') await autoRenameNewFiles(currentHandle);
    if (typeof updateViewCountButtonsVisibility === 'function') updateViewCountButtonsVisibility();
    renderGrid(); backToGrid();
    showAlert(null);
};

window.refreshCurrentFolder = async function() {
    const val2 = document.getElementById('sub-dir-2').value;
    const val1 = document.getElementById('sub-dir-1').value;

    if (val2 && document.getElementById('sub-dir-2').style.display !== 'none') { 
        await loadSubDir2(); 
    } else if (val1 && document.getElementById('sub-dir-1').style.display !== 'none') { 
        await loadSubDir1(); 
    } else { 
        await loadSelectedDirectory(); 
    }
};

async function scanFlattened(dirHandle, pathPrefix, isFirstLevel, depth = 0) {
    if (depth > 10) return; 
    
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
            const fullPath = pathPrefix ? pathPrefix + '/' + entry.name : entry.name;
            sub2Handles.set(fullPath, entry);
            await scanFlattened(entry, fullPath, false, depth + 1);
            
        } else if (isFirstLevel && entry.kind === 'file') {
            if (entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
                const file = await entry.getFile();
                const url  = URL.createObjectURL(file);
                currentFiles.push({ name: entry.name, url, file });
            } else if (entry.name.match(/\.json$/i)) {
                currentJsonFiles.add(entry.name);
            }
        }
    }
}

function toggleSort() {
    sortMode = (sortMode + 1) % 3; const btn = document.getElementById('btn-sort');
    if (sortMode === 0) btn.innerHTML = '🔀 Normal'; else if (sortMode === 1) btn.innerHTML = '⬇️ A-Z';
    else if (sortMode === 2) btn.innerHTML = '⬆️ Z-A';
    renderGrid();
    saveSettingsToDB();
}

function renderGrid() {
    const grid = document.getElementById('grid-view');
    grid.innerHTML = '';
    
    let arrRender = [...currentFiles];
    if (sortMode === 1) arrRender.sort((a,b) => a.name.localeCompare(b.name));
    else if (sortMode === 2) arrRender.sort((a,b) => b.name.localeCompare(a.name));

    // --- TAGS VIEW: filters by the tag/gallery currently active in the sidebar ---
    // (shared with updateGridCounters/updatePaginationControls/changePage so they
    // never disagree with what's actually being rendered here)
    if (typeof getGalleryFilteredFiles === 'function') {
        arrRender = getGalleryFilteredFiles(arrRender);
    }

    // --- PAGINATION LOGIC (only kicks in above 100 images) ---
    const totalItems = arrRender.length;
    if (totalItems > itemsPerPage) {
        const totalPages = Math.ceil(totalItems / itemsPerPage);
        if (currentPage > totalPages) currentPage = totalPages;
        
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        arrRender = arrRender.slice(start, end);
    } else {
        currentPage = 1; // Reset if the folder is small
    }
    // -----------------------------------------------------------------

    arrRender.forEach(fileItem => {
        const wrapper = document.createElement('div');
        wrapper.className = 'grid-item-wrapper';

        const img = document.createElement('img');
        img.decoding = 'async';
        img.className = 'grid-item'; img.dataset.filename = fileItem.name;
        // Miniatura reduzida (não a imagem original decodificada) — tools/thumb_loader.js
        if (window.ThumbLoader) window.ThumbLoader.attach(img, fileItem.url); else img.src = fileItem.url;
        
        const label = document.createElement('div');
        label.className = 'grid-item-label';
		const nameOnly = fileItem.name.substring(0, fileItem.name.lastIndexOf('.')) || fileItem.name;
        label.textContent = nameOnly; 
        label.title = nameOnly;
		
		// label.textContent = fileItem.name;
        // label.title = fileItem.name; 
        
        const inSelectionMode = (typeof isTagMode !== 'undefined' && isTagMode) || (typeof isRenameMode !== 'undefined' && isRenameMode) || (typeof isMergeMode !== 'undefined' && isMergeMode);

        if (inSelectionMode) {
            img.onclick = () => { const cb = wrapper.querySelector('input[type="checkbox"]'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); };
            const cb = document.createElement('input'); 
            cb.type = 'checkbox'; 
            cb.className = isRenameMode ? 'rename-checkbox' : (isMergeMode ? 'merge-checkbox' : 'tag-checkbox'); 
            cb.dataset.filename = fileItem.name;
            wrapper.appendChild(img); wrapper.appendChild(cb);

            // Modo Merge: a última imagem marcada fica destacada (borda dourada)
            // e é ela que vira a "principal" do grupo — sem precisar de um botão à parte.
            if (isMergeMode && typeof markedPrimaryFile !== 'undefined' && markedPrimaryFile === fileItem.name) {
                wrapper.classList.add('merge-primary-candidate');
            }
        } else {
            img.onclick = () => openDetailView(fileItem.url, fileItem.name);
            wrapper.appendChild(img);

            // Grupo de "versões alternativas" (só na interface — ver gallery_merge_groups.js):
            // apenas o item principal chega até aqui (os demais membros já foram
            // removidos de arrRender por getGalleryFilteredFiles); isso adiciona o
            // selo e as setas de pré-visualização por cima da miniatura.
            const groupMembers = (typeof mergeGroups !== 'undefined') ? mergeGroups.get(fileItem.name) : null;
            if (groupMembers && groupMembers.length > 1 && typeof setupMergeGroupUI === 'function') {
                wrapper.classList.add('merge-group-item');
                wrapper.dataset.primary = fileItem.name;
                setupMergeGroupUI(wrapper, img, label, fileItem.name);
            }
        }
        
        wrapper.appendChild(label);
        grid.appendChild(wrapper);
    });
    
    updateGridCounters();
    updatePaginationControls(); // Refresh the page button display
    if (typeof renderAllViewCountBadges === 'function') renderAllViewCountBadges();
    if (typeof filterGallery === 'function') filterGallery(); 
}

function updatePaginationControls() {
    const container = document.getElementById('pagination-controls');
    if (!container) return;

    const inGridMode = !!currentHandle && document.getElementById('grid-view').style.display !== 'none';

    // 🎲 Random button lives in this same centered bar (bottom-middle, same
    // row as the "grid size" button on the left and the img/JSON counters on
    // the right), independent of whether pagination itself is needed.
    const showRandom = (typeof updateRandomButtonVisibility === 'function') ? updateRandomButtonVisibility(inGridMode) : false;

    const prevBtn  = document.getElementById('btn-page-prev');
    const nextBtn  = document.getElementById('btn-page-next');
    const pageInfo = document.getElementById('page-info');

    // Count only what's actually visible right now (a hidden/filtered gallery
    // tag must not keep pagination "alive" for pages that have no images left)
    const visibleCount = (typeof getGalleryFilteredFiles === 'function') ? getGalleryFilteredFiles().length : currentFiles.length;

    // Conditions: needs a loaded folder, must be in grid mode, and MORE than the page size in images total
    const needsPagination = inGridMode && visibleCount > itemsPerPage;

    if (!needsPagination) {
        if (prevBtn)  prevBtn.style.display  = 'none';
        if (nextBtn)  nextBtn.style.display  = 'none';
        if (pageInfo) pageInfo.style.display = 'none';

        // The bar itself stays up only if the Random button still needs it.
        container.style.display = showRandom ? 'flex' : 'none';
        return;
    }

    if (prevBtn)  prevBtn.style.display  = 'inline-block';
    if (nextBtn)  nextBtn.style.display  = 'inline-block';
    if (pageInfo) pageInfo.style.display = 'inline-block';

    container.style.display = 'flex';
    const totalPages = Math.ceil(visibleCount / itemsPerPage);
    document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages}`;
    
    prevBtn.disabled = (currentPage === 1);
    nextBtn.disabled = (currentPage === totalPages);
    
    prevBtn.style.opacity = (currentPage === 1) ? "0.4" : "1";
    prevBtn.style.cursor = (currentPage === 1) ? "default" : "pointer";
    nextBtn.style.opacity = (currentPage === totalPages) ? "0.4" : "1";
    nextBtn.style.cursor = (currentPage === totalPages) ? "default" : "pointer";
}

function toggleItemsPerPage() {
    const idx = PAGE_SIZE_OPTIONS.indexOf(itemsPerPage);
    itemsPerPage = PAGE_SIZE_OPTIONS[(idx + 1) % PAGE_SIZE_OPTIONS.length];
    currentPage = 1;
    const btn = document.getElementById('btn-page-size');
    if (btn) btn.textContent = itemsPerPage + ' grid';
    document.getElementById('grid-view').scrollTop = 0;
    renderGrid();
    saveSettingsToDB();
}

function changePage(direction) {
    const visibleCount = (typeof getGalleryFilteredFiles === 'function') ? getGalleryFilteredFiles().length : currentFiles.length;
    const totalPages = Math.ceil(visibleCount / itemsPerPage);
    currentPage += direction;
    
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;
    
    // Scroll the grid back to the top when changing pages
    document.getElementById('grid-view').scrollTop = 0;
    
    renderGrid();
}

/* ================================================================
   BLOCK 7 — IMAGE OPEN
   ================================================================ */
let detailSessionId = 0; 

async function openDetailView(url, fileName) {
    const currentSession = ++detailSessionId;

    if (isEditing) toggleManualEdit();
    if (typeof isTagMode !== 'undefined' && isTagMode) cancelBatchTags();
    if (typeof isMergeMode !== 'undefined' && isMergeMode) cancelMergeMode();

    document.getElementById('grid-view').style.display = 'none';
    document.getElementById('detail-view').style.display = 'flex';
    document.getElementById('right-col').style.display = 'flex';
    document.getElementById('resizer-right').style.display = 'flex'; 
    document.getElementById('main-image').src = url;
    document.getElementById('file-name').value = fileName;
    if (typeof syncMergeActivePreview === 'function') syncMergeActivePreview(fileName);
    if (typeof renderMergeVersionStrip === 'function') renderMergeVersionStrip(fileName);
    if (typeof registerImageView === 'function') registerImageView(fileName);
    if (typeof resetImageZoom === 'function') resetImageZoom(); // start every image at 100%, no leftover pan
    showAlert(null);
    updateGridCounters(); // Hide the counter since we left the grid
    updatePaginationControls(); // Hide pagination in detail mode

    // === SAVE/UPDATE BUTTON LOGIC ===
    const baseName = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
    const btnSave = document.getElementById('btn-save');
    if (currentJsonFiles.has(baseName + '.json')) {
        btnSave.textContent = 'Update JSON';
        btnSave.style.background = '#0d2a18';
        btnSave.style.borderColor = '#00aa66';
        btnSave.style.color = '#00ff99';
    } else {
        btnSave.textContent = 'Save JSON';
        btnSave.style.background = '';
        btnSave.style.borderColor = '';
        btnSave.style.color = '';
    }
    // ======================================

    const strip = document.getElementById('thumbnail-strip');
    if (strip.children.length === 0 || strip.children.length !== currentFiles.length) {
        strip.innerHTML = '';
        let arrThumb = [...currentFiles];
        if (sortMode === 1) arrThumb.sort((a,b) => a.name.localeCompare(b.name));
        else if (sortMode === 2) arrThumb.sort((a,b) => b.name.localeCompare(a.name));
        
        arrThumb.forEach(fileItem => {
            const term = document.getElementById('filter-tag').value.toLowerCase().trim();
            if (term !== '' && !fileItem.name.toLowerCase().includes(term)) return;
            
            const img = document.createElement('img'); 
            img.decoding = 'async';
            img.className = 'thumb';
            if (window.ThumbLoader) window.ThumbLoader.attach(img, fileItem.url, { root: strip }); else img.src = fileItem.url;
            if (fileItem.url === url) img.classList.add('active'); 
            img.onclick = () => openDetailView(fileItem.url, fileItem.name); 
            strip.appendChild(img);
        });
    } else {
        Array.from(strip.children).forEach(img => {
            if ((img.dataset.full || img.src) === url) {
                img.classList.add('active');
                img.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            } else {
                img.classList.remove('active');
            }
        });
    }

    fillFields(null);

    try {
        const jh = await currentHandle.getFileHandle(baseName + '.json'); const jf = await jh.getFile(); const jd = JSON.parse(await jf.text());
        if (currentSession !== detailSessionId) return; 
        
        fillFields({ pos: jd.positive ?? '', neg: jd.negative ?? '', tag: jd.tag ?? '', notes: jd.notes ?? (jd.note ? [jd.note] : []), cfg: jd.cfg ?? '', steps: jd.steps ?? '', seed: jd.seed ?? '', sampler: jd.sampler ?? '', ckpt: jd.checkpoint ?? '', loras: jd.loras ?? '', size: jd.size ?? '', source: 'json' });
        showAlert('✔ Metadata loaded from sidecar JSON.', 'success'); return; 
    } catch {}

    const fileItem = currentFiles.find(a => a.url === url);
    if (fileItem?.file) {
        try {
            const meta = await extractPNGMetadata(fileItem.file);
            if (currentSession !== detailSessionId) return; 

            if (meta) { 
                fillFields({ pos: meta.pos ?? '', neg: meta.neg ?? '', tag: '', notes: meta.notes ?? [], cfg: meta.cfg ?? '', steps: meta.steps ?? '', seed: meta.seed ?? '', sampler: meta.sampler ?? meta.scheduler ?? '', ckpt: meta.ckpt ?? meta.checkpoint ?? '', loras: meta.loras ?? '', size: meta.size ?? '', source: meta.source });
                showAlert(`✔ Metadata extracted from PNG.`, 'info'); return; 
            }
        } catch (e) { console.warn('PNG parser error:', e); }
    }

    if (currentSession !== detailSessionId) return;
    showAlert('⚠️ Metadata not found. Fill manually or generate a JSON sidecar.', 'error');
}

function backToGrid() {
    if (isEditing) toggleManualEdit();
    if (typeof isTagMode !== 'undefined' && isTagMode) cancelBatchTags();
    if (typeof isMergeMode !== 'undefined' && isMergeMode) cancelMergeMode();
    const mvs = document.getElementById('merge-version-strip');
    if (mvs) { mvs.classList.remove('active'); mvs.innerHTML = ''; }
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('right-col').style.display = 'none';
    document.getElementById('resizer-right').style.display = 'none'; 
    document.getElementById('grid-view').style.display = 'grid'; 
    updateGridCounters(); // Re-enable the counter when returning to the grid
    updatePaginationControls(); // Re-enable pagination when returning to the grid
    if (typeof filterGallery === 'function') filterGallery(); 
}

/* ================================================================
   BLOCK 8 — IMAGE ZOOM & PAN (detail view)
   Adapted from the zoom system the user provided: scroll wheel zooms
   in/out (100%–800%), and dragging pans around once zoomed in. Runs
   isolated in its own closure so it doesn't leak state anywhere else.
   Reset to 100% happens in openDetailView() whenever an image opens.
   ================================================================ */
(function () {
    let scale = 1, tx = 0, ty = 0;
    let isPanning = false, panStartX = 0, panStartY = 0;
    const MIN_ZOOM = 1, MAX_ZOOM = 8;

    function applyTransform() {
        const img = document.getElementById('main-image');
        const wrapper = document.getElementById('main-image-container');
        const display = document.getElementById('zoom-level-display');

        if (img) img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
        if (display) display.textContent = Math.round(scale * 100) + '%';
        if (wrapper) wrapper.classList.toggle('zoomed', scale > 1);
    }

    window.resetImageZoom = function () {
        scale = 1; tx = 0; ty = 0;
        applyTransform();
    };

    window.zoomImagePopout = function (delta) {
        scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale + delta));
        if (scale === MIN_ZOOM) { tx = 0; ty = 0; } // snap back to centered when fully zoomed out
        applyTransform();
    };

    window.addEventListener('DOMContentLoaded', () => {
        const wrapper = document.getElementById('main-image-container');
        if (!wrapper) return;

        wrapper.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.3 : -0.3;
            scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale + delta));
            if (scale === MIN_ZOOM) { tx = 0; ty = 0; }
            applyTransform();
        }, { passive: false });

        wrapper.addEventListener('mousedown', (e) => {
            if (scale <= MIN_ZOOM) return;               // nothing to pan at 100%
            if (e.target.closest('button')) return;       // don't hijack clicks on close/layout/zoom buttons
            isPanning = true;
            panStartX = e.clientX - tx;
            panStartY = e.clientY - ty;
            wrapper.classList.add('dragging');
        });

        document.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            tx = e.clientX - panStartX;
            ty = e.clientY - panStartY;
            applyTransform();
        });

        document.addEventListener('mouseup', () => {
            isPanning = false;
            wrapper.classList.remove('dragging');
        });
    });
})();