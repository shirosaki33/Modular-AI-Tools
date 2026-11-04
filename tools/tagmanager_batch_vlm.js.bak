/* =========================================================================
   TAG MANAGER — AUTO-CAPTION: VLM ENGINES (Natural Language + PyTorch)

   Connects the Auto-Caption window to the SAME engine files the Prompt Helper
   uses, so both tools always behave the same way:

     prompt_helper_florence_webgpu.js   "Natural Language (Offline VLMs)"
         Florence-2 / SmolVLM in the browser (Transformers.js, WebGPU or WASM).
         Models live in the models/ folder on localhost (found automatically),
         in the browser cache, or in a folder you choose.
     prompt_helper_florence_pytorch.js  "PyTorch / ONNX (local server)"
         Python does the work (server_max.py + florence_backend.py): Florence-2,
         PromptGen v2.0, safetensors folders, other VLMs and ONNX taggers.
         Localhost only — the mode disappears from the list elsewhere.

   This file is only the glue: it provides the small host those engines expect
   (window.PHFlorence + a "ui" object), draws the status / model / progress
   controls of the "#batch-vlm-settings" panel, and exposes window.TMVlm to the
   batch loop in tagmanager_batch_tagger.js.

   Load order in "tag manager.html" (after tagmanager_ui_core.js):
       tagmanager_batch_vlm.js          <- this file, FIRST
       prompt_helper_florence_webgpu.js
       prompt_helper_florence_pytorch.js
========================================================================= */
(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const DEFAULT_PROMPT = 'Describe this image in detail.';
    const MODE_ENGINE = { 'nl-vlm': 'webgpu', 'pytorch': 'pytorch' };
    const mb = n => (n / 1048576).toFixed(0);
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const clamp = (n, lo, hi, fb) => { n = parseInt(n, 10); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb; };
    function readPref(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : v; } catch (e) { return fb; } }
    function writePref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
    function cancelError() { const e = new Error('Cancelled.'); e.cancelled = true; return e; }

    const engines = {};
    let engine = null;       // active engine object
    let curMode = '';        // 'nl-vlm' | 'pytorch' while one of them is selected, else ''
    let busy = false;        // a panel action (load / unload / delete / folder) is running
    let batchBusy = false;   // the batch loop is running
    let cancelRequested = false;
    let failStreak = 0;
    let hwOriginal = '';     // original options of #hardware-select (ONNX tagger: WebGPU / WASM)

    /* ---------- Host the engines register into ---------- */
    window.PHFlorence = window.PHFlorence || {
        isLocalhost,
        registerEngine(e) { engines[e.id] = e; },
        util: { sleep, mb, cancelError }
    };

    const present = () => !!$('vlm-engine-ui');
    const key = name => 'tm_vlm_' + name + '_' + curMode;

    /* ---------- Styles ---------- */
    const style = document.createElement('style');
    style.textContent = `
        #vlm-engine-ui .vlm-card { background:#0d0d0d; border:1px solid #1e2a3a; border-radius:8px; padding:10px 12px; margin-bottom:15px; }
        #vlm-engine-ui .vlm-top { display:flex; gap:10px; align-items:flex-start; }
        #vlm-badge { flex-shrink:0; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:10px; background:#222; color:#aaa; white-space:nowrap; }
        #vlm-badge.local { background:#0d2a18; color:#00ff99; border:1px solid #00aa66; }
        #vlm-badge.online { background:#2a1a00; color:#ffcc66; border:1px solid #aa6600; }
        #vlm-info, #vlm-model-status { font-size:11px; color:#888; line-height:1.4; min-height:2.8em; }
        #vlm-info { flex:1; }
        #vlm-model-status { margin-top:6px; color:#9ecfff; }
        #vlm-engine-ui .vlm-row { display:flex; gap:8px; align-items:center; margin-bottom:15px; }
        #vlm-engine-ui .vlm-row > select, #vlm-engine-ui .vlm-row > input { min-width:0; }
        #vlm-engine-ui .vlm-model-row select { flex:1; width:0; text-overflow:ellipsis; }
        #vlm-engine-ui .vlm-btn { flex:0 0 auto; white-space:nowrap; font-size:11px; padding:8px 10px; background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; }
        #vlm-engine-ui .vlm-btn:hover:not(:disabled) { background:#1e4a78; color:#fff; }
        #vlm-engine-ui .vlm-btn-warn { background:#2a1a00; color:#ffcc66; border-color:#aa6600; }
        #vlm-engine-ui .vlm-btn-warn:hover:not(:disabled) { background:#aa6600; color:#000; }
        #vlm-engine-ui .vlm-btn:disabled, #vlm-engine-ui select:disabled, #vlm-engine-ui input:disabled, #vlm-engine-ui textarea:disabled { opacity:.45; cursor:not-allowed; }
        #vlm-engine-ui #vlm-load { flex:1 1 auto; min-width:0; box-sizing:border-box; }
        #vlm-engine-ui input, #vlm-engine-ui select, #vlm-engine-ui textarea, #threshold, #prefix, #exclude { box-sizing:border-box; }
        #vlm-cancel { background:#4a1118 !important; color:#ffb6c0 !important; border:1px solid #7a222c !important; visibility:hidden; }
        #vlm-engine-ui .vlm-sub { font-size:10px; color:#888; text-transform:uppercase; font-weight:bold; letter-spacing:.5px; white-space:nowrap; }
        .vlm-dl { visibility:hidden; margin-bottom:6px; min-height:28px; }
        .vlm-dl-head { display:flex; justify-content:space-between; margin-bottom:4px; font-size:11px; font-weight:bold; color:#ffcc66; }
        .vlm-dl-track { width:100%; background:#222; height:8px; border-radius:4px; overflow:hidden; }
        .vlm-dl-track > div { width:0%; height:100%; background:#ffcc66; transition:width .15s; }
        .vlm-dl-track.indeterminate > div { width:35% !important; animation: vlmSlide 1.1s infinite ease-in-out; }
        @keyframes vlmSlide { 0% { margin-left:-35%; } 100% { margin-left:100%; } }
        #vlm-status { font-size:11px; color:#aaa; min-height:2.8em; line-height:1.4; margin-bottom:10px; }
    `;
    document.head.appendChild(style);

    /* ---------- Form helpers ---------- */
    function fillSelect(id, opts, saved, fallback) {
        const el = $(id);
        if (!el) return;
        el.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
        const has = v => opts.some(o => o[0] === v);
        el.value = has(saved) ? saved : (has(fallback) ? fallback : (opts[0] ? opts[0][0] : ''));
    }
    function show(id, on) { const el = $(id); if (el) el.style.display = on ? '' : 'none'; }
    const feature = (f, ...args) => (typeof f === 'function' ? !!f(ui, ...args) : !!f);

    function values() {
        return {
            mode: curMode,
            model: $('vlm-model-select').value,
            device: $('hardware-select').value,
            task: $('vlm-task').value,
            prompt: $('batch-vlm-prompt').value.trim() || DEFAULT_PROMPT,
            maxTokens: clamp($('vlm-max-tokens').value, 16, 1024, 256),
            beams: clamp($('vlm-beams').value, 1, 8, 3),
            storage: $('vlm-storage').value,
            threshold: Math.min(1, Math.max(0, parseFloat($('vlm-threshold').value) || 0.35)),
            exclude: $('vlm-exclude').value.trim(),
            prefix: $('vlm-prefix').value.trim()
        };
    }

    /* ---------- Progress bar (always takes its space → nothing jumps) ---------- */
    const progress = {
        show() { $('vlm-dl-container').style.visibility = 'visible'; },
        hide() {
            const c = $('vlm-dl-container');
            if (!c) return;
            c.style.visibility = 'hidden';
            $('vlm-dl-track').classList.remove('indeterminate');
            $('vlm-dl-bar').style.width = '0%';
            $('vlm-dl-file').textContent = '';
            $('vlm-dl-percent').textContent = '';
        },
        set(frac, text) {
            this.show();
            $('vlm-dl-track').classList.remove('indeterminate');
            const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
            $('vlm-dl-bar').style.width = pct + '%';
            $('vlm-dl-percent').textContent = pct + '%';
            $('vlm-dl-file').textContent = text || '';
        },
        indeterminate(text) {
            this.show();
            $('vlm-dl-track').classList.add('indeterminate');
            $('vlm-dl-percent').textContent = '';
            $('vlm-dl-file').textContent = text || 'Working...';
        }
    };

    /* ---------- What the engines get ---------- */
    const ID_MAP = { fPickFolder: 'vlm-pick-folder' };
    const ui = {
        $: id => $(ID_MAP[id] || id),
        isLocalhost, values, progress, cancelError,
        alert: (msg, type) => { if (window.showAlert) window.showAlert(msg, type || 'info'); },
        setBadge(text, cls) { const b = $('vlm-badge'); b.textContent = text; b.className = cls || ''; },
        setInfo(text) { $('vlm-info').textContent = text || ''; },
        setModelStatus(text) { $('vlm-model-status').textContent = text || ''; },
        setStatus(text) { $('vlm-status').textContent = text || ''; },
        isCancelled: () => cancelRequested
    };

    /* ---------- Visibility of the rows that depend on the engine / model ---------- */
    function syncTasks() {
        if (!engine.tasksFor) return;
        const list = engine.tasksFor($('vlm-model-select').value) || engine.tasks;
        const sig = list.map(t => t[0]).join('|');
        if ($('vlm-task').dataset.sig === sig) return;
        $('vlm-task').dataset.sig = sig;
        fillSelect('vlm-task', list, readPref(key('task'), '') || $('vlm-task').value, 'MORE_DETAILED_CAPTION');
    }

    function applyVisibility() {
        if (!engine) return;
        const model = $('vlm-model-select').value;
        const kind = engine.taskKind(model);
        syncTasks();
        show('vlm-task-row', kind === 'florence');
        show('vlm-prompt-row', kind === 'prompt');
        show('vlm-tagger-row', kind === 'tagger');
        show('vlm-tagger-extra', kind === 'tagger');
        show('vlm-tokens-row', kind !== 'tagger');
        show('vlm-beams-wrap', !!engine.features.beams && kind !== 'tagger');
        const pick = engine.features.pickFolder;
        const pickOn = pick === undefined
            ? (!!engine.features.storage && $('vlm-storage').value === 'folder')
            : feature(pick);
        show('vlm-storage-row', !!engine.features.storage || pickOn);
        show('vlm-storage-label', !!engine.features.storage);
        show('vlm-storage', !!engine.features.storage);
        show('vlm-pick-folder', pickOn);
        // Never hidden (the layout would jump): dimmed + disabled when this model is not stored by the app.
        const canDel = engine.features.canDelete === undefined ? true : feature(engine.features.canDelete, model);
        $('vlm-delete').disabled = !canDel || busy || batchBusy;
        $('vlm-delete').title = canDel ? 'Delete the downloaded files of the selected model'
            : 'Not available: this model is not stored by the app (local folder / browser file)';
    }

    async function refresh() {
        const eng = engine;
        if (!eng) return;
        try { await eng.refresh(ui); }
        catch (e) {
            if (eng !== engine) return;
            ui.setBadge('⚠️ Error', 'online');
            ui.setInfo(e.message || String(e));
            ui.setModelStatus('');
        }
    }

    async function refreshModels() {
        const eng = engine;
        if (!eng) return;
        let list = eng.models;
        try { if (eng.listModels) list = (await eng.listModels(ui)) || list; }
        catch (e) { console.warn('[TM VLM] could not list models:', e); }
        if (eng !== engine) return;   // mode changed meanwhile
        fillSelect('vlm-model-select', list, $('vlm-model-select').value, list[0] && list[0][0]);
        applyVisibility();
    }

    /* ---------- Hardware select belongs to the active mode ---------- */
    function setHardware(opts, saved, fallback) {
        fillSelect('hardware-select', opts, saved, fallback);
    }
    function restoreTaggerHardware() {
        const hw = $('hardware-select');
        if (!hw || !hwOriginal) return;
        hw.innerHTML = hwOriginal;
        hw.value = readPref('tm_hw_tags', 'webgpu');
        if (!hw.value) hw.value = 'webgpu';
    }

    /* ---------- Activate / deactivate (Processing Mode changed) ---------- */
    async function activate(mode) {
        const next = engines[MODE_ENGINE[mode]];
        if (!next || !present()) return;
        if (engine && engine !== next) { try { await engine.unload(ui); } catch (e) { /* ignore */ } }
        engine = next;
        curMode = mode;

        fillSelect('vlm-model-select', engine.models, readPref(key('model'), ''), engine.models[0][0]);
        setHardware(engine.devices, readPref(key('device'), ''), engine.defaultDevice);
        fillSelect('vlm-task', engine.tasks, readPref(key('task'), ''), 'MORE_DETAILED_CAPTION');
        $('vlm-task').dataset.sig = '';
        const storageOpts = engine.storageOptions || [
            ['auto', 'Auto (models/ folder on localhost, else browser cache)'],
            ['browser', 'Browser cache'],
            ['folder', 'Choose a folder...']
        ];
        fillSelect('vlm-storage', storageOpts, readPref(key('storage'), readPref('tm_vlm_storage', '')), storageOpts[0][0]);
        $('vlm-pick-folder').textContent = '📁 Set model folder';   // engines may relabel it in refresh()
        applyVisibility();

        if (!engine.initDone) { engine.initDone = true; if (engine.init) await engine.init(ui); }
        if (engine !== next) return;
        await refreshModels();
        await refresh();
    }

    async function deactivate() {
        if (engine) { try { await engine.unload(ui); } catch (e) { /* ignore */ } }
        engine = null;
        curMode = '';
        restoreTaggerHardware();
    }

    /* ---------- Panel actions ---------- */
    const PANEL_IDS = ['vlm-model-select', 'vlm-unload', 'vlm-delete', 'vlm-storage', 'vlm-pick-folder', 'vlm-load',
        'vlm-task', 'batch-vlm-prompt', 'vlm-max-tokens', 'vlm-beams', 'vlm-threshold', 'vlm-prefix', 'vlm-exclude', 'vlm-output-mode', 'hardware-select'];

    function setBusyUi() {
        const off = busy || batchBusy;
        PANEL_IDS.forEach(id => { const el = $(id); if (el) el.disabled = off; });
        const c = $('vlm-cancel');
        if (c) {
            c.style.visibility = (busy || batchBusy) ? 'visible' : 'hidden';   // keeps its place → other buttons never move
            c.disabled = false;
            c.textContent = '⏹ Cancel';
        }
        if (engine) applyVisibility();
    }

    function fail(e) {
        progress.hide();
        if (e && e.cancelled) { ui.setStatus('Cancelled.'); return; }
        console.error(e);
        const msg = (e && e.message) || String(e);
        ui.setStatus('Error: ' + msg);
        ui.alert('Auto-Caption model action failed. ' + msg.slice(0, 140), 'error');
    }

    async function run(fn) {
        if (busy || batchBusy || !engine) return;
        cancelRequested = false;
        busy = true; setBusyUi();
        try { await fn(); }
        catch (e) { fail(e); }
        finally {
            progress.hide();
            busy = false; setBusyUi();
            await refreshModels();
            await refresh();
        }
    }

    function bind() {
        $('vlm-model-select').onchange = () => { writePref(key('model'), $('vlm-model-select').value); applyVisibility(); refresh(); };
        $('vlm-task').onchange = () => writePref(key('task'), $('vlm-task').value);
        $('vlm-storage').onchange = async () => {
            writePref(key('storage'), $('vlm-storage').value);
            applyVisibility();
            await refreshModels();
            await refresh();
        };
        $('hardware-select').addEventListener('change', () => {
            if (curMode) { writePref(key('device'), $('hardware-select').value); refresh(); }
            else writePref('tm_hw_tags', $('hardware-select').value);
        });
        ['vlm-max-tokens', 'vlm-beams', 'vlm-threshold', 'vlm-prefix', 'vlm-exclude', 'batch-vlm-prompt', 'vlm-output-mode'].forEach(id => {
            const saved = readPref('tm_' + id, null);
            if (saved !== null) $(id).value = saved;
            $(id).addEventListener('change', () => writePref('tm_' + id, $(id).value));
        });

        $('vlm-load').onclick = () => run(async () => {
            ui.setStatus('Loading model...');
            await engine.ensureLoaded(ui);
            ui.setStatus('Model ready.');
        });
        $('vlm-cancel').onclick = async () => {
            cancelRequested = true;
            $('vlm-cancel').disabled = true;
            $('vlm-cancel').textContent = 'Stopping...';
            try { await engine.cancel(ui); } catch (e) { /* ignore */ }
        };
        $('vlm-unload').onclick = () => run(async () => {
            const freed = await engine.unload(ui);
            ui.alert(freed ? 'Model unloaded from memory.' : 'No model is loaded in memory.', freed ? 'success' : 'info');
        });
        $('vlm-delete').onclick = () => run(async () => {
            const id = $('vlm-model-select').value;
            const where = engine.deleteTarget(ui, id);
            if (!confirm('Delete the downloaded files of "' + id + '" (' + where + ')? It will be downloaded again the next time you load it.')) return;
            const deleted = await engine.deleteModel(ui, id);
            ui.alert(deleted ? 'Model files deleted.' : 'Nothing to delete (already clean).', deleted ? 'success' : 'info');
        });
        $('vlm-pick-folder').onclick = () => run(async () => { if (engine.pickFolder) await engine.pickFolder(ui); });
    }

    /* ---------- What the batch loop uses ---------- */
    function outputKind() {
        const forced = $('vlm-output-mode').value;
        if (forced === 'nl' || forced === 'tags') return forced;
        const v = values();
        const kind = engine.taskKind(v.model);
        if (kind === 'tagger') return 'tags';
        if (kind === 'florence' && (v.task === 'GENERATE_TAGS' || v.task === 'OD')) return 'tags';
        return 'nl';
    }

    window.TMVlm = {
        engines,
        handles: mode => present() && !!MODE_ENGINE[mode] && !!engines[MODE_ENGINE[mode]],

        // Returns an error message (string) when the batch cannot start, otherwise ''.
        validate() {
            if (!engine) return 'The model engine is not ready yet.';
            if (!$('vlm-model-select').value) return 'Select a model first.';
            return '';
        },

        // Downloads / loads the model. Throws on error; error.cancelled when the user stopped it.
        async prepare() {
            cancelRequested = false;
            failStreak = 0;
            try {
                ui.setStatus('Loading model...');
                await engine.ensureLoaded(ui);
                ui.setStatus('Model ready.');
            } finally {
                progress.hide();
                await refreshModels();
                await refresh();
            }
        },

        // -> { text, kind:'nl'|'tags' } | { failed, fatal, error } | { cancelled }
        async captionImage(imgObj) {
            if (cancelRequested) return { cancelled: true };
            let blob;
            try { blob = await (await fetch(imgObj.url)).blob(); }
            catch (e) { return { failed: true, fatal: false, error: 'Could not read the image file.' }; }
            try {
                const out = await engine.generate(ui, blob);
                const text = String((out && out.text) || '').trim();
                if (!text) throw new Error('The model returned an empty result.');
                failStreak = 0;
                return { text, kind: outputKind() };
            } catch (e) {
                if (e && e.cancelled || cancelRequested) return { cancelled: true };
                failStreak++;
                return { failed: true, fatal: failStreak >= 3, error: ((e && e.message) || String(e)) + (failStreak >= 3 ? ' (3 failures in a row)' : '') };
            }
        },

        cancel() {
            cancelRequested = true;
            if (engine) { try { Promise.resolve(engine.cancel(ui)).catch(() => {}); } catch (e) { /* ignore */ } }
        },

        setBatchBusy(b) { batchBusy = !!b; if (present()) setBusyUi(); },
        hideProgress() { if (present()) progress.hide(); },
        activeMode: () => curMode
    };

    /* ---------- Hooks into the existing Auto-Caption window ---------- */
    const origUpdateBatchUI = window.updateBatchUI;
    window.updateBatchUI = function () {
        if (typeof origUpdateBatchUI === 'function') origUpdateBatchUI();
        if (!present()) return;
        const sel = $('batch-mode-select');
        const mode = sel ? sel.value : '';
        if (window.TMVlm.handles(mode)) {
            $('batch-vlm-settings').style.display = 'block';
            activate(mode);
        } else if (curMode) {
            deactivate();
        }
    };

    // The new panel uses a Task select + a plain-language prompt, so the old "token in the prompt box" logic is off.
    const origUpdatePrompt = window.updateVlmPromptDefault;
    window.updateVlmPromptDefault = function () {
        if (!present() && typeof origUpdatePrompt === 'function') origUpdatePrompt();
    };

    // Opening the window again → refresh what is on disk (models may have been added meanwhile).
    const origToggleMode = window.toggleMode;
    window.toggleMode = function () {
        if (typeof origToggleMode === 'function') origToggleMode();
        if (curMode && !busy && !batchBusy) { refreshModels().then(refresh); }
    };

    function init() {
        if (!present()) return;
        hwOriginal = $('hardware-select').innerHTML;
        restoreTaggerHardware();
        if (!engines.pytorch) {
            const opt = document.querySelector('#batch-mode-select option[value="pytorch"]');
            if (opt) opt.remove();   // PyTorch exists only on localhost
        }
        if (!engines.webgpu) {
            const opt = document.querySelector('#batch-mode-select option[value="nl-vlm"]');
            if (opt) opt.remove();
        }
        bind();
        setBusyUi();
        window.updateBatchUI();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else setTimeout(init, 0);
})();
