/* =========================================================================
   REDUNDANT TAGS (All Dataset Tags only) — novo arquivo — standalone
   ---------------------------------------------------------------------
   Nova categoria de regra, "🔁 Redundant Tags": funciona igual ao 🟨
   Similar (grupos de tags + suporte a @embedName), mas com 2 diferenças:

   1) O aviso "🔁 Redundant: ..." SÓ aparece em All Dataset Tags. Ex: um
      grupo ['boots', 'shoes', 'sandals'] — se 2+ dessas tags estiverem
      em uso em QUALQUER imagem do dataset (não precisa ser na mesma
      imagem), cada uma ganha o aviso "🔁 Redundant: <as outras>" na
      linha de All Dataset Tags.
   2) Opção de "ignorar" (✖) POR PAR ESPECÍFICO, igual ao Similar
      (tagmanager_rule_similar.js): cada nome dentro do aviso tem seu
      próprio ✖. Clicar no ✖ ao lado de "shoes" (no aviso da tag "boots")
      desliga só o par boots↔shoes — "sandals" continua sendo avisado.

   ESCOPO (POR DATASET, não global): igual ao Similar, a lista de pares
   ignorados fica em datasetConfig.ignoredRedundantPairs (salva no
   "_tagger_config.json" da PRÓPRIA pasta do dataset, via
   window.saveDatasetConfig) — não em window.saveSetting, que é global e
   vazaria o ignore pra qualquer outra pasta aberta depois. A lista em
   memória é resincronizada automaticamente sempre que window.imageFiles
   troca de referência (dataset/subpasta diferente foi carregado).

   FIX (mantido de versões anteriores): a checagem de "a tag está em uso
   no dataset?" usa uma varredura AO VIVO nas imagens (ignorando ocultas)
   — igual ao que tagmanager_master_list.js já faz pra decidir o que
   mostrar em All Dataset Tags — em vez de window.masterTagSet cru (que
   pode reter tags "fantasma" já removidas de todas as imagens).

   IMPORTANTE: precisa carregar DEPOIS de tagmanager_rule_conflict.js,
   tagmanager_rule_similar.js (define pairKey/buildIgnoredPairsBlock) e
   tagmanager_master_list.js (define window.renderMasterTagList).
========================================================================= */

(function () {

    const style = document.createElement('style');
    style.innerHTML = `
        .master-tag-item.redundant {
            background: rgba(45, 212, 191, 0.16) !important;
            border-left: 3px solid #2dd4bf !important;
        }
        .redundant-warning {
            margin-left: 12px; font-size: 10px; color: #99f6ec; background: #062824;
            padding: 2px 8px; border-radius: 12px; border: 1px solid #2dd4bf; cursor: help;
            display: inline-flex; align-items: center; flex-wrap: wrap;
        }
        .redundant-item { margin: 0 2px; }
        .redundant-ignore-icon {
            margin: 0 4px 0 1px; cursor: pointer; font-size: 0.85em; color: #ff8a8a; opacity: 0.8; transition: 0.15s;
        }
        .redundant-ignore-icon:hover { opacity: 1; transform: scale(1.2); }
    `;
    document.head.appendChild(style);

    /* ---------- CATEGORIA NOVA: 🔁 REDUNDANT ---------- */
    function registerCategoryMeta() {
        if (!window.CATEGORY_META || window.CATEGORY_META.redundant) return;
        window.CATEGORY_META.redundant = {
            label: "🔁 Redundant Tags",
            color: "#2dd4bf",
            hint: "Tags that mean the same thing and could be merged into one — shown ONLY in All Dataset Tags.",
            desc: "Unlike Similar (yellow), Redundant doesn't touch Active Image. Example: a group ['boots', 'shoes', 'sandals'] — if 2+ of those tags are used ANYWHERE in the dataset, each gets flagged here, listing which other tags do the same thing so you can consider merging them."
        };
    }

    // Alguns exemplos de fábrica (o usuário pode apagar/editar livremente).
    const FACTORY_REDUNDANT = [
        ['boots', 'shoes', 'sandals'],
        ['thigh highs', 'thighhighs'],
        ['t-shirt', 'tshirt'],
        ['pony tail', 'ponytail'],
        ['sfw', 'safe for work'],
        ['nsfw', 'not safe for work']
    ];

    function registerFactoryRules() {
        if (!window.RulesDB || !Array.isArray(window.RulesDB.factoryRules)) return;
        if (window.RulesDB.factoryRules.some(r => r.category === 'redundant')) return;
        FACTORY_REDUNDANT.forEach((tags, i) => window.RulesDB.factoryRules.push({ id: 'def_redu_' + i, category: 'redundant', isDefault: true, tags }));
    }

    /* ---------- CHAVE DE PAR (reaproveita a de tagmanager_rule_similar.js; fallback local se ele não tiver carregado ainda) ---------- */
    function pairKey(a, b) {
        if (window.RulesCore && typeof window.RulesCore.pairKey === 'function') return window.RulesCore.pairKey(a, b);
        const x = String(a).trim().toLowerCase(), y = String(b).trim().toLowerCase();
        return x < y ? `${x}\u241F${y}` : `${y}\u241F${x}`;
    }
    function formatPairKey(key) {
        if (window.RulesCore && typeof window.RulesCore.formatPairKey === 'function') return window.RulesCore.formatPairKey(key);
        return key.split('\u241F').join(' ↔ ');
    }

    function registerUISection() {
        if (!window.RulesUI || typeof window.RulesUI.registerSection !== 'function' || window._redundantSectionRegistered) return;
        // order 2.5: logo depois da seção 🟨 Similar (order 2) e antes de ⚡ Auto-Do (order 3)
        window.RulesUI.registerSection(2.5, async (rows) => {
            const isEnabled = await window.getSetting('rm_enable_redundant', true);
            const wrap = window.RulesUI.renderGenericCategorySection('redundant', rows, isEnabled, 'rm_enable_redundant');
            const list = wrap.querySelector('.panel-list-scroll');
            if (list && typeof window.RulesUI.buildIgnoredPairsBlock === 'function') {
                const block = window.RulesUI.buildIgnoredPairsBlock('Ignored Pairs (this dataset)', window.ignoredRedundantPairs, window.unignoreRedundantPair, formatPairKey);
                list.insertBefore(block, list.firstChild);
            }
            return wrap;
        });
        window._redundantSectionRegistered = true;
    }

    /* ---------- ESTADO (por dataset) ---------- */
    window.ignoredRedundantPairs = window.ignoredRedundantPairs || new Set();

    function isRedundantPairIgnored(a, b) {
        return window.ignoredRedundantPairs.has(pairKey(a, b));
    }

    /* =====================================================================
       CONTADOR NO TOPBAR (🔁 X Redundant) — mesmo padrão de ⚠️/🟨
       ---------------------------------------------------------------------
       Redundant nunca teve contador próprio no topbar (só o aviso inline
       na linha de All Dataset Tags).

       FIX (bug crítico de performance / "trava a aba"): a primeira versão
       disto chamava window.checkTagRedundantStatus(tag) para CADA TAG de
       CADA IMAGEM — e essa função reconstrói computeLiveDatasetTagSet()
       (uma varredura completa de TODAS as imagens do dataset) do ZERO a
       cada tag verificada. Combinado com o fato de que isso rodava a cada
       applyFilters()/renderEditor() — ou seja, a CADA clique de
       adicionar/remover tag, não só ao abrir o dataset — o custo virava
       O(imagens × tags × imagens), travando a aba inteira em datasets
       médios/grandes (parecia "nada mais atualiza", só resolvendo com F5,
       porque o thread principal ficava ocupado processando o cálculo
       anterior antes de conseguir desenhar o próximo).

       Agora a varredura do dataset (computeLiveDatasetTagSet) roda UMA
       ÚNICA VEZ por atualização de contador — não mais uma vez por tag —
       via computeRedundantIssuesForTagsWithLiveSet(tags, liveSet), que
       recebe o Set já pronto em vez de recalculá-lo.

       FIX (acoplamento arriscado): em vez de sobrescrever
       window.IssueCounters.updateGlobal/updateActive diretamente (mexendo
       na implementação interna de outro arquivo), os contadores agora se
       registram via window.registerPostApplyFilters/registerPostRenderEditor
       — o MESMO mecanismo que tagmanager_rule_conflict.js já usa pros
       contadores de Conflict/Similar. Mais seguro e consistente com o
       resto do projeto. */

    function computeRedundantIssuesForTagsWithLiveSet(tagsArray, liveSet) {
        if (!Array.isArray(window.tagRedundant) || window.tagRedundant.length === 0) return 0;
        const tagsLower = (tagsArray || []).map(t => String(t).trim().toLowerCase()).filter(t => t);
        let flagged = 0;
        tagsLower.forEach(tagLower => {
            if (!liveSet.has(tagLower)) return;
            let hasValidPartner = false;
            for (const group of window.tagRedundant) {
                if (hasValidPartner) break;
                const groupLower = (Array.isArray(group) ? group : []).map(g => String(g).toLowerCase());
                if (!groupLower.includes(tagLower)) continue;
                for (const t of groupLower) {
                    if (t === tagLower) continue;
                    if (!liveSet.has(t)) continue;
                    if (isRedundantPairIgnored(tagLower, t)) continue;
                    hasValidPartner = true;
                    break;
                }
            }
            if (hasValidPartner) flagged++;
        });
        return flagged;
    }

    function injectRedundantCounterDOM() {
        if (!document.getElementById('active-counter-redundant')) {
            const simSpan = document.getElementById('active-counter-similar');
            if (simSpan) {
                const span = document.createElement('span');
                span.id = 'active-counter-redundant';
                span.style.cssText = 'display:none; background:#062824; border: 1px solid #2dd4bf; color:#99f6ec; padding: 2px 6px; font-size: 11px; border-radius: 4px; cursor: help;';
                span.title = 'Redundant tags in this specific image';
                simSpan.insertAdjacentElement('afterend', span);
            }
        }
        if (!document.getElementById('global-counter-redundant')) {
            const simBtn = document.getElementById('global-counter-similar');
            if (simBtn) {
                const btn = document.createElement('button');
                btn.id = 'global-counter-redundant';
                btn.className = 'btn-save-local';
                btn.style.cssText = 'display:none; background:#062824; border-color:#2dd4bf; color:#99f6ec; padding: 2px 6px; font-size: 11px;';
                btn.title = 'Images with Redundant Tags (Click to jump to one)';
                btn.onclick = () => window.selectIssueImage('redundant');
                simBtn.insertAdjacentElement('afterend', btn);
            }
        }
    }

    function updateGlobalRedundantCounter() {
        injectRedundantCounterDOM();
        const btn = document.getElementById('global-counter-redundant');
        if (!btn) return;

        if (window.enableConflictWarnings === false || !Array.isArray(window.tagRedundant) || window.tagRedundant.length === 0 || typeof imageFiles === 'undefined') {
            window.issueImagesMap = window.issueImagesMap || {};
            window.issueImagesMap.redundant = [];
            btn.style.display = 'none';
            return;
        }

        // Varredura do dataset feita UMA vez aqui, reaproveitada por todas as imagens/tags.
        const liveSet = computeLiveDatasetTagSet();
        const redundantImages = [];
        imageFiles.forEach((img, idx) => {
            if (img.hidden || img.type !== 'tags' || !img.content) return;
            if (computeRedundantIssuesForTagsWithLiveSet(img.content.split(','), liveSet) > 0) redundantImages.push(idx);
        });
        window.issueImagesMap = window.issueImagesMap || {};
        window.issueImagesMap.redundant = redundantImages;

        if (redundantImages.length > 0) {
            btn.style.display = 'inline-block';
            btn.textContent = `🔁 ${redundantImages.length} Redundant`;
        } else {
            btn.style.display = 'none';
        }
    }

    function updateActiveRedundantCounter() {
        injectRedundantCounterDOM();
        const span = document.getElementById('active-counter-redundant');
        if (!span) return;

        if (window.enableConflictWarnings === false || !Array.isArray(window.tagRedundant) || window.tagRedundant.length === 0 ||
            typeof selectedIndices === 'undefined' || selectedIndices.size === 0 || typeof imageFiles === 'undefined') {
            span.style.display = 'none';
            return;
        }

        const liveSet = computeLiveDatasetTagSet();
        let total = 0;
        selectedIndices.forEach(idx => {
            const img = imageFiles[idx];
            if (img && img.type === 'tags' && img.content) total += computeRedundantIssuesForTagsWithLiveSet(img.content.split(','), liveSet);
        });

        if (total > 0) {
            span.style.display = 'inline-block';
            span.textContent = `🔁 ${total} Redundant`;
        } else {
            span.style.display = 'none';
        }
    }

    function refreshRedundantCounters() {
        updateGlobalRedundantCounter();
        updateActiveRedundantCounter();
    }

    /* Registra os contadores no MESMO hub de hooks usado por
       tagmanager_rule_conflict.js — sem tocar em window.IssueCounters
       diretamente. Fallback pro wrap manual antigo só se, por algum
       motivo, tagmanager_render_hooks.js não tiver carregado. */
    function installRedundantCounterHooks() {
        if (typeof window.registerPostApplyFilters === 'function' && typeof window.registerPostRenderEditor === 'function') {
            if (!window._redundantCounterHooksRegistered) {
                window.registerPostApplyFilters(updateGlobalRedundantCounter);
                window.registerPostRenderEditor(updateActiveRedundantCounter);
                window._redundantCounterHooksRegistered = true;
            }
            return true;
        }
        let installedAny = false;
        if (typeof window.applyFilters === 'function' && !window.applyFilters.__redundantCounterWrapped) {
            const origApply = window.applyFilters;
            const wrappedApply = function () { const r = origApply.apply(this, arguments); updateGlobalRedundantCounter(); return r; };
            wrappedApply.__redundantCounterWrapped = true;
            window.applyFilters = wrappedApply;
            installedAny = true;
        }
        if (typeof window.renderEditor === 'function' && !window.renderEditor.__redundantCounterWrapped) {
            const origEditor = window.renderEditor;
            const wrappedEditor = function () { const r = origEditor.apply(this, arguments); updateActiveRedundantCounter(); return r; };
            wrappedEditor.__redundantCounterWrapped = true;
            window.renderEditor = wrappedEditor;
            installedAny = true;
        }
        return installedAny;
    }

    /* ---------- PERSISTÊNCIA NO PRÓPRIO DATASET (_tagger_config.json) ----------
       Igual ao Similar: nada de window.saveSetting aqui — isso é global.
       datasetConfig já é o objeto carregado/salvo por pasta. */
    async function persistIgnoredRedundantPairs() {
        if (typeof datasetConfig === 'undefined') return;
        datasetConfig.ignoredRedundantPairs = Array.from(window.ignoredRedundantPairs);
        const handle = window.currentImagesHandle || window.rootHandle;
        if (handle && typeof window.saveDatasetConfig === 'function') await window.saveDatasetConfig(handle);
    }

    function refreshModalIfOpen() {
        const modal = document.getElementById('modal-conflict-manager');
        if (modal && modal.classList.contains('active') && window.RulesUI && typeof window.RulesUI.refreshModalBody === 'function') {
            window.RulesUI.refreshModalBody();
        }
    }

    /* ---------------------------------------------------------------------
       FIX #2 (contador do topbar "voltava" mesmo com o par ignorado): esta
       sincronização rodava num hook de PÓS-renderImageList
       (registerPostRenderImageList). O problema: window.applyFilters() — a
       função que calcula o contador "🔁 X Redundant" do topbar — já é
       chamada DENTRO da implementação verdadeira de renderImageList, ANTES
       desse hook rodar. Ao trocar de dataset e voltar, o contador do
       topbar era calculado usando window.ignoredRedundantPairs do dataset
       ANTERIOR (ou vazio) por uma passada, e só se corrigia DEPOIS, quando
       o hook finalmente rodava — dando a impressão de que "o ignore não
       pegou" mesmo com o aviso individual da tag já corretamente oculto
       (esse sim recalculado a tempo, na segunda chamada de
       renderMasterTagList dentro de finishLoading()).

       Agora sincronizamos junto com window.loadDatasetConfig — a própria
       função que lê o _tagger_config.json do dataset — que roda bem antes
       de imageFiles ser resetado, antes de qualquer render e antes de
       qualquer chamada a applyFilters(). Assim o contador já nasce correto
       na primeira vez que é calculado pro dataset recém-carregado. */
    function syncIgnoredPairsForDataset() {
        const saved = (typeof datasetConfig !== 'undefined' && Array.isArray(datasetConfig.ignoredRedundantPairs)) ? datasetConfig.ignoredRedundantPairs : [];
        window.ignoredRedundantPairs = new Set(saved);
    }

    function installDatasetChangeHook() {
        // Caminho principal: envelopa window.loadDatasetConfig, que roda bem
        // antes de qualquer render/contador pro dataset recém-carregado.
        if (typeof window.loadDatasetConfig === 'function' && !window.loadDatasetConfig.__redundantIgnoreSyncWrapped) {
            const original = window.loadDatasetConfig;
            const wrapped = async function (dirHandle) {
                const result = await original.apply(this, arguments);
                syncIgnoredPairsForDataset();
                return result;
            };
            wrapped.__redundantIgnoreSyncWrapped = true;
            window.loadDatasetConfig = wrapped;
            return true;
        }
        // Fallback de segurança (não deveria ser necessário — loadDatasetConfig
        // já existe bem antes deste arquivo carregar): sincroniza depois do
        // render como rede de segurança, caso window.loadDatasetConfig não
        // esteja disponível por algum motivo (ordem dos <script> alterada).
        if (typeof window.registerPostRenderImageList === 'function') {
            if (!window._redundantDatasetHookRegistered) {
                window.registerPostRenderImageList(() => {
                    syncIgnoredPairsForDataset();
                    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
                });
                window._redundantDatasetHookRegistered = true;
            }
            return true;
        }
        if (typeof window.renderImageList === 'function' && !window.renderImageList.__redundantDatasetWrapped) {
            const orig = window.renderImageList;
            const wrapped = function () {
                orig.apply(this, arguments);
                syncIgnoredPairsForDataset();
                if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            };
            wrapped.__redundantDatasetWrapped = true;
            window.renderImageList = wrapped;
            return true;
        }
        return false;
    }

    window.ignoreRedundantPair = async function (a, b) {
        const key = pairKey(a, b);
        if (window.ignoredRedundantPairs.has(key)) return;
        if (!confirm(`Stop flagging "${a}" and "${b}" as Redundant with each other, IN THIS DATASET?\n\nYou can undo this anytime from 🧩 Manage Rules → 🔁 Redundant Tags → 🔕 Ignored Pairs.`)) return;
        window.ignoredRedundantPairs.add(key);
        await persistIgnoredRedundantPairs();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        refreshRedundantCounters(); // FIX: contador do topbar some junto do aviso
        if (typeof window.showAlert === 'function') window.showAlert(`"${a}" and "${b}" will no longer be flagged as Redundant with each other in this dataset.`, 'info');
        refreshModalIfOpen();
    };

    window.unignoreRedundantPair = async function (key) {
        if (!window.ignoredRedundantPairs.has(key)) return;
        window.ignoredRedundantPairs.delete(key);
        await persistIgnoredRedundantPairs();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        refreshRedundantCounters(); // FIX: idem, ao desfazer o ignore
        refreshModalIfOpen();
    };

    /* ---------- VARREDURA AO VIVO DO QUE ESTÁ REALMENTE EM USO NO DATASET ---------- */
    function computeLiveDatasetTagSet() {
        const set = new Set();
        if (typeof imageFiles === 'undefined') return set;
        imageFiles.forEach(img => {
            if (img.hidden) return;
            if (!img.hasFile || !img.content) return;
            if (img.type === 'tags') {
                img.content.split(',').forEach(t => {
                    const clean = t.trim();
                    if (clean) set.add(clean.toLowerCase());
                });
            } else if (img.type === 'nl') {
                const clean = img.content.trim();
                if (clean) set.add(clean.toLowerCase());
            }
        });
        return set;
    }

    /* ---------- CÁLCULO DE window.tagRedundant (sem filtrar pares aqui — o filtro é por par, na checagem) ---------- */
    async function recomputeTagRedundant() {
        if (window.enableConflictWarnings === false) { window.tagRedundant = []; return; }
        const isEnabled = await window.getSetting('rm_enable_redundant', true);
        if (!isEnabled) { window.tagRedundant = []; return; }
        if (!window.RulesDB || typeof window.RulesDB.getAllRules !== 'function') { window.tagRedundant = []; return; }

        const rows = await window.RulesDB.getAllRules();
        const embeds = rows.filter(r => r.category === 'embed');
        const resolveGroupTags = (tags) => window.RulesCore.resolveGroupTags(tags, embeds);
        window.tagRedundant = rows.filter(r => r.category === 'redundant').map(r => resolveGroupTags(r.tags));
    }

    function wrapApplyUserRulesForRedundant() {
        if (!window.RulesCore || typeof window.RulesCore.applyUserRulesToGlobals !== 'function') return false;
        if (window.RulesCore.applyUserRulesToGlobals.__redundantWrapped) return true;
        const original = window.RulesCore.applyUserRulesToGlobals;
        const wrapped = async function (...args) {
            const result = await original.apply(this, args);
            await recomputeTagRedundant();
            if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            return result;
        };
        wrapped.__redundantWrapped = true;
        window.RulesCore.applyUserRulesToGlobals = wrapped;
        return true;
    }

    /* ---------- CHECAGEM POR TAG (uso real no dataset + filtra pares ignorados DESTE dataset) ---------- */
    /* FIX (performance / "dataset demora mais pra carregar"): esta lógica
       agora vive em getRedundantPartnersWithLiveSet(tagLower, liveSet), que
       recebe o Set de tags-em-uso JÁ PRONTO em vez de recalculá-lo. Isso
       importa porque injectRedundantWarnings() (logo abaixo) chama esta
       checagem UMA VEZ POR TAG da lista "All Dataset Tags" — com centenas
       de tags únicas, refazer computeLiveDatasetTagSet() (uma varredura
       completa de TODAS as imagens) a cada uma delas virava um dos
       principais motivos do dataset "demorar mais pra carregar/renderizar".
       window.checkTagRedundantStatus continua existindo (API pública, caso
       algo mais chame), só que agora é um wrapper fino sobre o helper —
       ainda faz UMA varredura por chamada quando usado isoladamente, mas
       injectRedundantWarnings NÃO passa mais por aqui: ele calcula o
       liveSet uma única vez e chama o helper diretamente para cada tag. */
    function getRedundantPartnersWithLiveSet(tagLower, liveSet) {
        if (!Array.isArray(window.tagRedundant) || window.tagRedundant.length === 0) return [];
        if (!liveSet.has(tagLower)) return [];

        const found = new Set();
        window.tagRedundant.forEach(group => {
            const groupLower = (Array.isArray(group) ? group : []).map(g => String(g).toLowerCase());
            if (!groupLower.includes(tagLower)) return;
            groupLower.forEach(t => {
                if (t === tagLower) return;
                if (!liveSet.has(t)) return;
                if (isRedundantPairIgnored(tagLower, t)) return;
                found.add(t);
            });
        });
        return [...found];
    }

    window.checkTagRedundantStatus = function (tagLower) {
        return getRedundantPartnersWithLiveSet(tagLower, computeLiveDatasetTagSet());
    };

    /* ---------- INJEÇÃO DO AVISO EM All Dataset Tags (pós-render), COM ✖ POR ITEM ---------- */
    function injectRedundantWarnings(container) {
        if (!container) return;

        if (window.enableConflictWarnings === false || !Array.isArray(window.tagRedundant) || window.tagRedundant.length === 0) {
            // Nada a exibir — mas ainda limpa avisos residuais de uma
            // passada anterior (ex: usuário acabou de desativar as regras
            // ou de apagar o último grupo de Redundant configurado).
            container.querySelectorAll('.master-tag-item[data-tag-name]').forEach(item => {
                const existing = item.querySelector('.redundant-warning');
                if (existing) existing.remove();
                item.classList.remove('redundant');
            });
            return;
        }

        // Varredura do dataset feita UMA vez aqui, reaproveitada por todas as tags da lista.
        const liveSet = computeLiveDatasetTagSet();

        container.querySelectorAll('.master-tag-item[data-tag-name]').forEach(item => {
            const existing = item.querySelector('.redundant-warning');
            if (existing) existing.remove();
            item.classList.remove('redundant');

            const tagLower = item.getAttribute('data-tag-name');
            const others = getRedundantPartnersWithLiveSet(tagLower, liveSet);
            if (!others || others.length === 0) return;

            item.classList.add('redundant');
            const leftDiv = item.querySelector('div');
            if (!leftDiv) return;

            const warn = document.createElement('span');
            warn.className = 'redundant-warning';
            warn.title = `Could be merged with: ${others.join(', ')}`;
            warn.onclick = (e) => e.stopPropagation();
            warn.appendChild(document.createTextNode('🔁 Redundant: '));

            others.forEach((other, idx) => {
                const nameSpan = document.createElement('span');
                nameSpan.className = 'redundant-item';
                nameSpan.textContent = other;
                warn.appendChild(nameSpan);

                const x = document.createElement('span');
                x.className = 'redundant-ignore-icon';
                x.textContent = '✖';
                x.title = `Stop flagging "${tagLower}" as redundant with "${other}" (this dataset only)`;
                x.onclick = (e) => { e.stopPropagation(); window.ignoreRedundantPair(tagLower, other); };
                warn.appendChild(x);

                if (idx < others.length - 1) warn.appendChild(document.createTextNode(', '));
            });

            leftDiv.appendChild(warn);
        });
    }

    function installRedundantHooks() {
        if (typeof window.registerPostRenderMasterTagList === 'function') {
            if (!window._redundantHookRegistered) {
                window.registerPostRenderMasterTagList(() => injectRedundantWarnings(document.getElementById('master-tag-list')));
                window._redundantHookRegistered = true;
            }
            return true;
        }
        if (typeof window.renderMasterTagList === 'function' && !window.renderMasterTagList.__redundantWrapped) {
            const orig = window.renderMasterTagList;
            const wrapped = function () { orig.apply(this, arguments); injectRedundantWarnings(document.getElementById('master-tag-list')); };
            wrapped.__redundantWrapped = true;
            window.renderMasterTagList = wrapped;
            return true;
        }
        return false;
    }

    /* ---------- BOOT ---------- */
    registerCategoryMeta();
    registerFactoryRules();
    registerUISection();
    wrapApplyUserRulesForRedundant();
    if (!installRedundantHooks()) window.addEventListener('DOMContentLoaded', () => setTimeout(installRedundantHooks, 0));
    if (!installDatasetChangeHook()) window.addEventListener('DOMContentLoaded', () => setTimeout(installDatasetChangeHook, 0));
    if (!installRedundantCounterHooks()) window.addEventListener('DOMContentLoaded', () => setTimeout(installRedundantCounterHooks, 0));

    window.addEventListener('DOMContentLoaded', async () => {
        wrapApplyUserRulesForRedundant();
        installRedundantCounterHooks();
        await recomputeTagRedundant();
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        refreshRedundantCounters();
    });

})();