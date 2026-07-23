/* =========================================================================
   DANBOORU API CORE (Standalone)
   ---------------------------------------------------------------------
   Camada única de acesso à API do Danbooru. Antes, 3 lugares diferentes
   faziam fetch() por conta própria com caches separados:
     - tagmanager_caption_tag.js    -> autocomplete (name_matches)
     - tagmanager_ui_core.js        -> contagem de posts (name_comma)
     - tagmanager_danbooru_panel.js -> busca de tag + descrição da wiki

   Agora existe UM cache (window.danbooruCache — mesma variável e mesma
   chave de persistência 'danbooru_tag_cache' que já existia; só
   estendemos o formato de cada entrada) e funções compartilhadas que
   os 3 arquivos chamam em vez de duplicar fetch().

   Formato de cada entrada do cache:
   { count, category, wikiName, ts,                 <- básico (contagem/categoria)
     wikiChecked, wikiTs, hasWikiInfo, description,   <- wiki (opcional)
     aliasChecked, aliasTs, aliasTo }                 <- alias (opcional)

   TAG ALIASES (ex: "anime screencap" -> "anime screenshot"):
   Uma tag depreciada/redirecionada NÃO existe como tag real no Danbooru —
   ela só existe como um registro em /tag_aliases.json apontando pra uma
   tag "consequente", que é quem tem posts/contagem de verdade. Por isso
   ela nunca aparecia em /tags.json e a contagem ficava sempre 0.
   window.dbResolveAlias() resolve isso 1x por tag (cacheado), e tanto
   dbFetchCountsBatch quanto dbSearchTagMatches usam esse resultado pra
   emprestar a contagem real da tag consequente pra tag-alias.

   IMPORTANTE: precisa ser carregado DEPOIS de tagmanager_db.js (usa
   window.getSetting/saveSetting) e ANTES de tagmanager_caption_tag.js,
   tagmanager_ui_core.js e tagmanager_danbooru_panel.js.
========================================================================= */

window.danbooruCache = window.danbooruCache || {};

const DB_COUNT_TTL = 15 * 24 * 60 * 60 * 1000;  // 15 dias (contagem/categoria)
const DB_WIKI_TTL   = 30 * 24 * 60 * 60 * 1000; // 30 dias (descrição muda menos)
const DB_ALIAS_TTL  = 15 * 24 * 60 * 60 * 1000; // 15 dias (mesmo TTL da contagem)

// Fila só para os fetches em LOTE (sync de contagens / scan de wiki).
// O autocomplete (digitação) fica de fora de propósito, pra não ficar
// travado atrás de um scan grande enquanto o usuário digita.
let _dbBatchQueue = Promise.resolve();
function dbQueueBatch(fn) {
    const run = () => fn().catch(e => { console.warn('[Danbooru API]', e); });
    const chained = _dbBatchQueue.then(run, run);
    _dbBatchQueue = chained;
    return chained;
}

async function dbPersistCache() {
    if (typeof window.saveSetting === 'function') await window.saveSetting('danbooru_tag_cache', window.danbooruCache);
}

/* ---------- LEITURA ---------- */
window.dbGetCachedTag = function (tag) {
    return window.danbooruCache[(tag || '').toLowerCase()] || null;
};

/* ---------- ALIAS RESOLUTION ----------
   Consulta /tag_aliases.json procurando se `tagName` é um antecedent
   (tag depreciada) com status ativo. Retorna o nome (com espaços) da
   tag consequente (a "real"), ou null se `tagName` não for alias de
   nada. Resultado cacheado dentro da própria entrada da tag em
   window.danbooruCache, então cada tag só é checada 1x por TTL. */
window.dbResolveAlias = async function (tagName) {
    const key = tagName.toLowerCase();
    const now = Date.now();
    const cached = window.danbooruCache[key];
    if (cached && cached.aliasChecked && (now - (cached.aliasTs || 0)) < DB_ALIAS_TTL) {
        return cached.aliasTo || null;
    }

    const nameForApi = tagName.trim().toLowerCase().replace(/ /g, '_');
    const url = `https://danbooru.donmai.us/tag_aliases.json?search[antecedent_name]=${encodeURIComponent(nameForApi)}&search[status]=active&limit=1`;
    let aliasTo = null;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn('[Danbooru Alias] HTTP error', res.status, res.statusText, 'for', url);
        } else {
            const data = await res.json();
            console.log('[Danbooru Alias] response for', nameForApi, '→', data);
            if (data && data[0] && data[0].consequent_name) {
                aliasTo = data[0].consequent_name.replace(/_/g, ' ');
            }
        }
    } catch (e) {
        // rede falhou (CORS, offline, etc): mantém o que já estava em cache em vez de apagar
        console.error('[Danbooru Alias] fetch failed for', url, e);
        return (window.danbooruCache[key] && window.danbooruCache[key].aliasTo) || null;
    }

    window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), aliasChecked: true, aliasTs: now, aliasTo };
    return aliasTo;
};

/* ---------- DEBUG MANUAL ----------
   Cole isso no Console do navegador (F12) pra testar uma tag específica
   sem precisar mexer no dataset: window.dbDebugTag("anime screencap")
   Ele imprime cada etapa (fetch da API, resposta, cache final) — cole o
   resultado de volta se algo ainda não bater. */
window.dbDebugTag = async function (tagName) {
    console.log('%c[dbDebugTag] Testing:', 'color:#0af;font-weight:bold', tagName);
    const key = tagName.toLowerCase();
    delete window.danbooruCache[key]; // força ignorar cache pra esse teste
    const aliasTo = await window.dbResolveAlias(tagName);
    console.log('[dbDebugTag] dbResolveAlias result →', aliasTo);
    if (aliasTo) {
        const info = await dbFetchSingleTagInfo(aliasTo, true);
        console.log('[dbDebugTag] consequent tag info →', info);
    }
    console.log('[dbDebugTag] final cache entry →', window.danbooruCache[key]);
    return window.danbooruCache[key];
};

/* Busca (e cacheia) a contagem/categoria REAL de uma tag consequente,
   reaproveitando o que já estiver em cache dentro do TTL. Usada tanto
   pelo batch quanto pelo autocomplete pra "emprestar" a contagem real
   pra uma tag-alias. */
async function dbFetchSingleTagInfo(tagName, force = false) {
    const key = tagName.toLowerCase();
    const now = Date.now();
    const cached = window.danbooruCache[key];
    if (!force && cached && cached.count !== undefined && (now - (cached.ts || 0)) < DB_COUNT_TTL) {
        return cached;
    }
    const url = `https://danbooru.donmai.us/tags.json?search[name]=${encodeURIComponent(tagName.replace(/ /g, '_'))}&limit=1`;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn('[Danbooru Info] HTTP error', res.status, res.statusText, 'for', url);
        } else {
            const data = await res.json();
            console.log('[Danbooru Info] response for', tagName, '→', data);
            if (data && data[0]) {
                window.danbooruCache[key] = {
                    ...(window.danbooruCache[key] || {}),
                    count: parseInt(data[0].post_count) || 0,
                    category: data[0].category,
                    wikiName: data[0].name,
                    ts: now
                };
                return window.danbooruCache[key];
            }
        }
    } catch (e) {
        console.error('[Danbooru Info] fetch failed for', url, e);
    }
    return window.danbooruCache[key] || null;
}

/* ---------- LOTE: conta + categoria ----------
   Usado por: tagmanager_ui_core.js (syncDanbooruTags) e pelo Scan do
   painel Danbooru. */
window.dbFetchCountsBatch = function (tags, force = false) {
    return dbQueueBatch(async () => {
        const now = Date.now();
        const toFetch = tags.filter(t => {
            if (t.startsWith('NL:')) return false;
            const cached = window.danbooruCache[t.toLowerCase()];
            if (force) return true;
            if (!cached || cached.count === undefined) return true;
            // Migração: cache salvo ANTES da checagem de alias existir nunca teve
            // "aliasChecked" — sem isso, uma tag com count:0 antigo ficaria travada
            // até o TTL expirar (até 15 dias) sem nunca resolver o alias dela.
            if (!cached.aliasChecked) return true;
            return (now - (cached.ts || 0)) > DB_COUNT_TTL;
        });
        if (toFetch.length === 0) return { fetched: 0 };

        const chunkSize = 50;
        let fetchedCount = 0;
        const zeroCountTags = []; // tags sem posts próprios — candidatas a serem Alias

        for (let i = 0; i < toFetch.length; i += chunkSize) {
            const chunk = toFetch.slice(i, i + chunkSize);
            const query = chunk.map(t => encodeURIComponent(t.replace(/ /g, '_'))).join(',');
            try {
                const res = await fetch(`https://danbooru.donmai.us/tags.json?search[name_comma]=${query}`);
                if (res.ok) {
                    const data = await res.json();
                    const foundCounts = new Map(); // key -> post_count
                    data.forEach(dt => {
                        const key = dt.name.replace(/_/g, ' ').toLowerCase();
                        foundCounts.set(key, parseInt(dt.post_count) || 0);
                        window.danbooruCache[key] = {
                            ...(window.danbooruCache[key] || {}),
                            count: parseInt(dt.post_count) || 0,
                            category: dt.category,
                            wikiName: dt.name,
                            ts: now
                        };
                    });
                    chunk.forEach(t => {
                        const key = t.toLowerCase();
                        const count = foundCounts.has(key) ? foundCounts.get(key) : 0;
                        if (!foundCounts.has(key)) {
                            window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), count: 0, ts: now };
                        }
                        // Uma tag com 0 posts próprios pode ser: (a) uma tag real mas nunca
                        // usada, ou (b) o registro legado de uma tag que virou Alias (o caso
                        // do "anime screencap"). Só dá pra saber checando /tag_aliases.json.
                        if (count === 0) {
                            zeroCountTags.push(t);
                        } else {
                            // Tem posts próprios — não é um antecedent de alias. Marca como
                            // já checado pra não entrar de novo na migração/re-scan à toa.
                            window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), aliasTo: null, aliasChecked: true, aliasTs: now };
                        }
                    });
                    fetchedCount += chunk.length;
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 800));
        }

        // ETAPA 2: para toda tag com 0 posts próprios (encontrada ou não no /tags.json),
        // checa se é Tag Alias (ex: "anime screencap" -> "anime screenshot") e usa a
        // contagem REAL da tag consequente em vez de deixar em 0.
        for (const tag of zeroCountTags) {
            const key = tag.toLowerCase();
            const already = window.danbooruCache[key];
            if (already && already.aliasChecked && !force) continue;

            const aliasTo = await window.dbResolveAlias(tag);
            if (aliasTo) {
                const consequentInfo = await dbFetchSingleTagInfo(aliasTo, force);
                window.danbooruCache[key] = {
                    ...(window.danbooruCache[key] || {}),
                    count: (consequentInfo && consequentInfo.count) || 0,
                    category: (consequentInfo && consequentInfo.category) || 0,
                    aliasTo, aliasChecked: true, aliasTs: now,
                    ts: now
                };
                await new Promise(r => setTimeout(r, 400));
            }
        }

        await dbPersistCache();
        return { fetched: fetchedCount };
    });
};

/* ---------- LOTE: descrição da wiki ----------
   1 chamada por tag (limitação real da API — não existe endpoint de
   wiki em lote), mas só para tags cujo cache de wiki ainda não existe
   ou expirou. Salva o cache a cada poucas tags (não só no fim) e
   dispara um callback por tag resolvida — permite background scan que
   vai atualizando os ❓ incrementalmente, sem travar nada e sem perder
   progresso se o usuário trocar de dataset no meio do caminho. */
window.dbFetchWikiBatch = function (tags, force = false, onEachTag, onProgress) {
    return dbQueueBatch(async () => {
        const now = Date.now();
        const toFetch = tags.filter(t => {
            if (t.startsWith('NL:')) return false;
            const cached = window.danbooruCache[t.toLowerCase()];
            if (force) return true;
            if (!cached || !cached.wikiChecked) return true;
            return (now - (cached.wikiTs || 0)) > DB_WIKI_TTL;
        });
        if (toFetch.length === 0) return { fetched: 0, found: 0 };

        let processed = 0, found = 0;
        for (const tag of toFetch) {
            if (window._dbBackgroundScanCancelled) break;

            const key = tag.toLowerCase();
            const wikiName = (window.danbooruCache[key] && window.danbooruCache[key].wikiName) || tag.trim().toLowerCase().replace(/ /g, '_');

            let hasWikiInfo = false, description = '';
            try {
                const wRes = await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(wikiName)}.json`);
                if (wRes.ok) {
                    const wData = await wRes.json();
                    if (wData && wData.body && wData.body.trim()) {
                        hasWikiInfo = true;
                        const clean = wData.body.replace(/\[.*?\]/g, '').trim();
                        description = clean.slice(0, 800) + (clean.length > 800 ? '...' : '');
                    }
                }
            } catch (e) {}

            window.danbooruCache[key] = {
                ...(window.danbooruCache[key] || {}),
                wikiChecked: true, wikiTs: now, hasWikiInfo, description
            };
            if (hasWikiInfo) found++;
            processed++;

            if (onEachTag) onEachTag(key, hasWikiInfo);
            if (onProgress) onProgress(processed, toFetch.length, found);

            // Persiste a cada 8 tags em vez de só no final — se o usuário
            // fechar a aba ou trocar de pasta no meio, o que já foi
            // resolvido continua salvo.
            if (processed % 8 === 0) await dbPersistCache();

            await new Promise(r => setTimeout(r, 350));
        }

        await dbPersistCache();
        return { fetched: processed, found };
    });
};

/* ---------- BUSCA MANUAL (search box de 1 tag): olha o cache primeiro ---------- */
window.dbLookupSingleTag = async function (rawTag) {
    const tag = rawTag.trim().toLowerCase().replace(/ /g, '_');
    const key = tag.replace(/_/g, ' ');
    const now = Date.now();
    const cached = window.danbooruCache[key];

    const needsBasic = !cached || cached.count === undefined || (now - (cached.ts || 0)) > DB_COUNT_TTL;
    const needsWiki = !cached || !cached.wikiChecked || (now - (cached.wikiTs || 0)) > DB_WIKI_TTL;

    if (needsBasic) {
        try {
            const res = await fetch(`https://danbooru.donmai.us/tags.json?search[name]=${encodeURIComponent(tag)}&limit=1`);
            const data = await res.json();
            if (data && data[0]) {
                window.danbooruCache[key] = {
                    ...(window.danbooruCache[key] || {}),
                    count: parseInt(data[0].post_count) || 0,
                    category: data[0].category,
                    wikiName: data[0].name,
                    ts: now
                };
            } else {
                // Não é uma tag real — pode ser um alias. Resolve antes de desistir.
                const aliasTo = await window.dbResolveAlias(key);
                if (aliasTo) {
                    const consequentInfo = await dbFetchSingleTagInfo(aliasTo);
                    window.danbooruCache[key] = {
                        ...(window.danbooruCache[key] || {}),
                        count: (consequentInfo && consequentInfo.count) || 0,
                        category: (consequentInfo && consequentInfo.category) || 0,
                        wikiName: (consequentInfo && consequentInfo.wikiName) || aliasTo.replace(/ /g, '_'),
                        aliasTo, aliasChecked: true, aliasTs: now,
                        ts: now
                    };
                } else {
                    return null; // tag não existe no Danbooru, nem como alias
                }
            }
        } catch (e) { return window.danbooruCache[key] || null; }
    }

    if (needsWiki && window.danbooruCache[key]) {
        const wikiName = window.danbooruCache[key].wikiName || tag;
        try {
            const wRes = await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(wikiName)}.json`);
            let hasWikiInfo = false, description = '';
            if (wRes.ok) {
                const wData = await wRes.json();
                if (wData && wData.body && wData.body.trim()) {
                    hasWikiInfo = true;
                    const clean = wData.body.replace(/\[.*?\]/g, '').trim();
                    description = clean.slice(0, 800) + (clean.length > 800 ? '...' : '');
                }
            }
            window.danbooruCache[key] = { ...window.danbooruCache[key], wikiChecked: true, wikiTs: now, hasWikiInfo, description };
        } catch (e) {}
    }

    await dbPersistCache();
    return window.danbooruCache[key] || null;
};

/* ---------- AUTOCOMPLETE (name_matches + tag_aliases) ----------
   Fica FORA da fila de lote (precisa responder rápido enquanto o
   usuário digita), mas grava no MESMO cache compartilhado — uma tag já
   vista aqui não precisa ser buscada de novo pelo Scan/Sync. Persiste
   com debounce (não a cada tecla) pra não martelar o IndexedDB.

   Retorna { direct, aliases }:
     - direct: tags reais que batem com a busca (formato antigo)
     - aliases: tags-alias (depreciadas) cujo nome bate com a busca,
       cada uma já com `aliasTo` (a tag consequente/real) — a contagem
       ainda não vem aqui, quem chama decide se busca a contagem da
       consequente (ver tagmanager_caption_tag.js). */
let _dbAutocompleteSaveTimer = null;
function dbScheduleAutocompleteSave() {
    clearTimeout(_dbAutocompleteSaveTimer);
    _dbAutocompleteSaveTimer = setTimeout(() => { dbPersistCache(); }, 1500);
}

window.dbSearchTagMatches = async function (query, limit = 6) {
    const now = Date.now();
    let directRaw = [];
    try {
        const res = await fetch(`https://danbooru.donmai.us/tags.json?search[name_matches]=*${query}*&limit=${limit}&search[order]=count`);
        if (res.ok) directRaw = await res.json();
    } catch (e) {}

    // Alias lookup: antecedent -> consequent. "antecedent_name_matches" é um
    // parâmetro real e documentado da API (confirmado em tag_relationship.rb,
    // método SearchMethods#antecedent_name_matches) — busca só no antecedent,
    // sem trazer resultados "falsos positivos" vindos do consequent.
    const aliasMap = new Map(); // antecedent_name (raw, underscore) -> consequent_name (raw)
    const aliasUrl = `https://danbooru.donmai.us/tag_aliases.json?search[antecedent_name_matches]=*${query}*&search[status]=active&limit=${Math.max(limit * 3, 20)}`;
    try {
        const aliasRes = await fetch(aliasUrl);
        if (!aliasRes.ok) {
            console.warn('[Danbooru Alias Search] HTTP error', aliasRes.status, aliasRes.statusText, 'for', aliasUrl);
        } else {
            const aliasData = await aliasRes.json();
            aliasData.forEach(a => { if (a.antecedent_name) aliasMap.set(a.antecedent_name, a.consequent_name); });
        }
    } catch (e) {
        console.error('[Danbooru Alias Search] fetch failed for', aliasUrl, e);
    }

    const results = [];
    const seenAntecedents = new Set();

    // Tags reais retornadas por /tags.json. IMPORTANTE: uma tag pode ter um
    // registro próprio (às vezes com post_count 0) E TAMBÉM ser antecedent
    // de um alias ativo ao mesmo tempo (é exatamente o caso de
    // "anime screencap" -> "anime screenshot"). Antes isso era descartado
    // por engano só por já estar em "direct"; agora tratamos como alias
    // mesmo assim, usando a contagem REAL da consequente.
    for (const t of directRaw) {
        seenAntecedents.add(t.name);
        const aliasTo = aliasMap.get(t.name);
        const key = t.name.replace(/_/g, ' ').toLowerCase();

        if (aliasTo) {
            const aliasToSpaced = aliasTo.replace(/_/g, ' ');
            const consequentInfo = await dbFetchSingleTagInfo(aliasToSpaced);
            const realCount = (consequentInfo && consequentInfo.count) || 0;
            const realCategory = (consequentInfo && consequentInfo.category) || 0;
            window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), count: realCount, category: realCategory, aliasTo: aliasToSpaced, aliasChecked: true, aliasTs: now, ts: now };
            results.push({ name: key, post_count: realCount, category: realCategory, isAlias: true, aliasTo: aliasToSpaced });
        } else {
            window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), count: parseInt(t.post_count) || 0, category: t.category, wikiName: t.name, aliasTo: null, aliasChecked: true, aliasTs: now, ts: now };
            results.push({ name: key, post_count: parseInt(t.post_count) || 0, category: t.category, isAlias: false });
        }
    }

    // Aliases cujo antecedent não tem NENHUM registro próprio em /tags.json
    // (puro redirecionamento, sem linha de tag).
    for (const [antecedent, consequent] of aliasMap.entries()) {
        if (seenAntecedents.has(antecedent)) continue;
        const consequentSpaced = consequent.replace(/_/g, ' ');
        const consequentInfo = await dbFetchSingleTagInfo(consequentSpaced);
        const realCount = (consequentInfo && consequentInfo.count) || 0;
        const realCategory = (consequentInfo && consequentInfo.category) || 0;
        const key = antecedent.replace(/_/g, ' ').toLowerCase();
        window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), count: realCount, category: realCategory, aliasTo: consequentSpaced, aliasChecked: true, aliasTs: now, ts: now };
        results.push({ name: key, post_count: realCount, category: realCategory, isAlias: true, aliasTo: consequentSpaced });
    }

    results.sort((a, b) => b.post_count - a.post_count);
    if (results.length > 0) dbScheduleAutocompleteSave();
    return results.slice(0, limit);
};

window.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.getSetting === 'function') {
        window.danbooruCache = await window.getSetting('danbooru_tag_cache', window.danbooruCache || {});
    }
});