/**
 * parsers/fooocus.js
 *
 * Parser for Fooocus images (base_model / style_selections / adm_guidance JSON structure).
 * Adapted from the reference source (invokeai_fooocus_drawthings_parser.txt).
 *
 * Exports:
 *   window.parseFooocus(text: string, json?: object): object | null
 *
 * Returns a normalised metadata object (see interface.html Block 4 for shape)
 * or null if the input does not look like a Fooocus image.
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

    function isBlank(v) {
        return /^(none|null|undefined|auto|automatic|default|false|—|---)$/i.test(trim(v));
    }

    function addUnique(arr, v) {
        let s = trim(v);
        if (!s || isBlank(s)) return;
        s = cleanName(s);
        if (!s || isBlank(s)) return;
        if (!arr.some(x => txt(x).toLowerCase() === s.toLowerCase())) arr.push(s);
    }

    function addUniqueRaw(arr, v) {
        const s = trim(v);
        if (!s || isBlank(s)) return;
        if (!arr.some(x => txt(x).toLowerCase() === s.toLowerCase())) arr.push(s);
    }

    /* ================================================================
       DETECTION
       Mirrors _v64IsFooocus from the source.
       ================================================================ */

    function isFooocus(text, json) {
        const raw = txt(text);
        if (/\bFooocus\b|Fooocus V2 Expansion|ADM Guidance|Refiner Switch|Base Model:/i.test(raw)) return true;
        if (json && typeof json === 'object') {
            const keys = Object.keys(json).join(' ');
            if (/fooocus/i.test(keys + ' ' + txt(json.source || json.app_id || json.created_by))) return true;
            if (/(base_model|base_model_name|refiner_model|style_selections|performance|sharpness|adm_guidance)/i.test(keys) &&
                /(prompt|negative_prompt|guidance_scale|sampler|scheduler|seed)/i.test(keys)) return true;
        }
        return false;
    }

    /* ================================================================
       JSON EXTRACTION HELPERS
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

    function getFooocusJson(text, json) {
        if (json && isFooocus(text, json)) return json;
        return parseFirstRelevantJson(txt(text), [
            'fooocus', 'base_model', 'base_model_name',
            'refiner_model', 'style_selections', 'adm_guidance'
        ]);
    }

    /* ================================================================
       VALUE HELPERS
       ================================================================ */

    function get(obj, keys) {
        if (!obj || typeof obj !== 'object') return '';
        for (const k of keys) {
            if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
        }
        return '';
    }

    function sizeFromAny(value, obj) {
        if (obj && obj.width  && obj.height)  return obj.width  + ' x ' + obj.height;
        if (obj && obj.image_width  && obj.image_height)  return obj.image_width  + ' x ' + obj.image_height;
        if (obj && obj.resolution_width && obj.resolution_height) return obj.resolution_width + ' x ' + obj.resolution_height;
        let s = trim(value);
        if (!s && obj) s = trim(get(obj, ['resolution', 'resolution_string', 'aspect_ratios_selection', 'image_size', 'size']));
        const m = s.match(/(\d{2,5})\s*[,x×]\s*(\d{2,5})/i) || s.match(/\(\s*(\d{2,5})\s*,\s*(\d{2,5})\s*\)/);
        return m ? (m[1] + ' x ' + m[2]) : s;
    }

    /* ================================================================
       TEXT VALUE HELPERS
       Reads labelled key: value lines from the raw text chunk.
       Mirrors _v64FooocusTextValue and _v64FooocusPromptFromText.
       ================================================================ */

    function textValue(raw, labels) {
        for (const label of labels) {
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp('(?:^|\\n)\\s*' + escaped + '\\s*:\\s*([^\\n]+)', 'i');
            const m  = raw.match(re);
            if (m) return m[1].trim();
        }
        return '';
    }

    function promptFromText(raw, label, stopLabels) {
        raw = raw.replace(/^parameters[\s\0]*/i, '').replace(/^\0+/, '');
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const stop    = stopLabels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const re = new RegExp('(?:^|\\n)\\s*' + escaped + '\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:' + stop + ')\\s*:|$)', 'i');
        const m  = raw.match(re);
        return m ? m[1].trim() : '';
    }

    /* ================================================================
       LORA EXTRACTION
       Mirrors _v64CollectFooocusLoras from the source.
       Handles: array of arrays, array of objects, lora_combined_N keys,
       lora_N_model keys, and "LoRA N Model: / LoRA N Weight:" text lines.
       ================================================================ */

    function collectLoras(meta, text) {
        const loras = [];

        function add(name, weight) {
            if (!name || isBlank(name)) return;
            const cleaned = cleanName(name);
            if (!cleaned || isBlank(cleaned)) return;
            const entry = cleaned + (weight !== undefined && weight !== null && trim(weight) !== '' ? ' | Weight: ' + weight : '');
            addUniqueRaw(loras, entry);
        }

        if (meta) {
            const arr = [...(Array.isArray(meta.loras) ? meta.loras : []), ...(Array.isArray(meta.lora) ? meta.lora : [])];
            arr.forEach(item => {
                if (Array.isArray(item)) {
                    if (typeof item[0] === 'boolean') add(item[1], item[2]);
                    else add(item[0], item[1]);
                } else if (item && typeof item === 'object') {
                    if (item.enabled === false || item.on === false) return;
                    add(get(item, ['name', 'model', 'model_name', 'lora', 'lora_name', 'path']),
                        get(item, ['weight', 'strength', 'model_weight']));
                } else if (typeof item === 'string') {
                    add(item, '');
                }
            });

            // lora_combined_N: "name, weight" or "name | weight"
            for (let i = 1; i <= 10; i++) {
                const combined = get(meta, ['lora_combined_' + i, 'lora_' + i]);
                if (combined) {
                    const m = txt(combined).match(/(.+?)(?:\s*[,|:]\s*(-?\d+(?:\.\d+)?))?$/);
                    if (m) add(m[1], m[2] || '');
                }
                add(get(meta, ['lora_' + i + '_model', 'lora_' + i + '_name', 'lora_model_' + i, 'lora_name_' + i]),
                    get(meta, ['lora_' + i + '_weight', 'lora_weight_' + i]));
            }
        }

        // Text-based LoRA lines: "LoRA 1 Model: name" / "LoRA 1 Weight: 0.8"
        const raw = txt(text);
        for (let i = 1; i <= 10; i++) {
            add(
                textValue(raw, ['LoRA ' + i + ' Model', 'LoRA ' + i + ' Name', 'LoRA [' + i + '] Model', 'LoRA [' + i + '] Name']),
                textValue(raw, ['LoRA ' + i + ' Weight', 'LoRA [' + i + '] Weight'])
            );
        }

        // Generic "LoRA N Model: / Weight:" pattern
        const re = /(?:^|\n)\s*LoRA\s*(?:\[?\d+\]?)?\s*(?:Model|Name)?\s*:\s*([^,\n]+)(?:[\s\S]{0,120}?Weight\s*:\s*([^,\n]+))?/gi;
        let m;
        while ((m = re.exec(raw)) !== null) add(m[1], m[2] || '');

        return loras;
    }

    /* ================================================================
       MAIN PARSER
       ================================================================ */

    /**
     * Parses Fooocus metadata.
     *
     * @param  {string}       text  Raw chunk text from the PNG.
     * @param  {object|null}  json  Pre-parsed JSON object (optional).
     * @returns {object|null}       Normalised metadata object or null.
     */
    function parseFooocus(text, json) {
        const raw = txt(text);

        // Try to parse text as JSON if not already provided
        if (!json && raw.trim().startsWith('{')) {
            try { json = JSON.parse(raw); } catch {}
        }

        if (!isFooocus(raw, json)) return null;

        const meta = getFooocusJson(raw, json) || {};

        const ckpt = cleanName(
            get(meta, ['base_model', 'base_model_name', 'baseModelName', 'checkpoint', 'model']) ||
            textValue(raw, ['Base Model', 'Model'])
        );

        const refiner = get(meta, ['refiner_model', 'refiner_model_name', 'refinerModelName']) ||
                        textValue(raw, ['Refiner Model']);

        const steps     = txt(get(meta, ['steps', 'step_count'])                                   || textValue(raw, ['Steps']));
        const cfg       = txt(get(meta, ['cfg', 'cfg_scale', 'guidance_scale'])                    || textValue(raw, ['Guidance Scale', 'CFG', 'CFG Scale']));
        const seed      = txt(get(meta, ['seed'])                                                   || textValue(raw, ['Seed']));
        const size      = sizeFromAny(
            get(meta, ['resolution', 'aspect_ratios_selection', 'image_size', 'size']) ||
            textValue(raw, ['Resolution', 'Size']),
            meta
        );
        const sampler   = txt(get(meta, ['sampler', 'sampler_name'])                               || textValue(raw, ['Sampler']));
        const scheduler = txt(get(meta, ['scheduler', 'scheduler_name'])                           || textValue(raw, ['Scheduler']));

        const STOP_LABELS = [
            'Negative Prompt', 'Fooocus V2 Expansion', 'Styles', 'Performance',
            'Resolution', 'Sharpness', 'Guidance Scale', 'ADM Guidance',
            'Base Model', 'Refiner Model', 'Refiner Switch',
            'Sampler', 'Scheduler', 'Seed', 'LoRA'
        ];

        const pos = cleanPrompt(
            get(meta, ['prompt', 'positive_prompt', 'positive']) ||
            promptFromText(raw, 'Prompt', STOP_LABELS)
        );
        const neg = cleanPrompt(
            get(meta, ['negative_prompt', 'negative', 'uc']) ||
            promptFromText(raw, 'Negative Prompt', STOP_LABELS.filter(x => x !== 'Negative Prompt'))
        );

        const loras = collectLoras(meta, raw);

        // Extras for _extras (not rendered by interface.html directly)
        let styles = get(meta, ['styles', 'style_selections', 'style_selection']) || textValue(raw, ['Styles']);
        if (Array.isArray(styles)) styles = styles.join(' / ');

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
            source: 'Fooocus',

            _extras: {
                vae:         cleanName(get(meta, ['vae', 'vae_name']) || textValue(raw, ['VAE'])) || null,
                sharpness:   trim(get(meta, ['sharpness']) || textValue(raw, ['Sharpness'])) || null,
                styles:      trim(styles) || null,
                performance: trim(get(meta, ['performance', 'performance_selection']) || textValue(raw, ['Performance'])) || null,
                admGuidance: trim(get(meta, ['adm_guidance', 'adm_guidance_tuple']) || textValue(raw, ['ADM Guidance'])) || null,
                refiner:     (!refiner || isBlank(refiner)) ? null : cleanName(refiner),
                refinerSwitch: trim(get(meta, ['refiner_switch', 'refinerSwitch']) || textValue(raw, ['Refiner Switch'])) || null,
                v2Expansion: promptFromText(raw, 'Fooocus V2 Expansion', [
                    'Styles', 'Performance', 'Resolution', 'Sharpness', 'Guidance Scale',
                    'ADM Guidance', 'Base Model', 'Refiner Model', 'Refiner Switch',
                    'Sampler', 'Scheduler', 'Seed', 'LoRA'
                ]).replace(/\s+/g, ' ').trim() || null,
            }
        };
    }

    /* ================================================================
       EXPORT
       ================================================================ */
    window.parseFooocus = parseFooocus;

})();
