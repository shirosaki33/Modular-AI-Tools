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
