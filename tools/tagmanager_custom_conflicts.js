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
                            if (data.color !== undefined) item.color = data.color;
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

    /* Antes: wrap próprio de renderImageList detectando troca de dataset e
       disparando runAutoMergeOnDataset via setTimeout independente — rodava
       ao mesmo tempo que o scan do Danbooru e o dup name fixer, sem
       nenhuma coordenação entre eles (uma das causas de lentidão/falhas
       intermitentes com datasets grandes). Agora registra na fila
       serializada (tagmanager_auto_task_queue.js), que roda os 3 scans
       automáticos em sequência, nunca em paralelo. */
    function hookAutoMergeLoader() {
        if (window._autoMergeHooked) return;
        if (typeof window.registerAutoDatasetTask === 'function') {
            window.registerAutoDatasetTask('auto-merge', async () => {
                const autoRun = localStorage.getItem('rm_auto_merge') === 'true';
                if (autoRun && window.enableConflictWarnings !== false) {
                    await window.runAutoMergeOnDataset(false);
                }
            });
            window._autoMergeHooked = true;
            return;
        }
        // Fallback (caso tagmanager_auto_task_queue.js não tenha carregado)
        let _lastImageFilesRef = null;
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

        const rows = await getAllRules();
        window._userConflictRules = rows;

        if (window.enableConflictWarnings === false) {
            window.tagConflicts = [];
            window.tagSimilar = [];
        } else {
            const isRedEnabled = localStorage.getItem('rm_enable_red') !== 'false';
            const isYellowEnabled = localStorage.getItem('rm_enable_yellow') !== 'false';

            window.tagConflicts = isRedEnabled ? rows.filter(r => r.category === 'conflict').map(r => r.tags) : [];
            window.tagSimilar = isYellowEnabled ? rows.filter(r => r.category === 'similar').map(r => r.tags) : [];
        }

        window.tagHighlightGroups = rows.filter(r => r.category === 'highlight');
        const hlMap = new Map();
        window.tagHighlightGroups.forEach(g => {
            (g.tags || []).forEach(t => {
                const key = t.toLowerCase();
                if (!hlMap.has(key)) hlMap.set(key, { name: g.name, color: g.color || '#4db8ff' });
            });
        });
        window._tagHighlightMap = hlMap;

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
        },
        highlight: {
            label: '🎨 Custom Highlights',
            color: '#4db8ff',
            hint: 'Custom-colored groups of tags, shown with an icon + tint in the tag lists.',
            desc: 'Two kinds live here: 🔒 Built-in Highlights (Favorite/Preset/Filter — color + on/off only, can\'t be deleted) and 📁 Custom Groups you create yourself (e.g. "eye orientation") with your own tags + color. Matching tags get tinted and, for custom groups, a 🔖 icon next to the star with "Belongs to: <group>" on hover — independent of the Conflicts/Similar toggle above.'
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

        /* --- Custom Highlights (nova categoria) --- */
        .tag-hl-icon { transition: 0.15s; }
        .tag-hl-icon:hover { transform: scale(1.2); }
        .hl-color-input { width: 26px; height: 26px; padding: 0; border: 1px solid #444; border-radius: 50%; background: transparent; cursor: pointer; flex-shrink: 0; }
        .hl-color-input::-webkit-color-swatch-wrapper { padding: 2px; border-radius: 50%; }
        .hl-color-input::-webkit-color-swatch { border: none; border-radius: 50%; }
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
                        <button class="btn-top-action" onclick="window.restoreHighlightColorDefaults()" style="background:#151515; color:#4db8ff; border-color:#2a5a8c;" title="Reset Favorite/Preset/Filter/NL/Selection colors back to factory defaults (doesn't touch on/off state or custom groups)">🎨 Restore Highlight Colors</button>
                        <button class="btn-top-action" onclick="window.clearAllRules()" style="color:#ff6060; border-color:#7a222c;">🗑️ Clear All</button>
                    </div>
                </div>

                <div id="conflict-manager-body" style="flex:1; display:flex; flex-direction:row; gap:15px; overflow:hidden; margin-top: 10px; margin-bottom: 15px; min-height: 0;"></div>
                
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
            // Ajuste no cssText aqui:
            addRow.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 12px 15px; background: #111; align-items: stretch; flex: 0 0 auto; border-top: 1px solid #222;';
            addRow.innerHTML = `
                <div style="display:flex; gap:6px;">
                    <!-- Ajuste no min-width: 0; de cada input -->
                    <input type="text" class="cond-keep" placeholder="Main Tag" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                    <input type="text" class="cond-remove" placeholder="Remove Tags" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                </div>
                <div style="display:flex; gap:6px;">
                    <input type="text" class="cond-req" placeholder="Requires (comma-sep)" style="flex:2; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                    <input type="text" class="cond-exc" placeholder="Excludes (e.g. @clothing)" style="flex:2; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
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
            addRow.style.cssText = 'display: flex; gap: 8px; padding: 12px 15px; background: #111; align-items: center; flex: 0 0 auto; border-top: 1px solid #222;';
            addRow.innerHTML = `
                <!-- Ajuste no min-width: 0; no input -->
                <input type="text" class="conflict-add-input" placeholder="tag1, tag2..." style="flex:1; font-size:12px; background:#222; border:1px solid #444; padding:8px 10px; border-radius:6px; color:#fff; outline:none; min-width: 0;">
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
        body.appendChild(renderHighlightSection(rows));
    }

    /* ---------- CUSTOM HIGHLIGHTS: PAINEL (4ª CATEGORIA) ---------- */
    /* ---------- CUSTOM HIGHLIGHTS: PAINEL (4ª CATEGORIA) ---------- */
    function renderHighlightSection(rows) {
        const meta = CATEGORY_META.highlight;
        const catRows = rows.filter(r => r.category === 'highlight');
        catRows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const wrap = document.createElement('div');
        wrap.className = 'panel';
        wrap.style.cssText = 'flex: 1; display: flex; flex-direction: column; background: #1b1b1b; border: 1px solid #222; border-radius: 10px; overflow: hidden; min-height: 0;';

        const header = document.createElement('div');
        header.className = 'panel-header';
        header.style.cssText = `background: #222; padding: 12px 15px; font-size: 13px; font-weight: bold; color: ${meta.color}; border-bottom: 1px solid #333; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;`;
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <span>${meta.label}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <button onclick="window.restoreHighlightColorDefaults()" title="Restore Favorite/Preset/Filter/NL/Selection colors to factory defaults (doesn't touch on/off state or custom groups)" style="background:transparent; border:none; color:#888; cursor:pointer; font-size:14px; padding:0; transition:0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#888'">🔄</button>
                <span style="background:#111; color:#aaa; padding:3px 8px; border-radius:6px; font-size:11px; border:1px solid #333;">${catRows.length} groups</span>
            </div>
        `;
        wrap.appendChild(header);

        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:11px; color:#aaa; padding: 12px 15px; background: #151515; border-bottom: 1px solid #222; flex-shrink: 0; line-height: 1.5;';
        hint.innerHTML = `<b>${meta.hint}</b><br><span style="color:#777; margin-top:6px; display:inline-block;">${meta.desc}</span>`;
        wrap.appendChild(hint);

        const list = document.createElement('div');
        list.className = 'panel-list-scroll';
        list.style.cssText = 'flex: 1; overflow-y: auto; display: flex; flex-direction: column; background: #111; padding: 10px; gap: 6px;';

        // --- SISTEMA DE COLLAPSE PARA OS BUILT-INS ---
        const builtinToggle = document.createElement('div');
        builtinToggle.style.cssText = 'font-size:10px; color:#aaa; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px; padding: 8px 10px; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; transition: 0.15s; margin-bottom: 2px;';
        builtinToggle.innerHTML = `<span>🔒 Built-in Highlights <span style="font-size:9px; color:#666; text-transform:none; margin-left:5px;">(color + on/off only)</span></span> <span class="toggle-icon" style="font-size: 12px;">▼</span>`;
        
        builtinToggle.onmouseover = () => builtinToggle.style.background = '#222';
        builtinToggle.onmouseout = () => builtinToggle.style.background = '#1a1a1a';

        list.appendChild(builtinToggle);

        const builtinContainer = document.createElement('div');
        // display: none para iniciar fechado como padrão
        builtinContainer.style.cssText = 'display: none; flex-direction: column; gap: 6px; margin-bottom: 6px;'; 
        
        builtinContainer.appendChild(buildLockedHighlightRow('favorite', '⭐ Favorite Tags', 'highlight-color-favorite', window._builtinHighlightCheckboxes && window._builtinHighlightCheckboxes.favorite));
        builtinContainer.appendChild(buildLockedHighlightRow('preset', '🔖 Already Preset', 'highlight-color-preset', window._builtinHighlightCheckboxes && window._builtinHighlightCheckboxes.preset));
        builtinContainer.appendChild(buildLockedHighlightRow('filter', '🎯 Filter/Pin Match', 'highlight-color-filter', window._builtinHighlightCheckboxes && window._builtinHighlightCheckboxes.filter));
        builtinContainer.appendChild(buildLockedHighlightRow('nl', '📝 NL (Natural Language) Tags', 'highlight-color-nl', getOrCreateNLHighlightCheckbox()));
        builtinContainer.appendChild(buildLockedHighlightRow('selection', '🖱️ Tag Selection (click highlight)', 'highlight-color-selection', null, '🔒 Always On'));

        list.appendChild(builtinContainer);

        builtinToggle.onclick = () => {
            const isCollapsed = builtinContainer.style.display === 'none';
            builtinContainer.style.display = isCollapsed ? 'flex' : 'none';
            builtinToggle.querySelector('.toggle-icon').textContent = isCollapsed ? '▲' : '▼';
            builtinToggle.style.color = isCollapsed ? '#fff' : '#aaa';
        };
        // ---------------------------------------------

        const divider = document.createElement('div');
        divider.style.cssText = 'border-top: 1px dashed #333; margin: 4px 2px 2px;';
        list.appendChild(divider);

        const customLabel = document.createElement('div');
        customLabel.style.cssText = 'font-size:10px; color:#666; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px; padding: 6px 4px 4px; display:flex; justify-content:space-between; align-items:center;';
        customLabel.innerHTML = `<span>📁 Custom Groups</span><span style="background:#111; color:#aaa; padding:2px 7px; border-radius:6px; font-size:10px; border:1px solid #333; text-transform:none; letter-spacing:0;">${catRows.length}</span>`;
        list.appendChild(customLabel);

        if (catRows.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:12px; color:#555; font-style:italic; text-align: center; margin-top: 10px;';
            empty.textContent = 'No custom highlight groups yet.';
            list.appendChild(empty);
        }

        catRows.forEach(row => {
            const color = row.color || '#4db8ff';
            const tags = row.tags || [];

            const item = document.createElement('div');
            item.className = 'conflict-group-item';
            item.style.cssText = `display:flex; align-items:center; gap:10px; background:#151515; border:1px solid #2a2a2a; border-left:3px solid ${color}; border-radius:6px; padding:8px 10px;`;

            item.innerHTML = `
                <input type="color" class="hl-color-input" value="${color}" title="Change highlight color">
                <div style="flex:1; display:flex; flex-direction: column; gap: 4px; overflow: hidden;">
                    <b style="color:${color}; font-size:13px;">${escapeHTML(row.name || '')}</b>
                    <span style="font-size:12px; color:#ddd; word-break:break-word; line-height: 1.3;">${escapeHTML(tags.join(', '))}</span>
                </div>
                <div style="display:flex; flex-direction: column; gap:4px; flex-shrink:0;">
                    <button class="btn-hl-edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️</button>
                    <button class="btn-hl-delete" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                </div>
            `;

            item.querySelector('.hl-color-input').onchange = async (e) => {
                const newColor = e.target.value;
                await updateRule(row.id, { name: row.name, tags: row.tags, color: newColor });
                await applyUserRulesToGlobals();
                item.style.borderLeftColor = newColor;
                const bEl = item.querySelector('b');
                if (bEl) bEl.style.color = newColor;
            };

            item.querySelector('.btn-hl-edit').onclick = async () => {
                const newName = prompt('Group name:', row.name || '');
                if (newName === null || !newName.trim()) return;
                const newTagsStr = prompt('Tags (comma-separated):', tags.join(', '));
                if (newTagsStr === null) return;
                const newTags = newTagsStr.split(',').map(t => t.trim()).filter(t => t);
                if (newTags.length === 0) { if (window.showAlert) window.showAlert('At least 1 tag is required.', 'warn'); return; }

                await updateRule(row.id, { name: newName.trim(), tags: newTags, color: row.color || color });
                await applyUserRulesToGlobals();
                refreshModalBody();
            };

            item.querySelector('.btn-hl-delete').onclick = async () => {
                if (!confirm(`Delete the highlight group "${row.name}"? This only removes the group — the tags themselves stay untouched on your images.`)) return;
                await deleteRule(row.id);
                await applyUserRulesToGlobals();
                refreshModalBody();
            };

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
                <input type="text" class="hl-add-tags" placeholder="tag1, tag2, tag3..." style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                <button class="hl-add-btn" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; font-size:11px; padding:6px 14px; border-radius:4px; flex-shrink:0; font-weight:bold; cursor:pointer;">➕ Add</button>
            </div>
        `;

        const addBtn = addRow.querySelector('.hl-add-btn');
        const doAdd = async () => {
            const nameInput = addRow.querySelector('.hl-add-name');
            const colorInput = addRow.querySelector('.hl-add-color');
            const tagsInput = addRow.querySelector('.hl-add-tags');

            const name = nameInput.value.trim();
            const newTags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);
            const color = colorInput.value || '#4db8ff';

            if (!name || newTags.length === 0) { if (window.showAlert) window.showAlert('Group name and at least 1 tag are required.', 'warn'); return; }

            await addRule('highlight', { name, tags: newTags, color }, false);

            nameInput.value = ''; tagsInput.value = ''; colorInput.value = '#4db8ff';
            await applyUserRulesToGlobals();
            refreshModalBody();
        };
        addBtn.onclick = doAdd;
        addRow.querySelector('.hl-add-tags').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };

        wrap.appendChild(addRow);
        return wrap;
    }

    /* ---------- BUILT-IN HIGHLIGHTS ---------- */
    const DEFAULT_HIGHLIGHT_COLORS = { favorite: '#00ff99', preset: '#2dd4bf', filter: '#ff9500', nl: '#b890ff', selection: '#4db8ff' };
    window._builtinHighlightColors = window._builtinHighlightColors || { ...DEFAULT_HIGHLIGHT_COLORS };
    window.enableNLHighlight = window.enableNLHighlight !== undefined ? window.enableNLHighlight : true;

    async function loadBuiltinHighlightColors() {
        if (typeof window.getSetting !== 'function') return;
        for (const key of Object.keys(DEFAULT_HIGHLIGHT_COLORS)) {
            window._builtinHighlightColors[key] = await window.getSetting(`highlight-color-${key}`, DEFAULT_HIGHLIGHT_COLORS[key]);
        }
        window.enableNLHighlight = await window.getSetting('highlight-enable-nl', true);
    }

    window.restoreHighlightColorDefaults = async function () {
        if (!confirm('Restore all Built-in Highlight colors (Favorite, Preset, Filter, NL, Selection) to their factory defaults?\nThis does NOT change their on/off state.')) return;
        for (const key of Object.keys(DEFAULT_HIGHLIGHT_COLORS)) {
            window._builtinHighlightColors[key] = DEFAULT_HIGHLIGHT_COLORS[key];
            if (typeof window.saveSetting === 'function') await window.saveSetting(`highlight-color-${key}`, DEFAULT_HIGHLIGHT_COLORS[key]);
        }
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
        if (typeof window.renderImageList === 'function') window.renderImageList();
        if (document.getElementById('modal-conflict-manager') && document.getElementById('modal-conflict-manager').classList.contains('active')) await refreshModalBody();
        if (window.showAlert) window.showAlert('Highlight colors restored to defaults!', 'success');
    };

    function relocateHighlightCheckbox(id) {
        const input = document.getElementById(id);
        if (!input) return null;
        const label = input.parentElement;
        if (label && label.tagName === 'LABEL' && label.parentNode) {
            label.parentNode.insertBefore(input, label);
            label.parentNode.removeChild(label);
        }
        input.style.display = 'none';
        return input;
    }

    function relocateBuiltinHighlightToggles() {
        if (window._builtinHighlightCheckboxes) return;
        window._builtinHighlightCheckboxes = {
            favorite: relocateHighlightCheckbox('toggle-fav-highlight'),
            preset: relocateHighlightCheckbox('toggle-preset-highlight'),
            filter: relocateHighlightCheckbox('toggle-filter-highlight')
        };
    }

    function getOrCreateNLHighlightCheckbox() {
        if (window._nlHighlightCheckbox) return window._nlHighlightCheckbox;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'toggle-nl-highlight';
        cb.checked = window.enableNLHighlight !== false;
        cb.onchange = async () => {
            window.enableNLHighlight = cb.checked;
            if (typeof window.saveSetting === 'function') await window.saveSetting('highlight-enable-nl', cb.checked);
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
        };
        window._nlHighlightCheckbox = cb;
        return cb;
    }

    function buildLockedHighlightRow(key, label, colorSettingKey, checkboxEl, badgeText) {
        const color = window._builtinHighlightColors[key];
        const badge = badgeText || '🔒 Locked';
        const item = document.createElement('div');
        item.className = 'conflict-group-item';
        item.style.cssText = `display:flex; align-items:center; gap:10px; background:#151515; border:1px solid #2a2a2a; border-left:3px solid ${color}; border-radius:6px; padding:8px 10px;`;
        item.innerHTML = `
            <input type="color" class="hl-color-input" value="${color}" title="Change highlight color">
            <div style="flex:1; display:flex; align-items:center; gap:8px;">
                <span class="hl-checkbox-slot" style="display:flex; align-items:center;"></span>
                <b style="color:${color}; font-size:13px;">${label}</b>
            </div>
            <span style="background:#2a2a2a; color:#888; font-size:10px; padding:2px 8px; border-radius:4px; border:1px solid #444; flex-shrink:0; white-space:nowrap;" title="Built-in highlight: color (and, when applicable, on/off) can be changed, but it can't be deleted">${badge}</span>
        `;

        if (checkboxEl) {
            checkboxEl.style.display = 'inline-block';
            checkboxEl.style.margin = '0';
            checkboxEl.title = 'Enable/disable this highlight';
            item.querySelector('.hl-checkbox-slot').appendChild(checkboxEl);
        }

        item.querySelector('.hl-color-input').onchange = async (e) => {
            const newColor = e.target.value;
            window._builtinHighlightColors[key] = newColor;
            if (typeof window.saveSetting === 'function') await window.saveSetting(colorSettingKey, newColor);
            item.style.borderLeftColor = newColor;
            const bEl = item.querySelector('b');
            if (bEl) bEl.style.color = newColor;
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
            if (typeof window.renderImageList === 'function') window.renderImageList();
        };

        return item;
    }

    function applyBuiltinHighlightOverrides(container) {
        if (!container || !window._builtinHighlightColors) return;
        const { favorite: favColor, filter: filterColor, preset: presetColor, nl: nlColor, selection: selColor } = window._builtinHighlightColors;

        container.querySelectorAll('.glow-favorite').forEach(el => {
            el.style.setProperty('background-color', hexToRgba(favColor, 0.24), 'important');
            el.style.setProperty('border-left-color', favColor, 'important');
        });
        container.querySelectorAll('.filter-match').forEach(el => {
            el.style.setProperty('background-color', hexToRgba(filterColor, 0.14), 'important');
            el.style.setProperty('box-shadow', `inset 0 0 0 1px ${filterColor}`, 'important');
        });
        container.querySelectorAll('.is-preset').forEach(el => {
            el.style.setProperty('background-color', hexToRgba(presetColor, 0.14), 'important');
            el.style.setProperty('border-left-color', presetColor, 'important');
        });

        if (typeof window.checkIfNL === 'function') {
            const nlActiveColor = window.enableNLHighlight !== false ? nlColor : '#ddd';
            container.querySelectorAll('.tag-name').forEach(el => {
                if (!window.checkIfNL(el.textContent)) return;
                el.style.setProperty('color', nlActiveColor, 'important');
            });
        }

        container.querySelectorAll('.selected-active, .selected-master').forEach(el => {
            el.style.setProperty('background-color', hexToRgba(selColor, 0.32), 'important');
            el.style.setProperty('border-left-color', selColor, 'important');
        });
    }

    function applyImageListSelectionOverride(container) {
        if (!container || !window._builtinHighlightColors) return;
        const selColor = window._builtinHighlightColors.selection;
        container.querySelectorAll('.list-item.selected').forEach(el => {
            el.style.setProperty('background-color', hexToRgba(selColor, 0.32), 'important');
            el.style.setProperty('border-left-color', selColor, 'important');
        });
    }

    function hexToRgba(hex, alpha) {
        let h = (hex || '#4db8ff').replace('#', '');
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const r = parseInt(h.substring(0, 2), 16) || 0;
        const g = parseInt(h.substring(2, 4), 16) || 0;
        const b = parseInt(h.substring(4, 6), 16) || 0;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function injectHighlightIcons(container, isMaster) {
        if (!container) return;
        if (!window._tagHighlightMap || window._tagHighlightMap.size === 0) return;

        const selector = isMaster ? '.master-tag-item[data-tag-name]' : '.tag-row[data-tag-name]';
        container.querySelectorAll(selector).forEach(row => {
            const tagLower = row.getAttribute('data-tag-name');
            const hl = window._tagHighlightMap.get(tagLower);
            if (!hl) return;
            if (row.querySelector('.tag-hl-icon')) return;

            row.style.backgroundColor = hexToRgba(hl.color, 0.16);
            row.style.borderLeft = `3px solid ${hl.color}`;

            const icon = document.createElement('span');
            icon.className = 'tag-hl-icon';
            icon.textContent = '🔖';
            icon.title = `Belongs to: ${hl.name}`;
            icon.style.cssText = `color:${hl.color}; margin-right:8px; font-size:13px; cursor:help; user-select:none; flex-shrink:0;`;

            const starEl = row.querySelector('.tag-star') || row.querySelector('.tag-edit-nl');
            if (starEl) {
                starEl.insertAdjacentElement('afterend', icon);
            } else {
                const leftDiv = row.querySelector('.tag-row-left') || row.firstElementChild;
                if (leftDiv) leftDiv.insertBefore(icon, leftDiv.firstChild);
            }
        });
    }

    /* Antes: 3 wraps próprios (renderEditor, renderMasterTagList,
       renderImageList) empilhados em cima dos wraps de outros plugins.
       Agora registra no ponto central de hooks (tagmanager_render_hooks.js)
       — mesmo efeito, sem empilhar mais uma camada de closure por cima
       das que já existiam. Fallback pro wrap manual se o arquivo central
       não tiver carregado. */
    function wrapRenderersForHighlights() {
        const hasRegistry = typeof window.registerPostRenderEditor === 'function'
            && typeof window.registerPostRenderMasterTagList === 'function'
            && typeof window.registerPostRenderImageList === 'function';

        if (hasRegistry) {
            if (!window._hlHooksRegistered) {
                window.registerPostRenderEditor(() => {
                    const container = document.getElementById('tag-list-vertical');
                    injectHighlightIcons(container, false);
                    applyBuiltinHighlightOverrides(container);
                });
                window.registerPostRenderMasterTagList(() => {
                    const container = document.getElementById('master-tag-list');
                    injectHighlightIcons(container, true);
                    applyBuiltinHighlightOverrides(container);
                });
                window.registerPostRenderImageList(() => {
                    applyImageListSelectionOverride(document.getElementById('image-list'));
                });
                window._hlHooksRegistered = true;
            }
            return;
        }

        if (typeof window.renderEditor === 'function' && !window.renderEditor.__hlWrapped) {
            const original = window.renderEditor;
            const wrapped = function () {
                original.apply(this, arguments);
                const container = document.getElementById('tag-list-vertical');
                injectHighlightIcons(container, false);
                applyBuiltinHighlightOverrides(container);
            };
            wrapped.__hlWrapped = true;
            window.renderEditor = wrapped;
        }
        if (typeof window.renderMasterTagList === 'function' && !window.renderMasterTagList.__hlWrapped) {
            const original2 = window.renderMasterTagList;
            const wrapped2 = function () {
                original2.apply(this, arguments);
                const container = document.getElementById('master-tag-list');
                injectHighlightIcons(container, true);
                applyBuiltinHighlightOverrides(container);
            };
            wrapped2.__hlWrapped = true;
            window.renderMasterTagList = wrapped2;
        }
        if (typeof window.renderImageList === 'function' && !window.renderImageList.__hlWrapped) {
            const original3 = window.renderImageList;
            const wrapped3 = function () {
                original3.apply(this, arguments);
                applyImageListSelectionOverride(document.getElementById('image-list'));
            };
            wrapped3.__hlWrapped = true;
            window.renderImageList = wrapped3;
        }
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
        relocateBuiltinHighlightToggles();
        await loadBuiltinHighlightColors();
        wrapRenderersForHighlights();

        setTimeout(() => {
            overrideOriginalSystems();
            injectButton();
            hookAutoMergeLoader();
        }, 0);
        await applyUserRulesToGlobals();
    });

})();

/* =========================================================================
   ISSUE COUNTERS (CONFLICTS & SIMILARS)
   Contadores individuais nas barras do Active Image e All Dataset Tags
========================================================================= */

window.enableCounterConflict = true;
window.enableCounterSimilar = true;
window.issueImagesMap = { conflict: [], similar: [] };

window.toggleCounterConflict = function(skipSave = false) {
    const cb = document.getElementById('toggle-counter-conflict');
    if (cb) {
        window.enableCounterConflict = cb.checked;
        if (!skipSave && typeof window.saveSetting === 'function') window.saveSetting('enable-counter-conflict', cb.checked);
    }
    window.updateGlobalIssueCounters();
    window.updateActiveIssueCounters();
};

window.toggleCounterSimilar = function(skipSave = false) {
    const cb = document.getElementById('toggle-counter-similar');
    if (cb) {
        window.enableCounterSimilar = cb.checked;
        if (!skipSave && typeof window.saveSetting === 'function') window.saveSetting('enable-counter-similar', cb.checked);
    }
    window.updateGlobalIssueCounters();
    window.updateActiveIssueCounters();
};

// Helper: calcula o total de tags problemáticas em uma única imagem
window.getIssuesCountForTags = function(tagsArray) {
    let confCount = 0;
    let simCount = 0;
    const tagsLower = tagsArray.map(t => t.trim().toLowerCase()).filter(t => t);
    
    if (window.tagConflicts) {
        let conflictTags = new Set();
        window.tagConflicts.forEach(group => {
            const groupLower = group.map(g => g.toLowerCase());
            const activeInGroup = groupLower.filter(g => tagsLower.includes(g));
            if (activeInGroup.length > 1) activeInGroup.forEach(t => conflictTags.add(t));
        });
        confCount = conflictTags.size;
    }
    
    if (window.tagSimilar) {
        let similarTags = new Set();
        window.tagSimilar.forEach(group => {
            const groupLower = group.map(g => g.toLowerCase());
            const activeInGroup = groupLower.filter(g => tagsLower.includes(g));
            if (activeInGroup.length > 1) activeInGroup.forEach(t => similarTags.add(t));
        });
        simCount = similarTags.size;
    }
    
    return { conflicts: confCount, similars: simCount };
};

// ==========================================
// 1. ALL DATASET TAGS (CONTA IMAGENS)
// ==========================================
window.updateGlobalIssueCounters = function() {
    const btnConf = document.getElementById('global-counter-conflict');
    const btnSim = document.getElementById('global-counter-similar');
    if (!btnConf || !btnSim) return;
    
    window.issueImagesMap = { conflict: [], similar: [] };
    
    if (typeof imageFiles !== 'undefined') {
        imageFiles.forEach((img, idx) => {
            if (img.hidden || img.type !== 'tags' || !img.content) return;
            const tags = img.content.split(',');
            const issues = window.getIssuesCountForTags(tags);
            if (issues.conflicts > 0) window.issueImagesMap.conflict.push(idx);
            if (issues.similars > 0) window.issueImagesMap.similar.push(idx);
        });
    }
    
    if (window.enableCounterConflict && window.issueImagesMap.conflict.length > 0) {
        btnConf.style.display = 'inline-block';
        btnConf.textContent = `⚠️ ${window.issueImagesMap.conflict.length} Conflicts`;
    } else {
        btnConf.style.display = 'none';
    }
    
    if (window.enableCounterSimilar && window.issueImagesMap.similar.length > 0) {
        btnSim.style.display = 'inline-block';
        btnSim.textContent = `🟨 ${window.issueImagesMap.similar.length} Similar`;
    } else {
        btnSim.style.display = 'none';
    }
};

// ==========================================
// 2. ACTIVE IMAGE (CONTA PROBLEMAS NA FOTO)
// ==========================================
window.updateActiveIssueCounters = function() {
    const spanConf = document.getElementById('active-counter-conflict');
    const spanSim = document.getElementById('active-counter-similar');
    if (!spanConf || !spanSim) return;

    let totalConf = 0;
    let totalSim = 0;

    if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof imageFiles !== 'undefined') {
        selectedIndices.forEach(idx => {
            const img = imageFiles[idx];
            if (img && img.type === 'tags' && img.content) {
                const tags = img.content.split(',');
                const issues = window.getIssuesCountForTags(tags);
                totalConf += issues.conflicts;
                totalSim += issues.similars;
            }
        });
    }

    if (window.enableCounterConflict && totalConf > 0) {
        spanConf.style.display = 'inline-block';
        spanConf.textContent = `⚠️ ${totalConf} Conflicts`;
    } else {
        spanConf.style.display = 'none';
    }

    if (window.enableCounterSimilar && totalSim > 0) {
        spanSim.style.display = 'inline-block';
        spanSim.textContent = `🟨 ${totalSim} Similar`;
    } else {
        spanSim.style.display = 'none';
    }
};

// ==========================================
// AÇÃO DE CLIQUE: Navega ciclicamente
// ==========================================
window.selectIssueImage = function(type) {
    const arr = window.issueImagesMap[type];
    if (!arr || arr.length === 0) return;
    
    let currentSelected = -1;
    if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) {
        currentSelected = Array.from(selectedIndices)[0];
    }
    
    let nextIdx = arr[0];
    
    if (currentSelected !== -1) {
        const currentIndexInArr = arr.indexOf(currentSelected);
        if (currentIndexInArr !== -1) {
            const nextIndexInArr = (currentIndexInArr + 1) % arr.length;
            nextIdx = arr[nextIndexInArr];
        } else {
            for (let i = 0; i < arr.length; i++) {
                if (arr[i] > currentSelected) {
                    nextIdx = arr[i];
                    break;
                }
            }
        }
    }
    
    if (typeof selectedIndices !== 'undefined') {
        selectedIndices.clear();
        selectedIndices.add(nextIdx);
    }
    
    if (typeof imageFiles !== 'undefined') {
        const targetImg = imageFiles[nextIdx];
        if (targetImg && targetImg.element) {
            targetImg.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
    if (typeof window.renderEditor === 'function') window.renderEditor();
};

// ==========================================
// INJEÇÃO NO DOM E HOOKS AUTOMÁTICOS
// ==========================================
function initIssueCounters() {
    // 1. Injeta no Topbar do Active Image
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

    // 2. Injeta no Topbar do All Dataset Tags
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
    
    window.updateGlobalIssueCounters();
    window.updateActiveIssueCounters();
}

// 3. Injeção dos Checkboxes no Modal Manage Rules via Interceptação
const _origOpenConflictManagerForCounters = window.openConflictManager;
if (typeof _origOpenConflictManagerForCounters === 'function') {
    window.openConflictManager = async function() {
        await _origOpenConflictManagerForCounters.apply(this, arguments);
        const modalHeaderLeft = document.querySelector('#modal-conflict-manager .tool-modal > div:first-child > div:first-child');
        
        if (modalHeaderLeft && !document.getElementById('counter-checkboxes-container')) {
            const checkDiv = document.createElement('div');
            checkDiv.id = 'counter-checkboxes-container';
            checkDiv.style.cssText = 'display:flex; gap:15px; margin-bottom:10px; background:#111; padding:6px 10px; border-radius:6px; border:1px solid #333;';
            checkDiv.innerHTML = `
                <label style="font-size: 11px; color: #ccc; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                    <input type="checkbox" id="toggle-counter-conflict" style="margin:0;" ${window.enableCounterConflict ? 'checked' : ''} onchange="window.toggleCounterConflict()">
                    Show Issue Counters (Conflicts)
                </label>
                <label style="font-size: 11px; color: #ccc; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                    <input type="checkbox" id="toggle-counter-similar" style="margin:0;" ${window.enableCounterSimilar ? 'checked' : ''} onchange="window.toggleCounterSimilar()">
                    Show Issue Counters (Similars)
                </label>
            `;
            modalHeaderLeft.appendChild(checkDiv);
        }
    };
}

async function loadCounterSettingsAndInit() {
    if (typeof window.getSetting === 'function') {
        window.enableCounterConflict = await window.getSetting('enable-counter-conflict', true);
        window.enableCounterSimilar = await window.getSetting('enable-counter-similar', true);
    }
    initIssueCounters();
    setTimeout(initIssueCounters, 500);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadCounterSettingsAndInit);
} else {
    loadCounterSettingsAndInit();
}

// Hooks: Atualiza globais + contador ativo (via registro central de
// tagmanager_render_hooks.js, em vez de mais 2 wraps próprios empilhados)
if (typeof window.registerPostApplyFilters === 'function' && typeof window.registerPostRenderEditor === 'function') {
    window.registerPostApplyFilters(() => window.updateGlobalIssueCounters());
    window.registerPostRenderEditor(() => window.updateActiveIssueCounters());
} else {
    if (typeof window.applyFilters === 'function') {
        const originalApplyFilters = window.applyFilters;
        window.applyFilters = function() {
            if (originalApplyFilters) originalApplyFilters.apply(this, arguments);
            window.updateGlobalIssueCounters();
        };
    }
    if (typeof window.renderEditor === 'function') {
        const originalRenderEditor = window.renderEditor;
        window.renderEditor = function() {
            if (originalRenderEditor) originalRenderEditor.apply(this, arguments);
            window.updateActiveIssueCounters();
        };
    }
}

/* =========================================================================
   HOVER HIGHLIGHT (GLOW) PARA CONFLITOS E SIMILARES
   Restaura o efeito visual e estende aos novos contadores do Active Image
========================================================================= */

// 1. Injeta o CSS que faz o "Glow" (brilho) acontecer
const glowStyle = document.createElement('style');
glowStyle.innerHTML = `
    .tag-row.glow-conflict, .master-tag-item.glow-conflict { 
        background: rgba(255, 60, 60, 0.4) !important; 
        box-shadow: inset 0 0 0 2px #ff4444, 0 0 10px rgba(255,68,68,0.5) !important; 
        transition: all 0.1s ease-in-out !important; 
    }
    .tag-row.glow-similar, .master-tag-item.glow-similar { 
        background: rgba(255, 204, 0, 0.3) !important; 
        box-shadow: inset 0 0 0 2px #ffcc00, 0 0 10px rgba(255,204,0,0.4) !important; 
        transition: all 0.1s ease-in-out !important; 
    }
`;
document.head.appendChild(glowStyle);

// 2. Event Delegation: Monitora o mouse na tela inteira de forma eficiente
document.addEventListener('mouseover', (e) => {
    // A. Hover no contador de conflitos (Brilha a tag base E seus respectivos alvos)
    if (e.target.id === 'active-counter-conflict') {
        // Mantém o fallback para as tags originais
        document.querySelectorAll('#tag-list-vertical .tag-row.conflict').forEach(el => el.classList.add('glow-conflict'));
        
        // Simula o hover varrendo os titles para acender os alvos cruzados
        document.querySelectorAll('#tag-list-vertical .conflict-warning').forEach(warning => {
            const title = warning.getAttribute('title');
            if (title && title.startsWith('Conflict with: ')) {
                const tags = title.replace('Conflict with: ', '').split(',').map(t => t.trim());
                tags.forEach(t => {
                    const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(t.toLowerCase())}"]`);
                    if (targetRow) targetRow.classList.add('glow-conflict');
                });
            }
        });
    } 
    // B. Hover no contador de similares (Brilha a tag base E seus respectivos alvos)
    else if (e.target.id === 'active-counter-similar') {
        // Mantém o fallback para as tags originais
        document.querySelectorAll('#tag-list-vertical .tag-row.similar').forEach(el => el.classList.add('glow-similar'));
        
        // Simula o hover varrendo os titles para acender os alvos cruzados
        document.querySelectorAll('#tag-list-vertical .similar-warning').forEach(warning => {
            const title = warning.getAttribute('title');
            if (title && title.startsWith('Similar/Redundant to: ')) {
                const tags = title.replace('Similar/Redundant to: ', '').split(',').map(t => t.trim());
                tags.forEach(t => {
                    const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(t.toLowerCase())}"]`);
                    if (targetRow) targetRow.classList.add('glow-similar');
                });
            }
        });
    }
    // C. Hover em um aviso ESPECÍFICO de conflito dentro de uma tag
    else if (e.target.classList.contains('conflict-warning')) {
        const parentRow = e.target.closest('.tag-row, .master-tag-item');
        if (parentRow) parentRow.classList.add('glow-conflict');

        const title = e.target.getAttribute('title');
        if (title && title.startsWith('Conflict with: ')) {
            const tags = title.replace('Conflict with: ', '').split(',').map(t => t.trim());
            tags.forEach(t => {
                const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(t.toLowerCase())}"]`);
                if (targetRow) targetRow.classList.add('glow-conflict');
            });
        }
    } 
    // D. Hover em um aviso ESPECÍFICO de similaridade dentro de uma tag
    else if (e.target.classList.contains('similar-warning')) {
        const parentRow = e.target.closest('.tag-row, .master-tag-item');
        if (parentRow) parentRow.classList.add('glow-similar');

        const title = e.target.getAttribute('title');
        if (title && title.startsWith('Similar/Redundant to: ')) {
            const tags = title.replace('Similar/Redundant to: ', '').split(',').map(t => t.trim());
            tags.forEach(t => {
                const targetRow = document.querySelector(`.tag-row[data-tag-name="${CSS.escape(t.toLowerCase())}"]`);
                if (targetRow) targetRow.classList.add('glow-similar');
            });
        }
    }
});

// 3. Remove os efeitos visuais quando o mouse sai de cima
document.addEventListener('mouseout', (e) => {
    if (e.target.id === 'active-counter-conflict' || 
        e.target.id === 'active-counter-similar' || 
        e.target.classList.contains('conflict-warning') || 
        e.target.classList.contains('similar-warning')) {
        
        document.querySelectorAll('.glow-conflict').forEach(el => el.classList.remove('glow-conflict'));
        document.querySelectorAll('.glow-similar').forEach(el => el.classList.remove('glow-similar'));
    }
});