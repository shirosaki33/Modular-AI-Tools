/* =========================================================================
   RENDER HOOKS REGISTRY (novo arquivo — otimização de performance)
   ---------------------------------------------------------------------
   PROBLEMA QUE ISSO RESOLVE:
   window.renderImageList / window.renderEditor / window.renderMasterTagList
   / window.applyFilters eram envelopadas (wrapped) INDEPENDENTEMENTE por
   vários plugins (pin_image, compact_view, custom_conflicts, danbooru_panel
   — alguns deles mais de uma vez no mesmo arquivo). Cada wrap chama a
   função original e DEPOIS faz seu próprio loop completo sobre
   imageFiles/DOM. Com 5-7 wraps empilhados, 1 render vira 5-7 passadas
   completas, cada uma com sua própria função de call-stack.

   Este arquivo cria um único ponto de wrap por função, com uma lista de
   callbacks ("hooks") registrados pelos plugins. Mesmo resultado visual,
   menos overhead de empilhamento de closures e muito mais fácil de
   depurar (dá pra ver todos os hooks registrados inspecionando os
   arrays abaixo).

   IMPORTANTE: precisa carregar DEPOIS de tagmanager_ui_list.js,
   tagmanager_active_editor.js, tagmanager_master_list.js e
   tagmanager_ui_core.js (que definem as funções base) e ANTES de
   tagmanager_pin_image.js, tagmanager_compact_view.js,
   tagmanager_custom_conflicts.js, tagmanager_danbooru_panel.js
   (que agora registram hooks aqui em vez de fazer wrap próprio).
========================================================================= */

(function () {
    window._postRenderImageListHooks = window._postRenderImageListHooks || [];
    window._postRenderEditorHooks = window._postRenderEditorHooks || [];
    window._postRenderMasterTagListHooks = window._postRenderMasterTagListHooks || [];
    window._postApplyFiltersHooks = window._postApplyFiltersHooks || [];

    window.registerPostRenderImageList = function (fn) { window._postRenderImageListHooks.push(fn); };
    window.registerPostRenderEditor = function (fn) { window._postRenderEditorHooks.push(fn); };
    window.registerPostRenderMasterTagList = function (fn) { window._postRenderMasterTagListHooks.push(fn); };
    window.registerPostApplyFilters = function (fn) { window._postApplyFiltersHooks.push(fn); };

    function wrapOnce(fnName, hooksArrayGetter) {
        if (typeof window[fnName] !== 'function' || window[fnName].__hooksWrapped) return;
        const original = window[fnName];
        const wrapped = function () {
            const result = original.apply(this, arguments);
            hooksArrayGetter().forEach(fn => {
                try { fn(); } catch (e) { console.warn(`[Render Hooks] ${fnName} hook failed:`, e); }
            });
            return result;
        };
        wrapped.__hooksWrapped = true;
        window[fnName] = wrapped;
    }

    function installWraps() {
        wrapOnce('renderImageList', () => window._postRenderImageListHooks);
        wrapOnce('renderEditor', () => window._postRenderEditorHooks);
        wrapOnce('renderMasterTagList', () => window._postRenderMasterTagListHooks);
        wrapOnce('applyFilters', () => window._postApplyFiltersHooks);
    }

    // Instala assim que este script roda (as 4 funções já devem existir,
    // dada a ordem de carregamento no HTML). Reinstala no DOMContentLoaded
    // como rede de segurança, caso algum script mude a ordem no futuro.
    installWraps();
    window.addEventListener('DOMContentLoaded', installWraps);
})();