/* =========================================================================
   CLIENT ERROR LOG -> server console (cmd) — standalone
   ---------------------------------------------------------------------
   Sends the page's errors to server_max.py, which prints them in the cmd
   window in RED (warnings in yellow), with file, line and stack:
     - uncaught errors (window "error")
     - rejected promises nobody caught ("unhandledrejection")
     - console.error / console.warn calls made by the app's modules
     - scripts / images / styles that failed to load (404 etc.)
   Only active when the page is served by the local server (localhost).
   Repeated identical messages are grouped ("x5") so the cmd is not flooded.
   Load it as the FIRST script of the page so it sees everything.
========================================================================= */
(function () {
    if (window.__clientErrorLog) return;
    window.__clientErrorLog = true;
    const host = location.hostname;
    if (!/^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(host)) return;

    const ENDPOINT = '/api/client_log';
    const MAX_PER_MIN = 60;
    const page = decodeURIComponent((location.pathname.split('/').pop() || 'index.html'));
    let buf = [], timer = null, sentThisMin = 0, minuteStart = Date.now(), sending = false;
    const recent = new Map();          // text -> { item, ts } (groups repeats for 3 s)

    const short = s => String(s == null ? '' : s).slice(0, 4000);
    function fileOf(url) {
        try { const u = new URL(url, location.href); return decodeURIComponent(u.pathname.replace(/^\//, '')) || url; } catch (e) { return String(url || ''); }
    }
    function fmtArg(a) {
        if (a instanceof Error) return (a.stack && a.stack.includes(a.message) ? a.stack : (a.name + ': ' + a.message + (a.stack ? '\n' + a.stack : '')));
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
    }

    function push(level, message, extra) {
        const text = short(message);
        const key = level + '|' + text;
        const r = recent.get(key);
        if (r && Date.now() - r.ts < 3000) { r.item.count = (r.item.count || 1) + 1; r.ts = Date.now(); schedule(); return; }
        const item = Object.assign({ level, page, message: text, time: new Date().toTimeString().slice(0, 8) }, extra || {});
        recent.set(key, { item, ts: Date.now() });
        if (recent.size > 200) recent.clear();
        buf.push(item);
        schedule();
    }
    function schedule() { if (!timer) timer = setTimeout(flush, 400); }
    function flush(useBeacon) {
        timer = null;
        if (!buf.length || sending) return;
        if (Date.now() - minuteStart > 60000) { minuteStart = Date.now(); sentThisMin = 0; }
        const room = MAX_PER_MIN - sentThisMin;
        if (room <= 0) { buf = []; return; }
        const items = buf.splice(0, room);
        buf = [];
        sentThisMin += items.length;
        const body = JSON.stringify({ items });
        if (useBeacon && navigator.sendBeacon) { navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' })); return; }
        sending = true;
        _fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 })
            .catch(() => {}).finally(() => { sending = false; if (buf.length) schedule(); });
    }
    const _fetch = window.fetch.bind(window);   // the app may wrap fetch later; logging keeps the original

    // Uncaught errors + failed resources (capture phase sees <script>/<img>/<link> load errors).
    window.addEventListener('error', ev => {
        const t = ev.target;
        if (t && t !== window && (t.tagName === 'SCRIPT' || t.tagName === 'LINK' || t.tagName === 'IMG')) {
            const url = t.src || t.href || '';
            if (/^(blob:|data:)/i.test(url) || !url) return;        // thumbnails etc. — not useful
            push('error', `Failed to load ${t.tagName.toLowerCase()}: ${fileOf(url)} (404 / blocked?)`);
            return;
        }
        const err = ev.error;
        push('error', (err && err.message) || ev.message || 'Unknown error', {
            source: fileOf(ev.filename || ''), line: ev.lineno || 0, col: ev.colno || 0,
            stack: err && err.stack ? short(err.stack) : ''
        });
    }, true);

    window.addEventListener('unhandledrejection', ev => {
        const r = ev.reason;
        if (r && r.name === 'AbortError') return;                    // user pressed Stop / cancelled
        push('error', 'Unhandled promise: ' + ((r && r.message) || fmtArg(r)), { stack: r && r.stack ? short(r.stack) : '' });
    });

    // console.error / console.warn of the modules (still shown in DevTools as usual).
    ['error', 'warn'].forEach(level => {
        const orig = console[level];
        console[level] = function (...args) {
            try {
                const where = (new Error().stack || '').split('\n').slice(2, 3).join('').trim();
                push(level, args.map(fmtArg).join(' '), { stack: where });
            } catch (e) { /* never break the app because of logging */ }
            return orig.apply(this, args);
        };
    });

    window.addEventListener('pagehide', () => flush(true));
    push('info', `Page opened: ${page}`);
})();
