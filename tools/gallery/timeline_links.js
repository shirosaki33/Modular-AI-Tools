/**
 * tools/gallery/timeline_links.js
 * Timeline only. In the background, after an image is opened, reads the hashes stored in the PNG
 * (same idea as the PNG Reader), asks Civitai about them and turns the Checkpoint / LoRA text into a
 * blue link when the hash is found. When it is not found (or there is no hash / no internet) the
 * text stays exactly as it was (plain white). The saved JSON is never touched: only the display changes.
 */
(function () {
    'use strict';
    const API = 'https://civitai.com/api/v1/model-versions/by-hash/';
    const cache = new Map();          // hash -> data | null
    let token = 0;

    const css = document.createElement('style');
    css.textContent = `
        .tl-linked > input[readonly] { display: none !important; }
        .tl-linked > a.tl-link { display: block; }
        .tl-linked > input:not([readonly]) ~ a.tl-link { display: none !important; }
        a.tl-link { display: none; color: #4db8ff; text-decoration: none; padding: 6px 8px; font-size: 13px;
                    overflow-wrap: anywhere; line-height: 1.35; flex: 1; min-width: 0; }
        a.tl-link:hover { text-decoration: underline; }`;
    document.head.appendChild(css);

    function cleanName(x) {
        return String(x || '').replace(/["'<>]/g, '').replace(/\\/g, '/').split('/').pop()
            .replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '').trim();
    }

    function hashesFromRaw(raw) {
        const map = new Map();
        let m;
        const re1 = /([^"',\s:]+)\s*:\s*([a-fA-F0-9]{8,64})\b/g;
        while ((m = re1.exec(raw)) !== null) {
            const n = cleanName(m[1]).toLowerCase();
            if (!['hash', 'model', 'seed', 'steps', 'sampler', 'version', 'ti'].includes(n)) map.set(n, m[2].toLowerCase());
        }
        const re2 = /"(?:lora_name|name|model_name)"\s*:\s*"([^"]+)"[\s\S]{0,240}?"(?:hash|sha256|autov2|sshs_model_hash)"\s*:\s*"?([a-fA-F0-9]{8,64})"?/gi;
        while ((m = re2.exec(raw)) !== null) map.set(cleanName(m[1]).toLowerCase(), m[2].toLowerCase());
        return map;
    }

    function ckptHash(raw) {
        let m = raw.match(/\b(?:Model hash|Checkpoint hash)\s*:\s*([a-f0-9]{8,64})\b/i);
        if (m) return m[1].toLowerCase();
        m = raw.match(/"(?:model_hash|checkpoint_hash|modelHash)"\s*:\s*"([a-f0-9]{8,64})"/i);
        return m ? m[1].toLowerCase() : '';
    }

    async function readRaw(item) {
        if (!item || !item.file || !/\.png$/i.test(item.file.name) || typeof window.lerChunksPNG !== 'function') return '';
        const chunks = await window.lerChunksPNG(item.file);
        const parts = [];
        for (const [k, v] of chunks.entries()) if (k !== 'workflow' && typeof v === 'string') parts.push(v);
        return parts.join('\n');
    }

    async function lookup(hash) {
        if (!hash) return null;
        if (cache.has(hash)) return cache.get(hash);
        try {
            const r = await fetch(API + encodeURIComponent(hash), { signal: AbortSignal.timeout(10000) });
            if (!r.ok) { if (r.status === 404) cache.set(hash, null); return null; }
            const d = await r.json();
            cache.set(hash, d);
            return d;
        } catch (e) { return null; }
    }

    function link(input, data) {
        if (!data || !data.modelId || !input.parentNode) return;
        const parent = input.parentNode;
        parent.querySelectorAll(':scope > a.tl-link').forEach(a => a.remove());
        const a = document.createElement('a');
        a.className = 'tl-link';
        a.href = 'https://civitai.com/models/' + data.modelId + (data.id ? '?modelVersionId=' + data.id : '');
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = input.value;
        a.title = (data.model && data.model.name ? data.model.name : data.name || 'Open on Civitai') + ' — open on Civitai';
        parent.appendChild(a);
        parent.classList.add('tl-linked');
    }

    function clearLinks() {
        document.querySelectorAll('a.tl-link').forEach(a => a.remove());
        document.querySelectorAll('.tl-linked').forEach(e => e.classList.remove('tl-linked'));
    }

    function loraKey(value, map) {
        const v = String(value || '').replace(/^<lora:/i, '');
        const base = cleanName(v.split(/[:|(]/)[0]).toLowerCase();
        if (map.has(base)) return map.get(base);
        for (const [k, h] of map) if (k && base && (base.includes(k) || k.includes(base))) return h;
        return '';
    }

    async function run() {
        const my = ++token;
        clearLinks();
        const item = typeof tlCurrent !== 'undefined' ? tlCurrent : null;
        let raw = '';
        try { raw = await readRaw(item); } catch (e) { return; }
        if (my !== token || !raw) return;
        const map = hashesFromRaw(raw);
        const jobs = [];
        const ck = document.getElementById('val-ckpt');
        const ch = ckptHash(raw);
        if (ck && ck.value && ch) jobs.push(lookup(ch).then(d => { if (my === token) link(ck, d); }));
        document.querySelectorAll('#loras-container .lora-input').forEach(inp => {
            const h = loraKey(inp.value, map);
            if (h) jobs.push(lookup(h).then(d => { if (my === token) link(inp, d); }));
        });
        await Promise.all(jobs);
    }

    const prev = window.fillFields;
    window.fillFields = function (d) {
        const r = prev.apply(this, arguments);
        token++; clearLinks();
        if (d && (d.ckpt || d.loras)) setTimeout(run, 0);
        return r;
    };
})();
