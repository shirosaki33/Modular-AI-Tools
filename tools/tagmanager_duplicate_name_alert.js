/* =========================================================================
   DUPLICATE NAME CONFLICT ALERT (substitui o tagmanager_dup_name_fixer.js)
   ---------------------------------------------------------------------
   ANTES (tagmanager_dup_name_fixer.js, REMOVIDO): quando a pasta do
   dataset tinha o mesmo baseName com extensões de imagem diferentes
   (ex: "gato.png" e "gato.jpg" — as duas leem/escrevem a MESMA legenda
   "gato.txt"), o app RENOMEAVA automaticamente uma delas sozinho, sem
   perguntar, criando cópias de legenda e mexendo em arquivos no disco.

   AGORA: este módulo é 100% passivo/somente-leitura. Ele não move, não
   renomeia e não escreve NADA. Ele apenas:
     1) Agrupa window.imageFiles (visíveis, não hidden) por baseName
        (case-insensitive);
     2) Qualquer grupo com mais de 1 item é marcado como conflito de nome;
     3) Cada item desses ganha, na lista "Dataset" (coluna esquerda):
          - um realce vermelho na linha (.dup-name-conflict)
          - um selo "⚠️ Duplicate name" ao lado do nome, com tooltip
            listando os outros arquivos que colidem com ele.
   O usuário decide o que fazer manualmente — ex: usar o botão ✏️ Rename
   já existente na barra de seleção da lista para resolver a colisão.

   Roda automaticamente toda vez que a lista de imagens é (re)desenhada,
   registrando-se no hub central de hooks (tagmanager_render_hooks.js),
   com fallback pra um wrap manual se esse arquivo não tiver carregado.
========================================================================= */

(function () {

    const style = document.createElement('style');
    style.innerHTML = `
        .list-item.dup-name-conflict {
            background: rgba(200, 40, 40, 0.16) !important;
            border-left: 3px solid #ff4444 !important;
            padding-left: 9px;
        }
        .list-item.dup-name-conflict:hover { background: rgba(200, 40, 40, 0.26) !important; }
        .list-item.dup-name-conflict.selected {
            /* Seleção (azul) continua tendo prioridade visual mesmo em conflito de nome —
               senão fica impossível saber se o item ATUAL está selecionado. */
            border-left: 3px solid #4db8ff !important;
        }
        .dup-name-badge {
            display: inline-block; margin-left: 6px; font-size: 9px; font-weight: bold;
            color: #ffaaaa; background: #330000; border: 1px solid #ff4444;
            border-radius: 10px; padding: 1px 6px; vertical-align: middle;
            cursor: help; white-space: nowrap; user-select: none;
        }
    `;
    document.head.appendChild(style);

    /* ---------- CÁLCULO DOS GRUPOS DUPLICADOS ---------- */
    function computeDuplicateSiblingsMap() {
        const siblingsMap = new Map(); // img -> [outros nomes que colidem]
        if (typeof imageFiles === 'undefined') return siblingsMap;

        const groups = new Map(); // baseNameLower -> [img, ...]
        imageFiles.forEach(img => {
            if (img.hidden) return;
            const key = (img.baseName || '').toLowerCase();
            if (!key) return;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(img);
        });

        groups.forEach(group => {
            if (group.length < 2) return;
            group.forEach(img => {
                siblingsMap.set(img, group.filter(g => g !== img).map(g => g.name));
            });
        });

        return siblingsMap;
    }

    /* ---------- APLICA O REALCE + SELO NOS ELEMENTOS JÁ RENDERIZADOS ---------- */
    function applyDuplicateNameAlerts() {
        if (typeof imageFiles === 'undefined') return;
        const siblingsMap = computeDuplicateSiblingsMap();

        imageFiles.forEach(img => {
            if (!img.element) return;
            const nameEl = img.element.querySelector('.list-item-name');
            const siblings = siblingsMap.get(img);

            if (siblings) {
                img.element.classList.add('dup-name-conflict');
                if (nameEl) {
                    let badge = nameEl.querySelector('.dup-name-badge');
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'dup-name-badge';
                        nameEl.appendChild(badge);
                    }
                    badge.textContent = '⚠️ Duplicate name';
                    badge.title = `Same base name is also used by: ${siblings.join(', ')}\nCaptions may collide between these files (they read/write the same .txt/.json). Rename one of them (✏️) to fix.`;
                }
            } else {
                img.element.classList.remove('dup-name-conflict');
                const badge = nameEl && nameEl.querySelector('.dup-name-badge');
                if (badge) badge.remove();
            }
        });
    }

    /* ---------- INSTALAÇÃO DO HOOK PÓS-RENDER ---------- */
    function installHook() {
        if (typeof window.registerPostRenderImageList === 'function') {
            window.registerPostRenderImageList(applyDuplicateNameAlerts);
            return true;
        }
        if (typeof window.renderImageList === 'function' && !window.renderImageList.__dupAlertWrapped) {
            const original = window.renderImageList;
            const wrapped = function () {
                original.apply(this, arguments);
                applyDuplicateNameAlerts();
            };
            wrapped.__dupAlertWrapped = true;
            window.renderImageList = wrapped;
            return true;
        }
        return false;
    }

    if (!installHook()) window.addEventListener('DOMContentLoaded', () => setTimeout(installHook, 0));

})();