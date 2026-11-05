/* =========================================================================
   SHARED SETTINGS — keeps the options that Tag Manager and Prompt Helper have in common in sync
   (wiki text mode, auto-fill when idle, e621 Safe-for-Work, recursive Fill wiki + depth).
   - Each module registers its keys:  SharedSettings.register(key, applyFn, { own: async () => currentValue })
     applyFn(value) must update that module's variables/controls WITHOUT publishing again.
   - Whenever the user changes one of them, the module calls  SharedSettings.set(key, value).
   - Where it lives: localStorage ("modular_shared_settings", live across tabs/pages of the same origin through the
     'storage' event) + on localhost the key is also written to local/user_config.json ("shared-sync"), so it survives
     a different port / browser profile. The newest change (timestamp) wins.
   - First run: if nobody published a value yet, the app's own current value is used (Tag Manager's wins over Prompt Helper's).
   Loads after the settings layer (tagmanager_db.js / prompt_helper_settings.js).
========================================================================= */
(function () {
    if (window.SharedSettings) return;
    const LS_KEY = 'modular_shared_settings', FILE = 'local/user_config.json', FILE_KEY = 'shared-sync';
    const isLocal = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
    const isTM = () => !!(window._dirtySettingsKeys);                 // Tag Manager's settings layer (writes user_config.json itself)
    const SEED_TS = () => (isTM() ? 2 : 1);                           // seeding priority: Tag Manager > Prompt Helper
    const regs = new Map();                                           // key -> applyFn
    const applied = {};                                               // key -> ts already applied here

    const readLS = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { return {}; } };
    const writeLS = m => { try { localStorage.setItem(LS_KEY, JSON.stringify(m)); } catch (e) {} };
    async function readFileMap() {
        if (!isLocal) return {};
        try {
            const r = await fetch('/' + FILE + '?t=' + Date.now(), { cache: 'no-store' });
            if (!r.ok) return {};
            const d = await r.json();
            return (d && d[FILE_KEY] && typeof d[FILE_KEY] === 'object') ? d[FILE_KEY] : {};
        } catch (e) { return {}; }
    }
    async function newest(key) {
        const a = readLS()[key], b = (await readFileMap())[key];
        if (a && b) return (b.ts > a.ts) ? b : a;
        return a || b || null;
    }
    async function persistFile(key, entry) {
        if (!isLocal) return;
        if (isTM()) {                                                 // Tag Manager: its own cache writes the file
            if (typeof window.saveSetting === 'function') {
                const m = Object.assign({}, window._settingsCache && window._settingsCache[FILE_KEY] || {}); m[key] = entry;
                await window.saveSetting(FILE_KEY, m);
            }
            return;
        }
        try {                                                         // Prompt Helper: read-modify-write only this key
            const r = await fetch('/' + FILE + '?t=' + Date.now(), { cache: 'no-store' });
            let data = {};
            if (r.ok) data = await r.json(); else if (r.status !== 404) return;   // unreadable file: never overwrite it
            if (!data || typeof data !== 'object') return;
            data[FILE_KEY] = Object.assign({}, data[FILE_KEY] || {}, { [key]: entry });
            data[key] = entry.v;
            await fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: FILE, data }) });
        } catch (e) {}
    }
    function fire(key, entry) {
        const fn = regs.get(key);
        if (!fn || !entry || (applied[key] || 0) >= entry.ts) return;
        applied[key] = entry.ts;
        if (isTM() && window._settingsCache) { const m = window._settingsCache[FILE_KEY] = Object.assign({}, window._settingsCache[FILE_KEY] || {}); m[key] = entry; }   // keep TM's cache from overwriting the newer value later
        try { fn(entry.v); } catch (e) { console.warn('[SharedSettings]', key, e); }
    }

    const api = {
        keys: () => Array.from(regs.keys()),
        async register(key, applyFn, opts) {
            regs.set(key, applyFn);
            let e = await newest(key);
            if (!e && opts && typeof opts.own === 'function') {
                let v; try { v = await opts.own(); } catch (x) {}
                if (v !== undefined && v !== null) { e = { v, ts: SEED_TS() }; const m = readLS(); m[key] = e; writeLS(m); persistFile(key, e); applied[key] = e.ts; return; }
            }
            fire(key, e);
        },
        set(key, value) {
            const e = { v: value, ts: Date.now() };
            const m = readLS(); m[key] = e; writeLS(m);
            applied[key] = e.ts;
            persistFile(key, e);
        },
        async pull() { for (const k of regs.keys()) fire(k, await newest(k)); }
    };
    window.SharedSettings = api;

    window.addEventListener('storage', ev => {                        // another tab/page changed something
        if (ev.key !== LS_KEY) return;
        const m = readLS(); for (const k of regs.keys()) fire(k, m[k]);
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') api.pull(); });
    window.addEventListener('focus', () => api.pull());
})();
