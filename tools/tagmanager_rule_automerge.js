/* =========================================================================
   3. AUTO-MERGE / AUTO-DO - TAG MANAGER
   ---------------------------------------------------------------------
   Auto-Do UI, Execution Engine, and Embeds Manager.

   REFACTOR (Trigger Tags agora OPCIONAIS):
   Antes, TODA regra de Auto-Do precisava de pelo menos 1 "Trigger Tag"
   (removeTags) presente pra disparar — mesmo quando o Require já usava
   um @embedName inteiro como condição. Isso obrigava o usuário a sempre
   digitar uma tag de gatilho específica, mesmo em casos onde a intenção
   era só "se qualquer tag deste embed aparecer, adiciona X".

   Agora Trigger Tags é opcional, tanto em Fill quanto em Merge:
   - Se Trigger Tags estiver preenchido: continua exigindo que pelo menos
     1 delas esteja presente (comportamento de sempre).
   - Se Trigger Tags estiver VAZIO: o gatilho passa a ser só o Require
     (que pode ser tags soltas e/ou @embedName) — ou seja, dá pra criar
     uma regra 100% baseada em embed, sem digitar nenhuma tag de gatilho
     manualmente.
   - Uma regra sem NENHUM gatilho (Trigger Tags E Require os dois vazios)
     nunca dispara — evita virar uma regra "sempre ativa" sem querer.

   REFACTOR (edição via prompt() -> formulário inline):
   ✏️ Edit não abre mais um prompt() com texto separado por "|". O card da
   regra vira, no lugar dele mesmo, um formulário com campos separados
   (Main Tag, modo Fill/Merge, Trigger Tags, Requires, Excludes) e os
   botões viram ✅ Update / ✖ Cancel — mesmo padrão já usado em Embeds e
   Custom Highlights.
========================================================================= */

(function () {
    const FACTORY_EMBEDS = [
        { name: 'clothing', tags: ['shirt', 'dress', 'skirt', 'pants', 'shorts', 'jeans', 'jacket', 'coat', 'sweater', 'hoodie', 'cardigan', 'vest', 'blazer', 'uniform', 'suit', 'kimono', 'robe', 'gown', 'swimsuit', 'bikini', 'lingerie', 'underwear', 'panties', 'bra', 'boxers', 'briefs', 'socks', 'thighhighs', 'pantyhose', 'stockings', 'leggings', 'gloves', 'mittens', 'scarf', 'tie', 'necktie', 'bowtie', 'collar', 'hat', 'cap', 'hood', 'veil', 'mask', 'apron', 'overalls', 'romper', 'leotard', 'bodysuit', 'top', 'blouse', 'tank top', 'crop top', 'tube top', 'camisole', 'corset', 'harness', 'belt', 'shoes', 'boots', 'sandals', 'heels', 'sneakers', 'slippers', 'armor', 'clothes', 'clothing', 'outfit', 'costume'] },
        { name: 'solidbackground', tags: ['simple background', 'white background', 'black background', 'transparent background', 'blue background', 'red background', 'green background', 'yellow background', 'pink background', 'purple background', 'grey background', 'brown background', 'orange background'] }
    ];

    FACTORY_EMBEDS.forEach((emb, i) => window.RulesDB.factoryRules.push({ id: 'def_emb_'+i, category: 'embed', isDefault: true, name: emb.name, tags: emb.tags }));

    window.RulesDB.factoryRules.push({ id: 'def_am_0', category: 'automerge', isDefault: true, keepTag: 'nude', removeTags: ['completely nude'], require: [], exclude: ['full body', '@clothing'], isAutoFill: false });
    window.RulesDB.factoryRules.push({ id: 'def_am_1', category: 'automerge', isDefault: true, keepTag: 'completely nude', removeTags: ['nude'], require: ['full body'], exclude: ['@clothing'], isAutoFill: false });
    window.RulesDB.factoryRules.push({ id: 'def_am_2', category: 'automerge', isDefault: true, keepTag: 'tachi-e', removeTags: ['visual novel cg'], require: ['@solidbackground'], exclude: [], isAutoFill: true });
    // Exemplo de gatilho 100% por Embed (Trigger Tags vazio de propósito):
    // Estado do modo edição inline do Embed Manager: guarda o ID do embed
    // sendo editado agora (ou null se nenhum). Fica no escopo do módulo,
    // então sobrevive a qualquer refreshEmbedList() intermediário.
    let _embedEditingId = null;

    // Mesma ideia, agora para o card de regra Auto-Do sendo editado.
    let _amEditingId = null;

    // --- ENGINE ---
    window.matchTag = function(tag, condition, embeds) {
        const t = tag.toLowerCase(); const c = condition.toLowerCase();
        if (c.startsWith('@')) {
            const embedName = c.slice(1);
            const embed = embeds.find(e => (e.name || '').toLowerCase() === embedName);
            if (embed && Array.isArray(embed.tags)) return embed.tags.some(eTag => eTag.toLowerCase() === t);
            return false;
        }
        return t === c;
    };

    window.runAutoMergeRule = function(tagsArray, rule, embeds) {
        const keep = (rule.keepTag && String(rule.keepTag).trim() !== '') ? String(rule.keepTag).trim() : '';
        const keepLower = keep.toLowerCase();
        const reqs = Array.isArray(rule.require) ? rule.require : [];
        const excs = Array.isArray(rule.exclude) ? rule.exclude : [];

        // Trigger Tags (removeTags) are OPTIONAL and may be plain tags or
        // @embedName. The Main Tag is never treated as a trigger of its own
        // rule (otherwise Merge would remove and re-add it on every run).
        const removes = (Array.isArray(rule.removeTags) ? rule.removeTags : [])
            .filter(r => String(r).trim() !== '' && String(r).trim().toLowerCase() !== keepLower);

        // A rule with NO trigger at all (no Trigger Tags and no Require) never
        // fires, so it can't become an "always on" rule by accident.
        if (removes.length === 0 && reqs.length === 0) return null;

        const isTrigger = t => String(t).toLowerCase() !== keepLower && removes.some(rem => matchTag(t, rem, embeds));
        if (removes.length > 0 && !tagsArray.some(isTrigger)) return null;

        const hasRequired = reqs.length === 0 || reqs.every(req => tagsArray.some(t => matchTag(t, req, embeds)));
        const hasExcluded = excs.length > 0 && tagsArray.some(t => excs.some(ex => matchTag(t, ex, embeds)));
        if (!hasRequired || hasExcluded) return null;

        const alreadyHasKeep = keep !== '' && tagsArray.some(t => String(t).toLowerCase() === keepLower);

        if (rule.isAutoFill) {
            // Fill: keep the trigger tags, just add the Main Tag (case-insensitive check).
            const out = [...tagsArray];
            if (keep && !alreadyHasKeep) out.push(keep);
            return out;
        }

        // Merge: drop the trigger tags and put the Main Tag where the FIRST
        // removed trigger used to be (so tag order is preserved). With no
        // trigger present (embed-only rule) it is appended at the end.
        const out = [];
        let placed = false;
        tagsArray.forEach(t => {
            if (isTrigger(t)) {
                if (keep && !alreadyHasKeep && !placed) { out.push(keep); placed = true; }
                return;
            }
            out.push(t);
        });
        if (keep && !alreadyHasKeep && !placed) out.push(keep);
        return out;
    };

    /* =====================================================================
       BALÃO DE NOTIFICAÇÃO — "Auto-Do fez mudanças"
       ---------------------------------------------------------------------
       Visual igual ao #unsaved-changes-alert já existente (mesma borda,
       mesmo estilo de barra), só que específico do Auto-Do — pra deixar
       claro que foi o Auto-Do (não uma edição manual) que alterou tags.
       Diferente do #unsaved-changes-alert (que é fixo no HTML), este é
       criado por JS e ancorado logo depois dele, mantendo a mesma posição/
       ordem de leitura sem precisar tocar em tag_manager.html.

       CICLO DE VIDA:
       - Aparece assim que runAutoMergeOnDataset() modifica 1+ imagem(ns),
         seja rodando automaticamente (dataset carregado com "Auto-Run"
         ligado) ou manualmente (botão "▶ Run Auto-Do Now").
       - Tem um ✖ pra dispensar manualmente.
       - Some sozinho quando NÃO sobra mais nenhuma mudança pendente no
         dataset (tudo já foi salvo) — reaproveita o mesmo sinal usado pelo
         #unsaved-changes-alert (img.dirty), então funciona mesmo se o
         usuário salvar por qualquer caminho (Save Selected, Save All,
         etc), sem precisar duplicar lógica de salvamento aqui.
       - Zera/esconde ao trocar de dataset (pasta/subpasta diferente) —
         uma contagem de "N imagens alteradas" de um dataset anterior não
         faz sentido continuar aparecendo depois de trocar de pasta.
    ===================================================================== */

    window._autoDoChangedCount = window._autoDoChangedCount || 0;
    window._autoDoAlertDismissed = window._autoDoAlertDismissed || false;
    window._autoDoTouched = window._autoDoTouched || new Set(); // images Auto-Do changed (balloon counts the ones still unsaved)

    function ensureAutoDoAlertBar() {
        let bar = document.getElementById('autodo-changes-alert');
        if (bar) return bar;

        bar = document.createElement('div');
        bar.id = 'autodo-changes-alert';
        bar.style.cssText = 'display:none; margin: 8px 20px 0 20px; padding: 10px 14px; border-left: 3px solid #00ff99; border-right: 3px solid #00ff99; background: #0d1f16; color: #f5f5f5; border-radius: 7px; font-size: 13.5px; line-height: 1.45; text-align: center; box-sizing: border-box; flex-shrink: 0; position: relative;';

        const unsavedBar = document.getElementById('unsaved-changes-alert');
        const workspace = document.getElementById('workspace');
        if (unsavedBar && unsavedBar.parentNode) {
            unsavedBar.insertAdjacentElement('afterend', bar);
        } else if (workspace && workspace.parentNode) {
            workspace.parentNode.insertBefore(bar, workspace);
        } else {
            document.body.appendChild(bar);
        }
        return bar;
    }

    window.updateAutoDoAlertUI = function () {
        const bar = ensureAutoDoAlertBar();

        // The balloon counts only the images Auto-Do touched that are STILL
        // unsaved (img.dirty). Saved images drop out of the count by
        // themselves; when none is left the balloon hides and resets.
        // (Before, this ran BEFORE markDirty(), saw nothing dirty and zeroed
        // the counter, so the balloon almost never showed up.)
        let n = 0;
        window._autoDoTouched.forEach(img => { if (img && img.dirty) n++; });
        if (n === 0) {
            window._autoDoTouched.clear();
            window._autoDoChangedCount = 0;
            window._autoDoAlertDismissed = false;
            bar.style.display = 'none';
            return;
        }
        window._autoDoChangedCount = n;
        if (window._autoDoAlertDismissed) { bar.style.display = 'none'; return; }

        bar.style.display = 'block';
        const plural = n === 1 ? 'image' : 'images';
        bar.innerHTML = `
            <span style="color:#00ff99;margin:0 6px;font-size:14px;line-height:1;">⚡</span>
            Auto-Do automatically modified tags in ${n} ${plural} — review and save when ready
            <span style="color:#00ff99;margin:0 6px;font-size:14px;line-height:1;">⚡</span>
            <button id="btn-dismiss-autodo-alert" title="Dismiss this notice" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); background:transparent; border:none; color:#88ffcc; font-size:16px; font-weight:bold; cursor:pointer; padding:0 6px; line-height:1;">&times;</button>
        `;
        const dismissBtn = document.getElementById('btn-dismiss-autodo-alert');
        if (dismissBtn) {
            dismissBtn.onclick = () => {
                window._autoDoAlertDismissed = true;
                window.updateAutoDoAlertUI();
            };
        }
    };

    // Mantém o balão em sincronia com o estado de "salvo"/"não salvo":
    // o hub dispara 'ui:unsaved' depois de window.updateUnsavedChangesUI().
    function installAutoDoAlertUnsavedHook() {
        if (!window.TM || !window.TM.on) return false;
        window.TM.on('ui:unsaved', () => window.updateAutoDoAlertUI());
        return true;
    }
    if (!installAutoDoAlertUnsavedHook()) window.addEventListener('DOMContentLoaded', () => setTimeout(installAutoDoAlertUnsavedHook, 0));

    // Zera o balão sempre que o dataset/subpasta muda (evento do hub TM).
    function resetAutoDoAlertOnDatasetChange() {
        window._autoDoTouched.clear();
        window._autoDoChangedCount = 0;
        window._autoDoAlertDismissed = false;
        window.updateAutoDoAlertUI();
    }
    function installAutoDoAlertDatasetHook() {
        if (!window.TM || !window.TM.on) return false;
        if (!window._autoDoAlertHookRegistered) {
            window.TM.on('dataset:loaded', resetAutoDoAlertOnDatasetChange);
            window._autoDoAlertHookRegistered = true;
        }
        return true;
    }
    if (!installAutoDoAlertDatasetHook()) window.addEventListener('DOMContentLoaded', () => setTimeout(installAutoDoAlertDatasetHook, 0));

    window.runAutoMergeOnDataset = async function(manual = false) {
        if (window.enableConflictWarnings === false) {
            if (manual && window.showAlert) window.showAlert('Auto-Do is part of "Tag Manager Rules" — enable it in Settings first.', 'warn');
            return 0;
        }
        if (!window.imageFiles || window.imageFiles.length === 0) { if (manual && window.showAlert) window.showAlert('No dataset loaded.', 'warn'); return 0; }

        const rows = await window.RulesDB.getAllRules();
        const amRules = rows.filter(r => r.category === 'automerge').map(row => {
            if (Array.isArray(row.tags) && row.tags.length > 0) return { keepTag: row.tags[0], removeTags: row.tags.slice(1), require: [], exclude: [], isAutoFill: false };
            if (row.target) return { keepTag: row.fallback, removeTags: [row.target], require: Array.isArray(row.exclude) ? row.exclude : [], exclude: Array.isArray(row.require) ? row.require : [], isAutoFill: false };
            if (!Array.isArray(row.removeTags)) row.removeTags = [];
            return row;
        });

        const embeds = rows.filter(r => r.category === 'embed');
        if (amRules.length === 0) { if (manual && window.showAlert) window.showAlert('No Auto-Do rules configured.', 'warn'); return 0; }

        let changedCount = 0; const modifiedFiles = [];
        const removedMap = new Map(); // tag -> [baseName] (what Auto-Do took out, for the Removed Tags History)
        window.imageFiles.forEach(img => {
            if (img.type === 'tags' && img.content && !img.hidden) {
                const originalTags = img.content.split(',').map(t => t.trim()).filter(t => t);
                let currentTags = [...originalTags];
                amRules.forEach(rule => { const res = runAutoMergeRule(currentTags, rule, embeds); if (res) currentTags = res; });
                if (originalTags.join(',') !== currentTags.join(',')) {
                    const nowSet = new Set(currentTags.map(t => t.toLowerCase()));
                    originalTags.forEach(t => {
                        if (nowSet.has(t.toLowerCase())) return;
                        if (!removedMap.has(t)) removedMap.set(t, []);
                        removedMap.get(t).push(img.baseName);
                    });
                    img.content = currentTags.join(', '); img.hasFile = true; modifiedFiles.push(img); changedCount++;
                }
            }
        });

        if (changedCount === 0) {
            if (manual && window.showAlert) window.showAlert('No matching tags found to automate.', 'info');
            return 0;
        }

        // Removed Tags History: every tag Auto-Do took out is listed there, marked "Auto-Do".
        if (removedMap.size > 0 && typeof window.recordRemovedTags === 'function') window.recordRemovedTags(removedMap, 'Auto-Do');

        // markDirty FIRST, then tell the balloon which images were touched.
        if (typeof window.markDirty === 'function') window.markDirty(modifiedFiles);
        modifiedFiles.forEach(img => window._autoDoTouched.add(img));
        window._autoDoAlertDismissed = false;
        if (typeof window.updateAutoDoAlertUI === 'function') window.updateAutoDoAlertUI();

        if (typeof window.markDatasetEdited === 'function') window.markDatasetEdited();
        if (window.masterTagSet) {
            window.masterTagSet.clear();
            window.imageFiles.forEach(img => { if(img.type === 'tags' && img.content) img.content.split(',').forEach(t => { if(t.trim()) window.masterTagSet.add(t.trim()); }); });
        }
        if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
        if (typeof window.renderImageList === 'function') window.renderImageList();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.renderEditor === 'function') window.renderEditor();
        if (typeof window.applyFilters === 'function') window.applyFilters();
        if (typeof window.updateAutoDoAlertUI === 'function') window.updateAutoDoAlertUI();

        if (window.showAlert) window.showAlert(`Auto-Do applied to ${changedCount} image(s)!`, 'success');
        return changedCount;
    };

    /* =====================================================================
       USAGE RULE — "run only once per dataset"
       ---------------------------------------------------------------------
       With the option ON (Manage Rules → Auto-Do, default), the AUTOMATIC
       run happens only:
         1. the first time a dataset is opened (remembered per dataset in
            its _tagger_config.json as autoDoDone), and
         2. right after an Auto-Caption batch finishes.
       After that it stays quiet (reloads, refreshes, subfolder hops...) and
       only runs from the "▶ Run Auto-Do Now" button. With the option OFF it
       runs on every dataset load, as it used to.
    ===================================================================== */
    const _autoDoSessionDone = new WeakSet();
    window._autoDoAfterCaptionAt = 0;

    function autoDoHandleKey() { return window.currentImagesHandle || window.rootHandle || null; }

    function isDatasetAutoDone() {
        const h = autoDoHandleKey();
        if (h && _autoDoSessionDone.has(h)) return true;
        return (typeof datasetConfig !== 'undefined' && datasetConfig && datasetConfig.autoDoDone === true);
    }

    async function markDatasetAutoDone() {
        const h = autoDoHandleKey();
        if (h) _autoDoSessionDone.add(h);
        if (typeof datasetConfig !== 'undefined' && datasetConfig && datasetConfig.autoDoDone !== true) {
            datasetConfig.autoDoDone = true;
            if (h && typeof window.saveDatasetConfig === 'function') { try { await window.saveDatasetConfig(h); } catch (e) {} }
        }
    }

    // Used by the "↺ Re-arm" button: makes the current dataset count as "never opened".
    window.rearmAutoDoForCurrentDataset = async function () {
        const h = autoDoHandleKey();
        try { if (h) _autoDoSessionDone.delete(h); } catch (e) {}
        if (typeof datasetConfig !== 'undefined' && datasetConfig && datasetConfig.autoDoDone) {
            delete datasetConfig.autoDoDone;
            if (h && typeof window.saveDatasetConfig === 'function') { try { await window.saveDatasetConfig(h); } catch (e) {} }
        }
        if (window.showAlert) window.showAlert('Auto-Do re-armed: it will run automatically the next time this dataset loads.', 'info');
    };

    async function autoDoQueueHandler() {
        if (window.enableConflictWarnings === false) return;
        const autoRun = await window.getSetting('rm_auto_merge', false);
        const afterCaption = (Date.now() - (window._autoDoAfterCaptionAt || 0)) < 120000;
        if (!autoRun) { window._autoDoAfterCaptionAt = 0; return; }
        const once = await window.getSetting('rm_auto_once', true);

        // The dataset was replaced again while this queue pass was running:
        // the extra pass that follows will reach us with the fresh data.
        if (window._autoTaskQueuePending) return;
        if (!window.imageFiles || window.imageFiles.length === 0) return;

        if (once && !afterCaption && isDatasetAutoDone()) return;

        window._autoDoAfterCaptionAt = 0;
        await window.runAutoMergeOnDataset(false);
        if (once) await markDatasetAutoDone();
    }

    // Auto-Caption finished (non-review mode ends with a dataset refresh) → re-arm for one run.
    function installAutoCaptionHook() {
        if (typeof window.startBatchTagging !== 'function') return false;
        if (window.startBatchTagging.__autoDoWrapped) return true;
        const original = window.startBatchTagging;
        const wrapped = async function () {
            const refBefore = (typeof imageFiles !== 'undefined') ? imageFiles : null;
            const result = await original.apply(this, arguments);
            // A real batch ends with refreshDataset() → new imageFiles reference.
            // Early exits (no model, no folder) and Review Mode don't refresh.
            if (typeof imageFiles !== 'undefined' && imageFiles !== refBefore) window._autoDoAfterCaptionAt = Date.now();
            return result;
        };
        wrapped.__autoDoWrapped = true;
        window.startBatchTagging = wrapped;
        return true;
    }

    window.RulesCore.hookAutoMergeLoader = function() {
        if (!installAutoCaptionHook()) setTimeout(installAutoCaptionHook, 500);
        if (window._autoMergeHooked) return;
        if (typeof window.registerAutoDatasetTask === 'function') {
            // priority 90 → runs after every other automatic dataset task
            window.registerAutoDatasetTask('auto-merge', autoDoQueueHandler, 90);
            window._autoMergeHooked = true; return;
        }
        if (window.TM && window.TM.on) {
            window.TM.on('dataset:loaded', () => setTimeout(() => { autoDoQueueHandler().catch(e => console.warn('[Auto-Do]', e)); }, 600));
            window._autoMergeHooked = true;
        }
    };

    // --- UI AUTO MERGE ---
    function renderAutoMergeSection(rows, isChecked, isOnce) {
        const meta = window.CATEGORY_META.automerge;
        const categoryRows = rows.filter(r => r.category === 'automerge');
        categoryRows.sort((a, b) => (a.isDefault === b.isDefault ? 0 : (a.isDefault ? -1 : 1)));

        const wrap = document.createElement('div');
        wrap.className = 'panel';
        wrap.style.cssText = 'flex: 1; display: flex; flex-direction: column; background: #1b1b1b; border: 1px solid #222; border-radius: 10px; overflow: hidden; min-height: 0;';

        const header = document.createElement('div');
        header.className = 'panel-header';
        header.style.cssText = `background: #222; padding: 12px 15px; font-size: 13px; font-weight: bold; color: ${meta.color}; border-bottom: 1px solid #333; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;`;
        
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" id="cb-auto-merge" ${isChecked ? 'checked' : ''} style="margin:0; cursor:pointer;" title="Auto-Run when a folder finishes loading">
                <span>${meta.label}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <button onclick="window.RulesCore.restoreCategoryDefaults('automerge')" title="Restore original rules" style="background:transparent; border:none; color:#888; cursor:pointer; font-size:14px; padding:0; transition:0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#888'">🔄</button>
                <span style="background:#111; color:#aaa; padding:3px 8px; border-radius:6px; font-size:11px; border:1px solid #333;">${categoryRows.length} rules</span>
            </div>
        `;
        header.querySelector('#cb-auto-merge').onchange = async (e) => { await window.saveSetting('rm_auto_merge', e.target.checked); };
        wrap.appendChild(header);

        /* USAGE RULE: automatic run only on first open + after Auto-Caption */
        const optRow = document.createElement('div');
        optRow.style.cssText = 'padding: 9px 15px; background: #0f1a14; border-bottom: 1px solid #222; flex-shrink: 0; font-size: 11px; color: #9fd8bb; line-height: 1.45; display:flex; align-items:flex-start; gap:10px;';
        optRow.innerHTML = `
            <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer; flex:1;" title="ON: the automatic run happens only the first time a dataset is opened and right after an Auto-Caption batch. OFF: it runs every time a dataset loads.">
                <input type="checkbox" id="cb-auto-once" ${isOnce ? 'checked' : ''} style="margin:2px 0 0 0; cursor:pointer;">
                <span><b>Run automatically only once per dataset</b> — on its first open and right after Auto-Caption. After that it only runs with <b>▶ Run Auto-Do Now</b>. Uncheck to run on every dataset load.</span>
            </label>
            <button id="btn-auto-rearm" title="Make the current dataset count as never opened, so the automatic run happens again on its next load" style="flex-shrink:0; background:#151515; border:1px solid #2e7d32; color:#4caf50; font-size:11px; padding:4px 8px; border-radius:4px; cursor:pointer; font-weight:bold;">↺ Re-arm dataset</button>
        `;
        optRow.querySelector('#cb-auto-once').onchange = async (e) => { await window.saveSetting('rm_auto_once', e.target.checked); };
        optRow.querySelector('#btn-auto-rearm').onclick = () => window.rearmAutoDoForCurrentDataset();
        wrap.appendChild(optRow);

        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:11px; color:#aaa; padding: 12px 15px; background: #151515; border-bottom: 1px solid #222; flex-shrink: 0; line-height: 1.5;';
        hint.innerHTML = `<b>${meta.hint}</b><br><span style="color:#777; margin-top:6px; display:inline-block;">${meta.desc}</span><br><span style="color:#666; margin-top:4px; display:inline-block;">Trigger Tags are optional and accept <b>@embedName</b> too — leave them empty and use Require with an <b>@embedName</b> to fire a rule purely from an embed group (e.g. "any @clothing tag present → add 'clothed'").</span><br><span style="color:#666; margin-top:4px; display:inline-block;">Rules run top to bottom (Originals first, then yours) and each one sees the result of the previous one. Merge puts the Main Tag where the first removed Trigger was. Every tag Auto-Do removes is listed in 🕘 Removed Tags History, marked ⚡ Auto-Do.</span>`;
        wrap.appendChild(hint);

        const list = document.createElement('div');
        list.className = 'panel-list-scroll';
        list.style.cssText = 'flex: 1; overflow-y: auto; display: flex; flex-direction: column; background: #111; padding: 10px; gap: 6px;';

        if (categoryRows.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:12px; color:#555; font-style:italic; text-align: center; margin-top: 30px;';
            empty.textContent = 'No rules in this category.';
            list.appendChild(empty);
        }

        categoryRows.forEach(row => {
            const item = document.createElement('div');
            item.className = 'conflict-group-item';

            let keep = row.keepTag || '';
            let rems = Array.isArray(row.removeTags) ? row.removeTags : [];
            let reqs = Array.isArray(row.require) ? row.require : [];
            let excs = Array.isArray(row.exclude) ? row.exclude : [];
            let isAutoFill = !!row.isAutoFill;
            
            if (row.tags && Array.isArray(row.tags)) { keep = row.tags[0] || ''; rems = row.tags.slice(1); } 
            else if (row.target) { keep = row.fallback || ''; rems = [row.target]; reqs = Array.isArray(row.exclude) ? row.exclude : []; excs = Array.isArray(row.require) ? row.require : []; }

            if (_amEditingId === row.id) {
                /* ---------- MODO EDIÇÃO INLINE ----------
                   O card vira um formulário (Main Tag + modo + Trigger/Require/
                   Exclude) com Update/Cancel, no lugar do antigo prompt() de
                   uma linha só separada por "|". */
                item.style.cssText = `display:flex; flex-direction:column; gap:8px; background:#151515; border:1px solid ${meta.color}; border-radius:6px; padding:10px;`;
                item.innerHTML = `
                    <div style="font-size:11px; color:${meta.color}; font-weight:bold;">✏️ Editing rule</div>
                    <div style="display:flex; gap:6px;">
                        <input type="text" class="am-edit-keep" value="${window.RulesUI.escapeHTML(keep)}" placeholder="Main Tag (to add)" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width:0;">
                        <select class="am-edit-mode" style="flex:0 0 100px; font-size:11px; background:#222; border:1px solid #444; color:#fff; padding:6px;">
                            <option value="fill" ${isAutoFill ? 'selected' : ''}>➕ Fill</option>
                            <option value="merge" ${!isAutoFill ? 'selected' : ''}>🔀 Merge</option>
                        </select>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <label style="font-size:10px; color:#888;">Trigger Tags <span style="color:#666;">(optional, comma-sep, or @embedName — leave empty to trigger only by Require)</span></label>
                        <input type="text" class="am-edit-remove" value="${window.RulesUI.escapeHTML(rems.join(', '))}" placeholder="e.g. visual novel cg" style="font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <label style="font-size:10px; color:#888;">Requires <span style="color:#666;">(comma-sep, or @embedName)</span></label>
                        <input type="text" class="am-edit-req" value="${window.RulesUI.escapeHTML(reqs.join(', '))}" placeholder="e.g. @clothing" style="font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <label style="font-size:10px; color:#888;">Excludes <span style="color:#666;">(comma-sep, or @embedName)</span></label>
                        <input type="text" class="am-edit-exc" value="${window.RulesUI.escapeHTML(excs.join(', '))}" placeholder="e.g. @clothing" style="font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff;">
                    </div>
                    <div style="display:flex; gap:6px; justify-content:flex-end;">
                        <button class="btn-am-cancel" style="background:#222; border:1px solid #444; color:#aaa; font-size:11px; padding:6px 14px; border-radius:4px; cursor:pointer; font-weight:bold;">✖ Cancel</button>
                        <button class="btn-am-update" style="background:#00aa66; border:none; color:#000; font-size:11px; padding:6px 14px; border-radius:4px; cursor:pointer; font-weight:bold;">✅ Update</button>
                    </div>
                `;

                item.querySelector('.btn-am-cancel').onclick = () => {
                    _amEditingId = null;
                    window.RulesUI.refreshModalBody();
                };

                item.querySelector('.btn-am-update').onclick = async () => {
                    const newKeep = item.querySelector('.am-edit-keep').value.trim();
                    const newMode = item.querySelector('.am-edit-mode').value;
                    const newRemove = item.querySelector('.am-edit-remove').value.split(',').map(t => t.trim()).filter(t => t);
                    const newReq = item.querySelector('.am-edit-req').value.split(',').map(t => t.trim()).filter(t => t);
                    const newExc = item.querySelector('.am-edit-exc').value.split(',').map(t => t.trim()).filter(t => t);

                    if (newRemove.length === 0 && newReq.length === 0) {
                        if (window.showAlert) window.showAlert('Set at least one Trigger Tag or one Require condition (e.g. @embedName).', 'warn');
                        return;
                    }
                    if (newMode === 'fill' && !newKeep) {
                        if (window.showAlert) window.showAlert('A Fill rule needs a Main Tag to add.', 'warn');
                        return;
                    }
                    if (newMode === 'merge' && !newKeep && newRemove.length === 0) {
                        if (window.showAlert) window.showAlert('A Merge rule without a Main Tag needs Trigger Tags to remove.', 'warn');
                        return;
                    }

                    const data = { keepTag: newKeep, removeTags: newRemove, require: newReq, exclude: newExc, isAutoFill: newMode === 'fill' };
                    await window.RulesDB.updateRule(row.id, data);
                    _amEditingId = null;
                    await window.RulesCore.applyUserRulesToGlobals();
                    window.RulesUI.refreshModalBody();
                };

            } else {
                /* ---------- MODO NORMAL (exibição) ---------- */
                const badge = row.isDefault ? '<span style="background:#2a2a2a; color:#aaa; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #444;">Original</span>' : '<span style="background:#1a4d2e; color:#4caf50; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2e7d32;">Custom</span>';
                const modeBadge = isAutoFill ? '<span style="background:#1a3a5c; color:#4db8ff; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2a5a8c; margin-left:4px;">Fill</span>' : '<span style="background:#5c1a1a; color:#ff6060; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #7a222c; margin-left:4px;">Merge</span>';
                const triggerHtml = rems.length
                    ? `<b style="color:${isAutoFill ? '#4db8ff' : '#ff6060'}; font-size:11px; margin-left:4px;">[${window.RulesUI.escapeHTML(rems.join(', '))}]</b>`
                    : `<span style="color:#666; font-size:10px; margin-left:4px; font-style:italic;">[embed-only trigger]</span>`;

                item.style.cssText = `display:flex; align-items:center; gap:8px; background:#151515; border:1px solid #2a2a2a; border-left:3px solid ${meta.color}; border-radius:6px; padding:8px 10px;`;
                item.innerHTML = `
                    <div style="flex:1; display:flex; flex-direction: column; gap: 6px; overflow: hidden;">
                        <div>${badge}${modeBadge} ${triggerHtml} ${keep ? `<span style="color:#888; font-size:10px; margin: 0 4px;">→</span> <b style="color:#00ff99; font-size:12px;">${isAutoFill ? '+ ' : ''}${window.RulesUI.escapeHTML(keep)}</b>` : `<span style="color:#888; font-size:10px; margin-left:4px;">(Removed)</span>`}</div>
                        <div style="font-size:11px; color:#aaa; display:flex; gap:10px; flex-wrap:wrap;">
                            ${reqs.length ? `<span style="background:#222; padding:2px 6px; border-radius:4px;"><span style="color:#00ff99;">Req:</span> ${window.RulesUI.escapeHTML(reqs.join(', '))}</span>` : ''}
                            ${excs.length ? `<span style="background:#222; padding:2px 6px; border-radius:4px;"><span style="color:#ff6060;">Exc:</span> ${window.RulesUI.escapeHTML(excs.join(', '))}</span>` : ''}
                        </div>
                    </div>
                    <div style="display:flex; flex-direction: column; gap:4px; flex-shrink:0;">
                        <button class="btn-conflict-edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️</button>
                        <button class="btn-conflict-delete" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:12px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                    </div>
                `;
                item.querySelector('.btn-conflict-edit').onclick = () => {
                    _amEditingId = row.id;
                    window.RulesUI.refreshModalBody();
                };
                item.querySelector('.btn-conflict-delete').onclick = async () => {
                    if (!confirm('Remove this rule?')) return;
                    await window.RulesDB.deleteRule(row.id);
                    await window.RulesCore.applyUserRulesToGlobals();
                    window.RulesUI.refreshModalBody();
                };
            }
            list.appendChild(item);
        });
        wrap.appendChild(list);

        const addRow = document.createElement('div');
        addRow.className = 'inline-add-box';
        addRow.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 12px 15px; background: #111; align-items: stretch; flex: 0 0 auto; border-top: 1px solid #222;';
        addRow.innerHTML = `
            <div style="display:flex; gap:6px;">
                <input type="text" class="cond-keep" placeholder="Main Tag (to add)" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                <input type="text" class="cond-remove" placeholder="Trigger Tags (optional, comma-sep, or @embedName)" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
            </div>
            <div style="display:flex; gap:6px;">
                <input type="text" class="cond-req" placeholder="Requires (comma-sep, or @embedName)" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
                <input type="text" class="cond-exc" placeholder="Excludes (e.g. @clothing)" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
            </div>
            <div style="display:flex; gap:6px; justify-content: flex-end;">
                <button class="cond-add-fill-btn" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; font-size:11px; padding:6px 14px; border-radius:4px; font-weight:bold; cursor:pointer;">➕ Add Fill</button>
                <button class="cond-add-merge-btn" style="background:#5c1a1a; color:#ff6060; border:1px solid #7a222c; font-size:11px; padding:6px 14px; border-radius:4px; font-weight:bold; cursor:pointer;">➕ Add Merge</button>
            </div>
        `;
        
        const doAddAutoDo = async (isAutoFill) => {
            const keep = addRow.querySelector('.cond-keep').value.trim();
            const removeTags = addRow.querySelector('.cond-remove').value.split(',').map(t=>t.trim()).filter(t=>t);
            const require = addRow.querySelector('.cond-req').value.split(',').map(t=>t.trim()).filter(t=>t);
            const exclude = addRow.querySelector('.cond-exc').value.split(',').map(t=>t.trim()).filter(t=>t);

            // Trigger Tags é opcional agora — só bloqueia se os DOIS (Trigger
            // Tags e Requires) estiverem vazios, já que aí a regra nunca
            // dispararia (nenhum gatilho configurado).
            if (removeTags.length === 0 && require.length === 0) {
                if (window.showAlert) window.showAlert('Set at least one Trigger Tag or one Require condition (e.g. @embedName).', 'warn');
                return;
            }

            if (isAutoFill && !keep) {
                if (window.showAlert) window.showAlert('A Fill rule needs a Main Tag to add.', 'warn');
                return;
            }
            if (!isAutoFill && !keep && removeTags.length === 0) {
                if (window.showAlert) window.showAlert('A Merge rule without a Main Tag needs Trigger Tags to remove.', 'warn');
                return;
            }

            const data = { keepTag: keep, removeTags, require, exclude, isAutoFill };
            await window.RulesDB.addRule('automerge', data, false); 
            await window.RulesCore.applyUserRulesToGlobals();
            window.RulesUI.refreshModalBody();
        };

        addRow.querySelector('.cond-add-fill-btn').onclick = () => doAddAutoDo(true);
        addRow.querySelector('.cond-add-merge-btn').onclick = () => doAddAutoDo(false);
        
        wrap.appendChild(addRow);
        return wrap;
    }

    window.RulesUI.registerSection(3, async (rows) => {
        const isEnabled = await window.getSetting('rm_auto_merge', false);
        const isOnce = await window.getSetting('rm_auto_once', true);
        return renderAutoMergeSection(rows, isEnabled, isOnce);
    });

    /* ---------- RENOMEAR UM EMBED — ATUALIZA REFERÊNCIAS EM TODO LUGAR ---------- */
    window.renameEmbedReferencesEverywhere = async function (oldName, newName) {
        const oldRef = '@' + oldName.toLowerCase();
        const newRef = '@' + newName;
        const rows = await window.RulesDB.getAllRules();
        let changedCount = 0;

        for (const row of rows) {
            if (row.category === 'embed') continue;

            if (row.category === 'conflict' || row.category === 'similar' || row.category === 'redundant') {
                const tags = Array.isArray(row.tags) ? row.tags : [];
                const newTags = tags.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                if (JSON.stringify(newTags) !== JSON.stringify(tags)) {
                    await window.RulesDB.updateRule(row.id, newTags);
                    changedCount++;
                }
            } else if (row.category === 'highlight') {
                const tags = Array.isArray(row.tags) ? row.tags : [];
                const newTags = tags.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                if (JSON.stringify(newTags) !== JSON.stringify(tags)) {
                    await window.RulesDB.updateRule(row.id, { name: row.name, tags: newTags, color: row.color });
                    changedCount++;
                }
            } else if (row.category === 'automerge') {
                const req = Array.isArray(row.require) ? row.require : [];
                const exc = Array.isArray(row.exclude) ? row.exclude : [];
                const rem = Array.isArray(row.removeTags) ? row.removeTags : [];
                const newReq = req.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                const newExc = exc.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                const newRem = rem.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                if (JSON.stringify(newReq) !== JSON.stringify(req) || JSON.stringify(newExc) !== JSON.stringify(exc) || JSON.stringify(newRem) !== JSON.stringify(rem)) {
                    await window.RulesDB.updateRule(row.id, {
                        keepTag: row.keepTag, removeTags: newRem,
                        require: newReq, exclude: newExc, isAutoFill: !!row.isAutoFill
                    });
                    changedCount++;
                }
            }
        }
        return changedCount;
    };

    // --- EMBEDS UI ---
    window.buildEmbedModal = function() {
        if (document.getElementById('modal-embed-manager')) return;
        const overlay = document.createElement('div');
        overlay.id = 'modal-embed-manager'; overlay.className = 'modal-overlay'; overlay.style.zIndex = '105';
        overlay.onclick = () => window.closeModal('modal-embed-manager');
        overlay.innerHTML = `
            <div class="tool-modal" style="width: 500px; height: 600px; display:flex; flex-direction:column;" onclick="event.stopPropagation()">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <h3 style="margin:0 0 5px 0; font-size:16px;">📦 Custom Embeds</h3>
                    <button onclick="window.restoreEmbedDefaults()" title="Restore default embeds" style="background:transparent; border:none; color:#888; cursor:pointer; font-size:14px; padding:0; transition:0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#888'">🔄</button>
                </div>
                <div style="font-size:11px; color:#aaa; margin-bottom:15px;">Create custom groups of tags. Use <b>@name</b> in the Excludes/Requires of Advanced Rules.</div>
                <div id="embed-list-container" class="panel-list-scroll" style="flex:1; overflow-y:auto; background:#111; padding:10px; border:1px solid #333; border-radius:6px; display:flex; flex-direction:column; gap:8px;"></div>
                <div style="margin-top:15px; display:flex; flex-direction:column; gap:8px; background:#1b1b1b; padding:12px; border:1px solid #333; border-radius:6px;">
                    <div style="font-size:12px; color:#00ff99; font-weight:bold;">Create New Embed</div>
                    <input type="text" id="embed-add-name" placeholder="Name (e.g. clothing)" style="font-size:12px; background:#222; border:1px solid #444; padding:8px; border-radius:4px; color:#fff;">
                    <textarea id="embed-add-tags" placeholder="tag1, tag2, tag3..." style="font-size:12px; background:#222; border:1px solid #444; padding:8px; border-radius:4px; color:#fff; min-height:60px; resize:vertical;"></textarea>
                    <button onclick="window.addCustomEmbed()" style="background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer;">➕ Save Embed</button>
                </div>
                <div class="modal-buttons" style="margin-top:15px;"><button class="btn-cancel" onclick="window.closeModal('modal-embed-manager')">Close</button></div>
            </div>
        `;
        document.body.appendChild(overlay);
    };

    window.openEmbedsManager = async function() { _embedEditingId = null; await window.refreshEmbedList(); window.openModal('modal-embed-manager'); };

    window.refreshEmbedList = async function() {
        const container = document.getElementById('embed-list-container');
        if (!container) return;
        const rows = await window.RulesDB.getAllRules();
        const embeds = rows.filter(r => r.category === 'embed');
        embeds.sort((a, b) => (a.isDefault === b.isDefault ? 0 : (a.isDefault ? -1 : 1)));
        
        container.innerHTML = '';
        if (embeds.length === 0) { container.innerHTML = '<div style="color:#555; font-size:12px; text-align:center; margin-top:20px;">No embeds created yet.</div>'; return; }

        embeds.forEach(emb => {
            const safeTags = Array.isArray(emb.tags) ? emb.tags : [];
            const el = document.createElement('div');

            if (_embedEditingId === emb.id) {
                el.style.cssText = 'background:#151515; border:1px solid #4a2a8c; border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:8px;';
                el.innerHTML = `
                    <div style="font-size:11px; color:#b890ff; font-weight:bold;">✏️ Editing @${window.RulesUI.escapeHTML(emb.name)}</div>
                    <input type="text" class="emb-edit-name" value="${window.RulesUI.escapeHTML(emb.name)}" placeholder="Name (e.g. clothing)" style="font-size:12px; background:#222; border:1px solid #444; padding:8px; border-radius:4px; color:#fff;">
                    <textarea class="emb-edit-tags" placeholder="tag1, tag2, tag3..." style="font-size:12px; background:#222; border:1px solid #444; padding:8px; border-radius:4px; color:#fff; min-height:70px; resize:vertical;">${window.RulesUI.escapeHTML(safeTags.join(', '))}</textarea>
                    <div style="display:flex; gap:6px; justify-content:flex-end;">
                        <button class="btn-emb-cancel" style="background:#222; border:1px solid #444; color:#aaa; font-size:11px; padding:6px 14px; border-radius:4px; cursor:pointer; font-weight:bold;">✖ Cancel</button>
                        <button class="btn-emb-update" style="background:#00aa66; border:none; color:#000; font-size:11px; padding:6px 14px; border-radius:4px; cursor:pointer; font-weight:bold;">✅ Update</button>
                    </div>
                `;

                el.querySelector('.btn-emb-cancel').onclick = () => {
                    _embedEditingId = null;
                    window.refreshEmbedList();
                };

                el.querySelector('.btn-emb-update').onclick = async () => {
                    const nameInput = el.querySelector('.emb-edit-name');
                    const tagsInput = el.querySelector('.emb-edit-tags');
                    const newName = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
                    const newTags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);

                    if (!newName) { if (window.showAlert) window.showAlert('Invalid embed name.', 'warn'); nameInput.focus(); return; }
                    if (newTags.length === 0) { if (window.showAlert) window.showAlert('At least 1 tag is required.', 'warn'); tagsInput.focus(); return; }

                    const oldName = emb.name;
                    await window.RulesDB.updateRule(emb.id, { name: newName, tags: newTags });

                    let renamedRefsCount = 0;
                    if (newName !== oldName) renamedRefsCount = await window.renameEmbedReferencesEverywhere(oldName, newName);

                    _embedEditingId = null;
                    await window.RulesCore.applyUserRulesToGlobals();
                    await window.refreshEmbedList();
                    if (document.getElementById('modal-conflict-manager') && document.getElementById('modal-conflict-manager').classList.contains('active')) {
                        await window.RulesUI.refreshModalBody();
                    }

                    if (window.showAlert) {
                        window.showAlert(
                            renamedRefsCount > 0
                                ? `Embed renamed to @${newName}. Updated ${renamedRefsCount} rule(s) that referenced @${oldName}.`
                                : `Embed @${newName} updated!`,
                            'success'
                        );
                    }
                };

            } else {
                const badge = emb.isDefault ? '<span style="background:#2a2a2a; color:#aaa; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #444; margin-right:6px;">Original</span>' : '<span style="background:#1a4d2e; color:#4caf50; font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid #2e7d32; margin-right:6px;">Custom</span>';
                el.style.cssText = 'background:#151515; border:1px solid #2a2a2a; border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:8px;';
                el.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>${badge}<span style="font-size:14px; font-weight:bold; color:#b890ff;">@${window.RulesUI.escapeHTML(emb.name)}</span></div>
                        <div style="display:flex; gap:6px;">
                            <button class="btn-emb-edit" style="background:#222; border:1px solid #444; color:#4db8ff; font-size:11px; padding:4px 8px; border-radius:4px; cursor:pointer;">✏️ Edit</button>
                            <button class="btn-emb-del" style="background:#2a0000; border:1px solid #7a222c; color:#ff6060; font-size:11px; padding:4px 8px; border-radius:4px; cursor:pointer;">🗑️</button>
                        </div>
                    </div>
                    <div style="font-size:11px; color:#aaa; line-height:1.4; word-break:break-word;">${window.RulesUI.escapeHTML(safeTags.join(', '))}</div>
                `;

                el.querySelector('.btn-emb-edit').onclick = () => {
                    _embedEditingId = emb.id;
                    window.refreshEmbedList();
                };

                el.querySelector('.btn-emb-del').onclick = async () => {
                    if (!confirm(`Delete embed @${emb.name}?`)) return;
                    await window.RulesDB.deleteRule(emb.id);
                    window.refreshEmbedList();
                };
            }

            container.appendChild(el);
        });
    };

    window.addCustomEmbed = async function() {
        const nameInput = document.getElementById('embed-add-name'); const tagsInput = document.getElementById('embed-add-tags');
        let name = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''); let tags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);
        if (!name || tags.length === 0) { if(window.showAlert) window.showAlert('Please provide a valid name and tags.', 'warn'); return; }
        await window.RulesDB.addRule('embed', { name: name, tags: tags }, false);
        nameInput.value = ''; tagsInput.value = '';
        window.refreshEmbedList();
        if(window.showAlert) window.showAlert(`Embed @${name} saved!`, 'success');
    };

    window.restoreEmbedDefaults = async function() {
        if (!confirm(`Restore original default embeds?\n\n- Your custom embeds will be kept.`)) return;
        let deletedDefaults = await window.getSetting('deleted-default-rules', []);
        if (!Array.isArray(deletedDefaults)) deletedDefaults = [];
        const embDefIds = window.RulesDB.getFactoryRules().filter(r => r.category === 'embed').map(r => r.id);
        deletedDefaults = deletedDefaults.filter(id => !embDefIds.includes(id));
        await window.saveSetting('deleted-default-rules', deletedDefaults);
        await window.RulesCore.applyUserRulesToGlobals();
        window.refreshEmbedList();
        if (window.showAlert) window.showAlert(`Embed defaults restored!`, 'success');
    };
})();