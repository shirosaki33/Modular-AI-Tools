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
        /* The popout has a fixed height: search row on top, wiki cards take ALL the free space, and the ⚙️ Settings expander
           sits at the bottom (collapsed by default). Opening it gives the settings room (they scroll) and the cards shrink. */
        #modal-danbooru .tool-modal { width: 1150px; max-width: 95vw; height: 90vh; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }
        #modal-danbooru .tool-modal > * { flex: 0 0 auto; }
        #modal-danbooru .tool-modal > .dbp-cards { flex: 1 1 0; min-height: 150px; }
        .dbp-settings { background: #0d0d0d; border: 1px solid #222; border-radius: 6px; margin-top: 10px; }
        .dbp-settings > summary { cursor: pointer; padding: 9px 12px; font-size: 12px; font-weight: bold; color: #ccc; user-select: none; }
        .dbp-settings > summary:hover { color: #fff; }
        .dbp-settings[open] > summary { border-bottom: 1px solid #222; }
        .dbp-settings-body { padding: 10px 12px 12px; max-height: 46vh; overflow-y: auto; }
        .dbp-settings-body > :last-child { margin-bottom: 0; }
        #modal-both-tag-info .tool-modal { width: 1000px; max-width: 95vw; max-height: 85vh; overflow-y: auto; }
        .dbb-cols { display: flex; gap: 12px; align-items: stretch; }
        .dbb-col { flex: 1 1 0; min-width: 0; background: #0d0d0d; border: 1px solid #222; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; }
        .dbb-col[data-site="danbooru"] { border-color: #1f4468; }
        .dbb-col[data-site="e621"] { border-color: #6b4a14; }
        .dbb-col .dbp-desc { max-height: 52vh; flex: 1 1 auto; }
        @media (max-width: 800px) { .dbb-cols { flex-direction: column; } }

        .dbp-cards { display: flex; gap: 12px; margin-top: 12px; align-items: stretch; }
        .dbp-card { flex: 1 1 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: #0d0d0d; border: 1px solid #1e3d28; border-radius: 8px; overflow: hidden; }
        .dbp-card[data-site="danbooru"] { border-color: #1f4468; }
        .dbp-card[data-site="e621"] { border-color: #6b4a14; }
        .dbp-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 12px; background: #151515; border-bottom: 1px solid #222; font-size: 12px; font-weight: bold; flex-shrink: 0; }
        .dbp-card-status { font-size: 10px; color: #777; font-weight: normal; }
        .dbp-card-body { padding: 12px; display: flex; flex-direction: column; gap: 6px; flex: 1 1 0; min-height: 0; overflow-y: auto; }
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
        @media (max-width: 800px) { .dbp-cards { flex-direction: column; } .dbp-card-body { min-height: 200px; } }

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
        .dbp-offline { display: inline-block; font-size: 9px; font-weight: bold; letter-spacing: 0.4px; text-transform: lowercase; color: #00ff99; background: #0d2a18; border: 1px solid #1f5a3a; border-radius: 8px; padding: 1px 7px; margin-bottom: 6px; cursor: help; user-select: none; }
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
        .dbp-opts label.dbp-opt-local { color: #00ff99; }
        .dbp-opts select { width: auto; background: #151515; color: #ddd; border: 1px solid #333; border-radius: 4px; padding: 2px 6px; font-size: 12px; }
        .dbp-opts label.dbp-opt-local.is-disabled { opacity: 0.45; cursor: not-allowed; }
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
            .replace(/"([^"]+)":\s*(\/[^\s"<]+)/g, '<a href="https://danbooru.donmai.us$2" target="_blank" style="color:#4db8ff; text-decoration:underline;">$1</a>')
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

    /* ---------- WIKI SAVE MODE (localhost) ----------
       Off / Short (800 chars, default) / Full. Texts live in their own file (local/wiki_full.json).
       Wiki text served from that file gets a micro "offline" badge. */
    const dbpFileOn = () => !!window.MAT_IS_LOCAL && !!window.WikiFull;
    const dbpMode = () => window.WikiFull ? window.WikiFull.mode() : 'short';
    const dbpStoreOn = () => dbpFileOn() && dbpMode() !== 'off';
    // { text, ts, full } from local/wiki_full.json (separate file: tagmanager_wiki_full.js) or null
    const dbpFullFromFile = (siteKey, tag) => dbpFileOn() ? window.WikiFull.get(siteKey, tag) : null;
    function dbpOfflineBadge(ts, full) {
        if (full !== false && ts && (Date.now() - ts) < 15000) return '';   // just read from the site a moment ago, not from the file
        const when = ts ? new Date(ts).toLocaleString('en-US') : 'unknown date';
        const kind = full === false ? 'Short summary (first 800 characters) from the local file; the site could not be reached.' : 'Read from the local file, no internet needed.';
        return `<div class="dbp-offline" title="${kind}\nSaved: ${DBP_ESC(when)}">${full === false ? 'offline · summary' : 'offline'}</div><br>`;
    }
    // Shows what is saved when the live wiki could not be loaded. Returns true when something was shown.
    function dbpShowSavedText(descEl, fromFile, info, fix) {
        const text = fromFile ? fromFile.text : ((info && info.hasWikiInfo && info.description) || '');
        if (!text) return false;
        descEl.dataset.original = text;
        let html = window.formatDanbooruDText(text);
        if (fix) html = fix(html);
        descEl.innerHTML = (fromFile ? dbpOfflineBadge(fromFile.ts, fromFile.full) : '') + html;
        return true;
    }

    const DBP_SITES = {
        danbooru: {
            key: 'danbooru', name: 'Danbooru', icon: '🅱️', badge: 'DB',
            host: () => 'danbooru.donmai.us',
            colors: () => DB_CAT_COLORS,
            labels: () => DB_CAT_LABELS,
            lookup: (t) => window.dbLookupSingleTag(t),
            saveFull: (t, b) => window.dbSaveWikiFull && window.dbSaveWikiFull(t, b),
            search: (q, n) => window.dbSearchTagMatches(q, n),
            aliasBehavior: () => window.aliasClickBehavior || 'replace'
        },
        e621: {
            key: 'e621', name: 'e621', icon: '🦊', badge: 'e6',
            host: () => e621HostForLinks(),
            colors: () => window.E621_CAT_COLORS || {},
            labels: () => window.E621_CAT_LABELS || {},
            lookup: (t) => window.e621LookupSingleTag(t),
            saveFull: (t, b) => window.e621SaveWikiFull && window.e621SaveWikiFull(t, b),
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
                    // Mesma regra do autocomplete do Tag Manager: 4 Danbooru primeiro, depois 4 e621.
                    if (typeof window.fetchBooruSuggestions !== 'function') return;
                    const list = (await window.fetchBooruSuggestions(val)).map(t => ({ ...t, sites: t.sources, aliasSite: t.aliasSource }));
                    if (myToken !== token) return; // stale response
                    if (typeof window.enrichBooruSuggestions === 'function') window.enrichBooruSuggestions(list);

                    suggBox.innerHTML = '';
                    if (list.length === 0) { suggBox.style.display = 'none'; return; }

                    const hasBoth = list.some(t => t.group === 'danbooru') && list.some(t => t.group === 'e621');
                    let lastGroup = null;
                    list.forEach(t => {
                        if (hasBoth && t.group !== lastGroup && typeof window.makeSuggestionDivider === 'function') {
                            suggBox.appendChild(window.makeSuggestionDivider(t.group === 'danbooru' ? 'Danbooru' : 'e621'));
                            lastGroup = t.group;
                        }
                        const firstSite = DBP_SITES[t.group] || DBP_SITES[t.sites[0]];
                        const srcColors = window.TAG_SOURCE_COLORS || { danbooru: '#4db8ff', e621: '#f48fb1' };
                        const color = t.sites.includes('danbooru') ? srcColors.danbooru : srcColors.e621;
                        const displayName = t.name.replace(/_/g, ' ');
                        const aliasToSpaced = (t.isAlias && t.aliasTo) ? t.aliasTo.replace(/_/g, ' ') : '';
                        const arrowHtml = t.isAlias ? ` <span class="db-alias-arrow">➜ ${DBP_ESC(aliasToSpaced)}</span>` : '';
                        const badges = t.sites.map(s => `<span class="dbp-src-badge ${s === 'e621' ? 'e6' : 'db'}">${DBP_SITES[s].badge}</span>`).join('');
                        const countHtml = (t.isAlias && t.isDeprecated) ? '<span class="db-dep-badge" title="Deprecated tag: it was merged into / replaced by the tag after the ➜ arrow.">deprecated</span>' : (t.post_count > 0 ? Number(t.post_count).toLocaleString() : 'Alias');   // alias: "deprecated" instead of the counter

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

                <div id="dbpScanProgress" style="font-size:11px; color:#aaa; margin-top:8px; flex-shrink:0; display:none;"></div>
                <details class="dbp-settings" id="dbpSettings">
                    <summary>⚙️ Settings &amp; tools</summary>
                    <div class="dbp-settings-body">

                <div class="dbp-opts">
                    <label title="Show a ❓ icon on tags that have a Danbooru wiki entry (tag lists and User Presets)."><input type="checkbox" id="dbpOptDbIcons"> Show ❓ Danbooru wiki icons</label>
                    <label class="dbp-opt-e6" title="Use e621 for tag suggestions, counts and ❔ wiki icons."><input type="checkbox" id="toggle-e621"> Enable e621 (Furry) Suggestions <span class="dbp-opt-note">(also shows the ❔ e621 icons)</span></label>
                    <label class="dbp-opt-e6 dbp-opt-sub" title="Use e926.net (safe-for-work) instead of e621.net."><input type="checkbox" id="toggle-e621-sfw"> 🛡️ Force Safe-for-Work (e926)</label>
                    <label class="dbp-opt-local" id="dbpOptExpandLbl" title="How much of each tag's wiki is saved for offline use. Texts go to their own file (local/wiki_full.json); the Danbooru / e621 caches only keep counts, categories and aliases. Localhost only."> 💾 Wiki text:
                        <select id="dbpOptWikiMode">
                            <option value="off">Off (do not save)</option>
                            <option value="short">Short (800 characters)</option>
                            <option value="full">Full (text + links)</option>
                        </select> <span class="dbp-opt-note">(localhost only — saved in local/wiki_full.json)</span></label>
                    <label class="dbp-opt-local" id="dbpOptIdleLbl" title="While the app has nothing to do (no scan, Fill wiki or search running), it quietly fires small batches of requests on Danbooru and e621. First it fills in the info that saved tags still lack (counts, categories, wiki flags, wiki text per 💾 Wiki text). When nothing is missing it walks each site's tag list from the most used tag down and adds every tag that is not in the cache files yet — any tag, not only the ones in your dataset. Works in Tag Manager and Prompt Helper."><input type="checkbox" id="dbpOptIdleFill"> 🤖 Auto-fill when idle <span class="dbp-opt-note" id="dbpIdleStatus">(fills missing info and adds new tags while the app is idle)</span></label>
                    <label class="dbp-opt-local" title="Show the Danbooru availability dot (green / yellow / red) in the All Dataset Tags header. Off = the dot is hidden and Danbooru is no longer pinged every minute."><input type="checkbox" id="dbpOptStatusDb"> 🟢 Danbooru status</label>
                    <label class="dbp-opt-e6" title="Show the e621 availability dot (green / yellow / red) in the All Dataset Tags header. Off = the dot is hidden and e621 is no longer pinged every minute."><input type="checkbox" id="dbpOptStatusE6"> 🟢 e621 status</label>
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
                    <b>⁉️</b> both (click it to open a popout with both wikis side by side). A dimmed icon = the tag exists but its wiki is empty.<br>
                    ❓ icons follow “Show ❓ Danbooru wiki icons”; ❔ icons (and e621 counts/suggestions) follow “Enable e621”.<br>
                    <b>🔍 Scan</b> checks the dataset now · <b>🔄</b> rechecks everything, ignoring the cache ·
                    <b>🅱️ / 🦊 Fill wiki (Danbooru / e621)</b> do the same as 📚 Fill wiki but for one site only ·
                    <b>📚 Fill wiki</b> uses the tags already saved in the cache files to first move the descriptions still stored in those files into wiki_full.json, then download the wiki text of the tags that still lack it or are outdated (💾 Wiki text = Short or Full, localhost) — the topbar button shows the progress while the panel is closed ·
                    <b>♻️ Recheck unknown tags</b> re-verifies every tag saved as “unknown” (not found on a site) and restores the ones that exist.<br>
                    <b>Tag colors:</b> <span style="color:#4db8ff;">Danbooru</span> · <span style="color:#f48fb1;">e621</span> · <span style="color:#8a8a8a;">unknown (not on either site)</span> · <span style="color:#ffcc66;">➜ gold arrow</span> = alias that can be replaced by its main tag.
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="dbp-btn-scan" id="dbpScanBtn" style="flex:1;">🔍 Scan Dataset Tags</button>
                    <button class="dbp-btn-scan-force" id="dbpScanForceBtn" title="Force recheck ALL tags, even already-cached ones">🔄</button>
                    <button class="dbp-btn-scan-force" id="dbpFillWikiBtn" style="white-space:nowrap;" title="Takes the tags already saved in the Danbooru / e621 cache files First moves the descriptions still stored in those files into local/wiki_full.json, then downloads the wiki text of the tags that have a wiki but are not in it yet (in Full mode also the ones with only the short summary) or whose wiki info is older than 30 days. Needs 💾 Wiki text = Short or Full (localhost).">📚 Fill wiki</button>
                    <button class="dbp-btn-recheck" id="dbpRecheckBtn" title="Force a new verification of every tag saved as unknown">♻️ Recheck unknown tags <span id="dbpUnknownCount"></span></button>
                </div>
                <div style="display:flex; gap:8px; margin-top:8px;">
                    <button class="dbp-btn-scan-force" id="dbpFillWikiDbBtn" style="flex:1; white-space:nowrap;" title="Same as 📚 Fill wiki, but only for the tags saved in the Danbooru cache file (e621 is left alone). Needs 💾 Wiki text = Short or Full (localhost).">🅱️ Fill wiki (Danbooru)</button>
                    <button class="dbp-btn-scan-force" id="dbpFillWikiE6Btn" style="flex:1; white-space:nowrap;" title="Same as 📚 Fill wiki, but only for the tags saved in the e621 cache file (Danbooru is left alone). Needs Enable e621 and 💾 Wiki text = Short or Full (localhost).">🦊 Fill wiki (e621)</button>
                </div>
                <div style="display:flex; gap:10px; align-items:center; margin-top:8px; font-size:12px; color:#bbb;">
                    <label id="dbpFillRecLbl" style="display:flex; gap:6px; align-items:center; cursor:pointer;" title="Applies to all three Fill wiki buttons. Wiki texts link to other tags ([[long hair]]). In recursive mode Fill wiki also reads the links inside the wikis already saved (needs 💾 Wiki text = Full to read them from the file) and inside every wiki it downloads: a linked tag that is already saved is not downloaded again, a linked tag that is missing is downloaded (count, category, wiki and text) and its own links are followed in turn. Up to 1000 new tags per site per run."><input type="checkbox" id="dbpFillRecursive"> 🔁 Recursive (follow links in wikis)</label>
                    <label style="display:flex; gap:5px; align-items:center;" title="How many link levels to follow: 1 = only the tags linked by the tags being filled; 2 = also the tags linked by those; and so on.">Depth
                        <select id="dbpFillDepth" style="background:#1a1a1a; color:#ddd; border:1px solid #333; border-radius:4px; padding:2px 4px;"><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option><option value="5">5</option></select>
                    </label>
                </div>
                    </div>
                </details>

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
        document.getElementById('dbpFillWikiBtn').onclick = () => window.runDanbooruFillWiki();
        document.getElementById('dbpFillWikiDbBtn').onclick = () => window.runDanbooruFillWiki('danbooru');
        document.getElementById('dbpFillWikiE6Btn').onclick = () => window.runDanbooruFillWiki('e621');
        (function bindRecursiveOpts() {
            const cb = document.getElementById('dbpFillRecursive'), sel = document.getElementById('dbpFillDepth');
            if (!cb || !sel) return;
            if (typeof window.getSetting === 'function') {
                Promise.resolve(window.getSetting('dbp-fill-recursive', false)).then(v => { cb.checked = !!v; });
                Promise.resolve(window.getSetting('dbp-fill-depth', 3)).then(v => { if ([1, 2, 3, 4, 5].includes(Number(v))) sel.value = String(v); });
            }
            cb.onchange = () => { if (typeof window.saveSetting === 'function') window.saveSetting('dbp-fill-recursive', cb.checked); if (window.SharedSettings) window.SharedSettings.set('dbp-fill-recursive', cb.checked); };
            sel.onchange = () => { if (typeof window.saveSetting === 'function') window.saveSetting('dbp-fill-depth', Number(sel.value)); if (window.SharedSettings) window.SharedSettings.set('dbp-fill-depth', Number(sel.value)); };
            if (window.SharedSettings) {
                const SS = window.SharedSettings;
                SS.register('dbp-fill-recursive', v => { cb.checked = !!v; if (typeof window.saveSetting === 'function') window.saveSetting('dbp-fill-recursive', !!v); }, { own: () => window.getSetting('dbp-fill-recursive', false) });
                SS.register('dbp-fill-depth', v => { if ([1, 2, 3, 4, 5].includes(Number(v))) { sel.value = String(Number(v)); if (typeof window.saveSetting === 'function') window.saveSetting('dbp-fill-depth', Number(v)); } }, { own: () => window.getSetting('dbp-fill-depth', 3) });
                // wiki text mode + e621 SFW (the modal controls may not exist yet: only the values are applied here, the controls are refreshed on open)
                SS.register('dbp-wiki-mode', v => {
                    if (!['off', 'short', 'full'].includes(v)) return;
                    window.danbooruWikiMode = v; if (typeof window.saveSetting === 'function') window.saveSetting('dbp-wiki-mode', v);
                    const m = document.getElementById('dbpOptWikiMode'); if (m && window.MAT_IS_LOCAL) m.value = v;
                    updateFillWikiState();
                }, { own: () => window.getSetting('dbp-wiki-mode', null) });
                SS.register('toggle-e621-sfw', v => {
                    window._e621SfwChoice = !!v; if (typeof window.saveSetting === 'function') window.saveSetting('toggle-e621-sfw', !!v);
                    const c = document.getElementById('toggle-e621-sfw'); if (c) c.checked = !!v;
                    applyDerivedFlags();
                }, { own: () => window.getSetting('toggle-e621-sfw', false) });
            }
        })();

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

        // Expand save mode: the full text is already in the local file — no request, flagged "offline".
        const fromFile = dbpFullFromFile(site.key, key);
        if (fromFile && fromFile.full) {
            descEl.dataset.original = fromFile.text;
            descEl.innerHTML = dbpOfflineBadge(fromFile.ts) + window.formatDanbooruDText(fromFile.text).split('https://danbooru.donmai.us/').join(`https://${host}/`);
            trBtn.style.display = 'inline-block';
            trBtn.onclick = () => translateDescNode(descEl);
            return;
        }

        try {
            const wRes = await fetch(`https://${host}/wiki_pages/${encodeURIComponent(wikiName)}.json`);
            if (token !== dbpSearchToken) return;
            if (wRes.ok) {
                const wData = await wRes.json();
                if (wData && wData.body && wData.body.trim()) {
                    if (dbpStoreOn()) site.saveFull(key, wData.body);
                    descEl.dataset.original = wData.body;
                    // formatDanbooruDText builds Danbooru links; point them to this card's own site.
                    descEl.innerHTML = window.formatDanbooruDText(wData.body).split('https://danbooru.donmai.us/').join(`https://${host}/`);
                    trBtn.style.display = 'inline-block';
                    trBtn.onclick = () => translateDescNode(descEl);
                } else {
                    descEl.innerHTML = 'Wiki of this tag is empty';
                }
            } else if (dbpShowSavedText(descEl, fromFile, info)) {
                trBtn.style.display = 'inline-block';
                trBtn.onclick = () => translateDescNode(descEl);
            } else {
                descEl.innerHTML = wRes.status === 404 ? 'Wiki of this tag is empty' : 'Wiki not found or error loading.';   // 404 = the tag exists but has no wiki page
            }
        } catch (e) {
            if (token !== dbpSearchToken) return;
            if (dbpShowSavedText(descEl, fromFile, info)) {
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
            if (window.SharedSettings) window.SharedSettings.set('toggle-e621-sfw', window._e621SfwChoice);
            applyDerivedFlags();
        };

        const selMode = document.getElementById('dbpOptWikiMode');
        if (selMode) {
            selMode.onchange = async (e) => {
                if (!window.MAT_IS_LOCAL) { e.target.value = 'short'; return; }
                window.danbooruWikiMode = e.target.value;
                await window.saveSetting('dbp-wiki-mode', window.danbooruWikiMode);
                if (window.SharedSettings) window.SharedSettings.set('dbp-wiki-mode', window.danbooruWikiMode);
                updateFillWikiState();
                if (window.showAlert) window.showAlert({
                    off: 'Wiki text: OFF — new wikis are not saved (texts already in the file stay).',
                    short: '💾 Wiki text: SHORT — the first 800 characters of each wiki are saved in wiki_full.json.',
                    full: '💾 Wiki text: FULL — complete wikis (text + links) are saved in wiki_full.json (a scan or 📚 Fill wiki completes the tags that only have the summary).'
                }[window.danbooruWikiMode], 'info', 4500);
                if (window.danbooruWikiMode !== 'off' && typeof window.runDanbooruBackgroundScan === 'function') window.runDanbooruBackgroundScan();
            };
        }

        [['dbpOptStatusDb', 'danbooru'], ['dbpOptStatusE6', 'e621']].forEach(([id, site]) => {
            const cb = document.getElementById(id);
            if (!cb) return;
            cb.onchange = async (e) => {
                window._booruStatusOn[site] = e.target.checked;
                await window.saveSetting('booru-status-' + site, e.target.checked);
                applyStatusVisibility();
            };
        });

        const cbIdle = document.getElementById('dbpOptIdleFill');
        if (cbIdle) {
            cbIdle.onchange = (e) => {
                if (!window.IdleFill) { e.target.checked = false; return; }
                window.IdleFill.setEnabled(e.target.checked);
                if (window.showAlert) window.showAlert(e.target.checked
                    ? '🤖 Auto-fill when idle ON — while the app has nothing to do it fills in missing info and adds new tags from the sites, in small batches.'
                    : '🤖 Auto-fill when idle OFF.', 'info', 4000);
            };
            const bindIdle = () => {
                if (!window.IdleFill) return;
                window.IdleFill.extraPool = collectInfoScanTags;
                cbIdle.checked = window.IdleFill.enabled();
                window.IdleFill.onStatus(t => { const el = document.getElementById('dbpIdleStatus'); if (el) el.textContent = t ? '(' + t + ')' : '(fills missing info and adds new tags while the app is idle)'; cbIdle.checked = window.IdleFill.enabled(); });
            };
            bindIdle();
            document.addEventListener('idlefill:ready', bindIdle);
        }
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
        const cbIdleSync = document.getElementById('dbpOptIdleFill');
        if (cbIdleSync && window.IdleFill) cbIdleSync.checked = window.IdleFill.enabled();
        const cbExp = document.getElementById('dbpOptWikiMode');
        if (cbExp) {
            const local = !!window.MAT_IS_LOCAL;
            cbExp.value = local ? dbpMode() : 'short';
            cbExp.disabled = !local;
            const lbl = document.getElementById('dbpOptExpandLbl');
            if (lbl) lbl.classList.toggle('is-disabled', !local);
            updateFillWikiState();
            if (lbl && !local) lbl.title = 'Only available on localhost (server_max.py / the .bat): wiki texts are saved as a file in the local folder. Elsewhere the short summary stays in the browser cache.';
        }
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
        if (window.SharedSettings) window.SharedSettings.set('toggle-e621-sfw', cb.checked);
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

        const fromFile = dbpFullFromFile('danbooru', tagLower);
        if (fromFile && fromFile.full) {
            descEl.dataset.original = fromFile.text;
            descEl.innerHTML = dbpOfflineBadge(fromFile.ts) + window.formatDanbooruDText(fromFile.text);
            return;
        }

        try {
            const wRes = await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent((info && info.wikiName) ? info.wikiName : tagLower.replace(/ /g, '_'))}.json`);
            if (wRes.ok) {
                const wData = await wRes.json();
                if (wData && wData.body && wData.body.trim()) {
                    if (dbpStoreOn() && window.dbSaveWikiFull) window.dbSaveWikiFull(tagLower, wData.body);
                    descEl.dataset.original = wData.body;
                    descEl.innerHTML = window.formatDanbooruDText(wData.body);
                } else {
                    descEl.innerHTML = "Wiki of this tag is empty";
                }
            } else if (!dbpShowSavedText(descEl, fromFile, info)) {
                 descEl.innerHTML = wRes.status === 404 ? "Wiki of this tag is empty" : "Wiki not found or error loading.";
            }
        } catch(e) {
            if (!dbpShowSavedText(descEl, fromFile, info)) {
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

        const fromFile = dbpFullFromFile('e621', tagLower);
        if (fromFile && fromFile.full) {
            descEl.dataset.original = fromFile.text;
            descEl.innerHTML = dbpOfflineBadge(fromFile.ts) + window.formatDanbooruDText(fromFile.text);
            return;
        }

        try {
            const wRes = await fetch(`https://${host}/wiki_pages/${encodeURIComponent((info && info.wikiName) ? info.wikiName : tagLower.replace(/ /g, '_'))}.json`);
            if (wRes.ok) {
                const wData = await wRes.json();
                if (wData && wData.body && wData.body.trim()) {
                    if (dbpStoreOn() && window.e621SaveWikiFull) window.e621SaveWikiFull(tagLower, wData.body);
                    descEl.dataset.original = wData.body;
                    descEl.innerHTML = window.formatDanbooruDText(wData.body);
                } else {
                    descEl.innerHTML = "Wiki of this tag is empty";
                }
            } else if (!dbpShowSavedText(descEl, fromFile, info)) {
                descEl.innerHTML = wRes.status === 404 ? "Wiki of this tag is empty" : "Wiki not found or error loading.";
            }
        } catch (e) {
            if (!dbpShowSavedText(descEl, fromFile, info)) {
                descEl.innerHTML = "Error loading wiki from e621.";
            }
        }
    };

    /* ---------- 3RD POPOUT: ⁉️ both sites at once (Danbooru + e621 side by side) ---------- */
    function buildBothInfoModal() {
        if (document.getElementById('modal-both-tag-info')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-both-tag-info';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-both-tag-info');
        const col = (site, color, title, linkLabel, linkColor, linkBorder) => `
            <div class="dbb-col" data-site="${site}">
                <div style="color:${color}; font-weight:bold; font-size:13px; margin-bottom:6px;">${title}</div>
                <div><span class="dbp-tag-cat" id="dbb_${site}_cat"></span></div>
                <div class="dbp-desc" id="dbb_${site}_desc"></div>
                <div style="display:flex; gap:8px; align-items:center; margin-top:10px;">
                    <button id="dbb_${site}_tr" style="background:#2f1a5c; color:#b890ff; border:1px solid #4a2a8c; border-radius:6px; padding:6px 12px; font-size:12px; font-weight:bold; cursor:pointer;">🌐 Translate</button>
                    <a href="#" target="_blank" id="dbb_${site}_link" style="color:${linkColor}; text-decoration:none; border:1px solid ${linkBorder}; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; display:inline-block;">${linkLabel}</a>
                </div>
            </div>`;
        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span id="dbbTitle">⁉️ Tag Info — Danbooru + e621</span>
                    <button onclick="window.closeModal('modal-both-tag-info')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div class="dbb-cols">
                    ${col('danbooru', '#5aa9ff', '❓ Danbooru', 'Open on Danbooru ↗', '#5aa9ff', '#2a6aa8')}
                    ${col('e621', '#ffb74d', '❔ e621', 'Open on e621 ↗', '#ffb74d', '#aa7722')}
                </div>
                <div class="modal-buttons" style="margin-top: 15px;">
                    <button class="btn-cancel" onclick="window.closeModal('modal-both-tag-info')">Close</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        ['danbooru', 'e621'].forEach(k => { document.getElementById('dbb_' + k + '_tr').onclick = () => translateDescNode(document.getElementById('dbb_' + k + '_desc')); });
    }

    async function dbbLoadSite(site, tagLower) {
        const e6 = site === 'e621';
        const catEl = document.getElementById('dbb_' + site + '_cat');
        const descEl = document.getElementById('dbb_' + site + '_desc');
        const linkEl = document.getElementById('dbb_' + site + '_link');
        const host = e6 ? e621HostForLinks() : 'danbooru.donmai.us';
        const slug = encodeURIComponent(tagLower.replace(/ /g, '_'));
        descEl.innerHTML = 'Loading full wiki description...';
        descEl.dataset.original = '';
        catEl.innerHTML = '';
        linkEl.href = `https://${host}/wiki_pages/${slug}`;

        const getC = e6 ? window.e621GetCachedTag : window.dbGetCachedTag;
        let info = typeof getC === 'function' ? getC(tagLower) : null;
        if (!info || info.count === undefined) {
            const look = e6 ? window.e621LookupSingleTag : window.dbLookupSingleTag;
            if (look) { try { info = await look(tagLower); } catch (e) {} }
        }
        if (info) {
            const colors = e6 ? window.E621_CAT_COLORS : DB_CAT_COLORS;
            const labels = e6 ? window.E621_CAT_LABELS : DB_CAT_LABELS;
            const dep = info.isDeprecated ? ` <span style="color:#888;">· Deprecated</span>` : '';
            catEl.innerHTML = `<span style="color:${(colors && colors[info.category]) || '#888'}">● ${(labels && labels[info.category]) || 'Unknown'} (${Number(info.count || 0).toLocaleString()} posts)</span>${dep}`;
        } else {
            catEl.innerHTML = `<span style="color:#888;">Tag not found on ${e6 ? 'e621' : 'Danbooru'}</span>`;
        }

        const fromFile = dbpFullFromFile(site, tagLower);
        if (fromFile && fromFile.full) {
            descEl.dataset.original = fromFile.text;
            descEl.innerHTML = dbpOfflineBadge(fromFile.ts) + window.formatDanbooruDText(fromFile.text);
            return;
        }
        try {
            const name = (info && info.wikiName) ? info.wikiName : tagLower.replace(/ /g, '_');
            const wRes = await fetch(`https://${host}/wiki_pages/${encodeURIComponent(name)}.json`);
            if (wRes.ok) {
                const wData = await wRes.json();
                if (wData && wData.body && wData.body.trim()) {
                    const saver = e6 ? window.e621SaveWikiFull : window.dbSaveWikiFull;
                    if (dbpStoreOn() && saver) saver(tagLower, wData.body);
                    descEl.dataset.original = wData.body;
                    descEl.innerHTML = window.formatDanbooruDText(wData.body);
                } else {
                    descEl.innerHTML = 'Wiki of this tag is empty';
                }
            } else if (!dbpShowSavedText(descEl, fromFile, info)) {
                descEl.innerHTML = wRes.status === 404 ? 'Wiki of this tag is empty' : 'Wiki not found or error loading.';
            }
        } catch (e) {
            if (!dbpShowSavedText(descEl, fromFile, info)) descEl.innerHTML = 'Error loading wiki from ' + (e6 ? 'e621' : 'Danbooru') + '.';
        }
    }

    window.openBothTagInfoPopout = function (tagLower) {
        buildBothInfoModal();
        const t = String(tagLower || '').toLowerCase();
        document.getElementById('dbbTitle').textContent = '⁉️ ' + t.replace(/_/g, ' ') + ' — Danbooru + e621';
        window.openModal('modal-both-tag-info');
        dbbLoadSite('danbooru', t);
        dbbLoadSite('e621', t);
    };

    /* ---------- SCAN DO DATASET (contagem em lote + wiki tag-a-tag) ---------- */
    function setScanButtonsDisabled(disabled) {
        ['dbpScanBtn', 'dbpScanForceBtn', 'dbpRecheckBtn', 'dbpFillWikiBtn', 'dbpFillWikiDbBtn', 'dbpFillWikiE6Btn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.disabled = disabled;
        });
        if (!disabled) updateFillWikiState();
    }

    // 📚 Fill wiki is only usable on localhost with Wiki text = Short or Full.
    function updateFillWikiState() {
        const ok = dbpStoreOn();
        ['dbpFillWikiBtn', 'dbpFillWikiDbBtn', 'dbpFillWikiE6Btn'].forEach(id => {
            const b = document.getElementById(id);
            if (!b) return;
            b.disabled = !ok || !!window._dbInfoScanRunning;
            b.style.opacity = ok ? '' : '0.45';
            if (!ok) b.title = 'Set 💾 Wiki text to Short or Full first (localhost only).';
        });
    }

    /* ---------- CONTADOR NO BOTÃO DO TOPBAR ----------
       While a scan / Fill wiki runs, the 🏷️ Tag Interrogator button shows "done/total"
       (so it is visible with the panel closed) and goes back to its label when it ends. */
    let _tbLast = 0, _tbWatch = null;
    // Shows "<site icon> done/total" of the site being worked on (each site has its own numbers; they are never added up).
    const TB_ICONS = { danbooru: '🅱️', e621: '🦊' }, TB_NAMES = { danbooru: 'Danbooru', e621: 'e621' };
    function tbSetCounter(done, total, site) {
        const b = document.getElementById('btn-open-tag-interrogator');
        if (!b) return;
        if (b.dataset.label === undefined) { b.dataset.label = b.textContent; b.dataset.title = b.title; b.style.minWidth = b.offsetWidth + 'px'; }
        b.textContent = `${TB_ICONS[site] || ''} ${done}/${total}`.trim();
        b.title = `Tag Interrogator is working on ${TB_NAMES[site] || 'tags'}: ${done} of ${total}. Click to open the panel.`;
        _tbLast = Date.now();
        if (!_tbWatch) _tbWatch = setInterval(() => {
            // safety net: if a scan ended without clearing (error), restore the button
            if (!window._dbInfoScanRunning && Date.now() - _tbLast > 5000) tbClearCounter();
        }, 1500);
    }
    function tbClearCounter() {
        clearInterval(_tbWatch); _tbWatch = null;
        const b = document.getElementById('btn-open-tag-interrogator');
        if (!b || b.dataset.label === undefined) return;
        b.textContent = b.dataset.label; b.title = b.dataset.title || '';
        b.style.minWidth = '';
        delete b.dataset.label; delete b.dataset.title;
    }

    /* ---------- 📚 FILL WIKI ---------- */
    // site: 'danbooru' | 'e621' = only that site; omitted = both.
    window.runDanbooruFillWiki = async function (site) {
        const onlyDb = site === 'danbooru', onlyE6 = site === 'e621';
        const siteLabel = onlyDb ? 'Danbooru' : onlyE6 ? 'e621' : '';
        if (onlyE6 && !window.showE621) {
            if (window.showAlert) window.showAlert('Enable e621 in the Tag Interrogator settings first.', 'warn');
            return;
        }
        if (!window.danbooruInfoEnabled) {
            if (window.showAlert) window.showAlert('Tag Interrogator is disabled in Settings.', 'warn');
            return;
        }
        if (!dbpStoreOn()) {
            if (window.showAlert) window.showAlert('Set 💾 Wiki text to Short or Full first (localhost only).', 'warn');
            return;
        }
        if (window._dbInfoScanRunning) {
            if (window.showAlert) window.showAlert('A scan is already running.', 'info');
            return;
        }
        // Step 1: move the `description` summaries still stored in the cache files into wiki_full.json (and drop them from the caches).
        let migrated = 0;
        try {
            const m1 = (window.dbMigrateDescriptions && !onlyE6) ? await window.dbMigrateDescriptions() : null;
            const m2 = (window.e621MigrateDescriptions && !onlyDb) ? await window.e621MigrateDescriptions() : null;
            migrated = ((m1 && m1.moved) || 0) + ((m2 && m2.moved) || 0);
            if ((m1 && m1.ok === false) || (m2 && m2.ok === false)) {
                if (window.showAlert) window.showAlert('local/wiki_full.json could not be read, so nothing was changed. Check that the localhost server is running.', 'warn');
                return;
            }
        } catch (e) { console.warn('[Fill wiki] migration', e); }

        // Step 2: the list comes from the tags ALREADY SAVED in the Danbooru / e621 cache files (not from the loaded dataset):
        // every saved tag that has a wiki but whose text is not in wiki_full.json yet (or only the short summary, in Full mode),
        // or whose wiki info is older than 30 days, is downloaded again.
        const dbTags = (window.dbWikiFillList && !onlyE6) ? window.dbWikiFillList() : [];
        const e6Tags = (!onlyDb && window.showE621 && window.e621WikiFillList && typeof window.e621FetchWikiBatch === 'function') ? window.e621WikiFillList() : [];
        const recursive = !!(document.getElementById('dbpFillRecursive') || {}).checked;
        const depth = Number((document.getElementById('dbpFillDepth') || {}).value) || 3;
        // Recursive mode also starts from every saved tag whose full wiki text is in wiki_full.json (to read its links).
        let dbSeeds = dbTags, e6Seeds = e6Tags;
        if (recursive) {
            if (!onlyE6 && window.dbFullTextTags) dbSeeds = Array.from(new Set(dbTags.concat(window.dbFullTextTags())));
            if (e6Tags.length || (!onlyDb && window.showE621)) { if (window.e621FullTextTags) e6Seeds = Array.from(new Set(e6Tags.concat(window.e621FullTextTags()))); }
            if (onlyDb) e6Seeds = []; if (onlyE6) dbSeeds = [];
            if (!window.showE621) e6Seeds = [];
        }
        const total = dbSeeds.length + e6Seeds.length;
        if (total === 0) {
            if (window.showAlert) window.showAlert(`Fill wiki${siteLabel ? ' (' + siteLabel + ')' : ''}: ${migrated} description(s) moved to wiki_full.json. Nothing else to update — every saved tag with a wiki has its text and it is up to date.`, 'info');
            refreshAll();
            return;
        }
        const minutes = Math.max(1, Math.round(total * 0.4 / 60));
        if (recursive) {
            if (!confirm(`Recursive Fill wiki${siteLabel ? ' (' + siteLabel + ')' : ''}: starts from ${total} saved tag(s), follows the links inside their wikis up to ${depth} level(s) and downloads the linked tags that are not saved yet (up to 1000 new tags per site).\nThe Tag Interrogator button shows the progress.\n\nContinue?`)) return;
        } else if (total > 150 && !confirm(`Fill wiki${siteLabel ? ' (' + siteLabel + ')' : ''} will download the full wiki of ${total} saved tag(s) (about ${minutes} min).\nYou can close this panel — the Tag Interrogator button shows the progress.\n\nContinue?`)) return;

        window._dbInfoScanRunning = true;
        window._dbBackgroundScanCancelled = false;
        window._e621BackgroundScanCancelled = false;
        const progress = document.getElementById('dbpScanProgress');
        setScanButtonsDisabled(true);
        const prog = { danbooru: 0, e621: 0 };
        const totals = { danbooru: dbSeeds.length, e621: e6Seeds.length };
        const added = { danbooru: 0, e621: 0 };
        const show = (done, site, tot) => {
            prog[site] = done;
            if (tot) totals[site] = tot;
            tbSetCounter(done, totals[site], site);
            if (progress) {
                progress.style.display = 'block';
                const parts = [];
                if (totals.danbooru) parts.push(`Danbooru: ${prog.danbooru} / ${totals.danbooru}`);
                if (totals.e621) parts.push(`e621: ${prog.e621} / ${totals.e621}`);
                progress.textContent = `Filling wiki — ${parts.join(' · ')}`;
            }
        };
        show(0, dbSeeds.length ? 'danbooru' : 'e621');

        try {
            if (recursive) {
                if (dbSeeds.length && window.dbWikiRecursive) await window.dbWikiRecursive(dbSeeds, { depth, maxNew: 1000, onProgress: (d, t, a) => { added.danbooru = a; show(d, 'danbooru', t); } });
                if (e6Seeds.length && window.e621WikiRecursive) await window.e621WikiRecursive(e6Seeds, { depth, maxNew: 1000, onProgress: (d, t, a) => { added.e621 = a; show(d, 'e621', t); } });
            } else {
                if (dbTags.length) await window.dbFetchWikiBatch(dbTags, false, () => scheduleIconRefresh(), (d) => show(d, 'danbooru'));
                if (e6Tags.length && typeof window.e621FetchWikiBatch === 'function') {
                    await window.e621FetchWikiBatch(e6Tags, false, () => scheduleIconRefresh(), (d) => show(d, 'e621'));
                }
            }
        } finally {
            window._dbInfoScanRunning = false;
            tbClearCounter();
            if (progress) progress.style.display = 'none';
            setScanButtonsDisabled(false);
        }

        const saved = dbTags.filter(t => window.WikiFull.has('danbooru', t)).length + e6Tags.filter(t => window.WikiFull.has('e621', t)).length;
        refreshAll();
        if (recursive) {
            if (window.showAlert) window.showAlert(`Recursive Fill wiki${siteLabel ? ' (' + siteLabel + ')' : ''} complete: ${migrated} description(s) moved to wiki_full.json, ${added.danbooru + added.e621} new tag(s) added from wiki links (Danbooru ${added.danbooru}, e621 ${added.e621}).`, 'success');
            return;
        }
        if (window.showAlert) window.showAlert(`Fill wiki${siteLabel ? ' (' + siteLabel + ')' : ''} complete: ${migrated} description(s) moved to wiki_full.json, ${saved} of ${total} wiki text(s) downloaded/updated.`, saved === total ? 'success' : 'warn');
    };

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
                tbSetCounter(done, total, 'danbooru'); if (progress) progress.textContent = `Scanning Danbooru: ${done} / ${total} (found ${found})`;
            }
        );

        let e621Found = 0;
        if (window.showE621 && typeof window.e621FetchWikiBatch === 'function') {
            const e621Result = await window.e621FetchWikiBatch(
                tags,
                force,
                () => scheduleIconRefresh(),
                (done, total, found) => {
                    tbSetCounter(done, total, 'e621'); if (progress) progress.textContent = `Scanning e621: ${done} / ${total} (found ${found})`;
                }
            );
            e621Found = e621Result.found;
        }

        window._dbInfoScanRunning = false;
        tbClearCounter();
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
                        (done, total) => { tbSetCounter(done, total, 'danbooru'); say(`Danbooru wiki info: ${done} / ${total}`); });
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
                        (done, total) => { tbSetCounter(done, total, 'e621'); say(`e621 wiki info: ${done} / ${total}`); });
                }
            }
        } catch (err) {
            console.warn('[Recheck unknown tags]', err);
        }

        window._dbInfoScanRunning = false;
        tbClearCounter();
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
                tbSetCounter(done, total, 'danbooru'); if (progress) progress.textContent = `Background scan (Danbooru): ${done} / ${total} (found ${found})`;
            }
        );

        if (window.showE621 && typeof window.e621FetchWikiBatch === 'function') {
            await window.e621FetchWikiBatch(
                tags,
                false,
                () => scheduleIconRefresh(),
                (done, total, found) => {
                    tbSetCounter(done, total, 'e621'); if (progress) progress.textContent = `Background scan (e621): ${done} / ${total} (found ${found})`;
                }
            );
        }

        window._dbInfoScanRunning = false;
        tbClearCounter();
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

    function makeWikiIcon(tagLower, hasDb, hasE6, empty) {
        const icon = document.createElement('span');
        icon.dataset.wikiIcon = '1';
        if (hasDb && hasE6) {
            icon.className = 'tag-both-info';
            icon.textContent = '⁉️';
            icon.title = 'Info found on Danbooru AND e621 — click to see both side by side';
            icon.onclick = (e) => { e.stopPropagation(); window.openBothTagInfoPopout(tagLower); };
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
        if (empty) {   // the tag exists but its wiki is empty: same icon, dimmed (the popout says "Wiki of this tag is empty")
            icon.style.opacity = '0.4';
            icon.title = 'The wiki of this tag is empty' + (hasDb && hasE6 ? ' on Danbooru and e621' : hasDb ? ' on Danbooru' : ' on e621') + ' — click to open it';
        }
        return icon;
    }

    /* ghost = sugestão 💡: wiki ainda não checada também conta (o clique
       abre o popout, que busca na hora — ghosts quase nunca passaram pelo scan). */
    // 'yes' = has a wiki (or may have one: ghost not checked yet) · 'empty' = the tag exists but its wiki is empty · '' = nothing to show
    function wikiState(info, ghost) {
        if (!info) return ghost ? 'yes' : '';
        if (info.hasWikiInfo) return 'yes';
        if (ghost && !info.wikiChecked) return 'yes';
        if (info.wikiChecked && ((info.count || 0) > 0 || info.aliasTo)) return 'empty';
        return '';
    }

    function placeWikiIcon(row, anchorBtn, tagLower, ghost) {
        if (row.querySelector('[data-wiki-icon]')) return;
        const showDb = !!window.danbooruInfoShowIcons;
        const showE6 = !!window.showE621 && typeof window.e621GetCachedTag === 'function';

        // O ícone de alias (❓ Danbooru / ❔ e621) já cobre o lado daquele site nesta linha.
        const aliasIcon = row.querySelector('.tag-alias-info-icon');
        const aliasSrc = aliasIcon ? (aliasIcon.getAttribute('data-alias-source') || 'danbooru') : null;
        const stDb = (showDb && aliasSrc !== 'danbooru' && typeof window.dbGetCachedTag === 'function') ? wikiState(window.dbGetCachedTag(tagLower), ghost) : '';
        const stE6 = (showE6 && aliasSrc !== 'e621') ? wikiState(window.e621GetCachedTag(tagLower), ghost) : '';
        const wikiDb = stDb === 'yes', wikiE6 = stE6 === 'yes';
        if (!wikiDb && !wikiE6) {
            // No site has a wiki text, but the tag exists and its wiki is empty: dimmed icon (not on rows that already have an alias icon).
            const emptyDb = stDb === 'empty', emptyE6 = stE6 === 'empty';
            if ((emptyDb || emptyE6) && !aliasIcon) anchorBtn.parentNode.insertBefore(makeWikiIcon(tagLower, emptyDb, emptyE6, true), anchorBtn);
            return;
        }

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

    // Danbooru / e621 status dots (tools/booru_status.js): each site can be hidden (and then it is not pinged).
    window._booruStatusOn = window._booruStatusOn || { danbooru: true, e621: true };
    function applyStatusVisibility() {
        if (window.BooruStatus) Object.keys(window._booruStatusOn).forEach(site => window.BooruStatus.setEnabled(site, window._booruStatusOn[site]));
        const a = document.getElementById('dbpOptStatusDb'), b = document.getElementById('dbpOptStatusE6');
        if (a) a.checked = !!window._booruStatusOn.danbooru;
        if (b) b.checked = !!window._booruStatusOn.e621;
    }

    async function loadInterrogatorSettings() {
        if (typeof window.getSetting !== 'function') return;
        window.danbooruInfoEnabled = await window.getSetting('danbooru-info-enabled', true);
        window.danbooruInfoShowIcons = await window.getSetting('danbooru-info-show-icons', true);
        window._e621Choice = await window.getSetting('toggle-e621', false);
        window._e621SfwChoice = await window.getSetting('toggle-e621-sfw', false);
        // Wiki text mode: off | short (default) | full. The old "Expand save mode" checkbox becomes "full".
        let wm = await window.getSetting('dbp-wiki-mode', null);
        if (!['off', 'short', 'full'].includes(wm)) wm = (await window.getSetting('dbp-expand-save', false)) ? 'full' : 'short';
        window.danbooruWikiMode = wm;
        window._booruStatusOn = { danbooru: !!(await window.getSetting('booru-status-danbooru', true)), e621: !!(await window.getSetting('booru-status-e621', true)) };
        window.aliasPrimarySource = await window.getSetting('alias-primary-source', 'danbooru');
    }

    // Aplica TODO o efeito visual/funcional do estado atual.
    function applyInterrogatorState(refresh) {
        applyDerivedFlags();
        applyStatusVisibility();
        updateTopbarButtonVisibility();
        applyGearState();
        syncModalOptionStates();

        if (!window.danbooruInfoEnabled) {
            // Para qualquer scan em andamento e fecha as janelas da função.
            window._dbBackgroundScanCancelled = true;
            window._e621BackgroundScanCancelled = true;
            ['modal-danbooru', 'modal-db-tag-info', 'modal-e621-tag-info', 'modal-both-tag-info'].forEach(id => {
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
            if (id === 'modal-danbooru') { updateUnknownBadge(); syncModalOptionStates(); const st = document.getElementById('dbpSettings'); if (st) st.open = false; }   // the settings expander always starts collapsed
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
