/* =========================================================================
   4. CUSTOM HIGHLIGHTS - TAG MANAGER
   ---------------------------------------------------------------------
   Built-in & Custom Highlights UI and Engine.

   FIX (edição de Custom Highlight via prompt()): antes, ✏️ abria 2
   prompt()s sequenciais (nome, depois tags) — mesmo problema do Embed
   Manager. Agora ✏️ transforma o próprio card do grupo num formulário
   INLINE (nome + cor + tags) com os botões virando ✅ Update / ✖ Cancel
   enquanto editando, no mesmo estilo visual usado no Embed Manager
   (tagmanager_rule_automerge.js).
========================================================================= */

(function () {
    // --- BUILT-IN LOGIC ---
    const DEFAULT_HIGHLIGHT_COLORS = { favorite: '#00ff99', preset: '#2dd4bf', filter: '#ff9500', nl: '#b890ff', selection: '#4db8ff' };
    window._builtinHighlightColors = window._builtinHighlightColors || { ...DEFAULT_HIGHLIGHT_COLORS };
    window.enableNLHighlight = window.enableNLHighlight !== undefined ? window.enableNLHighlight : true;

    // Estado do modo edição inline dos grupos Custom (não afeta os
    // Built-in, que só têm cor + on/off, sem esse fluxo). Fica no escopo
    // do módulo, então sobrevive a qualquer refreshModalBody() intermediário.
    let _highlightEditingId = null;

    window.RulesUI.loadBuiltinHighlightColors = async function() {
        if (typeof window.getSetting !== 'function') return;
        for (const key of Object.keys(DEFAULT_HIGHLIGHT_COLORS)) {
            window._builtinHighlightColors[key] = await window.getSetting(`highlight-color-${key}`, DEFAULT_HIGHLIGHT_COLORS[key]);
        }
        window.enableNLHighlight = await window.getSetting('highlight-enable-nl', true);
    };

    window.RulesUI.restoreHighlightColorDefaults = async function () {
        if (!confirm(`Restore all Built-in Highlight colors (Favorite, Preset, Filter, NL, Selection) to their factory defaults?\nThis does NOT change their on/off state.`)) return;
        for (const key of Object.keys(DEFAULT_HIGHLIGHT_COLORS)) {
            window._builtinHighlightColors[key] = DEFAULT_HIGHLIGHT_COLORS[key];
            if (typeof window.saveSetting === 'function') await window.saveSetting(`highlight-color-${key}`, DEFAULT_HIGHLIGHT_COLORS[key]);
        }
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
        if (typeof window.renderImageList === 'function') window.renderImageList();
        if (document.getElementById('modal-conflict-manager') && document.getElementById('modal-conflict-manager').classList.contains('active')) await window.RulesUI.refreshModalBody();
        if (window.showAlert) window.showAlert('Highlight colors restored to defaults!', 'success');
    };

    function relocateHighlightCheckbox(id) {
        const input = document.getElementById(id);
        if (!input) return null;
        const label = input.parentElement;
        if (label && label.tagName === 'LABEL' && label.parentNode) { label.parentNode.insertBefore(input, label); label.parentNode.removeChild(label); }
        input.style.display = 'none';
        return input;
    }

    window.RulesUI.relocateBuiltinHighlightToggles = function() {
        if (window._builtinHighlightCheckboxes) return;
        window._builtinHighlightCheckboxes = {
            favorite: relocateHighlightCheckbox('toggle-fav-highlight'),
            preset: relocateHighlightCheckbox('toggle-preset-highlight'),
            filter: relocateHighlightCheckbox('toggle-filter-highlight')
        };
    };

    function getOrCreateNLHighlightCheckbox() {
        if (window._nlHighlightCheckbox) return window._nlHighlightCheckbox;
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'toggle-nl-highlight'; cb.checked = window.enableNLHighlight !== false;
        cb.onchange = async () => {
            window.enableNLHighlight = cb.checked;
            if (typeof window.saveSetting === 'function') await window.saveSetting('highlight-enable-nl', cb.checked);
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
        };
        window._nlHighlightCheckbox = cb; return cb;
    }

    function buildLockedHighlightRow(key, label, colorSettingKey, checkboxEl, badgeText) {
        const color = window._builtinHighlightColors[key];
        const badge = badgeText || '🔒 Locked';
        const item = document.createElement('div');
        item.className = 'conflict-group-item';
        item.style.cssText = `display:flex; align-items:center; gap:10px; background:#151515; border:1px solid #2a2a2a; border-left:3px solid ${color}; border-radius:6px; padding:8px 10px;`;
        item.innerHTML = `
            <input type="color" class="hl-color-input" value="${color}" title="Change highlight color">
            <div style="flex:1; display:flex; align-items:center; gap:8px;"><span class="hl-checkbox-slot" style="display:flex; align-items:center;"></span><b style="color:${color}; font-size:13px;">${label}</b></div>
            <span style="background:#2a2a2a; color:#888; font-size:10px; padding:2px 8px; border-radius:4px; border:1px solid #444; flex-shrink:0; white-space:nowrap;" title="Built-in highlight: color (and, when applicable, on/off) can be changed, but it can't be deleted">${badge}</span>
        `;
        if (checkboxEl) { checkboxEl.style.display = 'inline-block'; checkboxEl.style.margin = '0'; checkboxEl.title = 'Enable/disable this highlight'; item.querySelector('.hl-checkbox-slot').appendChild(checkboxEl); }
        item.querySelector('.hl-color-input').onchange = async (e) => {
            const newColor = e.target.value; window._builtinHighlightColors[key] = newColor;
            if (typeof window.saveSetting === 'function') await window.saveSetting(colorSettingKey, newColor);
            item.style.borderLeftColor = newColor; const bEl = item.querySelector('b'); if (bEl) bEl.style.color = newColor;
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
            if (typeof window.renderImageList === 'function') window.renderImageList();
        };
        return item;
    }

    function hexToRgba(hex, alpha) {
        let h = (hex || '#4db8ff').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const r = parseInt(h.substring(0, 2), 16) || 0; const g = parseInt(h.substring(2, 4), 16) || 0; const b = parseInt(h.substring(4, 6), 16) || 0;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function applyBuiltinHighlightOverrides(container) {
        if (!container || !window._builtinHighlightColors) return;
        const { favorite: favColor, filter: filterColor, preset: presetColor, nl: nlColor, selection: selColor } = window._builtinHighlightColors;
        container.querySelectorAll('.glow-favorite').forEach(el => { el.style.setProperty('background-color', hexToRgba(favColor, 0.24), 'important'); el.style.setProperty('border-left-color', favColor, 'important'); });
        container.querySelectorAll('.filter-match').forEach(el => { el.style.setProperty('background-color', hexToRgba(filterColor, 0.14), 'important'); el.style.setProperty('box-shadow', `inset 0 0 0 1px ${filterColor}`, 'important'); });
        container.querySelectorAll('.is-preset').forEach(el => { el.style.setProperty('background-color', hexToRgba(presetColor, 0.14), 'important'); el.style.setProperty('border-left-color', presetColor, 'important'); });
        if (typeof window.checkIfNL === 'function') {
            const nlActiveColor = window.enableNLHighlight !== false ? nlColor : '#ddd';
            container.querySelectorAll('.tag-name').forEach(el => { if (window.checkIfNL(el.textContent)) el.style.setProperty('color', nlActiveColor, 'important'); });
        }
        container.querySelectorAll('.selected-active, .selected-master').forEach(el => { el.style.setProperty('background-color', hexToRgba(selColor, 0.32), 'important'); el.style.setProperty('border-left-color', selColor, 'important'); });
    }

    function applyImageListSelectionOverride(container) {
        if (!container || !window._builtinHighlightColors) return;
        const selColor = window._builtinHighlightColors.selection;
        container.querySelectorAll('.list-item.selected').forEach(el => { el.style.setProperty('background-color', hexToRgba(selColor, 0.32), 'important'); el.style.setProperty('border-left-color', selColor, 'important'); });
    }

    function injectHighlightIcons(container, isMaster) {
        if (!container || !window._tagHighlightMap || window._tagHighlightMap.size === 0) return;
        const selector = isMaster ? '.master-tag-item[data-tag-name]' : '.tag-row[data-tag-name]';
        container.querySelectorAll(selector).forEach(row => {
            const tagLower = row.getAttribute('data-tag-name'); const hl = window._tagHighlightMap.get(tagLower);
            if (!hl || row.querySelector('.tag-hl-icon')) return;
            row.style.backgroundColor = hexToRgba(hl.color, 0.16); row.style.borderLeft = `3px solid ${hl.color}`;
            const icon = document.createElement('span'); icon.className = 'tag-hl-icon'; icon.textContent = '🔖'; icon.title = `Belongs to: ${hl.name}`; icon.style.cssText = `color:${hl.color}; margin-right:8px; font-size:13px; cursor:help; user-select:none; flex-shrink:0;`;
            const starEl = row.querySelector('.tag-star') || row.querySelector('.tag-edit-nl');
            if (starEl) starEl.insertAdjacentElement('afterend', icon); else { const leftDiv = row.querySelector('.tag-row-left') || row.firstElementChild; if (leftDiv) leftDiv.insertBefore(icon, leftDiv.firstChild); }
        });
    }

    window.RulesUI.wrapRenderersForHighlights = function() {
        const hasRegistry = typeof window.registerPostRenderEditor === 'function' && typeof window.registerPostRenderMasterTagList === 'function' && typeof window.registerPostRenderImageList === 'function';
        if (hasRegistry) {
            if (!window._hlHooksRegistered) {
                window.registerPostRenderEditor(() => { const c = document.getElementById('tag-list-vertical'); injectHighlightIcons(c, false); applyBuiltinHighlightOverrides(c); });
                window.registerPostRenderMasterTagList(() => { const c = document.getElementById('master-tag-list'); injectHighlightIcons(c, true); applyBuiltinHighlightOverrides(c); });
                window.registerPostRenderImageList(() => applyImageListSelectionOverride(document.getElementById('image-list')));
                window._hlHooksRegistered = true;
            }
            return;
        }
        if (typeof window.renderEditor === 'function' && !window.renderEditor.__hlWrapped) {
            const orig = window.renderEditor;
            window.renderEditor = function() { orig.apply(this, arguments); const c = document.getElementById('tag-list-vertical'); injectHighlightIcons(c, false); applyBuiltinHighlightOverrides(c); };
            window.renderEditor.__hlWrapped = true;
        }
        if (typeof window.renderMasterTagList === 'function' && !window.renderMasterTagList.__hlWrapped) {
            const orig2 = window.renderMasterTagList;
            window.renderMasterTagList = function() { orig2.apply(this, arguments); const c = document.getElementById('master-tag-list'); injectHighlightIcons(c, true); applyBuiltinHighlightOverrides(c); };
            window.renderMasterTagList.__hlWrapped = true;
        }
        if (typeof window.renderImageList === 'function' && !window.renderImageList.__hlWrapped) {
            const orig3 = window.renderImageList;
            window.renderImageList = function() { orig3.apply(this, arguments); applyImageListSelectionOverride(document.getElementById('image-list')); };
            window.renderImageList.__hlWrapped = true;
        }
    };

    // --- UI RENDERING ---
    function renderHighlightSection(rows) {
        const meta = window.CATEGORY_META.highlight;
        const catRows = rows.filter(r => r.category === 'highlight');
        catRows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const wrap = document.createElement('div');
        wrap.className = 'panel';
        wrap.style.cssText = 'flex: 1; display: flex; flex-direction: column; background: #1b1b1b; border: 1px solid #222; border-radius: 10px; overflow: hidden; min-height: 0;';

        const header = document.createElement('div');
        header.className = 'panel-header';
        header.style.cssText = `background: #222; padding: 12px 15px; font-size: 13px; font-weight: bold; color: ${meta.color}; border-bottom: 1px solid #333; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;`;
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;"><span>${meta.label}</span></div>
            <div style="display:flex; align-items:center; gap:8px;">
                <button onclick="window.RulesUI.restoreHighlightColorDefaults()" title="Restore factory defaults" style="background:transparent; border:none; color:#888; cursor:pointer; font-size:14px; padding:0; transition:0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#888'">🔄</button>
                <span style="background:#111; color:#aaa; padding:3px 8px; border-radius:6px; font-size:11px; border:1px solid #333;">${catRows.length} groups</span>
            </div>
        `;
        wrap.appendChild(header);

        const hint = document.createElement('div'); hint.style.cssText = 'font-size:11px; color:#aaa; padding: 12px 15px; background: #151515; border-bottom: 1px solid #222; flex-shrink: 0; line-height: 1.5;';
        hint.innerHTML = `<b>${meta.hint}</b><br><span style="color:#777; margin-top:6px; display:inline-block;">${meta.desc}</span>`;
        wrap.appendChild(hint);

        const list = document.createElement('div'); list.className = 'panel-list-scroll'; list.style.cssText = 'flex: 1; overflow-y: auto; display: flex; flex-direction: column; background: #111; padding: 10px; gap: 6px;';

        const builtinToggle = document.createElement('div');
        builtinToggle.style.cssText = 'font-size:10px; color:#aaa; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px; padding: 8px 10px; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; transition: 0.15s; margin-bottom: 2px;';
        builtinToggle.innerHTML = `<span>🔒 Built-in Highlights <span style="font-size:9px; color:#666; text-transform:none; margin-left:5px;">(color + on/off only)</span></span> <span class="toggle-icon" style="font-size: 12px;">▼</span>`;
        builtinToggle.onmouseover = () => builtinToggle.style.background = '#222'; builtinToggle.onmouseout = () => builtinToggle.style.background = '#1a1a1a';
        list.appendChild(builtinToggle);

        const builtinContainer = document.createElement('div'); builtinContainer.style.cssText = 'display: none; flex-direction: column; gap: 6px; margin-bottom: 6px;'; 
        builtinContainer.appendChild(buildLockedHighlightRow('favorite', '⭐ Favorite Tags', 'highlight-color-favorite', window._builtinHighlightCheckboxes && window._builtinHighlightCheckboxes.favorite));
        builtinContainer.appendChild(buildLockedHighlightRow('preset', '🔖 Already Preset', 'highlight-color-preset', window._builtinHighlightCheckboxes && window._builtinHighlightCheckboxes.preset));
        builtinContainer.appendChild(buildLockedHighlightRow('filter', '🎯 Filter/Pin Match', 'highlight-color-filter', window._builtinHighlightCheckboxes && window._builtinHighlightCheckboxes.filter));
        builtinContainer.appendChild(buildLockedHighlightRow('nl', '📝 NL (Natural Language) Tags', 'highlight-color-nl', getOrCreateNLHighlightCheckbox()));
        builtinContainer.appendChild(buildLockedHighlightRow('selection', '🖱️ Tag Selection (click highlight)', 'highlight-color-selection', null, '🔒 Always On'));
        list.appendChild(builtinContainer);

        builtinToggle.onclick = () => { const isCollapsed = builtinContainer.style.display === 'none'; builtinContainer.style.display = isCollapsed ? 'flex' : 'none'; builtinToggle.querySelector('.toggle-icon').textContent = isCollapsed ? '▲' : '▼'; builtinToggle.style.color = isCollapsed ? '#fff' : '#aaa'; };

        const divider = document.createElement('div'); divider.style.cssText = 'border-top: 1px dashed #333; margin: 4px 2px 2px;'; list.appendChild(divider);
        const customLabel = document.createElement('div'); customLabel.style.cssText = 'font-size:10px; color:#666; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px; padding: 6px 4px 4px; display:flex; justify-content:space-between; align-items:center;'; customLabel.innerHTML = `<span>📁 Custom Groups</span><span style="background:#111; color:#aaa; padding:2px 7px; border-radius:6px; font-size:10px; border:1px solid #333; text-transform:none; letter-spacing:0;">${catRows.length}</span>`; list.appendChild(customLabel);

        if (catRows.length === 0) { const empty = document.createElement('div'); empty.style.cssText = 'font-size:12px; color:#555; font-style:italic; text-align: center; margin-top: 10px;'; empty.textContent = 'No custom highlight groups yet.'; list.appendChild(empty); }

        catRows.forEach(row => {
            const color = row.color || '#4db8ff'; const safeTags = Array.isArray(row.tags) ? row.tags : [];
            const item = document.createElement('div'); item.className = 'conflict-group-item';

            if (_highlightEditingId === row.id) {
                /* ---------- MODO EDIÇÃO INLINE ----------
                   O card vira um formulário (nome + cor + tags) com
                   Update/Cancel, no mesmo estilo visual do Embed Manager,
                   no lugar do antigo fluxo de 2 prompt()s. */
                item.style.cssText = `display:flex; flex-direction:column; gap:8px; background:#151515; border:1px solid ${color}; border-radius:6px; padding:10px;`;
                item.innerHTML = `
                    <div style="font-size:11px; color:${color}; font-weight:bold;">✏️ Editing "${window.RulesUI.escapeHTML(row.name || '')}"</div>
                    <div style="display:flex; gap:6px;">
                        <input type="text" class="hl-edit-name" value="${window.RulesUI.escapeHTML(row.name || '')}" placeholder="Group name" style="flex:2; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                        <input type="color" class="hl-edit-color" value="${color}" title="Highlight color" style="flex:0 0 40px; padding:2px; border:1px solid #444; border-radius:4px; background:#222; cursor:pointer;">
                    </div>
                    <textarea class="hl-edit-tags" placeholder="tag1, tag2, @embedName..." style="font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-height:60px; resize:vertical;">${window.RulesUI.escapeHTML(safeTags.join(', '))}</textarea>
                    <div style="display:flex; gap:6px; justify-content:flex-end;">
                        <button class="btn-hl-cancel" style="background:#222; border:1px solid #444; color:#aaa; font-size:11px; padding:6px 14px; border-radius:4px; cursor:pointer; font-weight:bold;">✖ Cancel</button>
                        <button class="btn-hl-update" style="background:#00aa66; border:none; color:#000; font-size:11px; padding:6px 14px; border-radius:4px; cursor:pointer; font-weight:bold;">✅ Update</button>
                    </div>
                `;

                item.querySelector('.btn-hl-cancel').onclick = () => {
                    _highlightEditingId = null;
                    window.RulesUI.refreshModalBody();
                };

                item.querySelector('.btn-hl-update').onclick = async () => {
                    const nameInput = item.querySelector('.hl-edit-name');
                    const colorInput = item.querySelector('.hl-edit-color');
                    const tagsInput = item.querySelector('.hl-edit-tags');
                    const newName = nameInput.value.trim();
                    const newColor = colorInput.value || color;
                    const newTags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);

                    if (!newName) { if (window.showAlert) window.showAlert('Group name is required.', 'warn'); nameInput.focus(); return; }
                    if (newTags.length === 0) { if (window.showAlert) window.showAlert('At least 1 tag is required.', 'warn'); tagsInput.focus(); return; }

                    await window.RulesDB.updateRule(row.id, { name: newName, tags: newTags, color: newColor });
                    _highlightEditingId = null;
                    await window.RulesCore.applyUserRulesToGlobals();
                    window.RulesUI.refreshModalBody();
                };

            } else {
                /* ---------- MODO NORMAL (exibição) ---------- */
                item.style.cssText = `display:flex; align-items:center; gap:10px; background:#151515; border:1px solid #2a2a2a; border-left:3px solid ${color}; border-radius:6px; padding:8px 10px;`;
                item.innerHTML = `
                    <input type="color" class="hl-color-input" value="${color}" title="Change highlight color">
                    <div style="flex:1; display:flex; flex-direction: column; gap: 4px; overflow: hidden;">
                        <b style="color:${color}; font-size:13px;">${window.RulesUI.escapeHTML(row.name || '')}</b>
                        <span style="font-size:12px; color:#ddd; word-break:break-word; line-height: 1.3;">${window.RulesUI.escapeHTML(safeTags.join(', '))}</span>
                    </div>
                    <div style="display:flex; flex-direction: column; gap:4px; flex-shrink:0;">
                        <button class="btn-hl-edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️</button>
                        <button class="btn-hl-delete" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                    </div>
                `;
                // Ajuste rápido de cor continua disponível direto na visão normal
                // (sem precisar entrar no modo edição) — comportamento já existente.
                item.querySelector('.hl-color-input').onchange = async (e) => { const newColor = e.target.value; await window.RulesDB.updateRule(row.id, { name: row.name, tags: safeTags, color: newColor }); await window.RulesCore.applyUserRulesToGlobals(); item.style.borderLeftColor = newColor; const bEl = item.querySelector('b'); if (bEl) bEl.style.color = newColor; };

                item.querySelector('.btn-hl-edit').onclick = () => {
                    _highlightEditingId = row.id;
                    window.RulesUI.refreshModalBody();
                };
                item.querySelector('.btn-hl-delete').onclick = async () => {
                    if (!confirm(`Delete the highlight group "${row.name}"?`)) return;
                    await window.RulesDB.deleteRule(row.id); await window.RulesCore.applyUserRulesToGlobals(); window.RulesUI.refreshModalBody();
                };
            }

            list.appendChild(item);
        });
        wrap.appendChild(list);

        const addRow = document.createElement('div');
        addRow.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 12px 15px; background: #111; align-items: stretch; flex: 0 0 auto; border-top: 1px solid #222;';
        addRow.innerHTML = `
            <div style="display:flex; gap:6px;">
                <input type="text" class="hl-add-name" placeholder="Group name (e.g. eye orientation)" style="flex:2; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                <input type="color" class="hl-add-color" value="#4db8ff" title="Highlight color" style="flex:0 0 40px; padding:2px; border:1px solid #444; border-radius:4px; background:#222; cursor:pointer;">
            </div>
            <div style="display:flex; gap:6px;">
                <input type="text" class="hl-add-tags" placeholder="tag1, tag2, @embedName..." title="You can mix normal tags with @embedName references to a Custom Embed group" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                <button class="hl-add-btn" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; font-size:11px; padding:6px 14px; border-radius:4px; flex-shrink:0; font-weight:bold; cursor:pointer;">➕ Add</button>
            </div>
        `;
        const doAdd = async () => {
            const name = addRow.querySelector('.hl-add-name').value.trim(); const color = addRow.querySelector('.hl-add-color').value || '#4db8ff';
            const newTags = addRow.querySelector('.hl-add-tags').value.split(',').map(t => t.trim()).filter(t => t);
            if (!name || newTags.length === 0) { if (window.showAlert) window.showAlert('Group name and at least 1 tag are required.', 'warn'); return; }
            await window.RulesDB.addRule('highlight', { name, tags: newTags, color }, false);
            addRow.querySelector('.hl-add-name').value = ''; addRow.querySelector('.hl-add-tags').value = ''; addRow.querySelector('.hl-add-color').value = '#4db8ff';
            await window.RulesCore.applyUserRulesToGlobals(); window.RulesUI.refreshModalBody();
        };
        addRow.querySelector('.hl-add-btn').onclick = doAdd; addRow.querySelector('.hl-add-tags').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };
        wrap.appendChild(addRow);
        return wrap;
    }

    window.RulesUI.registerSection(4, async (rows) => renderHighlightSection(rows));
})();