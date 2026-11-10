/* ===== merged from tagmanager_alias.js ===== */
/* =========================================================================
   DANBOORU ALIAS BEHAVIOR (extraído de tagmanager_caption_tag.js)
   ---------------------------------------------------------------------
   Tudo relacionado a tags-alias (ex: "anime screencap" -> "anime screenshot"):
   - Preferência de clique no autocomplete (substituir vs manter)
   - Feature 1: clicar no nome/seta de uma tag-alias converte ela pra tag
     principal em TODO o dataset (window.convertAliasTagGlobally)
   - Feature 2: preview reverso — mostra ao lado de uma tag "real" quais
     aliases já vistos apontam pra ela. O cálculo e o HTML ficam em
     tagmanager_alias_bridge.js (Danbooru + e621 juntos); aqui só ficam as
     opções liga/desliga e o limite.
   - As opções (liga/desliga, limite) aparecem no popout do Tag Interrogator,
     seção "↪️ Alias tags" (tagmanager_danbooru_panel.js). Aqui ficam só o
     estado (window.*) e as chaves de setting.
========================================================================= */

/* ---------- COMPORTAMENTO AO CLICAR NUMA SUGESTÃO-ALIAS (ex: "anime screencap" -> "anime screenshot") ----------
   'replace' (padrão): clicar na sugestão insere a tag REAL (consequente) — igual ao BooruDatasetTagManager.
   'keep': clicar na sugestão mantém a tag digitada (o alias/depreciada), mas usa o contador da tag real
           tanto no autocomplete quanto depois de salva, na Active Image / All Dataset Tags. */
window.aliasClickBehavior = window.aliasClickBehavior || 'replace';
 
 
/* ---------- FEATURE 1: CONVERTER ALIAS -> TAG PRINCIPAL, GLOBALMENTE ----------
   Clicar no NOME de uma tag-alias (a que mostra a seta ➜ tag real) pergunta
   num popout (confirm) se o usuário quer substituir essa tag pela tag
   principal em TODO o dataset. Não existe "escopo": não importa se o clique
   veio da Active Image ou de All Dataset Tags, a ação é sempre global. */
/* Implementação única usada pelo Danbooru e pelo e621 (tagmanager_e621_alias.js).
   siteLabel só muda o texto do confirm/alerta. */
window.convertAliasTagEverywhere = async function (oldTag, newTag, siteLabel = '') {
    if (!oldTag || !newTag || oldTag === newTag) return;
    if (typeof imageFiles === 'undefined') return;
    const site = siteLabel ? siteLabel + ' ' : '';
    if (!confirm(`Convert ${site}alias tag "${oldTag}" to the main tag "${newTag}" everywhere in this dataset?\n\nThis replaces it on ALL images (not just the current selection/active image).`)) return;

    // Comparação tolerante a maiúsculas/minúsculas e espaços — a tag salva no
    // arquivo pode ter capitalização/espaçamento levemente diferente do que
    // foi resolvido pela API.
    const modifiedFiles = window.TM.tags.replace(window.TM.tags.visibleImages().filter(img => img.type === 'tags'), oldTag, newTag);
    const replacedCount = modifiedFiles.length;

    if (replacedCount === 0) {
        console.warn(`[${site}Alias Convert] Tag not found in any image.`, { oldTag, newTag });
        if (window.showAlert) window.showAlert(`Tag "${oldTag}" not found in this dataset.`, 'warn');
        return;
    }

    if (typeof activeSelectedTags !== 'undefined') activeSelectedTags.delete(oldTag);
    if (typeof masterSelectedTags !== 'undefined') masterSelectedTags.delete(oldTag);
    window.TM.tags.refreshViews();

    await Promise.all(modifiedFiles.map(img => window.saveImageToDisk(img)));
    if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();

    if (window.showAlert) window.showAlert(`Converted ${site}tag "${oldTag}" ➜ "${newTag}" in ${replacedCount} image(s).`, 'success');
};

window.convertAliasTagGlobally = (oldTag, newTag) => window.convertAliasTagEverywhere(oldTag, newTag, '');

/* ---------- FEATURE 1b: LIGA/DESLIGA O "CLIQUE PRA CONVERTER" ----------
   Controla se o nome/seta da tag-alias fica clicável pra conversão global
   (Feature 1). Independente do toggle de Preview Reverso (Feature 2). */
window.enableAliasConvertClick = window.enableAliasConvertClick !== undefined ? window.enableAliasConvertClick : true;

/* ---------- FEATURE 2: PREVIEW REVERSO DE ALIASES ----------
   Ao lado de uma tag "real" (não-alias), mostra quais tags-alias já vistas
   (mesmo cache compartilhado do Danbooru) apontam pra ela — igual ao alias
   mostrando a seta ➜, só que ao contrário. Limitado a N tags (configurável),
   com toggle liga/desliga (popout do Tag Interrogator). */
window.showAliasPreview = window.showAliasPreview !== undefined ? window.showAliasPreview : true;
window.aliasPreviewMaxCount = window.aliasPreviewMaxCount || 5;

window.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.getSetting === 'function') {
        window.aliasClickBehavior = await window.getSetting('alias-click-behavior', 'replace');
        window.enableAliasConvertClick = await window.getSetting('alias-convert-click-enabled', true);
        window.showAliasPreview = await window.getSetting('alias-preview-enabled', true);
        window.aliasPreviewMaxCount = await window.getSetting('alias-preview-max-count', 5);
    }
    // As opções ficam no popout do Tag Interrogator (tagmanager_danbooru_panel.js).
    if (typeof window.syncInterrogatorAliasOptions === 'function') window.syncInterrogatorAliasOptions();
});

/* ===== merged from tagmanager_alias.js ===== */
/* =========================================================================
   E621 ALIAS BEHAVIOR
   ---------------------------------------------------------------------
   Tudo relacionado a tags-alias no e621/e926:
   - Preferência de clique no autocomplete (substituir vs manter)
   - Feature 1: clicar no nome/seta de uma tag-alias converte ela pra tag
     principal em TODO o dataset (window.e621ConvertAliasTagGlobally)
   - Feature 2: preview reverso (cálculo/HTML em tagmanager_alias_bridge.js);
     aqui só ficam as opções liga/desliga e o limite.
   A conversão em si é a mesma do Danbooru: window.convertAliasTagEverywhere
   (tagmanager_danbooru_alias.js).
   - As opções aparecem no popout do Tag Interrogator (seção "↪️ Alias tags").
========================================================================= */

/* ---------- COMPORTAMENTO AO CLICAR NUMA SUGESTÃO-ALIAS ---------- */
window.e621AliasClickBehavior = window.e621AliasClickBehavior || 'replace';
 
 
/* ---------- FEATURE 1: CONVERTER ALIAS -> TAG PRINCIPAL, GLOBALMENTE ---------- */
window.e621ConvertAliasTagGlobally = function (oldTag, newTag) {
    if (typeof window.convertAliasTagEverywhere !== 'function') {
        console.error('[e621 Alias Convert] tagmanager_danbooru_alias.js is not loaded.');
        return Promise.resolve();
    }
    return window.convertAliasTagEverywhere(oldTag, newTag, 'e621');
};

window.e621EnableAliasConvertClick = window.e621EnableAliasConvertClick !== undefined ? window.e621EnableAliasConvertClick : true;

/* ---------- FEATURE 2: PREVIEW REVERSO DE ALIASES ---------- */
window.e621ShowAliasPreview = window.e621ShowAliasPreview !== undefined ? window.e621ShowAliasPreview : true;
window.e621AliasPreviewMaxCount = window.e621AliasPreviewMaxCount || 5;

window.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.getSetting === 'function') {
        window.e621AliasClickBehavior = await window.getSetting('e621-alias-click-behavior', 'replace');
        window.e621EnableAliasConvertClick = await window.getSetting('e621-alias-convert-click-enabled', true);
        window.e621ShowAliasPreview = await window.getSetting('e621-alias-preview-enabled', true);
        window.e621AliasPreviewMaxCount = await window.getSetting('e621-alias-preview-max-count', 5);
    }
    
    // As opções ficam no popout do Tag Interrogator (tagmanager_danbooru_panel.js).
    if (typeof window.syncInterrogatorAliasOptions === 'function') window.syncInterrogatorAliasOptions();
});

/* ===== merged from tagmanager_alias.js ===== */
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
