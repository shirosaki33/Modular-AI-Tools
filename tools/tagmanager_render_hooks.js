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


    /* ---------- SCROLL KEEPER (posição da lista de imagens) ----------
       Qualquer re-render da lista (renderImageList / applyFilters / hooks
       de plugins como Compact View, que recriam os nós) ou um refresh do
       dataset (que esvazia #image-list e recarrega) jogava o scroll pro
       topo. Aqui, num só lugar, guardamos uma ÂNCORA por baseName:
         1) a imagem selecionada que está visível na tela (prioridade), ou
         2) a primeira imagem visível no topo da lista,
       com o deslocamento dela em pixels, e restauramos depois do render
       (e de todos os hooks). Funciona também quando os elementos são
       novos (refresh), porque procura pelo baseName. Ao trocar de
       dataset/pasta, a âncora é descartada (lista nova começa no topo). */
    const SK = { anchor: null, depth: 0, restoring: 0 };
    function skList() { return document.getElementById('image-list'); }
    function skDatasetKey() {
        const parts = [window.rootHandle ? window.rootHandle.name : ''];
        Array.from({ length: window.TM_MAX_FOLDER_DEPTH || 3 }, (_, i) => 'sub-dir-' + (i + 1)).forEach(id => {
            const el = document.getElementById(id);
            parts.push(el && el.style.display !== 'none' ? (el.value || '') : '');
        });
        return parts.join('/');
    }
    function skVisible(el) { return el && el.isConnected && el.style.display !== 'none' && el.offsetParent !== null; }
    function skCapture() {
        const list = skList();
        if (!list || typeof imageFiles === 'undefined' || !imageFiles.length) return null;
        const lr = list.getBoundingClientRect();
        // lista vazia/escondida (ex.: no meio de um refresh): mantém a âncora anterior
        if (!lr.height) return null;
        let pick = null;
        try {
            if (typeof selectedIndices !== 'undefined' && selectedIndices.size) {
                const order = [];
                if (typeof lastSelectedIndex === 'number' && selectedIndices.has(lastSelectedIndex)) order.push(lastSelectedIndex);
                selectedIndices.forEach(i => order.push(i));
                for (const i of order) {
                    const im = imageFiles[i], el = im && im.element;
                    if (!skVisible(el)) continue;
                    const r = el.getBoundingClientRect();
                    if (r.bottom > lr.top && r.top < lr.bottom) { pick = { im, top: r.top }; break; }
                }
            }
        } catch (e) {}
        if (!pick) {
            for (const im of imageFiles) {
                const el = im.element;
                if (!skVisible(el)) continue;
                const r = el.getBoundingClientRect();
                if (r.bottom > lr.top) { pick = { im, top: r.top }; break; }
            }
        }
        if (!pick) return null;
        return { baseName: pick.im.baseName, offset: pick.top - lr.top, scrollTop: list.scrollTop, key: skDatasetKey() };
    }
    function skRemember() {
        if (SK.restoring) return;
        const a = skCapture();
        if (a) SK.anchor = a;
    }
    function skRestoreOnce() {
        const a = SK.anchor, list = skList();
        if (!a || !list || typeof imageFiles === 'undefined') return;
        if (a.key !== skDatasetKey()) { SK.anchor = null; return; }
        const im = imageFiles.find(x => x.baseName === a.baseName);
        const el = im && im.element;
        if (!skVisible(el)) { if (list.scrollTop === 0 && a.scrollTop > 0) list.scrollTop = a.scrollTop; return; }
        const delta = (el.getBoundingClientRect().top - list.getBoundingClientRect().top) - a.offset;
        if (Math.abs(delta) > 1) list.scrollTop += delta;
    }
    function skRestore() {
        if (!SK.anchor) return;
        SK.restoring++;
        skRestoreOnce();
        // de novo após o layout (miniaturas / content-visibility mudam a altura)
        requestAnimationFrame(() => {
            skRestoreOnce();
            requestAnimationFrame(() => { skRestoreOnce(); setTimeout(() => { skRestoreOnce(); SK.restoring--; }, 60); });
        });
    }
    // Envolve uma chamada: captura antes (só a mais externa) e restaura depois.
    function skAround(run) {
        const outer = SK.depth === 0;
        if (outer) skRemember();
        SK.depth++;
        let r;
        try { r = run(); } finally { SK.depth--; }
        if (outer) skRestore();
        return r;
    }
    // Atualiza a âncora enquanto o usuário rola (sobrevive a refresh que esvazia a lista).
    let skScrollRAF = null;
    function skHookScroll() {
        const list = skList();
        if (!list || list.__skHooked) return;
        list.__skHooked = true;
        list.addEventListener('scroll', () => {
            if (SK.restoring || SK.depth || skScrollRAF) return;
            skScrollRAF = requestAnimationFrame(() => { skScrollRAF = null; skRemember(); });
        }, { passive: true });
        // clique numa imagem também atualiza (garante a seleção como âncora)
        list.addEventListener('click', () => setTimeout(skRemember, 0), true);
    }
    window.tmKeepListScroll = skAround;   // utilitário p/ plugins
    window.tmRememberListScroll = skRemember;
    window.tmRestoreListScroll = skRestore;

    function wrapOnce(fnName, evt, before, isAsync, keepScroll) {
        const fn = window[fnName];
        if (typeof fn !== 'function' || fn.__hooksWrapped) return;
        const wrapped = isAsync
            ? async function () {
                const r = await fn.apply(this, arguments);
                TM.emit(evt, ...arguments);
                return r;
            }
            : function () {
                const self = this, args = arguments;
                const body = () => {
                    const r = fn.apply(self, args);
                    if (before) before();
                    TM.emit(evt);
                    return r;
                };
                return keepScroll ? skAround(body) : body();
            };
        wrapped.__hooksWrapped = true;
        window[fnName] = wrapped;
    }

    function installWraps() {
        wrapOnce('renderImageList', 'render:list', checkDatasetChange, false, true);
        wrapOnce('renderEditor', 'render:editor');
        wrapOnce('renderMasterTagList', 'render:master');
        wrapOnce('applyFilters', 'filters:applied', null, false, true);
        wrapOnce('loadSettings', 'settings:loaded', null, true);
        wrapOnce('loadDatasetConfig', 'config:loaded', null, true);
        wrapOnce('updateUnsavedChangesUI', 'ui:unsaved');
        skHookScroll();
    }

    // Instala assim que este script roda (as funções já existem pela ordem
    // do HTML) e de novo no DOMContentLoaded como rede de segurança.
    installWraps();
    window.addEventListener('DOMContentLoaded', installWraps);

    // Mantém o badge "Tags (n) · NL (n) (.fmt)" da lista sempre atualizado.
    TM.on('filters:applied', () => { if (typeof window.refreshListStatus === 'function') window.refreshListStatus(); });
})();
