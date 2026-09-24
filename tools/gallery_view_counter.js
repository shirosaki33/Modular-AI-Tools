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
   DATABASE (IndexedDB) - counts are stored per folder
   ---------------------------------------------------------------- */
async function saveViewCountsToDB(folderName, data) {
    const db = await initDB();
    return new Promise(r => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(data, 'viewcounts_' + folderName);
        tx.oncomplete = r;
    });
}

async function getViewCountsFromDB(folderName) {
    const db = await initDB();
    return new Promise(r => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get('viewcounts_' + folderName);
        req.onsuccess = () => r(req.result || null);
        req.onerror = () => r(null);
    });
}

// NOTE: getHandles() and deleteHandle() in gallery_core.js already ignore the
// 'viewcounts_' prefix (added alongside 'path_', 'autorename_', etc.), so
// this store doesn't show up as a fake "directory" in the dropdown.

/* ----------------------------------------------------------------
   LOAD/RESET per folder - called whenever a folder/subfolder loads.
   Normalizes old (weekly-only) saved data so nobody loses their
   existing weekly counts when this update lands.
   ---------------------------------------------------------------- */
async function loadViewCountsIndex(dirHandle) {
    if (!dirHandle) {
        viewCountsData = { weekKey: '', weekCounts: {}, monthKey: '', monthCounts: {} };
        return;
    }

    const weekKey  = getCurrentWeekKey();
    const monthKey = getCurrentMonthKey();
    const stored   = await getViewCountsFromDB(dirHandle.name);

    if (!stored) {
        viewCountsData = { weekKey, weekCounts: {}, monthKey, monthCounts: {} };
        await saveViewCountsToDB(dirHandle.name, viewCountsData);
        return;
    }

    // Migrate the old shape ({ weekKey, counts }) to the new one, keeping
    // whatever weekly numbers were already collected.
    const normalized = {
        weekKey:     stored.weekKey  || '',
        weekCounts:  stored.weekCounts || stored.counts || {},
        monthKey:    stored.monthKey || '',
        monthCounts: stored.monthCounts || {}
    };

    let changed = false;
    if (normalized.weekKey !== weekKey)   { normalized.weekKey = weekKey;   normalized.weekCounts = {};  changed = true; }
    if (normalized.monthKey !== monthKey) { normalized.monthKey = monthKey; normalized.monthCounts = {}; changed = true; }

    viewCountsData = normalized;
    if (changed || stored.counts) await saveViewCountsToDB(dirHandle.name, viewCountsData);
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

    await saveViewCountsToDB(currentHandle.name, viewCountsData);
    updateViewCountBadge(fileName);
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
    if (typeof currentHandle !== 'undefined' && currentHandle && typeof loadViewCountsIndex === 'function') {
        loadViewCountsIndex(currentHandle).then(() => { if (typeof renderAllViewCountBadges === 'function') renderAllViewCountBadges(); });
    }
}

// Called when the "Monthly reset rule" <select> changes
function onViewCountMonthlyModeChange() {
    const sel = document.getElementById('viewcount-monthly-mode');
    if (!sel) return;
    viewCountMonthlyMode = sel.value;
    updateViewCountSettingsUI();
    saveSettingsToDB();
    if (typeof currentHandle !== 'undefined' && currentHandle && typeof loadViewCountsIndex === 'function') {
        loadViewCountsIndex(currentHandle).then(() => { if (typeof renderAllViewCountBadges === 'function') renderAllViewCountBadges(); });
    }
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
    if (typeof currentHandle !== 'undefined' && currentHandle && typeof loadViewCountsIndex === 'function') {
        loadViewCountsIndex(currentHandle).then(() => { if (typeof renderAllViewCountBadges === 'function') renderAllViewCountBadges(); });
    }
}