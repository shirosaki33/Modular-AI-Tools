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

    /* ORIGINAL: a PRIMEIRA versão de cada nome de imagem que entra no Archive vira a
       "original": vai para _archive/original/ com o rótulo fixo "original". Enquanto
       existir _archive/original/<nome>, as próximas versões desse nome vão para o
       Archive normal (_archive/). Ao restaurar a original, a pasta original/ fica sem
       esse nome — e a próxima vez que a imagem for arquivada ela volta a ser a original. */
    const ORIGINAL_DIR = 'original';
    const ORIGINAL_LABEL = 'original';

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

    /* ---------- HELPERS DE ARQUIVO ---------- */
    async function fileExistsIn(dir, name) {
        try { await dir.getFileHandle(name); return true; } catch (e) { return false; }
    }

    // Copia para o destino (sobrescrevendo se já existir) e só então remove da origem.
    async function moveFileBetween(srcDir, destDir, name) {
        const srcHandle = await srcDir.getFileHandle(name);
        const file = await srcHandle.getFile();
        const destHandle = await destDir.getFileHandle(name, { create: true });
        const writable = await destHandle.createWritable();
        await writable.write(await file.arrayBuffer());
        await writable.close();
        await srcDir.removeEntry(name);
    }

    // Registros "normais" (não-original) do Archive com este nome de imagem, nesta pasta de dataset.
    async function findRootCopies(parent, imgName) {
        const all = await getAllArchiveManifestEntries();
        const out = [];
        for (const e of all) {
            if (e.isOriginal || e.archiveImageName !== imgName || !e.parentDirHandle) continue;
            try { if (await e.parentDirHandle.isSameEntry(parent)) out.push(e); } catch (err) {}
        }
        return out;
    }

    // Uma cópia nova com o mesmo nome SOBRESCREVE a antiga: o registro velho some e as
    // legendas antigas que a cópia nova não tem são removidas (senão ficariam órfãs).
    async function cleanupSupersededCopies(olds, keepTextNames) {
        for (const e of olds) {
            for (const t of (e.archiveTextNames || [])) {
                if (keepTextNames.includes(t)) continue;
                try { await e.archiveDirHandle.removeEntry(t); } catch (err) {}
            }
            await deleteArchiveManifestEntry(e.id);
        }
    }

    /* ---------- MOVER PARA O ARQUIVO (chamado por window.archiveSelectedImages) ----------
       GARANTIA: a pasta "_archive" é SEMPRE criada dentro de
       img.parentDirHandle — a MESMA pasta de onde a imagem veio (o dataset
       atual, seja o root ou uma subpasta). Se img.parentDirHandle estiver
       ausente por qualquer motivo, a função agora avisa claramente em vez
       de falhar em silêncio.

       ORIGINAL: se NÃO existe _archive/original/<nome da imagem>, esta versão vira a
       original (vai para _archive/original/, rótulo "original", isOriginal = true).
       Caso contrário vai para _archive/ normal, sobrescrevendo uma cópia antiga de
       mesmo nome (se houver).

       label (opcional): rótulo interno; sem ele vale o da ferramenta em
       andamento (window._archiveAutoLabel) ou "excluded". Ignorado quando a
       imagem vira a original. */
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

            const archiveRoot = await img.parentDirHandle.getDirectoryHandle('_archive', { create: true });

            let originalDir = null;
            try { originalDir = await archiveRoot.getDirectoryHandle(ORIGINAL_DIR); } catch (e) {}
            const hasOriginal = !!originalDir && await fileExistsIn(originalDir, img.name);
            const asOriginal = !hasOriginal;
            if (asOriginal && !originalDir) originalDir = await archiveRoot.getDirectoryHandle(ORIGINAL_DIR, { create: true });

            const archiveDir = asOriginal ? originalDir : archiveRoot;
            const olds = asOriginal ? [] : await findRootCopies(img.parentDirHandle, img.name);

            const moveOne = async (fileName) => {
                try {
                    await moveFileBetween(img.parentDirHandle, archiveDir, fileName);
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
                label: asOriginal ? ORIGINAL_LABEL : (cleanLabel(label) || cleanLabel(window._archiveAutoLabel) || DEFAULT_LABEL),
                isOriginal: asOriginal,
                // Mapa NL (tags NL internas ↔ texto limpo do .txt) — volta pro config ao restaurar.
                nlMap: (window.NLCodec ? await window.NLCodec.entriesFor(img.parentDirHandle, img.baseName) : null)
                    || (typeof datasetConfig !== 'undefined' && datasetConfig[img.baseName] && datasetConfig[img.baseName].nl) || null,
                archivedAt: Date.now()
            });

            await cleanupSupersededCopies(olds, movedTextNames);

            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    };

    /* ---------- TROCA AO RESTAURAR A ORIGINAL ----------
       Se já existe no dataset uma imagem com o nome da original (a versão modificada):
         1) a versão modificada (imagem + .txt/.json) vai para o Archive normal (_archive/),
            sobrescrevendo uma cópia antiga de mesmo nome;
         2) a original (imagem + legendas) volta para o dataset;
         3) o registro da original some — sem ela em original/, a próxima vez que a imagem
            for arquivada ela volta a ser a original.
       Retorna { partial: [legendas que não voltaram] }. */
    async function restoreNLMap(entry) {
        if (!entry || !entry.nlMap) return;
        if (window.NLCodec && entry.parentDirHandle) await window.NLCodec.setEntries(entry.parentDirHandle, entry.originalBaseName, entry.nlMap);
    }

    async function swapOriginalIntoDataset(entry) {
        const parent = entry.parentDirHandle;
        await restoreNLMap(entry);
        const imgName = entry.archiveImageName;
        const base = entry.originalBaseName;
        const partial = [];

        if (typeof window.saveAllImages === 'function') { try { await window.saveAllImages(true); } catch (e) {} }

        const archiveRoot = await parent.getDirectoryHandle('_archive', { create: true });
        const olds = await findRootCopies(parent, imgName);

        // 1) modificada -> Archive normal
        await moveFileBetween(parent, archiveRoot, imgName);
        const modifiedTexts = [];
        for (const ext of ['.txt', '.json']) {
            const n = base + ext;
            if (await fileExistsIn(parent, n)) { await moveFileBetween(parent, archiveRoot, n); modifiedTexts.push(n); }
        }
        await addArchiveManifestEntry({
            archiveDirHandle: archiveRoot,
            archiveImageName: imgName,
            archiveTextNames: modifiedTexts,
            originalName: imgName,
            originalBaseName: base,
            originalExt: entry.originalExt,
            parentDirHandle: parent,
            folderLabel: entry.folderLabel || (parent && parent.name) || '',
            label: cleanLabel(window._archiveAutoLabel) || 'modified',
            isOriginal: false,
            archivedAt: Date.now()
        });
        await cleanupSupersededCopies(olds, modifiedTexts);

        // 2) original -> dataset
        await moveFileBetween(entry.archiveDirHandle, parent, imgName);
        for (const t of (entry.archiveTextNames || [])) {
            try { await moveFileBetween(entry.archiveDirHandle, parent, t); }
            catch (e) { if (!e || e.name !== 'NotFoundError') { console.warn('caption not restored:', t, e); partial.push(t); } }
        }

        // 3) some o registro da original
        await deleteArchiveManifestEntry(entry.id);
        return { partial };
    }

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

        if (!confirm(`Move ${selectedIndices.size} image(s) and text data to the Archive (📦)?\nArchived files stay INSIDE THIS SAME DATASET FOLDER (in a hidden "_archive" subfolder — never moved elsewhere) and won't show up in the list. The first version of each image becomes its "original" (kept in _archive/original); later versions get the label "${DEFAULT_LABEL}". You can restore them anytime from the Archive panel, or permanently delete them from there when you no longer need them.`)) return;

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
            await restoreNLMap(entry);
            if ((await parent.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await parent.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                    if (window.showAlert) window.showAlert('Permission denied for the original folder.', 'error');
                    return;
                }
            }

            // Original + já existe uma imagem com esse nome no dataset: TROCA (a modificada vai para o Archive).
            if (entry.isOriginal && await fileExistsIn(parent, entry.archiveImageName)) {
                const r = await swapOriginalIntoDataset(entry);
                if (window.showAlert) {
                    window.showAlert(`Restored the original "${entry.originalName}". The version that was in the dataset moved to the Archive.`, 'success');
                    if (r.partial.length > 0) window.showAlert(`⚠️ Caption file(s) not restored: ${r.partial.join(', ')}`, 'error');
                }
                _selectedIds.delete(entry.id);
                await renderArchiveList();
                if (typeof window.refreshDataset === 'function') await window.refreshDataset();
                return;
            }

            const moveBack = async (fileName) => {
                await moveFileBetween(entry.archiveDirHandle, parent, fileName);
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

    /* ---------- RESTAURAR EM MASSA ----------
       Restaura vários itens de uma vez (selecionados por checkbox no painel).
       - Sequencial (um por vez) para não sobrecarregar o disco.
       - Se já existir um arquivo com o MESMO nome da imagem na pasta de
         destino, o item é PULADO (fica no Archive) em vez de sobrescrever.
       - Uma única atualização da lista/dataset e um único resumo no final. */
    const _selectedIds = new Set();
    let _lastCheckedIdx = -1;

    window.restoreArchiveEntries = async function (entries) {
        if (!entries || entries.length === 0) return;
        if (!confirm(`Restore ${entries.length} item(s) from the Archive back to the dataset folder?\n\nItems whose file name already exists in the folder will be skipped and stay in the Archive — except originals, which swap places with the version in the folder (that version moves to the Archive).`)) return;

        const btn = document.getElementById('archive-restore-selected');
        const restored = [];
        const failed = [];
        const partial = [];

        const fileExists = async (dir, name) => {
            try { await dir.getFileHandle(name); return true; } catch (e) { return false; }
        };

        for (let n = 0; n < entries.length; n++) {
            const entry = entries[n];
            if (btn) { btn.disabled = true; btn.textContent = `⏳ ${n + 1}/${entries.length}`; }
            try {
                const parent = entry.parentDirHandle;
                await restoreNLMap(entry);
                if ((await parent.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                    if ((await parent.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                        failed.push(`${entry.originalName} (permission denied)`);
                        continue;
                    }
                }
                if (await fileExists(parent, entry.archiveImageName)) {
                    if (entry.isOriginal) {
                        // Original: troca com a versão que está no dataset (a modificada vai para o Archive).
                        const r = await swapOriginalIntoDataset(entry);
                        partial.push(...r.partial);
                        _selectedIds.delete(entry.id);
                        restored.push(entry.originalName);
                        continue;
                    }
                    failed.push(`${entry.originalName} (name already exists in the folder)`);
                    continue;
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
                // A imagem já voltou: falha numa legenda NÃO pode deixar o registro órfão no manifesto.
                for (const t of (entry.archiveTextNames || [])) {
                    try { await moveBack(t); } catch (e) {
                        if (!e || e.name !== 'NotFoundError') { console.warn('caption not restored:', t, e); partial.push(t); }
                    }
                }

                await deleteArchiveManifestEntry(entry.id);
                _selectedIds.delete(entry.id);
                restored.push(entry.originalName);
            } catch (e) {
                console.error('restoreArchiveEntries failed for', entry && entry.originalName, e);
                failed.push(`${entry ? entry.originalName : '?'} (error)`);
            }
        }

        await renderArchiveList();
        if (restored.length > 0 && typeof window.refreshDataset === 'function') await window.refreshDataset();

        if (window.showAlert) {
            if (restored.length > 0) window.showAlert(`Restored ${restored.length} item(s) from the Archive ♻️`, 'success');
            if (partial.length > 0) window.showAlert(`⚠️ Image restored but ${partial.length} caption file(s) stayed in "_archive": ${partial.slice(0, 5).join(', ')}`, 'error');
            if (failed.length > 0) window.showAlert(`⚠️ Could not restore ${failed.length} item(s): ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '...' : ''}`, 'error');
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

    /* ---------- LIMPEZA DE ENTRADAS FANTASMA ----------
       Se o registro do manifesto existe mas a imagem NÃO está mais dentro de
       "_archive" (ex.: foi restaurada/movida e algo falhou antes de apagar o
       registro, ou o arquivo foi apagado/movido fora do app), o item aparecia
       na lista como se ainda estivesse lá. Aqui removemos esses registros.
       Só considera fantasma quando o erro é NotFoundError — erros de
       permissão/handle inacessível NÃO apagam nada. */
    async function pruneStaleArchiveEntries(items) {
        const alive = [];
        let removed = 0;
        for (const entry of items) {
            let stale = false;
            const dir = entry && entry.archiveDirHandle;
            const name = entry && entry.archiveImageName;
            if (!dir || typeof dir.getFileHandle !== 'function' || !name) {
                // Registro antigo/corrompido, sem handle ou nome utilizável.
                stale = true;
            } else {
                let canCheck = true;
                try {
                    if (typeof dir.queryPermission === 'function' && (await dir.queryPermission({ mode: 'read' })) !== 'granted') canCheck = false;
                } catch (e) { /* segue tentando ler */ }
                if (canCheck) {
                    try {
                        const fh = await dir.getFileHandle(name);
                        await fh.getFile(); // confirma que dá para LER o arquivo, não só achar o nome
                    } catch (e) {
                        // Permissão/segurança = não dá para verificar, mantém. Qualquer outro erro
                        // (NotFound, TypeMismatch, InvalidState, handle quebrado...) = o arquivo não está lá.
                        const n = e && e.name;
                        if (n !== 'NotAllowedError' && n !== 'SecurityError') {
                            stale = true;
                            console.warn('[Archive] stale entry removed:', name, n, e);
                        }
                    }
                }
            }
            if (stale) {
                // Só apaga o REGISTRO no manifesto; nunca mexe em arquivo nenhum.
                await deleteArchiveManifestEntry(entry.id);
                _selectedIds.delete(entry.id);
                removed++;
            } else alive.push(entry);
        }
        if (removed > 0 && window.showAlert) window.showAlert(`Removed ${removed} stale Archive entr${removed === 1 ? 'y' : 'ies'} (file no longer in "_archive").`, 'info');
        return alive;
    }

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

        /* Seleção em massa */
        #archive-select-bar { display: none; align-items: center; gap: 10px; flex-shrink: 0; padding: 6px 2px; font-size: 11px; color: #aaa; }
        #archive-select-bar label { display: flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
        #archive-select-count { color: #888; }
        #archive-restore-selected { margin-left: auto; font-size: 11px; padding: 5px 10px; background: #0d2a18; color: #00ff99; border: 1px solid #00aa66; }
        #archive-restore-selected:hover:not(:disabled) { background: #00aa66; color: #000; }
        #archive-restore-selected:disabled { opacity: 0.4; cursor: not-allowed; }
        .archive-row-check { width: 16px; height: 16px; flex-shrink: 0; cursor: pointer; accent-color: #00ff99; }
        .archive-item.selected { border-color: #00aa66; background: #101b15; }

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
                if (window.NLCodec && typeof datasetConfig !== 'undefined' && (entry.nlMap || (datasetConfig[entry.originalBaseName] && datasetConfig[entry.originalBaseName].nl))) {
                    content = window.NLCodec.decode(content, entry.nlMap || datasetConfig[entry.originalBaseName].nl);
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
                    Archived files stay inside each dataset's own folder (in a hidden "_archive" subfolder), separate from the main set. Items are labeled automatically by the tool that archived them (excluded / grayscale / bucket); click a label to rename it. The first version of each image is kept as its "original" (folder _archive/original); restoring it swaps it with the version currently in the dataset. "Delete Permanently" removes the archived copy for good — this cannot be undone.
                </div>
                <div id="archive-filter-bar">
                    <span style="font-size:13px;" title="Filter by label — click a label to show only it, click again to turn it off">🏷️</span>
                    <div id="archive-label-filter"></div>
                    <button id="archive-filter-clear" title="Turn off all label filters">✕ clear</button>
                    <span id="archive-filter-info"></span>
                </div>
                <div id="archive-select-bar">
                    <label title="Select / unselect all shown items (Shift+click a checkbox to select a range)"><input type="checkbox" id="archive-select-all" class="archive-row-check"> Select all</label>
                    <span id="archive-select-count"></span>
                    <button id="archive-select-clear" style="font-size:11px; background:transparent; border:none; color:#888; cursor:pointer; padding:2px 4px; display:none;" title="Unselect everything">✕ clear</button>
                    <button id="archive-restore-selected" disabled title="Restore all selected items to their original folder">♻️ Restore Selected</button>
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
        if (entry.isOriginal) return; // o rótulo "original" é fixo
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
                if (next.toLowerCase() === ORIGINAL_LABEL) {
                    if (window.showAlert) window.showAlert('The label "original" is reserved for original images.', 'error');
                } else if (next !== cleanLabel(entry.label)) {
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

        const allItems = await pruneStaleArchiveEntries(await getArchiveEntriesForCurrentDataset());
        allItems.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
        updateFilterUI(allItems);

        const items = allItems.filter(entryMatchesFilter);
        const info = document.getElementById('archive-filter-info');
        if (info) info.textContent = _activeLabels.size > 0 ? `${items.length} of ${allItems.length} shown` : `${allItems.length} item(s)`;

        list.innerHTML = '';

        if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();

        // Seleção sempre limitada ao que está visível (evita restaurar item escondido por filtro).
        const visibleIds = new Set(items.map(e => e.id));
        Array.from(_selectedIds).forEach(id => { if (!visibleIds.has(id)) _selectedIds.delete(id); });
        _lastCheckedIdx = -1;

        const updateSelectBar = () => {
            const bar = document.getElementById('archive-select-bar');
            if (!bar) return;
            bar.style.display = items.length > 0 ? 'flex' : 'none';
            const total = items.length;
            const sel = _selectedIds.size;
            const master = document.getElementById('archive-select-all');
            if (master) { master.checked = total > 0 && sel === total; master.indeterminate = sel > 0 && sel < total; }
            const cnt = document.getElementById('archive-select-count');
            if (cnt) cnt.textContent = sel > 0 ? `${sel} of ${total} selected` : '';
            const clr = document.getElementById('archive-select-clear');
            if (clr) clr.style.display = sel > 0 ? 'inline-block' : 'none';
            const rb = document.getElementById('archive-restore-selected');
            if (rb) { rb.disabled = sel === 0; rb.textContent = sel > 0 ? `♻️ Restore Selected (${sel})` : '♻️ Restore Selected'; }
            list.querySelectorAll('.archive-item').forEach(r => {
                const on = _selectedIds.has(Number(r.dataset.entryId));
                r.classList.toggle('selected', on);
                const cb = r.querySelector('.archive-row-check');
                if (cb) cb.checked = on;
            });
        };
        const master = document.getElementById('archive-select-all');
        if (master) master.onchange = () => {
            if (master.checked) items.forEach(e => _selectedIds.add(e.id)); else _selectedIds.clear();
            updateSelectBar();
        };
        const clearBtn = document.getElementById('archive-select-clear');
        if (clearBtn) clearBtn.onclick = () => { _selectedIds.clear(); updateSelectBar(); };
        const restoreBtn = document.getElementById('archive-restore-selected');
        if (restoreBtn) restoreBtn.onclick = () => window.restoreArchiveEntries(items.filter(e => _selectedIds.has(e.id)));

        if (items.length === 0) {
            updateSelectBar();
            list.innerHTML = allItems.length === 0
                ? '<div style="color:#555; font-size:12px; text-align:center; padding:20px;">Archive is empty for this dataset.</div>'
                : '<div style="color:#555; font-size:12px; text-align:center; padding:20px;">No archived images with this label.</div>';
            return;
        }

        for (let idx = 0; idx < items.length; idx++) {
            const entry = items[idx];
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
            row.dataset.entryId = entry.id;
            row.innerHTML = `
                <input type="checkbox" class="archive-row-check" title="Select (Shift+click to select a range)">
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
            const rowCheck = row.querySelector('.archive-row-check');
            rowCheck.onclick = (e) => {
                e.stopPropagation();
                const on = rowCheck.checked;
                if (e.shiftKey && _lastCheckedIdx >= 0) {
                    const [a, b] = [Math.min(_lastCheckedIdx, idx), Math.max(_lastCheckedIdx, idx)];
                    for (let k = a; k <= b; k++) { if (on) _selectedIds.add(items[k].id); else _selectedIds.delete(items[k].id); }
                } else if (on) _selectedIds.add(entry.id); else _selectedIds.delete(entry.id);
                _lastCheckedIdx = idx;
                updateSelectBar();
            };
            // Clicar no fundo do item também marca/desmarca (ignora botões, imagem, rótulo e inputs).
            row.onclick = (e) => {
                if (e.target.closest('button, input, img, .archive-label-chip')) return;
                rowCheck.checked = !rowCheck.checked;
                rowCheck.onclick(e);
            };

            const chip = row.querySelector('.archive-label-chip');
            if (chip && entry.isOriginal) chip.title = 'Original version — fixed label (restoring it swaps it with the current image in the dataset)';
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
        updateSelectBar();
    }

    window.updateArchiveButtonState = async function () {
        const btn = document.getElementById('btn-open-archive');
        if (!btn) return;
        const items = await pruneStaleArchiveEntries(await getArchiveEntriesForCurrentDataset());
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
