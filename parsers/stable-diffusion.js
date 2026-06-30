/**
 * parsers/stable-diffusion.js
 *
 * Parser for Stable Diffusion (A1111 / Forge / SD.Next / Neo / Classic)
 * Adapted from the reference source (stable_diffusion_a1111_forks.txt).
 *
 * Exports:
 *   window.parseStableDiffusion(text: string): object | null
 *
 * Returns a normalised metadata object (see interface.html Block 4 for shape)
 * or null if the text does not look like an SD image.
 */

(function () {

    /* ================================================================
       UTILITIES  (local to this file, not exported)
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
            .trim();
    }

    function cleanPrompt(p) {
        return String(p || '')
            .replace(/^parameters[\s\0]*/i, '')
            .replace(/^\0+/, '')
            .trim();
    }

    function isBlankModel(v) {
        return /^(|—|---|none|null|undefined|auto|automatic|default|baked|baked vae|use same choices)$/i
            .test(String(v ?? '').trim());
    }

    function addUnique(arr, value, keepRaw) {
        if (value === undefined || value === null) return;
        let s = String(value).trim();
        if (!s || isBlankModel(s)) return;
        if (!keepRaw) s = cleanName(s);
        if (!s || isBlankModel(s)) return;
        if (!arr.some(x => String(x).toLowerCase() === s.toLowerCase())) arr.push(s);
    }

    /* ================================================================
       SOURCE CLASSIFIER
       Detects Forge / SD.Next / Neo / Classic from the raw text.
       Returns a human-readable label string.
       ================================================================ */

    function classifySource(text) {
        const raw = String(text || '');
        const low = raw.toLowerCase();

        // Read the last occurrence of "Version: ..." to avoid false positives
        const versionMatches = Array.from(raw.matchAll(/(?:^|[,\n])\s*Version\s*:\s*([^,\n]+)/gi));
        const version = versionMatches.length
            ? String(versionMatches[versionMatches.length - 1][1]).trim().toLowerCase()
            : '';

        if (/sd\.next|sdnext|vladmandic/.test(low))              return 'Stable Diffusion (SD.Next)';
        if (/sd-webui-forge|webui forge|\bforge\b/.test(low))    return 'Stable Diffusion (Forge)';
        if (/^(neo|sd[-_ ]?neo|stable diffusion neo)$/.test(version) ||
            /stable diffusion neo|sd[-_ ]?neo/i.test(raw))       return 'Stable Diffusion (Neo)';
        if (/\bModule\s*[12]\s*:/i.test(raw) ||
            /\bDistilled CFG Scale\s*:/i.test(raw) ||
            /(?:^|[,\n])\s*Shift\s*:/i.test(raw))                return 'Stable Diffusion (Neo)';
        if (/^(classic|sd[-_ ]?classic|stable diffusion classic)$/.test(version) ||
            /stable diffusion classic|sd[-_ ]?classic/i.test(raw)) return 'Stable Diffusion (Classic)';

        return 'Stable Diffusion';
    }

    /* ================================================================
       LORA EXTRACTION
       Handles both inline <lora:name:weight> tags and
       the "Lora_N Model name: / Strength model:" format.
       ================================================================ */

    function extractLoras(text) {
        const out = [];
        const raw = String(text || '');

        // Inline tags: <lora:name:weight> or [lora:name:weight]
        const re1 = /[<\[]lora:([^:\]>]+):?([^\]>]*)[\]>]/gi;
        let m;
        while ((m = re1.exec(raw)) !== null) {
            const name = cleanName(m[1]);
            const w    = String(m[2] || '').trim();
            if (name) addUnique(out, name + (w ? ' | Weight: ' + w : ''), true);
        }

        // "Lora_N Model name: X, Lora_N Strength model: Y" format
        const re2 = /Lora_\d+\s+Model name:\s*([^,\n]+)(?:[\s\S]{0,120}?Lora_\d+\s+Strength model:\s*([^,\n]+))?/gis;
        while ((m = re2.exec(raw)) !== null) {
            const name = cleanName(m[1]);
            const w    = String(m[2] || '').trim();
            if (name && !/^none$/i.test(name))
                addUnique(out, name + (w && w !== '0.0' ? ' | Weight: ' + w : ''), true);
        }

        return out;
    }

    /* ================================================================
       UPSCALE RESOLUTION HELPER
       Calculates the final upscaled resolution from base size + scale.
       ================================================================ */

    function resolveUpscaleSize(sizeRaw, hiresRes, hiresScale, ppScale) {
        if (sizeRaw && ppScale) {
            const parts = sizeRaw.match(/(\d+)x(\d+)/);
            if (parts) {
                const sc = parseFloat(ppScale);
                return Math.round(parts[1] * sc) + 'x' + Math.round(parts[2] * sc);
            }
        }
        if (hiresRes) return hiresRes;
        if (hiresScale && sizeRaw) {
            const parts = sizeRaw.match(/(\d+)x(\d+)/);
            if (parts) {
                const sc = parseFloat(hiresScale);
                return Math.round(parts[1] * sc) + 'x' + Math.round(parts[2] * sc);
            }
        }
        return '';
    }

    /* ================================================================
       DETECTION HELPERS  (checkpoint, VAE — simplified subset of source)
       ================================================================ */

    function detectCheckpoint(text) {
        const raw = String(text || '');
        const v = grab(raw, /(?:Model|Checkpoint):\s*([^,\n]+)/i);
        return cleanName(v);
    }

    /* ================================================================
       MAIN PARSER
       ================================================================ */

    /**
     * Parses a Stable Diffusion "parameters" chunk string.
     *
     * @param  {string}      text  Raw chunk text from the PNG.
     * @returns {object|null}      Normalised metadata object or null.
     */
    function parseStableDiffusion(text) {
        const raw = String(text || '');

        // Quick sanity check — bail early if this doesn't look like SD metadata
        if (!raw ||
            (!/Steps:\s*\d+/i.test(raw) &&
             !/Sampler:\s*\S/i.test(raw) &&
             !/Negative prompt:/i.test(raw))) {
            return null;
        }

        // Clean up the raw text (remove leading "parameters\0" artefacts)
        const clean = raw.replace(/^parameters[\s\0]*/i, '').replace(/^\0+/, '').trim();

        // --- Size / upscale ---
        const sizeRaw    = grab(raw, /Size:\s*([^,\n]+)/i).trim();
        const hiresRes   = grab(raw, /Hires resize:\s*([^,\n]+)/i).trim();
        const hiresScale = grab(raw, /Hires upscale:\s*([^,\n]+)/i).trim();
        const ppScale    = grab(raw, /Postprocess upscale by:\s*([^,\n]+)/i).trim();
        const upscaleRes = resolveUpscaleSize(sizeRaw, hiresRes, hiresScale, ppScale);

        // Use the upscaled resolution as final size when hires fix is active
        const finalSize = (upscaleRes && (hiresRes || hiresScale)) ? upscaleRes : sizeRaw;

        // --- Prompts ---
        const pos = cleanPrompt(grab(clean, /^(.*?)(Negative prompt:|Steps:|Sampler:|$)/is));
        const neg = cleanPrompt(grab(clean, /Negative prompt:\s*(.*?)(Steps:|Sampler:|CFG scale:|Seed:|Size:|$)/is));

        // --- Generation params ---
        const steps     = grab(raw, /Steps:\s*([^,\n]+)/i);
        const cfg        = grab(raw, /CFG scale:\s*([^,\n]+)/i);
        const seed       = grab(raw, /Seed:\s*([^,\n]+)/i);
        const sampler    = grab(raw, /Sampler:\s*([^,\n]+)/i);
        const scheduler  = (grab(raw, /Schedule type:\s*([^,\n]+)/i).trim() ||
                            grab(raw, /Scheduler:\s*([^,\n]+)/i).trim()     ||
                            grab(raw, /"scheduler"\s*:\s*"([^"]+)"/i));

        // --- Models ---
        const ckpt = detectCheckpoint(raw);

        // --- Extras (hires, denoising, refiner) ---
        // These are collected for completeness but are not part of the
        // normalised shape required by interface.html — extend if needed.
        const hiresSteps     = grab(raw, /Hires steps:\s*([^,\n]+)/i);
        const hiresDenoising = grab(raw, /Denoising strength:\s*([^,\n]+)/i);
        const refiner        = grab(raw, /Refiner:\s*([^,\n]+)/i);
        const upscaler1      = grab(raw, /Postprocess upscaler:\s*([^,\n]+)/i);
        const upscaler2      = grab(raw, /Postprocess upscaler 2:\s*([^,\n]+)/i);
        const upscalerFall   = grab(raw, /Upscaler:\s*([^,\n]+)/i);
        
        // ADDED: Extract VAE and Clip Skip
        const vae            = grab(raw, /VAE:\s*([^,\n]+)/i);
        const clipSkip       = grab(raw, /Clip skip:\s*([^,\n]+)/i);

        // --- LoRAs ---
        const loras = extractLoras(raw);

        // --- Source label ---
        const source = classifySource(raw);

        // --- Normalised return object (shape required by interface.html Block 4) ---
        return {
            pos,
            neg,
            steps,
            cfg,
            seed,
            size:      finalSize,
            sampler,
            scheduler,
            ckpt,
            loras:     loras.join(', '),
            source,

            // Extra fields — not used by interface.html directly but useful
            // if you want to extend the UI later.
            _extras: {
                vae:            vae ? cleanName(vae) : null,          // ADDED VAE
                clip_skip:      clipSkip || null,                     // ADDED Clip Skip
                upscaleRes:     upscaleRes  || null,
                hiresSteps:     hiresSteps  || null,
                hiresDenoising: hiresDenoising || null,
                refiner:        refiner && !/^(none|null|false)$/i.test(refiner.trim()) ? cleanName(refiner) : null,
                upscalers:      [upscaler1, upscaler2, upscalerFall].filter(Boolean).map(cleanName).filter(Boolean),
            }
        };
    }

    /* ================================================================
       EXPORT
       ================================================================ */
    window.parseStableDiffusion = parseStableDiffusion;

})();