/* =========================================================================
   DANBOORU API CORE — adaptador do tagmanager_booru_core.js
   ---------------------------------------------------------------------
   Toda a lógica (cache, alias, unknown, wiki, persistência, boot) fica em
   tagmanager_booru_core.js e é a MESMA do e621. Este arquivo só define a
   configuração do Danbooru e mantém os nomes globais de sempre.
   Também é usado pelo Prompt Helper — não depende de tagmanager_globals.js.
========================================================================= */

window.danbooruCache = window.danbooruCache || {};
window.isDanbooruLocalMode = false;
window._danbooruCacheVersion = window._danbooruCacheVersion || 0;

if (typeof window.createBooruClient !== 'function') {
    console.error('[Danbooru] tagmanager_booru_core.js is missing — add <script src="tools/tagmanager_booru_core.js"></script> BEFORE tagmanager_danbooru_core.js.');
} else {
    const DB = window.danbooruClient = window.createBooruClient({
        id: 'danbooru',
        label: 'Danbooru',
        host: () => 'danbooru.donmai.us',
        cacheVar: 'danbooruCache',
        versionVar: '_danbooruCacheVersion',
        localModeVar: 'isDanbooruLocalMode',
        localFile: 'local/danbooru_cache.json',
        settingKey: 'danbooru_tag_cache',
        unknownFlag: 'danbooru',
        verifiedFlag: 'dbVerified',
        migrationKey: 'danbooru_unknown_migrated_v2',
        cancelVar: '_dbBackgroundScanCancelled',
        batchCounts: true,               // search[name_comma], 50 por requisição
        delays: { batch: 800, single: 400, alias: 0, exists: 350, wiki: 350 }
    });

    window.markTagAsUnknownDb       = key => DB.markUnknown(key);
    window.unmarkTagUnknownDb       = key => DB.unmarkUnknown(key);
    window.isTagUnknownDb           = key => DB.isUnknown(key);
    window.dbGetCachedTag           = tag => DB.getCachedTag(tag);
    window.dbResolveAlias           = tag => DB.resolveAlias(tag);
    window.dbFetchCountsBatch       = (tags, force = false) => DB.fetchCountsBatch(tags, force);
    window.dbFetchWikiBatch         = (tags, force = false, onEachTag, onProgress) => DB.fetchWikiBatch(tags, force, onEachTag, onProgress);
    window.dbLookupSingleTag        = raw => DB.lookupSingleTag(raw);
    window.dbSearchTagMatches       = (query, limit = 6) => DB.searchTagMatches(query, limit);
    window._flushDanbooruCachePersist = (useBeacon = false) => DB.flushPersist(useBeacon);
    window.dbTagExists              = tag => DB.tagExists(tag);
    window.dbFetchSingleTagInfo     = (tag, force = false) => DB.fetchSingleTagInfo(tag, force);
}

/* Nomes globais antigos (prompt_helper_tags.js e outros scripts usam). */
function bumpDanbooruCacheVersion() {
    if (window.danbooruClient) window.danbooruClient.bump();
    else window._danbooruCacheVersion = (window._danbooruCacheVersion || 0) + 1;
}
function scheduleDanbooruCachePersist() {
    if (window.danbooruClient) window.danbooruClient.schedulePersist();
}
function dbPersistCache(useBeacon = false) {
    return window.danbooruClient ? window.danbooruClient.persist(useBeacon) : Promise.resolve();
}
function dbWildcardParam(query) {
    return encodeURIComponent('*' + String(query || '').trim().replace(/ /g, '_') + '*');
}
