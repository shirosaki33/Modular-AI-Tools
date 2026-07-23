/* =========================================================================
   DANBOORU TAG INFO PANEL (Standalone — usa tagmanager_danbooru_core.js)
   ---------------------------------------------------------------------
   Não faz NENHUM fetch() direto à API — tudo passa pelas funções
   compartilhadas de tagmanager_danbooru_core.js, que já cuida do cache
   único (window.danbooruCache), reaproveitado também pelo autocomplete
   e pelo sync de contagens.

   - Botão 📖 Danbooru no topbar abre um popout (mesmo estilo
     .modal-overlay/.tool-modal usado por Trash/Archive) com busca manual
     de 1 tag + descrição da wiki.
   - Toda tag com wiki cacheada ganha um ❓ ao lado do × de remover,
     tanto na "Active Image" quanto em "All Dataset Tags".
   - BACKGROUND SCAN AUTOMÁTICO: assim que um dataset novo é carregado
     (detectado via troca de referência de window.imageFiles, mesmo
     padrão de tagmanager_custom_conflicts.js), dispara sozinho — em
     segundo plano, sem alertas — um scan que vai preenchendo os ❓
     incrementalmente conforme cada tag é resolvida. Tags já vistas
     antes (autocomplete, sync de contagem, busca manual) dentro do TTL
     não custam nova chamada de rede.
   - Botão manual "🔍 Scan Dataset Tags" continua existindo dentro do
     popout, para forçar um recheck (🔄, ignora o cache) quando precisar.
========================================================================= */

(function () {

    const style = document.createElement('style');
    style.innerHTML = `
        #btn-open-danbooru-info { color: #4db8ff; margin-left: 5px; }
        #btn-open-danbooru-info:hover { color: #fff; border-color: #4db8ff; }

        .tag-db-info {
            color: #4db8ff; cursor: pointer; font-weight: bold; font-size: 1em;
            padding: 0 0.35em; flex-shrink: 0; opacity: 0.85; user-select: none;
        }
        .tag-db-info:hover { color: #fff; transform: scale(1.2); opacity: 1; }
        /* Ghost rows (💡 sugestões) usam um container flex com gap maior —
           sem margem própria o ❓ ficaria colado demais no ✓/×. */
        .tag-row.ghost .tag-db-info, .master-tag-item.ghost .tag-db-info { margin-right: -2px; }

        #modal-danbooru .tool-modal, #modal-db-tag-info .tool-modal { width: 700px; max-width: 90vw; max-height: 80vh; overflow-y: auto; }

        .dbp-row { display: flex; gap: 8px; }
        .dbp-input {
            flex: 1; min-width: 0; background: #0d0d0d; border: 1px solid #2a3a2e; border-radius: 6px;
            color: #eee; padding: 8px 12px; font-size: 13px; outline: none; box-sizing: border-box;
        }
        .dbp-input:focus { border-color: #4db8ff; }
        .dbp-btn { background: #1a3a5c; color: #4db8ff; border: 1px solid #2a5a8c; border-radius: 6px; padding: 8px 12px; font-weight: bold; cursor: pointer; font-size: 12px; }
        .dbp-btn:hover { background: #4db8ff; color: #000; }

        .dbp-result { background: #0d0d0d; border: 1px solid #1e3d28; border-radius: 6px; padding: 12px; display: none; margin-top: 10px; }
        .dbp-result.open { display: block; }
        .dbp-tag-title { font-size: 15px; font-weight: bold; color: #4db8ff; margin-bottom: 4px; }
        .dbp-tag-cat { font-size: 12px; color: #aaa; margin-left: 8px; }
        .dbp-desc { color: #ccc; font-size: 13px; line-height: 1.5; max-height: 450px; overflow-y: auto; margin: 8px 0; padding-right: 5px; }

        .dbp-btn-scan { background: #00aa66; color: #000; border: none; border-radius: 6px; padding: 8px; font-weight: bold; cursor: pointer; font-size: 12px; }
        .dbp-btn-scan:hover { background: #00ff99; }
        .dbp-btn-scan:disabled { opacity: 0.5; cursor: not-allowed; }
        .dbp-btn-scan-force { background: #222; color: #aaa; border: 1px solid #444; border-radius: 6px; padding: 8px 10px; cursor: pointer; font-size: 12px; }
        .dbp-btn-scan-force:hover { color: #fff; border-color: #666; }
        .dbp-btn-scan-force:disabled { opacity: 0.5; cursor: not-allowed; }

        .dbp-btn-detect { background: #1a3a5c; color: #4db8ff; border: 1px solid #2a5a8c; border-radius: 6px; padding: 8px; font-weight: bold; cursor: pointer; font-size: 12px; }
        .dbp-btn-detect:hover { background: #4db8ff; color: #000; }
        .dbp-detect-list {
            display: none; flex-wrap: wrap; gap: 6px; background: #0d0d0d; border: 1px solid #1e2a3a;
            border-radius: 6px; padding: 10px; margin-top: 8px; max-height: 160px; overflow-y: auto;
        }
        .dbp-detect-list.open { display: flex; }
        .dbp-detect-item {
            background: #151515; border: 1px solid #2a3a4a; color: #9ecfff; border-radius: 14px;
            padding: 5px 12px; font-size: 12px; cursor: pointer; user-select: none; transition: 0.1s;
        }
        .dbp-detect-item:hover { background: #1a3a5c; color: #fff; border-color: #4db8ff; }
        .dbp-detect-item.has-info { border-color: #00aa66; color: #66ffaa; }
        .dbp-detect-item.has-info:hover { background: #0d2a18; color: #fff; border-color: #00ff99; }
        .dbp-detect-empty { color: #555; font-size: 11px; font-style: italic; padding: 4px; }
    `;
    document.head.appendChild(style);

    const DB_CAT_COLORS = { 0: "#aaa", 1: "#f9a825", 3: "#ae80ff", 4: "#5bc0de", 5: "#888" };
    const DB_CAT_LABELS = { 0: "General", 1: "Artist", 3: "Copyright", 4: "Character", 5: "Meta" };

    window.danbooruInfoEnabled = window.danbooruInfoEnabled !== undefined ? window.danbooruInfoEnabled : true;
    window.danbooruInfoShowIcons = window.danbooruInfoShowIcons !== undefined ? window.danbooruInfoShowIcons : true;
    // Independente do enable mestre: só controla se o botão 📖 Danbooru
    // aparece no topbar. Desligar isso NÃO desliga o scan em segundo
    // plano nem os ❓ nas tags — só some com o botão/popout manual.
    window.danbooruInfoShowButton = window.danbooruInfoShowButton !== undefined ? window.danbooruInfoShowButton : true;
    window._dbInfoScanRunning = window._dbInfoScanRunning || false;
    window._dbBackgroundScanCancelled = window._dbBackgroundScanCancelled || false;
    window._dbInfoLastImageFilesRef = window._dbInfoLastImageFilesRef || null;

    /* ---------- CONVERSOR DE DTEXT PARA HTML ---------- */
    window.formatDanbooruDText = function(text) {
        if (!text) return "";
        return text
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/\[\s*\[\s*([^|\]]+?)\s*(?:\|\s*([^\]]+?))?\s*\]\s*\]/g, (m, tag, label) => {
                const url = `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(tag.replace(/ /g, '_'))}`;
                return `<a href="${url}" target="_blank" style="color:#4db8ff; text-decoration:none; font-weight:bold;">${label || tag.replace(/_/g, ' ')}</a>`;
            })
            .replace(/(?:\[?\s*post\s*#|post:)\s*(\d+)\s*\]?/gi, '<a href="https://danbooru.donmai.us/posts/$1" target="_blank" style="color:#00ff99; text-decoration:none; font-weight:bold; background:#0d2a18; padding:2px 6px; border-radius:4px; border:1px solid #00aa66; white-space:nowrap;">📸 IMG #$1</a>')
            .replace(/!?asset\s*#\d+/gi, '<span style="color:#888; font-style:italic; font-weight:bold;">[IMG]</span>')
            .replace(/^h[1-6]\.\s+(.*)$/gm, '<b style="color:#eee; display:block; margin-top:12px; margin-bottom:4px; border-bottom:1px solid #333; padding-bottom:4px;">$1</b>')
            .replace(/"([^"]+)":\s*(https?:\/\/[^\s]+)/g, '<a href="$2" target="_blank" style="color:#4db8ff; text-decoration:underline;">$1</a>')
            .replace(/\[\s*(https?:\/\/[^\s\]]+)\s+([^\]]+)\s*\]/g, '<a href="$1" target="_blank" style="color:#4db8ff; text-decoration:underline;">$2</a>')
            .replace(/\[\s*b\s*\](.*?)\[\s*\/\s*b\s*\]/gi, '<b>$1</b>')
            .replace(/\[\s*i\s*\](.*?)\[\s*\/\s*i\s*\]/gi, '<i>$1</i>')
            .replace(/\n/g, '<br>');
    };

    /* ---------- TRADUÇÃO ---------- */
    async function translateDescNode(descEl) {
        if (descEl.dataset.original === undefined) descEl.dataset.original = descEl.textContent;
        const original = descEl.dataset.original;
        if (!original || !original.trim()) return;

        const lang = prompt("Target language code (e.g. pt, es, fr, ja, en):", "pt");
        if (!lang) return;

        const backup = descEl.innerHTML;
        descEl.innerHTML = "🌐 Translating...";
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang.trim().toLowerCase()}&dt=t&q=${encodeURIComponent(original)}`;
            const res = await fetch(url);
            const data = await res.json();
            let translated = "";
            if (data && data[0]) data[0].forEach(part => { if (part[0]) translated += part[0]; });
            
            descEl.innerHTML = window.formatDanbooruDText(translated) || backup;
        } catch (e) {
            descEl.innerHTML = backup;
            if (window.showAlert) window.showAlert("Error translating.", "error");
        }
    }

    /* ---------- MODAL 1: BUSCA MANUAL + SCAN MANUAL ---------- */
    function buildMainModal() {
        if (document.getElementById('modal-danbooru')) return;

        const overlay = document.createElement('div');
        overlay.id = 'modal-danbooru';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-danbooru');

        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>📖 Danbooru Tag Info</span>
                    <button onclick="window.closeModal('modal-danbooru')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>

                <div class="dbp-row">
                    <input type="text" id="dbpInput" class="dbp-input" placeholder="Search a tag... e.g. 1girl">
                    <button class="dbp-btn" id="dbpSearchBtn">Search</button>
                    <button class="dbp-btn-detect" id="dbpDetectBtn" title="List all tags already in this dataset (❓ = already has wiki info cached)">🔍✨</button>
                </div>
                <div class="dbp-detect-list" id="dbpDetectList"></div>
                <div class="dbp-result" id="dbpResult">
                    <div>
                        <span class="dbp-tag-title" id="dbpTagName"></span>
                        <span class="dbp-tag-cat" id="dbpTagCat"></span>
                    </div>
                    <div class="dbp-desc" id="dbpTagDesc"></div>
                    
                    <div style="display:flex; gap:8px; align-items:center; margin-top:12px;">
                        <button id="dbpTranslateBtn" style="background: #2f1a5c; color: #b890ff; border: 1px solid #4a2a8c; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer;">🌐 Translate</button>
                        <a href="#" target="_blank" id="dbpTagLink" style="color: #4db8ff; text-decoration: none; border: 1px solid #2a5a8c; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block;">Open on Danbooru ↗</a>
                    </div>
                </div>

                <hr style="border:0; border-top:1px solid #333; margin:14px 0;">

                <div style="font-size:11px; color:#888; margin-bottom:8px; line-height:1.5;">
                    Runs automatically in the background whenever a dataset is loaded
                    (uses the same shared cache as autocomplete and Danbooru counts —
                    tags already seen elsewhere won't be re-fetched). Tags with a wiki
                    entry get a <b style="color:#4db8ff;">❓</b> icon next to their
                    remove (×) button. Use the buttons below to force a manual
                    scan / recheck.
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="dbp-btn-scan" id="dbpScanBtn" style="flex:1;">🔍 Scan Dataset Tags</button>
                    <button class="dbp-btn-scan-force" id="dbpScanForceBtn" title="Force recheck ALL tags, even already-cached ones">🔄</button>
                </div>
                <div id="dbpScanProgress" style="font-size:11px; color:#aaa; margin-top:8px; display:none;"></div>

                <div class="modal-buttons">
                    <button class="btn-cancel" onclick="window.closeModal('modal-danbooru')">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('dbpSearchBtn').onclick = () => dbpPerformSearch();
        document.getElementById('dbpInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') dbpPerformSearch(); });
        document.getElementById('dbpTranslateBtn').onclick = () => translateDescNode(document.getElementById('dbpTagDesc'));
        document.getElementById('dbpDetectBtn').onclick = () => dbpRunAutoDetect();

        // Scan manual "normal": respeita o TTL/cache, igual ao background scan.
        document.getElementById('dbpScanBtn').onclick = () => window.runDanbooruInfoScan(false);

        // Scan manual "forçado": ignora completamente o cache e recheca tudo.
        document.getElementById('dbpScanForceBtn').onclick = () => {
            if (confirm('Force recheck ALL dataset tags, even already-scanned ones?\nThis takes longer and hits the Danbooru API more.')) {
                window.runDanbooruInfoScan(true);
            }
        };
    }

    async function dbpPerformSearch(tagOverride) {
        const input = document.getElementById('dbpInput');
        const resultBox = document.getElementById('dbpResult');
        const tag = (tagOverride || input.value).trim();
        if (!tag) return;
        input.value = tag;
        resultBox.classList.remove('open');

        const info = await window.dbLookupSingleTag(tag);
        if (!info) {
            if (window.showAlert) window.showAlert(`Tag "${tag}" not found on Danbooru.`, 'warn');
            return;
        }

        const key = tag.trim().toLowerCase().replace(/_/g, ' ');
        document.getElementById('dbpTagName').textContent = key;
        document.getElementById('dbpTagCat').innerHTML = `<span style="color:${DB_CAT_COLORS[info.category] || '#888'}">● ${DB_CAT_LABELS[info.category] || 'Unknown'} (${Number(info.count || 0).toLocaleString()} posts)</span>`;
        document.getElementById('dbpTagLink').href = `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(info.wikiName || key.replace(/ /g, '_'))}`;

        const descEl = document.getElementById('dbpTagDesc');
        descEl.innerHTML = "Loading full wiki description...";
        descEl.dataset.original = "";
        resultBox.classList.add('open');

        try {
            const wRes = await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(info.wikiName || key.replace(/ /g, '_'))}.json`);
            if (wRes.ok) {
                const wData = await wRes.json();
                if (wData && wData.body && wData.body.trim()) {
                    descEl.dataset.original = wData.body;
                    descEl.innerHTML = window.formatDanbooruDText(wData.body);
                } else {
                    descEl.innerHTML = "No wiki description available on Danbooru.";
                }
            } else {
                 descEl.innerHTML = "Wiki not found or error loading.";
            }
        } catch(e) {
            descEl.textContent = info.hasWikiInfo ? info.description : 'No wiki description available.';
            descEl.dataset.original = info.hasWikiInfo ? info.description : '';
        }
    }

    /* ---------- AUTO-DETECÇÃO (🔍✨) ---------- */
    function dbpRunAutoDetect() {
        const listEl = document.getElementById('dbpDetectList');
        listEl.innerHTML = '';

        if (typeof masterTagSet === 'undefined' || masterTagSet.size === 0) {
            listEl.innerHTML = '<div class="dbp-detect-empty">No dataset loaded, or it has no tags yet.</div>';
            listEl.classList.add('open');
            return;
        }

        const tags = Array.from(masterTagSet).filter(t => !t.startsWith('NL:'));
        if (tags.length === 0) {
            listEl.innerHTML = '<div class="dbp-detect-empty">This dataset has no Danbooru-style tags (only NL captions).</div>';
            listEl.classList.add('open');
            return;
        }

        const withInfo = [];
        const withoutInfo = [];
        tags.forEach(t => {
            const info = window.dbGetCachedTag(t.toLowerCase());
            if (info && info.hasWikiInfo) withInfo.push(t); else withoutInfo.push(t);
        });
        withInfo.sort();
        withoutInfo.sort();

        [...withInfo, ...withoutInfo].forEach(t => {
            const key = t.toLowerCase();
            const info = window.dbGetCachedTag(key);
            const hasInfo = !!(info && info.hasWikiInfo);

            const chip = document.createElement('span');
            chip.className = 'dbp-detect-item' + (hasInfo ? ' has-info' : '');
            chip.textContent = (hasInfo ? '❓ ' : '') + t;
            chip.title = hasInfo ? 'Already has wiki info — click to view it' : 'Click to look this tag up';
            chip.onclick = () => {
                listEl.classList.remove('open');
                document.getElementById('dbpInput').value = t;
                dbpPerformSearch(t);
            };
            listEl.appendChild(chip);
        });
        listEl.classList.add('open');
    }

    /* ---------- MODAL 2: POPOUT DE INFO UNIFICADO (aberto pelo ❓) ---------- */
    function buildTagInfoModal() {
        if (document.getElementById('modal-db-tag-info')) return;

        const overlay = document.createElement('div');
        overlay.id = 'modal-db-tag-info';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-db-tag-info');

        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span id="dbiTagTitle">❓ Tag Info</span>
                    <button onclick="window.closeModal('modal-db-tag-info')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>

                <div id="dbiAliasHeader" style="display:none; margin-bottom:15px; padding-bottom:10px; border-bottom:1px dashed #333;">
                    <div style="margin-bottom:8px;"><span style="color:#888; font-size:10px; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px;">Original tag (deprecated)</span><br><b style="color:#ffcc66; font-size:14px;" id="dbiAliasOriginal"></b></div>
                    <div><span style="color:#888; font-size:10px; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px;">Redirects to</span><br><b style="color:#00ff99; font-size:14px;" id="dbiAliasTarget"></b></div>
                    <div style="font-size:11px; color:#888; margin-top:8px; line-height:1.5;">Danbooru merged the original tag into the one above. The tag count and wiki shown below belong to the new tag.</div>
                </div>

                <div><span class="dbp-tag-cat" id="dbiTagCat"></span></div>
                <div class="dbp-desc" id="dbiTagDesc"></div>
                
                <div style="display:flex; gap:8px; align-items:center; margin-top:12px;">
                    <button id="dbiTranslateBtn" style="background: #2f1a5c; color: #b890ff; border: 1px solid #4a2a8c; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer;">🌐 Translate</button>
                    <a href="#" target="_blank" id="dbiTagLink" style="color: #4db8ff; text-decoration: none; border: 1px solid #2a5a8c; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block;">Open on Danbooru ↗</a>
                </div>

                <div class="modal-buttons" style="margin-top: 15px;">
                    <button class="btn-cancel" onclick="window.closeModal('modal-db-tag-info')">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('dbiTranslateBtn').onclick = () => translateDescNode(document.getElementById('dbiTagDesc'));
    }

    // Unifica o carregamento de info para Tags Normais e Tags Alias
    window.openDanbooruTagInfoPopout = async function (tagLower, originalAliasTag = null) {
        buildTagInfoModal();
        
        const titleEl = document.getElementById('dbiTagTitle');
        const aliasHeader = document.getElementById('dbiAliasHeader');
        const origEl = document.getElementById('dbiAliasOriginal');
        const targetEl = document.getElementById('dbiAliasTarget');
        const catEl = document.getElementById('dbiTagCat');
        const descEl = document.getElementById('dbiTagDesc');
        const linkEl = document.getElementById('dbiTagLink');

        if (originalAliasTag) {
            titleEl.innerHTML = '<span style="color: #4db8ff;">↪️ Alias Tag Info</span>';
            origEl.textContent = originalAliasTag;
            targetEl.textContent = tagLower;
            aliasHeader.style.display = 'block';
            linkEl.textContent = 'Open new tag on Danbooru ↗';
        } else {
            titleEl.textContent = '❓ Tag Info';
            aliasHeader.style.display = 'none';
            linkEl.textContent = 'Open on Danbooru ↗';
        }

        descEl.innerHTML = "Loading full wiki description...";
        descEl.dataset.original = "";
        catEl.innerHTML = '';
        linkEl.href = `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(tagLower.replace(/ /g, '_'))}`;
        
        window.openModal('modal-db-tag-info');

        let info = window.dbGetCachedTag(tagLower);
        if (!info || info.count === undefined) {
             if (window.dbLookupSingleTag) {
                 info = await window.dbLookupSingleTag(tagLower);
             }
        }

        if (info) {
            catEl.innerHTML = `<span style="color:${DB_CAT_COLORS[info.category] || '#888'}">● ${DB_CAT_LABELS[info.category] || 'Unknown'} (${Number(info.count || 0).toLocaleString()} posts)</span>`;
        }

        try {
            const wRes = await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent((info && info.wikiName) ? info.wikiName : tagLower.replace(/ /g, '_'))}.json`);
            if (wRes.ok) {
                const wData = await wRes.json();
                if (wData && wData.body && wData.body.trim()) {
                    descEl.dataset.original = wData.body;
                    descEl.innerHTML = window.formatDanbooruDText(wData.body);
                } else {
                    descEl.innerHTML = "No wiki description available on Danbooru.";
                }
            } else {
                 descEl.innerHTML = "Wiki not found or error loading.";
            }
        } catch(e) {
            if (info && info.hasWikiInfo && info.description) {
                descEl.dataset.original = info.description;
                descEl.innerHTML = window.formatDanbooruDText(info.description);
            } else {
                descEl.innerHTML = "Error loading wiki from Danbooru.";
            }
        }
    };

    /* ---------- SCAN DO DATASET (contagem em lote + wiki tag-a-tag) ---------- */
    window.runDanbooruInfoScan = async function (force = false) {
        if (!window.danbooruInfoEnabled) {
            if (window.showAlert) window.showAlert('Danbooru Tag Info is disabled in Settings.', 'warn');
            return;
        }
        if (window._dbInfoScanRunning) {
            if (window.showAlert) window.showAlert('A scan is already running.', 'info');
            return;
        }
        if (typeof masterTagSet === 'undefined' || masterTagSet.size === 0) {
            if (window.showAlert) window.showAlert('Load a dataset with tags first!', 'warn');
            return;
        }

        const tags = Array.from(masterTagSet).filter(t => !t.startsWith('NL:'));
        if (tags.length === 0) {
            if (window.showAlert) window.showAlert('No tags to scan in this dataset.', 'info');
            return;
        }

        window._dbInfoScanRunning = true;
        window._dbBackgroundScanCancelled = false;

        const scanBtn = document.getElementById('dbpScanBtn');
        const forceBtn = document.getElementById('dbpScanForceBtn');
        const progress = document.getElementById('dbpScanProgress');
        if (scanBtn) scanBtn.disabled = true;
        if (forceBtn) forceBtn.disabled = true;
        if (progress) { progress.style.display = 'block'; progress.textContent = 'Fetching counts/categories...'; }

        // Etapa 1: contagem+categoria em lote (reaproveita cache do autocomplete/sync)
        await window.dbFetchCountsBatch(tags, force);

        // Etapa 2: descrição da wiki, só onde ainda falta (ou tudo, se force)
        const result = await window.dbFetchWikiBatch(
            tags,
            force,
            () => scheduleIconRefresh(),
            (done, total, found) => {
                if (progress) progress.textContent = `Scanning: ${done} / ${total} (found ${found})`;
            }
        );

        window._dbInfoScanRunning = false;
        if (scanBtn) scanBtn.disabled = false;
        if (forceBtn) forceBtn.disabled = false;
        if (progress) progress.style.display = 'none';

        refreshTagRenders();

        if (window.showAlert) {
            window.showAlert(`Scan complete! Found wiki info for ${result.found} tag(s).`, 'success');
        }
    };

    /* ---------- BACKGROUND SCAN AUTOMÁTICO (1x por dataset carregado) ---------- */
    let _dbIconRefreshTimer = null;
    function scheduleIconRefresh() {
        clearTimeout(_dbIconRefreshTimer);
        _dbIconRefreshTimer = setTimeout(() => refreshTagRenders(), 400);
    }

    window.runDanbooruBackgroundScan = async function () {
        if (!window.danbooruInfoEnabled) return;
        if (window._dbInfoScanRunning) return;
        if (typeof masterTagSet === 'undefined' || masterTagSet.size === 0) return;

        const tags = Array.from(masterTagSet).filter(t => !t.startsWith('NL:'));
        if (tags.length === 0) return;

        window._dbInfoScanRunning = true;
        window._dbBackgroundScanCancelled = false;

        const scanBtn = document.getElementById('dbpScanBtn');
        const forceBtn = document.getElementById('dbpScanForceBtn');
        const progress = document.getElementById('dbpScanProgress');
        if (scanBtn) scanBtn.disabled = true;
        if (forceBtn) forceBtn.disabled = true;
        if (progress) { progress.style.display = 'block'; progress.textContent = 'Background scan running...'; }

        await window.dbFetchCountsBatch(tags, false);

        await window.dbFetchWikiBatch(
            tags,
            false,
            () => scheduleIconRefresh(),
            (done, total, found) => {
                if (progress) progress.textContent = `Background scan: ${done} / ${total} (found ${found})`;
            }
        );

        window._dbInfoScanRunning = false;
        if (scanBtn) scanBtn.disabled = false;
        if (forceBtn) forceBtn.disabled = false;
        if (progress) progress.style.display = 'none';
        refreshTagRenders();
    };

    function hookAutoDanbooruScan() {
        if (typeof window.renderImageList !== 'function' || window.renderImageList.__dbAutoScanWrapped) return;
        const original = window.renderImageList;
        const wrapped = function () {
            original.apply(this, arguments);
            if (typeof imageFiles !== 'undefined' && imageFiles !== window._dbInfoLastImageFilesRef) {
                window._dbInfoLastImageFilesRef = imageFiles;
                window._dbBackgroundScanCancelled = true;
                setTimeout(() => {
                    window._dbBackgroundScanCancelled = false;
                    window.runDanbooruBackgroundScan();
                }, 600);
            }
        };
        wrapped.__dbAutoScanWrapped = true;
        window.renderImageList = wrapped;
    }

    /* ---------- INJEÇÃO DO ❓ NAS LINHAS DE TAG ---------- */
    function injectDbInfoIcons(container) {
        if (!container) return;
        if (!window.danbooruInfoEnabled || !window.danbooruInfoShowIcons) return;

        container.querySelectorAll('[data-tag-name]').forEach(row => {
            const removeBtn = row.querySelector('.tag-remove');
            if (!removeBtn) return; 

            const tagLower = row.getAttribute('data-tag-name');
            const info = window.dbGetCachedTag(tagLower);
            if (!info || !info.hasWikiInfo) return;
            if (row.querySelector('.tag-db-info')) return;

            const icon = document.createElement('span');
            icon.className = 'tag-db-info';
            icon.textContent = '❓';
            icon.title = 'View Danbooru info for this tag';
            icon.onclick = (e) => { e.stopPropagation(); window.openDanbooruTagInfoPopout(tagLower); };
            removeBtn.parentNode.insertBefore(icon, removeBtn);
        });
    }

    function computeActiveGhostTags() {
        if (typeof selectedIndices === 'undefined' || typeof imageFiles === 'undefined') return [];
        let fusedTags = new Set();
        selectedIndices.forEach(idx => {
            const img = imageFiles[idx];
            if (img && img.type === 'tags' && img.content) {
                img.content.split(',').forEach(t => { const c = t.trim(); if (c) fusedTags.add(c); });
            }
        });
        let fusedPending = new Set();
        selectedIndices.forEach(idx => {
            const img = imageFiles[idx];
            if (img && img.pendingAdd && img.pendingAdd.length) {
                img.pendingAdd.forEach(t => { if (!fusedTags.has(t)) fusedPending.add(t); });
            }
        });
        return Array.from(fusedPending).sort();
    }

    function computeMasterGhostTags() {
        if (typeof imageFiles === 'undefined' || !window.showGhostTagsInList) return [];
        const pendingCounts = new Map();
        imageFiles.forEach(img => {
            if (img.hidden) return;
            if (img.pendingAdd && img.pendingAdd.length) {
                img.pendingAdd.forEach(t => pendingCounts.set(t, (pendingCounts.get(t) || 0) + 1));
            }
        });
        return Array.from(pendingCounts.keys()).sort();
    }

    function injectGhostDbInfoIcons(container, ghostSelector, computeTagsFn, filterNL) {
        if (!container) return;
        if (!window.danbooruInfoEnabled || !window.danbooruInfoShowIcons) return;

        let tags = computeTagsFn();
        if (filterNL) tags = tags.filter(t => !t.startsWith('NL:'));

        const rows = container.querySelectorAll(ghostSelector);
        if (rows.length !== tags.length) return; 

        rows.forEach((row, i) => {
            const tag = tags[i];
            if (tag.startsWith('NL:')) return; 
            if (row.querySelector('.tag-db-info')) return; 

            const tagLower = tag.toLowerCase();
            const info = window.dbGetCachedTag(tagLower);
            if (!info || !info.hasWikiInfo) return;

            const rejectBtn = row.querySelector('.tag-ghost-reject');
            if (!rejectBtn) return;

            const icon = document.createElement('span');
            icon.className = 'tag-db-info';
            icon.textContent = '❓';
            icon.title = 'View Danbooru info for this tag';
            icon.onclick = (e) => { e.stopPropagation(); window.openDanbooruTagInfoPopout(tagLower); };
            rejectBtn.parentNode.insertBefore(icon, rejectBtn);
        });
    }

    function refreshTagRenders() {
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    }

    function wrapRenderersForDbInfo() {
        if (typeof window.renderEditor === 'function' && !window.renderEditor.__dbInfoWrapped) {
            const original = window.renderEditor;
            const wrapped = function () {
                original.apply(this, arguments);
                const el = document.getElementById('tag-list-vertical');
                injectDbInfoIcons(el);
                injectGhostDbInfoIcons(el, '.tag-row.ghost', computeActiveGhostTags, false);
            };
            wrapped.__dbInfoWrapped = true;
            window.renderEditor = wrapped;
        }
        if (typeof window.renderMasterTagList === 'function' && !window.renderMasterTagList.__dbInfoWrapped) {
            const original2 = window.renderMasterTagList;
            const wrapped2 = function () {
                original2.apply(this, arguments);
                const el = document.getElementById('master-tag-list');
                injectDbInfoIcons(el);
                injectGhostDbInfoIcons(el, '.master-tag-item.ghost', computeMasterGhostTags, true);
            };
            wrapped2.__dbInfoWrapped = true;
            window.renderMasterTagList = wrapped2;
        }
    }
    wrapRenderersForDbInfo();

    /* ---------- BOTÃO NO TOPBAR ---------- */
    function injectTopbarButton() {
        const rightBar = document.getElementById('topbar-right');
        const anchor = document.getElementById('btn-settings');
        if (!rightBar || !anchor || document.getElementById('btn-open-danbooru-info')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-open-danbooru-info';
        btn.title = 'Search Danbooru tags & scan dataset for tag info';
        btn.textContent = '📖 Danbooru';
        btn.onclick = () => { buildMainModal(); window.openModal('modal-danbooru'); };
        rightBar.insertBefore(btn, anchor);
        updateTopbarButtonVisibility();
    }

    function updateTopbarButtonVisibility() {
        const btn = document.getElementById('btn-open-danbooru-info');
        if (btn) btn.style.display = (window.danbooruInfoEnabled && window.danbooruInfoShowButton) ? 'inline-block' : 'none';
    }

    /* ---------- ENGRENAGEM: TOGGLES NOVOS NO #settings-dropdown ---------- */
    function injectSettingsToggles() {
        const dropdown = document.getElementById('settings-dropdown');
        if (!dropdown || document.getElementById('toggle-db-info-master')) return;

        const syncBtn = dropdown.querySelector('button[onclick="window.manualDanbooruSync()"]');
        const insertPoint = syncBtn || dropdown.lastElementChild;

        const subLabel = document.createElement('div');
        subLabel.style.cssText = 'font-size:10px; color:#666; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px; margin-top:8px;';
        subLabel.textContent = '❓ Tag Info (Wiki Scan)';

        const lblMaster = document.createElement('label');
        lblMaster.innerHTML = `<input type="checkbox" id="toggle-db-info-master"> Enable Danbooru Tag Info`;

        const lblIcons = document.createElement('label');
        lblIcons.style.marginLeft = '15px';
        lblIcons.innerHTML = `<input type="checkbox" id="toggle-db-info-icons"> Show ❓ icons on tags`;

        const lblButton = document.createElement('label');
        lblButton.style.marginLeft = '15px';
        lblButton.innerHTML = `<input type="checkbox" id="toggle-db-info-button"> Show 📖 Danbooru button in topbar`;

        let cursor = (insertPoint && insertPoint.parentNode === dropdown) ? insertPoint : null;
        [subLabel, lblMaster, lblIcons, lblButton].forEach(el => {
            if (cursor) {
                cursor.insertAdjacentElement('afterend', el);
                cursor = el;
            } else {
                dropdown.appendChild(el);
            }
        });

        const cbMaster = document.getElementById('toggle-db-info-master');
        const cbIcons = document.getElementById('toggle-db-info-icons');
        const cbButton = document.getElementById('toggle-db-info-button');

        cbMaster.checked = window.danbooruInfoEnabled;
        cbIcons.checked = window.danbooruInfoShowIcons;
        cbButton.checked = window.danbooruInfoShowButton;
        cbIcons.disabled = !window.danbooruInfoEnabled;
        cbButton.disabled = !window.danbooruInfoEnabled;

        cbMaster.onchange = async (e) => {
            window.danbooruInfoEnabled = e.target.checked;
            await window.saveSetting('danbooru-info-enabled', window.danbooruInfoEnabled);
            cbIcons.disabled = !window.danbooruInfoEnabled;
            cbButton.disabled = !window.danbooruInfoEnabled;
            updateTopbarButtonVisibility();
            refreshTagRenders();

            if (window.danbooruInfoEnabled) window.runDanbooruBackgroundScan();
        };

        cbIcons.onchange = async (e) => {
            window.danbooruInfoShowIcons = e.target.checked;
            await window.saveSetting('danbooru-info-show-icons', window.danbooruInfoShowIcons);
            refreshTagRenders();
        };

        cbButton.onchange = async (e) => {
            window.danbooruInfoShowButton = e.target.checked;
            await window.saveSetting('danbooru-info-show-button', window.danbooruInfoShowButton);
            updateTopbarButtonVisibility();
        };
    }

    /* ---------- CARREGAMENTO INICIAL ---------- */
    window.addEventListener('DOMContentLoaded', async () => {
        window.danbooruInfoEnabled = await window.getSetting('danbooru-info-enabled', true);
        window.danbooruInfoShowIcons = await window.getSetting('danbooru-info-show-icons', true);
        window.danbooruInfoShowButton = await window.getSetting('danbooru-info-show-button', true);

        injectTopbarButton();
        injectSettingsToggles();
        buildMainModal();
        buildTagInfoModal();
        hookAutoDanbooruScan();
    });

})();