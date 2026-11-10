/* =========================================================================
   SAVE TO USER PRESETS (📦) — Active Image & All Dataset Tags
   ---------------------------------------------------------------------
   The 📦 icon is the default way to save a tag to User Presets. Clicking
   it opens a compact popup listing the preset groups (categories); a tag
   belongs to ONE group, so picking a group saves/moves the tag there
   instantly. Picking the checked group removes the tag from the presets.
   Each preset group also works as an @group in Manage Rules.
   The icon is green when the tag is already a preset.
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

    function presetCategories() {
        const cache = window._presetsCache || {};
        const cats = new Map();
        for (const t of Object.keys(cache)) {
            const c = cache[t];
            if (!c) continue;
            if (!cats.has(c)) cats.set(c, 0);
            if (!t.startsWith('_sys_cat_')) cats.set(c, cats.get(c) + 1);
        }
        return [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }

    async function setTagGroup(tag, cat, isIn) {
        if (isIn) await window.deletePresetTag(tag, true);
        else {
            // savePresetTag keeps the old category when 'Uncategorized' is passed, so clear first to allow moving to it.
            if (cat === 'Uncategorized') await window.deletePresetTag(tag, true);
            await window.savePresetTag(tag, cat, true);
        }
        if (typeof window.renderPresetTags === 'function') window.renderPresetTags();
        if (window.RulesCore && window.RulesCore.applyUserRulesToGlobals) window.RulesCore.applyUserRulesToGlobals();
    }

    function refreshIconStateForTag(tag) {
        const cat = (window._presetsCache || {})[tag];
        document.querySelectorAll('.tag-add-embed[data-embed-tag]').forEach(icon => {
            if ((icon.getAttribute('data-embed-tag') || '') === tag) {
                icon.classList.toggle('has-embed', !!cat);
                icon.title = cat ? `"${tag}" is in preset group "${cat}" — click to change` : `Save "${tag}" to User Presets`;
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
        title.textContent = `📦 Save "${tag}" to User Presets:`;
        popup.appendChild(title);

        const rowsContainer = document.createElement('div');
        rowsContainer.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
        popup.appendChild(rowsContainer);

        const footer = document.createElement('div');
        footer.className = 'embed-quickadd-footer';
        footer.textContent = 'A tag lives in one group. Click the checked one to remove it from presets.';
        popup.appendChild(footer);

        async function renderRows() {
            rowsContainer.innerHTML = '';
            if (typeof loadPresetsToCache === 'function') await loadPresetsToCache();
            const current = (window._presetsCache || {})[tag];
            const cats = presetCategories();
            if (!cats.some(c => c[0] === 'Uncategorized')) cats.unshift(['Uncategorized', 0]);

            cats.forEach(([cat, count]) => {
                const isIn = current === cat;
                const row = document.createElement('label');
                row.className = 'embed-quickadd-row';
                row.innerHTML = `
                    <input type="checkbox" ${isIn ? 'checked' : ''}>
                    <span class="eqa-name">${escapeHtml(cat)}</span>
                    <span class="eqa-count">${count}</span>
                `;
                row.querySelector('input').onclick = async (e) => {
                    e.stopPropagation();
                    await setTagGroup(tag, cat, isIn);
                    refreshIconStateForTag(tag);
                    await renderRows();
                };
                rowsContainer.appendChild(row);
            });

            const addRow = document.createElement('div');
            addRow.style.cssText = 'display:flex; gap:6px; margin-top:2px;';
            addRow.innerHTML = '<input type="text" placeholder="New group..." style="flex:1; min-width:0; font-size:11px; background:#222; border:1px solid #444; padding:5px 7px; border-radius:4px; color:#fff;"><button style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; border-radius:4px; cursor:pointer; font-size:11px; padding:0 8px;">➕</button>';
            const inp = addRow.querySelector('input');
            const go = async () => {
                const name = inp.value.trim();
                if (!name) return;
                await window.savePresetTag('_sys_cat_' + name, name, true);
                await setTagGroup(tag, name, false);
                refreshIconStateForTag(tag);
                await renderRows();
            };
            addRow.querySelector('button').onclick = go;
            inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); };
            rowsContainer.appendChild(addRow);
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
    /* Usa as regras já carregadas por RulesCore.applyUserRulesToGlobals
       (window._userConflictRules) — antes relia todas as regras (async) a cada
       render das duas listas. Só lê do banco se elas ainda não existirem. */
    async function injectEmbedIcons(container) {
        if (!container || !window.RulesDB || typeof window.RulesDB.getAllRules !== 'function') return;

        if (typeof loadPresetsToCache === 'function') { try { await loadPresetsToCache(); } catch (e) {} }
        const cache = window._presetsCache || {};

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

            const cat = cache[tag];
            icon.classList.toggle('has-embed', !!cat);
            icon.title = cat ? `"${tag}" is in preset group "${cat}" — click to change` : `Save "${tag}" to User Presets`;
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