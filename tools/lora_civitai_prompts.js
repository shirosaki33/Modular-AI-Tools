/**
 * tools/lora_civitai_prompts.js
 */
(function() {
    const style = document.createElement('style');
    style.innerHTML = `
        .olc-prompts-inner { padding: 0; width: 100%; box-sizing: border-box; }
        .online-prompt-block { margin-bottom: 12px; width: 100%; box-sizing: border-box; }
        .online-prompt-block:last-child { margin-bottom: 0; }
        .online-prompt-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
        .online-prompt-area { background: #0d0d0d; color: #00cc88; width: 100%; border: 1px solid #1e1e1e; border-radius: 6px; padding: 8px 10px; font-family: inherit; font-size: 13px; resize: none; overflow: hidden; box-sizing: border-box; display: block; height: auto; min-height: 36px; }
    `;
    document.head.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.id = 'civitai-prompts-wrapper';
    wrapper.style.cssText = "width:100%; box-sizing:border-box;";
    wrapper.innerHTML = `
        <div class="olc-prompts-inner">
            <div id="onlinePromptsContent"><span style="color: #444; font-size: 12px; font-style: italic;">Loading...</span></div>
        </div>
    `;
    
    window.registerToolModule('💬 Civitai Prompts', '#00cc88', wrapper);

    // 1. Inicia o módulo TOTALMENTE oculto (esconde a barra mãe inteira)
    setTimeout(() => {
        const mod = wrapper.closest('.tool-module');
        if (mod) mod.style.display = 'none';
    }, 0);

    // 2. Esconde o módulo novamente ao carregar um arquivo novo
    const origReset = window.resetUI;
    if (origReset && !window._civitaiPromptsResetHooked) {
        window.resetUI = function() {
            origReset();
            const mod = wrapper.closest('.tool-module');
            if (mod) mod.style.display = 'none';
        };
        window._civitaiPromptsResetHooked = true;
    }

    window.renderOnlinePrompts = async function(ver, loadId) {
        if (window.isStaleLoadLocal && window.isStaleLoadLocal(loadId)) return;
        const cnt = document.getElementById('onlinePromptsContent');
        if(!cnt) return;
        
        const mod = wrapper.closest('.tool-module');
        
        cnt.innerHTML = '<span style="color:#555; font-size: 12px;">Loading trigger words…</span>';
        const trainedWords = [...new Set(await window.collectAllTrainedWordsLocal(ver))];
        if (window.isStaleLoadLocal && window.isStaleLoadLocal(loadId)) return;

        let html = '';
        if (trainedWords.length > 0) {
            trainedWords.forEach((prompt, i) => {
                const areaId = 'onlineTrainedWords_' + i, wrapId = 'onlineWrap_' + i, btnId = 'onlineBtn_' + i;
                html += '<div class="online-prompt-block">' +
                    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
                    '<span class="online-prompt-label">Prompt ' + (i + 1) + '</span>' +
                    '<button class="copy-btn" onclick="window.copyFromArea(\'' + areaId + '\',this)" title="Copy" style="background:none;border:none;cursor:pointer;padding:2px 6px;border-radius:4px;color:#555;font-size:15px;line-height:1;transition:color .15s;">⧉</button>' +
                    '</div>' +
                    '<div class="prompt-ta-wrap" id="' + wrapId + '" data-state="full" style="overflow:hidden; transition:max-height 0.3s ease;">' +
                    '<textarea class="online-prompt-area promptArea" id="' + areaId + '" readonly>' + window.escHtml(prompt.trim()) + '</textarea></div>' +
                    '<button class="prompt-block-toggle" id="' + btnId + '" onclick="window.cycleBlockState(document.getElementById(\'' + wrapId + '\'),this)" style="display:none;margin-top:4px;width:100%;background:none;border:1px solid #1e2a22;border-radius:5px;color:#3a7a5a;font-size:13px;padding:2px 0;cursor:pointer;">▼</button>' +
                    '</div>';
            });
        }

        if (!html) {
            // SE NÃO TIVER NADA: Oculta o módulo inteiro
            if (mod) mod.style.display = 'none';
            return;
        }

        // SE TIVER CONTEÚDO: Garante que o módulo está visível
        if (mod) mod.style.display = 'block';
        cnt.innerHTML = html;

        // Auto-abre a aba porque achou conteúdo
        if (mod && !mod.classList.contains('open')) mod.classList.add('open');

        requestAnimationFrame(() => {
            if (window.isStaleLoadLocal && window.isStaleLoadLocal(loadId)) return;
            requestAnimationFrame(() => {
                if (window.isStaleLoadLocal && window.isStaleLoadLocal(loadId)) return;
                trainedWords.forEach((_, i) => {
                    const ta = document.getElementById('onlineTrainedWords_' + i), wrap = document.getElementById('onlineWrap_' + i), btn = document.getElementById('onlineBtn_' + i);
                    if (ta && wrap && btn && window.autoResizeTextarea && window.initBlockCollapse) {
                        window.autoResizeTextarea(ta);
                        window.initBlockCollapse(wrap, btn, ta.scrollHeight + 18);
                    }
                });
            });
        });
    };
})();