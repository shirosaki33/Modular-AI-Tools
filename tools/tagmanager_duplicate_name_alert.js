/* =========================================================================
   DUPLICATE NAME ALERT + NAME FIXER
   ---------------------------------------------------------------------
   PROBLEMA: quando a pasta do dataset tem o mesmo baseName com extensões
   de imagem diferentes (ex: "gato.png" e "gato.jpg"), as duas leem/escrevem
   a MESMA legenda "gato.txt" — as legendas colidem.

   HISTÓRICO: a versão antiga (tagmanager_dup_name_fixer.js) renomeava
   sozinha, em silêncio. Foi removida. Esta versão mantém a detecção
   passiva e adiciona a correção, mas SÓ quando o usuário clica.

   1) DETECÇÃO (passiva, roda a cada render da lista "Dataset"):
        - agrupa window.imageFiles (visíveis) por baseName (case-insensitive);
        - grupo com mais de 1 item = conflito;
        - linha vermelha + selo "⚠️ Duplicate name" com tooltip.

   2) CORREÇÃO (botão ✏️ ao lado do 🪣, só aparece quando há duplicatas):
        - o PRIMEIRO arquivo de cada grupo mantém nome e legenda;
        - cada arquivo extra recebe "(dup)" no FIM do nome base:
              gato.jpg  -> gato(dup).jpg   (+ gato(dup).txt, cópia da legenda)
          se "gato(dup)" já existir, empilha: gato(dup)(dup), e assim por diante
          (o sufixo é "(dup)" e não um número porque já existem fotos com
          número no final do nome);
        - mostra a lista do que vai mudar e pede confirmação antes de tocar
          em qualquer arquivo;
        - NUNCA sobrescreve: o nome novo é escolhido livre (checado contra o
          disco e contra a lista em memória). A imagem antiga só é removida
          depois que a cópia nova foi gravada e conferida (mesmo tamanho);
        - a legenda ORIGINAL não é apagada (o arquivo que manteve o nome
          continua usando ela) — por isso não dá pra reaproveitar o
          confirmRename() de tagmanager_ui_list.js, que apaga a legenda antiga.

   Registra-se no hub central (tagmanager_render_hooks.js), com fallback
   para wrap manual se esse arquivo não tiver carregado.
========================================================================= */

(function () {

    const DUP_SUFFIX = '(dup)';
    let _fixing = false;

    const style = document.createElement('style');
    style.innerHTML = `
        .list-item.dup-name-conflict {
            background: rgba(200, 40, 40, 0.16) !important;
            border-left: 3px solid #ff4444 !important;
            padding-left: 9px;
        }
        .list-item.dup-name-conflict:hover { background: rgba(200, 40, 40, 0.26) !important; }
        .list-item.dup-name-conflict.selected {
            /* Seleção (azul) continua tendo prioridade visual mesmo em conflito de nome —
               senão fica impossível saber se o item ATUAL está selecionado. */
            border-left: 3px solid #4db8ff !important;
        }
        .dup-name-badge {
            display: inline-block; margin-left: 6px; font-size: 9px; font-weight: bold;
            color: #ffaaaa; background: #330000; border: 1px solid #ff4444;
            border-radius: 10px; padding: 1px 6px; vertical-align: middle;
            cursor: help; white-space: nowrap; user-select: none;
        }
        #btn-fix-dup-names {
            display: none; flex-shrink: 0; padding: 6px 10px; font-size: 14px;
            background: #330000; border: 1px solid #ff4444; color: #ffaaaa;
        }
        #btn-fix-dup-names:hover { background: #ff4444; color: #fff; }
        #btn-fix-dup-names:disabled { opacity: 0.5; cursor: wait; }
    `;
    document.head.appendChild(style);

    /* ---------- GRUPOS DUPLICADOS ---------- */
    // Retorna [[img, img, ...], ...] — só grupos com 2+ itens, na ordem de imageFiles.
    function getDuplicateGroups() {
        if (typeof imageFiles === 'undefined') return [];
        const groups = new Map(); // baseNameLower -> [img, ...]
        imageFiles.forEach(img => {
            if (img.hidden) return;
            const key = (img.baseName || '').toLowerCase();
            if (!key) return;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(img);
        });
        return Array.from(groups.values()).filter(g => g.length > 1);
    }

    function computeDuplicateSiblingsMap(groups) {
        const siblingsMap = new Map(); // img -> [outros nomes que colidem]
        groups.forEach(group => {
            group.forEach(img => {
                siblingsMap.set(img, group.filter(g => g !== img).map(g => g.name));
            });
        });
        return siblingsMap;
    }

    /* ---------- BOTÃO ✏️ (temporário: só aparece com duplicatas) ---------- */
    function ensureFixButton() {
        let btn = document.getElementById('btn-fix-dup-names');
        if (btn) return btn;
        // Ao lado do 🪣 (injetado por tagmanager_bucket_check.js). Se ele ainda
        // não existir, ancora no último botão da barra; o 🪣 entra antes dele.
        const anchor = document.getElementById('btn-scan-buckets')
            || document.getElementById('btn-compact-group-depth')
            || document.getElementById('btn-toggle-compact-view');
        if (!anchor) return null;
        btn = document.createElement('button');
        btn.id = 'btn-fix-dup-names';
        btn.textContent = '✏️';
        btn.onclick = () => window.fixDuplicateNames();
        anchor.insertAdjacentElement('afterend', btn);
        return btn;
    }

    function updateFixButton(groups) {
        const btn = ensureFixButton();
        if (!btn) return;
        if (groups.length === 0) { btn.style.display = 'none'; return; }
        const extra = groups.reduce((n, g) => n + g.length - 1, 0);
        btn.style.display = 'inline-block';
        btn.title = `Fix duplicate names: ${extra} file(s) share a name with another file. Click to add "${DUP_SUFFIX}" to the end of their names.`;
    }

    /* ---------- REALCE + SELO NOS ELEMENTOS JÁ RENDERIZADOS ---------- */
    function applyDuplicateNameAlerts() {
        if (typeof imageFiles === 'undefined') return;
        const groups = getDuplicateGroups();
        const siblingsMap = computeDuplicateSiblingsMap(groups);

        imageFiles.forEach(img => {
            if (!img.element) return;
            const nameEl = img.element.querySelector('.list-item-name');
            const siblings = siblingsMap.get(img);

            if (siblings) {
                img.element.classList.add('dup-name-conflict');
                if (nameEl) {
                    let badge = nameEl.querySelector('.dup-name-badge');
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'dup-name-badge';
                        nameEl.appendChild(badge);
                    }
                    badge.textContent = '⚠️ Duplicate name';
                    badge.title = `Same base name is also used by: ${siblings.join(', ')}\nCaptions may collide between these files (they read/write the same .txt/.json). Click the ✏️ button next to 🪣 to add "${DUP_SUFFIX}" to the extra names automatically.`;
                }
            } else {
                img.element.classList.remove('dup-name-conflict');
                const badge = nameEl && nameEl.querySelector('.dup-name-badge');
                if (badge) badge.remove();
            }
        });

        updateFixButton(groups);
    }

    /* ---------- PLANEJAMENTO DA CORREÇÃO (não escreve nada) ---------- */
    async function listBaseNamesOnDisk(dirHandle) {
        const names = new Set();
        for await (const entry of dirHandle.values()) {
            const dot = entry.name.lastIndexOf('.');
            names.add((dot > 0 ? entry.name.slice(0, dot) : entry.name).toLowerCase());
        }
        return names;
    }

    async function planFixes() {
        const groups = getDuplicateGroups();
        const memoryBases = new Set(imageFiles.map(i => (i.baseName || '').toLowerCase()));
        const takenByDir = new Map(); // dirHandle -> Set(baseNames em uso, minúsculo)

        async function takenFor(dirHandle) {
            if (!dirHandle) return memoryBases;
            if (!takenByDir.has(dirHandle)) {
                const taken = await listBaseNamesOnDisk(dirHandle); // se falhar, aborta tudo (sem garantia de não sobrescrever)
                memoryBases.forEach(n => taken.add(n));
                takenByDir.set(dirHandle, taken);
            }
            return takenByDir.get(dirHandle);
        }

        const plans = [];
        for (const group of groups) {
            // group[0] mantém o nome; os demais ganham o sufixo
            for (let i = 1; i < group.length; i++) {
                const img = group[i];
                const taken = await takenFor(img.parentDirHandle);
                let newBase = img.baseName + DUP_SUFFIX;
                while (taken.has(newBase.toLowerCase())) newBase += DUP_SUFFIX;
                taken.add(newBase.toLowerCase());

                const dot = img.name.lastIndexOf('.');
                const extWithDot = dot >= 0 ? img.name.slice(dot) : '';
                plans.push({ img, oldName: img.name, newBase, newImgName: newBase + extWithDot });
            }
        }
        return plans;
    }

    /* ---------- EXECUÇÃO ---------- */
    async function writeBuffer(dirHandle, name, data) {
        const handle = await dirHandle.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return handle;
    }

    async function applyPlan(p) {
        const { img, oldName, newBase, newImgName } = p;
        const dir = img.parentDirHandle;
        let createdImg = false, createdTxt = null, oldRemoved = false;

        try {
            // 1) copia a imagem para o nome novo e confere o tamanho
            const oldFile = await (await dir.getFileHandle(oldName)).getFile();
            const newImgHandle = await writeBuffer(dir, newImgName, await oldFile.arrayBuffer());
            createdImg = true;
            const check = await newImgHandle.getFile();
            if (check.size !== oldFile.size) throw new Error(`Size mismatch after copying "${oldName}"`);

            // 2) cópia da legenda (conteúdo ATUAL em memória, inclusive edições não salvas).
            //    A legenda original NÃO é apagada: o arquivo que manteve o nome ainda a usa.
            if (img.hasFile) {
                const fmt = img.ext || 'txt';
                const newTextName = `${newBase}.${fmt}`;
                const content = fmt === 'json' ? JSON.stringify({ tags: img.content }, null, 2) : (img.content || '');
                createdTxt = newTextName;
                await writeBuffer(dir, newTextName, content);
            }

            // 3) só agora remove a imagem com o nome antigo
            await dir.removeEntry(oldName);
            oldRemoved = true;
        } catch (e) {
            console.error('[Name Fixer] failed on', oldName, e);
            // Desfaz só o que ESTA execução criou (nomes que eram garantidamente livres),
            // e só se o original ainda existe — nunca arrisca perder a única cópia.
            if (!oldRemoved) {
                if (createdImg) { try { await dir.removeEntry(newImgName); } catch (_) {} }
                if (createdTxt) { try { await dir.removeEntry(createdTxt); } catch (_) {} }
            }
            return false;
        }

        // Estado em memória (separado: um erro aqui não pode disparar o desfazer acima)
        try {
            if (typeof datasetConfig !== 'undefined' && datasetConfig[img.baseName]) {
                datasetConfig[newBase] = { ...datasetConfig[img.baseName] };
                delete datasetConfig[newBase].order; // entra na ordenação normal, não gruda na posição do original
            }
            if (typeof pendingTagsStore !== 'undefined' && pendingTagsStore[img.baseName]) {
                pendingTagsStore[newBase] = JSON.parse(JSON.stringify(pendingTagsStore[img.baseName]));
            }
            img.name = newImgName;
            img.baseName = newBase;
            try { img.handle = await dir.getFileHandle(newImgName); } catch (_) {}
        } catch (e) {
            console.warn('[Name Fixer] state update failed for', newBase, e);
        }
        return true;
    }

    window.fixDuplicateNames = async function () {
        if (_fixing) return;
        const btn = document.getElementById('btn-fix-dup-names');
        _fixing = true;
        if (btn) btn.disabled = true;

        try {
            let plans;
            try {
                plans = await planFixes();
            } catch (e) {
                console.error('[Name Fixer] could not read folder:', e);
                if (window.showAlert) window.showAlert('Could not read the folder to check for existing names. Nothing was changed.', 'error');
                return;
            }
            if (plans.length === 0) {
                if (window.showAlert) window.showAlert('No duplicate names found.', 'info');
                return;
            }

            const hasUnsaved = imageFiles.some(i => i.dirty);
            const preview = plans.slice(0, 10).map(p => `  ${p.oldName}  →  ${p.newImgName}`).join('\n');
            const more = plans.length > 10 ? `\n  ...and ${plans.length - 10} more` : '';
            const msg =
                `Fix ${plans.length} duplicate name(s)?\n\n` +
                `These files share a name with another file (same name, different extension), so their captions collide. ` +
                `The first file of each group keeps its name; the others get "${DUP_SUFFIX}" at the end, plus their own copy of the caption.\n\n` +
                `${preview}${more}\n\n` +
                `No existing file is overwritten.` +
                (hasUnsaved ? `\nUnsaved caption edits will be saved first.` : '');
            if (!confirm(msg)) return;

            if (hasUnsaved && typeof window.saveAllImages === 'function') await window.saveAllImages(true);

            let done = 0, failed = 0;
            for (const p of plans) {
                if (await applyPlan(p)) done++; else failed++;
            }

            if (done > 0) {
                if (typeof window.markDatasetEdited === 'function') await window.markDatasetEdited();
                if (typeof window.savePendingTagsStore === 'function') await window.savePendingTagsStore(window.currentImagesHandle);
                if (typeof window.saveDatasetConfig === 'function') await window.saveDatasetConfig(window.currentImagesHandle || window.rootHandle);
            }
            if (window.showAlert) {
                if (failed === 0) window.showAlert(`Fixed ${done} duplicate name(s).`, 'success');
                else window.showAlert(`Fixed ${done}, but ${failed} file(s) could not be renamed. Nothing was lost — check the console for details.`, 'warn');
            }
            if (done > 0 && typeof window.refreshDataset === 'function') await window.refreshDataset();
        } finally {
            _fixing = false;
            if (btn) btn.disabled = false;
        }
    };

    /* ---------- INSTALAÇÃO DO HOOK PÓS-RENDER ---------- */
    function installHook() {
        if (typeof window.registerPostRenderImageList === 'function') {
            window.registerPostRenderImageList(applyDuplicateNameAlerts);
            return true;
        }
        if (typeof window.renderImageList === 'function' && !window.renderImageList.__dupAlertWrapped) {
            const original = window.renderImageList;
            const wrapped = function () {
                original.apply(this, arguments);
                applyDuplicateNameAlerts();
            };
            wrapped.__dupAlertWrapped = true;
            window.renderImageList = wrapped;
            return true;
        }
        return false;
    }

    if (!installHook()) window.addEventListener('DOMContentLoaded', () => setTimeout(installHook, 0));

})();
