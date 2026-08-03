/* ================================================================
   GALLERY UI
   UI utilities & settings, batch selection helpers, grid thumbnail
   zoom, notes/LoRAs editing, manual edit mode, and the ComfyUI +
   NovelAI metadata parser. Split out of gallery_holder.html together
   with gallery_core.js purely to keep the HTML file a manageable size
   — both are plain scripts sharing the same global scope, so nothing
   about how the app behaves changes.
   ================================================================ */

/* ================================================================
   BLOCK 1 — UI UTILITIES & SETTINGS
   ================================================================ */
function autoResize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

function copyText(btn, id) { 
    let el = id ? document.getElementById(id) : btn.closest('.promptBlock').querySelector('.collapsible-content textarea, .collapsible-content input'); 
    if (!el || !el.value) return; 
    navigator.clipboard.writeText(el.value).then(() => { 
        const old = btn.innerText; btn.innerText = '✓'; btn.classList.add('copied'); 
        setTimeout(() => { btn.innerText = old; btn.classList.remove('copied'); }, 1500); 
    }); 
}

function setCollapseState(block, isCollapsed) { 
    if (!block) return; 
    const btn = block.querySelector('.collapse-btn'); 
    const content = block.querySelector('.collapsible-content'); 
    if (!btn || !content) return; 
    if (isCollapsed) { 
        content.style.display = 'none'; btn.textContent = '▶'; 
    } else { 
        content.style.display = ''; btn.textContent = '▼'; 
        const textareas = content.querySelectorAll('textarea'); 
        textareas.forEach(ta => autoResize(ta)); 
    } 
}

function toggleCollapse(btn) { 
    const block = btn.closest('.promptBlock'); 
    const content = block.querySelector('.collapsible-content'); 
    const isCollapsed = content.style.display === 'none'; 
    setCollapseState(block, !isCollapsed); 

    // Fixed blocks (Generation Data, LoRAs, Positive/Negative Prompt) remember
    // the user's choice globally, independent of which image is open. Dynamic
    // note blocks don't have a data-block-id and are left out of this.
    const blockId = block.dataset.blockId;
    if (blockId) persistBlockCollapse(blockId, !isCollapsed);
}

let alertTimeout;
let deferredSourceBarUpdate = null;

function showAlert(msg, type) {
    const bar = document.getElementById('alertBar'); 
    clearTimeout(alertTimeout);
    
    if (deferredSourceBarUpdate) {
        clearTimeout(deferredSourceBarUpdate);
        deferredSourceBarUpdate = null;
    }

    if (!msg) { 
        bar.style.display = 'none'; bar.className = ''; bar.textContent = ''; 
        return; 
    }
    
    if (msg.includes('JSON') && !msg.includes('not found') && !msg.includes('Error')) {
       document.getElementById('sourceBar').style.display = 'none'; bar.className = 'success';
       
       if (msg.includes('loaded from sidecar')) {
           deferredSourceBarUpdate = setTimeout(() => {
               const sourceBar = document.getElementById('sourceBar');
               const sourceText = document.getElementById('source-text');
               sourceText.textContent = 'JSON Sidecar';
               sourceBar.className = 'json-source';
               sourceBar.style.display = 'block';
           }, 5000);
       }
       
    } else if (msg.includes('extracted from PNG') || msg.includes('Processing batch')) {
        document.getElementById('sourceBar').style.display = 'none'; bar.className = 'info'; 

        deferredSourceBarUpdate = setTimeout(() => {
           const sourceBar = document.getElementById('sourceBar');
           sourceBar.className = '';
           sourceBar.style.display = 'block';
        }, 5000);
    } else if (msg.includes('not found') || msg.includes('Error') || type === 'error' || msg.includes('⚠️') || msg.includes('❌') || msg.includes('🗑️')) {
         bar.className = 'error';
         if(type === 'success') bar.className = 'success'; 
    } else {
         bar.className = type || 'info';
    }

    bar.textContent = msg; 
    bar.style.display = 'block';
    
    alertTimeout = setTimeout(() => { 
        bar.style.display = 'none'; 
    }, 5000); 
}

function toggleSettings() { document.getElementById('settings-dropdown').classList.toggle('open'); }

function toggleExtraFields() { 
    const isChecked = document.getElementById('toggle-extra-fields').checked; 
    const table = document.querySelector('.meta-table'); 
    if (isChecked) table.classList.remove('hide-extras'); else table.classList.add('hide-extras'); 
}

function toggleFilenameField() { 
    const isChecked = document.getElementById('toggle-filename-field').checked; 
    const grid = document.getElementById('grid-view'); 
    if (isChecked) grid.classList.remove('hide-filenames'); else grid.classList.add('hide-filenames'); 
}

function togglePathDisplay() {
    const isChecked = document.getElementById('toggle-path-field').checked;
    const displayElement = document.getElementById('path-display');
    if (isChecked) {
        displayElement.style.display = 'block';
    } else {
        displayElement.style.display = 'none';
    }
}

function togglePathIcon() {
    const isChecked = document.getElementById('toggle-path-icon').checked;
    const btn = document.getElementById('btn-path-label');
    if (isChecked && typeof rootHandle !== 'undefined' && rootHandle) {
        btn.style.display = 'inline-block';
    } else {
        btn.style.display = 'none';
    }
}

// --- GLOBAL GRID COUNTERS FUNCTION ---
function updateGridCounters() {
    const container = document.getElementById('grid-counters');
    const imgDisplay = document.getElementById('image-count-display');
    const jsonDisplay = document.getElementById('json-count-display');
    const pageSizeToggle = document.getElementById('page-size-toggle');
    const gridZoomToggle = document.getElementById('grid-zoom-toggle');
    
    // Hide if outside grid mode or no folder loaded
    if (!currentHandle || document.getElementById('grid-view').style.display === 'none') {
        if (container) container.style.display = 'none';
        if (pageSizeToggle) pageSizeToggle.style.display = 'none';
        if (gridZoomToggle) gridZoomToggle.style.display = 'none';
        return;
    }

    if (pageSizeToggle) pageSizeToggle.style.display = 'flex';
    if (gridZoomToggle) gridZoomToggle.style.display = 'flex';

    const showImg = document.getElementById('toggle-count-field').checked;
    const showJson = document.getElementById('toggle-json-count-field').checked;

    if (!showImg && !showJson) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    
    if (showImg) {
        imgDisplay.textContent = `🖼️ ${currentFiles.length} imgs`;
        imgDisplay.style.display = 'inline-block';
    } else {
        imgDisplay.style.display = 'none';
    }

    if (showJson) {
        let jCount = 0;
        currentFiles.forEach(f => {
            const base = f.name.substring(0, f.name.lastIndexOf('.')) || f.name;
            if (currentJsonFiles.has(base + '.json')) jCount++;
        });
        jsonDisplay.textContent = `📄 ${jCount} JSONs`;
        jsonDisplay.style.display = 'inline-block';
    } else {
        jsonDisplay.style.display = 'none';
    }
}

function toggleThumbPosition() {
    const detailView = document.getElementById('detail-view');
    const btn = document.getElementById('btn-layout');
    detailView.classList.toggle('thumb-left');

    if (detailView.classList.contains('thumb-left')) {
        btn.innerHTML = '⬒';
    } else {
        btn.innerHTML = '◧';
    }
}

/* ================================================================
   BLOCK 1C — GRID THUMBNAIL ZOOM (grid mode)
   Lets the user resize the grid items with a slider, independent of
   the browser window size. Adapted from the zoom system provided by
   the user (--thumb-size pattern) to this app's grid, which already
   uses CSS Grid with minmax() — so resizing is just one CSS variable.
   ================================================================ */
function updateGridThumbSize(val, skipSave = false) {
    if (window._gridThumbRAF) cancelAnimationFrame(window._gridThumbRAF);
    window._gridThumbRAF = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--grid-thumb-size', val + 'px');
        window._gridThumbRAF = null;
    });

    if (!skipSave) {
        gridThumbSize = parseInt(val, 10);
        saveSettingsToDB();
    }
}

document.addEventListener('click', (e) => { 
    const dropdownSettings = document.getElementById('settings-dropdown'); 
    const btnSettings = document.getElementById('btn-settings'); 
    if (dropdownSettings && dropdownSettings.classList.contains('open') && !dropdownSettings.contains(e.target) && !btnSettings.contains(e.target)) {
        dropdownSettings.classList.remove('open');
    }

    // The rename popup stays open while batch-rename selection mode is active,
    // so clicking checkboxes in the grid no longer closes it. It only closes
    // via Cancel, Confirm, or clicking the pencil button again.
    const dropdownRename = document.getElementById('rename-dropdown'); 
    const btnRename = document.getElementById('btn-rename-top'); 
    if (dropdownRename && dropdownRename.classList.contains('open') && !dropdownRename.contains(e.target) && !btnRename.contains(e.target) && !isRenameMode) {
        dropdownRename.classList.remove('open');
    }
    
    // Same fix for the batch tag popup: stays open during selection mode.
    const dropdownTag = document.getElementById('tag-dropdown'); 
    const btnTag = document.getElementById('btn-batch-tag'); 
    if (dropdownTag && dropdownTag.classList.contains('open') && !dropdownTag.contains(e.target) && !btnTag.contains(e.target) && !isTagMode) {
        dropdownTag.classList.remove('open');
    }
    
    const dropdownPath = document.getElementById('path-dropdown'); 
    const btnPath = document.getElementById('btn-path-label'); 
    if (dropdownPath && dropdownPath.classList.contains('open') && !dropdownPath.contains(e.target) && !btnPath.contains(e.target)) {
        dropdownPath.classList.remove('open');
    }

    const dropdownAutoRename = document.getElementById('autorename-dropdown');
    const btnAutoRename = document.getElementById('btn-autorename');
    if (dropdownAutoRename && dropdownAutoRename.classList.contains('open') && !dropdownAutoRename.contains(e.target) && !btnAutoRename.contains(e.target)) {
        dropdownAutoRename.classList.remove('open');
    }
});

let isDraggingRight = false;
let startX = 0;
let startWidth = 0;

window.addEventListener('DOMContentLoaded', async () => {
    // Load settings saved in IndexedDB (or keep the HTML defaults if nothing was saved)
    await loadSettingsFromDB();
    toggleExtraFields();
    toggleFilenameField();
    togglePathDisplay();
    togglePathIcon();
    updateGridCounters();

    const resizerRight = document.getElementById('resizer-right');
    const rightCol = document.getElementById('right-col');

    resizerRight.addEventListener('mousedown', (e) => {
        isDraggingRight = true;
        startX = e.clientX;
        startWidth = rightCol.getBoundingClientRect().width;

        resizerRight.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (isDraggingRight) {
            const deltaX = e.clientX - startX;
            let newWidth = startWidth - deltaX; 
            
            if (newWidth < 250) newWidth = 250;
            if (newWidth > window.innerWidth * 0.6) newWidth = window.innerWidth * 0.6; 
            
            rightCol.style.width = newWidth + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        isDraggingRight = false;
        resizerRight.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    });
});

/* ================================================================
   BLOCK 1B — BATCH SELECTION HELPERS (tag & rename checkboxes)
   ================================================================ */
const SELECTION_COUNT_MAP = { 'tag-checkbox': 'tag-selection-count', 'rename-checkbox': 'rename-selection-count' };

function selectAllCheckboxes(className) {
    document.querySelectorAll('.' + className).forEach(cb => cb.checked = true);
    updateSelectionCount(className);
}

function clearAllCheckboxes(className) {
    document.querySelectorAll('.' + className).forEach(cb => cb.checked = false);
    updateSelectionCount(className);
}

function updateSelectionCount(className) {
    const count = document.querySelectorAll('.' + className + ':checked').length;
    const el = document.getElementById(SELECTION_COUNT_MAP[className]);
    if (!el) return;
    el.textContent = `${count} image${count === 1 ? '' : 's'} selected`;
    el.style.display = count > 0 ? 'block' : 'none';
}

// Delegated listener: keeps the live counter accurate no matter how the grid re-renders.
document.addEventListener('change', (e) => {
    if (e.target.classList && e.target.classList.contains('tag-checkbox')) updateSelectionCount('tag-checkbox');
    if (e.target.classList && e.target.classList.contains('rename-checkbox')) updateSelectionCount('rename-checkbox');
});

/* ================================================================
   BLOCK 2 — DYNAMIC NOTES & LORAS
   ================================================================ */
function addNote(name = 'Note', value = '') {
    const container = document.getElementById('notes-container');
    const block = document.createElement('div'); 
    block.className = 'promptBlock note-block'; 
    const rmStyle = isEditing ? 'inline-block' : 'none';
    const readonlyAttr = isEditing ? '' : 'readonly';
    block.innerHTML = `
        <div class="promptTitle">
            <input type="text" class="note-title-input" value="${name}" ${readonlyAttr}>
            <div class="promptTitle-actions">
                <button class="copy-btn" onclick="copyText(this)" title="Copy">⧉</button>
                <button class="collapse-btn" onclick="toggleCollapse(this)">▼</button>
                 <button class="remove-btn" style="display:${rmStyle}; color:#ff6060; background:none; border:none; cursor:pointer; font-size:12px; margin-left:5px; padding:0 3px;" onclick="this.closest('.note-block').remove()" title="Remove Note">✖</button>
            </div>
        </div>
        <div class="collapsible-content">
            <textarea class="val-note-input" ${readonlyAttr} oninput="autoResize(this)">${value}</textarea>
        </div>`;
    container.appendChild(block); 
    setTimeout(() => autoResize(block.querySelector('textarea')), 10);
}

function addLora(value = '') {
    const container = document.getElementById('loras-container');
    const item = document.createElement('div');
    item.className = 'lora-item';
    const rmStyle = isEditing ? 'inline-block' : 'none';
    const readonlyAttr = isEditing ? '' : 'readonly';
    item.innerHTML = `
        <input type="text" class="lora-input" value="${value}" ${readonlyAttr} placeholder="LoRA name / weight">
        <button class="remove-btn" style="display:${rmStyle}; color:#ff6060; background:none; border:none; cursor:pointer; font-size:12px; margin-left:5px; padding:0 3px;" onclick="removeLora(this)" title="Remove LoRA">✖</button>
    `;
    container.appendChild(item);
    document.getElementById('loras-block').style.display = 'block';
}

function removeLora(btn) {
    btn.closest('.lora-item').remove();
    checkLorasVisibility();
}

function checkLorasVisibility() {
    const container = document.getElementById('loras-container');
    const block = document.getElementById('loras-block');
    if (!isEditing && container.children.length === 0) {
        block.style.display = 'none';
    } else {
        block.style.display = 'block';
    }
}

/* ================================================================
   BLOCK 3 — MANUAL EDITING CONTROL
   ================================================================ */
let isEditing = false;
const EDITABLE_FIELDS = ['val-pos','val-neg','val-cfg','val-steps','val-seed','val-sampler','val-ckpt','val-size'];

// Collapse/expand state for the fixed prompt blocks (Generation Data, LoRAs,
// Positive/Negative Prompt), persisted in IndexedDB. Once the user manually
// toggles a block, that state applies to every image from then on — it's a
// global UI preference, not something tied to whichever image is open.
let blockCollapsePrefs = {};
let gridThumbSize = 180;

function applyStoredCollapseState(blockId, defaultCollapsed) {
    const block = document.querySelector(`.promptBlock[data-block-id="${blockId}"]`);
    if (!block) return;
    const collapsed = Object.prototype.hasOwnProperty.call(blockCollapsePrefs, blockId) ? blockCollapsePrefs[blockId] : defaultCollapsed;
    setCollapseState(block, collapsed);
}

function persistBlockCollapse(blockId, collapsed) {
    blockCollapsePrefs[blockId] = collapsed;
    saveSettingsToDB();
}

function toggleManualEdit() {
    const btn = document.getElementById('btn-manual'); 
    const rightCol = document.getElementById('right-col');
    isEditing = !isEditing;
    if (isEditing) { 
        rightCol.classList.add('is-editing'); 
        setCollapseState(document.querySelector('.meta-table').closest('.promptBlock'), false); 
    } else { 
        rightCol.classList.remove('is-editing'); 
    }
    
    EDITABLE_FIELDS.forEach(id => { 
        const el = document.getElementById(id); 
        if (isEditing) el.removeAttribute('readonly'); 
        else el.setAttribute('readonly', 'true'); 
    });
    
    document.querySelectorAll('.note-title-input').forEach(el => { if (isEditing) el.removeAttribute('readonly'); else el.setAttribute('readonly', 'true'); });
    document.querySelectorAll('.val-note-input').forEach(el => { if (isEditing) el.removeAttribute('readonly'); else el.setAttribute('readonly', 'true'); });
    document.querySelectorAll('.lora-input').forEach(el => { if (isEditing) el.removeAttribute('readonly'); else el.setAttribute('readonly', 'true'); });
    
    document.getElementById('edit-controls').style.display = isEditing ? 'flex' : 'none';
    document.querySelectorAll('.remove-btn').forEach(b => b.style.display = isEditing ? 'inline-block' : 'none');
    
    checkLorasVisibility();

    if (isEditing) { 
        btn.textContent = 'Save to UI'; 
        btn.classList.add('edit-mode'); 
        showAlert(null); 
    } else { 
        btn.textContent = 'Edit'; 
        btn.classList.remove('edit-mode'); 
    }
}

function fillFields(d) {
    const posEl  = document.getElementById('val-pos');
    const negEl  = document.getElementById('val-neg');
    posEl.value  = d?.pos  ?? ''; negEl.value  = d?.neg  ?? '';
    document.getElementById('val-cfg').value = d?.cfg ?? ''; document.getElementById('val-steps').value = d?.steps ?? ''; document.getElementById('val-seed').value = d?.seed ?? '';
    document.getElementById('val-sampler').value = d?.sampler ?? ''; document.getElementById('val-ckpt').value = d?.ckpt ?? ''; document.getElementById('val-size').value = d?.size ?? '';
    autoResize(posEl); autoResize(negEl);

    // Process LoRAs
    document.getElementById('loras-container').innerHTML = '';
    let lorasText = d?.loras ?? '';
    if (lorasText) {
        let loraArr = lorasText.split(',').map(s => s.trim()).filter(s => s);
        loraArr.forEach(l => addLora(l));
    }
    checkLorasVisibility();

    // Process Notes
    document.getElementById('notes-container').innerHTML = '';
    if (d?.notes && Array.isArray(d.notes) && d.notes.length > 0) {
        d.notes.forEach((n, i) => {
            if (typeof n === 'string') {
                addNote(`Note ${i + 1}`, n);
            } else if (n && typeof n === 'object') {
                addNote(n.name || `Note ${i + 1}`, n.value || '');
            }
        });
    } else if (d?.note) {
        addNote('Note 1', typeof d.note === 'string' ? d.note : (d.note.value || ''));
    } else {
        addNote('Note', '');
    }
    
    // Collapse state for each fixed block: use whatever the user last set
    // (saved in IndexedDB, applies to every image) — only fall back to a
    // sensible default the very first time, before any preference exists.
    applyStoredCollapseState('neg', true);
    applyStoredCollapseState('pos', posEl.value.split(/\r\n|\r|\n/).length > 10);
    applyStoredCollapseState('meta', true);
    applyStoredCollapseState('loras', false);
    
    let srcName = d?.source || '';
    if (srcName.toLowerCase().includes('stable diffusion')) {
        srcName = 'Stable Diffusion';
    }

    const sourceBar = document.getElementById('sourceBar'); 
    const sourceText = document.getElementById('source-text');
    const btnReset = document.getElementById('btn-reset-json');
    
    sourceBar.className = '';
    if (btnReset) btnReset.style.display = 'none';

    if (srcName === 'json') {
        sourceText.textContent = 'JSON Sidecar';
        sourceBar.className = 'json-source';
        if (btnReset) btnReset.style.display = 'inline-block'; 
        
        if(!document.getElementById('alertBar').style.display || document.getElementById('alertBar').style.display === 'none') {
            sourceBar.style.display = 'block';
        }
    } else if (srcName) {
        sourceText.textContent = srcName;
        if(!document.getElementById('alertBar').style.display || document.getElementById('alertBar').style.display === 'none') {
            sourceBar.style.display = 'block';
        }
    } else { 
        sourceBar.style.display = 'none';
    }
}

// === RESCAN FUNCTION ===
async function resetPNGParameters() {
    const fileName = document.getElementById('file-name').value;
    if (!fileName) return;
    const fileItem = currentFiles.find(a => a.name === fileName);
    if (!fileItem?.file) {
        showAlert('❌ Original image not found in cache.', 'error');
        return;
    }

    const notesArray = Array.from(document.querySelectorAll('.note-block')).map(block => {
        return {
            name: block.querySelector('.note-title-input').value,
            value: block.querySelector('.val-note-input').value
        };
    }).filter(n => n.value.trim() !== '' || n.name.trim() !== 'Note');

    const lorasArray = Array.from(document.querySelectorAll('.lora-input')).map(inp => inp.value.trim()).filter(v => v !== '');
    const currentLoras = lorasArray.join(', ');

    showAlert('🔍 Scanning image...', 'info');

    try {
        const meta = await extractPNGMetadata(fileItem.file);
        if (meta) {
            fillFields({
                pos: meta.pos ?? '',
                neg: meta.neg ?? '',
                notes: notesArray.length > 0 ? notesArray : (meta.notes ?? []), 
                cfg: meta.cfg ?? '',
                steps: meta.steps ?? '',
                seed: meta.seed ?? '',
                sampler: meta.sampler ?? meta.scheduler ?? '',
                ckpt: meta.ckpt ?? meta.checkpoint ?? '',
                loras: currentLoras !== '' ? currentLoras : (meta.loras ?? ''), 
                size: meta.size ?? '',
                source: meta.source 
            });
            showAlert('✔ Parameters reloaded from image (Notes and Tags preserved). Remember to save.', 'success');
        } else {
            showAlert('⚠️ No generation metadata found in the image.', 'warn');
        }
    } catch (e) {
        console.error(e);
        showAlert('❌ Error trying to read original image.', 'error');
    }
}

// === DELETE IMAGE FUNCTION ===
async function deleteCurrentImage() {
    if (!currentHandle) return;
    const fname = document.getElementById('file-name').value;
    if (!fname) return;
    
    if (!confirm(`Are you sure you want to permanently delete the file:\n${fname}\n(and its JSON if it exists)?`)) return;

    try {
        await currentHandle.removeEntry(fname);
        
        // Try to delete the sidecar JSON
        const baseName = fname.substring(0, fname.lastIndexOf('.')) || fname;
        try { await currentHandle.removeEntry(baseName + '.json'); } catch(e) {}
        
        tagsPerFile.delete(fname);
        currentFiles = currentFiles.filter(f => f.name !== fname);
        currentJsonFiles.delete(baseName + '.json'); // Remove from counter
        
        showAlert('🗑️ File successfully deleted.', 'success');
        backToGrid();
        renderGrid();
    } catch (e) {
        console.error(e);
        showAlert('❌ Error deleting file. Check permissions.', 'error');
    }
}

/* ================================================================
   BLOCK 4A — COMFYUI + NOVELAI CUSTOM NODES PARSER
   ================================================================ */
(function () {
    function _txt(v) { return v === undefined || v === null ? '' : String(v); }
    function _nodeTitle(n) { return _txt((n && n._meta && n._meta.title) || (n && n.title) || ''); }
    function _widgets(n) { return Array.isArray(n && n.widgets_values) ? n.widgets_values : []; }
    function _isMuted(n) { return !!(n && (n.mode === 4 || n.mode === '4')); }

    function _hasComfyNAI(json) {
        if (!json || typeof json !== 'object') return false;
        for (const id in json) {
            const t = _txt(json[id]?.class_type);
            if (/^NovelAI(?:T2I|I2I|Parameters|Character|CharacterStack|RetrySettings|Token)$/i.test(t)) return true;
        }
        return false;
    }

    function _findNodes(json, re) {
        const out = [];
        for (const id in json) {
            if (re.test(_txt(json[id]?.class_type))) out.push({ id, node: json[id] });
        }
        return out;
    }

    function _firstNode(json, re) {
        return _findNodes(json, re).find(x => !_isMuted(x.node)) || null;
    }

    function _inputNode(json, val) {
        if (!Array.isArray(val)) return null;
        const id = _txt(val[0]);
        return id && json[id] ? { id, node: json[id] } : null;
    }

    function _resolveStr(json, val, depth, seen) {
        depth = depth || 0; seen = seen || {};
        if (depth > 20) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        const ref = _inputNode(json, val);
        if (!ref || seen[ref.id]) return '';
        seen[ref.id] = true;
        const n = ref.node, inp = n.inputs || {}, wv = _widgets(n);
        const all = _txt(n.class_type) + ' ' + _nodeTitle(n);
        if (/List of strings|String.*Concat|Concat|Join|Merge/i.test(all)) {
            let delim = inp.delimiter;
            if (delim === undefined || Array.isArray(delim)) delim = wv[wv.length - 1] ?? ' ';
            const keys = Object.keys(inp)
                .filter(k => /^(string|text|input)_?\d+$/i.test(k))
                .sort((a, b) => Number((a.match(/\d+/) || [9999])[0]) - Number((b.match(/\d+/) || [9999])[0]));
            return keys.map(k => _resolveStr(json, inp[k], depth + 1, { ...seen }).trim())
                .filter(Boolean).join(_txt(delim || ' ')).trim();
        }

        const direct = inp.value ?? inp.text ?? inp.prompt ?? inp.string ?? inp.caption ?? inp.positive ?? inp.negative ?? inp.uc;
        if (typeof direct === 'string') return direct;
        if (Array.isArray(direct)) return _resolveStr(json, direct, depth + 1, seen);
        const ws = wv.find(v => typeof v === 'string' && v.trim());
        if (ws) return ws;
        const linked = Object.keys(inp).filter(k => Array.isArray(inp[k]))
            .sort((a, b) => Number((a.match(/\d+/) || [9999])[0]) - Number((b.match(/\d+/) || [9999])[0]));
        for (const k of linked) {
            const r = _resolveStr(json, inp[k], depth + 1, { ...seen });
            if (r.trim()) return r;
        }
        return '';
    }

    function _displayModel(raw) {
        const s = _txt(raw).trim();
        const low = s.toLowerCase().replace(/[\s_]+/g, '-');
        if (/nai-diffusion-4-5-full|v4\.5.*4bde2a90/.test(low))    return 'NAI Diffusion 4.5 FULL';
        if (/nai-diffusion-4-5-curated|v4\.5.*c02d4f98/.test(low)) return 'NAI Diffusion 4.5 Curated';
        if (/nai-diffusion-4-full|v4.*37442fca/.test(low))          return 'NAI Diffusion 4.0 FULL';
        if (/nai-diffusion-4-curated|v4.*7abffa2a/.test(low))       return 'NAI Diffusion 4.0 Curated';
        return s ? s.replace(/[\\\/]+/g, '/').split('/').pop()
                    .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, '')
                    .replace(/_+/g, ' ').trim() : '';
    }

    function _parseCharactersAsNotes(json, positionMode) {
        const notes = [];
        const isRandom = /random/i.test(_txt(positionMode));
        _findNodes(json, /^NovelAICharacter$/i).forEach(({ node }) => {
            const inp = node.inputs || {}, wv = _widgets(node);
            let enabled = inp.enabled ?? wv[0] ?? true;
            if (enabled === false || enabled === 'false') return;
            let pos = _txt(inp.prompt    ?? wv[1] ?? '').trim();
            let neg = _txt(inp.negative  ?? wv[2] ?? '').trim();
            if (!pos && !neg) return;

            let label = '';
            if (!isRandom) {
                const col = _txt(inp.position_col ?? wv[3] ?? '').trim().toUpperCase();
                const row = _txt(inp.position_row ?? wv[4] ?? '').trim();
                if (col && row) label = `Character ${col}${row}`;
            }
            if (!label) label = `Character ${notes.length + 1}`;

            let value = '';
            if (pos) value += `Positive: ${pos}`;
            if (neg) value += (value ? '\n' : '') + `Negative: ${neg}`;

            notes.push({ name: label, value });
        });
        return notes;
    }

    window.parseComfyNovelAI = function(jsonStr) {
        let json;
        try { json = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr; } catch { return null; }

        if (Array.isArray(json?.nodes)) {
            const dict = {};
            json.nodes.forEach(n => { if (n?.id != null) dict[String(n.id)] = n; });
            json = dict;
        }

        if (!_hasComfyNAI(json)) return null;

        const main = _firstNode(json, /^NovelAI(?:T2I|I2I)$/i);
        const mainInp = main?.node?.inputs || {};
        const mainWv  = _widgets(main?.node);

        const pRef = _inputNode(json, mainInp.parameters) || _firstNode(json, /^NovelAIParameters$/i);
        const p    = pRef?.node?.inputs || {};
        const pWv  = _widgets(pRef?.node);
        const width  = p.width  ?? pWv[0] ?? '';
        const height = p.height ?? pWv[1] ?? '';
        const model  = p.model  ?? pWv[2] ?? '';
        const steps   = _txt(p.steps     ?? pWv[6]  ?? '');
        const cfg     = _txt(p.cfg_scale ?? p.scale ?? pWv[7] ?? '');
        const seed    = _txt(p.seed      ?? pWv[3]  ?? '');
        const sampler = _txt(p.sampler   ?? pWv[4]  ?? '');
        const scheduler = _txt(p.scheduler ?? p.noise_schedule ?? pWv[5] ?? '');
        const size    = (width && height) ? `${width} x ${height}` : '';

        let pos = _resolveStr(json, mainInp.prompt, 0, {});
        let neg = _resolveStr(json, mainInp.negative_prompt, 0, {});
        if (!pos && typeof mainWv[0] === 'string') pos = mainWv[0];
        if (!neg && typeof mainWv[1] === 'string') neg = mainWv[1];
        pos = pos.replace(/^parameters[\s\0]*/i, '').replace(/^\0+/, '').trim();
        neg = neg.replace(/^parameters[\s\0]*/i, '').replace(/^\0+/, '').trim();
        
        const stackRef  = _inputNode(json, mainInp.characters) || _firstNode(json, /^NovelAICharacterStack$/i);
        const stackInp  = stackRef?.node?.inputs || {};
        const stackWv   = _widgets(stackRef?.node);
        const stackMode = stackInp.position_mode ?? stackWv[0] ?? '';
        const notes = _parseCharactersAsNotes(json, stackMode);

        return {
            pos,
            neg,
            steps,
            cfg,
            seed,
            size,
            sampler,
            scheduler,
            ckpt:   _displayModel(model),
            loras:  '',
            notes,
            source: 'ComfyUI (NovelAI)',
        };
    };

    window._hasComfyNovelAINodes = _hasComfyNAI;
})();