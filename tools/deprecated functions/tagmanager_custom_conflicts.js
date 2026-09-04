/* =========================================================================
   CONFLICT / SIMILARITY / AUTO-MERGE MANAGER - v20 (Robust / Crash Fix)
   ---------------------------------------------------------------------
   Standalone — Integra Conflitos, Similares e um Auto-Do unificado.
   Migrado para user_config.json via tagmanager_db.js com proteção 
   contra dados corrompidos.
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
        },
        {
            name: 'solidbackground',
            tags: ['simple background', 'white background', 'black background', 'transparent background', 'blue background', 'red background', 'green background', 'yellow background', 'pink background', 'purple background', 'grey background', 'brown background', 'orange background']
        }
    ];

    /* ---------- JSON / SETTINGS DB ABSTRACTION ---------- */
    
    function getFactoryRules() {
        let rules = [];
        FACTORY_CONFLICTS.forEach((tags, i) => rules.push({ id: 'def_conf_'+i, category: 'conflict', isDefault: true, tags }));
        FACTORY_SIMILAR.forEach((tags, i) => rules.push({ id: 'def_sim_'+i, category: 'similar', isDefault: true, tags }));
        FACTORY_EMBEDS.forEach((emb, i) => rules.push({ id: 'def_emb_'+i, category: 'embed', isDefault: true, name: emb.name, tags: emb.tags }));
        
        rules.push({ id: 'def_am_0', category: 'automerge', isDefault: true, keepTag: 'nude', removeTags: ['completely nude'], require: [], exclude: ['full body', '@clothing'], isAutoFill: false });
        rules.push({ id: 'def_am_1', category: 'automerge', isDefault: true, keepTag: 'completely nude', removeTags: ['nude'], require: ['full body'], exclude: ['@clothing'], isAutoFill: false });
        rules.push({ id: 'def_am_2', category: 'automerge', isDefault: true, keepTag: 'tachi-e', removeTags: ['visual novel cg'], require: ['@solidbackground'], exclude: [], isAutoFill: true });
        return rules;
    }

    async function migrateOldIndexedDB() {
        // COMENTE ESTAS DUAS LINHAS PARA FORÇAR A MIGRAÇÃO:
        // const migrated = await window.getSetting('conflict_db_migrated', false);
        // if (migrated) return;

        // 1. Migração do IndexedDB antigo (Regras customizadas)
        try {
            const db = await new Promise((res, rej) => {
                const req = indexedDB.open('ConflictRulesDB', 4);
                req.onsuccess = e => res(e.target.result);
                req.onerror = e => rej(e.target.error);
                req.onupgradeneeded = e => { e.target.transaction.abort(); rej("DB not found"); };
            });

            const oldRules = await new Promise((r, rej) => {
                const tx = db.transaction('rules', 'readonly');
                const req = tx.objectStore('rules').getAll();
                req.onsuccess = () => r(req.result || []);
                req.onerror = () => rej(req.error);
            });

            if (oldRules && oldRules.length > 0) {
                const customOnly = oldRules.filter(r => !r.isDefault);
                await window.saveSetting('custom-conflict-rules', customOnly);
            }
        } catch(e) {}

        // 2. Migração de chaves legadas do localStorage
        const keysToMigrate = [
            'rm_enable_red', 'rm_enable_yellow', 'rm_auto_merge',
            'highlight-color-favorite', 'highlight-color-preset', 'highlight-color-filter', 
            'highlight-color-nl', 'highlight-color-selection', 'highlight-enable-nl',
            'enable-counter-conflict', 'enable-counter-similar', 'toggle-conflict-warnings'
        ];
        
        for (const key of keysToMigrate) {
            const val = localStorage.getItem(key);
            if (val !== null) {
                if (val === 'true') await window.saveSetting(key, true);
                else if (val === 'false') await window.saveSetting(key, false);
                else await window.saveSetting(key, val);
            }
        }

        await window.saveSetting('conflict_db_migrated', true);
    }

    async function cleanBloatedJSON() {
        let customRules = await window.getSetting('custom-conflict-rules', []);
        if (!Array.isArray(customRules)) customRules = [];
        
        if (customRules.some(r => r.isDefault)) {
            customRules = customRules.filter(r => !r.isDefault);
            await window.saveSetting('custom-conflict-rules', customRules);
            await window.saveSetting('deleted-default-rules', []);
        }
    }

    async function getAllRules() {
        let customRules = await window.getSetting('custom-conflict-rules', []);
        if (!Array.isArray(customRules)) customRules = [];
        
        let deletedDefaults = await window.getSetting('deleted-default-rules', []);
        if (!Array.isArray(deletedDefaults)) deletedDefaults = [];
        
        const factoryRules = getFactoryRules().filter(r => !deletedDefaults.includes(r.id));
        return [...factoryRules, ...customRules];
    }

    async function saveAllRules(rules) {
        if (!Array.isArray(rules)) rules = [];
        await window.saveSetting('custom-conflict-rules', rules);
    }

    async function addRule(category, data, isDefault = false) {
        let customRules = await window.getSetting('custom-conflict-rules', []);
        if (!Array.isArray(customRules)) customRules = [];
        
        let item = { id: Date.now() + "_" + Math.random().toString(36).substr(2, 9), category, isDefault: false };
        if (data.keepTag !== undefined || data.name !== undefined) {
            Object.assign(item, data);
        } else {
            item.tags = Array.isArray(data) ? data : [];
        }
        customRules.push(item);
        await saveAllRules(customRules);
        return true;
    }

    async function updateRule(id, data) {
        if (id.startsWith('def_')) {
            let deletedDefaults = await window.getSetting('deleted-default-rules', []);
            if (!Array.isArray(deletedDefaults)) deletedDefaults = [];
            if (!deletedDefaults.includes(id)) {
                deletedDefaults.push(id);
                await window.saveSetting('deleted-default-rules', deletedDefaults);
            }
            
            let customRules = await window.getSetting('custom-conflict-rules', []);
            if (!Array.isArray(customRules)) customRules = [];
            
            let factoryBase = getFactoryRules().find(r => r.id === id);
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
            await saveAllRules(customRules);
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
                await saveAllRules(customRules);
                return true;
            }
            return false;
        }
    }

    async function deleteRule(id) {
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
                await saveAllRules(customRules);
                return true;
            }
            return false;
        }
    }

    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
    }

    /* ---------- ENGINE & EMBED RESOLVER ---------- */
    
    function matchTag(tag, condition, embeds) {
        const t = tag.toLowerCase();
        const c = condition.toLowerCase();
        if (c.startsWith('@')) {
            const embedName = c.slice(1);
            const embed = embeds.find(e => (e.name || '').toLowerCase() === embedName);
            if (embed && Array.isArray(embed.tags)) {
                return embed.tags.some(eTag => eTag.toLowerCase() === t);
            }
            return false;
        }
        return t === c;
    }

    function runAutoMergeRule(tagsArray, rule, embeds) {
        const removes = Array.isArray(rule.removeTags) ? rule.removeTags : [];
        const reqs = Array.isArray(rule.require) ? rule.require : [];
        const excs = Array.isArray(rule.exclude) ? rule.exclude : [];

        const presentRemoves = removes.filter(rem => 
            tagsArray.some(t => t.toLowerCase() === rem.toLowerCase())
        );
        
        if (presentRemoves.length === 0) return null; 

        let hasRequired = true;
        if (reqs.length > 0) {
            hasRequired = reqs.every(req => tagsArray.some(t => matchTag(t, req, embeds)));
        }

        let hasExcluded = false;
        if (excs.length > 0) {
            hasExcluded = tagsArray.some(t => {
                return excs.some(ex => matchTag(t, ex, embeds));
            });
        }

        if (hasRequired && !hasExcluded) {
            let newTags = [...tagsArray];
            
            if (!rule.isAutoFill) {
                newTags = tagsArray.filter(t => 
                    !removes.some(rem => rem.toLowerCase() === t.toLowerCase())
                );
            }
            
            if (rule.keepTag && String(rule.keepTag).trim() !== '') {
                newTags.push(String(rule.keepTag).trim());
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
            if (Array.isArray(row.tags) && row.tags.length > 0) return { keepTag: row.tags[0], removeTags: row.tags.slice(1), require: [], exclude: [], isAutoFill: false };
            if (row.target) return { keepTag: row.fallback, removeTags: [row.target], require: Array.isArray(row.exclude) ? row.exclude : [], exclude: Array.isArray(row.require) ? row.require : [], isAutoFill: false };
            if (!Array.isArray(row.removeTags)) row.removeTags = [];
            return row;
        });

        const embeds = rows.filter(r => r.category === 'embed');
        
        if (amRules.length === 0) {
            if (manual && window.showAlert) window.showAlert('No Auto-Do rules configured.', 'warn');
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
            
            if (window.showAlert) window.showAlert(`Auto-Do applied to ${changedCount} image(s)!`, 'success');
        } else {
            if (manual && window.showAlert) window.showAlert('No matching tags found to automate.', 'info');
        }
    };

    function hookAutoMergeLoader() {
        if (window._autoMergeHooked) return;
        if (typeof window.registerAutoDatasetTask === 'function') {
            window.registerAutoDatasetTask('auto-merge', async () => {
                const autoRun = await window.getSetting('rm_auto_merge', false);
                if (autoRun && window.enableConflictWarnings !== false) {
                    await window.runAutoMergeOnDataset(false);
                }
            });
            window._autoMergeHooked = true;
            return;
        }
        let _lastImageFilesRef = null;
        const _origRender = window.renderImageList;
        if (typeof _origRender === 'function') {
            window.renderImageList = function() {
                if (window.imageFiles && window.imageFiles !== _lastImageFilesRef) {
                    _lastImageFilesRef = window.imageFiles;
                    window.getSetting('rm_auto_merge', false).then(autoRun => {
                        if (autoRun && window.enableConflictWarnings !== false) {
                            setTimeout(() => window.runAutoMergeOnDataset(false), 100);
                        }
                    });
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

    async function applyUserRulesToGlobals() {
        const rows = await getAllRules();
        window._userConflictRules = rows;

        if (window.enableConflictWarnings === false) {
            window.tagConflicts = [];
            window.tagSimilar = [];
        } else {
            const isRedEnabled = await window.getSetting('rm_enable_red', true);
            const isYellowEnabled = await window.getSetting('rm_enable_yellow', true);

            window.tagConflicts = isRedEnabled ? rows.filter(r => r.category === 'conflict').map(r => Array.isArray(r.tags) ? r.tags : []) : [];
            window.tagSimilar = isYellowEnabled ? rows.filter(r => r.category === 'similar').map(r => Array.isArray(r.tags) ? r.tags : []) : [];
        }

        window.tagHighlightGroups = rows.filter(r => r.category === 'highlight');
        const hlMap = new Map();
        window.tagHighlightGroups.forEach(g => {
            (Array.isArray(g.tags) ? g.tags : []).forEach(t => {
                const key = String(t).toLowerCase();
                if (!hlMap.has(key)) hlMap.set(key, { name: g.name || '', color: g.color || '#4db8ff' });
            });
        });
        window._tagHighlightMap = hlMap;

        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.renderPresetTags === 'function') window.renderPresetTags();
        if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
    }

    window.reloadUserConflictRules = applyUserRulesToGlobals;

    window.restoreDefaultRules = async function() {
        if (!confirm(`Restore ALL original default rules across ALL categories?\n\n- Your custom rules & embeds WILL BE KEPT intact!`)) return;
        await window.saveSetting('deleted-default-rules', []);
        await applyUserRulesToGlobals();
        if (document.getElementById('modal-conflict-manager')) await refreshModalBody(); 
        if (window.showAlert) window.showAlert('All original rules restored successfully!', 'success');
    };

    window.restoreCategoryDefaults = async function(category) {
        const catName = category.charAt(0).toUpperCase() + category.slice(1);
        if (!confirm(`Restore original default rules for ${catName} only?\n\n- Your custom rules in this category will be kept.`)) return;
        
        let deletedDefaults = await window.getSetting('deleted-default-rules', []);
        if (!Array.isArray(deletedDefaults)) deletedDefaults = [];
        const factoryRules = getFactoryRules();
        const catDefIds = factoryRules.filter(r => r.category === category).map(r => r.id);
        
        deletedDefaults = deletedDefaults.filter(id => !catDefIds.includes(id));
        await window.saveSetting('deleted-default-rules', deletedDefaults);
        
        await applyUserRulesToGlobals();
        if (document.getElementById('modal-conflict-manager')) await refreshModalBody();
        if (window.showAlert) window.showAlert(`${catName} defaults restored!`, 'success');
    };

    window.clearAllRules = async function() {
        if (!confirm(`WARNING: This will delete ALL rules and embeds.\nAre you sure?`)) return;
        
        await window.saveSetting('custom-conflict-rules', []);
        
        const allDefIds = getFactoryRules().map(r => r.id);
        await window.saveSetting('deleted-default-rules', allDefIds);
        
        await applyUserRulesToGlobals();
        await refreshModalBody();
        if (window.showAlert) window.showAlert('All rules have been deleted.', 'success');
    };

    /* ---------- UI (INTERFACE PRINCIPAL) ---------- */
    const CATEGORY_META = {
        conflict: { 
            label: "🚨 Conflicts (Red)", 
            color: "#ff6060", 
            hint: "Tags that must never coexist in the same image.",
            desc: "Prevents contradictory tags. Highlights them in red to warn you of a logical error."
        },
        similar: { 
            label: "🟨 Similar (Yellow)", 
            color: "#ffcc66", 
            hint: "Redundant tags that trigger a visual warning.",
            desc: "Groups synonymous or overlapping tags. Highlights them in yellow to suggest keeping only one."
        },
        automerge: { 
            label: "⚡ Auto-Do (Unified)", 
            color: "#00ff99", 
            hint: "Consolidates redundant tags and applies advanced conditional checks.",
            desc: "Auto-Merge: Removes Trigger tags and adds Main Tag. Auto-Fill: Keeps Trigger tags and adds Main Tag."
        },
        highlight: {
            label: "🎨 Custom Highlights",
            color: "#4db8ff",
            hint: "Custom-colored groups of tags, shown with an icon + tint in the tag lists.",
            desc: "Two kinds live here: 🔒 Built-in Highlights (Favorite/Preset/Filter — color + on/off only, can't be deleted) and 📁 Custom Groups you create yourself (e.g. 'eye orientation') with your own tags + color. Matching tags get tinted and, for custom groups, a 🔖 icon next to the star with 'Belongs to: <group>' on hover — independent of the Conflicts/Similar toggle above."
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

        /* --- Custom Highlights --- */
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
                        <button class="btn-top-action" onclick="window.runAutoMergeOnDataset(true)" style="background:#00aa66; border-color:#00cc88; color:#000;">▶ Run Auto-Do Now</button>
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

    function renderCategorySection(category, rows, isChecked) {
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
                cb.onchange = async (e) => {
                    if (category === 'conflict') { await window.saveSetting('rm_enable_red', e.target.checked); applyUserRulesToGlobals(); }
                    if (category === 'similar') { await window.saveSetting('rm_enable_yellow', e.target.checked); applyUserRulesToGlobals(); }
                    if (category === 'automerge') { await window.saveSetting('rm_auto_merge', e.target.checked); }
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
                let rems = Array.isArray(row.removeTags) ? row.removeTags : [];
                let reqs = Array.isArray(row.require) ? row.require : [];
                let excs = Array.isArray(row.exclude) ? row.exclude : [];
                let isAutoFill = !!row.isAutoFill;
                
                if (row.tags && Array.isArray(row.tags)) { 
                    keep = row.tags[0] || ''; 
                    rems = row.tags.slice(1); 
                } else if (row.target) { 
                    keep = row.fallback || ''; 
                    rems = [row.target]; 
                    reqs = Array.isArray(row.exclude) ? row.exclude : []; 
                    excs = Array.isArray(row.require) ? row.require : []; 
                }

                const modeBadge = isAutoFill 
                    ? '<span style="background:#1a3a5c; color:#4db8ff; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2a5a8c; margin-left:4px;">Fill</span>'
                    : '<span style="background:#5c1a1a; color:#ff6060; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #7a222c; margin-left:4px;">Merge</span>';

                item.innerHTML = `
                    <div style="flex:1; display:flex; flex-direction: column; gap: 6px; overflow: hidden;">
                        <div>${badge}${modeBadge} <b style="color:${isAutoFill ? '#4db8ff' : '#ff6060'}; font-size:11px; margin-left:4px;">[${escapeHTML(rems.join(', '))}]</b> ${keep ? `<span style="color:#888; font-size:10px; margin: 0 4px;">→</span> <b style="color:#00ff99; font-size:12px;">${isAutoFill ? '+ ' : ''}${escapeHTML(keep)}</b>` : `<span style="color:#888; font-size:10px; margin-left:4px;">(Removed)</span>`}</div>
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
                        `Edit Rule:\nFormat: Main Tag | Triggers (Remove/Check) | Requires | Excludes | isAutoFill (true/false)`, 
                        `${keep} | ${rems.join(', ')} | ${reqs.join(', ')} | ${excs.join(', ')} | ${isAutoFill}`
                    );
                    if (input === null) return;
                    const parts = input.split('|').map(s => s.trim());
                    if (parts.length < 2) { if (window.showAlert) window.showAlert('Invalid format.', 'error'); return; }
                    
                    const data = {
                        keepTag: parts[0],
                        removeTags: parts[1].split(',').map(t=>t.trim()).filter(t=>t),
                        require: parts[2] ? parts[2].split(',').map(t=>t.trim()).filter(t=>t) : [],
                        exclude: parts[3] ? parts[3].split(',').map(t=>t.trim()).filter(t=>t) : [],
                        isAutoFill: parts[4] === 'true'
                    };
                    if (data.removeTags.length === 0) { if (window.showAlert) window.showAlert('Triggers cannot be empty.', 'error'); return; }
                    
                    await updateRule(row.id, data); 
                    await applyUserRulesToGlobals();
                    refreshModalBody();
                };
            } else {
                const safeTags = Array.isArray(row.tags) ? row.tags : [];
                const safeTagsText = escapeHTML(safeTags.join(', '));
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
                    const input = prompt('Edit simple group (comma-separated tags):', safeTags.join(', '));
                    if (input === null) return;
                    const newTags = input.split(',').map(t => t.trim()).filter(t => t);
                    if (newTags.length < 2) { if (window.showAlert) window.showAlert('A group needs at least 2 tags.', 'warn'); return; }
                    await updateRule(row.id, newTags); 
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
                
                const reqStr = addRow.querySelector('.cond-req').value;
                const excStr = addRow.querySelector('.cond-exc').value;
                
                const data = {
                    keepTag: keep,
                    removeTags: removeStr.split(',').map(t=>t.trim()).filter(t=>t),
                    require: reqStr.split(',').map(t=>t.trim()).filter(t=>t),
                    exclude: excStr.split(',').map(t=>t.trim()).filter(t=>t),
                    isAutoFill: isAutoFill
                };
                
                await addRule(category, data, false); 
                
                addRow.querySelector('.cond-keep').value = '';
                addRow.querySelector('.cond-remove').value = '';
                addRow.querySelector('.cond-req').value = '';
                addRow.querySelector('.cond-exc').value = '';
                
                await applyUserRulesToGlobals();
                refreshModalBody();
            };

            addRow.querySelector('.cond-add-fill-btn').onclick = () => doAddAutoDo(true);
            addRow.querySelector('.cond-add-merge-btn').onclick = () => doAddAutoDo(false);

        } else {
            addRow.style.cssText = 'display: flex; gap: 8px; padding: 12px 15px; background: #111; align-items: center; flex: 0 0 auto; border-top: 1px solid #222;';
            addRow.innerHTML = `
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
        
        const isRedEnabled = await window.getSetting('rm_enable_red', true);
        const isYellowEnabled = await window.getSetting('rm_enable_yellow', true);
        const isAutoMergeEnabled = await window.getSetting('rm_auto_merge', false);

        body.appendChild(renderCategorySection('conflict', rows, isRedEnabled));
        body.appendChild(renderCategorySection('similar', rows, isYellowEnabled));
        body.appendChild(renderCategorySection('automerge', rows, isAutoMergeEnabled));
        body.appendChild(renderHighlightSection(rows));
    }

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

        const builtinToggle = document.createElement('div');
        builtinToggle.style.cssText = 'font-size:10px; color:#aaa; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px; padding: 8px 10px; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; transition: 0.15s; margin-bottom: 2px;';
        builtinToggle.innerHTML = `<span>🔒 Built-in Highlights <span style="font-size:9px; color:#666; text-transform:none; margin-left:5px;">(color + on/off only)</span></span> <span class="toggle-icon" style="font-size: 12px;">▼</span>`;
        
        builtinToggle.onmouseover = () => builtinToggle.style.background = '#222';
        builtinToggle.onmouseout = () => builtinToggle.style.background = '#1a1a1a';

        list.appendChild(builtinToggle);

        const builtinContainer = document.createElement('div');
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
            const safeTags = Array.isArray(row.tags) ? row.tags : [];

            const item = document.createElement('div');
            item.className = 'conflict-group-item';
            item.style.cssText = `display:flex; align-items:center; gap:10px; background:#151515; border:1px solid #2a2a2a; border-left:3px solid ${color}; border-radius:6px; padding:8px 10px;`;

            item.innerHTML = `
                <input type="color" class="hl-color-input" value="${color}" title="Change highlight color">
                <div style="flex:1; display:flex; flex-direction: column; gap: 4px; overflow: hidden;">
                    <b style="color:${color}; font-size:13px;">${escapeHTML(row.name || '')}</b>
                    <span style="font-size:12px; color:#ddd; word-break:break-word; line-height: 1.3;">${escapeHTML(safeTags.join(', '))}</span>
                </div>
                <div style="display:flex; flex-direction: column; gap:4px; flex-shrink:0;">
                    <button class="btn-hl-edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️</button>
                    <button class="btn-hl-delete" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                </div>
            `;

            item.querySelector('.hl-color-input').onchange = async (e) => {
                const newColor = e.target.value;
                await updateRule(row.id, { name: row.name, tags: safeTags, color: newColor });
                await applyUserRulesToGlobals();
                item.style.borderLeftColor = newColor;
                const bEl = item.querySelector('b');
                if (bEl) bEl.style.color = newColor;
            };

            item.querySelector('.btn-hl-edit').onclick = async () => {
                const newName = prompt('Group name:', row.name || '');
                if (newName === null || !newName.trim()) return;
                const newTagsStr = prompt('Tags (comma-separated):', safeTags.join(', '));
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
        if (!confirm(`Restore all Built-in Highlight colors (Favorite, Preset, Filter, NL, Selection) to their factory defaults?\nThis does NOT change their on/off state.`)) return;
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
        
        let deletedDefaults = await window.getSetting('deleted-default-rules', []);
        if (!Array.isArray(deletedDefaults)) deletedDefaults = [];
        
        const factoryRules = getFactoryRules();
        const embDefIds = factoryRules.filter(r => r.category === 'embed').map(r => r.id);
        
        deletedDefaults = deletedDefaults.filter(id => !embDefIds.includes(id));
        await window.saveSetting('deleted-default-rules', deletedDefaults);
        
        await applyUserRulesToGlobals();
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

            const safeTags = Array.isArray(emb.tags) ? emb.tags : [];
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
                    ${escapeHTML(safeTags.join(', '))}
                </div>
            `;
            
            el.querySelector('.btn-emb-edit').onclick = async () => {
                const input = prompt(`Edit @${emb.name} (comma-separated):`, safeTags.join(', '));
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
        try {
            buildModal();
            await refreshModalBody();
            window.openModal('modal-conflict-manager');
        } catch (err) {
            console.error("Modal Render Error: ", err);
            if (window.showAlert) window.showAlert("Error opening the rules panel. Check the console.", "error");
        }
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

    async function initTagManagerRules() {
        // Executa a migração ANTES de inicializar qualquer outra coisa
        await migrateOldIndexedDB();

        if (typeof window.getSetting === 'function') {
            window.enableConflictWarnings = await window.getSetting('toggle-conflict-warnings', true);
        }

        await cleanBloatedJSON();

        relocateBuiltinHighlightToggles();
        await loadBuiltinHighlightColors();
        wrapRenderersForHighlights();

        overrideOriginalSystems();
        injectButton();
        hookAutoMergeLoader();
        
        await applyUserRulesToGlobals();
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initTagManagerRules);
    } else {
        initTagManagerRules();
    }

})();

/* =========================================================================
   ISSUE COUNTERS (CONFLICTS & SIMILARS)
   Contadores individuais nas barras do Active Image e All Dataset Tags
========================================================================= */

window.enableCounterConflict = true;
window.enableCounterSimilar = true;
window.issueImagesMap = { conflict: [], similar: [] };

window.toggleCounterConflict = async function(skipSave = false) {
    const cb = document.getElementById('toggle-counter-conflict');
    if (cb) {
        window.enableCounterConflict = cb.checked;
        if (!skipSave && typeof window.saveSetting === 'function') await window.saveSetting('enable-counter-conflict', cb.checked);
    }
    window.updateGlobalIssueCounters();
    window.updateActiveIssueCounters();
};

window.toggleCounterSimilar = async function(skipSave = false) {
    const cb = document.getElementById('toggle-counter-similar');
    if (cb) {
        window.enableCounterSimilar = cb.checked;
        if (!skipSave && typeof window.saveSetting === 'function') await window.saveSetting('enable-counter-similar', cb.checked);
    }
    window.updateGlobalIssueCounters();
    window.updateActiveIssueCounters();
};

window.getIssuesCountForTags = function(tagsArray) {
    let confCount = 0;
    let simCount = 0;
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

// ==========================================
// 1. ALL DATASET TAGS
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
// 2. ACTIVE IMAGE
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
// AÇÃO DE CLIQUE
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
    
    window.updateGlobalIssueCounters();
    window.updateActiveIssueCounters();
}

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
========================================================================= */

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

document.addEventListener('mouseover', (e) => {
    if (e.target.id === 'active-counter-conflict') {
        document.querySelectorAll('#tag-list-vertical .tag-row.conflict').forEach(el => el.classList.add('glow-conflict'));
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
    else if (e.target.id === 'active-counter-similar') {
        document.querySelectorAll('#tag-list-vertical .tag-row.similar').forEach(el => el.classList.add('glow-similar'));
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

document.addEventListener('mouseout', (e) => {
    if (e.target.id === 'active-counter-conflict' || 
        e.target.id === 'active-counter-similar' || 
        e.target.classList.contains('conflict-warning') || 
        e.target.classList.contains('similar-warning')) {
        
        document.querySelectorAll('.glow-conflict').forEach(el => el.classList.remove('glow-conflict'));
        document.querySelectorAll('.glow-similar').forEach(el => el.classList.remove('glow-similar'));
    }
});