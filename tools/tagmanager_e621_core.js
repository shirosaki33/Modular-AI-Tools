/* =========================================================================
   E621 API CORE — adaptador do tagmanager_booru_core.js
   ---------------------------------------------------------------------
   Toda a lógica (cache, alias, unknown, wiki, persistência, boot) fica em
   tagmanager_booru_core.js e é a MESMA do Danbooru. Este arquivo só define
   a configuração do e621 (host e621.net / e926.net no modo SFW) e mantém
   os nomes globais de sempre.
   O e621 não aceita lote por nome: as contagens são buscadas 1 tag por vez.
========================================================================= */

window.e621Cache = window.e621Cache || {};
window.isLocalMode = false;
window._e621CacheVersion = window._e621CacheVersion || 0;

window.E621_CAT_COLORS = { 0: "#aaa", 1: "#f9a825", 3: "#ae80ff", 4: "#5bc0de", 5: "#4caf50", 6: "#888", 7: "#888", 8: "#ff8a65" };
window.E621_CAT_LABELS = { 0: "General", 1: "Artist", 3: "Copyright", 4: "Character", 5: "Species", 6: "Invalid", 7: "Meta", 8: "Lore" };

function e621Host() {
    return window.showE621Sfw ? 'e926.net' : 'e621.net';
}

if (typeof window.createBooruClient !== 'function') {
    console.error('[e621] tagmanager_booru_core.js is missing — add <script src="tools/tagmanager_booru_core.js"></script> BEFORE tagmanager_e621_core.js.');
} else {
    const E6 = window.e621Client = window.createBooruClient({
        id: 'e621',
        label: 'e621',
        host: e621Host,
        cacheVar: 'e621Cache',
        versionVar: '_e621CacheVersion',
        localModeVar: 'isLocalMode',
        localFile: 'local/e621_cache.json',
        settingKey: 'e621_tag_cache',
        unknownFlag: 'e621',
        verifiedFlag: 'e621Verified',
        migrationKey: 'e621_unknown_migrated_v2',
        cancelVar: '_e621BackgroundScanCancelled',
        batchCounts: false,
        delays: { single: 350, alias: 350, exists: 350, wiki: 350 }
    });

    window.markTagAsUnknownE621     = key => E6.markUnknown(key);
    window.unmarkTagUnknownE621     = key => E6.unmarkUnknown(key);
    window.isTagUnknownE621         = key => E6.isUnknown(key);
    window.e621GetCachedTag         = tag => E6.getCachedTag(tag);
    window.e621ResolveAlias         = tag => E6.resolveAlias(tag);
    window.e621FetchCountsBatch     = (tags, force = false) => E6.fetchCountsBatch(tags, force);
    window.e621FetchWikiBatch       = (tags, force = false, onEachTag, onProgress) => E6.fetchWikiBatch(tags, force, onEachTag, onProgress);
    window.e621LookupSingleTag      = raw => E6.lookupSingleTag(raw);
    window.e621SearchTagMatches     = (query, limit = 6) => E6.searchTagMatches(query, limit);
    window._flushE621CachePersist   = (useBeacon = false) => E6.flushPersist(useBeacon);
    window.e621TagExists            = tag => E6.tagExists(tag);
    window.e621FetchSingleTagInfo   = (tag, force = false) => E6.fetchSingleTagInfo(tag, force, true);
}

/* Maior contagem entre os dois sites (usado nas listas de tags). */
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

/* Nomes globais antigos (prompt_helper_tags.js e outros scripts usam). */
function bumpE621CacheVersion() {
    if (window.e621Client) window.e621Client.bump();
    else window._e621CacheVersion = (window._e621CacheVersion || 0) + 1;
}
function scheduleE621CachePersist() {
    if (window.e621Client) window.e621Client.schedulePersist();
}
function e621PersistCache(useBeacon = false) {
    return window.e621Client ? window.e621Client.persist(useBeacon) : Promise.resolve();
}
function e621WildcardParam(query) {
    return encodeURIComponent('*' + String(query || '').trim().replace(/ /g, '_') + '*');
}
function e621TagsArray(data) {
    return Array.isArray(data) ? data : ((data && data.tags) || []);
}
