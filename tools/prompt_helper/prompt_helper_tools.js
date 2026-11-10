/* ===== merged from prompt_helper_tools.js ===== */
/* =========================================================================
   PROMPT HELPER — SHARED UI HELPERS (right panel)
   Tab switching, persisted select/checkbox helpers and debounce.
   Must load BEFORE prompt_helper_google.js / prompt_helper_ollama.js
   (and any future tab module, e.g. Florence-2).
========================================================================= */

// ---------- Tabs ----------
// Any tab module can hook in with: window.onPromptHelperTab['name'] = () => {...}
window.onPromptHelperTab = window.onPromptHelperTab || {};

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        const hook = window.onPromptHelperTab[btn.dataset.tab];
        if (typeof hook === 'function') hook();
    };
});

// ---------- Storage (private mode / blocked storage must not break the page) ----------
function _phGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _phSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

// ---------- Persisted language choices ----------
function bindPersist(id, key, fallback) {
    const el = document.getElementById(id);
    if (!el) return;
    const saved = _phGet('ph_' + key);
    if (saved && Array.from(el.options || []).some(o => o.value === saved)) el.value = saved;
    else if (fallback) el.value = fallback;
    el.addEventListener('change', () => _phSet('ph_' + key, el.value));
}

// ---------- Persisted checkboxes ----------
function bindPersistCheckbox(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const saved = _phGet('ph_' + id);
    if (saved !== null) el.checked = saved === '1';
    el.addEventListener('change', () => _phSet('ph_' + id, el.checked ? '1' : '0'));
}

// ---------- Debounce ----------
function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

/* ===== merged from prompt_helper_tools.js ===== */
/* =========================================================================
   PROMPT HELPER — GOOGLE TRANSLATE TAB
   Depends on: prompt_helper_settings.js (showAlert), prompt_helper_ui.js
               (bindPersist, bindPersistCheckbox, debounce)
========================================================================= */

bindPersist('gFrom', 'g_from', 'pt');
bindPersist('gTo', 'g_to', 'en');
['gFix', 'gLive'].forEach(bindPersistCheckbox);

// dt=qca asks Google for a spelling suggestion (response index 7) in the source language.
async function googleCall(text, from, to) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&dt=qca&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let translation = '';
    if (data && data[0]) data[0].forEach(part => { if (part[0]) translation += part[0]; });
    let corrected = '';
    if (data && Array.isArray(data[7]) && typeof data[7][1] === 'string') corrected = data[7][1].trim();
    const detected = (data && typeof data[2] === 'string') ? data[2] : '';
    return { translation, corrected, detected };
}

const LANG_NAMES = { en: 'English', pt: 'Portuguese', es: 'Spanish', ja: 'Japanese', 'zh-CN': 'Chinese', zh: 'Chinese', ko: 'Korean', fr: 'French', de: 'German', ru: 'Russian', it: 'Italian' };
let gSeq = 0, gLastKey = '';

// live=true: called while typing (silent, never touches the source box, skips unchanged input)
async function runGoogle(fixOnly, live) {
    const srcEl = document.getElementById('gSource');
    const resEl = document.getElementById('gResult');
    const status = document.getElementById('gStatus');
    const text = srcEl.value.trim();
    if (!text) {
        if (live) { gSeq++; gLastKey = ''; resEl.value = ''; status.textContent = ''; }
        else window.showAlert('Type something first.', 'warn');
        return;
    }
    const from = document.getElementById('gFrom').value;
    const to = document.getElementById('gTo').value;
    const wantFix = fixOnly || document.getElementById('gFix').checked;
    const key = [text, from, to, wantFix, fixOnly].join('\u0001');
    if (live && key === gLastKey) return;
    const seq = ++gSeq;
    const btns = ['gTranslateBtn', 'gTranslateTop', 'gFixBtn'].map(id => document.getElementById(id));
    if (!live) btns.forEach(b => b.disabled = true);
    status.textContent = fixOnly ? 'Fixing...' : 'Translating...';
    try {
        let src = from, probe = null, working = text, note = '';
        if (from === 'auto') {
            probe = await googleCall(text, 'auto', to);
            if (seq !== gSeq) return;
            src = probe.detected || 'en';
        }
        if (wantFix) {
            const fx = await googleCall(text, src, src);
            if (seq !== gSeq) return;
            if (fx.corrected && fx.corrected !== text) { working = fx.corrected; note = 'Vocabulary fixed. '; }
            else note = 'No corrections suggested. ';
        }
        const detNote = from === 'auto' ? `Detected: ${LANG_NAMES[src] || src}. ` : '';
        if (fixOnly || src === to) {
            resEl.value = working;
            status.textContent = detNote + note + (src === to && !fixOnly ? 'Already in the target language, nothing to translate.' : 'Done.');
            gLastKey = key;
            return;
        }
        let tr = (probe && working === text) ? probe : await googleCall(working, src, to);
        if (seq !== gSeq) return;
        resEl.value = tr.translation;
        if (working !== text) {
            if (live) note += `Corrected: "${working}". `;
            else srcEl.value = working;
        }
        status.textContent = detNote + note + 'Done.';
        gLastKey = key;
    } catch (e) {
        if (seq !== gSeq) return;
        status.textContent = 'Error: ' + (e.message || e);
        if (!live) window.showAlert('Google Translate failed.', 'error');
    } finally {
        btns.forEach(b => b.disabled = false);
    }
}

document.getElementById('gTranslateBtn').onclick = () => runGoogle(false);
document.getElementById('gTranslateTop').onclick = () => runGoogle(false);
document.getElementById('gFixBtn').onclick = () => runGoogle(true);
document.getElementById('gSource').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runGoogle(false); }
});

document.getElementById('gClearBtn').onclick = () => {
    document.getElementById('gSource').value = '';
    document.getElementById('gResult').value = '';
    document.getElementById('gStatus').textContent = '';
    gSeq++; gLastKey = '';
};

document.getElementById('gSwap').onclick = () => {
    const from = document.getElementById('gFrom');
    const to = document.getElementById('gTo');
    // "Detect language" não existe no destino: troca pelo idioma detectado (ou avisa).
    let fromVal = from.value;
    if (fromVal === 'auto') {
        const m = (document.getElementById('gStatus').textContent || '').match(/Detected: ([^.]+)\./);
        const code = m && Object.keys(LANG_NAMES).find(k => LANG_NAMES[k] === m[1] && to.querySelector(`option[value="${k}"]`));
        if (!code) { window.showAlert('Pick the source language first ("Detect language" cannot be a target).', 'warn'); return; }
        fromVal = code;
    }
    from.value = to.value; to.value = fromVal;
    from.dispatchEvent(new Event('change')); to.dispatchEvent(new Event('change'));
    const s = document.getElementById('gSource');
    const r = document.getElementById('gResult');
    const t = s.value; s.value = r.value; r.value = t;
};

// ---------- Live translate (debounced while typing) ----------
const gLiveRun = debounce(() => { if (document.getElementById('gLive').checked) runGoogle(false, true); }, 700);
document.getElementById('gSource').addEventListener('input', gLiveRun);
['gFrom', 'gTo', 'gFix', 'gLive'].forEach(id => document.getElementById(id).addEventListener('change', gLiveRun));

/* ===== merged from prompt_helper_tools.js ===== */
/* =========================================================================
   PROMPT HELPER — OLLAMA TRANSLATE TAB
   Depends on: prompt_helper_settings.js (showAlert), prompt_helper_ui.js
               (bindPersist, bindPersistCheckbox, debounce, onPromptHelperTab)
========================================================================= */

bindPersist('oFrom', 'o_from', 'Portuguese');
bindPersist('oTo', 'o_to', 'English');
['oFix', 'oLive'].forEach(bindPersistCheckbox);

async function refreshOllamaModels() {
    const url = (document.getElementById('oUrl').value || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const sel = document.getElementById('oModel');
    const status = document.getElementById('oStatus');
    status.textContent = 'Fetching models...';
    try {
        const res = await fetch(url + '/api/tags');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const models = (data.models || []).map(m => m.name).sort();
        sel.innerHTML = '';
        if (models.length === 0) {
            sel.innerHTML = '<option value="">No models found</option>';
            status.textContent = 'No models installed. Use: ollama pull llama3.2';
            return;
        }
        models.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
        status.textContent = models.length + ' model(s) found.';
        const last = localStorage.getItem('ph_ollama_model');
        if (last && models.includes(last)) sel.value = last;
    } catch (e) {
        sel.innerHTML = '<option value="">-- connection failed --</option>';
        status.textContent = 'Could not reach Ollama. Is it running? (' + (e.message || e) + ')';
    }
}

document.getElementById('oRefreshModels').onclick = refreshOllamaModels;
document.getElementById('oModel').onchange = () => {
    localStorage.setItem('ph_ollama_model', document.getElementById('oModel').value);
};

async function ollamaGenerate(base, body, signal) {
    const res = await fetch(base + '/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + (errText ? ': ' + errText.slice(0, 120) : ''));
    }
    const data = await res.json();
    return (data.response || '').trim();
}

function parseJsonLoose(raw) {
    try { return JSON.parse(raw); } catch (e) {}
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
    return null;
}

let oCtl = null, oLastKey = '';

// live=true: called while typing (cancels the previous request, never touches the source box)
async function runOllama(fixOnly, live) {
    // Prompt Enhancer with "Translate" off: the main action enhances, live typing does nothing
    if (!fixOnly && window.PromptEnhancer && !window.PromptEnhancer.translateOn()) {
        if (!live) window.PromptEnhancer.enhanceOnly();
        return;
    }
    const srcEl = document.getElementById('oSource');
    const resEl = document.getElementById('oResult');
    const status = document.getElementById('oStatus');
    const text = srcEl.value.trim();
    if (!text) {
        if (live) { if (oCtl) oCtl.abort(); oLastKey = ''; resEl.value = ''; }
        else window.showAlert('Type something first.', 'warn');
        return;
    }
    const model = document.getElementById('oModel').value;
    if (!model) {
        if (live) status.textContent = 'Select a model (click 🔄) to translate live.';
        else window.showAlert('Select a model first (click 🔄).', 'warn');
        return;
    }
    const base = (document.getElementById('oUrl').value || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const from = document.getElementById('oFrom').value;
    const to = document.getElementById('oTo').value;
    const fromDesc = from === 'auto' ? 'an unknown language (detect it yourself)' : from;
    const wantFix = fixOnly || document.getElementById('oFix').checked;
    const justFix = fixOnly || (from !== 'auto' && from === to);
    const key = [text, model, from, to, wantFix, fixOnly].join('\u0001');
    if (live && key === oLastKey) return;

    if (oCtl) oCtl.abort();
    oCtl = new AbortController();
    const signal = oCtl.signal;
    const btns = ['oTranslateBtn', 'oTranslateTop', 'oFixBtn', 'oEnhBtn'].map(id => document.getElementById(id));
    if (!live) { btns.forEach(b => b.disabled = true); resEl.value = ''; }
    status.textContent = 'Generating with ' + model + '...';

    try {
        if (justFix) {
            const prompt = `You are a proofreader. The text below is written in ${fromDesc}. Fix spelling, typos, misused or wrong vocabulary and grammar. Keep the meaning, tone and the original language. Do NOT translate. Output ONLY the corrected text, nothing else.\n\n${text}`;
            resEl.value = await ollamaGenerate(base, { model, prompt, stream: false, options: { temperature: 0.1 } }, signal);
            status.textContent = 'Fixed in the original language. Done.';
        } else if (wantFix) {
            const prompt = `The text below is written in ${fromDesc} and may contain typos or wrong vocabulary.\n1) Correct it in its own language.\n2) Translate the corrected text into ${to}.\nReply ONLY with JSON in this exact shape: {"corrected":"<corrected text in the source language>","translation":"<${to} translation>"}\n\nText:\n${text}`;
            const raw = await ollamaGenerate(base, { model, prompt, stream: false, format: 'json', options: { temperature: 0.1 } }, signal);
            const obj = parseJsonLoose(raw);
            if (obj && typeof obj.translation === 'string') {
                resEl.value = obj.translation.trim();
                const corrected = typeof obj.corrected === 'string' ? obj.corrected.trim() : '';
                if (corrected && corrected !== text) {
                    if (live) status.textContent = `Corrected: "${corrected}". Done.`;
                    else { srcEl.value = corrected; status.textContent = 'Vocabulary fixed in source. Done.'; }
                } else status.textContent = 'No corrections needed. Done.';
            } else {
                resEl.value = raw; // model ignored the JSON format: show whatever it returned
                status.textContent = 'Model did not return JSON, showing raw output.';
            }
        } else {
            const prompt = `Translate the following text from ${fromDesc} to ${to}. Output ONLY the translation, nothing else.\n\n${text}`;
            resEl.value = await ollamaGenerate(base, { model, prompt, stream: false, options: { temperature: 0.2 } }, signal);
            status.textContent = 'Done.';
        }
        oLastKey = key;
        // Optional Prompt Enhancer step: only after a manual Translate, never while live-typing
        if (!live && !justFix && window.PromptEnhancer && window.PromptEnhancer.auto()) {
            await window.PromptEnhancer.afterTranslate(signal);
        }
    } catch (e) {
        if (e.name === 'AbortError') return; // replaced by a newer request
        status.textContent = 'Error: ' + (e.message || e);
        if (!live) window.showAlert('Ollama request failed. Check URL / model / CORS.', 'error');
    } finally {
        // Só a requisição mais recente libera os botões (uma antiga cancelada não).
        if (oCtl && oCtl.signal === signal) btns.forEach(b => b.disabled = false);
    }
}

document.getElementById('oTranslateBtn').onclick = () => runOllama(false);
document.getElementById('oTranslateTop').onclick = () => runOllama(false);
document.getElementById('oFixBtn').onclick = () => runOllama(true);
document.getElementById('oSource').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runOllama(false); }
});

document.getElementById('oSwap').onclick = () => {
    const from = document.getElementById('oFrom');
    const to = document.getElementById('oTo');
    // "Detect language" não existe na lista de destino.
    if (from.value === 'auto') { window.showAlert('Pick the source language first ("Detect language" cannot be a target).', 'warn'); return; }
    const tmp = from.value; from.value = to.value; to.value = tmp;
    from.dispatchEvent(new Event('change')); to.dispatchEvent(new Event('change'));
    const s = document.getElementById('oSource');
    const r = document.getElementById('oResult');
    const t = s.value; s.value = r.value; r.value = t;
};

document.getElementById('oClearBtn').onclick = () => {
    document.getElementById('oSource').value = '';
    document.getElementById('oResult').value = '';
    if (oCtl) oCtl.abort();
    oLastKey = '';
};

// ---------- Live translate (debounced while typing) ----------
const oLiveRun = debounce(() => { if (document.getElementById('oLive').checked) runOllama(false, true); }, 1200);
document.getElementById('oSource').addEventListener('input', oLiveRun);
['oFrom', 'oTo', 'oFix', 'oLive', 'oModel'].forEach(id => document.getElementById(id).addEventListener('change', oLiveRun));

// ---------- Load models the first time the tab is opened ----------
let ollamaModelsLoaded = false;
window.onPromptHelperTab['ollama'] = () => {
    if (!ollamaModelsLoaded) {
        ollamaModelsLoaded = true;
        refreshOllamaModels();
    }
};

const savedUrl = localStorage.getItem('ph_ollama_url');
if (savedUrl) document.getElementById('oUrl').value = savedUrl;
document.getElementById('oUrl').addEventListener('change', () => {
    localStorage.setItem('ph_ollama_url', document.getElementById('oUrl').value);
});

/* ===== merged from prompt_helper_tools.js ===== */
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
