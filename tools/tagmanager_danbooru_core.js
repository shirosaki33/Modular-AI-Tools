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
     wikiChecked, wikiTs, hasWikiInfo, description }  <- wiki (opcional)

   IMPORTANTE: precisa ser carregado DEPOIS de tagmanager_db.js (usa
   window.getSetting/saveSetting) e ANTES de tagmanager_caption_tag.js,
   tagmanager_ui_core.js e tagmanager_danbooru_panel.js.
========================================================================= */

window.danbooruCache = window.danbooruCache || {};

const DB_COUNT_TTL = 15 * 24 * 60 * 60 * 1000;  // 15 dias (contagem/categoria)
const DB_WIKI_TTL   = 30 * 24 * 60 * 60 * 1000; // 30 dias (descrição muda menos)

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
            return (now - (cached.ts || 0)) > DB_COUNT_TTL;
        });
        if (toFetch.length === 0) return { fetched: 0 };

        const chunkSize = 50;
        let fetchedCount = 0;

        for (let i = 0; i < toFetch.length; i += chunkSize) {
            const chunk = toFetch.slice(i, i + chunkSize);
            const query = chunk.map(t => encodeURIComponent(t.replace(/ /g, '_'))).join(',');
            try {
                const res = await fetch(`https://danbooru.donmai.us/tags.json?search[name_comma]=${query}`);
                if (res.ok) {
                    const data = await res.json();
                    chunk.forEach(t => {
                        const key = t.toLowerCase();
                        window.danbooruCache[key] = { ...(window.danbooruCache[key] || {}), count: 0, ts: now };
                    });
                    data.forEach(dt => {
                        const key = dt.name.replace(/_/g, ' ').toLowerCase();
                        window.danbooruCache[key] = {
                            ...(window.danbooruCache[key] || {}),
                            count: parseInt(dt.post_count) || 0,
                            category: dt.category,
                            wikiName: dt.name,
                            ts: now
                        };
                    });
                    fetchedCount += chunk.length;
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 800));
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
                return null; // tag não existe no Danbooru
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

/* ---------- AUTOCOMPLETE (name_matches) ----------
   Fica FORA da fila de lote (precisa responder rápido enquanto o
   usuário digita), mas grava no MESMO cache compartilhado — uma tag já
   vista aqui não precisa ser buscada de novo pelo Scan/Sync. Persiste
   com debounce (não a cada tecla) pra não martelar o IndexedDB. */
let _dbAutocompleteSaveTimer = null;
function dbScheduleAutocompleteSave() {
    clearTimeout(_dbAutocompleteSaveTimer);
    _dbAutocompleteSaveTimer = setTimeout(() => { dbPersistCache(); }, 1500);
}

window.dbSearchTagMatches = async function (query, limit = 6) {
    try {
        const res = await fetch(`https://danbooru.donmai.us/tags.json?search[name_matches]=*${query}*&limit=${limit}&search[order]=count`);
        if (!res.ok) return [];
        const data = await res.json();
        const now = Date.now();
        data.forEach(t => {
            const key = t.name.replace(/_/g, ' ').toLowerCase();
            window.danbooruCache[key] = {
                ...(window.danbooruCache[key] || {}),
                count: parseInt(t.post_count) || 0,
                category: t.category,
                wikiName: t.name,
                ts: now
            };
        });
        if (data.length > 0) dbScheduleAutocompleteSave();
        return data;
    } catch (e) { return []; }
};

window.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.getSetting === 'function') {
        window.danbooruCache = await window.getSetting('danbooru_tag_cache', window.danbooruCache || {});
    }
});