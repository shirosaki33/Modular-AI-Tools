/* =========================================================================
   ARCHIVE MODULE (Standalone — não mexe nos outros arquivos)
   ---------------------------------------------------------------------
   Diferença chave em relação à Lixeira (tagmanager_trash.js):
   - A Lixeira pode apontar para uma pasta GLOBAL (fora do dataset) ou cair
     no fallback local "_trash" dentro do root.
   - O Arquivo é SEMPRE local: cria/usa uma subpasta "_archive" dentro da
     MESMA pasta de onde a imagem veio (img.parentDirHandle). Ou seja, o
     arquivo fica sempre dentro do próprio dataset, só que separado do
     conjunto principal (não aparece mais na lista, igual a "hidden"/trash).
   - "Excluir" dentro do painel do Arquivo NÃO apaga nada permanentemente:
     ele reaproveita window.moveToGlobalTrash() (já existe em
     tagmanager_trash.js) para mandar o item para a Lixeira de verdade,
     de onde aí sim dá pra Restaurar ou Excluir Permanentemente.
   - Como cada pasta de origem tem sua PRÓPRIA "_archive" (não é uma pasta
     global compartilhada), não precisamos de prefixo único no nome do
     arquivo: o namespace já é o mesmo da pasta original, então não há
     colisão. Isso também deixa "mandar para a Lixeira" trivial: os nomes
     dentro de "_archive" são idênticos aos nomes originais, então dá pra
     reusar moveToGlobalTrash() passando a "_archive" como se fosse a
     "pasta atual" da imagem.
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

    /* ---------- MOVER PARA O ARQUIVO (chamado por window.archiveSelectedImages) ---------- */
    window.moveToArchive = async function (img) {
        if (!img || !img.parentDirHandle) return false;
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

    /* ---------- AÇÃO EM MASSA (mesmo padrão de window.deleteSelectedImages) ---------- */
    window.archiveSelectedImages = async function () {
        if (typeof selectedIndices === 'undefined' || selectedIndices.size === 0) return;
        if (!confirm(`Move ${selectedIndices.size} image(s) to the Archive (📦)?\nArchived files stay inside this dataset's folder (in a hidden "_archive" subfolder) and won't show up in the list. You can restore them anytime from the Archive panel.`)) return;

        const indices = Array.from(selectedIndices).sort((a, b) => b - a);
        let archivedCount = 0;

        for (const i of indices) {
            const img = imageFiles[i];
            try {
                if (img.dirty && typeof window.saveImageToDisk === 'function') await window.saveImageToDisk(img);
                const ok = await window.moveToArchive(img);
                if (!ok) continue;
                if (datasetConfig[img.baseName]) delete datasetConfig[img.baseName];
                if (pendingTagsStore[img.baseName]) delete pendingTagsStore[img.baseName];
                if (window.hiddenImagesStore.has(img.baseName)) window.hiddenImagesStore.delete(img.baseName);
                archivedCount++;
            } catch (e) {}
        }

        if (archivedCount > 0) {
            window.markDatasetEdited();
            if (typeof savePendingTagsStore === 'function') await savePendingTagsStore(window.currentImagesHandle);
            if (window.showAlert) window.showAlert(`Archived ${archivedCount} file(s) 📦.`, 'success');
            if (typeof window.refreshDataset === 'function') await window.refreshDataset();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
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

    /* ---------- "EXCLUIR" NO ARQUIVO = MANDA PRA LIXEIRA DE VERDADE ----------
       Reaproveita window.moveToGlobalTrash() (tagmanager_trash.js) passando
       um objeto de imagem "sintético" cuja parentDirHandle é a própria
       pasta "_archive" — como os nomes lá dentro são idênticos aos
       originais (sem prefixo), isso funciona sem duplicar nenhuma lógica
       de movimentação de arquivo. */
    window.sendArchiveEntryToTrash = async function (entry) {
        if (!confirm(`Send "${entry.originalName}" from the Archive to the Trash?\n(From there you can still restore it, or delete it permanently.)`)) return;

        if (typeof window.moveToGlobalTrash !== 'function') {
            if (window.showAlert) window.showAlert('Trash module not loaded.', 'error');
            return;
        }

        try {
            const pseudoImg = {
                parentDirHandle: entry.archiveDirHandle,
                name: entry.archiveImageName,
                baseName: entry.originalBaseName,
                ext: entry.originalExt
            };
            const ok = await window.moveToGlobalTrash(pseudoImg);
            if (!ok) {
                if (window.showAlert) window.showAlert('Could not move this item to Trash.', 'error');
                return;
            }
            await deleteArchiveManifestEntry(entry.id);
            if (window.showAlert) window.showAlert(`Sent "${entry.originalName}" to Trash 🗑️.`, 'info');
            await renderArchiveList();
            if (typeof window.updateTrashButtonState === 'function') window.updateTrashButtonState();
        } catch (e) {
            console.error(e);
            if (window.showAlert) window.showAlert('Error sending item to Trash.', 'error');
        }
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
        .archive-item img { width: var(--thumb-size); height: auto; object-fit: cover; border-radius: 4px; border: 1px solid #333; flex-shrink: 0; cursor: zoom-in; }
        .archive-item-name { flex: 1; font-size: 11px; color: #ddd; word-break: break-all; }
        .archive-item button { font-size: 11px; padding: 6px 10px; flex-shrink: 0; }
        .btn-archive-restore { background: #0d2a18; color: #00ff99; border: 1px solid #00aa66; }
        .btn-archive-restore:hover { background: #00aa66; color: #000; }
        .btn-archive-trash { background: #2a0000; color: #ff6060; border: 1px solid #aa0000; }
        .btn-archive-trash:hover { background: #ff4444; color: #fff; }
        #archive-thumb-bar { display:flex; align-items:center; gap:10px; padding: 8px 0 2px; border-top: 1px solid #222; margin-top: 6px; flex-shrink: 0; }

        .list-archive-btn { background:#151515; border-color:#555; color:#aaa; }
    `;
    document.head.appendChild(style);

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
                    Archived files stay inside each dataset's own folder (in a hidden "_archive" subfolder), separate from the main set. "Send to Trash" moves an item to the real Trash (recoverable from there too).
                </div>
                <div id="archive-list"><div style="color:#666; font-size:12px; text-align:center; padding:15px;">Loading...</div></div>
                <div id="archive-thumb-bar">
                    <span style="font-size:11px; color:#555;">🔍</span>
                    <input type="range" id="archive-thumb-slider" min="70" max="500" style="flex:1; accent-color:#00ff99;" oninput="window.updateThumbSize(this.value)">
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
            const mainSlider = document.getElementById('thumb-slider');
            const currentSize = mainSlider ? mainSlider.value : (getComputedStyle(document.documentElement).getPropertyValue('--thumb-size') || '70').trim();
            thumbSlider.value = parseInt(currentSize, 10) || 70;
        }

        const list = document.getElementById('archive-list');
        list.innerHTML = '<div style="color:#666; font-size:12px; text-align:center; padding:15px;">Loading...</div>';

        const items = await getAllArchiveManifestEntries();
        items.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
        list.innerHTML = '';

        if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();

        if (items.length === 0) {
            list.innerHTML = '<div style="color:#555; font-size:12px; text-align:center; padding:20px;">Archive is empty.</div>';
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
                <button class="btn-archive-restore" title="Restore to the original folder">♻️ Restore</button>
                <button class="btn-archive-trash" title="Send this item to the Trash">🗑️ Send to Trash</button>
            `;
            row.querySelector('.btn-archive-restore').onclick = () => window.restoreArchiveEntry(entry);
            row.querySelector('.btn-archive-trash').onclick = () => window.sendArchiveEntryToTrash(entry);

            const imgEl = row.querySelector('img');
            if (imgEl && url) {
                imgEl.ondblclick = () => {
                    document.getElementById('image-popout').src = url;
                    window.openModal('modal-image');
                };
            }

            list.appendChild(row);
        }
    }

    window.updateArchiveButtonState = async function () {
        const btn = document.getElementById('btn-open-archive');
        if (!btn) return;
        const items = await getAllArchiveManifestEntries();
        btn.classList.toggle('has-items', items.length > 0);
        btn.title = items.length > 0
            ? `${items.length} item(s) in the Archive — click to view`
            : 'View / restore archived images';
    };

    window.openArchiveModal = async function () {
        buildModal();
        window.openModal('modal-archive');
        await renderArchiveList();
    };

    /* ---------- BOTÕES INJETADOS ---------- */

    // 1) Botão no topbar, ao lado do "🗑️ Trash Folder"
    function injectArchiveTopbarButton() {
        const anchor = document.getElementById('btn-open-trash');
        if (!anchor || document.getElementById('btn-open-archive')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-open-archive';
        btn.title = 'View / restore archived images';
        btn.textContent = '📦 Archive';
        btn.onclick = () => window.openArchiveModal();
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);

        window.updateArchiveButtonState();
    }

    // 2) Botão na barra de ações da seleção (ao lado de Hide/Focus/Rename/Clone/Delete)
    function injectArchiveSelectionButton() {
        const bar = document.getElementById('list-selection-actions');
        const deleteBtn = bar ? bar.querySelector('[onclick="window.deleteSelectedImages()"]') : null;
        if (!bar || document.getElementById('btn-archive-selected')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-archive-selected';
        btn.className = 'btn-save-local list-archive-btn';
        btn.style.cssText = 'padding: 2px 6px; font-size: 14px;';
        btn.title = 'Move Selected to Archive';
        btn.textContent = '📦';
        btn.onclick = () => window.archiveSelectedImages();

        if (deleteBtn) bar.insertBefore(btn, deleteBtn);
        else bar.appendChild(btn);
    }

    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            injectArchiveTopbarButton();
            injectArchiveSelectionButton();
        }, 0);
    });

})();