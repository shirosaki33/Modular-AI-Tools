/* =========================================================================
   PROMPT HELPER — IMAGE → PROMPT TAB (shared core)

   Owns everything both engines share: the Mode selector, the controls,
   image input, progress bar, result box, busy / cancel handling and the
   status panel. The models themselves live in engine files that
   register themselves here:

     prompt_helper_florence_webgpu.js   browser: WebGPU / WASM VLMs (any origin)
     prompt_helper_florence_onnx.js     browser: ONNX taggers, onnxruntime-web (any origin)
     prompt_helper_florence_pytorch.js  Python server: PyTorch + ONNX Runtime (localhost only)

   Load order in the HTML: this file FIRST, then the engines.
   Depends on: prompt_helper_settings.js (showAlert)
               prompt_helper_ui.js       (onPromptHelperTab)

   ENGINE CONTRACT  (window.PHFlorence.registerEngine(engine))
   ---------------------------------------------------------------------
   id, label, order, available            identity / visibility of the mode
   models      [[value,label],...]        static list (used before any scan)
   devices     [[value,label],...]        hardware choices
   defaultDevice, tasks [[value,label]]
   features    { beams, storage, pickFolder, canDelete }
                                          which extra controls are shown
                                          (pickFolder / canDelete may be fn(ui)/fn(ui,id))
   storageOptions [[value,label],...]     optional, replaces the Storage choices
   taskKind(modelId)  'florence' | 'prompt' | 'tagger'
                                          task list / free prompt / tagger controls
   tasksFor(modelId) -> [[value,label]]   optional, task list that depends on the model
   init(ui)                               once, first time the mode is used
   listModels(ui)     -> [[value,label]]  list with ✅ / ⬇️ markers
   refresh(ui)                            paint badge / info / model status
   ensureLoaded(ui)                       download + load (if needed)
   generate(ui, file) -> {text,seconds,device}
   cancel(ui), unload(ui) -> bool, deleteTarget(ui,id) -> string,
   deleteModel(ui,id) -> bool, pickFolder(ui)   (last one optional)
========================================================================= */
(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const DEFAULT_PROMPT = 'Describe this image in detail.';

    const DEFAULT_STORAGE = [
        ['auto', 'Auto (models/ folder on localhost, else browser cache)'],
        ['browser', 'Browser cache'],
        ['folder', 'Choose a folder...']
    ];

    const REQUIRED_IDS = [
        'fTaggerRow', 'fThreshold', 'fTokensRow',
        'fMode', 'fModeRow', 'fStorage', 'fStorageRow', 'fPickFolder', 'fModel', 'fDevice', 'fTask', 'fTaskLabel',
        'fMaxTokens', 'fBeams', 'fBeamsLabel', 'fPrompt', 'fPromptRow', 'fDrop', 'fFile', 'fPreview', 'fDropText',
        'fProgressWrap', 'fProgressBar', 'fProgressText', 'fGenerate', 'fCancel', 'fLoad', 'fClearBtn', 'fUnload',
        'fClearCache', 'fResult', 'fCopy', 'fTranslateBtn', 'fTransTo', 'fTranslation', 'fCopyTrans', 'fStatus', 'fStorageBadge', 'fStorageText', 'fModelStatus',
        'tab-florence'
    ];

    const engines = {};
    let engine = null;
    let mode = '';
    let busy = false;
    let cancelRequested = false;
    let currentFile = null;
    let previewUrl = null;

    /* ---------- Small helpers ---------- */
    const mb = n => (n / 1048576).toFixed(0);
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const clamp = (n, lo, hi, fb) => { n = parseInt(n, 10); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb; };
    function readPref(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : v; } catch (e) { return fb; } }
    function writePref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
    const key = name => 'ph_' + name + '_' + mode;
    function cancelError() { const e = new Error('Cancelled.'); e.cancelled = true; return e; }

    /* ---------- Styles ---------- */
    const style = document.createElement('style');
    style.textContent = `
        #tab-florence { overflow-y: auto; }
        .fl-box { background:#0d0d0d; border:1px solid #1e2a3a; border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px; flex-shrink:0; }
        .fl-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; flex-shrink:0; }
        .fl-row select { min-width:130px; }
        .fl-drop { border:2px dashed #2a3a2e; border-radius:10px; background:#0d0d0d; min-height:150px; display:flex; align-items:center; justify-content:center; text-align:center; color:#777; font-size:13px; cursor:pointer; padding:10px; flex-shrink:0; transition:.15s; }
        .fl-drop:hover, .fl-drop.drag { border-color:#00aa66; color:#00ff99; background:#0d1f13; }
        .fl-drop img { max-width:100%; max-height:240px; object-fit:contain; border-radius:6px; display:none; }
        .fl-progress { height:10px; background:#111; border:1px solid #333; border-radius:6px; overflow:hidden; visibility:hidden; flex-shrink:0; }
        #fProgressText { min-height:16px; visibility:hidden; }
        #fStorageText, #fModelStatus { min-height:2.8em; line-height:1.4; }
        #fStatus { min-height:2.8em; line-height:1.4; }
        #fTranslation { min-height:70px; resize:vertical; font-size:14px; line-height:1.5; padding:12px; background:#0a1018; border:1px solid #1a2a3e; color:#c9b8ff; border-radius:8px; font-weight:normal; flex-shrink:0; }
        #fTranslation:focus { border-color:#4a2a8c; }
        #fClearCache:disabled, #fUnload:disabled { opacity:.45; cursor:not-allowed; }
        .fl-progress > div { height:100%; width:0; background:#00ff99; transition:width .15s; }
        .fl-progress.indeterminate > div { width:35% !important; animation: flSlide 1.1s infinite ease-in-out; }
        @keyframes flSlide { 0% { margin-left:-35%; } 100% { margin-left:100%; } }
        #fResult { min-height:120px; resize:vertical; font-size:14px; line-height:1.5; padding:12px; background:#0a1210; border:1px solid #1a3a2e; color:#9ecfff; border-radius:8px; font-weight:normal; flex-shrink:0; }
        #fResult:focus { border-color:#00aa66; }
        #fCancel { background:#4a1118; color:#ffb6c0; border:1px solid #7a222c; visibility:hidden; }
        #fCancel:hover { background:#6a1822; color:#fff; }
    `;
    document.head.appendChild(style);

    /* ---------- Registry (engines call this at load time) ---------- */
    window.PHFlorence = {
        isLocalhost,
        registerEngine(e) { engines[e.id] = e; },
        util: { sleep, mb, cancelError }
    };

    /* ---------- Form helpers ---------- */
    function fillSelect(id, opts, saved, fallback) {
        const el = $(id);
        el.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
        const has = v => opts.some(o => o[0] === v);
        el.value = has(saved) ? saved : (has(fallback) ? fallback : (opts[0] ? opts[0][0] : ''));
    }

    function values() {
        return {
            mode,
            model: $('fModel').value,
            device: $('fDevice').value,
            task: $('fTask').value,
            prompt: $('fPrompt').value.trim() || DEFAULT_PROMPT,
            maxTokens: clamp($('fMaxTokens').value, 16, 1024, 256),
            beams: clamp($('fBeams').value, 1, 8, 3),
            storage: $('fStorage').value,
            threshold: Math.min(1, Math.max(0, parseFloat($('fThreshold').value) || 0.35)),
            exclude: '',   // detection only: no tag editing
            prefix: ''
        };
    }

    function show(id, on) { const el = $(id); if (el) el.style.display = on ? '' : 'none'; }

    const feature = (f, ...args) => (typeof f === 'function' ? !!f(ui, ...args) : !!f);

    // Some engines have a different task list per model (e.g. PromptGen).
    function syncTasks() {
        if (!engine.tasksFor) return;
        const list = engine.tasksFor($('fModel').value) || engine.tasks;
        const sig = list.map(t => t[0]).join('|');
        if ($('fTask').dataset.sig === sig) return;
        $('fTask').dataset.sig = sig;
        fillSelect('fTask', list, readPref(key('fTask'), '') || $('fTask').value, 'MORE_DETAILED_CAPTION');
    }

    function applyVisibility() {
        const model = $('fModel').value;
        const kind = engine.taskKind(model);
        syncTasks();
        show('fTask', kind === 'florence');
        show('fTaskLabel', kind === 'florence');
        show('fPromptRow', kind === 'prompt');
        show('fTaggerRow', kind === 'tagger');
        show('fTokensRow', kind !== 'tagger');
        show('fBeams', !!engine.features.beams && kind !== 'tagger');
        show('fBeamsLabel', !!engine.features.beams && kind !== 'tagger');
        const pick = engine.features.pickFolder;
        const pickOn = pick === undefined
            ? (!!engine.features.storage && $('fStorage').value === 'folder')
            : feature(pick);
        // The row also holds the folder button, so it stays when only the button is needed.
        show('fStorageRow', !!engine.features.storage || pickOn);
        show('fStorageLabel', !!engine.features.storage);
        show('fStorage', !!engine.features.storage);
        show('fPickFolder', pickOn);
        // Never hidden (the rows would jump): dimmed + disabled when this model is not stored by the app.
        const canDel = engine.features.canDelete === undefined ? true : feature(engine.features.canDelete, model);
        $('fClearCache').disabled = !canDel;
        $('fClearCache').title = canDel ? 'Delete the downloaded files of the selected model'
            : 'Not available: this model is not stored by the app (local folder / browser file)';
    }

    /* ---------- Progress bar ---------- */
    const progress = {
        show() { $('fProgressWrap').style.visibility = 'visible'; $('fProgressText').style.visibility = 'visible'; },
        hide() {
            $('fProgressWrap').style.visibility = 'hidden';
            $('fProgressWrap').classList.remove('indeterminate');
            $('fProgressText').style.visibility = 'hidden';
            $('fProgressBar').style.width = '0%';
        },
        set(frac, text) {
            this.show();
            $('fProgressWrap').classList.remove('indeterminate');
            $('fProgressBar').style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%';
            $('fProgressText').textContent = text || '';
        },
        indeterminate(text) {
            this.show();
            $('fProgressWrap').classList.add('indeterminate');
            $('fProgressText').textContent = text || 'Working...';
        }
    };

    /* ---------- What engines get ---------- */
    const ui = {
        $, isLocalhost, values, progress,
        alert: (msg, type) => { if (window.showAlert) window.showAlert(msg, type || 'info'); },
        setBadge(text, cls) { $('fStorageBadge').textContent = text; $('fStorageBadge').className = 'cache-badge ' + (cls || ''); },
        setInfo(text) { $('fStorageText').textContent = text || ''; },
        setModelStatus(text) { $('fModelStatus').textContent = text || ''; },
        setStatus(text) { $('fStatus').textContent = text || ''; },
        isCancelled: () => cancelRequested,
        cancelError
    };

    /* ---------- Status / model list ---------- */
    async function refresh() {
        const eng = engine;
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
        let list = eng.models;
        try { if (eng.listModels) list = (await eng.listModels(ui)) || list; }
        catch (e) { console.warn('[Florence] could not list models:', e); }
        if (eng !== engine) return;   // mode changed meanwhile
        fillSelect('fModel', list, $('fModel').value, list[0] && list[0][0]);
        applyVisibility();
    }

    /* ---------- Mode switching ---------- */
    async function applyMode(next, initial) {
        const nextEngine = engines[next];
        if (!nextEngine) return;
        if (engine && engine !== nextEngine) {
            // Free the other mode's model (browser memory or Python process).
            try { await engine.unload(ui); } catch (e) { /* ignore */ }
        }
        engine = nextEngine;
        mode = next;
        writePref('ph_fMode', mode);
        $('fMode').value = mode;

        fillSelect('fModel', engine.models, readPref(key('fModel'), ''), engine.models[0][0]);
        fillSelect('fDevice', engine.devices, readPref(key('fDevice'), ''), engine.defaultDevice);
        fillSelect('fTask', engine.tasks, readPref(key('fTask'), ''), 'MORE_DETAILED_CAPTION');
        $('fPickFolder').textContent = '📁 Set model folder';   // engines may relabel it in refresh()
        $('fTask').dataset.sig = '';
        const storageOpts = engine.storageOptions || DEFAULT_STORAGE;
        fillSelect('fStorage', storageOpts, readPref(key('fStorage'), readPref('ph_fStorage', '')), storageOpts[0][0]);
        applyVisibility();

        if (!engine.initDone) { engine.initDone = true; if (engine.init) await engine.init(ui); }
        // Callers refresh the model list / status (run2 does it after a switch,
        // and the tab hook does it the first time the tab is opened).
    }

    /* ---------- Busy / cancel ---------- */
    const BUSY_IDS = ['fGenerate', 'fLoad', 'fPickFolder', 'fClearCache', 'fUnload', 'fMode', 'fModel', 'fDevice',
        'fTask', 'fStorage', 'fMaxTokens', 'fBeams', 'fPrompt', 'fThreshold'];

    function setBusy(b) {
        busy = b;
        BUSY_IDS.forEach(id => { const el = $(id); if (el) el.disabled = b; });
        const c = $('fCancel');
        c.style.visibility = b ? 'visible' : 'hidden';   // keeps its place → the other buttons never move
        c.disabled = false;
        c.textContent = '⏹ Cancel';
    }

    function fail(e) {
        progress.hide();
        if (e && e.cancelled) { ui.setStatus('Cancelled.'); return; }
        console.error(e);
        const msg = (e && e.message) || String(e);
        ui.setStatus('Error: ' + msg);
        ui.alert('Image → Prompt failed. ' + msg.slice(0, 140), 'error');
    }

    async function run(fn) {
        if (busy) return;
        cancelRequested = false;
        setBusy(true);
        try { await fn(); }
        catch (e) { fail(e); }
        finally {
            progress.hide();
            setBusy(false);
            await refreshModels();
            await refresh();
        }
    }

    /* ---------- Image input ---------- */
    function setImage(file) {
        if (!file || !file.type.startsWith('image/')) { ui.alert('Please use an image file.', 'warn'); return; }
        currentFile = file;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        $('fPreview').src = previewUrl;
        $('fPreview').style.display = 'block';
        $('fDropText').style.display = 'none';
        ui.setStatus(file.name + ' loaded.');
    }

    /* ---------- Init ---------- */
    async function init() {
        const missing = REQUIRED_IDS.filter(id => !$(id));
        if (missing.length) {
            console.error('[Florence] "prompt helper.html" is outdated. Missing element ids: ' + missing.join(', '));
            return;
        }
        const list = Object.values(engines).filter(e => e.available !== false)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        if (!list.length) {
            ui.setBadge('⚠️ No engine', 'online');
            ui.setInfo('No Florence engine script was loaded. Check the <script> tags in prompt helper.html.');
            return;
        }

        fillSelect('fMode', list.map(e => [e.id, e.label]), readPref('ph_fMode', ''), list[0].id);
        show('fModeRow', list.length > 1);   // outside localhost only the browser engines exist; one engine → no selector

        ['fMaxTokens', 'fBeams', 'fPrompt', 'fThreshold', 'fTransTo'].forEach(id => {
            const saved = readPref('ph_' + id, null);
            if (saved !== null) $(id).value = saved;
            $(id).addEventListener('change', () => writePref('ph_' + id, $(id).value));
        });

        $('fMode').onchange = () => run2(() => applyMode($('fMode').value));
        $('fModel').onchange = () => { writePref(key('fModel'), $('fModel').value); applyVisibility(); refresh(); };
        $('fDevice').onchange = () => { writePref(key('fDevice'), $('fDevice').value); refresh(); };
        $('fTask').onchange = () => writePref(key('fTask'), $('fTask').value);
        $('fStorage').onchange = async () => {
            writePref(key('fStorage'), $('fStorage').value);
            applyVisibility();
            await refreshModels();
            await refresh();
        };

        const drop = $('fDrop');
        drop.onclick = () => $('fFile').click();
        $('fFile').onchange = e => { if (e.target.files[0]) setImage(e.target.files[0]); e.target.value = ''; };
        drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag'); };
        drop.ondragleave = () => drop.classList.remove('drag');
        drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) setImage(e.dataTransfer.files[0]); };
        document.addEventListener('paste', e => {
            if (!$('tab-florence').classList.contains('active')) return;
            const item = Array.from(e.clipboardData ? e.clipboardData.items : []).find(i => i.type.startsWith('image/'));
            if (item) setImage(item.getAsFile());
        });

        $('fLoad').onclick = () => run(async () => {
            ui.setStatus('Loading model...');
            await engine.ensureLoaded(ui);
            ui.setStatus('Model ready.');
        });

        $('fGenerate').onclick = () => run(async () => {
            if (!currentFile) { ui.alert('Add an image first.', 'warn'); return; }
            await engine.ensureLoaded(ui);
            ui.setStatus('Generating...');
            progress.indeterminate('Generating...');
            $('fResult').value = '';
            $('fTranslation').value = '';
            const out = await engine.generate(ui, currentFile);
            $('fResult').value = out.text || '';
            ui.setStatus(`Done in ${out.seconds}s (${out.device}).`);
        });

        $('fCancel').onclick = async () => {
            cancelRequested = true;
            $('fCancel').disabled = true;
            $('fCancel').textContent = 'Stopping...';
            try { await engine.cancel(ui); } catch (e) { /* ignore */ }
        };

        $('fUnload').onclick = () => run(async () => {
            const freed = await engine.unload(ui);
            ui.alert(freed ? 'Model unloaded from memory.' : 'No model is loaded in memory.', freed ? 'success' : 'info');
        });

        $('fClearCache').onclick = () => run(async () => {
            const id = $('fModel').value;
            const where = engine.deleteTarget(ui, id);
            if (!confirm('Delete the downloaded files of "' + id + '" (' + where + ')? It will be downloaded again the next time you load it.')) return;
            const deleted = await engine.deleteModel(ui, id);
            ui.alert(deleted ? 'Model files deleted.' : 'Nothing to delete (already clean).', deleted ? 'success' : 'info');
        });

        $('fPickFolder').onclick = () => run(async () => {
            if (engine.pickFolder) await engine.pickFolder(ui);
        });

        $('fClearBtn').onclick = () => {
            currentFile = null;
            if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
            $('fPreview').style.display = 'none';
            $('fPreview').removeAttribute('src');
            $('fDropText').style.display = '';
            $('fResult').value = '';
            $('fTranslation').value = '';
            transSeq++;
            ui.setStatus('');
        };

        $('fCopy').onclick = async () => {
            const v = $('fResult').value;
            if (!v.trim()) { ui.alert('Nothing to copy.', 'warn'); return; }
            try { await navigator.clipboard.writeText(v); ui.alert('Copied!', 'success'); }
            catch (e) { $('fResult').select(); document.execCommand('copy'); }
        };

        // Translation is shown right below the result — it no longer jumps to the Google Translate tab.
        let transSeq = 0;
        $('fTranslateBtn').onclick = async () => {
            const text = $('fResult').value.trim();
            if (!text) { ui.alert('Nothing to translate.', 'warn'); return; }
            if (typeof window.googleCall !== 'function' && typeof googleCall !== 'function') {
                ui.alert('The Google Translate module is not loaded (prompt_helper_google.js).', 'error');
                return;
            }
            const seq = ++transSeq;
            const btn = $('fTranslateBtn');
            btn.disabled = true;
            ui.setStatus('Translating...');
            try {
                const r = await googleCall(text, 'auto', $('fTransTo').value);
                if (seq !== transSeq) return;
                $('fTranslation').value = r.translation || '';
                ui.setStatus('Translated.');
            } catch (e) {
                if (seq !== transSeq) return;
                ui.setStatus('Translation failed: ' + ((e && e.message) || e));
                ui.alert('Google Translate failed.', 'error');
            } finally { btn.disabled = false; }
        };

        $('fCopyTrans').onclick = async () => {
            const v = $('fTranslation').value;
            if (!v.trim()) { ui.alert('Nothing to copy.', 'warn'); return; }
            try { await navigator.clipboard.writeText(v); ui.alert('Copied!', 'success'); }
            catch (e) { $('fTranslation').select(); document.execCommand('copy'); }
        };

        window.onPromptHelperTab = window.onPromptHelperTab || {};
        window.onPromptHelperTab['florence'] = async () => { if (!busy) { await refreshModels(); await refresh(); } };

        await applyMode($('fMode').value, true);
    }

    // Mode switching is a "busy" operation too (it may unload the other engine).
    async function run2(fn) {
        if (busy) return;
        setBusy(true);
        try { await fn(); }
        catch (e) { fail(e); }
        finally { setBusy(false); await refreshModels(); await refresh(); }
    }

    // Engines register while the page is still parsing, so wait for DOMContentLoaded.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else setTimeout(init, 0);
})();
