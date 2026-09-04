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
            <div class="list-item-thumb-wrap">
                <img src="${img.url}">
                <button class="list-item-zoom-btn" title="Zoom / view full size">🔍</button>
            </div>
            <div class="list-item-info">
                <div class="list-item-name">${img.name}</div>
                <div class="list-item-status">${typeBadge}${suggestBadge}<span class="list-item-resolution"></span></div>
            </div>
        `;
        div.onclick = (e) => window.handleListClick(index, e.shiftKey, e.ctrlKey || e.metaKey);
        // Zoom agora é exclusivo do ícone 🔍 (abaixo) — duplo-clique na linha
        // não abre mais o modal, pra não conflitar com seleção/drag da imagem.

        // RESOLUÇÃO: reaproveita o próprio evento de carregamento da miniatura
        // já exibida na lista, sem precisar baixar/decodificar a imagem de novo
        // só pra descobrir o tamanho real (naturalWidth/naturalHeight = pixels
        // reais do arquivo, independente do tamanho exibido via --thumb-size).
        const thumbImgEl = div.querySelector('.list-item-thumb-wrap img');
        const resEl = div.querySelector('.list-item-resolution');
        if (thumbImgEl && resEl) {
            const paintRes = () => { resEl.textContent = ` · ${thumbImgEl.naturalWidth}×${thumbImgEl.naturalHeight}`; };
            if (thumbImgEl.complete && thumbImgEl.naturalWidth) paintRes();
            else thumbImgEl.onload = paintRes;
        }

        // LUPA 🔍: abre o mesmo modal de zoom do double-click, sem precisar
        // dar duplo-clique — e sem disparar a seleção da linha (stopPropagation).
        const zoomBtn = div.querySelector('.list-item-zoom-btn');
        if (zoomBtn) {
            zoomBtn.onclick = (e) => {
                e.stopPropagation();
                document.getElementById('image-popout').src = img.url;
                window.openModal('modal-image');
            };
        }

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

/* ---------------------------------------------------------------------
   BUG FIX: seleção azul "grudando" na imagem errada até dar F5
   ---------------------------------------------------------------------
   O recurso de Custom Highlights (cor de seleção configurável, ver
   applyImageListSelectionOverride em tagmanager_custom_conflicts.js)
   aplica a cor via estilo INLINE com !important — isso é necessário pra
   sobrepor a cor customizada em cima do CSS padrão da classe ".selected".
   O problema: aquele override só rodava depois de um RENDER COMPLETO da
   lista (renderImageList). Um clique rápido pra selecionar/desselecionar
   uma imagem passa só por AQUI (updateListSelectionVisuals), sem recriar
   os elementos — então a classe ".selected" era removida corretamente,
   mas o estilo inline (!important, independente da classe) continuava
   "grudado" na imagem antiga, dando a impressão de que o azul estava na
   imagem errada.
   Agora este é o ÚNICO lugar que decide a aparência da seleção — tanto o
   clique rápido quanto o render completo passam por aqui, então nunca
   mais fica dessincronizado. Ele já limpa (removeProperty) o que não
   está mais selecionado, e aplica a cor customizada (se o módulo de
   Highlights estiver carregado) no que está selecionado agora.
--------------------------------------------------------------------- */
window.updateListSelectionVisuals = function() {
    imageFiles.forEach((img, i) => {
        if (!img.element) return;
        const isSelected = selectedIndices.has(i);
        img.element.classList.toggle('selected', isSelected);

        if (isSelected) {
            const selColor = (window._builtinHighlightColors && window._builtinHighlightColors.selection) || null;
            if (selColor) {
                let h = selColor.replace('#', '');
                if (h.length === 3) h = h.split('').map(c => c + c).join('');
                const r = parseInt(h.substring(0, 2), 16) || 0;
                const g = parseInt(h.substring(2, 4), 16) || 0;
                const b = parseInt(h.substring(4, 6), 16) || 0;
                img.element.style.setProperty('background-color', `rgba(${r}, ${g}, ${b}, 0.32)`, 'important');
                img.element.style.setProperty('border-left-color', selColor, 'important');
            }
        } else {
            img.element.style.removeProperty('background-color');
            img.element.style.removeProperty('border-left-color');
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
        // BUG FIX: no Modo Compacto (🗂️), cada grupo guarda se está
        // colapsado em window._compactCollapsedGroups — isso nunca era
        // limpo. Se um grupo ficou colapsado (ex: durante o Focus Mode,
        // sobrando só 1 grupo visível), as imagens reveladas pelo Unhide
        // voltavam pro DOM normalmente, mas continuavam com
        // display:none por causa do CSS do grupo colapsado — parecia
        // que "não voltaram", mas estavam lá dentro, só escondidas.
        if (window._compactCollapsedGroups && typeof window._compactCollapsedGroups.clear === 'function') {
            window._compactCollapsedGroups.clear();
        }
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

/* ---------------------------------------------------------------------
   RENAME SEGURO (v2 — com pasta de staging "_rename_cache")
   ---------------------------------------------------------------------
   BUG CORRIGIDO: a versão antiga escrevia direto no nome de destino
   (getFileHandle(newName, {create:true}) + createWritable()) sem checar
   se esse nome já existia no disco por outro motivo (ex: colisão com uma
   imagem que NÃO fazia parte da seleção). createWritable() TRUNCA e
   sobrescreve o arquivo existente silenciosamente — se houvesse colisão,
   o arquivo antigo virava lixo sem nenhum aviso e sem cópia de segurança
   em lugar nenhum. Foi assim que fotos sumiram.

   Agora o processo tem 2 fases:
   1) CHECAGEM DE COLISÃO: antes de tocar em qualquer arquivo, comparamos
      todos os nomes de destino planejados contra o conteúdo real da(s)
      pasta(s) de origem. Se algum nome de destino já existir no disco E
      não for um dos arquivos que estamos renomeando, avisamos o usuário
      com detalhes e pedimos confirmação explícita antes de continuar
      (podendo cancelar sem nada ter sido tocado ainda).
   2) STAGING: para cada arquivo, a imagem (e a legenda, se houver) são
      primeiro COPIADAS para uma subpasta "_rename_cache" dentro da MESMA
      pasta de origem. Só depois disso o novo nome é escrito, e só então
      o arquivo antigo é removido da pasta principal. Se qualquer coisa
      falhar no meio do caminho, a cópia de segurança continua intacta
      dentro de "_rename_cache" — nada é perdido. Ao final de um rename
      bem-sucedido, a cópia de staging daquele arquivo é apagada (ela já
      cumpriu seu papel de rede de segurança).

   "_rename_cache" é ignorada pelo scanner de subpastas (mesmo tratamento
   já dado a "_trash" e "_archive" em tagmanager_ui_core.js), então não
   aparece na lista de subpastas do dataset.
--------------------------------------------------------------------- */
window.confirmRename = async function() {
    if(selectedIndices.size === 0) return;
    const newBaseName = document.getElementById('rename-input').value.trim();
    if (!newBaseName) { document.getElementById('rename-dropdown').classList.remove('open'); return; }

    document.getElementById('rename-dropdown').classList.remove('open');
    const indices = Array.from(selectedIndices).sort((a,b) => a - b);
    const isMulti = indices.length > 1;

    // ---------- FASE 0: planeja todos os nomes de destino primeiro ----------
    const plans = [];
    {
        let count = 1;
        for (let idx of indices) {
            const img = imageFiles[idx];
            const oldExt = img.name.split('.').pop();
            const paddedCount = String(count).padStart(3, '0');
            const finalBaseName = isMulti ? `${newBaseName}_${paddedCount}` : newBaseName;
            const newImgName = `${finalBaseName}.${oldExt}`;
            const textFormat = img.ext || 'txt';
            const oldTextName = `${img.baseName}.${textFormat}`;
            const newTextName = `${finalBaseName}.${textFormat}`;
            plans.push({ idx, img, oldName: img.name, newImgName, oldTextName, newTextName, finalBaseName });
            count++;
        }
    }

    // ---------- FASE 1: checagem de colisão contra arquivos FORA da seleção ----------
    const oldNamesInBatch = new Set();
    plans.forEach(p => { oldNamesInBatch.add(p.oldName); oldNamesInBatch.add(p.oldTextName); });

    const dirListingCache = new Map(); // parentDirHandle -> Set(nomes existentes)
    async function listExistingNames(dirHandle) {
        if (dirListingCache.has(dirHandle)) return dirListingCache.get(dirHandle);
        const names = new Set();
        try { for await (const entry of dirHandle.values()) names.add(entry.name); } catch(e) {}
        dirListingCache.set(dirHandle, names);
        return names;
    }

    const collisions = [];
    for (const p of plans) {
        if (p.oldName === p.newImgName && p.oldTextName === p.newTextName) continue; // nada muda, sem risco
        const existing = await listExistingNames(p.img.parentDirHandle);
        if (p.newImgName !== p.oldName && existing.has(p.newImgName) && !oldNamesInBatch.has(p.newImgName)) {
            collisions.push(p.newImgName);
        }
        if (p.img.hasFile && p.newTextName !== p.oldTextName && existing.has(p.newTextName) && !oldNamesInBatch.has(p.newTextName)) {
            collisions.push(p.newTextName);
        }
    }

    if (collisions.length > 0) {
        const preview = [...new Set(collisions)].slice(0, 5).join(', ');
        const more = collisions.length > 5 ? ` (+${collisions.length - 5} more)` : '';
        if (!confirm(`⚠️ WARNING: ${collisions.length} target filename(s) already exist in this folder and are NOT part of the images you're renaming:\n${preview}${more}\n\nContinuing would OVERWRITE and PERMANENTLY LOSE the content of those existing files.\n\nClick Cancel to pick a different name/prefix instead. Continue anyway and overwrite them?`)) {
            return;
        }
    }

    // ---------- FASE 2: staging + rename com rede de segurança ----------
    let renamedCount = 0;
    const cacheDirByParent = new Map();
    async function getCacheDir(parentDirHandle) {
        if (cacheDirByParent.has(parentDirHandle)) return cacheDirByParent.get(parentDirHandle);
        const cacheDir = await parentDirHandle.getDirectoryHandle('_rename_cache', { create: true });
        cacheDirByParent.set(parentDirHandle, cacheDir);
        return cacheDir;
    }

    for (const p of plans) {
        const { img, oldName, newImgName, oldTextName, newTextName, finalBaseName } = p;
        if (oldName === newImgName && oldTextName === newTextName) continue;

        let cacheDir = null;
        let stagedImgName = null;
        let stagedTextName = null;

        try {
            cacheDir = await getCacheDir(img.parentDirHandle);

            // 2a. Copia o original (imagem) para o staging ANTES de mexer em qualquer coisa
            const oldImgHandle = await img.parentDirHandle.getFileHandle(oldName);
            const oldImgFile = await oldImgHandle.getFile();
            const stagedImgHandle = await cacheDir.getFileHandle(oldName, { create: true });
            const stagedImgWritable = await stagedImgHandle.createWritable();
            await stagedImgWritable.write(await oldImgFile.arrayBuffer());
            await stagedImgWritable.close();
            stagedImgName = oldName;

            const textFormat = img.ext || 'txt';

            // 2b. Copia a legenda original (se existir no disco) para o staging também
            if (img.hasFile) {
                try {
                    const oldTextHandle = await img.parentDirHandle.getFileHandle(oldTextName);
                    const oldTextFile = await oldTextHandle.getFile();
                    const stagedTextHandle = await cacheDir.getFileHandle(oldTextName, { create: true });
                    const stagedTextWritable = await stagedTextHandle.createWritable();
                    await stagedTextWritable.write(await oldTextFile.arrayBuffer());
                    await stagedTextWritable.close();
                    stagedTextName = oldTextName;
                } catch(e) { /* legenda pode não existir ainda no disco — tudo bem */ }
            }

            // 2c. Só AGORA escreve a imagem com o novo nome, lendo da cópia staged
            //     (garante que já temos uma cópia segura antes de sobrescrever nada)
            const stagedImgFile = await (await cacheDir.getFileHandle(oldName)).getFile();
            const newImgHandle = await img.parentDirHandle.getFileHandle(newImgName, { create: true });
            const writableImg = await newImgHandle.createWritable();
            await writableImg.write(await stagedImgFile.arrayBuffer());
            await writableImg.close();

            // 2d. Escreve a legenda com o novo nome, usando o conteúdo ATUAL em
            //     memória (img.content) — não o que está salvo no disco — assim
            //     edições de tags ainda não salvas (img.dirty) não se perdem.
            if (img.hasFile) {
                const contentToWrite = textFormat === 'json'
                    ? JSON.stringify({ tags: img.content }, null, 2)
                    : img.content;
                const newTextHandle = await img.parentDirHandle.getFileHandle(newTextName, { create: true });
                const writableText = await newTextHandle.createWritable();
                await writableText.write(contentToWrite);
                await writableText.close();
                if (typeof window.markClean === 'function') window.markClean(img);
            }

            // 2e. Novos arquivos confirmados no disco — agora sim remove os antigos
            if (oldName !== newImgName) {
                try { await img.parentDirHandle.removeEntry(oldName); } catch(e) {}
            }
            if (stagedTextName && oldTextName !== newTextName) {
                try { await img.parentDirHandle.removeEntry(oldTextName); } catch(e) {}
            }

            // 2f. Rename concluído com sucesso — limpa a cópia de staging deste arquivo
            try { await cacheDir.removeEntry(stagedImgName); } catch(e) {}
            if (stagedTextName) { try { await cacheDir.removeEntry(stagedTextName); } catch(e) {} }

            if (datasetConfig[img.baseName]) {
                datasetConfig[finalBaseName] = datasetConfig[img.baseName];
                if (img.baseName !== finalBaseName) delete datasetConfig[img.baseName];
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
                if (img.baseName !== finalBaseName) delete pendingTagsStore[img.baseName];
            }
            if (window.hiddenImagesStore.has(img.baseName)) {
                window.hiddenImagesStore.delete(img.baseName);
                window.hiddenImagesStore.add(finalBaseName);
            }
            img.name = newImgName; img.baseName = finalBaseName;
            renamedCount++;
        } catch(e) {
            console.error("Rename Error:", e);
            // Se algo deu errado, a cópia original (se já chegou a ser copiada) continua
            // segura dentro de "_rename_cache" — nada foi perdido, só não foi renomeado.
            if (window.showAlert) window.showAlert(`⚠️ Could not rename "${oldName}" — the original is safely kept in the "_rename_cache" folder, nothing was lost.`, 'error');
        }
    }

    if(renamedCount > 0) {
        await window.markDatasetEdited();
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
        await window.markDatasetEdited();
        window.showAlert(`Cloned ${clonedCount} file(s)!`, "success");
        if (typeof window.refreshDataset === 'function') await window.refreshDataset();
    }
}