/* =========================================================================
   LOCAL STORE — big data kept OUT of user_config.json (localhost)
   ---------------------------------------------------------------------
   user_config.json is rewritten whole on every setting change, so large data does not belong there.
   Each entry below lives in its own file under local/:
       'nl-known-texts'    -> local/nl_known_texts.json        (NL sentences reserve)
       'evaluator-results' -> local/evaluator_results.json     (scores, verdicts, comments)
   API (same shape as getSetting / saveSetting):
       await LocalStore.get(key, default)      LocalStore.set(key, data)
   - Localhost: reads / writes the own file. First run: whatever is still in user_config.json under that key
     is moved to the file (merged, the file wins) and then removed from user_config.json.
   - Elsewhere (no files): falls back to getSetting / saveSetting, as before.
   - If the file cannot be read (server error), nothing is written, so existing data is never overwritten.
   Must load after tagmanager_db.js (getSetting / saveSetting / write queue).
========================================================================= */
(function () {
    if (window.LocalStore) return;

    const FILES = {
        'nl-known-texts': 'local/nl_known_texts.json',
        'evaluator-results': 'local/evaluator_results.json'
    };
    const isLocal = () => (typeof window.MAT_IS_LOCAL === 'boolean')
        ? window.MAT_IS_LOCAL
        : ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);

    const data = {};      // key -> object in memory
    const loaded = {};    // key -> true when the file was read (or confirmed missing)
    const loading = {};   // key -> promise
    const timers = {};

    async function postFile(file, obj) {
        const body = JSON.stringify({ file, data: obj });
        const send = async () => {
            try {
                const res = await fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
                return res.ok;
            } catch (e) { return false; }
        };
        if (typeof window._queueLocalCacheWrite === 'function') {
            let ok = false;
            await window._queueLocalCacheWrite(async () => { ok = await send(); });
            return ok;
        }
        return send();
    }

    async function loadLocal(key) {
        const file = FILES[key];
        let fileData = null, readable = false;
        try {
            const res = await fetch('/' + file + '?t=' + Date.now(), { cache: 'no-store' });
            if (res.ok) { fileData = await res.json(); readable = true; }
            else if (res.status === 404) readable = true;
        } catch (e) { /* server not reachable */ }
        if (!readable) { console.warn('[LocalStore] could not read', file, '- nothing will be written to it'); return {}; }

        let out = (fileData && typeof fileData === 'object') ? fileData : {};
        // migration: data still stored inside user_config.json
        let old = null;
        try { old = typeof window.getSetting === 'function' ? await window.getSetting(key, undefined) : undefined; } catch (e) {}
        if (typeof old === 'string') { try { old = JSON.parse(old); } catch (e) { old = null; } }
        if (old && typeof old === 'object' && Object.keys(old).length) {
            out = Object.assign({}, old, out);                  // the file wins
            if (await postFile(file, out)) {                    // only drop it from user_config.json once the file is safe
                if (typeof window.saveSetting === 'function') window.saveSetting(key, undefined);
                console.log(`[LocalStore] moved "${key}" (${Object.keys(out).length} entries) from user_config.json to ${file}`);
            }
        }
        loaded[key] = true;
        return out;
    }

    window.LocalStore = {
        FILES,
        async get(key, def) {
            if (!FILES[key] || !isLocal()) return typeof window.getSetting === 'function' ? window.getSetting(key, def) : def;
            if (!loading[key]) loading[key] = loadLocal(key).then(d => { data[key] = d; return d; });
            const d = await loading[key];
            return (d && Object.keys(d).length) ? d : def;
        },
        set(key, obj) {
            if (!FILES[key] || !isLocal()) { if (typeof window.saveSetting === 'function') window.saveSetting(key, obj); return; }
            if (!loaded[key]) return;             // the file was not read: never overwrite it
            data[key] = obj;
            clearTimeout(timers[key]);
            timers[key] = setTimeout(() => { timers[key] = null; postFile(FILES[key], data[key]); }, 600);
        },
        flush(unload) {
            Object.keys(timers).forEach(k => {
                if (!timers[k]) return;
                clearTimeout(timers[k]); timers[k] = null;
                const body = JSON.stringify({ file: FILES[k], data: data[k] });
                if (unload && typeof window._postLocalCacheOnUnload === 'function') window._postLocalCacheOnUnload(body);
                else postFile(FILES[k], data[k]);
            });
        }
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') window.LocalStore.flush(false); });
    window.addEventListener('pagehide', () => window.LocalStore.flush(true));
})();
