/* ================================================================
   GALLERY PATH SAVER
   Gerencia a criação e exibição de etiquetas visuais para os 
   diretórios, salvando no IndexedDB.
   ================================================================ */

// 1. Funções de Banco de Dados (IndexedDB) exclusivas para os textos
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

// NOTA: getHandles() e deleteHandle() já são definidas em gallery_holder.html
// (e já ignoram as chaves 'path_*' e '__app_settings__'), então não precisam
// ser reimplementadas aqui.

// 2. Controle de UI (O balão de digitação)
function togglePathMode() {
    if (!rootHandle) { 
        showAlert('Carregue uma pasta primeiro.', 'warn'); 
        return; 
    }
    
    const dropdown = document.getElementById('path-dropdown');
    
    // Fecha qualquer outro menu que esteja aberto
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

// 3. Salvar e Atualizar Interface
async function applyPathLabel() {
    if (!rootHandle) return;
    const newPath = document.getElementById('path-label-input').value.trim();
    
    await savePathToDB(rootHandle.name, newPath);
    updatePathDisplay(newPath);
    
    document.getElementById('path-dropdown').classList.remove('open');
    showAlert('📍 Rota visual salva com sucesso!', 'success');
}

function updatePathDisplay(pathStr) {
    const display = document.getElementById('path-display');
    if (display) {
        display.textContent = pathStr ? `📁 ${pathStr}` : '';
    }
}

// Função para ser chamada quando a pasta carregar no HTML
window.loadSavedPathDisplay = async function(dirHandle) {
    if (!dirHandle) return;
    const savedText = await getPathFromDB(dirHandle.name);
    updatePathDisplay(savedText);
};