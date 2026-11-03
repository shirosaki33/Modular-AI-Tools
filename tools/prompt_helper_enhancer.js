/* =========================================================================
   PROMPT HELPER — OLLAMA TAB: PROMPT ENHANCER (optional step)
   Depends on: prompt_helper_settings.js, prompt_helper_ui.js,
               prompt_helper_ollama.js (#oUrl / #oModel / #oSource / #oResult)

   A generalized port of the Shiro Video Director's ASSISTANT (text refinement):
   the model gets the text in a ===TEXT: prompt=== block and gives it back
   improved at one of four edit levels (text_fix / low / medium / large).
     - every @name must come back exactly as written, or the original stays
     - <think> dropped, refusal detection, "lost the thread" (runaway) check
     - a small model that answers with the text alone (no heading) is accepted
   Used two ways:
     ✨ Enhance          improves the text in the source box (same language)
     "Enhance after translating" (checkbox) runs it on the translation, after
                         a manual Translate (never while live-typing)
========================================================================= */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);

    const SYSTEM = 'You improve text prompts for image and video generation. You rewrite the text into a richer, concrete, ' +
        'visual description and keep everything you are told to keep. You answer only with the requested block.';
    const CRAFT = 'Write movement and expression as a change from one state to another (for example easing out of a smile into ' +
        'a searching look); never call a figure completely still. Never describe skin as flawless, glowing, shimmering or wet.';
    const RULES_BY_LEVEL = {
        large: [
            'Rewrite the text into a richer, concrete, visual description: the medium or style if it has one, then who or what ' +
            'is there and how they look, what they do and their expression, the place, the framing and the light. Two to six ' +
            'sentences. Keep every subject, action and setting the text names; add supporting detail, never a new story.',
            CRAFT
        ],
        medium: [
            'Edit the text lightly: keep every event, detail and the order of the writer\'s sentences, and add only what makes ' +
            'it clearer and more visual - a framing, a concrete detail of light or expression. At most about twice the ' +
            'original length.'
        ],
        low: [
            'Edit the text as little as possible: keep the writer\'s own sentences and wording, fix what is unclear or ' +
            'ambiguous, and add at most one short phrase where it clearly misses its framing. Do not add new events, objects ' +
            'or details. About the same length as the original.'
        ],
        text_fix: [
            'Only fix the writing: spelling, grammar, punctuation, capitalisation and consistent naming of the same character, ' +
            'object or place. Keep every word that is already correct, the sentence order and the length. Add nothing, remove ' +
            'nothing, do not describe more.'
        ]
    };
    const LEVEL_TEMP = { large: 0.7, medium: 0.5, low: 0.3, text_fix: 0.1 };
    const RUNAWAY_SENTENCE = 600;
    const HEADING_RE = /^[ \t]*={2,}\s*TEXT\s*:\s*(.+?)\s*={2,}[ \t]*$/gmi;
    const MENTION_RE = /@[A-Za-z0-9_]+(?:\([^)]*\))?/g;
    const LABEL_PREFIX_RE = /^\s*(?:prompt|text)\s*[:\-–]\s*/i;
    const REFUSAL = ["i can't", 'i cannot', 'i can not', "i won't", 'i will not', "i'm not able", 'i am not able',
        "i'm unable", 'i am unable', "i'm sorry", 'i am sorry', 'sorry, but', 'as an ai', 'not able to help',
        "can't help with", 'cannot help with', "can't assist", 'cannot assist', 'against my', 'content policy',
        'guidelines', 'inappropriate', 'explicit content', 'não posso', 'não consigo ajudar', 'desculpe'];

    function request(text, level, english) {
        const rules = ['Return the block below with its heading line exactly as given (===TEXT: prompt===) and nothing ' +
            'else: no introduction, no markdown, no extra headings.'];
        rules.push(...(RULES_BY_LEVEL[level] || RULES_BY_LEVEL.large));
        rules.push('Keep every @name exactly as written (for example @ref1), at the same place in the action.');
        rules.push('Keep every line of quoted speech word for word.');
        rules.push(english ? 'Write in English; translate the text when it is in another language.'
                           : 'Write in the same language as the text; do not translate.');
        return rules.join('\n') + '\n\n===TEXT: prompt===\n' + text;
    }
    function stripThink(t) {
        t = String(t || '');
        if (t.includes('</think>')) t = t.split('</think>').pop();
        else if (t.trim().startsWith('<think>')) t = '';
        return t.trim();
    }
    function looksLikeRefusal(answer) {
        const t = String(answer || '').trim().toLowerCase();
        HEADING_RE.lastIndex = 0;
        if (!t || t.length > 1500 || HEADING_RE.test(answer || '')) return false;
        return REFUSAL.some(m => t.includes(m));
    }
    function parse(answer, original) {
        const raw = stripThink(answer).replace(/^\s*```[^\n]*$/gm, '').replace(/\*\*/g, '');
        const found = [...raw.matchAll(HEADING_RE)];
        let body;
        if (found.length) {
            const m = found[0];
            const end = found.length > 1 ? found[1].index : raw.length;
            body = raw.slice(m.index + m[0].length, end).trim();
        } else {
            if (looksLikeRefusal(raw)) throw new Error('the model declined to improve this text (its own content rules); try another model');
            body = raw;   // a small model often answers with the text alone
        }
        const text = body.replace(LABEL_PREFIX_RE, '').trim().replace(/^["'“”`]+|["'“”`]+$/g, '').trim();
        if (!text) throw new Error('the model left it empty');
        if (text.includes('===')) throw new Error('the answer ran into another block');
        const longest = Math.max(0, ...text.split(/(?<=[.!?])\s+/).map(s => s.length));
        if (longest > RUNAWAY_SENTENCE) throw new Error(`the model lost the thread (one sentence ran ${longest} characters)`);
        const wanted = [...new Set(original.match(MENTION_RE) || [])];
        const got = text.match(MENTION_RE) || [];
        const missing = wanted.filter(m => !got.includes(m));
        if (missing.length) throw new Error('it dropped ' + missing.join(', ') + ' - your text was kept');
        return text;
    }

    async function enhance(text, level, english, signal) {
        const base = ($('oUrl').value || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
        const model = $('oModel').value;
        if (!model) throw new Error('select a model first (click 🔄)');
        const res = await fetch(base + '/api/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
            body: JSON.stringify({ model, system: SYSTEM, prompt: request(text, level, english), stream: false,
                think: false, keep_alive: '10m', options: { temperature: LEVEL_TEMP[level] ?? 0.7, num_predict: -1 } })
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error('Ollama HTTP ' + res.status + (t ? ': ' + t.slice(0, 160) : ''));
        }
        const data = await res.json();
        return parse((data.response || '').trim() || (data.thinking || '').trim(), text);
    }

    // ---------------------------------------------------------------- UI
    bindPersist('oEnhLevel', 'o_enh_level', 'large');
    bindPersistCheckbox('oEnhance');
    let ctl = null;

    // "✨ Enhance": the source box, in its own language, into the result box
    async function enhanceOnly() {
        const src = $('oSource').value.trim();
        const status = $('oStatus');
        if (!src) { window.showAlert('Type something first.', 'warn'); return; }
        if (ctl) ctl.abort();
        ctl = new AbortController();
        const mine = ctl;
        const btn = $('oEnhBtn');
        btn.disabled = true;
        const level = $('oEnhLevel').value;
        status.textContent = `Enhancing (${level})...`;
        try {
            $('oResult').value = await enhance(src, level, false, mine.signal);
            status.textContent = `Enhanced (${level}). Done.`;
        } catch (e) {
            if (e.name === 'AbortError') return;
            status.textContent = 'Enhance: ' + (e.message || e);
            window.showAlert('Enhance failed: ' + (e.message || e), 'error');
        } finally {
            if (ctl === mine) { btn.disabled = false; ctl = null; }
        }
    }
    $('oEnhBtn').onclick = enhanceOnly;

    // "Translate" off: straight to the enhancer. The translate-only controls are dimmed and
    // the main buttons become Enhance.
    bindPersistCheckbox('oTranslateOn');
    function syncTranslate() {
        const on = $('oTranslateOn').checked;
        const dim = el => { if (!el) return; el.style.opacity = on ? '' : '0.4'; el.style.pointerEvents = on ? '' : 'none'; };
        ['oFrom', 'oTo', 'oSwap', 'oFix', 'oLive', 'oEnhance'].forEach(id => {
            const el = $(id);
            dim(el && el.closest('label') ? el.closest('label') : el);
        });
        document.querySelectorAll('#oSub-translate .lang-row .lang-label').forEach(l => {
            if (/type in|translate to/i.test(l.textContent)) dim(l);
        });
        $('oTranslateBtn').textContent = on ? 'Translate with Ollama' : '✨ Enhance with Ollama';
        $('oTranslateTop').textContent = on ? 'Translate' : '✨ Enhance';
        $('oSource').placeholder = on ? 'Type in the language selected above... (Ctrl+Enter to translate)'
                                      : 'Type your prompt... (Ctrl+Enter to enhance, in its own language)';
    }
    $('oTranslateOn').addEventListener('change', syncTranslate);
    syncTranslate();

    window.PromptEnhancer = {
        translateOn: () => !$('oTranslateOn') || $('oTranslateOn').checked,
        enhanceOnly,
        // called by prompt_helper_ollama.js after a manual Translate
        auto: () => !!($('oEnhance') && $('oEnhance').checked),
        async afterTranslate(signal) {
            const status = $('oStatus');
            const text = $('oResult').value.trim();
            if (!text) return;
            const level = $('oEnhLevel').value;
            status.textContent = `Translated. Enhancing (${level})...`;
            try {
                $('oResult').value = await enhance(text, level, false, signal);
                status.textContent = `Translated and enhanced (${level}). Done.`;
            } catch (e) {
                if (e.name === 'AbortError') throw e;
                status.textContent = 'Translated. Enhance: ' + (e.message || e) + ' - showing the plain translation.';
            }
        },
        enhance, parse, request
    };
})();
