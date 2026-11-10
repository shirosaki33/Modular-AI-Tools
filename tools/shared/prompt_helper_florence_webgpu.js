/* =========================================================================
   PROMPT HELPER — IMAGE → PROMPT: WEBGPU ENGINE (runs in the browser)

   Same method as the Tag Manager batch tagger (tagmanager_batch_tagger.js):
   Transformers.js 3.8.1 from the CDN, Florence-2 (ONNX) and SmolVLM, with
   the GPU → GPU (no graph optimization) → CPU WASM fallback chain.
   Works on any origin, so it is the only mode available online.

   Where the model files live (the "Storage" field):
     Auto     localhost: the models/ folder next to the HTML (via server_max.py,
              found automatically). Anywhere else: the browser cache.
     Browser  the browser Cache API ("transformers-cache"), like the batch tagger.
     Folder   a folder you pick (File System Access API, Chrome / Edge). Expected
              layout: <folder>/<org>/<model>/{config.json, onnx/*.onnx, ...}.
   The server and folder layouts are identical, so models can be copied between
   them. Models found in the selected storage are listed automatically.

   Needs: prompt_helper_florence.js (core) loaded first.
========================================================================= */
(function () {
    'use strict';

    const PH = window.PHFlorence;
    if (!PH) { console.error('[Florence/WebGPU] prompt_helper_florence.js must be loaded first.'); return; }
    const { mb, cancelError } = PH.util;

    const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
    const BROWSER_CACHE = 'transformers-cache';
    const DB_NAME = 'PromptHelperDB', DB_STORE = 'handles', DB_KEY = 'florence_models_dir';

    const MODELS = [
        ['onnx-community/Florence-2-base-ft', 'Florence-2 Base FT (~300 MB) — great captions, WebGPU can be unstable'],
        ['HuggingFaceTB/SmolVLM-256M-Instruct', 'SmolVLM 256M Instruct (~200 MB) — fast, stable on WebGPU'],
        ['HuggingFaceTB/SmolVLM-500M-Instruct', 'SmolVLM 500M Instruct (~450 MB) — better quality']
    ];
    const DEVICES = [
        ['webgpu', '🚀 GPU (WebGPU)'],
        ['wasm', '🐌 CPU (WASM)']
    ];
    const TASKS = [
        ['CAPTION', 'Caption (short)'],
        ['DETAILED_CAPTION', 'Detailed caption'],
        ['MORE_DETAILED_CAPTION', 'More detailed caption'],
        ['OCR', 'OCR (read text)'],
        ['OD', 'Object labels (tag-like list)']
    ];

    const isFlorence = id => /florence/i.test(id || '');
    const isDetectable = id => /florence|smolvlm/i.test(id || '');

    const state = {
        lib: null,
        loaded: null,            // { model, device, devicePref, obj: { model, processor } }
        stopper: null,
        found: null,             // Set of model ids found in the current storage
        foundStorage: '',
        serverOk: false,
        folder: { handle: null, models: new Map() }
    };

    /* ======================================================================
       Text helpers (from the batch tagger)
    ====================================================================== */
    const tidy = t => String(t || '').replace(/<\/?s>|<pad>/g, '').replace(/\s+/g, ' ').trim();

    /* Typical LLM noise: markdown fences, "Here is the description:", bold, line breaks. */
    function cleanLLMText(text) {
        let t = String(text || '').trim();
        t = t.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
        t = t.replace(/^\s*(sure[!,.]?\s*)?(here('s| is| are)[^:\n]{0,80}:)\s*/i, '');
        t = t.replace(/\*\*|__/g, '').replace(/^\s*[*#>]+\s*/gm, '');
        t = t.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\s{2,}/g, ' ');
        return t.trim();
    }

    /* Florence returns text for caption / OCR tasks and { bboxes, labels } for OD. */
    function florenceText(out, token) {
        if (typeof out === 'string') {
            const t = out.startsWith(token) ? out.slice(token.length) : out;
            return tidy(t);
        }
        if (out && Array.isArray(out.labels)) {
            const seen = new Set(), labels = [];
            out.labels.forEach(l => {
                const k = tidy(l).toLowerCase();
                if (k && !seen.has(k)) { seen.add(k); labels.push(k); }
            });
            return labels.join(', ');
        }
        throw new Error('This Florence-2 task returned structured data that is not supported as text.');
    }

    /* ======================================================================
       Folder storage (File System Access API)
    ====================================================================== */
    function openDb() {
        return new Promise((res, rej) => {
            try {
                const r = indexedDB.open(DB_NAME, 1);
                r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
                r.onsuccess = () => res(r.result);
                r.onerror = () => rej(r.error);
            } catch (e) { rej(e); }
        });
    }
    async function saveHandle(h) {
        try {
            const db = await openDb();
            await new Promise((res, rej) => {
                const tx = db.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE).put(h, DB_KEY);
                tx.oncomplete = res;
                tx.onerror = () => rej(tx.error);
            });
            db.close();
        } catch (e) { console.warn('[Florence/WebGPU] could not remember the model folder:', e); }
    }
    async function loadHandle() {
        try {
            const db = await openDb();
            const h = await new Promise(res => {
                const req = db.transaction(DB_STORE).objectStore(DB_STORE).get(DB_KEY);
                req.onsuccess = () => res(req.result || null);
                req.onerror = () => res(null);
            });
            db.close();
            return h;
        } catch (e) { return null; }
    }

    async function folderPerm(h, write, request) {
        if (!h) return 'none';
        const opts = { mode: write ? 'readwrite' : 'read' };
        try {
            let p = await h.queryPermission(opts);
            if (p !== 'granted' && request) p = await h.requestPermission(opts);
            return p;
        } catch (e) { return 'denied'; }
    }

    /* Finds <root>/<org>/<name>/ folders that hold config.json + onnx/*.onnx. */
    async function scanFolder(root) {
        const out = new Map();
        async function walk(dir, parts) {
            if (parts.length === 2) {
                try {
                    await dir.getFileHandle('config.json');
                    const onnx = await dir.getDirectoryHandle('onnx');
                    for await (const e of onnx.values()) {
                        if (e.kind === 'file' && /\.onnx$/i.test(e.name)) { out.set(parts.join('/'), dir); break; }
                    }
                } catch (e) { /* not a model folder */ }
                return;
            }
            for await (const e of dir.values()) {
                if (e.kind === 'directory' && !e.name.startsWith('.')) await walk(e, parts.concat(e.name));
            }
        }
        try { await walk(root, []); } catch (e) { console.warn('[Florence/WebGPU] folder scan failed:', e); }
        return out;
    }

    async function folderGetFile(root, id, file) {
        const parts = (id + '/' + file).split('/').filter(Boolean);
        let dir = root;
        for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
        return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
    }
    async function folderPutFile(root, id, file, blob) {
        const parts = (id + '/' + file).split('/').filter(Boolean);
        let dir = root;
        for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], { create: true });
        const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        const w = await fh.createWritable();
        try { await w.write(blob); await w.close(); }
        catch (e) { try { await w.abort(); } catch (e2) { /* ignore */ } throw e; }
    }

    /* ======================================================================
       Custom cache for Transformers.js (server models/ folder or picked folder)
       Transformers.js asks the cache with the local path ("/models/org/name/file")
       and with the Hugging Face URL; both map to the same <org>/<name>/<file>.
    ====================================================================== */
    function relFromKey(key) {
        const url = typeof key === 'string' ? key : (key && key.url) || '';
        let m = url.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/resolve\/[^/]+\/([^?#]+)/);
        if (!m) m = url.match(/^\/?models\/([^/]+\/[^/]+)\/([^?#]+)$/);
        if (!m) return null;
        let file;
        try { file = decodeURIComponent(m[2]); } catch (e) { return null; }
        if (!/^[\w.\-]+\/[\w.\-]+$/.test(m[1])) return null;
        if (file.split('/').some(p => !p || p === '..')) return null;
        return { id: m[1], file };
    }

    function makeCache(storage) {
        const missed = new Map();   // avoid asking twice for the same missing file
        const recentlyMissed = k => missed.has(k) && Date.now() - missed.get(k) < 2000;

        return {
            async match(key) {
                const r = relFromKey(key);
                if (!r) return undefined;
                const k = r.id + '/' + r.file;
                if (recentlyMissed(k)) return undefined;
                try {
                    if (storage === 'server') {
                        const url = '/models/' + k.split('/').map(encodeURIComponent).join('/');
                        const res = await fetch(url, { cache: 'no-store' });
                        if (res.ok && !/text\/html/i.test(res.headers.get('content-type') || '')) return res;
                    } else if (storage === 'folder' && state.folder.handle) {
                        const f = await folderGetFile(state.folder.handle, r.id, r.file);
                        return new Response(f, { headers: { 'Content-Length': String(f.size), 'Content-Type': f.type || 'application/octet-stream' } });
                    }
                } catch (e) { /* not found */ }
                missed.set(k, Date.now());
                return undefined;
            },
            async put(key, response) {
                const r = relFromKey(key);
                if (!r) return;
                const blob = await response.blob();
                if (storage === 'server') {
                    const res = await fetch('/api/save_model_file?path=' + encodeURIComponent(r.id + '/' + r.file), { method: 'POST', body: blob });
                    if (!res.ok) throw new Error('Could not save ' + r.file + ' to the models/ folder (HTTP ' + res.status + ').');
                } else if (storage === 'folder' && state.folder.handle) {
                    await folderPutFile(state.folder.handle, r.id, r.file, blob);
                }
                missed.delete(r.id + '/' + r.file);
            }
        };
    }

    /* ======================================================================
       Storage resolution + scanning
    ====================================================================== */
    async function serverHasModels() {
        if (!PH.isLocalhost) return false;
        if (state.serverOk) return true;
        try {
            const r = await fetch('/api/models_info', { cache: 'no-store' });
            state.serverOk = r.ok;
        } catch (e) { state.serverOk = false; }
        return state.serverOk;
    }

    async function resolveStorage(ui) {
        const s = ui.values().storage;
        if (s === 'browser' || s === 'folder') return s;
        return (await serverHasModels()) ? 'server' : 'browser';
    }

    async function scan(storage) {
        const found = new Set();
        if (storage === 'server') {
            const r = await fetch('/api/models_list', { cache: 'no-store' });
            if (r.ok) ((await r.json()).onnx || []).forEach(m => found.add(m.id));
        } else if (storage === 'browser') {
            if ('caches' in window && await caches.has(BROWSER_CACHE)) {
                const c = await caches.open(BROWSER_CACHE);
                (await c.keys()).forEach(rq => {
                    const m = rq.url.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/resolve\//);
                    if (m) found.add(m[1]);
                });
            }
        } else if (storage === 'folder') {
            const h = state.folder.handle;
            state.folder.models = new Map();
            if (h && await folderPerm(h, false, false) === 'granted') {
                state.folder.models = await scanFolder(h);
                state.folder.models.forEach((_, id) => found.add(id));
            }
        }
        state.found = found;
        state.foundStorage = storage;
        return found;
    }

    const mark = (found, id) => found ? (found.has(id) ? '✅ ' : '⬇️ ') : '';

    async function listModels(ui) {
        const storage = await resolveStorage(ui);
        let found = null;
        try { found = await scan(storage); } catch (e) { console.warn('[Florence/WebGPU] scan failed:', e); }
        const list = MODELS.map(([id, label]) => [id, mark(found, id) + label]);
        if (found) {
            found.forEach(id => {
                if (!MODELS.some(m => m[0] === id) && isDetectable(id)) list.push([id, '✅ ' + id + ' (detected)']);
            });
        }
        return list;
    }

    /* ======================================================================
       Status
    ====================================================================== */
    function storageInfo(storage, perm) {
        if (storage === 'browser') return 'Model files are cached by your browser and stay available offline after the first download.';
        if (storage === 'server') return 'Model files are saved in the models/ folder next to this page and found automatically.';
        const h = state.folder.handle;
        if (!h) return 'No model folder selected. Press "Set model folder" (Chrome / Edge). Expected layout: <folder>/<org>/<model>/onnx/...';
        if (perm !== 'granted') return 'Model folder "' + h.name + '" needs permission again. Press "Reconnect model folder".';
        return 'Model folder: ' + h.name + ' (' + (state.folder.models.size || 'no') + ' model(s) found). New downloads are saved there.';
    }

    async function refresh(ui) {
        const v = ui.values();
        const gpu = !!navigator.gpu;
        ui.setBadge(gpu ? '🚀 WebGPU available' : '🐌 No WebGPU — CPU (WASM) only', gpu ? 'local' : 'online');

        const storage = await resolveStorage(ui);
        if (!state.found || state.foundStorage !== storage) {
            try { await scan(storage); } catch (e) { /* keep unknown */ }
        }
        let perm = 'none';
        if (storage === 'folder') perm = await folderPerm(state.folder.handle, false, false);
        ui.setInfo(storageInfo(storage, perm));

        const btn = ui.$('fPickFolder');
        btn.textContent = (state.folder.handle && perm !== 'granted') ? '🔄 Reconnect model folder' : '📁 Set model folder';

        if (state.loaded && state.loaded.model === v.model) ui.setModelStatus(`✅ Loaded in memory (${state.loaded.device}).`);
        else if (storage === 'folder' && !state.folder.handle) ui.setModelStatus('');
        else if (state.found && state.found.has(v.model)) ui.setModelStatus('✅ Model files found — ready to load.');
        else ui.setModelStatus('⬇️ Not downloaded yet — the first load downloads the model files.');
    }

    /* ======================================================================
       Loading
    ====================================================================== */
    async function getLib() {
        if (state.lib) return state.lib;
        try { state.lib = await import(TRANSFORMERS_CDN); }
        catch (e) { throw new Error('Could not load Transformers.js from the CDN. Check your internet connection. (' + (e.message || e) + ')'); }
        return state.lib;
    }

    function configure(lib, storage) {
        const env = lib.env;
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        // wasmPaths is left as Transformers.js sets it: the WASM files must match the
        // onnxruntime-web version bundled with this Transformers.js build. Pointing at
        // the unversioned latest package breaks loading whenever a new ORT ships.
        // Multi-threaded WASM needs cross-origin isolation; otherwise ORT uses 1 thread.
        try {
            env.backends.onnx.wasm.numThreads = window.crossOriginIsolated ? (navigator.hardwareConcurrency || 4) : 1;
        } catch (e) { /* older builds */ }
        if (storage === 'browser') {
            env.useBrowserCache = true;
            env.useCustomCache = false;
        } else {
            env.useBrowserCache = false;
            env.useCustomCache = true;
            env.customCache = makeCache(storage);
        }
    }

    /* One progress callback per load: sums the files seen so far. */
    function makeProgress(ui) {
        const files = new Map();
        return data => {
            if (ui.isCancelled()) throw cancelError();   // aborts the download
            if (!data || data.status === 'ready') return;
            const f = data.file || data.name || '';
            if (data.status === 'progress') files.set(f, { loaded: data.loaded || 0, total: data.total || 0 });
            else if (data.status === 'done' && files.has(f)) { const x = files.get(f); x.loaded = x.total; }
            else if ((data.status === 'initiate' || data.status === 'download') && !files.has(f)) files.set(f, { loaded: 0, total: 0 });
            let loaded = 0, total = 0;
            files.forEach(x => { loaded += x.loaded; total += x.total; });
            const label = f ? f.split('/').pop() : 'model';
            if (total > 0) ui.progress.set(loaded / total, `Loading ${label} — ${mb(loaded)} / ${mb(total)} MB`);
            else ui.progress.indeterminate('Loading ' + label + '...');
        };
    }

    async function disposeObj(obj) {
        try { if (obj && obj.model && typeof obj.model.dispose === 'function') await obj.model.dispose(); }
        catch (e) { console.warn('[Florence/WebGPU] dispose failed:', e); }
    }

    /* dtype per device — same values as the batch tagger. */
    function dtypeFor(id, device) {
        if (isFlorence(id)) return device === 'wasm' ? 'q8' : 'fp16';
        return device === 'wasm'
            ? { embed_tokens: 'fp32', vision_encoder: 'q8', decoder_model_merged: 'q8' }
            : { embed_tokens: 'fp16', vision_encoder: 'q4', decoder_model_merged: 'q4' };
    }

    async function loadModel(lib, id, device, sessionOptions, onProgress) {
        const ModelClass = isFlorence(id) ? lib.Florence2ForConditionalGeneration : lib.AutoModelForVision2Seq;
        if (!ModelClass) throw new Error('This Transformers.js build does not support the selected model.');
        const opts = { dtype: dtypeFor(id, device), device, progress_callback: onProgress };
        if (sessionOptions) opts.session_options = sessionOptions;
        const model = await ModelClass.from_pretrained(id, opts);
        try {
            const processor = await lib.AutoProcessor.from_pretrained(id, { progress_callback: onProgress });
            return { model, processor };
        } catch (e) {
            await disposeObj({ model });
            throw e;
        }
    }

    async function prepareFolder() {
        const h = state.folder.handle;
        if (!h) throw new Error('No model folder selected. Press "Set model folder" first.');
        let p = await folderPerm(h, true, true);
        if (p !== 'granted') p = await folderPerm(h, false, true);   // read-only still loads models
        if (p !== 'granted') throw new Error('Permission to the model folder was denied.');
    }

    const throwIfCancelled = (e, ui) => { if ((e && e.cancelled) || ui.isCancelled()) throw cancelError(); };

    async function ensureLoaded(ui, forceDevice) {
        const v = ui.values();
        if (state.loaded && state.loaded.model === v.model && state.loaded.devicePref === v.device) return;
        if (state.loaded) await unload();

        const storage = await resolveStorage(ui);
        if (storage === 'folder') await prepareFolder();

        ui.progress.indeterminate('Loading Transformers.js...');
        const lib = await getLib();
        if (ui.isCancelled()) throw cancelError();
        configure(lib, storage);

        const name = v.model.split('/').pop();
        ui.alert(`Loading ${name}... First run requires a download.`, 'info');

        let device = 'wasm';
        if ((forceDevice || v.device) === 'webgpu') {
            if (navigator.gpu) device = 'webgpu';
            else ui.alert('WebGPU is not supported here. Using CPU (WASM).', 'warn');
        }

        const onProgress = makeProgress(ui);
        let obj;
        try {
            obj = await loadModel(lib, v.model, device, null, onProgress);
        } catch (e) {
            throwIfCancelled(e, ui);
            if (device !== 'webgpu') throw e;
            console.warn('[Florence/WebGPU] WebGPU failed with the default config, retrying without graph optimization:', e);
            try {
                obj = await loadModel(lib, v.model, 'webgpu', { graphOptimizationLevel: 'disabled' }, onProgress);
                ui.alert('Model loaded on GPU (without graph optimization)!', 'success');
            } catch (e2) {
                throwIfCancelled(e2, ui);
                console.error('[Florence/WebGPU] WebGPU failed even without graph optimization, falling back to CPU WASM:', e2);
                ui.alert('WebGPU is incompatible with this model. Using CPU (WASM).', 'warn');
                device = 'wasm';
                obj = await loadModel(lib, v.model, 'wasm', null, onProgress);
            }
        }
        if (ui.isCancelled()) { await disposeObj(obj); throw cancelError(); }

        state.loaded = { model: v.model, device, devicePref: v.device, obj };
        ui.progress.indeterminate('Model ready.');
        ui.alert(`${name} loaded on ${device === 'webgpu' ? 'GPU' : 'CPU'}!`, 'success');
    }

    /* ======================================================================
       Inference
    ====================================================================== */
    async function infer(ui, v, L, file) {
        const lib = state.lib;
        const { model, processor } = L.obj;
        const url = URL.createObjectURL(file);
        try {
            const image = await lib.load_image(url);
            const stopper = lib.InterruptableStoppingCriteria ? new lib.InterruptableStoppingCriteria() : null;
            state.stopper = stopper;
            if (ui.isCancelled()) throw cancelError();
            const extra = stopper ? { stopping_criteria: stopper } : {};

            if (isFlorence(L.model)) {
                const token = '<' + v.task + '>';
                const prompts = processor.construct_prompts(token);
                const inputs = await processor(image, prompts);
                const ids = await model.generate({ ...inputs, max_new_tokens: v.maxTokens, ...extra });
                const decoded = processor.batch_decode(ids, { skip_special_tokens: false })[0];
                const parsed = processor.post_process_generation(decoded, token, image.size);
                return florenceText(parsed[token], token);
            }

            // SmolVLM: free instruction
            const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: v.prompt }] }];
            const textPrompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
            const inputs = await processor(textPrompt, [image], { do_image_splitting: false });
            const ids = await model.generate({ ...inputs, max_new_tokens: v.maxTokens, ...extra });
            const texts = processor.batch_decode(
                ids.slice(null, [inputs.input_ids.dims.at(-1), null]),
                { skip_special_tokens: true }
            );
            return cleanLLMText(texts[0] || '');
        } finally {
            URL.revokeObjectURL(url);
            state.stopper = null;
        }
    }

    async function generate(ui, file) {
        const v = ui.values();
        if (!state.loaded) throw new Error('No model loaded. Load a model first.');
        const t0 = performance.now();
        let text;
        try {
            text = await infer(ui, v, state.loaded, file);
        } catch (e) {
            throwIfCancelled(e, ui);
            if (state.loaded.device !== 'webgpu') throw e;
            console.warn('[Florence/WebGPU] generation failed on the GPU, retrying on CPU:', e);
            ui.alert('WebGPU failed while generating. Retrying on CPU (WASM)...', 'warn');
            await unload();
            await ensureLoaded(ui, 'wasm');
            text = await infer(ui, v, state.loaded, file);
        }
        if (ui.isCancelled()) throw cancelError();
        return {
            text,
            seconds: ((performance.now() - t0) / 1000).toFixed(2),
            device: state.loaded.device === 'webgpu' ? 'WebGPU' : 'WASM'
        };
    }

    /* ======================================================================
       Management
    ====================================================================== */
    async function cancel() { if (state.stopper) state.stopper.interrupt(); }

    async function unload() {
        const L = state.loaded;
        state.loaded = null;
        if (!L) return false;
        await disposeObj(L.obj);
        return true;
    }

    function deleteTarget() {
        const s = state.foundStorage;
        if (s === 'server') return 'models/ folder';
        if (s === 'folder') return 'your model folder';
        return 'browser cache';
    }

    async function deleteModel(ui, id) {
        if (state.loaded && state.loaded.model === id) await unload();
        const storage = await resolveStorage(ui);
        let deleted = false;

        if (storage === 'browser') {
            if ('caches' in window && await caches.has(BROWSER_CACHE)) {
                const c = await caches.open(BROWSER_CACHE);
                for (const rq of await c.keys()) {
                    if (rq.url.includes('/' + id + '/resolve/') && await c.delete(rq)) deleted = true;
                }
            }
        } else if (storage === 'server') {
            const r = await fetch('/api/delete_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            let d = {};
            try { d = await r.json(); } catch (e) { /* ignore */ }
            if (!r.ok) throw new Error(d.message || ('HTTP ' + r.status));
            deleted = !!d.deleted;
        } else {
            const h = state.folder.handle;
            if (!h) throw new Error('No model folder selected.');
            if (await folderPerm(h, true, true) !== 'granted') throw new Error('Write permission to the model folder was denied.');
            const [org, name] = id.split('/');
            try { await (await h.getDirectoryHandle(org)).removeEntry(name, { recursive: true }); deleted = true; }
            catch (e) { if (e.name !== 'NotFoundError') throw e; }
        }
        state.found = null;   // force a rescan
        return deleted;
    }

    async function pickFolder(ui) {
        if (typeof window.showDirectoryPicker !== 'function') throw new Error('Your browser does not support folder selection. Use Chrome or Edge.');
        const h = state.folder.handle;
        if (h && await folderPerm(h, true, false) !== 'granted') {
            if (await folderPerm(h, true, true) === 'granted') {
                state.found = null;
                ui.alert('Model folder reconnected.', 'success');
                return;
            }
        }
        try {
            const nh = await window.showDirectoryPicker({ mode: 'readwrite' });
            state.folder.handle = nh;
            state.found = null;
            await saveHandle(nh);
            ui.alert('Model folder set: ' + nh.name, 'success');
        } catch (e) { if (e.name !== 'AbortError') throw e; }
    }

    async function init() { state.folder.handle = await loadHandle(); }

    /* ======================================================================
       Registration
    ====================================================================== */
    PH.registerEngine({
        id: 'webgpu',
        label: '🚀 WebGPU (browser)',
        order: 1,
        available: true,
        models: MODELS,
        devices: DEVICES,
        defaultDevice: 'webgpu',
        tasks: TASKS,
        features: { beams: false, storage: true },
        taskKind: id => isFlorence(id) ? 'florence' : 'prompt',
        init, listModels, refresh, ensureLoaded: ui => ensureLoaded(ui), generate,
        cancel, unload, deleteTarget, deleteModel, pickFolder
    });

    // Handy for debugging in the console.
    PH._webgpu = { relFromKey, cleanLLMText, florenceText, state };
})();
