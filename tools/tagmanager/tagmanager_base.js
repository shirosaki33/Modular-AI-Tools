/* ===== merged from tagmanager_base.js ===== */
/* =========================================================================
   GLOBAL STATE & VARIABLES
   Centralizes state to be shared across multiple modules.
========================================================================= */

var showGhostTagsInList = false;

var _hiddenImagesStoreMap = new WeakMap();
var _defaultHiddenSet = new Set();
function getHiddenSetForHandle(handle) {
    if (!handle) return _defaultHiddenSet;
    if (!_hiddenImagesStoreMap.has(handle)) _hiddenImagesStoreMap.set(handle, new Set());
    return _hiddenImagesStoreMap.get(handle);
}
Object.defineProperty(window, 'hiddenImagesStore', {
    get() { return getHiddenSetForHandle(window.currentImagesHandle); },
    configurable: true
});

var sortedActiveTags = [];
var rootHandle = null;
var rootHandleKey = null; // key under which rootHandle is saved in the "Saved directories" list (null = not saved)
var sub1Handles = new Map();
var sub2Handles = new Map();
var sub3Handles = new Map();
var currentImagesHandle = null;

var imageFiles = [];
var selectedIndices = new Set();

var masterTagSet = new Set();
var masterSelectedTags = new Set();
var masterSelectedGhostTags = new Set();
var activeSelectedTags = new Set();

var datasetConfig = {};
var pendingTagsStore = {};
var filterMode = 'NONE';

var imageNameFilter = '';
var tagNameFilter = '';
var presetTagNameFilter = '';

var activeSearchMode = true;
var masterSearchMode = true;
var presetSearchMode = true;

var presetSelectedTags = new Set();
var lastSelectedPresetIndex = 0;
var lastSelectedIndex = 0;
var replaceScope = 'active';
var _thumbSizeRAF = null;

// Selection / drag state used by the editor and the master list.
// They were implicit globals before (created on first assignment), which
// breaks in strict mode and made "typeof x" checks unreliable.
var draggedTagIndex = null;
var lastSelectedActiveTagIndex = null;
var lastSelectedMasterTagIndex = null;
var lastSelectedGhostTagIndex = null;

var showDanbooruCounts = true;
var danbooruCache = {};

// e621 suggestions toggle was removed from Settings; counts from e621 are
// still merged automatically (see pickBestTagCount in tagmanager_e621_core.js).
var showE621 = false;
var showE621Sfw = false;

// Same rule used by every module: served by server_max.py on this machine.
var MAT_IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
window.MAT_IS_LOCAL = MAT_IS_LOCAL;

window.formatDbCount = function(num) {
    if(num >= 1000) return (num / 1000).toFixed(1).replace('.0', '') + 'k';
    return num;
};

// HTML escaping helper (also defined in tagmanager_alert.js; whichever loads first wins).
if (typeof window.escHTML !== 'function') {
    window.escHTML = function (value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"'`]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[ch]));
    };
}

/* ===== merged from tagmanager_base.js ===== */
/* =========================================================================
   TM — EVENT BUS + TAG MODEL
   ---------------------------------------------------------------------
   Carrega logo depois de tagmanager_globals.js, antes de qualquer plugin.

   1) BARRAMENTO DE EVENTOS
      TM.on(evento, fn, prioridade?) / TM.off(evento, fn) / TM.emit(evento, ...args)
      Os eventos de render/dataset são disparados por tagmanager_render_hooks.js
      (lista completa lá). Plugins só ESCUTAM — não substituem funções núcleo.

   2) TAG MODEL — um só lugar para ler/escrever as tags de uma imagem.
      TM.tags.split(content)              -> ['a', 'b']
      TM.tags.get(img)                    -> tags da imagem
      TM.tags.set(img, arr)               -> grava (sem marcar dirty)
      TM.tags.add(imgs, tags, pos)        -> imagens alteradas (marca dirty)
      TM.tags.remove(imgs, tags)          -> imagens alteradas (marca dirty)
      TM.tags.replace(imgs, old, new)     -> imagens alteradas (marca dirty;
                                             comparação sem diferenciar maiúsculas)
      TM.tags.refreshViews()              -> refresh único (datalist, listas,
                                             editor, filtros)
      Todas disparam 'tags:changed' (imgs).
========================================================================= */

(function () {
    const TM = window.TM = window.TM || {};

    /* ---------- BUS ---------- */
    const listeners = TM._listeners = TM._listeners || {};
    // priority: menor roda primeiro (padrão 0). Mesma prioridade = ordem de registro.
    TM.on = TM.on || function (evt, fn, priority = 0) {
        if (typeof fn !== 'function') return;
        fn.__tmPriority = priority;
        const arr = listeners[evt] = listeners[evt] || [];
        let i = arr.length;
        while (i > 0 && (arr[i - 1].__tmPriority || 0) > priority) i--;
        arr.splice(i, 0, fn);
    };
    TM.off = TM.off || function (evt, fn) {
        const arr = listeners[evt];
        if (arr) listeners[evt] = arr.filter(f => f !== fn);
    };
    TM.emit = TM.emit || function (evt, ...args) {
        (listeners[evt] || []).slice().forEach(fn => {
            try { fn(...args); } catch (e) { console.warn(`[TM] "${evt}" listener failed:`, e); }
        });
    };
    TM.onDatasetLoaded = fn => TM.on('dataset:loaded', fn);

    // Compat com a API antiga (render hooks).
    window.registerPostRenderImageList = fn => TM.on('render:list', fn);
    window.registerPostRenderEditor = fn => TM.on('render:editor', fn);
    window.registerPostRenderMasterTagList = fn => TM.on('render:master', fn);
    window.registerPostApplyFilters = fn => TM.on('filters:applied', fn);

    /* ---------- TAG MODEL ---------- */
    const split = content => content ? String(content).split(',').map(t => t.trim()).filter(t => t) : [];
    const toArr = v => v == null ? [] : (Array.isArray(v) ? v : (v instanceof Set ? Array.from(v) : [v]));
    const defaultExt = () => {
        const sel = document.getElementById('topbar-save-format');
        return sel ? sel.value : 'txt';
    };
    const markDirty = imgs => { if (imgs.length && typeof window.markDirty === 'function') window.markDirty(imgs); };

    function set(img, tags) {
        img.content = toArr(tags).join(', ');
    }

    function add(imgs, tags, position = 'bottom') {
        const list = toArr(tags).map(t => String(t).trim()).filter(t => t);
        if (!list.length) return [];
        const changed = [];
        toArr(imgs).forEach(img => {
            if (!img) return;
            const cur = split(img.content);
            const missing = list.filter(t => !cur.includes(t));
            img.type = 'tags';
            if (!img.ext) img.ext = defaultExt();
            const wasEmpty = !img.hasFile;
            img.hasFile = true;
            if (!missing.length && !wasEmpty) return;
            img.content = (position === 'top' ? [...missing, ...cur] : [...cur, ...missing]).join(', ');
            changed.push(img);
        });
        if (typeof masterTagSet !== 'undefined') list.forEach(t => masterTagSet.add(t));
        markDirty(changed);
        if (changed.length) TM.emit('tags:changed', changed);
        return changed;
    }

    function remove(imgs, tags) {
        const drop = new Set(toArr(tags));
        if (!drop.size) return [];
        const changed = [];
        toArr(imgs).forEach(img => {
            if (!img || !img.content) return;
            const cur = split(img.content);
            const next = cur.filter(t => !drop.has(t));
            if (next.length === cur.length) return;
            img.content = next.join(', ');
            changed.push(img);
        });
        markDirty(changed);
        if (changed.length) TM.emit('tags:changed', changed);
        return changed;
    }

    function replace(imgs, oldTag, newTag) {
        const oldLower = String(oldTag || '').trim().toLowerCase();
        const nt = String(newTag || '').trim();
        if (!oldLower || !nt) return [];
        const changed = [];
        toArr(imgs).forEach(img => {
            if (!img || !img.content) return;
            const cur = split(img.content);
            if (!cur.some(t => t.toLowerCase() === oldLower)) return;
            img.content = [...new Set(cur.map(t => t.toLowerCase() === oldLower ? nt : t))].join(', ');
            img.hasFile = true;
            changed.push(img);
        });
        if (changed.length && typeof masterTagSet !== 'undefined') {
            Array.from(masterTagSet).forEach(t => { if (t.toLowerCase() === oldLower) masterTagSet.delete(t); });
            masterTagSet.add(nt);
        }
        markDirty(changed);
        if (changed.length) TM.emit('tags:changed', changed);
        return changed;
    }

    /* Refresh de todas as vistas numa chamada só. Padrão: na hora (o chamador
       pode precisar do DOM atualizado logo em seguida). opts.defer = true junta
       várias chamadas do mesmo tick num refresh só. */
    let refreshQueued = false;
    function doRefresh() {
        refreshQueued = false;
        if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
        if (typeof window.renderImageList === 'function') window.renderImageList();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.renderEditor === 'function') window.renderEditor();
        // renderImageList já chama applyFilters no fim.
    }
    function refreshViews(opts) {
        if (!(opts && opts.defer)) { doRefresh(); return; }
        if (refreshQueued) return;
        refreshQueued = true;
        Promise.resolve().then(doRefresh);
    }

    TM.tags = {
        split,
        get: img => split(img && img.content),
        set, add, remove, replace,
        refreshViews,
        selectedImages: () => (typeof selectedIndices !== 'undefined' && typeof imageFiles !== 'undefined')
            ? Array.from(selectedIndices).map(i => imageFiles[i]).filter(Boolean) : [],
        visibleImages: () => (typeof imageFiles !== 'undefined') ? imageFiles.filter(img => !img.hidden) : []
    };

    /* ---------- RESOLUÇÃO PELO CABEÇALHO DO ARQUIVO ----------
       Lê só o começo do arquivo (PNG IHDR / JPEG SOFn / WEBP VP8 VP8L VP8X) em
       vez de decodificar a imagem inteira. Cache em img._resolution.
       Cai para new Image() só se o formato não for reconhecido. */
    function parseSize(buf) {
        const v = new DataView(buf);
        const u8 = new Uint8Array(buf);
        const len = u8.length;
        // PNG
        if (len > 24 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) {
            return { w: v.getUint32(16), h: v.getUint32(20) };
        }
        // JPEG
        if (len > 4 && u8[0] === 0xFF && u8[1] === 0xD8) {
            let i = 2;
            while (i + 9 < len) {
                if (u8[i] !== 0xFF) { i++; continue; }
                const m = u8[i + 1];
                if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xFF) { i += (m === 0xFF ? 1 : 2); continue; }
                const segLen = v.getUint16(i + 2);
                if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
                    return { w: v.getUint16(i + 7), h: v.getUint16(i + 5) };
                }
                i += 2 + segLen;
            }
            return null;
        }
        // WEBP
        if (len > 30 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) {
            const chunk = String.fromCharCode(u8[12], u8[13], u8[14], u8[15]);
            if (chunk === 'VP8 ') return { w: v.getUint16(26, true) & 0x3FFF, h: v.getUint16(28, true) & 0x3FFF };
            if (chunk === 'VP8L') {
                const b = v.getUint32(21, true);
                return { w: (b & 0x3FFF) + 1, h: ((b >> 14) & 0x3FFF) + 1 };
            }
            if (chunk === 'VP8X') {
                return { w: 1 + (u8[24] | (u8[25] << 8) | (u8[26] << 16)), h: 1 + (u8[27] | (u8[28] << 8) | (u8[29] << 16)) };
            }
        }
        return null;
    }
    TM.parseImageSize = parseSize;

    function sizeViaImage(url) {
        return new Promise(resolve => {
            const probe = new Image();
            probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
            probe.onerror = () => resolve(null);
            probe.src = url;
        });
    }

    TM.getImageSize = async function (img) {
        if (!img) return null;
        if (img._resolution) return img._resolution;
        let size = null;
        try {
            const file = img.handle && typeof img.handle.getFile === 'function' ? await img.handle.getFile() : null;
            if (file) size = parseSize(await file.slice(0, 512 * 1024).arrayBuffer());
        } catch (e) {}
        if (!size && img.url) size = await sizeViaImage(img.url);
        if (size && size.w > 0 && size.h > 0) img._resolution = size;
        return img._resolution || null;
    };
    // Muda o arquivo (crop do bucket, rename...): esquece a resolução guardada.
    TM.forgetImageSize = img => { if (img) delete img._resolution; };

    /* ---------- _tagger_config.json com debounce ----------
       Estrela, conversão NL, reordenação... antes gravavam o arquivo a cada
       clique. Agora: 1 gravação ~1 s depois da última mudança. A referência
       da pasta E do objeto de config são capturadas no agendamento, então
       trocar de pasta nunca grava a config de um dataset na pasta de outro;
       e loadGallery/loadSubDir* chamam TM.flushDatasetConfig() antes de trocar. */
    let cfgTimer = null, cfgPending = null, cfgWaiters = [];
    /* (2026-11) _tagger_config.json is only CREATED once the dataset has at least one tag:
       a folder with only images (no captions / no tags) gets no config file. An existing
       file is always updated. */
    TM.datasetHasTags = function (files) {
        const list = files || (typeof imageFiles !== 'undefined' ? imageFiles : []);
        return list.some(img => img && img.content && String(img.content).replace(/[\s,]/g, '') !== '');
    };
    TM.configWriteAllowed = async function (handle, files) {
        if (!handle) return false;
        try { await handle.getFileHandle('_tagger_config.json'); return true; } catch (e) {}
        return TM.datasetHasTags(files);
    };
    async function writeConfig(job) {
        try {
            if (!(await TM.configWriteAllowed(job.handle))) return;
            const h = await job.handle.getFileHandle('_tagger_config.json', { create: true });
            const w = await h.createWritable();
            await w.write(JSON.stringify(job.config, null, 2));
            await w.close();
        } catch (e) { console.warn('[TM] Could not save _tagger_config.json', e); }
    }
    TM.flushDatasetConfig = async function () {
        clearTimeout(cfgTimer); cfgTimer = null;
        const job = cfgPending, waiters = cfgWaiters;
        cfgPending = null; cfgWaiters = [];
        if (job) await writeConfig(job);
        waiters.forEach(r => r());
    };
    TM.scheduleDatasetConfigSave = function (handle, config) {
        if (!handle || !config) return Promise.resolve();
        if (cfgPending && (cfgPending.handle !== handle || cfgPending.config !== config)) TM.flushDatasetConfig();
        cfgPending = { handle, config };
        clearTimeout(cfgTimer);
        cfgTimer = setTimeout(TM.flushDatasetConfig, 1000);
        return new Promise(r => cfgWaiters.push(r));
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') TM.flushDatasetConfig(); });
})();

/* ===== merged from tagmanager_base.js ===== */
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

/* ===== merged from tagmanager_base.js ===== */
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
