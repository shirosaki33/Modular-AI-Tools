/* =========================================================================
   CONVERT TO B&W / MANGA / STYLES (🖤) — standalone
   ---------------------------------------------------------------------
   Button next to the 🪣 (Bucket) button in the "Dataset" list toolbar.
   Select one or several images, click 🖤: a popout opens with the styles,
   all the options and a live preview of the first selected image.

   STYLES
     Basic      ⚫ Grayscale (+ film grain) · ▦ Dither (Floyd–Steinberg, Atkinson,
                Jarvis, Stucki, Bayer; pixel size) · 🎚️ Posterize
     Line art   ✒️ Lines (sketch/dodge, fine details, speck removal, smooth edges)
                🧽 XDoG (difference-of-Gaussians lineart, clean anime-style lines)
                📐 Edges (Sobel) · 🖋️ Ink (threshold or adaptive)
     Manga      🔘 Screentone (dot / diamond / square / line screen) · 🌑 Shadow dots
                (dots only in the shadows, optional solid black) · ▨ Hatching
                — all three can get line art on top
     Sketch     ✏️ Pencil · 🖊️ Pen sketch · ⁘ Stipple (pointillism) · 🪵 Charcoal

   QUICK RECIPES: one click sets style + options (Manga page, Clean lineart,
   Newspaper photo, Retro Mac, Blueprint, Film noir, Sketchbook).

   OPTIONS (apply to every style)
     Adjustments: B&W filter (luminance / red / orange / yellow / green / blue
                  filter, average, lightness), auto contrast, brightness,
                  contrast, midtones (gamma), pre-smoothing (denoise),
                  sharpen (unsharp mask), invert result.
     Colors:      presets (B&W, sepia, cyanotype, blueprint, terminal,
                  newspaper) or any ink + paper color.
     Background:  transparency handling (auto / white / black / keep) and
                  "make white transparent" (lineart layer on transparent PNG).

   For each image:
     1) the image is processed;
     2) the ORIGINAL (+ caption) goes to 📦 Archive first (fully recoverable),
        labeled by the style used (grayscale / tinted / manga / dither / posterize);
     3) the new file is saved with the SAME name, same format;
     4) the caption is rewritten from memory (unsaved edits are kept).

   - Grayscale with neutral options: images that are already gray are skipped.
   - PNG: text chunks (prompt / generation parameters) are copied to the new file.
   - JPEG / WebP: re-encoded at high quality; EXIF is not kept (the original,
     with its metadata, stays in 📦 Archive). PNG is recommended for 1-bit styles
     and transparent lineart.
   - If anything fails for an image, its original is put back and the batch
     continues with the next one.
   - Full-size images are processed in a Web Worker (the page does not freeze);
     falls back to the main thread if workers are unavailable. Clicking the
     button again during a batch stops it after the current image.
   - Preview: ◀ ▶ cycles through the selected images; Result / Original / Split
     compare view.

   Load order: after tagmanager_archive.js and tagmanager_bucket_check.js.
========================================================================= */

(function () {

    const PREVIEW_MAX = 640;       // longest side of the preview bitmap
    const SETTING_KEY = 'bw-convert-options-v2';

    /* ---------- STYLES / OPTIONS TABLES ---------- */
    const MODE_INFO = {
        gray:      { label: '⚫ Grayscale',   name: 'black & white',      archive: 'grayscale', hint: 'Plain black & white photo-style conversion (luminance). With default options, already-gray images are skipped.' },
        posterize: { label: '🎚️ Posterize',   name: 'posterized',         archive: 'posterize', hint: 'Flat, cel-like gray tones: the image is reduced to a few gray levels.' },
        dither:    { label: '▦ Dither',       name: 'dithered',           archive: 'dither',    hint: '1-bit dithering with a retro / print look. Floyd–Steinberg is organic, Bayer is a regular pattern.' },
        lines:     { label: '✒️ Lines',       name: 'manga lines',        archive: 'manga',     hint: 'Lineart only: lines on a clean page, no colors or shading. Raise the sensitivity for more lines; "Remove specks" and "Smooth edges" clean the result.' },
        xdog:      { label: '🧽 XDoG',        name: 'XDoG lineart',       archive: 'manga',     hint: 'Extended difference-of-Gaussians: the classic filter for clean, anime-style lineart. Line width = detail scale; raise "Fill threshold" to also fill dark areas with ink.' },
        edges:     { label: '📐 Edges',       name: 'edge lines',         archive: 'manga',     hint: 'Edge detection (Sobel): crisp technical outlines. Lower the cutoff for more edges.' },
        ink:       { label: '🖋️ Ink',         name: 'manga ink',          archive: 'manga',     hint: 'Solid ink: everything darker than the threshold becomes black, the rest white. Adaptive mode follows the local brightness.' },
        tone:      { label: '🔘 Screentone',  name: 'screentone',         archive: 'manga',     hint: 'Manga halftone: darker areas get bigger dots over the whole image. Optionally add line art on top.' },
        shadow:    { label: '🌑 Shadow dots', name: 'shadow screentone',  archive: 'manga',     hint: 'Manga-style shading: light areas stay clean, dots appear only in the shadows, and the darkest spots can turn solid black.' },
        hatch:     { label: '▨ Hatching',     name: 'hatched',            archive: 'manga',     hint: 'Parallel pen strokes that get denser and cross over in the shadows (cross-hatching). Add wobble for a hand-drawn feel.' },
        pencil:    { label: '✏️ Pencil',      name: 'pencil sketch',      archive: 'sketch',    hint: 'Soft graphite sketch: pressure-like lines, paper grain and light hatch shading in the shadows.' },
        pen:       { label: '🖊️ Pen sketch',  name: 'pen sketch',         archive: 'sketch',    hint: 'Rough pen drawing: hand-drawn wobble, optional double stroke and hatch shading.' },
        stipple:   { label: '⁘ Stipple',      name: 'stippled',           archive: 'sketch',    hint: 'Pointillism: the image is drawn only with scattered ink dots — denser where it is darker.' },
        charcoal:  { label: '🪵 Charcoal',    name: 'charcoal drawing',   archive: 'sketch',    hint: 'Heavy, smudged charcoal: thick soft contours, dark tonal fills and coarse paper texture.' }
    };

    const MODE_GROUPS = [
        { label: 'Basic',    modes: ['gray', 'posterize', 'dither'] },
        { label: 'Line art', modes: ['lines', 'xdog', 'edges', 'ink'] },
        { label: 'Manga',    modes: ['tone', 'shadow', 'hatch'] },
        { label: 'Sketch',   modes: ['pencil', 'pen', 'stipple', 'charcoal'] }
    ];
    const OVERLAY_MODES = ['tone', 'shadow', 'hatch'];   // styles that can get line art on top

    const PRESETS = {
        bw:        { label: 'Black & white',      ink: '#000000', paper: '#ffffff' },
        sepia:     { label: 'Sepia',              ink: '#3b2412', paper: '#f1e2c4' },
        cyanotype: { label: 'Cyanotype',          ink: '#0a2a5e', paper: '#d6ecff' },
        blueprint: { label: 'Blueprint',          ink: '#e8f3ff', paper: '#0b3a8a' },
        terminal:  { label: 'Green terminal',     ink: '#00ff66', paper: '#001a0a' },
        newspaper: { label: 'Newspaper',          ink: '#262626', paper: '#e6dfcf' },
        graphite:  { label: 'Graphite pencil',    ink: '#2b2b30', paper: '#f4f1ea' },
        manga:     { label: 'Manga paper (warm)', ink: '#141414', paper: '#f7f3ea' },
        night:     { label: 'Night (white on black)', ink: '#f2f2f2', paper: '#0c0c0c' },
        sepiaDark: { label: 'Dark sepia',         ink: '#1e120a', paper: '#c9a77c' },
        riso:      { label: 'Risograph pink',     ink: '#ff3d7f', paper: '#fff6ef' },
        redline:   { label: 'Red pencil',         ink: '#b3261e', paper: '#fbf7f0' }
    };

    /* B&W filter = how color becomes gray (like color filters on B&W film).
       Weights sum to 1, so an already-gray image stays exactly the same. */
    const GRAY_WEIGHTS = {
        bt709:  [0.2126, 0.7152, 0.0722],
        bt601:  [0.299, 0.587, 0.114],
        avg:    [1 / 3, 1 / 3, 1 / 3],
        red:    [0.80, 0.20, 0.00],
        orange: [0.60, 0.35, 0.05],
        yellow: [0.45, 0.50, 0.05],
        green:  [0.15, 0.75, 0.10],
        blue:   [0.10, 0.20, 0.70]
    };

    /* Error-diffusion kernels: [dx, dy, weight] + divisor. */
    const DIFFUSION_KERNELS = {
        fs:       { div: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
        atkinson: { div: 8,  k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
        jjn:      { div: 48, k: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
        stucki:   { div: 42, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] }
    };

    /* One-click recipes: reset to defaults, then apply these values. */
    const RECIPES = [
        { label: '📖 Manga page',      title: 'Shadow screentone + line art on warm manga paper',
          set: { mode: 'shadow', toneLines: true, sens: 225, thick: 3, dot: 5, angle: 45, shadowStart: 35, shadowSolid: 90, cleanup: 8, smooth: true, preset: 'manga' } },
        { label: '🧼 Clean lineart',   title: 'XDoG lines, hard black & white, specks removed — good for lineart datasets',
          set: { mode: 'xdog', xdogSigma: 8, xdogP: 20, xdogEps: 25, xdogPhi: 30, xdogHard: true, cleanup: 10, smooth: true, preset: 'bw' } },
        { label: '📰 Newspaper photo', title: 'Classic halftone dots on newsprint',
          set: { mode: 'tone', dot: 5, angle: 45, dotShape: 'circle', auto: true, preset: 'newspaper' } },
        { label: '🖥️ Retro Mac',       title: 'Atkinson dithering with chunky 2× pixels',
          set: { mode: 'dither', ditherMethod: 'atkinson', ditherScale: 2, auto: true, preset: 'bw' } },
        { label: '📐 Blueprint',       title: 'Edge lines in white on blueprint blue',
          set: { mode: 'edges', edge: 35, thick: 2, preset: 'blueprint' } },
        { label: '🎞️ Film noir',       title: 'Red-filter B&W, punchy contrast, film grain',
          set: { mode: 'gray', grayMethod: 'red', auto: true, contrast: 35, gamma: 85, filmGrain: 18, sharpen: 20, preset: 'bw' } },
        { label: '✏️ Sketchbook',      title: 'Graphite pencil with hatching on warm paper',
          set: { mode: 'pencil', grain: 55, shadeHatch: true, wobble: 3, preset: 'graphite' } }
    ];

    const DEFAULTS = {
        mode: 'gray',
        sens: 220, thick: 3, soft: false, fine: false,          // lines
        cleanup: 6, smooth: true,                               // line cleanup (lines / edges / ink / pen / overlays)
        edge: 40,                                               // edges
        thr: 128, adaptive: false, adaptC: 12,                  // ink
        dot: 6, angle: 45, toneLines: false,                    // screentone / shadow dots
        shadowStart: 40, shadowSolid: 95,                       // shadow dots
        hatchSpacing: 7, hatchAngle: 45, hatchLayers: 3, hatchWeight: 5,   // hatching
        wobble: 2, grain: 40, shadeHatch: true, doubleStroke: true,        // sketch styles
        ditherMethod: 'fs', ditherScale: 1,                     // dither
        levels: 4,                                              // posterize
        filmGrain: 0,                                           // grayscale / posterize
        dotShape: 'circle',                                     // screentone / shadow dots
        xdogSigma: 8, xdogP: 20, xdogEps: 25, xdogPhi: 30, xdogHard: false,   // XDoG
        stippleSize: 4,                                         // stipple
        grayMethod: 'bt709', sharpen: 0,
        auto: false, bright: 0, contrast: 0, gamma: 100, blur: 0, invert: false,
        preset: 'bw', ink: '#000000', paper: '#ffffff',
        transp: 'auto', lineAlpha: false
    };

    /* Each control: key, type (range|check|select|color), label, title, group (mode|adjust|color),
       modes (styles it applies to; omitted = all) and when(state) for extra conditions. */
    const CONTROLS = [
        { key: 'sens', type: 'range', group: 'mode', min: 150, max: 250, label: 'Line sensitivity', title: 'Higher = more lines (picks up fainter edges)',
          modes: ['lines', 'tone', 'shadow', 'hatch', 'pencil', 'pen', 'charcoal'], when: s => !OVERLAY_MODES.includes(s.mode) || s.toneLines },
        { key: 'thick', type: 'range', group: 'mode', min: 1, max: 12, label: 'Line thickness', title: 'Higher = thicker, bolder lines',
          modes: ['lines', 'edges', 'tone', 'shadow', 'hatch', 'pencil', 'pen', 'charcoal'], when: s => !OVERLAY_MODES.includes(s.mode) || s.toneLines },
        { key: 'soft', type: 'check', group: 'mode', label: "Keep soft shading (don't force pure lines)", title: 'Keeps gray shading in the lines instead of forcing solid black/white',
          modes: ['lines'] },
        { key: 'fine', type: 'check', group: 'mode', label: 'Add fine details', title: 'Adds a second, thinner line pass so small details are not lost',
          modes: ['lines'], when: s => !s.soft },
        { key: 'edge', type: 'range', group: 'mode', min: 5, max: 120, label: 'Edge cutoff', title: 'Lower = more edges detected',
          modes: ['edges'] },
        { key: 'xdogSigma', type: 'range', group: 'mode', min: 3, max: 40, label: 'Line width', title: 'Detail scale of the Gaussian (higher = thicker, simpler lines)',
          modes: ['xdog'], fmt: v => (v / 10).toFixed(1) },
        { key: 'xdogP', type: 'range', group: 'mode', min: 1, max: 60, label: 'Edge strength', title: 'How strongly edges are emphasized (higher = darker, more lines)',
          modes: ['xdog'] },
        { key: 'xdogEps', type: 'range', group: 'mode', min: 0, max: 95, label: 'Fill threshold', title: 'Lower = lines only. Higher = dark areas are filled with ink too',
          modes: ['xdog'], fmt: v => v + '%' },
        { key: 'xdogPhi', type: 'range', group: 'mode', min: 1, max: 100, label: 'Line hardness', title: 'Higher = crisp black lines, lower = soft gray lines',
          modes: ['xdog'] },
        { key: 'xdogHard', type: 'check', group: 'mode', label: 'Pure black & white (enables cleanup)', title: 'Forces every pixel to ink or paper, then "Remove specks" / "Smooth edges" can clean it',
          modes: ['xdog'] },
        { key: 'thr', type: 'range', group: 'mode', min: 1, max: 254, label: 'Threshold', title: 'Pixels darker than this become black',
          modes: ['ink'], when: s => !s.adaptive },
        { key: 'adaptive', type: 'check', group: 'mode', label: 'Adaptive threshold (follows local brightness)', title: 'Good for uneven lighting: compares each pixel with its surroundings',
          modes: ['ink'] },
        { key: 'adaptC', type: 'range', group: 'mode', min: 0, max: 60, label: 'Local offset', title: 'Higher = fewer black pixels (only clearly darker spots turn black)',
          modes: ['ink'], when: s => s.adaptive },
        { key: 'cleanup', type: 'range', group: 'mode', min: 0, max: 50, label: 'Remove specks', title: 'Deletes isolated black dots/fragments smaller than this (0 = off)',
          modes: ['lines', 'xdog', 'edges', 'ink', 'pen', 'tone', 'shadow', 'hatch'], when: cleanupVisible },
        { key: 'smooth', type: 'check', group: 'mode', label: 'Smooth edges (anti-alias)', title: 'Removes the jagged, pixelated look of hard black/white lines',
          modes: ['lines', 'xdog', 'edges', 'ink', 'pen', 'tone', 'shadow', 'hatch'], when: cleanupVisible },

        { key: 'dot', type: 'range', group: 'mode', min: 2, max: 16, label: 'Dot size', title: 'Cell size of the halftone dots',
          modes: ['tone', 'shadow'] },
        { key: 'dotShape', type: 'select', group: 'mode', label: 'Dot shape', title: 'Shape of the halftone screen',
          options: [['circle', '● Round dots'], ['diamond', '◆ Diamond dots'], ['square', '■ Square dots'], ['line', '☰ Line screen (engraving)']],
          modes: ['tone', 'shadow'] },
        { key: 'angle', type: 'range', group: 'mode', min: 0, max: 90, label: 'Screen angle', title: 'Rotation of the dot grid (45° is the classic manga angle)',
          modes: ['tone', 'shadow'] },
        { key: 'shadowStart', type: 'range', group: 'mode', min: 10, max: 90, label: 'Shadows start at', title: 'Darkness (%) where the dots begin. Higher = dots only in the deepest shadows',
          modes: ['shadow'], fmt: v => v + '%' },
        { key: 'shadowSolid', type: 'range', group: 'mode', min: 50, max: 100, label: 'Solid black from', title: 'Darkness (%) above which areas turn solid black. 100% = never',
          modes: ['shadow'], fmt: v => v >= 100 ? 'off' : v + '%' },
        { key: 'toneLines', type: 'check', group: 'mode', label: 'Add line art on top', title: 'Draws the lines over the shading (full manga page look)',
          modes: OVERLAY_MODES },

        { key: 'hatchSpacing', type: 'range', group: 'mode', min: 3, max: 16, label: 'Stroke spacing', title: 'Distance between hatch strokes',
          modes: ['hatch'] },
        { key: 'hatchAngle', type: 'range', group: 'mode', min: 0, max: 179, label: 'Stroke angle', title: 'Direction of the first hatch layer',
          modes: ['hatch'] },
        { key: 'hatchLayers', type: 'range', group: 'mode', min: 1, max: 4, label: 'Hatch layers', title: 'More layers = more cross-hatching in the darkest areas',
          modes: ['hatch'] },
        { key: 'hatchWeight', type: 'range', group: 'mode', min: 1, max: 10, label: 'Stroke weight', title: 'Thickness of the strokes in the darkest areas',
          modes: ['hatch'] },

        { key: 'wobble', type: 'range', group: 'mode', min: 0, max: 10, label: 'Hand-drawn wobble', title: 'Makes strokes meander like a human hand (0 = perfectly straight)',
          modes: ['hatch', 'pencil', 'pen'] },
        { key: 'grain', type: 'range', group: 'mode', min: 0, max: 100, label: 'Paper grain', title: 'Graphite / charcoal breaks up on the paper texture',
          modes: ['pencil', 'charcoal'] },
        { key: 'stippleSize', type: 'range', group: 'mode', min: 2, max: 12, label: 'Dot spacing', title: 'Distance between stipple dots (smaller = finer, more dots)',
          modes: ['stipple'] },
        { key: 'doubleStroke', type: 'check', group: 'mode', label: 'Double stroke (sketchy outlines)', title: 'Draws each outline twice with a slight offset, like a rough pen sketch',
          modes: ['pen'] },
        { key: 'shadeHatch', type: 'check', group: 'mode', label: 'Shade with hatching', title: 'Adds light hatch strokes in the shadows',
          modes: ['pencil', 'pen'] },

        { key: 'ditherMethod', type: 'select', group: 'mode', label: 'Method',
          options: [['fs', 'Floyd–Steinberg (organic)'], ['atkinson', 'Atkinson (classic Mac, lighter)'], ['jjn', 'Jarvis–Judice–Ninke (smooth)'], ['stucki', 'Stucki (sharp, smooth)'], ['bayer', 'Ordered Bayer 8×8 (pattern)']],
          modes: ['dither'] },
        { key: 'ditherScale', type: 'range', group: 'mode', min: 1, max: 6, label: 'Pixel size', title: 'Bigger, chunkier dither pixels (retro look)',
          modes: ['dither'], fmt: v => v + '×' },
        { key: 'levels', type: 'range', group: 'mode', min: 2, max: 8, label: 'Gray levels', title: 'Number of gray tones kept',
          modes: ['posterize'] },
        { key: 'filmGrain', type: 'range', group: 'mode', min: 0, max: 60, label: 'Film grain', title: 'Adds analog film grain (0 = off)',
          modes: ['gray', 'posterize'] },

        { key: 'grayMethod', type: 'select', group: 'adjust', label: 'B&W filter', title: 'How colors turn into gray — like colored filters on black & white film',
          options: [['bt709', 'Luminance (natural)'], ['bt601', 'Luminance (classic TV)'], ['red', 'Red filter (dark skies, smooth skin)'], ['orange', 'Orange filter (portraits)'], ['yellow', 'Yellow filter (mild contrast)'], ['green', 'Green filter (foliage, lips)'], ['blue', 'Blue filter (moody, freckles)'], ['avg', 'Average (flat)'], ['lightness', 'Lightness (max+min)/2']] },
        { key: 'auto', type: 'check', group: 'adjust', label: 'Auto contrast (stretch levels)', title: 'Stretches the darkest/lightest tones to the full range before converting' },
        { key: 'bright', type: 'range', group: 'adjust', min: -100, max: 100, label: 'Brightness', title: 'Applied before converting' },
        { key: 'contrast', type: 'range', group: 'adjust', min: -100, max: 100, label: 'Contrast', title: 'Applied before converting' },
        { key: 'gamma', type: 'range', group: 'adjust', min: 40, max: 250, label: 'Midtones (gamma)', title: 'Higher = brighter midtones, lower = darker midtones', fmt: v => (v / 100).toFixed(2) },
        { key: 'blur', type: 'range', group: 'adjust', min: 0, max: 6, label: 'Pre-smoothing', title: 'Softens noise/texture before converting (helps lines, ink and screentone)' },
        { key: 'sharpen', type: 'range', group: 'adjust', min: 0, max: 100, label: 'Sharpen', title: 'Unsharp mask before converting — crisper details and lines (0 = off)' },
        { key: 'invert', type: 'check', group: 'adjust', label: 'Invert result', title: 'Swaps ink and paper (negative)' },

        { key: 'preset', type: 'select', group: 'color', label: 'Color preset', options: Object.entries(PRESETS).map(([k, p]) => [k, p.label]).concat([['custom', 'Custom']]) },
        { key: 'ink', type: 'color', group: 'color', label: 'Ink color', title: 'Color of the darkest tone' },
        { key: 'paper', type: 'color', group: 'color', label: 'Paper color', title: 'Color of the lightest tone' },
        { key: 'transp', type: 'select', group: 'color', label: 'Transparency', title: 'What to do with transparent areas',
          options: [['auto', 'Auto (keep for Grayscale, white otherwise)'], ['white', 'Flatten to white'], ['black', 'Flatten to black'], ['keep', 'Keep original transparency']] },
        { key: 'lineAlpha', type: 'check', group: 'color', label: 'Make paper transparent (lineart layer)', title: 'Ink color on a transparent background — save as PNG' }
    ];
    function cleanupVisible(s) {
        if (s.mode === 'lines') return !s.soft;
        if (s.mode === 'xdog') return s.xdogHard;
        if (OVERLAY_MODES.includes(s.mode)) return s.toneLines;
        return true;
    }
    const CONTROL_BY_KEY = {};
    CONTROLS.forEach(c => { CONTROL_BY_KEY[c.key] = c; });

    const style = document.createElement('style');
    style.innerHTML = `
        #btn-grayscale { flex-shrink:0; padding:6px 10px; font-size:14px; background:transparent; border:1px solid #444; color:#aaa; }
        #btn-grayscale:hover:not(:disabled) { color:#fff; border-color:#fff; }
        #btn-grayscale:disabled { opacity:0.6; cursor:wait; }
        .bw-recipes { display:flex; flex-wrap:wrap; gap:5px; }
        .bw-recipe-btn { background:#111; color:#bbb; border:1px solid #3a3a3a; border-radius:12px; padding:3px 9px; font-size:11px; cursor:pointer; white-space:nowrap; }
        .bw-recipe-btn:hover { background:#1e1630; color:#d6c2ff; border-color:#4a2a8c; }
        .bw-preview-bar { display:flex; align-items:center; gap:8px; font-size:12px; color:#ccc; flex-wrap:wrap; }
        .bw-preview-bar select { font-size:12px; width:auto; }
        .bw-preview-bar input[type=range] { flex:1; min-width:80px; accent-color:#b890ff; padding:0; }
        .bw-nav-btn { background:#151515; border:1px solid #444; color:#aaa; border-radius:4px; padding:2px 8px; cursor:pointer; font-size:12px; }
        .bw-nav-btn:hover:not(:disabled) { color:#fff; border-color:#888; }
        .bw-nav-btn:disabled { opacity:0.35; cursor:default; }
        #bw-preview-name { font-size:11px; color:#777; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; text-align:center; }

        #modal-bw-convert .tool-modal { width: 940px; max-width: 96vw; max-height: 92vh; overflow-y: auto; }
        .bw-layout { display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; }
        .bw-left { flex:1 1 380px; min-width:300px; display:flex; flex-direction:column; gap:10px; }
        .bw-right { flex:1 1 380px; min-width:300px; position:sticky; top:0; display:flex; flex-direction:column; gap:8px; }
        .bw-modes { display:flex; flex-direction:column; gap:4px; }
        .bw-group-label { font-size:10px; color:#666; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px; margin-top:2px; }
        .bw-mode-row { display:flex; flex-wrap:wrap; gap:6px; }
        .bw-mode-btn { flex:1 1 22%; background:#151515; color:#aaa; border:1px solid #444; border-radius:6px; padding:7px 4px; font-size:12px; font-weight:bold; cursor:pointer; white-space:nowrap; }
        .bw-mode-btn:hover { background:#222; color:#fff; }
        .bw-mode-btn.active { background:#2f1a5c; color:#b890ff; border-color:#4a2a8c; }
        .bw-mode-hint { font-size:11px; color:#888; line-height:1.4; min-height:2.8em; }
        .bw-group { display:flex; flex-direction:column; gap:8px; }
        .bw-row { display:flex; align-items:center; gap:10px; font-size:12px; color:#ccc; }
        .bw-row > span.bw-lbl { flex:0 0 125px; color:#9ecfff; font-weight:bold; }
        .bw-row input[type=range] { flex:1; accent-color:#b890ff; padding:0; min-width:0; }
        .bw-row select { flex:1; min-width:0; font-size:12px; }
        .bw-row input[type=color] { width:44px; height:26px; padding:0; border:1px solid #444; border-radius:4px; background:transparent; cursor:pointer; }
        .bw-row .bw-val { flex:0 0 38px; text-align:right; color:#888; font-size:11px; }
        .bw-row label { display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }
        .bw-row input[type=checkbox] { width:auto; margin:0; accent-color:#b890ff; }
        .bw-details { background:#0d0d0d; border:1px solid #222; border-radius:6px; }
        .bw-details > summary { cursor:pointer; padding:8px 10px; font-size:12px; font-weight:bold; color:#ccc; user-select:none; }
        .bw-details[open] > summary { border-bottom:1px solid #222; }
        .bw-details-body { padding:10px; display:flex; flex-direction:column; gap:8px; }
        #bw-preview-wrap { background:#000 repeating-conic-gradient(#1a1a1a 0% 25%, #111 0% 50%) 50% / 16px 16px; border:1px solid #333; border-radius:6px; display:flex; justify-content:center; align-items:center; min-height:160px; padding:6px; }
        #bw-preview-canvas { max-width:100%; max-height:min(60vh, 520px); display:block; }
        #bw-preview-status { font-size:11px; color:#888; text-align:center; min-height:1.4em; }
        #btn-bw-confirm { background:#00aa66; color:#000; border:none; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer; }
        #btn-bw-reset { background:transparent; border:1px solid #555; color:#aaa; padding:8px 12px; border-radius:6px; font-weight:bold; cursor:pointer; margin-right:auto; }
        #btn-bw-reset:hover { background:#333; color:#fff; }
    `;
    document.head.appendChild(style);

    let _busy = false;
    let _cancel = false;

    /* ---------- OPTIONS (remembered between sessions) ---------- */
    const state = { ...DEFAULTS };

    async function loadState() {
        if (typeof window.getSetting !== 'function') return;
        try {
            const saved = await window.getSetting(SETTING_KEY, null);
            if (!saved || typeof saved !== 'object') return;
            if (MODE_INFO[saved.mode]) state.mode = saved.mode;
            CONTROLS.forEach(c => {
                const v = saved[c.key];
                if (v === undefined || typeof v !== typeof DEFAULTS[c.key]) return;
                if (c.type === 'range') state[c.key] = Math.min(c.max, Math.max(c.min, v));
                else if (c.type === 'select') { if (c.options.some(o => o[0] === v)) state[c.key] = v; }
                else if (c.type === 'color') { if (/^#[0-9a-f]{6}$/i.test(v)) state[c.key] = v.toLowerCase(); }
                else state[c.key] = v;
            });
        } catch (e) { /* defaults */ }
    }
    function saveState() {
        if (typeof window.saveSetting === 'function') window.saveSetting(SETTING_KEY, { ...state });
    }

    function imageExt(img) {
        return (String(img && img.name || '').split('.').pop() || 'png').toLowerCase();
    }

    /* ---------- PNG: copy text chunks (tEXt / iTXt / zTXt) ---------- */
    const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    const PNG_TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt']);

    function isPng(bytes) {
        if (!bytes || bytes.length < 8) return false;
        for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
        return true;
    }

    function listPngChunks(bytes) {
        const out = [];
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let p = 8;
        while (p + 12 <= bytes.length) {
            const len = view.getUint32(p);
            const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
            const end = p + 12 + len;
            if (end > bytes.length) break;
            out.push({ type, start: p, end });
            p = end;
            if (type === 'IEND') break;
        }
        return out;
    }

    async function copyPngTextChunks(originalBlob, newBlob) {
        try {
            const orig = new Uint8Array(await originalBlob.arrayBuffer());
            const fresh = new Uint8Array(await newBlob.arrayBuffer());
            if (!isPng(orig) || !isPng(fresh)) return newBlob;
            const textChunks = listPngChunks(orig).filter(c => PNG_TEXT_CHUNKS.has(c.type));
            if (textChunks.length === 0) return newBlob;
            const firstIdat = listPngChunks(fresh).find(c => c.type === 'IDAT');
            if (!firstIdat) return newBlob;
            const parts = [fresh.subarray(0, firstIdat.start)];
            textChunks.forEach(c => parts.push(orig.subarray(c.start, c.end)));
            parts.push(fresh.subarray(firstIdat.start));
            return new Blob(parts, { type: 'image/png' });
        } catch (e) {
            console.warn('[B&W] Could not copy PNG metadata:', e);
            return newBlob;
        }
    }

    /* =====================================================================
       PIXEL PROCESSING
       Every style produces a gray "tone map" (0 = ink, 255 = paper); the
       tone map is then mapped to the ink→paper colors.
    ===================================================================== */

    // Separable box blur with clamped edges; runs 3 passes (≈ gaussian). Blurs `a` in place.
    function box1D(src, dst, len, count, stride, lineStep, r) {
        const win = 2 * r + 1;
        for (let l = 0; l < count; l++) {
            const base = l * lineStep;
            let sum = 0;
            for (let i = -r; i <= r; i++) sum += src[base + Math.min(len - 1, Math.max(0, i)) * stride];
            for (let i = 0; i < len; i++) {
                dst[base + i * stride] = sum / win;
                sum += src[base + Math.min(len - 1, i + r + 1) * stride] - src[base + Math.max(0, i - r) * stride];
            }
        }
    }
    function boxBlur(a, w, h, r) {
        const tmp = new Float32Array(a.length);
        for (let pass = 0; pass < 3; pass++) {
            box1D(a, tmp, w, h, 1, w, r);   // horizontal
            box1D(tmp, a, h, w, w, 1, r);   // vertical
        }
    }

    function hexToRgb(hex) {
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
        return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
    }
    function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

    // True separable Gaussian (fractional sigma — box blur can't do sigma < 1). Blurs `a` in place.
    function gaussBlur(a, w, h, sigma) {
        if (sigma < 0.25) return;
        const r = Math.max(1, Math.ceil(sigma * 3));
        const ker = new Float32Array(2 * r + 1);
        let sum = 0;
        for (let i = -r; i <= r; i++) { ker[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += ker[i + r]; }
        for (let i = 0; i < ker.length; i++) ker[i] /= sum;
        const tmp = new Float32Array(a.length);
        for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let x = 0; x < w; x++) {
                let acc = 0;
                for (let i = -r; i <= r; i++) {
                    const xx = x + i < 0 ? 0 : (x + i >= w ? w - 1 : x + i);
                    acc += a[row + xx] * ker[i + r];
                }
                tmp[row + x] = acc;
            }
        }
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                let acc = 0;
                for (let i = -r; i <= r; i++) {
                    const yy = y + i < 0 ? 0 : (y + i >= h ? h - 1 : y + i);
                    acc += tmp[yy * w + x] * ker[i + r];
                }
                a[y * w + x] = acc;
            }
        }
    }

    // Gray value of one pixel for the chosen B&W filter.
    function grayOf(r, g, b, method, wts) {
        if (method === 'lightness') return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
        return wts[0] * r + wts[1] * g + wts[2] * b;
    }

    // Same as the original B&W button: nothing but a plain grayscale conversion.
    function isNeutral(o) {
        return o.mode === 'gray' && (o.grayMethod || 'bt709') === 'bt709' && !o.sharpen && !o.filmGrain && !o.auto && o.bright === 0 && o.contrast === 0 && o.gamma === 100 && o.blur === 0 &&
            !o.invert && o.ink.toLowerCase() === '#000000' && o.paper.toLowerCase() === '#ffffff' && !o.lineAlpha &&
            (o.transp === 'auto' || o.transp === 'keep');
    }

    // Lookup table for auto-contrast + gamma + contrast + brightness (operates on 0–255).
    function buildAdjustLut(gray, o) {
        let lo = 0, hi = 255;
        if (o.auto) {
            const hist = new Uint32Array(256);
            for (let k = 0; k < gray.length; k++) hist[Math.min(255, Math.max(0, Math.round(gray[k])))]++;
            const cut = gray.length * 0.005;
            let acc = 0;
            for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > cut) { lo = i; break; } }
            acc = 0;
            for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > cut) { hi = i; break; } }
            if (hi - lo < 10) { lo = 0; hi = 255; }
        }
        const g = o.gamma / 100;
        const c = o.contrast * 2.55;
        const f = (259 * (c + 255)) / (255 * (259 - c));
        const lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            let v = clamp255((i - lo) / (hi - lo) * 255);
            if (g !== 1) v = 255 * Math.pow(v / 255, 1 / g);
            if (c !== 0) v = f * (v - 128) + 128;
            lut[i] = clamp255(v + o.bright * 2.55);
        }
        return lut;
    }

    // Sketch (color dodge): gray / (1 - blur(inverted gray)). Flat areas → white, edges → dark.
    // radiusScale / sensOffset let a second, finer pass reuse the same code.
    function sketchLines(gray, w, h, o, soft, radiusScale = 1, sensOffset = 0) {
        const n = w * h;
        const radius = Math.max(1, Math.round(o.thick * radiusScale * Math.max(w, h) / 1024));
        const blurred = new Float32Array(n);
        for (let k = 0; k < n; k++) blurred[k] = 255 - gray[k];
        boxBlur(blurred, w, h, radius);
        const sens = o.sens + sensOffset;
        const low = sens - 120;
        const out = new Uint8ClampedArray(n);
        for (let k = 0; k < n; k++) {
            const d = 255 - blurred[k];
            let v = d < 1 ? 255 : Math.min(255, gray[k] * 255 / d);
            if (soft) v = clamp255((v - low) * 255 / 120);
            else v = v < sens ? 0 : 255;
            out[k] = v;
        }
        return out;
    }

    /* ----- line cleanup (hard black/white masks only) ----- */
    // Deletes connected black fragments smaller than minSize pixels (8-connectivity).
    function despeckle(tone, w, h, minSize) {
        const n = w * h;
        if (minSize < 2 || n > 40e6) return tone;
        const visited = new Uint8Array(n), stack = new Int32Array(n), list = new Int32Array(n);
        for (let s = 0; s < n; s++) {
            if (tone[s] !== 0 || visited[s]) continue;
            let sp = 0, cnt = 0;
            stack[sp++] = s; visited[s] = 1;
            while (sp > 0) {
                const k = stack[--sp];
                list[cnt++] = k;
                const x = k % w, y = (k / w) | 0;
                for (let dy = -1; dy <= 1; dy++) {
                    const yy = y + dy;
                    if (yy < 0 || yy >= h) continue;
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const xx = x + dx;
                        if (xx < 0 || xx >= w) continue;
                        const q = yy * w + xx;
                        if (tone[q] === 0 && !visited[q]) { visited[q] = 1; stack[sp++] = q; }
                    }
                }
            }
            if (cnt < minSize) for (let i = 0; i < cnt; i++) tone[list[i]] = 255;
        }
        return tone;
    }

    // 3×3 binomial blur + steep curve: anti-aliased edges that keep thin lines dark.
    function smoothTone(tone, w, h) {
        const n = w * h;
        const a = new Float32Array(n), out = new Uint8ClampedArray(n);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const k = y * w + x;
                a[k] = (tone[x > 0 ? k - 1 : k] + 2 * tone[k] + tone[x < w - 1 ? k + 1 : k]) / 4;
            }
        }
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const k = y * w + x;
                const v = (a[y > 0 ? k - w : k] + 2 * a[k] + a[y < h - 1 ? k + w : k]) / 4;
                out[k] = clamp255((v - 190) * 2.5 + 127.5);
            }
        }
        return out;
    }

    function refine(tone, w, h, o) {
        const s = Math.max(w, h) / 1024;
        if (o.cleanup > 0) tone = despeckle(tone, w, h, Math.round(o.cleanup * s * s));
        if (o.smooth) tone = smoothTone(tone, w, h);
        return tone;
    }

    function sobelEdges(gray, w, h, o) {
        const n = w * h;
        const out = new Uint8ClampedArray(n).fill(255);
        const thr = o.edge;
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const k = y * w + x;
                const a = gray[k - w - 1], b = gray[k - w], c = gray[k - w + 1];
                const d = gray[k - 1], f = gray[k + 1];
                const g = gray[k + w - 1], hh = gray[k + w], i = gray[k + w + 1];
                const gx = (c + 2 * f + i) - (a + 2 * d + g);
                const gy = (g + 2 * hh + i) - (a + 2 * b + c);
                if (Math.sqrt(gx * gx + gy * gy) / 4 > thr) out[k] = 0;
            }
        }
        const r = Math.round((o.thick - 1) * Math.max(w, h) / 1024 / 3);
        if (o.thick > 1 && r >= 1) {            // thicken: dilate the black mask
            const mask = new Float32Array(n);
            for (let k = 0; k < n; k++) mask[k] = out[k] === 0 ? 1 : 0;
            boxBlur(mask, w, h, r);
            for (let k = 0; k < n; k++) out[k] = mask[k] > 0.002 ? 0 : 255;
        }
        return out;
    }

    // start: darkness (0–1) below which there are no dots (shadow dots). solid: darkness at/above which the pixel is solid black.
    function screentone(gray, w, h, o, start = 0, solid = 2) {
        const n = w * h;
        const out = new Uint8ClampedArray(n);
        const cell = Math.max(2, o.dot * Math.max(1, Math.max(w, h) / 1024));
        const ang = o.angle * Math.PI / 180, cs = Math.cos(ang), sn = Math.sin(ang);
        const shape = o.dotShape || 'circle';
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const k = y * w + x;
                let d = 1 - gray[k] / 255;
                if (d >= solid) { out[k] = 0; continue; }
                if (start > 0) d = d <= start ? 0 : (d - start) / (1 - start);
                if (d <= 0.02) { out[k] = 255; continue; }
                const u = (x * cs + y * sn) / cell, v = (-x * sn + y * cs) / cell;
                const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
                let dist, r;
                switch (shape) {
                    case 'diamond': dist = Math.abs(fu) + Math.abs(fv); r = d <= 0.5 ? Math.sqrt(d / 2) : 1 - Math.sqrt((1 - d) / 2); break;
                    case 'square':  dist = Math.max(Math.abs(fu), Math.abs(fv)); r = Math.sqrt(d) / 2; break;
                    case 'line':    dist = Math.abs(fv); r = d / 2; break;
                    default:        dist = Math.sqrt(fu * fu + fv * fv); r = Math.sqrt(d) * 0.7071;
                }
                const cov = Math.min(1, Math.max(0, 0.5 - (dist - r) * cell));
                out[k] = 255 * (1 - cov);
            }
        }
        return out;
    }

    /* Hatching / cross-hatching: layer i appears once the darkness passes its threshold and its
       strokes get thicker the darker the pixel is. h = { spacing, angle, layers, weight, wobble }. */
    function hatching(gray, w, h, hp) {
        const n = w * h;
        const s = Math.max(1, Math.max(w, h) / 1024);
        const spacing = Math.max(2, hp.spacing * s);
        const maxW = 0.2 + 0.07 * hp.weight;
        const amp = hp.wobble * 0.25 * s;
        const fs = 1 / s;
        const layers = Math.max(1, Math.min(4, hp.layers));
        const OFFS = [0, 90, 45, 135];
        const L = [];
        for (let i = 0; i < layers; i++) {
            const a = (hp.angle + OFFS[i]) * Math.PI / 180;
            L.push({ cs: Math.cos(a), sn: Math.sin(a), t: 0.15 + i * 0.6 / layers, ph: i * 1.9 + 0.7 });
        }
        const out = new Uint8ClampedArray(n).fill(255);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const k = y * w + x;
                const d = 1 - gray[k] / 255;
                if (d <= 0.15) continue;
                let val = 1;
                for (let i = 0; i < layers; i++) {
                    const ly = L[i];
                    if (d <= ly.t) break;
                    const wf = Math.min(1, (d - ly.t) / 0.3) * maxW;
                    let u = x * ly.cs + y * ly.sn;
                    if (amp > 0) {
                        const v = (-x * ly.sn + y * ly.cs) * fs;
                        u += amp * (Math.sin(v * 0.03 + ly.ph) + 0.5 * Math.sin(v * 0.083 + ly.ph * 2));
                    }
                    const q = u / spacing;
                    const dist = Math.abs(q - Math.floor(q) - 0.5) * spacing;
                    const half = wf * spacing / 2;
                    const cov = Math.min(1, Math.max(0, half - dist + 0.5)) * Math.min(1, half / 0.5);
                    val *= 1 - cov;
                }
                out[k] = 255 * val;
            }
        }
        return out;
    }

    // Hand tremor: shifts the sampling position with smooth low-frequency waves (nearest neighbour).
    function warpTone(tone, w, h, amp, seed) {
        if (amp < 0.3) return tone;
        const n = w * h;
        const fs = 1024 / Math.max(w, h);
        const out = new Uint8ClampedArray(n);
        for (let y = 0; y < h; y++) {
            const dx = amp * (Math.sin(y * 0.021 * fs + seed * 1.7) + 0.5 * Math.sin(y * 0.057 * fs + seed * 3.1));
            for (let x = 0; x < w; x++) {
                const dy = amp * (Math.sin(x * 0.019 * fs + seed * 2.3) + 0.5 * Math.sin(x * 0.061 * fs + seed * 0.7));
                const sx = Math.min(w - 1, Math.max(0, Math.round(x + dx)));
                const sy = Math.min(h - 1, Math.max(0, Math.round(y + dy)));
                out[y * w + x] = tone[sy * w + sx];
            }
        }
        return out;
    }

    // Deterministic 0–1 hash noise (paper grain).
    function hash01(x, y) {
        let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }

    function overlayLines(tone, gray, w, h, o) {
        const lines = refine(sketchLines(gray, w, h, o, false), w, h, o);
        for (let k = 0; k < tone.length; k++) if (lines[k] < tone[k]) tone[k] = lines[k];
        return tone;
    }

    // Error diffusion with any kernel; serpentine scan (alternating direction) avoids "worm" artifacts.
    function ditherDiffuse(gray, w, h, kernel) {
        const n = w * h;
        const g = Float32Array.from(gray);
        const out = new Uint8ClampedArray(n);
        const ks = kernel.k, div = kernel.div;
        for (let y = 0; y < h; y++) {
            const rtl = (y & 1) === 1;
            for (let i = 0; i < w; i++) {
                const x = rtl ? w - 1 - i : i;
                const k = y * w + x;
                const old = g[k], nw = old < 128 ? 0 : 255;
                out[k] = nw;
                const err = (old - nw) / div;
                for (let j = 0; j < ks.length; j++) {
                    const xx = x + (rtl ? -ks[j][0] : ks[j][0]), yy = y + ks[j][1];
                    if (xx < 0 || xx >= w || yy >= h) continue;
                    g[yy * w + xx] += err * ks[j][2];
                }
            }
        }
        return out;
    }

    // Dither at a coarser grid (pixel size > 1), then blow it back up with hard edges.
    function ditherScaled(gray, w, h, method, scale) {
        const run = (gg, ww, hh) => method === 'bayer' ? ditherBayer(gg, ww, hh) : ditherDiffuse(gg, ww, hh, DIFFUSION_KERNELS[method] || DIFFUSION_KERNELS.fs);
        if (scale <= 1) return run(gray, w, h);
        const sw = Math.ceil(w / scale), sh = Math.ceil(h / scale);
        const small = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh);
        for (let y = 0; y < h; y++) {
            const sy = (y / scale) | 0;
            for (let x = 0; x < w; x++) { const q = sy * sw + ((x / scale) | 0); small[q] += gray[y * w + x]; cnt[q]++; }
        }
        for (let q = 0; q < small.length; q++) small[q] /= cnt[q] || 1;
        const d = run(small, sw, sh);
        const out = new Uint8ClampedArray(w * h);
        for (let y = 0; y < h; y++) {
            const sy = (y / scale) | 0;
            for (let x = 0; x < w; x++) out[y * w + x] = d[sy * sw + ((x / scale) | 0)];
        }
        return out;
    }

    /* XDoG (Winnemöller et al.): D = (1+p)·G(σ) − p·G(1.6σ); soft threshold with tanh.
       Returns a tone map (0 = ink, 255 = paper). */
    function xdogLines(gray, w, h, o) {
        const n = w * h;
        const s = Math.max(w, h) / 1024;
        const sigma = Math.max(0.3, (o.xdogSigma / 10) * s);
        const p = o.xdogP, eps = o.xdogEps / 100, phi = o.xdogPhi;
        const g1 = new Float32Array(n);
        for (let k = 0; k < n; k++) g1[k] = gray[k] / 255;
        const g2 = Float32Array.from(g1);
        gaussBlur(g1, w, h, sigma);
        gaussBlur(g2, w, h, sigma * 1.6);
        const out = new Uint8ClampedArray(n);
        for (let k = 0; k < n; k++) {
            const d = (1 + p) * g1[k] - p * g2[k];
            let v = d >= eps ? 1 : 1 + Math.tanh(phi * (d - eps));
            if (o.xdogHard) v = v < 0.5 ? 0 : 1;
            out[k] = clamp255(v * 255);
        }
        return out;
    }

    // Pointillism: one jittered dot per cell, placed with probability = darkness.
    function stipple(gray, w, h, o) {
        const n = w * h;
        const s = Math.max(1, Math.max(w, h) / 1024);
        const cell = Math.max(2, o.stippleSize * s);
        const out = new Uint8ClampedArray(n).fill(255);
        const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
        for (let cy = 0; cy < rows; cy++) {
            for (let cx = 0; cx < cols; cx++) {
                const px = (cx + hash01(cx * 7 + 3, cy * 13 + 1)) * cell;
                const py = (cy + hash01(cx * 11 + 5, cy * 17 + 9)) * cell;
                const ix = Math.min(w - 1, px | 0), iy = Math.min(h - 1, py | 0);
                const d = Math.pow(1 - gray[iy * w + ix] / 255, 1.25);
                if (hash01(cx * 31 + 17, cy * 29 + 23) >= d) continue;
                const rad = cell * (0.32 + 0.22 * d);
                const x0 = Math.max(0, Math.floor(px - rad - 1)), x1 = Math.min(w - 1, Math.ceil(px + rad + 1));
                const y0 = Math.max(0, Math.floor(py - rad - 1)), y1 = Math.min(h - 1, Math.ceil(py + rad + 1));
                for (let y = y0; y <= y1; y++) {
                    for (let x = x0; x <= x1; x++) {
                        const dist = Math.sqrt((x + 0.5 - px) * (x + 0.5 - px) + (y + 0.5 - py) * (y + 0.5 - py));
                        const cov = Math.min(1, Math.max(0, rad - dist + 0.5));
                        if (cov <= 0) continue;
                        const k = y * w + x, v = 255 * (1 - cov);
                        if (v < out[k]) out[k] = v;
                    }
                }
            }
        }
        return out;
    }

    // Charcoal: thick soft contours + dark smudged fills + coarse paper tooth.
    function charcoal(gray, w, h, o) {
        const n = w * h;
        const s = Math.max(1, Math.max(w, h) / 1024);
        const soft = sketchLines(gray, w, h, Object.assign({}, o, { thick: o.thick * 1.8 }), true);
        const dark = new Float32Array(n);
        for (let k = 0; k < n; k++) {
            const lineDark = Math.min(255, (255 - soft[k]) * 1.4);
            const tonal = Math.max(0, (255 - gray[k]) * 0.95 - 25);
            dark[k] = lineDark > tonal ? lineDark : tonal;
        }
        boxBlur(dark, w, h, Math.max(1, Math.round(1.2 * s)));          // smudge
        const g = o.grain / 100;
        const c = Math.max(1, Math.round(s));
        const out = new Uint8ClampedArray(n);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const k = y * w + x;
                const nz = 0.45 * hash01((x / (c * 2)) | 0, (y / (c * 2)) | 0) + 0.35 * hash01((x / (c * 5)) | 0, (y / (c * 9)) | 0) + 0.2 * hash01(x, y);
                out[k] = 255 - Math.min(255, dark[k] * 1.1) * (1 - g * (0.25 + 0.75 * nz));
            }
        }
        return out;
    }

    let _bayer = null;
    function bayer8() {
        if (_bayer) return _bayer;
        let m = [[0]];
        for (let size = 1; size < 8; size *= 2) {
            const next = [];
            for (let y = 0; y < size * 2; y++) {
                next.push([]);
                for (let x = 0; x < size * 2; x++) {
                    const q = (y < size ? 0 : 2) + (x < size ? 0 : 1);       // quadrant offsets 0,2,3,1
                    next[y].push(4 * m[y % size][x % size] + [0, 2, 3, 1][q]);
                }
            }
            m = next;
        }
        _bayer = m;
        return m;
    }
    function ditherBayer(gray, w, h) {
        const m = bayer8();
        const out = new Uint8ClampedArray(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const thr = (m[y & 7][x & 7] + 0.5) / 64 * 255;
                out[y * w + x] = gray[y * w + x] > thr ? 255 : 0;
            }
        }
        return out;
    }

    /* Processes RGBA pixels IN PLACE.
       Returns false when nothing needed to change (plain Grayscale on an image that is already gray). */
    function processPixels(px, w, h, o) {
        const n = w * h;

        // Fast path: plain grayscale, alpha kept.
        if (isNeutral(o)) {
            let colored = false;
            for (let i = 0; i < px.length; i += 4) {
                const r = px[i], g = px[i + 1], b = px[i + 2];
                if (r !== g || g !== b) colored = true;
                px[i] = px[i + 1] = px[i + 2] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
            }
            return colored;
        }

        const transp = o.transp === 'auto' ? (o.mode === 'gray' ? 'keep' : 'white') : o.transp;
        const bg = transp === 'black' ? 0 : 255;

        // 1) luminance through the B&W filter (flattening transparency when asked to)
        const method = o.grayMethod || 'bt709';
        const wts = GRAY_WEIGHTS[method] || GRAY_WEIGHTS.bt709;
        const gray = new Float32Array(n);
        for (let i = 0, k = 0; k < n; i += 4, k++) {
            let r = px[i], g = px[i + 1], b = px[i + 2];
            if (transp !== 'keep') {
                const a = px[i + 3] / 255, inv = bg * (1 - a);
                r = r * a + inv; g = g * a + inv; b = b * a + inv;
            }
            gray[k] = grayOf(r, g, b, method, wts);
        }

        // 2) pre-smoothing + tone adjustments + sharpen
        const sc = Math.max(w, h) / 1024;
        if (o.blur > 0) boxBlur(gray, w, h, Math.max(1, Math.round(o.blur * sc)));
        if (o.auto || o.bright !== 0 || o.contrast !== 0 || o.gamma !== 100) {
            const lut = buildAdjustLut(gray, o);
            for (let k = 0; k < n; k++) gray[k] = lut[Math.min(255, Math.max(0, Math.round(gray[k])))];
        }
        if (o.sharpen > 0) {
            const bl = Float32Array.from(gray);
            gaussBlur(bl, w, h, Math.max(0.6, 1.2 * sc));
            const amt = o.sharpen / 40;
            for (let k = 0; k < n; k++) gray[k] = clamp255(gray[k] + amt * (gray[k] - bl[k]));
        }

        // 3) style → tone map (0 = ink, 255 = paper)
        let tone;
        switch (o.mode) {
            case 'lines': {
                let t = sketchLines(gray, w, h, o, o.soft);
                if (!o.soft) {
                    if (o.fine) {
                        const f = sketchLines(gray, w, h, o, false, 0.35, -8);
                        for (let k = 0; k < n; k++) if (f[k] < t[k]) t[k] = f[k];
                    }
                    t = refine(t, w, h, o);
                }
                tone = t;
                break;
            }
            case 'xdog': {
                tone = xdogLines(gray, w, h, o);
                if (o.xdogHard) tone = refine(tone, w, h, o);
                break;
            }
            case 'edges': tone = refine(sobelEdges(gray, w, h, o), w, h, o); break;
            case 'stipple': tone = stipple(gray, w, h, o); break;
            case 'charcoal': tone = charcoal(gray, w, h, o); break;
            case 'ink': {
                tone = new Uint8ClampedArray(n);
                if (o.adaptive) {
                    const mean = Float32Array.from(gray);
                    boxBlur(mean, w, h, Math.max(2, Math.round(Math.max(w, h) / 48)));
                    for (let k = 0; k < n; k++) tone[k] = gray[k] < mean[k] - o.adaptC ? 0 : 255;
                } else {
                    for (let k = 0; k < n; k++) tone[k] = gray[k] < o.thr ? 0 : 255;
                }
                tone = refine(tone, w, h, o);
                break;
            }
            case 'tone':
                tone = screentone(gray, w, h, o);
                if (o.toneLines) tone = overlayLines(tone, gray, w, h, o);
                break;
            case 'shadow':
                tone = screentone(gray, w, h, o, o.shadowStart / 100, o.shadowSolid >= 100 ? 2 : o.shadowSolid / 100);
                if (o.toneLines) tone = overlayLines(tone, gray, w, h, o);
                break;
            case 'hatch':
                tone = hatching(gray, w, h, { spacing: o.hatchSpacing, angle: o.hatchAngle, layers: o.hatchLayers, weight: o.hatchWeight, wobble: o.wobble });
                if (o.toneLines) tone = overlayLines(tone, gray, w, h, o);
                break;
            case 'pencil': {
                const soft = sketchLines(gray, w, h, o, true);
                const dark = new Float32Array(n);
                for (let k = 0; k < n; k++) {
                    const lineDark = Math.min(255, (255 - soft[k]) * 1.5);          // pencil pressure on the contours
                    const tonal = Math.max(0, (255 - gray[k]) - 60) * 0.5;          // soft graphite smudge in the shadows
                    dark[k] = lineDark > tonal ? lineDark : tonal;
                }
                if (o.shadeHatch) {
                    const hs = hatching(gray, w, h, { spacing: 5, angle: 45, layers: 3, weight: 4, wobble: o.wobble });
                    for (let k = 0; k < n; k++) { const sh = (255 - hs[k]) * 0.85; if (sh > dark[k]) dark[k] = sh; }
                }
                const g = o.grain / 100;
                const cell = Math.max(1, Math.round(Math.max(w, h) / 1024));
                tone = new Uint8ClampedArray(n);
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const k = y * w + x;
                        const nz = 0.6 * hash01(x / cell | 0, y / cell | 0) + 0.4 * hash01((x / (cell * 3)) | 0, (y / (cell * 3)) | 0);
                        tone[k] = 255 - dark[k] * (1 - g * (0.15 + 0.85 * nz));
                    }
                }
                break;
            }
            case 'pen': {
                const s = Math.max(1, Math.max(w, h) / 1024);
                const amp = o.wobble * 0.4 * s;
                let t = warpTone(sketchLines(gray, w, h, o, false), w, h, amp, 1);
                if (o.doubleStroke) {
                    const second = warpTone(sketchLines(gray, w, h, o, false, 0.6, -14), w, h, Math.max(amp, 0.8 * s), 2.5);
                    for (let k = 0; k < n; k++) if (second[k] < t[k]) t[k] = second[k];
                }
                t = refine(t, w, h, o);
                if (o.shadeHatch) {
                    const hs = hatching(gray, w, h, { spacing: 6, angle: 40, layers: 2, weight: 3, wobble: o.wobble });
                    for (let k = 0; k < n; k++) if (hs[k] < t[k]) t[k] = hs[k];
                }
                tone = t;
                break;
            }
            case 'dither': tone = ditherScaled(gray, w, h, o.ditherMethod, Math.max(1, Math.round((o.ditherScale || 1) * Math.max(1, sc)))); break;
            case 'posterize': {
                tone = new Uint8ClampedArray(n);
                const steps = Math.max(1, o.levels - 1);
                for (let k = 0; k < n; k++) tone[k] = Math.round(gray[k] / 255 * steps) / steps * 255;
                break;
            }
            default: tone = Uint8ClampedArray.from(gray, v => Math.round(v));
        }

        // Film grain (Grayscale / Posterize): two octaves of deterministic noise, strongest in the midtones.
        if (o.filmGrain > 0 && (o.mode === 'gray' || o.mode === 'posterize')) {
            const amt = o.filmGrain * 1.6;
            const c = Math.max(1, Math.round(sc));
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const k = y * w + x;
                    const nz = 0.7 * (hash01((x / c) | 0, (y / c) | 0) - 0.5) + 0.3 * (hash01(((x / (c * 2)) | 0) + 9173, (y / (c * 2)) | 0) - 0.5);
                    const mid = 1 - Math.abs(tone[k] - 128) / 160;
                    tone[k] = clamp255(tone[k] + nz * amt * (0.35 + 0.65 * mid));
                }
            }
        }

        // 4) colors + alpha
        const ink = hexToRgb(o.ink), paper = hexToRgb(o.paper);
        for (let i = 0, k = 0; k < n; i += 4, k++) {
            const v = o.invert ? 255 - tone[k] : tone[k];
            const origA = px[i + 3];
            if (o.lineAlpha) {
                px[i] = ink[0]; px[i + 1] = ink[1]; px[i + 2] = ink[2];
                px[i + 3] = Math.round((255 - v) * (transp === 'keep' ? origA / 255 : 1));
            } else {
                const t = v / 255;
                px[i] = ink[0] + (paper[0] - ink[0]) * t;
                px[i + 1] = ink[1] + (paper[1] - ink[1]) * t;
                px[i + 2] = ink[2] + (paper[2] - ink[2]) * t;
                px[i + 3] = transp === 'keep' ? origA : 255;
            }
        }
        return true;
    }
    window.TMImageConvert = { processPixels };

    /* ---------- WEB WORKER (full-size conversion without freezing the page) ----------
       The worker is built from the same functions above (Function.toString), so the
       preview (main thread) and the saved file always use identical code. */
    const WORKER_FUNCS = [clamp255, box1D, boxBlur, gaussBlur, grayOf, hexToRgb, isNeutral, buildAdjustLut,
        sketchLines, despeckle, smoothTone, refine, sobelEdges, screentone, hatching, warpTone, hash01,
        overlayLines, ditherDiffuse, ditherScaled, bayer8, ditherBayer, xdogLines, stipple, charcoal, processPixels];
    let _worker = null, _workerBroken = false, _workerSeq = 0;
    const _workerJobs = new Map();

    function getWorker() {
        if (_workerBroken) return null;
        if (_worker) return _worker;
        try {
            const src = [
                'const GRAY_WEIGHTS = ' + JSON.stringify(GRAY_WEIGHTS) + ';',
                'const DIFFUSION_KERNELS = ' + JSON.stringify(DIFFUSION_KERNELS) + ';',
                'let _bayer = null;',
                WORKER_FUNCS.map(f => f.toString()).join('\n'),
                'self.onmessage = function (e) {',
                '  const d = e.data;',
                '  try {',
                '    const px = new Uint8ClampedArray(d.buf);',
                '    const changed = processPixels(px, d.w, d.h, d.o);',
                '    self.postMessage({ id: d.id, buf: px.buffer, changed: changed }, [px.buffer]);',
                '  } catch (err) { self.postMessage({ id: d.id, error: String((err && err.message) || err) }); }',
                '};'
            ].join('\n');
            const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
            _worker = new Worker(url);
            URL.revokeObjectURL(url);
            _worker.onmessage = (e) => {
                const job = _workerJobs.get(e.data.id);
                if (!job) return;
                _workerJobs.delete(e.data.id);
                if (e.data.error) job.reject(new Error(e.data.error));
                else job.resolve({ px: new Uint8ClampedArray(e.data.buf), changed: e.data.changed });
            };
            _worker.onerror = (e) => {
                console.warn('[B&W] worker failed, using the main thread from now on:', e.message || e);
                _workerBroken = true;
                try { _worker.terminate(); } catch (x) {}
                _worker = null;
                _workerJobs.forEach(j => j.reject(new Error('worker crashed')));
                _workerJobs.clear();
            };
            return _worker;
        } catch (e) {
            console.warn('[B&W] Web Worker unavailable, converting on the main thread:', e);
            _workerBroken = true;
            return null;
        }
    }

    // { px, changed } — `px` may be a NEW array (the input buffer is transferred to the worker).
    async function processAsync(px, w, h, o) {
        const wk = getWorker();
        if (wk) {
            const backup = new Uint8ClampedArray(px);   // kept in case the worker dies mid-job
            try {
                return await new Promise((resolve, reject) => {
                    const id = ++_workerSeq;
                    _workerJobs.set(id, { resolve, reject });
                    wk.postMessage({ id, buf: px.buffer, w, h, o }, [px.buffer]);
                });
            } catch (e) {
                console.warn('[B&W] worker job failed, retrying on the main thread:', e.message || e);
                const changed = processPixels(backup, w, h, o);
                return { px: backup, changed };
            }
        }
        const changed = processPixels(px, w, h, o);
        return { px, changed };
    }
    window.TMImageConvert.processAsync = processAsync;

    function archiveLabelFor(o) {
        if (o.mode === 'gray' && (o.ink.toLowerCase() !== '#000000' || o.paper.toLowerCase() !== '#ffffff')) return 'tinted';
        return MODE_INFO[o.mode].archive;
    }

    /* ---------- CONVERSION OF A FILE ---------- */
    async function readOriginalBlob(img) {
        try {
            if (img.handle && typeof img.handle.getFile === 'function') return await img.handle.getFile();
        } catch (e) { /* falls back to the blob URL */ }
        return await (await fetch(img.url)).blob();
    }

    // Returns { blob } with the processed image, or { skipped: true } if nothing needed to change.
    async function toProcessedBlob(img, originalBlob, opts) {
        const bmp = await createImageBitmap(originalBlob);
        const w = bmp.width, h = bmp.height;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        bmp.close();

        const data = ctx.getImageData(0, 0, w, h);
        const res = await processAsync(data.data, w, h, opts);
        if (!res.changed) { canvas.width = canvas.height = 0; return { skipped: true }; }

        ctx.putImageData(new ImageData(res.px, w, h), 0, 0);
        const ext = imageExt(img);
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        let blob = await new Promise(res => canvas.toBlob(res, mime, 0.95));
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error('Failed to generate the converted image.');
        if (mime === 'image/png') blob = await copyPngTextChunks(originalBlob, blob);
        return { blob };
    }

    async function writeImageFile(img, blob) {
        const fh = await img.parentDirHandle.getFileHandle(img.name, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        return fh;
    }

    // true = converted | 'skipped' = nothing to change | false = failed (original kept)
    async function convertOne(img, opts, root) {
        let originalBlob;
        try { originalBlob = await readOriginalBlob(img); }
        catch (e) { console.error('[B&W] could not read', img.name, e); return false; }

        let result;
        try { result = await toProcessedBlob(img, originalBlob, opts); }
        catch (e) { console.error('[B&W] could not convert', img.name, e); return false; }
        if (result.skipped) return 'skipped';

        // Make sure the caption on disk is current before it is archived.
        if (img.dirty && img.hasFile && typeof window.saveImageToDisk === 'function') await window.saveImageToDisk(img);

        if (typeof window.moveToArchive !== 'function') { console.error('[B&W] Archive module not loaded.'); return false; }
        const archived = await window.moveToArchive(img, archiveLabelFor(opts), root);
        if (!archived) return false; // original untouched

        let newHandle;
        try {
            newHandle = await writeImageFile(img, result.blob);
        } catch (e) {
            console.error('[B&W] write failed, putting the original back:', img.name, e);
            try { await writeImageFile(img, originalBlob); } catch (e2) { console.error('[B&W] could not put the original back (it is still in 📦 Archive):', e2); }
            if (img.hasFile && typeof window.saveImageToDisk === 'function') await window.saveImageToDisk(img);
            return false;
        }

        // The caption was archived with the image — rewrite it from memory.
        if (img.hasFile && typeof window.saveImageToDisk === 'function') await window.saveImageToDisk(img);

        // Swap the image in memory and force the list thumbnail to be rebuilt.
        const oldUrl = img.url;
        const oldThumb = img._thumbBlobUrl;
        img.handle = newHandle;
        img.url = URL.createObjectURL(result.blob);
        img._thumbBlobUrl = null;
        img._thumbBuiltFor = null;
        try { URL.revokeObjectURL(oldUrl); } catch (e) {}
        if (oldThumb) { try { URL.revokeObjectURL(oldThumb); } catch (e) {} }
        return true;
    }

    /* ---------- BATCH RUN (called by the popout's Convert button) ---------- */
    function selectedImages() {
        if (typeof selectedIndices === 'undefined' || typeof imageFiles === 'undefined') return [];
        return Array.from(selectedIndices).sort((a, b) => a - b).map(i => imageFiles[i]).filter(img => img && !img.hidden);
    }

    // ⏳ background task: the images and the dataset are captured now; it finishes on that dataset even if
    // another one is opened (the screen is only refreshed when that dataset is still open).
    async function runBatch(imgs) {
        const ctx = window.TM.tasks.captureDataset();
        ctx.files = imgs;
        return window.TM.tasks.run({ title: `B&W / styles (${imgs.length})`, icon: '🖤', ctx, silentEnd: true,
            onCancel: () => { _cancel = true; } }, (task) => runBatchTask(imgs, ctx, task)).promise;
    }
    async function runBatchTask(imgs, ctx, task) {
        const opts = { ...state };
        const btnEl = () => (window.TM.tasks.sameLoad(ctx) ? document.getElementById('btn-grayscale') : null);
        const btn = document.getElementById('btn-grayscale');
        _busy = true;
        if (btn) btn.disabled = true;

        _cancel = false;
        if (btn) { btn.disabled = false; btn.title = 'Converting... click to stop after the current image'; }

        let done = 0, skipped = 0, failed = [], stoppedAt = -1;
        try {
            for (let i = 0; i < imgs.length; i++) {
                if (_cancel || task.cancelled) { stoppedAt = i; break; }
                const b = btnEl();
                if (b) b.textContent = `⏳ ${i + 1}/${imgs.length}`;
                task.progress(i + 1, imgs.length, imgs[i].name);
                const r = await convertOne(imgs[i], opts, ctx.root);
                if (r === true) done++;
                else if (r === 'skipped') skipped++;
                else failed.push(imgs[i].name);
                await new Promise(res => setTimeout(res, 0)); // keeps the page responsive
            }
        } finally {
            _busy = false;
            _cancel = false;
            if (btn) { btn.disabled = false; btn.textContent = '🖤'; btn.title = BTN_TITLE; }
        }

        task.result = `${done} converted${failed.length ? `, ${failed.length} failed` : ''}`;
        if (done > 0 && window.TM.tasks.sameLoad(ctx)) {
            if (typeof window.renderImageList === 'function') window.renderImageList();
            if (typeof window.renderEditor === 'function' && selectedIndices.size > 0) window.renderEditor();
            if (typeof window.updateArchiveButtonState === 'function') window.updateArchiveButtonState();
        }

        if (window.showAlert) {
            const parts = [`Converted ${done} image(s) to ${MODE_INFO[opts.mode].name}. Originals kept in 📦 Archive.`];
            if (skipped) parts.push(`${skipped} already black & white (skipped).`);
            if (stoppedAt >= 0) parts.push(`Stopped by you — ${imgs.length - stoppedAt} image(s) left untouched.`);
            if (failed.length) {
                const names = failed.slice(0, 5).join(', ') + (failed.length > 5 ? '...' : '');
                window.showAlert(`${parts.join(' ')} ⚠️ ${failed.length} failed and were left untouched: ${names}`, 'warn', 7000);
            } else {
                window.showAlert(parts.join(' '), done > 0 ? 'success' : 'info');
            }
        }
    }

    /* =====================================================================
       POPOUT + LIVE PREVIEW
    ===================================================================== */
    let _preview = { token: 0, base: null, w: 0, h: 0, timer: null, list: [], index: 0 };
    const rowEls = {};   // key -> row element

    function controlVisible(c) {
        if (c.modes && !c.modes.includes(state.mode)) return false;
        if (c.when && !c.when(state)) return false;
        return true;
    }

    function makeRow(c) {
        const row = document.createElement('div');
        row.className = 'bw-row';
        let input;
        const lbl = document.createElement('span');
        lbl.className = 'bw-lbl';
        lbl.textContent = c.label;
        if (c.title) lbl.title = c.title;

        if (c.type === 'check') {
            const label = document.createElement('label');
            if (c.title) label.title = c.title;
            input = document.createElement('input');
            input.type = 'checkbox';
            label.appendChild(input);
            label.appendChild(document.createTextNode(' ' + c.label));
            row.appendChild(label);
            input.onchange = () => { state[c.key] = input.checked; afterControlChange(c); saveState(); };
        } else if (c.type === 'range') {
            input = document.createElement('input');
            input.type = 'range'; input.min = c.min; input.max = c.max; input.step = 1;
            const val = document.createElement('span');
            val.className = 'bw-val';
            row.appendChild(lbl); row.appendChild(input); row.appendChild(val);
            input.oninput = () => {
                state[c.key] = parseInt(input.value, 10);
                val.textContent = c.fmt ? c.fmt(state[c.key]) : state[c.key];
                afterControlChange(c);
            };
            input.onchange = saveState;
            row._val = val;
        } else if (c.type === 'select') {
            input = document.createElement('select');
            c.options.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; input.appendChild(o); });
            row.appendChild(lbl); row.appendChild(input);
            input.onchange = () => { state[c.key] = input.value; afterControlChange(c); saveState(); };
        } else if (c.type === 'color') {
            input = document.createElement('input');
            input.type = 'color';
            row.appendChild(lbl); row.appendChild(input);
            input.oninput = () => { state[c.key] = input.value.toLowerCase(); afterControlChange(c); };
            input.onchange = saveState;
        }
        row._input = input;
        rowEls[c.key] = row;
        return row;
    }

    function afterControlChange(c) {
        if (c.key === 'preset') {
            const p = PRESETS[state.preset];
            if (p) { state.ink = p.ink; state.paper = p.paper; }
        } else if (c.key === 'ink' || c.key === 'paper') {
            state.preset = matchPreset();
        }
        syncUI();
        schedulePreview();
    }

    function matchPreset() {
        for (const [k, p] of Object.entries(PRESETS)) {
            if (p.ink === state.ink && p.paper === state.paper) return k;
        }
        return 'custom';
    }

    function buildModal() {
        if (document.getElementById('modal-bw-convert')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-bw-convert';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => closeBwModal();
        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🖤 B&amp;W / Manga / Styles</span>
                    <button id="bw-close" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div class="bw-layout">
                    <div class="bw-left">
                        <div id="bw-count" style="font-size:12px; color:#aaa;"></div>
                        <div class="bw-group-label">Quick recipes</div>
                        <div class="bw-recipes" id="bw-recipes"></div>
                        <div class="bw-modes" id="bw-modes"></div>
                        <div class="bw-mode-hint" id="bw-mode-hint"></div>
                        <div class="bw-group" id="bw-group-mode"></div>
                        <details class="bw-details" id="bw-details-adjust"><summary>🎛️ Adjustments</summary><div class="bw-details-body" id="bw-group-adjust"></div></details>
                        <details class="bw-details" id="bw-details-color"><summary>🎨 Colors &amp; background</summary><div class="bw-details-body" id="bw-group-color"></div></details>
                    </div>
                    <div class="bw-right">
                        <div class="bw-preview-bar">
                            <button class="bw-nav-btn" id="bw-prev" title="Previous selected image">◀</button>
                            <span id="bw-preview-name"></span>
                            <button class="bw-nav-btn" id="bw-next" title="Next selected image">▶</button>
                        </div>
                        <div id="bw-preview-wrap"><canvas id="bw-preview-canvas" width="1" height="1"></canvas></div>
                        <div id="bw-preview-status"></div>
                        <div class="bw-preview-bar">
                            <span style="color:#9ecfff; font-weight:bold;">View</span>
                            <select id="bw-view" title="Compare the result with the original">
                                <option value="result">Result</option>
                                <option value="original">Original</option>
                                <option value="split">Split (original | result)</option>
                            </select>
                            <input type="range" id="bw-split" min="5" max="95" value="50" title="Split position" style="display:none;">
                        </div>
                        <div style="font-size:11px; color:#666; line-height:1.5;">The preview uses the selected images (◀ ▶), scaled down — fine patterns (dither, small dots) may look slightly different at full size. Originals (and captions) are moved to 📦 Archive first, so you can restore them anytime. The converted file keeps the same name. JPEG/WebP are re-encoded and lose EXIF; PNG keeps its prompt metadata and is the best choice for 1-bit styles and transparent lineart.</div>
                    </div>
                </div>
                <div class="modal-buttons">
                    <button id="btn-bw-reset" title="Reset every option to its default (the selected style is kept)">↺ Reset options</button>
                    <button class="btn-cancel" id="bw-cancel">Cancel</button>
                    <button id="btn-bw-confirm">✅ Convert</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const modes = overlay.querySelector('#bw-modes');
        MODE_GROUPS.forEach(g => {
            const head = document.createElement('div');
            head.className = 'bw-group-label';
            head.textContent = g.label;
            modes.appendChild(head);
            const rowDiv = document.createElement('div');
            rowDiv.className = 'bw-mode-row';
            g.modes.forEach(key => {
                const b = document.createElement('button');
                b.className = 'bw-mode-btn';
                b.dataset.mode = key;
                b.textContent = MODE_INFO[key].label;
                b.onclick = () => { state.mode = key; syncUI(); saveState(); schedulePreview(); };
                rowDiv.appendChild(b);
            });
            modes.appendChild(rowDiv);
        });

        CONTROLS.forEach(c => overlay.querySelector('#bw-group-' + c.group).appendChild(makeRow(c)));

        const recipes = overlay.querySelector('#bw-recipes');
        RECIPES.forEach(r => {
            const b = document.createElement('button');
            b.className = 'bw-recipe-btn';
            b.textContent = r.label;
            b.title = r.title + ' (resets the other options)';
            b.onclick = () => {
                Object.assign(state, DEFAULTS, r.set);
                const p = PRESETS[state.preset];
                if (p) { state.ink = p.ink; state.paper = p.paper; }
                syncUI(); saveState(); schedulePreview();
            };
            recipes.appendChild(b);
        });

        const view = overlay.querySelector('#bw-view');
        const split = overlay.querySelector('#bw-split');
        view.onchange = () => { split.style.display = view.value === 'split' ? '' : 'none'; drawPreview(); };
        split.oninput = () => drawPreview();
        overlay.querySelector('#bw-prev').onclick = () => stepPreview(-1);
        overlay.querySelector('#bw-next').onclick = () => stepPreview(1);
        overlay.querySelector('#bw-close').onclick = closeBwModal;
        overlay.querySelector('#bw-cancel').onclick = closeBwModal;
        overlay.querySelector('#btn-bw-reset').onclick = () => {
            const keepMode = state.mode;
            Object.assign(state, DEFAULTS, { mode: keepMode });
            syncUI(); saveState(); schedulePreview();
        };
        overlay.querySelector('#btn-bw-confirm').onclick = () => {
            const imgs = selectedImages();
            if (imgs.length === 0) { if (window.showAlert) window.showAlert('Select at least one image first!', 'warn'); return; }
            closeBwModal();
            runBatch(imgs);
        };
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('active')) closeBwModal();
        });
    }

    function closeBwModal() {
        const m = document.getElementById('modal-bw-convert');
        if (m) m.classList.remove('active');
        clearTimeout(_preview.timer);
        _preview.token++;
        _preview.base = null;
        _preview.list = [];
    }

    function syncUI() {
        const o = document.getElementById('modal-bw-convert');
        if (!o) return;
        o.querySelectorAll('.bw-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
        o.querySelector('#bw-mode-hint').textContent = MODE_INFO[state.mode].hint;
        CONTROLS.forEach(c => {
            const row = rowEls[c.key];
            if (!row) return;
            const input = row._input;
            if (c.type === 'check') input.checked = !!state[c.key];
            else if (document.activeElement !== input) input.value = state[c.key];
            if (c.type === 'range' && row._val) row._val.textContent = c.fmt ? c.fmt(state[c.key]) : state[c.key];
            row.style.display = controlVisible(c) ? 'flex' : 'none';
        });
    }

    function schedulePreview() {
        clearTimeout(_preview.timer);
        _preview.timer = setTimeout(drawPreview, 120);
    }

    function drawPreview() {
        const canvas = document.getElementById('bw-preview-canvas');
        const status = document.getElementById('bw-preview-status');
        if (!canvas || !_preview.base) return;
        const { w, h, base } = _preview;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        const view = (document.getElementById('bw-view') || {}).value || 'result';

        if (view === 'original') {
            ctx.putImageData(base, 0, 0);
            if (status) status.textContent = 'Original';
            return;
        }
        const copy = new ImageData(new Uint8ClampedArray(base.data), w, h);
        const changed = processPixels(copy.data, w, h, state);
        ctx.putImageData(copy, 0, 0);
        if (view === 'split') {
            const pos = parseInt((document.getElementById('bw-split') || {}).value || 50, 10) / 100;
            const sx = Math.round(w * pos);
            ctx.putImageData(base, 0, 0, 0, 0, sx, h);
            ctx.fillStyle = '#b890ff';
            ctx.fillRect(Math.max(0, sx - 1), 0, 2, h);
        }
        if (status) status.textContent = changed ? (view === 'split' ? '◀ original | result ▶' : '') : 'This image is already grayscale — it would be skipped.';
    }

    function updatePreviewNav() {
        const imgs = _preview.list || [];
        const i = _preview.index || 0;
        const prev = document.getElementById('bw-prev'), next = document.getElementById('bw-next');
        const name = document.getElementById('bw-preview-name');
        if (prev) prev.disabled = i <= 0;
        if (next) next.disabled = i >= imgs.length - 1;
        if (name) {
            const img = imgs[i];
            name.textContent = img ? `${i + 1}/${imgs.length} · ${img.name}` : '';
            name.title = img ? img.name : '';
        }
    }

    function stepPreview(dir) {
        const imgs = _preview.list || [];
        const ni = Math.min(imgs.length - 1, Math.max(0, (_preview.index || 0) + dir));
        if (ni === _preview.index) return;
        _preview.index = ni;
        updatePreviewNav();
        loadPreviewBase(imgs[ni]);
    }

    async function loadPreviewBase(img) {
        const token = ++_preview.token;
        const status = document.getElementById('bw-preview-status');
        _preview.base = null;
        if (status) status.textContent = 'Loading preview...';
        try {
            const blob = await readOriginalBlob(img);
            const bmp = await createImageBitmap(blob);
            if (token !== _preview.token) { bmp.close(); return; }
            const scale = Math.min(1, PREVIEW_MAX / Math.max(bmp.width, bmp.height));
            const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const cx = c.getContext('2d', { willReadFrequently: true });
            cx.imageSmoothingQuality = 'high';
            cx.drawImage(bmp, 0, 0, w, h);
            bmp.close();
            _preview.base = cx.getImageData(0, 0, w, h);
            _preview.w = w; _preview.h = h;
            c.width = c.height = 0;
            drawPreview();
        } catch (e) {
            console.warn('[B&W] preview failed:', e);
            if (token === _preview.token && status) status.textContent = 'Could not load the preview (the conversion may still work).';
        }
    }

    /* ---------- BUTTON ACTION: OPEN THE POPOUT ---------- */
    window.convertSelectedToGrayscale = async function () {
        if (_busy) return;
        const imgs = selectedImages();
        if (imgs.length === 0) {
            if (window.showAlert) window.showAlert('Select at least one image first!', 'warn');
            return;
        }
        await loadState();
        buildModal();
        syncUI();
        document.getElementById('bw-count').textContent = `${imgs.length} image(s) selected.`;
        document.getElementById('bw-view').value = 'result';
        document.getElementById('bw-split').style.display = 'none';
        _preview.list = imgs;
        _preview.index = 0;
        updatePreviewNav();
        window.openModal('modal-bw-convert');
        loadPreviewBase(imgs[0]);
    };

    /* ---------- INJECT THE BUTTON (next to 🪣) ---------- */
    const BTN_TITLE = 'Convert the selected image(s) to black & white, manga or other styles (originals go to 📦 Archive)';

    function injectButton() {
        if (document.getElementById('btn-grayscale')) return;
        const anchor = document.getElementById('btn-scan-buckets')
            || document.getElementById('btn-psd-import');
        if (!anchor) return;
        const btn = document.createElement('button');
        btn.id = 'btn-grayscale';
        btn.textContent = '🖤';
        btn.title = BTN_TITLE;
        btn.onclick = () => {
            if (_busy) {   // second click during a batch = stop after the current image
                _cancel = true;
                btn.textContent = '⏹';
                btn.title = 'Stopping after the current image...';
                return;
            }
            window.convertSelectedToGrayscale();
        };
        anchor.insertAdjacentElement('afterend', btn);
    }

    window.addEventListener('DOMContentLoaded', () => setTimeout(injectButton, 100));

})();
