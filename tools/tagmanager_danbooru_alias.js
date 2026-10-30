/* =========================================================================
   DANBOORU ALIAS BEHAVIOR (extraído de tagmanager_caption_tag.js)
   ---------------------------------------------------------------------
   Tudo relacionado a tags-alias (ex: "anime screencap" -> "anime screenshot"):
   - Preferência de clique no autocomplete (substituir vs manter)
   - Feature 1: clicar no nome/seta de uma tag-alias converte ela pra tag
     principal em TODO o dataset (window.convertAliasTagGlobally)
   - Feature 2: preview reverso — mostra ao lado de uma tag "real" quais
     aliases já vistos apontam pra ela. O cálculo e o HTML ficam em
     tagmanager_alias_bridge.js (Danbooru + e621 juntos); aqui só ficam as
     opções liga/desliga e o limite.
   - As opções (liga/desliga, limite) aparecem no popout do Tag Interrogator,
     seção "↪️ Alias tags" (tagmanager_danbooru_panel.js). Aqui ficam só o
     estado (window.*) e as chaves de setting.
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
 
/* ---------- FEATURE 1: CONVERTER ALIAS -> TAG PRINCIPAL, GLOBALMENTE ----------
   Clicar no NOME de uma tag-alias (a que mostra a seta ➜ tag real) pergunta
   num popout (confirm) se o usuário quer substituir essa tag pela tag
   principal em TODO o dataset. Não existe "escopo": não importa se o clique
   veio da Active Image ou de All Dataset Tags, a ação é sempre global. */
/* Implementação única usada pelo Danbooru e pelo e621 (tagmanager_e621_alias.js).
   siteLabel só muda o texto do confirm/alerta. */
window.convertAliasTagEverywhere = async function (oldTag, newTag, siteLabel = '') {
    if (!oldTag || !newTag || oldTag === newTag) return;
    if (typeof imageFiles === 'undefined') return;
    const site = siteLabel ? siteLabel + ' ' : '';
    if (!confirm(`Convert ${site}alias tag "${oldTag}" to the main tag "${newTag}" everywhere in this dataset?\n\nThis replaces it on ALL images (not just the current selection/active image).`)) return;

    // Comparação tolerante a maiúsculas/minúsculas e espaços — a tag salva no
    // arquivo pode ter capitalização/espaçamento levemente diferente do que
    // foi resolvido pela API.
    const modifiedFiles = window.TM.tags.replace(window.TM.tags.visibleImages().filter(img => img.type === 'tags'), oldTag, newTag);
    const replacedCount = modifiedFiles.length;

    if (replacedCount === 0) {
        console.warn(`[${site}Alias Convert] Tag not found in any image.`, { oldTag, newTag });
        if (window.showAlert) window.showAlert(`Tag "${oldTag}" not found in this dataset.`, 'warn');
        return;
    }

    if (typeof activeSelectedTags !== 'undefined') activeSelectedTags.delete(oldTag);
    if (typeof masterSelectedTags !== 'undefined') masterSelectedTags.delete(oldTag);
    window.TM.tags.refreshViews();

    await Promise.all(modifiedFiles.map(img => window.saveImageToDisk(img)));
    if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();

    if (window.showAlert) window.showAlert(`Converted ${site}tag "${oldTag}" ➜ "${newTag}" in ${replacedCount} image(s).`, 'success');
};

window.convertAliasTagGlobally = (oldTag, newTag) => window.convertAliasTagEverywhere(oldTag, newTag, '');

/* ---------- FEATURE 1b: LIGA/DESLIGA O "CLIQUE PRA CONVERTER" ----------
   Controla se o nome/seta da tag-alias fica clicável pra conversão global
   (Feature 1). Independente do toggle de Preview Reverso (Feature 2). */
window.enableAliasConvertClick = window.enableAliasConvertClick !== undefined ? window.enableAliasConvertClick : true;

/* ---------- FEATURE 2: PREVIEW REVERSO DE ALIASES ----------
   Ao lado de uma tag "real" (não-alias), mostra quais tags-alias já vistas
   (mesmo cache compartilhado do Danbooru) apontam pra ela — igual ao alias
   mostrando a seta ➜, só que ao contrário. Limitado a N tags (configurável),
   com toggle liga/desliga (popout do Tag Interrogator). */
window.showAliasPreview = window.showAliasPreview !== undefined ? window.showAliasPreview : true;
window.aliasPreviewMaxCount = window.aliasPreviewMaxCount || 5;

window.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.getSetting === 'function') {
        window.aliasClickBehavior = await window.getSetting('alias-click-behavior', 'replace');
        window.enableAliasConvertClick = await window.getSetting('alias-convert-click-enabled', true);
        window.showAliasPreview = await window.getSetting('alias-preview-enabled', true);
        window.aliasPreviewMaxCount = await window.getSetting('alias-preview-max-count', 5);
    }
    // As opções ficam no popout do Tag Interrogator (tagmanager_danbooru_panel.js).
    if (typeof window.syncInterrogatorAliasOptions === 'function') window.syncInterrogatorAliasOptions();
});