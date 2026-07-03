/* =========================================================================
   CAPTION & TAG EDITOR MODULE
   Controla exclusivamente as tags separadas por vírgula e o Danbooru Autocomplete
========================================================================= */

const style = document.createElement('style');
style.innerHTML = `
    .db-autocomplete { position: absolute; bottom: 100%; top: auto; left: 0; background: #111; border: 1px solid #333; z-index: 100; border-radius: 6px 6px 0 0; max-height: 200px; overflow-y: auto; width: 100%; box-shadow: 0 -4px 12px rgba(0,0,0,0.8); margin-bottom: 4px; }
    .db-sugg-item { padding: 8px 10px; border-bottom: 1px solid #222; cursor: pointer; display: flex; justify-content: space-between; font-size: 12px; }
    .db-sugg-item:hover { background: #222; }
`;
document.head.appendChild(style);

window.addEventListener('DOMContentLoaded', () => {
    setupDanbooruAutocomplete('active-add-input');
    setupDanbooruAutocomplete('master-add-input');
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

/* === GERENCIADOR GERAL DO PAINEL CENTRAL === */
function renderEditor() {
    const topbarSelectFormat = document.getElementById('topbar-save-format');
    const topbarSelectType = document.getElementById('topbar-system-type');
    const colTools = document.getElementById('col-tools');
    
    if (selectedIndices.size === 0) {
        topbarSelectFormat.style.display = 'none'; topbarSelectType.style.display = 'none';
        colTools.style.display = 'flex';
        return;
    }

    const imgObj = imageFiles[Array.from(selectedIndices)[0]];
    
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
    sortedActiveTags = Array.from(fusedTags);
    let favTags = new Set(datasetConfig.favoriteTags || []);
    
    const isMultiSelected = activeSelectedTags.size > 1; 
    const isMultiImageSelection = selectedIndices.size > 1;
    
    sortedActiveTags.forEach((tag, i) => {
        const isFav = favTags.has(tag);
        const row = document.createElement('div'); row.className = 'tag-row'; 
        if (activeSelectedTags.has(tag)) row.classList.add('selected-active');
        
        row.innerHTML = `<div class="tag-row-left">
            <span class="tag-star" style="color: ${isFav ? '#00ff99' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Favorite/Unfavorite">${isFav ? '⭐' : '☆'}</span>
            <span class="tag-name">${tag}</span>
        </div><span class="tag-remove" title="Remove Tag">&times;</span>`;
        
        if (!isMultiSelected && !isMultiImageSelection) {
            row.draggable = true;
            row.ondragstart = (e) => { 
                if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star')) return false;
                e.dataTransfer.setData('text/plain', i); draggedTagIndex = i; row.classList.add('dragging'); 
            };
            row.ondragend = () => { row.classList.remove('dragging'); draggedTagIndex = null; };
            row.ondragover = (e) => e.preventDefault();
            row.ondrop = (e) => { e.preventDefault(); if (draggedTagIndex !== null && draggedTagIndex !== i) reorderTags(draggedTagIndex, i); };
        }

        const starEl = row.querySelector('.tag-star');
        starEl.onclick = async (e) => {
            e.stopPropagation();
            const currentlyFav = favTags.has(tag);
            if (currentlyFav) favTags.delete(tag); else favTags.add(tag);
            
            datasetConfig.favoriteTags = Array.from(favTags);
            const handle = window.currentImagesHandle || window.rootHandle;
            if (handle && typeof saveDatasetConfig === 'function') saveDatasetConfig(handle); 
            
            starEl.textContent = currentlyFav ? '☆' : '⭐';
            starEl.style.color = currentlyFav ? '#444' : '#00ff99';
            
            // Sincroniza com a lista Master instantaneamente
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        };

        row.onclick = (e) => {
            if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star')) { 
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
                activeSelectedTags.clear(); activeSelectedTags.add(tag); lastSelectedActiveTagIndex = i;
            }
            renderEditor();
        };
        tagListVertical.appendChild(row);
    });
}

function removeTagFromSelected(tagToRemove) {
    selectedIndices.forEach(idx => {
        if (imageFiles[idx].type === 'tags') imageFiles[idx].content = imageFiles[idx].content.split(',').map(t => t.trim()).filter(t => t && t !== tagToRemove).join(', ');
    });
    
    // Refresh Imediato
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
    
    // Refresh Imediato
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
    
    // Refresh Imediato
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
    if(tagsToAdd.length > 0) { tagsToAdd.forEach(t => addTagToSelected(t, pos)); input.value = ''; }
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
    
    let tagCounts = new Map();
    imageFiles.forEach(img => {
        if (img.type === 'tags' && img.hasFile) {
            img.content.split(',').forEach(t => {
                const cleanTag = t.trim();
                if (cleanTag) tagCounts.set(cleanTag, (tagCounts.get(cleanTag) || 0) + 1);
            });
        }
    });

    let favTags = new Set(datasetConfig.favoriteTags || []);
    sortedMasterTags = Array.from(masterTagSet).sort();
    
    sortedMasterTags.forEach((tag, index) => {
        const isFav = favTags.has(tag);
        
        if (window.showOnlyFavoriteTags && !isFav) return;

        const item = document.createElement('div'); item.className = 'master-tag-item';
        if (masterSelectedTags.has(tag)) item.classList.add('selected-master');
        
        const count = tagCounts.get(tag) || 0;
        
        item.innerHTML = `
            <div style="display:flex; align-items:center; overflow:hidden; flex:1;">
                <span class="tag-star" style="color: ${isFav ? '#00ff99' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Favorite/Unfavorite">${isFav ? '⭐' : '☆'}</span>
                <span style="color:#555; font-size:10px; font-weight:bold; min-width:22px; text-align:left; margin-right:8px; user-select:none;">${count}</span>
                <span class="tag-name">${tag}</span>
            </div>
            <span class="tag-remove" title="Global Remove">&times;</span>
        `;
        
        const starEl = item.querySelector('.tag-star');
        starEl.onclick = async (e) => {
            e.stopPropagation();
            const currentlyFav = favTags.has(tag);
            if (currentlyFav) favTags.delete(tag); else favTags.add(tag);
            
            datasetConfig.favoriteTags = Array.from(favTags);
            const handle = window.currentImagesHandle || window.rootHandle;
            if (handle) saveDatasetConfig(handle); 
            
            if (window.showOnlyFavoriteTags && currentlyFav) {
                item.style.display = 'none';
            } else {
                starEl.textContent = currentlyFav ? '☆' : '⭐';
                starEl.style.color = currentlyFav ? '#444' : '#00ff99';
            }
            
            // Sincroniza com a lista de Active Image instantaneamente
            if (selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
        };
        
        item.ondblclick = (e) => { e.stopPropagation(); addTagToSelected(tag, document.getElementById('master-add-pos').value); };
        
        item.onclick = (e) => {
            if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star')) { 
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
                masterSelectedTags.clear(); masterSelectedTags.add(tag); lastSelectedMasterTagIndex = index;
            }
            
            renderMasterTagList(); applyFilters(); updateSelectionActions();
        };
        container.appendChild(item);
    });
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
        let visible = true;
        
        if (window.showOnlyStarredImg && !img.starred) {
            visible = false;
        }
        
        if (visible && masterSelectedTags.size > 0) {
            if (img.type === 'tags') {
                const tags = img.content.split(',').map(t => t.trim());
                let matchCount = 0;
                for (let ft of masterSelectedTags) { if (tags.includes(ft)) matchCount++; }
                
                if (filterMode === 'AND' && matchCount !== masterSelectedTags.size) visible = false;
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
        targets = imageFiles.map((_, i) => i);
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
    
    renderEditor(); refreshListStatus();
    showAlert(`Added ${tagsToAdd.length} tags to ${targets.length} images.`);
}

function globalRemoveTags(tagsToRemove) {
    if(!tagsToRemove || tagsToRemove.length === 0) return;
    let changed = 0;
    
    imageFiles.forEach(img => {
        if(img.type === 'tags') {
            let currentTags = img.content.split(',').map(t => t.trim()).filter(t => t);
            let originalLen = currentTags.length;
            currentTags = currentTags.filter(t => !tagsToRemove.includes(t));
            if(currentTags.length !== originalLen) { img.content = currentTags.join(', '); changed++; }
        }
    });
    
    tagsToRemove.forEach(t => { masterTagSet.delete(t); masterSelectedTags.delete(t); });
    
    // Refresh Imediato
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    updateSelectionActions(); 
    renderMasterTagList();
    if (selectedIndices.size > 0) renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    
    showAlert(`Globally removed tags from ${changed} images. Press Ctrl+S to save to disk.`, 'success');
}