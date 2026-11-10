/* =========================================================================
   PROMPT HELPER — OLLAMA TAB: SUB-TABS + WRITER
   Depends on: prompt_helper_settings.js (showAlert), prompt_helper_ui.js,
               prompt_helper_ollama.js (#oUrl / #oModel of the Ollama tab)

   The Writer is a generalized port of the Shiro Video Director's WRITER
   (itself DaSiWa's Prompt Forge writer), without the MiniMax H3 format:
     - 10 Creativity presets (rule + DaSiWa's temperature / top_p)
     - 10 Detail levels (words for prompts, tag counts for tags; video scales
       with the duration, like DaSiWa's ladder)
     - ===SEGMENT: Name=== answer contract, <think> dropped, refusal and
       "lost the thread" detection
     - rules from checkboxes or written in the Idea (EN / PT), taken out of
       the brief and given to the model as rules
     - vision: attached pictures go to the model with a role each; a model
       that refuses pictures (HTTP 4xx) is asked again with text only
   Targets: image prompt (natural language), image tags, video prompt.
========================================================================= */
(function () {
    'use strict';

    // ---------------------------------------------------------------- sub-tabs
    function showSub(name) {
        document.querySelectorAll('.o-subtab').forEach(b => b.classList.toggle('active', b.dataset.osub === name));
        document.querySelectorAll('.o-subpane').forEach(p => p.classList.toggle('active', p.id === 'oSub-' + name));
        try { localStorage.setItem('ph_ollama_sub', name); } catch (e) {}
    }
    document.querySelectorAll('.o-subtab').forEach(b => { b.onclick = () => showSub(b.dataset.osub); });

    const pane = document.getElementById('oSub-writer');
    if (!pane) return;

    // ---------------------------------------------------------------- data
    const CREATIVITY = {
        literal:   { t: 0.30, p: 0.65,
            image: 'Depict exactly what the brief names: no additional subjects, props or details beyond what is needed to show it. Plain, neutral composition.',
            video: 'Show exactly the requested action: no additional events, props or people. Unless the brief explicitly requests multiple shots, use one continuous shot with no cuts. Describe camera and sound plainly.' },
        precise:   { t: 0.45, p: 0.72,
            image: 'Stay close to the brief; add no unexpected elements. Choose a simple composition, plausible light and a clear framing.',
            video: 'Stay close to the brief; add no unexpected events. Unless multiple shots are explicitly requested, use one continuous shot with no cuts. Choose simple framing, restrained camera motion and plausible sound.' },
        faithful:  { t: 0.55, p: 0.76,
            image: 'Follow the brief and fill only the essential details: framing, setting, light. Add no extra subjects or story.',
            video: 'Follow the brief and fill only essential staging, camera and sound details. Unless multiple shots are explicitly requested, use one continuous shot with no cuts; add no extra action beats.' },
        measured:  { t: 0.62, p: 0.78,
            image: 'Stay restrained. A small plausible background detail may support the scene; keep the focus on what the brief names.',
            video: 'Stay restrained. A small plausible reaction or background beat may support the scene. Prefer continuous camera motion; introduce a cut only with a clear narrative reason, never as routine coverage.' },
        balanced:  { t: 0.70, p: 0.80,
            image: 'Fill plausible gaps in setting, light, pose and composition. Allow one small fitting detail that makes the picture more alive.',
            video: 'Fill plausible gaps in action, camera and sound. Allow a small fitting surprise or background event. Prefer one continuous shot; a cut is optional only when it reveals meaningful new information.' },
        loose:     { t: 0.78, p: 0.85,
            image: 'Allow a distinctive angle, a striking light or a small unexpected detail. Preserve the named subjects and action.',
            video: 'Allow a distinctive camera move, a small unexpected action beat or a revealing sound. A motivated cut is possible, not required. Preserve the named subjects and action; keep additions within the duration.' },
        inventive: { t: 0.85, p: 0.88,
            image: 'Introduce fitting unexpected elements: an unusual viewpoint, secondary details, atmosphere. Never contradict the brief.',
            video: 'Introduce fitting unexpected events, reveals, secondary motion or sound. An unexpected cut or viewpoint change is allowed when it strengthens the scene, but surprises can happen entirely within one continuous shot. Never contradict the brief.' },
        creative:  { t: 0.92, p: 0.92,
            image: 'Explore surprising but coherent ideas in composition, light, palette and setting. Preserve the requested subjects and action.',
            video: 'Explore surprising but coherent events, reveals, changes in light, camera and sound. A purposeful unexpected cut is allowed, not required. Preserve the requested subjects and action and fit all beats within the duration.' },
        daring:    { t: 1.00, p: 0.94,
            image: 'Allow bold choices: dramatic angles, strong light, an unusual setting or palette. Preserve the named subjects and action.',
            video: 'Allow bold, unexpected action beats, reveals, camera moves and sound design. An unexpected cut or viewpoint change is an option, not a quota. Preserve the named subjects and action; explicit no-cut instructions remain binding.' },
        wild:      { t: 1.10, p: 0.96,
            image: 'Use the strongest freedom for unexpected but coherent imagery: bold composition, surreal or striking touches. Preserve the named subjects and action.',
            video: 'Use the strongest freedom for unexpected but coherent events, bold camera choices and sound design. Creative editing is allowed, never mandatory; avoid frantic coverage in short clips. Preserve the named subjects and action; explicit no-cut instructions remain binding.' }
    };
    const DEFAULT_CREATIVITY = 'balanced';

    // [label, image words, tag count, video words (DaSiWa ladder, for 10 s)]
    const DETAIL = {
        1:  ['Bare',          [15, 30],   [8, 12],  [40, 60]],
        2:  ['Minimal',       [30, 50],   [12, 18], [60, 100]],
        3:  ['Light',         [50, 80],   [18, 25], [100, 150]],
        4:  ['Modest',        [80, 110],  [25, 32], [150, 200]],
        5:  ['Standard',      [110, 150], [32, 40], [200, 280]],
        6:  ['Full',          [150, 200], [40, 48], [280, 350]],
        7:  ['Rich',          [200, 260], [48, 56], [350, 420]],
        8:  ['Dense',         [260, 330], [56, 65], [420, 500]],
        9:  ['Very detailed', [330, 420], [65, 75], [500, 600]],
        10: ['Exhaustive',    [420, 520], [75, 90], [600, 750]]
    };
    const DEFAULT_DETAIL = 5;
    const DETAIL_FOCUS = {
        1: 'the subject, the action and the essential setting',
        2: 'the subject, the action, where it is and the framing',
        3: 'add how the subject looks and how the scene is lit',
        4: 'add framing, camera angle and what the light is doing',
        5: 'add what changes or what each element is doing, and the textures that matter',
        6: 'add expression and body language, and a palette and mood',
        7: 'add materials and surfaces and how the light falls across them',
        8: 'describe foreground and background precisely; do not add props or crowds only to increase detail',
        9: 'describe the finer details of expression, light and surfaces; every phrase must be something you can see',
        10: 'every element fully specified: framing, light, materials, expression, background; no statements of theme or feeling'
    };
    const VIDEO_LADDER_SECONDS = 10;
    const MAX_VIDEO_WORDS = 800;

    const TRANSITIONS = {
        off: 'Join the shots with clean, plain cuts: no dissolves, fades, wipes or transition moves.',
        auto: 'Where it helps the scene, join a shot to the one before with a transition of your choice - a match cut, the action or a sound carrying across, a dissolve, a camera move into the next shot - named right at the start of that shot; a plain cut is fine elsewhere.',
        smooth: 'Make every cut flow: open each later shot by saying how it follows from the shot before - a match cut on a movement or a shape, the action carrying across the cut, an eyeline, a sound or the light leading into it - so the shots read as one continuous scene.',
        dissolve: 'Join the shots with soft transitions: each later shot opens with a short cross-dissolve from the shot before (a fade through black or white only where the mood turns).',
        camera: 'Join the shots with camera transitions: a whip pan, a fast push through an object or a foreground wipe, or a camera move that carries straight into the next shot.'
    };

    const ROLES = {
        image: [
            ['subject', 'Subject (keep how it looks)'],
            ['style', 'Style'],
            ['pose', 'Pose / composition'],
            ['scene', 'Place / scene'],
            ['describe', 'Describe it (the picture is the brief)']
        ],
        video: [
            ['first', 'First frame'],
            ['last', 'Last frame'],
            ['subject', 'Subject (keep how it looks)'],
            ['style', 'Style'],
            ['scene', 'Place / scene']
        ]
    };
    const ROLE_TEXT = {
        subject: 'a subject: keep exactly how it looks - identity, hair, body, clothing and colours - but not its pose, action or background',
        style: 'the style only: medium, linework, palette, shading and rendering; not its content',
        pose: 'the pose and composition only: stance, limbs, gesture, framing and where things sit in the frame; not who it is or what they wear',
        scene: 'the place: its setting, landmarks, objects and light',
        describe: 'the picture to describe: write the prompt that recreates what it shows - subject, pose, clothing, setting, framing, light and style',
        first: 'the first frame of the video: the video starts exactly from this picture; describe what is in it briefly and then what happens from there',
        last: 'the last frame of the video: the video ends exactly on this picture; the action must arrive at it'
    };

    const MUSIC_WORDS = /\b(music|musical|score|soundtrack|ost|bgm|song|songs|singing|sings|sung|melody|tune|piano|guitar|violin|cello|strings|orchestra|orchestral|synth|drums?|percussion|beat|m[uú]sica|trilha|can[cç][aã]o|cantando)\b/i;
    const REFUSAL = ["i can't", 'i cannot', 'i can not', "i won't", 'i will not', "i'm not able", 'i am not able',
        "i'm unable", 'i am unable', "i'm sorry", 'i am sorry', 'sorry, but', 'as an ai', 'not able to help',
        "can't help with", 'cannot help with', "can't assist", 'cannot assist', 'content policy', 'guidelines',
        'inappropriate', 'explicit content', 'não posso', 'não consigo ajudar', 'desculpe'];
    const RUNAWAY_SENTENCE = 500;
    const CONTEXT_BASE = 8192, CONTEXT_PER_IMAGE = 1820, VISION_EDGE = 768, MAX_PICTURES = 4;

    // ---------------------------------------------------------------- trigger rules (video)
    // Unicode-aware word boundary, so "áudio" / "música" match like in Python.
    const WB = '(?:(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_]))';
    const rx = src => new RegExp(src.replace(/\\b/g, WB), 'giu');
    const NEG = "(?:no|without|sem|nenhuma?|zero)";
    const NOT = "(?:don'?t|do not|never|n[aã]o|nunca|sem)";
    const TRIGGERS = [
        ['no_speech', `\\b(?:${NEG}\\s+(?:speech|dialog(?:ue)?s?|talking|spoken lines?|voices?|narration|lines|falas?|di[aá]logos?|narra[cç][aã]o|conversa)|nobody (?:speaks|talks)|no one (?:speaks|talks)|ningu[eé]m fala)\\b`,
            'No one speaks: write no spoken lines, no quoted dialogue, no voice-over and no narration.'],
        ['no_music', `\\b(?:${NEG}\\s+(?:music|score|soundtrack|bgm|m[uú]sica|trilha(?: sonora)?))\\b`,
            'No music: no score, no song, no instrument; only the sounds of the scene.'],
        ['no_sound', `\\b(?:${NEG}\\s+(?:sound|audio|som|[aá]udio)|silent (?:video|clip)|v[ií]deo mudo|mudo)\\b`,
            'A silent video: write no sound, no music and no speech.'],
        ['lock_camera', `\\b(?:${NEG}\\s+(?:camera (?:move(?:ment)?s?|motion)|movimento de c[aâ]mera)|static camera|fixed camera|locked(?:-off)? camera|camera (?:doesn'?t|does not|never|won'?t) move|c[aâ]mera (?:parada|fixa|est[aá]tica)|${NOT}\\s+mov(?:a|er) a c[aâ]mera)\\b`,
            'The camera holds a static shot throughout: no pan, tilt, truck, pedestal, arc, tracking, orbit or handheld movement.'],
        ['lock_zoom', `\\b(?:${NEG}\\s+(?:zoom(?:ing)?|push[- ]?ins?|pull[- ]?outs?)|${NOT}\\s+zoom)\\b`,
            'No zoom throughout: no zoom in or out and no push-in or pull-out; the framing distance stays the same.'],
        ['lock_light', `\\b(?:(?:keep|same|maintain|manter|mesma)\\s+(?:the\\s+|a\\s+)?(?:light(?:ing)?|illumination|ilumina[cç][aã]o|luz)(?:\\s+the same|\\s+igual)?|${NOT}\\s+(?:change|alter|mudar|alterar|mude)\\s+(?:the\\s+|a\\s+)?(?:light(?:ing)?|illumination|ilumina[cç][aã]o|luz)|${NEG}\\s+(?:light(?:ing)?|illumination|ilumina[cç][aã]o|luz)\\s+changes?)\\b`,
            'The lighting and the time of day stay exactly the same throughout: no change in light direction, brightness, colour temperature, shadows, sky, weather or time of day.'],
        ['lock_background', `\\b(?:(?:keep|same|maintain|manter|mesmo)\\s+(?:the\\s+|o\\s+)?(?:background|backdrop|setting|scenery|fundo|cen[aá]rio)(?:\\s+the same|\\s+igual)?|${NOT}\\s+(?:change|alter|mudar|alterar|mude)\\s+(?:the\\s+|o\\s+)?(?:background|backdrop|setting|scenery|fundo|cen[aá]rio)|${NEG}\\s+(?:background|scene|fundo|cen[aá]rio)\\s+changes?)\\b`,
            'The background and the setting stay the same throughout: the same place, the same objects and scenery in the same positions; no new location.'],
        ['one_shot', `\\b(?:(?:one|single|um|uma)\\s+(?:continuous\\s+)?(?:shot|take|plano|tomada)|${NEG}\\s+(?:cuts?|cortes?)|plano [uú]nico)\\b`,
            'One continuous shot: no cuts.']
    ];
    const RULE_LABELS = { no_speech: 'no speech', no_music: 'no music', no_sound: 'no sound', lock_camera: 'static camera',
        lock_zoom: 'no zoom', lock_light: 'same light', lock_background: 'same background', one_shot: 'one shot' };

    function findRules(text) {
        const found = [];
        text = String(text || '');
        for (const [name, pattern] of TRIGGERS) {
            const r = rx(pattern);
            if (r.test(text)) { found.push(name); text = text.replace(rx(pattern), ''); }
        }
        text = text.replace(/[ \t]*([,;])(?:\s*[,;.])+/g, '$1')
                   .replace(/^[\s,;.]+|[ \t]+(?=[,.;])/gm, '')
                   .replace(/[ \t]{2,}/g, ' ').replace(/^[ ,;]+|[ ,;]+$/g, '');
        const conn = '(?:with|and|but|or|e|com|mas|ou)';
        for (let i = 0; i < 3; i++) {
            text = text.replace(new RegExp(`\\b${conn}\\s+(?=${conn}\\b)`, 'gi'), '');
            text = text.replace(new RegExp(`\\s*,?\\s*\\b${conn}\\s*(?=[.,;!?]|$)`, 'gi'), '');
        }
        text = text.replace(/[ \t]{2,}/g, ' ').replace(/^[ ,;]+|[ ,;]+$/g, '');
        if (found.includes('no_sound')) ['no_music', 'no_speech'].forEach(x => { if (!found.includes(x)) found.push(x); });
        return { text, rules: found };
    }

    // ---------------------------------------------------------------- helpers
    const $ = id => document.getElementById(id);
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fmtG = x => String(+(+x).toPrecision(6));
    const titleCase = v => String(v).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const words = s => (String(s || '').match(/\S+/g) || []).length;
    function lsGet(k, d) { try { const v = localStorage.getItem('ph_w_' + k); return v === null ? d : v; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem('ph_w_' + k, v); } catch (e) {} }

    // ---------------------------------------------------------------- markup
    const css = `
        #oSub-writer { overflow-y: auto; padding-right: 4px; }
        .w-box { background: #0d0d0d; border: 1px solid #1e2a3a; border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
        .w-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .w-row .lang-label { font-size: 11px; color: #888; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; }
        .w-row select { min-width: 0; }
        .w-checks { display: flex; gap: 6px 14px; flex-wrap: wrap; }
        .w-checks .opt-row { font-size: 11px; }
        #wIdea, #wResult, #wNegative { width: 100%; box-sizing: border-box; resize: vertical; font-size: 13px; line-height: 1.5; padding: 10px; background: #0d0d0d; border: 1px solid #2a3a2e; border-radius: 8px; font-weight: normal; flex-shrink: 0; }
        #wIdea { min-height: 90px; }
        #wResult { min-height: 160px; background: #0a1210; border-color: #1a3a2e; color: #9ecfff; }
        #wNegative { min-height: 60px; background: #120a0a; border-color: #3a1a1a; color: #ffb0b0; }
        #wShotBriefs { display: flex; flex-direction: column; gap: 6px; }
        #wShotBriefs input { width: 100%; box-sizing: border-box; font-weight: normal; }
        .w-drop { border: 1px dashed #2a5a8c; border-radius: 8px; padding: 10px; text-align: center; color: #777; font-size: 12px; cursor: pointer; }
        .w-drop:hover, .w-drop.over { border-color: #4db8ff; color: #9ecfff; background: #0a1a2a; }
        #wPics { display: flex; gap: 8px; flex-wrap: wrap; }
        .w-pic { display: flex; flex-direction: column; gap: 4px; width: 132px; background: #151515; border: 1px solid #2a2a2a; border-radius: 6px; padding: 5px; position: relative; }
        .w-pic img { width: 100%; height: 90px; object-fit: cover; border-radius: 4px; }
        .w-pic select { font-size: 10px; padding: 4px; }
        .w-pic .w-tag { font-size: 10px; color: #4db8ff; font-weight: bold; }
        .w-pic .w-x { position: absolute; top: 3px; right: 3px; background: #2a0000; color: #ff6060; padding: 0 6px; font-size: 12px; line-height: 18px; border-radius: 4px; }
        .w-pic .w-x:hover { background: #ff4444; color: #000; }
        #wWarnings { display: none; background: #1a1500; border: 1px solid #aa8800; color: #ffcc66; padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.5; flex-shrink: 0; }
        #wWarnings ul { margin: 0; padding-left: 18px; }
        #wRawBox { font-size: 11px; color: #777; flex-shrink: 0; }
        #wRawBox pre { white-space: pre-wrap; background: #0d0d0d; border: 1px solid #222; border-radius: 6px; padding: 8px; max-height: 220px; overflow: auto; color: #aaa; }
        .w-count { font-size: 11px; color: #777; margin-left: auto; }
        .w-video, .w-tags, .w-imgonly { }
        #oSub-writer[data-target="video"] .w-imgonly, #oSub-writer:not([data-target="video"]) .w-video { display: none !important; }
        #oSub-writer:not([data-target="tags"]) .w-tags { display: none !important; }
        #oSub-writer[data-preset="off"] .w-h3, #oSub-writer:not([data-preset="off"]) .w-noh3 { display: none !important; }
        .w-note { font-size: 11px; color: #4db8ff; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const creatOpts = Object.keys(CREATIVITY).map(k => `<option value="${k}">${titleCase(k)}</option>`).join('');
    const detailOpts = Object.entries(DETAIL).map(([k, v]) => `<option value="${k}">${k} · ${v[0]}</option>`).join('');

    pane.innerHTML = `
        <div class="w-box">
            <div class="w-row">
                <span class="lang-label">Preset</span>
                <select id="wPreset" title="Off: a plain prompt in natural language (or tags). A preset writes in that model's own format.">
                    <option value="off">Off (natural language)</option>
                </select>
                <span class="lang-label w-noh3">Target</span>
                <select id="wTarget" class="w-noh3" title="What the prompt is for">
                    <option value="image">Image prompt (natural language)</option>
                    <option value="tags">Image tags (Danbooru style)</option>
                    <option value="video">Video prompt</option>
                </select>
                <span class="lang-label">Creativity</span>
                <select id="wCreativity" title="How much the model may add (also sets temperature / top_p)">${creatOpts}</select>
                <span class="lang-label">Detail</span>
                <select id="wDetail" title="How long and precise the prompt is">${detailOpts}</select>
            </div>
            <div class="w-row w-video">
                <span class="lang-label">Duration</span>
                <input type="number" id="wDuration" min="1" max="60" step="0.5" value="5" style="width:70px;" title="Seconds">
                <span class="lang-label">Shots</span>
                <select id="wShots" title="Auto lets the model decide (usually one continuous shot)">
                    <option value="Auto">Auto</option><option value="1">1</option><option value="2">2</option>
                    <option value="3">3</option><option value="4">4</option><option value="5">5</option>
                </select>
                <span class="lang-label">Transitions</span>
                <select id="wTransitions" title="How the shots are joined (only with more than one shot)">
                    <option value="auto">Auto</option><option value="off">Plain cuts</option>
                    <option value="smooth">Smooth</option><option value="dissolve">Dissolve</option><option value="camera">Camera move</option>
                </select>
            </div>
            <div class="w-row w-h3">
                <span class="lang-label">Mode</span>
                <select id="wH3Mode" title="Auto: from the pictures' roles (first / last frame = I2VA / L2VA / FL2VA, other references = REF2VA, none = T2VA)">
                    <option value="auto">Auto (from pictures)</option><option value="T2VA">T2VA</option><option value="I2VA">I2VA</option>
                    <option value="FL2VA">FL2VA</option><option value="L2VA">L2VA</option><option value="REF2VA">REF2VA</option>
                </select>
                <span class="lang-label">Canvas</span>
                <input type="number" id="wWidth" min="64" max="8192" step="8" placeholder="width" style="width:78px;" title="Output width (optional; empty = unknown, the model omits the aspect ratio)">
                <span style="color:#666;">×</span>
                <input type="number" id="wHeight" min="64" max="8192" step="8" placeholder="height" style="width:78px;" title="Output height (optional)">
                <span class="w-note" id="wH3Note"></span>
            </div>
            <div class="w-checks w-video">
                <label class="opt-row"><input type="checkbox" id="wSound" checked> Sound</label>
                <label class="opt-row"><input type="checkbox" id="wNoSpeech"> No speech</label>
                <label class="opt-row"><input type="checkbox" id="wNoMusic"> No music</label>
                <label class="opt-row"><input type="checkbox" id="wLockCamera"> Static camera</label>
                <label class="opt-row"><input type="checkbox" id="wLockZoom"> No zoom</label>
                <label class="opt-row"><input type="checkbox" id="wLockLight"> Same light</label>
                <label class="opt-row"><input type="checkbox" id="wLockBackground"> Same background</label>
            </div>
            <div class="w-checks">
                <label class="opt-row" title="Write the prompt in English, translating the idea if needed"><input type="checkbox" id="wEnglish" checked> Write in English</label>
                <label class="opt-row w-noh3" title="Also write a negative prompt"><input type="checkbox" id="wNegOn"> Negative prompt</label>
                <label class="opt-row" title="Send the pictures below to the model (needs a vision model: qwen2.5vl, llava, gemma3, llama3.2-vision...)"><input type="checkbox" id="wVision" checked> See pictures</label>
                <span class="w-tags w-row">
                    <span class="lang-label">Tags with</span>
                    <select id="wTagStyle"><option value="spaces">spaces</option><option value="underscores">underscores</option></select>
                </span>
            </div>
        </div>

        <textarea id="wIdea" placeholder="Idea — what you want, in any language. Rules can be written here too (e.g. &quot;no music&quot;, &quot;câmera parada&quot;, &quot;um plano só&quot;). Leave it empty to write from the pictures alone. (Ctrl+Enter)"></textarea>
        <div id="wShotBriefs" class="w-video"></div>

        <div class="w-box">
            <div class="w-drop" id="wDrop">🖼️ Click, drop or paste (Ctrl+V) up to ${MAX_PICTURES} pictures — each one gets a role</div>
            <input type="file" id="wFile" accept="image/*" multiple style="display:none;">
            <div id="wPics"></div>
        </div>

        <div class="action-row">
            <button class="btn-translate" id="wGenerate">✍️ Write prompt</button>
            <button class="btn-secondary" id="wCancel" style="flex:0; white-space:nowrap;">⏹ Cancel</button>
            <button class="btn-secondary" id="wUnload" style="flex:0; white-space:nowrap;" title="Free the model from VRAM now">⏏ Unload</button>
            <select id="wKeepAlive" style="flex:0;" title="How long Ollama keeps the model loaded after each answer">
                <option value="10m">keep 10 min</option><option value="30m">keep 30 min</option><option value="0">unload after</option>
            </select>
            <button class="btn-secondary" id="wClear" style="flex:0;">Clear</button>
        </div>
        <div class="status-line" id="wStatus">Uses the Ollama URL and model above.</div>

        <div id="wWarnings"></div>
        <textarea id="wResult" placeholder="Prompt appears here (you can edit it)..."></textarea>
        <div class="w-row">
            <button class="btn-secondary" id="wCopy">📋 Copy prompt</button>
            <button class="btn-secondary" id="wToIdea" title="Put the prompt back in the Idea box to rewrite it">↩ Use as idea</button>
            <span class="w-count" id="wCount"></span>
        </div>
        <textarea id="wNegative" placeholder="Negative prompt..." style="display:none;"></textarea>
        <div class="w-row" id="wNegRow" style="display:none;">
            <button class="btn-secondary" id="wCopyNeg">📋 Copy negative</button>
        </div>
        <details id="wRawBox"><summary>Raw answer from the model</summary><pre id="wRaw"></pre></details>
    `;

    // ---------------------------------------------------------------- presets (prompt_helper_writer_*.js)
    const PRESETS = window.WriterPresets || {};
    Object.entries(PRESETS).forEach(([key, pr]) => {
        const o = document.createElement('option');
        o.value = key; o.textContent = pr.label || key;
        $('wPreset').appendChild(o);
    });
    const presetKey = () => (PRESETS[$('wPreset').value] ? $('wPreset').value : 'off');

    // ---------------------------------------------------------------- persistence
    const persistSel = { wPreset: 'off', wH3Mode: 'auto', wTarget: 'image', wCreativity: DEFAULT_CREATIVITY, wDetail: String(DEFAULT_DETAIL), wShots: 'Auto',
        wTransitions: 'auto', wTagStyle: 'spaces', wKeepAlive: '10m' };
    Object.entries(persistSel).forEach(([id, d]) => {
        const el = $(id);
        const v = lsGet(id, d);
        if (Array.from(el.options).some(o => o.value === v)) el.value = v;
        el.addEventListener('change', () => lsSet(id, el.value));
    });
    $('wDuration').value = lsGet('wDuration', '5');
    ['wWidth', 'wHeight'].forEach(id => { $(id).value = lsGet(id, ''); $(id).addEventListener('change', () => lsSet(id, $(id).value)); });
    $('wDuration').addEventListener('change', () => lsSet('wDuration', $('wDuration').value));
    ['wSound', 'wNoSpeech', 'wNoMusic', 'wLockCamera', 'wLockZoom', 'wLockLight', 'wLockBackground', 'wEnglish', 'wNegOn', 'wVision']
        .forEach(id => {
            const el = $(id);
            const v = lsGet(id, null);
            if (v !== null) el.checked = v === '1';
            el.addEventListener('change', () => lsSet(id, el.checked ? '1' : '0'));
        });
    $('wIdea').value = lsGet('idea', '');
    $('wIdea').addEventListener('input', () => lsSet('idea', $('wIdea').value));

    // ---------------------------------------------------------------- dynamic UI
    let briefs = [];
    function renderShotBriefs() {
        const box = $('wShotBriefs');
        const n = parseInt($('wShots').value, 10);
        box.querySelectorAll('input').forEach((el, i) => { briefs[i] = el.value; });
        box.innerHTML = '';
        if (!(n > 1)) return;
        for (let i = 0; i < n; i++) {
            const el = document.createElement('input');
            el.type = 'text';
            el.placeholder = `Shot ${i + 1} (optional): what happens in this shot`;
            el.value = briefs[i] || '';
            box.appendChild(el);
        }
    }
    function effTarget() {
        const pr = PRESETS[presetKey()];
        return pr && pr.video ? 'video' : $('wTarget').value;
    }
    function syncTarget() {
        pane.dataset.preset = presetKey();
        pane.dataset.target = effTarget();
        syncNeg();
        syncNote();
        renderPics();
        updateCount();
    }
    function syncNote() {
        const pr = PRESETS[presetKey()];
        if (!pr || !pr.clip) { $('wH3Note').textContent = ''; return; }
        const c = pr.clip(parseFloat($('wDuration').value) || 5);
        $('wH3Note').textContent = `→ ${c.frames} frames · ${c.seconds.toFixed(2)} s`;
    }
    $('wTarget').addEventListener('change', syncTarget);
    $('wPreset').addEventListener('change', syncTarget);
    $('wDuration').addEventListener('input', syncNote);
    $('wShots').addEventListener('change', renderShotBriefs);
    $('wNegOn').addEventListener('change', syncNeg);
    function syncNeg() {
        const pr = PRESETS[presetKey()];
        const on = $('wNegOn').checked && !(pr && pr.negative === false);
        $('wNegative').style.display = on ? '' : 'none';
        $('wNegRow').style.display = on ? '' : 'none';
    }

    // ---------------------------------------------------------------- pictures
    let pics = [];   // {b64, url, role}
    function defaultRole(i) {
        if (effTarget() !== 'video') return 'subject';
        return i === 0 ? 'first' : 'subject';
    }
    function renderPics() {
        const box = $('wPics');
        const kind = effTarget() === 'video' ? 'video' : 'image';
        const valid = ROLES[kind].map(r => r[0]);
        box.innerHTML = '';
        pics.forEach((pic, i) => {
            if (!valid.includes(pic.role)) pic.role = defaultRole(i);
            const card = document.createElement('div');
            card.className = 'w-pic';
            card.innerHTML = `<span class="w-tag">Picture ${i + 1}</span><img src="${pic.url}" alt=""><button class="w-x" title="Remove">×</button>
                <select>${ROLES[kind].map(([v, l]) => `<option value="${v}"${v === pic.role ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
            card.querySelector('select').onchange = e => { pic.role = e.target.value; };
            card.querySelector('.w-x').onclick = () => { pics.splice(i, 1); renderPics(); };
            box.appendChild(card);
        });
    }
    function toJpegB64(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const k = Math.min(1, VISION_EDGE / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(img.width * k));
                c.height = Math.max(1, Math.round(img.height * k));
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                const data = c.toDataURL('image/jpeg', 0.9);
                resolve({ b64: data.split(',')[1], url: data });
                URL.revokeObjectURL(url);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
            img.src = url;
        });
    }
    async function addFiles(files) {
        for (const f of Array.from(files || [])) {
            if (!f.type.startsWith('image/')) continue;
            if (pics.length >= MAX_PICTURES) { window.showAlert(`Up to ${MAX_PICTURES} pictures.`, 'warn'); break; }
            try {
                const p = await toJpegB64(f);
                p.role = defaultRole(pics.length);
                if (effTarget() === 'video' && pics.length === 1 && pics[0].role === 'first') p.role = 'last';
                pics.push(p);
            } catch (e) { window.showAlert('Could not read ' + f.name, 'error'); }
        }
        renderPics();
    }
    const drop = $('wDrop');
    drop.onclick = () => $('wFile').click();
    $('wFile').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
    document.addEventListener('paste', e => {
        if (!pane.classList.contains('active') || !$('tab-ollama').classList.contains('active')) return;
        const files = Array.from(e.clipboardData?.items || []).filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
        if (files.length) { e.preventDefault(); addFiles(files); }
    });

    // ---------------------------------------------------------------- the request
    function systemPrompt(target) {
        const common = [
            'You are a prompt writer. You read what the person sends and turn it into the best possible prompt for a generative model.',
            'Preserve everything they named - you may add supporting detail, you may not drop a subject, an action or a setting.',
            'You do not greet, explain yourself, ask permission, or comment on the request. You return the prompt.',
            '',
            '## Output',
            '- Every response is segments. Open each one with `===SEGMENT: ` then the exact label, then `===` on the same line.',
            '- Use the labels you are asked for, in that order. Never emit another one and never omit one.',
            '- Nothing before the first segment and nothing after the last: no preamble, no headings, no code fences, no markdown, no closing commentary.',
            '- If you cannot build a prompt at all, emit only `===SEGMENT: Refused===` followed by one line saying so.',
            '',
            '## Age',
            'Mandatory, overrides everything else: every human you describe is an adult. Never use a word implying a minor to describe a person.',
            '',
            '## Positive wording',
            'In the prompt, describe what is there, never what is not: no "no X", "without X" or "not X". Things to avoid belong only in a Negative segment, when one is asked for.',
            '',
            '## Pictures',
            'When pictures are attached, each one has a role. What a picture supplies, in its role, stays exactly as the picture shows it at every Creativity setting; Creativity decides only what is added around it. Never mention "the picture", "the reference" or "the image" in the prompt: describe the content itself.'
        ];
        const guides = {
            image: [
                '', '## Your format: image prompt in natural language',
                'Write flowing descriptive prose for a text-to-image model (Flux, SDXL, Qwen-Image and similar), in this order:',
                'the medium and style first (photo, anime illustration, oil painting...), then the main subject - who or what, how they look, clothing, pose and expression - then the setting, then composition and camera (shot size, angle, lens, depth of field), then light, colour palette and mood.',
                'Concrete and visual: every phrase is something you can see. No statements of theme, no quality spam ("masterpiece, best quality, 8k") unless the person writes it.'
            ],
            tags: [
                '', '## Your format: image tags (Danbooru style)',
                'Write a comma-separated list of booru tags for an anime/illustration model (Illustrious, NoobAI, Pony and similar). Real, commonly used Danbooru tags, lowercase, in English.',
                'Order: subject count (1girl, 1boy, solo, 2girls...), character and series tags if named, then appearance (hair, eyes, body), clothing, expression, pose and action, then setting and background, then composition and camera (upper body, from above, close-up...), then light and style.',
                'One tag per concept, no sentences, no duplicates, no weights or parentheses unless the person writes them. Quality and rating tags only if the person asks for them.'
            ],
            video: [
                '', '## Your format: video prompt',
                'Write a prompt for a text/image-to-video model (Wan, LTX, Hunyuan, Kling and similar) in flowing prose:',
                'open with one sentence of overall visual style, then describe the scene as it unfolds over time - who is where, what they do, how it changes from the start to the end of the clip - then the camera: the motion (push in, pull out, pan, truck, tilt, pedestal, arc, tracking, zoom) with small or large amplitude and slow or fast speed, or "The camera holds a static shot."',
                'Write movement and expression as a change from one state to another (for example easing out of a smile into a searching look); never call a figure completely still. Keep characters, clothes and place consistent.',
                'With more than one shot, write each shot as its own paragraph starting with "Shot N (from S s):" with the second it starts; the shots follow each other directly and every beat fits inside the duration.',
                'Spoken lines, when there are any, are written in double quotes with who says them and how. When sound is asked for, end with one paragraph starting "Audio:" naming the ambience and the sound each action makes (and music only if asked for or clearly fitting).'
            ]
        };
        return common.concat(guides[target]).join('\n');
    }

    function detailLine(target, level, duration, shots) {
        const d = DETAIL[level] || DETAIL[DEFAULT_DETAIL];
        const focus = DETAIL_FOCUS[level] || DETAIL_FOCUS[DEFAULT_DETAIL];
        if (target === 'tags') return `Detail level ${level} of 10 - ${d[0]}. About ${d[2][0]}-${d[2][1]} tags: ${focus}.`;
        if (target === 'image') return `Detail level ${level} of 10 - ${d[0]}. About ${d[1][0]}-${d[1][1]} words: ${focus}. Detail controls descriptive precision, not additional subjects.`;
        let [lo, hi] = d[3];
        const factor = (+duration || VIDEO_LADDER_SECONDS) / VIDEO_LADDER_SECONDS;
        if (Math.abs(factor - 1) >= 0.05) {
            lo = Math.max(10, Math.round(lo * factor / 5) * 5);
            hi = Math.min(Math.max(Math.max(10, Math.round(hi * factor / 5) * 5), lo + 10), MAX_VIDEO_WORDS);
            lo = Math.min(lo, hi - 10);
        }
        let line = `Detail level ${level} of 10 - ${d[0]}. About ${lo}-${hi} words for this ${fmtG(duration)}-second clip: ${focus}. Detail controls descriptive precision, not shot count or additional events.`;
        const n = parseInt(shots, 10);
        if (n > 1) line += ` With ${n} shots that is about ${Math.round(lo / n)}-${Math.round(hi / n)} words in each shot: every shot gets its full share, the last as much as the first.`;
        return line;
    }

    function wordRange(target, level, duration) {
        const d = DETAIL[level] || DETAIL[DEFAULT_DETAIL];
        if (target === 'tags') return d[2];
        if (target === 'image') return d[1];
        const f = (+duration || VIDEO_LADDER_SECONDS) / VIDEO_LADDER_SECONDS;
        return [d[3][0] * f, Math.min(d[3][1] * f, MAX_VIDEO_WORDS)];
    }

    function buildRequest() {
        const target = effTarget();
        const video = target === 'video';
        const creativity = $('wCreativity').value in CREATIVITY ? $('wCreativity').value : DEFAULT_CREATIVITY;
        const detail = parseInt($('wDetail').value, 10) || DEFAULT_DETAIL;
        const duration = Math.max(1, parseFloat($('wDuration').value) || 5);
        let shots = $('wShots').value;

        let idea = $('wIdea').value.trim();
        let rules = [];
        if (video) {
            const r = findRules(idea);
            idea = r.text; rules = r.rules;
            const boxes = [['lock_zoom', 'wLockZoom'], ['lock_camera', 'wLockCamera'], ['lock_light', 'wLockLight'],
                ['lock_background', 'wLockBackground'], ['no_speech', 'wNoSpeech'], ['no_music', 'wNoMusic']];
            boxes.forEach(([name, id]) => { if ($(id).checked && !rules.includes(name)) rules.push(name); });
            if (!$('wSound').checked && !rules.includes('no_sound')) rules.push('no_sound');
            if (rules.includes('no_sound')) ['no_music', 'no_speech'].forEach(x => { if (!rules.includes(x)) rules.push(x); });
            if (rules.includes('one_shot') && !(parseInt(shots, 10) > 0)) shots = '1';
        }
        const n = parseInt(shots, 10) || 0;
        const shotLines = [];
        if (video && n > 1) {
            $('wShotBriefs').querySelectorAll('input').forEach((el, i) => {
                const t = findRules(el.value).text.trim();
                if (t) shotLines.push(`Shot ${i + 1}: ${t}`);
            });
        }
        const brief = [idea, ...shotLines].join('\n').trim();

        const pr = PRESETS[presetKey()];
        if (pr) {
            const w = parseInt($('wWidth').value, 10), h = parseInt($('wHeight').value, 10);
            return pr.build({
                brief, rules, shots: n, creativity, detail, duration, english: $('wEnglish').checked,
                transitions: $('wTransitions').value, mode: $('wH3Mode').value,
                canvas: (w >= 1 && w <= 8192 && h >= 1 && h <= 8192) ? { width: w, height: h } : null,
                pictures: pics.map(p => ({ b64: p.b64, role: p.role })), see: $('wVision').checked
            });
        }

        const seen = $('wVision').checked ? pics : [];
        if (!brief && !seen.length) throw new Error(pics.length ? 'Turn "See pictures" on, or write an idea.' : 'Write an idea or add a picture first.');

        const user = [];
        user.push(`Brief: "${brief || (video ? 'Write the video the attached pictures set up.' : 'Write the prompt for what the attached pictures show.')}"`);
        const settings = [`Creativity: ${titleCase(creativity)}`, `Target: ${{ image: 'image prompt', tags: 'image tags', video: 'video prompt' }[target]}`];
        if (video) settings.push(`Duration: ${fmtG(duration)} sec`);
        user.push(`Settings (context for how to write, never text to include): ${settings.join(' · ')}`);
        if (video) {
            const override = 'This overrides any shot count in the detail level or the idea.';
            if (n === 1) user.push(`Shots: 1 - one continuous shot, no cuts. ${override}`);
            else if (n > 1) {
                user.push(`Shots: ${n} - exactly ${n} shots, Shot 1 to Shot ${n}, no more and no fewer. ${override}`);
                user.push('Transitions: ' + (TRANSITIONS[$('wTransitions').value] || TRANSITIONS.auto));
            } else user.push('Transitions (only if you use more than one shot): ' + (TRANSITIONS[$('wTransitions').value] || TRANSITIONS.auto));
        }
        user.push(`Creativity - ${titleCase(creativity)}. ${CREATIVITY[creativity][video ? 'video' : 'image']}`);
        user.push(detailLine(target, detail, duration, n));
        if (rules.length) {
            user.push('', 'Rules the person set (they override the brief and the Creativity setting):');
            TRIGGERS.forEach(([name, , sentence]) => { if (rules.includes(name)) user.push('- ' + sentence); });
        }
        if (video && $('wSound').checked && !rules.includes('no_sound')) user.push('Sound: end with the "Audio:" paragraph.');
        else if (video) user.push('Sound: write no "Audio:" paragraph.');
        user.push($('wEnglish').checked
            ? 'Write in English; translate the brief when it is in another language (never quoted spoken lines).'
            : 'Write in the same language as the brief' + (target === 'tags' ? ' (tags stay in English).' : '.'));
        if (seen.length) {
            user.push('', seen.length === 1 ? 'A picture is attached to this message:' : `${seen.length} pictures are attached to this message, in this order:`);
            seen.forEach((p, i) => user.push(`- Picture ${i + 1} is ${ROLE_TEXT[p.role] || ROLE_TEXT.subject}.`));
            user.push('Look at them - the lines above say what each one is FOR, the pictures say what is in them. Describe only what is visible; no mood words for what you cannot see.');
        }
        const segs = ['Prompt'];
        if ($('wNegOn').checked) segs.push('Negative');
        user.push('', 'Segments to emit, in this order: ' + segs.map(s => `===SEGMENT: ${s}===`).join(' then ') + '.');
        if ($('wNegOn').checked) user.push(target === 'tags'
            ? 'Negative: comma-separated tags for what must not appear (artefacts, wrong anatomy, unwanted elements).'
            : 'Negative: a short comma-separated list of what must not appear (artefacts, unwanted elements, wrong style).');

        return { target, creativity, detail, duration, shots: n, rules, brief, images: seen.map(p => p.b64),
                 system: systemPrompt(target), user: user.join('\n'), segments: segs };
    }

    // ---------------------------------------------------------------- the answer
    function stripThink(text) {
        text = String(text || '');
        if (text.includes('</think>')) text = text.split('</think>').pop();
        else if (text.trim().startsWith('<think>')) text = '';
        return text.trim();
    }
    function looksLikeRefusal(answer) {
        const t = String(answer || '').trim().toLowerCase();
        if (!t || t.length > 1500 || /===\s*SEGMENT/i.test(answer)) return false;
        return REFUSAL.some(m => t.includes(m));
    }
    function runaway(segments, isTags) {
        if (isTags) return null;      // a tag list is one long "sentence" by nature
        for (const [label, body] of Object.entries(segments)) {
            if (label === 'Negative') continue;
            const longest = Math.max(0, ...String(body || '').split(/(?<=[.!?])(?:["'”’»])*\s+/).map(s => s.length));
            if (longest > RUNAWAY_SENTENCE) return [label, longest];
        }
        return null;
    }
    class WriterError extends Error { constructor(msg, raw) { super(msg); this.raw = raw || ''; } }

    function parseSegments(text, expected, isTags) {
        let raw = stripThink(text).replace(/^\s*```[^\n]*$/gm, '').trim();
        const re = /^[ \t]*===\s*SEGMENT:\s*(.+?)\s*===[ \t]*$/gmi;
        const matches = [...raw.matchAll(re)];
        if (!matches.length) {
            if (looksLikeRefusal(raw)) throw new WriterError('The model declined (its own content rules); try another model.', raw);
            // a small model often answers with the prompt alone: accept it when only Prompt was asked
            if (expected.length === 1 && raw) return { Prompt: raw.replace(/^\s*prompt\s*:\s*/i, '') };
            throw new WriterError('The model returned no ===SEGMENT: markers - it did not follow the output format. Try a larger model.', raw);
        }
        const canon = Object.fromEntries(['Prompt', 'Negative', 'Refused'].map(l => [l.toLowerCase(), l]));
        const segments = {};
        matches.forEach((m, i) => {
            const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
            const heading = m[1].replace(/\*/g, '').trim();
            let label = canon[heading.toLowerCase()] || (/negative/i.test(heading) ? 'Negative' : heading);
            if (label in segments) label = heading + ' ' + i;
            segments[label] = raw.slice(m.index + m[0].length, end).replace(/^\s*={3,}\s*$/gm, '').trim();
        });
        if ('Refused' in segments) throw new WriterError('The model refused: ' + segments.Refused, raw);
        const missing = expected.filter(l => !(l in segments));
        const lost = runaway(segments, isTags);
        if (lost) throw new WriterError(`The model lost the thread in ${lost[0]} (one sentence ran ${lost[1].toLocaleString()} characters). Regenerate, or pick a different model.`, raw);
        if (missing.includes('Prompt')) throw new WriterError('The model left out: Prompt.', raw);
        return segments;
    }

    function cleanTags(text, underscores) {
        const seen = new Set();
        return String(text || '').replace(/\n+/g, ',').split(',')
            .map(t => t.trim().replace(/^[-*•]\s*/, '').replace(/\.$/, '').trim())
            .filter(Boolean)
            .map(t => underscores ? t.replace(/(?<=\w) (?=\w)/g, '_') : t.replace(/_/g, ' '))
            .filter(t => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
            .join(', ');
    }

    function finish(req, segments, seenCount) {
        const warnings = [];
        let prompt = String(segments.Prompt || '').replace(/^\s*prompt\s*:\s*/i, '').trim();
        let negative = String(segments.Negative || '').replace(/^\s*negative(?: prompt)?\s*:\s*/i, '').trim();
        if (req.target === 'tags') {
            prompt = cleanTags(prompt, $('wTagStyle').value === 'underscores');
            if (negative) negative = cleanTags(negative, $('wTagStyle').value === 'underscores');
        }
        if (req.images.length && !seenCount) warnings.push('The model did not take pictures (HTTP 4xx), so it wrote from text only. Pick a vision model, or turn "See pictures" off.');
        if (req.segments.includes('Negative') && !negative) warnings.push('The model wrote no negative prompt.');
        const [lo, hi] = wordRange(req.target, req.detail, req.duration);
        const got = req.target === 'tags' ? prompt.split(',').filter(x => x.trim()).length : words(prompt);
        const unit = req.target === 'tags' ? 'tags' : 'words';
        if (got > hi * 1.5) warnings.push(`${got} ${unit}, well above Detail ${req.detail} (${Math.round(lo)}-${Math.round(hi)}). Lower Detail or regenerate.`);
        else if (got < lo * 0.5) warnings.push(`Only ${got} ${unit}, well below Detail ${req.detail} (${Math.round(lo)}-${Math.round(hi)}).`);
        if (req.target === 'video') {
            const shotNums = new Set([...prompt.matchAll(/\bShot\s+(\d+)\b/gi)].map(m => m[1]));
            const wrote = shotNums.size || 1;
            if (req.shots && wrote !== req.shots) warnings.push(`You asked for ${req.shots} shot${req.shots === 1 ? '' : 's'} and the model wrote ${wrote}. Regenerate, or edit the prompt.`);
            const times = [...prompt.matchAll(/\bShot\s+\d+\s*\(from\s*(\d+(?:\.\d+)?)\s*s\)/gi)].map(m => +m[1]);
            if (times.some(t => t >= req.duration)) warnings.push(`A shot starts at or after the end of the ${fmtG(req.duration)}-second clip.`);
            if (times.some((t, i) => i && t <= times[i - 1])) warnings.push('Shot start times must increase.');
            if (req.rules.includes('no_speech') && /["“][^"”]{3,}["”]/.test(prompt)) warnings.push('No speech was asked, but the prompt has quoted text - check it is not a spoken line.');
            if (req.rules.includes('no_sound') && /\bAudio\s*:/i.test(prompt)) warnings.push('A silent video was asked, but the prompt has an Audio paragraph.');
            if (!req.rules.includes('no_music') && !req.rules.includes('no_sound') && !MUSIC_WORDS.test(req.brief)) {
                const audio = (prompt.match(/\bAudio\s*:([\s\S]*)$/i) || [])[1] || '';
                if (MUSIC_WORDS.test(audio)) warnings.push('The prompt includes music you did not ask for; check it, or tick "No music".');
            } else if (req.rules.includes('no_music')) {
                const audio = (prompt.match(/\bAudio\s*:([\s\S]*)$/i) || [])[1] || '';
                if (MUSIC_WORDS.test(audio)) warnings.push('No music was asked, but the Audio paragraph mentions music.');
            }
        }
        return { prompt, negative, warnings };
    }

    // ---------------------------------------------------------------- calling Ollama
    function base() { return ($('oUrl').value || 'http://127.0.0.1:11434').trim().replace(/\/+$/, ''); }
    async function ollamaCall(req, images, signal) {
        const preset = CREATIVITY[req.creativity] || CREATIVITY[DEFAULT_CREATIVITY];
        const options = req.options ? Object.assign({}, req.options) : { temperature: preset.t, top_p: preset.p, num_predict: -1,
            num_ctx: images.length ? Math.ceil((CONTEXT_BASE + CONTEXT_PER_IMAGE * images.length) / 256) * 256 : CONTEXT_BASE };
        const keep = $('wKeepAlive').value;
        const body = { model: $('oModel').value, system: req.system, prompt: req.user, images, stream: false, think: false,
            keep_alive: keep === '0' ? 0 : keep, options };
        const res = await fetch(base() + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            const err = new Error('Ollama HTTP ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
            err.status = res.status;
            throw err;
        }
        const data = await res.json();
        return ((data.response || '').trim() || (data.thinking || '').trim());
    }
    async function call(req, signal) {
        try {
            return [await ollamaCall(req, req.images, signal), req.images.length];
        } catch (e) {
            // DaSiWa: a server that refuses pictures is asked once more with words only
            if (req.images.length && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403) {
                $('wStatus').textContent = 'The model refused the pictures, retrying with text only...';
                return [await ollamaCall(req, [], signal), 0];
            }
            throw e;
        }
    }

    // ---------------------------------------------------------------- run
    let ctl = null;
    function showWarnings(list) {
        const box = $('wWarnings');
        if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
        box.innerHTML = '<ul>' + list.map(w => `<li>${esc(w)}</li>`).join('') + '</ul>';
        box.style.display = 'block';
    }
    function updateCount() {
        const v = $('wResult').value;
        const tags = effTarget() === 'tags';
        const limit = presetKey() === 'minimax' ? ' / 7,000' : '';
        $('wCount').textContent = v ? (tags ? v.split(',').filter(x => x.trim()).length + ' tags · ' : words(v) + ' words · ') + v.length.toLocaleString() + limit + ' chars' : '';
    }
    $('wResult').addEventListener('input', updateCount);

    async function run() {
        const status = $('wStatus');
        const model = $('oModel').value;
        if (!model) { window.showAlert('Select a model first (click 🔄 above).', 'warn'); return; }
        let req;
        try { req = buildRequest(); } catch (e) { window.showAlert(e.message, 'warn'); return; }
        if (ctl) ctl.abort();
        ctl = new AbortController();
        const mine = ctl;
        const btn = $('wGenerate');
        btn.disabled = true;
        showWarnings([]);
        $('wRaw').textContent = '';
        const t0 = performance.now();
        status.textContent = `Writing with ${model}${req.images.length ? ' (' + req.images.length + ' picture' + (req.images.length > 1 ? 's' : '') + ')' : ''}...`;
        try {
            const [raw, seenCount] = await call(req, mine.signal);
            $('wRaw').textContent = raw;
            const out = req.finish ? req.finish(raw, seenCount)
                : finish(req, parseSegments(raw, req.segments, req.target === 'tags'), seenCount);
            $('wResult').value = out.prompt;
            $('wNegative').value = out.negative;
            updateCount();
            showWarnings(out.warnings);
            const secs = ((performance.now() - t0) / 1000).toFixed(1);
            const ruleNote = req.rules.length ? ' · rules: ' + req.rules.map(r => RULE_LABELS[r]).join(', ') : '';
            status.textContent = `Done in ${secs}s · ${req.note ? req.note + ' · ' : ''}${titleCase(req.creativity)} · Detail ${req.detail}${ruleNote}`;
        } catch (e) {
            if (e.name === 'AbortError') { if (ctl === mine) status.textContent = 'Cancelled.'; return; }
            if (e.raw) $('wRaw').textContent = e.raw;
            status.textContent = 'Error: ' + (e.message || e);
            showWarnings([e.message || String(e)]);
            if (e.raw) $('wRawBox').open = true;
        } finally {
            if (ctl === mine) { btn.disabled = false; ctl = null; }
        }
    }

    $('wGenerate').onclick = run;
    $('wIdea').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
    $('wCancel').onclick = () => { if (ctl) ctl.abort(); };
    $('wUnload').onclick = async () => {
        const model = $('oModel').value;
        if (!model) return;
        try {
            await fetch(base() + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, keep_alive: 0 }) });
            $('wStatus').textContent = model + ' unloaded from memory.';
        } catch (e) { $('wStatus').textContent = 'Unload failed: ' + (e.message || e); }
    };
    $('wClear').onclick = () => {
        if (ctl) ctl.abort();
        $('wIdea').value = ''; lsSet('idea', '');
        $('wResult').value = ''; $('wNegative').value = ''; $('wRaw').textContent = '';
        briefs = []; renderShotBriefs();
        pics = []; renderPics();
        showWarnings([]); updateCount();
    };
    function copy(id, what) {
        const v = $(id).value;
        if (!v) return;
        navigator.clipboard.writeText(v).then(() => window.showAlert(what + ' copied.', 'success'),
            () => { $(id).select(); document.execCommand('copy'); window.showAlert(what + ' copied.', 'success'); });
    }
    $('wCopy').onclick = () => copy('wResult', 'Prompt');
    $('wCopyNeg').onclick = () => copy('wNegative', 'Negative');
    $('wToIdea').onclick = () => {
        if (!$('wResult').value) return;
        $('wIdea').value = $('wResult').value; lsSet('idea', $('wIdea').value);
    };

    // ---------------------------------------------------------------- init
    syncTarget();
    renderShotBriefs();
    syncNeg();
    let startSub = 'translate';
    try { startSub = localStorage.getItem('ph_ollama_sub') || 'translate'; } catch (e) {}
    showSub(document.getElementById('oSub-' + startSub) ? startSub : 'translate');

    // exposed for testing / other modules
    window.PromptWriter = { findRules, parseSegments, cleanTags, buildRequest, finish };
})();
