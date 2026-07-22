/* =========================================================================
   CONFLICT / SIMILARITY / AUTO-MERGE MANAGER - v16
   ---------------------------------------------------------------------
   Standalone — Integra Conflitos, Similares e um Auto-Merge unificado.
   Com botões de "Restore Defaults" individuais por categoria e 
   ordenação que mantém regras Originais sempre no topo.
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

    const FACTORY_EMBEDS = [
        { 
            name: 'clothing', 
            tags: ['shirt', 'dress', 'skirt', 'pants', 'shorts', 'jeans', 'jacket', 'coat', 'sweater', 'hoodie', 'cardigan', 'vest', 'blazer', 'uniform', 'suit', 'kimono', 'robe', 'gown', 'swimsuit', 'bikini', 'lingerie', 'underwear', 'panties', 'bra', 'boxers', 'briefs', 'socks', 'thighhighs', 'pantyhose', 'stockings', 'leggings', 'gloves', 'mittens', 'scarf', 'tie', 'necktie', 'bowtie', 'collar', 'hat', 'cap', 'hood', 'veil', 'mask', 'apron', 'overalls', 'romper', 'leotard', 'bodysuit', 'top', 'blouse', 'tank top', 'crop top', 'tube top', 'camisole', 'corset', 'harness', 'belt', 'shoes', 'boots', 'sandals', 'heels', 'sneakers', 'slippers', 'armor', 'clothes', 'clothing', 'outfit', 'costume'] 
        }
    ];

    /* ---------- INDEXEDDB ---------- */
    const dbName = 'ConflictRulesDB';
    const storeName = 'rules'; 

    function initDB() {
        return new Promise((res, rej) => {
            try {
                const req = indexedDB.open(dbName, 4);
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
                req.onsuccess = () => r(req.result || []);
                req.onerror = () => r([]);
            });
        } catch (e) { return []; }
    }

    async function addRule(category, data, isDefault = false) {
        try {
            const db = await initDB();
            return new Promise(r => {
                const tx = db.transaction(storeName, 'readwrite');
                if (data.keepTag !== undefined || data.name !== undefined) {
                    tx.objectStore(storeName).add({ category, ...data, isDefault });
                } else {
                    tx.objectStore(storeName).add({ category, tags: data, isDefault });
                }
                tx.oncomplete = () => r(true);
                tx.onerror = () => r(false);
            });
        } catch (e) { return false; }
    }

    async function updateRule(id, data) {
        try {
            const db = await initDB();
            return new Promise(r => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const getReq = store.get(id);
                getReq.onsuccess = () => {
                    const item = getReq.result;
                    if (item) { 
                        if (data.name !== undefined) {
                            item.name = data.name;
                            item.tags = data.tags;
                        } else if (data.keepTag !== undefined) {
                            item.keepTag = data.keepTag;
                            item.removeTags = data.removeTags;
                            item.require = data.require;
                            item.exclude = data.exclude;
                            delete item.tags; delete item.target; delete item.fallback;
                        } else {
                            item.tags = data; 
                        }
                        store.put(item); 
                    }
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

    /* ---------- ENGINE & EMBED RESOLVER ---------- */
    
    function matchTag(tag, condition, embeds) {
        const t = tag.toLowerCase();
        const c = condition.toLowerCase();
        if (c.startsWith('@')) {
            const embedName = c.slice(1);
            const embed = embeds.find(e => e.name.toLowerCase() === embedName);
            if (embed) {
                return embed.tags.some(eTag => eTag.toLowerCase() === t);
            }
            return false;
        }
        return t === c;
    }

    function runAutoMergeRule(tagsArray, rule, embeds) {
        const presentRemoves = rule.removeTags.filter(rem => 
            tagsArray.some(t => t.toLowerCase() === rem.toLowerCase())
        );
        
        if (presentRemoves.length === 0) return null; 

        let hasRequired = true;
        if (rule.require && rule.require.length > 0) {
            hasRequired = rule.require.every(req => tagsArray.some(t => matchTag(t, req, embeds)));
        }

        let hasExcluded = false;
        if (rule.exclude && rule.exclude.length > 0) {
            hasExcluded = tagsArray.some(t => {
                return rule.exclude.some(ex => matchTag(t, ex, embeds));
            });
        }

        if (hasRequired && !hasExcluded) {
            let newTags = tagsArray.filter(t => 
                !rule.removeTags.some(rem => rem.toLowerCase() === t.toLowerCase())
            );
            if (rule.keepTag && rule.keepTag.trim() !== '') {
                newTags.push(rule.keepTag.trim());
            }
            return [...new Set(newTags)];
        }
        
        return null;
    }

    window.runAutoMergeOnDataset = async function(manual = false) {
        if (window.enableConflictWarnings === false) return;
        
        if (!window.imageFiles || window.imageFiles.length === 0) {
            if (manual && window.showAlert) window.showAlert('No dataset loaded.', 'warn');
            return;
        }
        
        const rows = await getAllRules();
        
        const amRules = rows.filter(r => r.category === 'automerge').map(row => {
            if (row.tags) return { keepTag: row.tags[0], removeTags: row.tags.slice(1), require: [], exclude: [] };
            if (row.target) return { keepTag: row.fallback, removeTags: [row.target], require: row.exclude || [], exclude: row.require || [] };
            return row;
        });

        const embeds = rows.filter(r => r.category === 'embed');
        
        if (amRules.length === 0) {
            if (manual && window.showAlert) window.showAlert('No Auto-Merge rules configured.', 'warn');
            return;
        }

        let changedCount = 0;
        let modifiedFiles = [];

        window.imageFiles.forEach(img => {
            if (img.type === 'tags' && img.content && !img.hidden) {
                let originalTags = img.content.split(',').map(t => t.trim()).filter(t => t);
                let currentTags = [...originalTags];
                
                amRules.forEach(rule => {
                    const result = runAutoMergeRule(currentTags, rule, embeds);
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
            if (manual && window.showAlert) window.showAlert('No matching tags found to automate.', 'info');
        }
    };

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

    function overrideOriginalSystems() {
        const customRulesBtn = document.getElementById('btn-custom-rules');
        if (customRulesBtn) {
            customRulesBtn.style.display = 'none';
            customRulesBtn.id = 'btn-custom-rules-removed';
        }
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
                    
                    applyUserRulesToGlobals();
                });
            }
        }
    }

    async function checkAndInstallFactoryDefaults() {
        const flag = 'rulesManager_v16_Installed';
        if (localStorage.getItem(flag)) return;

        const existingRules = await getAllRules();
        for (let r of existingRules) {
            if (r.isDefault) await deleteRule(r.id);
        }

        for (let tags of FACTORY_CONFLICTS) await addRule('conflict', tags, true);
        for (let tags of FACTORY_SIMILAR) await addRule('similar', tags, true);
        
        for (let embed of FACTORY_EMBEDS) await addRule('embed', embed, true);

        await addRule('automerge', {
            keepTag: 'nude',
            removeTags: ['completely nude'],
            require: [],
            exclude: ['full body', '@clothing']
        }, true);
        
        await addRule('automerge', {
            keepTag: 'completely nude',
            removeTags: ['nude'],
            require: ['full body'],
            exclude: ['@clothing']
        }, true);

        localStorage.setItem(flag, 'true');
    }

    async function applyUserRulesToGlobals() {
        await checkAndInstallFactoryDefaults();

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
        if (!confirm('Restore ALL original default rules across ALL categories?\n\n- Your custom rules & embeds WILL BE KEPT intact!')) return;
        await clearDefaultRulesFromDB();
        localStorage.removeItem('rulesManager_v16_Installed');
        await applyUserRulesToGlobals();
        if (document.getElementById('modal-conflict-manager')) await refreshModalBody(); 
        if (window.showAlert) window.showAlert('All original rules restored successfully!', 'success');
    };

    window.restoreCategoryDefaults = async function(category) {
        const catName = category.charAt(0).toUpperCase() + category.slice(1);
        if (!confirm(`Restore original default rules for ${catName} only?\n\n- Your custom rules in this category will be kept.`)) return;
        
        const rows = await getAllRules();
        for (let r of rows) {
            if (r.category === category && r.isDefault) await deleteRule(r.id);
        }
        
        if (category === 'conflict') {
            for (let tags of FACTORY_CONFLICTS) await addRule('conflict', tags, true);
        } else if (category === 'similar') {
            for (let tags of FACTORY_SIMILAR) await addRule('similar', tags, true);
        } else if (category === 'automerge') {
            await addRule('automerge', { keepTag: 'nude', removeTags: ['completely nude'], require: [], exclude: ['full body', '@clothing'] }, true);
            await addRule('automerge', { keepTag: 'completely nude', removeTags: ['nude'], require: ['full body'], exclude: ['@clothing'] }, true);
        }

        await applyUserRulesToGlobals();
        if (document.getElementById('modal-conflict-manager')) await refreshModalBody();
        if (window.showAlert) window.showAlert(`${catName} defaults restored!`, 'success');
    };

    window.clearAllRules = async function() {
        if (!confirm('WARNING: This will delete ALL rules and embeds.\nAre you sure?')) return;
        const rows = await getAllRules();
        for (let r of rows) await deleteRule(r.id);
        await applyUserRulesToGlobals();
        await refreshModalBody();
        if (window.showAlert) window.showAlert('All rules have been deleted.', 'success');
    };

    /* ---------- UI (INTERFACE PRINCIPAL) ---------- */
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
            label: '⚡ Auto-Merge (Unified)', 
            color: '#00ff99', 
            hint: 'Consolidates redundant tags and applies advanced conditional checks.',
            desc: 'If ANY of the Remove Tags exist in the image, it removes them and adds the Main Tag (provided conditions are met).'
        }
    };

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
                        <h3 style="margin:0 0 5px 0; border:none; padding:0; font-size:18px;">🧩 Manage Tag Rules & Automations</h3>
                        <div style="font-size:11px; color:#888; margin-bottom:10px;">
                            Control UI warnings and automatic dataset operations.
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-top-action" onclick="window.runAutoMergeOnDataset(true)" style="background:#00aa66; border-color:#00cc88; color:#000;">▶ Run Auto-Merge Now</button>
                        <button class="btn-top-action" onclick="window.restoreDefaultRules()">🔄 Restore ALL Defaults</button>
                        <button class="btn-top-action" onclick="window.clearAllRules()" style="color:#ff6060; border-color:#7a222c;">🗑️ Clear All</button>
                    </div>
                </div>

                <div id="conflict-manager-body" style="flex:1; display:flex; flex-direction:row; gap:15px; overflow:hidden; margin-top: 10px; margin-bottom: 15px;"></div>
                
                <div class="modal-buttons" style="flex-shrink:0; border-top: 1px solid #333; padding-top: 15px; display: flex; justify-content: space-between;">
                    <button class="btn-top-action" style="background:#2f1a5c; color:#b890ff; border-color:#4a2a8c; padding: 8px 16px; font-size: 13px;" onclick="window.openEmbedsManager()">📦 Manage Custom Embeds (@groups)</button>
                    <button class="btn-cancel" style="background:#333; color:#fff;" onclick="window.closeModal('modal-conflict-manager')">Close Interface</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        buildEmbedModal();
    }

    function renderCategorySection(category, rows) {
        const meta = CATEGORY_META[category];
        const categoryRows = rows.filter(r => r.category === category);
        
        // ORDENAÇÃO: Originais sempre ficam no topo
        categoryRows.sort((a, b) => {
            if (a.isDefault === b.isDefault) return 0;
            return a.isDefault ? -1 : 1;
        });

        const wrap = document.createElement('div');
        wrap.className = 'panel';
        wrap.style.cssText = 'flex: 1; display: flex; flex-direction: column; background: #1b1b1b; border: 1px solid #222; border-radius: 10px; overflow: hidden;';

        const header = document.createElement('div');
        header.className = 'panel-header';
        header.style.cssText = `background: #222; padding: 12px 15px; font-size: 13px; font-weight: bold; color: ${meta.color}; border-bottom: 1px solid #333; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;`;
        
        let cbId = '';
        if (category === 'conflict') cbId = 'cb-red-enable';
        if (category === 'similar') cbId = 'cb-yellow-enable';
        if (category === 'automerge') cbId = 'cb-auto-merge';

        let isChecked = false;
        if (category === 'conflict') isChecked = localStorage.getItem('rm_enable_red') !== 'false';
        if (category === 'similar') isChecked = localStorage.getItem('rm_enable_yellow') !== 'false';
        if (category === 'automerge') isChecked = localStorage.getItem('rm_auto_merge') === 'true';

        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" id="${cbId}" ${isChecked ? 'checked' : ''} style="margin:0; cursor:pointer;" ${category==='automerge'?'title="Auto-Run when a folder finishes loading"':''}>
                <span>${meta.label}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <button onclick="window.restoreCategoryDefaults('${category}')" title="Restore original rules for ${meta.label.split(' ')[0]}" style="background:transparent; border:none; color:#888; cursor:pointer; font-size:14px; padding:0; transition:0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#888'">🔄</button>
                <span style="background:#111; color:#aaa; padding:3px 8px; border-radius:6px; font-size:11px; border:1px solid #333;">${categoryRows.length} rules</span>
            </div>
        `;
        
        setTimeout(() => {
            const cb = document.getElementById(cbId);
            if (cb) {
                cb.onchange = (e) => {
                    if (category === 'conflict') { localStorage.setItem('rm_enable_red', e.target.checked); applyUserRulesToGlobals(); }
                    if (category === 'similar') { localStorage.setItem('rm_enable_yellow', e.target.checked); applyUserRulesToGlobals(); }
                    if (category === 'automerge') { localStorage.setItem('rm_auto_merge', e.target.checked); }
                };
            }
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
            
            const badge = row.isDefault
                ? '<span style="background:#2a2a2a; color:#aaa; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #444;">Original</span>'
                : '<span style="background:#1a4d2e; color:#4caf50; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2e7d32;">Custom</span>';

            if (category === 'automerge') {
                let keep = row.keepTag || '';
                let rems = row.removeTags || [];
                let reqs = row.require || [];
                let excs = row.exclude || [];
                if (row.tags) { keep = row.tags[0]; rems = row.tags.slice(1); }
                else if (row.target) { keep = row.fallback; rems = [row.target]; reqs = row.exclude || []; excs = row.require || []; }

                item.innerHTML = `
                    <div style="flex:1; display:flex; flex-direction: column; gap: 6px; overflow: hidden;">
                        <div>${badge} <b style="color:#ff6060; font-size:11px;">[${escapeHTML(rems.join(', '))}]</b> ${keep ? `<span style="color:#888; font-size:10px; margin: 0 4px;">→</span> <b style="color:#00ff99; font-size:12px;">${escapeHTML(keep)}</b>` : `<span style="color:#888; font-size:10px; margin-left:4px;">(Removed)</span>`}</div>
                        <div style="font-size:11px; color:#aaa; display:flex; gap:10px; flex-wrap:wrap;">
                            ${reqs.length ? `<span style="background:#222; padding:2px 6px; border-radius:4px;"><span style="color:#00ff99;">Req:</span> ${escapeHTML(reqs.join(', '))}</span>` : ''}
                            ${excs.length ? `<span style="background:#222; padding:2px 6px; border-radius:4px;"><span style="color:#ff6060;">Exc:</span> ${escapeHTML(excs.join(', '))}</span>` : ''}
                        </div>
                    </div>
                    <div style="display:flex; flex-direction: column; gap:4px; flex-shrink:0;">
                        <button class="btn-conflict-edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️</button>
                        <button class="btn-conflict-delete" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                    </div>
                `;
                
                item.querySelector('.btn-conflict-edit').onclick = async () => {
                    const input = prompt(
                        'Edit Rule:\nFormat: Main Tag | Remove Tags | Requires (comma-sep) | Excludes (comma-sep)\nLeave blank space between pipes for empty properties.', 
                        `${keep} | ${rems.join(', ')} | ${reqs.join(', ')} | ${excs.join(', ')}`
                    );
                    if (input === null) return;
                    const parts = input.split('|').map(s => s.trim());
                    if (parts.length < 2) { if (window.showAlert) window.showAlert('Invalid format.', 'error'); return; }
                    
                    const data = {
                        keepTag: parts[0],
                        removeTags: parts[1].split(',').map(t=>t.trim()).filter(t=>t),
                        require: parts[2] ? parts[2].split(',').map(t=>t.trim()).filter(t=>t) : [],
                        exclude: parts[3] ? parts[3].split(',').map(t=>t.trim()).filter(t=>t) : []
                    };
                    if (data.removeTags.length === 0) { if (window.showAlert) window.showAlert('Remove Tags cannot be empty.', 'error'); return; }
                    
                    await updateRule(row.id, data); 
                    await applyUserRulesToGlobals();
                    refreshModalBody();
                };
            } else {
                const safeTagsText = escapeHTML(row.tags.join(', '));
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
                item.querySelector('.btn-conflict-edit').onclick = async () => {
                    const input = prompt('Edit simple group (comma-separated tags):', row.tags.join(', '));
                    if (input === null) return;
                    const tags = input.split(',').map(t => t.trim()).filter(t => t);
                    if (tags.length < 2) { if (window.showAlert) window.showAlert('A group needs at least 2 tags.', 'warn'); return; }
                    await updateRule(row.id, tags); 
                    await applyUserRulesToGlobals();
                    refreshModalBody();
                };
            }

            item.querySelector('.btn-conflict-delete').onclick = async () => {
                if (!confirm('Remove this rule?')) return;
                await deleteRule(row.id);
                await applyUserRulesToGlobals();
                refreshModalBody();
            };
            list.appendChild(item);
        });

        wrap.appendChild(list);

        const addRow = document.createElement('div');
        addRow.className = 'inline-add-box';
        
        if (category === 'automerge') {
            addRow.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 12px 15px; background: #111; align-items: stretch; flex-shrink: 0; border-top: 1px solid #222;';
            addRow.innerHTML = `
                <div style="display:flex; gap:6px;">
                    <input type="text" class="cond-keep" placeholder="Main Tag" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff;">
                    <input type="text" class="cond-remove" placeholder="Remove Tags" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff;">
                </div>
                <div style="display:flex; gap:6px;">
                    <input type="text" class="cond-req" placeholder="Requires (comma-sep)" style="flex:2; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff;">
                    <input type="text" class="cond-exc" placeholder="Excludes (e.g. @clothing)" style="flex:2; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff;">
                    <button class="cond-add-btn" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; font-size:11px; padding:6px 14px; border-radius:4px; flex-shrink:0; font-weight:bold; cursor:pointer;">➕ Add</button>
                </div>
            `;
            
            const condBtn = addRow.querySelector('.cond-add-btn');
            condBtn.onclick = async () => {
                const keep = addRow.querySelector('.cond-keep').value.trim();
                const removeStr = addRow.querySelector('.cond-remove').value.trim();
                if (!removeStr) { if (window.showAlert) window.showAlert('Remove Tags is required.', 'warn'); return; }
                
                const reqStr = addRow.querySelector('.cond-req').value;
                const excStr = addRow.querySelector('.cond-exc').value;
                
                const data = {
                    keepTag: keep,
                    removeTags: removeStr.split(',').map(t=>t.trim()).filter(t=>t),
                    require: reqStr.split(',').map(t=>t.trim()).filter(t=>t),
                    exclude: excStr.split(',').map(t=>t.trim()).filter(t=>t)
                };
                
                await addRule(category, data, false); 
                
                addRow.querySelector('.cond-keep').value = '';
                addRow.querySelector('.cond-remove').value = '';
                addRow.querySelector('.cond-req').value = '';
                addRow.querySelector('.cond-exc').value = '';
                
                await applyUserRulesToGlobals();
                refreshModalBody();
            };

        } else {
            addRow.style.cssText = 'display: flex; gap: 8px; padding: 12px 15px; background: #111; align-items: center; flex-shrink: 0; border-top: 1px solid #222;';
            addRow.innerHTML = `
                <input type="text" class="conflict-add-input" placeholder="tag1, tag2..." style="flex:1; font-size:12px; background:#222; border:1px solid #444; padding:8px 10px; border-radius:6px; color:#fff; outline:none;">
                <button class="conflict-add-btn" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; font-size:12px; padding:8px 12px; border-radius:6px; flex-shrink:0; font-weight:bold; cursor:pointer;">➕ Add</button>
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
        }
        
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

    /* ---------- EMBEDS MANAGER UI ---------- */
    window.restoreEmbedDefaults = async function() {
        if (!confirm(`Restore original default embeds?\n\n- Your custom embeds will be kept.`)) return;
        const rows = await getAllRules();
        for (let r of rows) {
            if (r.category === 'embed' && r.isDefault) await deleteRule(r.id);
        }
        for (let embed of FACTORY_EMBEDS) await addRule('embed', embed, true);
        refreshEmbedList();
        if (window.showAlert) window.showAlert(`Embed defaults restored!`, 'success');
    };

    function buildEmbedModal() {
        if (document.getElementById('modal-embed-manager')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-embed-manager';
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '105';
        overlay.onclick = () => window.closeModal('modal-embed-manager');

        overlay.innerHTML = `
            <div class="tool-modal" style="width: 500px; height: 600px; display:flex; flex-direction:column;" onclick="event.stopPropagation()">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <h3 style="margin:0 0 5px 0; font-size:16px;">📦 Custom Embeds</h3>
                    <button onclick="window.restoreEmbedDefaults()" title="Restore default embeds" style="background:transparent; border:none; color:#888; cursor:pointer; font-size:14px; padding:0; transition:0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#888'">🔄</button>
                </div>
                <div style="font-size:11px; color:#aaa; margin-bottom:15px;">
                    Create custom groups of tags. Use <b>@name</b> in the Excludes/Requires of Advanced Rules.
                </div>
                
                <div id="embed-list-container" class="panel-list-scroll" style="flex:1; overflow-y:auto; background:#111; padding:10px; border:1px solid #333; border-radius:6px; display:flex; flex-direction:column; gap:8px;"></div>
                
                <div style="margin-top:15px; display:flex; flex-direction:column; gap:8px; background:#1b1b1b; padding:12px; border:1px solid #333; border-radius:6px;">
                    <div style="font-size:12px; color:#00ff99; font-weight:bold;">Create New Embed</div>
                    <input type="text" id="embed-add-name" placeholder="Name (e.g. clothing)" style="font-size:12px; background:#222; border:1px solid #444; padding:8px; border-radius:4px; color:#fff;">
                    <textarea id="embed-add-tags" placeholder="tag1, tag2, tag3..." style="font-size:12px; background:#222; border:1px solid #444; padding:8px; border-radius:4px; color:#fff; min-height:60px; resize:vertical;"></textarea>
                    <button onclick="window.addCustomEmbed()" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer;">➕ Save Embed</button>
                </div>
                
                <div class="modal-buttons" style="margin-top:15px;">
                    <button class="btn-cancel" onclick="window.closeModal('modal-embed-manager')">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    window.openEmbedsManager = async function() {
        await refreshEmbedList();
        window.openModal('modal-embed-manager');
    };

    async function refreshEmbedList() {
        const container = document.getElementById('embed-list-container');
        if (!container) return;
        
        const rows = await getAllRules();
        const embeds = rows.filter(r => r.category === 'embed');
        
        // ORDENAÇÃO para os Embeds também
        embeds.sort((a, b) => {
            if (a.isDefault === b.isDefault) return 0;
            return a.isDefault ? -1 : 1;
        });
        
        container.innerHTML = '';
        if (embeds.length === 0) {
            container.innerHTML = '<div style="color:#555; font-size:12px; text-align:center; margin-top:20px;">No embeds created yet.</div>';
            return;
        }

        embeds.forEach(emb => {
            const badge = emb.isDefault 
                ? '<span style="background:#2a2a2a; color:#aaa; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #444; margin-right:6px;">Original</span>' 
                : '<span style="background:#1a4d2e; color:#4caf50; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2e7d32; margin-right:6px;">Custom</span>';

            const el = document.createElement('div');
            el.style.cssText = 'background:#151515; border:1px solid #2a2a2a; border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:8px;';
            el.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        ${badge}
                        <span style="font-size:14px; font-weight:bold; color:#b890ff;">@${escapeHTML(emb.name)}</span>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="btn-emb-edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:11px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️ Edit</button>
                        <button class="btn-emb-del" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:11px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                    </div>
                </div>
                <div style="font-size:11px; color:#aaa; line-height:1.4; word-break:break-word;">
                    ${escapeHTML(emb.tags.join(', '))}
                </div>
            `;
            
            el.querySelector('.btn-emb-edit').onclick = async () => {
                const input = prompt(`Edit @${emb.name} (comma-separated):`, emb.tags.join(', '));
                if (input === null) return;
                const tags = input.split(',').map(t => t.trim()).filter(t => t);
                if (tags.length === 0) return;
                await updateRule(emb.id, { name: emb.name, tags: tags });
                refreshEmbedList();
            };
            
            el.querySelector('.btn-emb-del').onclick = async () => {
                if (!confirm(`Delete embed @${emb.name}?`)) return;
                await deleteRule(emb.id);
                refreshEmbedList();
            };
            
            container.appendChild(el);
        });
    }

    window.addCustomEmbed = async function() {
        const nameInput = document.getElementById('embed-add-name');
        const tagsInput = document.getElementById('embed-add-tags');
        
        let name = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        let tags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);
        
        if (!name || tags.length === 0) {
            if(window.showAlert) window.showAlert('Please provide a valid name and tags.', 'warn');
            return;
        }
        
        await addRule('embed', { name: name, tags: tags }, false);
        nameInput.value = '';
        tagsInput.value = '';
        refreshEmbedList();
        if(window.showAlert) window.showAlert(`Embed @${name} saved!`, 'success');
    };

    window.openConflictManager = async function () {
        buildModal();
        await refreshModalBody();
        window.openModal('modal-conflict-manager');
    };

    function injectButton() {
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