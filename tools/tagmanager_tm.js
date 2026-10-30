/* =========================================================================
   TM — EVENT BUS + TAG MODEL
   ---------------------------------------------------------------------
   Carrega logo depois de tagmanager_globals.js, antes de qualquer plugin.

   1) BARRAMENTO DE EVENTOS
      TM.on(evento, fn, prioridade?) / TM.off(evento, fn) / TM.emit(evento, ...args)
      Os eventos de render/dataset são disparados por tagmanager_render_hooks.js
      (lista completa lá). Plugins só ESCUTAM — não substituem funções núcleo.

   2) TAG MODEL — um só lugar para ler/escrever as tags de uma imagem.
      TM.tags.split(content)              -> ['a', 'b']
      TM.tags.get(img)                    -> tags da imagem
      TM.tags.set(img, arr)               -> grava (sem marcar dirty)
      TM.tags.add(imgs, tags, pos)        -> imagens alteradas (marca dirty)
      TM.tags.remove(imgs, tags)          -> imagens alteradas (marca dirty)
      TM.tags.replace(imgs, old, new)     -> imagens alteradas (marca dirty;
                                             comparação sem diferenciar maiúsculas)
      TM.tags.refreshViews()              -> refresh único (datalist, listas,
                                             editor, filtros)
      Todas disparam 'tags:changed' (imgs).
========================================================================= */

(function () {
    const TM = window.TM = window.TM || {};

    /* ---------- BUS ---------- */
    const listeners = TM._listeners = TM._listeners || {};
    // priority: menor roda primeiro (padrão 0). Mesma prioridade = ordem de registro.
    TM.on = TM.on || function (evt, fn, priority = 0) {
        if (typeof fn !== 'function') return;
        fn.__tmPriority = priority;
        const arr = listeners[evt] = listeners[evt] || [];
        let i = arr.length;
        while (i > 0 && (arr[i - 1].__tmPriority || 0) > priority) i--;
        arr.splice(i, 0, fn);
    };
    TM.off = TM.off || function (evt, fn) {
        const arr = listeners[evt];
        if (arr) listeners[evt] = arr.filter(f => f !== fn);
    };
    TM.emit = TM.emit || function (evt, ...args) {
        (listeners[evt] || []).slice().forEach(fn => {
            try { fn(...args); } catch (e) { console.warn(`[TM] "${evt}" listener failed:`, e); }
        });
    };
    TM.onDatasetLoaded = fn => TM.on('dataset:loaded', fn);

    // Compat com a API antiga (render hooks).
    window.registerPostRenderImageList = fn => TM.on('render:list', fn);
    window.registerPostRenderEditor = fn => TM.on('render:editor', fn);
    window.registerPostRenderMasterTagList = fn => TM.on('render:master', fn);
    window.registerPostApplyFilters = fn => TM.on('filters:applied', fn);

    /* ---------- TAG MODEL ---------- */
    const split = content => content ? String(content).split(',').map(t => t.trim()).filter(t => t) : [];
    const toArr = v => v == null ? [] : (Array.isArray(v) ? v : (v instanceof Set ? Array.from(v) : [v]));
    const defaultExt = () => {
        const sel = document.getElementById('topbar-save-format');
        return sel ? sel.value : 'txt';
    };
    const markDirty = imgs => { if (imgs.length && typeof window.markDirty === 'function') window.markDirty(imgs); };

    function set(img, tags) {
        img.content = toArr(tags).join(', ');
    }

    function add(imgs, tags, position = 'bottom') {
        const list = toArr(tags).map(t => String(t).trim()).filter(t => t);
        if (!list.length) return [];
        const changed = [];
        toArr(imgs).forEach(img => {
            if (!img) return;
            const cur = split(img.content);
            const missing = list.filter(t => !cur.includes(t));
            img.type = 'tags';
            if (!img.ext) img.ext = defaultExt();
            const wasEmpty = !img.hasFile;
            img.hasFile = true;
            if (!missing.length && !wasEmpty) return;
            img.content = (position === 'top' ? [...missing, ...cur] : [...cur, ...missing]).join(', ');
            changed.push(img);
        });
        if (typeof masterTagSet !== 'undefined') list.forEach(t => masterTagSet.add(t));
        markDirty(changed);
        if (changed.length) TM.emit('tags:changed', changed);
        return changed;
    }

    function remove(imgs, tags) {
        const drop = new Set(toArr(tags));
        if (!drop.size) return [];
        const changed = [];
        toArr(imgs).forEach(img => {
            if (!img || !img.content) return;
            const cur = split(img.content);
            const next = cur.filter(t => !drop.has(t));
            if (next.length === cur.length) return;
            img.content = next.join(', ');
            changed.push(img);
        });
        markDirty(changed);
        if (changed.length) TM.emit('tags:changed', changed);
        return changed;
    }

    function replace(imgs, oldTag, newTag) {
        const oldLower = String(oldTag || '').trim().toLowerCase();
        const nt = String(newTag || '').trim();
        if (!oldLower || !nt) return [];
        const changed = [];
        toArr(imgs).forEach(img => {
            if (!img || !img.content) return;
            const cur = split(img.content);
            if (!cur.some(t => t.toLowerCase() === oldLower)) return;
            img.content = [...new Set(cur.map(t => t.toLowerCase() === oldLower ? nt : t))].join(', ');
            img.hasFile = true;
            changed.push(img);
        });
        if (changed.length && typeof masterTagSet !== 'undefined') {
            Array.from(masterTagSet).forEach(t => { if (t.toLowerCase() === oldLower) masterTagSet.delete(t); });
            masterTagSet.add(nt);
        }
        markDirty(changed);
        if (changed.length) TM.emit('tags:changed', changed);
        return changed;
    }

    /* Refresh de todas as vistas numa chamada só. Padrão: na hora (o chamador
       pode precisar do DOM atualizado logo em seguida). opts.defer = true junta
       várias chamadas do mesmo tick num refresh só. */
    let refreshQueued = false;
    function doRefresh() {
        refreshQueued = false;
        if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
        if (typeof window.renderImageList === 'function') window.renderImageList();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.renderEditor === 'function') window.renderEditor();
        // renderImageList já chama applyFilters no fim.
    }
    function refreshViews(opts) {
        if (!(opts && opts.defer)) { doRefresh(); return; }
        if (refreshQueued) return;
        refreshQueued = true;
        Promise.resolve().then(doRefresh);
    }

    TM.tags = {
        split,
        get: img => split(img && img.content),
        set, add, remove, replace,
        refreshViews,
        selectedImages: () => (typeof selectedIndices !== 'undefined' && typeof imageFiles !== 'undefined')
            ? Array.from(selectedIndices).map(i => imageFiles[i]).filter(Boolean) : [],
        visibleImages: () => (typeof imageFiles !== 'undefined') ? imageFiles.filter(img => !img.hidden) : []
    };

    /* ---------- RESOLUÇÃO PELO CABEÇALHO DO ARQUIVO ----------
       Lê só o começo do arquivo (PNG IHDR / JPEG SOFn / WEBP VP8 VP8L VP8X) em
       vez de decodificar a imagem inteira. Cache em img._resolution.
       Cai para new Image() só se o formato não for reconhecido. */
    function parseSize(buf) {
        const v = new DataView(buf);
        const u8 = new Uint8Array(buf);
        const len = u8.length;
        // PNG
        if (len > 24 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) {
            return { w: v.getUint32(16), h: v.getUint32(20) };
        }
        // JPEG
        if (len > 4 && u8[0] === 0xFF && u8[1] === 0xD8) {
            let i = 2;
            while (i + 9 < len) {
                if (u8[i] !== 0xFF) { i++; continue; }
                const m = u8[i + 1];
                if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xFF) { i += (m === 0xFF ? 1 : 2); continue; }
                const segLen = v.getUint16(i + 2);
                if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
                    return { w: v.getUint16(i + 7), h: v.getUint16(i + 5) };
                }
                i += 2 + segLen;
            }
            return null;
        }
        // WEBP
        if (len > 30 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) {
            const chunk = String.fromCharCode(u8[12], u8[13], u8[14], u8[15]);
            if (chunk === 'VP8 ') return { w: v.getUint16(26, true) & 0x3FFF, h: v.getUint16(28, true) & 0x3FFF };
            if (chunk === 'VP8L') {
                const b = v.getUint32(21, true);
                return { w: (b & 0x3FFF) + 1, h: ((b >> 14) & 0x3FFF) + 1 };
            }
            if (chunk === 'VP8X') {
                return { w: 1 + (u8[24] | (u8[25] << 8) | (u8[26] << 16)), h: 1 + (u8[27] | (u8[28] << 8) | (u8[29] << 16)) };
            }
        }
        return null;
    }
    TM.parseImageSize = parseSize;

    function sizeViaImage(url) {
        return new Promise(resolve => {
            const probe = new Image();
            probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
            probe.onerror = () => resolve(null);
            probe.src = url;
        });
    }

    TM.getImageSize = async function (img) {
        if (!img) return null;
        if (img._resolution) return img._resolution;
        let size = null;
        try {
            const file = img.handle && typeof img.handle.getFile === 'function' ? await img.handle.getFile() : null;
            if (file) size = parseSize(await file.slice(0, 512 * 1024).arrayBuffer());
        } catch (e) {}
        if (!size && img.url) size = await sizeViaImage(img.url);
        if (size && size.w > 0 && size.h > 0) img._resolution = size;
        return img._resolution || null;
    };
    // Muda o arquivo (crop do bucket, rename...): esquece a resolução guardada.
    TM.forgetImageSize = img => { if (img) delete img._resolution; };

    /* ---------- _tagger_config.json com debounce ----------
       Estrela, conversão NL, reordenação... antes gravavam o arquivo a cada
       clique. Agora: 1 gravação ~1 s depois da última mudança. A referência
       da pasta E do objeto de config são capturadas no agendamento, então
       trocar de pasta nunca grava a config de um dataset na pasta de outro;
       e loadGallery/loadSubDir* chamam TM.flushDatasetConfig() antes de trocar. */
    let cfgTimer = null, cfgPending = null, cfgWaiters = [];
    async function writeConfig(job) {
        try {
            const h = await job.handle.getFileHandle('_tagger_config.json', { create: true });
            const w = await h.createWritable();
            await w.write(JSON.stringify(job.config, null, 2));
            await w.close();
        } catch (e) { console.warn('[TM] Could not save _tagger_config.json', e); }
    }
    TM.flushDatasetConfig = async function () {
        clearTimeout(cfgTimer); cfgTimer = null;
        const job = cfgPending, waiters = cfgWaiters;
        cfgPending = null; cfgWaiters = [];
        if (job) await writeConfig(job);
        waiters.forEach(r => r());
    };
    TM.scheduleDatasetConfigSave = function (handle, config) {
        if (!handle || !config) return Promise.resolve();
        if (cfgPending && (cfgPending.handle !== handle || cfgPending.config !== config)) TM.flushDatasetConfig();
        cfgPending = { handle, config };
        clearTimeout(cfgTimer);
        cfgTimer = setTimeout(TM.flushDatasetConfig, 1000);
        return new Promise(r => cfgWaiters.push(r));
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') TM.flushDatasetConfig(); });
})();
