/* =========================================================================
   DATABASE LOGIC (HÍBRIDO LOCAL / ONLINE)
   Gerencia os diretórios (IndexedDB), configurações (JSON) e presets (JSON).
========================================================================= */

const dbName = 'GalleryDB';
const storeName = 'directories';
const settingsDbName = 'SettingsDB';
const settingsStoreName = 'settings';
const presetDbName = 'PresetTagsDB';
const presetStoreName = 'presets';

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

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
                    console.error("Erro do servidor ao ler user_config.json:", res.status);
                }
            } catch (e) {
                console.error("Falha de rede ao ler user_config.json", e);
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
            // Keepalive substitui o sendBeacon para prevenir perdas ao fechar a aba
            try {
                fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
            } catch (e) {}
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
        // Antes só bloqueava no modo local. Mas o mesmo risco existe no modo
        // online: se o IndexedDB falhar ao abrir/ler no boot (ex: modo
        // privado do navegador bloqueando IndexedDB), nada impedia salvar em
        // cima de um cache vazio, sobrescrevendo tudo que já existia lá.
        console.error("Bloqueado: configurações não carregaram corretamente. Salvamento abortado para não sobrescrever com cache incompleto.");
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
            try {
                fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
            } catch (e) {}
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
window.exportBackup = async function() {
    try {
        await loadSettingsToCache();
        await loadPresetsToCache();
        const backupData = {
            version: 1,
            date: new Date().toISOString(),
            presets: Object.keys(window._presetsCache).map(tag => ({ tag: tag, category: window._presetsCache[tag] })),
            settings: Object.keys(window._settingsCache).map(id => ({ id: id, value: window._settingsCache[id] }))
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", "tagmanager_backup.json");
        document.body.appendChild(dlAnchorElem);
        dlAnchorElem.click();
        dlAnchorElem.remove();
        if (window.showAlert) window.showAlert("Backup exported successfully!", "success");
    } catch(e) {
        if (window.showAlert) window.showAlert("Error exporting backup.", "error");
    }
};

window.importBackup = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.readAsText(file, 'UTF-8');
        reader.onload = async readerEvent => {
            try {
                const content = JSON.parse(readerEvent.target.result);
                if (content.presets) {
                    for (let p of content.presets) await window.savePresetTag(p.tag, p.category, true);
                    if (typeof window.renderPresetTags === 'function') window.renderPresetTags();
                }
                if (content.settings) {
                    for (let s of content.settings) await window.saveSetting(s.id, s.value);
                    if (typeof window.loadSettings === 'function') await window.loadSettings();
                }
                if (window.showAlert) window.showAlert("Backup imported successfully! Your data is restored.", "success");
            } catch(err) {
                if (window.showAlert) window.showAlert("Invalid backup file.", "error");
            }
        }
    }
    input.click();
};

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