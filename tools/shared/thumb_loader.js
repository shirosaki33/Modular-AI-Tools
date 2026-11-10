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
     ThumbLoader.attach(imgEl, fullUrl, { root, width, onSize })
         root   elemento com scroll (padrão: a janela)
         width  número ou função () => largura CSS em px (padrão: largura do <img>)
         onSize (w, h) resolução real da imagem, quando conhecida
     ThumbLoader.scan(container, attr = 'data-thumb')   anexa todo <img data-thumb="url">
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

    async function build(fullUrl, width) {
        const blob = await (await fetch(fullUrl)).blob();
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
                queue.push(() => build(fullUrl, width)
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

    function attach(el, fullUrl, opt) {
        if (!el || !fullUrl) return;
        opt = opt || {};
        el.dataset.full = fullUrl;
        if (!/^(blob:|data:)/i.test(fullUrl) && /^https?:/i.test(fullUrl)) { if (el.src !== fullUrl) el.src = fullUrl; return; }
        const have = cache.get(fullUrl);
        if (have && have.url) el.src = have.url;               // mostra já o que tem (pode refinar depois)
        else if (el.getAttribute('src') && el.getAttribute('src') !== fullUrl) el.removeAttribute('src');
        if (typeof IntersectionObserver !== 'function') { load(el, fullUrl, opt); return; }
        el._thumbJob = { url: fullUrl, opt };
        observerFor(opt.root).observe(el);
    }

    function forget(fullUrl) {
        const e = cache.get(fullUrl);
        if (e && e.url) { try { URL.revokeObjectURL(e.url); } catch (x) {} }
        cache.delete(fullUrl);
    }

    window.ThumbLoader = {
        attach,
        scan(container, attr) {
            attr = attr || 'data-thumb';
            if (!container) return;
            container.querySelectorAll('img[' + attr + ']').forEach(el => attach(el, el.getAttribute(attr), {}));
        },
        full: el => (el && el.dataset.full) || (el && el.src) || '',
        forget,
        clear() {
            queue.length = 0;
            observers.forEach(io => io.disconnect());
            observers.clear();
            Array.from(cache.keys()).forEach(forget);
        },
        _cacheSize: () => cache.size
    };
})();
