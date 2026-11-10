/* =====================================================================
   PSD IMPORT — cria o dataset a partir de um .psd / .psb / .xcf da pasta
   ---------------------------------------------------------------------
   Substitui a antiga "Compact View (grouped by prefix)": no lugar dos dois
   botões dela agora existe o ícone "PSD detected", que só aparece quando a
   pasta aberta tem um ou mais .psd, .psb (Photoshop grande) ou .xcf (GIMP).
   O formato é reconhecido pela assinatura do arquivo no backend; .xcf precisa
   de `pip install gimpformats`.

   FLUXO (cada camada do PSD = um screenshot, em resolução nativa):
     1) backend (psd_backend.py, localhost) abre o PSD e lê as camadas
     2) segm_person_yolo8m acha as pessoas (SAM ViT removido em 2026-11)
     3) caixa da pessoa + margem (10%) -> expandida até a proporção do bucket
        mais próximo (sobra imagem, nunca estica) -> recorte
     4) o recorte é redimensionado ao bucket (mesmo Lanczos-3 do Auto Bucket)
        e salvo como PNG direto na pasta do dataset
   - 2+ pessoas na camada  -> uma versão por pessoa: nome_01_p1, nome_01_p2...
   - nenhuma pessoa         -> a camada vai nativa, sem alteração, para revisão
                               manual (o 🪣 Bucket marca em vermelho depois)
   - nome já existente      -> sufixo "(dup)" no fim (mesma regra do Name Fixer)
   - o PSD não é alterado; _psd_processed.json (na pasta) lembra o que já foi
     importado, então o ícone fica discreto depois da importação.

   RECORTE MANUAL (✂️ em cada PSD): lista as camadas em miniaturas carregadas
   sob demanda (só as visíveis ficam na RAM; o PSD é analisado no servidor e a
   camada inteira só é baixada quando você entra nela). Entrar numa camada abre
   o MESMO popout do 🪣 Bucket (bucket, zoom, caixa arrastável, Lanczos-3), mas
   em modo "virtual": salvar adiciona um PNG novo ao dataset e nada mais é
   alterado — o PSD nunca é escrito. Várias versões da mesma camada: _p2, _p3...

   Depende de: tagmanager_bucket_check.js (window.TMBuckets), server_max.py
   (rota /api/psd/), psd_backend.py.
   ===================================================================== */
(function () {
    'use strict';

    const REGISTRY_FILE = '_psd_processed.json';
    const OPTS_SETTING = 'psd-import-opts';
    const DEFAULTS = { margin: 10, minArea: 3, hidden: false, suggest: false, cardSize: 220, blockSize: 25 };
    const BIG_FILE = 150 * 1048576;   // above this the file is sent in 16 MB pieces and only one layer is decoded at a time
    const BLOCK_SIZES = [25, 50, 100];

    let dirHandle = null;
    let found = [];             // FileSystemFileHandle[] (.psd da pasta atual)
    let registry = {};          // { "x.psd": { size, lastModified, at, outputs } }
    let running = false;
    let cancelled = false;
    let opts = Object.assign({}, DEFAULTS);
    // ⚙️ Settings > 🧩 Features > Unpack PSD: 'default' (icon opens PSD Import) | 'unpack' (icon only
    // unpacks every new PSD as native PNGs, then disappears) | 'hide' (function off, no icon).
    const MODE_SETTING = 'psd-unpack-mode';
    let psdMode = 'default';

    /* ---------- CSS ---------- */
    const style = document.createElement('style');
    style.textContent = `
        #btn-psd-import { display:none; flex-shrink:0; padding:6px 8px; font-size:14px; line-height:1; background:#2f1a5c; color:#d2b3ff; border:1px solid #6a3fd0; border-radius:4px; cursor:pointer; white-space:nowrap; animation: psdPulse 1.8s ease-in-out infinite; }
        #btn-psd-import:hover { background:#4a2a8c; color:#fff; }
        #btn-psd-import.all-done { background:transparent; color:#777; border-color:#444; animation:none; }
        #btn-psd-import.all-done:hover { color:#d2b3ff; border-color:#6a3fd0; }
        #btn-psd-import .psd-count { display:inline-block; margin-left:4px; min-width:14px; padding:0 4px; border-radius:8px; background:#b890ff; color:#1b0f3a; font-size:10px; text-align:center; }
        #btn-psd-import.all-done .psd-count { background:#444; color:#aaa; }
        @keyframes psdPulse { 0%,100% { box-shadow:0 0 0 rgba(184,144,255,0); } 50% { box-shadow:0 0 8px rgba(184,144,255,0.75); } }
        #modal-psd-import .tool-modal { width: 560px; max-width: 94vw; max-height: 90vh; overflow-y: auto; }
        #modal-psd-import .psd-line { font-size:12px; color:#ccc; line-height:1.5; }
        #modal-psd-import .psd-note { font-size:11px; color:#888; line-height:1.5; }
        #modal-psd-import .psd-warn { font-size:11px; color:#ffcc66; line-height:1.5; }
        #modal-psd-import .psd-list { display:flex; flex-direction:column; gap:4px; max-height:170px; overflow-y:auto; border:1px solid #2c2c2c; border-radius:6px; padding:6px; background:#141414; }
        #modal-psd-import .psd-row { display:flex; align-items:center; gap:8px; font-size:12px; color:#ddd; }
        #modal-psd-import .psd-row .psd-meta { margin-left:auto; font-size:10px; color:#777; white-space:nowrap; }
        #modal-psd-import .psd-row .psd-done { color:#00ff99; font-size:10px; font-weight:bold; }
        #modal-psd-import .psd-opts { display:grid; grid-template-columns: 1fr 1fr; gap:8px 14px; }
        #modal-psd-import .psd-opts label { display:flex; align-items:center; gap:6px; font-size:12px; color:#ccc; }
        #modal-psd-import .psd-opts input[type=number] { width:60px; background:#111; color:#eee; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px; }
        #modal-psd-import .psd-opts select { background:#111; color:#eee; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px; }
        #modal-psd-import .psd-man-btn { background:#1a3a5c; border:1px solid #2a5a8c; color:#4db8ff; border-radius:4px; padding:2px 8px; font-size:11px; font-weight:bold; cursor:pointer; }
        #modal-psd-import .psd-man-btn:hover { background:#2a5a8c; color:#fff; }
        #modal-psd-layers .tool-modal { width: 1100px; max-width: 96vw; height: 88vh; }
        #modal-psd-layers .psd-man-bar { display:flex; flex-wrap:wrap; align-items:center; gap:8px 18px; font-size:12px; color:#ccc; }
        #modal-psd-layers .psd-man-bar label { display:flex; align-items:center; gap:6px; }
        #psd-man-grid { flex:1; min-height:0; overflow-y:auto; display:grid; grid-template-columns: repeat(auto-fill, minmax(var(--psd-card, 220px), 1fr)); gap:10px; align-content:start; align-items:start; padding:2px; }
        .psd-card { position:relative; background:#141414; border:1px solid #2c2c2c; border-radius:8px; padding:6px; cursor:pointer; display:flex; flex-direction:column; gap:4px; }
        .psd-card:hover { border-color:#b890ff; }
        .psd-card.loading { opacity:.6; pointer-events:none; }
        .psd-card .psd-thumb { width:100%; aspect-ratio: var(--ar, 1.33); background:#0d0d0d; border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center; }
        .psd-card .psd-thumb img { width:100%; height:100%; object-fit:contain; }
        .psd-card .psd-cap { font-size:11px; color:#ddd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .psd-card .psd-res { font-size:10px; color:#777; }
        .psd-card .psd-badge { position:absolute; top:10px; right:10px; background:#0d2a18; border:1px solid #00aa66; color:#00ff99; font-size:10px; font-weight:bold; padding:1px 7px; border-radius:10px; display:none; }
        .psd-card.has-saved .psd-badge { display:block; }
        #btn-psd-import.running { animation:none; background:#4a2a8c; color:#fff; border-color:#b890ff; box-shadow:0 0 8px rgba(184,144,255,0.6); }
    `;
    document.head.appendChild(style);

    /* ---------- utilidades ---------- */
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const pad2 = (n) => String(n).padStart(2, '0');
    const safeBase = (name) => String(name || 'psd').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'psd';

    function b64ToBlob(b64, type) {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new Blob([u8], { type });
    }

    function loadImageEl(url) {
        return new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('Could not decode the layer image.'));
            el.src = url;
        });
    }

    async function api(method, route, query, body) {
        const qs = query ? '?' + new URLSearchParams(query).toString() : '';
        let res;
        try {
            res = await fetch('/api/psd/' + route + qs, { method, body });
        } catch (e) {
            throw new Error('Local server not reachable. PSD Import needs the localhost server (server_max.py).');
        }
        let data = null;
        try { data = await res.json(); } catch (e) {}
        if (!res.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
        return data;
    }

    // Huge files (+150 MB): the browser never sends them in one request. They are copied to a temp file in
    // 16 MB pieces (the server deletes it when the session ends) and the server reads one layer at a time.
    async function uploadBig(file, onProgress, shouldStop) {
        const st = await api('POST', 'upload_start', { name: file.name, size: file.size });
        const chunk = st.chunk || 16 * 1048576;
        for (let off = 0; off < file.size; off += chunk) {
            if (shouldStop && shouldStop()) throw new Error('Stopped.');
            await api('POST', 'upload_chunk', { upload: st.upload, offset: off }, file.slice(off, off + chunk));
            if (onProgress) onProgress(Math.min(1, (off + chunk) / file.size));
        }
        return st.upload;
    }

    async function analyzeFile(file, hiddenQ, onProgress, shouldStop) {
        if (file.size > BIG_FILE) {
            const up = await uploadBig(file, onProgress, shouldStop);
            return api('POST', 'analyze', { name: file.name, hidden: hiddenQ, upload: up });
        }
        return api('POST', 'analyze', { name: file.name, hidden: hiddenQ }, file);
    }

    // Layer count. Huge PSD/PSB: only the first bytes are sent (the layer index sits before the pixels).
    async function countFile(file, hiddenQ) {
        if (file.size <= BIG_FILE) {
            return (await api('POST', 'count', { name: file.name, hidden: hiddenQ }, file)).layers;
        }
        let size = 4 * 1048576;
        for (let i = 0; i < 30; i++) {
            const n = Math.min(file.size, Math.round(size));
            const r = await api('POST', 'count_head', { name: file.name, hidden: hiddenQ, total: file.size }, file.slice(0, n));
            if (r.unknown) return null;
            if (r.layers !== undefined) return r.layers;
            if (n >= file.size) return null;
            size = Math.max(r.need + 1048576, size * 1.5);
        }
        return null;
    }

    async function nameTaken(dir, base) {
        for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
            try { await dir.getFileHandle(base + '.' + ext); return true; }
            catch (e) { if (e && e.name !== 'NotFoundError') throw e; }
        }
        return false;
    }

    async function uniqueBase(dir, base) {
        let b = base;
        while (await nameTaken(dir, b)) b += '(dup)';
        return b;
    }

    async function writeBlob(dir, fileName, blob) {
        const fh = await dir.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
    }

    /* ---------- registro do que já foi importado ---------- */
    async function loadRegistry() {
        registry = {};
        if (!dirHandle) return;
        try {
            const fh = await dirHandle.getFileHandle(REGISTRY_FILE);
            registry = JSON.parse(await (await fh.getFile()).text()) || {};
        } catch (e) { registry = {}; }
    }

    async function saveRegistry() { return saveRegistryFor(dirHandle, registry); }
    async function saveRegistryFor(dir, reg) {
        if (!dir) return;
        try { await writeBlob(dir, REGISTRY_FILE, new Blob([JSON.stringify(reg, null, 1)], { type: 'application/json' })); }
        catch (e) { console.warn('PSD registry not saved:', e); }
    }

    function isDone(file) {
        const r = registry[file.name];
        return !!r && r.size === file.size && r.lastModified === file.lastModified;
    }

    /* ---------- ícone "PSD detected" ---------- */
    async function updateButton() {
        const btn = document.getElementById('btn-psd-import');
        if (!btn) return;
        if (running && runningDir === dirHandle) return;             // o contador x/N está no botão (job desta pasta)
        btn.classList.remove('running');
        if (!found.length || psdMode === 'hide') { btn.style.display = 'none'; return; }
        let pending = 0;
        for (const h of found) {
            try { if (!isDone(await h.getFile())) pending++; } catch (e) { pending++; }
        }
        if (psdMode === 'unpack') {
            // Unpack only: the icon shows the PSDs not unpacked yet and disappears when there are none.
            if (pending === 0) { btn.style.display = 'none'; return; }
            btn.style.display = 'inline-block';
            btn.classList.remove('all-done');
            btn.innerHTML = `📦<span class="psd-count">${pending}</span>`;
            btn.title = `PSD / PSB / XCF detected (${pending}) — click to unpack every layer as a native PNG (Unpack only mode, ⚙️ Settings)`;
            return;
        }
        btn.style.display = 'inline-block';
        btn.classList.toggle('all-done', pending === 0);
        btn.innerHTML = `🎨<span class="psd-count">${pending > 0 ? pending : '✓'}</span>`;
        btn.title = pending > 0
            ? `PSD / PSB / XCF detected (${pending} not imported yet) — click to build dataset images from its layers`
            : 'PSD / PSB / XCF files in this folder were already imported — click to import again';
    }

    function setFound(handle, entries) {
        dirHandle = handle;
        found = entries || [];
        loadRegistry().then(updateButton);
    }

    /* ---------- plano de recorte (pessoa -> bucket) ---------- */
    // box: [x1,y1,x2,y2] da pessoa. Devolve { cand, crop, cut } onde crop está
    // na proporção do bucket e contém a pessoa + margem sempre que couber na imagem.
    function planCrop(box, W, H, marginPct) {
        const m = marginPct / 100;
        const bw0 = box[2] - box[0], bh0 = box[3] - box[1];
        const x1 = Math.max(0, box[0] - bw0 * m), y1 = Math.max(0, box[1] - bh0 * m);
        const x2 = Math.min(W, box[2] + bw0 * m), y2 = Math.min(H, box[3] + bh0 * m);
        const rw = x2 - x1, rh = y2 - y1;
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        const cands = window.TMBuckets.suggest(rw, rh, 10);   // mais próximos em aspect ratio primeiro
        let best = null;
        for (const cand of cands) {
            const ar = cand.bw / cand.bh;
            let cw = rw, ch = rh;
            if (cw / ch < ar) cw = ch * ar; else ch = cw / ar;     // sobra imagem, nunca estica
            let cut = false, s = 1;
            if (cw > W + 1e-6 || ch > H + 1e-6) { s = Math.min(W / cw, H / ch); cw *= s; ch *= s; cut = true; }
            const w = Math.min(W, Math.max(1, Math.round(cw)));
            const h = Math.min(H, Math.max(1, Math.round(ch)));
            const x = Math.round(clamp(cx - w / 2, 0, W - w));
            const y = Math.round(clamp(cy - h / 2, 0, H - h));
            const plan = { cand, crop: { x, y, w, h }, cut, s };
            if (!cut) return plan;
            if (!best || s > best.s) best = plan;
        }
        return best;
    }

    /* ---------- modal ---------- */
    async function loadOpts() {
        try {
            if (typeof window.getSetting === 'function') {
                const saved = await window.getSetting(OPTS_SETTING, null);
                if (saved && typeof saved === 'object') opts = Object.assign({}, DEFAULTS, saved);
            }
        } catch (e) {}
    }

    function saveOpts() {
        try { if (typeof window.saveSetting === 'function') window.saveSetting(OPTS_SETTING, opts); } catch (e) {}
    }

    function buildModal() {
        let overlay = document.getElementById('modal-psd-import');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'modal-psd-import';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-psd-import');
        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🎨 PSD Import</span>
                    <button id="psd-x" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div class="psd-line">Works with Photoshop <b>.psd / .psb</b> and GIMP <b>.xcf</b>. Each layer is read at native resolution, the person is found (segm_person_yolo8m), and the crop is fitted to the nearest <b id="psd-bucket-model">SDXL</b> bucket. Extra image is kept — nothing is stretched.</div>
                <div class="psd-list" id="psd-list"></div>
                <div class="psd-opts">
                    <label>Margin around person <input type="number" id="psd-margin" min="0" max="50" step="1"> %</label>
                    <label>Ignore people smaller than <input type="number" id="psd-minarea" min="0" max="50" step="1"> % of image</label>
                    <label><input type="checkbox" id="psd-hidden"> Include hidden layers</label>
                </div>
                <div class="psd-note"><b>📦 Unpack only</b> skips detection: every layer is saved untouched as a PNG at native size (<code>name_01.png</code>, <code>name_02.png</code>…), ready for manual cropping. <br>2+ people in a layer → one version per person (<code>_p1</code>, <code>_p2</code>…) so you can pick. No person found → the layer is saved untouched at native size for manual review. Existing names get <code>(dup)</code>. The source file itself is never changed.</div>
                <div class="psd-warn" id="psd-status" style="display:none;"></div>
                <div class="modal-buttons">
                    <button class="btn-cancel" id="psd-close">Close</button>
                    <button id="psd-unpack" title="Saves every layer as a PNG at native resolution — no person detection, no crop, no bucket" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer;">📦 Unpack only</button>
                    <button id="psd-run" style="background:#6a3fd0; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer;">🎨 Import</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        return overlay;
    }

    // O modo automático roda só no botão 🎨 (sem popout): detalhes vão para o console.
    let runLog = [];
    function log(html, cls) {
        const text = String(html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        runLog.push({ cls: cls || '', text });
        (cls === 'err' ? console.error : cls === 'warn' ? console.warn : console.log)('[PSD Import] ' + text);
    }

    // Botão 🎨 como indicador: "⏳ x/N" (N = camadas, uma camada pode gerar várias imagens).
    function setBtnRunningRaw(text, title) {
        const btn = document.getElementById('btn-psd-import');
        if (!btn) return;
        btn.style.display = 'inline-block';
        btn.classList.add('running');
        btn.classList.remove('all-done');
        btn.textContent = text;
        btn.title = title || 'PSD Import running — click to stop';
    }

    function readOptsFromUI() {
        opts = {
            suggest: opts.suggest, cardSize: opts.cardSize, blockSize: opts.blockSize,
            margin: clamp(parseFloat(document.getElementById('psd-margin').value) || 0, 0, 50),
            minArea: clamp(parseFloat(document.getElementById('psd-minarea').value) || 0, 0, 50),
            hidden: document.getElementById('psd-hidden').checked
        };
        saveOpts();
    }

    window.openPsdImport = async function () {
        if (!found.length) return;
        await loadOpts();
        await loadRegistry();
        buildModal();
        const closeFn = () => window.closeModal('modal-psd-import');
        document.getElementById('psd-x').onclick = closeFn;
        document.getElementById('psd-close').onclick = closeFn;

        document.getElementById('psd-bucket-model').textContent = window.TMBuckets ? window.TMBuckets.label() : '—';
        document.getElementById('psd-margin').value = opts.margin;
        document.getElementById('psd-minarea').value = opts.minArea;
        document.getElementById('psd-hidden').checked = opts.hidden;

        const list = document.getElementById('psd-list');
        const rows = [];
        for (let i = 0; i < found.length; i++) {
            let file = null;
            try { file = await found[i].getFile(); } catch (e) { continue; }
            const done = isDone(file);
            const mb = (file.size / 1048576).toFixed(1) + ' MB';
            const row = document.createElement('label');
            row.className = 'psd-row';
            row.innerHTML = `<input type="checkbox" data-i="${i}" ${done ? '' : 'checked'}> <span>${esc(file.name)}</span>
                ${done ? '<span class="psd-done">✓ imported</span>' : ''}<span class="psd-meta">${mb}</span>
                <button type="button" class="psd-man-btn" title="Browse the layers and crop them by hand (same tool as 🪣 Bucket). The source file is never changed.">✂️ Manual</button>`;
            row.querySelector('.psd-man-btn').onclick = (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                window.closeModal('modal-psd-import');
                window.openPsdManual(found[i]);
            };
            list.appendChild(row);
            rows.push(row);
        }

        const runBtn = document.getElementById('psd-run');
        const unpackBtn = document.getElementById('psd-unpack');
        runBtn.disabled = true;
        unpackBtn.disabled = true;
        const statusEl = document.getElementById('psd-status');
        if (!window.TMBuckets) {
            statusEl.style.display = 'block';
            statusEl.textContent = '⚠️ The Bucket module is not loaded (tagmanager_bucket_check.js).';
        } else {
            try {
                const st = await api('GET', 'status');
                const need = (st.missing || []).filter(p => p !== 'transformers' && p !== 'gimpformats');
                const notes = [];
                if ((st.missing || []).includes('gimpformats') && found.some(h => /\.xcf$/i.test(h.name))) notes.push('GIMP .xcf files need gimpformats → pip install gimpformats');
                if (need.length) notes.push(`Missing packages: ${need.join(', ')} → pip install ${need.join(' ')}`);
                if (!st.yolo) notes.push('segm_person_yolo8m will be downloaded to models/psd on the first run (Bingsu/adetailer).');
                if (notes.length) { statusEl.style.display = 'block'; statusEl.innerHTML = notes.map(esc).join('<br>'); }
                runBtn.disabled = need.length > 0;
                unpackBtn.disabled = need.some(p => p !== 'torch' && p !== 'ultralytics');   // unpacking needs no AI packages
            } catch (e) {
                statusEl.style.display = 'block';
                statusEl.textContent = '⚠️ ' + e.message;
            }
        }

        const start = (unpack) => {
            const picked = Array.from(list.querySelectorAll('input[type=checkbox]:checked')).map(c => found[parseInt(c.dataset.i, 10)]);
            if (!picked.length) { if (window.showAlert) window.showAlert('Select at least one PSD.', 'error'); return; }
            readOptsFromUI();
            window.closeModal('modal-psd-import');     // modo automático: igual aos demais, roda só no botão
            runImport(picked, unpack);
        };
        runBtn.onclick = () => start(false);
        unpackBtn.onclick = () => start(true);
        window.openModal('modal-psd-import');
    };

    /* ---------- importação ---------- */
    // ⏳ background task: the folder and its registry are captured now, so the import / unpack goes on (and
    // writes into THIS folder) even if another dataset is opened. Person detection waits for other GPU tasks.
    let runningDir = null;
    async function runImport(handles, unpack) {
        if (running) { if (window.showAlert) window.showAlert('A PSD Import / Unpack is already running (see ⏳ Tasks). Only one at a time.', 'warn'); return; }
        if (man) return;
        const jobDir = dirHandle;
        const jobReg = registry;
        const ctx = window.TM.tasks.captureDataset(jobDir);
        ctx.files = [];
        running = true;
        runningDir = jobDir;
        return window.TM.tasks.run({ title: `${unpack ? 'PSD Unpack' : 'PSD Import'} (${handles.length} file${handles.length > 1 ? 's' : ''})`, icon: unpack ? '📦' : '🎨',
            gpu: !unpack, ctx, silentEnd: true, onCancel: () => { cancelled = true; } }, (task) => runImportTask(handles, unpack, jobDir, jobReg, task)).promise
            .finally(() => { running = false; runningDir = null; });
    }
    async function runImportTask(handles, unpack, jobDir, jobReg, task) {
        const setBtnRunning = (text, title) => { if (dirHandle === jobDir) setBtnRunningRaw(text, title); };
        cancelled = false;
        runLog = [];
        const stats = { psds: 0, layers: 0, created: 0, multi: 0, native: 0, cut: 0, up: 0, errors: 0, unpacked: 0 };
        const failedNames = [];
        let anyWritten = false;
        const hiddenQ = opts.hidden ? '1' : '0';

        try {
            // 1) conta as camadas de todos os arquivos escolhidos -> total do contador "x/N"
            setBtnRunning('🔍', 'PSD Import — counting layers…');
            let total = 0;
            const counted = new Set();
            for (const handle of handles) {
                if (cancelled) break;
                const file = await handle.getFile();
                try {
                    const n = await countFile(file, hiddenQ);
                    if (n !== null) { total += n; counted.add(file.name); }
                } catch (e) {
                    stats.errors++;
                    failedNames.push(file.name);
                    log(`✖ ${esc(file.name)}: ${esc(e.message)}`, 'err');
                }
            }
            const title = () => `PSD Import: ${done} of up to ${total} layer(s) processed — a layer with several people makes several images. Click to stop.`;
            let done = 0;
            const counter = () => { setBtnRunning(`⏳ ${done}/${Math.max(total, done)}`, title()); task.progress(done, Math.max(total, done)); };
            if (total > 0) counter();

            // 2) processa
            for (const handle of handles) {
                if (cancelled) break;
                const file = await handle.getFile();
                const base = safeBase(file.name);
                log(`<b>${esc(file.name)}</b> — reading layers…`, 'info');
                let info;
                try {
                    info = await analyzeFile(file, hiddenQ, (f) => setBtnRunning(`⬆ ${Math.round(f * 100)}%`, `Copying ${file.name} for processing… click to stop`), () => cancelled);
                } catch (e) {
                    if (cancelled) break;
                    stats.errors++;
                    if (!failedNames.includes(file.name)) failedNames.push(file.name);
                    log(`✖ ${esc(file.name)}: ${esc(e.message)}`, 'err');
                    continue;
                }
                (info.skipped || []).forEach(s => log(`  skipped “${esc(s.name)}” (${esc(s.reason)})`, 'warn'));
                if (!counted.has(file.name)) total += info.layers.length;
                counter();
                const outputs = [];
                const blockSize = opts.blockSize || 25;

                for (let li = 0; li < info.layers.length; li++) {
                    if (cancelled) break;
                    const L = info.layers[li];
                    stats.layers++;
                    try {
                        const res = await api('POST', 'layer', {
                            session: info.session, index: li,
                            detect: unpack ? '0' : '1',
                            min_area: opts.minArea
                        });
                        const wrote = await saveLayer(res, `${base}_${pad2(li + 1)}`, stats, outputs, unpack, jobDir);
                        if (wrote) anyWritten = true;
                    } catch (e) {
                        stats.errors++;
                        failedNames.push(`${file.name} › ${L.name}`);
                        log(`  ✖ layer “${esc(L.name)}”: ${esc(e.message)}`, 'err');
                    }
                    done++;
                    counter();
                    if ((li + 1) % blockSize === 0 && li + 1 < info.layers.length) {     // block of 25 finished: free decoded layers
                        try { await api('POST', 'trim'); } catch (e) {}
                        log(`  block ${(li + 1) / blockSize} done (${li + 1}/${info.layers.length})`, 'info');
                    }
                }
                stats.psds++;
                if (!cancelled && outputs.length) {
                    jobReg[file.name] = { size: file.size, lastModified: file.lastModified, at: new Date().toISOString(), outputs };
                    await saveRegistryFor(jobDir, jobReg);
                }
            }
        } catch (e) {
            stats.errors++;
            log(`✖ ${esc(e.message || e)}`, 'err');
        } finally {
            try { await api('POST', 'release'); } catch (e) {}        // devolve a VRAM (YOLO)
            running = false;
            runningDir = null;
        }

        const stopped = cancelled;
        cancelled = false;
        task.result = `${stats.created} image(s)${stats.errors ? `, ${stats.errors} error(s)` : ''}`;
        if (anyWritten && typeof window.refreshDataset === 'function' && await window.TM.tasks.isCurrent(jobDir)) {
            try { await window.refreshDataset(); } catch (e) { console.warn(e); }
        }
        updateButton();                                              // volta ao ícone 🎨 + contador de PSDs

        const parts = [unpack ? `${stats.created} layer(s) unpacked as native PNGs` : `${stats.created} image(s) created from ${stats.layers} layer(s)`];
        if (stats.multi) parts.push(`${stats.multi} layer(s) with several people`);
        if (stats.native) parts.push(`${stats.native} saved native, no person found (review manually)`);
        if (stats.cut) parts.push(`${stats.cut} cropped tighter than the person`);
        if (stats.up) parts.push(`${stats.up} upscaled to the bucket`);
        if (stats.errors) parts.push(`${stats.errors} error(s): ${failedNames.slice(0, 4).join(', ')}${failedNames.length > 4 ? '…' : ''}`);
        if (window.showAlert) window.showAlert(`${unpack ? 'PSD Unpack' : 'PSD Import'}${dirHandle === jobDir ? '' : ' (' + (jobDir && jobDir.name) + ')'} ${stopped ? 'stopped' : 'done'}: ${parts.join(' · ')}.`, stats.errors || stopped || stats.native ? 'warn' : 'success');
    }

    // Grava as versões de UMA camada. Devolve true se escreveu algo.
    async function saveLayer(res, baseName, stats, outputs, unpack, dir) {
        dir = dir || dirHandle;
        const pngBlob = b64ToBlob(res.png, 'image/png');
        const W = res.w, H = res.h;
        const people = (res.people || []).slice().sort((a, b) => a.box[0] - b.box[0]);   // esquerda -> direita

        if (!people.length) {                       // nenhuma pessoa: nativa, sem alteração
            const name = await uniqueBase(dir, baseName);
            await writeBlob(dir, name + '.png', pngBlob);
            stats.created++;
            outputs.push(name + '.png');
            if (unpack) {
                stats.unpacked++;
                log(`  ✔ “${esc(res.name)}” → ${esc(name)}.png (native ${W}×${H})`, 'ok');
                return true;
            }
            stats.native++;
            log(`  ⚠ “${esc(res.name)}” — no person found → ${esc(name)}.png (native ${W}×${H})`, 'warn');
            return true;
        }

        const url = URL.createObjectURL(pngBlob);
        let el;
        try { el = await loadImageEl(url); }
        finally { URL.revokeObjectURL(url); }

        if (people.length > 1) stats.multi++;
        for (let pi = 0; pi < people.length; pi++) {
            const plan = planCrop(people[pi].box, W, H, opts.margin);
            const rendered = await window.TMBuckets.renderCrop(el, plan.cand, plan.crop, 'image/png', null);
            const wanted = people.length > 1 ? `${baseName}_p${pi + 1}` : baseName;
            const name = await uniqueBase(dir, wanted);
            await writeBlob(dir, name + '.png', rendered.blob);
            stats.created++;
            if (plan.cut) stats.cut++;
            if (rendered.upscaled) stats.up++;
            outputs.push(name + '.png');
            const tags = [];
            if (plan.cut) tags.push('person touches the image edge');
            if (rendered.upscaled) tags.push('upscaled');
            log(`  ✔ ${esc(name)}.png — ${plan.cand.bw}×${plan.cand.bh}${tags.length ? ' (' + tags.join(', ') + ')' : ''}`, plan.cut ? 'warn' : 'ok');
        }
        return true;
    }

    /* =====================================================================
       RECORTE MANUAL — camadas em lista (miniaturas sob demanda) + popout 🪣
       ===================================================================== */
    let manLoading = false;
    let man = null;   // { handle, file, base, info, thumbs, pend, queue, running, io, saved, busy, dirty, key }

    function manualKey(file) { return '#manual:' + file.name; }

    function savedFromRegistry(file, info) {
        const rec = registry[manualKey(file)];
        const out = {};
        if (rec && rec.size === file.size && rec.lastModified === file.lastModified) {
            info.layers.forEach((L, i) => {
                const names = rec.layers && rec.layers[i + '|' + L.name];
                if (names && names.length) out[i] = names.slice();
            });
        }
        return out;
    }

    async function saveManualProgress() {
        if (!man) return;
        const layers = {};
        man.info.layers.forEach((L, i) => { if (man.saved[i] && man.saved[i].length) layers[i + '|' + L.name] = man.saved[i]; });
        registry[manualKey(man.file)] = { size: man.file.size, lastModified: man.file.lastModified, layers };
        await saveRegistry();
    }

    function buildLayersModal() {
        let overlay = document.getElementById('modal-psd-layers');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'modal-psd-layers';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => { if (man && !man.busy) closeManual(); };
        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>✂️ Manual crop — <span id="psd-man-title"></span></span>
                    <button id="psd-man-x" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div class="psd-man-bar">
                    <span id="psd-man-sub" style="color:#888;"></span>
                    <label title="Runs the person detector when you open a layer and pre-positions the crop box. You can still move / zoom it."><input type="checkbox" id="psd-man-suggest"> Suggest crop with person detection</label>
                    <label>Size <input type="range" id="psd-man-size" min="120" max="480" step="10"></label>
                </div>
                <div class="psd-man-bar" id="psd-man-pager" style="display:none;">
                    <button type="button" class="psd-man-btn" id="psd-pg-prev" title="Previous block">◀</button>
                    <select id="psd-pg-block" title="Jump to a block of layers" style="background:#111; color:#eee; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px;"></select>
                    <button type="button" class="psd-man-btn" id="psd-pg-next" title="Next block">▶</button>
                    <label title="Only this many layers are listed (and kept in memory) at a time">Block of
                        <select id="psd-pg-size" style="background:#111; color:#eee; border:1px solid #444; border-radius:4px; padding:3px 6px; font-size:12px;"></select> layers</label>
                </div>
                <div id="psd-man-grid"></div>
                <div class="psd-note">Click a layer to crop it with the 🪣 Bucket tool. Each save adds a new PNG to the dataset (<code>_p2</code>, <code>_p3</code>… for more versions of the same layer). The source file is never modified.</div>
                <div class="modal-buttons"><button class="btn-cancel" id="psd-man-close">Close</button></div>
            </div>`;
        document.body.appendChild(overlay);
        return overlay;
    }

    function updateCardBadge(i) {
        const card = document.querySelector(`#psd-man-grid .psd-card[data-i="${i}"]`);
        if (!card || !man) return;
        const n = (man.saved[i] || []).length;
        card.classList.toggle('has-saved', n > 0);
        card.querySelector('.psd-badge').textContent = `✓ ${n} saved`;
    }

    function pumpThumbs(m) {
        while (m.running < 2 && m.queue.length) {
            const job = m.queue.shift();
            m.running++;
            job().finally(() => { m.running--; pumpThumbs(m); });
        }
    }

    function ensureThumb(m, i) {
        if (m.thumbs.has(i)) return Promise.resolve(m.thumbs.get(i));
        if (m.pend.has(i)) return m.pend.get(i);
        const p = new Promise((resolve) => {
            m.queue.push(async () => {
                try {
                    if (man !== m) return resolve(null);
                    const r = await api('POST', 'thumb', { session: m.info.session, index: i, size: 320 });
                    const src = 'data:image/jpeg;base64,' + r.jpg;
                    if (man !== m || Math.floor(i / m.blockSize) !== m.block) return resolve(null);
                    m.thumbs.set(i, src);
                    resolve(src);
                } catch (e) { resolve(null); }
                finally { m.pend.delete(i); }
            });
            pumpThumbs(m);
        });
        m.pend.set(i, p);
        return p;
    }

    // "RAM view": só os cards perto da área visível mantêm a <img> com src; ao sair, o src é solto.
    function observeCards(m) {
        const grid = document.getElementById('psd-man-grid');
        if (m.io) m.io.disconnect();
        m.io = new IntersectionObserver((entries) => {
            entries.forEach((en) => {
                const card = en.target;
                const i = parseInt(card.dataset.i, 10);
                const img = card.querySelector('img');
                if (en.isIntersecting) {
                    card._vis = true;
                    const have = m.thumbs.get(i);
                    if (have) { if (img.getAttribute('src') !== have) img.src = have; return; }
                    ensureThumb(m, i).then((src) => { if (src && man === m && card._vis && card.isConnected) img.src = src; });
                } else {
                    card._vis = false;
                    img.removeAttribute('src');
                }
            });
        }, { root: grid, rootMargin: '600px' });
        grid.querySelectorAll('.psd-card').forEach(c => m.io.observe(c));
    }

    // Blocks: only `blockSize` layers (default 25) are listed / kept in memory at a time.
    function blockCount(m) { return Math.max(1, Math.ceil(m.info.layers.length / m.blockSize)); }

    function setupPager(m) {
        const pager = document.getElementById('psd-man-pager');
        const sizeSel = document.getElementById('psd-pg-size');
        sizeSel.innerHTML = BLOCK_SIZES.map(n => `<option value="${n}">${n}</option>`).join('');
        sizeSel.value = String(m.blockSize);
        pager.style.display = m.info.layers.length > Math.min(...BLOCK_SIZES) ? 'flex' : 'none';
        const go = (b) => { m.block = clamp(b, 0, blockCount(m) - 1); renderBlock(m); };
        document.getElementById('psd-pg-prev').onclick = () => go(m.block - 1);
        document.getElementById('psd-pg-next').onclick = () => go(m.block + 1);
        document.getElementById('psd-pg-block').onchange = (e) => go(parseInt(e.target.value, 10));
        sizeSel.onchange = () => {
            const firstLayer = m.block * m.blockSize;
            m.blockSize = parseInt(sizeSel.value, 10);
            opts.blockSize = m.blockSize; saveOpts();
            go(Math.floor(firstLayer / m.blockSize));
        };
    }

    function renderBlock(m) {
        if (man !== m) return;
        const grid = document.getElementById('psd-man-grid');
        const total = m.info.layers.length;
        const from = m.block * m.blockSize, to = Math.min(total, from + m.blockSize);
        if (m.io) m.io.disconnect();
        m.queue = [];                                   // drop thumbnails still waiting from the previous block
        m.thumbs.clear();
        grid.innerHTML = '';
        grid.scrollTop = 0;

        const sel = document.getElementById('psd-pg-block');
        if (sel) {
            let html = '';
            for (let b = 0; b < blockCount(m); b++) {
                const f = b * m.blockSize + 1, t = Math.min(total, (b + 1) * m.blockSize);
                html += `<option value="${b}">Layers ${f}–${t}</option>`;
            }
            sel.innerHTML = html;
            sel.value = String(m.block);
            document.getElementById('psd-pg-prev').disabled = m.block <= 0;
            document.getElementById('psd-pg-next').disabled = m.block >= blockCount(m) - 1;
        }
        document.getElementById('psd-man-sub').textContent =
            `${total} layer(s)` + (total > m.blockSize ? ` · showing ${from + 1}–${to}` : '') +
            ((m.info.skipped || []).length ? ` · ${m.info.skipped.length} skipped (hidden / not pixels)` : '');

        for (let i = from; i < to; i++) {
            const L = m.info.layers[i];
            const card = document.createElement('div');
            card.className = 'psd-card';
            card.dataset.i = i;
            card.style.setProperty('--ar', clamp(L.w / L.h, 0.5, 2).toFixed(3));
            card.title = `Open “${L.name}” in the Bucket cropper`;
            card.innerHTML = `<div class="psd-thumb"><img alt="" draggable="false"></div>
                <div class="psd-cap">${pad2(i + 1)} · ${esc(L.name)}</div>
                <div class="psd-res">${L.w}×${L.h}</div>
                <span class="psd-badge"></span>`;
            card.onclick = () => enterLayer(m, i, card);
            grid.appendChild(card);
            updateCardBadge(i);
        }
        observeCards(m);
        api('POST', 'trim').catch(() => {});            // free layers decoded for the previous block
    }

    window.openPsdManual = async function (handle) {
        if (!window.TMBuckets) { if (window.showAlert) window.showAlert('The Bucket module is not loaded (tagmanager_bucket_check.js).', 'error'); return; }
        if (man || manLoading) return;
        if (running) { if (window.showAlert) window.showAlert('PSD Import is running — wait for it to finish (or click 🎨 to stop it).', 'warn'); return; }
        await loadOpts();
        await loadRegistry();
        const file = await handle.getFile();
        buildLayersModal();
        document.getElementById('psd-man-title').textContent = file.name;
        document.getElementById('psd-man-sub').textContent = 'Reading layers…';
        window.openModal('modal-psd-layers');

        let abort = false;
        manLoading = true;
        const earlyClose = () => { abort = true; window.closeModal('modal-psd-layers'); };
        document.getElementById('psd-man-x').onclick = earlyClose;
        document.getElementById('psd-man-close').onclick = earlyClose;
        let info;
        try {
            info = await analyzeFile(file, opts.hidden ? '1' : '0',
                (f) => { const el = document.getElementById('psd-man-sub'); if (el) el.textContent = `Copying the big file for processing… ${Math.round(f * 100)}%`; },
                () => abort);
        } catch (e) {
            manLoading = false;
            window.closeModal('modal-psd-layers');
            try { await api('POST', 'release'); } catch (x) {}
            if (!abort && window.showAlert) window.showAlert('PSD Import: ' + e.message, 'error');
            return;
        }
        manLoading = false;
        if (abort) { try { await api('POST', 'release'); } catch (x) {} return; }
        const m = man = { handle, file, base: safeBase(file.name), info, thumbs: new Map(), pend: new Map(), queue: [], running: 0, io: null, saved: {}, busy: false, dirty: false, block: 0, blockSize: BLOCK_SIZES.includes(opts.blockSize) ? opts.blockSize : 25 };
        m.saved = savedFromRegistry(file, info);

        const sizeEl = document.getElementById('psd-man-size');
        const grid = document.getElementById('psd-man-grid');
        const setSize = (v) => { grid.style.setProperty('--psd-card', v + 'px'); };
        sizeEl.value = opts.cardSize; setSize(opts.cardSize);
        sizeEl.oninput = () => { opts.cardSize = parseInt(sizeEl.value, 10); setSize(opts.cardSize); };
        sizeEl.onchange = saveOpts;
        const sugEl = document.getElementById('psd-man-suggest');
        sugEl.checked = !!opts.suggest;
        sugEl.onchange = () => { opts.suggest = sugEl.checked; saveOpts(); };
        document.getElementById('psd-man-x').onclick = () => { if (!m.busy) closeManual(); };
        document.getElementById('psd-man-close').onclick = () => { if (!m.busy) closeManual(); };

        setupPager(m);
        renderBlock(m);
    };

    async function closeManual() {
        const m = man;
        if (!m) return;
        man = null;
        if (m.io) m.io.disconnect();
        window.closeModal('modal-psd-layers');
        try { await api('POST', 'release'); } catch (e) {}
        if (m.dirty && typeof window.refreshDataset === 'function') {
            try { await window.refreshDataset(); } catch (e) { console.warn(e); }
        }
        updateButton();
    }

    // Espera o popout do Bucket fechar (X, Cancel, clique fora ou após salvar).
    function onFixClosed(cb) {
        const el = document.getElementById('modal-fix-bucket');
        if (!el || !el.classList.contains('active')) { cb(); return; }
        const mo = new MutationObserver(() => {
            if (!el.classList.contains('active')) { mo.disconnect(); cb(); }
        });
        mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    }

    async function enterLayer(m, i, card) {
        if (m.busy || man !== m) return;
        m.busy = true;
        card.classList.add('loading');
        const L = m.info.layers[i];
        let url = null;
        try {
            const res = await api('POST', 'layer', {
                session: m.info.session, index: i,
                detect: opts.suggest ? '1' : '0', min_area: opts.minArea
            });
            url = URL.createObjectURL(b64ToBlob(res.png, 'image/png'));
            const baseName = `${m.base}_${pad2(i + 1)}`;

            let preset = null;
            if (opts.suggest && res.people && res.people.length) {
                const big = res.people.slice().sort((a, b) =>
                    (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]))[0];
                const plan = planCrop(big.box, res.w, res.h, opts.margin);
                if (plan) preset = { bw: plan.cand.bw, bh: plan.cand.bh, crop: plan.crop };
                if (res.people.length > 1 && window.showAlert) window.showAlert(`${res.people.length} people found — the crop box starts on the largest one.`, 'info');
            }

            const virt = {
                virtual: true, url, name: res.name, baseName, w: res.w, h: res.h, ext: 'png',
                confirmLabel: '✅ Crop & Add to Dataset',
                note: 'A new PNG is added to the dataset — the source file is never changed.',
                onSave: async (blob) => {
                    const list = m.saved[i] || (m.saved[i] = []);
                    const wanted = list.length ? `${baseName}_p${list.length + 1}` : baseName;
                    const name = await uniqueBase(dirHandle, wanted);
                    await writeBlob(dirHandle, name + '.png', blob);
                    list.push(name + '.png');
                    m.dirty = true;
                    await saveManualProgress();
                    updateCardBadge(i);
                    return { name: name + '.png' };
                }
            };

            window.closeModal('modal-psd-layers');            // o popout do Bucket fica por cima sozinho
            await window.openFixBucketModal(virt, preset);
            onFixClosed(() => {
                try { URL.revokeObjectURL(url); } catch (e) {}
                m.busy = false;
                card.classList.remove('loading');
                if (man === m) window.openModal('modal-psd-layers');
            });
        } catch (e) {
            if (url) { try { URL.revokeObjectURL(url); } catch (x) {} }
            m.busy = false;
            card.classList.remove('loading');
            if (man === m) window.openModal('modal-psd-layers');
            if (window.showAlert) window.showAlert(`Layer “${L.name}”: ${e.message}`, 'error');
        }
    }

    /* ---------- init ---------- */
    function init() {
        const btn = document.getElementById('btn-psd-import');
        if (btn) btn.onclick = () => {
            if (running && runningDir !== dirHandle) {
                if (window.showAlert) window.showAlert('A PSD Import / Unpack of another folder is running — see ⏳ Tasks (only one at a time).', 'info');
                return;
            }
            if (running) {
                cancelled = true;
                btn.textContent = '⏹…';
                btn.title = 'Stopping after the current layer…';
                return;
            }
            if (psdMode === 'hide') return;
            if (psdMode === 'unpack') { unpackPending(); return; }
            window.openPsdImport();
        };
        (async () => {
            try {
                if (typeof window.getSetting === 'function') {
                    const m = await window.getSetting(MODE_SETTING, 'default');
                    if (['default', 'unpack', 'hide'].includes(m)) psdMode = m;
                }
            } catch (e) {}
            updateButton();
        })();
    }

    // Unpack only mode: every PSD not unpacked yet, straight away (no popout).
    async function unpackPending() {
        if (running || man) return;
        await loadOpts();
        await loadRegistry();
        const pending = [];
        for (const h of found) {
            try { if (!isDone(await h.getFile())) pending.push(h); } catch (e) { pending.push(h); }
        }
        if (!pending.length) { updateButton(); return; }
        runImport(pending, true);
    }
    function setMode(m, save) {
        if (!['default', 'unpack', 'hide'].includes(m)) m = 'default';
        psdMode = m;
        if (save !== false && typeof window.saveSetting === 'function') window.saveSetting(MODE_SETTING, m);
        updateButton();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.TMPsd = { setFound, open: () => window.openPsdImport(), manual: (h) => window.openPsdManual(h), planCrop, setMode, getMode: () => psdMode };
})();
