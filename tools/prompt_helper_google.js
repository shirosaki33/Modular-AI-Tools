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
