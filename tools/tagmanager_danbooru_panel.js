/* =========================================================================
   TAG INTERROGATOR PANEL (Standalone — usa tagmanager_danbooru_core.js e
   tagmanager_e621_core.js)
   ---------------------------------------------------------------------
   Não faz NENHUM fetch() direto à API — tudo passa pelas funções
   compartilhadas dos arquivos _core, que já cuidam dos caches próprios
   (window.danbooruCache / window.e621Cache), reaproveitados também pelo
   autocomplete e pelo sync de contagens.

   - Botão 🏷️ Tag Interrogator no topbar abre um popout (mesmo estilo
     .modal-overlay/.tool-modal usado por Trash/Archive) com busca manual
     de 1 tag + descrição da wiki. Um switch dentro do popout troca a
     fonte da busca manual entre 🅱️ Danbooru e 🦊 e621.
   - Toda tag com wiki cacheada no Danbooru ganha um ❓ ao lado do × de
     remover; se também tiver wiki cacheada no e621 (com "Enable e621
     Suggestions" ligado em Settings), ganha um ❔ separado do lado. Os
     dois podem aparecer juntos na mesma tag quando as duas fontes têm
     dado — cada um abre o popout da sua própria fonte.
   - O contador numérico ao lado da tag mostra o MAIOR valor entre
     Danbooru e e621 (ver window.pickBestTagCount em tagmanager_e621_core.js).
   - BACKGROUND SCAN AUTOMÁTICO: assim que um dataset novo é carregado
     (detectado via troca de referência de window.imageFiles, mesmo
     padrão de tagmanager_custom_conflicts.js), dispara sozinho — em
     segundo plano, sem alertas — um scan que vai preenchendo os ❓/❔
     incrementalmente conforme cada tag é resolvida. Tags já vistas
     antes (autocomplete, sync de contagem, busca manual) dentro do TTL
     não custam nova chamada de rede.
   - Botão manual "🔍 Scan Dataset Tags" continua existindo dentro do
     popout, para forçar um recheck (🔄, ignora o cache) quando precisar.
   - AUTOCOMPLETE NO CAMPO DE BUSCA MANUAL (dbpInput): usa a fonte
     selecionada no switch (window.dbSearchTagMatches ou
     window.e621SearchTagMatches), mostrando um dropdown com nome/
     categoria/contagem (e seta ➜ para tags-alias) enquanto o usuário
     digita. Clicar numa sugestão já dispara a busca.
========================================================================= */

(function () {

    const style = document.createElement('style');
    style.innerHTML = `
        #btn-open-tag-interrogator { color: #4db8ff; margin-left: 5px; }
        #btn-open-tag-interrogator:hover { color: #fff; border-color: #4db8ff; }

        .tag-db-info {
            color: #4db8ff; cursor: pointer; font-weight: bold; font-size: 1em;
            padding: 0 0.35em; flex-shrink: 0; opacity: 0.85; user-select: none;
        }
        .tag-db-info:hover { color: #fff; transform: scale(1.2); opacity: 1; }
        .tag-e621-info {
            color: #ffb74d; cursor: pointer; font-weight: bold; font-size: 1em;
            padding: 0 0.35em; flex-shrink: 0; opacity: 0.85; user-select: none;
        }
        .tag-e621-info:hover { color: #fff; transform: scale(1.2); opacity: 1; }
        /* Ghost rows (💡 sugestões) usam um container flex com gap maior —
           sem margem própria os ícones ficariam colados demais no ✓/×. */
        .tag-row.ghost .tag-db-info, .master-tag-item.ghost .tag-db-info,
        .tag-row.ghost .tag-e621-info, .master-tag-item.ghost .tag-e621-info { margin-right: -2px; }


        #modal-db-tag-info .tool-modal, #modal-e621-tag-info .tool-modal { width: 700px; max-width: 90vw; max-height: 80vh; overflow-y: auto; }
        #modal-danbooru .tool-modal { width: 1150px; max-width: 95vw; max-height: 90vh; overflow-y: auto; }

        .dbp-cards { display: flex; gap: 12px; margin-top: 12px; align-items: stretch; }
        .dbp-card { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; background: #0d0d0d; border: 1px solid #1e3d28; border-radius: 8px; overflow: hidden; }
        .dbp-card[data-site="danbooru"] { border-color: #1f4468; }
        .dbp-card[data-site="e621"] { border-color: #6b4a14; }
        .dbp-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 12px; background: #151515; border-bottom: 1px solid #222; font-size: 12px; font-weight: bold; flex-shrink: 0; }
        .dbp-card-status { font-size: 10px; color: #777; font-weight: normal; }
        .dbp-card-body { padding: 12px; display: flex; flex-direction: column; gap: 6px; height: 340px; overflow-y: auto; }
        .dbp-empty { color: #555; font-size: 13px; font-style: italic; text-align: center; padding: 24px 10px; }
        .dbp-tag-title { font-size: 16px; font-weight: bold; }
        .dbp-card-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
        .dbp-tr-btn { background: #2f1a5c; color: #b890ff; border: 1px solid #4a2a8c; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer; }
        .dbp-tr-btn:hover { background: #b890ff; color: #000; }
        .dbp-open-link { color: #4db8ff; text-decoration: none; border: 1px solid #2a5a8c; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block; }
        .dbp-open-link.e621 { color: #ffb74d; border-color: #aa7722; }
        .dbp-alias-box { background: #111; border: 1px dashed #333; border-radius: 6px; padding: 8px 10px; margin-bottom: 4px; font-size: 12px; }
        .dbp-alias-box .lbl { color: #888; font-size: 10px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px; display: block; }
        .dbp-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; justify-content: center; }
        .dbp-chip { background: #151515; border: 1px solid #2a3a4a; color: #9ecfff; border-radius: 14px; padding: 4px 12px; font-size: 12px; cursor: pointer; user-select: none; }
        .dbp-chip:hover { background: #1a3a5c; color: #fff; border-color: #4db8ff; }
        .dbp-src-badge { font-size: 9px; font-weight: bold; padding: 1px 5px; border-radius: 8px; margin-left: 5px; border: 1px solid; vertical-align: middle; }
        .dbp-src-badge.db { color: #4db8ff; border-color: #2a5a8c; background: #0a1a2a; }
        .dbp-src-badge.e6 { color: #ffb74d; border-color: #aa7722; background: #2a1a05; }
        @media (max-width: 800px) { .dbp-cards { flex-direction: column; } .dbp-card-body { height: 240px; } }

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

    /* ---------- DUAL LOOKUP: Danbooru + e621 SEARCHED TOGETHER, SIDE BY SIDE ----------
       Same idea as the Prompt Helper: one search box fires both sites at the
       same time and each site gets its own card listing what it found. Both
       lookups go through the shared _core files (same caches as autocomplete,
       counts and the background scan), so nothing is fetched twice. */
    const DBP_ESC = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const DBP_SITES = {
        danbooru: {
            key: 'danbooru', name: 'Danbooru', icon: '🅱️', badge: 'DB',
            host: () => 'danbooru.donmai.us',
            colors: () => DB_CAT_COLORS,
            labels: () => DB_CAT_LABELS,
            lookup: (t) => window.dbLookupSingleTag(t),
            search: (q, n) => window.dbSearchTagMatches(q, n),
            aliasBehavior: () => window.aliasClickBehavior || 'replace'
        },
        e621: {
            key: 'e621', name: 'e621', icon: '🦊', badge: 'e6',
            host: () => e621HostForLinks(),
            colors: () => window.E621_CAT_COLORS || {},
            labels: () => window.E621_CAT_LABELS || {},
            lookup: (t) => window.e621LookupSingleTag(t),
            search: (q, n) => window.e621SearchTagMatches(q, n),
            aliasBehavior: () => window.e621AliasClickBehavior || 'replace'
        }
    };

    let dbpSearchToken = 0;

    /* ---------- AUTOCOMPLETE (merged from both sites) ---------- */
    function setupDbpAutocomplete() {
        const input = document.getElementById('dbpInput');
        const wrap = document.getElementById('dbpInputWrap');
        if (!input || !wrap || wrap.__dbpAutocompleteInit) return;
        wrap.__dbpAutocompleteInit = true;

        const suggBox = document.createElement('div');
        suggBox.className = 'db-autocomplete direction-down';
        suggBox.style.display = 'none';
        wrap.appendChild(suggBox);
        wrap._suggBox = suggBox;

        let timeout = null;
        let token = 0;

        input.addEventListener('input', (e) => {
            clearTimeout(timeout);
            const rawVal = e.target.value.trim().toLowerCase();
            if (rawVal.length < 2) { suggBox.style.display = 'none'; return; }
            const val = rawVal.replace(/ /g, '_');
            const myToken = ++token;

            timeout = setTimeout(async () => {
                try {
                    const results = await Promise.all(Object.values(DBP_SITES).map(async (site) => {
                        try {
                            const list = typeof site.search === 'function' ? await site.search(val, 6) : [];
                            return (list || []).map(t => ({ ...t, _site: site.key }));
                        } catch (err) { return []; }
                    }));
                    if (myToken !== token) return; // stale response

                    const merged = new Map();
                    results.flat().forEach(t => {
                        const k = t.name.replace(/_/g, ' ').toLowerCase();
                        const ex = merged.get(k);
                        if (!ex) {
                            merged.set(k, { ...t, sites: [t._site] });
                        } else {
                            if (!ex.sites.includes(t._site)) ex.sites.push(t._site);
                            if ((t.post_count || 0) > (ex.post_count || 0)) ex.post_count = t.post_count;
                            if (!ex.isAlias && t.isAlias) { ex.isAlias = true; ex.aliasTo = t.aliasTo; }
                        }
                    });
                    const list = Array.from(merged.values()).sort((a, b) => (b.post_count || 0) - (a.post_count || 0)).slice(0, 10);

                    suggBox.innerHTML = '';
                    if (list.length === 0) { suggBox.style.display = 'none'; return; }

                    list.forEach(t => {
                        const firstSite = DBP_SITES[t.sites[0]];
                        const color = (firstSite.colors()[t.category]) || '#aaa';
                        const displayName = t.name.replace(/_/g, ' ');
                        const aliasToSpaced = t.isAlias ? t.aliasTo.replace(/_/g, ' ') : '';
                        const arrowHtml = t.isAlias ? ` <span class="db-alias-arrow">➜ ${DBP_ESC(aliasToSpaced)}</span>` : '';
                        const badges = t.sites.map(s => `<span class="dbp-src-badge ${s === 'e621' ? 'e6' : 'db'}">${DBP_SITES[s].badge}</span>`).join('');
                        const countHtml = (t.post_count > 0)
                            ? Number(t.post_count).toLocaleString()
                            : (t.isDeprecated ? 'Deprecated' : '0');

                        const div = document.createElement('div');
                        div.className = 'db-sugg-item';
                        div.innerHTML = `<span style="color:${color}; font-weight:bold;">${DBP_ESC(displayName)}${arrowHtml}${badges}</span><span style="color:#666;">${countHtml}</span>`;
                        div.onclick = () => {
                            suggBox.style.display = 'none';
                            const keepAlias = firstSite.aliasBehavior() === 'keep';
                            const finalTag = (t.isAlias && !keepAlias) ? aliasToSpaced : displayName;
                            input.value = finalTag;
                            dbpPerformSearch(finalTag);
                        };
                        suggBox.appendChild(div);
                    });
                    suggBox.style.display = 'block';
                } catch (err) {}
            }, 600);
        });

        // Reopen the list when the user clicks/focuses the box again
        const showSuggBoxIfValid = () => {
            if (input.value.trim().length >= 2 && suggBox.children.length > 0) suggBox.style.display = 'block';
        };
        input.addEventListener('focus', showSuggBoxIfValid);
        input.addEventListener('click', showSuggBoxIfValid);

        // Close the list when clicking anywhere else
        document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target) && suggBox.style.display === 'block') suggBox.style.display = 'none';
        }, true);
    }

    // BUG FIX: the "🔍✨ Auto-detect" list (#dbpDetectList) only closed when a chip
    // was clicked. Now it also closes when clicking outside it / its button.
    document.addEventListener('click', (e) => {
        const listEl = document.getElementById('dbpDetectList');
        const btnEl = document.getElementById('dbpDetectBtn');
        if (!listEl || !listEl.classList.contains('open')) return;
        if (listEl.contains(e.target)) return;
        if (btnEl && btnEl.contains(e.target)) return;
        listEl.classList.remove('open');
    });

    /* ---------- MODAL 1: DUAL MANUAL SEARCH + MANUAL SCAN ---------- */
    function buildMainModal() {
        if (document.getElementById('modal-danbooru')) return;

        const overlay = document.createElement('div');
        overlay.id = 'modal-danbooru';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-danbooru');

        const cardHtml = (site, titleColor) => `
            <div class="dbp-card" data-site="${site.key}">
                <div class="dbp-card-head">
                    <span style="color:${titleColor};">${site.icon} ${site.name}</span>
                    <span class="dbp-card-status" id="dbpStatus-${site.key}"></span>
                </div>
                <div class="dbp-card-body" id="dbpBody-${site.key}">
                    <div class="dbp-empty">Type a tag and press Search (or pick from the suggestions).</div>
                </div>
            </div>`;

        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🏷️ Tag Interrogator</span>
                    <button onclick="window.closeModal('modal-danbooru')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>

                <div class="dbp-row">
                    <div id="dbpInputWrap" style="position:relative; flex:1; min-width:0;">
                        <input type="text" id="dbpInput" class="dbp-input" placeholder="Search a tag... e.g. 1girl (searches Danbooru + e621 together)" autocomplete="off" style="width:100%; box-sizing:border-box;">
                    </div>
                    <button class="dbp-btn" id="dbpSearchBtn">Search</button>
                    <button class="dbp-btn-detect" id="dbpDetectBtn" title="List all tags already in this dataset (❓ Danbooru / ❔ e621 = already has wiki info cached)">🔍✨</button>
                </div>
                <div class="dbp-detect-list" id="dbpDetectList"></div>

                <div class="dbp-cards" id="dbpCards">
                    ${cardHtml(DBP_SITES.danbooru, '#4db8ff')}
                    ${cardHtml(DBP_SITES.e621, '#ffb74d')}
                </div>

                <hr style="border:0; border-top:1px solid #333; margin:14px 0;">

                <div style="font-size:11px; color:#888; margin-bottom:8px; line-height:1.5;">
                    Runs automatically in the background whenever a dataset is loaded
                    (uses the same shared caches as autocomplete and tag counts —
                    tags already seen elsewhere won't be re-fetched). Tags with a wiki
                    entry get a <b style="color:#4db8ff;">❓</b> (Danbooru) and/or a
                    <b style="color:#ffb74d;">❔</b> (e621) icon next to their remove (×)
                    button — both can show up together on shared tags. Use the buttons
                    below to force a manual scan / recheck (covers both sources).
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
        document.getElementById('dbpInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                dbpPerformSearch();
                const wrap = document.getElementById('dbpInputWrap');
                if (wrap && wrap._suggBox) wrap._suggBox.style.display = 'none';
            }
        });
        document.getElementById('dbpDetectBtn').onclick = () => dbpRunAutoDetect();

        // "Did you mean" chips inside the cards
        document.getElementById('dbpCards').addEventListener('click', (e) => {
            const chip = e.target.closest('.dbp-chip');
            if (!chip) return;
            const t = chip.getAttribute('data-tag');
            document.getElementById('dbpInput').value = t;
            dbpPerformSearch(t);
        });

        // Normal manual scan: respects TTL/cache, same as the background scan.
        document.getElementById('dbpScanBtn').onclick = () => window.runDanbooruInfoScan(false);

        // Forced manual scan: ignores the cache and rechecks everything.
        document.getElementById('dbpScanForceBtn').onclick = () => {
            if (confirm('Force recheck ALL dataset tags, even already-scanned ones?\nThis takes longer and hits the Danbooru API more.')) {
                window.runDanbooruInfoScan(true);
            }
        };

        setupDbpAutocomplete();
    }

    /* Searches ONE site and paints its card. */
    async function dbpSearchSite(site, tag, token) {
        const bodyEl = document.getElementById('dbpBody-' + site.key);
        const statusEl = document.getElementById('dbpStatus-' + site.key);
        if (!bodyEl || !statusEl) return;

        bodyEl.innerHTML = '<div class="dbp-empty">Loading...</div>';
        statusEl.textContent = '';

        const key = tag.trim().toLowerCase().replace(/_/g, ' ');
        let info = null;
        try {
            info = await site.lookup(tag);
        } catch (e) {
            if (token !== dbpSearchToken) return;
            bodyEl.innerHTML = `<div class="dbp-empty" style="color:#ff8080; font-style:normal;">Could not reach ${DBP_ESC(site.name)}.</div>`;
            statusEl.textContent = 'error';
            return;
        }
        if (token !== dbpSearchToken) return;

        // Tags marked "unknown" by the cores come back as an empty dummy — treat as not found.
        const isDummy = info && !info.aliasTo && !(info.count > 0) &&
            (!info.wikiName || (info.description && String(info.description).startsWith('Unknown custom tag')));

        if (!info || isDummy) {
            statusEl.textContent = 'not found';
            let suggestions = [];
            try { suggestions = await site.search(key.replace(/ /g, '_'), 6); } catch (e) {}
            if (token !== dbpSearchToken) return;

            let html = `<div class="dbp-empty">Tag "<b style="color:#ccc;">${DBP_ESC(key)}</b>" not found on ${DBP_ESC(site.name)}.</div>`;
            if (suggestions && suggestions.length) {
                html += `<div style="font-size:11px; color:#888; text-align:center;">Did you mean:</div><div class="dbp-chips">` +
                    suggestions.map(s => {
                        const n = s.name.replace(/_/g, ' ');
                        const c = (s.post_count > 0) ? Number(s.post_count).toLocaleString() : '';
                        return `<span class="dbp-chip" data-tag="${DBP_ESC(n)}">${DBP_ESC(n)}${c ? ` <span style="color:#666;">${c}</span>` : ''}</span>`;
                    }).join('') + `</div>`;
            }
            bodyEl.innerHTML = html;
            return;
        }

        const host = site.host();
        const catColors = site.colors();
        const catLabels = site.labels();
        const targetName = (info.aliasTo || key).replace(/_/g, ' ');
        const wikiName = info.wikiName || targetName.replace(/ /g, '_');
        const deprecated = !!(info.isDeprecated || info.aliasTo);
        statusEl.textContent = Number(info.count || 0).toLocaleString() + ' posts';

        let html = '';
        if (info.aliasTo) {
            html += `<div class="dbp-alias-box">
                <span class="lbl">Original tag (deprecated)</span><b style="color:#ffcc66;">${DBP_ESC(key)}</b>
                <span class="lbl" style="margin-top:6px;">Redirects to</span><b style="color:#00ff99;">${DBP_ESC(targetName)}</b>
                <div style="font-size:11px; color:#777; margin-top:6px; line-height:1.4;">${DBP_ESC(site.name)} merged the original tag into the one above. The count and wiki below belong to the new tag.</div>
            </div>`;
        }
        html += `<div class="dbp-tag-title" style="color:${site.key === 'e621' ? '#ffb74d' : '#4db8ff'};">${DBP_ESC(targetName)}</div>`;
        html += `<div class="dbp-tag-cat"><span style="color:${catColors[info.category] || '#888'}">● ${DBP_ESC(catLabels[info.category] || 'Unknown')}</span> · ${Number(info.count || 0).toLocaleString()} posts${deprecated ? ' <span style="color:#888;">· Deprecated</span>' : ''}</div>`;
        html += `<div class="dbp-desc" id="dbpDesc-${site.key}">Loading full wiki description...</div>`;
        html += `<div class="dbp-card-actions">
            <button class="dbp-tr-btn" id="dbpTr-${site.key}" style="display:none;">🌐 Translate</button>
            <a href="https://${host}/wiki_pages/${encodeURIComponent(wikiName)}" target="_blank" class="dbp-open-link ${site.key}">Open on ${DBP_ESC(site.name)} ↗</a>
        </div>`;
        bodyEl.innerHTML = html;

        const descEl = document.getElementById('dbpDesc-' + site.key);
        const trBtn = document.getElementById('dbpTr-' + site.key);
        descEl.dataset.original = '';

        try {
            const wRes = await fetch(`https://${host}/wiki_pages/${encodeURIComponent(wikiName)}.json`);
            if (token !== dbpSearchToken) return;
            if (wRes.ok) {
                const wData = await wRes.json();
                if (wData && wData.body && wData.body.trim()) {
                    descEl.dataset.original = wData.body;
                    // formatDanbooruDText builds Danbooru links; point them to this card's own site.
                    descEl.innerHTML = window.formatDanbooruDText(wData.body).split('https://danbooru.donmai.us/').join(`https://${host}/`);
                    trBtn.style.display = 'inline-block';
                    trBtn.onclick = () => translateDescNode(descEl);
                } else {
                    descEl.innerHTML = `No wiki description available on ${DBP_ESC(site.name)}.`;
                }
            } else {
                descEl.innerHTML = 'Wiki not found or error loading.';
            }
        } catch (e) {
            if (token !== dbpSearchToken) return;
            if (info.hasWikiInfo && info.description) {
                descEl.dataset.original = info.description;
                descEl.innerHTML = window.formatDanbooruDText(info.description);
                trBtn.style.display = 'inline-block';
                trBtn.onclick = () => translateDescNode(descEl);
            } else {
                descEl.innerHTML = 'No wiki description available.';
            }
        }
    }

    /* Fires BOTH sites at the same time. */
    async function dbpPerformSearch(tagOverride) {
        const input = document.getElementById('dbpInput');
        const tag = (tagOverride || input.value).trim();
        if (!tag) return;
        input.value = tag;

        const wrap = document.getElementById('dbpInputWrap');
        if (wrap && wrap._suggBox) wrap._suggBox.style.display = 'none';

        const token = ++dbpSearchToken;
        await Promise.all(Object.values(DBP_SITES).map(site => dbpSearchSite(site, tag, token)));
    }

    function e621HostForLinks() {
        return window.showE621Sfw ? 'e926.net' : 'e621.net';
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
            const dbInfo = window.dbGetCachedTag(t.toLowerCase());
            const e6Info = window.e621GetCachedTag ? window.e621GetCachedTag(t.toLowerCase()) : null;
            const hasAny = (dbInfo && dbInfo.hasWikiInfo) || (e6Info && e6Info.hasWikiInfo);
            if (hasAny) withInfo.push(t); else withoutInfo.push(t);
        });
        withInfo.sort();
        withoutInfo.sort();

        [...withInfo, ...withoutInfo].forEach(t => {
            const key = t.toLowerCase();
            const dbInfo = window.dbGetCachedTag(key);
            const e6Info = window.e621GetCachedTag ? window.e621GetCachedTag(key) : null;
            const hasDb = !!(dbInfo && dbInfo.hasWikiInfo);
            const hasE6 = !!(e6Info && e6Info.hasWikiInfo);
            const hasInfo = hasDb || hasE6;
            const prefix = (hasDb ? '❓' : '') + (hasE6 ? '❔' : '');

            const chip = document.createElement('span');
            chip.className = 'dbp-detect-item' + (hasInfo ? ' has-info' : '');
            chip.textContent = (prefix ? prefix + ' ' : '') + t;
            chip.title = hasInfo ? 'Already has wiki info — click to look it up again' : 'Click to look this tag up';
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
            const deprecatedBadge1 = (info.isDeprecated) ? ` <span style="color:#888;">· Deprecated</span>` : '';
            catEl.innerHTML = `<span style="color:${DB_CAT_COLORS[info.category] || '#888'}">● ${DB_CAT_LABELS[info.category] || 'Unknown'} (${Number(info.count || 0).toLocaleString()} posts)</span>${deprecatedBadge1}`;
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

    /* ---------- MODAL 3: POPOUT DE INFO DO E621 (aberto pelo ❔) ----------
       Espelha o modal-db-tag-info, mas em modal PRÓPRIO — assim, se a tag
       tiver info nas duas fontes, os ícones ❓ e ❔ abrem popouts distintos
       (nunca um "pisa" no conteúdo do outro). */
    function buildE621TagInfoModal() {
        if (document.getElementById('modal-e621-tag-info')) return;

        const overlay = document.createElement('div');
        overlay.id = 'modal-e621-tag-info';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-e621-tag-info');

        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="color:#ffb74d;">❔ e621 Tag Info</span>
                    <button onclick="window.closeModal('modal-e621-tag-info')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>

                <div><span class="dbp-tag-cat" id="e621iTagCat"></span></div>
                <div class="dbp-desc" id="e621iTagDesc"></div>

                <div style="display:flex; gap:8px; align-items:center; margin-top:12px;">
                    <button id="e621iTranslateBtn" style="background: #2f1a5c; color: #b890ff; border: 1px solid #4a2a8c; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer;">🌐 Translate</button>
                    <a href="#" target="_blank" id="e621iTagLink" style="color: #ffb74d; text-decoration: none; border: 1px solid #aa7722; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: bold; display: inline-block;">Open on e621 ↗</a>
                </div>

                <div class="modal-buttons" style="margin-top: 15px;">
                    <button class="btn-cancel" onclick="window.closeModal('modal-e621-tag-info')">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('e621iTranslateBtn').onclick = () => translateDescNode(document.getElementById('e621iTagDesc'));
    }

    window.openE621TagInfoPopout = async function (tagLower) {
        buildE621TagInfoModal();

        const catEl = document.getElementById('e621iTagCat');
        const descEl = document.getElementById('e621iTagDesc');
        const linkEl = document.getElementById('e621iTagLink');
        const host = e621HostForLinks();

        descEl.innerHTML = "Loading full wiki description...";
        descEl.dataset.original = "";
        catEl.innerHTML = '';
        linkEl.href = `https://${host}/wiki_pages/${encodeURIComponent(tagLower.replace(/ /g, '_'))}`;

        window.openModal('modal-e621-tag-info');

        let info = window.e621GetCachedTag(tagLower);
        if (!info || info.count === undefined) {
            if (window.e621LookupSingleTag) info = await window.e621LookupSingleTag(tagLower);
        }

        if (info) {
            const deprecatedBadge = (info.isDeprecated) ? ` <span style="color:#888;">· Deprecated</span>` : '';
            catEl.innerHTML = `<span style="color:${window.E621_CAT_COLORS[info.category] || '#888'}">● ${window.E621_CAT_LABELS[info.category] || 'Unknown'} (${Number(info.count || 0).toLocaleString()} posts)</span>${deprecatedBadge}`;
        }

        try {
            const wRes = await fetch(`https://${host}/wiki_pages/${encodeURIComponent((info && info.wikiName) ? info.wikiName : tagLower.replace(/ /g, '_'))}.json`);
            if (wRes.ok) {
                const wData = await wRes.json();
                if (wData && wData.body && wData.body.trim()) {
                    descEl.dataset.original = wData.body;
                    descEl.innerHTML = window.formatDanbooruDText(wData.body);
                } else {
                    descEl.innerHTML = "No wiki description available on e621.";
                }
            } else {
                descEl.innerHTML = "Wiki not found or error loading.";
            }
        } catch (e) {
            if (info && info.hasWikiInfo && info.description) {
                descEl.dataset.original = info.description;
                descEl.innerHTML = window.formatDanbooruDText(info.description);
            } else {
                descEl.innerHTML = "Error loading wiki from e621.";
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

        const tags = collectInfoScanTags();
        if (tags.length === 0) {
            if (window.showAlert) window.showAlert('No tags to scan in this dataset.', 'info');
            return;
        }

        window._dbInfoScanRunning = true;
        window._dbBackgroundScanCancelled = false;
        window._e621BackgroundScanCancelled = false;

        const scanBtn = document.getElementById('dbpScanBtn');
        const forceBtn = document.getElementById('dbpScanForceBtn');
        const progress = document.getElementById('dbpScanProgress');
        if (scanBtn) scanBtn.disabled = true;
        if (forceBtn) forceBtn.disabled = true;
        if (progress) { progress.style.display = 'block'; progress.textContent = 'Fetching counts/categories...'; }

        // Etapa 1: contagem+categoria em lote (reaproveita cache do autocomplete/sync)
        await window.dbFetchCountsBatch(tags, force);
        if (window.showE621 && typeof window.e621FetchCountsBatch === 'function') await window.e621FetchCountsBatch(tags, force);

        // Etapa 2: descrição da wiki, só onde ainda falta (ou tudo, se force)
        const result = await window.dbFetchWikiBatch(
            tags,
            force,
            () => scheduleIconRefresh(),
            (done, total, found) => {
                if (progress) progress.textContent = `Scanning Danbooru: ${done} / ${total} (found ${found})`;
            }
        );

        let e621Found = 0;
        if (window.showE621 && typeof window.e621FetchWikiBatch === 'function') {
            const e621Result = await window.e621FetchWikiBatch(
                tags,
                force,
                () => scheduleIconRefresh(),
                (done, total, found) => {
                    if (progress) progress.textContent = `Scanning e621: ${done} / ${total} (found ${found})`;
                }
            );
            e621Found = e621Result.found;
        }

        window._dbInfoScanRunning = false;
        if (scanBtn) scanBtn.disabled = false;
        if (forceBtn) forceBtn.disabled = false;
        if (progress) progress.style.display = 'none';

        refreshTagRenders();

        if (window.showAlert) {
            const extra = window.showE621 ? ` + ${e621Found} on e621` : '';
            window.showAlert(`Scan complete! Found wiki info for ${result.found} tag(s) on Danbooru${extra}.`, 'success');
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

        const tags = collectInfoScanTags();
        if (tags.length === 0) return;

        window._dbInfoScanRunning = true;
        window._dbBackgroundScanCancelled = false;
        window._e621BackgroundScanCancelled = false;

        const scanBtn = document.getElementById('dbpScanBtn');
        const forceBtn = document.getElementById('dbpScanForceBtn');
        const progress = document.getElementById('dbpScanProgress');
        if (scanBtn) scanBtn.disabled = true;
        if (forceBtn) forceBtn.disabled = true;
        if (progress) { progress.style.display = 'block'; progress.textContent = 'Background scan running...'; }

        await window.dbFetchCountsBatch(tags, false);
        if (window.showE621 && typeof window.e621FetchCountsBatch === 'function') await window.e621FetchCountsBatch(tags, false);

        await window.dbFetchWikiBatch(
            tags,
            false,
            () => scheduleIconRefresh(),
            (done, total, found) => {
                if (progress) progress.textContent = `Background scan (Danbooru): ${done} / ${total} (found ${found})`;
            }
        );

        if (window.showE621 && typeof window.e621FetchWikiBatch === 'function') {
            await window.e621FetchWikiBatch(
                tags,
                false,
                () => scheduleIconRefresh(),
                (done, total, found) => {
                    if (progress) progress.textContent = `Background scan (e621): ${done} / ${total} (found ${found})`;
                }
            );
        }

        window._dbInfoScanRunning = false;
        if (scanBtn) scanBtn.disabled = false;
        if (forceBtn) forceBtn.disabled = false;
        if (progress) progress.style.display = 'none';
        refreshTagRenders();
    };

    function detectDatasetChangeForDbScan() {
        if (typeof imageFiles !== 'undefined' && imageFiles !== window._dbInfoLastImageFilesRef) {
            window._dbInfoLastImageFilesRef = imageFiles;
            window._dbBackgroundScanCancelled = true;
            setTimeout(() => {
                window._dbBackgroundScanCancelled = false;
                window.runDanbooruBackgroundScan();
            }, 600);
        }
    }

    /* FIX (otimização): antes este arquivo sempre envelopava
       window.renderImageList manualmente por conta própria, empilhando mais
       uma camada de wrap em cima das já existentes (pin_image, compact_view,
       auto_task_queue etc — exatamente o padrão que tagmanager_render_hooks.js
       foi criado pra eliminar). Agora usa o registry central quando
       disponível (carrega antes deste arquivo no HTML) e só cai pro wrap
       manual antigo como rede de segurança, caso a ordem dos <script> mude
       no futuro. */
    function hookAutoDanbooruScan() {
        if (typeof window.registerPostRenderImageList === 'function') {
            if (!window._dbAutoScanHookRegistered) {
                window.registerPostRenderImageList(detectDatasetChangeForDbScan);
                window._dbAutoScanHookRegistered = true;
            }
            return;
        }
        if (typeof window.renderImageList !== 'function' || window.renderImageList.__dbAutoScanWrapped) return;
        const original = window.renderImageList;
        const wrapped = function () {
            original.apply(this, arguments);
            detectDatasetChangeForDbScan();
        };
        wrapped.__dbAutoScanWrapped = true;
        window.renderImageList = wrapped;
    }

    /* ---------- INJEÇÃO DO ❓/❔ NAS LINHAS DE TAG ----------
       Os dois ícones são independentes: ❓ aparece se o Danbooru tiver wiki
       cacheada pra essa tag, ❔ aparece se o e621 tiver (e "Enable e621
       Suggestions" estiver ligado em Settings) — os dois podem aparecer
       juntos na mesma tag quando ela existe/tem wiki nas duas fontes. */
    function injectDbInfoIcons(container) {
        if (!container) return;
        if (!window.danbooruInfoEnabled || !window.danbooruInfoShowIcons) return;

        container.querySelectorAll('[data-tag-name]').forEach(row => {
            const removeBtn = row.querySelector('.tag-remove');
            if (!removeBtn) return; 

            const tagLower = row.getAttribute('data-tag-name');

            const dbInfo = window.dbGetCachedTag(tagLower);
            if (dbInfo && dbInfo.hasWikiInfo && !row.querySelector('.tag-db-info')) {
                const icon = document.createElement('span');
                icon.className = 'tag-db-info';
                icon.textContent = '❓';
                icon.title = 'View Danbooru info for this tag';
                icon.onclick = (e) => { e.stopPropagation(); window.openDanbooruTagInfoPopout(tagLower); };
                removeBtn.parentNode.insertBefore(icon, removeBtn);
            }

            const e6Info = window.showE621 && window.e621GetCachedTag ? window.e621GetCachedTag(tagLower) : null;
            if (e6Info && e6Info.hasWikiInfo && !row.querySelector('.tag-e621-info')) {
                const icon = document.createElement('span');
                icon.className = 'tag-e621-info';
                icon.textContent = '❔';
                icon.title = 'View e621 info for this tag';
                icon.onclick = (e) => { e.stopPropagation(); window.openE621TagInfoPopout(tagLower); };
                removeBtn.parentNode.insertBefore(icon, removeBtn);
            }
        });
    }

    /* Tags do dataset + sugestões 💡 (pendingAdd). Ghosts não entram em
       masterTagSet, então o scan antigo nunca buscava a wiki delas e o
       ❓/❔ nunca tinha o que mostrar. */
    function collectInfoScanTags() {
        const set = new Set();
        if (typeof masterTagSet !== 'undefined') {
            masterTagSet.forEach(t => { if (t && !String(t).startsWith('NL:')) set.add(t); });
        }
        if (typeof imageFiles !== 'undefined') {
            imageFiles.forEach(img => {
                (img.pendingAdd || []).forEach(t => {
                    const c = (t || '').trim();
                    if (!c || c.startsWith('NL:')) return;
                    if (typeof window.checkIfNL === 'function' && window.checkIfNL(c)) return;
                    set.add(c);
                });
            });
        }
        return Array.from(set);
    }

    function injectGhostDbInfoIcons(container, ghostSelector) {
        if (!container) return;
        if (!window.danbooruInfoEnabled || !window.danbooruInfoShowIcons) return;

        container.querySelectorAll(ghostSelector).forEach(row => {
            const rejectBtn = row.querySelector('.tag-ghost-reject');
            if (!rejectBtn) return;

            const nameEl = row.querySelector('.tag-name');
            const tagLower = (row.getAttribute('data-tag-name') || (nameEl ? nameEl.textContent : '') || '').trim().toLowerCase();
            if (!tagLower || tagLower.startsWith('nl:')) return;
            if (typeof window.checkIfNL === 'function' && window.checkIfNL(tagLower)) return;

            // Wiki já resolvida: igual às tags normais (só mostra se tiver info).
            // Ainda não checada: mostra mesmo assim — o clique abre o popout,
            // que busca a wiki na hora. Ghosts quase nunca passam pelo scan
            // antes de aparecer, então sem isto o ícone nunca existia.
            const dbInfo = typeof window.dbGetCachedTag === 'function' ? window.dbGetCachedTag(tagLower) : null;
            const dbResolved = !!(dbInfo && dbInfo.wikiChecked);
            if ((!dbResolved || dbInfo.hasWikiInfo) && !row.querySelector('.tag-db-info')) {
                const icon = document.createElement('span');
                icon.className = 'tag-db-info';
                icon.textContent = '❓';
                icon.title = 'View Danbooru info for this tag';
                icon.onclick = (e) => { e.stopPropagation(); window.openDanbooruTagInfoPopout(tagLower); };
                rejectBtn.parentNode.insertBefore(icon, rejectBtn);
            }

            if (!window.showE621 || typeof window.e621GetCachedTag !== 'function') return;
            const e6Info = window.e621GetCachedTag(tagLower);
            const e6Resolved = !!(e6Info && e6Info.wikiChecked);
            if ((!e6Resolved || e6Info.hasWikiInfo) && !row.querySelector('.tag-e621-info')) {
                const icon = document.createElement('span');
                icon.className = 'tag-e621-info';
                icon.textContent = '❔';
                icon.title = 'View e621 info for this tag';
                icon.onclick = (e) => { e.stopPropagation(); window.openE621TagInfoPopout(tagLower); };
                rejectBtn.parentNode.insertBefore(icon, rejectBtn);
            }
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
                injectGhostDbInfoIcons(el, '.tag-row.ghost');
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
                injectGhostDbInfoIcons(el, '.master-tag-item.ghost');
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
        if (!rightBar || !anchor || document.getElementById('btn-open-tag-interrogator')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-open-tag-interrogator';
        btn.title = 'Search Danbooru/e621 tags & scan dataset for tag info';
        btn.textContent = '🏷️ Tag Interrogator';
        btn.onclick = () => { buildMainModal(); window.openModal('modal-danbooru'); };
        rightBar.insertBefore(btn, anchor);
        updateTopbarButtonVisibility();
    }

    function updateTopbarButtonVisibility() {
        const btn = document.getElementById('btn-open-tag-interrogator');
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
        subLabel.textContent = '❓❔ Tag Interrogator (Wiki Scan)';

        const lblMaster = document.createElement('label');
        lblMaster.innerHTML = `<input type="checkbox" id="toggle-db-info-master"> Enable Tag Interrogator`;

        const lblIcons = document.createElement('label');
        lblIcons.style.marginLeft = '15px';
        lblIcons.innerHTML = `<input type="checkbox" id="toggle-db-info-icons"> Show ❓/❔ icons on tags`;

        const lblButton = document.createElement('label');
        lblButton.style.marginLeft = '15px';
        lblButton.innerHTML = `<input type="checkbox" id="toggle-db-info-button"> Show 🏷️ Tag Interrogator button in topbar`;

        const lblE621Note = document.createElement('div');
        lblE621Note.style.cssText = 'font-size:10px; color:#666; margin-left:15px; margin-top:-2px;';
        lblE621Note.textContent = 'The ❔ e621 icon also needs "Enable e621 Suggestions" turned on above.';

        let cursor = (insertPoint && insertPoint.parentNode === dropdown) ? insertPoint : null;
        [subLabel, lblMaster, lblIcons, lblButton, lblE621Note].forEach(el => {
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
        buildE621TagInfoModal();
        hookAutoDanbooruScan();
    });

})();