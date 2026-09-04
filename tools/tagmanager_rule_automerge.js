/* =========================================================================
   3. AUTO-MERGE / AUTO-DO - TAG MANAGER
   ---------------------------------------------------------------------
   Auto-Do UI, Execution Engine, and Embeds Manager.

   FIX (edição de Embed via prompt()): antes, ✏️ Edit abria 2 prompt()
   sequenciais (nome, depois tags) — difícil de ver o que já estava lá,
   sem multi-linha decente, sem contexto. Agora ✏️ Edit transforma o
   próprio card do embed num formulário INLINE (input de nome + textarea
   de tags, igual ao "Create New Embed" logo abaixo), com os botões
   virando ✅ Update / ✖ Cancel enquanto editando — ✏️ Edit / 🗑️ voltam
   assim que sai do modo edição (Update ou Cancel).

   Renomear um embed (mudar o @nome) agora também propaga automaticamente
   pra qualquer Conflict/Similar/Highlight/Auto-Do que referenciava
   "@nomeAntigo" — ver window.renameEmbedReferencesEverywhere abaixo.
========================================================================= */

(function () {
    const FACTORY_EMBEDS = [
        { name: 'clothing', tags: ['shirt', 'dress', 'skirt', 'pants', 'shorts', 'jeans', 'jacket', 'coat', 'sweater', 'hoodie', 'cardigan', 'vest', 'blazer', 'uniform', 'suit', 'kimono', 'robe', 'gown', 'swimsuit', 'bikini', 'lingerie', 'underwear', 'panties', 'bra', 'boxers', 'briefs', 'socks', 'thighhighs', 'pantyhose', 'stockings', 'leggings', 'gloves', 'mittens', 'scarf', 'tie', 'necktie', 'bowtie', 'collar', 'hat', 'cap', 'hood', 'veil', 'mask', 'apron', 'overalls', 'romper', 'leotard', 'bodysuit', 'top', 'blouse', 'tank top', 'crop top', 'tube top', 'camisole', 'corset', 'harness', 'belt', 'shoes', 'boots', 'sandals', 'heels', 'sneakers', 'slippers', 'armor', 'clothes', 'clothing', 'outfit', 'costume'] },
        { name: 'solidbackground', tags: ['simple background', 'white background', 'black background', 'transparent background', 'blue background', 'red background', 'green background', 'yellow background', 'pink background', 'purple background', 'grey background', 'brown background', 'orange background'] }
    ];

    FACTORY_EMBEDS.forEach((emb, i) => window.RulesDB.factoryRules.push({ id: 'def_emb_'+i, category: 'embed', isDefault: true, name: emb.name, tags: emb.tags }));

    window.RulesDB.factoryRules.push({ id: 'def_am_0', category: 'automerge', isDefault: true, keepTag: 'nude', removeTags: ['completely nude'], require: [], exclude: ['full body', '@clothing'], isAutoFill: false });
    window.RulesDB.factoryRules.push({ id: 'def_am_1', category: 'automerge', isDefault: true, keepTag: 'completely nude', removeTags: ['nude'], require: ['full body'], exclude: ['@clothing'], isAutoFill: false });
    window.RulesDB.factoryRules.push({ id: 'def_am_2', category: 'automerge', isDefault: true, keepTag: 'tachi-e', removeTags: ['visual novel cg'], require: ['@solidbackground'], exclude: [], isAutoFill: true });

    // Estado do modo edição inline do Embed Manager: guarda o ID do embed
    // sendo editado agora (ou null se nenhum). Fica no escopo do módulo,
    // então sobrevive a qualquer refreshEmbedList() intermediário.
    let _embedEditingId = null;

    // --- ENGINE ---
    window.matchTag = function(tag, condition, embeds) {
        const t = tag.toLowerCase(); const c = condition.toLowerCase();
        if (c.startsWith('@')) {
            const embedName = c.slice(1);
            const embed = embeds.find(e => (e.name || '').toLowerCase() === embedName);
            if (embed && Array.isArray(embed.tags)) return embed.tags.some(eTag => eTag.toLowerCase() === t);
            return false;
        }
        return t === c;
    };

    window.runAutoMergeRule = function(tagsArray, rule, embeds) {
        const removes = Array.isArray(rule.removeTags) ? rule.removeTags : [];
        const reqs = Array.isArray(rule.require) ? rule.require : [];
        const excs = Array.isArray(rule.exclude) ? rule.exclude : [];
        const presentRemoves = removes.filter(rem => tagsArray.some(t => t.toLowerCase() === rem.toLowerCase()));
        if (presentRemoves.length === 0) return null; 

        let hasRequired = reqs.length === 0 || reqs.every(req => tagsArray.some(t => matchTag(t, req, embeds)));
        let hasExcluded = excs.length > 0 && tagsArray.some(t => excs.some(ex => matchTag(t, ex, embeds)));

        if (hasRequired && !hasExcluded) {
            let newTags = [...tagsArray];
            if (!rule.isAutoFill) newTags = tagsArray.filter(t => !removes.some(rem => rem.toLowerCase() === t.toLowerCase()));
            if (rule.keepTag && String(rule.keepTag).trim() !== '') newTags.push(String(rule.keepTag).trim());
            return [...new Set(newTags)];
        }
        return null;
    };

    window.runAutoMergeOnDataset = async function(manual = false) {
        if (window.enableConflictWarnings === false) return;
        if (!window.imageFiles || window.imageFiles.length === 0) { if (manual && window.showAlert) window.showAlert('No dataset loaded.', 'warn'); return; }
        
        const rows = await window.RulesDB.getAllRules();
        const amRules = rows.filter(r => r.category === 'automerge').map(row => {
            if (Array.isArray(row.tags) && row.tags.length > 0) return { keepTag: row.tags[0], removeTags: row.tags.slice(1), require: [], exclude: [], isAutoFill: false };
            if (row.target) return { keepTag: row.fallback, removeTags: [row.target], require: Array.isArray(row.exclude) ? row.exclude : [], exclude: Array.isArray(row.require) ? row.require : [], isAutoFill: false };
            if (!Array.isArray(row.removeTags)) row.removeTags = [];
            return row;
        });

        const embeds = rows.filter(r => r.category === 'embed');
        if (amRules.length === 0) { if (manual && window.showAlert) window.showAlert('No Auto-Do rules configured.', 'warn'); return; }

        let changedCount = 0; let modifiedFiles = [];
        window.imageFiles.forEach(img => {
            if (img.type === 'tags' && img.content && !img.hidden) {
                let originalTags = img.content.split(',').map(t => t.trim()).filter(t => t);
                let currentTags = [...originalTags];
                amRules.forEach(rule => { const res = runAutoMergeRule(currentTags, rule, embeds); if (res) currentTags = res; });
                if (originalTags.join(',') !== currentTags.join(',')) {
                    img.content = currentTags.join(', '); img.hasFile = true; modifiedFiles.push(img); changedCount++;
                }
            }
        });

        if (changedCount > 0) {
            if (typeof window.markDirty === 'function') window.markDirty(modifiedFiles);
            if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
            if (window.masterTagSet) {
                window.masterTagSet.clear();
                window.imageFiles.forEach(img => { if(img.type === 'tags' && img.content) img.content.split(',').forEach(t => { if(t.trim()) window.masterTagSet.add(t.trim()); }); });
            }
            if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
            if (typeof window.renderImageList === 'function') window.renderImageList();
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            if (typeof window.renderEditor === 'function') window.renderEditor();
            if (typeof window.applyFilters === 'function') window.applyFilters();
            if (window.showAlert) window.showAlert(`Auto-Do applied to ${changedCount} image(s)!`, 'success');
        } else {
            if (manual && window.showAlert) window.showAlert('No matching tags found to automate.', 'info');
        }
    };

    window.RulesCore.hookAutoMergeLoader = function() {
        if (window._autoMergeHooked) return;
        if (typeof window.registerAutoDatasetTask === 'function') {
            window.registerAutoDatasetTask('auto-merge', async () => {
                const autoRun = await window.getSetting('rm_auto_merge', false);
                if (autoRun && window.enableConflictWarnings !== false) await window.runAutoMergeOnDataset(false);
            });
            window._autoMergeHooked = true; return;
        }
        let _lastImageFilesRef = null;
        const _origRender = window.renderImageList;
        if (typeof _origRender === 'function') {
            window.renderImageList = function() {
                if (window.imageFiles && window.imageFiles !== _lastImageFilesRef) {
                    _lastImageFilesRef = window.imageFiles;
                    window.getSetting('rm_auto_merge', false).then(autoRun => {
                        if (autoRun && window.enableConflictWarnings !== false) setTimeout(() => window.runAutoMergeOnDataset(false), 100);
                    });
                }
                return _origRender.apply(this, arguments);
            };
            window._autoMergeHooked = true;
        }
    };

    // --- UI AUTO MERGE ---
    function renderAutoMergeSection(rows, isChecked) {
        const meta = window.CATEGORY_META.automerge;
        const categoryRows = rows.filter(r => r.category === 'automerge');
        categoryRows.sort((a, b) => (a.isDefault === b.isDefault ? 0 : (a.isDefault ? -1 : 1)));

        const wrap = document.createElement('div');
        wrap.className = 'panel';
        wrap.style.cssText = 'flex: 1; display: flex; flex-direction: column; background: #1b1b1b; border: 1px solid #222; border-radius: 10px; overflow: hidden; min-height: 0;';

        const header = document.createElement('div');
        header.className = 'panel-header';
        header.style.cssText = `background: #222; padding: 12px 15px; font-size: 13px; font-weight: bold; color: ${meta.color}; border-bottom: 1px solid #333; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;`;
        
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" id="cb-auto-merge" ${isChecked ? 'checked' : ''} style="margin:0; cursor:pointer;" title="Auto-Run when a folder finishes loading">
                <span>${meta.label}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <button onclick="window.RulesCore.restoreCategoryDefaults('automerge')" title="Restore original rules" style="background:transparent; border:none; color:#888; cursor:pointer; font-size:14px; padding:0; transition:0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#888'">🔄</button>
                <span style="background:#111; color:#aaa; padding:3px 8px; border-radius:6px; font-size:11px; border:1px solid #333;">${categoryRows.length} rules</span>
            </div>
        `;
        setTimeout(() => {
            const cb = document.getElementById('cb-auto-merge');
            if (cb) cb.onchange = async (e) => { await window.saveSetting('rm_auto_merge', e.target.checked); };
        }, 0);
        wrap.appendChild(header);

        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:11px; color:#aaa; padding: 12px 15px; background: #151515; border-bottom: 1px solid #222; flex-shrink: 0; line-height: 1.5;';
        hint.innerHTML = `<b>${meta.hint}</b><br><span style="color:#777; margin-top:6px; display:inline-block;">${meta.desc}</span>`;
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
            item.style.cssText = `display:flex; align-items:center; gap:8px; background:#151515; border:1px solid #2a2a2a; border-left:3px solid ${meta.color}; border-radius:6px; padding:8px 10px;`;
            
            const badge = row.isDefault ? '<span style="background:#2a2a2a; color:#aaa; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #444;">Original</span>' : '<span style="background:#1a4d2e; color:#4caf50; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2e7d32;">Custom</span>';
            
            let keep = row.keepTag || '';
            let rems = Array.isArray(row.removeTags) ? row.removeTags : [];
            let reqs = Array.isArray(row.require) ? row.require : [];
            let excs = Array.isArray(row.exclude) ? row.exclude : [];
            let isAutoFill = !!row.isAutoFill;
            
            if (row.tags && Array.isArray(row.tags)) { keep = row.tags[0] || ''; rems = row.tags.slice(1); } 
            else if (row.target) { keep = row.fallback || ''; rems = [row.target]; reqs = Array.isArray(row.exclude) ? row.exclude : []; excs = Array.isArray(row.require) ? row.require : []; }

            const modeBadge = isAutoFill ? '<span style="background:#1a3a5c; color:#4db8ff; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2a5a8c; margin-left:4px;">Fill</span>' : '<span style="background:#5c1a1a; color:#ff6060; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #7a222c; margin-left:4px;">Merge</span>';

            item.innerHTML = `
                <div style="flex:1; display:flex; flex-direction: column; gap: 6px; overflow: hidden;">
                    <div>${badge}${modeBadge} <b style="color:${isAutoFill ? '#4db8ff' : '#ff6060'}; font-size:11px; margin-left:4px;">[${window.RulesUI.escapeHTML(rems.join(', '))}]</b> ${keep ? `<span style="color:#888; font-size:10px; margin: 0 4px;">→</span> <b style="color:#00ff99; font-size:12px;">${isAutoFill ? '+ ' : ''}${window.RulesUI.escapeHTML(keep)}</b>` : `<span style="color:#888; font-size:10px; margin-left:4px;">(Removed)</span>`}</div>
                    <div style="font-size:11px; color:#aaa; display:flex; gap:10px; flex-wrap:wrap;">
                        ${reqs.length ? `<span style="background:#222; padding:2px 6px; border-radius:4px;"><span style="color:#00ff99;">Req:</span> ${window.RulesUI.escapeHTML(reqs.join(', '))}</span>` : ''}
                        ${excs.length ? `<span style="background:#222; padding:2px 6px; border-radius:4px;"><span style="color:#ff6060;">Exc:</span> ${window.RulesUI.escapeHTML(excs.join(', '))}</span>` : ''}
                    </div>
                </div>
                <div style="display:flex; flex-direction: column; gap:4px; flex-shrink:0;">
                    <button class="btn-conflict-edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️</button>
                    <button class="btn-conflict-delete" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                </div>
            `;
            item.querySelector('.btn-conflict-edit').onclick = async () => {
                const input = prompt(`Edit Rule:\nFormat: Main Tag | Triggers (Remove/Check) | Requires | Excludes | isAutoFill (true/false)`, `${keep} | ${rems.join(', ')} | ${reqs.join(', ')} | ${excs.join(', ')} | ${isAutoFill}`);
                if (input === null) return;
                const parts = input.split('|').map(s => s.trim());
                if (parts.length < 2) { if (window.showAlert) window.showAlert('Invalid format.', 'error'); return; }
                const data = { keepTag: parts[0], removeTags: parts[1].split(',').map(t=>t.trim()).filter(t=>t), require: parts[2] ? parts[2].split(',').map(t=>t.trim()).filter(t=>t) : [], exclude: parts[3] ? parts[3].split(',').map(t=>t.trim()).filter(t=>t) : [], isAutoFill: parts[4] === 'true' };
                if (data.removeTags.length === 0) { if (window.showAlert) window.showAlert('Triggers cannot be empty.', 'error'); return; }
                await window.RulesDB.updateRule(row.id, data); 
                await window.RulesCore.applyUserRulesToGlobals();
                window.RulesUI.refreshModalBody();
            };
            item.querySelector('.btn-conflict-delete').onclick = async () => {
                if (!confirm('Remove this rule?')) return;
                await window.RulesDB.deleteRule(row.id);
                await window.RulesCore.applyUserRulesToGlobals();
                window.RulesUI.refreshModalBody();
            };
            list.appendChild(item);
        });
        wrap.appendChild(list);

        const addRow = document.createElement('div');
        addRow.className = 'inline-add-box';
        addRow.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 12px 15px; background: #111; align-items: stretch; flex: 0 0 auto; border-top: 1px solid #222;';
        addRow.innerHTML = `
            <div style="display:flex; gap:6px;">
                <input type="text" class="cond-keep" placeholder="Main Tag (to add)" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                <input type="text" class="cond-remove" placeholder="Trigger Tags (comma-sep)" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
            </div>
            <div style="display:flex; gap:6px;">
                <input type="text" class="cond-req" placeholder="Requires (comma-sep)" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                <input type="text" class="cond-exc" placeholder="Excludes (e.g. @clothing)" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
            </div>
            <div style="display:flex; gap:6px; justify-content: flex-end;">
                <button class="cond-add-fill-btn" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; font-size:11px; padding:6px 14px; border-radius:4px; font-weight:bold; cursor:pointer;">➕ Add Fill</button>
                <button class="cond-add-merge-btn" style="background:#5c1a1a; color:#ff6060; border:1px solid #7a222c; font-size:11px; padding:6px 14px; border-radius:4px; font-weight:bold; cursor:pointer;">➕ Add Merge</button>
            </div>
        `;
        
        const doAddAutoDo = async (isAutoFill) => {
            const keep = addRow.querySelector('.cond-keep').value.trim();
            const removeStr = addRow.querySelector('.cond-remove').value.trim();
            if (!removeStr) { if (window.showAlert) window.showAlert('Trigger Tags are required.', 'warn'); return; }
            const reqStr = addRow.querySelector('.cond-req').value; const excStr = addRow.querySelector('.cond-exc').value;
            const data = { keepTag: keep, removeTags: removeStr.split(',').map(t=>t.trim()).filter(t=>t), require: reqStr.split(',').map(t=>t.trim()).filter(t=>t), exclude: excStr.split(',').map(t=>t.trim()).filter(t=>t), isAutoFill: isAutoFill };
            await window.RulesDB.addRule('automerge', data, false); 
            await window.RulesCore.applyUserRulesToGlobals();
            window.RulesUI.refreshModalBody();
        };

        addRow.querySelector('.cond-add-fill-btn').onclick = () => doAddAutoDo(true);
        addRow.querySelector('.cond-add-merge-btn').onclick = () => doAddAutoDo(false);
        
        wrap.appendChild(addRow);
        return wrap;
    }

    window.RulesUI.registerSection(3, async (rows) => {
        const isEnabled = await window.getSetting('rm_auto_merge', false);
        return renderAutoMergeSection(rows, isEnabled);
    });

    /* ---------- RENOMEAR UM EMBED — ATUALIZA REFERÊNCIAS EM TODO LUGAR ----------
       Qualquer grupo que use "@nomeAntigo" (Conflicts/Similar/Highlights via
       tags[], Auto-Do via require[]/exclude[]) é reescrito pra "@nomeNovo".
       Sem isso, renomear um embed quebraria silenciosamente todo mundo que
       o referenciava — RulesCore.resolveGroupTags simplesmente ignora um
       @nome que não bate com nenhum embed existente. */
    window.renameEmbedReferencesEverywhere = async function (oldName, newName) {
        const oldRef = '@' + oldName.toLowerCase();
        const newRef = '@' + newName;
        const rows = await window.RulesDB.getAllRules();
        let changedCount = 0;

        for (const row of rows) {
            if (row.category === 'embed') continue;

            if (row.category === 'conflict' || row.category === 'similar') {
                const tags = Array.isArray(row.tags) ? row.tags : [];
                const newTags = tags.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                if (JSON.stringify(newTags) !== JSON.stringify(tags)) {
                    await window.RulesDB.updateRule(row.id, newTags);
                    changedCount++;
                }
            } else if (row.category === 'highlight') {
                const tags = Array.isArray(row.tags) ? row.tags : [];
                const newTags = tags.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                if (JSON.stringify(newTags) !== JSON.stringify(tags)) {
                    await window.RulesDB.updateRule(row.id, { name: row.name, tags: newTags, color: row.color });
                    changedCount++;
                }
            } else if (row.category === 'automerge') {
                const req = Array.isArray(row.require) ? row.require : [];
                const exc = Array.isArray(row.exclude) ? row.exclude : [];
                const newReq = req.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                const newExc = exc.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                if (JSON.stringify(newReq) !== JSON.stringify(req) || JSON.stringify(newExc) !== JSON.stringify(exc)) {
                    await window.RulesDB.updateRule(row.id, {
                        keepTag: row.keepTag, removeTags: row.removeTags,
                        require: newReq, exclude: newExc, isAutoFill: !!row.isAutoFill
                    });
                    changedCount++;
                }
            }
        }
        return changedCount;
    };

    // --- EMBEDS UI ---
    window.buildEmbedModal = function() {
        if (document.getElementById('modal-embed-manager')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-embed-manager'; overlay.className = 'modal-overlay'; overlay.style.zIndex = '105';
        overlay.onclick = () => window.closeModal('modal-embed-manager');
        overlay.innerHTML = `
            <div class="tool-modal" style="width: 500px; height: 600px; display:flex; flex-direction:column;" onclick="event.stopPropagation()">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <h3 style="margin:0 0 5px 0; font-size:16px;">📦 Custom Embeds</h3>
                    <button onclick="window.restoreEmbedDefaults()" title="Restore default embeds" style="background:transparent; border:none; color:#888; cursor:pointer; font-size:14px; padding:0; transition:0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#888'">🔄</button>
                </div>
                <div style="font-size:11px; color:#aaa; margin-bottom:15px;">Create custom groups of tags. Use <b>@name</b> in the Excludes/Requires of Advanced Rules.</div>
                <div id="embed-list-container" class="panel-list-scroll" style="flex:1; overflow-y:auto; background:#111; padding:10px; border:1px solid #333; border-radius:6px; display:flex; flex-direction:column; gap:8px;"></div>
                <div style="margin-top:15px; display:flex; flex-direction:column; gap:8px; background:#1b1b1b; padding:12px; border:1px solid #333; border-radius:6px;">
                    <div style="font-size:12px; color:#00ff99; font-weight:bold;">Create New Embed</div>
                    <input type="text" id="embed-add-name" placeholder="Name (e.g. clothing)" style="font-size:12px; background:#222; border:1px solid #444; padding:8px; border-radius:4px; color:#fff;">
                    <textarea id="embed-add-tags" placeholder="tag1, tag2, tag3..." style="font-size:12px; background:#222; border:1px solid #444; padding:8px; border-radius:4px; color:#fff; min-height:60px; resize:vertical;"></textarea>
                    <button onclick="window.addCustomEmbed()" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer;">➕ Save Embed</button>
                </div>
                <div class="modal-buttons" style="margin-top:15px;"><button class="btn-cancel" onclick="window.closeModal('modal-embed-manager')">Close</button></div>
            </div>
        `;
        document.body.appendChild(overlay);
    };

    window.openEmbedsManager = async function() { _embedEditingId = null; await window.refreshEmbedList(); window.openModal('modal-embed-manager'); };

    window.refreshEmbedList = async function() {
        const container = document.getElementById('embed-list-container');
        if (!container) return;
        const rows = await window.RulesDB.getAllRules();
        const embeds = rows.filter(r => r.category === 'embed');
        embeds.sort((a, b) => (a.isDefault === b.isDefault ? 0 : (a.isDefault ? -1 : 1)));
        
        container.innerHTML = '';
        if (embeds.length === 0) { container.innerHTML = '<div style="color:#555; font-size:12px; text-align:center; margin-top:20px;">No embeds created yet.</div>'; return; }

        embeds.forEach(emb => {
            const safeTags = Array.isArray(emb.tags) ? emb.tags : [];
            const el = document.createElement('div');

            if (_embedEditingId === emb.id) {
                /* ---------- MODO EDIÇÃO INLINE ----------
                   O card vira um formulário (nome + tags) com Update/Cancel,
                   no mesmo estilo visual do "Create New Embed" logo abaixo,
                   no lugar do antigo fluxo de 2 prompt()s. */
                el.style.cssText = 'background:#151515; border:1px solid #4a2a8c; border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:8px;';
                el.innerHTML = `
                    <div style="font-size:11px; color:#b890ff; font-weight:bold;">✏️ Editing @${window.RulesUI.escapeHTML(emb.name)}</div>
                    <input type="text" class="emb-edit-name" value="${window.RulesUI.escapeHTML(emb.name)}" placeholder="Name (e.g. clothing)" style="font-size:12px; background:#222; border:1px solid #444; padding:8px; border-radius:4px; color:#fff;">
                    <textarea class="emb-edit-tags" placeholder="tag1, tag2, tag3..." style="font-size:12px; background:#222; border:1px solid #444; padding:8px; border-radius:4px; color:#fff; min-height:70px; resize:vertical;">${window.RulesUI.escapeHTML(safeTags.join(', '))}</textarea>
                    <div style="display:flex; gap:6px; justify-content:flex-end;">
                        <button class="btn-emb-cancel" style="background:#222; border:1px solid #444; color:#aaa; font-size:11px; padding:6px 14px; border-radius:4px; cursor:pointer; font-weight:bold;">✖ Cancel</button>
                        <button class="btn-emb-update" style="background:#00aa66; border:none; color:#000; font-size:11px; padding:6px 14px; border-radius:4px; cursor:pointer; font-weight:bold;">✅ Update</button>
                    </div>
                `;

                el.querySelector('.btn-emb-cancel').onclick = () => {
                    _embedEditingId = null;
                    window.refreshEmbedList();
                };

                el.querySelector('.btn-emb-update').onclick = async () => {
                    const nameInput = el.querySelector('.emb-edit-name');
                    const tagsInput = el.querySelector('.emb-edit-tags');
                    const newName = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
                    const newTags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);

                    if (!newName) { if (window.showAlert) window.showAlert('Invalid embed name.', 'warn'); nameInput.focus(); return; }
                    if (newTags.length === 0) { if (window.showAlert) window.showAlert('At least 1 tag is required.', 'warn'); tagsInput.focus(); return; }

                    const oldName = emb.name;
                    await window.RulesDB.updateRule(emb.id, { name: newName, tags: newTags });

                    let renamedRefsCount = 0;
                    if (newName !== oldName) renamedRefsCount = await window.renameEmbedReferencesEverywhere(oldName, newName);

                    _embedEditingId = null;
                    await window.RulesCore.applyUserRulesToGlobals();
                    await window.refreshEmbedList();
                    if (document.getElementById('modal-conflict-manager') && document.getElementById('modal-conflict-manager').classList.contains('active')) {
                        await window.RulesUI.refreshModalBody();
                    }

                    if (window.showAlert) {
                        window.showAlert(
                            renamedRefsCount > 0
                                ? `Embed renamed to @${newName}. Updated ${renamedRefsCount} rule(s) that referenced @${oldName}.`
                                : `Embed @${newName} updated!`,
                            'success'
                        );
                    }
                };

            } else {
                /* ---------- MODO NORMAL (exibição) ---------- */
                const badge = emb.isDefault ? '<span style="background:#2a2a2a; color:#aaa; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #444; margin-right:6px;">Original</span>' : '<span style="background:#1a4d2e; color:#4caf50; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2e7d32; margin-right:6px;">Custom</span>';
                el.style.cssText = 'background:#151515; border:1px solid #2a2a2a; border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:8px;';
                el.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>${badge}<span style="font-size:14px; font-weight:bold; color:#b890ff;">@${window.RulesUI.escapeHTML(emb.name)}</span></div>
                        <div style="display:flex; gap:6px;">
                            <button class="btn-emb-edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:11px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️ Edit</button>
                            <button class="btn-emb-del" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:11px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                        </div>
                    </div>
                    <div style="font-size:11px; color:#aaa; line-height:1.4; word-break:break-word;">${window.RulesUI.escapeHTML(safeTags.join(', '))}</div>
                `;

                el.querySelector('.btn-emb-edit').onclick = () => {
                    _embedEditingId = emb.id;
                    window.refreshEmbedList();
                };

                el.querySelector('.btn-emb-del').onclick = async () => {
                    if (!confirm(`Delete embed @${emb.name}?`)) return;
                    await window.RulesDB.deleteRule(emb.id);
                    window.refreshEmbedList();
                };
            }

            container.appendChild(el);
        });
    };

    window.addCustomEmbed = async function() {
        const nameInput = document.getElementById('embed-add-name'); const tagsInput = document.getElementById('embed-add-tags');
        let name = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''); let tags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);
        if (!name || tags.length === 0) { if(window.showAlert) window.showAlert('Please provide a valid name and tags.', 'warn'); return; }
        await window.RulesDB.addRule('embed', { name: name, tags: tags }, false);
        nameInput.value = ''; tagsInput.value = '';
        window.refreshEmbedList();
        if(window.showAlert) window.showAlert(`Embed @${name} saved!`, 'success');
    };

    window.restoreEmbedDefaults = async function() {
        if (!confirm(`Restore original default embeds?\n\n- Your custom embeds will be kept.`)) return;
        let deletedDefaults = await window.getSetting('deleted-default-rules', []);
        if (!Array.isArray(deletedDefaults)) deletedDefaults = [];
        const embDefIds = window.RulesDB.getFactoryRules().filter(r => r.category === 'embed').map(r => r.id);
        deletedDefaults = deletedDefaults.filter(id => !embDefIds.includes(id));
        await window.saveSetting('deleted-default-rules', deletedDefaults);
        await window.RulesCore.applyUserRulesToGlobals();
        window.refreshEmbedList();
        if (window.showAlert) window.showAlert(`Embed defaults restored!`, 'success');
    };
})();