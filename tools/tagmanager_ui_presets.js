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
     window.removeSelectedPresetTags, window.createPresetCategory,
     window.renameSelectedPresetCategory, window.deleteSelectedPresetCategory,
     window.addPresetTagFromInput, window.refreshPresetTagsSet, `.master-tag-item`
     rows with a `.tag-name` child (needed by the Similar/Conflict hooks).
========================================================================= */

window.selectedPresetCategory = null;
window.presetCategoryCollapseState = {};

// Controla se os highlights ficam sempre visíveis
window.presetHighlightsAlwaysVisible = false;

// UI state of the side panel (persisted through saveSetting)
window._presetUI = { mode: 'select', target: 'selected', pos: 'bottom', sortCat: 'asc', sortName: 'asc', hiddenCats: [] };

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
    window.renderPresetTags();
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
    window.renderPresetTags();
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

window.createPresetCategory = function () {
    const catName = prompt('Name the new category:');
    if (catName && catName.trim()) {
        window.savePresetTag(`_sys_cat_${catName.trim()}`, catName.trim());
    }
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

// Old API (kept for compatibility)
window.renameSelectedPresetCategory = async function () {
    const oldName = window.selectedPresetCategory;
    if (!oldName || oldName === 'Uncategorized') return;
    const n = prompt(`Rename category "${oldName}" to:`, oldName);
    if (n) await ppRenameCategory(oldName, n);
};
window.deleteSelectedPresetCategory = async function () {
    await ppDeleteCategory(window.selectedPresetCategory);
};

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

window.filterPresetTagsByName = function (val) {
    window.presetTagNameFilter = (val || '').trim().toLowerCase();
    ppApplyFilterDOM();
};

// Applies the name filter + the collapse state to the already rendered DOM.
// While filtering, categories with matches are force-expanded and the others hidden.
function ppApplyFilterDOM() {
    const container = document.getElementById('preset-tag-list');
    if (!container) return;
    const f = window.presetTagNameFilter || '';
    let visible = 0;
    container.querySelectorAll('.pp-tag').forEach(item => {
        const hay = ((item.dataset.presetTag || '') + ' ' + (item.dataset.presetCat || '')).toLowerCase();
        const show = !f || hay.includes(f);
        item.style.display = show ? 'flex' : 'none';
        if (show) visible++;
    });
    const none = container.querySelector('.pp-nomatch');
    if (none) none.style.display = (f && visible === 0) ? 'block' : 'none';
}
// Light update of the ✓ / ◐ markers (no re-render): which tags the target images already have
window.updatePresetMarkers = function () {
    if (!ppIsPanelVisible()) return;
    const container = document.getElementById('preset-tag-list');
    if (!container || typeof imageFiles === 'undefined') return;
    const scopeAll = false;
    const imgs = scopeAll
        ? imageFiles.filter(i => !i.hidden)
        : Array.from(selectedIndices).map(i => imageFiles[i]).filter(Boolean);
    const total = imgs.length;
    const counts = new Map();
    if (total > 0) {
        imgs.forEach(img => { new Set(ppTagsOf(img)).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)); });
    }
    const scopeText = scopeAll ? 'visible image(s)' : 'selected image(s)';
    container.querySelectorAll('.pp-tag').forEach(row => {
        ppApplyWikiIcons(row);
        const mark = row.querySelector('.pp-mark');
        if (!mark) return;
        const n = total > 0 ? (counts.get(row.dataset.presetTag) || 0) : 0;
        if (total === 0 || n === 0) { mark.textContent = ''; mark.title = ''; }
        else if (n === total) { mark.textContent = '✓'; mark.title = `On all ${total} ${scopeText}`; }
        else { mark.textContent = '◐'; mark.title = `On ${n} of ${total} ${scopeText}`; }
    });
};

/* =========================================================================
   RENDER (side panel)
========================================================================= */
function ppApplyWikiIcons(row) {
    row.querySelectorAll('.tag-db-info, .tag-e621-info, .tag-both-info, .pp-wiki').forEach(e => e.remove());
    // Master switch off -> no icons at all. Otherwise: ❓ follows "Show ❓ Danbooru wiki icons",
    // ❔ follows "Enable e621" (window.showE621 is already false when the master switch is off).
    if (!window.danbooruInfoEnabled) return;
    const wantDb = !!window.danbooruInfoShowIcons, wantE6 = !!window.showE621;
    if (!wantDb && !wantE6) return;
    const t = (row.dataset.presetTag || '').trim().toLowerCase();
    if (!t || t.startsWith('nl:')) return;

    // ONE icon per tag (nothing is drawn when no site has a wiki entry):
    //   only Danbooru -> red ❓   only e621 -> white ❔   both -> ⁉️ (opens the Tag Interrogator)
    let hasDb = false, hasE6 = false;
    if (wantDb && typeof window.dbGetCachedTag === 'function') { const i = window.dbGetCachedTag(t); hasDb = !!(i && i.hasWikiInfo); }
    if (wantE6 && typeof window.e621GetCachedTag === 'function') { const i = window.e621GetCachedTag(t); hasE6 = !!(i && i.hasWikiInfo); }
    if (hasDb && typeof window.openDanbooruTagInfoPopout !== 'function') hasDb = false;
    if (hasE6 && typeof window.openE621TagInfoPopout !== 'function') hasE6 = false;
    if (!hasDb && !hasE6) return;

    const ic = ppEl('span');
    if (hasDb && hasE6) {
        ic.className = 'tag-both-info'; ic.textContent = '⁉️';
        ic.title = 'Info found on Danbooru AND e621 — click to open both in the Tag Interrogator';
        ic.onclick = (e) => {
            e.stopPropagation();
            const modal = document.getElementById('modal-danbooru');
            const input = document.getElementById('dbpInput');
            const btn = document.getElementById('dbpSearchBtn');
            if (modal && input && btn && typeof window.openModal === 'function') {
                input.value = t; window.openModal('modal-danbooru'); btn.click();
            } else {
                window.openDanbooruTagInfoPopout(t);
            }
        };
    } else if (hasDb) {
        ic.className = 'tag-db-info'; ic.textContent = '❓'; ic.title = 'View Danbooru info for this tag';
        ic.onclick = (e) => { e.stopPropagation(); window.openDanbooruTagInfoPopout(t); };
    } else {
        ic.className = 'tag-e621-info'; ic.textContent = '❔'; ic.title = 'View e621 info for this tag';
        ic.onclick = (e) => { e.stopPropagation(); window.openE621TagInfoPopout(t); };
    }
    const box = ppEl('span'); box.className = 'pp-wiki';
    box.appendChild(ic);
    const anchor = row.querySelector('.pp-cat-badge, .pp-cat-select');
    if (anchor) anchor.after(box); else row.appendChild(box);
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

function ppBuildTagRow(tag, cat, count, index, renderedTags, allCats) {
    const item = ppEl('div');
    item.className = 'master-tag-item pp-tag';
    item.dataset.presetTag = tag;
    item.dataset.presetCat = cat;
    const col = ppCatColors(cat);
    item.style.borderLeftColor = col.fg;

    const isTagSelected = presetSelectedTags.has(tag);

    const left = ppEl('div', 'display:flex; align-items:center; overflow:hidden; flex:1; min-width:0;');
    const mark = ppEl('span'); mark.className = 'pp-mark';
    const cnt = ppEl('span', '', String(count)); cnt.className = 'pp-count'; cnt.title = 'Times used in current dataset';
    const nm = ppEl('span', 'color:#2dd4bf; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:0 1 auto; min-width:44px;', tag); nm.className = 'tag-name'; nm.title = tag;
    left.appendChild(cnt); left.appendChild(nm); left.appendChild(mark);

    if (isTagSelected) {
        item.classList.add('selected-master');
        if (window.enableConflictWarnings && typeof window.checkTagStatusWithActive === 'function') {
            const status = window.checkTagStatusWithActive(tag);
            if (status.conflicts.length > 0) {
                item.classList.add('conflict');
                const w = ppEl('span', '', `⚠️ Conflict: ${status.conflicts.join(', ')}`);
                w.className = 'conflict-warning'; w.title = `Conflict with: ${status.conflicts.join(', ')}`;
                left.appendChild(w);
            } else if (status.similars.length > 0) {
                item.classList.add('similar');
                const w = ppEl('span', '', `🟨 Similar: ${status.similars.join(', ')}`);
                w.className = 'similar-warning'; w.title = `Similar/Redundant to: ${status.similars.join(', ')}`;
                left.appendChild(w);
            }
        }
    }
    item.appendChild(left);

    const badge = ppEl('span', `color:${col.fg}; background:${col.bg}; border-color:${col.bd};`, cat);
    badge.className = 'pp-cat-badge'; badge.title = `Category: ${cat} — click to move this tag to another category`;
    badge.onclick = (e) => {
        e.stopPropagation();
        const pick = document.createElement('select'); pick.className = 'pp-cat-select';
        const names = allCats.includes('Uncategorized') ? allCats : [...allCats, 'Uncategorized'];
        names.forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k; pick.appendChild(o); });
        pick.value = cat;
        let done = false;
        pick.onchange = async () => {
            done = true;
            const target = pick.value;
            if (target === cat) { window.renderPresetTags(); return; }
            await ppSetCategory(tag, target);
            await ppEnsureCategoryMarker(target);
            await ppAfterMutation();
            ppSetStatus(`Moved "${tag}" to "${target}".`, async () => {
                await ppSetCategory(tag, cat);
                await ppAfterMutation();
                ppSetStatus(`"${tag}" is back in "${cat}".`);
            });
        };
        pick.onblur = () => { if (!done) window.renderPresetTags(); };
        pick.onclick = (ev) => ev.stopPropagation();
        item.replaceChild(pick, badge);
        pick.focus();
        if (typeof pick.showPicker === 'function') { try { pick.showPicker(); } catch (err) {} }
    };
    item.appendChild(badge);

    const mkAdd = (glyph, target, tip, extra) => {
        const b = ppEl('span', '', glyph); b.className = 'pp-add ' + extra; b.title = tip;
        b.onclick = (e) => {
            e.stopPropagation();
            item.classList.add('pp-flash');
            setTimeout(() => item.classList.remove('pp-flash'), 180);
            window.applyPresetTags([tag], target);
        };
        return b;
    };
    item.appendChild(mkAdd('➕', 'selected', `Add "${tag}" to the selected images`, 'sel'));
    item.appendChild(mkAdd('🌐', 'all', `Add "${tag}" to ALL images`, 'all'));

    const del = ppEl('span', '', '✕'); del.className = 'pp-del'; del.title = 'Remove this tag from presets (Undo available)';
    del.onclick = async (e) => {
        e.stopPropagation();
        await window.deletePresetTag(tag, true);
        presetSelectedTags.delete(tag);
        await ppAfterMutation();
        ppSetStatus(`Removed "${tag}" from presets`, async () => {
            await ppSetCategory(tag, cat);
            await ppAfterMutation();
            ppSetStatus(`Restored "${tag}".`);
        });
    };
    item.appendChild(del);

    item.onclick = (e) => {
        if (e.target.classList.contains('conflict-warning') || e.target.classList.contains('similar-warning')) return;
        if (e.target.closest('.pp-cat-badge, .pp-cat-select, .pp-del, .pp-add, .tag-db-info, .tag-e621-info, .tag-both-info')) return;

        if (e.shiftKey && presetSelectedTags.size > 0) {
            const start = Math.min(lastSelectedPresetIndex, index), end = Math.max(lastSelectedPresetIndex, index);
            for (let i = start; i <= end; i++) presetSelectedTags.add(renderedTags[i]);
        } else {
            if (presetSelectedTags.has(tag)) presetSelectedTags.delete(tag); else presetSelectedTags.add(tag);
            lastSelectedPresetIndex = index;
        }
        window.renderPresetTags();
        window.updatePresetSelectionActions();
    };
    ppApplyWikiIcons(item);
    return item;
}
window.renderPresetTags = async function () {
    ensurePresetShell();
    const container = document.getElementById('preset-tag-list');
    if (!container) return;

    // Fetch FIRST, rebuild the DOM after (avoids an empty-panel flash).
    const items = await getCachedPresetTags();
    window._presetTagsSet = new Set(items.map(i => i.tag).filter(t => !t.startsWith('_sys_cat_')));
    const { byCat, keys } = await ppGetOrderedCategories(items);
    const counts = ppComputeTagCounts();

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
    let rows = [];
    if (ui.sortCat !== 'off') {
        menuKeys.forEach(cat => {
            if (hidden.has(cat)) return;
            const tags = (byCat.get(cat) || []).slice();
            if (ui.sortName !== 'off') tags.sort(byName(ui.sortName));
            tags.forEach(tag => rows.push({ tag, cat }));
        });
    } else {
        const catOf = new Map();
        byCat.forEach((tags, cat) => tags.forEach(t => catOf.set(t, cat)));
        items.forEach(it => { if (!it.tag.startsWith('_sys_cat_') && !hidden.has(catOf.get(it.tag))) rows.push({ tag: it.tag, cat: catOf.get(it.tag) }); });
        if (ui.sortName !== 'off') rows.sort((x, y) => byName(ui.sortName)(x.tag, y.tag));
    }

    const frag = document.createDocumentFragment();
    if (items.filter(i => !i.tag.startsWith('_sys_cat_')).length === 0) {
        frag.appendChild(ppEl('div', '', 'No presets saved yet. Type a tag below and press Enter, or use the 💾 icon next to any tag.')).className = 'pp-empty';
    } else if (rows.length === 0) {
        frag.appendChild(ppEl('div', '', 'All categories are hidden. Open ☰ Filter & sort to show them again.')).className = 'pp-empty';
    } else {
        const rendered = rows.map(r => r.tag);
        rows.forEach((r, i) => frag.appendChild(ppBuildTagRow(r.tag, r.cat, counts.get(r.tag) || 0, i, rendered, menuKeys)));
        const nm = ppEl('div', 'display:none;', 'No tag matches your search.'); nm.className = 'pp-empty pp-nomatch';
        frag.appendChild(nm);
    }
    container.replaceChildren(frag);

    ppBuildViewMenu(menuKeys, byCat);
    ppUpdateViewButton(keys.length);
    ppQueueWikiLookup(Array.from(window._presetTagsSet));
    ppSyncControls();
    const input = document.getElementById('preset-add-input');
    window.presetTagNameFilter = (window.presetSearchMode && input) ? input.value.trim().toLowerCase() : '';
    ppApplyFilterDOM();
    window.updatePresetMarkers();
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
