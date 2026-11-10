/* =========================================================================
   COLOR GROUPS — up to 20 colored groups of images in the Dataset list
   ---------------------------------------------------------------------
   Select images → 🌈 (next to 👁️ Hide / 🎯 Focus, next to the image counter) → pick a color (1–20).
   The images of a group are placed together in the list, starting where the HIGHEST image of the group
   was, and a colored divider line is drawn above them (an extra thin line closes the group when the
   next image has no group). The order is saved in datasetConfig[img].order (read when the dataset loads), so
   nothing is renamed on disk.
   Each divider has:
     🗜️ Compact   — the group's rows get small thumbnails (less height)
     ▾/▸ Collapse — only the divider line stays visible, the group's images are folded away
     🔇 Mute      — the tags of the group's images leave the "All Dataset Tags" list (preview only, like
                    Hide / Focus: no file or tag is changed). The images stay visible in the list.
     ✖ Ungroup    — takes every image out of the group
   Click on the divider's name to select all the images of the group; double-click the bar to collapse / expand it.
   Saved in the dataset's _tagger_config.json: datasetConfig[baseName].cg (group id) and
   datasetConfig.cgState = { muted:[ids], collapsed:[ids], compact:[ids] }.
   Loads after tagmanager_render_hooks.js.
========================================================================= */
(function () {
    'use strict';

    const COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#8bd450', '#30a46c', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f', '#a18072',
                    '#2bd4ff', '#7a8cff', '#b5e61d', '#ff9aa2', '#7fffd4', '#c9a0ff', '#8b5a2b', '#e6e6e6', '#5c6370', '#ffd1a3'];
    const swatchText = col => { const n = parseInt(col.slice(1), 16); const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return l < 110 ? '#fff' : '#000'; };
    const NAME = i => `Group ${i}`;

    /* ---------- CSS ---------- */
    const st = document.createElement('style');
    st.textContent = `
        .cg-divider { display:flex; align-items:center; gap:6px; padding:4px 8px; font-size:11px; font-weight:bold; border-bottom:1px solid #222;
            border-left:5px solid var(--cg-color, #888); background:color-mix(in srgb, var(--cg-color, #888) 18%, #151515); color:#ddd; user-select:none; }
        .cg-divider.cg-end { padding:0; height:6px; border-left:5px solid #333; background:#101010; }
        .cg-divider .cg-dot { width:10px; height:10px; border-radius:50%; background:var(--cg-color, #888); flex-shrink:0; }
        .cg-divider .cg-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
        .cg-divider .cg-name:hover { text-decoration:underline; }
        .cg-divider .cg-name small { color:#999; font-weight:normal; margin-left:4px; }
        .cg-divider button { background:transparent; border:1px solid #444; color:#bbb; border-radius:4px; padding:1px 5px; font-size:12px; cursor:pointer; line-height:1.3; flex-shrink:0; }
        .cg-divider button:hover { color:#fff; border-color:#888; }
        .cg-divider button.cg-on { background:#2a2a2a; color:#ffcf70; border-color:#ffcf70; }
        .list-item.cg-compact { --thumb-size:26px; padding-top:3px; padding-bottom:3px; }
        .list-item.cg-compact .list-item-status { display:none; }
        .list-item.cg-muted { opacity:0.55; }
        #cg-palette { position:fixed; z-index:99999; background:#1b1b1b; border:1px solid #444; border-radius:8px; padding:8px; display:none; box-shadow:0 6px 20px rgba(0,0,0,0.6); }
        #cg-palette .cg-pal-grid { display:grid; grid-template-columns:repeat(5, 28px); gap:6px; }
        #cg-palette .cg-sw { width:28px; height:28px; border-radius:6px; border:2px solid #111; cursor:pointer; color:#000; font-size:11px; font-weight:bold; display:flex; align-items:center; justify-content:center; }
        #cg-palette .cg-sw:hover { border-color:#fff; }
        #cg-palette .cg-none { margin-top:8px; width:100%; background:#2a1111; color:#ffb6c0; border:1px solid #7a222c; border-radius:6px; padding:4px; font-size:11px; cursor:pointer; }
        #cg-palette .cg-title { font-size:10px; color:#999; margin-bottom:6px; }
        #cg-filter-pop { position:fixed; z-index:99999; background:#1b1b1b; border:1px solid #444; border-radius:8px; padding:8px; display:none; box-shadow:0 6px 20px rgba(0,0,0,0.6); }
        #cg-filter-pop .cg-pal-grid { display:grid; grid-template-columns:repeat(5, 28px); gap:6px; }
        #cg-filter-pop .cg-sw { width:28px; height:28px; border-radius:6px; border:2px solid #111; cursor:pointer; font-size:11px; font-weight:bold; display:flex; align-items:center; justify-content:center; }
        #cg-filter-pop .cg-sw:hover { border-color:#fff; }
        #cg-filter-pop .cg-sw.cg-active { border-color:#fff; box-shadow:0 0 0 2px #ffcf70; }
        #cg-filter-pop .cg-none { margin-top:8px; width:100%; background:#1a2a3a; color:#9fd0ff; border:1px solid #2a5a8c; border-radius:6px; padding:4px; font-size:11px; cursor:pointer; }
        #cg-filter-pop .cg-title { font-size:10px; color:#999; margin-bottom:6px; }
        #btn-group-filter { flex-shrink:0; padding:6px 10px; font-size:12px; font-weight:bold; background:transparent; border:1px solid #444; color:#aaa; transition:0.2s; white-space:nowrap; display:none; }
        #btn-color-group { background:#1c1c2a; border-color:#4a4a8c; color:#b8b8ff; padding:2px 6px; font-size:14px; }
    `;
    document.head.appendChild(st);

    /* ---------- state (single source of truth: datasetConfig) ---------- */
    const cfg = () => (typeof datasetConfig !== 'undefined' && datasetConfig) ? datasetConfig : null;
    function state() {
        const c = cfg(); if (!c) return { muted: new Set(), collapsed: new Set(), compact: new Set() };
        const s = c.cgState || {};
        return { muted: new Set(s.muted || []), collapsed: new Set(s.collapsed || []), compact: new Set(s.compact || []) };
    }
    function saveState(s) {
        const c = cfg(); if (!c) return;
        c.cgState = { muted: Array.from(s.muted), collapsed: Array.from(s.collapsed), compact: Array.from(s.compact) };
        if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
    }
    function groupOf(img) { const c = cfg(); const e = c && c[img.baseName]; return (e && e.cg) || 0; }
    function members(g) { return (typeof imageFiles === 'undefined' ? [] : imageFiles).filter(i => groupOf(i) === g); }

    // img.cgGroup / img.muted are derived from datasetConfig (img.muted is read by the All Dataset Tags counter)
    function syncFlags() {
        if (typeof imageFiles === 'undefined') return false;
        const s = state(); let anyMuted = false;
        imageFiles.forEach(img => {
            const g = groupOf(img);
            img.cgGroup = g;
            const m = g > 0 && s.muted.has(g);
            if (m) anyMuted = true;
            img.muted = m;
        });
        return anyMuted;
    }

    /* ---------- assigning images to a group ---------- */
    function assign(imgs, g) {
        const c = cfg(); if (!c || !imgs || !imgs.length) return;
        const picked = new Set(imgs);
        const selBefore = (typeof selectedIndices !== 'undefined') ? Array.from(selectedIndices).map(i => imageFiles[i]).filter(Boolean) : [];
        const touched = new Set([g]);
        imgs.forEach(img => { touched.add(groupOf(img)); });

        imgs.forEach(img => {
            const e = c[img.baseName] = c[img.baseName] || {};
            if (g > 0) e.cg = g; else delete e.cg;
        });

        if (g > 0) {
            // group together: all members (old + new) go where the HIGHEST of them was
            const all = new Set(imageFiles.filter(i => groupOf(i) === g || picked.has(i)));
            const top = imageFiles.findIndex(i => all.has(i));
            let nonBefore = 0;
            for (let i = 0; i < top; i++) if (!all.has(imageFiles[i])) nonBefore++;
            const moved = imageFiles.filter(i => all.has(i));
            const rest = imageFiles.filter(i => !all.has(i));
            rest.splice(nonBefore, 0, ...moved);
            imageFiles.splice(0, imageFiles.length, ...rest);
            imageFiles.forEach((f, i) => { const e = c[f.baseName] = c[f.baseName] || {}; e.order = i; });
        }

        // a group that became empty forgets its muted / collapsed / compact flags
        const s = state();
        touched.forEach(t => {
            if (t > 0 && members(t).length === 0) ['muted', 'collapsed', 'compact'].forEach(k => s[k].delete(t));
        });
        saveState(s);

        syncFlags();
        if (typeof selectedIndices !== 'undefined') selectedIndices.clear();
        if (typeof window.renderImageList === 'function') window.renderImageList();
        if (typeof selectedIndices !== 'undefined') imageFiles.forEach((f, i) => { if (selBefore.includes(f)) selectedIndices.add(i); });
        if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (window.showAlert) window.showAlert(g > 0 ? `${imgs.length} image(s) in ${NAME(g)}.` : `${imgs.length} image(s) taken out of their group.`, 'success');
    }

    function selectedImgs() {
        if (typeof selectedIndices === 'undefined') return [];
        return Array.from(selectedIndices).sort((a, b) => a - b).map(i => imageFiles[i]).filter(Boolean);
    }

    /* ---------- palette ---------- */
    function buildPalette() {
        let p = document.getElementById('cg-palette');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'cg-palette';
        p.innerHTML = '<div class="cg-title">Put the selected images in a group</div><div class="cg-pal-grid"></div><button class="cg-none" type="button">✖ No group</button>';
        const grid = p.querySelector('.cg-pal-grid');
        COLORS.forEach((col, i) => {
            const sw = document.createElement('div');
            sw.className = 'cg-sw'; sw.style.background = col; sw.style.color = swatchText(col); sw.textContent = String(i + 1); sw.title = NAME(i + 1);
            sw.onclick = (e) => { e.stopPropagation(); p.style.display = 'none'; assign(selectedImgs(), i + 1); };
            grid.appendChild(sw);
        });
        p.querySelector('.cg-none').onclick = (e) => { e.stopPropagation(); p.style.display = 'none'; assign(selectedImgs(), 0); };
        p.onclick = e => e.stopPropagation();
        document.body.appendChild(p);
        document.addEventListener('click', () => { p.style.display = 'none'; });
        return p;
    }

    function injectButton() {
        const host = document.getElementById('list-hidefocus-actions');
        if (!host || document.getElementById('btn-color-group')) return;
        const b = document.createElement('button');
        b.id = 'btn-color-group';
        b.className = 'btn-save-local';
        b.textContent = '🌈';
        b.title = 'Put the selected images in a color group (up to 20)';
        b.onclick = (e) => {
            e.stopPropagation();
            const p = buildPalette();
            const r = b.getBoundingClientRect();
            p.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 200)) + 'px';
            p.style.top = (r.bottom + 6) + 'px';
            p.style.display = p.style.display === 'block' ? 'none' : 'block';
        };
        host.appendChild(b);
    }

    /* ---------- dividers + collapse / compact / mute (after every list render) ---------- */
    function makeDivider(g, count) {
        const s = state();
        const d = document.createElement('div');
        d.className = 'cg-divider';
        d.dataset.cg = String(g);
        d.style.setProperty('--cg-color', COLORS[g - 1] || '#888');
        const collapsed = s.collapsed.has(g), compact = s.compact.has(g), muted = s.muted.has(g);

        const dot = document.createElement('span'); dot.className = 'cg-dot';
        const name = document.createElement('span'); name.className = 'cg-name';
        name.innerHTML = `${NAME(g)} <small>${count} image${count === 1 ? '' : 's'}${muted ? ' · muted' : ''}</small>`;
        name.title = 'Click to select all the images of this group';
        name.onclick = (e) => { e.stopPropagation(); selectGroup(g); };

        const mk = (txt, title, on, fn) => {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = title;
            if (on) b.classList.add('cg-on');
            b.onclick = (e) => { e.stopPropagation(); fn(); };
            b.ondblclick = (e) => e.stopPropagation();
            return b;
        };
        // double click anywhere on the bar = collapse / expand (the buttons keep their own double clicks out of it)
        d.title = 'Double-click the bar to collapse / expand this group';
        d.ondblclick = (e) => { e.preventDefault(); toggle('collapsed', g); };
        d.appendChild(dot); d.appendChild(name);
        d.appendChild(mk('🗜️', compact ? 'Back to normal size' : 'Compact: small thumbnails for this group', compact, () => toggle('compact', g)));
        d.appendChild(mk(collapsed ? '▸' : '▾', collapsed ? 'Expand: show the images of this group' : 'Collapse: keep only this line', collapsed, () => toggle('collapsed', g)));
        d.appendChild(mk('🔇', muted ? 'Unmute: its tags count in All Dataset Tags again' : "Mute: remove this group's tags from All Dataset Tags (preview only)", muted, () => toggle('muted', g)));
        d.appendChild(mk('✖', 'Ungroup: take every image out of this group', false, () => assign(members(g), 0)));
        return d;
    }

    function selectGroup(g) {
        if (typeof selectedIndices === 'undefined') return;
        selectedIndices.clear();
        imageFiles.forEach((img, i) => { if (groupOf(img) === g && !img.hidden && img.element && img.element.style.display !== 'none') selectedIndices.add(i); });
        if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
        if (typeof window.renderEditor === 'function') window.renderEditor();
    }

    function toggle(kind, g) {
        const s = state();
        if (s[kind].has(g)) s[kind].delete(g); else s[kind].add(g);
        saveState(s);
        if (kind === 'muted') {
            syncFlags();
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
        }
        decorate(false);
    }

    /* Rename and Clone drop datasetConfig[img].order, so after a reload an image of a group can land outside its
       block. If any group is split, put its members back together (where its highest member is), save the order
       of every image and render again. Returns true when it re-rendered. */
    let _regrouping = false;
    function regroupIfSplit() {
        const c = cfg();
        if (_regrouping || !c || typeof imageFiles === 'undefined' || imageFiles.length < 2) return false;
        const seenEnd = new Set(); let prev = 0, split = false;
        for (const img of imageFiles) {
            const g = groupOf(img);
            if (g !== prev) { if (prev) seenEnd.add(prev); if (g && seenEnd.has(g)) { split = true; break; } }
            prev = g;
        }
        if (!split) return false;
        const firstPos = new Map();
        imageFiles.forEach((img, i) => { const g = groupOf(img); if (g && !firstPos.has(g)) firstPos.set(g, i); });
        // stable: every image keeps its place, except group members, which all take their group's first place
        const keyed = imageFiles.map((img, i) => { const g = groupOf(img); return { img, k: g ? firstPos.get(g) : i, i }; });
        keyed.sort((a, b) => (a.k - b.k) || (a.i - b.i));
        const selBefore = (typeof selectedIndices !== 'undefined') ? Array.from(selectedIndices).map(i => imageFiles[i]).filter(Boolean) : [];
        imageFiles.splice(0, imageFiles.length, ...keyed.map(x => x.img));
        imageFiles.forEach((f, i) => { const e = c[f.baseName] = c[f.baseName] || {}; e.order = i; });
        if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
        _regrouping = true;
        try {
            if (typeof selectedIndices !== 'undefined') selectedIndices.clear();
            if (typeof window.renderImageList === 'function') window.renderImageList();
            if (typeof selectedIndices !== 'undefined') imageFiles.forEach((f, i) => { if (selBefore.includes(f)) selectedIndices.add(i); });
            if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
        } finally { _regrouping = false; }
        decorate(false);
        return true;
    }

    // afterFilter = the filters have just reset every row's display, so rows folded earlier are not touched again
    function decorate(afterFilter) {
        const listDiv = document.getElementById('image-list');
        if (!listDiv || typeof imageFiles === 'undefined') return;
        if (_regrouping) return;
        if (!afterFilter && regroupIfSplit()) return;
        syncFlags();
        refreshFilterBtn();
        const s = state();
        listDiv.querySelectorAll('.cg-divider').forEach(d => d.remove());

        // 1) clear what this module did before
        imageFiles.forEach(img => {
            const el = img.element; if (!el) return;
            if (el.dataset.cgFolded) { if (!afterFilter) el.style.display = ''; delete el.dataset.cgFolded; }
            el.classList.remove('cg-compact', 'cg-muted');
            el.style.boxShadow = '';
        });

        // While images are hidden (👁️ Hide / 🎯 Focus) the group control bars (dividers) are hidden from the list too,
        // until the images are revealed again. The row colors stay and the group data is untouched; collapsed groups
        // are shown unfolded meanwhile (no bar to expand them with).
        const hiddenMode = (typeof window.tmHasHiddenImages === 'function') && window.tmHasHiddenImages();
        if (hiddenMode) { const pal = document.getElementById('cg-palette'); if (pal) pal.style.display = 'none'; }

        // 2) style the rows, find the groups still shown by the filters
        const shown = {}; const count = {};
        imageFiles.forEach(img => {
            const g = img.cgGroup || 0; const el = img.element;
            if (!g || !el || !el.isConnected || img.hidden) return;
            count[g] = (count[g] || 0) + 1;
            el.style.boxShadow = `inset 4px 0 0 ${COLORS[g - 1] || '#888'}`;
            if (s.compact.has(g)) el.classList.add('cg-compact');
            if (s.muted.has(g)) el.classList.add('cg-muted');
            if (el.style.display !== 'none') shown[g] = (shown[g] || 0) + 1;
        });

        // 3) dividers at every change of group, then fold the collapsed groups
        let prev = 0, first = true;
        if (!hiddenMode) imageFiles.forEach(img => {
            const el = img.element;
            if (!el || !el.isConnected || img.hidden) return;
            const filtered = el.style.display === 'none';
            const g = img.cgGroup || 0;
            if (g !== prev && !filtered) {
                if (g > 0) listDiv.insertBefore(makeDivider(g, count[g] || 0), el);
                else if (!first) { const end = document.createElement('div'); end.className = 'cg-divider cg-end'; listDiv.insertBefore(end, el); }
            }
            if (!filtered) { prev = g; first = false; }
            if (g > 0 && s.collapsed.has(g) && !filtered) { el.style.display = 'none'; el.dataset.cgFolded = '1'; }
        });

        // folded rows leave the selection (nothing selected that cannot be seen)
        if (typeof window.pruneSelectionToVisible === 'function') {
            try { window.pruneSelectionToVisible(); } catch (e) {}
        }
    }

    /* ---------- A-Z / Z-A (replaces the old 🔒 Reorder lock) ----------
       Sorts the images by name and saves the order in datasetConfig[img].order.
       Color groups keep their place: each group stays as one block where it was (sorted inside), and the
       images without a group are sorted among themselves in the remaining places. */
    let sortDir = 0;   // 0 = not sorted by this button yet, 1 = A→Z, -1 = Z→A
    const cmpName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });

    function paintSortBtn() {
        const b = document.getElementById('btn-sort-az');
        if (!b) return;
        b.textContent = sortDir === 1 ? 'A→Z' : sortDir === -1 ? 'Z→A' : 'A-Z';
        b.style.color = sortDir ? '#00ff99' : '#aaa';
        b.style.borderColor = sortDir ? '#00aa66' : '#444';
        b.title = sortDir === 1 ? 'Sorted A → Z — click for Z → A' : sortDir === -1 ? 'Sorted Z → A — click for A → Z' : 'Sort the images A → Z (click again: Z → A). Color groups stay together.';
    }

    window.tmSortImagesAZ = function () {
        const c = cfg();
        if (!c || typeof imageFiles === 'undefined' || imageFiles.length < 2) return;
        sortDir = sortDir === 1 ? -1 : 1;
        const dir = sortDir;
        const sorter = (a, b) => dir * cmpName(a, b);
        const lists = new Map();   // group id (0 = none) -> its images, sorted
        imageFiles.forEach(img => { const g = groupOf(img); if (!lists.has(g)) lists.set(g, []); lists.get(g).push(img); });
        lists.forEach(arr => arr.sort(sorter));
        const used = new Map();
        const result = imageFiles.map(img => { const g = groupOf(img); const k = used.get(g) || 0; used.set(g, k + 1); return lists.get(g)[k]; });

        const selBefore = (typeof selectedIndices !== 'undefined') ? Array.from(selectedIndices).map(i => imageFiles[i]).filter(Boolean) : [];
        imageFiles.splice(0, imageFiles.length, ...result);
        imageFiles.forEach((f, i) => { const e = c[f.baseName] = c[f.baseName] || {}; e.order = i; });
        if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
        if (typeof selectedIndices !== 'undefined') selectedIndices.clear();
        if (typeof window.renderImageList === 'function') window.renderImageList();
        if (typeof selectedIndices !== 'undefined') imageFiles.forEach((f, i) => { if (selBefore.includes(f)) selectedIndices.add(i); });
        if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
        paintSortBtn();
    };

    /* ---------- 🌈 group filter (button next to "Filter images by name") ----------
       Shown only while at least one image is in a color group. The pop-out lists just the groups in use; picking
       one filters the list to that group (applyFilters reads window.cgFilterGroup), picking it again clears it. */
    window.cgFilterGroup = 0;
    window.tmImageGroup = groupOf;

    function groupCounts() {
        const n = {};
        if (typeof imageFiles === 'undefined') return n;
        imageFiles.forEach(img => { if (img.hidden) return; const g = groupOf(img); if (g > 0) n[g] = (n[g] || 0) + 1; });
        return n;
    }

    function setGroupFilter(g) {
        window.cgFilterGroup = g || 0;
        if (typeof window.applyFilters === 'function') window.applyFilters();
        refreshFilterBtn();
    }

    function injectFilterButton() {
        if (document.getElementById('btn-group-filter')) return;
        const anchor = document.getElementById('btn-sort-az') || document.getElementById('image-search-input');
        if (!anchor || !anchor.parentNode) return;
        const b = document.createElement('button');
        b.id = 'btn-group-filter';
        b.type = 'button';
        b.textContent = '🌈';
        b.onclick = (e) => { e.stopPropagation(); openFilterPop(b); };
        if (anchor.id === 'btn-sort-az') anchor.parentNode.insertBefore(b, anchor);
        else anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }

    function openFilterPop(btn) {
        let p = document.getElementById('cg-filter-pop');
        if (!p) {
            p = document.createElement('div'); p.id = 'cg-filter-pop';
            p.onclick = e => e.stopPropagation();
            document.body.appendChild(p);
            document.addEventListener('click', () => { p.style.display = 'none'; });
        }
        if (p.style.display === 'block') { p.style.display = 'none'; return; }
        const counts = groupCounts();
        p.innerHTML = '<div class="cg-title">Show only one group</div><div class="cg-pal-grid"></div><button class="cg-none" type="button">Show all images</button>';
        const grid = p.querySelector('.cg-pal-grid');
        Object.keys(counts).map(Number).sort((a, b) => a - b).forEach(g => {
            const sw = document.createElement('div');
            sw.className = 'cg-sw' + (window.cgFilterGroup === g ? ' cg-active' : '');
            sw.style.background = COLORS[g - 1] || '#888'; sw.style.color = swatchText(COLORS[g - 1] || '#888');
            sw.textContent = String(g); sw.title = NAME(g) + ' — ' + counts[g] + ' image(s)';
            sw.onclick = (e) => { e.stopPropagation(); p.style.display = 'none'; setGroupFilter(window.cgFilterGroup === g ? 0 : g); };
            grid.appendChild(sw);
        });
        p.querySelector('.cg-none').onclick = (e) => { e.stopPropagation(); p.style.display = 'none'; setGroupFilter(0); };
        const r = btn.getBoundingClientRect();
        p.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 200)) + 'px';
        p.style.top = (r.bottom + 6) + 'px';
        p.style.display = 'block';
    }

    // shows / hides the button, paints the active group, drops the filter when its group has no images any more
    function refreshFilterBtn() {
        injectFilterButton();
        const b = document.getElementById('btn-group-filter'); if (!b) return;
        const counts = groupCounts();
        const g = window.cgFilterGroup;
        if (g && !counts[g]) {
            window.cgFilterGroup = 0;
            setTimeout(() => { if (typeof window.applyFilters === 'function') window.applyFilters(); }, 0);
        }
        const act = window.cgFilterGroup;
        b.style.display = (Object.keys(counts).length > 0 || act) ? '' : 'none';
        if (act) {
            const col = COLORS[act - 1] || '#888';
            b.textContent = '🌈 ' + act;
            b.style.background = col; b.style.color = swatchText(col); b.style.borderColor = '#fff';
            b.title = NAME(act) + ' filter is on — click to change or clear it';
        } else {
            b.textContent = '🌈';
            b.style.background = 'transparent'; b.style.color = '#aaa'; b.style.borderColor = '#444';
            b.title = 'Filter the list by color group';
        }
    }

    /* ---------- hooks ---------- */
    function onConfigOrDataset() {
        const anyMuted = syncFlags();
        if (anyMuted && typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    }

    function install() {
        injectButton();
        injectFilterButton();
        const TM = window.TM;
        if (TM && typeof TM.on === 'function') {
            TM.on('render:list', () => decorate(false));
            TM.on('filters:applied', () => decorate(true));
            TM.on('config:loaded', onConfigOrDataset);
            TM.on('dataset:loaded', () => { window.cgFilterGroup = 0; injectButton(); onConfigOrDataset(); sortDir = 0; paintSortBtn(); refreshFilterBtn(); });
        } else if (typeof window.registerPostRenderImageList === 'function') {
            window.registerPostRenderImageList(() => decorate(false));
        }
        decorate(false);
    }
    window.addEventListener('DOMContentLoaded', () => setTimeout(install, 0));

    window.tmColorGroups = { assign: (imgs, g) => assign(imgs, g), members, refresh: () => decorate(false) };
})();
