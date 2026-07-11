/* =========================================================================
   CUSTOM TAG RULES MODULE (AUTOMATION)
   Módulo separado e plugável para automações de tags que rodam SEM pedir
   confirmação. Cada regra é um objeto simples dentro de window.customTagRules;
   para adicionar uma regra nova no futuro, basta empurrar outro objeto no
   array lá embaixo — não precisa mexer no resto do arquivo.

   Como usar:
     - Botão "⚙️ Custom Rules" no topbar: roda em todo o dataset, salva no
       disco e mostra um alerta com quantas imagens mudaram.
     - Toggle dentro do modal "🧠 AI Tag Audit": se marcado, roda as regras
       customizadas (em silêncio) ANTES do scan de IA começar.
     - Programático: window.runCustomTagRules({ silent: true/false })
========================================================================= */

/* === LISTA DE PALAVRAS-CHAVE DE ROUPA (BASE — AJUSTE LIVREMENTE) ===
   Qualquer tag que CONTENHA uma dessas palavras é considerada "tag de roupa".
   É um match por substring (case-insensitive), então "black dress" bate em
   "dress", "thighhighs" bate em "thigh...", etc. Adicione/remova conforme
   o vocabulário do seu dataset. */
const CUSTOM_RULES_CLOTHING_KEYWORDS = [
    'shirt', 'dress', 'skirt', 'pants', 'shorts', 'jeans', 'jacket', 'coat',
    'sweater', 'hoodie', 'cardigan', 'vest', 'blazer', 'uniform', 'suit',
    'kimono', 'robe', 'gown', 'swimsuit', 'bikini', 'lingerie', 'underwear',
    'panties', 'bra', 'boxers', 'briefs', 'socks', 'thighhighs', 'pantyhose',
    'stockings', 'leggings', 'gloves', 'mittens', 'scarf', 'tie', 'necktie',
    'bowtie', 'collar', 'hat', 'cap', 'hood', 'veil', 'mask', 'apron',
    'overalls', 'romper', 'leotard', 'bodysuit', 'top', 'blouse', 'tank top',
    'crop top', 'tube top', 'camisole', 'corset', 'harness', 'belt',
    'shoes', 'boots', 'sandals', 'heels', 'sneakers', 'slippers',
    'armor', 'clothes', 'clothing', 'outfit', 'costume'
];

function customRulesIsClothingTag(tag) {
    const t = tag.toLowerCase();
    return CUSTOM_RULES_CLOTHING_KEYWORDS.some(kw => t.includes(kw));
}

/* === MOTOR DE REGRAS ===
   Cada regra recebe o array de tags atual de UMA imagem (já trim/limpo) e
   deve retornar:
     - null / undefined  → nada a fazer, não mexe na tag
     - um NOVO array de tags → substitui o conteúdo da imagem por esse array
   Isso deixa fácil empilhar quantas regras quiser sem que uma pise na outra. */
window.customTagRules = window.customTagRules || [
    {
        name: 'nude_downgrade',
        description: '"completely nude" só é mantida se também houver "full body" e nenhuma tag de roupa. Caso contrário vira "nude".',
        run: function (tagsArray) {
            if (!tagsArray.includes('completely nude')) return null;

            const hasFullBody = tagsArray.includes('full body');
            const hasClothing = tagsArray.some(customRulesIsClothingTag);

            // Padrão válido para manter "completely nude": full body + sem roupa nenhuma
            if (hasFullBody && !hasClothing) return null;

            // Caso contrário, faz o downgrade automático
            let newTags = tagsArray.map(t => (t === 'completely nude' ? 'nude' : t));
            newTags = [...new Set(newTags)]; // evita duplicar "nude" se já existisse
            return newTags;
        }
    }
    // 👉 Para adicionar uma nova regra, copie o bloco acima e ajuste
    // "name", "description" e a função "run".
];

/* === APLICAÇÃO DAS REGRAS NO DATASET INTEIRO === */
window.runCustomTagRules = async function (opts) {
    opts = opts || {};
    const silent = opts.silent === true;

    if (typeof imageFiles === 'undefined' || !imageFiles || imageFiles.length === 0) {
        if (!silent && window.showAlert) window.showAlert('Load a dataset with tags first!', 'error');
        return { changed: 0 };
    }

    let changedCount = 0;
    const touched = [];

    imageFiles.forEach(img => {
        if (img.type !== 'tags' || !img.content) return;

        let currentTags = img.content.split(',').map(t => t.trim()).filter(t => t);
        let imgChanged = false;

        window.customTagRules.forEach(rule => {
            try {
                const result = rule.run(currentTags);
                if (result) {
                    currentTags = result;
                    imgChanged = true;
                }
            } catch (e) {
                console.warn(`[Custom Rules] Erro na regra "${rule.name}"`, e);
            }
        });

        if (imgChanged) {
            img.content = currentTags.join(', ');
            img.hasFile = true;
            touched.push(img);
            changedCount++;
        }
    });

    if (changedCount > 0) {
        // Recalcula o master tag set considerando as tags que mudaram
        if (typeof masterTagSet !== 'undefined') {
            imageFiles.forEach(img => {
                if (img.type === 'tags' && img.content) {
                    img.content.split(',').forEach(t => { if (t.trim()) masterTagSet.add(t.trim()); });
                }
            });
            // Remove do master set tags que não são mais usadas por ninguém
            ['completely nude'].forEach(possiblyOrphaned => {
                const stillUsed = imageFiles.some(img =>
                    img.type === 'tags' && img.content &&
                    img.content.split(',').map(t => t.trim()).includes(possiblyOrphaned)
                );
                if (!stillUsed) masterTagSet.delete(possiblyOrphaned);
            });
        }

        if (typeof window.updateTagsDatalist === 'function') window.updateTagsDatalist();
        if (typeof window.renderImageList === 'function') window.renderImageList();
        if (typeof renderMasterTagList === 'function') renderMasterTagList();
        if (typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && typeof window.renderEditor === 'function') window.renderEditor();
        if (typeof refreshListStatus === 'function') refreshListStatus();
        if (typeof window.applyFilters === 'function') window.applyFilters();

        // Salva no disco as imagens que mudaram (reaproveita o helper já
        // existente no módulo de AI Audit, que também fica global por não
        // ser um ES module)
        if (typeof window.saveImageToDisk === 'function') {
            await Promise.all(touched.map(img => window.saveImageToDisk(img)));
        }
    }

    if (!silent && window.showAlert) {
        window.showAlert(
            changedCount > 0
                ? `Custom Rules aplicadas: ${changedCount} imagem(ns) atualizada(s). Salvo no disco.`
                : 'Custom Rules: nenhuma alteração necessária.',
            changedCount > 0 ? 'success' : 'info'
        );
    }

    return { changed: changedCount };
};

/* === BOTÃO MANUAL NO TOPBAR === */
function injectCustomRulesButton() {
    const rightBar = document.getElementById('topbar-right');
    const anchor = document.getElementById('btn-settings');
    if (!rightBar || !anchor) return;

    const btn = document.createElement('button');
    btn.id = 'btn-custom-rules';
    btn.title = 'Aplica as Custom Tag Rules em todo o dataset, sem pedir confirmação';
    btn.textContent = '⚙️ Custom Rules';
    btn.onclick = () => window.runCustomTagRules({ silent: false });
    rightBar.insertBefore(btn, anchor);
}

/* === TOGGLE DENTRO DO MODAL DO AI AUDIT ===
   Injeta um checkbox logo acima do botão "Analyze Dataset Tags". Como esse
   script carrega DEPOIS do tag_manager_ai_conflicts.js (ver tag_manager.html),
   o modal já existe no DOM quando este DOMContentLoaded roda. */
function injectCustomRulesToggleInAuditModal() {
    const runBtn = document.getElementById('btn-run-ai-audit');
    if (!runBtn) return;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; align-items:center; gap:8px; background:#0d1f13; border:1px solid #1a5c3a; padding:8px 10px; border-radius:6px; margin: 10px 0 0;';
    wrap.innerHTML = `
        <input type="checkbox" id="custom-rules-toggle-scan" style="width:auto; margin:0;">
        <label for="custom-rules-toggle-scan" style="font-size:11px; color:#66ffaa; font-weight:bold; cursor:pointer; user-select:none;">
            ⚙️ Também aplicar Custom Tag Rules (ex: completely nude → nude) antes do scan
        </label>
    `;
    runBtn.parentNode.insertBefore(wrap, runBtn);
}

/* === LIGA O TOGGLE AO SCAN DE IA ===
   Em vez de editar tag_manager_ai_conflicts.js, "envelopamos" a função
   window.runTagConflictAnalysis: se o toggle estiver marcado, rodamos as
   Custom Rules (em silêncio) antes de deixar o scan original seguir normal. */
function wrapAuditRunWithCustomRules() {
    if (typeof window.runTagConflictAnalysis !== 'function') return;

    const originalRun = window.runTagConflictAnalysis;
    window.runTagConflictAnalysis = async function (...args) {
        const toggle = document.getElementById('custom-rules-toggle-scan');
        if (toggle && toggle.checked) {
            await window.runCustomTagRules({ silent: true });
        }
        return originalRun.apply(this, args);
    };
}

window.addEventListener('DOMContentLoaded', () => {
    injectCustomRulesButton();
    injectCustomRulesToggleInAuditModal();
    wrapAuditRunWithCustomRules();
});
