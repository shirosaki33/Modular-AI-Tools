/* =========================================================================
   POPOUT SIZE SLIDER — standalone
   ---------------------------------------------------------------------
   Every popout (.modal-overlay > .tool-modal / .auto-panel) gets a small
   "⤢ Window size" slider, like the thumbnail slider of the main canvas.
   It scales THAT popout only (CSS zoom: text, buttons, previews — all of it)
   and the value is saved per popout in the settings ('popout-sizes').

   - The slider sits in a pill fixed at the top of the screen while a popout
     is open (never covers the popout's own buttons, never zoomed itself).
   - Works for popouts opened by any path (openModal, classList.add...):
     a MutationObserver watches the overlays' "active" class.
   - Image viewers (modal-image, modal-archive-zoom) have their own zoom and
     are skipped (they have no .tool-modal / .auto-panel window).
   - Double-click the slider or ↺ = back to 100%.
   - When zoomed, the window's max size is recalculated so it never grows
     past the screen (it scrolls inside instead).

   Load order: anywhere after tagmanager_db.js (uses getSetting/saveSetting).
========================================================================= */

(function () {
    const SETTING_KEY = 'popout-sizes';
    const MIN = 60, MAX = 200, STEP = 5;
    const SKIP_IDS = new Set(['modal-image', 'modal-archive-zoom']);

    let sizes = {};          // overlayId -> percent
    let current = null;      // overlay currently controlled by the pill
    let saveTimer = null;
    let pill = null;

    const style = document.createElement('style');
    style.textContent = `
        #popout-size-pill { position:fixed; top:8px; left:50%; transform:translateX(-50%); z-index:10000; display:none; align-items:center; gap:8px;
            background:#151515; border:1px solid #333; border-radius:16px; padding:4px 10px; box-shadow:0 4px 14px rgba(0,0,0,0.7); font-size:11px; color:#888; user-select:none; }
        #popout-size-pill.show { display:flex; }
        #popout-size-pill input[type=range] { width:140px; accent-color:#00ff99; padding:0; margin:0; }
        #popout-size-val { min-width:36px; text-align:right; color:#00ff99; font-weight:bold; }
        #popout-size-reset { background:transparent; border:1px solid #444; color:#aaa; border-radius:4px; padding:0 6px; font-size:11px; cursor:pointer; line-height:18px; }
        #popout-size-reset:hover { color:#fff; border-color:#888; }
    `;
    document.head.appendChild(style);

    function windowOf(overlay) {
        if (!overlay || SKIP_IDS.has(overlay.id)) return null;
        return overlay.querySelector(':scope > .tool-modal, :scope > .auto-panel');
    }

    function keyOf(overlay) {
        return overlay.id || ('popout-' + Array.from(document.querySelectorAll('.modal-overlay')).indexOf(overlay));
    }

    function percentFor(overlay) {
        const v = parseInt(sizes[keyOf(overlay)], 10);
        return Number.isFinite(v) ? Math.min(MAX, Math.max(MIN, v)) : 100;
    }

    function applyZoom(overlay) {
        const win = windowOf(overlay);
        if (!win) return;
        const pct = percentFor(overlay);
        const z = pct / 100;
        if (win.dataset.psOrig === undefined) {
            // Remember the window's own inline sizing so 100% restores it exactly.
            win.dataset.psOrig = JSON.stringify({ maxWidth: win.style.maxWidth, maxHeight: win.style.maxHeight, overflowY: win.style.overflowY, boxSizing: win.style.boxSizing });
        }
        const orig = JSON.parse(win.dataset.psOrig);
        if (pct === 100) {
            win.style.zoom = '';
            win.style.maxWidth = orig.maxWidth;
            win.style.maxHeight = orig.maxHeight;
            win.style.overflowY = orig.overflowY;
            win.style.boxSizing = orig.boxSizing || '';
            return;
        }
        win.style.zoom = String(z);
        // px values are multiplied by zoom, so divide to keep the window inside the screen.
        // border-box: padding counts inside the limit; 100px keeps the top pill free.
        win.style.boxSizing = 'border-box';
        win.style.maxWidth = Math.floor(window.innerWidth * 0.96 / z) + 'px';
        win.style.maxHeight = Math.floor((window.innerHeight - 100) / z) + 'px';
        win.style.overflowY = 'auto';
    }

    function buildPill() {
        if (pill) return pill;
        pill = document.createElement('div');
        pill.id = 'popout-size-pill';
        pill.title = 'Size of this popout (saved per window). Double-click the slider to reset.';
        pill.innerHTML = `
            <span>⤢ Window size</span>
            <input type="range" id="popout-size-range" min="${MIN}" max="${MAX}" step="${STEP}" value="100">
            <span id="popout-size-val">100%</span>
            <button id="popout-size-reset" title="Back to 100%">↺</button>`;
        // Clicks on the pill must not reach the overlay (that would close the popout).
        ['click', 'mousedown', 'pointerdown'].forEach(ev => pill.addEventListener(ev, e => e.stopPropagation()));
        document.body.appendChild(pill);

        const range = pill.querySelector('#popout-size-range');
        range.addEventListener('input', () => setPercent(parseInt(range.value, 10)));
        range.addEventListener('dblclick', () => setPercent(100));
        pill.querySelector('#popout-size-reset').addEventListener('click', () => setPercent(100));
        return pill;
    }

    function setPercent(pct) {
        if (!current) return;
        pct = Math.min(MAX, Math.max(MIN, Math.round(pct / STEP) * STEP));
        const key = keyOf(current);
        if (pct === 100) delete sizes[key]; else sizes[key] = pct;
        applyZoom(current);
        syncPill();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            if (typeof window.saveSetting === 'function') window.saveSetting(SETTING_KEY, sizes);
        }, 400);
    }

    function syncPill() {
        buildPill();
        if (!current) { pill.classList.remove('show'); return; }
        const pct = percentFor(current);
        const range = pill.querySelector('#popout-size-range');
        if (document.activeElement !== range) range.value = pct;
        pill.querySelector('#popout-size-val').textContent = pct + '%';
        pill.classList.add('show');
    }

    function activeOverlays() {
        return Array.from(document.querySelectorAll('.modal-overlay.active')).filter(o => windowOf(o));
    }

    function onOverlayChange(overlay) {
        if (overlay.classList.contains('active') && windowOf(overlay)) {
            current = overlay;            // the most recently opened popout gets the slider
            applyZoom(overlay);
        } else if (current === overlay) {
            const rest = activeOverlays();
            current = rest.length ? rest[rest.length - 1] : null;
        }
        syncPill();
    }

    function startObserver() {
        const mo = new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type === 'attributes') {
                    const el = m.target;
                    if (el.classList && el.classList.contains('modal-overlay')) {
                        const was = (m.oldValue || '').split(/\s+/).includes('active');
                        if (was !== el.classList.contains('active')) onOverlayChange(el);
                    }
                } else if (m.type === 'childList') {
                    m.addedNodes.forEach(n => {
                        if (n.nodeType === 1 && n.classList.contains('modal-overlay') && n.classList.contains('active')) onOverlayChange(n);
                    });
                }
            }
        });
        mo.observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true, childList: true });
    }

    window.addEventListener('resize', () => { activeOverlays().forEach(applyZoom); });

    window.addEventListener('DOMContentLoaded', async () => {
        buildPill();
        startObserver();
        try {
            if (typeof window.getSetting === 'function') {
                const saved = await window.getSetting(SETTING_KEY, {});
                if (saved && typeof saved === 'object') sizes = saved;
            }
        } catch (e) { /* defaults */ }
        // A popout may already be open (e.g. restored on load).
        activeOverlays().forEach(o => onOverlayChange(o));
    });
})();
