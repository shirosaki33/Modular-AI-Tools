/**
 * parsers/invokeai.js
 *
 * Parser for InvokeAI images (invokeai_metadata JSON chunk).
 * Adapted from the reference source (invokeai_fooocus_drawthings_parser.txt).
 *
 * Exports:
 *   window.parseInvokeAI(text: string, json?: object): object | null
 *
 * Returns a normalised metadata object (see interface.html Block 4 for shape)
 * or null if the input does not look like an InvokeAI image.
 */

(function () {

    /* ================================================================
       UTILITIES
       ================================================================ */

    function txt(v) { return v === undefined || v === null ? '' : String(v); }
    function trim(v) { return txt(v).trim(); }

    function cleanName(v) {
        return txt(v)
            .replace(/^['"]+|['"]+$/g, '')
            .replace(/[\\\/]+/g, '/')
            .split('/')
            .pop()
            .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, '')
            .replace(/[_]+/g, ' ')
            .trim();
    }

    function cleanPrompt(p) {
        return txt(p)
            .replace(/^parameters[\s\0]*/i, '')
            .replace(/^\0+/, '')
            .trim();
    }

    function addUnique(arr, v) {
        if (!v) return;
        const s = trim(v);
        if (!s || /^(none|null|undefined|auto|automatic|default|—|---)$/i.test(s)) return;
        if (!arr.some(x => txt(x).toLowerCase() === s.toLowerCase())) arr.push(s);
    }

    /* ================================================================
       DETECTION
       Mirrors _v64IsInvoke from the source.
       ================================================================ */

    function isInvokeAI(text, json) {
        const raw = txt(text);
        if (/invokeai_metadata|invoke[-_ ]?ai|app_id["']?\s*:\s*["']invoke-ai\/InvokeAI/i.test(raw)) return true;
        if (json && typeof json === 'object') {
            const app = txt(json.app_id || json.app || json.source || json.created_by);
            if (/invoke[-_ ]?ai/i.test(app)) return true;
            if ((json.positive_prompt || json.negative_prompt) &&
                (json.model || json.scheduler || json.cfg_scale) &&
                /invoke/i.test(JSON.stringify(json).slice(0, 1200))) return true;
        }
        return false;
    }

    function looksLikeInvokeMeta(obj) {
        if (!obj || typeof obj !== 'object') return false;
        if (obj.positive_prompt !== undefined || obj.negative_prompt !== undefined) return true;
        if (obj.generation_mode !== undefined && (obj.steps !== undefined || obj.cfg_scale !== undefined || obj.seed !== undefined)) return true;
        const app = txt(obj.app_id || obj.app || obj.source || obj.created_by || obj.app_version);
        return /invoke[-_ ]?ai/i.test(app) && (obj.model !== undefined || obj.steps !== undefined || obj.prompt !== undefined);
    }

    /* ================================================================
       JSON EXTRACTION HELPERS
       Mirrors _bExtractLabelJson and _v64ParseFirstRelevantJson.
       ================================================================ */

    function extractBalancedJson(raw, startIdx) {
        let depth = 0, inStr = false, esc = false;
        for (let i = startIdx; i < raw.length; i++) {
            const ch = raw[i];
            if (esc)         { esc = false; continue; }
            if (ch === '\\') { esc = true;  continue; }
            if (ch === '"')  { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    try { return JSON.parse(raw.slice(startIdx, i + 1)); } catch { return null; }
                }
            }
        }
        return null;
    }

    function extractLabeledJson(raw, label) {
        const idx = raw.indexOf(label);
        if (idx === -1) return null;
        const start = raw.indexOf('{', idx + label.length);
        if (start === -1) return null;
        return extractBalancedJson(raw, start);
    }

    function parseFirstRelevantJson(raw, needles) {
        raw = raw.replace(/^parameters[\s\0]*/i, '').replace(/^[\s\0]+/, '').trim();
        if (raw[0] === '{') { try { return JSON.parse(raw); } catch {} }
        for (const needle of needles) {
            const idx = raw.toLowerCase().indexOf(String(needle).toLowerCase());
            if (idx === -1) continue;
            let start = raw.lastIndexOf('{', idx);
            if (start === -1) start = raw.indexOf('{', idx);
            const j = extractBalancedJson(raw, start);
            if (j) return j;
        }
        return null;
    }

    /* ================================================================
       META OBJECT RESOLUTION
       Mirrors _v64GetInvokeMeta — prefers the explicit invokeai_metadata
       chunk over the invokeai_graph which has no generation summary.
       ================================================================ */

    function getInvokeMeta(text, json) {
        const raw = txt(text);

        // First try the explicitly labelled chunk
        const labelled = extractLabeledJson(raw, 'invokeai_metadata');
        if (labelled && looksLikeInvokeMeta(labelled)) return labelled;

        // Then scan for any JSON block containing known InvokeAI fields
        const relevant = parseFirstRelevantJson(raw, [
            'invokeai_metadata', 'invoke-ai/InvokeAI', 'positive_prompt', 'negative_prompt'
        ]);
        if (looksLikeInvokeMeta(relevant)) return relevant;

        // Finally try the pre-parsed json argument itself
        if (looksLikeInvokeMeta(json)) return json;

        return null;
    }

    /* ================================================================
       VALUE HELPERS  (mirrors _v64Get / _v64GetDeep / _v64NormModelObject)
       ================================================================ */

    function get(obj, keys) {
        if (!obj || typeof obj !== 'object') return '';
        for (const k of keys) {
            if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
        }
        return '';
    }

    function getDeep(obj, paths) {
        for (const path of paths) {
            let cur = obj;
            for (const part of path.split('.')) {
                if (!cur || typeof cur !== 'object') { cur = undefined; break; }
                cur = cur[part];
            }
            if (cur !== undefined && cur !== null && cur !== '') return cur;
        }
        return '';
    }

    function normModelObject(v) {
        if (!v) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'object') return v.name || v.model_name || v.modelName || v.path || v.base || v.id || '';
        return '';
    }

    function sizeFromAny(value, obj) {
        if (obj && obj.width  && obj.height)  return obj.width  + ' x ' + obj.height;
        if (obj && obj.image_width  && obj.image_height)  return obj.image_width  + ' x ' + obj.image_height;
        if (obj && obj.resolution_width && obj.resolution_height) return obj.resolution_width + ' x ' + obj.resolution_height;
        let s = trim(value);
        if (!s && obj) s = trim(get(obj, ['resolution', 'resolution_string', 'image_size', 'size']));
        const m = s.match(/(\d{2,5})\s*[,x×]\s*(\d{2,5})/i) || s.match(/\(\s*(\d{2,5})\s*,\s*(\d{2,5})\s*\)/);
        return m ? (m[1] + ' x ' + m[2]) : s;
    }

    /* ================================================================
       MAIN PARSER
       ================================================================ */

    /**
     * Parses InvokeAI metadata.
     *
     * @param  {string}       text  Raw chunk text from the PNG.
     * @param  {object|null}  json  Pre-parsed JSON object (optional).
     * @returns {object|null}       Normalised metadata object or null.
     */
    function parseInvokeAI(text, json) {
        const raw = txt(text);

        if (!isInvokeAI(raw, json)) return null;

        const meta = getInvokeMeta(raw, json);
        if (!meta) return null;

        const ckpt = cleanName(
            getDeep(meta, ['model.name', 'model.model_name', 'model.base', 'model.path']) ||
            normModelObject(meta.model) ||
            get(meta, ['model_name', 'model_id', 'checkpoint', 'base_model'])
        );

        const pos = cleanPrompt(get(meta, ['positive_prompt', 'prompt', 'prompt_text']));
        const neg = cleanPrompt(get(meta, ['negative_prompt', 'negative', 'uc']));

        const steps     = txt(get(meta, ['steps', 'step_count']));
        const cfg       = txt(get(meta, ['cfg_scale', 'cfg', 'guidance_scale']));
        const seed      = txt(get(meta, ['seed']));
        const size      = sizeFromAny('', meta);
        const sampler   = txt(get(meta, ['scheduler', 'sampler', 'sampler_name']));
        const scheduler = '';   // InvokeAI uses "scheduler" as the sampler field name

        // LoRAs
        const loraList = Array.isArray(meta.loras) ? meta.loras : (Array.isArray(meta.lora) ? meta.lora : []);
        const loras = [];
        loraList.forEach(l => {
            const name   = cleanName(normModelObject(l && (l.model || l.lora || l.name || l.model_name || l.path)));
            const weight = l && typeof l === 'object' ? trim(get(l, ['weight', 'model_weight', 'strength', 'strength_model'])) : '';
            if (name) addUnique(loras, name + (weight !== '' ? ' | Weight: ' + weight : ''));
        });

        return {
            pos,
            neg,
            steps,
            cfg,
            seed,
            size,
            sampler,
            scheduler,
            ckpt,
            loras: loras.join(', '),
            source: 'InvokeAI',

            _extras: {
                vae:         cleanName(getDeep(meta, ['vae.name', 'vae.model_name', 'vae.path']) || normModelObject(meta.vae) || get(meta, ['vae_name'])) || null,
                clipText:    cleanName(get(meta, ['clip', 'clip_name', 'text_encoder', 'text_encoder_name', 't5_name', 'umt5_name'])) || null,
                clip_skip:   txt(get(meta, ['clip_skip', 'clipSkip'])) || null,
                cfgRescale:  txt(get(meta, ['cfg_rescale_multiplier', 'cfg_rescale'])) || null,
                strength:    txt(get(meta, ['strength', 'denoising_strength', 'denoise'])) || null,
            }
        };
    }

    /* ================================================================
       EXPORT
       ================================================================ */
    window.parseInvokeAI = parseInvokeAI;

})();
