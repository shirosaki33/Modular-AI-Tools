/* =========================================================================
   DANBOORU / E621 AUTOCOMPLETE
   ---------------------------------------------------------------------
   Caixinha de sugestões que aparece ao digitar num input de tag
   (active/master/preset/replace). As duas fontes são consultadas pelas
   funções dos cores (window.dbSearchTagMatches / window.e621SearchTagMatches),
   que já usam o cache compartilhado e resolvem aliases.

   CORES: só 3, uma por origem (window.TAG_SOURCE_COLORS, booru_core):
   - Danbooru (azul)  — também quando a tag existe nos dois sites
   - e621 / e926 (rosa)
   - desconhecida (cinza) — não existe em nenhum dos dois (ex.: tag só do dataset)

   ORDEM: 4 do Danbooru primeiro, depois 4 do e621 (ver fetchBooruSuggestions).
   Tags com 0 posts / sem link só aparecem (em cinza) quando nenhum dos dois
   sites achou nada.

   Chave mestra: com "Enable Tag Interrogator" desligado
   (window.danbooruInfoEnabled === false) NENHUMA consulta à API é feita.
   Todo texto vindo da API/tags entra no HTML via esc().
========================================================================= */

const _acEsc = (v) => (typeof window.escHTML === 'function' ? window.escHTML(v) : String(v));

window.addEventListener('DOMContentLoaded', () => {
    setupDanbooruAutocomplete('active-add-input'); setupDanbooruAutocomplete('master-add-input');
    setupDanbooruAutocomplete('preset-add-input'); setupDanbooruAutocomplete('replace-new-tag', 'down');
});

window.autocompleteUsedOnly = { active: false, master: false, replace: false };
const AUTOCOMPLETE_SCOPE_BY_INPUT = { 'active-add-input': 'active', 'master-add-input': 'master', 'replace-new-tag': 'replace' };

window.applyAutocompleteButtonState = function(scope) {
    const btn = document.getElementById(`btn-${scope}-autocomplete-mode`);
    if (!btn) return;
    if (window.autocompleteUsedOnly[scope]) {
        btn.textContent = '📦'; btn.classList.add('active');
        btn.title = 'Autocomplete: showing only tags already used in this dataset';
    } else {
        btn.textContent = '🌐'; btn.classList.remove('active');
        btn.title = 'Autocomplete: showing Danbooru / e621 suggestions';
    }
};

window.toggleAutocompleteMode = function(scope) {
    window.autocompleteUsedOnly[scope] = !window.autocompleteUsedOnly[scope];
    window.applyAutocompleteButtonState(scope);
    if (typeof window.saveSetting === 'function') window.saveSetting('autocomplete-used-only-' + scope, window.autocompleteUsedOnly[scope]);
};

/* ---------- ORIGEM DE UMA TAG (só olha os caches, sem rede) ---------- */
const _acKnown = (e) => !!(e && (e.count > 0 || e.aliasTo || e.wikiName));

window.getTagSource = function (tag) {
    const key = String(tag || '').trim().replace(/_/g, ' ').toLowerCase();
    if (!key) return 'unknown';
    const dbUnknown = typeof window.isTagUnknownDb === 'function' && window.isTagUnknownDb(key);
    const e6Unknown = typeof window.isTagUnknownE621 === 'function' && window.isTagUnknownE621(key);
    if (!dbUnknown && _acKnown(window.danbooruCache && window.danbooruCache[key])) return 'danbooru';
    if (window.showE621 && !e6Unknown && _acKnown(window.e621Cache && window.e621Cache[key])) return 'e621';
    return 'unknown';
};

function _acColor(source) {
    const c = window.TAG_SOURCE_COLORS || { danbooru: '#4db8ff', e621: '#f48fb1', unknown: '#8a8a8a' };
    return c[source] || c.unknown;
}

function getUsedTagSuggestions(query) {
    const counts = new Map();
    const files = (typeof imageFiles !== 'undefined') ? imageFiles : [];
    files.forEach(img => {
        if (img.hidden || !img.content) return;
        img.content.split(',').forEach(t => {
            const cleanTag = t.trim();
            if (!cleanTag) return;
            counts.set(cleanTag, (counts.get(cleanTag) || 0) + 1);
        });
    });
    return Array.from(counts.entries()).filter(([tag]) => tag.toLowerCase().includes(query)).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

/* =========================================================================
   SUGESTÕES DIVIDIDAS: 4 Danbooru + 4 e621 (window.fetchBooruSuggestions)
   ---------------------------------------------------------------------
   - Danbooru SEMPRE primeiro (mesmo com menos posts que as do e621).
   - O bloco e621 só mostra tags que NÃO estão no bloco Danbooru; uma tag
     do e621 que também existe no Danbooru fica azul (Danbooru manda).
   - Se um site trouxer menos de 4, o outro completa até 8 no total.
   - Sem e621 ligado (showE621 = false): até 8 do Danbooru.
   - Só entram tags confirmadas (post_count > 0 ou alias com destino
     válido). Nada com "0" e sem link aparece aqui — tags desconhecidas
     só aparecem no fallback (cinza) quando nenhum site achou nada.
   Usado também pelo autocomplete do Tag Interrogator (danbooru_panel).
========================================================================= */
window.AUTOCOMPLETE_PER_SOURCE = window.AUTOCOMPLETE_PER_SOURCE || 4;

function _acNormalize(t, source, dbMainKeys) {
    const name = String(t.name || '').replace(/_/g, ' ');
    const key = name.toLowerCase();
    // e621 alias segue a "Main alias source" (padrão: Danbooru manda).
    const dbMain = source === 'e621' && (dbMainKeys.has(key) || (window.isDanbooruMainTag ? window.isDanbooruMainTag(key) : false));
    const useAlias = !!t.isAlias && !!t.aliasTo && (source !== 'e621' || !window.allowE621Alias || window.allowE621Alias(dbMain));
    return {
        name, key,
        post_count: parseInt(t.post_count) || 0,
        isAlias: useAlias,
        aliasTo: useAlias ? String(t.aliasTo).replace(/_/g, ' ') : null,
        aliasSource: useAlias ? source : null,
        isDeprecated: useAlias && !!t.isDeprecated,
        group: source,
        sources: [source]
    };
}

function _acValid(x) { return x && x.name && (x.post_count > 0 || (x.isAlias && x.aliasTo)); }

window.fetchBooruSuggestions = async function (val, perSource) {
    const per = perSource || window.AUTOCOMPLETE_PER_SOURCE || 4;
    const total = per * 2;
    const useE6 = !!window.showE621 && typeof window.e621SearchTagMatches === 'function';
    // Pede mais que 4 de cada: tags repetidas entre os sites são descartadas do bloco e621.
    const fetchN = per + 4;
    const [dbRaw, e6Raw] = await Promise.all([
        typeof window.dbSearchTagMatches === 'function' ? window.dbSearchTagMatches(val, useE6 ? fetchN : total + 2).catch(() => []) : Promise.resolve([]),
        useE6 ? window.e621SearchTagMatches(val, fetchN).catch(() => []) : Promise.resolve([])
    ]);

    const dbList = [];
    const dbKeys = new Set();
    (dbRaw || []).forEach(t => {
        const x = _acNormalize(t, 'danbooru', dbKeys);
        if (!_acValid(x) || dbKeys.has(x.key)) return;
        dbKeys.add(x.key); dbList.push(x);
    });
    dbList.sort((a, b) => b.post_count - a.post_count);

    const e6List = [];
    const e6Keys = new Set();
    (e6Raw || []).forEach(t => {
        const x = _acNormalize(t, 'e621', dbKeys);
        if (!_acValid(x) || e6Keys.has(x.key)) return;
        e6Keys.add(x.key);
        const dbTwin = dbList.find(d => d.key === x.key);
        if (dbTwin) { if (!dbTwin.sources.includes('e621')) dbTwin.sources.push('e621'); return; }
        // Existe no Danbooru (cache confirmado) mas não veio na busca: continua no bloco e621, cor azul.
        if (typeof window.getTagSource === 'function' && window.getTagSource(x.key) === 'danbooru') x.sources.unshift('danbooru');
        e6List.push(x);
    });
    e6List.sort((a, b) => b.post_count - a.post_count);

    if (!useE6) return dbList.slice(0, total);

    let dbTake = Math.min(per, dbList.length);
    let e6Take = Math.min(per, e6List.length);
    // Backfill: o site que tem mais completa o que faltou no outro.
    if (dbTake < per) e6Take = Math.min(e6List.length, total - dbTake);
    if (e6Take < per) dbTake = Math.min(dbList.length, total - e6Take);
    return dbList.slice(0, dbTake).concat(e6List.slice(0, e6Take));
};

/* Cor da linha: azul se existe no Danbooru, rosa se só no e621. */
window.suggestionColor = function (t) {
    return _acColor(t.sources && t.sources.includes('danbooru') ? 'danbooru' : 'e621');
};

/* Divisória fina entre o bloco Danbooru e o bloco e621. */
window.makeSuggestionDivider = function (label) {
    const d = document.createElement('div');
    d.className = 'db-sugg-divider';
    d.textContent = label;
    return d;
};

(function injectAcStyle() {
    if (document.getElementById('ac-split-style')) return;
    const st = document.createElement('style');
    st.id = 'ac-split-style';
    st.textContent = `.db-sugg-divider{font-size:9px;font-weight:bold;letter-spacing:.6px;text-transform:uppercase;color:#666;padding:3px 8px 2px;border-top:1px solid #2a2a2a;pointer-events:none;user-select:none;}
.db-sugg-divider:first-child{border-top:none;}
.db-sugg-item.ac-unknown{opacity:.75;}`;
    (document.head || document.documentElement).appendChild(st);
})();

function setupDanbooruAutocomplete(inputId, direction = 'up') {
    const esc = _acEsc;
    const input = document.getElementById(inputId);
    if(!input) return;
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative'; wrapper.style.flex = 'none';
    input.parentNode.insertBefore(wrapper, input); wrapper.appendChild(input);
    const suggBox = document.createElement('div');
    suggBox.className = direction === 'down' ? 'db-autocomplete direction-down' : 'db-autocomplete';
    suggBox.style.display = 'none'; wrapper.appendChild(suggBox);

    /* Tags já usadas no dataset. notFoundHeader = true quando é o fallback
       (nenhum site achou nada): aí as desconhecidas aparecem em cinza. */
    function renderUsedOnlySuggestions(query, notFoundHeader = false) {
        const matches = getUsedTagSuggestions(query);
        suggBox.innerHTML = '';
        if (matches.length === 0) { suggBox.style.display = 'none'; return; }
        if (notFoundHeader) suggBox.appendChild(window.makeSuggestionDivider('Not found on Danbooru / e621 — dataset tags'));
        matches.forEach(([tag, count]) => {
            const div = document.createElement('div'); div.className = 'db-sugg-item';
            const source = window.getTagSource(tag);
            if (source === 'unknown') div.classList.add('ac-unknown');
            const color = _acColor(source);
            div.innerHTML = `<span style="color:${color}; font-weight:bold;">${esc(tag)}</span><span style="color:#666;" title="Images in this dataset using this tag">${count}×</span>`;
            div.onclick = () => { input.value = tag; suggBox.style.display = 'none'; input.focus(); };
            suggBox.appendChild(div);
        });
        suggBox.style.display = 'block';
    }

    function renderBooruItem(t) {
        const div = document.createElement('div'); div.className = 'db-sugg-item';
        const color = window.suggestionColor(t);
        const displayName = t.name;
        const aliasToSpaced = t.isAlias && t.aliasTo ? t.aliasTo : '';

        // Seta ➜ do alias sempre dourada (classe .db-alias-arrow) = "tem substituição para a tag principal".
        const arrowHtml = t.isAlias ? ` <span class="db-alias-arrow">➜ ${esc(aliasToSpaced)}</span>` : '';
        const infoHtml = (t.isAlias && t.aliasSource === 'danbooru') ? `<span class="tag-alias-info-icon" title="View info about the original tag">❓</span>` : '';
        const countHtml = t.post_count > 0 ? Number(t.post_count).toLocaleString() : 'Alias';
        const bothTitle = t.sources.length > 1 ? ' title="Found on Danbooru and e621"' : '';

        div.innerHTML = `<span style="color:${color}; font-weight:bold;"${bothTitle}>${esc(displayName)}${arrowHtml}</span>
            <div style="display:flex; align-items:center; gap:5px;">${infoHtml}<span style="color:#666;">${countHtml}</span></div>`;

        const keepAlias = (t.aliasSource === 'e621' ? window.e621AliasClickBehavior : window.aliasClickBehavior) === 'keep';
        div.onclick = () => {
            input.value = (t.isAlias && aliasToSpaced && !keepAlias) ? aliasToSpaced : displayName;
            suggBox.style.display = 'none'; input.focus();
        };
        const infoIcon = div.querySelector('.tag-alias-info-icon');
        if (infoIcon) infoIcon.onclick = (ev) => {
            ev.stopPropagation();
            if (typeof window.openDanbooruTagInfoPopout === 'function') window.openDanbooruTagInfoPopout(aliasToSpaced, displayName);
        };
        return div;
    }

    let timeout = null;
    let token = 0;
    input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        const rawVal = e.target.value.trim().toLowerCase();
        if(rawVal.length < 2) { suggBox.style.display = 'none'; return; }
        const scope = AUTOCOMPLETE_SCOPE_BY_INPUT[inputId];
        if (window.danbooruInfoEnabled === false || (scope && window.autocompleteUsedOnly[scope])) { renderUsedOnlySuggestions(rawVal); return; }

        const val = rawVal.replace(/ /g, '_');
        const myToken = ++token;
        timeout = setTimeout(async () => {
            try {
                const list = await window.fetchBooruSuggestions(val);
                if (myToken !== token) return; // resposta velha (o usuário continuou digitando)

                // O usuário pode ter desligado a chave mestra enquanto a busca rodava.
                if (window.danbooruInfoEnabled === false) { suggBox.style.display = 'none'; return; }

                suggBox.innerHTML = '';
                if (list.length === 0) { renderUsedOnlySuggestions(rawVal, true); return; }

                const hasBoth = list.some(t => t.group === 'danbooru') && list.some(t => t.group === 'e621');
                let lastGroup = null;
                list.forEach(t => {
                    if (hasBoth && t.group !== lastGroup) {
                        suggBox.appendChild(window.makeSuggestionDivider(t.group === 'danbooru' ? 'Danbooru' : 'e621'));
                        lastGroup = t.group;
                    }
                    suggBox.appendChild(renderBooruItem(t));
                });
                suggBox.style.display = 'block';
            } catch(err) {}
        }, 400);
    });

    document.addEventListener('click', (e) => { if(!wrapper.contains(e.target)) suggBox.style.display = 'none'; });
}
