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
