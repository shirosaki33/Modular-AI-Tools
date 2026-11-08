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

/* ---------- Tag Lookup options (gear) ----------
   phUpdateLocalFile : lookups update local/danbooru_cache.json + local/e621_cache.json (default ON)
   danbooruWikiMode  : wiki text saved in its own file, local/wiki_full.json: 'off' | 'short' (800 chars, default) | 'full'
   Both only exist on localhost. Saved wikis are read back from the file and flagged "offline". */
const phIsLocal = () => !!(typeof window._booruIsLocalHost === 'function' && window._booruIsLocalHost());
const phFileOn = () => phIsLocal() && !!window.WikiFull;                       // saved texts can be read (any mode)
const phMode = () => window.WikiFull ? window.WikiFull.mode() : 'short';
const phStoreOn = () => phFileOn() && phMode() !== 'off';                      // new texts are saved
const phUpdateOn = () => !phIsLocal() || window.phUpdateLocalFile !== false;

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

    let body = null, fromFile = null, wikiFailed = false;
    const saved = phFileOn() ? window.WikiFull.get(site.key, tag.name) : null;
    if (saved && saved.full) {
        // Complete wiki already in local/wiki_full.json — no request, flagged "offline".
        fromFile = saved; body = saved.text;
    } else {
        try {
            const w = await apiGet(`https://${host}/wiki_pages/${encodeURIComponent(tag.name)}.json`);
            if (w && w.body && w.body.trim()) body = w.body;
        } catch (e) {
            wikiFailed = true;   // site error: this is NOT the same as "the tag has no wiki"
            if (saved) { fromFile = saved; body = saved.text; wikiFailed = false; }   // only the short summary is saved: show it
        }
    }

    return { site, query: name, tag, aliasTo, body, suggestions: [], offline: !!fromFile, fileTs: fromFile ? fromFile.ts : null, fileFull: fromFile ? fromFile.full : true, wikiFailed };
}

/* Site unreachable: a tag already saved (cache entry + wiki_full.json) is shown entirely from the files. */
function lookupOffline(site, raw) {
    if (!phFileOn()) return null;
    const cache = site.key === 'danbooru' ? window.danbooruCache : window.e621Cache;
    const key = String(raw || '').trim().toLowerCase().replace(/_/g, ' ');
    let entry = cache && cache[key];
    let aliasTo = null, targetKey = key;
    if (entry && entry.aliasTo) {
        aliasTo = entry.aliasTo;
        targetKey = String(entry.aliasTo).toLowerCase().replace(/_/g, ' ');
        entry = cache[targetKey] || entry;
    }
    const full = window.WikiFull.get(site.key, targetKey);
    if (!entry || !full) return null;
    return {
        site, query: key.replace(/ /g, '_'),
        tag: { name: entry.wikiName || targetKey.replace(/ /g, '_'), post_count: entry.count || 0, category: entry.category, is_deprecated: !!entry.isDeprecated },
        aliasTo: aliasTo ? String(aliasTo).replace(/ /g, '_') : null,
        body: full.text, suggestions: [], offline: true, fileTs: full.ts, fileFull: full.full, fromFilesOnly: true
    };
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
        // same summary cleaner as the Tag Manager (links keep their words, See also / images removed)
        const clean = typeof window.TMCleanWikiSummary === 'function'
            ? window.TMCleanWikiSummary(res.body || '')
            : (res.body || '').replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (m, a, b) => (b || a).replace(/_/g, ' ')).replace(/\[.*?\]/g, '').trim();

        const useFile = phFileOn();
        const short = clean.length > 800 ? clean.slice(0, 800) + '...' : clean;
        cache[key] = {
            ...(cache[key] || {}),
            count: parseInt(t.post_count) || 0, category: t.category, wikiName: t.name,
            isDeprecated: !!t.is_deprecated, ts: now
        };
        // The wiki flags are only written when the wiki request really worked (a site error is not "no wiki").
        if (!res.wikiFailed && !res.offline) {
            Object.assign(cache[key], { wikiChecked: true, wikiTs: now, hasWikiInfo: !!clean });
            // Localhost: the cache keeps only flags; the text goes to wiki_full.json. Elsewhere the short text stays here.
            if (useFile) delete cache[key].description; else cache[key].description = short;
        }
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

        // Wiki text -> local/wiki_full.json (own file) according to the mode. Skipped when it was just read from there.
        if (phStoreOn() && !res.wikiFailed && !res.offline) {
            if (!clean) window.WikiFull.remove(site.key, key);
            else if (phMode() === 'full') window.WikiFull.set(site.key, key, res.body, now, true);
            else { const cur = window.WikiFull.get(site.key, key); if (!cur || !cur.full || cur.broken) window.WikiFull.set(site.key, key, short, now, false); }
        }

        if (res.offline && res.fromFilesOnly) return;   // nothing new to write
        if (site.key === 'danbooru') {
            if (typeof bumpDanbooruCacheVersion === 'function') bumpDanbooruCacheVersion();
            if (phUpdateOn() && typeof scheduleDanbooruCachePersist === 'function') scheduleDanbooruCachePersist();
        } else {
            if (typeof bumpE621CacheVersion === 'function') bumpE621CacheVersion();
            if (phUpdateOn() && typeof scheduleE621CachePersist === 'function') scheduleE621CachePersist();
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
    const offBadge = res.offline ? `<span class="offline-badge" title="Read from local/wiki_full.json${res.fileFull === false ? ' — short summary (first 800 characters)' : ''}${res.fileTs ? ' — saved ' + esc(new Date(res.fileTs).toLocaleString('en-US')) : ''}${res.fromFilesOnly ? ' (site unreachable: shown entirely from local files)' : ''}">${res.fileFull === false ? 'offline · summary' : 'offline'}</span>` : '';
    const noWiki = res.wikiFailed
        ? `<span style="color:#ff8080; font-style:italic;">Could not load the wiki from ${esc(site.name)} (site error) — try again.</span>`
        : `<span style="color:#666; font-style:italic;">Wiki of this tag is empty</span>`;
    html += `<div class="result-desc">${offBadge}${res.body ? formatDText(res.body, host) : noWiki}</div>`;
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

    window._phSearching = true;
    await Promise.all(Object.values(SITES).map(async (site) => {
        setCardLoading(site);
        try {
            const res = await lookupSite(site, q);
            renderCard(res);
            writeThrough(res);
        } catch (err) {
            const off = lookupOffline(site, q);
            if (off) { renderCard(off); return; }
            console.error(site.name, err);
            renderCardError(site, err);
        }
    }));
    window._phSearching = false;
}

document.getElementById('tagSearchBtn').onclick = () => performSearch();
tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); performSearch(); }
});

document.getElementById('sfwToggle').addEventListener('change', (e) => {
    window.showE621Sfw = e.target.checked;
    window.saveSetting('ph_e621_sfw', e.target.checked);
    if (window.SharedSettings) window.SharedSettings.set('toggle-e621-sfw', e.target.checked);
    if (lastResults.e621 || tagInput.value.trim()) {
        const q = tagInput.value.trim();
        if (q) {
            const site = SITES.e621;
            setCardLoading(site);
            lookupSite(site, q).then(r => { renderCard(r); writeThrough(r); }).catch(err => { const off = lookupOffline(site, q); off ? renderCard(off) : renderCardError(site, err); });
        }
    }
});
window.getSetting('ph_e621_sfw', false).then(v => {
    window.showE621Sfw = !!v;
    document.getElementById('sfwToggle').checked = !!v;
});
if (window.SharedSettings) window.SharedSettings.register('toggle-e621-sfw', v => {   // synced with the Tag Manager
    window.showE621Sfw = !!v; document.getElementById('sfwToggle').checked = !!v; window.saveSetting('ph_e621_sfw', !!v);
}, { own: () => window.getSetting('ph_e621_sfw', false) });

/* ---------- Autocomplete: same system as the Tag Manager (tagmanager_danbooru_autocomplete.js) ----------
   1) the tags already saved in the cache files show up instantly; 2) the sites are queried in the background and the list is
   updated only if they bring something new; 3) tags shown that are new / incomplete are saved in the cache files with their wiki.
   Up to 5 Danbooru + 5 e621. Falls back to the old direct-API search if that module is missing or “Update localhost file” is off (that search never writes). */
if (window.showE621 === undefined) window.showE621 = true;   // Prompt Helper always searches both sites
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
        out.push({ name: t.name, count: Number(t.post_count) || 0, category: t.category, aliasTo: to || null, deprecated: !!t.is_deprecated || !!to, site: site.key });
    });
    aliasMap.forEach((to, from) => {
        if (seen.has(from)) return;
        out.push({ name: from, count: 0, category: 0, aliasTo: to, deprecated: true, site: site.key });
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
        const count = (t.aliasTo && t.deprecated) ? '<span class="db-dep-badge" title="Deprecated tag: it was merged into / replaced by the tag after the ➜ arrow.">deprecated</span>' : (t.count > 0 ? Number(t.count).toLocaleString() : '0');   // alias: "deprecated" instead of the counter
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
    if (phUpdateOn() && typeof window.fetchBooruSuggestions === 'function') {   // “Update localhost file” off = the old search that never writes to the cache files
        const toItem = t => ({ name: t.name, count: t.post_count, category: 0, aliasTo: t.isAlias ? t.aliasTo : null, deprecated: !!t.isDeprecated, sites: t.sources });
        const sig = l => l.map(t => t.name + '|' + t.sites.join('+')).join(',');
        let shown = null;
        window.fetchBooruSuggestions(q, undefined, { localOnly: true }).then(local => {
            if (myToken !== suggToken || !local.length) return;
            const list = local.map(toItem); shown = sig(list); renderSuggestions(list);
        }).catch(() => {});
        suggTimeout = setTimeout(async () => {
            try {
                const full = await window.fetchBooruSuggestions(q);
                if (myToken !== suggToken) return; // stale response
                if (typeof window.enrichBooruSuggestions === 'function' && phUpdateOn()) window.enrichBooruSuggestions(full);
                const list = full.map(toItem);
                if (sig(list) !== shown) renderSuggestions(list);
            } catch (e) { console.warn('[autocomplete]', e); }
        }, 320);
        return;
    }
    suggTimeout = setTimeout(async () => {
        try {
            const results = await Promise.all(Object.values(SITES).map(s => suggestFromSite(s, q).catch(() => [])));
            if (myToken !== suggToken) return; // stale response

            const merged = new Map();
            results.flat().forEach(item => {
                const key = item.name.toLowerCase();
                const ex = merged.get(key);
                if (!ex) merged.set(key, { name: item.name, count: item.count, category: item.category, aliasTo: item.aliasTo, deprecated: !!item.deprecated, sites: [item.site] });
                else {
                    if (!ex.sites.includes(item.site)) ex.sites.push(item.site);
                    ex.count = Math.max(ex.count, item.count);
                    if (!ex.aliasTo && item.aliasTo) ex.aliasTo = item.aliasTo;
                    if (item.deprecated) ex.deprecated = true;
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

/* ---------- Gear menu (Tag Lookup options) ---------- */
(function () {
    const btn = document.getElementById('phGearBtn'), menu = document.getElementById('phGearMenu');
    const cbU = document.getElementById('phOptUpdateLocal'), cbE = document.getElementById('phOptExpandSave');
    const lblU = document.getElementById('phOptUpdateLbl'), lblE = document.getElementById('phOptExpandLbl');
    const note = document.getElementById('phGearLocalNote');
    if (!btn || !menu) return;

    function refreshLocalState() {
        const local = phIsLocal();
        [cbU, cbE].forEach(c => c.disabled = !local);
        lblU.classList.toggle('is-disabled', !local);
        lblE.classList.toggle('is-disabled', !local);
        note.style.display = local ? 'none' : 'block';
        if (!local) { cbU.checked = false; cbE.value = 'short'; }
        if (window._phUpdateFillState) window._phUpdateFillState();
    }
    function toggle(open) {
        const o = open === undefined ? !menu.classList.contains('open') : open;
        menu.classList.toggle('open', o); btn.classList.toggle('open', o);
        if (o) refreshLocalState();
    }
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => toggle(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });

    cbU.addEventListener('change', () => {
        window.phUpdateLocalFile = cbU.checked;
        window.saveSetting('ph_update_local_file', cbU.checked);
    });
    cbE.addEventListener('change', () => {
        window.danbooruWikiMode = cbE.value;
        window.saveSetting('ph_wiki_mode', cbE.value);
        if (window.SharedSettings) window.SharedSettings.set('dbp-wiki-mode', cbE.value);
        if (cbE.value !== 'off' && window.WikiFull && window.WikiFull.load) window.WikiFull.load();
        if (window._phUpdateFillState) window._phUpdateFillState();
    });

    Promise.all([window.getSetting('ph_update_local_file', true), window.getSetting('ph_wiki_mode', null), window.getSetting('ph_expand_save', false)]).then(([u, m, oldX]) => {
        window.phUpdateLocalFile = u !== false;
        if (!['off', 'short', 'full'].includes(m)) m = oldX ? 'full' : 'short';   // old "Save expanded" checkbox = full
        window.danbooruWikiMode = m;
        cbU.checked = window.phUpdateLocalFile;
        cbE.value = m;
        refreshLocalState();
        if (m !== 'off' && phIsLocal() && window.WikiFull && window.WikiFull.load) window.WikiFull.load();
        if (window.SharedSettings) window.SharedSettings.register('dbp-wiki-mode', v => {   // synced with the Tag Manager
            if (!['off', 'short', 'full'].includes(v)) return;
            window.danbooruWikiMode = v; cbE.value = v; window.saveSetting('ph_wiki_mode', v);
            if (v !== 'off' && phIsLocal() && window.WikiFull && window.WikiFull.load) window.WikiFull.load();
            if (window._phUpdateFillState) window._phUpdateFillState();
        }, { own: () => cbE.value });
    });
    // 🤖 Auto-fill when idle (shared engine: tools/tagmanager_idle_fill.js)
    const cbI = document.getElementById('phOptIdleFill'), stI = document.getElementById('phIdleStatus');
    function bindIdle() {
        if (!window.IdleFill || !cbI) return;
        window.IdleFill.isBusy = () => !!window._phSearching;
        window.IdleFill.allowed = () => phUpdateOn();         // it writes to the cache files: respect "Update localhost file"
        cbI.checked = window.IdleFill.enabled();
        window.IdleFill.onStatus(t => { if (stI) stI.textContent = t ? t.charAt(0).toUpperCase() + t.slice(1) + '.' : 'Fills missing info and adds new tags while the app is idle.'; cbI.checked = window.IdleFill.enabled(); });
    }
    if (cbI) {
        cbI.addEventListener('change', () => { if (!window.IdleFill) { cbI.checked = false; return; } window.IdleFill.setEnabled(cbI.checked); });
        bindIdle(); document.addEventListener('idlefill:ready', bindIdle);
    }
    setTimeout(refreshLocalState, 400);
})();

/* ---------- 📚 Fill wiki (gear menu): all / Danbooru only / e621 only, optional recursive mode ----------
   Same behavior as the Tag Manager's Tag Interrogator panel (shared cores): moves the descriptions still stored in the cache
   files into local/wiki_full.json, then downloads the wiki text of the saved tags that lack it or are outdated.
   Recursive: also follows the tag links inside the wikis (see wikiRecursive in tagmanager_booru_core.js). */
(function () {
    const ids = ['phFillBoth', 'phFillDb', 'phFillE6'];
    const $ = id => document.getElementById(id);
    const statusEl = () => $('phFillStatus');
    const say = (m, t) => { if (window.showAlert) window.showAlert(m, t || 'info'); };
    const e6On = () => window.showE621 !== false;

    window._phUpdateFillState = function () {
        const ok = phIsLocal() && phStoreOn();
        ids.forEach(id => {
            const b = $(id); if (!b) return;
            b.disabled = !ok || !!window._dbInfoScanRunning;
            b.title = b.title.replace(/ ?\(Set 💾 Wiki text.*$/, '') + (ok ? '' : ' (Set 💾 Wiki text to Short or Full first — localhost only.)');
        });
    };

    function setStatus(t) {
        const el = statusEl(); if (!el) return;
        el.style.display = t ? 'block' : 'none'; el.textContent = t || '';
    }

    window.phRunFillWiki = async function (site) {
        const onlyDb = site === 'danbooru', onlyE6 = site === 'e621';
        const siteLabel = onlyDb ? ' (Danbooru)' : onlyE6 ? ' (e621)' : '';
        if (!phIsLocal() || !phStoreOn()) { say('Set 💾 Wiki text to Short or Full first (localhost only).', 'warn'); return; }
        if (!phUpdateOn()) { say('Turn on “Update localhost file” first: Fill wiki writes to the cache files.', 'warn'); return; }
        if (window._dbInfoScanRunning) { say('Another fill is already running.', 'info'); return; }
        if (onlyE6 && !e6On()) { say('e621 is disabled.', 'warn'); return; }
        try { if (window.WikiFull && window.WikiFull.load) await window.WikiFull.load(); } catch (e) {}

        let migrated = 0;
        try {
            const m1 = (window.dbMigrateDescriptions && !onlyE6) ? await window.dbMigrateDescriptions() : null;
            const m2 = (window.e621MigrateDescriptions && !onlyDb) ? await window.e621MigrateDescriptions() : null;
            migrated = ((m1 && m1.moved) || 0) + ((m2 && m2.moved) || 0);
            if ((m1 && m1.ok === false) || (m2 && m2.ok === false)) { say('local/wiki_full.json could not be read, so nothing was changed. Check that the localhost server is running.', 'warn'); return; }
        } catch (e) { console.warn('[Fill wiki] migration', e); }

        const recursive = !!($('phFillRecursive') || {}).checked;
        const depth = Number(($('phFillDepth') || {}).value) || 3;
        const dbTags = (window.dbWikiFillList && !onlyE6) ? window.dbWikiFillList() : [];
        const e6Tags = (window.e621WikiFillList && !onlyDb && e6On()) ? window.e621WikiFillList() : [];
        let dbSeeds = dbTags, e6Seeds = e6Tags;
        if (recursive) {
            if (!onlyE6 && window.dbFullTextTags) dbSeeds = Array.from(new Set(dbTags.concat(window.dbFullTextTags())));
            if (!onlyDb && e6On() && window.e621FullTextTags) e6Seeds = Array.from(new Set(e6Tags.concat(window.e621FullTextTags())));
        }
        const total = dbSeeds.length + e6Seeds.length;
        if (total === 0) { say(`Fill wiki${siteLabel}: ${migrated} description(s) moved to wiki_full.json. Nothing else to update — every saved tag with a wiki has its text and it is up to date.`, 'info'); return; }
        if (recursive) {
            if (!confirm(`Recursive Fill wiki${siteLabel}: starts from ${total} saved tag(s), follows the links inside their wikis up to ${depth} level(s) and downloads the linked tags that are not saved yet (up to 1000 new tags per site).\n\nContinue?`)) return;
        } else if (total > 150 && !confirm(`Fill wiki${siteLabel} will download the wiki of ${total} saved tag(s) (about ${Math.max(1, Math.round(total * 0.4 / 60))} min).\n\nContinue?`)) return;

        window._dbInfoScanRunning = true;            // keeps the idle auto-fill quiet meanwhile
        window._dbBackgroundScanCancelled = false; window._e621BackgroundScanCancelled = false;
        ids.forEach(id => { const b = $(id); if (b) b.disabled = true; });
        const totals = { danbooru: dbSeeds.length, e621: e6Seeds.length }, prog = { danbooru: 0, e621: 0 }, added = { danbooru: 0, e621: 0 };
        const show = (done, s, tot) => {
            prog[s] = done; if (tot) totals[s] = tot;
            const parts = [];
            if (totals.danbooru) parts.push(`🅱️ ${prog.danbooru}/${totals.danbooru}`);
            if (totals.e621) parts.push(`🦊 ${prog.e621}/${totals.e621}`);
            setStatus(`${recursive ? 'Recursive fill' : 'Filling wiki'} — ${parts.join(' · ')}`);
        };
        show(0, dbSeeds.length ? 'danbooru' : 'e621');
        try {
            if (recursive) {
                if (dbSeeds.length && window.dbWikiRecursive) await window.dbWikiRecursive(dbSeeds, { depth, maxNew: 1000, onProgress: (d, t, a) => { added.danbooru = a; show(d, 'danbooru', t); } });
                if (e6Seeds.length && window.e621WikiRecursive) await window.e621WikiRecursive(e6Seeds, { depth, maxNew: 1000, onProgress: (d, t, a) => { added.e621 = a; show(d, 'e621', t); } });
            } else {
                if (dbTags.length) await window.dbFetchWikiBatch(dbTags, false, null, (d) => show(d, 'danbooru'));
                if (e6Tags.length && window.e621FetchWikiBatch) await window.e621FetchWikiBatch(e6Tags, false, null, (d) => show(d, 'e621'));
            }
        } finally {
            window._dbInfoScanRunning = false;
            setStatus('');
            window._phUpdateFillState();
        }
        if (recursive) say(`Recursive Fill wiki${siteLabel} complete: ${migrated} description(s) moved to wiki_full.json, ${added.danbooru + added.e621} new tag(s) added from wiki links (Danbooru ${added.danbooru}, e621 ${added.e621}).`, 'success');
        else {
            const saved = dbTags.filter(t => window.WikiFull.has('danbooru', t)).length + e6Tags.filter(t => window.WikiFull.has('e621', t)).length;
            say(`Fill wiki${siteLabel} complete: ${migrated} description(s) moved to wiki_full.json, ${saved} of ${dbTags.length + e6Tags.length} wiki text(s) downloaded/updated.`, saved === dbTags.length + e6Tags.length ? 'success' : 'warn');
        }
    };

    function bind() {
        const b1 = $('phFillBoth'), b2 = $('phFillDb'), b3 = $('phFillE6'), cb = $('phFillRecursive'), sel = $('phFillDepth');
        if (!b1) return;
        b1.onclick = () => window.phRunFillWiki();
        b2.onclick = () => window.phRunFillWiki('danbooru');
        b3.onclick = () => window.phRunFillWiki('e621');
        Promise.all([window.getSetting('ph_fill_recursive', false), window.getSetting('ph_fill_depth', 3)]).then(([r, d]) => {
            cb.checked = !!r; if ([1, 2, 3, 4, 5].includes(Number(d))) sel.value = String(d);
        });
        cb.addEventListener('change', () => { window.saveSetting('ph_fill_recursive', cb.checked); if (window.SharedSettings) window.SharedSettings.set('dbp-fill-recursive', cb.checked); });
        sel.addEventListener('change', () => { window.saveSetting('ph_fill_depth', Number(sel.value)); if (window.SharedSettings) window.SharedSettings.set('dbp-fill-depth', Number(sel.value)); });
        if (window.SharedSettings) {   // synced with the Tag Manager
            window.SharedSettings.register('dbp-fill-recursive', v => { cb.checked = !!v; window.saveSetting('ph_fill_recursive', !!v); }, { own: () => window.getSetting('ph_fill_recursive', false) });
            window.SharedSettings.register('dbp-fill-depth', v => { if ([1, 2, 3, 4, 5].includes(Number(v))) { sel.value = String(Number(v)); window.saveSetting('ph_fill_depth', Number(v)); } }, { own: () => window.getSetting('ph_fill_depth', 3) });
        }
        window._phUpdateFillState();
        [cb, sel].forEach(e => e.closest('label').addEventListener('click', ev => ev.stopPropagation()));
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
