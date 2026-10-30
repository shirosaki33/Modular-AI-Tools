/* =========================================================================
   UI LOGIC - IMAGE LIST
   Handles the left panel, image rendering, multi-select, hide, and renames.
========================================================================= */

window.getCaptionCounts = function(img) {
    let tags = 0, nl = 0;
    if (img.content) {
        img.content.split(',').forEach(t => {
            const c = t.trim();
            if (!c) return;
            if (window.checkIfNL(c)) nl++; else tags++;
        });
    }
    return { tags, nl };
};
window.buildTypeBadge = function(img) {
    if (!img.hasFile) return 'Empty';
    const c = window.getCaptionCounts(img);
    return `🏷️ Tags (${c.tags}) · 📝 NL (${c.nl}) (.${img.ext || 'txt'})`;
};

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

/* =========================================================================
   MINIATURAS LEVES (memória)
   Antes o <img> da lista apontava para a imagem ORIGINAL; o Chrome guarda na
   RAM cada imagem já exibida decodificada em tamanho cheio (1024×1536 ≈ 6 MB),
   mesmo mostrada com 70 px — um dataset grande ocupava GBs e nada era solto.
   Agora: quando a linha chega perto da área visível (IntersectionObserver), a
   imagem é decodificada UMA vez, reduzida para a largura da miniatura e guardada
   como um JPEG pequeno (img._thumbBlobUrl). A decodificação cheia é liberada na
   hora (bitmap.close()). Na mesma passada a resolução real vai para img._resolution.
   - Largura gerada = degrau de 128 px ≥ tamanho do slider × devicePixelRatio
     (slider maior → gera de novo, maior). Imagem menor que isso: usa a original.
   - window.releaseImageThumbs(files): solta tudo de um dataset (troca de pasta).
========================================================================= */
;(function () {
    const QUEUE_LIMIT = 4;               // decodificações simultâneas
    let running = 0;
    const queue = [];
    let observer = null;

    function targetWidth() {
        const css = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--thumb-size'), 10) || 70;
        const want = Math.ceil(css * (window.devicePixelRatio || 1));
        return Math.max(128, Math.ceil(want / 128) * 128);
    }

    function setThumbSrc(img, el, url) {
        if (el.src !== url) el.src = url;
    }

    async function makeThumb(img) {
        const el = img._thumbEl;
        if (!el || !el.isConnected) { img._thumbQueued = false; return; }
        const width = targetWidth();
        const sourceUrl = img.url;
        try {
            const file = img.handle && typeof img.handle.getFile === 'function' ? await img.handle.getFile() : null;
            const blob = file || await (await fetch(sourceUrl)).blob();
            const bmp = await createImageBitmap(blob);
            const w = bmp.width, h = bmp.height;
            if (w > 0 && h > 0 && !img._resolution) img._resolution = { w, h };
            let url = sourceUrl;
            if (w > width) {
                const tw = width, th = Math.max(1, Math.round(h * width / w));
                const canvas = document.createElement('canvas');
                canvas.width = tw; canvas.height = th;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(bmp, 0, 0, tw, th);
                const small = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
                canvas.width = canvas.height = 0;
                if (small) url = URL.createObjectURL(small);
            }
            bmp.close();
            // A imagem pode ter mudado (crop do bucket) ou o dataset trocado enquanto isso.
            if (img.url !== sourceUrl || img._thumbEl !== el) { if (url !== sourceUrl) URL.revokeObjectURL(url); return; }
            if (img._thumbBlobUrl) URL.revokeObjectURL(img._thumbBlobUrl);
            img._thumbBlobUrl = url !== sourceUrl ? url : null;
            img._thumbBuiltFor = sourceUrl;
            img._thumbWidth = width;
            setThumbSrc(img, el, url);
            if (img._onThumbSize) img._onThumbSize();
        } catch (e) {
            setThumbSrc(img, el, sourceUrl);   // formato que o createImageBitmap não lê: usa a original
        } finally {
            img._thumbQueued = false;
        }
    }

    function pump() {
        while (running < QUEUE_LIMIT && queue.length) {
            const img = queue.shift();
            running++;
            makeThumb(img).finally(() => { running--; pump(); });
        }
    }

    function request(img) {
        const fresh = img._thumbBuiltFor === img.url && (img._thumbWidth || 0) >= targetWidth();
        if (fresh) { if (img._thumbBlobUrl) setThumbSrc(img, img._thumbEl, img._thumbBlobUrl); else setThumbSrc(img, img._thumbEl, img.url); return; }
        if (img._thumbQueued) return;
        img._thumbQueued = true;
        queue.push(img);
        pump();
    }

    function getObserver() {
        if (observer) return observer;
        observer = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (!en.isIntersecting) return;
                const img = en.target._tmImg;
                observer.unobserve(en.target);
                if (img) request(img);
            });
        }, { root: document.getElementById('image-list'), rootMargin: '400px 0px' });
        return observer;
    }

    window.attachImageThumb = function (img, el) {
        el._tmImg = img;
        if (typeof IntersectionObserver !== 'function') { el.src = img.url; return; }
        getObserver().observe(el);
    };

    // Slider de tamanho: miniaturas visíveis menores que o novo tamanho são refeitas.
    window.refreshImageThumbsForSize = function () {
        if (typeof imageFiles === 'undefined' || !observer) return;
        const need = targetWidth();
        imageFiles.forEach(img => {
            if (img._thumbEl && img._thumbEl.isConnected && img._thumbBlobUrl && (img._thumbWidth || 0) < need) observer.observe(img._thumbEl);
        });
    };

    window.releaseImageThumbs = function (files) {
        queue.length = 0;
        if (observer) { observer.disconnect(); observer = null; }
        (files || []).forEach(img => {
            if (!img) return;
            if (img._thumbBlobUrl) { try { URL.revokeObjectURL(img._thumbBlobUrl); } catch (e) {} }
            if (img._thumbEl) { img._thumbEl.removeAttribute('src'); img._thumbEl._tmImg = null; }
            img._thumbBlobUrl = null; img._thumbEl = null; img._thumbBuiltFor = null;
            img._onThumbSize = null; img.element = null;
        });
    };
})();

window.renderImageList = function() {
    const esc = (v) => (typeof window.escHTML === 'function' ? window.escHTML(v) : String(v));
    const listDiv = document.getElementById('image-list'); listDiv.innerHTML = '';
    imageFiles.forEach((img, index) => {
        if (img.hidden) {
            if (img.element) img.element.style.display = 'none';
            return;
        }

        const div = document.createElement('div');
        let typeBadge = window.buildTypeBadge(img);
        const suggestCount = (img.pendingAdd && img.pendingAdd.length) ? img.pendingAdd.length : 0;
        const suggestBadge = suggestCount > 0 ? `<span class="suggest-badge">💡${suggestCount}</span>` : '';

        div.className = `list-item ${img.hasFile ? 'has-data' : ''}`;
        div.innerHTML = `
            <div class="list-item-thumb-wrap">
                <button class="list-item-zoom-btn" title="Zoom / view full size">🔍</button>
            </div>
            <div class="list-item-info">
                <div class="list-item-name">${esc(img.name)}</div>
                <div class="list-item-status"><span class="list-item-type">${esc(typeBadge)}</span>${suggestBadge}<span class="list-item-resolution"></span></div>
            </div>
        `;
        div.onclick = (e) => window.handleListClick(index, e.shiftKey, e.ctrlKey || e.metaKey);

        // MINIATURA: o mesmo <img> é reaproveitado entre renders e recebe uma
        // miniatura PEQUENA gerada quando entra perto da área visível
        // (window.attachImageThumb, acima) — nunca a imagem original decodificada.
        const newThumb = !img._thumbEl || img._thumbUrl !== img.url;
        if (newThumb) {
            const t = document.createElement('img');
            t.decoding = 'async';
            t.alt = '';
            img._thumbEl = t;
            img._thumbUrl = img.url;
        }
        div.querySelector('.list-item-thumb-wrap').prepend(img._thumbEl);
        if (newThumb || !img._thumbEl.getAttribute('src')) window.attachImageThumb(img, img._thumbEl);

        // RESOLUÇÃO: vem do arquivo (img._resolution), preenchida ao gerar a miniatura.
        const resEl = div.querySelector('.list-item-resolution');
        if (resEl) {
            const paintRes = () => { if (img._resolution) resEl.textContent = ` · ${img._resolution.w}×${img._resolution.h}`; };
            paintRes();
            img._onThumbSize = paintRes;
        }

        // LUPA 🔍: abre o modal de zoom sem disparar a seleção da linha.
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
   Este é o ÚNICO lugar que decide a aparência da seleção — tanto o clique
   rápido quanto o render completo passam por aqui. Limpa o estilo inline
   (!important) do que não está mais selecionado e aplica a cor customizada
   (se o módulo de Highlights estiver carregado) no que está selecionado.
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
        if (!img.element) return;
        const span = img.element.querySelector('.list-item-type');
        if (span) span.textContent = window.buildTypeBadge(img);
        if (img.hasFile) img.element.classList.add('has-data');
        img.element.classList.remove('is-nl');
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
        // No Modo Compacto (🗂️), grupos colapsados continuariam escondendo as
        // imagens reveladas — limpa o estado de colapso.
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
   RENAME SEGURO (v3 — staging em 2 fases)
   ---------------------------------------------------------------------
   v2 copiava cada arquivo para "_rename_cache" e escrevia o novo nome
   logo em seguida, um arquivo por vez. Num rename múltiplo, o nome NOVO
   de um arquivo podia ser o nome ANTIGO de outro do mesmo lote que ainda
   não tinha sido processado (ex: ordem manual [x_002, x_001] renomeada
   para "x" → x_002 vira x_001 e sobrescreve o x_001 original antes dele
   ter sido copiado). Resultado: imagem perdida.

   v3:
   0) Planeja todos os nomes; rejeita nomes de destino repetidos.
   1) Checa colisão com arquivos FORA do lote (pede confirmação).
   2) FASE A — copia TODOS os originais do lote (imagem + legenda) para
      "_rename_cache". Se qualquer cópia falhar, para tudo (nada foi
      apagado ainda). Só depois remove os originais da pasta principal.
   3) FASE B — escreve cada arquivo com o nome final a partir da cópia
      staged e apaga a cópia. Se algo falhar, o original continua dentro
      de "_rename_cache".
--------------------------------------------------------------------- */
async function _copyFileInto(srcDir, srcName, dstDir, dstName) {
    const srcFile = await (await srcDir.getFileHandle(srcName)).getFile();
    const dstHandle = await dstDir.getFileHandle(dstName, { create: true });
    const w = await dstHandle.createWritable();
    await w.write(await srcFile.arrayBuffer());
    await w.close();
}

async function _fileExists(dirHandle, name) {
    try { await dirHandle.getFileHandle(name); return true; } catch (e) { return false; }
}

window.confirmRename = async function() {
    if(selectedIndices.size === 0) return;
    const newBaseName = document.getElementById('rename-input').value.trim();
    if (!newBaseName) { document.getElementById('rename-dropdown').classList.remove('open'); return; }
    if (/[\\/:*?"<>|]/.test(newBaseName)) {
        window.showAlert('The name contains characters that are not allowed in file names: \\ / : * ? " < > |', 'error');
        return;
    }

    document.getElementById('rename-dropdown').classList.remove('open');
    const indices = Array.from(selectedIndices).sort((a,b) => a - b);
    const isMulti = indices.length > 1;

    // ---------- FASE 0: planeja todos os nomes de destino ----------
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
            plans.push({ idx, img, oldName: img.name, newImgName, oldTextName, newTextName, finalBaseName, textFormat });
            count++;
        }
    }
    const activePlans = plans.filter(p => !(p.oldName === p.newImgName && p.oldTextName === p.newTextName));
    if (activePlans.length === 0) return;

    // Dois arquivos do lote não podem terminar com o mesmo nome (ex: a.png e a.jpg → "x" ok, mas a.png e b.png → "x.png" duas vezes).
    {
        const seen = new Map();
        for (const p of plans) {
            const key = (p.img.parentDirHandle && p.img.parentDirHandle.name || '') + '/' + p.newImgName.toLowerCase();
            if (seen.has(key)) {
                window.showAlert(`Two selected images would get the same name "${p.newImgName}". Nothing was renamed.`, 'error');
                return;
            }
            seen.set(key, true);
        }
    }

    // ---------- FASE 1: checagem de colisão contra arquivos FORA do lote ----------
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
    for (const p of activePlans) {
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

    const cacheDirByParent = new Map();
    async function getCacheDir(parentDirHandle) {
        if (cacheDirByParent.has(parentDirHandle)) return cacheDirByParent.get(parentDirHandle);
        const cacheDir = await parentDirHandle.getDirectoryHandle('_rename_cache', { create: true });
        cacheDirByParent.set(parentDirHandle, cacheDir);
        return cacheDir;
    }

    // ---------- FASE A: copia TODOS os originais do lote para o staging ----------
    for (const p of activePlans) {
        try {
            p.cacheDir = await getCacheDir(p.img.parentDirHandle);
            await _copyFileInto(p.img.parentDirHandle, p.oldName, p.cacheDir, p.oldName);
            p.stagedImg = true;
            if (await _fileExists(p.img.parentDirHandle, p.oldTextName)) {
                await _copyFileInto(p.img.parentDirHandle, p.oldTextName, p.cacheDir, p.oldTextName);
                p.stagedText = true;
            }
        } catch (e) {
            console.error('Rename staging error:', e);
            window.showAlert(`⚠️ Could not back up "${p.oldName}" before renaming. Nothing was renamed or deleted.`, 'error');
            return;
        }
    }

    // Todos os originais têm cópia segura — agora libera os nomes antigos na pasta principal.
    for (const p of activePlans) {
        try { await p.img.parentDirHandle.removeEntry(p.oldName); } catch(e) {}
        if (p.stagedText) { try { await p.img.parentDirHandle.removeEntry(p.oldTextName); } catch(e) {} }
    }

    // ---------- FASE B: escreve os nomes finais a partir das cópias staged ----------
    let renamedCount = 0;
    let failedCount = 0;
    for (const p of activePlans) {
        const { img, oldName, newImgName, newTextName, finalBaseName, textFormat, cacheDir } = p;
        try {
            await _copyFileInto(cacheDir, oldName, img.parentDirHandle, newImgName);

            // Legenda com o conteúdo ATUAL em memória (img.content), para não
            // perder edições ainda não salvas (img.dirty).
            if (img.hasFile) {
                const contentToWrite = textFormat === 'json'
                    ? JSON.stringify({ tags: img.content }, null, 2)
                    : img.content;
                const newTextHandle = await img.parentDirHandle.getFileHandle(newTextName, { create: true });
                const writableText = await newTextHandle.createWritable();
                await writableText.write(contentToWrite);
                await writableText.close();
                if (typeof window.markClean === 'function') window.markClean(img);
            } else if (p.stagedText) {
                await _copyFileInto(cacheDir, p.oldTextName, img.parentDirHandle, newTextName);
            }

            // Rename concluído — limpa a cópia de staging deste arquivo.
            try { await cacheDir.removeEntry(oldName); } catch(e) {}
            if (p.stagedText) { try { await cacheDir.removeEntry(p.oldTextName); } catch(e) {} }

            if (datasetConfig[img.baseName]) {
                datasetConfig[finalBaseName] = datasetConfig[img.baseName];
                if (img.baseName !== finalBaseName) delete datasetConfig[img.baseName];
            }
            // Renomear reorganiza a lista: limpa a ordem manual do Reorder Mode.
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
            failedCount++;
        }
    }

    if (failedCount > 0 && window.showAlert) {
        window.showAlert(`⚠️ ${failedCount} file(s) could not be renamed — the originals are safely kept in the "_rename_cache" folder, nothing was lost.`, 'error', 8000);
    }

    if(renamedCount > 0) {
        await window.markDatasetEdited();
        if (typeof window.savePendingTagsStore === 'function') await window.savePendingTagsStore(window.currentImagesHandle);
        if (failedCount === 0) window.showAlert(`Renamed ${renamedCount} files!`, "success");
    }
    if ((renamedCount > 0 || failedCount > 0) && typeof window.refreshDataset === 'function') await window.refreshDataset();
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
            let paddedN = String(n).padStart(3, '0');
            let newBaseName = `${img.baseName}_${paddedN}`;
            let bump = 1;
            while (existingBaseNames.has(newBaseName) || await _fileExists(img.parentDirHandle, `${newBaseName}.${oldExt}`)) {
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
                        // Conteúdo ATUAL em memória (inclui edições ainda não salvas).
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
                    delete datasetConfig[newBaseName].order; // clone entra na ordenação alfabética normal
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
