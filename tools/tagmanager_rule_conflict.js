/* =========================================================================
   1. CONFLICTS & CORE ENGINE - TAG MANAGER
   ---------------------------------------------------------------------
   Core Database, Modal Builder, Issue Counters, and Conflict Rules (Red).

   FIX (Embeds só funcionavam no Auto-Do): @embedName só era expandido
   dentro de runAutoMergeRule/matchTag (tagmanager_rule_automerge.js).
   Em Conflicts, Similar e Highlights, "@nome" era comparado como se
   fosse uma tag literal, nunca resolvido pra lista de tags do embed —
   então um grupo de Conflict/Similar/Highlight que referenciasse um
   @embed simplesmente nunca disparava. Agora a resolução de embeds
   acontece num ÚNICO lugar central, em RulesCore.applyUserRulesToGlobals
   (window.RulesCore.resolveGroupTags), populando window.tagConflicts,
   window.tagSimilar e window._tagHighlightMap já com os embeds expandidos.

   FIX (edição de grupo via prompt()): igual ao já feito no Embed Manager
   e nos Custom Highlights (tagmanager_rule_automerge.js /
   tagmanager_rule_highlight.js) — ✏️ Edit não abre mais um prompt() de
   uma linha só. O card do grupo vira, no lugar dele mesmo, uma textarea
   com as tags atuais, e os botões viram ✅ Update / ✖ Cancel enquanto
   editando. Usado tanto por Conflicts quanto por Similar, já que os dois
   compartilham window.RulesUI.renderGenericCategorySection.
========================================================================= */

(function () {
    // --- GLOBAL NAMESPACES ---
    window.RulesDB = { factoryRules: [] };
    window.RulesUI = { sections: [] };
    window.RulesCore = {};
    window.IssueCounters = { types: ['conflict'] };

    window.CATEGORY_META = {
        conflict: { label: "🚨 Conflicts (Red)", color: "#ff6060", hint: "Tags that must never coexist in the same image.", desc: "Prevents contradictory tags. Highlights them in red to warn you of a logical error." },
        similar: { label: "🟨 Similar (Yellow)", color: "#ffcc66", hint: "Redundant tags that trigger a visual warning.", desc: "Groups synonymous or overlapping tags. Highlights them in yellow to suggest keeping only one." },
        automerge: { label: "⚡ Auto-Do (Unified)", color: "#00ff99", hint: "Consolidates redundant tags and applies advanced conditional checks.", desc: "Auto-Merge: Removes Trigger tags and adds Main Tag. Auto-Fill: Keeps Trigger tags and adds Main Tag." },
        highlight: { label: "🎨 Custom Highlights", color: "#4db8ff", hint: "Custom-colored groups of tags, shown with an icon + tint in the tag lists.", desc: "Two kinds live here: 🔒 Built-in Highlights (Favorite/Preset/Filter) and 📁 Custom Groups." }
    };

    // Estado do modo edição inline de Conflict/Similar (compartilhado entre
    // as duas categorias, já que renderGenericCategorySection atende as
    // duas — o id da regra já é único globalmente, então não colide).
    let _genericEditingId = null;

    // --- FACTORY DEFAULTS (CONFLICTS) ---
    const GIRLS_COUNT_EXACT = ['1girl', '2girls', '3girls', '4girls', '5girls', '6+girls'];
    const BOYS_COUNT_EXACT  = ['1boy', '2boys', '3boys', '4boys', '5boys', '6+boys'];
    const GIRLS_COUNT_MULTI = GIRLS_COUNT_EXACT.slice(1);
    const BOYS_COUNT_MULTI  = BOYS_COUNT_EXACT.slice(1);
    const POSES_BASE = ['standing', 'sitting', 'lying', 'kneeling', 'all fours'];

    const FACTORY_CONFLICTS = [
        GIRLS_COUNT_EXACT, BOYS_COUNT_EXACT,
        ['1girl', 'multiple girls'], ['1boy', 'multiple boys'],
        ['solo', ...GIRLS_COUNT_MULTI], ['solo', 'multiple girls'],
        ['solo', ...BOYS_COUNT_MULTI], ['solo', 'multiple boys'],
        ['no humans', 'solo'], ['no humans', ...GIRLS_COUNT_EXACT], ['no humans', 'multiple girls'], ['no humans', ...BOYS_COUNT_EXACT], ['no humans', 'multiple boys'],
        ['day', 'night'], ['indoor', 'outdoor'], ['sunlight', 'moonlight'],
        ['monochrome', 'colorful'],
        ['open eyes', 'eyes closed'], ['censored', 'uncensored'],
        [...POSES_BASE, 'crouching'], [...POSES_BASE, 'squatting'],
        ['on back', 'on stomach', 'on side'],
        ['looking at viewer', 'looking away'],
        ['happy', 'sad', 'angry', 'expressionless', 'scared', 'surprised', 'shocked', 'bored', 'disgusted']
    ];

    FACTORY_CONFLICTS.forEach((tags, i) => window.RulesDB.factoryRules.push({ id: 'def_conf_'+i, category: 'conflict', isDefault: true, tags }));

    // --- DB ABSTRACTION ---
    window.RulesDB.getFactoryRules = function() {
        return this.factoryRules;
    };

    window.RulesDB.migrateOldIndexedDB = async function() {
    // Migração legada desativada para impedir o reset acidental do user_config.json
	};

    window.RulesDB.cleanBloatedJSON = async function() {
        let customRules = await window.getSetting('custom-conflict-rules', []);
        if (!Array.isArray(customRules)) customRules = [];
        if (customRules.some(r => r.isDefault)) {
            customRules = customRules.filter(r => !r.isDefault);
            await window.saveSetting('custom-conflict-rules', customRules);
            await window.saveSetting('deleted-default-rules', []);
        }
    };

    window.RulesDB.getAllRules = async function() {
        let customRules = await window.getSetting('custom-conflict-rules', []);
        if (!Array.isArray(customRules)) customRules = [];
        let deletedDefaults = await window.getSetting('deleted-default-rules', []);
        if (!Array.isArray(deletedDefaults)) deletedDefaults = [];
        const fRules = this.getFactoryRules().filter(r => !deletedDefaults.includes(r.id));
        return [...fRules, ...customRules];
    };

    window.RulesDB.saveAllRules = async function(rules) {
        if (!Array.isArray(rules)) rules = [];
        await window.saveSetting('custom-conflict-rules', rules);
    };

    window.RulesDB.addRule = async function(category, data, isDefault = false) {
        let customRules = await window.getSetting('custom-conflict-rules', []);
        if (!Array.isArray(customRules)) customRules = [];
        let item = { id: Date.now() + "_" + Math.random().toString(36).substr(2, 9), category, isDefault: false };
        if (data.keepTag !== undefined || data.name !== undefined) Object.assign(item, data);
        else item.tags = Array.isArray(data) ? data : [];
        customRules.push(item);
        await this.saveAllRules(customRules);
        return true;
    };

    window.RulesDB.updateRule = async function(id, data) {
        if (id.startsWith('def_')) {
            let deletedDefaults = await window.getSetting('deleted-default-rules', []);
            if (!Array.isArray(deletedDefaults)) deletedDefaults = [];
            if (!deletedDefaults.includes(id)) {
                deletedDefaults.push(id);
                await window.saveSetting('deleted-default-rules', deletedDefaults);
            }
            let customRules = await window.getSetting('custom-conflict-rules', []);
            if (!Array.isArray(customRules)) customRules = [];
            let factoryBase = this.getFactoryRules().find(r => r.id === id);
            if (!factoryBase) return false;
            let newItem = { id: Date.now() + "_" + Math.random().toString(36).substr(2, 9), category: factoryBase.category, isDefault: false };
            if (factoryBase.keepTag !== undefined || factoryBase.name !== undefined) Object.assign(newItem, factoryBase);
            else newItem.tags = Array.isArray(factoryBase.tags) ? [...factoryBase.tags] : [];
            
            if (data.name !== undefined) {
                newItem.name = data.name; newItem.tags = Array.isArray(data.tags) ? data.tags : []; if (data.color !== undefined) newItem.color = data.color;
            } else if (data.keepTag !== undefined) {
                newItem.keepTag = data.keepTag; newItem.removeTags = Array.isArray(data.removeTags) ? data.removeTags : []; 
                newItem.require = Array.isArray(data.require) ? data.require : []; newItem.exclude = Array.isArray(data.exclude) ? data.exclude : []; 
                newItem.isAutoFill = !!data.isAutoFill;
            } else { newItem.tags = Array.isArray(data) ? data : []; }
            
            customRules.push(newItem);
            await this.saveAllRules(customRules);
            return true;
        } else {
            let customRules = await window.getSetting('custom-conflict-rules', []);
            if (!Array.isArray(customRules)) customRules = [];
            let item = customRules.find(r => r.id === id);
            if (item) {
                if (data.name !== undefined) {
                    item.name = data.name; item.tags = Array.isArray(data.tags) ? data.tags : []; if (data.color !== undefined) item.color = data.color;
                } else if (data.keepTag !== undefined) {
                    item.keepTag = data.keepTag; item.removeTags = Array.isArray(data.removeTags) ? data.removeTags : []; 
                    item.require = Array.isArray(data.require) ? data.require : []; item.exclude = Array.isArray(data.exclude) ? data.exclude : []; 
                    item.isAutoFill = !!data.isAutoFill;
                    delete item.tags; delete item.target; delete item.fallback;
                } else { item.tags = Array.isArray(data) ? data : []; }
                await this.saveAllRules(customRules);
                return true;
            }
            return false;
        }
    };

    window.RulesDB.deleteRule = async function(id) {
        if (id.startsWith('def_')) {
            let deletedDefaults = await window.getSetting('deleted-default-rules', []);
            if (!Array.isArray(deletedDefaults)) deletedDefaults = [];
            if (!deletedDefaults.includes(id)) {
                deletedDefaults.push(id);
                await window.saveSetting('deleted-default-rules', deletedDefaults);
            }
            return true;
        } else {
            let customRules = await window.getSetting('custom-conflict-rules', []);
            if (!Array.isArray(customRules)) customRules = [];
            let len = customRules.length;
            customRules = customRules.filter(r => r.id !== id);
            if (customRules.length !== len) {
                await this.saveAllRules(customRules);
                return true;
            }
            return false;
        }
    };

    // --- UI HELPERS ---
    window.RulesUI.escapeHTML = function(str) {
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
    };

    window.RulesUI.registerSection = function(order, fn) {
        this.sections.push({ order, fn });
        this.sections.sort((a, b) => a.order - b.order);
    };

    // --- GENERIC CATEGORY RENDERER (Used by Conflict and Similar) ---
    window.RulesUI.renderGenericCategorySection = function(category, rows, isChecked, settingKey) {
        const meta = window.CATEGORY_META[category];
        const categoryRows = rows.filter(r => r.category === category);
        
        categoryRows.sort((a, b) => {
            if (a.isDefault === b.isDefault) return 0;
            return a.isDefault ? -1 : 1;
        });

        const wrap = document.createElement('div');
        wrap.className = 'panel';
        wrap.style.cssText = 'flex: 1; display: flex; flex-direction: column; background: #1b1b1b; border: 1px solid #222; border-radius: 10px; overflow: hidden; min-height: 0;';

        const header = document.createElement('div');
        header.className = 'panel-header';
        header.style.cssText = `background: #222; padding: 12px 15px; font-size: 13px; font-weight: bold; color: ${meta.color}; border-bottom: 1px solid #333; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;`;
        
        const cbId = 'cb-' + category + '-enable';
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" id="${cbId}" ${isChecked ? 'checked' : ''} style="margin:0; cursor:pointer;">
                <span>${meta.label}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <button onclick="window.RulesCore.restoreCategoryDefaults('${category}')" title="Restore original rules for ${meta.label.split(' ')[0]}" style="background:transparent; border:none; color:#888; cursor:pointer; font-size:14px; padding:0; transition:0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#888'">🔄</button>
                <span style="background:#111; color:#aaa; padding:3px 8px; border-radius:6px; font-size:11px; border:1px solid #333;">${categoryRows.length} rules</span>
            </div>
        `;
        
        setTimeout(() => {
            const cb = document.getElementById(cbId);
            if (cb) {
                cb.onchange = async (e) => {
                    await window.saveSetting(settingKey, e.target.checked); 
                    window.RulesCore.applyUserRulesToGlobals();
                };
            }
        }, 0);

        wrap.appendChild(header);

        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:11px; color:#aaa; padding: 12px 15px; background: #151515; border-bottom: 1px solid #222; flex-shrink: 0; line-height: 1.5;';
        hint.innerHTML = `<b>${meta.hint}</b><br><span style="color:#777; margin-top:6px; display:inline-block;">${meta.desc}</span> <span style="color:#666;">You can also mix in <b>@embedName</b> references to a Custom Embed group.</span>`;
        wrap.appendChild(hint);

        const list = document.createElement('div');
        list.className = 'panel-list-scroll';
        list.style.cssText = 'flex: 1; overflow-y: auto; display: flex; flex-direction: column; background: #111; padding: 10px; gap: 6px;';

        if (categoryRows.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:12px; color:#555; font-style:italic; text-align: center; margin-top: 30px;';
            empty.textContent = 'No rules in this category.';
            list.appendChild(empty);
        }

        categoryRows.forEach(row => {
            const item = document.createElement('div');
            item.className = 'conflict-group-item';
            const safeTags = Array.isArray(row.tags) ? row.tags : [];

            if (_genericEditingId === row.id) {
                /* ---------- MODO EDIÇÃO INLINE ----------
                   O card vira uma textarea com as tags atuais + Update/Cancel,
                   no lugar do antigo prompt() de uma linha só. Sem campo de
                   nome/cor aqui — Conflict/Similar são só uma lista de tags. */
                item.style.cssText = `display:flex; flex-direction:column; gap:8px; background:#151515; border:1px solid ${meta.color}; border-radius:6px; padding:10px;`;
                item.innerHTML = `
                    <div style="font-size:11px; color:${meta.color}; font-weight:bold;">✏️ Editing group</div>
                    <textarea class="generic-edit-tags" placeholder="tag1, tag2, @embedName..." style="font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-height:60px; resize:vertical;">${window.RulesUI.escapeHTML(safeTags.join(', '))}</textarea>
                    <div style="display:flex; gap:6px; justify-content:flex-end;">
                        <button class="btn-generic-cancel" style="background:#222; border:1px solid #444; color:#aaa; font-size:11px; padding:6px 14px; border-radius:4px; cursor:pointer; font-weight:bold;">✖ Cancel</button>
                        <button class="btn-generic-update" style="background:#00aa66; border:none; color:#000; font-size:11px; padding:6px 14px; border-radius:4px; cursor:pointer; font-weight:bold;">✅ Update</button>
                    </div>
                `;

                item.querySelector('.btn-generic-cancel').onclick = () => {
                    _genericEditingId = null;
                    window.RulesUI.refreshModalBody();
                };

                item.querySelector('.btn-generic-update').onclick = async () => {
                    const tagsInput = item.querySelector('.generic-edit-tags');
                    const newTags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);
                    if (newTags.length < 2) { if (window.showAlert) window.showAlert('A group needs at least 2 tags.', 'warn'); tagsInput.focus(); return; }
                    await window.RulesDB.updateRule(row.id, newTags);
                    _genericEditingId = null;
                    await window.RulesCore.applyUserRulesToGlobals();
                    window.RulesUI.refreshModalBody();
                };

            } else {
                /* ---------- MODO NORMAL (exibição) ---------- */
                const badge = row.isDefault
                    ? '<span style="background:#2a2a2a; color:#aaa; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #444;">Original</span>'
                    : '<span style="background:#1a4d2e; color:#4caf50; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2e7d32;">Custom</span>';

                const safeTagsText = window.RulesUI.escapeHTML(safeTags.join(', '));
                item.style.cssText = `display:flex; align-items:center; gap:8px; background:#151515; border:1px solid #2a2a2a; border-left:3px solid ${meta.color}; border-radius:6px; padding:8px 10px;`;
                item.innerHTML = `
                    <div style="flex:1; display:flex; flex-direction: column; gap: 4px; overflow: hidden;">
                        <div>${badge}</div>
                        <span style="font-size:12px; color:#ddd; word-break:break-word; line-height: 1.3;">${safeTagsText}</span>
                    </div>
                    <div style="display:flex; flex-direction: column; gap:4px; flex-shrink:0;">
                        <button class="btn-conflict-edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️</button>
                        <button class="btn-conflict-delete" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                    </div>
                `;

                item.querySelector('.btn-conflict-edit').onclick = () => {
                    _genericEditingId = row.id;
                    window.RulesUI.refreshModalBody();
                };

                item.querySelector('.btn-conflict-delete').onclick = async () => {
                    if (!confirm('Remove this rule?')) return;
                    await window.RulesDB.deleteRule(row.id);
                    await window.RulesCore.applyUserRulesToGlobals();
                    window.RulesUI.refreshModalBody();
                };
            }

            list.appendChild(item);
        });
        wrap.appendChild(list);

        const addRow = document.createElement('div');
        addRow.className = 'inline-add-box';
        addRow.style.cssText = 'display: flex; gap: 8px; padding: 12px 15px; background: #111; align-items: center; flex: 0 0 auto; border-top: 1px solid #222;';
        addRow.innerHTML = `
            <input type="text" class="conflict-add-input" placeholder="tag1, tag2, @embedName..." style="flex:1; font-size:12px; background:#222; border:1px solid #444; padding:8px 10px; border-radius:6px; color:#fff; outline:none; min-width: 0;">
            <button class="conflict-add-btn" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; font-size:12px; padding:8px 12px; border-radius:6px; flex-shrink:0; font-weight:bold; cursor:pointer;">➕ Add</button>
        `;
        
        const input = addRow.querySelector('.conflict-add-input');
        const addBtn = addRow.querySelector('.conflict-add-btn');
        
        const doAdd = async () => {
            const tags = input.value.split(',').map(t => t.trim()).filter(t => t);
            if (tags.length < 2) { if (window.showAlert) window.showAlert('A group needs at least 2 tags.', 'warn'); return; }
            await window.RulesDB.addRule(category, tags, false); 
            input.value = '';
            await window.RulesCore.applyUserRulesToGlobals();
            window.RulesUI.refreshModalBody();
        };
        
        addBtn.onclick = doAdd;
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };
        
        wrap.appendChild(addRow);
        return wrap;
    };

    // Register Conflict Section
    window.RulesUI.registerSection(1, async (rows) => {
        const isEnabled = await window.getSetting('rm_enable_red', true);
        return window.RulesUI.renderGenericCategorySection('conflict', rows, isEnabled, 'rm_enable_red');
    });

    // --- MODAL BASE ---
    const modalStyle = document.createElement('style');
    modalStyle.innerHTML = `
        #modal-conflict-manager .tool-modal { width: 95vw !important; max-width: 1400px !important; height: 85vh !important; display: flex; flex-direction: column; padding: 20px; }
        #modal-conflict-manager .conflict-group-item { transition: 0.1s; }
        #modal-conflict-manager .conflict-group-item:hover { background: #222 !important; }
        #modal-conflict-manager .btn-top-action { background: #333; color: #fff; border: 1px solid #555; padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; transition: 0.2s; font-weight: bold; }
        #modal-conflict-manager .btn-top-action:hover { background: #555; border-color: #777; }
        #modal-conflict-manager .panel-list-scroll::-webkit-scrollbar { width: 6px; }
        #modal-conflict-manager .panel-list-scroll::-webkit-scrollbar-track { background: #111; }
        #modal-conflict-manager .panel-list-scroll::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
        #modal-conflict-manager .panel-list-scroll::-webkit-scrollbar-thumb:hover { background: #00aa66; }
        .tag-hl-icon { transition: 0.15s; }
        .tag-hl-icon:hover { transform: scale(1.2); }
        .hl-color-input { width: 26px; height: 26px; padding: 0; border: 1px solid #444; border-radius: 50%; background: transparent; cursor: pointer; flex-shrink: 0; }
        .hl-color-input::-webkit-color-swatch-wrapper { padding: 2px; border-radius: 50%; }
        .hl-color-input::-webkit-color-swatch { border: none; border-radius: 50%; }
    `;
    document.head.appendChild(modalStyle);

    window.RulesUI.buildModal = function() {
        if (document.getElementById('modal-conflict-manager')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-conflict-manager';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-conflict-manager');

        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-shrink: 0;">
                    <div>
                        <h3 style="margin:0 0 5px 0; border:none; padding:0; font-size:18px;">🧩 Manage Tag Rules & Automations</h3>
                        <div style="font-size:11px; color:#888; margin-bottom:10px;">
                            Control UI warnings and automatic dataset operations.
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-top-action" onclick="if(window.runAutoMergeOnDataset) window.runAutoMergeOnDataset(true)" style="background:#00aa66; border-color:#00cc88; color:#000;">▶ Run Auto-Do Now</button>
                        <button class="btn-top-action" onclick="window.RulesCore.restoreDefaultRules()">🔄 Restore ALL Defaults</button>
                        <button class="btn-top-action" onclick="if(window.RulesUI.restoreHighlightColorDefaults) window.RulesUI.restoreHighlightColorDefaults()" style="background:#151515; color:#4db8ff; border-color:#2a5a8c;" title="Reset colors back to factory defaults">🎨 Restore Highlight Colors</button>
                        <button class="btn-top-action" onclick="window.RulesCore.clearAllRules()" style="color:#ff6060; border-color:#7a222c;">🗑️ Clear All</button>
                    </div>
                </div>
                <div id="conflict-manager-body" style="flex:1; display:flex; flex-direction:row; gap:15px; overflow:hidden; margin-top: 10px; margin-bottom: 15px; min-height: 0;"></div>
                <div class="modal-buttons" style="flex-shrink:0; border-top: 1px solid #333; padding-top: 15px; display: flex; justify-content: space-between;">
                    <button class="btn-top-action" style="background:#2f1a5c; color:#b890ff; border-color:#4a2a8c; padding: 8px 16px; font-size: 13px;" onclick="if(window.openEmbedsManager) window.openEmbedsManager()">📦 Manage Custom Embeds (@groups)</button>
                    <button class="btn-cancel" style="background:#333; color:#fff;" onclick="window.closeModal('modal-conflict-manager')">Close Interface</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        if(window.buildEmbedModal) window.buildEmbedModal();
    };

    window.RulesUI.refreshModalBody = async function() {
        const body = document.getElementById('conflict-manager-body');
        if (!body) return;
        const rows = await window.RulesDB.getAllRules();
        body.innerHTML = '';
        for (const section of this.sections) {
            const el = await section.fn(rows);
            if (el) body.appendChild(el);
        }
    };

    window.openConflictManager = async function () {
        try {
            window.RulesUI.buildModal();
            await window.RulesUI.refreshModalBody();
            window.openModal('modal-conflict-manager');
            
            // Add counters toggles logic to modal header if not exists
            const modalHeaderLeft = document.querySelector('#modal-conflict-manager .tool-modal > div:first-child > div:first-child');
            if (modalHeaderLeft && !document.getElementById('counter-checkboxes-container')) {
                const checkDiv = document.createElement('div');
                checkDiv.id = 'counter-checkboxes-container';
                checkDiv.style.cssText = 'display:flex; gap:15px; margin-bottom:10px; background:#111; padding:6px 10px; border-radius:6px; border:1px solid #333;';
                checkDiv.innerHTML = `
                    <label style="font-size: 11px; color: #ccc; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="toggle-counter-conflict" style="margin:0;" ${window.enableCounterConflict !== false ? 'checked' : ''} onchange="window.IssueCounters.toggle('conflict')">
                        Show Issue Counters (Conflicts)
                    </label>
                    <label style="font-size: 11px; color: #ccc; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="toggle-counter-similar" style="margin:0;" ${window.enableCounterSimilar !== false ? 'checked' : ''} onchange="window.IssueCounters.toggle('similar')">
                        Show Issue Counters (Similars)
                    </label>
                `;
                modalHeaderLeft.appendChild(checkDiv);
            }
        } catch (err) {
            console.error("Modal Render Error: ", err);
            if (window.showAlert) window.showAlert("Error opening the rules panel.", "error");
        }
    };

    window.RulesUI.injectButton = function() {
        const customRulesBtn = document.getElementById('btn-custom-rules');
        if (customRulesBtn) customRulesBtn.style.display = 'none';
        const rightBar = document.getElementById('topbar-right');
        const anchor = document.getElementById('btn-settings');
        if (!rightBar || !anchor || document.getElementById('btn-conflict-manager')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-conflict-manager';
        btn.title = 'Manage tag rules and automations';
        btn.textContent = '🧩 Manage Rules';
        btn.onclick = () => window.openConflictManager();
        if (window.enableConflictWarnings === false) btn.style.display = 'none';
        rightBar.insertBefore(btn, anchor);
    };

    /* ---------------------------------------------------------------------
       RESOLUÇÃO DE EMBEDS (@embedName) — COMPARTILHADA
       ---------------------------------------------------------------------
       Expande, em qualquer array de tags de um grupo, toda entrada que
       comece com "@" para as tags reais do embed correspondente
       (case-insensitive pelo nome do embed). Entradas sem "@" continuam
       como estão. Referências a um embed inexistente são ignoradas
       silenciosamente (mesmo comportamento já existente no Auto-Do,
       window.matchTag).
    --------------------------------------------------------------------- */
    window.RulesCore.resolveGroupTags = function(tags, embeds) {
        const out = [];
        (Array.isArray(tags) ? tags : []).forEach(t => {
            const tStr = String(t);
            if (tStr.startsWith('@')) {
                const embedName = tStr.slice(1).trim().toLowerCase();
                const embed = (embeds || []).find(e => (e.name || '').toLowerCase() === embedName);
                if (embed && Array.isArray(embed.tags)) out.push(...embed.tags);
            } else {
                out.push(tStr);
            }
        });
        return [...new Set(out)];
    };

    // --- CORE LOGIC ---
    window.RulesCore.applyUserRulesToGlobals = async function() {
        const rows = await window.RulesDB.getAllRules();
        window._userConflictRules = rows;

        const embeds = rows.filter(r => r.category === 'embed');
        const resolveGroupTags = (tags) => window.RulesCore.resolveGroupTags(tags, embeds);

        if (window.enableConflictWarnings === false) {
            window.tagConflicts = [];
            window.tagSimilar = [];
        } else {
            const isRedEnabled = await window.getSetting('rm_enable_red', true);
            const isYellowEnabled = await window.getSetting('rm_enable_yellow', true);
            window.tagConflicts = isRedEnabled ? rows.filter(r => r.category === 'conflict').map(r => resolveGroupTags(r.tags)) : [];
            window.tagSimilar = isYellowEnabled ? rows.filter(r => r.category === 'similar').map(r => resolveGroupTags(r.tags)) : [];
        }

        window.tagHighlightGroups = rows.filter(r => r.category === 'highlight');
        const hlMap = new Map();
        window.tagHighlightGroups.forEach(g => {
            resolveGroupTags(g.tags).forEach(t => {
                const key = String(t).toLowerCase();
                if (!hlMap.has(key)) hlMap.set(key, { name: g.name || '', color: g.color || '#4db8ff' });
            });
        });
        window._tagHighlightMap = hlMap;

        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.renderPresetTags === 'function') window.renderPresetTags();
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
    };
    
    // For backwards compatibility
    window.reloadUserConflictRules = () => window.RulesCore.applyUserRulesToGlobals();

    window.RulesCore.restoreDefaultRules = async function() {
        if (!confirm(`Restore ALL original default rules across ALL categories?\n\n- Your custom rules & embeds WILL BE KEPT intact!`)) return;
        await window.saveSetting('deleted-default-rules', []);
        await this.applyUserRulesToGlobals();
        if (document.getElementById('modal-conflict-manager')) await window.RulesUI.refreshModalBody(); 
        if (window.showAlert) window.showAlert('All original rules restored successfully!', 'success');
    };

    window.RulesCore.restoreCategoryDefaults = async function(category) {
        const meta = window.CATEGORY_META[category];
        if (!confirm(`Restore original default rules for ${meta.label.split(' ')[0]} only?\n\n- Your custom rules in this category will be kept.`)) return;
        let deletedDefaults = await window.getSetting('deleted-default-rules', []);
        if (!Array.isArray(deletedDefaults)) deletedDefaults = [];
        const catDefIds = window.RulesDB.getFactoryRules().filter(r => r.category === category).map(r => r.id);
        deletedDefaults = deletedDefaults.filter(id => !catDefIds.includes(id));
        await window.saveSetting('deleted-default-rules', deletedDefaults);
        await this.applyUserRulesToGlobals();
        if (document.getElementById('modal-conflict-manager')) await window.RulesUI.refreshModalBody();
        if (window.showAlert) window.showAlert(`${meta.label.split(' ')[0]} defaults restored!`, 'success');
    };

    window.RulesCore.clearAllRules = async function() {
        if (!confirm(`WARNING: This will delete ALL rules and embeds.\nAre you sure?`)) return;
        await window.saveSetting('custom-conflict-rules', []);
        const allDefIds = window.RulesDB.getFactoryRules().map(r => r.id);
        await window.saveSetting('deleted-default-rules', allDefIds);
        await this.applyUserRulesToGlobals();
        if(document.getElementById('modal-conflict-manager')) await window.RulesUI.refreshModalBody();
        if (window.showAlert) window.showAlert('All rules have been deleted.', 'success');
    };

    window.RulesCore.overrideOriginalSystems = function() {
        window.customTagRules = []; 
        const toggleConflict = document.getElementById('toggle-conflict-warnings');
        if (toggleConflict) {
            const label = toggleConflict.parentElement;
            if (label && label.tagName === 'LABEL') {
                label.innerHTML = '<input type="checkbox" id="toggle-conflict-warnings"> Enable Tag Manager Rules';
            }
            const newCb = document.getElementById('toggle-conflict-warnings');
            if (newCb) {
                newCb.checked = window.enableConflictWarnings;
                newCb.addEventListener('change', (e) => {
                    window.enableConflictWarnings = e.target.checked;
                    if (typeof window.saveSetting === 'function') window.saveSetting('toggle-conflict-warnings', e.target.checked);
                    const mainBtn = document.getElementById('btn-conflict-manager');
                    if (mainBtn) mainBtn.style.display = window.enableConflictWarnings ? 'inline-block' : 'none';
                    window.RulesCore.applyUserRulesToGlobals();
                });
            }
        }
    };

    // --- ISSUE COUNTERS ---
    window.enableCounterConflict = true;
    window.enableCounterSimilar = true;
    window.issueImagesMap = { conflict: [], similar: [] };

    window.IssueCounters.toggle = async function(type, skipSave = false) {
        const cb = document.getElementById(`toggle-counter-${type}`);
        if (cb) {
            if (type === 'conflict') window.enableCounterConflict = cb.checked;
            if (type === 'similar') window.enableCounterSimilar = cb.checked;
            if (!skipSave && typeof window.saveSetting === 'function') await window.saveSetting(`enable-counter-${type}`, cb.checked);
        }
        this.updateGlobal();
        this.updateActive();
    };

    window.getIssuesCountForTags = function(tagsArray) {
        let confCount = 0; let simCount = 0;
        const tagsLower = tagsArray.map(t => String(t).trim().toLowerCase()).filter(t => t);
        if (window.tagConflicts) {
            let conflictTags = new Set();
            window.tagConflicts.forEach(group => {
                const groupLower = (Array.isArray(group) ? group : []).map(g => String(g).toLowerCase());
                const activeInGroup = groupLower.filter(g => tagsLower.includes(g));
                if (activeInGroup.length > 1) activeInGroup.forEach(t => conflictTags.add(t));
            });
            confCount = conflictTags.size;
        }
        if (window.tagSimilar) {
            let similarTags = new Set();
            window.tagSimilar.forEach(group => {
                const groupLower = (Array.isArray(group) ? group : []).map(g => String(g).toLowerCase());
                const activeInGroup = groupLower.filter(g => tagsLower.includes(g));
                if (activeInGroup.length > 1) activeInGroup.forEach(t => similarTags.add(t));
            });
            simCount = similarTags.size;
        }
        return { conflicts: confCount, similars: simCount };
    };

    window.IssueCounters.updateGlobal = function() {
        const btnConf = document.getElementById('global-counter-conflict');
        const btnSim = document.getElementById('global-counter-similar');
        if (!btnConf || !btnSim) return;
        
        window.issueImagesMap = { conflict: [], similar: [] };
        if (typeof imageFiles !== 'undefined') {
            imageFiles.forEach((img, idx) => {
                if (img.hidden || img.type !== 'tags' || !img.content) return;
                const issues = window.getIssuesCountForTags(img.content.split(','));
                if (issues.conflicts > 0) window.issueImagesMap.conflict.push(idx);
                if (issues.similars > 0) window.issueImagesMap.similar.push(idx);
            });
        }
        if (window.enableCounterConflict && window.issueImagesMap.conflict.length > 0) {
            btnConf.style.display = 'inline-block'; btnConf.textContent = `⚠️ ${window.issueImagesMap.conflict.length} Conflicts`;
        } else btnConf.style.display = 'none';
        
        if (window.enableCounterSimilar && window.issueImagesMap.similar.length > 0) {
            btnSim.style.display = 'inline-block'; btnSim.textContent = `🟨 ${window.issueImagesMap.similar.length} Similar`;
        } else btnSim.style.display = 'none';
    };

    window.IssueCounters.updateActive = function() {
        const spanConf = document.getElementById('active-counter-conflict');
        const spanSim = document.getElementById('active-counter-similar');
        if (!spanConf || !spanSim) return;
        let totalConf = 0; let totalSim = 0;
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof imageFiles !== 'undefined') {
            selectedIndices.forEach(idx => {
                const img = imageFiles[idx];
                if (img && img.type === 'tags' && img.content) {
                    const issues = window.getIssuesCountForTags(img.content.split(','));
                    totalConf += issues.conflicts; totalSim += issues.similars;
                }
            });
        }
        if (window.enableCounterConflict && totalConf > 0) { spanConf.style.display = 'inline-block'; spanConf.textContent = `⚠️ ${totalConf} Conflicts`; } else spanConf.style.display = 'none';
        if (window.enableCounterSimilar && totalSim > 0) { spanSim.style.display = 'inline-block'; spanSim.textContent = `🟨 ${totalSim} Similar`; } else spanSim.style.display = 'none';
    };

    window.selectIssueImage = function(type) {
        const arr = window.issueImagesMap[type];
        if (!arr || arr.length === 0) return;
        let currentSelected = -1;
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) currentSelected = Array.from(selectedIndices)[0];
        let nextIdx = arr[0];
        if (currentSelected !== -1) {
            const currentIndexInArr = arr.indexOf(currentSelected);
            if (currentIndexInArr !== -1) nextIdx = arr[(currentIndexInArr + 1) % arr.length];
            else {
                for (let i = 0; i < arr.length; i++) {
                    if (arr[i] > currentSelected) { nextIdx = arr[i]; break; }
                }
            }
        }
        if (typeof selectedIndices !== 'undefined') { selectedIndices.clear(); selectedIndices.add(nextIdx); }
        if (typeof imageFiles !== 'undefined') {
            const targetImg = imageFiles[nextIdx];
            if (targetImg && targetImg.element) targetImg.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
        if (typeof window.renderEditor === 'function') window.renderEditor();
    };

    window.IssueCounters.initDOM = function() {
        const activeHeaderLeft = document.querySelector('#col-editor .panel-header > div:first-child');
        if (activeHeaderLeft && !document.getElementById('active-counter-conflict')) {
            const activeCounters = document.createElement('div');
            activeCounters.style.cssText = 'display: flex; gap: 6px; margin-left: 5px; align-items: center;';
            activeCounters.innerHTML = `
                <span id="active-counter-conflict" style="display:none; background:#330000; border: 1px solid #ff4444; color:#ffaaaa; padding: 2px 6px; font-size: 11px; border-radius: 4px; cursor: help;" title="Tags with conflict in this specific image"></span>
                <span id="active-counter-similar" style="display:none; background:#332200; border: 1px solid #ffcc00; color:#ffeeaa; padding: 2px 6px; font-size: 11px; border-radius: 4px; cursor: help;" title="Similar tags in this specific image"></span>
            `;
            activeHeaderLeft.appendChild(activeCounters);
        }
        const globalHeaderLeft = document.querySelector('#col-tools .panel-header > div:first-child');
        if (globalHeaderLeft && !document.getElementById('global-counter-conflict')) {
            const globalCounters = document.createElement('div');
            globalCounters.style.cssText = 'display: flex; gap: 6px; margin-left: 5px; align-items: center;';
            globalCounters.innerHTML = `
                <button id="global-counter-conflict" class="btn-save-local" style="display:none; background:#330000; border-color:#ff4444; color:#ffaaaa; padding: 2px 6px; font-size: 11px;" title="Images with Tag Conflicts (Click to jump to one)" onclick="window.selectIssueImage('conflict')"></button>
                <button id="global-counter-similar" class="btn-save-local" style="display:none; background:#332200; border-color:#ffcc00; color:#ffeeaa; padding: 2px 6px; font-size: 11px;" title="Images with Similar/Redundant Tags (Click to jump to one)" onclick="window.selectIssueImage('similar')"></button>
            `;
            globalHeaderLeft.appendChild(globalCounters);
        }
        this.updateGlobal();
        this.updateActive();
    };

    // Replace globals for backward compatibility
    window.updateGlobalIssueCounters = () => window.IssueCounters.updateGlobal();
    window.updateActiveIssueCounters = () => window.IssueCounters.updateActive();

    // --- GLOW (HOVER HIGHLIGHT) ---
    const glowStyle = document.createElement('style');
    glowStyle.innerHTML = `
        .tag-row.glow-conflict, .master-tag-item.glow-conflict { background: rgba(255, 60, 60, 0.4) !important; box-shadow: inset 0 0 0 2px #ff4444, 0 0 10px rgba(255,68,68,0.5) !important; transition: all 0.1s ease-in-out !important; }
        .tag-row.glow-similar, .master-tag-item.glow-similar { background: rgba(255, 204, 0, 0.3) !important; box-shadow: inset 0 0 0 2px #ffcc00, 0 0 10px rgba(255,204,0,0.4) !important; transition: all 0.1s ease-in-out !important; }
    `;
    document.head.appendChild(glowStyle);

    document.addEventListener('mouseover', (e) => {
        if (e.target.id === 'active-counter-conflict' || e.target.classList.contains('conflict-warning')) {
            if(e.target.id === 'active-counter-conflict') document.querySelectorAll('#tag-list-vertical .tag-row.conflict').forEach(el => el.classList.add('glow-conflict'));
            if(e.target.classList.contains('conflict-warning')) { const p = e.target.closest('.tag-row, .master-tag-item'); if(p) p.classList.add('glow-conflict'); }
            const title = e.target.getAttribute('title') || '';
            if (title.startsWith('Conflict with: ')) {
                title.replace('Conflict with: ', '').split(',').forEach(t => {
                    const r = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(t.trim().toLowerCase())}"]`); if(r) r.classList.add('glow-conflict');
                });
            }
        } 
        else if (e.target.id === 'active-counter-similar' || e.target.classList.contains('similar-warning')) {
            if(e.target.id === 'active-counter-similar') document.querySelectorAll('#tag-list-vertical .tag-row.similar').forEach(el => el.classList.add('glow-similar'));
            if(e.target.classList.contains('similar-warning')) { const p = e.target.closest('.tag-row, .master-tag-item'); if(p) p.classList.add('glow-similar'); }
            const title = e.target.getAttribute('title') || '';
            if (title.startsWith('Similar/Redundant to: ')) {
                title.replace('Similar/Redundant to: ', '').split(',').forEach(t => {
                    const r = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(t.trim().toLowerCase())}"]`); if(r) r.classList.add('glow-similar');
                });
            }
        }
    });
    document.addEventListener('mouseout', (e) => {
        if (['active-counter-conflict','active-counter-similar'].includes(e.target.id) || e.target.classList.contains('conflict-warning') || e.target.classList.contains('similar-warning')) {
            document.querySelectorAll('.glow-conflict').forEach(el => el.classList.remove('glow-conflict'));
            document.querySelectorAll('.glow-similar').forEach(el => el.classList.remove('glow-similar'));
        }
    });

    // --- BOOTSTRAPPER ---
    window.addEventListener('DOMContentLoaded', async () => {
        await window.RulesDB.migrateOldIndexedDB();
        if (typeof window.getSetting === 'function') {
            window.enableConflictWarnings = await window.getSetting('toggle-conflict-warnings', true);
            window.enableCounterConflict = await window.getSetting('enable-counter-conflict', true);
            window.enableCounterSimilar = await window.getSetting('enable-counter-similar', true);
        }
        await window.RulesDB.cleanBloatedJSON();

        if (window.RulesUI.relocateBuiltinHighlightToggles) window.RulesUI.relocateBuiltinHighlightToggles();
        if (window.RulesUI.loadBuiltinHighlightColors) await window.RulesUI.loadBuiltinHighlightColors();
        if (window.RulesUI.wrapRenderersForHighlights) window.RulesUI.wrapRenderersForHighlights();

        window.RulesCore.overrideOriginalSystems();
        window.RulesUI.injectButton();
        if (window.RulesCore.hookAutoMergeLoader) window.RulesCore.hookAutoMergeLoader();
        
        await window.RulesCore.applyUserRulesToGlobals();
        
        window.IssueCounters.initDOM();
        setTimeout(() => window.IssueCounters.initDOM(), 500);

        // Hook ApplyFilters / RenderEditor for counters
        if (typeof window.registerPostApplyFilters === 'function' && typeof window.registerPostRenderEditor === 'function') {
            window.registerPostApplyFilters(() => window.IssueCounters.updateGlobal());
            window.registerPostRenderEditor(() => window.IssueCounters.updateActive());
        } else {
            if (typeof window.applyFilters === 'function') {
                const originalApplyFilters = window.applyFilters;
                window.applyFilters = function() { if (originalApplyFilters) originalApplyFilters.apply(this, arguments); window.IssueCounters.updateGlobal(); };
            }
            if (typeof window.renderEditor === 'function') {
                const originalRenderEditor = window.renderEditor;
                window.renderEditor = function() { if (originalRenderEditor) originalRenderEditor.apply(this, arguments); window.IssueCounters.updateActive(); };
            }
        }
    });

})();