/* =========================================================================
   CAPTION & TAG EDITOR MODULE
   Handles comma-separated tags, full NL mode, and Danbooru Autocomplete
========================================================================= */

const style = document.createElement('style');
style.innerHTML = `
    .tag-nl-edit-box { display: flex; flex-direction: column; gap: 8px; padding: 10px 15px; background: #0d0d0d; border-bottom: 1px solid #222; border-left: 3px solid #00aa66; }
    .tag-nl-edit-textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; font-size: var(--editor-font-size); line-height: 1.5; padding: 10px; background: #111; color: #eee; border: 1px solid #00aa66; border-radius: 6px; font-family: inherit; }

    .tag-nl-edit-box.tag-nl-edit-fullscreen { flex: 1; height: 100%; padding: 15px; border-left: none; background: #0d0d0d; }
    .tag-nl-edit-box.tag-nl-edit-fullscreen .tag-nl-edit-textarea { flex: 1; min-height: 200px; resize: none; border: 1px solid #4a2a8c;}
    .btn-nl-edit-translate { background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; padding:6px 14px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:bold; }
    .btn-nl-edit-gemini { background:#2f1a5c; color:#b890ff; border:1px solid #4a2a8c; padding:6px 14px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:bold; }
    .btn-nl-edit-cancel { background: transparent; color: #aaa; border: 1px solid #444; padding: 6px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; margin-right: 8px; transition: 0.2s;}
    .btn-nl-edit-save { background: #00aa66; color: #000; border: none; padding: 6px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; transition: 0.2s; }

    .tag-pin:hover { transform: scale(1.15); }
    .tag-pin.active { text-shadow: 0 0 6px rgba(77,184,255,0.7); }
    .pinned-master-tag-row:hover { background: #0d2438 !important; }

    .db-autocomplete { position: absolute; bottom: 100%; top: auto; left: 0; background: #111; border: 1px solid #333; z-index: 100; border-radius: 6px 6px 0 0; max-height: 200px; overflow-y: auto; width: 100%; box-shadow: 0 -4px 12px rgba(0,0,0,0.8); margin-bottom: 4px; }
    .db-autocomplete.direction-down { bottom: auto; top: 100%; border-radius: 0 0 6px 6px; margin-bottom: 0; margin-top: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.8); }
    .db-sugg-item { padding: 8px 10px; border-bottom: 1px solid #222; cursor: pointer; display: flex; justify-content: space-between; font-size: 12px; }
    .db-sugg-item:hover { background: #222; }
    
    .tag-row.conflict, .master-tag-item.conflict { background: rgba(200, 40, 40, 0.3) !important; border-left: 3px solid #ff4444 !important; }
    .conflict-warning { margin-left: 12px; font-size: 10px; color: #ffaaaa; background: #330000; padding: 2px 8px; border-radius: 12px; border: 1px solid #ff4444; cursor: help; display: inline-block;}
    
    .tag-row.similar, .master-tag-item.similar { background: rgba(200, 150, 40, 0.2) !important; border-left: 3px solid #ffcc00 !important; }
    .similar-warning { margin-left: 12px; font-size: 10px; color: #ffeeaa; background: #332200; padding: 2px 8px; border-radius: 12px; border: 1px solid #ffcc00; cursor: help; display: inline-block;}
    
    .tag-row.glow-favorite, .master-tag-item.glow-favorite { background: rgba(0, 80, 40, 0.4) !important; border-left: 3px solid #00ff99 !important; transition: 0.1s; }
    .tag-row.filter-match { box-shadow: inset 0 0 0 1px #ff9500; background: rgba(255, 149, 0, 0.14) !important; }
    .tag-row.is-preset, .master-tag-item.is-preset { background: rgba(45, 212, 191, 0.14) !important; border-left: 3px solid #2dd4bf !important; }
	.tag-to-ghost { color: #00ff99; cursor: pointer; font-weight: bold; font-size: 1.1em; padding: 0 0.4em; flex-shrink: 0; opacity: 0.85; }
    .tag-to-ghost:hover { color: #fff; transform: scale(1.2); opacity: 1; }
`;
document.head.appendChild(style);

window.checkIfNL = function(tag) {
    if (!tag) return false;
    if (typeof datasetConfig !== 'undefined' && datasetConfig.manualNLRules && datasetConfig.manualNLRules[tag] !== undefined) {
        return datasetConfig.manualNLRules[tag] === 'nl';
    }
    return window.enableAutoNl !== false && tag.trim().split(/\s+/).length >= (window.nlWordThreshold || 6);
};

window.addEventListener('DOMContentLoaded', () => {
    setupDanbooruAutocomplete('active-add-input'); setupDanbooruAutocomplete('master-add-input');
    setupDanbooruAutocomplete('preset-add-input'); setupDanbooruAutocomplete('replace-new-tag', 'down');
});

window.autocompleteUsedOnly = { active: false, master: false, replace: false };
const AUTOCOMPLETE_SCOPE_BY_INPUT = { 'active-add-input': 'active', 'master-add-input': 'master', 'replace-new-tag': 'replace' };

window.applyAutocompleteButtonState = function(scope) {
    const btn = document.getElementById(`btn-${scope}-autocomplete-mode`);
    if (!btn) return;
    if (window.autocompleteUsedOnly[scope]) {
        btn.textContent = '📦'; btn.classList.add('active');
        btn.title = 'Autocomplete: showing only tags already used in this dataset';
    } else {
        btn.textContent = '🌐'; btn.classList.remove('active');
        btn.title = 'Autocomplete: showing full Danbooru list';
    }
};

window.toggleAutocompleteMode = function(scope) {
    window.autocompleteUsedOnly[scope] = !window.autocompleteUsedOnly[scope];
    window.applyAutocompleteButtonState(scope);
    if (typeof window.saveSetting === 'function') window.saveSetting('autocomplete-used-only-' + scope, window.autocompleteUsedOnly[scope]);
};

function getUsedTagSuggestions(query) {
    const counts = new Map();
    const files = (typeof imageFiles !== 'undefined') ? imageFiles : [];
    files.forEach(img => {
        if (img.hidden || img.type !== 'tags' || !img.content) return;
        img.content.split(',').forEach(t => {
            const cleanTag = t.trim();
            if (!cleanTag) return;
            counts.set(cleanTag, (counts.get(cleanTag) || 0) + 1);
        });
    });
    return Array.from(counts.entries()).filter(([tag]) => tag.toLowerCase().includes(query)).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

function setupDanbooruAutocomplete(inputId, direction = 'up') {
    const input = document.getElementById(inputId);
    if(!input) return;
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative'; wrapper.style.flex = 'none';
    input.parentNode.insertBefore(wrapper, input); wrapper.appendChild(input);
    const suggBox = document.createElement('div');
    suggBox.className = direction === 'down' ? 'db-autocomplete direction-down' : 'db-autocomplete';
    suggBox.style.display = 'none'; wrapper.appendChild(suggBox);

    function renderUsedOnlySuggestions(query) {
        const matches = getUsedTagSuggestions(query);
        suggBox.innerHTML = '';
        if (matches.length === 0) { suggBox.style.display = 'none'; return; }
        matches.forEach(([tag, count]) => {
            const div = document.createElement('div'); div.className = 'db-sugg-item';
            div.innerHTML = `<span style="color:#00ff99; font-weight:bold;">${tag}</span><span style="color:#666;">${count}</span>`;
            div.onclick = () => { input.value = tag; suggBox.style.display = 'none'; input.focus(); };
            suggBox.appendChild(div);
        });
        suggBox.style.display = 'block';
    }

    let timeout = null;
    input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        const rawVal = e.target.value.trim().toLowerCase();
        if(rawVal.length < 2) { suggBox.style.display = 'none'; return; }
        const scope = AUTOCOMPLETE_SCOPE_BY_INPUT[inputId];
        if (scope && window.autocompleteUsedOnly[scope]) { renderUsedOnlySuggestions(rawVal); return; }
        
        const val = rawVal.replace(/ /g, '_');
        timeout = setTimeout(async () => {
            try {
                let combinedTags = [];
                const danbooruObj = typeof window.dbSearchTagMatches === 'function' ? await window.dbSearchTagMatches(val, 6) : [];
                danbooruObj.forEach(t => { combinedTags.push({ name: t.name, post_count: parseInt(t.post_count) || 0, category: t.category }); });
                
                if (window.showE621) {
                    const host = window.showE621Sfw ? 'e926.net' : 'e621.net';
                    try {
                        const res = await fetch(`https://${host}/tags.json?search[name_matches]=*${val}*&limit=6&search[order]=count`);
                        if (res.ok) {
                            const data = await res.json();
                            const tagsArr = Array.isArray(data) ? data : (data.tags || []);
                            tagsArr.forEach(t => {
                                const standardizedName = t.name.replace(/_/g, ' ');
                                if (!combinedTags.some(ct => ct.name.replace(/_/g, ' ') === standardizedName)) {
                                    combinedTags.push({ name: t.name, post_count: parseInt(t.post_count) || 0, category: t.category });
                                }
                            });
                        }
                    } catch(err) {}
                }

                if (combinedTags.length === 0) {
                    const cachedMatches = [];
                    if (window.danbooruCache) {
                        Object.keys(window.danbooruCache).forEach(k => {
                            if (k.toLowerCase().includes(rawVal)) cachedMatches.push({ name: k, post_count: window.danbooruCache[k].count, category: 0 });
                        });
                    }
                    combinedTags = cachedMatches.sort((a,b) => b.post_count - a.post_count).slice(0, 6);
                } else { combinedTags.sort((a,b) => b.post_count - a.post_count); }

                suggBox.innerHTML = '';
                if(combinedTags.length === 0) { suggBox.style.display = 'none'; return; }
                
                combinedTags.forEach(t => {
                    const div = document.createElement('div'); div.className = 'db-sugg-item';
                    const color = CAT_COLORS[t.category] || "#aaa";
                    div.innerHTML = `<span style="color:${color}; font-weight:bold;">${t.name.replace(/_/g, ' ')}</span>
                        <div style="display:flex; align-items:center; gap:5px;"><span style="color:#666;">${Number(t.post_count).toLocaleString()}</span></div>`;
                    div.onclick = () => { input.value = t.name.replace(/_/g, ' '); suggBox.style.display = 'none'; input.focus(); };
                    suggBox.appendChild(div);
                });
                suggBox.style.display = 'block';
            } catch(err) {}
        }, 400);
    });

    document.addEventListener('click', (e) => { if(!wrapper.contains(e.target)) suggBox.style.display = 'none'; });
}

const CAT_COLORS = { 0: "#aaa", 1: "#f9a825", 3: "#ae80ff", 4: "#5bc0de", 5: "#888" };

window.checkTagStatusWithActive = function(tag) {
    if (!window.sortedActiveTags || !window.sortedActiveTags.length) return { conflicts: [], similars: [] };
    const tagLower = tag.toLowerCase();
    let conflicts = []; let similars = [];
    
    (window.tagConflicts || []).forEach(group => {
        const groupLower = group.map(g => g.toLowerCase());
        if (groupLower.includes(tagLower)) {
            let activeInGroup = groupLower.filter(t => window.sortedActiveTags.some(at => at.toLowerCase() === t));
            let others = activeInGroup.filter(t => t !== tagLower);
            if (others.length > 0) conflicts.push(...others);
        }
    });

    (window.tagSimilar || []).forEach(group => {
        const groupLower = group.map(g => g.toLowerCase());
        if (groupLower.includes(tagLower)) {
            let activeInGroup = groupLower.filter(t => window.sortedActiveTags.some(at => at.toLowerCase() === t));
            let others = activeInGroup.filter(t => t !== tagLower);
            if (others.length > 0) similars.push(...others);
        }
    });

    return { conflicts: [...new Set(conflicts)], similars: [...new Set(similars)] };
};

window.nlEditTarget = null; 

function buildNLEditBox(tag, scope) {
    const rawText = tag;

    const box = document.createElement('div');
    box.className = 'tag-nl-edit-box';
    box.innerHTML = `
        <textarea class="tag-nl-edit-textarea" placeholder="Enter text here..."></textarea>
        <div style="display:flex; gap:8px; margin-top: 8px;">
            <button class="btn-nl-edit-translate" onclick="window.translateCustomNLEdit(this, 'en')">🌐 Translate (EN-US)</button>
            <button class="btn-nl-edit-gemini" onclick="window.geminiCustomNLEdit(this, 'en-US')">✨ Gemini Fix (EN-US)</button>
        </div>
        <div style="display:flex; gap:8px; margin-top: 8px; justify-content: flex-end;">
            <button class="btn-nl-edit-cancel">✖ Cancel</button>
            <button class="btn-nl-edit-save">💾 Save</button>
        </div>
    `;
    const textarea = box.querySelector('.tag-nl-edit-textarea');
    textarea.value = rawText;

    const btnCancel = box.querySelector('.btn-nl-edit-cancel');
    const btnSave = box.querySelector('.btn-nl-edit-save');
    
    btnSave.style.opacity = '0.5'; btnSave.disabled = true;

    textarea.oninput = () => {
        if (textarea.value !== rawText) {
            btnSave.style.opacity = '1'; btnSave.disabled = false;
        } else {
            btnSave.style.opacity = '0.5'; btnSave.disabled = true;
        }
    };

    btnCancel.onclick = (e) => {
        e.stopPropagation();
        window.nlEditTarget = null;
        if (scope === 'active' && typeof window.renderEditor === 'function') window.renderEditor();
        if (scope === 'master' && typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    };

    btnSave.onclick = (e) => {
        e.stopPropagation();
        window.confirmNLEditTag(scope, tag, textarea.value);
    };

    return box;
}

window.convertToCustomNL = function() {
    if (typeof activeSelectedTags === 'undefined' || activeSelectedTags.size === 0) return;
    if (typeof datasetConfig === 'undefined') window.datasetConfig = {};
    if (!datasetConfig.manualNLRules) datasetConfig.manualNLRules = {};
    
    const firstTag = Array.from(activeSelectedTags)[0];
    const isCurrentlyNL = window.checkIfNL(firstTag);
    const targetState = isCurrentlyNL ? 'tag' : 'nl';
    
    activeSelectedTags.forEach(tag => {
        datasetConfig.manualNLRules[tag] = targetState;
    });
    
    if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.applyFilters === 'function') window.applyFilters();
};

window.globalConvertToCustomNL = function() {
    if (typeof masterSelectedTags === 'undefined' || masterSelectedTags.size === 0) return;
    if (typeof datasetConfig === 'undefined') window.datasetConfig = {};
    if (!datasetConfig.manualNLRules) datasetConfig.manualNLRules = {};
    
    const firstTag = Array.from(masterSelectedTags)[0];
    const isCurrentlyNL = window.checkIfNL(firstTag);
    const targetState = isCurrentlyNL ? 'tag' : 'nl';
    
    masterSelectedTags.forEach(tag => {
        datasetConfig.manualNLRules[tag] = targetState;
    });
    
    if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.applyFilters === 'function') window.applyFilters();
};

window.confirmNLEditTag = async function(scope, oldTag, newTextRaw) {
    let newText = (newTextRaw || '').trim();
    window.nlEditTarget = null;

    if (!newText || newText === oldTag) {
        if (scope === 'active' && typeof window.renderEditor === 'function') window.renderEditor();
        if (scope === 'master' && typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        return;
    }

    if (datasetConfig && datasetConfig.manualNLRules && datasetConfig.manualNLRules[oldTag]) {
        datasetConfig.manualNLRules[newText] = datasetConfig.manualNLRules[oldTag];
        delete datasetConfig.manualNLRules[oldTag];
    }

    let replacedCount = 0;
    let indicesToProcess = scope === 'active' ? Array.from(selectedIndices) : imageFiles.map((_, i) => i);
    let modifiedFiles = [];

    for (const idx of indicesToProcess) {
        const img = imageFiles[idx];
        if (img.hidden) continue;
        if (img.type === 'tags' && img.content) {
            let tags = img.content.split(',').map(t => t.trim()).filter(t => t);
            if (tags.includes(oldTag)) {
                tags = tags.map(t => t === oldTag ? newText : t);
                img.content = tags.join(', ');
                img.hasFile = true;
                modifiedFiles.push(img);
                replacedCount++;
            }
        } else if (img.type === 'nl' && img.content) {
            if (img.content.trim() === oldTag.trim()) {
                img.content = newText;
                img.hasFile = true;
                modifiedFiles.push(img);
                replacedCount++;
            }
        }
    }

    masterTagSet.clear();
    imageFiles.forEach(img => {
        if (img.type === 'tags' && img.content) img.content.split(',').forEach(t => { if (t.trim()) masterTagSet.add(t.trim()); });
        else if (img.type === 'nl' && img.content) masterTagSet.add(img.content.trim());
    });
    if(typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();

    if (scope === 'active') { activeSelectedTags.delete(oldTag); activeSelectedTags.add(newText); }
    if (scope === 'master') { masterSelectedTags.delete(oldTag); masterSelectedTags.add(newText); }

    if(typeof window.showAlert === 'function') window.showAlert(`Text updated in ${replacedCount} image(s)!`, "success");

    if(typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();

    const savePromises = modifiedFiles.map(img => window.saveImageToDisk(img));
    await Promise.all(savePromises);
    if (replacedCount > 0 && typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
};

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
            if (isAlreadyPreset && presetsVisible && window.enablePresetHighlight !== false) row.classList.add('is-preset');
            
            let statusHtml = '';
            if (conflictsForThisTag.length > 0) statusHtml += `<span class="conflict-warning" title="Conflict with: ${conflictsForThisTag.join(', ')}">⚠️ Conflict: ${conflictsForThisTag.join(', ')}</span>`;
            if (similarsForThisTag.length > 0) statusHtml += `<span class="similar-warning" title="Similar/Redundant to: ${similarsForThisTag.join(', ')}">🟨 Similar: ${similarsForThisTag.join(', ')}</span>`;
            
            const displayTag = tag;
            const textColor = isCustomNL ? '#b890ff' : '#ddd'; 

            const pencilIcon = isCustomNL ? `<span class="tag-edit-nl" style="margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Edit Tag Text">✏️</span>` : '';
            const starIcon = !isCustomNL ? `<span class="tag-star" style="color: ${isFav ? '#00ff99' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Favorite/Unfavorite">${isFav ? '⭐' : '☆'}</span>` : '';
            const presetIcon = (!isCustomNL && !isAlreadyPreset) ? `<span class="tag-save-preset" style="display: ${presetsVisible ? 'inline' : 'none'}; color: #4db8ff; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Save to Global Presets">💾</span>` : '';

            const dbCached = window.danbooruCache ? (window.danbooruCache[tagLower] || window.danbooruCache[tag]) : null; 
            const dbCountHtml = (window.showDanbooruCounts && dbCached && dbCached.count > 0 && !isCustomNL) ? `<span style="font-size: 10px; color: #666; margin-right: 8px; user-select: none;">${window.formatDbCount(dbCached.count)}</span>` : '';
            const countInDataset = datasetTagCounts.get(tag) || 0;
            const dsCountHtml = `<span style="color:#555; font-size:10px; font-weight:bold; min-width:20px; text-align:left; margin-right:8px; user-select:none;" title="Times used in current dataset">${countInDataset}</span>`;
            const ghostIconHtml = (window.enableGhostConvertIcon !== false && !isCustomNL) ? `<span class="tag-to-ghost" title="Convert to Ghost/Suggestion Tag">💡</span>` : '';

            row.innerHTML = `<div class="tag-row-left">
                ${starIcon}
                ${dsCountHtml}
                ${presetIcon}
                ${pencilIcon}
                <span class="tag-name" style="color: ${textColor};">${displayTag}</span>
                ${statusHtml}
            </div>
            <div style="display: flex; align-items: center;">
                ${dbCountHtml}
				${ghostIconHtml}
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
            }
            
            if (!isMultiSelected && !isMultiImageSelection) {
                row.draggable = true;
                row.ondragstart = (e) => { 
                    if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star') || e.target.classList.contains('tag-save-preset') || e.target.classList.contains('tag-edit-nl') || e.target.classList.contains('tag-to-ghost')) return false;
                    e.dataTransfer.setData('text/plain', i); draggedTagIndex = i; row.classList.add('dragging'); 
                };
                row.ondragend = () => { row.classList.remove('dragging'); draggedTagIndex = null; };
                row.ondragover = (e) => e.preventDefault();
                row.ondrop = (e) => { e.preventDefault(); if (draggedTagIndex !== null && draggedTagIndex !== i && typeof window.reorderTags === 'function') window.reorderTags(draggedTagIndex, i); };
            }

            row.onclick = (e) => {
                if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star') || e.target.classList.contains('tag-save-preset') || e.target.classList.contains('tag-edit-nl') || e.target.classList.contains('tag-to-ghost')) { 
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

window.globalConvertToCustomNL = function() {
    if (typeof masterSelectedTags === 'undefined' || masterSelectedTags.size === 0) return;
    if (typeof datasetConfig === 'undefined') window.datasetConfig = {};
    if (!datasetConfig.manualNLRules) datasetConfig.manualNLRules = {};
    
    const firstTag = Array.from(masterSelectedTags)[0];
    const isCurrentlyNL = window.checkIfNL(firstTag);
    const targetState = isCurrentlyNL ? 'tag' : 'nl';
    
    masterSelectedTags.forEach(tag => {
        datasetConfig.manualNLRules[tag] = targetState;
    });
    
    if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.applyFilters === 'function') window.applyFilters();
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
            const dbCountHtml = (window.showDanbooruCounts && dbCached && dbCached.count > 0 && !isCustomNL) 
                ? `<span style="font-size: 10px; color: #666; margin-right: 8px; user-select: none;">${window.formatDbCount(dbCached.count)}</span>` : '';

            const isAlreadyPreset = !isCustomNL && window._presetTagsSet && window._presetTagsSet.has(tag);
            if (isAlreadyPreset && presetsVisible && window.enablePresetHighlight !== false) item.classList.add('is-preset');
            const presetIconHtml = (isAlreadyPreset || isCustomNL) ? '' : `<span class="tag-save-preset" style="display: ${presetsVisible ? 'inline' : 'none'}; color: #4db8ff; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Save to Global Presets">💾</span>`;
            const ghostIconHtmlMaster = (window.enableGhostConvertIcon !== false && !isCustomNL) ? `<span class="tag-to-ghost" title="Convert to Ghost globally">💡</span>` : '';

            item.innerHTML = `
                <div style="display:flex; align-items:center; overflow:hidden; flex:1;">
                    <span class="tag-pin${isPinned ? ' active' : ''}" style="color: ${isPinned ? '#4db8ff' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Pin as a mandatory filter">📌</span>
                    <span class="tag-star" style="color: ${favTags.has(tag) ? '#00ff99' : '#444'}; margin-right: 8px; font-size: 14px; cursor: pointer; user-select:none;" title="Favorite/Unfavorite">${favTags.has(tag) ? '⭐' : '☆'}</span>
                    ${presetIconHtml}
                    <span style="color:#555; font-size:10px; font-weight:bold; min-width:22px; text-align:left; margin-right:8px; user-select:none;">${count}</span>
                    <span class="tag-name" style="${isCustomNL ? 'color:#b890ff;' : ''}">${tag}</span>
                    ${statusHtml}
                </div>
                <div style="display: flex; align-items: center;">
                    ${dbCountHtml}
					${ghostIconHtmlMaster}
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
            
            if (!isCustomNL) item.ondblclick = (e) => { e.stopPropagation(); window.addTagToSelected(tag, document.getElementById('master-add-pos') ? document.getElementById('master-add-pos').value : 'bottom'); };
            
            item.onclick = (e) => {
                if(e.target.classList.contains('tag-remove') || e.target.classList.contains('tag-star') || e.target.classList.contains('tag-save-preset') || e.target.classList.contains('tag-pin') || e.target.classList.contains('conflict-warning') || e.target.classList.contains('similar-warning') || e.target.classList.contains('tag-to-ghost')) { 
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

window.translateCustomNLEdit = async function(btn, targetLang) {
    const box = btn.closest('.tag-nl-edit-box');
    const ta = box.querySelector('.tag-nl-edit-textarea');
    const originalText = ta.value.trim();
    if(!originalText) return;
    const backup = ta.value;
    ta.value = "🌐 Translating...";
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(originalText)}`;
        const res = await fetch(url);
        const data = await res.json();
        let translated = "";
        if(data && data[0]) { data[0].forEach(part => { if(part[0]) translated += part[0]; }); }
        ta.value = translated;
        ta.oninput();
    } catch(e) { 
        ta.value = backup; 
        if (typeof window.showAlert === 'function') window.showAlert("Error translating.", "error"); 
    }
};

window.geminiCustomNLEdit = function(btn, targetLang) {
    const box = btn.closest('.tag-nl-edit-box');
    const ta = box.querySelector('.tag-nl-edit-textarea');
    const originalText = ta.value.trim();
    if(!originalText) return;
    ta.value = "✨ Processing in Gemini...";
    setTimeout(() => {
        ta.value = originalText + ` (Simulated Gemini Fix for ${targetLang})`;
        ta.oninput();
    }, 1000);
};