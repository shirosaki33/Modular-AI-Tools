/* =========================================================================
   REVIEW MODE — TAGS NÃO CONFIRMADAS PELO TAGGER (🚫 ghost tag vermelha)
   ---------------------------------------------------------------------
   Complementa o Review Mode do Batch Tagger.

   - Substitui window.loadPendingTagsStore / savePendingTagsStore para
     também ler/gravar "_pending_remove.json". As duas NUNCA lançam
     exceção (senão loadGallery/loadSubDirN parariam no meio e a lista
     ficaria vazia até F5).
   - Linhas vermelhas em All Dataset Tags são selecionáveis
     (window.masterSelectedPendingRemove); com AND/OR/XOR/NOT ativo, a
     lista "Dataset" é filtrada por img.pendingRemove (wrap de applyFilters).
   - O descarte de sugestões (💡 + 🚫) é feito direto em
     discardAllSuggestions / discardActiveSuggestions (tagmanager_ui_core.js).
   - Nomes de tag entram no HTML como texto puro (textContent).
========================================================================= */

(function () {
    window.pendingRemoveStore = window.pendingRemoveStore || {};
    window.masterSelectedPendingRemove = window.masterSelectedPendingRemove || new Set();
    let _lastSelectedPendingRemoveIndex = 0;

    /* ---------- CSS ---------- */
    const style = document.createElement('style');
    style.innerHTML = `
        .tag-row.tag-ghost-remove, .master-tag-item.tag-ghost-remove {
            border: 1px dashed #ff4444 !important;
            background: rgba(255, 60, 60, 0.05) !important;
            opacity: 1 !important;
        }
        .tag-row.tag-ghost-remove:hover, .master-tag-item.tag-ghost-remove:hover {
            background: rgba(255, 60, 60, 0.12) !important;
        }
        .tag-row.tag-ghost-remove .tag-name, .master-tag-item.tag-ghost-remove .tag-name {
            color: #ff8080 !important;
            font-style: italic;
        }
        .master-tag-item.tag-ghost-remove.ghost-remove-selectable { cursor: pointer; }
        .master-tag-item.tag-ghost-remove.selected-master {
            background: rgba(77, 184, 255, 0.18) !important;
            border: 1px dashed #4db8ff !important;
        }
        .master-tag-item.tag-ghost-remove.selected-master .tag-name {
            color: #cfe9ff !important;
        }
    `;
    document.head.appendChild(style);

    /* ---------- PERSISTÊNCIA ---------- */
    function installStoreWraps() {
        if (typeof window.loadPendingTagsStore === 'function' && !window.loadPendingTagsStore.__pendingRemoveWrapped) {
            const origLoad = window.loadPendingTagsStore;
            const wrappedLoad = async function (dirHandle) {
                try {
                    await origLoad(dirHandle);
                } catch (e) {
                    console.warn('[Review Mode] loadPendingTagsStore (original) failed, continuing:', e);
                }

                window.pendingRemoveStore = {};
                if (!dirHandle) return;
                try {
                    const h = await dirHandle.getFileHandle('_pending_remove.json');
                    const file = await h.getFile();
                    window.pendingRemoveStore = JSON.parse(await file.text());
                } catch (e) {
                    // Arquivo não existe / corrompido / sem permissão — não trava o carregamento.
                }
            };
            wrappedLoad.__pendingRemoveWrapped = true;
            window.loadPendingTagsStore = wrappedLoad;
        }

        if (typeof window.savePendingTagsStore === 'function' && !window.savePendingTagsStore.__pendingRemoveWrapped) {
            const origSave = window.savePendingTagsStore;
            const wrappedSave = async function (dirHandle) {
                try {
                    await origSave(dirHandle);
                } catch (e) {
                    console.warn('[Review Mode] savePendingTagsStore (original) failed, continuing:', e);
                }

                if (!dirHandle) return;
                try {
                    Object.keys(window.pendingRemoveStore).forEach(k => {
                        if (!window.pendingRemoveStore[k] || window.pendingRemoveStore[k].length === 0) delete window.pendingRemoveStore[k];
                    });
                    if (Object.keys(window.pendingRemoveStore).length === 0) {
                        try { await dirHandle.removeEntry('_pending_remove.json'); } catch (e) {}
                        return;
                    }
                    const h = await dirHandle.getFileHandle('_pending_remove.json', { create: true });
                    const writable = await h.createWritable();
                    await writable.write(JSON.stringify(window.pendingRemoveStore, null, 2));
                    await writable.close();
                } catch (e) {
                    console.warn('[Review Mode] Could not save _pending_remove.json:', e);
                }
            };
            wrappedSave.__pendingRemoveWrapped = true;
            window.savePendingTagsStore = wrappedSave;
        }
    }

    function persistPendingRemove() {
        const handle = window.currentImagesHandle || window.rootHandle;
        if (typeof window.savePendingTagsStore === 'function' && handle) window.savePendingTagsStore(handle);
    }

    // Zera a seleção vermelha sempre que o dataset muda (evento do hub).
    function syncPendingRemoveSelectionOnDatasetChange() {
        if (window.masterSelectedPendingRemove.size > 0) window.masterSelectedPendingRemove.clear();
    }
    if (window.TM && window.TM.on) window.TM.on('dataset:loaded', syncPendingRemoveSelectionOnDatasetChange);

    function attachPendingRemoveFlags() {
        if (typeof imageFiles === 'undefined') return;
        imageFiles.forEach(img => {
            if (img.pendingRemove === undefined) {
                img.pendingRemove = (window.pendingRemoveStore && window.pendingRemoveStore[img.baseName])
                    ? window.pendingRemoveStore[img.baseName].slice()
                    : [];
            }
        });
    }

    function splitTags(content) {
        return content ? content.split(',').map(t => t.trim()).filter(Boolean) : [];
    }

    /* ---------- LIMPEZA DA MARCAÇÃO ---------- */
    function stripFromPendingRemove(tag, images) {
        (images || []).forEach(img => {
            if (!img) return;
            if (img.pendingRemove) {
                const i = img.pendingRemove.indexOf(tag);
                if (i > -1) img.pendingRemove.splice(i, 1);
            }
            if (window.pendingRemoveStore && window.pendingRemoveStore[img.baseName]) {
                const arr = window.pendingRemoveStore[img.baseName];
                const i2 = arr.indexOf(tag);
                if (i2 > -1) {
                    arr.splice(i2, 1);
                    if (arr.length === 0) delete window.pendingRemoveStore[img.baseName];
                }
            }
        });
    }

    function installRemovalCleanupWraps() {
        if (typeof window.removeTagFromSelected === 'function' && !window.removeTagFromSelected.__pendingRemoveWrapped) {
            const orig = window.removeTagFromSelected;
            const wrapped = function (tag) {
                const affected = (typeof selectedIndices !== 'undefined' && typeof imageFiles !== 'undefined')
                    ? Array.from(selectedIndices).map(i => imageFiles[i]) : [];
                const result = orig.apply(this, arguments);
                stripFromPendingRemove(tag, affected);
                return result;
            };
            wrapped.__pendingRemoveWrapped = true;
            window.removeTagFromSelected = wrapped;
        }

        if (typeof window.removeSelectedActiveTags === 'function' && !window.removeSelectedActiveTags.__pendingRemoveWrapped) {
            const orig2 = window.removeSelectedActiveTags;
            const wrapped2 = function () {
                const tagsToRemove = (typeof activeSelectedTags !== 'undefined') ? Array.from(activeSelectedTags) : [];
                const affected = (typeof selectedIndices !== 'undefined' && typeof imageFiles !== 'undefined')
                    ? Array.from(selectedIndices).map(i => imageFiles[i]) : [];
                const result = orig2.apply(this, arguments);
                tagsToRemove.forEach(t => stripFromPendingRemove(t, affected));
                return result;
            };
            wrapped2.__pendingRemoveWrapped = true;
            window.removeSelectedActiveTags = wrapped2;
        }

        if (typeof window.globalRemoveTags === 'function' && !window.globalRemoveTags.__pendingRemoveWrapped) {
            const orig3 = window.globalRemoveTags;
            const wrapped3 = function (tagsToRemove) {
                const result = orig3.apply(this, arguments);
                (tagsToRemove || []).forEach(t => stripFromPendingRemove(t, typeof imageFiles !== 'undefined' ? imageFiles : []));
                return result;
            };
            wrapped3.__pendingRemoveWrapped = true;
            window.globalRemoveTags = wrapped3;
        }
    }

    /* ---------- CÁLCULO E AÇÕES ---------- */
    function computeFusedPendingRemoveActive() {
        if (typeof selectedIndices === 'undefined' || typeof imageFiles === 'undefined') return [];
        const fusedTags = new Set();
        selectedIndices.forEach(idx => {
            const img = imageFiles[idx];
            if (img) splitTags(img.content).forEach(c => fusedTags.add(c));
        });
        const fusedRemove = new Set();
        selectedIndices.forEach(idx => {
            const img = imageFiles[idx];
            if (img && img.pendingRemove && img.pendingRemove.length) {
                img.pendingRemove.forEach(t => { if (fusedTags.has(t)) fusedRemove.add(t); });
            }
        });
        return Array.from(fusedRemove).sort();
    }

    function computeMasterPendingRemoveCounts() {
        if (typeof imageFiles === 'undefined') return new Map();
        const counts = new Map();
        imageFiles.forEach(img => {
            if (img.hidden || !img.pendingRemove || !img.pendingRemove.length) return;
            const currentTags = new Set(splitTags(img.content));
            img.pendingRemove.forEach(t => { if (currentTags.has(t)) counts.set(t, (counts.get(t) || 0) + 1); });
        });
        return counts;
    }

    function acceptPendingRemoveActive(tag) {
        if (typeof window.removeTagFromSelected === 'function') window.removeTagFromSelected(tag);
        persistPendingRemove();
    }

    function dismissPendingRemoveActive(tag) {
        const affected = (typeof selectedIndices !== 'undefined' && typeof imageFiles !== 'undefined')
            ? Array.from(selectedIndices).map(i => imageFiles[i]) : [];
        stripFromPendingRemove(tag, affected);
        persistPendingRemove();
        if (typeof window.renderEditor === 'function') window.renderEditor();
    }

    function acceptPendingRemoveGlobal(tag) {
        if (typeof window.globalRemoveTags === 'function') window.globalRemoveTags([tag]);
        window.masterSelectedPendingRemove.delete(tag);
        persistPendingRemove();
    }

    function dismissPendingRemoveGlobal(tag) {
        stripFromPendingRemove(tag, typeof imageFiles !== 'undefined' ? imageFiles : []);
        window.masterSelectedPendingRemove.delete(tag);
        persistPendingRemove();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
    }

    /* ---------- SELEÇÃO DAS TAGS VERMELHAS (só All Dataset Tags) ---------- */
    function togglePendingRemoveSelection(tag, index, sortedTags, e) {
        if (e.shiftKey && window.masterSelectedPendingRemove.size > 0) {
            const start = Math.min(_lastSelectedPendingRemoveIndex, index), end = Math.max(_lastSelectedPendingRemoveIndex, index);
            window.masterSelectedPendingRemove.clear();
            for (let i = start; i <= end; i++) window.masterSelectedPendingRemove.add(sortedTags[i]);
        } else if (e.ctrlKey || e.metaKey) {
            if (window.masterSelectedPendingRemove.has(tag)) window.masterSelectedPendingRemove.delete(tag);
            else window.masterSelectedPendingRemove.add(tag);
            _lastSelectedPendingRemoveIndex = index;
        } else {
            if (window.masterSelectedPendingRemove.has(tag) && window.masterSelectedPendingRemove.size === 1) {
                window.masterSelectedPendingRemove.clear();
            } else {
                window.masterSelectedPendingRemove.clear();
                window.masterSelectedPendingRemove.add(tag);
                _lastSelectedPendingRemoveIndex = index;
            }
        }
    }

    function buildGhostRemoveRow(tag, count, onAccept, onReject, isMaster, index, sortedTags) {
        const row = document.createElement('div');
        row.className = (isMaster ? 'master-tag-item' : 'tag-row') + ' ghost tag-ghost-remove';

        const countHtml = count
            ? `<span style="color:#ff8080; font-size:10px; font-weight:bold; min-width:20px; text-align:left; margin-right:8px; user-select:none;" title="Not detected in ${count} image(s)">${count}</span>`
            : '';
        const leftWrapClass = isMaster ? '' : 'tag-row-left';

        row.innerHTML = `<div class="${leftWrapClass}" style="display:flex; align-items:center; overflow:hidden; flex:1;">
                ${countHtml}<span class="tag-name"></span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="tag-ghost-accept" title="Remove this tag">✓</span>
                <span class="tag-ghost-reject" title="Dismiss — keep the tag as is" style="color: #ff4444; cursor: pointer; font-size: 1.2em; font-weight: bold;">&times;</span>
            </div>`;
        row.querySelector('.tag-name').textContent = tag;

        row.querySelector('.tag-ghost-accept').onclick = (e) => { e.stopPropagation(); onAccept(); };
        row.querySelector('.tag-ghost-reject').onclick = (e) => { e.stopPropagation(); onReject(); };

        if (isMaster) {
            row.classList.add('ghost-remove-selectable');
            row.classList.toggle('selected-master', window.masterSelectedPendingRemove.has(tag));
            row.title = 'Click to select — then use AND/OR/XOR/NOT above to see which images have this tag pending removal.';
            row.onclick = (e) => {
                if (e.target.classList.contains('tag-ghost-accept') || e.target.classList.contains('tag-ghost-reject')) return;
                togglePendingRemoveSelection(tag, index, sortedTags, e);
                injectMasterGhostRemoveSection();
                if (typeof window.applyFilters === 'function') window.applyFilters();
            };
        }

        return row;
    }

    /* ---------- INJEÇÃO E PREVENÇÃO DE DUPLICATAS ---------- */
    function injectActiveGhostRemoveSection() {
        const container = document.getElementById('tag-list-vertical');
        if (!container) return;

        container.querySelectorAll('.ghost-section-remove-label, .tag-ghost-remove').forEach(el => el.remove());

        const tags = computeFusedPendingRemoveActive();
        if (tags.length === 0) return;

        const label = document.createElement('div');
        label.className = 'ghost-section-label ghost-section-remove-label';
        label.style.color = '#ff6060';
        label.textContent = '🚫 Not Detected by Tagger';
        container.appendChild(label);

        tags.forEach(tag => {
            const row = buildGhostRemoveRow(tag, null,
                () => acceptPendingRemoveActive(tag),
                () => dismissPendingRemoveActive(tag),
                false);
            container.appendChild(row);
        });
    }

    function injectMasterGhostRemoveSection() {
        const container = document.getElementById('master-tag-list');
        if (!container) return;

        container.querySelectorAll('.ghost-section-remove-label, .tag-ghost-remove').forEach(el => el.remove());

        if (!window.showGhostTagsInList) return;

        const counts = computeMasterPendingRemoveCounts();
        if (counts.size === 0) return;

        const label = document.createElement('div');
        label.className = 'ghost-section-label ghost-section-remove-label';
        label.style.color = '#ff6060';
        label.textContent = '🚫 Not Detected by Tagger';
        container.appendChild(label);

        const sortedTags = Array.from(counts.keys()).sort();

        Array.from(window.masterSelectedPendingRemove).forEach(t => {
            if (!sortedTags.includes(t)) window.masterSelectedPendingRemove.delete(t);
        });

        sortedTags.forEach((tag, idx) => {
            const row = buildGhostRemoveRow(tag, counts.get(tag),
                () => acceptPendingRemoveGlobal(tag),
                () => dismissPendingRemoveGlobal(tag),
                true, idx, sortedTags);
            container.appendChild(row);
        });
    }

    /* ---------- FILTRO DA LISTA "DATASET" PELAS TAGS VERMELHAS SELECIONADAS ---------- */
    function applyPendingRemoveVisibilityFilter() {
        if (typeof imageFiles === 'undefined') return;
        const selected = window.masterSelectedPendingRemove;
        if (!selected || selected.size === 0) return;

        const totalSelected = selected.size;
        const mode = window.filterMode || 'NONE';

        imageFiles.forEach(img => {
            if (!img.element) return;
            if (img.element.style.display === 'none') return;

            const pending = img.pendingRemove || [];
            let matchCount = 0;
            selected.forEach(t => { if (pending.includes(t)) matchCount++; });

            let visible = true;
            if (mode === 'AND' && matchCount !== totalSelected) visible = false;
            if (mode === 'OR' && matchCount === 0) visible = false;
            if (mode === 'XOR' && matchCount !== 1) visible = false;
            if (mode === 'NOT' && matchCount > 0) visible = false;

            if (!visible) img.element.style.display = 'none';
        });

        if (typeof window.pruneSelectionToVisible === 'function') window.pruneSelectionToVisible();
    }

    function installPendingRemoveFilterWrap() {
        if (typeof window.applyFilters !== 'function' || window.applyFilters.__pendingRemoveFilterWrapped) return;
        const orig = window.applyFilters;
        const wrapped = function () {
            const result = orig.apply(this, arguments);
            try { applyPendingRemoveVisibilityFilter(); } catch (e) { console.warn('[Review Mode] applyPendingRemoveVisibilityFilter failed:', e); }
            return result;
        };
        wrapped.__pendingRemoveFilterWrapped = true;
        window.applyFilters = wrapped;
    }

    /* ---------- HOOKS ---------- */
    function installSuggestVisibilityOverride() {
        if (typeof window.updateSuggestFilterVisibility !== 'function' || window.updateSuggestFilterVisibility.__pendingRemoveOverridden) return;
        window.updateSuggestFilterVisibility = function () {
            const btn = document.getElementById('btn-filter-suggest-img');
            const discardBtn = document.getElementById('btn-discard-suggestions');
            if (typeof imageFiles === 'undefined') return;

            const anyAddPending = imageFiles.some(img => img.pendingAdd && img.pendingAdd.length > 0 && !img.hidden);
            const anyRemovePending = imageFiles.some(img => img.pendingRemove && img.pendingRemove.length > 0 && !img.hidden);
            const anyPending = anyAddPending || anyRemovePending;

            if (btn) {
                if (!anyPending && window.showGhostTagsInList) {
                    window.showGhostTagsInList = false;
                    btn.classList.remove('active');
                    btn.style.color = '';
                    btn.style.borderColor = '';
                }
                btn.style.display = anyPending ? 'inline-flex' : 'none';
            }
            // Botão de discard aparece com QUALQUER pendência (verde ou vermelha).
            if (discardBtn) discardBtn.style.display = anyPending ? 'inline-flex' : 'none';
        };
        window.updateSuggestFilterVisibility.__pendingRemoveOverridden = true;
    }

    function installRenderHooks() {
        if (typeof window.registerPostRenderImageList === 'function') {
            window.registerPostRenderImageList(attachPendingRemoveFlags);
        } else if (typeof window.renderImageList === 'function' && !window.renderImageList.__pendingRemoveWrapped) {
            const orig = window.renderImageList;
            const wrapped = function () {
                orig.apply(this, arguments);
                try { attachPendingRemoveFlags(); } catch (e) { console.warn('[Review Mode] attachPendingRemoveFlags failed:', e); }
            };
            wrapped.__pendingRemoveWrapped = true;
            window.renderImageList = wrapped;
        }

        if (typeof window.registerPostRenderEditor === 'function') {
            window.registerPostRenderEditor(injectActiveGhostRemoveSection);
        } else if (typeof window.renderEditor === 'function' && !window.renderEditor.__pendingRemoveWrapped) {
            const orig2 = window.renderEditor;
            const wrapped2 = function () {
                orig2.apply(this, arguments);
                try { injectActiveGhostRemoveSection(); } catch (e) { console.warn('[Review Mode] injectActiveGhostRemoveSection failed:', e); }
            };
            wrapped2.__pendingRemoveWrapped = true;
            window.renderEditor = wrapped2;
        }

        if (typeof window.registerPostRenderMasterTagList === 'function') {
            window.registerPostRenderMasterTagList(injectMasterGhostRemoveSection);
        } else if (typeof window.renderMasterTagList === 'function' && !window.renderMasterTagList.__pendingRemoveWrapped) {
            const orig3 = window.renderMasterTagList;
            const wrapped3 = function () {
                orig3.apply(this, arguments);
                try { injectMasterGhostRemoveSection(); } catch (e) { console.warn('[Review Mode] injectMasterGhostRemoveSection failed:', e); }
            };
            wrapped3.__pendingRemoveWrapped = true;
            window.renderMasterTagList = wrapped3;
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        installStoreWraps();
        installRemovalCleanupWraps();
        installSuggestVisibilityOverride();
        installRenderHooks();
        installPendingRemoveFilterWrap();
    });
})();
