/* ================================================================
   GALLERY VIEW COUNTER
   Tracks how many times each image was opened (to look at its
   prompt), shown as a small badge on the grid thumbnail with two
   independent numbers: 👁️ this week and 🗓️ this month. Both reset
   automatically once their period rolls over — the reset rules for
   each are configurable in ⚙️ Settings.

   Two independent switches control the feature:
   - The 👁️ button next to the pencil (✏️) PAUSES only the counting
     (existing numbers/badges stay visible, nothing new gets counted).
   - The checkbox in ⚙️ Settings disables the WHOLE feature (badges
     are hidden and nothing is stored or counted).
   ================================================================ */

let viewCountEnabled = true;    // Settings gear: whole feature on/off
let viewCountPaused  = false;   // Eye button: pause incrementing only

// Reset rules (configurable in Settings)
let viewCountWeeklyResetDay   = 0;            // 0 = Sunday ... 6 = Saturday
let viewCountMonthlyMode      = 'endofmonth'; // 'endofmonth' | 'every15' | 'customday'
let viewCountMonthlyCustomDay = 1;            // used only when mode === 'customday' (1-28)

// Current folder's counts: { weekKey, weekCounts: {file: n}, monthKey, monthCounts: {file: n} }
let viewCountsData = { weekKey: '', weekCounts: {}, monthKey: '', monthCounts: {} };

/* ----------------------------------------------------------------
   PERIOD KEYS
   ---------------------------------------------------------------- */

// Weekly key = the date of the most recent reset-day (or today, if today
// IS the reset day), as a plain date string. Changing this key wipes the
// weekly counts back to zero.
function getCurrentWeekKey() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = (start.getDay() - viewCountWeeklyResetDay + 7) % 7;
    start.setDate(start.getDate() - diff);
    return start.toDateString();
}

// Monthly key depends on the chosen rule:
//  - endofmonth: one bucket per calendar month (resets on the 1st)
//  - every15:    two buckets per month, days 1-15 and 16-end
//  - customday:  a billing-style cycle that rolls over on a fixed day
function getCurrentMonthKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();

    if (viewCountMonthlyMode === 'every15') {
        return `${y}-${m}-${d <= 15 ? 'H1' : 'H2'}`;
    }

    if (viewCountMonthlyMode === 'customday') {
        const cutoff = Math.min(Math.max(viewCountMonthlyCustomDay || 1, 1), 28);
        if (d >= cutoff) return `${y}-${m}`;
        // Before the cutoff day, we're still inside the cycle that started last month
        const prevMonth = m === 0 ? 11 : m - 1;
        const prevYear  = m === 0 ? y - 1 : y;
        return `${prevYear}-${prevMonth}`;
    }

    // 'endofmonth' (default): plain calendar month
    return `${y}-${m}`;
}

/* ----------------------------------------------------------------
   ARMAZENAMENTO — arquivo dentro da própria pasta (acompanha a pasta
   entre navegadores/PCs). O IndexedDB é separado em cada navegador,
   então agora ele serve só como ORIGEM DE MIGRAÇÃO: o que existir no
   cache é importado para o arquivo e, se a gravação der certo, o
   registro do IndexedDB é apagado (limpo).
   ---------------------------------------------------------------- */
const VIEW_COUNTS_FILE = '_gallery_view_counts.json';

async function getViewCountsFromDB(folderName) {
    try {
        const db = await initDB();
        return await new Promise(r => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get('viewcounts_' + folderName);
            req.onsuccess = () => r(req.result || null);
            req.onerror = () => r(null);
        });
    } catch (e) { return null; }
}

// Fallback: só usado se não for possível gravar o arquivo na pasta
async function saveViewCountsToDB(folderName, data) {
    const db = await initDB();
    return new Promise(r => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(data, 'viewcounts_' + folderName);
        tx.oncomplete = r;
    });
}

async function deleteViewCountsFromDB(folderName) {
    try {
        const db = await initDB();
        await new Promise(r => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete('viewcounts_' + folderName);
            tx.oncomplete = r;
            tx.onerror = r;
        });
    } catch (e) { console.warn('Could not clean view counts cache:', e); }
}

// Retorna o objeto salvo, ou null se o arquivo não existe / é inválido
async function getViewCountsFromFile(dirHandle) {
    try {
        const fh = await dirHandle.getFileHandle(VIEW_COUNTS_FILE);
        const data = JSON.parse(await (await fh.getFile()).text());
        return (data && typeof data === 'object') ? data : null;
    } catch (e) {
        return null;
    }
}

// Retorna true se gravou com sucesso
async function saveViewCountsToFile(dirHandle, data) {
    try {
        const fh = await dirHandle.getFileHandle(VIEW_COUNTS_FILE, { create: true });
        const writable = await fh.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
        return true;
    } catch (e) {
        console.error('Could not save view counts file:', e);
        return false;
    }
}

// Grava o estado atual (viewCountsData) — em fila, para que duas aberturas
// seguidas de imagem não tentem escrever o mesmo arquivo ao mesmo tempo.
let _viewCountsWriteQueue = Promise.resolve();
function persistViewCounts() {
    if (!currentHandle) return Promise.resolve();
    const handle = currentHandle;
    const snapshot = JSON.parse(JSON.stringify(viewCountsData));
    _viewCountsWriteQueue = _viewCountsWriteQueue.then(async () => {
        const ok = await saveViewCountsToFile(handle, snapshot);
        if (ok) {
            await deleteViewCountsFromDB(handle.name);
        } else {
            await saveViewCountsToDB(handle.name, snapshot); // fallback
            if (typeof showAlert === 'function') showAlert('⚠️ View counts saved only in this browser (could not write file to folder).', 'warn');
        }
    }).catch(e => console.error(e));
    return _viewCountsWriteQueue;
}

/* Converte qualquer formato salvo (inclusive o antigo { weekKey, counts })
   para o formato atual e zera o período que já virou. Retorna
   { data, changed }. */
function normalizeViewCounts(raw, weekKey, monthKey) {
    if (!raw) return { data: { weekKey, weekCounts: {}, monthKey, monthCounts: {} }, changed: true };

    const data = {
        weekKey:     raw.weekKey  || '',
        weekCounts:  raw.weekCounts || raw.counts || {},
        monthKey:    raw.monthKey || '',
        monthCounts: raw.monthCounts || {}
    };
    let changed = !!raw.counts;
    if (data.weekKey !== weekKey)   { data.weekKey = weekKey;   data.weekCounts = {};  changed = true; }
    if (data.monthKey !== monthKey) { data.monthKey = monthKey; data.monthCounts = {}; changed = true; }
    return { data, changed };
}

function sumCountMaps(target, extra) {
    Object.keys(extra || {}).forEach(k => {
        target[k] = (target[k] || 0) + (Number(extra[k]) || 0);
    });
}

/* ----------------------------------------------------------------
   LOAD/RESET per folder - called whenever a folder/subfolder loads.
   Fluxo:
   1) lê o arquivo da pasta (se existir) e zera períodos vencidos;
   2) importa o que houver no cache (IndexedDB) deste navegador,
      SOMANDO às contagens do arquivo (só dos períodos ainda vigentes);
   3) grava o arquivo e, se deu certo, limpa o IndexedDB.
   ---------------------------------------------------------------- */
async function loadViewCountsIndex(dirHandle) {
    if (!dirHandle) {
        viewCountsData = { weekKey: '', weekCounts: {}, monthKey: '', monthCounts: {} };
        return;
    }

    const weekKey  = getCurrentWeekKey();
    const monthKey = getCurrentMonthKey();

    const fileRaw = await getViewCountsFromFile(dirHandle);
    const dbRaw   = await getViewCountsFromDB(dirHandle.name);

    const fileNorm = normalizeViewCounts(fileRaw, weekKey, monthKey);
    let data = fileNorm.data;
    let needsWrite = fileNorm.changed || !fileRaw;

    if (dbRaw) {
        const dbNorm = normalizeViewCounts(dbRaw, weekKey, monthKey).data;
        sumCountMaps(data.weekCounts,  dbNorm.weekCounts);
        sumCountMaps(data.monthCounts, dbNorm.monthCounts);
        needsWrite = true;
    }

    viewCountsData = data;

    if (needsWrite) {
        const ok = await saveViewCountsToFile(dirHandle, data);
        if (ok) {
            if (dbRaw) {
                await deleteViewCountsFromDB(dirHandle.name);
                if (typeof showAlert === 'function') showAlert('👁️ View counts imported from browser cache into the folder file.', 'success');
            }
        }
        // se falhar, o cache é mantido para tentar de novo na próxima abertura
    }
}

/* ----------------------------------------------------------------
   INCREMENT - called every time an image is opened to view its prompt
   ---------------------------------------------------------------- */
async function registerImageView(fileName) {
    if (!viewCountEnabled || viewCountPaused) return;
    if (!currentHandle || !fileName) return;

    // Guard against a period rolling over mid-session
    const weekKey  = getCurrentWeekKey();
    const monthKey = getCurrentMonthKey();
    if (viewCountsData.weekKey  !== weekKey)  { viewCountsData.weekKey  = weekKey;  viewCountsData.weekCounts  = {}; }
    if (viewCountsData.monthKey !== monthKey) { viewCountsData.monthKey = monthKey; viewCountsData.monthCounts = {}; }

    viewCountsData.weekCounts[fileName]  = (viewCountsData.weekCounts[fileName]  || 0) + 1;
    viewCountsData.monthCounts[fileName] = (viewCountsData.monthCounts[fileName] || 0) + 1;

    await persistViewCounts();
    updateViewCountBadge(fileName);
}

/* Rename (manual, batch ou auto-rename): as contagens acompanham o arquivo.
   Antes ficavam presas no nome antigo e a imagem renomeada voltava a 0. */
function renameViewCountEntry(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    let moved = false;
    ['weekCounts', 'monthCounts'].forEach(k => {
        const map = viewCountsData[k];
        if (map && map[oldName]) { map[newName] = (map[newName] || 0) + map[oldName]; delete map[oldName]; moved = true; }
    });
    if (moved) persistViewCounts();
}

/* Mudou a regra de reset nas Settings: só troca a chave do período atual,
   SEM zerar (antes, trocar o dia de reset apagava as contagens da semana/mês). */
function rekeyViewCountsAfterSettingsChange() {
    viewCountsData.weekKey  = getCurrentWeekKey();
    viewCountsData.monthKey = getCurrentMonthKey();
    persistViewCounts();
    if (typeof renderAllViewCountBadges === 'function') renderAllViewCountBadges();
}

function getImageViewCounts(fileName) {
    return {
        week:  (viewCountsData.weekCounts  && viewCountsData.weekCounts[fileName])  || 0,
        month: (viewCountsData.monthCounts && viewCountsData.monthCounts[fileName]) || 0
    };
}

/* ----------------------------------------------------------------
   BADGE RENDERING - small counter shown on top of the thumbnail
   ---------------------------------------------------------------- */
function updateViewCountBadge(fileName) {
    if (!viewCountEnabled) return;

    // Se o arquivo pertence a um grupo mesclado ("versões alternativas"), o selo
    // do card é a SOMA de todos os membros — localiza o card pelo atributo
    // data-primary em vez de por data-filename (que pode não ser esse arquivo
    // específico, já que só a versão "ativa" do grupo aparece na grade).
    const primary = (typeof memberToPrimary !== 'undefined') ? memberToPrimary.get(fileName) : null;
    if (primary) {
        const wrapper = document.querySelector(`.grid-item-wrapper[data-primary="${CSS.escape(primary)}"]`);
        if (!wrapper) return;
        if (typeof getMergeGroupViewCounts === 'function') {
            const { week, month } = getMergeGroupViewCounts(primary);
            paintBadgeWithCounts(getOrCreateBadge(wrapper), week, month);
        }
        return;
    }

    const img = document.querySelector(`.grid-item[data-filename="${CSS.escape(fileName)}"]`);
    const wrapper = img ? img.closest('.grid-item-wrapper') : null;
    if (!wrapper) return;
    paintBadge(getOrCreateBadge(wrapper), fileName);
}

function getOrCreateBadge(wrapper) {
    let badge = wrapper.querySelector('.view-count-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'view-count-badge';
        wrapper.appendChild(badge);
    }
    return badge;
}

function paintBadgeWithCounts(badge, week, month) {
    badge.innerHTML = `<span title="Opened ${week}x this week">\u{1F441}\uFE0F ${week}</span><span class="view-count-sep">\u00B7</span><span title="Opened ${month}x this month">\u{1F5D3}\uFE0F ${month}</span>`;
    badge.style.display = (week > 0 || month > 0) ? 'flex' : 'none';
}

function paintBadge(badge, fileName) {
    const { week, month } = getImageViewCounts(fileName);
    paintBadgeWithCounts(badge, week, month);
}

/** Repaints every badge currently in the grid - called after renderGrid()
 *  rebuilds the wrappers, and whenever the feature is toggled on/off. */
function renderAllViewCountBadges() {
    document.querySelectorAll('.grid-item-wrapper').forEach(wrapper => {
        const existing = wrapper.querySelector('.view-count-badge');
        if (!viewCountEnabled) {
            if (existing) existing.remove();
            return;
        }

        const img = wrapper.querySelector('.grid-item');
        const fname = img?.dataset.filename;
        if (!fname) return;

        // Card de grupo mesclado: soma as visualizações de todos os membros,
        // não só da versão sendo pré-visualizada no momento (fname).
        const primary = wrapper.dataset.primary;
        if (primary && typeof getMergeGroupViewCounts === 'function') {
            const { week, month } = getMergeGroupViewCounts(primary);
            paintBadgeWithCounts(getOrCreateBadge(wrapper), week, month);
            return;
        }

        paintBadge(getOrCreateBadge(wrapper), fname);
    });
}

/* ----------------------------------------------------------------
   UI TOGGLES
   ---------------------------------------------------------------- */

// Eye button next to the pencil - pauses/resumes the increment only
function toggleViewCountPause() {
    viewCountPaused = !viewCountPaused;
    updateViewCountPauseButtonUI();
    saveSettingsToDB();
    showAlert(viewCountPaused ? '⏸️ View counting paused.' : '▶️ View counting resumed.', 'info');
}

function updateViewCountPauseButtonUI() {
    const btn = document.getElementById('btn-viewcount-pause');
    if (!btn) return;
    // "active" (green) = counting is running; inactive = paused
    btn.classList.toggle('active', !viewCountPaused);
    btn.textContent = viewCountPaused ? '👁️‍🗨️' : '👁️';
    btn.title = viewCountPaused
        ? 'View Counter: PAUSED (click to resume counting)'
        : 'View Counter: counting views (click to pause)';
}

// Settings checkbox - disables the whole feature (badges + counting)
function toggleViewCountEnabled() {
    viewCountEnabled = document.getElementById('toggle-viewcount-enabled').checked;
    updateViewCountButtonsVisibility();
    updateViewCountSettingsUI();
    renderAllViewCountBadges();
}

/** Shows/hides the eye pause button: only relevant when a folder is loaded
 *  AND the feature itself is enabled in Settings. */
function updateViewCountButtonsVisibility() {
    const btn = document.getElementById('btn-viewcount-pause');
    if (!btn) return;
    const hasFolder = typeof currentHandle !== 'undefined' && !!currentHandle;
    btn.style.display = (hasFolder && viewCountEnabled) ? 'inline-flex' : 'none';
}

/* ---------------------------------------------------------------
   EXTRA SETTINGS - weekly reset day / monthly reset rule, shown
   inside the Settings dropdown only while the feature is enabled.
   --------------------------------------------------------------- */
function updateViewCountSettingsUI() {
    const extra = document.getElementById('viewcount-extra-settings');
    if (extra) extra.style.display = viewCountEnabled ? 'flex' : 'none';

    const customRow = document.getElementById('viewcount-customday-row');
    if (customRow) customRow.style.display = (viewCountMonthlyMode === 'customday') ? 'flex' : 'none';
}

// Called when the "Weekly reset day" <select> changes
function onViewCountWeeklyDayChange() {
    const sel = document.getElementById('viewcount-weekly-day');
    if (!sel) return;
    viewCountWeeklyResetDay = parseInt(sel.value, 10) || 0;
    saveSettingsToDB();
    if (typeof currentHandle !== 'undefined' && currentHandle) rekeyViewCountsAfterSettingsChange();
}

// Called when the "Monthly reset rule" <select> changes
function onViewCountMonthlyModeChange() {
    const sel = document.getElementById('viewcount-monthly-mode');
    if (!sel) return;
    viewCountMonthlyMode = sel.value;
    updateViewCountSettingsUI();
    saveSettingsToDB();
    if (typeof currentHandle !== 'undefined' && currentHandle) rekeyViewCountsAfterSettingsChange();
}

// Called when the custom "reset day of month" number input changes
function onViewCountMonthlyCustomDayChange() {
    const input = document.getElementById('viewcount-monthly-customday');
    if (!input) return;
    let val = parseInt(input.value, 10);
    if (isNaN(val)) val = 1;
    val = Math.min(Math.max(val, 1), 28);
    input.value = val;
    viewCountMonthlyCustomDay = val;
    saveSettingsToDB();
    if (typeof currentHandle !== 'undefined' && currentHandle) rekeyViewCountsAfterSettingsChange();
}