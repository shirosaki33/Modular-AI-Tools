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
