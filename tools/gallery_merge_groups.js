/* ================================================================
   GALLERY MERGE GROUPS  ("versões alternativas" — só na interface)
   Permite selecionar 2+ imagens e "fundi-las" visualmente: a grade
   passa a mostrar apenas UMA delas (a "principal"), com um selo
   🔗 e setas ◀▶ para pré-visualizar as outras sem sair da grade.
   Na visualização de detalhe, uma pequena tira aparece sobre a
   imagem para trocar rapidamente entre as versões do grupo.

   IMPORTANTE: isso não move, renomeia nem apaga nenhum arquivo.
   Os arquivos de imagem e os .json continuam intactos e separados
   no disco — o agrupamento existe só no IndexedDB deste navegador
   (mesmo lugar onde tags, path visual etc. já são guardados) e só
   serve para reduzir quantos "cards" aparecem na grade/paginação.
   ================================================================ */

let mergeGroups     = new Map(); // primaryFileName -> [primaryFileName, ...outros membros]
let memberToPrimary = new Map(); // qualquer fileName do grupo -> primaryFileName
let isMergeMode     = false;
let groupActiveIndex = new Map(); // primaryFileName -> índice sendo pré-visualizado (não é salvo, é só de sessão)
let markedPrimaryFile = null; // arquivo marcado com ⭐ durante a seleção, para virar a principal do grupo

/* ----------------------------------------------------------------
   BANCO (IndexedDB) — um registro por pasta, como as outras features
   ---------------------------------------------------------------- */
async function saveMergeGroupsToDB(folderName, groupsArray) {
    const db = await initDB();
    return new Promise(r => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(groupsArray, 'mergegroups_' + folderName);
        tx.oncomplete = r;
    });
}

async function getMergeGroupsFromDB(folderName) {
    const db = await initDB();
    return new Promise(r => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get('mergegroups_' + folderName);
        req.onsuccess = () => r(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => r([]);
    });
}

async function persistMergeGroups() {
    if (!currentHandle) return;
    await saveMergeGroupsToDB(currentHandle.name, Array.from(mergeGroups.values()));
}

/* Chamado sempre que uma pasta/subpasta é carregada (depois de currentFiles
   já estar populado — ver chamadas adicionadas em loadGallery/loadSubDir1/2).
   Grupos cujos arquivos não existem mais nesta pasta são descartados. */
async function loadMergeGroupsIndex(dirHandle) {
    mergeGroups.clear();
    memberToPrimary.clear();
    groupActiveIndex.clear();
    if (!dirHandle) return;

    const stored = await getMergeGroupsFromDB(dirHandle.name);
    stored.forEach(group => {
        if (!Array.isArray(group)) return;
        const valid = group.filter(name => currentFiles.some(f => f.name === name));
        if (valid.length < 2) return; // grupo se desfaz sozinho com menos de 2 membros
        mergeGroups.set(valid[0], valid);
        valid.forEach(name => memberToPrimary.set(name, valid[0]));
    });
}

/* ----------------------------------------------------------------
   FILTRO — usado dentro de getGalleryFilteredFiles (gallery_tag_system.js)
   para que grade, contadores e paginação nunca discordem entre si.
   ---------------------------------------------------------------- */
function getMergeFilteredFiles(files) {
    const arr = files || currentFiles;
    return arr.filter(f => {
        const primary = memberToPrimary.get(f.name);
        return !primary || primary === f.name;
    });
}

/* ----------------------------------------------------------------
   MODO DE SELEÇÃO (grade) — mesmo padrão do modo Tag/Rename
   ---------------------------------------------------------------- */
function enterMergeModeGrid() {
    if (!currentHandle) { showAlert('Load a folder first.', 'warn'); return false; }
    isMergeMode = true;
    markedPrimaryFile = null;
    document.getElementById('btn-merge').classList.add('active');
    showAlert('🔗 Select 2+ images. The last one you check stays highlighted and becomes the one shown in the grid.', 'info');
    renderGrid();
    return true;
}

function cancelMergeMode() {
    isMergeMode = false;
    markedPrimaryFile = null;
    const btn = document.getElementById('btn-merge');
    if (btn) btn.classList.remove('active');
    const dropdown = document.getElementById('merge-dropdown');
    if (dropdown) dropdown.classList.remove('open');

    const selectionCount = document.getElementById('merge-selection-count');
    if (selectionCount) selectionCount.style.display = 'none';

    if (document.getElementById('grid-view').style.display !== 'none') {
        renderGrid();
    }
}

/* Aplica/atualiza o destaque (borda dourada) na imagem atualmente marcada
   como "vai ficar visível" — sem precisar re-renderizar a grade inteira a
   cada clique, só troca a classe nas wrappers existentes. */
function highlightMergePrimaryCandidate() {
    document.querySelectorAll('.grid-item-wrapper').forEach(wrapper => {
        const cb = wrapper.querySelector('.merge-checkbox');
        const isCandidate = !!(cb && markedPrimaryFile && cb.dataset.filename === markedPrimaryFile);
        wrapper.classList.toggle('merge-primary-candidate', isCandidate);
    });
}

function toggleMergeMode() {
    if (document.getElementById('detail-view').style.display === 'flex') {
        showAlert('❌ Go back to the grid to merge images.', 'warn');
        return;
    }

    if (!isMergeMode) {
        if (enterMergeModeGrid()) {
            const dropdown = document.getElementById('merge-dropdown');
            dropdown.classList.add('open');
            renderMergeGroupsList();
            if (typeof updateSelectionCount === 'function') updateSelectionCount('merge-checkbox');
        }
    } else {
        cancelMergeMode();
    }
}

/* ----------------------------------------------------------------
   CRIAR UM GRUPO a partir dos checkboxes marcados na grade.
   A primeira imagem (respeitando a ordenação atual A-Z/Z-A/Normal)
   vira a "principal" — a que aparece na grade e é aberta ao clicar.
   ---------------------------------------------------------------- */
async function confirmMergeSelected() {
    if (!currentHandle) return;

    const checked = Array.from(document.querySelectorAll('.merge-checkbox:checked')).map(cb => cb.dataset.filename);
    if (checked.length < 2) {
        showAlert('❌ Select at least 2 images to merge.', 'warn');
        return;
    }

    let ordered = [...checked];
    if (sortMode === 1) ordered.sort((a, b) => a.localeCompare(b));
    else if (sortMode === 2) ordered.sort((a, b) => b.localeCompare(a));

    // Se o usuário marcou (checou) uma imagem por último, ela fica destacada e
    // vira a principal (a que fica visível na grade), independente da ordenação.
    // Sem marcação, cai no padrão antigo: a primeira pela ordenação atual.
    if (markedPrimaryFile && ordered.includes(markedPrimaryFile)) {
        ordered = [markedPrimaryFile, ...ordered.filter(n => n !== markedPrimaryFile)];
    }

    // Uma imagem só pode pertencer a um grupo por vez: tira cada selecionada
    // de qualquer grupo anterior antes de montar o novo.
    ordered.forEach(name => removeFromMergeGroup(name, { skipPersist: true }));

    mergeGroups.set(ordered[0], ordered);
    ordered.forEach(name => memberToPrimary.set(name, ordered[0]));
    groupActiveIndex.set(ordered[0], 0);

    await persistMergeGroups();
    showAlert(`🔗 ${ordered.length} images merged — "${ordered[0]}" stays visible in the grid.`, 'success');
    cancelMergeMode();
    renderGrid();
}

/* ----------------------------------------------------------------
   LISTA DE GRUPOS EXISTENTES — fica escondida atrás do botão
   "📂 Manage Groups (N)" dentro do popup, para não ficar acumulando
   e ocupando espaço visualmente. Só monta as linhas quando aberta.
   ---------------------------------------------------------------- */
function toggleMergeGroupsList() {
    const list = document.getElementById('merge-groups-list');
    if (!list) return;
    const isOpen = list.style.display === 'flex';
    list.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) renderMergeGroupsList();
}

function renderMergeGroupsList() {
    const btn = document.getElementById('btn-manage-merge-groups');
    if (btn) btn.textContent = `📂 Manage Groups (${mergeGroups.size})`;

    const container = document.getElementById('merge-groups-list');
    if (!container) return;
    if (container.style.display !== 'flex') return; // colapsada: não monta o conteúdo à toa

    container.innerHTML = '';

    if (mergeGroups.size === 0) {
        container.innerHTML = '<span style="font-size:11px; color:#666; text-align:center;">No groups yet in this folder.</span>';
        return;
    }

    mergeGroups.forEach((members, primary) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:6px; background:#111; border:1px solid #262626; border-radius:6px; padding:6px 8px;';

        const label = document.createElement('span');
        const nameOnly = primary.substring(0, primary.lastIndexOf('.')) || primary;
        label.textContent = `🔗 ${nameOnly} (+${members.length - 1})`;
        label.title = members.join(', ');
        label.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; font-size:11px; color:#ccc;';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = '✖';
        delBtn.title = 'Ungroup (files are not affected)';
        delBtn.style.cssText = 'background:none; border:none; color:#ff6060; cursor:pointer; font-size:12px; padding:2px 5px; flex-shrink:0;';
        delBtn.onclick = () => ungroupMerge(primary);

        row.appendChild(label);
        row.appendChild(delBtn);
        container.appendChild(row);
    });
}

async function ungroupMerge(primary) {
    const members = mergeGroups.get(primary) || [];
    members.forEach(m => memberToPrimary.delete(m));
    mergeGroups.delete(primary);
    groupActiveIndex.delete(primary);

    await persistMergeGroups();
    renderMergeGroupsList();
    renderGrid();
    showAlert('🔗 Group removed (images preserved).', 'success');
}

/* ----------------------------------------------------------------
   MANTER SINCRONIZADO com rename/auto-rename/delete
   ---------------------------------------------------------------- */

// Chamado por gallery_file_manager.js e gallery_auto_rename.js sempre
// que um arquivo do grupo é renomeado (a imagem principal ou uma alternativa).
function updateMergeGroupFileName(oldName, newName) {
    const primary = memberToPrimary.get(oldName);
    if (!primary) return;

    if (primary === oldName) {
        // Renomeando a própria imagem principal: o grupo migra para a nova chave
        const members = mergeGroups.get(primary) || [];
        mergeGroups.delete(primary);
        const updated = members.map(m => (m === oldName ? newName : m));
        mergeGroups.set(newName, updated);
        updated.forEach(m => memberToPrimary.set(m, newName));
    } else {
        const members = (mergeGroups.get(primary) || []).map(m => (m === oldName ? newName : m));
        mergeGroups.set(primary, members);
        memberToPrimary.delete(oldName);
        memberToPrimary.set(newName, primary);
    }

    if (groupActiveIndex.has(oldName)) {
        groupActiveIndex.set(newName, groupActiveIndex.get(oldName));
        groupActiveIndex.delete(oldName);
    }

    persistMergeGroups();
}

// Chamado por gallery_ui.js (deleteCurrentImage) e internamente por
// confirmMergeSelected() para tirar um arquivo de qualquer grupo existente.
// Se a imagem principal for removida, a próxima da lista assume o posto.
function removeFromMergeGroup(fileName, opts) {
    opts = opts || {};
    const primary = memberToPrimary.get(fileName);
    if (!primary) return;

    let members = (mergeGroups.get(primary) || []).filter(m => m !== fileName);
    memberToPrimary.delete(fileName);

    if (members.length < 2) {
        members.forEach(m => memberToPrimary.delete(m));
        mergeGroups.delete(primary);
        groupActiveIndex.delete(primary);
    } else if (primary === fileName) {
        const newPrimary = members[0];
        mergeGroups.delete(primary);
        mergeGroups.set(newPrimary, members);
        members.forEach(m => memberToPrimary.set(m, newPrimary));
        groupActiveIndex.delete(primary);
    } else {
        mergeGroups.set(primary, members);
    }

    if (!opts.skipPersist) persistMergeGroups();
}

/* ----------------------------------------------------------------
   GRADE — selo 🔗 posição/total e setas ◀▶ de pré-visualização
   (troca só a miniatura exibida; não abre nem altera nenhum arquivo)
   ---------------------------------------------------------------- */
function setupMergeGroupUI(wrapper, img, label, primaryName) {
    if (!groupActiveIndex.has(primaryName)) groupActiveIndex.set(primaryName, 0);

    const badge = document.createElement('div');
    badge.className = 'merge-badge';
    wrapper.appendChild(badge);

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'merge-nav-btn prev';
    prevBtn.textContent = '◀';
    prevBtn.title = 'Previous version (preview only)';
    prevBtn.onclick = (e) => { e.stopPropagation(); cycleMergeGroup(primaryName, -1, img, badge, label); };

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'merge-nav-btn next';
    nextBtn.textContent = '▶';
    nextBtn.title = 'Next version (preview only)';
    nextBtn.onclick = (e) => { e.stopPropagation(); cycleMergeGroup(primaryName, 1, img, badge, label); };

    wrapper.appendChild(prevBtn);
    wrapper.appendChild(nextBtn);

    paintMergeGroupUI(primaryName, img, badge, label);
}

function paintMergeGroupUI(primaryName, img, badge, label) {
    const members = mergeGroups.get(primaryName);
    if (!members) return;

    const idx = groupActiveIndex.get(primaryName) || 0;
    const activeName = members[idx];
    const fileItem = currentFiles.find(f => f.name === activeName);

    if (fileItem) {
        img.src = fileItem.url;
        img.dataset.filename = activeName;
        img.onclick = () => openDetailView(fileItem.url, activeName);
    }

    badge.textContent = `🔗 ${idx + 1}/${members.length}`;
    badge.title = `Alternate versions: ${members.join(', ')}`;

    if (label) {
        const nameOnly = activeName.substring(0, activeName.lastIndexOf('.')) || activeName;
        label.textContent = nameOnly;
        label.title = nameOnly;
    }
}

/* Mantém a grade em sincronia com QUALQUER versão que acabou de ser aberta —
   seja pelo próprio card da grade, pela tira de versões no detalhe, ou pela
   tira de miniaturas normal do rodapé. Sem isso, o selo de visualizações
   (👁️ semanal / 🗓️ mensal) ficava "preso" mostrando a contagem de uma versão
   diferente da que o usuário realmente abriu, porque updateViewCountBadge()
   só encontra o elemento na grade se o data-filename dele já bater com o
   arquivo aberto. Chamado no início de openDetailView(), antes de contar a
   visualização. */
function syncMergeActivePreview(fileName) {
    const primary = memberToPrimary.get(fileName);
    if (!primary) return;

    const members = mergeGroups.get(primary);
    if (!members) return;

    const idx = members.indexOf(fileName);
    if (idx === -1) return;

    groupActiveIndex.set(primary, idx);

    const wrapper = document.querySelector(`.grid-item-wrapper[data-primary="${CSS.escape(primary)}"]`);
    if (!wrapper) return; // grupo não está renderizado agora (ex: página diferente) — nada a sincronizar visualmente

    const img = wrapper.querySelector('.grid-item');
    const badge = wrapper.querySelector('.merge-badge');
    const label = wrapper.querySelector('.grid-item-label');
    if (img && badge) paintMergeGroupUI(primary, img, badge, label);
}

/* Soma as visualizações (semanal/mensal) de TODOS os membros do grupo — usado
   pelo selo da grade, para que abrir qualquer versão alternativa conte para
   o mesmo card, e não fique "perdido" em contadores individuais separados.
   Ver gallery_view_counter.js: renderAllViewCountBadges()/updateViewCountBadge(). */
function getMergeGroupViewCounts(primaryName) {
    const members = mergeGroups.get(primaryName);
    if (!members) return { week: 0, month: 0 };

    let week = 0, month = 0;
    members.forEach(name => {
        const c = (typeof getImageViewCounts === 'function') ? getImageViewCounts(name) : { week: 0, month: 0 };
        week += c.week;
        month += c.month;
    });
    return { week, month };
}

function cycleMergeGroup(primaryName, dir, img, badge, label) {
    const members = mergeGroups.get(primaryName);
    if (!members || members.length === 0) return;

    let idx = groupActiveIndex.get(primaryName) || 0;
    idx = (idx + dir + members.length) % members.length;
    groupActiveIndex.set(primaryName, idx);

    paintMergeGroupUI(primaryName, img, badge, label);
    // Reaproveita o selo de contagem de visualizações já existente na wrapper,
    // repintando-o para o arquivo que ficou ativo depois do ciclo.
    if (typeof renderAllViewCountBadges === 'function') renderAllViewCountBadges();
}

/* ----------------------------------------------------------------
   DETALHE — tira de miniaturas com as versões do grupo, sobre a imagem
   ---------------------------------------------------------------- */
function renderMergeVersionStrip(fileName) {
    const strip = document.getElementById('merge-version-strip');
    if (!strip) return;

    const primary = memberToPrimary.get(fileName);
    const members = primary ? mergeGroups.get(primary) : null;

    if (!members || members.length < 2) {
        strip.classList.remove('active');
        strip.innerHTML = '';
        return;
    }

    strip.innerHTML = '';
    members.forEach(name => {
        const fi = currentFiles.find(f => f.name === name);
        if (!fi) return;
        const t = document.createElement('img');
        t.src = fi.url;
        t.className = 'merge-version-thumb' + (name === fileName ? ' active' : '');
        t.title = name;
        t.onclick = () => openDetailView(fi.url, name);
        strip.appendChild(t);
    });
    strip.classList.add('active');
}