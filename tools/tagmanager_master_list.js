/* =========================================================================
   MASTER TAG LIST / IMAGE FILTERS (extraído de tagmanager_caption_tag.js)
   ---------------------------------------------------------------------
   window.renderMasterTagList (coluna "All Dataset Tags") e todas as
   ações globais em torno dela: pin de tag, favoritos, filtro NL,
   aceitar/rejeitar ghost tag globalmente, aplicar filtros na lista de
   imagens (window.applyFilters), remover/adicionar tags em massa.

   NOTA: window.globalConvertToCustomNL vive em tagmanager_nl_inline_editor.js
   (o arquivo original tinha essa função duplicada aqui — removido).
========================================================================= */

window.showOnlyFavoriteTags = false;
window.toggleFavTagsFilter = function() {
    window.showOnlyFavoriteTags = !window.showOnlyFavoriteTags;
    const btn = document.getElementById('btn-filter-fav-tags');
    if (window.showOnlyFavoriteTags) { btn.style.color = '#00ff99'; btn.style.borderColor = '#00aa66'; btn.textContent = '⭐'; } 
    else { btn.style.color = '#888'; btn.style.borderColor = '#444'; btn.textContent = '☆'; }
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
};
 
window.masterNLFilterMode = 'HIDDEN';
window.toggleMasterNLFilter = function() {
    const states = ['HIDDEN', 'EXCLUSIVE', 'ALL'];
    let idx = states.indexOf(window.masterNLFilterMode);
    window.masterNLFilterMode = states[(idx + 1) % states.length];
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
};
 
window.pinnedMasterTag = window.pinnedMasterTag || null;
window.toggleMasterTagPin = function(tag) {
    window.pinnedMasterTag = (window.pinnedMasterTag === tag) ? null : tag;
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    if (selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
};
 
window.renderMasterTagList = function() {
    const container = document.getElementById('master-tag-list'); 
    if(!container) return;
    container.innerHTML = '';
    
    const presetCol = document.getElementById('col-presets');
    const presetsVisible = presetCol && presetCol.style.display !== 'none';
    
    let tagCounts = new Map();
    let nlSet = new Set();
    
    if(typeof imageFiles !== 'undefined') {
        imageFiles.forEach(img => {
            if (img.hidden) return;
            if (img.hasFile && img.content) {
                if (img.type === 'tags') {
                    img.content.split(',').forEach(t => {
                        const cleanTag = t.trim();
                        if (cleanTag) {
                            tagCounts.set(cleanTag, (tagCounts.get(cleanTag) || 0) + 1);
                            if (window.checkIfNL(cleanTag)) nlSet.add(cleanTag);
                        }
                    });
                } else if (img.type === 'nl') {
                    const cleanTag = img.content.trim();
                    if (cleanTag) {
                        tagCounts.set(cleanTag, (tagCounts.get(cleanTag) || 0) + 1);
                        nlSet.add(cleanTag);
                    }
                }
            }
        });
    }
 
    let favTags = new Set(datasetConfig.favoriteTags || []);
    let sortedMasterTags = typeof masterTagSet !== 'undefined' ? Array.from(masterTagSet).sort() : [];
 
    const masterTagCountBadge = document.getElementById('master-tag-count');
    if (masterTagCountBadge) {
        const totalUniqueTags = sortedMasterTags.filter(t => !nlSet.has(t) && (tagCounts.get(t) || 0) > 0).length;
        masterTagCountBadge.textContent = totalUniqueTags;
    }
 
    let hasAnyNL = nlSet.size > 0;
 
    const btnNLFilter = document.getElementById('btn-filter-nl-master');
    if (btnNLFilter) {
        btnNLFilter.style.display = hasAnyNL ? 'inline-block' : 'none';
        if (window.masterNLFilterMode === 'ALL') {
            btnNLFilter.style.color = '#b890ff';
            btnNLFilter.style.borderColor = '#4a2a8c';
            btnNLFilter.title = "Show: All (Tags + NL)";
        } else if (window.masterNLFilterMode === 'HIDDEN') {
            btnNLFilter.style.color = '#888';
            btnNLFilter.style.borderColor = '#444';
            btnNLFilter.title = "Show: Tags Only (Hide NL)";
        } else if (window.masterNLFilterMode === 'EXCLUSIVE') {
            btnNLFilter.style.color = '#00ff99';
            btnNLFilter.style.borderColor = '#00aa66';
            btnNLFilter.title = "Show: NL Only";
        }
    }
 
    // ATUALIZAÇÃO DO BOTÃO "CONVERT TO NL/TAG" NA BARRA DE AÇÕES MASTER
    const masterConvertBtn = document.querySelector('#master-selection-actions .btn-nl-edit');
    if (masterConvertBtn) {
        masterConvertBtn.style.display = 'block';
        const hasCustom = Array.from(masterSelectedTags).some(t => window.checkIfNL(t));
        if (hasCustom) {
            masterConvertBtn.textContent = '🔄 Force Tag';
            masterConvertBtn.title = 'Treat as normal Tag';
            masterConvertBtn.onclick = window.globalConvertToCustomNL;
        } else {
            masterConvertBtn.textContent = '📝 Force NL';
            masterConvertBtn.title = 'Treat as Natural Language';
            masterConvertBtn.onclick = window.globalConvertToCustomNL;
        }
    }
 
    if (window.pinnedMasterTag) {
        const pTag = window.pinnedMasterTag;
        const pCount = tagCounts.get(pTag) || 0;
        const pItem = document.createElement('div');
        pItem.className = 'master-tag-item pinned-master-tag-row';
        pItem.style.cssText = 'position:sticky; top:0; z-index:5; border-left:3px solid #4db8ff; background:#0d1b2a;';
        pItem.innerHTML = `
            <div style="display:flex; align-items:center; overflow:hidden; flex:1;">
                <span class="tag-pin active" style="color:#4db8ff; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Unpin this tag">📌</span>
                <span style="color:#555; font-size:10px; font-weight:bold; min-width:22px; text-align:left; margin-right:8px; user-select:none;">${pCount}</span>
                <span class="tag-name" style="color:#4db8ff; font-weight:bold;">${pTag}</span>
            </div>
        `;
        pItem.querySelector('.tag-pin').onclick = (e) => { e.stopPropagation(); window.toggleMasterTagPin(pTag); };
        container.appendChild(pItem);
    }
    
    if (!window.showGhostTagsInList) {
        sortedMasterTags.forEach((tag, index) => {
            const count = tagCounts.get(tag) || 0;
            if (count === 0) return;
            
            const isCustomNL = nlSet.has(tag);
            
            if (window.masterNLFilterMode === 'HIDDEN' && isCustomNL) return;
            if (window.masterNLFilterMode === 'EXCLUSIVE' && !isCustomNL) return;
            
            if (window.showOnlyFavoriteTags && !favTags.has(tag)) return;
 
            const item = document.createElement('div'); item.className = 'master-tag-item';
            item.setAttribute('data-tag-name', tag.toLowerCase());
            if (favTags.has(tag) && window.enableFavHighlight !== false) item.classList.add('glow-favorite');
            
            let isSelected = masterSelectedTags.has(tag);
            let statusHtml = '';
            let conflictsForThisTag = [];
            let similarsForThisTag = [];
 
            if (isSelected) {
                item.classList.add('selected-master');
                if (window.enableConflictWarnings && typeof window.checkTagStatusWithActive === 'function') {
                    const status = window.checkTagStatusWithActive(tag);
                    conflictsForThisTag = status.conflicts; similarsForThisTag = status.similars;
                    if (conflictsForThisTag.length > 0) {
                        item.classList.add('conflict');
                        statusHtml += `<span class="conflict-warning" title="Conflict with: ${conflictsForThisTag.join(', ')}">⚠️ Conflict: ${conflictsForThisTag.join(', ')}</span>`;
                    } else if (similarsForThisTag.length > 0) {
                        item.classList.add('similar');
                        statusHtml += `<span class="similar-warning" title="Similar/Redundant to: ${similarsForThisTag.join(', ')}">🟨 Similar: ${similarsForThisTag.join(', ')}</span>`;
                    }
                }
            }
            
            const isPinned = window.pinnedMasterTag === tag;
            const dbCached = window.danbooruCache ? (window.danbooruCache[tag.toLowerCase()] || window.danbooruCache[tag]) : null;

            // FEATURE 1: tag-alias (tem seta ➜) fica clicável no nome pra converter globalmente
            const isConvertibleAliasMaster = !!(window.showDanbooruCounts && window.enableAliasConvertClick !== false && dbCached && dbCached.aliasTo && !isCustomNL);

            const dbAliasArrowHtml = (window.showDanbooruCounts && dbCached && dbCached.aliasTo && !isCustomNL)
                ? `<span class="tag-alias-arrow${isConvertibleAliasMaster ? ' tag-name-convertible' : ''}" title="${isConvertibleAliasMaster ? `Click to convert this alias tag globally to '${dbCached.aliasTo}'` : `Danbooru redirects this tag to '${dbCached.aliasTo}'`}">➜ ${dbCached.aliasTo}</span>` : '';

            // FEATURE 2: tag "real" (não-alias) mostra, do lado, os aliases já vistos que apontam pra ela
            const reverseAliasesMaster = (window.showAliasPreview !== false && !isCustomNL && !isConvertibleAliasMaster)
                ? window.computeReverseAliasesForTag(tag.toLowerCase()) : [];
            const reverseAliasHtmlMaster = reverseAliasesMaster.length > 0
                ? `<span class="tag-alias-reverse-list" title="Alias tag(s) pointing to this tag: ${reverseAliasesMaster.join(', ')}">⟵ ${reverseAliasesMaster.join(', ')}</span>` : '';
            
            const dbCountHtml = (window.showDanbooruCounts && dbCached && dbCached.count !== undefined && !isCustomNL)
                ? (dbCached.count > 0
                    ? `<span style="font-size: 10px; color: #666; margin-right: 8px; user-select: none;">${window.formatDbCount(dbCached.count)}</span>`
                    : (dbCached.isDeprecated ? `<span style="font-size: 10px; color: #666; margin-right: 8px; user-select: none;">Deprecated</span>` : ''))
                : '';
 
            const isAlreadyPreset = !isCustomNL && window._presetTagsSet && window._presetTagsSet.has(tag);
            if (isAlreadyPreset && (presetsVisible || window.presetHighlightsAlwaysVisible) && window.enablePresetHighlight !== false) item.classList.add('is-preset');
            const presetIconHtml = (isAlreadyPreset || isCustomNL) ? '' : `<span class="tag-save-preset" style="display: ${presetsVisible ? 'inline' : 'none'}; color: #4db8ff; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Save to Global Presets">💾</span>`;
            const ghostIconHtmlMaster = (window.enableGhostConvertIcon !== false && !isCustomNL) ? `<span class="tag-to-ghost" title="Convert to Ghost globally">💡</span>` : '';
            
            const dbAliasInfoHtml = (window.showDanbooruCounts && dbCached && dbCached.aliasTo && !isCustomNL)
                ? `<span class="tag-alias-info-icon tag-db-info" title="View Alias Tag Info">❓</span>` : '';
 
            item.innerHTML = `
                <div style="display:flex; align-items:center; overflow:hidden; flex:1;">
                    <span class="tag-pin${isPinned ? ' active' : ''}" style="color: ${isPinned ? '#4db8ff' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Pin as a mandatory filter">📌</span>
                    <span class="tag-star" style="color: ${favTags.has(tag) ? '#00ff99' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Favorite/Unfavorite">${favTags.has(tag) ? '⭐' : '☆'}</span>
                    ${presetIconHtml}
                    <span style="color:#555; font-size:10px; font-weight:bold; min-width:22px; text-align:left; margin-right:8px; user-select:none;">${count}</span>
                    <span class="tag-name${isConvertibleAliasMaster ? ' tag-name-convertible' : ''}" style="${isCustomNL ? 'color:#b890ff;' : ''}"${isConvertibleAliasMaster ? ` title="Click to convert this alias tag globally to &quot;${dbCached.aliasTo}&quot;"` : ''}>${tag}</span>
                    ${dbAliasArrowHtml}
                    ${reverseAliasHtmlMaster}
                    ${statusHtml}
                </div>
                <div style="display: flex; align-items: center;">
                    ${dbCountHtml}
                    ${ghostIconHtmlMaster}
                    ${dbAliasInfoHtml}
                    <span class="tag-remove" title="Global Remove">&times;</span>
                </div>
            `;
 
            if (conflictsForThisTag.length > 0) {
                const warningSpan = item.querySelector('.conflict-warning');
                if(warningSpan) {
                    warningSpan.onmouseenter = () => { conflictsForThisTag.forEach(ct => { const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`); if (targetRow) targetRow.classList.add('glow-conflict'); }); };
                    warningSpan.onmouseleave = () => { conflictsForThisTag.forEach(ct => { const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`); if (targetRow) targetRow.classList.remove('glow-conflict'); }); };
                }
            }
 
            if (similarsForThisTag.length > 0) {
                const simSpan = item.querySelector('.similar-warning');
                if(simSpan) {
                    simSpan.onmouseenter = () => { similarsForThisTag.forEach(ct => { const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`); if (targetRow) targetRow.classList.add('glow-similar'); }); };
                    simSpan.onmouseleave = () => { similarsForThisTag.forEach(ct => { const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`); if (targetRow) targetRow.classList.remove('glow-similar'); }); };
                }
            }
            
            const pinEl = item.querySelector('.tag-pin');
            if (pinEl) pinEl.onclick = (e) => { e.stopPropagation(); window.toggleMasterTagPin(tag); };
 
            const starEl = item.querySelector('.tag-star');
            starEl.onclick = async (e) => {
                e.stopPropagation();
                const currentlyFav = favTags.has(tag);
                if (currentlyFav) favTags.delete(tag); else favTags.add(tag);
                datasetConfig.favoriteTags = Array.from(favTags);
                if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited(); 
                if (window.showOnlyFavoriteTags && currentlyFav) { item.style.display = 'none'; } else {
                    starEl.textContent = currentlyFav ? '☆' : '⭐'; starEl.style.color = currentlyFav ? '#444' : '#00ff99';
                    if (window.enableFavHighlight !== false && !window.showOnlyFavoriteTags) {
                        if (currentlyFav) item.classList.remove('glow-favorite'); else item.classList.add('glow-favorite');
                    }
                }
                if (selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
            };
 
            const presetBtn = item.querySelector('.tag-save-preset');
            if (presetBtn) {
                presetBtn.onclick = (e) => { e.stopPropagation(); if(typeof window.savePresetTag === 'function') { window.savePresetTag(tag); if(typeof window.showAlert === 'function') window.showAlert(`Tag "${tag}" saved to Presets!`, 'success'); } };
            }
 
            const aliasInfoIcon = item.querySelector('.tag-alias-info-icon');
            if (aliasInfoIcon && dbCached && dbCached.aliasTo) {
                aliasInfoIcon.onclick = (e) => { 
                    e.stopPropagation(); 
                    if(typeof window.openDanbooruTagInfoPopout === 'function') {
                        window.openDanbooruTagInfoPopout(dbCached.aliasTo, tag);
                    }
                };
            }

            if (isConvertibleAliasMaster) {
                const convertibleElsMaster = item.querySelectorAll('.tag-name-convertible');
                convertibleElsMaster.forEach(el => {
                    el.onclick = (e) => {
                        e.stopPropagation();
                        window.convertAliasTagGlobally(tag, dbCached.aliasTo);
                    };
                });
            }
            
            if (!isCustomNL) item.ondblclick = (e) => { e.stopPropagation(); window.addTagToSelected(tag, document.getElementById('master-add-pos') ? document.getElementById('master-add-pos').value : 'bottom'); };
            
            item.onclick = (e) => {
                if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star') || e.target.classList.contains('tag-save-preset') || e.target.classList.contains('tag-pin') || e.target.classList.contains('conflict-warning') || e.target.classList.contains('similar-warning') || e.target.classList.contains('tag-to-ghost') || e.target.classList.contains('tag-alias-info-icon') || e.target.classList.contains('tag-name-convertible')) { 
                    if(e.target.classList.contains('tag-remove')) { e.stopPropagation(); window.globalRemoveTags([tag]); }
					if(e.target.classList.contains('tag-to-ghost')) { e.stopPropagation(); window.globalConvertTagToGhost(tag); }
                    return; 
                }
                
                if (e.shiftKey && masterSelectedTags.size > 0) {
                    const start = Math.min(lastSelectedMasterTagIndex, index), end = Math.max(lastSelectedMasterTagIndex, index);
                    masterSelectedTags.clear(); for (let i = start; i <= end; i++) masterSelectedTags.add(sortedMasterTags[i]);
                } else if (e.ctrlKey || e.metaKey) {
                    if (masterSelectedTags.has(tag)) masterSelectedTags.delete(tag); else masterSelectedTags.add(tag);
                    lastSelectedMasterTagIndex = index;
                } else {
                    if (masterSelectedTags.has(tag) && masterSelectedTags.size === 1) { masterSelectedTags.clear(); } 
                    else { masterSelectedTags.clear(); masterSelectedTags.add(tag); lastSelectedMasterTagIndex = index; }
                }
                
                window.renderMasterTagList(); 
                if (typeof window.applyFilters === 'function') window.applyFilters();
                if (typeof window.updateSelectionActions === 'function') window.updateSelectionActions();
                if (selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
            };
            container.appendChild(item);
        });
    }
 
    let pendingCounts = new Map(); 
    if(typeof imageFiles !== 'undefined') {
        imageFiles.forEach(img => {
            if (img.hidden) return;
            if (img.pendingAdd && img.pendingAdd.length) {
                img.pendingAdd.forEach(t => pendingCounts.set(t, (pendingCounts.get(t) || 0) + 1));
            }
        });
    }
 
    let sortedGhostTags = Array.from(pendingCounts.keys()).sort();
 
    if (window.showGhostTagsInList && sortedGhostTags.length > 0) {
        const label = document.createElement('div'); label.className = 'ghost-section-label'; label.textContent = '💡 Pending Suggestions';
        container.appendChild(label);
 
        sortedGhostTags.forEach((tag, gIndex) => {
            const isCustomNL = nlSet.has(tag);
            if (isCustomNL) return;
 
            const count = pendingCounts.get(tag);
            const item = document.createElement('div');
            item.className = 'master-tag-item ghost';
            if (masterSelectedGhostTags.has(tag)) item.classList.add('selected-master');
            item.innerHTML = `
                <div style="display:flex; align-items:center; overflow:hidden; flex:1;">
                    <span style="color:#00aa66; font-size:10px; font-weight:bold; min-width:22px; text-align:left; margin-right:8px; user-select:none;">${count}</span>
                    <span class="tag-name">${tag}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="tag-ghost-accept" title="Accept globally">✓</span>
                    <span class="tag-ghost-reject" title="Reject globally" style="color: #ff4444; cursor: pointer; font-size: 1.2em; font-weight: bold;">&times;</span>
                </div>
            `;
            item.querySelector('.tag-ghost-accept').onclick = (e) => { e.stopPropagation(); window.acceptGhostTagGlobal(tag); };
            item.querySelector('.tag-ghost-reject').onclick = (e) => { e.stopPropagation(); window.rejectGhostTagGlobal(tag); };
            item.onclick = (e) => {
                if (e.target.classList.contains('tag-ghost-accept')) return;
                if (e.shiftKey && masterSelectedGhostTags.size > 0) {
                    const start = Math.min(lastSelectedGhostTagIndex, gIndex), end = Math.max(lastSelectedGhostTagIndex, gIndex);
                    masterSelectedGhostTags.clear(); for (let i = start; i <= end; i++) masterSelectedGhostTags.add(sortedGhostTags[i]);
                } else if (e.ctrlKey || e.metaKey) {
                    if (masterSelectedGhostTags.has(tag)) masterSelectedGhostTags.delete(tag); else masterSelectedGhostTags.add(tag);
                    lastSelectedGhostTagIndex = gIndex;
                } else {
                    if (masterSelectedGhostTags.has(tag) && masterSelectedGhostTags.size === 1) { masterSelectedGhostTags.clear(); } 
                    else { masterSelectedGhostTags.clear(); masterSelectedGhostTags.add(tag); lastSelectedGhostTagIndex = gIndex; }
                }
                window.renderMasterTagList(); 
                if (typeof window.applyFilters === 'function') window.applyFilters();
                if (typeof window.updateSelectionActions === 'function') window.updateSelectionActions();
            };
            container.appendChild(item);
        });
    }
 
    if (typeof window.updateSuggestFilterVisibility === 'function') window.updateSuggestFilterVisibility();
    if (window.masterSearchMode && typeof window.filterMasterTagsByName === 'function') window.filterMasterTagsByName(document.getElementById('master-add-input') ? document.getElementById('master-add-input').value : '');
}
 
window.acceptGhostTagGlobal = function(tag) {
    const globalExt = document.getElementById('topbar-save-format') ? document.getElementById('topbar-save-format').value : 'txt';
    let count = 0; const affected = [];
    imageFiles.forEach(img => {
        if (img.hidden) return;
        if (img.pendingAdd && img.pendingAdd.includes(tag)) {
            img.pendingAdd = img.pendingAdd.filter(t => t !== tag);
            if (typeof pendingTagsStore !== 'undefined') {
                if (img.pendingAdd.length > 0) pendingTagsStore[img.baseName] = img.pendingAdd; else delete pendingTagsStore[img.baseName];
            }
            if (!img.hasFile) img.type = 'tags';
            if (img.type === 'tags') {
                let tags = img.content ? img.content.split(',').map(t => t.trim()).filter(t => t) : [];
                if (!tags.includes(tag)) tags.push(tag);
                img.content = tags.join(', ');
            } else if (img.type === 'nl') {
                let text = img.content ? img.content.trim() : "";
                img.content = text ? text + ", " + tag : tag;
            }
            img.hasFile = true;
            if (!img.ext) img.ext = globalExt;
            affected.push(img); count++;
        }
    });
    if(typeof window.markDirty === 'function') window.markDirty(affected);
    if(typeof masterTagSet !== 'undefined') masterTagSet.add(tag);
    if(typeof masterSelectedGhostTags !== 'undefined') masterSelectedGhostTags.delete(tag);
 
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    window.renderMasterTagList();
    if (selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.refreshListStatus === 'function') window.refreshListStatus();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    if (typeof window.savePendingTagsStore === 'function') {
        const handle = window.currentImagesHandle || window.rootHandle;
        window.savePendingTagsStore(handle);
    }
    if(typeof window.showAlert === 'function') window.showAlert(`Tag "${tag}" accepted on ${count} image(s).`, 'success');
}
 
window.applyFilters = function() {
    if (!window.currentImagesHandle && !window.rootHandle) return;
    imageFiles.forEach(img => {
        if (img.hidden) { if (img.element) img.element.style.display = 'none'; return; }
        let visible = true;
        if (visible && window.imageNameFilter) {
            const nameLower = (img.name || '').toLowerCase();
            if (!nameLower.includes(window.imageNameFilter)) visible = false;
        }
        if (visible && window.pinnedMasterTag) {
            if (img.type === 'tags' && img.content) {
                const tags = img.content.split(',').map(t => t.trim());
                if (!tags.includes(window.pinnedMasterTag)) visible = false;
            } else if (img.type === 'nl' && img.content) {
                if (img.content.trim() !== window.pinnedMasterTag) visible = false;
            } else { visible = false; }
        }
 
        const totalSelected = masterSelectedTags.size + masterSelectedGhostTags.size;
        if (visible && window.imageFilterMode !== 'ALL') {
            let hasTag = false; let hasNL = false;
            if (img.type === 'nl') hasNL = true;
            else if (img.type === 'tags' && img.content) {
                const tags = img.content.split(',').map(t=>t.trim()).filter(t=>t);
                hasNL = tags.some(t => window.checkIfNL(t));
                hasTag = tags.some(t => !window.checkIfNL(t));
            }
            if (window.imageFilterMode === 'TAGS' && !hasTag) visible = false;
            if (window.imageFilterMode === 'NL' && !hasNL) visible = false;
        }
 
        if (visible && totalSelected > 0) {
            if (img.type === 'tags') {
                const tags = img.content.split(',').map(t => t.trim());
                const pending = img.pendingAdd || [];
                let matchCount = 0;
                for (let ft of masterSelectedTags) { if (tags.includes(ft)) matchCount++; }
                for (let gt of masterSelectedGhostTags) { if (pending.includes(gt)) matchCount++; }
                
                if (filterMode === 'AND' && matchCount !== totalSelected) visible = false;
                if (filterMode === 'OR' && matchCount === 0) visible = false;
                if (filterMode === 'XOR' && matchCount !== 1) visible = false;
                if (filterMode === 'NOT' && matchCount > 0) visible = false;
            } else if (img.type === 'nl') {
                const content = img.content ? img.content.trim() : "";
                const pending = img.pendingAdd || [];
                let matchCount = 0;
                for (let ft of masterSelectedTags) { if (content === ft) matchCount++; }
                for (let gt of masterSelectedGhostTags) { if (pending.includes(gt)) matchCount++; }
                
                if (filterMode === 'AND' && matchCount !== totalSelected) visible = false;
                if (filterMode === 'OR' && matchCount === 0) visible = false;
                if (filterMode === 'XOR' && matchCount !== 1) visible = false;
                if (filterMode === 'NOT' && matchCount > 0) visible = false;
            } else { visible = false; }
        }
        if(img.element) img.element.style.display = visible ? 'flex' : 'none';
    });
 
    // FIX: qualquer imagem que tenha acabado de sair de vista (por busca de
    // nome, tag pinada 📌, lógica AND/OR/XOR/NOT ou filtro Tags/NL) precisa
    // sair também de selectedIndices — senão a Active Image continua
    // mostrando/editando tags de uma imagem que não aparece mais na lista.
    if (typeof window.pruneSelectionToVisible === 'function') window.pruneSelectionToVisible();
}
 
window.updateSelectionActions = function() {
    const bar = document.getElementById('master-selection-actions');
    if(bar) bar.style.display = masterSelectedTags.size > 0 ? 'flex' : 'none';
}
 
window.removeSelectedMasterTags = function() {
    if(masterSelectedTags.size === 0) return;
    if(confirm(`Remove ${masterSelectedTags.size} tags globally?`)) window.globalRemoveTags(Array.from(masterSelectedTags));
}
 
window.addSelectedMasterTagsTo = function(target) {
    if(masterSelectedTags.size === 0) return;
    const pos = document.getElementById('master-add-pos') ? document.getElementById('master-add-pos').value : 'bottom';
    const tagsToAdd = Array.from(masterSelectedTags);
    const globalExt = document.getElementById('topbar-save-format') ? document.getElementById('topbar-save-format').value : 'txt';
    let targets = [];
    if (target === 'selected') {
        targets = Array.from(selectedIndices);
        if(targets.length === 0) { if(typeof window.showAlert === 'function') window.showAlert("No images selected.", "error"); return; }
    } else if (target === 'all') {
        targets = imageFiles.map((_, i) => i).filter(i => !imageFiles[i].hidden);
    }
    
    targets.forEach(idx => {
        if (!imageFiles[idx].hasFile) imageFiles[idx].type = 'tags';
        if (imageFiles[idx].type === 'tags') {
            let currentTags = imageFiles[idx].content ? imageFiles[idx].content.split(',').map(t=>t.trim()).filter(t=>t) : [];
            tagsToAdd.forEach(tag => {
                if (!currentTags.includes(tag)) {
                    if (pos === 'top') currentTags.unshift(tag); else currentTags.push(tag);
                }
            });
            imageFiles[idx].content = currentTags.join(', ');
        } else if (imageFiles[idx].type === 'nl') {
            let text = imageFiles[idx].content ? imageFiles[idx].content.trim() : "";
            tagsToAdd.forEach(tag => {
                if (text) {
                    if (pos === 'top') text = tag + ", " + text;
                    else text = text + ", " + tag;
                } else {
                    text = tag;
                }
            });
            imageFiles[idx].content = text;
        }
        imageFiles[idx].hasFile = true;
        if(!imageFiles[idx].ext) imageFiles[idx].ext = globalExt;
    });
    if(typeof window.markDirty === 'function') window.markDirty(targets.map(idx => imageFiles[idx]));
    
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    window.renderMasterTagList();
    if(typeof window.renderEditor === 'function') window.renderEditor();
    if(typeof window.refreshListStatus === 'function') window.refreshListStatus();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    if(typeof window.showAlert === 'function') window.showAlert(`Added ${tagsToAdd.length} tags to ${targets.length} image(s).`, "success");
}
 
window.globalRemoveTags = function(tagsToRemove) {
    if(!tagsToRemove || tagsToRemove.length === 0) return;
    let changed = 0; const affected = [];
    
    imageFiles.forEach(img => {
        if (img.hidden) return;
        if(img.type === 'tags') {
            let currentTags = img.content.split(',').map(t => t.trim()).filter(t => t);
            let originalLen = currentTags.length;
            currentTags = currentTags.filter(t => !tagsToRemove.includes(t));
            if(currentTags.length !== originalLen) { img.content = currentTags.join(', '); affected.push(img); changed++; }
        } else if (img.type === 'nl') {
            if (img.content && tagsToRemove.includes(img.content.trim())) {
                img.content = ""; affected.push(img); changed++;
            }
        }
    });
    if(typeof window.markDirty === 'function') window.markDirty(affected);
    
    tagsToRemove.forEach(t => { 
        if(typeof masterTagSet !== 'undefined') masterTagSet.delete(t); 
        if(typeof masterSelectedTags !== 'undefined') masterSelectedTags.delete(t); 
    });
    
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if(typeof window.updateSelectionActions === 'function') window.updateSelectionActions(); 
    window.renderMasterTagList();
    if (selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    
    if(typeof window.showAlert === 'function') window.showAlert(`Removed tags from ${changed} image(s).`, 'success');
}
 
window.globalConvertTagToGhost = async function(tagToConvert) {
    // Hidden / unused feature to convert text to Ghost globally since text lacks the Ghost button
};
 
window.rejectGhostTagActive = function(tag) {
    let modifiedFiles = [];
    selectedIndices.forEach(idx => {
        const img = imageFiles[idx];
        if (img.pendingAdd && img.pendingAdd.includes(tag)) {
            img.pendingAdd = img.pendingAdd.filter(t => t !== tag);
            if (typeof pendingTagsStore !== 'undefined') {
                if (img.pendingAdd.length > 0) pendingTagsStore[img.baseName] = img.pendingAdd; else delete pendingTagsStore[img.baseName];
            }
            modifiedFiles.push(img);
        }
    });
    if (modifiedFiles.length > 0 && typeof window.markDirty === 'function') window.markDirty(modifiedFiles);
    if (typeof window.savePendingTagsStore === 'function') {
        const handle = window.currentImagesHandle || window.rootHandle;
        window.savePendingTagsStore(handle);
    }
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
};
 
window.rejectGhostTagGlobal = function(tag) {
    let count = 0; const affected = [];
    imageFiles.forEach(img => {
        if (img.hidden) return;
        if (img.pendingAdd && img.pendingAdd.includes(tag)) {
            img.pendingAdd = img.pendingAdd.filter(t => t !== tag);
            if (typeof pendingTagsStore !== 'undefined') {
                if (img.pendingAdd.length > 0) pendingTagsStore[img.baseName] = img.pendingAdd; else delete pendingTagsStore[img.baseName];
            }
            affected.push(img); count++;
        }
    });
    if (typeof window.markDirty === 'function') window.markDirty(affected);
    if (typeof masterSelectedGhostTags !== 'undefined') masterSelectedGhostTags.delete(tag);
    if (typeof window.renderImageList === 'function') window.renderImageList();
    window.renderMasterTagList();
    if (selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
    
    if (typeof window.savePendingTagsStore === 'function') {
        const handle = window.currentImagesHandle || window.rootHandle;
        window.savePendingTagsStore(handle);
    }
    if(typeof window.showAlert === 'function') window.showAlert(`Rejected "${tag}" on ${count} image(s).`, 'info');
};