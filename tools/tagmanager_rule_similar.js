/* =========================================================================
   2. SIMILAR TAGS - TAG MANAGER
   ---------------------------------------------------------------------
   Similar/Redundant tags logic and Yellow UI Section.

   FEATURE (Ignore aviso de Similar — POR PAR ESPECÍFICO):
   O aviso "🟨 Similar: tagB, tagC" (ao lado de tagA) agora tem um ✖
   individual do lado de CADA nome listado, não um único botão pro aviso
   inteiro. Clicar no ✖ ao lado de "tagB" desliga só o PAR (tagA, tagB) —
   "tagC" continua aparecendo normalmente, e "tagB" continua avisando
   normalmente contra qualquer OUTRA tag que não seja "tagA".

   COMO FUNCIONA:
   - Este arquivo NÃO toca em window.tagSimilar (o array de grupos
     continua intacto) — ele reconstrói o próprio badge ".similar-warning"
     DEPOIS que Active Image / All Dataset Tags / User Presets já
     renderizaram (via hooks pós-render), lendo a lista de "outras tags"
     direto do atributo title="Similar/Redundant to: ..." que os 3
     arquivos já preenchem hoje (formato idêntico nos 3), filtrando os
     pares já ignorados e remontando o conteúdo com um ✖ por item.
   - Os pares ignorados ficam em window.ignoredSimilarPairs (chave
     canônica "tagA\u241FtagB", ordem alfabética, case-insensitive),
     persistido via saveSetting.
   - Se, depois de filtrar, não sobrar nenhuma tag no aviso, o badge
     inteiro é removido (e a classe .similar da linha também).
   - Uma seção recolhível "🔕 Ignored Pairs" aparece dentro do próprio
     painel 🟨 Similar (Yellow) no modal "🧩 Manage Rules", listando os
     pares ignorados (ex: "boots ↔ shoes") com um jeito de desfazer.
========================================================================= */

(function () {
    const FACTORY_SIMILAR = [
        ['happy', 'smile', 'smiling', 'grin', 'laughing'],
        ['sad', 'crying', 'tears', 'frowning'],
        ['angry', 'annoyed', 'scowl', 'glaring'],
        ['expressionless', 'blank stare', 'emotionless'],
        ['shocked', 'wide-eyed'],
        ['closed mouth', 'parted lips', 'open mouth'],
        ['crouching', 'squatting'],
        ['short hair', 'medium hair', 'long hair', 'very long hair', 'absurdly long hair'],
        ['blonde hair', 'red hair', 'brown hair', 'black hair', 'blue hair', 'purple hair', 'pink hair', 'green hair', 'white hair', 'silver hair', 'grey hair'],
        ['flat chest', 'small breasts', 'medium breasts', 'large breasts', 'huge breasts', 'gigantic breasts'],
        ['nude', 'completely nude', 'topless', 'bottomless', 'naked'],
        ['portrait', 'close-up', 'cowboy shot', 'upper body', 'full body'],
        ['from above', 'from below', 'from behind', 'from side'],
        ['dutch angle', 'tilted frame']
    ];

    FACTORY_SIMILAR.forEach((tags, i) => window.RulesDB.factoryRules.push({ id: 'def_sim_'+i, category: 'similar', isDefault: true, tags }));

    window.IssueCounters.types.push('similar');

    /* =====================================================================
       IGNORE SIMILAR WARNING — POR PAR ESPECÍFICO
    ===================================================================== */

    const style = document.createElement('style');
    style.innerHTML = `
        .similar-item { margin: 0 2px; }
        .similar-ignore-icon {
            margin: 0 4px 0 1px; cursor: pointer; font-size: 0.85em; color: #ff8a8a; opacity: 0.75;
            user-select: none; transition: 0.15s;
        }
        .similar-ignore-icon:hover { opacity: 1; transform: scale(1.2); }

        .rule-ignored-toggle {
            font-size:10px; color:#aaa; text-transform:uppercase; font-weight:bold; letter-spacing:0.5px;
            padding: 8px 10px; background: #1a1a1a; border: 1px solid #333; border-radius: 6px;
            cursor: pointer; display: flex; justify-content: space-between; align-items: center;
            user-select: none; transition: 0.15s; margin-bottom: 6px;
        }
        .rule-ignored-toggle:hover { background: #222; }
        .rule-ignored-body { display: none; flex-wrap: wrap; gap: 6px; padding: 8px 2px 4px; margin-bottom: 4px; }
        .ignored-tag-chip {
            background:#151515; border:1px solid #444; border-radius:14px;
            padding:4px 10px; font-size:11px; display:flex; align-items:center; gap:6px; color:#ffcc66;
        }
        .ignored-tag-chip .chip-x { cursor:pointer; color:#ff6060; font-weight:bold; }
        .ignored-tag-chip .chip-x:hover { color:#fff; }

        /* Modal mais largo + evita colunas espremidas */
        #modal-conflict-manager .tool-modal { width: 97vw !important; max-width: 1800px !important; }
        #conflict-manager-body { overflow-x: auto; }
        #conflict-manager-body > .panel { min-width: 280px; }
    `;
    document.head.appendChild(style);

    /* ---------- CHAVE CANÔNICA DE PAR (compartilhada com tagmanager_rule_redundant.js) ---------- */
    function pairKey(a, b) {
        const x = String(a).trim().toLowerCase(), y = String(b).trim().toLowerCase();
        return x < y ? `${x}\u241F${y}` : `${y}\u241F${x}`;
    }
    function formatPairKey(key) {
        return key.split('\u241F').join(' ↔ ');
    }
    // Exposto globalmente pra reaproveitar em tagmanager_rule_redundant.js sem duplicar.
    window.RulesCore = window.RulesCore || {};
    window.RulesCore.pairKey = window.RulesCore.pairKey || pairKey;
    window.RulesCore.formatPairKey = window.RulesCore.formatPairKey || formatPairKey;

    /* ---------- BLOCO RECOLHÍVEL REUTILIZÁVEL DE "PARES IGNORADOS" ----------
       tagmanager_rule_redundant.js usa a mesma função
       (window.RulesUI.buildIgnoredPairsBlock), pra não duplicar CSS/HTML. */
    window.RulesUI = window.RulesUI || {};
    window.RulesUI.buildIgnoredPairsBlock = function (label, ignoredSet, unignoreFn, formatFn) {
        const container = document.createElement('div');

        const toggle = document.createElement('div');
        toggle.className = 'rule-ignored-toggle';
        toggle.innerHTML = `<span>🔕 ${label} <span style="font-size:9px; color:#666; text-transform:none; margin-left:5px;">(${ignoredSet.size})</span></span> <span class="toggle-icon" style="font-size: 12px;">▼</span>`;

        const body = document.createElement('div');
        body.className = 'rule-ignored-body';

        if (ignoredSet.size === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:11px; color:#555; font-style:italic; padding: 2px 6px;';
            empty.textContent = 'No ignored pairs.';
            body.appendChild(empty);
        } else {
            Array.from(ignoredSet).sort().forEach(key => {
                const chip = document.createElement('span');
                chip.className = 'ignored-tag-chip';
                chip.innerHTML = `<span>${window.RulesUI.escapeHTML(formatFn(key))}</span><span class="chip-x" title="Stop ignoring">✖</span>`;
                chip.querySelector('.chip-x').onclick = () => unignoreFn(key);
                body.appendChild(chip);
            });
        }

        toggle.onclick = () => {
            const isCollapsed = body.style.display === 'none' || !body.style.display;
            body.style.display = isCollapsed ? 'flex' : 'none';
            toggle.querySelector('.toggle-icon').textContent = isCollapsed ? '▲' : '▼';
            toggle.style.color = isCollapsed ? '#fff' : '#aaa';
        };

        container.appendChild(toggle);
        container.appendChild(body);
        return container;
    };

    window.RulesUI.registerSection(2, async (rows) => {
        const isEnabled = await window.getSetting('rm_enable_yellow', true);
        const wrap = window.RulesUI.renderGenericCategorySection('similar', rows, isEnabled, 'rm_enable_yellow');
        const list = wrap.querySelector('.panel-list-scroll');
        if (list) {
            const block = window.RulesUI.buildIgnoredPairsBlock('Ignored Pairs', window.ignoredSimilarPairs, window.unignoreSimilarPair, formatPairKey);
            list.insertBefore(block, list.firstChild);
        }
        return wrap;
    });

    /* ---------- ESTADO + PERSISTÊNCIA (POR DATASET — ver FIX abaixo) ---------- */
    window.ignoredSimilarPairs = window.ignoredSimilarPairs || new Set();

    function isSimilarPairIgnored(a, b) {
        return window.ignoredSimilarPairs.has(pairKey(a, b));
    }

    /* ---------------------------------------------------------------------
       FIX (escopo errado): antes esta lista era salva via window.saveSetting
       ('ignored-similar-pairs', ...) — uma configuração GLOBAL (mesmo blob
       usado por toda a UI, persistido no user_config.json/IndexedDB geral).
       Isso significava que ignorar um par ("boots" ↔ "shoes", por exemplo)
       em UM dataset passava a ignorar esse mesmo par em QUALQUER outro
       dataset aberto depois — o oposto do que tagmanager_rule_redundant.js
       já fazia corretamente (ignoredRedundantPairs, por dataset).

       Agora usamos o MESMO mecanismo do Redundant: a lista fica dentro de
       datasetConfig.ignoredSimilarPairs, salva no "_tagger_config.json" da
       PRÓPRIA pasta do dataset (via window.saveDatasetConfig) — exclusiva
       daquele dataset, nunca vaza pra outro. window.ignoredSimilarPairs em
       memória é resincronizado automaticamente sempre que window.imageFiles
       troca de referência (dataset/subpasta diferente carregado), igual ao
       padrão já usado pelo Redundant (ver syncIgnoredPairsForDataset).

       NOTA DE MIGRAÇÃO: pares que já estavam ignorados globalmente (salvos
       ANTES desta correção, na chave 'ignored-similar-pairs') não são mais
       lidos daqui — como aquele valor estava incorretamente aplicado a
       tudo, ele simplesmente deixa de ter efeito; cada dataset volta a
       mostrar os avisos normalmente até você ignorar de novo, agora já
       gravado só naquele dataset. */
    async function persistIgnoredSimilarPairs() {
        if (typeof datasetConfig === 'undefined') return;
        datasetConfig.ignoredSimilarPairs = Array.from(window.ignoredSimilarPairs);
        const handle = window.currentImagesHandle || window.rootHandle;
        if (handle && typeof window.saveDatasetConfig === 'function') await window.saveDatasetConfig(handle);
    }

    /* ---------------------------------------------------------------------
       FIX #2 (contador do topbar "voltava" mesmo com o par ignorado): a
       primeira versão desta sincronização rodava num hook de PÓS-
       renderImageList (registerPostRenderImageList). O problema é que
       window.applyFilters() — a função que calcula o contador "🟨 X
       Similar" do topbar — já é chamada DENTRO da implementação verdadeira
       de renderImageList, ANTES desse hook rodar. Ou seja: ao trocar de
       dataset e voltar, o contador do topbar era calculado usando
       window.ignoredSimilarPairs do dataset ANTERIOR (ou vazio, se fosse a
       primeira troca) — só sendo corrigido DEPOIS, quando o hook
       finalmente rodava. O aviso por linha (badge individual na tag) já
       ficava certo, porque é recalculado de novo, mais tarde, quando
       renderMasterTagList roda pela segunda vez em finishLoading() — mas o
       contador do topbar não tinha mais nenhuma chance de se corrigir
       sozinho, dando a impressão de que "o ignore não pegou".

       Agora sincronizamos MUITO mais cedo: junto com window.loadDatasetConfig
       — a própria função que lê o _tagger_config.json do dataset — que já
       roda ANTES de imageFiles ser resetado, ANTES de qualquer render e
       ANTES de qualquer chamada a applyFilters(). Assim, quando o contador
       for calculado pela primeira vez pro dataset recém-carregado,
       window.ignoredSimilarPairs já está correto. */
    function syncIgnoredPairsForDatasetSimilar() {
        const saved = (typeof datasetConfig !== 'undefined' && Array.isArray(datasetConfig.ignoredSimilarPairs)) ? datasetConfig.ignoredSimilarPairs : [];
        window.ignoredSimilarPairs = new Set(saved);
    }

    function installSimilarDatasetChangeHook() {
        // Caminho principal: envelopa window.loadDatasetConfig, que roda bem
        // antes de qualquer render/contador pro dataset recém-carregado.
        if (typeof window.loadDatasetConfig === 'function' && !window.loadDatasetConfig.__similarIgnoreSyncWrapped) {
            const original = window.loadDatasetConfig;
            const wrapped = async function (dirHandle) {
                const result = await original.apply(this, arguments);
                syncIgnoredPairsForDatasetSimilar();
                return result;
            };
            wrapped.__similarIgnoreSyncWrapped = true;
            window.loadDatasetConfig = wrapped;
            return true;
        }
        // Fallback de segurança (não deveria ser necessário — loadDatasetConfig
        // já existe bem antes deste arquivo carregar): sincroniza depois do
        // render como rede de segurança, caso window.loadDatasetConfig não
        // esteja disponível por algum motivo (ordem dos <script> alterada).
        if (typeof window.registerPostRenderImageList === 'function') {
            if (!window._similarDatasetHookRegistered) {
                window.registerPostRenderImageList(() => {
                    syncIgnoredPairsForDatasetSimilar();
                    if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
                });
                window._similarDatasetHookRegistered = true;
            }
            return true;
        }
        if (typeof window.renderImageList === 'function' && !window.renderImageList.__similarDatasetWrapped) {
            const orig = window.renderImageList;
            const wrapped = function () {
                orig.apply(this, arguments);
                syncIgnoredPairsForDatasetSimilar();
                if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
            };
            wrapped.__similarDatasetWrapped = true;
            window.renderImageList = wrapped;
            return true;
        }
        return false;
    }
    if (!installSimilarDatasetChangeHook()) window.addEventListener('DOMContentLoaded', () => setTimeout(installSimilarDatasetChangeHook, 0));

    function refreshAllSimilarSurfaces() {
        if (typeof window.renderMasterTagList === 'function') window.renderMasterTagList();
        if (typeof window.renderPresetTags === 'function') window.renderPresetTags();
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();

        // FIX: os contadores do topbar (⚠️ X Conflicts / 🟨 X Similar / 🔁 X
        // Redundant) precisam ser recalculados quando um par é ignorado/
        // desfeito pelo ✖. Em vez de chamar window.IssueCounters diretamente
        // (acoplamento com a implementação interna de outro arquivo, e um
        // caminho fácil de duplicar/errar), reaproveitamos window.applyFilters()
        // — que já dispara TODOS os hooks de contador registrados (Conflict/
        // Similar via tagmanager_rule_conflict.js, Redundant via
        // tagmanager_rule_redudant.js) através do mesmo pipeline usado por
        // qualquer outra ação do app. renderEditor() acima já cobre o
        // contador "ativo" quando há seleção.
        if (typeof window.applyFilters === 'function') window.applyFilters();
    }

    function refreshModalIfOpen() {
        const modal = document.getElementById('modal-conflict-manager');
        if (modal && modal.classList.contains('active') && window.RulesUI && typeof window.RulesUI.refreshModalBody === 'function') {
            window.RulesUI.refreshModalBody();
        }
    }

    /* ---------- AÇÕES DE IGNORAR / DESFAZER (POR PAR) ---------- */
    window.ignoreSimilarPair = async function (a, b) {
        const key = pairKey(a, b);
        if (window.ignoredSimilarPairs.has(key)) return;
        if (!confirm(`Stop flagging "${a}" and "${b}" as Similar to each other?\n\nYou can undo this anytime from 🧩 Manage Rules → 🟨 Similar (Yellow) → 🔕 Ignored Pairs.`)) return;
        window.ignoredSimilarPairs.add(key);
        await persistIgnoredSimilarPairs();
        refreshAllSimilarSurfaces();
        if (typeof window.showAlert === 'function') window.showAlert(`"${a}" and "${b}" will no longer be flagged as Similar to each other.`, 'info');
        refreshModalIfOpen();
    };

    window.unignoreSimilarPair = async function (key) {
        if (!window.ignoredSimilarPairs.has(key)) return;
        window.ignoredSimilarPairs.delete(key);
        await persistIgnoredSimilarPairs();
        refreshAllSimilarSurfaces();
        refreshModalIfOpen();
    };

    /* ---------- RECONSTRÓI O BADGE .similar-warning JÁ RENDERIZADO, FILTRANDO PARES IGNORADOS ----------
       Funciona em Active Image (.tag-row), All Dataset Tags (.master-tag-item)
       e User Presets (.master-tag-item dentro de #preset-tag-list) porque os
       3 já preenchem title="Similar/Redundant to: tagB, tagC" no MESMO
       formato — a gente só lê esse título, filtra e remonta o conteúdo. */
    function rebuildSimilarWarning(warnEl) {
        const row = warnEl.closest('.tag-row, .master-tag-item');
        const nameEl = row ? row.querySelector('.tag-name') : null;
        const tag = nameEl ? nameEl.textContent.trim().toLowerCase() : null;
        if (!tag) return;

        const prefix = 'Similar/Redundant to: ';
        const rawTitle = warnEl.getAttribute('title') || '';
        const listStr = rawTitle.startsWith(prefix) ? rawTitle.slice(prefix.length) : rawTitle;
        const others = listStr.split(',').map(s => s.trim()).filter(Boolean);
        const visibleOthers = others.filter(o => !isSimilarPairIgnored(tag, o));

        if (visibleOthers.length === 0) {
            if (row) row.classList.remove('similar');
            warnEl.remove();
            return;
        }

        warnEl.setAttribute('title', prefix + visibleOthers.join(', '));
        warnEl.innerHTML = '';
        warnEl.onclick = (e) => e.stopPropagation();
        warnEl.appendChild(document.createTextNode('🟨 Similar: '));

        visibleOthers.forEach((other, idx) => {
            const item = document.createElement('span');
            item.className = 'similar-item';
            item.textContent = other;
            warnEl.appendChild(item);

            const x = document.createElement('span');
            x.className = 'similar-ignore-icon';
            x.textContent = '✖';
            x.title = `Stop flagging "${tag}" as similar to "${other}"`;
            x.onclick = (e) => { e.stopPropagation(); window.ignoreSimilarPair(tag, other); };
            warnEl.appendChild(x);

            if (idx < visibleOthers.length - 1) warnEl.appendChild(document.createTextNode(', '));
        });
    }

    function injectIgnoreSimilarIcons(container) {
        if (!container) return;
        container.querySelectorAll('.similar-warning').forEach(rebuildSimilarWarning);
    }

    function installIgnoreIconHooks() {
        if (typeof window.registerPostRenderEditor === 'function' && typeof window.registerPostRenderMasterTagList === 'function') {
            if (!window._ignoreSimilarHooksRegistered) {
                window.registerPostRenderEditor(() => injectIgnoreSimilarIcons(document.getElementById('tag-list-vertical')));
                window.registerPostRenderMasterTagList(() => injectIgnoreSimilarIcons(document.getElementById('master-tag-list')));
                window._ignoreSimilarHooksRegistered = true;
            }
        } else {
            if (typeof window.renderEditor === 'function' && !window.renderEditor.__ignoreSimilarWrapped) {
                const orig = window.renderEditor;
                const wrapped = function () { orig.apply(this, arguments); injectIgnoreSimilarIcons(document.getElementById('tag-list-vertical')); };
                wrapped.__ignoreSimilarWrapped = true;
                window.renderEditor = wrapped;
            }
            if (typeof window.renderMasterTagList === 'function' && !window.renderMasterTagList.__ignoreSimilarWrapped) {
                const orig2 = window.renderMasterTagList;
                const wrapped2 = function () { orig2.apply(this, arguments); injectIgnoreSimilarIcons(document.getElementById('master-tag-list')); };
                wrapped2.__ignoreSimilarWrapped = true;
                window.renderMasterTagList = wrapped2;
            }
        }
        if (typeof window.renderPresetTags === 'function' && !window.renderPresetTags.__ignoreSimilarWrapped) {
            const origP = window.renderPresetTags;
            const wrappedP = async function (...args) {
                const r = await origP.apply(this, args);
                injectIgnoreSimilarIcons(document.getElementById('preset-tag-list'));
                return r;
            };
            wrappedP.__ignoreSimilarWrapped = true;
            window.renderPresetTags = wrappedP;
        }
        return true;
    }
    installIgnoreIconHooks();

    /* ---------- CORRIGE O CONTADOR "🟨 X Similar" PRA RESPEITAR PARES IGNORADOS ----------
       window.getIssuesCountForTags (tagmanager_rule_conflict.js) contava
       qualquer tag presente em 2+ membros de um grupo Similar. Agora só
       conta uma tag se ela tiver pelo menos 1 parceiro NÃO ignorado
       presente junto dela. */
    function wrapGetIssuesCountForTags() {
        if (typeof window.getIssuesCountForTags !== 'function' || window.getIssuesCountForTags.__pairIgnoreWrapped) return false;
        const original = window.getIssuesCountForTags;
        const wrapped = function (tagsArray) {
            const result = original(tagsArray);
            const tagsLower = tagsArray.map(t => String(t).trim().toLowerCase()).filter(t => t);
            if (Array.isArray(window.tagSimilar)) {
                const similarTags = new Set();
                window.tagSimilar.forEach(group => {
                    const groupLower = (Array.isArray(group) ? group : []).map(g => String(g).toLowerCase());
                    const activeInGroup = groupLower.filter(g => tagsLower.includes(g));
                    activeInGroup.forEach(t => {
                        const hasValidPartner = activeInGroup.some(o => o !== t && !isSimilarPairIgnored(t, o));
                        if (hasValidPartner) similarTags.add(t);
                    });
                });
                result.similars = similarTags.size;
            }
            return result;
        };
        wrapped.__pairIgnoreWrapped = true;
        window.getIssuesCountForTags = wrapped;
        return true;
    }
    if (!wrapGetIssuesCountForTags()) window.addEventListener('DOMContentLoaded', () => setTimeout(wrapGetIssuesCountForTags, 0));

    /* ---------- BOOT ----------
       Antes carregava window.ignoredSimilarPairs de uma chave GLOBAL
       ('ignored-similar-pairs') logo no boot. Agora isso é feito
       automaticamente, POR DATASET, pelo hook installSimilarDatasetChangeHook
       acima (syncIgnoredPairsForDatasetSimilar), que dispara assim que o
       primeiro dataset é carregado — não há mais nada global pra ler aqui. */
    window.addEventListener('DOMContentLoaded', () => {
        refreshAllSimilarSurfaces();
    });

})();