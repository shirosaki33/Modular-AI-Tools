/* =========================================================================
   ASPECT RATIO BUCKET CHECKER (SDXL) — novo arquivo, standalone
   ---------------------------------------------------------------------
   Detecta imagens do dataset cuja resolução NÃO bate exatamente com uma
   das 41 resoluções oficiais de treino do SDXL (paper, seção "Multi-Aspect
   Training"), e ajuda a corrigir isso via crop guiado.

   FLUXO:
   1) Botão 🪣 na barra de busca/compact-view da lista "Dataset" força um
      scan (lê naturalWidth/naturalHeight de cada imagem visível — reusa
      a mesma <img> já carregada na lista, sem baixar nada de novo).
      Imagens já medidas ao renderizar a lista (mesmo evento que já
      preenche a resolução ao lado do nome) são aproveitadas do cache.
   2) Toda imagem fora do bucket ganha uma borda vermelha + selo "🪣 WxH"
      na lista (mesmo padrão visual do aviso de nome duplicado), e um
      contador vermelho aparece do lado do badge de contagem do Dataset
      ("🪣 N Bad Bucket"), clicável — igual ao ⚠️ Conflicts/🟨 Similar —
      pra pular de uma imagem problemática pra outra.
   3) Selecionando UMA imagem fora do bucket, aparece o botão
      "🪣 Fix Bucket" no cabeçalho da Active Image. Ele abre um popout
      com os buckets mais próximos (por aspect ratio), mostrando quanto
      da imagem original cada um mantém, e uma preview arrastável do
      corte (retângulo verde sobre a imagem, com máscara escurecendo o
      que seria descartado).
   4) Ao confirmar: a imagem ORIGINAL (+ legenda) é movida pro 📦 Archive
      já existente no app (backup automático, restaurável a qualquer
      momento pelo painel de Archive) e só DEPOIS o arquivo cortado é
      gravado no lugar, com o MESMO nome — a legenda em memória é
      regravada normalmente. Nada é perdido mesmo se o usuário errar o
      crop: é só restaurar pelo Archive.

   Depende de (já carregados antes, no HTML): tagmanager_globals.js,
   tagmanager_render_hooks.js, tagmanager_ui_core.js (saveImageToDisk,
   openModal/closeModal), tagmanager_ui_list.js (renderImageList),
   tagmanager_active_editor.js (renderEditor), tagmanager_archive.js
   (window.moveToArchive).
========================================================================= */

(function () {

    /* ---------- TABELA OFICIAL DE BUCKETS SDXL (w, h) ----------
       Lista COMPLETA de 41 buckets do paper da SDXL (seção "Multi-Aspect
       Training") — todos com área ≈ 1024×1024 (1.048.576 px) e lados
       múltiplos de 64. A lista que veio no print do usuário era um
       recorte de 24 itens: faltava o 1024×1024 (o bucket quadrado base)
       e os 8 extremos mais esticados (512×2048 ... 2048×512); também
       tinha "1407x704" onde o valor oficial é "1408x704" (espelho exato
       de "704x1408", já presente na própria tabela). Corrigido aqui. */
    const BUCKETS = [
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
    const BUCKET_KEYS = new Set(BUCKETS.map(([w, h]) => w + 'x' + h));

    /* ▭ paisagem, ▯ retrato, □ quadrado — pra não ter que comparar os números */
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
        .bucket-candidate-list { display:flex; flex-wrap:wrap; gap:8px; margin: 10px 0; max-height: 168px; overflow-y: auto; flex-shrink: 0; }
        .bucket-candidate-chip { background:#151515; border:1px solid #444; border-radius:8px; padding:8px 12px; cursor:pointer; font-size:12px; color:#ddd; text-align:center; transition:0.15s; }
        .bucket-candidate-chip:hover { border-color:#666; }
        .bucket-candidate-chip.active { border-color:#00ff99; background:#0d2a18; color:#00ff99; }
        .bucket-candidate-chip.is-current { border-style: dashed; }
        .bucket-candidate-chip .bc-kept { display:block; font-size:10px; color:#888; margin-top:2px; }
        .bucket-candidate-chip.active .bc-kept { color:#66ffaa; }

        /* flex column + max-height esmagava a preview e o overflow cortava a base */
        #bucket-preview-wrap { position:relative; margin: 15px auto; background:#000; overflow:hidden; border:1px solid #333; border-radius:6px; width: fit-content; max-width: 100%; line-height: 0; flex-shrink: 0; align-self: center; touch-action: none; cursor: grab; user-select: none; }
        #bucket-preview-wrap.dragging { cursor: grabbing; }
        #bucket-preview-img { display:block; width:auto; height:auto; max-width: min(480px, 100%); max-height: 52vh; object-fit: contain; user-select:none; -webkit-user-drag:none; position: relative; z-index: 0 !important; pointer-events: none !important; }
        #bucket-crop-shade { position:absolute; pointer-events: none !important; box-shadow: 0 0 0 2000px rgba(0,0,0,0.55); box-sizing: border-box; z-index: 1 !important; }
        #bucket-crop-rect { position:absolute; border:2px solid #00ff99; cursor: grab; box-sizing: border-box; z-index: 2 !important; pointer-events: auto !important; background: rgba(0,255,153,0.05); }
        #bucket-crop-rect.dragging { cursor: grabbing; }
        .bucket-warn-upscale { font-size:11px; color:#ffcc66; background:#2a1a00; border:1px solid #aa6600; padding:8px 10px; border-radius:6px; margin-top:10px; display:none; }
    `;
    document.head.appendChild(style);

    /* ---------- ESTADO ---------- */
    window._bucketResults = window._bucketResults || new Map(); // img -> {w,h,bad}
    let _lastImageFilesRefBucket = null;

    function resetForNewDataset() {
        if (typeof imageFiles === 'undefined') return;
        if (imageFiles === _lastImageFilesRefBucket) return;
        _lastImageFilesRefBucket = imageFiles;
        window._bucketResults = new Map();
        window._bucketIssueIndices = [];
        // Scan automático e silencioso a cada dataset/subpasta carregado
        setTimeout(() => window.scanDatasetBuckets(true), 150);
    }

    /* ---------- MEDIÇÃO DE RESOLUÇÃO REAL ----------
       Reaproveita a MESMA <img> já usada como miniatura na lista (o src é
       o blob do arquivo original — naturalWidth/naturalHeight já refletem
       o tamanho real do arquivo, não o tamanho exibido via --thumb-size).
       Se ainda não carregou (thumb fora da viewport, lazy paint, etc.),
       cai para um probe Image() próprio como fallback. */
    function measureFromThumb(img) {
        if (!img.element) return null;
        const thumbEl = img.element.querySelector('.list-item-thumb-wrap img');
        if (thumbEl && thumbEl.complete && thumbEl.naturalWidth) {
            return { w: thumbEl.naturalWidth, h: thumbEl.naturalHeight };
        }
        return null;
    }

    function measureViaLoader(img) {
        return new Promise((resolve) => {
            const probe = new Image();
            probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
            probe.onerror = () => resolve(null);
            probe.src = img.url;
        });
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
                    badge.title = 'Resolution is not an SDXL training bucket. Select this image and use "🪣 Fix Bucket".';
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

    /* ---------- SCAN MANUAL (botão 🪣 na barra da lista) ---------- */
    window.scanDatasetBuckets = async function (silent) {
        silent = silent === true; // o onclick manual passa um evento/undefined → não é silencioso
        if (typeof imageFiles === 'undefined' || imageFiles.length === 0) {
            if (!silent && window.showAlert) window.showAlert('No dataset loaded.', 'warn');
            return;
        }
        const btn = document.getElementById('btn-scan-buckets');
        if (!silent && btn) { btn.disabled = true; btn.textContent = '⏳'; }

        // Se o dataset trocar no meio do scan, aborta (os resultados seriam do dataset antigo).
        const resultsRef = window._bucketResults;
        const toMeasure = imageFiles.slice(); // inclui ocultas: a resolução aparece pra todas
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
                ? `Scan complete: ${badCount} image(s) are not on an SDXL bucket resolution.`
                : `Scan complete: all images already match an SDXL bucket resolution!`,
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
        btn.title = 'Images with a resolution outside the SDXL training buckets — click to jump to one';
        btn.onclick = () => window.selectBucketIssueImage();
        listCount.insertAdjacentElement('afterend', btn);
    }

    function injectScanButton() {
        // Ancora na mesma barra do filtro de nome/compact-view (ao lado do
        // toggle 🗂️), pra não poluir a topbar como pedido.
        const anchor = document.getElementById('btn-compact-group-depth') || document.getElementById('btn-toggle-compact-view');
        if (!anchor || document.getElementById('btn-scan-buckets')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-scan-buckets';
        btn.textContent = '🪣';
        btn.title = 'Scan dataset for images outside SDXL training bucket resolutions';
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
        btn.title = 'Crop or resize this image to any SDXL training bucket — works even if the resolution is already valid';
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
            btn.title = 'This image is not on an SDXL bucket resolution — click to crop it to one';
        } else if (result) {
            btn.classList.add('is-valid');
            btn.textContent = '🪣 Change Bucket';
            btn.title = `Already on an SDXL bucket (${formatRes(result.w, result.h)}). Click to crop or resize it to a different bucket.`;
        } else {
            btn.classList.add('is-unknown');
            btn.textContent = '🪣 Bucket';
            btn.title = 'Crop or resize this image to an SDXL training bucket';
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

    /* ---------- MODAL DE FIX + PREVIEW ARRASTÁVEL ---------- */
    function buildFixModal() {
        const existing = document.getElementById('modal-fix-bucket');
        if (existing && document.getElementById('bucket-crop-shade')) return;
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'modal-fix-bucket';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-fix-bucket');
        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🪣 Fix Bucket Resolution</span>
                    <button onclick="window.closeModal('modal-fix-bucket')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div id="bucket-fix-info" style="font-size:12px; color:#aaa; margin-bottom:6px;"></div>
                <div class="bucket-candidate-list" id="bucket-candidate-list"></div>
                <div id="bucket-preview-wrap">
                    <img id="bucket-preview-img" src="" alt="" draggable="false">
                    <div id="bucket-crop-shade"></div>
                    <div id="bucket-crop-rect"></div>
                </div>
                <div id="bucket-upscale-warning" class="bucket-warn-upscale">⚠️ This bucket is larger than the crop. Saving will upscale with Lanczos-3, which stays sharper than the browser's default resize.</div>
                <div id="bucket-drag-hint" style="font-size:11px; color:#aaa; margin-top:8px;"></div>
                <div style="font-size:11px; color:#666; margin-top:4px;">The original file will be moved to 📦 Archive before saving (fully recoverable from there).</div>
                <div class="modal-buttons">
                    <button class="btn-cancel" onclick="window.closeModal('modal-fix-bucket')">Cancel</button>
                    <button id="btn-confirm-fix-bucket" style="background:#00aa66; color:#000; border:none; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer;">✅ Apply Crop &amp; Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    let _fixState = null; // { img, w, h, candidates, candidate, offsetX, offsetY, cropW, cropH, scale, previewScale }

    function selectCandidate(cand) {
        _fixState.candidate = cand;
        _fixState.offsetX = null; // recentraliza no novo bucket escolhido
        _fixState.offsetY = null;
        renderCandidateChips();
        renderCropOverlay();
    }

    function renderCandidateChips() {
        const list = document.getElementById('bucket-candidate-list');
        list.innerHTML = '';
        const closest = _fixState.candidates[0];
        _fixState.candidates.forEach((c) => {
            const isCurrent = c.bw === _fixState.w && c.bh === _fixState.h;
            const chip = document.createElement('div');
            chip.className = 'bucket-candidate-chip' + (c === _fixState.candidate ? ' active' : '') + (isCurrent ? ' is-current' : '');
            const notes = [];
            if (isCurrent) notes.push('current');
            if (c === closest) notes.push('closest AR');
            chip.innerHTML = `${formatRes(c.bw, c.bh)}<span class="bc-kept">${Math.round(c.kept * 100)}% kept${notes.length ? ' · ' + notes.join(' · ') : ''}</span>`;
            chip.onclick = () => selectCandidate(c);
            list.appendChild(chip);
        });
    }

    function renderCropOverlay() {
        const c = _fixState.candidate;
        const { w, h } = _fixState;
        const scale = Math.max(c.bw / w, c.bh / h);
        let cropW = c.bw / scale, cropH = c.bh / scale;
        if (cropW > w) cropW = w;
        if (cropH > h) cropH = h;

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
        _fixState.previewScaleX = scaleX;
        _fixState.previewScaleY = scaleY;
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

        document.getElementById('bucket-upscale-warning').style.display = (scale > 1) ? 'block' : 'none';

        const hint = document.getElementById('bucket-drag-hint');
        if (hint) {
            const slackX = Math.max(0, w - cropW);
            const slackY = Math.max(0, h - cropH);
            const keptPct = Math.round((c.kept || 0) * 100);
            if (slackX < 1 && slackY < 1) {
                hint.textContent = `This bucket matches the image aspect (${keptPct}% kept), so the green box covers the whole frame and cannot slide. Pick another size to crop.`;
            } else if (slackX < 1) {
                hint.textContent = `Drag the green box up or down — ${formatRes(c.bw, c.bh)} keeps ${keptPct}% and only has vertical margin.`;
            } else if (slackY < 1) {
                hint.textContent = `Drag the green box left or right — ${formatRes(c.bw, c.bh)} keeps ${keptPct}% and only has horizontal margin.`;
            } else {
                hint.textContent = `Drag the green box to choose what stays — ${formatRes(c.bw, c.bh)} keeps ${keptPct}% of the image.`;
            }
        }
    }

    /* Listeners no window (capture), lendo o estado do módulo.
       A versão antiga guardava "dragging" dentro de setupCropDrag e
       reatribuía o mousedown a cada abertura: o mousemove continuava
       olhando a flag da primeira vez, então o arraste morria no 2º open.
       Capture no window também chega antes dos handlers globais do app. */
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
        if (_dragBound) return;
        _dragBound = true;
        window.addEventListener('pointerdown', onBucketPointerDown, true);
        window.addEventListener('pointermove', onBucketPointerMove, true);
        window.addEventListener('pointerup', onBucketPointerUp, true);
        window.addEventListener('pointercancel', onBucketPointerUp, true);
    }

    window.openFixBucketModal = async function (img) {
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

        const alreadyValid = !result.bad;
        const candidates = suggestBuckets(result.w, result.h);
        let candidate = candidates[0];
        if (alreadyValid) {
            const other = candidates.find(c => c.bw !== result.w || c.bh !== result.h);
            if (other) candidate = other;
        }
        _fixState = { img, w: result.w, h: result.h, candidates, candidate, offsetX: null, offsetY: null, alreadyValid };

        document.getElementById('bucket-fix-info').textContent = alreadyValid
            ? `Current resolution: ${formatRes(result.w, result.h)} — already a valid SDXL bucket. Pick another size below to change it (dashed chip = current).`
            : `Current resolution: ${formatRes(result.w, result.h)} (not a valid SDXL bucket). Choose a target bucket below:`;
        const previewImgEl = document.getElementById('bucket-preview-img');
        const paintPreview = () => requestAnimationFrame(() => requestAnimationFrame(() => {
            if (_fixState) renderCropOverlay();
        }));
        previewImgEl.onload = paintPreview;
        previewImgEl.draggable = false;
        previewImgEl.src = img.url;

        renderCandidateChips();
        setupCropDrag();

        window.openModal('modal-fix-bucket');
        document.getElementById('btn-confirm-fix-bucket').onclick = () => window.applyFixBucket();
        paintPreview();
        if (previewImgEl.complete && previewImgEl.naturalWidth) paintPreview();
    };

    /* ---------- LANCZOS-3 (separável, alpha pré-multiplicado) ----------
       Usado quando o recorte não tem o tamanho exato do bucket. No upscale
       o kernel fica em 3px de raio (mais nítido que o bilinear do canvas).
       No downscale o kernel alarga para não serrilhar. */
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
        const btn = document.getElementById('btn-confirm-fix-bucket');
        btn.disabled = true; btn.textContent = '⏳ Processing...';

        try {
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

            const extLower = (img.name.split('.').pop() || 'png').toLowerCase();
            const mime = extLower === 'png' ? 'image/png' : extLower === 'webp' ? 'image/webp' : 'image/jpeg';
            const blob = await new Promise(res => outCanvas.toBlob(res, mime, 0.95));
            if (!blob) throw new Error('Failed to generate the cropped image.');

            // Backup automático: manda a imagem + legenda originais pro 📦
            // Archive já existente no app (restaurável a qualquer momento).
            if (typeof window.moveToArchive !== 'function') throw new Error('Archive module not loaded.');
            const archived = await window.moveToArchive(img);
            if (!archived) throw new Error('Could not archive the original image — aborting to avoid data loss.');

            // Escreve o arquivo cortado com o MESMO nome original (o nome
            // ficou livre porque o original acabou de ser movido pro Archive).
            const fileHandle = await img.parentDirHandle.getFileHandle(img.name, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            // A legenda também foi arquivada junto com o original — regrava
            // do conteúdo que já está em memória (sem perder edições não salvas).
            if (img.hasFile && typeof window.saveImageToDisk === 'function') await window.saveImageToDisk(img);

            // Atualiza o preview em memória (a blob URL antiga não existe mais).
            try { URL.revokeObjectURL(img.url); } catch (e) {}
            img.url = URL.createObjectURL(blob);

            markResult(img, { w: candidate.bw, h: candidate.bh });

            if (typeof window.renderImageList === 'function') window.renderImageList();
            if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();

            window.closeModal('modal-fix-bucket');
            if (window.showAlert) window.showAlert(`Saved at ${formatRes(candidate.bw, candidate.bh)}${upscaled ? ' with Lanczos upscale' : resizing ? ' with Lanczos resize' : ''}. Original safely kept in 📦 Archive.`, 'success');
        } catch (e) {
            console.error('[Bucket Fix] failed:', e);
            if (window.showAlert) window.showAlert('Error applying the bucket fix: ' + (e.message || e), 'error');
        } finally {
            btn.disabled = false; btn.textContent = '✅ Apply Crop & Save';
        }
    };

    /* ---------- HOOKS ---------- */
    function installHooks() {
        if (typeof window.registerPostRenderImageList === 'function') {
            window.registerPostRenderImageList(() => { resetForNewDataset(); applyBadgesToList(); });
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
        }, 0);
    });

})();