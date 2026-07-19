/* =========================================================================
   TRASH MODULE (Standalone — não mexe nos outros arquivos)
   ---------------------------------------------------------------------
   O navegador NÃO deixa uma página web mandar arquivos pra Lixeira/Recycle
   Bin real do sistema operacional (isso é bloqueado por segurança da API
   File System Access). Como alternativa mais próxima possível disso:

   - Enquanto o usuário não define uma pasta de lixeira global, tudo que é
     deletado vai automaticamente pra uma subpasta "_trash" temporária
     dentro do ROOT do dataset carregado (sem perguntar nada, sem travar
     o delete).
   - Quando o usuário define uma pasta global (📁 Change Folder, igual ao
     "Set Directory" dos Taggers), TUDO que estava na "_trash" temporária
     é movido automaticamente pra essa pasta nova, e a partir daí toda
     imagem removida de QUALQUER dataset vai direto pra ela.
   - Um manifesto (IndexedDB) guarda, pra cada item: o handle da pasta de
     origem, o nome original, e o nome físico salvo na lixeira — assim dá
     pra Restaurar exatamente pro lugar de onde saiu.
   - Tem botão de Restaurar E de Excluir Permanente (por item, ou tudo).
========================================================================= */

(function () {

    const TRASH_DB_NAME = 'TagManagerTrashDB';
    const CONFIG_STORE = 'config';
    const MANIFEST_STORE = 'manifest';

    /* ---------- INDEXEDDB ---------- */
    function initTrashDB() {
        return new Promise((res, rej) => {
            try {
                const req = indexedDB.open(TRASH_DB_NAME, 1);
                req.onupgradeneeded = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(CONFIG_STORE)) db.createObjectStore(CONFIG_STORE);
                    if (!db.objectStoreNames.contains(MANIFEST_STORE)) db.createObjectStore(MANIFEST_STORE, { keyPath: 'id', autoIncrement: true });
                };
                req.onsuccess = e => res(e.target.result);
                req.onerror = e => rej(e.target.error);
            } catch (err) { rej(err); }
        });
    }

    async function saveTrashDirHandleToDB(handle) {
        const db = await initTrashDB();
        return new Promise(r => {
            const tx = db.transaction(CONFIG_STORE, 'readwrite');
            tx.objectStore(CONFIG_STORE).put(handle, 'trash_dir');
            tx.oncomplete = () => r(true);
            tx.onerror = () => r(false);
        });
    }

    async function getSavedTrashDirHandle() {
        try {
            const db = await initTrashDB();
            return new Promise(r => {
                const tx = db.transaction(CONFIG_STORE, 'readonly');
                const req = tx.objectStore(CONFIG_STORE).get('trash_dir');
                req.onsuccess = () => r(req.result || null);
                req.onerror = () => r(null);
            });
        } catch (e) { return null; }
    }

    async function addManifestEntry(entry) {
        try {
            const db = await initTrashDB();
            return new Promise(r => {
                const tx = db.transaction(MANIFEST_STORE, 'readwrite');
                const req = tx.objectStore(MANIFEST_STORE).add(entry);
                req.onsuccess = () => r(req.result);
                tx.onerror = () => r(null);
            });
        } catch (e) { return null; }
    }

    async function getAllManifestEntries() {
        try {
            const db = await initTrashDB();
            return new Promise(r => {
                const tx = db.transaction(MANIFEST_STORE, 'readonly');
                const req = tx.objectStore(MANIFEST_STORE).getAll();
                req.onsuccess = () => r(req.result || []);
                req.onerror = () => r([]);
            });
        } catch (e) { return []; }
    }

    async function deleteManifestEntry(id) {
        try {
            const db = await initTrashDB();
            return new Promise(r => {
                const tx = db.transaction(MANIFEST_STORE, 'readwrite');
                tx.objectStore(MANIFEST_STORE).delete(id);
                tx.oncomplete = () => r(true);
                tx.onerror = () => r(false);
            });
        } catch (e) { return false; }
    }

    /* ---------- HANDLE DA PASTA DE LIXEIRA (com cache em memória) ---------- */
    window._trashDirHandleCache = window._trashDirHandleCache || null;
    window._trashModePreference = window._trashModePreference || 'global'; // 'local' | 'global'

    async function loadTrashModePreference() {
        if (typeof window.getSetting === 'function') {
            window._trashModePreference = await window.getSetting('trash-mode-preference', 'global');
        }
    }

    async function saveTrashModePreference(mode) {
        window._trashModePreference = mode;
        if (typeof window.saveSetting === 'function') await window.saveSetting('trash-mode-preference', mode);
    }

    async function hasGlobalFolderConfigured() {
        if (window._trashDirHandleCache) return true;
        return !!(await getSavedTrashDirHandle());
    }

    /* Resolve pra onde a lixeira deve apontar agora:
       1) Preferência é "local" -> sempre usa a "_trash" dentro do ROOT.
       2) Preferência é "global" e há uma pasta global configurada -> usa ela.
       3) Preferência é "global" mas nada foi configurado ainda -> cai pra
          Local automaticamente (pasta "_trash" dentro do ROOT), sem travar
          o delete. */
    async function resolveTrashTarget() {
        if (window._trashModePreference !== 'local') {
            if (window._trashDirHandleCache) {
                try {
                    if ((await window._trashDirHandleCache.queryPermission({ mode: 'readwrite' })) === 'granted') return { dir: window._trashDirHandleCache, usingFallback: false };
                    if ((await window._trashDirHandleCache.requestPermission({ mode: 'readwrite' })) === 'granted') return { dir: window._trashDirHandleCache, usingFallback: false };
                } catch (e) {}
            }

            let saved = await getSavedTrashDirHandle();
            if (saved) {
                try {
                    if ((await saved.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                        if ((await saved.requestPermission({ mode: 'readwrite' })) !== 'granted') saved = null;
                    }
                } catch (e) { saved = null; }
            }
            if (saved) { window._trashDirHandleCache = saved; return { dir: saved, usingFallback: false }; }
        }

        // Modo Local (por escolha do usuário, ou porque nada global foi configurado ainda)
        const rootHandle = window.rootHandle || window.currentImagesHandle;
        if (!rootHandle) return { dir: null, usingFallback: true };
        try {
            const localDir = await rootHandle.getDirectoryHandle('_trash', { create: true });
            return { dir: localDir, usingFallback: true };
        } catch (e) {
            return { dir: null, usingFallback: true };
        }
    }

    async function updateManifestEntry(entry) {
        try {
            const db = await initTrashDB();
            return new Promise(r => {
                const tx = db.transaction(MANIFEST_STORE, 'readwrite');
                tx.objectStore(MANIFEST_STORE).put(entry);
                tx.oncomplete = () => r(true);
                tx.onerror = () => r(false);
            });
        } catch (e) { return false; }
    }

    // Quando o usuário finalmente define uma pasta de lixeira de verdade,
    // move fisicamente tudo que estava na pasta temporária do root pra lá.
    async function migrateFallbackEntriesToNewFolder(newDirHandle) {
        const items = await getAllManifestEntries();
        const fallbackItems = items.filter(e => e.usingFallback);
        if (fallbackItems.length === 0) return 0;

        let migrated = 0;
        for (const entry of fallbackItems) {
            try {
                const oldDir = entry.trashDirHandle;
                const moveOne = async (name) => {
                    const srcHandle = await oldDir.getFileHandle(name);
                    const file = await srcHandle.getFile();
                    const destHandle = await newDirHandle.getFileHandle(name, { create: true });
                    const writable = await destHandle.createWritable();
                    await writable.write(await file.arrayBuffer());
                    await writable.close();
                    await oldDir.removeEntry(name);
                };

                await moveOne(entry.trashImageName);
                for (const t of entry.trashTextNames) await moveOne(t);

                entry.trashDirHandle = newDirHandle;
                entry.usingFallback = false;
                await updateManifestEntry(entry);
                migrated++;
            } catch (e) {
                console.error('Failed to migrate trash entry', entry, e);
            }
        }
        return migrated;
    }

    window.setTrashFolder = async function () {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            await saveTrashDirHandleToDB(handle);
            window._trashDirHandleCache = handle;
            await saveTrashModePreference('global');

            const migratedCount = await migrateFallbackEntriesToNewFolder(handle);

            if (window.showAlert) {
                window.showAlert(
                    migratedCount > 0
                        ? `Global Trash folder set to "${handle.name}". Moved ${migratedCount} item(s) out of the Local folder into it.`
                        : `Global Trash folder set to "${handle.name}".`,
                    'success'
                );
            }

            await updateTrashModeButtons();
            await updateTrashFolderLabel();
            const modal = document.getElementById('modal-trash');
            if (modal && modal.classList.contains('active')) await renderTrashList();
        } catch (e) {
            if (e.name !== 'AbortError' && window.showAlert) window.showAlert('Could not set the Trash folder.', 'error');
        }
    };

    window.setTrashMode = async function (mode) {
        if (mode === 'global' && !(await hasGlobalFolderConfigured())) {
            if (window.showAlert) window.showAlert('Set a Global folder first.', 'warn');
            return;
        }
        await saveTrashModePreference(mode);
        await updateTrashModeButtons();
        await updateTrashFolderLabel();
    };

    /* ---------- MOVER PRA LIXEIRA (chamado por tagmanager_ui_list.js) ---------- */
    window.moveToGlobalTrash = async function (img) {
        const { dir: targetDir, usingFallback } = await resolveTrashTarget();
        if (!targetDir) return false;

        try {
            // Prefixo único evita colisão de nomes quando imagens de pastas
            // diferentes (ou renomeadas depois) têm o mesmo nome de arquivo.
            const uid = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
            const prefix = `${uid}__`;

            const moveOne = async (fileName) => {
                try {
                    const srcHandle = await img.parentDirHandle.getFileHandle(fileName);
                    const srcFile = await srcHandle.getFile();
                    const destName = prefix + fileName;
                    const destHandle = await targetDir.getFileHandle(destName, { create: true });
                    const writable = await destHandle.createWritable();
                    await writable.write(await srcFile.arrayBuffer());
                    await writable.close();
                    await img.parentDirHandle.removeEntry(fileName);
                    return destName;
                } catch (e) {
                    return null; // arquivo pode nem existir (ex: sem legenda ainda) — tudo bem
                }
            };

            const movedImageName = await moveOne(img.name);
            if (!movedImageName) return false; // a imagem em si precisa mover com sucesso

            const movedTextNames = [];
            const movedTxt = await moveOne(img.baseName + '.txt');
            if (movedTxt) movedTextNames.push(movedTxt);
            const movedJson = await moveOne(img.baseName + '.json');
            if (movedJson) movedTextNames.push(movedJson);

            await addManifestEntry({
                trashDirHandle: targetDir,
                trashImageName: movedImageName,
                trashTextNames: movedTextNames,
                originalName: img.name,
                originalBaseName: img.baseName,
                originalExt: img.ext,
                parentDirHandle: img.parentDirHandle,
                folderLabel: (img.parentDirHandle && img.parentDirHandle.name) || '',
                usingFallback: usingFallback,
                deletedAt: Date.now()
            });

            if (typeof window.updateTrashButtonState === 'function') window.updateTrashButtonState();
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    };

    /* ---------- RESTAURAR / EXCLUIR PERMANENTE ---------- */
    window.restoreTrashEntry = async function (entry) {
        try {
            const parent = entry.parentDirHandle;
            if ((await parent.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await parent.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                    if (window.showAlert) window.showAlert('Permission denied for the original folder.', 'error');
                    return;
                }
            }

            const moveBack = async (trashName, destName) => {
                const srcHandle = await entry.trashDirHandle.getFileHandle(trashName);
                const file = await srcHandle.getFile();
                const destHandle = await parent.getFileHandle(destName, { create: true });
                const writable = await destHandle.createWritable();
                await writable.write(await file.arrayBuffer());
                await writable.close();
                await entry.trashDirHandle.removeEntry(trashName);
            };

            await moveBack(entry.trashImageName, entry.originalName);
            for (const trashTextName of entry.trashTextNames) {
                const dot = trashTextName.lastIndexOf('.');
                const ext = dot > -1 ? trashTextName.slice(dot) : '';
                await moveBack(trashTextName, entry.originalBaseName + ext);
            }

            await deleteManifestEntry(entry.id);
            if (window.showAlert) window.showAlert(`Restored "${entry.originalName}".`, 'success');
            await renderTrashList();
            if (typeof window.refreshDataset === 'function') await window.refreshDataset();
        } catch (e) {
            console.error(e);
            if (window.showAlert) window.showAlert('Error restoring file — the original folder may no longer be accessible.', 'error');
        }
    };

    window.deleteTrashEntryPermanently = async function (entry) {
        if (!confirm(`Permanently delete "${entry.originalName}"?\nThis CANNOT be undone.`)) return;
        try {
            try { await entry.trashDirHandle.removeEntry(entry.trashImageName); } catch (e) {}
            for (const t of entry.trashTextNames) { try { await entry.trashDirHandle.removeEntry(t); } catch (e) {} }
            await deleteManifestEntry(entry.id);
            await renderTrashList();
            if (window.showAlert) window.showAlert('Permanently deleted.', 'info');
        } catch (e) {
            if (window.showAlert) window.showAlert('Error deleting file.', 'error');
        }
    };

    window.emptyTrash = async function () {
        const items = await getAllManifestEntries();
        if (items.length === 0) { if (window.showAlert) window.showAlert('Trash is already empty.', 'info'); return; }
        if (!confirm(`Permanently delete all ${items.length} item(s) in the Trash?\nThis CANNOT be undone.`)) return;

        for (const entry of items) {
            try { await entry.trashDirHandle.removeEntry(entry.trashImageName); } catch (e) {}
            for (const t of entry.trashTextNames) { try { await entry.trashDirHandle.removeEntry(t); } catch (e) {} }
            await deleteManifestEntry(entry.id);
        }
        await renderTrashList();
        if (window.showAlert) window.showAlert('Trash emptied.', 'success');
    };

    /* ---------- UI ---------- */
    const style = document.createElement('style');
    style.innerHTML = `
        #btn-open-trash { color: #aaa; margin-left: 5px; }
        #btn-open-trash:hover { color: #ff6060; border-color: #ff6060; }
        #btn-open-trash.has-items { color: #ffcc66; border-color: #aa6600; }

        #modal-trash .tool-modal { width: 600px; max-height: 84vh; }
        #trash-folder-bar { display:flex; justify-content:space-between; align-items:flex-start; font-size:11px; color:#888; background:#111; border:1px solid #222; border-radius:6px; padding:10px; margin: -4px 0 8px; gap: 10px; }
        .trash-mode-toggle { display:flex; gap:6px; margin-bottom:6px; }
        .trash-mode-btn { background: transparent; border: 1px solid #444; color: #aaa; padding: 4px 10px; font-size: 11px; }
        .trash-mode-btn:hover:not(:disabled) { color: #fff; border-color: #666; }
        .trash-mode-btn.trash-mode-active { background: #0d2a18; border-color: #00aa66; color: #00ff99; }
        .trash-mode-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        #trash-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; max-height: 48vh; }
        .trash-item { display: flex; align-items: center; gap: 10px; background: #151515; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px; }
        .trash-item img { width: var(--thumb-size); height: auto; object-fit: cover; border-radius: 4px; border: 1px solid #333; flex-shrink: 0; cursor: zoom-in; }
        .trash-item-name { flex: 1; font-size: 11px; color: #ddd; word-break: break-all; }
        .trash-item button { font-size: 11px; padding: 6px 10px; flex-shrink: 0; }
        .btn-trash-restore { background: #0d2a18; color: #00ff99; border: 1px solid #00aa66; }
        .btn-trash-restore:hover { background: #00aa66; color: #000; }
        .btn-trash-delete { background: #2a0000; color: #ff6060; border: 1px solid #aa0000; }
        .btn-trash-delete:hover { background: #ff4444; color: #fff; }
        #trash-thumb-bar { display:flex; align-items:center; gap:10px; padding: 8px 0 2px; border-top: 1px solid #222; margin-top: 6px; flex-shrink: 0; }
    `;
    document.head.appendChild(style);

    function buildModal() {
        if (document.getElementById('modal-trash')) return;

        const overlay = document.createElement('div');
        overlay.id = 'modal-trash';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-trash');

        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🗑️ Trash Folder</span>
                    <button onclick="window.closeModal('modal-trash')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div id="trash-folder-bar">
                    <div style="flex:1;">
                        <div class="trash-mode-toggle">
                            <button id="btn-trash-mode-local" class="trash-mode-btn" onclick="window.setTrashMode('local')">🗂️ Local Folder</button>
                            <button id="btn-trash-mode-global" class="trash-mode-btn" onclick="window.setTrashMode('global')">🌐 Global Folder</button>
                        </div>
                        <span id="trash-folder-label">Loading...</span>
                    </div>
                    <button class="btn-save-local" onclick="window.setTrashFolder()">📁 Set Folder</button>
                </div>
                <div id="trash-list"><div style="color:#666; font-size:12px; text-align:center; padding:15px;">Loading...</div></div>
                <div id="trash-thumb-bar">
                    <span style="font-size:11px; color:#555;">🔍</span>
                    <input type="range" id="trash-thumb-slider" min="70" max="500" style="flex:1; accent-color:#00ff99;" oninput="window.updateThumbSize(this.value)">
                    <span style="font-size:14px; color:#555;">🖼️</span>
                </div>
                <div class="modal-buttons">
                    <button class="btn-cancel" style="color:#ff6060; border-color:#7a222c;" onclick="window.emptyTrash()">🔥 Empty Trash Permanently</button>
                    <button class="btn-cancel" onclick="window.closeModal('modal-trash')">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    async function updateTrashModeButtons() {
        const btnLocal = document.getElementById('btn-trash-mode-local');
        const btnGlobal = document.getElementById('btn-trash-mode-global');
        if (!btnLocal || !btnGlobal) return;

        const hasGlobal = await hasGlobalFolderConfigured();
        const mode = hasGlobal ? window._trashModePreference : 'local';

        btnLocal.classList.toggle('trash-mode-active', mode === 'local');
        btnGlobal.classList.toggle('trash-mode-active', mode === 'global');
        btnGlobal.disabled = !hasGlobal;
        btnGlobal.title = hasGlobal ? 'Use the Global Trash folder' : 'Set a Global folder first (📁 Set Folder)';
        btnLocal.title = 'Use a Local Trash folder inside this root';
    }

    async function updateTrashFolderLabel() {
        const el = document.getElementById('trash-folder-label');
        if (!el) return;

        const hasGlobal = await hasGlobalFolderConfigured();
        const mode = hasGlobal ? window._trashModePreference : 'local';

        if (mode === 'global') {
            const handle = window._trashDirHandleCache || await getSavedTrashDirHandle();
            el.textContent = `📁 ${handle.name} (Global)`;
        } else {
            const rootHandle = window.rootHandle || window.currentImagesHandle;
            el.textContent = rootHandle ? `📁 ${rootHandle.name} (Local)` : 'No folder loaded yet';
        }
    }

    // BUG FIX: cada render criava blob URLs novas pras miniaturas sem nunca
    // revogar as da render anterior — cada abertura do modal vazava memória.
    window._trashObjectUrls = window._trashObjectUrls || [];

    async function renderTrashList() {
        buildModal();
        await loadTrashModePreference();
        await updateTrashModeButtons();
        await updateTrashFolderLabel();

        window._trashObjectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
        window._trashObjectUrls = [];

        const thumbSlider = document.getElementById('trash-thumb-slider');
        if (thumbSlider) {
            const mainSlider = document.getElementById('thumb-slider');
            const currentSize = mainSlider ? mainSlider.value : (getComputedStyle(document.documentElement).getPropertyValue('--thumb-size') || '70').trim();
            thumbSlider.value = parseInt(currentSize, 10) || 70;
        }

        const list = document.getElementById('trash-list');
        list.innerHTML = '<div style="color:#666; font-size:12px; text-align:center; padding:15px;">Loading...</div>';

        const items = await getAllManifestEntries();
        items.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
        list.innerHTML = '';

        if (typeof window.updateTrashButtonState === 'function') window.updateTrashButtonState();

        if (items.length === 0) {
            list.innerHTML = '<div style="color:#555; font-size:12px; text-align:center; padding:20px;">Trash is empty.</div>';
            return;
        }

        for (const entry of items) {
            let url = '';
            try {
                const fh = await entry.trashDirHandle.getFileHandle(entry.trashImageName);
                url = URL.createObjectURL(await fh.getFile());
                window._trashObjectUrls.push(url);
            } catch (e) {}

            const dateStr = entry.deletedAt ? new Date(entry.deletedAt).toLocaleString() : '';
            const modeTag = entry.usingFallback ? ' · Local' : ' · Global';

            const row = document.createElement('div');
            row.className = 'trash-item';
            row.innerHTML = `
                <img src="${url}" title="Double-click to zoom">
                <div class="trash-item-name">
                    <div>${entry.originalName}</div>
                    <div style="color:#666; font-size:10px; margin-top:2px;">📂 ${entry.folderLabel || '—'}${modeTag} · ${dateStr}</div>
                </div>
                <button class="btn-trash-restore" title="Restore to the original folder">♻️ Restore</button>
                <button class="btn-trash-delete" title="Delete this item permanently">🗑️ Delete</button>
            `;
            row.querySelector('.btn-trash-restore').onclick = () => window.restoreTrashEntry(entry);
            row.querySelector('.btn-trash-delete').onclick = () => window.deleteTrashEntryPermanently(entry);

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

    window.updateTrashButtonState = async function () {
        const btn = document.getElementById('btn-open-trash');
        if (!btn) return;
        const items = await getAllManifestEntries();
        btn.classList.toggle('has-items', items.length > 0);
        btn.title = items.length > 0
            ? `${items.length} item(s) in Trash — click to view`
            : 'View / restore deleted images (Trash)';
    };

    window.openTrashModal = async function () {
        buildModal();
        window.openModal('modal-trash');
        await renderTrashList();
    };

    /* ---------- BOTÃO NO TOPBAR, AO LADO DO "Remove" (path) ---------- */
    function injectTrashButton() {
        const anchor = document.getElementById('btn-remove');
        if (!anchor || document.getElementById('btn-open-trash')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-open-trash';
        btn.title = 'View / restore deleted images (Trash Folder)';
        btn.textContent = '🗑️ Trash Folder';
        btn.onclick = () => window.openTrashModal();
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);

        window.updateTrashButtonState();
    }

    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(injectTrashButton, 0);
    });

})();