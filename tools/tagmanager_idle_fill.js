/* =========================================================================
   IDLE FILL — "Auto-fill when idle" (Tag Manager + Prompt Helper)
   While the app itself has nothing to do (no scan / Fill wiki / lookup running), it quietly fires small
   requests at Danbooru and e621 and grows the local cache by itself:
     1. fills in what the saved tags still lack (counts, category, wiki flag, wiki text per "Wiki text" mode);
     2. when nothing is missing, walks the site's tag list from the most used tag downwards and adds every tag
        that is not in the cache file yet (any tag, not only the ones in the dataset); the new tags then get their
        wiki filled by step 1.
   Needs the Danbooru / e621 cores. API:
     IdleFill.setEnabled(bool) / enabled()      IdleFill.status                IdleFill.onStatus(fn)
     IdleFill.extraPool = () => [tags]          IdleFill.isBusy = () => bool   IdleFill.allowed = () => bool
========================================================================= */
(function () {
    if (window.IdleFill) return;

    const TICK = 15000, BATCH = 8, MAX_FAILS = 2, CRAWL_LIMIT = 100, DONE_RECHECK = 10 * 60 * 1000, MAX_BACKOFF = 10 * 60 * 1000;
    const SETTING = 'idle-fill', CURSOR = 'idle-crawl';

    const S = {
        on: false, running: false, nextAt: 0, backoff: 0, status: '',
        cursor: { danbooru: 1, e621: 1 }, ended: { danbooru: false, e621: false },
        fails: { danbooru: new Map(), e621: new Map() }, listeners: []
    };
    const SITES = {
        danbooru: { label: 'Danbooru', cache: () => window.danbooruCache, counts: 'dbFetchCountsBatch', wiki: 'dbFetchWikiBatch', missing: 'dbMissingInfo', crawl: 'dbCrawlPage', busy: 'dbIsBusy', maxPage: 1000, on: () => true },
        e621: { label: 'e621', cache: () => window.e621Cache, counts: 'e621FetchCountsBatch', wiki: 'e621FetchWikiBatch', missing: 'e621MissingInfo', crawl: 'e621CrawlPage', busy: 'e621IsBusy', maxPage: 750, on: () => window.showE621 !== false }
    };

    function setStatus(t) { S.status = t; S.listeners.forEach(fn => { try { fn(t); } catch (e) {} }); }
    const api = {
        status: '',
        extraPool: null, isBusy: null, allowed: null,
        enabled: () => S.on,
        onStatus(fn) { S.listeners.push(fn); fn(S.status); },
        setEnabled(v, opts) {
            S.on = !!v; S.backoff = 0; S.nextAt = 0;
            S.fails.danbooru.clear(); S.fails.e621.clear(); S.ended.danbooru = S.ended.e621 = false;
            setStatus(S.on ? 'on — starts as soon as the app is idle' : '');
            if (typeof window.saveSetting === 'function') window.saveSetting(SETTING, S.on);
            if (!(opts && opts.fromSync) && window.SharedSettings) window.SharedSettings.set(SETTING, S.on);   // keep Tag Manager <-> Prompt Helper in sync
            if (S.on) setTimeout(tick, 1500);
        },
        tick: () => tick(),
        _state: S
    };
    Object.defineProperty(api, 'status', { get: () => S.status });
    window.IdleFill = api;

    const fn = name => (typeof window[name] === 'function' ? window[name] : null);

    function appBusy() {
        if (window._dbInfoScanRunning) return true;
        if (typeof api.isBusy === 'function' && api.isBusy()) return true;
        for (const k of Object.keys(SITES)) { const b = fn(SITES[k].busy); if (b && b()) return true; }
        return false;
    }
    const lc = t => String(t).toLowerCase();

    function pendingOf(key, pool) {
        const missing = fn(SITES[key].missing);
        if (!missing) return [];
        return missing(pool).filter(t => (S.fails[key].get(lc(t)) || 0) < MAX_FAILS);
    }

    async function saveCursor() {
        if (typeof window.saveSetting === 'function') { try { await window.saveSetting(CURSOR, S.cursor); } catch (e) {} }
    }

    async function tick() {
        if (!S.on || S.running) return;
        if (window.danbooruInfoEnabled === false) return;
        if (Date.now() < S.nextAt) return;
        if (navigator.onLine === false) return;
        if (typeof api.allowed === 'function' && !api.allowed()) return;
        if (appBusy()) return;

        S.running = true;
        try {
            const extra = (typeof api.extraPool === 'function' ? api.extraPool() : []) || [];
            let did = 0, worked = 0, left = 0, added = 0, crawlFailed = false;

            for (const key of Object.keys(SITES)) {
                const site = SITES[key];
                const counts = fn(site.counts), wiki = fn(site.wiki), crawl = fn(site.crawl);
                if (!counts || !wiki || !site.on()) continue;
                if (appBusy()) break;

                const pool = Array.from(new Set(Object.keys(site.cache() || {}).concat(extra)));
                const pending = pendingOf(key, pool);
                left += pending.length;

                if (pending.length) {
                    // 1) fill in what saved tags still lack
                    const batch = pending.slice(0, BATCH);
                    did += batch.length;
                    await counts(batch, false);
                    await wiki(batch, false);
                    const still = new Set(pendingOf(key, batch).map(lc));
                    batch.forEach(t => {
                        const k = lc(t);
                        if (still.has(k)) S.fails[key].set(k, (S.fails[key].get(k) || 0) + 1); else worked++;
                    });
                } else if (crawl && !S.ended[key]) {
                    // 2) nothing missing: bring in the next page of tags (most used first) that are not in the cache yet
                    const page = S.cursor[key] || 1;
                    if (page > site.maxPage) { S.ended[key] = true; continue; }
                    const r = await crawl(page, CRAWL_LIMIT);
                    did++;
                    if (r && r.ok) {
                        worked++; added += r.added || 0;
                        S.cursor[key] = page + 1;
                        if (r.end) S.ended[key] = true;
                        await saveCursor();
                    } else crawlFailed = true;
                }
            }

            if (did === 0) {
                setStatus('on — everything is up to date');
                S.nextAt = Date.now() + DONE_RECHECK;
            } else {
                S.backoff = (worked === 0 || crawlFailed && worked === 0) ? Math.min((S.backoff || TICK) * 2, MAX_BACKOFF) : 0;
                S.nextAt = Date.now() + S.backoff;
                const parts = [];
                if (left) parts.push(`${left} tag(s) to fill`);
                if (added) parts.push(`+${added} new tag(s)`);
                parts.push(`catalog page D${S.cursor.danbooru}${window.showE621 !== false ? ' / e6 ' + S.cursor.e621 : ''}`);
                setStatus('filling — ' + parts.join(' · '));
                if (typeof window.TM !== 'undefined' && window.TM && window.TM.emit) { /* icons refresh by their own timers */ }
            }
        } catch (e) {
            console.warn('[IdleFill]', e);
            S.backoff = Math.min((S.backoff || TICK) * 2, MAX_BACKOFF);
            S.nextAt = Date.now() + S.backoff;
        } finally {
            S.running = false;
        }
    }

    async function boot() {
        if (typeof window.getSetting === 'function') {
            try {
                const cur = await window.getSetting(CURSOR, null);
                if (cur && typeof cur === 'object') { S.cursor.danbooru = cur.danbooru || 1; S.cursor.e621 = cur.e621 || 1; }
                S.on = !!(await window.getSetting(SETTING, false));
            } catch (e) {}
        }
        if (S.on) setStatus('on — starts as soon as the app is idle');
        api.ready = true;
        if (window.SharedSettings) window.SharedSettings.register(SETTING, v => { if (!!v !== S.on) api.setEnabled(v, { fromSync: true }); }, { own: () => S.on });
        S.listeners.forEach(fn => { try { fn(S.status); } catch (e) {} });
        document.dispatchEvent(new CustomEvent('idlefill:ready'));
    }
    setInterval(tick, TICK);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 800));
    else setTimeout(boot, 800);
})();
