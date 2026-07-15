/* =========================================================================
   CONFLICT / SIMILARITY / AUTO-MERGE MANAGER (USER-DEFINED RULES) - v10
   ---------------------------------------------------------------------
   Standalone — Checkboxes individuais para cada módulo, Auto-Merge
   independente (roda no load ou manualmente) e botão mestre refeito.
========================================================================= */

(function () {

    // ---------------------------------------------------------------------
    // INTEGRATED FACTORY DEFAULTS
    // ---------------------------------------------------------------------
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

    const FACTORY_SIMILAR = [
        ['happy', 'smile', 'smiling', 'grin', 'laughing'],
        ['sad', 'crying', 'tears', 'frowning'],
        ['angry', 'annoyed', 'scowl', 'glaring'],
        ['expressionless', 'blank stare', 'emotionless'],
        ['shocked', 'wide-eyed'],
        ['closed mouth', 'parted lips', 'open mouth'],
        ['crouching', 'squatting'],
        ['short hair', 'medium hair', 'long hair', 'very long hair', 'absurdly long hair'],
        ['blonde hair', 'red hair', 'brown hair', 'black hair', 'blue hair', 'purple hair', 'pink hair', 'green hair', 'white hair', 'silver hair', 'grey hair'],
        ['flat chest', 'small breasts', 'medium breasts', 'large breasts', 'huge breasts', 'gigantic breasts'],
        ['nude', 'completely nude', 'topless', 'bottomless', 'naked'],
        ['portrait', 'close-up', 'cowboy shot', 'upper body', 'full body'],
        ['from above', 'from below', 'from behind', 'from side'],
        ['dutch angle', 'tilted frame']
    ];

    /* ---------- INDEXEDDB ---------- */
    const dbName = 'ConflictRulesDB';
    const storeName = 'rules'; 

    function initDB() {
        return new Promise((res, rej) => {
            try {
                const req = indexedDB.open(dbName, 1);
                req.onupgradeneeded = e => {
                    if (!e.target.result.objectStoreNames.contains(storeName)) {
                        e.target.result.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                    }
                };
                req.onsuccess = e => res(e.target.result);
                req.onerror = e => rej(e.target.error);
            } catch (err) { rej(err); }
        });
    }

    async function getAllRules() {
        try {
            const db = await initDB();
            return new Promise(r => {
                const tx = db.transaction(storeName, 'readonly');
                const req = tx.objectStore(storeName).getAll();
                req.onsuccess = () => r((req.result || []).filter(item => item && Array.isArray(item.tags)));
                req.onerror = () => r([]);
            });
        } catch (e) { return []; }
    }

    async function addRule(category, tags, isDefault = false) {
        try {
            const db = await initDB();
            return new Promise(r => {
                const tx = db.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).add({ category, tags, isDefault });
                tx.oncomplete = () => r(true);
                tx.onerror = () => r(false);
            });
        } catch (e) { return false; }
    }

    async function updateRule(id, tags) {
        try {
            const db = await initDB();
            return new Promise(r => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const getReq = store.get(id);
                getReq.onsuccess = () => {
                    const item = getReq.result;
                    if (item) { item.tags = tags; store.put(item); }
                };
                tx.oncomplete = () => r(true);
                tx.onerror = () => r(false);
            });
        } catch (e) { return false; }
    }

    async function deleteRule(id) {
        try {
            const db = await initDB();
            return new Promise(r => {
                const tx = db.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).delete(id);
                tx.oncomplete = () => r(true);
                tx.onerror = () => r(false);
            });
        } catch (e) { return false; }
    }

    async function clearDefaultRulesFromDB() {
        const rules = await getAllRules();
        for (let r of rules) {
            if (r.isDefault) await deleteRule(r.id);
        }
    }

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
    }

    /* ---------- AUTO-MERGE ENGINE (INDEPENDENT) ---------- */
    function buildAutoMergeRunner(group) {
        const canonical = group[0];
        const groupLower = group.map(g => g.toLowerCase());
        return function (tagsArray) {
            const present = tagsArray.filter(t => groupLower.includes(t.toLowerCase()));
            if (present.length < 2) return null; 

            let inserted = false;
            const newTags = [];
            tagsArray.forEach(t => {
                if (groupLower.includes(t.toLowerCase())) {
                    if (!inserted) { newTags.push(canonical); inserted = true; }
                } else { newTags.push(t); }
            });
            return [...new Set(newTags)];
        };
    }

    window.runAutoMergeOnDataset = async function(manual = false) {
        // Se a engrenagem mestre estiver desativada, bloqueia a execução
        if (window.enableConflictWarnings === false) return;
        
        if (!window.imageFiles || window.imageFiles.length === 0) {
            if (manual && window.showAlert) window.showAlert('No dataset loaded.', 'warn');
            return;
        }
        
        const rows = await getAllRules();
        const amGroups = rows.filter(r => r.category === 'automerge').map(r => r.tags);
        
        if (amGroups.length === 0) {
            if (manual && window.showAlert) window.showAlert('No Auto-Merge rules configured.', 'warn');
            return;
        }

        const runners = amGroups.map(buildAutoMergeRunner);
        let changedCount = 0;
        let modifiedFiles = [];

        window.imageFiles.forEach(img => {
            if (img.type === 'tags' && img.content && !img.hidden) {
                let originalTags = img.content.split(',').map(t => t.trim()).filter(t => t);
                let currentTags = [...originalTags];
                
                runners.forEach(runner => {
                    const result = runner(currentTags);
                    if (result) currentTags = result;
                });

                if (originalTags.join(',') !== currentTags.join(',')) {
                    img.content = currentTags.join(', ');
                    img.hasFile = true;
                    modifiedFiles.push(img);
                    changedCount++;
                }
            }
        });

        if (changedCount > 0) {
            if (typeof window.markDirty === 'function') window.markDirty(modifiedFiles);
            if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
            
            // Reconstrói a lista global de tags
            if (window.masterTagSet) {
                window.masterTagSet.clear();
                window.imageFiles.forEach(img => {
                    if(img.type === 'tags' && img.content) img.content.split(',').forEach(t => { if(t.trim()) window.masterTagSet.add(t.trim()); });
                });
            }

            if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
            if (typeof window.renderImageList === 'function') window.renderImageList();
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            if (typeof window.renderEditor === 'function') window.renderEditor();
            if (typeof window.applyFilters === 'function') window.applyFilters();
            
            if (window.showAlert) window.showAlert(`Auto-Merge applied to ${changedCount} image(s)!`, 'success');
        } else {
            if (manual && window.showAlert) window.showAlert('No matching tags found to merge.', 'info');
        }
    };

    /* ---------- HOOK DE CARREGAMENTO AUTOMÁTICO ---------- */
    let _lastImageFilesRef = null;
    function hookAutoMergeLoader() {
        if (window._autoMergeHooked) return;
        const _origRender = window.renderImageList;
        if (typeof _origRender === 'function') {
            window.renderImageList = function() {
                if (window.imageFiles && window.imageFiles !== _lastImageFilesRef) {
                    _lastImageFilesRef = window.imageFiles;
                    
                    const autoRun = localStorage.getItem('rm_auto_merge') === 'true';
                    if (autoRun && window.enableConflictWarnings !== false) {
                        setTimeout(() => window.runAutoMergeOnDataset(false), 100);
                    }
                }
                return _origRender.apply(this, arguments);
            };
            window._autoMergeHooked = true;
        }
    }

    /* ---------- INTERCEPTAÇÃO DO SISTEMA ORIGINAL ---------- */
    function overrideOriginalSystems() {
        // 1. Remove/Esconde o botão Custom Rules nativo
        const customRulesBtn = document.getElementById('btn-custom-rules');
        if (customRulesBtn) {
            customRulesBtn.style.display = 'none';
            customRulesBtn.id = 'btn-custom-rules-removed';
        }
        window.customTagRules = []; // Esvazia permanentemente qualquer resquício

        // 2. Modifica o botão da engrenagem para ser o Disjuntor Mestre
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
                    
                    applyUserRulesToGlobals();
                });
            }
        }
    }

    async function checkAndInstallFactoryDefaults() {
        const flag = 'rulesManager_v10_Installed';
        if (localStorage.getItem(flag)) return;

        const existingRules = await getAllRules();
        for (let r of existingRules) {
            if (r.isDefault) await deleteRule(r.id);
        }

        for (let tags of FACTORY_CONFLICTS) await addRule('conflict', tags, true);
        for (let tags of FACTORY_SIMILAR) await addRule('similar', tags, true);

        localStorage.setItem(flag, 'true');
    }

    async function applyUserRulesToGlobals() {
        await checkAndInstallFactoryDefaults();

        // Se o mestre estiver desligado, tudo vira vazio
        if (window.enableConflictWarnings === false) {
            window.tagConflicts = [];
            window.tagSimilar = [];
        } else {
            const rows = await getAllRules();
            window._userConflictRules = rows;

            const isRedEnabled = localStorage.getItem('rm_enable_red') !== 'false';
            const isYellowEnabled = localStorage.getItem('rm_enable_yellow') !== 'false';

            window.tagConflicts = isRedEnabled ? rows.filter(r => r.category === 'conflict').map(r => r.tags) : [];
            window.tagSimilar = isYellowEnabled ? rows.filter(r => r.category === 'similar').map(r => r.tags) : [];
        }

        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.renderPresetTags === 'function') window.renderPresetTags();
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
    }

    window.reloadUserConflictRules = applyUserRulesToGlobals;

    window.restoreDefaultRules = async function() {
        if (!confirm('Restore original default rules?\n\n- Your edits to original rules will be lost.\n- Your fully custom rules WILL BE KEPT intact!')) return;
        await clearDefaultRulesFromDB();
        localStorage.removeItem('rulesManager_v10_Installed');
        await applyUserRulesToGlobals();
        if (document.getElementById('modal-conflict-manager')) await refreshModalBody(); 
        if (window.showAlert) window.showAlert('Original rules restored successfully!', 'success');
    };

    window.clearAllRules = async function() {
        if (!confirm('WARNING: This will delete ALL rules (both defaults and yours).\nAre you sure?')) return;
        const rows = await getAllRules();
        for (let r of rows) await deleteRule(r.id);
        await applyUserRulesToGlobals();
        await refreshModalBody();
        if (window.showAlert) window.showAlert('All rules have been deleted.', 'success');
    };

    /* ---------- UI (INTERFACE) ---------- */
    const CATEGORY_META = {
        conflict: { 
            label: '🚨 Conflicts (Red)', 
            color: '#ff6060', 
            hint: 'Tags that must never coexist in the same image.',
            desc: 'Prevents contradictory tags. Highlights them in red to warn you of a logical error.'
        },
        similar: { 
            label: '🟨 Similar (Yellow)', 
            color: '#ffcc66', 
            hint: 'Redundant tags that trigger a visual warning.',
            desc: 'Groups synonymous or overlapping tags. Highlights them in yellow to suggest keeping only one.'
        },
        automerge: { 
            label: '⚡ Auto-Merge', 
            color: '#00ff99', 
            hint: 'Automatically consolidates redundant tags.',
            desc: "If 2+ tags from the group exist in an image, they are merged into the <b>FIRST</b> tag of the list.<br><br><span style='background:#111; padding:4px 6px; border-radius:4px; border:1px solid #222; display:block; color:#ccc;'><b style='color:#fff'>Example:</b> [bikini, swimwear]<br>➡️ If both exist, <i>swimwear</i> is removed.</span>"
        }
    };

    const modalStyle = document.createElement('style');
    modalStyle.innerHTML = `
        #modal-conflict-manager .tool-modal { width: 95vw !important; max-width: 1300px !important; height: 85vh !important; display: flex; flex-direction: column; padding: 20px; }
        #modal-conflict-manager .conflict-group-item { transition: 0.1s; }
        #modal-conflict-manager .conflict-group-item:hover { background: #222 !important; }
        #modal-conflict-manager .conflict-add-btn:hover { background: #1e4a78 !important; color: #fff !important; }
        #modal-conflict-manager .btn-top-action { background: #333; color: #fff; border: 1px solid #555; padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; transition: 0.2s; font-weight: bold; }
        #modal-conflict-manager .btn-top-action:hover { background: #555; border-color: #777; }
        #modal-conflict-manager .panel-list-scroll::-webkit-scrollbar { width: 6px; }
        #modal-conflict-manager .panel-list-scroll::-webkit-scrollbar-track { background: #111; }
        #modal-conflict-manager .panel-list-scroll::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
        #modal-conflict-manager .panel-list-scroll::-webkit-scrollbar-thumb:hover { background: #00aa66; }
    `;
    document.head.appendChild(modalStyle);

    function buildModal() {
        if (document.getElementById('modal-conflict-manager')) return;

        const overlay = document.createElement('div');
        overlay.id = 'modal-conflict-manager';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-conflict-manager');

        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-shrink: 0;">
                    <div>
                        <h3 style="margin:0 0 5px 0; border:none; padding:0; font-size:18px;">🧩 Manage Rules</h3>
                        <div style="font-size:11px; color:#888; margin-bottom:10px;">
                            Create, edit, or remove groups freely organized in columns.
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-top-action" onclick="window.restoreDefaultRules()" title="Restore original factory defaults">🔄 Restore Defaults</button>
                        <button class="btn-top-action" onclick="window.clearAllRules()" style="color:#ff6060; border-color:#7a222c;" title="Delete all rules">🗑️ Clear All</button>
                    </div>
                </div>

                <div id="conflict-manager-body" style="flex:1; display:flex; flex-direction:row; gap:15px; overflow:hidden; margin-top: 10px; margin-bottom: 15px;"></div>
                
                <div class="modal-buttons" style="flex-shrink:0; border-top: 1px solid #333; padding-top: 15px;">
                    <button class="btn-cancel" style="background:#333; color:#fff;" onclick="window.closeModal('modal-conflict-manager')">Close Interface</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    function renderCategorySection(category, rows) {
        const meta = CATEGORY_META[category];
        const categoryRows = rows.filter(r => r.category === category);

        const wrap = document.createElement('div');
        wrap.className = 'panel';
        wrap.style.cssText = 'flex: 1; display: flex; flex-direction: column; background: #1b1b1b; border: 1px solid #222; border-radius: 10px; overflow: hidden;';

        const header = document.createElement('div');
        header.className = 'panel-header';
        header.style.cssText = `background: #222; padding: 12px 15px; font-size: 13px; font-weight: bold; color: ${meta.color}; border-bottom: 1px solid #333; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;`;
        
        // CHECKBOXES DE CONTROLE INJETADOS NO CABEÇALHO
        if (category === 'conflict') {
            const isRedEnabled = localStorage.getItem('rm_enable_red') !== 'false';
            header.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="cb-red-enable" ${isRedEnabled ? 'checked' : ''} style="margin:0; cursor:pointer;" title="Enable/Disable conflict warnings">
                    <span>${meta.label}</span>
                </div>
                <span style="background:#111; color:#aaa; padding:3px 8px; border-radius:6px; font-size:11px; border:1px solid #333;">${categoryRows.length} groups</span>
            `;
            setTimeout(() => {
                const cb = document.getElementById('cb-red-enable');
                if (cb) cb.onchange = (e) => { localStorage.setItem('rm_enable_red', e.target.checked); applyUserRulesToGlobals(); };
            }, 0);
        } 
        else if (category === 'similar') {
            const isYellowEnabled = localStorage.getItem('rm_enable_yellow') !== 'false';
            header.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="cb-yellow-enable" ${isYellowEnabled ? 'checked' : ''} style="margin:0; cursor:pointer;" title="Enable/Disable similar warnings">
                    <span>${meta.label}</span>
                </div>
                <span style="background:#111; color:#aaa; padding:3px 8px; border-radius:6px; font-size:11px; border:1px solid #333;">${categoryRows.length} groups</span>
            `;
            setTimeout(() => {
                const cb = document.getElementById('cb-yellow-enable');
                if (cb) cb.onchange = (e) => { localStorage.setItem('rm_enable_yellow', e.target.checked); applyUserRulesToGlobals(); };
            }, 0);
        }
        else if (category === 'automerge') {
            const isAutoEnabled = localStorage.getItem('rm_auto_merge') === 'true';
            header.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="cb-auto-merge" ${isAutoEnabled ? 'checked' : ''} style="margin:0; cursor:pointer;" title="Auto-Run when a folder finishes loading">
                    <span title="Auto-Run when a folder finishes loading" style="color: #00ff99;">Auto Merge</span>
                </div>
                <span style="background:#111; color:#aaa; padding:3px 8px; border-radius:6px; font-size:11px; border:1px solid #333;">${categoryRows.length} groups</span>
            `;
            setTimeout(() => {
                const cb = document.getElementById('cb-auto-merge');
                if (cb) cb.onchange = (e) => localStorage.setItem('rm_auto_merge', e.target.checked);
            }, 0);
        }

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
            empty.textContent = 'No groups in this category.';
            list.appendChild(empty);
        }

        categoryRows.forEach(row => {
            const item = document.createElement('div');
            item.className = 'conflict-group-item';
            item.style.cssText = `display:flex; align-items:center; gap:8px; background:#151515; border:1px solid #2a2a2a; border-left:3px solid ${meta.color}; border-radius:6px; padding:8px 10px;`;
            
            const badge = row.isDefault
                ? '<span style="background:#2a2a2a; color:#aaa; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #444;" title="Original default rule">Original</span>'
                : '<span style="background:#1a4d2e; color:#4caf50; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2e7d32;" title="Created by you">Custom</span>';

            const safeTagsText = escapeHTML(row.tags.join(', '));

            item.innerHTML = `
                <div style="flex:1; display:flex; flex-direction: column; gap: 4px; overflow: hidden;">
                    <div>${badge}</div>
                    <span style="font-size:12px; color:#ddd; word-break:break-word; line-height: 1.3;">${safeTagsText}</span>
                </div>
                <div style="display:flex; flex-direction: column; gap:4px; flex-shrink:0;">
                    <button class="btn-conflict-edit" title="Edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️</button>
                    <button class="btn-conflict-delete" title="Delete" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                </div>
            `;
            
            item.querySelector('.btn-conflict-edit').onclick = async () => {
                const input = prompt('Edit group (comma-separated tags):', row.tags.join(', '));
                if (input === null) return;
                const tags = input.split(',').map(t => t.trim()).filter(t => t);
                if (tags.length < 2) { if (window.showAlert) window.showAlert('A group needs at least 2 tags.', 'warn'); return; }
                await updateRule(row.id, tags); 
                await applyUserRulesToGlobals();
                refreshModalBody();
            };
            item.querySelector('.btn-conflict-delete').onclick = async () => {
                if (!confirm('Remove this group?')) return;
                await deleteRule(row.id);
                await applyUserRulesToGlobals();
                refreshModalBody();
            };
            list.appendChild(item);
        });

        wrap.appendChild(list);

        // BOTÃO MANUAL DO AUTO-MERGE INJETADO APENAS NA COLUNA DELE
        if (category === 'automerge') {
            const runWrap = document.createElement('div');
            runWrap.style.cssText = 'padding: 12px 15px 0 15px; background: #111; border-top: 1px solid #222; flex-shrink: 0;';
            runWrap.innerHTML = `<button style="background:#00aa66; color:#000; border:1px solid #00cc88; font-size:12px; padding:8px; border-radius:6px; font-weight:bold; cursor:pointer; width:100%; transition:0.2s;" onclick="window.runAutoMergeOnDataset(true)">▶ Run Auto-Merge Now</button>`;
            wrap.appendChild(runWrap);
        }

        const addRow = document.createElement('div');
        addRow.className = 'inline-add-box';
        addRow.style.cssText = 'display: flex; gap: 8px; padding: 12px 15px; background: #111; align-items: center; flex-shrink: 0; border-top: ' + (category === 'automerge' ? 'none' : '1px solid #222') + ';';
        
        addRow.innerHTML = `
            <input type="text" class="conflict-add-input" placeholder="tag1, tag2..." style="flex:1; font-size:12px; background:#222; border:1px solid #444; padding:8px 10px; border-radius:6px; color:#fff; outline:none;">
            <button class="conflict-add-btn" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; font-size:12px; padding:8px 12px; border-radius:6px; flex-shrink:0; font-weight:bold; cursor:pointer; transition:0.2s;">➕ Add</button>
        `;
        
        const input = addRow.querySelector('.conflict-add-input');
        const addBtn = addRow.querySelector('.conflict-add-btn');
        
        const doAdd = async () => {
            const tags = input.value.split(',').map(t => t.trim()).filter(t => t);
            if (tags.length < 2) { if (window.showAlert) window.showAlert('A group needs at least 2 tags.', 'warn'); return; }
            await addRule(category, tags, false); 
            input.value = '';
            await applyUserRulesToGlobals();
            refreshModalBody();
        };
        
        addBtn.onclick = doAdd;
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };
        
        wrap.appendChild(addRow);

        return wrap;
    }

    async function refreshModalBody() {
        const body = document.getElementById('conflict-manager-body');
        if (!body) return;
        const rows = await getAllRules();
        body.innerHTML = '';
        
        body.appendChild(renderCategorySection('conflict', rows));
        body.appendChild(renderCategorySection('similar', rows));
        body.appendChild(renderCategorySection('automerge', rows));
    }

    window.openConflictManager = async function () {
        buildModal();
        await refreshModalBody();
        window.openModal('modal-conflict-manager');
    };

    function injectButton() {
        // Esconde o botão Custom Rules nativo
        const customRulesBtn = document.getElementById('btn-custom-rules');
        if (customRulesBtn) customRulesBtn.style.display = 'none';

        const rightBar = document.getElementById('topbar-right');
        const anchor = document.getElementById('btn-settings'); // Usa o settings como âncora já que o custom rules foi de base
        if (!rightBar || !anchor || document.getElementById('btn-conflict-manager')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-conflict-manager';
        btn.title = 'Manage tag rules and automations';
        btn.textContent = '🧩 Manage Rules';
        btn.onclick = () => window.openConflictManager();
        
        // Esconde o botão se a engrenagem mestre estiver desligada na inicialização
        if (window.enableConflictWarnings === false) btn.style.display = 'none';
        
        rightBar.insertBefore(btn, anchor);
    }

    window.addEventListener('DOMContentLoaded', async () => {
        setTimeout(() => {
            overrideOriginalSystems();
            injectButton();
            hookAutoMergeLoader();
        }, 0);
        await applyUserRulesToGlobals();
    });

})();