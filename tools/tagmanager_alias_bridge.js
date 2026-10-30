/* =========================================================================
   ALIAS BRIDGE MANAGER (Background Processing + Custom Colors)
   ---------------------------------------------------------------------
   Unifica o preview reverso de aliases (Danbooru e e621).
   Cores = window.TAG_SOURCE_COLORS (Danbooru azul, e621 rosa).

   - O índice é reconstruído quando window._danbooruCacheVersion /
     window._e621CacheVersion mudam (incrementados a cada escrita real no
     cache), não pelo tamanho do objeto.
   - Cada fonte usa o PRÓPRIO limite configurado (aliasPreviewMaxCount /
     e621AliasPreviewMaxCount) e os toggles individuais (showAliasPreview /
     e621ShowAliasPreview).
   - Merge por intercalação (round-robin): 1 alias do Danbooru, 1 do e621...
   - Nomes de tag entram no HTML escapados (window.escHTML).
========================================================================= */

window._aliasIndex = {
    danbooru: new Map(),
    e621: new Map(),
    lastDbVersion: -1,
    lastE6Version: -1
};

function _buildReverseAliasMap(cache) {
    const map = new Map();
    const keys = Object.keys(cache || {});
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const entry = cache[k];
        if (entry && entry.aliasTo) {
            const target = entry.aliasTo.toLowerCase();
            if (!map.has(target)) map.set(target, []);
            map.get(target).push(k);
        }
    }
    return map;
}

// Roda de forma totalmente invisível em segundo plano
window._rebuildAliasIndexBackground = function() {
    const dbVersion = window._danbooruCacheVersion || 0;
    const e6Version = window._e621CacheVersion || 0;

    if (dbVersion !== window._aliasIndex.lastDbVersion) {
        window._aliasIndex.danbooru = _buildReverseAliasMap(window.danbooruCache);
        window._aliasIndex.lastDbVersion = dbVersion;
    }
    if (e6Version !== window._aliasIndex.lastE6Version) {
        window._aliasIndex.e621 = _buildReverseAliasMap(window.e621Cache);
        window._aliasIndex.lastE6Version = e6Version;
    }
};

// Sem timer: o índice é conferido (O(1), 2 inteiros) na hora da consulta e
// só é reconstruído se algum cache mudou desde a última vez.

window.computeCombinedReverseAliasesForTag = function (tagLower) {
    window._rebuildAliasIndexBackground();
    const dbEnabled = window.showAliasPreview !== false;
    const e6Enabled = window.e621ShowAliasPreview !== false;

    const danbooruAliases = dbEnabled
        ? (window._aliasIndex.danbooru.get(tagLower) || []).slice().sort((a, b) => a.localeCompare(b))
        : [];
    const e621Aliases = e6Enabled
        ? (window._aliasIndex.e621.get(tagLower) || []).slice().sort((a, b) => a.localeCompare(b))
        : [];

    const dbMax = window.aliasPreviewMaxCount || 5;
    const e6Max = window.e621AliasPreviewMaxCount || 5;

    const combined = [];
    const seen = new Set();
    let di = 0, ei = 0, dbTaken = 0, e6Taken = 0;

    while ((di < danbooruAliases.length && dbTaken < dbMax) || (ei < e621Aliases.length && e6Taken < e6Max)) {
        if (di < danbooruAliases.length && dbTaken < dbMax) {
            const tag = danbooruAliases[di++];
            const key = tag.toLowerCase();
            if (!seen.has(key)) { seen.add(key); combined.push({ tag, source: 'danbooru' }); dbTaken++; }
        }
        if (ei < e621Aliases.length && e6Taken < e6Max) {
            const tag = e621Aliases[ei++];
            const key = tag.toLowerCase();
            if (!seen.has(key)) { seen.add(key); combined.push({ tag, source: 'e621' }); e6Taken++; }
        }
    }

    combined.sort((a, b) => a.tag.localeCompare(b.tag));
    return combined;
};

window.renderCombinedAliasPreviewHTML = function (tagLower) {
    if ((window.showAliasPreview === false) && (window.e621ShowAliasPreview === false)) return '';

    const aliases = window.computeCombinedReverseAliasesForTag(tagLower);
    if (aliases.length === 0) return '';

    const esc = (v) => (typeof window.escHTML === 'function' ? window.escHTML(v) : String(v));
    const titleList = esc(aliases.map(a => a.tag).join(', '));
    const aliasSpans = aliases.map(item => {
        const c = window.TAG_SOURCE_COLORS || { danbooru: '#4db8ff', e621: '#f48fb1' };
        const color = item.source === 'e621' ? c.e621 : c.danbooru;
        return `<span style="color:${color}; pointer-events:none;">${esc(item.tag)}</span>`;
    });

    return `<span class="tag-alias-reverse-list" title="Alias tag(s) pointing to this tag: ${titleList}">⟵ ${aliasSpans.join(', ')}</span>`;
};


/* ---------- FONTE PRINCIPAL DOS ALIASES ----------
   window.aliasPrimarySource (Tag Interrogator → ↪️ Alias tags → "Main alias source"):
   - 'danbooru'      (padrão) Danbooru manda. O alias do e621 só é usado quando o
                     Danbooru NÃO conhece a tag. Se a tag é uma tag principal válida
                     no Danbooru, o alias do e621 é ignorado.
   - 'danbooru-only' só aliases do Danbooru; os do e621 nunca são sugeridos.
   - 'e621'          e621 primeiro, Danbooru como reserva. */
window.getAliasPrimarySource = function () {
    const v = window.aliasPrimarySource;
    return v === 'danbooru-only' || v === 'e621' ? v : 'danbooru';
};

// Tag principal válida no Danbooru (existe, tem posts/wiki e não é alias).
window.isDanbooruMainTag = function (key, entry) {
    const k = String(key || '').trim().replace(/_/g, ' ').toLowerCase();
    const db = entry !== undefined ? entry : (window.danbooruCache ? window.danbooruCache[k] : null);
    if (!db || db.aliasTo) return false;
    if (typeof window.isTagUnknownDb === 'function' && window.isTagUnknownDb(k)) return false;
    return (db.count || 0) > 0 || !!db.wikiName;
};

/* Pode usar o alias do e621 para esta tag? (dbIsMain = o Danbooru a conhece como principal) */
window.allowE621Alias = function (dbIsMain) {
    if (!window.showE621) return false;
    const mode = window.getAliasPrimarySource();
    if (mode === 'danbooru-only') return false;
    if (mode === 'e621') return true;
    return !dbIsMain;
};

/* ---------- ALIAS DE UMA TAG (para as listas Active Image / All Dataset Tags) ----------
   Segue a "Main alias source" acima.
   Retorna null ou { aliasTo, source: 'danbooru'|'e621', convertible }.
   convertible segue a opção "Click alias tag to convert it globally" DAQUELE site
   (popout do Tag Interrogator → ↪️ Alias tags). */
window.getTagAliasInfo = function (tag) {
    if (!window.showDanbooruCounts || !tag) return null;
    const key = String(tag).toLowerCase();
    const db = window.danbooruCache ? (window.danbooruCache[key] || window.danbooruCache[tag]) : null;
    const dbAlias = (db && db.aliasTo) ? { aliasTo: db.aliasTo, source: 'danbooru', convertible: window.enableAliasConvertClick !== false } : null;

    let e6Alias = null;
    if (window.allowE621Alias(window.isDanbooruMainTag(key, db || null))) {
        const e6 = window.e621Cache ? (window.e621Cache[key] || window.e621Cache[tag]) : null;
        if (e6 && e6.aliasTo) e6Alias = { aliasTo: e6.aliasTo, source: 'e621', convertible: window.e621EnableAliasConvertClick !== false };
    }
    return window.getAliasPrimarySource() === 'e621' ? (e6Alias || dbAlias) : (dbAlias || e6Alias);
};

/* HTML da seta ➜ e do ícone de info do alias (mesmo visual nas duas listas). */
window.renderTagAliasParts = function (info) {
    if (!info) return { arrow: '', icon: '', nameAttrs: '', nameClass: '' };
    const esc = (v) => (typeof window.escHTML === 'function' ? window.escHTML(v) : String(v));
    const to = esc(info.aliasTo);
    const site = info.source === 'e621' ? 'e621' : 'Danbooru';
    const conv = info.convertible ? ' tag-name-convertible' : '';
    const title = info.convertible ? `Click to convert this alias tag globally to '${to}'` : `${site} redirects this tag to '${to}'`;
    const iconCls = info.source === 'e621' ? 'tag-e621-info' : 'tag-db-info';
    const iconChar = info.source === 'e621' ? '❔' : '❓';
    return {
        arrow: `<span class="tag-alias-arrow${conv}" title="${title}">➜ ${to}</span>`,
        icon: `<span class="tag-alias-info-icon ${iconCls}" data-alias-source="${info.source}" title="View ${site} alias tag info">${iconChar}</span>`,
        nameClass: conv,
        nameAttrs: info.convertible ? ` title="Click to convert this alias tag globally to &quot;${to}&quot;"` : ''
    };
};

/* Liga o clique do ícone de info e da conversão numa linha já montada. */
window.bindTagAliasRow = function (row, tag, info) {
    if (!row || !info) return;
    const icon = row.querySelector('.tag-alias-info-icon');
    if (icon) icon.onclick = (e) => {
        e.stopPropagation();
        if (info.source === 'e621') { if (typeof window.openE621TagInfoPopout === 'function') window.openE621TagInfoPopout(info.aliasTo); }
        else if (typeof window.openDanbooruTagInfoPopout === 'function') window.openDanbooruTagInfoPopout(info.aliasTo, tag);
    };
    if (info.convertible) row.querySelectorAll('.tag-name-convertible').forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            if (info.source === 'e621' && typeof window.e621ConvertAliasTagGlobally === 'function') window.e621ConvertAliasTagGlobally(tag, info.aliasTo);
            else window.convertAliasTagGlobally(tag, info.aliasTo);
        };
    });
};
