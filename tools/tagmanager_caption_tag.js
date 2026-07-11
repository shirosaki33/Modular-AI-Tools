/* =========================================================================
   CAPTION & TAG EDITOR MODULE
   Controla exclusivamente as tags separadas por vírgula e o Danbooru Autocomplete
========================================================================= */

const style = document.createElement('style');
style.innerHTML = `
    .db-autocomplete { position: absolute; bottom: 100%; top: auto; left: 0; background: #111; border: 1px solid #333; z-index: 100; border-radius: 6px 6px 0 0; max-height: 200px; overflow-y: auto; width: 100%; box-shadow: 0 -4px 12px rgba(0,0,0,0.8); margin-bottom: 4px; }
    .db-sugg-item { padding: 8px 10px; border-bottom: 1px solid #222; cursor: pointer; display: flex; justify-content: space-between; font-size: 12px; }
    .db-sugg-item:hover { background: #222; }
    
    /* ESTILOS DE CONFLITO (VERMELHO) */
    .tag-row.conflict, .master-tag-item.conflict { background: rgba(200, 40, 40, 0.3) !important; border-left: 3px solid #ff4444 !important; }
    .tag-row.conflict:hover, .master-tag-item.conflict:hover { background: rgba(200, 40, 40, 0.5) !important; }
    .conflict-warning { margin-left: 12px; font-size: 10px; color: #ffaaaa; background: #330000; padding: 2px 8px; border-radius: 12px; border: 1px solid #ff4444; cursor: help; transition: 0.2s; white-space: nowrap; user-select: none; display: inline-block;}
    .conflict-warning:hover { background: #660000; color: #fff; box-shadow: 0 0 8px #ff4444; }
    .tag-row.glow-conflict { background: rgba(255, 68, 68, 0.6) !important; box-shadow: inset 0 0 12px #ff4444 !important; border-left: 3px solid #ff4444 !important; transition: 0.1s; }

    /* ESTILOS DE REDUNDÂNCIA/SIMILARIDADE (AMARELO) */
    .tag-row.similar, .master-tag-item.similar { background: rgba(200, 150, 40, 0.2) !important; border-left: 3px solid #ffcc00 !important; }
    .tag-row.similar:hover, .master-tag-item.similar:hover { background: rgba(200, 150, 40, 0.4) !important; }
    .similar-warning { margin-left: 12px; font-size: 10px; color: #ffeeaa; background: #332200; padding: 2px 8px; border-radius: 12px; border: 1px solid #ffcc00; cursor: help; transition: 0.2s; white-space: nowrap; user-select: none; display: inline-block;}
    .similar-warning:hover { background: #664400; color: #fff; box-shadow: 0 0 8px #ffcc00; }
    .tag-row.glow-similar { background: rgba(255, 170, 0, 0.4) !important; box-shadow: inset 0 0 12px #ffcc00 !important; border-left: 3px solid #ffeedd !important; transition: 0.1s; }
`;
document.head.appendChild(style);

window.addEventListener('DOMContentLoaded', () => {
    setupDanbooruAutocomplete('active-add-input');
    setupDanbooruAutocomplete('master-add-input');
    setupDanbooruAutocomplete('preset-add-input');
});

const CAT_COLORS = { 0: "#aaa", 1: "#f9a825", 3: "#ae80ff", 4: "#5bc0de", 5: "#888" };

function setupDanbooruAutocomplete(inputId) {
    const input = document.getElementById(inputId);
    if(!input) return;
    
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.flex = 'none';
    
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    
    const suggBox = document.createElement('div');
    suggBox.className = 'db-autocomplete';
    suggBox.style.display = 'none';
    wrapper.appendChild(suggBox);

    let timeout = null;
    input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        const val = e.target.value.trim().toLowerCase().replace(/ /g, '_');
        if(val.length < 2) { suggBox.style.display = 'none'; return; }
        
        timeout = setTimeout(async () => {
            try {
                const res = await fetch(`https://danbooru.donmai.us/tags.json?search[name_matches]=*${val}*&limit=6&search[order]=count`);
                const tags = await res.json();
                suggBox.innerHTML = '';
                if(tags.length === 0) { suggBox.style.display = 'none'; return; }
                
                tags.forEach(t => {
                    const div = document.createElement('div');
                    div.className = 'db-sugg-item';
                    const color = CAT_COLORS[t.category] || "#aaa";
                    div.innerHTML = `
                        <span style="color:${color}; font-weight:bold;">${t.name.replace(/_/g, ' ')}</span>
                        <span style="color:#666;">${Number(t.post_count).toLocaleString()}</span>
                    `;
                    div.onclick = () => {
                        input.value = t.name.replace(/_/g, ' ');
                        suggBox.style.display = 'none';
                        input.focus();
                    };
                    suggBox.appendChild(div);
                });
                suggBox.style.display = 'block';
            } catch(err) {}
        }, 400);
    });

    document.addEventListener('click', (e) => {
        if(!wrapper.contains(e.target)) suggBox.style.display = 'none';
    });
}

/* === FUNÇÃO GLOBAL PARA CHECAR CONFLITOS E SIMILARIDADES ANTES DE ADICIONAR === */
window.checkTagStatusWithActive = function(tag) {
    if (!window.sortedActiveTags || !window.sortedActiveTags.length) return { conflicts: [], similars: [] };
    const tagLower = tag.toLowerCase();
    let conflicts = [];
    let similars = [];
    
    // Checa conflitos vermelhos
    (window.tagConflicts || []).forEach(group => {
        const groupLower = group.map(g => g.toLowerCase());
        if (groupLower.includes(tagLower)) {
            let activeInGroup = groupLower.filter(t => window.sortedActiveTags.some(at => at.toLowerCase() === t));
            let others = activeInGroup.filter(t => t !== tagLower);
            if (others.length > 0) conflicts.push(...others);
        }
    });

    // Checa redundâncias amarelas
    (window.tagSimilar || []).forEach(group => {
        const groupLower = group.map(g => g.toLowerCase());
        if (groupLower.includes(tagLower)) {
            let activeInGroup = groupLower.filter(t => window.sortedActiveTags.some(at => at.toLowerCase() === t));
            let others = activeInGroup.filter(t => t !== tagLower);
            if (others.length > 0) similars.push(...others);
        }
    });

    return { 
        conflicts: [...new Set(conflicts)], 
        similars: [...new Set(similars)] 
    };
};


/* === GERENCIADOR GERAL DO PAINEL CENTRAL === */
window.showOnlyActiveGhosts = false;
window.toggleActiveGhostFilter = function() {
    window.showOnlyActiveGhosts = !window.showOnlyActiveGhosts;
    const btn = document.getElementById('btn-filter-active-ghosts');
    if (btn) {
        btn.classList.toggle('active', window.showOnlyActiveGhosts);
        btn.style.background = window.showOnlyActiveGhosts ? '#00aa66' : 'transparent';
        btn.style.color = window.showOnlyActiveGhosts ? '#000' : '#00ff99';
    }
    renderEditor();
}

function renderEditor() {
    const topbarSelectFormat = document.getElementById('topbar-save-format');
    const topbarSelectType = document.getElementById('topbar-system-type');
    const colTools = document.getElementById('col-tools');
    const colPresets = document.getElementById('col-presets');
    
    const presetsVisible = colPresets && colPresets.style.display !== 'none';
    
    if (selectedIndices.size === 0) {
        window.sortedActiveTags = []; 
        topbarSelectFormat.style.display = 'none'; topbarSelectType.style.display = 'none';
        colTools.style.display = 'flex';
        if (typeof window.updateActiveSuggestVisibility === 'function') window.updateActiveSuggestVisibility();
        return;
    }

    const imgObj = imageFiles[Array.from(selectedIndices)[0]];
    if (typeof window.updateActiveSuggestVisibility === 'function') window.updateActiveSuggestVisibility();

    topbarSelectType.value = imgObj.type || 'tags';
    topbarSelectFormat.value = imgObj.ext || 'txt';

    let isAnyEmpty = false;
    selectedIndices.forEach(idx => { if (!imageFiles[idx].hasFile) isAnyEmpty = true; });
    
    const typeToggle = document.getElementById('toggle-type-select');
    const formatToggle = document.getElementById('toggle-format-select');

    if (isAnyEmpty) {
        if(typeToggle) typeToggle.checked = true;
        if(formatToggle) formatToggle.checked = true;
        topbarSelectType.style.display = 'inline-block';
        topbarSelectFormat.style.display = 'inline-block';
    } else {
        topbarSelectType.style.display = (typeToggle && typeToggle.checked) ? 'inline-block' : 'none';
        topbarSelectFormat.style.display = (formatToggle && formatToggle.checked) ? 'inline-block' : 'none';
    }

    const badge = document.getElementById('editor-type-badge');
    const tagsContainer = document.getElementById('tags-editor-container');
    const nlContainer = document.getElementById('nl-editor-container');
    const activeAddContainer = document.getElementById('active-add-container');
    const activeActions = document.getElementById('active-selection-actions');

    if (imgObj.type === 'nl') {
        badge.textContent = 'Natural Language'; 
        tagsContainer.style.display = 'none'; 
        activeAddContainer.style.display = 'none'; 
        activeActions.style.display = 'none'; 
        
        colTools.style.display = 'none'; 
        if(colPresets) {
            colPresets.style.display = 'none';
            const btn = document.getElementById('btn-toggle-presets');
            if(btn) { btn.style.background = 'transparent'; btn.style.color = '#00ff99'; }
        }
        
        nlContainer.style.display = 'flex';
        
        if (typeof window.renderNLEditor === 'function') window.renderNLEditor(imgObj);
        return;
    } 
    
    badge.textContent = 'Comma Tags'; 
    nlContainer.style.display = 'none'; 
    tagsContainer.style.display = 'flex'; 
    activeAddContainer.style.display = 'flex'; 
    
    colTools.style.display = 'flex'; 
    activeActions.style.display = activeSelectedTags.size > 0 ? 'flex' : 'none';
    
    const tagListVertical = document.getElementById('tag-list-vertical');
    tagListVertical.innerHTML = '';
    
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
    sortedActiveTags = window.sortedActiveTags;
    
    let favTags = new Set(datasetConfig.favoriteTags || []);
    const isMultiSelected = activeSelectedTags.size > 1; 
    const isMultiImageSelection = selectedIndices.size > 1;
    
    if (!window.showOnlyActiveGhosts) {
        sortedActiveTags.forEach((tag, i) => {
            const isFav = favTags.has(tag);
            
            // VERIFICAÇÃO DE STATUS (Vermelho ou Amarelo)
            let conflictsForThisTag = [];
            let similarsForThisTag = [];
            const tagLower = tag.toLowerCase();

            (window.tagConflicts || []).forEach(group => {
                const groupLower = group.map(g => g.toLowerCase());
                if (groupLower.includes(tagLower)) {
                    let activeInGroup = groupLower.filter(t => sortedActiveTags.some(at => at.toLowerCase() === t));
                    let others = activeInGroup.filter(t => t !== tagLower);
                    if (others.length > 0) conflictsForThisTag.push(...others);
                }
            });

            (window.tagSimilar || []).forEach(group => {
                const groupLower = group.map(g => g.toLowerCase());
                if (groupLower.includes(tagLower)) {
                    let activeInGroup = groupLower.filter(t => sortedActiveTags.some(at => at.toLowerCase() === t));
                    let others = activeInGroup.filter(t => t !== tagLower);
                    if (others.length > 0) similarsForThisTag.push(...others);
                }
            });

            conflictsForThisTag = [...new Set(conflictsForThisTag)];
            similarsForThisTag = [...new Set(similarsForThisTag)];

            const row = document.createElement('div'); 
            row.className = 'tag-row'; 
            row.setAttribute('data-tag-name', tagLower); 
            
            if (activeSelectedTags.has(tag)) row.classList.add('selected-active');
            
            // PRIORIDADE PARA O VERMELHO (CONFLITO GRAVE) - O AMARELO NÃO PINTA A LINHA PARA EVITAR POLUIÇÃO VISUAL
            if (conflictsForThisTag.length > 0) row.classList.add('conflict');
            
            let statusHtml = '';
            if (conflictsForThisTag.length > 0) {
                statusHtml += `<span class="conflict-warning" title="Conflict with: ${conflictsForThisTag.join(', ')}">⚠️ Conflict: ${conflictsForThisTag.join(', ')}</span>`;
            }
            if (similarsForThisTag.length > 0) {
                statusHtml += `<span class="similar-warning" title="Similar/Redundant to: ${similarsForThisTag.join(', ')}">🟨 Similar: ${similarsForThisTag.join(', ')}</span>`;
            }
            
            row.innerHTML = `<div class="tag-row-left">
                <span class="tag-star" style="color: ${isFav ? '#00ff99' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Favorite/Unfavorite">${isFav ? '⭐' : '☆'}</span>
                <span class="tag-save-preset" style="display: ${presetsVisible ? 'inline' : 'none'}; color: #4db8ff; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Save to Global Presets">💾</span>
                <span class="tag-name">${tag}</span>
                ${statusHtml}
            </div><span class="tag-remove" title="Remove Tag">&times;</span>`;
            
            if (!isMultiSelected && !isMultiImageSelection) {
                row.draggable = true;
                row.ondragstart = (e) => { 
                    if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star') || e.target.classList.contains('tag-save-preset') || e.target.classList.contains('conflict-warning') || e.target.classList.contains('similar-warning')) return false;
                    e.dataTransfer.setData('text/plain', i); draggedTagIndex = i; row.classList.add('dragging'); 
                };
                row.ondragend = () => { row.classList.remove('dragging'); draggedTagIndex = null; };
                row.ondragover = (e) => e.preventDefault();
                row.ondrop = (e) => { e.preventDefault(); if (draggedTagIndex !== null && draggedTagIndex !== i) reorderTags(draggedTagIndex, i); };
            }

            // EFEITO DE HOVER NOS AVISOS (Brilha as outras tags envolvidas)
            if (conflictsForThisTag.length > 0) {
                const warningSpan = row.querySelector('.conflict-warning');
                if(warningSpan) {
                    warningSpan.onmouseenter = () => {
                        conflictsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.add('glow-conflict');
                        });
                    };
                    warningSpan.onmouseleave = () => {
                        conflictsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.remove('glow-conflict');
                        });
                    };
                }
            }

            if (similarsForThisTag.length > 0) {
                const simSpan = row.querySelector('.similar-warning');
                if(simSpan) {
                    simSpan.onmouseenter = () => {
                        similarsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.add('glow-similar');
                        });
                    };
                    simSpan.onmouseleave = () => {
                        similarsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.remove('glow-similar');
                        });
                    };
                }
            }

            const starEl = row.querySelector('.tag-star');
            starEl.onclick = async (e) => {
                e.stopPropagation();
                const currentlyFav = favTags.has(tag);
                if (currentlyFav) favTags.delete(tag); else favTags.add(tag);
                
                datasetConfig.favoriteTags = Array.from(favTags);
                if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
                
                starEl.textContent = currentlyFav ? '☆' : '⭐';
                starEl.style.color = currentlyFav ? '#444' : '#00ff99';
                
                if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            };

            const presetBtn = row.querySelector('.tag-save-preset');
            if (presetBtn) {
                presetBtn.onclick = (e) => {
                    e.stopPropagation();
                    if(typeof window.savePresetTag === 'function') {
                        window.savePresetTag(tag);
                        window.showAlert(`Tag "${tag}" saved to Presets!`, 'success');
                    }
                };
            }

            row.onclick = (e) => {
                if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star') || e.target.classList.contains('tag-save-preset') || e.target.classList.contains('conflict-warning') || e.target.classList.contains('similar-warning')) { 
                    if(e.target.classList.contains('tag-remove')) { e.stopPropagation(); removeTagFromSelected(tag); }
                    return; 
                }
                if (e.shiftKey && activeSelectedTags.size > 0) {
                    const start = Math.min(lastSelectedActiveTagIndex, i), end = Math.max(lastSelectedActiveTagIndex, i);
                    activeSelectedTags.clear(); 
                    for (let j = start; j <= end; j++) activeSelectedTags.add(sortedActiveTags[j]);
                } else if (e.ctrlKey || e.metaKey) {
                    if (activeSelectedTags.has(tag)) activeSelectedTags.delete(tag); else activeSelectedTags.add(tag);
                    lastSelectedActiveTagIndex = i;
                } else {
                    if (activeSelectedTags.has(tag) && activeSelectedTags.size === 1) {
                        activeSelectedTags.clear();
                    } else {
                        activeSelectedTags.clear(); activeSelectedTags.add(tag); lastSelectedActiveTagIndex = i;
                    }
                }
                renderEditor();
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
        const label = document.createElement('div');
        label.className = 'ghost-section-label';
        label.textContent = '💡 Pending Suggestions';
        tagListVertical.appendChild(label);

        Array.from(fusedPending).sort().forEach(tag => {
            const row = document.createElement('div');
            row.className = 'tag-row ghost';
            row.innerHTML = `<div class="tag-row-left">
                <span class="tag-name">${tag}</span>
            </div><span class="tag-ghost-accept" title="Accept suggestion">✓</span>`;
            row.querySelector('.tag-ghost-accept').onclick = (e) => {
                e.stopPropagation();
                acceptGhostTagActive(tag);
            };
            tagListVertical.appendChild(row);
        });
    }
}

function acceptGhostTagActive(tag) {
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
    addTagToSelected(tag, document.getElementById('active-add-pos') ? document.getElementById('active-add-pos').value : 'bottom');
    if (typeof savePendingTagsStore === 'function') {
        const handle = window.currentImagesHandle || window.rootHandle;
        savePendingTagsStore(handle);
    }
}

window.discardActiveSuggestions = async function() {
    if (selectedIndices.size === 0) return;
    const affected = Array.from(selectedIndices)
        .map(idx => imageFiles[idx])
        .filter(img => img.pendingAdd && img.pendingAdd.length > 0);

    if (affected.length === 0) return;

    if (!confirm(`Discard pending suggestions for ${affected.length} selected image(s)? This cannot be undone.`)) return;

    affected.forEach(img => {
        img.pendingAdd = [];
        if (typeof pendingTagsStore !== 'undefined') delete pendingTagsStore[img.baseName];
    });

    const handle = window.currentImagesHandle || window.rootHandle;
    if (typeof savePendingTagsStore === 'function') await savePendingTagsStore(handle);

    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    if (typeof window.updateSuggestFilterVisibility === 'function') window.updateSuggestFilterVisibility();

    showAlert(`Discarded suggestions for ${affected.length} image(s).`, "success");
};

window.updateActiveSuggestVisibility = function() {
    const btnDiscard = document.getElementById('btn-discard-active-suggestions');
    const btnFilter = document.getElementById('btn-filter-active-ghosts');
    
    const anyPending = Array.from(selectedIndices).some(idx => {
        const img = imageFiles[idx];
        return img && img.pendingAdd && img.pendingAdd.length > 0;
    });
    
    if (btnDiscard) btnDiscard.style.display = anyPending ? 'inline-flex' : 'none';
    
    if (btnFilter) {
        btnFilter.style.display = anyPending ? 'inline-flex' : 'none';
        if (!anyPending && window.showOnlyActiveGhosts) {
            window.showOnlyActiveGhosts = false;
            btnFilter.classList.remove('active');
            btnFilter.style.background = 'transparent';
            btnFilter.style.color = '#00ff99';
        }
    }
};

function removeTagFromSelected(tagToRemove) {
    selectedIndices.forEach(idx => {
        if (imageFiles[idx].type === 'tags') imageFiles[idx].content = imageFiles[idx].content.split(',').map(t => t.trim()).filter(t => t && t !== tagToRemove).join(', ');
    });
    
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
}

function removeSelectedActiveTags() {
    if (activeSelectedTags.size === 0) return;
    const tagsToRemove = Array.from(activeSelectedTags);
    selectedIndices.forEach(idx => {
        if (imageFiles[idx].type === 'tags' && imageFiles[idx].hasFile) {
            let currentTags = imageFiles[idx].content.split(',').map(t => t.trim()).filter(t => t);
            currentTags = currentTags.filter(t => !tagsToRemove.includes(t));
            imageFiles[idx].content = currentTags.join(', ');
        }
    });
    activeSelectedTags.clear();
    
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
}

function clearActiveSelection() { activeSelectedTags.clear(); renderEditor(); }

function addTagToSelected(newTag, position = 'bottom') {
    const tag = newTag.trim(); if(!tag) return;
    selectedIndices.forEach(idx => {
        if (imageFiles[idx].type === 'tags' || !imageFiles[idx].hasFile) {
            let tags = imageFiles[idx].content.split(',').map(t => t.trim()).filter(t => t);
            if (!tags.includes(tag)) { position === 'top' ? tags.unshift(tag) : tags.push(tag); }
            imageFiles[idx].content = tags.join(', '); imageFiles[idx].hasFile = true; imageFiles[idx].type = 'tags';
            if(!imageFiles[idx].ext) imageFiles[idx].ext = document.getElementById('topbar-save-format').value;
        }
    });
    masterTagSet.add(tag); 
    
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    renderMasterTagList(); 
    renderEditor(); 
    refreshListStatus();
    if (typeof window.applyFilters === 'function') window.applyFilters();
}

function addTagToAllImages(newTag, position = 'bottom') {
    const tag = newTag.trim(); if(!tag) return;
    imageFiles.forEach(img => {
        if (img.hidden) return;
        if (img.type === 'tags' || !img.hasFile) {
            let tags = img.content ? img.content.split(',').map(t => t.trim()).filter(t => t) : [];
            if (!tags.includes(tag)) { position === 'top' ? tags.unshift(tag) : tags.push(tag); }
            img.content = tags.join(', ');
            img.hasFile = true;
            img.type = 'tags';
            if(!img.ext) img.ext = document.getElementById('topbar-save-format').value;
        }
    });
    masterTagSet.add(tag);

    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    renderMasterTagList();
    renderEditor();
    refreshListStatus();
    if (typeof window.applyFilters === 'function') window.applyFilters();
}

function reorderTags(fromIndex, toIndex) {
    selectedIndices.forEach(idx => {
        if (imageFiles[idx].type === 'tags') {
            let tags = imageFiles[idx].content.split(',').map(t => t.trim()).filter(t => t);
            tags.splice(toIndex, 0, tags.splice(fromIndex, 1)[0]);
            imageFiles[idx].content = tags.join(', ');
        }
    });
    renderEditor();
}

function inlineAdd(source) {
    const input = document.getElementById(`${source}-add-input`);
    const pos = document.getElementById(`${source}-add-pos`).value;
    const tagsToAdd = input.value.split(',').map(t => t.trim()).filter(t => t);
    if(tagsToAdd.length === 0) return;

    if (source === 'master') {
        tagsToAdd.forEach(t => addTagToAllImages(t, pos));
    } else {
        tagsToAdd.forEach(t => addTagToSelected(t, pos));
    }
    input.value = '';
    
    if (source === 'active' && window.activeSearchMode) window.filterActiveTagsByName('');
    if (source === 'master' && window.masterSearchMode) window.filterMasterTagsByName('');
}

/* === COL 3: MASTER LIST & FILTERS === */
window.showOnlyFavoriteTags = false;

window.toggleFavTagsFilter = function() {
    window.showOnlyFavoriteTags = !window.showOnlyFavoriteTags;
    const btn = document.getElementById('btn-filter-fav-tags');
    if (window.showOnlyFavoriteTags) {
        btn.style.color = '#00ff99';
        btn.style.borderColor = '#00aa66';
        btn.textContent = '⭐';
    } else {
        btn.style.color = '#888';
        btn.style.borderColor = '#444';
        btn.textContent = '☆';
    }
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
};

function renderMasterTagList() {
    const container = document.getElementById('master-tag-list'); container.innerHTML = '';
    
    const presetCol = document.getElementById('col-presets');
    const presetsVisible = presetCol && presetCol.style.display !== 'none';
    
    let tagCounts = new Map();
    imageFiles.forEach(img => {
        if (img.hidden) return;
        if (img.type === 'tags' && img.hasFile) {
            img.content.split(',').forEach(t => {
                const cleanTag = t.trim();
                if (cleanTag) tagCounts.set(cleanTag, (tagCounts.get(cleanTag) || 0) + 1);
            });
        }
    });

    let favTags = new Set(datasetConfig.favoriteTags || []);
    sortedMasterTags = Array.from(masterTagSet).sort();
    
    if (!window.showGhostTagsInList) {
        sortedMasterTags.forEach((tag, index) => {
            const count = tagCounts.get(tag) || 0;
            if (count === 0) return;
            
            const isFav = favTags.has(tag);
            if (window.showOnlyFavoriteTags && !isFav) return;

            const item = document.createElement('div'); item.className = 'master-tag-item';
            
            let isSelected = masterSelectedTags.has(tag);
            let statusHtml = '';
            let conflictsForThisTag = [];
            let similarsForThisTag = [];

            // ALERTA DE CONFLITO/SIMILARIDADE (CONSULTANDO A ACTIVE IMAGE)
            if (isSelected) {
                item.classList.add('selected-master');
                if (typeof window.checkTagStatusWithActive === 'function') {
                    const status = window.checkTagStatusWithActive(tag);
                    conflictsForThisTag = status.conflicts;
                    similarsForThisTag = status.similars;

                    if (conflictsForThisTag.length > 0) {
                        item.classList.add('conflict');
                        statusHtml += `<span class="conflict-warning" title="Conflict with: ${conflictsForThisTag.join(', ')}">⚠️ Conflict: ${conflictsForThisTag.join(', ')}</span>`;
                    } else if (similarsForThisTag.length > 0) {
                        item.classList.add('similar');
                        statusHtml += `<span class="similar-warning" title="Similar/Redundant to: ${similarsForThisTag.join(', ')}">🟨 Similar: ${similarsForThisTag.join(', ')}</span>`;
                    }
                }
            }
            
            item.innerHTML = `
                <div style="display:flex; align-items:center; overflow:hidden; flex:1;">
                    <span class="tag-star" style="color: ${isFav ? '#00ff99' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Favorite/Unfavorite">${isFav ? '⭐' : '☆'}</span>
                    <span class="tag-save-preset" style="display: ${presetsVisible ? 'inline' : 'none'}; color: #4db8ff; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Save to Global Presets">💾</span>
                    <span style="color:#555; font-size:10px; font-weight:bold; min-width:22px; text-align:left; margin-right:8px; user-select:none;">${count}</span>
                    <span class="tag-name">${tag}</span>
                    ${statusHtml}
                </div>
                <span class="tag-remove" title="Global Remove">&times;</span>
            `;

            // EFEITO HOVER CONSULTANDO A ACTIVE LIST
            if (conflictsForThisTag.length > 0) {
                const warningSpan = item.querySelector('.conflict-warning');
                if(warningSpan) {
                    warningSpan.onmouseenter = () => {
                        conflictsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.add('glow-conflict');
                        });
                    };
                    warningSpan.onmouseleave = () => {
                        conflictsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.remove('glow-conflict');
                        });
                    };
                }
            }

            if (similarsForThisTag.length > 0) {
                const simSpan = item.querySelector('.similar-warning');
                if(simSpan) {
                    simSpan.onmouseenter = () => {
                        similarsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.add('glow-similar');
                        });
                    };
                    simSpan.onmouseleave = () => {
                        similarsForThisTag.forEach(ct => {
                            const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(ct)}"]`);
                            if (targetRow) targetRow.classList.remove('glow-similar');
                        });
                    };
                }
            }
            
            const starEl = item.querySelector('.tag-star');
            starEl.onclick = async (e) => {
                e.stopPropagation();
                const currentlyFav = favTags.has(tag);
                if (currentlyFav) favTags.delete(tag); else favTags.add(tag);
                
                datasetConfig.favoriteTags = Array.from(favTags);
                if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited(); 
                
                if (window.showOnlyFavoriteTags && currentlyFav) {
                    item.style.display = 'none';
                } else {
                    starEl.textContent = currentlyFav ? '☆' : '⭐';
                    starEl.style.color = currentlyFav ? '#444' : '#00ff99';
                }
                
                if (selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
            };

            const presetBtn = item.querySelector('.tag-save-preset');
            if (presetBtn) {
                presetBtn.onclick = (e) => {
                    e.stopPropagation();
                    if(typeof window.savePresetTag === 'function') {
                        window.savePresetTag(tag);
                        window.showAlert(`Tag "${tag}" saved to Presets!`, 'success');
                    }
                };
            }
            
            item.ondblclick = (e) => { e.stopPropagation(); addTagToSelected(tag, document.getElementById('master-add-pos').value); };
            
            item.onclick = (e) => {
                if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star') || e.target.classList.contains('tag-save-preset') || e.target.classList.contains('conflict-warning') || e.target.classList.contains('similar-warning')) { 
                    if(e.target.classList.contains('tag-remove')) { e.stopPropagation(); globalRemoveTags([tag]); }
                    return; 
                }
                
                if (e.shiftKey && masterSelectedTags.size > 0) {
                    const start = Math.min(lastSelectedMasterTagIndex, index), end = Math.max(lastSelectedMasterTagIndex, index);
                    masterSelectedTags.clear(); for (let i = start; i <= end; i++) masterSelectedTags.add(sortedMasterTags[i]);
                } else if (e.ctrlKey || e.metaKey) {
                    if (masterSelectedTags.has(tag)) masterSelectedTags.delete(tag); else masterSelectedTags.add(tag);
                    lastSelectedMasterTagIndex = index;
                } else {
                    if (masterSelectedTags.has(tag) && masterSelectedTags.size === 1) {
                        masterSelectedTags.clear();
                    } else {
                        masterSelectedTags.clear(); masterSelectedTags.add(tag); lastSelectedMasterTagIndex = index;
                    }
                }
                
                renderMasterTagList(); applyFilters(); updateSelectionActions();
            };
            container.appendChild(item);
        });
    }

    let pendingCounts = new Map(); 
    imageFiles.forEach(img => {
        if (img.hidden) return;
        if (img.pendingAdd && img.pendingAdd.length) {
            img.pendingAdd.forEach(t => pendingCounts.set(t, (pendingCounts.get(t) || 0) + 1));
        }
    });

    sortedGhostTags = Array.from(pendingCounts.keys()).sort();

    if (window.showGhostTagsInList && sortedGhostTags.length > 0) {
        const label = document.createElement('div');
        label.className = 'ghost-section-label';
        label.textContent = '💡 Pending Suggestions';
        container.appendChild(label);

        sortedGhostTags.forEach((tag, gIndex) => {
            const count = pendingCounts.get(tag);
            const item = document.createElement('div');
            item.className = 'master-tag-item ghost';
            if (masterSelectedGhostTags.has(tag)) item.classList.add('selected-master');
            item.innerHTML = `
                <div style="display:flex; align-items:center; overflow:hidden; flex:1;">
                    <span style="color:#00aa66; font-size:10px; font-weight:bold; min-width:22px; text-align:left; margin-right:8px; user-select:none;">${count}</span>
                    <span class="tag-name">${tag}</span>
                </div>
                <span class="tag-ghost-accept" title="Accept for all images that suggested it">✓</span>
            `;
            item.querySelector('.tag-ghost-accept').onclick = (e) => {
                e.stopPropagation();
                acceptGhostTagGlobal(tag);
            };
            item.onclick = (e) => {
                if (e.target.classList.contains('tag-ghost-accept')) return;

                if (e.shiftKey && masterSelectedGhostTags.size > 0) {
                    const start = Math.min(lastSelectedGhostTagIndex, gIndex), end = Math.max(lastSelectedGhostTagIndex, gIndex);
                    masterSelectedGhostTags.clear(); for (let i = start; i <= end; i++) masterSelectedGhostTags.add(sortedGhostTags[i]);
                } else if (e.ctrlKey || e.metaKey) {
                    if (masterSelectedGhostTags.has(tag)) masterSelectedGhostTags.delete(tag); else masterSelectedGhostTags.add(tag);
                    lastSelectedGhostTagIndex = gIndex;
                } else {
                    if (masterSelectedGhostTags.has(tag) && masterSelectedGhostTags.size === 1) {
                        masterSelectedGhostTags.clear();
                    } else {
                        masterSelectedGhostTags.clear(); masterSelectedGhostTags.add(tag); lastSelectedGhostTagIndex = gIndex;
                    }
                }

                renderMasterTagList(); applyFilters(); updateSelectionActions();
            };
            container.appendChild(item);
        });
    }

    if (typeof window.updateSuggestFilterVisibility === 'function') window.updateSuggestFilterVisibility();
    if (window.masterSearchMode) window.filterMasterTagsByName(document.getElementById('master-add-input').value);
}

function acceptGhostTagGlobal(tag) {
    const globalExt = document.getElementById('topbar-save-format').value;
    let count = 0;
    imageFiles.forEach(img => {
        if (img.hidden) return;
        if (img.pendingAdd && img.pendingAdd.includes(tag)) {
            img.pendingAdd = img.pendingAdd.filter(t => t !== tag);
            if (typeof pendingTagsStore !== 'undefined') {
                if (img.pendingAdd.length > 0) pendingTagsStore[img.baseName] = img.pendingAdd;
                else delete pendingTagsStore[img.baseName];
            }
            if (img.type === 'tags' || !img.hasFile) {
                let tags = img.content ? img.content.split(',').map(t => t.trim()).filter(t => t) : [];
                if (!tags.includes(tag)) tags.push(tag);
                img.content = tags.join(', ');
                img.hasFile = true;
                img.type = 'tags';
                if (!img.ext) img.ext = globalExt;
                count++;
            }
        }
    });
    masterTagSet.add(tag);
    masterSelectedGhostTags.delete(tag);

    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    renderMasterTagList();
    if (selectedIndices.size > 0) renderEditor();
    refreshListStatus();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    if (typeof savePendingTagsStore === 'function') {
        const handle = window.currentImagesHandle || window.rootHandle;
        savePendingTagsStore(handle);
    }
    showAlert(`Tag "${tag}" accepted on ${count} images. Press Ctrl+S to save to disk.`, 'success');
}

function setLogic(mode) {
    const btn = document.getElementById('btn-logic-' + mode);
    if (btn && btn.classList.contains('active')) {
        btn.classList.remove('active');
        window.filterMode = 'NONE';
    } else {
        document.querySelectorAll('.logic-btn').forEach(b => b.classList.remove('active'));
        if(btn) btn.classList.add('active');
        window.filterMode = mode;
    }

    if (typeof window.applyFilters === 'function') {
        window.applyFilters();
    }
}

function applyFilters() {
    if (!window.currentImagesHandle && !window.rootHandle) return;
    imageFiles.forEach(img => {
        if (img.hidden) {
            if (img.element) img.element.style.display = 'none';
            return;
        }

        let visible = true;
        const totalSelected = masterSelectedTags.size + masterSelectedGhostTags.size;
        
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
            } else { visible = false; }
        }
        if(img.element) img.element.style.display = visible ? 'flex' : 'none';
    });
}

function clearFilters() { masterSelectedTags.clear(); updateSelectionActions(); renderMasterTagList(); setLogic('AND'); }

function updateSelectionActions() {
    const bar = document.getElementById('master-selection-actions');
    bar.style.display = masterSelectedTags.size > 0 ? 'flex' : 'none';
}

function removeSelectedMasterTags() {
    if(masterSelectedTags.size === 0) return;
    if(confirm(`Remove ${masterSelectedTags.size} tags globally?`)) globalRemoveTags(Array.from(masterSelectedTags));
}

function addSelectedMasterTagsTo(target) {
    if(masterSelectedTags.size === 0) return;
    const pos = document.getElementById('master-add-pos').value;
    const tagsToAdd = Array.from(masterSelectedTags);
    const globalExt = document.getElementById('topbar-save-format').value;
    
    let targets = [];
    if (target === 'selected') {
        targets = Array.from(selectedIndices);
        if(targets.length === 0) { showAlert("No images selected on the left list.", "error"); return; }
    } else if (target === 'all') {
        targets = imageFiles.map((_, i) => i).filter(i => !imageFiles[i].hidden);
    }
    
    targets.forEach(idx => {
        if (imageFiles[idx].type === 'tags' || !imageFiles[idx].hasFile) {
            let currentTags = imageFiles[idx].content ? imageFiles[idx].content.split(',').map(t=>t.trim()).filter(t=>t) : [];
            tagsToAdd.forEach(tag => {
                if (!currentTags.includes(tag)) {
                    if (pos === 'top') currentTags.unshift(tag);
                    else currentTags.push(tag);
                }
            });
            imageFiles[idx].content = currentTags.join(', ');
            imageFiles[idx].hasFile = true;
            imageFiles[idx].type = 'tags';
            if(!imageFiles[idx].ext) imageFiles[idx].ext = globalExt;
        }
    });
    
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    renderMasterTagList();
    renderEditor();
    refreshListStatus();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    showAlert(`Added ${tagsToAdd.length} tags to ${targets.length} images.`);
}

function globalRemoveTags(tagsToRemove) {
    if(!tagsToRemove || tagsToRemove.length === 0) return;
    let changed = 0;
    
    imageFiles.forEach(img => {
        if (img.hidden) return;
        if(img.type === 'tags') {
            let currentTags = img.content.split(',').map(t => t.trim()).filter(t => t);
            let originalLen = currentTags.length;
            currentTags = currentTags.filter(t => !tagsToRemove.includes(t));
            if(currentTags.length !== originalLen) { img.content = currentTags.join(', '); changed++; }
        }
    });
    
    tagsToRemove.forEach(t => { masterTagSet.delete(t); masterSelectedTags.delete(t); });
    
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    updateSelectionActions(); 
    renderMasterTagList();
    if (selectedIndices.size > 0) renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    
    showAlert(`Globally removed tags from ${changed} images. Press Ctrl+S to save to disk.`, 'success');
}

/* === ACTIVE TAG TEXT FILTER === */
window.filterActiveTagsByName = function(val) {
    window.activeTagNameFilter = (val || '').trim().toLowerCase();
    applyActiveTagNameFilterToDOM();
};

function applyActiveTagNameFilterToDOM() {
    const container = document.getElementById('tag-list-vertical');
    if (!container) return;
    container.querySelectorAll('.tag-row').forEach(item => {
        const nameEl = item.querySelector('.tag-name');
        if (nameEl) {
            const text = nameEl.textContent.toLowerCase();
            item.style.display = (!window.activeTagNameFilter || text.includes(window.activeTagNameFilter)) ? 'flex' : 'none';
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('tag-list-vertical');
    if (container) {
        const observer = new MutationObserver(() => applyActiveTagNameFilterToDOM());
        observer.observe(container, { childList: true });
    }
});