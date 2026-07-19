/* =========================================================================
   UI CORE & SYSTEM LOGIC
   Handles initialization, settings, resizers, file loading, modals.
========================================================================= */

/* ---------------------------------------------------------------------
   BUG FIX: <body onload="initSystem()"> in tag_manager.html was calling
   a function that did not exist anywhere in the codebase. That throws a
   ReferenceError on every page load, which is why settings never loaded
   (thumb size, font size, panel widths, search-mode toggles, Danbooru
   cache, conflict-warning toggle, etc.), the resizers never got wired up,
   and the "Saved directories" dropdown stayed empty. This restores it.
--------------------------------------------------------------------- */
window.initSystem = async function() {
    try {
        setupResizers();
        await window.loadSettings();
        await window.updateSelect();
    } catch (e) {
        console.error('initSystem failed:', e);
    }
};

window.toggleSearchMode = function(context) {
    if (context === 'active') {
        window.activeSearchMode = !window.activeSearchMode;
        document.getElementById('btn-active-search-toggle').classList.toggle('active', window.activeSearchMode);
        if(typeof window.filterActiveTagsByName === 'function') window.filterActiveTagsByName(window.activeSearchMode ? document.getElementById('active-add-input').value : '');
        window.saveSetting('search-mode-active', window.activeSearchMode);
    } else if (context === 'master') {
        window.masterSearchMode = !window.masterSearchMode;
        document.getElementById('btn-master-search-toggle').classList.toggle('active', window.masterSearchMode);
        if(typeof window.filterMasterTagsByName === 'function') window.filterMasterTagsByName(window.masterSearchMode ? document.getElementById('master-add-input').value : '');
        window.saveSetting('search-mode-master', window.masterSearchMode);
    } else if (context === 'preset') {
        window.presetSearchMode = !window.presetSearchMode;
        document.getElementById('btn-preset-search-toggle').classList.toggle('active', window.presetSearchMode);
        if(typeof window.filterPresetTagsByName === 'function') window.filterPresetTagsByName(window.presetSearchMode ? document.getElementById('preset-add-input').value : '');
        window.saveSetting('search-mode-preset', window.presetSearchMode);
    }
};

window.loadSettings = async function() {
    const lastEdited = await window.getSetting('toggle-last-edited', true);
    const unsavedAlert = await window.getSetting('toggle-unsaved-alert', true);
    const formatSelect = await window.getSetting('toggle-format-select', false);
    const conflictWarn = await window.getSetting('toggle-conflict-warnings', true);
    const helpBtn = await window.getSetting('toggle-help-btn', true);
    const favHighlight = await window.getSetting('toggle-fav-highlight', true);

    const thumbSize = await window.getSetting('thumb-size', 70);
    const fontSize = await window.getSetting('font-size', 13);
    
    const colListWidth = await window.getSetting('col-list-width', '350px');
    const colToolsWidth = await window.getSetting('col-tools-width', '350px');
    const colPresetsWidth = await window.getSetting('col-presets-width', '250px');

    const searchModeActive = await window.getSetting('search-mode-active', true);
    const searchModeMaster = await window.getSetting('search-mode-master', true);
    const searchModePreset = await window.getSetting('search-mode-preset', true);
    const autocompleteActive = await window.getSetting('autocomplete-used-only-active', false);
    const autocompleteMaster = await window.getSetting('autocomplete-used-only-master', false);
    const autocompleteReplace = await window.getSetting('autocomplete-used-only-replace', false);

    window.danbooruCache = await window.getSetting('danbooru_tag_cache', {});
    const danbooruCounts = await window.getSetting('toggle-danbooru-counts', false);
    window.showDanbooruCounts = danbooruCounts;
    if (document.getElementById('toggle-danbooru-counts')) document.getElementById('toggle-danbooru-counts').checked = danbooruCounts;

    const e621Setting = await window.getSetting('toggle-e621', false);
    const e621SfwSetting = await window.getSetting('toggle-e621-sfw', false);
    window.showE621 = e621Setting;
    window.showE621Sfw = e621SfwSetting;
    if (document.getElementById('toggle-e621')) document.getElementById('toggle-e621').checked = e621Setting;
    if (document.getElementById('toggle-e621-sfw')) document.getElementById('toggle-e621-sfw').checked = e621SfwSetting;

    if (document.getElementById('toggle-last-edited')) document.getElementById('toggle-last-edited').checked = lastEdited;
    if (document.getElementById('toggle-unsaved-alert')) document.getElementById('toggle-unsaved-alert').checked = unsavedAlert;
    if (document.getElementById('toggle-format-select')) document.getElementById('toggle-format-select').checked = formatSelect;
    if (document.getElementById('toggle-conflict-warnings')) document.getElementById('toggle-conflict-warnings').checked = conflictWarn;
    if (document.getElementById('toggle-help-btn')) document.getElementById('toggle-help-btn').checked = helpBtn;
    if (document.getElementById('toggle-fav-highlight')) document.getElementById('toggle-fav-highlight').checked = favHighlight;

    if (document.getElementById('thumb-slider')) document.getElementById('thumb-slider').value = thumbSize;
    if (document.getElementById('font-slider')) document.getElementById('font-slider').value = fontSize;
    window.updateThumbSize(thumbSize, true);
    window.updateEditorFontSize(fontSize, true);

    const colList = document.getElementById('col-list');
    const colTools = document.getElementById('col-tools');
    const colPresets = document.getElementById('col-presets');
    if (colList) colList.style.width = colListWidth;
    if (colTools) colTools.style.width = colToolsWidth;
    if (colPresets) colPresets.style.width = colPresetsWidth;

    window.enableConflictWarnings = conflictWarn;
    window.toggleLastEdited(true);
    window.unsavedAlertEnabled = unsavedAlert;
    window.toggleFormatSelect(true);
    window.toggleHelpBtn(true);
    window.toggleFavHighlight(true);
    if (typeof window.updateUnsavedChangesUI === 'function') window.updateUnsavedChangesUI();

    window.activeSearchMode = searchModeActive;
    window.masterSearchMode = searchModeMaster;
    window.presetSearchMode = searchModePreset;
    if (document.getElementById('btn-active-search-toggle')) document.getElementById('btn-active-search-toggle').classList.toggle('active', searchModeActive);
    if (document.getElementById('btn-master-search-toggle')) document.getElementById('btn-master-search-toggle').classList.toggle('active', searchModeMaster);
    if (document.getElementById('btn-preset-search-toggle')) document.getElementById('btn-preset-search-toggle').classList.toggle('active', searchModePreset);

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

window.toggleDanbooruCounts = function(skipSave = false) {
    const checkbox = document.getElementById('toggle-danbooru-counts');
    if (checkbox) {
        window.showDanbooruCounts = checkbox.checked;
        if (!skipSave) window.saveSetting('toggle-danbooru-counts', checkbox.checked);
    }
    
    if (window.showDanbooruCounts && masterTagSet.size > 0) {
        window.syncDanbooruTags(Array.from(masterTagSet));
    } else {
        if (typeof window.renderEditor === 'function') window.renderEditor();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    }
};

window.toggleE621 = function() {
    const checkbox = document.getElementById('toggle-e621');
    if (checkbox) {
        window.showE621 = checkbox.checked;
        window.saveSetting('toggle-e621', checkbox.checked);
    }
};

window.toggleE621Sfw = function() {
    const checkbox = document.getElementById('toggle-e621-sfw');
    if (checkbox) {
        window.showE621Sfw = checkbox.checked;
        window.saveSetting('toggle-e621-sfw', checkbox.checked);
    }
};

window.manualDanbooruSync = function() {
    if (!window.showDanbooruCounts) {
        window.showAlert("Enable Danbooru counts in settings first.", "warn");
        return;
    }
    window.syncDanbooruTags(Array.from(masterTagSet), true);
};

let _danbooruSyncActive = false;
window.syncDanbooruTags = async function(tags, force = false) {
    if (!window.showDanbooruCounts || _danbooruSyncActive) return;
    _danbooruSyncActive = true;
    
    const now = Date.now();
    const fifteenDays = 15 * 24 * 60 * 60 * 1000;
    
    let tagsToFetch = tags.filter(t => {
        if (t.startsWith('NL:')) return false;
        if (force) return true;
        const cached = window.danbooruCache[t];
        if (!cached) return true;
        if (now - cached.ts > fifteenDays) return true;
        return false;
    });

    if (tagsToFetch.length === 0) {
        if (force) window.showAlert("All dataset tags are up to date in cache!", "info");
        _danbooruSyncActive = false;
        return;
    }

    const chunkSize = 50;

    for (let i = 0; i < tagsToFetch.length; i += chunkSize) {
        if (!window.showDanbooruCounts) break;
        
        const chunk = tagsToFetch.slice(i, i + chunkSize);
        const query = chunk.map(t => encodeURIComponent(t.replace(/ /g, '_'))).join(',');
        
        try {
            const res = await fetch(`https://danbooru.donmai.us/tags.json?search[name_comma]=${query}`);
            if (res.ok) {
                const data = await res.json();
                
                chunk.forEach(t => {
                    window.danbooruCache[t] = { count: 0, ts: now };
                });

                data.forEach(dt => {
                    const tName = dt.name.replace(/_/g, ' ');
                    if(window.danbooruCache[tName]) {
                        window.danbooruCache[tName].count = parseInt(dt.post_count) || 0;
                    }
                });

                await window.saveSetting('danbooru_tag_cache', window.danbooruCache);
                
                if (typeof window.renderEditor === 'function') window.renderEditor();
                if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            }
        } catch(e) {}
        
        await new Promise(r => setTimeout(r, 1000));
    }
    
    _danbooruSyncActive = false;
};

window.updateThumbSize = function(val, skipSave = false) {
    if (window._thumbSizeRAF) cancelAnimationFrame(window._thumbSizeRAF);
    window._thumbSizeRAF = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--thumb-size', val + 'px');
        window._thumbSizeRAF = null;
    });
    if (!skipSave) window.saveSetting('thumb-size', val);
};

window.updateEditorFontSize = function(val, skipSave = false) {
    document.documentElement.style.setProperty('--editor-font-size', val + 'px');
    if (!skipSave) window.saveSetting('font-size', val);
};

function setupResizers() {
    let isDraggingLeft = false;
    let isDraggingRight = false;
    let isDraggingPresets = false;
    let rafPending = false;

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
            const deltaX = e.clientX - startX;

            if (isDraggingLeft && colList) {
                let newWidth = startWidthList + deltaX;
                if (newWidth < 200) newWidth = 200;
                if (newWidth > window.innerWidth * 0.45) newWidth = window.innerWidth * 0.45;
                colList.style.width = newWidth + 'px';
            }
            if (isDraggingRight && colTools) {
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

window.markDirty = function(imgs) {
    const arr = Array.isArray(imgs) ? imgs : [imgs];
    let changed = false;
    arr.forEach(img => { if (img && !img.dirty) { img.dirty = true; changed = true; } });
    if (changed && typeof window.updateUnsavedChangesUI === 'function') window.updateUnsavedChangesUI();
};

window.markClean = function(imgs) {
    const arr = Array.isArray(imgs) ? imgs : [imgs];
    let changed = false;
    arr.forEach(img => { if (img && img.dirty) { img.dirty = false; changed = true; } });
    if (changed && typeof window.updateUnsavedChangesUI === 'function') window.updateUnsavedChangesUI();
};

window.updateUnsavedChangesUI = function() {
    const bar = document.getElementById('unsaved-changes-alert');
    if (!bar) return;
    const hasUnsaved = (typeof imageFiles !== 'undefined' ? imageFiles : []).some(img => img.dirty);
    if (!window.unsavedAlertEnabled || !hasUnsaved) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'block';
    bar.innerHTML = `<span style="color:#ffd040;margin:0 6px;font-size:14px;line-height:1;">⚠️</span> You have unsaved changes — remember to save <span style="color:#ffd040;margin:0 6px;font-size:14px;line-height:1;">⚠️</span>`;
};

window.saveImageToDisk = async function(img) {
    if (!img || !img.parentDirHandle) {
        console.error("saveImageToDisk: missing image or parentDirHandle", img);
        if (window.showAlert) window.showAlert(`❌ Could not save "${img && img.name ? img.name : 'file'}": no folder handle available.`, 'error');
        return false;
    }
    try {
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

window.enableFavHighlight = true;
window.toggleFavHighlight = function(skipSave = false) {
    const checkbox = document.getElementById('toggle-fav-highlight');
    if (checkbox) {
        window.enableFavHighlight = checkbox.checked;
        if (!skipSave) window.saveSetting('toggle-fav-highlight', checkbox.checked);
    }
    if (!skipSave) {
        if (typeof window.renderEditor === 'function') window.renderEditor();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    }
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
    if (handle) window.saveDatasetConfig(handle);
};

window.showHelp = () => document.getElementById('modal-help').classList.add('active');
window.closeModal = (id) => document.getElementById(id).classList.remove('active');

window.openModal = function(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('active');
    if (id === 'modal-image' && typeof window.resetImageZoom === 'function') window.resetImageZoom();
};

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

window.refreshDataset = async function() {
    if (!window.currentImagesHandle && !window.rootHandle) return;
    const selectedBaseNames = Array.from(selectedIndices).map(i => imageFiles[i].baseName);
    
    const val2 = document.getElementById('sub-dir-2') ? document.getElementById('sub-dir-2').value : '';
    const val1 = document.getElementById('sub-dir-1') ? document.getElementById('sub-dir-1').value : '';

    // BUG FIX: sem este try/catch, qualquer erro no meio do reload (ex:
    // permissão perdida, arquivo bloqueado) falhava em SILÊNCIO — a lista
    // ficava travada com os dados antigos (parecia que Renomear/Clonar
    // "não atualizava a lista"), sem nenhum aviso na tela.
    try {
        if (val2 && document.getElementById('sub-dir-2').style.display !== 'none') { 
            await window.loadSubDir2(); 
        } else if (val1 && document.getElementById('sub-dir-1').style.display !== 'none') { 
            await window.loadSubDir1(); 
        } else if (window.rootHandle) { 
            await window.loadGallery(window.rootHandle); 
        }
    } catch (e) {
        console.error('refreshDataset failed:', e);
        if (window.showAlert) window.showAlert('Erro ao atualizar a lista: ' + (e.message || e), 'error');
        if (typeof window.renderImageList === 'function') window.renderImageList();
        return;
    }

    // BUG FIX: finishLoading() (chamado dentro do load acima) já auto-seleciona
    // o índice 0 sozinho. Sem limpar aqui antes de restaurar a seleção real,
    // essa seleção "extra" ficava somada — depois de Clone/Rename/Delete,
    // duas imagens ficavam selecionadas ao mesmo tempo e o editor mostrava
    // tags misturadas das duas, dando a impressão de que a lista não tinha
    // atualizado direito.
    selectedIndices.clear();
    imageFiles.forEach((img, i) => { if (selectedBaseNames.includes(img.baseName)) selectedIndices.add(i); });
    if(typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
    if(selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
    window.showAlert(`Refreshed! ${imageFiles.length} images loaded.`);
};

/* ---------------------------------------------------------------------
   BUG FIX: cada imagem carregada ganha uma blob URL via URL.createObjectURL,
   mas ela nunca era liberada com URL.revokeObjectURL em lugar nenhum do
   projeto. Toda troca de pasta / refresh recriava URLs novas e deixava as
   antigas presas na memória do navegador pra sempre (vazamento que cresce
   com o uso — pior em datasets grandes ou sessões longas). Revogamos aqui
   antes de descartar o array antigo.
--------------------------------------------------------------------- */
function revokeImageFileUrls(files) {
    if (!files) return;
    files.forEach(img => { if (img && img.url) { try { URL.revokeObjectURL(img.url); } catch (e) {} } });
}

window.loadGallery = async function(dirHandle) {
    if (typeof window.saveAllImages === 'function') await window.saveAllImages(true);

    window.rootHandle = dirHandle;
    window.currentImagesHandle = dirHandle;
    window.sub1Handles.clear();
    if(window.sub2Handles) window.sub2Handles.clear();
    
    document.getElementById('btn-refresh').style.display = 'inline-block';

    const sel1 = document.getElementById('sub-dir-1');
    const sel2 = document.getElementById('sub-dir-2');
    sel1.style.display = 'none';
    sel2.style.display = 'none';

    await window.loadDatasetConfig(dirHandle);
    await window.loadPendingTagsStore(dirHandle);

    revokeImageFileUrls(imageFiles);
    imageFiles = []; masterTagSet.clear(); masterSelectedTags.clear(); activeSelectedTags.clear(); selectedIndices.clear();
    let configNeedsSave = false;

    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
            configNeedsSave = await window.processSingleImage(entry, dirHandle, configNeedsSave);
        } else if (entry.kind === 'directory' && entry.name !== '_trash' && entry.name !== '_archive') {
            window.sub1Handles.set(entry.name, entry);
        }
    }

    if (configNeedsSave) await window.saveDatasetConfig(dirHandle);

    if (window.sub1Handles.size > 0) {
        sel1.style.display = 'inline-block';
        sel1.innerHTML = '<option value="">-- Root --</option>';
        for (let name of Array.from(window.sub1Handles.keys()).sort((a,b) => a.localeCompare(b))) {
            sel1.innerHTML += `<option value="${name}">${name}</option>`;
        }
    }

    window.finishLoading();
};

window.loadSubDir1 = async function() {
    const val = document.getElementById('sub-dir-1').value;
    const sel2 = document.getElementById('sub-dir-2');

    if (!val) {
        await window.loadGallery(window.rootHandle);
        return;
    }

    if (typeof window.saveAllImages === 'function') await window.saveAllImages(true);

    window.currentImagesHandle = window.sub1Handles.get(val); 
    window.sub2Handles.clear();
    sel2.style.display = 'none';
    sel2.innerHTML = `<option value="">-- [ ${val} ] --</option>`;

    await window.loadDatasetConfig(window.currentImagesHandle);
    await window.loadPendingTagsStore(window.currentImagesHandle);

    revokeImageFileUrls(imageFiles);
    imageFiles = []; masterTagSet.clear(); masterSelectedTags.clear(); activeSelectedTags.clear(); selectedIndices.clear();
    let configNeedsSave = false;

    for await (const entry of window.currentImagesHandle.values()) {
        if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
            configNeedsSave = await window.processSingleImage(entry, window.currentImagesHandle, configNeedsSave);
        } else if (entry.kind === 'directory' && entry.name !== '_trash' && entry.name !== '_archive') {
            window.sub2Handles.set(entry.name, entry);
        }
    }

    if (configNeedsSave) await window.saveDatasetConfig(window.currentImagesHandle);

    if (window.sub2Handles.size > 0) {
        sel2.style.display = 'inline-block';
        for (let path of Array.from(window.sub2Handles.keys()).sort((a,b) => a.localeCompare(b))) {
            sel2.innerHTML += `<option value="${path}">${path}</option>`;
        }
    }

    window.finishLoading();
};

window.loadSubDir2 = async function() {
    const val = document.getElementById('sub-dir-2').value;

    if (!val) {
        await window.loadSubDir1();
        return;
    }

    if (typeof window.saveAllImages === 'function') await window.saveAllImages(true);

    const targetHandle = window.sub2Handles.get(val);
    window.currentImagesHandle = targetHandle;

    await window.loadDatasetConfig(targetHandle);
    await window.loadPendingTagsStore(targetHandle);

    revokeImageFileUrls(imageFiles);
    imageFiles = []; masterTagSet.clear(); masterSelectedTags.clear(); activeSelectedTags.clear(); selectedIndices.clear();
    let configNeedsSave = false;
    
    for await (const entry of targetHandle.values()) {
        if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
            configNeedsSave = await window.processSingleImage(entry, targetHandle, configNeedsSave);
        }
    }

    if (configNeedsSave) await window.saveDatasetConfig(targetHandle);
    window.finishLoading();
};

window.detectFormat = function(text) {
    if (!text) return 'tags';
    if (text.includes('\n')) return 'nl';
    if ((text.match(/\./g) || []).length > 0 && (text.match(/,/g) || []).length < (text.match(/\./g) || []).length * 2) return 'nl';
    if (!text.includes(',') && text.split(' ').length > 6) return 'nl';
    return 'tags';
}

window.processSingleImage = async function(entry, parentHandle, configNeedsSave) {
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
        type = window.detectFormat(content);
        configNeedsSave = true; 
    }

    if (type === 'nl') {
        if (content && content.trim()) {
            content = 'NL:' + content.trim().replace(/\n/g, ' ').replace(/,/g, '，');
        }
        type = 'tags';
        configNeedsSave = true;
    }
    datasetConfig[baseName] = { type: type, ext: ext };

    if (type === 'tags' && content.trim()) {
        content.split(',').forEach(t => { if(t.trim()) masterTagSet.add(t.trim()); });
    }
    
    const isHidden = window.hiddenImagesStore.has(baseName);
    imageFiles.push({ handle: entry, parentDirHandle: parentHandle, name: entry.name, baseName: baseName, url: URL.createObjectURL(file), content: content, type: type, hasFile: hasFile, ext: ext, pendingAdd: (pendingTagsStore[baseName] || []).slice(), hidden: isHidden, dirty: false });
    return configNeedsSave;
}

window.finishLoading = function() {
    // ORDENAÇÃO NATIVA E RÁPIDA - Resolve o problema do _1 vs _11 sem travar o navegador
    // Se a imagem tiver uma ordem manual salva (via Reorder Mode), ela tem prioridade.
    imageFiles.sort((a, b) => {
        const cfgA = datasetConfig[a.baseName];
        const cfgB = datasetConfig[b.baseName];
        const orderA = cfgA && typeof cfgA.order === 'number' ? cfgA.order : null;
        const orderB = cfgB && typeof cfgB.order === 'number' ? cfgB.order : null;
        if (orderA !== null && orderB !== null) return orderA - orderB;
        return a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});
    });

    document.getElementById('list-count').textContent = imageFiles.length;
    
    window.updateLastEditedUI();
    window.updateTagsDatalist();
    if(typeof window.updateUnhideButton === 'function') window.updateUnhideButton();
    if(typeof window.renderImageList === 'function') window.renderImageList(); 
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.checkBatchReadyState === "function") window.checkBatchReadyState();
    if (typeof window.updateUnsavedChangesUI === 'function') window.updateUnsavedChangesUI();
    
    if (imageFiles.length > 0) { 
        document.getElementById('btn-save-all').style.display = 'inline-block';
        document.getElementById('btn-save-active').style.display = 'inline-block';
        const activeFilter = document.getElementById('btn-active-tag-filter');
        if (activeFilter) activeFilter.style.display = 'inline-block';
        if(typeof window.handleListClick === 'function') window.handleListClick(0, false, false); 
    } else {
        document.getElementById('btn-save-all').style.display = 'none';
        document.getElementById('btn-save-active').style.display = 'none';
        const activeFilter = document.getElementById('btn-active-tag-filter');
        if (activeFilter) activeFilter.style.display = 'none';
        if (typeof window.renderEditor === 'function') window.renderEditor();
    }

    if (window.showDanbooruCounts && masterTagSet.size > 0) {
        window.syncDanbooruTags(Array.from(masterTagSet));
    }
}

window.loadDatasetConfig = async function(dirHandle) {
    try {
        const configHandle = await dirHandle.getFileHandle('_tagger_config.json');
        const file = await configHandle.getFile();
        datasetConfig = JSON.parse(await file.text());
    } catch(e) { datasetConfig = {}; }
    window.updateLastEditedUI();
}

window.saveDatasetConfig = async function(dirHandle) {
    if (!dirHandle) return;
    try {
        const configHandle = await dirHandle.getFileHandle('_tagger_config.json', { create: true });
        const writable = await configHandle.createWritable();
        await writable.write(JSON.stringify(datasetConfig, null, 2));
        await writable.close();
    } catch(e) {}
}

window.loadPendingTagsStore = async function(dirHandle) {
    try {
        const h = await dirHandle.getFileHandle('_pending_tags.json');
        const file = await h.getFile();
        pendingTagsStore = JSON.parse(await file.text());
    } catch(e) { pendingTagsStore = {}; }
}

window.savePendingTagsStore = async function(dirHandle) {
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
    window.updateTagsDatalist();
    if(typeof window.refreshListStatus === 'function') window.refreshListStatus();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    window.showAlert("Configuration saved to catalog!", "success");
}

window.updateTagsDatalist = function() {
    const datalist = document.getElementById('all-tags-list');
    if(!datalist) return;
    datalist.innerHTML = '';
    const frag = document.createDocumentFragment();
    Array.from(masterTagSet).filter(tag => !tag.startsWith('NL:')).sort().forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag; 
        frag.appendChild(opt);
    });
    datalist.appendChild(frag);
};

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
    
    // Tira o foco do input ANTES de esconder o dropdown — em alguns
    // navegadores, esconder (display:none) um elemento que ainda está
    // focado atrasa o repaint da área por baixo até a próxima interação.
    // (A ordem aqui importa: tinha ficado invertida antes.)
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
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
            if(typeof window.renderImageList === 'function') window.renderImageList();
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            if (typeof window.renderEditor === 'function') window.renderEditor();
            if (typeof window.applyFilters === 'function') window.applyFilters();
        }
    } catch(e) { console.error("Render refresh failed:", e); }

    // BUG FIX: sem isso, o navegador só repintava a tela com as mudanças
    // acima na próxima interação do usuário (clique em qualquer lugar) —
    // porque o Promise.all logo abaixo (salvando todos os arquivos em
    // disco de uma vez) podia disparar antes do navegador ter uma chance
    // de desenhar o frame com a lista já atualizada. Um único rAF nem
    // sempre é suficiente (o navegador pode disparar dois rAFs seguidos
    // sem pintar entre eles); o double-rAF abaixo garante um ciclo de
    // pintura completo antes de seguir pro trabalho pesado de salvar.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const savePromises = modifiedFiles.map(img => window.saveImageToDisk(img));
    
    await Promise.all(savePromises);
    if(replacedCount > 0) window.markDatasetEdited();
}

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
    if (selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
};

window.applyTagNameFilterToDOM = function() {
    const container = document.getElementById('master-tag-list');
    if (!container) return;
    container.querySelectorAll('.master-tag-item').forEach(item => {
        if (item.classList.contains('pinned-master-tag-row')) { item.style.display = 'flex'; return; }
        const nameEl = item.querySelector('.tag-name');
        const text = (nameEl ? nameEl.textContent : item.textContent).toLowerCase();
        item.style.display = (!window.tagNameFilter || text.includes(window.tagNameFilter)) ? 'flex' : 'none';
    });
}

window.filterMasterTagsByName = function(val) {
    window.tagNameFilter = (val || '').trim().toLowerCase();
    window.applyTagNameFilterToDOM();
};

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

/* ---------------------------------------------------------------------
   BUG FIX: btn-discard-active-suggestions (in the Active Image editor)
   called window.discardActiveSuggestions(), which was never defined —
   only the dataset-wide window.discardAllSuggestions() existed. This
   scopes the discard to just the currently selected image(s).
--------------------------------------------------------------------- */
window.discardActiveSuggestions = async function() {
    if (typeof selectedIndices === 'undefined' || selectedIndices.size === 0) return;

    const anyPending = Array.from(selectedIndices).some(idx => {
        const img = imageFiles[idx];
        return img && img.pendingAdd && img.pendingAdd.length > 0;
    });
    if (!anyPending) return;

    if (!confirm("Discard pending tag suggestions for the selected image(s)? This cannot be undone.")) return;

    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        if (img) {
            img.pendingAdd = [];
            if (typeof pendingTagsStore !== 'undefined') delete pendingTagsStore[img.baseName];
        }
    });

    const handle = window.currentImagesHandle || window.rootHandle;
    if (typeof window.savePendingTagsStore === 'function') await window.savePendingTagsStore(handle);

    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.updateActiveSuggestVisibility === 'function') window.updateActiveSuggestVisibility();
    if (typeof window.applyFilters === 'function') window.applyFilters();

    if (window.showAlert) window.showAlert("Pending suggestions discarded for the selected image(s).", "success");
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
    if (typeof window.savePendingTagsStore === 'function') await window.savePendingTagsStore(handle);

    window.showGhostTagsInList = false;
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();

    window.showAlert("All pending suggestions discarded.", "success");
};
/* =========================================================================
   REORDER MODE (Standalone-style, same pattern as the other wrap-based
   modules in this project — does not touch tagmanager_ui_list.js)
   ---------------------------------------------------------------------
   This is the feature that was half-built: the button (#btn-reorder-mode)
   and the drag-over CSS classes (.drag-over-top / .drag-over-bottom)
   already existed in tag_manager.html, but no JS ever drove them.

   - 🔒 Locked (default): list behaves exactly as before, no dragging.
   - 🔓 Unlocked: each visible row in the Dataset list becomes draggable;
     dropping it above/below another row moves it there.
   - The new order is persisted per-image as `datasetConfig[baseName].order`
     and honored by window.finishLoading() on the next load/refresh.
========================================================================= */

window.reorderModeActive = false;
let _reorderDragImgs = null; // array de objetos (não índices) sendo arrastados

window.toggleReorderMode = function() {
    window.reorderModeActive = !window.reorderModeActive;

    const btn = document.getElementById('btn-reorder-mode');
    if (btn) {
        btn.textContent = window.reorderModeActive ? '🔓' : '🔒';
        btn.title = window.reorderModeActive
            ? 'Reorder mode ON — drag images to move them (click to lock)'
            : 'Unlock Reorder Mode';
        btn.style.color = window.reorderModeActive ? '#00ff99' : '#aaa';
        btn.style.borderColor = window.reorderModeActive ? '#00aa66' : '#444';
    }

    if (typeof window.renderImageList === 'function') window.renderImageList();
};

/* Move um grupo de imagens (movedImgs, na ordem original do dataset) para
   antes/depois de targetImg. Usa referências de objeto em vez de índices
   numéricos porque, ao mover vários itens de uma vez, os índices dos
   demais mudam a cada remoção — objetos não. */
window.reorderImagesInList = function(movedImgs, targetImg, insertAfter) {
    if (!movedImgs || movedImgs.length === 0 || !targetImg) return;
    const movedSet = new Set(movedImgs);
    if (movedSet.has(targetImg)) return; // não pode soltar em cima de si mesmo

    // Guarda quais baseNames estavam selecionados ANTES de qualquer mutação
    const selectedBaseNamesBefore = Array.from(selectedIndices)
        .map(i => imageFiles[i] ? imageFiles[i].baseName : null)
        .filter(Boolean);

    // Preserva a ordem relativa original das imagens arrastadas
    // (não a ordem em que foram clicadas/selecionadas)
    const movedInOrder = imageFiles.filter(f => movedSet.has(f));

    // Remove-as do array (de trás pra frente pra não bagunçar índices)
    for (let i = imageFiles.length - 1; i >= 0; i--) {
        if (movedSet.has(imageFiles[i])) imageFiles.splice(i, 1);
    }

    let insertPos = imageFiles.indexOf(targetImg);
    if (insertPos === -1) insertPos = imageFiles.length;
    if (insertAfter) insertPos += 1;

    imageFiles.splice(insertPos, 0, ...movedInOrder);

    // Grava a nova ordem manual para sobreviver a um refresh/reload
    imageFiles.forEach((f, i) => {
        if (!datasetConfig[f.baseName]) datasetConfig[f.baseName] = {};
        datasetConfig[f.baseName].order = i;
    });
    if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();

    // Restaura a seleção nas mesmas imagens depois do array embaralhar
    selectedIndices.clear();
    if (typeof window.renderImageList === 'function') window.renderImageList();

    imageFiles.forEach((f, i) => { if (selectedBaseNamesBefore.includes(f.baseName)) selectedIndices.add(i); });
    if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
};

function injectReorderHandlers() {
    if (typeof imageFiles === 'undefined') return;

    imageFiles.forEach((img, index) => {
        if (!img.element) return;
        const el = img.element;

        if (!window.reorderModeActive) {
            el.draggable = false;
            el.classList.remove('reorder-draggable');
            el.ondragstart = null;
            el.ondragend = null;
            el.ondragover = null;
            el.ondragleave = null;
            el.ondrop = null;
            return;
        }

        if (img.hidden) return;

        el.draggable = true;
        el.classList.add('reorder-draggable');

        el.ondragstart = (e) => {
            e.stopPropagation();

            // Se a imagem arrastada faz parte de uma seleção múltipla atual,
            // arrasta o grupo inteiro junto; senão, arrasta só ela.
            if (typeof selectedIndices !== 'undefined' && selectedIndices.has(index) && selectedIndices.size > 1) {
                _reorderDragImgs = Array.from(selectedIndices)
                    .sort((a, b) => a - b)
                    .map(i => imageFiles[i])
                    .filter(Boolean);
            } else {
                _reorderDragImgs = [img];
            }

            _reorderDragImgs.forEach(dImg => { if (dImg.element) dImg.element.classList.add('dragging'); });

            if (_reorderDragImgs.length > 1 && e.dataTransfer) {
                try { e.dataTransfer.setData('text/plain', `${_reorderDragImgs.length} images`); } catch (err) {}
            }
        };
        el.ondragend = () => {
            if (_reorderDragImgs) _reorderDragImgs.forEach(dImg => { if (dImg.element) dImg.element.classList.remove('dragging'); });
            el.classList.remove('drag-over-top', 'drag-over-bottom');
            _reorderDragImgs = null;
        };
        el.ondragover = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!_reorderDragImgs) return;
            const rect = el.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            el.classList.toggle('drag-over-top', e.clientY < midpoint);
            el.classList.toggle('drag-over-bottom', e.clientY >= midpoint);
        };
        el.ondragleave = () => el.classList.remove('drag-over-top', 'drag-over-bottom');
        el.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.classList.remove('drag-over-top', 'drag-over-bottom');
            if (!_reorderDragImgs || _reorderDragImgs.includes(img)) return;

            const rect = el.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertAfter = e.clientY >= midpoint;

            window.reorderImagesInList(_reorderDragImgs, img, insertAfter);
        };
    });
}

(function wrapRenderImageListForReorder() {
    const tryWrap = () => {
        if (typeof window.renderImageList !== 'function' || window.renderImageList.__reorderWrapped) return false;
        const original = window.renderImageList;
        const wrapped = function() {
            original.apply(this, arguments);
            injectReorderHandlers();
        };
        wrapped.__reorderWrapped = true;
        window.renderImageList = wrapped;
        return true;
    };
    // tagmanager_ui_list.js já foi carregado antes deste arquivo no HTML,
    // então isso deve funcionar de primeira; o fallback é só por segurança.
    if (!tryWrap()) window.addEventListener('DOMContentLoaded', tryWrap);
})();

const reorderStyle = document.createElement('style');
reorderStyle.innerHTML = `
    .list-item.reorder-draggable { cursor: grab; }
    .list-item.reorder-draggable:active { cursor: grabbing; }
    .list-item.reorder-draggable.dragging { opacity: 0.4; }
    #btn-reorder-mode.active-mode { background: #0d2a18 !important; }
`;
document.head.appendChild(reorderStyle);