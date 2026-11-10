/* =========================================================================
   ARCHIVE MODULE (Standalone — não mexe nos outros arquivos)
   ---------------------------------------------------------------------
   O Arquivo é LOCAL por padrão: cria/usa uma subpasta "_archive" dentro da
   MESMA pasta de onde a imagem veio (img.parentDirHandle). Ou seja, o
   arquivo fica dentro do próprio dataset, só que separado do
   conjunto principal (não aparece mais na lista, igual a "hidden").

   NOVO (modo GLOBAL): quando a pasta adicionada tem datasets (subpastas) dentro
   dela, o painel mostra "🌐 Convert to Global". No modo Global existe UM
   "_archive" na raiz, com uma subpasta por dataset usado
   (<root>/_archive/<dataset>/ e <root>/_archive/<dataset>/original/). Ao converter,
   todos os datasets são vasculhados e os arquivos dos "_archive" locais são MOVIDOS
   para o global; o manifesto é atualizado. O modo fica gravado em
   <root>/_archive/.archive_global.json. No modo Global o painel lista os itens de
   TODOS os datasets da raiz.

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

        // GLOBAL MODE: o Archive pertence à pasta raiz — mostra TODOS os itens de
        // qualquer dataset que esteja dentro dela (não só o dataset aberto).
        if (window.rootHandle && await isGlobalMode(window.rootHandle)) {
            const root = window.rootHandle;
            const inRoot = await Promise.all(allItems.map(async (entry) => {
                try { return !!(entry.parentDirHandle && await root.resolve(entry.parentDirHandle)); } catch (e) { return false; }
            }));
            return allItems.filter((_, i) => inRoot[i]);
        }

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
    // Copies a file (keeps the source untouched).
    async function copyFileBetween(srcDir, destDir, name) {
        const file = await (await srcDir.getFileHandle(name)).getFile();
        const destHandle = await destDir.getFileHandle(name, { create: true });
        const writable = await destHandle.createWritable();
        await writable.write(await file.arrayBuffer());
        await writable.close();
    }

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

    /* ---------- MODO GLOBAL ----------
       Quando a pasta adicionada (window.rootHandle) tem datasets (subpastas) dentro
       dela, o Archive pode virar GLOBAL: em vez de um "_archive" dentro de cada
       dataset, existe UM "_archive" na raiz, com uma subpasta por dataset:
           <root>/_archive/<dataset>/            (versões normais)
           <root>/_archive/<dataset>/original/   (originais)
           <root>/_archive/<dataset>/<sub>/...   (sub-datasets espelham o caminho)
           <root>/_archive/_root/                (imagens que estão direto na raiz)
       O modo é gravado em disco por um arquivo-marcador dentro de <root>/_archive,
       então sobrevive a recarregar a página / trocar de navegador. */
    const GLOBAL_MARKER = '.archive_global.json';
    const GLOBAL_ROOT_FOLDER = '_root';
    const _globalCache = new WeakMap();
    let _converting = false;

    const isSysDir = (name) => (typeof window.isSystemDirName === 'function' ? window.isSystemDirName(name) : ['_trash', '_archive', '_rename_cache'].includes(name));

    async function rootHasDatasets(root) {
        if (!root) return false;
        try {
            for await (const e of root.values()) {
                if (e.kind === 'directory' && !isSysDir(e.name)) return true;
            }
        } catch (e) {}
        return false;
    }

    async function isGlobalMode(root) {
        root = root || window.rootHandle;
        if (!root) return false;
        if (_globalCache.has(root)) return _globalCache.get(root);
        let on = false;
        try {
            const a = await root.getDirectoryHandle('_archive');
            await a.getFileHandle(GLOBAL_MARKER);
            on = true;
        } catch (e) {}
        _globalCache.set(root, on);
        return on;
    }

    // Caminho (array de nomes) de `dir` a partir de `root`; [] = a própria raiz; null = fora da raiz.
    async function relPathFromRoot(root, dir) {
        try { return await root.resolve(dir); } catch (e) { return null; }
    }

    async function ensureGlobalDir(root, rel, create) {
        let dir = await root.getDirectoryHandle('_archive', { create });
        for (const seg of (rel.length ? rel : [GLOBAL_ROOT_FOLDER])) dir = await dir.getDirectoryHandle(seg, { create });
        return dir;
    }

    // Pasta que contém os arquivos arquivados (e a subpasta "original") deste dataset.
    async function getArchiveRootFor(parent, create = true, rootOverride) {
        const root = rootOverride || window.rootHandle;   // rootOverride: root of a background task's dataset
        if (root && await isGlobalMode(root)) {
            const rel = await relPathFromRoot(root, parent);
            if (rel) return ensureGlobalDir(root, rel, create);
        }
        return parent.getDirectoryHandle('_archive', { create });
    }

    async function folderLabelFor(parent, rootOverride) {
        const root = rootOverride || window.rootHandle;
        if (root && await isGlobalMode(root)) {
            const rel = await relPathFromRoot(root, parent);
            if (rel) return rel.length ? rel.join('/') : (root.name || '(root)');
        }
        return (parent && parent.name) || '';
    }

    // Todas as pastas (raiz + até 3 níveis, igual ao seletor do app) que têm um "_archive" próprio.
    async function collectLocalArchives(root) {
        const out = [];
        const walk = async (dir, rel, level) => {
            let arch = null;
            try { arch = await dir.getDirectoryHandle('_archive'); } catch (e) {}
            if (arch) out.push({ dir, rel, archive: arch });
            if (level >= 3) return;
            const kids = [];
            for await (const e of dir.values()) {
                if (e.kind === 'directory' && !isSysDir(e.name)) kids.push(e);
            }
            for (const k of kids) await walk(k, [...rel, k.name], level + 1);
        };
        await walk(root, [], 0);
        return out;
    }

    async function isDirEmpty(dir) {
        for await (const _ of dir.values()) return false;
        return true;
    }

    // Move TUDO de srcDir (arquivos e subpastas, recursivo) para destDir, sem sobrescrever.
    // onlyDirs (opcional): só entra nessas subpastas (usado na raiz, onde o destino fica dentro da origem).
    async function moveTree(srcDir, destDir, stats, onlyDirs) {
        const files = [], dirs = [];
        for await (const e of srcDir.values()) {
            if (e.kind === 'file') { if (e.name !== GLOBAL_MARKER) files.push(e.name); }
            else if (!onlyDirs || onlyDirs.includes(e.name)) dirs.push(e);
        }
        for (const n of files) {
            try {
                if (await fileExistsIn(destDir, n)) {
                    // Mesmo tamanho = cópia de uma execução interrompida: só limpa a origem.
                    const a = await (await srcDir.getFileHandle(n)).getFile();
                    const b = await (await destDir.getFileHandle(n)).getFile();
                    if (a.size === b.size) { await srcDir.removeEntry(n); stats.moved++; } else stats.skipped++;
                    continue;
                }
                await moveFileBetween(srcDir, destDir, n);
                stats.moved++;
            } catch (err) {
                stats.failed++;
                console.warn('[Archive] could not move to global:', n, err);
            }
        }
        for (const d of dirs) {
            const dd = await destDir.getDirectoryHandle(d.name, { create: true });
            await moveTree(d, dd, stats);
        }
    }

    // Remove subpastas vazias (recursivo); não remove a própria `dir`.
    async function pruneEmptyDirs(dir) {
        const subs = [];
        for await (const e of dir.values()) if (e.kind === 'directory') subs.push(e);
        for (const s of subs) {
            await pruneEmptyDirs(s);
            try { if (await isDirEmpty(s)) await dir.removeEntry(s.name); } catch (e) {}
        }
    }

    // Imagens que estão na pasta global mas NÃO têm registro no manifesto (ex.: arquivadas por outro
    // navegador/versão) ganham um registro — assim passam a ser controladas pelo Archive global.
    async function adoptOrphans(dir, isOriginal, parentDir, label, manifest, stats) {
        const names = [];
        for await (const e of dir.values()) if (e.kind === 'file') names.push(e.name);
        for (const n of names) {
            if (!/\.(png|jpe?g|webp)$/i.test(n)) continue;
            let known = false;
            for (const m of manifest) {
                if (m.archiveImageName !== n || !m.archiveDirHandle) continue;
                try { if (await m.archiveDirHandle.isSameEntry(dir)) { known = true; break; } } catch (e) {}
            }
            if (known) continue;
            const base = n.replace(/\.[^.]+$/, '');
            const texts = names.filter(t => t === base + '.txt' || t === base + '.json');
            let archivedAt = Date.now();
            try { archivedAt = (await (await dir.getFileHandle(n)).getFile()).lastModified || archivedAt; } catch (e) {}
            const entry = {
                archiveDirHandle: dir,
                archiveImageName: n,
                archiveTextNames: texts,
                originalName: n,
                originalBaseName: base,
                originalExt: texts.length ? texts[0].slice(texts[0].lastIndexOf('.') + 1) : 'txt',
                parentDirHandle: parentDir,
                folderLabel: label,
                label: isOriginal ? ORIGINAL_LABEL : '',
                isOriginal: !!isOriginal,
                nlMap: null,
                archivedAt
            };
            const id = await addArchiveManifestEntry(entry);
            if (id != null) { entry.id = id; manifest.push(entry); stats.adopted++; }
        }
    }

    /* Move TUDO do "_archive" local de um dataset (s) para o global, atualiza o manifesto,
       adota fotos sem registro e apaga o "_archive" local. */
    async function sweepSource(root, s, manifest, stats) {
        const dest = await ensureGlobalDir(root, s.rel, true);
        let srcOriginal = null;
        try { srcOriginal = await s.archive.getDirectoryHandle(ORIGINAL_DIR); } catch (e) {}
        const destOriginal = srcOriginal ? await dest.getDirectoryHandle(ORIGINAL_DIR, { create: true }) : null;

        // Dataset: move TUDO que há no "_archive" local. Raiz: o destino fica dentro da própria
        // origem, então só entra em "original" (o resto já é a estrutura global).
        await moveTree(s.archive, dest, stats, s.rel.length ? null : [ORIGINAL_DIR]);

        // Aponta os registros do manifesto para o novo local (só se o arquivo realmente está lá).
        const label = s.rel.length ? s.rel.join('/') : (root.name || '(root)');
        for (const entry of manifest) {
            try {
                let target = null;
                if (entry.archiveDirHandle && await entry.archiveDirHandle.isSameEntry(s.archive)) target = dest;
                else if (srcOriginal && entry.archiveDirHandle && await entry.archiveDirHandle.isSameEntry(srcOriginal)) target = destOriginal;
                if (!target || !(await fileExistsIn(target, entry.archiveImageName))) continue;
                entry.archiveDirHandle = target;
                entry.folderLabel = label;
                await updateArchiveManifestEntry(entry);
            } catch (e) { /* handle inválido: deixa o registro como está */ }
        }

        // Fotos/legendas sem registro no manifesto passam a ser controladas pelo global.
        await adoptOrphans(dest, false, s.dir, label, manifest, stats);
        if (destOriginal) await adoptOrphans(destOriginal, true, s.dir, label, manifest, stats);

        // Nada fica no dataset: o "_archive" local some (a raiz mantém o seu: agora é o global).
        if (s.rel.length > 0) {
            try {
                await pruneEmptyDirs(s.archive);
                if (await isDirEmpty(s.archive)) await s.dir.removeEntry('_archive');
                else stats.leftover++;
            } catch (e) { stats.leftover++; }
        }
    }

    // Percorre a árvore global: devolve { dir, rel } de cada pasta de dataset (sem as pastas "original").
    // A pasta "_root" representa a própria raiz (rel = []).
    async function collectGlobalNodes(globalDir) {
        const out = [];
        const walk = async (dir, rel, isTop) => {
            const kids = [];
            for await (const e of dir.values()) if (e.kind === 'directory' && e.name !== ORIGINAL_DIR) kids.push(e);
            for (const k of kids) {
                if (isTop && k.name === GLOBAL_ROOT_FOLDER) { out.push({ dir: k, rel: [] }); continue; }
                const r = [...rel, k.name];
                out.push({ dir: k, rel: r });
                await walk(k, r, false);
            }
        };
        await walk(globalDir, [], true);
        return out;
    }

    async function datasetHandleForRel(root, rel) {
        let d = root;
        for (const seg of rel) d = await d.getDirectoryHandle(seg);
        return d;
    }

    /* RESCAN: roda a varredura de novo no modo Global — traz para o global qualquer "_archive"
       local que tenha reaparecido nos datasets e adota fotos sem registro. */
    window.rescanArchiveGlobal = async function () {
        const root = window.rootHandle;
        if (!root || _converting || !(await isGlobalMode(root))) return;
        const btn = document.getElementById('archive-rescan-global');
        const setBtn = (t, dis) => { if (btn) { btn.textContent = t; btn.disabled = !!dis; } };
        _converting = true;
        setBtn('⏳ Rescanning...', true);
        const stats = { moved: 0, skipped: 0, failed: 0, adopted: 0, leftover: 0 };
        let found = 0;
        try {
            if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await root.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                    if (window.showAlert) window.showAlert('Permission denied for the root folder.', 'error');
                    return;
                }
            }
            if (typeof window.saveAllImages === 'function') { try { await window.saveAllImages(true); } catch (e) {} }

            // "_archive" locais de datasets (o da raiz É o global, então fica de fora).
            const sources = (await collectLocalArchives(root)).filter(s => s.rel.length > 0);
            found = sources.length;
            const manifest = await getAllArchiveManifestEntries();
            for (let n = 0; n < sources.length; n++) {
                setBtn(`⏳ ${n + 1}/${sources.length}`, true);
                await sweepSource(root, sources[n], manifest, stats);
            }

            // Fotos dentro do global sem registro (ex.: arquivadas por outra versão/navegador).
            const globalDir = await root.getDirectoryHandle('_archive');
            for (const node of await collectGlobalNodes(globalDir)) {
                let ds = null;
                try { ds = await datasetHandleForRel(root, node.rel); } catch (e) { continue; }
                const label = node.rel.length ? node.rel.join('/') : (root.name || '(root)');
                await adoptOrphans(node.dir, false, ds, label, manifest, stats);
                let orig = null;
                try { orig = await node.dir.getDirectoryHandle(ORIGINAL_DIR); } catch (e) {}
                if (orig) await adoptOrphans(orig, true, ds, label, manifest, stats);
            }
            // Raiz: imagens soltas direto em _archive (sem passar por _root) também entram.
            await pruneEmptyDirs(globalDir);

            if (window.showAlert) {
                window.showAlert(`Rescan done 🔄 — moved ${stats.moved} file(s) from ${found} dataset archive folder(s), ${stats.adopted} image(s) newly managed.`, 'success');
                if (stats.skipped > 0 || stats.leftover > 0) window.showAlert(`⚠️ ${stats.skipped} file(s) were left in a dataset's "_archive" because a different file with the same name already exists in the global folder.`, 'error');
                if (stats.failed > 0) window.showAlert(`⚠️ ${stats.failed} file(s) could not be moved (see console).`, 'error');
            }
        } catch (e) {
            console.error('rescanArchiveGlobal failed:', e);
            if (window.showAlert) window.showAlert('Error rescanning the global Archive: ' + (e.message || e), 'error');
        } finally {
            _converting = false;
            await renderArchiveList();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
        }
    };

    /* CONVERT TO LOCAL: desfaz o Global. Cada pasta <root>/_archive/<dataset>/ volta para o
       "_archive" do próprio dataset (a pasta "_root" volta para <root>/_archive), o manifesto é
       atualizado e o marcador sai. Se algo não puder voltar, o modo continua Global. */
    window.convertArchiveToLocal = async function () {
        const root = window.rootHandle;
        if (!root || _converting || !(await isGlobalMode(root))) return;
        if (!confirm(`Convert the Archive of "${root.name}" back to LOCAL?\n\n• Each folder in "${root.name}/_archive" is MOVED back into its own dataset ("<dataset>/_archive", originals in "<dataset>/_archive/original").\n• The global folders are removed once empty.\n• From then on each dataset keeps its own Archive again, and the panel lists only the dataset you are in.\n\nThis moves files on disk. Continue?`)) return;

        const btn = document.getElementById('archive-convert-local');
        const setBtn = (t, dis) => { if (btn) { btn.textContent = t; btn.disabled = !!dis; } };
        _converting = true;
        setBtn('⏳ Scanning...', true);
        const stats = { moved: 0, skipped: 0, failed: 0, adopted: 0, leftover: 0 };
        try {
            if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await root.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                    if (window.showAlert) window.showAlert('Permission denied for the root folder.', 'error');
                    return;
                }
            }
            if (typeof window.saveAllImages === 'function') { try { await window.saveAllImages(true); } catch (e) {} }

            const globalDir = await root.getDirectoryHandle('_archive');
            const manifest = await getAllArchiveManifestEntries();
            const nodes = (await collectGlobalNodes(globalDir)).sort((a, b) => b.rel.length - a.rel.length); // _root (rel []) por último

            for (let n = 0; n < nodes.length; n++) {
                const node = nodes[n];
                setBtn(`⏳ ${n + 1}/${nodes.length}`, true);

                let ds = null;
                try { ds = await datasetHandleForRel(root, node.rel); } catch (e) { stats.leftover++; continue; } // dataset não existe mais
                const isRootNode = node.rel.length === 0;
                // O "_archive" local da raiz é a própria pasta global.
                const local = isRootNode ? globalDir : await ds.getDirectoryHandle('_archive', { create: true });
                let srcOriginal = null;
                try { srcOriginal = await node.dir.getDirectoryHandle(ORIGINAL_DIR); } catch (e) {}
                const localOriginal = srcOriginal ? await local.getDirectoryHandle(ORIGINAL_DIR, { create: true }) : null;

                // Só os arquivos deste nível (sub-datasets têm o próprio nó).
                await moveTree(node.dir, local, stats, []);
                if (srcOriginal) await moveTree(srcOriginal, localOriginal, stats, []);

                for (const entry of manifest) {
                    try {
                        let target = null;
                        if (entry.archiveDirHandle && await entry.archiveDirHandle.isSameEntry(node.dir)) target = local;
                        else if (srcOriginal && entry.archiveDirHandle && await entry.archiveDirHandle.isSameEntry(srcOriginal)) target = localOriginal;
                        if (!target || !(await fileExistsIn(target, entry.archiveImageName))) continue;
                        entry.archiveDirHandle = target;
                        entry.folderLabel = ds.name || '';
                        await updateArchiveManifestEntry(entry);
                    } catch (e) {}
                }
            }

            await pruneEmptyDirs(globalDir);
            let remaining = false;
            for await (const e of globalDir.values()) if (e.kind === 'directory' && e.name !== ORIGINAL_DIR) remaining = true;

            if (remaining || stats.leftover > 0 || stats.skipped > 0 || stats.failed > 0) {
                if (window.showAlert) window.showAlert(`⚠️ Some files could not go back to their dataset (folder missing, name conflict or error), so the Archive stays GLOBAL. Moved ${stats.moved} file(s). Fix it and run Convert to Local again.`, 'error');
            } else {
                try { await globalDir.removeEntry(GLOBAL_MARKER); } catch (e) {}
                try { if (await isDirEmpty(globalDir)) await root.removeEntry('_archive'); } catch (e) {}
                if (window.showAlert) window.showAlert(`Archive is LOCAL again — moved ${stats.moved} file(s) back to their datasets.`, 'success');
            }
        } catch (e) {
            console.error('convertArchiveToLocal failed:', e);
            if (window.showAlert) window.showAlert('Error converting the Archive to Local: ' + (e.message || e), 'error');
        } finally {
            _converting = false;
            _globalCache.delete(root);
            await renderArchiveList();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
        }
    };

    /* Converte o Archive da pasta raiz para GLOBAL: vasculha todos os datasets, move tudo
       que está nos "_archive" locais para <root>/_archive/<dataset>/ e atualiza o manifesto
       (para Restore / Delete / Pin continuarem funcionando). Idempotente: dá para rodar de novo. */
    window.convertArchiveToGlobal = async function () {
        const root = window.rootHandle;
        if (!root || _converting) return;
        if (await isGlobalMode(root)) return;
        if (!(await rootHasDatasets(root))) {
            if (window.showAlert) window.showAlert('This folder has no dataset subfolders — Global mode needs datasets one level below it.', 'error');
            return;
        }
        if (!confirm(`Convert the Archive of "${root.name}" to GLOBAL?\n\n• A single "_archive" folder is used at the root of "${root.name}", with one subfolder per dataset.\n• Every dataset is scanned and ALL its archived files (including originals) are MOVED into the global folder.\n• From now on, archiving from any dataset under this folder goes to the global Archive, and the panel lists every dataset's archived items.\n\nThis moves files on disk. Continue?`)) return;

        const btn = document.getElementById('archive-convert-global');
        const setBtn = (t, dis) => { if (btn) { btn.textContent = t; btn.disabled = !!dis; } };
        _converting = true;
        setBtn('⏳ Scanning...', true);

        const stats = { moved: 0, skipped: 0, failed: 0, adopted: 0, leftover: 0 };
        let sourceCount = 0;
        try {
            if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await root.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                    if (window.showAlert) window.showAlert('Permission denied for the root folder.', 'error');
                    return;
                }
            }
            if (typeof window.saveAllImages === 'function') { try { await window.saveAllImages(true); } catch (e) {} }

            const sources = await collectLocalArchives(root);
            sourceCount = sources.length;
            const manifest = await getAllArchiveManifestEntries();

            for (let n = 0; n < sources.length; n++) {
                setBtn(`⏳ ${n + 1}/${sources.length}`, true);
                await sweepSource(root, sources[n], manifest, stats);
            }

            // Marcador: só agora o modo vira Global.
            const globalDir = await root.getDirectoryHandle('_archive', { create: true });
            await pruneEmptyDirs(globalDir); // sem pastas vazias: só existe pasta para dataset que tem itens
            const mh = await globalDir.getFileHandle(GLOBAL_MARKER, { create: true });
            const w = await mh.createWritable();
            await w.write(JSON.stringify({ mode: 'global', version: 1, convertedAt: new Date().toISOString() }));
            await w.close();

            if (window.showAlert) {
                window.showAlert(`Archive is now GLOBAL 🌐 — moved ${stats.moved} file(s) from ${sourceCount} archive folder(s).`, 'success');
                if (stats.adopted > 0) window.showAlert(`${stats.adopted} archived image(s) had no record — they are now managed by the global Archive.`, 'info');
                if (stats.skipped > 0 || stats.leftover > 0) window.showAlert(`⚠️ ${stats.skipped} file(s) were left in a dataset's "_archive" because a different file with the same name already exists in the global folder.`, 'error');
                if (stats.failed > 0) window.showAlert(`⚠️ ${stats.failed} file(s) could not be moved (see console).`, 'error');
            }
        } catch (e) {
            console.error('convertArchiveToGlobal failed:', e);
            if (window.showAlert) window.showAlert('Error converting the Archive to Global: ' + (e.message || e), 'error');
        } finally {
            _converting = false;
            _globalCache.delete(root);
            await renderArchiveList();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
        }
    };

    async function updateModeBar() {
        const bar = document.getElementById('archive-mode-bar');
        if (!bar) return;
        const root = window.rootHandle;
        if (!root) { bar.style.display = 'none'; return; }
        if (await isGlobalMode(root)) {
            bar.style.display = 'flex';
            bar.className = 'is-global';
            bar.innerHTML = `<span>🌐 <b>Global mode</b> — every dataset under "${esc(root.name)}" archives into <code>${esc(root.name)}/_archive/&lt;dataset&gt;/</code>. Open a folder to see its images; the panel opens at the dataset you are in.</span><button id="archive-rescan-global" title="Scan every dataset again: bring any leftover local _archive into the global one and register images that have no record">🔄 Rescan Global</button><button id="archive-convert-local" title="Move everything back into each dataset's own _archive and leave Global mode">🏠 Convert to Local</button>`;
            document.getElementById('archive-rescan-global').onclick = () => window.rescanArchiveGlobal();
            document.getElementById('archive-convert-local').onclick = () => window.convertArchiveToLocal();
            return;
        }
        if (!(await rootHasDatasets(root))) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        bar.className = '';
        bar.innerHTML = `<span>This folder contains datasets. Convert to <b>Global</b> to keep one Archive at the root ("${esc(root.name)}/_archive/&lt;dataset&gt;") instead of one per dataset.</span><button id="archive-convert-global" title="Scan every dataset and move all archived files into the global Archive">🌐 Convert to Global</button>`;
        document.getElementById('archive-convert-global').onclick = () => window.convertArchiveToGlobal();
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
    // root (optional): root folder of the dataset the image belongs to — background tasks (⏳) pass the one
    // they started with, so Global-mode archives keep working after another root folder is opened.
    window.moveToArchive = async function (img, label, root) {
        if (!img || !img.parentDirHandle) {
            console.error('moveToArchive: missing image or parentDirHandle', img);
            if (window.showAlert) window.showAlert(`❌ Could not archive "${img && img.name ? img.name : 'file'}": no folder handle available.`, 'error');
            return false;
        }
        try {
            if ((await img.parentDirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await img.parentDirHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
            }

            const archiveRoot = await getArchiveRootFor(img.parentDirHandle, true, root);

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
                folderLabel: await folderLabelFor(img.parentDirHandle, root),
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
	
	/* ---------- ARQUIVAR AS IMAGENS SELECIONADAS (botão 📦 da lista) ----------
   Antes vivia no tagmanager_trash.js (removido). Move cada imagem selecionada
   (+ legenda) para o _archive com o rótulo "excluded", em sequência. */
let _archiving = false;
window.archiveSelectedImages = async function () {
    if (_archiving) return;
    if (typeof selectedIndices === 'undefined' || typeof imageFiles === 'undefined' || selectedIndices.size === 0) {
        if (window.showAlert) window.showAlert('Select at least one image first!', 'warn');
        return;
    }
    const imgs = Array.from(selectedIndices).sort((a, b) => a - b)
        .map(i => imageFiles[i]).filter(img => img && !img.hidden);
    if (imgs.length === 0) return;

    if (!confirm(`Move ${imgs.length} image(s) and their captions to the 📦 Archive?\n\nThey leave the dataset but can be restored anytime from the Archive panel.`)) return;

    _archiving = true;
    const btn = document.getElementById('btn-archive-selected');
    if (btn) btn.disabled = true;
    let ok = 0;
    const failed = [];
    // ⏳ background task: keeps going (on this dataset) if another dataset is opened
    const ctx = window.TM && window.TM.tasks ? window.TM.tasks.captureDataset() : null;
    let task = null;
    const runIt = async (t) => {
    task = t;
    try {
        // A legenda é movida do DISCO: grava antes as edições ainda não salvas
        // (e o _nl_manager.json), senão o Archive guardaria uma versão velha.
        for (const img of imgs) {
            if (img.dirty && img.hasFile && typeof window.saveImageToDisk === 'function') {
                try { await window.saveImageToDisk(img); } catch (e) {}
            }
        }
        for (let i = 0; i < imgs.length; i++) {
            if (task && task.cancelled) break;
            if (btn) btn.textContent = `⏳ ${i + 1}/${imgs.length}`;
            if (task) task.progress(i + 1, imgs.length);
            const done = await window.moveToArchive(imgs[i], 'excluded', ctx && ctx.root);
            if (done) ok++; else failed.push(imgs[i].name);
        }
    } finally {
        _archiving = false;
        if (btn) { btn.disabled = false; btn.textContent = '📦'; }
    }

    const here = !ctx || await window.TM.tasks.isCurrent(ctx.handle);
    if (ok > 0 && here) {
        selectedIndices.clear();
        if (typeof window.refreshDataset === 'function') await window.refreshDataset();
        if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
    }
    if (task) task.result = `${ok} archived${failed.length ? `, ${failed.length} failed` : ''}`;
    if (window.showAlert) {
        if (failed.length) window.showAlert(`Archived ${ok} image(s). ⚠️ ${failed.length} failed: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}`, 'warn', 7000);
        else window.showAlert(`Archived ${ok} image(s) 📦`, 'success');
    }
    };
    if (ctx) { ctx.files = imgs; return window.TM.tasks.run({ title: 'Archive images', icon: '📦', ctx, silentEnd: true }, runIt).promise; }
    return runIt(null);
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
        const imgName = entry.archiveImageName;
        const base = entry.originalBaseName;
        const partial = [];

        if (typeof window.saveAllImages === 'function') { try { await window.saveAllImages(true); } catch (e) {} }

        const archiveRoot = await getArchiveRootFor(parent, true);
        const olds = await findRootCopies(parent, imgName);

        // Caption (prompt) currently in the dataset = the edited version's caption. It STAYS with the original image.
        const modNlMap = window.NLCodec ? await window.NLCodec.entriesFor(parent, base) : null;
        const currentTexts = [];
        for (const ext of ['.txt', '.json']) {
            const n = base + ext;
            if (await fileExistsIn(parent, n)) currentTexts.push(n);
        }

        // 1) modified image -> Archive (its caption is COPIED, the dataset keeps the original)
        await moveFileBetween(parent, archiveRoot, imgName);
        const modifiedTexts = [];
        for (const n of currentTexts) {
            try { await copyFileBetween(parent, archiveRoot, n); modifiedTexts.push(n); }
            catch (e) { console.warn('caption not copied to the Archive:', n, e); }
        }

        // 2) original image -> dataset (rolls step 1 back if it fails)
        try {
            await moveFileBetween(entry.archiveDirHandle, parent, imgName);
        } catch (e) {
            try { await moveFileBetween(archiveRoot, parent, imgName); } catch (e2) { console.error('rollback failed', e2); }
            for (const n of modifiedTexts) { try { await archiveRoot.removeEntry(n); } catch (e3) {} }
            throw e;
        }

        // 3) captions: the edited caption is kept; the original's old captions are dropped.
        //    Only when the dataset had NO caption at all do the original's captions come back.
        const keptCaption = currentTexts.length > 0;
        if (keptCaption) {
            for (const t of (entry.archiveTextNames || [])) { try { await entry.archiveDirHandle.removeEntry(t); } catch (e) {} }
        } else {
            await restoreNLMap(entry);
            for (const t of (entry.archiveTextNames || [])) {
                try { await moveFileBetween(entry.archiveDirHandle, parent, t); }
                catch (e) { if (!e || e.name !== 'NotFoundError') { console.warn('caption not restored:', t, e); partial.push(t); } }
            }
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
            label: cleanLabel(window._archiveAutoLabel) || 'edited',
            isOriginal: false,
            nlMap: modNlMap || null,
            archivedAt: Date.now()
        });
        await cleanupSupersededCopies(olds, modifiedTexts);

        // 4) the original's record disappears (next time this image is archived it becomes the original again)
        await deleteArchiveManifestEntry(entry.id);
        return { partial, keptCaption };
    }

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

            // Original + já existe uma imagem com esse nome no dataset: TROCA (a modificada vai para o Archive).
            if (entry.isOriginal && await fileExistsIn(parent, entry.archiveImageName)) {
                const r = await swapOriginalIntoDataset(entry);
                if (window.showAlert) {
                    window.showAlert(`Restored the original "${entry.originalName}". The version that was in the dataset moved to the Archive${r.keptCaption ? ' and the current caption was kept with the original image' : ''}.`, 'success');
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

            await restoreNLMap(entry);
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
        if (!confirm(`Restore ${entries.length} item(s) from the Archive back to the dataset folder?\n\nItems whose file name already exists in the folder will be skipped and stay in the Archive — except originals, which swap places with the version in the folder (that version moves to the Archive and the current caption stays with the original image).`)) return;

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

                await restoreNLMap(entry);
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

        /* Navegação por pastas (modo Global) */
        #archive-crumbs { display: none; align-items: center; flex-wrap: wrap; gap: 5px; flex-shrink: 0; margin: 0 0 8px; font-size: 12px; }
        #archive-crumbs .ac-seg { color: #66ccff; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
        #archive-crumbs .ac-seg:hover { background: #0d1f2a; }
        #archive-crumbs .ac-seg.current { color: #fff; cursor: default; font-weight: bold; background: transparent; }
        #archive-crumbs .ac-sep { color: #555; }
        .archive-folder { display: flex; align-items: center; gap: 10px; background: #101820; border: 1px solid #144a63; border-radius: 6px; padding: 10px 12px; cursor: pointer; flex-shrink: 0; }
        .archive-folder:hover { background: #0d2230; border-color: #66ccff; }
        .archive-folder .af-icon { font-size: 18px; }
        .archive-folder .af-name { flex: 1; font-size: 12px; font-weight: bold; color: #ddd; word-break: break-all; }
        .archive-folder .af-count { font-size: 11px; color: #888; }
        .archive-folder .af-go { color: #66ccff; font-size: 18px; line-height: 1; }

        /* Barra do modo Global */
        #archive-mode-bar { display: none; align-items: center; gap: 10px; flex-shrink: 0; margin: 0 0 8px; padding: 7px 10px; font-size: 11px; color: #aaa; background: #101820; border: 1px solid #144a63; border-radius: 6px; }
        #archive-mode-bar > span { flex: 1; line-height: 1.4; }
        #archive-mode-bar code { color: #66ccff; font-size: 10px; }
        #archive-mode-bar.is-global { background: #0d1f16; border-color: #00aa66; color: #9fe3c0; }
        #archive-mode-bar.is-global code { color: #00ff99; }
        #archive-convert-global, #archive-rescan-global, #archive-convert-local { flex-shrink: 0; font-size: 11px; padding: 5px 10px; background: #0d1f2a; color: #66ccff; border: 1px solid #144a63; }
        #archive-convert-global:hover:not(:disabled), #archive-rescan-global:hover:not(:disabled), #archive-convert-local:hover:not(:disabled) { background: #66ccff; color: #000; }
        #archive-convert-global:disabled, #archive-rescan-global:disabled, #archive-convert-local:disabled { opacity: 0.5; cursor: not-allowed; }
        #archive-convert-local { background: #1f1a0d; color: #ffcc66; border-color: #4a3410; }
        #archive-convert-local:hover:not(:disabled) { background: #ffcc66; color: #000; }
        #archive-restore-selected { margin-left: auto; font-size: 11px; padding: 5px 10px; background: #0d2a18; color: #00ff99; border: 1px solid #00aa66; }
        #archive-restore-selected:hover:not(:disabled) { background: #00aa66; color: #000; }
        #archive-restore-selected:disabled { opacity: 0.4; cursor: not-allowed; }
        .archive-row-check { width: 16px; height: 16px; flex-shrink: 0; cursor: pointer; accent-color: #00ff99; }
        .archive-item.selected { border-color: #00aa66; background: #101b15; }

        .list-archive-btn { background:#151515; border-color:#555; color:#aaa; }

        /* ♻️ Restore original: stacked under the 📌 pin in the Dataset list */
        .list-item-actions { display: flex; flex-direction: column; align-items: center; gap: 2px; flex-shrink: 0; }
        .list-recycle-btn { background: transparent; border: none; color: #666; font-size: 15px; cursor: pointer; padding: 2px 4px; flex-shrink: 0; border-radius: 4px; line-height: 1; }
        .list-recycle-btn:hover { color: #66ccff; transform: scale(1.1); }
        #image-list.grid-mode .list-item-actions { position: absolute; top: 4px; right: 4px; }
        #image-list.grid-mode .list-item-actions .list-pin-btn { position: static; }
        #image-list.grid-mode .list-recycle-btn { background: rgba(0,0,0,0.55); border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 12px; }

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
                    Archived files stay inside each dataset's own folder (in a hidden "_archive" subfolder), separate from the main set. Items are labeled automatically by the tool that archived them (excluded / grayscale / bucket); click a label to rename it. The first version of each image is kept as its "original" (folder _archive/original); restoring it swaps it with the version currently in the dataset (the current caption stays with the original image). The ♻️ button under the 📌 pin in the Dataset list does the same for one image. "Delete Permanently" removes the archived copy for good — this cannot be undone.
                </div>
                <div id="archive-mode-bar"></div>
                <div id="archive-crumbs"></div>
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

    /* Pasta aberta no modo Global (array de nomes a partir da raiz). null = seguir o dataset atual. */
    let _viewPath = null;
    /* "original" folder: the original versions (label "original") are shown as a separate
       📁 original folder (like the Global mode folders); everything else stays in the list. */
    let _origView = false;

    // Trilha clicável: 🌐 raiz / A / sub  (só no modo Global).
    function renderCrumbs(root, base) {
        const bar = document.getElementById('archive-crumbs');
        if (!bar) return;
        if (!root && !_origView) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
        bar.style.display = 'flex';
        bar.innerHTML = '';
        if (!root) {
            // default (non-global) view inside the 📁 original folder: 📦 Archive / original
            const back = document.createElement('span');
            back.className = 'ac-seg';
            back.style.cursor = 'pointer';
            back.textContent = '📦 Archive';
            back.onclick = () => { _origView = false; _selectedIds.clear(); renderArchiveList(); };
            const sep = document.createElement('span'); sep.className = 'ac-sep'; sep.textContent = '/';
            const cur = document.createElement('span'); cur.className = 'ac-seg current'; cur.textContent = '📁 original';
            bar.appendChild(back); bar.appendChild(sep); bar.appendChild(cur);
            return;
        }
        const segs = [{ label: '🌐 ' + (root.name || 'root'), path: [] }, ...base.map((n, i) => ({ label: n, path: base.slice(0, i + 1) }))];
        segs.forEach((s, i) => {
            if (i > 0) { const sep = document.createElement('span'); sep.className = 'ac-sep'; sep.textContent = '/'; bar.appendChild(sep); }
            const c = document.createElement('span');
            const last = i === segs.length - 1;
            c.className = 'ac-seg' + (last ? ' current' : '');
            c.textContent = s.label;
            if (!last || _origView) c.onclick = () => { _viewPath = s.path; _origView = false; _selectedIds.clear(); renderArchiveList(); };
            if (last && _origView) { c.classList.remove('current'); c.style.cursor = 'pointer'; }
            bar.appendChild(c);
        });
        if (_origView) {
            const sep = document.createElement('span'); sep.className = 'ac-sep'; sep.textContent = '/';
            const cur = document.createElement('span'); cur.className = 'ac-seg current'; cur.textContent = '📁 original';
            bar.appendChild(sep); bar.appendChild(cur);
        }
    }

    async function renderArchiveList() {
        buildModal();

        // Relê o modo do disco (pode ter mudado fora do app) e atualiza a barra Global.
        if (window.rootHandle && !_converting) _globalCache.delete(window.rootHandle);
        await updateModeBar();

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

        const everyItem = await pruneStaleArchiveEntries(await getArchiveEntriesForCurrentDataset());
        everyItem.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));

        /* GLOBAL: navegação por pastas. `base` = pasta aberta (caminho a partir da raiz).
           - scopeItems = tudo dessa pasta para baixo (alimenta filtro de rótulos e contagens);
           - items      = SÓ as imagens dessa pasta (lista plana, sem sub-níveis);
           - folders    = subpastas imediatas que têm itens arquivados. */
        const root = window.rootHandle;
        const globalOn = !!root && await isGlobalMode(root);
        let scopeItems = everyItem;
        let ownItems = everyItem;
        let folders = [];
        let base = [];
        if (globalOn) {
            const relOf = new Map();
            for (const e of everyItem) {
                let r = null;
                try { r = await root.resolve(e.parentDirHandle); } catch (err) {}
                relOf.set(e.id, r || []);
            }
            if (_viewPath) base = _viewPath;
            else {
                try { base = (window.currentImagesHandle && await root.resolve(window.currentImagesHandle)) || []; } catch (err) { base = []; }
                _viewPath = base;
            }
            const under = (r) => base.every((seg, i) => r[i] === seg);
            scopeItems = everyItem.filter(e => under(relOf.get(e.id)));
            ownItems = scopeItems.filter(e => relOf.get(e.id).length === base.length);
            const counts = new Map();
            scopeItems.forEach(e => {
                const r = relOf.get(e.id);
                if (r.length > base.length && entryMatchesFilter(e)) counts.set(r[base.length], (counts.get(r[base.length]) || 0) + 1);
            });
            folders = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
        }
        // Originals go to their own 📁 original folder; the list keeps the other images.
        const origOwn = ownItems.filter(e => e.isOriginal);
        if (_origView && origOwn.length === 0) _origView = false;
        ownItems = _origView ? origOwn : ownItems.filter(e => !e.isOriginal);

        updateFilterUI(scopeItems);
        renderCrumbs(globalOn ? root : null, base);

        const items = ownItems.filter(entryMatchesFilter);
        const origShown = _origView ? 0 : origOwn.filter(entryMatchesFilter).length;
        const allItems = scopeItems;
        const info = document.getElementById('archive-filter-info');
        if (info) {
            const shown = globalOn ? scopeItems.filter(entryMatchesFilter).length : items.length;
            info.textContent = _activeLabels.size > 0 ? `${shown} of ${allItems.length} shown` : `${allItems.length} item(s)`;
        }

        list.innerHTML = '';

        // Pastas (só no modo Global): clicar entra na pasta.
        folders.forEach(([name, count]) => {
            const f = document.createElement('div');
            f.className = 'archive-folder';
            f.title = 'Open this folder';
            f.innerHTML = `<span class="af-icon">📁</span><span class="af-name">${esc(name)}</span><span class="af-count">${count} item(s)</span><span class="af-go">›</span>`;
            f.onclick = () => { _viewPath = [...base, name]; _origView = false; _selectedIds.clear(); renderArchiveList(); };
            list.appendChild(f);
        });
        if (origShown > 0) {
            const f = document.createElement('div');
            f.className = 'archive-folder archive-folder-original';
            f.title = 'Original versions of the images (label "original") — click to open';
            f.innerHTML = `<span class="af-icon">📁</span><span class="af-name">original</span><span class="af-count">${origShown} item(s)</span><span class="af-go">›</span>`;
            f.onclick = () => { _origView = true; _selectedIds.clear(); renderArchiveList(); };
            list.insertBefore(f, list.firstChild);
        }

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
            if (folders.length === 0 && origShown === 0) {
                list.innerHTML = allItems.length === 0
                    ? '<div style="color:#555; font-size:12px; text-align:center; padding:20px;">Archive is empty for this dataset.</div>'
                    : '<div style="color:#555; font-size:12px; text-align:center; padding:20px;">No archived images with this label.</div>';
            }
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
        refreshRecycleButtons();
    };

    window.openArchiveModal = async function () {
        buildModal();
        window.openModal('modal-archive');
        _viewPath = null; // abre na pasta do dataset atual
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

    /* ---------- ♻️ RESTORE ORIGINAL (Dataset list, under the 📌 pin) ----------
       Puts the ORIGINAL version of the image (kept in _archive/original) back in place of the current one.
       The current caption (prompt) stays with the original image; the current image goes to the Archive. */
    async function findOriginalEntry(img) {
        const all = await getAllArchiveManifestEntries();
        for (const e of all) {
            if (!e.isOriginal || e.archiveImageName !== img.name || !e.parentDirHandle) continue;
            try { if (await e.parentDirHandle.isSameEntry(img.parentDirHandle)) return e; } catch (err) {}
        }
        return null;
    }

    window.restoreOriginalForImage = async function (img) {
        if (!img || !img.parentDirHandle || _converting) return;
        const entry = await findOriginalEntry(img);
        if (!entry) {
            if (window.showAlert) window.showAlert(`No original version of "${img.name}" found in the Archive.`, 'warn');
            refreshRecycleButtons();
            return;
        }
        if (!confirm(`Restore the ORIGINAL version of "${img.name}"?\n\n• The original image replaces the current one.\n• The current caption (prompt) is kept with the original image.\n• The current image is moved to the Archive.`)) return;
        try {
            const parent = entry.parentDirHandle;
            if ((await parent.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await parent.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                    if (window.showAlert) window.showAlert('Permission denied for the original folder.', 'error');
                    return;
                }
            }
            const r = await swapOriginalIntoDataset(entry);
            if (window.showAlert) {
                window.showAlert(`Restored the original "${img.name}"${r.keptCaption ? ' — current caption kept' : ''}. The previous version is in the Archive.`, 'success');
                if (r.partial.length > 0) window.showAlert(`⚠️ Caption file(s) not restored: ${r.partial.join(', ')}`, 'error');
            }
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
            if (typeof window.refreshDataset === 'function') await window.refreshDataset();
        } catch (e) {
            console.error('restoreOriginalForImage failed:', e);
            if (window.showAlert) window.showAlert('Error restoring the original — nothing was lost, check the Archive panel.', 'error');
        }
    };

    let _recycleToken = 0;
    async function refreshRecycleButtons() {
        const token = ++_recycleToken;
        const cur = window.currentImagesHandle || window.rootHandle;
        if (!cur || typeof imageFiles === 'undefined') return;
        let all;
        try { all = await getAllArchiveManifestEntries(); } catch (e) { return; }
        const names = new Set();
        for (const e of all) {
            if (!e.isOriginal || !e.parentDirHandle) continue;
            try { if (await e.parentDirHandle.isSameEntry(cur)) names.add(e.archiveImageName); } catch (err) {}
            if (token !== _recycleToken) return;
        }
        imageFiles.forEach(img => {
            const btn = img.element && img.element.querySelector('.list-recycle-btn');
            if (btn) btn.style.display = names.has(img.name) ? 'inline-block' : 'none';
        });
    }

    function injectRecycleButtons() {
        if (typeof imageFiles === 'undefined') return;
        imageFiles.forEach(img => {
            if (!img.element || img.hidden) return;
            let box = img.element.querySelector('.list-item-actions');
            if (!box) {
                box = document.createElement('div');
                box.className = 'list-item-actions';
                img.element.appendChild(box);
            }
            const pin = img.element.querySelector('.list-pin-btn');
            if (pin && pin.parentNode !== box) box.insertBefore(pin, box.firstChild);
            let btn = box.querySelector('.list-recycle-btn');
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'list-recycle-btn';
                btn.textContent = '♻️';
                btn.style.display = 'none';
                btn.title = 'Restore the ORIGINAL version of this image (the current caption is kept)';
                btn.onclick = (e) => { e.stopPropagation(); window.restoreOriginalForImage(img); };
                btn.onmousedown = (e) => e.stopPropagation();
                box.appendChild(btn);
            }
        });
        refreshRecycleButtons();
    }

    window.addEventListener('DOMContentLoaded', () => {
        if (window.TM && typeof window.TM.on === 'function') window.TM.on('render:list', injectRecycleButtons, 10);
        setTimeout(() => {
            injectArchiveTopbarButton();
            injectArchiveSelectionButton();
        }, 0);
        // Depois dos outros módulos (ordem de <script> não importa).
        if (typeof installBucketAutoLabel === 'function') setTimeout(installBucketAutoLabel, 300);   // (was missing: threw on every load)

        // Aplica o tamanho de miniatura salvo do Archive já no carregamento,
        // independente do modal ter sido aberto.
        if (typeof window.getSetting === 'function') {
            window.getSetting('archive-thumb-size', 70).then(savedSize => {
                window.updateArchiveThumbSize(savedSize, true);
            });
        }
    });

})();
