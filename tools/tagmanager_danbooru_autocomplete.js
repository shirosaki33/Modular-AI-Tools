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

/* Junta Danbooru + e621 numa lista só (nome normalizado com espaço). */
async function fetchCombinedSuggestions(val, limit) {
    const jobs = [
        typeof window.dbSearchTagMatches === 'function' ? window.dbSearchTagMatches(val, limit).catch(() => []) : Promise.resolve([]),
        (window.showE621 && typeof window.e621SearchTagMatches === 'function') ? window.e621SearchTagMatches(val, limit).catch(() => []) : Promise.resolve([])
    ];
    const [dbList, e6List] = await Promise.all(jobs);
    const merged = new Map();
    const add = (list, source) => (list || []).forEach(t => {
        const name = String(t.name || '').replace(/_/g, ' ');
        const key = name.toLowerCase();
        const ex = merged.get(key);
        // e621 alias segue a "Main alias source" (padrão: Danbooru manda).
        const dbMain = source === 'e621' && window.isDanbooruMainTag ? window.isDanbooruMainTag(key) : false;
        const useAlias = !!t.isAlias && (source !== 'e621' || !window.allowE621Alias || window.allowE621Alias(dbMain || (ex && ex.sources.includes('danbooru') && !ex.isAlias)));
        if (!ex) {
            merged.set(key, { name, post_count: t.post_count || 0, isAlias: useAlias, aliasTo: useAlias ? (t.aliasTo || null) : null, aliasSource: useAlias ? source : null, isDeprecated: useAlias && !!t.isDeprecated, sources: [source] });
        } else {
            if (!ex.sources.includes(source)) ex.sources.push(source);
            ex.post_count = Math.max(ex.post_count, t.post_count || 0);
            const e6First = source === 'e621' && window.getAliasPrimarySource && window.getAliasPrimarySource() === 'e621';
            if (useAlias && (!ex.isAlias || e6First)) { ex.isAlias = true; ex.aliasTo = t.aliasTo; ex.aliasSource = source; ex.isDeprecated = true; }
        }
    });
    add(dbList, 'danbooru');
    add(e6List, 'e621');
    return Array.from(merged.values()).sort((a, b) => b.post_count - a.post_count).slice(0, 10);
}

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

    function renderUsedOnlySuggestions(query) {
        const matches = getUsedTagSuggestions(query);
        suggBox.innerHTML = '';
        if (matches.length === 0) { suggBox.style.display = 'none'; return; }
        matches.forEach(([tag, count]) => {
            const div = document.createElement('div'); div.className = 'db-sugg-item';
            const color = _acColor(window.getTagSource(tag));
            div.innerHTML = `<span style="color:${color}; font-weight:bold;">${esc(tag)}</span><span style="color:#666;">${count}</span>`;
            div.onclick = () => { input.value = tag; suggBox.style.display = 'none'; input.focus(); };
            suggBox.appendChild(div);
        });
        suggBox.style.display = 'block';
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
                const list = await fetchCombinedSuggestions(val, 6);
                if (myToken !== token) return; // resposta velha (o usuário continuou digitando)

                // O usuário pode ter desligado a chave mestra enquanto a busca rodava.
                if (window.danbooruInfoEnabled === false) { suggBox.style.display = 'none'; return; }

                suggBox.innerHTML = '';
                if (list.length === 0) { renderUsedOnlySuggestions(rawVal); return; }

                list.forEach(t => {
                    const div = document.createElement('div'); div.className = 'db-sugg-item';
                    const source = t.sources.includes('danbooru') ? 'danbooru' : 'e621';
                    const color = _acColor(source);
                    const displayName = t.name;
                    const aliasToSpaced = t.isAlias && t.aliasTo ? t.aliasTo.replace(/_/g, ' ') : '';

                    // Seta ➜ do alias sempre dourada (classe .db-alias-arrow) = "tem substituição para a tag principal".
                    const arrowHtml = t.isAlias ? ` <span class="db-alias-arrow">➜ ${esc(aliasToSpaced)}</span>` : '';
                    const infoHtml = (t.isAlias && t.aliasSource === 'danbooru') ? `<span class="tag-alias-info-icon" title="View info about the original tag">❓</span>` : '';
                    const countHtml = (t.post_count > 0)
                        ? Number(t.post_count).toLocaleString()
                        : (t.isDeprecated ? 'Deprecated' : '0');
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
                    suggBox.appendChild(div);
                });
                suggBox.style.display = 'block';
            } catch(err) {}
        }, 400);
    });

    document.addEventListener('click', (e) => { if(!wrapper.contains(e.target)) suggBox.style.display = 'none'; });
}
