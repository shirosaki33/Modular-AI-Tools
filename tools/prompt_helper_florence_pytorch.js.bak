/* =========================================================================
   PROMPT HELPER — IMAGE → PROMPT: PYTORCH ENGINE (localhost only)

   The model runs in Python (server_max.py + florence_backend.py), not in the
   browser. This file is a thin client for /api/florence/*:
     status, models, load, generate, cancel, unload, clear_cache,
     pick_folder, add_folder, remove_folder

   What it lists (all found automatically, nothing to type):
     • Florence-2 and Florence-2 PromptGen v2.0 (downloaded on first load)
     • models/ → Hugging Face cache folders and plain model folders
       (safetensors / pytorch_model.bin): Florence-2 / PromptGen folders and
       other vision-language models
     • models/onnx → ONNX taggers (SmilingWolf WD14 style), run with the
       Python onnxruntime
     • any folder added with "📁 Add model folder" (stored by the server)

   It registers itself only on localhost / 127.0.0.1, so the Mode selector
   (and this engine) never appear on the online version.

   Needs: prompt_helper_florence.js (core) loaded first.
========================================================================= */
(function () {
    'use strict';

    const PH = window.PHFlorence;
    if (!PH) { console.error('[Florence/PyTorch] prompt_helper_florence.js must be loaded first.'); return; }
    if (!PH.isLocalhost) return;   // not registered → hidden outside localhost
    const { sleep, mb, cancelError } = PH.util;

    const MODELS = [
        ['MiaoshouAI/Florence-2-base-PromptGen-v2.0', 'Florence-2 Base PromptGen v2.0 (MiaoshouAI)'],
        ['MiaoshouAI/Florence-2-large-PromptGen-v2.0', 'Florence-2 Large PromptGen v2.0 (MiaoshouAI)'],
        ['florence-community/Florence-2-base-ft', 'Florence-2 Base FT (native)'],
        ['florence-community/Florence-2-large-ft', 'Florence-2 Large FT (native)'],
        ['microsoft/Florence-2-base-ft', 'Florence-2 Base FT (microsoft, remote code)'],
        ['microsoft/Florence-2-large-ft', 'Florence-2 Large FT (microsoft, remote code)']
    ];
    const DEVICES = [
        ['auto', '🚀 Auto (CUDA if available)'],
        ['cuda', '🚀 GPU (CUDA)'],
        ['cpu', '🐌 CPU']
    ];
    const TASKS = [
        ['CAPTION', 'Caption (short)'],
        ['DETAILED_CAPTION', 'Detailed caption'],
        ['MORE_DETAILED_CAPTION', 'More detailed caption'],
        ['OCR', 'OCR (read text)'],
        ['OD', 'Object labels (tag-like list)']
    ];
    // MiaoshouAI/Florence-2-*-PromptGen-v2.0
    const TASKS_PROMPTGEN = [
        ['GENERATE_TAGS', 'Generate tags'],
        ['CAPTION', 'Caption (short)'],
        ['DETAILED_CAPTION', 'Detailed caption'],
        ['MORE_DETAILED_CAPTION', 'More detailed caption'],
        ['ANALYZE', 'Analyze (composition)'],
        ['MIXED_CAPTION', 'Mixed caption'],
        ['MIXED_CAPTION_PLUS', 'Mixed caption + (most detailed)']
    ];
    // Same rule as florence_backend.py (ALLOWED_PREFIXES) for models that get downloaded.
    const ALLOWED = ['microsoft/Florence-2', 'florence-community/Florence-2', 'MiaoshouAI/Florence-2'];
    const isAllowed = id => ALLOWED.some(p => id.startsWith(p));
    const isTagger = id => String(id).startsWith('tagger:');
    const isLocal = id => String(id).startsWith('local:');

    // id -> { family: 'florence'|'promptgen'|'vlm'|'tagger' } for everything listed or known
    const meta = new Map(MODELS.map(([id]) => [id, { family: id.toLowerCase().includes('promptgen') ? 'promptgen' : 'florence' }]));
    const familyOf = id => (isTagger(id) ? 'tagger' : ((meta.get(id) || {}).family || (String(id).toLowerCase().includes('promptgen') ? 'promptgen' : 'florence')));

    /* ---------- API ---------- */
    async function api(path, opts) {
        const r = await fetch('/api/florence/' + path, opts);
        let data = null;
        try { data = await r.json(); } catch (e) { /* not JSON (static server 404) */ }
        if (!r.ok) {
            const msg = (data && data.error) || ('HTTP ' + r.status);
            if (msg === 'Cancelled.') throw cancelError();
            throw new Error(msg);
        }
        return data;
    }
    const post = (path, obj) => api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(obj || {})
    });
    const statusUrl = ui => 'status?model=' + encodeURIComponent(ui.values().model);

    /* ---------- Model list (auto-detected) ---------- */
    const mark = (found, id) => found ? (found.has(id) ? '✅ ' : '⬇️ ') : '';
    const sz = n => (n >= 1048576 ? ` · ${mb(n)} MB` : '');
    let lastCount = 0;

    async function listModels() {
        let data = null;
        try { data = await api('models'); } catch (e) { /* old server / offline: static list only */ }
        const found = data ? new Set((data.hub || []).map(m => m.id)) : null;
        const list = MODELS.map(([id, label]) => [id, mark(found, id) + label]);
        lastCount = 0;
        if (data) {
            (data.hub || []).forEach(m => {
                if (!MODELS.some(x => x[0] === m.id) && isAllowed(m.id)) {
                    meta.set(m.id, { family: m.id.toLowerCase().includes('promptgen') ? 'promptgen' : 'florence' });
                    list.push([m.id, '✅ ' + m.id + ' (detected)']);
                }
            });
            (data.local || []).forEach(m => {
                meta.set(m.id, { family: m.family });
                const what = m.family === 'promptgen' ? 'PromptGen' : m.family === 'florence' ? 'Florence-2' : (m.model_type || 'VLM');
                list.push([m.id, `📁 ${m.name} (${what}${m.source === 'folder' ? ', added folder' : ''}${sz(m.size)})`]);
                lastCount++;
            });
            (data.taggers || []).forEach(m => {
                meta.set(m.id, { family: 'tagger' });
                list.push([m.id, `🏷️ ${m.name} (ONNX tagger${sz(m.size)})`]);
                lastCount++;
            });
        }
        return list;
    }

    /* ---------- Status ---------- */
    function paint(ui, st) {
        const v = ui.values();
        const tagger = isTagger(v.model);
        if (!st) {
            ui.setBadge('⚠️ Server offline', 'online');
            ui.setInfo('Could not reach the Florence endpoint. Use the updated server_max.py, put florence_backend.py next to it and restart.');
            ui.setModelStatus('');
            return;
        }
        if (!st.available) {
            ui.setBadge(tagger ? '⚠️ ONNX Runtime missing' : '⚠️ PyTorch missing', 'online');
            ui.setInfo(st.deps_error);
            ui.setModelStatus('');
            return;
        }
        ui.setBadge(st.cuda ? '🔥 CUDA: ' + st.gpu : '🖥️ CPU only', 'local');
        ui.setInfo((tagger
            ? `ONNX Runtime ${st.onnxruntime} (${(st.providers || []).map(p => p.replace('ExecutionProvider', '')).join(', ')})`
            : `PyTorch ${st.torch} · Transformers ${st.transformers}`) +
            ' · downloads go to models/ · "Add model folder" adds more places to search.');
        if (st.state === 'loading') ui.setModelStatus('⏳ ' + (st.message || 'Loading...'));
        else if (st.loaded && st.loaded.model === v.model) ui.setModelStatus(`✅ Loaded in memory (${st.loaded.device}).`);
        else if (st.cached) ui.setModelStatus(isLocal(v.model) || tagger ? '✅ Local files found — ready to load.' : '✅ Model files found — ready to load.');
        else ui.setModelStatus('⬇️ Not downloaded yet — the first load downloads the model files.');
    }

    async function refresh(ui) {
        const btn = ui.$('fPickFolder');
        if (btn) btn.textContent = '📁 Add model folder';
        let st = null;
        try { st = await api(statusUrl(ui)); } catch (e) { /* offline */ }
        paint(ui, st);
    }

    /* ---------- Loading ---------- */
    function showProgress(ui, st) {
        const p = st.progress || {};
        if (p.total > 0 && p.loaded > 0) {
            ui.progress.set(p.loaded / p.total,
                `${st.message || 'Downloading...'} ${Math.min(100, Math.round(p.loaded / p.total * 100))}% (${mb(p.loaded)} / ${mb(p.total)} MB)`);
        } else {
            ui.progress.indeterminate(st.message || 'Working...');
        }
    }

    async function pollLoad(ui) {
        for (;;) {
            const st = await api(statusUrl(ui));
            paint(ui, st);
            if (st.state === 'loading') { showProgress(ui, st); await sleep(500); continue; }
            if (st.state === 'ready') return st;
            if (st.state === 'cancelled' || st.error === 'Cancelled.') throw cancelError();
            throw new Error(st.error || 'Model load failed.');
        }
    }

    async function ensureLoaded(ui) {
        const v = ui.values();
        if (!v.model) throw new Error('Select a model first.');
        const st = await api(statusUrl(ui));
        if (!st.available) throw new Error(st.deps_error);
        if (st.state === 'ready' && st.loaded && st.loaded.model === v.model && st.loaded.device_pref === v.device) return;
        if (st.state !== 'loading') await post('load', { model: v.model, device: v.device });
        const what = isTagger(v.model) ? 'ONNX tagger' : (familyOf(v.model) === 'promptgen' ? 'PromptGen' : 'model');
        ui.progress.indeterminate(`Loading ${what}...`);
        ui.setStatus(`Loading ${what}...`);
        await pollLoad(ui);
    }

    /* ---------- Inference ---------- */
    async function generate(ui, file) {
        const v = ui.values();
        const qs = new URLSearchParams({ task: v.task, max_tokens: String(v.maxTokens), beams: String(v.beams) });
        if (familyOf(v.model) === 'vlm') qs.set('prompt', v.prompt);
        if (isTagger(v.model)) {
            qs.set('threshold', String(v.threshold));
            qs.set('exclude', v.exclude);
            qs.set('prefix', v.prefix);
        }
        const out = await api('generate?' + qs, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file
        });
        return { text: out.text || '', seconds: out.seconds, device: out.device };
    }

    /* ---------- Management ---------- */
    async function cancel() { await post('cancel'); }

    async function unload(ui) {
        let had = false;
        try { had = !!(await api(statusUrl(ui))).loaded; } catch (e) { /* offline */ }
        await post('unload');
        return had;
    }

    async function deleteModel(ui, id) {
        return !!(await post('clear_cache', { model: id })).deleted;
    }

    // Native folder dialog on the machine running the server; falls back to typing the path.
    async function pickFolder(ui) {
        let path = '';
        try {
            const r = await post('pick_folder');
            if (!r.path) return;                       // dialog closed
            path = r.path;
            ui.alert(r.added ? 'Folder added: ' + path : 'That folder was already added.', r.added ? 'success' : 'info');
            return;
        } catch (e) {
            if (e && e.cancelled) throw e;
            console.warn('[Florence/PyTorch] folder dialog unavailable:', e.message);
        }
        path = window.prompt('The folder dialog is not available on this machine.\nType the full path of the folder that contains your models:', '');
        if (!path || !path.trim()) return;
        const r = await post('add_folder', { path: path.trim() });
        ui.alert(r.added ? 'Folder added: ' + r.path : 'That folder was already added.', r.added ? 'success' : 'info');
    }

    PH.registerEngine({
        id: 'pytorch',
        label: '🔥 PyTorch / ONNX (local server)',
        order: 3,
        available: true,
        models: MODELS,
        devices: DEVICES,
        defaultDevice: 'auto',
        tasks: TASKS,
        features: {
            beams: true,
            storage: false,
            pickFolder: true,
            // Only models downloaded by this app can be deleted; user folders are never touched.
            canDelete: (ui, id) => !isLocal(id) && !isTagger(id)
        },
        taskKind: id => (isTagger(id) ? 'tagger' : (familyOf(id) === 'vlm' ? 'prompt' : 'florence')),
        tasksFor: id => (familyOf(id) === 'promptgen' ? TASKS_PROMPTGEN : TASKS),
        listModels, refresh, ensureLoaded, generate,
        cancel, unload, pickFolder,
        deleteTarget: () => 'models/ folder',
        deleteModel
    });
})();
