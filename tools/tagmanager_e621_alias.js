/* =========================================================================
   E621 ALIAS BEHAVIOR
   ---------------------------------------------------------------------
   Tudo relacionado a tags-alias no e621/e926:
   - Preferência de clique no autocomplete (substituir vs manter)
   - Feature 1: clicar no nome/seta de uma tag-alias converte ela pra tag
     principal em TODO o dataset (window.e621ConvertAliasTagGlobally)
   - Feature 2: preview reverso (cálculo/HTML em tagmanager_alias_bridge.js);
     aqui só ficam as opções liga/desliga e o limite.
   A conversão em si é a mesma do Danbooru: window.convertAliasTagEverywhere
   (tagmanager_danbooru_alias.js).
   - As opções aparecem no popout do Tag Interrogator (seção "↪️ Alias tags").
========================================================================= */

/* ---------- COMPORTAMENTO AO CLICAR NUMA SUGESTÃO-ALIAS ---------- */
window.e621AliasClickBehavior = window.e621AliasClickBehavior || 'replace';
 
window.e621SetAliasClickBehavior = function (mode) {
    window.e621AliasClickBehavior = mode === 'keep' ? 'keep' : 'replace';
    if (typeof window.saveSetting === 'function') window.saveSetting('e621-alias-click-behavior', window.e621AliasClickBehavior);
};
 
/* ---------- FEATURE 1: CONVERTER ALIAS -> TAG PRINCIPAL, GLOBALMENTE ---------- */
window.e621ConvertAliasTagGlobally = function (oldTag, newTag) {
    if (typeof window.convertAliasTagEverywhere !== 'function') {
        console.error('[e621 Alias Convert] tagmanager_danbooru_alias.js is not loaded.');
        return Promise.resolve();
    }
    return window.convertAliasTagEverywhere(oldTag, newTag, 'e621');
};

window.e621EnableAliasConvertClick = window.e621EnableAliasConvertClick !== undefined ? window.e621EnableAliasConvertClick : true;

/* ---------- FEATURE 2: PREVIEW REVERSO DE ALIASES ---------- */
window.e621ShowAliasPreview = window.e621ShowAliasPreview !== undefined ? window.e621ShowAliasPreview : true;
window.e621AliasPreviewMaxCount = window.e621AliasPreviewMaxCount || 5;

window.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.getSetting === 'function') {
        window.e621AliasClickBehavior = await window.getSetting('e621-alias-click-behavior', 'replace');
        window.e621EnableAliasConvertClick = await window.getSetting('e621-alias-convert-click-enabled', true);
        window.e621ShowAliasPreview = await window.getSetting('e621-alias-preview-enabled', true);
        window.e621AliasPreviewMaxCount = await window.getSetting('e621-alias-preview-max-count', 5);
    }
    
    // As opções ficam no popout do Tag Interrogator (tagmanager_danbooru_panel.js).
    if (typeof window.syncInterrogatorAliasOptions === 'function') window.syncInterrogatorAliasOptions();
});
