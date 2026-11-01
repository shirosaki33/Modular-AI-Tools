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

   CONSISTENCY WITH A BASE IMAGE: you pick ONE image as the base (📌 in the panel,
   from the selected image). Every evaluation then sends the base + the image to
   the model, which says how much the design matches the base (0–100%) and what
   differs. The model also lists defining traits (Danbooru-style tags); those are
   the fallback (trait overlap with the base) for images scored before the base
   was set. Without a base: traits are compared with the "common design" of the
   dataset (traits in ≥ 40% of the scored images, needs ≥ 3).

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
        tipFields: { comment: true, issues: true, suggestion: true, framing: true, crop: true, consistency: true, meta: true, hint: true },
        baseKey: '',
        showBadges: true
    };
    const SIZE_PRESETS = { sd: 512, sdxl: 1024, hd: 1536 };
    let cfg = { ...DEFAULT_CFG };
    let results = {};               // key -> { score, verdict, issues[], comment, suggestion, w, h, model, ts }
    let running = false;
    let abortCtrl = null;
    let saveResTimer = null;

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
        #eval-tooltip .et-click { color:#777; font-size:10px; margin-top:5px; }
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
        .ev-cons-box { flex:0 0 100%; box-sizing:border-box; font-size:11px; color:#c9a7ff; background:#120c1e; border:1px solid #2f1a5c; border-radius:6px; padding:5px 8px; line-height:1.45; }
        #modal-evaluator .tool-modal { width: 620px; max-width: 94vw; max-height: 90vh; overflow-y: auto; }
        .ev-row { display:flex; align-items:center; gap:8px; font-size:12px; color:#ccc; }
        .ev-row > .ev-lbl { flex:0 0 110px; color:#9ecfff; font-weight:bold; }
        .ev-row input[type=text], .ev-row input[type=password], .ev-row select { flex:1; min-width:0; font-size:12px; }
        .ev-row input[type=range] { flex:1; accent-color:#b890ff; padding:0; }
        .ev-row .ev-val { flex:0 0 46px; text-align:right; color:#888; font-size:11px; }
        .ev-row label { display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }
        .ev-row input[type=checkbox] { width:auto; margin:0; accent-color:#b890ff; }
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
            const r = await window.getSetting(RES_KEY, null);
            if (r && typeof r === 'object') results = r;
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
    function baseResult() { return cfg.baseKey ? results[cfg.baseKey] || null : null; }

    // { pct, missing, unusual, diff, mode: 'base' | 'base-traits' | 'common', isBase }
    function consistencyOf(r, img) {
        if (!r) return null;
        if (cfg.baseKey) {
            if (img && keyOf(img) === cfg.baseKey) return { isBase: true, mode: 'base' };
            if (r.baseUsed === cfg.baseKey && r.designMatch != null) return { pct: r.designMatch, diff: r.designDiff || '', missing: [], unusual: [], mode: 'base' };
            const b = baseResult();
            if (b && b.traits && b.traits.length >= 2 && r.traits && r.traits.length) {
                const has = new Set(r.traits), bs = new Set(b.traits);
                return {
                    pct: Math.round(100 * b.traits.filter(t => has.has(t)).length / b.traits.length),
                    missing: b.traits.filter(t => !has.has(t)), unusual: r.traits.filter(t => !bs.has(t)), diff: '', mode: 'base-traits'
                };
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

    /* ---------- BADGES ON THE LIST ---------- */
    function paintBadges() {
        if (typeof imageFiles === 'undefined') return;
        computeConsensus();
        imageFiles.forEach(img => {
            if (!img.element) return;
            const wrap = img.element.querySelector('.list-item-thumb-wrap');
            if (!wrap) return;
            let badge = wrap.querySelector('.eval-score-badge');
            const r = cfg.showBadges ? resultOf(img) : null;
            if (!r) { if (badge) badge.remove(); return; }
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'eval-score-badge';
                badge.addEventListener('mouseenter', ev => showTip(img, ev));
                badge.addEventListener('mousemove', moveTip);
                badge.addEventListener('mouseleave', hideTip);
                badge.addEventListener('click', ev => { ev.stopPropagation(); openInBucket(img); });
                wrap.appendChild(badge);
            }
            const stale = !!(img._resolution && r.w && (img._resolution.w !== r.w || img._resolution.h !== r.h));
            const canOpen = !stale && (r.bucketCrop || r.autoCrop || (r.bucket && r.bucket !== 'current'));
            badge.className = 'eval-score-badge ' + scoreClass(r.score) + (stale ? ' stale' : '') + (canOpen ? ' clickable' : '');
            badge.textContent = (cfg.consistency && cfg.baseKey === keyOf(img) ? '📌 ' : '') + (Math.round(r.score * 10) / 10).toString();
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
        if (!r) return;
        const t = ensureTip();
        const v = VERDICTS[r.verdict] || { icon: '❔', label: r.verdict || '—' };
        const stale = !!(img._resolution && r.w && (img._resolution.w !== r.w || img._resolution.h !== r.h));
        const F = cfg.tipFields || {};
        const cons = F.consistency ? consistencyOf(r, img) : null;
        t.innerHTML = `
            <div class="et-head"><span>${v.icon} ${esc(v.label)}</span><span>${esc(r.score)}/10</span></div>
            ${F.comment && r.comment ? `<div>${esc(r.comment)}</div>` : ''}
            ${F.issues && r.issues && r.issues.length ? `<div class="et-issues">${r.issues.map(i => `<span class="et-issue">${esc(i)}</span>`).join('')}</div>` : ''}
            ${F.suggestion && r.suggestion ? `<div class="et-sugg">💡 ${esc(r.suggestion)}</div>` : ''}
            ${consLine(cons)}
            ${bucketLine(r)}
            ${F.meta ? `<div class="et-meta">${esc(r.model || '')} · ${r.w ? r.w + '×' + r.h + ' · ' : ''}${new Date(r.ts || Date.now()).toLocaleString()}${stale ? ' · ⚠️ image changed since evaluation' : ''}</div>` : (stale ? '<div class="et-meta">⚠️ image changed since evaluation</div>' : '')}`;
        t.style.display = 'block';
        moveTip(ev);
    }
    function consLine(c) {
        if (!c) return '';
        if (c.isBase) return `<div class="et-cons">📌 This is the BASE image — the others are compared with it.</div>`;
        const what = c.mode === 'common' ? 'of the common design' : (c.mode === 'base-traits' ? 'of the base traits' : 'match with the base');
        const extra = c.mode === 'base' ? '' : (c.mode === 'base-traits' ? ' <span style="color:#777;">(by traits — evaluate again for a visual comparison)</span>' : '');
        let html = `<div class="et-cons">🧬 Design: <b>${c.pct}%</b> ${what}${extra}`;
        if (c.diff) html += `<br><span style="color:#999;">differs:</span> ${esc(c.diff)}`;
        if (c.missing && c.missing.length) html += `<br><span style="color:#999;">missing:</span> ${esc(c.missing.slice(0, 5).join(', '))}`;
        if (c.unusual && c.unusual.length) html += `<br><span style="color:#999;">unusual:</span> ${esc(c.unusual.slice(0, 5).join(', '))}`;
        return html + '</div>';
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
    function hideTip() { if (tip) tip.style.display = 'none'; }

    /* ---------- IMAGE -> BASE64 (downscaled) ---------- */
    async function imageToBase64(img, maxSide) {
        const blob = await (await fetch(img.url)).blob();
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
    function buildPrompt(img, real, buckets, framing, withBase) {
        const parts = [];
        if (withBase) parts.push('You get TWO images. IMAGE 1 = the BASE / reference image of the dataset (how the subject is supposed to look). IMAGE 2 = the image to review. Everything below (score, issues, framing, resolution) is about IMAGE 2 only; IMAGE 1 is only for the design comparison.');
        parts.push(`You are reviewing images for a training dataset (LoRA / fine-tune). Give an honest second opinion on ${withBase ? 'IMAGE 2' : 'THIS image'}.`);
        parts.push('DATASET BRIEF (what the dataset is for — judge the image against it):\n' + (cfg.brief.trim() || '(no brief given — judge general training quality)'));
        if (cfg.sendResolution && real) parts.push(`Image resolution: ${real.w}x${real.h} pixels.`);
        if (cfg.sendCaption && img.content && img.content.trim()) parts.push('Current caption / tags of this image:\n' + img.content.trim().slice(0, 1500));
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
        parts.push(`Consider: fit with the brief, image quality (blur, noise, compression, artifacts), anatomy / errors, watermarks, text, signatures, borders, framing / cropping, resolution and aspect ratio, duplication of concept, anything that would hurt training.${cfg.sendCaption ? ' If the caption is clearly wrong or missing something important, mention it.' : ''}`);
        parts.push(`Answer ONLY with a JSON object, no other text:
{
  "score": <number 0-10, 10 = perfect for this dataset, 0 = useless/harmful>,
  "verdict": "<one of: keep, crop, resize, edit, remove>",
  "issues": ["<short issue>", "..."],
  "comment": "<1-2 sentences: what you see and why this score>",
  "suggestion": "<concrete advice: what to change (e.g. crop the bottom text, use a vertical bucket, remove — off-brief), or 'none'>"${cfg.consistency ? `,
${withBase ? `
  "design_match": <0-100: how much the subject's design in IMAGE 2 matches the BASE (IMAGE 1) — face, hair, eyes, outfit, colors, proportions, art style as far as the brief cares; ignore pose, background and framing>,
  "design_diff": "<short: the main design differences vs the base, or 'none'>",` : ''}
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

    function parseAnswer(text, buckets) {
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
            designMatch: isFinite(parseFloat(j.design_match)) ? Math.max(0, Math.min(100, Math.round(parseFloat(j.design_match) <= 1 && String(j.design_match).includes('.') ? parseFloat(j.design_match) * 100 : parseFloat(j.design_match)))) : null,
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

    async function askModel(prompt, image, signal, baseImage) {
        const imgs = baseImage ? [baseImage, image] : [image];
        const base = baseUrl();
        if (cfg.backend === 'ollama') {
            const res = await fetch(base + '/api/chat', {
                method: 'POST', signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: cfg.model, stream: false, format: 'json',
                    options: { temperature: cfg.temperature },
                    messages: [{ role: 'user', content: prompt, images: imgs.map(i => i.b64) }]
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
                model: cfg.model, temperature: cfg.temperature, max_tokens: 600, stream: false,
                messages: [{ role: 'user', content: [
                    { type: 'text', text: prompt },
                    ...imgs.map(i => ({ type: 'image_url', image_url: { url: i.dataUrl } }))
                ] }]
            })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
        const data = await res.json();
        return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    }

    /* ---------- RUN ---------- */
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

    function setProgress(done, total, text) {
        const p = $('ev-progress'), f = $('ev-progress-fill');
        if (p) p.textContent = text || '';
        if (f) f.style.width = total ? (100 * done / total).toFixed(1) + '%' : '0';
        const btn = $('btn-evaluator');
        if (btn) {
            btn.classList.toggle('running', running);
            btn.textContent = running ? `🧐 ${done}/${total}` : '🧐';
        }
    }

    async function runEvaluation() {
        if (running) { stopEvaluation(); return; }
        readForm();
        if (!cfg.model) { window.showAlert && window.showAlert('Pick a vision model first (🔄 loads the list).', 'warn'); return; }
        const imgs = targetImages();
        if (imgs.length === 0) {
            window.showAlert && window.showAlert(cfg.scope === 'selected' ? 'Select at least one image (or change the scope).' : 'No images to evaluate.', 'warn');
            return;
        }
        running = true;
        abortCtrl = new AbortController();
        syncRunButton();
        // Roda em segundo plano: fecha o painel (progresso fica no 🧐; clicar nele reabre).
        window.closeModal('modal-evaluator');
        let ok = 0, failed = 0, fails = 0;
        // Base image (sent with every evaluation for the design comparison).
        let baseImage = null, baseImgObj = null;
        if (cfg.consistency && cfg.baseKey && typeof imageFiles !== 'undefined') {
            baseImgObj = imageFiles.find(i => keyOf(i) === cfg.baseKey) || null;
            if (baseImgObj) { try { baseImage = await imageToBase64(baseImgObj, Math.min(cfg.maxSide, 768)); } catch (e) { baseImage = null; } }
        }
        for (let i = 0; i < imgs.length; i++) {
            if (!running) break;
            const img = imgs[i];
            setProgress(i, imgs.length, `Evaluating ${i + 1}/${imgs.length}: ${img.name}`);
            try {
                const image = await imageToBase64(img, cfg.maxSide);
                const buckets = bucketCandidates(image.real, image.framing);
                const useBase = baseImage && img !== baseImgObj;
                const raw = await askModel(buildPrompt(img, image.real, buckets, image.framing, useBase), image, abortCtrl.signal, useBase ? baseImage : null);
                const r = parseAnswer(raw, buckets);
                const fText = framingText(image.framing);
                // Model ignored the subject crops on a badly framed image: keep the best one as the measured advice.
                if (buckets && buckets.subject.length && (!r.bucket || r.bucket === 'current' || !r.bucketCrop) && image.framing.empty > 0.35) {
                    r.autoCrop = { key: buckets.subject[0].key, crop: buckets.subject[0].crop, removed: buckets.subject[0].removed };
                }
                if (!useBase) { r.designMatch = null; r.designDiff = ''; }
                results[keyOf(img)] = { ...r, framing: fText, baseUsed: useBase ? cfg.baseKey : '', w: image.real.w, h: image.real.h, model: cfg.model, ts: Date.now() };
                ok++; fails = 0;
                saveResults();
                paintBadges();
                renderSummary();
            } catch (e) {
                if (e && e.name === 'AbortError') break;
                failed++; fails++;
                console.warn('[Evaluator]', img.name, e);
                setProgress(i, imgs.length, `⚠️ ${img.name}: ${e.message || e}`);
                if (fails >= 3) {
                    window.showAlert && window.showAlert('Evaluator stopped: 3 failures in a row. Check the URL / model (must support images) / CORS. ' + (e.message || ''), 'error', 8000);
                    break;
                }
            }
        }
        const stopped = !running;
        running = false;
        abortCtrl = null;
        syncRunButton();
        setProgress(ok + failed, imgs.length, `${stopped ? 'Stopped. ' : 'Done. '}${ok} evaluated${failed ? `, ${failed} failed` : ''}.`);
        const btn = $('btn-evaluator'); if (btn) btn.textContent = '🧐';
        if (ok && window.showAlert) window.showAlert(`Evaluator: ${ok} image(s) scored. Hover a score on the list to read the comment.`, 'success');
    }

    function stopEvaluation() {
        running = false;
        if (abortCtrl) try { abortCtrl.abort(); } catch (e) {}
    }

    function syncRunButton() {
        const b = $('btn-ev-run');
        if (!b) return;
        b.classList.toggle('stop', running);
        b.textContent = running ? '⏹ Stop' : '🧐 Evaluate';
    }

    /* ---------- SUMMARY ---------- */
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
        if (cfg.consistency && cfg.baseKey) {
            const baseImg = imageFiles.find(i => keyOf(i) === cfg.baseKey);
            const cs = visible.map(i => consistencyOf(resultOf(i), i)).filter(c => c && !c.isBase && c.pct != null);
            const pcts = cs.map(c => c.pct);
            const low = pcts.filter(p => p < 60).length;
            consHtml = `<div class="ev-cons-box">📌 <b>Base:</b> ${esc(baseImg ? baseImg.name : '(not in this folder)')}` +
                (pcts.length ? `<br>🧬 avg design match ${Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)}% (${pcts.length} images)${low ? ` · <span style="color:#ff9f43;">${low} below 60%</span>` : ''}` : '<br><span style="color:#777;">Evaluate images to compare them with the base.</span>') + `</div>`;
        } else if (consensus.traits.length >= 2) {
            const pcts = visible.map(i => consistencyOf(resultOf(i), i)).filter(Boolean).map(c => c.pct);
            const low = pcts.filter(p => p < 60).length;
            consHtml = `<div class="ev-cons-box">🧬 <b>Common design</b> (${consensus.n} images): ${esc(consensus.traits.slice(0, 10).join(', '))}` +
                `<br>avg consistency ${Math.round(pcts.reduce((a, b) => a + b, 0) / (pcts.length || 1))}%${low ? ` · <span style="color:#ff9f43;">${low} image(s) below 60%</span>` : ''}</div>`;
        } else if (cfg.consistency) {
            consHtml = `<div class="ev-cons-box" style="color:#666;">🧬 Pick a 📌 base image to compare every image with it (or score 3+ images to compare with the common design).</div>`;
        }
        box.innerHTML = `<span>${rs.length} scored · avg ${avg.toFixed(1)}</span>` +
            Object.keys(VERDICTS).filter(k => count[k]).map(k => `<span>${VERDICTS[k].icon} ${VERDICTS[k].label}: ${count[k]}</span>`).join('') + consHtml;
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

                <div>
                    <div class="ev-row" style="margin-bottom:4px;"><span class="ev-lbl">Dataset brief</span></div>
                    <textarea id="ev-brief" placeholder="Describe exactly what this dataset is for. E.g.: Character LoRA of 'Aria' (silver hair, red eyes, black coat). Anime style, solo only. I want variety of poses and angles, full body and portraits. No text, watermarks, other characters or chibi. Target SDXL buckets."></textarea>
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
                <div class="ev-row"><label><input type="checkbox" id="ev-caption"> Send the caption / tags too (model can point out wrong tags)</label></div>
                <div class="ev-row"><label><input type="checkbox" id="ev-res"> Tell the model the real resolution</label></div>
                <div class="ev-row"><label title="Uses the model chosen in the 🪣 Bucket popout (SD / SDXL / HD)"><input type="checkbox" id="ev-bucket"> Suggest the best bucket resolution for each image (SD / SDXL / HD from 🪣)</label></div>
                <div class="ev-row"><label title="Each image is sent together with the 📌 base image and the model says how much the design matches it (without a base: compared with the common traits of the dataset)"><input type="checkbox" id="ev-cons"> Compare images — design match with the 📌 base image</label></div>
                <div class="ev-row" id="ev-base-row"><span class="ev-lbl">📌 Base image</span>
                    <span id="ev-base-name" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#c9a7ff;"></span>
                    <button class="ev-btn-mini" id="ev-base-set" title="Use the selected image as the base the others are compared with">📌 Use selected</button>
                    <button class="ev-btn-mini" id="ev-base-clear" title="No base — compare with the common design of the dataset">✕</button>
                </div>
                <div class="ev-row"><label><input type="checkbox" id="ev-badges"> Show score badges on the list</label>
                    <button class="ev-btn-mini" id="ev-fields-btn" style="margin-left:auto;" title="Choose what the score tooltip shows">🧩 Score details…</button>
                </div>
                <div class="ev-subpop" id="ev-fields-pop">
                    <div class="ev-subpop-head"><span>🧩 Show in the score tooltip</span><button class="ev-subpop-x" id="ev-fields-x">&times;</button></div>
                    <label><input type="checkbox" data-f="comment"> 💬 Comment</label>
                    <label><input type="checkbox" data-f="issues"> 🏷️ Issues</label>
                    <label><input type="checkbox" data-f="suggestion"> 💡 Suggestion</label>
                    <label><input type="checkbox" data-f="consistency"> 🧬 Design match with the 📌 base</label>
                    <label><input type="checkbox" data-f="framing"> 🧭 Framing (off-center / empty space)</label>
                    <label><input type="checkbox" data-f="crop"> ✂️ Measured crop</label>
                    <label><input type="checkbox" data-f="hint"> 🖱️ "Click to open in Bucket" hint</label>
                    <label><input type="checkbox" data-f="meta"> 🕒 Model · resolution · date</label>
                </div>

                <div id="ev-progress-bar"><div id="ev-progress-fill"></div></div>
                <div id="ev-progress"></div>
                <div id="ev-summary"></div>

                <div class="modal-buttons">
                    <button id="btn-ev-clear" title="Remove the scores of the images in the chosen scope">🧹 Clear scores</button>
                    <button class="btn-cancel" onclick="window.closeModal('modal-evaluator')">Close</button>
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
        ['ev-url', 'ev-key', 'ev-model', 'ev-brief', 'ev-scope', 'ev-maxside', 'ev-temp', 'ev-caption', 'ev-res', 'ev-bucket', 'ev-cons'].forEach(id => {
            $(id).addEventListener('change', () => { readForm(); saveCfg(); });
        });
        $('ev-badges').onchange = () => { readForm(); saveCfg(); paintBadges(); };
        $('ev-cons').addEventListener('change', () => { syncBaseRow(); paintBadges(); renderSummary(); });
        $('ev-base-set').onclick = () => {
            if (typeof selectedIndices === 'undefined' || selectedIndices.size !== 1) { window.showAlert && window.showAlert('Select exactly ONE image in the list to use as the base.', 'warn'); return; }
            const img = imageFiles[Array.from(selectedIndices)[0]];
            if (!img) return;
            cfg.baseKey = keyOf(img); saveCfg(); syncBaseRow(); paintBadges(); renderSummary();
            window.showAlert && window.showAlert(`📌 "${img.name}" is now the base. Evaluate the other images to compare them with it.`, 'success');
        };
        $('ev-base-clear').onclick = () => { cfg.baseKey = ''; saveCfg(); syncBaseRow(); paintBadges(); renderSummary(); };
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
        $('btn-ev-run').onclick = () => runEvaluation();
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

    function syncBaseRow() {
        const row = $('ev-base-row');
        if (!row) return;
        row.style.display = cfg.consistency ? '' : 'none';
        const img = cfg.baseKey && typeof imageFiles !== 'undefined' ? imageFiles.find(i => keyOf(i) === cfg.baseKey) : null;
        $('ev-base-name').textContent = cfg.baseKey ? (img ? img.name : cfg.baseKey.split('|').pop() + ' (other folder)') : 'none — compares with the common design';
        $('ev-base-clear').style.display = cfg.baseKey ? '' : 'none';
    }

    function syncFieldsPop() {
        document.querySelectorAll('#ev-fields-pop input[data-f]').forEach(cb => { cb.checked = !!(cfg.tipFields || {})[cb.dataset.f]; });
    }

    function fillForm() {
        $('ev-backend').value = cfg.backend;
        $('ev-url').value = cfg.backend === 'ollama' ? cfg.urlOllama : cfg.urlOpenAI;
        $('ev-key-row').style.display = cfg.backend === 'openai' ? '' : 'none';
        $('ev-key').value = cfg.apiKey;
        $('ev-brief').value = cfg.brief;
        $('ev-scope').value = cfg.scope;
        $('ev-size-preset').value = SIZE_PRESETS[cfg.sizePreset] || cfg.sizePreset === 'custom' ? cfg.sizePreset : 'sdxl';
        $('ev-maxside').value = cfg.maxSide; $('ev-maxside-val').textContent = cfg.maxSide + 'px';
        $('ev-maxside-row').style.display = $('ev-size-preset').value === 'custom' ? '' : 'none';
        $('ev-temp').value = Math.round(cfg.temperature * 100); $('ev-temp-val').textContent = cfg.temperature.toFixed(2);
        $('ev-caption').checked = !!cfg.sendCaption;
        $('ev-res').checked = !!cfg.sendResolution;
        $('ev-bucket').checked = !!cfg.suggestBucket;
        $('ev-cons').checked = !!cfg.consistency;
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
        cfg.brief = $('ev-brief').value;
        cfg.scope = $('ev-scope').value;
        cfg.sizePreset = $('ev-size-preset').value;
        cfg.maxSide = SIZE_PRESETS[cfg.sizePreset] || parseInt($('ev-maxside').value, 10) || 1024;
        cfg.temperature = (parseInt($('ev-temp').value, 10) || 0) / 100;
        cfg.sendCaption = $('ev-caption').checked;
        cfg.sendResolution = $('ev-res').checked;
        cfg.suggestBucket = $('ev-bucket').checked;
        cfg.consistency = $('ev-cons').checked;
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
        row.appendChild(btn);
    }

    /* ---------- BOOT ---------- */
    window.addEventListener('DOMContentLoaded', async () => {
        setTimeout(injectButton, 0);
        await loadAll();
        if (window.TM && typeof window.TM.on === 'function') {
            window.TM.on('render:list', paintBadges);
            window.TM.on('dataset:loaded', () => setTimeout(paintBadges, 50));
        } else if (typeof window.registerPostRenderImageList === 'function') {
            window.registerPostRenderImageList(paintBadges);
        }
        paintBadges();
    });
})();
