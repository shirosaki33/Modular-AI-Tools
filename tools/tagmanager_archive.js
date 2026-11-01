/* =========================================================================
   ARCHIVE MODULE (Standalone — não mexe nos outros arquivos)
   ---------------------------------------------------------------------
   O Arquivo é SEMPRE local: cria/usa uma subpasta "_archive" dentro da
   MESMA pasta de onde a imagem veio (img.parentDirHandle). Ou seja, o
   arquivo fica sempre dentro do próprio dataset, só que separado do
   conjunto principal (não aparece mais na lista, igual a "hidden").

   NOVO (rótulo automático + micro filtro):
   - Todo item arquivado recebe um RÓTULO AUTOMÁTICO conforme a ferramenta
     que o mandou para cá — nada para digitar:
         📦 Archive (botão da lista)  -> "excluded"
         🖤 Convert to B&W            -> "grayscale"
         🪣 Fix/Change Bucket         -> "bucket"
   - O rótulo fica SÓ no manifesto do Archive (IndexedDB) — não altera
     nenhum arquivo de imagem/legenda e não aparece em outro lugar do app.
   - No painel do Archive: cada item mostra seu rótulo (clique para
     renomear, se quiser) e, quando existe pelo menos 1 rótulo, aparece um
     filtro em chips: cada rótulo aparece direto (com contador); clicar ativa,
     clicar de novo desativa. Vários ativos = mostra itens de QUALQUER um deles;
     nenhum ativo = mostra tudo. "No label" aparece quando há itens sem rótulo.
   - window.moveToArchive(img, label) aceita o rótulo como 2º parâmetro
     opcional. Sem ele, usa o rótulo da ferramenta em andamento (o Fix
     Bucket é detectado sozinho, sem editar o tagmanager_bucket_check.js)
     e, na falta de ambos, "excluded".
   - Itens arquivados antes desta versão ficam "sem rótulo" (dá para
     rotular pelo chip "＋ label").

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
    const LABEL_MAX = 40;
    const DEFAULT_LABEL = 'excluded';

    const esc = (v) => (typeof window.escHTML === 'function' ? window.escHTML(v) : String(v));

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

    // put() sobrescreve pela chave (id) — usado para editar o rótulo de um item já arquivado.
    async function updateArchiveManifestEntry(entry) {
        try {
            const db = await initArchiveDB();
            return new Promise(r => {
                const tx = db.transaction(MANIFEST_STORE, 'readwrite');
                tx.objectStore(MANIFEST_STORE).put(entry);
                tx.oncomplete = () => r(true);
                tx.onerror = () => r(false);
            });
        } catch (e) { return false; }
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

    /* ---------- RÓTULOS ---------- */
    function cleanLabel(raw) {
        return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
    }

    // Agrupa sem diferenciar maiúsculas/minúsculas ("Blurry" == "blurry").
    // Retorna Map(chaveMinúscula -> { label (grafia exibida), count }).
    function collectLabels(items) {
        const map = new Map();
        items.forEach(e => {
            const l = cleanLabel(e.label);
            if (!l) return;
            const k = l.toLowerCase();
            if (!map.has(k)) map.set(k, { label: l, count: 0 });
            map.get(k).count++;
        });
        return map;
    }

    function sortedLabelList(map) {
        return Array.from(map.values()).map(v => v.label).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    async function getKnownLabels() {
        const items = await getArchiveEntriesForCurrentDataset();
        return sortedLabelList(collectLabels(items));
    }

    // Um <datalist> único (usado pelo popout de motivo e pelo editor inline do painel).
    function fillLabelDatalist(labels) {
        let dl = document.getElementById('archive-label-list');
        if (!dl) {
            dl = document.createElement('datalist');
            dl.id = 'archive-label-list';
            document.body.appendChild(dl);
        }
        dl.innerHTML = '';
        labels.forEach(l => {
            const o = document.createElement('option');
            o.value = l;
            dl.appendChild(o);
        });
    }

    /* ---------- MOVER PARA O ARQUIVO (chamado por window.archiveSelectedImages) ----------
       GARANTIA: a pasta "_archive" é SEMPRE criada dentro de
       img.parentDirHandle — a MESMA pasta de onde a imagem veio (o dataset
       atual, seja o root ou uma subpasta). Se img.parentDirHandle estiver
       ausente por qualquer motivo, a função agora avisa claramente em vez
       de falhar em silêncio.

       label (opcional): rótulo interno; sem ele vale o da ferramenta em
       andamento (window._archiveAutoLabel) ou "excluded". */
    window.moveToArchive = async function (img, label) {
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
                label: cleanLabel(label) || cleanLabel(window._archiveAutoLabel) || DEFAULT_LABEL,
                archivedAt: Date.now()
            });

            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    };

    /* ---------- ROTULAGEM AUTOMÁTICA DO FIX BUCKET ----------
       O tagmanager_bucket_check.js chama window.moveToArchive(img) sem rótulo.
       Em vez de editá-lo, envolvemos window.applyFixBucket: enquanto ele roda,
       window._archiveAutoLabel = 'bucket' e o moveToArchive usa esse rótulo. */
    function installBucketAutoLabel() {
        if (typeof window.applyFixBucket !== 'function' || window.applyFixBucket.__archiveLabelWrapped) return;
        const original = window.applyFixBucket;
        const wrapped = async function () {
            const prev = window._archiveAutoLabel;
            window._archiveAutoLabel = 'bucket';
            try { return await original.apply(this, arguments); }
            finally { window._archiveAutoLabel = prev; }
        };
        wrapped.__archiveLabelWrapped = true;
        window.applyFixBucket = wrapped;
    }

    /* ---------- AÇÃO EM MASSA (mesmo padrão de window.deleteSelectedImages, agora removido) ---------- */
    window.archiveSelectedImages = async function () {
        if (typeof selectedIndices === 'undefined' || selectedIndices.size === 0) return;

        if (!confirm(`Move ${selectedIndices.size} image(s) and text data to the Archive (📦)?\nArchived files stay INSIDE THIS SAME DATASET FOLDER (in a hidden "_archive" subfolder — never moved elsewhere) and won't show up in the list. They get the label "${DEFAULT_LABEL}". You can restore them anytime from the Archive panel, or permanently delete them from there when you no longer need them.`)) return;

        const label = DEFAULT_LABEL;

        const indices = Array.from(selectedIndices).sort((a, b) => b - a);
        let archivedCount = 0;
        let failedNames = [];

        for (const i of indices) {
            const img = imageFiles[i];
            try {
                if (img.dirty && typeof window.saveImageToDisk === 'function') await window.saveImageToDisk(img);
                const ok = await window.moveToArchive(img, label);
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
            if (window.showAlert) window.showAlert(`Archived ${archivedCount} file(s) 📦 (label "${label}", kept in this same dataset folder).`, 'success');
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

        /* Micro filtro por rótulo */
        #archive-filter-bar { display: none; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; }
        #archive-label-filter { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
        .archive-filter-chip { font-size: 11px; font-weight: bold; color: #b08a40; background: #151007; border: 1px solid #4a3410; border-radius: 12px; padding: 2px 10px; cursor: pointer; user-select: none; white-space: nowrap; transition: 0.12s; }
        .archive-filter-chip:hover { color: #ffcc66; border-color: #aa6600; }
        .archive-filter-chip.active { color: #000; background: #ffcc66; border-color: #ffcc66; }
        .archive-filter-chip .afc-count { font-weight: normal; opacity: 0.7; margin-left: 4px; }
        .archive-filter-chip.no-label { font-weight: normal; font-style: italic; border-style: dashed; }
        .archive-filter-chip.no-label.active { color: #000; background: #aaa; border-color: #aaa; }
        #archive-filter-clear { font-size: 11px; background: transparent; border: none; color: #888; cursor: pointer; padding: 2px 4px; display: none; }
        #archive-filter-clear:hover { color: #ff6666; }
        #archive-filter-info { font-size: 10px; color: #666; }

        /* Rótulo de cada item */
        .archive-label-chip { display: inline-block; margin-top: 5px; font-size: 10px; font-weight: bold; color: #ffcc66; background: #2a1a00; border: 1px solid #aa6600; border-radius: 10px; padding: 1px 8px; cursor: pointer; user-select: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; }
        .archive-label-chip:hover { background: #aa6600; color: #000; }
        .archive-label-chip.empty { color: #666; background: transparent; border: 1px dashed #444; font-weight: normal; }
        .archive-label-chip.empty:hover { color: #ffcc66; border-color: #ffcc66; background: transparent; }
        .archive-item .archive-label-input { margin-top: 4px; font-size: 11px; padding: 3px 8px; width: 190px; max-width: 100%; box-sizing: border-box; }

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
                    Archived files stay inside each dataset's own folder (in a hidden "_archive" subfolder), separate from the main set. Items are labeled automatically by the tool that archived them (excluded / grayscale / bucket); click a label to rename it. "Delete Permanently" removes the archived copy for good — this cannot be undone.
                </div>
                <div id="archive-filter-bar">
                    <span style="font-size:13px;" title="Filter by label — click a label to show only it, click again to turn it off">🏷️</span>
                    <div id="archive-label-filter"></div>
                    <button id="archive-filter-clear" title="Turn off all label filters">✕ clear</button>
                    <span id="archive-filter-info"></span>
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

        document.getElementById('archive-filter-clear').onclick = () => {
            _activeLabels.clear();
            renderArchiveList();
        };
    }

    // Evita vazamento de blob URLs entre renderizações do modal
    window._archiveObjectUrls = window._archiveObjectUrls || [];

    /* ---------- FILTRO POR RÓTULO (chips) ----------
       _activeLabels: rótulos ligados ('texto em minúsculas' ou '__none__' = sem rótulo).
       Vazio = mostra tudo. Persiste enquanto a página estiver aberta. */
    const _activeLabels = new Set();

    function entryMatchesFilter(entry) {
        if (_activeLabels.size === 0) return true;
        const l = cleanLabel(entry.label).toLowerCase();
        return _activeLabels.has(l || '__none__');
    }

    // Monta os chips a partir de TODOS os itens do dataset e devolve a lista de rótulos conhecidos.
    function updateFilterUI(allItems) {
        const bar = document.getElementById('archive-filter-bar');
        const box = document.getElementById('archive-label-filter');
        const map = collectLabels(allItems);
        const labels = sortedLabelList(map);
        fillLabelDatalist(labels);

        const unlabeled = allItems.filter(e => !cleanLabel(e.label)).length;

        // Rótulos ligados que não existem mais (restaurado/excluído/editado) são desligados.
        Array.from(_activeLabels).forEach(k => {
            if (k === '__none__' ? unlabeled === 0 : !map.has(k)) _activeLabels.delete(k);
        });

        if (!bar || !box) return labels;
        if (map.size === 0) { bar.style.display = 'none'; _activeLabels.clear(); return labels; }

        box.innerHTML = '';
        const addChip = (key, text, count, extraClass) => {
            const chip = document.createElement('span');
            chip.className = 'archive-filter-chip' + (extraClass ? ' ' + extraClass : '') + (_activeLabels.has(key) ? ' active' : '');
            chip.innerHTML = `${esc(text)}<span class="afc-count">${count}</span>`;
            chip.title = _activeLabels.has(key) ? 'Click to turn this filter off' : 'Click to show only this label (click more labels to combine)';
            chip.onclick = () => {
                if (_activeLabels.has(key)) _activeLabels.delete(key); else _activeLabels.add(key);
                renderArchiveList();
            };
            box.appendChild(chip);
        };
        labels.forEach(l => addChip(l.toLowerCase(), l, map.get(l.toLowerCase()).count));
        if (unlabeled > 0) addChip('__none__', 'No label', unlabeled, 'no-label');

        const clear = document.getElementById('archive-filter-clear');
        if (clear) clear.style.display = _activeLabels.size > 0 ? 'inline-block' : 'none';
        bar.style.display = 'flex';
        return labels;
    }

    // Editor inline do rótulo (clique no chip).
    function startEditLabel(entry, chipEl) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'archive-label-input';
        input.setAttribute('list', 'archive-label-list');
        input.maxLength = LABEL_MAX;
        input.placeholder = 'label (Enter = save)';
        input.value = cleanLabel(entry.label);
        input.onclick = (e) => e.stopPropagation();

        let done = false;
        const commit = async (save) => {
            if (done) return;
            done = true;
            if (save) {
                const next = cleanLabel(input.value);
                if (next !== cleanLabel(entry.label)) {
                    entry.label = next;
                    const ok = await updateArchiveManifestEntry(entry);
                    if (!ok && window.showAlert) window.showAlert('Could not save the label.', 'error');
                }
            }
            renderArchiveList();
        };
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(true); }
            else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
        };
        input.onblur = () => commit(true);

        chipEl.replaceWith(input);
        input.focus();
        input.select();
    }

    async function renderArchiveList() {
        buildModal();

        window._archiveObjectUrls.forEach(u => {
            if (window.ThumbLoader) window.ThumbLoader.forget(u);
            try { URL.revokeObjectURL(u); } catch (e) {}
        });
        window._archiveObjectUrls = [];

        const thumbSlider = document.getElementById('archive-thumb-slider');
        if (thumbSlider) {
            const savedSize = (typeof window.getSetting === 'function') ? await window.getSetting('archive-thumb-size', 70) : 70;
            thumbSlider.value = savedSize;
            window.updateArchiveThumbSize(savedSize, true);
        }

        const list = document.getElementById('archive-list');
        list.innerHTML = '<div style="color:#666; font-size:12px; text-align:center; padding:15px;">Loading...</div>';

        const allItems = await getArchiveEntriesForCurrentDataset();
        allItems.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
        updateFilterUI(allItems);

        const items = allItems.filter(entryMatchesFilter);
        const info = document.getElementById('archive-filter-info');
        if (info) info.textContent = _activeLabels.size > 0 ? `${items.length} of ${allItems.length} shown` : `${allItems.length} item(s)`;

        list.innerHTML = '';

        if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();

        if (items.length === 0) {
            list.innerHTML = allItems.length === 0
                ? '<div style="color:#555; font-size:12px; text-align:center; padding:20px;">Archive is empty for this dataset.</div>'
                : '<div style="color:#555; font-size:12px; text-align:center; padding:20px;">No archived images with this label.</div>';
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
            const label = cleanLabel(entry.label);

            const row = document.createElement('div');
            row.className = 'archive-item';
            row.innerHTML = `
                <img title="Double-click to zoom" alt="">
                <div class="archive-item-name">
                    <div>${esc(entry.originalName)}</div>
                    <div style="color:#666; font-size:10px; margin-top:2px;">📂 ${esc(entry.folderLabel || '—')} · ${esc(dateStr)}</div>
                    <span class="archive-label-chip${label ? '' : ' empty'}" title="Click to ${label ? 'edit' : 'add'} the label">${label ? '🏷️ ' + esc(label) : '＋ label'}</span>
                </div>
                <button class="btn-archive-pin" title="Pin this image to view its tags in the Pinned panel — no need to restore it first">📌</button>
                <button class="btn-archive-restore" title="Restore to the original folder">♻️ Restore</button>
                <button class="btn-archive-delete-perm" title="Permanently delete this archived file — cannot be undone">🗑️ Delete Permanently</button>
            `;
            const chip = row.querySelector('.archive-label-chip');
            if (chip) chip.onclick = (e) => { e.stopPropagation(); startEditLabel(entry, chip); };

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
            // Miniatura reduzida (tools/thumb_loader.js); o zoom continua usando a original.
            if (imgEl && url) {
                if (window.ThumbLoader) window.ThumbLoader.attach(imgEl, url, { root: list }); else imgEl.src = url;
            }
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
        // Depois dos outros módulos (ordem de <script> não importa).
        setTimeout(installBucketAutoLabel, 300);

        // Aplica o tamanho de miniatura salvo do Archive já no carregamento,
        // independente do modal ter sido aberto.
        if (typeof window.getSetting === 'function') {
            window.getSetting('archive-thumb-size', 70).then(savedSize => {
                window.updateArchiveThumbSize(savedSize, true);
            });
        }
    });

})();
