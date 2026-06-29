/**
 * parsers/swarmui.js
 *
 * Parser for SwarmUI images (sui_image_params / sui_models JSON structure).
 * Adapted from the reference source (swarmui_parser.txt).
 *
 * Exports:
 *   window.parseSwarmUI(text: string, json?: object): object | null
 *
 * Returns a normalised metadata object (see interface.html Block 4 for shape)
 * or null if the input does not look like a SwarmUI image.
 */

(function () {

    /* ================================================================
       UTILITIES
       ================================================================ */

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

    function addUnique(arr, v) {
        if (!v) return;
        const s = cleanName(String(v));
        if (s && !arr.some(x => x.toLowerCase() === s.toLowerCase())) arr.push(s);
    }

    /* ================================================================
       DETECTION
       ================================================================ */

    function isSwarmUI(json) {
        return !!(json && (json.sui_image_params || json.sui_models || json.swarm_version));
    }

    /* ================================================================
       SIZE HELPER
       Handles the case where SwarmUI stores aspect ratio + side length
       instead of explicit width/height.
       Mirrors _v63SizeFromSwarm from the source.
       ================================================================ */

    function sizeFromSwarm(sui) {
        if (!sui || typeof sui !== 'object') return '';
        if (sui.width && sui.height) return sui.width + ' x ' + sui.height;

        const ar   = String(sui.aspectratio || sui.aspect_ratio || '').trim();
        const side = Number(sui.sidelength  || sui.side_length  || 0);
        const m    = ar.match(/^(\d+(?:\.\d+)?)\s*[:x\/]\s*(\d+(?:\.\d+)?)$/i);
        if (!m || !side) return '';

        const rw = Number(m[1]);
        const rh = Number(m[2]);
        if (!rw || !rh) return '';

        let w, h;
        if (rw <= rh) { w = side; h = Math.round(side * rh / rw); }
        else          { h = side; w = Math.round(side * rw / rh); }
        return w + ' x ' + h;
    }

    /* ================================================================
       PARAM EXTRACTION
       Mirrors getSwarmParams from the source, with the v6.3 size fallback
       (aspectratio + sidelength) merged in directly.
       ================================================================ */

    function getParams(json) {
        const sui = (json && json.sui_image_params) ? json.sui_image_params : {};
        return {
            steps:     String(sui.steps      || ''),
            cfg:       String(sui.cfgscale   || sui.cfg      || sui.guidance || ''),
            seed:      String(sui.seed       || ''),
            sampler:   String(sui.sampler    || sui.sampler_name || ''),
            scheduler: String(sui.scheduler  || ''),
            size:      (sui.width && sui.height)
                           ? sui.width + ' x ' + sui.height
                           : sizeFromSwarm(sui),
            clip_skip: String(sui.clip_skip  || sui.clipSkip || sui.clipstopatlayer || ''),
        };
    }

    /* ================================================================
       MODEL EXTRACTION
       Mirrors getSwarmCheckpoint + collectSwarmModels from the source.
       ================================================================ */

    function getCheckpoint(json) {
        if (!json) return '';
        const sui    = json.sui_image_params || {};
        const models = Array.isArray(json.sui_models) ? json.sui_models : [];
        const m      = models.find(x => x && x.param === 'model' && x.name);
        return cleanName((m && m.name) || sui.model || '');
    }

    function getModels(json) {
        const out    = { vaes: [], clips: [], text_encoders: [] };
        const sui    = (json && json.sui_image_params) || {};
        const models = Array.isArray(json && json.sui_models) ? json.sui_models : [];

        models.forEach(m => {
            if (!m || !m.name) return;
            const param = String(m.param || '').toLowerCase();
            if (/vae/.test(param))              addUnique(out.vaes,          m.name);
            if (/clip/.test(param))             addUnique(out.clips,         m.name);
            if (/text|encoder|t5|umt5/.test(param)) addUnique(out.text_encoders, m.name);
        });

        [sui.vae, sui.vae_name, sui.vaemodel].forEach(v => addUnique(out.vaes, v));
        [sui.clip, sui.clip_name, sui.clipmodel].forEach(v => addUnique(out.clips, v));
        [sui.text_encoder, sui.text_encoder_name, sui.t5_name, sui.umt5_name].forEach(v => addUnique(out.text_encoders, v));
        return out;
    }

    /* ================================================================
       LORA EXTRACTION
       Mirrors collectSwarmLoras from the source.
       ================================================================ */

    function getLoras(json) {
        if (!json || !json.sui_image_params) return [];
        const sui     = json.sui_image_params;
        const names   = Array.isArray(sui.loras)       ? sui.loras       : [];
        const weights = Array.isArray(sui.loraweights)  ? sui.loraweights : [];

        // Build a display-name map from sui_models (these have the clean file names)
        const modelMap = {};
        if (Array.isArray(json.sui_models)) {
            json.sui_models.forEach(m => {
                if (m && m.param === 'loras' && m.name) {
                    modelMap[cleanName(m.name).toLowerCase()] = cleanName(m.name);
                }
            });
        }

        return names.map((name, i) => {
            const cleaned = cleanName(name);
            const full    = modelMap[cleaned.toLowerCase()] || cleaned;
            const w       = weights[i] !== undefined ? weights[i] : '';
            return full + (w !== '' ? ' | Weight: ' + w : '');
        });
    }

    /* ================================================================
       MAIN PARSER
       ================================================================ */

    /**
     * Parses SwarmUI metadata.
     *
     * @param  {string}       text  Raw chunk text (may contain embedded JSON).
     * @param  {object|null}  json  Pre-parsed JSON object (optional).
     * @returns {object|null}       Normalised metadata object or null.
     */
    function parseSwarmUI(text, json) {
        // Try to parse text as JSON if not already provided
        if (!json && text) {
            try { json = JSON.parse(text); } catch {}
        }

        if (!isSwarmUI(json)) return null;

        const sui = (json.sui_image_params) ? json.sui_image_params : {};
        const p   = getParams(json);
        const ckpt = getCheckpoint(json);
        const loras = getLoras(json);

        const pos = cleanPrompt(sui.prompt        || '');
        const neg = cleanPrompt(sui.negativeprompt || sui.negative_prompt || '');

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
            loras:     loras.join(', '),
            source:    'SwarmUI',

            _extras: {
                clip_skip: p.clip_skip || null,
                // Refiner, upscaler, wildcards etc. — stored for future UI use
                refiner:          cleanName(sui.refiner || sui.refiner_model || sui.refinermodel || '') || null,
                refinerMethod:    sui.refinermethod    || null,
                refinerUpscale:   sui.refinerupscale   || null,
                wildcardSeed:     sui.wildcardseed     || null,
                usedWildcards:    (json.sui_extra_data && Array.isArray(json.sui_extra_data.used_wildcards))
                                      ? json.sui_extra_data.used_wildcards
                                      : null,
            }
        };
    }

    /* ================================================================
       EXPORT
       ================================================================ */
    window.parseSwarmUI = parseSwarmUI;

})();
