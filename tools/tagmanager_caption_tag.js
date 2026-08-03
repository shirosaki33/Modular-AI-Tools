/* =========================================================================
   CAPTION & TAG EDITOR - CORE (Shared CSS + Helpers)
   ---------------------------------------------------------------------
   Este arquivo era o antigo "tagmanager_caption_tag.js" monolítico
   (~1500 linhas). Foi dividido em módulos menores, todos ainda em
   window.* (sem ES modules), então a ORDEM DE CARREGAMENTO no HTML
   continua importando:

     tagmanager_caption_tag.js          <- este arquivo (CSS + checkIfNL)
     tagmanager_danbooru_autocomplete.js
     tagmanager_danbooru_alias.js
     tagmanager_nl_inline_editor.js
     tagmanager_active_editor.js
     tagmanager_master_list.js

   (nessa ordem, no lugar onde só existia 1 <script> antes, sempre ANTES
   de tagmanager_ui_presets.js / tagmanager_ui_list.js / tagmanager_ui_core.js)

   Nada de lógica foi alterado — é só reorganização de arquivo.
========================================================================= */

const style = document.createElement('style');
style.innerHTML = `
    .tag-nl-edit-box { display: flex; flex-direction: column; gap: 8px; padding: 10px 15px; background: #0d0d0d; border-bottom: 1px solid #222; border-left: 3px solid #00aa66; }
    .tag-nl-edit-textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; font-size: var(--editor-font-size); line-height: 1.5; padding: 10px; background: #111; color: #eee; border: 1px solid #00aa66; border-radius: 6px; font-family: inherit; }
 
    .tag-nl-edit-box.tag-nl-edit-fullscreen { flex: 1; height: 100%; padding: 15px; border-left: none; background: #0d0d0d; }
    .tag-nl-edit-box.tag-nl-edit-fullscreen .tag-nl-edit-textarea { flex: 1; min-height: 200px; resize: none; border: 1px solid #4a2a8c;}
    .btn-nl-edit-translate { background:#1a3a5c; color:#4db8ff; border:1px solid #2a5a8c; padding:6px 14px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:bold; }
    .btn-nl-edit-gemini { background:#2f1a5c; color:#b890ff; border:1px solid #4a2a8c; padding:6px 14px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:bold; }
    .btn-nl-edit-cancel { background: transparent; color: #aaa; border: 1px solid #444; padding: 6px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; margin-right: 8px; transition: 0.2s;}
    .btn-nl-edit-save { background: #00aa66; color: #000; border: none; padding: 6px 14px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; transition: 0.2s; }
 
    .tag-pin:hover { transform: scale(1.15); }
    .tag-pin.active { text-shadow: 0 0 6px rgba(77,184,255,0.7); }
    .pinned-master-tag-row:hover { background: #0d2438 !important; }
 
    .db-autocomplete { position: absolute; bottom: 100%; top: auto; left: 0; background: #111; border: 1px solid #333; z-index: 100; border-radius: 6px 6px 0 0; max-height: 200px; overflow-y: auto; min-width: 100%; width: max-content; box-shadow: 0 -4px 12px rgba(0,0,0,0.8); margin-bottom: 4px; }
    /* Usado pelo input "replace-new-tag" (direction='down'). Sem isto, a lista de
       sugestões sempre abria pra CIMA (herdando a regra acima) mesmo quando devia
       abrir pra baixo — dentro do modal de Replace isso cobria o campo "tag antiga"
       logo acima do input. */
    .db-autocomplete.direction-down { bottom: auto; top: 100%; margin-bottom: 0; margin-top: 4px; border-radius: 0 0 6px 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.8); }
    .db-sugg-item { padding: 8px 10px; border-bottom: 1px solid #222; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 20px; font-size: 12px; white-space: nowrap; }
    .db-sugg-item:hover { background: #222; }
    
    .tag-row.conflict, .master-tag-item.conflict { background: rgba(200, 40, 40, 0.3) !important; border-left: 3px solid #ff4444 !important; }
    .conflict-warning { margin-left: 12px; font-size: 10px; color: #ffaaaa; background: #330000; padding: 2px 8px; border-radius: 12px; border: 1px solid #ff4444; cursor: help; display: inline-block;}
    
    .tag-row.similar, .master-tag-item.similar { background: rgba(200, 150, 40, 0.2) !important; border-left: 3px solid #ffcc00 !important; }
    .similar-warning { margin-left: 12px; font-size: 10px; color: #ffeeaa; background: #332200; padding: 2px 8px; border-radius: 12px; border: 1px solid #ffcc00; cursor: help; display: inline-block;}
    
    .tag-row.glow-favorite, .master-tag-item.glow-favorite { background: rgba(0, 80, 40, 0.4) !important; border-left: 3px solid #00ff99 !important; transition: 0.1s; }
    /* Seleção (azul) precisa continuar visível mesmo quando a tag também é favorita (⭐).
       Sem isto, o !important do glow-favorite sempre "vencia" o background da seleção,
       fazendo parecer que a tag não estava selecionada. Maior especificidade (2 classes)
       resolve isto sem precisar mexer na ordem das regras. */
    .tag-row.selected-active.glow-favorite, .master-tag-item.selected-master.glow-favorite {
        background: #0a3a5c !important;
        border-left: 3px solid #4db8ff !important;
    }
    .tag-row.filter-match { box-shadow: inset 0 0 0 1px #ff9500; background: rgba(255, 149, 0, 0.14) !important; }
    .tag-row.is-preset, .master-tag-item.is-preset { background: rgba(45, 212, 191, 0.14) !important; border-left: 3px solid #2dd4bf !important; }
	.tag-to-ghost { color: #00ff99; cursor: pointer; font-weight: bold; font-size: 1.1em; padding: 0 0.4em; flex-shrink: 0; opacity: 0.85; }
    .tag-to-ghost:hover { color: #fff; transform: scale(1.2); opacity: 1; }
 
    .db-alias-arrow { color: #ffcc66; font-weight: normal; font-size: 11px; margin-left: 4px; }
    .tag-alias-arrow { color:#ffcc66; font-size:10px; margin-left:6px; font-weight:bold; cursor:help; }
    .tag-alias-info-icon { cursor: pointer; font-weight: bold; font-size: 1em; padding: 0 0.35em; flex-shrink: 0; opacity: 0.85; user-select: none; transition: 0.1s; }
    .tag-alias-info-icon:hover { transform: scale(1.2); opacity: 1; }

    .tag-name-convertible { cursor: pointer; text-decoration: underline dotted; text-decoration-color: rgba(255,204,102,0.55); text-underline-offset: 3px; }
    .tag-name-convertible:hover { color: #fff !important; }
    .tag-alias-reverse-list { color: #4db8ff; font-size: 10px; margin-left: 8px; font-weight: bold; opacity: 0.9; }
`;
document.head.appendChild(style);
 
window.checkIfNL = function(tag) {
    if (!tag) return false;
    if (typeof datasetConfig !== 'undefined' && datasetConfig.manualNLRules && datasetConfig.manualNLRules[tag] !== undefined) {
        return datasetConfig.manualNLRules[tag] === 'nl';
    }
    return window.enableAutoNl !== false && tag.trim().split(/\s+/).length >= (window.nlWordThreshold || 6);
};