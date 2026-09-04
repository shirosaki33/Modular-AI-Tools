/* =========================================================================
   ACTIVE IMAGE EDITOR (extraído de tagmanager_caption_tag.js)
   ---------------------------------------------------------------------
   window.renderEditor (a função que desenha a coluna central "Active
   Image") e todas as ações de tag que giram em torno dela: aceitar/
   rejeitar ghost tags, adicionar, remover, reordenar, filtro Tags/NL,
   modo Tag/NL da imagem, etc.
========================================================================= */

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
 
window.toggleImageMode = function() {
    if (typeof selectedIndices === 'undefined' || selectedIndices.size === 0) return;
    let changed = false;
    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        if (img) {
            img.type = img.type === 'nl' ? 'tags' : 'nl';
            if (typeof datasetConfig !== 'undefined') {
                datasetConfig[img.baseName] = datasetConfig[img.baseName] || {};
                datasetConfig[img.baseName].type = img.type;
            }
            changed = true;
        }
    });
    if (changed) {
        if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
        if (typeof window.renderEditor === 'function') window.renderEditor();
        if (typeof window.refreshListStatus === 'function') window.refreshListStatus();
        if (typeof window.applyFilters === 'function') window.applyFilters();
    }
};
 
window.renderEditor = function() {
    const topbarSelectFormat = document.getElementById('topbar-save-format');
    const colTools = document.getElementById('col-tools');
    const colPresets = document.getElementById('col-presets');
    const presetsVisible = colPresets && colPresets.style.display !== 'none';
    const btnMode = document.getElementById('btn-toggle-image-mode');
    
    if (btnMode) {
        if (selectedIndices.size > 0) {
            btnMode.style.display = 'inline-block';
            const firstImg = imageFiles[Array.from(selectedIndices)[0]];
            if (firstImg.type === 'nl') {
                btnMode.textContent = 'Mode: NL';
                btnMode.style.borderColor = '#4a2a8c'; btnMode.style.color = '#b890ff';
            } else {
                btnMode.textContent = 'Mode: Tag';
                btnMode.style.borderColor = '#00aa66'; btnMode.style.color = '#00ff99';
            }
        } else { btnMode.style.display = 'none'; }
    }
 
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
 
    // PERMANENT TEXTAREA FOR FULL NL MODE
    if (imgObj.type === 'nl') {
        const activeTagCountBadge = document.getElementById('active-tag-count');
        if (activeTagCountBadge) activeTagCountBadge.textContent = '1 (NL)';
        if(activeAddContainer) activeAddContainer.style.display = 'none';
        if(activeActions) activeActions.style.display = 'none';
 
        const box = document.createElement('div');
        box.className = 'tag-nl-edit-box tag-nl-edit-fullscreen';
        box.innerHTML = `
            <textarea class="tag-nl-edit-textarea" placeholder="Enter full text description here..."></textarea>
            <div style="display:flex; gap:8px; margin-top: 8px;">
                <button class="btn-nl-edit-translate" onclick="window.translateCustomNLEdit(this, 'en')">🌐 Translate (EN-US)</button>
                <button class="btn-nl-edit-gemini" onclick="window.geminiCustomNLEdit(this, 'en-US')">✨ Gemini Fix (EN-US)</button>
            </div>
            <div style="display:flex; gap:8px; margin-top: 8px; justify-content: flex-end;">
                <button class="btn-nl-edit-cancel">✖ Cancel</button>
                <button class="btn-nl-edit-save">💾 Save</button>
            </div>
        `;
        const ta = box.querySelector('textarea');
        const originalText = imgObj.content || '';
        ta.value = originalText;
 
        const btnCancel = box.querySelector('.btn-nl-edit-cancel');
        const btnSave = box.querySelector('.btn-nl-edit-save');
        
        btnCancel.style.opacity = '0.5'; btnCancel.disabled = true;
        btnSave.style.opacity = '0.5'; btnSave.disabled = true;
 
        ta.oninput = () => {
            if (ta.value !== originalText) {
                btnCancel.style.opacity = '1'; btnCancel.disabled = false;
                btnSave.style.opacity = '1'; btnSave.disabled = false;
            } else {
                btnCancel.style.opacity = '0.5'; btnCancel.disabled = true;
                btnSave.style.opacity = '0.5'; btnSave.disabled = true;
            }
        };
 
        btnCancel.onclick = () => {
            ta.value = originalText;
            ta.oninput();
        };
 
        btnSave.onclick = async () => {
            const newText = ta.value;
            let replacedCount = 0;
            let modifiedFiles = [];
            selectedIndices.forEach(idx => {
                imageFiles[idx].content = newText;
                imageFiles[idx].hasFile = true;
                modifiedFiles.push(imageFiles[idx]);
                replacedCount++;
            });
            window.markDirty(modifiedFiles);
            const savePromises = modifiedFiles.map(img => window.saveImageToDisk(img));
            await Promise.all(savePromises);
            if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
            if (typeof window.renderEditor === 'function') window.renderEditor();
            if (typeof window.showAlert === 'function') window.showAlert(`Text saved in ${replacedCount} image(s)!`, 'success');
        };
 
        tagListVertical.appendChild(box);
        return; 
    }
 
    // REGULAR HYBRID TAG MODE RENDERING
    let datasetTagCounts = new Map();
    if (typeof imageFiles !== 'undefined') {
        imageFiles.forEach(img => {
            if (img.hidden) return;
            if (img.hasFile && img.content) {
                if (img.type === 'tags') {
                    img.content.split(',').forEach(t => {
                        const cleanTag = t.trim();
                        if (cleanTag) datasetTagCounts.set(cleanTag, (datasetTagCounts.get(cleanTag) || 0) + 1);
                    });
                } else if (img.type === 'nl') {
                    const cleanTag = img.content.trim();
                    if (cleanTag) datasetTagCounts.set(cleanTag, (datasetTagCounts.get(cleanTag) || 0) + 1);
                }
            }
        });
    }
    
    let fusedTags = new Set();
    selectedIndices.forEach(idx => {
        if (imageFiles[idx].type === 'tags' && imageFiles[idx].content) {
            imageFiles[idx].content.split(',').forEach(t => {
                const cleanTag = t.trim();
                if (cleanTag) fusedTags.add(cleanTag);
            });
        }
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
    
    let favTags = new Set(datasetConfig.favoriteTags || []);
    const isMultiSelected = activeSelectedTags.size > 1; 
    const isMultiImageSelection = selectedIndices.size > 1;
    
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
            
            if (activeSelectedTags.has(tag)) row.classList.add('selected-active');
            if (isFav && window.enableFavHighlight !== false) row.classList.add('glow-favorite');
            if (conflictsForThisTag.length > 0) row.classList.add('conflict');
            if (isFilterMatch) row.classList.add('filter-match');
            if (isAlreadyPreset && (presetsVisible || window.presetHighlightsAlwaysVisible) && window.enablePresetHighlight !== false) row.classList.add('is-preset');
            
            let statusHtml = '';
            if (conflictsForThisTag.length > 0) statusHtml += `<span class="conflict-warning" title="Conflict with: ${conflictsForThisTag.join(', ')}">⚠️ Conflict: ${conflictsForThisTag.join(', ')}</span>`;
            if (similarsForThisTag.length > 0) statusHtml += `<span class="similar-warning" title="Similar/Redundant to: ${similarsForThisTag.join(', ')}">🟨 Similar: ${similarsForThisTag.join(', ')}</span>`;
            
            const displayTag = tag;
            const textColor = isCustomNL ? '#b890ff' : '#ddd'; 
 
            const pencilIcon = isCustomNL ? `<span class="tag-edit-nl" style="margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Edit Tag Text">✏️</span>` : '';
            const starIcon = !isCustomNL ? `<span class="tag-star" style="color: ${isFav ? '#00ff99' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Favorite/Unfavorite">${isFav ? '⭐' : '☆'}</span>` : '';
            const presetIcon = (!isCustomNL && !isAlreadyPreset) ? `<span class="tag-save-preset" style="display: ${presetsVisible ? 'inline' : 'none'}; color: #4db8ff; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Save to Global Presets">💾</span>` : '';
 
            const dbCached = window.danbooruCache ? (window.danbooruCache[tagLower] || window.danbooruCache[tag]) : null; 

            // FEATURE 1: tag-alias (tem seta ➜) fica clicável no nome pra converter globalmente
            const isConvertibleAlias = !!(window.showDanbooruCounts && window.enableAliasConvertClick !== false && dbCached && dbCached.aliasTo && !isCustomNL);

            const dbAliasArrowHtml = (window.showDanbooruCounts && dbCached && dbCached.aliasTo && !isCustomNL) ? `<span class="tag-alias-arrow${isConvertibleAlias ? ' tag-name-convertible' : ''}" title="${isConvertibleAlias ? `Click to convert this alias tag globally to '${dbCached.aliasTo}'` : `Danbooru redirects this tag to '${dbCached.aliasTo}'`}">➜ ${dbCached.aliasTo}</span>` : '';
            
            // O ícone ❓ original com a classe de estilo idêntica ao do painel!
            const dbAliasInfoHtml = (window.showDanbooruCounts && dbCached && dbCached.aliasTo && !isCustomNL) ? `<span class="tag-alias-info-icon tag-db-info" title="View Alias Tag Info">❓</span>` : '';

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
                <span class="tag-name${isConvertibleAlias ? ' tag-name-convertible' : ''}" style="color: ${textColor};"${isConvertibleAlias ? ` title="Click to convert this alias tag globally to &quot;${dbCached.aliasTo}&quot;"` : ''}>${displayTag}</span>
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
 
                const aliasInfoIcon = row.querySelector('.tag-alias-info-icon');
                if (aliasInfoIcon && dbCached && dbCached.aliasTo) {
                    aliasInfoIcon.onclick = (e) => { 
                        e.stopPropagation(); 
                        if(typeof window.openDanbooruTagInfoPopout === 'function') {
                            window.openDanbooruTagInfoPopout(dbCached.aliasTo, tag);
                        }
                    };
                }

                if (isConvertibleAlias) {
                    const convertibleEls = row.querySelectorAll('.tag-name-convertible');
                    convertibleEls.forEach(el => {
                        el.onclick = (e) => {
                            e.stopPropagation();
                            window.convertAliasTagGlobally(tag, dbCached.aliasTo);
                        };
                    });
                }
            }
            
            // Drag-to-reorder agora funciona SEMPRE, mesmo com múltiplas tags
            // selecionadas (isMultiSelected) ou múltiplas imagens selecionadas
            // (isMultiImageSelection). Antes isso era bloqueado porque, com
            // várias imagens, a lista mostrada é uma FUSÃO das tags de todas
            // elas — e reorderTags() aplica fromIndex/toIndex (posições dessa
            // lista fundida) diretamente no array de tags de CADA imagem, que
            // pode ter tags diferentes/em posições diferentes. Isso pode
            // reordenar a tag "errada" dentro de alguma imagem específica do
            // grupo. Mantido assim de propósito (a pedido do usuário): o
            // objetivo aqui é só subir/descer a ordem para uma visão geral
            // melhor, aceitando que o resultado por imagem pode não ficar
            // 100% coerente quando as imagens têm tags diferentes entre si.
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
                if (e.shiftKey && activeSelectedTags.size > 0) {
                    const start = Math.min(lastSelectedActiveTagIndex, i), end = Math.max(lastSelectedActiveTagIndex, i);
                    activeSelectedTags.clear(); for (let j = start; j <= end; j++) activeSelectedTags.add(window.sortedActiveTags[j]);
                } else if (e.ctrlKey || e.metaKey) {
                    if (activeSelectedTags.has(tag)) activeSelectedTags.delete(tag); else activeSelectedTags.add(tag);
                    lastSelectedActiveTagIndex = i;
                } else {
                    if (activeSelectedTags.has(tag) && activeSelectedTags.size === 1) { activeSelectedTags.clear(); } 
                    else { activeSelectedTags.clear(); activeSelectedTags.add(tag); lastSelectedActiveTagIndex = i; }
                }
                window.renderEditor();
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
            const displayTag = tag;
            const row = document.createElement('div'); row.className = 'tag-row ghost';
            row.innerHTML = `<div class="tag-row-left"><span class="tag-name"${isCustomNL ? ' style="color:#b890ff;"' : ''}>${displayTag}</span></div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="tag-ghost-accept" title="Accept suggestion">✓</span>
                <span class="tag-ghost-reject" title="Reject suggestion" style="color: #ff4444; cursor: pointer; font-size: 1.2em; font-weight: bold;">&times;</span>
            </div>`;
            row.querySelector('.tag-ghost-accept').onclick = (e) => { e.stopPropagation(); window.acceptGhostTagActive(tag); };
            row.querySelector('.tag-ghost-reject').onclick = (e) => { e.stopPropagation(); window.rejectGhostTagActive(tag); };
            tagListVertical.appendChild(row);
        });
    }
 
    const replaceBtn = document.querySelector('#active-selection-actions .btn-replace');
    if (replaceBtn) {
        const hasCustom = Array.from(activeSelectedTags).some(t => window.checkIfNL(t));
        replaceBtn.style.display = hasCustom ? 'none' : 'block';
    }
 
    // Reaplica o filtro de busca da Active Image depois de qualquer re-render
    // da lista (mesmo padrão já usado em renderMasterTagList) — sem isto, o
    // filtro digitado "sumia" (mostrava tudo de novo) toda vez que qualquer
    // ação (adicionar/remover tag, etc.) disparasse renderEditor() de novo.
    if (window.activeSearchMode && typeof window.filterActiveTagsByName === 'function') {
        window.filterActiveTagsByName(document.getElementById('active-add-input') ? document.getElementById('active-add-input').value : '');
    }
}
 
window.updateActiveSuggestVisibility = function() {
    const btnDiscard = document.getElementById('btn-discard-active-suggestions');
    const btnFilter = document.getElementById('btn-filter-active-ghosts');
    const anyPending = Array.from(selectedIndices).some(idx => imageFiles[idx] && imageFiles[idx].pendingAdd && imageFiles[idx].pendingAdd.length > 0);
    if (btnDiscard) btnDiscard.style.display = anyPending ? 'inline-flex' : 'none';
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
 
window.removeTagFromSelected = function(tagToRemove) {
    selectedIndices.forEach(idx => {
        if (imageFiles[idx].type === 'tags') {
            imageFiles[idx].content = imageFiles[idx].content.split(',').map(t => t.trim()).filter(t => t && t !== tagToRemove).join(', ');
        } else if (imageFiles[idx].type === 'nl') {
            if (imageFiles[idx].content && imageFiles[idx].content.trim() === tagToRemove.trim()) {
                imageFiles[idx].content = "";
            }
        }
    });
    if(typeof window.markDirty === 'function') window.markDirty(Array.from(selectedIndices).map(idx => imageFiles[idx]));
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
}
 
window.convertTagToGhost = async function(tagToConvert) {
    const isCustomNL = window.checkIfNL(tagToConvert);
    if (isCustomNL) return;
 
    if (!tagToConvert) return;
    let affectedCount = 0; const modifiedFiles = [];
    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        if (img.type !== 'tags' || !img.content) return;
        let tags = img.content.split(',').map(t => t.trim()).filter(t => t);
        if (!tags.includes(tagToConvert)) return;
        tags = tags.filter(t => t !== tagToConvert);
        img.content = tags.join(', ');
        
        img.pendingAdd = img.pendingAdd || [];
        if (!img.pendingAdd.includes(tagToConvert)) img.pendingAdd.push(tagToConvert);
        if (typeof pendingTagsStore !== 'undefined') pendingTagsStore[img.baseName] = img.pendingAdd;
        modifiedFiles.push(img); affectedCount++;
    });
    if (affectedCount === 0) return;
    if (typeof window.markDirty === 'function') window.markDirty(modifiedFiles);
    activeSelectedTags.delete(tagToConvert);
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    if (typeof window.updateActiveSuggestVisibility === 'function') window.updateActiveSuggestVisibility();
    const handle = window.currentImagesHandle || window.rootHandle;
    if (typeof window.savePendingTagsStore === 'function') await window.savePendingTagsStore(handle);
    if (typeof window.showAlert === 'function') window.showAlert(`Converted "${tagToConvert}" to ghost in ${affectedCount} image(s).`, 'info');
};
 
window.removeSelectedActiveTags = function() {
    if (activeSelectedTags.size === 0) return;
    const tagsToRemove = Array.from(activeSelectedTags);
    selectedIndices.forEach(idx => {
        if (imageFiles[idx].hasFile) {
            if (imageFiles[idx].type === 'tags') {
                let currentTags = imageFiles[idx].content.split(',').map(t => t.trim()).filter(t => t);
                currentTags = currentTags.filter(t => !tagsToRemove.includes(t));
                imageFiles[idx].content = currentTags.join(', ');
            } else if (imageFiles[idx].type === 'nl') {
                if (imageFiles[idx].content && tagsToRemove.includes(imageFiles[idx].content.trim())) {
                    imageFiles[idx].content = "";
                }
            }
        }
    });
    if(typeof window.markDirty === 'function') window.markDirty(Array.from(selectedIndices).map(idx => imageFiles[idx]));
    activeSelectedTags.clear();
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
}
 
window.clearActiveSelection = function() { activeSelectedTags.clear(); if(typeof window.renderEditor === 'function') window.renderEditor(); }
 
window.addTagToSelected = function(newTag, position = 'bottom') {
    const tag = newTag.trim(); if(!tag) return;
    selectedIndices.forEach(idx => {
        if (!imageFiles[idx].hasFile) imageFiles[idx].type = 'tags';
        if (imageFiles[idx].type === 'tags') {
            let tags = imageFiles[idx].content ? imageFiles[idx].content.split(',').map(t => t.trim()).filter(t => t) : [];
            if (!tags.includes(tag)) { position === 'top' ? tags.unshift(tag) : tags.push(tag); }
            imageFiles[idx].content = tags.join(', '); 
        } else if (imageFiles[idx].type === 'nl') {
            let text = imageFiles[idx].content ? imageFiles[idx].content.trim() : "";
            if (text) {
                if (position === 'top') { imageFiles[idx].content = tag + ", " + text; } 
                else { imageFiles[idx].content = text + ", " + tag; }
            } else { imageFiles[idx].content = tag; }
        }
        imageFiles[idx].hasFile = true;
        if(!imageFiles[idx].ext) imageFiles[idx].ext = document.getElementById('topbar-save-format') ? document.getElementById('topbar-save-format').value : 'txt';
    });
    if(typeof window.markDirty === 'function') window.markDirty(Array.from(selectedIndices).map(idx => imageFiles[idx]));
    if(typeof masterTagSet !== 'undefined') masterTagSet.add(tag); 
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList(); 
    if (typeof window.renderEditor === 'function') window.renderEditor(); 
    if(typeof window.refreshListStatus === 'function') window.refreshListStatus();
    if (typeof window.applyFilters === 'function') window.applyFilters();
}
 
window.addEmptyNLTag = function() {};
 
window.addTagToAllImages = function(newTag, position = 'bottom') {
    const tag = newTag.trim(); if(!tag) return;
    const affected = [];
    imageFiles.forEach(img => {
        if (img.hidden) return;
        if (!img.hasFile) img.type = 'tags';
        if (img.type === 'tags') {
            let tags = img.content ? img.content.split(',').map(t => t.trim()).filter(t => t) : [];
            if (!tags.includes(tag)) { position === 'top' ? tags.unshift(tag) : tags.push(tag); }
            img.content = tags.join(', ');
        } else if (img.type === 'nl') {
            let text = img.content ? img.content.trim() : "";
            if (text) {
                if (position === 'top') { img.content = tag + ", " + text; } 
                else { img.content = text + ", " + tag; }
            } else { img.content = tag; }
        }
        img.hasFile = true;
        if(!img.ext) img.ext = document.getElementById('topbar-save-format') ? document.getElementById('topbar-save-format').value : 'txt';
        affected.push(img);
    });
    if(typeof window.markDirty === 'function') window.markDirty(affected);
    if(typeof masterTagSet !== 'undefined') masterTagSet.add(tag);
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if(typeof window.refreshListStatus === 'function') window.refreshListStatus();
    if (typeof window.applyFilters === 'function') window.applyFilters();
}
 
window.reorderTags = function(fromIndex, toIndex) {
    selectedIndices.forEach(idx => {
        if (imageFiles[idx].type === 'tags') {
            let tags = imageFiles[idx].content.split(',').map(t => t.trim()).filter(t => t);
            tags.splice(toIndex, 0, tags.splice(fromIndex, 1)[0]);
            imageFiles[idx].content = tags.join(', ');
        }
    });
    if(typeof window.markDirty === 'function') window.markDirty(Array.from(selectedIndices).map(idx => imageFiles[idx]));
    if(typeof window.renderEditor === 'function') window.renderEditor();
}
 
window.inlineAdd = function(source) {
    const input = document.getElementById(`${source}-add-input`);
    const pos = document.getElementById(`${source}-add-pos`).value;
    const rawText = input.value.trim();
    if(!rawText) return;
    let tagsToAdd = rawText.includes(',') ? rawText.split(',').map(t => t.trim()).filter(t => t) : [rawText];
    if(tagsToAdd.length === 0) return;
    if (source === 'master') tagsToAdd.forEach(t => window.addTagToAllImages(t, pos));
    else tagsToAdd.forEach(t => window.addTagToSelected(t, pos));
    input.value = '';
    if (source === 'active' && window.activeSearchMode && typeof window.filterActiveTagsByName === 'function') window.filterActiveTagsByName('');
    if (source === 'master' && window.masterSearchMode && typeof window.filterMasterTagsByName === 'function') window.filterMasterTagsByName('');
}