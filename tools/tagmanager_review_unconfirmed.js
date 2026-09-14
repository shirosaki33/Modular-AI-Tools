/* =========================================================================
   REVIEW MODE — TAGS NÃO CONFIRMADAS PELO TAGGER (🚫 ghost tag vermelha)
   ---------------------------------------------------------------------
   Complementa o Review Mode do Batch Tagger.
   CORREÇÃO (anterior):
   - Previne duplicação visual limpando resíduos antes de injetar.
   - Vincula o botão "Discard Suggestions" para limpar também esta lista.

   ---------------------------------------------------------------------
   FIX (dataset "não carregando" ao trocar de pasta — precisando de F5):
   window.loadGallery / loadSubDir1 / loadSubDir2 / loadSubDir3 (em
   tagmanager_ui_core.js) chamam:

       await window.loadDatasetConfig(dirHandle);
       await window.loadPendingTagsStore(dirHandle);

   SEM nenhum try/catch ao redor. Se essa segunda chamada lançar uma
   exceção não capturada, TODO o resto da função para ali — o reset de
   imageFiles, a varredura da pasta e o window.finishLoading() nunca
   rodam, e a lista da esquerda fica vazia até dar F5.

   Este arquivo SUBSTITUI window.loadPendingTagsStore (pra também
   carregar o "_pending_remove.json") e window.savePendingTagsStore. A
   versão antiga já tinha try/catch na parte de ler/escrever o arquivo,
   mas NÃO protegia a chamada ao loader/saver ORIGINAL (origLoad/
   origSave) — se ele lançasse algo inesperado (por exemplo, por causa
   de outro wrap futuro, um handle instável durante troca rápida de
   pasta, ou uma permissão momentaneamente negada), a exceção escapava
   do wrapper inteiro e derrubava o carregamento do dataset, de forma
   intermitente.

   Agora as duas funções NUNCA lançam exceção — tanto a chamada ao
   original quanto a leitura/escrita do "_pending_remove.json" estão
   protegidas. Trocar de dataset não deve mais travar por causa deste
   módulo, mesmo em condições adversas.

   Os wraps de fallback (usados só se tagmanager_render_hooks.js não
   tiver carregado) também ganharam try/catch, pelo mesmo motivo: uma
   falha aqui não pode derrubar renderImageList/renderEditor/
   renderMasterTagList inteiros.

   FIX (discardAllSuggestions não aguardado): o wrapper deste botão
   sobrescrevia window.discardAllSuggestions (que é `async`) com uma
   função SÍNCRONA que não dava `await` na chamada original — o array
   pendingRemove podia ser zerado e a UI re-renderizada ANTES do
   discard original (que salva em disco) realmente terminar. Agora o
   wrapper também é `async` e aguarda corretamente.

   ---------------------------------------------------------------------
   NOVO (seleção das tags fantasmas vermelhas em "All Dataset Tags"):
   Antes, o "🚫 Not Detected by Tagger" só tinha ✓ (aceitar/remover de
   vez) e ✖ (dispensar o aviso). Não dava pra clicar numa dessas tags e
   ver EM QUAIS imagens ela está pendente de remoção — diferente das
   tags fantasmas verdes (💡 pendingAdd), que já suportavam isso via
   masterSelectedGhostTags + AND/OR/XOR/NOT.

   Agora cada linha vermelha em All Dataset Tags é clicável (shift/ctrl
   funcionam igual ao resto do app) e entra em
   window.masterSelectedPendingRemove. Com pelo menos 1 tag vermelha
   selecionada, apertar AND/OR/XOR/NOT na barra de lógica filtra a
   lista "Dataset" pra mostrar só as imagens que têm aquela(s) tag(s)
   em img.pendingRemove — mesmo mecanismo já usado pelas tags verdes,
   só que aplicado depois (via wrap de window.applyFilters), sem
   precisar tocar em tagmanager_master_list.js.
========================================================================= */

(function () {
    window.pendingRemoveStore = window.pendingRemoveStore || {};

    // Seleção das tags fantasmas VERMELHAS (only All Dataset Tags — a Active
    // Image já mostra só a imagem atual, não faz sentido "filtrar" ali).
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
        /* Linhas vermelhas selecionáveis (só All Dataset Tags) */
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
                // Blindagem: mesmo que o loader original lance algo inesperado,
                // isso NÃO pode derrubar window.loadGallery/loadSubDirN (que
                // chamam esta função sem try/catch próprio) — senão o dataset
                // fica com a lista vazia até dar F5.
                try {
                    await origLoad(dirHandle);
                } catch (e) {
                    console.warn('[Review Mode] loadPendingTagsStore (original) falhou, seguindo em frente:', e);
                }

                window.pendingRemoveStore = {};
                if (!dirHandle) return;
                try {
                    const h = await dirHandle.getFileHandle('_pending_remove.json');
                    const file = await h.getFile();
                    window.pendingRemoveStore = JSON.parse(await file.text());
                } catch (e) {
                    // Arquivo não existe, corrompido, ou handle sem permissão
                    // momentânea — não é motivo pra travar o carregamento do
                    // dataset. pendingRemoveStore já foi resetado para {} acima.
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
                    console.warn('[Review Mode] savePendingTagsStore (original) falhou, seguindo em frente:', e);
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
                    console.warn('[Review Mode] Falha ao salvar _pending_remove.json:', e);
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

    // Zera a seleção vermelha sempre que o dataset muda (mesmo padrão usado
    // em vários outros arquivos pra detectar troca via nova referência de
    // window.imageFiles) — senão uma tag selecionada "sobrevive" pra um
    // dataset novo onde ela nem existe mais.
    let _lastImageFilesRefPendingRemoveSelect = null;
    function syncPendingRemoveSelectionOnDatasetChange() {
        if (typeof imageFiles === 'undefined') return;
        if (imageFiles === _lastImageFilesRefPendingRemoveSelect) return;
        _lastImageFilesRefPendingRemoveSelect = imageFiles;
        if (window.masterSelectedPendingRemove.size > 0) window.masterSelectedPendingRemove.clear();
    }

    function attachPendingRemoveFlags() {
        if (typeof imageFiles === 'undefined') return;
        syncPendingRemoveSelectionOnDatasetChange();
        imageFiles.forEach(img => {
            if (img.pendingRemove === undefined) {
                img.pendingRemove = (window.pendingRemoveStore && window.pendingRemoveStore[img.baseName])
                    ? window.pendingRemoveStore[img.baseName].slice()
                    : [];
            }
        });
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
            if (img && img.type === 'tags' && img.content) {
                img.content.split(',').forEach(t => { const c = t.trim(); if (c) fusedTags.add(c); });
            }
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
            const currentTags = (img.type === 'tags' && img.content)
                ? new Set(img.content.split(',').map(t => t.trim()))
                : new Set();
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
        // A tag já sumiu de todo mundo — não faz mais sentido continuar
        // "selecionada" pra filtro.
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

    /* ---------- SELEÇÃO DAS TAGS VERMELHAS (só All Dataset Tags) ----------
       Mesmo padrão de clique (shift = intervalo, ctrl/cmd = toggle avulso,
       clique simples = seleciona só essa/desmarca se já era a única) usado
       pelas tags verdes (masterSelectedGhostTags) e por todo o resto do app. */
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
                ${countHtml}<span class="tag-name">${tag}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="tag-ghost-accept" title="Remove this tag">✓</span>
                <span class="tag-ghost-reject" title="Dismiss — keep the tag as is" style="color: #ff4444; cursor: pointer; font-size: 1.2em; font-weight: bold;">&times;</span>
            </div>`;

        row.querySelector('.tag-ghost-accept').onclick = (e) => { e.stopPropagation(); onAccept(); };
        row.querySelector('.tag-ghost-reject').onclick = (e) => { e.stopPropagation(); onReject(); };

        // Seleção — só em All Dataset Tags. Clicar mostra em quais imagens
        // essa tag está pendente de remoção: use os botões AND/OR/XOR/NOT da
        // barra de lógica (com pelo menos 1 tag vermelha selecionada) pra
        // filtrar a lista "Dataset" por img.pendingRemove.
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

        // PREVENÇÃO DE DUPLICATAS: Limpa qualquer seção fantasma vermelha remanescente
        const existing = container.querySelectorAll('.ghost-section-remove-label, .tag-ghost-remove');
        existing.forEach(el => el.remove());

        const tags = computeFusedPendingRemoveActive();
        if (tags.length === 0) return;

        const label = document.createElement('div');
        label.className = 'ghost-section-label ghost-section-remove-label'; // Adicionada classe única
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

        // PREVENÇÃO DE DUPLICATAS
        const existing = container.querySelectorAll('.ghost-section-remove-label, .tag-ghost-remove');
        existing.forEach(el => el.remove());

        if (!window.showGhostTagsInList) return;

        const counts = computeMasterPendingRemoveCounts();
        if (counts.size === 0) return;

        const label = document.createElement('div');
        label.className = 'ghost-section-label ghost-section-remove-label';
        label.style.color = '#ff6060';
        label.textContent = '🚫 Not Detected by Tagger';
        container.appendChild(label);

        const sortedTags = Array.from(counts.keys()).sort();

        // Uma tag pode ter sido removida do dataset entre um render e outro —
        // limpa da seleção pra não ficar "presa" filtrando por algo inexistente.
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

    /* ---------- FILTRO DA LISTA "DATASET" PELAS TAGS VERMELHAS SELECIONADAS ----------
       Roda DEPOIS do window.applyFilters original (tagmanager_master_list.js),
       só restringindo ainda mais quem já está visível. Segue o MESMO
       comportamento das tags verdes: só filtra de fato quando um dos botões
       AND/OR/XOR/NOT está ativo — sem isso, selecionar sozinho não esconde
       nada (igual ao core já faz pra masterSelectedTags/masterSelectedGhostTags). */
    function applyPendingRemoveVisibilityFilter() {
        if (typeof imageFiles === 'undefined') return;
        const selected = window.masterSelectedPendingRemove;
        if (!selected || selected.size === 0) return;

        const totalSelected = selected.size;
        const mode = window.filterMode || 'NONE';

        imageFiles.forEach(img => {
            if (!img.element) return;
            if (img.element.style.display === 'none') return; // já escondida por outro filtro

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
            try { applyPendingRemoveVisibilityFilter(); } catch (e) { console.warn('[Review Mode] applyPendingRemoveVisibilityFilter falhou:', e); }
            return result;
        };
        wrapped.__pendingRemoveFilterWrapped = true;
        window.applyFilters = wrapped;
    }

    /* ---------- HOOKS E BOTÃO DE DISCARD ---------- */
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

            // AGORA MOSTRA O BOTÃO DE DISCARD SE HOUVER *QUALQUER* PENDÊNCIA (verde ou vermelha)
            if (discardBtn) discardBtn.style.display = anyPending ? 'inline-flex' : 'none';
        };
        window.updateSuggestFilterVisibility.__pendingRemoveOverridden = true;
    }

    // Intercepta a função Discard Suggestions para também esvaziar a lista vermelha.
    // FIX: window.discardAllSuggestions original é `async` (salva em disco antes de
    // terminar) — o wrapper antigo era síncrono e NÃO aguardava essa chamada, então
    // podia zerar pendingRemove/re-renderizar a UI antes do discard original de
    // verdade ter terminado de persistir no disco. Agora o wrapper também é async
    // e usa `await`, preservando a ordem correta das operações.
    function installDiscardSuggestionsWrap() {
        if (typeof window.discardAllSuggestions === 'function' && !window.discardAllSuggestions.__pendingRemoveWrapped) {
            const origDiscard = window.discardAllSuggestions;
            const wrappedDiscard = async function () {
                // Chama a lógica original (que limpa as verdes) e aguarda terminar
                const result = await origDiscard.apply(this, arguments);

                // Adiciona nossa lógica para as vermelhas
                if (typeof imageFiles !== 'undefined') {
                    imageFiles.forEach(img => {
                        img.pendingRemove = [];
                    });
                }
                window.pendingRemoveStore = {};
                window.masterSelectedPendingRemove.clear();
                persistPendingRemove();

                // Força re-render das listas para sumir com as bordas vermelhas na hora
                if (typeof window.renderEditor === 'function') window.renderEditor();
                if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();

                return result;
            };
            wrappedDiscard.__pendingRemoveWrapped = true;
            window.discardAllSuggestions = wrappedDiscard;
        }
    }

    function installRenderHooks() {
        if (typeof window.registerPostRenderImageList === 'function') {
            window.registerPostRenderImageList(attachPendingRemoveFlags);
        } else if (typeof window.renderImageList === 'function' && !window.renderImageList.__pendingRemoveWrapped) {
            const orig = window.renderImageList;
            const wrapped = function () {
                orig.apply(this, arguments);
                try { attachPendingRemoveFlags(); } catch (e) { console.warn('[Review Mode] attachPendingRemoveFlags falhou:', e); }
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
                try { injectActiveGhostRemoveSection(); } catch (e) { console.warn('[Review Mode] injectActiveGhostRemoveSection falhou:', e); }
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
                try { injectMasterGhostRemoveSection(); } catch (e) { console.warn('[Review Mode] injectMasterGhostRemoveSection falhou:', e); }
            };
            wrapped3.__pendingRemoveWrapped = true;
            window.renderMasterTagList = wrapped3;
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        installStoreWraps();
        installRemovalCleanupWraps();
        installSuggestVisibilityOverride();
        installDiscardSuggestionsWrap(); // Hook do botão de lixeira adicionado
        installRenderHooks();
        installPendingRemoveFilterWrap(); // NOVO: filtro por seleção das tags vermelhas
    });
})();