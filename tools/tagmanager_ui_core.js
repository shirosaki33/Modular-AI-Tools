/* =========================================================================
   UI CORE & SYSTEM LOGIC - TAG MANAGER (MULTI-LEVEL DIRECTORY)
   Handles resizers, modals, list rendering, renaming, replacing, and filters.
========================================================================= */

window.rootHandle = null;
window.sub1Handles = new Map();
window.sub2Handles = new Map();
window.currentImagesHandle = null;

let imageFiles = []; 
let selectedIndices = new Set();

let masterTagSet = new Set(); 
let masterSelectedTags = new Set(); 
let activeSelectedTags = new Set();

let datasetConfig = {}; 
window.filterMode = 'NONE'; 

/* === INDEXEDDB PARA O DATASET (SALVAR PASTA) === */
const dbNameDataset = 'TagManagerDatasetDB';

function initDatasetDB() { 
    return new Promise((res, rej) => { 
        try {
            const req = indexedDB.open(dbNameDataset, 1); 
            req.onupgradeneeded = e => e.target.result.createObjectStore('handles'); 
            req.onsuccess = e => res(e.target.result); 
            req.onerror = e => rej(e.target.error); 
        } catch (err) { rej(err); }
    }); 
}

async function saveDatasetHandle(h) { 
    try {
        const db = await initDatasetDB(); 
        return new Promise(r => { 
            const tx = db.transaction('handles', 'readwrite'); 
            tx.objectStore('handles').put(h, 'dataset_dir'); 
            tx.oncomplete = r; 
        }); 
    } catch (e) {}
}

async function getDatasetHandle() { 
    try {
        const db = await initDatasetDB(); 
        return new Promise(r => { 
            const tx = db.transaction('handles', 'readonly'); 
            const req = tx.objectStore('handles').get('dataset_dir'); 
            req.onsuccess = () => r(req.result); 
            req.onerror = () => r(null); 
        }); 
    } catch (e) { return null; }
}

// Verifica se tem pasta salva ao carregar a página
window.addEventListener('DOMContentLoaded', async () => {
    let savedDatasetHandle = await getDatasetHandle();
    if (savedDatasetHandle) {
        window.rootHandle = savedDatasetHandle;
        const btn = document.getElementById('btn-load-dataset');
        if (btn) btn.innerHTML = '🔄 Reconnect Dataset';
    }
});

window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); window.saveAllImages(); }
});

window.showAlert = function(msg, type = 'success') {
    const bar = document.getElementById('alertBar');
    if(!bar) return;
    bar.className = type; bar.textContent = msg;
    bar.style.display = 'block';
    setTimeout(() => { bar.className = ''; bar.style.display = 'none'; }, 3500);
};

/* === INITIALIZATION === */
window.initSystem = function() {
    if(typeof window.updateBatchUI === 'function') window.updateBatchUI(); 
    setupResizers();
    
    // Checa se está rodando via file:// e exibe o aviso
    if (window.location.protocol === 'file:') {
        const fileWarning = document.getElementById('file-protocol-warning');
        if (fileWarning) fileWarning.style.display = 'block';
    }
};

/* === IMAGE SLIDER SIZE === */
window.updateThumbSize = function(val) {
    document.documentElement.style.setProperty('--thumb-size', val + 'px');
};

/* === EDITOR (TAGS/NL) FONT SIZE SLIDER === */
window.updateEditorFontSize = function(val) {
    document.documentElement.style.setProperty('--editor-font-size', val + 'px');
};

/* === RESIZER OPTIMIZATION (No Lag) === */
function setupResizers() {
    let isDraggingLeft = false;
    let isDraggingRight = false;
    let rafPending = false;

    const resizerLeft = document.getElementById('resizer-left');
    const resizerRight = document.getElementById('resizer-right');
    const colList = document.getElementById('col-list');
    const colTools = document.getElementById('col-tools');

    if(resizerLeft) {
        resizerLeft.addEventListener('mousedown', () => { 
            isDraggingLeft = true; 
            document.body.classList.add('is-resizing'); 
        });
    }
    
    if(resizerRight) {
        resizerRight.addEventListener('mousedown', () => { 
            isDraggingRight = true; 
            document.body.classList.add('is-resizing');
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingLeft && !isDraggingRight) return;
        if (rafPending) return;
        
        rafPending = true;
        requestAnimationFrame(() => {
            if (isDraggingLeft && colList) {
                let newWidth = e.clientX;
                if (newWidth < 200) newWidth = 200;
                if (newWidth > window.innerWidth * 0.45) newWidth = window.innerWidth * 0.45;
                colList.style.width = newWidth + 'px';
            }
            if (isDraggingRight && colTools) {
                let newWidth = window.innerWidth - e.clientX;
                if (newWidth < 250) newWidth = 250;
                if (newWidth > window.innerWidth * 0.45) newWidth = window.innerWidth * 0.45;
                colTools.style.width = newWidth + 'px';
            }
            rafPending = false;
        });
    });

    document.addEventListener('mouseup', () => {
        isDraggingLeft = false;
        isDraggingRight = false;
        document.body.classList.remove('is-resizing');
    });
}

/* === MODALS & UI TOGGLES === */
window.toggleSettings = () => document.getElementById('settings-dropdown').classList.toggle('open');
window.toggleTypeSelect = () => document.getElementById('topbar-system-type').style.display = document.getElementById('toggle-type-select').checked ? 'inline-block' : 'none';
window.toggleFormatSelect = () => document.getElementById('topbar-save-format').style.display = document.getElementById('toggle-format-select').checked ? 'inline-block' : 'none';
window.toggleHelpBtn = () => document.getElementById('btn-help').style.display = document.getElementById('toggle-help-btn').checked ? 'inline-block' : 'none';
window.showHelp = () => document.getElementById('modal-help').classList.add('active');
window.closeModal = (id) => document.getElementById(id).classList.remove('active');

document.addEventListener('click', (e) => {
    const dropdownSettings = document.getElementById('settings-dropdown');
    const btnSettings = document.getElementById('btn-settings');
    if (dropdownSettings && dropdownSettings.classList.contains('open') && !dropdownSettings.contains(e.target) && !btnSettings.contains(e.target)) dropdownSettings.classList.remove('open');

    const ddReplace = document.getElementById('replace-dropdown');
    if (ddReplace && ddReplace.classList.contains('open') && !ddReplace.contains(e.target) && !e.target.closest('.btn-replace')) ddReplace.classList.remove('open');

    const ddRename = document.getElementById('rename-dropdown');
    if (ddRename && ddRename.classList.contains('open') && !ddRename.contains(e.target) && !e.target.closest('.btn-save-local')) ddRename.classList.remove('open');
});

window.toggleMode = function() {
    document.getElementById('view-auto').classList.add('active');
    if(typeof window.checkBatchReadyState === "function") window.checkBatchReadyState();
};

window.updateBatchUI = function() {
    const modeSelect = document.getElementById('batch-mode-select');
    if (!modeSelect) return;
    const mode = modeSelect.value;
    
    document.getElementById('batch-tag-settings').style.display = 'none';
    document.getElementById('batch-vlm-settings').style.display = 'none';

    if (mode === 'tags') document.getElementById('batch-tag-settings').style.display = 'block';
    else if (mode === 'nl-vlm') document.getElementById('batch-vlm-settings').style.display = 'block';
    
    if(typeof window.checkBatchReadyState === 'function') window.checkBatchReadyState();
}

/* === MULTI-LEVEL DATASET LOADING === */
window.loadImagesDirectory = async function() {
    try {
        if (typeof window.showDirectoryPicker === 'undefined') {
            window.showAlert("Browser does not support folder selection.", "error"); return;
        }

        const btn = document.getElementById('btn-load-dataset');

        // Se o botão for "Reconnect" e tivermos o handle salvo na memória, pede permissão
        if (btn && btn.innerHTML.includes('Reconnect') && window.rootHandle) {
            if (await window.rootHandle.requestPermission({ mode: 'readwrite' }) === 'granted') {
                btn.innerHTML = '📁 Load Dataset'; 
                document.getElementById('btn-refresh').style.display = 'inline-block';
                await window.loadGallery(window.rootHandle);
                return;
            }
        }

        // Seleção normal (nova pasta escolhida pelo usuário)
        window.rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        
        // Salva a nova pasta no IndexedDB
        await saveDatasetHandle(window.rootHandle); 
        
        if (btn) btn.innerHTML = '📁 Load Dataset';
        document.getElementById('btn-refresh').style.display = 'inline-block';
        await window.loadGallery(window.rootHandle);
        
    } catch (e) { 
        if(e.name !== 'AbortError') window.showAlert("Error: " + e.message, "error"); 
    }
};

window.refreshDataset = async function() {
    if (!window.currentImagesHandle && !window.rootHandle) return;
    const selectedBaseNames = Array.from(selectedIndices).map(i => imageFiles[i].baseName);
    
    const val2 = document.getElementById('sub-dir-2').value;
    const val1 = document.getElementById('sub-dir-1').value;

    if (val2 && document.getElementById('sub-dir-2').style.display !== 'none') { 
        await window.loadSubDir2(); 
    } else if (val1 && document.getElementById('sub-dir-1').style.display !== 'none') { 
        await window.loadSubDir1(); 
    } else if (window.rootHandle) { 
        await window.loadGallery(window.rootHandle); 
    }

    imageFiles.forEach((img, i) => { if (selectedBaseNames.includes(img.baseName)) selectedIndices.add(i); });
    window.updateListSelectionVisuals();
    if(selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
    window.showAlert(`Refreshed! ${imageFiles.length} images loaded.`);
};

// --- LEVEL 1 (ROOT) ---
window.loadGallery = async function(dirHandle) {
    window.currentImagesHandle = dirHandle;
    window.sub1Handles.clear();
    
    const sel1 = document.getElementById('sub-dir-1');
    const sel2 = document.getElementById('sub-dir-2');
    sel1.style.display = 'none';
    sel2.style.display = 'none';

    await loadDatasetConfig(dirHandle);

    imageFiles = []; masterTagSet.clear(); masterSelectedTags.clear(); activeSelectedTags.clear(); selectedIndices.clear();
    let configNeedsSave = false;

    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
            configNeedsSave = await processSingleImage(entry, dirHandle, configNeedsSave);
        } else if (entry.kind === 'directory') {
            window.sub1Handles.set(entry.name, entry);
        }
    }

    if (configNeedsSave) await saveDatasetConfig(dirHandle);

    if (window.sub1Handles.size > 0) {
        sel1.style.display = 'inline-block';
        sel1.innerHTML = '<option value="">-- Root --</option>';
        for (let name of Array.from(window.sub1Handles.keys()).sort((a,b) => a.localeCompare(b))) {
            sel1.innerHTML += `<option value="${name}">${name}</option>`;
        }
    }

    finishLoading();
};

// --- LEVEL 2 (FLATTENED SUBFOLDER) ---
window.loadSubDir1 = async function() {
    const val = document.getElementById('sub-dir-1').value;
    const sel2 = document.getElementById('sub-dir-2');

    if (!val) {
        await window.loadGallery(window.rootHandle);
        return;
    }

    window.currentImagesHandle = window.sub1Handles.get(val); 
    window.sub2Handles.clear();
    sel2.style.display = 'none';
    sel2.innerHTML = `<option value="">-- [ ${val} ] --</option>`;

    await loadDatasetConfig(window.currentImagesHandle);

    imageFiles = []; masterTagSet.clear(); masterSelectedTags.clear(); activeSelectedTags.clear(); selectedIndices.clear();
    let configNeedsSave = false;

    configNeedsSave = await scanFlattenedTags(window.currentImagesHandle, "", true, 0, configNeedsSave);

    if (configNeedsSave) await saveDatasetConfig(window.currentImagesHandle);

    if (window.sub2Handles.size > 0) {
        sel2.style.display = 'inline-block';
        for (let path of Array.from(window.sub2Handles.keys()).sort((a,b) => a.localeCompare(b))) {
            sel2.innerHTML += `<option value="${path}">${path}</option>`;
        }
    }

    finishLoading();
};

async function scanFlattenedTags(dirHandle, pathPrefix, isFirstLevel, depth, configNeedsSave) {
    if (depth > 10) return configNeedsSave; 
    
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
            const fullPath = pathPrefix ? pathPrefix + '/' + entry.name : entry.name;
            window.sub2Handles.set(fullPath, entry);
            configNeedsSave = await scanFlattenedTags(entry, fullPath, false, depth + 1, configNeedsSave);
        } else if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
            configNeedsSave = await processSingleImage(entry, dirHandle, configNeedsSave);
        }
    }
    return configNeedsSave;
}

// --- LEVEL 3 (SPECIFIC SUBFOLDER FILTER) ---
window.loadSubDir2 = async function() {
    const val = document.getElementById('sub-dir-2').value;

    if (!val) {
        await window.loadSubDir1();
        return;
    }

    const targetHandle = window.sub2Handles.get(val);
    window.currentImagesHandle = targetHandle;

    await loadDatasetConfig(targetHandle);

    imageFiles = []; masterTagSet.clear(); masterSelectedTags.clear(); activeSelectedTags.clear(); selectedIndices.clear();
    let configNeedsSave = false;
    
    for await (const entry of targetHandle.values()) {
        if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
            configNeedsSave = await processSingleImage(entry, targetHandle, configNeedsSave);
        }
    }

    if (configNeedsSave) await saveDatasetConfig(targetHandle);
    finishLoading();
};

/* === FILE PROCESSING UTILS === */
function detectFormat(text) {
    if (!text) return 'tags';
    if (text.includes('\n')) return 'nl';
    if ((text.match(/\./g) || []).length > 0 && (text.match(/,/g) || []).length < (text.match(/\./g) || []).length * 2) return 'nl';
    if (!text.includes(',') && text.split(' ').length > 6) return 'nl';
    return 'tags';
}

async function processSingleImage(entry, parentHandle, configNeedsSave) {
    const file = await entry.getFile();
    const baseName = entry.name.substring(0, entry.name.lastIndexOf('.'));
    let content = ""; let hasFile = false; let ext = "txt"; 
    
    try {
        const txtHandle = await parentHandle.getFileHandle(baseName + '.txt');
        content = await (await txtHandle.getFile()).text(); hasFile = true; ext = "txt";
    } catch(e) {}
    
    if(!hasFile) {
        try {
            const jsonHandle = await parentHandle.getFileHandle(baseName + '.json');
            const jsonObj = JSON.parse(await (await jsonHandle.getFile()).text());
            if(jsonObj.tags) content = jsonObj.tags; else if(jsonObj.caption) content = jsonObj.caption;
            hasFile = true; ext = "json";
        } catch(e) {}
    }

    let type = "tags";
    if (datasetConfig[baseName]) {
        type = datasetConfig[baseName].type || "tags";
        ext = datasetConfig[baseName].ext || ext; 
    } else {
        type = detectFormat(content);
        datasetConfig[baseName] = { type: type, ext: ext };
        configNeedsSave = true; 
    }

    if (type === 'tags' && content.trim()) {
        content.split(',').forEach(t => { if(t.trim()) masterTagSet.add(t.trim()); });
    }
    
    imageFiles.push({ handle: entry, parentDirHandle: parentHandle, name: entry.name, baseName: baseName, url: URL.createObjectURL(file), content: content, type: type, hasFile: hasFile, ext: ext });
    return configNeedsSave;
}

function finishLoading() {
    imageFiles.sort((a,b) => a.name.localeCompare(b.name));
    document.getElementById('list-count').textContent = imageFiles.length;
    
    window.updateTagsDatalist();
    window.renderImageList(); 
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.checkBatchReadyState === "function") window.checkBatchReadyState();
    
    if (imageFiles.length > 0) { 
        document.getElementById('btn-save-all').style.display = 'inline-block';
        document.getElementById('btn-save-active').style.display = 'inline-block';
        window.handleListClick(0, false, false); 
    } else {
        document.getElementById('btn-save-all').style.display = 'none';
        document.getElementById('btn-save-active').style.display = 'none';
        if (typeof window.renderEditor === 'function') window.renderEditor();
    }
}

async function loadDatasetConfig(dirHandle) {
    try {
        const configHandle = await dirHandle.getFileHandle('_tagger_config.json');
        const file = await configHandle.getFile();
        datasetConfig = JSON.parse(await file.text());
    } catch(e) { datasetConfig = {}; }
}

async function saveDatasetConfig(dirHandle) {
    if (!dirHandle) return;
    try {
        const configHandle = await dirHandle.getFileHandle('_tagger_config.json', { create: true });
        const writable = await configHandle.createWritable();
        await writable.write(JSON.stringify(datasetConfig, null, 2));
        await writable.close();
    } catch(e) {}
}

window.updateSelectedConfig = async function() {
    if (selectedIndices.size === 0) return;
    
    const newType = document.getElementById('topbar-system-type').value;
    const newExt = document.getElementById('topbar-save-format').value;

    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        img.type = newType;
        img.ext = newExt;
        datasetConfig[img.baseName] = { type: newType, ext: newExt };
    });

    await saveDatasetConfig(window.currentImagesHandle);
    window.refreshListStatus();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    window.showAlert("Configuration saved to catalog!", "success");
}

window.updateTagsDatalist = function() {
    const datalist = document.getElementById('all-tags-list');
    if(!datalist) return;
    datalist.innerHTML = '';
    Array.from(masterTagSet).sort().forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag; datalist.appendChild(opt);
    });
};

/* === MULTI RENAME SYSTEM === */
window.openRenameModal = function() {
    if(selectedIndices.size === 0) return;
    const idx = Array.from(selectedIndices)[0];
    document.getElementById('rename-input').value = imageFiles[idx].baseName;
    document.getElementById('rename-dropdown').classList.add('open');
    document.getElementById('rename-input').focus();
}

window.confirmRename = async function() {
    if(selectedIndices.size === 0) return;
    const newBaseName = document.getElementById('rename-input').value.trim();
    if (!newBaseName) { document.getElementById('rename-dropdown').classList.remove('open'); return; }

    document.getElementById('rename-dropdown').classList.remove('open');
    const indices = Array.from(selectedIndices).sort((a,b) => a - b);
    const isMulti = indices.length > 1;
    let count = 1; let renamedCount = 0;

    for (let idx of indices) {
        const img = imageFiles[idx];
        const oldName = img.name;
        const oldExt = oldName.split('.').pop();
        
        const finalBaseName = isMulti ? `${newBaseName}_${count}` : newBaseName;
        const newName = `${finalBaseName}.${oldExt}`;

        if (oldName === newName) { count++; continue; }

        try {
            // Rename Image
            const oldImgHandle = await img.parentDirHandle.getFileHandle(oldName);
            const oldImgFile = await oldImgHandle.getFile();
            const newImgHandle = await img.parentDirHandle.getFileHandle(newName, {create: true});
            const writableImg = await newImgHandle.createWritable();
            await writableImg.write(await oldImgFile.arrayBuffer());
            await writableImg.close();
            await img.parentDirHandle.removeEntry(oldName);

            // Rename Text/JSON
            const textFormat = img.ext || 'txt';
            const oldTextName = `${img.baseName}.${textFormat}`;
            const newTextName = `${finalBaseName}.${textFormat}`;
            
            if (img.hasFile) {
                try {
                    const oldTextHandle = await img.parentDirHandle.getFileHandle(oldTextName);
                    const oldTextFile = await oldTextHandle.getFile();
                    const newTextHandle = await img.parentDirHandle.getFileHandle(newTextName, {create: true});
                    const writableText = await newTextHandle.createWritable();
                    await writableText.write(await oldTextFile.arrayBuffer());
                    await writableText.close();
                    await img.parentDirHandle.removeEntry(oldTextName);
                } catch(e) {}
            }

            if (datasetConfig[img.baseName]) {
                datasetConfig[finalBaseName] = datasetConfig[img.baseName];
                delete datasetConfig[img.baseName];
            }
            img.name = newName; img.baseName = finalBaseName;
            renamedCount++;
        } catch(e) { console.error("Rename Error:", e); }
        count++;
    }

    if(renamedCount > 0) {
        await saveDatasetConfig(window.currentImagesHandle);
        window.showAlert(`Renamed ${renamedCount} files!`, "success");
        await window.refreshDataset(); 
    }
}

/* === REPLACE TAG SYSTEM === */
let replaceScope = 'active';

window.openReplaceTagModal = function(scope) {
    replaceScope = scope;
    let targetTag = '';
    
    if (scope === 'active' && activeSelectedTags.size > 0) targetTag = Array.from(activeSelectedTags)[0];
    else if (scope === 'master' && masterSelectedTags.size > 0) targetTag = Array.from(masterSelectedTags)[0];
    
    if(!targetTag) { window.showAlert("Select a tag first!", "warn"); return; }

    document.getElementById('replace-scope').textContent = scope === 'active' ? 'Active Image' : 'All Dataset';
    document.getElementById('replace-old-tag').value = targetTag;
    document.getElementById('replace-new-tag').value = '';
    document.getElementById('replace-dropdown').classList.add('open');
    document.getElementById('replace-new-tag').focus();
}

window.confirmReplaceTag = async function() {
    const oldTag = document.getElementById('replace-old-tag').value.trim();
    const newTag = document.getElementById('replace-new-tag').value.trim();
    
    document.getElementById('replace-dropdown').classList.remove('open');

    if (!oldTag || !newTag || oldTag === newTag) {
        return;
    }

    let replacedCount = 0;
    let indicesToProcess = replaceScope === 'active' ? Array.from(selectedIndices) : imageFiles.map((_, i) => i);
    let modifiedFiles = []; 

    for (const idx of indicesToProcess) {
        const img = imageFiles[idx];
        if (img.type === 'tags' && img.content) {
            let tags = img.content.split(',').map(t => t.trim()).filter(t => t);
            if (tags.includes(oldTag)) {
                tags = tags.map(t => t === oldTag ? newTag : t);
                tags = [...new Set(tags)]; 
                img.content = tags.join(', ');
                img.hasFile = true;
                modifiedFiles.push(img);
                replacedCount++;
            }
        }
    }

    masterTagSet.clear();
    imageFiles.forEach(img => {
        if(img.type === 'tags' && img.content) img.content.split(',').forEach(t => { if(t.trim()) masterTagSet.add(t.trim()); });
    });

    window.updateTagsDatalist();

    if (replaceScope === 'active') { activeSelectedTags.delete(oldTag); activeSelectedTags.add(newTag); }
    if (replaceScope === 'master') { masterSelectedTags.delete(oldTag); masterSelectedTags.add(newTag); }

    window.showAlert(`Tag replaced in ${replacedCount} images!`, "success");

    try {
        if (replacedCount > 0) {
            window.renderImageList();
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            if (typeof window.renderEditor === 'function') window.renderEditor();
            if (typeof window.applyFilters === 'function') window.applyFilters();
        }
    } catch(e) { console.error("Render refresh failed:", e); }

    const savePromises = modifiedFiles.map(async (img) => {
        try {
            const formatToUse = img.ext || 'txt';
            const fileName = formatToUse === 'json' ? img.baseName + '.json' : img.baseName + '.txt';
            let contentToSave = img.content;
            if(formatToUse === 'json') {
                contentToSave = img.type === 'tags' ? JSON.stringify({ tags: img.content }, null, 2) : JSON.stringify({ caption: img.content.replace(/\n/g, ' ') }, null, 2);
            }
            const fileHandle = await img.parentDirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(contentToSave);
            await writable.close();
        } catch(e) {
            console.error("Failed to save", img.name, e);
        }
    });

    Promise.all(savePromises).catch(e => console.error("Batch save error:", e));
}

/* === FILTERS (WITH DISABLE OPTION) === */
window.setLogic = function(mode) {
    const btn = document.getElementById('btn-logic-' + mode);
    
    if (btn && btn.classList.contains('active')) {
        btn.classList.remove('active');
        window.filterMode = 'NONE';
    } else {
        document.querySelectorAll('.logic-btn').forEach(b => b.classList.remove('active'));
        if(btn) btn.classList.add('active');
        window.filterMode = mode;
    }

    if (typeof window.applyFilters === 'function') {
        if (window.filterMode === 'NONE') {
            imageFiles.forEach(img => { if(img.element) img.element.style.display = 'flex'; });
        } else {
            window.applyFilters();
        }
    }
};

/* === IMAGE LIST RENDERING === */
let lastSelectedIndex = 0;

window.renderImageList = function() {
    const listDiv = document.getElementById('image-list'); listDiv.innerHTML = '';
    imageFiles.forEach((img, index) => {
        const div = document.createElement('div');
        let currentExt = img.ext || 'txt';
        let typeBadge = img.hasFile ? (img.type === 'nl' ? `📝 NL (.${currentExt})` : `🏷️ Tags (.${currentExt})`) : 'Empty';
        
        div.className = `list-item ${img.hasFile ? (img.type === 'nl' ? 'is-nl' : 'has-data') : ''}`;
        div.innerHTML = `
            <img src="${img.url}">
            <div class="list-item-info">
                <div class="list-item-name">${img.name}</div>
                <div class="list-item-status">${typeBadge}</div>
            </div>
        `;
        div.onclick = (e) => window.handleListClick(index, e.shiftKey, e.ctrlKey || e.metaKey);
        div.ondblclick = () => { document.getElementById('image-popout').src = img.url; window.openModal('modal-image'); };
        img.element = div; listDiv.appendChild(div);
    });
    
    if (typeof window.applyFilters === 'function') {
        if (window.filterMode === 'NONE') { imageFiles.forEach(img => { if(img.element) img.element.style.display = 'flex'; }); } 
        else window.applyFilters();
    }
}

window.handleListClick = function(index, shiftKey, ctrlKey) {
    if (shiftKey && selectedIndices.size > 0) {
        const start = Math.min(lastSelectedIndex, index), end = Math.max(lastSelectedIndex, index);
        selectedIndices.clear(); for (let i = start; i <= end; i++) selectedIndices.add(i);
    } else if (ctrlKey) {
        if (selectedIndices.has(index)) selectedIndices.delete(index); else selectedIndices.add(index);
        lastSelectedIndex = index;
    } else {
        selectedIndices.clear(); selectedIndices.add(index); lastSelectedIndex = index;
    }
    activeSelectedTags.clear(); 
    window.updateListSelectionVisuals(); 
    if (typeof window.renderEditor === 'function') window.renderEditor();
}

window.updateListSelectionVisuals = function() {
    imageFiles.forEach((img, i) => {
        if (selectedIndices.has(i)) img.element.classList.add('selected'); else img.element.classList.remove('selected');
    });
    const listActions = document.getElementById('list-selection-actions');
    if(listActions) listActions.style.display = selectedIndices.size > 0 ? 'flex' : 'none';
}

window.refreshListStatus = function() {
    imageFiles.forEach(img => {
        if(img.hasFile) {
            img.element.className = img.type === 'nl' ? 'list-item is-nl' : 'list-item has-data';
            img.element.querySelector('.list-item-status').textContent = img.type === 'nl' ? `📝 NL (.${img.ext})` : `🏷️ Tags (.${img.ext})`;
        }
    });
    window.updateListSelectionVisuals();
}

window.deleteSingleImage = async function(e, index) {
    e.stopPropagation();
    if(!confirm(`Delete this image and its text data permanently from disk?`)) return;
    try {
        const img = imageFiles[index];
        await img.parentDirHandle.removeEntry(img.name);
        try { await img.parentDirHandle.removeEntry(img.baseName + '.txt'); } catch(err){}
        try { await img.parentDirHandle.removeEntry(img.baseName + '.json'); } catch(err){}
        
        if (datasetConfig[img.baseName]) { delete datasetConfig[img.baseName]; await saveDatasetConfig(window.currentImagesHandle); }
        window.showAlert(`Deleted file.`, 'success');
        await window.refreshDataset();
    } catch(err) { window.showAlert("Error deleting file.", "error"); }
}

window.deleteSelectedImages = async function() {
    if(selectedIndices.size === 0) return;
    if(!confirm(`Delete ${selectedIndices.size} image(s) and text data permanently from disk?`)) return;
    
    const indices = Array.from(selectedIndices).sort((a,b) => b - a);
    let deletedCount = 0;
    
    for(let i of indices) {
        const img = imageFiles[i];
        try {
            await img.parentDirHandle.removeEntry(img.name);
            try { await img.parentDirHandle.removeEntry(img.baseName + '.txt'); } catch(err){}
            try { await img.parentDirHandle.removeEntry(img.baseName + '.json'); } catch(err){}
            if (datasetConfig[img.baseName]) delete datasetConfig[img.baseName];
            deletedCount++;
        } catch(e) {}
    }
    
    await saveDatasetConfig(window.currentImagesHandle);
    window.showAlert(`Deleted ${deletedCount} files.`, 'success');
    await window.refreshDataset();
}

window.saveActiveSelectedImages = async function(silent = false) {
    if (!window.currentImagesHandle && !window.rootHandle || selectedIndices.size === 0) return;
    let savedCount = 0;
    const promises = Array.from(selectedIndices).map(async (idx) => {
        const img = imageFiles[idx];
        if (img.hasFile) {
            const formatToUse = img.ext || 'txt';
            const fileName = formatToUse === 'json' ? img.baseName + '.json' : img.baseName + '.txt';
            let contentToSave = img.content;
            if(formatToUse === 'json') {
                contentToSave = img.type === 'tags' ? JSON.stringify({ tags: img.content }, null, 2) : JSON.stringify({ caption: img.content.replace(/\n/g, ' ') }, null, 2);
            }
            const fileHandle = await img.parentDirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(contentToSave); await writable.close(); 
            savedCount++;
        }
    });
    await Promise.all(promises);
    if(!silent) window.showAlert(`Saved ${savedCount} active files.`);
}

window.saveAllImages = async function(silent = false) {
    if (!window.currentImagesHandle && !window.rootHandle || imageFiles.length === 0) return;
    let savedCount = 0;
    const promises = imageFiles.map(async (img) => {
        if (img.hasFile) {
            const formatToUse = img.ext || 'txt';
            const fileName = formatToUse === 'json' ? img.baseName + '.json' : img.baseName + '.txt';
            let contentToSave = img.content;
            if(formatToUse === 'json') {
                contentToSave = img.type === 'tags' ? JSON.stringify({ tags: img.content }, null, 2) : JSON.stringify({ caption: img.content.replace(/\n/g, ' ') }, null, 2);
            }
            const fileHandle = await img.parentDirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(contentToSave); await writable.close(); 
            savedCount++;
        }
    });
    await Promise.all(promises);
    if(!silent) window.showAlert(`Saved all ${savedCount} modified files in the dataset.`);
}