/* =========================================================================
   CONFIG STORE — where the per-dataset config files live
   -------------------------------------------------------------------------
   Config files of a dataset (not the images, not the .txt/.json captions):
       _tagger_config.json, _nl_manager.json, _nl_known_texts.json,
       _pending_tags.json, _pending_remove.json, _psd_processed.json

   ⚙️ 📂 Folders › "Store configs on root":
     - OFF (default): every dataset keeps its config files inside its own folder (as always).
     - ON : for datasets inside a folder of the "Saved directories" list, the config files go to
            <saved root>/_store_configs/<same subfolder path>/  — the dataset folder keeps only the
            images, the captions and _archive.
   A folder opened with 📁 Load Folder that is NOT in the saved list always keeps its configs inside.

   How: FileSystemDirectoryHandle.getFileHandle / removeEntry are wrapped for those file names
   only, so every module keeps calling dirHandle.getFileHandle('_tagger_config.json') as before.
   Never two copies: when a file is asked for and it is still in the other place, it is MOVED
   (copy, then delete the old one) to the place of the current mode. Turning the switch on/off
   also moves the files of the whole saved root right away.
   ========================================================================= */
(function () {
    'use strict';
    const STORE_DIR = '_store_configs';
    const SETTING = 'config-store-root';
    const NAMES = new Set(['_tagger_config.json', '_nl_manager.json', '_nl_known_texts.json',
        '_pending_tags.json', '_pending_remove.json', '_psd_processed.json']);

    const SYS = window.MAT_SYSTEM_DIRS = window.MAT_SYSTEM_DIRS || new Set(['_trash', '_archive', '_rename_cache']);
    SYS.add(STORE_DIR);

    const P = (typeof FileSystemDirectoryHandle !== 'undefined') ? FileSystemDirectoryHandle.prototype : null;
    if (!P || P.__tmConfigStore) return;
    P.__tmConfigStore = true;
    const origGetFile = P.getFileHandle, origGetDir = P.getDirectoryHandle, origRemove = P.removeEntry;

    let onRoot = false;
    let readyResolve; const ready = new Promise(r => { readyResolve = r; });
    setTimeout(() => readyResolve(), 4000);   // never block forever

    const notFound = (name) => new DOMException(`"${name}" was not found.`, 'NotFoundError');
    const isMissing = e => e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

    /* ---------- saved roots ---------- */
    let roots = [];        // FileSystemDirectoryHandle of the "Saved directories" list (+ the current saved root)
    let gen = 0;           // bumps when the list changes (drops the "not under a saved root" cache)
    let posCache = new WeakMap();   // dirHandle -> { root, path }
    let negCache = new WeakMap();   // dirHandle -> gen when it was found under no saved root
    function bump() { gen++; posCache = new WeakMap(); negCache = new WeakMap(); }
    function addRoot(h) { if (h && !roots.includes(h)) { roots.push(h); bump(); } }
    async function loadSavedRoots() {
        try {
            if (typeof window.getHandles !== 'function') return;
            const list = await window.getHandles();
            const fresh = [];
            for (const x of (list || [])) if (x && x.handle && x.handle.kind === 'directory') fresh.push(x.handle);
            roots = fresh;
            bump();
        } catch (e) {}
    }

    async function locate(dir) {
        if (posCache.has(dir)) return posCache.get(dir);
        const cur = window.rootHandle && window.rootHandleKey ? window.rootHandle : null;
        if (cur && !roots.includes(cur)) {
            // same folder as a saved one (other handle object)? use the current one
            let same = false;
            for (const r of roots) { try { if (await r.isSameEntry(cur)) { same = true; break; } } catch (e) {} }
            if (!same) addRoot(cur);
        }
        if (negCache.get(dir) === gen) return null;
        const order = cur ? [cur].concat(roots.filter(r => r !== cur)) : roots.slice();
        for (const root of order) {
            let path = null;
            try { path = await root.resolve(dir); } catch (e) { path = null; }
            if (!path) continue;
            if (path.some(seg => SYS.has(seg))) { negCache.set(dir, gen); return null; }   // _archive/… keeps its files
            const loc = { root, path };
            posCache.set(dir, loc);
            scheduleRepair(root);
            return loc;
        }
        negCache.set(dir, gen);
        return null;
    }
    async function storeDir(loc, create) {
        try {
            let d = await origGetDir.call(loc.root, STORE_DIR, { create });
            for (const seg of loc.path) d = await origGetDir.call(d, seg, { create });
            return d;
        } catch (e) { if (create) throw e; return null; }
    }
    async function tryGet(dir, name) {
        if (!dir) return null;
        try { return await origGetFile.call(dir, name); } catch (e) { if (isMissing(e)) return null; throw e; }
    }

    // one operation at a time per file (two saves at once must not move it twice)
    const locks = new Map();
    function locked(key, fn) {
        const prev = locks.get(key) || Promise.resolve();
        const p = prev.then(fn);
        const tail = p.catch(() => {});
        locks.set(key, tail);
        tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
        return p;
    }

    let movedCount = 0;
    async function moveFile(srcDir, srcHandle, dstDir, name) {
        const data = await (await srcHandle.getFile()).arrayBuffer();
        const dst = await origGetFile.call(dstDir, name, { create: true });
        const w = await dst.createWritable();
        await w.write(data);
        await w.close();
        try { await origRemove.call(srcDir, name); } catch (e) {}
        movedCount++;
        return dst;
    }

    /* ---------- FAILSAFE: a dataset renamed / moved outside the app ----------
       Every folder of _store_configs gets a _fingerprint.json: the names of up to 10 images of the
       dataset + the first tag of each one's caption. When a dataset has no config in the store
       (new path) or a store folder points to a path that no longer exists (orphan), the
       fingerprints are compared with the image names / first tags of the folders of the root, and
       the orphan configs are moved to the folder they belong to now. */
    const FP_FILE = '_fingerprint.json', FP_MAX = 10;
    const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|avif|psd|psb|xcf)$/i;
    const keyOf = (loc) => loc.path.join('/');
    async function fingerprintOf(dir) {
        const names = [];
        try { for await (const e of dir.values()) if (e.kind === 'file' && IMG_RE.test(e.name)) names.push(e.name); } catch (e) {}
        names.sort((a, b) => a.localeCompare(b));
        const pick = names.slice(0, FP_MAX), out = [];
        for (const n of pick) {
            const base = n.replace(/\.[^.]+$/, '');
            let tok = '';
            try {
                const t = await (await origGetFile.call(dir, base + '.txt')).getFile();
                tok = String(await t.slice(0, 400).text()).split(/[,\n]/)[0].trim();
            } catch (e) {
                try {
                    const j = JSON.parse(await (await (await origGetFile.call(dir, base + '.json')).getFile()).text());
                    tok = String((j && (j.tags || j.caption)) || '').split(/[,\n]/)[0].trim();
                } catch (x) {}
            }
            out.push({ n, t: tok.toLowerCase() });
        }
        return { images: out, total: names.length };
    }
    const fpWritten = new Set();   // "<root>|<path>" written this session
    async function writeFingerprint(loc, dir, store) {
        const k = loc.root.name + '|' + keyOf(loc);
        if (fpWritten.has(k)) return;
        fpWritten.add(k);
        try {
            const fp = await fingerprintOf(dir);
            if (!fp.images.length) { fpWritten.delete(k); return; }
            fp.path = loc.path; fp.at = Date.now();
            const h = await origGetFile.call(store, FP_FILE, { create: true });
            const w = await h.createWritable(); await w.write(JSON.stringify(fp, null, 1)); await w.close();
        } catch (e) { fpWritten.delete(k); }
    }
    // how much folder `dir` looks like fingerprint `fp` (0..1); names must exist, first tags must agree when both have one
    async function matchScore(fp, dir) {
        if (!fp || !fp.images || !fp.images.length) return 0;
        let present = new Set();
        try { for await (const e of dir.values()) if (e.kind === 'file') present.add(e.name); } catch (e) { return 0; }
        let hit = 0;
        for (const im of fp.images) {
            if (!present.has(im.n)) continue;
            if (im.t) {
                const base = im.n.replace(/\.[^.]+$/, '');
                let tok = '';
                try { tok = String(await (await (await origGetFile.call(dir, base + '.txt')).getFile()).slice(0, 400).text()).split(/[,\n]/)[0].trim().toLowerCase(); } catch (e) {
                    try { const j = JSON.parse(await (await (await origGetFile.call(dir, base + '.json')).getFile()).text()); tok = String((j && (j.tags || j.caption)) || '').split(/[,\n]/)[0].trim().toLowerCase(); } catch (x) {}
                }
                if (tok && tok !== im.t) continue;
            }
            hit++;
        }
        const need = Math.min(fp.images.length, 3);
        if (hit < need) return 0;
        return hit / fp.images.length;
    }
    const MIN_SCORE = 0.6;
    async function dirAt(root, path) {
        try { let d = root; for (const seg of path) d = await origGetDir.call(d, seg); return d; } catch (e) { return null; }
    }
    // folders of _store_configs whose dataset folder does not exist anymore
    async function orphansOf(root) {
        const out = [];
        let store; try { store = await origGetDir.call(root, STORE_DIR); } catch (e) { return out; }
        const walk = async (dir, path) => {
            let hasCfg = false, fp = null;
            const subs = [];
            for await (const e of dir.values()) {
                if (e.kind === 'directory') subs.push(e);
                else if (NAMES.has(e.name)) hasCfg = true;
                else if (e.name === FP_FILE) { try { fp = JSON.parse(await (await e.getFile()).text()); } catch (x) {} }
            }
            if (hasCfg && fp && !(await dirAt(root, path))) out.push({ dir, path, fp });
            for (const sd of subs) await walk(sd, path.concat(sd.name));
        };
        try { await walk(store, []); } catch (e) {}
        return out;
    }
    async function moveStoreFolder(src, dst) {
        let n = 0;
        for await (const e of src.values()) {
            if (e.kind !== 'file' || !(NAMES.has(e.name) || e.name === FP_FILE)) continue;
            try { await origGetFile.call(dst, e.name); continue; } catch (x) {}   // never overwrite an existing config
            await moveFile(src, e, dst, e.name); if (e.name !== FP_FILE) n++;
        }
        return n;
    }
    // one dataset without config in the store: is it an orphan that was renamed / moved?
    const checkedMiss = new Set();
    async function adoptOrphanFor(loc, dir) {
        const k = loc.root.name + '|' + keyOf(loc);
        if (checkedMiss.has(k)) return false;
        checkedMiss.add(k);
        const orphans = await orphansOf(loc.root);
        if (!orphans.length) return false;
        let best = null, bestScore = 0;
        for (const o of orphans) { const sc = await matchScore(o.fp, dir); if (sc > bestScore) { best = o; bestScore = sc; } }
        if (!best || bestScore < MIN_SCORE) return false;
        const dst = await storeDir(loc, true);
        const n = await moveStoreFolder(best.dir, dst);
        fpWritten.delete(k);
        await writeFingerprint(loc, dir, dst);
        if (n && window.showAlert) window.showAlert(`🗄️ Dataset "${best.path.join('/')}" was renamed/moved to "${loc.path.join('/') || loc.root.name}": its configs (${n} file(s)) were found and moved along.`, 'success');
        return n > 0;
    }
    // whole root: every orphan looks for its new folder (runs once per root per session, in the background)
    const repaired = new Set();
    async function repairRoot(root) {
        const orphans = await orphansOf(root);
        if (!orphans.length) return 0;
        const depthMax = Math.max(1, window.tmFolderDepth || 3) + 1;
        const cands = [];
        const walk = async (dir, path) => {
            cands.push({ dir, path });
            if (path.length >= depthMax) return;
            const subs = [];
            try { for await (const e of dir.values()) if (e.kind === 'directory' && !SYS.has(e.name) && !e.name.startsWith('.')) subs.push(e); } catch (e) {}
            for (const s of subs) await walk(s, path.concat(s.name));
        };
        await walk(root, []);
        let moved = 0;
        for (const o of orphans) {
            let best = null, bestScore = 0;
            for (const c of cands) {
                // a folder that already has its own configs in the store is not a candidate
                const own = await dirAt(root, [STORE_DIR].concat(c.path));
                let busy = false;
                if (own) { for (const n of NAMES) { try { await origGetFile.call(own, n); busy = true; break; } catch (e) {} } }
                if (busy) continue;
                const sc = await matchScore(o.fp, c.dir);
                if (sc > bestScore) { best = c; bestScore = sc; }
            }
            if (!best || bestScore < MIN_SCORE) continue;
            const loc = { root, path: best.path };
            const dst = await storeDir(loc, true);
            const n = await moveStoreFolder(o.dir, dst);
            if (n) {
                moved += n;
                fpWritten.delete(root.name + '|' + keyOf(loc));
                await writeFingerprint(loc, best.dir, dst);
                if (window.showAlert) window.showAlert(`🗄️ Dataset "${o.path.join('/')}" was renamed/moved to "${best.path.join('/') || root.name}": its configs were moved along.`, 'success');
            }
        }
        try { await pruneEmpty(root, true); } catch (e) {}
        return moved;
    }
    function scheduleRepair(root) {
        if (!onRoot || !root || repaired.has(root)) return;
        repaired.add(root);
        setTimeout(() => { repairRoot(root).catch(e => console.warn('[ConfigStore] repair', e)); }, 2500);
    }

    P.getFileHandle = async function (name, opts) {
        if (!NAMES.has(name)) return origGetFile.call(this, name, opts);
        await ready;
        const create = !!(opts && opts.create);
        const self = this;
        if (!onRoot) {
            // dataset mode: the fast path is the file already in the dataset
            const here = await tryGet(self, name);
            if (here) return here;
        }
        const loc = await locate(self);
        if (!loc) return origGetFile.call(self, name, opts);   // not inside a saved root: always in the dataset
        return locked(loc.root.name + '/' + loc.path.join('/') + '/' + name, async () => {
            const store = await storeDir(loc, false);
            const primary = onRoot ? store : self, secondary = onRoot ? self : store;
            const hit = await tryGet(primary, name);
            if (hit) { if (onRoot) writeFingerprint(loc, self, store); return hit; }
            const old = await tryGet(secondary, name);
            if (old) {
                const dst = onRoot ? (store || await storeDir(loc, true)) : self;
                const h = await moveFile(secondary, old, dst, name);
                if (onRoot) writeFingerprint(loc, self, dst);
                return h;
            }
            if (onRoot && await adoptOrphanFor(loc, self)) {
                const again = await tryGet(await storeDir(loc, false), name);
                if (again) return again;
            }
            if (!create) throw notFound(name);
            const dst = onRoot ? (store || await storeDir(loc, true)) : self;
            const h = await origGetFile.call(dst, name, { create: true });
            if (onRoot) writeFingerprint(loc, self, dst);
            return h;
        });
    };

    P.removeEntry = async function (name, opts) {
        if (!NAMES.has(name)) return origRemove.call(this, name, opts);
        await ready;
        let removed = false;
        try { await origRemove.call(this, name, opts); removed = true; } catch (e) { if (!isMissing(e)) throw e; }
        const loc = await locate(this);
        if (loc) {
            const store = await storeDir(loc, false);
            if (store) { try { await origRemove.call(store, name, opts); removed = true; } catch (e) { if (!isMissing(e)) throw e; } }
        }
        if (!removed) throw notFound(name);
    };

    /* ---------- move every dataset of a saved root right away ---------- */
    async function migrateRoot(root) {
        movedCount = 0;
        const depthMax = Math.max(1, window.tmFolderDepth || 3) + 1;
        const walk = async (dir, depth) => {
            for (const n of NAMES) { try { await dir.getFileHandle(n); } catch (e) {} }   // the wrapper moves it
            if (depth >= depthMax) return;
            const subs = [];
            try { for await (const e of dir.values()) if (e.kind === 'directory' && !SYS.has(e.name) && !e.name.startsWith('.')) subs.push(e); } catch (e) {}
            for (const s of subs) await walk(s, depth + 1);
        };
        await walk(root, 0);
        if (onRoot) { try { await repairRoot(root); } catch (e) {} }
        if (!onRoot) {
            // files left in _store_configs whose dataset still exists were moved by the walk; drop empty folders
            try { await pruneEmpty(root); } catch (e) {}
        }
        return movedCount;
    }
    // removes empty folders of _store_configs; a folder with only _fingerprint.json left counts as empty
    async function pruneEmpty(root) {
        let store; try { store = await origGetDir.call(root, STORE_DIR); } catch (e) { return; }
        const prune = async (dir) => {
            let empty = true, fpOnly = false;
            const entries = [];
            for await (const e of dir.values()) entries.push(e);
            for (const e of entries) {
                if (e.kind === 'directory') { if (await prune(e)) { try { await origRemove.call(dir, e.name); } catch (x) { empty = false; } } else empty = false; }
                else if (e.name === FP_FILE) fpOnly = true;
                else empty = false;
            }
            if (empty && fpOnly) { try { await origRemove.call(dir, FP_FILE); } catch (x) { empty = false; } }
            return empty;
        };
        if (await prune(store)) { try { await origRemove.call(root, STORE_DIR); } catch (e) {} }
    }

    async function setMode(v, fromUser) {
        onRoot = !!v;
        const cb = document.getElementById('toggle-config-store-root');
        if (cb) cb.checked = onRoot;
        if (!fromUser) return;
        if (typeof window.saveSetting === 'function') window.saveSetting(SETTING, onRoot);
        const root = window.rootHandle && window.rootHandleKey ? window.rootHandle : null;
        if (!root) {
            if (window.showAlert) window.showAlert(onRoot
                ? 'Configs will be stored in "_store_configs" of the saved root. The current folder is not in the Saved directories list, so it keeps its configs inside.'
                : 'Configs will be stored inside each dataset folder.', 'info');
            return;
        }
        try { if (window.TM && typeof window.TM.flushDatasetConfig === 'function') await window.TM.flushDatasetConfig(); } catch (e) {}
        if (window.showAlert) window.showAlert(`Moving the config files of "${root.name}"…`, 'info');
        const n = await migrateRoot(root);
        if (window.showAlert) window.showAlert(onRoot
            ? `Configs are now stored in "${root.name}/${STORE_DIR}" (${n} file(s) moved).`
            : `Configs are now stored inside each dataset folder (${n} file(s) moved back).`, 'success');
    }

    (async () => {
        try {
            if (typeof window.getSetting === 'function') onRoot = !!(await window.getSetting(SETTING, false));
            await loadSavedRoots();
        } catch (e) {}
        readyResolve();
        const cb = document.getElementById('toggle-config-store-root');
        if (cb) cb.checked = onRoot;
    })();

    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'toggle-config-store-root') setMode(e.target.checked, true);
    });
    // a saved root leaves the list while its configs are in _store_configs: move them back into the datasets first
    const wrapRemove = () => {
        const orig = window.removeDirectory;
        if (typeof orig !== 'function' || orig.__csRemove) return false;
        window.removeDirectory = async function () {
            const root = window.rootHandle;
            let hasStore = false;
            if (root) { try { await origGetDir.call(root, STORE_DIR); hasStore = true; } catch (e) {} }
            if (hasStore) {
                try { if (window.TM && typeof window.TM.flushDatasetConfig === 'function') await window.TM.flushDatasetConfig(); } catch (e) {}
                const was = onRoot; onRoot = false;
                let n = 0;
                try { n = await migrateRoot(root); } finally { onRoot = was; }
                if (n && window.showAlert) window.showAlert(`${n} config file(s) moved from "${STORE_DIR}" back into the datasets (the folder left the saved list).`, 'info');
            }
            return orig.apply(this, arguments);
        };
        window.removeDirectory.__csRemove = true;
        return true;
    };
    if (!wrapRemove()) window.addEventListener('DOMContentLoaded', wrapRemove);
    // the saved list changes (+ Add to List / Remove)
    ['saveFolderToList', 'removeDirectory'].forEach(fn => {
        const wrap = () => {
            const orig = window[fn];
            if (typeof orig !== 'function' || orig.__csWrapped) return false;
            window[fn] = async function () { const r = await orig.apply(this, arguments); await loadSavedRoots(); return r; };
            window[fn].__csWrapped = true;
            return true;
        };
        if (!wrap()) window.addEventListener('DOMContentLoaded', wrap);
    });

    window.TMConfigStore = { NAMES, STORE_DIR, isOnRoot: () => onRoot, setMode, migrateRoot, locate, repairRoot, orphansOf };
})();
