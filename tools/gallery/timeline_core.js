/* ================================================================
   GALLERY TIMELINE CORE
   Companion of "gallery timeline.html". Loaded AFTER gallery_ui.js and
   gallery_core.js and re-implements what is different from Gallery Holder:

     - the selected directory is scanned RECURSIVELY (every subfolder);
     - images are grouped in sections, one section per folder, ordered by
       the folder's date (or by its name) instead of by image name;
     - the sidebar lists the folders as a TREE (subfolders indented under
       their parent); hiding a folder hides its subfolders too;
     - everything is PAGINATED (a page = N images, sections can continue
       on the next page) and previews are the reduced thumbnails of
       tools/shared/thumb_loader.js, so thousands of photos stay light on RAM.

   Everything else (metadata panel, JSON sidecar, zoom, parsers...) is
   reused from gallery_ui.js / gallery_core.js — functions below
   deliberately keep the SAME NAMES as the ones they replace, so the
   inline handlers of the shared code keep working.

   FOLDER ORDER (⚙️ → "Order folders by"):
     created  real creation date of the folder. The browser cannot read it,
              so it comes from server_max.py (/api/folder_dates). Only
              available on http://localhost and with the folder's real path
              typed in the settings.
     oldest / newest   date of the oldest / newest image inside the folder
     name     folder name
   ================================================================ */

/* Globals expected by the shared code (gallery_ui.js reads them in its click handler) */
var isRenameMode = false;
var isTagMode = false;
var isMergeMode = false;

const TL_IMG_RE = /\.(png|jpe?g|webp)$/i;
const TL_PAGE_SIZES = [50, 100, 150, 200];
const TL_MAX_DEPTH = 30;
const TL_MODES = ['created', 'oldest', 'newest', 'name'];
const tlCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/* ---------------- state ---------------- */
let tlRoot = null;                 // FileSystemDirectoryHandle of the selected directory
let tlRootNode = null;             // node of the directory itself (relPath '')
let tlFolders = [];                // EVERY directory: {uid, relPath, name, label, handle, parent, children[], images[], jsonSet, minTs, maxTs, createdTs, _sub, _key}
let tlFolderByUid = new Map();
let tlHidden = new Set();          // relPaths hidden from the timeline (persisted per root)
let tlExpanded = new Set();        // relPaths expanded in the sidebar tree (everything starts collapsed; session only)
let tlHiddenOpen = false;          // the "Hidden folders" group above the list starts collapsed
let tlFlat = [];                   // visible images, in timeline order
let tlVisibleCount = new Map();    // folder -> visible image count
let tlDynamic = true;              // continuous scrolling: pages load/unload while scrolling
let tlWinStart = 0, tlWinEnd = 0;  // item range currently in the DOM
let tlPageItems = [];              // items currently rendered in the grid
let tlScanId = 0;
let tlSortDesc = true;             // date modes: newest first · name mode: Z-A
let tlFolderDateMode = 'oldest';   // one of TL_MODES
let tlImageOrder = 'name-asc';     // order of the images inside a folder
let tlSidebarOpen = true;
let tlInDetail = false;
let tlCurrent = null;              // image open in the detail view
let tlSavedScroll = 0;
let tlStripFolder = null;
let tlStripItems = [];
let tlStripDirty = false;
let tlSettingsPromise = null;
let tlFilterTimer = null;
let tlToastTimer = null;
let tlUidCounter = 0;
let tlNotes = [];                  // notes of the open image: not shown anymore, but kept when saving the JSON
let tlRootPath = '';               // real path of the root on disk (localhost only)
let tlCreatedAvailable = false;    // creation dates were read from the server for this root

const $tl = id => document.getElementById(id);
const tlIsLocal = () => /^https?:$/.test(location.protocol) && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

/* ================================================================
   STORAGE  (own IndexedDB, so it never mixes with Gallery Holder's)
   ================================================================ */
function tlDB() {
    if (!tlDB._p) {
        tlDB._p = new Promise((res, rej) => {
            const req = indexedDB.open('GalleryTimelineDB', 1);
            req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
            req.onsuccess = e => res(e.target.result);
            req.onerror = e => rej(e.target.error);
        });
    }
    return tlDB._p;
}
async function tlKvGet(key) {
    const db = await tlDB();
    return new Promise(r => {
        const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
        req.onsuccess = () => r(req.result);
        req.onerror = () => r(undefined);
    });
}
async function tlKvSet(key, value) {
    const db = await tlDB();
    return new Promise(r => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => r(true);
        tx.onerror = () => r(false);
    });
}
async function tlKvDel(...keys) {
    const db = await tlDB();
    return new Promise(r => {
        const tx = db.transaction('kv', 'readwrite');
        keys.forEach(k => tx.objectStore('kv').delete(k));
        tx.oncomplete = () => r(true);
        tx.onerror = () => r(false);
    });
}
async function tlGetHandles() {
    const db = await tlDB();
    return new Promise(r => {
        const out = [];
        const req = db.transaction('kv', 'readonly').objectStore('kv').openCursor(IDBKeyRange.bound('dir:', 'dir:￿'));
        req.onsuccess = e => {
            const cur = e.target.result;
            if (cur) { out.push({ name: String(cur.key).slice(4), handle: cur.value }); cur.continue(); }
            else r(out);
        };
        req.onerror = () => r(out);
    });
}

async function saveSettingsToDB() {
    try {
        await tlKvSet('settings', {
            filenameField:  $tl('toggle-filename-field').checked,
            sortDesc:       tlSortDesc,
            itemsPerPage:   itemsPerPage,
            blockCollapse:  blockCollapsePrefs,
            gridThumbSize:  gridThumbSize,
            folderDateMode: tlFolderDateMode,
            imageOrder:     tlImageOrder,
            sidebarOpen:    tlSidebarOpen,
            dynamicPages:   tlDynamic
        });
    } catch (e) { console.error('Error saving settings:', e); }
}

function loadSettingsFromDB() {
    tlSettingsPromise = (async () => {
        try {
            const s = await tlKvGet('settings');
            tlUpdateDateModeOptions();
            if (!s) { itemsPerPage = 100; tlUpdateSortButton(); tlUpdatePageSizeButton(); return; }

            $tl('toggle-filename-field').checked = s.filenameField !== undefined ? !!s.filenameField : true;
            tlSortDesc = s.sortDesc !== undefined ? !!s.sortDesc : true;
            tlFolderDateMode = TL_MODES.includes(s.folderDateMode) ? s.folderDateMode : 'oldest';
            if (tlFolderDateMode === 'created' && !tlIsLocal()) tlFolderDateMode = 'oldest';
            tlImageOrder = ['name-asc', 'name-desc', 'date-asc', 'date-desc'].includes(s.imageOrder) ? s.imageOrder : 'name-asc';
            tlSidebarOpen = s.sidebarOpen !== undefined ? !!s.sidebarOpen : true;
            tlDynamic = s.dynamicPages !== undefined ? !!s.dynamicPages : true;
            $tl('toggle-dynamic-pages').checked = tlDynamic;
            itemsPerPage = TL_PAGE_SIZES.includes(s.itemsPerPage) ? s.itemsPerPage : 100;
            $tl('folder-date-mode').value = tlFolderDateMode;
            $tl('image-order-mode').value = tlImageOrder;
            tlUpdateSortButton();
            tlUpdatePageSizeButton();

            if (s.blockCollapse && typeof s.blockCollapse === 'object') blockCollapsePrefs = s.blockCollapse;
            if (typeof s.gridThumbSize === 'number' && s.gridThumbSize >= 100 && s.gridThumbSize <= 400) {
                gridThumbSize = s.gridThumbSize;
                const slider = $tl('grid-thumb-slider');
                if (slider) slider.value = gridThumbSize;
                updateGridThumbSize(gridThumbSize, true);
            }
            tlUpdateChrome();
            // Settings may arrive after a directory was already scanned.
            if (tlRoot) { tlRecompute(); renderGrid(); renderFolderSidebar(); }
        } catch (e) { console.error('Error loading settings:', e); }
    })();
    return tlSettingsPromise;
}

/* Parts of the shared code that this app no longer has */
function togglePathDisplay() {}
function togglePathIcon() {}
function toggleExtraFields() {}          // the "Generation Data" extras are always visible now

/* Notes were removed from this app's UI. They still live in the JSON files (made by Gallery Holder)
   and in some PNG metadata, so they are kept aside and written back untouched when saving. */
function addNote() {}
const tlOrigFillFields = window.fillFields;
window.fillFields = function (d) {
    tlNotes = [];
    if (d && Array.isArray(d.notes)) {
        d.notes.forEach((n, i) => {
            if (typeof n === 'string') { if (n.trim()) tlNotes.push({ name: `Note ${i + 1}`, value: n }); }
            else if (n && typeof n === 'object') tlNotes.push(n);
        });
    }
    return tlOrigFillFields(d);
};

/* Every block of the metadata panel starts expanded (a block the user collapses by hand stays collapsed) */
function applyStoredCollapseState(blockId) {
    const block = document.querySelector(`.promptBlock[data-block-id="${blockId}"]`);
    if (!block) return;
    const collapsed = Object.prototype.hasOwnProperty.call(blockCollapsePrefs, blockId) ? blockCollapsePrefs[blockId] : false;
    setCollapseState(block, collapsed);
}

/* ================================================================
   UI HELPERS
   ================================================================ */
function tlToast(msg, type, ms) {
    const el = $tl('tl-toast');
    if (!el) return;
    clearTimeout(tlToastTimer);
    if (!msg) { el.style.display = 'none'; return; }
    el.className = type || '';
    el.textContent = msg;
    el.style.display = 'block';
    tlToastTimer = setTimeout(() => { el.style.display = 'none'; }, ms || 3500);
}

function tlSetStatus(text) { const el = $tl('path-display'); if (el) el.textContent = text || ''; }

/* The mode that is really applied: "created" falls back to the oldest image when the server dates are missing */
function tlMode() {
    return (tlFolderDateMode === 'created' && !tlCreatedAvailable) ? 'oldest' : tlFolderDateMode;
}

function tlUpdateSortButton() {
    const b = $tl('btn-sort');
    if (!b) return;
    if (tlFolderDateMode === 'name') { b.innerHTML = tlSortDesc ? '⬇️ Z-A' : '⬆️ A-Z'; b.title = 'Folder order: by name'; }
    else { b.innerHTML = tlSortDesc ? '⬇️ Newest' : '⬆️ Oldest'; b.title = 'Folder order: by date'; }
}
function tlUpdatePageSizeButton() {
    const b = $tl('btn-page-size');
    if (b) b.textContent = itemsPerPage + ' / page';
}

/* "Folder creation date" only makes sense on the localhost server */
function tlUpdateDateModeOptions() {
    const sel = $tl('folder-date-mode');
    if (!sel) return;
    const opt = Array.from(sel.options).find(o => o.value === 'created');
    if (opt) {
        opt.disabled = !tlIsLocal();
        opt.textContent = tlIsLocal() ? 'Folder creation date (from disk)' : 'Folder creation date (needs the localhost server)';
    }
    $tl('disk-path-block').style.display = (tlIsLocal() && tlRoot) ? 'flex' : 'none';
    tlUpdateDiskStatus();
}

let tlDiskStatus = '';
function tlUpdateDiskStatus() {
    const el = $tl('disk-path-status');
    if (!el) return;
    el.textContent = tlDiskStatus;
    el.style.color = tlCreatedAvailable ? '#00ff99' : '#ffcc66';
    if (typeof tlUpdateLocalButtons === 'function') tlUpdateLocalButtons();
}

/* Shows/hides everything that only makes sense once a directory is loaded */
function tlUpdateChrome() {
    const has = !!tlRoot;
    $tl('btn-remove').style.display  = has ? 'inline-block' : 'none';
    $tl('btn-refresh').style.display = has ? 'inline-block' : 'none';
    $tl('filter-tag').style.display  = has ? 'inline-block' : 'none';
    $tl('btn-folders').style.display = has ? 'inline-block' : 'none';
    $tl('btn-folders').classList.toggle('active', tlSidebarOpen);
    $tl('folder-sidebar').classList.toggle('open', has && tlSidebarOpen);
    $tl('disk-path-block').style.display = (tlIsLocal() && has) ? 'flex' : 'none';
}

function tlFormatDate(ts) {
    if (!ts) return 'Unknown date';
    return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function tlFormatDateTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const tlPlural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

/* ================================================================
   DIRECTORIES
   ================================================================ */
/* Starts with no directory selected: only "Add Directory" and the saved list (pick one to open it) */
window.onload = async () => {
    try {
        if (tlSettingsPromise) await tlSettingsPromise;
        await updateSelect();
        $tl('dir-list').value = '';
        if (!tlRoot) renderGrid();
    } catch (e) { console.warn(e); }
};

async function updateSelect() {
    const list = $tl('dir-list');
    list.innerHTML = '<option value="">Select a directory...</option>';
    const handles = await tlGetHandles();
    handles.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h.name; opt.textContent = h.name;
        list.appendChild(opt);
    });
}

async function addDirectory() {
    try {
        const dh = await window.showDirectoryPicker({ mode: 'readwrite' });
        await tlKvSet('dir:' + dh.name, dh);
        await tlKvSet('last', dh.name);
        await updateSelect();
        $tl('dir-list').value = dh.name;
        await tlLoadRoot(dh);
    } catch (e) { if (e.name !== 'AbortError') alert('Permission error.'); }
}

async function loadSelectedDirectory() {
    const name = $tl('dir-list').value;
    if (!name) return;
    const h = (await tlGetHandles()).find(x => x.name === name)?.handle;
    if (!h) return;
    if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') { tlToast('Permission denied for this directory.', 'error'); return; }
    }
    await tlKvSet('last', name);
    await tlLoadRoot(h);
}

async function refreshCurrentFolder() {
    if (!tlRoot) return;
    await tlLoadRoot(tlRoot, true, true);              // full scan (also rewrites the saved scan)
}

async function removeDirectory() {
    if (!tlRoot) return;
    const name = tlRoot.name;
    await tlKvDel('dir:' + name, 'hidden:' + name, 'rootpath:' + name, 'cache:' + name);
    if (tlIsLocal()) { try { await tlCacheWrite(name, null); } catch (e) {} }     // the file in local/ is emptied (it is ignored when invalid)
    tlScanId++;                       // cancels a scan in progress
    tlResetData();
    tlRoot = null; tlRootNode = null; rootHandle = null; currentHandle = null;
    tlRootPath = ''; tlCreatedAvailable = false; tlDiskStatus = '';
    tlSetStatus('');
    $tl('grid-view').innerHTML = '';
    $tl('folder-list').innerHTML = '';
    $tl('folder-summary').textContent = '';
    $tl('filter-tag').value = '';
    tlUpdateChrome();
    tlUpdateDateModeOptions();
    backToGrid();
    updateGridCounters();
    updatePaginationControls();
    await updateSelect();
}

function tlResetData() {
    if (window.ThumbLoader) window.ThumbLoader.clear();
    const main = $tl('main-image');
    if (main) main.removeAttribute('src');
    tlFolders.forEach(f => f.images.forEach(it => { if (it.url) { try { URL.revokeObjectURL(it.url); } catch (e) {} it.url = null; } }));
    tlFolders = []; tlFolderByUid = new Map(); tlRootNode = null;
    tlFlat = []; tlVisibleCount = new Map(); tlPageItems = [];
    tlStripFolder = null; tlStripItems = []; tlStripDirty = false;
    tlCurrent = null; tlNotes = [];
    tlExpanded = new Set();
    const strip = $tl('thumbnail-strip');
    if (strip) strip.innerHTML = '';
    currentJsonFiles = new Set();
}

/* Oldest / newest image date of a folder (loop instead of Math.min(...arr): a huge folder would overflow the call stack) */
function tlUpdateFolderRange(folder) {
    let lo = Infinity, hi = -Infinity;
    for (const it of folder.images) {
        if (it.lastModified < lo) lo = it.lastModified;
        if (it.lastModified > hi) hi = it.lastModified;
    }
    folder.minTs = folder.images.length ? lo : 0;
    folder.maxTs = folder.images.length ? hi : 0;
}

/* Small concurrency pool: getFile() on thousands of handles is mostly latency. */
async function tlPool(list, limit, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
        while (i < list.length) {
            const mine = i++;
            try { await fn(list[mine]); } catch (e) { /* unreadable file: skipped */ }
        }
    });
    await Promise.all(workers);
}

/* Reads the whole tree. Every directory becomes a node (so the sidebar can show the hierarchy),
   even when it only contains subfolders. */
async function tlScanRoot(root, scanId, opts) {
    opts = opts || {};
    const nodes = [];
    let nFolders = 0, nImages = 0, lastPaint = 0;
    const paint = force => {
        const now = performance.now();
        if (force || now - lastPaint > 120) {
            lastPaint = now;
            tlSetStatus(`Scanning... ${tlPlural(nFolders, 'folder')} · ${tlPlural(nImages, 'image')}`);
        }
    };

    async function walk(dir, rel, depth, parent) {
        if (scanId !== tlScanId) return null;
        const images = [], jsonSet = new Set(), subdirs = [];
        for await (const entry of dir.values()) {
            if (entry.kind === 'file') {
                if (TL_IMG_RE.test(entry.name)) images.push({ name: entry.name, handle: entry });
                else if (/\.json$/i.test(entry.name)) jsonSet.add(entry.name);
            } else if (entry.kind === 'directory' && !entry.name.startsWith('.')) {
                subdirs.push(entry);
            }
        }
        nFolders++;
        paint();

        if (images.length) {
            await tlPool(images, 24, async it => {
                const f = await it.handle.getFile();
                it.file = f; it.lastModified = f.lastModified; it.size = f.size;
                nImages++; paint();
            });
        }
        const ok = images.filter(it => it.file);
        const node = {
            uid: ++tlUidCounter, relPath: rel, name: rel ? dir.name : root.name,
            label: rel || '/ (root files)', handle: dir, parent, children: [],
            images: ok, jsonSet, minTs: 0, maxTs: 0, createdTs: null, _sub: 0, _key: undefined
        };
        ok.forEach(it => { it.folder = node; it.url = null; });
        tlUpdateFolderRange(node);
        nodes.push(node);

        if (depth >= TL_MAX_DEPTH) return node;
        subdirs.sort((a, b) => tlCollator.compare(a.name, b.name));
        for (const sd of subdirs) {
            const child = await walk(sd, rel ? rel + '/' + sd.name : sd.name, depth + 1, node);
            if (child) node.children.push(child);
        }
        return node;
    }

    const rootNode = await walk(root, opts.rel || '', opts.depth || 0, opts.parent || null);
    paint(true);
    return { nodes, rootNode, nFolders, nImages };
}

/* Asks server_max.py for the real creation date of every folder (localhost only) */
async function tlFetchCreatedDates() {
    tlCreatedAvailable = false;
    tlFolders.forEach(f => { f.createdTs = null; });
    if (!tlIsLocal() || !tlRoot) { tlDiskStatus = ''; tlUpdateDateModeOptions(); return; }
    if (!tlRootPath) { tlDiskStatus = 'Type this folder\'s real path to read creation dates.'; tlUpdateDateModeOptions(); return; }

    try {
        const last = tlRootPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
        if (last.toLowerCase() !== tlRoot.name.toLowerCase()) throw new Error(`The path must end with "${tlRoot.name}" (the directory you opened).`);
        const r = await fetch('/api/folder_dates', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ root: tlRootPath, folders: tlFolders.map(f => f.relPath) })
        });
        if (r.status === 404 || r.status === 501) throw new Error('This server has no folder-date API. Start it with server_max.py.');
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.message || ('Server error ' + r.status));
        let n = 0, matches = 0;
        tlFolders.forEach(f => {
            const d = data.dates && data.dates[f.relPath];
            if (d) { f.createdTs = d.created; n++; if (f.relPath) matches++; }
        });
        if (tlFolders.length > 1 && matches === 0) throw new Error('This path does not match the opened directory (no subfolder was found).');
        tlCreatedAvailable = true;
        tlDiskStatus = `Creation dates read from disk (${tlPlural(n, 'folder')}).`;
    } catch (e) {
        tlCreatedAvailable = false;
        tlDiskStatus = e.message || 'Could not read the folder dates.';
    }
    tlUpdateDateModeOptions();
}

async function applyFolderPath() {
    if (!tlRoot) return;
    tlRootPath = $tl('disk-path-input').value.trim().replace(/^"|"$/g, '');
    await tlKvSet('rootpath:' + tlRoot.name, tlRootPath);
    await tlFetchCreatedDates();
    if (tlCreatedAvailable && tlFolderDateMode !== 'created') {
        tlFolderDateMode = 'created';
        $tl('folder-date-mode').value = 'created';
        tlUpdateSortButton();
        saveSettingsToDB();
    }
    tlRecompute(); currentPage = 1;
    $tl('grid-view').scrollTop = 0;
    renderGrid(); renderFolderSidebar();
}


/* ================================================================
   SCAN CACHE  (fast boot after the first time)
   ----------------------------------------------------------------
   The slow part of opening a directory is the scan: every folder is listed and getFile() is called on every
   image (only to read its date). After the first scan the result is saved:
     - on the localhost server -> local/timeline_cache/<directory name>.json  (always a file, never IndexedDB)
     - online / file://        -> the app's own IndexedDB ('cache:<directory name>')
   Next time the timeline is built from that cache right away; image files are opened only when their preview is
   needed. Then a background check lists the folders again (no getFile on known images), applies what changed
   (new / removed images and folders) and refreshes the cache. The ↻ button always does a full scan.
   Known limit: an image replaced in place keeping its name is only noticed by the full scan.
   ================================================================ */
const TL_CACHE_VERSION = 1;
const tlCacheFile = name => 'local/timeline_cache/' + String(name).replace(/[^\w.\- ]+/g, '_') + '.json';
let tlCacheChain = Promise.resolve();

async function tlCacheRead(name) {
    let c = null;
    if (tlIsLocal()) {
        const r = await fetch('/' + encodeURI(tlCacheFile(name)) + '?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok || !/json/i.test(r.headers.get('content-type') || '')) return null;
        c = await r.json();
    } else {
        c = await tlKvGet('cache:' + name);
    }
    return (c && c.v === TL_CACHE_VERSION && Array.isArray(c.folders) && c.folders.some(f => f.rel === '')) ? c : null;
}

async function tlCacheWrite(name, data) {
    if (tlIsLocal()) {
        const r = await fetch('/api/save_local_cache', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: tlCacheFile(name), data })
        });
        if (!r.ok) throw new Error('Server error ' + r.status);
    } else {
        await tlKvSet('cache:' + name, data);
    }
}

function tlSerializeCache() {
    return {
        v: TL_CACHE_VERSION, root: tlRoot.name, savedAt: Date.now(), created: !!tlCreatedAvailable,
        folders: tlFolders.map(f => ({
            rel: f.relPath, name: f.name, c: f.createdTs || 0,
            img: f.images.map(i => [i.name, i.lastModified, i.size != null ? i.size : (i.file ? i.file.size : 0)]),
            json: Array.from(f.jsonSet)
        }))
    };
}

/* Saves the current state (one write at a time) */
function tlCacheSave() {
    if (!tlRoot) return Promise.resolve();
    const name = tlRoot.name;
    tlCacheChain = tlCacheChain.then(async () => {
        if (!tlRoot || tlRoot.name !== name) return;
        try { await tlCacheWrite(name, tlSerializeCache()); }
        catch (e) { console.warn('Could not save the timeline cache:', e); }
    });
    return tlCacheChain;
}

/* Builds the folder tree from the cache. Only directory handles are resolved (one per folder, in parallel by level);
   images stay lazy: no File, no file handle until needed. A folder that no longer exists is skipped. */
async function tlNodesFromCache(root, cache, scanId) {
    const depthOf = rel => rel === '' ? 0 : rel.split('/').length;
    const byDepth = new Map();
    cache.folders.forEach(f => { const d = depthOf(f.rel); if (!byDepth.has(d)) byDepth.set(d, []); byDepth.get(d).push(f); });
    const byRel = new Map(), nodes = [];
    for (const d of Array.from(byDepth.keys()).sort((a, b) => a - b)) {
        await tlPool(byDepth.get(d), 16, async f => {
            if (scanId !== tlScanId) return;
            let parent = null, handle = root;
            if (d > 0) {
                const cut = f.rel.lastIndexOf('/');
                parent = byRel.get(cut < 0 ? '' : f.rel.slice(0, cut));
                if (!parent) return;                                  // its parent is gone
                handle = await parent.handle.getDirectoryHandle(f.name);   // throws when the folder no longer exists
            }
            const node = {
                uid: 0, relPath: f.rel, name: d ? f.name : root.name, label: f.rel || '/ (root files)', handle, parent, children: [],
                images: [], jsonSet: new Set(f.json || []), minTs: 0, maxTs: 0, createdTs: f.c || null, _sub: 0, _key: undefined
            };
            node.images = (f.img || []).map(a => ({ name: a[0], lastModified: a[1], size: a[2], handle: null, file: null, folder: node, url: null }));
            byRel.set(f.rel, node);
            if (parent) parent.children.push(node);
        });
        if (scanId !== tlScanId) return null;
    }
    // stable order: parents first, children sorted by name (same order the scan produces)
    const ordered = [];
    (function add(n) { n.uid = ++tlUidCounter; tlUpdateFolderRange(n); ordered.push(n); n.children.sort((a, b) => tlCollator.compare(a.name, b.name)); n.children.forEach(add); })(byRel.get('') || (() => { throw new Error('no root'); })());
    return { nodes: ordered, rootNode: byRel.get('') };
}

/* The file of an image that came from the cache is opened only when needed */
async function tlEnsureFile(item) {
    if (item.file) return item;
    if (!item.handle) item.handle = await item.folder.handle.getFileHandle(item.name);
    item.file = await item.handle.getFile();
    item.lastModified = item.file.lastModified; item.size = item.file.size;
    return item;
}

/* Key of an image for the thumbnail loader: the blob url when it exists, otherwise a made-up key + a lazy source */
const tlLazyKey = item => 'tl:' + item.folder.uid + ':' + item.name;
const tlKey = item => item.file ? tlUrl(item) : (item.url || tlLazyKey(item));
const tlThumbOpts = item => item.file ? {} : { getBlob: () => tlEnsureFile(item).then(i => i.file) };

function tlDisposeItem(it) {
    if (window.ThumbLoader) { window.ThumbLoader.forget(tlLazyKey(it)); if (it.url) window.ThumbLoader.forget(it.url); }
    if (it.url) { try { URL.revokeObjectURL(it.url); } catch (e) {} it.url = null; }
}

/* Re-renders keeping the user where they are (first visible image stays at the same place) */
function tlRenderKeepingPlace() {
    const grid = $tl('grid-view');
    let anchor = null, off = 0;
    if (!tlInDetail && grid.style.display !== 'none') {
        const c = tlFirstVisibleCard(grid);
        if (c) { const it = tlFlat[Number(c.dataset.i)]; if (it) { anchor = it; off = c.getBoundingClientRect().top - grid.getBoundingClientRect().top; } }
    }
    tlRecompute();
    if (anchor) { const idx = tlFlat.indexOf(anchor); if (idx >= 0) currentPage = Math.floor(idx / itemsPerPage) + 1; }
    renderGrid();
    renderFolderSidebar();
    tlUpdateHeaderText();
    if (anchor) {
        const idx = tlFlat.indexOf(anchor);
        const card = idx >= 0 ? grid.querySelector(`.grid-item-wrapper[data-i="${idx}"]`) : null;
        if (card) grid.scrollTop += card.getBoundingClientRect().top - grid.getBoundingClientRect().top - off;
    }
}

/* After a cached boot: lists the folders again (no getFile on known images), finds what changed and applies it.
   Phase 1 reads the disk and builds a plan; phase 2 applies the plan in one synchronous step. */
async function tlBackgroundCheck(scanId, cache) {
    tlSetStatus('Checking for changes...');
    const plan = [];                                         // { node, added:[item], removed:Set(name), jsons:Set, newDirs:[{nodes,rootNode}], goneDirs:[node], live:Map(name->handle) }
    let level = [tlRootNode];
    try {
        while (level.length) {
            const next = [];
            await tlPool(level, 8, async node => {
                if (scanId !== tlScanId) return;
                const imgs = new Map(), jsons = new Set(), dirs = new Map();
                for await (const e of node.handle.values()) {
                    if (e.kind === 'file') {
                        if (TL_IMG_RE.test(e.name)) imgs.set(e.name, e);
                        else if (/\.json$/i.test(e.name)) jsons.add(e.name);
                    } else if (e.kind === 'directory' && !e.name.startsWith('.')) dirs.set(e.name, e);
                }
                const have = new Map(node.images.map(i => [i.name, i]));
                const added = [];
                await tlPool(Array.from(imgs.values()).filter(e => !have.has(e.name)), 24, async e => {
                    const f = await e.getFile();
                    added.push({ name: e.name, handle: e, file: f, lastModified: f.lastModified, size: f.size, folder: node, url: null });
                });
                const removed = new Set(node.images.filter(i => !imgs.has(i.name)).map(i => i.name));
                const newDirs = [], goneDirs = node.children.filter(c => !dirs.has(c.name));
                for (const [name, entry] of dirs) {
                    const child = node.children.find(c => c.name === name);
                    if (child) { child.handle = entry; next.push(child); }
                    else if (depthOk(node.relPath)) {
                        const rel = node.relPath ? node.relPath + '/' + name : name;
                        const sub = await tlScanRoot(entry, scanId, { rel, depth: rel.split('/').length, parent: node });
                        if (sub && sub.rootNode) newDirs.push(sub);
                    }
                }
                const sameJson = jsons.size === node.jsonSet.size && Array.from(jsons).every(j => node.jsonSet.has(j));
                if (added.length || removed.size || newDirs.length || goneDirs.length || !sameJson) plan.push({ node, added, removed, jsons, sameJson, newDirs, goneDirs, live: imgs });
                else node.images.forEach(i => { i.handle = imgs.get(i.name) || i.handle; });
            });
            if (scanId !== tlScanId) return;
            level = next;
        }
    } catch (e) {
        console.warn('Background check failed (the cached timeline stays as it is):', e);
        if (scanId === tlScanId) tlUpdateHeaderText();
        return;
    }
    if (scanId !== tlScanId) return;

    let changed = false, dirty = false;
    plan.forEach(p => {
        const { node } = p;
        if (p.removed.size) {
            node.images.filter(i => p.removed.has(i.name)).forEach(tlDisposeItem);
            node.images = node.images.filter(i => !p.removed.has(i.name));
            changed = true;
        }
        node.images.forEach(i => { i.handle = p.live.get(i.name) || i.handle; });
        if (p.added.length) { node.images = node.images.concat(p.added); changed = true; }
        if (p.removed.size || p.added.length) tlUpdateFolderRange(node);
        if (!p.sameJson) { node.jsonSet.clear(); p.jsons.forEach(j => node.jsonSet.add(j)); dirty = true; }
        p.goneDirs.forEach(g => {
            const drop = new Set();
            (function mark(n) { drop.add(n); n.children.forEach(mark); })(g);
            drop.forEach(n => { n.images.forEach(tlDisposeItem); tlFolderByUid.delete(n.uid); });
            tlFolders = tlFolders.filter(n => !drop.has(n));
            node.children = node.children.filter(c => c !== g);
            changed = true;
        });
        p.newDirs.forEach(sub => {
            node.children.push(sub.rootNode);
            node.children.sort((a, b) => tlCollator.compare(a.name, b.name));
            sub.nodes.forEach(n => { tlFolders.push(n); tlFolderByUid.set(n.uid, n); });
            changed = true;
        });
    });

    // folder creation dates (localhost): only when something changed or the cache never had them
    if (changed || !cache.created) {
        await tlFetchCreatedDates();
        if (scanId !== tlScanId) return;
        if (tlFolderDateMode === 'created') changed = true;
    }
    if (changed) tlRenderKeepingPlace(); else tlUpdateHeaderText();
    if (changed || dirty) tlCacheSave();
}
const depthOk = rel => (rel === '' ? 0 : rel.split('/').length) < TL_MAX_DEPTH;

async function tlLoadRoot(handle, keepState, forceScan) {
    const scanId = ++tlScanId;
    const prevPage = currentPage;
    const prevScroll = $tl('grid-view').scrollTop;

    tlInDetail = false;
    tlResetData();
    tlRoot = handle; rootHandle = handle; currentHandle = handle;
    $tl('filter-tag').value = keepState ? $tl('filter-tag').value : '';
    tlUpdateChrome();
    backToGrid();

    const saved = await tlKvGet('hidden:' + handle.name);
    tlHidden = new Set(Array.isArray(saved) ? saved : []);
    tlRootPath = (await tlKvGet('rootpath:' + handle.name)) || '';
    $tl('disk-path-input').value = tlRootPath;

    $tl('folder-list').innerHTML = '';
    $tl('folder-summary').textContent = '';

    // Saved scan (localhost: file in local/ · online: IndexedDB). The ↻ button skips it and does a full scan.
    let cache = null, res = null;
    if (!forceScan) {
        try { cache = await tlCacheRead(handle.name); } catch (e) { cache = null; }
        if (scanId !== tlScanId) return;
        if (cache) {
            tlSetStatus('Opening from the saved scan...');
            try { res = await tlNodesFromCache(handle, cache, scanId); }
            catch (e) { console.warn('The saved scan could not be used, scanning again:', e); res = null; }
            if (scanId !== tlScanId) return;
        }
    }
    const fromCache = !!(res && res.rootNode);
    if (!fromCache) {
        $tl('grid-view').innerHTML = '<div id="empty-state">Scanning folders...<br><span style="font-size:12px;">Large libraries can take a moment.</span></div>';
        updateGridCounters(); updatePaginationControls();
        try { res = await tlScanRoot(handle, scanId); }
        catch (e) { console.error(e); tlToast('Error reading the directory. Check the permissions.', 'error'); tlSetStatus(''); return; }
        if (scanId !== tlScanId) return;                   // a newer load took over
    }

    tlFolders = res.nodes;
    tlRootNode = res.rootNode;
    tlFolders.forEach(f => tlFolderByUid.set(f.uid, f));
    if (fromCache) {
        // creation dates come with the cache; the background check refreshes them when something changed
        tlCreatedAvailable = !!(cache.created && tlIsLocal() && tlRootPath);
        tlDiskStatus = tlCreatedAvailable ? 'Creation dates read from disk (saved).' : '';
        tlUpdateDateModeOptions();
    } else {
        await tlFetchCreatedDates();
        if (scanId !== tlScanId) return;
    }
    tlRecompute();
    currentPage = keepState ? prevPage : 1;
    renderGrid();
    renderFolderSidebar();
    if (keepState && !tlDynamic) $tl('grid-view').scrollTop = prevScroll;
    tlUpdateHeaderText();
    if (fromCache) tlBackgroundCheck(scanId, cache);
    else tlCacheSave();
}

function tlTotalImages() { return tlFolders.reduce((n, f) => n + f.images.length, 0); }

function tlUpdateHeaderText() {
    if (!tlRoot) { tlSetStatus(''); return; }
    if (tlInDetail && tlCurrent) {
        tlSetStatus(tlRoot.name + (tlCurrent.folder.relPath ? ' / ' + tlCurrent.folder.relPath.replace(/\//g, ' / ') : ''));
        return;
    }
    const withImages = tlFolders.filter(f => f.images.length).length;
    tlSetStatus(`${tlRoot.name} · ${tlPlural(withImages, 'folder')} · ${tlPlural(tlTotalImages(), 'image')}`);
}

/* ================================================================
   TIMELINE MODEL  (ordering, hiding, filtering)
   ================================================================ */
/* Date shown in the section header / used to order the folder, according to the active mode */
function tlOwnDate(f) {
    const m = tlMode();
    if (m === 'created' && f.createdTs) return f.createdTs;
    if (m === 'newest') return f.maxTs;
    return f.minTs;
}
function tlDateTooltip(f) {
    const m = tlMode();
    if (m === 'created' && f.createdTs) return 'Folder created: ' + tlFormatDateTime(f.createdTs);
    if (m === 'newest') return 'Newest image: ' + tlFormatDateTime(f.maxTs);
    return 'Oldest image: ' + tlFormatDateTime(f.minTs);
}

/* Key used to order SIBLING folders in the sidebar tree. A folder that only holds subfolders
   takes the date of its subfolders (oldest/newest of them, depending on the mode). */
function tlNodeKey(n) {
    if (n._key !== undefined) return n._key;
    const m = tlMode();
    let k = null;
    if (m === 'created' && n.createdTs) k = n.createdTs;
    else if (n.images.length) k = tlOwnDate(n);
    else {
        const ks = n.children.filter(c => c._sub > 0).map(tlNodeKey).filter(v => v != null);
        if (ks.length) k = ks.reduce((a, b) => (m === 'newest' ? Math.max(a, b) : Math.min(a, b)));
    }
    n._key = k;
    return k;
}

function tlCompareSiblings(a, b) {
    const dir = tlSortDesc ? -1 : 1;
    if (tlMode() === 'name') return tlCollator.compare(a.name, b.name) * dir;
    return ((tlNodeKey(a) || 0) - (tlNodeKey(b) || 0)) * dir || tlCollator.compare(a.name, b.name);
}

/* 'self' when the folder itself is hidden, 'parent' when an ancestor is, otherwise null.
   The root directory is not an ancestor: hiding "root files" never hides the subfolders. */
function tlHiddenState(n) {
    if (tlHidden.has(n.relPath)) return 'self';
    for (let p = n.parent; p && p.relPath !== ''; p = p.parent) if (tlHidden.has(p.relPath)) return 'parent';
    return null;
}

function tlSortedImages(list) {
    const arr = list.slice();
    switch (tlImageOrder) {
        case 'name-desc': arr.sort((a, b) => tlCollator.compare(b.name, a.name)); break;
        case 'date-asc':  arr.sort((a, b) => a.lastModified - b.lastModified || tlCollator.compare(a.name, b.name)); break;
        case 'date-desc': arr.sort((a, b) => b.lastModified - a.lastModified || tlCollator.compare(a.name, b.name)); break;
        default:          arr.sort((a, b) => tlCollator.compare(a.name, b.name));
    }
    return arr;
}

/* Images of one folder after the name filter, in the chosen order */
function tlFolderItems(f) {
    const term = ($tl('filter-tag').value || '').toLowerCase().trim();
    const base = term ? f.images.filter(i => i.name.toLowerCase().includes(term)) : f.images;
    return tlSortedImages(base);
}

/* Images in a folder + all of its subfolders (the root directory counts only its own files) */
function tlRecount(n) {
    n._sub = n.images.length;
    n.children.forEach(c => { n._sub += tlRecount(c); });
    return n._sub;
}

function tlRecompute() {
    tlFolders.forEach(f => { f._key = undefined; });
    if (tlRootNode) tlRecount(tlRootNode);

    const dir = tlSortDesc ? -1 : 1;
    const withImages = tlFolders.filter(f => f.images.length);
    if (tlMode() === 'name') withImages.sort((a, b) => tlCollator.compare(a.relPath, b.relPath) * dir);
    else withImages.sort((a, b) => (tlOwnDate(a) - tlOwnDate(b)) * dir || tlCollator.compare(a.relPath, b.relPath));

    tlFlat = [];
    tlVisibleCount = new Map();
    withImages.forEach(f => {
        if (tlHiddenState(f)) return;
        const items = tlFolderItems(f);
        if (!items.length) return;
        tlVisibleCount.set(f, items.length);
        for (const it of items) tlFlat.push(it);
    });
}

function tlUrl(item) {
    if (!item.url && item.file) item.url = URL.createObjectURL(item.file);
    return item.url;
}

/* ================================================================
   GRID  (sections per folder + pagination)
   ================================================================ */
function tlMakeSection(folder, continued) {
    const root = document.createElement('div');
    root.className = 'tl-section';
    root.dataset.uid = folder.uid;

    const header = document.createElement('div');
    header.className = 'tl-header';
    const dot = document.createElement('span'); dot.className = 'tl-dot';
    header.appendChild(dot);
    if (tlMode() !== 'name') {
        const date = document.createElement('span'); date.className = 'tl-date';
        date.textContent = tlFormatDate(tlOwnDate(folder));
        date.title = tlDateTooltip(folder);
        header.appendChild(date);
    }
    const path = document.createElement('span'); path.className = 'tl-path';
    path.textContent = '📁 ' + folder.label; path.title = folder.label;
    const count = document.createElement('span'); count.className = 'tl-count';
    count.textContent = tlPlural(tlVisibleCount.get(folder) || 0, 'image');
    header.append(path, count);
    if (continued) {
        const c = document.createElement('span'); c.className = 'tl-cont'; c.textContent = '(continued)';
        header.appendChild(c);
    }
    const grid = document.createElement('div');
    grid.className = 'tl-grid';
    root.append(header, grid);
    return { root, grid };
}

/* Cards keep a stable height before their thumbnail loads (placeholder = last known ratio), so the
   dynamic page loader measures real page heights instead of "empty" cards. */
let tlRatio = 2 / 3;
function tlBlocksRoot() {
    // Preview blocks: one block = one page of the page-size button (itemsPerPage).
    const g = $tl('grid-view');
    if (g && window.ThumbLoader && window.ThumbLoader.blocks) window.ThumbLoader.blocks(g, { size: () => itemsPerPage });
    return g;
}
function tlAttachThumb(img, url, extra) {
    img.style.aspectRatio = String(tlRatio);
    if (window.ThumbLoader) window.ThumbLoader.attach(img, url, Object.assign({ root: tlBlocksRoot(), onSize: (w, h) => { if (w && h) { tlRatio = w / h; img.style.aspectRatio = w + ' / ' + h; } } }, extra || {}));
    else img.src = url;
}

function tlMakeCard(item, idx) {
    const wrapper = document.createElement('div');
    wrapper.className = 'grid-item-wrapper';
    wrapper.dataset.i = idx;

    const img = document.createElement('img');
    img.decoding = 'async';
    img.className = 'grid-item';
    img.dataset.filename = item.name;
    // Reduced thumbnail (not the full-size decode) — tools/shared/thumb_loader.js. Images that came from the saved scan
    // have no File yet: the loader opens it only when the preview is needed (tlThumbOpts).
    tlAttachThumb(img, tlKey(item), tlThumbOpts(item));
    img.onclick = () => tlOpenItem(item);

    const label = document.createElement('div');
    label.className = 'grid-item-label';
    const nameOnly = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
    label.textContent = nameOnly;
    label.title = nameOnly;

    wrapper.append(img, label);
    return wrapper;
}

function tlEmptyMessage() {
    const div = document.createElement('div');
    div.id = 'empty-state';
    if (!tlRoot) div.innerHTML = 'Add a directory to build its timeline.';
    else if (!tlTotalImages()) div.innerHTML = 'No images were found in this directory or its subfolders.';
    else if ($tl('filter-tag').value.trim()) div.innerHTML = 'No image matches the name filter.';
    else div.innerHTML = 'Every folder is hidden.<br>Use the folder list on the left to show them again.';
    return div;
}

/* Item range that is kept in the DOM for a page: just that page, or (dynamic mode) the page plus one before and one after */
function tlWindowFor(page) {
    const total = tlFlat.length, pages = Math.max(1, Math.ceil(total / itemsPerPage));
    const lo = tlDynamic ? Math.max(1, page - 1) : page;
    const hi = tlDynamic ? Math.min(pages, page + 1) : page;
    return [(lo - 1) * itemsPerPage, Math.min(total, hi * itemsPerPage)];
}

function tlSetContinued(sec, on) {
    const header = sec.querySelector('.tl-header');
    const cur = header.querySelector('.tl-cont');
    if (on && !cur) {
        const c = document.createElement('span'); c.className = 'tl-cont'; c.textContent = '(continued)';
        header.appendChild(c);
    } else if (!on && cur) cur.remove();
}

/* Builds the cards of tlFlat[from, to) into `container`; joinGrid = an existing section grid the first cards continue */
function tlBuildRange(container, from, to, joinGrid) {
    let curFolder = joinGrid ? tlFlat[from].folder : null, gridEl = joinGrid || null;
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i++) {
        const item = tlFlat[i];
        if (item.folder !== curFolder) {
            curFolder = item.folder;
            const sec = tlMakeSection(curFolder, i === from && from > 0 && tlFlat[from - 1].folder === curFolder);
            frag.appendChild(sec.root);
            gridEl = sec.grid;
        }
        gridEl.appendChild(tlMakeCard(item, i));
    }
    container.appendChild(frag);
}

/* Grid thumbnails belong to the block system (ThumbLoader.blocks): they are released by themselves when their
   cards leave the DOM. Calling ThumbLoader.forget(url) here would also drop the detail strip's thumbnails,
   which share the same url, and leave broken images in the strip. */
function tlForgetThumbs(from, to) {}

function renderGrid() {
    tlActiveOverride = null;
    const grid = $tl('grid-view');
    const total = tlFlat.length;
    const pages = Math.max(1, Math.ceil(total / itemsPerPage));
    if (currentPage > pages) currentPage = pages;
    if (currentPage < 1) currentPage = 1;
    const [start, end] = tlWindowFor(currentPage);

    tlPageItems = tlFlat.slice(start, end);
    tlWinStart = start; tlWinEnd = end;

    grid.innerHTML = '';
    if (!tlPageItems.length) {
        grid.appendChild(tlEmptyMessage());
    } else {
        tlBuildRange(grid, start, end, null);
        const pageStart = (currentPage - 1) * itemsPerPage;
        if (pageStart > start) {                      // dynamic mode: the previous page sits above, start at the current one
            const card = grid.querySelector(`.grid-item-wrapper[data-i="${pageStart}"]`);
            if (card) {
                const sec = card.parentElement.firstElementChild === card ? card.closest('.tl-section') : card;
                grid.scrollTop += sec.getBoundingClientRect().top - grid.getBoundingClientRect().top;
            }
        }
    }

    updateGridCounters();
    updatePaginationControls();
    tlUpdateActiveFolder();
}

/* ---- Dynamic page change: pages are added/removed while scrolling ---- */
let tlDynRAF = null, tlDynBusy = false;
function tlFirstVisibleCard(grid) {
    const cards = grid.querySelectorAll('.grid-item-wrapper');
    if (!cards.length) return null;
    const top = grid.getBoundingClientRect().top + 1;
    let lo = 0, hi = cards.length - 1;
    while (lo < hi) {                                  // first card whose bottom edge is below the top of the viewport
        const mid = (lo + hi) >> 1;
        if (cards[mid].getBoundingClientRect().bottom > top) hi = mid; else lo = mid + 1;
    }
    return cards[lo];
}

function tlTrimRange(from, to, fromEnd) {
    const grid = $tl('grid-view');
    const cards = Array.from(grid.querySelectorAll('.grid-item-wrapper'));
    for (const c of cards) { const i = Number(c.dataset.i); if (i >= from && i < to) c.remove(); }
    grid.querySelectorAll('.tl-section').forEach(sec => { if (!sec.querySelector('.grid-item-wrapper')) sec.remove(); });
    tlForgetThumbs(from, to);
}

function tlDynamicStep() {
    tlDynRAF = null;
    const grid = $tl('grid-view');
    if (!tlDynamic || !tlRoot || tlInDetail || !tlFlat.length || !tlPageItems.length || grid.style.display === 'none') return;
    const ipp = itemsPerPage, total = tlFlat.length, vh = grid.clientHeight;
    if (!vh) return;
    const anchor = tlFirstVisibleCard(grid);
    if (!anchor) return;
    const aIdx = Number(anchor.dataset.i);

    let rowLast = anchor;                                    // a page can start mid-row: judge the page by the last card of the top row
    const t0 = anchor.getBoundingClientRect().top;
    for (let n = anchor.nextElementSibling; n && n.style.display !== 'none' && Math.abs(n.getBoundingClientRect().top - t0) < 2; n = n.nextElementSibling) rowLast = n;
    let page = Math.floor(Number(rowLast.dataset.i) / ipp) + 1;
    if (tlWinEnd >= total && grid.scrollTop + vh >= grid.scrollHeight - 2) page = Math.ceil(total / ipp);   // bottom of the list = last page
    if (page !== currentPage) { currentPage = page; updatePaginationControls(); }

    const nearBottom = grid.scrollTop + vh > grid.scrollHeight - vh * 1.5 && tlWinEnd < total;
    const nearTop = grid.scrollTop < vh * 1.5 && tlWinStart > 0;
    if (!nearBottom && !nearTop) return;

    const before = anchor.getBoundingClientRect().top;
    const pageH = grid.scrollHeight / Math.max(1, tlWinEnd - tlWinStart) * ipp;      // rough height of one page
    const canTrim = grid.scrollHeight - pageH >= vh * 4;

    if (nearBottom) {
        const to = Math.min(total, tlWinEnd + ipp);
        const lastSec = grid.lastElementChild;
        const join = (lastSec && lastSec.classList.contains('tl-section') && tlFlat[tlWinEnd - 1].folder === tlFlat[tlWinEnd].folder)
            ? lastSec.querySelector('.tl-grid') : null;
        tlBuildRange(grid, tlWinEnd, to, join);
        tlPageItems = tlPageItems.concat(tlFlat.slice(tlWinEnd, to));
        tlWinEnd = to;
        if (canTrim && tlWinEnd - tlWinStart > 3 * ipp && aIdx >= tlWinStart + ipp) {
            tlTrimRange(tlWinStart, tlWinStart + ipp);
            tlPageItems = tlPageItems.slice(ipp);
            tlWinStart += ipp;
            const first = grid.querySelector('.tl-section');
            if (first) tlSetContinued(first, tlFlat[tlWinStart - 1].folder === tlFlat[tlWinStart].folder);
        }
    } else {
        const from = Math.max(0, tlWinStart - ipp);
        const tmp = document.createElement('div');
        tlBuildRange(tmp, from, tlWinStart, null);
        const oldFirst = grid.querySelector('.tl-section');
        const newLast = tmp.lastElementChild;
        if (oldFirst && newLast && tlFlat[tlWinStart - 1].folder === tlFlat[tlWinStart].folder) {
            const dest = newLast.querySelector('.tl-grid');
            while (oldFirst.querySelector('.tl-grid').firstChild) dest.appendChild(oldFirst.querySelector('.tl-grid').firstChild);
            oldFirst.remove();
        }
        const firstNew = tmp.firstElementChild;
        if (firstNew) tlSetContinued(firstNew, from > 0 && tlFlat[from - 1].folder === tlFlat[from].folder);
        while (tmp.lastElementChild) grid.insertBefore(tmp.lastElementChild, grid.firstChild);
        tlPageItems = tlFlat.slice(from, tlWinStart).concat(tlPageItems);
        tlWinStart = from;
        const boundary = Math.floor((tlWinEnd - 1) / ipp) * ipp;
        if (canTrim && tlWinEnd - tlWinStart > 3 * ipp && aIdx < boundary) {
            tlTrimRange(boundary, tlWinEnd);
            tlPageItems = tlPageItems.slice(0, boundary - tlWinStart);
            tlWinEnd = boundary;
        }
    }
    grid.scrollTop += anchor.getBoundingClientRect().top - before;     // keep what the user is looking at in place
    tlUpdateActiveFolder();
    tlScheduleDynamic();                                              // keep going until both edges have enough buffer
}
function tlScheduleDynamic() {
    if (tlDynRAF === null) tlDynRAF = requestAnimationFrame(tlDynamicStep);
}

function tlOnDynamicToggle() {
    tlDynamic = $tl('toggle-dynamic-pages').checked;
    saveSettingsToDB();
    if (tlRoot && !tlInDetail) {
        const g = $tl('grid-view'), a = tlFirstVisibleCard(g);
        if (a) currentPage = Math.floor(Number(a.dataset.i) / itemsPerPage) + 1;
        g.scrollTop = 0;
        renderGrid();
    }
}

/* The old image/JSON counters are gone: this only shows the page-size and zoom controls in grid mode */
function updateGridCounters() {
    const pageSizeToggle = $tl('page-size-toggle');
    const gridZoomToggle = $tl('grid-zoom-toggle');
    if (!pageSizeToggle || !gridZoomToggle) return;
    const inGrid = !!tlRoot && !tlInDetail;
    pageSizeToggle.style.display = inGrid ? 'flex' : 'none';
    gridZoomToggle.style.display = inGrid ? 'flex' : 'none';
}

function updatePaginationControls() {
    const c = $tl('pagination-controls');
    if (!c) return;
    const inGrid = !!tlRoot && !tlInDetail;
    const total = tlFlat.length;
    if (!inGrid || total <= itemsPerPage) { c.style.display = 'none'; return; }
    const pages = Math.ceil(total / itemsPerPage);
    c.style.display = 'flex';
    const input = $tl('page-input');
    input.value = currentPage; input.max = pages;
    $tl('page-total').textContent = pages;

    const atFirst = currentPage <= 1, atLast = currentPage >= pages;
    [['btn-page-first', atFirst], ['btn-page-prev', atFirst], ['btn-page-next', atLast], ['btn-page-last', atLast]].forEach(([id, off]) => {
        const b = $tl(id);
        b.disabled = off; b.style.opacity = off ? '0.4' : '1'; b.style.cursor = off ? 'default' : 'pointer';
    });
}

function goToPage(n) {
    const pages = Math.max(1, Math.ceil(tlFlat.length / itemsPerPage));
    n = Number(n);
    if (n === Infinity) n = pages;
    else if (!Number.isFinite(n)) n = currentPage;
    n = Math.min(pages, Math.max(1, Math.round(n)));
    currentPage = n;
    $tl('grid-view').scrollTop = 0;
    renderGrid();
}
function changePage(direction) { goToPage(currentPage + direction); }

function toggleItemsPerPage() {
    const firstIdx = (currentPage - 1) * itemsPerPage;
    const idx = TL_PAGE_SIZES.indexOf(itemsPerPage);
    itemsPerPage = TL_PAGE_SIZES[(idx + 1) % TL_PAGE_SIZES.length];
    currentPage = Math.floor(firstIdx / itemsPerPage) + 1;
    tlUpdatePageSizeButton();
    $tl('grid-view').scrollTop = 0;
    renderGrid();
    saveSettingsToDB();
}

function tlRefreshAll() {
    tlRecompute(); currentPage = 1;
    $tl('grid-view').scrollTop = 0;
    renderGrid(); renderFolderSidebar();
}

function toggleSort() {
    tlSortDesc = !tlSortDesc;
    tlUpdateSortButton();
    tlRefreshAll();
    saveSettingsToDB();
}

function onFolderDateModeChange() {
    tlFolderDateMode = TL_MODES.includes($tl('folder-date-mode').value) ? $tl('folder-date-mode').value : 'oldest';
    if (tlFolderDateMode === 'created' && !tlCreatedAvailable) {
        tlDiskStatus = tlRootPath ? (tlDiskStatus || 'Could not read the folder dates.') : 'Type this folder\'s real path below to read creation dates.';
        tlUpdateDiskStatus();
        $tl('disk-path-input').focus();
    }
    tlUpdateSortButton();
    tlRefreshAll();
    saveSettingsToDB();
}

function onImageOrderChange() {
    tlImageOrder = $tl('image-order-mode').value;
    tlStripDirty = true;
    tlRefreshAll();
    saveSettingsToDB();
}

function filterGallery() {
    clearTimeout(tlFilterTimer);
    tlFilterTimer = setTimeout(() => {
        if (!tlRoot) return;
        tlStripDirty = true;
        tlRefreshAll();
    }, 150);
}

/* ================================================================
   FOLDER SIDEBAR  (tree: subfolders sit under their parent)
   ================================================================ */
function toggleFolderSidebar() {
    tlSidebarOpen = !tlSidebarOpen;
    tlUpdateChrome();
    saveSettingsToDB();
}

const tlAncestorHidden = n => { for (let p = n.parent; p && p.relPath !== ''; p = p.parent) if (tlHidden.has(p.relPath)) return true; return false; };

/* Rows of a tree, in display order. Folders without any image in their subtree are left out.
   mode 'main'   : only folders that are visible on the timeline
   mode 'hidden' : the hidden folders (topmost ones) with their subfolders nested below */
function tlTreeRows(mode, q) {
    const rows = [];
    const matches = n => !q || n.label.toLowerCase().includes(q) || (n !== tlRootNode && n.children.some(c => c._sub > 0 && matches(c)));
    const kidsOf = n => n === tlRootNode ? [] : n.children.filter(c => c._sub > 0 && (mode === 'hidden' || !tlHiddenState(c)));
    function walk(list, depth) {
        list.slice().sort(tlCompareSiblings).forEach(n => {
            const isRootEntry = n === tlRootNode;
            if (isRootEntry ? !n.images.length : n._sub === 0) return;
            if (mode === 'main' && tlHiddenState(n)) return;
            if (!matches(n)) return;
            const kids = kidsOf(n);
            const open = !!q || tlExpanded.has(n.relPath);
            rows.push({ n, depth, hasKids: kids.length > 0, open });
            if (kids.length && open) walk(kids, depth + 1);
        });
    }
    if (mode === 'main') {
        if (tlRootNode) walk([tlRootNode, ...tlRootNode.children], 0);
    } else {
        walk(tlFolders.filter(n => tlHidden.has(n.relPath) && !tlAncestorHidden(n)), 0);
    }
    return rows;
}

function tlMakeFolderRow({ n, depth, hasKids, open }, showDate) {
    const state = tlHiddenState(n);
    const el = document.createElement('div');
    el.className = 'folder-item' + (depth ? ' child' : '') + (state ? ' hidden-folder' : '') + (state === 'parent' ? ' hidden-by-parent' : '');
    el.dataset.uid = n.uid;
    el.style.marginLeft = (depth * 16) + 'px';
    el.title = n.label;

    const caret = document.createElement('span');
    caret.className = 'folder-caret' + (hasKids ? '' : ' empty');
    caret.textContent = hasKids ? (open ? '▾' : '▸') : '';

    const info = document.createElement('div'); info.className = 'folder-info';
    const name = document.createElement('div'); name.className = 'folder-name'; name.textContent = n === tlRootNode ? n.label : n.name;
    const meta = document.createElement('div'); meta.className = 'folder-meta';
    const bits = [];
    if (n.images.length && showDate) bits.push(tlFormatDate(tlOwnDate(n)));
    if (n.images.length) bits.push(tlPlural(n.images.length, 'image'));
    if (n !== tlRootNode && n._sub > n.images.length) bits.push(n.images.length ? `${n._sub} in total` : `${tlPlural(n._sub, 'image')} inside`);
    if (!n.images.length && showDate && tlNodeKey(n)) bits.unshift(tlFormatDate(tlNodeKey(n)));
    meta.textContent = bits.join(' · ');
    info.append(name, meta);

    const btn = document.createElement('button');
    btn.className = 'folder-hide-btn';
    btn.textContent = state ? '🚫' : '👁️';
    btn.title = state === 'parent' ? 'Hidden because a parent folder is hidden'
              : state === 'self' ? 'Hidden — click to show on the timeline again'
              : 'Visible — click to hide this folder' + (hasKids ? ' and its subfolders' : '') + ' from the timeline';
    if (state === 'parent') btn.disabled = true;

    el.append(caret, info, btn);
    return el;
}

function renderFolderSidebar() {
    const list = $tl('folder-list');
    if (!list) return;
    const prevScroll = list.scrollTop;
    list.innerHTML = '';
    const q = ($tl('folder-search').value || '').trim().toLowerCase();
    const showDate = tlMode() !== 'name';
    const frag = document.createDocumentFragment();

    // Group of hidden folders, above the main list (collapsed until the user opens it)
    const hiddenRows = tlTreeRows('hidden', q);
    const hiddenTotal = tlFolders.filter(f => f.images.length && tlHiddenState(f)).length;
    if (hiddenRows.length) {
        const open = tlHiddenOpen || !!q;
        const head = document.createElement('div');
        head.className = 'hidden-group-header';
        head.title = open ? 'Collapse the hidden folders' : 'Show the hidden folders';
        head.innerHTML = `<span class="folder-caret">${open ? '▾' : '▸'}</span><span>🚫 Hidden folders (${hiddenTotal})</span>`;
        frag.appendChild(head);
        if (open) {
            const group = document.createElement('div');
            group.className = 'hidden-group';
            hiddenRows.forEach(r => group.appendChild(tlMakeFolderRow(r, showDate)));
            frag.appendChild(group);
        }
    }

    tlTreeRows('main', q).forEach(r => frag.appendChild(tlMakeFolderRow(r, showDate)));
    list.appendChild(frag);
    list.scrollTop = prevScroll;
    tlUpdateFolderSummary();
    tlUpdateActiveFolder(true);
}

function tlUpdateFolderSummary() {
    const el = $tl('folder-summary');
    if (!el) return;
    const withImages = tlFolders.filter(f => f.images.length);
    const hiddenCount = withImages.filter(f => tlHiddenState(f)).length;
    el.textContent = `${tlPlural(withImages.length - hiddenCount, 'folder')} on the timeline` + (hiddenCount ? ` · ${hiddenCount} hidden` : '');
}

function tlPersistHidden() {
    if (tlRoot) tlKvSet('hidden:' + tlRoot.name, Array.from(tlHidden));
}

function tlAfterVisibilityChange(keepScroll) {
    const grid = $tl('grid-view');
    const scroll = grid.scrollTop;
    tlStripDirty = true;
    tlRecompute();
    renderGrid();
    renderFolderSidebar();
    tlPersistHidden();
    if (keepScroll) grid.scrollTop = scroll;
}

function toggleFolderHidden(folder) {
    if (tlHidden.has(folder.relPath)) tlHidden.delete(folder.relPath); else tlHidden.add(folder.relPath);
    tlAfterVisibilityChange(true);
}

function setAllFoldersHidden(hide) {
    if (!tlRoot) return;
    tlHidden = new Set(hide ? tlFolders.map(f => f.relPath) : []);
    currentPage = 1;
    tlAfterVisibilityChange(false);
}

function tlInSubtree(f, node) {
    if (node === tlRootNode) return f === node;
    for (let p = f; p; p = p.parent) if (p === node) return true;
    return false;
}

/* Jumps to the first section of this folder (or of its subfolders when it holds no image itself) */
function tlJumpToFolder(folder) {
    // make it visible first: the folder itself and every ancestor
    let changed = false;
    for (let p = folder; p && (p === folder || p.relPath !== ''); p = p.parent) {
        if (tlHidden.delete(p.relPath)) changed = true;
    }
    if (changed) { tlRecompute(); tlPersistHidden(); }

    const idx = tlFlat.findIndex(it => tlInSubtree(it.folder, folder));
    if (idx === -1) { tlToast('No image of this folder matches the name filter.', 'warn'); renderFolderSidebar(); return; }
    const target = tlFlat[idx].folder;
    for (const f of [folder, target]) for (let p = f.parent; p; p = p.parent) tlExpanded.add(p.relPath);   // reveal the row in the tree
    if (tlInDetail) backToGrid();
    currentPage = Math.floor(idx / itemsPerPage) + 1;
    renderGrid();
    tlActiveOverride = folder.uid;                 // keep the clicked row highlighted (the last section of a page cannot always reach the top)
    renderFolderSidebar();
    const grid = $tl('grid-view');
    const sec = grid.querySelector(`.tl-section[data-uid="${target.uid}"]`);
    if (sec) grid.scrollTop += sec.getBoundingClientRect().top - grid.getBoundingClientRect().top;
    tlJumpScroll = grid.scrollTop;
    tlUpdateActiveFolder(true);
}

/* Highlights in the sidebar the folder whose section is at the top of the timeline */
let tlActiveRAF = null;
let tlActiveOverride = null, tlJumpScroll = 0;
function tlUpdateActiveFolder(immediate) {
    const run = () => {
        tlActiveRAF = null;
        const grid = $tl('grid-view');
        if (!grid || tlInDetail) return;
        if (tlActiveOverride !== null && Math.abs(grid.scrollTop - tlJumpScroll) > 4) tlActiveOverride = null;   // the user scrolled away
        const top = grid.getBoundingClientRect().top;
        let cur = null;
        for (const s of grid.querySelectorAll('.tl-section')) {
            if (s.getBoundingClientRect().top <= top + 60) cur = s; else break;
        }
        if (!cur) cur = grid.querySelector('.tl-section');
        const uid = tlActiveOverride !== null ? String(tlActiveOverride) : (cur ? cur.dataset.uid : null);
        let activeEl = null;
        $tl('folder-list').querySelectorAll('.folder-item').forEach(el => {
            const on = uid !== null && el.dataset.uid === uid;
            el.classList.toggle('active', on);
            if (on) activeEl = el;
        });
        if (!activeEl && uid !== null) {
            for (let f = tlFolderByUid.get(Number(uid)); f && !activeEl; f = f.parent) {
                const el = $tl('folder-list').querySelector(`.folder-item[data-uid="${f.uid}"]`);
                if (el) { activeEl = el; el.classList.add('active'); }
            }
        }
        if (activeEl) {
            // manual scroll inside the list only (scrollIntoView could also move outer containers)
            const list = $tl('folder-list');
            const lt = list.getBoundingClientRect(), et = activeEl.getBoundingClientRect();
            if (et.top < lt.top) list.scrollTop -= lt.top - et.top;
            else if (et.bottom > lt.bottom) list.scrollTop += et.bottom - lt.bottom;
        }
    };
    if (immediate) { run(); return; }
    if (!tlActiveRAF) tlActiveRAF = requestAnimationFrame(run);
}

$tl('folder-list').addEventListener('click', e => {
    if (e.target.closest('.hidden-group-header')) { tlHiddenOpen = !tlHiddenOpen; renderFolderSidebar(); return; }
    const item = e.target.closest('.folder-item');
    if (!item) return;
    const folder = tlFolderByUid.get(Number(item.dataset.uid));
    if (!folder) return;
    if (e.target.closest('.folder-hide-btn')) {
        if (!e.target.closest('.folder-hide-btn').disabled) toggleFolderHidden(folder);
    } else if (e.target.closest('.folder-caret:not(.empty)')) {
        if (tlExpanded.has(folder.relPath)) tlExpanded.delete(folder.relPath); else tlExpanded.add(folder.relPath);
        renderFolderSidebar();
    } else tlJumpToFolder(folder);
});
$tl('grid-view').addEventListener('scroll', () => { tlUpdateActiveFolder(); tlScheduleDynamic(); }, { passive: true });

/* ================================================================
   DETAIL VIEW
   ================================================================ */
function tlBuildStrip(item) {
    const strip = $tl('thumbnail-strip');
    strip.innerHTML = '';
    tlStripItems = tlFolderItems(item.folder);
    // Strip previews also load by blocks (same size as the page-size button); horizontal or vertical layout is auto-detected.
    if (window.ThumbLoader && window.ThumbLoader.blocks) window.ThumbLoader.blocks(strip, { size: () => itemsPerPage });
    tlStripItems.forEach((it, k) => {
        const img = document.createElement('img');
        img.decoding = 'async';
        img.className = 'thumb';
        img._item = it;
        if (window.ThumbLoader) window.ThumbLoader.attach(img, tlKey(it), Object.assign({ root: strip, index: k }, tlThumbOpts(it)));
        else tlEnsureFile(it).then(() => { img.src = tlUrl(it); }).catch(() => {});
        img.onclick = () => tlOpenItem(it);
        strip.appendChild(img);
    });
    tlStripFolder = item.folder; tlStripDirty = false;
}

async function tlOpenItem(item) {
    const session = ++detailSessionId;
    if (!item.file) {                                       // came from the saved scan: open the file now
        try { await tlEnsureFile(item); }
        catch (e) { if (session === detailSessionId) showAlert('❌ This image could not be opened (moved or deleted?). Use ↻ to rescan.', 'error'); return; }
        if (session !== detailSessionId) return;
    }
    tlUpdateLocalButtons();
    if (isEditing) toggleManualEdit();
    if (!tlInDetail) tlSavedScroll = $tl('grid-view').scrollTop;
    tlInDetail = true;
    tlCurrent = item;

    // The shared code works on "the current folder": point it at this image's own folder.
    currentHandle = item.folder.handle;
    currentJsonFiles = item.folder.jsonSet;

    $tl('grid-view').style.display = 'none';
    $tl('detail-view').style.display = 'flex';
    $tl('right-col').style.display = 'flex';
    $tl('resizer-right').style.display = 'flex';
    $tl('btn-rename-top').style.display = 'inline-block';
    $tl('rename-dropdown').classList.remove('open');
    $tl('main-image').src = tlUrl(item);
    $tl('file-name').value = item.name;
    if (typeof resetImageZoom === 'function') resetImageZoom();
    showAlert(null);
    updateGridCounters();
    updatePaginationControls();
    tlUpdateHeaderText();

    const baseName = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
    const btnSave = $tl('btn-save');
    if (item.folder.jsonSet.has(baseName + '.json')) {
        btnSave.textContent = 'Update JSON';
        btnSave.style.background = '#0d2a18'; btnSave.style.borderColor = '#00aa66'; btnSave.style.color = '#00ff99';
    } else {
        btnSave.textContent = 'Save JSON';
        btnSave.style.background = ''; btnSave.style.borderColor = ''; btnSave.style.color = '';
    }

    const strip = $tl('thumbnail-strip');
    if (tlStripFolder !== item.folder || tlStripDirty || strip.children.length !== tlStripItems.length) tlBuildStrip(item);
    Array.from(strip.children).forEach(el => {
        const on = el._item === item;
        el.classList.toggle('active', on);
        if (on) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });

    fillFields(null);

    try {
        const jh = await item.folder.handle.getFileHandle(baseName + '.json');
        const jd = JSON.parse(await (await jh.getFile()).text());
        if (session !== detailSessionId) return;
        fillFields({ pos: jd.positive ?? '', neg: jd.negative ?? '', tag: jd.tag ?? '', notes: jd.notes ?? [], cfg: jd.cfg ?? '', steps: jd.steps ?? '', seed: jd.seed ?? '', sampler: jd.sampler ?? '', ckpt: jd.checkpoint ?? '', loras: jd.loras ?? '', size: jd.size ?? '', source: 'json' });
        showAlert('✔ Metadata loaded from sidecar JSON.', 'success');
        return;
    } catch (e) { /* no sidecar (or unreadable): fall back to the image */ }

    try {
        const meta = await extractPNGMetadata(item.file);
        if (session !== detailSessionId) return;
        if (meta) {
            fillFields({ pos: meta.pos ?? '', neg: meta.neg ?? '', tag: '', notes: meta.notes ?? [], cfg: meta.cfg ?? '', steps: meta.steps ?? '', seed: meta.seed ?? '', sampler: meta.sampler ?? meta.scheduler ?? '', ckpt: meta.ckpt ?? meta.checkpoint ?? '', loras: meta.loras ?? '', size: meta.size ?? '', source: meta.source });
            showAlert('✔ Metadata extracted from PNG.', 'info');
            return;
        }
    } catch (e) { console.warn('PNG parser error:', e); }

    if (session !== detailSessionId) return;
    showAlert('⚠️ Metadata not found. Fill manually or generate a JSON sidecar.', 'error');
}

function backToGrid() {
    if (isEditing) toggleManualEdit();
    const wasDetail = tlInDetail;
    tlInDetail = false;
    tlCurrent = null;
    detailSessionId++;
    currentHandle = rootHandle;
    $tl('detail-view').style.display = 'none';
    $tl('right-col').style.display = 'none';
    $tl('resizer-right').style.display = 'none';
    $tl('btn-rename-top').style.display = 'none';
    $tl('rename-dropdown').classList.remove('open');
    $tl('grid-view').style.display = 'block';
    if (wasDetail) $tl('grid-view').scrollTop = tlSavedScroll;     // a hidden element loses its scroll position
    updateGridCounters();
    updatePaginationControls();
    tlUpdateHeaderText();
    if (wasDetail) tlUpdateActiveFolder();
}

/* Esc closes the image, ← / → walk through the images of the same folder */
document.addEventListener('keydown', e => {
    if (!tlInDetail || !tlCurrent) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if (e.key === 'Escape') { backToGrid(); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = tlStripItems.indexOf(tlCurrent);
    if (i === -1) return;
    const next = tlStripItems[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) { e.preventDefault(); tlOpenItem(next); }
});

/* ================================================================
   SAVE JSON / RE-SCAN / DELETE / RENAME  (act on the image's own folder)
   ================================================================ */
/* Same file format as Gallery Holder. Whatever this panel does not edit (tag, notes, any extra key
   written by other tools) is kept exactly as it is in the existing JSON. */
async function saveSidecarFile() {
    const item = tlCurrent;
    if (!item) { alert('No image selected.'); return; }
    const dir = item.folder.handle;
    const fname = item.name;
    const baseName = fname.substring(0, fname.lastIndexOf('.')) || fname;
    const sidecarName = baseName + '.json';

    let existing = {};
    try {
        const o = JSON.parse(await (await (await dir.getFileHandle(sidecarName)).getFile()).text());
        if (o && typeof o === 'object' && !Array.isArray(o)) existing = o;
    } catch (e) { /* new file or unreadable: start clean */ }

    const loras = Array.from(document.querySelectorAll('.lora-input')).map(inp => inp.value.trim()).filter(v => v !== '').join(', ');
    const dataObj = Object.assign({}, existing, {
        file_name:  fname,
        positive:   $tl('val-pos').value,
        negative:   $tl('val-neg').value,
        tag:        existing.tag ?? '',
        notes:      tlNotes.length ? tlNotes : (Array.isArray(existing.notes) ? existing.notes : []),
        cfg:        $tl('val-cfg').value,
        steps:      $tl('val-steps').value,
        seed:       $tl('val-seed').value,
        sampler:    $tl('val-sampler').value,
        checkpoint: $tl('val-ckpt').value,
        loras,
        size:       $tl('val-size').value
    });

    try {
        const fh = await dir.getFileHandle(sidecarName, { create: true });
        const w = await fh.createWritable(); await w.write(JSON.stringify(dataObj, null, 2)); await w.close();
        item.folder.jsonSet.add(sidecarName);

        const btnSave = $tl('btn-save');
        btnSave.textContent = 'Update JSON';
        btnSave.style.background = '#0d2a18'; btnSave.style.borderColor = '#00aa66'; btnSave.style.color = '#00ff99';
        showAlert(`✅ JSON File saved: ${sidecarName}`, 'success');
    } catch (e) { console.error(e); showAlert('❌ Error saving. Check directory permissions.', 'error'); }
}

async function resetPNGParameters() {
    const item = tlCurrent;
    if (!item?.file) { showAlert('❌ Original image not found in cache.', 'error'); return; }
    const currentLoras = Array.from(document.querySelectorAll('.lora-input')).map(inp => inp.value.trim()).filter(v => v !== '').join(', ');

    showAlert('🔍 Scanning image...', 'info');
    try {
        const meta = await extractPNGMetadata(item.file);
        if (meta) {
            fillFields({
                pos: meta.pos ?? '', neg: meta.neg ?? '',
                notes: tlNotes.length ? tlNotes : (meta.notes ?? []),
                cfg: meta.cfg ?? '', steps: meta.steps ?? '', seed: meta.seed ?? '',
                sampler: meta.sampler ?? meta.scheduler ?? '', ckpt: meta.ckpt ?? meta.checkpoint ?? '',
                loras: currentLoras !== '' ? currentLoras : (meta.loras ?? ''),
                size: meta.size ?? '', source: meta.source
            });
            showAlert('✔ Parameters reloaded from image. Remember to save.', 'success');
        } else showAlert('⚠️ No generation metadata found in the image.', 'warn');
    } catch (e) { console.error(e); showAlert('❌ Error trying to read original image.', 'error'); }
}

function tlReleaseItemUrl(item) {
    if (item.url) {
        if (window.ThumbLoader) window.ThumbLoader.forget(item.url);
        try { URL.revokeObjectURL(item.url); } catch (e) {}
        item.url = null;
    }
}

/* Removes an image from the timeline after it was deleted (permanently or to the Recycle Bin) */
function tlForgetDeletedItem(item, deleteMsg) {
    const baseName = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
    item.folder.jsonSet.delete(baseName + '.json');
    tlReleaseItemUrl(item);
    const folder = item.folder;
    const keepIdx = tlFlat.indexOf(item);
    folder.images = folder.images.filter(i => i !== item);
    tlUpdateFolderRange(folder);
    tlStripDirty = true;
    tlRecompute();
    showAlert(deleteMsg, 'success');
    backToGrid();
    renderGrid();
    if (keepIdx >= 0 && tlFlat.length) {                 // the next image now sits where the deleted one was: center it
        const g = $tl('grid-view');
        const card = g.querySelector(`.grid-item-wrapper[data-i="${Math.min(keepIdx, tlFlat.length - 1)}"]`);
        if (card) {
            const gr = g.getBoundingClientRect(), r = card.getBoundingClientRect();
            g.scrollTop += (r.top - gr.top) - (gr.height - r.height) / 2;
        }
    }
    renderFolderSidebar();
    tlUpdateHeaderText();
    tlToast('File deleted.', 'success', 2000);
}

async function deleteCurrentImage() {
    const item = tlCurrent;
    if (!item) return;
    if (!confirm(`Are you sure you want to permanently delete the file:\n${item.folder.label}/${item.name}\n(and its JSON if it exists)?`)) return;

    try {
        const dir = item.folder.handle;
        await dir.removeEntry(item.name);
        const baseName = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
        try { await dir.removeEntry(baseName + '.json'); } catch (e) {}
        tlForgetDeletedItem(item, '🗑️ File successfully deleted.');
    } catch (e) {
        console.error(e);
        showAlert('❌ Error deleting file. Check permissions.', 'error');
    }
}

/* ---- Localhost-only extras (server_max.py): Recycle Bin + "open folder" ---- */
function tlLocalActionReady() {
    if (!tlIsLocal()) { tlToast('This works only on the localhost server (server_max.py).', 'warn'); return false; }
    if (!tlRootPath) { tlToast('Type this folder\'s real path in ⚙️ first (the same field used for creation dates).', 'warn', 5000); return false; }
    return true;
}
async function tlLocalPost(url, item) {
    const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: tlRootPath, folder: item.folder.relPath, name: item ? item.name : '' })
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 404) throw new Error('This server does not have this API. Start it with the updated server_max.py.');
    if (!r.ok || data.status === 'error') throw new Error(data.message || ('Server error ' + r.status));
    return data;
}

async function tlTrashCurrent() {
    const item = tlCurrent;
    if (!item || !tlLocalActionReady()) return;
    if (!confirm(`Move this file to the Recycle Bin?\n${item.folder.label}/${item.name}\n(its JSON goes too, if it exists)`)) return;
    try {
        await tlLocalPost('/api/trash_file', item);
        tlForgetDeletedItem(item, '♻️ Moved to the Recycle Bin.');
    } catch (e) {
        console.error(e);
        showAlert('❌ ' + e.message, 'error');
    }
}

async function tlOpenCurrentFolder() {
    const item = tlCurrent;
    if (!item || !tlLocalActionReady()) return;
    try { await tlLocalPost('/api/open_folder', item); }
    catch (e) { console.error(e); showAlert('❌ ' + e.message, 'error'); }
}

/* The two localhost buttons are dimmed elsewhere */
function tlUpdateLocalButtons() {
    const ok = tlIsLocal();
    document.querySelectorAll('.btn-local').forEach(b => {
        b.disabled = !ok;
        b.title = b.title.replace(/ \(.*\)$/, '') + (ok ? (tlRootPath ? '' : ' (set the real path in ⚙️ first)') : ' (needs the localhost server)');
    });
}

function toggleRenameBalloon() {
    if (!tlInDetail || !tlCurrent) { tlToast('Open an image first to rename it.', 'warn'); return; }
    const dd = $tl('rename-dropdown');
    dd.classList.toggle('open');
    if (dd.classList.contains('open')) {
        const input = $tl('rename-input');
        const name = tlCurrent.name;
        const ext = (name.match(/\.[^.]+$/) || [''])[0];
        input.value = ext ? name.slice(0, -ext.length) : name;
        input.focus(); input.select();
    }
}

/* Moves the sidecar JSON next to the renamed image (never overwrites an existing one) */
async function tlMoveSidecar(dirHandle, jsonSet, oldBase, newBase, newName) {
    let oldJson;
    try { oldJson = await dirHandle.getFileHandle(oldBase + '.json'); } catch (e) { return true; }
    try { await dirHandle.getFileHandle(newBase + '.json'); return false; } catch (e) {}
    const text = await (await oldJson.getFile()).text();
    let out = text;
    try { const obj = JSON.parse(text); obj.file_name = newName; out = JSON.stringify(obj, null, 2); } catch (e) {}
    const nh = await dirHandle.getFileHandle(newBase + '.json', { create: true });
    const w = await nh.createWritable(); await w.write(out); await w.close();
    await dirHandle.removeEntry(oldBase + '.json');
    jsonSet.delete(oldBase + '.json'); jsonSet.add(newBase + '.json');
    return true;
}

async function renameCurrentImage() {
    const item = tlCurrent;
    if (!item) { showAlert('❌ Open a photo first to rename it.', 'warn'); return; }
    const dir = item.folder.handle;
    const exists = async n => { try { await dir.getFileHandle(n); return true; } catch (e) { return false; } };

    const oldName = item.name;
    const oldExt = (oldName.match(/\.[^.]+$/) || [''])[0];
    const oldNoExt = oldExt ? oldName.slice(0, -oldExt.length) : oldName;
    const raw = $tl('rename-input').value;
    if (!raw || raw.trim() === oldNoExt) { $tl('rename-dropdown').classList.remove('open'); return; }

    let newName = raw.trim();
    if (!newName.toLowerCase().endsWith(oldExt.toLowerCase())) newName += oldExt;
    $tl('rename-dropdown').classList.remove('open');
    showAlert('⏳ Renaming file...', 'info');

    try {
        if (/[\\/:*?"<>|]/.test(newName)) { showAlert('❌ The name has characters that are not allowed in file names.', 'error'); return; }
        const oldBase = oldName.substring(0, oldName.lastIndexOf('.')) || oldName;
        const newBase = newName.substring(0, newName.lastIndexOf('.')) || newName;

        if (await exists(newName)) { showAlert('❌ A file with that name already exists!', 'error'); return; }
        if (oldBase.toLowerCase() !== newBase.toLowerCase() && await exists(newBase + '.json') && await exists(oldBase + '.json')) {
            showAlert(`❌ "${newBase}.json" already exists — rename cancelled to avoid overwriting it.`, 'error');
            return;
        }

        const oldFile = await (await dir.getFileHandle(oldName)).getFile();
        const newHandle = await dir.getFileHandle(newName, { create: true });
        const w = await newHandle.createWritable();
        await w.write(await oldFile.arrayBuffer());
        await w.close();

        try { await tlMoveSidecar(dir, item.folder.jsonSet, oldBase, newBase, newName); } catch (e) { console.warn('Sidecar move failed:', e); }
        await dir.removeEntry(oldName);

        tlReleaseItemUrl(item);
        const newFile = await newHandle.getFile();
        item.name = newName; item.handle = newHandle; item.file = newFile; item.lastModified = newFile.lastModified;
        tlUpdateFolderRange(item.folder);

        $tl('file-name').value = newName;
        tlStripDirty = true;
        tlRecompute();
        await tlOpenItem(item);          // refreshes the main image, strip and sidecar state
        renderGrid();
        renderFolderSidebar();
        showAlert(`✅ Successfully renamed to ${newName}`, 'success');
    } catch (error) {
        console.error('Rename Error:', error);
        showAlert('❌ Error renaming file. Check directory permissions.', 'error');
    }
}

/* Initial look before any settings/directory is loaded */
tlUpdateSortButton();
tlUpdatePageSizeButton();
