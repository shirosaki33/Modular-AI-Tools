/* =========================================================================
   REMOVE TAG COOLDOWN (Standalone — não mexe nos outros arquivos)
   ---------------------------------------------------------------------
   PROBLEMA QUE ISSO RESOLVE:
   Mouse com o switch do botão gasto pode disparar 2 eventos de "click"
   pra um único clique físico ("double-click fantasma"). No contexto de
   remover tag (× na Active Image / All Dataset Tags), isso faz o app
   remover a tag clicada E, sem querer, a próxima tag que ficou na mesma
   posição do × logo em seguida — ou repetir a remoção de todo o grupo
   selecionado.

   COMO FUNCIONA:
   Este módulo envolve (wrap) as funções globais que efetivamente
   removem tag(s):
     - window.removeTagFromSelected   (× de uma tag na Active Image)
     - window.removeSelectedActiveTags (🗑️ Remove Selected, Active Image)
     - window.globalRemoveTags         (× de uma tag em All Dataset Tags)
     - window.removeSelectedMasterTags (🗑️ Remove, All Dataset Tags)

   Depois de QUALQUER remoção bem-sucedida, todas essas funções ficam
   bloqueadas por COOLDOWN_MS milissegundos — um clique (ou clique
   fantasma) que caia dentro dessa janela é simplesmente ignorado, com um
   aviso rápido na tela, em vez de remover outra tag sem querer.

   AJUSTE FÁCIL: mude o valor de COOLDOWN_MS abaixo (está em
   milissegundos; 3000 = 3 segundos, como pedido). Também dá pra mudar
   em tempo real no Console do navegador com:
     window.tagRemoveCooldownMs = 1500;
========================================================================= */

(function () {

    // Valor padrão: 3 segundos. Pode ser sobrescrito em runtime
    // (window.tagRemoveCooldownMs = ...) sem precisar editar este arquivo.
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
            window.showAlert(`⏳ Wait ${secondsLeft}s before try to remove again.`, 'warn');
        }
    }

    /* Envolve a função globalName: se estiver em cooldown, ignora a
       chamada e avisa; caso contrário, executa normalmente e inicia um
       novo cooldown a partir de agora. */
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
            'globalRemoveTags',         // × de 1 tag — All Dataset Tags
            'removeSelectedMasterTags'  // 🗑️ Remove — All Dataset Tags
        ].forEach(guardRemovalFn);
    }

    // As funções acima já existem como window.xxx no momento em que os
    // scripts terminam de rodar (definidas de forma síncrona nos outros
    // arquivos), então tanto faz rodar antes ou depois do DOMContentLoaded
    // — mas esperamos por segurança, caso a ordem dos <script> mude no
    // futuro.
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', installGuards);
    } else {
        installGuards();
    }

})();