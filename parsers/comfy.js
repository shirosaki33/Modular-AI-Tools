/**
 * parsers/comfy.js
 *
 * Parser for ComfyUI images (workflow JSON stored in the 'prompt' PNG chunk).
 * Adapted from the reference source (comfyui_parser.txt).
 * VIDEO workflows are intentionally out of scope — this file handles images only.
 *
 * Exports:
 * window.parseComfyJSON(jsonStr: string): object | null
 *
 * Returns a normalised metadata object (see interface.html Block 4 for shape)
 * or null if the string is not a valid ComfyUI workflow.
 */

(function () {

    /* ================================================================
       UTILITIES
       ================================================================ */

    function grab(text, regex) {
        const m = String(text ?? '').match(regex);
        return m ? (m[1] ?? '').trim() : '';
    }

    function cleanName(v) {
        return String(v ?? '')
            .replace(/^['"]+|['"]+$/g, '')
            .replace(/[\\\/]+/g, '/')
            .split('/')
            .pop()
            .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, '')
            .replace(/[_]+/g, ' ')
            .trim();
    }

    function cleanPrompt(p) {
        return String(p || '')
            .replace(/^parameters[\s\0]*/i, '')
            .replace(/^\0+/, '')
            .trim();
    }

    function isBlank(v) {
        return /^(|none|null|undefined|auto|automatic|default|baked|true|false)$/i
            .test(String(v ?? '').trim());
    }

    function isRealModelName(v) {
        if (typeof v !== 'string') return false;
        const t = v.trim();
        if (!t || isBlank(t)) return false;
        if (/^\d+(\.\d+)?$/.test(t)) return false;
        // Comfy link references look like ["2359:2377",0] → "2359:2377,0" after String()
        if (/^\[\s*[\w:-]+\s*,\s*\d+\s*\]$/.test(t)) return false;
        if (/^[\w:-]+\s*,\s*\d+$/.test(t)) return false;
        if (/^(model|clip|vae|latent|image|conditioning|samples)$/i.test(t)) return false;
        if (/^(KSampler|CLIPTextEncode|VAEDecode|VAEEncode|SaveImage|PreviewImage|LoadImage|EmptyLatentImage)$/i.test(t)) return false;
        return true;
    }

    function addUnique(arr, v, keepRaw) {
        if (v === undefined || v === null) return;
        let s = String(v).trim();
        if (!s || isBlank(s)) return;
        if (!keepRaw) s = cleanName(s);
        if (!s || isBlank(s)) return;
        if (!arr.some(x => String(x).toLowerCase() === s.toLowerCase())) arr.push(s);
    }

    /* ================================================================
       NODE HELPERS
       ================================================================ */

    function nodeTitle(node) {
        return (node && node._meta && node._meta.title) || (node && node.title) || '';
    }

    function nodeWidgets(node) {
        return Array.isArray(node && node.widgets_values) ? node.widgets_values : [];
    }

    function isKSampler(node) {
        if (!node || typeof node !== 'object') return false;
        const type  = String(node.class_type || '');
        const title = String(nodeTitle(node) || '');
        const all   = type + ' ' + title;
        if (/SamplerSelect|KSamplerSelect|Sampler Selector|BasicScheduler|Scheduler/i.test(all)) return false;
        return /KSampler|KSampler \(Efficient\)|KSampler Advanced|ImpactKSampler|Efficient KSampler/i.test(all);
    }

    /* ================================================================
       SIZE HELPERS
       ================================================================ */

    function validDim(v) {
        const n = Number(v);
        return Number.isFinite(n) && n >= 64 && n <= 16384 ? Math.round(n) : 0;
    }

    function sizePair(w, h) {
        const ww = validDim(w);
        const hh = validDim(h);
        return ww && hh ? { w: ww, h: hh } : null;
    }

    function sizeToString(pair) {
        return pair && pair.w && pair.h ? (pair.w + ' x ' + pair.h) : '';
    }

    function normSizeString(s) {
        const m = String(s || '').match(/(\d+)\s*[x×]\s*(\d+)/i);
        return m ? sizeToString(sizePair(m[1], m[2])) : '';
    }

    /**
     * Walk the graph backwards from a node to find the canvas/latent size.
     */
    function findSizeFromNode(json, nodeId, depth, visited) {
        depth   = depth   || 0;
        visited = visited || new Set();
        if (!json || !nodeId || depth > 14) return null;
        nodeId = String(nodeId);
        if (visited.has(nodeId) || !json[nodeId]) return null;
        visited.add(nodeId);

        const node   = json[nodeId];
        const inp    = node.inputs  || {};
        const wv     = nodeWidgets(node);
        const type   = String(node.class_type || '');
        const title  = String(nodeTitle(node) || '');
        const allType = type + ' ' + title;

        const direct = sizePair(
            inp.width  ?? inp.W ?? inp.image_width  ?? inp.empty_latent_width  ?? inp.latent_width  ?? inp.target_width,
            inp.height ?? inp.H ?? inp.image_height ?? inp.empty_latent_height ?? inp.latent_height ?? inp.target_height
        );
        if (direct) return direct;

        if (/EmptyLatent|Latent.*Image|Image Dimension|Resolution|Image Size|SDXL.*Empty|Canvas|AspectRatio/i.test(allType)) {
            const nums = wv.filter(v => typeof v === 'number' && validDim(v));
            if (nums.length >= 2) return { w: Math.round(nums[0]), h: Math.round(nums[1]) };
        }

        // Follow priority latent inputs
        for (const k of ['latent_image', 'samples', 'sample', 'image', 'images', 'pixels', 'latent']) {
            if (Array.isArray(inp[k])) {
                const got = findSizeFromNode(json, inp[k][0], depth + 1, visited);
                if (got) return got;
            }
        }

        // Follow any other linked inputs (switches / reroutes) sorted numerically
        const linkKeys = Object.keys(inp)
            .filter(k => Array.isArray(inp[k]))
            .sort((a, b) => {
                const na = Number((a.match(/\d+/) || [9999])[0]);
                const nb = Number((b.match(/\d+/) || [9999])[0]);
                return na - nb;
            });
        for (const k of linkKeys) {
            const got = findSizeFromNode(json, inp[k][0], depth + 1, visited);
            if (got) return got;
        }
        return null;
    }

    function resolveSizeFromValue(json, val) {
        if (Array.isArray(val)) return findSizeFromNode(json, val[0]);
        if (typeof val === 'string' && json && json[val]) return findSizeFromNode(json, val);
        return null;
    }

    /* ================================================================
       INPUT VALUE RESOLVER
       ================================================================ */

    function resolveInputValue(json, val, keys, depth, visited) {
        depth   = depth   || 0;
        visited = visited || new Set();
        if (depth > 10) return '';
        if (!Array.isArray(val)) return val;

        const nodeId = String(val[0] ?? '');
        if (!nodeId || !json || !json[nodeId] || visited.has(nodeId)) return '';
        visited.add(nodeId);

        const node  = json[nodeId];
        const inp   = node.inputs  || {};
        const wv    = nodeWidgets(node);
        const type  = String(node.class_type || '');
        const title = String(nodeTitle(node) || '');
        const all   = type + ' ' + title;

        const probeKeys = [
            ...(keys || []),
            'seed', 'noise_seed', 'steps', 'cfg', 'cfg_scale', 'guidance', 'guidance_scale',
            'value', 'Xi', 'Xf', 'number', 'int', 'float',
            'sampler_name', 'sampler', 'scheduler', 'scheduler_name'
        ];
        for (const k of probeKeys) {
            const v = inp[k];
            if (v !== undefined && v !== null && !Array.isArray(v)) return v;
        }

        // Pass-through nodes
        if (/Any Switch|Switch|Reroute|Primitive/i.test(all)) {
            const linked = Object.keys(inp)
                .filter(k => Array.isArray(inp[k]))
                .sort((a, b) => {
                    const na = Number((a.match(/\d+/) || [9999])[0]);
                    const nb = Number((b.match(/\d+/) || [9999])[0]);
                    return na - nb;
                });
            for (const k of linked) {
                const v = resolveInputValue(json, inp[k], keys, depth + 1, visited);
                if (v !== undefined && v !== null && v !== '') return v;
            }
        }

        const firstScalar = wv.find(v => v !== undefined && v !== null && !Array.isArray(v) && typeof v !== 'object');
        return firstScalar ?? '';
    }

    /* ================================================================
       DEPENDENCY-ORDERED KSAMPLER IDS
       ================================================================ */

    function dependsOnNode(json, startVal, targetId, depth, visited) {
        depth   = depth   || 0;
        visited = visited || new Set();
        targetId = String(targetId || '');
        if (!json || !targetId || depth > 40) return false;

        let id = '';
        if (Array.isArray(startVal)) id = String(startVal[0] ?? '');
        else if (typeof startVal === 'string' && /^\d+/.test(startVal)) id = startVal.split(',')[0];

        if (!id || !json[id] || visited.has(id)) return false;
        if (id === targetId) return true;
        visited.add(id);

        const node = json[id];
        const inp  = node.inputs || {};
        const latentKeys = ['latent_image', 'samples', 'sample', 'pixels', 'image', 'images', 'latent'];
        for (const k of latentKeys) {
            if (Array.isArray(inp[k]) && dependsOnNode(json, inp[k], targetId, depth + 1, visited)) return true;
        }
        return false;
    }

    function kSamplerOrderedIds(json) {
        if (!json || typeof json !== 'object') return [];
        const ids   = Object.keys(json).filter(id => isKSampler(json[id]));
        const index = new Map(ids.map((id, i) => [id, i]));
        return ids.slice().sort((a, b) => {
            const aInp = (json[a] && json[a].inputs) || {};
            const bInp = (json[b] && json[b].inputs) || {};
            const aLatent = aInp.latent_image ?? aInp.latent ?? aInp.samples ?? aInp.image ?? aInp.pixels;
            const bLatent = bInp.latent_image ?? bInp.latent ?? bInp.samples ?? bInp.image ?? bInp.pixels;
            const aDependsOnB = dependsOnNode(json, aLatent, b);
            const bDependsOnA = dependsOnNode(json, bLatent, a);
            if (aDependsOnB && !bDependsOnA) return 1;
            if (bDependsOnA && !aDependsOnB) return -1;
            return (index.get(a) || 0) - (index.get(b) || 0);
        });
    }

    /* ================================================================
       PARAMETER COLLECTION
       ================================================================ */

    function collectAllParameters(json) {
        const p = { steps: '', cfg: '', seed: '', sampler: '', scheduler: '', size: '', clip_skip: '', denoise: '' };
        if (!json || typeof json !== 'object') return p;

        let w = '', h = '', outW = '', outH = '';

        const setFirst = (key, val) => {
            if (Array.isArray(val) || val === undefined || val === null || val === '' || val === 'randomize') return;
            if (key === 'steps'     && !p.steps)     p.steps     = String(val);
            if (key === 'cfg'       && !p.cfg)       p.cfg       = String(val);
            if (key === 'seed'      && !p.seed)      p.seed      = String(val);
            if (key === 'sampler'   && !p.sampler    && typeof val === 'string') p.sampler    = val;
            if (key === 'scheduler' && !p.scheduler  && typeof val === 'string') p.scheduler  = val;
            if (key === 'denoise'   && !p.denoise)   p.denoise   = String(val);
        };

        const setSize = pair => { if (!pair || w || h) return; w = pair.w; h = pair.h; };

        for (const id in json) {
            const node = json[id];
            if (!node || typeof node !== 'object') continue;
            const type  = String(node.class_type || '');
            const title = String(nodeTitle(node) || '');
            const inp   = node.inputs  || {};
            const wv    = nodeWidgets(node);
            const all   = type + ' ' + title;

            // Seed nodes
            if (!p.seed && (/^(RandomNoise|Noise_RandomNoise|Seed\b)/i.test(type) || /\b(seed|noise seed)\b/i.test(title))) {
                setFirst('seed', inp.noise_seed ?? inp.seed ?? inp.value ?? wv[0]);
            }

            // KSampler family
            if (/KSampler|SamplerCustom|SamplerCustomAdvanced|KSampler Advanced|ImpactKSampler|Efficient KSampler/i.test(all)) {
                setFirst('seed', resolveInputValue(json, inp.seed ?? inp.noise_seed ?? wv[0], ['seed', 'noise_seed', 'value']));
                setFirst('steps', resolveInputValue(json, inp.steps, ['steps', 'value', 'Xi', 'Xf']) ?? wv.find(v => typeof v === 'number' && v > 0 && v < 1000));
                setFirst('cfg', resolveInputValue(json, inp.cfg ?? inp.cfg_scale ?? inp.guidance ?? inp.guidance_scale, ['cfg', 'cfg_scale', 'guidance', 'guidance_scale', 'value', 'Xi', 'Xf']) ?? wv.find((v, i) => typeof v === 'number' && v >= 0 && v <= 50 && i > 0));
                setFirst('sampler', resolveInputValue(json, inp.sampler_name ?? inp.sampler, ['sampler_name', 'sampler', 'value']) ?? wv.find(v => typeof v === 'string' && /(euler|dpm|ddim|lms|uni_pc|heun|ipndm|deis)/i.test(v)));
                setFirst('scheduler', resolveInputValue(json, inp.scheduler ?? inp.scheduler_name, ['scheduler', 'scheduler_name', 'value']) ?? wv.find(v => typeof v === 'string' && /(karras|normal|exponential|sgm|simple|ddim|beta|ays|linear|cosine|manual)/i.test(v)));
                setFirst('denoise', resolveInputValue(json, inp.denoise ?? inp.denoising_strength ?? inp.strength, ['denoise', 'denoising_strength', 'strength', 'value', 'Xi', 'Xf']));
                setSize(resolveSizeFromValue(json, inp.latent_image ?? inp.latent ?? inp.samples ?? inp.image));
            }

            // Guiders (Flux, etc.)
            if (/BasicGuider|CFGGuider|FluxGuidance|Guider|RescaleCFG/i.test(all)) {
                setFirst('cfg', resolveInputValue(json, inp.cfg ?? inp.guidance ?? inp.scale ?? inp.multiplier ?? wv[0], ['cfg', 'guidance', 'scale', 'value', 'Xi', 'Xf']));
            }

            // Dedicated sampler / scheduler selector nodes
            if (/SamplerSelect|KSamplerSelect|Sampler Selector/i.test(all)) setFirst('sampler', inp.sampler_name ?? inp.sampler ?? wv[0]);
            if (/Scheduler|BasicScheduler|AlignYourStepsScheduler|SDTurboScheduler|ManualSigmas|Scheduler Selector/i.test(all)) setFirst('scheduler', inp.scheduler ?? inp.scheduler_name ?? wv[0]);

            // CLIP skip
            if (!p.clip_skip && /CLIPSetLastLayer|ClipSkip|CLIP Skip|Set CLIP Last Layer/i.test(all)) {
                const v = inp.stop_at_clip_layer ?? inp.clip_skip ?? inp.value ?? wv[0];
                if (v !== undefined && v !== null) p.clip_skip = String(v);
            }

            // Direct width/height
            if (!w || !h) {
                setSize(sizePair(
                    inp.width  ?? inp.W ?? inp.image_width  ?? inp.empty_latent_width  ?? inp.latent_width,
                    inp.height ?? inp.H ?? inp.image_height ?? inp.empty_latent_height ?? inp.latent_height
                ));
            }

            // EmptyLatent / Resolution nodes (widgets)
            if (!w && /EmptyLatent|Latent.*Image|SDXL.*Empty|Image Dimension|Resolution|Image Size/i.test(all)) {
                const nums = wv.filter(v => typeof v === 'number' && validDim(v));
                if (nums.length >= 2) { w = Math.round(nums[0]); h = Math.round(nums[1]); }
            }

            // Upscale / resize
            if (/ImageScale|ImageResize|Resize Image|UltimateSDUpscale|LatentUpscale|UpscaleLatent|Scale Image|ImageScaleBy/i.test(all)) {
                const pair = sizePair(inp.width || inp.target_width || '', inp.height || inp.target_height || '');
                if (pair && !outW && !outH) { outW = pair.w; outH = pair.h; }
            }
        }

        p.size = w && h ? (w + ' x ' + h) : (outW && outH ? (outW + ' x ' + outH) : '');
        return p;
    }

    /* ================================================================
       PROMPT COLLECTION
       ================================================================ */

    function collectAllPromptNodes(json) {
        if (!json || typeof json !== 'object') return { positive: '', negative: '' };

        const candidates    = [];
        const negCandidates = [];

        const addPrompt = (arr, node, v) => {
            if (typeof v !== 'string' || !v.trim()) return;
            const title = String(nodeTitle(node) || '');
            const type  = String(node.class_type || '');
            arr.push({ text: v, title, type, score: 0 });
        };

        for (const id in json) {
            const node = json[id];
            if (!node || typeof node !== 'object') continue;
            const type  = String(node.class_type || '');
            const title = String(nodeTitle(node) || '');
            const inp   = node.inputs  || {};
            const wv    = nodeWidgets(node);
            const all   = (type + ' ' + title).toLowerCase();

            const v  = inp.text ?? inp.prompt ?? inp.value ?? inp.string ?? inp.positive ?? inp.caption ?? (typeof wv[0] === 'string' ? wv[0] : '');
            const vn = inp.negative ?? inp.negative_prompt ?? inp.uc ?? '';

            if (/efficient loader/i.test(type + ' ' + title)) {
                addPrompt(candidates,    node, inp.positive ?? inp.prompt ?? v);
                addPrompt(negCandidates, node, inp.negative ?? inp.negative_prompt ?? vn);
            }

            if (/negative|uc|uncond/.test(all))                                                           addPrompt(negCandidates, node, v || vn);
            else if (/positive|prompt|caption|text encode|cliptextencode|wildcard|stringmultiline|textinput|showanything|previewany/.test(all)) addPrompt(candidates, node, v);
            if (vn) addPrompt(negCandidates, node, vn);
        }

        const score = c => {
            const all = (c.type + ' ' + c.title).toLowerCase();
            let s = 0;
            if (/positive/.test(all))              s += 50;
            if (/negative|uc|uncond/.test(all))    s -= 80;
            if (/prompt|caption/.test(all))        s += 20;
            if (/cliptextencode|text encode/.test(all)) s += 10;
            if (/preview|showanything/.test(all))  s -= 10;
            s += Math.min(String(c.text).length / 50, 20);
            c.score = s;
            return c;
        };

        const pos = candidates.map(score).sort((a, b) => b.score - a.score)[0];
        const neg = negCandidates.map(score).sort((a, b) => b.score - a.score)[0];
        return {
            positive: cleanPrompt(pos ? pos.text : ''),
            negative: cleanPrompt(neg ? neg.text : '')
        };
    }

    /* ================================================================
       MODEL LOADERS
       ================================================================ */

    function collectAllModelLoaders(json) {
        const out = { checkpoints: [], unets: [], vaes: [], clips: [], text_encoders: [], loras: [] };
        if (!json || typeof json !== 'object') return out;

        const add = (key, v) => addUnique(out[key], v);

        for (const id in json) {
            const node = json[id];
            if (!node || typeof node !== 'object') continue;
            const type  = String(node.class_type || '');
            const title = String(nodeTitle(node) || '');
            const inp   = node.inputs  || {};
            const wv    = nodeWidgets(node);
            const all   = type + ' ' + title;

            const bad = /lora|upscale|controlnet|t2iadapter|ipadapter|samloader|ultralytics|bbox|segm|detector|preview|note/i.test(all);

            if (!bad && (/checkpointloader|tinyloader|fullloader|efficient loader|easy.*loader/i.test(all) || inp.ckpt_name)) {
                add('checkpoints', inp.ckpt_name || inp.checkpoint || inp.model_name || wv[0]);
            }
            if (!bad && (/unetloader|diffusionmodelload/i.test(all) || inp.unet_name || inp.diffusion_model_name)) {
                add('unets', inp.unet_name || inp.diffusion_model_name || inp.model_name || wv[0]);
            }
            if (/vaeloader|vae loader/i.test(all)) add('vaes', inp.vae_name || inp.model_name || wv[0]);

            if (/cliploader|textencoder|text encoder|t5|umt5/i.test(all)) {
                [inp.clip_name, inp.clip_name1, inp.clip_name2, inp.clip_name3, inp.t5_name, inp.umt5_name, inp.text_encoder_name, wv[0], wv[1], wv[2]].forEach(v => {
                    if (/t5|umt5|text[-_ ]?encoder|qwen/i.test(String(v || ''))) add('text_encoders', v);
                    else add('clips', v);
                });
            }

            if (/LoraLoader|LoRALoader|Load LoRA|Apply LoRA|LoRA Loader|Lora Loader/i.test(all)) {
                const name   = inp.lora_name || inp.lora || inp.name || inp.model_name || wv[0];
                const weight = inp.strength_model ?? inp.model_weight ?? inp.strength ?? wv[1];
                if (isRealModelName(String(name || ''))) {
                    const entry = cleanName(name) + (weight !== undefined && weight !== null && weight !== '' ? ' | Weight: ' + weight : '');
                    addUnique(out.loras, entry, true);
                }
            }

            if (/LoRA Stacker/i.test(all)) {
                const count = Math.max(0, Math.min(100, parseInt(inp.lora_count ?? inp.count ?? wv.find(v => typeof v === 'number' && v > 0 && v < 1000) ?? 0, 10) || 0));
                for (let i = 1; i <= count; i++) {
                    const name   = inp['lora_name_' + i] || inp['lora_' + i] || inp['name_' + i];
                    const weight = inp['lora_wt_' + i] ?? inp['model_str_' + i] ?? inp['strength_' + i] ?? inp['weight_' + i];
                    if (isRealModelName(String(name || ''))) {
                        addUnique(out.loras, cleanName(name) + (weight !== undefined && weight !== '' ? ' | Weight: ' + weight : ''), true);
                    }
                }
            }

            if (/Power Lora Loader|PowerLoraLoader/i.test(all)) {
                Object.keys(inp).forEach(k => {
                    const item = inp[k];
                    if (/^lora_\d+$/i.test(k) && item && typeof item === 'object' && item.on !== false) {
                        const name   = item.lora || item.name;
                        const weight = item.strength ?? item.model_weight;
                        if (isRealModelName(String(name || ''))) {
                            addUnique(out.loras, cleanName(name) + (weight !== undefined ? ' | Weight: ' + weight : ''), true);
                        }
                    }
                });
            }
        }

        return out;
    }

    /* ================================================================
       PARAMS FOR A SINGLE KSAMPLER NODE
       ================================================================ */

    function kSamplerParams(json, id) {
        const node = json && json[String(id)];
        if (!node) return null;
        const inp = node.inputs  || {};
        const wv  = nodeWidgets(node);

        const sizeInput = inp.latent_image ?? inp.latent ?? inp.samples ?? inp.image ?? inp.pixels;
        const sizePairVal = resolveSizeFromValue(json, sizeInput);
        const directPairVal = sizePair(
            inp.width  ?? inp.W ?? inp.image_width  ?? inp.empty_latent_width  ?? inp.latent_width,
            inp.height ?? inp.H ?? inp.image_height ?? inp.empty_latent_height ?? inp.latent_height
        );
        const resolvedSize = sizePairVal || directPairVal;

        const scalarNumber = (min, max) => wv.find(v => typeof v === 'number' && v >= min && v <= max);
        return {
            node_id:   String(id),
            steps:     String(resolveInputValue(json, inp.steps, ['steps', 'value', 'Xi', 'Xf']) ?? scalarNumber(1, 999) ?? ''),
            cfg:       String(resolveInputValue(json, inp.cfg ?? inp.cfg_scale ?? inp.guidance ?? inp.guidance_scale, ['cfg', 'cfg_scale', 'guidance', 'guidance_scale', 'value', 'Xi', 'Xf']) ?? ''),
            seed:      String(resolveInputValue(json, inp.seed ?? inp.noise_seed ?? wv[0], ['seed', 'noise_seed', 'value']) ?? ''),
            sampler:   String(resolveInputValue(json, inp.sampler_name ?? inp.sampler, ['sampler_name', 'sampler', 'value']) ?? wv.find(v => typeof v === 'string' && /(euler|dpm|ddim|lms|uni_pc|heun|ipndm|deis)/i.test(v)) ?? ''),
            scheduler: String(resolveInputValue(json, inp.scheduler ?? inp.scheduler_name, ['scheduler', 'scheduler_name', 'value']) ?? wv.find(v => typeof v === 'string' && /(karras|normal|exponential|sgm|simple|ddim|beta|ays|linear|cosine|manual)/i.test(v)) ?? ''),
            denoise:   String(resolveInputValue(json, inp.denoise ?? inp.denoising_strength ?? inp.strength, ['denoise', 'denoising_strength', 'strength', 'value', 'Xi', 'Xf']) ?? ''),
            start_step: String(resolveInputValue(json, inp.start_at_step, ['start_at_step', 'value']) ?? ''),
            end_step:   String(resolveInputValue(json, inp.end_at_step, ['end_at_step', 'value']) ?? ''),
            size:      resolvedSize ? (resolvedSize.w + ' x ' + resolvedSize.h) : ''
        };
    }

    /* ================================================================
       MAIN PARSER
       ================================================================ */

    /**
     * Parses a ComfyUI workflow JSON string.
     */
    function parseComfyJSON(jsonStr) {
        // --- Parse JSON ---
        let json;
        try { 
            // Sanitiza o JSON antes do parse para lidar com arrays que contém [NaN] ou [Infinity],
            // que são exportados pelo Python mas quebram o padrão estrito do JSON no JavaScript.
            let safeStr = String(jsonStr || '')
                .replace(/:\s*NaN/g, ': null')
                .replace(/\[\s*NaN\s*\]/g, '[null]')
                .replace(/:\s*Infinity/g, ': null')
                .replace(/:\s*-Infinity/g, ': null');
            
            json = JSON.parse(safeStr); 
        } catch { 
            return null; 
        }

        if (Array.isArray(json?.nodes)) {
            const dict = {};
            json.nodes.forEach(n => { if (n?.id != null) dict[String(n.id)] = n; });
            json = dict;
        }

        if (!json || typeof json !== 'object' || !Object.values(json).some(n => n?.class_type)) return null;

        // --- Models ---
        const models    = collectAllModelLoaders(json);
        const mainModel = models.checkpoints.length ? models.checkpoints : models.unets;
        const ckpt      = mainModel.join(' | ');

        // --- Params ---
        const orderedIds    = kSamplerOrderedIds(json);
        const primaryParams = orderedIds.length ? kSamplerParams(json, orderedIds[0]) : null;
        const globalParams  = collectAllParameters(json);

        const p = {
            steps:     primaryParams?.steps     || globalParams.steps,
            cfg:       primaryParams?.cfg       || globalParams.cfg,
            seed:      primaryParams?.seed      || globalParams.seed,
            sampler:   primaryParams?.sampler   || globalParams.sampler,
            scheduler: primaryParams?.scheduler || globalParams.scheduler,
            denoise:   primaryParams?.denoise   || globalParams.denoise,
            size:      primaryParams?.size      || globalParams.size || '',
            clip_skip: globalParams.clip_skip,
        };

        p.size = normSizeString(p.size);

        // --- Prompts ---
        const prompts = collectAllPromptNodes(json);
        let pos = prompts.positive || '';
        let neg = prompts.negative || '';

        if (!pos) {
            const engPrompt = grab(jsonStr, /"text"\s*:\s*"([^"]{5,})"/i);
            pos = engPrompt ? cleanPrompt(engPrompt) : '';
        }

        // --- LoRAs ---
        const loraSet = [...models.loras];
        const loraRe  = /"lora_name"\s*:\s*"([^"]+)".*?"strength_model"\s*:\s*([0-9.]+)/gis;
        let lm;
        while ((lm = loraRe.exec(jsonStr)) !== null) {
            const entry = cleanName(lm[1]) + ' | Weight: ' + lm[2];
            addUnique(loraSet, entry, true);
        }

        // --- Normalised return object ---
        return {
            pos,
            neg,
            steps:     p.steps,
            cfg:       p.cfg,
            seed:      p.seed,
            size:      p.size,
            sampler:   p.sampler,
            scheduler: p.scheduler,
            ckpt,
            loras:     loraSet.join(', '),
            source:    'ComfyUI',

            _extras: {
                denoise:   p.denoise   || null,
                clip_skip: p.clip_skip || null,
                vae:       models.vaes.join(' | ')       || null,
                clipText:  [...models.clips, ...models.text_encoders].join(' | ') || null,
                extraSamplers: orderedIds.slice(1).map(id => kSamplerParams(json, id)).filter(Boolean),
            }
        };
    }

    /* ================================================================
       EXPORT
       ================================================================ */
    window.parseComfyJSON = parseComfyJSON;

})();