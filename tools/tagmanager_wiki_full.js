/* =========================================================================
   WIKI FULL STORE — "Expand save mode" (Tag Interrogator), localhost only
   ---------------------------------------------------------------------
   Keeps the FULL wiki text (raw DText: text + links) of each tag in its OWN
   file, local/wiki_full.json, so the Danbooru / e621 validation caches
   (local/danbooru_cache.json, local/e621_cache.json) do not grow.
   Those caches are only used to look the tag up; the description comes from
   this file.

   File format: { "danbooru": { "long hair": { "t": "<wiki text>", "ts": 1700000000000 } },
                  "e621":     { ... } }

   window.WikiFull.get(site, tag)        -> { text, ts } | null
   window.WikiFull.has(site, tag)        -> boolean
   window.WikiFull.set(site, tag, text)  -> saves (debounced write)
   window.WikiFull.remove(site, tag)
   window.WikiFull.stats()               -> { danbooru: n, e621: n }
   window.WikiFull.load()                -> Promise (reads the file once)

   site: 'danbooru' | 'e621'. Does nothing outside localhost.
   Must load before tagmanager_booru_core.js (it only uses this when present).
========================================================================= */
(function () {
    if (window.WikiFull) return;

    const FILE = 'local/wiki_full.json';
    const SITES = ['danbooru', 'e621'];
    const isLocal = () => (typeof window.MAT_IS_LOCAL === 'boolean')
        ? window.MAT_IS_LOCAL
        : ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
    const norm = t => String(t || '').trim().toLowerCase().replace(/_/g, ' ');

    const data = {};
    SITES.forEach(s => { data[s] = {}; });
    let loadPromise = null;
    let loadOk = false;          // false until the file was read (or confirmed missing): never overwrite a file we could not read
    let saveTimer = null;
    let dirty = false;

    async function load() {
        if (!isLocal()) return;
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            try {
                const res = await fetch('/' + FILE + '?t=' + Date.now(), { cache: 'no-store' });
                if (res.ok) {
                    const json = await res.json();
                    SITES.forEach(s => {
                        const disk = (json && json[s]) || {};
                        // what was saved in memory before the file finished loading wins
                        data[s] = Object.assign({}, disk, data[s]);
                    });
                    loadOk = true;
                } else if (res.status === 404) {
                    loadOk = true;       // no file yet: nothing to lose
                }
            } catch (e) { /* server not reachable: loadOk stays false */ }
            if (!loadOk) loadPromise = null;   // allow another attempt
        })();
        return loadPromise;
    }

    function write(unload) {
        if (!loadOk) return;   // the file could not be read: writing now could erase what is saved
        const body = JSON.stringify({ file: FILE, data });
        const send = async () => {
            try {
                await fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            } catch (e) { console.warn('[WikiFull] Could not save', FILE, e); }
        };
        if (unload) {
            try { fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60 * 1024 }); } catch (e) {}
            return;
        }
        if (typeof window._queueLocalCacheWrite === 'function') window._queueLocalCacheWrite(send);
        else send();
    }

    function schedule() {
        dirty = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { saveTimer = null; dirty = false; write(false); }, 1500);
    }
    function flush(unload) {
        if (!dirty) return;
        clearTimeout(saveTimer); saveTimer = null; dirty = false;
        write(unload);
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(false); });
    window.addEventListener('pagehide', () => flush(true));

    window.WikiFull = {
        load,
        ready() { return loadOk; },
        /* Wiki save mode (window.danbooruWikiMode): 'off' | 'short' (800 chars, default) | 'full' */
        mode() { return ['off', 'short', 'full'].includes(window.danbooruWikiMode) ? window.danbooruWikiMode : 'short'; },
        /* { text, ts, full } — full=false means the 800-char summary (entries without "m" are full texts from the first version) */
        get(site, tag) {
            const e = data[site] && data[site][norm(tag)];
            return e ? { text: e.t, ts: e.ts, full: e.m !== 's' } : null;
        },
        /* needFull: only counts if the saved text is the complete one */
        has(site, tag, needFull) {
            const e = data[site] && data[site][norm(tag)];
            return !!e && (!needFull || e.m !== 's');
        },
        set(site, tag, text, ts, full) {
            if (!isLocal() || !data[site] || !text || !String(text).trim()) return false;
            const e = { t: String(text).trim(), ts: ts || Date.now() };
            if (full === false) e.m = 's';
            data[site][norm(tag)] = e;
            schedule();
            return true;
        },
        remove(site, tag) {
            if (!data[site] || !data[site][norm(tag)]) return;
            delete data[site][norm(tag)];
            schedule();
        },
        /* Tags saved in the file for a site (needFull: only the ones with the complete text). */
        keys(site, needFull) {
            const d = data[site] || {};
            return Object.keys(d).filter(k => !needFull || d[k].m !== 's');
        },
        stats() { return { danbooru: Object.keys(data.danbooru).length, e621: Object.keys(data.e621).length }; }
    };

    if (isLocal()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => load());
        else load();
    }
})();
