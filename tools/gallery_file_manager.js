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
    const oldNameWithoutExt = oldName.replace(oldExt, '');

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
        // Abort if the target name already exists
        try {
            await currentHandle.getFileHandle(newName);
            showAlert('❌ A file with that name already exists!', 'error');
            return;
        } catch (e) {}

        const oldBaseName = oldName.substring(0, oldName.lastIndexOf('.')) || oldName;
        const newBaseName = newName.substring(0, newName.lastIndexOf('.')) || newName;

        // Copy the image file
        const oldImgHandle = await currentHandle.getFileHandle(oldName);
        const oldImgFile   = await oldImgHandle.getFile();
        const newImgHandle = await currentHandle.getFileHandle(newName, { create: true });
        const imgWritable  = await newImgHandle.createWritable();
        await imgWritable.write(await oldImgFile.arrayBuffer());
        await imgWritable.close();

        // Copy and update the sidecar JSON
        try {
            const oldJsonHandle = await currentHandle.getFileHandle(oldBaseName + '.json');
            const oldJsonFile   = await oldJsonHandle.getFile();
            const jsonText      = await oldJsonFile.text();

            let jsonObj = {};
            try { jsonObj = JSON.parse(jsonText); jsonObj.file_name = newName; } catch (e) {}

            const newJsonHandle  = await currentHandle.getFileHandle(newBaseName + '.json', { create: true });
            const jsonWritable   = await newJsonHandle.createWritable();
            await jsonWritable.write(JSON.stringify(jsonObj, null, 2));
            await jsonWritable.close();
            await currentHandle.removeEntry(oldBaseName + '.json');
        } catch (e) {}

        // Remove the old image
        await currentHandle.removeEntry(oldName);

        // Update the in-memory cache
        const fileIndex = currentFiles.findIndex(f => f.name === oldName);
        if (fileIndex !== -1) {
            URL.revokeObjectURL(currentFiles[fileIndex].url);
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

        document.getElementById('file-name').value = newName;

        // Update the active thumbnail
        const activeThumb = document.querySelector('#thumbnail-strip .thumb.active');
        if (activeThumb && fileIndex !== -1) {
            activeThumb.src     = currentFiles[fileIndex].url;
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

    let count = 0;
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
            // Skip if it already exists, to avoid overwriting
            try {
                await currentHandle.getFileHandle(newName);
                console.warn(`File ${newName} already exists! Skipping to avoid data loss.`);
                continue;
            } catch (e) {}

            const oldImgHandle = await currentHandle.getFileHandle(oldName);
            const oldImgFile   = await oldImgHandle.getFile();
            const newImgHandle = await currentHandle.getFileHandle(newName, { create: true });
            const imgWritable  = await newImgHandle.createWritable();
            await imgWritable.write(await oldImgFile.arrayBuffer());
            await imgWritable.close();

            try {
                const oldJsonHandle = await currentHandle.getFileHandle(oldBaseName + '.json');
                const oldJsonFile   = await oldJsonHandle.getFile();
                let jsonObj         = JSON.parse(await oldJsonFile.text());
                jsonObj.file_name   = newName;

                const newJsonHandle = await currentHandle.getFileHandle(newBaseName + '.json', { create: true });
                const jsonWritable  = await newJsonHandle.createWritable();
                await jsonWritable.write(JSON.stringify(jsonObj, null, 2));
                await jsonWritable.close();
                await currentHandle.removeEntry(oldBaseName + '.json');
            } catch (e) {}

            await currentHandle.removeEntry(oldName);

            const fileIndex = currentFiles.findIndex(f => f.name === oldName);
            if (fileIndex !== -1) {
                URL.revokeObjectURL(currentFiles[fileIndex].url);
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
    showAlert(`✅ ${count} file(s) renamed successfully!`, 'success');
}