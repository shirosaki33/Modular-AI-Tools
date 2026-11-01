/* =========================================================================
   ASPECT RATIO BUCKET CHECKER (SD / SDXL / HD) — standalone
   ---------------------------------------------------------------------
   Detecta imagens do dataset cuja resolução NÃO bate exatamente com uma
   das 41 resoluções oficiais de treino do SDXL e ajuda a corrigir via
   crop guiado.

   FLUXO:
   1) Botão 🪣 na barra da lista força um scan (reusa a <img> já carregada).
   2) Imagem fora do bucket ganha borda vermelha + selo "🪣 WxH" e um
      contador clicável "🪣 N Bad Bucket".
   3) Com UMA imagem selecionada, "🪣 Fix Bucket" abre o popout com os
      buckets mais próximos e uma preview arrastável do corte.
   4) Ao confirmar: o ORIGINAL (+ legenda) vai pro 📦 Archive e só DEPOIS o
      arquivo cortado é gravado com o MESMO nome.

   ESCOLHA DO BUCKET: □ Quadrado (1024×1024) · ▯ Vertical · ▭ Horizontal.
   - "Change Bucket" (imagem já válida): botões Vertical / Horizontal
     filtram a lista (abre na orientação da imagem).
   - "Fix Bucket" (imagem fora do bucket): os dois blocos ficam visíveis,
     separados por um divisor (a orientação da imagem vem primeiro).
   ZOOM / CROP: slider (ou roda do mouse na preview) aproxima a área de
   corte; o resultado é redimensionado (Lanczos-3) para o bucket escolhido.
   "⟲ Keep W×H" usa a resolução atual — serve para só dar zoom/crop sem
   mudar a resolução.

   MODELO (droplist no popout, salvo em 'bucket-model', padrão SDXL):
   - SDXL: as 41 resoluções oficiais (área ≈ 1024²).
   - SD:   as mesmas proporções na metade do tamanho (área ≈ 512², ex.
           512×512, 608×416) + 512×768 / 768×512 (formato SD clássico).
   - HD:   as mesmas proporções 1.5× maiores que o SDXL (ex. 1536×1536,
           1824×1248).
   Trocar o modelo refaz a detecção de todo o dataset na hora (sem reler
   os arquivos — usa as resoluções já medidas).

   FIX (metadados): o crop é regravado via canvas, que descarta os chunks
   de texto do PNG (prompt / parâmetros de geração). Agora, para PNG, os
   chunks tEXt / iTXt / zTXt do original são copiados para o arquivo novo.
   JPEG/WebP: o modal avisa que os metadados não são mantidos (o original
   continua intacto no Archive).
========================================================================= */

(function () {

    /* ---------- TABELA OFICIAL DE BUCKETS SDXL (w, h) ----------
       41 buckets do paper da SDXL ("Multi-Aspect Training"), área ≈ 1024²,
       lados múltiplos de 64. */
    const SDXL_BUCKETS = [
        [1024, 1024],
        // paisagem (largura > altura)
        [2048, 512], [1984, 512], [1920, 512], [1856, 512],
        [1792, 576], [1728, 576], [1664, 576],
        [1600, 640], [1536, 640],
        [1472, 704], [1408, 704], [1344, 704],
        [1344, 768], [1280, 768],
        [1216, 832], [1152, 832],
        [1152, 896], [1088, 896],
        [1088, 960], [1024, 960],
        // retrato (altura > largura) — espelho exato da lista acima
        [960, 1024], [960, 1088],
        [896, 1088], [896, 1152],
        [832, 1152], [832, 1216],
        [768, 1280], [768, 1344],
        [704, 1344], [704, 1408], [704, 1472],
        [640, 1536], [640, 1600],
        [576, 1664], [576, 1728], [576, 1792],
        [512, 1856], [512, 1920], [512, 1984], [512, 2048]
    ];

    const BUCKET_MODELS = {
        sd:   { label: 'SD',   title: 'SD 1.5 / 2.x — about 512² (half of SDXL)' },
        sdxl: { label: 'SDXL', title: 'SDXL / Pony / Illustrious — about 1024² (official 41 buckets)' },
        hd:   { label: 'HD',   title: 'HD — 1.5× the SDXL resolutions (about 1536²)' }
    };
    const MODEL_SETTING = 'bucket-model';

    function buildBuckets(model) {
        if (model === 'hd') return SDXL_BUCKETS.map(([w, h]) => [w * 1.5, h * 1.5]);
        if (model === 'sd') {
            const list = SDXL_BUCKETS.map(([w, h]) => [w / 2, h / 2]);
            [[512, 768], [768, 512]].forEach(([w, h]) => { if (!list.some(b => b[0] === w && b[1] === h)) list.push([w, h]); });
            return list;
        }
        return SDXL_BUCKETS.slice();
    }

    let bucketModel = 'sdxl';
    let BUCKETS = buildBuckets(bucketModel);
    let BUCKET_KEYS = new Set(BUCKETS.map(([w, h]) => w + 'x' + h));
    const modelLabel = () => BUCKET_MODELS[bucketModel].label;

    /* Troca o modelo: refaz tabela + detecção do dataset inteiro (sem reler arquivos). */
    function setBucketModel(model, save = true) {
        if (!BUCKET_MODELS[model]) model = 'sdxl';
        bucketModel = model;
        BUCKETS = buildBuckets(model);
        BUCKET_KEYS = new Set(BUCKETS.map(([w, h]) => w + 'x' + h));
        window._bucketResults.forEach((r) => { r.bad = !BUCKET_KEYS.has(r.w + 'x' + r.h); });
        if (save && typeof window.saveSetting === 'function') window.saveSetting(MODEL_SETTING, model);
        applyBadgesToList();
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) updateFixBucketButtonVisibility();
    }
    window.setBucketModel = setBucketModel;

    async function loadBucketModel() {
        try {
            if (typeof window.getSetting !== 'function') return;
            const saved = await window.getSetting(MODEL_SETTING, 'sdxl');
            if (saved && saved !== bucketModel) setBucketModel(saved, false);
        } catch (e) { /* SDXL */ }
    }

    /* ▭ paisagem, ▯ retrato, □ quadrado */
    function orientMark(w, h) {
        if (w > h) return '▭';
        if (h > w) return '▯';
        return '□';
    }
    function formatRes(w, h) {
        return orientMark(w, h) + ' ' + w + '×' + h;
    }

    /* ---------- CSS ---------- */
    const style = document.createElement('style');
    style.innerHTML = `
        .list-item.bad-bucket { border-left: 3px solid #ff4444 !important; background: rgba(200,40,40,0.12) !important; padding-left: 9px; }
        .list-item.bad-bucket.selected { border-left: 3px solid #4db8ff !important; }
        .bucket-bad-badge { display:inline-block; margin-left:6px; font-size:9px; font-weight:bold; color:#ffaaaa; background:#330000; border:1px solid #ff4444; border-radius:10px; padding:1px 6px; vertical-align:middle; cursor:help; white-space:nowrap; }

        #btn-bucket-issues { display:none; background:#330000; border:1px solid #ff4444; color:#ffaaaa; padding:2px 6px; font-size:11px; margin-left:6px; border-radius:4px; cursor:pointer; font-weight:bold; }
        #btn-scan-buckets { flex-shrink:0; padding:6px 10px; font-size:14px; background:transparent; border:1px solid #444; color:#aaa; }
        #btn-scan-buckets:hover { color:#00ff99; border-color:#00ff99; }
        #btn-fix-bucket { display:none; background:#2a0000; border-color:#aa0000; color:#ff8080; }
        #btn-fix-bucket.is-valid { background:#0d2a18; border-color:#00aa66; color:#00ff99; }
        #btn-fix-bucket.is-unknown { background:#1a3a5c; border-color:#2a5a8c; color:#4db8ff; }

        #modal-fix-bucket .tool-modal { width: 620px; max-width: 92vw; max-height: 88vh; overflow-y: auto; }
        .bucket-orient-bar { display:flex; flex-wrap:wrap; gap:6px; align-items:stretch; margin-top:4px; }
        .bucket-orient-btn { background:#151515; border:1px solid #444; border-radius:8px; padding:6px 12px; cursor:pointer; font-size:12px; font-weight:bold; color:#aaa; }
        .bucket-orient-btn:hover { color:#fff; border-color:#777; }
        .bucket-orient-btn.active { background:#1a2a3c; border-color:#4db8ff; color:#4db8ff; }
        .bucket-orient-btn .bo-count { font-weight:normal; color:#777; font-size:10px; margin-left:4px; }
        .bucket-orient-sep { width:1px; background:#333; margin:0 2px; }
        .bucket-candidate-list { display:flex; flex-wrap:wrap; gap:6px; margin: 8px 0; max-height: 300px; overflow-y: auto; flex-shrink: 0; align-content:flex-start; }
        .bucket-block-label { flex:0 0 100%; font-size:10px; font-weight:bold; color:#777; text-transform:uppercase; letter-spacing:.6px; border-top:1px solid #2c2c2c; padding-top:6px; margin-top:2px; }
        .bucket-block-label:first-child { border-top:none; padding-top:0; margin-top:0; }
        .bucket-candidate-chip { background:#151515; border:1px solid #444; border-radius:8px; padding:6px 10px; cursor:pointer; font-size:12px; color:#ddd; text-align:center; transition:0.15s; }
        .bucket-candidate-chip.is-keep { border-color:#6a5a2a; color:#ffd27a; }
        .bucket-candidate-chip.is-keep.active { border-color:#ffcc44; background:#2a2208; color:#ffcc44; }
        .bucket-model-row { display:flex; align-items:center; gap:8px; font-size:12px; }
        .bucket-model-row select { width:auto; font-size:12px; }
        .bucket-zoom-row { display:flex; align-items:center; gap:8px; font-size:12px; color:#ccc; }
        .bucket-zoom-row input[type=range] { flex:1; accent-color:#00ff99; padding:0; min-width:0; }
        #bucket-zoom-val { flex:0 0 44px; text-align:right; color:#00ff99; font-weight:bold; font-size:11px; }
        #bucket-zoom-reset { background:transparent; border:1px solid #555; color:#aaa; border-radius:4px; padding:2px 8px; cursor:pointer; font-size:12px; }
        #bucket-zoom-reset:hover { color:#fff; border-color:#999; }
        .bucket-candidate-chip:hover { border-color:#666; }
        .bucket-candidate-chip.active { border-color:#00ff99; background:#0d2a18; color:#00ff99; }
        .bucket-candidate-chip.is-current { border-style: dashed; }
        .bucket-candidate-chip .bc-kept { display:block; font-size:10px; color:#888; margin-top:2px; }
        .bucket-candidate-chip.active .bc-kept { color:#66ffaa; }

        #bucket-preview-wrap { position:relative; margin: 15px auto; background:#000; overflow:hidden; border:1px solid #333; border-radius:6px; width: fit-content; max-width: 100%; line-height: 0; flex-shrink: 0; align-self: center; touch-action: none; cursor: grab; user-select: none; }
        #bucket-preview-wrap.dragging { cursor: grabbing; }
        #bucket-preview-img { display:block; width:auto; height:auto; max-width: min(480px, 100%); max-height: 52vh; object-fit: contain; user-select:none; -webkit-user-drag:none; position: relative; z-index: 0 !important; pointer-events: none !important; }
        #bucket-crop-shade { position:absolute; pointer-events: none !important; box-shadow: 0 0 0 2000px rgba(0,0,0,0.55); box-sizing: border-box; z-index: 1 !important; }
        #bucket-crop-rect { position:absolute; border:2px solid #00ff99; cursor: grab; box-sizing: border-box; z-index: 2 !important; pointer-events: auto !important; background: rgba(0,255,153,0.05); }
        #bucket-crop-rect.dragging { cursor: grabbing; }
        .bucket-warn-upscale { font-size:11px; color:#ffcc66; background:#2a1a00; border:1px solid #aa6600; padding:8px 10px; border-radius:6px; margin-top:10px; display:none; }
        #bucket-meta-note { font-size:11px; color:#888; margin-top:4px; }
        #bucket-meta-note.warn { color:#ffcc66; }
    `;
    document.head.appendChild(style);

    /* ---------- ESTADO ---------- */
    window._bucketResults = window._bucketResults || new Map(); // img -> {w,h,bad}

    function resetForNewDataset() {
        window._bucketResults = new Map();
        window._bucketIssueIndices = [];
        // Scan automático e silencioso a cada dataset/subpasta carregado
        setTimeout(() => window.scanDatasetBuckets(true), 150);
    }

    /* ---------- MEDIÇÃO DE RESOLUÇÃO REAL ---------- */
    // A miniatura da lista agora é reduzida (tagmanager_ui_list.js), então o tamanho
    // dela NÃO é a resolução real. Usa só a resolução real já guardada.
    function measureFromThumb(img) {
        return img && img._resolution ? img._resolution : null;
    }

    // Lê a resolução pelo cabeçalho do arquivo (tagmanager_tm.js), sem decodificar a imagem.
    function measureViaLoader(img) {
        return window.TM.getImageSize(img);
    }

    async function getImageSize(img) {
        return measureFromThumb(img) || await measureViaLoader(img);
    }

    function markResult(img, size) {
        if (!size) return;
        const bad = !BUCKET_KEYS.has(size.w + 'x' + size.h);
        window._bucketResults.set(img, { w: size.w, h: size.h, bad });
    }

    /* ---------- BADGES NA LISTA (pós-render) + CONTADOR ---------- */
    function applyBadgesToList() {
        if (typeof imageFiles === 'undefined') return;
        imageFiles.forEach(img => {
            if (!img.element) return;
            const nameEl = img.element.querySelector('.list-item-name');
            const result = window._bucketResults.get(img);
            const resEl = img.element.querySelector('.list-item-resolution');
            if (result && resEl) {
                const label = ` · ${formatRes(result.w, result.h)}`;
                if (resEl.textContent !== label) resEl.textContent = label;
            }
            const isBad = !!(result && result.bad);
            img.element.classList.toggle('bad-bucket', isBad);
            let badge = nameEl && nameEl.querySelector('.bucket-bad-badge');
            if (isBad) {
                if (nameEl && !badge) {
                    badge = document.createElement('span');
                    badge.className = 'bucket-bad-badge';
                    nameEl.appendChild(badge);
                }
                if (badge) {
                    badge.textContent = `🪣 ${formatRes(result.w, result.h)}`;
                    badge.title = `Resolution is not an ${modelLabel()} training bucket. Select this image and use "🪣 Fix Bucket".`;
                }
            } else if (badge) {
                badge.remove();
            }
        });
        updateBucketCounter();
    }

    function updateBucketCounter() {
        const btn = document.getElementById('btn-bucket-issues');
        if (!btn) return;
        const badIndices = [];
        if (typeof imageFiles !== 'undefined') {
            imageFiles.forEach((img, idx) => {
                if (img.hidden) return;
                const r = window._bucketResults.get(img);
                if (r && r.bad) badIndices.push(idx);
            });
        }
        window._bucketIssueIndices = badIndices;
        if (badIndices.length > 0) {
            btn.style.display = 'inline-block';
            btn.textContent = `🪣 ${badIndices.length} Bad Bucket`;
        } else {
            btn.style.display = 'none';
        }
    }

    window.selectBucketIssueImage = function () {
        const arr = window._bucketIssueIndices || [];
        if (arr.length === 0 || typeof imageFiles === 'undefined') return;
        let current = -1;
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) current = Array.from(selectedIndices)[0];
        let nextIdx = arr[0];
        const pos = arr.indexOf(current);
        if (pos !== -1) nextIdx = arr[(pos + 1) % arr.length];
        else { for (let i = 0; i < arr.length; i++) { if (arr[i] > current) { nextIdx = arr[i]; break; } } }
        if (typeof selectedIndices !== 'undefined') { selectedIndices.clear(); selectedIndices.add(nextIdx); }
        const targetImg = imageFiles[nextIdx];
        if (targetImg && targetImg.element) targetImg.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
        if (typeof window.renderEditor === 'function') window.renderEditor();
    };

    /* ---------- SCAN (botão 🪣 / automático) ---------- */
    window.scanDatasetBuckets = async function (silent) {
        silent = silent === true;
        if (typeof imageFiles === 'undefined' || imageFiles.length === 0) {
            if (!silent && window.showAlert) window.showAlert('No dataset loaded.', 'warn');
            return;
        }
        const btn = document.getElementById('btn-scan-buckets');
        if (!silent && btn) { btn.disabled = true; btn.textContent = '⏳'; }

        // Se o dataset trocar no meio do scan, aborta.
        const resultsRef = window._bucketResults;
        const toMeasure = imageFiles.slice();
        const concurrency = 20;
        let aborted = false;
        for (let i = 0; i < toMeasure.length; i += concurrency) {
            const chunk = toMeasure.slice(i, i + concurrency);
            const sizes = await Promise.all(chunk.map(getImageSize));
            if (window._bucketResults !== resultsRef) { aborted = true; break; }
            chunk.forEach((img, j) => markResult(img, sizes[j]));
        }

        if (btn) { btn.disabled = false; btn.textContent = '🪣'; }
        if (aborted) return;

        applyBadgesToList();
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) updateFixBucketButtonVisibility();

        if (!silent && window.showAlert) {
            const badCount = (window._bucketIssueIndices || []).length;
            window.showAlert(badCount > 0
                ? `Scan complete: ${badCount} image(s) are not on an ${modelLabel()} bucket resolution.`
                : `Scan complete: all images already match an ${modelLabel()} bucket resolution!`,
                badCount > 0 ? 'warn' : 'success');
        }
    };

    /* ---------- BOTÕES INJETADOS ---------- */
    function injectListCounterButton() {
        const headerLeft = document.querySelector('#col-list .panel-header > div:first-child');
        const listCount = document.getElementById('list-count');
        if (!headerLeft || !listCount || document.getElementById('btn-bucket-issues')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-bucket-issues';
        btn.title = 'Images with a resolution outside the training buckets of the selected model (SD / SDXL / HD) — click to jump to one';
        btn.onclick = () => window.selectBucketIssueImage();
        listCount.insertAdjacentElement('afterend', btn);
    }

    function injectScanButton() {
        const anchor = document.getElementById('btn-compact-group-depth') || document.getElementById('btn-toggle-compact-view');
        if (!anchor || document.getElementById('btn-scan-buckets')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-scan-buckets';
        btn.textContent = '🪣';
        btn.title = 'Scan dataset for images outside the training bucket resolutions (model: SD / SDXL / HD, chosen in the Bucket popout)';
        btn.onclick = () => window.scanDatasetBuckets(false);
        anchor.insertAdjacentElement('afterend', btn);
    }

    function injectFixBucketButton() {
        const headerRight = document.querySelector('#col-editor .panel-header > div:last-child');
        if (!headerRight || document.getElementById('btn-fix-bucket')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-fix-bucket';
        btn.className = 'btn-save-local';
        btn.textContent = '🪣 Bucket';
        btn.title = 'Crop or resize this image to any training bucket — works even if the resolution is already valid';
        btn.onclick = () => {
            if (typeof selectedIndices === 'undefined' || selectedIndices.size !== 1) return;
            const img = imageFiles[Array.from(selectedIndices)[0]];
            window.openFixBucketModal(img);
        };
        headerRight.insertBefore(btn, headerRight.firstChild);
    }

    function updateFixBucketButtonVisibility() {
        const btn = document.getElementById('btn-fix-bucket');
        if (!btn) return;
        if (typeof selectedIndices === 'undefined' || selectedIndices.size !== 1 || typeof imageFiles === 'undefined') { btn.style.display = 'none'; return; }
        const img = imageFiles[Array.from(selectedIndices)[0]];
        const result = img && window._bucketResults.get(img);
        btn.style.display = 'inline-block';
        btn.classList.remove('is-valid', 'is-unknown');
        if (result && result.bad) {
            btn.textContent = '🪣 Fix Bucket';
            btn.title = `This image is not on an ${modelLabel()} bucket resolution — click to crop it to one`;
        } else if (result) {
            btn.classList.add('is-valid');
            btn.textContent = '🪣 Change Bucket';
            btn.title = `Already on an ${modelLabel()} bucket (${formatRes(result.w, result.h)}). Click to crop or resize it to a different bucket.`;
        } else {
            btn.classList.add('is-unknown');
            btn.textContent = '🪣 Bucket';
            btn.title = `Crop or resize this image to an ${modelLabel()} training bucket`;
        }
    }

    /* ---------- SUGESTÃO DE BUCKETS (por proximidade de aspect ratio) ---------- */
    function suggestBuckets(w, h, limit = BUCKETS.length) {
        const imgAR = w / h;
        return BUCKETS
            .map(([bw, bh]) => {
                const scale = Math.max(bw / w, bh / h);
                const kept = (bw * bh) / (scale * scale * w * h);
                return { bw, bh, diff: Math.abs(Math.log(bw / bh) - Math.log(imgAR)), kept, scale };
            })
            .sort((a, b) => a.diff - b.diff)
            .slice(0, limit);
    }

    /* API pública (usada pelo 🧐 Evaluator): mesma tabela / modelo SD-SDXL-HD do popout. */
    window.TMBuckets = {
        model: () => bucketModel,
        label: () => modelLabel(),
        isBucket: (w, h) => BUCKET_KEYS.has(w + 'x' + h),
        suggest: (w, h, limit) => suggestBuckets(w, h, limit)
    };

    function imageExt(img) {
        return (String(img && img.name || '').split('.').pop() || 'png').toLowerCase();
    }

    /* ---------- PNG: cópia dos chunks de texto (prompt / parâmetros) ---------- */
    const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    const PNG_TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt']);

    function isPng(bytes) {
        if (!bytes || bytes.length < 8) return false;
        for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
        return true;
    }

    // Lista [{type, start, end}] de cada chunk (start/end cobrem length+type+data+crc).
    function listPngChunks(bytes) {
        const out = [];
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let p = 8;
        while (p + 12 <= bytes.length) {
            const len = view.getUint32(p);
            const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
            const end = p + 12 + len;
            if (end > bytes.length) break;
            out.push({ type, start: p, end });
            p = end;
            if (type === 'IEND') break;
        }
        return out;
    }

    /* Devolve um Blob PNG = PNG novo + chunks de texto do original inseridos
       logo antes do primeiro IDAT. Sem chunks de texto (ou se algo falhar),
       devolve o PNG novo como veio. */
    async function copyPngTextChunks(originalBlob, newBlob) {
        try {
            const orig = new Uint8Array(await originalBlob.arrayBuffer());
            const fresh = new Uint8Array(await newBlob.arrayBuffer());
            if (!isPng(orig) || !isPng(fresh)) return { blob: newBlob, copied: 0 };

            const textChunks = listPngChunks(orig).filter(c => PNG_TEXT_CHUNKS.has(c.type));
            if (textChunks.length === 0) return { blob: newBlob, copied: 0 };

            const freshChunks = listPngChunks(fresh);
            const firstIdat = freshChunks.find(c => c.type === 'IDAT');
            if (!firstIdat) return { blob: newBlob, copied: 0 };

            const parts = [fresh.subarray(0, firstIdat.start)];
            textChunks.forEach(c => parts.push(orig.subarray(c.start, c.end)));
            parts.push(fresh.subarray(firstIdat.start));
            return { blob: new Blob(parts, { type: 'image/png' }), copied: textChunks.length };
        } catch (e) {
            console.warn('[Bucket Fix] Could not copy PNG metadata:', e);
            return { blob: newBlob, copied: 0 };
        }
    }

    /* ---------- MODAL DE FIX + PREVIEW ARRASTÁVEL ---------- */
    function buildFixModal() {
        const existing = document.getElementById('modal-fix-bucket');
        if (existing && document.getElementById('bucket-crop-shade') && document.getElementById('bucket-meta-note') && document.getElementById('bucket-zoom') && document.getElementById('bucket-model-select')) return;
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'modal-fix-bucket';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-fix-bucket');
        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🪣 Bucket — Resize / Zoom &amp; Crop</span>
                    <button onclick="window.closeModal('modal-fix-bucket')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div class="bucket-model-row">
                    <span style="color:#9ecfff; font-weight:bold;">Model</span>
                    <select id="bucket-model-select" title="Which training resolutions to use — also changes the bad-bucket detection of the whole dataset (saved)">
                        ${Object.entries(BUCKET_MODELS).map(([k, m]) => `<option value="${k}" title="${m.title}">${m.label} — ${m.title.split(' — ')[1]}</option>`).join('')}
                    </select>
                </div>
                <div id="bucket-fix-info" style="font-size:12px; color:#aaa; margin-bottom:6px;"></div>
                <div class="bucket-orient-bar" id="bucket-orient-bar"></div>
                <div class="bucket-candidate-list" id="bucket-candidate-list"></div>
                <div id="bucket-preview-wrap">
                    <img id="bucket-preview-img" src="" alt="" draggable="false">
                    <div id="bucket-crop-shade"></div>
                    <div id="bucket-crop-rect"></div>
                </div>
                <div class="bucket-zoom-row" title="Zoom in to crop tighter — the crop is resized to the chosen resolution. Mouse wheel on the preview also zooms.">
                    <span style="color:#9ecfff; font-weight:bold;">🔎 Zoom</span>
                    <input type="range" id="bucket-zoom" min="100" max="400" step="5" value="100">
                    <span id="bucket-zoom-val">100%</span>
                    <button id="bucket-zoom-reset" title="Back to 100% (no zoom)">↺</button>
                </div>
                <div id="bucket-upscale-warning" class="bucket-warn-upscale">⚠️ This bucket is larger than the crop. Saving will upscale with Lanczos-3, which stays sharper than the browser's default resize.</div>
                <div id="bucket-drag-hint" style="font-size:11px; color:#aaa; margin-top:8px;"></div>
                <div style="font-size:11px; color:#666; margin-top:4px;">The original file will be moved to 📦 Archive before saving (fully recoverable from there).</div>
                <div id="bucket-meta-note"></div>
                <div class="modal-buttons">
                    <button class="btn-cancel" onclick="window.closeModal('modal-fix-bucket')">Cancel</button>
                    <button id="btn-confirm-fix-bucket" style="background:#00aa66; color:#000; border:none; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer;">✅ Apply Crop &amp; Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    let _fixState = null; // { img, w, h, candidates, candidate, keepCand, offsetX, offsetY, cropW, cropH, scale, zoom, tab, fixMode }

    const ZOOM_MIN = 1, ZOOM_MAX = 4;

    function orientOf(w, h) { return w === h ? 'square' : (h > w ? 'vertical' : 'horizontal'); }

    function selectCandidate(cand) {
        _fixState.candidate = cand;
        _fixState.offsetX = null; // recentraliza no novo bucket escolhido
        _fixState.offsetY = null;
        const o = orientOf(cand.bw, cand.bh);
        if (!_fixState.fixMode && (o === 'vertical' || o === 'horizontal') && !cand.keep) _fixState.tab = o;
        renderCandidateChips();
        renderCropOverlay();
    }

    function makeChip(c, closest, asKeep = false) {
        const keepLook = asKeep || !!c.keep;
        const isCurrent = !keepLook && c.bw === _fixState.w && c.bh === _fixState.h;
        const chip = document.createElement('div');
        chip.className = 'bucket-candidate-chip' + (c === _fixState.candidate ? ' active' : '') + (isCurrent ? ' is-current' : '') + (keepLook ? ' is-keep' : '');
        if (keepLook) {
            chip.innerHTML = `⟲ Keep ${_fixState.w}×${_fixState.h}<span class="bc-kept">zoom / crop only</span>`;
            chip.title = 'Keep the current resolution — use the zoom slider to crop in without changing the size';
        } else {
            const notes = [];
            if (isCurrent) notes.push('current');
            if (c === closest) notes.push('closest AR');
            chip.innerHTML = `${formatRes(c.bw, c.bh)}<span class="bc-kept">${Math.round(c.kept * 100)}% kept${notes.length ? ' · ' + notes.join(' · ') : ''}</span>`;
        }
        chip.onclick = () => selectCandidate(c);
        return chip;
    }

    /* Ordem dentro do bloco: do mais próximo do quadrado ao mais extremo. */
    function byShape(list) {
        return list.slice().sort((a, b) => Math.max(a.bw / a.bh, a.bh / a.bw) - Math.max(b.bw / b.bh, b.bh / b.bw));
    }

    function renderCandidateChips() {
        const st = _fixState;
        const bar = document.getElementById('bucket-orient-bar');
        const list = document.getElementById('bucket-candidate-list');
        bar.innerHTML = '';
        list.innerHTML = '';
        const closest = st.candidates[0];
        const square = st.candidates.find(c => c.bw === c.bh);
        const vertical = byShape(st.candidates.filter(c => c.bh > c.bw));
        const horizontal = byShape(st.candidates.filter(c => c.bw > c.bh));

        // Linha de cima: □ quadrado (já é a resolução) · ▯ Vertical · ▭ Horizontal · ⟲ Keep
        if (square) bar.appendChild(makeChip(square, closest));
        if (!st.fixMode) {
            bar.appendChild(Object.assign(document.createElement('div'), { className: 'bucket-orient-sep' }));
            [['vertical', '▯ Vertical', vertical], ['horizontal', '▭ Horizontal', horizontal]].forEach(([key, label, arr]) => {
                const b = document.createElement('button');
                b.className = 'bucket-orient-btn' + (st.tab === key ? ' active' : '');
                b.innerHTML = `${label}<span class="bo-count">${arr.length}</span>`;
                b.title = `List only the ${key} resolutions`;
                b.onclick = () => { st.tab = key; renderCandidateChips(); };
                bar.appendChild(b);
            });
        }
        if (st.keepCand) {
            bar.appendChild(Object.assign(document.createElement('div'), { className: 'bucket-orient-sep' }));
            bar.appendChild(makeChip(st.keepCand, closest, true));
        }

        const block = (label, arr) => {
            if (!arr.length) return;
            const head = document.createElement('div');
            head.className = 'bucket-block-label';
            head.textContent = label;
            list.appendChild(head);
            arr.forEach(c => list.appendChild(makeChip(c, closest)));
        };
        if (st.fixMode) {
            // Fix Bucket: os dois blocos visíveis; a orientação da imagem primeiro.
            const vFirst = orientOf(st.w, st.h) !== 'horizontal';
            if (vFirst) { block('▯ Vertical', vertical); block('▭ Horizontal', horizontal); }
            else { block('▭ Horizontal', horizontal); block('▯ Vertical', vertical); }
        } else {
            st.tab === 'horizontal' ? horizontal.forEach(c => list.appendChild(makeChip(c, closest)))
                                    : vertical.forEach(c => list.appendChild(makeChip(c, closest)));
        }
    }

    /* Zoom mantendo o centro do corte no mesmo ponto da imagem. */
    function setZoom(z) {
        const st = _fixState;
        if (!st) return;
        z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
        if (st.cropW && st.offsetX != null) {
            const cx = st.offsetX + st.cropW / 2, cy = st.offsetY + st.cropH / 2;
            const k = (st.zoom || 1) / z;
            st.offsetX = cx - (st.cropW * k) / 2;
            st.offsetY = cy - (st.cropH * k) / 2;
        }
        st.zoom = z;
        const slider = document.getElementById('bucket-zoom');
        if (slider && document.activeElement !== slider) slider.value = Math.round(z * 100);
        const val = document.getElementById('bucket-zoom-val');
        if (val) val.textContent = Math.round(z * 100) + '%';
        renderCropOverlay();
    }

    function renderCropOverlay() {
        const c = _fixState.candidate;
        const { w, h } = _fixState;
        const zoom = _fixState.zoom || 1;
        const baseScale = Math.max(c.bw / w, c.bh / h);
        let cropW = c.bw / baseScale, cropH = c.bh / baseScale;
        if (cropW > w) cropW = w;
        if (cropH > h) cropH = h;
        cropW /= zoom; cropH /= zoom;
        const scale = c.bw / cropW;   // fator final do corte -> bucket (> 1 = upscale)

        if (_fixState.offsetX === null) _fixState.offsetX = (w - cropW) / 2;
        if (_fixState.offsetY === null) _fixState.offsetY = (h - cropH) / 2;
        _fixState.offsetX = Math.max(0, Math.min(w - cropW, _fixState.offsetX));
        _fixState.offsetY = Math.max(0, Math.min(h - cropH, _fixState.offsetY));
        _fixState.cropW = cropW; _fixState.cropH = cropH; _fixState.scale = scale;

        const previewImgEl = document.getElementById('bucket-preview-img');
        const dispW = previewImgEl.clientWidth;
        const dispH = previewImgEl.clientHeight;
        if (!dispW || !dispH) return;
        const scaleX = dispW / w;
        const scaleY = dispH / h;
        // Ponteiro: usa o tamanho NA TELA (o popout pode estar com zoom pelo slider de tamanho).
        const box = previewImgEl.getBoundingClientRect();
        _fixState.previewScaleX = box.width > 0 ? box.width / w : scaleX;
        _fixState.previewScaleY = box.height > 0 ? box.height / h : scaleY;
        _fixState.previewScale = scaleX;

        const rect = document.getElementById('bucket-crop-rect');
        const shade = document.getElementById('bucket-crop-shade');
        const left = (_fixState.offsetX * scaleX) + 'px';
        const top = (_fixState.offsetY * scaleY) + 'px';
        const width = (cropW * scaleX) + 'px';
        const height = (cropH * scaleY) + 'px';
        rect.style.left = left;
        rect.style.top = top;
        rect.style.width = width;
        rect.style.height = height;
        if (shade) {
            shade.style.left = left;
            shade.style.top = top;
            shade.style.width = width;
            shade.style.height = height;
        }

        document.getElementById('bucket-upscale-warning').style.display = (scale > 1.001) ? 'block' : 'none';

        // Nada para mudar: mesma resolução e sem zoom.
        const noop = c.bw === w && c.bh === h && zoom <= 1.0001;
        const confirmBtn = document.getElementById('btn-confirm-fix-bucket');
        if (confirmBtn && confirmBtn.textContent.indexOf('⏳') !== 0) {
            confirmBtn.disabled = noop;
            confirmBtn.style.opacity = noop ? '0.45' : '';
            confirmBtn.title = noop ? 'Nothing to change — pick another resolution or zoom in' : '';
        }

        const hint = document.getElementById('bucket-drag-hint');
        if (hint) {
            const slackX = Math.max(0, w - cropW);
            const slackY = Math.max(0, h - cropH);
            const keptPct = Math.round((cropW * cropH) / (w * h) * 100);
            const target = c.keep ? `${c.bw}×${c.bh} (current)` : formatRes(c.bw, c.bh);
            if (noop) {
                hint.textContent = `Same resolution and no zoom — nothing would change. Zoom in to crop, or pick another resolution.`;
            } else if (slackX < 1 && slackY < 1) {
                hint.textContent = `This bucket matches the image aspect (${keptPct}% kept), so the green box covers the whole frame and cannot slide. Zoom in or pick another size to crop.`;
            } else if (slackX < 1) {
                hint.textContent = `Drag the green box up or down — ${target} keeps ${keptPct}% and only has vertical margin.`;
            } else if (slackY < 1) {
                hint.textContent = `Drag the green box left or right — ${target} keeps ${keptPct}% and only has horizontal margin.`;
            } else {
                hint.textContent = `Drag the green box to choose what stays — ${target} keeps ${keptPct}% of the image.`;
            }
        }
    }

    /* Listeners no window (capture), lendo o estado do módulo — assim o
       arraste continua funcionando em todas as aberturas do modal. */
    let _drag = null;
    let _dragBound = false;
    function onBucketPointerDown(e) {
        const wrap = document.getElementById('bucket-preview-wrap');
        if (!wrap || !_fixState || !_fixState.candidate) return;
        if (e.button !== undefined && e.button !== 0) return;
        if (!wrap.contains(e.target)) return;
        if (_fixState.offsetX == null || _fixState.offsetY == null) renderCropOverlay();
        _drag = {
            id: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startOffX: _fixState.offsetX || 0,
            startOffY: _fixState.offsetY || 0
        };
        wrap.classList.add('dragging');
        const rect = document.getElementById('bucket-crop-rect');
        if (rect) rect.classList.add('dragging');
        try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
        e.stopPropagation();
    }
    function onBucketPointerMove(e) {
        if (!_drag || !_fixState || e.pointerId !== _drag.id) return;
        const sx = _fixState.previewScaleX > 0 ? _fixState.previewScaleX : 1;
        const sy = _fixState.previewScaleY > 0 ? _fixState.previewScaleY : 1;
        _fixState.offsetX = _drag.startOffX + (e.clientX - _drag.startX) / sx;
        _fixState.offsetY = _drag.startOffY + (e.clientY - _drag.startY) / sy;
        renderCropOverlay();
        e.preventDefault();
        e.stopPropagation();
    }
    function onBucketPointerUp(e) {
        if (!_drag || (e && e.pointerId !== undefined && e.pointerId !== _drag.id)) return;
        _drag = null;
        const wrap = document.getElementById('bucket-preview-wrap');
        if (wrap) wrap.classList.remove('dragging');
        const rect = document.getElementById('bucket-crop-rect');
        if (rect) rect.classList.remove('dragging');
    }
    function setupCropDrag() {
        const img = document.getElementById('bucket-preview-img');
        if (img) {
            img.draggable = false;
            if (window.ResizeObserver && !img._bucketObserved) {
                img._bucketObserved = true;
                const ro = new ResizeObserver(() => {
                    if (_fixState && !_drag) renderCropOverlay();
                });
                ro.observe(img);
            }
        }
        const wrapEl = document.getElementById('bucket-preview-wrap');
        if (wrapEl && !wrapEl._bucketWheel) {
            wrapEl._bucketWheel = true;
            wrapEl.addEventListener('wheel', (e) => {
                if (!_fixState) return;
                e.preventDefault();
                setZoom((_fixState.zoom || 1) * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
            }, { passive: false });
        }
        const zs = document.getElementById('bucket-zoom');
        if (zs && !zs._bound) {
            zs._bound = true;
            zs.oninput = () => setZoom(parseInt(zs.value, 10) / 100);
            document.getElementById('bucket-zoom-reset').onclick = () => setZoom(1);
        }
        if (_dragBound) return;
        _dragBound = true;
        window.addEventListener('pointerdown', onBucketPointerDown, true);
        window.addEventListener('pointermove', onBucketPointerMove, true);
        window.addEventListener('pointerup', onBucketPointerUp, true);
        window.addEventListener('pointercancel', onBucketPointerUp, true);
    }

    /* Monta o estado do popout para a imagem (chamado ao abrir e ao trocar o modelo). */
    function initFixState(img, result, preset) {
        const alreadyValid = !result.bad;
        const candidates = suggestBuckets(result.w, result.h);
        let candidate = candidates[0];
        if (alreadyValid) {
            const other = candidates.find(c => c.bw !== result.w || c.bh !== result.h);
            if (other) candidate = other;
        }
        // "Keep W×H": mesma resolução, só zoom/crop. Na imagem já válida é o próprio bucket atual.
        const keepCand = alreadyValid
            ? (candidates.find(c => c.bw === result.w && c.bh === result.h) || null)
            : { bw: result.w, bh: result.h, kept: 1, scale: 1, diff: 0, keep: true };
        const o = orientOf(candidate.bw, candidate.bh);
        _fixState = {
            img, w: result.w, h: result.h, candidates, candidate, keepCand, offsetX: null, offsetY: null, alreadyValid,
            zoom: 1, fixMode: !alreadyValid,
            tab: o === 'square' ? (result.w > result.h ? 'horizontal' : 'vertical') : o
        };
        const zs = document.getElementById('bucket-zoom');
        if (zs) zs.value = 100;
        const zv = document.getElementById('bucket-zoom-val');
        if (zv) zv.textContent = '100%';

        // Preset (ex.: sugestão do 🧐 Evaluator): bucket + região de corte em px da imagem real.
        if (preset && preset.bw && preset.bh) {
            const c = candidates.find(x => x.bw === preset.bw && x.bh === preset.bh);
            if (c) {
                _fixState.candidate = c;
                const o2 = orientOf(c.bw, c.bh);
                if (o2 !== 'square') _fixState.tab = o2;
                if (preset.crop && preset.crop.w > 0) {
                    const baseScale = Math.max(c.bw / result.w, c.bh / result.h);
                    const baseW = Math.min(result.w, c.bw / baseScale);
                    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, baseW / preset.crop.w));
                    const cw = baseW / z, ch = Math.min(result.h, c.bh / baseScale) / z;
                    const cx = preset.crop.x + preset.crop.w / 2, cy = preset.crop.y + preset.crop.h / 2;
                    _fixState.zoom = z;
                    _fixState.offsetX = cx - cw / 2;
                    _fixState.offsetY = cy - ch / 2;
                    if (zs) zs.value = Math.round(z * 100);
                    if (zv) zv.textContent = Math.round(z * 100) + '%';
                }
            }
        }

        document.getElementById('bucket-fix-info').textContent = alreadyValid
            ? `Current resolution: ${formatRes(result.w, result.h)} — already a valid ${modelLabel()} bucket. Pick another size (dashed chip = current), or keep it and just zoom / crop.`
            : `Current resolution: ${formatRes(result.w, result.h)} (not a valid ${modelLabel()} bucket). Choose a target bucket below, or "Keep" to only zoom / crop:`;

    }

    window.openFixBucketModal = async function (img, preset) {
        let result = window._bucketResults.get(img);
        if (!result) {
            const size = await getImageSize(img);
            if (!size) {
                if (window.showAlert) window.showAlert('Could not read this image\'s resolution.', 'warn');
                return;
            }
            markResult(img, size);
            applyBadgesToList();
            result = window._bucketResults.get(img);
        }
        if (!result) return;
        buildFixModal();

        initFixState(img, result, preset);

        const metaNote = document.getElementById('bucket-meta-note');
        if (metaNote) {
            const isPngFile = imageExt(img) === 'png';
            metaNote.className = isPngFile ? '' : 'warn';
            metaNote.textContent = isPngFile
                ? 'PNG text metadata (prompt / generation parameters) is copied to the new file.'
                : '⚠️ JPEG/WebP metadata (EXIF, prompt) is not kept in the cropped file — the original with its metadata stays in 📦 Archive.';
        }

        const previewImgEl = document.getElementById('bucket-preview-img');
        const paintPreview = () => requestAnimationFrame(() => requestAnimationFrame(() => {
            if (_fixState) renderCropOverlay();
        }));
        previewImgEl.onload = paintPreview;
        previewImgEl.draggable = false;
        previewImgEl.src = img.url;

        const modelSel = document.getElementById('bucket-model-select');
        modelSel.value = bucketModel;
        modelSel.onchange = () => {
            setBucketModel(modelSel.value);
            const r = window._bucketResults.get(img);
            if (!r || !_fixState) return;
            initFixState(img, r);
            renderCandidateChips();
            renderCropOverlay();
        };

        renderCandidateChips();
        setupCropDrag();

        window.openModal('modal-fix-bucket');
        document.getElementById('btn-confirm-fix-bucket').onclick = () => window.applyFixBucket();
        paintPreview();
        if (previewImgEl.complete && previewImgEl.naturalWidth) paintPreview();
    };

    /* ---------- LANCZOS-3 (separável, alpha pré-multiplicado) ---------- */
    const LANCZOS_A = 3;
    function lanczosKernel(x) {
        x = Math.abs(x);
        if (x < 1e-8) return 1;
        if (x >= LANCZOS_A) return 0;
        const piX = Math.PI * x;
        return (Math.sin(piX) / piX) * (Math.sin(piX / LANCZOS_A) / (piX / LANCZOS_A));
    }
    function buildLanczosWeights(srcSize, dstSize) {
        const scale = dstSize / srcSize;
        const filterScale = scale < 1 ? scale : 1;
        const support = LANCZOS_A / filterScale;
        const weights = new Array(dstSize);
        for (let i = 0; i < dstSize; i++) {
            const srcCenter = (i + 0.5) / scale - 0.5;
            let i0 = Math.floor(srcCenter - support) + 1;
            let i1 = Math.floor(srcCenter + support);
            if (i0 < 0) i0 = 0;
            if (i1 > srcSize - 1) i1 = srcSize - 1;
            const taps = [];
            let sum = 0;
            for (let j = i0; j <= i1; j++) {
                const wgt = lanczosKernel((j - srcCenter) * filterScale);
                if (wgt === 0) continue;
                taps.push(j, wgt);
                sum += wgt;
            }
            if (sum !== 0) {
                for (let k = 1; k < taps.length; k += 2) taps[k] /= sum;
            }
            weights[i] = taps;
        }
        return weights;
    }
    async function lanczosResizeRGBA(src, srcW, srcH, dstW, dstH) {
        const xWeights = buildLanczosWeights(srcW, dstW);
        const yWeights = buildLanczosWeights(srcH, dstH);
        const mid = new Float32Array(dstW * srcH * 4);
        for (let y = 0; y < srcH; y++) {
            if ((y & 31) === 0) await new Promise(r => setTimeout(r, 0));
            const srcRow = y * srcW;
            const dstRow = y * dstW;
            for (let x = 0; x < dstW; x++) {
                const taps = xWeights[x];
                let r = 0, g = 0, b = 0, a = 0;
                for (let k = 0; k < taps.length; k += 2) {
                    const idx = (srcRow + taps[k]) * 4;
                    const wgt = taps[k + 1];
                    const alpha = src[idx + 3] / 255;
                    r += src[idx] * alpha * wgt;
                    g += src[idx + 1] * alpha * wgt;
                    b += src[idx + 2] * alpha * wgt;
                    a += alpha * wgt;
                }
                const o = (dstRow + x) * 4;
                mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = a;
            }
        }
        const out = new Uint8ClampedArray(dstW * dstH * 4);
        for (let y = 0; y < dstH; y++) {
            if ((y & 31) === 0) await new Promise(r => setTimeout(r, 0));
            const taps = yWeights[y];
            for (let x = 0; x < dstW; x++) {
                let r = 0, g = 0, b = 0, a = 0;
                for (let k = 0; k < taps.length; k += 2) {
                    const idx = (taps[k] * dstW + x) * 4;
                    const wgt = taps[k + 1];
                    r += mid[idx] * wgt;
                    g += mid[idx + 1] * wgt;
                    b += mid[idx + 2] * wgt;
                    a += mid[idx + 3] * wgt;
                }
                const o = (y * dstW + x) * 4;
                if (a > 1e-4) {
                    out[o] = r / a;
                    out[o + 1] = g / a;
                    out[o + 2] = b / a;
                }
                out[o + 3] = a * 255;
            }
        }
        return out;
    }

    /* ---------- APLICA O CROP, ARQUIVA O ORIGINAL, SALVA O NOVO ---------- */
    window.applyFixBucket = async function () {
        if (!_fixState) return;
        const { img, candidate } = _fixState;
        const zoomUsed = (_fixState.zoom || 1) > 1.0001;
        if (candidate.bw === _fixState.w && candidate.bh === _fixState.h && !zoomUsed) {
            if (window.showAlert) window.showAlert('Nothing to change — pick another resolution or zoom in.', 'info');
            return;
        }
        const btn = document.getElementById('btn-confirm-fix-bucket');
        btn.disabled = true; btn.textContent = '⏳ Processing...';

        try {
            // Bytes do original ANTES de arquivar (usados para copiar os metadados do PNG).
            let originalBlob = null;
            try { originalBlob = await (await fetch(img.url)).blob(); } catch (e) {}

            const sourceImgEl = document.getElementById('bucket-preview-img');
            const cw = Math.max(1, Math.round(_fixState.cropW));
            const ch = Math.max(1, Math.round(_fixState.cropH));
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = cw;
            cropCanvas.height = ch;
            const cctx = cropCanvas.getContext('2d', { willReadFrequently: true });
            cctx.imageSmoothingEnabled = true;
            cctx.imageSmoothingQuality = 'high';
            cctx.drawImage(sourceImgEl, _fixState.offsetX, _fixState.offsetY, _fixState.cropW, _fixState.cropH, 0, 0, cw, ch);

            let outCanvas = cropCanvas;
            const resizing = cw !== candidate.bw || ch !== candidate.bh;
            const upscaled = candidate.bw > cw || candidate.bh > ch;
            if (resizing) {
                btn.textContent = upscaled ? '⏳ Lanczos upscale...' : '⏳ Lanczos resize...';
                const srcData = cctx.getImageData(0, 0, cw, ch);
                const resized = await lanczosResizeRGBA(srcData.data, cw, ch, candidate.bw, candidate.bh);
                outCanvas = document.createElement('canvas');
                outCanvas.width = candidate.bw;
                outCanvas.height = candidate.bh;
                outCanvas.getContext('2d').putImageData(new ImageData(resized, candidate.bw, candidate.bh), 0, 0);
            }

            const extLower = imageExt(img);
            const mime = extLower === 'png' ? 'image/png' : extLower === 'webp' ? 'image/webp' : 'image/jpeg';
            let blob = await new Promise(res => outCanvas.toBlob(res, mime, 0.95));
            if (!blob) throw new Error('Failed to generate the cropped image.');

            let copiedMeta = 0;
            if (mime === 'image/png' && originalBlob) {
                const r = await copyPngTextChunks(originalBlob, blob);
                blob = r.blob;
                copiedMeta = r.copied;
            }

            // Backup automático: imagem + legenda originais vão pro 📦 Archive.
            if (typeof window.moveToArchive !== 'function') throw new Error('Archive module not loaded.');
            const archived = await window.moveToArchive(img);
            if (!archived) throw new Error('Could not archive the original image — aborting to avoid data loss.');

            // Grava o arquivo cortado com o MESMO nome (ficou livre com o archive).
            const fileHandle = await img.parentDirHandle.getFileHandle(img.name, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            // A legenda também foi arquivada — regrava do conteúdo em memória.
            if (img.hasFile && typeof window.saveImageToDisk === 'function') await window.saveImageToDisk(img);

            try { URL.revokeObjectURL(img.url); } catch (e) {}
            img.url = URL.createObjectURL(blob);
            img._resolution = { w: candidate.bw, h: candidate.bh };

            markResult(img, { w: candidate.bw, h: candidate.bh });

            if (typeof window.renderImageList === 'function') window.renderImageList();
            if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();

            window.closeModal('modal-fix-bucket');
            const metaMsg = copiedMeta > 0 ? ` PNG metadata kept (${copiedMeta} chunk(s)).` : '';
            const zoomMsg = zoomUsed ? ` (zoom ${Math.round(_fixState.zoom * 100)}%)` : '';
            if (window.showAlert) window.showAlert(`Saved at ${formatRes(candidate.bw, candidate.bh)}${zoomMsg}${upscaled ? ' with Lanczos upscale' : resizing ? ' with Lanczos resize' : ''}. Original safely kept in 📦 Archive.${metaMsg}`, 'success');
        } catch (e) {
            console.error('[Bucket Fix] failed:', e);
            if (window.showAlert) window.showAlert('Error applying the bucket fix: ' + (e.message || e), 'error');
        } finally {
            btn.disabled = false; btn.textContent = '✅ Apply Crop & Save';
            if (_fixState && document.getElementById('modal-fix-bucket').classList.contains('active')) renderCropOverlay();
        }
    };

    /* ---------- HOOKS ---------- */
    function installHooks() {
        if (typeof window.registerPostRenderImageList === 'function') {
            window.TM.on('dataset:loaded', resetForNewDataset);
            window.registerPostRenderImageList(applyBadgesToList);
        }
        if (typeof window.registerPostRenderEditor === 'function') {
            window.registerPostRenderEditor(updateFixBucketButtonVisibility);
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            injectListCounterButton();
            injectScanButton();
            injectFixBucketButton();
            installHooks();
            loadBucketModel();
        }, 0);
    });

})();
