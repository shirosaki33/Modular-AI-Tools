/* =========================================================================
   ASSISTANT (💬) — direct chat with a local vision model — standalone
   ---------------------------------------------------------------------
   Independent from the 🧐 Evaluator: its own server / model / settings.
   You attach one or more images, ask, and get direct tips (styles, tags,
   captions, cropping, training) — no need to run an evaluation.

   ATTACH IMAGES (strip above the input; ✕ removes one)
     ➕ Selected     the images selected in the list (with their caption, if
                     "Send captions" is on)
     📎              pick files from the computer
     drag & drop     image files onto the panel
     Ctrl+V          paste an image (screenshot, copied image)
   Images go only with the message they are attached to; the conversation
   history is text (+ small previews), so it stays light.

   ANSWERS
   - Tags written `like_this` become chips: click = add to the selected images
     of the list, Ctrl/⌘+click = copy. They are checked on Danbooru / e621
     (✓ exists · ↪ alias · ≈ closest real tag · ❔ not found).
   - Streams while the model writes; ⏹ stops. 📋 copy, ↻ ask again.

   SETTINGS (⚙️ in the panel title): backend (Ollama / OpenAI-compatible),
   URL, API key, vision model (only models that accept images are listed),
   temperature, image size, answer language, send captions. Saved.

   WINDOW: floating panel (not a popout) — keep working while it is open.
   Drag by the title, resize by the corner; position / size saved.
   ⚙️ Settings > 🤖 Local AI > 💬 Assistant turns it on / off (off by
   default, saved).
========================================================================= */

(function () {
    'use strict';

    const CFG_KEY = 'assistant-config';
    const HIST_KEY = 'assistant-chat';
    const MAX_HIST = 60, HIST_SENT = 12, MAX_ATTACH = 6;
    const $ = id => document.getElementById(id);
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const DEFAULT_CFG = {
        backend: 'ollama', urlOllama: 'http://127.0.0.1:11434', urlOpenAI: 'http://127.0.0.1:1234', apiKey: '',
        model: '', temperature: 0.5, maxSide: 1024, sendCaptions: true, language: 'auto',
        ui: { x: null, y: null, w: 440, h: 600 }
    };
    let cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
    let enabled = false;
    let chat = [];               // [{ role, text, ts, thumbs?: [dataUrl] }]
    let attach = [];             // [{ name, thumb, b64, dataUrl, w, h, caption }]
    let busy = null;
    let saveTimer = null;

    /* ---------- STYLES ---------- */
    const style = document.createElement('style');
    style.textContent = `
        #btn-assistant { flex-shrink:0; background:transparent; border:1px solid #444; color:#aaa; border-radius:6px; padding:2px 8px; font-size:14px; cursor:pointer; line-height:20px; margin-left:4px; }
        #btn-assistant:hover, #btn-assistant.open { color:#fff; border-color:#4db8ff; }
        #btn-assistant.busy { border-color:#4db8ff; animation: asPulse 1.2s infinite; }
        @keyframes asPulse { 50% { box-shadow:0 0 8px #4db8ff; } }

        #assistant-panel { position:fixed; z-index:9000; display:none; flex-direction:column; background:#121212; border:1px solid #1d4a6e; border-radius:10px;
            box-shadow:0 10px 36px rgba(0,0,0,.85); resize:both; overflow:hidden; min-width:330px; min-height:320px; font-size:12px; color:#ddd; }
        #assistant-panel.open { display:flex; }
        #assistant-panel.drop { outline:2px dashed #4db8ff; outline-offset:-6px; }
        .as-head { display:flex; align-items:center; gap:8px; padding:8px 10px; background:#0d1b27; border-bottom:1px solid #1d3d5c; cursor:move; user-select:none; }
        .as-title { font-weight:bold; color:#9ecfff; font-size:13px; }
        .as-sub { color:#777; font-size:11px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .as-hbtn { background:transparent; border:none; color:#888; cursor:pointer; font-size:14px; padding:0 3px; line-height:1; }
        .as-hbtn:hover, .as-hbtn.on { color:#fff; } .as-hbtn.x:hover { color:#ff5555; }

        .as-cfg { display:none; flex-direction:column; gap:6px; padding:8px 10px; border-bottom:1px solid #1d3d5c; background:#0f151b; max-height:55%; overflow-y:auto; }
        .as-cfg.open { display:flex; }
        .as-row { display:flex; align-items:center; gap:6px; }
        .as-row > .as-lbl { flex:0 0 92px; color:#9ecfff; font-weight:bold; font-size:11px; }
        .as-row input[type=text], .as-row input[type=password], .as-row select { flex:1; min-width:0; font-size:11px; background:#161616; color:#eee; border:1px solid #333; border-radius:4px; padding:3px 5px; }
        .as-row input[type=range] { flex:1; accent-color:#4db8ff; }
        .as-row .as-val { flex:0 0 44px; text-align:right; color:#888; font-size:10px; }
        .as-row label { display:flex; align-items:center; gap:5px; cursor:pointer; font-size:11px; }
        .as-row input[type=checkbox] { margin:0; accent-color:#4db8ff; }
        .as-mini { background:#161616; border:1px solid #444; color:#aaa; border-radius:4px; padding:2px 7px; cursor:pointer; font-size:11px; }
        .as-mini:hover { color:#fff; border-color:#888; }
        .as-status { font-size:10px; color:#777; }

        .as-quick { display:flex; flex-wrap:wrap; gap:4px; padding:6px 10px; border-bottom:1px solid #1c1c1c; }
        .as-q { background:#141414; border:1px dashed #3a3a3a; color:#aaa; border-radius:6px; padding:2px 7px; font-size:11px; cursor:pointer; }
        .as-q:hover { color:#fff; border-color:#4db8ff; }
        .as-msgs { flex:1; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:10px; }
        .as-msg { max-width:92%; padding:7px 10px; border-radius:10px; line-height:1.5; word-wrap:break-word; }
        .as-msg.user { align-self:flex-end; background:#1a3a5c; color:#e6f2ff; border-bottom-right-radius:3px; white-space:pre-wrap; }
        .as-msg.assistant { align-self:flex-start; background:#1b1b1b; border:1px solid #2a2a2a; border-bottom-left-radius:3px; }
        .as-msg.error { align-self:center; background:#2a1414; border:1px solid #6a2a2a; color:#ffaaaa; font-size:11px; }
        .as-thumbs { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:5px; }
        .as-thumbs img { width:48px; height:48px; object-fit:cover; border-radius:4px; border:1px solid #2a5a8c; }
        .as-msg.assistant p { margin:0 0 6px; } .as-msg.assistant p:last-child { margin-bottom:0; }
        .as-msg.assistant ul, .as-msg.assistant ol { margin:2px 0 6px 18px; padding:0; }
        .as-msg.assistant h4 { margin:6px 0 4px; color:#9ecfff; font-size:12px; }
        .as-msg.assistant pre { background:#0d0d0d; border:1px solid #2a2a2a; border-radius:6px; padding:6px; overflow-x:auto; font-size:11px; white-space:pre-wrap; }
        .as-tag { display:inline-block; background:#10261a; border:1px solid #1f6b45; color:#7fe0b0; border-radius:8px; padding:0 6px; margin:1px 0; font-size:11px; cursor:pointer; font-family:inherit; }
        .as-tag:hover { background:#1a3d2a; color:#fff; }
        .as-tag .as-tm { font-size:9px; margin-left:3px; }
        .as-tag.unk { background:#2a1d10; border-color:#6b4a1f; color:#ffcc88; }
        .as-tools { display:flex; gap:8px; margin-top:4px; }
        .as-tools button { background:transparent; border:none; color:#666; cursor:pointer; font-size:11px; padding:0; }
        .as-tools button:hover { color:#fff; }
        .as-typing { color:#4db8ff; font-size:11px; }
        .as-empty { color:#666; text-align:center; margin:auto 10px; line-height:1.6; }

        .as-attach { display:flex; gap:6px; align-items:center; padding:6px 10px 0; flex-wrap:wrap; }
        .as-att { position:relative; }
        .as-att img { width:52px; height:52px; object-fit:cover; border-radius:5px; border:1px solid #2a6a9c; display:block; }
        .as-att button { position:absolute; top:-6px; right:-6px; width:17px; height:17px; border-radius:50%; border:none; background:#aa2222; color:#fff; font-size:10px; cursor:pointer; line-height:17px; padding:0; }
        .as-att .as-cap { position:absolute; left:2px; bottom:2px; font-size:9px; background:rgba(0,0,0,.75); color:#7fe0b0; border-radius:4px; padding:0 3px; }
        .as-attbar { display:flex; gap:5px; align-items:center; padding:6px 10px 0; }
        .as-attbar .as-hint { color:#555; font-size:10px; margin-left:auto; }
        .as-input { display:flex; gap:6px; padding:8px 10px; border-top:1px solid #1c1c1c; background:#0f0f0f; }
        .as-input textarea { flex:1; resize:none; min-height:38px; max-height:140px; font-size:12px; line-height:1.4; background:#161616; color:#eee; border:1px solid #333; border-radius:6px; padding:6px 8px; }
        .as-send { background:#1d5a8c; color:#fff; border:none; border-radius:6px; padding:0 14px; font-weight:bold; cursor:pointer; }
        .as-send.stop { background:#aa2222; }
    `;
    document.head.appendChild(style);

    /* ---------- PERSISTENCE ---------- */
    async function loadAll() {
        if (typeof window.getSetting !== 'function') return;
        try {
            const c = await window.getSetting(CFG_KEY, null);
            if (c && typeof c === 'object') cfg = { ...DEFAULT_CFG, ...c, ui: { ...DEFAULT_CFG.ui, ...(c.ui || {}) } };
            const h = await window.getSetting(HIST_KEY, null);
            if (Array.isArray(h)) chat = h;
            enabled = !!(await window.getSetting('enable-assistant', false));
        } catch (e) { /* defaults */ }
    }
    function saveCfg() { if (typeof window.saveSetting === 'function') window.saveSetting(CFG_KEY, cfg); }
    function saveChat() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { if (typeof window.saveSetting === 'function') window.saveSetting(HIST_KEY, chat.filter(m => !m.streaming)); }, 600);
    }

    /* ---------- SERVER ---------- */
    const baseUrl = () => String(cfg.backend === 'ollama' ? cfg.urlOllama : cfg.urlOpenAI || '').replace(/\/+$/, '');
    const VISION_NAME_RE = /(vl\b|vl:|vl-|vision|llava|gemma3|gemma-3|gemma4|qwen3\.5|qwen3-vl|minicpm|moondream|pixtral|internvl|joycaption|molmo|smolvlm|florence|qvq|mllama|cogvlm|idefics|paligemma|mistral-small3)/i;

    async function listModels() {
        const base = baseUrl();
        if (cfg.backend === 'ollama') {
            const res = await fetch(base + '/api/tags');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const all = ((await res.json()).models || []).map(m => m.name).sort();
            const flags = await Promise.all(all.map(async n => {
                try {
                    const r = await fetch(base + '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: n }) });
                    if (!r.ok) return null;
                    const d = await r.json();
                    if (Array.isArray(d.capabilities)) return d.capabilities.includes('vision');
                    const fams = (d.details && d.details.families) || [];
                    return fams.some(f => /clip|mllama|vision/i.test(f)) || !!d.projector_info;
                } catch (e) { return null; }
            }));
            return { models: all.filter((n, i) => flags[i] === true || (flags[i] === null && VISION_NAME_RE.test(n))), total: all.length };
        }
        const headers = cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {};
        try {
            const r = await fetch(base + '/api/v0/models', { headers });          // LM Studio: has the model type
            if (r.ok) {
                const list = ((await r.json()).data || []).filter(m => m && m.id);
                if (list.some(m => m.type)) return { models: list.filter(m => m.type === 'vlm').map(m => m.id).sort(), total: list.length };
            }
        } catch (e) { /* not LM Studio */ }
        const res = await fetch(base + '/v1/models', { headers });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const all = ((await res.json()).data || []).map(m => m.id).sort();
        const vis = all.filter(n => VISION_NAME_RE.test(n));
        return { models: vis.length ? vis : all, total: all.length, unknown: !vis.length };
    }

    // Streams when possible; onToken(piece, fullSoFar).
    async function chatModel(messages, signal, onToken) {
        const base = baseUrl();
        let full = '';
        const readStream = async (res, parse) => {
            const reader = res.body.getReader(), dec = new TextDecoder();
            let rest = '';
            const take = l => { const t = parse(l.trim()); if (t) { full += t; onToken(t, full); } };
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                rest += dec.decode(value, { stream: true });
                const lines = rest.split('\n'); rest = lines.pop();
                lines.forEach(take);
            }
            if (rest.trim()) take(rest);
        };
        if (cfg.backend === 'ollama') {
            const res = await fetch(base + '/api/chat', {
                method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: cfg.model, stream: true, options: { temperature: cfg.temperature },
                    messages: messages.map(m => ({ role: m.role, content: m.content, ...(m.images && m.images.length ? { images: m.images.map(i => i.b64) } : {}) })) })
            });
            if (!res.ok) throw new Error('Ollama HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
            if (!res.body) { const d = await res.json(); return (d.message && d.message.content) || ''; }
            await readStream(res, l => { if (!l) return ''; try { const j = JSON.parse(l); return (j.message && j.message.content) || ''; } catch (e) { return ''; } });
            return full;
        }
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
        const res = await fetch(base + '/v1/chat/completions', {
            method: 'POST', signal, headers,
            body: JSON.stringify({ model: cfg.model, stream: true, temperature: cfg.temperature, max_tokens: 2000,
                messages: messages.map(m => ({ role: m.role, content: m.images && m.images.length
                    ? [{ type: 'text', text: m.content }, ...m.images.map(i => ({ type: 'image_url', image_url: { url: i.dataUrl } }))]
                    : m.content })) })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
        if (!res.body) { const d = await res.json(); return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || ''; }
        await readStream(res, l => {
            if (!l.startsWith('data:')) return '';
            const p = l.slice(5).trim();
            if (p === '[DONE]') return '';
            try { const j = JSON.parse(p); return (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || ''; } catch (e) { return ''; }
        });
        return full;
    }

    /* ---------- IMAGES ---------- */
    async function prepImage(blob, name, caption) {
        const bmp = await createImageBitmap(blob);
        const draw = (side, q) => {
            const s = Math.min(1, side / Math.max(bmp.width, bmp.height));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);          // transparent -> white
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bmp, 0, 0, c.width, c.height);
            const url = c.toDataURL('image/jpeg', q);
            c.width = c.height = 0;
            return url;
        };
        const dataUrl = draw(cfg.maxSide, 0.9), thumb = draw(96, 0.75);
        const out = { name: name || 'image', dataUrl, b64: dataUrl.split(',')[1], thumb, w: bmp.width, h: bmp.height, caption: caption || '' };
        bmp.close();
        return out;
    }
    function captionText(content) {
        // The app keeps natural language as "NL:..." entries (real commas stored as "，").
        const tags = [], nl = [];
        String(content || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => { if (/^NL:/i.test(t)) nl.push(t.slice(3).trim().replace(/，/g, ',')); else tags.push(t); });
        return [tags.length ? 'tags: ' + tags.join(', ') : '', nl.length ? 'natural-language caption: ' + nl.join(' ') : ''].filter(Boolean).join('\n   ');
    }
    async function addFiles(files) {
        for (const f of Array.from(files || [])) {
            if (attach.length >= MAX_ATTACH) { warnMax(); break; }
            if (!/^image\//.test(f.type)) continue;
            try { attach.push(await prepImage(f, f.name || 'pasted image', '')); } catch (e) { console.warn('[Assistant] image', e); }
        }
        renderAttach();
    }
    async function addSelected() {
        if (typeof selectedIndices === 'undefined' || typeof imageFiles === 'undefined' || !selectedIndices.size) { window.showAlert && window.showAlert('Select image(s) in the list first.', 'info'); return; }
        const imgs = Array.from(selectedIndices).sort((a, b) => a - b).map(i => imageFiles[i]).filter(Boolean);
        for (const img of imgs) {
            if (attach.length >= MAX_ATTACH) { warnMax(); break; }
            if (attach.some(a => a.src === img)) continue;
            try {
                const blob = img.handle && img.handle.getFile ? await img.handle.getFile() : await (await fetch(img.url)).blob();
                const a = await prepImage(blob, img.name, img.content || '');
                a.src = img;
                attach.push(a);
            } catch (e) { console.warn('[Assistant] image', img.name, e); }
        }
        renderAttach();
    }
    function warnMax() { window.showAlert && window.showAlert(`Max ${MAX_ATTACH} images per message.`, 'warn'); }

    /* ---------- SEND ---------- */
    function systemPrompt() {
        const lang = cfg.language === 'auto' ? 'ALWAYS answer in the same language the user writes in.' : `ALWAYS answer in ${cfg.language}.`;
        return [
            'You are a direct, practical assistant for people preparing LoRA / fine-tune TRAINING DATASETS for image models (Stable Diffusion 1.5, SDXL, Pony, Illustrious, Flux): art styles, coloring, composition, cropping, captioning with Danbooru / e621 tags or natural language, trigger tags, dataset balance and training settings.',
            'Give concrete tips the user can apply right away: what you see, what to change, exact tags, short steps. Be honest when something will not work. No filler.',
            lang,
            'Write EVERY caption tag you suggest inside backticks, e.g. `flat color`, `thick outlines` — the tool turns them into clickable chips. Use real Danbooru tag names (or e621 for furry content); invented trigger tags are fine.',
            'Attached images are labeled IMAGE 1, IMAGE 2... in the message — refer to them that way. Only describe what you actually see.'
        ].join('\n');
    }

    async function send(text, opts) {
        opts = opts || {};
        text = String(text || '').trim();
        if (busy) return;
        if (!text && !attach.length) return;
        if (!text) text = attach.length > 1 ? 'What do you see in these images? Any tips for a training dataset?' : 'What do you see in this image? Any tips for a training dataset?';
        if (!cfg.model) { toggleCfg(true); pushError('Choose a vision model first (⚙️ above — 🔄 loads the list).'); return; }
        const imgs = opts.retry ? [] : attach.splice(0);
        renderAttach();
        if (!opts.retry) chat.push({ role: 'user', text, ts: Date.now(), thumbs: imgs.map(i => i.thumb) });
        const live = { role: 'assistant', text: '', ts: Date.now(), streaming: true };
        chat.push(live);
        trim(); render();

        const ctrl = new AbortController();
        busy = { abort: () => ctrl.abort() };
        syncBusy();
        try {
            const labels = imgs.map((im, i) => `IMAGE ${i + 1} = "${im.name}" (${im.w}x${im.h})` + (cfg.sendCaptions && im.caption ? `\n   current caption — ${captionText(im.caption)}` : ''));
            const prior = chat.slice(0, -2).filter(m => m.role === 'user' || m.role === 'assistant').slice(-HIST_SENT)
                .map(m => ({ role: m.role, content: m.text + (m.thumbs && m.thumbs.length ? `\n[${m.thumbs.length} image(s) were attached to this message]` : '') }));
            const content = (labels.length ? 'ATTACHED IMAGES:\n' + labels.join('\n') + '\n\n' : '') + text;
            const messages = [{ role: 'system', content: systemPrompt() }, ...prior, { role: 'user', content, images: imgs }];
            let last = 0;
            const full = await chatModel(messages, ctrl.signal, (_, all) => {
                live.text = all;
                if (Date.now() - last > 80) { last = Date.now(); paintLive(live); }
            });
            live.text = full || live.text || '(empty answer)';
        } catch (e) {
            if (e && e.name === 'AbortError') live.text = (live.text || '') + '\n\n*(stopped)*';
            else { chat.pop(); pushError('Could not get an answer: ' + (e.message || e) + ' — check the server / model in ⚙️ (the model must accept images when images are attached; CORS must allow this page).', true); }
        } finally {
            delete live.streaming;
            busy = null;
            syncBusy(); trim(); saveChat(); render();
        }
    }
    function pushError(t, silentRender) { chat.push({ role: 'error', text: t, ts: Date.now() }); trim(); saveChat(); if (!silentRender) render(); }
    function trim() { if (chat.length > MAX_HIST) chat = chat.slice(-MAX_HIST); }

    /* ---------- RENDER ---------- */
    function md(src) {
        const blocks = [];
        let s = String(src || '').replace(/```[a-z]*\n?([\s\S]*?)```/gi, (_, code) => { blocks.push(code); return `\u0000B${blocks.length - 1}\u0000`; });
        s = esc(s);
        s = s.replace(/`([^`\n]{1,80})`/g, (_, t) => `<button class="as-tag" data-tag="${t}">${t}</button>`);
        s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
        const out = [];
        let list = null;
        s.split('\n').forEach(line => {
            const ul = line.match(/^\s*[-*•]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/), h = line.match(/^\s*#{1,4}\s+(.*)$/);
            if (ul || ol) {
                const type = ul ? 'ul' : 'ol';
                if (!list || list.type !== type) { if (list) out.push(`</${list.type}>`); out.push(`<${type}>`); list = { type }; }
                out.push(`<li>${(ul || ol)[1]}</li>`);
                return;
            }
            if (list) { out.push(`</${list.type}>`); list = null; }
            if (h) out.push(`<h4>${h[1]}</h4>`);
            else if (line.trim()) out.push(`<p>${line}</p>`);
        });
        if (list) out.push(`</${list.type}>`);
        return out.join('').replace(/\u0000B(\d+)\u0000/g, (_, i) => `<pre>${esc(blocks[+i])}</pre>`);
    }
    function lastAssistant() { for (let i = chat.length - 1; i >= 0; i--) if (chat[i].role === 'assistant') return i; return -1; }
    function msgHtml(m, i) {
        if (m.role === 'user') return `<div class="as-msg user">${m.thumbs && m.thumbs.length ? `<div class="as-thumbs">${m.thumbs.map(t => `<img src="${t}" alt="">`).join('')}</div>` : ''}${esc(m.text)}</div>`;
        if (m.role === 'error') return `<div class="as-msg error">⚠️ ${esc(m.text)}</div>`;
        return `<div class="as-msg assistant" data-i="${i}">${m.text ? md(m.text) : ''}${m.streaming ? '<div class="as-typing">● ● ●</div>' : `<div class="as-tools"><button data-act="copy">📋 copy</button>${i === lastAssistant() ? '<button data-act="retry">↻ again</button>' : ''}</div>`}</div>`;
    }
    function render() {
        const p = $('assistant-panel');
        if (!p || !p.classList.contains('open')) return;
        $('as-sub').textContent = cfg.model ? cfg.model : 'no model — ⚙️';
        const box = $('as-msgs');
        box.innerHTML = chat.length ? chat.map(msgHtml).join('') :
            `<div class="as-empty">💬 Attach image(s) — <b>➕ Selected</b>, 📎, drag & drop or Ctrl+V — and ask anything:<br>styles, colors, tags, captions, cropping, training.<br><br>Tags in the answers can be clicked to add them to the selected images.</div>`;
        box.scrollTop = box.scrollHeight;
        decorateTags(box);
    }
    function paintLive(m) {
        const box = $('as-msgs');
        if (!box) return;
        const all = box.querySelectorAll('.as-msg.assistant');
        const last = all[all.length - 1];
        if (!last) return render();
        const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        last.innerHTML = md(m.text) + '<div class="as-typing">● ● ●</div>';
        if (near) box.scrollTop = box.scrollHeight;
    }
    function renderAttach() {
        const box = $('as-attach');
        if (!box) return;
        box.style.display = attach.length ? '' : 'none';
        box.innerHTML = attach.map((a, i) => `<div class="as-att" title="${esc(a.name)} · ${a.w}×${a.h}${a.caption ? '\n' + esc(a.caption.slice(0, 200)) : ''}"><img src="${a.thumb}" alt="">${a.caption && cfg.sendCaptions ? '<span class="as-cap">🏷️</span>' : ''}<button data-i="${i}" title="Remove">✕</button></div>`).join('');
        box.querySelectorAll('button').forEach(b => b.onclick = () => { attach.splice(+b.dataset.i, 1); renderAttach(); });
    }

    // Tag chips checked on Danbooru / e621 (the app's own clients and cache).
    const tagMemo = new Map();
    async function checkTag(tag) {
        const q = tag.trim().toLowerCase().replace(/_/g, ' ');
        if (tagMemo.has(q)) return tagMemo.get(q);
        const clients = [window.danbooruClient, window.e621Client].filter(Boolean);
        let out = null;
        for (const c of clients) {
            try {
                const info = await c.fetchSingleTagInfo(q, false, true);
                if (info === null) continue;
                if (info.count > 0 && !info.notFound) { out = info.aliasTo ? { status: 'alias', tag: info.aliasTo.replace(/_/g, ' '), count: info.count, src: c.label } : { status: 'ok', tag: q, count: info.count, src: c.label }; break; }
                const alias = await c.resolveAlias(q);
                if (alias) { const ai = await c.fetchSingleTagInfo(alias, false, false); out = { status: 'alias', tag: alias.replace(/_/g, ' '), count: (ai && ai.count) || 0, src: c.label }; break; }
                out = { status: 'unknown' };
            } catch (e) { /* next */ }
        }
        if (out) tagMemo.set(q, out);
        return out;
    }
    function decorateTags(box) {
        box.querySelectorAll('.as-msg.assistant .as-tag:not([data-done])').forEach(btn => {
            btn.dataset.done = '1';
            const tag = btn.dataset.tag;
            btn.title = 'Click: add to the selected image(s) · Ctrl+click: copy';
            if (tag.split(' ').length > 5) return;
            checkTag(tag).then(r => {
                if (!r || !btn.isConnected) return;
                const n = r.count >= 1000 ? Math.round(r.count / 100) / 10 + 'k' : r.count;
                if (r.status === 'ok') btn.insertAdjacentHTML('beforeend', `<span class="as-tm" style="color:#4db8ff;">✓${n}</span>`);
                else if (r.status === 'alias') { btn.dataset.tag = r.tag; btn.innerHTML = `${esc(r.tag)}<span class="as-tm" style="color:#ffd23f;">↪${n}</span>`; btn.title = `"${tag}" is an alias of "${r.tag}" (${r.src}). Click: add to the selected image(s)`; }
                else { btn.classList.add('unk'); btn.insertAdjacentHTML('beforeend', '<span class="as-tm">❔</span>'); btn.title = 'Not found on Danbooru / e621 (fine for a trigger tag). Click: add to the selected image(s)'; }
            }).catch(() => {});
        });
    }
    function onMsgClick(ev) {
        const tagBtn = ev.target.closest('.as-tag');
        if (tagBtn) {
            const tag = tagBtn.dataset.tag;
            if (ev.ctrlKey || ev.metaKey) return copy(tag);
            const n = typeof selectedIndices !== 'undefined' ? selectedIndices.size : 0;
            if (!n) { window.showAlert && window.showAlert(`Select image(s) in the list to add "${tag}" (Ctrl+click copies it).`, 'info'); return; }
            if (typeof window.addTagToSelected === 'function') { window.addTagToSelected(tag, 'bottom'); window.showAlert && window.showAlert(`Added "${tag}" to ${n} image(s).`, 'success'); }
            return;
        }
        const tool = ev.target.closest('.as-tools button');
        if (!tool) return;
        const i = +tool.closest('.as-msg').dataset.i;
        if (tool.dataset.act === 'copy') copy(chat[i] ? chat[i].text : '');
        if (tool.dataset.act === 'retry') {
            let u = i - 1; while (u >= 0 && chat[u].role !== 'user') u--;
            if (u < 0) return;
            if (chat[u].thumbs && chat[u].thumbs.length) window.showAlert && window.showAlert('Asking again without the images (they are not kept) — attach them again if needed.', 'info');
            chat.splice(i, 1);
            send(chat[u].text, { retry: true });
        }
    }
    function copy(t) { try { navigator.clipboard.writeText(t); window.showAlert && window.showAlert('Copied.', 'success'); } catch (e) {} }
    function syncBusy() {
        const b = $('as-send');
        if (b) { b.classList.toggle('stop', !!busy); b.textContent = busy ? '⏹' : 'Send'; b.title = busy ? 'Stop the answer' : 'Send (Enter) · Shift+Enter = new line'; }
        const ib = $('btn-assistant'); if (ib) ib.classList.toggle('busy', !!busy);
    }

    /* ---------- SETTINGS (inside the panel) ---------- */
    function fillCfg() {
        $('as-backend').value = cfg.backend;
        $('as-url').value = cfg.backend === 'ollama' ? cfg.urlOllama : cfg.urlOpenAI;
        $('as-url').dataset.backend = cfg.backend;
        $('as-key-row').style.display = cfg.backend === 'openai' ? '' : 'none';
        $('as-key').value = cfg.apiKey;
        const sel = $('as-model');
        if (cfg.model && !Array.from(sel.options).some(o => o.value === cfg.model)) { const o = document.createElement('option'); o.value = o.textContent = cfg.model; sel.appendChild(o); }
        sel.value = cfg.model || '';
        $('as-temp').value = Math.round(cfg.temperature * 100); $('as-temp-val').textContent = cfg.temperature.toFixed(2);
        $('as-size').value = String(cfg.maxSide);
        $('as-lang').value = cfg.language;
        $('as-caps').checked = !!cfg.sendCaptions;
    }
    function readCfg() {
        const url = $('as-url').value.trim();
        if ($('as-url').dataset.backend === 'openai') cfg.urlOpenAI = url || DEFAULT_CFG.urlOpenAI; else cfg.urlOllama = url || DEFAULT_CFG.urlOllama;
        cfg.backend = $('as-backend').value;
        $('as-url').dataset.backend = cfg.backend;
        cfg.apiKey = $('as-key').value.trim();
        cfg.model = $('as-model').value;
        cfg.temperature = (parseInt($('as-temp').value, 10) || 0) / 100;
        cfg.maxSide = parseInt($('as-size').value, 10) || 1024;
        cfg.language = $('as-lang').value;
        cfg.sendCaptions = $('as-caps').checked;
    }
    async function refreshModels(silent) {
        const st = $('as-status'), sel = $('as-model');
        st.textContent = 'Loading models…';
        try {
            const info = await listModels();
            sel.innerHTML = '';
            if (!info.models.length) { sel.innerHTML = '<option value="">No vision models found</option>'; st.textContent = info.total ? `${info.total} model(s) on the server, none accepts images.` : 'No models on this server.'; return; }
            info.models.forEach(m => { const o = document.createElement('option'); o.value = o.textContent = m; sel.appendChild(o); });
            if (cfg.model && info.models.includes(cfg.model)) sel.value = cfg.model; else { cfg.model = sel.value; saveCfg(); render(); }
            st.textContent = info.unknown ? `${info.models.length} model(s) — this server does not say which accept images; pick a vision model.` : `${info.models.length} vision model(s)${info.total > info.models.length ? ` · ${info.total - info.models.length} text-only hidden` : ''}.`;
        } catch (e) { st.textContent = silent ? '' : `Could not reach the server (${e.message || e}). Is it running? CORS allowed?`; }
    }
    function toggleCfg(on) {
        const c = $('as-cfg');
        const open = on == null ? !c.classList.contains('open') : on;
        c.classList.toggle('open', open);
        $('as-cfg-btn').classList.toggle('on', open);
        if (open) { fillCfg(); if ($('as-model').options.length <= 1) refreshModels(true); }
    }

    /* ---------- PANEL ---------- */
    const QUICK = [
        ['🎨 Style', 'Describe the art style of the attached image(s): line art, coloring, shading, rendering, palette. Which Danbooru tags describe it, and what would be a good trigger tag?'],
        ['🏷️ Tags', 'Look at the attached image(s) and their current caption: which tags are wrong, which are missing, which should be removed? Give me the corrected tag list.'],
        ['🌈 Style vs color', 'I want the LoRA to learn the art style without locking the colors (so I can change colors in prompts). Looking at the attached image(s), how should I caption them? Give concrete tags.'],
        ['✅ Good for training?', 'Is the attached image good for a training dataset? Check quality, artifacts, anatomy, watermarks/text, cropping and resolution, and tell me what to fix.'],
        ['✂️ Crop', 'How should I crop / frame the attached image for training (which aspect ratio and what to keep or cut)?'],
        ['🚀 Training', 'What training settings would you start with for a LoRA of this kind (repeats, epochs, learning rate, dim / alpha, resolution)? Explain briefly.']
    ];
    function buildPanel() {
        if ($('assistant-panel')) return;
        const p = document.createElement('div');
        p.id = 'assistant-panel';
        p.innerHTML = `
            <div class="as-head" id="as-head">
                <span class="as-title">💬 Assistant</span><span class="as-sub" id="as-sub"></span>
                <button class="as-hbtn" id="as-cfg-btn" title="Server, model and options">⚙️</button>
                <button class="as-hbtn" id="as-clear" title="Clear the conversation">🧹</button>
                <button class="as-hbtn x" id="as-close" title="Close">✕</button>
            </div>
            <div class="as-cfg" id="as-cfg">
                <div class="as-row"><span class="as-lbl">Backend</span><select id="as-backend"><option value="ollama">Ollama</option><option value="openai">OpenAI-compatible (LM Studio, koboldcpp, llama.cpp…)</option></select></div>
                <div class="as-row"><span class="as-lbl">Server URL</span><input type="text" id="as-url" spellcheck="false"></div>
                <div class="as-row" id="as-key-row"><span class="as-lbl">API key</span><input type="password" id="as-key" placeholder="optional" autocomplete="off"></div>
                <div class="as-row"><span class="as-lbl">Vision model</span><select id="as-model"><option value="">(click 🔄)</option></select><button class="as-mini" id="as-refresh" title="Load the model list">🔄</button></div>
                <div class="as-status" id="as-status"></div>
                <div class="as-row"><span class="as-lbl">Temperature</span><input type="range" id="as-temp" min="0" max="100" step="5"><span class="as-val" id="as-temp-val"></span></div>
                <div class="as-row"><span class="as-lbl">Image size</span><select id="as-size"><option value="512">512px (fast)</option><option value="768">768px</option><option value="1024">1024px</option><option value="1536">1536px (detail, slow)</option></select></div>
                <div class="as-row"><span class="as-lbl">Answer in</span><select id="as-lang"><option value="auto">Same language as my question</option><option value="English">English</option><option value="Brazilian Portuguese">Português (BR)</option><option value="Spanish">Español</option></select></div>
                <div class="as-row"><label><input type="checkbox" id="as-caps"> Send the caption of images added from the list</label></div>
            </div>
            <div class="as-quick">${QUICK.map((q, i) => `<button class="as-q" data-q="${i}" title="${esc(q[1])}">${esc(q[0])}</button>`).join('')}</div>
            <div class="as-msgs" id="as-msgs"></div>
            <div class="as-attach" id="as-attach" style="display:none;"></div>
            <div class="as-attbar">
                <button class="as-mini" id="as-add-sel" title="Attach the images selected in the list">➕ Selected</button>
                <button class="as-mini" id="as-add-file" title="Attach image files from the computer">📎</button>
                <input type="file" id="as-file" accept="image/*" multiple style="display:none;">
                <span class="as-hint">drag & drop · Ctrl+V</span>
            </div>
            <div class="as-input">
                <textarea id="as-text" rows="2" placeholder="Ask… (Enter = send, Shift+Enter = new line)"></textarea>
                <button class="as-send" id="as-send">Send</button>
            </div>`;
        document.body.appendChild(p);
        place(p);
        $('as-close').onclick = () => toggle(false);
        $('as-cfg-btn').onclick = () => toggleCfg();
        $('as-clear').onclick = () => { if (!chat.length || !confirm('Clear the conversation?')) return; chat = []; saveChat(); render(); };
        $('as-backend').onchange = () => { readCfg(); fillCfg(); saveCfg(); refreshModels(true); };
        $('as-refresh').onclick = () => { readCfg(); saveCfg(); refreshModels(false); };
        ['as-url', 'as-key', 'as-model', 'as-temp', 'as-size', 'as-lang', 'as-caps'].forEach(id => $(id).addEventListener('change', () => { readCfg(); saveCfg(); render(); renderAttach(); }));
        $('as-temp').oninput = () => { $('as-temp-val').textContent = (parseInt($('as-temp').value, 10) / 100).toFixed(2); };
        $('as-send').onclick = () => { if (busy) busy.abort(); else { const t = $('as-text').value; $('as-text').value = ''; send(t); } };
        $('as-add-sel').onclick = () => addSelected();
        $('as-add-file').onclick = () => $('as-file').click();
        $('as-file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
        const ta = $('as-text');
        ta.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) { const t = ta.value; ta.value = ''; send(t); } }
            e.stopPropagation();                                       // app shortcuts must not fire while typing
        });
        ta.addEventListener('keyup', e => e.stopPropagation());
        p.addEventListener('paste', e => {
            const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => /^image\//.test(f.type));
            if (files.length) { e.preventDefault(); addFiles(files); }
        });
        p.addEventListener('dragover', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); p.classList.add('drop'); } });
        p.addEventListener('dragleave', e => { if (e.target === p) p.classList.remove('drop'); });
        p.addEventListener('drop', e => { p.classList.remove('drop'); if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
        p.querySelectorAll('.as-q').forEach(b => b.onclick = () => send(QUICK[+b.dataset.q][1]));
        $('as-msgs').addEventListener('click', onMsgClick);
        // Drag by the title bar.
        $('as-head').addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            const r = p.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
            const move = ev => { p.style.left = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - ox)) + 'px'; p.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - oy)) + 'px'; };
            const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); remember(p); };
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
            e.preventDefault();
        });
        if (typeof ResizeObserver === 'function') { let t = null; new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => remember(p), 400); }).observe(p); }
    }
    function place(p) {
        const u = cfg.ui;
        const w = Math.min(u.w || 440, window.innerWidth - 20), h = Math.min(u.h || 600, window.innerHeight - 20);
        p.style.width = w + 'px'; p.style.height = h + 'px';
        p.style.left = (u.x != null ? Math.min(Math.max(0, u.x), window.innerWidth - 120) : window.innerWidth - w - 16) + 'px';
        p.style.top = (u.y != null ? Math.min(Math.max(0, u.y), window.innerHeight - 60) : Math.max(10, window.innerHeight - h - 16)) + 'px';
    }
    function remember(p) {
        if (!p.classList.contains('open')) return;
        const r = p.getBoundingClientRect();
        cfg.ui = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        saveCfg();
    }
    function toggle(on) {
        buildPanel();
        const p = $('assistant-panel');
        const open = on == null ? !p.classList.contains('open') : on;
        p.classList.toggle('open', open);
        const b = $('btn-assistant'); if (b) b.classList.toggle('open', open);
        if (open) {
            place(p); render(); renderAttach(); syncBusy();
            if (!cfg.model) toggleCfg(true);
            setTimeout(() => $('as-text').focus(), 0);
        }
    }
    window.toggleAssistant = toggle;

    /* ---------- BUTTON + ⚙️ SETTINGS ---------- */
    function injectButton() {
        if ($('btn-assistant')) return true;
        const slider = $('thumb-slider');
        if (!slider || !slider.parentElement) return false;
        const btn = document.createElement('button');
        btn.id = 'btn-assistant';
        btn.textContent = '💬';
        btn.title = 'Assistant — attach image(s) and ask a local vision model for tips (styles, tags, captions, training)';
        btn.onclick = () => toggle();
        btn.style.display = enabled ? '' : 'none';
        slider.parentElement.appendChild(btn);
        return true;
    }
    function aiGroup() {
        const dd = $('settings-dropdown');
        if (!dd) return null;
        let grp = $('settings-local-ai');
        if (grp) return grp;
        grp = document.createElement('div');
        grp.id = 'settings-local-ai';
        grp.style.cssText = 'display:flex; flex-direction:column; gap:inherit;';
        grp.innerHTML = '<div class="settings-group-label">🤖 Local AI (vision model)</div>';
        const hr = document.createElement('hr');
        hr.style.cssText = 'border:0; border-top:1px solid #333; margin:5px 0;';
        const backup = Array.from(dd.querySelectorAll('.settings-group-label')).find(e => /Backup/.test(e.textContent));
        if (backup) { dd.insertBefore(grp, backup); dd.insertBefore(hr, backup); } else { dd.appendChild(hr); dd.appendChild(grp); }
        return grp;
    }
    function setEnabled(on, save) {
        enabled = !!on;
        const b = $('btn-assistant'); if (b) b.style.display = enabled ? '' : 'none';
        const cb = $('toggle-ai-assistant'); if (cb) cb.checked = enabled;
        if (!enabled) { if (busy) busy.abort(); const p = $('assistant-panel'); if (p) p.classList.remove('open'); }
        if (save && typeof window.saveSetting === 'function') window.saveSetting('enable-assistant', enabled);
    }
    function injectSetting() {
        const grp = aiGroup();
        if (!grp || $('toggle-ai-assistant')) return;
        const lb = document.createElement('label');
        lb.title = 'Chat with a local vision model: attach images and ask for tips (💬 next to the thumbnail slider)';
        lb.innerHTML = '<input type="checkbox" id="toggle-ai-assistant"> 💬 Assistant';
        grp.appendChild(lb);
        $('toggle-ai-assistant').checked = enabled;
        $('toggle-ai-assistant').onchange = e => setEnabled(e.target.checked, true);
    }

    /* ---------- BOOT ---------- */
    window.addEventListener('DOMContentLoaded', async () => {
        await loadAll();
        // A tiny wait so other buttons of the row (e.g. 🧐) are created first.
        let tries = 0;
        const t = setInterval(() => { if (injectButton() || ++tries > 40) { clearInterval(t); setEnabled(enabled, false); } }, 50);
        setTimeout(() => { injectSetting(); setEnabled(enabled, false); }, 100);
    });
})();
