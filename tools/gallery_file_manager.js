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