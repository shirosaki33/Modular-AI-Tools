/* =========================================================================
   COPY SEAL  (📋 Clone)
   -------------------------------------------------------------------------
   - Images created by the 📋 Clone button get a "📋 Copy" seal in the Dataset list
     (kept in the dataset config: datasetConfig[baseName].isCopy / .copyOf).
   - Once the dataset has copies, the 📋 button shows how many there are and its panel gets a
     "Copies" section: select all copies, remove the selected copies, remove all copies.
     (Cloning more is the normal panel: select image(s), type how many, Confirm.)
   - With no image selected, clicking 📋 opens only the Copies section.
   Removing a copy deletes the image + its caption for good (a copy is disposable), after a confirm.
   ========================================================================= */
(function () {
    'use strict';
    if (window.__tmCopyBadge) return;
    window.__tmCopyBadge = true;

    const st = document.createElement('style');
    st.textContent = `
        .copy-badge { display:inline-block; margin-left:6px; font-size:9px; font-weight:bold; color:#4db8ff; background:#0d2236;
            border:1px solid #2a5a8c; border-radius:10px; padding:1px 6px; vertical-align:middle; cursor:help; white-space:nowrap; user-select:none; }
        #clone-dropdown.copies-only > :not(#clone-copies-section) { display:none; }
        #clone-copies-section { margin-top:8px; padding-top:8px; border-top:1px solid #333; display:flex; flex-direction:column; gap:5px; }
        #clone-dropdown.copies-only #clone-copies-section { margin-top:0; padding-top:0; border-top:none; }
        #clone-copies-section button { text-align:left; padding:6px 8px; font-size:12px; }
        #clone-copies-section button:disabled { opacity:.45; cursor:default; }
        #clone-copies-section .cc-info { color:#aaa; font-size:12px; font-weight:bold; }
        #clone-copies-section .cc-hint { color:#777; font-size:11px; }
        #clone-count-row { display:flex; align-items:center; gap:8px; margin:5px 0; }
        #clone-count-row #clone-count-input { width:46% !important; margin:0 !important; flex:0 0 46%; }
        #clone-preview { flex:1; min-width:0; font-size:11px; line-height:1.35; color:#aaa; }
        #clone-preview b { color:#00ff99; }
        #clone-preview .cp-total { color:#4db8ff; font-weight:bold; }
        #btn-clone-open sup, button[onclick*="openCloneModal"] sup { font-size:9px; color:#4db8ff; margin-left:1px; }`;
    document.head.appendChild(st);

    const cfgOf = img => (typeof datasetConfig !== 'undefined' && datasetConfig && img) ? datasetConfig[img.baseName] : null;
    const isCopy = img => { const c = cfgOf(img); return !!(c && c.isCopy); };
    const copies = () => (typeof imageFiles === 'undefined' ? [] : imageFiles.filter(i => i && isCopy(i)));
    const selectedCopies = () => {
        if (typeof selectedIndices === 'undefined') return [];
        return Array.from(selectedIndices).map(i => imageFiles[i]).filter(i => i && isCopy(i));
    };
    const cloneBtn = () => document.querySelector('#list-selection-actions [onclick*="openCloneModal"]') || document.querySelector('button[onclick*="openCloneModal"]');

    /* ---------- seal in the list + count on the 📋 button ---------- */
    function apply() {
        if (typeof imageFiles === 'undefined') return;
        let n = 0;
        imageFiles.forEach(img => {
            if (!img.element) return;
            const nameEl = img.element.querySelector('.list-item-name');
            if (!nameEl) return;
            let b = nameEl.querySelector('.copy-badge');
            if (isCopy(img)) {
                n++;
                if (!b) { b = document.createElement('span'); b.className = 'copy-badge'; b.textContent = '📋 Copy'; nameEl.appendChild(b); }
                const of = cfgOf(img).copyOf;
                b.title = `Copy made with 📋 Clone${of ? ` of "${of}"` : ''}. Use the 📋 button to duplicate more or remove the copies.`;
            } else if (b) b.remove();
        });
        const btn = cloneBtn();
        if (btn && !btn.disabled) {
            btn.innerHTML = n ? `📋<sup>${n}</sup>` : '📋';
            btn.title = n ? `Clone selected images · ${n} cop${n === 1 ? 'y' : 'ies'} in this dataset (click for options)` : 'Clone Selected';
        }
    }

    /* ---------- the Copies section of the 📋 panel ---------- */
    function buildSection() {
        const dd = document.getElementById('clone-dropdown');
        if (!dd) return;
        let sec = document.getElementById('clone-copies-section');
        const all = copies(), sel = selectedCopies();
        if (!all.length) { if (sec) sec.remove(); dd.classList.remove('copies-only'); return; }
        if (!sec) { sec = document.createElement('div'); sec.id = 'clone-copies-section'; dd.appendChild(sec); }
        sec.innerHTML = `
            <div class="cc-info">📋 Copies in this dataset: ${all.length}${sel.length ? ` (${sel.length} selected)` : ''}</div>
            <button class="btn-save-local" id="cc-select" style="background:#1a3a5c;border-color:#2a5a8c;color:#4db8ff;">☑️ Select all copies</button>
            <button class="btn-save-local" id="cc-remove-sel" style="background:#4a1118;border-color:#7a222c;color:#ffb6c0;" ${sel.length ? '' : 'disabled'}>🗑️ Remove selected copies (${sel.length})</button>
            <button class="btn-save-local" id="cc-remove-all" style="background:#4a1118;border-color:#7a222c;color:#ffb6c0;">🗑️ Remove all copies (${all.length})</button>
            <div class="cc-hint">${dd.classList.contains('copies-only') ? 'To duplicate more: select image(s) and click 📋 again.' : 'Duplicate more: type how many above and Confirm.'}</div>
            <button class="btn-save-local" id="cc-close" style="background:#222;border-color:#444;color:#ccc;">Close</button>`;
        sec.querySelector('#cc-select').onclick = () => {
            selectedIndices.clear();
            imageFiles.forEach((img, i) => { if (isCopy(img) && !img.hidden) selectedIndices.add(i); });
            if (typeof window.lastSelectedIndex !== 'undefined') window.lastSelectedIndex = Array.from(selectedIndices).pop();
            if (typeof window.updateListSelectionVisuals === 'function') window.updateListSelectionVisuals();
            if (typeof window.renderEditor === 'function') window.renderEditor();
            if (typeof window.updateConvertFormatButton === 'function') window.updateConvertFormatButton();
            buildSection();
        };
        sec.querySelector('#cc-remove-sel').onclick = () => removeCopies(selectedCopies(), 'selected');
        sec.querySelector('#cc-remove-all').onclick = () => removeCopies(copies(), 'all');
        sec.querySelector('#cc-close').onclick = () => dd.classList.remove('open');
    }

    /* ---------- count bar split in half: "x N" -> new images + total of the dataset ---------- */
    function ensureCountRow() {
        const inp = document.getElementById('clone-count-input');
        if (!inp) return null;
        let row = document.getElementById('clone-count-row');
        if (!row) {
            row = document.createElement('div'); row.id = 'clone-count-row';
            inp.parentNode.insertBefore(row, inp);
            row.appendChild(inp);
            const pv = document.createElement('div'); pv.id = 'clone-preview'; row.appendChild(pv);
            inp.addEventListener('input', updatePreview);
        }
        return row;
    }
    function updatePreview() {
        const pv = document.getElementById('clone-preview');
        if (!pv || typeof imageFiles === 'undefined' || typeof selectedIndices === 'undefined') return;
        const inp = document.getElementById('clone-count-input');
        const c = Math.max(0, parseInt(inp && inp.value, 10) || 0);
        const sel = selectedIndices.size;
        const add = sel * c, total = imageFiles.length + add;
        pv.innerHTML = `${sel} × <b>${c}</b> = <b>+${add}</b><br><span class="cp-total">${total} total</span> <span style="color:#777">(now ${imageFiles.length})</span>`;
        pv.title = `${sel} selected image(s) × ${c} cop${c === 1 ? 'y' : 'ies'} each = ${add} new image(s). The dataset would have ${total} images in total (currently ${imageFiles.length}).`;
    }

    const origOpen = window.openCloneModal;
    window.openCloneModal = function () {
        const dd = document.getElementById('clone-dropdown');
        const hasSel = typeof selectedIndices !== 'undefined' && selectedIndices.size > 0;
        if (!hasSel && copies().length && dd) {
            dd.classList.add('copies-only');
            dd.classList.add('open');
            buildSection();
            return;
        }
        if (dd) dd.classList.remove('copies-only');
        if (typeof origOpen === 'function') origOpen.apply(this, arguments);
        ensureCountRow(); updatePreview();
        buildSection();
    };

    /* ---------- removal ---------- */
    let removing = false;
    async function removeCopies(list, which) {
        if (removing || !list.length) return;
        const dd = document.getElementById('clone-dropdown');
        const names = list.slice(0, 6).map(i => i.name).join(', ') + (list.length > 6 ? ` (+${list.length - 6} more)` : '');
        if (!confirm(`⚠️ Remove ${which === 'all' ? 'ALL ' : ''}${list.length} cop${list.length === 1 ? 'y' : 'ies'} made with 📋 Clone?\n\n${names}\n\nThe images and their captions are DELETED for good (the originals are not touched). This cannot be undone.`)) return;
        if (dd) dd.classList.remove('open');
        removing = true;
        const ctx = window.TM.tasks.captureDataset();
        ctx.files = list.slice();
        const cfg = ctx.config;
        let ok = 0, fail = 0;
        try {
            await window.TM.tasks.run({ title: `Remove ${list.length} cop${list.length === 1 ? 'y' : 'ies'}`, icon: '🗑️', ctx, silentEnd: true }, async (task) => {
                let i = 0;
                for (const img of ctx.files) {
                    if (task.cancelled) break;
                    task.progress(++i, ctx.files.length);
                    try {
                        const dir = img.parentDirHandle;
                        await dir.removeEntry(img.name);
                        for (const ext of ['txt', 'json']) { try { await dir.removeEntry(`${img.baseName}.${ext}`); } catch (e) {} }
                        if (window.NLCodec) { try { await window.NLCodec.setEntries(dir, img.baseName, []); } catch (e) {} }
                        delete cfg[img.baseName];
                        ok++;
                    } catch (e) { console.error('Remove copy', e); fail++; }
                }
                task.result = `${ok} removed${fail ? `, ${fail} failed` : ''}`;
                if (ok > 0) {
                    const here = await window.TM.tasks.isCurrent(ctx.handle);
                    if (typeof window.saveDatasetConfig === 'function') await window.saveDatasetConfig(ctx.handle, cfg, []);
                    if (here) {
                        if (typeof selectedIndices !== 'undefined') selectedIndices.clear();
                        if (typeof window.markDatasetEdited === 'function') await window.markDatasetEdited();
                        if (typeof window.refreshDataset === 'function') await window.refreshDataset();
                    }
                    if (window.showAlert) window.showAlert(`Removed ${ok} cop${ok === 1 ? 'y' : 'ies'}.`, 'success');
                }
                if (fail && window.showAlert) window.showAlert(`⚠️ Could not remove ${fail} cop${fail === 1 ? 'y' : 'ies'}.`, 'error');
            }).promise;
        } finally { removing = false; apply(); }
    }

    if (window.registerPostRenderImageList) window.registerPostRenderImageList(apply);
    if (window.TM && window.TM.on) {
        window.TM.on('dataset:loaded', () => setTimeout(apply, 50));
    }
    // keeps the section in sync with the selection while the panel is open
    document.addEventListener('click', () => {
        const dd = document.getElementById('clone-dropdown');
        if (dd && dd.classList.contains('open')) setTimeout(() => { updatePreview(); buildSection(); }, 0);
    });
    window.TMCopySeal = { isCopy, copies, apply };
})();
