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
     de 1 tag + descrição da wiki, Danbooru e e621 lado a lado.
   - Toda tag com wiki cacheada ganha UM ícone ao lado do × de remover
     (mesmo sistema dos User Presets): ❓ só Danbooru · ❔ só e621 ·
     ⁉️ nos dois. O ⁉️ abre o Tag Interrogator com a tag já buscada.
   - O contador numérico ao lado da tag mostra o MAIOR valor entre
     Danbooru e e621 (ver window.pickBestTagCount em tagmanager_e621_core.js).
   - BACKGROUND SCAN AUTOMÁTICO: assim que um dataset novo é carregado
     (detectado via troca de referência de window.imageFiles), dispara
     sozinho — em segundo plano, sem alertas — um scan que vai
     preenchendo os ❓/❔ incrementalmente.
   - Botões manuais dentro do popout: 🔍 Scan, 🔄 Force recheck e
     ♻️ Recheck unknown tags (re-verifica as tags guardadas como
     "unknown" nas duas fontes).

   OPÇÕES (agora dentro do popout, não mais na engrenagem):
   - Show ❓ Danbooru wiki icons   -> window.danbooruInfoShowIcons
   - Enable e621 (Furry) Suggestions -> setting 'toggle-e621' (também liga
     o ícone ❔ e as contagens/sugestões do e621)
   - Force Safe-for-Work (e926)    -> setting 'toggle-e621-sfw'

   CHAVE MESTRA (única coisa que sobra na engrenagem):
   "Enable Tag Interrogator" (window.danbooruInfoEnabled). Desligada, TODA
   a função Danbooru/e621 para: sem rede (as funções de fetch dos _core
   ficam bloqueadas por um guard), sem scan, sem contagens/alias/ícones,
   sem autocomplete da API (cai para as tags já usadas no dataset), sem o
   botão do topbar e sem o grupo Danbooru da engrenagem.
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
        .tag-both-info {
            cursor: pointer; font-size: 1em; padding: 0 0.35em; flex-shrink: 0;
            opacity: 0.85; user-select: none; display: inline-block;
        }
        .tag-both-info:hover { transform: scale(1.2); opacity: 1; }
        /* Ghost rows (💡 sugestões) usam um container flex com gap maior —
           sem margem própria os ícones ficariam colados demais no ✓/×. */
        .tag-row.ghost .tag-db-info, .master-tag-item.ghost .tag-db-info,
        .tag-row.ghost .tag-e621-info, .master-tag-item.ghost .tag-e621-info,
        .tag-row.ghost .tag-both-info, .master-tag-item.ghost .tag-both-info { margin-right: -2px; }


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
        .dbp-btn-recheck { background: #2a1a00; color: #ffcc66; border: 1px solid #aa6600; border-radius: 6px; padding: 8px 12px; cursor: pointer; font-size: 12px; font-weight: bold; white-space: nowrap; }
        .dbp-btn-recheck:hover { background: #aa6600; color: #000; }
        .dbp-btn-recheck:disabled { opacity: 0.5; cursor: not-allowed; }

        .dbp-opts { display: flex; flex-wrap: wrap; gap: 6px 22px; align-items: center; background: #0d0d0d; border: 1px solid #222; border-radius: 6px; padding: 9px 12px; margin-bottom: 10px; }
        .dbp-opts label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9ecfff; font-weight: bold; cursor: pointer; user-select: none; }
        .dbp-opts input[type="checkbox"] { width: auto; margin: 0; accent-color: #00ff99; }
        .dbp-opts .dbp-opt-note { color: #666; font-weight: normal; font-size: 10px; }
        .dbp-opts label.dbp-opt-e6 { color: #ffb74d; }
        .dbp-opts label.dbp-opt-sub { color: #ffcc66; margin-left: -10px; }

        .dbp-alias-opts { background: #0d0d0d; border: 1px solid #222; border-radius: 6px; margin-bottom: 10px; }
        .dbp-alias-opts > summary { cursor: pointer; padding: 8px 12px; font-size: 12px; font-weight: bold; color: #ccc; user-select: none; }
        .dbp-alias-opts[open] > summary { border-bottom: 1px solid #222; }
        .dbp-alias-main { display: flex; align-items: center; gap: 8px; padding: 10px 12px 0; font-size: 12px; color: #ccc; flex-wrap: wrap; }
        .dbp-alias-main select { flex: 1 1 220px; font-size: 11px; background: #111; color: #ddd; border: 1px solid #333; border-radius: 4px; padding: 4px; }
        .dbp-alias-cols { display: flex; gap: 12px; padding: 10px 12px; }
        .dbp-alias-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
        .dbp-alias-col .hd { font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
        .dbp-alias-col label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #ccc; cursor: pointer; user-select: none; }
        .dbp-alias-col input[type="checkbox"] { width: auto; margin: 0; accent-color: #00ff99; }
        .dbp-alias-col select { width: 100%; font-size: 11px; background: #111; color: #ddd; border: 1px solid #333; border-radius: 4px; padding: 4px; }
        .dbp-alias-col input[type="number"] { width: 52px; background: #111; color: #fff; border: 1px solid #444; border-radius: 4px; padding: 2px 6px; }
        .dbp-alias-col .dbp-opt-sub2 { margin-left: 20px; color: #999; font-size: 11px; }
        @media (max-width: 800px) { .dbp-alias-cols { flex-direction: column; } }
        .dbp-info { font-size: 11px; color: #888; margin-bottom: 10px; line-height: 1.6; }
        .dbp-info b { color: #ccc; }

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

    /* ---------- ESTADO ----------
       danbooruInfoEnabled   = chave mestra (engrenagem)
       danbooruInfoShowIcons = checkbox "Show ❓ Danbooru wiki icons" (popout)
       _e621Choice / _e621SfwChoice = escolha SALVA do usuário (popout).
       window.showE621 é DERIVADO: só fica true com a chave mestra ligada. */
    window.danbooruInfoEnabled = window.danbooruInfoEnabled !== undefined ? window.danbooruInfoEnabled : true;
    window.danbooruInfoShowIcons = window.danbooruInfoShowIcons !== undefined ? window.danbooruInfoShowIcons : true;
    window._e621Choice = window._e621Choice !== undefined ? window._e621Choice : false;
    window._e621SfwChoice = window._e621SfwChoice !== undefined ? window._e621SfwChoice : false;
    window._dbInfoScanRunning = window._dbInfoScanRunning || false;
    window._dbBackgroundScanCancelled = window._dbBackgroundScanCancelled || false;

    /* ---------- GUARD DE REDE (chave mestra desligada) ----------
       Embrulha as funções públicas de rede dos dois _core. Desligado, nada
       sai pro Danbooru/e621. As de resolução de alias REJEITAM (em vez de
       devolver null) para que um lote que já estava rodando aborte em vez
       de interpretar "sem resposta" como "tag inexistente" e marcá-la como
       unknown por engano. */
    (function installDisableGuards() {
        const off = () => window.danbooruInfoEnabled === false;
        const guard = (name, offValue) => {
            const fn = window[name];
            if (typeof fn !== 'function' || fn.__ifaceGuard) return;
            const wrapped = function () {
                if (off()) return offValue();
                return fn.apply(this, arguments);
            };
            wrapped.__ifaceGuard = true;
            window[name] = wrapped;
        };
        const noCounts = () => Promise.resolve({ fetched: 0 });
        const noWiki = () => Promise.resolve({ fetched: 0, found: 0 });
        const noInfo = () => Promise.resolve(null);
        const noList = () => Promise.resolve([]);
        const noAlias = () => Promise.reject(new Error('Tag Interrogator is disabled'));

        guard('dbFetchCountsBatch', noCounts);
        guard('dbFetchWikiBatch', noWiki);
        guard('dbLookupSingleTag', noInfo);
        guard('dbSearchTagMatches', noList);
        guard('dbResolveAlias', noAlias);
        guard('e621FetchCountsBatch', noCounts);
        guard('e621FetchWikiBatch', noWiki);
        guard('e621LookupSingleTag', noInfo);
        guard('e621SearchTagMatches', noList);
        guard('e621ResolveAlias', noAlias);

        // Preview reverso de aliases (Danbooru + e621) some junto.
        const alias = window.renderCombinedAliasPreviewHTML;
        if (typeof alias === 'function' && !alias.__ifaceGuard) {
            const wrapped = function () { return off() ? '' : alias.apply(this, arguments); };
            wrapped.__ifaceGuard = true;
            window.renderCombinedAliasPreviewHTML = wrapped;
        }
    })();

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
                        // e621 alias segue a "Main alias source" (padrão: Danbooru manda).
                        const dbMain = (t._site === 'e621' && window.isDanbooruMainTag ? window.isDanbooruMainTag(k) : false)
                            || !!(ex && ex.sites.includes('danbooru') && !ex.isAlias);
                        const useAlias = !!t.isAlias && (t._site !== 'e621' || !window.allowE621Alias || window.allowE621Alias(dbMain));
                        if (!ex) {
                            merged.set(k, { ...t, isAlias: useAlias, aliasTo: useAlias ? t.aliasTo : null, aliasSite: useAlias ? t._site : null, sites: [t._site] });
                        } else {
                            if (!ex.sites.includes(t._site)) ex.sites.push(t._site);
                            if ((t.post_count || 0) > (ex.post_count || 0)) ex.post_count = t.post_count;
                            const e6First = t._site === 'e621' && window.getAliasPrimarySource && window.getAliasPrimarySource() === 'e621';
                            if (useAlias && (!ex.isAlias || e6First)) { ex.isAlias = true; ex.aliasTo = t.aliasTo; ex.aliasSite = t._site; }
                        }
                    });
                    const list = Array.from(merged.values()).sort((a, b) => (b.post_count || 0) - (a.post_count || 0)).slice(0, 10);

                    suggBox.innerHTML = '';
                    if (list.length === 0) { suggBox.style.display = 'none'; return; }

                    list.forEach(t => {
                        const firstSite = DBP_SITES[t.sites[0]];
                        const srcColors = window.TAG_SOURCE_COLORS || { danbooru: '#4db8ff', e621: '#f48fb1' };
                        const color = t.sites.includes('danbooru') ? srcColors.danbooru : srcColors.e621;
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
                            const keepAlias = (DBP_SITES[t.aliasSite] || firstSite).aliasBehavior() === 'keep';
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

    /* ---------- MODAL 1: DUAL MANUAL SEARCH + OPTIONS + SCAN ---------- */
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

                <div class="dbp-opts">
                    <label title="Show a ❓ icon on tags that have a Danbooru wiki entry (tag lists and User Presets)."><input type="checkbox" id="dbpOptDbIcons"> Show ❓ Danbooru wiki icons</label>
                    <label class="dbp-opt-e6" title="Use e621 for tag suggestions, counts and ❔ wiki icons."><input type="checkbox" id="toggle-e621"> Enable e621 (Furry) Suggestions <span class="dbp-opt-note">(also shows the ❔ e621 icons)</span></label>
                    <label class="dbp-opt-e6 dbp-opt-sub" title="Use e926.net (safe-for-work) instead of e621.net."><input type="checkbox" id="toggle-e621-sfw"> 🛡️ Force Safe-for-Work (e926)</label>
                </div>

                <details class="dbp-alias-opts" id="dbpAliasOpts">
                    <summary>↪️ Alias tags (redirects)</summary>
                    <div class="dbp-alias-main" title="Which site decides the main tag when a tag is an alias. With Danbooru as main, an e621 alias is ignored for any tag that is a valid main tag on Danbooru.">
                        <label for="dbpAliasPrimary">Main alias source:</label>
                        <select id="dbpAliasPrimary">
                            <option value="danbooru">Danbooru (e621 only for tags Danbooru doesn't know)</option>
                            <option value="danbooru-only">Danbooru only (never suggest e621 aliases)</option>
                            <option value="e621">e621 first (Danbooru as fallback)</option>
                        </select>
                    </div>
                    <div class="dbp-alias-cols">
                        <div class="dbp-alias-col">
                            <span class="hd" style="color:#4db8ff;">🅱️ Danbooru</span>
                            <label title="What happens when you pick a suggestion that is an alias (e.g. anime screencap ➜ anime screenshot).">On suggestion click:</label>
                            <select id="dbpAliasDbClick">
                                <option value="replace">Replace with the main tag</option>
                                <option value="keep">Keep the alias (uses the main tag's count)</option>
                            </select>
                            <label title="Clicking the name/arrow of an alias tag in the tag lists asks to convert it to the main tag in the whole dataset."><input type="checkbox" id="dbpAliasDbConvert"> 🖱️ Click alias tag to convert it globally</label>
                            <label title="Shows, next to a main tag, which alias tags (already seen) point to it."><input type="checkbox" id="dbpAliasDbPreview"> ↩️ Show alias tags next to their main tag</label>
                            <label class="dbp-opt-sub2">Max shown: <input type="number" id="dbpAliasDbMax" min="1" max="30"></label>
                        </div>
                        <div class="dbp-alias-col">
                            <span class="hd" style="color:#f48fb1;">🦊 e621</span>
                            <label title="What happens when you pick a suggestion that is an alias (e.g. anime screencap ➜ anime screenshot).">On suggestion click:</label>
                            <select id="dbpAliasE6Click">
                                <option value="replace">Replace with the main tag</option>
                                <option value="keep">Keep the alias (uses the main tag's count)</option>
                            </select>
                            <label title="Clicking the name/arrow of an alias tag in the tag lists asks to convert it to the main tag in the whole dataset."><input type="checkbox" id="dbpAliasE6Convert"> 🖱️ Click alias tag to convert it globally</label>
                            <label title="Shows, next to a main tag, which alias tags (already seen) point to it."><input type="checkbox" id="dbpAliasE6Preview"> ↩️ Show alias tags next to their main tag</label>
                            <label class="dbp-opt-sub2">Max shown: <input type="number" id="dbpAliasE6Max" min="1" max="30"></label>
                        </div>
                    </div>
                </details>

                <div class="dbp-info">
                    Runs automatically in the background whenever a dataset is loaded, using the same shared caches as
                    autocomplete and tag counts (tags already seen elsewhere are not fetched again). A tag with a wiki
                    entry gets an icon next to its remove (×) button — <b>nothing is shown</b> when neither site has an entry.<br>
                    <b>Tag lists and User Presets</b> show a single icon — <b>❓</b> Danbooru only · <b>❔</b> e621 only ·
                    <b>⁉️</b> both (click it to open this window with the tag searched on both sites).<br>
                    ❓ icons follow “Show ❓ Danbooru wiki icons”; ❔ icons (and e621 counts/suggestions) follow “Enable e621”.<br>
                    <b>🔍 Scan</b> checks the dataset now · <b>🔄</b> rechecks everything, ignoring the cache ·
                    <b>♻️ Recheck unknown tags</b> re-verifies every tag saved as “unknown” (not found on a site) and restores the ones that exist.<br>
                    <b>Tag colors:</b> <span style="color:#4db8ff;">Danbooru</span> · <span style="color:#f48fb1;">e621</span> · <span style="color:#8a8a8a;">unknown (not on either site)</span> · <span style="color:#ffcc66;">➜ gold arrow</span> = alias that can be replaced by its main tag.
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="dbp-btn-scan" id="dbpScanBtn" style="flex:1;">🔍 Scan Dataset Tags</button>
                    <button class="dbp-btn-scan-force" id="dbpScanForceBtn" title="Force recheck ALL tags, even already-cached ones">🔄</button>
                    <button class="dbp-btn-recheck" id="dbpRecheckBtn" title="Force a new verification of every tag saved as unknown">♻️ Recheck unknown tags <span id="dbpUnknownCount"></span></button>
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

        // Re-verifies the tags saved as "unknown".
        document.getElementById('dbpRecheckBtn').onclick = () => window.recheckUnknownTags();

        // Options (state + handlers)
        bindModalOptions();
        bindAliasOptions();
        setupDbpAutocomplete();
        syncModalOptionStates();
        updateUnknownBadge();
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
        html += `<div class="dbp-tag-title" style="color:${site.key === 'e621' ? '#f48fb1' : '#4db8ff'};">${DBP_ESC(targetName)}</div>`;
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
            const prefix = (hasDb && hasE6) ? '⁉️' : (hasDb ? '❓' : (hasE6 ? '❔' : ''));

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

    /* ---------- OPÇÕES DENTRO DO POPOUT ---------- */
    function bindModalOptions() {
        const cbIcons = document.getElementById('dbpOptDbIcons');
        const cbE6 = document.getElementById('toggle-e621');
        const cbSfw = document.getElementById('toggle-e621-sfw');
        if (!cbIcons || !cbE6 || !cbSfw) return;

        cbIcons.onchange = async (e) => {
            window.danbooruInfoShowIcons = e.target.checked;
            await window.saveSetting('danbooru-info-show-icons', window.danbooruInfoShowIcons);
            refreshAll();
        };

        cbE6.onchange = async (e) => {
            window._e621Choice = e.target.checked;
            await window.saveSetting('toggle-e621', window._e621Choice);
            applyDerivedFlags();
            syncAliasOptionStates();
            refreshAll();
            // Acabou de ligar: busca já a wiki do e621 para os ❔ aparecerem.
            if (window.showE621) window.runDanbooruBackgroundScan();
        };

        cbSfw.onchange = async (e) => {
            window._e621SfwChoice = e.target.checked;
            await window.saveSetting('toggle-e621-sfw', window._e621SfwChoice);
            applyDerivedFlags();
        };
    }

    /* ---------- OPÇÕES DE ALIAS (antes ficavam na engrenagem) ----------
       O estado e as chaves de setting continuam em tagmanager_danbooru_alias.js
       e tagmanager_e621_alias.js; aqui fica só a interface. */
    const ALIAS_OPTS = {
        Db: { click: 'aliasClickBehavior', clickKey: 'alias-click-behavior',
              convert: 'enableAliasConvertClick', convertKey: 'alias-convert-click-enabled',
              preview: 'showAliasPreview', previewKey: 'alias-preview-enabled',
              max: 'aliasPreviewMaxCount', maxKey: 'alias-preview-max-count' },
        E6: { click: 'e621AliasClickBehavior', clickKey: 'e621-alias-click-behavior',
              convert: 'e621EnableAliasConvertClick', convertKey: 'e621-alias-convert-click-enabled',
              preview: 'e621ShowAliasPreview', previewKey: 'e621-alias-preview-enabled',
              max: 'e621AliasPreviewMaxCount', maxKey: 'e621-alias-preview-max-count' }
    };

    function bindAliasOptions() {
        const prim = document.getElementById('dbpAliasPrimary');
        if (prim) prim.onchange = () => {
            window.aliasPrimarySource = prim.value;
            if (typeof window.saveSetting === 'function') window.saveSetting('alias-primary-source', prim.value);
            refreshTagRenders();
        };
        Object.entries(ALIAS_OPTS).forEach(([site, o]) => {
            const sel = document.getElementById('dbpAlias' + site + 'Click');
            const cbConv = document.getElementById('dbpAlias' + site + 'Convert');
            const cbPrev = document.getElementById('dbpAlias' + site + 'Preview');
            const num = document.getElementById('dbpAlias' + site + 'Max');
            if (!sel || !cbConv || !cbPrev || !num) return;
            const save = (k, v) => { if (typeof window.saveSetting === 'function') window.saveSetting(k, v); };
            sel.onchange = () => { window[o.click] = sel.value === 'keep' ? 'keep' : 'replace'; save(o.clickKey, window[o.click]); };
            cbConv.onchange = () => { window[o.convert] = cbConv.checked; save(o.convertKey, cbConv.checked); refreshTagRenders(); };
            cbPrev.onchange = () => { window[o.preview] = cbPrev.checked; num.disabled = !cbPrev.checked; save(o.previewKey, cbPrev.checked); refreshTagRenders(); };
            num.onchange = () => {
                const n = parseInt(num.value, 10);
                if (!n || n < 1) { num.value = window[o.max] || 5; return; }
                window[o.max] = Math.min(n, 30);
                save(o.maxKey, window[o.max]);
                refreshTagRenders();
            };
        });
    }

    function syncAliasOptionStates() {
        const prim = document.getElementById('dbpAliasPrimary');
        if (prim) {
            prim.value = typeof window.getAliasPrimarySource === 'function' ? window.getAliasPrimarySource() : 'danbooru';
            prim.disabled = !window.showE621;   // sem e621 só existe a fonte Danbooru
            prim.parentElement.style.opacity = window.showE621 ? '1' : '0.45';
        }
        Object.entries(ALIAS_OPTS).forEach(([site, o]) => {
            const sel = document.getElementById('dbpAlias' + site + 'Click');
            const cbConv = document.getElementById('dbpAlias' + site + 'Convert');
            const cbPrev = document.getElementById('dbpAlias' + site + 'Preview');
            const num = document.getElementById('dbpAlias' + site + 'Max');
            if (!sel || !cbConv || !cbPrev || !num) return;
            sel.value = window[o.click] === 'keep' ? 'keep' : 'replace';
            cbConv.checked = window[o.convert] !== false;
            cbPrev.checked = window[o.preview] !== false;
            num.value = window[o.max] || 5;
            num.disabled = !cbPrev.checked;
        });
        // A coluna do e621 só faz sentido com o e621 ligado.
        const e6Col = document.getElementById('dbpAliasE6Click');
        if (e6Col) e6Col.closest('.dbp-alias-col').style.opacity = window.showE621 ? '1' : '0.45';
    }
    // Os arquivos de alias chamam isto depois de carregar as settings.
    window.syncInterrogatorAliasOptions = syncAliasOptionStates;

    function syncModalOptionStates() {
        syncAliasOptionStates();
        const cbIcons = document.getElementById('dbpOptDbIcons');
        const cbE6 = document.getElementById('toggle-e621');
        const cbSfw = document.getElementById('toggle-e621-sfw');
        if (cbIcons) cbIcons.checked = !!window.danbooruInfoShowIcons;
        if (cbE6) cbE6.checked = !!window._e621Choice;
        if (cbSfw) cbSfw.checked = !!window._e621SfwChoice;
    }

    /* Compat: antes estas funções eram chamadas pelo onchange do HTML da
       engrenagem (tagmanager_ui_core.js). Agora os checkboxes vivem no popout
       e têm handler próprio; estas versões só mantêm a API e respeitam a
       chave mestra. */
    window.toggleE621 = function () {
        const cb = document.getElementById('toggle-e621');
        if (!cb) return;
        window._e621Choice = cb.checked;
        window.saveSetting('toggle-e621', cb.checked);
        applyDerivedFlags();
    };
    window.toggleE621Sfw = function () {
        const cb = document.getElementById('toggle-e621-sfw');
        if (!cb) return;
        window._e621SfwChoice = cb.checked;
        window.saveSetting('toggle-e621-sfw', cb.checked);
        applyDerivedFlags();
    };

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
    function setScanButtonsDisabled(disabled) {
        ['dbpScanBtn', 'dbpScanForceBtn', 'dbpRecheckBtn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.disabled = disabled;
        });
    }

    window.runDanbooruInfoScan = async function (force = false) {
        if (!window.danbooruInfoEnabled) {
            if (window.showAlert) window.showAlert('Tag Interrogator is disabled in Settings.', 'warn');
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

        const progress = document.getElementById('dbpScanProgress');
        setScanButtonsDisabled(true);
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
        setScanButtonsDisabled(false);
        if (progress) progress.style.display = 'none';

        refreshAll();
        updateUnknownBadge();

        if (window.showAlert) {
            const extra = window.showE621 ? ` + ${e621Found} on e621` : '';
            window.showAlert(`Scan complete! Found wiki info for ${result.found} tag(s) on Danbooru${extra}.`, 'success');
        }
    };

    /* ---------- RECHECK UNKNOWN TAGS ----------
       Tira da lista "unknown" (window.unknownTagsCache) todas as tags marcadas
       e força uma nova verificação completa nas fontes. As que realmente
       existem voltam com contagem + wiki; as que continuam inexistentes são
       marcadas de novo (com a checagem exata dos _core). Se a API falhar, a
       tag NÃO volta a ser marcada como unknown — ela fica sem marca e será
       tentada de novo no próximo scan. */
    async function countUnknown() {
        if (typeof window.loadUnknownTags === 'function' && !window.unknownTagsLoaded) {
            try { await window.loadUnknownTags(); } catch (e) {}
        }
        const cache = window.unknownTagsCache || {};
        let n = 0;
        Object.keys(cache).forEach(k => {
            const e = cache[k];
            if (e && (e.danbooru || (window.showE621 && e.e621))) n++;
        });
        return n;
    }

    async function updateUnknownBadge() {
        const el = document.getElementById('dbpUnknownCount');
        if (!el) return;
        const n = await countUnknown();
        el.textContent = n > 0 ? `(${n})` : '';
    }

    window.recheckUnknownTags = async function () {
        if (!window.danbooruInfoEnabled) {
            if (window.showAlert) window.showAlert('Tag Interrogator is disabled in Settings.', 'warn');
            return;
        }
        if (window._dbInfoScanRunning) {
            if (window.showAlert) window.showAlert('A scan is already running.', 'info');
            return;
        }
        if (typeof window.loadUnknownTags === 'function' && !window.unknownTagsLoaded) {
            try { await window.loadUnknownTags(); } catch (e) {}
        }

        const cache = window.unknownTagsCache || (window.unknownTagsCache = {});
        const dbKeys = [], e6Keys = [];
        Object.keys(cache).forEach(k => {
            const e = cache[k];
            if (!e) return;
            if (e.danbooru) dbKeys.push(k);
            if (e.e621 && window.showE621) e6Keys.push(k);
        });
        if (dbKeys.length === 0 && e6Keys.length === 0) {
            if (window.showAlert) window.showAlert('No unknown tags to recheck.', 'info');
            updateUnknownBadge();
            return;
        }

        const where = `${dbKeys.length} on Danbooru` + (window.showE621 ? ` and ${e6Keys.length} on e621` : '');
        if (!confirm(`Recheck the tags saved as unknown (${where})?\n\nTags that actually exist will be restored with their counts and wiki info. This can take a while because of the API rate limits.`)) return;

        window._dbInfoScanRunning = true;
        window._dbBackgroundScanCancelled = false;
        window._e621BackgroundScanCancelled = false;
        setScanButtonsDisabled(true);

        const progress = document.getElementById('dbpScanProgress');
        const say = (t) => { if (progress) { progress.style.display = 'block'; progress.textContent = t; } };

        const stats = { dbRestored: 0, dbStill: 0, dbUnsure: 0, e6Restored: 0, e6Still: 0, e6Unsure: 0 };

        try {
            if (dbKeys.length) {
                say(`Rechecking ${dbKeys.length} tag(s) on Danbooru...`);
                dbKeys.forEach(k => {
                    const e = cache[k];
                    delete e.danbooru; delete e.dbVerified;
                    if (!Object.keys(e).some(x => x !== 'ts')) delete cache[k];
                });
                window._danbooruCacheVersion = (window._danbooruCacheVersion || 0) + 1;
                if (typeof window.saveUnknownTags === 'function') await window.saveUnknownTags();

                await window.dbFetchCountsBatch(dbKeys, true);

                const restored = [];
                dbKeys.forEach(k => {
                    if (typeof window.isTagUnknownDb === 'function' && window.isTagUnknownDb(k)) { stats.dbStill++; return; }
                    const c = window.danbooruCache && window.danbooruCache[k];
                    if (c && (c.count > 0 || c.aliasTo)) { stats.dbRestored++; restored.push(k); }
                    else stats.dbUnsure++;
                });
                if (restored.length) {
                    await window.dbFetchWikiBatch(restored, false, () => scheduleIconRefresh(),
                        (done, total) => say(`Danbooru wiki info: ${done} / ${total}`));
                }
            }

            if (e6Keys.length) {
                say(`Rechecking ${e6Keys.length} tag(s) on e621...`);
                e6Keys.forEach(k => {
                    const e = cache[k];
                    if (!e) return;
                    delete e.e621; delete e.e621Verified;
                    if (!Object.keys(e).some(x => x !== 'ts')) delete cache[k];
                });
                window._e621CacheVersion = (window._e621CacheVersion || 0) + 1;
                if (typeof window.saveUnknownTags === 'function') await window.saveUnknownTags();

                await window.e621FetchCountsBatch(e6Keys, true);

                const restored = [];
                e6Keys.forEach(k => {
                    if (typeof window.isTagUnknownE621 === 'function' && window.isTagUnknownE621(k)) { stats.e6Still++; return; }
                    const c = window.e621Cache && window.e621Cache[k];
                    if (c && (c.count > 0 || c.aliasTo)) { stats.e6Restored++; restored.push(k); }
                    else stats.e6Unsure++;
                });
                if (restored.length) {
                    await window.e621FetchWikiBatch(restored, false, () => scheduleIconRefresh(),
                        (done, total) => say(`e621 wiki info: ${done} / ${total}`));
                }
            }
        } catch (err) {
            console.warn('[Recheck unknown tags]', err);
        }

        window._dbInfoScanRunning = false;
        setScanButtonsDisabled(false);
        if (progress) progress.style.display = 'none';
        refreshAll();
        updateUnknownBadge();

        const parts = [];
        if (dbKeys.length) parts.push(`Danbooru: ${stats.dbRestored} restored, ${stats.dbStill} still unknown` + (stats.dbUnsure ? `, ${stats.dbUnsure} could not be verified` : ''));
        if (e6Keys.length) parts.push(`e621: ${stats.e6Restored} restored, ${stats.e6Still} still unknown` + (stats.e6Unsure ? `, ${stats.e6Unsure} could not be verified` : ''));
        const unsure = stats.dbUnsure + stats.e6Unsure;
        if (window.showAlert) window.showAlert(`Recheck finished — ${parts.join(' · ')}.` + (unsure ? ' Unverified tags will be tried again on the next scan.' : ''), unsure ? 'warn' : 'success');
    };

    /* ---------- BACKGROUND SCAN AUTOMÁTICO (1x por dataset carregado) ---------- */
    let _dbIconRefreshTimer = null;
    function scheduleIconRefresh() {
        clearTimeout(_dbIconRefreshTimer);
        _dbIconRefreshTimer = setTimeout(() => refreshAll(), 400);
    }

    window.runDanbooruBackgroundScan = async function () {
        if (!window.danbooruInfoEnabled) return;
        if (window._dbInfoScanRunning) return;

        const tags = collectInfoScanTags();
        if (tags.length === 0) return;

        window._dbInfoScanRunning = true;
        window._dbBackgroundScanCancelled = false;
        window._e621BackgroundScanCancelled = false;

        const progress = document.getElementById('dbpScanProgress');
        setScanButtonsDisabled(true);
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
        setScanButtonsDisabled(false);
        if (progress) progress.style.display = 'none';
        refreshAll();
        updateUnknownBadge();
    };

    function onDatasetLoadedForDbScan() {
        window._dbBackgroundScanCancelled = true;
        window._e621BackgroundScanCancelled = true;
        setTimeout(() => {
            window._dbBackgroundScanCancelled = false;
            window._e621BackgroundScanCancelled = false;
            window.runDanbooruBackgroundScan();
        }, 600);
    }

    // Troca de dataset: evento único do hub (tagmanager_render_hooks.js).
    function hookAutoDanbooruScan() {
        if (window._dbAutoScanHookRegistered || !window.TM) return;
        window.TM.on('dataset:loaded', onDatasetLoadedForDbScan);
        window._dbAutoScanHookRegistered = true;
    }

    /* ---------- INJEÇÃO DO ❓/❔/⁉️ NAS LINHAS DE TAG ----------
       UM ícone por tag (mesmo sistema dos User Presets — ppApplyWikiIcons):
       - ❓ só o Danbooru tem wiki (e "Show ❓ Danbooru wiki icons" ligado);
       - ❔ só o e621 tem wiki (e "Enable e621" ligado);
       - ⁉️ os dois têm — abre o Tag Interrogator com a tag buscada nos dois.
       O ❓ de alias (tag-alias-info-icon) continua separado: quando ele existe,
       o lado Danbooru já está coberto por ele. */
    window.openTagInterrogatorFor = function (tag) {
        const t = String(tag || '').trim();
        if (!t) return;
        buildMainModal();
        const input = document.getElementById('dbpInput');
        if (!input || typeof window.openModal !== 'function') { window.openDanbooruTagInfoPopout(t); return; }
        input.value = t;
        window.openModal('modal-danbooru');
        dbpPerformSearch(t);
    };

    function makeWikiIcon(tagLower, hasDb, hasE6) {
        const icon = document.createElement('span');
        icon.dataset.wikiIcon = '1';
        if (hasDb && hasE6) {
            icon.className = 'tag-both-info';
            icon.textContent = '⁉️';
            icon.title = 'Info found on Danbooru AND e621 — click to open both in the Tag Interrogator';
            icon.onclick = (e) => { e.stopPropagation(); window.openTagInterrogatorFor(tagLower); };
        } else if (hasDb) {
            icon.className = 'tag-db-info';
            icon.textContent = '❓';
            icon.title = 'View Danbooru info for this tag';
            icon.onclick = (e) => { e.stopPropagation(); window.openDanbooruTagInfoPopout(tagLower); };
        } else {
            icon.className = 'tag-e621-info';
            icon.textContent = '❔';
            icon.title = 'View e621 info for this tag';
            icon.onclick = (e) => { e.stopPropagation(); window.openE621TagInfoPopout(tagLower); };
        }
        return icon;
    }

    /* ghost = sugestão 💡: wiki ainda não checada também conta (o clique
       abre o popout, que busca na hora — ghosts quase nunca passaram pelo scan). */
    function siteHasWiki(info, ghost) {
        if (!info) return !!ghost;
        if (info.hasWikiInfo) return true;
        return !!ghost && !info.wikiChecked;
    }

    function placeWikiIcon(row, anchorBtn, tagLower, ghost) {
        if (row.querySelector('[data-wiki-icon]')) return;
        const showDb = !!window.danbooruInfoShowIcons;
        const showE6 = !!window.showE621 && typeof window.e621GetCachedTag === 'function';

        // O ícone de alias (❓ Danbooru / ❔ e621) já cobre o lado daquele site nesta linha.
        const aliasIcon = row.querySelector('.tag-alias-info-icon');
        const aliasSrc = aliasIcon ? (aliasIcon.getAttribute('data-alias-source') || 'danbooru') : null;
        const wikiDb = showDb && aliasSrc !== 'danbooru' && typeof window.dbGetCachedTag === 'function' && siteHasWiki(window.dbGetCachedTag(tagLower), ghost);
        const wikiE6 = showE6 && aliasSrc !== 'e621' && siteHasWiki(window.e621GetCachedTag(tagLower), ghost);
        if (!wikiDb && !wikiE6) return;

        // Alias de um site + wiki do outro = os dois lados → UM ⁉️ no lugar do ícone de
        // alias (antes apareciam ❓ e ❔ lado a lado). O ⁉️ abre o Tag Interrogator com a
        // tag buscada nos dois sites, que também mostra o redirecionamento do alias.
        if (aliasIcon) {
            const both = makeWikiIcon(tagLower, true, true);
            aliasIcon.parentNode.insertBefore(both, aliasIcon);
            aliasIcon.remove();
            return;
        }
        anchorBtn.parentNode.insertBefore(makeWikiIcon(tagLower, wikiDb, wikiE6), anchorBtn);
    }

    function injectDbInfoIcons(container) {
        if (!container || !window.danbooruInfoEnabled) return;
        if (!window.danbooruInfoShowIcons && !window.showE621) return;

        container.querySelectorAll('[data-tag-name]').forEach(row => {
            const removeBtn = row.querySelector('.tag-remove');
            if (!removeBtn) return;
            placeWikiIcon(row, removeBtn, row.getAttribute('data-tag-name'), false);
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
        if (!container || !window.danbooruInfoEnabled) return;
        if (!window.danbooruInfoShowIcons && !window.showE621) return;

        container.querySelectorAll(ghostSelector).forEach(row => {
            const rejectBtn = row.querySelector('.tag-ghost-reject');
            if (!rejectBtn) return;

            const nameEl = row.querySelector('.tag-name');
            const tagLower = (row.getAttribute('data-tag-name') || (nameEl ? nameEl.textContent : '') || '').trim().toLowerCase();
            if (!tagLower || tagLower.startsWith('nl:')) return;
            if (typeof window.checkIfNL === 'function' && window.checkIfNL(tagLower)) return;

            placeWikiIcon(row, rejectBtn, tagLower, true);
        });
    }

    function refreshTagRenders() {
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
    }

    // Lists + User Presets (os ícones do painel de presets são desenhados por updatePresetMarkers).
    function refreshAll() {
        refreshTagRenders();
        if (typeof window.updatePresetMarkers === 'function') window.updatePresetMarkers();
    }

    // Ícones de wiki depois de cada render das duas listas (eventos do hub TM).
    // Prioridade 100 = depois dos outros plugins (mesma ordem visual de antes).
    function wrapRenderersForDbInfo() {
        if (window._dbInfoRenderHooks || !window.TM) return;
        window._dbInfoRenderHooks = true;
        window.TM.on('render:editor', () => {
            const el = document.getElementById('tag-list-vertical');
            injectDbInfoIcons(el);
            injectGhostDbInfoIcons(el, '.tag-row.ghost');
        }, 100);
        window.TM.on('render:master', () => {
            const el = document.getElementById('master-tag-list');
            injectDbInfoIcons(el);
            injectGhostDbInfoIcons(el, '.master-tag-item.ghost');
        }, 100);
    }
    wrapRenderersForDbInfo();

    /* ---------- ESTADO DERIVADO / CHAVE MESTRA ---------- */
    function applyDerivedFlags() {
        const on = !!window.danbooruInfoEnabled;
        window.showDanbooruCounts = on;                       // contagens, alias ➜, sync
        window.showE621 = on && !!window._e621Choice;         // e621 só com a chave mestra ligada
        window.showE621Sfw = !!window._e621SfwChoice;
    }

    async function loadInterrogatorSettings() {
        if (typeof window.getSetting !== 'function') return;
        window.danbooruInfoEnabled = await window.getSetting('danbooru-info-enabled', true);
        window.danbooruInfoShowIcons = await window.getSetting('danbooru-info-show-icons', true);
        window._e621Choice = await window.getSetting('toggle-e621', false);
        window._e621SfwChoice = await window.getSetting('toggle-e621-sfw', false);
        window.aliasPrimarySource = await window.getSetting('alias-primary-source', 'danbooru');
    }

    // Aplica TODO o efeito visual/funcional do estado atual.
    function applyInterrogatorState(refresh) {
        applyDerivedFlags();
        updateTopbarButtonVisibility();
        applyGearState();
        syncModalOptionStates();

        if (!window.danbooruInfoEnabled) {
            // Para qualquer scan em andamento e fecha as janelas da função.
            window._dbBackgroundScanCancelled = true;
            window._e621BackgroundScanCancelled = true;
            ['modal-danbooru', 'modal-db-tag-info', 'modal-e621-tag-info'].forEach(id => {
                const m = document.getElementById(id);
                if (m) m.classList.remove('active');
            });
        }
        if (refresh) refreshAll();
    }

    /* ---------- BOTÃO NO TOPBAR + BOTÃO DE AJUDA ---------- */
    function injectTopbarButton() {
        const rightBar = document.getElementById('topbar-right');
        const anchor = document.getElementById('btn-mode-switch') || document.getElementById('btn-settings');
        if (!rightBar || !anchor || document.getElementById('btn-open-tag-interrogator')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-open-tag-interrogator';
        btn.title = 'Search Danbooru/e621 tags & scan dataset for tag info';
        btn.textContent = '🏷️ Tag Interrogator';
        btn.onclick = () => { buildMainModal(); updateUnknownBadge(); window.openModal('modal-danbooru'); };
        rightBar.insertBefore(btn, anchor);
        updateTopbarButtonVisibility();
    }

    function updateTopbarButtonVisibility() {
        const btn = document.getElementById('btn-open-tag-interrogator');
        if (btn) btn.style.display = window.danbooruInfoEnabled ? 'inline-block' : 'none';
    }

    // O "?" de ajuda fica colado na engrenagem de configurações.
    function moveHelpButton() {
        const help = document.getElementById('btn-help');
        const gear = document.getElementById('btn-settings');
        if (help && gear && gear.previousElementSibling !== help) gear.parentNode.insertBefore(help, gear);
    }

    // Outros scripts (Manage Rules etc.) inserem botões antes da engrenagem DEPOIS de nós;
    // um observer mantém o "?" sempre colado nela (a checagem acima evita loop).
    function keepHelpNextToGear() {
        const bar = document.getElementById('topbar-right');
        if (!bar || bar.__helpObserver) return;
        bar.__helpObserver = new MutationObserver(() => moveHelpButton());
        bar.__helpObserver.observe(bar, { childList: true });
    }

    /* ---------- ENGRENAGEM: SÓ A CHAVE MESTRA ---------- */
    // Remove o antigo grupo "🦊 e621" (Enable e621 / Force SFW) — agora vive no popout.
    function removeLegacyE621Gear() {
        const dd = document.getElementById('settings-dropdown');
        if (!dd) return;
        ['toggle-e621', 'toggle-e621-sfw'].forEach(id => {
            const cb = dd.querySelector('#' + id);
            const lbl = cb ? cb.closest('label') : null;
            if (lbl) lbl.remove();
        });
        const grp = Array.from(dd.querySelectorAll('.settings-group-label')).find(e => /^\s*(🦊\s*)?e621\s*$/i.test(e.textContent));
        if (grp) {
            const prev = grp.previousElementSibling;
            grp.remove();
            if (prev && prev.tagName === 'HR') prev.remove();
        }
    }

    // Elementos do grupo "🌐 Danbooru" (label, sync, toggles de alias injetados por
    // outros scripts...) — tudo entre o label do Danbooru e o separador do Backup.
    function getDanbooruGroupEls() {
        const dd = document.getElementById('settings-dropdown');
        if (!dd) return [];
        const label = Array.from(dd.querySelectorAll('.settings-group-label')).find(e => /Danbooru/.test(e.textContent));
        if (!label) return [];
        const els = [label];
        const prev = label.previousElementSibling;
        if (prev && prev.tagName === 'HR' && prev.dataset.ifaceSep) els.push(prev);
        let n = label.nextElementSibling;
        while (n) {
            if (n.tagName === 'HR' && n.nextElementSibling && n.nextElementSibling.classList.contains('settings-group-label')) break;
            els.push(n);
            n = n.nextElementSibling;
        }
        return els;
    }

    function applyGearState() {
        const cb = document.getElementById('toggle-db-info-master');
        if (cb) cb.checked = !!window.danbooruInfoEnabled;
        getDanbooruGroupEls().forEach(el => { el.style.display = window.danbooruInfoEnabled ? '' : 'none'; });
    }

    function injectSettingsToggles() {
        const dropdown = document.getElementById('settings-dropdown');
        if (!dropdown || document.getElementById('toggle-db-info-master')) return;

        const dbLabel = Array.from(dropdown.querySelectorAll('.settings-group-label')).find(e => /Danbooru/.test(e.textContent));

        const subLabel = document.createElement('div');
        subLabel.className = 'settings-group-label';
        subLabel.textContent = '🏷️ Tag Interrogator';

        const lblMaster = document.createElement('label');
        lblMaster.title = 'Turns ALL Danbooru / e621 features on or off: tag info icons, counts, wiki scans, suggestions, alias tools and the Tag Interrogator button.';
        lblMaster.innerHTML = `<input type="checkbox" id="toggle-db-info-master"> Enable Tag Interrogator`;

        const sep = document.createElement('hr');
        sep.style.cssText = 'border: 0; border-top: 1px solid #333; margin: 5px 0;';
        sep.dataset.ifaceSep = '1';

        if (dbLabel) {
            // Fica logo acima do grupo Danbooru (que some junto quando a chave mestra é desligada).
            [subLabel, lblMaster, sep].forEach(el => dbLabel.insertAdjacentElement('beforebegin', el));
        } else {
            // O grupo "🌐 Danbooru" saiu da engrenagem (tudo agora vive no popout):
            // a chave mestra fica logo antes do grupo Backup.
            const backup = Array.from(dropdown.querySelectorAll('.settings-group-label')).find(e => /Backup/.test(e.textContent));
            if (backup) [subLabel, lblMaster, sep].forEach(el => backup.insertAdjacentElement('beforebegin', el));
            else [subLabel, lblMaster].forEach(el => dropdown.appendChild(el));
        }

        const cbMaster = document.getElementById('toggle-db-info-master');
        cbMaster.checked = !!window.danbooruInfoEnabled;
        cbMaster.onchange = async (e) => {
            window.danbooruInfoEnabled = e.target.checked;
            await window.saveSetting('danbooru-info-enabled', window.danbooruInfoEnabled);
            applyInterrogatorState(true);
            if (window.danbooruInfoEnabled) {
                // Religou: recomeça tudo (contagens + wiki) e atualiza o badge de unknown.
                window.runDanbooruBackgroundScan();
                updateUnknownBadge();
            }
        };
    }

    /* ---------- CARREGAMENTO INICIAL ---------- */
    // initSystem() -> loadSettings() (ui_core) reaplica showDanbooruCounts=true e
    // showE621 sem olhar a chave mestra; depois dele reaplicamos o estado certo.
    if (typeof window.loadSettings === 'function' && !window.loadSettings.__ifaceWrapped) {
        const originalLoadSettings = window.loadSettings;
        const wrappedLoadSettings = async function () {
            const r = await originalLoadSettings.apply(this, arguments);
            await loadInterrogatorSettings();
            applyInterrogatorState(false);
            return r;
        };
        wrappedLoadSettings.__ifaceWrapped = true;
        window.loadSettings = wrappedLoadSettings;
    }

    // Chaveia o modal-open para atualizar o badge de unknown quando aberto por outros caminhos (ex: ⁉️ dos presets).
    if (typeof window.openModal === 'function' && !window.openModal.__ifaceWrapped) {
        const originalOpenModal = window.openModal;
        const wrappedOpenModal = function (id) {
            if (id === 'modal-danbooru' && !window.danbooruInfoEnabled) return;
            const r = originalOpenModal.apply(this, arguments);
            if (id === 'modal-danbooru') { updateUnknownBadge(); syncModalOptionStates(); }
            return r;
        };
        wrappedOpenModal.__ifaceWrapped = true;
        window.openModal = wrappedOpenModal;
    }

    window.addEventListener('DOMContentLoaded', async () => {
        removeLegacyE621Gear();   // antes de criar o popout (ids duplicados)
        moveHelpButton();
        keepHelpNextToGear();

        await loadInterrogatorSettings();
        applyDerivedFlags();

        injectTopbarButton();
        injectSettingsToggles();
        buildMainModal();
        buildTagInfoModal();
        buildE621TagInfoModal();
        hookAutoDanbooruScan();
        applyInterrogatorState(false);

        // Outros scripts injetam toggles de alias na engrenagem com atraso; reaplica a visibilidade.
        setTimeout(() => { applyGearState(); moveHelpButton(); }, 1200);
    });

})();
