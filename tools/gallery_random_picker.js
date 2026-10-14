/* ================================================================
   GALLERY RANDOM PICKER
   Adds a 🎲 Random button inside the centered bottom bar (the same
   one used for pagination — bottom-middle, on the same row as the
   "grid size" button on the left and the img/JSON counters on the
   right). It opens a random image from the CURRENT folder, picked
   straight from currentFiles — so it ignores whatever is currently
   filtered out of the grid (an active tag gallery, a hidden tag, or
   the name filter) — any image physically in the folder can come up.

   The button's visibility is controlled by a checkbox in ⚙️ Settings
   ("Show Random Button"), persisted in the same IndexedDB settings
   record as the other toggles (see saveSettingsToDB/loadSettingsFromDB
   in gallery_core.js).
   ================================================================ */

/* Whether the feature is enabled via the ⚙️ Settings checkbox.
   Defaults to true the first time (before any setting is saved),
   matching the checkbox's own "checked" default in the HTML. */
function isRandomButtonEnabled() {
    const cb = document.getElementById('toggle-random-button');
    return cb ? cb.checked : true;
}

/* Called by updatePaginationControls() (gallery_core.js) every time it
   runs, so this button always follows the same lifecycle as the rest of
   that bar (loaded folder + grid mode), plus its own Settings checkbox.
   Returns true/false so the caller knows whether to keep the bar itself
   visible even when pagination isn't needed. */
function updateRandomButtonVisibility(inGridMode) {
    const btn = document.getElementById('btn-random');
    if (!btn) return false;

    const show = !!inGridMode && isRandomButtonEnabled();
    btn.style.display = show ? 'inline-block' : 'none';
    return show;
}

/* Called by the Settings checkbox's onchange. */
function toggleRandomButtonSetting() {
    saveSettingsToDB();
    if (typeof updatePaginationControls === 'function') updatePaginationControls();
}

/* ----------------------------------------------------------------
   THE PICKER ITSELF
   ---------------------------------------------------------------- */
function openRandomImage() {
    if (!currentHandle) { showAlert('Load a folder first.', 'warn'); return; }
    if (!currentFiles || currentFiles.length === 0) {
        showAlert('❌ No images in this folder.', 'warn');
        return;
    }

    const randomIndex = Math.floor(Math.random() * currentFiles.length);
    const fileItem = currentFiles[randomIndex];
    openDetailView(fileItem.url, fileItem.name);
}