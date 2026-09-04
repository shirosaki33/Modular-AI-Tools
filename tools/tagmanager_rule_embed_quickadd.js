/* =========================================================================
   EMBED QUICK ADD/REMOVE (📦) — Active Image & All Dataset Tags
   ---------------------------------------------------------------------
   Antes, a única forma de colocar/tirar uma tag de um Custom Embed
   (@nome, usado em Requires/Excludes do Auto-Do e em Custom Highlights)
   era abrir 🧩 Manage Rules → 📦 Manage Custom Embeds e editar a lista
   de tags do embed inteira, manualmente, numa caixa de texto.

   Este módulo injeta um ícone 📦 em cada linha de tag "normal" (não-NL),
   igual em espírito ao ⭐ de favoritar — tanto na Active Image quanto em
   All Dataset Tags. Clicar nele abre um popout compacto listando todos
   os Embeds já criados, cada um com um checkbox:
     - marcado  = a tag JÁ pertence a esse embed
     - clicar no checkbox ADICIONA (se não pertencia) ou REMOVE (se já
       pertencia) a tag daquele embed, instantaneamente — tudo pelo
       mesmo ícone/popup, sem precisar abrir o gerenciador de Embeds.
   O ícone fica destacado (verde) quando a tag já pertence a pelo menos
   1 embed, pra dar uma pista visual sem precisar abrir o popup.

   Depende de window.RulesDB / window.RulesCore (tagmanager_rule_conflict.js)
   e reaproveita window.RulesDB.updateRule (mesmo usado pelo Embed
   Manager em tagmanager_rule_automerge.js) — carregar DEPOIS desses.
   Usa window.registerPostRenderEditor / registerPostRenderMasterTagList
   quando disponíveis (tagmanager_render_hooks.js), com fallback pra wrap
   manual se esse arquivo não tiver carregado.
========================================================================= */

(function () {
    const style = document.createElement('style');
    style.innerHTML = `
        .tag-add-embed {
            color: #b890ff; margin-right: 8px; font-size: 14px; cursor: pointer;
            user-select: none; flex-shrink: 0; opacity: 0.8; transition: 0.15s;
        }
        .tag-add-embed:hover { opacity: 1; transform: scale(1.15); }
        .tag-add-embed.has-embed { color: #4caf50; text-shadow: 0 0 6px rgba(76,175,80,0.5); opacity: 1; }

        .embed-quickadd-popup {
            position: fixed; z-index: 200; background: #151515; border: 1px solid #4a2a8c;
            border-radius: 8px; padding: 10px; min-width: 220px; max-width: 300px;
            max-height: 300px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.7);
            display: flex; flex-direction: column; gap: 6px;
        }
        .embed-quickadd-title { font-size: 11px; color: #b890ff; font-weight: bold; margin-bottom: 2px; word-break: break-word; }
        .embed-quickadd-empty { font-size: 11px; color: #777; font-style: italic; padding: 6px 2px; }
        .embed-quickadd-row {
            display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px;
            background: #1d1d1d; cursor: pointer; font-size: 12px; color: #ddd; user-select: none;
        }
        .embed-quickadd-row:hover { background: #262626; }
        .embed-quickadd-row input { margin: 0; accent-color: #4caf50; cursor: pointer; flex-shrink: 0; }
        .embed-quickadd-row .eqa-name { flex: 1; color: #b890ff; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .embed-quickadd-row .eqa-count { color: #666; font-size: 10px; flex-shrink: 0; }
        .embed-quickadd-footer { font-size: 10px; color: #666; text-align: center; padding-top: 4px; border-top: 1px dashed #333; margin-top: 2px; }
    `;
    document.head.appendChild(style);

    function escapeHtml(str) {
        if (window.RulesUI && typeof window.RulesUI.escapeHTML === 'function') return window.RulesUI.escapeHTML(str);
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c));
    }

    let openPopupEl = null;
    let outsideClickHandler = null;

    function onEscClose(e) { if (e.key === 'Escape') closeEmbedQuickPicker(); }

    function closeEmbedQuickPicker() {
        if (openPopupEl) { openPopupEl.remove(); openPopupEl = null; }
        if (outsideClickHandler) { document.removeEventListener('mousedown', outsideClickHandler, true); outsideClickHandler = null; }
        document.removeEventListener('keydown', onEscClose, true);
    }

    /* ---------- ADD/REMOVE A TAG NUM EMBED ESPECÍFICO ---------- */
    window.toggleTagInEmbed = async function (embedId, tag) {
        const rows = await window.RulesDB.getAllRules();
        const embed = rows.find(r => r.id === embedId && r.category === 'embed');
        if (!embed) return null;

        let tags = Array.isArray(embed.tags) ? [...embed.tags] : [];
        const idx = tags.findIndex(t => String(t).toLowerCase() === tag.toLowerCase());
        let nowIn;
        if (idx > -1) { tags.splice(idx, 1); nowIn = false; }
        else { tags.push(tag); nowIn = true; }

        // Mesmo caminho usado pelo Embed Manager (✏️ Edit em @embed): se o
        // embed alvo for um DEFAULT (def_emb_N), updateRule cria automaticamente
        // uma cópia CUSTOM com um id novo e marca o default como substituído —
        // o popup relê window.RulesDB.getAllRules() a cada ação, então sempre
        // acaba trabalhando com o id certo, sem precisar tratar esse caso aqui.
        await window.RulesDB.updateRule(embedId, { name: embed.name, tags });
        await window.RulesCore.applyUserRulesToGlobals();
        return nowIn;
    };

    async function refreshIconStateForTag(tag) {
        const rows = await window.RulesDB.getAllRules();
        const embeds = rows.filter(r => r.category === 'embed');
        const belongs = embeds.some(e => Array.isArray(e.tags) && e.tags.some(t => String(t).toLowerCase() === tag.toLowerCase()));
        document.querySelectorAll('.tag-add-embed[data-embed-tag]').forEach(icon => {
            if ((icon.getAttribute('data-embed-tag') || '').toLowerCase() === tag.toLowerCase()) {
                icon.classList.toggle('has-embed', belongs);
                icon.title = belongs ? `"${tag}" belongs to at least 1 embed — click to manage` : `Add "${tag}" to an embed`;
            }
        });
    }

    /* ---------- POPUP ---------- */
    async function openEmbedQuickPicker(tag, anchorEl) {
        closeEmbedQuickPicker();

        const popup = document.createElement('div');
        popup.className = 'embed-quickadd-popup';

        const title = document.createElement('div');
        title.className = 'embed-quickadd-title';
        title.textContent = `📦 Add/remove "${tag}" from embed:`;
        popup.appendChild(title);

        const rowsContainer = document.createElement('div');
        rowsContainer.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
        popup.appendChild(rowsContainer);

        const footer = document.createElement('div');
        footer.className = 'embed-quickadd-footer';
        footer.textContent = 'Click a checkbox to add/remove instantly.';
        popup.appendChild(footer);

        async function renderRows() {
            rowsContainer.innerHTML = '';
            const freshRows = await window.RulesDB.getAllRules();
            const embeds = freshRows.filter(r => r.category === 'embed').sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            if (embeds.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'embed-quickadd-empty';
                empty.textContent = 'No embeds yet — create one in 🧩 Manage Rules → 📦 Manage Custom Embeds.';
                rowsContainer.appendChild(empty);
                return;
            }

            embeds.forEach(emb => {
                const tagsArr = Array.isArray(emb.tags) ? emb.tags : [];
                const isIn = tagsArr.some(t => String(t).toLowerCase() === tag.toLowerCase());

                const row = document.createElement('label');
                row.className = 'embed-quickadd-row';
                row.innerHTML = `
                    <input type="checkbox" ${isIn ? 'checked' : ''}>
                    <span class="eqa-name">@${escapeHtml(emb.name)}</span>
                    <span class="eqa-count">${tagsArr.length}</span>
                `;
                row.querySelector('input').onclick = async (e) => {
                    e.stopPropagation();
                    await window.toggleTagInEmbed(emb.id, tag);
                    await refreshIconStateForTag(tag);
                    await renderRows();
                };
                rowsContainer.appendChild(row);
            });
        }

        await renderRows();

        document.body.appendChild(popup);
        openPopupEl = popup;

        const rect = anchorEl.getBoundingClientRect();
        const popRect = popup.getBoundingClientRect();
        let top = rect.bottom + 6;
        let left = rect.left;
        if (left + popRect.width > window.innerWidth - 10) left = window.innerWidth - popRect.width - 10;
        if (top + popRect.height > window.innerHeight - 10) top = rect.top - popRect.height - 6;
        popup.style.top = Math.max(10, top) + 'px';
        popup.style.left = Math.max(10, left) + 'px';

        outsideClickHandler = (e) => { if (!popup.contains(e.target) && e.target !== anchorEl) closeEmbedQuickPicker(); };
        setTimeout(() => document.addEventListener('mousedown', outsideClickHandler, true), 0);
        document.addEventListener('keydown', onEscClose, true);
    }

    /* ---------- INJEÇÃO DO ÍCONE NAS LINHAS (Active Image e All Dataset Tags) ---------- */
    async function injectEmbedIcons(container) {
        if (!container || !window.RulesDB || typeof window.RulesDB.getAllRules !== 'function') return;

        const rows = await window.RulesDB.getAllRules();
        const embeds = rows.filter(r => r.category === 'embed');
        const belongsToAny = (t) => embeds.some(e => Array.isArray(e.tags) && e.tags.some(et => String(et).toLowerCase() === t.toLowerCase()));

        container.querySelectorAll('[data-tag-name]').forEach(row => {
            if (row.classList.contains('ghost')) return; // sugestões-fantasma (💡) não têm ação de embed
            const removeBtn = row.querySelector('.tag-remove');
            const nameEl = row.querySelector('.tag-name');
            if (!removeBtn || !nameEl) return;

            const tag = nameEl.textContent;
            if (!tag) return;
            // Tags NL (Natural Language) não fazem sentido dentro de um embed de tags soltas.
            if (typeof window.checkIfNL === 'function' && window.checkIfNL(tag)) return;

            let icon = row.querySelector('.tag-add-embed');
            if (!icon) {
                icon = document.createElement('span');
                icon.className = 'tag-add-embed';
                icon.textContent = '📦';
                removeBtn.parentNode.insertBefore(icon, removeBtn);
            }
            icon.setAttribute('data-embed-tag', tag);
            icon.onclick = (e) => { e.stopPropagation(); openEmbedQuickPicker(tag, icon); };

            const belongs = belongsToAny(tag);
            icon.classList.toggle('has-embed', belongs);
            icon.title = belongs ? `"${tag}" belongs to at least 1 embed — click to manage` : `Add "${tag}" to an embed`;
        });
    }

    /* ---------- HOOKS ---------- */
    function installHooks() {
        if (typeof window.registerPostRenderEditor === 'function' && typeof window.registerPostRenderMasterTagList === 'function') {
            window.registerPostRenderEditor(() => injectEmbedIcons(document.getElementById('tag-list-vertical')));
            window.registerPostRenderMasterTagList(() => injectEmbedIcons(document.getElementById('master-tag-list')));
            return true;
        }
        let installedAny = false;
        if (typeof window.renderEditor === 'function' && !window.renderEditor.__embedIconsWrapped) {
            const orig = window.renderEditor;
            window.renderEditor = function () { orig.apply(this, arguments); injectEmbedIcons(document.getElementById('tag-list-vertical')); };
            window.renderEditor.__embedIconsWrapped = true;
            installedAny = true;
        }
        if (typeof window.renderMasterTagList === 'function' && !window.renderMasterTagList.__embedIconsWrapped) {
            const orig2 = window.renderMasterTagList;
            window.renderMasterTagList = function () { orig2.apply(this, arguments); injectEmbedIcons(document.getElementById('master-tag-list')); };
            window.renderMasterTagList.__embedIconsWrapped = true;
            installedAny = true;
        }
        return installedAny;
    }

    if (!installHooks()) window.addEventListener('DOMContentLoaded', () => setTimeout(installHooks, 0));

})();