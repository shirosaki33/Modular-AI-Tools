/* =========================================================================
   UI LOGIC - USER PRESETS (v5 - TEST VERSION)
   ---------------------------------------------------------------------
   The side panel is a quick "apply" tool that also edits presets in place.

   SIDE PANEL (#col-presets)
   - JS-owned shell (no HTML change needed). All the IDs other modules rely
     on are kept: preset-tag-list, preset-selection-actions, preset-add-pos,
     preset-add-input, btn-preset-search-toggle, col-presets, resizer-presets,
     btn-toggle-presets.
   - ONE flat list: every tag is visible, with its category as a colored
     badge. Each row has its own buttons: ➕ adds the tag to the SELECTED
     images, 🌐 adds it to ALL images, hover ✕ removes it from presets. One
     wiki icon per tag: red ❓ = Danbooru only, white ❔ = e621 only, ⁉️ =
     both (opens the Tag Interrogator); nothing when no site has a wiki.
   - Clicking a row selects it (Shift = range). While tags are selected a bar
     appears at the TOP: "➕ N → Selected", "🌐 N → All", remove, clear.
   - The only permanent control at the top is the position [Bot | Top]
     ('preset-pos').
   - ☰ Filter & sort (bottom): two independent sort buttons, each cycling
     A–Z → Z–A → off: Category and Name. Both on = categories sorted, and the
     tags sorted inside each one. Both off = order the tags were saved.
     ('preset-sort-cat', 'preset-sort-name', 'preset-hidden-cats').
   - "Highlight" checkbox in the title bar (Highlights Always Visible).
   - ✓ / ◐ markers show which tags the SELECTED images already have.
   - Every add / remove shows a status line with Undo (no confirm() popups).

   EDITING (no separate manager any more)
   - ☰ Filter & sort menu: add a category, rename it (✏️), remove it (🗑️,
     tags go to Uncategorized, Undo available), show / hide it, sort.
   - Each row: click the category badge to move the tag to another category;
     hover ✕ removes the tag from presets (Undo available).
   - The search box saves the typed tag(s) on Enter into the category chosen
     in the select next to it (comma separated). There is no Save button.

   CONTRACT KEPT FOR OTHER MODULES
   - window._presetTagsSet, window.renderPresetTags (async, re-wrapped by
     tagmanager_rule_similar.js), window.togglePresetPanel,
     window.filterPresetTagsByName, window.presetHighlightsAlwaysVisible,
     window.togglePresetHighlightAlways, window.addSelectedPresetTagsTo,
     window.removeSelectedPresetTags,
     window.addPresetTagFromInput, window.refreshPresetTagsSet, `.master-tag-item`
     rows with a `.tag-name` child (needed by the Similar/Conflict hooks).
========================================================================= */

window.selectedPresetCategory = null;
window.presetCategoryCollapseState = {};

// Controla se os highlights ficam sempre visíveis
window.presetHighlightsAlwaysVisible = false;

// UI state of the side panel (persisted through saveSetting)
window._presetUI = { mode: 'select', target: 'selected', pos: 'bottom', sortCat: 'asc', sortName: 'asc', hiddenCats: [], view: 'grouped' };

/* ---------------------------------------------------------------------
   CACHE EM MEMÓRIA DOS PRESET TAGS
   ---------------------------------------------------------------------
   Os itens ficam cacheados em window._presetItemsCache. O cache só é
   invalidado quando os presets REALMENTE mudam (savePresetTag /
   deletePresetTag, via wrap logo abaixo, sem tocar em tagmanager_db.js). */
window._presetItemsCache = null;

(function wrapPresetTagCacheInvalidation() {
    // skipRender: em savePresetTag(tag, category, skipRender) é o 3º argumento
    // (índice 2); em deletePresetTag(tag, skipRender) é o 2º (índice 1).
    function wrapInvalidate(fnName, skipRenderArgIndex) {
        const original = window[fnName];
        if (typeof original !== 'function' || original.__cacheWrapped) return;
        const wrapped = function (...args) {
            window._presetItemsCache = null;
            const result = original.apply(this, args);
            const skipRender = args[skipRenderArgIndex] === true;
            if (!skipRender) {
                Promise.resolve(result).then(() => refreshTagListsAfterPresetChange());
            }
            return result;
        };
        wrapped.__cacheWrapped = true;
        window[fnName] = wrapped;
    }
    const tryWrap = () => {
        if (typeof window.savePresetTag === 'function' && typeof window.deletePresetTag === 'function') {
            wrapInvalidate('savePresetTag', 2);
            wrapInvalidate('deletePresetTag', 1);
            return true;
        }
        return false;
    };
    if (!tryWrap()) window.addEventListener('DOMContentLoaded', tryWrap);
})();

function refreshTagListsAfterPresetChange() {
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function' && typeof selectedIndices !== 'undefined' && selectedIndices.size > 0) window.renderEditor();
}

async function getCachedPresetTags() {
    if (!window._presetItemsCache) {
        window._presetItemsCache = await window.getPresetTags();
    }
    return window._presetItemsCache;
}

/* Set em memória com o NOME de cada tag já salva nos User Presets (exclui as
   entradas "_sys_cat_*", que são só marcadores de categoria). Usado por
   tagmanager_caption_tag.js (ícone 💾 e destaque .is-preset). */
window._presetTagsSet = window._presetTagsSet || new Set();

window.refreshPresetTagsSet = async function () {
    try {
        const items = await getCachedPresetTags();
        window._presetTagsSet = new Set(
            items.map(i => i.tag).filter(t => !t.startsWith('_sys_cat_'))
        );
    } catch (e) {
        console.error('refreshPresetTagsSet failed:', e);
    }
    return window._presetTagsSet;
};

window.togglePresetHighlightAlways = async function (isChecked) {
    window.presetHighlightsAlwaysVisible = isChecked;
    if (typeof window.saveSetting === 'function') {
        await window.saveSetting('preset-highlights-always-visible', isChecked);
    }
    refreshTagListsAfterPresetChange();
};

/* =========================================================================
   SMALL HELPERS
========================================================================= */
function ppEl(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
}

function ppAlert(msg, type) {
    if (typeof window.showAlert === 'function') window.showAlert(msg, type || 'info');
}

function ppIsPanelVisible() {
    const panel = document.getElementById('col-presets');
    return !!panel && panel.style.display !== 'none' && panel.style.display !== '';
}

function ppTagsOf(img) {
    return img && img.content ? img.content.split(',').map(t => t.trim()).filter(t => t) : [];
}

function ppRebuildMasterTagSet() {
    if (typeof masterTagSet === 'undefined' || typeof imageFiles === 'undefined') return;
    masterTagSet.clear();
    imageFiles.forEach(img => {
        if (img.type === 'tags' && img.content) img.content.split(',').forEach(t => { if (t.trim()) masterTagSet.add(t.trim()); });
    });
}

function ppRefreshAfterContentChange() {
    if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
    if (typeof window.renderImageList === 'function') window.renderImageList();
    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
    if (typeof window.applyFilters === 'function') window.applyFilters();
    // presets list: only the rows in view are redrawn (usage counts + markers), no full re-render
    PP.counts = ppComputeTagCounts();
    ppComputeMarks();
    ppRepaint();
}

// Usage count of every tag in the current dataset (visible images only)
function ppComputeTagCounts() {
    const tagCounts = new Map();
    if (typeof imageFiles !== 'undefined') {
        imageFiles.forEach(img => {
            if (img.hidden) return;
            if (img.type === 'tags' && img.hasFile && img.content) {
                img.content.split(',').forEach(t => {
                    const clean = t.trim();
                    if (clean) tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
                });
            }
        });
    }
    return tagCounts;
}

// byCat: Map(category -> sorted tag names), keys: categories in saved order
async function ppGetOrderedCategories(items) {
    const byCat = new Map();
    items.forEach(it => {
        const c = it.category || 'Uncategorized';
        if (!byCat.has(c)) byCat.set(c, []);
        if (!it.tag.startsWith('_sys_cat_')) byCat.get(c).push(it.tag);
    });
    let order = await window.getSetting('preset-cat-order', []);
    if (!Array.isArray(order)) order = [];
    let changed = false;
    byCat.forEach((_, k) => { if (!order.includes(k)) { order.push(k); changed = true; } });
    if (changed) await window.saveSetting('preset-cat-order', order);
    const keys = Array.from(byCat.keys()).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return { byCat, keys, order };
}

/* savePresetTag(tag, 'Uncategorized') KEEPS the old category (see db.js), so to
   really move a tag to Uncategorized we delete it first and save it again. */
async function ppSetCategory(tag, cat) {
    if (!cat || cat === 'Uncategorized') {
        await window.deletePresetTag(tag, true);
        await window.savePresetTag(tag, 'Uncategorized', true);
    } else {
        await window.savePresetTag(tag, cat, true);
    }
}

async function ppEnsureCategoryMarker(cat) {
    if (!cat || cat === 'Uncategorized') return;
    const items = await getCachedPresetTags();
    if (!items.some(i => i.tag === `_sys_cat_${cat}`)) await window.savePresetTag(`_sys_cat_${cat}`, cat, true);
}

async function ppAfterMutation() {
    window._presetItemsCache = null;
    await window.refreshPresetTagsSet();
    refreshTagListsAfterPresetChange();
    await window.renderPresetTags();
}

/* =========================================================================
   STATUS LINE + UNDO (side panel footer and modal footer)
========================================================================= */
let _ppStatusTimer = null;
window._presetUndoFn = null;

function ppSetStatus(msg, undoFn) {
    clearTimeout(_ppStatusTimer);
    window._presetUndoFn = undoFn || null;
    document.querySelectorAll('.preset-status-host').forEach(host => {
        host.innerHTML = '';
        if (!msg) { host.style.display = 'none'; return; }
        host.style.display = 'flex';
        host.appendChild(ppEl('span', 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;', msg)).title = msg;
        if (undoFn) {
            const b = ppEl('button', '', '↩ Undo');
            b.className = 'pp-undo-btn';
            b.onclick = () => window.undoLastPresetAction();
            host.appendChild(b);
        }
    });
    if (msg) _ppStatusTimer = setTimeout(() => ppSetStatus(''), 10000);
}

window.undoLastPresetAction = async function () {
    const fn = window._presetUndoFn;
    ppSetStatus('');
    if (typeof fn === 'function') await fn();
};

/* =========================================================================
   APPLY TAGS TO IMAGES (with undo)
========================================================================= */
window.applyPresetTags = function (tagsInput, target) {
    const tags = Array.from(new Set((tagsInput || []).filter(Boolean)));
    if (tags.length === 0) return null;
    target = target || window._presetUI.target;
    const pos = window._presetUI.pos === 'top' ? 'top' : 'bottom';
    const extEl = document.getElementById('topbar-save-format');
    const globalExt = (extEl && extEl.value) || 'txt';

    let targets = [];
    if (target === 'selected') {
        targets = Array.from(selectedIndices).map(i => imageFiles[i]).filter(Boolean);
        if (targets.length === 0) { ppAlert('No images selected on the left list.', 'error'); return null; }
    } else {
        targets = imageFiles.filter(img => !img.hidden);
        if (targets.length === 0) { ppAlert('No images loaded.', 'warn'); return null; }
    }

    const snapshots = [];
    targets.forEach(img => {
        if (!(img.type === 'tags' || !img.hasFile)) return;
        const current = ppTagsOf(img);
        const have = new Set(current);
        const toAdd = tags.filter(t => !have.has(t));
        if (toAdd.length === 0) return;
        snapshots.push({ img, content: img.content, hasFile: img.hasFile, type: img.type, ext: img.ext, dirty: !!img.dirty });
        const merged = pos === 'top' ? [...toAdd, ...current] : [...current, ...toAdd];
        img.content = merged.join(', ');
        img.hasFile = true;
        img.type = 'tags';
        if (!img.ext) img.ext = globalExt;
    });

    const label = tags.length === 1 ? `"${tags[0]}"` : `${tags.length} tags`;
    if (snapshots.length === 0) {
        ppSetStatus(`${label} already on ${targets.length} image(s) — nothing to add.`);
        return { changed: 0, total: targets.length };
    }

    window.markDirty(snapshots.map(s => s.img));
    tags.forEach(tag => { if (typeof masterTagSet !== 'undefined') masterTagSet.add(tag); });
    ppRefreshAfterContentChange();

    const skipped = targets.length - snapshots.length;
    ppSetStatus(
        `Added ${label} to ${snapshots.length} image(s)` + (skipped > 0 ? ` (${skipped} already had it)` : ''),
        async () => {
            let restored = 0;
            snapshots.forEach(s => {
                if (imageFiles.indexOf(s.img) < 0) return; // dataset changed meanwhile
                s.img.content = s.content; s.img.hasFile = s.hasFile; s.img.type = s.type; s.img.ext = s.ext;
                if (!s.dirty && typeof window.markClean === 'function') window.markClean(s.img);
                restored++;
            });
            ppRebuildMasterTagSet();
            ppRefreshAfterContentChange();
            ppSetStatus(restored > 0 ? `Undone on ${restored} image(s).` : 'Nothing to undo (the dataset changed).');
        }
    );
    return { changed: snapshots.length, total: targets.length };
};

// Backwards compatible entry point (old "Add" / "Add to All" buttons)
window.addSelectedPresetTagsTo = function (target) {
    if (presetSelectedTags.size === 0) return;
    window.applyPresetTags(Array.from(presetSelectedTags), target);
};

window.clearPresetSelection = function () {
    presetSelectedTags.clear();
    ppRepaint();
    window.updatePresetSelectionActions();
};

window.removeSelectedPresetTags = async function () {
    if (presetSelectedTags.size === 0) return;
    const items = await getCachedPresetTags();
    const removed = Array.from(presetSelectedTags).map(tag => {
        const it = items.find(i => i.tag === tag);
        return { tag, cat: it ? it.category : 'Uncategorized' };
    });
    for (const r of removed) await window.deletePresetTag(r.tag, true);
    presetSelectedTags.clear();
    window.updatePresetSelectionActions();
    await ppAfterMutation();
    ppSetStatus(`Removed ${removed.length} tag(s) from presets`, async () => {
        for (const r of removed) { await ppSetCategory(r.tag, r.cat); }
        await ppAfterMutation();
        ppSetStatus(`Restored ${removed.length} preset tag(s).`);
    });
};

window.updatePresetSelectionActions = function () {
    const bar = document.getElementById('preset-selection-actions');
    if (!bar) return;
    const show = presetSelectedTags.size > 0;
    bar.style.display = show ? 'flex' : 'none';
    const applyBtn = document.getElementById('pp-sel-apply');
    if (applyBtn) applyBtn.textContent = `➕ ${presetSelectedTags.size} Selected`;
    const allBtn = document.getElementById('pp-sel-all');
    if (allBtn) allBtn.textContent = `🌐 ${presetSelectedTags.size} All`;
};

/* =========================================================================
   SAVE TAGS TO PRESETS (bottom field)
========================================================================= */
window.addPresetTagFromInput = async function () {
    const input = document.getElementById('preset-add-input');
    if (!input) return;
    const tags = input.value.split(',').map(t => t.trim()).filter(t => t && !t.startsWith('_sys_cat_'));
    if (tags.length === 0) { ppAlert('Type a tag first.', 'warn'); return; }
    const sel = document.getElementById('pp-saveto');
    const cat = sel && sel.value ? sel.value : 'Uncategorized';
    const items = await getCachedPresetTags();
    const known = new Map(items.map(i => [i.tag, i.category]));
    let added = 0, moved = 0, same = 0;
    for (const t of tags) {
        if (!known.has(t)) added++;
        else if (cat !== 'Uncategorized' && known.get(t) !== cat) moved++;
        else same++;
        await window.savePresetTag(t, cat, true);
    }
    input.value = '';
    window.presetTagNameFilter = '';
    await ppAfterMutation();
    const parts = [];
    if (added) parts.push(`${added} saved`);
    if (moved) parts.push(`${moved} moved to "${cat}"`);
    if (same) parts.push(`${same} already in presets`);
    ppSetStatus(parts.join(', ') + '.');
};


/* =========================================================================
   CATEGORY OPERATIONS (shared by the side panel API and the modal)
========================================================================= */
async function ppRenameCategory(oldName, newNameRaw) {
    const newName = (newNameRaw || '').trim();
    if (!oldName || oldName === 'Uncategorized') return false;
    if (!newName || newName === oldName) return false;
    if (newName === 'Uncategorized' || newName.startsWith('_sys_cat_')) { ppAlert('That category name is reserved.', 'warn'); return false; }

    const items = await getCachedPresetTags();
    const exists = items.some(i => i.category === newName);
    if (exists && !confirm(`Category "${newName}" already exists. Merge "${oldName}" into it?`)) return false;

    await window.deletePresetTag(`_sys_cat_${oldName}`, true);
    await window.savePresetTag(`_sys_cat_${newName}`, newName, true);
    for (const item of items) {
        if (item.category === oldName && !item.tag.startsWith('_sys_cat_')) await window.savePresetTag(item.tag, newName, true);
    }

    let order = await window.getSetting('preset-cat-order', []);
    if (!Array.isArray(order)) order = [];
    const idx = order.indexOf(oldName);
    if (order.includes(newName)) order = order.filter(c => c !== oldName);
    else if (idx > -1) order[idx] = newName;
    await window.saveSetting('preset-cat-order', order);
    if (window._presetUI.hiddenCats.includes(oldName)) {
        window._presetUI.hiddenCats = window._presetUI.hiddenCats.map(c => c === oldName ? newName : c);
        window.saveSetting('preset-hidden-cats', window._presetUI.hiddenCats);
    }

    if (window.presetCategoryCollapseState[oldName] !== undefined) {
        window.presetCategoryCollapseState[newName] = window.presetCategoryCollapseState[oldName];
        delete window.presetCategoryCollapseState[oldName];
        window.saveSetting('preset-cat-collapse', window.presetCategoryCollapseState);
    }
    if (window.selectedPresetCategory === oldName) window.selectedPresetCategory = newName;
    await ppAfterMutation();
    ppSetStatus(`Category renamed to "${newName}".`);
    return true;
}

async function ppDeleteCategory(catName) {
    if (!catName || catName === 'Uncategorized') return false;
    const items = await getCachedPresetTags();
    const members = items.filter(i => i.category === catName && !i.tag.startsWith('_sys_cat_')).map(i => i.tag);

    let order = await window.getSetting('preset-cat-order', []);
    if (!Array.isArray(order)) order = [];
    const orderIdx = order.indexOf(catName);

    await window.deletePresetTag(`_sys_cat_${catName}`, true);
    for (const t of members) await ppSetCategory(t, 'Uncategorized');
    await window.saveSetting('preset-cat-order', order.filter(c => c !== catName));
    if (window.selectedPresetCategory === catName) window.selectedPresetCategory = null;
    const wasHidden = window._presetUI.hiddenCats.includes(catName);
    if (wasHidden) { window._presetUI.hiddenCats = window._presetUI.hiddenCats.filter(c => c !== catName); window.saveSetting('preset-hidden-cats', window._presetUI.hiddenCats); }
    await ppAfterMutation();

    ppSetStatus(`Category "${catName}" deleted` + (members.length ? ` (${members.length} tag(s) moved to Uncategorized)` : '') + `.`, async () => {
        await window.savePresetTag(`_sys_cat_${catName}`, catName, true);
        for (const t of members) await window.savePresetTag(t, catName, true);
        let ord = await window.getSetting('preset-cat-order', []);
        if (!Array.isArray(ord)) ord = [];
        ord = ord.filter(c => c !== catName);
        ord.splice(orderIdx > -1 ? orderIdx : ord.length, 0, catName);
        await window.saveSetting('preset-cat-order', ord);
        await ppAfterMutation();
        ppSetStatus(`Category "${catName}" restored.`);
    });
    return true;
}


/* =========================================================================
   SIDE PANEL SHELL
========================================================================= */
function ppInjectStyles() {
    if (document.getElementById('preset-panel-style')) return;
    const st = document.createElement('style');
    st.id = 'preset-panel-style';
    st.textContent = `
        #col-presets .pp-controls { display:flex; flex-direction:column; gap:6px; padding:8px 10px; background:#151515; border-bottom:1px solid #222; flex-shrink:0; }
        #col-presets .pp-ctl-row { display:flex; gap:6px; align-items:center; }
        .pp-seg { display:flex; flex:1; min-width:0; border:1px solid #333; border-radius:6px; overflow:hidden; }
        .pp-seg button { flex:1; min-width:0; background:#1a1a1a; color:#888; border:none; border-right:1px solid #333; border-radius:0; padding:5px 4px; font-size:11px; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .pp-seg button:last-child { border-right:none; }
        .pp-seg button:hover { background:#222; color:#eee; }
        .pp-seg button.on { background:#0b2a28; color:#2dd4bf; }
        .pp-lbl { font-size:10px; color:#666; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px; width:46px; flex-shrink:0; white-space:nowrap; }
        .pp-badge { background:#333; color:#ccc; padding:2px 6px; border-radius:4px; font-size:11px; }
        #col-presets .panel-header { gap:6px; flex-wrap:wrap; }
        .pp-hl { font-size:10px; color:#aaa; display:flex; align-items:center; gap:4px; cursor:pointer; user-select:none; background:#111; border:1px solid #333; border-radius:6px; padding:3px 6px; white-space:nowrap; }
        .pp-hl:hover { color:#fff; border-color:#2dd4bf; }
        .pp-hl input { margin:0; accent-color:#2dd4bf; }
        #preset-tag-list { position:relative; }
        #pp-vport { position:relative; width:100%; flex:0 0 auto; }
        #pp-vport .pp-cathead { position:absolute; left:0; right:0; box-sizing:border-box; display:flex; align-items:center; gap:6px; padding:0 8px; background:#1b2128; border-bottom:1px solid #2a2a2a; border-left:3px solid #444; cursor:pointer; user-select:none; overflow:hidden; font-size:12px; font-weight:bold; }
        #pp-vport .pp-cathead:hover { background:#232c35; }
        #pp-vport .pp-cathead.pp-drop { background:#0f4d45; outline:1px dashed #2dd4bf; outline-offset:-2px; }
        #pp-vport .pp-caret { width:12px; color:#8a96a3; flex-shrink:0; }
        #pp-vport .pp-catname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        #pp-vport .pp-catn { background:#111; color:#aaa; border:1px solid #333; border-radius:8px; padding:0 6px; font-size:10px; flex-shrink:0; }
        #pp-vport .pp-cat-add { opacity:0.55; }
        #pp-vport .pp-cathead:hover .pp-cat-add { opacity:1; }
        #pp-vport.pp-grouped .pp-tag { padding-left:18px; }
        #pp-vport.pp-grouped .pp-cat-badge { display:none; }
        #pp-vport .pp-tag.pp-drop-row { background:#0f3a35 !important; }
        #pp-vport .pp-tag.dragging { opacity:0.4; }
        #pp-vport .pp-tag { position:absolute; left:0; right:0; box-sizing:border-box; overflow:hidden; }
        .pp-tag { gap:4px; border-left:3px solid transparent; padding-left:6px; padding-right:6px; }
        .pp-tag .pp-mark { flex-shrink:0; font-size:11px; color:#2dd4bf; text-align:center; margin-left:5px; }
        .pp-tag .pp-mark:empty { display:none; }
        .pp-tag .pp-wiki { display:flex; align-items:center; flex-shrink:0; }
        .pp-tag .pp-count { color:#555; font-size:10px; font-weight:bold; min-width:14px; margin-right:5px; user-select:none; text-align:right; }
        .pp-tag .pp-cat-badge { flex-shrink:0; max-width:72px; box-sizing:border-box; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:9px; font-weight:bold; padding:1px 5px; border-radius:10px; border:1px solid; letter-spacing:0.3px; }
        .pp-tag.pp-flash { background:#0f4d45 !important; transition:background 0.05s; }
        .pp-empty { padding:18px 14px; text-align:center; color:#555; font-size:11px; line-height:1.6; }
        .pp-status { display:none; align-items:center; gap:8px; padding:6px 10px; background:#0d1f1d; border-top:1px solid #144a43; color:#8ff0e2; font-size:11px; flex-shrink:0; }
        .pp-undo-btn { background:#0b2a28; color:#2dd4bf; border:1px solid #1d6b62; padding:3px 8px; border-radius:4px; font-size:11px; flex-shrink:0; }
        .pp-undo-btn:hover { background:#2dd4bf; color:#000; }
        .pp-viewbox { position:relative; padding:0 10px; }
        #pp-view-btn { width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px; background:#1a1a1a; color:#aaa; border:1px solid #333; border-radius:6px; padding:6px 10px; font-size:11px; }
        #pp-view-btn:hover { background:#222; color:#fff; border-color:#2dd4bf; }
        #pp-view-btn.filtered { color:#2dd4bf; border-color:#1d6b62; }
        #pp-view-menu { display:none; position:absolute; left:10px; right:10px; bottom:calc(100% + 6px); background:#181818; border:1px solid #2dd4bf; border-radius:8px; padding:10px; box-shadow:0 -8px 24px rgba(0,0,0,0.6); z-index:5; flex-direction:column; gap:8px; max-height:340px; }
        #pp-view-menu.open { display:flex; }
        #pp-view-cats { overflow-y:auto; display:flex; flex-direction:column; gap:2px; min-height:0; }
        #pp-view-cats label { display:flex; align-items:center; gap:8px; font-size:12px; color:#ccc; padding:4px 6px; border-radius:4px; cursor:pointer; user-select:none; }
        #pp-view-cats label:hover { background:#222; }
        #pp-view-cats input { margin:0; accent-color:#2dd4bf; }
        #pp-view-cats .pp-n { margin-left:auto; color:#666; font-size:10px; }
        #pp-view-cats .pp-vrow { display:flex; align-items:center; gap:8px; font-size:12px; color:#ccc; padding:3px 6px; border-radius:4px; }
        #pp-view-cats .pp-vrow:hover { background:#222; }
        #pp-view-cats .pp-vname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; user-select:none; }
        #pp-view-cats .pp-vrow input[type=text] { flex:1; min-width:0; font-size:12px; padding:3px 6px; background:#222; border:1px solid #2dd4bf; color:#fff; border-radius:4px; }
        #pp-view-cats .pp-vbtn { background:transparent; border:none; color:#777; font-size:11px; padding:2px 4px; border-radius:4px; opacity:0; }
        #pp-view-cats .pp-vrow:hover .pp-vbtn { opacity:1; }
        #pp-view-cats .pp-vbtn:hover { background:#333; color:#fff; }
        #pp-view-cats .pp-vbtn.del:hover { background:#2a0000; color:#ff6060; }
        #pp-view-add { display:flex; gap:6px; }
        #pp-view-add input { flex:1; min-width:0; font-size:12px; padding:6px 8px; background:#222; border:1px solid #444; color:#fff; border-radius:4px; }
        #pp-view-add button { background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; font-size:11px; padding:5px 10px; border-radius:4px; flex-shrink:0; }
        .pp-tag .pp-del { visibility:hidden; flex-shrink:0; width:14px; text-align:center; color:#ff6060; font-size:11px; opacity:0.65; cursor:pointer; border-radius:4px; }
        .pp-tag:hover .pp-del { visibility:visible; }
        .pp-tag .pp-add { flex-shrink:0; width:20px; height:20px; line-height:18px; text-align:center; font-size:10px; border-radius:5px; cursor:pointer; user-select:none; background:#0b2a28; border:1px solid #1d6b62; }
        .pp-tag .pp-add:hover { background:#2dd4bf; filter:none; }
        .pp-tag .pp-add.all { background:#2a1f0b; border-color:#7a5a1d; }
        .pp-tag .pp-add.all:hover { background:#ffb74d; }
        .pp-tag .tag-db-info, .pp-tag .tag-e621-info { flex-shrink:0; cursor:pointer; font-weight:bold; font-size:13px; padding:0; opacity:0.9; user-select:none; }
        .pp-tag .tag-db-info { color:#4db8ff; } .pp-tag .tag-e621-info { color:#ffb74d; }
        .pp-tag .tag-both-info { flex-shrink:0; cursor:pointer; font-size:13px; padding:0; opacity:0.95; user-select:none; }
        .pp-tag .tag-both-info:hover { opacity:1; transform:scale(1.15); }
        .pp-tag .tag-db-info:hover, .pp-tag .tag-e621-info:hover { color:#fff; opacity:1; }
        .pp-tag .conflict-warning, .pp-tag .similar-warning { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:0 1 auto; }
        .pp-sortrow { display:flex; gap:6px; }
        .pp-sortbtn { flex:1; display:flex; justify-content:space-between; align-items:center; gap:6px; background:#1a1a1a; color:#888; border:1px solid #333; border-radius:6px; padding:6px 8px; font-size:11px; font-weight:bold; }
        .pp-sortbtn:hover { background:#222; color:#eee; }
        .pp-sortbtn.on { background:#0b2a28; color:#2dd4bf; border-color:#1d6b62; }
        .pp-sortbtn .pp-dir { font-size:10px; font-weight:normal; opacity:0.9; white-space:nowrap; }
        .pp-sortbtn { white-space:nowrap; }
        .pp-tag .pp-del:hover { opacity:1; background:#2a0000; }
        .pp-tag .pp-cat-badge { cursor:pointer; }
        .pp-tag .pp-cat-badge:hover { filter:brightness(1.3); }
        .pp-tag select.pp-cat-select { flex-shrink:0; max-width:110px; font-size:10px; padding:2px 4px; background:#111; color:#ccc; border:1px solid #2dd4bf; border-radius:6px; }
        #pp-saveto { flex:0 0 92px; min-width:0; font-size:11px; padding:6px 4px; background:#111; color:#aaa; border:1px solid #333; border-radius:6px; }
    `;
    document.head.appendChild(st);
}
function ppBuildSeg(id, key, options, title) {
    const seg = ppEl('div');
    seg.className = 'pp-seg';
    seg.id = id;
    if (title) seg.title = title;
    options.forEach(([val, text, tip]) => {
        const b = ppEl('button', '', text);
        b.dataset.v = val;
        if (tip) b.title = tip;
        seg.appendChild(b);
    });
    seg.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        window._presetUI[key] = b.dataset.v;
        if (typeof window.saveSetting === 'function') window.saveSetting('preset-' + key, b.dataset.v);
        ppSyncControls();
        window.updatePresetMarkers();
    };
    return seg;
}

function ppDirText(d) { return d === 'asc' ? '▲ A–Z' : d === 'desc' ? '▼ Z–A' : 'off'; }
function ppCycleDir(d) { return d === 'asc' ? 'desc' : d === 'desc' ? 'off' : 'asc'; }

function ppSyncControls() {
    const ui = window._presetUI;
    const seg = document.getElementById('pp-seg-pos');
    if (seg) seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.pos));
    const ccb = document.getElementById('cb-preset-compact');
    if (ccb) ccb.checked = ui.view === 'flat';
    [['pp-sort-cat', 'sortCat'], ['pp-sort-name', 'sortName']].forEach(([id, key]) => {
        const b = document.getElementById(id);
        if (!b) return;
        b.classList.toggle('on', ui[key] !== 'off');
        const d = b.querySelector('.pp-dir'); if (d) d.textContent = ppDirText(ui[key]);
    });
    const posSel = document.getElementById('preset-add-pos');
    if (posSel) posSel.value = ui.pos;
    window.updatePresetSelectionActions();
}
function ppCatColors(cat) {
    if (!cat || cat === 'Uncategorized') return { fg: '#8a96a3', bg: 'rgba(138,150,163,0.12)', bd: 'rgba(138,150,163,0.35)' };
    let h = 0;
    for (const ch of cat) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return { fg: `hsl(${h},65%,66%)`, bg: `hsla(${h},65%,60%,0.13)`, bd: `hsla(${h},65%,60%,0.4)` };
}

function ppUpdateViewButton(totalCats) {
    const btn = document.getElementById('pp-view-btn');
    if (!btn) return;
    const hidden = window._presetUI.hiddenCats.length;
    const u = window._presetUI;
    const bits = [];
    if (u.sortCat !== 'off') bits.push('Cat ' + (u.sortCat === 'asc' ? 'A–Z' : 'Z–A'));
    if (u.sortName !== 'off') bits.push('Name ' + (u.sortName === 'asc' ? 'A–Z' : 'Z–A'));
    const sortTxt = bits.length ? bits.join(' · ') : 'saved order';
    btn.innerHTML = '';
    btn.appendChild(ppEl('span', '', '☰ Filter & sort'));
    btn.appendChild(ppEl('span', 'font-size:10px; opacity:0.85;', hidden > 0 ? `${hidden} hidden · ${sortTxt}` : sortTxt));
    btn.classList.toggle('filtered', hidden > 0);
}

function ppBuildViewMenu(keys, byCat) {
    const box = document.getElementById('pp-view-cats');
    if (!box) return;
    const hidden = new Set(window._presetUI.hiddenCats);
    box.innerHTML = '';
    keys.forEach(cat => {
        const row = ppEl('div'); row.className = 'pp-vrow';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !hidden.has(cat);
        cb.title = 'Show / hide this category in the list';
        cb.onchange = () => {
            const set = new Set(window._presetUI.hiddenCats);
            if (cb.checked) set.delete(cat); else set.add(cat);
            window._presetUI.hiddenCats = Array.from(set);
            window.saveSetting('preset-hidden-cats', window._presetUI.hiddenCats);
            window.renderPresetTags();
        };
        const col = ppCatColors(cat);
        row.appendChild(cb);
        row.appendChild(ppEl('span', `width:8px; height:8px; border-radius:50%; background:${col.fg}; flex-shrink:0;`));

        if (window._ppRenamingCat === cat) {
            const inp = document.createElement('input'); inp.type = 'text'; inp.value = cat;
            const finish = async (commit) => {
                if (window._ppRenamingCat !== cat) return;
                window._ppRenamingCat = null;
                const v = inp.value.trim();
                if (commit && v && v !== cat) { if (await ppRenameCategory(cat, v)) return; }
                window.renderPresetTags();
            };
            inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); };
            inp.onblur = () => finish(false);
            row.appendChild(inp);
            setTimeout(() => { inp.focus(); inp.select(); }, 0);
        } else {
            const nm = ppEl('span', '', cat); nm.className = 'pp-vname'; nm.title = cat;
            nm.onclick = () => cb.click();
            row.appendChild(nm);
            row.appendChild(ppEl('span', '', String((byCat.get(cat) || []).length))).className = 'pp-n';
            if (cat !== 'Uncategorized') {
                const ed = ppEl('button', '', '✏️'); ed.className = 'pp-vbtn'; ed.title = 'Rename category';
                ed.onclick = (e) => { e.stopPropagation(); window._ppRenamingCat = cat; window.renderPresetTags(); };
                const del = ppEl('button', '', '🗑️'); del.className = 'pp-vbtn del'; del.title = 'Remove category (its tags go to Uncategorized — Undo available)';
                del.onclick = (e) => { e.stopPropagation(); const m = document.getElementById('pp-view-menu'); if (m) m.classList.remove('open'); ppDeleteCategory(cat); };
                row.appendChild(ed); row.appendChild(del);
            }
        }
        box.appendChild(row);
    });
}
function ensurePresetShell() {
    const panel = document.getElementById('col-presets');
    if (!panel) return false;
    if (panel.dataset.ppShell === '3') return true;
    ppInjectStyles();
    panel.dataset.ppShell = '3';
    panel.innerHTML = '';

    // Header: title + count | highlight toggle | manage
    const header = ppEl('div');
    header.className = 'panel-header';
    const left = ppEl('div', 'display:flex; align-items:center; gap:8px; min-width:0;');
    left.appendChild(ppEl('span', 'color:#2dd4bf; white-space:nowrap;', '🌟 User Presets'));
    const cnt = ppEl('span', '', '0'); cnt.className = 'pp-badge'; cnt.id = 'pp-count'; cnt.title = 'Saved preset tags';
    left.appendChild(cnt);
    header.appendChild(left);
    const right = ppEl('div', 'display:flex; align-items:center; gap:6px;');
    const hl = document.createElement('label'); hl.className = 'pp-hl';
    hl.title = 'Highlights Always Visible: keep the preset highlight on tags even when this panel is closed.';
    const hcb = document.createElement('input'); hcb.type = 'checkbox'; hcb.id = 'cb-highlight-always';
    hcb.checked = !!window.presetHighlightsAlwaysVisible;
    hcb.onchange = () => window.togglePresetHighlightAlways(hcb.checked);
    hl.appendChild(hcb); hl.appendChild(document.createTextNode('Highlight'));
    // Compact mode: no category bars — one flat list, like before
    const cp = document.createElement('label'); cp.className = 'pp-hl';
    cp.title = 'Compact mode: hides the category bars and shows one flat list (category beside each tag). Off = collapsible category bars, drag tags into a bar to move them.';
    const ccb = document.createElement('input'); ccb.type = 'checkbox'; ccb.id = 'cb-preset-compact';
    ccb.checked = window._presetUI.view === 'flat';
    ccb.onchange = () => {
        window._presetUI.view = ccb.checked ? 'flat' : 'grouped';
        if (typeof window.saveSetting === 'function') window.saveSetting('preset-view', window._presetUI.view);
        window.renderPresetTags();
    };
    cp.appendChild(ccb); cp.appendChild(document.createTextNode('Compact'));
    right.appendChild(cp);
    right.appendChild(hl);
    header.appendChild(right);
    panel.appendChild(header);

    // Controls: only the insert position stays at the top
    const ctl = ppEl('div'); ctl.className = 'pp-controls';
    const r1 = ppEl('div'); r1.className = 'pp-ctl-row';
    r1.appendChild(ppEl('span', '', 'Add at')).className = 'pp-lbl';
    r1.appendChild(ppBuildSeg('pp-seg-pos', 'pos', [
        ['bottom', 'Bottom', 'Add at the end of the caption'],
        ['top', 'Top', 'Add at the start of the caption']
    ]));
    ctl.appendChild(r1);
    panel.appendChild(ctl);

    // Multi-select bar (top, only while tags are selected)
    const bar = ppEl('div'); bar.id = 'preset-selection-actions'; bar.className = 'selection-actions';
    const hiddenPos = document.createElement('select');
    hiddenPos.id = 'preset-add-pos'; hiddenPos.style.display = 'none';
    hiddenPos.innerHTML = '<option value="bottom">Bot</option><option value="top">Top</option>';
    bar.appendChild(hiddenPos);
    const bApply = ppEl('button', '', '➕ Selected'); bApply.id = 'pp-sel-apply'; bApply.className = 'btn-multi btn-add-all';
    bApply.title = 'Add the selected preset tags to the selected images (left list)';
    bApply.onclick = () => window.addSelectedPresetTagsTo('selected');
    const bAllSel = ppEl('button', 'background:#2a1f0b; color:#ffb74d; border-color:#7a5a1d;', '🌐 All'); bAllSel.id = 'pp-sel-all'; bAllSel.className = 'btn-multi';
    bAllSel.title = 'Add the selected preset tags to ALL visible images';
    bAllSel.onclick = () => window.addSelectedPresetTagsTo('all');
    const bRemove = ppEl('button', '', '🗑️'); bRemove.className = 'btn-multi btn-remove'; bRemove.style.flex = '0 0 auto'; bRemove.title = 'Remove the selected tags from presets (Undo available)';
    bRemove.onclick = () => window.removeSelectedPresetTags();
    const bClear = ppEl('button', 'background:#333; color:#aaa; border-color:#444; flex:0 0 auto;', '✖'); bClear.className = 'btn-multi'; bClear.title = 'Clear selection';
    bClear.onclick = () => window.clearPresetSelection();
    bar.appendChild(bApply); bar.appendChild(bAllSel); bar.appendChild(bRemove); bar.appendChild(bClear);
    panel.appendChild(bar);

    // Tag list (flat)
    const list = ppEl('div', 'flex:1; overflow-y:auto; display:flex; flex-direction:column; background:#111;');
    list.id = 'preset-tag-list';
    panel.appendChild(list);

    // Status + undo
    const status = ppEl('div'); status.id = 'pp-status'; status.className = 'pp-status preset-status-host';
    panel.appendChild(status);

    // Bottom box: search / save / filter & sort
    const box = ppEl('div', 'border-top:1px solid #222; background:#111; padding-bottom:8px;');
    const row = ppEl('div'); row.className = 'inline-add-box'; row.style.cssText = 'padding:8px 10px 6px; gap:6px;';
    const tgl = ppEl('button', '', '🔍'); tgl.id = 'btn-preset-search-toggle'; tgl.className = 'search-toggle-btn active';
    tgl.title = 'Search ON: typing filters the list. Search OFF: typing only adds tags.';
    tgl.style.padding = '0 2px';
    tgl.onclick = () => window.toggleSearchMode('preset');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.id = 'preset-add-input'; inp.placeholder = 'Search · Enter saves'; inp.autocomplete = 'off';
    inp.style.minWidth = '0'; inp.title = 'Type to search the presets. Press Enter to save the typed tag(s) (comma separated) into the category on the right.';
    inp.oninput = () => { if (window.presetSearchMode) window.filterPresetTagsByName(inp.value); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); window.addPresetTagFromInput(); } };
    const sel = document.createElement('select'); sel.id = 'pp-saveto';
    sel.title = 'Category used when you press Enter to save the typed tag(s)';
    sel.onchange = () => { window.selectedPresetCategory = sel.value === 'Uncategorized' ? null : sel.value; };
    row.appendChild(tgl); row.appendChild(inp); row.appendChild(sel);
    box.appendChild(row);
    const view = ppEl('div'); view.className = 'pp-viewbox';
    const menu = ppEl('div'); menu.id = 'pp-view-menu';
    menu.appendChild(ppEl('div', 'font-size:10px; color:#666; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px;', 'Sort · click: A–Z › Z–A › off'));
    const sortRow = ppEl('div'); sortRow.className = 'pp-sortrow';
    [['pp-sort-cat', 'sortCat', 'Category', 'Sort the categories. With Name also on, the tags are sorted inside each category.'],
     ['pp-sort-name', 'sortName', 'Name', 'Sort the tag names. Alone = one list for all categories; with Category on = inside each category.']].forEach(([id, key, label, tip]) => {
        const b = ppEl('button'); b.id = id; b.className = 'pp-sortbtn'; b.title = tip;
        b.appendChild(ppEl('span', '', label)); b.appendChild(ppEl('span', '', '')).className = 'pp-dir';
        b.onclick = () => {
            window._presetUI[key] = ppCycleDir(window._presetUI[key]);
            window.saveSetting(key === 'sortCat' ? 'preset-sort-cat' : 'preset-sort-name', window._presetUI[key]);
            ppSyncControls();
            window.renderPresetTags();
        };
        sortRow.appendChild(b);
    });
    menu.appendChild(sortRow);
    const catHead = ppEl('div', 'display:flex; justify-content:space-between; align-items:center;');
    catHead.appendChild(ppEl('span', 'font-size:10px; color:#666; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px;', 'Show categories'));
    const quick = ppEl('div', 'display:flex; gap:4px;');
    const bAll = ppEl('button', 'background:#222; border:1px solid #444; color:#aaa; font-size:10px; padding:2px 8px; border-radius:4px;', 'All');
    const bNone = ppEl('button', 'background:#222; border:1px solid #444; color:#aaa; font-size:10px; padding:2px 8px; border-radius:4px;', 'None');
    bAll.onclick = () => { window._presetUI.hiddenCats = []; window.saveSetting('preset-hidden-cats', []); window.renderPresetTags(); };
    bNone.onclick = async () => {
        const items = await getCachedPresetTags();
        const all = Array.from(new Set(items.map(i => i.category || 'Uncategorized')));
        window._presetUI.hiddenCats = all; window.saveSetting('preset-hidden-cats', all); window.renderPresetTags();
    };
    quick.appendChild(bAll); quick.appendChild(bNone); catHead.appendChild(quick);
    menu.appendChild(catHead);
    const cats = ppEl('div'); cats.id = 'pp-view-cats'; cats.className = 'pm-scroll';
    menu.appendChild(cats);
    const addCat = ppEl('div'); addCat.id = 'pp-view-add';
    const acIn = document.createElement('input'); acIn.type = 'text'; acIn.id = 'pp-newcat'; acIn.placeholder = 'New category...';
    const acBtn = ppEl('button', '', '➕ Add');
    const doAddCat = async () => {
        const name = acIn.value.trim();
        if (!name) return;
        if (name === 'Uncategorized' || name.startsWith('_sys_cat_')) { ppAlert('That category name is reserved.', 'warn'); return; }
        const items = await getCachedPresetTags();
        if (items.some(i => i.category === name)) { ppAlert('That category already exists.', 'warn'); return; }
        await window.savePresetTag(`_sys_cat_${name}`, name, true);
        acIn.value = '';
        await ppAfterMutation();
        const saveSel = document.getElementById('pp-saveto');
        if (saveSel && Array.from(saveSel.options).some(o => o.value === name)) { saveSel.value = name; window.selectedPresetCategory = name; }
    };
    acBtn.onclick = doAddCat;
    acIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddCat(); } };
    addCat.appendChild(acIn); addCat.appendChild(acBtn);
    menu.appendChild(addCat);
    view.appendChild(menu);
    const vbtn = document.createElement('button'); vbtn.id = 'pp-view-btn';
    vbtn.title = 'Choose which categories to show and how to sort the list';
    vbtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
    view.appendChild(vbtn);
    box.appendChild(view);
    panel.appendChild(box);

    if (!window._ppMenuCloser) {
        window._ppMenuCloser = true;
        document.addEventListener('click', (e) => {
            const m = document.getElementById('pp-view-menu');
            if (m && m.classList.contains('open') && e.target.isConnected && !m.contains(e.target)) m.classList.remove('open');
        });
    }

    ppSyncControls();
    ppUpdateViewButton();
    return true;
}
/* =========================================================================
   PANEL ACTIONS
========================================================================= */
window.togglePresetPanel = function () {
    const panel = document.getElementById('col-presets');
    const resizer = document.getElementById('resizer-presets');
    const btn = document.getElementById('btn-toggle-presets');

    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'flex';
        if (resizer) resizer.style.display = 'flex';
        btn.style.background = '#00aa66';
        btn.style.color = '#000';
        window.renderPresetTags();
    } else {
        panel.style.display = 'none';
        if (resizer) resizer.style.display = 'none';
        btn.style.background = 'transparent';
        btn.style.color = '#00ff99';
    }

    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    if (typeof window.renderEditor === 'function') window.renderEditor();
};

/* =========================================================================
   VIRTUAL LIST (2026-11 refactor)
   ---------------------------------------------------------------------
   Before: every click / marker update rebuilt (or walked) a DOM node for EVERY preset tag,
   each with its own closures — slow with hundreds or thousands of presets.
   Now: the list lives in memory (PP.rows -> PP.filtered) and only the rows that are on screen
   (+ a small buffer) exist in the DOM, absolutely positioned inside #pp-vport. Clicks are handled
   by ONE delegated listener; selecting a tag, the ✓/◐ markers, the wiki icons and the name filter
   only repaint those few rows (no full re-render, no async work).
========================================================================= */
const PP = window._ppV = {
    rows: [],          // [{ tag, cat, hay }] in display order (before the name filter)
    filtered: [],      // indices into rows that pass the name filter
    counts: new Map(), // usage of each tag in the dataset
    cats: [],          // category names (for the "move to" select)
    colors: new Map(),
    rowH: 30, needMeasure: true,
    nodes: new Map(),  // filtered position -> element
    first: -1, last: -1,
    marks: null, markTotal: 0, grouped: true, drag: null,
    vp: null, wired: false, raf: 0, markTimer: 0
};
const PP_BUF = 8;
const ppEsc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function ppColors(cat) { let c = PP.colors.get(cat); if (!c) { c = ppCatColors(cat); PP.colors.set(cat, c); } return c; }
function ppContainer() { return document.getElementById('preset-tag-list'); }

window.filterPresetTagsByName = function (val) {
    window.presetTagNameFilter = (val || '').trim().toLowerCase();
    ppApplyFilterDOM();
};

// Name filter + collapse state: recomputes which rows are listed and repaints (no DOM walk).
// While filtering, only categories with matches are listed (and they are shown expanded).
function ppApplyFilterDOM(keepScroll) {
    const container = ppContainer();
    if (!container) return;
    const f = window.presetTagNameFilter || '';
    const grouped = window._presetUI.view !== 'flat';
    const collapsed = window.presetCategoryCollapseState || {};
    const out = [];
    if (grouped && f) {
        const has = new Set();
        PP.rows.forEach(r => { if (r.kind === 'tag' && r.hay.includes(f)) has.add(r.cat); });
        PP.rows.forEach((r, i) => { if (r.kind === 'cat' ? has.has(r.cat) : r.hay.includes(f)) out.push(i); });
    } else {
        PP.rows.forEach((r, i) => {
            if (r.kind === 'cat') { if (grouped) out.push(i); return; }
            if (f ? r.hay.includes(f) : !(grouped && collapsed[r.cat])) out.push(i);
        });
    }
    const changed = out.length !== PP.filtered.length || out.some((v, k) => v !== PP.filtered[k]);
    PP.filtered = out;
    if (PP.vp) { PP.vp.style.height = (out.length * PP.rowH) + 'px'; PP.vp.classList.toggle('pp-grouped', grouped); }
    const none = container.querySelector('.pp-nomatch');
    if (none) none.style.display = (f && out.length === 0 && PP.rows.length) ? 'block' : 'none';
    if (changed && !keepScroll) container.scrollTop = 0;
    ppPaint(true);
}

/* ---------- ✓ / ◐ markers: which tags the selected images already have ---------- */
function ppComputeMarks() {
    const imgs = (typeof imageFiles !== 'undefined' && typeof selectedIndices !== 'undefined')
        ? Array.from(selectedIndices).map(i => imageFiles[i]).filter(Boolean) : [];
    const counts = new Map();
    imgs.forEach(img => { new Set(ppTagsOf(img)).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)); });
    PP.marks = counts; PP.markTotal = imgs.length;
}
window.updatePresetMarkers = function () {
    if (!ppIsPanelVisible() || !PP.vp) return;
    clearTimeout(PP.markTimer);            // many callers (editor render, wiki lookups...) -> one repaint
    PP.markTimer = setTimeout(() => { ppComputeMarks(); ppPaint(true); }, 40);
};

/* ---------- wiki icon (one per tag; nothing when no site has an entry) ---------- */
function ppWikiHTML(tag) {
    if (!window.danbooruInfoEnabled) return '';
    const wantDb = !!window.danbooruInfoShowIcons, wantE6 = !!window.showE621;
    if (!wantDb && !wantE6) return '';
    const t = tag.trim().toLowerCase();
    if (!t || t.startsWith('nl:')) return '';
    let hasDb = false, hasE6 = false;
    if (wantDb && typeof window.dbGetCachedTag === 'function') { const i = window.dbGetCachedTag(t); hasDb = !!(i && i.hasWikiInfo); }
    if (wantE6 && typeof window.e621GetCachedTag === 'function') { const i = window.e621GetCachedTag(t); hasE6 = !!(i && i.hasWikiInfo); }
    if (hasDb && typeof window.openDanbooruTagInfoPopout !== 'function') hasDb = false;
    if (hasE6 && typeof window.openE621TagInfoPopout !== 'function') hasE6 = false;
    if (hasDb && hasE6) return '<span class="pp-wiki"><span class="tag-both-info" data-wk="both" title="Info found on Danbooru AND e621 — click to see both side by side">⁉️</span></span>';
    if (hasDb) return '<span class="pp-wiki"><span class="tag-db-info" data-wk="db" title="View Danbooru info for this tag">❓</span></span>';
    if (hasE6) return '<span class="pp-wiki"><span class="tag-e621-info" data-wk="e6" title="View e621 info for this tag">❔</span></span>';
    return '';
}
function ppOpenWiki(kind, t) {
    if (kind === 'both') {
        if (typeof window.openBothTagInfoPopout === 'function') { window.openBothTagInfoPopout(t); return; }
        const modal = document.getElementById('modal-danbooru');
        const input = document.getElementById('dbpInput');
        const btn = document.getElementById('dbpSearchBtn');
        if (modal && input && btn && typeof window.openModal === 'function') { input.value = t; window.openModal('modal-danbooru'); btn.click(); }
        else window.openDanbooruTagInfoPopout(t);
    } else if (kind === 'db') window.openDanbooruTagInfoPopout(t);
    else window.openE621TagInfoPopout(t);
}

// Looks up the wiki info of preset tags that were never checked (same shared caches
// as the dataset scan, so nothing is fetched twice). Runs once per tag per session.
let _ppWikiTimer = null;
function ppQueueWikiLookup(tags) {
    if (!window.danbooruInfoEnabled || !(window.danbooruInfoShowIcons || window.showE621)) return;
    if (typeof window.dbFetchWikiBatch !== 'function' || typeof window.dbGetCachedTag !== 'function') return;
    window._ppWikiAsked = window._ppWikiAsked || new Set();
    const todo = tags.filter(t => {
        const k = t.trim().toLowerCase();
        if (!k || k.startsWith('nl:') || window._ppWikiAsked.has(k)) return false;
        const info = window.dbGetCachedTag(k);
        return !(info && info.wikiChecked);
    });
    if (todo.length === 0) return;
    clearTimeout(_ppWikiTimer);
    _ppWikiTimer = setTimeout(async () => {
        if (window._dbInfoScanRunning) { ppQueueWikiLookup(tags); return; }
        todo.forEach(t => window._ppWikiAsked.add(t.trim().toLowerCase()));
        const refresh = () => window.updatePresetMarkers();
        try {
            if (window.danbooruInfoShowIcons) {
                if (typeof window.dbFetchCountsBatch === 'function') await window.dbFetchCountsBatch(todo, false);
                await window.dbFetchWikiBatch(todo, false, refresh, () => {});
            }
            if (window.showE621 && typeof window.e621FetchCountsBatch === 'function') await window.e621FetchCountsBatch(todo, false);
            if (window.showE621 && typeof window.e621FetchWikiBatch === 'function') await window.e621FetchWikiBatch(todo, false, refresh, () => {});
        } catch (e) { /* offline / API error: the icons just stay as "unchecked" */ }
        refresh();
    }, window._dbInfoScanRunning ? 4000 : 800);
}

/* ---------- one row as an HTML string ---------- */
function ppHeadHTML(j, r) {
    const col = ppColors(r.cat), H = PP.rowH;
    const f = window.presetTagNameFilter || '';
    const open = !!f || !(window.presetCategoryCollapseState || {})[r.cat];
    return `<div class="pp-cathead${open ? '' : ' pp-closed'}" data-i="${j}" data-preset-cat="${ppEsc(r.cat)}" style="top:${j * H}px;height:${H}px;border-left-color:${col.fg};" title="Click to ${open ? 'collapse' : 'expand'} — drop tags here to move them into ${ppEsc(r.cat)}">` +
        `<span class="pp-caret">${open ? '▾' : '▸'}</span>` +
        `<span class="pp-catname" style="color:${col.fg};">${ppEsc(r.cat)}</span>` +
        `<span class="pp-catn">${r.n}</span>` +
        (r.n ? `<span class="pp-add sel pp-cat-add" data-act="sel" title="Add ALL ${r.n} tag(s) of &quot;${ppEsc(r.cat)}&quot; to the selected images">➕</span>` +
               `<span class="pp-add all pp-cat-add" data-act="all" title="Add ALL ${r.n} tag(s) of &quot;${ppEsc(r.cat)}&quot; to ALL images">🌐</span>` : '') +
        `</div>`;
}
function ppRowHTML(j) {
    const r = PP.rows[PP.filtered[j]];
    if (!r) return '';
    if (r.kind === 'cat') return ppHeadHTML(j, r);
    const tag = r.tag, cat = r.cat;
    const col = ppColors(cat);
    const sel = presetSelectedTags.has(tag);
    let cls = 'master-tag-item pp-tag', warn = '';
    if (sel) {
        cls += ' selected-master';
        if (window.enableConflictWarnings && typeof window.checkTagStatusWithActive === 'function') {
            const st = window.checkTagStatusWithActive(tag);
            if (st.conflicts.length > 0) {
                cls += ' conflict';
                const t = ppEsc(`Conflict with: ${st.conflicts.join(', ')}`);
                warn = `<span class="conflict-warning" title="${t}">⚠️ Conflict: ${ppEsc(st.conflicts.join(', '))}</span>`;
            } else if (st.similars.length > 0) {
                cls += ' similar';
                const t = ppEsc(`Similar/Redundant to: ${st.similars.join(', ')}`);
                warn = `<span class="similar-warning" title="${t}">🟨 Similar: ${ppEsc(st.similars.join(', '))}</span>`;
            }
        }
    }
    let mark = '', markTitle = '';
    if (PP.markTotal > 0) {
        const n = PP.marks ? (PP.marks.get(tag) || 0) : 0;
        if (n === PP.markTotal) { mark = '✓'; markTitle = `On all ${PP.markTotal} selected image(s)`; }
        else if (n > 0) { mark = '◐'; markTitle = `On ${n} of ${PP.markTotal} selected image(s)`; }
    }
    const H = PP.rowH;
    return `<div class="${cls}" ${PP.grouped ? 'draggable="true" ' : ''}data-i="${j}" data-preset-tag="${ppEsc(tag)}" data-preset-cat="${ppEsc(cat)}" style="top:${j * H}px;height:${H}px;border-left-color:${col.fg};">` +
        `<div style="display:flex; align-items:center; overflow:hidden; flex:1; min-width:0;">` +
        `<span class="pp-count" title="Times used in current dataset">${PP.counts.get(tag) || 0}</span>` +
        `<span class="tag-name" title="${ppEsc(tag)}" style="color:#2dd4bf; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:0 1 auto; min-width:44px;">${ppEsc(tag)}</span>` +
        `<span class="pp-mark" title="${ppEsc(markTitle)}">${mark}</span>${warn}</div>` +
        `<span class="pp-cat-badge" style="color:${col.fg}; background:${col.bg}; border-color:${col.bd};" title="Category: ${ppEsc(cat)} — click to move this tag to another category">${ppEsc(cat)}</span>` +
        ppWikiHTML(tag) +
        `<span class="pp-add sel" title="Add &quot;${ppEsc(tag)}&quot; to the selected images">➕</span>` +
        `<span class="pp-add all" title="Add &quot;${ppEsc(tag)}&quot; to ALL images">🌐</span>` +
        `<span class="pp-del" title="Remove this tag from presets (Undo available)">✕</span></div>`;
}

// Real height of one row (depends on the font-size setting). Needs the panel to be visible.
function ppMeasure() {
    const container = ppContainer();
    if (!container || !PP.vp || !container.offsetParent) return false;
    const probe = document.createElement('div');
    probe.className = 'master-tag-item pp-tag';
    probe.style.cssText = 'position:static; visibility:hidden;';
    probe.innerHTML = '<span class="tag-name">Mg</span><span class="pp-add">➕</span>';
    PP.vp.appendChild(probe);
    const h = Math.ceil(probe.getBoundingClientRect().height);
    probe.remove();
    if (!h) return false;
    PP.needMeasure = false;
    if (h !== PP.rowH) { PP.rowH = h; PP.vp.style.height = (PP.filtered.length * h) + 'px'; }
    return true;
}

// Draws the rows in view. force = rebuild them (selection / markers / wiki changed); otherwise only the missing ones.
function ppPaint(force) {
    const container = ppContainer();
    if (!container || !PP.vp) return;
    if (PP.needMeasure) ppMeasure();
    const H = PP.rowH, n = PP.filtered.length;
    PP.vp.style.height = (n * H) + 'px';
    const vh = container.clientHeight || 600;
    const first = Math.max(0, Math.floor(container.scrollTop / H) - PP_BUF);
    const last = Math.min(n - 1, Math.ceil((container.scrollTop + vh) / H) + PP_BUF);
    if (!force && first === PP.first && last === PP.last) return;
    if (force) { PP.vp.textContent = ''; PP.nodes.clear(); }
    else PP.nodes.forEach((el, j) => { if ((j < first || j > last) && !el.classList.contains('dragging')) { el.remove(); PP.nodes.delete(j); } });
    let html = '';
    const need = [];
    for (let j = first; j <= last; j++) if (!PP.nodes.has(j)) { html += ppRowHTML(j); need.push(j); }
    if (html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        Array.from(tpl.content.children).forEach(el => { PP.nodes.set(+el.dataset.i, el); });
        PP.vp.appendChild(tpl.content);
    }
    PP.first = first; PP.last = last;
    document.dispatchEvent(new Event('pp:painted'));   // other plugins add their own icons to the rows (rule_similar)
}
function ppSchedulePaint() { if (!PP.raf) PP.raf = requestAnimationFrame(() => { PP.raf = 0; ppPaint(false); }); }
// Redraws the visible rows without re-reading the data (selection, counts, markers).
function ppRepaint() { if (PP.vp) ppPaint(true); }

/* ---------- ONE delegated click handler for the whole list ---------- */
function ppOnListClick(e) {
    const head = e.target.closest ? e.target.closest('.pp-cathead') : null;
    if (head) { ppOnHeadClick(e, head); return; }
    const row = e.target.closest ? e.target.closest('.pp-tag') : null;
    if (!row) return;
    const j = +row.dataset.i;
    const r = PP.rows[PP.filtered[j]];
    if (!r) return;
    const tag = r.tag, cat = r.cat, t = e.target;

    const wk = t.closest('[data-wk]');
    if (wk) { e.stopPropagation(); ppOpenWiki(wk.dataset.wk, tag.trim().toLowerCase()); return; }

    const add = t.closest('.pp-add');
    if (add) {
        e.stopPropagation();
        row.classList.add('pp-flash');
        setTimeout(() => row.classList.remove('pp-flash'), 180);
        window.applyPresetTags([tag], add.classList.contains('all') ? 'all' : 'selected');
        return;
    }

    if (t.closest('.pp-del')) {
        e.stopPropagation();
        (async () => {
            await window.deletePresetTag(tag, true);
            presetSelectedTags.delete(tag);
            await ppAfterMutation();
            ppSetStatus(`Removed "${tag}" from presets`, async () => {
                await ppSetCategory(tag, cat);
                await ppAfterMutation();
                ppSetStatus(`Restored "${tag}".`);
            });
        })();
        return;
    }

    const badge = t.closest('.pp-cat-badge');
    if (badge) {
        e.stopPropagation();
        const pick = document.createElement('select'); pick.className = 'pp-cat-select';
        const names = PP.cats.includes('Uncategorized') ? PP.cats : [...PP.cats, 'Uncategorized'];
        names.forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k; pick.appendChild(o); });
        pick.value = cat;
        let done = false;
        pick.onchange = async () => {
            done = true;
            const target = pick.value;
            if (target === cat) { ppRepaint(); return; }
            await ppSetCategory(tag, target);
            await ppEnsureCategoryMarker(target);
            await ppAfterMutation();
            ppSetStatus(`Moved "${tag}" to "${target}".`, async () => {
                await ppSetCategory(tag, cat);
                await ppAfterMutation();
                ppSetStatus(`"${tag}" is back in "${cat}".`);
            });
        };
        pick.onblur = () => { if (!done) ppRepaint(); };
        pick.onclick = (ev) => ev.stopPropagation();
        badge.replaceWith(pick);
        pick.focus();
        if (typeof pick.showPicker === 'function') { try { pick.showPicker(); } catch (err) {} }
        return;
    }

    if (t.closest('.conflict-warning, .similar-warning, .select-ignored')) return;

    // plain click: select / unselect (shift = range over the rows currently listed)
    if (e.shiftKey && presetSelectedTags.size > 0) {
        const a = Math.min(lastSelectedPresetIndex, j), b = Math.max(lastSelectedPresetIndex, j);
        for (let k = a; k <= b; k++) { const rr = PP.rows[PP.filtered[k]]; if (rr && rr.kind === 'tag') presetSelectedTags.add(rr.tag); }
    } else {
        if (presetSelectedTags.has(tag)) presetSelectedTags.delete(tag); else presetSelectedTags.add(tag);
        lastSelectedPresetIndex = j;
    }
    ppRepaint();
    window.updatePresetSelectionActions();
}

/* ---------- category bars: collapse / expand, add the whole category ---------- */
function ppOnHeadClick(e, head) {
    const cat = head.dataset.presetCat;
    const add = e.target.closest('.pp-cat-add');
    if (add) {
        e.stopPropagation();
        const tags = PP.rows.filter(r => r.kind === 'tag' && r.cat === cat).map(r => r.tag);
        window.applyPresetTags(tags, add.dataset.act === 'all' ? 'all' : 'selected');
        return;
    }
    if (window.presetTagNameFilter) return;          // while searching, categories are shown expanded
    const st = window.presetCategoryCollapseState = window.presetCategoryCollapseState || {};
    if (st[cat]) delete st[cat]; else st[cat] = true;
    if (typeof window.saveSetting === 'function') window.saveSetting('preset-cat-collapse', st);
    ppApplyFilterDOM(true);
}

/* ---------- drag tags into the bars (move to that category) ---------- */
function ppDragClear() {
    PP.drag = null;
    const c = ppContainer();
    if (c) c.querySelectorAll('.pp-drop, .pp-drop-row, .dragging').forEach(el => el.classList.remove('pp-drop', 'pp-drop-row', 'dragging'));
}
function ppOnDragStart(e) {
    const row = e.target.closest ? e.target.closest('.pp-tag') : null;
    if (!row || !PP.grouped) return;
    const tag = row.dataset.presetTag;
    PP.drag = (presetSelectedTags.has(tag) && presetSelectedTags.size > 1) ? Array.from(presetSelectedTags) : [tag];
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', PP.drag.join(', ')); } catch (err) {}
    row.classList.add('dragging');
}
function ppOnDragOver(e) {
    if (!PP.drag) return;
    const container = ppContainer();
    const rect = container.getBoundingClientRect();
    if (e.clientY < rect.top + 36) container.scrollTop -= 14;            // auto-scroll near the edges
    else if (e.clientY > rect.bottom - 36) container.scrollTop += 14;
    const tgt = e.target.closest ? e.target.closest('.pp-cathead, .pp-tag') : null;
    if (!tgt) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    container.querySelectorAll('.pp-drop, .pp-drop-row').forEach(el => el.classList.remove('pp-drop', 'pp-drop-row'));
    tgt.classList.add(tgt.classList.contains('pp-cathead') ? 'pp-drop' : 'pp-drop-row');
}
async function ppOnDrop(e) {
    const tgt = e.target.closest ? e.target.closest('.pp-cathead, .pp-tag') : null;
    const tags = PP.drag;
    if (!tgt || !tags) { ppDragClear(); return; }
    e.preventDefault();
    const cat = tgt.dataset.presetCat;
    const before = new Map();
    PP.rows.forEach(r => { if (r.kind === 'tag') before.set(r.tag, r.cat); });
    const moving = tags.filter(t => before.has(t) && before.get(t) !== cat);
    ppDragClear();
    if (moving.length === 0) return;
    for (const t of moving) await ppSetCategory(t, cat);
    await ppEnsureCategoryMarker(cat);
    await ppAfterMutation();
    ppSetStatus(moving.length === 1 ? `Moved "${moving[0]}" to "${cat}".` : `Moved ${moving.length} tags to "${cat}".`, async () => {
        for (const t of moving) await ppSetCategory(t, before.get(t));
        await ppAfterMutation();
        ppSetStatus(`Moved back ${moving.length} tag(s).`);
    });
}

function ppEnsureViewport(container) {
    if (PP.vp && PP.vp.isConnected && PP.vp.parentNode === container) return PP.vp;
    PP.vp = document.createElement('div');
    PP.vp.id = 'pp-vport';
    container.replaceChildren(PP.vp);
    const nm = document.createElement('div'); nm.className = 'pp-empty pp-nomatch'; nm.style.display = 'none'; nm.textContent = 'No tag matches your search.';
    container.appendChild(nm);
    PP.nodes.clear(); PP.first = PP.last = -1; PP.needMeasure = true;
    if (!PP.wired) {
        PP.wired = true;
        container.addEventListener('click', ppOnListClick);
        container.addEventListener('dragstart', ppOnDragStart);
        container.addEventListener('dragover', ppOnDragOver);
        container.addEventListener('drop', ppOnDrop);
        container.addEventListener('dragend', ppDragClear);
        container.addEventListener('scroll', ppSchedulePaint, { passive: true });
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (PP.vp) { PP.needMeasure = true; ppSchedulePaint(); } }).observe(container);
    }
    return PP.vp;
}

window.renderPresetTags = async function () {
    ensurePresetShell();
    const container = ppContainer();
    if (!container) return;

    // Fetch FIRST, rebuild after (avoids an empty-panel flash).
    const items = await getCachedPresetTags();
    window._presetTagsSet = new Set(items.map(i => i.tag).filter(t => !t.startsWith('_sys_cat_')));
    const { byCat, keys } = await ppGetOrderedCategories(items);
    PP.counts = ppComputeTagCounts();

    // Drop selected tags that no longer exist
    Array.from(presetSelectedTags).forEach(t => { if (!window._presetTagsSet.has(t)) presetSelectedTags.delete(t); });

    const cntEl = document.getElementById('pp-count');
    if (cntEl) cntEl.textContent = String(window._presetTagsSet.size);
    const hcb = document.getElementById('cb-highlight-always');
    if (hcb) hcb.checked = !!window.presetHighlightsAlwaysVisible;

    // "Into" category select (keeps the current choice when possible)
    const saveSel = document.getElementById('pp-saveto');
    if (saveSel) {
        const prev = saveSel.value || window.selectedPresetCategory || 'Uncategorized';
        saveSel.innerHTML = '';
        const names = keys.includes('Uncategorized') ? keys.slice() : [...keys, 'Uncategorized'];
        names.sort((a, b) => a === 'Uncategorized' ? 1 : b === 'Uncategorized' ? -1 : a.localeCompare(b, undefined, { sensitivity: 'base' }));
        names.forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k; saveSel.appendChild(o); });
        saveSel.value = names.includes(prev) ? prev : 'Uncategorized';
    }

    // Flat list. Category sort orders the groups, Name sort orders the tags
    // (inside each group when Category is on, one single list when it is off).
    const ui = window._presetUI;
    const dir = (d) => d === 'desc' ? -1 : 1;
    const byName = (d) => (a, b) => dir(d) * a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    const menuKeys = keys.slice();
    if (ui.sortCat !== 'off') {
        menuKeys.sort((a, b) => a === 'Uncategorized' ? 1 : b === 'Uncategorized' ? -1 : dir(ui.sortCat) * a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
    const hidden = new Set(ui.hiddenCats);
    const grouped = ui.view !== 'flat';
    let rows = [];
    if (grouped) {
        // one collapsible bar per category (also the empty ones, so tags can be dropped into them)
        const order = menuKeys.slice();
        if (!order.includes('Uncategorized')) order.push('Uncategorized');
        order.forEach(cat => {
            if (hidden.has(cat)) return;
            const tags = (byCat.get(cat) || []).slice();
            if (ui.sortName !== 'off') tags.sort(byName(ui.sortName));
            rows.push({ kind: 'cat', cat, n: tags.length });
            tags.forEach(tag => rows.push({ kind: 'tag', tag, cat }));
        });
    } else if (ui.sortCat !== 'off') {
        menuKeys.forEach(cat => {
            if (hidden.has(cat)) return;
            const tags = (byCat.get(cat) || []).slice();
            if (ui.sortName !== 'off') tags.sort(byName(ui.sortName));
            tags.forEach(tag => rows.push({ kind: 'tag', tag, cat }));
        });
    } else {
        const catOf = new Map();
        byCat.forEach((tags, cat) => tags.forEach(t => catOf.set(t, cat)));
        items.forEach(it => { if (!it.tag.startsWith('_sys_cat_') && !hidden.has(catOf.get(it.tag))) rows.push({ kind: 'tag', tag: it.tag, cat: catOf.get(it.tag) }); });
        if (ui.sortName !== 'off') rows.sort((x, y) => byName(ui.sortName)(x.tag, y.tag));
    }
    rows.forEach(r => { if (r.kind === 'tag') r.hay = (r.tag + ' ' + r.cat).toLowerCase(); });
    PP.grouped = grouped;
    PP.rows = rows; PP.cats = menuKeys; PP.colors.clear();

    const input = document.getElementById('preset-add-input');
    window.presetTagNameFilter = (window.presetSearchMode && input) ? input.value.trim().toLowerCase() : '';

    if (items.filter(i => !i.tag.startsWith('_sys_cat_')).length === 0 || rows.length === 0 || (!grouped && !rows.some(r => r.kind === 'tag'))) {
        PP.vp = null; PP.nodes.clear(); PP.filtered = []; PP.first = PP.last = -1;
        const msg = ppEl('div', '', items.filter(i => !i.tag.startsWith('_sys_cat_')).length === 0
            ? 'No presets saved yet. Type a tag below and press Enter, or use the 💾 icon next to any tag.'
            : 'All categories are hidden. Open ☰ Filter & sort to show them again.');
        msg.className = 'pp-empty';
        container.replaceChildren(msg);
    } else {
        ppEnsureViewport(container);
        ppComputeMarks();
        PP.needMeasure = true;
        ppApplyFilterDOM(true);        // filters + paints the visible rows
    }

    ppBuildViewMenu(menuKeys, byCat);
    ppUpdateViewButton(keys.length);
    ppQueueWikiLookup(Array.from(window._presetTagsSet));
    ppSyncControls();
    window.updatePresetSelectionActions();
};

/* =========================================================================
   BOOT
========================================================================= */
async function ppLoadUISettings() {
    if (typeof window.getSetting !== 'function') return;
    try {
        const pos = await window.getSetting('preset-pos', 'bottom');
        const coll = await window.getSetting('preset-cat-collapse', {});
        const hl = await window.getSetting('preset-highlights-always-visible', false);
        window._presetUI.pos = pos === 'top' ? 'top' : 'bottom';
        if (coll && typeof coll === 'object' && !Array.isArray(coll)) window.presetCategoryCollapseState = coll;
        window.presetHighlightsAlwaysVisible = hl;
        const okDir = (v) => (v === 'asc' || v === 'desc' || v === 'off') ? v : null;
        const old = await window.getSetting('preset-sort', null); // v2-v4 setting: 'category' | 'name'
        const sc = okDir(await window.getSetting('preset-sort-cat', null));
        const sn = okDir(await window.getSetting('preset-sort-name', null));
        window._presetUI.sortCat = sc || (old === 'name' ? 'off' : 'asc');
        window._presetUI.sortName = sn || 'asc';
        const vw = await window.getSetting('preset-view', 'grouped');
        window._presetUI.view = vw === 'flat' ? 'flat' : 'grouped';
        const hid = await window.getSetting('preset-hidden-cats', []);
        window._presetUI.hiddenCats = Array.isArray(hid) ? hid : [];
        const hcbx = document.getElementById('cb-highlight-always');
        if (hcbx) hcbx.checked = !!hl;
    } catch (e) { console.error('Preset UI settings failed to load:', e); }
    ppSyncControls();
    ppUpdateViewButton();
    if (ppIsPanelVisible()) window.renderPresetTags();
}

function ppHookEditorRender() {
    if (window._ppEditorHook) return;
    if (typeof window.registerPostRenderEditor === 'function') {
        window.registerPostRenderEditor(() => window.updatePresetMarkers());
        window._ppEditorHook = true;
    }
}

ensurePresetShell();

window.addEventListener('DOMContentLoaded', () => {
    ensurePresetShell();
    window.refreshPresetTagsSet();
    ppLoadUISettings();
    ppHookEditorRender();
});
