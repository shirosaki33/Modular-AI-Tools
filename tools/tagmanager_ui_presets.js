/* =========================================================================
   UI LOGIC - USER PRESETS
   Handles categories, drag and drop reordering, and preset lists.
========================================================================= */

window.selectedPresetCategory = null;
window.presetCategoryCollapseState = {};

/* ---------------------------------------------------------------------
   Set em memória com o NOME de cada tag já salva nos User Presets
   (exclui as entradas "_sys_cat_*", que são só marcadores de categoria,
   não tags de verdade). Usado por tagmanager_caption_tag.js pra:
   1) esconder o ícone 💾 numa tag que já é preset (não faz sentido
      oferecer "salvar" de novo);
   2) destacar essa tag com uma cor própria (.is-preset) na lista da
      Active Image e em "All Dataset Tags", enquanto o painel de Presets
      estiver visível.
   Fica atualizado sempre que os Presets são renderizados (abrir o
   painel, salvar/remover uma tag, importar backup, etc.) — ver o fim de
   window.renderPresetTags() logo abaixo. */
window._presetTagsSet = window._presetTagsSet || new Set();

window.refreshPresetTagsSet = async function() {
    try {
        const items = await window.getPresetTags();
        window._presetTagsSet = new Set(
            items.map(i => i.tag).filter(t => !t.startsWith('_sys_cat_'))
        );
    } catch (e) {
        console.error('refreshPresetTagsSet failed:', e);
    }
    return window._presetTagsSet;
};

// Popula o set já no carregamento da página — sem isso, o ícone 💾 e o
// destaque .is-preset só ficariam corretos DEPOIS que o usuário abrisse
// o painel de Presets pela primeira vez (já que antes disso o set
// começaria vazio).
window.addEventListener('DOMContentLoaded', () => {
    window.refreshPresetTagsSet();
});

window.createPresetCategory = function() {
    const catName = prompt("Name the new category:");
    if (catName && catName.trim()) {
        window.savePresetTag(`_sys_cat_${catName.trim()}`, catName.trim());
    }
};

window.togglePresetPanel = function() {
    const panel = document.getElementById('col-presets');
    const resizer = document.getElementById('resizer-presets');
    const btn = document.getElementById('btn-toggle-presets');
    
    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'flex';
        if(resizer) resizer.style.display = 'flex';
        btn.style.background = '#00aa66';
        btn.style.color = '#000';
        window.renderPresetTags();
    } else {
        panel.style.display = 'none';
        if(resizer) resizer.style.display = 'none';
        btn.style.background = 'transparent';
        btn.style.color = '#00ff99';
    }

    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
};

window.filterPresetTagsByName = function(val) {
    window.presetTagNameFilter = (val || '').trim().toLowerCase();
    const container = document.getElementById('preset-tag-list');
    if (!container) return;
    container.querySelectorAll('.master-tag-item').forEach(item => {
        const nameEl = item.querySelector('.tag-name');
        if (nameEl) {
            const text = nameEl.textContent.toLowerCase();
            item.style.display = (!window.presetTagNameFilter || text.includes(window.presetTagNameFilter)) ? 'flex' : 'none';
        }
    });
};

window.updatePresetSelectionActions = function() {
    const bar = document.getElementById('preset-selection-actions');
    if (bar) bar.style.display = presetSelectedTags.size > 0 ? 'flex' : 'none';
};

window.removeSelectedPresetTags = function() {
    if (presetSelectedTags.size === 0) return;
    if (confirm(`Remove ${presetSelectedTags.size} tags from presets?`)) {
        presetSelectedTags.forEach(tag => window.deletePresetTag(tag));
        presetSelectedTags.clear();
        window.updatePresetSelectionActions();
    }
};

window.addSelectedPresetTagsTo = function(target) {
    if (presetSelectedTags.size === 0) return;
    const tagsToAdd = Array.from(presetSelectedTags);
    const globalExt = document.getElementById('topbar-save-format').value;
    
    let targets = [];
    if (target === 'selected') {
        targets = Array.from(selectedIndices);
        if(targets.length === 0) { window.showAlert("No images selected on the left list.", "error"); return; }
    } else if (target === 'all') {
        targets = imageFiles.map((_, i) => i).filter(i => !imageFiles[i].hidden);
    }
    
    targets.forEach(idx => {
        if (imageFiles[idx].type === 'tags' || !imageFiles[idx].hasFile) {
            let currentTags = imageFiles[idx].content ? imageFiles[idx].content.split(',').map(t=>t.trim()).filter(t=>t) : [];
            tagsToAdd.forEach(tag => {
                if (!currentTags.includes(tag)) currentTags.push(tag);
            });
            imageFiles[idx].content = currentTags.join(', ');
            imageFiles[idx].hasFile = true;
            imageFiles[idx].type = 'tags';
            if(!imageFiles[idx].ext) imageFiles[idx].ext = globalExt;
        }
    });
    window.markDirty(targets.map(idx => imageFiles[idx]));
	
	tagsToAdd.forEach(tag => { if (typeof masterTagSet !== 'undefined') masterTagSet.add(tag); });
    
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    window.showAlert(`Added ${tagsToAdd.length} preset tags to ${targets.length} images.`);
};

window.renameSelectedPresetCategory = async function() {
    const oldName = window.selectedPresetCategory;
    if (!oldName || oldName === 'Uncategorized') return;
    
    const newName = prompt(`Rename category "${oldName}" to:`, oldName);
    if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
    
    const newCat = newName.trim();
    const items = await window.getPresetTags();
    
    await window.deletePresetTag(`_sys_cat_${oldName}`, true);
    await window.savePresetTag(`_sys_cat_${newCat}`, newCat, true);
    
    for (let item of items) {
        if (item.category === oldName && !item.tag.startsWith('_sys_cat_')) {
            await window.savePresetTag(item.tag, newCat, true);
        }
    }
    
    window.selectedPresetCategory = newCat;
    window.presetCategoryCollapseState[newCat] = window.presetCategoryCollapseState[oldName];
    delete window.presetCategoryCollapseState[oldName];
    
    window.renderPresetTags(); 
    window.showAlert(`Category renamed to "${newCat}".`, "success");
};

window.deleteSelectedPresetCategory = async function() {
    const catName = window.selectedPresetCategory;
    if (!catName || catName === 'Uncategorized') return;
    
    if (!confirm(`Are you sure you want to delete the category "${catName}"?\nAny tags inside it will be moved to Uncategorized.`)) return;
    
    const items = await window.getPresetTags();
    await window.deletePresetTag(`_sys_cat_${catName}`, true);
    
    for (let item of items) {
        if (item.category === catName && !item.tag.startsWith('_sys_cat_')) {
            await window.savePresetTag(item.tag, 'Uncategorized', true);
        }
    }
    
    window.selectedPresetCategory = null;
    window.renderPresetTags(); 
    window.showAlert(`Category "${catName}" deleted.`, "info");
};

window.renderPresetTags = async function() {
    const container = document.getElementById('preset-tag-list');
    if (!container) return;
    container.innerHTML = '';
    
    const presetsHeader = document.querySelector('#col-presets .panel-header');
    if (presetsHeader) {
        presetsHeader.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="color: #00ff99;">🌟 User Presets</span>
            </div>
            <div style="display: flex; gap: 5px; align-items: center;">
                ${window.selectedPresetCategory && window.selectedPresetCategory !== 'Uncategorized' ? `
                    <button class="btn-save-local" onclick="window.renameSelectedPresetCategory()" style="background:transparent; border: 1px solid #4db8ff; color:#4db8ff; padding: 2px 6px; font-size: 14px;" title="Rename Selected Category">✏️</button>
                    <button class="btn-save-local" onclick="window.deleteSelectedPresetCategory()" style="background:transparent; border: 1px solid #ff4444; color:#ff4444; padding: 2px 6px; font-size: 14px;" title="Delete Selected Category">🗑️</button>
                ` : ''}
                <button class="btn-save-local" onclick="window.createPresetCategory()" style="background:transparent; border: 1px solid #00aa66; color:#00ff99; padding: 2px 6px; font-size: 14px;" title="New Category">➕</button>
            </div>
        `;
    }
    
    const items = await window.getPresetTags();

    // Atualiza o cache em memória usado por tagmanager_caption_tag.js pra
    // esconder o 💾 e destacar (.is-preset) tags que já são presets, tanto
    // na Active Image quanto em "All Dataset Tags".
    window._presetTagsSet = new Set(items.map(i => i.tag).filter(t => !t.startsWith('_sys_cat_')));
    
    if (items.length === 0) {
        container.innerHTML += '<div style="padding: 15px; text-align: center; color: #555; font-size: 11px;">No presets saved yet.</div>';
        refreshTagListsAfterPresetChange();
        return;
    }
    
    // Calcula a contagem de tags do Dataset atual para exibir ao lado dos presets
    let tagCounts = new Map();
    if (typeof imageFiles !== 'undefined') {
        imageFiles.forEach(img => {
            if (img.hidden) return;
            if (img.type === 'tags' && img.hasFile) {
                img.content.split(',').forEach(t => {
                    const cleanTag = t.trim();
                    if (cleanTag) tagCounts.set(cleanTag, (tagCounts.get(cleanTag) || 0) + 1);
                });
            }
        });
    }

    const categories = {};
    items.forEach(item => {
        if (!categories[item.category]) categories[item.category] = [];
        categories[item.category].push(item.tag);
    });
    
    let globalIndex = 0;
    let renderedPresetTags = [];
    
    let categoryOrder = await window.getSetting('preset-cat-order', []);
    let catKeys = Object.keys(categories);
    
    let orderChanged = false;
    for (let k of catKeys) {
        if (!categoryOrder.includes(k)) {
            categoryOrder.push(k);
            orderChanged = true;
        }
    }
    if (orderChanged) await window.saveSetting('preset-cat-order', categoryOrder);

    catKeys.sort((a, b) => {
        return categoryOrder.indexOf(a) - categoryOrder.indexOf(b);
    });
    
    catKeys.forEach(cat => {
        const catDiv = document.createElement('div');
        catDiv.style.marginBottom = '5px';
        
        const header = document.createElement('div');
        header.draggable = true;

        const isSelected = window.selectedPresetCategory === cat;
        const isCollapsed = window.presetCategoryCollapseState[cat] !== false; // Padrão é fechado (true)

        header.innerHTML = `
            <div style="display:flex; align-items:center; flex: 1;">
                <span style="margin-right: 8px; cursor: grab; color: #555;" title="Drag to reorder category">☰</span>
                <span style="color: ${isSelected ? '#4db8ff' : '#aaa'};">📁 ${cat}</span>
            </div>
            <div style="display:flex; align-items:center;">
                <div class="toggle-area" style="padding: 0 8px; cursor: pointer;">
                    <span class="toggle-icon" style="font-size:10px; color: ${isSelected ? '#4db8ff' : '#aaa'};">${isCollapsed ? '▼' : '▶'}</span>
                </div>
            </div>
        `;
        
        header.style.cssText = `background: ${isSelected ? '#0a2a4c' : '#222'}; border-left: ${isSelected ? '3px solid #4db8ff' : '3px solid transparent'}; padding: 8px 5px 8px 10px; font-weight: bold; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; border-top: 1px solid #333; border-bottom: 1px solid #111; transition: 0.2s;`;
        
        header.onclick = (e) => {
            // Se clicou na setinha, apenas abre ou fecha a categoria
            if (e.target.closest('.toggle-area')) {
                window.presetCategoryCollapseState[cat] = !isCollapsed;
            } else {
                // Se clicou no nome, seleciona/deseleciona a categoria
                if (window.selectedPresetCategory === cat) {
                    window.selectedPresetCategory = null;
                } else {
                    window.selectedPresetCategory = cat;
                    window.presetCategoryCollapseState[cat] = false; // Força a abertura ao selecionar
                }
            }
            window.renderPresetTags();
        };

        header.ondragstart = (e) => { 
            e.dataTransfer.setData('text/category', cat); 
            header.style.opacity = '0.5';
        };
        header.ondragend = (e) => { 
            header.style.opacity = '1';
        };

        header.ondragover = (e) => { e.preventDefault(); header.style.background = '#0a3a5c'; };
        header.ondragleave = (e) => { header.style.background = isSelected ? '#0a2a4c' : '#222'; };
        
        header.ondrop = async (e) => {
            e.preventDefault();
            header.style.background = isSelected ? '#0a2a4c' : '#222';
            
            const dragCat = e.dataTransfer.getData('text/category');
            if (dragCat) {
                if (dragCat !== cat) {
                    let order = await window.getSetting('preset-cat-order', catKeys);
                    const fromIdx = order.indexOf(dragCat);
                    const toIdx = order.indexOf(cat);
                    
                    if (fromIdx > -1 && toIdx > -1) {
                        order.splice(fromIdx, 1);
                        order.splice(toIdx, 0, dragCat);
                        await window.saveSetting('preset-cat-order', order);
                        window.renderPresetTags();
                    }
                }
                return;
            }

            const tagToMove = e.dataTransfer.getData('text/plain');
            if (tagToMove) {
                await window.savePresetTag(tagToMove, cat);
            }
        };

        catDiv.appendChild(header);
        
        const listDiv = document.createElement('div');
        listDiv.className = 'preset-list';
        listDiv.style.display = isCollapsed ? 'none' : 'block';

        categories[cat].sort().forEach(tag => {
            if (tag.startsWith('_sys_cat_')) return;

            const currentIndex = globalIndex++;
            renderedPresetTags.push(tag);

            const item = document.createElement('div');
            item.className = 'master-tag-item';
            
            let isTagSelected = presetSelectedTags.has(tag);
            let statusHtml = '';
            let conflictsForThisTag = [];
            let similarsForThisTag = [];

            if (isTagSelected && window.enableConflictWarnings) {
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
            } else if (isTagSelected) {
                item.classList.add('selected-master');
            }

            item.draggable = true;
            
            item.ondragstart = (e) => { 
                e.dataTransfer.setData('text/plain', tag); 
                item.style.opacity = '0.4';
            };
            item.ondragend = (e) => { 
                item.style.opacity = '1';
            };
            
            const count = tagCounts.get(tag) || 0;
            const countHtml = `<span style="color:#555; font-size:10px; font-weight:bold; min-width:22px; text-align:left; margin-right:8px; user-select:none;" title="Times used in current dataset">${count}</span>`;
            
            item.innerHTML = `
                <div style="display:flex; align-items:center; overflow:hidden; flex:1;">
                    ${countHtml}
                    <span class="tag-name" style="color: #00ff99; font-weight: bold;">${tag}</span>
                    ${statusHtml}
                </div>
            `;

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
            
            item.onclick = (e) => {
                if (e.target.classList.contains('conflict-warning') || e.target.classList.contains('similar-warning')) return; 

                if (e.shiftKey && presetSelectedTags.size > 0) {
                    const start = Math.min(lastSelectedPresetIndex, currentIndex), end = Math.max(lastSelectedPresetIndex, currentIndex);
                    presetSelectedTags.clear(); 
                    for (let i = start; i <= end; i++) presetSelectedTags.add(renderedPresetTags[i]);
                } else if (e.ctrlKey || e.metaKey) {
                    if (presetSelectedTags.has(tag)) presetSelectedTags.delete(tag); else presetSelectedTags.add(tag);
                    lastSelectedPresetIndex = currentIndex;
                } else {
                    if (presetSelectedTags.has(tag) && presetSelectedTags.size === 1) {
                        presetSelectedTags.clear();
                    } else {
                        presetSelectedTags.clear(); presetSelectedTags.add(tag); lastSelectedPresetIndex = currentIndex;
                    }
                }
                window.renderPresetTags(); 
                window.updatePresetSelectionActions();
            };

            listDiv.appendChild(item);
        });

        catDiv.appendChild(listDiv);
        container.appendChild(catDiv);
    });

    if (window.presetSearchMode) window.filterPresetTagsByName(document.getElementById('preset-add-input').value);

    refreshTagListsAfterPresetChange();
};

/* Re-renderiza a Active Image e "All Dataset Tags" depois que
   window._presetTagsSet muda, pra: (1) esconder o 💾 de tags que acabaram
   de virar preset, (2) mostrar de novo o 💾 de tags removidas dos
   presets, e (3) atualizar o destaque .is-preset em ambas as listas. */
function refreshTagListsAfterPresetChange() {
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
}

window.addPresetTagFromInput = function() {
    const input = document.getElementById('preset-add-input');
    if(!input) return;
    const tagString = input.value.trim();
    
    if (tagString) {
        const tags = tagString.split(',').map(t => t.trim()).filter(t => t);
        const targetCategory = window.selectedPresetCategory || 'Uncategorized';
        
        tags.forEach(t => window.savePresetTag(t, targetCategory));
        input.value = '';
    }
};