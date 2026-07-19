/* =========================================================================
   UI LOGIC - IMAGE LIST
   Handles the left panel, image rendering, multi-select, hide, and renames.
========================================================================= */

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
    
    window.updateListSelectionVisuals();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    if (typeof window.updateSuggestFilterVisibility === 'function') window.updateSuggestFilterVisibility();
}

window.filterImagesByName = function(val) {
    window.imageNameFilter = (val || '').trim().toLowerCase();
    if (typeof window.applyFilters === 'function') window.applyFilters();
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

/* ---------------------------------------------------------------------
   LIXEIRA (SOFT DELETE)
   O delete não apaga nada do disco direto (removeEntry seria permanente
   e não passa pela Lixeira do SO — o navegador não permite isso). Em vez
   disso, delega pra window.moveToGlobalTrash() (tagmanager_trash.js),
   que move a imagem + legenda pra uma pasta de Lixeira configurável pelo
   usuário (igual ao "Set Directory" dos Taggers), com Restaurar / Excluir
   Permanente disponíveis lá.

   BUG FIX: se a imagem tivesse edições de tags não salvas (img.dirty),
   mandar pra lixeira pegava o conteúdo antigo do disco — suas últimas
   edições sumiam (e ficavam perdidas de vez, já que o item some da
   lista). Agora salvamos a imagem no disco primeiro, se estiver dirty,
   ANTES de mover pra lixeira. Funciona igual pra 1 imagem ou várias,
   já que é sempre a seleção (selectedIndices) que dirige o delete.
--------------------------------------------------------------------- */
window.deleteSelectedImages = async function() {
    if(selectedIndices.size === 0) return;
    if(!confirm(`Move ${selectedIndices.size} image(s) and text data to Trash (🗑️)?\nYou'll be able to restore them later, or delete them permanently, from the Trash panel.`)) return;
    
    const indices = Array.from(selectedIndices).sort((a,b) => b - a);
    let deletedCount = 0;
    
    for(let i of indices) {
        const img = imageFiles[i];
        try {
            if (img.dirty && typeof window.saveImageToDisk === 'function') await window.saveImageToDisk(img);
            const ok = typeof window.moveToGlobalTrash === 'function' && await window.moveToGlobalTrash(img);
            if (!ok) continue;
            if (datasetConfig[img.baseName]) delete datasetConfig[img.baseName];
            if (pendingTagsStore[img.baseName]) delete pendingTagsStore[img.baseName];
            if (window.hiddenImagesStore.has(img.baseName)) window.hiddenImagesStore.delete(img.baseName);
            deletedCount++;
        } catch(e) {}
    }
    
    if(deletedCount > 0) {
        window.markDatasetEdited();
        if (typeof savePendingTagsStore === 'function') await savePendingTagsStore(window.currentImagesHandle);
        window.showAlert(`Moved ${deletedCount} file(s) to Trash 🗑️.`, 'success');
        if(typeof window.refreshDataset === 'function') await window.refreshDataset();
        if (typeof window.updateTrashButtonState === 'function') window.updateTrashButtonState();
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
        if (img.hasFile && img.dirty) {
            const ok = await window.saveImageToDisk(img);
            if (ok) savedCount++;
        }
    });
    await Promise.all(promises);
    if(savedCount > 0) window.markDatasetEdited();
    if(!silent) window.showAlert(savedCount > 0 ? `Saved ${savedCount} file(s) with pending changes.` : `No pending changes to save.`);
}

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
        
        // Zero-padding para o Rename: garante _001, _002, etc.
        const paddedCount = String(count).padStart(3, '0');
        const finalBaseName = isMulti ? `${newBaseName}_${paddedCount}` : newBaseName;
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
                    // Escreve o conteúdo ATUAL em memória (img.content), não o que
                    // está salvo no disco — assim edições de tags ainda não salvas
                    // (img.dirty) não se perdem no rename.
                    const contentToWrite = textFormat === 'json'
                        ? JSON.stringify({ tags: img.content }, null, 2)
                        : img.content;
                    const newTextHandle = await img.parentDirHandle.getFileHandle(newTextName, {create: true});
                    const writableText = await newTextHandle.createWritable();
                    await writableText.write(contentToWrite);
                    await writableText.close();
                    if (oldTextName !== newTextName) {
                        try { await img.parentDirHandle.removeEntry(oldTextName); } catch(e) {}
                    }
                    if (typeof window.markClean === 'function') window.markClean(img);
                } catch(e) {}
            }

            if (datasetConfig[img.baseName]) {
                datasetConfig[finalBaseName] = datasetConfig[img.baseName];
                delete datasetConfig[img.baseName];
            }
            // Renomear é uma forma manual de reorganizar a lista (ex: _001, _002...).
            // Se a imagem já tinha uma posição manual salva pelo Reorder Mode (drag),
            // essa posição "grudava" pra sempre e o rename parecia não fazer nada
            // na lista. Limpamos a ordem manual aqui pra que a ordenação alfabética
            // pelo novo nome volte a valer.
            if (datasetConfig[finalBaseName] && typeof datasetConfig[finalBaseName].order === 'number') {
                delete datasetConfig[finalBaseName].order;
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
        if (typeof window.savePendingTagsStore === 'function') await window.savePendingTagsStore(window.currentImagesHandle);
        window.showAlert(`Renamed ${renamedCount} files!`, "success");
        if (typeof window.refreshDataset === 'function') await window.refreshDataset(); 
    }
}

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
            // Zero-padding para o Clone
            let paddedN = String(n).padStart(3, '0');
            let newBaseName = `${img.baseName}_${paddedN}`;
            let bump = 1;
            while (existingBaseNames.has(newBaseName)) {
                bump++;
                let paddedBump = String(bump).padStart(3, '0');
                newBaseName = `${img.baseName}_${paddedN}_${paddedBump}`;
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
                    const newTextName = `${newBaseName}.${textFormat}`;
                    try {
                        // Escreve o conteúdo ATUAL em memória (img.content), não o que
                        // está salvo no disco — assim edições de tags ainda não salvas
                        // (img.dirty) também são clonadas corretamente.
                        const contentToWrite = textFormat === 'json'
                            ? JSON.stringify({ tags: img.content }, null, 2)
                            : img.content;
                        const newTextHandle = await img.parentDirHandle.getFileHandle(newTextName, { create: true });
                        const writableText = await newTextHandle.createWritable();
                        await writableText.write(contentToWrite);
                        await writableText.close();
                    } catch (e) {}
                }

                if (datasetConfig[img.baseName]) {
                    datasetConfig[newBaseName] = { ...datasetConfig[img.baseName] };
                    delete datasetConfig[newBaseName].order; // clone entra na ordenação alfabética normal, não gruda na posição do original
                }
                clonedCount++;
            } catch (e) { console.error("Clone Error:", e); }
        }
    }

    if (clonedCount > 0) {
        if (typeof window.saveDatasetConfig === 'function') await window.saveDatasetConfig(window.currentImagesHandle || window.rootHandle);
        window.markDatasetEdited();
        window.showAlert(`Cloned ${clonedCount} file(s)!`, "success");
        if (typeof window.refreshDataset === 'function') await window.refreshDataset();
    }
}