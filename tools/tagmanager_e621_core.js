/* =========================================================================
   E621 API CORE (Standalone — Híbrido Local/Online)
   ---------------------------------------------------------------------
   Camada de acesso à API do e621 com suporte a tags descartadas.

   FIX (invalidação do _aliasIndex — ver tagmanager_alias_bridge.js):
   Mesmo problema do Danbooru (ver tagmanager_danbooru_core.js): o índice
   de aliases reversos só reconstruía quando o TAMANHO do cache mudava,
   perdendo mutações de aliasTo em entradas já existentes. Agora toda
   escrita/remoção real em window.e621Cache incrementa
   window._e621CacheVersion, que o alias_bridge.js usa como gatilho.
========================================================================= */

window.e621Cache = window.e621Cache || {};
window.isLocalMode = false;

// Contador de versão do cache — mesmo mecanismo do Danbooru.
window._e621CacheVersion = window._e621CacheVersion || 0;
function bumpE621CacheVersion() {
    window._e621CacheVersion = (window._e621CacheVersion || 0) + 1;
}

/* ---------- LIMPEZA PERIÓDICA (só faz sentido no modo ONLINE/IndexedDB) ----------
   Mesmo raciocínio do Danbooru (ver tagmanager_danbooru_core.js): no modo
   local o cache pode crescer pra sempre sem problema (arquivo simples que
   o usuário pode apagar quando quiser). No modo ONLINE, porém, ele vive
   dentro do blob de window._settingsCache (chave 'e621_tag_cache'), que é
   regravado por INTEIRO no IndexedDB a cada saveSetting() — sem limpeza,
   esse blob só cresce e cada gravação fica mais pesada com o tempo. Esta
   função roda 1x por sessão no boot (não a cada persist) e remove só
   entradas sem nenhuma atividade há mais de DB_CACHE_PRUNE_MAX_AGE_MS —
   tags removidas voltam a ser buscadas normalmente na próxima vez que
   aparecerem, sem perda funcional. */
const E621_CACHE_PRUNE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // 180 dias sem nenhuma atividade

function pruneStaleE621CacheOnlineOnly() {
    if (window.isLocalMode) return; // modo local: cache livre pra crescer, sem poda
    const now = Date.now();
    let removed = 0;
    Object.keys(window.e621Cache).forEach(key => {
        const entry = window.e621Cache[key] || {};
        const lastActivity = Math.max(entry.ts || 0, entry.wikiTs || 0, entry.aliasTs || 0);
        if (lastActivity && (now - lastActivity) > E621_CACHE_PRUNE_MAX_AGE_MS) {
            delete window.e621Cache[key];
            removed++;
        }
    });
    if (removed > 0) {
        bumpE621CacheVersion();
        scheduleE621CachePersist();
        console.log(`[e621] Poda de manutenção (IndexedDB): removida(s) ${removed} entrada(s) sem atividade há mais de 180 dias.`);
    }
}

const E621_COUNT_TTL = 15 * 24 * 60 * 60 * 1000;
const E621_WIKI_TTL   = 30 * 24 * 60 * 60 * 1000;
const E621_ALIAS_TTL  = 15 * 24 * 60 * 60 * 1000;

window.E621_CAT_COLORS = { 0: "#aaa", 1: "#f9a825", 3: "#ae80ff", 4: "#5bc0de", 5: "#4caf50", 6: "#888", 7: "#888", 8: "#ff8a65" };
window.E621_CAT_LABELS = { 0: "General", 1: "Artist", 3: "Copyright", 4: "Character", 5: "Species", 6: "Invalid", 7: "Meta", 8: "Lore" };

function e621Host() {
    return window.showE621Sfw ? 'e926.net' : 'e621.net';
}

let _e621BatchQueue = Promise.resolve();
function e621QueueBatch(fn) {
    const run = () => fn().catch(e => { console.warn('[e621 API]', e); });
    const chained = _e621BatchQueue.then(run, run);
    _e621BatchQueue = chained;
    return chained;
}

/* ---------- GESTÃO DE TAGS DESCONHECIDAS (COMPARTILHADO) ---------- */
window.unknownTagsCache = window.unknownTagsCache || {};
window.unknownTagsLoaded = window.unknownTagsLoaded || false;

window.loadUnknownTags = window.loadUnknownTags || async function() {
    if (window.unknownTagsLoaded) return;
    if (window.isLocalMode) {
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
        // arquivo local que não existe nesse modo.
        const stored = await window.getSetting('unknown_tags_cache', null);
        if (stored) window.unknownTagsCache = Object.assign(window.unknownTagsCache, stored);
    }
    window.unknownTagsLoaded = true;
};

window.saveUnknownTags = window.saveUnknownTags || async function() {
    if (window.isLocalMode) {
        try {
            await fetch('/api/save_local_cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: 'local/unknown_tags.json', data: window.unknownTagsCache })
            });
        } catch (e) {}
    } else if (typeof window.saveSetting === 'function') {
        await window.saveSetting('unknown_tags_cache', window.unknownTagsCache);
    }
};

window.markTagAsUnknownE621 = function(key) {
    window.unknownTagsCache[key] = window.unknownTagsCache[key] || { ts: Date.now() };
    window.unknownTagsCache[key].e621 = true;
    delete window.e621Cache[key]; // Remove da base principal para mantê-la limpa
    bumpE621CacheVersion();
    window.saveUnknownTags();
};

window.isTagUnknownE621 = function(key) {
    return window.unknownTagsCache[key] && window.unknownTagsCache[key].e621;
};

/* ---------- PERSISTÊNCIA COM DEBOUNCE (otimização) ----------
   Mesmo mecanismo do Danbooru (ver tagmanager_danbooru_core.js): agrupa
   gravações repetidas do cache numa escrita só, com flush final via
   sendBeacon se a aba fechar antes do timer disparar. O checkpoint
   periódico do scan de wiki em lote (e621FetchWikiBatch, a cada 8 tags)
   continua IMEDIATO — é um checkpoint de segurança de baixa frequência
   durante um scan longo, não uma escrita "quente" que precise agrupar. */
const E621_CACHE_PERSIST_DEBOUNCE_MS = 800;
let _e621CachePersistTimer = null;

function scheduleE621CachePersist() {
    clearTimeout(_e621CachePersistTimer);
    _e621CachePersistTimer = setTimeout(() => {
        _e621CachePersistTimer = null;
        e621PersistCache();
    }, E621_CACHE_PERSIST_DEBOUNCE_MS);
}

window._flushE621CachePersist = function(useBeacon = false) {
    if (_e621CachePersistTimer) {
        clearTimeout(_e621CachePersistTimer);
        _e621CachePersistTimer = null;
        e621PersistCache(useBeacon);
    }
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') window._flushE621CachePersist(false);
});
window.addEventListener('pagehide', () => window._flushE621CachePersist(true));
window.addEventListener('beforeunload', () => window._flushE621CachePersist(true));

/* ---------- PERSISTÊNCIA HÍBRIDA ---------- */
async function e621PersistCache(useBeacon = false) {
    if (window.isLocalMode) {
        const body = JSON.stringify({ file: 'local/e621_cache.json', data: window.e621Cache });
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
        // Mesma fila compartilhada do Danbooru/settings/presets (ver
        // tagmanager_db.js) — os 4 caches locais compartilham o endpoint
        // /api/save_local_cache; sem serializar, um POST atrasado pode
        // terminar depois de um mais novo e sobrescrever com dado velho.
        const doWrite = async () => {
            try {
                await fetch('/api/save_local_cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body
                });
            } catch (e) {
                console.warn('[e621] Falha ao salvar cache localmente', e);
            }
        };
        if (typeof window._queueLocalCacheWrite === 'function') await window._queueLocalCacheWrite(doWrite);
        else await doWrite();
    } else {
        // Modo online: persiste de volta no IndexedDB (mesmo fix do Danbooru).
        // window.saveSetting já é debounced (tagmanager_db.js), então isso
        // já agrupa bem sozinho.
        if (typeof window.saveSetting === 'function') {
            await window.saveSetting('e621_tag_cache', window.e621Cache);
        }
    }
}

/* ---------- LEITURA COM SUPORTE A UNKNOWN ---------- */
window.e621GetCachedTag = function (tag) {
    const key = (tag || '').toLowerCase();
    if (window.isTagUnknownE621(key)) {
        return { count: 0, category: 0, isDeprecated: false, aliasChecked: true, wikiChecked: true, hasWikiInfo: false, ts: Date.now(), wikiTs: Date.now() };
    }
    return window.e621Cache[key] || null;
};

/* ---------- ALIAS RESOLUTION ---------- */
window.e621ResolveAlias = async function (tagName) {
    const key = tagName.toLowerCase();
    const now = Date.now();
    const cached = window.e621Cache[key];
    if (cached && cached.aliasChecked && (now - (cached.aliasTs || 0)) < E621_ALIAS_TTL) {
        return cached.aliasTo || null;
    }

    const nameForApi = tagName.trim().toLowerCase().replace(/ /g, '_');
    const url = `https://${e621Host()}/tag_aliases.json?search[antecedent_name]=${encodeURIComponent(nameForApi)}&search[status]=active&limit=1`;
    let aliasTo = null;
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data && data[0] && data[0].consequent_name) {
                aliasTo = data[0].consequent_name.replace(/_/g, ' ');
            }
        }
    } catch (e) {
        return (window.e621Cache[key] && window.e621Cache[key].aliasTo) || null;
    }

    window.e621Cache[key] = { ...(window.e621Cache[key] || {}), aliasChecked: true, aliasTs: now, aliasTo };
    bumpE621CacheVersion();
    return aliasTo;
};

async function e621FetchSingleTagInfo(tagName, force = false) {
    const key = tagName.toLowerCase();
    
    if (window.isTagUnknownE621(key) && !force) {
        return { count: 0, category: 0 };
    }

    const now = Date.now();
    const cached = window.e621Cache[key];
    if (!force && cached && cached.count !== undefined && (now - (cached.ts || 0)) < E621_COUNT_TTL) {
        return cached;
    }
    const url = `https://${e621Host()}/tags.json?search[name]=${encodeURIComponent(tagName.replace(/ /g, '_'))}&limit=1`;
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            const arr = Array.isArray(data) ? data : (data.tags || []);
            if (arr && arr[0]) {
                window.e621Cache[key] = {
                    ...(window.e621Cache[key] || {}),
                    count: parseInt(arr[0].post_count) || 0,
                    category: arr[0].category,
                    wikiName: arr[0].name,
                    ts: now
                };
                bumpE621CacheVersion();
                return window.e621Cache[key];
            }
        }
    } catch (e) {}
    return window.e621Cache[key] || null;
}

/* ---------- LOTE: conta + categoria ---------- */
window.e621FetchCountsBatch = function (tags, force = false) {
    return e621QueueBatch(async () => {
        const now = Date.now();
        const toFetch = tags.filter(t => {
            if (t.startsWith('NL:')) return false;
            const key = t.toLowerCase();
            
            if (window.isTagUnknownE621(key) && !force) return false;
            
            const cached = window.e621Cache[key];
            if (force) return true;
            if (!cached || cached.count === undefined) return true;
            if (!cached.aliasChecked) return true;
            return (now - (cached.ts || 0)) > E621_COUNT_TTL;
        });
        if (toFetch.length === 0) return { fetched: 0 };

        let fetchedCount = 0;
        const zeroCountTags = [];

        for (const tag of toFetch) {
            const info = await e621FetchSingleTagInfo(tag, force);
            const count = (info && info.count) || 0;
            if (count === 0) zeroCountTags.push(tag);
            fetchedCount++;
            await new Promise(r => setTimeout(r, 350));
        }

        for (const tag of zeroCountTags) {
            const key = tag.toLowerCase();
            const already = window.e621Cache[key];
            if (already && already.aliasChecked && !force) continue;
            const aliasTo = await window.e621ResolveAlias(tag);
            if (aliasTo) {
                const consequentInfo = await e621FetchSingleTagInfo(aliasTo, force);
                window.e621Cache[key] = {
                    ...(window.e621Cache[key] || {}),
                    count: (consequentInfo && consequentInfo.count) || 0,
                    category: (consequentInfo && consequentInfo.category) || 0,
                    aliasTo, aliasChecked: true, aliasTs: now, isDeprecated: true, ts: now
                };
                bumpE621CacheVersion();
                await new Promise(r => setTimeout(r, 350));
            } else {
                // TAG DESCONHECIDA NO E621
                window.markTagAsUnknownE621(key);
            }
        }

        // Fim de um batch de contagens: usa o scheduler debounced (não é o
        // checkpoint periódico do scan de wiki, então pode agrupar/adiar).
        scheduleE621CachePersist();
        return { fetched: fetchedCount };
    });
};

/* ---------- LOTE: descrição da wiki ---------- */
window.e621FetchWikiBatch = function (tags, force = false, onEachTag, onProgress) {
    return e621QueueBatch(async () => {
        const now = Date.now();
        const toFetch = tags.filter(t => {
            if (t.startsWith('NL:')) return false;
            const key = t.toLowerCase();
            if (window.isTagUnknownE621(key) && !force) return false;

            const cached = window.e621Cache[key];
            if (force) return true;
            if (!cached || !cached.wikiChecked) return true;
            return (now - (cached.wikiTs || 0)) > E621_WIKI_TTL;
        });
        if (toFetch.length === 0) return { fetched: 0, found: 0 };

        let processed = 0, found = 0;
        for (const tag of toFetch) {
            if (window._e621BackgroundScanCancelled) break;

            const key = tag.toLowerCase();
            const wikiName = (window.e621Cache[key] && window.e621Cache[key].wikiName) || tag.trim().toLowerCase().replace(/ /g, '_');

            let hasWikiInfo = false, description = '';
            try {
                const wRes = await fetch(`https://${e621Host()}/wiki_pages/${encodeURIComponent(wikiName)}.json`);
                if (wRes.ok) {
                    const wData = await wRes.json();
                    if (wData && wData.body && wData.body.trim()) {
                        hasWikiInfo = true;
                        const clean = wData.body.replace(/\[.*?\]/g, '').trim();
                        description = clean.slice(0, 800) + (clean.length > 800 ? '...' : '');
                    }
                }
            } catch (e) {}

            window.e621Cache[key] = { ...(window.e621Cache[key] || {}), wikiChecked: true, wikiTs: now, hasWikiInfo, description };
            bumpE621CacheVersion();
            if (hasWikiInfo) found++;
            processed++;

            if (onEachTag) onEachTag(key, hasWikiInfo);
            if (onProgress) onProgress(processed, toFetch.length, found);
            if (processed % 8 === 0) await e621PersistCache();

            await new Promise(r => setTimeout(r, 350));
        }

        await e621PersistCache();
        return { fetched: processed, found };
    });
};

/* ---------- BUSCA MANUAL ---------- */
window.e621LookupSingleTag = async function (rawTag) {
    const tag = rawTag.trim().toLowerCase().replace(/ /g, '_');
    const key = tag.replace(/_/g, ' ');
    const now = Date.now();
    
    if (window.isTagUnknownE621(key)) {
        return { count: 0, category: 0, wikiName: key, hasWikiInfo: false, description: 'Unknown custom tag (not on e621).' };
    }

    const cached = window.e621Cache[key];
    const needsBasic = !cached || cached.count === undefined || (now - (cached.ts || 0)) > E621_COUNT_TTL;
    const needsWiki = !cached || !cached.wikiChecked || (now - (cached.wikiTs || 0)) > E621_WIKI_TTL;

    if (needsBasic) {
        try {
            const res = await fetch(`https://${e621Host()}/tags.json?search[name]=${encodeURIComponent(tag)}&limit=1`);
            const data = await res.json();
            const arr = Array.isArray(data) ? data : (data.tags || []);
            if (arr && arr[0]) {
                window.e621Cache[key] = {
                    ...(window.e621Cache[key] || {}),
                    count: parseInt(arr[0].post_count) || 0,
                    category: arr[0].category,
                    wikiName: arr[0].name,
                    ts: now
                };
                bumpE621CacheVersion();
            } else {
                const aliasTo = await window.e621ResolveAlias(key);
                if (aliasTo) {
                    const consequentInfo = await e621FetchSingleTagInfo(aliasTo);
                    window.e621Cache[key] = {
                        ...(window.e621Cache[key] || {}),
                        count: (consequentInfo && consequentInfo.count) || 0,
                        category: (consequentInfo && consequentInfo.category) || 0,
                        wikiName: (consequentInfo && consequentInfo.wikiName) || aliasTo.replace(/ /g, '_'),
                        aliasTo, aliasChecked: true, aliasTs: now, isDeprecated: true, ts: now
                    };
                    bumpE621CacheVersion();
                } else {
                    window.markTagAsUnknownE621(key);
                    return null;
                }
            }
        } catch (e) { return window.e621Cache[key] || null; }
    }

    if (needsWiki && window.e621Cache[key]) {
        const wikiName = window.e621Cache[key].wikiName || tag;
        try {
            const wRes = await fetch(`https://${e621Host()}/wiki_pages/${encodeURIComponent(wikiName)}.json`);
            let hasWikiInfo = false, description = '';
            if (wRes.ok) {
                const wData = await wRes.json();
                if (wData && wData.body && wData.body.trim()) {
                    hasWikiInfo = true;
                    const clean = wData.body.replace(/\[.*?\]/g, '').trim();
                    description = clean.slice(0, 800) + (clean.length > 800 ? '...' : '');
                }
            }
            window.e621Cache[key] = { ...window.e621Cache[key], wikiChecked: true, wikiTs: now, hasWikiInfo, description };
            bumpE621CacheVersion();
        } catch (e) {}
    }

    // Busca manual (1 tag por vez, iniciada pelo usuário) — pode agrupar
    // com o mesmo scheduler debounced, sem perda perceptível de segurança.
    scheduleE621CachePersist();
    return window.e621Cache[key] || null;
};

/* ---------- AUTOCOMPLETE (HÍBRIDO) ----------
   Reaproveita o MESMO scheduler debounced acima — unificado com os outros
   pontos de escrita e participando do flush em beforeunload/visibilitychange. */
function e621ScheduleAutocompleteSave() {
    scheduleE621CachePersist();
}

window.e621SearchTagMatches = async function (query, limit = 6) {
    const now = Date.now();
    const queryLower = query.trim().toLowerCase();
    const localResults = [];

    // Ignora a ram de unknownTagsCache pois não queremos lixo no autocomplete
    if (window.e621Cache) {
        for (const [key, entry] of Object.entries(window.e621Cache)) {
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
        const res = await fetch(`https://${e621Host()}/tags.json?search[name_matches]=*${query}*&limit=${limit}&search[order]=count`);
        if (res.ok) {
            const data = await res.json();
            directRaw = Array.isArray(data) ? data : (data.tags || []);
        }
    } catch (e) {}

    const aliasMap = new Map();
    const aliasUrl = `https://${e621Host()}/tag_aliases.json?search[antecedent_name_matches]=*${query}*&search[status]=active&limit=${Math.max(limit * 3, 20)}`;
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
            const consequentInfo = await e621FetchSingleTagInfo(aliasToSpaced);
            const realCount = (consequentInfo && consequentInfo.count) || 0;
            const realCategory = (consequentInfo && consequentInfo.category) || 0;
            window.e621Cache[key] = { ...(window.e621Cache[key] || {}), count: realCount, category: realCategory, aliasTo: aliasToSpaced, aliasChecked: true, aliasTs: now, isDeprecated: true, ts: now };
            bumpE621CacheVersion();
            results.push({ name: key, post_count: realCount, category: realCategory, isAlias: true, aliasTo: aliasToSpaced, isDeprecated: true });
        } else {
            window.e621Cache[key] = { ...(window.e621Cache[key] || {}), count: parseInt(t.post_count) || 0, category: t.category, wikiName: t.name, aliasTo: null, aliasChecked: true, aliasTs: now, ts: now };
            bumpE621CacheVersion();
            results.push({ name: key, post_count: parseInt(t.post_count) || 0, category: t.category, isAlias: false });
        }
    }

    for (const [antecedent, consequent] of aliasMap.entries()) {
        const key = antecedent.replace(/_/g, ' ').toLowerCase();
        if (seenAntecedents.has(key)) continue;
        const consequentSpaced = consequent.replace(/_/g, ' ');
        const consequentInfo = await e621FetchSingleTagInfo(consequentSpaced);
        const realCount = (consequentInfo && consequentInfo.count) || 0;
        const realCategory = (consequentInfo && consequentInfo.category) || 0;
        
        window.e621Cache[key] = { ...(window.e621Cache[key] || {}), count: realCount, category: realCategory, aliasTo: consequentSpaced, aliasChecked: true, aliasTs: now, isDeprecated: true, ts: now };
        bumpE621CacheVersion();
        results.push({ name: key, post_count: realCount, category: realCategory, isAlias: true, aliasTo: consequentSpaced, isDeprecated: true });
    }

    const dedupedByName = new Map();
    for (const r of results) {
        const key = r.name.toLowerCase();
        const existing = dedupedByName.get(key);
        if (!existing || (r.isAlias && !existing.isAlias)) dedupedByName.set(key, r);
    }
    const dedupedResults = Array.from(dedupedByName.values());
    dedupedResults.sort((a, b) => b.post_count - a.post_count);
    if (dedupedResults.length > 0) e621ScheduleAutocompleteSave();
    return dedupedResults.slice(0, limit);
};

window.pickBestTagCount = function (dbCached, e621Cached) {
    const dbCount = (dbCached && dbCached.count !== undefined) ? dbCached.count : null;
    const e6Count = (e621Cached && e621Cached.count !== undefined) ? e621Cached.count : null;
    if (dbCount === null && e6Count === null) return null;
    if (dbCount === null) return { count: e6Count, source: 'e621', deprecated: !!e621Cached.isDeprecated };
    if (e6Count === null) return { count: dbCount, source: 'danbooru', deprecated: !!dbCached.isDeprecated };
    return e6Count > dbCount
        ? { count: e6Count, source: 'e621', deprecated: !!e621Cached.isDeprecated }
        : { count: dbCount, source: 'danbooru', deprecated: !!dbCached.isDeprecated };
};

/* ---------- BOOT: INICIALIZAÇÃO E MIGRAÇÃO ----------
   NOTA: consolidado num único bloco (mesma correção aplicada ao
   tagmanager_danbooru_core.js — eliminando 3 disparos paralelos de
   DOMContentLoaded que causavam fetch triplicado e uma race condition
   entre migrar e zerar a chave legada do IndexedDB). */
window.addEventListener('DOMContentLoaded', async () => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocalhost) {
        window.isLocalMode = true;
        let jsonCache = {};
        let needsSyncToLocal = false;
        let needsUnknownClean = false;

        await window.loadUnknownTags();

        try {
            const res = await fetch('/local/e621_cache.json?t=' + Date.now(), { cache: 'no-store' });
            if (res.ok) jsonCache = await res.json();
        } catch (e) {}

        if (typeof window.getSetting === 'function') {
            const oldDbCache = await window.getSetting('e621_tag_cache', null);
            if (oldDbCache && Object.keys(oldDbCache).length > 0) {
                jsonCache = Object.assign(oldDbCache, jsonCache);
                needsSyncToLocal = true;
                if (typeof window.saveSetting === 'function') await window.saveSetting('e621_tag_cache', {});
            }
        }

        for (const key of Object.keys(jsonCache)) {
            const entry = jsonCache[key];
            if (entry.count === 0 && entry.aliasChecked && !entry.aliasTo) {
                window.unknownTagsCache[key] = window.unknownTagsCache[key] || { ts: Date.now() };
                window.unknownTagsCache[key].e621 = true;
                delete jsonCache[key];
                needsUnknownClean = true;
                needsSyncToLocal = true;
            }
        }

        window.e621Cache = Object.assign(window.e621Cache || {}, jsonCache);
        bumpE621CacheVersion();

        if (needsSyncToLocal) await e621PersistCache();
        if (needsUnknownClean) await window.saveUnknownTags();

    } else {
        window.isLocalMode = false;
        await window.loadUnknownTags();
        if (typeof window.getSetting === 'function') {
            window.e621Cache = await window.getSetting('e621_tag_cache', window.e621Cache || {});
            bumpE621CacheVersion();
            pruneStaleE621CacheOnlineOnly();
        }
    }
});