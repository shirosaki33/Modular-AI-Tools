/* =========================================================================
   DATASET NAVIGATION — ⏪ previous dataset · 📂 Go to (open in Explorer) · folder depth
   ---------------------------------------------------------------------
   ⏪ (next to 🔄 Refresh): goes back to the dataset you were looking at before
      (root folder + subfolders of each level) where you actually did something
      (saved tags/images, ran a task) — merely opening a dataset does not count.
      Clicking again goes back to the other one — it toggles.
   📂 Go to (next to Remove, localhost only): opens the folder of the dataset on
      screen in the file manager (Windows Explorer / Finder / xdg-open).
      The browser does not know the real path of a folder, so the first time the
      local server looks for it (a small temporary marker file is written in the
      root folder and found on disk); if it is not found you paste the path once.
      The path of each root folder is remembered ('dataset-root-paths').
   ⚙️ 📂 Folders > Folder depth (1–10, default 3): how many levels of subfolder
      dropdowns are shown (tagmanager_ui_core.js builds them on demand).
   Loads after tagmanager_ui_core.js.
========================================================================= */
(function () {
    'use strict';
    const PATHS_KEY = 'dataset-root-paths';
    const DEPTH_KEY = 'folder-depth';
    const isLocal = () => (typeof window.MAT_IS_LOCAL === 'boolean') ? window.MAT_IS_LOCAL
        : ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

    const st = document.createElement('style');
    st.textContent = `
        #btn-prev-dataset { display:none; background:#1a2a3c; color:#8fd0ff; border:1px solid #2a5a8c; }
        #btn-prev-dataset:hover { color:#fff; border-color:#4db8ff; }
        /* the left side of the top bar gets crowded (subfolder selects + ⏪ 🔄 Remove 📦 Archive 📂): the buttons stay on ONE line
           and the left side takes the room it needs (the title keeps its own width instead of getting an equal third) */
        #topbar { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); column-gap:10px; }
        #topbar .topbar-section { min-width:0; }
        #topbar .topbar-section.left { overflow:hidden; }
        #topbar .topbar-section.left button { white-space:nowrap; flex-shrink:0; }
        #topbar .topbar-section.left select.folder-select { flex:0 1 auto; min-width:56px; }
        #btn-goto-folder { display:none; white-space:nowrap; background:#0d1f2a; color:#66ccff; border:1px solid #144a63; }
        #btn-goto-folder:hover { color:#fff; border-color:#66ccff; }
    `;
    document.head.appendChild(st);

    /* ---------- ⏪ PREVIOUS DATASET ---------- */
    let cur = null, prev = null;
    const labelOf = loc => loc ? [loc.root && loc.root.name].concat(loc.path || []).filter(Boolean).join(' / ') : '';
    const same = (a, b) => !!a && !!b && a.root === b.root && (a.path || []).join('\u0001') === (b.path || []).join('\u0001');

    // A dataset only becomes the "previous" one if something was actually done in it
    // (image/tag save, config save, background task) — just opening it does not count.
    function markWorked() { if (cur && !window._tmFolderLoading) cur.worked = true; }
    function wrapSave(name, isCurrent) {
        const orig = window[name];
        if (typeof orig !== 'function' || orig._tmNav) return;
        const w = function () {
            try { if (isCurrent(arguments)) markWorked(); } catch (e) {}
            return orig.apply(this, arguments);
        };
        w._tmNav = true;
        window[name] = w;
    }
    const isCurHandle = a => !a[0] || a[0] === window.currentImagesHandle;
    wrapSave('saveImageToDisk', () => true);
    wrapSave('saveDatasetConfig', isCurHandle);
    wrapSave('savePendingTagsStore', isCurHandle);
    if (window.TM && TM.tasks && typeof TM.tasks.run === 'function' && !TM.tasks.run._tmNav) {
        const origRun = TM.tasks.run;
        TM.tasks.run = function (opts) {
            try { if (!opts || !opts.ctx) markWorked(); } catch (e) {}
            return origRun.apply(this, arguments);
        };
        TM.tasks.run._tmNav = true;
    }

    window.tmOnFolderLoaded = function () {
        if (window._tmSkipHistory) return;
        const loc = { root: window.rootHandle, path: typeof window.tmCurrentFolderPath === 'function' ? window.tmCurrentFolderPath() : [], worked: false };
        if (!loc.root) return;
        if (cur && same(cur, loc)) { paintPrev(); return; }       // refresh of the same folder: keep the "worked" flag
        if (cur && cur.worked) prev = cur;                         // leaving a dataset where something was done
        cur = loc;
        paintPrev();
    };
    function paintPrev() {
        const b = document.getElementById('btn-prev-dataset');
        if (!b) return;
        b.style.display = prev ? 'inline-block' : 'none';
        b.title = prev ? `Back to the last dataset you worked on: ${labelOf(prev)}` : '';
    }
    async function goPrevious() {
        if (!prev) return;
        const target = prev;
        const from = cur;
        window._tmSkipHistory = true;
        let ok = false;
        try { ok = await window.tmOpenFolderPath(target.root, target.path); }
        catch (e) { console.warn('[Previous dataset]', e); }
        finally { window._tmSkipHistory = false; }
        if (ok) {
            const now = { root: window.rootHandle, path: window.tmCurrentFolderPath(), worked: false };
            cur = same(now, target) ? target : now;
            prev = from;
            if (!same(cur, target) && window.showAlert) window.showAlert(`Part of "${labelOf(target)}" no longer exists — opened "${labelOf(cur)}".`, 'warn');
        } else if (window.showAlert) window.showAlert(`Could not open "${labelOf(target)}" (no permission or the folder was removed).`, 'error');
        paintPrev();
    }

    /* ---------- 📂 GO TO (open the folder in the file manager) ---------- */
    async function getPaths() { try { return (typeof window.getSetting === 'function' && await window.getSetting(PATHS_KEY, {})) || {}; } catch (e) { return {}; } }
    async function setPath(key, path) {
        const m = await getPaths();
        if (path) m[key] = path; else delete m[key];
        if (typeof window.saveSetting === 'function') window.saveSetting(PATHS_KEY, m);
    }
    const rootKey = () => window.rootHandleKey || (window.rootHandle && window.rootHandle.name) || '';
    async function post(url, body) {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        let d = null; try { d = await r.json(); } catch (e) {}
        return { ok: r.ok && d && d.status === 'success', data: d || {} };
    }
    // Finds the real path of the root folder: marker file written through the browser, located by the server.
    async function locateRoot(candidates) {
        const root = window.rootHandle;
        const marker = `_tm_locate_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`;
        try {
            const h = await root.getFileHandle(marker, { create: true });
            const w = await h.createWritable(); await w.write('Tag Manager: temporary file used to find this folder on disk. Safe to delete.'); await w.close();
        } catch (e) { return null; }
        try {
            const r = await post('/api/locate_folder', { name: root.name, marker, candidates: candidates || [] });
            return r.ok ? r.data.path : null;
        } catch (e) { return null; }
        finally { try { await root.removeEntry(marker); } catch (e) {} }
    }
    async function goToFolder() {
        const root = window.rootHandle, dir = window.currentImagesHandle || root;
        if (!root) return;
        if (!isLocal()) { if (window.showAlert) window.showAlert('📂 Go to needs the local server (localhost).', 'info'); return; }
        let rel = [];
        try { rel = (await root.resolve(dir)) || []; } catch (e) {}
        const key = rootKey();
        const btn = document.getElementById('btn-goto-folder');
        const open = async (path) => (await post('/api/open_folder', { root: path, folder: rel.join('/') })).ok;
        try {
            if (btn) btn.disabled = true;
            let path = (await getPaths())[key];
            if (path && await open(path)) return;
            if (path) await setPath(key, null);                      // moved / renamed: find it again
            if (window.showAlert) window.showAlert(`Looking for "${root.name}" on disk (first time only)…`, 'info');
            path = await locateRoot([]);
            if (!path) {
                const typed = prompt(`Paste the full path of the folder "${root.name}" (for example F:\\Datasets\\${root.name}).\nIt is asked only once and remembered.`, '');
                if (!typed) return;
                path = await locateRoot([typed.trim().replace(/^"|"$/g, '')]);
                if (!path) { if (window.showAlert) window.showAlert(`That path is not the folder "${root.name}" opened here (or it does not exist).`, 'error'); return; }
            }
            await setPath(key, path);
            if (!(await open(path)) && window.showAlert) window.showAlert('Could not open the folder in the file manager.', 'error');
        } finally { if (btn) btn.disabled = false; }
    }

    /* ---------- buttons ---------- */
    function injectButtons() {
        const refresh = document.getElementById('btn-refresh');
        if (refresh && !document.getElementById('btn-prev-dataset')) {
            const b = document.createElement('button');
            b.id = 'btn-prev-dataset';
            b.textContent = '⏪';
            b.onclick = goPrevious;
            refresh.insertAdjacentElement('afterend', b);
            paintPrev();
        }
        const remove = document.getElementById('btn-remove');
        if (remove && !document.getElementById('btn-goto-folder')) {
            const g = document.createElement('button');
            g.id = 'btn-goto-folder';
            g.textContent = '📂 Go to';
            g.title = 'Open the folder of this dataset in the file manager (localhost)';
            g.onclick = goToFolder;
            remove.insertAdjacentElement('afterend', g);
        }
    }
    // Go to is visible whenever a folder is open (localhost only).
    function paintGoto() {
        const g = document.getElementById('btn-goto-folder');
        if (g) g.style.display = (isLocal() && window.rootHandle) ? 'inline-block' : 'none';
    }

    /* ---------- ⚙️ Folder depth ---------- */
    function applyDepth(v, save) {
        let n = parseInt(v, 10);
        if (!isFinite(n)) n = 3;
        n = Math.max(1, Math.min(window.TM_MAX_FOLDER_DEPTH || 10, n));
        window.tmFolderDepth = n;
        const inp = document.getElementById('folder-depth');
        if (inp && String(inp.value) !== String(n)) inp.value = n;
        if (save && typeof window.saveSetting === 'function') window.saveSetting(DEPTH_KEY, n);
        return n;
    }
    function injectDepthSetting() {
        const dd = document.getElementById('settings-dropdown');
        if (!dd || document.getElementById('folder-depth')) return;
        const grp = document.createElement('div');
        grp.id = 'settings-folders-group';
        grp.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
        grp.innerHTML = `
            <div class="settings-group-label">📂 Folders</div>
            <label title="How many levels of subfolders can be opened with the folder dropdowns (1–10). Deeper levels appear as you open subfolders.">Folder depth:
                <input type="number" id="folder-depth" min="1" max="10" step="1" style="width:56px;">
            </label>
            <label title="ON: for folders in the Saved directories list, the config files of every dataset (_tagger_config.json, _nl_manager.json, _pending_tags.json…) are kept in &lt;saved root&gt;/_store_configs/, so the dataset folder only has the images, the captions and _archive. OFF: each dataset keeps them inside its own folder. A folder opened with Load Folder that is not in the saved list always keeps them inside. Switching moves the files of the current saved root right away."><input type="checkbox" id="toggle-config-store-root"> 🗄️ Store configs on root (_store_configs)</label>`;
        dd.appendChild(grp);
        const inp = document.getElementById('folder-depth');
        inp.value = window.tmFolderDepth || 3;
        inp.onchange = async () => {
            const n = applyDepth(inp.value, true);
            if (window.showAlert) window.showAlert(`Folder depth: ${n} level(s). Refreshing the folder list…`, 'info');
            if (window.rootHandle && typeof window.refreshDataset === 'function') await window.refreshDataset();
        };
    }

    // depth must be known before the first folder is opened
    (async () => {
        try { if (typeof window.getSetting === 'function') applyDepth(await window.getSetting(DEPTH_KEY, 3), false); } catch (e) {}
    })();

    window.addEventListener('DOMContentLoaded', () => {
        injectButtons();
        injectDepthSetting();
        paintGoto();
        if (window.TM && typeof window.TM.on === 'function') window.TM.on('dataset:loaded', () => { injectButtons(); paintGoto(); });
        setInterval(paintGoto, 1500);   // cheap: follows Load Folder / Remove
    });
    window.tmGoToDatasetFolder = goToFolder;
    window.tmGoPreviousDataset = goPrevious;
})();
