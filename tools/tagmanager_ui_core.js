/* =========================================================================
   UI CORE & SYSTEM LOGIC - TAG MANAGER (NON-RECURSIVE, LIST SAVE)
   Handles resizers, modals, list rendering, renaming, replacing, and filters.
========================================================================= */

window.showGhostTagsInList = false;

/* Hidden-images state is scoped PER FOLDER (keyed by that folder's directory handle),
   instead of a single global set keyed only by the image's base filename.
   Previously, hiding an image in one dataset would also hide any image with the same
   base filename in a different dataset/subfolder (very common with numbered filenames
   like "0001.png"), and calling "Unhide All" while inside one folder wiped hidden state
   that belonged to a different folder entirely — which is why unhide could appear to
   "not bring images back". Each folder now gets its own independent hidden-images Set. */
window._hiddenImagesStoreMap = new Map();
window._defaultHiddenSet = new Set();
function getHiddenSetForHandle(handle) {
    if (!handle) return window._defaultHiddenSet;
    if (!window._hiddenImagesStoreMap.has(handle)) window._hiddenImagesStoreMap.set(handle, new Set());
    return window._hiddenImagesStoreMap.get(handle);
}
Object.defineProperty(window, 'hiddenImagesStore', {
    get() { return getHiddenSetForHandle(window.currentImagesHandle); },
    configurable: true
});

window.sortedActiveTags = window.sortedActiveTags || []; // Previne erros globais

window.rootHandle = null;
window.sub1Handles = new Map();
window.sub2Handles = new Map();
window.currentImagesHandle = null;

let imageFiles = []; 
let selectedIndices = new Set();

let masterTagSet = new Set(); 
let masterSelectedTags = new Set(); 
let masterSelectedGhostTags = new Set();
let activeSelectedTags = new Set();

let datasetConfig = {}; 
let pendingTagsStore = {}; 
window.filterMode = 'NONE'; 

/* === VARIAVEIS DA LUPA DE BUSCA UNIFICADA === */
window.imageNameFilter = '';
window.tagNameFilter = '';
window.presetTagNameFilter = '';

window.activeSearchMode = true;
window.masterSearchMode = true;
window.presetSearchMode = true;

window.imageFilterMode = 'ALL'; // ALL, TAGS, NL
window.cycleImageFilter = function() {
    const states = ['ALL', 'TAGS', 'NL'];
    const labels = { 'ALL': '🏷️ All', 'TAGS': '🏷️ Tags', 'NL': '📝 NL' };
    let idx = states.indexOf(window.imageFilterMode);
    idx = (idx + 1) % states.length;
    window.imageFilterMode = states[idx];
    
    const btn1 = document.getElementById('btn-img-filter-sel');
    if (btn1) btn1.textContent = labels[window.imageFilterMode];

    if (typeof window.applyFilters === 'function') window.applyFilters();
};

window.toggleSearchMode = function(context) {
    if (context === 'active') {
        window.activeSearchMode = !window.activeSearchMode;
        document.getElementById('btn-active-search-toggle').classList.toggle('active', window.activeSearchMode);
        window.filterActiveTagsByName(window.activeSearchMode ? document.getElementById('active-add-input').value : '');
        window.saveSetting('search-mode-active', window.activeSearchMode);
    } else if (context === 'master') {
        window.masterSearchMode = !window.masterSearchMode;
        document.getElementById('btn-master-search-toggle').classList.toggle('active', window.masterSearchMode);
        window.filterMasterTagsByName(window.masterSearchMode ? document.getElementById('master-add-input').value : '');
        window.saveSetting('search-mode-master', window.masterSearchMode);
    } else if (context === 'preset') {
        window.presetSearchMode = !window.presetSearchMode;
        document.getElementById('btn-preset-search-toggle').classList.toggle('active', window.presetSearchMode);
        window.filterPresetTagsByName(window.presetSearchMode ? document.getElementById('preset-add-input').value : '');
        window.saveSetting('search-mode-preset', window.presetSearchMode);
    }
};

/* === INDEXEDDB (GALLERY HOLDER COMPATIBILITY) === */
const dbName = 'GalleryDB';
const storeName = 'directories';

window.initDB = function() { 
    return new Promise((res, rej) => { 
        try {
            const req = indexedDB.open(dbName, 1); 
            req.onupgradeneeded = e => e.target.result.createObjectStore(storeName); 
            req.onsuccess = e => res(e.target.result); 
            req.onerror = e => rej(e.target.error); 
        } catch (err) { rej(err); }
    }); 
}

window.saveHandle = async function(n, h) { 
    try {
        const db = await window.initDB(); 
        return new Promise(r => { 
            const tx = db.transaction(storeName, 'readwrite'); 
            tx.objectStore(storeName).put(h, n); 
            tx.oncomplete = r; 
        }); 
    } catch (e) {}
}

window.getHandles = async function() { 
    try {
        const db = await window.initDB(); 
        return new Promise(r => { 
            const tx = db.transaction(storeName, 'readonly'); 
            const store = tx.objectStore(storeName); 
            const keysReq = store.getAllKeys(); 
            const valsReq = store.getAll(); 
            tx.oncomplete = () => { 
                const result = []; 
                for (let i = 0; i < keysReq.result.length; i++) { 
                    const name = keysReq.result[i]; 
                    if (!String(name).startsWith('path_')) result.push({ name, handle: valsReq.result[i] }); 
                } 
                r(result); 
            }; 
        }); 
    } catch (e) { return []; }
}

window.deleteHandle = async function(n) { 
    try {
        const db = await window.initDB(); 
        return new Promise(r => { 
            const tx = db.transaction(storeName, 'readwrite'); 
            tx.objectStore(storeName).delete(n); 
            tx.objectStore(storeName).delete('path_' + n); 
            tx.oncomplete = r; 
        }); 
    } catch (e) {}
}

/* === INDEXEDDB PARA CONFIGURAÇÕES DA INTERFACE (SETTINGS) === */
const settingsDbName = 'SettingsDB';
const settingsStoreName = 'settings';

window.initSettingsDB = function() {
    return new Promise((res, rej) => {
        try {
            const req = indexedDB.open(settingsDbName, 1);
            req.onupgradeneeded = e => {
                if (!e.target.result.objectStoreNames.contains(settingsStoreName)) {
                    e.target.result.createObjectStore(settingsStoreName, { keyPath: 'id' });
                }
            };
            req.onsuccess = e => res(e.target.result);
            req.onerror = e => rej(e.target.error);
        } catch (err) { rej(err); }
    });
};

window.saveSetting = async function(id, value) {
    try {
        const db = await window.initSettingsDB();
        return new Promise(r => {
            const tx = db.transaction(settingsStoreName, 'readwrite');
            tx.objectStore(settingsStoreName).put({ id: id, value: value });
            tx.oncomplete = () => r();
        });
    } catch (e) {}
};

window.getSetting = async function(id, defaultValue) {
    try {
        const db = await window.initSettingsDB();
        return new Promise(r => {
            const tx = db.transaction(settingsStoreName, 'readonly');
            const req = tx.objectStore(settingsStoreName).get(id);
            req.onsuccess = () => r(req.result !== undefined ? req.result.value : defaultValue);
            req.onerror = () => r(defaultValue);
        });
    } catch (e) { return defaultValue; }
};

window.loadSettings = async function() {
    // 1. Carrega Toggle Checkboxes
    const lastEdited = await window.getSetting('toggle-last-edited', true);
    const unsavedAlert = await window.getSetting('toggle-unsaved-alert', true);
    const formatSelect = await window.getSetting('toggle-format-select', false);
    const conflictWarn = await window.getSetting('toggle-conflict-warnings', true);
    const helpBtn = await window.getSetting('toggle-help-btn', true);

    // 2. Carrega Sliders de Tamanho
    const thumbSize = await window.getSetting('thumb-size', 70);
    const fontSize = await window.getSetting('font-size', 13);
    
    // 3. Carrega Larguras dos Painéis
    const colListWidth = await window.getSetting('col-list-width', '350px');
    const colToolsWidth = await window.getSetting('col-tools-width', '350px');
    const colPresetsWidth = await window.getSetting('col-presets-width', '250px');

    // 4. Carrega Toggles de Busca (Lupa) e de Autocomplete (Planeta/Caixa)
    const searchModeActive = await window.getSetting('search-mode-active', true);
    const searchModeMaster = await window.getSetting('search-mode-master', true);
    const searchModePreset = await window.getSetting('search-mode-preset', true);
    const autocompleteActive = await window.getSetting('autocomplete-used-only-active', false);
    const autocompleteMaster = await window.getSetting('autocomplete-used-only-master', false);
    const autocompleteReplace = await window.getSetting('autocomplete-used-only-replace', false);

    // Aplica Checkboxes
    if (document.getElementById('toggle-last-edited')) document.getElementById('toggle-last-edited').checked = lastEdited;
    if (document.getElementById('toggle-unsaved-alert')) document.getElementById('toggle-unsaved-alert').checked = unsavedAlert;
    if (document.getElementById('toggle-format-select')) document.getElementById('toggle-format-select').checked = formatSelect;
    if (document.getElementById('toggle-conflict-warnings')) document.getElementById('toggle-conflict-warnings').checked = conflictWarn;
    if (document.getElementById('toggle-help-btn')) document.getElementById('toggle-help-btn').checked = helpBtn;

    // Aplica Sliders
    if (document.getElementById('thumb-slider')) document.getElementById('thumb-slider').value = thumbSize;
    if (document.getElementById('font-slider')) document.getElementById('font-slider').value = fontSize;
    window.updateThumbSize(thumbSize, true);
    window.updateEditorFontSize(fontSize, true);

    // Aplica Larguras
    const colList = document.getElementById('col-list');
    const colTools = document.getElementById('col-tools');
    const colPresets = document.getElementById('col-presets');
    if (colList) colList.style.width = colListWidth;
    if (colTools) colTools.style.width = colToolsWidth;
    if (colPresets) colPresets.style.width = colPresetsWidth;

    // Dispara as funções visuais silenciosamente
    window.enableConflictWarnings = conflictWarn;
    window.toggleLastEdited(true);
    window.unsavedAlertEnabled = unsavedAlert;
    window.toggleFormatSelect(true);
    window.toggleHelpBtn(true);
    if (typeof window.updateUnsavedChangesUI === 'function') window.updateUnsavedChangesUI();

    // Aplica Toggles de Busca (Lupa)
    window.activeSearchMode = searchModeActive;
    window.masterSearchMode = searchModeMaster;
    window.presetSearchMode = searchModePreset;
    if (document.getElementById('btn-active-search-toggle')) document.getElementById('btn-active-search-toggle').classList.toggle('active', searchModeActive);
    if (document.getElementById('btn-master-search-toggle')) document.getElementById('btn-master-search-toggle').classList.toggle('active', searchModeMaster);
    if (document.getElementById('btn-preset-search-toggle')) document.getElementById('btn-preset-search-toggle').classList.toggle('active', searchModePreset);

    // Aplica Toggles de Autocomplete (Planeta / Caixa de Usados)
    if (window.autocompleteUsedOnly) {
        window.autocompleteUsedOnly.active = autocompleteActive;
        window.autocompleteUsedOnly.master = autocompleteMaster;
        window.autocompleteUsedOnly.replace = autocompleteReplace;
    }
    if (typeof window.applyAutocompleteButtonState === 'function') {
        window.applyAutocompleteButtonState('active');
        window.applyAutocompleteButtonState('master');
        window.applyAutocompleteButtonState('replace');
    }
};

/* === ON LOAD === */
window.addEventListener('DOMContentLoaded', async () => {
    try {
        await window.loadSettings(); 
        window.renderPresetTags();
        await window.updateSelect();
        const handles = await window.getHandles();
        if (handles.length > 0) {
            const h = handles[0].handle;
            if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') {
                document.getElementById('dir-list').value = handles[0].name;
                window.rootHandle = h;
                document.getElementById('btn-save-folder').style.display = 'none';
                document.getElementById('btn-remove').style.display = 'inline-block';
                document.getElementById('current-folder-display').textContent = `📂 ${h.name}`;
                window.loadGallery(h);
            }
        }
    } catch (e) {}
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
    
    if (window.location.protocol === 'file:') {
        const fileWarning = document.getElementById('file-protocol-warning');
        if (fileWarning) fileWarning.style.display = 'block';
    }
};

/* === IMAGE SLIDER SIZE === */
let _thumbSizeRAF = null;
window.updateThumbSize = function(val, skipSave = false) {
    // Throttle via requestAnimationFrame: arrastar o slider dispara muitos eventos
    // 'input' seguidos, e cada um agora recalcula a altura (proporção real) de várias
    // imagens da lista — isso pode atrasar o navegador, que só repinta a bolinha do
    // slider depois do reflow. Aplicando no máximo 1 atualização por frame, o slider
    // acompanha o mouse sem "voltar" sozinho.
    if (_thumbSizeRAF) cancelAnimationFrame(_thumbSizeRAF);
    _thumbSizeRAF = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--thumb-size', val + 'px');
        _thumbSizeRAF = null;
    });
    if (!skipSave) window.saveSetting('thumb-size', val);
};

/* === EDITOR (TAGS/NL) FONT SIZE SLIDER === */
window.updateEditorFontSize = function(val, skipSave = false) {
    document.documentElement.style.setProperty('--editor-font-size', val + 'px');
    if (!skipSave) window.saveSetting('font-size', val);
};

/* === RESIZER OPTIMIZATION (4 COLUMNS SUPPORT) === */
/* === RESIZER OPTIMIZATION (4 COLUMNS SUPPORT) === */
function setupResizers() {
    let isDraggingLeft = false;
    let isDraggingRight = false;
    let isDraggingPresets = false;
    let rafPending = false;

    // 1. Variáveis para capturar o estado inicial no momento do clique (mousedown)
    let startX = 0;
    let startWidthList = 0;
    let startWidthTools = 0;
    let startWidthPresets = 0;

    const resizerLeft = document.getElementById('resizer-left');
    const resizerRight = document.getElementById('resizer-right');
    const resizerPresets = document.getElementById('resizer-presets');
    
    const colList = document.getElementById('col-list');
    const colTools = document.getElementById('col-tools');
    const colPresets = document.getElementById('col-presets');

    // 2. Modificando os listeners de clique para gravar de onde o mouse e o painel estão partindo
    if(resizerLeft) {
        resizerLeft.addEventListener('mousedown', (e) => { 
            isDraggingLeft = true; 
            startX = e.clientX;
            startWidthList = colList.getBoundingClientRect().width;
            document.body.classList.add('is-resizing'); 
        });
    }
    if(resizerRight) {
        resizerRight.addEventListener('mousedown', (e) => { 
            isDraggingRight = true; 
            startX = e.clientX;
            startWidthTools = colTools.getBoundingClientRect().width;
            document.body.classList.add('is-resizing'); 
        });
    }
    if(resizerPresets) {
        resizerPresets.addEventListener('mousedown', (e) => { 
            isDraggingPresets = true; 
            startX = e.clientX;
            startWidthPresets = colPresets.getBoundingClientRect().width;
            document.body.classList.add('is-resizing'); 
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingLeft && !isDraggingRight && !isDraggingPresets) return;
        if (rafPending) return;
        
        rafPending = true;
        requestAnimationFrame(() => {
            // 3. Calculando o Delta (a diferença exata entre a posição atual do mouse e a inicial)
            const deltaX = e.clientX - startX;

            if (isDraggingLeft && colList) {
                // Aplica o movimento em cima da largura que o painel já tinha
                let newWidth = startWidthList + deltaX;
                if (newWidth < 200) newWidth = 200;
                if (newWidth > window.innerWidth * 0.45) newWidth = window.innerWidth * 0.45;
                colList.style.width = newWidth + 'px';
            }
            if (isDraggingRight && colTools) {
                // Na direita, arrastar para a esquerda (movimento negativo) aumenta o painel
                let newWidth = startWidthTools - deltaX;
                if (newWidth < 200) newWidth = 200;
                colTools.style.width = newWidth + 'px';
            }
            if (isDraggingPresets && colPresets && colTools) {
                let newWidth = startWidthPresets - deltaX;
                if (newWidth < 150) newWidth = 150;
                colPresets.style.width = newWidth + 'px';
            }
            rafPending = false;
        });
    });

    document.addEventListener('mouseup', () => {
        if (isDraggingLeft || isDraggingRight || isDraggingPresets) {
            if (colList && colList.style.width) window.saveSetting('col-list-width', colList.style.width);
            if (colTools && colTools.style.width) window.saveSetting('col-tools-width', colTools.style.width);
            if (colPresets && colPresets.style.width) window.saveSetting('col-presets-width', colPresets.style.width);
        }
        
        isDraggingLeft = false;
        isDraggingRight = false;
        isDraggingPresets = false;
        document.body.classList.remove('is-resizing');
    });
}

/* === MODALS, UI TOGGLES E LAST EDITED TIME === */
window.toggleSettings = () => document.getElementById('settings-dropdown').classList.toggle('open');

window.unsavedAlertEnabled = true;
window.toggleUnsavedAlert = (skipSave = false) => {
    const checkbox = document.getElementById('toggle-unsaved-alert');
    if (checkbox) {
        window.unsavedAlertEnabled = checkbox.checked;
        if (!skipSave) window.saveSetting('toggle-unsaved-alert', checkbox.checked);
    }
    if (typeof window.updateUnsavedChangesUI === 'function') window.updateUnsavedChangesUI();
};

/* === UNSAVED CHANGES TRACKING ===
   Marks images as dirty whenever their content is modified without being written to disk yet,
   and drives the yellow "Changes without saving files (N)" banner above the 3 main panels. */
window.markDirty = function(imgs) {
    const arr = Array.isArray(imgs) ? imgs : [imgs];
    let changed = false;
    arr.forEach(img => { if (img && !img.dirty) { img.dirty = true; changed = true; } });
    if (changed) window.updateUnsavedChangesUI();
};

window.markClean = function(imgs) {
    const arr = Array.isArray(imgs) ? imgs : [imgs];
    let changed = false;
    arr.forEach(img => { if (img && img.dirty) { img.dirty = false; changed = true; } });
    if (changed) window.updateUnsavedChangesUI();
};

window.updateUnsavedChangesUI = function() {
    const bar = document.getElementById('unsaved-changes-alert');
    if (!bar) return;
    const hasUnsaved = (typeof imageFiles !== 'undefined' ? imageFiles : []).some(img => img.dirty && !img.hidden);
    if (!window.unsavedAlertEnabled || !hasUnsaved) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'block';
    bar.innerHTML = `<span style="color:#ffd040;margin:0 6px;font-size:14px;line-height:1;">⚠️</span> You have unsaved changes — remember to save <span style="color:#ffd040;margin:0 6px;font-size:14px;line-height:1;">⚠️</span>`;
};

/* === SHARED FILE WRITE UTILITY ===
   Single place that actually writes an image's tag/caption content to disk (.txt or .json),
   used by every feature that saves (replace tag, NL edit, convert to NL, save selected/all, batch tagger). */
window.saveImageToDisk = async function(img) {
    if (!img || !img.parentDirHandle) {
        console.error("saveImageToDisk: missing image or parentDirHandle", img);
        if (window.showAlert) window.showAlert(`❌ Could not save "${img && img.name ? img.name : 'file'}": no folder handle available.`, 'error');
        return false;
    }
    try {
        // BUGFIX: writes were attempted without re-checking permission. Browsers can silently
        // revoke a directory's readwrite permission mid-session (tab backgrounded, long idle,
        // etc.), which made getFileHandle()/createWritable() throw and the whole save fail
        // with nothing but a console.error — invisible to the user, looking like a random
        // "edit sometimes fails". We now re-request permission first, and always alert on failure.
        if ((await img.parentDirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
            const granted = await img.parentDirHandle.requestPermission({ mode: 'readwrite' });
            if (granted !== 'granted') {
                console.error("Write permission denied while saving", img.name);
                if (window.showAlert) window.showAlert(`❌ Write permission denied for "${img.name}". The edit was NOT saved to disk.`, 'error');
                return false;
            }
        }

        const formatToUse = img.ext || 'txt';
        const fileName = formatToUse === 'json' ? img.baseName + '.json' : img.baseName + '.txt';
        const contentToSave = formatToUse === 'json'
            ? JSON.stringify({ tags: img.content }, null, 2)
            : img.content;

        const fileHandle = await img.parentDirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(contentToSave);
        await writable.close();

        if (typeof currentJsonFiles !== 'undefined' && formatToUse === 'json') currentJsonFiles.add(fileName);
        window.markClean(img);
        return true;
    } catch (e) {
        console.error("Failed to save", img.name, e);
        if (window.showAlert) window.showAlert(`❌ Failed to save "${img.name}" (${e.message || 'unknown error'}). Check console.`, 'error');
        return false;
    }
};

window.toggleFormatSelect = (skipSave = false) => {
    const isChecked = document.getElementById('toggle-format-select').checked;
    document.getElementById('topbar-save-format').style.display = isChecked ? 'inline-block' : 'none';
    if (!skipSave) window.saveSetting('toggle-format-select', isChecked);
};

window.toggleHelpBtn = (skipSave = false) => {
    const isChecked = document.getElementById('toggle-help-btn').checked;
    document.getElementById('btn-help').style.display = isChecked ? 'inline-block' : 'none';
    if (!skipSave) window.saveSetting('toggle-help-btn', isChecked);
};

window.enableConflictWarnings = true;
window.toggleConflictWarnings = function(skipSave = false) {
    const checkbox = document.getElementById('toggle-conflict-warnings');
    if (checkbox) {
        window.enableConflictWarnings = checkbox.checked;
        if (!skipSave) window.saveSetting('toggle-conflict-warnings', checkbox.checked);
    }
    
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderPresetTags === 'function') window.renderPresetTags();
};

window.toggleLastEdited = function(skipSave = false) {
    const checkbox = document.getElementById('toggle-last-edited');
    const display = document.getElementById('last-edited-display');
    if (checkbox && display) {
        display.style.display = checkbox.checked ? 'block' : 'none';
        if (!skipSave) window.saveSetting('toggle-last-edited', checkbox.checked);
    }
};

window.updateLastEditedUI = function() {
    const display = document.getElementById('last-edited-display');
    if (display) {
        display.textContent = datasetConfig.lastEdited ? `Last edited: ${datasetConfig.lastEdited}` : "Last edited: Never";
    }
};

window.markDatasetEdited = function() {
    datasetConfig.lastEdited = new Date().toLocaleString();
    window.updateLastEditedUI();
    const handle = window.currentImagesHandle || window.rootHandle;
    if (handle) saveDatasetConfig(handle);
};

window.showHelp = () => document.getElementById('modal-help').classList.add('active');
window.closeModal = (id) => document.getElementById(id).classList.remove('active');

window.openModal = function(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('active');
    if (id === 'modal-image' && typeof window.resetImageZoom === 'function') window.resetImageZoom();
};

/* === IMAGE POPOUT ZOOM & PAN === */
(function() {
    let scale = 1, tx = 0, ty = 0;
    let isPanning = false, panStartX = 0, panStartY = 0;
    const MIN_ZOOM = 1, MAX_ZOOM = 8;

    function applyTransform() {
        const img = document.getElementById('image-popout');
        const wrapper = document.getElementById('image-zoom-wrapper');
        const display = document.getElementById('zoom-level-display');
        if (img) img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
        if (display) display.textContent = Math.round(scale * 100) + '%';
        if (wrapper) wrapper.classList.toggle('zoomed', scale > 1);
    }

    window.resetImageZoom = function() {
        scale = 1; tx = 0; ty = 0;
        applyTransform();
    };

    window.zoomImagePopout = function(delta) {
        scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale + delta));
        if (scale === MIN_ZOOM) { tx = 0; ty = 0; }
        applyTransform();
    };

    window.addEventListener('DOMContentLoaded', () => {
        const wrapper = document.getElementById('image-zoom-wrapper');
        const img = document.getElementById('image-popout');
        if (!wrapper || !img) return;

        wrapper.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.3 : -0.3;
            scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale + delta));
            if (scale === MIN_ZOOM) { tx = 0; ty = 0; }
            applyTransform();
        }, { passive: false });

        wrapper.addEventListener('mousedown', (e) => {
            if (scale <= MIN_ZOOM) return;
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

        img.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            window.resetImageZoom();
        });
    });
})();

document.addEventListener('click', (e) => {
    const dropdownSettings = document.getElementById('settings-dropdown');
    const btnSettings = document.getElementById('btn-settings');
    if (dropdownSettings && dropdownSettings.classList.contains('open') && !dropdownSettings.contains(e.target) && !btnSettings.contains(e.target)) dropdownSettings.classList.remove('open');

    const ddReplace = document.getElementById('replace-dropdown');
    if (ddReplace && ddReplace.classList.contains('open') && !ddReplace.contains(e.target) && !e.target.closest('.btn-replace')) ddReplace.classList.remove('open');

    const ddRename = document.getElementById('rename-dropdown');
    if (ddRename && ddRename.classList.contains('open') && !ddRename.contains(e.target) && !e.target.closest('.btn-save-local')) ddRename.classList.remove('open');

    const ddClone = document.getElementById('clone-dropdown');
    if (ddClone && ddClone.classList.contains('open') && !ddClone.contains(e.target) && !e.target.closest('.btn-save-local')) ddClone.classList.remove('open');
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


/* === DIRECTORY SELECTION SYSTEM === */

window.updateSelect = async function() {
    const list = document.getElementById('dir-list'); 
    if (!list) return;
    list.innerHTML = '<option value="">Saved directories...</option>';
    const handles = await window.getHandles(); 
    handles.forEach(h => { 
        const opt = document.createElement('option'); 
        opt.value = h.name; 
        opt.textContent = h.name; 
        list.appendChild(opt); 
    });
}

window.loadTemporaryFolder = async function() { 
    try { 
        const dh = await window.showDirectoryPicker({ mode: 'readwrite' }); 
        window.rootHandle = dh;
        
        const handles = await window.getHandles();
        const exists = handles.some(h => h.name === dh.name);
        
        document.getElementById('dir-list').value = exists ? dh.name : "";
        document.getElementById('btn-save-folder').style.display = exists ? 'none' : 'inline-block';
        document.getElementById('btn-remove').style.display = exists ? 'inline-block' : 'none';
        document.getElementById('current-folder-display').textContent = `📂 ${dh.name}`;
        
        window.loadGallery(dh); 
    } catch (e) { if (e.name !== 'AbortError') window.showAlert('Permission error.', 'error'); } 
}

window.saveFolderToList = async function() {
    if (!window.rootHandle) return;
    await window.saveHandle(window.rootHandle.name, window.rootHandle);
    await window.updateSelect();
    document.getElementById('dir-list').value = window.rootHandle.name;
    
    document.getElementById('btn-save-folder').style.display = 'none';
    document.getElementById('btn-remove').style.display = 'inline-block';
    window.showAlert('Folder added to saved list!', 'success');
}

window.removeDirectory = async function() { 
    if (!window.rootHandle) return; 
    await window.deleteHandle(window.rootHandle.name); 
    await window.updateSelect();
    
    document.getElementById('dir-list').value = "";
    document.getElementById('btn-save-folder').style.display = 'inline-block';
    document.getElementById('btn-remove').style.display = 'none';
    
    window.showAlert('Folder removed from saved list.', 'info');
}

window.loadSelectedDirectory = async function() {
    const name = document.getElementById('dir-list').value; 
    if (!name) return; 
    const handles = await window.getHandles();
    const h = handles.find(x => x.name === name)?.handle;
    if (h) { 
        if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') await h.requestPermission({ mode: 'readwrite' }); 
        
        window.rootHandle = h;
        document.getElementById('btn-save-folder').style.display = 'none';
        document.getElementById('btn-remove').style.display = 'inline-block';
        document.getElementById('current-folder-display').textContent = `📂 ${h.name}`;
        
        window.loadGallery(h); 
    }
}

/* === MULTI-LEVEL DIRECTORY LOADING (NON-RECURSIVE) === */

window.refreshDataset = async function() {
    if (!window.currentImagesHandle && !window.rootHandle) return;
    const selectedBaseNames = Array.from(selectedIndices).map(i => imageFiles[i].baseName);
    
    const val2 = document.getElementById('sub-dir-2') ? document.getElementById('sub-dir-2').value : '';
    const val1 = document.getElementById('sub-dir-1') ? document.getElementById('sub-dir-1').value : '';

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

window.loadGallery = async function(dirHandle) {
    window.rootHandle = dirHandle;
    window.currentImagesHandle = dirHandle;
    window.sub1Handles.clear();
    if(window.sub2Handles) window.sub2Handles.clear();
    
    document.getElementById('btn-refresh').style.display = 'inline-block';

    const sel1 = document.getElementById('sub-dir-1');
    const sel2 = document.getElementById('sub-dir-2');
    sel1.style.display = 'none';
    sel2.style.display = 'none';

    await loadDatasetConfig(dirHandle);
    await loadPendingTagsStore(dirHandle);

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
    await loadPendingTagsStore(window.currentImagesHandle);

    imageFiles = []; masterTagSet.clear(); masterSelectedTags.clear(); activeSelectedTags.clear(); selectedIndices.clear();
    let configNeedsSave = false;

    for await (const entry of window.currentImagesHandle.values()) {
        if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
            configNeedsSave = await processSingleImage(entry, window.currentImagesHandle, configNeedsSave);
        } else if (entry.kind === 'directory') {
            window.sub2Handles.set(entry.name, entry);
        }
    }

    if (configNeedsSave) await saveDatasetConfig(window.currentImagesHandle);

    if (window.sub2Handles.size > 0) {
        sel2.style.display = 'inline-block';
        for (let path of Array.from(window.sub2Handles.keys()).sort((a,b) => a.localeCompare(b))) {
            sel2.innerHTML += `<option value="${path}">${path}</option>`;
        }
    }

    finishLoading();
};

window.loadSubDir2 = async function() {
    const val = document.getElementById('sub-dir-2').value;

    if (!val) {
        await window.loadSubDir1();
        return;
    }

    const targetHandle = window.sub2Handles.get(val);
    window.currentImagesHandle = targetHandle;

    await loadDatasetConfig(targetHandle);
    await loadPendingTagsStore(targetHandle);

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
        configNeedsSave = true; 
    }

    // Native NL mode has been removed: any legacy pure-NL caption becomes a hybrid "NL:" tag,
    // and every image is now handled through the unified (hybrid) tags editor.
    if (type === 'nl') {
        if (content && content.trim()) {
            content = 'NL:' + content.trim().replace(/\n/g, ' ').replace(/,/g, '，');
        }
        type = 'tags';
        configNeedsSave = true; // persist the migration so it only runs once per image
    }
    datasetConfig[baseName] = { type: type, ext: ext };

    if (type === 'tags' && content.trim()) {
        content.split(',').forEach(t => { if(t.trim()) masterTagSet.add(t.trim()); });
    }
    
    const isHidden = window.hiddenImagesStore.has(baseName);
    imageFiles.push({ handle: entry, parentDirHandle: parentHandle, name: entry.name, baseName: baseName, url: URL.createObjectURL(file), content: content, type: type, hasFile: hasFile, ext: ext, pendingAdd: (pendingTagsStore[baseName] || []).slice(), hidden: isHidden, dirty: false });
    return configNeedsSave;
}

function finishLoading() {
    imageFiles.sort((a,b) => a.name.localeCompare(b.name));
    document.getElementById('list-count').textContent = imageFiles.length;
    
    window.updateLastEditedUI();
    window.updateTagsDatalist();
    window.updateUnhideButton();
    window.renderImageList(); 
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.checkBatchReadyState === "function") window.checkBatchReadyState();
    if (typeof window.updateUnsavedChangesUI === 'function') window.updateUnsavedChangesUI();
    
    if (imageFiles.length > 0) { 
        document.getElementById('btn-save-all').style.display = 'inline-block';
        document.getElementById('btn-save-active').style.display = 'inline-block';
        const activeFilter = document.getElementById('btn-active-tag-filter');
        if (activeFilter) activeFilter.style.display = 'inline-block';
        window.handleListClick(0, false, false); 
    } else {
        document.getElementById('btn-save-all').style.display = 'none';
        document.getElementById('btn-save-active').style.display = 'none';
        const activeFilter = document.getElementById('btn-active-tag-filter');
        if (activeFilter) activeFilter.style.display = 'none';
        if (typeof window.renderEditor === 'function') window.renderEditor();
    }
}

async function loadDatasetConfig(dirHandle) {
    try {
        const configHandle = await dirHandle.getFileHandle('_tagger_config.json');
        const file = await configHandle.getFile();
        datasetConfig = JSON.parse(await file.text());
    } catch(e) { datasetConfig = {}; }
    window.updateLastEditedUI();
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

async function loadPendingTagsStore(dirHandle) {
    try {
        const h = await dirHandle.getFileHandle('_pending_tags.json');
        const file = await h.getFile();
        pendingTagsStore = JSON.parse(await file.text());
    } catch(e) { pendingTagsStore = {}; }
}

async function savePendingTagsStore(dirHandle) {
    if (!dirHandle) return;
    try {
        Object.keys(pendingTagsStore).forEach(k => {
            if (!pendingTagsStore[k] || pendingTagsStore[k].length === 0) delete pendingTagsStore[k];
        });
        if (Object.keys(pendingTagsStore).length === 0) {
            try { await dirHandle.removeEntry('_pending_tags.json'); } catch(e) {}
            return;
        }
        const h = await dirHandle.getFileHandle('_pending_tags.json', { create: true });
        const writable = await h.createWritable();
        await writable.write(JSON.stringify(pendingTagsStore, null, 2));
        await writable.close();
    } catch(e) {}
}
window.savePendingTagsStore = savePendingTagsStore;

window.updateSelectedConfig = async function() {
    if (selectedIndices.size === 0) return;
    
    const newExt = document.getElementById('topbar-save-format').value;
    const changedImages = [];

    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        if (img.ext !== newExt) changedImages.push(img);
        img.type = 'tags';
        img.ext = newExt;
        datasetConfig[img.baseName] = { type: 'tags', ext: newExt };
    });

    if (changedImages.length > 0) window.markDirty(changedImages);
    window.markDatasetEdited();
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    window.refreshListStatus();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    window.showAlert("Configuration saved to catalog!", "success");
}

window.updateTagsDatalist = function() {
    const datalist = document.getElementById('all-tags-list');
    if(!datalist) return;
    datalist.innerHTML = '';
    Array.from(masterTagSet).filter(tag => !tag.startsWith('NL:')).sort().forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag; datalist.appendChild(opt);
    });
};

/* === IMAGE HIDING SYSTEM === */
window.hideSelectedImages = function() {
    if (selectedIndices.size === 0) return;

    let hiddenCount = 0;
    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        if (!img.hidden) {
            img.hidden = true;
            window.hiddenImagesStore.add(img.baseName);
            if (img.element) img.element.classList.remove('selected');
            hiddenCount++;
        }
    });

    window.updateUnhideButton();
    window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    window.updateListSelectionVisuals();

    window.showAlert(`Hid ${hiddenCount} image(s). Use 👁️‍🗨️ Unhide to restore.`, "success");
};

window.unhideAllImages = function() {
    let changed = false;
    imageFiles.forEach(img => {
        if (img.hidden) { img.hidden = false; changed = true; }
    });
    window.hiddenImagesStore.clear(); 
    if (changed) {
        window.updateUnhideButton();
        window.renderImageList();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.applyFilters === 'function') window.applyFilters();
        window.updateListSelectionVisuals();

        // If hiding earlier left nothing selected, the selection-actions toolbar (and its icons)
        // stayed invisible even after unhiding. Auto-select the first image so it reappears
        // immediately instead of requiring a manual refresh.
        if (selectedIndices.size === 0 && imageFiles.length > 0) {
            window.handleListClick(0, false, false);
        }
    }
};

window.updateUnhideButton = function() {
    const btn = document.getElementById('btn-unhide-all');
    const hasHidden = window.hiddenImagesStore.size > 0 || imageFiles.some(img => img.hidden);
    if (btn) btn.style.display = hasHidden ? 'inline-block' : 'none';
};

/* === FOCUS MODE (INVERSE OF HIDE) === */
window.enterFocusMode = function() {
    if (selectedIndices.size === 0) { window.showAlert("Select at least one image first!", "warn"); return; }

    const keepVisible = new Set(Array.from(selectedIndices).map(i => imageFiles[i].baseName));
    let hiddenCount = 0;

    imageFiles.forEach(img => {
        if (!keepVisible.has(img.baseName) && !img.hidden) {
            img.hidden = true;
            window.hiddenImagesStore.add(img.baseName);
            if (img.element) img.element.classList.remove('selected');
            hiddenCount++;
        }
    });

    window.updateUnhideButton();
    window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    window.updateListSelectionVisuals();

    window.showAlert(`Focus mode: hid ${hiddenCount} other image(s). Use 👁️‍🗨️ Unhide to restore.`, "success");
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
            const oldImgHandle = await img.parentDirHandle.getFileHandle(oldName);
            const oldImgFile = await oldImgHandle.getFile();
            const newImgHandle = await img.parentDirHandle.getFileHandle(newName, {create: true});
            const writableImg = await newImgHandle.createWritable();
            await writableImg.write(await oldImgFile.arrayBuffer());
            await writableImg.close();
            await img.parentDirHandle.removeEntry(oldName);

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
            if (pendingTagsStore[img.baseName]) {
                pendingTagsStore[finalBaseName] = pendingTagsStore[img.baseName];
                delete pendingTagsStore[img.baseName];
            }
            if (window.hiddenImagesStore.has(img.baseName)) {
                window.hiddenImagesStore.delete(img.baseName);
                window.hiddenImagesStore.add(finalBaseName);
            }
            img.name = newName; img.baseName = finalBaseName;
            renamedCount++;
        } catch(e) { console.error("Rename Error:", e); }
        count++;
    }

    if(renamedCount > 0) {
        window.markDatasetEdited();
        await savePendingTagsStore(window.currentImagesHandle);
        window.showAlert(`Renamed ${renamedCount} files!`, "success");
        await window.refreshDataset(); 
    }
}

/* === CLONE SYSTEM === */
window.openCloneModal = function() {
    if (selectedIndices.size === 0) { window.showAlert("Select at least one image first!", "warn"); return; }
    document.getElementById('clone-count-input').value = 1;
    document.getElementById('clone-dropdown').classList.add('open');
    document.getElementById('clone-count-input').focus();
    document.getElementById('clone-count-input').select();
}

window.confirmClone = async function() {
    if (selectedIndices.size === 0) { document.getElementById('clone-dropdown').classList.remove('open'); return; }

    const count = parseInt(document.getElementById('clone-count-input').value, 10);
    document.getElementById('clone-dropdown').classList.remove('open');
    if (!count || count < 1) return;

    const indices = Array.from(selectedIndices);
    let clonedCount = 0;

    const existingBaseNames = new Set(imageFiles.map(f => f.baseName));

    for (let idx of indices) {
        const img = imageFiles[idx];
        const oldExt = img.name.substring(img.name.lastIndexOf('.') + 1);

        for (let n = 1; n <= count; n++) {
            let newBaseName = `${img.baseName}_${n}`;
            let bump = 1;
            while (existingBaseNames.has(newBaseName)) {
                bump++;
                newBaseName = `${img.baseName}_${n}_${bump}`;
            }
            existingBaseNames.add(newBaseName);
            const newImgName = `${newBaseName}.${oldExt}`;

            try {
                const imgFile = await img.handle.getFile();
                const newImgHandle = await img.parentDirHandle.getFileHandle(newImgName, { create: true });
                const writableImg = await newImgHandle.createWritable();
                await writableImg.write(await imgFile.arrayBuffer());
                await writableImg.close();

                if (img.hasFile) {
                    const textFormat = img.ext || 'txt';
                    const oldTextName = `${img.baseName}.${textFormat}`;
                    const newTextName = `${newBaseName}.${textFormat}`;
                    try {
                        const oldTextHandle = await img.parentDirHandle.getFileHandle(oldTextName);
                        const oldTextFile = await oldTextHandle.getFile();
                        const newTextHandle = await img.parentDirHandle.getFileHandle(newTextName, { create: true });
                        const writableText = await newTextHandle.createWritable();
                        await writableText.write(await oldTextFile.arrayBuffer());
                        await writableText.close();
                    } catch (e) {}
                }

                if (datasetConfig[img.baseName]) {
                    datasetConfig[newBaseName] = { ...datasetConfig[img.baseName] };
                }
                clonedCount++;
            } catch (e) { console.error("Clone Error:", e); }
        }
    }

    if (clonedCount > 0) {
        await saveDatasetConfig(window.currentImagesHandle || window.rootHandle);
        window.markDatasetEdited();
        window.showAlert(`Cloned ${clonedCount} file(s)!`, "success");
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

    if (!oldTag || !newTag || oldTag === newTag) return;

    let replacedCount = 0;
    let indicesToProcess = replaceScope === 'active' ? Array.from(selectedIndices) : imageFiles.map((_, i) => i);
    let modifiedFiles = []; 

    for (const idx of indicesToProcess) {
        const img = imageFiles[idx];
        if (img.hidden) continue; 
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

    const savePromises = modifiedFiles.map(img => window.saveImageToDisk(img));
    
    await Promise.all(savePromises);
    if(replacedCount > 0) window.markDatasetEdited();
}

/* === FILTERS === */
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

    if (typeof window.applyFilters === 'function') window.applyFilters();
};

/* === IMAGE LIST RENDERING E SELEÇÃO === */
let lastSelectedIndex = 0;

window.handleListClick = function(index, shiftKey, ctrlKey) {
    if (shiftKey && selectedIndices.size > 0) {
        const start = Math.min(lastSelectedIndex, index), end = Math.max(lastSelectedIndex, index);
        selectedIndices.clear(); 
        for (let i = start; i <= end; i++) {
            if (imageFiles[i].element && imageFiles[i].element.style.display !== 'none') {
                selectedIndices.add(i);
            }
        }
    } else if (ctrlKey) {
        if (selectedIndices.has(index)) selectedIndices.delete(index); else selectedIndices.add(index);
        lastSelectedIndex = index;
    } else {
        if (selectedIndices.has(index) && selectedIndices.size === 1) {
            selectedIndices.clear();
        } else {
            selectedIndices.clear(); selectedIndices.add(index); lastSelectedIndex = index;
        }
    }
    activeSelectedTags.clear(); 
    window.updateListSelectionVisuals(); 
    if (typeof window.renderEditor === 'function') window.renderEditor();
}

window.renderImageList = function() {
    const listDiv = document.getElementById('image-list'); listDiv.innerHTML = '';
    imageFiles.forEach((img, index) => {
        if (img.hidden) {
            if (img.element) img.element.style.display = 'none';
            return;
        }

        const div = document.createElement('div');
        let currentExt = img.ext || 'txt';
        let typeBadge = img.hasFile ? (img.type === 'nl' ? `📝 NL (.${currentExt})` : `🏷️ Tags (.${currentExt})`) : 'Empty';
        const suggestCount = (img.pendingAdd && img.pendingAdd.length) ? img.pendingAdd.length : 0;
        const suggestBadge = suggestCount > 0 ? `<span class="suggest-badge">💡${suggestCount}</span>` : '';
        
        div.className = `list-item ${img.hasFile ? (img.type === 'nl' ? 'is-nl' : 'has-data') : ''}`;
        div.innerHTML = `
            <img src="${img.url}">
            <div class="list-item-info">
                <div class="list-item-name">${img.name}</div>
                <div class="list-item-status">${typeBadge}${suggestBadge}</div>
            </div>
        `;
        div.onclick = (e) => window.handleListClick(index, e.shiftKey, e.ctrlKey || e.metaKey);
        div.ondblclick = () => { document.getElementById('image-popout').src = img.url; window.openModal('modal-image'); };
        img.element = div; listDiv.appendChild(div);
    });
    
    // BUGFIX: this function rebuilds every .list-item element from scratch, which wipes out
    // the 'selected' class that was on the old elements. Any tag edit (add/remove/replace/etc.)
    // calls renderImageList() to refresh statuses, and without this line the currently active
    // image visually loses its blue highlight (and the selection toolbar hides) even though
    // `selectedIndices` itself was never touched — looking exactly like an accidental deselect.
    window.updateListSelectionVisuals();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    window.updateSuggestFilterVisibility();
}

/* === TYPABLE SEARCH FILTERS (IMAGES & ALL TAGS) === */
window.filterImagesByName = function(val) {
    window.imageNameFilter = (val || '').trim().toLowerCase();
    if (typeof window.applyFilters === 'function') window.applyFilters();
};

function applyTagNameFilterToDOM() {
    const container = document.getElementById('master-tag-list');
    if (!container) return;
    container.querySelectorAll('.master-tag-item').forEach(item => {
        const nameEl = item.querySelector('.tag-name');
        const text = (nameEl ? nameEl.textContent : item.textContent).toLowerCase();
        item.style.display = (!window.tagNameFilter || text.includes(window.tagNameFilter)) ? 'flex' : 'none';
    });
}

window.filterMasterTagsByName = function(val) {
    window.tagNameFilter = (val || '').trim().toLowerCase();
    applyTagNameFilterToDOM();
};

/* GHOST TAGS (BUTTON LOGIC) */
window.toggleSuggestFilterImg = function() {
    window.showGhostTagsInList = !window.showGhostTagsInList;
    
    masterSelectedTags.clear();
    masterSelectedGhostTags.clear();
    window.filterMode = 'NONE';
    document.querySelectorAll('.logic-btn').forEach(b => b.classList.remove('active'));
    if (typeof updateSelectionActions === 'function') updateSelectionActions();

    const btn = document.getElementById('btn-filter-suggest-img');
    if (btn) {
        btn.classList.toggle('active', window.showGhostTagsInList);
        if (window.showGhostTagsInList) {
            btn.style.color = '#00ff99';
            btn.style.borderColor = '#00aa66';
        } else {
            btn.style.color = '';
            btn.style.borderColor = '';
        }
    }
    
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.applyFilters === 'function') window.applyFilters();
};

window.updateSuggestFilterVisibility = function() {
    const btn = document.getElementById('btn-filter-suggest-img');
    const discardBtn = document.getElementById('btn-discard-suggestions');
    const anyPending = imageFiles.some(img => img.pendingAdd && img.pendingAdd.length > 0 && !img.hidden);

    if (btn) {
        if (!anyPending && window.showGhostTagsInList) {
            window.showGhostTagsInList = false;
            btn.classList.remove('active');
            btn.style.color = '';
            btn.style.borderColor = '';
        }
        btn.style.display = anyPending ? 'inline-flex' : 'none';
    }
    if (discardBtn) discardBtn.style.display = anyPending ? 'inline-flex' : 'none';
};

window.discardAllSuggestions = async function() {
    const anyPending = imageFiles.some(img => img.pendingAdd && img.pendingAdd.length > 0 && !img.hidden);
    if (!anyPending) return;

    if (!confirm("Discard ALL pending tag suggestions? This cannot be undone.")) return;

    imageFiles.forEach(img => { 
        if (!img.hidden) img.pendingAdd = []; 
    });
    
    pendingTagsStore = {};
    imageFiles.forEach(img => {
        if (img.pendingAdd && img.pendingAdd.length > 0) {
            pendingTagsStore[img.baseName] = img.pendingAdd;
        }
    });
    
    masterSelectedGhostTags.clear();

    const handle = window.currentImagesHandle || window.rootHandle;
    await savePendingTagsStore(handle);

    window.showGhostTagsInList = false;
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && window.renderEditor) window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();

    window.showAlert("All pending suggestions discarded.", "success");
};

window.updateListSelectionVisuals = function() {
    imageFiles.forEach((img, i) => {
        if (selectedIndices.has(i)) {
            if (img.element) img.element.classList.add('selected'); 
        } else {
            if (img.element) img.element.classList.remove('selected');
        }
    });
    const listActions = document.getElementById('list-selection-actions');
    if(listActions) listActions.style.display = selectedIndices.size > 0 ? 'flex' : 'none';
}

window.refreshListStatus = function() {
    imageFiles.forEach(img => {
        if(img.hasFile && img.element) {
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
        
        if (datasetConfig[img.baseName]) delete datasetConfig[img.baseName];
        if (pendingTagsStore[img.baseName]) { delete pendingTagsStore[img.baseName]; await savePendingTagsStore(window.currentImagesHandle); }
        if (window.hiddenImagesStore.has(img.baseName)) window.hiddenImagesStore.delete(img.baseName);
        
        window.markDatasetEdited();
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
            if (pendingTagsStore[img.baseName]) delete pendingTagsStore[img.baseName];
            if (window.hiddenImagesStore.has(img.baseName)) window.hiddenImagesStore.delete(img.baseName);
            deletedCount++;
        } catch(e) {}
    }
    
    if(deletedCount > 0) {
        window.markDatasetEdited();
        await savePendingTagsStore(window.currentImagesHandle);
        window.showAlert(`Deleted ${deletedCount} files.`, 'success');
        await window.refreshDataset();
    }
}

window.saveActiveSelectedImages = async function(silent = false) {
    if (!window.currentImagesHandle && !window.rootHandle || selectedIndices.size === 0) return;
    let savedCount = 0;
    const promises = Array.from(selectedIndices).map(async (idx) => {
        const img = imageFiles[idx];
        if (img.hasFile && img.dirty) {
            const ok = await window.saveImageToDisk(img);
            if (ok) savedCount++;
        }
    });
    await Promise.all(promises);
    if(savedCount > 0) window.markDatasetEdited();
    if(!silent) window.showAlert(savedCount > 0 ? `Saved ${savedCount} file(s) with pending changes.` : `No pending changes to save in the current selection.`);
}

window.saveAllImages = async function(silent = false) {
    if (!window.currentImagesHandle && !window.rootHandle || imageFiles.length === 0) return;
    let savedCount = 0;
    const promises = imageFiles.map(async (img) => {
        if (img.hasFile && !img.hidden && img.dirty) {
            const ok = await window.saveImageToDisk(img);
            if (ok) savedCount++;
        }
    });
    await Promise.all(promises);
    if(savedCount > 0) window.markDatasetEdited();
    if(!silent) window.showAlert(savedCount > 0 ? `Saved ${savedCount} file(s) with pending changes.` : `No pending changes to save.`);
}

/* === USER PRESET TAGS SYSTEM (INDEXEDDB COM DRAG & DROP E MULTI-SELEÇÃO) === */
const presetDbName = 'PresetTagsDB';
const presetStoreName = 'presets';
let presetSelectedTags = new Set();
let lastSelectedPresetIndex = 0;

window.initPresetDB = function() {
    return new Promise((res, rej) => {
        try {
            const req = indexedDB.open(presetDbName, 1);
            req.onupgradeneeded = e => {
                if (!e.target.result.objectStoreNames.contains(presetStoreName)) {
                    e.target.result.createObjectStore(presetStoreName, { keyPath: 'tag' });
                }
            };
            req.onsuccess = e => res(e.target.result);
            req.onerror = e => rej(e.target.error);
        } catch (err) { rej(err); }
    });
};

window.getPresetTags = async function() {
    try {
        const db = await window.initPresetDB();
        return new Promise(r => {
            const tx = db.transaction(presetStoreName, 'readonly');
            const store = tx.objectStore(presetStoreName);
            const req = store.getAll();
            tx.oncomplete = () => r(req.result.map(item => ({ tag: item.tag, category: item.category || 'Uncategorized' })));
        });
    } catch (e) { return []; }
};

window.savePresetTag = async function(tag, category = 'Uncategorized') {
    if (!tag) return;
    try {
        const db = await window.initPresetDB();
        return new Promise(r => {
            const tx = db.transaction(presetStoreName, 'readwrite');
            const req = tx.objectStore(presetStoreName).get(tag);
            req.onsuccess = () => {
                const existing = req.result;
                const finalCat = category !== 'Uncategorized' ? category : (existing ? existing.category || 'Uncategorized' : 'Uncategorized');
                tx.objectStore(presetStoreName).put({ tag: tag, category: finalCat });
            };
            tx.oncomplete = () => { r(); window.renderPresetTags(); };
        });
    } catch (e) {}
};

window.deletePresetTag = async function(tag) {
    try {
        const db = await window.initPresetDB();
        return new Promise(r => {
            const tx = db.transaction(presetStoreName, 'readwrite');
            tx.objectStore(presetStoreName).delete(tag);
            tx.oncomplete = () => { r(); window.renderPresetTags(); };
        });
    } catch (e) {}
};

window.createPresetCategory = function() {
    const catName = prompt("Name the new category:");
    if (catName && catName.trim()) {
        window.savePresetTag(`_sys_cat_${catName.trim()}`, catName.trim());
    }
};

window.togglePresetPanel = function() {
    const panel = document.getElementById('col-presets');
    const resizer = document.getElementById('resizer-presets');
    const btn = document.getElementById('btn-toggle-presets');
    
    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'flex';
        if(resizer) resizer.style.display = 'flex';
        btn.style.background = '#00aa66';
        btn.style.color = '#000';
        window.renderPresetTags();
    } else {
        panel.style.display = 'none';
        if(resizer) resizer.style.display = 'none';
        btn.style.background = 'transparent';
        btn.style.color = '#00ff99';
    }

    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
};

window.filterPresetTagsByName = function(val) {
    window.presetTagNameFilter = (val || '').trim().toLowerCase();
    const container = document.getElementById('preset-tag-list');
    if (!container) return;
    container.querySelectorAll('.master-tag-item').forEach(item => {
        const nameEl = item.querySelector('.tag-name');
        if (nameEl) {
            const text = nameEl.textContent.toLowerCase();
            item.style.display = (!window.presetTagNameFilter || text.includes(window.presetTagNameFilter)) ? 'flex' : 'none';
        }
    });
};

window.updatePresetSelectionActions = function() {
    const bar = document.getElementById('preset-selection-actions');
    if (bar) bar.style.display = presetSelectedTags.size > 0 ? 'flex' : 'none';
};

window.removeSelectedPresetTags = function() {
    if (presetSelectedTags.size === 0) return;
    if (confirm(`Remove ${presetSelectedTags.size} tags from presets?`)) {
        presetSelectedTags.forEach(tag => window.deletePresetTag(tag));
        presetSelectedTags.clear();
        window.updatePresetSelectionActions();
    }
};

window.addSelectedPresetTagsTo = function(target) {
    if (presetSelectedTags.size === 0) return;
    const tagsToAdd = Array.from(presetSelectedTags);
    const globalExt = document.getElementById('topbar-save-format').value;
    
    let targets = [];
    if (target === 'selected') {
        targets = Array.from(selectedIndices);
        if(targets.length === 0) { window.showAlert("No images selected on the left list.", "error"); return; }
    } else if (target === 'all') {
        targets = imageFiles.map((_, i) => i).filter(i => !imageFiles[i].hidden);
    }
    
    targets.forEach(idx => {
        if (imageFiles[idx].type === 'tags' || !imageFiles[idx].hasFile) {
            let currentTags = imageFiles[idx].content ? imageFiles[idx].content.split(',').map(t=>t.trim()).filter(t=>t) : [];
            tagsToAdd.forEach(tag => {
                if (!currentTags.includes(tag)) currentTags.push(tag);
            });
            imageFiles[idx].content = currentTags.join(', ');
            imageFiles[idx].hasFile = true;
            imageFiles[idx].type = 'tags';
            if(!imageFiles[idx].ext) imageFiles[idx].ext = globalExt;
        }
    });
    window.markDirty(targets.map(idx => imageFiles[idx]));
    
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    window.showAlert(`Added ${tagsToAdd.length} preset tags to ${targets.length} images.`);
};

window.renderPresetTags = async function() {
    const container = document.getElementById('preset-tag-list');
    if (!container) return;
    container.innerHTML = '';
    
    const items = await window.getPresetTags();
    
    const btnContainer = document.createElement('div');
    btnContainer.innerHTML = `<button onclick="window.createPresetCategory()" style="width: 100%; margin-bottom: 10px; background: #1a3a5c; color: #4db8ff; border: 1px solid #2a5a8c;">➕ New Category</button>`;
    btnContainer.style.padding = '10px 10px 0 10px';
    container.appendChild(btnContainer);

    if (items.length === 0) {
        container.innerHTML += '<div style="padding: 15px; text-align: center; color: #555; font-size: 11px;">No presets saved yet.</div>';
        return;
    }
    
    const categories = {};
    items.forEach(item => {
        if (!categories[item.category]) categories[item.category] = [];
        categories[item.category].push(item.tag);
    });
    
    let globalIndex = 0;
    let renderedPresetTags = [];
    
    Object.keys(categories).sort().forEach(cat => {
        const catDiv = document.createElement('div');
        catDiv.style.marginBottom = '5px';
        
        const header = document.createElement('div');
        header.innerHTML = `<span>📁 ${cat}</span> <span class="toggle-icon" style="font-size:10px;">▼</span>`;
        header.style.cssText = 'background: #222; padding: 8px 10px; font-weight: bold; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; border-top: 1px solid #333; border-bottom: 1px solid #111; color: #aaa; transition: 0.2s;';
        
        header.onclick = () => {
            const list = catDiv.querySelector('.preset-list');
            const isHidden = list.style.display === 'none';
            list.style.display = isHidden ? 'block' : 'none';
            header.querySelector('.toggle-icon').textContent = isHidden ? '▼' : '▶';
        };

        header.ondragover = (e) => { e.preventDefault(); header.style.background = '#0a3a5c'; header.style.color = '#fff'; };
        header.ondragleave = (e) => { header.style.background = '#222'; header.style.color = '#aaa'; };
        header.ondrop = async (e) => {
            e.preventDefault();
            header.style.background = '#222';
            header.style.color = '#aaa';
            const tagToMove = e.dataTransfer.getData('text/plain');
            if (tagToMove) {
                await window.savePresetTag(tagToMove, cat);
            }
        };

        catDiv.appendChild(header);
        
        const listDiv = document.createElement('div');
        listDiv.className = 'preset-list';
        listDiv.style.display = 'block';

        categories[cat].sort().forEach(tag => {
            if (tag.startsWith('_sys_cat_')) return;

            const currentIndex = globalIndex++;
            renderedPresetTags.push(tag);

            const item = document.createElement('div');
            item.className = 'master-tag-item';
            
            let isSelected = presetSelectedTags.has(tag);
            let statusHtml = '';
            let conflictsForThisTag = [];
            let similarsForThisTag = [];

            // ALERTA DE CONFLITO/SIMILARIDADE (SE ATIVADO NAS CONFIGURAÇÕES)
            if (isSelected && window.enableConflictWarnings) {
                item.classList.add('selected-master');
                if (typeof window.checkTagStatusWithActive === 'function') {
                    const status = window.checkTagStatusWithActive(tag);
                    conflictsForThisTag = status.conflicts;
                    similarsForThisTag = status.similars;

                    if (conflictsForThisTag.length > 0) {
                        item.classList.add('conflict');
                        statusHtml += `<span class="conflict-warning" title="Conflict with: ${conflictsForThisTag.join(', ')}">⚠️ Conflict: ${conflictsForThisTag.join(', ')}</span>`;
                    } else if (similarsForThisTag.length > 0) {
                        item.classList.add('similar');
                        statusHtml += `<span class="similar-warning" title="Similar/Redundant to: ${similarsForThisTag.join(', ')}">🟨 Similar: ${similarsForThisTag.join(', ')}</span>`;
                    }
                }
            } else if (isSelected) {
                item.classList.add('selected-master');
            }

            item.draggable = true;
            
            item.ondragstart = (e) => { 
                e.dataTransfer.setData('text/plain', tag); 
                item.style.opacity = '0.4';
            };
            item.ondragend = (e) => { 
                item.style.opacity = '1';
            };
            
            item.innerHTML = `
                <div style="display:flex; align-items:center; overflow:hidden; flex:1;">
                    <span class="tag-name" style="color: #00ff99; font-weight: bold;">${tag}</span>
                    ${statusHtml}
                </div>
            `;

            // EFEITO HOVER CONSULTANDO A ACTIVE LIST
            if (conflictsForThisTag.length > 0) {
                const warningSpan = item.querySelector('.conflict-warning');
                if(warningSpan) {
                    warningSpan.onmouseenter = () => {
                        conflictsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.add('glow-conflict');
                        });
                    };
                    warningSpan.onmouseleave = () => {
                        conflictsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.remove('glow-conflict');
                        });
                    };
                }
            }

            if (similarsForThisTag.length > 0) {
                const simSpan = item.querySelector('.similar-warning');
                if(simSpan) {
                    simSpan.onmouseenter = () => {
                        similarsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.add('glow-similar');
                        });
                    };
                    simSpan.onmouseleave = () => {
                        similarsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.remove('glow-similar');
                        });
                    };
                }
            }
            
            item.onclick = (e) => {
                if (e.target.classList.contains('conflict-warning') || e.target.classList.contains('similar-warning')) return; 

                if (e.shiftKey && presetSelectedTags.size > 0) {
                    const start = Math.min(lastSelectedPresetIndex, currentIndex), end = Math.max(lastSelectedPresetIndex, currentIndex);
                    presetSelectedTags.clear(); 
                    for (let i = start; i <= end; i++) presetSelectedTags.add(renderedPresetTags[i]);
                } else if (e.ctrlKey || e.metaKey) {
                    if (presetSelectedTags.has(tag)) presetSelectedTags.delete(tag); else presetSelectedTags.add(tag);
                    lastSelectedPresetIndex = currentIndex;
                } else {
                    if (presetSelectedTags.has(tag) && presetSelectedTags.size === 1) {
                        presetSelectedTags.clear();
                    } else {
                        presetSelectedTags.clear(); presetSelectedTags.add(tag); lastSelectedPresetIndex = currentIndex;
                    }
                }
                window.renderPresetTags(); 
                window.updatePresetSelectionActions();
            };

            listDiv.appendChild(item);
        });

        catDiv.appendChild(listDiv);
        container.appendChild(catDiv);
    });

    if (window.presetSearchMode) window.filterPresetTagsByName(document.getElementById('preset-add-input').value);
};

window.addPresetTagFromInput = function() {
    const input = document.getElementById('preset-add-input');
    if(!input) return;
    const tagString = input.value.trim();
    
    if (tagString) {
        const tags = tagString.split(',').map(t => t.trim()).filter(t => t);
        tags.forEach(t => window.savePresetTag(t, 'Uncategorized'));
        input.value = '';
    }
};