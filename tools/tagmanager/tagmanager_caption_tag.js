/* =========================================================================
   CAPTION & TAG EDITOR - CORE (Shared CSS + Helpers)
   ---------------------------------------------------------------------
   Este arquivo era o antigo "tagmanager_caption_tag.js" monolítico
   (~1500 linhas). Foi dividido em módulos menores, todos ainda em
   window.* (sem ES modules), então a ORDEM DE CARREGAMENTO no HTML
   continua importando:

     tagmanager_caption_tag.js          <- este arquivo (CSS + checkIfNL)
     tagmanager_danbooru_autocomplete.js
     tagmanager_danbooru_alias.js
     tagmanager_nl_inline_editor.js
     tagmanager_active_editor.js
     tagmanager_master_list.js

   (nessa ordem, no lugar onde só existia 1 <script> antes, sempre ANTES
   de tagmanager_ui_presets.js / tagmanager_ui_list.js / tagmanager_ui_core.js)

   Nada de lógica foi alterado — é só reorganização de arquivo.
========================================================================= */

const style = document.createElement('style');
style.innerHTML = `
    .tag-nl-edit-box { display: flex; flex-direction: column; gap: 8px; padding: 10px 15px; background: #0d0d0d; border-bottom: 1px solid #222; border-left: 3px solid #00aa66; }
    .tag-nl-edit-textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; font-size: var(--editor-font-size); line-height: 1.5; padding: 10px; background: #111; color: #eee; border: 1px solid #00aa66; border-radius: 6px; font-family: inherit; }
 
    .tag-nl-edit-box.tag-nl-edit-fullscreen { flex: 1; height: 100%; padding: 15px; border-left: none; background: #0d0d0d; }
    .tag-nl-edit-box.tag-nl-edit-fullscreen .tag-nl-edit-textarea { flex: 1; min-height: 200px; resize: none; border: 1px solid #4a2a8c;}
    .btn-nl-edit-translate { background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; padding:6px 14px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:bold; }
    .btn-nl-edit-gemini { background:#2f1a5c; color:#b890ff; border:1px solid #4a2a8c; padding:6px 14px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:bold; }
    .btn-nl-edit-cancel { background: transparent; color: #aaa; border: 1px solid #444; padding: 6px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; margin-right: 8px; transition: 0.2s;}
    .btn-nl-edit-save { background: #00aa66; color: #000; border: none; padding: 6px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; transition: 0.2s; }
 
    .tag-pin:hover { transform: scale(1.15); }
    .tag-pin.active { text-shadow: 0 0 6px rgba(77,184,255,0.7); }
    .pinned-master-tag-row:hover { background: #0d2438 !important; }
 
    .db-autocomplete { position: absolute; bottom: 100%; top: auto; left: 0; background: #111; border: 1px solid #333; z-index: 100; border-radius: 6px 6px 0 0; max-height: 200px; overflow-y: auto; min-width: 100%; width: max-content; box-shadow: 0 -4px 12px rgba(0,0,0,0.8); margin-bottom: 4px; }
    /* Usado pelo input "replace-new-tag" (direction='down'). Sem isto, a lista de
       sugestões sempre abria pra CIMA (herdando a regra acima) mesmo quando devia
       abrir pra baixo — dentro do modal de Replace isso cobria o campo "tag antiga"
       logo acima do input. */
    .db-autocomplete.direction-down { bottom: auto; top: 100%; margin-bottom: 0; margin-top: 4px; border-radius: 0 0 6px 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.8); }
    .db-sugg-item { padding: 8px 10px; border-bottom: 1px solid #222; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 20px; font-size: 12px; white-space: nowrap; }
    .db-sugg-item:hover { background: #222; }
    
    .tag-row.conflict, .master-tag-item.conflict { background: rgba(200, 40, 40, 0.3) !important; border-left: 3px solid #ff4444 !important; }
    .conflict-warning { margin-left: 12px; font-size: 10px; color: #ffaaaa; background: #330000; padding: 2px 8px; border-radius: 12px; border: 1px solid #ff4444; cursor: help; display: inline-block;}
    
    .tag-row.similar, .master-tag-item.similar { background: rgba(200, 150, 40, 0.2) !important; border-left: 3px solid #ffcc00 !important; }
    .similar-warning { margin-left: 12px; font-size: 10px; color: #ffeeaa; background: #332200; padding: 2px 8px; border-radius: 12px; border: 1px solid #ffcc00; cursor: help; display: inline-block;}
    
    .tag-row.glow-favorite, .master-tag-item.glow-favorite { background: rgba(0, 80, 40, 0.4) !important; border-left: 3px solid #00ff99 !important; transition: 0.1s; }
    /* Seleção (azul) precisa continuar visível mesmo quando a tag também é favorita (⭐).
       Sem isto, o !important do glow-favorite sempre "vencia" o background da seleção,
       fazendo parecer que a tag não estava selecionada. Maior especificidade (2 classes)
       resolve isto sem precisar mexer na ordem das regras. */
    .tag-row.selected-active.glow-favorite, .master-tag-item.selected-master.glow-favorite {
        background: #0a3a5c !important;
        border-left: 3px solid #4db8ff !important;
    }
    .tag-row.filter-match { box-shadow: inset 0 0 0 1px #ff9500; background: rgba(255, 149, 0, 0.14) !important; }
    .tag-row.is-preset, .master-tag-item.is-preset { background: rgba(45, 212, 191, 0.14) !important; border-left: 3px solid #2dd4bf !important; }
	.tag-to-ghost { color: #00ff99; cursor: pointer; font-weight: bold; font-size: 1.1em; padding: 0 0.4em; flex-shrink: 0; opacity: 0.85; }
    .tag-to-ghost:hover { color: #fff; transform: scale(1.2); opacity: 1; }
 
    .db-alias-arrow { color: #ffcc66; font-weight: normal; font-size: 11px; margin-left: 4px; }
    .db-dep-badge { display: inline-block; color: #f48fb1; background: rgba(244,143,177,.12); border: 1px solid rgba(244,143,177,.35); border-radius: 8px; font-size: 9px; font-weight: bold; letter-spacing: .3px; text-transform: lowercase; padding: 0 6px; cursor: help; vertical-align: middle; }
    .tag-alias-arrow { color:#ffcc66; font-size:10px; margin-left:6px; font-weight:bold; cursor:help; }
    .tag-alias-info-icon { cursor: pointer; font-weight: bold; font-size: 1em; padding: 0 0.35em; flex-shrink: 0; opacity: 0.85; user-select: none; transition: 0.1s; }
    .tag-alias-info-icon:hover { transform: scale(1.2); opacity: 1; }

    .tag-name-convertible { cursor: pointer; text-decoration: underline dotted; text-decoration-color: rgba(255,204,102,0.55); text-underline-offset: 3px; }
    .tag-name-convertible:hover { color: #fff !important; }
    .tag-alias-reverse-list { color: #4db8ff; font-size: 10px; margin-left: 8px; font-weight: bold; opacity: 0.9; }
`;
document.head.appendChild(style);
 
window.checkIfNL = function(tag) {
    if (!tag) return false;
    if (typeof datasetConfig !== 'undefined' && datasetConfig.manualNLRules && datasetConfig.manualNLRules[tag] !== undefined) {
        return datasetConfig.manualNLRules[tag] === 'nl';
    }
    if (tag.startsWith('NL:')) return true;
    return window.enableAutoNl !== false && tag.trim().split(/\s+/).length >= (window.nlWordThreshold || 6);
};


/* =========================================================================
   NL MANAGER — legenda limpa no disco + mapa de NL por dataset
   ---------------------------------------------------------------------
   Em memória a NL continua sendo uma tag "NL:texto" (vírgulas reais
   trocadas por "，", pra o split(',') do modo Tag não quebrar).
   No .txt/.json vai SÓ o texto limpo (sem "NL:", vírgulas normais).

   Onde está cada NL fica em "_nl_manager.json", dentro da PRÓPRIA pasta
   do dataset (o trainer ignora: não tem o nome de nenhuma imagem):
     { "version": 1, "images": { "<baseName>": [
         { "raw": "NL:a girl standing， smiling", "text": "a girl standing, smiling",
           "first": "a", "last": "smiling", "start": 0, "end": 1 } ] } }

   Reconstrução ao carregar (decode), em camadas:
     1) TEXTO exato entre vírgulas                       -> junta numa NL só.
     2) ÂNCORAS (texto editado fora do app): um trecho que COMEÇA com a
        primeira palavra (first) e TERMINA com a última (last); se houver
        mais de um, fica o mais perto da posição gravada (start/end).
        -> junta o texto ATUAL do arquivo numa NL e o mapa é regravado.
     3) Reserva DO DATASET (_nl_known_texts.json na própria pasta), texto exato.
        (2026-11: saiu de local/nl_known_texts.json, que crescia sem fim com
        tudo o que era digitado. O arquivo antigo só é LIDO: uma frase que
        aparece numa legenda migra para a reserva da pasta; ele nunca mais é
        gravado e pode ser apagado.)
   Legado: mapas antigos em _tagger_config.json (datasetConfig[base].nl)
   ainda são lidos e migram pro _nl_manager.json no próximo save.
========================================================================= */
/* Texto de exibição de uma tag: NL nunca mostra o prefixo "NL:" na lista. */
window.nlDisplay = function (tag) {
    return String(tag == null ? '' : tag).replace(/^\s*NL:\s*/i, '');
};

window.NLCodec = (function () {
    const FILE = '_nl_manager.json';
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const words = s => (String(s || '').toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []);
    const firstWord = s => words(s)[0] || '';
    const lastWord = s => { const w = words(s); return w[w.length - 1] || ''; };
    const segCount = s => String(s).split(',').length;

    /* ---------- encode: memória -> disco ---------- */
    function encode(content) {
        const map = [];
        const out = [];
        let seg = 0; // índice do segmento (entre vírgulas) no texto do disco
        String(content || '').split(',').map(t => t.trim()).filter(Boolean).forEach(tok => {
            let text = tok;
            if (/^NL:/i.test(text)) text = text.slice(3).trim();
            text = text.replace(/，/g, ',').replace(/\s*[\r\n]+\s*/g, ' ').trim();
            if (!text) return;                       // "NL:" vazio não vai pro disco
            const n = segCount(text);
            if (text !== tok) map.push({ raw: tok, text, first: firstWord(text), last: lastWord(text), start: seg, end: seg + n - 1 });
            out.push(text);
            seg += n;
        });
        return { text: out.join(', '), map };
    }

    /* ---------- decode: disco -> memória ---------- */
    // Tag interna SEM prefixo: a NL é marcada só pela regra manualNLRules
    // (o "NL:" aparecia escrito na lista de tags).
    const stripPrefix = t => String(t || '').replace(/^\s*NL:\s*/i, '');
    function markNL(tag) {
        if (!tag || typeof datasetConfig === 'undefined') return;
        if (!datasetConfig.manualNLRules) datasetConfig.manualNLRules = {};
        datasetConfig.manualNLRules[tag] = 'nl';
    }
    function toRaw(entry, diskText) {
        return diskText.replace(/,/g, '，');
    }

    function decodeEx(text, map, knownObj) {
        let s = String(text || '');
        const res = { text: s, recovered: [], lost: [] };
        if (!s) return res;
        const entries = (map || []).filter(e => e && e.text && e.raw);
        const k = knownObj || activeKnown || {};

        // Reserva do dataset: só o que não está no mapa e aparece no texto.
        const inMap = new Set(entries.map(m => m.text));
        const extra = Object.keys(k).filter(t => !inMap.has(t) && s.includes(t)).map(t => ({ raw: k[t], text: t, _global: true }));

        // 1) texto exato (maiores primeiro)
        const pending = [];
        entries.concat(extra).sort((a, b) => b.text.length - a.text.length).forEach(e => {
            const re = new RegExp('(^|,)(\\s*)' + esc(e.text) + '(\\s*)(?=,|$)');
            const raw = stripPrefix(e.raw);
            if (raw && re.test(s)) { s = s.replace(re, (m, a, b, c) => a + b + raw + c); markNL(raw); }
            else if (!e._global) pending.push(e);
        });

        // 2) âncoras: primeira palavra … última palavra
        pending.forEach(e => {
            const first = e.first || firstWord(e.text), last = e.last || lastWord(e.text);
            if (!first || !last) { res.lost.push(e.text); return; }
            const segs = s.split(',');
            const origLen = segCount(e.text);
            const maxSpan = Math.max(origLen + 4, origLen * 2);
            let best = null;
            for (let i = 0; i < segs.length; i++) {
                const isNLSeg = x => /^\s*NL:/i.test(x) || x.includes('，');
                if (isNLSeg(segs[i]) || firstWord(segs[i]) !== first) continue;
                for (let j = i; j < segs.length && j - i < maxSpan; j++) {
                    if (j > i && isNLSeg(segs[j])) break;   // não engole outra NL
                    if (lastWord(segs[j]) !== last) continue;
                    if (j === i && origLen > 1 && segs[i].trim().split(/\s+/).length < 2) continue;
                    const dist = Math.abs(i - (e.start || 0)) + Math.abs((j - i + 1) - origLen);
                    if (!best || dist < best.dist) best = { i, j, dist };
                    break; // menor trecho a partir de i
                }
            }
            if (!best) { res.lost.push(e.text); return; }
            const diskText = segs.slice(best.i, best.j + 1).map(x => x.trim()).join(', ');
            const lead = (segs[best.i].match(/^\s*/) || [''])[0];
            const tail = (segs[best.j].match(/\s*$/) || [''])[0];
            const rawNew = toRaw(e, diskText);
            segs.splice(best.i, best.j - best.i + 1, lead + rawNew + tail);
            s = segs.join(',');
            markNL(rawNew);
            res.recovered.push(diskText);
        });

        // Legado: qualquer tag que ainda venha com "NL:" perde o prefixo (vira regra).
        if (/(^|,)\s*NL:/i.test(s)) {
            s = s.split(',').map(seg => {
                if (!/^\s*NL:/i.test(seg)) return seg;
                const lead = (seg.match(/^\s*/) || [''])[0];
                const body = stripPrefix(seg).trim();
                if (body) markNL(body);
                return body ? lead + body : null;
            }).filter(seg => seg !== null).join(',');
        }
        res.text = s;
        return res;
    }
    const decode = (text, map) => decodeEx(text, map).text;

    // Arquivo ainda no formato antigo (marcador no disco)?
    const hasLegacyMarkers = text => /(^|,)\s*NL:/i.test(String(text || '')) || String(text || '').includes('，');

    /* ---------- _nl_manager.json por pasta ---------- */
    const cache = new Map();          // dirHandle -> Promise<data>
    function blank() { return { version: 1, images: {} }; }
    function loadFolder(dirHandle, fresh) {
        if (!dirHandle) return Promise.resolve(blank());
        if (!fresh && cache.has(dirHandle)) return cache.get(dirHandle);
        const p = (async () => {
            try {
                const h = await dirHandle.getFileHandle(FILE);
                const d = JSON.parse(await (await h.getFile()).text());
                if (d && d.images) return d;
            } catch (e) {}
            return blank();
        })();
        cache.set(dirHandle, p);
        return p;
    }
    async function entriesFor(dirHandle, baseName) {
        const d = await loadFolder(dirHandle);
        return (d.images && d.images[baseName]) || null;
    }

    let _chain = Promise.resolve();   // gravações em série (Promise.all de vários saves)
    function writeFolder(dirHandle, mutate) {
        _chain = _chain.then(async () => {
            try {
                const d = await loadFolder(dirHandle);
                if (!mutate(d)) return;
                const h = await dirHandle.getFileHandle(FILE, { create: true });
                const w = await h.createWritable();
                await w.write(JSON.stringify(d, null, 2));
                await w.close();
            } catch (e) { console.warn('[NL Manager] could not write ' + FILE, e); }
        });
        return _chain;
    }
    function setEntries(dirHandle, baseName, map) {
        remember(map, dirHandle);
        return writeFolder(dirHandle, d => {
            const before = JSON.stringify(d.images[baseName] || []);
            if (map && map.length) d.images[baseName] = map; else delete d.images[baseName];
            return before !== JSON.stringify(map || []);
        });
    }
    function moveEntries(dirHandle, oldBase, newBase, map) {
        remember(map, dirHandle);
        return writeFolder(dirHandle, d => {
            if (oldBase !== newBase) delete d.images[oldBase];
            if (map && map.length) d.images[newBase] = map; else delete d.images[newBase];
            return true;
        });
    }

    /* Chamado pelo saveImageToDisk depois de gravar a legenda. */
    async function persistMap(img, map) {
        if (!img || !img.baseName || !img.parentDirHandle) return;
        await setEntries(img.parentDirHandle, img.baseName, map);
        // Migração: o mapa antigo no _tagger_config.json sai de lá.
        if (typeof datasetConfig !== 'undefined' && datasetConfig[img.baseName] && datasetConfig[img.baseName].nl) {
            delete datasetConfig[img.baseName].nl;
            if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
        }
    }

    /* Leitura completa p/ uma imagem: mapa da pasta (ou legado do config) + decode. */
    async function decodeFor(dirHandle, baseName, text, legacyMap) {
        await ready;
        const map = (await entriesFor(dirHandle, baseName)) || legacyMap || null;
        const k = await loadKnown(dirHandle);
        // Old global reserve (read only): a sentence found in this caption migrates to the dataset reserve.
        const s = String(text || '');
        if (s && legacyKnown) {
            let moved = false;
            Object.keys(legacyKnown).forEach(t => { if (!k[t] && s.includes(t)) { k[t] = legacyKnown[t]; moved = true; } });
            if (moved) scheduleKnownWrite(dirHandle);
        }
        const r = decodeEx(text, map, k);
        r.fromLegacy = !!(legacyMap && legacyMap.length && !(await entriesFor(dirHandle, baseName)));
        return r;
    }

    /* ---------- reserva POR DATASET (_nl_known_texts.json na pasta) ---------- */
    const KNOWN_FILE = '_nl_known_texts.json';
    const KNOWN_KEY = 'nl-known-texts';            // old global reserve (local/nl_known_texts.json) — read only
    let legacyKnown = null;
    let activeKnown = {};                          // reserve of the dataset in use (decode without a folder)
    const knownByDir = new Map();                  // dirHandle -> Promise<object>
    const knownTimers = new Map();
    const ready = (async () => {
        try {
            if (!window.LocalStore && typeof window.getSetting !== 'function') return;
            const v = window.LocalStore ? await window.LocalStore.get(KNOWN_KEY, {}) : await window.getSetting(KNOWN_KEY, {});
            const o = (typeof v === 'string' ? JSON.parse(v || '{}') : v) || {};
            legacyKnown = Object.keys(o).length ? o : null;
        } catch (e) { legacyKnown = null; }
    })();
    function loadKnown(dirHandle) {
        if (!dirHandle) return Promise.resolve(activeKnown);
        if (knownByDir.has(dirHandle)) return knownByDir.get(dirHandle);
        const p = (async () => {
            try {
                const h = await dirHandle.getFileHandle(KNOWN_FILE);
                const d = JSON.parse(await (await h.getFile()).text());
                if (d && typeof d === 'object') return d.texts && typeof d.texts === 'object' ? d.texts : d;
            } catch (e) {}
            return {};
        })();
        knownByDir.set(dirHandle, p);
        p.then(o => { if (dirHandle === (window.currentImagesHandle || window.rootHandle)) activeKnown = o; });
        return p;
    }
    function scheduleKnownWrite(dirHandle) {
        if (!dirHandle) return;
        clearTimeout(knownTimers.get(dirHandle));
        knownTimers.set(dirHandle, setTimeout(async () => {
            knownTimers.delete(dirHandle);
            try {
                const o = await loadKnown(dirHandle);
                if (!Object.keys(o).length) return;          // nothing to keep: no file
                const h = await dirHandle.getFileHandle(KNOWN_FILE, { create: true });
                const w = await h.createWritable();
                await w.write(JSON.stringify({ version: 1, texts: o }, null, 2));
                await w.close();
            } catch (e) { console.warn('[NL Manager] could not write ' + KNOWN_FILE, e); }
        }, 400));
    }
    function remember(map, dirHandle) {
        const dir = dirHandle || window.currentImagesHandle || window.rootHandle;
        if (!dir) return;
        loadKnown(dir).then(k => {
            let changed = false;
            (map || []).forEach(({ raw, text }) => {
                if (text && raw && text.includes(',') && k[text] !== raw) { k[text] = raw; changed = true; }
            });
            if (changed) scheduleKnownWrite(dir);
        });
    }

    // Compat (modo recursivo antigo).
    async function readFolderConfig(dirHandle) {
        try {
            const h = await dirHandle.getFileHandle('_tagger_config.json');
            return JSON.parse(await (await h.getFile()).text()) || {};
        } catch (e) { return {}; }
    }

    // Recarregar a pasta sempre relê o _nl_manager.json.
    if (window.TM && typeof window.TM.on === 'function') window.TM.on('config:loaded', () => {
        cache.clear();
        const dir = window.currentImagesHandle || window.rootHandle;
        activeKnown = {};
        if (dir) loadKnown(dir);
    });

    return { FILE, stripPrefix, markNL, encode, decode, decodeEx, decodeFor, hasLegacyMarkers, loadFolder, entriesFor, setEntries, moveEntries, persistMap, readFolderConfig, ready, clearCache: () => cache.clear() };
})();

/* Ao carregar um dataset, regrava na hora toda legenda que:
   - ainda tem "NL:" / "，" no disco (formato antigo), ou
   - teve NL reconstruída pelas âncoras (texto editado fora do app), ou
   - ainda usa o mapa antigo do _tagger_config.json (migração). */
(function () {
    async function cleanLegacyNL() {
        if (typeof imageFiles === 'undefined' || typeof window.saveImageToDisk !== 'function') return;
        const targets = imageFiles.filter(img => img && img._nlResave && img.hasFile);
        const recovered = imageFiles.reduce((n, img) => n + ((img && img._nlRecovered) || 0), 0);
        const lost = imageFiles.filter(img => img && img._nlLost && img._nlLost.length);
        let ok = 0;
        for (const img of targets) {
            img._nlResave = false;
            try { if (await window.saveImageToDisk(img)) ok++; } catch (e) { console.warn('[NL Manager] resave failed', img.name, e); }
        }
        imageFiles.forEach(img => { if (img) { img._nlRecovered = 0; } });
        if (typeof window.showAlert !== 'function') return;
        if (ok) window.showAlert(`🧹 NL Manager: ${ok} caption file(s) cleaned / updated on disk${recovered ? ` — ${recovered} NL(s) rebuilt from first/last-word anchors` : ''}.`, 'info');
        if (lost.length) {
            console.warn('[NL Manager] NL not found (edited outside the app?):', lost.map(i => ({ image: i.name, nl: i._nlLost })));
            window.showAlert(`⚠️ NL Manager: ${lost.length} image(s) have an NL that could not be found anymore (first/last word changed). Check the console for the list.`, 'warn');
        }
    }
    if (window.TM && typeof window.TM.on === 'function') window.TM.on('dataset:loaded', () => setTimeout(cleanLegacyNL, 300));
})();
