/* =========================================================================
   NL INLINE TAG EDITOR (extraído de tagmanager_caption_tag.js)
   ---------------------------------------------------------------------
   O textarea que aparece SUBSTITUINDO uma linha de tag quando ela é uma
   tag "NL:" híbrida (modo Tag normal, não o modo NL de tela cheia — esse
   fica em tagmanager_nl_editor.js). Também mora aqui a checagem de
   conflito/similar contra a Active Image, usada por tagmanager_ui_presets.js.

   NOTA: window.translateCustomNLEdit e window.geminiCustomNLEdit (usados
   pelos botões deste editor) continuam definidos em tagmanager_ui_list.js
   — não foram duplicados aqui, só chamados em tempo de clique.
========================================================================= */

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