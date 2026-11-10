/**
 * parsers/comfyui_video.js
 *
 * ComfyUI VIDEO metadata (WebM / MP4 written by VideoHelperSuite & friends).
 * Ported from the old monolithic reader (comfy video helpers + WebM/MP4 scan)
 * into the modular parser format used by the other files in parsers/.
 *
 * Exports (all on window):
 *   readVideoMetadata(file)          -> Promise<{ raw: string|null }>
 *        finds the JSON the video carries (WebM "COMMENT" tag / MP4 ©cmt atom)
 *   parseComfyVideo(text, json, opts) -> normalised meta | null
 *        text/json: the raw metadata (outer {prompt, workflow} or a bare Comfy
 *        prompt graph). Returns null when the graph is not a video workflow,
 *        unless opts.force is set (used for .webm/.mp4 files).
 *   annotateH3Prompt(meta)           -> meta
 *        recognises MiniMax H3 prompts (alignment line + sections + [Shot N])
 *        in meta.pos and adds them as readable notes + a "Prompt Format" row.
 *
 * Output shape = the same as comfy.js (pos, neg, steps, cfg, seed, size,
 * sampler, scheduler, ckpt, loras, source, _extras). Extra display rows go in
 * _extras.rows = [[label, value], ...]  (rendered by png metadata reader.html).
 */
(function () {
    'use strict';

    /* ================================================================
       SMALL HELPERS
       ================================================================ */
    const txt = v => String(v === undefined || v === null ? '' : v);
    const normKey = v => txt(v).trim().toLowerCase().replace(/\s+/g, ' ');

    function addUnique(arr, v) {
        const s = txt(v).trim();
        if (!s) return;
        const k = normKey(s);
        for (let i = 0; i < arr.length; i++) if (normKey(arr[i]) === k) return;
        arr.push(s);
    }
    function fmt(v) {
        if (v === undefined || v === null || v === '') return '';
        const n = Number(v);
        if (Number.isFinite(n)) return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(Math.round(n * 1000) / 1000);
        return txt(v).trim();
    }
    function num(v) {
        if (v === undefined || v === null || v === '') return NaN;
        const n = Number(String(v).trim());
        return Number.isFinite(n) ? n : NaN;
    }
    function firstScalar() {
        for (let i = 0; i < arguments.length; i++) {
            const v = arguments[i];
            if (Array.isArray(v) || (v && typeof v === 'object')) continue;
            if (v !== undefined && v !== null && String(v).trim() !== '') return v;
        }
        return '';
    }
    function cleanModelName(v) {
        return txt(v).replace(/^['"]+|['"]+$/g, '').replace(/[\\/]+/g, '/').split('/').pop()
            .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, '').trim();
    }

    /* ================================================================
       JSON (relaxed: ComfyUI can export NaN / Infinity)
       ================================================================ */
    function sanitizeJsonConstants(s) {
        let out = '', inStr = false, esc = false;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (inStr) {
                out += c;
                if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
                continue;
            }
            if (c === '"') { inStr = true; out += c; continue; }
            if (c === 'N' && s.startsWith('NaN', i)) { out += 'null'; i += 2; continue; }
            if (c === 'I' && s.startsWith('Infinity', i)) { out += 'null'; i += 7; continue; }
            if (c === '-' && s.startsWith('-Infinity', i)) { out += 'null'; i += 8; continue; }
            out += c;
        }
        return out;
    }
    function parseJsonRelaxed(raw) {
        if (raw && typeof raw === 'object') return raw;
        const s = txt(raw).trim();
        if (!s) return null;
        try { return JSON.parse(s); } catch (e) { /* try sanitised */ }
        try { return JSON.parse(sanitizeJsonConstants(s)); } catch (e) { return null; }
    }

    // Index of the '}' that closes the '{' at `start` (string-aware), or -1.
    const MAX_JSON_SPAN = 8000000;
    function balancedEnd(s, start) {
        let depth = 0, inStr = false, esc = false;
        const stop = Math.min(s.length, start + MAX_JSON_SPAN);
        for (let i = start; i < stop; i++) {
            const c = s.charCodeAt(i);
            if (esc) { esc = false; continue; }
            if (c === 92) { esc = true; continue; }          // backslash
            if (c === 34) { inStr = !inStr; continue; }      // quote
            if (inStr) continue;
            if (c === 123) depth++;
            else if (c === 125) { depth--; if (depth === 0) return i; }
        }
        return -1;
    }

    /* ================================================================
       CONTAINER SCAN  (WebM "COMMENT" tag / MP4 ©cmt atom)
       The metadata is stored as plain JSON text, so it is found by scanning
       the bytes. Latin-1 decoding keeps 1 char = 1 byte, so string indexes
       are byte offsets and the JSON is re-decoded as UTF-8 afterwards.
       ================================================================ */
    const latin1 = new TextDecoder('latin1');
    const utf8 = new TextDecoder('utf-8', { fatal: false });

    function scanChunk(bytes) {
        const s = latin1.decode(bytes);
        const tryAt = (start, mustReach) => {
            const end = balancedEnd(s, start);
            if (end < 0 || end < mustReach) return null;
            const raw = utf8.decode(bytes.subarray(start, end + 1));
            const obj = parseJsonRelaxed(raw);
            return obj && typeof obj === 'object' ? raw : null;
        };

        // 1) the COMMENT tag itself: first valid JSON object right after it
        let idx = 0;
        while ((idx = s.indexOf('COMMENT', idx)) !== -1) {
            const lim = Math.min(s.length, idx + 4096);
            for (let k = idx + 7; k < lim; k++) {
                if (s.charCodeAt(k) !== 123) continue;
                const r = tryAt(k, k);
                if (r) return r;
            }
            idx += 7;
        }

        // 2) known keys: walk back to the object that contains them
        for (const pat of ['"prompt"', '"workflow"', 'PNGReaderGenericMetadata', 'parameters-json', 'smproj']) {
            let p = 0;
            while ((p = s.indexOf(pat, p)) !== -1) {
                const floor = Math.max(0, p - 200000);
                let st = s.lastIndexOf('{', p);
                while (st >= floor) {
                    const r = tryAt(st, p);
                    if (r) return r;
                    if (st === 0) break;
                    st = s.lastIndexOf('{', st - 1);
                }
                p += pat.length;
            }
        }

        // 3) a bare prompt graph ("class_type" nodes): take the OUTERMOST valid object
        let p = s.indexOf('"class_type"');
        if (p !== -1) {
            const floor = Math.max(0, p - 2000000);
            let best = null, st = s.lastIndexOf('{', p), tries = 0;
            while (st >= floor && tries++ < 4000) {
                const r = tryAt(st, p);
                if (r) best = r;
                if (st === 0) break;
                st = s.lastIndexOf('{', st - 1);
            }
            if (best) return best;
        }
        return null;
    }

    // Head and tail first (where muxers put tags), then the rest in chunks.
    window.readVideoMetadata = async function (file) {
        const CH = 16 * 1024 * 1024, OV = 4 * 1024 * 1024, size = file.size;
        const read = async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
        let raw = scanChunk(await read(0, Math.min(size, CH)));
        if (!raw && size > CH) raw = scanChunk(await read(Math.max(0, size - CH), size));
        if (!raw && size > 2 * CH) {
            for (let off = CH - OV; off < size - CH && !raw; off += CH - OV) {
                raw = scanChunk(await read(off, Math.min(size, off + CH)));
                await new Promise(r => setTimeout(r, 0));          // keep the page responsive
            }
        }
        return { raw: raw || null };
    };

    /* ================================================================
       UNPACK  ({prompt, workflow, ...} -> a Comfy prompt graph)
       ================================================================ */
    // Widget order of the common nodes, so a workflow-only video still gets prompts/models/params.
    const WIDGET_MAP = [
        [/^(CLIPTextEncode|CLIPTextEncodeSDXL|CLIPTextEncodeFlux)$/i, ['text']],
        [/^KSampler$/i, ['seed', null, 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']],
        [/^LoraLoader(ModelOnly)?$/i, ['lora_name', 'strength_model', 'strength_clip']],
        [/^CheckpointLoader(Simple)?$/i, ['ckpt_name']],
        [/^UNETLoader$/i, ['unet_name', 'weight_dtype']],
        [/^VAELoader$/i, ['vae_name']],
        [/^CLIPLoader$/i, ['clip_name', 'type']],
        [/^EmptyLatentImage$/i, ['width', 'height', 'batch_size']],
        [/^EmptyLTXVLatentVideo$/i, ['width', 'height', 'length', 'batch_size']],
    ];
    function workflowToGraph(wf) {
        if (!wf || !Array.isArray(wf.nodes)) return null;
        const links = {};
        (wf.links || []).forEach(l => { if (Array.isArray(l)) links[l[0]] = l; });
        const graph = {};
        wf.nodes.forEach(n => {
            if (!n || n.id === undefined) return;
            const node = { class_type: n.type, _meta: { title: n.title || '' }, inputs: {}, widgets_values: n.widgets_values };
            (n.inputs || []).forEach(inp => {
                const l = inp && inp.link != null ? links[inp.link] : null;
                if (l) node.inputs[inp.name] = [String(l[1]), l[2]];
            });
            const map = WIDGET_MAP.find(([re]) => re.test(txt(n.type)));
            if (map && Array.isArray(n.widgets_values)) {
                map[1].forEach((name, i) => {
                    if (name && node.inputs[name] === undefined && n.widgets_values[i] !== undefined) node.inputs[name] = n.widgets_values[i];
                });
            }
            graph[String(n.id)] = node;
        });
        return graph;
    }
    function looksLikeGraph(o) {
        return !!o && typeof o === 'object' && !Array.isArray(o) && Object.values(o).some(v => v && typeof v === 'object' && v.class_type);
    }
    function unpack(rawText, jsonObj) {
        const outer = parseJsonRelaxed(jsonObj && typeof jsonObj === 'object' ? jsonObj : rawText);
        if (!outer || typeof outer !== 'object') return null;
        const sub = v => (typeof v === 'string' ? parseJsonRelaxed(v) : (v && typeof v === 'object' ? v : null));
        let prompt = sub(outer.prompt);
        const workflow = sub(outer.workflow);
        if (!looksLikeGraph(prompt)) prompt = null;
        if (!prompt && looksLikeGraph(outer)) prompt = outer;
        if (!prompt && workflow) prompt = workflowToGraph(workflow);
        if (!prompt && Array.isArray(outer.nodes)) prompt = workflowToGraph(outer);
        return prompt ? { prompt, workflow: workflow || (Array.isArray(outer.nodes) ? outer : null) } : null;
    }

    /* ================================================================
       GRAPH HELPERS  (ported from the old reader's _comfyVideo* functions)
       CTX.workflow = the UI workflow (nodes[] + subgraph definitions), used
       when the API prompt has no widget values for a node.
       ================================================================ */
    const CTX = { workflow: null };

    const nodeType = n => txt(n && (n.class_type || n.type));
    const nodeTitle = n => txt((n && n._meta && n._meta.title) || (n && n.title));
    const nodeAll = n => (nodeType(n) + ' ' + nodeTitle(n)).trim();

    function forEachNode(graph, fn) {
        if (!graph || typeof graph !== 'object') return;
        for (const id in graph) {
            if (!Object.prototype.hasOwnProperty.call(graph, id)) continue;
            const node = graph[id];
            if (!node || typeof node !== 'object') continue;
            fn(node, String(id), graph);
        }
    }
    function wfRootNode(id) {
        const wf = CTX.workflow;
        if (!wf || !Array.isArray(wf.nodes)) return null;
        const sid = String(id);
        for (let i = 0; i < wf.nodes.length; i++) if (String(wf.nodes[i].id) === sid) return wf.nodes[i];
        return null;
    }
    function wfNode(id) {                       // also finds nodes inside subgraphs ("host:inner" ids)
        const sid = String(id || '');
        const root = wfRootNode(sid);
        if (root) return root;
        const colon = sid.indexOf(':');
        if (colon < 0) return null;
        const host = wfRootNode(sid.slice(0, colon));
        const subId = host && (host.type || host.class_type);
        const subs = ((CTX.workflow || {}).definitions || {}).subgraphs || [];
        for (let s = 0; s < subs.length; s++) {
            if (String(subs[s].id) !== String(subId)) continue;
            const nodes = subs[s].nodes || [];
            for (let n = 0; n < nodes.length; n++) if (String(nodes[n].id) === sid.slice(colon + 1)) return nodes[n];
        }
        return null;
    }
    function widgets(node, id) {
        let out = node && Array.isArray(node.widgets_values) ? node.widgets_values : [];
        if (!out.length && id) {
            const w = wfNode(id);
            if (w && Array.isArray(w.widgets_values)) out = w.widgets_values;
        }
        return out;
    }

    function resolve(graph, val, keys, depth) {
        depth = depth || 0;
        if (depth > 18) return '';
        if (Array.isArray(val)) return nodeValue(graph, graph && graph[String(val[0])], String(val[0]), keys, depth + 1);
        if (val !== undefined && val !== null && typeof val !== 'object') return val;
        return '';
    }
    function nodeValue(graph, node, id, keys, depth) {
        if (!node || depth > 18) return '';
        const inp = node.inputs || {};
        const wv = widgets(node, id);
        const type = nodeType(node), all = nodeAll(node);
        keys = keys || ['value'];

        for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            if (Object.prototype.hasOwnProperty.call(inp, key)) {
                const v = inp[key];
                if (Array.isArray(v)) { const r = resolve(graph, v, keys, depth + 1); if (r !== '') return r; }
                else if (v !== undefined && v !== null && typeof v !== 'object') return v;
            }
        }
        if (/easy\s+convertAnything/i.test(all)) return resolve(graph, inp['*'], ['value', 'Xi', 'Xf'], depth + 1);

        if (/easy\s+math(?:Float|Int)|Math Operation/i.test(all)) {
            const a = num(resolve(graph, inp.a, ['value', 'Xi', 'Xf'], depth + 1));
            const b = num(resolve(graph, inp.b, ['value', 'Xi', 'Xf'], depth + 1));
            const op = txt(inp.operation || wv[2] || '').toLowerCase();
            if (Number.isFinite(a) && Number.isFinite(b)) {
                if (/multiply|mul|\*/.test(op)) return a * b;
                if (/divide|div|\//.test(op) && b !== 0) return a / b;
                if (/add|plus|\+/.test(op)) return a + b;
                if (/subtract|minus|-/.test(op)) return a - b;
            }
        }

        if (/ComfyMathExpression|MathExpression\|pysssss/i.test(all)) {
            const expr = txt(inp.expression || wv[0] || '');
            const rv = k => num(resolve(graph, inp['values.' + k] !== undefined ? inp['values.' + k] : inp[k], ['value', 'Xi', 'Xf'], depth + 1));
            const av = rv('a'), bv = rv('b'), cv = rv('c');
            if (Number.isFinite(av)) {
                if (/^\s*a\s*\*\s*b\s*$/.test(expr) && Number.isFinite(bv)) return av * bv;
                if (/^\s*a\s*-\s*b\s*-\s*c\s*$/.test(expr) && Number.isFinite(bv) && Number.isFinite(cv)) return av - bv - cv;
                if (/ceil\s*\(\s*\(\s*a\s*\*\s*b\s*-\s*1\s*\)\s*\/\s*8\s*\)\s*\*\s*8\s*\+\s*1/i.test(expr) && Number.isFinite(bv)) return (Math.ceil((av * bv - 1) / 8) * 8) + 1;
                const sq = /round\s*\(\s*sqrt\s*\(\s*a\s*\*\s*1000000\s*\*\s*\(\s*b\s*\/\s*c\s*\)\s*\)\s*\/\s*(16|32)\s*\)\s*\*\s*(?:16|32)/i.exec(expr);
                if (sq && Number.isFinite(bv) && Number.isFinite(cv) && cv !== 0) return Math.round(Math.sqrt(av * 1000000 * (bv / cv)) / +sq[1]) * +sq[1];
                const dv = /round\s*\(\s*\(\s*a\s*\/\s*\(\s*b\s*\/\s*c\s*\)\s*\)\s*\/\s*(16|32)\s*\)\s*\*\s*(?:16|32)/i.exec(expr);
                if (dv && Number.isFinite(bv) && Number.isFinite(cv) && bv !== 0) return Math.round((av / (bv / cv)) / +dv[1]) * +dv[1];
            }
            const literal = expr.trim();
            if (/^-?\d+(?:\.\d+)?$/.test(literal)) return Number(literal);
        }

        if (/mxSlider/i.test(type)) return firstScalar(inp.Xi, inp.Xf, wv[0], wv[1]);
        if (/Primitive(?:Int|Float|String|StringMultiline|Boolean)/i.test(type)) return firstScalar(inp.value, wv[0]);
        if (/Seed/i.test(all)) return firstScalar(inp.seed, inp.noise_seed, wv[0]);
        if (/PreviewAny/i.test(type)) return firstScalar(inp.preview_text, inp.preview_markdown, wv[1], wv[0]);
        return firstScalar(inp.value, inp.Xi, inp.Xf, inp.seed, inp.noise_seed, wv[0]);
    }
    function findNodes(graph, re) {
        const out = [];
        forEachNode(graph, (node, id) => { if (re.test(nodeAll(node))) out.push({ node, id }); });
        return out;
    }
    function firstByTitle(graph, re) {
        let found = null;
        forEachNode(graph, (node, id) => { if (!found && re.test(nodeTitle(node))) found = { node, id }; });
        return found;
    }
    function titledValue(graph, re, keys) {
        const f = firstByTitle(graph, re);
        return f ? nodeValue(graph, f.node, f.id, keys || ['value', 'Xi', 'Xf'], 0) : '';
    }

    /* ================================================================
       FACTS  (engine detection + engine-specific settings)
       facts: { isVideo, engines[], lines[], output, audio, audioSource, p{} }
       ================================================================ */
    function collectOutput(graph, facts) {
        forEachNode(graph, node => {
            const type = nodeType(node), inp = node.inputs || {}, wv = widgets(node);
            if (!/VHS_VideoCombine|VideoCombine|SaveVideo/i.test(type)) return;
            const parts = [];
            const f = inp.format || inp.container || (typeof wv[0] === 'string' ? wv[0] : '');
            const fps = resolve(graph, inp.frame_rate, ['value', 'fps', 'float', 'number', 'Xi', 'Xf']);
            const crf = inp.crf, cq = inp.cq;
            if (f) {
                // "video/h264-mp4" -> "H264-MP4"; custom "video/foo_webm.json" keeps its own casing
                const name = String(f).replace(/^video\//i, '').replace(/\.json$/i, '');
                parts.push(/^[a-z0-9-]+$/i.test(name) ? name.toUpperCase() : name);
            }
            if (fps !== undefined && fps !== null && String(fps).trim() !== '') parts.push(fmt(fps) + ' fps');
            if (crf !== undefined && crf !== null && String(crf).trim() !== '') parts.push('CRF ' + fmt(crf));
            else if (cq !== undefined && cq !== null && String(cq).trim() !== '' && typeof cq !== 'object') parts.push('CQ ' + fmt(cq));
            if (parts.length) facts.output = 'Video Output: ' + parts.join(' | ');
        });
    }

    function collectWan(graph, facts) {
        const painter = findNodes(graph, /PainterFLF2V/i)[0] || null;
        let size = '', frames = '', motion = '';
        if (painter) {
            const inpP = painter.node.inputs || {}, wvP = widgets(painter.node, painter.id);
            let w = resolve(graph, inpP.width, ['width', 'value', 'Xi', 'Xf']);
            let h = resolve(graph, inpP.height, ['height', 'value', 'Xi', 'Xf']);
            if (!(Number(w) > 0 && Number(h) > 0) && Number(wvP[0]) > 0 && Number(wvP[1]) > 0) { w = wvP[0]; h = wvP[1]; }
            if (Number(w) > 0 && Number(h) > 0) size = Math.round(Number(w)) + ' x ' + Math.round(Number(h));
            frames = resolve(graph, inpP.length, ['value', 'Xi', 'Xf']);
            if ((frames === '' || frames === undefined) && wvP[2] !== undefined) frames = wvP[2];
            motion = resolve(graph, inpP.motion_amplitude, ['value', 'Xi', 'Xf']);
            if ((motion === '' || motion === undefined) && wvP[4] !== undefined) motion = wvP[4];
        }
        const fps = titledValue(graph, /^Frame rate$/i);
        const duration = titledValue(graph, /^Duration$/i);
        const speed = titledValue(graph, /^Speed$/i);

        // the "main" sampler among the High / Low / resample stages
        const samplers = findNodes(graph, /ClownsharKSampler_Beta/i);
        let primary = null, primaryScore = -99999;
        samplers.forEach(s => {
            const t = nodeTitle(s.node), si = s.node.inputs || {};
            let sc = 0;
            if (/ClownsharKSampler\s+High/i.test(t)) sc += 300;
            if (/\bHigh\b/i.test(t)) sc += 120;
            if (/\bLow\b/i.test(t)) sc -= 80;
            if (/Sampler\s*2/i.test(t)) sc -= 120;
            if (/Sampler\s*3/i.test(t)) sc -= 260;
            if (/resample/i.test(txt(si.sampler_mode))) sc -= 50;
            if (/beta/i.test(txt(si.scheduler))) sc -= 60;
            const stv = Number(resolve(graph, si.steps, ['steps', 'value', 'Xi', 'Xf']));
            const dnv = Number(resolve(graph, si.denoise, ['denoise', 'value']));
            if (Number.isFinite(stv) && stv >= 2) sc += 30;
            if (Number.isFinite(stv) && stv <= 1) sc -= 100;
            if (Number.isFinite(dnv) && dnv >= 0.7) sc += 20;
            if (Number.isFinite(dnv) && dnv < 0.35) sc -= 80;
            if (sc > primaryScore) { primary = s; primaryScore = sc; }
        });
        const p = { size };
        if (primary) {
            const inp = primary.node.inputs || {};
            p.steps = resolve(graph, inp.steps, ['steps', 'value', 'Xi', 'Xf']);
            p.cfg = resolve(graph, inp.cfg, ['cfg', 'value', 'Xi', 'Xf']);
            p.seed = resolve(graph, inp.seed, ['seed', 'noise_seed', 'value', 'Xi', 'Xf']);
            p.sampler = resolve(graph, inp.sampler_name || inp.sampler, ['sampler_name', 'sampler', 'value']);
            p.scheduler = resolve(graph, inp.scheduler, ['scheduler', 'value']);
            p.denoise = resolve(graph, inp.denoise, ['denoise', 'value']);
        }
        const sliderSteps = titledValue(graph, /^Steps$/i, ['steps', 'value', 'Xi', 'Xf']);
        if (sliderSteps !== '' && (!p.steps || Number(p.steps) <= 1)) p.steps = sliderSteps;
        facts.p = Object.assign(facts.p || {}, p);

        const info = [];
        if (size) info.push('Size: ' + size);
        if (frames !== '' && frames !== undefined) info.push('Frames: ' + fmt(frames));
        if (duration !== '' && duration !== undefined) info.push('Duration: ' + fmt(duration) + 's');
        if (fps !== '' && fps !== undefined) info.push('FPS: ' + fmt(fps));
        if (motion !== '' && motion !== undefined) info.push('Motion: ' + fmt(motion));
        if (speed !== '' && speed !== undefined) info.push('Speed: ' + fmt(speed));
        if (info.length) addUnique(facts.lines, 'Wan Settings: ' + info.join(' | '));
        if (primary && (p.sampler || p.scheduler || p.denoise)) {
            const sp = [];
            if (p.sampler) sp.push(txt(p.sampler));
            if (p.scheduler) sp.push('Scheduler: ' + txt(p.scheduler));
            if (p.denoise) sp.push('Denoise: ' + fmt(p.denoise));
            addUnique(facts.lines, 'Wan Sampling: ' + sp.join(' | '));
        }
        const nags = findNodes(graph, /WanVideoNAG/i);
        if (nags.length) {
            const ni = nags[0].node.inputs || {}, np = [];
            if (ni.nag_scale !== undefined) np.push('Scale: ' + fmt(ni.nag_scale));
            if (ni.nag_alpha !== undefined) np.push('Alpha: ' + fmt(ni.nag_alpha));
            if (ni.nag_tau !== undefined) np.push('Tau: ' + fmt(ni.nag_tau));
            if (np.length) addUnique(facts.lines, 'Wan NAG: ' + np.join(' | '));
        }
        const enh = findNodes(graph, /WanVideoEnhanceAVideoKJ/i);
        if (enh.length) {
            const ep = [];
            enh.forEach(e => {
                const t = nodeTitle(e.node);
                const label = /low/i.test(t) ? 'Low' : (/high/i.test(t) ? 'High' : 'Weight');
                const weight = (e.node.inputs || {}).weight;
                if (weight !== undefined) ep.push(label + ': ' + fmt(weight));
            });
            if (ep.length) addUnique(facts.lines, 'Wan Enhance: ' + ep.join(' | '));
        }
    }

    function collectLTXV(graph, facts) {
        let size = '';
        const dimNode = findNodes(graph, /SDXL Empty Latent Image|Video Width|Video Height|Video Width and Hight/i)[0] || null;
        if (dimNode) {
            const dims = txt((dimNode.node.inputs || {}).dimensions).match(/(\d+)\s*[x×]\s*(\d+)/i);
            if (dims) size = dims[1] + ' x ' + dims[2];
        }
        const empty = findNodes(graph, /EmptyLTXVLatentVideo/i)[0] || null;
        let frames = '';
        if (empty) {
            const ei = empty.node.inputs || {};
            frames = resolve(graph, ei.length, ['value', 'Xi', 'Xf']);
            if (!size) {
                const ew = resolve(graph, ei.width, ['width', 'value', 'Xi', 'Xf']);
                const eh = resolve(graph, ei.height, ['height', 'value', 'Xi', 'Xf']);
                if (Number(ew) > 0 && Number(eh) > 0) size = Math.round(Number(ew)) + ' x ' + Math.round(Number(eh));
            }
        }
        const prevFrames = firstByTitle(graph, /Preview frames/i);
        if (prevFrames) frames = nodeValue(graph, prevFrames.node, prevFrames.id, ['preview_text', 'value'], 0) || frames;
        const secNode = firstByTitle(graph, /Video seconds|Seconds/i);
        const seconds = secNode ? nodeValue(graph, secNode.node, secNode.id, ['value', 'Xi', 'Xf'], 0) : '';
        const fpsNode = firstByTitle(graph, /Video FPS/i);
        const fps = fpsNode ? nodeValue(graph, fpsNode.node, fpsNode.id, ['value', 'Xi', 'Xf'], 0) : '';

        const ks = findNodes(graph, /KSamplerSelect/i)[0] || null;
        const sig = findNodes(graph, /ManualSigmas/i)[0] || null;
        const cfg = (findNodes(graph, /CFGGuider/i)[0] || {}).node;
        const noise = (findNodes(graph, /RandomNoise/i)[0] || {}).node;
        const p = { size };
        if (sig && sig.node.inputs && sig.node.inputs.sigmas) {
            const nums = txt(sig.node.inputs.sigmas).split(',').map(x => x.trim()).filter(Boolean);
            if (nums.length > 1) p.steps = String(nums.length - 1);
            p.scheduler = 'manual sigmas';
        }
        if (ks) p.sampler = firstScalar((ks.node.inputs || {}).sampler_name, widgets(ks.node, ks.id)[0]);
        if (cfg) p.cfg = firstScalar((cfg.inputs || {}).cfg, widgets(cfg)[0]);
        if (noise) p.seed = firstScalar((noise.inputs || {}).noise_seed, widgets(noise)[0]);
        facts.p = Object.assign(facts.p || {}, p);

        const info = [];
        if (size) info.push('Size: ' + size);
        if (frames !== '' && frames !== undefined) info.push('Frames: ' + fmt(frames));
        if (seconds !== '' && seconds !== undefined) info.push('Duration: ' + fmt(seconds) + 's');
        if (fps !== '' && fps !== undefined) info.push('FPS: ' + fmt(fps));
        if (info.length) addUnique(facts.lines, 'LTX Settings: ' + info.join(' | '));

        const ups = [];
        findNodes(graph, /LatentUpscaleModelLoader/i).forEach(e => {
            const model = (e.node.inputs || {}).model_name || widgets(e.node, e.id)[0] || '';
            if (model) addUnique(ups, cleanModelName(model));
        });
        if (ups.length) addUnique(facts.lines, 'Upscale Models: ' + ups.join(' / '));
    }

    // MiniMax H3 (DaSiWa / Shiro "MiniMax H3 Director"): size, fps and duration come from the
    // director node; the assembled prompt sits in some text node (e.g. "easy showAnything").
    const H3_TEXT_A = /(integrated_multimodal_description|detailed_description)\s*:/i;
    const H3_TEXT_B = /(overall_soundscape|non_diegetic_music)\s*:/i;
    function collectMiniMaxH3(graph, facts) {
        const dir = findNodes(graph, /MiniMaxH3Director|MiniMax\s*H3\s*Director/i)[0] || null;
        if (dir) {
            const inp = dir.node.inputs || {};
            const rv = k => resolve(graph, inp[k], [k, 'value', 'Xi', 'Xf']);
            const w = Number(rv('custom_width')), h = Number(rv('custom_height'));
            const size = (w > 0 && h > 0) ? Math.round(w) + ' x ' + Math.round(h) : '';
            const fps = rv('frame_rate'), seconds = rv('duration_seconds'), frames = rv('duration_frames');
            const ref = rv('reference_mode'), resizeMethod = rv('resize_method');
            if (size) facts.p.size = size;
            const info = [];
            if (size) info.push('Size: ' + size);
            if (seconds !== '' && Number(seconds) > 0) info.push('Duration: ' + fmt(seconds) + 's');
            if (frames !== '' && Number(frames) > 0) info.push('Frames: ' + fmt(frames));
            if (fps !== '' && Number(fps) > 0) info.push('FPS: ' + fmt(fps));
            if (ref !== '') info.push('Reference: ' + txt(ref));
            if (resizeMethod !== '' && size) info.push('Resize: ' + txt(resizeMethod));
            if (info.length) addUnique(facts.lines, 'H3 Settings: ' + info.join(' | '));
            const sv = rv('shift_video'), sa = rv('shift_audio'), sp = [];
            if (sv !== '') sp.push('Video: ' + fmt(sv));
            if (sa !== '') sp.push('Audio: ' + fmt(sa));
            if (sp.length) addUnique(facts.lines, 'H3 Shift: ' + sp.join(' | '));
            const brief = rv('local_prompts');
            if (typeof brief === 'string' && brief.trim()) facts.brief = brief.trim();
            const preview = rv('minimax_prompt_preview');
            if (typeof preview === 'string' && H3_TEXT_A.test(preview)) { facts.h3Prompt = preview.trim(); facts.h3Title = 'MiniMax H3 Director'; }
        }
        if (!facts.h3Prompt) {
            forEachNode(graph, node => {
                if (facts.h3Prompt) return;
                const inp = node.inputs || {};
                for (const k in inp) {
                    const v = inp[k];
                    if (typeof v === 'string' && H3_TEXT_A.test(v) && H3_TEXT_B.test(v)) {
                        facts.h3Prompt = v.trim();
                        facts.h3Title = nodeTitle(node);
                        return;
                    }
                }
            });
        }
    }

    // SamplerCustomAdvanced-style graphs: noise / sampler / scheduler / guider are separate nodes.
    // Fills only what is still empty, so the Wan / LTXV helpers keep priority.
    function collectCustomSampler(graph, facts) {
        const p = facts.p, set = (k, v) => { if ((p[k] === undefined || p[k] === '') && v !== undefined && v !== null && String(v).trim() !== '') p[k] = v; };
        const noise = findNodes(graph, /RandomNoise/i)[0];
        if (noise) set('seed', resolve(graph, (noise.node.inputs || {}).noise_seed, ['noise_seed', 'seed', 'value', 'Xi', 'Xf']));
        const ks = findNodes(graph, /KSamplerSelect/i)[0];
        if (ks) set('sampler', resolve(graph, (ks.node.inputs || {}).sampler_name, ['sampler_name', 'value']));
        const sch = findNodes(graph, /BasicScheduler|KarrasScheduler|ExponentialScheduler|PolyexponentialScheduler|SDTurboScheduler|LTXVScheduler|BetaSamplingScheduler/i)[0];
        if (sch) {
            const si = sch.node.inputs || {};
            set('steps', resolve(graph, si.steps, ['steps', 'value', 'Xi', 'Xf']));
            const named = /Karras/i.test(nodeType(sch.node)) ? 'karras' : (/Exponential/i.test(nodeType(sch.node)) ? 'exponential' : '');
            set('scheduler', si.scheduler !== undefined ? resolve(graph, si.scheduler, ['scheduler', 'value']) : named);
            set('denoise', resolve(graph, si.denoise, ['denoise', 'value']));
        }
        const g = findNodes(graph, /CFGGuider/i)[0];
        if (g) set('cfg', resolve(graph, (g.node.inputs || {}).cfg, ['cfg', 'value', 'Xi', 'Xf']));
    }

    function collectAudio(graph, facts) {
        forEachNode(graph, node => {
            const all = nodeAll(node), inp = node.inputs || {};
            if (/LoadAudio|AudioVAE|LTXVAudio/i.test(all) || inp.audio !== undefined || inp.trim_to_audio === true) facts.audio = true;
            if (/^LoadAudio$/i.test(nodeType(node)) && inp.audio) facts.audioSource = txt(inp.audio);
        });
    }

    function collectFacts(graph, rawText) {
        const facts = { isVideo: false, engines: [], lines: [], output: '', audio: false, audioSource: '', p: {} };
        forEachNode(graph, node => {
            const all = nodeAll(node);
            if (/(LTXV|WanVideo|HunyuanVideo|AnimateDiff|VHS_|VideoCombine|SaveVideo|LoadVideo|Stable\s*Video|\bSVD\b|Temporal|PainterFLF2V|MiniMax\s*H3)/i.test(all)) facts.isVideo = true;
            if (/MiniMaxH3|MiniMax\s*H3/i.test(all)) addUnique(facts.engines, 'MiniMax H3');
            if (/PainterFLF2V|WanVideo|ClownsharKSampler_Beta/i.test(all)) addUnique(facts.engines, 'WanVideo');
            if (/LTXV/i.test(all)) addUnique(facts.engines, 'LTXV');
            if (/HunyuanVideo/i.test(all)) addUnique(facts.engines, 'HunyuanVideo');
            if (/AnimateDiff|ADE_/i.test(all)) addUnique(facts.engines, 'AnimateDiff');
            if (/Stable\s*Video|\bSVD\b/i.test(all)) addUnique(facts.engines, 'SVD');
        });
        const t = txt(rawText);
        if (!facts.engines.length && /LTXV/i.test(t)) addUnique(facts.engines, 'LTXV');
        if (!facts.engines.length && /WanVideo|PainterFLF2V|ClownsharKSampler_Beta/i.test(t)) addUnique(facts.engines, 'WanVideo');
        if (facts.engines.length) facts.isVideo = true;
        collectOutput(graph, facts);
        collectAudio(graph, facts);
        if (facts.engines.some(x => /WanVideo/i.test(x))) collectWan(graph, facts);
        if (facts.engines.some(x => /LTXV/i.test(x))) collectLTXV(graph, facts);
        if (facts.engines.some(x => /MiniMax H3/i.test(x))) collectMiniMaxH3(graph, facts);
        if (facts.isVideo) collectCustomSampler(graph, facts);
        return facts;
    }

    function factsToRows(facts) {
        const lines = [];
        if (facts.engines.length) addUnique(lines, 'Video / Animation: ' + facts.engines.join(' + '));
        facts.lines.forEach(x => addUnique(lines, x));
        if (facts.audioSource) addUnique(lines, 'Audio Source: ' + facts.audioSource);
        else if (facts.audio) addUnique(lines, 'Audio: enabled');
        if (facts.output) addUnique(lines, facts.output);
        return lines.map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
    }

    /* ================================================================
       MAIN PARSER
       ================================================================ */
    function parseComfyVideo(rawText, jsonObj, opts) {
        opts = opts || {};
        const u = unpack(rawText, jsonObj);
        if (!u) return null;
        CTX.workflow = u.workflow && Array.isArray(u.workflow.nodes) ? u.workflow : null;
        const facts = collectFacts(u.prompt, rawText);
        if (!facts.isVideo && !opts.force) return null;

        let base = null;
        try { base = typeof window.parseComfyJSON === 'function' ? window.parseComfyJSON(JSON.stringify(u.prompt)) : null; } catch (e) { base = null; }
        if (!base) base = { pos: '', neg: '', steps: '', cfg: '', seed: '', size: '', sampler: '', scheduler: '', ckpt: '', loras: '', source: 'ComfyUI', _extras: {} };

        const meta = Object.assign({}, base);
        meta._extras = Object.assign({}, base._extras || {});
        meta.source = 'ComfyUI (Video)';

        // video engines use internal sampler stages: their numbers win over the generic image ones
        const p = facts.p || {};
        ['steps', 'cfg', 'seed', 'sampler', 'scheduler'].forEach(k => {
            if (p[k] !== undefined && p[k] !== null && String(p[k]).trim() !== '') meta[k] = String(p[k]);
        });
        if (p.size) meta.size = p.size;
        if (p.denoise !== undefined && String(p.denoise).trim() !== '') meta._extras.denoise = String(p.denoise);
        if (facts.engines.some(x => /WanVideo|LTXV/i.test(x))) meta._extras.extraSamplers = [];

        meta._extras.rows = factsToRows(facts);
        // MiniMax H3 fields live in their own box (not mixed with model/VAE rows)
        const isH3 = facts.engines.some(x => /MiniMax H3/i.test(x));
        if (isH3) {
            meta._extras.boxTitle = 'MiniMax H3';
            meta._extras.boxRows = meta._extras.rows;
            meta._extras.rows = [];
        }

        // MiniMax H3: the assembled prompt (not a CLIPTextEncode) is the positive prompt
        if (facts.h3Prompt) {
            meta.pos = facts.h3Prompt;
            if (facts.h3Title && !/^easy showAnything$|^MiniMax H3 Director$/i.test(facts.h3Title)) (isH3 ? meta._extras.boxRows : meta._extras.rows).push(['Prompt Node', facts.h3Title]);
        } else if (facts.brief && (!meta.pos || /\\n/.test(meta.pos))) {
            meta.pos = facts.brief;
        }
        if (facts.brief && facts.h3Prompt && facts.brief !== facts.h3Prompt) {
            meta.notes = (Array.isArray(meta.notes) ? meta.notes : []).concat([{ name: 'H3 · Brief (local_prompts)', value: facts.brief }]);
        }
        if (!meta.pos && !meta.neg) meta.pos = '[Prompt not available]';
        return meta;
    }
    window.parseComfyVideo = parseComfyVideo;

    /* ================================================================
       MiniMax H3 PROMPTS
       Layout written by the Prompt Helper "MiniMax H3" writer:
         <alignment line>
         [subject_definitions: / summary: / retention_analysis:]   (REF2VA only)
         integrated_multimodal_description: | detailed_description:
               [Shot 1] At 0:00.000 ... [Shot 2] At 0:03.500 ...
         overall_soundscape:
         non_diegetic_music:
       ================================================================ */
    const H3_LABELS = [
        ['subject_definitions', 'Subject definitions'],
        ['summary', 'Summary'],
        ['retention_analysis', 'Retention analysis'],
        ['integrated_multimodal_description', 'Description'],
        ['detailed_description', 'Description'],
        ['overall_soundscape', 'Soundscape'],
        ['non_diegetic_music', 'Music'],
    ];
    const H3_LIMIT = 7000;
    const H3_LABEL_RE = new RegExp('(?:^|\\n)[ \\t]*(' + H3_LABELS.map(l => l[0]).join('|') + ')[ \\t]*:[ \\t]*', 'gi');

    function annotateH3Prompt(meta) {
        if (!meta || meta._h3 || typeof meta.pos !== 'string') return meta;
        const text = meta.pos;
        if (!/(integrated_multimodal_description|detailed_description)\s*:/i.test(text) ||
            !/(overall_soundscape|non_diegetic_music)\s*:/i.test(text)) return meta;

        const hits = [];
        let m;
        H3_LABEL_RE.lastIndex = 0;
        while ((m = H3_LABEL_RE.exec(text)) !== null) {
            hits.push({ key: m[1].toLowerCase(), start: m.index + (m[0].startsWith('\n') ? 1 : 0), body: m.index + m[0].length });
        }
        if (hits.length < 2) return meta;

        const notes = [];
        const alignment = text.slice(0, hits[0].start).trim();
        if (alignment) notes.push({ name: 'H3 · Alignment', value: alignment });

        let shots = 0;
        hits.forEach((h, i) => {
            const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
            const body = text.slice(h.body, end).trim();
            if (!body) return;
            const label = (H3_LABELS.find(l => l[0] === h.key) || [h.key, h.key])[1];
            if (label !== 'Description') { notes.push({ name: 'H3 · ' + label, value: body }); return; }
            const re = /\[Shot\s+(\d+)\][ \t]*(?:At\s+(\d+):(\d+(?:\.\d+)?))?/gi;
            const marks = [];
            let s;
            while ((s = re.exec(body)) !== null) marks.push({ n: s[1], min: s[2], sec: s[3], at: s.index, from: s.index + s[0].length });
            if (!marks.length) { notes.push({ name: 'H3 · Description', value: body }); return; }
            const lead = body.slice(0, marks[0].at).trim();
            if (lead) notes.push({ name: 'H3 · Description', value: lead });
            marks.forEach((mk, k) => {
                const to = k + 1 < marks.length ? marks[k + 1].at : body.length;
                const when = mk.min !== undefined ? ' · ' + mk.min + ':' + (/^\d(?!\d)/.test(mk.sec) ? '0' : '') + mk.sec : '';
                notes.push({ name: 'H3 · Shot ' + mk.n + when, value: body.slice(mk.from, to).trim() });
                shots++;
            });
        });
        if (!notes.length) return meta;

        meta._h3 = true;
        meta.notes = (Array.isArray(meta.notes) ? meta.notes : []).concat(notes);
        meta._extras = meta._extras || {};
        const info = ['MiniMax H3'];
        if (shots) info.push(shots + (shots === 1 ? ' shot' : ' shots'));
        info.push(text.length.toLocaleString('en-US') + ' chars' + (text.length > H3_LIMIT ? ' (over the ' + H3_LIMIT.toLocaleString('en-US') + ' limit)' : ''));
        meta._extras.boxTitle = 'MiniMax H3';
        meta._extras.boxRows = (meta._extras.boxRows || []).concat([['Prompt Format', info.join(' · ')]]);
        return meta;
    }
    window.annotateH3Prompt = annotateH3Prompt;

    // exposed for tests / other tools
    window.ComfyVideoParser = { scanChunk, unpack, collectFacts, parseJsonRelaxed };
})();
