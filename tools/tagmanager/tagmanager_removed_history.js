/* =========================================================================
   REMOVED TAGS HISTORY (🕘) — novo arquivo, standalone
   ---------------------------------------------------------------------
   Guarda um histórico das tags que SUMIRAM do All Dataset Tags (ou seja,
   deixaram de existir em qualquer imagem do dataset), seja por ×, Remove,
   Replace, conversão de alias, Auto-Do, etc.

   COMO DETECTA: depois de cada render do All Dataset Tags, compara o
   conteúdo atual de cada imagem com um snapshot da vez anterior. Uma tag
   que estava numa imagem, saiu dela e não existe mais em NENHUMA outra
   imagem entra no histórico, guardando de quais imagens ela saiu.
   Remover uma tag de UMA imagem enquanto ela ainda existe em outras NÃO
   entra (ela continua no All Dataset Tags). Ao trocar de dataset/pasta o
   snapshot é refeito sem registrar nada.

   DOIS MODOS (checkbox "Keep history after saving" dentro do popout):
   - DESMARCADO (padrão): histórico só em memória, serve apenas pra conferir
     se não removeu uma tag errada ANTES de salvar. Cada entrada some
     sozinha quando TODAS as imagens de onde a tag saiu forem salvas. Nada
     é gravado no disco.
   - MARCADO: o histórico é retido em datasetConfig.removedTagsHistory
     (salvo no "_tagger_config.json" da pasta) e sobrevive a salvar/reabrir.
     Desmarcar apaga o histórico guardado em disco (com confirmação).
   Trocar de dataset sempre reinicia a comparação. Limite: 500 entradas.

   AUTO-DO: toda tag que o Auto-Do remove entra no histórico marcada com
   "⚡ Auto-Do" (campo `by` da entrada) — MESMO que ela ainda exista em outras
   imagens (nesse caso a linha avisa que ela continua no dataset). Isso é feito
   por window.recordRemovedTags(Map<tag, [baseName]>, 'Auto-Do'), chamado pelo
   próprio Auto-Do antes de renderizar.

   UI: botão 🕘 na barra AND/OR/XOR/NOT (ao lado de ☆ e 💡) abre um popout
   com busca, e por entrada: ↩️ Restore (devolve a tag às imagens de onde
   saiu), ➕ Selected (adiciona às imagens selecionadas) e ✖ (esquecer).
========================================================================= */

(function () {
    const MAX_ENTRIES = 500;

    const style = document.createElement('style');
    style.innerHTML = `
        #btn-removed-history { flex: 0 0 auto; font-size: var(--editor-font-size); padding: 0.4em 0.7em; }
        #modal-removed-history .tool-modal { width: 640px; max-width: 92vw; max-height: 86vh; }
        #removed-history-list { max-height: 50vh; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; background:#111; border:1px solid #333; border-radius:6px; padding:6px; }
        .rh-row { display:flex; align-items:center; gap:8px; background:#151515; border:1px solid #2a2a2a; border-radius:6px; padding:6px 8px; }
        .rh-row.rh-back { opacity: 0.55; }
        .rh-row.rh-auto { border-left: 3px solid #00ff99; }
        .rh-by { color:#00ff99; font-weight:bold; }
        .rh-info { flex:1; min-width:0; }
        .rh-tag { font-size:12px; color:#ff9a9a; font-weight:bold; word-break:break-word; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .rh-tag.rh-nl { color:#b890ff; }
        .rh-meta { font-size:10px; color:#777; margin-top:2px; }
        .rh-btn { flex-shrink:0; font-size:11px; padding:5px 8px; border-radius:4px; cursor:pointer; font-weight:bold; border:1px solid #444; background:#222; color:#ddd; }
        .rh-btn.restore { background:#0d2a18; color:#00ff99; border-color:#00aa66; }
        .rh-btn.restore:hover { background:#00aa66; color:#000; }
        .rh-btn.add { background:#1a3a5c; color:#4db8ff; border-color:#2a5a8c; }
        .rh-btn.add:hover { background:#4db8ff; color:#000; }
        .rh-btn.forget { background:#2a0000; color:#ff6060; border-color:#7a222c; }
        .rh-btn.forget:hover { background:#ff4444; color:#fff; }
    `;
    document.head.appendChild(style);

    function esc(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function tagsOf(content) {
        return content ? content.split(',').map(t => t.trim()).filter(Boolean) : [];
    }
    let historyStore = [];
    let keepHistory = false; // checkbox "Keep history after saving"
    function getHistory() { return historyStore; }
    function writeToConfig() {
        if (typeof datasetConfig === 'undefined') return;
        datasetConfig.removedTagsHistory = historyStore;
        const handle = window.currentImagesHandle || window.rootHandle;
        if (handle && typeof window.saveDatasetConfig === 'function') window.saveDatasetConfig(handle);
    }
    function persist(history) {
        historyStore = history;
        if (keepHistory) writeToConfig();
        updateButton();
        const modal = document.getElementById('modal-removed-history');
        if (modal && modal.classList.contains('active')) renderList();
    }

    /* Remove do histórico toda entrada cujas imagens já foram TODAS salvas
       (nenhuma delas está mais "dirty"). Chamado sempre que algo é salvo. */
    function pruneSaved() {
        if (keepHistory || historyStore.length === 0 || typeof imageFiles === 'undefined') return;
        const dirtyNames = new Set(imageFiles.filter(i => i.dirty).map(i => i.baseName));
        const kept = historyStore.filter(e => (e.images || []).some(bn => dirtyNames.has(bn)));
        if (kept.length !== historyStore.length) persist(kept);
    }

    function installSaveHook() {
        if (typeof window.markClean !== 'function' || window.markClean.__removedHistoryWrapped) return;
        const orig = window.markClean;
        const wrapped = function () {
            const r = orig.apply(this, arguments);
            try { pruneSaved(); } catch (e) {}
            return r;
        };
        wrapped.__removedHistoryWrapped = true;
        window.markClean = wrapped;
    }

    /* ---------- DETECÇÃO POR SNAPSHOT ---------- */
    let lastRef = null;
    let snap = new Map(); // img -> content

    function takeSnapshot() {
        snap = new Map();
        imageFiles.forEach(img => snap.set(img, img.content || ''));
    }

    function detect() {
        if (typeof imageFiles === 'undefined') return;
        if (imageFiles !== lastRef) {
            lastRef = imageFiles; takeSnapshot();
            const stored = (typeof datasetConfig !== 'undefined' && Array.isArray(datasetConfig.removedTagsHistory)) ? datasetConfig.removedTagsHistory : [];
            historyStore = keepHistory ? stored.slice() : [];
            if (!keepHistory && typeof datasetConfig !== 'undefined') delete datasetConfig.removedTagsHistory;
            updateButton();
            return;
        }

        const changed = [];
        imageFiles.forEach(img => {
            const prev = snap.get(img);
            if (prev === undefined || prev !== (img.content || '')) changed.push(img);
        });
        if (changed.length === 0) return;

        const liveSet = new Set();
        imageFiles.forEach(img => tagsOf(img.content).forEach(t => liveSet.add(t)));

        const gone = new Map(); // tag -> [baseNames]
        changed.forEach(img => {
            const prev = snap.get(img);
            if (prev === undefined) return; // imagem nova no array
            const now = new Set(tagsOf(img.content));
            tagsOf(prev).forEach(t => {
                if (now.has(t) || liveSet.has(t)) return;
                if (!gone.has(t)) gone.set(t, []);
                gone.get(t).push(img.baseName);
            });
        });
        changed.forEach(img => snap.set(img, img.content || ''));

        if (gone.size === 0) return;
        const history = getHistory().slice();
        const ts = Date.now();
        gone.forEach((images, tag) => {
            const i = history.findIndex(e => e.tag === tag);
            if (i > -1) {
                const e = history.splice(i, 1)[0];
                e.images = [...new Set([...(e.images || []), ...images])];
                e.ts = ts;
                history.unshift(e);
            } else {
                history.unshift({ tag, ts, images: [...new Set(images)] });
            }
        });
        persist(history.slice(0, MAX_ENTRIES));
    }

    /* Registra remoções com ORIGEM conhecida (ex: Auto-Do). Funciona também para tags que
       continuam existindo em outras imagens. Se a detecção por snapshot já criou/vai criar
       a entrada da mesma tag, as duas se juntam (mesma tag = mesma entrada). */
    window.recordRemovedTags = function (entries, source) {
        if (!entries || typeof entries.forEach !== 'function' || entries.size === 0) return;
        const history = getHistory().slice();
        const ts = Date.now();
        entries.forEach((images, tag) => {
            const i = history.findIndex(e => e.tag === tag);
            let e;
            if (i > -1) {
                e = history.splice(i, 1)[0];
                e.images = [...new Set([...(e.images || []), ...images])];
                e.ts = ts;
            } else {
                e = { tag, ts, images: [...new Set(images)] };
            }
            if (source) e.by = source;
            history.unshift(e);
        });
        persist(history.slice(0, MAX_ENTRIES));
    };

    /* ---------- AÇÕES ---------- */
    function refreshAfterAdd() {
        if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
        if (typeof window.renderImageList === 'function') window.renderImageList();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
        if (typeof window.refreshListStatus === 'function') window.refreshListStatus();
        if (typeof window.applyFilters === 'function') window.applyFilters();
    }

    function forget(tag) {
        persist(getHistory().filter(e => e.tag !== tag));
        renderList();
    }

    function restoreToOriginal(entry) {
        const byName = new Map(imageFiles.map(i => [i.baseName, i]));
        const modified = [];
        (entry.images || []).forEach(bn => {
            const img = byName.get(bn);
            if (!img) return;
            const tags = tagsOf(img.content);
            if (tags.includes(entry.tag)) return;
            tags.push(entry.tag);
            img.content = tags.join(', ');
            img.hasFile = true;
            if (!img.ext) img.ext = 'txt';
            modified.push(img);
        });
        if (modified.length === 0) {
            if (window.showAlert) window.showAlert('None of the original images were found (or they already have the tag).', 'warn');
            return;
        }
        if (typeof window.markDirty === 'function') window.markDirty(modified);
        if (typeof masterTagSet !== 'undefined') masterTagSet.add(entry.tag);
        refreshAfterAdd();
        forget(entry.tag);
        if (window.showAlert) window.showAlert(`Restored "${entry.tag}" on ${modified.length} image(s). Remember to save.`, 'success');
    }

    function addToSelected(entry) {
        if (typeof selectedIndices === 'undefined' || selectedIndices.size === 0) {
            if (window.showAlert) window.showAlert('Select at least one image in the list first.', 'warn');
            return;
        }
        if (typeof window.addTagToSelected === 'function') window.addTagToSelected(entry.tag, 'bottom');
        forget(entry.tag);
        if (window.showAlert) window.showAlert(`Added "${entry.tag}" to ${selectedIndices.size} selected image(s).`, 'success');
    }

    /* ---------- UI ---------- */
    function buildModal() {
        if (document.getElementById('modal-removed-history')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-removed-history';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-removed-history');
        overlay.innerHTML = `
            <div class="tool-modal" style="width:640px;" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🕘 Removed Tags History</span>
                    <button onclick="window.closeModal('modal-removed-history')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div style="font-size:11px; color:#888; line-height:1.5;">Tags that disappeared completely from this dataset. This is only a safety check: each entry disappears automatically once its images are saved, and nothing is kept afterwards. Tags removed by <b style=\"color:#00ff99;\">⚡ Auto-Do</b> are always listed (even if they still exist in other images).</div>
                <label style="font-size:12px; color:#ffcc66; display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none;" title="Checked: the history is kept in this dataset's _tagger_config.json and survives saving. Unchecked: entries vanish as soon as their images are saved.">
                    <input type="checkbox" id="removed-history-keep" style="margin:0;"> 💾 Keep history after saving (permanent for this dataset)
                </label>
                <input type="text" id="removed-history-search" placeholder="🔍 Filter..." style="width:100%; box-sizing:border-box;">
                <div id="removed-history-list"></div>
                <div class="modal-buttons">
                    <button id="btn-rh-clear" class="btn-cancel" style="color:#ff6060; border-color:#7a222c;">🗑️ Clear history</button>
                    <button class="btn-cancel" onclick="window.closeModal('modal-removed-history')">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('removed-history-search').oninput = renderList;
        document.getElementById('removed-history-keep').onchange = onKeepToggle;
        document.getElementById('btn-rh-clear').onclick = () => {
            if (getHistory().length === 0) return;
            if (!confirm('Clear the whole removed-tags history of this dataset?')) return;
            persist([]);
            renderList();
        };
    }

    function renderList() {
        const list = document.getElementById('removed-history-list');
        if (!list) return;
        const q = (document.getElementById('removed-history-search').value || '').trim().toLowerCase();
        const liveSet = new Set();
        if (typeof imageFiles !== 'undefined') imageFiles.forEach(img => tagsOf(img.content).forEach(t => liveSet.add(t)));

        const entries = getHistory().filter(e => !q || e.tag.toLowerCase().includes(q) || (e.by && e.by.toLowerCase().includes(q)));
        list.innerHTML = '';
        if (entries.length === 0) {
            list.innerHTML = '<div style="color:#555; font-size:12px; text-align:center; padding:20px;">No removed tags recorded for this dataset.</div>';
            return;
        }
        entries.forEach(entry => {
            const isNL = typeof window.checkIfNL === 'function' && window.checkIfNL(entry.tag);
            const back = liveSet.has(entry.tag);
            const row = document.createElement('div');
            row.className = 'rh-row' + (back ? ' rh-back' : '') + (entry.by ? ' rh-auto' : '');
            const n = (entry.images || []).length;
            const byHtml = entry.by ? `<span class="rh-by" title="Removed automatically by ${esc(entry.by)}">⚡ ${esc(entry.by)}</span> · ` : '';
            const backText = back ? (entry.by ? ' · still in other images' : ' · already back in dataset') : '';
            row.innerHTML = `
                <div class="rh-info">
                    <div class="rh-tag${isNL ? ' rh-nl' : ''}" title="${esc(entry.tag)}">${esc(entry.tag)}</div>
                    <div class="rh-meta">${byHtml}${esc(new Date(entry.ts).toLocaleString())} · from ${n} image(s)${backText}</div>
                </div>
                <button class="rh-btn restore" title="Put the tag back on the images it was removed from">↩️ Restore</button>
                <button class="rh-btn add" title="Add the tag to the currently selected image(s)">➕ Selected</button>
                <button class="rh-btn forget" title="Remove from history">✖</button>
            `;
            row.querySelector('.restore').onclick = () => restoreToOriginal(entry);
            row.querySelector('.add').onclick = () => addToSelected(entry);
            row.querySelector('.forget').onclick = () => forget(entry.tag);
            list.appendChild(row);
        });
    }

    async function onKeepToggle(e) {
        const cb = e.target;
        if (cb.checked) {
            keepHistory = true;
            // junta o que já estava guardado no disco com o que está em memória
            const stored = (typeof datasetConfig !== 'undefined' && Array.isArray(datasetConfig.removedTagsHistory)) ? datasetConfig.removedTagsHistory : [];
            const memTags = new Set(historyStore.map(h => h.tag));
            const merged = [...historyStore, ...stored.filter(h => !memTags.has(h.tag))].slice(0, MAX_ENTRIES);
            persist(merged);
        } else {
            const stored = (typeof datasetConfig !== 'undefined' && Array.isArray(datasetConfig.removedTagsHistory)) ? datasetConfig.removedTagsHistory : [];
            if (stored.length > 0 && !confirm('Unchecking will DELETE the history saved on disk for this dataset, and entries will vanish as soon as their images are saved. Continue?')) {
                cb.checked = true;
                return;
            }
            keepHistory = false;
            if (typeof datasetConfig !== 'undefined' && datasetConfig.removedTagsHistory !== undefined) {
                delete datasetConfig.removedTagsHistory;
                const handle = window.currentImagesHandle || window.rootHandle;
                if (handle && typeof window.saveDatasetConfig === 'function') window.saveDatasetConfig(handle);
            }
            pruneSaved();
        }
        if (typeof window.saveSetting === 'function') window.saveSetting('removed-history-keep', keepHistory);
        renderList();
    }

    window.openRemovedHistory = function () {
        buildModal();
        document.getElementById('removed-history-keep').checked = keepHistory;
        document.getElementById('removed-history-search').value = '';
        renderList();
        window.openModal('modal-removed-history');
    };

    function updateButton() {
        const btn = document.getElementById('btn-removed-history');
        if (!btn) return;
        const n = getHistory().length;
        btn.textContent = n > 0 ? `🕘 ${n}` : '🕘';
        btn.title = n > 0 ? `${n} removed tag(s) in history — click to review/restore` : 'Removed tags history (empty)';
    }

    function injectButton() {
        if (document.getElementById('btn-removed-history')) return;
        const anchor = document.getElementById('btn-filter-suggest-img') || document.getElementById('btn-filter-fav-tags');
        if (!anchor) return;
        const btn = document.createElement('button');
        btn.id = 'btn-removed-history';
        btn.className = 'logic-btn';
        btn.onclick = () => window.openRemovedHistory();
        anchor.insertAdjacentElement('afterend', btn);
        updateButton();
    }

    function installHook() {
        if (typeof window.registerPostRenderMasterTagList === 'function') {
            window.registerPostRenderMasterTagList(detect);
            return true;
        }
        if (typeof window.renderMasterTagList === 'function' && !window.renderMasterTagList.__removedHistoryWrapped) {
            const orig = window.renderMasterTagList;
            window.renderMasterTagList = function () { const r = orig.apply(this, arguments); try { detect(); } catch (e) {} return r; };
            window.renderMasterTagList.__removedHistoryWrapped = true;
            return true;
        }
        return false;
    }

    installHook();
    installSaveHook();
    window.addEventListener('DOMContentLoaded', async () => {
        if (typeof window.getSetting === 'function') keepHistory = !!(await window.getSetting('removed-history-keep', false));
        installSaveHook(); setTimeout(injectButton, 50); if (!window.registerPostRenderMasterTagList) installHook(); });
})();