/* =========================================================================
   BOORU CORE — implementação única para Danbooru e e621
   ---------------------------------------------------------------------
   window.createBooruClient(cfg) cria um cliente com cache, TTL, alias,
   tags "unknown", wiki e persistência híbrida (arquivo em local/ no
   localhost, IndexedDB/settings online). tagmanager_danbooru_core.js e
   tagmanager_e621_core.js são só a CONFIGURAÇÃO de cada site e expõem as
   mesmas funções globais de antes (dbFetchCountsBatch, e621LookupSingleTag...).

   Precisa carregar ANTES de tagmanager_danbooru_core.js e
   tagmanager_e621_core.js (Tag Manager e Prompt Helper).
   Não depende de tagmanager_globals.js.

   Regras (iguais para os dois sites — antes cada correção só ia para um):
   - Toda escrita/remoção real no cache incrementa window[versionVar]
     (gatilho do índice de aliases em tagmanager_alias_bridge.js).
   - Uma tag só vira "unknown" depois que a API RESPONDEU que ela não
     existe (checagem exata). Erro de rede / HTTP != 200 / 429 NUNCA conta
     como "não existe" e nunca grava aliasChecked/wikiChecked.
   - Toda query enviada à API passa por encodeURIComponent.
   - Com a chave mestra do Tag Interrogator desligada
     (window.danbooruInfoEnabled === false) um lote em andamento para.
========================================================================= */

(function () {
    if (typeof window.createBooruClient === 'function') return;

    /* Cor por ORIGEM da tag (autocompletes do Tag Manager, Tag Interrogator e Prompt Helper). */
    window.TAG_SOURCE_COLORS = window.TAG_SOURCE_COLORS || { danbooru: '#4db8ff', e621: '#f48fb1', unknown: '#8a8a8a' };

    const DAY = 24 * 60 * 60 * 1000;
    const TTL = { count: 15 * DAY, wiki: 30 * DAY, alias: 15 * DAY, prune: 180 * DAY };
    const KEEPALIVE_MAX = 60 * 1024;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function isLocalHost() {
        if (typeof window.MAT_IS_LOCAL === 'boolean') return window.MAT_IS_LOCAL;
        return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
    }
    window._booruIsLocalHost = isLocalHost;

    function queueLocalWrite(fn) {
        if (typeof window._queueLocalCacheWrite === 'function') return window._queueLocalCacheWrite(fn);
        return Promise.resolve().then(fn).catch(() => {});
    }

    async function postLocalCache(file, data) {
        const body = JSON.stringify({ file, data });
        await queueLocalWrite(async () => {
            try {
                await fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            } catch (e) { console.warn('[Booru] Could not save', file, e); }
        });
    }

    // Ao fechar a aba: keepalive só para corpos pequenos (limite de 64 KB do navegador).
    function postLocalCacheOnUnload(file, data) {
        const body = JSON.stringify({ file, data });
        try {
            fetch('/api/save_local_cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < KEEPALIVE_MAX });
        } catch (e) {}
    }

    const tagsArray = data => Array.isArray(data) ? data : ((data && data.tags) || []);
    const toKey = t => String(t || '').trim().toLowerCase().replace(/_/g, ' ');
    const toApi = t => String(t || '').trim().toLowerCase().replace(/ /g, '_');
    const wildcard = q => encodeURIComponent('*' + toApi(q) + '*');
    const cleanWiki = body => {
        const clean = String(body || '').replace(/\[.*?\]/g, '').trim();
        return clean.slice(0, 800) + (clean.length > 800 ? '...' : '');
    };

    /* ---------- TAGS DESCONHECIDAS (lista compartilhada pelos dois sites) ----------
       window.unknownTagsCache[key] = { ts, danbooru?, dbVerified?, e621?, e621Verified? } */
    window.unknownTagsCache = window.unknownTagsCache || {};
    window.unknownTagsLoaded = window.unknownTagsLoaded || false;
    let _unknownLoadPromise = null;

    window.loadUnknownTags = async function () {
        if (window.unknownTagsLoaded) return;
        if (_unknownLoadPromise) return _unknownLoadPromise;
        _unknownLoadPromise = (async () => {
            if (isLocalHost()) {
                try {
                    const res = await fetch('/local/unknown_tags.json?t=' + Date.now(), { cache: 'no-store' });
                    if (res.ok) window.unknownTagsCache = Object.assign(window.unknownTagsCache, await res.json());
                } catch (e) {}
            } else if (typeof window.getSetting === 'function') {
                const stored = await window.getSetting('unknown_tags_cache', null);
                if (stored) window.unknownTagsCache = Object.assign(window.unknownTagsCache, stored);
            }
            window.unknownTagsLoaded = true;
        })();
        return _unknownLoadPromise;
    };

    let _unknownSaveTimer = null;
    window.saveUnknownTags = async function () {
        if (isLocalHost()) {
            await postLocalCache('local/unknown_tags.json', window.unknownTagsCache);
        } else if (typeof window.saveSetting === 'function') {
            await window.saveSetting('unknown_tags_cache', window.unknownTagsCache);
        }
    };
    // Vários markUnknown seguidos num lote viram 1 gravação só.
    function scheduleUnknownSave() {
        clearTimeout(_unknownSaveTimer);
        _unknownSaveTimer = setTimeout(() => { _unknownSaveTimer = null; window.saveUnknownTags(); }, 800);
    }
    const flushUnknown = (unload) => {
        if (!_unknownSaveTimer) return;
        clearTimeout(_unknownSaveTimer); _unknownSaveTimer = null;
        if (unload && isLocalHost()) postLocalCacheOnUnload('local/unknown_tags.json', window.unknownTagsCache);
        else window.saveUnknownTags();
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUnknown(false); });
    window.addEventListener('pagehide', () => flushUnknown(true));

    /* =====================================================================
       FACTORY
       cfg = {
         id, label,                     'danbooru' / 'Danbooru'
         host: () => 'danbooru.donmai.us',
         cacheVar, versionVar,          'danbooruCache', '_danbooruCacheVersion'
         localModeVar,                  'isDanbooruLocalMode'
         localFile, settingKey,         'local/danbooru_cache.json', 'danbooru_tag_cache'
         unknownFlag, verifiedFlag,     'danbooru', 'dbVerified'
         migrationKey,                  setting key da migração única dos unknown antigos
         cancelVar,                     '_dbBackgroundScanCancelled'
         batchCounts,                   true = search[name_comma] em lotes de 50
         delays: { batch, single, alias, exists, wiki }
       }
    ===================================================================== */
    window.createBooruClient = function (cfg) {
        const D = Object.assign({ batch: 800, single: 350, alias: 350, exists: 350, wiki: 350 }, cfg.delays || {});
        const host = () => cfg.host();
        const cache = () => (window[cfg.cacheVar] = window[cfg.cacheVar] || {});
        const bump = () => { window[cfg.versionVar] = (window[cfg.versionVar] || 0) + 1; };
        const isLocalMode = () => !!window[cfg.localModeVar];
        const enabled = () => window.danbooruInfoEnabled !== false;
        const cancelled = () => !!window[cfg.cancelVar] || !enabled();
        const put = (key, patch) => { cache()[key] = Object.assign({}, cache()[key] || {}, patch); bump(); return cache()[key]; };
        const log = (...a) => console.log(`[${cfg.label}]`, ...a);

        let queue = Promise.resolve();
        function queueBatch(fn) {
            const run = () => fn().catch(e => { console.warn(`[${cfg.label} API]`, e); });
            queue = queue.then(run, run);
            return queue;
        }

        /* ---------- unknown ---------- */
        function isUnknown(key) {
            const e = window.unknownTagsCache[key];
            return !!(e && e[cfg.unknownFlag]);
        }
        function markUnknown(key) {
            const e = window.unknownTagsCache[key] = window.unknownTagsCache[key] || { ts: Date.now() };
            e[cfg.unknownFlag] = true;
            e[cfg.verifiedFlag] = true;
            delete cache()[key];
            bump();
            scheduleUnknownSave();
        }
        function unmarkUnknown(key) {
            const e = window.unknownTagsCache[key];
            if (!e) return;
            delete e[cfg.unknownFlag];
            delete e[cfg.verifiedFlag];
            if (!Object.keys(e).some(k => k !== 'ts')) delete window.unknownTagsCache[key];
            bump();
            scheduleUnknownSave();
        }

        /* ---------- persistência ---------- */
        let persistTimer = null;
        async function persist(unload = false) {
            if (isLocalMode()) {
                if (unload) postLocalCacheOnUnload(cfg.localFile, cache());
                else await postLocalCache(cfg.localFile, cache());
            } else if (typeof window.saveSetting === 'function') {
                await window.saveSetting(cfg.settingKey, cache());
            }
        }
        function schedulePersist() {
            clearTimeout(persistTimer);
            persistTimer = setTimeout(() => { persistTimer = null; persist(); }, 800);
        }
        function flushPersist(unload = false) {
            if (!persistTimer) return;
            clearTimeout(persistTimer); persistTimer = null;
            persist(unload);
        }
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPersist(false); });
        window.addEventListener('pagehide', () => flushPersist(true));
        window.addEventListener('beforeunload', () => flushPersist(true));

        /* ---------- API básica ---------- */
        function rowPatch(row, now) {
            return {
                count: parseInt(row.post_count) || 0,
                category: row.category,
                wikiName: row.name,
                isDeprecated: !!row.is_deprecated,
                ts: now
            };
        }

        // { ok:false } = erro | { ok:true, row:null } = não existe | { ok:true, row }
        async function fetchRow(tagName) {
            const wanted = toApi(tagName);
            try {
                const res = await fetch(`https://${host()}/tags.json?search[name]=${encodeURIComponent(wanted)}&limit=1`);
                if (!res.ok) return { ok: false, status: res.status };
                const arr = tagsArray(await res.json());
                const row = arr.find(r => String(r.name || '').toLowerCase() === wanted) || null;
                return { ok: true, row };
            } catch (e) {
                return { ok: false };
            }
        }

        // { ok:false } = erro | { ok:true, aliasTo:null|string }
        async function fetchAlias(tagName) {
            const url = `https://${host()}/tag_aliases.json?search[antecedent_name]=${encodeURIComponent(toApi(tagName))}&search[status]=active&limit=1`;
            try {
                const res = await fetch(url);
                if (!res.ok) {
                    console.warn(`[${cfg.label} Alias] HTTP error`, res.status, res.statusText, 'for', url);
                    return { ok: false };
                }
                const data = await res.json();
                const arr = Array.isArray(data) ? data : [];
                return { ok: true, aliasTo: (arr[0] && arr[0].consequent_name) ? arr[0].consequent_name.replace(/_/g, ' ') : null };
            } catch (e) {
                return { ok: false };
            }
        }

        function getCachedTag(tag) {
            const key = (tag || '').toLowerCase();
            if (isUnknown(key)) {
                return { count: 0, category: 0, isDeprecated: false, aliasChecked: true, wikiChecked: true, hasWikiInfo: false, ts: Date.now(), wikiTs: Date.now() };
            }
            return cache()[key] || null;
        }

        async function resolveAlias(tagName) {
            const key = tagName.toLowerCase();
            const cached = cache()[key];
            if (cached && cached.aliasChecked && (Date.now() - (cached.aliasTs || 0)) < TTL.alias) return cached.aliasTo || null;
            const r = await fetchAlias(tagName);
            if (!r.ok) return (cached && cached.aliasTo) || null; // erro: NÃO grava aliasChecked
            put(key, { aliasChecked: true, aliasTs: Date.now(), aliasTo: r.aliasTo });
            return r.aliasTo;
        }

        /* Infos de 1 tag (usa o cache dentro do TTL).
           strict=false: em erro devolve o que estiver no cache (ou null).
           strict=true:  em erro devolve null; tag inexistente -> { count:0, notFound:true }. */
        async function fetchSingleTagInfo(tagName, force = false, strict = false) {
            const key = tagName.toLowerCase();
            if (isUnknown(key) && !force) return { count: 0, category: 0 };
            const cached = cache()[key];
            if (!force && cached && cached.count !== undefined && (Date.now() - (cached.ts || 0)) < TTL.count) return cached;
            const r = await fetchRow(tagName);
            if (!r.ok) return strict ? null : (cached || null);
            if (r.row) return put(key, rowPatch(r.row, Date.now()));
            return strict ? { count: 0, category: 0, notFound: true } : (cached || null);
        }

        // true = existe (cache atualizado) | false = API confirmou que não existe | null = não deu pra saber
        async function tagExists(tagName) {
            const r = await fetchRow(tagName);
            if (!r.ok) return null;
            if (!r.row) return false;
            put(toKey(tagName), rowPatch(r.row, Date.now()));
            return true;
        }

        /* Resolve as tags com 0 posts: alias -> conta da tag destino;
           sem alias -> checagem exata antes de marcar como unknown. */
        async function resolveZeroCountTags(zeroTags, force) {
            for (const tag of zeroTags) {
                if (!enabled()) break;
                const key = tag.toLowerCase();
                const already = cache()[key];
                if (already && already.aliasChecked && !force) continue;

                const r = await fetchAlias(tag);
                await sleep(D.alias);
                if (!r.ok) continue; // erro de rede/API: tenta no próximo scan
                const now = Date.now();
                if (r.aliasTo) {
                    const info = await fetchSingleTagInfo(r.aliasTo, force);
                    put(key, {
                        count: (info && info.count) || 0,
                        category: (info && info.category) || 0,
                        aliasTo: r.aliasTo, aliasChecked: true, aliasTs: now, isDeprecated: true, ts: now
                    });
                    await sleep(D.single);
                } else {
                    const exists = await tagExists(tag);
                    await sleep(D.exists);
                    if (exists === false) markUnknown(key);
                    else if (exists === true) put(key, { aliasTo: null, aliasChecked: true, aliasTs: now });
                }
            }
        }

        /* ---------- LOTE: contagem + categoria ---------- */
        function fetchCountsBatch(tags, force = false) {
            return queueBatch(async () => {
                const now = Date.now();
                const toFetch = tags.filter(t => {
                    if (!t || t.startsWith('NL:')) return false;
                    const key = t.toLowerCase();
                    if (isUnknown(key) && !force) return false;
                    const c = cache()[key];
                    if (force || !c || c.count === undefined) return true;
                    if (c.count === 0 && !c.wikiName && !c.aliasTo) return true; // placeholder nunca confirmado
                    if (!c.aliasChecked) return true;
                    return (now - (c.ts || 0)) > TTL.count;
                });
                if (toFetch.length === 0) return { fetched: 0 };

                let fetched = 0;
                const zero = [];

                if (cfg.batchCounts) {
                    for (let i = 0; i < toFetch.length; i += 50) {
                        if (!enabled()) break;
                        const chunk = toFetch.slice(i, i + 50);
                        const query = chunk.map(t => encodeURIComponent(toApi(t))).join(',');
                        try {
                            // limit = tamanho do lote (sem ele o Danbooru devolve só 20).
                            const res = await fetch(`https://${host()}/tags.json?search[name_comma]=${query}&limit=${chunk.length}`);
                            if (res.ok) {
                                const found = new Map();
                                tagsArray(await res.json()).forEach(row => {
                                    const key = toKey(row.name);
                                    found.set(key, parseInt(row.post_count) || 0);
                                    put(key, rowPatch(row, now));
                                });
                                chunk.forEach(t => {
                                    const key = t.toLowerCase();
                                    const count = found.get(key) || 0;
                                    if (!found.has(key)) put(key, { count: 0, ts: now });
                                    if (count === 0) zero.push(t);
                                    else put(key, { aliasTo: null, aliasChecked: true, aliasTs: now });
                                });
                                fetched += chunk.length;
                            }
                        } catch (e) {}
                        await sleep(D.batch);
                    }
                } else {
                    for (const tag of toFetch) {
                        if (!enabled()) break;
                        const info = await fetchSingleTagInfo(tag, force, true);
                        await sleep(D.single);
                        if (info === null) continue; // erro: tenta no próximo scan
                        if ((info.count || 0) === 0) zero.push(tag);
                        else put(tag.toLowerCase(), { aliasTo: null, aliasChecked: true, aliasTs: Date.now() });
                        fetched++;
                    }
                }

                await resolveZeroCountTags(zero, force);
                schedulePersist();
                return { fetched };
            });
        }

        /* ---------- wiki de 1 tag ----------
           { ok:false } = erro | { ok:true, hasWikiInfo, description } */
        async function fetchWiki(wikiName) {
            try {
                const res = await fetch(`https://${host()}/wiki_pages/${encodeURIComponent(wikiName)}.json`);
                if (res.status === 404) return { ok: true, hasWikiInfo: false, description: '' };
                if (!res.ok) return { ok: false };
                const data = await res.json();
                if (data && data.body && data.body.trim()) return { ok: true, hasWikiInfo: true, description: cleanWiki(data.body) };
                return { ok: true, hasWikiInfo: false, description: '' };
            } catch (e) {
                return { ok: false };
            }
        }

        /* ---------- LOTE: descrição da wiki ---------- */
        function fetchWikiBatch(tags, force = false, onEachTag, onProgress) {
            return queueBatch(async () => {
                const now = Date.now();
                const toFetch = tags.filter(t => {
                    if (!t || t.startsWith('NL:')) return false;
                    const key = t.toLowerCase();
                    if (isUnknown(key) && !force) return false;
                    const c = cache()[key];
                    if (force || !c || !c.wikiChecked) return true;
                    return (now - (c.wikiTs || 0)) > TTL.wiki;
                });
                if (toFetch.length === 0) return { fetched: 0, found: 0 };

                let processed = 0, found = 0;
                for (const tag of toFetch) {
                    if (cancelled()) break;
                    const key = tag.toLowerCase();
                    const wikiName = (cache()[key] && cache()[key].wikiName) || toApi(tag);
                    const w = await fetchWiki(wikiName);
                    // Só grava wikiChecked quando a API respondeu de verdade (OK ou 404).
                    if (w.ok) put(key, { wikiChecked: true, wikiTs: now, hasWikiInfo: w.hasWikiInfo, description: w.description });
                    if (w.hasWikiInfo) found++;
                    processed++;

                    if (onEachTag) onEachTag(key, !!w.hasWikiInfo);
                    if (onProgress) onProgress(processed, toFetch.length, found);
                    if (processed % 8 === 0) await persist();   // checkpoint de segurança

                    await sleep(D.wiki);
                }
                await persist();
                return { fetched: processed, found };
            });
        }

        /* ---------- BUSCA MANUAL (1 tag) ---------- */
        async function lookupSingleTag(rawTag) {
            const tag = toApi(rawTag);
            const key = toKey(rawTag);
            const now = Date.now();

            if (isUnknown(key)) {
                // A lista de unknown pode estar errada — confirma ao vivo antes.
                const exists = await tagExists(key);
                if (exists === true) unmarkUnknown(key);
                else return { count: 0, category: 0, wikiName: key, hasWikiInfo: false, description: `Unknown custom tag (not on ${cfg.label}).` };
            }

            const cached = cache()[key];
            const fakeZero = !!(cached && cached.count === 0 && !cached.wikiName && !cached.aliasTo);
            const needsBasic = !cached || cached.count === undefined || fakeZero || (now - (cached.ts || 0)) > TTL.count;
            const needsWiki = !cached || !cached.wikiChecked || (now - (cached.wikiTs || 0)) > TTL.wiki;

            if (needsBasic) {
                const r = await fetchRow(tag);
                if (!r.ok) return cache()[key] || null; // erro da API: não conclui nada
                if (r.row) {
                    put(key, rowPatch(r.row, now));
                } else {
                    const a = await fetchAlias(key);
                    if (!a.ok) return cache()[key] || null;
                    if (a.aliasTo) {
                        const info = await fetchSingleTagInfo(a.aliasTo);
                        put(key, {
                            count: (info && info.count) || 0,
                            category: (info && info.category) || 0,
                            wikiName: (info && info.wikiName) || toApi(a.aliasTo),
                            aliasTo: a.aliasTo, aliasChecked: true, aliasTs: now, isDeprecated: true, ts: now
                        });
                    } else {
                        markUnknown(key); // a API respondeu: não existe e não é alias
                        return null;
                    }
                }
            }

            if (needsWiki && cache()[key]) {
                const w = await fetchWiki(cache()[key].wikiName || tag);
                if (w.ok) put(key, { wikiChecked: true, wikiTs: now, hasWikiInfo: w.hasWikiInfo, description: w.description });
            }

            schedulePersist();
            return cache()[key] || null;
        }

        /* ---------- AUTOCOMPLETE ---------- */
        async function searchTagMatches(query, limit = 6) {
            const now = Date.now();
            const queryLower = String(query || '').trim().toLowerCase();
            const localResults = [];
            for (const [key, entry] of Object.entries(cache())) {
                if (key.includes(queryLower)) {
                    localResults.push({
                        name: key, post_count: entry.count || 0, category: entry.category || 0,
                        isAlias: !!entry.aliasTo, aliasTo: entry.aliasTo || null, isDeprecated: !!entry.isDeprecated
                    });
                }
            }
            if (localResults.length >= limit) {
                localResults.sort((a, b) => b.post_count - a.post_count);
                return localResults.slice(0, limit);
            }

            const wc = wildcard(query);
            let directRaw = [];
            try {
                const res = await fetch(`https://${host()}/tags.json?search[name_matches]=${wc}&limit=${limit}&search[order]=count`);
                if (res.ok) directRaw = tagsArray(await res.json());
            } catch (e) {}

            const aliasMap = new Map();
            try {
                const res = await fetch(`https://${host()}/tag_aliases.json?search[antecedent_name_matches]=${wc}&search[status]=active&limit=${Math.max(limit * 3, 20)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data)) data.forEach(a => { if (a.antecedent_name) aliasMap.set(a.antecedent_name, a.consequent_name); });
                }
            } catch (e) {}

            const results = [...localResults];
            const seen = new Set(localResults.map(r => r.name));
            const pushAlias = async (key, consequent) => {
                const to = consequent.replace(/_/g, ' ');
                const info = await fetchSingleTagInfo(to);
                const count = (info && info.count) || 0, category = (info && info.category) || 0;
                put(key, { count, category, aliasTo: to, aliasChecked: true, aliasTs: now, isDeprecated: true, ts: now });
                results.push({ name: key, post_count: count, category, isAlias: true, aliasTo: to, isDeprecated: true });
            };

            for (const t of directRaw) {
                const key = toKey(t.name);
                if (seen.has(key)) continue;
                seen.add(key);
                const aliasTo = aliasMap.get(t.name);
                if (aliasTo) {
                    await pushAlias(key, aliasTo);
                } else {
                    put(key, Object.assign(rowPatch(t, now), { aliasTo: null, aliasChecked: true, aliasTs: now }));
                    results.push({ name: key, post_count: parseInt(t.post_count) || 0, category: t.category, isAlias: false, isDeprecated: !!t.is_deprecated });
                }
            }
            for (const [antecedent, consequent] of aliasMap.entries()) {
                const key = toKey(antecedent);
                if (seen.has(key)) continue;
                seen.add(key);
                await pushAlias(key, consequent);
            }

            const dedup = new Map();
            for (const r of results) {
                const k = r.name.toLowerCase();
                const ex = dedup.get(k);
                if (!ex || (r.isAlias && !ex.isAlias)) dedup.set(k, r);
            }
            const out = Array.from(dedup.values()).sort((a, b) => b.post_count - a.post_count);
            if (out.length > 0) schedulePersist();
            return out.slice(0, limit);
        }

        /* ---------- MANUTENÇÃO ---------- */
        // Online: o cache vive no blob de settings (regravado inteiro) — remove entradas paradas há 180+ dias.
        function pruneOnline() {
            if (isLocalMode()) return;
            const now = Date.now();
            let removed = 0;
            Object.keys(cache()).forEach(key => {
                const e = cache()[key] || {};
                const last = Math.max(e.ts || 0, e.wikiTs || 0, e.aliasTs || 0);
                if (last && (now - last) > TTL.prune) { delete cache()[key]; removed++; }
            });
            if (removed > 0) { bump(); schedulePersist(); log(`Maintenance prune (IndexedDB): removed ${removed} entr(ies) with no activity for 180+ days.`); }
        }

        // Migração única: unknown antigos (sem o selo verifiedFlag) voltam a ser checados.
        async function migrateLegacyUnknown() {
            if (!cfg.migrationKey || typeof window.getSetting !== 'function' || typeof window.saveSetting !== 'function') return;
            try {
                if (await window.getSetting(cfg.migrationKey, false)) return;
                let released = 0;
                Object.keys(window.unknownTagsCache).forEach(k => {
                    const e = window.unknownTagsCache[k];
                    if (e && e[cfg.unknownFlag] && !e[cfg.verifiedFlag]) {
                        delete e[cfg.unknownFlag];
                        if (!Object.keys(e).some(x => x !== 'ts')) delete window.unknownTagsCache[k];
                        released++;
                    }
                });
                if (released > 0) { bump(); await window.saveUnknownTags(); }
                await window.saveSetting(cfg.migrationKey, true);
                log(`Migration: ${released} old "unknown" tag(s) released to be checked again.`);
            } catch (e) {
                console.warn(`[${cfg.label}] Unknown-tags migration failed`, e);
            }
        }

        /* ---------- BOOT ---------- */
        async function boot() {
            if (isLocalHost()) {
                window[cfg.localModeVar] = true;
                let json = {};
                let needsSync = false;
                await window.loadUnknownTags();
                try {
                    const res = await fetch('/' + cfg.localFile + '?t=' + Date.now(), { cache: 'no-store' });
                    if (res.ok) json = await res.json();
                } catch (e) {}

                // Dados antigos que ficaram no IndexedDB antes do modo local existir.
                if (typeof window.getSetting === 'function') {
                    const old = await window.getSetting(cfg.settingKey, null);
                    if (old && Object.keys(old).length > 0) {
                        json = Object.assign(old, json);
                        needsSync = true;
                        if (typeof window.saveSetting === 'function') await window.saveSetting(cfg.settingKey, {});
                    }
                }

                // "count 0, sem alias, sem wikiName" nunca foi confirmado pela API:
                // tira do cache para o próximo scan conferir de novo.
                for (const key of Object.keys(json)) {
                    const e = json[key];
                    if (e && e.count === 0 && e.aliasChecked && !e.aliasTo && !e.wikiName) { delete json[key]; needsSync = true; }
                }

                window[cfg.cacheVar] = Object.assign(window[cfg.cacheVar] || {}, json);
                bump();
                if (needsSync) await persist();
            } else {
                window[cfg.localModeVar] = false;
                await window.loadUnknownTags();
                if (typeof window.getSetting === 'function') {
                    window[cfg.cacheVar] = await window.getSetting(cfg.settingKey, window[cfg.cacheVar] || {});
                    bump();
                    pruneOnline();
                }
            }
            await migrateLegacyUnknown();
        }

        const client = {
            id: cfg.id, label: cfg.label, host, cache, bump,
            isUnknown, markUnknown, unmarkUnknown,
            getCachedTag, resolveAlias, fetchSingleTagInfo, tagExists,
            fetchCountsBatch, fetchWikiBatch, lookupSingleTag, searchTagMatches,
            persist, schedulePersist, flushPersist, boot
        };
        if (cfg.autoBoot !== false) window.addEventListener('DOMContentLoaded', () => boot());
        return client;
    };
})();
