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
        const removes = Array.isArray(rule.removeTags) ? rule.removeTags : [];
        const reqs = Array.isArray(rule.require) ? rule.require : [];
        const excs = Array.isArray(rule.exclude) ? rule.exclude : [];

        // Trigger Tags (removeTags) agora é OPCIONAL: se vazio, o gatilho vira
        // só o Require (tags soltas e/ou @embedName). Uma regra sem NENHUM
        // gatilho (nem Trigger Tags, nem Require) nunca dispara, pra não virar
        // uma regra "sempre ativa" por acidente.
        if (removes.length === 0 && reqs.length === 0) return null;

        if (removes.length > 0) {
            const presentRemoves = removes.filter(rem => tagsArray.some(t => t.toLowerCase() === rem.toLowerCase()));
            if (presentRemoves.length === 0) return null;
        }

        let hasRequired = reqs.length === 0 || reqs.every(req => tagsArray.some(t => matchTag(t, req, embeds)));
        let hasExcluded = excs.length > 0 && tagsArray.some(t => excs.some(ex => matchTag(t, ex, embeds)));

        if (hasRequired && !hasExcluded) {
            let newTags = [...tagsArray];
            if (!rule.isAutoFill) newTags = tagsArray.filter(t => !removes.some(rem => rem.toLowerCase() === t.toLowerCase()));
            if (rule.keepTag && String(rule.keepTag).trim() !== '') newTags.push(String(rule.keepTag).trim());
            return [...new Set(newTags)];
        }
        return null;
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

        // Se não sobra mais NADA sujo no dataset (tudo já foi salvo), zera o
        // estado — não faz sentido continuar anunciando uma mudança que já
        // está salva em disco. IMPORTANTE: isto só é usado pra decidir
        // quando o balão deve SUMIR sozinho — não é mais uma condição pra
        // decidir se ele pode APARECER (ver FIX abaixo).
        const stillDirty = (typeof imageFiles !== 'undefined' ? imageFiles : []).some(img => img.dirty);
        if (!stillDirty && window._autoDoChangedCount > 0) {
            window._autoDoChangedCount = 0;
            window._autoDoAlertDismissed = false;
        }

        // FIX (balão não aparecia): a versão anterior exigia `stillDirty`
        // também para EXIBIR o balão, na mesma chamada que acabou de rodar
        // window.markDirty(modifiedFiles). Isso deveria ser sempre
        // verdadeiro nesse ponto, mas criava uma dependência frágil da
        // ordem exata de execução (se markDirty ou qualquer coisa no meio
        // do caminho não deixasse o dataset "sujo" a tempo, o balão nunca
        // chegava a aparecer). Agora a exibição depende só da contagem e do
        // dismiss — o `stillDirty` continua sendo usado, só que separado,
        // para AUTO-ESCONDER depois que tudo for salvo.
        const shouldShow = window._autoDoChangedCount > 0 && !window._autoDoAlertDismissed;
        if (!shouldShow) {
            bar.style.display = 'none';
            return;
        }

        bar.style.display = 'block';
        const plural = window._autoDoChangedCount === 1 ? 'image' : 'images';
        bar.innerHTML = `
            <span style="color:#00ff99;margin:0 6px;font-size:14px;line-height:1;">⚡</span>
            Auto-Do automatically modified tags in ${window._autoDoChangedCount} ${plural} — review and save when ready
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

    // Mantém o balão em sincronia com o estado de "salvo"/"não salvo" do
    // dataset SEM duplicar essa lógica: qualquer markDirty()/markClean()
    // já dispara window.updateUnsavedChangesUI() em algum ponto do app
    // (tagmanager_ui_core.js) — só "encaixamos" nosso próprio refresh
    // logo depois, reaproveitando o mesmo sinal.
    function installAutoDoAlertUnsavedHook() {
        if (typeof window.updateUnsavedChangesUI !== 'function' || window.updateUnsavedChangesUI.__autoDoAlertWrapped) return false;
        const original = window.updateUnsavedChangesUI;
        const wrapped = function () {
            const result = original.apply(this, arguments);
            window.updateAutoDoAlertUI();
            return result;
        };
        wrapped.__autoDoAlertWrapped = true;
        window.updateUnsavedChangesUI = wrapped;
        return true;
    }
    if (!installAutoDoAlertUnsavedHook()) window.addEventListener('DOMContentLoaded', () => setTimeout(installAutoDoAlertUnsavedHook, 0));

    // Zera o balão sempre que o dataset/subpasta muda (nova referência de
    // window.imageFiles) — mesmo padrão de detecção de troca de dataset já
    // usado em vários outros arquivos deste projeto (auto_task_queue.js,
    // danbooru_panel.js, rule_redudant.js, etc).
    let _lastImageFilesRefAutoDoAlert = null;
    function resetAutoDoAlertOnDatasetChange() {
        if (typeof imageFiles === 'undefined') return;
        if (imageFiles === _lastImageFilesRefAutoDoAlert) return;
        _lastImageFilesRefAutoDoAlert = imageFiles;
        window._autoDoChangedCount = 0;
        window._autoDoAlertDismissed = false;
        window.updateAutoDoAlertUI();
    }
    function installAutoDoAlertDatasetHook() {
        if (typeof window.registerPostRenderImageList === 'function') {
            if (!window._autoDoAlertHookRegistered) {
                window.registerPostRenderImageList(resetAutoDoAlertOnDatasetChange);
                window._autoDoAlertHookRegistered = true;
            }
            return true;
        }
        if (typeof window.renderImageList === 'function' && !window.renderImageList.__autoDoAlertWrapped) {
            const orig = window.renderImageList;
            const wrapped = function () { orig.apply(this, arguments); resetAutoDoAlertOnDatasetChange(); };
            wrapped.__autoDoAlertWrapped = true;
            window.renderImageList = wrapped;
            return true;
        }
        return false;
    }
    if (!installAutoDoAlertDatasetHook()) window.addEventListener('DOMContentLoaded', () => setTimeout(installAutoDoAlertDatasetHook, 0));

    window.runAutoMergeOnDataset = async function(manual = false) {
        if (window.enableConflictWarnings === false) return;
        if (!window.imageFiles || window.imageFiles.length === 0) { if (manual && window.showAlert) window.showAlert('No dataset loaded.', 'warn'); return; }
        
        const rows = await window.RulesDB.getAllRules();
        const amRules = rows.filter(r => r.category === 'automerge').map(row => {
            if (Array.isArray(row.tags) && row.tags.length > 0) return { keepTag: row.tags[0], removeTags: row.tags.slice(1), require: [], exclude: [], isAutoFill: false };
            if (row.target) return { keepTag: row.fallback, removeTags: [row.target], require: Array.isArray(row.exclude) ? row.exclude : [], exclude: Array.isArray(row.require) ? row.require : [], isAutoFill: false };
            if (!Array.isArray(row.removeTags)) row.removeTags = [];
            return row;
        });

        const embeds = rows.filter(r => r.category === 'embed');
        if (amRules.length === 0) { if (manual && window.showAlert) window.showAlert('No Auto-Do rules configured.', 'warn'); return; }

        let changedCount = 0; let modifiedFiles = [];
        window.imageFiles.forEach(img => {
            if (img.type === 'tags' && img.content && !img.hidden) {
                let originalTags = img.content.split(',').map(t => t.trim()).filter(t => t);
                let currentTags = [...originalTags];
                amRules.forEach(rule => { const res = runAutoMergeRule(currentTags, rule, embeds); if (res) currentTags = res; });
                if (originalTags.join(',') !== currentTags.join(',')) {
                    img.content = currentTags.join(', '); img.hasFile = true; modifiedFiles.push(img); changedCount++;
                }
            }
        });

        if (changedCount > 0) {
            // FIX: define o estado do balão ANTES de qualquer outra chamada
            // (markDirty, renderImageList, renderMasterTagList, renderEditor,
            // applyFilters) — removendo qualquer dependência da ORDEM exata
            // em que essas funções (e os hooks que elas disparam) executam.
            window._autoDoChangedCount = (window._autoDoChangedCount || 0) + changedCount;
            window._autoDoAlertDismissed = false;
            if (typeof window.updateAutoDoAlertUI === 'function') window.updateAutoDoAlertUI();

            if (typeof window.markDirty === 'function') window.markDirty(modifiedFiles);
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

            // Segunda garantia: reafirma o balão depois que TODOS os renders
            // acima (e qualquer coisa assíncrona disparada por eles) já
            // tiverem terminado. Redundante na maioria das vezes, mas
            // protege contra qualquer re-render futuro que porventura mexa
            // no estado entre o início e o fim desta função.
            if (typeof window.updateAutoDoAlertUI === 'function') {
                setTimeout(() => window.updateAutoDoAlertUI(), 0);
            }

            if (window.showAlert) window.showAlert(`Auto-Do applied to ${changedCount} image(s)!`, 'success');
        } else {
            if (manual && window.showAlert) window.showAlert('No matching tags found to automate.', 'info');
        }
    };

    window.RulesCore.hookAutoMergeLoader = function() {
        if (window._autoMergeHooked) return;
        if (typeof window.registerAutoDatasetTask === 'function') {
            window.registerAutoDatasetTask('auto-merge', async () => {
                const autoRun = await window.getSetting('rm_auto_merge', false);
                if (autoRun && window.enableConflictWarnings !== false) await window.runAutoMergeOnDataset(false);
            });
            window._autoMergeHooked = true; return;
        }
        let _lastImageFilesRef = null;
        const _origRender = window.renderImageList;
        if (typeof _origRender === 'function') {
            window.renderImageList = function() {
                if (window.imageFiles && window.imageFiles !== _lastImageFilesRef) {
                    _lastImageFilesRef = window.imageFiles;
                    window.getSetting('rm_auto_merge', false).then(autoRun => {
                        if (autoRun && window.enableConflictWarnings !== false) setTimeout(() => window.runAutoMergeOnDataset(false), 100);
                    });
                }
                return _origRender.apply(this, arguments);
            };
            window._autoMergeHooked = true;
        }
    };

    // --- UI AUTO MERGE ---
    function renderAutoMergeSection(rows, isChecked) {
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
        setTimeout(() => {
            const cb = document.getElementById('cb-auto-merge');
            if (cb) cb.onchange = async (e) => { await window.saveSetting('rm_auto_merge', e.target.checked); };
        }, 0);
        wrap.appendChild(header);

        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:11px; color:#aaa; padding: 12px 15px; background: #151515; border-bottom: 1px solid #222; flex-shrink: 0; line-height: 1.5;';
        hint.innerHTML = `<b>${meta.hint}</b><br><span style="color:#777; margin-top:6px; display:inline-block;">${meta.desc}</span><br><span style="color:#666; margin-top:4px; display:inline-block;">Trigger Tags are optional — leave them empty and use Require with an <b>@embedName</b> to fire a rule purely from an embed group (e.g. "any @clothing tag present → add 'clothed'").</span>`;
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
                        <label style="font-size:10px; color:#888;">Trigger Tags <span style="color:#666;">(optional — leave empty to trigger only by Require)</span></label>
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
                <input type="text" class="cond-remove" placeholder="Trigger Tags (optional, comma-sep)" style="flex:1; font-size:11px; background:#222; border:1px solid #444; padding:6px 8px; border-radius:4px; color:#fff; min-width: 0;">
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
        return renderAutoMergeSection(rows, isEnabled);
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
                const newReq = req.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                const newExc = exc.map(t => (String(t).toLowerCase() === oldRef) ? newRef : t);
                if (JSON.stringify(newReq) !== JSON.stringify(req) || JSON.stringify(newExc) !== JSON.stringify(exc)) {
                    await window.RulesDB.updateRule(row.id, {
                        keepTag: row.keepTag, removeTags: row.removeTags,
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