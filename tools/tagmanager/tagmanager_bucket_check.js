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

   AUTO BUCKET: quando há imagens fora do bucket, o ícone 🪣 ao lado do filtro
   fica VERMELHO. Clicar nele abre uma confirmação e, ao aceitar, corrige TODAS
   as imagens ruins de uma vez no bucket recomendado de cada uma (aspect ratio
   mais próximo, corte centralizado, Lanczos-3). Cada original vai pro 📦 Archive.
   (2026-11) 🪣 com imagens ruins abre a escolha: 🤖 Auto bucket all (usa o
   seg body — segm_person_yolo8m do servidor local — para posicionar o corte
   no corpo e escolher o bucket que mantém mais imagem sem cortar a pessoa;
   sem servidor/pessoa = corte centralizado) ou ✋ Manual bucket all (abre uma
   imagem por vez; aplicar abre a próxima sozinho; cancelar cancela tudo).
   No popout: "↻ Repeat last" (mesmo bucket / zoom / posição do último corte),
   zoom digitável + passo incremental (−/+ e roda do mouse usam o passo).
   Clicar no selo vermelho de resolução da lista oferece o 🤖 Auto só para essa
   imagem (mesmo modo automático com seg body); o manual fica no 🪣 do Active Image.
   COLAPSO: no popout, os blocos ▯ Vertical / ▭ Horizontal podem ser recolhidos
   (clique no título do bloco, ou no botão da aba ativa). Estado salvo.
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
    /* Lista básica (padrão): só estas resoluções SDXL aparecem nas sugestões / chips. As demais das 41
       (inclui 640×1536 e 1536×640) ficam atrás do checkbox "Unlock expanded resolutions". */
    const CORE_SDXL = new Set(['1024x1024', '768x1344', '832x1216', '896x1152', '1152x896', '1216x832', '1344x768']);
    const UNLOCK_SETTING = 'bucket-unlock-expanded';
    let unlockExpanded = false;
    const MODEL_SETTING = 'bucket-model';
    const COLLAPSE_SETTING = 'bucket-collapsed';
    const SCAN_BTN_TITLE = 'Scan dataset for images outside the training bucket resolutions (model: SD / SDXL / HD, chosen in the Bucket popout)';
    let collapsedBlocks = { vertical: false, horizontal: false };
    // Auto bucket runs as a ⏳ background task per dataset: the set holds the results map of each dataset with one running.
    const _autoRunningRefs = new Set();
    const autoRunningHere = () => _autoRunningRefs.has(window._bucketResults);

    // all = true: as 41 resoluções do modelo (detecção de "fora do bucket"); false: só a lista básica (sugestões).
    function buildBuckets(model, all) {
        const src = all ? SDXL_BUCKETS : SDXL_BUCKETS.filter(([w, h]) => unlockExpanded || CORE_SDXL.has(w + 'x' + h));
        if (model === 'hd') return src.map(([w, h]) => [w * 1.5, h * 1.5]);
        if (model === 'sd') {
            const list = src.map(([w, h]) => [w / 2, h / 2]);
            [[512, 768], [768, 512]].forEach(([w, h]) => { if (!list.some(b => b[0] === w && b[1] === h)) list.push([w, h]); });
            return list;
        }
        return src.slice();
    }

    let bucketModel = 'sdxl';
    let BUCKETS = buildBuckets(bucketModel, false);
    let BUCKET_KEYS = new Set(BUCKETS.map(([w, h]) => w + 'x' + h));
    const modelLabel = () => BUCKET_MODELS[bucketModel].label;

    /* Troca o modelo: refaz tabela + detecção do dataset inteiro (sem reler arquivos). */
    function setBucketModel(model, save = true) {
        if (!BUCKET_MODELS[model]) model = 'sdxl';
        bucketModel = model;
        BUCKETS = buildBuckets(model, false);
        BUCKET_KEYS = new Set(BUCKETS.map(([w, h]) => w + 'x' + h));
        window._bucketResults.forEach((r) => { r.bad = !BUCKET_KEYS.has(r.w + 'x' + r.h); });
        if (save && typeof window.saveSetting === 'function') window.saveSetting(MODEL_SETTING, model);
        applyBadgesToList();
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) updateFixBucketButtonVisibility();
    }
    window.setBucketModel = setBucketModel;

    // Checkbox "Unlock expanded resolutions": desligado, só a lista básica vale — é a única sugerida e
    // qualquer outra resolução (ex. 640×1536) conta como errada na detecção do dataset.
    function setUnlockExpanded(on, save = true) {
        unlockExpanded = !!on;
        setBucketModel(bucketModel, false);
        if (save && typeof window.saveSetting === 'function') window.saveSetting(UNLOCK_SETTING, unlockExpanded ? '1' : '0');
    }

    async function loadBucketModel() {
        try {
            if (typeof window.getSetting !== 'function') return;
            setUnlockExpanded(String(await window.getSetting(UNLOCK_SETTING, '0')) === '1', false);
            const saved = await window.getSetting(MODEL_SETTING, 'sdxl');
            if (saved && saved !== bucketModel) setBucketModel(saved, false);
            setUseSegm(String(await window.getSetting(SEGM_SETTING, '1')) !== '0', false);
            const st = parseFloat(await window.getSetting(ZOOM_STEP_SETTING, 5));
            if (isFinite(st) && st > 0) zoomStep = Math.max(0.5, Math.min(100, st));
            const lc = await window.getSetting(LAST_SETTING, null);
            if (lc && typeof lc === 'object' && lc.bw && lc.bh) lastCrop = lc;
            const col = String(await window.getSetting(COLLAPSE_SETTING, '') || '').split(',');
            collapsedBlocks = { vertical: col.includes('vertical'), horizontal: col.includes('horizontal') };
        } catch (e) { /* SDXL */ }
    }

    function toggleBlock(key, force) {
        collapsedBlocks[key] = typeof force === 'boolean' ? force : !collapsedBlocks[key];
        if (typeof window.saveSetting === 'function') {
            window.saveSetting(COLLAPSE_SETTING, Object.keys(collapsedBlocks).filter(k => collapsedBlocks[k]).join(','));
        }
        if (_fixState) renderCandidateChips();
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

        #btn-bucket-issues { display:none; flex-shrink:0; background:#330000; border:1px solid #ff4444; color:#ffaaaa; padding:6px 10px; font-size:13px; border-radius:4px; cursor:pointer; font-weight:bold; white-space:nowrap; }
        #btn-bucket-issues:hover { background:#550000; color:#fff; }
        #btn-scan-buckets { flex-shrink:0; padding:6px 10px; font-size:14px; background:transparent; border:1px solid #444; color:#aaa; }
        #btn-scan-buckets:hover { color:#00ff99; border-color:#00ff99; }
        #btn-scan-buckets.has-bad { background:#330000; border-color:#ff4444; color:#ff5555; box-shadow:0 0 6px rgba(255,68,68,0.45); }
        #btn-scan-buckets.has-bad:hover { background:#4a0000; border-color:#ff7777; color:#fff; }
        #btn-scan-buckets:disabled { opacity:0.8; cursor:wait; }
        #modal-auto-bucket .tool-modal { width: 440px; max-width: 92vw; }
        #modal-auto-bucket .ab-line { font-size:12px; color:#ccc; margin:6px 0; line-height:1.5; }
        #modal-auto-bucket .ab-note { font-size:11px; color:#888; margin-top:8px; }
        #modal-auto-bucket .ab-warn { font-size:11px; color:#ffcc66; margin-top:6px; }
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
        .bucket-block-label.collapsible { display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }
        .bucket-block-label.collapsible:hover { color:#bbb; }
        .bucket-block-label .bb-caret { display:inline-block; width:10px; transition:transform .15s; }
        .bucket-block-label.collapsed .bb-caret { transform:rotate(-90deg); }
        .bucket-block-label .bb-count { font-weight:normal; color:#666; }
        .bucket-collapsed-note { flex:0 0 100%; font-size:11px; color:#666; font-style:italic; }
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
        /* .list-item-info has pointer-events:none in the page CSS: the badge / wrong resolution must take clicks */
        .bucket-bad-badge, .list-item.bad-bucket .list-item-resolution { cursor:pointer; pointer-events:auto; }
        .bucket-bad-badge:hover { background:#550000; color:#fff; }
        .bucket-candidate-chip.is-repeat { border-color:#2a5a8c; color:#8fd0ff; }
        .bucket-candidate-chip.is-repeat:hover { border-color:#4db8ff; }
        .bucket-zoom-row input[type=number] { width:58px; font-size:11px; padding:2px 4px; }
        .bucket-zoom-row .bz-step-btn { background:#151515; border:1px solid #555; color:#ddd; border-radius:4px; padding:1px 8px; cursor:pointer; font-size:13px; line-height:1.3; }
        .bucket-zoom-row .bz-step-btn:hover { border-color:#00ff99; color:#00ff99; }
        .bucket-segm-row { display:flex; align-items:center; gap:6px; font-size:12px; color:#ccc; cursor:pointer; user-select:none; }
        .bucket-segm-row input { width:auto; margin:0; accent-color:#00ff99; }
        #bucket-manual-progress { display:none; font-size:11px; font-weight:bold; color:#ffd27a; background:#2a2208; border:1px solid #6a5a2a; border-radius:6px; padding:4px 8px; margin-bottom:6px; }
        #modal-auto-bucket .ab-choice { display:flex; flex-direction:column; gap:8px; margin-top:10px; }
        #modal-auto-bucket .ab-choice button { text-align:left; padding:9px 12px; border-radius:6px; cursor:pointer; font-size:12px; }
        #modal-auto-bucket .ab-choice button b { font-size:13px; }
        #modal-auto-bucket .ab-choice small { display:block; color:#aaa; font-weight:normal; margin-top:3px; }
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
                    badge.title = `Resolution is not an ${modelLabel()} training bucket — click to open the 🪣 Bucket options for this image.`;
                    badge.onclick = (e) => { e.stopPropagation(); openBucketForImage(img); };
                }
                if (resEl) { resEl.onclick = (e) => { e.stopPropagation(); openBucketForImage(img); }; resEl.title = 'Wrong resolution — click to open the 🪣 Bucket options'; }
            } else {
                if (badge) badge.remove();
                if (resEl && resEl.onclick) { resEl.onclick = null; resEl.title = ''; }
            }
        });
        updateBucketCounter();
    }

    // Click on the red resolution badge: select the image and open its Bucket popout.
    // Click on the red badge / wrong resolution: offers 🤖 Auto for this image only (manual = 🪣 Fix Bucket in Active Image).
    function openBucketForImage(img) {
        if (typeof imageFiles === 'undefined') return;
        const idx = imageFiles.indexOf(img);
        if (idx < 0) return;
        if (typeof selectedIndices !== 'undefined') { selectedIndices.clear(); selectedIndices.add(idx); }
        if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
        if (typeof window.renderEditor === 'function') window.renderEditor();
        const r = window._bucketResults.get(img);
        if (!r || !r.bad || autoRunningHere() || _manual) { window.openFixBucketModal(img); return; }
        buildAutoModal();
        const cand = suggestBuckets(r.w, r.h, 1)[0];
        const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        document.querySelector('#modal-auto-bucket h3 span').textContent = '🪣 Bucket this image';
        document.getElementById('ab-summary').innerHTML = `<b>${esc(img.name)}</b> is ${formatRes(r.w, r.h)} — not an <b>${modelLabel()}</b> bucket. Fix it automatically? (For a manual crop use <b>🪣 Fix Bucket</b> in Active Image.)`;
        const upEl = document.getElementById('ab-upscale');
        if (cand && (cand.bw > r.w || cand.bh > r.h)) { upEl.style.display = 'block'; upEl.textContent = '⚠️ This image is smaller than its recommended bucket and will be upscaled (auto mode).'; }
        document.getElementById('btn-ab-manual').style.display = 'none';
        document.getElementById('btn-ab-run').innerHTML = '<b id="ab-run-label">🤖 Auto (this image)</b><small>Goes to the bucket that keeps the most of the image. With <i>Use segm body</i> on, the crop is placed on the body (local server); off, or without a person, the crop is centered. Lanczos-3 resize.</small>';
        document.getElementById('btn-ab-run').onclick = () => { window.closeModal('modal-auto-bucket'); window.autoBucketAll([img]); };
        const rescan = document.getElementById('btn-ab-rescan');
        if (rescan) rescan.style.display = 'none';
        window.openModal('modal-auto-bucket');
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
        const scanBtn = document.getElementById('btn-scan-buckets');
        if (scanBtn && !autoRunningHere()) {
            const has = badIndices.length > 0;
            scanBtn.classList.toggle('has-bad', has);
            scanBtn.title = has
                ? `${badIndices.length} image(s) outside the ${modelLabel()} buckets — click to auto-fix ALL of them to their recommended bucket`
                : SCAN_BTN_TITLE;
        }
        if (badIndices.length > 0) {
            btn.style.display = 'inline-block';
            btn.textContent = `🪣 ${badIndices.length}`;
            btn.title = `${badIndices.length} image(s) outside the ${modelLabel()} buckets — click to jump to the next one`;
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
        // locate -> load the block of that image completely -> move the preview to it
        if (typeof window.tmSelectAndJump === 'function') { window.tmSelectAndJump(nextIdx); return; }
        if (typeof selectedIndices !== 'undefined') { selectedIndices.clear(); selectedIndices.add(nextIdx); }
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

        if (btn && !autoRunningHere()) { btn.disabled = false; btn.textContent = '🪣'; }
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
    // 🪣 N: counter + "jump to the next image with a bad bucket" — sits right after the 🪣 scan button
    // (filter row), not in the Dataset header any more.
    function injectListCounterButton() {
        const scanBtn = document.getElementById('btn-scan-buckets');
        if (!scanBtn || document.getElementById('btn-bucket-issues')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-bucket-issues';
        btn.title = 'Images with a resolution outside the training buckets of the selected model (SD / SDXL / HD) — click to jump to one';
        btn.onclick = () => window.selectBucketIssueImage();
        scanBtn.insertAdjacentElement('afterend', btn);
        updateBucketCounter();
        // Other plugins add their buttons right after the scan 🪣 later on and would push the counter away from it:
        // keep it glued to the scan button whenever the row changes.
        if (scanBtn.parentElement && typeof MutationObserver === 'function') {
            new MutationObserver(() => {
                const sb = document.getElementById('btn-scan-buckets'), cb = document.getElementById('btn-bucket-issues');
                if (sb && cb && sb.nextElementSibling !== cb) sb.insertAdjacentElement('afterend', cb);
            }).observe(scanBtn.parentElement, { childList: true });
        }
    }

    function injectScanButton() {
        const anchor = document.getElementById('btn-psd-import') || document.getElementById('btn-sort-az');
        if (!anchor || document.getElementById('btn-scan-buckets')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-scan-buckets';
        btn.textContent = '🪣';
        btn.title = SCAN_BTN_TITLE;
        btn.onclick = () => {
            if (autoRunningHere() || _manual) return;
            if ((window._bucketIssueIndices || []).length > 0) window.openAutoBucketModal();
            else window.scanDatasetBuckets(false);
        };
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
        expanded: () => unlockExpanded,
        label: () => modelLabel(),
        isBucket: (w, h) => BUCKET_KEYS.has(w + 'x' + h),
        suggest: (w, h, limit) => suggestBuckets(w, h, limit),
        renderCrop: (sourceEl, candidate, crop, mime, onStatus) => renderCropBlob(sourceEl, candidate, crop, mime, onStatus)
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
        if (existing && document.getElementById('bucket-crop-shade') && document.getElementById('bucket-meta-note') && document.getElementById('bucket-zoom-step') && document.getElementById('bucket-model-select') && document.getElementById('bucket-unlock-expanded') && document.getElementById('bucket-archive-note') && existing.querySelector('.bucket-use-segm-cb')) return;
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
                    <label style="display:flex; align-items:center; gap:5px; margin-left:12px; font-size:12px; color:#ccc; cursor:pointer;" title="Off: only the basic resolutions (1024×1024, 768×1344, 832×1216, 896×1152 and their landscape pairs). On: all the official buckets, including 640×1536 / 1536×640 and the other extreme ratios.">
                        <input type="checkbox" id="bucket-unlock-expanded"> Unlock expanded resolutions
                    </label>
                </div>
                <div style="margin-top:4px;">${segmCheckboxHtml()}<div style="font-size:10px; color:#777; margin-left:22px;">Applies to the automatic modes (🤖 Auto bucket all / Auto this image).</div></div>
                <div id="bucket-manual-progress"></div>
                <div id="bucket-fix-info" style="font-size:12px; color:#aaa; margin-bottom:6px;"></div>
                <div class="bucket-orient-bar" id="bucket-orient-bar"></div>
                <div class="bucket-candidate-list" id="bucket-candidate-list"></div>
                <div id="bucket-preview-wrap">
                    <img id="bucket-preview-img" alt="" draggable="false">
                    <div id="bucket-crop-shade"></div>
                    <div id="bucket-crop-rect"></div>
                </div>
                <div class="bucket-zoom-row" title="Zoom in to crop tighter — the crop is resized to the chosen resolution. Mouse wheel on the preview also zooms (by the step).">
                    <span style="color:#9ecfff; font-weight:bold;">🔎 Zoom</span>
                    <button class="bz-step-btn" id="bucket-zoom-minus" title="Zoom out by the step">−</button>
                    <input type="range" id="bucket-zoom" min="100" max="800" step="1" value="100">
                    <button class="bz-step-btn" id="bucket-zoom-plus" title="Zoom in by the step">+</button>
                    <input type="number" id="bucket-zoom-num" min="100" max="800" step="1" value="100" title="Exact zoom % — type any value from 100 to 800">
                    <span style="color:#888;">%</span>
                    <label style="display:flex; align-items:center; gap:4px; color:#aaa; font-size:11px;" title="Incremental step: how much each −/+ click or wheel notch changes the zoom">Step
                        <input type="number" id="bucket-zoom-step" min="0.5" max="100" step="0.5" value="5"> %</label>
                    <button id="bucket-zoom-reset" title="Back to 100% (no zoom)">↺</button>
                </div>
                <div id="bucket-upscale-warning" class="bucket-warn-upscale">⚠️ This bucket is larger than the crop. Saving will upscale with Lanczos-3, which stays sharper than the browser's default resize.</div>
                <div id="bucket-drag-hint" style="font-size:11px; color:#aaa; margin-top:8px;"></div>
                <div id="bucket-archive-note" style="font-size:11px; color:#666; margin-top:4px;">The original file will be moved to 📦 Archive before saving (fully recoverable from there).</div>
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

    const ZOOM_MIN = 1, ZOOM_MAX = 8;
    const ZOOM_STEP_SETTING = 'bucket-zoom-step';
    const LAST_SETTING = 'bucket-last-crop';
    let zoomStep = 5;            // % per click / wheel notch (user choice)
    let lastCrop = null;         // { bw, bh, zoom, cx, cy } cx/cy = crop center as a fraction of the image
    let _fixApplied = false;     // set when the popout saved (used by Manual bucket all)
    // "Use segm body": on = every AUTO bucket (Auto bucket all / Auto this image) uses segm_person_yolo8m to place
    // the crop on the body; off = plain crop on the bucket that preserves the most image (centered).
    const SEGM_SETTING = 'bucket-use-segm';
    let useSegm = true;
    function setUseSegm(on, save) {
        useSegm = !!on;
        document.querySelectorAll('.bucket-use-segm-cb').forEach(cb => { cb.checked = useSegm; });
        if (save !== false && typeof window.saveSetting === 'function') window.saveSetting(SEGM_SETTING, useSegm ? '1' : '0');
    }
    function segmCheckboxHtml() {
        return `<label class="bucket-segm-row" title="On: every Auto bucket (all images or one image) uses segm_person_yolo8m (local server) to place the crop on the body and pick a resolution that fits the person better. Off: the crop goes to the bucket that preserves the most image, centered.">
            <input type="checkbox" class="bucket-use-segm-cb"${useSegm ? ' checked' : ''}> Use segm body — to try fit better resolution</label>`;
    }
    function bindSegmCheckboxes(root) {
        (root || document).querySelectorAll('.bucket-use-segm-cb').forEach(cb => {
            cb.checked = useSegm;
            cb.onchange = () => setUseSegm(cb.checked);
        });
    }

    function orientOf(w, h) { return w === h ? 'square' : (h > w ? 'vertical' : 'horizontal'); }

    /* Imagem "virtual" (PSD Import → recorte manual): ainda não existe no dataset.
       { virtual:true, url, w, h, onSave(blob, candidate, crop), confirmLabel }.
       Salvar chama onSave em vez de arquivar/sobrescrever — nada é alterado. */
    function virtualResult(img) { return { w: img.w, h: img.h, bad: !BUCKET_KEYS.has(img.w + 'x' + img.h) }; }
    const isVirtual = (img) => !!(img && img.virtual);

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
                b.onclick = () => {
                    if (st.tab === key) { toggleBlock(key); return; }   // aba ativa: recolhe / expande
                    st.tab = key;
                    collapsedBlocks[key] = false;
                    renderCandidateChips();
                };
                b.title = st.tab === key ? `Click to ${collapsedBlocks[key] ? 'expand' : 'collapse'} the ${key} list` : `List only the ${key} resolutions`;
                if (st.tab === key) b.innerHTML = `<span class="bb-caret">${collapsedBlocks[key] ? '▸' : '▾'}</span> ${label}<span class="bo-count">${arr.length}</span>`;
                bar.appendChild(b);
            });
        }
        if (st.keepCand) {
            bar.appendChild(Object.assign(document.createElement('div'), { className: 'bucket-orient-sep' }));
            bar.appendChild(makeChip(st.keepCand, closest, true));
        }
        // ↻ Repeat last one: same resolution, zoom and position as the last crop
        if (lastCrop) {
            const rep = document.createElement('div');
            const ok = !!findRepeatCandidate();
            rep.className = 'bucket-candidate-chip is-repeat';
            rep.innerHTML = `↻ Repeat last<span class="bc-kept">${formatRes(lastCrop.bw, lastCrop.bh)} · ${Math.round(lastCrop.zoom * 100)}%</span>`;
            rep.title = ok ? 'Use the same resolution, zoom and position as the last crop' : `${lastCrop.bw}×${lastCrop.bh} is not available for this image / model`;
            if (!ok) rep.style.opacity = '0.45';
            rep.onclick = () => { if (ok) applyRepeatLast(); };
            if (!st.keepCand) bar.appendChild(Object.assign(document.createElement('div'), { className: 'bucket-orient-sep' }));
            bar.appendChild(rep);
        }

        const block = (key, label, arr) => {
            if (!arr.length) return;
            const collapsed = !!collapsedBlocks[key];
            const head = document.createElement('div');
            head.className = 'bucket-block-label collapsible' + (collapsed ? ' collapsed' : '');
            head.innerHTML = `<span class="bb-caret">▾</span><span>${label}</span><span class="bb-count">${arr.length}</span>`;
            head.title = collapsed ? 'Click to expand' : 'Click to collapse';
            head.onclick = () => toggleBlock(key);
            list.appendChild(head);
            if (!collapsed) arr.forEach(c => list.appendChild(makeChip(c, closest)));
        };
        if (st.fixMode) {
            // Fix Bucket: os dois blocos visíveis (recolhíveis); a orientação da imagem primeiro.
            const vFirst = orientOf(st.w, st.h) !== 'horizontal';
            if (vFirst) { block('vertical', '▯ Vertical', vertical); block('horizontal', '▭ Horizontal', horizontal); }
            else { block('horizontal', '▭ Horizontal', horizontal); block('vertical', '▯ Vertical', vertical); }
        } else {
            const key = st.tab === 'horizontal' ? 'horizontal' : 'vertical';
            if (collapsedBlocks[key]) {
                const note = document.createElement('div');
                note.className = 'bucket-collapsed-note';
                note.textContent = `${key === 'vertical' ? '▯ Vertical' : '▭ Horizontal'} list collapsed — click its button to expand.`;
                list.appendChild(note);
            } else {
                (key === 'horizontal' ? horizontal : vertical).forEach(c => list.appendChild(makeChip(c, closest)));
            }
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
        syncZoomUI(z);
        renderCropOverlay();
    }
    function syncZoomUI(z) {
        const pct = Math.round(z * 1000) / 10;
        const slider = document.getElementById('bucket-zoom');
        if (slider && document.activeElement !== slider) slider.value = Math.round(pct);
        const num = document.getElementById('bucket-zoom-num');
        if (num && document.activeElement !== num) num.value = pct;
    }
    // Step the zoom by the user's increment (in zoom percentage points).
    function stepZoom(dir) {
        if (!_fixState) return;
        const pct = (_fixState.zoom || 1) * 100 + dir * zoomStep;
        setZoom(pct / 100);
    }

    /* ---------- ↻ REPEAT LAST ONE ---------- */
    function findRepeatCandidate() {
        const st = _fixState;
        if (!st || !lastCrop) return null;
        if (st.keepCand && st.keepCand.bw === lastCrop.bw && st.keepCand.bh === lastCrop.bh) return st.keepCand;
        return st.candidates.find(c => c.bw === lastCrop.bw && c.bh === lastCrop.bh) || null;
    }
    function applyRepeatLast() {
        const st = _fixState;
        const cand = findRepeatCandidate();
        if (!st || !cand) return;
        st.candidate = cand;
        const o = orientOf(cand.bw, cand.bh);
        if (!st.fixMode && (o === 'vertical' || o === 'horizontal') && !cand.keep) st.tab = o;
        st.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, lastCrop.zoom || 1));
        syncZoomUI(st.zoom);
        st.offsetX = null; st.offsetY = null;
        renderCandidateChips();
        renderCropOverlay();                    // computes cropW / cropH for this image
        if (st.cropW) {
            st.offsetX = lastCrop.cx * st.w - st.cropW / 2;
            st.offsetY = lastCrop.cy * st.h - st.cropH / 2;
            renderCropOverlay();               // clamps inside the image
        }
    }
    function rememberLastCrop() {
        const st = _fixState;
        if (!st || !st.candidate || !st.cropW) return;
        lastCrop = {
            bw: st.candidate.bw, bh: st.candidate.bh, zoom: st.zoom || 1,
            cx: (st.offsetX + st.cropW / 2) / st.w, cy: (st.offsetY + st.cropH / 2) / st.h
        };
        if (typeof window.saveSetting === 'function') window.saveSetting(LAST_SETTING, lastCrop);
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
        const noop = !isVirtual(_fixState.img) && c.bw === w && c.bh === h && zoom <= 1.0001;
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
                stepZoom(e.deltaY < 0 ? 1 : -1);
            }, { passive: false });
        }
        const zs = document.getElementById('bucket-zoom');
        if (zs && !zs._bound) {
            zs._bound = true;
            zs.oninput = () => setZoom(parseInt(zs.value, 10) / 100);
            document.getElementById('bucket-zoom-reset').onclick = () => setZoom(1);
            document.getElementById('bucket-zoom-minus').onclick = () => stepZoom(-1);
            document.getElementById('bucket-zoom-plus').onclick = () => stepZoom(1);
            const num = document.getElementById('bucket-zoom-num');
            num.onchange = () => { const v = parseFloat(num.value); if (isFinite(v)) setZoom(v / 100); else syncZoomUI(_fixState ? _fixState.zoom : 1); };
            num.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); num.onchange(); } };
            const stepEl = document.getElementById('bucket-zoom-step');
            stepEl.value = zoomStep;
            stepEl.onchange = () => {
                let v = parseFloat(stepEl.value);
                if (!isFinite(v) || v <= 0) v = 5;
                zoomStep = Math.max(0.5, Math.min(100, v));
                stepEl.value = zoomStep;
                if (typeof window.saveSetting === 'function') window.saveSetting(ZOOM_STEP_SETTING, zoomStep);
            };
        }
        const stepEl2 = document.getElementById('bucket-zoom-step');
        if (stepEl2 && document.activeElement !== stepEl2) stepEl2.value = zoomStep;
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
        syncZoomUI(1);

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
                    syncZoomUI(z);
                }
            }
        }

        document.getElementById('bucket-fix-info').textContent = alreadyValid
            ? `Current resolution: ${formatRes(result.w, result.h)} — already a valid ${modelLabel()} bucket. Pick another size (dashed chip = current), or keep it and just zoom / crop.`
            : `Current resolution: ${formatRes(result.w, result.h)} (not a valid ${modelLabel()} bucket). Choose a target bucket below, or "Keep" to only zoom / crop:`;

    }

    window.openFixBucketModal = async function (img, preset) {
        let result = isVirtual(img) ? virtualResult(img) : window._bucketResults.get(img);
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
        bindSegmCheckboxes(document.getElementById('modal-fix-bucket'));
        _fixApplied = false;
        const progEl = document.getElementById('bucket-manual-progress');
        if (progEl) {
            if (_manual) { progEl.style.display = 'block'; progEl.textContent = `✋ Manual bucket all — image ${_manual.i + 1} of ${_manual.targets.length} · Apply opens the next one · Cancel stops all`; }
            else progEl.style.display = 'none';
        }
        _fixState.confirmLabel = img.confirmLabel || (_manual && _manual.i + 1 < _manual.targets.length ? '✅ Apply & Next' : '✅ Apply Crop & Save');
        const confirmBtn0 = document.getElementById('btn-confirm-fix-bucket');
        if (confirmBtn0) { confirmBtn0.disabled = false; confirmBtn0.textContent = _fixState.confirmLabel; }
        const archNote = document.getElementById('bucket-archive-note');
        if (archNote) archNote.textContent = isVirtual(img)
            ? (img.note || 'A new PNG is added to the dataset — the source is never changed.')
            : 'The original file will be moved to 📦 Archive before saving (fully recoverable from there).';

        const metaNote = document.getElementById('bucket-meta-note');
        if (metaNote && isVirtual(img)) {
            metaNote.className = '';
            metaNote.textContent = '';
        } else if (metaNote) {
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
        const reinit = () => {
            const r = isVirtual(img) ? virtualResult(img) : window._bucketResults.get(img);
            if (!r || !_fixState) return;
            initFixState(img, r);
            renderCandidateChips();
            renderCropOverlay();
        };
        modelSel.onchange = () => { setBucketModel(modelSel.value); reinit(); };
        const unlockEl = document.getElementById('bucket-unlock-expanded');
        unlockEl.checked = unlockExpanded;
        unlockEl.onchange = () => { setUnlockExpanded(unlockEl.checked); reinit(); };

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

    /* ---------- RENDER DO CORTE (compartilhado: popout + Auto Bucket) ---------- */
    // sourceEl: <img> carregada em resolução natural; crop em px da imagem real.
    async function renderCropBlob(sourceEl, candidate, crop, mime, onStatus) {
        const cw = Math.max(1, Math.round(crop.w));
        const ch = Math.max(1, Math.round(crop.h));
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cw;
        cropCanvas.height = ch;
        const cctx = cropCanvas.getContext('2d', { willReadFrequently: true });
        cctx.imageSmoothingEnabled = true;
        cctx.imageSmoothingQuality = 'high';
        cctx.drawImage(sourceEl, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);

        let outCanvas = cropCanvas;
        const resizing = cw !== candidate.bw || ch !== candidate.bh;
        const upscaled = candidate.bw > cw || candidate.bh > ch;
        if (resizing) {
            if (onStatus) onStatus(upscaled ? '⏳ Lanczos upscale...' : '⏳ Lanczos resize...');
            const srcData = cctx.getImageData(0, 0, cw, ch);
            const resized = await lanczosResizeRGBA(srcData.data, cw, ch, candidate.bw, candidate.bh);
            outCanvas = document.createElement('canvas');
            outCanvas.width = candidate.bw;
            outCanvas.height = candidate.bh;
            outCanvas.getContext('2d').putImageData(new ImageData(resized, candidate.bw, candidate.bh), 0, 0);
        }
        const blob = await new Promise(res => outCanvas.toBlob(res, mime, 0.95));
        if (!blob) throw new Error('Failed to generate the cropped image.');
        return { blob, resizing, upscaled };
    }

    /* Arquiva o original (+ legenda) e grava o novo arquivo com o MESMO nome. */
    // resultsMap / root: of the dataset the image belongs to (a ⏳ background task passes the ones it started with)
    async function commitBucketFile(img, blob, candidate, resultsMap, root) {
        if (typeof window.moveToArchive !== 'function') throw new Error('Archive module not loaded.');
        // archive entries of a bucket fix are labeled "bucket" (explicit label: safe with tasks running in parallel)
        const archived = await window.moveToArchive(img, 'bucket', root);
        if (!archived) throw new Error('Could not archive the original image — aborting to avoid data loss.');

        const fileHandle = await img.parentDirHandle.getFileHandle(img.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();

        // A legenda também foi arquivada — regrava do conteúdo em memória.
        if (img.hasFile && typeof window.saveImageToDisk === 'function') await window.saveImageToDisk(img);

        try { URL.revokeObjectURL(img.url); } catch (e) {}
        img.url = URL.createObjectURL(blob);
        img._resolution = { w: candidate.bw, h: candidate.bh };
        if (resultsMap && resultsMap !== window._bucketResults) resultsMap.set(img, { w: candidate.bw, h: candidate.bh, bad: !BUCKET_KEYS.has(candidate.bw + 'x' + candidate.bh) });
        else markResult(img, { w: candidate.bw, h: candidate.bh });
    }

    /* ---------- BUCKET ALL (🪣 with bad images): Auto (seg body) or Manual ---------- */
    let _manual = null;   // { targets, i, ok, resultsRef } while "Manual bucket all" runs

    function buildAutoModal() {
        let overlay = document.getElementById('modal-auto-bucket');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'modal-auto-bucket';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-auto-bucket');
        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🪣 Bucket all</span>
                    <button onclick="window.closeModal('modal-auto-bucket')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div class="ab-line" id="ab-summary"></div>
                <div class="ab-choice">
                    <button id="btn-ab-manual" style="background:#2a2208; color:#ffd27a; border:1px solid #6a5a2a;">
                        <b>✋ Manual bucket all</b>
                        <small>Opens one image at a time in the 🪣 Bucket popout. Applying opens the next image by itself. Cancelling an image cancels the whole run.</small>
                    </button>
                    <button id="btn-ab-run" style="background:#3a0d0d; color:#ffb0b0; border:1px solid #aa2222;">
                        <b id="ab-run-label">🤖 Auto bucket all</b>
                        <small>Each image goes to the bucket that keeps the most image. With <i>Use segm body</i> on, segm_person_yolo8m (local server) places the crop on the body and avoids cutting the person; off, without the server or without a person, the crop is centered. Lanczos-3 resize.</small>
                    </button>
                </div>
                <div style="margin-top:10px;">${segmCheckboxHtml()}</div>
                <div class="ab-note">Every original (and its caption) is moved to 📦 Archive first, so it is fully recoverable. PNG text metadata is kept; JPEG/WebP metadata is not.</div>
                <div class="ab-warn" id="ab-upscale" style="display:none;"></div>
                <div class="modal-buttons">
                    <button class="btn-cancel" onclick="window.closeModal('modal-auto-bucket')">Cancel</button>
                    <button id="btn-ab-rescan" style="background:transparent; border:1px solid #555; color:#aaa; padding:8px 12px; border-radius:6px; cursor:pointer;">🔍 Re-scan only</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        bindSegmCheckboxes(overlay);
        return overlay;
    }

    function badTargets() {
        const resultsRef = window._bucketResults;
        return (window._bucketIssueIndices || []).map(i => imageFiles[i]).filter(img => { const r = resultsRef.get(img); return img && r && r.bad && !img.hidden; });
    }

    window.openAutoBucketModal = function () {
        const targets = badTargets();
        if (targets.length === 0) { window.scanDatasetBuckets(false); return; }
        buildAutoModal();
        let up = 0;
        targets.forEach(img => {
            const r = window._bucketResults.get(img);
            const c = suggestBuckets(r.w, r.h, 1)[0];
            if (c && (c.bw > r.w || c.bh > r.h)) up++;
        });
        document.getElementById('ab-summary').innerHTML = `<b>${targets.length}</b> image(s) are outside the <b>${modelLabel()}</b> buckets. How do you want to fix them?`;
        const upEl = document.getElementById('ab-upscale');
        if (up > 0) { upEl.style.display = 'block'; upEl.textContent = `⚠️ ${up} of them are smaller than their recommended bucket and will be upscaled (auto mode).`; }
        document.getElementById('ab-run-label').textContent = `🤖 Auto bucket all (${targets.length})`;
        document.getElementById('btn-ab-run').onclick = () => { window.closeModal('modal-auto-bucket'); window.autoBucketAll(); };
        document.getElementById('btn-ab-manual').onclick = () => { window.closeModal('modal-auto-bucket'); window.manualBucketAll(); };
        document.getElementById('btn-ab-rescan').onclick = () => { window.closeModal('modal-auto-bucket'); window.scanDatasetBuckets(false); };
        window.openModal('modal-auto-bucket');
    };

    function loadImageEl(url) {
        return new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('Could not load the image.'));
            el.src = url;
        });
    }

    /* ---------- SEG BODY (person boxes from the local server) ---------- */
    let _segAvailable = null;   // null = unknown, false = server / packages missing this run
    async function segBodyBoxes(blob) {
        if (_segAvailable === false || !blob) return null;
        let res;
        try {
            res = await fetch('/api/psd/detect?min_area=3', { method: 'POST', body: blob });
        } catch (e) { _segAvailable = false; return null; }
        let data = null;
        try { data = await res.json(); } catch (e) {}
        if (!res.ok || !data) {
            // missing packages / no server route: stop asking for this run
            if (res.status === 404 || res.status === 500 || res.status === 405) _segAvailable = false;
            if (data && data.error) console.warn('[Auto Bucket] seg body unavailable:', data.error);
            return null;
        }
        _segAvailable = true;
        return Array.isArray(data.people) ? data.people : [];
    }

    // Best bucket + crop for the image keeping the body: candidates by closest aspect ratio
    // (= most image kept); the first one whose full-size crop, placed on the body, contains the
    // body (+ margin) wins. No body -> centered crop on the closest bucket.
    function planBodyCrop(r, people, marginPct) {
        const cands = suggestBuckets(r.w, r.h, 8);
        const fullCrop = (cand) => {
            const baseScale = Math.max(cand.bw / r.w, cand.bh / r.h);
            return { w: Math.min(r.w, cand.bw / baseScale), h: Math.min(r.h, cand.bh / baseScale) };
        };
        if (!people || !people.length) {
            const cand = cands[0], c = fullCrop(cand);
            return { cand, crop: { x: (r.w - c.w) / 2, y: (r.h - c.h) / 2, w: c.w, h: c.h }, body: false };
        }
        // union of the people boxes (group shots keep everyone when possible)
        const area = p => (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]);
        const main = people.slice().sort((a, b) => area(b) - area(a));
        const big = area(main[0]);
        const keep = main.filter(p => area(p) >= big * 0.35);
        let x1 = Math.min(...keep.map(p => p.box[0])), y1 = Math.min(...keep.map(p => p.box[1]));
        let x2 = Math.max(...keep.map(p => p.box[2])), y2 = Math.max(...keep.map(p => p.box[3]));
        const m = marginPct / 100, bw = x2 - x1, bh = y2 - y1;
        x1 = Math.max(0, x1 - bw * m); y1 = Math.max(0, y1 - bh * m);
        x2 = Math.min(r.w, x2 + bw * m); y2 = Math.min(r.h, y2 + bh * m);
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        const place = (cand) => {
            const c = fullCrop(cand);
            const x = Math.max(0, Math.min(r.w - c.w, cx - c.w / 2));
            // vertical: keep the head when the body is taller than the crop
            let y = Math.max(0, Math.min(r.h - c.h, cy - c.h / 2));
            if (y2 - y1 > c.h) y = Math.max(0, Math.min(r.h - c.h, y1));
            return { x, y, w: c.w, h: c.h };
        };
        const fits = (c) => c.x <= x1 + 0.5 && c.y <= y1 + 0.5 && c.x + c.w >= x2 - 0.5 && c.y + c.h >= y2 - 0.5;
        for (const cand of cands) {
            const crop = place(cand);
            if (fits(crop)) return { cand, crop, body: true };
        }
        const cand = cands[0];
        return { cand, crop: place(cand), body: true, cut: true };
    }

    // onlyImgs: run on these images only (e.g. the one whose red badge was clicked); default = every bad image.
    window.autoBucketAll = async function (onlyImgs) {
        const resultsRef = window._bucketResults;
        if (_autoRunningRefs.has(resultsRef) || _manual) return;
        const targets = Array.isArray(onlyImgs)
            ? onlyImgs.filter(img => { const r = img && resultsRef.get(img); return r && r.bad; })
            : badTargets();
        if (targets.length === 0) return;

        // ⏳ background task: the images, their results and the dataset folder are captured now, so the run
        // finishes on THIS dataset even if another one is opened. The seg body (GPU) waits for other GPU tasks.
        const ctx = window.TM.tasks.captureDataset();
        ctx.files = targets;
        const segmOn = useSegm;
        _autoRunningRefs.add(resultsRef);
        const btnHere = () => (window._bucketResults === resultsRef ? document.getElementById('btn-scan-buckets') : null);
        { const b0 = btnHere(); if (b0) b0.disabled = true; }

        return window.TM.tasks.run({ title: targets.length === 1 ? `Auto bucket — ${targets[0].name}` : `Auto bucket all (${targets.length})`, icon: '🪣', gpu: segmOn, ctx, silentEnd: true }, async (task) => {
        let ok = 0, upscaledCount = 0, metaLost = 0, bodyUsed = 0, bodyCut = 0;
        let segAvail = null;
        const failed = [];
        try {
        for (let i = 0; i < targets.length; i++) {
            if (task.cancelled) break;
            const img = targets[i];
            const btn = btnHere();
            if (btn) btn.textContent = `⏳ ${i + 1}/${targets.length}`;
            task.progress(i + 1, targets.length, img.name);
            try {
                const r = resultsRef.get(img);
                let originalBlob = null;
                try { originalBlob = await (await fetch(img.url)).blob(); } catch (e) {}
                _segAvailable = segAvail;
                const people = segmOn ? await segBodyBoxes(originalBlob) : null;
                segAvail = _segAvailable;
                const plan = planBodyCrop(r, people, 5);
                if (plan.body) bodyUsed++;
                if (plan.cut) bodyCut++;
                const cand = plan.cand, crop = plan.crop;

                const el = await loadImageEl(img.url);
                const ext = imageExt(img);
                const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
                const rendered = await renderCropBlob(el, cand, crop, mime, null);
                let blob = rendered.blob;
                if (mime === 'image/png' && originalBlob) blob = (await copyPngTextChunks(originalBlob, blob)).blob;
                else metaLost++;

                await commitBucketFile(img, blob, cand, resultsRef, ctx.root);
                if (rendered.upscaled) upscaledCount++;
                ok++;
            } catch (e) {
                console.error('[Auto Bucket] failed for', img && img.name, e);
                failed.push(img && img.name ? img.name : '?');
            }
            await new Promise(r => setTimeout(r, 0));
        }
        if (segAvail) { try { await fetch('/api/psd/unload', { method: 'POST' }); } catch (e) {} }   // VRAM back
        } finally {
            _autoRunningRefs.delete(resultsRef);
        }

        // Screen refresh only when this dataset is still the one open.
        if (window._bucketResults === resultsRef) {
            const btn = document.getElementById('btn-scan-buckets');
            if (btn) { btn.disabled = false; btn.textContent = '🪣'; }
            if (typeof window.renderImageList === 'function') window.renderImageList();
            if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
            applyBadgesToList();
            if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) updateFixBucketButtonVisibility();
        }

        let msg = `Auto Bucket${window._bucketResults === resultsRef ? '' : ` (${ctx.label})`}: ${ok} image(s) fixed${upscaledCount ? ` (${upscaledCount} upscaled)` : ''}. Originals are in 📦 Archive.`;
        if (bodyUsed) msg += ` Seg body placed ${bodyUsed} crop(s) on the person${bodyCut ? ` (${bodyCut} still cut the body — check them)` : ''}.`;
        else if (!segmOn) msg += ' Use segm body is off — crops kept the most image (centered).';
        else if (segAvail === false) msg += ' Seg body unavailable (local server / ultralytics) — crops were centered.';
        if (metaLost) msg += ` ${metaLost} JPEG/WebP file(s) lost their metadata (kept in the Archive originals).`;
        if (task.cancelled) msg += ' Stopped.';
        if (failed.length) msg += ` ${failed.length} failed: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}`;
        task.result = `${ok} fixed${failed.length ? `, ${failed.length} failed` : ''}`;
        if (window.showAlert) window.showAlert(msg, failed.length || task.cancelled || bodyCut ? 'warn' : 'success');
        }).promise;
    };

    /* ---------- MANUAL BUCKET ALL: one image at a time, next opens by itself ---------- */
    function waitFixClosed() {
        return new Promise(resolve => {
            const el = document.getElementById('modal-fix-bucket');
            if (!el || !el.classList.contains('active')) { resolve(_fixApplied); return; }
            const mo = new MutationObserver(() => {
                if (!el.classList.contains('active')) { mo.disconnect(); resolve(_fixApplied); }
            });
            mo.observe(el, { attributes: true, attributeFilter: ['class'] });
        });
    }

    window.manualBucketAll = async function () {
        if (autoRunningHere() || _manual) return;
        const targets = badTargets();
        if (!targets.length) return;
        const resultsRef = window._bucketResults;
        _manual = { targets, i: 0, ok: 0 };
        const btn = document.getElementById('btn-scan-buckets');
        let cancelled = false, aborted = false;
        try {
            for (let i = 0; i < targets.length; i++) {
                if (window._bucketResults !== resultsRef) { aborted = true; break; }
                _manual.i = i;
                const img = targets[i];
                const r = resultsRef.get(img);
                if (!r || !r.bad) continue;                      // fixed meanwhile
                if (btn) btn.textContent = `✋ ${i + 1}/${targets.length}`;
                const idx = imageFiles.indexOf(img);
                if (idx >= 0 && typeof window.tmSelectAndJump === 'function') window.tmSelectAndJump(idx);
                await window.openFixBucketModal(img);
                const applied = await waitFixClosed();
                if (!applied) { cancelled = true; break; }       // cancel on one image = cancel all
                _manual.ok++;
            }
        } finally {
            const done = _manual ? _manual.ok : 0;
            _manual = null;
            if (btn) btn.textContent = '🪣';
            applyBadgesToList();
            if (window.showAlert) {
                const rest = targets.length - done;
                window.showAlert(cancelled
                    ? `Manual bucket all cancelled: ${done} image(s) fixed, ${rest} left. Originals are in 📦 Archive.`
                    : aborted ? `Manual bucket all stopped (the dataset changed): ${done} image(s) fixed.`
                    : `Manual bucket all done: ${done} image(s) fixed. Originals are in 📦 Archive.`, cancelled || aborted ? 'warn' : 'success');
            }
        }
    };

    /* ---------- APLICA O CROP, ARQUIVA O ORIGINAL, SALVA O NOVO ---------- */
    window.applyFixBucket = async function () {
        if (!_fixState) return;
        const { img, candidate } = _fixState;
        const zoomUsed = (_fixState.zoom || 1) > 1.0001;
        if (!isVirtual(img) && candidate.bw === _fixState.w && candidate.bh === _fixState.h && !zoomUsed) {
            if (window.showAlert) window.showAlert('Nothing to change — pick another resolution or zoom in.', 'info');
            return;
        }
        const btn = document.getElementById('btn-confirm-fix-bucket');
        btn.disabled = true; btn.textContent = '⏳ Processing...';

        if (isVirtual(img)) {
            // PSD Import: renderiza o corte (Lanczos-3) e entrega ao chamador; nada é arquivado.
            try {
                const crop = { x: _fixState.offsetX, y: _fixState.offsetY, w: _fixState.cropW, h: _fixState.cropH };
                const rendered = await renderCropBlob(document.getElementById('bucket-preview-img'), candidate, crop, 'image/png', (t) => { btn.textContent = t; });
                const info = await img.onSave(rendered.blob, candidate, crop, rendered);
                rememberLastCrop();
                _fixApplied = true;
                window.closeModal('modal-fix-bucket');
                if (window.showAlert) window.showAlert(`Added ${info && info.name ? info.name + ' ' : ''}at ${formatRes(candidate.bw, candidate.bh)}${rendered.upscaled ? ' with Lanczos upscale' : rendered.resizing ? ' with Lanczos resize' : ''}.`, 'success');
            } catch (e) {
                console.error('[Bucket Virtual] failed:', e);
                if (window.showAlert) window.showAlert('Could not save the crop: ' + (e.message || e), 'error');
            } finally {
                btn.disabled = false; btn.textContent = _fixState ? _fixState.confirmLabel : '✅ Apply Crop & Save';
                if (_fixState && document.getElementById('modal-fix-bucket').classList.contains('active')) renderCropOverlay();
            }
            return;
        }

        try {
            // Bytes do original ANTES de arquivar (usados para copiar os metadados do PNG).
            let originalBlob = null;
            try { originalBlob = await (await fetch(img.url)).blob(); } catch (e) {}

            const sourceImgEl = document.getElementById('bucket-preview-img');
            const extLower = imageExt(img);
            const mime = extLower === 'png' ? 'image/png' : extLower === 'webp' ? 'image/webp' : 'image/jpeg';
            const crop = { x: _fixState.offsetX, y: _fixState.offsetY, w: _fixState.cropW, h: _fixState.cropH };
            const rendered = await renderCropBlob(sourceImgEl, candidate, crop, mime, (t) => { btn.textContent = t; });
            let blob = rendered.blob;
            const resizing = rendered.resizing, upscaled = rendered.upscaled;

            let copiedMeta = 0;
            if (mime === 'image/png' && originalBlob) {
                const r = await copyPngTextChunks(originalBlob, blob);
                blob = r.blob;
                copiedMeta = r.copied;
            }

            await commitBucketFile(img, blob, candidate);
            rememberLastCrop();
            _fixApplied = true;

            if (typeof window.renderImageList === 'function') window.renderImageList();
            if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();

            window.closeModal('modal-fix-bucket');
            const metaMsg = copiedMeta > 0 ? ` PNG metadata kept (${copiedMeta} chunk(s)).` : '';
            const zoomMsg = zoomUsed ? ` (zoom ${Math.round(_fixState.zoom * 100)}%)` : '';
            if (window.showAlert && !_manual) window.showAlert(`Saved at ${formatRes(candidate.bw, candidate.bh)}${zoomMsg}${upscaled ? ' with Lanczos upscale' : resizing ? ' with Lanczos resize' : ''}. Original safely kept in 📦 Archive.${metaMsg}`, 'success');
        } catch (e) {
            console.error('[Bucket Fix] failed:', e);
            if (window.showAlert) window.showAlert('Error applying the bucket fix: ' + (e.message || e), 'error');
        } finally {
            btn.disabled = false; btn.textContent = _fixState && _fixState.confirmLabel ? _fixState.confirmLabel : '✅ Apply Crop & Save';
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
            injectScanButton();
            injectListCounterButton();
            injectFixBucketButton();
            installHooks();
            loadBucketModel();
        }, 0);
    });

})();
