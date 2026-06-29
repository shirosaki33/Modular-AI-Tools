/* ================================================================
   GALLERY FILE MANAGER
   Handles file system operations: rename (single & batch) and delete.
   ================================================================ */

let isRenameMode = false;

/**
 * Ativa o modo de seleção de caixas (checkbox) no grid.
 */
function enterRenameModeGrid() {
    if (!currentHandle) { showAlert('Carregue uma pasta primeiro.', 'warn'); return false; }
    isRenameMode = true;
    
    // Destaca o botão do lápis e oculta a barra antiga (caso ela ainda exista no HTML)
    document.getElementById('btn-rename-top').classList.add('active');
    const oldBar = document.getElementById('batch-rename-bar');
    if (oldBar) oldBar.style.display = 'none';
    
    showAlert('✏️ Selecione as imagens e digite o novo nome no balão.', 'info');
    renderGrid();
    return true; // Retorna true para confirmar que o modo foi ativado
}

/** Cancela o modo de renomear e limpa o grid. */
function cancelRenameMode() {
    isRenameMode = false;
    document.getElementById('btn-rename-top').classList.remove('active');
    document.getElementById('rename-dropdown').classList.remove('open');
    renderGrid();
}

/* ================================================================
   PENCIL BUTTON TOGGLE
   Gerencia o clique no Lápis tanto no grid quanto na imagem aberta.
   ================================================================ */
function toggleRenameBalloon() {
    // Truque: Conserta o botão "Cancel" do HTML dinamicamente sem precisar mexer no arquivo .html
    const cancelBtn = document.querySelector('#rename-dropdown button:last-child');
    if (cancelBtn) {
        cancelBtn.onclick = function() {
            if (document.getElementById('detail-view').style.display === 'flex') {
                document.getElementById('rename-dropdown').classList.remove('open'); // Se for 1 imagem, só fecha o balão
            } else {
                cancelRenameMode(); // Se for no grid, desativa as caixinhas e fecha o balão
            }
        };
    }

    const detailView   = document.getElementById('detail-view');
    const isDetailView = detailView.style.display === 'flex';

    // 1. Modo Imagem Única (Detail View)
    if (isDetailView) {
        const dropdown = document.getElementById('rename-dropdown');
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            const input = document.getElementById('rename-input');
            const currentFname = document.getElementById('file-name').value;
            const extMatch = currentFname.match(/\.[^.]+$/);
            const oldExt = extMatch ? extMatch[0] : '';
            input.value = currentFname.replace(oldExt, '');
            input.focus();
            input.select();
        }
        return;
    }

    // 2. Modo Grid
    if (!isRenameMode) {
        // Se ativou o modo grid com sucesso, JÁ ABRE o balão instantaneamente!
        if (enterRenameModeGrid()) {
            const dropdown = document.getElementById('rename-dropdown');
            dropdown.classList.add('open');
            const input = document.getElementById('rename-input');
            input.value = 'new_name'; // Sugestão para o batch rename
            input.focus();
            input.select();
        }
    } else {
        // Se já estava no modo de seleção e clicou no lápis de novo, cancela tudo
        cancelRenameMode();
    }
}

/* ================================================================
   MAIN DISPATCHER
   Chamado pelo botão "Confirm" dentro do balão de renomear.
   ================================================================ */
async function renameCurrentImage() {
    const isDetailView = document.getElementById('detail-view').style.display === 'flex';
    const checkboxes   = document.querySelectorAll('.rename-checkbox:checked');

    if (isDetailView) {
        await renameSingleImage();
    } else if (checkboxes.length > 0) {
        await batchRenameImages(checkboxes);
    } else {
        // Validador que você pediu: ele trava e avisa que precisa selecionar a imagem!
        showAlert('❌ Nenhuma imagem selecionada para renomear.', 'warn');
    }
}

/* ================================================================
   SINGLE RENAME  (detail view)
   ================================================================ */
async function renameSingleImage() {
    if (!currentHandle) {
        showAlert('❌ No directory loaded.', 'error');
        return;
    }

    const oldName = document.getElementById('file-name').value;
    if (!oldName) {
        showAlert('❌ Abra uma foto primeiro para renomear.', 'warn');
        return;
    }

    const extMatch       = oldName.match(/\.[^.]+$/);
    const oldExt         = extMatch ? extMatch[0] : '';
    const oldNameWithoutExt = oldName.replace(oldExt, '');

    let newNameRaw = document.getElementById('rename-input').value;

    if (!newNameRaw || newNameRaw.trim() === oldNameWithoutExt) {
        document.getElementById('rename-dropdown').classList.remove('open');
        return;
    }

    let newName = newNameRaw.trim();
    if (!newName.toLowerCase().endsWith(oldExt.toLowerCase())) {
        newName += oldExt;
    }

    document.getElementById('rename-dropdown').classList.remove('open');
    showAlert('⏳ Renaming file...', 'info');

    try {
        // Abort se o alvo já existir
        try {
            await currentHandle.getFileHandle(newName);
            showAlert('❌ A file with that name already exists!', 'error');
            return;
        } catch (e) {}

        const oldBaseName = oldName.substring(0, oldName.lastIndexOf('.')) || oldName;
        const newBaseName = newName.substring(0, newName.lastIndexOf('.')) || newName;

        // Copia o arquivo da imagem
        const oldImgHandle = await currentHandle.getFileHandle(oldName);
        const oldImgFile   = await oldImgHandle.getFile();
        const newImgHandle = await currentHandle.getFileHandle(newName, { create: true });
        const imgWritable  = await newImgHandle.createWritable();
        await imgWritable.write(await oldImgFile.arrayBuffer());
        await imgWritable.close();

        // Copia e atualiza o JSON sidecar
        try {
            const oldJsonHandle = await currentHandle.getFileHandle(oldBaseName + '.json');
            const oldJsonFile   = await oldJsonHandle.getFile();
            const jsonText      = await oldJsonFile.text();

            let jsonObj = {};
            try { jsonObj = JSON.parse(jsonText); jsonObj.file_name = newName; } catch (e) {}

            const newJsonHandle  = await currentHandle.getFileHandle(newBaseName + '.json', { create: true });
            const jsonWritable   = await newJsonHandle.createWritable();
            await jsonWritable.write(JSON.stringify(jsonObj, null, 2));
            await jsonWritable.close();
            await currentHandle.removeEntry(oldBaseName + '.json');
        } catch (e) {}

        // Remove a imagem antiga
        await currentHandle.removeEntry(oldName);

        // Atualiza a memória cache
        const fileIndex = currentFiles.findIndex(f => f.name === oldName);
        if (fileIndex !== -1) {
            URL.revokeObjectURL(currentFiles[fileIndex].url);
            const newImgFile = await newImgHandle.getFile();
            currentFiles[fileIndex] = {
                name: newName,
                url:  URL.createObjectURL(newImgFile),
                file: newImgFile
            };
        }

        // Atualiza o mapa de tags
        if (tagsPerFile.has(oldName)) {
            const tag = tagsPerFile.get(oldName);
            tagsPerFile.delete(oldName);
            tagsPerFile.set(newName, tag);
        }

        document.getElementById('file-name').value = newName;

        // Atualiza o thumbnail ativo
        const activeThumb = document.querySelector('#thumbnail-strip .thumb.active');
        if (activeThumb && fileIndex !== -1) {
            activeThumb.src     = currentFiles[fileIndex].url;
            activeThumb.onclick = () => openDetailView(currentFiles[fileIndex].url, newName);
        }

        renderGrid();
        showAlert(`✅ Successfully renamed to ${newName}`, 'success');

    } catch (error) {
        console.error('Rename Error:', error);
        showAlert('❌ Error renaming file. Check directory permissions.', 'error');
    }
}

/* ================================================================
   BATCH RENAME  (grid mode)
   ================================================================ */
async function batchRenameImages(checkboxes) {
    if (!currentHandle) return;

    // Puxa o valor do input do balão
    let baseNameRaw = document.getElementById('rename-input').value;

    if (!baseNameRaw || baseNameRaw.trim() === '') {
        document.getElementById('rename-dropdown').classList.remove('open');
        return;
    }

    let baseName = baseNameRaw.trim();
    document.getElementById('rename-dropdown').classList.remove('open');
    document.getElementById('btn-rename-top').classList.remove('active');
    
    showAlert(`⏳ Renomeando ${checkboxes.length} arquivo(s)...`, 'info');

    let count = 0;
    const padding = String(checkboxes.length).length;

    for (let i = 0; i < checkboxes.length; i++) {
        const oldName    = checkboxes[i].dataset.filename;
        const extMatch   = oldName.match(/\.[^.]+$/);
        const ext        = extMatch ? extMatch[0] : '.png';
        const num        = String(i + 1).padStart(padding, '0');
        const newName    = `${baseName}_${num}${ext}`;
        const newBaseName = `${baseName}_${num}`;
        const oldBaseName = oldName.substring(0, oldName.lastIndexOf('.')) || oldName;

        try {
            // Pula se já existe para não sobreescrever
            try {
                await currentHandle.getFileHandle(newName);
                console.warn(`Arquivo ${newName} já existe! Pulando para evitar perda de dados.`);
                continue;
            } catch (e) {}

            const oldImgHandle = await currentHandle.getFileHandle(oldName);
            const oldImgFile   = await oldImgHandle.getFile();
            const newImgHandle = await currentHandle.getFileHandle(newName, { create: true });
            const imgWritable  = await newImgHandle.createWritable();
            await imgWritable.write(await oldImgFile.arrayBuffer());
            await imgWritable.close();

            try {
                const oldJsonHandle = await currentHandle.getFileHandle(oldBaseName + '.json');
                const oldJsonFile   = await oldJsonHandle.getFile();
                let jsonObj         = JSON.parse(await oldJsonFile.text());
                jsonObj.file_name   = newName;

                const newJsonHandle = await currentHandle.getFileHandle(newBaseName + '.json', { create: true });
                const jsonWritable  = await newJsonHandle.createWritable();
                await jsonWritable.write(JSON.stringify(jsonObj, null, 2));
                await jsonWritable.close();
                await currentHandle.removeEntry(oldBaseName + '.json');
            } catch (e) {}

            await currentHandle.removeEntry(oldName);

            const fileIndex = currentFiles.findIndex(f => f.name === oldName);
            if (fileIndex !== -1) {
                URL.revokeObjectURL(currentFiles[fileIndex].url);
                const newImgFile = await newImgHandle.getFile();
                currentFiles[fileIndex] = {
                    name: newName,
                    url:  URL.createObjectURL(newImgFile),
                    file: newImgFile
                };
            }

            if (tagsPerFile.has(oldName)) {
                const tag = tagsPerFile.get(oldName);
                tagsPerFile.delete(oldName);
                tagsPerFile.set(newName, tag);
            }

            count++;
        } catch (error) {
            console.error(`Erro ao renomear ${oldName}:`, error);
        }
    }

    isRenameMode = false;
    renderGrid();
    showAlert(`✅ ${count} arquivo(s) renomeado(s) com sucesso!`, 'success');
}