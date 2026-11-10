/* =========================================================================
   UI LOGIC - IMAGE LIST
   Handles the left panel, image rendering, multi-select, hide, and renames.
========================================================================= */

window.getCaptionCounts = function(img) {
    let tags = 0, nl = 0;
    if (img.content) {
        img.content.split(',').forEach(t => {
            const c = t.trim();
            if (!c) return;
            if (window.checkIfNL(c)) nl++; else tags++;
        });
    }
    return { tags, nl };
};
window.buildTypeBadge = function(img) {
    if (!img.hasFile) return 'Empty';
    const c = window.getCaptionCounts(img);
    return `🏷️ Tags (${c.tags}) · 📝 NL (${c.nl}) (.${img.ext || 'txt'})`;
};


window.handleListClick = function(index, shiftKey, ctrlKey) {
    if (shiftKey && selectedIndices.size > 0) {
        const start = Math.min(lastSelectedIndex, index), end = Math.max(lastSelectedIndex, index);
        selectedIndices.clear();
        for (let i = start; i <= end; i++) {
            if (imageFiles[i].element && imageFiles[i].element.style.display !== 'none') {
                selectedIndices.add(i);
            }
        }
    } else if (ctrlKey) {
        if (selectedIndices.has(index)) selectedIndices.delete(index); else selectedIndices.add(index);
        lastSelectedIndex = index;
    } else {
        if (selectedIndices.has(index) && selectedIndices.size === 1) {
            selectedIndices.clear();
        } else {
            selectedIndices.clear(); selectedIndices.add(index); lastSelectedIndex = index;
        }
    }
    activeSelectedTags.clear();
    window.updateListSelectionVisuals();
    if (typeof window.renderEditor === 'function') window.renderEditor();
}

/* =========================================================================
   IMAGE PREVIEWS BY BLOCKS (memory + fast navigation)
   ---------------------------------------------------------------------
   The list rows are split into BLOCKS of N images (⚙️ Settings > 🖼️ Image
   list > Images per block). Only the block(s) around the visible area have
   thumbnails in memory; every other block is released (blob revoked, src
   removed) and rebuilt when it comes back.
     - Smaller blocks = less RAM, but far jumps need to load blocks more often
       (slower to search). Bigger blocks = more RAM and each block takes longer
       to load, but jumping/searching inside it is faster.
     - The NEXT / PREVIOUS block is preloaded when the visible area gets close
       to the block edge (EDGE rows), so scrolling never shows empty rows.
     - Thumbnails are small JPEGs (decoded once, reduced to the slider width,
       full bitmap closed right away). The real resolution goes to img._resolution.
   JUMP (bucket / similar / conflict / any "go to image"):
     window.tmJumpToImage(index) -> 1) locates the image in the list,
     2) checks if it is in a block that is not loaded, 3) loads THAT block
     completely (all heights final), 4) only then moves the list to the image.
     This fixes the wrong/failed preview when navigating fast (the old smooth
     scroll landed on rows whose height was still changing).
   Stale work is dropped: a queued thumbnail whose block is no longer wanted,
   or that belongs to an older dataset, is skipped instead of decoded.
========================================================================= */
;(function () {
    const QUEUE_LIMIT = 4;               // simultaneous decodes
    const EDGE = 8;                      // rows from the block edge that trigger the neighbor preload
    const MAX_RETRY = 2;                 // failed decodes are retried, then the original is used
    const BLOCK_KEY = 'image-block-size';
    const BLOCK_DEFAULT = 100, BLOCK_MIN = 20, BLOCK_MAX = 2000;
    let blockSize = BLOCK_DEFAULT;
    let running = 0;
    let queue = [];
    let syncRAF = null;
    let hooked = false;
    let gen = 0;                          // bumps on dataset change: older jobs are dropped
    let jumping = 0;                      // seq of the jump in progress (0 = none)
    let jumpSeq = 0;                      // never resets: only the newest jump may move the list
    const live = new Set();              // images with a thumbnail blob alive
    let wantedBlocks = new Set();
    const rowBlock = new WeakMap();      // img -> block index (last computed)

    (function css() {
        const st = document.createElement('style');
        // No content-visibility: its estimated heights made jumps land on the wrong image.
        st.textContent = `#image-list > .list-item .list-item-thumb-wrap > img:not([src]) { aspect-ratio: var(--tm-ph-ratio, 1); background: #161616; }`;
        document.head.appendChild(st);
    })();

    function keepRatio(img, el) {
        if (el && img._resolution && img._resolution.w && img._resolution.h) el.style.aspectRatio = img._resolution.w + ' / ' + img._resolution.h;
    }

    function releaseOne(img) {
        live.delete(img);
        const el = img._thumbEl;
        if (img._thumbBlobUrl) { try { URL.revokeObjectURL(img._thumbBlobUrl); } catch (e) {} }
        img._thumbBlobUrl = null; img._thumbBuiltFor = null; img._thumbWidth = 0;
        if (el) { keepRatio(img, el); el.removeAttribute('src'); }
    }

    function visibleRows() {
        if (typeof imageFiles === 'undefined') return [];
        return imageFiles.filter(img => img._thumbEl && img.element && img.element.isConnected && img.element.style.display !== 'none' && !img.hidden);
    }

    // Rows split in blocks (by position among the rows shown, so filters keep blocks dense).
    function blocksOf(rows) {
        const out = [];
        for (let i = 0; i < rows.length; i += blockSize) out.push(rows.slice(i, i + blockSize));
        rows.forEach((img, i) => rowBlock.set(img, Math.floor(i / blockSize)));
        return out;
    }

    function visibleRange(list, rows) {
        const lr = list.getBoundingClientRect();
        const top = lr.top, bottom = lr.bottom;
        let lo = 0, hi = rows.length - 1;
        while (lo < hi) {
            const m = (lo + hi) >> 1;
            if (rows[m].element.getBoundingClientRect().bottom <= top) lo = m + 1; else hi = m;
        }
        const first = lo;
        let last = first;
        while (last + 1 < rows.length && rows[last + 1].element.getBoundingClientRect().top < bottom) last++;
        return { first, last };
    }

    function syncWindow() {
        syncRAF = null;
        const list = document.getElementById('image-list');
        if (!list || list.offsetParent === null) return;
        const rows = visibleRows();
        if (!rows.length) return;
        const blocks = blocksOf(rows);
        const { first, last } = visibleRange(list, rows);
        const bFirst = Math.floor(first / blockSize), bLast = Math.floor(last / blockSize);
        const want = new Set();
        for (let b = bFirst; b <= bLast; b++) want.add(b);
        // Preload the neighbor block when close to the edge.
        if (first - bFirst * blockSize < EDGE && bFirst > 0) want.add(bFirst - 1);
        if ((bLast + 1) * blockSize - 1 - last < EDGE && bLast + 1 < blocks.length) want.add(bLast + 1);
        wantedBlocks = want;
        // Request the visible rows first, then the rest of the wanted blocks (nearest first).
        const order = [];
        for (let i = first; i <= last; i++) order.push(rows[i]);
        Array.from(want).sort((a, b) => Math.abs(a - bFirst) - Math.abs(b - bFirst)).forEach(b => {
            (blocks[b] || []).forEach(img => order.push(img));
        });
        order.forEach(img => request(img));
        // Release every thumbnail outside the wanted blocks.
        Array.from(live).forEach(img => {
            const b = rowBlock.get(img);
            if (jumping && img._jumpWanted) return;
            if (b === undefined || !want.has(b) || !img.element || !img.element.isConnected || img.element.style.display === 'none') releaseOne(img);
        });
        // Drop queued jobs that are no longer wanted.
        queue = queue.filter(img => { const ok = isWanted(img); if (!ok) { img._thumbQueued = false; resolveWaiters(img); } return ok; });
    }
    function isWanted(img) {
        if (jumping && img._jumpWanted) return true;
        const b = rowBlock.get(img);
        return b !== undefined && wantedBlocks.has(b) && img.element && img.element.isConnected && img.element.style.display !== 'none';
    }
    function scheduleSync() {
        if (!syncRAF) syncRAF = requestAnimationFrame(syncWindow);
    }
    function hook() {
        if (hooked) return;
        const list = document.getElementById('image-list');
        if (!list) return;
        hooked = true;
        list.addEventListener('scroll', scheduleSync, { passive: true });
        window.addEventListener('resize', scheduleSync);
        new MutationObserver(scheduleSync).observe(list, { attributes: true, attributeFilter: ['style', 'class'], subtree: true, childList: true });
    }

    function targetWidth() {
        const css = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--thumb-size'), 10) || 70;
        const want = Math.ceil(css * (window.devicePixelRatio || 1));
        return Math.max(128, Math.ceil(want / 128) * 128);
    }

    function setThumbSrc(img, el, url) {
        if (el && el.getAttribute('src') !== url) el.src = url;
    }

    // Promises waiting for a thumbnail (used by the jump)
    function resolveWaiters(img) {
        const w = img._thumbWaiters;
        if (!w) return;
        img._thumbWaiters = null;
        w.forEach(fn => { try { fn(); } catch (e) {} });
    }
    function isFresh(img) {
        return img._thumbBuiltFor === img.url && (img._thumbWidth || 0) >= targetWidth();
    }

    async function makeThumb(img, myGen) {
        const el = img._thumbEl;
        if (myGen !== gen || !el || !el.isConnected || !isWanted(img)) { img._thumbQueued = false; resolveWaiters(img); return; }
        const width = targetWidth();
        const sourceUrl = img.url;
        try {
            const file = img.handle && typeof img.handle.getFile === 'function' ? await img.handle.getFile() : null;
            const blob = file || await (await fetch(sourceUrl)).blob();
            const bmp = await createImageBitmap(blob);
            const w = bmp.width, h = bmp.height;
            if (w > 0 && h > 0 && (!img._resolution || img._resolution.w !== w || img._resolution.h !== h)) img._resolution = { w, h };
            let url = sourceUrl;
            if (w > width) {
                const tw = width, th = Math.max(1, Math.round(h * width / w));
                const canvas = document.createElement('canvas');
                canvas.width = tw; canvas.height = th;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(bmp, 0, 0, tw, th);
                const small = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
                canvas.width = canvas.height = 0;
                if (small) url = URL.createObjectURL(small);
            }
            bmp.close();
            // The image may have changed (bucket crop), the row may be another one, or the dataset changed.
            if (myGen !== gen || img.url !== sourceUrl || img._thumbEl !== el || el._tmImg !== img) {
                if (url !== sourceUrl) URL.revokeObjectURL(url);
                return;
            }
            if (img._thumbBlobUrl && img._thumbBlobUrl !== url) URL.revokeObjectURL(img._thumbBlobUrl);
            img._thumbBlobUrl = url !== sourceUrl ? url : null;
            img._thumbBuiltFor = sourceUrl;
            img._thumbWidth = width;
            img._thumbFail = 0;
            keepRatio(img, el);
            setThumbSrc(img, el, url);
            if (img._thumbBlobUrl) live.add(img);
            if (img._onThumbSize) img._onThumbSize();
        } catch (e) {
            img._thumbFail = (img._thumbFail || 0) + 1;
            if (img._thumbFail > MAX_RETRY && myGen === gen && img._thumbEl === el) {
                // Format createImageBitmap cannot read: show the original (counts as built).
                img._thumbBuiltFor = sourceUrl; img._thumbWidth = 99999;
                setThumbSrc(img, el, sourceUrl);
            }
        } finally {
            img._thumbQueued = false;
            resolveWaiters(img);
        }
    }

    function pump() {
        while (running < QUEUE_LIMIT && queue.length) {
            const img = queue.shift();
            const myGen = gen;
            running++;
            makeThumb(img, myGen).finally(() => { running--; pump(); });
        }
    }

    function request(img, front) {
        if (!img._thumbEl) return;
        if (isFresh(img)) {
            setThumbSrc(img, img._thumbEl, img._thumbBlobUrl || img.url);
            if (img._thumbBlobUrl) live.add(img);
            return;
        }
        if (img._thumbQueued) {
            if (front) { const i = queue.indexOf(img); if (i > 0) { queue.splice(i, 1); queue.unshift(img); } }
            return;
        }
        img._thumbQueued = true;
        if (front) queue.unshift(img); else queue.push(img);
        pump();
    }

    // Loads a list of rows completely (resolves when every one is built or failed).
    function loadRows(rows, timeoutMs) {
        const waits = rows.map(img => new Promise(res => {
            if (isFresh(img)) { request(img); return res(); }
            (img._thumbWaiters = img._thumbWaiters || []).push(res);
            request(img, true);
            if (!img._thumbQueued && isFresh(img)) resolveWaiters(img);
        }));
        return Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, timeoutMs || 10000))]);
    }

    /* JUMP: locate -> load the target block completely -> move the list to the image. */
    window.tmJumpToImage = async function (index, opts) {
        opts = opts || {};
        if (typeof imageFiles === 'undefined') return false;
        const target = imageFiles[index];
        const list = document.getElementById('image-list');
        if (!target || !list) return false;
        if (!target.element || !target.element.isConnected || target.element.style.display === 'none' || target.hidden) {
            if (!opts.silent && window.showAlert) window.showAlert(`"${target.name || 'Image'}" is hidden by the current filter / hide.`, 'info');
            return false;
        }
        const myGen = gen;
        const rows = visibleRows();
        blocksOf(rows);
        const pos = rows.indexOf(target);
        if (pos === -1) return false;
        const b = Math.floor(pos / blockSize);
        const blockRows = rows.slice(b * blockSize, (b + 1) * blockSize);
        const token = ++jumpSeq;
        jumping = token;
        blockRows.forEach(img => { img._jumpWanted = token; });
        wantedBlocks = new Set([b]);
        const needLoad = blockRows.some(img => !isFresh(img));
        if (needLoad) {
            // Only the target block is wanted now: drop every other queued job, target first.
            queue = queue.filter(img => { const ok = img._jumpWanted === token; if (!ok) { img._thumbQueued = false; resolveWaiters(img); } return ok; });
            const ordered = [target].concat(blockRows.filter(x => x !== target).sort((x, y) => Math.abs(rows.indexOf(x) - pos) - Math.abs(rows.indexOf(y) - pos)));
            await loadRows(ordered, 10000);
        }
        blockRows.forEach(img => { if (img._jumpWanted === token) img._jumpWanted = 0; });
        if (token !== jumpSeq || myGen !== gen) return false;   // another jump started / dataset changed
        jumping = 0;
        const go = () => {
            if (token !== jumpSeq) return;                       // a newer jump owns the list now
            const el = target.element;
            if (!el || !el.isConnected) return;
            const lr = list.getBoundingClientRect(), r = el.getBoundingClientRect();
            const delta = (r.top - lr.top) - (lr.height - r.height) / 2;
            if (Math.abs(delta) > 1) list.scrollTop += delta;
        };
        go();
        await new Promise(r => requestAnimationFrame(() => { go(); requestAnimationFrame(() => { go(); r(); }); }));
        if (token !== jumpSeq) return false;
        if (typeof window.tmRememberListScroll === 'function') window.tmRememberListScroll();
        scheduleSync();
        return true;
    };

    // Select an image (single selection), render the editor and jump to it.
    window.tmSelectAndJump = function (index) {
        if (typeof imageFiles === 'undefined' || !imageFiles[index]) return;
        if (typeof selectedIndices !== 'undefined') { selectedIndices.clear(); selectedIndices.add(index); }
        try { if (typeof lastSelectedIndex !== 'undefined') lastSelectedIndex = index; } catch (e) {}
        if (typeof activeSelectedTags !== 'undefined' && activeSelectedTags.clear) activeSelectedTags.clear();
        if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
        if (typeof window.renderEditor === 'function') window.renderEditor();
        return window.tmJumpToImage(index);
    };

    window.attachImageThumb = function (img, el) {
        el._tmImg = img;
        keepRatio(img, el);
        hook();
        scheduleSync();
    };

    window._thumbLiveCount = () => live.size;
    window.tmGetImageBlockSize = () => blockSize;
    window.tmSetImageBlockSize = function (v, skipSave) {
        let n = parseInt(v, 10);
        if (!isFinite(n)) n = BLOCK_DEFAULT;
        n = Math.max(BLOCK_MIN, Math.min(BLOCK_MAX, n));
        blockSize = n;
        const inp = document.getElementById('image-block-size');
        if (inp && String(inp.value) !== String(n)) inp.value = n;
        if (!skipSave && typeof window.saveSetting === 'function') window.saveSetting(BLOCK_KEY, n);
        scheduleSync();
    };

    window.refreshImageThumbsForSize = function () { scheduleSync(); };

    window.releaseImageThumbs = function (files) {
        gen++;
        queue.forEach(img => { img._thumbQueued = false; resolveWaiters(img); });
        queue = [];
        live.clear();
        wantedBlocks = new Set();
        (files || []).forEach(img => {
            if (!img) return;
            if (img._thumbBlobUrl) { try { URL.revokeObjectURL(img._thumbBlobUrl); } catch (e) {} }
            if (img._thumbEl) { img._thumbEl.removeAttribute('src'); img._thumbEl._tmImg = null; }
            img._thumbBlobUrl = null; img._thumbEl = null; img._thumbBuiltFor = null; img._thumbQueued = false;
            img._onThumbSize = null; img.element = null;
        });
    };

    // ⚙️ setting: Images per block
    function injectBlockSetting() {
        const dd = document.getElementById('settings-dropdown');
        if (!dd || document.getElementById('image-block-size')) return;
        const grp = document.createElement('div');
        grp.id = 'settings-image-block-group';
        grp.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
        grp.innerHTML = `
            <div class="settings-group-label">🖼️ Image list</div>
            <label title="The image list loads previews in blocks of this many images. Fewer images per block = less RAM, but jumping to far images loads blocks more often (slower to search). More images per block = more RAM and each block takes longer to load, but searching / jumping is faster.">Images per block:
                <input type="number" id="image-block-size" min="${BLOCK_MIN}" max="${BLOCK_MAX}" step="10" style="width: 64px;">
            </label>
            <div style="font-size:10px; color:#777; line-height:1.35; margin-top:-3px;">Smaller block = less RAM, slower to search.<br>Bigger block = more RAM, slower to load, faster to search.</div>`;
        const hr = document.createElement('hr');
        hr.style.cssText = 'border: 0; border-top: 1px solid #333; margin: 5px 0;';
        const first = dd.querySelector('.settings-group-label');
        // right after the General group (before the next <hr>)
        let anchor = first ? first.nextElementSibling : null;
        while (anchor && anchor.tagName !== 'HR') anchor = anchor.nextElementSibling;
        if (anchor) { dd.insertBefore(hr, anchor); dd.insertBefore(grp, anchor); }
        else { dd.appendChild(hr); dd.appendChild(grp); }
        const inp = document.getElementById('image-block-size');
        inp.value = blockSize;
        inp.onchange = () => window.tmSetImageBlockSize(inp.value);
    }
    window.addEventListener('DOMContentLoaded', async () => {
        injectBlockSetting();
        try {
            if (typeof window.getSetting === 'function') window.tmSetImageBlockSize(await window.getSetting(BLOCK_KEY, BLOCK_DEFAULT), true);
        } catch (e) {}
    });
})();

window.renderImageList = function() {
    const esc = (v) => (typeof window.escHTML === 'function' ? window.escHTML(v) : String(v));
    const listDiv = document.getElementById('image-list');
    // Mantém a posição da rolagem: limpar a lista zerava o scroll e ela voltava
    // pro início a cada re-render (merge NL, bucket, B&W, ...).
    const keepScroll = listDiv.scrollTop;
    // Âncora: a 1ª imagem visível no topo e o quanto ela está deslocada.
    let anchorImg = null, anchorOffset = 0;
    if (keepScroll > 0) {
        const listTop = listDiv.getBoundingClientRect().top;
        for (const im of imageFiles) {
            const el = im.element;
            if (!el || !el.isConnected || el.style.display === 'none') continue;
            const r = el.getBoundingClientRect();
            if (r.bottom > listTop) { anchorImg = im; anchorOffset = r.top - listTop; break; }
        }
    }
    listDiv.innerHTML = '';
    imageFiles.forEach((img, index) => {
        if (img.hidden) {
            if (img.element) img.element.style.display = 'none';
            return;
        }

        const div = document.createElement('div');
        let typeBadge = window.buildTypeBadge(img);
        const suggestCount = (img.pendingAdd && img.pendingAdd.length) ? img.pendingAdd.length : 0;
        const suggestBadge = suggestCount > 0 ? `<span class="suggest-badge">💡${suggestCount}</span>` : '';

        div.className = `list-item ${img.hasFile ? 'has-data' : ''}`;
        div.innerHTML = `
            <div class="list-item-thumb-wrap">
                <button class="list-item-zoom-btn" title="Zoom / view full size">🔍</button>
            </div>
            <div class="list-item-info">
                <div class="list-item-name">${esc(img.name)}</div>
                <div class="list-item-status"><span class="list-item-type">${esc(typeBadge)}</span>${suggestBadge}<span class="list-item-resolution"></span></div>
            </div>
        `;
        div.onclick = (e) => window.handleListClick(index, e.shiftKey, e.ctrlKey || e.metaKey);

        // MINIATURA: o mesmo <img> é reaproveitado entre renders e recebe uma
        // miniatura PEQUENA gerada quando entra perto da área visível
        // (window.attachImageThumb, acima) — nunca a imagem original decodificada.
        const newThumb = !img._thumbEl || img._thumbUrl !== img.url;
        if (newThumb) {
            const t = document.createElement('img');
            t.decoding = 'async';
            t.alt = '';
            img._thumbEl = t;
            img._thumbUrl = img.url;
        }
        div.querySelector('.list-item-thumb-wrap').prepend(img._thumbEl);
        if (newThumb || !img._thumbEl.getAttribute('src')) window.attachImageThumb(img, img._thumbEl);

        // RESOLUÇÃO: vem do arquivo (img._resolution), preenchida ao gerar a miniatura.
        const resEl = div.querySelector('.list-item-resolution');
        if (resEl) {
            const paintRes = () => { if (img._resolution) resEl.textContent = ` · ${img._resolution.w}×${img._resolution.h}`; };
            paintRes();
            img._onThumbSize = paintRes;
        }

        // LUPA 🔍: abre o modal de zoom sem disparar a seleção da linha.
        const zoomBtn = div.querySelector('.list-item-zoom-btn');
        if (zoomBtn) {
            zoomBtn.onclick = (e) => {
                e.stopPropagation();
                document.getElementById('image-popout').src = img.url;
                window.openModal('modal-image');
            };
        }

        img.element = div; listDiv.appendChild(div);
    });

    window.updateListSelectionVisuals();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    if (typeof window.updateSuggestFilterVisibility === 'function') window.updateSuggestFilterVisibility();
    if (keepScroll > 0) {
        listDiv.scrollTop = keepScroll;
        const restore = () => {
            const el = anchorImg && anchorImg.element;
            if (!el || !el.isConnected || el.style.display === 'none') return;
            const delta = (el.getBoundingClientRect().top - listDiv.getBoundingClientRect().top) - anchorOffset;
            if (Math.abs(delta) > 1) listDiv.scrollTop += delta;
        };
        restore();
        // de novo após o layout (miniaturas com content-visibility mudam a altura)
        requestAnimationFrame(() => { restore(); requestAnimationFrame(restore); });
    }
}

window.filterImagesByName = function(val) {
    window.imageNameFilter = (val || '').trim().toLowerCase();
    if (typeof window.applyFilters === 'function') window.applyFilters();
};

/* ---------------------------------------------------------------------
   Este é o ÚNICO lugar que decide a aparência da seleção — tanto o clique
   rápido quanto o render completo passam por aqui. Limpa o estilo inline
   (!important) do que não está mais selecionado e aplica a cor customizada
   (se o módulo de Highlights estiver carregado) no que está selecionado.
--------------------------------------------------------------------- */
window.updateListSelectionVisuals = function() {
    imageFiles.forEach((img, i) => {
        if (!img.element) return;
        const isSelected = selectedIndices.has(i);
        img.element.classList.toggle('selected', isSelected);

        if (isSelected) {
            const selColor = (window._builtinHighlightColors && window._builtinHighlightColors.selection) || null;
            if (selColor) {
                let h = selColor.replace('#', '');
                if (h.length === 3) h = h.split('').map(c => c + c).join('');
                const r = parseInt(h.substring(0, 2), 16) || 0;
                const g = parseInt(h.substring(2, 4), 16) || 0;
                const b = parseInt(h.substring(4, 6), 16) || 0;
                img.element.style.setProperty('background-color', `rgba(${r}, ${g}, ${b}, 0.32)`, 'important');
                img.element.style.setProperty('border-left-color', selColor, 'important');
            }
        } else {
            img.element.style.removeProperty('background-color');
            img.element.style.removeProperty('border-left-color');
        }
    });
    const listActions = document.getElementById('list-selection-actions');
    if(listActions) listActions.style.display = selectedIndices.size > 0 ? 'flex' : 'none';
    // 👁️ Hide / 🎯 Focus sit next to the image counter (same spot as 👁️‍🗨️ Unhide / 🔀 Invert)
    const hfActions = document.getElementById('list-hidefocus-actions');
    if(hfActions) hfActions.style.display = selectedIndices.size > 0 ? 'inline-flex' : 'none';
}

window.refreshListStatus = function() {
    imageFiles.forEach(img => {
        if (!img.element) return;
        const span = img.element.querySelector('.list-item-type');
        if (span) span.textContent = window.buildTypeBadge(img);
        if (img.hasFile) img.element.classList.add('has-data');
        img.element.classList.remove('is-nl');
    });
    window.updateListSelectionVisuals();
}

window.saveActiveSelectedImages = async function(silent = false) {
    if (!window.currentImagesHandle && !window.rootHandle || selectedIndices.size === 0) return;
    let savedCount = 0;
    const promises = Array.from(selectedIndices).map(async (idx) => {
        const img = imageFiles[idx];
        if (img.hasFile && img.dirty) {
            const ok = await window.saveImageToDisk(img);
            if (ok) savedCount++;
        }
    });
    await Promise.all(promises);
    if(savedCount > 0) window.markDatasetEdited();
    if(!silent) window.showAlert(savedCount > 0 ? `Saved ${savedCount} file(s) with pending changes.` : `No pending changes to save in the current selection.`);
}

window.saveAllImages = async function(silent = false) {
    if (!window.currentImagesHandle && !window.rootHandle || imageFiles.length === 0) return;
    let savedCount = 0;
    const promises = imageFiles.map(async (img) => {
        if (img.hasFile && img.dirty) {
            const ok = await window.saveImageToDisk(img);
            if (ok) savedCount++;
        }
    });
    await Promise.all(promises);
    if(savedCount > 0) window.markDatasetEdited();
    if(!silent) window.showAlert(savedCount > 0 ? `Saved ${savedCount} file(s) with pending changes.` : `No pending changes to save.`);
}

window.hideSelectedImages = function() {
    if (selectedIndices.size === 0) return;

    let hiddenCount = 0;
    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        if (!img.hidden) {
            img.hidden = true;
            window.hiddenImagesStore.add(img.baseName);
            if (img.element) img.element.classList.remove('selected');
            hiddenCount++;
        }
    });

    window.updateUnhideButton();
    window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    window.updateListSelectionVisuals();

    window.showAlert(`Hid ${hiddenCount} image(s). Use 👁️‍🗨️ Unhide to restore.`, "success");
};

window.unhideAllImages = function() {
    let changed = false;
    imageFiles.forEach(img => {
        if (img.hidden) { img.hidden = false; changed = true; }
    });
    window.hiddenImagesStore.clear();
    if (changed) {
        // No Modo Compacto (🗂️), grupos colapsados continuariam escondendo as
        // imagens reveladas — limpa o estado de colapso.
        if (window._compactCollapsedGroups && typeof window._compactCollapsedGroups.clear === 'function') {
            window._compactCollapsedGroups.clear();
        }
        window.updateUnhideButton();
        window.renderImageList();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.applyFilters === 'function') window.applyFilters();
        window.updateListSelectionVisuals();

        if (selectedIndices.size === 0 && imageFiles.length > 0) {
            window.handleListClick(0, false, false);
        }
    }
};

window.updateUnhideButton = function() {
    const btn = document.getElementById('btn-unhide-all');
    const hasHidden = window.hiddenImagesStore.size > 0 || imageFiles.some(img => img.hidden);
    if (btn) btn.style.display = hasHidden ? 'inline-block' : 'none';
    const inv = document.getElementById('btn-invert-hidden');
    if (inv) inv.style.display = hasHidden ? 'inline-block' : 'none';
};

/* 🔀 Invert (next to 👁️‍🗨️ Unhide, after Hide / Focus): the hidden images come
   back and the ones that were visible are hidden. */
window.invertHiddenImages = function() {
    if (!imageFiles.some(img => img.hidden)) return;
    let shown = 0, hidden = 0;
    imageFiles.forEach((img, i) => {
        if (img.hidden) {
            img.hidden = false;
            window.hiddenImagesStore.delete(img.baseName);
            shown++;
        } else {
            img.hidden = true;
            window.hiddenImagesStore.add(img.baseName);
            if (img.element) img.element.classList.remove('selected');
            selectedIndices.delete(i);
            hidden++;
        }
    });
    if (window._compactCollapsedGroups && typeof window._compactCollapsedGroups.clear === 'function') window._compactCollapsedGroups.clear();
    window.updateUnhideButton();
    window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    window.updateListSelectionVisuals();
    window.showAlert(`Inverted: ${shown} image(s) shown, ${hidden} hidden.`, "success");
};

window.enterFocusMode = function() {
    if (selectedIndices.size === 0) { window.showAlert("Select at least one image first!", "warn"); return; }

    const keepVisible = new Set(Array.from(selectedIndices).map(i => imageFiles[i].baseName));
    let hiddenCount = 0;

    imageFiles.forEach(img => {
        if (!keepVisible.has(img.baseName) && !img.hidden) {
            img.hidden = true;
            window.hiddenImagesStore.add(img.baseName);
            if (img.element) img.element.classList.remove('selected');
            hiddenCount++;
        }
    });

    window.updateUnhideButton();
    window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    window.updateListSelectionVisuals();

    window.showAlert(`Focus mode: hid ${hiddenCount} other image(s). Use 👁️‍🗨️ Unhide to restore.`, "success");
};

window.openRenameModal = function() {
    if(selectedIndices.size === 0) return;
    const idx = Array.from(selectedIndices)[0];
    document.getElementById('rename-input').value = imageFiles[idx].baseName;
    document.getElementById('rename-dropdown').classList.add('open');
    document.getElementById('rename-input').focus();
}

/* ---------------------------------------------------------------------
   RENAME SEGURO (v3 — staging em 2 fases)
   ---------------------------------------------------------------------
   v2 copiava cada arquivo para "_rename_cache" e escrevia o novo nome
   logo em seguida, um arquivo por vez. Num rename múltiplo, o nome NOVO
   de um arquivo podia ser o nome ANTIGO de outro do mesmo lote que ainda
   não tinha sido processado (ex: ordem manual [x_002, x_001] renomeada
   para "x" → x_002 vira x_001 e sobrescreve o x_001 original antes dele
   ter sido copiado). Resultado: imagem perdida.

   v3:
   0) Planeja todos os nomes; rejeita nomes de destino repetidos.
   1) Checa colisão com arquivos FORA do lote (pede confirmação).
   2) FASE A — copia TODOS os originais do lote (imagem + legenda) para
      "_rename_cache". Se qualquer cópia falhar, para tudo (nada foi
      apagado ainda). Só depois remove os originais da pasta principal.
   3) FASE B — escreve cada arquivo com o nome final a partir da cópia
      staged e apaga a cópia. Se algo falhar, o original continua dentro
      de "_rename_cache".
--------------------------------------------------------------------- */
async function _copyFileInto(srcDir, srcName, dstDir, dstName) {
    const srcFile = await (await srcDir.getFileHandle(srcName)).getFile();
    const dstHandle = await dstDir.getFileHandle(dstName, { create: true });
    const w = await dstHandle.createWritable();
    await w.write(await srcFile.arrayBuffer());
    await w.close();
}

async function _fileExists(dirHandle, name) {
    try { await dirHandle.getFileHandle(name); return true; } catch (e) { return false; }
}

/* Progress counter on a toolbar button ("⏳ i/N"), the same one the other
   functions use (Archive, Auto Bucket...). done() puts the icon back. */
function _btnProgress(onclickName, fallbackId) {
    const btn = (fallbackId && document.getElementById(fallbackId)) || document.querySelector(`button[onclick*="${onclickName}"]`);
    const orig = btn ? btn.textContent : '';
    const origTitle = btn ? btn.title : '';
    return {
        set(i, n, label) {
            if (!btn) return;
            btn.disabled = true;
            btn.textContent = `⏳ ${i}/${n}`;
            btn.title = (label || 'Working') + ` — ${i} of ${n}`;
        },
        done() { if (btn) { btn.disabled = false; btn.textContent = orig; btn.title = origTitle; } }
    };
}

window.confirmRename = async function() {
    if(selectedIndices.size === 0) return;
    const newBaseName = document.getElementById('rename-input').value.trim();
    if (!newBaseName) { document.getElementById('rename-dropdown').classList.remove('open'); return; }
    if (/[\\/:*?"<>|]/.test(newBaseName)) {
        window.showAlert('The name contains characters that are not allowed in file names: \\ / : * ? " < > |', 'error');
        return;
    }

    document.getElementById('rename-dropdown').classList.remove('open');
    const indices = Array.from(selectedIndices).sort((a,b) => a - b);
    const isMulti = indices.length > 1;

    // ---------- FASE 0: planeja todos os nomes de destino ----------
    const plans = [];
    {
        let count = 1;
        for (let idx of indices) {
            const img = imageFiles[idx];
            const oldExt = img.name.split('.').pop();
            const paddedCount = String(count).padStart(3, '0');
            const finalBaseName = isMulti ? `${newBaseName}_${paddedCount}` : newBaseName;
            const newImgName = `${finalBaseName}.${oldExt}`;
            const textFormat = img.ext || 'txt';
            const oldTextName = `${img.baseName}.${textFormat}`;
            const newTextName = `${finalBaseName}.${textFormat}`;
            plans.push({ idx, img, oldName: img.name, newImgName, oldTextName, newTextName, finalBaseName, textFormat });
            count++;
        }
    }
    const activePlans = plans.filter(p => !(p.oldName === p.newImgName && p.oldTextName === p.newTextName));
    if (activePlans.length === 0) return;

    // Dois arquivos do lote não podem terminar com o mesmo nome (ex: a.png e a.jpg → "x" ok, mas a.png e b.png → "x.png" duas vezes).
    {
        const seen = new Map();
        for (const p of plans) {
            const key = (p.img.parentDirHandle && p.img.parentDirHandle.name || '') + '/' + p.newImgName.toLowerCase();
            if (seen.has(key)) {
                window.showAlert(`Two selected images would get the same name "${p.newImgName}". Nothing was renamed.`, 'error');
                return;
            }
            seen.set(key, true);
        }
    }

    // ⏳ Background task from here on: keeps this dataset's folder / config / stores, so it finishes even if
    // another dataset is opened meanwhile.
    const _ctx = window.TM.tasks.captureDataset();
    _ctx.files = activePlans.map(p => p.img);
    const cfg = _ctx.config, pStore = _ctx.pending, hStore = window.hiddenImagesStore;
    return window.TM.tasks.run({ title: `Rename ${activePlans.length} image(s)`, icon: '✏️', ctx: _ctx, silentEnd: true }, async (task) => {
    // ---------- FASE 1: checagem de colisão contra arquivos FORA do lote ----------
    const oldNamesInBatch = new Set();
    plans.forEach(p => { oldNamesInBatch.add(p.oldName); oldNamesInBatch.add(p.oldTextName); });

    const dirListingCache = new Map(); // parentDirHandle -> Set(nomes existentes)
    async function listExistingNames(dirHandle) {
        if (dirListingCache.has(dirHandle)) return dirListingCache.get(dirHandle);
        const names = new Set();
        try { for await (const entry of dirHandle.values()) names.add(entry.name); } catch(e) {}
        dirListingCache.set(dirHandle, names);
        return names;
    }

    const collisions = [];
    for (const p of activePlans) {
        const existing = await listExistingNames(p.img.parentDirHandle);
        if (p.newImgName !== p.oldName && existing.has(p.newImgName) && !oldNamesInBatch.has(p.newImgName)) {
            collisions.push(p.newImgName);
        }
        if (p.img.hasFile && p.newTextName !== p.oldTextName && existing.has(p.newTextName) && !oldNamesInBatch.has(p.newTextName)) {
            collisions.push(p.newTextName);
        }
    }

    if (collisions.length > 0) {
        const preview = [...new Set(collisions)].slice(0, 5).join(', ');
        const more = collisions.length > 5 ? ` (+${collisions.length - 5} more)` : '';
        if (!confirm(`⚠️ WARNING: ${collisions.length} target filename(s) already exist in this folder and are NOT part of the images you're renaming:\n${preview}${more}\n\nContinuing would OVERWRITE and PERMANENTLY LOSE the content of those existing files.\n\nClick Cancel to pick a different name/prefix instead. Continue anyway and overwrite them?`)) {
            return;
        }
    }

    const cacheDirByParent = new Map();
    async function getCacheDir(parentDirHandle) {
        if (cacheDirByParent.has(parentDirHandle)) return cacheDirByParent.get(parentDirHandle);
        const cacheDir = await parentDirHandle.getDirectoryHandle('_rename_cache', { create: true });
        cacheDirByParent.set(parentDirHandle, cacheDir);
        return cacheDir;
    }

    const prog = _btnProgress('openRenameModal');
    const total = activePlans.length;
    try {
    // ---------- FASE A: copia TODOS os originais do lote para o staging ----------
    let stepA = 0;
    for (const p of activePlans) {
        prog.set(++stepA, total, 'Rename: backing up the originals'); task.progress(stepA, total * 2, 'backing up');
        try {
            p.cacheDir = await getCacheDir(p.img.parentDirHandle);
            await _copyFileInto(p.img.parentDirHandle, p.oldName, p.cacheDir, p.oldName);
            p.stagedImg = true;
            if (await _fileExists(p.img.parentDirHandle, p.oldTextName)) {
                await _copyFileInto(p.img.parentDirHandle, p.oldTextName, p.cacheDir, p.oldTextName);
                p.stagedText = true;
            }
        } catch (e) {
            console.error('Rename staging error:', e);
            window.showAlert(`⚠️ Could not back up "${p.oldName}" before renaming. Nothing was renamed or deleted.`, 'error');
            return;
        }
    }

    // Todos os originais têm cópia segura — agora libera os nomes antigos na pasta principal.
    for (const p of activePlans) {
        try { await p.img.parentDirHandle.removeEntry(p.oldName); } catch(e) {}
        if (p.stagedText) { try { await p.img.parentDirHandle.removeEntry(p.oldTextName); } catch(e) {} }
    }

    // ---------- FASE B: escreve os nomes finais a partir das cópias staged ----------
    let renamedCount = 0;
    let failedCount = 0;
    let stepB = 0;
    for (const p of activePlans) {
        const { img, oldName, newImgName, newTextName, finalBaseName, textFormat, cacheDir } = p;
        prog.set(++stepB, total, 'Renaming'); task.progress(total + stepB, total * 2, 'renaming');
        try {
            await _copyFileInto(cacheDir, oldName, img.parentDirHandle, newImgName);

            // Legenda com o conteúdo ATUAL em memória (img.content), para não
            // perder edições ainda não salvas (img.dirty).
            if (img.hasFile) {
                const _enc = window.NLCodec ? window.NLCodec.encode(img.content) : { text: img.content, map: [] };
                p.nlMap = _enc.map;
                const contentToWrite = textFormat === 'json'
                    ? JSON.stringify({ tags: _enc.text }, null, 2)
                    : _enc.text;
                const newTextHandle = await img.parentDirHandle.getFileHandle(newTextName, { create: true });
                const writableText = await newTextHandle.createWritable();
                await writableText.write(contentToWrite);
                await writableText.close();
                if (typeof window.markClean === 'function') window.markClean(img);
            } else if (p.stagedText) {
                await _copyFileInto(cacheDir, p.oldTextName, img.parentDirHandle, newTextName);
            }

            // Rename concluído — limpa a cópia de staging deste arquivo.
            try { await cacheDir.removeEntry(oldName); } catch(e) {}
            if (p.stagedText) { try { await cacheDir.removeEntry(p.oldTextName); } catch(e) {} }

            if (cfg[img.baseName]) {
                cfg[finalBaseName] = cfg[img.baseName];
                if (img.baseName !== finalBaseName) delete cfg[img.baseName];
            }
            if (p.nlMap && window.NLCodec) {
                await window.NLCodec.moveEntries(img.parentDirHandle, img.baseName, finalBaseName, p.nlMap);
                if (cfg[finalBaseName]) delete cfg[finalBaseName].nl;
            }
            // Renomear reorganiza a lista: limpa a ordem manual (A-Z / grupos de cor reagrupam sozinhos).
            if (cfg[finalBaseName] && typeof cfg[finalBaseName].order === 'number') {
                delete cfg[finalBaseName].order;
            }
            if (pStore[img.baseName]) {
                pStore[finalBaseName] = pStore[img.baseName];
                if (img.baseName !== finalBaseName) delete pStore[img.baseName];
            }
            if (hStore.has(img.baseName)) {
                hStore.delete(img.baseName);
                hStore.add(finalBaseName);
            }
            img.name = newImgName; img.baseName = finalBaseName;
            renamedCount++;
        } catch(e) {
            console.error("Rename Error:", e);
            failedCount++;
        }
    }

    if (failedCount > 0 && window.showAlert) {
        window.showAlert(`⚠️ ${failedCount} file(s) could not be renamed — the originals are safely kept in the "_rename_cache" folder, nothing was lost.`, 'error', 8000);
    }

    const here = await window.TM.tasks.isCurrent(_ctx.handle);
    if(renamedCount > 0) {
        if (here) await window.markDatasetEdited();
        else { cfg.lastEdited = new Date().toLocaleString(); await window.saveDatasetConfig(_ctx.handle, cfg, _ctx.files); }
        if (typeof window.savePendingTagsStore === 'function') await window.savePendingTagsStore(_ctx.handle, pStore);
        if (failedCount === 0) window.showAlert(`Renamed ${renamedCount} files!`, "success");
    }
    task.result = `${renamedCount} renamed${failedCount ? `, ${failedCount} failed` : ''}`;
    if (here && (renamedCount > 0 || failedCount > 0) && typeof window.refreshDataset === 'function') await window.refreshDataset();
    } finally { prog.done(); }
    }).promise;
}

window.openCloneModal = function() {
    if (selectedIndices.size === 0) { window.showAlert("Select at least one image first!", "warn"); return; }
    document.getElementById('clone-count-input').value = 1;
    document.getElementById('clone-dropdown').classList.add('open');
    document.getElementById('clone-count-input').focus();
    document.getElementById('clone-count-input').select();
}

window.confirmClone = async function() {
    if (selectedIndices.size === 0) { document.getElementById('clone-dropdown').classList.remove('open'); return; }

    const count = parseInt(document.getElementById('clone-count-input').value, 10);
    document.getElementById('clone-dropdown').classList.remove('open');
    if (!count || count < 1) return;

    const indices = Array.from(selectedIndices);
    let clonedCount = 0;

    const _ctx = window.TM.tasks.captureDataset();
    _ctx.files = indices.map(i => imageFiles[i]);
    const cfg = _ctx.config;
    const allNames = imageFiles.map(f => f.baseName);
    return window.TM.tasks.run({ title: `Clone ${indices.length} image(s) ×${count}`, icon: '📋', ctx: _ctx, silentEnd: true }, async (task) => {
    const existingBaseNames = new Set(allNames);
    const prog = _btnProgress('openCloneModal');
    const total = indices.length * count;
    let step = 0;
    try {
    for (const img of _ctx.files) {
        if (task.cancelled) break;
        const oldExt = img.name.substring(img.name.lastIndexOf('.') + 1);

        for (let n = 1; n <= count; n++) {
            prog.set(++step, total, 'Copying'); task.progress(step, total);
            let paddedN = String(n).padStart(3, '0');
            let newBaseName = `${img.baseName}_${paddedN}`;
            let bump = 1;
            while (existingBaseNames.has(newBaseName) || await _fileExists(img.parentDirHandle, `${newBaseName}.${oldExt}`)) {
                bump++;
                let paddedBump = String(bump).padStart(3, '0');
                newBaseName = `${img.baseName}_${paddedN}_${paddedBump}`;
            }
            existingBaseNames.add(newBaseName);
            const newImgName = `${newBaseName}.${oldExt}`;

            try {
                const imgFile = await img.handle.getFile();
                const newImgHandle = await img.parentDirHandle.getFileHandle(newImgName, { create: true });
                const writableImg = await newImgHandle.createWritable();
                await writableImg.write(await imgFile.arrayBuffer());
                await writableImg.close();

                if (img.hasFile) {
                    const textFormat = img.ext || 'txt';
                    const newTextName = `${newBaseName}.${textFormat}`;
                    try {
                        // Conteúdo ATUAL em memória (inclui edições ainda não salvas).
                        const _enc = window.NLCodec ? window.NLCodec.encode(img.content) : { text: img.content, map: [] };
                        img._cloneNlMap = _enc.map;
                        const contentToWrite = textFormat === 'json'
                            ? JSON.stringify({ tags: _enc.text }, null, 2)
                            : _enc.text;
                        const newTextHandle = await img.parentDirHandle.getFileHandle(newTextName, { create: true });
                        const writableText = await newTextHandle.createWritable();
                        await writableText.write(contentToWrite);
                        await writableText.close();
                    } catch (e) {}
                }

                {
                    cfg[newBaseName] = { ...(cfg[img.baseName] || {}) };
                    delete cfg[newBaseName].order; // clone entra na ordenação alfabética normal
                    // 📋 "Copy" seal (badge in the list; the 📋 button can remove / duplicate the copies later)
                    cfg[newBaseName].isCopy = true;
                    cfg[newBaseName].copyOf = (cfg[img.baseName] && cfg[img.baseName].copyOf) || img.baseName;
                }
                if (img._cloneNlMap && img._cloneNlMap.length && window.NLCodec) {
                    await window.NLCodec.setEntries(img.parentDirHandle, newBaseName, img._cloneNlMap);
                }
                if (cfg[newBaseName]) delete cfg[newBaseName].nl;
                delete img._cloneNlMap;
                clonedCount++;
            } catch (e) { console.error("Clone Error:", e); }
        }
    }
    } finally { prog.done(); }

    task.result = `${clonedCount} file(s) cloned`;
    if (clonedCount > 0) {
        const here = await window.TM.tasks.isCurrent(_ctx.handle);
        if (typeof window.saveDatasetConfig === 'function') await window.saveDatasetConfig(_ctx.handle, cfg, _ctx.files);
        if (here) await window.markDatasetEdited();
        window.showAlert(`Cloned ${clonedCount} file(s)!`, "success");
        if (here && typeof window.refreshDataset === 'function') await window.refreshDataset();
    }
    }).promise;
}
