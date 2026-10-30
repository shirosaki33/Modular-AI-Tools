/* =========================================================================
   TM — RENDER HOOKS / EVENTOS DO NÚCLEO (o barramento fica em tagmanager_tm.js)
   ---------------------------------------------------------------------
   Os plugins não devem mais substituir (wrap) as funções núcleo. Eles só
   ESCUTAM eventos aqui:

     TM.on(evento, fn)   / TM.off(evento, fn)   / TM.emit(evento, ...args)

   Eventos disparados pelo hub:
     'render:list'      depois de window.renderImageList()
     'render:editor'    depois de window.renderEditor()
     'render:master'    depois de window.renderMasterTagList()
     'filters:applied'  depois de window.applyFilters()
     'dataset:loaded'   uma vez por dataset carregado (pasta / subpasta /
                        refresh) — detectado aqui, num só lugar, em vez de
                        cada plugin comparar a referência de imageFiles.
     'settings:loaded'  depois de window.loadSettings()
     'config:loaded'    depois de window.loadDatasetConfig(dirHandle)
     'ui:unsaved'       depois de window.updateUnsavedChangesUI()
   Disparado pelo TagModel (tagmanager_tag_model.js):
     'tags:changed'     (imgs)  conteúdo de tags mudou
   Disparado pela Active Image (tagmanager_active_editor.js):
     'selection:active' (set)   seleção de tags mudou SEM re-render da lista

   Compat: registerPostRenderImageList / Editor / MasterTagList /
   registerPostApplyFilters continuam existindo e viram TM.on(...).

   Precisa carregar DEPOIS de tagmanager_ui_list.js, tagmanager_active_editor.js,
   tagmanager_master_list.js e tagmanager_ui_core.js (que definem as funções
   base) e ANTES dos plugins.
========================================================================= */

(function () {
    const TM = window.TM;
    if (!TM || typeof TM.emit !== 'function') {
        console.error('[TM] tagmanager_tm.js must load before tagmanager_render_hooks.js.');
        return;
    }

    /* ---------- dataset:loaded (detecção central) ----------
       loadGallery / loadSubDir* trocam a referência de imageFiles e depois
       chamam finishLoading() -> renderImageList(). O primeiro render com uma
       referência nova dispara o evento, ANTES dos hooks de render:list. */
    let lastFilesRef = null;
    TM.datasetVersion = 0;
    function checkDatasetChange() {
        if (typeof imageFiles === 'undefined' || imageFiles === lastFilesRef) return;
        lastFilesRef = imageFiles;
        TM.datasetVersion++;
        TM.emit('dataset:loaded', imageFiles);
    }

    function wrapOnce(fnName, evt, before, isAsync) {
        const fn = window[fnName];
        if (typeof fn !== 'function' || fn.__hooksWrapped) return;
        const wrapped = isAsync
            ? async function () {
                const r = await fn.apply(this, arguments);
                TM.emit(evt, ...arguments);
                return r;
            }
            : function () {
                const r = fn.apply(this, arguments);
                if (before) before();
                TM.emit(evt);
                return r;
            };
        wrapped.__hooksWrapped = true;
        window[fnName] = wrapped;
    }

    function installWraps() {
        wrapOnce('renderImageList', 'render:list', checkDatasetChange);
        wrapOnce('renderEditor', 'render:editor');
        wrapOnce('renderMasterTagList', 'render:master');
        wrapOnce('applyFilters', 'filters:applied');
        wrapOnce('loadSettings', 'settings:loaded', null, true);
        wrapOnce('loadDatasetConfig', 'config:loaded', null, true);
        wrapOnce('updateUnsavedChangesUI', 'ui:unsaved');
    }

    // Instala assim que este script roda (as funções já existem pela ordem
    // do HTML) e de novo no DOMContentLoaded como rede de segurança.
    installWraps();
    window.addEventListener('DOMContentLoaded', installWraps);

    // Mantém o badge "Tags (n) · NL (n) (.fmt)" da lista sempre atualizado.
    TM.on('filters:applied', () => { if (typeof window.refreshListStatus === 'function') window.refreshListStatus(); });
})();
