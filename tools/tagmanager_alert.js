/* =========================================================================
   ALERT BAR + SHARED HELPERS (Tag Manager)
   ---------------------------------------------------------------------
   window.showAlert(message, type = 'info', durationMs)
     type: 'success' | 'error' | 'warn' | 'info'
   Uses the #alertBar element from tag manager.html (CSS classes already
   exist there). Many modules call window.showAlert without checking if it
   exists, so this file must load right after tagmanager_globals.js.

   window.escHTML(value)  -> safe text for innerHTML / attribute values.
   window.escAttr(value)  -> alias of escHTML (kept for readability).
========================================================================= */

(function () {
    if (typeof window.escHTML !== 'function') {
        const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
        window.escHTML = function (value) {
            if (value === null || value === undefined) return '';
            return String(value).replace(/[&<>"'`]/g, ch => MAP[ch]);
        };
    }
    if (typeof window.escAttr !== 'function') window.escAttr = window.escHTML;

    // Another page (e.g. Prompt Helper) may already define its own showAlert — keep it.
    if (typeof window.showAlert === 'function') return;

    const TYPES = ['success', 'error', 'warn', 'info'];
    const DEFAULT_MS = { success: 2600, info: 2600, warn: 3500, error: 5000 };
    let hideTimer = null;

    function getBar() {
        let bar = document.getElementById('alertBar');
        if (!bar && document.body) {
            bar = document.createElement('div');
            bar.id = 'alertBar';
            document.body.appendChild(bar);
        }
        return bar;
    }

    window.showAlert = function (message, type = 'info', durationMs) {
        const kind = TYPES.includes(type) ? type : 'info';
        const bar = getBar();
        if (!bar) { console.log(`[${kind}] ${message}`); return; }

        bar.classList.remove(...TYPES);
        bar.textContent = String(message === undefined || message === null ? '' : message);
        // Force a reflow so the same type shown twice in a row restarts cleanly.
        void bar.offsetWidth;
        bar.classList.add(kind);
        bar.style.cursor = 'pointer';
        bar.title = 'Click to dismiss';
        bar.onclick = () => window.hideAlert();

        clearTimeout(hideTimer);
        const ms = typeof durationMs === 'number' ? durationMs : DEFAULT_MS[kind];
        if (ms > 0) hideTimer = setTimeout(() => window.hideAlert(), ms);
    };

    window.hideAlert = function () {
        clearTimeout(hideTimer);
        hideTimer = null;
        const bar = document.getElementById('alertBar');
        if (bar) bar.classList.remove(...TYPES);
    };
})();
