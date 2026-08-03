/* ================================================================
   GALLERY TAG SYSTEM
   Handles per-image tagging, batch tag application, tag filtering,
   and the tags index (loaded from sidecar JSONs).
   ================================================================ */

let tagsPerFile = new Map();
let allTags     = new Set();
let isTagMode   = false;

let galleryViewMode   = 'solto'; // 'solto' (free grid, tags hidden) | 'galeria' (grouped by tag, tags shown)
let activeGalleryTag  = null;    // tag/gallery selected in the sidebar when tags are shown
let hiddenGalleryTags = new Set(); // tags hidden from the "All Images" view — saved per folder in IndexedDB

/* ----------------------------------------------------------------
   VIEW MODE PERSISTENCE (per folder, in the same IndexedDB)
   Internal storage values ('solto' / 'galeria') are kept as-is for
   backward compatibility with data already saved by users; only the
   button label and sidebar text are shown as "Show/Hide Tags".
   ---------------------------------------------------------------- */
async function saveGalleryViewMode(folderName, mode) {
    const db = await initDB();
    return new Promise(r => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(mode, 'galleryview_' + folderName);
        tx.oncomplete = r;
    });
}

async function getGalleryViewMode(folderName) {
    const db = await initDB();
    return new Promise(r => {
        const tx  = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get('galleryview_' + folderName);
        req.onsuccess = () => r(req.result === 'galeria' ? 'galeria' : 'solto');
        req.onerror   = () => r('solto');
    });
}

async function saveHiddenGalleryTags(folderName, tagsArray) {
    const db = await initDB();
    return new Promise(r => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(tagsArray, 'hiddentags_' + folderName);
        tx.oncomplete = r;
    });
}

async function getHiddenGalleryTags(folderName) {
    const db = await initDB();
    return new Promise(r => {
        const tx  = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get('hiddentags_' + folderName);
        req.onsuccess = () => r(Array.isArray(req.result) ? req.result : []);
        req.onerror   = () => r([]);
    });
}

function updateViewModeButtonUI() {
    const btn = document.getElementById('btn-view-mode');
    if (btn) {
        if (galleryViewMode === 'galeria') {
            btn.textContent = '🖼️ Hide Tags';
            btn.title = 'Back to the free grid (hide tag galleries)';
            btn.classList.add('active');
        } else {
            btn.textContent = '🏷️ Show Tags';
            btn.title = 'Group images by tag (show tag galleries)';
            btn.classList.remove('active');
        }
    }
    const filterInput = document.getElementById('filter-tag');
    if (filterInput) {
        filterInput.style.display = (galleryViewMode === 'galeria') ? 'none' : 'inline-block';
    }
}

/* ----------------------------------------------------------------
   DATALIST  — keeps the <datalist id="all-tags-list"> up to date
   ---------------------------------------------------------------- */
function updateTagsDatalist() {
    const dl = document.getElementById('all-tags-list');
    dl.innerHTML = '';
    allTags.forEach(t => {
        if (t && t.trim() !== '') {
            const opt = document.createElement('option');
            opt.value = t;
            dl.appendChild(opt);
        }
    });
    if (typeof renderGallerySidebar === 'function') renderGallerySidebar();
}

/* ----------------------------------------------------------------
   TAGS VIEW — each tag becomes a "virtual gallery"
   ---------------------------------------------------------------- */
function renderGallerySidebar() {
    const sidebar   = document.getElementById('gallery-sidebar');
    const container = document.getElementById('gallery-tag-list');
    if (!sidebar || !container) return;

    if (typeof currentHandle === 'undefined' || !currentHandle || galleryViewMode !== 'galeria') {
        sidebar.style.display = 'none';
        return;
    }
    sidebar.style.display = 'flex';
    container.innerHTML = '';

    // Fixed entry: clears the filter and shows everything
    const allItem = document.createElement('div');
    allItem.className = 'gallery-tag-item' + (!activeGalleryTag ? ' active' : '');
    allItem.innerHTML = '<span>🖼️ All Images</span>';
    allItem.onclick = () => setActiveGalleryTag(null);
    container.appendChild(allItem);

    // Counts how many images each tag has
    const counts = {};
    tagsPerFile.forEach(t => { if (t) counts[t] = (counts[t] || 0) + 1; });

    Array.from(allTags)
        .filter(t => t && t.trim() !== '')
        .sort((a, b) => a.localeCompare(b))
        .forEach(tagName => {
            const item = document.createElement('div');
            item.className = 'gallery-tag-item' + (activeGalleryTag === tagName ? ' active' : '');

            const label = document.createElement('span');
            label.textContent = `🗂️ ${tagName} (${counts[tagName] || 0})`;
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.whiteSpace = 'nowrap';
            label.style.flex = '1';
            label.onclick = () => setActiveGalleryTag(tagName);

            const isHidden = hiddenGalleryTags.has(tagName);
            const hideBtn = document.createElement('button');
            hideBtn.textContent = isHidden ? '🙈' : '👁️';
            hideBtn.title = isHidden
                ? `Show "${tagName}" in "All Images"`
                : `Hide "${tagName}" from "All Images" (doesn't affect the gallery itself)`;
            hideBtn.className = 'gallery-hide-btn' + (isHidden ? ' active' : '');
            hideBtn.onclick = (e) => { e.stopPropagation(); toggleHideGalleryTag(tagName); };

            const delBtn = document.createElement('button');
            delBtn.textContent = '✖';
            delBtn.title = 'Remove this gallery (clears the tag from all images)';
            delBtn.className = 'gallery-delete-btn';
            delBtn.onclick = (e) => { e.stopPropagation(); deleteGalleryTag(tagName); };

            item.appendChild(label);
            item.appendChild(hideBtn);
            item.appendChild(delBtn);
            container.appendChild(item);

            // Hover preview: only relevant when this tag isn't already the sole thing shown
            item.addEventListener('mouseenter', () => highlightGalleryTagHover(tagName));
            item.addEventListener('mouseleave', () => clearGalleryHoverHighlight());
        });
}

function setActiveGalleryTag(tagName) {
    // Toggle behavior: clicking the tag that's already active returns to "All Images"
    if (tagName && activeGalleryTag === tagName) {
        tagName = null;
    }

    activeGalleryTag = tagName;
    clearGalleryHoverHighlight(); // avoid a stale hover-highlight lingering after the grid re-renders
    const filterInput = document.getElementById('filter-tag');
    if (filterInput) filterInput.value = ''; // avoid the old text filter hiding gallery items
    if (document.getElementById('detail-view').style.display === 'flex') backToGrid();
    renderGrid();
    renderGallerySidebar();

    // Diagnostics: the tag exists (count > 0) but no current file in this folder matches it.
    // This usually means "orphaned" JSONs (file_name points to an image that was renamed
    // or deleted outside the app, without going through this app's rename/delete functions).
    if (tagName && typeof currentFiles !== 'undefined') {
        const registeredCount = Array.from(tagsPerFile.values()).filter(t => t === tagName).length;
        const matchCount = currentFiles.filter(f => tagsPerFile.get(f.name) === tagName).length;
        if (registeredCount > 0 && matchCount === 0) {
            const registeredNames = [];
            tagsPerFile.forEach((t, fname) => { if (t === tagName) registeredNames.push(fname); });
            console.warn(`[Galleries] "${tagName}": file names registered in the JSON were not found in the current folder:`, registeredNames);
            showAlert(`⚠️ The gallery "${tagName}" has ${registeredCount} image(s) registered in JSON, but none match the current files in this folder (they were probably renamed or deleted outside the app). Check the console (F12) for the expected file names.`, 'warn');
        }
    }
}

/* Hovering (not clicking) a tag in the sidebar highlights its images in the grid
   and dims the rest, so you can preview a gallery's contents without navigating into it. */
function highlightGalleryTagHover(tagName) {
    document.querySelectorAll('.grid-item-wrapper').forEach(wrap => {
        const img = wrap.querySelector('.grid-item');
        const fname = img?.dataset.filename;
        const isMatch = !!fname && tagsPerFile.get(fname) === tagName;
        wrap.classList.toggle('tag-hover-highlight', isMatch);
        wrap.classList.toggle('tag-hover-dim', !isMatch);
    });
}

function clearGalleryHoverHighlight() {
    document.querySelectorAll('.grid-item-wrapper.tag-hover-highlight, .grid-item-wrapper.tag-hover-dim').forEach(wrap => {
        wrap.classList.remove('tag-hover-highlight', 'tag-hover-dim');
    });
}

/* Hides/shows a specific gallery within the "All Images" view.
   Saved per folder in IndexedDB (key 'hiddentags_' + folder name).
   Does not affect navigating directly into the gallery (by clicking it). */
function toggleHideGalleryTag(tagName) {
    if (hiddenGalleryTags.has(tagName)) hiddenGalleryTags.delete(tagName);
    else hiddenGalleryTags.add(tagName);

    if (typeof currentHandle !== 'undefined' && currentHandle) {
        saveHiddenGalleryTags(currentHandle.name, Array.from(hiddenGalleryTags));
    }

    renderGallerySidebar();
    renderGrid();
}

function toggleViewMode() {
    galleryViewMode = (galleryViewMode === 'solto') ? 'galeria' : 'solto';
    activeGalleryTag = null;

    const filterInput = document.getElementById('filter-tag');
    if (filterInput) filterInput.value = '';

    updateViewModeButtonUI();
    if (typeof currentHandle !== 'undefined' && currentHandle) {
        saveGalleryViewMode(currentHandle.name, galleryViewMode);
    }

    renderGallerySidebar();
    renderGrid();
}

/* Removes an entire "gallery" (tag): clears that tag from every image that has it.
   The images and JSON files still exist afterward; only the "tag" field is cleared. */
async function deleteGalleryTag(tagName) {
    if (!currentHandle) return;

    const filesToClear = [];
    tagsPerFile.forEach((t, fname) => { if (t === tagName) filesToClear.push(fname); });

    if (filesToClear.length === 0) {
        allTags.delete(tagName);
        updateTagsDatalist();
        return;
    }

    if (!confirm(`Remove the gallery "${tagName}"?\n${filesToClear.length} image(s) will no longer belong to it (the tag will be cleared, but the images and JSON files stay in the folder).`)) return;

    showAlert(`Removing gallery "${tagName}"...`, 'info');
    let count = 0;

    for (const fname of filesToClear) {
        const baseName    = fname.substring(0, fname.lastIndexOf('.')) || fname;
        const sidecarName = baseName + '.json';

        let oldData = {};
        try {
            const existingFh   = await currentHandle.getFileHandle(sidecarName);
            const existingFile = await existingFh.getFile();
            oldData = JSON.parse(await existingFile.text());
        } catch (e) {}

        oldData.file_name = fname;
        oldData.tag = '';

        try {
            const fh       = await currentHandle.getFileHandle(sidecarName, { create: true });
            const writable = await fh.createWritable();
            await writable.write(JSON.stringify(oldData, null, 2));
            await writable.close();
            tagsPerFile.delete(fname);
            count++;
        } catch (e) { console.error(e); }
    }

    allTags.delete(tagName);
    hiddenGalleryTags.delete(tagName);
    if (activeGalleryTag === tagName) activeGalleryTag = null;
    if (currentHandle) await saveHiddenGalleryTags(currentHandle.name, Array.from(hiddenGalleryTags));

    updateTagsDatalist(); // also re-renders the sidebar
    renderGrid();
    showAlert(`🗑️ Gallery "${tagName}" removed from ${count} image(s).`, 'success');
}


function filterGallery() {
    const term     = document.getElementById('filter-tag').value.toLowerCase().trim();
    const wrappers = document.querySelectorAll('.grid-item-wrapper');
    wrappers.forEach(wrap => {
        const img   = wrap.querySelector('.grid-item');
        const fname = (img.dataset.filename || '').toLowerCase();
        wrap.style.display = (term === '' || fname.includes(term)) ? 'flex' : 'none';
    });
}

/* ----------------------------------------------------------------
   INDEX LOADER  — scans every sidecar JSON in the directory
   ---------------------------------------------------------------- */
async function loadTagsIndex(dirHandle) {
    tagsPerFile.clear();
    allTags.clear();
    activeGalleryTag = null;
    hiddenGalleryTags = dirHandle ? new Set(await getHiddenGalleryTags(dirHandle.name)) : new Set();

    galleryViewMode = dirHandle ? await getGalleryViewMode(dirHandle.name) : 'solto';
    updateViewModeButtonUI();
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) {
            try {
                const file    = await entry.getFile();
                const json    = JSON.parse(await file.text());
                const imgName = json.file_name;
                const imgTag  = json.tag;
                if (imgName && imgTag && imgTag.trim() !== '') {
                    tagsPerFile.set(imgName, imgTag.trim());
                    allTags.add(imgTag.trim());
                }
            } catch (e) {}
        }
    }
    updateTagsDatalist();
}

/* ----------------------------------------------------------------
   BATCH TAG MODE (UI LOGIC)
   ---------------------------------------------------------------- */
function enterTagModeGrid() {
    if (!currentHandle) { showAlert('Load a folder first.', 'warn'); return false; }
    isTagMode = true;
    document.getElementById('btn-batch-tag').classList.add('active');

    // Hide old bars if they still exist in the HTML
    const oldBar = document.getElementById('batch-tag-bar');
    if (oldBar) oldBar.style.display = 'none';

    showAlert('🏷️ Select the images, then type the tag in the popup. The popup stays open while you select.', 'info');
    renderGrid();
    return true;
}

function cancelBatchTags() {
    isTagMode = false;
    document.getElementById('btn-batch-tag').classList.remove('active');
    const dropdown = document.getElementById('tag-dropdown');
    if (dropdown) dropdown.classList.remove('open');

    const selectControls = document.getElementById('tag-select-controls');
    const selectionCount = document.getElementById('tag-selection-count');
    if (selectControls) selectControls.style.display = 'none';
    if (selectionCount) selectionCount.style.display = 'none';

    // Re-render the grid back to normal in case we're in the tags view
    if (document.getElementById('grid-view').style.display !== 'none') {
        renderGrid();
    }
}

function toggleBatchTagMode() {
    // Dynamically wire up the popup's "Cancel" button
    const cancelBtn = document.getElementById('tag-cancel-btn');
    if (cancelBtn) {
        cancelBtn.onclick = function() {
            if (document.getElementById('detail-view').style.display === 'flex') {
                document.getElementById('tag-dropdown').classList.remove('open');
            } else {
                cancelBatchTags();
            }
        };
    }

    const detailView   = document.getElementById('detail-view');
    const isDetailView = detailView.style.display === 'flex';
    const selectControls = document.getElementById('tag-select-controls');
    const selectionCount = document.getElementById('tag-selection-count');

    // 1. Single Image Mode (Detail View) — no selection helpers needed here
    if (isDetailView) {
        if (selectControls) selectControls.style.display = 'none';
        if (selectionCount) selectionCount.style.display = 'none';
        const dropdown = document.getElementById('tag-dropdown');
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            const input = document.getElementById('batch-tag-input');
            const currentFname = document.getElementById('file-name').value;
            input.value = (currentFname && tagsPerFile.get(currentFname)) || '';
            input.focus();
            input.select();
        }
        return;
    }

    // 2. Grid Mode — the popup stays open the whole time you're selecting images
    if (!isTagMode) {
        if (enterTagModeGrid()) {
            if (selectControls) selectControls.style.display = 'flex';
            const dropdown = document.getElementById('tag-dropdown');
            dropdown.classList.add('open');
            const input = document.getElementById('batch-tag-input');
            input.value = '';
            input.focus();
            if (typeof updateSelectionCount === 'function') updateSelectionCount('tag-checkbox');
        }
    } else {
        cancelBatchTags();
    }
}

/* ----------------------------------------------------------------
   APPLY BATCH TAGS  — writes tag to selected images' sidecar JSONs
   ---------------------------------------------------------------- */
async function applyBatchTags() {
    if (!currentHandle) return;

    const newTag         = document.getElementById('batch-tag-input').value.trim();
    let   filesToUpdate  = [];
    const isDetailView   = document.getElementById('detail-view').style.display === 'flex';

    if (isDetailView) {
        const currentFname = document.getElementById('file-name').value;
        if (currentFname) filesToUpdate.push(currentFname);
    } else {
        document.querySelectorAll('.tag-checkbox:checked').forEach(cb => filesToUpdate.push(cb.dataset.filename));
    }

    if (filesToUpdate.length === 0) {
        showAlert('❌ No images selected to add a tag.', 'warn');
        return;
    }

    showAlert(`Applying tag to ${filesToUpdate.length} images...`, 'info');
    let count = 0;

    for (const fname of filesToUpdate) {
        const baseName    = fname.substring(0, fname.lastIndexOf('.')) || fname;
        const sidecarName = baseName + '.json';

        let oldData = {};
        try {
            const existingFh   = await currentHandle.getFileHandle(sidecarName);
            const existingFile = await existingFh.getFile();
            oldData = JSON.parse(await existingFile.text());
        } catch (e) {}

        let meta = null;
        if (Object.keys(oldData).length === 0) {
            const fileItem = currentFiles.find(a => a.name === fname);
            if (fileItem?.file) meta = await extractPNGMetadata(fileItem.file);
        }

        const dataObj = {
            file_name:  fname,
            positive:   oldData.positive  ?? meta?.pos       ?? '',
            negative:   oldData.negative  ?? meta?.neg       ?? '',
            tag:        newTag,
            notes:      oldData.notes     ?? (oldData.note ? [oldData.note] : []),
            cfg:        oldData.cfg       ?? meta?.cfg       ?? '',
            steps:      oldData.steps     ?? meta?.steps     ?? '',
            seed:       oldData.seed      ?? meta?.seed      ?? '',
            sampler:    oldData.sampler   ?? meta?.sampler   ?? meta?.scheduler ?? '',
            checkpoint: oldData.checkpoint ?? meta?.ckpt     ?? meta?.checkpoint ?? '',
            loras:      oldData.loras     ?? meta?.loras     ?? '',
            size:       oldData.size      ?? meta?.size      ?? ''
        };

        try {
            const fh       = await currentHandle.getFileHandle(sidecarName, { create: true });
            const writable = await fh.createWritable();
            await writable.write(JSON.stringify(dataObj, null, 2));
            await writable.close();
            tagsPerFile.set(fname, newTag);
            if (newTag) allTags.add(newTag);
            count++;
        } catch (e) { console.error(e); }
    }

    updateTagsDatalist();
    showAlert(`✅ Tag applied to ${count} images!`, 'success');

    if (isDetailView) {
        document.getElementById('tag-dropdown').classList.remove('open');
    } else {
        cancelBatchTags();
    }
}

/* ----------------------------------------------------------------
   REMOVE BATCH TAGS — clears the tag from the selected images' sidecar JSONs.
   Works the same in both contexts: in a specific tag gallery, the grid is
   already filtered to that tag's images, so only those get cleared; in
   "All Images", whatever mix of images/tags is selected gets cleared.
   ---------------------------------------------------------------- */
async function removeBatchTags() {
    if (!currentHandle) return;

    let   filesToUpdate = [];
    const isDetailView  = document.getElementById('detail-view').style.display === 'flex';

    if (isDetailView) {
        const currentFname = document.getElementById('file-name').value;
        if (currentFname) filesToUpdate.push(currentFname);
    } else {
        document.querySelectorAll('.tag-checkbox:checked').forEach(cb => filesToUpdate.push(cb.dataset.filename));
    }

    if (filesToUpdate.length === 0) {
        showAlert('❌ No images selected to remove the tag from.', 'warn');
        return;
    }

    // Only touch files that actually have a tag, so a mixed selection in
    // "All Images" doesn't write to files that never had one to begin with.
    const filesWithTag = filesToUpdate.filter(fname => !!tagsPerFile.get(fname));
    if (filesWithTag.length === 0) {
        showAlert('ℹ️ None of the selected images had a tag.', 'info');
        if (isDetailView) document.getElementById('tag-dropdown').classList.remove('open');
        else cancelBatchTags();
        return;
    }

    showAlert(`Removing tag from ${filesWithTag.length} image(s)...`, 'info');
    let count = 0;

    for (const fname of filesWithTag) {
        const baseName    = fname.substring(0, fname.lastIndexOf('.')) || fname;
        const sidecarName = baseName + '.json';

        let oldData = {};
        try {
            const existingFh   = await currentHandle.getFileHandle(sidecarName);
            const existingFile = await existingFh.getFile();
            oldData = JSON.parse(await existingFile.text());
        } catch (e) {}

        oldData.file_name = fname;
        oldData.tag = '';

        try {
            const fh       = await currentHandle.getFileHandle(sidecarName, { create: true });
            const writable = await fh.createWritable();
            await writable.write(JSON.stringify(oldData, null, 2));
            await writable.close();
            tagsPerFile.delete(fname);
            count++;
        } catch (e) { console.error(e); }
    }

    updateTagsDatalist();
    showAlert(`✅ Tag removed from ${count} image(s).`, 'success');

    if (isDetailView) {
        document.getElementById('tag-dropdown').classList.remove('open');
    } else {
        cancelBatchTags();
    }
}