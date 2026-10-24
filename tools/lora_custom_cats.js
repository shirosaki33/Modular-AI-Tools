/**
 * tools/lora_custom_cats.js — categorias customizadas do Lora Evaluate.
 *
 * Mesmo fluxo do gallery_merge_groups.js: modo de seleção (checkboxes na grade) →
 * popup com confirmar → lista "Manage" recolhida, com ✖ para excluir.
 * Nenhum arquivo é movido/renomeado/apagado: as categorias vivem só no IndexedDB
 * deste navegador (store 'kv', chave 'customCats').
 *
 * Depende (do Lora Evaluate.html): items, view, cur, cat, hidden, savePrefs(), idbOp(), render().
 * Ganchos que o HTML chama: ccKeys(), ccHas(it,nome), ccAfter(), ccClick(card,evento).
 * Dentro do app a categoria aparece como "c:Nome" (prefixo evita colisão com as nativas).
 */
(function () {
    const $ = id => document.getElementById(id);
    const esc = s => window.escHtml(s ?? '');

    const cats = new Map();      // nome -> Set(ids: it.key e/ou it._hash)
    const selected = new Set();  // it.key dos LoRAs marcados (sobrevive à troca de página)
    let on = false, listOpen = false;

    /* ---------- estilo ---------- */
    const style = document.createElement('style');
    style.textContent = `
        #cc-btn.active{border-color:#00ff99;color:#00ff99}
        .cc-cb{position:absolute;top:38px;left:8px;width:20px;height:20px;accent-color:#00ff99;z-index:2;cursor:pointer}
        .card.cc-sel{border-color:#00ff99;box-shadow:0 0 0 1px #00ff99}
        #cc-pop{display:none;position:fixed;width:300px;z-index:1200;background:#111827;border:1px solid #263b5a;border-radius:10px;padding:14px;box-shadow:0 8px 24px rgba(0,0,0,.85);flex-direction:column;gap:10px}
        #cc-pop.open{display:flex}
        .cc-t{color:#9ecfff;font-size:12px;font-weight:700;border-bottom:1px solid #1e2d40;padding-bottom:8px}
        .cc-h{color:#888;font-size:11px;line-height:1.45}
        .cc-r{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:12px;color:#ccc}
        .cc-s{padding:4px 8px;font-size:11px}
        #cc-list{display:none;flex-direction:column;gap:6px;max-height:220px;overflow:auto}
        .cc-row{display:flex;align-items:center;gap:6px;background:#0d0d0d;border:1px solid #262626;border-radius:6px;padding:6px 8px;font-size:11px;color:#ccc}
        .cc-row span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .cc-x{padding:1px 6px;font-size:12px;border:0;background:none;color:#ff6060}
        .cc-x[data-rm]{color:#ffd84d}`;
    document.head.appendChild(style);

    /* ---------- UI ---------- */
    const bar = $('bar');
    const btn = document.createElement('button');
    btn.id = 'cc-btn'; btn.textContent = '🗂 Categories'; btn.title = 'Create custom categories from selected LoRAs';
    bar.insertBefore(btn, bar.lastElementChild);

    const pop = document.createElement('div');
    pop.id = 'cc-pop';
    pop.innerHTML = `
        <div class="cc-t">🗂 Custom categories</div>
        <div class="cc-h">Check LoRAs in the grid (the selection is kept across pages), name a category and confirm. An existing name adds to it.</div>
        <div class="cc-r"><span id="cc-count">0 selected</span><span><button class="cc-s" id="cc-page">Select page</button> <button class="cc-s" id="cc-clear">Clear</button></span></div>
        <input type="text" id="cc-name" list="cc-names" placeholder="Category name…" maxlength="40"><datalist id="cc-names"></datalist>
        <div class="cc-r"><button class="pri" id="cc-ok" style="flex:1">Create / add</button><button id="cc-cancel">Cancel</button></div>
        <button class="cc-s" id="cc-manage"></button>
        <div id="cc-list"></div>`;
    document.body.appendChild(pop);

    const flash = m => {
        const fr = $('fr'); fr.textContent = m;
        setTimeout(() => { if (fr.textContent === m) fr.textContent = ''; }, 4000);
    };
    const findItem = k => items.find(x => x.key === k);
    const has = (it, name) => { const s = cats.get(name); return !!s && (s.has(it.key) || (!!it._hash && s.has(it._hash))); };
    const count = name => items.filter(i => has(i, name)).length;

    function persist() {
        idbOp('kv', s => s.put([...cats].map(([n, set]) => [n, [...set]]), 'customCats'), 1).catch(() => {});
    }
    async function load() {
        try {
            const a = await idbOp('kv', s => s.get('customCats'));
            cats.clear();
            (a || []).forEach(([n, ids]) => cats.set(n, new Set(ids)));
        } catch { }
        if (typeof render === 'function' && cur < 0) render();
    }

    function renderList() {
        const el = $('cc-list');
        el.style.display = listOpen ? 'flex' : 'none';
        if (!listOpen) return;
        el.innerHTML = cats.size
            ? [...cats.keys()].map(n => `<div class="cc-row"><span title="${esc(n)}">🗂 ${esc(n)} (${count(n)})</span>` +
                `<button class="cc-x" data-rm="${esc(n)}" title="Remove the selected LoRAs from this category">−</button>` +
                `<button class="cc-x" data-del="${esc(n)}" title="Delete category (LoRAs are not affected)">✖</button></div>`).join('')
            : '<div class="cc-h" style="text-align:center">No categories yet.</div>';
    }
    function upd() {
        $('cc-count').textContent = selected.size + ' selected';
        $('cc-names').innerHTML = [...cats.keys()].map(n => `<option value="${esc(n)}">`).join('');
        $('cc-manage').textContent = `📂 Manage categories (${cats.size})`;
        renderList();
    }
    function place() {
        const r = btn.getBoundingClientRect();
        pop.style.top = (r.bottom + 8) + 'px';
        pop.style.left = Math.max(8, Math.min(innerWidth - 308, r.right - 300)) + 'px';
    }

    /* ---------- ações (criar / adicionar / remover / excluir) ---------- */
    function cancel() {
        on = false; selected.clear(); listOpen = false;
        pop.classList.remove('open'); btn.classList.remove('active');
        $('cc-name').value = '';
        if (cur < 0) render();
    }
    function confirm() {
        const raw = $('cc-name').value.trim().replace(/\s+/g, ' ');
        if (!raw) return flash('Type a category name.');
        if (!selected.size) return flash('Select at least 1 LoRA.');
        const name = [...cats.keys()].find(n => n.toLowerCase() === raw.toLowerCase()) || raw;
        const set = cats.get(name) || new Set();
        selected.forEach(k => { const it = findItem(k); set.add(k); if (it && it._hash) set.add(it._hash); });
        cats.set(name, set);
        persist();
        const n = selected.size;
        cancel();
        flash(`🗂 ${n} LoRA${n === 1 ? '' : 's'} added to "${name}".`);
    }
    function removeSelected(name) {
        const set = cats.get(name);
        if (!set) return;
        if (!selected.size) return flash('Select LoRAs first.');
        selected.forEach(k => { const it = findItem(k); set.delete(k); if (it && it._hash) set.delete(it._hash); });
        persist(); upd(); render();
        flash(`Selected LoRAs removed from "${name}".`);
    }
    function remove(name) {
        cats.delete(name);
        hidden.delete('c:' + name);
        if (cat === 'c:' + name) cat = 'All';
        savePrefs(); persist(); upd(); render();
        flash(`Category "${name}" deleted (LoRAs untouched).`);
    }

    btn.onclick = () => {
        if (cur >= 0) return flash('Go back to the grid to select LoRAs.');
        if (on) return cancel();
        on = true; selected.clear();
        btn.classList.add('active'); place(); pop.classList.add('open');
        upd(); render();
    };
    $('cc-ok').onclick = confirm;
    $('cc-cancel').onclick = cancel;
    $('cc-clear').onclick = () => { selected.clear(); upd(); render(); };
    $('cc-page').onclick = () => { view.forEach(it => selected.add(it.key)); upd(); render(); };
    $('cc-manage').onclick = () => { listOpen = !listOpen; renderList(); };
    $('cc-name').onkeydown = e => { if (e.key === 'Enter') confirm(); };
    $('cc-list').onclick = e => {
        const d = e.target.closest('[data-del]'), r = e.target.closest('[data-rm]');
        if (d) remove(d.dataset.del); else if (r) removeSelected(r.dataset.rm);
    };
    addEventListener('keydown', e => { if (on && e.key === 'Escape') cancel(); });
    addEventListener('resize', () => on && place());

    /* ---------- ganchos chamados pelo Lora Evaluate.html ---------- */
    window.ccKeys = () => [...cats.keys()].map(n => 'c:' + n);
    window.ccHas = (it, name) => has(it, name);
    window.ccAfter = () => {                       // chamado no fim de render()
        if (!on) return;
        document.querySelectorAll('#grid .card').forEach(c => {
            const sel = selected.has(c.dataset.k);
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.className = 'cc-cb'; cb.checked = sel;
            c.appendChild(cb); c.classList.toggle('cc-sel', sel);
        });
    };
    window.ccClick = (card, e) => {                // true = clique consumido (não abre o detalhe)
        if (!on) return false;
        const k = card.dataset.k, cb = card.querySelector('.cc-cb');
        const want = e.target === cb ? cb.checked : !selected.has(k);
        want ? selected.add(k) : selected.delete(k);
        if (cb) cb.checked = want;
        card.classList.toggle('cc-sel', want);
        $('cc-count').textContent = selected.size + ' selected';
        return true;
    };

    load();
})();