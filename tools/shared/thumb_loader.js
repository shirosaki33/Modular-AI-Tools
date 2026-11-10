/* =========================================================================
   THUMB LOADER — miniaturas leves para qualquer grade/lista de imagens locais
   ---------------------------------------------------------------------
   Problema: um <img> pequeno apontando para a imagem ORIGINAL faz o Chrome
   guardar na RAM a imagem decodificada em tamanho cheio (1024×1536 ≈ 6 MB),
   mesmo mostrada com 70 px. Grades grandes ocupavam GBs.

   Solução: quando o <img> chega perto da área visível, a imagem é decodificada
   UMA vez, reduzida para a largura exibida (degraus de 128 px × devicePixelRatio)
   e trocada por um JPEG pequeno. O bitmap cheio é liberado na hora. O resultado
   fica em cache por URL de origem, então re-renders não decodificam de novo.

   API
     ThumbLoader.attach(imgEl, fullUrl, { root, width, onSize, index, getBlob })
         getBlob  async () => Blob/File: abre o arquivo só na hora de gerar a miniatura (fullUrl vira só uma chave)
         root   elemento com scroll (padrão: a janela)
         width  número ou função () => largura CSS em px (padrão: largura do <img>)
         onSize (w, h) resolução real da imagem, quando conhecida
     ThumbLoader.scan(container, attr = 'data-thumb', opt)   anexa todo <img data-thumb="url">
   ThumbLoader.blocks(root, { size })  modo BLOCOS (como a lista do Tag Manager): só o bloco
         visível (+ vizinho perto da borda) mantém miniatura na RAM; os demais são liberados.
         bloco = floor(data-i do card / size); anexe com { root } para entrar no modo.
     ThumbLoader.full(imgEl)        URL original de um <img> anexado
     ThumbLoader.forget(fullUrl)    descarta a miniatura de uma URL (ex.: revogada)
     ThumbLoader.clear()            descarta tudo (troca de pasta)
   URLs http(s) remotas não são reduzidas (vão direto para o src).
========================================================================= */
(function () {
    if (window.ThumbLoader) return;

    const PARALLEL = 4;
    const cache = new Map();          // fullUrl -> { url, width, w, h }
    const pending = new Map();        // fullUrl -> Promise
    const observers = new Map();      // root (or 'window') -> IntersectionObserver
    const queue = [];
    let running = 0;

    const dpr = () => window.devicePixelRatio || 1;
    const bucket = css => Math.max(128, Math.ceil(Math.ceil(css * dpr()) / 128) * 128);

    function cssWidth(el, opt) {
        if (typeof opt.width === 'function') return opt.width() || 128;
        if (typeof opt.width === 'number') return opt.width;
        const w = el.getBoundingClientRect().width || el.clientWidth || (el.parentElement && el.parentElement.clientWidth) || 128;
        return w;
    }

    async function build(fullUrl, width, getBlob) {
        // getBlob: async () => Blob|File. Lets the caller open the file only now (lazy sources); fullUrl is then just a key.
        const blob = getBlob ? await getBlob() : await (await fetch(fullUrl)).blob();
        const bmp = await createImageBitmap(blob);
        const w = bmp.width, h = bmp.height;
        let url = null;
        if (w > width) {
            const tw = width, th = Math.max(1, Math.round(h * width / w));
            const c = document.createElement('canvas');
            c.width = tw; c.height = th;
            const ctx = c.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bmp, 0, 0, tw, th);
            const small = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
            c.width = c.height = 0;
            if (small) url = URL.createObjectURL(small);
        } else if (getBlob) {
            url = URL.createObjectURL(blob);                 // already small: show the file itself (fullUrl is not a real url)
        }
        bmp.close();
        return { url, width, w, h };
    }

    function apply(el, fullUrl, entry, opt) {
        if (el.dataset.full !== fullUrl) return;                // reaproveitado para outra imagem
        const src = entry && entry.url ? entry.url : fullUrl;
        if (el.getAttribute('src') !== src) el.src = src;
        if (entry && entry.w && typeof opt.onSize === 'function') opt.onSize(entry.w, entry.h);
    }

    function pump() {
        while (running < PARALLEL && queue.length) {
            const job = queue.shift();
            running++;
            job().finally(() => { running--; pump(); });
        }
    }

    function load(el, fullUrl, opt) {
        const width = bucket(cssWidth(el, opt));
        const have = cache.get(fullUrl);
        if (have && (have.width >= width || !have.url)) { apply(el, fullUrl, have, opt); return; }
        let p = pending.get(fullUrl);
        if (!p) {
            p = new Promise(resolve => {
                queue.push(() => build(fullUrl, width, opt.getBlob)
                    .then(entry => {
                        const old = cache.get(fullUrl);
                        if (old && old.url && old.url !== entry.url) URL.revokeObjectURL(old.url);
                        cache.set(fullUrl, entry);
                        resolve(entry);
                    })
                    .catch(() => resolve(null))          // formato que o navegador não reduz: usa a original
                    .finally(() => pending.delete(fullUrl)));
                pump();
            });
            pending.set(fullUrl, p);
        }
        p.then(entry => apply(el, fullUrl, entry, opt));
    }

    function observerFor(root) {
        const key = root || 'window';
        let io = observers.get(key);
        if (!io) {
            io = new IntersectionObserver(entries => entries.forEach(en => {
                if (!en.isIntersecting) return;
                io.unobserve(en.target);
                const job = en.target._thumbJob;
                if (job) load(en.target, job.url, job.opt);
            }), { root: root || null, rootMargin: '400px' });
            observers.set(key, io);
        }
        return io;
    }


    /* =====================================================================
       BLOCK MODE (same system as the Tag Manager image list)
       ---------------------------------------------------------------------
       ThumbLoader.blocks(scrollRoot, { size: () => imagesPerPage [, axis: 'x'|'y'] })   (axis: auto-detected)
       Every <img> attached with { root: scrollRoot } joins the block system:
         - block = floor(index / size), index = data-i of the card that holds the <img>
           (so a block is exactly one page of the "items per page" button);
         - only the block(s) around the visible area keep a thumbnail in memory;
           every other block is released (blob revoked, src removed) and rebuilt
           when it comes back;
         - the NEXT / PREVIOUS block is preloaded when the visible area gets
           within a few rows of the block edge, so scrolling never shows empty cards;
         - work for blocks that are no longer wanted is dropped before decoding.
       ===================================================================== */
    const managers = new Map();       // scroll root -> manager

    function makeManager(root, cfg) {
        const EDGE_MIN = 8, MAX_RETRY = 2;
        const rows = new Set();         // managed <img>
        const live = new Set();         // <img> currently holding a thumbnail
        const store = new Map();        // source url -> entry { url, width, w, h, srcUrl, holders:Set }
        const building = new Map();     // source url -> Promise<entry>
        const blockOf = new WeakMap();  // <img> -> block index (last computed)
        let queue = [], running = 0, wanted = new Set(), raf = 0, gen = 0;

        const size = () => Math.max(1, Math.floor(Number(typeof cfg.size === 'function' ? cfg.size() : cfg.size)) || 100);
        const shown = el => el.isConnected && el.getClientRects().length > 0;
        const idxOf = (el, fallback) => {
            const o = el._bt && el._bt.opt;
            if (o && typeof o.index === 'number') return o.index;                      // strips: position in the strip
            const c = el.closest('[data-i],[data-j]');
            const raw = c ? (c.dataset.i !== undefined ? c.dataset.i : c.dataset.j) : undefined;
            const n = raw === undefined ? NaN : Number(raw);
            return isFinite(n) ? n : fallback;
        };
        // scroll axis: vertical for grids/lists, horizontal for a row-flex strip (re-read on every pass: the layout can flip)
        const axisX = () => {
            if (cfg.axis) return cfg.axis === 'x';
            const cs = getComputedStyle(root);
            return /flex/.test(cs.display) && /^row/.test(cs.flexDirection);
        };
        const revoke = u => { if (u) { try { URL.revokeObjectURL(u); } catch (x) {} } };

        function unhold(el, e) {
            e.holders.delete(el);
            if (e.holders.size) return;
            revoke(e.url);
            if (store.get(e.srcUrl) === e) store.delete(e.srcUrl);
        }

        function adopt(el, e) {
            const st = el._bt;
            if (!st) return;
            const old = st.entry;
            if (old && old !== e) unhold(el, old);
            st.entry = e;
            e.holders.add(el);
            const src = e.url || st.url;
            if (el.getAttribute('src') !== src) el.src = src;
            live.add(el);
            if (e.w && st.opt && typeof st.opt.onSize === 'function') st.opt.onSize(e.w, e.h);
        }

        function release(el) {
            live.delete(el);
            const st = el._bt;
            if (st && st.entry) {
                const e = st.entry;
                st.entry = null;
                if (!el.style.aspectRatio && e.w && e.h && getComputedStyle(el).aspectRatio === 'auto') el.style.aspectRatio = e.w + ' / ' + e.h;   // keep the card size
                unhold(el, e);
            }
            el.removeAttribute('src');
        }

        function drop(el) {                 // card left the DOM
            rows.delete(el);
            release(el);
            if (el._bt) el._bt.queued = false;
        }

        const isWanted = el => el.isConnected && wanted.has(blockOf.get(el));
        const fresh = (e, width) => e && (e.width >= width || !e.url);

        async function job(el) {
            const st = el._bt;
            if (!st || !isWanted(el)) return;
            const myGen = gen, url = st.url;
            try {
                const width = bucket(cssWidth(el, st.opt));
                let e = store.get(url);
                if (!fresh(e, width)) {
                    let p = building.get(url);
                    if (!p) {
                        p = build(url, width, st.opt && st.opt.getBlob).then(r => ({ url: r.url, width: r.width, w: r.w, h: r.h, srcUrl: url, holders: new Set() }));
                        building.set(url, p);
                        p.then(() => building.delete(url), () => building.delete(url));
                    }
                    e = await p;
                    const cur = store.get(url);
                    if (cur && cur !== e && fresh(cur, e.width)) { if (!e.holders.size) revoke(e.url); e = cur; }
                    else store.set(url, e);
                }
                if (myGen !== gen || el._bt !== st || st.url !== url || !isWanted(el)) {      // stale: nobody wants it anymore
                    if (!e.holders.size) { revoke(e.url); if (store.get(url) === e) store.delete(url); }
                    return;
                }
                st.fail = 0;
                adopt(el, e);
            } catch (err) {
                st.fail = (st.fail || 0) + 1;
                if (st.fail > MAX_RETRY && myGen === gen && el._bt === st) {   // format the browser cannot reduce: use the original
                    let own = null;
                    if (st.opt && st.opt.getBlob) { try { own = URL.createObjectURL(await st.opt.getBlob()); } catch (x) {} }
                    if (myGen === gen && el._bt === st) adopt(el, { url: own, width: 99999, w: 0, h: 0, srcUrl: url, holders: new Set() });
                    else revoke(own);
                }
            }
        }

        function pump() {
            while (running < PARALLEL && queue.length) {
                const el = queue.shift();
                running++;
                job(el).finally(() => { if (el._bt) el._bt.queued = false; running--; pump(); });
            }
        }

        function request(el) {
            const st = el._bt;
            if (!st) return;
            const width = bucket(cssWidth(el, st.opt));
            if (fresh(st.entry, width)) {
                const src = st.entry.url || st.url;
                if (el.getAttribute('src') !== src) el.src = src;
                live.add(el);
                return;
            }
            const s = store.get(st.url);
            if (fresh(s, width)) { adopt(el, s); return; }
            if (st.queued) return;
            st.queued = true;
            queue.push(el);
            pump();
        }

        function sync() {
            raf = 0;
            rows.forEach(el => { if (!el.isConnected) drop(el); });
            if (!root.getClientRects().length) return;              // grid not on screen: keep what is loaded
            const items = [];
            let ord = 0;
            rows.forEach(el => { if (shown(el)) items.push({ el, i: idxOf(el, ord) }); ord++; });
            if (!items.length) { Array.from(live).forEach(release); queue = []; return; }
            items.sort((a, b) => a.i - b.i);
            const sz = size();
            items.forEach(o => blockOf.set(o.el, Math.floor(o.i / sz)));

            const X = axisX();
            const rr = root.getBoundingClientRect();
            const lo = X ? rr.left : rr.top, hi = X ? rr.right : rr.bottom;
            const vis = items.filter(o => { const r = o.el.getBoundingClientRect(); return (X ? r.right : r.bottom) > lo && (X ? r.left : r.top) < hi; });
            if (!vis.length) return;
            const first = vis[0].i, last = vis[vis.length - 1].i;
            let perRow = 1;
            if (!X) {
                const t0 = vis[0].el.getBoundingClientRect().top;
                perRow = 0;
                for (const o of vis) { if (Math.abs(o.el.getBoundingClientRect().top - t0) < 2) perRow++; else break; }
            }
            const edge = Math.max(EDGE_MIN, perRow * 3);
            const bF = Math.floor(first / sz), bL = Math.floor(last / sz);
            const maxBlock = Math.floor(items[items.length - 1].i / sz);

            const want = new Set();
            for (let b = bF; b <= bL; b++) want.add(b);
            if (first - bF * sz < edge && bF > 0) want.add(bF - 1);                    // preload previous block
            if ((bL + 1) * sz - 1 - last < edge && bL < maxBlock) want.add(bL + 1);    // preload next block
            wanted = want;

            // request order: what is on screen, then the wanted blocks (closest to the screen first)
            const order = vis.map(o => o.el);
            const seen = new Set(order);
            Array.from(want).sort((a, b) => Math.abs(a - bF) - Math.abs(b - bF)).forEach(b => {
                const ref = b < bF ? first : (b > bL ? last : first);
                items.filter(o => blockOf.get(o.el) === b && !seen.has(o.el))
                     .sort((x, y) => Math.abs(x.i - ref) - Math.abs(y.i - ref))
                     .forEach(o => { order.push(o.el); seen.add(o.el); });
            });
            order.forEach(request);

            // release every thumbnail outside the wanted blocks
            Array.from(live).forEach(el => {
                const b = blockOf.get(el);
                if (!shown(el) || b === undefined || !want.has(b)) release(el);
            });
            queue = queue.filter(el => { const ok = isWanted(el); if (!ok && el._bt) el._bt.queued = false; return ok; });
        }
        const schedule = () => { if (!raf) raf = requestAnimationFrame(sync); };

        root.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        new MutationObserver(muts => { if (muts.some(m => m.type === 'childList' || m.target.nodeName !== 'IMG')) schedule(); })
            .observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
        new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

        return {
            cfg,
            add(el, url, opt) {
                const prev = el._bt;
                if (prev && prev.url !== url) release(el);                       // <img> reused for another image
                const st = prev && prev.url === url ? prev : { url, opt, entry: null, queued: false, fail: 0 };
                st.opt = opt;
                el._bt = st;
                el.dataset.full = url;
                rows.add(el);
                const s = store.get(url);
                if (!st.entry && s) adopt(el, s);                                // already decoded: show right away
                else if (!st.entry && el.getAttribute('src') && el.getAttribute('src') !== url) el.removeAttribute('src');
                schedule();
            },
            forget(url) {
                const e = store.get(url);
                if (!e) return;
                store.delete(url);
                if (!e.holders.size) revoke(e.url);
            },
            clear() {
                gen++;
                queue = [];
                Array.from(rows).forEach(el => { release(el); if (el._bt) el._bt.queued = false; });
                rows.clear(); live.clear(); wanted = new Set();
                store.forEach(e => revoke(e.url));
                store.clear();
            },
            sync: schedule,
            liveCount: () => live.size,
            wantedBlocks: () => Array.from(wanted).sort((a, b) => a - b)
        };
    }

    function attach(el, fullUrl, opt) {
        if (!el || !fullUrl) return;
        opt = opt || {};
        el.dataset.full = fullUrl;
        if (!/^(blob:|data:)/i.test(fullUrl) && /^https?:/i.test(fullUrl)) { if (el.src !== fullUrl) el.src = fullUrl; return; }
        if (opt.root && managers.has(opt.root)) { managers.get(opt.root).add(el, fullUrl, opt); return; }   // block mode
        const have = cache.get(fullUrl);
        if (have && have.url) el.src = have.url;               // mostra já o que tem (pode refinar depois)
        else if (el.getAttribute('src') && el.getAttribute('src') !== fullUrl) el.removeAttribute('src');
        if (typeof IntersectionObserver !== 'function') { load(el, fullUrl, opt); return; }
        el._thumbJob = { url: fullUrl, opt };
        observerFor(opt.root).observe(el);
    }

    function forget(fullUrl) {
        managers.forEach(m => m.forget(fullUrl));
        const e = cache.get(fullUrl);
        if (e && e.url) { try { URL.revokeObjectURL(e.url); } catch (x) {} }
        cache.delete(fullUrl);
    }

    window.ThumbLoader = {
        attach,
        scan(container, attr, opt) {
            attr = attr || 'data-thumb';
            if (!container) return;
            container.querySelectorAll('img[' + attr + ']').forEach(el => attach(el, el.getAttribute(attr), opt || {}));
        },
        /* Turns on block mode for a scroll root. Idempotent; size() is read on every pass. */
        blocks(root, cfg) {
            if (!root) return null;
            let m = managers.get(root);
            if (!m) { m = makeManager(root, cfg || {}); managers.set(root, m); }
            else if (cfg && cfg.size !== undefined) m.cfg.size = cfg.size;
            return m;
        },
        blockInfo: root => { const m = managers.get(root); return m ? { live: m.liveCount(), blocks: m.wantedBlocks() } : null; },
        full: el => (el && el.dataset.full) || (el && el.src) || '',
        forget,
        clear() {
            managers.forEach(m => m.clear());
            queue.length = 0;
            observers.forEach(io => io.disconnect());
            observers.clear();
            Array.from(cache.keys()).forEach(forget);
        },
        _cacheSize: () => cache.size
    };
})();
