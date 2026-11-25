/* Gallery Timeline glue for gallery_bulk_trash.js (localhost only).
   Uses the real path typed in ⚙️ (tlRootPath) exactly like the single ♻️ button. */
(function () {
    GhBulk.init({
        anchorId: 'btn-folders',
        isLocal: tlIsLocal,
        toast: (msg, type, ms) => tlToast(msg, type, ms),
        ready() {
            if (!tlRoot) { tlToast('Add a directory first.', 'warn'); return false; }
            return tlLocalActionReady();
        },
        describe: () => 'Folder: ' + tlRootPath,
        context: () => tlRoot,
        list: () => tlFlat,
        keyOf: it => it.folder.relPath + '/' + it.name,
        trash: item => tlLocalPost('/api/trash_file', item),
        removed(items) {
            const byFolder = new Map();
            items.forEach(it => {
                tlReleaseItemUrl(it);
                if (!byFolder.has(it.folder)) byFolder.set(it.folder, new Set());
                byFolder.get(it.folder).add(it);
            });
            byFolder.forEach((gone, folder) => {
                gone.forEach(it => {
                    const baseName = it.name.substring(0, it.name.lastIndexOf('.')) || it.name;
                    folder.jsonSet.delete(baseName + '.json');
                });
                folder.images = folder.images.filter(i => !gone.has(i));
                tlUpdateFolderRange(folder);
            });
            tlStripDirty = true;
            tlRecompute();
            backToGrid();
            renderGrid();
            renderFolderSidebar();
            tlUpdateHeaderText();
        }
    });
})();
