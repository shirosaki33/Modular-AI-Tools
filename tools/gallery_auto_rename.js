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
            // Skip if a file with that name already exists (don't overwrite)
            try {
                await dirHandle.getFileHandle(newName);
                console.warn(`Auto-rename: a file named ${newName} already exists, skipping ${oldName}.`);
                continue;
            } catch (e) {}

            // Copy the image
            const oldImgHandle = await dirHandle.getFileHandle(oldName);
            const oldImgFile   = await oldImgHandle.getFile();
            const newImgHandle = await dirHandle.getFileHandle(newName, { create: true });
            const imgWritable  = await newImgHandle.createWritable();
            await imgWritable.write(await oldImgFile.arrayBuffer());
            await imgWritable.close();

            // Copy/update the sidecar JSON, if it exists
            try {
                const oldJsonHandle = await dirHandle.getFileHandle(oldBaseName + '.json');
                const oldJsonFile   = await oldJsonHandle.getFile();
                let jsonObj          = JSON.parse(await oldJsonFile.text());
                jsonObj.file_name    = newName;

                const newJsonHandle = await dirHandle.getFileHandle(newBaseName + '.json', { create: true });
                const jsonWritable  = await newJsonHandle.createWritable();
                await jsonWritable.write(JSON.stringify(jsonObj, null, 2));
                await jsonWritable.close();
                await dirHandle.removeEntry(oldBaseName + '.json');

                if (typeof currentJsonFiles !== 'undefined') {
                    currentJsonFiles.delete(oldBaseName + '.json');
                    currentJsonFiles.add(newBaseName + '.json');
                }
            } catch (e) {}

            // Remove the old image
            await dirHandle.removeEntry(oldName);

            // Update the in-memory cache (currentFiles)
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
            if (typeof tagsPerFile !== 'undefined' && tagsPerFile.has(oldName)) {
                const tag = tagsPerFile.get(oldName);
                tagsPerFile.delete(oldName);
                tagsPerFile.set(newName, tag);
            }

            renamedCount++;
        } catch (error) {
            console.error(`Error during auto-rename of ${oldName}:`, error);
        }
    }

    if (renamedCount > 0) {
        showAlert(`🔢 ${renamedCount} image(s) renamed automatically.`, 'success');
    }
}