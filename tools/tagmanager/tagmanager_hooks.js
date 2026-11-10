/* ===== merged from tagmanager_hooks.js ===== */
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

/* ===== merged from tagmanager_hooks.js ===== */
/* =========================================================================
   REMOVE TAG COOLDOWN (Standalone — não mexe nos outros arquivos)
   ---------------------------------------------------------------------
   PROBLEMA QUE ISSO RESOLVE:
   Mouse com o switch gasto pode disparar 2 "clicks" para um único clique
   físico. No × de remover tag isso remove a tag clicada E a próxima que
   ficou na mesma posição logo em seguida.

   COMO FUNCIONA:
   Envolve as funções globais que removem tag(s) por clique direto:
     - window.removeTagFromSelected    (× de uma tag na Active Image)
     - window.removeSelectedActiveTags (🗑️ Remove Selected, Active Image)
     - window.globalRemoveTags         (× de uma tag em All Dataset Tags,
                                        e também o 🗑️ Remove, que delega pra cá)
   Depois de uma remoção, novas remoções ficam bloqueadas por
   window.tagRemoveCooldownMs milissegundos (padrão: 1000 = 1 segundo).

   FIX: removeSelectedMasterTags NÃO é mais envolvida. Ela só pede
   confirmação e chama globalRemoveTags — com as duas envolvidas, a
   primeira iniciava o cooldown e a segunda (já em cooldown) bloqueava a
   própria remoção. Só funcionava porque o confirm() costuma demorar mais
   de 1 s.

   AJUSTE: no Console do navegador, window.tagRemoveCooldownMs = 1500;
========================================================================= */

(function () {

    window.tagRemoveCooldownMs = window.tagRemoveCooldownMs !== undefined ? window.tagRemoveCooldownMs : 1000;

    let lastRemovalAt = 0;

    function isOnCooldown() {
        return (Date.now() - lastRemovalAt) < window.tagRemoveCooldownMs;
    }

    function noteRemovalHappened() {
        lastRemovalAt = Date.now();
    }

    function warnBlocked() {
        const secondsLeft = Math.max(0, ((window.tagRemoveCooldownMs - (Date.now() - lastRemovalAt)) / 1000)).toFixed(1);
        if (typeof window.showAlert === 'function') {
            window.showAlert(`⏳ Wait ${secondsLeft}s before removing again.`, 'warn');
        }
    }

    function guardRemovalFn(globalName) {
        const original = window[globalName];
        if (typeof original !== 'function' || original.__removeCooldownWrapped) return;

        const wrapped = function (...args) {
            if (isOnCooldown()) {
                warnBlocked();
                return;
            }
            noteRemovalHappened();
            return original.apply(this, args);
        };
        wrapped.__removeCooldownWrapped = true;
        window[globalName] = wrapped;
    }

    function installGuards() {
        [
            'removeTagFromSelected',    // × de 1 tag — Active Image
            'removeSelectedActiveTags', // 🗑️ Remove Selected — Active Image
            'globalRemoveTags'          // × de 1 tag / 🗑️ Remove — All Dataset Tags
        ].forEach(guardRemovalFn);
    }

    // Must be the OUTERMOST wrapper: Review Mode (tagmanager_review_unconfirmed.js)
    // also wraps these functions on DOMContentLoaded and clears the "pending
    // remove" mark after the call. If this guard were inside, a blocked click
    // would still clear that mark. setTimeout(0) runs after every
    // DOMContentLoaded listener, whatever the script order in the HTML.
    const installLast = () => setTimeout(installGuards, 0);
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', installLast);
    } else {
        installLast();
    }

})();

/* ===== merged from tagmanager_hooks.js ===== */
/* =========================================================================
   AUTO DATASET TASK QUEUE (novo arquivo — otimização de performance)
   ---------------------------------------------------------------------
   PROBLEMA QUE ISSO RESOLVE:
   Ao trocar de dataset, vários scans automáticos disparavam de forma
   INDEPENDENTE, cada um com seu próprio wrap de renderImageList e seu
   próprio setTimeout, competindo por I/O de disco/rede e mexendo em
   imageFiles/arquivos sem coordenação entre si.

   Agora existe UM único ponto de detecção de "dataset mudou"
   (window.renderImageList recebe uma referência nova de imageFiles) e
   UMA fila que roda os handlers registrados EM SEQUÊNCIA (await entre
   eles, nunca em paralelo). Se um handler disparar um refreshDataset()
   no meio do caminho, a mudança é marcada como "pending" NA HORA
   (window._autoTaskQueuePending) e a fila roda uma passada extra no fim.
   Handlers que alteram dados (ex: Auto-Do) devem checar essa flag e
   pular a passada atual — a passada extra os alcança com dados novos.

   REVISÃO (bugs achados na auditoria do Auto-Do):
   - Um handler que nunca terminasse (rede/disco travado) deixava a fila
     "running" para sempre e NENHUM dataset novo disparava mais nada até
     recarregar o app. Agora cada handler tem timeout (a fila segue em
     frente) e o estado "running" é sempre liberado (try/finally).
   - registerAutoDatasetTask(nome, fn, prioridade): menor roda primeiro
     (padrão 0). O Auto-Do usa 90, então roda depois dos demais.
   - A mudança de dataset detectada DURANTE uma passada agora marca
     pending imediatamente (antes só marcava quando o timer de 600ms
     disparava, tarde demais para os handlers perceberem).
   - Limite de passadas extras seguidas (evita loop se algo refrescar o
     dataset a cada passada).
========================================================================= */

(function () {
    window._autoTaskHandlers = window._autoTaskHandlers || [];
    window._autoTaskQueueRunning = false;
    window._autoTaskQueuePending = false;

    const HANDLER_TIMEOUT_MS = 120000;
    const MAX_CHAINED_PASSES = 4;

    window.registerAutoDatasetTask = function (name, fn, priority) {
        window._autoTaskHandlers.push({ name, fn, priority: Number.isFinite(priority) ? priority : 0 });
        // sort() is stable: handlers with the same priority keep registration order.
        window._autoTaskHandlers.sort((a, b) => a.priority - b.priority);
    };

    function runWithTimeout(handler) {
        let timer;
        const timeout = new Promise(resolve => {
            timer = setTimeout(() => {
                console.warn('[Auto Task Queue] handler timed out, moving on:', handler.name);
                resolve();
            }, HANDLER_TIMEOUT_MS);
        });
        const work = Promise.resolve().then(() => handler.fn());
        return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
    }

    let _chained = 0;
    async function runQueueOnce() {
        if (window._autoTaskQueueRunning) {
            window._autoTaskQueuePending = true;
            return;
        }
        window._autoTaskQueueRunning = true;
        window._autoTaskQueuePending = false;
        try {
            for (const handler of window._autoTaskHandlers.slice()) {
                try {
                    await runWithTimeout(handler);
                } catch (e) {
                    console.warn('[Auto Task Queue] handler failed:', handler.name, e);
                }
            }
        } finally {
            window._autoTaskQueueRunning = false;
        }

        if (window._autoTaskQueuePending && _chained < MAX_CHAINED_PASSES) {
            // Algo (provavelmente um refreshDataset disparado por um dos
            // handlers) mudou o dataset de novo enquanto a fila rodava —
            // roda mais uma passada pra não deixar nada pra trás.
            _chained++;
            window._autoTaskQueuePending = false;
            runQueueOnce();
        } else {
            _chained = 0;
            window._autoTaskQueuePending = false;
        }
    }

    let _timer = null;
    function onDatasetLoadedForQueue() {
        if (window._autoTaskQueueRunning) {
            // Já tem uma passada em andamento: só marca; ela mesma roda a próxima.
            window._autoTaskQueuePending = true;
            return;
        }
        clearTimeout(_timer);
        _timer = setTimeout(runQueueOnce, 600);
    }

    // Troca de dataset: evento único do hub (tagmanager_render_hooks.js).
    if (window.TM && window.TM.on) window.TM.on('dataset:loaded', onDatasetLoadedForQueue);
    else console.error('[Auto tasks] tagmanager_render_hooks.js must load before tagmanager_auto_task_queue.js.');
})();
