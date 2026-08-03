/* =========================================================================
   DANBOORU ALIAS BEHAVIOR (extraído de tagmanager_caption_tag.js)
   ---------------------------------------------------------------------
   Tudo relacionado a tags-alias (ex: "anime screencap" -> "anime screenshot"):
   - Preferência de clique no autocomplete (substituir vs manter)
   - Feature 1: clicar no nome/seta de uma tag-alias converte ela pra tag
     principal em TODO o dataset (window.convertAliasTagGlobally)
   - Feature 2: preview reverso — mostra ao lado de uma tag "real" quais
     aliases já vistos apontam pra ela (window.computeReverseAliasesForTag)
   - Toggles injetados no dropdown de Settings, logo abaixo do botão de
     sync do Danbooru.
========================================================================= */

/* ---------- COMPORTAMENTO AO CLICAR NUMA SUGESTÃO-ALIAS (ex: "anime screencap" -> "anime screenshot") ----------
   'replace' (padrão): clicar na sugestão insere a tag REAL (consequente) — igual ao BooruDatasetTagManager.
   'keep': clicar na sugestão mantém a tag digitada (o alias/depreciada), mas usa o contador da tag real
           tanto no autocomplete quanto depois de salva, na Active Image / All Dataset Tags. */
window.aliasClickBehavior = window.aliasClickBehavior || 'replace';
 
window.setAliasClickBehavior = function (mode) {
    window.aliasClickBehavior = mode === 'keep' ? 'keep' : 'replace';
    if (typeof window.saveSetting === 'function') window.saveSetting('alias-click-behavior', window.aliasClickBehavior);
};
 
function injectAliasBehaviorToggle() {
    const dropdown = document.getElementById('settings-dropdown');
    const syncBtn = dropdown ? dropdown.querySelector('button[onclick="window.manualDanbooruSync()"]') : null;
    if (!dropdown || !syncBtn || document.getElementById('alias-click-behavior-select')) return;
 
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; flex-direction:column; gap:4px; margin-top:6px;';
    wrap.innerHTML = `
        <span style="font-size:11px; color:#9ecfff; font-weight:bold;" title="Applies when you click a tag suggestion that is a Danbooru Alias (e.g. anime screencap ➜ anime screenshot)">↪️ Alias Tags (redirect)</span>
        <select id="alias-click-behavior-select" style="width:100%; font-size:11px;">
            <option value="replace">Click replaces with the correct tag</option>
            <option value="keep">Click keeps the alias, uses correct tag's count</option>
        </select>
    `;
    syncBtn.insertAdjacentElement('afterend', wrap);
 
    const select = document.getElementById('alias-click-behavior-select');
    select.value = window.aliasClickBehavior;
    select.onchange = () => window.setAliasClickBehavior(select.value);
}

function injectAliasConvertClickToggle() {
    const dropdown = document.getElementById('settings-dropdown');
    const syncBtn = dropdown ? dropdown.querySelector('button[onclick="window.manualDanbooruSync()"]') : null;
    if (!dropdown || !syncBtn || document.getElementById('alias-convert-click-toggle')) return;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:6px;';
    wrap.innerHTML = `
        <label style="font-size:11px; color:#9ecfff; font-weight:bold; display:flex; align-items:center; gap:6px; cursor:pointer;" title="When enabled, clicking the name/arrow of an alias tag (e.g. anime screencap ➜ anime screenshot) asks to convert it to the main tag everywhere in the dataset.">
            <input type="checkbox" id="alias-convert-click-toggle"> 🖱️ Click alias tag to convert it globally
        </label>
    `;
    syncBtn.insertAdjacentElement('afterend', wrap);

    const checkbox = document.getElementById('alias-convert-click-toggle');
    checkbox.checked = window.enableAliasConvertClick;
    checkbox.onchange = () => {
        window.enableAliasConvertClick = checkbox.checked;
        if (typeof window.saveSetting === 'function') window.saveSetting('alias-convert-click-enabled', window.enableAliasConvertClick);
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    };
}

/* ---------- FEATURE 1: CONVERTER ALIAS -> TAG PRINCIPAL, GLOBALMENTE ----------
   Clicar no NOME de uma tag-alias (a que mostra a seta ➜ tag real) pergunta
   num popout (confirm) se o usuário quer substituir essa tag pela tag
   principal em TODO o dataset. Não existe "escopo": não importa se o clique
   veio da Active Image ou de All Dataset Tags, a ação é sempre global. */
window.convertAliasTagGlobally = async function (oldTag, newTag) {
    if (!oldTag || !newTag || oldTag === newTag) return;
    if (typeof imageFiles === 'undefined') return;
    if (!confirm(`Convert alias tag "${oldTag}" to the main tag "${newTag}" everywhere in this dataset?\n\nThis replaces it on ALL images (not just the current selection/active image).`)) return;
    console.log('[Alias Convert] Starting conversion:', { oldTag, newTag });

    // Comparação tolerante a maiúsculas/minúsculas e espaços — a tag salva no
    // arquivo pode ter uma capitalização/espaçamento levemente diferente do
    // que foi resolvido pelo Danbooru, e uma comparação estrita (===) fazia
    // a troca falhar silenciosamente (só mostrava o aviso "tag not found").
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
        console.warn('[Alias Convert] Tag not found in any image.', { oldTag, newTag, totalImages: (typeof imageFiles !== 'undefined' ? imageFiles.length : 0) });
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

    if (window.showAlert) window.showAlert(`Converted "${oldTag}" ➜ "${newTag}" in ${replacedCount} image(s).`, 'success');
};

/* ---------- FEATURE 1b: LIGA/DESLIGA O "CLIQUE PRA CONVERTER" ----------
   Controla se o nome/seta da tag-alias fica clicável pra conversão global
   (Feature 1). Independente do toggle de Preview Reverso (Feature 2). */
window.enableAliasConvertClick = window.enableAliasConvertClick !== undefined ? window.enableAliasConvertClick : true;

/* ---------- FEATURE 2: PREVIEW REVERSO DE ALIASES ----------
   Ao lado de uma tag "real" (não-alias), mostra quais tags-alias já vistas
   (mesmo cache compartilhado do Danbooru) apontam pra ela — igual ao alias
   mostrando a seta ➜, só que ao contrário. Limitado a N tags (configurável),
   com toggle liga/desliga, ambos na engrenagem de Settings. */
window.showAliasPreview = window.showAliasPreview !== undefined ? window.showAliasPreview : true;
window.aliasPreviewMaxCount = window.aliasPreviewMaxCount || 5;

window.computeReverseAliasesForTag = function (tagLower) {
    if (!window.danbooruCache) return [];
    const found = [];
    Object.keys(window.danbooruCache).forEach(key => {
        const entry = window.danbooruCache[key];
        if (entry && entry.aliasTo && entry.aliasTo.toLowerCase() === tagLower) found.push(key);
    });
    found.sort();
    return found.slice(0, window.aliasPreviewMaxCount || 5);
};

function injectAliasPreviewToggle() {
    const dropdown = document.getElementById('settings-dropdown');
    const syncBtn = dropdown ? dropdown.querySelector('button[onclick="window.manualDanbooruSync()"]') : null;
    if (!dropdown || !syncBtn || document.getElementById('alias-preview-toggle')) return;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; flex-direction:column; gap:4px; margin-top:8px;';
    wrap.innerHTML = `
        <label style="font-size:11px; color:#9ecfff; font-weight:bold; display:flex; align-items:center; gap:6px; cursor:pointer;" title="Shows, next to a real tag, which alias tags (already seen elsewhere) point to it.">
            <input type="checkbox" id="alias-preview-toggle"> ↩️ Show Alias Tags next to their main tag
        </label>
        <label style="font-size:11px; color:#ccc; display:flex; align-items:center; gap:6px; margin-left:15px;">
            Max shown:
            <input type="number" id="alias-preview-max" min="1" max="30" style="width:50px; background:#111; color:#fff; border:1px solid #444; border-radius:4px; padding:2px 6px;">
        </label>
    `;
    syncBtn.insertAdjacentElement('afterend', wrap);

    const checkbox = document.getElementById('alias-preview-toggle');
    const numInput = document.getElementById('alias-preview-max');
    checkbox.checked = window.showAliasPreview;
    numInput.value = window.aliasPreviewMaxCount;
    numInput.disabled = !window.showAliasPreview;

    checkbox.onchange = () => {
        window.showAliasPreview = checkbox.checked;
        numInput.disabled = !checkbox.checked;
        if (typeof window.saveSetting === 'function') window.saveSetting('alias-preview-enabled', window.showAliasPreview);
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    };
    numInput.onchange = () => {
        const n = parseInt(numInput.value, 10);
        if (!n || n < 1) return;
        window.aliasPreviewMaxCount = n;
        if (typeof window.saveSetting === 'function') window.saveSetting('alias-preview-max-count', n);
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    };
}
 
window.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.getSetting === 'function') {
        window.aliasClickBehavior = await window.getSetting('alias-click-behavior', 'replace');
        window.enableAliasConvertClick = await window.getSetting('alias-convert-click-enabled', true);
        window.showAliasPreview = await window.getSetting('alias-preview-enabled', true);
        window.aliasPreviewMaxCount = await window.getSetting('alias-preview-max-count', 5);
    }
    injectAliasBehaviorToggle();
    injectAliasConvertClickToggle();
    injectAliasPreviewToggle();
});