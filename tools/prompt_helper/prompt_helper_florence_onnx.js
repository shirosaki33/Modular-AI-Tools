/* =========================================================================
   PROMPT HELPER — IMAGE → PROMPT: ONNX TAGGER ENGINE (browser, any origin)

   Runs ONNX image taggers (SmilingWolf WD14 style: <name>.onnx + a tag CSV)
   in the browser with onnxruntime-web — the same method as the Tag Manager's
   "ONNX Tagger" mode. Output is a comma separated tag list.

   Where the models come from
     • localhost: every .onnx that has a CSV inside  models/onnx/  is found
       automatically (flat files or one sub-folder per model).
     • any origin: "📁 Set model folder" opens a folder picker (File System
       Access API, Chrome / Edge). The folder is remembered and scanned
       recursively, exactly like the Tag Manager.

   CSV rules (first match wins, next to the .onnx file):
       <model name>.csv · <model name>_tags.csv · selected_tags.csv · tags.csv
       · the only .csv in the folder
   CSV columns: name (tag) and category; category 9 (rating) is skipped.

   Needs: prompt_helper_florence.js (core) loaded first.
========================================================================= */
(function () {
    'use strict';

    const PH = window.PHFlorence;
    if (!PH) { console.error('[Florence/ONNX] prompt_helper_florence.js must be loaded first.'); return; }
    const { mb, cancelError } = PH.util;

    const ORT_VERSION = '1.20.1';   // same version as the Tag Manager
    const ORT_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.all.min.js`;
    const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
    const DEFAULT_SIZE = 448;       // WD14 taggers
    const MAX_DEPTH = 4;
    const DB_NAME = 'PromptHelperDB', DB_STORE = 'handles', DB_KEY = 'onnx_models_dir';

    const DEVICES = [
        ['webgpu', '🚀 GPU (WebGPU)'],
        ['wasm', '🐌 CPU (WASM)']
    ];

    const S = {
        catalog: new Map(),      // value -> { label, source, ... }
        dirHandle: null,         // folder picked with the button
        needsReconnect: false,
        session: null, key: '', tags: [], size: DEFAULT_SIZE, provider: '',
        abort: null
    };

    /* ---------- Folder handle persistence ---------- */
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
        } catch (e) { console.warn('[Florence/ONNX] could not remember the model folder:', e); }
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

    /* ---------- Helpers ---------- */
    const urlFor = rel => '/' + String(rel).split('/').map(encodeURIComponent).join('/');
    const sizeLabel = n => (n >= 1048576 ? ` · ${mb(n)} MB` : '');
    const checkCancel = ui => { if (ui.isCancelled()) throw cancelError(); };

    // RFC 4180-ish CSV parser (tag names can contain commas inside quotes).
    function parseCsv(text) {
        const rows = [];
        let row = [], cur = '', q = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (q) {
                if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
                else cur += c;
            } else if (c === '"') q = true;
            else if (c === ',') { row.push(cur); cur = ''; }
            else if (c === '\n' || c === '\r') {
                if (c === '\r' && text[i + 1] === '\n') i++;
                row.push(cur); cur = '';
                if (row.some(x => x.trim() !== '')) rows.push(row);
                row = [];
            } else cur += c;
        }
        row.push(cur);
        if (row.some(x => x.trim() !== '')) rows.push(row);
        return rows;
    }

    function parseTags(text) {
        const rows = parseCsv(text.replace(/^﻿/, ''));
        if (rows.length < 2) throw new Error('The tag CSV is empty.');
        const head = rows[0].map(h => h.trim().toLowerCase());
        const ni = head.includes('name') ? head.indexOf('name') : 1;
        const ci = head.includes('category') ? head.indexOf('category') : 2;
        const tags = [];
        for (const r of rows.slice(1)) {
            if (ni >= r.length) continue;
            const cat = /^-?\d+$/.test((r[ci] || '').trim()) ? parseInt(r[ci], 10) : 0;
            tags.push({ name: r[ni].replace(/_/g, ' '), category: cat });
        }
        return tags;
    }

    // Same lookup order as florence_backend.py
    function pickCsv(onnxName, names) {
        const base = onnxName.replace(/\.onnx$/i, '');
        const lower = new Map(names.map(n => [n.toLowerCase(), n]));
        for (const c of [base + '.csv', base + '_tags.csv', 'selected_tags.csv', 'tags.csv']) {
            if (lower.has(c.toLowerCase())) return lower.get(c.toLowerCase());
        }
        const csvs = names.filter(n => /\.csv$/i.test(n));
        return csvs.length === 1 ? csvs[0] : null;
    }

    /* ---------- Model discovery ---------- */
    async function scanServer() {
        if (!PH.isLocalhost) return;
        try {
            const r = await fetch('/api/models_list', { cache: 'no-store' });
            if (!r.ok) return;
            ((await r.json()).taggers || []).forEach(t => {
                S.catalog.set('srv:' + t.rel, {
                    source: 'server', label: `${t.name} (models/onnx${sizeLabel(t.size)})`,
                    onnxUrl: urlFor(t.rel), csvUrl: urlFor(t.csv), size: t.size || 0
                });
            });
        } catch (e) { /* server without the endpoint */ }
    }

    async function scanDir(dir, path, depth, out) {
        const files = new Map(), dirs = [];
        for await (const entry of dir.values()) {
            if (entry.kind === 'file') files.set(entry.name, entry);
            else if (!entry.name.startsWith('.')) dirs.push(entry);
        }
        const names = [...files.keys()];
        for (const n of names.sort()) {
            if (!/\.onnx$/i.test(n)) continue;
            const csvName = pickCsv(n, names);
            if (!csvName) continue;
            const stem = n.replace(/\.onnx$/i, '');
            const generic = /^model(_optimized|_fp16|_quantized)?$/i.test(stem);
            const label = (generic ? (path ? path.replace(/\/$/, '').split('/').pop() : dir.name) : stem) || stem;
            out.push({ value: 'dir:' + path + n, label: `${label} (folder: ${path || dir.name + '/'}${n})`,
                       onnx: files.get(n), csv: files.get(csvName) });
        }
        if (depth >= MAX_DEPTH) return;
        for (const d of dirs) {
            try { await scanDir(d, path + d.name + '/', depth + 1, out); }
            catch (e) { console.warn('[Florence/ONNX] skipped folder', d.name, e); }
        }
    }

    async function scanFolder() {
        if (!S.dirHandle) return;
        const out = [];
        await scanDir(S.dirHandle, '', 0, out);
        out.forEach(m => S.catalog.set(m.value, { source: 'folder', label: m.label, onnxHandle: m.onnx, csvHandle: m.csv }));
    }

    async function ensureFolderPermission(request) {
        const h = S.dirHandle;
        if (!h) return false;
        try {
            let p = await h.queryPermission({ mode: 'read' });
            if (p !== 'granted' && request) p = await h.requestPermission({ mode: 'read' });
            S.needsReconnect = p !== 'granted';
            return p === 'granted';
        } catch (e) { S.needsReconnect = true; return false; }
    }

    async function rebuildCatalog() {
        S.catalog = new Map();
        await scanServer();
        if (!S.dirHandle) S.dirHandle = await loadHandle();
        if (S.dirHandle && await ensureFolderPermission(false)) {
            try { await scanFolder(); } catch (e) { console.warn('[Florence/ONNX] folder scan failed:', e); }
        }
    }

    async function listModels() {
        await rebuildCatalog();
        const list = [...S.catalog.entries()].map(([v, m]) => [v, m.label]);
        return list.length ? list : [['', '-- No ONNX tagger found --']];
    }

    async function pickFolder(ui) {
        if (typeof window.showDirectoryPicker !== 'function') {
            ui.alert('Your browser does not support folder selection. Use Chrome or Edge.', 'error');
            return;
        }
        try {
            if (S.dirHandle && S.needsReconnect) {
                if (await ensureFolderPermission(true)) { ui.alert('Model folder reconnected.', 'success'); return; }
            }
            const h = await window.showDirectoryPicker({ mode: 'read' });
            S.dirHandle = h;
            S.needsReconnect = false;
            await saveHandle(h);
            ui.alert('Model folder set. Scanning for ONNX taggers...', 'info');
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            throw e;
        }
    }

    /* ---------- onnxruntime-web ---------- */
    let ortPromise = null;
    function loadOrt() {
        if (window.ort) return Promise.resolve(window.ort);
        if (!ortPromise) {
            ortPromise = new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = ORT_URL;
                s.onload = () => (window.ort ? res(window.ort) : rej(new Error('onnxruntime-web loaded but "ort" is missing.')));
                s.onerror = () => { ortPromise = null; rej(new Error('Could not load onnxruntime-web from the CDN. Check your connection.')); };
                document.head.appendChild(s);
            });
        }
        return ortPromise;
    }

    function setupOrt(ort) {
        if (ort.env && ort.env.wasm) {
            ort.env.wasm.wasmPaths = ORT_BASE;
            ort.env.wasm.numThreads = window.crossOriginIsolated ? (navigator.hardwareConcurrency || 4) : 1;
        }
    }

    async function fetchBuffer(ui, url, label) {
        S.abort = new AbortController();
        try {
            const res = await fetch(url, { signal: S.abort.signal });
            if (!res.ok) throw new Error(`Could not read ${label} (HTTP ${res.status}).`);
            const total = parseInt(res.headers.get('Content-Length') || '0', 10);
            if (!res.body || !res.body.getReader) return await res.arrayBuffer();
            const reader = res.body.getReader();
            const chunks = [];
            let got = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                got += value.length;
                if (total > 0) ui.progress.set(got / total, `Reading ${label}... ${Math.round(got / total * 100)}% (${mb(got)} / ${mb(total)} MB)`);
            }
            return await new Blob(chunks).arrayBuffer();
        } catch (e) {
            if (e && e.name === 'AbortError') throw cancelError();
            throw e;
        } finally { S.abort = null; }
    }

    function inputInfo(session) {
        // inputMetadata exists on newer onnxruntime-web builds; 1.20 only has the names.
        try {
            const md = session.inputMetadata;
            const m = Array.isArray(md) ? md[0] : (md && md[session.inputNames[0]]);
            const shape = m && m.shape;
            if (Array.isArray(shape) && shape.length === 4) {
                if (shape[3] === 3 && Number.isInteger(shape[1])) return { size: shape[1], ok: true };
                if (shape[1] === 3) return { size: DEFAULT_SIZE, ok: false };
            }
        } catch (e) { /* ignore */ }
        return { size: DEFAULT_SIZE, ok: true };
    }

    async function release() {
        if (S.session) { try { await S.session.release(); } catch (e) { /* ignore */ } }
        S.session = null; S.key = ''; S.tags = []; S.provider = '';
    }

    /* ---------- Loading ---------- */
    async function ensureLoaded(ui) {
        const v = ui.values();
        let entry = S.catalog.get(v.model);
        if (!entry) { await rebuildCatalog(); entry = S.catalog.get(v.model); }
        if (!entry) {
            throw new Error(PH.isLocalhost
                ? 'Select an ONNX tagger. Put the .onnx + .csv files in the models/onnx folder, or use "Set model folder".'
                : 'Select an ONNX tagger. Use "Set model folder" to choose the folder that contains your .onnx + .csv files.');
        }
        const key = v.model + '|' + v.device;
        if (S.session && S.key === key) return;
        await release();
        // Ask for folder access first: the permission prompt needs the click that started this.
        if (entry.source === 'folder' && !await ensureFolderPermission(true)) throw new Error('Permission to read the model folder was denied.');

        ui.progress.indeterminate('Loading onnxruntime-web...');
        ui.setStatus('Loading ONNX tagger...');
        const ort = await loadOrt();
        setupOrt(ort);
        checkCancel(ui);

        let csvText, buffer;
        if (entry.source === 'server') {
            const csvRes = await fetch(entry.csvUrl, { cache: 'no-store' });
            if (!csvRes.ok) throw new Error(`Could not read the tag CSV (HTTP ${csvRes.status}).`);
            csvText = await csvRes.text();
            buffer = await fetchBuffer(ui, entry.onnxUrl, 'the model');
        } else {
            csvText = await (await entry.csvHandle.getFile()).text();
            ui.progress.indeterminate('Reading the model file...');
            buffer = await (await entry.onnxHandle.getFile()).arrayBuffer();
        }
        checkCancel(ui);
        const tags = parseTags(csvText);

        ui.progress.indeterminate('Creating the ONNX session...');
        let provider = v.device === 'webgpu' && navigator.gpu ? 'webgpu' : 'wasm';
        if (v.device === 'webgpu' && !navigator.gpu) ui.alert('WebGPU is not available here. Using CPU (WASM).', 'warn');
        let session;
        try {
            session = await ort.InferenceSession.create(buffer, { executionProviders: [provider] });
        } catch (e) {
            if (provider !== 'webgpu') throw e;
            console.warn('[Florence/ONNX] WebGPU failed, falling back to WASM:', e);
            ui.alert('WebGPU failed for this model. Using CPU (WASM).', 'warn');
            provider = 'wasm';
            session = await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] });
        }
        const info = inputInfo(session);
        if (!info.ok) {
            try { await session.release(); } catch (e) { /* ignore */ }
            throw new Error('This tagger expects channels-first (NCHW) input. Only WD14 / SmilingWolf-style NHWC taggers are supported.');
        }
        S.session = session; S.key = key; S.tags = tags; S.size = info.size; S.provider = provider;
    }

    /* ---------- Inference ---------- */
    async function toInput(file, size) {
        const bmp = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.imageSmoothingQuality = 'high';
        const scale = Math.min(size / bmp.width, size / bmp.height);
        const w = bmp.width * scale, h = bmp.height * scale;
        ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
        if (bmp.close) bmp.close();
        const px = ctx.getImageData(0, 0, size, size).data;
        const f = new Float32Array(size * size * 3);
        for (let i = 0; i < size * size; i++) {       // RGBA → BGR, 0..255
            f[i * 3] = px[i * 4 + 2];
            f[i * 3 + 1] = px[i * 4 + 1];
            f[i * 3 + 2] = px[i * 4];
        }
        return f;
    }

    async function generate(ui, file) {
        if (!S.session) throw new Error('No tagger loaded. Load a model first.');
        const v = ui.values();
        const t0 = performance.now();
        const size = S.size;
        const data = await toInput(file, size);
        checkCancel(ui);
        const tensor = new window.ort.Tensor('float32', data, [1, size, size, 3]);
        const out = await S.session.run({ [S.session.inputNames[0]]: tensor });
        const scores = out[S.session.outputNames[0]].data;
        checkCancel(ui);
        if (scores.length !== S.tags.length) {
            throw new Error(`The model outputs ${scores.length} scores but the CSV lists ${S.tags.length} tags - wrong CSV for this model?`);
        }
        const exclude = new Set(v.exclude.split(',').map(t => t.trim().toLowerCase()).filter(Boolean));
        const prefix = v.prefix.split(',').map(t => t.trim()).filter(Boolean);
        const picked = [];
        for (let i = 0; i < S.tags.length; i++) {
            const t = S.tags[i];
            if (scores[i] >= v.threshold && t.category !== 9 && !exclude.has(t.name.toLowerCase())) picked.push({ name: t.name, p: scores[i] });
        }
        picked.sort((a, b) => b.p - a.p);
        const names = [...prefix, ...picked.map(t => t.name).filter(n => !prefix.includes(n))];
        return {
            text: names.join(', '),
            seconds: ((performance.now() - t0) / 1000).toFixed(2),
            device: S.provider === 'webgpu' ? 'WebGPU' : 'CPU (WASM)'
        };
    }

    /* ---------- Status / management ---------- */
    function refresh(ui) {
        const v = ui.values();
        const btn = ui.$('fPickFolder');
        if (btn) btn.textContent = S.needsReconnect ? '🔄 Reconnect model folder' : '📁 Set model folder';
        const gpu = !!navigator.gpu;
        ui.setBadge(gpu ? '🚀 WebGPU available' : '🐌 WASM (CPU) only', gpu ? 'local' : 'online');
        const n = S.catalog.size;
        ui.setInfo(`ONNX taggers run in your browser (onnxruntime-web ${ORT_VERSION}). ` +
            (PH.isLocalhost ? 'Models in models/onnx are found automatically; ' : '') +
            'use "Set model folder" to add a folder' + (n ? ` — ${n} tagger(s) found.` : '.'));
        if (S.needsReconnect) ui.setModelStatus('🔒 The saved model folder needs permission — press "Reconnect model folder".');
        else if (S.session && S.key === v.model + '|' + v.device) ui.setModelStatus(`✅ Loaded in memory (${S.provider === 'webgpu' ? 'WebGPU' : 'WASM'}, ${S.tags.length} tags).`);
        else if (S.catalog.has(v.model)) ui.setModelStatus('✅ Model found — ready to load.');
        else ui.setModelStatus('⬇️ No tagger found. Add the .onnx + .csv files to models/onnx (localhost) or choose a folder.');
    }

    async function cancel() { if (S.abort) S.abort.abort(); }

    async function unload() {
        const had = !!S.session;
        await release();
        return had;
    }

    PH.registerEngine({
        id: 'onnx',
        label: '🏷️ ONNX tagger (browser)',
        order: 0,
        available: true,
        models: [['', '-- No ONNX tagger found --']],
        devices: DEVICES,
        defaultDevice: 'webgpu',
        tasks: [['TAGS', 'Tags']],
        features: { beams: false, storage: false, pickFolder: true, canDelete: false },
        taskKind: () => 'tagger',
        listModels, refresh, ensureLoaded, generate,
        cancel, unload, pickFolder,
        deleteTarget: () => 'n/a',
        deleteModel: async () => false
    });
})();
