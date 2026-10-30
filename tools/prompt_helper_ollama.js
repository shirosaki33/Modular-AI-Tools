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
    const btns = ['oTranslateBtn', 'oTranslateTop', 'oFixBtn'].map(id => document.getElementById(id));
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
