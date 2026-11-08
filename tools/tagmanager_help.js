/* =========================================================================
   TAG MANAGER — HELP (❓ button in the top bar)
   ---------------------------------------------------------------------
   Same system as the Prompt Helper help (tools/prompt_helper_help.js):
   a table of contents with one chip per section, every section in one
   scrollable body, Esc / × / Close to leave.
   The old Auto-Caption help (the #modal-help content in the HTML) is kept as
   the "🤖 Auto-Caption" section, so nothing written there is lost.
   window.showHelp(section?) opens it (section = id below, e.g. 'bucket').
   Loads after tagmanager_ui_core.js (it replaces its window.showHelp).
========================================================================= */
(function () {
    'use strict';

    const css = `
        #tmh-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 2000; justify-content: center; align-items: center; backdrop-filter: blur(5px); }
        #tmh-overlay.active { display: flex; }
        #tmh-modal { background: #1b1b1b; padding: 20px; border-radius: 10px; border: 1px solid #333; width: 820px; max-width: 94vw; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.9); }
        #tmh-modal h3 { margin: 0; font-size: 16px; color: #eee; border-bottom: 1px solid #333; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
        #tmh-close { background: transparent; border: none; color: #ff4444; font-size: 24px; cursor: pointer; font-weight: bold; line-height: 1; padding: 0; }
        #tmh-close:hover { background: transparent; color: #ff8888; }
        #tmh-search { width: 100%; box-sizing: border-box; font-size: 12px; padding: 6px 10px; background: #111; border: 1px solid #333; border-radius: 6px; color: #ddd; }
        #tmh-toc { display: flex; flex-wrap: wrap; gap: 6px; }
        #tmh-toc button { background: #151515; color: #9ecfff; border: 1px solid #2a3a4e; border-radius: 14px; padding: 4px 10px; font-size: 11px; cursor: pointer; font-weight: bold; }
        #tmh-toc button:hover { background: #1a3a5c; color: #fff; }
        #tmh-toc button.dim { opacity: .3; }
        #tmh-body { font-size: 13px; color: #ccc; line-height: 1.6; max-height: 62vh; overflow-y: auto; padding-right: 6px; }
        #tmh-body h4 { margin: 18px 0 6px; font-size: 14px; }
        #tmh-body h4:first-child { margin-top: 0; }
        #tmh-body h5 { margin: 12px 0 4px; font-size: 13px; color: #eee; }
        #tmh-body p { margin: 0 0 10px; }
        #tmh-body ul, #tmh-body ol { padding-left: 20px; margin: 0 0 12px; }
        #tmh-body li { margin-bottom: 6px; }
        #tmh-body code { background: #0d0d0d; border: 1px solid #2a2a2a; border-radius: 4px; padding: 1px 5px; color: #ffcc99; font-size: 12px; }
        #tmh-body pre { background: #0d0d0d; border: 1px solid #2a2a2a; border-radius: 6px; padding: 10px 12px; margin: 6px 0 12px; overflow-x: auto; color: #b8f0d0; font-size: 12px; line-height: 1.5; }
        #tmh-body a { color: #4db8ff; text-decoration: none; }
        #tmh-body a:hover { text-decoration: underline; }
        #tmh-body .tmh-note { background: #0d1f2a; border: 1px solid #144a63; padding: 8px 10px; border-radius: 6px; margin: 0 0 12px; }
        #tmh-body .tmh-warn { background: #1a1500; border: 1px solid #aa8800; color: #ffcc66; padding: 8px 10px; border-radius: 6px; margin: 0 0 12px; }
        #tmh-body table { border-collapse: collapse; width: 100%; margin: 6px 0 12px; font-size: 12px; }
        #tmh-body th, #tmh-body td { border: 1px solid #2a2a2a; padding: 5px 8px; text-align: left; vertical-align: top; }
        #tmh-body th { background: #151515; color: #aaa; }
        #tmh-body .tmh-sec.hidden { display: none; }
        #tmh-foot { display: flex; justify-content: flex-end; }
        #tmh-foot button { background: transparent; border: 1px solid #555; color: #aaa; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; }
        #tmh-foot button:hover { background: #333; color: #fff; }
    `;

    const SECTIONS = [
        ['start', 'Start here', '#00ff99', `
            <p>The Tag Manager edits the captions of a training dataset (one <code>.txt</code> / <code>.json</code> next to each image). The screen has three main panels:</p>
            <ul>
                <li><b>Dataset</b> (left): the images of the folder you opened. Click to select, <code>Shift</code>+click for a range, <code>Ctrl</code>+click to add / remove one.</li>
                <li><b>Active Image</b> (middle): the tags of the selected image(s). With several images selected you see all their tags together.</li>
                <li><b>All Dataset Tags</b> (right): every tag of the dataset with its count. Use it to filter images, pin a tag, or edit a tag in every image at once.</li>
            </ul>
            <h5>Where it runs matters</h5>
            <ul>
                <li><b>Localhost</b> (<code>Modular AI Tools localhost.bat</code> / <code>python server_max.py</code>): everything works — PyTorch, PSD Import, seg body for the Auto Bucket, the shared tag cache in <code>local/</code>.</li>
                <li><b>Online version</b>: everything that runs in the browser works; the functions that need the local server are hidden or fall back (for example the Auto Bucket uses a centered crop).</li>
                <li><b>Opening the .html directly (<code>file://</code>)</b>: only for quick manual edits; heavy processing is slow there.</li>
            </ul>
            <p class="tmh-note">Edits stay in memory until you save (<b>💾 Save Selected</b> / save all). The "unsaved changes" notice reminds you.</p>`],
        ['list', '🖼️ Dataset list', '#4db8ff', `
            <ul>
                <li><b>👁️ Hide</b> hides the selected images; <b>🎯 Focus</b> hides everything except the selection. <b>👁️‍🗨️ Unhide</b> brings everything back and <b>🔀 Invert</b> swaps them: the hidden images are shown and the visible ones are hidden.</li>
                <li><b>✏️ Rename</b> and <b>📋 Clone</b> show a <code>⏳ x/N</code> counter on their button while they work (like Archive and the Auto Bucket). Rename first copies the originals to <code>_rename_cache</code>, so nothing is lost if something fails.</li>
                <li><b>🔒 Reorder mode</b> lets you drag images to a manual order.</li>
                <li><b>⏪</b> (next to 🔄): back to the last dataset where you actually did something (saved tags/images, ran a task) — just opening a dataset does not count. Click again to go back to the other one.</li>
                <li><b>📂 Go to</b> (next to Remove, localhost): opens the folder of the dataset on screen in Windows Explorer. The first time the local server looks for the folder on disk (a small temporary marker file is written and removed); if it cannot find it you paste the path once — it is remembered.</li>
                <li><b>Folder depth</b> (⚙️ › 📂 Folders, 1–10, default 3): how many levels of subfolder dropdowns you can open.</li>
                <li><b>🔍</b> on a thumbnail opens it full size. The slider at the bottom changes the thumbnail size.</li>
                <li><b>📌</b> pins an image in its own panel (tags read-only, can be copied). It can be turned off in ⚙️ Settings › 🧩 Features.</li>
            </ul>
            <h5>Previews by blocks</h5>
            <p>The list loads the previews in <b>blocks</b> (⚙️ Settings › 🖼️ Image list › <b>Images per block</b>). Only the block you are looking at (and the next / previous one when you get close to its edge) stays in memory.</p>
            <ul>
                <li><b>Smaller block</b> = less RAM, but jumping to a far image needs to load another block more often (slower to search).</li>
                <li><b>Bigger block</b> = more RAM and each block takes longer to load, but jumping / searching is faster.</li>
                <li>Every "go to image" (🪣 Bad Bucket, ⚠️ Conflicts, 🟨 Similar…) first finds the image, loads its whole block and only then moves the list to it — so the preview always lands on the right image, even when you click fast.</li>
            </ul>`],
        ['active', '🏷️ Active Image', '#4db8ff', `
            <ul>
                <li>Type in the box and press <b>Enter</b> / <b>Add</b> (Top / Bot chooses the position). <b>🔍</b> on = typing also filters the list; <b>🌐</b> switches the suggestions between Danbooru / e621 and the tags of this dataset.</li>
                <li>Click tags to select them (<code>Shift</code> / <code>Ctrl</code> work). The bar that appears has <b>🔄 Replace</b>, <b>↕️ Reorder tag</b>, <b>🪄 Convert to NL</b>, <b>🧬 Merge to NL</b>, <b>🗑️ Remove Selected</b>.</li>
                <li><b>↕️ Reorder tag</b>: type the new line number (line 1 = top) and the selected tag(s) move there — in every selected image. Dragging a row also reorders.</li>
                <li><b>Pinned / filtered tags stay visible</b>: when a tag is 📌 pinned or used by a filter button in All Dataset Tags, its row stays at the top of Active Image while its real line is scrolled out of view. When the real line is visible again it goes back to normal. Click the copy at the top to jump to the real line.</li>
                <li><b>💡 Ghost tags</b> are suggestions (Review Mode, converted tags): ✓ accepts, × rejects.</li>
                <li><b>NL</b> (natural language) tags are sentences. They are kept as one item even when they contain commas (see "Files in the dataset folder").</li>
            </ul>`],
        ['master', '📚 All Dataset Tags', '#4db8ff', `
            <ul>
                <li>Select tags and use <b>AND / OR / XOR / NOT</b> to show only the images that match. <b>📌</b> pins one tag as a filter.</li>
                <li>Colors: blue = Danbooru tag, pink = e621 tag, gray = unknown, gold = an alias that can be replaced by its main tag.</li>
                <li>The dots in the title bar show if <b>Danbooru</b> / <b>e621</b> are online (green), having issues (yellow) or offline (red). Click a dot to check that site again.</li>
            </ul>`],
        ['bucket', '🪣 Bucket resolution', '#ff6060', `
            <p>Training buckets are the resolutions the trainer accepts (SD / SDXL / HD, chosen in the Bucket popout). Images outside them get a red border and a red <b>🪣 W×H</b> badge.</p>
            <ul>
                <li><b>Click the red badge</b> (or the wrong resolution) of an image: it offers <b>🤖 Auto (this image)</b> — the same automatic mode as Auto bucket all (seg body), only for that image. For a manual crop use <b>🪣 Fix Bucket</b> in Active Image.</li>
                <li><b>🪣 Fix / Change Bucket</b> (Active Image header) opens the popout: pick a resolution, drag the green box, zoom, <b>✅ Apply</b>. The original goes to 📦 Archive (label <code>bucket</code>) first.</li>
                <li><b>⟲ Keep W×H</b>: same size, only zoom / crop. <b>↻ Repeat last</b> (next to it): the same resolution, zoom and position of your last crop — useful for a series of similar images.</li>
                <li><b>Zoom</b>: slider, mouse wheel, <b>−</b> / <b>+</b>, or type the exact % (100–800). <b>Step</b> sets how much each −/+ click or wheel notch changes the zoom (for example 1% for fine control).</li>
            </ul>
            <h5>Bucket all (🪣 button when it is red)</h5>
            <ul>
                <li><b>✋ Manual bucket all</b>: opens one bad image at a time. Applying opens the next one by itself; <b>cancelling one image cancels the whole run</b> (the ones already done stay done).</li>
                <li><b>Use segm body — to try fit better resolution</b> (checkbox in the Bucket popout and in the Bucket all window): on = every automatic mode uses segm_person_yolo8m; off = the crop goes to the bucket that preserves the most image, centered.</li>
                <li><b>🤖 Auto bucket all</b>: every bad image goes to the bucket that keeps the most of the image. With Use segm body on, <b>seg body</b> (segm_person_yolo8m on the local server) is used automatically to place the crop on the body and to choose a bucket that does not cut the person. Without the local server (or without <code>ultralytics</code>), or when no person is found, the crop is centered.</li>
            </ul>
            <p class="tmh-note">SAM ViT is no longer used (PSD Import and Bucket use only segm_person_yolo8m).</p>`],
        ['psd', '🎨 PSD Import', '#b890ff', `
            <p>The 🎨 icon appears when the folder has <code>.psd</code> / <code>.psb</code> / <code>.xcf</code> files (needs the local server). Each layer is read at native resolution, the person is found and the crop is fitted to the nearest bucket. The PSD itself is never changed.</p>
            <ul>
                <li><b>🎨 Import</b>: person crops (one version per person). <b>📦 Unpack only</b>: every layer saved as a native PNG. <b>✂️ Manual</b>: browse the layers and crop them with the Bucket popout.</li>
                <li>⚙️ Settings › 🧩 Features › <b>Unpack PSD</b>: <i>Default</i> (the icon opens PSD Import), <i>Unpack only</i> (the icon just unpacks every new PSD and disappears), <i>Hide</i> (function off).</li>
                <li>Packages: <code>pip install psd-tools ultralytics</code> (<code>gimpformats</code> for .xcf).</li>
            </ul>`],
        ['bw', '🖤 B&amp;W / Manga', '#cccccc', `
            <p>Select images and click <b>🖤</b>: grayscale, dither, line art, screentone, sketch styles… with a live preview. Originals go to 📦 Archive. It can be turned off in ⚙️ Settings › 🧩 Features.</p>`],
        ['archive', '📦 Archive', '#66ccff', `
            <ul>
                <li>Everything that replaces or removes an image (bucket fix, B&amp;W, 📦 archive selected…) keeps the original in the Archive, with a label you can edit and filter by.</li>
                <li>The first archived version of each image is its <b>original</b>. Originals are shown in their own <b>📁 original</b> folder (like the folders of the Global mode); every other archived image stays in the list.</li>
                <li><b>♻️ Restore</b> (one or several selected), <b>📌</b> pin without restoring, <b>🗑️ Delete Permanently</b>.</li>
                <li><b>Global mode</b>: when the opened folder has datasets one level below, one <code>_archive</code> at the root can hold all of them (one folder per dataset).</li>
            </ul>`],
        ['interrogator', '🏷️ Tag Interrogator (Danbooru / e621)', '#f48fb1', `
            <ul>
                <li>Search tags, scan the dataset for counts / categories / aliases / wiki, fill the wiki texts.</li>
                <li><b>Server status</b>: the status of Danbooru and e621 is checked when the app starts. While a site is <b>offline or having issues, no request is sent to it</b> (nothing is marked as unknown because of that); it is checked again every 5 minutes. Before sending a request, if the last check is more than a minute old, the status is checked first.</li>
                <li>Settings › <b>🔤 Autocomplete</b>: how many suggestions each site shows (Danbooru / e621, default <b>5 / 5</b>). If one site has fewer, the other fills the rest; 0 turns a site off in the suggestions.</li>
                <li><b>💾 Wiki text</b> and <b>🤖 Auto-fill when idle</b> work on localhost and are shared with the Prompt Helper.</li>
            </ul>`],
        ['tasks', '⏳ Background tasks', '#ffd27a', `
            <p>Long jobs run as <b>background tasks</b>: <b>PSD Import / Unpack</b>, <b>Auto-Caption</b>, <b>Auto bucket</b>, <b>B&amp;W</b>, <b>Archive</b>, <b>Rename</b>, <b>Clone</b> and the <b>🧐 Evaluator</b>. Each one keeps the dataset it started on and only writes there, so you can open another dataset — and even start another task in it — while it runs.</p>
            <ul>
                <li>The <b>⏳</b> button next to the program title shows how many tasks are running. Click it for the list: dataset of each task, progress x / N, <b>⏹ Stop</b>. Finished tasks stay there for a while (✓ / ⚠️) and a notification is shown.</li>
                <li><b>GPU queue</b>: tasks that use the GPU (Auto-Caption, Evaluator, PSD person detection, seg body of the Auto bucket) run one at a time — the next one waits (⏸) and starts by itself. The others run together.</li>
                <li>The screen is only refreshed when the task's dataset is the one open; otherwise you see the result when you open that dataset again.</li>
                <li>Only one PSD Import / Unpack and one Auto-Caption at a time (they use one server session / one model).</li>
                <li>Everything still lives in this tab: closing or reloading the Tag Manager stops the tasks.</li>
            </ul>`],
        ['notices', '🔔 Notifications', '#ffd040', `
            <ul>
                <li>Every notification uses its own style: <b>permanent bar</b>, <b>temporary toast</b>, <b>both</b> or <b>hidden</b>, set in ⚙️ Settings › 🔔 Notifications › <b>📋 Manage notifications…</b> (the old "all bar / all toast" presets were removed).</li>
                <li>In the manager the notifications are grouped by module; every group <b>starts collapsed</b> — click a group to open it, or use <b>▾ Expand all</b>. Typing in the search box shows the matches expanded.</li>
            </ul>`],
        ['settings', '⚙️ Settings', '#9ecfff', `
            <p>The ⚙️ menu is organized in sections (click a section title to fold it):</p>
            <table>
                <tr><th>Section</th><th>What is there</th></tr>
                <tr><td>⚙️ General</td><td>Last edited time, unsaved changes alert, help button</td></tr>
                <tr><td>🖼️ Image list</td><td>Images per block (RAM × search speed)</td></tr>
                <tr><td>📂 Folders</td><td>Folder depth (levels of subfolder dropdowns, 1–10)</td></tr>
                <tr><td>🧩 Features</td><td>📌 Pin image on / off, 🖤 B&amp;W on / off, 🎨 Unpack PSD (Default / Unpack only / Hide), Tag Interrogator and Local AI switches</td></tr>
                <tr><td>📝 NL / Caption Rules</td><td>Auto-detect NL and its word threshold</td></tr>
                <tr><td>🎨 Highlights</td><td>Favorites, conflicts, filter / pin highlight, presets, rules</td></tr>
                <tr><td>🔔 Notifications</td><td>Lines / seconds, manager, test</td></tr>
                <tr><td>💾 Backup</td><td>Export / import presets and settings</td></tr>
            </table>`],
        ['files', 'Files in the dataset folder', '#ffcc66', `
            <table>
                <tr><th>File / folder</th><th>What it is</th></tr>
                <tr><td><code>_tagger_config.json</code></td><td>Dataset settings (favorites, hidden images, rules, order…). It is only <b>created once the dataset has at least one tag</b> — a folder with only images gets no config file.</td></tr>
                <tr><td><code>_nl_manager.json</code></td><td>Where each NL sentence starts and ends inside the caption (the <code>.txt</code> never contains "NL:").</td></tr>
                <tr><td><code>_nl_known_texts.json</code></td><td>The NL sentences of <b>this</b> dataset, used to rebuild an NL when the caption was edited outside the app. It used to be one global file (<code>local/nl_known_texts.json</code>) that grew forever; now each dataset keeps its own. The old file is only read (its sentences move to the dataset that uses them) and can be deleted.</td></tr>
                <tr><td><code>_pending_tags.json</code></td><td>💡 ghost suggestions not accepted yet.</td></tr>
                <tr><td><code>_psd_processed.json</code></td><td>Which PSDs were already imported / unpacked.</td></tr>
                <tr><td><code>_store_configs/</code> (in the saved root)</td><td>With ⚙️ 📂 Folders › <b>🗄️ Store configs on root</b> ON, the config files above live here (one subfolder per dataset, same path) instead of inside each dataset. Only for folders in the Saved directories list; switching moves the files. Each folder there has a <code>_fingerprint.json</code> (names + first tag of up to 10 images): if a dataset is renamed or moved inside the root outside the app, its configs are found by comparing the images and moved to the new folder.</td></tr>
                <tr><td><code>_archive/</code>, <code>_rename_cache/</code>, <code>_trash/</code></td><td>Archive, rename safety copies, trash. Never scanned as dataset images.</td></tr>
            </table>`]
    ];

    function build() {
        if (document.getElementById('tmh-overlay')) return;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);

        // The old help (Auto-Caption) becomes a section.
        const oldBody = document.querySelector('#modal-help .tool-modal > div');
        const sections = SECTIONS.slice();
        if (oldBody) sections.splice(sections.length - 2, 0, ['caption', '🤖 Auto-Caption', '#ff9966', oldBody.innerHTML]);

        const toc = sections.map(([id, title]) => `<button type="button" data-target="tmh-${id}">${title}</button>`).join('');
        const body = sections.map(([id, title, color, html]) =>
            `<div class="tmh-sec" data-sec="${id}"><h4 id="tmh-${id}" style="color:${color};">${title}</h4>${html}</div>`).join('');

        const overlay = document.createElement('div');
        overlay.id = 'tmh-overlay';
        overlay.innerHTML = `
            <div id="tmh-modal" role="dialog" aria-modal="true" aria-label="Help">
                <h3><span>❓ Help &amp; Instructions</span><button id="tmh-close" type="button" title="Close">&times;</button></h3>
                <input type="text" id="tmh-search" placeholder="🔍 Search the help...">
                <div id="tmh-toc">${toc}</div>
                <div id="tmh-body">${body}</div>
                <div id="tmh-foot"><button type="button" id="tmh-close2">Close</button></div>
            </div>`;
        document.body.appendChild(overlay);

        const close = () => overlay.classList.remove('active');
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        overlay.querySelector('#tmh-close').onclick = close;
        overlay.querySelector('#tmh-close2').onclick = close;
        overlay.querySelectorAll('#tmh-toc button').forEach(b => {
            b.onclick = () => {
                const t = document.getElementById(b.dataset.target);
                if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' });
            };
        });
        const search = overlay.querySelector('#tmh-search');
        search.oninput = () => {
            const q = search.value.trim().toLowerCase();
            overlay.querySelectorAll('.tmh-sec').forEach(sec => {
                const hit = !q || sec.textContent.toLowerCase().includes(q);
                sec.classList.toggle('hidden', !hit);
                const chip = overlay.querySelector(`#tmh-toc button[data-target="tmh-${sec.dataset.sec}"]`);
                if (chip) chip.classList.toggle('dim', !hit);
            });
        };
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('active')) close(); });
    }

    window.showHelp = function (section) {
        build();
        const overlay = document.getElementById('tmh-overlay');
        overlay.classList.add('active');
        const body = document.getElementById('tmh-body');
        body.scrollTop = 0;
        if (section) { const t = document.getElementById('tmh-' + section); if (t) t.scrollIntoView({ block: 'start' }); }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
