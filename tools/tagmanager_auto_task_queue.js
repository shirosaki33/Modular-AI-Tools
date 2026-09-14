/* =========================================================================
   AUTO DATASET TASK QUEUE (novo arquivo — otimização de performance)
   ---------------------------------------------------------------------
   PROBLEMA QUE ISSO RESOLVE:
   Ao trocar de dataset, 3 scans automáticos disparavam de forma
   INDEPENDENTE, cada um com seu próprio wrap de renderImageList e seu
   próprio setTimeout: runDanbooruBackgroundScan (danbooru_panel.js),
   runDupNameFixer (dup_name_fixer.js) e runAutoMergeOnDataset
   (custom_conflicts.js). Rodando ao mesmo tempo, competindo por I/O de
   disco/rede e mexendo em imageFiles/arquivos sem coordenação entre si —
   provável causa de falhas intermitentes com datasets grandes.

   Agora existe UM único ponto de detecção de "dataset mudou"
   (window.renderImageList recebe uma referência nova de imageFiles) e
   UMA fila que roda os handlers registrados EM SEQUÊNCIA (await entre
   eles, nunca em paralelo). Se um handler disparar um refreshDataset()
   no meio do caminho (ex: dup fixer renomeando arquivos), a detecção de
   mudança dispara de novo, mas como a fila já está rodando ela só marca
   "pending" e roda uma passada extra no final, em vez de empilhar
   execuções concorrentes.

   Cada plugin chama window.registerAutoDatasetTask(nome, fnAsync) no seu
   próprio arquivo, no lugar do hookXXX()/wrap que tinha antes.
========================================================================= */

(function () {
    window._autoTaskHandlers = window._autoTaskHandlers || [];
    window._autoTaskQueueRunning = false;
    window._autoTaskQueuePending = false;

    window.registerAutoDatasetTask = function (name, fn) {
        window._autoTaskHandlers.push({ name, fn });
    };

    async function runQueueOnce() {
        if (window._autoTaskQueueRunning) {
            window._autoTaskQueuePending = true;
            return;
        }
        window._autoTaskQueueRunning = true;
        for (const handler of window._autoTaskHandlers) {
            try {
                await handler.fn();
            } catch (e) {
                console.warn('[Auto Task Queue] handler failed:', handler.name, e);
            }
        }
        window._autoTaskQueueRunning = false;

        if (window._autoTaskQueuePending) {
            window._autoTaskQueuePending = false;
            // Algo (provavelmente um refreshDataset disparado por um dos
            // handlers) mudou o dataset de novo enquanto a fila rodava —
            // roda mais uma passada pra não deixar nada pra trás.
            runQueueOnce();
        }
    }

    let _lastImageFilesRef = null;
    function detectDatasetChangeForQueue() {
        if (typeof imageFiles !== 'undefined' && imageFiles !== _lastImageFilesRef) {
            _lastImageFilesRef = imageFiles;
            setTimeout(runQueueOnce, 600);
        }
    }

    /* FIX (otimização): antes este arquivo sempre envelopava
       window.renderImageList manualmente por conta própria, empilhando mais
       uma camada de wrap em cima das já existentes (pin_image, compact_view,
       danbooru_panel etc — exatamente o padrão que tagmanager_render_hooks.js
       foi criado pra eliminar). Agora usa o registry central quando
       disponível (carrega antes deste arquivo no HTML) e só cai pro wrap
       manual antigo como rede de segurança, caso a ordem dos <script> mude
       no futuro. */
    function hookDatasetChangeDetection() {
        if (typeof window.registerPostRenderImageList === 'function') {
            if (!window._autoQueueHookRegistered) {
                window.registerPostRenderImageList(detectDatasetChangeForQueue);
                window._autoQueueHookRegistered = true;
            }
            return;
        }
        if (typeof window.renderImageList !== 'function' || window.renderImageList.__autoQueueWrapped) return;
        const original = window.renderImageList;
        const wrapped = function () {
            original.apply(this, arguments);
            detectDatasetChangeForQueue();
        };
        wrapped.__autoQueueWrapped = true;
        window.renderImageList = wrapped;
    }

    window.addEventListener('DOMContentLoaded', () => setTimeout(hookDatasetChangeDetection, 0));
})();