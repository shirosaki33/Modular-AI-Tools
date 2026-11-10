/**
 * parsers/novelai.js
 *
 * Parser for NovelAI images (v4_prompt / v4_negative_prompt JSON structure).
 * Adapted from the reference source (novelai_parser.txt).
 *
 * Exports:
 * window.parseNovelAI(text: string, json?: object): object | null
 *
 * Returns a normalised metadata object (see interface.html Block 4 for shape)
 * or null if the text/json does not look like a NovelAI image.
 */

(function () {

    /* ================================================================
       UTILITIES  (local to this file, not exported)
       ================================================================ */

    function grab(text, regex) {
        const m = String(text ?? '').match(regex);
        return m ? (m[1] ?? '').trim() : '';
    }

    function cleanPrompt(p) {
        return String(p || '')
            .replace(/^parameters[\s\0]*/i, '')
            .replace(/^\0+/, '')
            .trim();
    }

    // Formata nomes conhecidos de modelos caso venham especificados (ex: via ComfyUI)
    function formatModelName(raw) {
        const s = String(raw || '').trim();
        if (!s || s.toLowerCase() === 'novelai') return 'NovelAI';
        
        const low = s.toLowerCase().replace(/[\s_]+/g, '-');
        
        // V5
        if (/nai-diffusion-5-full|v5.*full/.test(low))       return 'NAI Diffusion 5 FULL';
        if (/nai-diffusion-5-curated|v5.*curated/.test(low)) return 'NAI Diffusion 5 Curated';
        if (/nai-diffusion-v?5\b|diffusion-v5\b/.test(low)) return 'NAI Diffusion 5';
        // V4.5
        if (/nai-diffusion-4-5-full|v4\.5.*4bde2a90/.test(low))    return 'NAI Diffusion 4.5 FULL';
        if (/nai-diffusion-4-5-curated|v4\.5.*c02d4f98/.test(low)) return 'NAI Diffusion 4.5 Curated';
        // Source text without a known hash (e.g. "NovelAI Diffusion V4.5 ...")
        if (/diffusion-v4\.5.*curated/.test(low)) return 'NAI Diffusion 4.5 Curated';
        if (/diffusion-v4\.5/.test(low) && !/4bde2a90|c02d4f98/.test(low)) return 'NAI Diffusion 4.5';
        // V4
        if (/nai-diffusion-4-full|v4.*37442fca/.test(low))          return 'NAI Diffusion 4.0 FULL';
        if (/nai-diffusion-4-curated|v4.*7abffa2a/.test(low))       return 'NAI Diffusion 4.0 Curated';
        // V3
        if (/nai-diffusion-3|8ba2af87/.test(low)) return 'NAI Diffusion 3';
        // Anime V2
        if (/nai-diffusion-anime-v2/.test(low)) return 'NAI Diffusion Anime V2';
        // Anime V1
        if (/nai-diffusion-anime-curated/.test(low)) return 'NAI Diffusion Anime Curated';
        if (/nai-diffusion-anime/.test(low)) return 'NAI Diffusion Anime Full';
        // Furry
        if (/nai-diffusion-furry-v3/.test(low)) return 'NAI Diffusion Furry V3';
        if (/nai-diffusion-furry/.test(low)) return 'NAI Diffusion Furry';
        
        // Fallback genérico para custom/unknown models
        return s.replace(/^['"]+|['"]+$/g, '')
                .replace(/[\\\/]+/g, '/')
                .split('/')
                .pop()
                .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, '')
                .replace(/[_]+/g, ' ')
                .trim() || 'NovelAI';
    }

    /* ================================================================
       DETECTION
       Returns true if this text / json looks like a NovelAI image.
       Checks for the two most reliable markers:
         - the string "NovelAI" anywhere in the text
         - the "v4_prompt" key in the raw text or in the parsed json
       ================================================================ */

    /* ================================================================
       GUARD: ComfyUI node-graph workflows
       Workflows exported from ComfyUI (including ones that use the
       custom NovelAI nodes: NovelAII2I, NovelAIParameters, etc.) are a
       flat object keyed by numeric node ids, each with a "class_type".
       That structure isn't the native NovelAI PNG metadata this parser
       is built for, so we bail out and let parsers/comfyui_novelai.js
       (which understands the node graph) handle it instead.
       ================================================================ */

    function looksLikeComfyWorkflow(json) {
        if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
        const entries = Object.values(json);
        if (!entries.length) return false;
        let nodeLike = 0;
        for (const v of entries) {
            if (v && typeof v === 'object' && typeof v.class_type === 'string') nodeLike++;
        }
        return (nodeLike / entries.length) > 0.5;
    }

    function isNovelAI(text, json) {
        const raw = String(text || '');
        if (/\bNovelAI\b/i.test(raw))       return true;
        if (/"v4_prompt"\s*:/i.test(raw))    return true;
        if (json && typeof json === 'object') {
            if (json.v4_prompt !== undefined)           return true;
            if (json.v4_negative_prompt !== undefined)  return true;
            // Loose check: has "prompt" + "uc" + "sampler" like NAI's flat JSON
            if (json.prompt !== undefined && json.uc !== undefined && json.sampler !== undefined) return true;
        }
        return false;
    }

    /* ================================================================
       CHARACTER POSITIONS
       NovelAI v4 supports placing characters on a grid using x/y coords.
       When use_coords is true and coords are present, we build a label
       like "A1" or "B2". When use_coords is false, positions are AI-chosen.
       ================================================================ */

    function getUseCoords(json, text) {
        if (json && json.v4_prompt && json.v4_prompt.use_coords !== undefined) {
            return json.v4_prompt.use_coords === true || json.v4_prompt.use_coords === 'true';
        }
        const raw = String(text || '');
        const m = raw.match(/"v4_prompt"[\s\S]*?"use_coords"\s*:\s*(true|false)/i);
        return m ? m[1].toLowerCase() === 'true' : false;
    }

    function getCharacterPositions(json, text) {
        // Returns array of { x, y } objects (may have nulls if not set).
        const useCoords = getUseCoords(json, text);
        if (!useCoords) return [];

        const positions = [];
        try {
            const vp = json && json.v4_prompt;
            const src = vp ? (vp.caption || vp) : null;
            const charCaptions = (src && src.char_captions) || [];
            charCaptions.forEach(c => {
                const pos = (c && c.centers && c.centers[0]) || {};
                positions.push({ x: pos.x ?? null, y: pos.y ?? null });
            });
        } catch (e) {}

        return positions;
    }

    function formatGridLabel(x, y) {
        // Converts fractional x/y (0–1) to a column letter (A–E) + row number (1–5) label.
        if (x === null || x === undefined || y === null || y === undefined) return '';
        // NovelAI's character grid is 5x5 (A1 ... E5); centers are 0.1, 0.3, 0.5, 0.7, 0.9
        const ix = Math.min(4, Math.max(0, Math.floor(Number(x) * 5)));
        const iy = Math.min(4, Math.max(0, Math.floor(Number(y) * 5)));
        return 'ABCDE'[ix] + (iy + 1);
    }

    /* ================================================================
       CHECKPOINT DETECTION (Inteligente/Inferência)
       ================================================================ */

    function detectCheckpoint(text, json) {
        let raw = '';
        if (json && typeof json === 'object') {
            raw = json.model || json.Source || '';
            // Se for apenas 'NovelAI', limpa para forçar a busca ou dedução abaixo
            if (raw && raw.toLowerCase() === 'novelai') raw = '';
        }
        
        if (!raw) {
            raw = grab(String(text || ''), /"model"\s*:\s*"([^"]+)"/i);
        }

        let modelName = formatModelName(raw);

        // Se o gerador nativo do site NovelAI não embutiu o nome exato do modelo (ou usou "Stable Diffusion"),
        // vamos inferir de qual versão se trata baseando-se na estrutura do JSON da imagem.
        if (modelName === 'NovelAI' || modelName.toLowerCase().includes('stable diffusion')) {
            const rawStr = String(text || '');
            // V5 continua usando o payload "params_version":4 + v4_prompt, então só dá pra
            // diferenciar de V4/V4.5 quando o campo "model" (nai-diffusion-5-*) está presente
            // acima. Sem esse campo, caímos no rótulo genérico abaixo.
            if (rawStr.includes('"v4_prompt"') || (json && json.v4_prompt)) {
                return 'NAI Diffusion V4 / V4.5 / V5';
            }
            if (rawStr.includes('"sm_dyn"') || rawStr.includes('"sm"')) {
                return 'NAI Diffusion V3';
            }
            if (rawStr.includes('"uc"')) {
                return 'NAI Diffusion Anime V2 / V3';
            }
            return 'NovelAI';
        }

        return modelName;
    }

    /* ================================================================
       MAIN PARSER
       ================================================================ */

    /**
     * Parses NovelAI metadata.
     *
     * @param  {string}       text  Raw chunk text from the PNG.
     * @param  {object|null}  json  Pre-parsed JSON object (optional).
     * @returns {object|null}       Normalised metadata object or null.
     */
    function parseNovelAI(text, json) {
        const raw = String(text || '');

        if (!json && raw.trim().startsWith('{')) {
            try { json = JSON.parse(raw); } catch (e) {}
        }

        // Let the dedicated ComfyUI/NovelAI-node parser own workflow JSON.
        if (looksLikeComfyWorkflow(json)) return null;

        if (!isNovelAI(raw, json)) return null;

        // A1111/Forge text that merely mentions "NovelAI" in the prompt is not NovelAI metadata.
        if (!json && !/"v4_prompt"\s*:/i.test(raw) && /(?:^|[,\n])\s*Steps:\s*\d/i.test(raw)) return null;

        let pos = '', neg = '', steps = '', cfg = '', seed = '',
            size = '', sampler = '', scheduler = '', ckpt = '';

        // --- PATH A: structured JSON available ---
        if (json && typeof json === 'object') {
            const sizeRaw = (json.width && json.height)
                ? json.width + ' x ' + json.height
                : '';

            steps     = String(json.steps     || '');
            cfg       = String(json.scale      || '');
            seed      = (json.seed === 0 || json.seed) ? String(json.seed) : '';
            size      = sizeRaw;
            sampler   = String(json.sampler    || '');
            scheduler = String(json.noise_schedule || '');
            ckpt      = detectCheckpoint(raw, json);

            const vp  = json.v4_prompt;
            const vnp = json.v4_negative_prompt;

            pos = cleanPrompt(
                vp
                    ? ((vp.caption && vp.caption.base_caption) || vp.base_caption || '')
                    : (json.prompt || '')
            );
            neg = cleanPrompt(
                vnp
                    ? ((vnp.caption && vnp.caption.base_caption) || vnp.base_caption || '')
                    : (json.uc || '')
            );

            // --- Character prompts (Converted into standard Notes) ---
            const charPosList = vp  ? ((vp.caption  || vp).char_captions  || []) : [];
            const charNegList = vnp ? ((vnp.caption || vnp).char_captions || []) : [];
            const useCoords   = getUseCoords(json, raw);
            const positions   = getCharacterPositions(json, raw);
            const count       = Math.max(charPosList.length, charNegList.length);
            const hasCoords   = useCoords && positions.some(
                c => c && c.x !== null && c.x !== undefined
            );

            const notes = [];
            for (let i = 0; i < count; i++) {
                const charPos = cleanPrompt(String(charPosList[i]?.char_caption || ''));
                const charNeg = cleanPrompt(String(charNegList[i]?.char_caption || ''));
                
                if (!charPos && !charNeg) continue;

                let label = '';
                if (hasCoords) {
                    const gridLabel = formatGridLabel(positions[i]?.x, positions[i]?.y);
                    if (gridLabel) label = `Character ${gridLabel}`;
                }
                if (!label) label = `Character ${notes.length + 1}`;

                let value = '';
                if (charPos) value += `Positive: ${charPos}`;
                if (charNeg) value += (value ? '\n' : '') + `Negative: ${charNeg}`;

                notes.push({ name: label, value });
            }

            return {
                pos, neg, steps, cfg, seed, size, sampler, scheduler, ckpt,
                loras: '',
                notes,       
                source: 'NovelAI'
            };
        }

        // --- PATH B: text-only fallback (no parsed json) ---
        steps     = grab(raw, /"steps"\s*:\s*([0-9]+)/i);
        cfg       = grab(raw, /"scale"\s*:\s*([0-9.]+)/i);
        seed      = grab(raw, /"seed"\s*:\s*([0-9]+)/i);
        sampler   = grab(raw, /"sampler"\s*:\s*"([^"]+)"/i);
        scheduler = grab(raw, /"noise_schedule"\s*:\s*"([^"]+)"/i);
        ckpt      = detectCheckpoint(raw, null);

        pos = cleanPrompt(
            grab(raw, /"v4_prompt".*?"caption".*?"base_caption"\s*:\s*"([^"]*)"/is) ||
            grab(raw, /"prompt"\s*:\s*"([^"]*)"/i)
        );
        neg = cleanPrompt(
            grab(raw, /"v4_negative_prompt".*?"caption".*?"base_caption"\s*:\s*"([^"]*)"/is) ||
            grab(raw, /"uc"\s*:\s*"([^"]*)"/i)
        );

        const w = grab(raw, /"width"\s*:\s*([0-9]+)/i);
        const h = grab(raw, /"height"\s*:\s*([0-9]+)/i);
        size = (w && h) ? w + ' x ' + h : '';

        return {
            pos, neg, steps, cfg, seed, size, sampler, scheduler, ckpt,
            loras: '',
            notes: [],
            source: 'NovelAI'
        };
    }

    /* ================================================================
       EXPORT
       ================================================================ */
    window.parseNovelAI = parseNovelAI;

})();