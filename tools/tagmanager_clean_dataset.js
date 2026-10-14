/* =========================================================================
   CLEAN DATASET (🧹) — novo arquivo, standalone
   ---------------------------------------------------------------------
   Botão 🧹 ao lado do 🪣 (Bucket) na barra da lista "Dataset".

   Varre a pasta ATUALMENTE carregada (window.currentImagesHandle) e acha
   arquivos .txt / .json "órfãos": legendas cujo baseName não tem mais
   nenhuma imagem (.png/.jpg/.jpeg/.webp) com o mesmo nome na pasta —
   por exemplo, porque a foto foi apagada/movida fora do app, ou porque
   o .txt foi criado sem foto.

   NUNCA toca em arquivos do sistema: qualquer nome começando com "_"
   (_tagger_config.json, _pending_tags.json, _pending_remove.json ...) é
   ignorado, e subpastas (_archive, _rename_cache, personagens...) não
   são varridas. Antes de apagar, mostra a lista e pede confirmação.
   A exclusão é PERMANENTE (não passa por lixeira).
========================================================================= */

(function () {
    const IMG_RE = /\.(png|jpg|jpeg|webp)$/i;
    const CAPTION_RE = /\.(txt|json)$/i;
    const SYSTEM_NAMES = new Set(['_tagger_config.json', '_pending_tags.json', '_pending_remove.json']);

    const style = document.createElement('style');
    style.innerHTML = `
        #btn-clean-dataset { flex-shrink:0; padding:6px 10px; font-size:14px; background:transparent; border:1px solid #444; color:#aaa; }
        #btn-clean-dataset:hover { color:#ffcc66; border-color:#ffcc66; }
        #modal-clean-dataset .tool-modal { width: 560px; max-width: 92vw; max-height: 85vh; }
        #clean-orphan-list { max-height: 45vh; overflow-y: auto; background:#111; border:1px solid #333; border-radius:6px; padding:6px; display:flex; flex-direction:column; gap:2px; }
        .clean-orphan-row { font-size:12px; color:#ddd; padding:4px 8px; border-radius:4px; word-break:break-all; background:#151515; }
        .clean-orphan-row b { color:#ffcc66; }
    `;
    document.head.appendChild(style);

    function esc(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function findOrphans(dirHandle) {
        const imageBases = new Set();
        const captions = [];
        for await (const entry of dirHandle.values()) {
            if (entry.kind !== 'file') continue;
            if (IMG_RE.test(entry.name)) {
                imageBases.add(entry.name.substring(0, entry.name.lastIndexOf('.')).toLowerCase());
            } else if (CAPTION_RE.test(entry.name)) {
                captions.push(entry.name);
            }
        }
        return captions.filter(name => {
            if (name.startsWith('_') || SYSTEM_NAMES.has(name)) return false;
            return !imageBases.has(name.substring(0, name.lastIndexOf('.')).toLowerCase());
        }).sort((a, b) => a.localeCompare(b));
    }

    function buildModal() {
        if (document.getElementById('modal-clean-dataset')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-clean-dataset';
        overlay.className = 'modal-overlay';
        overlay.onclick = () => window.closeModal('modal-clean-dataset');
        overlay.innerHTML = `
            <div class="tool-modal" onclick="event.stopPropagation()">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>🧹 Clean Dataset</span>
                    <button onclick="window.closeModal('modal-clean-dataset')" style="background:transparent; border:none; color:#ff4444; font-size:20px; cursor:pointer; font-weight:bold; line-height:1; padding:0;">&times;</button>
                </h3>
                <div id="clean-summary" style="font-size:12px; color:#aaa; line-height:1.5;"></div>
                <div id="clean-orphan-list"></div>
                <div style="font-size:11px; color:#666;">Only .txt / .json files with no matching image in this folder are listed. System files (starting with "_") and subfolders are never touched. Deletion is permanent.</div>
                <div class="modal-buttons">
                    <button class="btn-cancel" onclick="window.closeModal('modal-clean-dataset')">Cancel</button>
                    <button id="btn-confirm-clean" style="background:#2a0000; color:#ff6060; border:1px solid #aa0000; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer;">🗑️ Delete</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    window.cleanDataset = async function () {
        const handle = window.currentImagesHandle || window.rootHandle;
        if (!handle) { if (window.showAlert) window.showAlert('No folder loaded.', 'warn'); return; }

        const btn = document.getElementById('btn-clean-dataset');
        if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
        let orphans = [];
        try {
            if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                    if (window.showAlert) window.showAlert('Write permission denied.', 'error');
                    return;
                }
            }
            orphans = await findOrphans(handle);
        } catch (e) {
            console.error('[Clean Dataset] scan failed:', e);
            if (window.showAlert) window.showAlert('Error scanning the folder. Check the console.', 'error');
            return;
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🧹'; }
        }

        if (orphans.length === 0) {
            if (window.showAlert) window.showAlert('Dataset is clean: no orphan .txt/.json files found.', 'success');
            return;
        }

        buildModal();
        document.getElementById('clean-summary').innerHTML = `Found <b style="color:#ffcc66;">${orphans.length}</b> orphan caption file(s) in <b>${esc(handle.name)}</b>:`;
        const list = document.getElementById('clean-orphan-list');
        list.innerHTML = orphans.map(n => `<div class="clean-orphan-row">${esc(n)}</div>`).join('');

        const confirmBtn = document.getElementById('btn-confirm-clean');
        confirmBtn.textContent = `🗑️ Delete ${orphans.length} file(s)`;
        confirmBtn.disabled = false;
        confirmBtn.onclick = async () => {
            confirmBtn.disabled = true; confirmBtn.textContent = '⏳ Deleting...';
            let deleted = 0, failed = 0;
            for (const name of orphans) {
                try { await handle.removeEntry(name); deleted++; }
                catch (e) { console.warn('[Clean Dataset] could not delete', name, e); failed++; }
            }
            window.closeModal('modal-clean-dataset');
            if (window.showAlert) window.showAlert(
                failed ? `Deleted ${deleted} file(s); ${failed} failed (see console).` : `Deleted ${deleted} orphan file(s). 🧹`,
                failed ? 'warn' : 'success');
        };

        window.openModal('modal-clean-dataset');
    };

    function injectButton() {
        if (document.getElementById('btn-clean-dataset')) return;
        const anchor = document.getElementById('btn-scan-buckets')
            || document.getElementById('btn-compact-group-depth')
            || document.getElementById('btn-toggle-compact-view');
        if (!anchor) return;
        const btn = document.createElement('button');
        btn.id = 'btn-clean-dataset';
        btn.textContent = '🧹';
        btn.title = 'Clean Dataset: remove .txt/.json files that have no matching image in this folder';
        btn.onclick = () => window.cleanDataset();
        anchor.insertAdjacentElement('afterend', btn);
    }

    window.addEventListener('DOMContentLoaded', () => setTimeout(injectButton, 50));
})();