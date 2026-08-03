/* ================================================================
   GALLERY PATH SAVER
   Manages creating and displaying visual path labels for
   directories, saved in IndexedDB.
   ================================================================ */

// 1. Database (IndexedDB) functions dedicated to the path text
async function savePathToDB(folderName, pathStr) { 
    const db = await initDB(); 
    return new Promise(r => { 
        const tx = db.transaction(storeName, 'readwrite'); 
        tx.objectStore(storeName).put(pathStr, 'path_' + folderName); 
        tx.oncomplete = r; 
    }); 
}

async function getPathFromDB(folderName) { 
    const db = await initDB(); 
    return new Promise(r => { 
        const tx = db.transaction(storeName, 'readonly'); 
        const req = tx.objectStore(storeName).get('path_' + folderName); 
        req.onsuccess = () => r(req.result); 
        req.onerror = () => r(''); 
    }); 
}

// NOTE: getHandles() and deleteHandle() are already defined in gallery_holder.html
// (and already ignore the 'path_*' and '__app_settings__' keys), so they don't
// need to be reimplemented here.

// 2. UI control (the input popup)
function togglePathMode() {
    if (!rootHandle) { 
        showAlert('Load a folder first.', 'warn'); 
        return; 
    }
    
    const dropdown = document.getElementById('path-dropdown');
    
    // Close any other open menu
    document.querySelectorAll('.settings-dropdown').forEach(el => {
        if (el.id !== 'path-dropdown') el.classList.remove('open');
    });
    
    dropdown.classList.toggle('open');
    
    if (dropdown.classList.contains('open')) {
        const input = document.getElementById('path-label-input');
        const currentText = document.getElementById('path-display').textContent.replace('📁 ', '');
        input.value = currentText;
        input.focus();
        input.select();
    }
}

// 3. Save and update the interface
async function applyPathLabel() {
    if (!rootHandle) return;
    const newPath = document.getElementById('path-label-input').value.trim();
    
    await savePathToDB(rootHandle.name, newPath);
    updatePathDisplay(newPath);
    
    document.getElementById('path-dropdown').classList.remove('open');
    showAlert('📍 Visual path saved successfully!', 'success');
}

function updatePathDisplay(pathStr) {
    const display = document.getElementById('path-display');
    if (display) {
        display.textContent = pathStr ? `📁 ${pathStr}` : '';
    }
}

// Called by the HTML file when a folder loads
window.loadSavedPathDisplay = async function(dirHandle) {
    if (!dirHandle) return;
    const savedText = await getPathFromDB(dirHandle.name);
    updatePathDisplay(savedText);
};