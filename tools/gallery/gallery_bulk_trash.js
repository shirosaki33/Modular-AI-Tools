/* ================================================================
   GALLERY BULK TRASH (localhost only)
   Shared engine used by Gallery Holder and Gallery Timeline: a selection mode
   to tick many images and move them to the Recycle Bin at once (the JSON
   sidecars go too). It uses the same server_max.py endpoint as the single
   "Recycle Bin" button (/api/trash_file), so nothing is ever deleted
   permanently and it only works when the page is opened through the local server.

   Each page calls GhBulk.init({...}) (see gallery_bulk_trash_holder.js and
   gallery_bulk_trash_timeline.js). The grid cards are not touched: clicks are
   intercepted on the grid, and the "selected" look is a CSS class that is
   re-applied whenever the grid re-renders (dynamic page loader).
   ================================================================ */
window.GhBulk = (function () {
    let cfg = null, active = false, busy = false;
    const sel = new Set();
    let ctx = null, lastIdx = -1, repaintRAF = 0, watchTimer = 0, gridObserver = null;
    const $ = id => document.getElementById(id);

    const CSS = `
    #btn-bulk-trash { background: none; font-size: 14px; padding: 6px 12px; color: #888; border: 1px solid #333; border-radius: 6px; cursor: pointer; }
    #btn-bulk-trash:hover { color: #ff8a96; border-color: #ff8a96; }
    #btn-bulk-trash.active { background: #4a1118; color: #ffb6c0; border-color: #7a222c; }
    .bulk-on .grid-item-wrapper { cursor: pointer; }
    .bulk-on .grid-item-wrapper::after { content: ''; position: absolute; top: 8px; right: 8px; width: 20px; height: 20px; border-radius: 50%;
        background: rgba(0,0,0,.55); border: 2px solid #ccc; z-index: 5; pointer-events: none; box-sizing: border-box; }
    .bulk-on .grid-item-wrapper.bulk-sel { border-color: #ff5a6a; }
    .bulk-on .grid-item-wrapper.bulk-sel:hover { border-color: #ff8a96; }
    .bulk-on .grid-item-wrapper.bulk-sel .grid-item { opacity: .6; }
    .bulk-on .grid-item-wrapper.bulk-sel::after { content: '\\2713'; background: #ff5a6a; border-color: #ff5a6a; color: #fff;
        font: 700 13px/16px sans-serif; text-align: center; }
    #bulk-bar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: none; align-items: center; gap: 8px;
        background: #1b1b1b; border: 1px solid #7a222c; border-radius: 10px; padding: 8px 12px; z-index: 9998;
        box-shadow: 0 6px 24px rgba(0,0,0,.6); font-size: 13px; color: #ddd; max-width: 96vw; flex-wrap: wrap; justify-content: center; }
    #bulk-bar.show { display: flex; }
    #bulk-bar button { border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; border: 1px solid #444; background: #2a2a2a; color: #ccc; font-family: inherit; }
    #bulk-bar button:hover:not(:disabled) { border-color: #888; color: #fff; }
    #bulk-bar button:disabled { opacity: .45; cursor: not-allowed; }
    #bulk-bar #bulk-go { background: #4a1118; color: #ffb6c0; border-color: #7a222c; font-weight: 600; }
    #bulk-bar #bulk-go:hover:not(:disabled) { background: #6a1822; color: #fff; }
    #bulk-count { min-width: 110px; text-align: center; }`;

    function grid() { return $(cfg.gridId || 'grid-view'); }
    function items() { try { return cfg.list() || []; } catch (e) { return []; } }
    function gridVisible() { const g = grid(); return !!g && g.offsetParent !== null; }

    /* ---- selection look ---- */
    function repaint() {
        repaintRAF = 0;
        if (!active) return;
        if (cfg.context() !== ctx) { exit('Folder changed: selection cleared.'); return; }
        if (cfg.blocked && cfg.blocked()) { exit(); return; }
        const list = items();
        grid().querySelectorAll('.grid-item-wrapper[data-i]').forEach(w => {
            const it = list[Number(w.dataset.i)];
            w.classList.toggle('bulk-sel', !!it && sel.has(cfg.keyOf(it)));
        });
        updateBar();
    }
    function schedule() { if (active && !repaintRAF) repaintRAF = requestAnimationFrame(repaint); }

    function updateBar() {
        const n = sel.size, total = items().length;
        $('bulk-count').textContent = n ? `${n} selected` : 'Click images to select';
        $('bulk-all').textContent = `Select all (${total})`;
        $('bulk-all').disabled = busy || !total;
        $('bulk-clear').disabled = busy || !n;
        $('bulk-go').disabled = busy || !n;
        $('bulk-cancel').disabled = busy;
    }

    /* ---- click handling (capture phase, so the normal "open image" click never fires) ---- */
    function onGridClick(e) {
        if (!active) return;
        const w = e.target.closest && e.target.closest('.grid-item-wrapper');
        if (!w || !grid().contains(w)) return;
        e.preventDefault(); e.stopPropagation();
        if (busy) return;
        if (cfg.context() !== ctx) { exit('Folder changed: selection cleared.'); return; }
        const list = items(), i = Number(w.dataset.i), it = list[i];
        if (!it) return;
        if (e.shiftKey && lastIdx >= 0 && list[lastIdx]) {       // Shift+click: select the whole range from the last click
            const [a, b] = lastIdx < i ? [lastIdx, i] : [i, lastIdx];
            for (let k = a; k <= b; k++) if (list[k]) sel.add(cfg.keyOf(list[k]));
        } else {
            const k = cfg.keyOf(it);
            if (sel.has(k)) sel.delete(k); else sel.add(k);
        }
        lastIdx = i;
        repaint();
    }

    /* ---- mode on / off ---- */
    async function enter() {
        if (active) return;
        if (!(await cfg.ready())) return;
        if (!gridVisible()) { cfg.toast('Go back to the grid to select images.', 'warn'); return; }
        if (cfg.leaveOtherModes) cfg.leaveOtherModes();
        sel.clear(); lastIdx = -1; ctx = cfg.context(); active = true;
        document.body.classList.add('bulk-on');
        $('btn-bulk-trash').classList.add('active');
        $('bulk-bar').classList.add('show');
        cfg.toast('Click images to select (Shift+click selects a range). Esc cancels.', 'info', 4500);
        watchTimer = setInterval(() => {                   // leaves the mode if the grid is hidden (detail view, folder closed...)
            if (!active) return;
            if (!gridVisible() || cfg.context() !== ctx || (cfg.blocked && cfg.blocked())) exit();
        }, 400);
        repaint();
    }

    function exit(msg) {
        if (!active) return;
        active = false; busy = false;
        clearInterval(watchTimer); watchTimer = 0;
        sel.clear(); lastIdx = -1;
        document.body.classList.remove('bulk-on');
        $('btn-bulk-trash').classList.remove('active');
        $('bulk-bar').classList.remove('show');
        document.querySelectorAll('.bulk-sel').forEach(w => w.classList.remove('bulk-sel'));
        if (msg) cfg.toast(msg, 'info', 3500);
    }

    function toggle() { if (active) { if (!busy) exit(); } else enter(); }

    function selectAll() {
        if (busy) return;
        items().forEach(it => sel.add(cfg.keyOf(it)));
        repaint();
    }
    function clearSel() { if (busy) return; sel.clear(); lastIdx = -1; repaint(); }

    /* ---- the actual move to the Recycle Bin ---- */
    async function run() {
        if (!active || busy) return;
        if (cfg.context() !== ctx) { exit('Folder changed: selection cleared.'); return; }
        if (!(await cfg.ready())) return;
        const chosen = items().filter(it => sel.has(cfg.keyOf(it)));
        if (!chosen.length) { cfg.toast('Select at least one image.', 'warn'); return; }
        const n = chosen.length;
        if (!confirm(`Move ${n} image${n === 1 ? '' : 's'} to the Recycle Bin?\n\n${cfg.describe()}\n\nTheir JSON files go too, if they exist. You can restore everything from the Recycle Bin.`)) return;

        busy = true; updateBar();
        const done = [], failed = [];
        let next = 0, finished = 0, abort = false;
        const label = $('bulk-count');
        const worker = async () => {
            while (!abort && next < chosen.length) {
                const it = chosen[next++];
                try { await cfg.trash(it); done.push(it); }
                catch (e) {
                    failed.push({ it, msg: (e && e.message) || String(e) });
                    if (!done.length && failed.length >= 3) abort = true;      // nothing works (wrong path / old server): stop early
                }
                finished++;
                label.textContent = `Moving ${finished}/${n}...`;
            }
        };
        label.textContent = `Moving 0/${n}...`;
        await Promise.all([worker(), worker(), worker()]);

        if (done.length) {
            done.forEach(it => sel.delete(cfg.keyOf(it)));
            try { cfg.removed(done); } catch (e) { console.error(e); }
        }
        busy = false;
        if (failed.length) {
            console.error('Bulk trash failures:', failed);
            cfg.toast(`${done.length} moved, ${failed.length} failed: ${failed[0].msg}`, 'warn', 9000);
            if (typeof showAlert === 'function') showAlert(`⚠️ ${done.length} moved to the Recycle Bin, ${failed.length} failed. ${failed[0].msg}`, 'error');
            repaint();
        } else {
            exit();
            const msg = `♻️ ${done.length} image${done.length === 1 ? '' : 's'} moved to the Recycle Bin.`;
            if (typeof showAlert === 'function') showAlert(msg, 'success');
            cfg.toast(msg, 'success', 3500);
        }
    }

    /* ---- setup ---- */
    function init(c) {
        cfg = c;
        const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

        const btn = document.createElement('button');
        btn.id = 'btn-bulk-trash';
        btn.textContent = '♻️ Select';
        btn.title = 'Select several images and move them to the Recycle Bin at once (localhost server only)';
        btn.onclick = toggle;
        const anchor = $(cfg.anchorId);
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor); else document.body.appendChild(btn);
        if (!cfg.isLocal()) btn.style.display = 'none';           // the online version has no server: no button at all

        const bar = document.createElement('div');
        bar.id = 'bulk-bar';
        bar.innerHTML = '<span id="bulk-count"></span>' +
            '<button id="bulk-all" type="button"></button>' +
            '<button id="bulk-clear" type="button">Clear</button>' +
            '<button id="bulk-go" type="button">♻️ Move to Recycle Bin</button>' +
            '<button id="bulk-cancel" type="button">Cancel</button>';
        document.body.appendChild(bar);
        $('bulk-all').onclick = selectAll;
        $('bulk-clear').onclick = clearSel;
        $('bulk-go').onclick = run;
        $('bulk-cancel').onclick = () => { if (!busy) exit(); };

        grid().addEventListener('click', onGridClick, true);
        gridObserver = new MutationObserver(schedule);
        gridObserver.observe(grid(), { childList: true, subtree: true });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && active && !busy) exit(); });
    }

    return { init, exit, isActive: () => active };
})();
