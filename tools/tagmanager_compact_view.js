/* =========================================================================
   COMPACT VIEW MODULE (Standalone — não mexe nos outros arquivos)
   ---------------------------------------------------------------------
   Substitui a ideia de "modo grid" por um modo Compacto: a lista do
   Dataset continua exatamente no mesmo formato de linha de sempre
   (thumbnail + nome + status), só que agrupada em seções colapsáveis
   por prefixo do nome do arquivo — útil para navegar datasets com vários
   personagens/categorias misturados no mesmo folder.

   - Botão 🗂️ (ao lado do filtro por nome) alterna Lista normal ↔ Compacto.
   - Em modo Compacto aparece um 2º botão "Grp: N" que abre um prompt para
     definir quantos caracteres iniciais do nome definem cada grupo
     (ex: 1 agrupa por letra/dígito inicial; 5 agrupa pelos 5 primeiros
     caracteres — quanto maior o número, mais grupos/mais específico).
   - Cada grupo tem cabeçalho clicável (nome do grupo + contagem) que
     colapsa/expande aquele grupo.
   - Não duplicamos a renderização dos itens: reaproveitamos os mesmos
     elementos .list-item já criados por window.renderImageList()
     (o mesmo padrão usado em tagmanager_pin_image.js) e só os
     reorganizamos dentro de contêineres de grupo — clique, seleção,
     pin, tudo continua funcionando igual.
========================================================================= */

(function () {

    /* ---------- CSS ---------- */
    const style = document.createElement('style');
    style.innerHTML = `
        .compact-group { display: flex; flex-direction: column; }
        .compact-group-header {
            display: flex; align-items: center; justify-content: space-between; gap: 8px;
            padding: 6px 12px; background: #1a1a1a; border-bottom: 1px solid #222; border-top: 1px solid #050505;
            cursor: pointer; user-select: none; position: sticky; top: 0; z-index: 2;
        }
        .compact-group-header:hover { background: #222; }
        .compact-group-header .grp-label { font-size: 11px; font-weight: bold; color: #9ecfff; letter-spacing: 0.5px; }
        .compact-group-header .grp-count { font-size: 10px; color: #666; background: #111; padding: 1px 7px; border-radius: 10px; }
        .compact-group-header .grp-arrow { font-size: 10px; color: #666; transition: 0.15s; flex-shrink: 0; }
        .compact-group.collapsed .compact-group-items { display: none; }
        .compact-group.collapsed .grp-arrow { transform: rotate(-90deg); }

        #btn-toggle-compact-view.active-mode,
        #btn-compact-group-depth { background: #2f1a5c; color: #b890ff; border-color: #4a2a8c; }
        #btn-compact-group-depth:hover { background: #4a2a8c; color: #fff; }
    `;
    document.head.appendChild(style);

    /* ---------- ESTADO ---------- */
    window.compactMode = window.compactMode || false;
    window.compactGroupDepth = window.compactGroupDepth || 1;
    window._compactCollapsedGroups = window._compactCollapsedGroups || new Set();

    function groupKeyFor(img) {
        const base = (img.baseName || img.name || '').toUpperCase();
        const key = base.slice(0, window.compactGroupDepth);
        return key || '#';
    }

    /* ---------- MONTA OS GRUPOS (reaproveitando os elementos já criados) ---------- */
    function buildCompactGroups() {
        const listDiv = document.getElementById('image-list');
        if (!listDiv || typeof imageFiles === 'undefined') return;

        const groups = new Map(); // key -> [elements]
        imageFiles.forEach(img => {
            if (img.hidden || !img.element) return;
            const key = groupKeyFor(img);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(img.element);
        });

        // Detacha tudo (os nós continuam vivos via imageFiles[].element / arrays acima)
        listDiv.innerHTML = '';

        if (groups.size === 0) return;

        Array.from(groups.keys()).sort().forEach(key => {
            const els = groups.get(key);
            const isCollapsed = window._compactCollapsedGroups.has(key);

            const groupDiv = document.createElement('div');
            groupDiv.className = 'compact-group' + (isCollapsed ? ' collapsed' : '');
            groupDiv.dataset.groupKey = key;

            const header = document.createElement('div');
            header.className = 'compact-group-header';
            header.innerHTML = `<span class="grp-label">${key}</span><span class="grp-count">${els.length}</span><span class="grp-arrow">▼</span>`;
            header.onclick = () => {
                groupDiv.classList.toggle('collapsed');
                if (groupDiv.classList.contains('collapsed')) window._compactCollapsedGroups.add(key);
                else window._compactCollapsedGroups.delete(key);
            };

            const itemsWrap = document.createElement('div');
            itemsWrap.className = 'compact-group-items';
            els.forEach(el => itemsWrap.appendChild(el));

            groupDiv.appendChild(header);
            groupDiv.appendChild(itemsWrap);
            listDiv.appendChild(groupDiv);
        });
    }

    /* Esconde/mostra o grupo inteiro e atualiza a contagem conforme o filtro
       de busca por nome (e outros filtros) vai escondendo itens individuais. */
    function updateGroupVisibility() {
        if (!window.compactMode) return;
        document.querySelectorAll('#image-list .compact-group').forEach(groupDiv => {
            const itemsWrap = groupDiv.querySelector('.compact-group-items');
            if (!itemsWrap) return;
            const children = Array.from(itemsWrap.children);
            const visibleCount = children.filter(el => el.style.display !== 'none').length;
            groupDiv.style.display = visibleCount === 0 ? 'none' : '';
            const countEl = groupDiv.querySelector('.grp-count');
            if (countEl) countEl.textContent = visibleCount;
        });
    }

    /* ---------- UI: BOTÕES ---------- */
    function applyToggleUI() {
        const btn = document.getElementById('btn-toggle-compact-view');
        const depthBtn = document.getElementById('btn-compact-group-depth');
        if (btn) {
            btn.classList.toggle('active-mode', window.compactMode);
            btn.title = window.compactMode ? 'Switch back to normal List View' : 'Switch to Compact View (grouped by prefix)';
        }
        if (depthBtn) {
            depthBtn.style.display = window.compactMode ? 'inline-block' : 'none';
            depthBtn.textContent = `Grp: ${window.compactGroupDepth}`;
        }
    }

    window.toggleCompactMode = function () {
        window.compactMode = !window.compactMode;
        applyToggleUI();
        if (typeof window.saveSetting === 'function') window.saveSetting('compact-view-mode', window.compactMode);
        // Re-renderiza a lista inteira: se compactMode ficou true, o wrap abaixo
        // já reagrupa automaticamente; se ficou false, volta ao formato plano normal.
        if (typeof window.renderImageList === 'function') window.renderImageList();
    };

    window.promptCompactGroupDepth = function () {
        const current = window.compactGroupDepth || 1;
        const input = prompt('How many starting characters should define each group?\n(e.g. 1 groups by the first letter/digit; 5 groups by the first 5 characters — the more characters, the more specific/smaller the groups)', current);
        if (input === null) return;
        const n = parseInt(input, 10);
        if (!n || n < 1) return;
        window.compactGroupDepth = Math.min(n, 40);
        applyToggleUI();
        if (typeof window.saveSetting === 'function') window.saveSetting('compact-group-depth', window.compactGroupDepth);
        if (window.compactMode) buildCompactGroups();
    };

    /* ---------- WRAP DE window.renderImageList / window.applyFilters ----------
       Mesmo padrão usado em tagmanager_pin_image.js: não editamos os arquivos
       originais, só envelopamos as funções já existentes. */
    function wrapRenderImageList() {
        if (typeof window.renderImageList !== 'function' || window.renderImageList.__compactWrapped) return;
        const original = window.renderImageList;
        const wrapped = function () {
            original.apply(this, arguments);
            if (window.compactMode) buildCompactGroups();
        };
        wrapped.__compactWrapped = true;
        window.renderImageList = wrapped;
    }

    function wrapApplyFilters() {
        if (typeof window.applyFilters !== 'function' || window.applyFilters.__compactWrapped) return;
        const original = window.applyFilters;
        const wrapped = function () {
            original.apply(this, arguments);
            updateGroupVisibility();
        };
        wrapped.__compactWrapped = true;
        window.applyFilters = wrapped;
    }

    wrapRenderImageList();
    wrapApplyFilters();

    /* ---------- LIGA OS BOTÕES E CARREGA PREFERÊNCIAS ---------- */
    window.addEventListener('DOMContentLoaded', async () => {
        const btn = document.getElementById('btn-toggle-compact-view');
        const depthBtn = document.getElementById('btn-compact-group-depth');
        if (btn) btn.onclick = window.toggleCompactMode;
        if (depthBtn) depthBtn.onclick = window.promptCompactGroupDepth;

        if (typeof window.getSetting === 'function') {
            window.compactMode = await window.getSetting('compact-view-mode', false);
            window.compactGroupDepth = await window.getSetting('compact-group-depth', 1);
        }
        applyToggleUI();
    });

})();
