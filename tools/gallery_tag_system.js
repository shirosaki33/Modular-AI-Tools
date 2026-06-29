/* ================================================================
   GALLERY TAG SYSTEM
   Handles per-image tagging, batch tag application, tag filtering,
   and the tags index (loaded from sidecar JSONs).
   ================================================================ */

let tagsPerFile = new Map();
let allTags     = new Set();
let isTagMode   = false;

/* ----------------------------------------------------------------
   DATALIST  — keeps the <datalist id="all-tags-list"> up to date
   ---------------------------------------------------------------- */
function updateTagsDatalist() {
    const dl = document.getElementById('all-tags-list');
    dl.innerHTML = '';
    allTags.forEach(t => {
        if (t && t.trim() !== '') {
            const opt = document.createElement('option');
            opt.value = t;
            dl.appendChild(opt);
        }
    });
}

/* ----------------------------------------------------------------
   FILTER  — shows/hides grid items by tag
   ---------------------------------------------------------------- */
function filterGallery() {
    const term     = document.getElementById('filter-tag').value.toLowerCase().trim();
    const wrappers = document.querySelectorAll('.grid-item-wrapper');
    wrappers.forEach(wrap => {
        const img      = wrap.querySelector('.grid-item');
        const fname    = img.dataset.filename;
        const imageTag = (tagsPerFile.get(fname) || '').toLowerCase();
        wrap.style.display = (term === '' || imageTag.includes(term)) ? 'flex' : 'none';
    });
}

/* ----------------------------------------------------------------
   INDEX LOADER  — scans every sidecar JSON in the directory
   ---------------------------------------------------------------- */
async function loadTagsIndex(dirHandle) {
    tagsPerFile.clear();
    allTags.clear();
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) {
            try {
                const file    = await entry.getFile();
                const json    = JSON.parse(await file.text());
                const imgName = json.file_name;
                const imgTag  = json.tag;
                if (imgName && imgTag && imgTag.trim() !== '') {
                    tagsPerFile.set(imgName, imgTag.trim());
                    allTags.add(imgTag.trim());
                }
            } catch (e) {}
        }
    }
    updateTagsDatalist();
}

/* ----------------------------------------------------------------
   BATCH TAG MODE (UI LOGIC)
   ---------------------------------------------------------------- */
function enterTagModeGrid() {
    if (!currentHandle) { showAlert('Carregue uma pasta primeiro.', 'warn'); return false; }
    isTagMode = true;
    document.getElementById('btn-batch-tag').classList.add('active');
    
    // Oculta barras antigas se ainda estiverem lá
    const oldBar = document.getElementById('batch-tag-bar');
    if (oldBar) oldBar.style.display = 'none';

    showAlert('🏷️ Selecione as imagens e digite a tag no balão.', 'info');
    renderGrid();
    return true;
}

function cancelBatchTags() {
    isTagMode = false;
    document.getElementById('btn-batch-tag').classList.remove('active');
    const dropdown = document.getElementById('tag-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    
    // Renderiza a grid de volta ao normal caso estejamos na visão de galeria
    if (document.getElementById('grid-view').style.display !== 'none') {
        renderGrid();
    }
}

function toggleBatchTagMode() {
    // Configura dinamicamente o botão de cancelar do balão
    const cancelBtn = document.querySelector('#tag-dropdown button:last-child');
    if (cancelBtn) {
        cancelBtn.onclick = function() {
            if (document.getElementById('detail-view').style.display === 'flex') {
                document.getElementById('tag-dropdown').classList.remove('open');
            } else {
                cancelBatchTags();
            }
        };
    }

    const detailView   = document.getElementById('detail-view');
    const isDetailView = detailView.style.display === 'flex';

    // 1. Modo Imagem Única (Detail View)
    if (isDetailView) {
        const dropdown = document.getElementById('tag-dropdown');
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            const input = document.getElementById('batch-tag-input');
            input.value = document.getElementById('val-tag').value || '';
            input.focus();
            input.select();
        }
        return;
    }

    // 2. Modo Grid
    if (!isTagMode) {
        if (enterTagModeGrid()) {
            const dropdown = document.getElementById('tag-dropdown');
            dropdown.classList.add('open');
            const input = document.getElementById('batch-tag-input');
            input.value = ''; 
            input.focus();
        }
    } else {
        cancelBatchTags();
    }
}

/* ----------------------------------------------------------------
   APPLY BATCH TAGS  — writes tag to selected images' sidecar JSONs
   ---------------------------------------------------------------- */
async function applyBatchTags() {
    if (!currentHandle) return;

    const newTag         = document.getElementById('batch-tag-input').value.trim();
    let   filesToUpdate  = [];
    const isDetailView   = document.getElementById('detail-view').style.display === 'flex';

    if (isDetailView) {
        const currentFname = document.getElementById('file-name').value;
        if (currentFname) filesToUpdate.push(currentFname);
    } else {
        document.querySelectorAll('.tag-checkbox:checked').forEach(cb => filesToUpdate.push(cb.dataset.filename));
    }

    if (filesToUpdate.length === 0) { 
        showAlert('❌ Nenhuma imagem selecionada para adicionar tag.', 'warn'); 
        return; 
    }
    
    showAlert(`Applying tag to ${filesToUpdate.length} images...`, 'info');
    let count = 0;

    for (const fname of filesToUpdate) {
        const baseName    = fname.substring(0, fname.lastIndexOf('.')) || fname;
        const sidecarName = baseName + '.json';

        let oldData = {};
        try {
            const existingFh   = await currentHandle.getFileHandle(sidecarName);
            const existingFile = await existingFh.getFile();
            oldData = JSON.parse(await existingFile.text());
        } catch (e) {}

        let meta = null;
        if (Object.keys(oldData).length === 0) {
            const fileItem = currentFiles.find(a => a.name === fname);
            if (fileItem?.file) meta = await extractPNGMetadata(fileItem.file);
        }

        const dataObj = {
            file_name:  fname,
            positive:   oldData.positive  ?? meta?.pos       ?? '',
            negative:   oldData.negative  ?? meta?.neg       ?? '',
            tag:        newTag,
            notes:      oldData.notes     ?? (oldData.note ? [oldData.note] : []),
            cfg:        oldData.cfg       ?? meta?.cfg       ?? '',
            steps:      oldData.steps     ?? meta?.steps     ?? '',
            seed:       oldData.seed      ?? meta?.seed      ?? '',
            sampler:    oldData.sampler   ?? meta?.sampler   ?? meta?.scheduler ?? '',
            checkpoint: oldData.checkpoint ?? meta?.ckpt     ?? meta?.checkpoint ?? '',
            loras:      oldData.loras     ?? meta?.loras     ?? '',
            size:       oldData.size      ?? meta?.size      ?? ''
        };

        try {
            const fh       = await currentHandle.getFileHandle(sidecarName, { create: true });
            const writable = await fh.createWritable();
            await writable.write(JSON.stringify(dataObj, null, 2));
            await writable.close();
            tagsPerFile.set(fname, newTag);
            if (newTag) allTags.add(newTag);
            count++;
        } catch (e) { console.error(e); }
    }

    updateTagsDatalist();
    showAlert(`✅ Tag applied to ${count} images!`, 'success');
    
    if (isDetailView) {
        document.getElementById('val-tag').value = newTag;
        document.getElementById('tag-dropdown').classList.remove('open');
    } else {
        cancelBatchTags();
    }
}