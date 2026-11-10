/* =========================================================================
   DATABASE LOGIC (HÍBRIDO LOCAL / ONLINE)
   Gerencia os diretórios (IndexedDB), configurações (JSON) e presets (JSON).
========================================================================= */

const dbName = 'TagManagerDirsDB';
const storeName = 'directories';
const settingsDbName = 'SettingsDB';
const settingsStoreName = 'settings';
const presetDbName = 'PresetTagsDB';
const presetStoreName = 'presets';

// Single source of truth (tagmanager_globals.js). Fallback keeps this file usable on its own.
const isLocalhost = (typeof window.MAT_IS_LOCAL === 'boolean')
    ? window.MAT_IS_LOCAL
    : ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);

// keepalive requests are limited to 64 KB by the browser — bigger bodies fail silently.
const KEEPALIVE_MAX_BYTES = 60 * 1024;

/* Sends a local-cache write while the page is closing. Small payloads use
   keepalive (survives the unload); big ones fall back to a normal fetch,
   which still completes most of the time on localhost. The main save path
   is the visibilitychange:hidden flush, which runs before pagehide. */
window._postLocalCacheOnUnload = function(body) {
    const small = (typeof body === 'string' ? body.length : 0) < KEEPALIVE_MAX_BYTES;
    try {
        fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: small });
    } catch (e) {}
};

// 1. DIRETÓRIOS DB (Mantido no IndexedDB)
window.initDB = function() {
    return new Promise((res, rej) => {
        try {
            const req = indexedDB.open(dbName, 1);
            req.onupgradeneeded = e => e.target.result.createObjectStore(storeName);
            req.onsuccess = e => res(e.target.result);
            req.onerror = e => rej(e.target.error);
        } catch (err) { rej(err); }
    });
}

window.saveHandle = async function(n, h) {
    try {
        const db = await window.initDB();
        return new Promise(r => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(h, n);
            tx.oncomplete = r;
        });
    } catch (e) {}
}

window.getHandles = async function() {
    try {
        const db = await window.initDB();
        return new Promise(r => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const keysReq = store.getAllKeys();
            const valsReq = store.getAll();
            tx.oncomplete = () => {
                const result = [];
                for (let i = 0; i < keysReq.result.length; i++) {
                    const name = keysReq.result[i];
                    if (!String(name).startsWith('path_')) result.push({ name, handle: valsReq.result[i] });
                }
                r(result);
            };
        });
    } catch (e) { return []; }
}

/* Folder handle kept under a hidden key ('path_...' keys never show in the "Saved directories" list) —
   used to remember the last dataset that was open (tagmanager_nav.js). */
window.getRawHandle = async function(key) {
    try {
        const db = await window.initDB();
        return await new Promise(r => {
            const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
            req.onsuccess = () => r(req.result || null);
            req.onerror = () => r(null);
        });
    } catch (e) { return null; }
};

window.deleteHandle = async function(n) {
    try {
        const db = await window.initDB();
        return new Promise(r => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(n);
            tx.objectStore(storeName).delete('path_' + n);
            tx.oncomplete = r;
        });
    } catch (e) {}
}

/* Saved folders used to be keyed only by folder name, so two different
   folders called "images" overwrote each other. These helpers find the key
   of an already-saved folder (same entry on disk) and build a unique key
   ("images (2)") for a new one with a repeated name. */
async function _sameEntry(a, b) {
    if (!a || !b) return false;
    try { return await a.isSameEntry(b); } catch (e) { return false; }
}

window.findSavedHandleKey = async function(handle) {
    if (!handle) return null;
    const handles = await window.getHandles();
    for (const h of handles) {
        if (h.handle && h.handle.kind === handle.kind && await _sameEntry(h.handle, handle)) return h.name;
    }
    return null;
};

window.uniqueHandleKey = async function(handle) {
    const handles = await window.getHandles();
    const used = new Set(handles.map(h => String(h.name)));
    const base = handle.name;
    if (!used.has(base)) return base;
    let i = 2;
    while (used.has(`${base} (${i})`)) i++;
    return `${base} (${i})`;
};

/* =========================================================================
   FILA COMPARTILHADA PARA ESCRITAS NO ENDPOINT LOCAL
========================================================================= */
window._localCacheWriteQueue = window._localCacheWriteQueue || Promise.resolve();
window._queueLocalCacheWrite = function (fn) {
    const run = () => Promise.resolve().then(fn).catch(() => {});
    window._localCacheWriteQueue = window._localCacheWriteQueue.then(run, run);
    return window._localCacheWriteQueue;
};

/* =========================================================================
   PERSISTÊNCIA COM DEBOUNCE (otimização)
========================================================================= */
const PERSIST_DEBOUNCE_MS = 600;
let _settingsPersistTimer = null;
let _presetsPersistTimer = null;

function scheduleSettingsPersist() {
    clearTimeout(_settingsPersistTimer);
    _settingsPersistTimer = setTimeout(() => {
        _settingsPersistTimer = null;
        window._persistSettingsCache();
    }, PERSIST_DEBOUNCE_MS);
}

function schedulePresetsPersist() {
    clearTimeout(_presetsPersistTimer);
    _presetsPersistTimer = setTimeout(() => {
        _presetsPersistTimer = null;
        window._persistPresetsCache();
    }, PERSIST_DEBOUNCE_MS);
}

window._flushPendingLocalWrites = function(isUnload = false) {
    if (_settingsPersistTimer) {
        clearTimeout(_settingsPersistTimer); _settingsPersistTimer = null;
        window._persistSettingsCache(isUnload);
    }
    if (_presetsPersistTimer) {
        clearTimeout(_presetsPersistTimer); _presetsPersistTimer = null;
        window._persistPresetsCache(isUnload);
    }
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') window._flushPendingLocalWrites(false);
});
window.addEventListener('pagehide', () => window._flushPendingLocalWrites(true));
window.addEventListener('beforeunload', () => window._flushPendingLocalWrites(true));

// 2. SETTINGS DB
window._settingsCache = null;
let _settingsLoadPromise = null;
window._dirtySettingsKeys = window._dirtySettingsKeys || new Set();
window._settingsLoadedSuccessfully = false;

function loadSettingsToCache() {
    if (window._settingsCache !== null && window._settingsLoadedSuccessfully) return Promise.resolve();
    if (_settingsLoadPromise) return _settingsLoadPromise;

    _settingsLoadPromise = (async () => {
        window._settingsCache = {};
        if (isLocalhost) {
            try {
                const res = await fetch('/local/user_config.json?t=' + Date.now(), { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    if (data && typeof data === 'object') window._settingsCache = data;
                    window._settingsLoadedSuccessfully = true;
                } else if (res.status === 404) {
                    window._settingsLoadedSuccessfully = true; // Arquivo vazio/novo, seguro iniciar
                } else {
                    console.error("Server error while reading user_config.json:", res.status);
                }
            } catch (e) {
                console.error("Network error while reading user_config.json", e);
            }
        } else {
            try {
                const db = await new Promise((res, rej) => {
                    const req = indexedDB.open(settingsDbName, 1);
                    req.onupgradeneeded = e => { if (!e.target.result.objectStoreNames.contains(settingsStoreName)) e.target.result.createObjectStore(settingsStoreName, { keyPath: 'id' }); };
                    req.onsuccess = e => res(e.target.result);
                    req.onerror = e => rej(e.target.error);
                });
                const oldSettings = await new Promise(r => {
                    const tx = db.transaction(settingsStoreName, 'readonly');
                    const req = tx.objectStore(settingsStoreName).getAll();
                    tx.oncomplete = () => r(req.result);
                });
                if (oldSettings && oldSettings.length > 0) oldSettings.forEach(s => { window._settingsCache[s.id] = s.value; });
                window._settingsLoadedSuccessfully = true;
            } catch(e) {}
        }
    })();
    return _settingsLoadPromise;
}

window._persistSettingsCache = async function(isUnload = false) {
    if (isLocalhost) {
        const body = JSON.stringify({ file: 'local/user_config.json', data: window._settingsCache });
        if (isUnload) {
            window._postLocalCacheOnUnload(body);
            return;
        }
        await window._queueLocalCacheWrite(async () => {
            try {
                await fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            } catch(e) {}
        });
    } else {
        try {
            const keysToWrite = window._dirtySettingsKeys.size > 0 ? Array.from(window._dirtySettingsKeys) : Object.keys(window._settingsCache);
            window._dirtySettingsKeys.clear();
            const req = indexedDB.open(settingsDbName, 1);
            const db = await new Promise(res => { req.onsuccess = e => res(e.target.result); });
            return new Promise(r => {
                const tx = db.transaction(settingsStoreName, 'readwrite');
                const store = tx.objectStore(settingsStoreName);
                keysToWrite.forEach(k => store.put({ id: k, value: window._settingsCache[k] }));
                tx.oncomplete = () => r();
            });
        } catch (e) {}
    }
}

window.saveSetting = async function(id, value) {
    await loadSettingsToCache();
    if (!window._settingsLoadedSuccessfully) {
        // Mesmo risco nos dois modos: se o load falhou no boot, salvar em cima
        // de um cache vazio sobrescreveria tudo que já existia.
        console.error("Blocked: settings did not load correctly. Save aborted so the incomplete cache does not overwrite your data.");
        return;
    }
    window._settingsCache[id] = value;
    window._dirtySettingsKeys.add(id);
    scheduleSettingsPersist();
};

window.getSetting = async function(id, defaultValue) {
    await loadSettingsToCache();
    return window._settingsCache[id] !== undefined ? window._settingsCache[id] : defaultValue;
};

// 3. PRESETS DB
window._presetsCache = null;
let _presetsLoadPromise = null;
window._dirtyPresetKeys = window._dirtyPresetKeys || new Set();
window._deletedPresetKeys = window._deletedPresetKeys || new Set();
window._presetsLoadedSuccessfully = false;

function loadPresetsToCache() {
    if (window._presetsCache !== null && window._presetsLoadedSuccessfully) return Promise.resolve();
    if (_presetsLoadPromise) return _presetsLoadPromise;

    _presetsLoadPromise = (async () => {
        window._presetsCache = {};
        if (isLocalhost) {
            try {
                const res = await fetch('/local/user_presets.json?t=' + Date.now(), { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    if (data && typeof data === 'object') window._presetsCache = data;
                    window._presetsLoadedSuccessfully = true;
                } else if (res.status === 404) {
                    window._presetsLoadedSuccessfully = true;
                }
            } catch (e) {}
        } else {
            try {
                const db = await new Promise((res, rej) => {
                    const req = indexedDB.open(presetDbName, 1);
                    req.onupgradeneeded = e => { if (!e.target.result.objectStoreNames.contains(presetStoreName)) e.target.result.createObjectStore(presetStoreName, { keyPath: 'tag' }); };
                    req.onsuccess = e => res(e.target.result);
                    req.onerror = e => rej(e.target.error);
                });
                const oldPresets = await new Promise(r => {
                    const tx = db.transaction(presetStoreName, 'readonly');
                    const req = tx.objectStore(presetStoreName).getAll();
                    tx.oncomplete = () => r(req.result);
                });
                if (oldPresets && oldPresets.length > 0) oldPresets.forEach(p => { window._presetsCache[p.tag] = p.category; });
                window._presetsLoadedSuccessfully = true;
            } catch(e) {}
        }
    })();
    return _presetsLoadPromise;
}

window._persistPresetsCache = async function(isUnload = false) {
    if (isLocalhost) {
        const body = JSON.stringify({ file: 'local/user_presets.json', data: window._presetsCache });
        if (isUnload) {
            window._postLocalCacheOnUnload(body);
            return;
        }
        await window._queueLocalCacheWrite(async () => {
            try {
                await fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            } catch(e) {}
        });
    } else {
        try {
            const tagsToPut = window._dirtyPresetKeys.size > 0 || window._deletedPresetKeys.size > 0 ? Array.from(window._dirtyPresetKeys) : Object.keys(window._presetsCache);
            const tagsToDelete = Array.from(window._deletedPresetKeys);
            window._dirtyPresetKeys.clear();
            window._deletedPresetKeys.clear();
            const req = indexedDB.open(presetDbName, 1);
            const db = await new Promise(res => { req.onsuccess = e => res(e.target.result); });
            return new Promise(r => {
                const tx = db.transaction(presetStoreName, 'readwrite');
                const store = tx.objectStore(presetStoreName);
                tagsToPut.forEach(tag => store.put({ tag: tag, category: window._presetsCache[tag] }));
                tagsToDelete.forEach(tag => store.delete(tag));
                tx.oncomplete = () => r();
            });
        } catch (e) {}
    }
}

window.getPresetTags = async function() {
    await loadPresetsToCache();
    return Object.keys(window._presetsCache).map(tag => ({ tag: tag, category: window._presetsCache[tag] }));
};

window.savePresetTag = async function(tag, category = 'Uncategorized', skipRender = false) {
    if (!tag) return;
    await loadPresetsToCache();
    if (!window._presetsLoadedSuccessfully) return; // mesma trava de saveSetting, agora também no modo online
    const existingCat = window._presetsCache[tag];
    window._presetsCache[tag] = category !== 'Uncategorized' ? category : (existingCat ? existingCat : 'Uncategorized');
    window._dirtyPresetKeys.add(tag);
    window._deletedPresetKeys.delete(tag);
    schedulePresetsPersist();
    if(!skipRender && typeof window.renderPresetTags === 'function') window.renderPresetTags();
};

window.deletePresetTag = async function(tag, skipRender = false) {
    await loadPresetsToCache();
    if (!window._presetsLoadedSuccessfully) return;
    if (window._presetsCache[tag] !== undefined) {
        delete window._presetsCache[tag];
        window._dirtyPresetKeys.delete(tag);
        window._deletedPresetKeys.add(tag);
        schedulePresetsPersist();
    }
    if(!skipRender && typeof window.renderPresetTags === 'function') window.renderPresetTags();
};

// 4. SYSTEM BACKUP
/* EXPORT: everything — presets, every setting and (on localhost) the tag cache files
   of local/ — in one JSON named with the date.
   IMPORT: opens a chooser: what to bring from the backup (groups, each one can be
   opened to pick single items), merge or replace the presets. Then the data is
   written, every other save is blocked and the page reloads — so no module can
   write its old in-memory copy over what was just imported. */
const BACKUP_CACHE_FILES = {                 // local/ file  <->  setting key used online
    'danbooru_cache.json': 'danbooru_tag_cache',
    'e621_cache.json': 'e621_tag_cache',
    'unknown_tags.json': 'unknown_tags_cache'
};
const BACKUP_GROUPS = [
    { id: 'presets',   label: '🏷️ Tag presets (tags + preset panel layout)', test: k => /^preset-/.test(k) },
    { id: 'rules',     label: '⚖️ Rules (conflicts, merges, counters)',       test: k => /^(custom-conflict-rules|deleted-default-rules|rm_|enable-counter-)/.test(k) },
    { id: 'evaluator', label: '🧐 Evaluator (settings, scores, reviews)',     test: k => /^(evaluator-|enable-evaluator$)/.test(k) },
    { id: 'assistant', label: '💬 Assistant (settings, conversation)',        test: k => /^(assistant-|enable-assistant$)/.test(k) },
    { id: 'caches',    label: '🌐 Danbooru / e621 tag cache',                 test: k => Object.values(BACKUP_CACHE_FILES).includes(k) },
    { id: 'other',     label: '⚙️ Interface & other settings',                test: () => true }
];
function backupGroupOf(key) { return BACKUP_GROUPS.find(g => g.test(key)).id; }

window.exportBackup = async function() {
    try {
        await loadSettingsToCache();
        await loadPresetsToCache();
        if (typeof window._flushPendingLocalWrites === 'function') window._flushPendingLocalWrites(false);
        const localFiles = {};
        if (isLocalhost) {
            for (const f of Object.keys(BACKUP_CACHE_FILES)) {
                try {
                    const res = await fetch('/local/' + f + '?t=' + Date.now(), { cache: 'no-store' });
                    if (res.ok) localFiles[f] = await res.json();
                } catch (e) { /* file not created yet */ }
            }
        }
        const backupData = {
            app: 'Tag Manager',
            version: 2,
            date: new Date().toISOString(),
            mode: isLocalhost ? 'localhost' : 'browser',
            presets: Object.keys(window._presetsCache).map(tag => ({ tag: tag, category: window._presetsCache[tag] })),
            settings: Object.keys(window._settingsCache).map(id => ({ id: id, value: window._settingsCache[id] })),
            localFiles
        };
        // Blob (not a data: URL): works for big backups (scores, tag caches...).
        const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const d = new Date(), pad = n => String(n).padStart(2, '0');
        const a = document.createElement('a');
        a.href = url;
        a.download = `tagmanager_backup_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        const mb = (blob.size / 1048576).toFixed(blob.size > 1048576 ? 1 : 2);
        if (window.showAlert) window.showAlert(`Backup exported (${backupData.presets.length} presets, ${backupData.settings.length} settings${Object.keys(localFiles).length ? ', tag caches' : ''} · ${mb} MB).`, "success");
    } catch(e) {
        console.error('[Backup] export failed', e);
        if (window.showAlert) window.showAlert("Error exporting backup: " + (e.message || e), "error");
    }
};

window.importBackup = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.readAsText(file, 'UTF-8');
        reader.onload = ev => {
            let content;
            try { content = JSON.parse(ev.target.result); }
            catch (err) { if (window.showAlert) window.showAlert("This file is not valid JSON — is it a Tag Manager backup?", "error"); return; }
            if (!content || typeof content !== 'object' || (!Array.isArray(content.presets) && !Array.isArray(content.settings))) {
                if (window.showAlert) window.showAlert("This file is not a Tag Manager backup (no presets / settings inside).", "error");
                return;
            }
            if (content.version && content.version > 2 && window.showAlert) window.showAlert("This backup was made by a newer version — unknown items are skipped.", "warn");
            openImportChooser(content, file.name);
        };
    };
    input.click();
};

function openImportChooser(content, fileName) {
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const settings = Array.isArray(content.settings) ? content.settings.filter(s => s && typeof s.id === 'string') : [];
    const presets = Array.isArray(content.presets) ? content.presets.filter(p => p && p.tag) : [];
    const files = content.localFiles && typeof content.localFiles === 'object' ? content.localFiles : {};
    // Items per group: settings + (presets list) + (cache files as pseudo-items).
    const items = {};
    BACKUP_GROUPS.forEach(g => { items[g.id] = []; });
    if (presets.length) items.presets.push({ kind: 'presets', id: '__presets__', label: `${presets.length} preset tag(s)` });
    settings.forEach(s => items[backupGroupOf(s.id)].push({ kind: 'setting', id: s.id, label: s.id, value: s.value }));
    Object.keys(files).forEach(f => { if (BACKUP_CACHE_FILES[f]) items.caches.push({ kind: 'file', id: f, label: 'local/' + f, value: files[f] }); });
    const size = v => { try { const n = JSON.stringify(v).length; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; } catch (e) { return ''; } };

    let overlay = document.getElementById('modal-backup-import');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'modal-backup-import';
    overlay.className = 'modal-overlay';
    const groupsHtml = BACKUP_GROUPS.filter(g => items[g.id].length).map(g => `
        <div class="bk-group" data-g="${g.id}">
            <div class="bk-ghead">
                <label><input type="checkbox" class="bk-gcb" data-g="${g.id}" ${g.id === 'caches' ? '' : 'checked'}> <b>${esc(g.label)}</b></label>
                <span class="bk-count">${items[g.id].length} item(s)</span>
                <button class="bk-more" data-g="${g.id}" title="Choose single items">▸ items</button>
            </div>
            <div class="bk-items" data-g="${g.id}">
                ${items[g.id].map((it, i) => `<label class="bk-item"><input type="checkbox" class="bk-icb" data-g="${g.id}" data-i="${i}" ${g.id === 'caches' ? '' : 'checked'}> <span>${esc(it.label)}</span><span class="bk-size">${it.kind === 'presets' ? '' : size(it.value)}</span></label>`).join('')}
            </div>
        </div>`).join('');
    overlay.innerHTML = `
        <div class="tool-modal" style="width:560px; max-width:94vw; max-height:88vh; overflow-y:auto;" onclick="event.stopPropagation()">
            <style>
                #modal-backup-import .bk-head { font-size:11px; color:#888; line-height:1.5; }
                #modal-backup-import .bk-group { border:1px solid #2a2a2a; border-radius:8px; padding:6px 10px; margin-top:6px; background:#121212; }
                #modal-backup-import .bk-ghead { display:flex; align-items:center; gap:8px; font-size:12px; }
                #modal-backup-import .bk-ghead label { flex:1; display:flex; gap:6px; align-items:center; cursor:pointer; }
                #modal-backup-import .bk-count { color:#777; font-size:11px; }
                #modal-backup-import .bk-more { background:transparent; border:1px solid #444; color:#aaa; padding:1px 7px; font-size:10px; border-radius:4px; cursor:pointer; }
                #modal-backup-import .bk-items { display:none; flex-direction:column; gap:2px; margin:6px 0 2px 20px; max-height:180px; overflow-y:auto; }
                #modal-backup-import .bk-items.open { display:flex; }
                #modal-backup-import .bk-item { display:flex; gap:6px; align-items:center; font-size:11px; color:#bbb; cursor:pointer; }
                #modal-backup-import .bk-item span:first-of-type { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                #modal-backup-import .bk-size { color:#666; font-size:10px; }
                #modal-backup-import input[type=checkbox] { width:auto; margin:0; accent-color:#00ff99; }
                #modal-backup-import .bk-mode { display:flex; gap:14px; font-size:12px; color:#ccc; margin-top:8px; }
                #modal-backup-import .bk-mode label { display:flex; gap:5px; align-items:center; cursor:pointer; }
                #modal-backup-import .bk-warn { font-size:11px; color:#ffcc66; background:#2a240a; border:1px solid #6b5a1f; border-radius:6px; padding:6px 8px; margin-top:8px; line-height:1.45; }
            </style>
            <h3 style="display:flex; justify-content:space-between; align-items:center; margin-top:0;">📂 Import backup
                <button onclick="document.getElementById('modal-backup-import').remove()" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; padding:0;">&times;</button></h3>
            <div class="bk-head">File: <b>${esc(fileName)}</b><br>Made: ${content.date ? esc(new Date(content.date).toLocaleString()) : 'unknown date'}${content.mode ? ' · from ' + esc(content.mode) + ' mode' : ''} · version ${esc(content.version || 1)}<br>
                Choose what to bring back. Unchecked items keep their current value. The tag cache is off by default (it rebuilds itself).</div>
            ${groupsHtml || '<div class="bk-head" style="margin-top:10px;">Nothing to import in this file.</div>'}
            ${presets.length ? `<div class="bk-mode"><span style="color:#9ecfff; font-weight:bold;">Presets:</span>
                <label><input type="radio" name="bk-pmode" value="merge" checked> Merge with the current ones</label>
                <label><input type="radio" name="bk-pmode" value="replace"> Replace the current ones</label></div>` : ''}
            <div class="bk-warn">After importing, the page reloads so every tool starts with the imported data.${isLocalhost ? ' The current files are kept in local/backups/ by the server (daily copies).' : ' Tip: export a backup of the current state first if you may want it back.'}</div>
            <div class="modal-buttons" style="margin-top:10px;">
                <button class="btn-cancel" onclick="document.getElementById('modal-backup-import').remove()">Cancel</button>
                <button id="bk-do-import" style="background:#0d2a18; color:#00ff99; border:1px solid #00aa66;">📂 Import selected</button>
            </div>
        </div>`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
    overlay.classList.add('active');

    const q = sel => Array.from(overlay.querySelectorAll(sel));
    q('.bk-more').forEach(b => b.onclick = () => {
        const box = overlay.querySelector(`.bk-items[data-g="${b.dataset.g}"]`);
        box.classList.toggle('open');
        b.textContent = box.classList.contains('open') ? '▾ items' : '▸ items';
    });
    q('.bk-gcb').forEach(cb => cb.onchange = () => q(`.bk-icb[data-g="${cb.dataset.g}"]`).forEach(i => { i.checked = cb.checked; }));
    q('.bk-icb').forEach(cb => cb.onchange = () => {
        const all = q(`.bk-icb[data-g="${cb.dataset.g}"]`), on = all.filter(i => i.checked).length;
        const g = overlay.querySelector(`.bk-gcb[data-g="${cb.dataset.g}"]`);
        g.checked = on > 0; g.indeterminate = on > 0 && on < all.length;
    });
    overlay.querySelector('#bk-do-import').onclick = async () => {
        const chosen = q('.bk-icb').filter(i => i.checked).map(i => items[i.dataset.g][+i.dataset.i]);
        if (!chosen.length) { if (window.showAlert) window.showAlert('Nothing selected.', 'info'); return; }
        const pmode = (overlay.querySelector('input[name="bk-pmode"]:checked') || {}).value || 'merge';
        overlay.querySelector('#bk-do-import').disabled = true;
        overlay.querySelector('#bk-do-import').textContent = '⏳ Importing…';
        try {
            await applyImport(chosen, presets, pmode);
        } catch (err) {
            console.error('[Backup] import failed', err);
            if (window.showAlert) window.showAlert('Import failed: ' + (err.message || err), 'error');
            overlay.querySelector('#bk-do-import').disabled = false;
            overlay.querySelector('#bk-do-import').textContent = '📂 Import selected';
        }
    };
}

async function applyImport(chosen, presets, pmode) {
    await loadSettingsToCache();
    await loadPresetsToCache();
    if (!window._settingsLoadedSuccessfully || !window._presetsLoadedSuccessfully) throw new Error('the current data did not load correctly — import aborted to avoid losing anything');
    let nSet = 0, nPre = 0, nFiles = 0;
    const cacheKeyToFile = {};
    Object.entries(BACKUP_CACHE_FILES).forEach(([f, k]) => { cacheKeyToFile[k] = f; });
    const fileWrites = {};                       // local file -> data
    for (const it of chosen) {
        if (it.kind === 'presets') {
            if (pmode === 'replace') {
                Object.keys(window._presetsCache).forEach(t => { window._deletedPresetKeys.add(t); });
                window._presetsCache = {};
            }
            presets.forEach(p => { window._presetsCache[p.tag] = p.category || 'Uncategorized'; window._dirtyPresetKeys.add(p.tag); window._deletedPresetKeys.delete(p.tag); });
            nPre = presets.length;
        } else if (it.kind === 'file') {
            if (isLocalhost) fileWrites[it.id] = it.value;
            else { window._settingsCache[BACKUP_CACHE_FILES[it.id]] = it.value; window._dirtySettingsKeys.add(BACKUP_CACHE_FILES[it.id]); }
            nFiles++;
        } else {
            // A tag cache saved as a setting (backup from browser mode) goes to its file on localhost.
            if (isLocalhost && cacheKeyToFile[it.id]) { fileWrites[cacheKeyToFile[it.id]] = it.value; nFiles++; continue; }
            window._settingsCache[it.id] = it.value;
            window._dirtySettingsKeys.add(it.id);
            nSet++;
        }
    }
    // Write everything now (not debounced)...
    if (typeof window._flushPendingLocalWrites === 'function') window._flushPendingLocalWrites(false);
    await window._persistSettingsCache();
    await window._persistPresetsCache();
    for (const [f, data] of Object.entries(fileWrites)) {
        const res = await fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: 'local/' + f, data }) });
        if (!res.ok) throw new Error('could not write local/' + f);
    }
    // ...then block every other save until the reload (tools would write their old copy back).
    window._settingsLoadedSuccessfully = false;
    window._presetsLoadedSuccessfully = false;
    window._persistSettingsCache = async () => {};
    window._persistPresetsCache = async () => {};
    const origFetch = window.fetch;
    window.fetch = function (url, opt) {
        if (String(url).includes('/api/save_local_cache')) return Promise.resolve(new Response('{"status":"blocked"}', { status: 200 }));
        return origFetch.apply(this, arguments);
    };
    if (navigator.sendBeacon) { const ob = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (u, d) => String(u).includes('/api/save_local_cache') ? true : ob(u, d); }
    if (window.showAlert) window.showAlert(`Imported ${nPre ? nPre + ' presets, ' : ''}${nSet} setting(s)${nFiles ? ', ' + nFiles + ' tag cache file(s)' : ''}. Reloading…`, 'success', 4000);
    setTimeout(() => window.location.reload(), 1200);
}

// 5. MANUAL WEB-TO-LOCAL IMPORT
window.importOnlineDataToLocal = async function() {
    if (!isLocalhost) {
        if (window.showAlert) window.showAlert("This feature is available only on Local Mode.", "warn");
        return;
    }
    if (!confirm("This will merge your old web data into your local files and delete the browser database. Proceed?")) return;

    try {
        await loadSettingsToCache();
        await loadPresetsToCache();
        let mergedSettings = 0;
        let mergedPresets = 0;

        const dbSettings = await new Promise((res) => { const req = indexedDB.open(settingsDbName, 1); req.onsuccess = e => res(e.target.result); req.onerror = () => res(null); });
        if (dbSettings && dbSettings.objectStoreNames.contains(settingsStoreName)) {
            const tx = dbSettings.transaction(settingsStoreName, 'readwrite');
            const store = tx.objectStore(settingsStoreName);
            const allSettings = await new Promise(r => { const req = store.getAll(); req.onsuccess = () => r(req.result); });
            allSettings.forEach(s => {
                if (window._settingsCache[s.id] === undefined) {
                    window._settingsCache[s.id] = s.value;
                    mergedSettings++;
                }
            });
            store.clear();
        }

        const dbPresets = await new Promise((res) => { const req = indexedDB.open(presetDbName, 1); req.onsuccess = e => res(e.target.result); req.onerror = () => res(null); });
        if (dbPresets && dbPresets.objectStoreNames.contains(presetStoreName)) {
            const tx = dbPresets.transaction(presetStoreName, 'readwrite');
            const store = tx.objectStore(presetStoreName);
            const allPresets = await new Promise(r => { const req = store.getAll(); req.onsuccess = () => r(req.result); });
            allPresets.forEach(p => {
                if (window._presetsCache[p.tag] === undefined) {
                    window._presetsCache[p.tag] = p.category;
                    mergedPresets++;
                }
            });
            store.clear();
        }

        if (mergedSettings > 0) {
            window._dirtySettingsKeys = new Set(Object.keys(window._settingsCache));
            await window._persistSettingsCache();
        }
        if (mergedPresets > 0) {
            window._dirtyPresetKeys = new Set(Object.keys(window._presetsCache));
            await window._persistPresetsCache();
        }

        const btn = document.getElementById('btn-import-web-local');
        if (btn) {
            btn.style.background = '#1a1a1a';
            btn.style.color = '#555';
            btn.style.borderColor = '#333';
            btn.style.cursor = 'not-allowed';
            btn.title = 'No web data found to import. Your local files are up to date.';
            btn.disabled = true;
        }

        if (window.showAlert) window.showAlert(`Import complete! Merged ${mergedSettings} settings and ${mergedPresets} presets. Web database cleared.`, "success");
        setTimeout(() => { window.location.reload(); }, 1500);

    } catch (e) {
        if (window.showAlert) window.showAlert("Error merging data.", "error");
    }
};

window.addEventListener('DOMContentLoaded', () => {
    if (!isLocalhost) return;
    setTimeout(async () => {
        let hasDataToRescue = false;
        try {
            const dbSet = await new Promise(r => { const req = indexedDB.open(settingsDbName, 1); req.onsuccess = e => r(e.target.result); req.onerror = () => r(null); });
            if (dbSet && dbSet.objectStoreNames.contains(settingsStoreName)) {
                const count = await new Promise(r => { const tx = dbSet.transaction(settingsStoreName, 'readonly'); const req = tx.objectStore(settingsStoreName).count(); req.onsuccess = () => r(req.result); });
                if (count > 0) hasDataToRescue = true;
            }
            const dbPre = await new Promise(r => { const req = indexedDB.open(presetDbName, 1); req.onsuccess = e => r(e.target.result); req.onerror = () => r(null); });
            if (dbPre && dbPre.objectStoreNames.contains(presetStoreName)) {
                const count = await new Promise(r => { const tx = dbPre.transaction(presetStoreName, 'readonly'); const req = tx.objectStore(presetStoreName).count(); req.onsuccess = () => r(req.result); });
                if (count > 0) hasDataToRescue = true;
            }
        } catch (e) {}

        const exportBtn = document.querySelector('button[onclick="window.exportBackup()"]');
        if (exportBtn && exportBtn.parentNode && !document.getElementById('btn-import-web-local')) {
            const importBtn = document.createElement('button');
            importBtn.id = 'btn-import-web-local';
            importBtn.className = exportBtn.className;
            importBtn.style.cssText = exportBtn.style.cssText;

            if (hasDataToRescue) {
                importBtn.style.background = '#0a2a4c';
                importBtn.style.color = '#4db8ff';
                importBtn.style.borderColor = '#2a5a8c';
                importBtn.title = 'Merge orphaned web data into your local files and clear the browser database.';
                importBtn.disabled = false;
            } else {
                importBtn.style.background = '#1a1a1a';
                importBtn.style.color = '#555';
                importBtn.style.borderColor = '#333';
                importBtn.style.cursor = 'not-allowed';
                importBtn.title = 'No web data found to import. Your local files are up to date.';
                importBtn.disabled = true;
            }

            importBtn.innerHTML = '📥 Import Web Data to Local';
            importBtn.onclick = window.importOnlineDataToLocal;
            exportBtn.parentNode.insertBefore(importBtn, exportBtn.nextSibling);
        }
    }, 1500);
});
