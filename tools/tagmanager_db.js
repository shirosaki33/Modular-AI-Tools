/* =========================================================================
   DATABASE LOGIC (INDEXED DB)
   Handles directories, settings, and preset tags storage.
========================================================================= */

const dbName = 'GalleryDB';
const storeName = 'directories';
const settingsDbName = 'SettingsDB';
const settingsStoreName = 'settings';
const presetDbName = 'PresetTagsDB';
const presetStoreName = 'presets';

// --- DIRECTORIES DB ---
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

// --- SETTINGS DB ---
window.initSettingsDB = function() {
    return new Promise((res, rej) => {
        try {
            const req = indexedDB.open(settingsDbName, 1);
            req.onupgradeneeded = e => {
                if (!e.target.result.objectStoreNames.contains(settingsStoreName)) {
                    e.target.result.createObjectStore(settingsStoreName, { keyPath: 'id' });
                }
            };
            req.onsuccess = e => res(e.target.result);
            req.onerror = e => rej(e.target.error);
        } catch (err) { rej(err); }
    });
};

window.saveSetting = async function(id, value) {
    try {
        const db = await window.initSettingsDB();
        return new Promise(r => {
            const tx = db.transaction(settingsStoreName, 'readwrite');
            tx.objectStore(settingsStoreName).put({ id: id, value: value });
            tx.oncomplete = () => r();
        });
    } catch (e) {}
};

window.getSetting = async function(id, defaultValue) {
    try {
        const db = await window.initSettingsDB();
        return new Promise(r => {
            const tx = db.transaction(settingsStoreName, 'readonly');
            const req = tx.objectStore(settingsStoreName).get(id);
            req.onsuccess = () => r(req.result !== undefined ? req.result.value : defaultValue);
            req.onerror = () => r(defaultValue);
        });
    } catch (e) { return defaultValue; }
};

// --- PRESETS DB ---
window.initPresetDB = function() {
    return new Promise((res, rej) => {
        try {
            const req = indexedDB.open(presetDbName, 1);
            req.onupgradeneeded = e => {
                if (!e.target.result.objectStoreNames.contains(presetStoreName)) {
                    e.target.result.createObjectStore(presetStoreName, { keyPath: 'tag' });
                }
            };
            req.onsuccess = e => res(e.target.result);
            req.onerror = e => rej(e.target.error);
        } catch (err) { rej(err); }
    });
};

window.getPresetTags = async function() {
    try {
        const db = await window.initPresetDB();
        return new Promise(r => {
            const tx = db.transaction(presetStoreName, 'readonly');
            const store = tx.objectStore(presetStoreName);
            const req = store.getAll();
            tx.oncomplete = () => r(req.result.map(item => ({ tag: item.tag, category: item.category || 'Uncategorized' })));
        });
    } catch (e) { return []; }
};

window.savePresetTag = async function(tag, category = 'Uncategorized', skipRender = false) {
    if (!tag) return;
    try {
        const db = await window.initPresetDB();
        return new Promise(r => {
            const tx = db.transaction(presetStoreName, 'readwrite');
            const req = tx.objectStore(presetStoreName).get(tag);
            req.onsuccess = () => {
                const existing = req.result;
                const finalCat = category !== 'Uncategorized' ? category : (existing ? existing.category || 'Uncategorized' : 'Uncategorized');
                tx.objectStore(presetStoreName).put({ tag: tag, category: finalCat });
            };
            tx.oncomplete = () => { r(); if(!skipRender) window.renderPresetTags(); };
        });
    } catch (e) {}
};

window.deletePresetTag = async function(tag, skipRender = false) {
    try {
        const db = await window.initPresetDB();
        return new Promise(r => {
            const tx = db.transaction(presetStoreName, 'readwrite');
            tx.objectStore(presetStoreName).delete(tag);
            tx.oncomplete = () => { r(); if(!skipRender) window.renderPresetTags(); };
        });
    } catch (e) {}
};

// --- SYSTEM BACKUP (EXPORT/IMPORT) ---
window.exportBackup = async function() {
    try {
        const presets = await window.getPresetTags();
        
        const db = await window.initSettingsDB();
        const settings = await new Promise(r => {
            const tx = db.transaction(settingsStoreName, 'readonly');
            const req = tx.objectStore(settingsStoreName).getAll();
            tx.oncomplete = () => r(req.result);
        });

        const backupData = {
            version: 1,
            date: new Date().toISOString(),
            presets: presets,
            settings: settings
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
        console.error(e);
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
                    for (let p of content.presets) {
                        await window.savePresetTag(p.tag, p.category, true);
                    }
                    if (typeof window.renderPresetTags === 'function') window.renderPresetTags();
                }
                
                if (content.settings) {
                    for (let s of content.settings) {
                        await window.saveSetting(s.id, s.value);
                    }
                    if (typeof window.loadSettings === 'function') await window.loadSettings();
                }
                
                if (window.showAlert) window.showAlert("Backup imported successfully! Your data is restored.", "success");
            } catch(err) {
                console.error(err);
                if (window.showAlert) window.showAlert("Invalid backup file.", "error");
            }
        }
    }
    input.click();
};