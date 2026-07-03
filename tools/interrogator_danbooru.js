/**
 * tools/danbooru.js
 * Módulo independente para o Danbooru Tag System
 * + Carregamento de imagens (thumbnails) de exemplo para a tag pesquisada
 */
(function() {
    const style = document.createElement('style');
style.innerHTML = `
    .danbooru-body { 
        padding: 12px; 
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
        overflow: hidden;
    }
    .danbooru-row { display: flex; gap: 8px; margin-bottom: 10px; min-width: 0; }
    .danbooru-input { 
        flex: 1; min-width: 0; background: #0d0d0d; border: 1px solid #2a3a2e; border-radius: 6px; color: #eee; padding: 8px 12px; font-size: 13px; outline: none; 
        box-sizing: border-box;
    }
    .danbooru-input:focus { border-color: #00aa66; }
    .danbooru-btn { background: #00aa66; color: #000; border: none; border-radius: 6px; padding: 8px 12px; font-weight: bold; cursor: pointer; font-size: 13px; }
    .danbooru-btn:hover { background: #00cc88; }
    .danbooru-btn-detect { background: #1a3a5c; color: #4db8ff; border: 1px solid #2a5a8c; border-radius: 6px; padding: 8px 12px; cursor: pointer; font-size: 15px; }
    
    .danbooru-result { 
        background: #0d0d0d; border: 1px solid #1e3d28; border-radius: 6px; padding: 12px; display: none; margin-top: 8px; 
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
    }
    .danbooru-result.open { display: block; }
    .danbooru-tag-title { font-size: 15px; font-weight: bold; color: #00ff99; margin-bottom: 4px; }
    .danbooru-tag-cat { font-size: 12px; color: #aaa; margin-left: 8px; }
    .danbooru-desc { color: #ccc; font-size: 13px; line-height: 1.5; max-height: 130px; overflow-y: auto; white-space: pre-wrap; margin: 8px 0; }
    .danbooru-link { color: #4db8ff; text-decoration: none; font-size: 13px; border: 1px solid #2a5a8c; padding: 4px 8px; border-radius: 4px; display: inline-block; }

    /* --- Galeria de imagens --- */
    .danbooru-gallery-label { font-size: 12px; color: #888; margin: 10px 0 6px; }
    .danbooru-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; margin-bottom: 4px; }
    .danbooru-thumb-wrap { position: relative; border-radius: 6px; overflow: hidden; background: #111; aspect-ratio: 1 / 1; border: 1px solid #1e3d28; }
    .danbooru-thumb { width: 100%; height: 100%; object-fit: cover; display: block; cursor: pointer; opacity: 0; transition: opacity .2s ease; }
    .danbooru-thumb.loaded { opacity: 1; }
    .danbooru-thumb-spinner { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #555; }
    .danbooru-thumb-wrap.errored .danbooru-thumb { display: none; }
    .danbooru-thumb-wrap.errored .danbooru-thumb-spinner { color: #663; font-size: 10px; }
    .danbooru-gallery-empty { color: #666; font-size: 12px; padding: 6px 0; }

    .db-popout-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 2000; display: none; }
    .db-popout { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #111d16; border: 1px solid #1e4a30; border-radius: 12px; width: 90%; max-width: 500px; max-height: 70vh; display: none; flex-direction: column; z-index: 2001; }
    .db-popout-header { padding: 14px; background: #0f1c13; border-bottom: 1px solid #1e3d28; color: #00cc88; font-weight: bold; display: flex; justify-content: space-between; border-radius: 12px 12px 0 0; }
    .db-popout-close { background: none; border: none; color: #888; font-size: 18px; cursor: pointer; }
    .db-popout-body { padding: 12px; overflow-y: auto; flex: 1; }
    .db-tag-item { padding: 8px; border-bottom: 1px solid #1e2a20; color: #ccc; font-size: 13px; cursor: pointer; }
    .db-tag-item:hover { color: #00ff99; background: #1a2a1e; }

    /* --- Lightbox para ver a imagem em tamanho maior --- */
    .db-lightbox-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 2100; display: none; align-items: center; justify-content: center; cursor: zoom-out; }
    .db-lightbox-overlay img { max-width: 90%; max-height: 90%; border-radius: 8px; box-shadow: 0 0 30px rgba(0,0,0,0.6); }
`;
    document.head.appendChild(style);

    window.addEventListener('DOMContentLoaded', () => {
        if (typeof window.registerToolModule !== 'function') return;

        // Container principal do módulo
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div style="font-size:12px;color:#888;padding:0 12px 10px;">Search tags or detect from the current prompt.</div>
            <div class="danbooru-body">
                <div class="danbooru-row">
                    <input type="text" id="dbInput" class="danbooru-input" placeholder="Type a tag... e.g. 1girl">
                    <button class="danbooru-btn" id="dbSearchBtn">Search</button>
                    <button class="danbooru-btn-detect" id="dbDetectBtn" title="Detect tags from prompts">🔍✨</button>
                </div>
                <div class="danbooru-result" id="dbResult">
                    <div>
                        <span class="danbooru-tag-title" id="dbTagName"></span>
                        <span class="danbooru-tag-cat" id="dbTagCat"></span>
                    </div>
                    <div class="danbooru-desc" id="dbTagDesc"></div>
                    <a href="#" target="_blank" class="danbooru-link" id="dbTagLink">Open on Danbooru ↗</a>

                    <div class="danbooru-gallery-label">Sample images (safe rating)</div>
                    <div class="danbooru-gallery" id="dbGallery"></div>
                </div>
            </div>

            <div class="db-popout-overlay" id="dbOverlay"></div>
            <div class="db-popout" id="dbPopout">
                <div class="db-popout-header">
                    <span>🔍 Tags detected in prompts</span>
                    <button class="db-popout-close" id="dbClose">✕</button>
                </div>
                <div class="db-popout-body" id="dbPopoutBody"></div>
            </div>

            <div class="db-lightbox-overlay" id="dbLightbox">
                <img id="dbLightboxImg" src="" alt="">
            </div>
        `;

        // Registra no sistema de módulos do HTML principal
        window.registerToolModule('🏷️ Danbooru Tag System', '#00cc88', wrapper);

        initDanbooruLogic();
    });

    function initDanbooruLogic() {
        const dbInput = document.getElementById('dbInput');
        const dbResult = document.getElementById('dbResult');
        const dbGallery = document.getElementById('dbGallery');
        const lightbox = document.getElementById('dbLightbox');
        const lightboxImg = document.getElementById('dbLightboxImg');

        const CAT_COLORS = { 0: "#aaa", 1: "#f9a825", 3: "#ae80ff", 4: "#5bc0de", 5: "#888" };
        const CAT_LABELS = { 0: "General", 1: "Artist", 3: "Copyright", 4: "Character", 5: "Meta" };

        const GALLERY_LIMIT = 8;

        document.getElementById('dbSearchBtn').onclick = () => performSearch();
        dbInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') performSearch(); });

        lightbox.onclick = () => { lightbox.style.display = 'none'; lightboxImg.src = ''; };

        async function performSearch(tagOverride) {
            const tag = (tagOverride || dbInput.value).trim().toLowerCase().replace(/ /g, '_');
            if (!tag) return;
            dbInput.value = tag;
            dbResult.classList.remove('open');
            try {
                const res = await fetch(`https://danbooru.donmai.us/tags.json?search[name]=${encodeURIComponent(tag)}&limit=1`);
                const data = await res.json();
                if (!data || data.length === 0) { alert(`Tag "${tag}" not found on Danbooru.`); return; }
                const t = data[0];
                document.getElementById('dbTagName').textContent = t.name.replace(/_/g, ' ');
                document.getElementById('dbTagCat').innerHTML = `<span style="color:${CAT_COLORS[t.category] || '#888'}">● ${CAT_LABELS[t.category] || 'Unknown'} (${Number(t.post_count).toLocaleString()} posts)</span>`;
                document.getElementById('dbTagLink').href = `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(t.name)}`;
                let desc = "No wiki description available.";
                try {
                    const wRes = await fetch(`https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(t.name)}.json`);
                    if (wRes.ok) {
                        const wData = await wRes.json();
                        if (wData && wData.body) desc = wData.body.replace(/\[.*?\]/g, '').slice(0, 800) + '...';
                    }
                } catch(e) {}
                document.getElementById('dbTagDesc').textContent = desc;
                dbResult.classList.add('open');

                loadGallery(t.name);
            } catch(e) { alert("Error connecting to Danbooru."); }
        }

        async function loadGallery(tagName) {
            dbGallery.innerHTML = '';
            try {
                // rating:general evita conteúdo explícito por padrão
                const url = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(tagName)}+rating:general&limit=${GALLERY_LIMIT}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error('posts.json failed');
                const posts = await res.json();

                const usable = (posts || []).filter(p => p.preview_file_url || p.file_url);
                if (usable.length === 0) {
                    dbGallery.innerHTML = '<div class="danbooru-gallery-empty">No preview images available for this tag.</div>';
                    return;
                }

                usable.forEach(p => {
                    const thumbUrl = p.preview_file_url || p.file_url;
                    const fullUrl = p.large_file_url || p.file_url || thumbUrl;

                    const wrap = document.createElement('div');
                    wrap.className = 'danbooru-thumb-wrap';

                    const spinner = document.createElement('div');
                    spinner.className = 'danbooru-thumb-spinner';
                    spinner.textContent = '…';
                    wrap.appendChild(spinner);

                    const img = document.createElement('img');
                    img.className = 'danbooru-thumb';
                    img.loading = 'lazy';
                    img.alt = tagName;
                    img.referrerPolicy = 'no-referrer';

                    img.onload = () => {
                        img.classList.add('loaded');
                        spinner.style.display = 'none';
                    };
                    img.onerror = () => {
                        wrap.classList.add('errored');
                        spinner.textContent = '⚠';
                    };
                    img.onclick = () => {
                        lightboxImg.src = fullUrl;
                        lightbox.style.display = 'flex';
                    };

                    img.src = thumbUrl;
                    wrap.appendChild(img);
                    dbGallery.appendChild(wrap);
                });
            } catch (e) {
                dbGallery.innerHTML = '<div class="danbooru-gallery-empty">Could not load preview images.</div>';
            }
        }

        const popout = document.getElementById('dbPopout');
        const overlay = document.getElementById('dbOverlay');
        document.getElementById('dbClose').onclick = () => { popout.style.display = 'none'; overlay.style.display = 'none'; };
        overlay.onclick = () => { popout.style.display = 'none'; overlay.style.display = 'none'; };

        document.getElementById('dbDetectBtn').onclick = () => {
            let text = "";
            document.querySelectorAll('textarea').forEach(ta => {
                if (ta.id === 'fullText') return;
                text += ta.value + ", ";
            });
            const tags = [...new Set(text.split(/[,|]/).map(t => t.trim().toLowerCase().replace(/ /g, '_')).filter(t => t.length > 2))];
            const dBody = document.getElementById('dbPopoutBody');
            dBody.innerHTML = '';
            if (tags.length === 0) {
                dBody.innerHTML = '<div style="color:#888;text-align:center;">No tags found in the current prompts.</div>';
            } else {
                tags.forEach(t => {
                    const div = document.createElement('div');
                    div.className = 'db-tag-item';
                    div.textContent = t.replace(/_/g, ' ');
                    div.onclick = () => {
                        popout.style.display = 'none';
                        overlay.style.display = 'none';
                        performSearch(t);
                    };
                    dBody.appendChild(div);
                });
            }
            popout.style.display = 'flex';
            overlay.style.display = 'block';
        };
    }
})();
