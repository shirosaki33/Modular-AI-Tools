/* =========================================================================
   PIN IMAGE MODULE (Standalone — não mexe nos outros arquivos)
   ---------------------------------------------------------------------
   Permite "fixar" (pin) uma imagem da lista do Dataset. Ela passa a
   aparecer sempre num painel próprio, à esquerda do painel "Dataset",
   com preview grande + lista de tags dela.

   - Continua fixada mesmo trocando de pasta/dataset.
   - As tags mostradas ali são SOMENTE leitura: só podem ser copiadas
     para a imagem ativa / para todas.
   - Um ícone 📌 é injetado em cada item da lista (hook pós-render).
========================================================================= */

(function () {

    /* ---------- ESTADO GLOBAL ---------- */
    // { baseName, name, url, content, ext, parentDirHandle, folderName }
    window.pinnedImage = window.pinnedImage || null;
    window._pinnedSelectedTags = window._pinnedSelectedTags || new Set();
    window._lastPinnedIndex = window._lastPinnedIndex || 0;

    /* ---------- CSS ---------- */
    const style = document.createElement('style');
    style.innerHTML = `
        #col-pinned {
            width: 230px; flex-shrink: 0; display: none;
        }
        #pinned-image-wrap {
            padding: 12px; display: flex; flex-direction: column; gap: 8px;
            flex: 1; min-height: 0; overflow: hidden;
        }
        #pinned-image-preview-box {
            border-radius: 8px; overflow: hidden; background: #0d0d0d;
            border: 1px solid #222; display: flex; align-items: center; justify-content: center;
            flex-shrink: 0;
        }
        #pinned-image-preview { width: 100%; max-height: 220px; object-fit: contain; display: block; background: #0d0d0d; }
        #pinned-image-name { font-size: 11px; color: #9ecfff; word-break: break-all; text-align: center; font-weight: bold; flex-shrink: 0; }
        #pinned-image-folder { font-size: 10px; color: #666; text-align: center; margin-top: -4px; flex-shrink: 0; }
        #pinned-tags-title { font-size: 11px; color: #888; text-transform: uppercase; font-weight: bold; margin-top: 6px; letter-spacing: 0.5px; flex-shrink: 0; }
        #pinned-tags-hint { font-size: 10px; color: #555; margin-top: -4px; margin-bottom: 2px; flex-shrink: 0; }
        /* Só a lista de tags rola; foto/nome fixos em cima e botões fixos embaixo. */
        #pinned-tags-scroll { flex: 1; min-height: 0; overflow-y: auto; }
        #pinned-tags-list { display: flex; flex-direction: column; gap: 0; background: #111; border-radius: 6px; }
        .pinned-tag-row { border-radius: 0; cursor: pointer; }
        .pinned-tag-row.is-nl .tag-name { color: #b890ff; }
        #pinned-selection-actions { display: none; gap: 6px; margin-top: 4px; flex-shrink: 0; }
        #pinned-selection-actions .btn-multi { padding: 7px; font-size: 10px; }

        .list-pin-btn {
            background: transparent; border: none; color: #444; font-size: 15px; cursor: pointer;
            padding: 2px 4px; flex-shrink: 0; border-radius: 4px; line-height: 1;
        }
        .list-pin-btn:hover { color: #00ff99; transform: scale(1.1); }
        .list-pin-btn.pinned-active { color: #00ff99; text-shadow: 0 0 6px rgba(0,255,153,0.6); }

        #image-list.grid-mode .list-pin-btn {
            position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.55);
            border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center;
            justify-content: center; font-size: 12px;
        }

        #resizer-pinned { display: none; }
    `;
    document.head.appendChild(style);

    /* ---------- CRIA O PAINEL (à esquerda do painel Dataset) ---------- */
    function buildPanel() {
        if (document.getElementById('col-pinned')) return;

        const panel = document.createElement('div');
        panel.id = 'col-pinned';
        panel.className = 'panel';
        panel.innerHTML = `
            <div class="panel-header">
                <span>📌 Pinned Image</span>
                <button id="btn-unpin-image" title="Unpin image" style="background:transparent; border:none; color:#ff6060; font-size:16px; cursor:pointer; padding:0 4px;">✖</button>
            </div>
            <div id="pinned-image-wrap">
                <div id="pinned-image-preview-box"><img id="pinned-image-preview" src=""></div>
                <div id="pinned-image-name"></div>
                <div id="pinned-image-folder"></div>
                <div id="pinned-tags-title">Tags (select, then Add / Add to All)</div>
                <div id="pinned-tags-hint">Read-only here — cannot be edited or removed from this panel</div>
                <div id="pinned-tags-scroll"><div id="pinned-tags-list"></div></div>
                <div id="pinned-selection-actions" style="align-items:center;">
                    <select id="pinned-add-pos" class="pos-select" title="Position when adding these tags" style="flex:0 0 auto;"><option value="bottom">Bot</option><option value="top">Top</option></select>
                    <button class="btn-multi btn-add-all" onclick="window.addPinnedSelectedTagsTo('selected')">➕ Add</button>
                    <button class="btn-multi btn-add-all" onclick="window.addPinnedSelectedTagsTo('all')">➕ Add to All</button>
                </div>
            </div>
        `;

        const resizer = document.createElement('div');
        resizer.id = 'resizer-pinned';
        resizer.className = 'resizer vertical';
        resizer.title = 'Drag to resize the Pinned panel';

        const colList = document.getElementById('col-list');
        const workspace = document.getElementById('view-editor');
        if (workspace && colList) {
            workspace.insertBefore(panel, colList);
            workspace.insertBefore(resizer, colList);
        } else if (workspace) {
            workspace.insertBefore(panel, workspace.firstChild);
            workspace.insertBefore(resizer, panel.nextSibling);
        }

        document.getElementById('btn-unpin-image').onclick = () => window.unpinImage();

        setupPinnedResizer(panel, resizer);
        loadPinnedPanelWidth(panel);
    }

    /* ---------- RESIZER ---------- */
    function setupPinnedResizer(panel, resizer) {
        if (resizer.__pinResizerInit) return;
        resizer.__pinResizerInit = true;

        let isDragging = false;
        let startX = 0;
        let startWidth = 0;
        let rafPending = false;

        resizer.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startWidth = panel.getBoundingClientRect().width;
            document.body.classList.add('is-resizing');
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            if (rafPending) return;
            rafPending = true;
            requestAnimationFrame(() => {
                let newWidth = startWidth + (e.clientX - startX);
                if (newWidth < 160) newWidth = 160;
                if (newWidth > 500) newWidth = 500;
                panel.style.width = newWidth + 'px';
                rafPending = false;
            });
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                document.body.classList.remove('is-resizing');
                if (panel.style.width && typeof window.saveSetting === 'function') {
                    window.saveSetting('pinned-panel-width', panel.style.width);
                }
            }
            isDragging = false;
        });
    }

    async function loadPinnedPanelWidth(panel) {
        if (typeof window.getSetting !== 'function') return;
        const saved = await window.getSetting('pinned-panel-width', '230px');
        if (saved) panel.style.width = saved;
    }

    /* ---------- HELPERS ---------- */
    function isSameImage(a, b) {
        if (!a || !b) return false;
        return a.parentDirHandle === b.parentDirHandle && a.baseName === b.baseName;
    }

    window.isImagePinned = function (img) {
        return isSameImage(window.pinnedImage, img);
    };

    /* O pin usa uma blob URL PRÓPRIA (cópia), porque a URL da lista é
       revogada sempre que o dataset é recarregado ou o Archive reaberto.
       Ela só é revogada quando a imagem é desafixada ou substituída. */
    window._pinnedOwnUrl = window._pinnedOwnUrl || null;

    window.pinImage = async function (img) {
        if (!img) return;
        if (window.isImagePinned(img)) { window.unpinImage(); return; }

        window._pinnedSelectedTags.clear();

        let pinnedUrl = img.url;
        try {
            const res = await fetch(img.url);
            const blob = await res.blob();
            pinnedUrl = URL.createObjectURL(blob);
        } catch (e) {
            pinnedUrl = img.url;
        }

        if (window._pinnedOwnUrl) { try { URL.revokeObjectURL(window._pinnedOwnUrl); } catch (e) {} }
        window._pinnedOwnUrl = (pinnedUrl !== img.url) ? pinnedUrl : null;

        window.pinnedImage = {
            baseName: img.baseName,
            name: img.name,
            url: pinnedUrl,
            content: img.content,
            ext: img.ext,
            parentDirHandle: img.parentDirHandle,
            folderName: (window.currentImagesHandle && window.currentImagesHandle.name)
                || (window.rootHandle && window.rootHandle.name) || ''
        };
        renderPinnedPanel();
        refreshPinButtonsHighlight();
        if (window.showAlert) window.showAlert(`📌 Pinned "${img.name}"`, 'success');
    };

    window.unpinImage = function () {
        if (!window.pinnedImage) return;
        if (window._pinnedOwnUrl) { try { URL.revokeObjectURL(window._pinnedOwnUrl); } catch (e) {} window._pinnedOwnUrl = null; }
        window.pinnedImage = null;
        window._pinnedSelectedTags.clear();
        renderPinnedPanel();
        refreshPinButtonsHighlight();
    };

    function renderPinnedPanel() {
        buildPanel();
        const panelEl = document.getElementById('col-pinned');
        if (!panelEl) return;
        const p = window.pinnedImage;

        const resizerEl = document.getElementById('resizer-pinned');
        if (!p) {
            panelEl.style.display = 'none';
            if (resizerEl) resizerEl.style.display = 'none';
            return;
        }
        panelEl.style.display = 'flex';
        if (resizerEl) resizerEl.style.display = 'flex';

        const previewImg = document.getElementById('pinned-image-preview');
        if (previewImg.src !== p.url) previewImg.src = p.url;
        document.getElementById('pinned-image-name').textContent = p.name;
        document.getElementById('pinned-image-folder').textContent = p.folderName ? `📂 ${p.folderName}` : '';

        const tagsContainer = document.getElementById('pinned-tags-list');
        tagsContainer.innerHTML = '';

        const tags = (p.content || '').split(',').map(t => t.trim()).filter(Boolean);

        Array.from(window._pinnedSelectedTags).forEach(t => { if (!tags.includes(t)) window._pinnedSelectedTags.delete(t); });

        if (tags.length === 0) {
            tagsContainer.innerHTML = '<div style="color:#555; font-size:11px; padding:6px 0;">No tags on this image.</div>';
            updatePinnedSelectionActions();
            return;
        }

        tags.forEach((tag, index) => {
            const isNL = tag.startsWith('NL:');
            const displayTag = isNL ? tag.replace('NL:', '').replace(/，/g, ', ') : tag;

            const item = document.createElement('div');
            item.className = 'master-tag-item pinned-tag-row' + (isNL ? ' is-nl' : '');
            if (window._pinnedSelectedTags.has(tag)) item.classList.add('selected-master');
            item.title = 'Select, then use Add / Add to All below';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'tag-name';
            nameSpan.textContent = displayTag; // texto puro: nunca interpreta HTML da legenda
            item.appendChild(nameSpan);

            item.onclick = (e) => {
                if (e.shiftKey && window._pinnedSelectedTags.size > 0) {
                    const start = Math.min(window._lastPinnedIndex, index);
                    const end = Math.max(window._lastPinnedIndex, index);
                    window._pinnedSelectedTags.clear();
                    for (let i = start; i <= end; i++) window._pinnedSelectedTags.add(tags[i]);
                } else if (e.ctrlKey || e.metaKey) {
                    if (window._pinnedSelectedTags.has(tag)) window._pinnedSelectedTags.delete(tag);
                    else window._pinnedSelectedTags.add(tag);
                    window._lastPinnedIndex = index;
                } else {
                    if (window._pinnedSelectedTags.has(tag) && window._pinnedSelectedTags.size === 1) {
                        window._pinnedSelectedTags.clear();
                    } else {
                        window._pinnedSelectedTags.clear();
                        window._pinnedSelectedTags.add(tag);
                        window._lastPinnedIndex = index;
                    }
                }
                renderPinnedPanel();
            };

            tagsContainer.appendChild(item);
        });

        updatePinnedSelectionActions();
    }

    function updatePinnedSelectionActions() {
        const bar = document.getElementById('pinned-selection-actions');
        if (bar) bar.style.display = window._pinnedSelectedTags.size > 0 ? 'flex' : 'none';
    }

    window.addPinnedSelectedTagsTo = function (target) {
        if (window._pinnedSelectedTags.size === 0) return;
        const tagsToAdd = Array.from(window._pinnedSelectedTags);
        const posSelect = document.getElementById('pinned-add-pos');
        const pos = posSelect ? posSelect.value : 'bottom';

        if (target === 'selected') {
            if (typeof selectedIndices === 'undefined' || selectedIndices.size === 0) {
                if (window.showAlert) window.showAlert('Select an active image first!', 'warn');
                return;
            }
            tagsToAdd.forEach(tag => { if (typeof addTagToSelected === 'function') addTagToSelected(tag, pos); });
            if (window.showAlert) window.showAlert(`Added ${tagsToAdd.length} tag(s) from the pinned image.`, 'success');
        } else if (target === 'all') {
            tagsToAdd.forEach(tag => { if (typeof addTagToAllImages === 'function') addTagToAllImages(tag, pos); });
            if (window.showAlert) window.showAlert(`Added ${tagsToAdd.length} tag(s) to all images.`, 'success');
        }
    };

    /* ---------- BOTÃO DE PIN EM CADA ITEM DA LISTA ---------- */
    function refreshPinButtonsHighlight() {
        if (typeof imageFiles === 'undefined') return;
        imageFiles.forEach(img => {
            if (img.element) {
                const btn = img.element.querySelector('.list-pin-btn');
                if (btn) btn.classList.toggle('pinned-active', window.isImagePinned(img));
            }
        });
    }

    function injectPinButtons() {
        if (typeof imageFiles === 'undefined') return;
        imageFiles.forEach(img => {
            if (!img.element || img.hidden) return;
            let btn = img.element.querySelector('.list-pin-btn');
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'list-pin-btn';
                btn.textContent = '📌';
                btn.onclick = (e) => { e.stopPropagation(); window.pinImage(img); };
                img.element.appendChild(btn);
            }
            btn.title = window.isImagePinned(img) ? 'Unpin this image' : 'Pin this image';
            btn.classList.toggle('pinned-active', window.isImagePinned(img));
        });
    }

    /* ---------- HOOK PÓS-RENDER (via tagmanager_render_hooks.js) ---------- */
    function installPinHook() {
        if (typeof window.registerPostRenderImageList === 'function') {
            window.registerPostRenderImageList(injectPinButtons);
            return;
        }
        if (typeof window.renderImageList !== 'function' || window.renderImageList.__pinWrapped) return;
        const original = window.renderImageList;
        const wrapped = function () {
            original.apply(this, arguments);
            injectPinButtons();
        };
        wrapped.__pinWrapped = true;
        window.renderImageList = wrapped;
    }

    buildPanel();
    installPinHook();

})();
