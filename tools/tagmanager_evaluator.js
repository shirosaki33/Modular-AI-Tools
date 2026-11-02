/* =========================================================================
   DATASET EVALUATOR (🧐) — vision model second opinion — standalone
   ---------------------------------------------------------------------
   A vision model looks at each image of the dataset, guided by a BRIEF that
   describes what the dataset is for, and gives:
       score 0–10 · verdict (keep / crop / resize / edit / remove) ·
       issues · a short comment / suggestion
   It is ONLY a suggestion — nothing is changed, moved or deleted.

   UI
   - 🧐 button next to the thumbnail slider (bottom of the Dataset list)
     opens the Evaluate panel (all settings here are separate from the
     Auto-Caption / batch settings).
   - Each evaluated image gets a small score badge on its thumbnail.
     Hovering the badge shows what the model said (lightweight tooltip).

   BACKENDS
   - Ollama (native /api/chat, images as base64, format:"json")
   - OpenAI-compatible (/v1/chat/completions with image_url) — LM Studio,
     koboldcpp, llama.cpp server, vLLM, Jan, etc. Optional API key.

   BASE IMAGES / STYLES (per dataset): one or more images marked 📌 as the
   reference, each with a STYLE name (and optional trigger tag). Every
   evaluation sends the bases + the image; the model says how much the image
   matches each style (0–100%), which style it belongs to, what differs, and
   gives a separate 🎨 style suggestion. The summary shows the style balance
   and advice (few images in a style, missing trigger tags...). Without bases:
   traits are compared with the "common design" of the dataset.

   DATASET LIST (📋): datasets added to the list are evaluated one after the
   other in the background ("▶ Run list"). Switching the dataset you are
   looking at changes nothing. "🧐 Evaluate" (current dataset) has priority:
   it runs first and the list continues after it. A toggle chooses whether
   switching datasets stops that current-dataset run or keeps it running.
   Images are read from the files themselves, so nothing depends on the
   dataset that is open. The brief and the bases are saved per dataset.

   SCORE DETAILS: "🧩 Score details" (small sub-panel inside the Evaluate panel)
   chooses which lines the hover tooltip shows. Saved in the config.

   STORAGE
   - Settings: 'evaluator-config' (backend, URL, model, brief, options).
   - Results:  'evaluator-results' — keyed by dataset folder + subfolder +
     file name, so scores survive reloads. If the image resolution changed
     after the evaluation, the badge is dimmed ("image changed").

   Load order: after tagmanager_render_hooks.js (uses TM.on) and
   tagmanager_db.js (getSetting / saveSetting).
========================================================================= */

(function () {
    'use strict';

    const CFG_KEY = 'evaluator-config';
    const RES_KEY = 'evaluator-results';
    const DSR_KEY = 'evaluator-ds-reviews';    // dsKey -> overall dataset review
    const $ = id => document.getElementById(id);
    const esc = v => (typeof window.escHTML === 'function' ? window.escHTML(v) : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

    const DEFAULT_CFG = {
        backend: 'ollama',
        urlOllama: 'http://127.0.0.1:11434',
        urlOpenAI: 'http://127.0.0.1:1234',
        apiKey: '',
        model: '',
        brief: '',
        scope: 'selected',          // selected | visible | pending
        maxSide: 1024,
        sizePreset: 'sdxl',         // sd | sdxl | hd | custom
        temperature: 0.2,
        sendCaption: true,
        sendResolution: true,
        suggestBucket: true,
        consistency: true,
        tipFields: { comment: true, issues: true, suggestion: true, framing: true, crop: true, consistency: true, styleNote: true, tags: true, review: true, meta: true, hint: true },
        baseKey: '',                // legacy (single base) — migrated to datasets[ds].bases
        showBadges: true,
        keepOnSwitch: false,        // current-dataset run: keep going when another dataset is opened
        skipScored: true,           // dataset list: skip images that already have a score
        datasets: {},               // dsKey -> { brief, bases: [{ key, name, style, trigger }] }
        queue: []                   // [{ id, rootKey, rootName, path:[...], label, dsKey, status, done, total, ok, failed, ts }]
    };
    const MAX_BASES = 6;
    const SIZE_PRESETS = { sd: 512, sdxl: 1024, hd: 1536 };
    let cfg = { ...DEFAULT_CFG };
    let results = {};               // key -> { score, verdict, issues[], comment, suggestion, w, h, model, ts }
    let saveResTimer = null;
    let dsReviews = {};             // dsKey -> { score, summary, strengths[], improvements[], reviewAnswer, sig, n, model, ts }
    const reviewing = new Set();    // dsKeys whose review is being written now
    // Runner state (one worker: the current-dataset job first, then the list).
    let manualJob = null;           // { dsKey, label, units[], i, ok, failed, cancel }
    let listRunning = false;        // "▶ Run list" pressed and not stopped
    let listCancel = false;
    let workerBusy = false;
    let activeJob = null;           // job whose image is being evaluated now
    let abortCtrl = null;
    let enabled = false;            // ⚙️ Settings > Local AI > Dataset Evaluator (off by default, saved)
    const tempRoots = new Map();    // queue id -> root handle of a folder not saved in the list (this session only)

    const VERDICTS = {
        keep:   { icon: '✅', label: 'Keep as is' },
        crop:   { icon: '✂️', label: 'Crop' },
        resize: { icon: '📐', label: 'Change size / bucket' },
        edit:   { icon: '🖌️', label: 'Edit / fix' },
        remove: { icon: '🗑️', label: 'Remove from dataset' }
    };

    /* ---------- STYLES ---------- */
    const style = document.createElement('style');
    style.textContent = `
        #btn-evaluator { flex-shrink:0; background:transparent; border:1px solid #444; color:#aaa; border-radius:6px; padding:2px 8px; font-size:14px; cursor:pointer; line-height:20px; }
        #btn-evaluator:hover { color:#fff; border-color:#b890ff; }
        #btn-evaluator.running { border-color:#b890ff; color:#d6c2ff; font-size:11px; }

        .list-item-thumb-wrap { position: relative; }
        .eval-score-badge { position:absolute; left:3px; bottom:3px; z-index:3; min-width:22px; padding:1px 5px; border-radius:9px; font-size:10px; font-weight:bold;
            text-align:center; color:#000; box-shadow:0 1px 4px rgba(0,0,0,0.8); cursor:help; user-select:none; line-height:14px; }
        .eval-score-badge.stale { opacity:0.45; filter:grayscale(0.6); }
        .eval-score-badge.s-bad  { background:#ff5a5a; }
        .eval-score-badge.s-low  { background:#ff9f43; }
        .eval-score-badge.s-mid  { background:#ffd23f; }
        .eval-score-badge.s-good { background:#3ddc84; }

        #eval-tooltip { position:fixed; z-index:10001; display:none; max-width:340px; background:#141414; border:1px solid #4a2a8c; border-radius:8px;
            padding:8px 10px; font-size:12px; color:#ddd; line-height:1.45; box-shadow:0 6px 20px rgba(0,0,0,0.8); pointer-events:none; }
        #eval-tooltip .et-head { display:flex; justify-content:space-between; gap:10px; font-weight:bold; margin-bottom:4px; }
        #eval-tooltip .et-issues { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
        #eval-tooltip .et-issue { font-size:10px; background:#2a1414; border:1px solid #6a2a2a; color:#ffaaaa; border-radius:8px; padding:0 6px; }
        #eval-tooltip .et-sugg { color:#9ecfff; margin-top:4px; }
        #eval-tooltip .et-bucket { color:#7fe0b0; margin-top:4px; }
        #eval-tooltip .et-cons { color:#c9a7ff; margin-top:4px; }
        #eval-tooltip .et-frame { color:#ffcc66; margin-top:4px; }
        #eval-tooltip .et-style { color:#ff9fd8; margin-top:4px; }
        #eval-tooltip .et-review { color:#f0e68c; margin-top:4px; }
        #eval-tooltip.ds { max-width:440px; }
        #eval-tooltip .ds-sec { margin-top:6px; }
        #eval-tooltip .ds-sec b { color:#9ecfff; }
        #eval-tooltip ul { margin:2px 0 0 16px; padding:0; }
        #eval-tooltip li { margin:1px 0; }
        #list-count.ev-ds-scored { color:#000 !important; font-weight:bold; cursor:help; }
        #eval-tooltip .et-trig { color:#ffb36b; margin-top:4px; }
        .et-tadd { font-size:10px; background:#10261a; border:1px solid #1f6b45; color:#7fe0b0; border-radius:8px; padding:0 6px; white-space:nowrap; }
        .et-tok { color:#4db8ff; font-size:9px; }
        .et-tsim { color:#ffd23f; font-size:9px; }
        .et-tunk { color:#ff9f43; font-size:10px; }
        .et-trem { font-size:10px; background:#2a1414; border:1px solid #6a2a2a; color:#ffaaaa; border-radius:8px; padding:0 6px; white-space:nowrap; text-decoration:line-through; }
        .et-trigtag { font-size:10px; background:#2a1630; border:1px solid #6a2a6a; color:#ffb3f0; border-radius:8px; padding:0 6px; font-weight:normal; }
        #eval-tooltip .et-click { color:#777; font-size:10px; margin-top:5px; }
        .eval-score-badge.eval-ask { background:rgba(20,20,20,.75); color:#ddd; min-width:0; padding:1px 4px; opacity:0; transition:opacity .15s; cursor:pointer; outline:1px solid #555; }
        .list-item:hover .eval-score-badge.eval-ask, .eval-score-badge.eval-ask.queued { opacity:1; }
        .eval-score-badge.eval-ask:hover { outline-color:#b890ff; background:#2a1a4a; }
        .eval-score-badge.clickable { cursor:pointer; outline:1px solid rgba(255,255,255,0.35); }
        #eval-tooltip .et-meta { color:#666; font-size:10px; margin-top:5px; }

        #modal-evaluator .tool-modal { position: relative; }
        .ev-help { display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:#aa2222; color:#fff;
            font-size:11px; font-weight:bold; cursor:help; margin-left:6px; position:relative; vertical-align:middle; }
        .ev-help-text { display:none; position:absolute; top:22px; left:-10px; width:300px; background:#141414; border:1px solid #aa2222; border-radius:8px; padding:8px 10px;
            font-size:11px; font-weight:normal; color:#ddd; line-height:1.45; z-index:20; box-shadow:0 6px 20px rgba(0,0,0,0.8); text-align:left; }
        .ev-help:hover .ev-help-text, .ev-help:focus .ev-help-text { display:block; }
        .ev-subpop { display:none; position:absolute; right:20px; top:0; z-index:15; width:270px; background:#141414; border:1px solid #4a2a8c; border-radius:8px;
            padding:8px 10px; box-shadow:0 8px 24px rgba(0,0,0,0.85); flex-direction:column; gap:6px; font-size:12px; color:#ccc; }
        .ev-subpop.open { display:flex; }
        .ev-subpop label { display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }
        .ev-subpop input[type=checkbox] { width:auto; margin:0; accent-color:#b890ff; }
        .ev-subpop-head { display:flex; justify-content:space-between; align-items:center; font-weight:bold; color:#d6c2ff; border-bottom:1px solid #2a2a2a; padding-bottom:5px; margin-bottom:2px; }
        .ev-subpop-x { background:transparent; border:none; color:#ff4444; font-size:16px; cursor:pointer; line-height:1; padding:0; }
        .ev-ds-box { color:#cfe6ff !important; background:#0c1620 !important; border-color:#1d3d5c !important; }
        body.ev-picking #workspace > *:not(:has(#image-list)), body.ev-picking #col-list .panel-header, body.ev-picking header, body.ev-picking nav { opacity:.18; pointer-events:none; transition:opacity .2s; }
        body.ev-picking #image-list > * { opacity:.55; transition:opacity .15s, outline-color .15s; cursor:pointer; }
        body.ev-picking #image-list > *:hover { opacity:1; outline:2px solid #ff9fd8; outline-offset:-2px; }
        body.ev-picking #image-list > .ev-picked { opacity:1; outline:3px solid #ff4fc0; outline-offset:-3px; box-shadow:0 0 12px rgba(255,79,192,.55); }
        .ev-pick-tag { position:absolute; right:3px; top:3px; z-index:4; background:#ff4fc0; color:#000; font-size:10px; font-weight:bold; border-radius:8px; padding:1px 6px; box-shadow:0 1px 4px rgba(0,0,0,.8); pointer-events:none; }
        #ev-pick-bar { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:10002; width:340px; max-width:90vw; background:#141414; border:1px solid #ff4fc0;
            border-radius:12px; padding:16px 18px; box-shadow:0 10px 40px rgba(0,0,0,.9); display:flex; flex-direction:column; gap:8px; text-align:center; color:#ddd; font-size:12px; }
        .ev-pick-title { font-size:15px; font-weight:bold; color:#ffb3f0; }
        .ev-pick-help { color:#999; line-height:1.4; }
        .ev-pick-count { color:#ff9fd8; font-weight:bold; }
        .ev-pick-btns { display:flex; gap:10px; justify-content:center; margin-top:4px; }
        .ev-pick-btns button { border:none; border-radius:6px; padding:8px 18px; font-weight:bold; cursor:pointer; font-size:13px; }
        #ev-pick-cancel { background:#333; color:#ddd; } #ev-pick-cancel:hover { background:#444; }
        #ev-pick-ok { background:#c02f8e; color:#fff; } #ev-pick-ok:hover { background:#e03aa6; }
        .ev-style-tips { color:#ffcfe9 !important; background:#1e0c17 !important; border-color:#5c1a40 !important; }
        .ev-section { border:1px solid #2a2a2a; border-radius:8px; padding:8px 10px; display:flex; flex-direction:column; gap:6px; background:#101010; }
        .ev-section-head { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:bold; color:#9ecfff; cursor:pointer; user-select:none; }
        .ev-section-head:hover { color:#cfe6ff; }
        .ev-caret { display:inline-block; width:10px; color:#777; }
        .ev-sec-body { display:flex; flex-direction:column; gap:6px; }
        .ev-section.collapsed .ev-sec-body { display:none; }
        .ev-section.collapsed { padding:6px 10px; }
        .ev-base-item, .ev-q-item { display:flex; align-items:center; gap:6px; font-size:11px; color:#ccc; }
        .ev-base-item { align-items:flex-start !important; padding:4px 0; border-bottom:1px solid #1c1c1c; }
        .ev-bcol { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
        .ev-brow { display:flex; align-items:center; gap:6px; }
        .ev-base-item input.ev-b-desc { width:100%; box-sizing:border-box; }
        .ev-b-auto { padding:1px 6px !important; }
        .ev-base-item img { width:44px; height:44px; object-fit:cover; border-radius:4px; border:1px solid #333; flex-shrink:0; }
        .ev-base-item .ev-noimg { width:44px; height:44px; border-radius:4px; border:1px dashed #444; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#555; }
        .ev-base-item .ev-bname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ev-base-item input { width:96px; font-size:11px; padding:2px 5px; }
        .ev-q-item .ev-qlabel { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ev-q-item .ev-qstat { flex-shrink:0; font-size:10px; border-radius:8px; padding:0 7px; border:1px solid #333; color:#999; }
        .ev-qstat.running { color:#d6c2ff; border-color:#5a2fb0; } .ev-qstat.done { color:#3ddc84; border-color:#1f6b45; }
        .ev-qstat.failed { color:#ff8080; border-color:#7a2a2a; } .ev-qstat.paused { color:#ffd23f; border-color:#6b5a1f; }
        .ev-x { background:transparent; border:none; color:#aa4444; cursor:pointer; font-size:14px; padding:0 2px; line-height:1; }
        .ev-x:hover { color:#ff5555; }
        #btn-ev-list { background:#1f5c3a; color:#fff; border:none; padding:8px 14px; border-radius:6px; font-weight:bold; cursor:pointer; }
        #btn-ev-list.stop { background:#aa2222; }
        .ev-cons-box { flex:0 0 100%; box-sizing:border-box; font-size:11px; color:#c9a7ff; background:#120c1e; border:1px solid #2f1a5c; border-radius:6px; padding:5px 8px; line-height:1.45; }
        #modal-evaluator .tool-modal { width: 620px; max-width: 94vw; max-height: 90vh; overflow-y: auto; }
        .ev-row { display:flex; align-items:center; gap:8px; font-size:12px; color:#ccc; }
        .ev-row > .ev-lbl { flex:0 0 110px; color:#9ecfff; font-weight:bold; }
        .ev-row input[type=text], .ev-row input[type=password], .ev-row select { flex:1; min-width:0; font-size:12px; }
        .ev-row input[type=range] { flex:1; accent-color:#b890ff; padding:0; }
        .ev-row .ev-val { flex:0 0 46px; text-align:right; color:#888; font-size:11px; }
        .ev-row label { display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }
        .ev-row input[type=checkbox] { width:auto; margin:0; accent-color:#b890ff; }
        #ev-request { width:100%; box-sizing:border-box; min-height:80px; resize:vertical; font-size:12px; line-height:1.4; }
        #ev-brief { width:100%; box-sizing:border-box; min-height:110px; resize:vertical; font-size:12px; line-height:1.4; }
        .ev-small { font-size:11px; color:#777; line-height:1.4; }
        #ev-progress { font-size:12px; color:#aaa; min-height:1.4em; }
        #ev-progress-bar { height:4px; background:#222; border-radius:2px; overflow:hidden; }
        #ev-progress-fill { height:100%; width:0; background:#b890ff; transition:width .2s; }
        #ev-summary { display:flex; flex-wrap:wrap; gap:6px; font-size:11px; }
        #ev-summary span { background:#151515; border:1px solid #333; border-radius:10px; padding:1px 8px; color:#aaa; }
        #btn-ev-run { background:#5a2fb0; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer; }
        #btn-ev-run.stop { background:#aa2222; }
        #btn-ev-clear { background:transparent; border:1px solid #555; color:#aaa; padding:8px 12px; border-radius:6px; cursor:pointer; margin-right:auto; }
        #btn-ev-clear:hover { color:#ff8080; border-color:#aa4444; }
        .ev-btn-mini { background:#151515; border:1px solid #444; color:#aaa; border-radius:4px; padding:3px 8px; cursor:pointer; font-size:12px; }
        .ev-btn-mini:hover { color:#fff; border-color:#888; }
    `;
    document.head.appendChild(style);

    /* ---------- CONFIG / RESULTS PERSISTENCE ---------- */
    async function loadAll() {
        if (typeof window.getSetting !== 'function') return;
        try {
            const c = await window.getSetting(CFG_KEY, null);
            if (c && typeof c === 'object') cfg = { ...DEFAULT_CFG, ...c, tipFields: { ...DEFAULT_CFG.tipFields, ...(c.tipFields || {}) } };
            cfg.consistency = true;
            const r = await window.getSetting(RES_KEY, null);
            if (r && typeof r === 'object') results = r;
            const dr = await window.getSetting(DSR_KEY, null);
            if (dr && typeof dr === 'object') dsReviews = dr;
            if (!cfg.datasets || typeof cfg.datasets !== 'object') cfg.datasets = {};
            if (!Array.isArray(cfg.queue)) cfg.queue = [];
            cfg.queue.forEach(q => { if (q.status === 'running') q.status = 'paused'; });
            // Old single base -> bases of its dataset.
            if (cfg.baseKey) {
                const ds = dsOfKey(cfg.baseKey);
                const d = dsData(ds);
                if (!d.bases.some(b => b.key === cfg.baseKey)) d.bases.push({ key: cfg.baseKey, name: cfg.baseKey.split('|').pop(), style: 'Style A', trigger: '' });
                cfg.baseKey = '';
            }
        } catch (e) { /* defaults */ }
    }
    function saveCfg() {
        if (typeof window.saveSetting === 'function') window.saveSetting(CFG_KEY, cfg);
    }
    function saveResults() {
        clearTimeout(saveResTimer);
        saveResTimer = setTimeout(() => {
            if (typeof window.saveSetting === 'function') window.saveSetting(RES_KEY, results);
        }, 500);
    }

    function keyOf(img) {
        const root = (window.rootHandle && window.rootHandle.name) || '';
        const dir = (img.parentDirHandle && img.parentDirHandle.name) || '';
        return root + '|' + dir + '|' + img.name;
    }
    function resultOf(img) { return results[keyOf(img)] || null; }

    /* Dataset = root folder name + folder of the images (same prefix as the result keys). */
    function dsOfKey(k) { const p = String(k).split('|'); return p[0] + '|' + p[1]; }
    function currentDsKey() {
        const root = window.rootHandle && window.rootHandle.name;
        const dir = window.currentImagesHandle && window.currentImagesHandle.name;
        return root ? root + '|' + (dir || root) : '';
    }
    function dsData(ds) {
        if (!cfg.datasets[ds]) cfg.datasets[ds] = { brief: '', bases: [] };
        const d = cfg.datasets[ds];
        if (!Array.isArray(d.bases)) d.bases = [];
        return d;
    }
    function basesOf(ds) { return ds && cfg.datasets[ds] && Array.isArray(cfg.datasets[ds].bases) ? cfg.datasets[ds].bases : []; }
    const CAPTION_STYLES = {
        auto:     { label: 'Auto (detect from the captions)', prompt: 'auto' },
        danbooru: { label: 'Danbooru tags', prompt: 'Danbooru tags (Danbooru naming)' },
        e621:     { label: 'e621 tags', prompt: 'e621 tags (e621 naming: species, anthro, body types...)' },
        mixed:    { label: 'Danbooru + e621 tags', prompt: 'Danbooru or e621 tags' },
        natural:  { label: 'Natural language', prompt: 'natural-language sentences (not tags)' },
        hybrid:   { label: 'Tags + natural language', prompt: 'Danbooru tags plus a natural-language sentence' }
    };
    function captionStyleOf(ds) { const d = ds && cfg.datasets[ds]; return d && CAPTION_STYLES[d.captionStyle] ? d.captionStyle : 'auto'; }
    /* The app keeps natural language inside the tag list as "NL:..." entries (real commas
       stored as "，"). Split it so the model gets clean tags + clean sentences. */
    function splitCaption(content) {
        const text = String(content || '').trim();
        if (!text) return { tags: [], nl: [] };
        const fmt = typeof window.detectFormat === 'function' ? window.detectFormat(text) : 'tags';
        if (fmt === 'nl' && !/(^|,)\s*NL:/.test(text)) return { tags: [], nl: [text.replace(/，/g, ',')] };
        const tags = [], nl = [];
        text.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
            if (/^NL:/i.test(t)) nl.push(t.slice(3).trim().replace(/，/g, ','));
            else tags.push(t);
        });
        return { tags, nl };
    }
    // Style actually used for one image: auto -> by its caption.
    function effectiveStyle(ds, content) {
        const st = captionStyleOf(ds);
        if (st !== 'auto') return st;
        const c = splitCaption(content);
        if (c.nl.length && !c.tags.length) return 'natural';
        if (c.nl.length) return 'hybrid';
        return 'auto-tags';            // tags: checked on Danbooru, then e621
    }
    function requestOf(ds) { const d = ds && cfg.datasets[ds]; return d && d.request ? String(d.request) : ''; }
    function saveDsReviews() { if (typeof window.saveSetting === 'function') window.saveSetting(DSR_KEY, dsReviews); }
    function briefOf(ds) { const d = ds && cfg.datasets[ds]; return (d && d.brief && d.brief.trim()) ? d.brief : (cfg.brief || ''); }
    function basesSig(bases) { return bases.map(b => b.key + '=' + b.style).sort().join(';'); }
    function styleNames(bases) { return [...new Set(bases.map(b => b.style))]; }
    // Description / trigger of a style = first base of that style that has one.
    function styleInfo(bases, name) {
        const of = bases.filter(b => b.style === name);
        return { desc: (of.find(b => String(b.desc || '').trim()) || {}).desc || '', trigger: (of.find(b => String(b.trigger || '').trim()) || {}).trigger || '' };
    }
    function nextStyleName(bases) {
        const used = new Set(bases.map(b => b.style));
        for (let i = 0; i < 26; i++) { const n = 'Style ' + String.fromCharCode(65 + i); if (!used.has(n)) return n; }
        return 'Style ' + (bases.length + 1);
    }

    function scoreClass(s) {
        if (s >= 8) return 's-good';
        if (s >= 6) return 's-mid';
        if (s >= 4) return 's-low';
        return 's-bad';
    }

    /* ---------- CONSISTENCY ACROSS THE DATASET ----------
       Common design = traits in ≥ 40% of the scored (visible) images. */
    let consensus = { traits: [], freq: new Map(), n: 0 };
    function computeConsensus() {
        consensus = { traits: [], freq: new Map(), n: 0 };
        if (typeof imageFiles === 'undefined') return;
        const rs = imageFiles.filter(i => !i.hidden).map(resultOf).filter(r => r && r.traits && r.traits.length);
        consensus.n = rs.length;
        if (rs.length < 3) return;
        rs.forEach(r => r.traits.forEach(t => consensus.freq.set(t, (consensus.freq.get(t) || 0) + 1)));
        const min = Math.max(2, Math.ceil(rs.length * 0.4));
        consensus.traits = Array.from(consensus.freq.entries()).filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    }
    /* Styles of an image vs the bases of its dataset.
       Returns { mode: 'styles' | 'base-traits' | 'common', pct, style, scores:{style:pct}, diff, note,
                 missing[], unusual[], isBase, baseStyle } or null. */
    function traitPct(baseTraits, traits) {
        const has = new Set(traits);
        return Math.round(100 * baseTraits.filter(t => has.has(t)).length / baseTraits.length);
    }
    function consistencyOf(r, img, key) {
        if (!r) return null;
        key = key || (img ? keyOf(img) : '');
        const ds = key ? dsOfKey(key) : currentDsKey();
        const bases = basesOf(ds);
        if (bases.length) {
            const me = bases.find(b => b.key === key);
            if (me) return { isBase: true, baseStyle: me.style, mode: 'styles' };
            const names = styleNames(bases);
            // Evaluated against these same bases: the model's own comparison.
            if (r.basesSig === basesSig(bases) && r.styleScores && Object.keys(r.styleScores).length) {
                const best = names.reduce((acc, n) => (r.styleScores[n] != null && (acc == null || r.styleScores[n] > r.styleScores[acc])) ? n : acc, null);
                if (best != null) return { mode: 'styles', style: best, pct: r.styleScores[best], scores: r.styleScores, diff: r.designDiff || '', note: r.styleNote || '', missing: [], unusual: [] };
            }
            // Old single-base result against a base that is still in the list.
            if (r.baseUsed && r.designMatch != null) {
                const b = bases.find(x => x.key === r.baseUsed);
                if (b) return { mode: 'styles', style: b.style, pct: r.designMatch, scores: { [b.style]: r.designMatch }, diff: r.designDiff || '', note: '', missing: [], unusual: [], partial: names.length > 1 };
            }
            // Fallback: trait overlap with each base (bases scored too).
            if (r.traits && r.traits.length) {
                const scores = {};
                let bestB = null, bestP = -1;
                bases.forEach(b => {
                    const br = results[b.key];
                    if (!br || !br.traits || br.traits.length < 2) return;
                    const p = traitPct(br.traits, r.traits);
                    if (scores[b.style] == null || p > scores[b.style]) scores[b.style] = p;
                    if (p > bestP) { bestP = p; bestB = { b, br }; }
                });
                if (bestB) {
                    const has = new Set(r.traits), bs = new Set(bestB.br.traits);
                    return { mode: 'base-traits', style: bestB.b.style, pct: bestP, scores, diff: '', note: '',
                        missing: bestB.br.traits.filter(t => !has.has(t)), unusual: r.traits.filter(t => !bs.has(t)) };
                }
            }
            return null;
        }
        if (!r.traits || !r.traits.length || consensus.traits.length < 2) return null;
        const has = new Set(r.traits);
        const matched = consensus.traits.filter(t => has.has(t));
        const missing = consensus.traits.filter(t => !has.has(t));
        // "unusual" = traits that almost no other image has
        const unusual = r.traits.filter(t => (consensus.freq.get(t) || 0) <= Math.max(1, Math.floor(consensus.n * 0.15)));
        return { pct: Math.round(100 * matched.length / consensus.traits.length), missing, unusual, diff: '', mode: 'common' };
    }

    /* Trigger tag check (exact, from the current caption): the style's trigger tag must
       be in the caption, and no other style's trigger. */
    function captionTags(content) {
        return new Set(splitCaption(content).tags.map(t => t.trim().toLowerCase().replace(/_/g, ' ')).filter(Boolean));
    }
    function triggerCheck(img, cons) {
        if (!img || !cons || cons.isBase === undefined && !cons.style) return null;
        const ds = dsOfKey(keyOf(img));
        const bases = basesOf(ds);
        const style = cons.isBase ? cons.baseStyle : cons.style;
        if (!style || !bases.length) return null;
        const trig = t => String(t || '').trim().toLowerCase().replace(/_/g, ' ');
        const mine = bases.filter(b => b.style === style && trig(b.trigger)).map(b => trig(b.trigger));
        const others = bases.filter(b => b.style !== style && trig(b.trigger)).map(b => trig(b.trigger));
        if (!mine.length && !others.length) return null;
        const tags = captionTags(img.content);
        return { style, missing: [...new Set(mine)].filter(t => !tags.has(t)), wrong: [...new Set(others)].filter(t => tags.has(t)) };
    }

    /* ---------- BADGES ON THE LIST ---------- */
    function paintBadges() {
        if (typeof imageFiles === 'undefined') return;
        computeConsensus();
        paintDatasetCounter();
        if (pick) paintPick();
        imageFiles.forEach(img => {
            if (!img.element) return;
            const wrap = img.element.querySelector('.list-item-thumb-wrap');
            if (!wrap) return;
            let badge = wrap.querySelector('.eval-score-badge');
            const show = enabled && cfg.showBadges;
            const r = show ? resultOf(img) : null;
            if (!show) { if (badge) badge.remove(); return; }
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'eval-score-badge';
                badge.addEventListener('mouseenter', ev => showTip(img, ev));
                badge.addEventListener('mousemove', moveTip);
                badge.addEventListener('mouseleave', hideTip);
                // With a score: open in 🪣 Bucket. Without: evaluate just this image.
                badge.addEventListener('click', ev => { ev.stopPropagation(); if (resultOf(img)) openInBucket(img); else evaluateOne(img); });
                badge.addEventListener('mousedown', ev => ev.stopPropagation());
                wrap.appendChild(badge);
            }
            if (!r) {
                const queued = isQueued(img);
                badge.className = 'eval-score-badge eval-ask' + (queued ? ' queued' : '');
                badge.textContent = queued ? '⏳' : '🧐';
                return;
            }
            const stale = !!(img._resolution && r.w && (img._resolution.w !== r.w || img._resolution.h !== r.h));
            const canOpen = !stale && (r.bucketCrop || r.autoCrop || (r.bucket && r.bucket !== 'current'));
            badge.className = 'eval-score-badge ' + scoreClass(r.score) + (stale ? ' stale' : '') + (canOpen ? ' clickable' : '');
            const isBase = cfg.consistency && basesOf(dsOfKey(keyOf(img))).some(b => b.key === keyOf(img));
            badge.textContent = (isBase ? '📌 ' : '') + (Math.round(r.score * 10) / 10).toString();
        });
    }

    /* Click on the score: opens 🪣 Bucket with the suggested bucket + crop already set. */
    function openInBucket(img) {
        const r = resultOf(img);
        if (!r || typeof window.openFixBucketModal !== 'function') return;
        const stale = !!(img._resolution && r.w && (img._resolution.w !== r.w || img._resolution.h !== r.h));
        if (stale) { window.showAlert && window.showAlert('This image changed after the evaluation — evaluate it again.', 'info'); return; }
        let preset = null;
        const key = r.bucketCrop ? r.bucket : (r.autoCrop ? r.autoCrop.key : (r.bucket && r.bucket !== 'current' ? r.bucket : null));
        if (!key) return;
        const [bw, bh] = key.split('x').map(Number);
        preset = { bw, bh, crop: r.bucketCrop || (r.autoCrop && r.autoCrop.crop) || null };
        hideTip();
        // Select the image so the editor / Bucket button follow it.
        if (typeof selectedIndices !== 'undefined' && typeof imageFiles !== 'undefined') {
            const idx = imageFiles.indexOf(img);
            if (idx >= 0) {
                selectedIndices.clear(); selectedIndices.add(idx);
                if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
                if (typeof window.renderEditor === 'function') window.renderEditor();
            }
        }
        window.openFixBucketModal(img, preset);
    }

    /* ---------- TOOLTIP ---------- */
    let tip = null;
    function ensureTip() {
        if (tip) return tip;
        tip = document.createElement('div');
        tip.id = 'eval-tooltip';
        document.body.appendChild(tip);
        return tip;
    }
    function showTip(img, ev) {
        const r = resultOf(img);
        if (!r) {
            const t = ensureTip();
            t.classList.remove('ds');
            t.innerHTML = isQueued(img)
                ? '<div>⏳ In the evaluation queue…</div>'
                : `<div>🧐 <b>Click to evaluate this image</b></div><div class="et-meta">${cfg.model ? 'Uses the 🧐 settings (' + esc(cfg.model) + ')' : 'Pick a model in 🧐 first'} — it goes ahead of the dataset list.</div>`;
            t.style.display = 'block';
            moveTip(ev);
            return;
        }
        const t = ensureTip();
        t.classList.remove('ds');
        const v = VERDICTS[r.verdict] || { icon: '❔', label: r.verdict || '—' };
        const stale = !!(img._resolution && r.w && (img._resolution.w !== r.w || img._resolution.h !== r.h));
        const F = cfg.tipFields || {};
        const cons = F.consistency ? consistencyOf(r, img) : null;
        t.innerHTML = `
            <div class="et-head"><span>${v.icon} ${esc(v.label)}</span><span>${esc(r.score)}/10</span></div>
            ${F.comment && r.comment ? `<div>${esc(r.comment)}</div>` : ''}
            ${F.issues && r.issues && r.issues.length ? `<div class="et-issues">${r.issues.map(i => `<span class="et-issue">${esc(i)}</span>`).join('')}</div>` : ''}
            ${F.suggestion && r.suggestion ? `<div class="et-sugg">💡 ${esc(r.suggestion)}</div>` : ''}
            ${F.review !== false && r.reviewNote ? `<div class="et-review">📝 ${esc(r.reviewNote)}</div>` : ''}
            ${consLine(cons, img)}
            ${F.styleNote && cons && cons.note ? `<div class="et-style">🎨 ${esc(cons.note)}</div>` : ''}
            ${F.styleNote && cons && r.styleAdjust && cons.mode === 'styles' ? `<div class="et-style">🛠️ Style adjustment: ${esc(r.styleAdjust)}</div>` : ''}
            ${F.tags !== false ? tagsLine(tagChanges(img, r, cfg.consistency ? cons || consistencyOf(r, img) : null)) : ''}
            ${bucketLine(r)}
            ${F.meta ? `<div class="et-meta">${esc(r.model || '')} · ${r.w ? r.w + '×' + r.h + ' · ' : ''}${new Date(r.ts || Date.now()).toLocaleString()}${stale ? ' · ⚠️ image changed since evaluation' : ''}</div>` : (stale ? '<div class="et-meta">⚠️ image changed since evaluation</div>' : '')}`;
        t.style.display = 'block';
        moveTip(ev);
    }
    function consLine(c, img) {
        if (!c) return '';
        const key = img ? keyOf(img) : '';
        if (c.isBase) {
            const inf = styleInfo(basesOf(dsOfKey(key)), c.baseStyle);
            return `<div class="et-cons">📌 This is a BASE image — style <b>${esc(c.baseStyle || '')}</b>${inf.trigger ? ` <span class="et-trigtag">${esc(inf.trigger)}</span>` : ''}${inf.desc ? `<br><span style="color:#999;">${esc(inf.desc)}</span>` : ''}<br>The others are compared with it.</div>`;
        }
        let html;
        if (c.mode === 'common') {
            html = `<div class="et-cons">🧬 Design: <b>${c.pct}%</b> of the common design`;
        } else {
            const others = c.scores ? Object.entries(c.scores).filter(([n]) => n !== c.style).sort((x, y) => y[1] - x[1]) : [];
            const weak = c.pct < 50;
            const inf = styleInfo(basesOf(dsOfKey(key || '')), c.style);
            html = `<div class="et-cons">🎨 ${weak ? 'Closest style' : 'Style'}: <b>${esc(c.style)}</b>${inf.trigger ? ` <span class="et-trigtag">${esc(inf.trigger)}</span>` : ''} · <b>${c.pct}%</b> match` +
                (inf.desc ? `<br><span style="color:#999;">${esc(inf.desc)}</span>` : '') +
                (others.length ? ` <span style="color:#888;">(${others.map(([n, p]) => `${esc(n)} ${p}%`).join(' · ')})</span>` : '') +
                (weak ? ` <span style="color:#ff9f43;">— matches no base well</span>` : '') +
                (c.mode === 'base-traits' ? ' <span style="color:#777;">(by traits — evaluate again for a visual comparison)</span>' : '') +
                (c.partial ? ' <span style="color:#777;">(compared with one base only — evaluate again)</span>' : '');
        }
        if (c.diff) html += `<br><span style="color:#999;">differs:</span> ${esc(c.diff)}`;
        if (c.missing && c.missing.length) html += `<br><span style="color:#999;">missing:</span> ${esc(c.missing.slice(0, 5).join(', '))}`;
        if (c.unusual && c.unusual.length) html += `<br><span style="color:#999;">unusual:</span> ${esc(c.unusual.slice(0, 5).join(', '))}`;
        return html + '</div>';
    }
    /* Tag changes = the model's suggestion + the exact trigger check, minus what the
       caption already reflects (so applied changes disappear on their own). */
    function tagChanges(img, r, cons) {
        const tags = captionTags(img.content);
        const norm = t => String(t).trim().toLowerCase().replace(/_/g, ' ');
        const natural = effectiveStyle(dsOfKey(keyOf(img)), img.content) === 'natural';
        const low = String(img.content || '').toLowerCase();
        const add = new Set((r.tagsAdd || []).filter(t => !tags.has(norm(t)) && !(natural && String(img.content || '').toLowerCase().includes(String(t).toLowerCase()))));
        const rem = new Set((r.tagsRemove || []).filter(t => natural ? low.includes(String(t).toLowerCase()) : tags.has(norm(t))));
        const tc = triggerCheck(img, cons);
        if (tc) { tc.missing.forEach(t => add.add(t)); tc.wrong.forEach(t => rem.add(t)); }
        return { add: [...add], remove: [...rem], style: tc ? tc.style : '', info: r.tagsInfo || null, natural: effectiveStyle(dsOfKey(keyOf(img)), img.content) === 'natural' };
    }
    function tagsLine(tc) {
        if (!tc || (!tc.add.length && !tc.remove.length)) return '';
        const mark = t => {
            const i = tc.info && tc.info[t];
            if (!i) return '';
            const n = i.count >= 1000 ? Math.round(i.count / 100) / 10 + 'k' : i.count;
            if (i.status === 'ok') return ` <span class="et-tok" title="Found on ${esc(i.src)}: ${i.count} posts">✓${n}</span>`;
            if (i.status === 'alias') return ` <span class="et-tok" title="'${esc(i.orig)}' is an alias on ${esc(i.src)} — replaced by the real tag (${i.count} posts)">↪${n}</span>`;
            if (i.status === 'similar') return ` <span class="et-tsim" title="'${esc(i.orig)}' does not exist on ${esc(i.src)} — closest real tag (${i.count} posts)">≈ was "${esc(i.orig)}"</span>`;
            if (i.status === 'unknown') return ` <span class="et-tunk" title="Not found on the site — the model may have invented it">❔</span>`;
            return '';
        };
        return `<div class="et-trig">🏷️ ${tc.natural ? 'Caption changes' : 'Tag changes'}: ${tc.add.map(t => `<span class="et-tadd">+ ${esc(t)}${mark(t)}</span>`).join(' ')} ${tc.remove.map(t => `<span class="et-trem">− ${esc(t)}</span>`).join(' ')}</div>`;
    }
    function trigLine(t) {
        if (!t || (!t.missing.length && !t.wrong.length)) return '';
        const parts = [];
        if (t.missing.length) parts.push(`add trigger <b>${esc(t.missing.join(', '))}</b>`);
        if (t.wrong.length) parts.push(`remove <b>${esc(t.wrong.join(', '))}</b> (trigger of another style)`);
        return `<div class="et-trig">🏷️ Caption (${esc(t.style)}): ${parts.join(' · ')}</div>`;
    }

    function bucketLine(r) {
        const F = cfg.tipFields || {};
        let html = '';
        if (F.framing && r.framing) html += `<div class="et-frame">🧭 Framing: ${esc(r.framing)}</div>`;
        // A linha 📐 "Better bucket" foi removida: repetia o 💡 suggestion (que já explica o porquê).
        if (F.crop && r.autoCrop) {
            const [aw, ah] = r.autoCrop.key.split('x').map(Number);
            html += `<div class="et-bucket">✂️ Measured: crop around the subject to <b>${aw > ah ? '▭' : (ah > aw ? '▯' : '□')} ${aw}×${ah}</b> (removes ${r.autoCrop.removed}% empty space)</div>`;
        }
        if (F.hint && (r.bucketCrop || r.autoCrop || (r.bucket && r.bucket !== 'current'))) html += `<div class="et-click">🖱️ Click the score to open this in 🪣 Bucket</div>`;
        return html;
    }

    function bucketPick(r) {
        if (!r.bucket) return '';
        if (r.bucket === 'current') return `<div class="et-bucket">📐 Resolution: current size is the best ${esc(r.bucketModel || '')} bucket${r.bucketReason ? ` — ${esc(r.bucketReason)}` : ''}</div>`;
        const [bw, bh] = r.bucket.split('x').map(Number);
        const mark = bw === bh ? '□' : (bh > bw ? '▯' : '▭');
        const how = r.bucketCrop ? `crop around the subject · removes ${r.bucketRemoved}% empty space` : `keeps ${r.bucketKept}%`;
        return `<div class="et-bucket">📐 Better bucket: <b>${mark} ${bw}×${bh}</b> <span style="color:#888;">(${esc(r.bucketModel || '')} · ${how}${r.bucketUpscale ? ` · ${r.bucketUpscale}× upscale` : ''})</span>${r.bucketReason ? `<br>${esc(r.bucketReason)}` : ''}</div>`;
    }

    function moveTip(ev) {
        if (!tip || tip.style.display !== 'block') return;
        const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
        let x = ev.clientX + pad, y = ev.clientY + pad;
        if (x + w > window.innerWidth - 6) x = ev.clientX - w - pad;
        if (y + h > window.innerHeight - 6) y = ev.clientY - h - pad;
        tip.style.left = Math.max(6, x) + 'px';
        tip.style.top = Math.max(6, y) + 'px';
    }
    function hideTip() { if (tip) { tip.style.display = 'none'; tip.classList.remove('ds'); } }

    /* ---------- IMAGE -> BASE64 (downscaled) ---------- */
    // Reads the FILE itself (handle), not the list's blob URL: the URLs are revoked when
    // another dataset is opened, the files stay readable.
    async function readImageBlob(img) {
        if (img.handle && typeof img.handle.getFile === 'function') return await img.handle.getFile();
        return await (await fetch(img.url)).blob();
    }
    async function imageToBase64(img, maxSide) {
        const blob = await readImageBlob(img);
        const bmp = await createImageBitmap(blob);
        const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);       // transparent PNG -> white, not black
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, w, h);
        const real = { w: bmp.width, h: bmp.height };
        // Small copy WITH alpha for the framing analysis (background / subject box).
        const as = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
        const aw = Math.max(1, Math.round(bmp.width * as)), ah = Math.max(1, Math.round(bmp.height * as));
        const ac = document.createElement('canvas');
        ac.width = aw; ac.height = ah;
        const actx = ac.getContext('2d', { willReadFrequently: true });
        actx.drawImage(bmp, 0, 0, aw, ah);
        const framing = analyzeFraming(actx.getImageData(0, 0, aw, ah).data, aw, ah);
        ac.width = ac.height = 0;
        bmp.close();
        const dataUrl = c.toDataURL('image/jpeg', 0.9);
        c.width = c.height = 0;
        return { b64: dataUrl.split(',')[1], dataUrl, real, framing };
    }

    /* ---------- FRAMING ANALYSIS (exact, no AI) ----------
       Plain background (white / black / solid color / transparent) is detected from
       the image border; the subject box is everything that differs from it.
       Returns { detected, bg, bbox:{x0,y0,x1,y1} (0–1), coverage, empty, offX, offY, notable, where }
       or { detected:false } when the background is busy (photo, scenery…). */
    function analyzeFraming(px, w, h) {
        const border = [];
        const pushPx = (x, y) => { const i = (y * w + x) * 4; border.push([px[i], px[i + 1], px[i + 2], px[i + 3]]); };
        for (let x = 0; x < w; x++) { pushPx(x, 0); pushPx(x, Math.min(h - 1, 1)); pushPx(x, h - 1); pushPx(x, Math.max(0, h - 2)); }
        for (let y = 0; y < h; y++) { pushPx(0, y); pushPx(Math.min(w - 1, 1), y); pushPx(w - 1, y); pushPx(Math.max(0, w - 2), y); }
        const transp = border.filter(p => p[3] < 24).length / border.length;
        let mode, bg = [0, 0, 0];
        if (transp > 0.6) mode = 'alpha';
        else {
            const opaque = border.filter(p => p[3] >= 24);
            const med = k => { const a = opaque.map(p => p[k]).sort((m, n) => m - n); return a[a.length >> 1]; };
            bg = [med(0), med(1), med(2)];
            const near = opaque.filter(p => Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) <= 36).length / opaque.length;
            if (near < 0.7) return { detected: false };
            mode = 'color';
        }
        const colCnt = new Uint32Array(w), rowCnt = new Uint32Array(h);
        let fg = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                let isFg;
                if (px[i + 3] < 24) isFg = false;
                else if (mode === 'alpha') isFg = true;
                else isFg = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 42;
                if (isFg) { colCnt[x]++; rowCnt[y]++; fg++; }
            }
        }
        if (fg < w * h * 0.01) return { detected: false };
        const colMin = Math.max(1, Math.round(h * 0.006)), rowMin = Math.max(1, Math.round(w * 0.006));
        let x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1;
        while (x0 < w - 1 && colCnt[x0] < colMin) x0++;
        while (x1 > x0 && colCnt[x1] < colMin) x1--;
        while (y0 < h - 1 && rowCnt[y0] < rowMin) y0++;
        while (y1 > y0 && rowCnt[y1] < rowMin) y1--;
        const bbox = { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
        const coverage = (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0);
        const offX = (bbox.x0 + bbox.x1) / 2 - 0.5, offY = (bbox.y0 + bbox.y1) / 2 - 0.5;
        const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
        const bgName = mode === 'alpha' ? 'transparent' : (lum > 225 ? 'white' : (lum < 30 ? 'black' : 'solid color'));
        const where = [offY < -0.1 ? 'top' : (offY > 0.1 ? 'bottom' : ''), offX < -0.1 ? 'left' : (offX > 0.1 ? 'right' : '')].filter(Boolean).join('-');
        const notable = (1 - coverage) > 0.3 || Math.abs(offX) > 0.1 || Math.abs(offY) > 0.1;
        return { detected: true, bg: bgName, bbox, coverage, empty: 1 - coverage, offX, offY, where, notable };
    }

    function framingText(fr) {
        if (!fr || !fr.detected || !fr.notable) return '';
        const parts = [];
        if (fr.where) parts.push(`subject off-center (${fr.where})`);
        if (fr.empty > 0.3) parts.push(`${Math.round(fr.empty * 100)}% empty ${fr.bg} background`);
        return parts.join(' · ');
    }

    /* Crops of each bucket's aspect that contain the whole subject (+ a small margin),
       centered on it. Best = least empty space, avoiding big upscales. */
    function subjectCrops(real, fr) {
        const B = window.TMBuckets;
        if (!B || !fr || !fr.detected || !fr.notable) return [];
        const W = real.w, H = real.h;
        const bx0 = fr.bbox.x0 * W, by0 = fr.bbox.y0 * H, bx1 = fr.bbox.x1 * W, by1 = fr.bbox.y1 * H;
        const pad = 0.05 * Math.max(bx1 - bx0, by1 - by0);
        const rx0 = Math.max(0, bx0 - pad), ry0 = Math.max(0, by0 - pad), rx1 = Math.min(W, bx1 + pad), ry1 = Math.min(H, by1 + pad);
        const rw = rx1 - rx0, rh = ry1 - ry0, cx = (rx0 + rx1) / 2, cy = (ry0 + ry1) / 2;
        const out = B.suggest(W, H).map(b => {
            const ar = b.bw / b.bh;
            let cw = rw, ch = rw / ar;
            if (ch < rh) { ch = rh; cw = rh * ar; }
            let fits = true;
            if (cw > W) { cw = W; ch = W / ar; }
            if (ch > H) { ch = H; cw = H * ar; }
            if (cw < rw - 1 || ch < rh - 1) fits = false;
            const x = Math.max(0, Math.min(W - cw, cx - cw / 2)), y = Math.max(0, Math.min(H - ch, cy - ch / 2));
            const scale = b.bw / cw;
            const removed = 1 - (cw * ch) / (W * H);
            const cost = (cw * ch) * (scale > 1.5 ? 1 + (scale - 1.5) * 0.6 : 1);
            return { key: b.bw + 'x' + b.bh, bw: b.bw, bh: b.bh, fits, scale, removed: Math.round(removed * 100), crop: { x: Math.round(x), y: Math.round(y), w: Math.round(cw), h: Math.round(ch) }, cost };
        }).filter(c => c.fits && c.removed >= 10).sort((a, b) => a.cost - b.cost);
        return out.slice(0, 3);
    }

    /* ---------- BUCKET CANDIDATES (exact math, from tagmanager_bucket_check.js) ----------
       Closest aspect ratios + the best of each orientation (square / vertical /
       horizontal), so the model can also suggest switching orientation when the
       composition fits better. The model only CHOOSES among these. */
    function bucketCandidates(real, framing) {
        const B = window.TMBuckets;
        if (!cfg.suggestBucket || !B || !real) return null;
        const all = B.suggest(real.w, real.h);
        const pick = all.slice(0, 4);
        const add = c => { if (c && !pick.includes(c)) pick.push(c); };
        add(all.find(c => c.bw === c.bh));
        add(all.find(c => c.bh > c.bw));
        add(all.find(c => c.bw > c.bh));
        return {
            model: B.label(),
            subject: [],
            isBucket: B.isBucket(real.w, real.h),
            list: pick.map(c => ({ key: c.bw + 'x' + c.bh, bw: c.bw, bh: c.bh, kept: Math.round(c.kept * 100), scale: c.scale })),
            subject: subjectCrops(real, framing)
        };
    }

    /* ---------- PROMPT ---------- */
    // bases: [{ style }] in the order the base images are sent (IMAGE 1..N); the reviewed image is the last one.
    function buildPrompt(img, real, buckets, framing, bases, brief) {
        const parts = [];
        const nB = bases ? bases.length : 0;
        const withBase = nB > 0;
        const lastN = nB + 1;
        if (withBase) {
            const lst = bases.map((b, i) => {
                const inf = styleInfo(bases, b.style);
                return `IMAGE ${i + 1} = BASE of style "${b.style}"${inf.trigger ? ` (trigger tag: ${inf.trigger})` : ''}${inf.desc ? ` — ${inf.desc}` : ''}`;
            }).join('; ');
            parts.push(`You get ${lastN} images. ${lst}. IMAGE ${lastN} = the image to review. The BASE images are references of how the subject / style is supposed to look${styleNames(bases).length > 1 ? ' — the dataset deliberately has SEVERAL styles, one per base label' : ''}. Everything below (score, issues, framing, resolution) is about IMAGE ${lastN} only; the bases are only for the style / design comparison.`);
        }
        parts.push(`You are reviewing images for a training dataset (LoRA / fine-tune). Give an honest second opinion on ${withBase ? 'IMAGE ' + lastN : 'THIS image'}.`);
        parts.push('DATASET BRIEF (what the dataset is for — judge the image against it):\n' + (String(brief || '').trim() || '(no brief given — judge general training quality)'));
        if (cfg.sendResolution && real) parts.push(`Image resolution: ${real.w}x${real.h} pixels.`);
        if (cfg.sendCaption && img.content && img.content.trim()) {
            const cap = splitCaption(img.content);
            const lines = [];
            if (cap.tags.length) lines.push('Tags: ' + cap.tags.join(', '));
            if (cap.nl.length) lines.push('Natural-language part: ' + cap.nl.join(' '));
            parts.push('Current caption of this image:\n' + lines.join('\n').slice(0, 1800));
        }
        const fText = framingText(framing);
        if (fText) {
            parts.push(`AUTOMATIC FRAMING ANALYSIS (measured, trust it): plain ${framing.bg} background. The subject's bounding box covers only ${Math.round(framing.coverage * 100)}% of the image${framing.where ? ` and is off-center toward the ${framing.where}` : ''}; ${Math.round(framing.empty * 100)}% of the image is empty background. This wastes training resolution and teaches bad composition — mention it in "issues" and take it into account in the score, verdict and suggestion (cropping around the subject / changing the resolution is usually the fix).`);
        }
        if (buckets) {
            const orient = (w, h) => w === h ? 'square' : (h > w ? 'vertical' : 'horizontal');
            const lines = buckets.list.map(c => `- ${c.key} (${orient(c.bw, c.bh)}, keeps ${c.kept}% of the image${c.scale > 1.001 ? `, needs ${c.scale.toFixed(2)}x upscale` : ''})`);
            parts.push(`TRAINING RESOLUTION (${buckets.model} buckets). The current resolution ${real.w}x${real.h} is ${buckets.isBucket ? 'already a valid bucket' : 'NOT a valid bucket'}. The image would be center-cropped / resized to one of these:\n${lines.join('\n')}\nLook at the composition: which one keeps the important content (the subject, face, hands, full body) best and frames it well? A different orientation is fine if the subject fits it better (e.g. a standing full-body character in a vertical bucket). Avoid big upscales when a closer option exists.${buckets.isBucket ? ' Answer "current" if the current resolution is already the best.' : ''}`);
            if (buckets.subject.length) {
                const sl = buckets.subject.map(c => `- ${c.key} (${orient(c.bw, c.bh)}, crop around the subject: removes ${c.removed}% empty space, subject fully kept${c.scale > 1.001 ? `, needs ${c.scale.toFixed(2)}x upscale` : ''})`);
                parts.push(`SUBJECT-FOCUSED CROPS (crop tightly around the subject, then resize — usually better when there is a lot of empty space or the subject is off-center):\n${sl.join('\n')}`);
            }
        }
        const req = requestOf(img.dsKey || '').trim();
        if (req) parts.push('USER REVIEW REQUEST (what the user wants help with for this dataset — answer it for THIS image in "review_note", only what is relevant):\n' + req.slice(0, 1500));
        const cst = effectiveStyle(img.dsKey || '', img.content);
        if (cfg.sendCaption && img.content && img.content.trim()) {
            const stylePrompt = cst === 'auto-tags' ? 'booru tags (Danbooru naming; e621 naming for furry / anthro content)' : CAPTION_STYLES[cst].prompt;
            parts.push(`CAPTION STYLE of this dataset: ${stylePrompt}. Keep every suggestion in this format.${cst === 'hybrid' ? ' "tags_add" / "tags_remove" are for the TAGS only; put changes to the natural-language part in "suggestion".' : ''}`);
            parts.push(cst === 'natural'
                ? `CAPTION CHANGES: compare the caption with the image. In "tags_add" put short phrases that are missing from the description, in "tags_remove" the exact words / phrases of the caption that are wrong. Only what you are confident about, max 6 each. Empty lists if the caption is fine.`
                : `TAG CHANGES: compare the caption with the image. Only suggest changes you are confident about, max 6 each, using the exact tag text of the caption for removals. Use REAL ${cst === 'e621' ? 'e621' : 'Danbooru'} tag names (they will be checked on the site). Empty lists if the caption is fine.`);
        }
        if (withBase) parts.push(`STYLE SCORES: for each style label, 0-100 = how much IMAGE ${lastN} matches that base in subject design and art style (face, hair, eyes, outfit, colors, proportions, line art, shading, rendering) — ignore pose, background and framing.`);
        parts.push(`Consider: fit with the brief, image quality (blur, noise, compression, artifacts), anatomy / errors, watermarks, text, signatures, borders, framing / cropping, resolution and aspect ratio, duplication of concept, anything that would hurt training.${cfg.sendCaption ? ' If the caption is clearly wrong or missing something important, mention it.' : ''}`);
        parts.push(`Answer ONLY with a JSON object, no other text:
{
  "score": <number 0-10, 10 = perfect for this dataset, 0 = useless/harmful>,
  "verdict": "<one of: keep, crop, resize, edit, remove>",
  "issues": ["<short issue>", "..."],
  "comment": "<1-2 sentences: what you see and why this score>",
  "suggestion": "<concrete advice: what to change (e.g. crop the bottom text, use a vertical bucket, remove — off-brief), or 'none'>"${requestOf(img.dsKey || '').trim() ? `,
  "review_note": "<short answer to the USER REVIEW REQUEST for this image, or 'none'>"` : ''}${cfg.consistency ? `,
${withBase ? `
  "style_scores": {${styleNames(bases).map(n => `"${n}": <0-100>`).join(', ')}},
  "style": "<the style label above that IMAGE ${lastN} matches best>",
  "design_diff": "<short: the main design / style differences vs the closest base, or 'none'>",
  "style_note": "<a SEPARATE short suggestion about the style only: does it clearly belong to that style or mix styles? is it a good example of it? anything to fix so the style is learned cleanly (e.g. tag it as that style, remove — mixes A and B), or 'none'>",
  "style_adjust": "<advice to adjust the STYLE DEFINITION itself if this image shows it is unclear: e.g. the description of a style misses something visible here, two styles overlap, this image would be a better base, a style should be split / merged — or 'none'>",` : ''}${cfg.sendCaption && img.content && img.content.trim() ? `
  "tags_add": ["<caption tags that should be ADDED (Danbooru style, lowercase): what is clearly visible but missing${withBase ? ", and the trigger tag of the style this image belongs to if missing" : ''}>"],
  "tags_remove": ["<caption tags that should be REMOVED: wrong / not visible / contradicting the image${withBase ? ", style tags that describe ANOTHER style (or another style's trigger tag), and generic style words the trigger tag should absorb" : ''}>"],` : ''}
  "traits": ["<4-10 short Danbooru-style tags of the DEFINING visual traits of the main subject / style that the brief cares about, e.g. silver hair, red eyes, black coat, anime coloring — only what is actually visible>"]` : ''}${buckets ? `,
  "bucket": "<one resolution from the TRAINING RESOLUTION list (e.g. ${buckets.list[0].key})${buckets.isBucket ? ", or 'current'" : ''}>",
  "bucket_reason": "<short: why this resolution fits the composition>"${buckets.subject.length ? `,
  "bucket_crop": "<'subject' if you picked from SUBJECT-FOCUSED CROPS, 'center' if from the TRAINING RESOLUTION list>"` : ''}` : ''}
}`);
        return parts.join('\n\n');
    }

    function normTrait(t) {
        return String(t || '').toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9 ()'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    }

    function tagList(v) {
        const arr = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
        return [...new Set(arr.map(t => String(t).trim().replace(/\s+/g, ' ')).filter(t => t && !/^none$/i.test(t) && t.length <= 60))].slice(0, 6);
    }
    function pctOf(v) {
        const n = parseFloat(v);
        if (!isFinite(n)) return null;
        return Math.max(0, Math.min(100, Math.round(n <= 1 && String(v).includes('.') ? n * 100 : n)));
    }
    // Matches the model's labels to ours (case / spaces / "style a" vs "a").
    function parseStyleScores(obj, styles) {
        if (!styles || !styles.length || !obj || typeof obj !== 'object') return null;
        const norm = x => String(x).toLowerCase().replace(/^style\s*/, '').replace(/[^a-z0-9]/g, '');
        const out = {};
        Object.entries(obj).forEach(([k, v]) => {
            const name = styles.find(n => norm(n) === norm(k));
            const p = pctOf(v && typeof v === 'object' ? (v.score ?? v.match) : v);
            if (name && p != null) out[name] = p;
        });
        return Object.keys(out).length ? out : null;
    }

    function parseAnswer(text, buckets, styles) {
        let s = String(text || '').trim();
        s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        const m = s.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('The model did not return JSON.');
        const j = JSON.parse(m[0]);
        let score = parseFloat(j.score);
        if (!isFinite(score)) throw new Error('No score in the answer.');
        score = Math.min(10, Math.max(0, score));
        let verdict = String(j.verdict || '').toLowerCase().trim();
        if (!VERDICTS[verdict]) verdict = score >= 7 ? 'keep' : (score < 3 ? 'remove' : 'edit');
        const issues = Array.isArray(j.issues) ? j.issues.map(x => String(x).trim()).filter(Boolean).slice(0, 8) : [];
        const sugg = String(j.suggestion || '').trim();
        return {
            score: Math.round(score * 10) / 10,
            verdict,
            issues,
            comment: String(j.comment || '').trim().slice(0, 600),
            suggestion: /^none\.?$/i.test(sugg) ? '' : sugg.slice(0, 400),
            designMatch: pctOf(j.design_match),
            styleScores: parseStyleScores(j.style_scores, styles),
            styleNote: /^none\.?$/i.test(String(j.style_note || '').trim()) ? '' : String(j.style_note || '').trim().slice(0, 300),
            reviewNote: /^none\.?$/i.test(String(j.review_note || '').trim()) ? '' : String(j.review_note || '').trim().slice(0, 400),
            styleAdjust: /^none\.?$/i.test(String(j.style_adjust || '').trim()) ? '' : String(j.style_adjust || '').trim().slice(0, 300),
            tagsAdd: tagList(j.tags_add),
            tagsRemove: tagList(j.tags_remove),
            designDiff: /^none\.?$/i.test(String(j.design_diff || '').trim()) ? '' : String(j.design_diff || '').trim().slice(0, 300),
            traits: Array.isArray(j.traits) ? [...new Set(j.traits.map(normTrait).filter(Boolean))].slice(0, 12) : [],
            ...parseBucket(j, buckets)
        };
    }

    // Accepts only a resolution that was offered (model typos / inventions are ignored).
    function parseBucket(j, buckets) {
        if (!buckets) return {};
        const raw = String(j.bucket || '').toLowerCase().replace(/[×*\s]/g, 'x').replace(/x+/g, 'x');
        const reason = String(j.bucket_reason || '').trim().slice(0, 300);
        if (/current|keep|same/.test(raw) && buckets.isBucket) return { bucket: 'current', bucketReason: reason, bucketModel: buckets.model };
        const m = raw.match(/(\d{3,4})x(\d{3,4})/);
        if (!m) return { bucket: null, bucketModel: buckets.model };
        const same = b => b.bw === +m[1] && b.bh === +m[2];
        const sub = (buckets.subject || []).find(same);
        const cen = buckets.list.find(same);
        const wantsSubject = String(j.bucket_crop || '').toLowerCase().includes('subject');
        if (sub && (wantsSubject || !cen)) {
            return { bucket: sub.key, bucketCrop: sub.crop, bucketRemoved: sub.removed, bucketUpscale: sub.scale > 1.001 ? Math.round(sub.scale * 100) / 100 : 0, bucketReason: reason, bucketModel: buckets.model };
        }
        if (!cen) return { bucket: null, bucketModel: buckets.model };
        return { bucket: cen.key, bucketKept: cen.kept, bucketUpscale: cen.scale > 1.001 ? Math.round(cen.scale * 100) / 100 : 0, bucketReason: reason, bucketModel: buckets.model };
    }

    /* ---------- BACKENDS ---------- */
    const baseUrl = () => String(cfg.backend === 'ollama' ? cfg.urlOllama : cfg.urlOpenAI || '').replace(/\/+$/, '');

    /* Lista SÓ modelos com visão.
       Ollama: /api/show de cada modelo -> capabilities inclui "vision"
               (versões antigas sem "capabilities": família "clip" / projector / chaves *vision*).
       OpenAI-compatible: LM Studio expõe /api/v0/models com type "vlm"; nos outros
               servidores (sem essa informação) cai no nome do modelo.
       Devolve { models, total, method } — method diz como foi filtrado. */
    const VISION_NAME_RE = /(vl\b|vl:|vl-|vision|llava|gemma3|gemma-3|minicpm|moondream|pixtral|internvl|joycaption|molmo|smolvlm|florence|qvq|mllama|cogvlm|idefics|paligemma)/i;

    async function ollamaHasVision(base, name) {
        try {
            const res = await fetch(base + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name }) });
            if (!res.ok) return null;
            const d = await res.json();
            if (Array.isArray(d.capabilities)) return d.capabilities.includes('vision');
            const fams = (d.details && d.details.families) || [];
            if (fams.some(f => /clip|mllama|vision/i.test(f))) return true;
            if (d.projector_info) return true;
            if (d.model_info && Object.keys(d.model_info).some(k => /vision/i.test(k))) return true;
            return false;
        } catch (e) { return null; }
    }

    async function listModels() {
        const base = baseUrl();
        if (cfg.backend === 'ollama') {
            const res = await fetch(base + '/api/tags');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const all = (data.models || []).map(m => m.name).sort();
            const flags = await Promise.all(all.map(n => ollamaHasVision(base, n)));
            if (flags.every(f => f === null)) return { models: all.filter(n => VISION_NAME_RE.test(n)), total: all.length, method: 'name' };
            return { models: all.filter((n, i) => flags[i] === true || (flags[i] === null && VISION_NAME_RE.test(n))), total: all.length, method: 'server' };
        }
        const headers = cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {};
        // LM Studio: tipo do modelo (vlm / llm / embeddings).
        try {
            const r = await fetch(baseUrl() + '/api/v0/models', { headers });
            if (r.ok) {
                const d = await r.json();
                const list = (d.data || []).filter(m => m && m.id);
                if (list.length && list.some(m => m.type)) {
                    return { models: list.filter(m => m.type === 'vlm').map(m => m.id).sort(), total: list.length, method: 'server' };
                }
            }
        } catch (e) { /* not LM Studio */ }
        const res = await fetch(base + '/v1/models', { headers });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const all = (data.data || []).map(m => m.id).sort();
        return { models: all.filter(n => VISION_NAME_RE.test(n)), total: all.length, method: 'name', all };
    }

    async function askModel(prompt, image, signal, baseImages, maxTokens) {
        const imgs = [...(baseImages || []), ...(image ? [image] : [])];
        const base = baseUrl();
        if (cfg.backend === 'ollama') {
            const res = await fetch(base + '/api/chat', {
                method: 'POST', signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: cfg.model, stream: false, format: 'json',
                    options: { temperature: cfg.temperature },
                    messages: [{ role: 'user', content: prompt, ...(imgs.length ? { images: imgs.map(i => i.b64) } : {}) }]
                })
            });
            if (!res.ok) throw new Error('Ollama HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
            const data = await res.json();
            return (data.message && data.message.content) || data.response || '';
        }
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
        const res = await fetch(base + '/v1/chat/completions', {
            method: 'POST', signal, headers,
            body: JSON.stringify({
                model: cfg.model, temperature: cfg.temperature, max_tokens: maxTokens || 600, stream: false,
                messages: [{ role: 'user', content: imgs.length ? [
                    { type: 'text', text: prompt },
                    ...imgs.map(i => ({ type: 'image_url', image_url: { url: i.dataUrl } }))
                ] : prompt }]
            })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
        const data = await res.json();
        return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    }

    /* ---------- RUN ----------
       One worker evaluates one image at a time. Jobs:
       - manualJob: "🧐 Evaluate" on the dataset you are looking at (priority);
       - list job : the next dataset of the 📋 list, read straight from disk.
       Every unit carries its own key / dataset / file handle, so opening another
       dataset never mixes anything up. */
    const IMG_RE = /\.(png|jpg|jpeg|webp)$/i;

    function targetImages() {
        if (typeof imageFiles === 'undefined') return [];
        if (cfg.scope === 'selected') {
            if (typeof selectedIndices === 'undefined') return [];
            return Array.from(selectedIndices).sort((a, b) => a - b).map(i => imageFiles[i]).filter(i => i && !i.hidden);
        }
        const visible = imageFiles.filter(i => !i.hidden);
        if (cfg.scope === 'pending') return visible.filter(i => !resultOf(i));
        return visible;
    }

    function unitFromImg(img) {
        const key = keyOf(img);
        return { key, dsKey: dsOfKey(key), name: img.name, handle: img.handle, url: img.url, content: img.content || '' };
    }

    async function readCaption(dir, name) {
        const base = name.substring(0, name.lastIndexOf('.'));
        try { return await (await (await dir.getFileHandle(base + '.txt')).getFile()).text(); } catch (e) { /* no txt */ }
        try {
            const j = JSON.parse(await (await (await dir.getFileHandle(base + '.json')).getFile()).text());
            return j.tags || j.caption || '';
        } catch (e) { return ''; }
    }

    /* Base images of a dataset, ready to send. Looked up in the open list first
       (current dataset), else by name in the dataset folder. */
    async function loadBases(ds, dir, only, force) {
        if (!cfg.consistency && !force) return [];
        const bases = (only || basesOf(ds)).slice(0, MAX_BASES);
        if (!bases.length) return [];
        const side = Math.min(cfg.maxSide, force ? 768 : (bases.length === 1 ? 768 : 512));
        const out = [];
        for (const b of bases) {
            try {
                let src = null;
                if (typeof imageFiles !== 'undefined') { const im = imageFiles.find(i => keyOf(i) === b.key); if (im) src = im; }
                if (!src && dir) src = { handle: await dir.getFileHandle(b.name) };
                if (!src && window.currentImagesHandle && currentDsKey() === ds) src = { handle: await window.currentImagesHandle.getFileHandle(b.name) };
                if (!src) continue;
                const im = await imageToBase64(src, side);
                out.push({ key: b.key, style: b.style, desc: b.desc || '', trigger: b.trigger || '', b64: im.b64, dataUrl: im.dataUrl });
            } catch (e) { console.warn('[Evaluator] base not found:', b.name, e); }
        }
        return out;
    }

    /* ---- 🔎 TAG CHECK ON DANBOORU / e621 ----
       The model's "add" tags are looked up on the site (same clients / cache as the
       rest of the app): exact tag -> ok; deprecated / alias -> replaced by the real tag;
       not found -> the closest real tag by search (most posts); nothing -> marked ❔. */
    const tagCheckMemo = new Map();
    function boorusFor(style) {
        const db = window.danbooruClient, e6 = window.e621Client;
        if (style === 'e621') return [e6].filter(Boolean);
        if (style === 'mixed') return [db, e6].filter(Boolean);
        if (style === 'danbooru' || style === 'hybrid') return [db].filter(Boolean);
        if (style === 'auto-tags') return [db, e6].filter(Boolean);
        return [];
    }
    async function checkOneTag(tag, clients) {
        const q = String(tag).trim().toLowerCase().replace(/\s+/g, ' ');
        const memoKey = clients.map(c => c.id).join('+') + '|' + q;
        if (tagCheckMemo.has(memoKey)) return tagCheckMemo.get(memoKey);
        let out = { orig: tag, tag, status: 'unknown', count: 0, src: '' };
        for (const c of clients) {
            try {
                const info = await c.fetchSingleTagInfo(q, false, true);
                if (info && info.count > 0 && !info.notFound) {
                    out = info.aliasTo ? { orig: tag, tag: info.aliasTo, status: 'alias', count: info.count, src: c.label } : { orig: tag, tag: q, status: 'ok', count: info.count, src: c.label };
                    break;
                }
                if (info === null) { out.status = 'error'; continue; }      // API unreachable: nothing concluded
                const alias = await c.resolveAlias(q);
                if (alias) {
                    const ai = await c.fetchSingleTagInfo(alias, false, false);
                    out = { orig: tag, tag: alias.replace(/_/g, ' '), status: 'alias', count: (ai && ai.count) || 0, src: c.label };
                    break;
                }
                // Closest real tag: search by the words of the suggestion.
                const words = q.split(' ').filter(w => w.length > 2);
                // Whole phrase first, then its most specific (longest) word.
                const longest = words.slice().sort((x, y) => y.length - x.length)[0];
                const tries = [q, ...(words.length > 1 && longest && longest.length >= 5 ? [longest] : [])];
                let best = null;
                for (const t of tries) {
                    const m = await c.searchTagMatches(t.replace(/ /g, '*'), 5);
                    (m || []).forEach(x => { if (x && x.post_count > 0 && (!best || x.post_count > best.post_count)) best = x; });
                    if (best) break;
                }
                if (best) {
                    const name = String(best.aliasTo || best.name).replace(/_/g, ' ');
                    out = { orig: tag, tag: name, status: name === q ? 'ok' : 'similar', count: best.post_count, src: c.label };
                    break;
                }
            } catch (e) { out.status = 'error'; }
        }
        if (out.status !== 'error') tagCheckMemo.set(memoKey, out);
        return out;
    }
    async function verifyTags(r, style) {
        const clients = boorusFor(style);
        if (!clients.length || !r.tagsAdd || !r.tagsAdd.length) return;
        const info = {}, final = [];
        for (const t of r.tagsAdd) {
            const c = await checkOneTag(t, clients);
            if (final.includes(c.tag)) continue;
            final.push(c.tag);
            info[c.tag] = c;
        }
        r.tagsAdd = final;
        r.tagsInfo = info;
    }

    async function evaluateUnit(u, job) {
        const image = await imageToBase64(u, cfg.maxSide);
        if (u.content == null && job.dir) u.content = await readCaption(job.dir, u.name);
        const buckets = bucketCandidates(image.real, image.framing);
        const bases = (job.bases || []).filter(b => b.key !== u.key);
        const raw = await askModel(buildPrompt(u, image.real, buckets, image.framing, bases, briefOf(u.dsKey)), image, abortCtrl.signal, bases);
        const r = parseAnswer(raw, buckets, styleNames(bases));
        // Model ignored the subject crops on a badly framed image: keep the best one as the measured advice.
        if (buckets && buckets.subject.length && (!r.bucket || r.bucket === 'current' || !r.bucketCrop) && image.framing.empty > 0.35) {
            r.autoCrop = { key: buckets.subject[0].key, crop: buckets.subject[0].crop, removed: buckets.subject[0].removed };
        }
        if (!bases.length) { r.designMatch = null; r.designDiff = ''; r.styleScores = null; r.styleNote = ''; r.styleAdjust = ''; }
        try { await verifyTags(r, effectiveStyle(u.dsKey, u.content)); } catch (e) { console.warn('[Evaluator] tag check', e); }
        r.captionAt = String(u.content || '').trim();
        results[u.key] = { ...r, framing: framingText(image.framing), baseUsed: '', basesSig: bases.length ? basesSig(basesOf(u.dsKey)) : '',
            w: image.real.w, h: image.real.h, model: cfg.model, ts: Date.now() };
        saveResults();
        if (u.dsKey === currentDsKey()) { paintBadges(); renderSummary(); }
    }

    /* ---- 📊 DATASET REVIEW ----
       When every image of a dataset has a score, the model writes an overall review
       from all the per-image results (text only, no images): overall score, summary,
       strengths, prioritized improvements and the answer to the review request. */
    function reviewSig(keys) {
        let maxTs = 0;
        keys.forEach(k => { const r = results[k]; if (r && r.ts > maxTs) maxTs = r.ts; });
        return keys.length + ':' + maxTs + ':' + basesSig(basesOf(keys.length ? dsOfKey(keys[0]) : ''));
    }
    function topCounts(arr, n) {
        const m = new Map();
        arr.forEach(x => { const k = String(x).toLowerCase().trim(); if (k) m.set(k, (m.get(k) || 0) + 1); });
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    }
    function buildDatasetPrompt(ds, keys) {
        const rs = keys.map(k => ({ name: k.split('|').pop(), r: results[k], key: k })).filter(x => x.r);
        const avg = rs.reduce((a, x) => a + x.r.score, 0) / (rs.length || 1);
        const bases = basesOf(ds);
        const verdicts = {}; rs.forEach(x => { verdicts[x.r.verdict] = (verdicts[x.r.verdict] || 0) + 1; });
        const dist = [0, 0, 0, 0]; rs.forEach(x => { dist[x.r.score >= 8 ? 3 : x.r.score >= 6 ? 2 : x.r.score >= 4 ? 1 : 0]++; });
        const L = [];
        L.push(`You are reviewing a whole TRAINING DATASET (LoRA / fine-tune) of ${rs.length} images. Every image was already reviewed one by one by a vision model; below are those results. Write the overall review of the dataset.`);
        L.push('DATASET BRIEF:\n' + (briefOf(ds).trim() || '(no brief)'));
        const cs = captionStyleOf(ds);
        L.push(`CAPTION STYLE: ${cs === 'auto' ? 'booru tags, some captions may also have a natural-language part' : CAPTION_STYLES[cs].prompt}. Tag advice must follow it${cs === 'natural' ? '' : ' and use real tag names'}.`);
        const req = requestOf(ds).trim();
        if (req) L.push('USER REVIEW REQUEST (answer it in detail in "review_answer" — concrete tips, steps, tags, what to change):\n' + req.slice(0, 2000));
        L.push(`STATS: average score ${avg.toFixed(1)}/10 · scores 8-10: ${dist[3]}, 6-7.9: ${dist[2]}, 4-5.9: ${dist[1]}, 0-3.9: ${dist[0]} · verdicts: ${Object.entries(verdicts).map(([k, v]) => k + ' ' + v).join(', ')}`);
        const iss = topCounts(rs.flatMap(x => x.r.issues || []), 12);
        if (iss.length) L.push('MOST COMMON ISSUES: ' + iss.map(([t, c]) => `${t} (${c})`).join('; '));
        const fr = rs.filter(x => x.r.framing).length;
        if (fr) L.push(`FRAMING: ${fr} image(s) have off-center subjects / lots of empty background.`);
        const bk = rs.filter(x => x.r.bucket && x.r.bucket !== 'current').length;
        if (bk) L.push(`RESOLUTION: ${bk} image(s) would fit better in another bucket resolution.`);
        const tAdd = topCounts(rs.flatMap(x => x.r.tagsAdd || []), 10), tRem = topCounts(rs.flatMap(x => x.r.tagsRemove || []), 10);
        if (tAdd.length || tRem.length) L.push(`CAPTION TAG SUGGESTIONS (number of images): add ${tAdd.map(([t, c]) => `${t} (${c})`).join(', ') || '-'} · remove ${tRem.map(([t, c]) => `${t} (${c})`).join(', ') || '-'}`);
        if (bases.length) {
            const names = styleNames(bases);
            const per = {}; names.forEach(n => per[n] = []);
            let none = 0;
            rs.forEach(x => { const c = consistencyOf(x.r, null, x.key); if (!c || c.isBase) return; if (c.pct < 50) none++; else if (per[c.style]) per[c.style].push(c.pct); });
            L.push('STYLES (the dataset deliberately has these styles, each with a base image):\n' + names.map(n => {
                const inf = styleInfo(bases, n);
                return `- ${n}${inf.trigger ? ` [trigger: ${inf.trigger}]` : ''}${inf.desc ? ` — ${inf.desc}` : ''}: ${per[n].length} image(s)${per[n].length ? `, avg match ${Math.round(per[n].reduce((a, b) => a + b, 0) / per[n].length)}%` : ''}`;
            }).join('\n') + (none ? `\n- ${none} image(s) match no style` : ''));
            const adj = [...new Set(rs.map(x => x.r.styleAdjust).filter(Boolean))].slice(0, 8);
            if (adj.length) L.push('STYLE-DEFINITION NOTES FROM THE IMAGES:\n- ' + adj.join('\n- '));
        }
        // Per-image lines: all of them when small, else the weakest + strongest.
        const sorted = rs.slice().sort((a, b) => a.r.score - b.r.score);
        const pick = sorted.length <= 60 ? sorted : [...sorted.slice(0, 40), ...sorted.slice(-15)];
        const line = x => {
            const c = bases.length ? consistencyOf(x.r, null, x.key) : null;
            return `- ${x.name}: ${x.r.score} ${x.r.verdict}${c && c.style ? ` · ${c.style} ${c.pct}%` : ''}${(x.r.issues || []).length ? ` · issues: ${x.r.issues.slice(0, 3).join(', ')}` : ''}${x.r.comment ? ` · ${x.r.comment.slice(0, 140)}` : ''}${x.r.reviewNote ? ` · request: ${x.r.reviewNote.slice(0, 140)}` : ''}`;
        };
        L.push(`PER-IMAGE RESULTS${pick.length < sorted.length ? ` (the ${pick.length} weakest / strongest of ${sorted.length})` : ''}:\n` + pick.map(line).join('\n'));
        L.push(`Answer ONLY with a JSON object, no other text:
{
  "score": <0-10: how ready this dataset is for training, as a whole (quality, consistency, variety, captions, fit with the brief)>,
  "summary": "<2-4 sentences: the overall state of the dataset>",
  "strengths": ["<what is good>", "..."],
  "improvements": ["<concrete, prioritized things to improve, most important first — name images when useful>", "..."]${req ? `,
  "review_answer": "<a detailed answer to the USER REVIEW REQUEST: concrete tips and steps>"` : ''}
}`);
        return L.join('\n\n');
    }
    async function generateDatasetReview(ds, keys, silent) {
        if (!cfg.model || reviewing.has(ds)) return;
        const scored = keys.filter(k => results[k]);
        if (!scored.length) return;
        reviewing.add(ds); paintDatasetCounter(); renderSummary();
        const prevAbort = abortCtrl;
        try {
            const raw = await askModel(buildDatasetPrompt(ds, scored), null, undefined, [], 1800);
            const m = String(raw || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').match(/\{[\s\S]*\}/);
            if (!m) throw new Error('the model did not return JSON');
            const j = JSON.parse(m[0]);
            const list = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(x => String(x).trim()).filter(Boolean).slice(0, 10);
            const avg = scored.reduce((a, k) => a + results[k].score, 0) / scored.length;
            let sc = parseFloat(j.score); if (!isFinite(sc)) sc = avg;
            dsReviews[ds] = {
                score: Math.round(Math.min(10, Math.max(0, sc)) * 10) / 10, avg: Math.round(avg * 10) / 10,
                summary: String(j.summary || '').trim().slice(0, 1200), strengths: list(j.strengths), improvements: list(j.improvements),
                reviewAnswer: String(j.review_answer || '').trim().slice(0, 3000), request: requestOf(ds).trim(),
                sig: reviewSig(keys), n: scored.length, total: keys.length, model: cfg.model, ts: Date.now()
            };
            saveDsReviews();
            if (!silent && window.showAlert) window.showAlert(`📊 Dataset review of "${datasetLabel(ds)}" ready — ${dsReviews[ds].score}/10. Hover the image counter next to "Dataset".`, 'success', 6000);
        } catch (e) {
            console.warn('[Evaluator] dataset review', e);
            if (!silent && window.showAlert) window.showAlert('Could not write the dataset review: ' + (e.message || e), 'error');
        } finally {
            abortCtrl = prevAbort;
            reviewing.delete(ds); paintDatasetCounter(); renderSummary();
        }
    }
    // After a job: if EVERY image of the dataset has a score and the review is missing / outdated -> write it.
    async function maybeReview(ds, keys) {
        if (!ds || !keys || !keys.length || !keys.every(k => results[k])) return;
        const rv = dsReviews[ds];
        if (rv && rv.sig === reviewSig(keys) && rv.request === requestOf(ds).trim()) return;
        await generateDatasetReview(ds, keys, false);
    }
    function currentDatasetKeys() {
        if (typeof imageFiles === 'undefined') return [];
        return imageFiles.filter(i => !i.hidden).map(keyOf);
    }

    /* Image counter next to "Dataset": score color once every image has a score; hover = review. */
    let counterHooked = false;
    function paintDatasetCounter() {
        const el = $('list-count');
        if (!el) return;
        if (!counterHooked) {
            counterHooked = true;
            el.addEventListener('mouseenter', ev => { if (el.classList.contains('ev-ds-scored')) showDsTip(ev); });
            el.addEventListener('mousemove', moveTip);
            el.addEventListener('mouseleave', hideTip);
        }
        const ds = currentDsKey();
        const keys = currentDatasetKeys();
        const all = enabled && cfg.showBadges && keys.length > 0 && keys.every(k => results[k]);
        el.classList.remove('ev-ds-scored', 's-good', 's-mid', 's-low', 's-bad');
        if (!all) { el.style.background = el.dataset.evBg || el.style.background; el.title = ''; return; }
        if (el.dataset.evBg === undefined) el.dataset.evBg = el.style.background || '#333';
        const rv = dsReviews[ds];
        const avg = keys.reduce((a, k) => a + results[k].score, 0) / keys.length;
        const sc = rv ? rv.score : avg;
        const cls = scoreClass(sc);
        el.style.background = ({ 's-good': '#3ddc84', 's-mid': '#ffd23f', 's-low': '#ff9f43', 's-bad': '#ff5a5a' })[cls];
        el.classList.add('ev-ds-scored', cls);
    }
    function showDsTip(ev) {
        const ds = currentDsKey();
        const keys = currentDatasetKeys();
        const rv = dsReviews[ds];
        const avg = keys.length ? keys.reduce((a, k) => a + (results[k] ? results[k].score : 0), 0) / keys.length : 0;
        const t = ensureTip();
        t.classList.add('ds');
        const outdated = rv && rv.sig !== reviewSig(keys);
        let html = `<div class="et-head"><span>📊 Dataset review</span><span>${rv ? rv.score : avg.toFixed(1)}/10</span></div>`;
        if (reviewing.has(ds)) html += `<div style="color:#b890ff;">⏳ The model is writing the dataset review…</div>`;
        if (!rv) html += `<div style="color:#888;">All ${keys.length} images are scored (avg ${avg.toFixed(1)}). ${reviewing.has(ds) ? '' : 'Open 🧐 and press 📊 Review dataset to get the overall review.'}</div>`;
        else {
            if (rv.summary) html += `<div>${esc(rv.summary)}</div>`;
            if (rv.strengths.length) html += `<div class="ds-sec"><b>✅ Strengths</b><ul>${rv.strengths.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
            if (rv.improvements.length) html += `<div class="ds-sec"><b>🔧 What to improve</b><ul>${rv.improvements.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
            if (rv.reviewAnswer) html += `<div class="ds-sec"><b>📝 Your request</b><div style="color:#f0e68c; white-space:pre-wrap;">${esc(rv.reviewAnswer)}</div></div>`;
            html += `<div class="et-meta">avg of the images ${rv.avg} · ${rv.n} images · ${esc(rv.model || '')} · ${new Date(rv.ts).toLocaleString()}${outdated ? ' · ⚠️ scores changed since — 📊 Review dataset again' : ''}</div>`;
        }
        t.innerHTML = html;
        t.style.display = 'block';
        moveTip(ev);
    }

    /* ---- dataset list ---- */
    async function rootFor(q) {
        if (tempRoots.has(q.id)) return tempRoots.get(q.id);
        if (!q.rootKey || typeof window.getHandles !== 'function') return null;
        const h = (await window.getHandles()).find(x => x.name === q.rootKey);
        return h ? h.handle : null;
    }
    async function dirFor(q) {
        let dir = await rootFor(q);
        if (!dir) throw new Error(q.rootKey ? 'saved folder not found' : 'folder not saved — open it and 💾 save it, then add it again');
        let perm = 'granted';
        try { perm = await dir.queryPermission({ mode: 'read' }); } catch (e) {}
        if (perm !== 'granted') throw new Error('no permission — press ▶ Run list again and allow access');
        for (const name of q.path || []) dir = await dir.getDirectoryHandle(name);
        return dir;
    }
    // Asks for read permission while the click is still "fresh" (browsers require a click for it).
    async function requestListPermissions() {
        for (const q of cfg.queue) {
            if (q.status === 'done') continue;
            try {
                const root = await rootFor(q);
                if (root && (await root.queryPermission({ mode: 'read' })) !== 'granted') await root.requestPermission({ mode: 'read' });
            } catch (e) { /* reported when the entry runs */ }
        }
    }
    async function prepareListJob(q) {
        const dir = await dirFor(q);
        const units = [];
        for await (const e of dir.values()) {
            if (e.kind === 'file' && IMG_RE.test(e.name)) units.push({ key: q.dsKey.split('|')[0] + '|' + dir.name + '|' + e.name, dsKey: q.dsKey, name: e.name, handle: e, content: null });
        }
        units.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
        return { kind: 'list', q, dir, dsKey: q.dsKey, label: q.label, units, i: 0, ok: 0, failed: 0, fails: 0, skipScored: cfg.skipScored, bases: null };
    }
    function nextQueueEntry() { return cfg.queue.find(q => q.status !== 'done' && q.status !== 'failed' && q.status !== 'skipped'); }

    let listJob = null;
    let listFails = 0;              // entries failing in a row (server down -> stop the list)

    async function step(job) {
        const u = job.units[job.i];
        if (job.skipScored && results[u.key]) { job.i++; if (job.q) job.q.done = job.i; return; }
        if (job.bases === null) job.bases = await loadBases(job.dsKey, job.dir);
        activeJob = job;
        abortCtrl = new AbortController();
        setProgress(job, `Evaluating ${job.i + 1}/${job.units.length}: ${u.name}`);
        try {
            await evaluateUnit(u, job);
            job.ok++; job.fails = 0;
        } catch (e) {
            if (e && e.name === 'AbortError') { return; }
            job.failed++; job.fails++;
            console.warn('[Evaluator]', u.name, e);
            job.lastError = e.message || String(e);
            setProgress(job, `⚠️ ${u.name}: ${job.lastError}`);
            if (job.fails >= 3) job.broken = true;
        } finally { abortCtrl = null; activeJob = null; }
        job.i++;
        if (job.q) { job.q.done = job.i; job.q.ok = job.ok; job.q.failed = job.failed; saveQueueSoon(); renderQueue(); }
    }

    let qSaveTimer = null;
    function saveQueueSoon() { clearTimeout(qSaveTimer); qSaveTimer = setTimeout(saveCfg, 800); }

    async function worker() {
        if (workerBusy) return;
        workerBusy = true;
        try {
            while (true) {
                if (manualJob) {
                    const j = manualJob;
                    if (!j.cancel && !j.broken && j.i < j.units.length) { await step(j); continue; }
                    finishManual(j);
                    if (!j.cancel && !j.broken) await maybeReview(j.dsKey, j.dsKey === currentDsKey() ? currentDatasetKeys() : j.allKeys);
                    continue;
                }
                if (listRunning && !listCancel) {
                    if (!listJob) {
                        const q = nextQueueEntry();
                        if (!q) { finishList(true); break; }
                        q.status = 'running'; q.ts = Date.now(); renderQueue();
                        try { listJob = await prepareListJob(q); q.total = listJob.units.length; q.done = 0; q.ok = 0; q.failed = 0; q.error = ''; }
                        catch (e) { q.status = 'failed'; q.error = e.message || String(e); listJob = null; saveCfg(); renderQueue(); if (++listFails >= 3) { finishList(false, 'Dataset list stopped: 3 datasets failed in a row. ' + q.error); break; } continue; }
                    }
                    const j = listJob;
                    if (!j.broken && j.i < j.units.length) { await step(j); continue; }
                    j.q.status = j.broken ? 'failed' : 'done';
                    j.q.error = j.broken ? (j.lastError || 'failed') : '';
                    listFails = j.broken ? listFails + 1 : 0;
                    listJob = null; saveCfg(); renderQueue();
                    if (!j.broken && !listCancel) await maybeReview(j.dsKey, j.units.map(u => u.key));
                    if (listFails >= 3) { finishList(false, 'Dataset list stopped: 3 datasets failed in a row. Check the server / model.'); break; }
                    continue;
                }
                break;
            }
        } finally {
            workerBusy = false;
            if (listCancel && listJob) { listJob.q.status = 'paused'; listJob = null; saveCfg(); }
            listCancel = false;
            syncRunButton(); renderQueue(); setIdleButton();
        }
    }

    function finishManual(j) {
        manualJob = null;
        const stopped = j.cancel;
        const msg = `${stopped ? 'Stopped' : (j.broken ? 'Stopped (errors)' : 'Done')}. ${j.ok} evaluated${j.failed ? `, ${j.failed} failed` : ''}.`;
        setProgress(null, msg);
        if (j.broken && window.showAlert) window.showAlert('Evaluator stopped: 3 failures in a row. Check the URL / model (must support images) / CORS. ' + (j.lastError || ''), 'error', 8000);
        else if (j.ok && window.showAlert && !j.silent && !(j.single && j.units.length === 1)) window.showAlert(`Evaluator: ${j.ok} image(s) scored${j.dsKey !== currentDsKey() ? ` in "${j.label}"` : ''}. Hover a score on the list to read the comment.`, 'success');
        syncRunButton();
    }
    function finishList(completed, err) {
        listRunning = false;
        if (err) { window.showAlert && window.showAlert(err, 'error', 8000); setProgress(null, err); }
        else if (completed) {
            const n = cfg.queue.filter(q => q.status === 'done').length, f = cfg.queue.filter(q => q.status === 'failed').length;
            setProgress(null, `📋 Dataset list finished: ${n} done${f ? `, ${f} failed` : ''}.`);
            window.showAlert && window.showAlert(`📋 Dataset list finished: ${n} dataset(s) evaluated${f ? `, ${f} failed` : ''}.`, f ? 'warn' : 'success', 6000);
        }
        saveCfg();
    }

    /* 🧐 on an image without a score: evaluate only that one. Joins the running
       current-dataset job if there is one, else starts a small job (priority over the list). */
    function isQueued(img) {
        if (!manualJob) return false;
        const k = keyOf(img);
        return manualJob.units.some((u, i) => i >= manualJob.i && u.key === k) || (activeJob === manualJob && manualJob.units[manualJob.i] && manualJob.units[manualJob.i].key === k);
    }
    function evaluateOne(img) {
        if (!cfg.model) { window.showAlert && window.showAlert('Pick a vision model in 🧐 first.', 'warn'); openPanel(); return; }
        if (isQueued(img)) return;
        const u = unitFromImg(img);
        hideTip();
        if (manualJob && !manualJob.cancel && manualJob.dsKey === u.dsKey) {
            manualJob.units.push(u);
        } else if (manualJob) {
            window.showAlert && window.showAlert('Another dataset is being evaluated — wait for it or stop it in 🧐.', 'info');
            return;
        } else {
            manualJob = { kind: 'manual', dsKey: u.dsKey, label: datasetLabel(u.dsKey), units: [u], allKeys: currentDatasetKeys(), i: 0, ok: 0, failed: 0, fails: 0, skipScored: false, bases: null, dir: window.currentImagesHandle || null, single: true };
        }
        syncRunButton();
        paintBadges();
        worker();
    }

    function startManual() {
        readForm();
        if (!cfg.model) { window.showAlert && window.showAlert('Pick a vision model first (🔄 loads the list).', 'warn'); return; }
        const imgs = targetImages();
        if (imgs.length === 0) {
            window.showAlert && window.showAlert(cfg.scope === 'selected' ? 'Select at least one image (or change the scope).' : 'No images to evaluate.', 'warn');
            return;
        }
        const ds = currentDsKey();
        manualJob = { kind: 'manual', dsKey: ds, label: datasetLabel(ds), units: imgs.map(unitFromImg), allKeys: currentDatasetKeys(), i: 0, ok: 0, failed: 0, fails: 0, skipScored: false, bases: null, dir: window.currentImagesHandle || null };
        syncRunButton();
        // Runs in the background: the panel closes (progress stays on 🧐; clicking it reopens).
        window.closeModal('modal-evaluator');
        worker();
    }
    function stopManual(silent) {
        if (!manualJob) return;
        manualJob.cancel = true;
        manualJob.silent = !!silent;
        if (activeJob === manualJob && abortCtrl) try { abortCtrl.abort(); } catch (e) {}
        syncRunButton();
    }

    async function startList() {
        readForm();
        if (!cfg.model) { window.showAlert && window.showAlert('Pick a vision model first (🔄 loads the list).', 'warn'); return; }
        if (!cfg.queue.length) return;
        if (cfg.queue.every(q => q.status === 'done' || q.status === 'failed')) cfg.queue.forEach(q => { q.status = 'pending'; q.done = 0; q.error = ''; });
        cfg.queue.forEach(q => { if (q.status === 'failed' || q.status === 'paused') { q.status = 'pending'; q.error = ''; } });
        await requestListPermissions();
        listRunning = true; listCancel = false; listFails = 0;
        saveCfg(); syncRunButton(); renderQueue();
        window.closeModal('modal-evaluator');
        worker();
    }
    function stopList() {
        if (!listRunning) return;
        listRunning = false; listCancel = true;
        if (listJob && activeJob === listJob && abortCtrl) try { abortCtrl.abort(); } catch (e) {}
        if (!workerBusy && listJob) { listJob.q.status = 'paused'; listJob = null; }
        syncRunButton(); renderQueue();
    }

    function datasetLabel(ds) {
        const q = cfg.queue.find(x => x.dsKey === ds);
        if (q) return q.label;
        const [root, dir] = String(ds).split('|');
        return root === dir ? root : root + ' / ' + dir;
    }

    function setProgress(job, text) {
        const p = $('ev-progress'), f = $('ev-progress-fill');
        const where = job ? (job.kind === 'list' ? `📋 ${job.label} — ` : (job.dsKey !== currentDsKey() ? `${job.label} — ` : '')) : '';
        if (p) p.textContent = where + (text || '');
        if (f) f.style.width = job && job.units.length ? (100 * job.i / job.units.length).toFixed(1) + '%' : '0';
        const btn = $('btn-evaluator');
        if (btn && job) {
            btn.classList.add('running');
            btn.textContent = `🧐 ${job.kind === 'list' ? '📋 ' : ''}${job.i}/${job.units.length}`;
            btn.title = `${job.kind === 'list' ? 'Dataset list' : 'Evaluating'}: ${job.label} — click to open the panel`;
        }
    }
    function setIdleButton() {
        const btn = $('btn-evaluator');
        if (!btn || workerBusy) return;
        btn.classList.remove('running');
        btn.textContent = '🧐';
        btn.title = 'Evaluate dataset — a vision model scores each image (0–10) against your brief. Second opinion only.';
    }

    function syncRunButton() {
        const b = $('btn-ev-run');
        if (b) {
            b.classList.toggle('stop', !!manualJob);
            b.textContent = manualJob ? '⏹ Stop' : '🧐 Evaluate';
            b.title = manualJob ? `Stop evaluating "${manualJob.label}"` : 'Evaluate the dataset you are looking at (has priority over the list)';
        }
        const l = $('btn-ev-list');
        if (l) {
            l.style.display = cfg.queue.length ? '' : 'none';
            l.classList.toggle('stop', listRunning);
            l.textContent = listRunning ? '⏹ Stop list' : '▶ Run list';
        }
    }

    /* ---------- SUMMARY ---------- */
    /* 🎨 Styles box: images per style, avg match, images that fit no style, and a
       SEPARATE list of style suggestions (balance, trigger tags, mixed images). */
    function styleSummary(ds, bases, visible) {
        const names = styleNames(bases);
        const per = {}; names.forEach(n => { per[n] = { n: 0, sum: 0, mixed: 0, noTrig: 0, wrongTrig: 0, bases: bases.filter(b => b.style === n).length }; });
        let none = 0, pending = 0, byTraits = 0;
        const tagAgg = {};          // style -> { add: Map, rem: Map }
        const adjusts = {};         // style -> [text]
        visible.forEach(img => {
            const r0 = resultOf(img);
            const c = consistencyOf(r0, img);
            if (!c) { pending++; return; }
            const style = c.isBase ? c.baseStyle : c.style;
            if (!per[style]) return;
            if (!c.isBase && c.pct >= 50) {
                const tc = tagChanges(img, r0, c);
                const ag = tagAgg[style] || (tagAgg[style] = { add: new Map(), rem: new Map() });
                tc.add.forEach(t => ag.add.set(t, (ag.add.get(t) || 0) + 1));
                tc.remove.forEach(t => ag.rem.set(t, (ag.rem.get(t) || 0) + 1));
                if (r0.styleAdjust && c.mode === 'styles') (adjusts[style] = adjusts[style] || []).push(r0.styleAdjust);
            }
            if (!c.isBase) {
                if (c.pct < 50) { none++; return; }
                if (c.mode === 'base-traits' || c.partial) byTraits++;
                per[style].sum += c.pct;
                const sorted = Object.values(c.scores || {}).sort((x, y) => y - x);
                if (sorted.length > 1 && sorted[1] >= 60 && sorted[0] - sorted[1] < 15) per[style].mixed++;
            }
            per[style].n++;
            const t = triggerCheck(img, c);
            if (t && t.missing.length) per[style].noTrig++;
            if (t && t.wrong.length) per[style].wrongTrig++;
        });
        const rows = names.map(n => {
            const p = per[n], evald = p.n - p.bases;
            const inf = styleInfo(bases, n);
            return `<br>🎨 <b>${esc(n)}</b>${inf.trigger ? ` <span class="et-trigtag">${esc(inf.trigger)}</span>` : ''}: ${p.n} image(s)${evald > 0 ? ` · avg match ${Math.round(p.sum / evald)}%` : ''}${inf.desc ? `<br><span style="color:#8a7aa8;">&nbsp;&nbsp;&nbsp;${esc(inf.desc)}</span>` : ''}`;
        }).join('');
        // Style suggestions (computed, not the model's opinion).
        const tips = [];
        if (names.length > 1) {
            const counts = names.map(n => per[n].n), max = Math.max(...counts);
            names.forEach(n => {
                if (max >= 4 && per[n].n < max * 0.5) tips.push(`<b>${esc(n)}</b> has ${per[n].n} image(s) vs ${max} in the biggest style — add about ${Math.ceil(max * 0.7) - per[n].n} more (or use fewer of the others / repeat it more in training), otherwise it is learned weakly.`);
            });
            const noTrigger = names.filter(n => !bases.some(b => b.style === n && String(b.trigger || '').trim()));
            if (noTrigger.length) tips.push(`Give each style its own trigger tag (next to the base, or ✨ to get a suggestion) so you can call it in prompts — missing for: ${esc(noTrigger.join(', '))}.`);
            const noDesc = names.filter(n => !styleInfo(bases, n).desc);
            if (noDesc.length) tips.push(`Describe each style in a few words (✨ suggests one) — the model compares better when it knows what the style is: ${esc(noDesc.join(', '))}.`);
        }
        names.forEach(n => {
            if (per[n].noTrig) tips.push(`${per[n].noTrig} image(s) of <b>${esc(n)}</b> are missing its trigger tag in the caption.`);
            if (per[n].wrongTrig) tips.push(`${per[n].wrongTrig} image(s) of <b>${esc(n)}</b> have the trigger tag of another style.`);
            if (per[n].mixed) tips.push(`${per[n].mixed} image(s) in <b>${esc(n)}</b> look almost as close to another style — mixed images blur the styles; keep them out or tag them carefully.`);
        });
        // Tag changes repeated in the style (2+ images) = a style-level fix.
        names.forEach(n => {
            const ag = tagAgg[n];
            if (!ag) return;
            const top = m => [...m.entries()].filter(([, k]) => k >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, k]) => `${esc(t)} (${k})`);
            const add = top(ag.add), rem = top(ag.rem);
            if (add.length || rem.length) tips.push(`🏷️ <b>${esc(n)}</b> captions: ${add.length ? `add <span style="color:#7fe0b0;">${add.join(', ')}</span>` : ''}${add.length && rem.length ? ' · ' : ''}${rem.length ? `remove <span style="color:#ffaaaa;">${rem.join(', ')}</span>` : ''} <span style="color:#777;">(number of images)</span>`);
        });
        // Style-definition advice from the model (most recent first, deduplicated).
        names.forEach(n => {
            const a = [...new Set((adjusts[n] || []).reverse())].slice(0, 2);
            if (a.length) tips.push(`🛠️ <b>${esc(n)}</b> definition: ${a.map(esc).join(' / ')}`);
        });
        if (none) tips.push(`${none} image(s) match no base well (< 50%) — off-style, or a style without a base (add one).`);
        if (byTraits) tips.push(`${byTraits} image(s) were compared only by traits — evaluate them again for a visual comparison with the bases.`);
        return `<div class="ev-cons-box">📌 <b>${bases.length} base(s)</b>, ${names.length} style(s)${rows}` +
            (none ? `<br><span style="color:#ff9f43;">❔ ${none} image(s) match no style</span>` : '') +
            (pending ? `<br><span style="color:#777;">${pending} scored image(s) without style data yet.</span>` : '') + `</div>` +
            (tips.length ? `<div class="ev-cons-box ev-style-tips">💡 <b>Style suggestions</b><br>• ${tips.join('<br>• ')}</div>` : '');
    }

    function renderSummary() {
        const box = $('ev-summary');
        if (!box || typeof imageFiles === 'undefined') return;
        const rs = imageFiles.filter(i => !i.hidden).map(resultOf).filter(Boolean);
        if (!rs.length) { box.innerHTML = '<span>No scores yet for this dataset.</span>'; return; }
        const avg = rs.reduce((a, r) => a + r.score, 0) / rs.length;
        const count = {};
        rs.forEach(r => { count[r.verdict] = (count[r.verdict] || 0) + 1; });
        computeConsensus();
        let consHtml = '';
        const visible = imageFiles.filter(i => !i.hidden && resultOf(i));
        const ds = currentDsKey();
        const bases = basesOf(ds);
        if (cfg.consistency && bases.length) consHtml = styleSummary(ds, bases, visible);
        else if (consensus.traits.length >= 2) {
            const pcts = visible.map(i => consistencyOf(resultOf(i), i)).filter(Boolean).map(c => c.pct);
            const low = pcts.filter(p => p < 60).length;
            consHtml = `<div class="ev-cons-box">🧬 <b>Common design</b> (${consensus.n} images): ${esc(consensus.traits.slice(0, 10).join(', '))}` +
                `<br>avg consistency ${Math.round(pcts.reduce((a, b) => a + b, 0) / (pcts.length || 1))}%${low ? ` · <span style="color:#ff9f43;">${low} image(s) below 60%</span>` : ''}</div>`;
        } else if (cfg.consistency) {
            consHtml = `<div class="ev-cons-box" style="color:#666;">🧬 Add 📌 base images (one per style) to compare every image with them (or score 3+ images to compare with the common design).</div>`;
        }
        const dsk = currentDsKey(), rv = dsReviews[dsk], allK = currentDatasetKeys();
        const allScored = allK.length && allK.every(k => results[k]);
        consHtml += `<div class="ev-cons-box ev-ds-box">📊 <b>Dataset review</b>: ${reviewing.has(dsk) ? '⏳ writing…' : (rv ? `<b>${rv.score}/10</b> — ${esc(rv.summary.slice(0, 160))}${rv.summary.length > 160 ? '…' : ''}${rv.sig !== reviewSig(allK) ? ' <span style="color:#ff9f43;">(outdated)</span>' : ''}` : (allScored ? 'not written yet.' : `written automatically when all ${allK.length} images have a score (${rs.length} now) — or press the button.`))}
            <button class="ev-btn-mini" id="ev-ds-review" style="margin-left:6px;" ${reviewing.has(dsk) || workerBusy ? 'disabled' : ''} title="The model reads all the scores / comments of this dataset and writes the overall review (hover the image counter next to 'Dataset' to read it)">📊 Review dataset</button></div>`;
        box.innerHTML = `<span>${rs.length} scored · avg ${avg.toFixed(1)}</span>` +
            Object.keys(VERDICTS).filter(k => count[k]).map(k => `<span>${VERDICTS[k].icon} ${VERDICTS[k].label}: ${count[k]}</span>`).join('') + consHtml;
        const rb = $('ev-ds-review');
        if (rb) rb.onclick = () => {
            readForm();
            if (!cfg.model) { window.showAlert && window.showAlert('Pick a vision model first (🔄 loads the list).', 'warn'); return; }
            generateDatasetReview(currentDsKey(), currentDatasetKeys(), false);
        };
    }

    /* ---------- PANEL ---------- */
    function buildModal() {
        if ($('modal-evaluator')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-evaluator';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-evaluator');
        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🧐 Evaluate Dataset <span class="ev-help" tabindex="0">?<span class="ev-help-text">Accuracy depends on the <b>image size sent</b> and on the <b>vision model</b> used. Small images hide fine details (hands, artifacts, watermarks); small / quantized models miss more and vary more between runs. Framing, empty space and bucket math are measured exactly — the score, comments, traits and consistency are the model's opinion.</span></span></span>
                    <button onclick="window.closeModal('modal-evaluator')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div class="ev-small">A vision model gives each image a 0–10 score and a short opinion based on your brief. It is only a second opinion — nothing is changed or removed. Hover a score on the list to read it.</div>

                <div class="ev-row"><span class="ev-lbl">Backend</span>
                    <select id="ev-backend">
                        <option value="ollama">Ollama</option>
                        <option value="openai">OpenAI-compatible (LM Studio, koboldcpp, llama.cpp…)</option>
                    </select>
                </div>
                <div class="ev-row"><span class="ev-lbl">Server URL</span><input type="text" id="ev-url" spellcheck="false"></div>
                <div class="ev-row" id="ev-key-row"><span class="ev-lbl">API key</span><input type="password" id="ev-key" placeholder="optional" autocomplete="off"></div>
                <div class="ev-row"><span class="ev-lbl">Vision model</span>
                    <select id="ev-model"><option value="">(click 🔄)</option></select>
                    <button class="ev-btn-mini" id="ev-refresh" title="Load the model list from the server">🔄</button>
                </div>
                <div class="ev-small" id="ev-model-status"></div>
                <div class="ev-row"><span class="ev-lbl">Caption style</span>
                    <select id="ev-capstyle" title="How this dataset is captioned — the suggestions follow it, and tags are checked on Danbooru / e621">
                        ${Object.entries(CAPTION_STYLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
                    </select>
                    <span class="ev-small" style="flex:0 0 auto;">this dataset</span>
                </div>

                <div>
                    <div class="ev-row" style="margin-bottom:4px;"><span class="ev-lbl">Dataset brief</span><span class="ev-small" id="ev-brief-note" style="flex:1;"></span></div>
                    <textarea id="ev-brief" placeholder="Describe exactly what this dataset is for. E.g.: Character LoRA of 'Aria' (silver hair, red eyes, black coat). Anime style, solo only. I want variety of poses and angles, full body and portraits. No text, watermarks, other characters or chibi. Target SDXL buckets."></textarea>
                </div>

                <div class="ev-section collapsed" id="ev-req-box">
                    <div class="ev-section-head" data-toggle="ev-req-box"><span class="ev-caret">▸</span> 📝 Review request <span class="ev-small ev-sec-info" id="ev-req-info" style="font-weight:normal;"></span></div>
                    <div class="ev-sec-body">
                        <textarea id="ev-request" spellcheck="false" placeholder="Optional — what do you want help with in this dataset? E.g.: I want a specific review of the style. How do I separate the coloring from the line art? I want the LoRA to learn style and color separately — which tags should I use? Empty = ignored."></textarea>
                        <div class="ev-small">Saved for this dataset. Each image gets a short 📝 answer in its tooltip, and the 📊 dataset review (hover the image counter next to "Dataset") answers it in full.</div>
                    </div>
                </div>
                <div class="ev-row"><span class="ev-lbl">Images</span>
                    <select id="ev-scope">
                        <option value="selected">Selected images</option>
                        <option value="visible">All visible images (current filter)</option>
                        <option value="pending">Visible images not scored yet</option>
                    </select>
                </div>
                <div class="ev-row"><span class="ev-lbl">Image size sent</span>
                    <select id="ev-size-preset" title="Longest side of the image sent to the model. Bigger = more detail, slower.">
                        <option value="sd">SD — 512px (fastest)</option>
                        <option value="sdxl">SDXL — 1024px</option>
                        <option value="hd">HD — 1536px (most detail, slowest)</option>
                        <option value="custom">Custom…</option>
                    </select>
                </div>
                <div class="ev-row" id="ev-maxside-row"><span class="ev-lbl"></span>
                    <input type="range" id="ev-maxside" min="256" max="2048" step="64"><span class="ev-val" id="ev-maxside-val"></span>
                </div>
                <div class="ev-row"><span class="ev-lbl">Temperature</span>
                    <input type="range" id="ev-temp" min="0" max="100" step="5"><span class="ev-val" id="ev-temp-val"></span>
                </div>
                <div class="ev-row"><label title="Only for 🧐 Evaluate (the dataset you are looking at). The 📋 dataset list always keeps running."><input type="checkbox" id="ev-keep"> Keep evaluating in the background when I open another dataset <span style="color:#777;">(off = switching stops it)</span></label></div>
                <div class="ev-row"><label><input type="checkbox" id="ev-caption"> Send the caption / tags too (model can point out wrong tags)</label></div>
                <div class="ev-row"><label><input type="checkbox" id="ev-res"> Tell the model the real resolution</label></div>
                <div class="ev-row"><label title="Uses the model chosen in the 🪣 Bucket popout (SD / SDXL / HD)"><input type="checkbox" id="ev-bucket"> Suggest the best bucket resolution for each image (SD / SDXL / HD from 🪣)</label></div>
                <div class="ev-row"><label><input type="checkbox" id="ev-badges"> Show score badges on the list</label>
                    <button class="ev-btn-mini" id="ev-fields-btn" style="margin-left:auto;" title="Choose what the score tooltip shows">🧩 Score details…</button>
                </div>
                <div class="ev-section collapsed" id="ev-bases-box">
                    <div class="ev-section-head" data-toggle="ev-bases-box"><span class="ev-caret">▸</span> 📌 Base images <span class="ev-small ev-sec-info" id="ev-bases-info" style="font-weight:normal;"></span></div>
                    <div class="ev-sec-body">
                    <div class="ev-row"><span class="ev-small" style="flex:1;">This dataset · one per style · max ${MAX_BASES}. Without bases, images are compared with the common design.</span>
                        <button class="ev-btn-mini" id="ev-base-add" title="Click the images in the list to mark / unmark them as bases, then Confirm">📌 Pick bases</button>
                    </div>
                    <div id="ev-bases-list"></div>
                    <div class="ev-small">Same style name = same style. The description and trigger tag are sent with the base so the model knows exactly which style it is; the trigger is also checked in each caption. ✨ asks the model to suggest both.</div>
                    </div>
                </div>
                <div class="ev-subpop" id="ev-fields-pop">
                    <div class="ev-subpop-head"><span>🧩 Show in the score tooltip</span><button class="ev-subpop-x" id="ev-fields-x">&times;</button></div>
                    <label><input type="checkbox" data-f="comment"> 💬 Comment</label>
                    <label><input type="checkbox" data-f="issues"> 🏷️ Issues</label>
                    <label><input type="checkbox" data-f="suggestion"> 💡 Suggestion</label>
                    <label><input type="checkbox" data-f="consistency"> 🎨 Style / design match with the 📌 bases</label>
                    <label><input type="checkbox" data-f="styleNote"> 🎨 Style suggestion + 🛠️ style adjustment</label>
                    <label><input type="checkbox" data-f="tags"> 🏷️ Tag changes (add / remove)</label>
                    <label><input type="checkbox" data-f="review"> 📝 Answer to your review request</label>
                    <label><input type="checkbox" data-f="framing"> 🧭 Framing (off-center / empty space)</label>
                    <label><input type="checkbox" data-f="crop"> ✂️ Measured crop</label>
                    <label><input type="checkbox" data-f="hint"> 🖱️ "Click to open in Bucket" hint</label>
                    <label><input type="checkbox" data-f="meta"> 🕒 Model · resolution · date</label>
                </div>

                <div class="ev-section collapsed" id="ev-queue-box">
                    <div class="ev-section-head" data-toggle="ev-queue-box"><span class="ev-caret">▸</span> 📋 Dataset list <span class="ev-small ev-sec-info" id="ev-queue-info" style="font-weight:normal;"></span></div>
                    <div class="ev-sec-body">
                    <div class="ev-row"><span class="ev-small" style="flex:1;">Evaluated in the background, one after the other — switching datasets does not affect it.</span>
                        <button class="ev-btn-mini" id="ev-q-add" title="Add the dataset you are looking at (folder / subfolder) to the list">➕ Add this dataset</button>
                    </div>
                    <div id="ev-q-list"></div>
                    <div class="ev-row"><label title="Images that already have a score are skipped, so a stopped list continues where it was"><input type="checkbox" id="ev-skip"> Skip images already scored</label>
                        <button class="ev-btn-mini" id="ev-q-clear" style="margin-left:auto;" title="Remove the finished datasets from the list">🧹 Remove finished</button>
                    </div>
                    <div class="ev-small">Uses this panel's model and settings; each dataset uses its OWN brief and bases.</div>
                    </div>
                </div>

                <div id="ev-progress-bar"><div id="ev-progress-fill"></div></div>
                <div id="ev-progress"></div>
                <div id="ev-summary"></div>

                <div class="modal-buttons">
                    <button id="btn-ev-clear" title="Remove the scores of the images in the chosen scope">🧹 Clear scores</button>
                    <button class="btn-cancel" onclick="window.closeModal('modal-evaluator')">Close</button>
                    <button id="btn-ev-list" style="display:none;">▶ Run list</button>
                    <button id="btn-ev-run">🧐 Evaluate</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        $('ev-backend').onchange = () => { readForm(); fillForm(); refreshModels(true); };
        $('ev-refresh').onclick = () => refreshModels(false);
        $('ev-maxside').oninput = () => { $('ev-maxside-val').textContent = $('ev-maxside').value + 'px'; };
        $('ev-size-preset').onchange = () => {
            const v = $('ev-size-preset').value;
            if (SIZE_PRESETS[v]) { $('ev-maxside').value = SIZE_PRESETS[v]; $('ev-maxside-val').textContent = SIZE_PRESETS[v] + 'px'; }
            $('ev-maxside-row').style.display = v === 'custom' ? '' : 'none';
            readForm(); saveCfg();
        };
        $('ev-temp').oninput = () => { $('ev-temp-val').textContent = (parseInt($('ev-temp').value, 10) / 100).toFixed(2); };
        ['ev-url', 'ev-key', 'ev-model', 'ev-scope', 'ev-maxside', 'ev-temp', 'ev-caption', 'ev-res', 'ev-bucket'].forEach(id => {
            $(id).addEventListener('change', () => { readForm(); saveCfg(); });
        });
        $('ev-badges').onchange = () => { readForm(); saveCfg(); paintBadges(); };
        $('ev-brief').addEventListener('change', () => { readForm(); saveCfg(); syncBriefNote(); });
        $('ev-request').addEventListener('change', () => { readForm(); saveCfg(); syncReqInfo(); });
        $('ev-capstyle').addEventListener('change', () => { const ds = $('ev-capstyle').dataset.ds; if (ds) { dsData(ds).captionStyle = $('ev-capstyle').value; saveCfg(); } });
        $('ev-keep').onchange = () => { readForm(); saveCfg(); };
        $('ev-skip').onchange = () => { readForm(); saveCfg(); };
        $('ev-base-add').onclick = () => startBasePick();
        overlay.querySelectorAll('[data-toggle]').forEach(h => h.onclick = () => setCollapsed(h.dataset.toggle, !$(h.dataset.toggle).classList.contains('collapsed')));
        $('ev-q-add').onclick = () => addCurrentToQueue();
        $('ev-q-clear').onclick = () => { cfg.queue = cfg.queue.filter(q => q.status !== 'done'); saveCfg(); renderQueue(); syncRunButton(); };
        $('btn-ev-list').onclick = () => { if (listRunning) stopList(); else startList(); };
        const pop = $('ev-fields-pop');
        $('ev-fields-btn').onclick = (e) => {
            e.stopPropagation(); syncFieldsPop();
            const btn = $('ev-fields-btn');
            pop.classList.toggle('open');
            // Opens right ABOVE the button (below it would be cut by the panel's bottom edge).
            if (pop.classList.contains('open')) pop.style.top = Math.max(8, btn.offsetTop - pop.offsetHeight - 6) + 'px';
        };
        $('ev-fields-x').onclick = () => pop.classList.remove('open');
        pop.addEventListener('click', e => e.stopPropagation());
        overlay.querySelector('.tool-modal').addEventListener('click', () => pop.classList.remove('open'));
        pop.querySelectorAll('input[data-f]').forEach(cb => cb.addEventListener('change', () => {
            cfg.tipFields = { ...cfg.tipFields, [cb.dataset.f]: cb.checked };
            saveCfg();
        }));
        $('btn-ev-run').onclick = () => { if (manualJob) stopManual(); else startManual(); };
        $('btn-ev-clear').onclick = () => {
            readForm();
            const imgs = cfg.scope === 'pending' ? [] : targetImages();
            const n = imgs.filter(i => resultOf(i)).length;
            if (!n) { window.showAlert && window.showAlert('No scores to clear in this scope.', 'info'); return; }
            if (!confirm(`Clear the scores of ${n} image(s)?`)) return;
            imgs.forEach(i => { delete results[keyOf(i)]; });
            saveResults(); paintBadges(); renderSummary();
        };
    }

    function setCollapsed(id, on) {
        const box = $(id);
        if (!box) return;
        box.classList.toggle('collapsed', on);
        const c = box.querySelector('.ev-caret');
        if (c) c.textContent = on ? '▸' : '▾';
    }
    function queueBusy() { return listRunning || cfg.queue.some(q => q.status === 'pending' || q.status === 'running' || q.status === 'paused'); }

    /* ---------- BASES (per dataset) ---------- */
    function syncBaseRow() {
        const box = $('ev-bases-box');
        if (!box) return;
        const ds = currentDsKey();
        const list = $('ev-bases-list');
        const bases = basesOf(ds);
        $('ev-base-add').disabled = !ds;
        const nS = styleNames(bases).length;
        $('ev-bases-info').textContent = bases.length ? `(${bases.length} base${bases.length > 1 ? 's' : ''} · ${nS} style${nS > 1 ? 's' : ''})` : '(none — common design)';
        if (!ds) { list.innerHTML = '<div class="ev-small">Open a dataset first.</div>'; return; }
        if (!bases.length) { list.innerHTML = '<div class="ev-small" style="color:#666;">No base — images are compared with the common design of the dataset. Select image(s) and press 📌 Add selected.</div>'; return; }
        list.innerHTML = bases.map((b, i) => {
            const img = typeof imageFiles !== 'undefined' ? imageFiles.find(x => keyOf(x) === b.key) : null;
            const thumb = img && img.url ? `<img src="${esc(img.url)}" alt="">` : '<span class="ev-noimg">?</span>';
            return `<div class="ev-base-item" data-i="${i}">${thumb}
                <div class="ev-bcol">
                    <div class="ev-brow">
                        <span class="ev-bname" title="${esc(b.name)}">${esc(b.name)}${img ? '' : ' <span style="color:#ff8080;">(not found)</span>'}</span>
                        <input type="text" class="ev-b-style" value="${esc(b.style)}" title="Style name (same name = same style)" spellcheck="false">
                        <input type="text" class="ev-b-trig" value="${esc(b.trigger || '')}" placeholder="trigger tag" title="Trigger tag of this style — sent to the model and checked in each caption" spellcheck="false">
                        <button class="ev-btn-mini ev-b-auto" title="Ask the vision model to describe this style and suggest a trigger tag (fills only empty fields — Shift+click replaces both)">✨</button>
                        <button class="ev-x" title="Remove this base">✕</button>
                    </div>
                    <input type="text" class="ev-b-desc" value="${esc(b.desc || '')}" placeholder="Short style description — e.g. thick black line art, flat cel shading, pastel palette" title="Sent to the model with the base so it knows exactly which style this is" spellcheck="false">
                </div></div>`;
        }).join('');
        list.querySelectorAll('.ev-base-item').forEach(row => {
            const i = +row.dataset.i;
            row.querySelector('.ev-b-style').addEventListener('change', e => { const v = e.target.value.trim(); if (v) bases[i].style = v.slice(0, 30); else e.target.value = bases[i].style; saveCfg(); paintBadges(); renderSummary(); });
            row.querySelector('.ev-b-trig').addEventListener('change', e => { bases[i].trigger = e.target.value.trim().slice(0, 60); saveCfg(); renderSummary(); });
            row.querySelector('.ev-b-desc').addEventListener('change', e => { bases[i].desc = e.target.value.trim().slice(0, 200); saveCfg(); renderSummary(); });
            row.querySelector('.ev-b-auto').onclick = ev => describeBase(bases[i], ev.shiftKey, ev.currentTarget);
            row.querySelector('.ev-x').onclick = () => { bases.splice(i, 1); saveCfg(); syncBaseRow(); paintBadges(); renderSummary(); };
        });
    }
    /* ---------- 📌 PICK MODE ----------
       The panel closes, the rest of the app fades, and every click on an image of the
       list marks / unmarks it as a base (highlighted, with its style letter).
       A card in the middle of the screen has Confirm / Cancel (Esc = cancel). */
    let pick = null;            // { ds, keys: [] (order = style order) }
    function startBasePick() {
        const ds = currentDsKey();
        if (!ds || typeof imageFiles === 'undefined' || !imageFiles.length) { window.showAlert && window.showAlert('Open a dataset first.', 'warn'); return; }
        readForm(); saveCfg();
        const present = new Set(imageFiles.map(keyOf));
        pick = { ds, keys: basesOf(ds).map(b => b.key).filter(k => present.has(k)) };
        window.closeModal('modal-evaluator');
        document.body.classList.add('ev-picking');
        let bar = $('ev-pick-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'ev-pick-bar';
            bar.innerHTML = `<div class="ev-pick-title">📌 Pick the base images</div>
                <div class="ev-pick-help">Click the images in the list to mark / unmark them — one per style (max ${MAX_BASES}). Style names and descriptions are set in the panel after.</div>
                <div class="ev-pick-count" id="ev-pick-count"></div>
                <div class="ev-pick-btns"><button id="ev-pick-cancel">✕ Cancel</button><button id="ev-pick-ok">✔ Confirm</button></div>`;
            document.body.appendChild(bar);
            $('ev-pick-cancel').onclick = () => endBasePick(false);
            $('ev-pick-ok').onclick = () => endBasePick(true);
        }
        bar.style.display = '';
        paintPick();
    }
    // Style name per marked image: existing bases keep theirs, new ones take the next free name.
    function pickNames() {
        const old = basesOf(pick.ds);
        const kept = pick.keys.map(k => old.find(b => b.key === k)).filter(Boolean);
        const used = kept.map(b => ({ style: b.style }));
        return pick.keys.map(k => {
            const ex = old.find(b => b.key === k);
            if (ex) return ex.style;
            const n = nextStyleName(used);
            used.push({ style: n });
            return n;
        });
    }
    function paintPick() {
        if (!pick || typeof imageFiles === 'undefined') return;
        const names = pickNames();
        imageFiles.forEach(img => {
            if (!img.element) return;
            const i = pick.keys.indexOf(keyOf(img));
            img.element.classList.toggle('ev-picked', i >= 0);
            let tag = img.element.querySelector('.ev-pick-tag');
            if (i < 0) { if (tag) tag.remove(); return; }
            if (!tag) {
                tag = document.createElement('span');
                tag.className = 'ev-pick-tag';
                (img.element.querySelector('.list-item-thumb-wrap') || img.element).appendChild(tag);
            }
            tag.textContent = '📌 ' + names[i];
        });
        const c = $('ev-pick-count');
        if (c) c.textContent = pick.keys.length ? `${pick.keys.length} base(s) marked` : 'No base marked — Confirm removes all bases';
    }
    function onPickClick(ev) {
        if (!pick || typeof imageFiles === 'undefined') return;
        const img = imageFiles.find(i => i.element && i.element.contains(ev.target));
        if (!img) return;
        ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
        if (ev.type !== 'click') return;
        const k = keyOf(img), i = pick.keys.indexOf(k);
        if (i >= 0) pick.keys.splice(i, 1);
        else if (pick.keys.length >= MAX_BASES) { window.showAlert && window.showAlert(`Max ${MAX_BASES} bases — each one is sent with every image.`, 'warn'); return; }
        else pick.keys.push(k);
        paintPick();
    }
    function endBasePick(ok) {
        if (!pick) return;
        if (ok) {
            const d = dsData(pick.ds), old = d.bases;
            const names = pickNames();
            const next = pick.keys.map((k, i) => {
                const ex = old.find(b => b.key === k);
                if (ex) return ex;
                const img = imageFiles.find(x => keyOf(x) === k);
                return { key: k, name: img ? img.name : k.split('|').pop(), style: names[i], trigger: '', desc: '' };
            });
            // Bases of this dataset whose image is not in the open list (hidden / other subfolder) are kept.
            const present = new Set(imageFiles.map(keyOf));
            d.bases = next.concat(old.filter(b => !present.has(b.key)));
            saveCfg();
        }
        if (typeof imageFiles !== 'undefined') imageFiles.forEach(img => {
            if (!img.element) return;
            img.element.classList.remove('ev-picked');
            const t = img.element.querySelector('.ev-pick-tag'); if (t) t.remove();
        });
        pick = null;
        document.body.classList.remove('ev-picking');
        const bar = $('ev-pick-bar'); if (bar) bar.style.display = 'none';
        paintBadges();
        openPanel().then(() => { setCollapsed('ev-bases-box', false); });
    }
    document.addEventListener('keydown', e => { if (pick && e.key === 'Escape') { e.preventDefault(); endBasePick(false); } }, true);
    ['click', 'mousedown', 'pointerdown', 'dblclick'].forEach(t => document.addEventListener(t, onPickClick, true));

    /* ✨ The model describes the base's style and suggests a trigger tag. */
    async function describeBase(b, replace, btn) {
        readForm();
        if (!cfg.model) { window.showAlert && window.showAlert('Pick a vision model first (🔄 loads the list).', 'warn'); return; }
        const ds = currentDsKey();
        const others = basesOf(ds).filter(x => x !== b && String(x.trigger || '').trim()).map(x => x.trigger.trim());
        if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
        try {
            const [im] = await loadBases(ds, window.currentImagesHandle, [b], true);
            if (!im) throw new Error('base image not found');
            const prompt = `Look at the ART STYLE of this image (not the character or the pose). Answer ONLY with JSON:
{"description": "<one short sentence, max 20 words: line art, coloring / shading, rendering, palette, medium — what makes this style recognizable>",
 "trigger": "<a short unique trigger tag for this style, lowercase, words joined by underscores, 1-3 words, e.g. thick_ink_style>"}${others.length ? `\nThe trigger must be different from: ${others.join(', ')}.` : ''}`;
            const raw = await askModel(prompt, im, undefined, []);
            const m = String(raw || '').match(/\{[\s\S]*\}/);
            if (!m) throw new Error('the model did not return JSON');
            const j = JSON.parse(m[0]);
            const desc = String(j.description || '').trim().slice(0, 200);
            const trig = String(j.trigger || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_()-]/g, '').slice(0, 60);
            if (desc && (replace || !String(b.desc || '').trim())) b.desc = desc;
            if (trig && (replace || !String(b.trigger || '').trim())) b.trigger = trig;
            saveCfg(); renderSummary();
        } catch (e) {
            window.showAlert && window.showAlert('Could not describe the style: ' + (e.message || e), 'error');
        }
        syncBaseRow();
    }

    /* ---------- DATASET LIST ---------- */
    async function addCurrentToQueue() {
        const root = window.rootHandle, dir = window.currentImagesHandle || root;
        const ds = currentDsKey();
        if (!root || !ds) { window.showAlert && window.showAlert('Open a dataset first.', 'warn'); return; }
        let path = [];
        try { path = (await root.resolve(dir)) || []; } catch (e) { path = []; }
        let rootKey = window.rootHandleKey || null;
        if (!rootKey && typeof window.findSavedHandleKey === 'function') rootKey = await window.findSavedHandleKey(root);
        if (cfg.queue.some(q => q.dsKey === ds && (q.path || []).join('/') === path.join('/'))) { window.showAlert && window.showAlert('This dataset is already in the list.', 'info'); return; }
        const q = { id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), rootKey, rootName: root.name, path, label: [root.name, ...path].join(' / '), dsKey: ds, status: 'pending', done: 0, total: 0, ok: 0, failed: 0 };
        if (!rootKey) tempRoots.set(q.id, root);
        cfg.queue.push(q);
        // Freeze the brief currently shown, so this dataset keeps it.
        readForm();
        saveCfg(); renderQueue(); syncRunButton();
        if (window.showAlert) window.showAlert(rootKey ? `📋 "${q.label}" added to the list.` : `📋 "${q.label}" added — this folder is not in your saved folders, so it stays in the list only until you reload (💾 save the folder to keep it).`, rootKey ? 'success' : 'warn', 6000);
    }
    function renderQueue() {
        const box = $('ev-q-list');
        if (!box) return;
        const info = $('ev-queue-info');
        if (info) {
            const run = cfg.queue.find(q => q.status === 'running');
            const done = cfg.queue.filter(q => q.status === 'done').length;
            info.textContent = !cfg.queue.length ? '(empty)' : `(${cfg.queue.length} dataset${cfg.queue.length > 1 ? 's' : ''} · ${listRunning && run ? `running: ${run.label} ${run.done || 0}/${run.total || '?'}` : `${done} done`})`;
        }
        if (!cfg.queue.length) { box.innerHTML = '<div class="ev-small" style="color:#666;">Empty — open a dataset and press ➕ Add this dataset.</div>'; return; }
        const label = { pending: 'waiting', running: 'running', done: 'done', failed: 'failed', paused: 'paused' };
        box.innerHTML = cfg.queue.map((q, i) => {
            const prog = q.total ? ` ${q.done || 0}/${q.total}` : '';
            const temp = !q.rootKey && !tempRoots.has(q.id);
            const hasBrief = !!(cfg.datasets[q.dsKey] && String(cfg.datasets[q.dsKey].brief || '').trim());
            const nb = basesOf(q.dsKey).length;
            return `<div class="ev-q-item" data-i="${i}">
                <span class="ev-qlabel" title="${esc(q.label)}${q.error ? '\n⚠️ ' + esc(q.error) : ''}">${q.dsKey === currentDsKey() ? '👁️ ' : ''}${esc(q.label)}
                    <span style="color:#666;">${hasBrief ? '' : ' · no brief'}${nb ? ` · 📌${nb}` : ''}${temp ? ' · ⚠️ folder not saved' : ''}</span></span>
                <span class="ev-qstat ${esc(q.status)}" title="${esc(q.error || '')}">${label[q.status] || q.status}${prog}${q.failed ? ` · ${q.failed}⚠️` : ''}</span>
                <button class="ev-x" title="Remove from the list">✕</button></div>`;
        }).join('');
        box.querySelectorAll('.ev-q-item').forEach(row => {
            row.querySelector('.ev-x').onclick = () => {
                const q = cfg.queue[+row.dataset.i];
                if (listJob && listJob.q === q) { listJob.broken = false; listJob.i = listJob.units.length; if (activeJob === listJob && abortCtrl) try { abortCtrl.abort(); } catch (e) {} listJob = null; }
                cfg.queue.splice(+row.dataset.i, 1); tempRoots.delete(q.id);
                saveCfg(); renderQueue(); syncRunButton();
            };
        });
    }
    function syncReqInfo() {
        const i = $('ev-req-info');
        if (!i) return;
        const t = requestOf(currentDsKey()).trim();
        i.textContent = t ? `(${t.length > 50 ? t.slice(0, 50) + '…' : t})` : '(empty — ignored)';
    }
    function syncBriefNote() {
        const n = $('ev-brief-note');
        if (!n) return;
        const ds = currentDsKey();
        const own = ds && cfg.datasets[ds] && String(cfg.datasets[ds].brief || '').trim();
        n.textContent = !ds ? '' : (own ? 'saved for this dataset' : (cfg.brief.trim() ? 'general brief (edit to give this dataset its own)' : 'saved for this dataset'));
    }

    function syncFieldsPop() {
        document.querySelectorAll('#ev-fields-pop input[data-f]').forEach(cb => { cb.checked = !!(cfg.tipFields || {})[cb.dataset.f]; });
    }

    function fillForm() {
        $('ev-backend').value = cfg.backend;
        $('ev-url').value = cfg.backend === 'ollama' ? cfg.urlOllama : cfg.urlOpenAI;
        $('ev-key-row').style.display = cfg.backend === 'openai' ? '' : 'none';
        $('ev-key').value = cfg.apiKey;
        const dsNow = currentDsKey();
        $('ev-brief').value = briefOf(dsNow);
        $('ev-brief').dataset.ds = dsNow;
        $('ev-request').value = requestOf(dsNow);
        $('ev-capstyle').value = captionStyleOf(dsNow);
        $('ev-capstyle').dataset.ds = dsNow;
        $('ev-capstyle').disabled = !dsNow;
        $('ev-request').dataset.ds = dsNow;
        syncReqInfo();
        syncBriefNote();
        $('ev-keep').checked = !!cfg.keepOnSwitch;
        $('ev-skip').checked = !!cfg.skipScored;
        renderQueue();
        $('ev-scope').value = cfg.scope;
        $('ev-size-preset').value = SIZE_PRESETS[cfg.sizePreset] || cfg.sizePreset === 'custom' ? cfg.sizePreset : 'sdxl';
        $('ev-maxside').value = cfg.maxSide; $('ev-maxside-val').textContent = cfg.maxSide + 'px';
        $('ev-maxside-row').style.display = $('ev-size-preset').value === 'custom' ? '' : 'none';
        $('ev-temp').value = Math.round(cfg.temperature * 100); $('ev-temp-val').textContent = cfg.temperature.toFixed(2);
        $('ev-caption').checked = !!cfg.sendCaption;
        $('ev-res').checked = !!cfg.sendResolution;
        $('ev-bucket').checked = !!cfg.suggestBucket;
        syncBaseRow();
        $('ev-bucket').disabled = !window.TMBuckets;
        $('ev-badges').checked = !!cfg.showBadges;
        const sel = $('ev-model');
        if (cfg.model && !Array.from(sel.options).some(o => o.value === cfg.model)) {
            const o = document.createElement('option'); o.value = cfg.model; o.textContent = cfg.model; sel.appendChild(o);
        }
        sel.value = cfg.model || '';
    }

    function readForm() {
        if (!$('ev-backend')) return;
        cfg.backend = $('ev-backend').value;
        const url = $('ev-url').value.trim();
        // URL belongs to the backend that was shown when it was typed.
        if ($('ev-url').dataset.backend === 'openai') cfg.urlOpenAI = url || DEFAULT_CFG.urlOpenAI;
        else if ($('ev-url').dataset.backend === 'ollama') cfg.urlOllama = url || DEFAULT_CFG.urlOllama;
        $('ev-url').dataset.backend = cfg.backend;
        cfg.apiKey = $('ev-key').value.trim();
        cfg.model = $('ev-model').value;
        // The brief belongs to the dataset that was shown when it was typed.
        const bds = $('ev-brief').dataset.ds;
        const bv = $('ev-brief').value;
        if (bds) dsData(bds).brief = bv; else cfg.brief = bv;
        const rds = $('ev-request').dataset.ds;
        if (rds) dsData(rds).request = $('ev-request').value.slice(0, 3000);
        cfg.keepOnSwitch = $('ev-keep').checked;
        cfg.skipScored = $('ev-skip').checked;
        cfg.scope = $('ev-scope').value;
        cfg.sizePreset = $('ev-size-preset').value;
        cfg.maxSide = SIZE_PRESETS[cfg.sizePreset] || parseInt($('ev-maxside').value, 10) || 1024;
        cfg.temperature = (parseInt($('ev-temp').value, 10) || 0) / 100;
        cfg.sendCaption = $('ev-caption').checked;
        cfg.sendResolution = $('ev-res').checked;
        cfg.suggestBucket = $('ev-bucket').checked;
        cfg.consistency = true;     // no checkbox any more: no base = compared with the common design
        cfg.showBadges = $('ev-badges').checked;
    }

    async function refreshModels(silent) {
        const st = $('ev-model-status'), sel = $('ev-model');
        st.textContent = 'Loading models...';
        try {
            const info = await listModels();
            let models = info.models;
            // Servidor sem informação de visão e nenhum nome reconhecido: mostra tudo com aviso.
            const unfiltered = info.method === 'name' && !models.length && info.all && info.all.length;
            if (unfiltered) models = info.all;
            sel.innerHTML = '';
            if (!models.length) {
                sel.innerHTML = '<option value="">No vision models found</option>';
                st.textContent = info.total ? `${info.total} model(s) on the server, but none supports images. Install a vision model (e.g. qwen2.5vl, gemma3, llava, minicpm-v).` : 'No models on this server.';
                return;
            }
            models.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
            if (cfg.model && models.includes(cfg.model)) sel.value = cfg.model;
            else {
                // No saved model: prefer one whose name says it handles images.
                const vision = models.find(m => /(vl\b|vl:|vl-|vision|llava|gemma3|gemma-3|minicpm|moondream|pixtral|internvl|joycaption|molmo|smolvlm|florence)/i.test(m));
                if (vision) sel.value = vision;
                cfg.model = sel.value; saveCfg();
            }
            const hidden = info.total - models.length;
            st.textContent = unfiltered
                ? `${models.length} model(s) — this server does not say which ones see images; pick a vision model.`
                : `${models.length} vision model(s)${hidden > 0 ? ` · ${hidden} text-only model(s) hidden` : ''}${info.method === 'name' ? ' (detected by name)' : ''}.`;
        } catch (e) {
            st.textContent = silent ? '' : `Could not reach the server (${e.message || e}). Is it running? CORS allowed?`;
        }
    }

    async function openPanel() {
        buildModal();
        fillForm();
        $('ev-url').dataset.backend = cfg.backend;
        renderSummary();
        syncRunButton();
        renderQueue();
        // Always start collapsed; the list starts open only while it still has work.
        setCollapsed('ev-bases-box', true);
        setCollapsed('ev-req-box', true);
        setCollapsed('ev-queue-box', !queueBusy());
        window.openModal('modal-evaluator');
        if ($('ev-model').options.length <= 1) refreshModels(true);
    }
    window.openEvaluatorPanel = openPanel;

    /* ---------- BUTTON NEXT TO THE THUMB SLIDER ---------- */
    function injectButton() {
        if ($('btn-evaluator')) return;
        const slider = $('thumb-slider');
        if (!slider || !slider.parentElement) return;
        const row = slider.parentElement;
        // The 🖼️ icon on the right of the slider is removed to make room.
        const last = row.lastElementChild;
        if (last && last !== slider && last.tagName === 'SPAN' && last.textContent.trim() === '🖼️') last.remove();
        const btn = document.createElement('button');
        btn.id = 'btn-evaluator';
        btn.textContent = '🧐';
        btn.title = 'Evaluate dataset — a vision model scores each image (0–10) against your brief. Second opinion only.';
        btn.onclick = () => openPanel();
        btn.style.display = enabled ? '' : 'none';
        row.appendChild(btn);
    }

    function onDatasetLoaded() {
        if (pick && pick.ds !== currentDsKey()) endBasePick(false);
        if (manualJob && !manualJob.cancel && !cfg.keepOnSwitch && manualJob.dsKey !== currentDsKey()) {
            const j = manualJob;
            stopManual(true);
            window.showAlert && window.showAlert(`🧐 Evaluation of "${j.label}" stopped: dataset changed (${j.i}/${j.units.length} done — scores so far are saved). Turn on "Keep evaluating in the background" to keep it running.`, 'info', 7000);
        }
        paintBadges();
        if ($('modal-evaluator') && $('modal-evaluator').classList.contains('active')) { fillForm(); renderSummary(); }
    }

    /* ---------- ⚙️ SETTINGS: Local AI on / off ----------
       Each AI tool adds its own checkbox to the "🤖 Local AI" group of the ⚙️ dropdown.
       Off by default; the choice is saved and used on the next start. */
    window.tmAiSettingsGroup = window.tmAiSettingsGroup || function () {
        const dd = document.getElementById('settings-dropdown');
        if (!dd) return null;
        let grp = document.getElementById('settings-local-ai');
        if (grp) return grp;
        grp = document.createElement('div');
        grp.id = 'settings-local-ai';
        grp.style.cssText = 'display:flex; flex-direction:column; gap:inherit;';
        grp.innerHTML = '<div class="settings-group-label">🤖 Local AI (vision model)</div>';
        const hr = document.createElement('hr');
        hr.style.cssText = 'border:0; border-top:1px solid #333; margin:5px 0;';
        const backup = Array.from(dd.querySelectorAll('.settings-group-label')).find(e => /Backup/.test(e.textContent));
        if (backup) { dd.insertBefore(grp, backup); dd.insertBefore(hr, backup); }
        else { dd.appendChild(hr); dd.appendChild(grp); }
        return grp;
    };
    function setEnabled(on, save) {
        enabled = !!on;
        const b = $('btn-evaluator');
        if (b) b.style.display = enabled ? '' : 'none';
        const cb = $('toggle-ai-evaluator');
        if (cb) cb.checked = enabled;
        if (!enabled) {
            if (manualJob) stopManual(true);
            if (listRunning) stopList();
            if (pick) endBasePick(false);
            if ($('modal-evaluator') && $('modal-evaluator').classList.contains('active')) window.closeModal('modal-evaluator');
            hideTip();
        }
        paintBadges();
        if (save && typeof window.saveSetting === 'function') window.saveSetting('enable-evaluator', enabled);
    }
    function injectSetting() {
        const grp = window.tmAiSettingsGroup();
        if (!grp || $('toggle-ai-evaluator')) return;
        const lb = document.createElement('label');
        lb.title = 'A vision model scores each image of the dataset (🧐 next to the thumbnail slider)';
        lb.innerHTML = '<input type="checkbox" id="toggle-ai-evaluator"> 🧐 Dataset Evaluator';
        grp.appendChild(lb);
        $('toggle-ai-evaluator').checked = enabled;
        $('toggle-ai-evaluator').onchange = e => setEnabled(e.target.checked, true);
    }

    /* ---------- BOOT ---------- */
    window.addEventListener('DOMContentLoaded', async () => {
        setTimeout(injectButton, 0);
        await loadAll();
        try { enabled = !!(typeof window.getSetting === 'function' && await window.getSetting('enable-evaluator', false)); } catch (e) { enabled = false; }
        injectSetting();
        setTimeout(() => setEnabled(enabled, false), 0);
        if (window.TM && typeof window.TM.on === 'function') {
            window.TM.on('render:list', paintBadges);
            window.TM.on('dataset:loaded', () => setTimeout(onDatasetLoaded, 50));
        } else if (typeof window.registerPostRenderImageList === 'function') {
            window.registerPostRenderImageList(paintBadges);
        }
        paintBadges();
    });
})();
