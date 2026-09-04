/* =========================================================================
   ARCHIVE MODULE (Standalone — não mexe nos outros arquivos)
   ---------------------------------------------------------------------
   O Arquivo é SEMPRE local: cria/usa uma subpasta "_archive" dentro da
   MESMA pasta de onde a imagem veio (img.parentDirHandle). Ou seja, o
   arquivo fica sempre dentro do próprio dataset, só que separado do
   conjunto principal (não aparece mais na lista, igual a "hidden").

   FIX (remoção do módulo de Trash): o sistema de Lixeira global
   (tagmanager_trash.js) foi removido do app. Duas coisas dependiam dele:

   1) "Excluir" dentro do painel do Arquivo — antes reaproveitava
      window.moveToGlobalTrash() pra mandar o item pra Lixeira de
      verdade (de onde ainda dava pra Restaurar ou Excluir Permanente).
      Sem Trash, isso vira uma exclusão DIRETA e PERMANENTE dos arquivos
      dentro de "_archive" — o botão agora é "🗑️ Delete Permanently" e
      pede confirmação explícita, deixando claro que não tem volta. Note
      que isso só afeta o arquivo já arquivado (dentro de "_archive");
      nunca mexe no dataset principal.

   2) Posicionamento no DOM: o botão "📦 Archive" da topbar e o botão
      "📦" na barra de seleção da lista usavam elementos do Trash
      (#btn-open-trash / o botão de Delete da lista) como referência de
      onde se inserir. Agora ancoram direto em #btn-remove (topbar) e
      no botão de Clone (barra de seleção) — os mesmos vizinhos que o
      Trash usava antes dele existir.

   ---------------------------------------------------------------------
   FIX (isolamento de tamanho de miniatura): o slider de miniaturas deste
   painel tem sua PRÓPRIA variável ("--thumb-size-archive") e sua PRÓPRIA
   preferência salva ("archive-thumb-size"), totalmente independente do
   painel principal (Dataset).
========================================================================= */

(function () {

    const ARCHIVE_DB_NAME = 'TagManagerArchiveDB';
    const MANIFEST_STORE = 'manifest';

    /* ---------- INDEXEDDB ---------- */
    function initArchiveDB() {
        return new Promise((res, rej) => {
            try {
                const req = indexedDB.open(ARCHIVE_DB_NAME, 1);
                req.onupgradeneeded = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(MANIFEST_STORE)) db.createObjectStore(MANIFEST_STORE, { keyPath: 'id', autoIncrement: true });
                };
                req.onsuccess = e => res(e.target.result);
                req.onerror = e => rej(e.target.error);
            } catch (err) { rej(err); }
        });
    }

    async function addArchiveManifestEntry(entry) {
        try {
            const db = await initArchiveDB();
            return new Promise(r => {
                const tx = db.transaction(MANIFEST_STORE, 'readwrite');
                const req = tx.objectStore(MANIFEST_STORE).add(entry);
                req.onsuccess = () => r(req.result);
                tx.onerror = () => r(null);
            });
        } catch (e) { return null; }
    }

    async function getAllArchiveManifestEntries() {
        try {
            const db = await initArchiveDB();
            return new Promise(r => {
                const tx = db.transaction(MANIFEST_STORE, 'readonly');
                const req = tx.objectStore(MANIFEST_STORE).getAll();
                req.onsuccess = () => r(req.result || []);
                req.onerror = () => r([]);
            });
        } catch (e) { return []; }
    }

    /* ---------------------------------------------------------------------
       BUG FIX: o manifesto do Archive é um único IndexedDB GLOBAL
       (TagManagerArchiveDB), compartilhado entre TODOS os datasets já
       arquivados alguma vez — não só o que está carregado agora. Antes, o
       painel simplesmente listava getAllArchiveManifestEntries() inteiro,
       misturando itens arquivados de pastas completamente diferentes.

       Esta função filtra e devolve SÓ as entradas cuja pasta de origem
       (entry.parentDirHandle) é a MESMA pasta do dataset atualmente
       carregado (window.currentImagesHandle). Comparar FileSystemHandle
       por igualdade de referência (===) não é confiável entre sessões/
       handles reidratados do IndexedDB, então usamos o método nativo
       handle.isSameEntry() da File System Access API, que compara a
       identidade real do arquivo/pasta no disco. */
    async function getArchiveEntriesForCurrentDataset() {
        const allItems = await getAllArchiveManifestEntries();
        const currentHandle = window.currentImagesHandle || window.rootHandle;
        if (!currentHandle) return [];

        const matches = await Promise.all(allItems.map(async (entry) => {
            try {
                if (entry.parentDirHandle && typeof entry.parentDirHandle.isSameEntry === 'function') {
                    return await entry.parentDirHandle.isSameEntry(currentHandle);
                }
            } catch (e) {
                // Handle inválido/revogado (ex: pasta foi movida/deletada fora do app) — não é a atual.
            }
            return false;
        }));

        return allItems.filter((_, i) => matches[i]);
    }

    async function deleteArchiveManifestEntry(id) {
        try {
            const db = await initArchiveDB();
            return new Promise(r => {
                const tx = db.transaction(MANIFEST_STORE, 'readwrite');
                tx.objectStore(MANIFEST_STORE).delete(id);
                tx.oncomplete = () => r(true);
                tx.onerror = () => r(false);
            });
        } catch (e) { return false; }
    }

    /* ---------- MOVER PARA O ARQUIVO (chamado por window.archiveSelectedImages) ----------
       GARANTIA: a pasta "_archive" é SEMPRE criada dentro de
       img.parentDirHandle — a MESMA pasta de onde a imagem veio (o dataset
       atual, seja o root ou uma subpasta). Se img.parentDirHandle estiver
       ausente por qualquer motivo, a função agora avisa claramente em vez
       de falhar em silêncio. */
    window.moveToArchive = async function (img) {
        if (!img || !img.parentDirHandle) {
            console.error('moveToArchive: missing image or parentDirHandle', img);
            if (window.showAlert) window.showAlert(`❌ Could not archive "${img && img.name ? img.name : 'file'}": no folder handle available.`, 'error');
            return false;
        }
        try {
            if ((await img.parentDirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await img.parentDirHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
            }

            const archiveDir = await img.parentDirHandle.getDirectoryHandle('_archive', { create: true });

            const moveOne = async (fileName) => {
                try {
                    const srcHandle = await img.parentDirHandle.getFileHandle(fileName);
                    const srcFile = await srcHandle.getFile();
                    const destHandle = await archiveDir.getFileHandle(fileName, { create: true });
                    const writable = await destHandle.createWritable();
                    await writable.write(await srcFile.arrayBuffer());
                    await writable.close();
                    await img.parentDirHandle.removeEntry(fileName);
                    return true;
                } catch (e) {
                    return false; // arquivo pode não existir (ex: sem legenda ainda) — tudo bem
                }
            };

            const movedImage = await moveOne(img.name);
            if (!movedImage) return false; // a imagem em si precisa mover com sucesso

            const movedTextNames = [];
            if (await moveOne(img.baseName + '.txt')) movedTextNames.push(img.baseName + '.txt');
            if (await moveOne(img.baseName + '.json')) movedTextNames.push(img.baseName + '.json');

            await addArchiveManifestEntry({
                archiveDirHandle: archiveDir,
                archiveImageName: img.name,
                archiveTextNames: movedTextNames,
                originalName: img.name,
                originalBaseName: img.baseName,
                originalExt: img.ext,
                parentDirHandle: img.parentDirHandle,
                folderLabel: (img.parentDirHandle && img.parentDirHandle.name) || '',
                archivedAt: Date.now()
            });

            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    };

    /* ---------- AÇÃO EM MASSA (mesmo padrão de window.deleteSelectedImages, agora removido) ---------- */
    window.archiveSelectedImages = async function () {
        if (typeof selectedIndices === 'undefined' || selectedIndices.size === 0) return;
        if (!confirm(`Move ${selectedIndices.size} image(s) and text data to the Archive (📦)?\nArchived files stay INSIDE THIS SAME DATASET FOLDER (in a hidden "_archive" subfolder — never moved elsewhere) and won't show up in the list. You can restore them anytime from the Archive panel, or permanently delete them from there when you no longer need them.`)) return;

        const indices = Array.from(selectedIndices).sort((a, b) => b - a);
        let archivedCount = 0;
        let failedNames = [];

        for (const i of indices) {
            const img = imageFiles[i];
            try {
                if (img.dirty && typeof window.saveImageToDisk === 'function') await window.saveImageToDisk(img);
                const ok = await window.moveToArchive(img);
                if (!ok) { failedNames.push(img.name); continue; }
                if (datasetConfig[img.baseName]) delete datasetConfig[img.baseName];
                if (pendingTagsStore[img.baseName]) delete pendingTagsStore[img.baseName];
                if (window.hiddenImagesStore.has(img.baseName)) window.hiddenImagesStore.delete(img.baseName);
                archivedCount++;
            } catch (e) {
                console.error('archiveSelectedImages failed for', img && img.name, e);
                failedNames.push(img ? img.name : '?');
            }
        }

        if (archivedCount > 0) {
            await window.markDatasetEdited();
            if (typeof savePendingTagsStore === 'function') await savePendingTagsStore(window.currentImagesHandle);
            if (window.showAlert) window.showAlert(`Archived ${archivedCount} file(s) 📦 (kept in this same dataset folder).`, 'success');
            if (typeof window.refreshDataset === 'function') await window.refreshDataset();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
        }

        // Feedback explícito em vez de silenciosamente ignorar falhas — antes,
        // um item que falhasse (ex: permissão negada, arquivo bloqueado)
        // simplesmente não aparecia em lugar nenhum, sem nenhum aviso.
        if (failedNames.length > 0 && window.showAlert) {
            window.showAlert(`⚠️ Could not archive ${failedNames.length} file(s): ${failedNames.slice(0, 5).join(', ')}${failedNames.length > 5 ? '...' : ''}`, 'error');
        }
    };

    /* ---------- RESTAURAR (volta pra pasta original, fora do Arquivo) ---------- */
    window.restoreArchiveEntry = async function (entry) {
        try {
            const parent = entry.parentDirHandle;
            if ((await parent.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await parent.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                    if (window.showAlert) window.showAlert('Permission denied for the original folder.', 'error');
                    return;
                }
            }

            const moveBack = async (fileName) => {
                const srcHandle = await entry.archiveDirHandle.getFileHandle(fileName);
                const file = await srcHandle.getFile();
                const destHandle = await parent.getFileHandle(fileName, { create: true });
                const writable = await destHandle.createWritable();
                await writable.write(await file.arrayBuffer());
                await writable.close();
                await entry.archiveDirHandle.removeEntry(fileName);
            };

            await moveBack(entry.archiveImageName);
            for (const t of entry.archiveTextNames) await moveBack(t);

            await deleteArchiveManifestEntry(entry.id);
            if (window.showAlert) window.showAlert(`Restored "${entry.originalName}" from the Archive.`, 'success');
            await renderArchiveList();
            if (typeof window.refreshDataset === 'function') await window.refreshDataset();
        } catch (e) {
            console.error(e);
            if (window.showAlert) window.showAlert('Error restoring file — the original folder may no longer be accessible.', 'error');
        }
    };

    /* ---------- "EXCLUIR" NO ARQUIVO — AGORA PERMANENTE DE VERDADE ----------
       Antes reaproveitava window.moveToGlobalTrash() (tagmanager_trash.js,
       removido do app) pra mandar o item pra uma Lixeira de verdade, de
       onde ainda dava pra recuperar. Sem Trash, esta ação apaga os
       arquivos DIRETAMENTE de dentro de "_archive" — não tem recuperação
       depois disso. Só afeta o que já está arquivado; o dataset principal
       nunca é tocado por esta função. */
    window.deleteArchiveEntryPermanently = async function (entry) {
        if (!confirm(`⚠️ PERMANENTLY delete "${entry.originalName}" from the Archive?\n\nThis removes the archived image and caption for good — it CANNOT be restored afterwards. The original dataset is not affected (this only touches the copy already sitting inside "_archive").`)) return;

        try {
            try { await entry.archiveDirHandle.removeEntry(entry.archiveImageName); } catch (e) {}
            for (const t of entry.archiveTextNames) { try { await entry.archiveDirHandle.removeEntry(t); } catch (e) {} }
            await deleteArchiveManifestEntry(entry.id);
            if (window.showAlert) window.showAlert(`"${entry.originalName}" permanently deleted from the Archive.`, 'info');
            await renderArchiveList();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
        } catch (e) {
            console.error(e);
            if (window.showAlert) window.showAlert('Error deleting file from the Archive.', 'error');
        }
    };

    /* ---------- TAMANHO DE MINIATURA — ISOLADO DO DATASET ---------- */
    window.updateArchiveThumbSize = function (val, skipSave = false) {
        document.documentElement.style.setProperty('--thumb-size-archive', val + 'px');
        if (!skipSave && typeof window.saveSetting === 'function') window.saveSetting('archive-thumb-size', val);
    };

    /* ---------- UI ---------- */
    const style = document.createElement('style');
    style.innerHTML = `
        #btn-open-archive { color: #aaa; margin-left: 5px; }
        #btn-open-archive:hover { color: #4db8ff; border-color: #4db8ff; }
        #btn-open-archive.has-items { color: #66ccff; border-color: #0066aa; }

        #modal-archive .tool-modal { width: 600px; max-height: 84vh; }
        #archive-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; max-height: 55vh; }
        .archive-item { display: flex; align-items: center; gap: 10px; background: #151515; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px; }
        .archive-item img { width: var(--thumb-size-archive); height: auto; object-fit: cover; border-radius: 4px; border: 1px solid #333; flex-shrink: 0; cursor: zoom-in; }
        .archive-item-name { flex: 1; font-size: 11px; color: #ddd; word-break: break-all; }
        .archive-item button { font-size: 11px; padding: 6px 10px; flex-shrink: 0; }
        .btn-archive-restore { background: #0d2a18; color: #00ff99; border: 1px solid #00aa66; }
        .btn-archive-restore:hover { background: #00aa66; color: #000; }
        .btn-archive-delete-perm { background: #2a0000; color: #ff6060; border: 1px solid #aa0000; }
        .btn-archive-delete-perm:hover { background: #ff4444; color: #fff; }
        .btn-archive-pin { background: #0d1f2a; color: #66ccff; border: 1px solid #144a63; }
        .btn-archive-pin:hover { background: #66ccff; color: #000; }
        .btn-archive-pin.pinned-active { background: #00aa66; color: #000; border-color: #00cc88; }
        #archive-thumb-bar { display:flex; align-items:center; gap:10px; padding: 8px 0 2px; border-top: 1px solid #222; margin-top: 6px; flex-shrink: 0; }

        .list-archive-btn { background:#151515; border-color:#555; color:#aaa; }

        /* Zoom PRÓPRIO do Archive (não reaproveita o #modal-image/#image-popout
           compartilhado pelo resto do app). Um z-index dedicado evita que o
           zoom renderize atrás do painel do Archive, já que o overlay dele é
           injetado no DOM depois. */
        #modal-archive-zoom { z-index: 150; }
        #archive-zoom-wrapper { max-width: 90%; max-height: 90%; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        #archive-zoom-img { max-width: 100%; max-height: 90vh; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); user-select: none; -webkit-user-drag: none; }
    `;
    document.head.appendChild(style);

    /* ---------- ZOOM PRÓPRIO (isolado do #modal-image compartilhado) ---------- */
    function buildArchiveZoomModal() {
        if (document.getElementById('modal-archive-zoom')) return;

        const overlay = document.createElement('div');
        overlay.id = 'modal-archive-zoom';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => overlay.classList.remove('active');

        overlay.innerHTML = `
            <div id="archive-zoom-wrapper" onclick="event.stopPropagation()">
                <img id="archive-zoom-img" src="">
            </div>
        `;
        document.body.appendChild(overlay);
    }

    window.openArchiveImageZoom = function (url) {
        if (!url) return;
        buildArchiveZoomModal();
        document.getElementById('archive-zoom-img').src = url;
        document.getElementById('modal-archive-zoom').classList.add('active');
    };

    /* ---------- PIN DIRETO DO ARQUIVO ----------
       Reaproveita o painel de Pin já existente (tagmanager_pin_image.js —
       precisa carregar ANTES deste arquivo), montando uma pseudo-imagem
       lendo a legenda (.txt ou .json) e a miniatura direto de dentro da
       pasta "_archive" — sem precisar restaurar o item pra conferir as
       tags dele. Somente-leitura, não mexe em nada do Arquivo. */
    async function buildArchivePseudoImage(entry) {
        let content = '';
        let ext = entry.originalExt || 'txt';

        for (const tName of (entry.archiveTextNames || [])) {
            try {
                const fh = await entry.archiveDirHandle.getFileHandle(tName);
                const text = await (await fh.getFile()).text();
                const tExt = tName.slice(tName.lastIndexOf('.') + 1).toLowerCase();
                if (tExt === 'json') {
                    try {
                        const obj = JSON.parse(text);
                        content = obj.tags || obj.caption || '';
                    } catch (e) { content = text; }
                    ext = 'json';
                } else {
                    content = text;
                    ext = 'txt';
                }
                break;
            } catch (e) { /* essa legenda pode não existir — tenta a próxima */ }
        }

        let imageUrl = '';
        try {
            const fh = await entry.archiveDirHandle.getFileHandle(entry.archiveImageName);
            imageUrl = URL.createObjectURL(await fh.getFile());
            window._archiveObjectUrls.push(imageUrl);
        } catch (e) {}

        return {
            baseName: entry.originalBaseName,
            name: entry.originalName,
            url: imageUrl,
            content: content,
            ext: ext,
            parentDirHandle: entry.archiveDirHandle,
            folderName: `📦 ${entry.folderLabel || 'Archive'}`
        };
    }

    window.pinArchiveEntry = async function (entry, btnEl) {
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳'; }
        try {
            const pseudoImg = await buildArchivePseudoImage(entry);
            if (!pseudoImg.url) {
                if (window.showAlert) window.showAlert('Could not load this image to pin.', 'error');
                return;
            }
            if (typeof window.pinImage !== 'function') {
                if (window.showAlert) window.showAlert('Pin module not loaded.', 'error');
                return;
            }
            window.pinImage(pseudoImg);
        } finally {
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.textContent = '📌';
                if (typeof window.isImagePinned === 'function') {
                    btnEl.classList.toggle('pinned-active', window.isImagePinned({ parentDirHandle: entry.archiveDirHandle, baseName: entry.originalBaseName }));
                }
            }
        }
    };

    function buildModal() {
        if (document.getElementById('modal-archive')) return;

        const overlay = document.createElement('div');
        overlay.id = 'modal-archive';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-archive');

        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>📦 Archive</span>
                    <button onclick="window.closeModal('modal-archive')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div style="font-size:11px; color:#888; margin: -4px 0 10px;">
                    Archived files stay inside each dataset's own folder (in a hidden "_archive" subfolder), separate from the main set. "Delete Permanently" removes the archived copy for good — this cannot be undone.
                </div>
                <div id="archive-list"><div style="color:#666; font-size:12px; text-align:center; padding:15px;">Loading...</div></div>
                <div id="archive-thumb-bar">
                    <span style="font-size:11px; color:#555;">🔍</span>
                    <input type="range" id="archive-thumb-slider" min="70" max="500" style="flex:1; accent-color:#00ff99;" oninput="window.updateArchiveThumbSize(this.value)">
                    <span style="font-size:14px; color:#555;">🖼️</span>
                </div>
                <div class="modal-buttons">
                    <button class="btn-cancel" onclick="window.closeModal('modal-archive')">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    // Evita vazamento de blob URLs entre renderizações do modal
    window._archiveObjectUrls = window._archiveObjectUrls || [];

    async function renderArchiveList() {
        buildModal();

        window._archiveObjectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
        window._archiveObjectUrls = [];

        const thumbSlider = document.getElementById('archive-thumb-slider');
        if (thumbSlider) {
            const savedSize = (typeof window.getSetting === 'function') ? await window.getSetting('archive-thumb-size', 70) : 70;
            thumbSlider.value = savedSize;
            window.updateArchiveThumbSize(savedSize, true);
        }

        const list = document.getElementById('archive-list');
        list.innerHTML = '<div style="color:#666; font-size:12px; text-align:center; padding:15px;">Loading...</div>';

        const items = await getArchiveEntriesForCurrentDataset();
        items.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
        list.innerHTML = '';

        if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();

        if (items.length === 0) {
            list.innerHTML = '<div style="color:#555; font-size:12px; text-align:center; padding:20px;">Archive is empty for this dataset.</div>';
            return;
        }

        for (const entry of items) {
            let url = '';
            try {
                const fh = await entry.archiveDirHandle.getFileHandle(entry.archiveImageName);
                url = URL.createObjectURL(await fh.getFile());
                window._archiveObjectUrls.push(url);
            } catch (e) {}

            const dateStr = entry.archivedAt ? new Date(entry.archivedAt).toLocaleString() : '';

            const row = document.createElement('div');
            row.className = 'archive-item';
            row.innerHTML = `
                <img src="${url}" title="Double-click to zoom">
                <div class="archive-item-name">
                    <div>${entry.originalName}</div>
                    <div style="color:#666; font-size:10px; margin-top:2px;">📂 ${entry.folderLabel || '—'} · ${dateStr}</div>
                </div>
                <button class="btn-archive-pin" title="Pin this image to view its tags in the Pinned panel — no need to restore it first">📌</button>
                <button class="btn-archive-restore" title="Restore to the original folder">♻️ Restore</button>
                <button class="btn-archive-delete-perm" title="Permanently delete this archived file — cannot be undone">🗑️ Delete Permanently</button>
            `;
            const pinBtn = row.querySelector('.btn-archive-pin');
            if (pinBtn) {
                if (typeof window.isImagePinned === 'function') {
                    pinBtn.classList.toggle('pinned-active', window.isImagePinned({ parentDirHandle: entry.archiveDirHandle, baseName: entry.originalBaseName }));
                }
                pinBtn.onclick = () => window.pinArchiveEntry(entry, pinBtn);
            }
            row.querySelector('.btn-archive-restore').onclick = () => window.restoreArchiveEntry(entry);
            row.querySelector('.btn-archive-delete-perm').onclick = () => window.deleteArchiveEntryPermanently(entry);

            const imgEl = row.querySelector('img');
            if (imgEl && url) {
                imgEl.ondblclick = () => window.openArchiveImageZoom(url);
            }

            list.appendChild(row);
        }
    }

    window.updateArchiveButtonState = async function () {
        const btn = document.getElementById('btn-open-archive');
        if (!btn) return;
        const items = await getArchiveEntriesForCurrentDataset();
        btn.classList.toggle('has-items', items.length > 0);
        btn.title = items.length > 0
            ? `${items.length} item(s) archived in THIS dataset — click to view`
            : 'View / restore archived images';
    };

    window.openArchiveModal = async function () {
        buildModal();
        window.openModal('modal-archive');
        await renderArchiveList();
    };

    /* ---------- BOTÕES INJETADOS ---------- */

    // 1) Botão no topbar. Antes ancorava em #btn-open-trash (criado pelo
    //    tagmanager_trash.js, removido do app); agora ancora direto em
    //    #btn-remove — o mesmo vizinho que o Trash usava antes de existir.
    function injectArchiveTopbarButton() {
        const anchor = document.getElementById('btn-remove');
        if (!anchor || document.getElementById('btn-open-archive')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-open-archive';
        btn.title = 'View / restore archived images';
        btn.textContent = '📦 Archive';
        btn.onclick = () => window.openArchiveModal();
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);

        window.updateArchiveButtonState();
    }

    // 2) Botão na barra de ações da seleção (ao lado de Hide/Focus/Rename/Clone).
    //    Antes ancorava no botão "Delete Selected" (removido junto com o
    //    Trash, já que a Archive já cobre essa necessidade); agora ancora
    //    logo depois do botão de Clone.
    function injectArchiveSelectionButton() {
        const bar = document.getElementById('list-selection-actions');
        if (!bar || document.getElementById('btn-archive-selected')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-archive-selected';
        btn.className = 'btn-save-local list-archive-btn';
        btn.style.cssText = 'padding: 2px 6px; font-size: 14px;';
        btn.title = 'Move Selected to Archive';
        btn.textContent = '📦';
        btn.onclick = () => window.archiveSelectedImages();

        const cloneBtn = bar.querySelector('[onclick="window.openCloneModal()"]');
        if (cloneBtn) cloneBtn.insertAdjacentElement('afterend', btn);
        else bar.appendChild(btn);
    }

    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            injectArchiveTopbarButton();
            injectArchiveSelectionButton();
        }, 0);

        // Aplica o tamanho de miniatura salvo do Archive já no carregamento,
        // independente do modal ter sido aberto.
        if (typeof window.getSetting === 'function') {
            window.getSetting('archive-thumb-size', 70).then(savedSize => {
                window.updateArchiveThumbSize(savedSize, true);
            });
        }
    });

})();