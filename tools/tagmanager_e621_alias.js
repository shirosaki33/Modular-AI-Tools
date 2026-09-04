/* =========================================================================
   E621 ALIAS BEHAVIOR (Adaptado de tagmanager_alias_behavior.js)
   ---------------------------------------------------------------------
   Tudo relacionado a tags-alias no e621/e926:
   - Preferência de clique no autocomplete (substituir vs manter)
   - Feature 1: clicar no nome/seta de uma tag-alias converte ela pra tag
     principal em TODO o dataset (window.e621ConvertAliasTagGlobally)
   - Feature 2: preview reverso — mostra ao lado de uma tag "real" quais
     aliases já vistos apontam pra ela (window.e621ComputeReverseAliasesForTag)
   - Toggles injetados no dropdown de Settings.
========================================================================= */

/* ---------- COMPORTAMENTO AO CLICAR NUMA SUGESTÃO-ALIAS ---------- */
window.e621AliasClickBehavior = window.e621AliasClickBehavior || 'replace';
 
window.e621SetAliasClickBehavior = function (mode) {
    window.e621AliasClickBehavior = mode === 'keep' ? 'keep' : 'replace';
    if (typeof window.saveSetting === 'function') window.saveSetting('e621-alias-click-behavior', window.e621AliasClickBehavior);
};
 
function injectE621AliasBehaviorToggle() {
    const dropdown = document.getElementById('settings-dropdown');
    // Procura o botão de sync do e621. Se não existir, tenta o do Danbooru como âncora provisória.
    const syncBtn = dropdown ? (dropdown.querySelector('button[onclick="window.manualE621Sync()"]') || dropdown.querySelector('button[onclick="window.manualDanbooruSync()"]')) : null;
    if (!dropdown || !syncBtn || document.getElementById('e621-alias-click-behavior-select')) return;
 
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; flex-direction:column; gap:4px; margin-top:12px; border-top: 1px solid #333; padding-top: 8px;';
    wrap.innerHTML = `
        <span style="font-size:11px; color:#5bc0de; font-weight:bold;" title="Applies when you click a tag suggestion that is an E621 Alias">🦊 E621 Alias Tags (redirect)</span>
        <select id="e621-alias-click-behavior-select" style="width:100%; font-size:11px;">
            <option value="replace">Click replaces with the correct tag</option>
            <option value="keep">Click keeps the alias, uses correct tag's count</option>
        </select>
    `;
    syncBtn.insertAdjacentElement('afterend', wrap);
 
    const select = document.getElementById('e621-alias-click-behavior-select');
    select.value = window.e621AliasClickBehavior;
    select.onchange = () => window.e621SetAliasClickBehavior(select.value);
}

function injectE621AliasConvertClickToggle() {
    const selectWrap = document.getElementById('e621-alias-click-behavior-select');
    if (!selectWrap || document.getElementById('e621-alias-convert-click-toggle')) return;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:6px;';
    wrap.innerHTML = `
        <label style="font-size:11px; color:#5bc0de; font-weight:bold; display:flex; align-items:center; gap:6px; cursor:pointer;" title="When enabled, clicking the name/arrow of an e621 alias tag asks to convert it to the main tag everywhere in the dataset.">
            <input type="checkbox" id="e621-alias-convert-click-toggle"> 🖱️ Click alias tag to convert it globally
        </label>
    `;
    selectWrap.parentElement.insertAdjacentElement('beforeend', wrap);

    const checkbox = document.getElementById('e621-alias-convert-click-toggle');
    checkbox.checked = window.e621EnableAliasConvertClick;
    checkbox.onchange = () => {
        window.e621EnableAliasConvertClick = checkbox.checked;
        if (typeof window.saveSetting === 'function') window.saveSetting('e621-alias-convert-click-enabled', window.e621EnableAliasConvertClick);
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    };
}

/* ---------- FEATURE 1: CONVERTER ALIAS -> TAG PRINCIPAL, GLOBALMENTE ---------- */
window.e621ConvertAliasTagGlobally = async function (oldTag, newTag) {
    if (!oldTag || !newTag || oldTag === newTag) return;
    if (typeof imageFiles === 'undefined') return;
    if (!confirm(`Convert E621 alias tag "${oldTag}" to the main tag "${newTag}" everywhere in this dataset?\n\nThis replaces it on ALL images.`)) return;
    console.log('[E621 Alias Convert] Starting conversion:', { oldTag, newTag });

    const oldTagLower = oldTag.trim().toLowerCase();
    let replacedCount = 0;
    const modifiedFiles = [];
    imageFiles.forEach(img => {
        if (img.hidden || img.type !== 'tags' || !img.content) return;
        let tags = img.content.split(',').map(t => t.trim()).filter(t => t);
        const hasMatch = tags.some(t => t.toLowerCase() === oldTagLower);
        if (!hasMatch) return;
        tags = tags.map(t => t.toLowerCase() === oldTagLower ? newTag : t);
        tags = [...new Set(tags)];
        img.content = tags.join(', ');
        img.hasFile = true;
        modifiedFiles.push(img);
        replacedCount++;
    });

    if (replacedCount === 0) {
        console.warn('[E621 Alias Convert] Tag not found in any image.', { oldTag, newTag });
        if (window.showAlert) window.showAlert(`Tag "${oldTag}" not found in this dataset.`, 'warn');
        return;
    }

    if (typeof window.markDirty === 'function') window.markDirty(modifiedFiles);

    if (typeof masterTagSet !== 'undefined') { masterTagSet.delete(oldTag); masterTagSet.add(newTag); }
    if (typeof activeSelectedTags !== 'undefined') activeSelectedTags.delete(oldTag);
    if (typeof masterSelectedTags !== 'undefined') masterSelectedTags.delete(oldTag);

    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();

    const savePromises = modifiedFiles.map(img => window.saveImageToDisk(img));
    await Promise.all(savePromises);
    if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();

    if (window.showAlert) window.showAlert(`Converted E621 tag "${oldTag}" ➜ "${newTag}" in ${replacedCount} image(s).`, 'success');
};

window.e621EnableAliasConvertClick = window.e621EnableAliasConvertClick !== undefined ? window.e621EnableAliasConvertClick : true;

/* ---------- FEATURE 2: PREVIEW REVERSO DE ALIASES ---------- */
window.e621ShowAliasPreview = window.e621ShowAliasPreview !== undefined ? window.e621ShowAliasPreview : true;
window.e621AliasPreviewMaxCount = window.e621AliasPreviewMaxCount || 5;

// IMPORTANTE: Utiliza window.e621Cache no lugar de window.danbooruCache
window.e621ComputeReverseAliasesForTag = function (tagLower) {
    if (!window.e621Cache) return [];
    const found = [];
    Object.keys(window.e621Cache).forEach(key => {
        const entry = window.e621Cache[key];
        if (entry && entry.aliasTo && entry.aliasTo.toLowerCase() === tagLower) found.push(key);
    });
    found.sort();
    return found.slice(0, window.e621AliasPreviewMaxCount || 5);
};

function injectE621AliasPreviewToggle() {
    const wrapReference = document.getElementById('e621-alias-convert-click-toggle');
    if (!wrapReference || document.getElementById('e621-alias-preview-toggle')) return;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; flex-direction:column; gap:4px; margin-top:8px;';
    wrap.innerHTML = `
        <label style="font-size:11px; color:#5bc0de; font-weight:bold; display:flex; align-items:center; gap:6px; cursor:pointer;" title="Shows, next to a real tag, which e621 alias tags point to it.">
            <input type="checkbox" id="e621-alias-preview-toggle"> ↩️ Show E621 Alias Tags next to main tag
        </label>
        <label style="font-size:11px; color:#ccc; display:flex; align-items:center; gap:6px; margin-left:15px;">
            Max shown:
            <input type="number" id="e621-alias-preview-max" min="1" max="30" style="width:50px; background:#111; color:#fff; border:1px solid #444; border-radius:4px; padding:2px 6px;">
        </label>
    `;
    wrapReference.parentElement.parentElement.insertAdjacentElement('beforeend', wrap);

    const checkbox = document.getElementById('e621-alias-preview-toggle');
    const numInput = document.getElementById('e621-alias-preview-max');
    checkbox.checked = window.e621ShowAliasPreview;
    numInput.value = window.e621AliasPreviewMaxCount;
    numInput.disabled = !window.e621ShowAliasPreview;

    checkbox.onchange = () => {
        window.e621ShowAliasPreview = checkbox.checked;
        numInput.disabled = !checkbox.checked;
        if (typeof window.saveSetting === 'function') window.saveSetting('e621-alias-preview-enabled', window.e621ShowAliasPreview);
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    };
    numInput.onchange = () => {
        const n = parseInt(numInput.value, 10);
        if (!n || n < 1) return;
        window.e621AliasPreviewMaxCount = n;
        if (typeof window.saveSetting === 'function') window.saveSetting('e621-alias-preview-max-count', n);
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    };
}
 
window.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.getSetting === 'function') {
        window.e621AliasClickBehavior = await window.getSetting('e621-alias-click-behavior', 'replace');
        window.e621EnableAliasConvertClick = await window.getSetting('e621-alias-convert-click-enabled', true);
        window.e621ShowAliasPreview = await window.getSetting('e621-alias-preview-enabled', true);
        window.e621AliasPreviewMaxCount = await window.getSetting('e621-alias-preview-max-count', 5);
    }
    
    // Injeta a UI com um pequeno delay para garantir que o menu de settings já foi criado por outros scripts
    setTimeout(() => {
        injectE621AliasBehaviorToggle();
        injectE621AliasConvertClickToggle();
        injectE621AliasPreviewToggle();
    }, 500);
});
