/* =========================================================================
   ACTIVE IMAGE EDITOR (extraído de tagmanager_caption_tag.js)
   ---------------------------------------------------------------------
   window.renderEditor (a função que desenha a coluna central "Active
   Image") e todas as ações de tag que giram em torno dela: aceitar/
   rejeitar ghost tags, adicionar, remover, reordenar, filtro Tags/NL.
   Todo texto vindo de tags entra no HTML via esc() (window.escHTML).
========================================================================= */

const _aeEsc = (v) => (typeof window.escHTML === 'function' ? window.escHTML(v) : String(v));

window.showOnlyActiveGhosts = false;
window.toggleActiveGhostFilter = function() {
    window.showOnlyActiveGhosts = !window.showOnlyActiveGhosts;
    const btn = document.getElementById('btn-filter-active-ghosts');
    if (btn) {
        btn.classList.toggle('active', window.showOnlyActiveGhosts);
        btn.style.background = window.showOnlyActiveGhosts ? '#00aa66' : 'transparent';
        btn.style.color = window.showOnlyActiveGhosts ? '#000' : '#00ff99';
    }
    if (typeof window.renderEditor === 'function') window.renderEditor();
}

window.activeTagFilterMode = 'ALL';
window.cycleActiveTagFilter = function() {
    const states = ['ALL', 'TAGS', 'NL'];
    const labels = { 'ALL': '🏷️ All', 'TAGS': '🏷️ Tags', 'NL': '📝 NL' };
    let idx = states.indexOf(window.activeTagFilterMode);
    window.activeTagFilterMode = states[(idx + 1) % states.length];
    const btn = document.getElementById('btn-active-tag-filter');
    if (btn) btn.textContent = labels[window.activeTagFilterMode];
    if (typeof window.renderEditor === 'function') window.renderEditor();
};

function _aeSplitTags(content) {
    return content ? content.split(',').map(t => t.trim()).filter(t => t) : [];
}

/* Tudo que depende só da SELEÇÃO de tags (não do conteúdo): barra de ações,
   botões Force NL/Tag, Edit e Replace, e a classe .selected-active das linhas.
   Clicar numa tag chama só isto — antes recriava a lista inteira e rodava
   todos os hooks de render a cada clique. */
function _aeSyncSelectionControls() {
    const activeActions = document.getElementById('active-selection-actions');
    if(activeActions) activeActions.style.display = activeSelectedTags.size > 0 ? 'flex' : 'none';

    // ATUALIZAÇÃO DO BOTÃO "CONVERT TO NL/TAG" NA BARRA DE AÇÕES ATIVA
    const convertBtn = document.querySelector('#active-selection-actions .btn-nl-edit');
    if (convertBtn) {
        convertBtn.style.display = 'block';
        const hasCustom = Array.from(activeSelectedTags).some(t => window.checkIfNL(t));
        if (hasCustom) {
            convertBtn.textContent = '🔄 Force Tag';
            convertBtn.title = 'Treat as normal Tag';
            convertBtn.onclick = window.convertToCustomNL;
        } else {
            convertBtn.textContent = '📝 Force NL';
            convertBtn.title = 'Treat as Natural Language';
            convertBtn.onclick = window.convertToCustomNL;
        }
    }

    // Botão "✏️ Edit" ao lado do Force Tag: só com UMA tag NL selecionada
    const editNlBtn = document.querySelector('#active-selection-actions .btn-edit-nl');
    if (editNlBtn) {
        const selArr = Array.from(activeSelectedTags);
        editNlBtn.style.display = (selArr.length === 1 && window.checkIfNL(selArr[0])) ? 'block' : 'none';
    }

    const replaceBtn = document.querySelector('#active-selection-actions .btn-replace');
    if (replaceBtn) {
        const hasCustom = Array.from(activeSelectedTags).some(t => window.checkIfNL(t));
        replaceBtn.style.display = hasCustom ? 'none' : 'block';
    }
}

function _aeUpdateActiveSelectionUI() {
    const list = document.getElementById('tag-list-vertical');
    if (list) list.querySelectorAll('.tag-row:not(.ghost)').forEach(row => {
        if (row._tmTag !== undefined) row.classList.toggle('selected-active', activeSelectedTags.has(row._tmTag));
    });
    _aeSyncSelectionControls();
    if (window.TM) window.TM.emit('selection:active', activeSelectedTags);
}

window.renderEditor = function() {
    const esc = _aeEsc;
    const topbarSelectFormat = document.getElementById('topbar-save-format');
    const colTools = document.getElementById('col-tools');
    const colPresets = document.getElementById('col-presets');
    const presetsVisible = colPresets && colPresets.style.display !== 'none';

    if (selectedIndices.size === 0) {
        window.sortedActiveTags = [];
        if(topbarSelectFormat) topbarSelectFormat.style.display = 'none';
        if(colTools) colTools.style.display = 'flex';
        if (typeof window.updateActiveSuggestVisibility === 'function') window.updateActiveSuggestVisibility();
        if (typeof window.updateConvertFormatButton === 'function') window.updateConvertFormatButton();
        const activeTagCountBadgeEmpty = document.getElementById('active-tag-count');
        if (activeTagCountBadgeEmpty) activeTagCountBadgeEmpty.textContent = '0';

        const tagListVerticalEmpty = document.getElementById('tag-list-vertical');
        if (tagListVerticalEmpty) tagListVerticalEmpty.innerHTML = '';
        const activeAddContainerEmpty = document.getElementById('active-add-container');
        if (activeAddContainerEmpty) activeAddContainerEmpty.style.display = 'none';
        const activeActionsEmpty = document.getElementById('active-selection-actions');
        if (activeActionsEmpty) activeActionsEmpty.style.display = 'none';
        activeSelectedTags.clear();
        return;
    }

    const imgObj = imageFiles[Array.from(selectedIndices)[0]];
    if (typeof window.updateActiveSuggestVisibility === 'function') window.updateActiveSuggestVisibility();
    if(topbarSelectFormat) topbarSelectFormat.value = imgObj.ext || 'txt';
    let isAnyEmpty = false;
    selectedIndices.forEach(idx => { if (!imageFiles[idx].hasFile) isAnyEmpty = true; });
    if(topbarSelectFormat) topbarSelectFormat.style.display = isAnyEmpty ? 'inline-block' : 'none';
    if (typeof window.updateConvertFormatButton === 'function') window.updateConvertFormatButton();

    const tagsContainer = document.getElementById('tags-editor-container');
    const activeAddContainer = document.getElementById('active-add-container');
    const activeActions = document.getElementById('active-selection-actions');

    if(tagsContainer) tagsContainer.style.display = 'flex';
    if(colTools) colTools.style.display = 'flex';

    const tagListVertical = document.getElementById('tag-list-vertical');
    if(!tagListVertical) return;
    tagListVertical.innerHTML = '';

    let datasetTagCounts = new Map();
    if (typeof imageFiles !== 'undefined') {
        imageFiles.forEach(img => {
            if (img.hidden || !img.hasFile || !img.content) return;
            _aeSplitTags(img.content).forEach(cleanTag => {
                datasetTagCounts.set(cleanTag, (datasetTagCounts.get(cleanTag) || 0) + 1);
            });
        });
    }

    let fusedTags = new Set();
    selectedIndices.forEach(idx => {
        _aeSplitTags(imageFiles[idx].content).forEach(t => fusedTags.add(t));
    });

    window.sortedActiveTags = Array.from(fusedTags);
    const activeTagCountBadge = document.getElementById('active-tag-count');
    if (activeTagCountBadge) activeTagCountBadge.textContent = window.sortedActiveTags.length;

    // Temporary Edit Box for Hybrid NL tags
    if (window.nlEditTarget && window.nlEditTarget.scope === 'active') {
        if(activeAddContainer) activeAddContainer.style.display = 'none';
        if(activeActions) activeActions.style.display = 'none';
        const box = buildNLEditBox(window.nlEditTarget.tag, 'active');
        box.classList.add('tag-nl-edit-fullscreen');
        tagListVertical.appendChild(box);
        return;
    }

    if(activeAddContainer) activeAddContainer.style.display = 'flex';

    _aeSyncSelectionControls();

    let favTags = new Set(datasetConfig.favoriteTags || []);

    if (!window.showOnlyActiveGhosts) {
        window.sortedActiveTags.forEach((tag, i) => {
            const isFav = favTags.has(tag);
            const isCustomNL = window.checkIfNL(tag);
            const tagLower = tag.toLowerCase();

            if (window.activeTagFilterMode === 'TAGS' && isCustomNL) return;
            if (window.activeTagFilterMode === 'NL' && !isCustomNL) return;

            let conflictsForThisTag = [];
            let similarsForThisTag = [];
            if (window.enableConflictWarnings) {
                (window.tagConflicts || []).forEach(group => {
                    const groupLower = group.map(g => g.toLowerCase());
                    if (groupLower.includes(tagLower)) {
                        let activeInGroup = groupLower.filter(t => window.sortedActiveTags.some(at => at.toLowerCase() === t));
                        let others = activeInGroup.filter(t => t !== tagLower);
                        if (others.length > 0) conflictsForThisTag.push(...others);
                    }
                });
                (window.tagSimilar || []).forEach(group => {
                    const groupLower = group.map(g => g.toLowerCase());
                    if (groupLower.includes(tagLower)) {
                        let activeInGroup = groupLower.filter(t => window.sortedActiveTags.some(at => at.toLowerCase() === t));
                        let others = activeInGroup.filter(t => t !== tagLower);
                        if (others.length > 0) similarsForThisTag.push(...others);
                    }
                });
            }
            conflictsForThisTag = [...new Set(conflictsForThisTag)];
            similarsForThisTag = [...new Set(similarsForThisTag)];

            const isPinFilterMatch = (window.pinnedMasterTag === tag);
            const isButtonFilterMatch = (typeof filterMode !== 'undefined' && filterMode !== 'NONE' && typeof masterSelectedTags !== 'undefined' && masterSelectedTags.has(tag));
            const isFilterMatch = (isPinFilterMatch || isButtonFilterMatch) && window.enableFilterHighlight !== false;
            const isAlreadyPreset = !isCustomNL && window._presetTagsSet && window._presetTagsSet.has(tag);

            const row = document.createElement('div');
            row.className = 'tag-row'; row.setAttribute('data-tag-name', tagLower);
            row._tmTag = tag;

            if (activeSelectedTags.has(tag)) row.classList.add('selected-active');
            if (isFav && window.enableFavHighlight !== false) row.classList.add('glow-favorite');
            if (conflictsForThisTag.length > 0) row.classList.add('conflict');
            if (isFilterMatch) row.classList.add('filter-match');
            if (isAlreadyPreset && (presetsVisible || window.presetHighlightsAlwaysVisible) && window.enablePresetHighlight !== false) row.classList.add('is-preset');

            let statusHtml = '';
            if (conflictsForThisTag.length > 0) {
                const list = esc(conflictsForThisTag.join(', '));
                statusHtml += `<span class="conflict-warning" title="Conflict with: ${list}">⚠️ Conflict: ${list}</span>`;
            }
            if (similarsForThisTag.length > 0) {
                const list = esc(similarsForThisTag.join(', '));
                statusHtml += `<span class="similar-warning" title="Similar/Redundant to: ${list}">🟨 Similar: ${list}</span>`;
            }

            const textColor = isCustomNL ? '#b890ff' : '#ddd';

            const pencilIcon = isCustomNL ? `<span class="tag-edit-nl" style="margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Edit Tag Text">✏️</span>` : '';
            const starIcon = !isCustomNL ? `<span class="tag-star" style="color: ${isFav ? '#00ff99' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Favorite/Unfavorite">${isFav ? '⭐' : '☆'}</span>` : '';
            const presetIcon = (!isCustomNL && !isAlreadyPreset) ? `<span class="tag-save-preset" style="display: ${presetsVisible ? 'inline' : 'none'}; color: #4db8ff; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Save to Global Presets">💾</span>` : '';

            const dbCached = window.danbooruCache ? (window.danbooruCache[tagLower] || window.danbooruCache[tag]) : null;
            // Alias (Danbooru, ou e621 se o Danbooru não tiver): seta ➜, ícone de info
            // e nome clicável pra converter globalmente — tagmanager_alias_bridge.js.
            const aliasInfo = (!isCustomNL && typeof window.getTagAliasInfo === 'function') ? window.getTagAliasInfo(tag) : null;
            const aliasParts = typeof window.renderTagAliasParts === 'function' ? window.renderTagAliasParts(aliasInfo) : { arrow: '', icon: '', nameAttrs: '', nameClass: '' };
            const isConvertibleAlias = !!(aliasInfo && aliasInfo.convertible);
            const dbAliasArrowHtml = aliasParts.arrow;
            const dbAliasInfoHtml = aliasParts.icon;

            // FEATURE 2: tag "real" (não-alias) mostra os aliases unificados (Danbooru + e621)
            const reverseAliasHtmlActive = (!isCustomNL && !isConvertibleAlias && typeof window.renderCombinedAliasPreviewHTML === 'function')
                ? window.renderCombinedAliasPreviewHTML(tagLower) : '';

            const e621CachedForCount = window.showE621 && window.e621Cache ? (window.e621Cache[tagLower] || window.e621Cache[tag]) : null;
            const bestCountInfo = (window.showDanbooruCounts && !isCustomNL && typeof window.pickBestTagCount === 'function')
                ? window.pickBestTagCount(dbCached, e621CachedForCount) : null;
            const dbCountHtml = bestCountInfo
                ? (bestCountInfo.count > 0
                    ? `<span style="font-size: 10px; color: #666; margin-right: 8px; user-select: none;" title="${bestCountInfo.source === 'e621' ? 'e621' : 'Danbooru'} count (highest of the two sources)">${window.formatDbCount(bestCountInfo.count)}</span>`
                    : (bestCountInfo.deprecated ? `<span style="font-size: 10px; color: #666; margin-right: 8px; user-select: none;">Deprecated</span>` : ''))
                : '';
            const countInDataset = datasetTagCounts.get(tag) || 0;
            const dsCountHtml = `<span style="color:#555; font-size:10px; font-weight:bold; min-width:20px; text-align:left; margin-right:8px; user-select:none;" title="Times used in current dataset">${countInDataset}</span>`;
            const ghostIconHtml = (window.enableGhostConvertIcon !== false && !isCustomNL) ? `<span class="tag-to-ghost" title="Convert to Ghost/Suggestion Tag">💡</span>` : '';

            row.innerHTML = `<div class="tag-row-left">
                ${starIcon}
                ${dsCountHtml}
                ${presetIcon}
                ${pencilIcon}
                <span class="tag-name${aliasParts.nameClass}" style="color: ${textColor};"${aliasParts.nameAttrs}>${esc(tag)}</span>
                ${dbAliasArrowHtml}
                ${reverseAliasHtmlActive}
                ${statusHtml}
            </div>
            <div style="display: flex; align-items: center;">
                ${dbCountHtml}
                ${ghostIconHtml}
                ${dbAliasInfoHtml}
                <span class="tag-remove" title="Remove Tag">&times;</span>
            </div>`;

            if (isCustomNL) {
                const pencilEl = row.querySelector('.tag-edit-nl');
                if (pencilEl) {
                    pencilEl.onclick = (e) => {
                        e.stopPropagation();
                        window.nlEditTarget = { scope: 'active', tag: tag };
                        window.renderEditor();
                    };
                }
            }

            if (!isCustomNL) {
                const starEl = row.querySelector('.tag-star');
                starEl.onclick = async (e) => {
                    e.stopPropagation();
                    const currentlyFav = favTags.has(tag);
                    if (currentlyFav) favTags.delete(tag); else favTags.add(tag);
                    datasetConfig.favoriteTags = Array.from(favTags);
                    if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
                    starEl.textContent = currentlyFav ? '☆' : '⭐';
                    starEl.style.color = currentlyFav ? '#444' : '#00ff99';
                    if (window.enableFavHighlight !== false) {
                        if (currentlyFav) row.classList.remove('glow-favorite');
                        else row.classList.add('glow-favorite');
                    }
                    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
                };

                const presetBtn = row.querySelector('.tag-save-preset');
                if (presetBtn) {
                    presetBtn.onclick = (e) => {
                        e.stopPropagation();
                        if(typeof window.savePresetTag === 'function') {
                            window.savePresetTag(tag);
                            if(typeof window.showAlert === 'function') window.showAlert(`Tag "${tag}" saved to Presets!`, 'success');
                        }
                    };
                }

                if (aliasInfo && typeof window.bindTagAliasRow === 'function') window.bindTagAliasRow(row, tag, aliasInfo);
            }

            // Drag-to-reorder funciona sempre, mesmo com várias tags/imagens
            // selecionadas (a lista é a FUSÃO das tags; com imagens diferentes
            // o resultado por imagem pode não ficar 100% coerente — mantido de
            // propósito, a pedido do usuário).
            row.draggable = true;
            row.ondragstart = (e) => {
                if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star') || e.target.classList.contains('tag-save-preset') || e.target.classList.contains('tag-edit-nl') || e.target.classList.contains('tag-to-ghost') || e.target.classList.contains('tag-alias-info-icon')) return false;
                e.dataTransfer.setData('text/plain', i); draggedTagIndex = i; row.classList.add('dragging');
            };
            row.ondragend = () => { row.classList.remove('dragging'); draggedTagIndex = null; };
            row.ondragover = (e) => e.preventDefault();
            row.ondrop = (e) => { e.preventDefault(); if (draggedTagIndex !== null && draggedTagIndex !== i && typeof window.reorderTags === 'function') window.reorderTags(draggedTagIndex, i); };

            row.onclick = (e) => {
                if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star') || e.target.classList.contains('tag-save-preset') || e.target.classList.contains('tag-edit-nl') || e.target.classList.contains('tag-to-ghost') || e.target.classList.contains('tag-alias-info-icon') || e.target.classList.contains('tag-name-convertible')) {
                    if(e.target.classList.contains('tag-remove')) { e.stopPropagation(); window.removeTagFromSelected(tag); }
                    if(e.target.classList.contains('tag-to-ghost')) { e.stopPropagation(); window.convertTagToGhost(tag); }
                    return;
                }
                if (e.shiftKey && activeSelectedTags.size > 0 && lastSelectedActiveTagIndex !== null) {
                    const start = Math.min(lastSelectedActiveTagIndex, i), end = Math.max(lastSelectedActiveTagIndex, i);
                    activeSelectedTags.clear(); for (let j = start; j <= end; j++) activeSelectedTags.add(window.sortedActiveTags[j]);
                } else if (e.ctrlKey || e.metaKey) {
                    if (activeSelectedTags.has(tag)) activeSelectedTags.delete(tag); else activeSelectedTags.add(tag);
                    lastSelectedActiveTagIndex = i;
                } else {
                    if (activeSelectedTags.has(tag) && activeSelectedTags.size === 1) { activeSelectedTags.clear(); }
                    else { activeSelectedTags.clear(); activeSelectedTags.add(tag); lastSelectedActiveTagIndex = i; }
                }
                _aeUpdateActiveSelectionUI();
            };
            tagListVertical.appendChild(row);
        });
    }

    let fusedPending = new Set();
    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        if (img.pendingAdd && img.pendingAdd.length) {
            img.pendingAdd.forEach(t => { if (!fusedTags.has(t)) fusedPending.add(t); });
        }
    });

    if (fusedPending.size > 0) {
        const label = document.createElement('div'); label.className = 'ghost-section-label'; label.textContent = '💡 Pending Suggestions';
        tagListVertical.appendChild(label);
        Array.from(fusedPending).sort().forEach(tag => {
            const isCustomNL = window.checkIfNL(tag);
            const row = document.createElement('div'); row.className = 'tag-row ghost';
            row.innerHTML = `<div class="tag-row-left"><span class="tag-name"${isCustomNL ? ' style="color:#b890ff;"' : ''}>${esc(tag)}</span></div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="tag-ghost-accept" title="Accept suggestion">✓</span>
                <span class="tag-ghost-reject" title="Reject suggestion" style="color: #ff4444; cursor: pointer; font-size: 1.2em; font-weight: bold;">&times;</span>
            </div>`;
            row.querySelector('.tag-ghost-accept').onclick = (e) => { e.stopPropagation(); window.acceptGhostTagActive(tag); };
            row.querySelector('.tag-ghost-reject').onclick = (e) => { e.stopPropagation(); window.rejectGhostTagActive(tag); };
            tagListVertical.appendChild(row);
        });
    }


    // Reaplica o filtro de busca da Active Image depois de qualquer re-render.
    if (window.activeSearchMode && typeof window.filterActiveTagsByName === 'function') {
        window.filterActiveTagsByName(document.getElementById('active-add-input') ? document.getElementById('active-add-input').value : '');
    }
}

window.editSelectedNLTag = function() {
    const sel = Array.from(activeSelectedTags);
    if (sel.length !== 1 || !window.checkIfNL(sel[0])) return;
    window.nlEditTarget = { scope: 'active', tag: sel[0] };
    window.renderEditor();
};

window.updateActiveSuggestVisibility = function() {
    const btnDiscard = document.getElementById('btn-discard-active-suggestions');
    const btnFilter = document.getElementById('btn-filter-active-ghosts');
    const anyPending = Array.from(selectedIndices).some(idx => imageFiles[idx] && imageFiles[idx].pendingAdd && imageFiles[idx].pendingAdd.length > 0);
    const anyPendingRemove = Array.from(selectedIndices).some(idx => imageFiles[idx] && imageFiles[idx].pendingRemove && imageFiles[idx].pendingRemove.length > 0);
    if (btnDiscard) btnDiscard.style.display = (anyPending || anyPendingRemove) ? 'inline-flex' : 'none';
    if (btnFilter) {
        btnFilter.style.display = anyPending ? 'inline-flex' : 'none';
        if (!anyPending && window.showOnlyActiveGhosts) {
            window.showOnlyActiveGhosts = false; btnFilter.classList.remove('active');
            btnFilter.style.background = 'transparent'; btnFilter.style.color = '#00ff99';
        }
    }
};

window.acceptGhostTagActive = function(tag) {
    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        if (img.pendingAdd && img.pendingAdd.includes(tag)) {
            img.pendingAdd = img.pendingAdd.filter(t => t !== tag);
            if (typeof pendingTagsStore !== 'undefined') {
                if (img.pendingAdd.length > 0) pendingTagsStore[img.baseName] = img.pendingAdd;
                else delete pendingTagsStore[img.baseName];
            }
        }
    });
    if(typeof window.addTagToSelected === 'function') window.addTagToSelected(tag, document.getElementById('active-add-pos') ? document.getElementById('active-add-pos').value : 'bottom');
    if (typeof window.savePendingTagsStore === 'function') {
        const handle = window.currentImagesHandle || window.rootHandle;
        window.savePendingTagsStore(handle);
    }
}

function _aeRefreshAfterTagChange() {
    window.TM.tags.refreshViews();
}

window.removeTagFromSelected = function(tagToRemove) {
    window.TM.tags.remove(window.TM.tags.selectedImages(), tagToRemove);
    _aeRefreshAfterTagChange();
}

window.convertTagToGhost = async function(tagToConvert) {
    if (!tagToConvert || window.checkIfNL(tagToConvert)) return;
    let affectedCount = 0; const modifiedFiles = [];
    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        if (!img.content) return;
        let tags = _aeSplitTags(img.content);
        if (!tags.includes(tagToConvert)) return;
        img.content = tags.filter(t => t !== tagToConvert).join(', ');

        img.pendingAdd = img.pendingAdd || [];
        if (!img.pendingAdd.includes(tagToConvert)) img.pendingAdd.push(tagToConvert);
        if (typeof pendingTagsStore !== 'undefined') pendingTagsStore[img.baseName] = img.pendingAdd;
        modifiedFiles.push(img); affectedCount++;
    });
    if (affectedCount === 0) return;
    if (typeof window.markDirty === 'function') window.markDirty(modifiedFiles);
    activeSelectedTags.delete(tagToConvert);
    _aeRefreshAfterTagChange();
    if (typeof window.updateActiveSuggestVisibility === 'function') window.updateActiveSuggestVisibility();
    const handle = window.currentImagesHandle || window.rootHandle;
    if (typeof window.savePendingTagsStore === 'function') await window.savePendingTagsStore(handle);
    if (typeof window.showAlert === 'function') window.showAlert(`Converted "${tagToConvert}" to ghost in ${affectedCount} image(s).`, 'info');
};

window.removeSelectedActiveTags = function() {
    if (activeSelectedTags.size === 0) return;
    const tagsToRemove = Array.from(activeSelectedTags);
    window.TM.tags.remove(window.TM.tags.selectedImages().filter(img => img.hasFile), tagsToRemove);
    activeSelectedTags.clear();
    _aeRefreshAfterTagChange();
}

window.clearActiveSelection = function() { activeSelectedTags.clear(); if(typeof window.renderEditor === 'function') window.renderEditor(); }

/* newTag pode ser uma tag ou uma lista (inlineAdd manda várias de uma vez:
   1 refresh em vez de 1 por tag). */
window.addTagToSelected = function(newTag, position = 'bottom') {
    const tags = (Array.isArray(newTag) ? newTag : [newTag]).map(t => String(t || '').trim()).filter(t => t);
    if (!tags.length) return;
    window.TM.tags.add(window.TM.tags.selectedImages(), tags, position);
    _aeRefreshAfterTagChange();
}

window.addEmptyNLTag = function() {
    if (typeof selectedIndices === 'undefined' || selectedIndices.size === 0) return;
    const tag = 'NL:';
    if (!datasetConfig.manualNLRules) datasetConfig.manualNLRules = {};
    datasetConfig.manualNLRules[tag] = 'nl';
    window.addTagToSelected(tag, 'top');
    window.nlEditTarget = { scope: 'active', tag: tag };
    window.renderEditor();
};

window.addTagToAllImages = function(newTag, position = 'bottom') {
    const tags = (Array.isArray(newTag) ? newTag : [newTag]).map(t => String(t || '').trim()).filter(t => t);
    if (!tags.length) return;
    window.TM.tags.add(window.TM.tags.visibleImages(), tags, position);
    _aeRefreshAfterTagChange();
}

window.reorderTags = function(fromIndex, toIndex) {
    const imgs = window.TM.tags.selectedImages();
    imgs.forEach(img => {
        const tags = window.TM.tags.get(img);
        tags.splice(toIndex, 0, tags.splice(fromIndex, 1)[0]);
        window.TM.tags.set(img, tags.filter(t => t !== undefined));
    });
    if(typeof window.markDirty === 'function') window.markDirty(imgs);
    if(typeof window.renderEditor === 'function') window.renderEditor();
}

window.inlineAdd = function(source) {
    const input = document.getElementById(`${source}-add-input`);
    const pos = document.getElementById(`${source}-add-pos`).value;
    const rawText = input.value.trim();
    if(!rawText) return;
    let tagsToAdd = rawText.includes(',') ? rawText.split(',').map(t => t.trim()).filter(t => t) : [rawText];
    if(tagsToAdd.length === 0) return;
    // 'top' com várias tags: mantém a ordem digitada no topo.
    if (source === 'master') window.addTagToAllImages(tagsToAdd, pos);
    else window.addTagToSelected(tagsToAdd, pos);
    input.value = '';
    if (source === 'active' && window.activeSearchMode && typeof window.filterActiveTagsByName === 'function') window.filterActiveTagsByName('');
    if (source === 'master' && window.masterSearchMode && typeof window.filterMasterTagsByName === 'function') window.filterMasterTagsByName('');
}
