/* =========================================================================
   PROMPT HELPER — WRITER PRESET: MiniMax H3
   Depends on: prompt_helper_h3_bundle.js (window.H3_FORGE)
   Registers itself in window.WriterPresets; prompt_helper_writer.js lists
   every registered preset in its "Preset" dropdown (Off = plain prompt).

   A port of the Shiro Video Director's WRITER (shiro_videodirector/writer.py
   + dasiwa.py), i.e. DaSiWa's Prompt Forge writer, without the timeline:
     mode        Auto from the pictures (first/last frame -> I2VA / L2VA /
                 FL2VA, other references -> REF2VA, none -> T2VA) or picked
     system      the mode's system prompt from the bundle (REF2VA = the full
                 contract: the writer also writes the cast)
     user        Brief, Settings, canvas, Shots, Transitions, Creativity rule,
                 Detail rule scaled to the clip and split per shot, the frame
                 pictures' times, rules, language, pictures
     answer      ===SEGMENT: Name=== blocks, <think> dropped, official field
                 names accepted, Refused / missing / runaway reported
     after       rules enforced (no speech / no music / no sound), cut times
                 past the clip or out of order moved, the H3 prompt assembled
                 (alignment line + sections), warnings: cut times, 7,000
                 characters, shot count, unrequested music
     sampling    the Creativity preset's temperature / top_p; num_ctx 16,384
                 + 1,820 per picture, rounded up to 256
========================================================================= */
(function () {
    'use strict';

    const B = () => {
        if (!window.H3_FORGE) throw new Error('tools/prompt_helper_h3_bundle.js is missing.');
        return window.H3_FORGE;
    };
    const fmtG = x => String(+(+x).toPrecision(6));
    const titleCase = v => String(v).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // ---------------------------------------------------------------- plan.py bits
    const FPS = 24;
    const SOUNDSCAPE_PLACEHOLDER = 'ambience that fits the scene';
    const LOCK = {
        lock_camera: 'The camera holds a static shot throughout: no pan, tilt, truck, pedestal, arc, tracking, orbit or handheld movement.',
        lock_zoom: 'No zoom throughout: no zoom in or out and no push-in or pull-out; the framing distance stays the same.',
        lock_light: 'The lighting and the time of day stay exactly as in the opening frame throughout: no change in light direction, brightness, colour temperature, shadows, sky, weather or time of day.',
        lock_background: 'The background and the setting stay exactly as in the opening frame throughout: the same place, the same objects and scenery in the same positions; no new location and no change of scene.'
    };
    // writer.py TRIGGERS sentences (the lock ones come from plan.LOCK_*)
    const RULE_SENTENCES = [
        ['no_speech', 'No one speaks: write no spoken lines, no <d> tags, no voice-over and no narration.'],
        ['no_music', 'No music: the Music segment is exactly N/A.'],
        ['no_sound', 'A silent video: the Soundscape and the Music segments are exactly N/A, and no one speaks.'],
        ['one_shot', 'One continuous shot: no cuts and no later timestamps.']
    ];

    function alignFrameCount(n) { n = Math.max(1, n); while (n % 17 !== 5) n++; return n; }
    function clip(seconds) {
        const frames = alignFrameCount(Math.round(Math.max(0.2, +seconds || 5) * FPS));
        return { frames, seconds: frames / FPS };
    }
    function alignmentInstruction(hasFirst, hasLast, shotCount, seconds) {
        const n = Math.max(1, shotCount | 0);
        const s = (Math.floor(Math.round(Math.max(0, seconds) * 10000) / 100) / 100).toFixed(2);
        if (hasFirst && hasLast) return 'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ' + n + ') aligns with the ' + s + '-second mark of the target video.';
        if (hasFirst) return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
        if (hasLast) return 'How the reference pictures align with the target video — <Picture 1> (from [Shot ' + n + ']) aligns with the ' + s + '-second mark of the target video.';
        return '';
    }
    function stamp(seconds) {
        const t = Math.floor(seconds * 1000 + 0.5) / 1000;
        const m = Math.floor(t / 60), s = t - m * 60;
        return String(m).padStart(2, '0') + ':' + s.toFixed(3).padStart(6, '0');
    }

    // ---------------------------------------------------------------- dasiwa.py: settings
    const LADDER_SECONDS = 10, MAX_DESCRIPTION_WORDS = 800;
    const WORD_RANGE = /(\d+)-(\d+) words/;

    function outputCanvasContext(canvas) {
        if (!canvas) return 'Director output canvas is unknown (possibly externally overridden). Omit aspect ratio and resolution; do not infer them from references, examples or the brief.';
        const gcd = (a, b) => b ? gcd(b, a % b) : a;
        const d = gcd(canvas.width, canvas.height) || 1;
        return `Director output canvas: ${canvas.width}x${canvas.height} pixels; aspect ratio ${canvas.width / d}:${canvas.height / d}. These dimensions are authoritative, including over conflicting format requests in the brief. Use this aspect ratio only; reference-image dimensions and example formats are not the output canvas.`;
    }
    function scaleDetailRule(rule, duration) {
        const factor = (+duration) / LADDER_SECONDS;
        if (!(factor > 0) || Math.abs(factor - 1) < 0.05) return rule;
        const out = rule.replace(WORD_RANGE, (m, a, b) => {
            const lo = Math.max(10, Math.round(+a * factor / 5) * 5);
            let hi = Math.max(10, Math.round(+b * factor / 5) * 5);
            hi = Math.min(Math.max(hi, lo + 10), MAX_DESCRIPTION_WORDS);
            return `${Math.min(lo, hi - 10)}-${hi} words`;
        });
        return out.replace(", the reference guide's own range", ` for this ${fmtG(duration)}-second clip`);
    }
    function detailShare(rule, n) {
        const f = WORD_RANGE.exec(String(rule || ''));
        if (!f || !n || n < 2) return '';
        return ` With ${n} shots that is about ${Math.round(+f[1] / n)}-${Math.round(+f[2] / n)} words in each shot: every shot gets its full share, the last as much as the first.`;
    }
    function shotsLine(n) {
        if (!n) return null;
        const override = 'This overrides any shot count in the detail level, the idea or the guide\'s examples.';
        if (n === 1) return `Shots: 1 — one continuous shot. Write only [Shot 1]: no cuts and no later timestamps. ${override}`;
        return `Shots: ${n} — exactly ${n} shots, [Shot 1] to [Shot ${n}], no more and no fewer. ${override}`;
    }
    const TRANSITION_TYPES = {
        smooth: 'Make every cut flow: open each later shot by saying how it follows from the shot before - a match cut on a movement or a shape, the action carrying across the cut, an eyeline, a sound or the light leading into it - so the shots read as one continuous scene, never as separate clips.',
        dissolve: 'Join the shots with soft transitions: each later shot opens with a short cross-dissolve from the shot before (a fade through black or white only where the mood turns), named right after its cut time.',
        camera: 'Join the shots with camera transitions: a whip pan, a fast push through an object or a foreground wipe, or a camera move that carries straight into the next shot, named right after its cut time.'
    };
    const TRANSITION_AUTO = 'Where it helps the scene, join a shot to the one before with a transition of your choice - a match cut, the action or a sound carrying across, a dissolve, a camera move into the next shot - named right after its cut time; a plain cut is fine elsewhere. You decide where and which.';
    const TRANSITION_OFF = 'Join the shots with clean, plain cuts: no dissolves, fades, wipes or transition moves.';
    function transitionsLine(value, n) {
        if (n === 1) return null;
        const text = value === 'off' ? TRANSITION_OFF : TRANSITION_TYPES[value] || TRANSITION_AUTO;
        return 'Transitions: ' + text + ' The cut times stay where they are.';
    }
    function settingsLines(bundle, mode, duration, detail, creativity, canvas, n, carriesImage, transitions) {
        const settings = [`Creativity: ${titleCase(creativity)}`, `Mode: ${mode}`];
        if (duration) settings.push(`Duration: ${fmtG(duration)} sec`);
        const lines = [`Settings (context for how to write, never text to include): ${settings.join(' · ')}`, outputCanvasContext(canvas)];
        if (shotsLine(n)) lines.push(shotsLine(n));
        const trans = transitionsLine(transitions, n);
        if (trans) lines.push(trans);
        const preset = bundle.creativity_presets[creativity];
        if (preset && preset.rule) {
            lines.push(`Creativity - ${titleCase(creativity)}. ${preset.rule}`);
            if (carriesImage) lines.push('A reference picture is attached. What it supplies, in the role it was given, stays exactly as the picture shows it at every Creativity setting. Creativity decides only what happens - the action, the camera, the cuts and the sound - never what is already in the picture.');
        }
        const table = bundle.detail_levels;
        const level = table[String(detail)] ? String(detail) : String(bundle.default_detail);
        const entry = table[level];
        if (entry && entry.rule) {
            const rule = scaleDetailRule(entry.rule, duration);
            lines.push(`Detail level ${level} of ${Object.keys(table).length} - ${entry.label || level}. ${rule}${detailShare(rule, n)}`);
        }
        return lines;
    }

    // ---------------------------------------------------------------- dasiwa.py: the answer
    const OFFICIAL = { 'Soundscape': 'overall_soundscape', 'Music': 'non_diegetic_music',
        'Detailed description': 'integrated_multimodal_description', 'Subject definitions': 'subject_definitions',
        'Summary': 'summary', 'Retention analysis': 'retention_analysis' };
    const RUNAWAY_SENTENCE = 500;
    const REFUSAL = ["i can't", 'i cannot', 'i can not', "i won't", 'i will not', "i'm not able", 'i am not able',
        "i'm unable", 'i am unable', "i'm sorry", 'i am sorry', 'sorry, but', 'as an ai', 'not able to help',
        "can't help with", 'cannot help with', "can't assist", 'cannot assist', 'against my', 'content policy',
        'guidelines', 'inappropriate', 'explicit content', 'não posso', 'não consigo ajudar', 'desculpe'];

    class WriterError extends Error { constructor(msg, raw) { super(msg); this.raw = raw || ''; } }

    function runaway(segments) {
        for (const [label, body] of Object.entries(segments)) {
            if (label === 'Subject definitions') continue;
            const longest = Math.max(0, ...String(body || '').split(/(?<=[.!?])(?:["'”’»]|<\/d>)*\s+/).map(s => s.length));
            if (longest > RUNAWAY_SENTENCE) return [label, longest];
        }
        return null;
    }
    function looksLikeRefusal(raw) {
        const t = String(raw || '').trim().toLowerCase();
        if (!t || t.length > 1500 || /===\s*SEGMENT/i.test(raw)) return false;
        return REFUSAL.some(m => t.includes(m));
    }
    function parseSegments(text, expected) {
        let raw = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        raw = raw.replace(/^\s*```[^\n]*$/gm, '');
        const matches = [...raw.matchAll(/^[ \t]*===\s*SEGMENT:\s*(.+?)\s*===[ \t]*$/gmi)];
        if (!matches.length) {
            throw new WriterError(looksLikeRefusal(raw) ? 'The model declined (its own content rules); try another model.'
                : 'The model returned no ===SEGMENT: markers - it did not follow the output format. Try a larger model.', raw);
        }
        const byField = {};
        Object.entries(OFFICIAL).forEach(([label, field]) => { byField[field] = label; });
        byField.detailed_description = 'Detailed description';
        const canon = {};
        Object.keys(OFFICIAL).concat(['Refused', 'Descriptions']).forEach(l => { canon[l.toLowerCase()] = l; });
        const segments = {};
        matches.forEach((m, i) => {
            const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
            const heading = m[1].trim().replace(/^\*+|\*+$/g, '').trim();
            let label = byField[heading] || canon[heading.toLowerCase()] || heading;
            if (label in segments) label = heading;
            segments[label] = raw.slice(m.index + m[0].length, end).replace(/^\s*={3,}\s*$/gm, '').trim();
        });
        if ('Refused' in segments) throw new WriterError('The model refused: ' + segments.Refused, raw);
        const missing = expected.filter(l => !(l in segments));
        const lost = runaway(segments);
        if (missing.length) {
            if (lost) throw new WriterError(`The model lost the thread in ${lost[0]} (one sentence ran ${lost[1].toLocaleString()} characters) and never wrote ${missing.join(', ')}. Regenerate, or pick a different model.`, raw);
            throw new WriterError('The model left out: ' + missing.join(', ') + '.', raw);
        }
        if (lost) throw new WriterError(`The model lost the thread in ${lost[0]} (one sentence ran ${lost[1].toLocaleString()} characters), so nothing was written. Regenerate, or pick a different model.`, raw);
        return segments;
    }
    function bare(body, ...names) {
        const alts = names.filter(Boolean).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const s = String(body || '');
        return alts ? s.replace(new RegExp(`^\\s*(?:${alts})\\s*:\\s*`, 'i'), '').trim() : s.trim();
    }

    const CUT = /(\[Shot\s+\d+\]\s*At\s+)(\d+):(\d+(?:\.\d+)?)/gi;
    function repairCutTimes(duration, segments) {
        const end = +duration;
        const body = segments['Detailed description'];
        if (!body || !(end > 0)) return [];
        const cuts = [...body.matchAll(CUT)].map(m => +m[2] * 60 + +m[3]);
        const fixed = cuts.slice();
        let prev = 0, i = 0;
        while (i < cuts.length) {
            if (prev < cuts[i] && cuts[i] < end) { prev = cuts[i]; i++; continue; }
            let j = i;
            while (j < cuts.length && !(prev < cuts[j] && cuts[j] < end)) j++;
            const upper = j < cuts.length ? cuts[j] : end;
            for (let k = i; k < j; k++) fixed[k] = prev + (upper - prev) * (k - i + 1) / (j - i + 1);
            prev = fixed[j - 1]; i = j;
        }
        const moved = cuts.map((a, k) => [stamp(a), stamp(fixed[k])]).filter(([a, b]) => a !== b);
        if (!moved.length) return [];
        let k = 0;
        segments['Detailed description'] = body.replace(CUT, (m, head, mm, ss) => {
            const now = fixed[k++];
            return stamp(+mm * 60 + +ss) === stamp(now) ? m : head + stamp(now);
        });
        return moved;
    }
    function checkPrompt(description, duration, prompt, limit) {
        const w = [];
        const cuts = [...String(description || '').matchAll(CUT)].map(m => +m[2] * 60 + +m[3]);
        if (duration) {
            if (cuts.length && Math.max(...cuts) >= duration) w.push(`Shots run to ${fmtG(Math.max(...cuts))}s but the clip is ${fmtG(duration)}s. Regenerate, or fix the timestamps.`);
            if ([0, ...cuts].some((a, i, arr) => i && arr[i] <= arr[i - 1])) w.push('Cut timestamps must increase strictly. Edit the draft before applying.');
        }
        if (prompt.length > limit) w.push(`${prompt.length.toLocaleString()} characters; H3 takes ${limit.toLocaleString()}. Lower Detail and regenerate.`);
        return w;
    }
    function lastShot(description) {
        const s = [...String(description || '').matchAll(/\[Shot\s+(\d+)\]/gi)].map(m => +m[1]);
        return s.length ? Math.max(...s) : 1;
    }
    function shotCountWarning(n, description) {
        if (!n || description == null) return null;
        const got = new Set([...description.matchAll(/\[Shot\s+(\d+)\]/gi)].map(m => m[1])).size;
        return got === n ? null : `You asked for ${n} shot${n === 1 ? '' : 's'} and the model wrote ${got}. Regenerate, or edit the draft.`;
    }
    function musicRequestWarning(bundle, brief, music) {
        if (!bundle.music_words || music == null || new RegExp(bundle.music_words, 'i').test(brief || '')) return null;
        if (/^\s*(?:non_diegetic_music:\s*)?N\/A\s*\.?\s*$/i.test(music || '')) return null;
        return 'The draft includes music; check that it matches your request, or tick "No music".';
    }

    const SPOKEN = /[^.!?\]]*<d>[\s\S]*?<\/d>[.!?]?/g;
    function enforceRules(segments, rules) {
        const notes = [];
        if (rules.includes('no_speech')) {
            const desc = segments['Detailed description'] || '';
            const cut = desc.match(SPOKEN) || [];
            if (cut.length) {
                segments['Detailed description'] = desc.replace(SPOKEN, '').replace(/[ \t]{2,}/g, ' ').trim();
                notes.push(`No speech: took out ${cut.length} spoken line${cut.length === 1 ? '' : 's'} the model wrote.`);
            }
        }
        if (rules.includes('no_music')) segments.Music = 'N/A';
        if (rules.includes('no_sound')) segments.Soundscape = 'N/A';
        return notes;
    }

    function assemble(mode, frames, seconds, segments) {
        const desc = bare(segments['Detailed description'], 'Detailed description', 'detailed_description', 'integrated_multimodal_description');
        const sound = bare(segments.Soundscape, 'Soundscape', 'overall_soundscape') || SOUNDSCAPE_PLACEHOLDER;
        const music = bare(segments.Music, 'Music', 'non_diegetic_music') || 'N/A';
        if (mode !== 'REF2VA') {
            const head = alignmentInstruction(frames.first, frames.last, lastShot(desc), seconds);
            const body = ['integrated_multimodal_description: ' + desc, 'overall_soundscape: ' + sound, 'non_diegetic_music: ' + music].join('\n\n');
            return head ? head + '\n\n' + body : body;
        }
        const parts = [];
        const defs = bare(segments['Subject definitions'], 'Subject definitions', 'subject_definitions');
        const summary = bare(segments.Summary, 'Summary', 'summary');
        const retention = bare(segments['Retention analysis'], 'Retention analysis', 'retention_analysis');
        if (defs && !/^\s*N\/?A\s*\.?\s*$/i.test(defs)) parts.push('subject_definitions:\n' + defs);
        if (summary) parts.push('summary: ' + summary);
        if (retention && !/^\s*N\/?A\s*\.?\s*$/i.test(retention)) parts.push('retention_analysis:\n' + retention);
        parts.push('detailed_description: ' + desc, 'overall_soundscape: ' + sound, 'non_diegetic_music: ' + music);
        return parts.join('\n\n');
    }

    // ---------------------------------------------------------------- mode / pictures
    const FRAME_ROLES = ['first', 'last'];
    const REF_ROLE_LINE = {
        subject: 'subject / appearance - who or what something looks like',
        scene: 'subject / appearance - the place: its setting, landmarks and light',
        pose: 'subject / appearance - the pose only: stance, where the arms and legs are, the gesture and which way they face; not who it is or what they wear',
        style: 'style reference - the rendering, not the content',
        describe: 'subject / appearance - everything it shows',
        first: 'keyframe - the first frame of [Shot 1] (00:00.000)',
        last: 'keyframe - the last frame of the video'
    };
    function modeOf(chosen, pictures) {
        if (chosen && chosen !== 'auto') return chosen;
        const roles = pictures.map(p => p.role);
        if (roles.some(r => !FRAME_ROLES.includes(r))) return 'REF2VA';
        const first = roles.includes('first'), last = roles.includes('last');
        return first && last ? 'FL2VA' : first ? 'I2VA' : last ? 'L2VA' : 'T2VA';
    }
    function framesOf(mode) {
        return { first: mode === 'I2VA' || mode === 'FL2VA', last: mode === 'L2VA' || mode === 'FL2VA' };
    }

    // ---------------------------------------------------------------- the preset
    function build(ctx) {
        const bundle = B();
        const mode = modeOf(ctx.mode, ctx.pictures);
        const spec = bundle.modes[mode];
        const { frames: frameCount, seconds } = clip(ctx.duration);
        const duration = Math.round(seconds * 100) / 100;
        const creativity = ctx.creativity in bundle.creativity_presets ? ctx.creativity : bundle.default_creativity;
        const detail = bundle.detail_levels[String(ctx.detail)] ? String(ctx.detail) : String(bundle.default_detail);
        const frames = framesOf(mode);
        const warnings = [];

        // which pictures go, under which label
        const labels = [], images = [], unseen = [];
        if (mode === 'REF2VA') {
            ctx.pictures.forEach((p, i) => {
                const label = `<Picture ${i + 1}>`;
                if (ctx.see) { labels.push([label, p]); images.push(p.b64); } else unseen.push(label);
            });
        } else {
            const order = [];
            if (frames.first) { const p = ctx.pictures.find(x => x.role === 'first'); if (p) order.push(p); }
            if (frames.last) { const p = ctx.pictures.find(x => x.role === 'last'); if (p) order.push(p); }
            order.forEach((p, i) => {
                const label = `<Picture ${i + 1}>`;
                if (ctx.see) { labels.push([label, p]); images.push(p.b64); } else unseen.push(label);
            });
            const left = ctx.pictures.filter(p => !order.includes(p));
            if (left.length) warnings.push(`${mode} uses only the first / last frame pictures; ${left.length} other picture${left.length > 1 ? 's were' : ' was'} not sent (subject / style pictures need REF2VA).`);
            if (frames.first && !order.some(p => p.role === 'first')) warnings.push(`${mode} starts from a first-frame picture, but none is set: the alignment line still names <Picture 1>.`);
            if (frames.last && !order.some(p => p.role === 'last')) warnings.push(`${mode} ends on a last-frame picture, but none is set.`);
        }

        let brief = ctx.brief;
        let n = ctx.shots;
        if (ctx.rules.includes('one_shot') && !n) n = 1;
        if (!brief && !images.length) throw new Error('Write an idea, or add a picture with "See pictures" on.');

        const user = [`Brief: "${brief || 'Write the video the attached pictures set up.'}"`];
        user.push(...settingsLines(bundle, mode, duration, detail, creativity, ctx.canvas, n, images.length > 0, ctx.transitions));

        if (mode === 'REF2VA') {
            if (ctx.pictures.length) {
                user.push('', 'References (every file keeps its number, in this order):');
                ctx.pictures.forEach((p, i) => user.push(`- <Picture ${i + 1}>: ${REF_ROLE_LINE[p.role] || REF_ROLE_LINE.subject}.`));
            } else {
                user.push('', 'References: none. Define the subjects from the brief alone.');
            }
        } else {
            user.push('', 'Timeline (times are in the target video):',
                `- Render window: ${seconds.toFixed(2)} s (${frameCount} frames at 24 fps).`);
            let k = 0;
            if (frames.first) user.push(`- <Picture ${++k}> is the first frame of the video (00:00.000).`);
            if (frames.last) user.push(`- <Picture ${++k}> is the last frame of the video (${stamp(seconds)}).`);
            const head = alignmentInstruction(frames.first, frames.last, n || 1, seconds);
            if (head) user.push('- Alignment (written by the app, do not repeat it): ' + head);
        }

        const ruleLines = [];
        RULE_SENTENCES.forEach(([name, s]) => { if (ctx.rules.includes(name)) ruleLines.push(s); });
        ['lock_camera', 'lock_zoom', 'lock_light', 'lock_background'].forEach(r => { if (ctx.rules.includes(r)) ruleLines.push(LOCK[r]); });
        if (ruleLines.length) user.push('', 'Rules the person set (they override the brief, the Creativity setting and the timeline):', ...ruleLines.map(x => '- ' + x));
        if (ctx.english) user.push('Write in English; translate the brief when it is in another language (never the spoken lines).');

        // dasiwa.vision_lines
        if (unseen.length) user.push(`Reference pictures ${unseen.join(', ')} are not visible. Do not invent visual attributes; use explicit text only.`);
        if (labels.length) {
            const names = labels.map(l => l[0]).join(', ');
            if (mode === 'REF2VA') user.push('', `The pictures ${names} are attached to this message, in that order, so you can see them. Use them for how each subject looks, where everyone stands, what the place holds, and the look and light of the style sentence.`);
            else if (labels.length === 1) user.push('', `The picture for ${names} is attached to this message. Look at it - the lines above say what it is FOR, the picture says what is in it.`);
            else user.push('', `The pictures for ${names} are attached to this message, in that order. Look at them - the lines above say what each one is FOR, the pictures say what is in them.`);
        }

        const preset = bundle.creativity_presets[creativity] || {};
        const numCtx = images.length ? Math.ceil(((bundle.context_length || 16384) + 1820 * images.length) / 256) * 256 : (bundle.context_length || 16384);

        return {
            preset: 'minimax', mode, creativity, detail: +detail, duration, shots: n, rules: ctx.rules, brief,
            system: spec.system, user: user.join('\n'), images,
            options: { temperature: preset.temperature, top_p: preset.top_p, num_ctx: numCtx, num_predict: -1 },
            limit: bundle.max_output_chars || 7000,
            note: `${mode} · ${frameCount} frames (${seconds.toFixed(2)} s)`,
            finish(raw, seenCount) {
                const segments = parseSegments(raw, spec.segments);
                const w = warnings.slice();
                if (images.length && !seenCount) w.push('The model did not take pictures (HTTP 4xx), so it wrote from text only. Pick a vision model, or turn "See pictures" off.');
                w.push(...enforceRules(segments, ctx.rules));
                const moved = repairCutTimes(duration, segments);
                if (moved.length) w.push(`Moved cut time${moved.length === 1 ? '' : 's'} ${moved.map(m => m.join(' -> ')).join(', ')} (they ran past the clip or out of order).`);
                const prompt = assemble(mode, frames, seconds, segments);
                const desc = segments['Detailed description'] || '';
                w.push(...checkPrompt(desc, duration, prompt, bundle.max_output_chars || 7000));
                const sc = shotCountWarning(n, desc);
                if (sc) w.push(sc);
                const mw = musicRequestWarning(bundle, brief, bare(segments.Music, 'Music', 'non_diegetic_music'));
                if (mw && !ctx.rules.includes('no_music')) w.push(mw);
                return { prompt, negative: '', warnings: w };
            }
        };
    }

    window.WriterPresets = window.WriterPresets || {};
    window.WriterPresets.minimax = {
        label: 'MiniMax H3',
        video: true,              // forces the video controls
        negative: false,          // H3 has no negative prompt
        modes: ['auto', 'T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF2VA'],
        clip, build,
        _test: { parseSegments, repairCutTimes, assemble, alignmentInstruction, stamp, scaleDetailRule, modeOf }
    };
})();
