/* ===== merged from gallery_files.js ===== */
/* ================================================================
   GALLERY PATH SAVER
   Manages creating and displaying visual path labels for
   directories, saved in IndexedDB.
   ================================================================ */

// 1. Database (IndexedDB) functions dedicated to the path text
async function savePathToDB(folderName, pathStr) { 
    const db = await initDB(); 
    return new Promise(r => { 
        const tx = db.transaction(storeName, 'readwrite'); 
        tx.objectStore(storeName).put(pathStr, 'path_' + folderName); 
        tx.oncomplete = r; 
    }); 
}

async function getPathFromDB(folderName) { 
    const db = await initDB(); 
    return new Promise(r => { 
        const tx = db.transaction(storeName, 'readonly'); 
        const req = tx.objectStore(storeName).get('path_' + folderName); 
        req.onsuccess = () => r(req.result); 
        req.onerror = () => r(''); 
    }); 
}

// NOTE: getHandles() and deleteHandle() are already defined in gallery_holder.html
// (and already ignore the 'path_*' and '__app_settings__' keys), so they don't
// need to be reimplemented here.

// 2. UI control (the input popup)
function togglePathMode() {
    if (!rootHandle) { 
        showAlert('Load a folder first.', 'warn'); 
        return; 
    }
    
    const dropdown = document.getElementById('path-dropdown');
    
    // Close any other open menu
    document.querySelectorAll('.settings-dropdown').forEach(el => {
        if (el.id !== 'path-dropdown') el.classList.remove('open');
    });
    
    dropdown.classList.toggle('open');
    
    if (dropdown.classList.contains('open')) {
        const input = document.getElementById('path-label-input');
        const currentText = document.getElementById('path-display').textContent.replace('📁 ', '');
        input.value = currentText;
        input.focus();
        input.select();
    }
}

// 3. Save and update the interface
async function applyPathLabel() {
    if (!rootHandle) return;
    const newPath = document.getElementById('path-label-input').value.trim();
    
    await savePathToDB(rootHandle.name, newPath);
    updatePathDisplay(newPath);
    
    document.getElementById('path-dropdown').classList.remove('open');
    showAlert('📍 Visual path saved successfully!', 'success');
}

function updatePathDisplay(pathStr) {
    const display = document.getElementById('path-display');
    if (display) {
        display.textContent = pathStr ? `📁 ${pathStr}` : '';
    }
}

// Called by the HTML file when a folder loads
window.loadSavedPathDisplay = async function(dirHandle) {
    if (!dirHandle) return;
    const savedText = await getPathFromDB(dirHandle.name);
    updatePathDisplay(savedText);
};

/* ===== merged from gallery_files.js ===== */
/* ================================================================
   GALLERY FILE MANAGER
   Handles file system operations: rename (single & batch) and delete.
   ================================================================ */

let isRenameMode = false;

/**
 * Activates checkbox selection mode in the grid.
 */
function enterRenameModeGrid() {
    if (!currentHandle) { showAlert('Load a folder first.', 'warn'); return false; }
    isRenameMode = true;

    // Highlight the pencil button and hide the old bar (in case it still exists in the HTML)
    document.getElementById('btn-rename-top').classList.add('active');
    const oldBar = document.getElementById('batch-rename-bar');
    if (oldBar) oldBar.style.display = 'none';

    showAlert('✏️ Select the images, then type the new name in the popup. The popup stays open while you select.', 'info');
    renderGrid();
    return true; // Confirms selection mode was activated
}

/** Cancels rename mode and refreshes the grid. */
function cancelRenameMode() {
    isRenameMode = false;
    document.getElementById('btn-rename-top').classList.remove('active');
    document.getElementById('rename-dropdown').classList.remove('open');

    const selectControls = document.getElementById('rename-select-controls');
    const selectionCount = document.getElementById('rename-selection-count');
    if (selectControls) selectControls.style.display = 'none';
    if (selectionCount) selectionCount.style.display = 'none';

    renderGrid();
}

/* ================================================================
   PENCIL BUTTON TOGGLE
   Handles clicking the pencil icon both in the grid and in the open image.
   ================================================================ */
function toggleRenameBalloon() {
    // Dynamically wires up the popup's "Cancel" button without touching the HTML file
    const cancelBtn = document.querySelector('#rename-dropdown button:last-child');
    if (cancelBtn) {
        cancelBtn.onclick = function() {
            if (document.getElementById('detail-view').style.display === 'flex') {
                document.getElementById('rename-dropdown').classList.remove('open'); // Single image: just close the popup
            } else {
                cancelRenameMode(); // Grid mode: turn off the checkboxes and close the popup
            }
        };
    }

    const detailView   = document.getElementById('detail-view');
    const isDetailView = detailView.style.display === 'flex';
    const selectControls = document.getElementById('rename-select-controls');
    const selectionCount = document.getElementById('rename-selection-count');

    // 1. Single Image Mode (Detail View) — no selection helpers needed here
    if (isDetailView) {
        if (selectControls) selectControls.style.display = 'none';
        if (selectionCount) selectionCount.style.display = 'none';
        const dropdown = document.getElementById('rename-dropdown');
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            const input = document.getElementById('rename-input');
            const currentFname = document.getElementById('file-name').value;
            const extMatch = currentFname.match(/\.[^.]+$/);
            const oldExt = extMatch ? extMatch[0] : '';
            input.value = currentFname.replace(oldExt, '');
            input.focus();
            input.select();
        }
        return;
    }

    // 2. Grid Mode — the popup stays open the whole time you're selecting images
    if (!isRenameMode) {
        // If grid mode activated successfully, open the popup right away!
        if (enterRenameModeGrid()) {
            if (selectControls) selectControls.style.display = 'flex';
            const dropdown = document.getElementById('rename-dropdown');
            dropdown.classList.add('open');
            const input = document.getElementById('rename-input');
            input.value = 'new_name'; // Suggested base name for batch rename
            input.focus();
            input.select();
            if (typeof updateSelectionCount === 'function') updateSelectionCount('rename-checkbox');
        }
    } else {
        // If already in selection mode and the pencil is clicked again, cancel everything
        cancelRenameMode();
    }
}

/* Move o sidecar JSON junto com a imagem. Se o JSON não for válido, copia
   o texto como está (antes ficava para trás com o nome antigo, órfão).
   Retorna false se já existir um JSON com o nome novo (não sobrescreve). */
async function gallerySafeMoveSidecar(dirHandle, oldBaseName, newBaseName, newName) {
    let oldJsonHandle;
    try { oldJsonHandle = await dirHandle.getFileHandle(oldBaseName + '.json'); } catch (e) { return true; } // sem JSON
    try { await dirHandle.getFileHandle(newBaseName + '.json'); return false; } catch (e) {}
    const text = await (await oldJsonHandle.getFile()).text();
    let out = text;
    try { const obj = JSON.parse(text); obj.file_name = newName; out = JSON.stringify(obj, null, 2); } catch (e) {}
    const newJsonHandle = await dirHandle.getFileHandle(newBaseName + '.json', { create: true });
    const w = await newJsonHandle.createWritable();
    await w.write(out);
    await w.close();
    await dirHandle.removeEntry(oldBaseName + '.json');
    if (typeof currentJsonFiles !== 'undefined') {
        currentJsonFiles.delete(oldBaseName + '.json');
        currentJsonFiles.add(newBaseName + '.json');
    }
    return true;
}

async function _exists(name) {
    try { await currentHandle.getFileHandle(name); return true; } catch (e) { return false; }
}

/* ================================================================
   MAIN DISPATCHER
   Called by the "Confirm" button inside the rename popup.
   ================================================================ */
async function renameCurrentImage() {
    const isDetailView = document.getElementById('detail-view').style.display === 'flex';
    const checkboxes   = document.querySelectorAll('.rename-checkbox:checked');

    if (isDetailView) {
        await renameSingleImage();
    } else if (checkboxes.length > 0) {
        await batchRenameImages(checkboxes);
    } else {
        showAlert('❌ No images selected to rename.', 'warn');
    }
}

/* ================================================================
   SINGLE RENAME  (detail view)
   ================================================================ */
async function renameSingleImage() {
    if (!currentHandle) {
        showAlert('❌ No directory loaded.', 'error');
        return;
    }

    const oldName = document.getElementById('file-name').value;
    if (!oldName) {
        showAlert('❌ Open a photo first to rename it.', 'warn');
        return;
    }

    const extMatch       = oldName.match(/\.[^.]+$/);
    const oldExt         = extMatch ? extMatch[0] : '';
    const oldNameWithoutExt = oldExt ? oldName.slice(0, -oldExt.length) : oldName;

    let newNameRaw = document.getElementById('rename-input').value;

    if (!newNameRaw || newNameRaw.trim() === oldNameWithoutExt) {
        document.getElementById('rename-dropdown').classList.remove('open');
        return;
    }

    let newName = newNameRaw.trim();
    if (!newName.toLowerCase().endsWith(oldExt.toLowerCase())) {
        newName += oldExt;
    }

    document.getElementById('rename-dropdown').classList.remove('open');
    showAlert('⏳ Renaming file...', 'info');

    try {
        if (/[\\/:*?"<>|]/.test(newName)) { showAlert('❌ The name has characters that are not allowed in file names.', 'error'); return; }

        const oldBaseName = oldName.substring(0, oldName.lastIndexOf('.')) || oldName;
        const newBaseName = newName.substring(0, newName.lastIndexOf('.')) || newName;

        // Abort if the target image OR its JSON already exists (never overwrite)
        if (await _exists(newName)) { showAlert('❌ A file with that name already exists!', 'error'); return; }
        if (oldBaseName.toLowerCase() !== newBaseName.toLowerCase() && await _exists(newBaseName + '.json') && await _exists(oldBaseName + '.json')) {
            showAlert(`❌ "${newBaseName}.json" already exists — rename cancelled to avoid overwriting it.`, 'error');
            return;
        }

        // Copy the image file
        const oldImgHandle = await currentHandle.getFileHandle(oldName);
        const oldImgFile   = await oldImgHandle.getFile();
        const newImgHandle = await currentHandle.getFileHandle(newName, { create: true });
        const imgWritable  = await newImgHandle.createWritable();
        await imgWritable.write(await oldImgFile.arrayBuffer());
        await imgWritable.close();

        // Move the sidecar JSON (kept as-is if it isn't valid JSON)
        try { await gallerySafeMoveSidecar(currentHandle, oldBaseName, newBaseName, newName); } catch (e) { console.warn('Sidecar move failed:', e); }

        // Remove the old image
        await currentHandle.removeEntry(oldName);

        // Update the in-memory cache
        const fileIndex = currentFiles.findIndex(f => f.name === oldName);
        if (fileIndex !== -1) {
            if (window.ThumbLoader) window.ThumbLoader.forget(currentFiles[fileIndex].url); URL.revokeObjectURL(currentFiles[fileIndex].url);
            const newImgFile = await newImgHandle.getFile();
            currentFiles[fileIndex] = {
                name: newName,
                url:  URL.createObjectURL(newImgFile),
                file: newImgFile
            };
        }

        // Update the tags map
        if (tagsPerFile.has(oldName)) {
            const tag = tagsPerFile.get(oldName);
            tagsPerFile.delete(oldName);
            tagsPerFile.set(newName, tag);
        }

        // Update merge-group membership (interface-only "alternate versions")
        if (typeof updateMergeGroupFileName === 'function') updateMergeGroupFileName(oldName, newName);
            if (typeof renameViewCountEntry === 'function') renameViewCountEntry(oldName, newName);
        if (typeof renderMergeVersionStrip === 'function') renderMergeVersionStrip(newName);

        document.getElementById('file-name').value = newName;

        // Update the active thumbnail
        const activeThumb = document.querySelector('#thumbnail-strip .thumb.active');
        if (activeThumb && fileIndex !== -1) {
            if (window.ThumbLoader) window.ThumbLoader.attach(activeThumb, currentFiles[fileIndex].url, { root: document.getElementById('thumbnail-strip') });
            else activeThumb.src = currentFiles[fileIndex].url;
            activeThumb.onclick = () => openDetailView(currentFiles[fileIndex].url, newName);
        }

        renderGrid();
        showAlert(`✅ Successfully renamed to ${newName}`, 'success');

    } catch (error) {
        console.error('Rename Error:', error);
        showAlert('❌ Error renaming file. Check directory permissions.', 'error');
    }
}

/* ================================================================
   BATCH RENAME  (grid mode)
   ================================================================ */
async function batchRenameImages(checkboxes) {
    if (!currentHandle) return;

    // Grab the value from the popup input
    let baseNameRaw = document.getElementById('rename-input').value;

    if (!baseNameRaw || baseNameRaw.trim() === '') {
        document.getElementById('rename-dropdown').classList.remove('open');
        return;
    }

    let baseName = baseNameRaw.trim();
    document.getElementById('rename-dropdown').classList.remove('open');
    document.getElementById('btn-rename-top').classList.remove('active');

    showAlert(`⏳ Renaming ${checkboxes.length} file(s)...`, 'info');

    let count = 0, skipped = 0;
    const padding = String(checkboxes.length).length;

    for (let i = 0; i < checkboxes.length; i++) {
        const oldName    = checkboxes[i].dataset.filename;
        const extMatch   = oldName.match(/\.[^.]+$/);
        const ext        = extMatch ? extMatch[0] : '.png';
        const num        = String(i + 1).padStart(padding, '0');
        const newName    = `${baseName}_${num}${ext}`;
        const newBaseName = `${baseName}_${num}`;
        const oldBaseName = oldName.substring(0, oldName.lastIndexOf('.')) || oldName;

        try {
            // Skip if the image or its JSON already exists, to avoid overwriting
            if (oldName === newName) { count++; continue; }
            if (await _exists(newName) || (await _exists(oldBaseName + '.json') && await _exists(newBaseName + '.json'))) {
                console.warn(`${newName} (or its JSON) already exists! Skipping to avoid data loss.`);
                skipped++;
                continue;
            }

            const oldImgHandle = await currentHandle.getFileHandle(oldName);
            const oldImgFile   = await oldImgHandle.getFile();
            const newImgHandle = await currentHandle.getFileHandle(newName, { create: true });
            const imgWritable  = await newImgHandle.createWritable();
            await imgWritable.write(await oldImgFile.arrayBuffer());
            await imgWritable.close();

            try { await gallerySafeMoveSidecar(currentHandle, oldBaseName, newBaseName, newName); } catch (e) { console.warn('Sidecar move failed:', e); }

            await currentHandle.removeEntry(oldName);

            const fileIndex = currentFiles.findIndex(f => f.name === oldName);
            if (fileIndex !== -1) {
                if (window.ThumbLoader) window.ThumbLoader.forget(currentFiles[fileIndex].url); URL.revokeObjectURL(currentFiles[fileIndex].url);
                const newImgFile = await newImgHandle.getFile();
                currentFiles[fileIndex] = {
                    name: newName,
                    url:  URL.createObjectURL(newImgFile),
                    file: newImgFile
                };
            }

            if (tagsPerFile.has(oldName)) {
                const tag = tagsPerFile.get(oldName);
                tagsPerFile.delete(oldName);
                tagsPerFile.set(newName, tag);
            }

            if (typeof updateMergeGroupFileName === 'function') updateMergeGroupFileName(oldName, newName);
            if (typeof renameViewCountEntry === 'function') renameViewCountEntry(oldName, newName);

            count++;
        } catch (error) {
            console.error(`Error renaming ${oldName}:`, error);
        }
    }

    isRenameMode = false;
    const selectControls = document.getElementById('rename-select-controls');
    const selectionCount = document.getElementById('rename-selection-count');
    if (selectControls) selectControls.style.display = 'none';
    if (selectionCount) selectionCount.style.display = 'none';

    renderGrid();
    showAlert(`✅ ${count} file(s) renamed successfully!` + (skipped ? ` ${skipped} skipped because the target name already exists.` : ''), skipped ? 'warn' : 'success');
}

/* ===== merged from gallery_files.js ===== */
// 1. Per-folder configuration (IndexedDB)
async function saveAutoRenameConfig(folderName, config) {
    const db = await initDB();
    return new Promise(r => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(config, 'autorename_' + folderName);
        tx.oncomplete = r;
    });
}

async function getAutoRenameConfig(folderName) {
    const db = await initDB();
    return new Promise(r => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get('autorename_' + folderName);
        req.onsuccess = () => r(req.result || { baseName: '', enabled: false });
        req.onerror = () => r({ baseName: '', enabled: false });
    });
}

// NOTE: getHandles() in gallery_holder.html already ignores keys that start
// with 'path_' and the settings key. Since we use the 'autorename_' prefix
// here, getHandles() also needs to ignore that prefix (already covered by
// the adjustment made in gallery_holder.html).

function sanitizeAutoRenameBase(str) {
    return (str || '').trim().replace(/\s+/g, '_').replace(/[\\/:*?"<>|]+/g, '');
}

/* ----------------------------------------------------------------
   UI — configuration popup (🔢 button)
   ---------------------------------------------------------------- */
function toggleAutoRenameMode() {
    if (!currentHandle) { showAlert('Load a folder first.', 'warn'); return; }

    const dropdown = document.getElementById('autorename-dropdown');

    // Close any other open menu
    document.querySelectorAll('.settings-dropdown').forEach(el => {
        if (el.id !== 'autorename-dropdown') el.classList.remove('open');
    });

    dropdown.classList.toggle('open');

    if (dropdown.classList.contains('open')) {
        getAutoRenameConfig(currentHandle.name).then(cfg => {
            document.getElementById('autorename-basename-input').value = cfg.baseName || '';
            document.getElementById('autorename-enabled-checkbox').checked = !!cfg.enabled;
            document.getElementById('autorename-basename-input').focus();
        });
    }
}

async function applyAutoRenameConfig() {
    if (!currentHandle) return;

    const baseNameRaw = document.getElementById('autorename-basename-input').value;
    const enabled     = document.getElementById('autorename-enabled-checkbox').checked;
    const config      = { baseName: baseNameRaw.trim(), enabled };

    await saveAutoRenameConfig(currentHandle.name, config);
    document.getElementById('autorename-dropdown').classList.remove('open');
    updateAutoRenameButtonState(config.enabled);

    if (config.enabled && config.baseName) {
        showAlert('🔢 Auto Rename ON. Checking Files...', 'info');
        await autoRenameNewFiles(currentHandle);
        renderGrid();
    } else if (config.enabled && !config.baseName) {
        showAlert('❌ Define a base name before enabling automatic renaming.', 'warn');
    } else {
        showAlert('🔢 Automatic renaming configuration saved.', 'success');
    }
}

function updateAutoRenameButtonState(enabled) {
    const btn = document.getElementById('btn-autorename');
    if (!btn) return;
    if (enabled) btn.classList.add('active');
    else btn.classList.remove('active');
}

/* ----------------------------------------------------------------
   ENGINE — renames "new" images (that don't follow the naming pattern)
   ---------------------------------------------------------------- */
async function autoRenameNewFiles(dirHandle) {
    if (!dirHandle) return;

    const config = await getAutoRenameConfig(dirHandle.name);
    updateAutoRenameButtonState(config.enabled);
    if (!config.enabled || !config.baseName) return;

    const base = sanitizeAutoRenameBase(config.baseName);
    if (!base) return;

    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('^' + escapedBase + '_(\\d+)$', 'i');

    // Find the highest number already in use and the zero-padding width already in use
    let maxNum   = 0;
    let padWidth = 3; // default: _001, _002, ...
    const pendingFiles = [];

    currentFiles.forEach(f => {
        const extMatch = f.name.match(/\.[^.]+$/);
        const ext      = extMatch ? extMatch[0] : '';
        const nameOnly = f.name.slice(0, f.name.length - ext.length);
        const m = nameOnly.match(pattern);
        if (m) {
            const num = parseInt(m[1], 10);
            if (num > maxNum) maxNum = num;
            if (m[1].length > padWidth) padWidth = m[1].length;
        } else {
            pendingFiles.push(f.name);
        }
    });

    if (pendingFiles.length === 0) return;

    // Deterministic order for who gets the next numbers first
    pendingFiles.sort((a, b) => a.localeCompare(b));

    let counter = maxNum;
    let renamedCount = 0;

    for (const oldName of pendingFiles) {
        counter++;

        const extMatch    = oldName.match(/\.[^.]+$/);
        const ext         = extMatch ? extMatch[0] : '';
        const oldBaseName = oldName.substring(0, oldName.lastIndexOf('.')) || oldName;
        const numStr       = String(counter).padStart(padWidth, '0');
        const newName      = `${base}_${numStr}${ext}`;
        const newBaseName  = `${base}_${numStr}`;

        if (newName === oldName) continue;

        try {
            // Skip if the image OR its JSON already exists with the new name (don't overwrite)
            const taken = async n => { try { await dirHandle.getFileHandle(n); return true; } catch (e) { return false; } };
            if (await taken(newName) || (await taken(oldBaseName + '.json') && await taken(newBaseName + '.json'))) {
                console.warn(`Auto-rename: ${newName} (or its JSON) already exists, skipping ${oldName}.`);
                continue;
            }

            // Copy the image
            const oldImgHandle = await dirHandle.getFileHandle(oldName);
            const oldImgFile   = await oldImgHandle.getFile();
            const newImgHandle = await dirHandle.getFileHandle(newName, { create: true });
            const imgWritable  = await newImgHandle.createWritable();
            await imgWritable.write(await oldImgFile.arrayBuffer());
            await imgWritable.close();

            // Move the sidecar JSON, if it exists (kept as-is if it isn't valid JSON)
            try { await gallerySafeMoveSidecar(dirHandle, oldBaseName, newBaseName, newName); }
            catch (e) { console.warn('Auto-rename: sidecar move failed for', oldName, e); }

            // Remove the old image
            await dirHandle.removeEntry(oldName);

            // Update the in-memory cache (currentFiles)
            const fileIndex = currentFiles.findIndex(f => f.name === oldName);
            if (fileIndex !== -1) {
                if (window.ThumbLoader) window.ThumbLoader.forget(currentFiles[fileIndex].url); URL.revokeObjectURL(currentFiles[fileIndex].url);
                const newImgFile = await newImgHandle.getFile();
                currentFiles[fileIndex] = {
                    name: newName,
                    url:  URL.createObjectURL(newImgFile),
                    file: newImgFile
                };
            }

            // Update the tags map
            if (typeof tagsPerFile !== 'undefined' && tagsPerFile.has(oldName)) {
                const tag = tagsPerFile.get(oldName);
                tagsPerFile.delete(oldName);
                tagsPerFile.set(newName, tag);
            }

            if (typeof updateMergeGroupFileName === 'function') updateMergeGroupFileName(oldName, newName);
            if (typeof renameViewCountEntry === 'function') renameViewCountEntry(oldName, newName);

            renamedCount++;
        } catch (error) {
            console.error(`Error during auto-rename of ${oldName}:`, error);
        }
    }

    if (renamedCount > 0) {
        showAlert(`🔢 ${renamedCount} image(s) renamed automatically.`, 'success');
    }
}
