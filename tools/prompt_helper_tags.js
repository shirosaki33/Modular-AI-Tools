/* =========================================================================
   PROMPT HELPER — TAG LOOKUP (left panel)
   Danbooru + e621 are queried TOGETHER, API-first. The shared cache is only
   updated AFTER a successful lookup, so a stale or "unknown" cache entry can
   no longer hide a tag that really exists.
   Depends on: prompt_helper_settings.js, tagmanager_danbooru_core.js,
               tagmanager_e621_core.js
========================================================================= */

const SITES = {
    danbooru: {
        key: 'danbooru', name: 'Danbooru', icon: '🅱️', badge: 'db',
        host: () => 'danbooru.donmai.us',
        catColors: { 0: "#aaa", 1: "#f9a825", 3: "#ae80ff", 4: "#5bc0de", 5: "#888" },
        catLabels: { 0: "General", 1: "Artist", 3: "Copyright", 4: "Character", 5: "Meta" }
    },
    e621: {
        key: 'e621', name: 'e621', icon: '🦊', badge: 'e6',
        host: () => (window.showE621Sfw ? 'e926.net' : 'e621.net'),
        catColors: window.E621_CAT_COLORS || { 0: "#aaa", 1: "#f9a825", 3: "#ae80ff", 4: "#5bc0de", 5: "#4caf50", 6: "#888", 7: "#888", 8: "#ff8a65" },
        catLabels: window.E621_CAT_LABELS || { 0: "General", 1: "Artist", 3: "Copyright", 4: "Character", 5: "Species", 6: "Invalid", 7: "Meta", 8: "Lore" }
    }
};

const lastResults = { danbooru: null, e621: null };

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- DText -> HTML (same renderer as the Tag Manager's Tag Interrogator, host-aware) ---------- */
function formatDText(text, host) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\[\s*\[\s*([^|\]]+?)\s*(?:\|\s*([^\]]+?))?\s*\]\s*\]/g, (m, tag, label) => {
            const url = `https://${host}/wiki_pages/${encodeURIComponent(tag.replace(/ /g, '_'))}`;
            return `<a href="${url}" target="_blank" style="color:#4db8ff; text-decoration:none; font-weight:bold;">${label || tag.replace(/_/g, ' ')}</a>`;
        })
        .replace(/(?:\[?\s*post\s*#|post:)\s*(\d+)\s*\]?/gi, `<a href="https://${host}/posts/$1" target="_blank" style="color:#00ff99; text-decoration:none; font-weight:bold; background:#0d2a18; padding:2px 6px; border-radius:4px; border:1px solid #00aa66; white-space:nowrap;">📸 IMG #$1</a>`)
        .replace(/!?asset\s*#\d+/gi, '<span style="color:#888; font-style:italic; font-weight:bold;">[IMG]</span>')
        .replace(/^h[1-6]\.\s+(.*)$/gm, '<b style="color:#eee; display:block; margin-top:12px; margin-bottom:4px; border-bottom:1px solid #333; padding-bottom:4px;">$1</b>')
        .replace(/"([^"]+)":\s*(https?:\/\/[^\s]+)/g, '<a href="$2" target="_blank" style="color:#4db8ff; text-decoration:underline;">$1</a>')
        .replace(/\[\s*(https?:\/\/[^\s\]]+)\s+([^\]]+)\s*\]/g, '<a href="$1" target="_blank" style="color:#4db8ff; text-decoration:underline;">$2</a>')
        .replace(/\[\s*b\s*\](.*?)\[\s*\/\s*b\s*\]/gi, '<b>$1</b>')
        .replace(/\[\s*i\s*\](.*?)\[\s*\/\s*i\s*\]/gi, '<i>$1</i>')
        .replace(/\n/g, '<br>');
}

// ---------- Cache mode badge ----------
function updateCacheBadge() {
    const badge = document.getElementById('cacheModeBadge');
    const isLocal = window.isDanbooruLocalMode || window.isLocalMode;
    if (isLocal) {
        badge.textContent = '📁 Local cache';
        badge.className = 'cache-badge local';
        badge.title = 'Running on localhost — results are also saved to local/danbooru_cache.json and local/e621_cache.json (same as Tag Manager)';
    } else {
        badge.textContent = '🌐 Online / memory';
        badge.className = 'cache-badge online';
        badge.title = 'Not on localhost — cache stays in memory + localStorage. Local JSON files only work with the Tag Manager local server.';
    }
}
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(updateCacheBadge, 300);
    setTimeout(updateCacheBadge, 1200);
});

/* ---------- Raw API helpers ---------- */
async function apiGet(url) {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}
function listOf(data) {
    if (!data) return [];
    return Array.isArray(data) ? data : (data.tags || []);
}
const firstOf = (data) => listOf(data)[0] || null;

async function fetchTagExact(site, name) {
    return firstOf(await apiGet(`https://${site.host()}/tags.json?search[name]=${encodeURIComponent(name)}&limit=1`));
}

/* Exact tag -> alias redirect -> wiki. Always asks the site directly. */
async function lookupSite(site, raw) {
    const name = raw.trim().toLowerCase().replace(/\s+/g, '_');
    const host = site.host();

    let tag = await fetchTagExact(site, name);
    let aliasTo = null;

    if (!tag || !(Number(tag.post_count) > 0) || tag.is_deprecated) {
        try {
            const al = firstOf(await apiGet(`https://${host}/tag_aliases.json?search[antecedent_name]=${encodeURIComponent(name)}&search[status]=active&limit=1`));
            if (al && al.consequent_name) {
                aliasTo = al.consequent_name;
                const target = await fetchTagExact(site, aliasTo);
                if (target) tag = target;
            }
        } catch (e) { /* alias lookup is best-effort */ }
    }

    if (!tag) {
        let suggestions = [];
        try {
            suggestions = listOf(await apiGet(`https://${host}/tags.json?search[name_matches]=*${encodeURIComponent(name)}*&search[order]=count&limit=6`));
        } catch (e) {}
        return { site, query: name, tag: null, aliasTo: null, body: null, suggestions };
    }

    let body = null;
    try {
        const w = await apiGet(`https://${host}/wiki_pages/${encodeURIComponent(tag.name)}.json`);
        if (w && w.body && w.body.trim()) body = w.body;
    } catch (e) {}

    return { site, query: name, tag, aliasTo, body, suggestions: [] };
}

/* ---------- Write-through to the shared cache (only after a real hit) ---------- */
function writeThrough(res) {
    try {
        if (!res || !res.tag) return;
        const site = res.site;
        const cache = site.key === 'danbooru' ? window.danbooruCache : window.e621Cache;
        if (!cache) return;
        const now = Date.now();
        const t = res.tag;
        const key = t.name.replace(/_/g, ' ').toLowerCase();
        const clean = (res.body || '').replace(/\[.*?\]/g, '').trim();

        cache[key] = {
            ...(cache[key] || {}),
            count: parseInt(t.post_count) || 0, category: t.category, wikiName: t.name,
            isDeprecated: !!t.is_deprecated, ts: now,
            wikiChecked: true, wikiTs: now, hasWikiInfo: !!clean,
            description: clean.slice(0, 800) + (clean.length > 800 ? '...' : '')
        };
        const origKey = res.query.replace(/_/g, ' ').toLowerCase();
        if (res.aliasTo && origKey !== key) {
            cache[origKey] = { ...(cache[origKey] || {}), aliasTo: res.aliasTo.replace(/_/g, ' '), aliasChecked: true, aliasTs: now, isDeprecated: true, count: parseInt(t.post_count) || 0, category: t.category, ts: now };
        }

        // A real hit proves the tag exists: clear any stale "unknown" mark.
        let unknownChanged = false;
        [key, origKey].forEach(k => {
            const u = window.unknownTagsCache && window.unknownTagsCache[k];
            if (u && u[site.key]) { delete u[site.key]; delete u[site.key === 'danbooru' ? 'dbVerified' : 'e621Verified']; unknownChanged = true; if (!Object.keys(u).some(x => x !== 'ts')) delete window.unknownTagsCache[k]; }
        });
        if (unknownChanged && typeof window.saveUnknownTags === 'function') window.saveUnknownTags();

        if (site.key === 'danbooru') {
            if (typeof bumpDanbooruCacheVersion === 'function') bumpDanbooruCacheVersion();
            if (typeof scheduleDanbooruCachePersist === 'function') scheduleDanbooruCachePersist();
        } else {
            if (typeof bumpE621CacheVersion === 'function') bumpE621CacheVersion();
            if (typeof scheduleE621CachePersist === 'function') scheduleE621CachePersist();
        }
    } catch (e) { console.warn('[write-through]', e); }
}

/* ---------- Card rendering ---------- */
function setCardLoading(site) {
    document.getElementById('body-' + site.key).innerHTML = '<div class="result-empty">Loading...</div>';
    document.getElementById('status-' + site.key).textContent = '';
}

function renderCardError(site, err) {
    document.getElementById('body-' + site.key).innerHTML = `<div class="result-empty" style="color:#ff8080; font-style:normal;">Could not reach ${esc(site.name)}: ${esc(err.message || err)}</div>`;
    document.getElementById('status-' + site.key).textContent = 'error';
}

function renderCard(res) {
    const site = res.site, host = site.host();
    const bodyEl = document.getElementById('body-' + site.key);
    const statusEl = document.getElementById('status-' + site.key);
    lastResults[site.key] = res;

    if (!res.tag) {
        statusEl.textContent = 'not found';
        let html = `<div class="result-empty">Tag "<b style="color:#ccc;">${esc(res.query.replace(/_/g, ' '))}</b>" not found on ${esc(site.name)}.</div>`;
        if (res.suggestions.length) {
            html += `<div style="font-size:11px; color:#888; text-align:center;">Did you mean:</div><div class="sugg-chips">` +
                res.suggestions.map(s => `<span class="sugg-chip" data-tag="${esc(s.name.replace(/_/g, ' '))}">${esc(s.name.replace(/_/g, ' '))} <span style="color:#666;">${Number(s.post_count || 0).toLocaleString()}</span></span>`).join('') +
                `</div>`;
        }
        bodyEl.innerHTML = html;
        return;
    }

    const t = res.tag;
    const displayName = t.name.replace(/_/g, ' ');
    const color = site.catColors[t.category] || '#aaa';
    const label = site.catLabels[t.category] || 'Unknown';
    const deprecated = t.is_deprecated || !!res.aliasTo;
    statusEl.textContent = Number(t.post_count || 0).toLocaleString() + ' posts';

    let html = '';
    if (res.aliasTo) {
        html += `<div class="alias-box">
            <span class="lbl">Original tag (deprecated)</span><b style="color:#ffcc66;">${esc(res.query.replace(/_/g, ' '))}</b>
            <span class="lbl" style="margin-top:6px;">Redirects to</span><b style="color:#00ff99;">${esc(displayName)}</b>
            <div style="font-size:11px; color:#777; margin-top:6px; line-height:1.4;">${esc(site.name)} merged the original tag into the one above. The count and wiki below belong to the new tag.</div>
        </div>`;
    }
    html += `<div class="result-tag-title">${esc(displayName)}</div>`;
    html += `<div class="result-tag-meta"><span style="color:${color}">● ${esc(label)}</span> · ${Number(t.post_count || 0).toLocaleString()} posts${deprecated ? ' <span style="color:#f48fb1;">· Deprecated / Alias</span>' : ''}</div>`;
    html += `<div class="result-desc">${res.body ? formatDText(res.body, host) : `<span style="color:#666; font-style:italic;">No wiki description available on ${esc(site.name)}.</span>`}</div>`;
    html += `<div class="result-actions">
        ${res.body ? `<button class="btn-tr" data-site="${site.key}" title="Send description to the Google Translate tab">🌐 Translate desc</button>` : ''}
        <a href="https://${host}/wiki_pages/${encodeURIComponent(t.name)}" target="_blank">Open on ${esc(host)} ↗</a>
    </div>`;
    bodyEl.innerHTML = html;
}

/* Delegated clicks inside the cards (suggestion chips + translate button).
   The translate button sends text to the Google tab (elements from prompt_helper_google). */
document.getElementById('col-left').addEventListener('click', (e) => {
    const chip = e.target.closest('.sugg-chip');
    if (chip) { performSearch(chip.dataset.tag); return; }
    const trBtn = e.target.closest('.btn-tr');
    if (trBtn) {
        const res = lastResults[trBtn.dataset.site];
        const text = res && res.body ? res.body : '';
        if (!text.trim()) { window.showAlert('No description to translate.', 'warn'); return; }
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        document.querySelector('.tab-btn[data-tab="google"]').classList.add('active');
        document.getElementById('tab-google').classList.add('active');
        document.getElementById('gSource').value = text.slice(0, 4500);
        document.getElementById('gFrom').value = 'en';
        document.getElementById('gTo').value = 'pt';
        document.getElementById('gFix').checked = false;
        window.showAlert('Description sent to Google Translate tab.', 'info');
    }
});

/* ---------- Search: fires both sites at the same time ---------- */
const tagInput = document.getElementById('tagInput');
const suggBox = document.getElementById('tagSuggBox');

async function performSearch(rawTag) {
    const q = (rawTag || tagInput.value || '').trim();
    if (!q) return;
    tagInput.value = q;
    suggBox.style.display = 'none';
    suggToken++;

    await Promise.all(Object.values(SITES).map(async (site) => {
        setCardLoading(site);
        try {
            const res = await lookupSite(site, q);
            renderCard(res);
            writeThrough(res);
        } catch (err) {
            console.error(site.name, err);
            renderCardError(site, err);
        }
    }));
}

document.getElementById('tagSearchBtn').onclick = () => performSearch();
tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); performSearch(); }
});

document.getElementById('sfwToggle').addEventListener('change', (e) => {
    window.showE621Sfw = e.target.checked;
    window.saveSetting('ph_e621_sfw', e.target.checked);
    if (lastResults.e621 || tagInput.value.trim()) {
        const q = tagInput.value.trim();
        if (q) {
            const site = SITES.e621;
            setCardLoading(site);
            lookupSite(site, q).then(r => { renderCard(r); writeThrough(r); }).catch(err => renderCardError(site, err));
        }
    }
});
window.getSetting('ph_e621_sfw', false).then(v => {
    window.showE621Sfw = !!v;
    document.getElementById('sfwToggle').checked = !!v;
});

/* ---------- Autocomplete (merged from both sites, API-first) ---------- */
let suggTimeout = null;
let suggToken = 0;

async function suggestFromSite(site, nameQuery) {
    const host = site.host();
    const q = encodeURIComponent(nameQuery);
    const [direct, aliases] = await Promise.all([
        apiGet(`https://${host}/tags.json?search[name_matches]=*${q}*&search[order]=count&limit=8`).catch(() => null),
        apiGet(`https://${host}/tag_aliases.json?search[antecedent_name_matches]=*${q}*&search[status]=active&limit=8`).catch(() => null)
    ]);
    const aliasMap = new Map();
    listOf(aliases).forEach(a => { if (a.antecedent_name) aliasMap.set(a.antecedent_name, a.consequent_name); });

    const out = [];
    const seen = new Set();
    listOf(direct).forEach(t => {
        seen.add(t.name);
        const to = aliasMap.get(t.name);
        out.push({ name: t.name, count: Number(t.post_count) || 0, category: t.category, aliasTo: to || null, site: site.key });
    });
    aliasMap.forEach((to, from) => {
        if (seen.has(from)) return;
        out.push({ name: from, count: 0, category: 0, aliasTo: to, site: site.key });
    });
    return out;
}

function renderSuggestions(list) {
    suggBox.innerHTML = '';
    if (!list || list.length === 0) { suggBox.style.display = 'none'; return; }
    list.forEach(t => {
        const div = document.createElement('div');
        div.className = 'db-sugg-item';
        // 3 cores só, por origem (window.TAG_SOURCE_COLORS em tagmanager_booru_core.js).
        const srcColors = window.TAG_SOURCE_COLORS || { danbooru: '#4db8ff', e621: '#f48fb1' };
        const color = t.sites.includes('danbooru') ? srcColors.danbooru : srcColors.e621;
        const displayName = t.name.replace(/_/g, ' ');
        const arrow = t.aliasTo ? ` <span class="db-alias-arrow">➜ ${esc(t.aliasTo.replace(/_/g, ' '))}</span>` : '';
        const badges = t.sites.map(s => `<span class="src-badge ${SITES[s].badge}">${SITES[s].badge === 'db' ? 'DB' : 'e6'}</span>`).join('');
        const count = t.count > 0 ? Number(t.count).toLocaleString() : (t.aliasTo ? 'alias' : '0');
        div.innerHTML = `<span style="color:${color}; font-weight:bold;">${esc(displayName)}${arrow}${badges}</span><span style="color:#666;">${count}</span>`;
        div.onclick = () => {
            const finalName = t.aliasTo ? t.aliasTo.replace(/_/g, ' ') : displayName;
            tagInput.value = finalName;
            suggBox.style.display = 'none';
            performSearch(finalName);
        };
        suggBox.appendChild(div);
    });
    suggBox.style.display = 'block';
}

tagInput.addEventListener('input', () => {
    clearTimeout(suggTimeout);
    const raw = tagInput.value.trim().toLowerCase();
    if (raw.length < 2) { suggBox.style.display = 'none'; return; }
    const q = raw.replace(/\s+/g, '_');
    const myToken = ++suggToken;
    suggTimeout = setTimeout(async () => {
        try {
            const results = await Promise.all(Object.values(SITES).map(s => suggestFromSite(s, q).catch(() => [])));
            if (myToken !== suggToken) return; // stale response

            const merged = new Map();
            results.flat().forEach(item => {
                const key = item.name.toLowerCase();
                const ex = merged.get(key);
                if (!ex) merged.set(key, { name: item.name, count: item.count, category: item.category, aliasTo: item.aliasTo, sites: [item.site] });
                else {
                    if (!ex.sites.includes(item.site)) ex.sites.push(item.site);
                    ex.count = Math.max(ex.count, item.count);
                    if (!ex.aliasTo && item.aliasTo) ex.aliasTo = item.aliasTo;
                }
            });
            const list = Array.from(merged.values()).sort((a, b) => b.count - a.count).slice(0, 10);
            renderSuggestions(list);
        } catch (e) {
            console.warn('[autocomplete]', e);
        }
    }, 320);
});

document.addEventListener('click', (e) => {
    if (!document.getElementById('tagSearchWrap').contains(e.target)) {
        suggBox.style.display = 'none';
    }
});