/* =========================================================================
   PROMPT HELPER — SETTINGS + ALERT + QUEUE LAYER
   Replaces tagmanager_db.js. Needed by the Danbooru/e621 cores for
   getSetting / saveSetting / local write queue.
   On localhost the cores prefer the real files under /local/ and the
   /api/save_local_cache endpoint of the same server Tag Manager uses.
   Must load BEFORE tagmanager_danbooru_core.js / tagmanager_e621_core.js.
========================================================================= */
(function () {
    const LS_PREFIX = 'ph_setting_';
    window._settingsCache = window._settingsCache || {};

    window.getSetting = async function (key, defaultValue) {
        if (window._settingsCache[key] !== undefined) return window._settingsCache[key];
        try {
            const raw = localStorage.getItem(LS_PREFIX + key);
            if (raw !== null) {
                const parsed = JSON.parse(raw);
                window._settingsCache[key] = parsed;
                return parsed;
            }
        } catch (e) {}
        return defaultValue;
    };

    window.saveSetting = async function (key, value) {
        window._settingsCache[key] = value;
        try {
            localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
        } catch (e) {}
    };

    // Serialize local cache writes (same idea as tagmanager_db.js)
    let _localWriteQueue = Promise.resolve();
    window._queueLocalCacheWrite = function (fn) {
        const run = () => Promise.resolve().then(fn).catch(e => console.warn('[local cache write]', e));
        _localWriteQueue = _localWriteQueue.then(run, run);
        return _localWriteQueue;
    };

    window.showAlert = function (msg, type = 'info') {
        const bar = document.getElementById('alertBar');
        if (!bar) return;
        bar.className = type;
        bar.textContent = msg;
        bar.style.display = 'block';
        clearTimeout(window._alertTimer);
        window._alertTimer = setTimeout(() => { bar.style.display = 'none'; }, 3200);
    };

    // Defaults the cores expect
    window.danbooruCache = window.danbooruCache || {};
    window.e621Cache = window.e621Cache || {};
    window.showE621 = true;
    window.showE621Sfw = false;
    window.aliasClickBehavior = 'replace';
    window.e621AliasClickBehavior = 'replace';
    window._danbooruCacheVersion = window._danbooruCacheVersion || 0;
    window._e621CacheVersion = window._e621CacheVersion || 0;
})();