/* ================================================================
   DIR MIRROR  (Gallery Holder · Gallery Timeline · Tag Manager · Model Evaluate — localhost)
   ----------------------------------------------------------------
   The saved directories live in the browser's IndexedDB, and the browser can wipe it (site data cleared, storage
   pressure...). This file keeps a COPY of everything that can be copied in local/dirs_<app>.json:
     - which directories were saved (a folder handle can NOT be written to a file: it only exists inside IndexedDB);
     - the plain settings stored next to them (path labels, hidden folders, ⚙️ options...).
   When the browser lost them, the app shows them as "↻ name (re-link)": one click opens the folder picker and the folder
   goes back under its old key, so everything saved for it returns.
   The copy is never shortened by a missing entry: it only changes when a directory is added or removed in the app.
   It also asks the browser for persistent storage, so the site data is not wiped on its own when disk space is low.

   Usage:  const m = DirMirror.setup({ app, db, store, nameOf?, skip?, isDir?, localOnly? });
           m.missing(keysTheBrowserHas) · m.fillSelect(select, keys) · m.relink(key) · m.forget(key) · m.ready
   ================================================================ */
(function () {
    'use strict';
    if (window.DirMirror && window.DirMirror._v >= 2) return;
    const isLocal = /^https?:$/.test(location.protocol) && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
    const instances = [];                          // one per db/store
    const NOOP = { ready: Promise.resolve(), missing: () => [], fillSelect: async () => {}, relink: async () => null, forget: () => {}, clearDirs: async () => 0, nameOf: k => k };

    // Persistent storage: the browser no longer evicts this site's IndexedDB on its own (Chrome grants it to sites in use).
    if (isLocal && navigator.storage && navigator.storage.persist) {
        navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
    }

    function localOnlyNotice() {
        const page = decodeURIComponent((location.pathname.split('/').pop() || ''));
        const show = () => {
            if (document.getElementById('dm-local-only')) return;
            const d = document.createElement('div');
            d.id = 'dm-local-only';
            d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0b0b0d;color:#e6e6e6;display:flex;align-items:center;justify-content:center;font:15px/1.6 sans-serif;text-align:center;padding:24px;';
            d.innerHTML = '<div style="max-width:520px"><div style="font-size:42px">🔒</div><h2 style="margin:8px 0">Local server required</h2>' +
                '<p>This tool only runs with the local server (it keeps your saved directories in <b>local/</b> so the browser cannot lose them).</p>' +
                '<p>Run <b>Modular AI Tools localhost.bat</b> and open<br><b class="dm-url"></b></p></div>';
            d.querySelector('.dm-url').textContent = 'http://localhost:8100/' + encodeURI(page);
            document.body.appendChild(d);
        };
        if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
    }

    // Every write the apps make to a watched store is copied (put / delete are watched from here, before the apps use them).
    const P = IDBObjectStore.prototype, origPut = P.put, origDelete = P.delete;
    let patched = false;
    function patch() {
        if (patched) return; patched = true;
        P.put = function (value, key) {
            try { const dbn = this.transaction.db.name, sn = this.name; for (const m of instances) if (m._db === dbn && m._store === sn) m._note(key, value); } catch (e) {}
            return origPut.apply(this, arguments);
        };
        P.delete = function (key) {
            try { const dbn = this.transaction.db.name, sn = this.name; for (const m of instances) if (m._db === dbn && m._store === sn) m._drop(key); } catch (e) {}
            return origDelete.apply(this, arguments);
        };
    }

    const jsonSafe = v => {
        if (v === undefined || v === null || typeof v === 'function') return undefined;
        if (v instanceof Map || v instanceof Set || v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return undefined;
        try { const s = JSON.stringify(v); return s === undefined || s.length > 1e6 ? undefined : JSON.parse(s); } catch (e) { return undefined; }
    };
    const isHandle = v => !!v && typeof v === 'object' && v.kind === 'directory' && typeof v.getDirectoryHandle === 'function';

    function setup(cfg) {
        if (cfg.localOnly && !isLocal) { localOnlyNotice(); return NOOP; }
        if (!isLocal) return NOOP;
        const dup = instances.find(m => m._db === cfg.db && m._store === cfg.store);
        if (dup) return dup;
        const nameOf = cfg.nameOf || (k => String(k));
        const skip = cfg.skip || (() => false);
        const isDir = cfg.isDir || (() => true);         // false → the handle is kept by the app on its own (not listed as a directory)
        const FILE = 'local/dirs_' + cfg.app + '.json';
        let mirror = { v: 1, dirs: {}, extras: {} };
        let dirty = false, timer = null, restoring = false;

        const m = { _db: cfg.db, _store: cfg.store, nameOf };
        const schedule = () => { clearTimeout(timer); timer = setTimeout(flush, 1500); };
        function flush(keep) {
            clearTimeout(timer);
            if (!dirty) return Promise.resolve();
            dirty = false;
            return fetch('/api/save_local_cache', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: !!keep,
                body: JSON.stringify({ file: FILE, data: mirror })
            }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); }).catch(e => { dirty = true; console.warn('Could not save ' + FILE + ':', e); });
        }
        m._note = (key, v) => {
            if (restoring || typeof key !== 'string' || skip(key)) return;
            if (isHandle(v)) { if (!isDir(key)) return; mirror.dirs[key] = { name: v.name || nameOf(key), ts: Date.now() }; dirty = true; }
            else { const j = jsonSafe(v); if (j === undefined) return; mirror.extras[key] = j; dirty = true; }
            schedule();
        };
        m._drop = key => {
            if (restoring || typeof key !== 'string') return;
            let ch = false;
            if (key in mirror.dirs) { delete mirror.dirs[key]; ch = true; }
            if (key in mirror.extras) { delete mirror.extras[key]; ch = true; }
            if (ch) { dirty = true; schedule(); }
        };
        window.addEventListener('pagehide', () => { if (dirty) flush(true); });
        document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) flush(true); });

        /* Entries of the copy that the browser no longer has (haveKeys = keys of the saved handles): [{ key, name }] */
        m.missing = haveKeys => {
            const have = new Set((haveKeys || []).map(String));
            return Object.keys(mirror.dirs).filter(k => !have.has(k)).map(k => ({ key: k, name: mirror.dirs[k].name || nameOf(k) }))
                .sort((a, b) => a.name.localeCompare(b.name));
        };
        /* Adds "↻ name (re-link)" options to a directory dropdown (value = "relink:" + key) */
        m.fillSelect = async (list, haveKeys) => {
            await m.ready;
            m.missing(haveKeys).forEach(x => {
                const o = document.createElement('option');
                o.value = 'relink:' + x.key; o.textContent = '↻ ' + nameOf(x.key) + ' (re-link)';
                o.title = 'The browser lost this folder. Pick it again: everything saved for it comes back.';
                list.appendChild(o);
            });
        };
        /* Opens the folder picker for a missing entry. Returns the new handle (or null); the app saves it under the old key. */
        m.relink = async key => {
            const name = (mirror.dirs[key] && mirror.dirs[key].name) || nameOf(key);
            const id = 'mat-' + String(name).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24);
            try { return await window.showDirectoryPicker({ id, mode: 'readwrite' }); }
            catch (e) { if (e.name !== 'AbortError') alert('Permission error.'); return null; }
        };
        /* Clears every saved directory: the browser's handles and the copy in local/ (settings of other kinds stay) */
        m.clearDirs = async (keysToDelete) => {
            await m.ready;
            const keys = new Set([...(keysToDelete || []), ...Object.keys(mirror.dirs)]);
            try {
                let exists = true;
                try { if (indexedDB.databases) exists = (await indexedDB.databases()).some(d => d.name === cfg.db); } catch (e) {}
                if (exists) {
                    const db = await new Promise((res, rej) => { const q = indexedDB.open(cfg.db); q.onsuccess = e => { const d = e.target.result; d.onversionchange = () => d.close(); res(d); }; q.onerror = e => rej(e.target.error); });
                    if (db.objectStoreNames.contains(cfg.store)) await new Promise(r => {
                        const tx = db.transaction(cfg.store, 'readwrite'), st = tx.objectStore(cfg.store);
                        keys.forEach(k => origDelete.call(st, k));
                        tx.oncomplete = r; tx.onerror = r; tx.onabort = r;
                    });
                    db.close();
                }
            } catch (e) { console.warn('Dir mirror clear:', e); }
            keys.forEach(k => delete mirror.dirs[k]);
            dirty = true; await flush();
            return keys.size;
        };
        /* Forgets an entry of the copy (and what was saved for it) — e.g. the user removed it from the re-link list */
        m.forget = key => m._drop(key);

        m.ready = (async () => {
            try {
                const r = await fetch('/' + FILE + '?t=' + Date.now(), { cache: 'no-store' });
                if (r.ok && /json/i.test(r.headers.get('content-type') || '')) {
                    const j = await r.json();
                    if (j && typeof j === 'object') mirror = { v: 1, dirs: j.dirs || {}, extras: j.extras || {} };
                }
            } catch (e) {}
            try {
                // Only an existing database is opened (without a version), so this never creates or upgrades the app's database.
                let exists = true;
                try { if (indexedDB.databases) exists = (await indexedDB.databases()).some(d => d.name === cfg.db); } catch (e) {}
                if (!exists) { if (dirty) flush(); return; }
                const db = await new Promise((res, rej) => { const q = indexedDB.open(cfg.db); q.onsuccess = e => { const d = e.target.result; d.onversionchange = () => d.close(); res(d); }; q.onerror = e => rej(e.target.error); });
                if (db.objectStoreNames.contains(cfg.store)) {
                    const st = db.transaction(cfg.store, 'readonly').objectStore(cfg.store);
                    const keys = await new Promise(r => { const q = st.getAllKeys(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); });
                    const vals = await new Promise(r => { const q = st.getAll(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); });
                    const have = new Set(keys);
                    // 1) what the browser has but the copy does not (first run, or saved before this existed)
                    keys.forEach((k, i) => { if (typeof k === 'string' && !skip(k) && !(k in mirror.dirs) && !(k in mirror.extras)) m._note(k, vals[i]); });
                    // 2) plain settings the copy has and the browser lost: put back (the directories need the re-link click)
                    const lost = Object.keys(mirror.extras).filter(k => !have.has(k));
                    if (lost.length) {
                        restoring = true;
                        await new Promise(r => {
                            const tx = db.transaction(cfg.store, 'readwrite');
                            lost.forEach(k => origPut.call(tx.objectStore(cfg.store), mirror.extras[k], k));
                            tx.oncomplete = r; tx.onerror = r; tx.onabort = r;
                        });
                        restoring = false;
                    }
                }
                db.close();
            } catch (e) { restoring = false; console.warn('Dir mirror:', e); }
            if (dirty) flush();
        })();

        instances.push(m);
        patch();
        return m;
    }

    window.DirMirror = {
        _v: 2, isLocal, setup,
        get: (db, store) => instances.find(m => m._db === db && m._store === store) || NOOP
    };
})();
