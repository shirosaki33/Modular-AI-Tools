/* Gallery Holder glue for gallery_bulk_trash.js (localhost only).
   The server needs the folder's REAL path on disk: it is read from the "📍 Path" field of the opened root folder.
   The sub-folder currently shown is sent as a path relative to that root. */
(function () {
    const isLocal = () => /^https?:$/.test(location.protocol) && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
    let target = null;                                   // { root, folder } resolved by ready()

    async function resolveTarget() {
        if (!rootHandle || !currentHandle) return null;
        const root = String((await getPathFromDB(rootHandle.name)) || '').trim().replace(/^"|"$/g, '');
        if (!root) return null;
        let rel = null;
        try { rel = await rootHandle.resolve(currentHandle); } catch (e) {}
        if (!rel) return null;
        return { root, folder: rel.join('/') };
    }

    async function post(item) {
        const r = await fetch('/api/trash_file', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ root: target.root, folder: target.folder, name: item.name })
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 404) throw new Error('This server does not have this API. Start it with the updated server_max.py.');
        if (!r.ok || data.status === 'error') throw new Error(data.message || ('Server error ' + r.status));
        return data;
    }

    GhBulk.init({
        anchorId: 'btn-sort',
        isLocal,
        toast: (msg, type) => showAlert(msg, type),
        async ready() {
            if (!isLocal()) { showAlert('This works only on the localhost server (server_max.py).', 'warn'); return false; }
            if (!currentHandle) { showAlert('Load a folder first.', 'warn'); return false; }
            target = await resolveTarget();
            if (!target) { showAlert('Type this folder\'s real path in 📍 Path first (e.g. C:\\My\\Folder\\Photos).', 'warn'); return false; }
            return true;
        },
        describe: () => 'Folder: ' + target.root + (target.folder ? ' / ' + target.folder : ''),
        context: () => currentHandle,
        list: () => (typeof ghList !== 'undefined' ? ghList : []),
        keyOf: it => it.name,
        blocked: () => (typeof isTagMode !== 'undefined' && isTagMode) || (typeof isRenameMode !== 'undefined' && isRenameMode) || (typeof isMergeMode !== 'undefined' && isMergeMode),
        leaveOtherModes() {
            if (typeof isTagMode !== 'undefined' && isTagMode) cancelBatchTags();
            if (typeof isRenameMode !== 'undefined' && isRenameMode) cancelRenameMode();
            if (typeof isMergeMode !== 'undefined' && isMergeMode) cancelMergeMode();
        },
        trash: post,
        removed(items) {
            items.forEach(it => {
                const baseName = it.name.substring(0, it.name.lastIndexOf('.')) || it.name;
                tagsPerFile.delete(it.name);
                if (typeof removeFromMergeGroup === 'function') removeFromMergeGroup(it.name, { skipPersist: true });
                if (window.ThumbLoader) window.ThumbLoader.forget(it.url);
                try { URL.revokeObjectURL(it.url); } catch (e) {}
                currentJsonFiles.delete(baseName + '.json');
            });
            const gone = new Set(items.map(it => it.name));
            currentFiles = currentFiles.filter(f => !gone.has(f.name));
            if (typeof persistMergeGroups === 'function') persistMergeGroups();
            backToGrid();
            renderGrid();
        }
    });
})();
