/* =========================================================================
   DANBOORU API CORE (Standalone — Híbrido Local/Online)
   ---------------------------------------------------------------------
   Camada de acesso à API do Danbooru com suporte a tags descartadas.

   FIX (invalidação do _aliasIndex — ver tagmanager_alias_bridge.js):
   Antes, o índice de aliases reversos só era reconstruído quando o
   TAMANHO do cache mudava (Object.keys(...).length). Isso não capturava
   o caso mais comum de atualização: uma tag que JÁ existia no cache
   (ex: contada com count:0) ganhar um campo aliasTo depois de resolvida
   por dbResolveAlias/dbSearchTagMatches — o tamanho do objeto não muda,
   só o conteúdo de uma entrada já existente. Resultado: o preview
   reverso de aliases podia ficar desatualizado indefinidamente numa
   sessão, só "acertando" por coincidência quando outra operação
   alterasse a quantidade de chaves do cache.

   Agora toda escrita/remoção real em window.danbooruCache incrementa
   window._danbooruCacheVersion. O alias_bridge.js compara esse número
   (e não mais o tamanho do objeto) pra decidir se precisa reconstruir o
   índice — captura adição, remoção E mutação de valor, com o mesmo
   custo desprezível de comparar dois inteiros.
========================================================================= */

window.danbooruCache = window.danbooruCache || {};
window.isDanbooruLocalMode = false;

// Contador de versão do cache — incrementado a cada escrita/remoção real.
// Consumido por tagmanager_alias_bridge.js pra saber quando reconstruir o
// índice de aliases reversos, sem precisar varrer Object.keys(...) toda vez.
window._danbooruCacheVersion = window._danbooruCacheVersion || 0;
function bumpDanbooruCacheVersion() {
    window._danbooruCacheVersion = (window._danbooruCacheVersion || 0) + 1;
}

/* ---------- LIMPEZA PERIÓDICA (só faz sentido no modo ONLINE/IndexedDB) ----------
   No modo local (arquivo .json), o cache pode crescer pra sempre sem
   problema nenhum — é um arquivo simples que o usuário controla e pode
   apagar quando quiser pra "zerar" e depender cada vez menos da API.
   No modo ONLINE, porém, esse mesmo cache vive dentro do blob de
   window._settingsCache (chave 'danbooru_tag_cache'), que é regravado
   por INTEIRO no IndexedDB a cada saveSetting() — inclusive de configs
   sem nenhuma relação com tags. Sem limpeza, esse blob só cresce e cada
   gravação fica mais pesada com o tempo, sem o usuário ter um jeito
   simples de "zerar" como tem no modo local.

   Esta função remove só entradas realmente PARADAS (sem nenhuma
   atividade — nem count, nem alias, nem wiki — há mais de
   DB_CACHE_PRUNE_MAX_AGE_MS) e roda 1x por sessão, no boot — não a cada
   persist, já que é uma limpeza de manutenção, não algo que precise ser
   imediato. Tags removidas simplesmente voltam a ser buscadas
   normalmente na próxima vez que aparecerem num dataset (o mesmo caminho
   que já existe pra qualquer tag nunca vista antes) — zero perda
   funcional, só espaço recuperado no IndexedDB. */
const DB_CACHE_PRUNE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // 180 dias sem nenhuma atividade

function pruneStaleDanbooruCacheOnlineOnly() {
    if (window.isDanbooruLocalMode) return; // modo local: cache livre pra crescer, sem poda
    const now = Date.now();
    let removed = 0;
    Object.keys(window.danbooruCache).forEach(key => {
        const entry = window.danbooruCache[key] || {};
        const lastActivity = Math.max(entry.ts || 0, entry.wikiTs || 0, entry.aliasTs || 0);
        if (lastActivity && (now - lastActivity) > DB_CACHE_PRUNE_MAX_AGE_MS) {
            delete window.danbooruCache[key];
            removed++;
        }
    });
    if (removed > 0) {
        bumpDanbooruCacheVersion();
        scheduleDanbooruCachePersist();
        console.log(`[Danbooru] Poda de manutenção (IndexedDB): removida(s) ${removed} entrada(s) sem atividade há mais de 180 dias.`);
    }
}

const DB_COUNT_TTL = 15 * 24 * 60 * 60 * 1000;
const DB_WIKI_TTL   = 30 * 24 * 60 * 60 * 1000;
const DB_ALIAS_TTL  = 15 * 24 * 60 * 60 * 1000;

let _dbBatchQueue = Promise.resolve();
function dbQueueBatch(fn) {
    const run = () => fn().catch(e => { console.warn('[Danbooru API]', e); });
    const chained = _dbBatchQueue.then(run, run);
    _dbBatchQueue = chained;
    return chained;
}

/* ---------- GESTÃO DE TAGS DESCONHECIDAS (COMPARTILHADO) ---------- */
window.unknownTagsCache = window.unknownTagsCache || {};
window.unknownTagsLoaded = window.unknownTagsLoaded || false;

window.loadUnknownTags = window.loadUnknownTags || async function() {
    if (window.unknownTagsLoaded) return;
    if (window.isDanbooruLocalMode) {
        try {
            const res = await fetch('/local/unknown_tags.json?t=' + Date.now(), { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                window.unknownTagsCache = Object.assign(window.unknownTagsCache, data);
            }
        } catch (e) {}
    } else if (typeof window.getSetting === 'function') {
        // Modo online: cai pro mesmo IndexedDB híbrido usado pelo resto do
        // app (via window.getSetting), em vez de tentar um fetch pra um
        // arquivo local que não existe nesse modo (antes falhava em
        // silêncio e essa lista nunca era carregada online).
        const stored = await window.getSetting('unknown_tags_cache', null);
        if (stored) window.unknownTagsCache = Object.assign(window.unknownTagsCache, stored);
    }
    window.unknownTagsLoaded = true;
};

window.saveUnknownTags = window.saveUnknownTags || async function() {
    if (window.isDanbooruLocalMode) {
        try {
            await fetch('/api/save_local_cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: 'local/unknown_tags.json', data: window.unknownTagsCache })
            });
        } catch (e) {}
    } else if (typeof window.saveSetting === 'function') {
        // Mesmo fallback do load acima — já sai debounced, já que
        // window.saveSetting agora agrupa escritas (tagmanager_db.js).
        await window.saveSetting('unknown_tags_cache', window.unknownTagsCache);
    }
};

window.markTagAsUnknownDb = function(key) {
    window.unknownTagsCache[key] = window.unknownTagsCache[key] || { ts: Date.now() };
    window.unknownTagsCache[key].danbooru = true;
    delete window.danbooruCache[key]; // Remove da base principal para mantê-la limpa
    bumpDanbooruCacheVersion();
    window.saveUnknownTags();
};

window.isTagUnknownDb = function(key) {
    return window.unknownTagsCache[key] && window.unknownTagsCache[key].danbooru;
};

/* ---------- PERSISTÊNCIA COM DEBOUNCE (otimização) ----------
   Mesmo raciocínio já aplicado em tagmanager_db.js: agrupa gravações
   repetidas do cache (sync de contagens, busca manual) numa escrita só,
   com um flush final via sendBeacon se a aba fechar antes do timer
   disparar (sendBeacon consegue completar o envio mesmo com a página
   sendo descartada; fetch() nesse momento pode ser cancelado).

   O checkpoint periódico do scan de wiki em lote (dbFetchWikiBatch, a
   cada 8 tags) continua IMEDIATO, sem debounce — ali o objetivo é
   justamente persistir com frequência baixa mas regular durante um scan
   que pode levar minutos; como cada chamada já vem espaçada por ~350ms
   de sleep vezes 8 tags (~2.8s+), não é uma escrita "quente" que precise
   de agrupamento, e debounce ali só adiaria o checkpoint de segurança
   até o fim do scan inteiro. */
const DB_CACHE_PERSIST_DEBOUNCE_MS = 800;
let _dbCachePersistTimer = null;

function scheduleDanbooruCachePersist() {
    clearTimeout(_dbCachePersistTimer);
    _dbCachePersistTimer = setTimeout(() => {
        _dbCachePersistTimer = null;
        dbPersistCache();
    }, DB_CACHE_PERSIST_DEBOUNCE_MS);
}

window._flushDanbooruCachePersist = function(useBeacon = false) {
    if (_dbCachePersistTimer) {
        clearTimeout(_dbCachePersistTimer);
        _dbCachePersistTimer = null;
        dbPersistCache(useBeacon);
    }
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') window._flushDanbooruCachePersist(false);
});
window.addEventListener('pagehide', () => window._flushDanbooruCachePersist(true));
window.addEventListener('beforeunload', () => window._flushDanbooruCachePersist(true));

/* ---------- PERSISTÊNCIA HÍBRIDA ---------- */
async function dbPersistCache(useBeacon = false) {
    if (window.isDanbooruLocalMode) {
        const body = JSON.stringify({ file: 'local/danbooru_cache.json', data: window.danbooruCache });
        if (useBeacon) {
            // Keepalive (mesmo mecanismo usado em tagmanager_db.js) — sobrevive
            // ao unload da página igual sendBeacon, mas permite Content-Type
            // JSON de verdade no header em vez de depender do tipo do Blob.
            try {
                fetch('/api/save_local_cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    keepalive: true
                });
            } catch (e) { /* melhor esforço no unload — não há mais nada a fazer aqui */ }
            return;
        }
        // Passa pela MESMA fila usada por settings/presets/e621 (definida em
        // tagmanager_db.js) — os 4 caches locais compartilham o endpoint
        // /api/save_local_cache, e sem serializar essas escritas um POST
        // "atrasado" (deste ou de outro cache) pode terminar depois de um
        // mais novo e sobrescrever com dado desatualizado. Fallback pro
        // fetch direto se, por algum motivo, a fila ainda não existir.
        const doWrite = async () => {
            try {
                await fetch('/api/save_local_cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body
                });
            } catch (e) {
                console.warn('[Danbooru] Falha ao salvar cache localmente', e);
            }
        };
        if (typeof window._queueLocalCacheWrite === 'function') await window._queueLocalCacheWrite(doWrite);
        else await doWrite();
    } else {
        // Modo online: persiste de volta no IndexedDB (via SettingsDB), já
        // que aqui não existe um arquivo local pra escrever. Sem isso, tags
        // resolvidas durante a sessão só existiam em memória e se perdiam
        // a cada F5. window.saveSetting já é debounced (tagmanager_db.js),
        // então isso já agrupa bem sozinho.
        if (typeof window.saveSetting === 'function') {
            await window.saveSetting('danbooru_tag_cache', window.danbooruCache);
        }
    }
}

/* ---------- LEITURA COM SUPORTE A UNKNOWN ---------- */
window.dbGetCachedTag = function (tag) {
    const key = (tag || '').toLowerCase();
    // Se for uma tag desconhecida, envia um dummy com 0 posts para a UI não travar nem pedir scan
    if (window.isTagUnknownDb(key)) {
        return { count: 0, category: 0, isDeprecated: false, aliasChecked: true, wikiChecked: true, hasWikiInfo: false, ts: Date.now(), wikiTs: Date.now() };
    }
    return window.danbooruCache[key] || null;
};

/* ---------- ALIAS RESOLUTION ---------- */
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
            if (data && data[0] && data[0].consequent_name) {
                aliasTo = data[0].consequent_name.replace(/_/g, ' ');
            }
        }
    } catch (e) {
        return (window.danbooruCache[key] && window.danbooruCache[key].aliasTo) || null;
    }

    window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), aliasChecked: true, aliasTs: now, aliasTo };
    bumpDanbooruCacheVersion();
    return aliasTo;
};

async function dbFetchSingleTagInfo(tagName, force = false) {
    const key = tagName.toLowerCase();
    
    // Pula se já for confirmada como descartada/inexistente
    if (window.isTagUnknownDb(key) && !force) {
        return { count: 0, category: 0 };
    }

    const now = Date.now();
    const cached = window.danbooruCache[key];
    if (!force && cached && cached.count !== undefined && (now - (cached.ts || 0)) < DB_COUNT_TTL) {
        return cached;
    }
    const url = `https://danbooru.donmai.us/tags.json?search[name]=${encodeURIComponent(tagName.replace(/ /g, '_'))}&limit=1`;
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data && data[0]) {
                window.danbooruCache[key] = {
                    ...(window.danbooruCache[key] || {}),
                    count: parseInt(data[0].post_count) || 0,
                    category: data[0].category,
                    wikiName: data[0].name,
                    isDeprecated: !!data[0].is_deprecated,
                    ts: now
                };
                bumpDanbooruCacheVersion();
                return window.danbooruCache[key];
            }
        }
    } catch (e) {}
    return window.danbooruCache[key] || null;
}

/* ---------- LOTE: conta + categoria ---------- */
window.dbFetchCountsBatch = function (tags, force = false) {
    return dbQueueBatch(async () => {
        const now = Date.now();
        const toFetch = tags.filter(t => {
            if (t.startsWith('NL:')) return false;
            const key = t.toLowerCase();
            
            // Ignora o scan se for uma tag garantidamente desconhecida (exceto se force recheck)
            if (window.isTagUnknownDb(key) && !force) return false;
            
            const cached = window.danbooruCache[key];
            if (force) return true;
            if (!cached || cached.count === undefined) return true;
            if (!cached.aliasChecked) return true;
            return (now - (cached.ts || 0)) > DB_COUNT_TTL;
        });
        if (toFetch.length === 0) return { fetched: 0 };

        const chunkSize = 50;
        let fetchedCount = 0;
        const zeroCountTags = []; 

        for (let i = 0; i < toFetch.length; i += chunkSize) {
            const chunk = toFetch.slice(i, i + chunkSize);
            const query = chunk.map(t => encodeURIComponent(t.replace(/ /g, '_'))).join(',');
            try {
                const res = await fetch(`https://danbooru.donmai.us/tags.json?search[name_comma]=${query}`);
                if (res.ok) {
                    const data = await res.json();
                    const foundCounts = new Map();
                    data.forEach(dt => {
                        const key = dt.name.replace(/_/g, ' ').toLowerCase();
                        foundCounts.set(key, parseInt(dt.post_count) || 0);
                        window.danbooruCache[key] = {
                            ...(window.danbooruCache[key] || {}),
                            count: parseInt(dt.post_count) || 0,
                            category: dt.category,
                            wikiName: dt.name,
                            isDeprecated: !!dt.is_deprecated,
                            ts: now
                        };
                        bumpDanbooruCacheVersion();
                    });
                    chunk.forEach(t => {
                        const key = t.toLowerCase();
                        const count = foundCounts.has(key) ? foundCounts.get(key) : 0;
                        if (!foundCounts.has(key)) {
                            window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), count: 0, ts: now };
                            bumpDanbooruCacheVersion();
                        }
                        if (count === 0) {
                            zeroCountTags.push(t);
                        } else {
                            window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), aliasTo: null, aliasChecked: true, aliasTs: now };
                            bumpDanbooruCacheVersion();
                        }
                    });
                    fetchedCount += chunk.length;
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 800));
        }

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
                    isDeprecated: true,
                    ts: now
                };
                bumpDanbooruCacheVersion();
                await new Promise(r => setTimeout(r, 400));
            } else {
                // TAG DEFINITIVAMENTE DESCONHECIDA/AUTORAL
                window.markTagAsUnknownDb(key);
            }
        }

        // Fim de um batch de contagens: usa o scheduler debounced (não é o
        // checkpoint periódico do scan de wiki, então pode agrupar/adiar).
        scheduleDanbooruCachePersist();
        return { fetched: fetchedCount };
    });
};

/* ---------- LOTE: descrição da wiki ---------- */
window.dbFetchWikiBatch = function (tags, force = false, onEachTag, onProgress) {
    return dbQueueBatch(async () => {
        const now = Date.now();
        const toFetch = tags.filter(t => {
            if (t.startsWith('NL:')) return false;
            const key = t.toLowerCase();
            if (window.isTagUnknownDb(key) && !force) return false;
            
            const cached = window.danbooruCache[key];
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
            bumpDanbooruCacheVersion();
            if (hasWikiInfo) found++;
            processed++;

            if (onEachTag) onEachTag(key, hasWikiInfo);
            if (onProgress) onProgress(processed, toFetch.length, found);

            if (processed % 8 === 0) await dbPersistCache();

            await new Promise(r => setTimeout(r, 350));
        }

        await dbPersistCache();
        return { fetched: processed, found };
    });
};

/* ---------- BUSCA MANUAL ---------- */
window.dbLookupSingleTag = async function (rawTag) {
    const tag = rawTag.trim().toLowerCase().replace(/ /g, '_');
    const key = tag.replace(/_/g, ' ');
    const now = Date.now();
    
    if (window.isTagUnknownDb(key)) {
        return { count: 0, category: 0, wikiName: key, hasWikiInfo: false, description: 'Unknown custom tag (not on Danbooru).' };
    }

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
                    isDeprecated: !!data[0].is_deprecated,
                    ts: now
                };
                bumpDanbooruCacheVersion();
            } else {
                const aliasTo = await window.dbResolveAlias(key);
                if (aliasTo) {
                    const consequentInfo = await dbFetchSingleTagInfo(aliasTo);
                    window.danbooruCache[key] = {
                        ...(window.danbooruCache[key] || {}),
                        count: (consequentInfo && consequentInfo.count) || 0,
                        category: (consequentInfo && consequentInfo.category) || 0,
                        wikiName: (consequentInfo && consequentInfo.wikiName) || aliasTo.replace(/ /g, '_'),
                        aliasTo, aliasChecked: true, aliasTs: now,
                        isDeprecated: true,
                        ts: now
                    };
                    bumpDanbooruCacheVersion();
                } else {
                    window.markTagAsUnknownDb(key);
                    return null; 
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
            bumpDanbooruCacheVersion();
        } catch (e) {}
    }

    // Busca manual (1 tag por vez, iniciada pelo usuário) — pode agrupar
    // com o mesmo scheduler debounced, sem perda perceptível de segurança.
    scheduleDanbooruCachePersist();
    return window.danbooruCache[key] || null;
};

/* ---------- AUTOCOMPLETE (HÍBRIDO) ----------
   Reaproveita o MESMO scheduler debounced acima (antes tinha seu próprio
   timer separado de 1500ms, não exposto em window — agora fica unificado
   com os outros pontos de escrita e também participa do flush em
   beforeunload/visibilitychange, cobrindo o caso de fechar a aba logo
   depois de digitar num autocomplete. */
function dbScheduleAutocompleteSave() {
    scheduleDanbooruCachePersist();
}

window.dbSearchTagMatches = async function (query, limit = 6) {
    const now = Date.now();
    const queryLower = query.trim().toLowerCase();
    const localResults = [];

    // Ignora a ram de unknownTagsCache pois não queremos lixo no autocomplete
    if (window.danbooruCache) {
        for (const [key, entry] of Object.entries(window.danbooruCache)) {
            if (key.includes(queryLower)) {
                localResults.push({
                    name: key,
                    post_count: entry.count || 0,
                    category: entry.category || 0,
                    isAlias: !!entry.aliasTo,
                    aliasTo: entry.aliasTo || null,
                    isDeprecated: !!entry.isDeprecated
                });
            }
        }
    }

    if (localResults.length >= limit) {
        localResults.sort((a, b) => b.post_count - a.post_count);
        return localResults.slice(0, limit);
    }

    let directRaw = [];
    try {
        const res = await fetch(`https://danbooru.donmai.us/tags.json?search[name_matches]=*${query}*&limit=${limit}&search[order]=count`);
        if (res.ok) directRaw = await res.json();
    } catch (e) {}

    const aliasMap = new Map(); 
    const aliasUrl = `https://danbooru.donmai.us/tag_aliases.json?search[antecedent_name_matches]=*${query}*&search[status]=active&limit=${Math.max(limit * 3, 20)}`;
    try {
        const aliasRes = await fetch(aliasUrl);
        if (aliasRes.ok) {
            const aliasData = await aliasRes.json();
            aliasData.forEach(a => { if (a.antecedent_name) aliasMap.set(a.antecedent_name, a.consequent_name); });
        }
    } catch (e) {}

    const results = [...localResults];
    const seenAntecedents = new Set(localResults.map(r => r.name));

    for (const t of directRaw) {
        if (seenAntecedents.has(t.name.replace(/_/g, ' '))) continue;
        seenAntecedents.add(t.name);
        const aliasTo = aliasMap.get(t.name);
        const key = t.name.replace(/_/g, ' ').toLowerCase();

        if (aliasTo) {
            const aliasToSpaced = aliasTo.replace(/_/g, ' ');
            const consequentInfo = await dbFetchSingleTagInfo(aliasToSpaced);
            const realCount = (consequentInfo && consequentInfo.count) || 0;
            const realCategory = (consequentInfo && consequentInfo.category) || 0;
            window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), count: realCount, category: realCategory, aliasTo: aliasToSpaced, aliasChecked: true, aliasTs: now, isDeprecated: true, ts: now };
            bumpDanbooruCacheVersion();
            results.push({ name: key, post_count: realCount, category: realCategory, isAlias: true, aliasTo: aliasToSpaced, isDeprecated: true });
        } else {
            window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), count: parseInt(t.post_count) || 0, category: t.category, wikiName: t.name, aliasTo: null, aliasChecked: true, aliasTs: now, isDeprecated: !!t.is_deprecated, ts: now };
            bumpDanbooruCacheVersion();
            results.push({ name: key, post_count: parseInt(t.post_count) || 0, category: t.category, isAlias: false, isDeprecated: !!t.is_deprecated });
        }
    }

    for (const [antecedent, consequent] of aliasMap.entries()) {
        const key = antecedent.replace(/_/g, ' ').toLowerCase();
        if (seenAntecedents.has(key)) continue;
        const consequentSpaced = consequent.replace(/_/g, ' ');
        const consequentInfo = await dbFetchSingleTagInfo(consequentSpaced);
        const realCount = (consequentInfo && consequentInfo.count) || 0;
        const realCategory = (consequentInfo && consequentInfo.category) || 0;
        
        window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), count: realCount, category: realCategory, aliasTo: consequentSpaced, aliasChecked: true, aliasTs: now, isDeprecated: true, ts: now };
        bumpDanbooruCacheVersion();
        results.push({ name: key, post_count: realCount, category: realCategory, isAlias: true, aliasTo: consequentSpaced, isDeprecated: true });
    }

    const dedupedByName = new Map();
    for (const r of results) {
        const key = r.name.toLowerCase();
        const existing = dedupedByName.get(key);
        if (!existing || (r.isAlias && !existing.isAlias)) {
            dedupedByName.set(key, r);
        }
    }
    const dedupedResults = Array.from(dedupedByName.values());

    dedupedResults.sort((a, b) => b.post_count - a.post_count);
    if (dedupedResults.length > 0) dbScheduleAutocompleteSave();
    return dedupedResults.slice(0, limit);
};

/* ---------- BOOT: INICIALIZAÇÃO E MIGRAÇÃO ----------
   NOTA: consolidado num único bloco (a versão anterior tinha 3 blocos
   DOMContentLoaded idênticos/quase-idênticos disparando em paralelo, com
   uma race condition entre "migrar a chave antiga" e "zerar a chave
   antiga" — dependendo da ordem de conclusão dos awaits, o cache legado
   podia ser apagado do IndexedDB antes de ser copiado pro JSON local.
   Só este bloco deve existir. */
window.addEventListener('DOMContentLoaded', async () => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocalhost) {
        window.isDanbooruLocalMode = true;
        let jsonCache = {};
        let needsSyncToLocal = false;
        let needsUnknownClean = false;

        // Tenta carregar o dicionário de tags descartadas primeiro
        await window.loadUnknownTags();

        // 1. Tenta carregar o JSON local
        try {
            const res = await fetch('/local/danbooru_cache.json?t=' + Date.now(), { cache: 'no-store' });
            if (res.ok) {
                jsonCache = await res.json();
            }
        } catch (e) {}

        // 2. Tenta recuperar os dados do IndexedDB (se existir)
        if (typeof window.getSetting === 'function') {
            const oldDbCache = await window.getSetting('danbooru_tag_cache', null);
            if (oldDbCache && Object.keys(oldDbCache).length > 0) {
                jsonCache = Object.assign(oldDbCache, jsonCache);
                needsSyncToLocal = true;
                if (typeof window.saveSetting === 'function') await window.saveSetting('danbooru_tag_cache', {});
            }
        }

        // 3. Limpeza: Varre os dados e isola o lixo no unknown_tags.json
        for (const key of Object.keys(jsonCache)) {
            const entry = jsonCache[key];
            if (entry.count === 0 && entry.aliasChecked && !entry.aliasTo) {
                window.unknownTagsCache[key] = window.unknownTagsCache[key] || { ts: Date.now() };
                window.unknownTagsCache[key].danbooru = true;
                delete jsonCache[key];
                needsUnknownClean = true;
                needsSyncToLocal = true; // O dicionário local teve itens removidos, precisa salvar
            }
        }

        window.danbooruCache = Object.assign(window.danbooruCache || {}, jsonCache);
        bumpDanbooruCacheVersion();

        if (needsSyncToLocal) await dbPersistCache();
        if (needsUnknownClean) await window.saveUnknownTags();

    } else {
        // Fallback: Modo Online puro (Web)
        window.isDanbooruLocalMode = false;
        await window.loadUnknownTags();
        if (typeof window.getSetting === 'function') {
            window.danbooruCache = await window.getSetting('danbooru_tag_cache', window.danbooruCache || {});
            bumpDanbooruCacheVersion();
            pruneStaleDanbooruCacheOnlineOnly();
        }
    }
});