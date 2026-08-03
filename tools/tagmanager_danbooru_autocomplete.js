/* =========================================================================
   DANBOORU / E621 AUTOCOMPLETE (extraído de tagmanager_caption_tag.js)
   ---------------------------------------------------------------------
   Cuida só da caixinha de sugestões que aparece ao digitar num input de
   tag (active/master/preset/replace). Depende de window.dbSearchTagMatches
   (tagmanager_danbooru_core.js) e window.openDanbooruTagInfoPopout
   (tagmanager_danbooru_panel.js), ambos já carregados antes deste arquivo.
========================================================================= */

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
        btn.title = 'Autocomplete: showing full Danbooru list';
    }
};
 
window.toggleAutocompleteMode = function(scope) {
    window.autocompleteUsedOnly[scope] = !window.autocompleteUsedOnly[scope];
    window.applyAutocompleteButtonState(scope);
    if (typeof window.saveSetting === 'function') window.saveSetting('autocomplete-used-only-' + scope, window.autocompleteUsedOnly[scope]);
};
 
function getUsedTagSuggestions(query) {
    const counts = new Map();
    const files = (typeof imageFiles !== 'undefined') ? imageFiles : [];
    files.forEach(img => {
        if (img.hidden || img.type !== 'tags' || !img.content) return;
        img.content.split(',').forEach(t => {
            const cleanTag = t.trim();
            if (!cleanTag) return;
            counts.set(cleanTag, (counts.get(cleanTag) || 0) + 1);
        });
    });
    return Array.from(counts.entries()).filter(([tag]) => tag.toLowerCase().includes(query)).sort((a, b) => b[1] - a[1]).slice(0, 8);
}
 
function setupDanbooruAutocomplete(inputId, direction = 'up') {
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
            div.innerHTML = `<span style="color:#00ff99; font-weight:bold;">${tag}</span><span style="color:#666;">${count}</span>`;
            div.onclick = () => { input.value = tag; suggBox.style.display = 'none'; input.focus(); };
            suggBox.appendChild(div);
        });
        suggBox.style.display = 'block';
    }
 
    let timeout = null;
    input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        const rawVal = e.target.value.trim().toLowerCase();
        if(rawVal.length < 2) { suggBox.style.display = 'none'; return; }
        const scope = AUTOCOMPLETE_SCOPE_BY_INPUT[inputId];
        if (scope && window.autocompleteUsedOnly[scope]) { renderUsedOnlySuggestions(rawVal); return; }
        
        const val = rawVal.replace(/ /g, '_');
        timeout = setTimeout(async () => {
            try {
                let combinedTags = [];
                const dbResults = typeof window.dbSearchTagMatches === 'function' ? await window.dbSearchTagMatches(val, 6) : [];
 
                // dbSearchTagMatches já devolve tudo resolvido: tags reais e tags-alias
                // (ex: "anime screencap" -> "anime screenshot") já com a contagem REAL
                // da tag de destino (consequente) e a informação pra mostrar a seta ➜.
                dbResults.forEach(t => { combinedTags.push({ name: t.name, post_count: t.post_count, category: t.category, isAlias: t.isAlias, aliasTo: t.aliasTo, isDeprecated: t.isDeprecated }); });
 
                if (window.showE621) {
                    const host = window.showE621Sfw ? 'e926.net' : 'e621.net';
                    try {
                        const res = await fetch(`https://${host}/tags.json?search[name_matches]=*${val}*&limit=6&search[order]=count`);
                        if (res.ok) {
                            const data = await res.json();
                            const tagsArr = Array.isArray(data) ? data : (data.tags || []);
                            tagsArr.forEach(t => {
                                const standardizedName = t.name.replace(/_/g, ' ');
                                if (!combinedTags.some(ct => ct.name.replace(/_/g, ' ') === standardizedName)) {
                                    combinedTags.push({ name: t.name, post_count: parseInt(t.post_count) || 0, category: t.category, isAlias: false });
                                }
                            });
                        }
                    } catch(err) {}
                }
 
                if (combinedTags.length === 0) {
                    const cachedMatches = [];
                    if (window.danbooruCache) {
                        Object.keys(window.danbooruCache).forEach(k => {
                            if (k.toLowerCase().includes(rawVal)) {
                                const cachedEntry = window.danbooruCache[k];
                                if (cachedEntry.aliasTo) {
                                    const consequentKey = cachedEntry.aliasTo.toLowerCase();
                                    const consequentInfo = window.danbooruCache[consequentKey];
                                    cachedMatches.push({ name: k, post_count: (consequentInfo && consequentInfo.count) || 0, category: 0, isAlias: true, aliasTo: cachedEntry.aliasTo, isDeprecated: true });
                                } else {
                                    cachedMatches.push({ name: k, post_count: cachedEntry.count, category: 0, isAlias: false, isDeprecated: !!cachedEntry.isDeprecated });
                                }
                            }
                        });
                    }
                    combinedTags = cachedMatches.sort((a,b) => b.post_count - a.post_count).slice(0, 6);
                } else { combinedTags.sort((a,b) => b.post_count - a.post_count); }
 
                suggBox.innerHTML = '';
                if(combinedTags.length === 0) { suggBox.style.display = 'none'; return; }
                
                combinedTags.forEach(t => {
                    const div = document.createElement('div'); div.className = 'db-sugg-item';
                    const color = CAT_COLORS[t.category] || "#aaa";
                    const displayName = t.name.replace(/_/g, ' ');
                    const aliasToSpaced = t.isAlias ? t.aliasTo.replace(/_/g, ' ') : '';
                    
                    const arrowHtml = t.isAlias ? ` <span class="db-alias-arrow">➜ ${aliasToSpaced}</span>` : '';
                    const infoHtml = t.isAlias ? `<span class="tag-alias-info-icon" title="View info about the original tag">❓</span>` : '';
                    const countHtml = (t.post_count > 0)
                        ? Number(t.post_count).toLocaleString()
                        : (t.isDeprecated ? 'Deprecated' : Number(t.post_count).toLocaleString());
                    
                    div.innerHTML = `<span style="color:${color}; font-weight:bold;">${displayName}${arrowHtml}</span>
                        <div style="display:flex; align-items:center; gap:5px;">${infoHtml}<span style="color:#666;">${countHtml}</span></div>`;
                    
                    div.onclick = () => {
                        input.value = (t.isAlias && window.aliasClickBehavior !== 'keep') ? t.aliasTo.replace(/_/g, ' ') : displayName;
                        suggBox.style.display = 'none'; input.focus();
                    };
                    if (t.isAlias) {
                        const infoIcon = div.querySelector('.tag-alias-info-icon');
                        if (infoIcon) infoIcon.onclick = (e) => { 
                            e.stopPropagation(); 
                            if(typeof window.openDanbooruTagInfoPopout === 'function') {
                                window.openDanbooruTagInfoPopout(aliasToSpaced, displayName); 
                            }
                        };
                    }
                    suggBox.appendChild(div);
                });
                suggBox.style.display = 'block';
            } catch(err) {}
        }, 400);
    });
 
    document.addEventListener('click', (e) => { if(!wrapper.contains(e.target)) suggBox.style.display = 'none'; });
}
 
const CAT_COLORS = { 0: "#aaa", 1: "#f9a825", 3: "#ae80ff", 4: "#5bc0de", 5: "#888" };