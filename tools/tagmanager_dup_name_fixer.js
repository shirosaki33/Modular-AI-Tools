/* =========================================================================
   AUTO RENAME FIXER — DUPLICATE BASE NAMES (Standalone — não mexe nos outros arquivos)
   ---------------------------------------------------------------------
   PROBLEMA QUE ISSO RESOLVE:
   Se a pasta do dataset tem, por exemplo, "gato.png" E "gato.jpg" ao
   mesmo tempo, o Tag Manager carrega os DOIS como imagens separadas na
   lista — mas como as legendas são procuradas por baseName ("gato.txt"
   ou "gato.json"), as DUAS imagens acabam lendo e, se salvas, escrevendo
   NO MESMO arquivo de legenda. Editar as tags de uma "vaza" pra outra
   sem o usuário perceber, e um rename manual das duas pra nomes
   diferentes esbarraria exatamente na checagem de colisão que
   adicionamos em window.confirmRename (tagmanager_ui_list.js).

   Este módulo detecta esses grupos (mesmo baseName, extensões de imagem
   diferentes) e RENOMEIA AUTOMATICAMENTE todas menos a primeira do
   grupo, dando um novo baseName único (ex: "gato_dup2") e criando uma
   cópia SEPARADA da legenda pra ela — sem apagar a legenda original,
   que continua pertencendo à primeira imagem do grupo.

   SEGURANÇA: reaproveita o mesmo padrão de staging em "_rename_cache"
   (ver window.confirmRename em tagmanager_ui_list.js) — a imagem
   original é copiada pra lá ANTES de qualquer escrita/remoção, e a
   cópia de staging só é apagada depois que o novo arquivo é confirmado
   no disco. Também checa colisão contra nomes já existentes na pasta
   (incluindo outros nomes já planejados nesta mesma passada) antes de
   escrever qualquer coisa.

   Fica DESLIGADO por padrão (é uma ação automática que mexe em arquivos
   sem perguntar item a item) — o usuário liga em ⚙️ Settings, e também
   pode rodar manualmente a qualquer momento com o botão "🔍 Scan & Fix".
========================================================================= */

(function () {

    window.dupNameFixerEnabled = window.dupNameFixerEnabled !== undefined ? window.dupNameFixerEnabled : false;
    window._dupFixerRunning = window._dupFixerRunning || false;
    window._dupFixerLastImageFilesRef = window._dupFixerLastImageFilesRef || null;

    /* ---------- RENAME SEGURO DE 1 ARQUIVO (mesmo padrão do confirmRename) ----------
       Diferença chave em relação ao rename manual: aqui NUNCA removemos a
       legenda antiga ("baseName.txt"/"baseName.json") depois do rename —
       ela continua pertencendo à OUTRA imagem do grupo (a que ficou com o
       nome original). Só criamos uma cópia nova, separada, pra imagem que
       está sendo renomeada, com o conteúdo que ela já estava mostrando. */
    async function safeRenameSingleImage(img, newBaseName) {
        const oldName = img.name;
        const oldExt = oldName.split('.').pop();
        const newImgName = `${newBaseName}.${oldExt}`;
        const textFormat = img.ext || 'txt';
        const oldTextName = `${img.baseName}.${textFormat}`;
        const newTextName = `${newBaseName}.${textFormat}`;

        let stagedImgName = null;
        let stagedTextName = null;

        try {
            const cacheDir = await img.parentDirHandle.getDirectoryHandle('_rename_cache', { create: true });

            // 1) Copia a imagem original pro staging ANTES de mexer em qualquer coisa
            const oldImgHandle = await img.parentDirHandle.getFileHandle(oldName);
            const oldImgFile = await oldImgHandle.getFile();
            const stagedImgHandle = await cacheDir.getFileHandle(oldName, { create: true });
            const stagedImgWritable = await stagedImgHandle.createWritable();
            await stagedImgWritable.write(await oldImgFile.arrayBuffer());
            await stagedImgWritable.close();
            stagedImgName = oldName;

            // 2) Também copia a legenda compartilhada atual pro staging (só como
            //    rede de segurança extra — ela não vai ser removida de qualquer forma)
            if (img.hasFile) {
                try {
                    const oldTextHandle = await img.parentDirHandle.getFileHandle(oldTextName);
                    const oldTextFile = await oldTextHandle.getFile();
                    const stagedTextHandle = await cacheDir.getFileHandle(`${newBaseName}__src.${textFormat}`, { create: true });
                    const stagedTextWritable = await stagedTextHandle.createWritable();
                    await stagedTextWritable.write(await oldTextFile.arrayBuffer());
                    await stagedTextWritable.close();
                    stagedTextName = `${newBaseName}__src.${textFormat}`;
                } catch (e) { /* sem legenda no disco ainda — tudo bem */ }
            }

            // 3) Escreve a imagem com o novo nome, lendo da cópia staged
            const stagedImgFile = await (await cacheDir.getFileHandle(oldName)).getFile();
            const newImgHandle = await img.parentDirHandle.getFileHandle(newImgName, { create: true });
            const writableImg = await newImgHandle.createWritable();
            await writableImg.write(await stagedImgFile.arrayBuffer());
            await writableImg.close();

            // 4) Cria uma legenda SEPARADA pra esta imagem, com o conteúdo atual
            //    em memória (o mesmo que ela estava exibindo, herdado do arquivo
            //    compartilhado) — sem tocar na legenda original da outra imagem.
            if (img.hasFile) {
                const contentToWrite = textFormat === 'json'
                    ? JSON.stringify({ tags: img.content }, null, 2)
                    : img.content;
                const newTextHandle = await img.parentDirHandle.getFileHandle(newTextName, { create: true });
                const writableText = await newTextHandle.createWritable();
                await writableText.write(contentToWrite);
                await writableText.close();
                if (typeof window.markClean === 'function') window.markClean(img);
            }

            // 5) Remove só a imagem antiga (a legenda "baseName.txt" fica intacta —
            //    ela pertence à outra imagem do grupo, que manteve o nome original)
            if (oldName !== newImgName) {
                try { await img.parentDirHandle.removeEntry(oldName); } catch (e) {}
            }

            // 6) Limpa o staging (rename confirmado com sucesso)
            try { await cacheDir.removeEntry(stagedImgName); } catch (e) {}
            if (stagedTextName) { try { await cacheDir.removeEntry(stagedTextName); } catch (e) {} }

            // 7) Metadados (config/pending/hidden) — copiados, não movidos, já que
            //    a entrada original (baseName antigo) ainda representa a OUTRA imagem.
            if (typeof datasetConfig !== 'undefined' && datasetConfig[img.baseName]) {
                datasetConfig[newBaseName] = { ...datasetConfig[img.baseName] };
                delete datasetConfig[newBaseName].order;
            }
            if (typeof pendingTagsStore !== 'undefined' && pendingTagsStore[img.baseName]) {
                pendingTagsStore[newBaseName] = pendingTagsStore[img.baseName].slice();
            }
            if (window.hiddenImagesStore && window.hiddenImagesStore.has(img.baseName)) {
                window.hiddenImagesStore.add(newBaseName);
            }

            img.name = newImgName;
            img.baseName = newBaseName;
            return true;
        } catch (e) {
            console.error('[Dup Name Fixer] Failed to rename', oldName, e);
            return false;
        }
    }

    async function listExistingNames(dirHandle, cacheMap) {
        if (cacheMap.has(dirHandle)) return cacheMap.get(dirHandle);
        const names = new Set();
        try { for await (const entry of dirHandle.values()) names.add(entry.name); } catch (e) {}
        cacheMap.set(dirHandle, names);
        return names;
    }

    async function findUniqueDupName(baseName, ext, img, existingNamesCache, claimedNames) {
        let n = 2;
        const existing = await listExistingNames(img.parentDirHandle, existingNamesCache);
        while (true) {
            const candidateBase = `${baseName}_dup${n}`;
            const candidateImgName = `${candidateBase}.${ext}`;
            if (!existing.has(candidateImgName) && !claimedNames.has(candidateImgName)) {
                return candidateBase;
            }
            n++;
        }
    }

    /* ---------- SCAN + FIX ---------- */
    window.runDupNameFixer = async function (manual = false) {
        if (window._dupFixerRunning) {
            if (manual && window.showAlert) window.showAlert('A scan is already running.', 'info');
            return;
        }
        if (typeof imageFiles === 'undefined' || imageFiles.length === 0) {
            if (manual && window.showAlert) window.showAlert('No dataset loaded.', 'warn');
            return;
        }

        // Agrupa por baseName — como imageFiles só contém extensões de imagem
        // reconhecidas (png/jpg/jpeg/webp), um grupo com mais de 1 item só pode
        // acontecer quando o MESMO nome existe com extensões de imagem diferentes.
        const groups = new Map();
        imageFiles.forEach(img => {
            if (!groups.has(img.baseName)) groups.set(img.baseName, []);
            groups.get(img.baseName).push(img);
        });
        const dupGroups = Array.from(groups.values()).filter(g => g.length > 1);

        if (dupGroups.length === 0) {
            if (manual && window.showAlert) window.showAlert('No duplicate filenames found in this dataset. 👍', 'success');
            return;
        }

        window._dupFixerRunning = true;
        const existingNamesCache = new Map();
        const claimedNames = new Set();
        let fixedCount = 0;
        const fixedPairs = [];

        for (const group of dupGroups) {
            // Mantém a primeira imagem do grupo (ordem já vem alfabética, de
            // imageFiles) intocada; renomeia as demais.
            const [keepImg, ...toRename] = group;
            for (const img of toRename) {
                const ext = img.name.split('.').pop();
                const newBaseName = await findUniqueDupName(img.baseName, ext, img, existingNamesCache, claimedNames);
                claimedNames.add(`${newBaseName}.${ext}`);
                const oldNameForLog = img.name;
                const ok = await safeRenameSingleImage(img, newBaseName);
                if (ok) {
                    fixedCount++;
                    fixedPairs.push(`${oldNameForLog} ➜ ${newBaseName}.${ext}`);
                }
            }
        }

        window._dupFixerRunning = false;

        if (fixedCount > 0) {
            if (typeof window.markDatasetEdited === 'function') await window.markDatasetEdited();
            if (typeof window.savePendingTagsStore === 'function') await window.savePendingTagsStore(window.currentImagesHandle || window.rootHandle);
            if (window.showAlert) {
                const preview = fixedPairs.slice(0, 3).join(' · ');
                const more = fixedPairs.length > 3 ? ` (+${fixedPairs.length - 3} more)` : '';
                window.showAlert(`🔧 Auto-Fixed ${fixedCount} duplicate filename(s): ${preview}${more}`, 'success');
            }
            if (typeof window.refreshDataset === 'function') await window.refreshDataset();
        } else if (manual && window.showAlert) {
            window.showAlert('Found duplicate names but none could be auto-fixed — check the console for details.', 'warn');
        }
    };

    /* ---------- AUTO-RUN AO CARREGAR UM DATASET NOVO ----------
       Antes: wrap próprio de renderImageList com setTimeout independente —
       rodava ao mesmo tempo que o scan do Danbooru e o auto-merge, podendo
       renomear arquivos enquanto outro processo ainda lia/escrevia neles.
       Agora registra na fila serializada (tagmanager_auto_task_queue.js),
       que roda os 3 scans automáticos em sequência, nunca em paralelo. */
    function hookAutoDupFixer() {
        if (typeof window.registerAutoDatasetTask === 'function') {
            if (window._dupFixerRegistered) return;
            window.registerAutoDatasetTask('dup-name-fixer', async () => {
                if (window.dupNameFixerEnabled) await window.runDupNameFixer(false);
            });
            window._dupFixerRegistered = true;
            return;
        }
        // Fallback (caso tagmanager_auto_task_queue.js não tenha carregado)
        if (typeof window.renderImageList !== 'function' || window.renderImageList.__dupFixerWrapped) return;
        const original = window.renderImageList;
        const wrapped = function () {
            original.apply(this, arguments);
            if (typeof imageFiles !== 'undefined' && imageFiles !== window._dupFixerLastImageFilesRef) {
                window._dupFixerLastImageFilesRef = imageFiles;
                if (window.dupNameFixerEnabled) {
                    setTimeout(() => window.runDupNameFixer(false), 500);
                }
            }
        };
        wrapped.__dupFixerWrapped = true;
        window.renderImageList = wrapped;
    }

    /* ---------- UI: TOGGLE ESTÁTICO (já existe no HTML, dentro de #settings-dropdown) ----------
       Mesmo padrão de window.toggleE621 / window.toggleDanbooruCounts (tagmanager_ui_core.js):
       o checkbox já vem escrito direto no HTML (não é injetado via JS), então só precisamos
       ler o estado salvo, marcar o checkbox e ligar o onchange. */
    window.toggleDupNameFixer = function (skipSave = false) {
        const checkbox = document.getElementById('toggle-dup-name-fixer');
        if (checkbox) {
            window.dupNameFixerEnabled = checkbox.checked;
            if (!skipSave && typeof window.saveSetting === 'function') window.saveSetting('dup-name-fixer-enabled', window.dupNameFixerEnabled);
        }
        if (window.dupNameFixerEnabled) window.runDupNameFixer(false);
    };

    window.addEventListener('DOMContentLoaded', async () => {
        if (typeof window.getSetting === 'function') {
            window.dupNameFixerEnabled = await window.getSetting('dup-name-fixer-enabled', false);
        }
        const checkbox = document.getElementById('toggle-dup-name-fixer');
        if (checkbox) checkbox.checked = window.dupNameFixerEnabled;
        hookAutoDupFixer();
    });

})();