/* =========================================================================
   BOORU STATUS — availability checker for Danbooru and e621
   ---------------------------------------------------------------------
   Shows two small dots (one per site):
     green  = Online        (responded OK and fast)
     yellow = Issues        (slow, rate limited 429, blocked 403, server error 500, bad response)
     red    = Offline       (no connection, timeout, 502/503/504/52x)
     gray   = Checking...

   Usage (any page):  <div data-booru-status></div>
                      <script src="tools/shared/booru_status.js"></script>
   or manually:       BooruStatus.mount(element, { interval: 60000 })
   Other scripts:     BooruStatus.get('danbooru') -> { state, ms, status, checkedAt }
                      window.addEventListener('booru-status', e => e.detail)
   Standalone: does not depend on any other tool file. e621 follows the
   SFW switch (e926.net) when window.showE621Sfw is set.

   REQUEST GATE (2026-11): every fetch() to Danbooru / e621 / e926 made by the
   page goes through here first:
     - the status is checked when the app starts;
     - a site that failed (offline / having issues) is checked again every 5 min,
       and while it is not Online NO request is sent to its API (the call fails
       right away with "… request not sent", the callers treat it as an error and
       try again later — nothing is marked as unknown);
     - before a request, if the last check is older than 60 s, the status is
       checked first and only then the request is sent.
   BooruStatus.canRequest(id) / BooruStatus.ensure(id) for other scripts.
========================================================================= */
(function () {
    if (window.BooruStatus) return;

    const TIMEOUT_MS = 8000;      // no answer in 8 s = offline
    const SLOW_MS = 3500;         // answered, but slower than this = issues
    const DEFAULT_INTERVAL = 5 * 60000;   // background re-check (failed sites are retried every 5 min)
    const FRESH_MS = 60000;               // a request older than this re-checks the status first
    const RETRY_MS = 5 * 60000;           // failed site: next check

    const SITES = {
        danbooru: { label: 'Danbooru', host: () => 'danbooru.donmai.us', labelColor: '#9aa0a6' },
        e621:     { label: 'e621',     host: () => (window.showE621Sfw ? 'e926.net' : 'e621.net'), labelColor: '#ff7eb6' }
    };
    const STATE_INFO = {
        checking: { color: '#6b7280', text: 'Checking...' },
        online:   { color: '#3ddc84', text: 'Online' },
        issues:   { color: '#ffb300', text: 'Having issues' },
        offline:  { color: '#ff4d4d', text: 'Offline' }
    };

    const status = {};
    Object.keys(SITES).forEach(id => { status[id] = { state: 'checking', ms: null, status: null, reason: '', checkedAt: null }; });

    const enabled = { danbooru: true, e621: true };   // BooruStatus.setEnabled(id, bool): hides the dot and stops its checks
    let mounts = [];
    let timer = null;
    let interval = DEFAULT_INTERVAL;
    const running = {};
    const runningP = {};                  // id -> Promise of the check in progress
    const retryTimer = {};
    const realFetch = window.fetch.bind(window);

    function injectStyle() {
        if (document.getElementById('booru-status-style')) return;
        const st = document.createElement('style');
        st.id = 'booru-status-style';
        st.textContent = `
            .booru-status { display: inline-flex; align-items: center; gap: 12px; cursor: pointer; user-select: none; font-size: 10px; font-weight: normal; line-height: 1; }
            .booru-status-item { display: inline-flex; align-items: center; gap: 5px; }
            .booru-status-dot { width: 9px; height: 9px; border-radius: 50%; background: #6b7280; box-shadow: 0 0 0 1px rgba(0,0,0,.5); transition: background .25s, box-shadow .25s; flex-shrink: 0; }
            .booru-status-dot.is-online  { background: #3ddc84; box-shadow: 0 0 6px rgba(61,220,132,.65); }
            .booru-status-dot.is-issues  { background: #ffb300; box-shadow: 0 0 6px rgba(255,179,0,.65); }
            .booru-status-dot.is-offline { background: #ff4d4d; box-shadow: 0 0 6px rgba(255,77,77,.65); }
            .booru-status-dot.is-checking { animation: booru-status-pulse 1s ease-in-out infinite; }
            .booru-status-name { opacity: .85; }
            @keyframes booru-status-pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
        `;
        document.head.appendChild(st);
    }

    function fmtTime(ts) {
        return ts ? new Date(ts).toLocaleTimeString('en-US') : '-';
    }

    function tooltip(id) {
        const s = status[id], info = STATE_INFO[s.state];
        let t = `${SITES[id].label} (${SITES[id].host()}): ${info.text}`;
        if (s.state !== 'checking') {
            if (s.ms !== null) t += ` - ${s.ms} ms`;
            if (s.reason) t += `\n${s.reason}`;
            t += `\nLast check: ${fmtTime(s.checkedAt)}`;
        }
        return t + '\nClick to check this site again';
    }

    function paint() {
        mounts = mounts.filter(m => m.el.isConnected);
        mounts.forEach(m => {
            Object.keys(SITES).forEach(id => {
                const dot = m.dots[id];
                dot.className = 'booru-status-dot is-' + status[id].state;
                m.items[id].title = tooltip(id);
                m.items[id].style.display = enabled[id] ? '' : 'none';
            });
            m.el.style.display = Object.keys(SITES).some(id => enabled[id]) ? '' : 'none';
        });
    }

    async function probe(id) {
        const url = `https://${SITES[id].host()}/tags.json?limit=1&_=${Date.now()}`;
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const t0 = performance.now();
        try {
            const res = await realFetch(url, { signal: ctrl.signal, cache: 'no-store' });
            const ms = Math.round(performance.now() - t0);
            const r = { ms, status: res.status, state: 'online', reason: '' };
            if (res.status === 429) { r.state = 'issues'; r.reason = 'Rate limited (HTTP 429)'; }
            else if (res.status === 403) { r.state = 'issues'; r.reason = 'Request blocked (HTTP 403)'; }
            else if (res.status === 502 || res.status === 503 || res.status === 504 || (res.status >= 520 && res.status <= 530)) { r.state = 'offline'; r.reason = `Server unavailable (HTTP ${res.status})`; }
            else if (res.status >= 500) { r.state = 'issues'; r.reason = `Server error (HTTP ${res.status})`; }
            else if (!res.ok) { r.state = 'issues'; r.reason = `Unexpected response (HTTP ${res.status})`; }
            else {
                try { await res.json(); }
                catch (e) { r.state = 'issues'; r.reason = 'Invalid response body'; }
                if (r.state === 'online' && ms > SLOW_MS) { r.state = 'issues'; r.reason = 'Slow response'; }
            }
            return r;
        } catch (e) {
            const aborted = e && e.name === 'AbortError';
            return { ms: aborted ? TIMEOUT_MS : null, status: null, state: 'offline', reason: aborted ? 'Timed out' : 'Could not connect' };
        } finally {
            clearTimeout(to);
        }
    }

    async function checkOne(id) {
        let r = await probe(id);
        // one quick retry before declaring a site offline (avoids flicker on a single dropped request)
        if (r.state === 'offline') {
            await new Promise(res => setTimeout(res, 1500));
            const r2 = await probe(id);
            if (r2.state !== 'offline') r = r2;
        }
        status[id] = { state: r.state, ms: r.ms, status: r.status, reason: r.reason, checkedAt: Date.now() };
        paint();
        // failed: check again in 5 min (requests stay blocked until then)
        clearTimeout(retryTimer[id]);
        if (r.state !== 'online') retryTimer[id] = setTimeout(() => { if (navigator.onLine !== false) check(id); }, RETRY_MS);
        try { window.dispatchEvent(new CustomEvent('booru-status', { detail: { id, ...status[id] } })); } catch (e) {}
    }

    // Checks one site (id) or all of them (no argument). Each site has its own lock.
    async function check(id) {
        const ids = id ? [id] : Object.keys(SITES);
        await Promise.all(ids.map(sid => {
            if (!SITES[sid] || !enabled[sid]) return null;
            if (running[sid]) return runningP[sid];
            running[sid] = true;
            runningP[sid] = (async () => {
                try { await checkOne(sid); }
                finally { running[sid] = false; runningP[sid] = null; }
            })();
            return runningP[sid];
        }));
    }
    const checkAll = () => check();

    function schedule() {
        clearInterval(timer);
        timer = setInterval(() => { if (!document.hidden && navigator.onLine !== false) checkAll(); }, interval);
    }

    function mount(el, opts) {
        if (!el || el.dataset.booruMounted) return;
        injectStyle();
        el.dataset.booruMounted = '1';
        if (opts && opts.interval) interval = Math.max(15000, opts.interval);
        const wrap = document.createElement('span');
        wrap.className = 'booru-status';
        const m = { el: wrap, dots: {}, items: {} };
        Object.keys(SITES).forEach(id => {
            const item = document.createElement('span');
            item.className = 'booru-status-item';
            const dot = document.createElement('span');
            dot.className = 'booru-status-dot is-checking';
            const name = document.createElement('span');
            name.className = 'booru-status-name';
            name.textContent = SITES[id].label;
            name.style.color = SITES[id].labelColor;
            item.style.cursor = 'pointer';
            item.addEventListener('click', e => {
                e.stopPropagation();
                if (running[id]) return;
                status[id].state = 'checking';
                paint();
                check(id);
            });
            item.appendChild(dot); item.appendChild(name);
            wrap.appendChild(item);
            m.dots[id] = dot; m.items[id] = item;
        });
        el.appendChild(wrap);
        mounts.push(m);
        paint();
        schedule();
        checkAll();
    }

    function autoMount() {
        document.querySelectorAll('[data-booru-status]').forEach(el => mount(el));
        // status check at startup even when no dots are shown
        if (!started) { started = true; schedule(); checkAll(); }
    }
    let started = false;

    /* ---------- REQUEST GATE ---------- */
    function siteOfUrl(u) {
        let host = '';
        try { host = new URL(u, location.href).hostname.toLowerCase(); } catch (e) { return null; }
        if (host === 'danbooru.donmai.us' || host.endsWith('.donmai.us')) return 'danbooru';
        if (host === 'e621.net' || host.endsWith('.e621.net') || host === 'e926.net' || host.endsWith('.e926.net')) return 'e621';
        return null;
    }
    // Makes sure the status is known and fresh before a request (waits for a check in progress).
    async function ensure(id) {
        if (!SITES[id] || !enabled[id]) return true;
        if (running[id] && runningP[id]) await runningP[id];
        const s = status[id];
        const age = s.checkedAt ? Date.now() - s.checkedAt : Infinity;
        if (s.state === 'online') { if (age > FRESH_MS) await check(id); }
        else if (s.state === 'checking' || age > RETRY_MS) await check(id);
        return status[id].state === 'online';
    }
    function canRequest(id) { return !SITES[id] || !enabled[id] || status[id].state === 'online'; }
    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) ? input.url : String(input || '');
        const id = siteOfUrl(url);
        if (!id) return realFetch(input, init);
        const ok = await ensure(id);
        if (!ok) {
            const s = status[id];
            throw new TypeError(`${SITES[id].label} is ${STATE_INFO[s.state].text.toLowerCase()}${s.reason ? ' (' + s.reason + ')' : ''} — request not sent, next check in 5 min.`);
        }
        return realFetch(input, init);
    };

    document.addEventListener('visibilitychange', () => { if (!document.hidden && mounts.length) checkAll(); });
    window.addEventListener('online', () => { if (mounts.length) checkAll(); });
    window.addEventListener('offline', () => {
        Object.keys(SITES).forEach(id => { status[id] = { state: 'offline', ms: null, status: null, reason: 'No internet connection', checkedAt: Date.now() }; });
        paint();
    });

    window.BooruStatus = {
        mount,
        recheck: check,
        setEnabled(id, on) {
            if (!SITES[id]) return;
            on = !!on;
            if (enabled[id] === on) return;
            enabled[id] = on;
            if (on) { status[id].state = 'checking'; paint(); check(id); } else { clearTimeout(retryTimer[id]); paint(); }
        },
        isEnabled: id => !!enabled[id],
        canRequest,
        ensure,
        get: id => (status[id] ? { ...status[id] } : null),
        all: () => JSON.parse(JSON.stringify(status))
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount);
    else autoMount();
})();
