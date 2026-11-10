/* =========================================================================
   NOTICE SYSTEM (Tag Manager) — Permanent bar / Temporary toast / CUSTOM
   ---------------------------------------------------------------------
   Two kinds of messages exist in the app:
     - NOTICES (sticky state): TM.notice.show(id, opts) / hide(id) / has(id)
       e.g. "You have unsaved changes", "Auto-Do modified ..."
     - ALERTS (one-shot messages): window.showAlert(text, type, duration)
       e.g. "Saved 3 file(s).", errors, warnings

   GLOBAL STYLE (⚙️ Settings > 🔔 Notifications > Style):
     Permanent bar     every notification is a row in the bar above the workspace
     Temporary toast   every notification is a toast at the bottom (one at a time)
     Custom            each notification uses ITS OWN style (see the manager)

   CUSTOM STYLE per notification:
     Permanent bar · Temporary toast · Bar + toast · Hidden
     Out of the box (nothing customized) Custom behaves like the original app:
     alerts -> toast, sticky notices -> bar.
     (2026-11) The global usage presets (all bar / all toast) were removed:
     Custom is always on. Module groups in the manager are collapsible and
     always start collapsed.

   MANAGER (⚙️ > 🔔 Notifications > 📋 Manage notifications…)
     All the notifications of the app are PRE-REGISTERED here (built-in
     catalog, grouped by module) — you do not have to wait for them to appear.
     Messages that only differ by numbers or names ("Saved 3 file(s)",
     "Saved 5 file(s)", Tag "x" accepted…) are ONE entry. Notifications that
     are not in the catalog yet are learned automatically when they appear
     (group "Other (learned)").
     Search, filter (customized / alerts / sticky notices / never seen /
     learned), group filter, bulk apply, ▶ preview, ↺ back to original,
     ✕ forget a learned entry.

   BAR: alerts sit below the sticky notices, newest first, identical ones are
     merged ("×3"), each has ×, "Clear all" with 2+ alerts. "Visible lines"
     = rows shown before the bar gets its own scroll.
   TOAST: one at a time, "Seconds per notification" each, then the next one
     by itself; click to skip. A sticky notice is shown once per change.
     The duration setting rules every toast (showAlert's `duration` is ignored).

   Settings saved: 'notice-mode' (permanent | temporary | custom),
   'notice-base-mode' (last non-custom style), 'notice-max-lines',
   'notice-seconds', 'notice-rules' (only customized / seen / learned entries).

   API (compatible with the old one):
     TM.notice.show(id, { text | html, theme, icon, order, dismissible, onDismiss })
     TM.notice.hide(id) / TM.notice.has(id)
     TM.notice.getMode() / setMode('permanent' | 'temporary' | 'custom')
     TM.notice.getRule(key) / setRule(key, 'permanent'|'temporary'|'both'|'off'|'original')
     TM.notice.openManager()

   window.showAlert is replaced here (loads after tagmanager_alert.js, which
   can stay loaded). Default alert type when none is given: 'success'.
   Must load after tagmanager_tm.js.
========================================================================= */

(function () {
    const TM = window.TM = window.TM || {};
    if (TM.notice && TM.notice.__hybrid) return;

    const THEMES = {
        warn:    { accent: '#ffd040', bg: '#101723', icon: '⚠️' },
        success: { accent: '#00ff99', bg: '#0d1f16', icon: '⚡' },
        error:   { accent: '#ff6060', bg: '#2a0000', icon: '❌' },
        info:    { accent: '#66ccff', bg: '#001a2a', icon: 'ℹ️' }
    };
    const ALERT_ICONS = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️' };
    const KEYS = { mode: 'notice-mode', base: 'notice-base-mode', lines: 'notice-max-lines', secs: 'notice-seconds', rules: 'notice-rules' };
    const DEFAULTS = { mode: 'permanent', lines: 3, seconds: 5 };
    const GLOBAL_MODES = ['permanent', 'temporary', 'custom'];
    const RULE_MODES = ['permanent', 'temporary', 'both', 'off'];
    const MODE_LABELS = { permanent: 'Permanent bar', temporary: 'Temporary toast', both: 'Bar + toast', off: 'Hidden', custom: 'Custom (per notification)' };
    const ALERT_ORDER_BASE = 100000;   // alert rows sit below the notices (order 0..99), newest first
    const MAX_ALERT_ROWS = 30;
    const MAX_LEARNED = 200;
    const GAP = 8;

    const cfg = { mode: 'custom', base: DEFAULTS.mode, lines: DEFAULTS.lines, seconds: DEFAULTS.seconds };
    const sticky = new Map();          // id -> { opts, sig, shown }
    let rules = {};                    // ruleKey -> { m?, s, t, k, g?, c?, n, ts }
    let alertSeq = 0;
    let rulesTimer = null;

    const esc = v => (typeof window.escHTML === 'function'
        ? window.escHTML(v)
        : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const clampNum = (v, lo, hi, fb) => { v = parseFloat(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb; };
    const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    function normType(t) {
        if (!t) return 'success';
        t = String(t).toLowerCase();
        if (t === 'warning') return 'warn';
        return THEMES[t] ? t : 'info';
    }

    /* =====================================================================
       MESSAGE PATTERNS + BUILT-IN CATALOG
       A message is reduced to a pattern: emojis removed, digits -> #,
       quoted names -> "…". The catalog templates use {n} = a number and
       {x} = any other text, and are reduced the same way, so the alerts of
       the app find their entry by themselves.
    ===================================================================== */
    const STRIP_RE = /[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu;
    function patternOf(text) {
        return String(text).replace(STRIP_RE, '').replace(/\s+/g, ' ').trim()
            .replace(/"[^"]*"/g, '"…"').replace(/“[^”]*”/g, '"…"')
            .replace(/\d+(?:[.,]\d+)?/g, '#');
    }
    const normTpl = tpl => patternOf(String(tpl).replace(/\{n\}/g, '0').replace(/\{x\}/g, '\u0001'));

    // [group, [[type, template], ...]]   (type omitted in the code = success)
    const CATALOG_RAW = [
        ['Archive', [
            ['error', `Permission denied for the root folder.`],
            ['success', `Rescan done 🔄 — moved {n} file(s) from {n} dataset archive folder(s), {n} image(s) newly managed.`],
            ['error', `⚠️ {n} file(s) were left in a dataset's "_archive" because a different file with the same name already exists in the global folder.`],
            ['error', `⚠️ {n} file(s) could not be moved (see console).`],
            ['error', `Error rescanning the global Archive: {x}`],
            ['error', `⚠️ Some files could not go back to their dataset (folder missing, name conflict or error), so the Archive stays GLOBAL. Moved {n} file(s). Fix it and run Convert to Local again.`],
            ['success', `Archive is LOCAL again — moved {n} file(s) back to their datasets.`],
            ['error', `Error converting the Archive to Local: {x}`],
            ['error', `This folder has no dataset subfolders — Global mode needs datasets one level below it.`],
            ['success', `Archive is now GLOBAL 🌐 — moved {n} file(s) from {n} archive folder(s).`],
            ['info', `{n} archived image(s) had no record — they are now managed by the global Archive.`],
            ['error', `Error converting the Archive to Global: {x}`],
            ['error', `❌ Could not archive "{x}": no folder handle available.`],
            ['success', `Archived {n} file(s) 📦 (kept in this same dataset folder).`],
            ['error', `⚠️ Could not archive {n} file(s): {x}`],
            ['error', `Permission denied for the original folder.`],
            ['success', `Restored the original "{x}". The version that was in the dataset moved to the Archive.`],
            ['error', `⚠️ Caption file(s) not restored: {x}`],
            ['success', `Restored "{x}" from the Archive.`],
            ['error', `Error restoring file — the original folder may no longer be accessible.`],
            ['success', `Restored {n} item(s) from the Archive ♻️`],
            ['error', `⚠️ Image restored but {n} caption file(s) stayed in "_archive": {x}`],
            ['error', `⚠️ Could not restore {n} item(s): {x}`],
            ['info', `"{x}" permanently deleted from the Archive.`],
            ['error', `Error deleting file from the Archive.`],
            ['info', `Removed {n} stale Archive entr{x} (file no longer in "_archive").`],
            ['error', `Could not load this image to pin.`],
            ['error', `Pin module not loaded.`],
            ['error', `The label "original" is reserved for original images.`],
            ['error', `Could not save the label.`]
        ]],
        ['Auto-Caption', [
            ['error', `Could not connect to Ollama.`],
            ['error', `Your browser does not support Directory Selection. Use Chrome or Edge.`],
            ['error', `Error opening directory: {x}`],
            ['success', `Tagger models loaded successfully.`],
            ['warn', `Warning: .csv file not found for this model.`],
            ['warn', `Warning: .csv file not found for the second model.`],
            ['success', `Created {n} empty files.`],
            ['warn', `WebGPU not supported. Forcing CPU WASM.`],
            ['warn', `WebGPU failed. Forcing CPU WASM.`],
            ['warn', `Canceling process... Please wait for the current image.`],
            ['info', `🔁 Scanning all subfolders recursively... this can take a moment for big franchise folders.`],
            ['error', `Error scanning subfolders recursively. Check the console.`],
            ['error', `🔁 Scanned {n} folder(s) starting from "{x}", but found 0 images inside. Make sure the images are directly inside the character subfolders (.png/.jpg/.jpeg/.webp).`],
            ['info', `🔁 Found {n} image(s) across {n} folder(s). Starting batch...`],
            ['error', `No images found recursively in this folder.`],
            ['error', `No images or folder loaded.`],
            ['error', `"Skip captioned" cannot be used together with Review Mode. Turn one of them off.`],
            ['info', `⏭️ Skip captioned: all {n} image(s) already have a caption. Nothing to do.`],
            ['info', `⏭️ Skipping {n} captioned image(s). Processing {n}.`],
            ['error', `ONNX Runtime did not load (no network access to the CDN?). Reload the page and try again.`],
            ['error', `Please select a valid Tagger model.`],
            ['error', `Second Model Review is on, but no second tagger model is selected.`],
            ['error', `Second model selection is invalid. Set the taggers folder again.`],
            ['error', `Second model has no .csv tags file.`],
            ['error', `Select an Ollama vision model first (press 🔄 Refresh Models).`],
            ['error', `PyTorch mode is only available on localhost (start the app with the .bat file).`],
            ['error', `The Natural Language engine did not load (tagmanager_batch_vlm.js / prompt_helper_florence_webgpu.js). Reload the page and try again.`],
            ['warn', `⚠️ Review Mode isn't supported together with Recursive Mode — saving tags directly to disk instead.`],
            ['error', `Write permission denied. Cannot save files.`],
            ['info', `Loading {x}... this might take a while.`],
            ['info', `Loading second model {x}... this might take a while.`],
            ['info', `Batch process canceled by user.`],
            ['info', `Preparing the model... the first run may need a download.`],
            ['error', `Could not load the model: {x}`],
            ['error', `Model error: {x} — batch stopped.`],
            ['error', `Ollama error: {x} — batch stopped.`],
            ['warn', `Batch finished, but {n} image(s) failed and were skipped (existing captions untouched). Check the console.`],
            ['success', `Batch processing complete!`],
            ['error', `Critical error. Check the console.`],
            ['info', `Suggestions generated! Review the ghost tags (💡) and accept the ones you want.`],
            ['error', `Auto-Caption model action failed. {x}`],
            ['success', `Hugging Face token saved.`],
            ['success', `Hugging Face token removed.`],
            ['error', `Token not saved: {x}`],
            ['error', `Dependency check failed: {x}`],
            ['error', `Update failed: {x}`],
            ['info', `Updating... a console window opened. Waiting for the server to come back.`],
            ['success', `Server is back. Reload the model to use the new versions.`],
            ['warn', `The server did not come back yet. Check the console window it opened.`],
            ['success', `Model unloaded from memory.`],
            ['info', `No model is loaded in memory.`],
            ['success', `Model files deleted.`],
            ['info', `Nothing to delete (already clean).`]
        ]],
        ['Assistant', [
            ['info', `Select image(s) in the list first.`],
            ['warn', `Max {n} images per message.`],
            ['info', `Select image(s) in the list to add "{x}" (Ctrl+click copies it).`],
            ['success', `Added "{x}" to {n} image(s).`],
            ['info', `Asking again without the images (they are not kept) — attach them again if needed.`],
            ['success', `Copied.`]
        ]],
        ['Backup & import', [
            ['success', `Backup exported ({n} presets, {n} settings{x} · {x} MB).`],
            ['error', `Error exporting backup: {x}`],
            ['error', `This file is not valid JSON — is it a Tag Manager backup?`],
            ['error', `This file is not a Tag Manager backup (no presets / settings inside).`],
            ['warn', `This backup was made by a newer version — unknown items are skipped.`],
            ['info', `Nothing selected.`],
            ['error', `Import failed: {x}`],
            ['success', `Imported {x}setting(s){x}. Reloading…`],
            ['warn', `This feature is available only on Local Mode.`],
            ['success', `Import complete! Merged {n} settings and {n} presets. Web database cleared.`],
            ['error', `Error merging data.`]
        ]],
        ['Clean & duplicates', [
            ['error', `Error scanning the folder. Check the console.`],
            ['success', `Dataset is clean: no orphan .txt/.json files found.`],
            ['success', `Deleted {n} orphan file(s). 🧹`],
            ['warn', `Deleted {n} file(s); {n} failed (see console).`],
            ['error', `Could not read the folder to check for existing names. Nothing was changed.`],
            ['info', `No duplicate names found.`],
            ['success', `Fixed {n} duplicate name(s).`],
            ['warn', `Fixed {n}, but {n} file(s) could not be renamed. Nothing was lost — check the console for details.`]
        ]],
        ['Evaluator', [
            ['info', `This image changed after the evaluation — evaluate it again.`],
            ['success', `📊 Dataset review of "{x}" ready — {n}/{n}. Hover the image counter next to "Dataset".`],
            ['error', `Could not write the dataset review: {x}`],
            ['error', `Evaluator stopped: 3 failures in a row. Check the URL / model (must support images) / CORS. {x}`],
            ['success', `Evaluator: {n} image(s) scored{x}. Hover a score on the list to read the comment.`],
            ['success', `📋 Dataset list finished: {n} dataset(s) evaluated{x}.`],
            ['error', `Dataset list stopped: 3 datasets failed in a row. {x}`],
            ['warn', `Pick a vision model in 🧐 first.`],
            ['info', `Another dataset is being evaluated — wait for it or stop it in 🧐.`],
            ['warn', `Pick a vision model first (🔄 loads the list).`],
            ['warn', `Select at least one image (or change the scope).`],
            ['warn', `No images to evaluate.`],
            ['info', `No scores to clear in this scope.`],
            ['warn', `Open a dataset first.`],
            ['warn', `Max {n} bases — each one is sent with every image.`],
            ['error', `Could not describe the style: {x}`],
            ['info', `This dataset is already in the list.`],
            ['success', `📋 "{x}" added to the list.`],
            ['warn', `📋 "{x}" added — this folder is not in your saved folders, so it stays in the list only until you reload (💾 save the folder to keep it).`],
            ['info', `🧐 Evaluation of "{x}" stopped: dataset changed ({n}/{n} done — scores so far are saved). Turn on "Keep evaluating in the background" to keep it running.`]
        ]],
        ['Folders', [
            ['error', `Permission error.`],
            ['success', `Folder added to saved list!`],
            ['success', `Folder added to saved list as "{x}" (another saved folder has the same name).`],
            ['info', `Folder removed from saved list.`],
            ['error', `Error updating list: {x}`],
            ['success', `Refreshed! {n} images loaded.`],
            ['error', `Error loading folder: {x}`],
            ['error', `Error loading subfolder: {x}`]
        ]],
        ['NL tools', [
            ['success', `🧬 Merged {n} tag(s) into NL in {n} image(s){x}. Remember to save.`],
            ['info', `🧹 NL Manager: {n} caption file(s) cleaned / updated on disk{x}.`],
            ['warn', `⚠️ NL Manager: {n} image(s) have an NL that could not be found anymore (first/last word changed). Check the console for the list.`],
            ['success', `🧹 Removed the commas from {n} NL caption(s) in {n} image(s). Remember to save.`]
        ]],
        ['Pin & removed history', [
            ['success', `📌 Pinned "{x}"`],
            ['warn', `Select an active image first!`],
            ['success', `Added {n} tag(s) from the pinned image.`],
            ['success', `Added {n} tag(s) to all images.`],
            ['warn', `None of the original images were found (or they already have the tag).`],
            ['success', `Restored "{x}" on {n} image(s). Remember to save.`],
            ['warn', `Select at least one image in the list first.`],
            ['success', `Added "{x}" to {n} selected image(s).`]
        ]],
        ['Saving, rename & list', [
            ['error', `❌ Could not save "{x}": no folder handle.`],
            ['error', `❌ Write permission denied for "{x}".`],
            ['error', `❌ Failed to save "{x}".`],
            ['success', `Saved {n} file(s) with pending changes.`],
            ['success', `No pending changes to save in the current selection.`],
            ['success', `No pending changes to save.`],
            ['success', `Hid {n} image(s). Use 👁️‍🗨️ Unhide to restore.`],
            ['warn', `Select at least one image first!`],
            ['success', `Focus mode: hid {n} other image(s). Use 👁️‍🗨️ Unhide to restore.`],
            ['error', `The name contains characters that are not allowed in file names: \\ / : * ? " < > |`],
            ['error', `Two selected images would get the same name "{x}". Nothing was renamed.`],
            ['error', `⚠️ Could not back up "{x}" before renaming. Nothing was renamed or deleted.`],
            ['error', `⚠️ {n} file(s) could not be renamed — the originals are safely kept in the "_rename_cache" folder, nothing was lost.`],
            ['success', `Renamed {n} files!`],
            ['success', `Cloned {n} file(s)!`],
            ['error', `Write permission denied.`],
            ['warn', `No folder loaded.`],
            ['success', `Converted {n} file(s) to .{x}.`],
            ['success', `Configuration saved to catalog!`]
        ]],
        ['Tag editing', [
            ['success', `Tag "{x}" saved to Presets!`],
            ['info', `Converted "{x}" to ghost in {n} image(s).`],
            ['info', `Converted "{x}" to ghost in {n} image(s) (whole dataset).`],
            ['success', `Tag "{x}" accepted on {n} image(s).`],
            ['error', `No images selected.`],
            ['success', `Added {n} tags to {n} image(s).`],
            ['success', `Removed tags from {n} image(s).`],
            ['warn', `Tag "{x}" not found as a regular tag in this dataset.`],
            ['info', `Rejected "{x}" on {n} image(s).`],
            ['warn', `Select a tag first!`],
            ['warn', `Tag(s) "{x}" not found.`],
            ['success', `Tag(s) replaced in {n} image(s).`],
            ['success', `Pending suggestions discarded for the selected image(s).`],
            ['success', `All pending suggestions discarded.`],
            ['warn', `Tag "{x}" not found in this dataset.`],
            ['success', `Converted {x}tag "{x}" ➜ "{x}" in {n} image(s).`]
        ]],
        ['Tag Interrogator', [
            ['error', `Error translating.`],
            ['info', `Wiki text: OFF — new wikis are not saved (texts already in the file stay).`],
            ['info', `💾 Wiki text: SHORT — the first 800 characters of each wiki are saved in wiki_full.json.`],
            ['info', `💾 Wiki text: FULL — complete wikis (text + links) are saved in wiki_full.json (a scan or 📚 Fill wiki completes the tags that only have the summary).`],
            ['info', `🤖 Auto-fill when idle ON — while the app has nothing to do it fills in missing info and adds new tags from the sites, in small batches.`],
            ['info', `🤖 Auto-fill when idle OFF.`],
            ['warn', `Enable e621 in the Tag Interrogator settings first.`],
            ['warn', `Tag Interrogator is disabled in Settings.`],
            ['warn', `Set 💾 Wiki text to Short or Full first (localhost only).`],
            ['info', `A scan is already running.`],
            ['warn', `local/wiki_full.json could not be read, so nothing was changed. Check that the localhost server is running.`],
            ['info', `Fill wiki{x}: {n} description(s) moved to wiki_full.json. Nothing else to update — every saved tag with a wiki has its text and it is up to date.`],
            ['success', `Recursive Fill wiki{x} complete: {n} description(s) moved to wiki_full.json, {n} new tag(s) added from wiki links (Danbooru {n}, e621 {n}).`],
            ['success', `Fill wiki{x} complete: {n} description(s) moved to wiki_full.json, {n} of {n} wiki text(s) downloaded/updated.`],
            ['warn', `Load a dataset with tags first!`],
            ['info', `No tags to scan in this dataset.`],
            ['success', `Scan complete! Found wiki info for {n} tag(s) on Danbooru{x}.`],
            ['info', `No unknown tags to recheck.`],
            ['success', `Recheck finished — {x}.`],
            ['info', `All dataset tags are up to date in cache!`]
        ]]
    ];

    const CAT = [];
    CATALOG_RAW.forEach(([g, items]) => items.forEach(([t, tpl]) => {
        const norm = normTpl(tpl);
        const key = 'a|' + norm.replace(/\u0001/g, '*');
        if (CAT.some(c => c.key === key)) return;
        const wild = norm.includes('\u0001');
        CAT.push({
            key, g, t, norm, wild,
            s: tpl.replace(/\{n\}/g, '#').replace(/\{x\}/g, '…'),
            lit: norm.replace(/\u0001/g, '').length,
            re: wild ? new RegExp('^' + norm.split('\u0001').map(escapeRe).join('.*') + '$') : null
        });
    }));
    const CAT_WILD = CAT.filter(c => c.wild).sort((a, b) => b.lit - a.lit);   // most specific first
    const CAT_BY_KEY = new Map(CAT.map(c => [c.key, c]));
    const CAT_NOTICES = [{ key: 'n|unsaved-changes-alert', g: 'Sticky notices', t: 'warn', s: 'You have unsaved changes — remember to save' }];

    // Rule key of a message: its catalog entry, or its own pattern (learned).
    function alertRuleKey(text) {
        const norm = patternOf(text);
        const exact = 'a|' + norm;
        if (rules[exact] || CAT_BY_KEY.has(exact)) return exact;
        for (const c of CAT_WILD) if (c.re.test(norm)) return c.key;
        return 'a|' + norm.slice(0, 200);
    }
    const noticeKey = id => 'n|' + id;
    const plain = html => String(html == null ? '' : html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    function seedRules() {
        const out = {};
        CAT.forEach(c => { out[c.key] = { s: c.s, t: c.t, k: 'alert', g: c.g, c: 1, n: 0, ts: 0 }; });
        CAT_NOTICES.forEach(c => { out[c.key] = { s: c.s, t: c.t, k: 'notice', g: c.g, c: 1, n: 0, ts: 0 }; });
        return out;
    }
    rules = seedRules();

    /* ---------- RULES: which style does each notification use ---------- */
    const wantsBar = m => m === 'permanent' || m === 'both';
    const wantsToast = m => m === 'temporary' || m === 'both';
    const validMode = m => RULE_MODES.includes(m);
    const originalMode = r => (r && r.k === 'notice') ? 'permanent' : 'temporary';   // what the app did before this system
    const isCustomized = r => validMode(r.m) && r.m !== originalMode(r);
    function effective(ruleKey) {
        // Custom is the only style now: every notification uses its own rule.
        const r = rules[ruleKey];
        return validMode(r && r.m) ? r.m : originalMode(r);
    }

    function serializeRules() {
        const out = {};
        Object.keys(rules).forEach(k => {
            const r = rules[k];
            if (r.c) { if (!validMode(r.m) && !r.n) return; out[k] = { m: validMode(r.m) ? r.m : undefined, n: r.n, ts: r.ts, c: 1 }; }
            else out[k] = r;
        });
        return out;
    }
    function scheduleSaveRules() {
        clearTimeout(rulesTimer);
        rulesTimer = setTimeout(() => {
            rulesTimer = null;
            if (typeof window.saveSetting === 'function') window.saveSetting(KEYS.rules, serializeRules());
        }, 1000);
    }

    function pruneLearned() {
        const learned = Object.keys(rules).filter(k => !rules[k].c && !validMode(rules[k].m));
        if (learned.length <= MAX_LEARNED) return;
        learned.sort((a, b) => (rules[a].ts || 0) - (rules[b].ts || 0)).slice(0, learned.length - MAX_LEARNED).forEach(k => { delete rules[k]; });
    }

    function learn(key, sample, type, kind) {
        let r = rules[key];
        if (!r) { r = rules[key] = { s: '', t: type, k: kind, n: 0, ts: 0 }; pruneLearned(); }
        if (!r.c) { r.s = String(sample).slice(0, 160); r.t = type; r.k = kind; }
        r.n = (r.n || 0) + 1;
        r.ts = Date.now();
        scheduleSaveRules();
        return r;
    }

    /* ---------- STYLES ---------- */
    const style = document.createElement('style');
    style.textContent = `
        #tm-notice-stack { display: flex; flex-direction: column; gap: ${GAP}px; margin: 12px 20px 0 20px; flex-shrink: 0; }
        #tm-notice-stack:empty { display: none; }
        .tm-notice { position: relative; padding: 10px 14px; color: #f5f5f5; border-radius: 7px; font-size: 13.5px; line-height: 1.45; text-align: center; box-sizing: border-box; border-left: 3px solid var(--tm-notice-accent); border-right: 3px solid var(--tm-notice-accent); background: var(--tm-notice-bg); flex-shrink: 0; }
        .tm-notice-icon { color: var(--tm-notice-accent); margin: 0 6px; font-size: 14px; line-height: 1; }
        .tm-notice-close { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: var(--tm-notice-accent); font-size: 16px; font-weight: bold; cursor: pointer; padding: 0 6px; line-height: 1; }
        .tm-notice-count { margin-left: 8px; font-size: 11px; font-weight: bold; color: var(--tm-notice-accent); }
        #tm-notice-tools { position: sticky; top: 0; z-index: 2; order: -1000; display: flex; justify-content: flex-end; align-items: center; gap: 10px; font-size: 11px; color: #888; background: #111; padding: 2px 0; flex-shrink: 0; }
        #tm-notice-tools button { background: #1b1b1b; color: #aaa; border: 1px solid #333; border-radius: 5px; padding: 3px 9px; font-size: 11px; font-weight: bold; cursor: pointer; }
        #tm-notice-tools button:hover { background: #4a1118; color: #ffb6c0; border-color: #7a222c; }
        #alertBar { cursor: pointer; }
        #alertBar .tm-toast-more { opacity: 0.7; font-size: 10px; margin-left: 6px; }
        #settings-notice-group { display: flex; flex-direction: column; gap: 10px; }
        #settings-notice-group select { max-width: 160px; }

        #modal-notice-rules .tool-modal { width: 800px; max-width: 94vw; max-height: 90vh; }
        #nm-desc { font-size: 11px; color: #888; line-height: 1.5; }
        .nm-enable { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #1a1230; border: 1px solid #3a2570; border-radius: 8px; padding: 8px 12px; }
        .nm-enable label { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: bold; color: #d4b8ff; cursor: pointer; user-select: none; }
        .nm-enable input[type=checkbox] { width: auto; margin: 0; accent-color: #b890ff; }
        #nm-enable-hint { font-size: 11px; color: #8a78b8; }
        .nm-bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .nm-bar input[type=text] { flex: 1 1 160px; min-width: 0; }
        .nm-bar select { font-size: 12px; max-width: 190px; }
        .nm-btn { background: #151515; border: 1px solid #444; color: #bbb; border-radius: 5px; padding: 6px 10px; font-size: 11px; font-weight: bold; cursor: pointer; white-space: nowrap; }
        .nm-btn:hover { color: #fff; border-color: #888; background: #222; }
        .nm-btn.danger:hover { background: #4a1118; color: #ffb6c0; border-color: #7a222c; }
        #nm-list { max-height: 46vh; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; background: #111; border: 1px solid #333; border-radius: 6px; padding: 6px; transition: opacity .15s; }
        #nm-list.off { opacity: 0.55; }
        .nm-group { cursor: pointer; user-select: none; }
        .nm-group:hover { color: #8fd4ff; }
        .nm-group { position: sticky; top: -6px; z-index: 1; background: #111; font-size: 10px; font-weight: bold; color: #4db8ff; text-transform: uppercase; letter-spacing: .6px; padding: 6px 4px 3px; border-bottom: 1px solid #222; }
        .nm-row { display: flex; align-items: center; gap: 8px; background: #151515; border: 1px solid #2a2a2a; border-left: 3px solid var(--nm-accent, #444); border-radius: 6px; padding: 5px 8px; }
        .nm-row.custom { background: #101a14; border-color: #1f4a30; border-left-color: var(--nm-accent, #00aa66); }
        .nm-ico { flex-shrink: 0; width: 20px; text-align: center; }
        .nm-txt { flex: 1; min-width: 0; }
        .nm-sample { font-size: 12px; color: #ddd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .nm-meta { font-size: 10px; color: #777; margin-top: 2px; }
        .nm-meta .nm-tag { color: #b890ff; font-weight: bold; }
        .nm-row select { flex-shrink: 0; width: 150px; font-size: 11px; padding: 4px 6px; }
        .nm-icon-btn { flex-shrink: 0; background: transparent; border: 1px solid #333; color: #888; border-radius: 4px; padding: 3px 7px; font-size: 11px; cursor: pointer; }
        .nm-icon-btn:hover { color: #fff; border-color: #888; }
        .nm-icon-btn.del:hover { color: #ff6060; border-color: #7a222c; }
        .nm-empty { color: #555; font-size: 12px; text-align: center; padding: 22px 10px; }
    `;
    document.head.appendChild(style);

    /* =====================================================================
       BAR (rows in the stack)
    ===================================================================== */
    function getStack() {
        let stack = document.getElementById('tm-notice-stack');
        if (stack) return stack;
        stack = document.createElement('div');
        stack.id = 'tm-notice-stack';
        const workspace = document.getElementById('workspace');
        if (workspace && workspace.parentNode) workspace.parentNode.insertBefore(stack, workspace);
        else document.body.appendChild(stack);
        return stack;
    }

    const rowsOf = stack => Array.from(stack.querySelectorAll(':scope > .tm-notice'));
    const alertRows = stack => rowsOf(stack).filter(e => e.dataset.kind === 'alert');

    function applyTheme(el, theme, order) {
        el.style.setProperty('--tm-notice-accent', theme.accent);
        el.style.setProperty('--tm-notice-bg', theme.bg);
        el.style.order = Number.isFinite(order) ? order : 0;
    }

    function renderRow(id, opts) {
        const theme = THEMES[opts.theme] || THEMES.warn;
        const stack = getStack();
        let el = document.getElementById(id);
        if (!el || el.parentNode !== stack) {
            el = document.createElement('div');
            el.id = id;
            el.className = 'tm-notice';
            stack.appendChild(el);
        }
        el.dataset.kind = 'notice';
        applyTheme(el, theme, opts.order);

        const icon = `<span class="tm-notice-icon">${opts.icon || theme.icon}</span>`;
        const body = opts.html !== undefined ? opts.html : esc(opts.text === undefined ? '' : opts.text);
        el.innerHTML = `${icon}${body}${icon}` + (opts.dismissible ? '<button class="tm-notice-close" title="Dismiss this notice">&times;</button>' : '');

        if (opts.dismissible) {
            el.querySelector('.tm-notice-close').onclick = () => {
                TM.notice.hide(id);
                if (typeof opts.onDismiss === 'function') opts.onDismiss();
            };
        }
        return el;
    }

    function removeRow(id) {
        const el = document.getElementById(id);
        if (el && el.classList.contains('tm-notice')) el.remove();
    }

    function addAlertRow(text, type, rkey) {
        const stack = getStack();
        const theme = THEMES[type];
        const key = type + '|' + text;
        let el = alertRows(stack).find(e => e.dataset.key === key);
        let count = 1;
        if (el) count = (parseInt(el.dataset.count, 10) || 1) + 1;
        else {
            el = document.createElement('div');
            el.className = 'tm-notice';
            el.dataset.kind = 'alert';
            el.dataset.key = key;
            stack.appendChild(el);
        }
        el.dataset.rule = rkey;
        el.dataset.count = String(count);
        applyTheme(el, theme, ALERT_ORDER_BASE - (++alertSeq));   // newest first

        const icon = `<span class="tm-notice-icon">${ALERT_ICONS[type]}</span>`;
        el.innerHTML = `${icon}${esc(text)}${count > 1 ? `<span class="tm-notice-count">×${count}</span>` : ''}${icon}<button class="tm-notice-close" title="Dismiss">&times;</button>`;
        el.querySelector('.tm-notice-close').onclick = () => { el.remove(); updateTools(); layout(); };

        // Bounded list: drop the oldest alerts (highest order).
        const rows = alertRows(stack).sort((a, b) => (+b.style.order) - (+a.style.order));
        while (rows.length > MAX_ALERT_ROWS) rows.shift().remove();

        updateTools();
        layout();
        try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
    }

    // "Clear all" appears only when there are 2+ alert rows.
    function updateTools() {
        const stack = document.getElementById('tm-notice-stack');
        if (!stack) return;
        const n = alertRows(stack).length;
        let tools = stack.querySelector(':scope > #tm-notice-tools');
        if (n < 2) { if (tools) tools.remove(); return; }
        if (!tools) {
            tools = document.createElement('div');
            tools.id = 'tm-notice-tools';
            tools.innerHTML = '<span></span><button title="Dismiss all alert messages (sticky notices stay)">🧹 Clear all</button>';
            tools.querySelector('button').onclick = () => {
                alertRows(stack).forEach(e => e.remove());
                updateTools(); layout();
            };
            stack.insertBefore(tools, stack.firstChild);
        }
        tools.querySelector('span').textContent = `${n} notifications`;
    }

    // Height of the bar = the first N rows (N = "Visible lines"); more rows -> internal scroll.
    function layout() {
        const stack = document.getElementById('tm-notice-stack');
        if (!stack) return;
        const rows = rowsOf(stack).sort((a, b) => (+a.style.order || 0) - (+b.style.order || 0));
        if (rows.length <= cfg.lines) { stack.style.maxHeight = ''; stack.style.overflowY = ''; return; }
        const tools = stack.querySelector(':scope > #tm-notice-tools');
        let h = tools ? tools.offsetHeight + GAP : 0;
        rows.slice(0, cfg.lines).forEach((r, i) => { h += r.offsetHeight + (i ? GAP : 0); });
        stack.style.maxHeight = h + 'px';
        stack.style.overflowY = 'auto';
    }
    window.addEventListener('resize', layout);

    /* =====================================================================
       TOAST (one at a time, queue)
    ===================================================================== */
    const queue = [];          // { id?, key?, rule, type, html, icon }
    let current = null;
    let busy = false;
    let timer = null;

    function getBar() {
        let bar = document.getElementById('alertBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'alertBar';
            document.body.appendChild(bar);
        }
        if (!bar.__tmToastBound) {
            bar.__tmToastBound = true;
            bar.title = 'Click to skip to the next notification';
            bar.addEventListener('click', () => finishToast());
        }
        return bar;
    }

    const sameItem = (a, b) => (a.id && a.id === b.id) || (!a.id && !b.id && a.key === b.key);

    function updateBadge() {
        const bar = document.getElementById('alertBar');
        const el = bar && bar.querySelector('.tm-toast-more');
        if (el) el.textContent = queue.length ? `(+${queue.length})` : '';
    }

    function paintToast(item) {
        const bar = getBar();
        bar.className = item.type;                 // error / success / warn / info (CSS of #alertBar)
        bar.innerHTML = `${item.icon ? item.icon + ' ' : ''}${item.html}<span class="tm-toast-more"></span>`;
        updateBadge();
    }

    function startTimer() {
        clearTimeout(timer);
        timer = setTimeout(finishToast, Math.round(cfg.seconds * 1000));
    }

    function pump() {
        if (busy || !queue.length) return;
        busy = true;
        current = queue.shift();
        paintToast(current);
        startTimer();
    }

    function finishToast() {
        if (!current) return;
        clearTimeout(timer);
        current = null;
        const bar = document.getElementById('alertBar');
        if (bar) { bar.className = ''; bar.innerHTML = ''; }
        setTimeout(() => { busy = false; pump(); }, 150);   // short gap so the change is noticeable
    }

    function enqueueToast(item) {
        if (current && sameItem(current, item)) {          // same message already on screen: refresh it
            current = Object.assign(current, item);
            paintToast(current);
            startTimer();
            return;
        }
        const i = queue.findIndex(q => sameItem(q, item));
        if (i >= 0) { queue[i] = item; updateBadge(); return; }
        queue.push(item);
        updateBadge();
        pump();
    }

    function dropQueuedNotice(id) {
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id === id) queue.splice(i, 1);
        if (current && current.id === id) finishToast(); else updateBadge();
    }

    function noticeToast(id, s) {
        const theme = THEMES[s.opts.theme] || THEMES.warn;
        const html = s.opts.html !== undefined ? s.opts.html : esc(s.opts.text === undefined ? '' : s.opts.text);
        return { id, rule: noticeKey(id), type: THEMES[s.opts.theme] ? s.opts.theme : 'warn', html, icon: s.opts.icon || theme.icon };
    }

    /* =====================================================================
       APPLYING THE STYLE OF EACH NOTIFICATION
    ===================================================================== */
    function applySticky(id, s) {
        const eff = effective(noticeKey(id));
        if (wantsBar(eff)) renderRow(id, s.opts); else removeRow(id);
        if (wantsToast(eff)) {
            if (!s.shown) { s.shown = true; enqueueToast(noticeToast(id, s)); }
        } else {
            s.shown = false;
            dropQueuedNotice(id);
        }
    }

    // Re-checks everything after a rule / style change.
    function reconcile() {
        const stack = document.getElementById('tm-notice-stack');
        if (stack) alertRows(stack).forEach(e => { if (!wantsBar(effective(e.dataset.rule))) e.remove(); });
        for (let i = queue.length - 1; i >= 0; i--) if (!wantsToast(effective(queue[i].rule))) queue.splice(i, 1);
        if (current && !wantsToast(effective(current.rule))) finishToast();
        sticky.forEach((s, id) => applySticky(id, s));
        updateTools();
        layout();
        updateBadge();
    }

    function dispatchAlert(text, type, learnIt) {
        const rkey = alertRuleKey(text);
        if (learnIt) learn(rkey, text, type, 'alert');
        else if (!rules[rkey]) learn(rkey, text, type, 'alert');
        const eff = effective(rkey);
        if (wantsBar(eff)) addAlertRow(text, type, rkey);
        if (wantsToast(eff)) enqueueToast({ key: type + '|' + text, rule: rkey, type, html: esc(text), icon: ALERT_ICONS[type] });
    }

    /* =====================================================================
       PUBLIC API
    ===================================================================== */
    TM.notice = {
        __hybrid: true,

        show(id, opts = {}) {
            const sig = JSON.stringify([opts.text, opts.html, opts.theme, opts.icon]);
            const prev = sticky.get(id);
            const s = { opts, sig, shown: !!(prev && prev.sig === sig && prev.shown) };
            sticky.set(id, s);
            learn(noticeKey(id), opts.html !== undefined ? plain(opts.html) : (opts.text || id), THEMES[opts.theme] ? opts.theme : 'warn', 'notice');
            applySticky(id, s);
            layout();
            return document.getElementById(id) || getBar();
        },

        hide(id) {
            sticky.delete(id);
            removeRow(id);
            dropQueuedNotice(id);
            updateTools();
            layout();
        },

        has(id) { return sticky.has(id); },

        getMode() { return cfg.mode; },
        setMode(mode, save) { setGlobalMode(mode, save !== false); },

        getRule(key) { return effective(key); },
        setRule(key, mode, save) { setRule(key, mode, save !== false); },
        openManager() { openManager(); }
    };

    function showAlert(msg, type /*, duration (ignored: the setting rules) */) {
        const text = String(msg == null ? '' : msg);
        if (!text) return;
        dispatchAlert(text, normType(type), true);
    }
    showAlert.__unified = true;
    window.showAlert = showAlert;

    function setGlobalMode(mode, save) {
        cfg.mode = 'custom';   // usage presets (permanent / temporary) were removed: Custom only
        sticky.forEach(s => { s.shown = false; });     // sticky notices are re-shown in the new style
        reconcile();
        syncSettingsUI();
        refreshManager();
        if (save && typeof window.saveSetting === 'function') {
            window.saveSetting(KEYS.mode, 'custom');
        }
    }

    function setRule(key, mode, save) {
        const r = rules[key];
        if (!r) return;
        if (validMode(mode)) r.m = mode; else delete r.m;     // 'original' / anything else = back to the original style
        if (key.startsWith('n|')) { const s = sticky.get(key.slice(2)); if (s) s.shown = false; }
        reconcile();
        if (save) scheduleSaveRules();
    }

    /* =====================================================================
       MANAGER POPOUT
    ===================================================================== */
    const groupOf = r => r.g || (r.k === 'notice' ? 'Sticky notices' : 'Other (learned)');

    function buildManager() {
        if (document.getElementById('modal-notice-rules')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-notice-rules';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-notice-rules');
        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🔔 Manage notifications</span>
                    <button onclick="window.closeModal('modal-notice-rules')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div id="nm-desc">All the notifications of the app are listed here. Choose how each one is displayed: <b>permanent bar</b>, <b>temporary toast</b>, <b>both</b> or <b>hidden</b>. Untouched entries keep the original behavior (alerts → toast, sticky notices → bar). Messages that only differ by numbers or names are one entry; notifications not in the list yet are added automatically when they appear.</div>
                <div class="nm-bar">
                    <input type="text" id="nm-search" placeholder="🔍 Filter notifications...">
                    <select id="nm-group" title="Module"></select>
                    <select id="nm-filter" title="Which entries to list">
                        <option value="all">All</option>
                        <option value="custom">Customized only</option>
                        <option value="alert">Alerts (one-shot)</option>
                        <option value="notice">Sticky notices</option>
                        <option value="unseen">Never seen yet</option>
                        <option value="learned">Learned (not built-in)</option>
                    </select>
                    <button class="nm-btn" id="nm-refresh" title="Reload the list (counters, new notifications)">↻</button>
                    <button class="nm-btn" id="nm-expand-all" title="Expand every module">▾ Expand all</button>
                    <button class="nm-btn" id="nm-collapse-all" title="Collapse every module">▸ Collapse all</button>
                </div>
                <div class="nm-bar">
                    <span style="font-size:11px; color:#888;">Set all shown to:</span>
                    <select id="nm-bulk"></select>
                    <button class="nm-btn" id="nm-bulk-apply">Apply</button>
                    <span style="flex:1;"></span>
                    <button class="nm-btn" id="nm-reset" title="Every notification goes back to its original style">↺ Reset all to original</button>
                    <button class="nm-btn danger" id="nm-forget" title="Remove the learned (not built-in) entries from the list; they come back if they appear again">🗑️ Forget learned</button>
                </div>
                <div id="nm-list"></div>
                <div class="modal-buttons">
                    <button class="btn-cancel" onclick="window.closeModal('modal-notice-rules')">Close</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        document.getElementById('nm-expand-all').onclick = () => { nmCollapsed.clear(); nmAllCollapsed = false; renderManager(); };
        document.getElementById('nm-collapse-all').onclick = () => { nmCollapsed.clear(); nmAllCollapsed = true; renderManager(); };
        document.getElementById('nm-search').oninput = renderManager;
        document.getElementById('nm-group').onchange = renderManager;
        document.getElementById('nm-filter').onchange = renderManager;
        document.getElementById('nm-refresh').onclick = renderManager;
        document.getElementById('nm-bulk-apply').onclick = () => {
            const mode = document.getElementById('nm-bulk').value;
            const keys = visibleEntries();
            if (!keys.length) return;
            keys.forEach(k => { if (validMode(mode)) rules[k].m = mode; else delete rules[k].m; });
            sticky.forEach(s => { s.shown = false; });
            reconcile(); scheduleSaveRules(); renderManager();
        };
        document.getElementById('nm-reset').onclick = () => {
            if (!confirm('Reset every notification to its original style (alerts → toast, sticky notices → bar)?')) return;
            Object.keys(rules).forEach(k => { delete rules[k].m; });
            sticky.forEach(s => { s.shown = false; });
            reconcile(); scheduleSaveRules(); renderManager();
        };
        document.getElementById('nm-forget').onclick = () => {
            const del = Object.keys(rules).filter(k => !rules[k].c);
            if (!del.length) { if (window.showAlert) window.showAlert('No learned entries to forget.', 'info'); return; }
            if (!confirm(`Remove ${del.length} learned entr${del.length === 1 ? 'y' : 'ies'} (including their custom styles) from the list?`)) return;
            del.forEach(k => { delete rules[k]; });
            scheduleSaveRules(); renderManager();
        };
        const list = document.getElementById('nm-list');
        list.addEventListener('change', e => {
            const sel = e.target.closest('.nm-sel');
            if (!sel) return;
            const row = sel.closest('.nm-row');
            setRule(row.dataset.key, sel.value, true);
            renderManager();
        });
        list.addEventListener('click', e => {
            const head = e.target.closest('.nm-group');
            if (head) {
                const g = head.dataset.group;
                const isCol = nmIsCollapsed(g);
                // nmCollapsed holds the groups whose state differs from the "all" default
                if (isCol === nmAllCollapsed) nmCollapsed.add(g); else nmCollapsed.delete(g);
                renderManager();
                return;
            }
            const row = e.target.closest('.nm-row');
            if (!row) return;
            const key = row.dataset.key, r = rules[key];
            if (!r) return;
            if (e.target.closest('.nm-play')) {
                // Preview with the style this entry has right now (a sticky notice is shown as a one-shot alert).
                const eff = effective(key), type = normType(r.t);
                const text = r.s.replace(/…/g, 'example');
                if (wantsBar(eff)) addAlertRow(text, type, key);
                if (wantsToast(eff)) enqueueToast({ key: type + '|' + text, rule: key, type, html: esc(text), icon: ALERT_ICONS[type] });
            } else if (e.target.closest('.nm-reset1')) {
                setRule(key, 'original', true);
                renderManager();
            } else if (e.target.closest('.nm-del')) {
                delete rules[key];
                scheduleSaveRules();
                row.remove();
            }
        });
    }

    // Collapse state of the module groups: every group starts collapsed each time the manager opens.
    let nmAllCollapsed = true;
    const nmCollapsed = new Set();   // groups toggled away from the default
    function nmIsCollapsed(g) {
        const q = (document.getElementById('nm-search') || {}).value || '';
        if (q.trim()) return false;   // searching shows the matches expanded
        return nmCollapsed.has(g) ? !nmAllCollapsed : nmAllCollapsed;
    }

    function modeOptions(withOriginal) {
        return (withOriginal ? ['<option value="original">↺ Original style</option>'] : [])
            .concat(RULE_MODES.map(m => `<option value="${m}">${MODE_LABELS[m]}</option>`)).join('');
    }

    function visibleEntries() {
        const q = (document.getElementById('nm-search').value || '').trim().toLowerCase();
        const f = document.getElementById('nm-filter').value;
        const g = document.getElementById('nm-group').value;
        return Object.keys(rules).filter(k => {
            const r = rules[k];
            if (f === 'custom' && !isCustomized(r)) return false;
            if (f === 'alert' && r.k !== 'alert') return false;
            if (f === 'notice' && r.k !== 'notice') return false;
            if (f === 'unseen' && r.n) return false;
            if (f === 'learned' && r.c) return false;
            if (g !== '*' && groupOf(r) !== g) return false;
            if (q && !String(r.s).toLowerCase().includes(q)) return false;
            return true;
        }).sort((a, b) => {
            const ga = groupOf(rules[a]), gb = groupOf(rules[b]);
            const rank = x => x === 'Sticky notices' ? 0 : (x === 'Other (learned)' ? 2 : 1);
            if (rank(ga) !== rank(gb)) return rank(ga) - rank(gb);
            if (ga !== gb) return ga.localeCompare(gb);
            return String(rules[a].s).localeCompare(String(rules[b].s));
        });
    }

    function renderManager() {
        const list = document.getElementById('nm-list');
        if (!list) return;

        const gsel = document.getElementById('nm-group');
        const prevGroup = gsel.value || '*';
        const groups = Array.from(new Set(Object.keys(rules).map(k => groupOf(rules[k])))).sort();
        gsel.innerHTML = '<option value="*">All modules</option>' + groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
        gsel.value = groups.includes(prevGroup) ? prevGroup : '*';
        document.getElementById('nm-bulk').innerHTML = modeOptions(true);

        const keys = visibleEntries();
        if (!keys.length) { list.innerHTML = '<div class="nm-empty">No notifications match the filter.</div>'; return; }

        const counts = {};
        keys.forEach(k => { const g = groupOf(rules[k]); counts[g] = (counts[g] || 0) + 1; });
        let lastGroup = null, html = '';
        keys.forEach(k => {
            const r = rules[k], g = groupOf(r);
            if (g !== lastGroup) {
                const col = nmIsCollapsed(g);
                html += `<div class="nm-group${col ? ' collapsed' : ''}" data-group="${esc(g)}" title="Click to ${col ? 'expand' : 'collapse'}">${col ? '▸' : '▾'} ${esc(g)} · ${counts[g]}</div>`;
                lastGroup = g;
            }
            if (nmIsCollapsed(g)) return;
            const theme = THEMES[r.t] || THEMES.info;
            const isNotice = r.k === 'notice';
            const icon = isNotice ? theme.icon : (ALERT_ICONS[r.t] || 'ℹ️');
            const seen = r.n ? `seen ${r.n}× · last ${esc(new Date(r.ts).toLocaleString('en-US'))}` : 'never seen yet';
            html += `<div class="nm-row${isCustomized(r) ? ' custom' : ''}" data-key="${esc(k)}" style="--nm-accent:${theme.accent};">
                <span class="nm-ico">${icon}</span>
                <div class="nm-txt">
                    <div class="nm-sample" title="${esc(r.s)}">${esc(r.s) || '<i style="color:#666;">(empty)</i>'}</div>
                    <div class="nm-meta">${isNotice ? '<span class="nm-tag">sticky notice</span>' : 'alert'} · ${esc(r.t)} · ${seen}${r.c ? '' : ' · learned'}</div>
                </div>
                <select class="nm-sel" title="How this notification is displayed">${modeOptions(false)}</select>
                <button class="nm-icon-btn nm-play" title="Preview with the style this entry has now">▶</button>
                ${isCustomized(r) ? '<button class="nm-icon-btn nm-reset1" title="Back to the original style">↺</button>' : ''}
                ${r.c ? '' : '<button class="nm-icon-btn del nm-del" title="Forget this learned entry">✕</button>'}
            </div>`;
        });
        list.innerHTML = html;
        list.querySelectorAll('.nm-row').forEach(row => {
            const r = rules[row.dataset.key];
            row.querySelector('.nm-sel').value = validMode(r.m) ? r.m : originalMode(r);
        });
    }

    function refreshManager() {
        const modal = document.getElementById('modal-notice-rules');
        if (modal && modal.classList.contains('active')) renderManager();
    }

    function openManager() {
        buildManager();
        document.getElementById('nm-search').value = '';
        document.getElementById('nm-filter').value = 'all';
        document.getElementById('nm-group').value = '*';
        nmAllCollapsed = true; nmCollapsed.clear();   // always opens with every group collapsed
        renderManager();
        window.openModal('modal-notice-rules');
    }

    /* =====================================================================
       ⚙️ SETTINGS UI
    ===================================================================== */
    function syncSettingsUI() {
        const lines = document.getElementById('notice-lines');
        if (!lines) return;
        document.getElementById('notice-lines').value = cfg.lines;
        document.getElementById('notice-seconds').value = cfg.seconds;
    }

    function injectSettings() {
        const dd = document.getElementById('settings-dropdown');
        if (!dd || document.getElementById('settings-notice-group')) return;

        const grp = document.createElement('div');
        grp.id = 'settings-notice-group';
        grp.innerHTML = `
            <div class="settings-group-label">🔔 Notifications</div>
            <label title="Permanent bar: how many notifications are visible before the bar gets its own scroll.">Bar: visible lines before scroll
                <input type="number" id="notice-lines" min="1" max="10" step="1" style="width: 50px;">
            </label>
            <label title="Temporary toast: how long each notification stays on screen before the next one appears.">Toast: seconds per notification
                <input type="number" id="notice-seconds" min="1" max="30" step="0.5" style="width: 56px;">
            </label>
            <div style="display:flex; gap:5px;">
                <button id="notice-manage" style="background: #2f1a5c; color: #b890ff; border: 1px solid #4a2a8c; font-size: 11px; flex: 1;" title="List of all notifications: choose how each one is displayed (used by the Custom style)">📋 Manage notifications…</button>
                <button id="notice-test" style="background: #1a3a5c; color: #4db8ff; border: 1px solid #2a5a8c; font-size: 11px;" title="Show a sample notification with the current settings">🔔 Test</button>
            </div>`;

        const hr = document.createElement('hr');
        hr.style.cssText = 'border: 0; border-top: 1px solid #333; margin: 5px 0;';

        const backup = Array.from(dd.querySelectorAll('.settings-group-label')).find(e => /Backup/.test(e.textContent));
        if (backup) { dd.insertBefore(grp, backup); dd.insertBefore(hr, backup); }
        else { dd.appendChild(hr); dd.appendChild(grp); }

        document.getElementById('notice-lines').onchange = e => {
            cfg.lines = Math.round(clampNum(e.target.value, 1, 10, DEFAULTS.lines));
            e.target.value = cfg.lines;
            if (typeof window.saveSetting === 'function') window.saveSetting(KEYS.lines, cfg.lines);
            layout();
        };
        document.getElementById('notice-seconds').onchange = e => {
            cfg.seconds = clampNum(e.target.value, 1, 30, DEFAULTS.seconds);
            e.target.value = cfg.seconds;
            if (typeof window.saveSetting === 'function') window.saveSetting(KEYS.secs, cfg.seconds);
            if (current) startTimer();
        };
        document.getElementById('notice-manage').onclick = () => {
            dd.classList.remove('open');
            openManager();
        };
        document.getElementById('notice-test').onclick = () => {
            window.showAlert('Test notification: this is how messages look with the current settings.', 'info');
        };
        syncSettingsUI();
    }

    /* ---------- loading the saved settings ---------- */
    function absorb(target, src) {
        if (validMode(src.m) && !validMode(target.m)) target.m = src.m;
        target.n = (target.n || 0) + (src.n || 0);
        target.ts = Math.max(target.ts || 0, src.ts || 0);
        if (!target.c) { if (src.s) target.s = src.s; if (src.t) target.t = src.t; if (src.k) target.k = src.k; }
    }

    async function loadSettings() {
        if (typeof window.getSetting !== 'function') return;
        try {
            const m = await window.getSetting(KEYS.mode, DEFAULTS.mode);
            const b = await window.getSetting(KEYS.base, null);
            cfg.lines = Math.round(clampNum(await window.getSetting(KEYS.lines, DEFAULTS.lines), 1, 10, DEFAULTS.lines));
            cfg.seconds = clampNum(await window.getSetting(KEYS.secs, DEFAULTS.seconds), 1, 30, DEFAULTS.seconds);
            const stored = await window.getSetting(KEYS.rules, {});

            // Saved entries first (an older version used other keys: learned alerts are re-keyed by their sample).
            const merged = seedRules();
            const memory = rules;
            Object.keys(stored && typeof stored === 'object' ? stored : {}).forEach(k => {
                const o = stored[k];
                if (!o || typeof o !== 'object') return;
                let key = k;
                if (!o.c && k.indexOf('n|') !== 0 && o.s) key = alertRuleKey(o.s);
                if (!merged[key]) merged[key] = { s: o.s || '', t: o.t || 'info', k: o.k || 'alert', n: 0, ts: 0 };
                absorb(merged[key], o);
            });
            // What happened before the settings finished loading.
            Object.keys(memory).forEach(k => {
                const o = memory[k];
                if (!o.n && !validMode(o.m)) return;
                if (!merged[k]) merged[k] = { s: o.s, t: o.t, k: o.k, n: 0, ts: 0 };
                absorb(merged[k], o);
            });
            rules = merged;

            cfg.mode = 'custom';   // Custom is the only style (old saved permanent / temporary is ignored)
            cfg.base = 'permanent';
            sticky.forEach(s => { s.shown = false; });
            reconcile();
            syncSettingsUI();
            scheduleSaveRules();
        } catch (e) { /* defaults */ }
    }

    window.addEventListener('DOMContentLoaded', async () => {
        // tagmanager_alert.js may have been loaded after this file: keep the unified showAlert.
        if (!window.showAlert || !window.showAlert.__unified) window.showAlert = showAlert;
        await loadSettings();
        injectSettings();
        setTimeout(injectSettings, 1200);   // in case the settings dropdown is rebuilt late
    });
})();