/* =========================================================================
   PARALLEL TASKS (⏳) — long jobs keep running when you change dataset
   ---------------------------------------------------------------------
   Every long job (PSD Import / Unpack, Auto-Caption, Auto Bucket, B&W, Archive,
   Rename, Clone, Evaluator) is started through TM.tasks.run(...). The job keeps
   its OWN dataset (folder handle + the list of images it started with + that
   dataset's config / pending stores) and only writes there, so you can open
   another dataset — or start another job in it — while it runs.

   - ⏳ button in the top bar: how many jobs are running; click = list with the
     dataset of each job, progress x / N, ⏹ stop. Finished jobs stay in the list
     for a while (✓ / ⚠️) and a notification is shown.
   - GPU queue: jobs that use the GPU (Auto-Caption, Evaluator, PSD person
     detection, seg body of the Auto Bucket) wait for each other — one at a time.
     The others run together.
   - The images a job uses are "held": changing dataset does not revoke their
     object URLs until the job ends.
   - When a job ends, the screen is refreshed only if its dataset is the one open
     now; otherwise it is refreshed when you go back to that dataset.
   Limits: everything still lives in this tab — closing / reloading it stops the jobs.

   API
     const t = TM.tasks.run({ title, icon, gpu, handle, files, onCancel }, async (task) => { ... })
       task.progress(done, total, text)   task.cancelled (bool)   task.setText(text)
       task.ctx = { handle, files, config, pending, pendingRemove, label }   (captured at start)
       task.waitGpu() -> resolves when the GPU is free for this task (auto-released at the end)
       returns a Promise with the job result
     TM.tasks.isCurrent(handle) -> Promise<bool>   (is this the dataset open now?)
     TM.tasks.holds(img) -> bool                    TM.tasks.list()
     TM.tasks.captureDataset() -> ctx of the dataset open now
   Must load after tagmanager_tm.js and before the modules that use it.
========================================================================= */
(function () {
    'use strict';
    const TM = window.TM = window.TM || {};
    if (TM.tasks) return;

    const tasks = [];            // { id, title, icon, label, done, total, text, state, gpu, cancelled, startedAt, endedAt }
    let seq = 0;
    const held = new Map();      // img -> count
    let gpuBusy = null;          // task holding the GPU
    const gpuWaiters = [];

    const st = document.createElement('style');
    st.textContent = `
        #btn-tasks { display:none; white-space:nowrap; background:none; font-size:12px; padding:2px 8px; color:#ffd27a; border:1px solid #6a5a2a; border-radius:6px; margin-left:10px; cursor:pointer; font-weight:bold; position:relative; vertical-align:middle; letter-spacing:0; }
        #btn-tasks:hover { border-color:#ffcc44; color:#fff; }
        #btn-tasks.idle { color:#888; border-color:#333; }
        #tasks-pop { display:none; position:fixed; top:58px; right:20px; width:380px; max-width:92vw; max-height:70vh; overflow-y:auto; background:#111827; border:1px solid #263b5a; border-radius:8px; padding:10px; z-index:1500; box-shadow:0 6px 18px rgba(0,0,0,.6); flex-direction:column; gap:8px; }
        #tasks-pop.open { display:flex; }
        #tasks-pop .tk-head { display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:bold; color:#9ecfff; }
        #tasks-pop .tk-head button { background:transparent; border:1px solid #444; color:#aaa; border-radius:4px; font-size:10px; padding:2px 6px; cursor:pointer; }
        #tasks-pop .tk-empty { font-size:11px; color:#666; text-align:center; padding:10px; }
        .tk-row { background:#0f1622; border:1px solid #1e2c40; border-radius:6px; padding:7px 9px; display:flex; flex-direction:column; gap:4px; }
        .tk-row.done { border-color:#1f5a3a; } .tk-row.failed, .tk-row.stopped { border-color:#6a5a2a; }
        .tk-top { display:flex; align-items:center; gap:6px; font-size:12px; color:#ddd; }
        .tk-title { flex:1; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .tk-ds { font-size:10px; color:#7a8ca8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .tk-stop { background:#2a0000; border:1px solid #aa0000; color:#ff8080; border-radius:4px; font-size:10px; padding:1px 6px; cursor:pointer; }
        .tk-bar { height:5px; background:#1a2230; border-radius:3px; overflow:hidden; }
        .tk-bar > div { height:100%; width:0; background:#00ff99; transition:width .2s; }
        .tk-row.waiting .tk-bar > div { background:#556; }
        .tk-text { font-size:10px; color:#999; }
    `;
    document.head.appendChild(st);

    /* ---------- dataset context ---------- */
    function datasetLabel(handle) {
        if (!handle) return '—';
        const root = window.rootHandle;
        return root && root !== handle ? `${root.name} / ${handle.name}` : handle.name;
    }
    function captureDataset(handle) {
        const h = handle || window.currentImagesHandle || window.rootHandle || null;
        return {
            handle: h,
            root: window.rootHandle || h,
            label: datasetLabel(h),
            files: (typeof imageFiles !== 'undefined') ? imageFiles : [],
            config: (typeof datasetConfig !== 'undefined') ? datasetConfig : {},
            pending: (typeof pendingTagsStore !== 'undefined') ? pendingTagsStore : {},
            pendingRemove: window.pendingRemoveStore || {},
            version: TM.datasetVersion || 0
        };
    }
    async function isCurrent(handle) {
        const cur = window.currentImagesHandle || window.rootHandle;
        if (!handle || !cur) return false;
        if (handle === cur) return true;
        try { return await handle.isSameEntry(cur); } catch (e) { return false; }
    }
    // Same dataset still open AND the same load (the list was not rebuilt meanwhile)?
    function sameLoad(ctx) {
        return !!ctx && typeof imageFiles !== 'undefined' && ctx.files === imageFiles;
    }

    /* ---------- holding images (their URLs stay alive) ---------- */
    function hold(files) { (files || []).forEach(img => { if (img) held.set(img, (held.get(img) || 0) + 1); }); }
    function release(files) {
        (files || []).forEach(img => {
            if (!img) return;
            const n = (held.get(img) || 0) - 1;
            if (n > 0) { held.set(img, n); return; }
            held.delete(img);
            // not in the list on screen anymore: free its URL now
            if (typeof imageFiles !== 'undefined' && imageFiles.indexOf(img) === -1 && img.url && img._tmUrlOrphan) {
                try { URL.revokeObjectURL(img.url); } catch (e) {}
            }
        });
    }

    /* ---------- GPU queue ---------- */
    function waitGpu(task) {
        if (gpuBusy === task) return Promise.resolve();
        if (!gpuBusy) { gpuBusy = task; return Promise.resolve(); }
        task.state = 'waiting'; task.text = '⏸ waiting for the GPU (another task is using it)…'; paint();
        return new Promise(res => gpuWaiters.push({ task, res }));
    }
    function freeGpu(task) {
        if (gpuBusy !== task) { const i = gpuWaiters.findIndex(w => w.task === task); if (i >= 0) gpuWaiters.splice(i, 1); return; }
        gpuBusy = null;
        while (gpuWaiters.length) {
            const w = gpuWaiters.shift();
            if (w.task.cancelled) { w.res(); continue; }
            gpuBusy = w.task; w.task.state = 'running'; w.task.text = ''; paint(); w.res(); break;
        }
    }

    /* ---------- run ---------- */
    function run(opts, fn) {
        opts = opts || {};
        const ctx = opts.ctx || captureDataset(opts.handle);
        if (opts.files) ctx.files = opts.files;
        const task = {
            id: ++seq, title: opts.title || 'Task', icon: opts.icon || '⏳', label: opts.label || ctx.label,
            done: 0, total: 0, text: '', state: 'running', gpu: !!opts.gpu, cancelled: false,
            startedAt: Date.now(), endedAt: 0, ctx, onCancel: opts.onCancel || null, result: ''
        };
        task.progress = (d, t, text) => { task.done = d; if (t != null) task.total = t; if (text != null) task.text = text; if (task.state === 'waiting') task.state = 'running'; schedulePaint(); };
        task.setText = (text) => { task.text = text || ''; schedulePaint(); };
        task.waitGpu = () => waitGpu(task);
        task.stop = () => {
            if (task.state !== 'running' && task.state !== 'waiting') return;
            task.cancelled = true; task.text = '⏹ stopping after the current item…';
            try { if (task.onCancel) task.onCancel(); } catch (e) {}
            const i = gpuWaiters.findIndex(w => w.task === task);
            if (i >= 0) { gpuWaiters[i].res(); gpuWaiters.splice(i, 1); }
            paint();
        };
        tasks.push(task);
        hold(ctx.files);
        paint();
        const p = (async () => {
            try {
                if (task.gpu) await waitGpu(task);
                if (task.cancelled) { task.state = 'stopped'; return null; }   // stopped while waiting in the queue
                const r = await fn(task);
                task.state = task.cancelled ? 'stopped' : 'done';
                if (typeof r === 'string') task.result = r;
                return r;
            } catch (e) {
                console.error(`[Task] ${task.title} failed:`, e);
                task.state = 'failed'; task.result = (e && e.message) || String(e);
                throw e;
            } finally {
                task.endedAt = Date.now();
                freeGpu(task);
                release(ctx.files);
                paint();
                const others = tasks.some(t => t !== task && (t.state === 'running' || t.state === 'waiting'));
                if (others && window.showAlert && !opts.silentEnd) {
                    window.showAlert(`${task.icon} ${task.title} (${task.label}) ${task.state === 'done' ? 'finished' : task.state}${task.result ? ': ' + task.result : ''}`, task.state === 'done' ? 'success' : 'warn');
                }
                setTimeout(() => { const i = tasks.indexOf(task); if (i >= 0 && task.state !== 'running' && task.state !== 'waiting') { tasks.splice(i, 1); paint(); } }, 120000);
            }
        })();
        task.promise = p;
        p.catch(() => {});
        return task;
    }

    /* ---------- ⏳ button + list ---------- */
    let paintRAF = null;
    function schedulePaint() { if (!paintRAF) paintRAF = requestAnimationFrame(() => { paintRAF = null; paint(); }); }
    function ensureUI() {
        let btn = document.getElementById('btn-tasks');
        if (!btn) {
            const title = document.getElementById('app-title');
            if (!title) return null;
            btn = document.createElement('button');
            btn.id = 'btn-tasks';
            btn.title = 'Tasks running in the background (they keep going when you change dataset)';
            btn.onclick = (e) => {
                e.stopPropagation();
                const p = pop();
                p.classList.toggle('open');
                // under the button (next to the app title)
                const r = btn.getBoundingClientRect();
                p.style.top = Math.round(r.bottom + 8) + 'px';
                p.style.left = Math.max(8, Math.min(window.innerWidth - 390, Math.round(r.left + r.width / 2 - 190))) + 'px';
                p.style.right = 'auto';
                paint();
            };
            title.appendChild(btn);   // next to the program title
            document.addEventListener('click', (e) => { const p = document.getElementById('tasks-pop'); if (p && p.classList.contains('open') && !p.contains(e.target) && e.target !== btn) p.classList.remove('open'); });
        }
        return btn;
    }
    function pop() {
        let p = document.getElementById('tasks-pop');
        if (!p) {
            p = document.createElement('div');
            p.id = 'tasks-pop';
            document.body.appendChild(p);
        }
        return p;
    }
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function paint() {
        const btn = ensureUI();
        if (!btn) return;
        const active = tasks.filter(t => t.state === 'running' || t.state === 'waiting');
        const popOpen = !!(document.getElementById('tasks-pop') || {}).classList && document.getElementById('tasks-pop').classList.contains('open');
        btn.style.display = (active.length || popOpen) ? 'inline-block' : 'none';   // only while something is running/queued
        btn.classList.toggle('idle', active.length === 0);
        btn.textContent = active.length ? `⏳ ${active.length}` : (tasks.length ? '⏳ ✓' : '⏳');
        const p = document.getElementById('tasks-pop');
        if (!p || !p.classList.contains('open')) return;
        const rows = tasks.slice().reverse().map(t => {
            const pct = t.total ? Math.round(t.done / t.total * 100) : (t.state === 'done' ? 100 : 0);
            const stateIcon = { running: '', waiting: '⏸ ', done: '✓ ', stopped: '⏹ ', failed: '⚠️ ' }[t.state] || '';
            const prog = t.total ? `${t.done} / ${t.total}` : '';
            const live = t.state === 'running' || t.state === 'waiting';
            return `<div class="tk-row ${t.state}" data-id="${t.id}">
                <div class="tk-top"><span>${esc(t.icon)}</span><span class="tk-title">${stateIcon}${esc(t.title)}</span><span style="font-size:11px; color:#aaa;">${esc(prog)}</span>
                    ${live ? '<button class="tk-stop" title="Stop this task after the current item">⏹ Stop</button>' : ''}</div>
                <div class="tk-ds">📂 ${esc(t.label)}</div>
                <div class="tk-bar"><div style="width:${pct}%"></div></div>
                ${(t.text || t.result) ? `<div class="tk-text">${esc(live ? t.text : (t.result || t.text))}</div>` : ''}
            </div>`;
        }).join('');
        p.innerHTML = `<div class="tk-head"><span>⏳ Tasks</span><button id="tk-clear" title="Remove the finished tasks from the list">Clear finished</button></div>` +
            (rows || '<div class="tk-empty">No tasks.</div>');
        p.querySelectorAll('.tk-stop').forEach(b => {
            b.onclick = (e) => { e.stopPropagation(); const t = tasks.find(x => x.id === Number(b.closest('.tk-row').dataset.id)); if (t) t.stop(); };
        });
        const clr = document.getElementById('tk-clear');
        if (clr) clr.onclick = (e) => { e.stopPropagation(); for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].state !== 'running' && tasks[i].state !== 'waiting') tasks.splice(i, 1); paint(); };
    }

    TM.tasks = {
        run, captureDataset, isCurrent, sameLoad,
        holds: img => held.has(img),
        list: () => tasks.slice(),
        running: () => tasks.filter(t => t.state === 'running' || t.state === 'waiting'),
        gpuBusy: () => gpuBusy
    };
    window.addEventListener('DOMContentLoaded', () => { ensureUI(); paint(); });
})();
