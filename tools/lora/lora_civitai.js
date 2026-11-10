/* ===== merged from lora_civitai.js ===== */
/**
 * tools/lora/lora_civitai.js
 */
(function() {
    const style = document.createElement('style');
    style.innerHTML = `
        .olc-box { padding: 0; }
        .olc-box h3 { font-size: 13px; font-weight: 600; margin: 0 0 10px; color: #e0e0e0; padding-bottom: 8px; border-bottom: 1px solid #1e3d28; }
        .olc-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-bottom: 1px solid #222; width: 100%; box-sizing: border-box; }
        .olc-row:last-child { border-bottom: none; }
        .olc-label { color: #aaa; flex-shrink: 0; margin-right: 8px; }
        .olc-value { color: #e0e0e0; text-align: right; word-break: break-word; min-width: 0; }
        .olc-value a { color: #00ff99; text-decoration: none; }
        .olc-value a:hover { color: #fff; text-decoration: underline; }
    `;
    document.head.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.id = 'civitai-result-wrapper';
    wrapper.style.cssText = "width:100%; box-sizing:border-box;";
    wrapper.innerHTML = `<div class="olc-box" id="onlineLookupCard" style="padding: 0;"></div>`;
    
    window.registerToolModule('🔍 Civitai Result', '#00cc88', wrapper);

    // 1. Inicia o módulo TOTALMENTE oculto (esconde a barra mãe inteira)
    setTimeout(() => {
        const mod = wrapper.closest('.tool-module');
        if (mod) mod.style.display = 'none';
    }, 0);

    // 2. Cria um gatilho para esconder o módulo caso carregue um novo arquivo
    const origReset = window.resetUI;
    if (origReset && !window._civitaiResultResetHooked) {
        window.resetUI = function() {
            origReset();
            const mod = wrapper.closest('.tool-module');
            if (mod) mod.style.display = 'none';
        };
        window._civitaiResultResetHooked = true;
    }

    window.populateOnline = function(ver, civUrl, modelName, creatorName, creatorUrl, matchedHash = null) {
        const card = document.getElementById('onlineLookupCard');
        if (!card) return;
        const mod = wrapper.closest('.tool-module');

        if (!ver) {
            if (mod) mod.style.display = 'none'; // Continua oculto se não achar nada
            return;
        }

        // URLs vindas da API entram no href escapadas e só se forem http(s).
        const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? window.escHtml(u) : '#');
        const creatorRow = creatorName ? [['Creator', '<a href="' + safeUrl(creatorUrl) + '" target="_blank" rel="noopener noreferrer">' + window.escHtml(creatorName) + '</a>']] : [];
        const hashRow = matchedHash ? [['Matched Hash', '<span style="font-family:monospace;color:#00ff99;">' + window.escHtml(matchedHash) + '</span>']] : [];

        const rows = [...creatorRow,
            ['Model',      '<a href="' + safeUrl(civUrl) + '" target="_blank" rel="noopener noreferrer">' + window.escHtml(modelName) + '</a>'],
            ['Version',    window.escHtml(ver.name || '—')],
            ...hashRow,
            ['Base Model', window.escHtml(ver.baseModel || '—')],
            ['Type',       window.escHtml(ver.model?.type || '—')],
            ['Downloads',  (ver.stats?.downloadCount ?? 0).toLocaleString()],
            ['Rating',     ver.stats?.rating ? Number(ver.stats.rating).toFixed(1) + ' ⭐ (' + (Number(ver.stats.ratingCount) || 0) + ')' : '—'],
            ['Published',  ver.publishedAt ? new Date(ver.publishedAt).toLocaleDateString() : '—'],
        ].map(([l,v]) => '<div class="olc-row"><span class="olc-label">' + l + '</span><span class="olc-value">' + v + '</span></div>').join('');
        
        let verNoteHtml = ''; const rawVerNote = ver.description || '';
        if (rawVerNote && rawVerNote.trim() && window.sanitizeCivitaiDescLocal) {
            verNoteHtml = '<div style="margin-top:10px;"><div style="color:#aaa;font-size:11px;margin-bottom:4px;">Version Note</div><div class="civitai-model-desc" id="civitaiVersionNote">' + window.sanitizeCivitaiDescLocal(rawVerNote) + '</div></div>';
        }
        let modelDescHtml = ''; const rawModelDesc = ver._modelDescription || '';
        if (rawModelDesc && rawModelDesc.trim() && window.sanitizeCivitaiDescLocal) {
            modelDescHtml = '<div style="margin-top:10px;"><div style="color:#aaa;font-size:11px;margin-bottom:4px;">Model Description</div><div class="civitai-model-desc" id="civitaiModelDesc">' + window.sanitizeCivitaiDescLocal(rawModelDesc) + '</div></div>';
        }
        
        card.innerHTML = rows + verNoteHtml + modelDescHtml;
        
        requestAnimationFrame(() => {
            ['civitaiVersionNote', 'civitaiModelDesc'].forEach(id => {
                const el = document.getElementById(id);
                if (el && el.scrollHeight > 180) { el.style.maxHeight = '180px'; el.style.overflowY = 'auto'; }
            });
        });

        // 3. SE ACHOU ALGO: Torna a barra do módulo visível
        if (mod) mod.style.display = 'block';

        // Auto-abre o Tools-Bar e o módulo se bater o resultado
        const toolsBar = document.getElementById('tools-bar');
        if (toolsBar && !toolsBar.classList.contains('open')) toolsBar.classList.add('open');
        if (mod && !mod.classList.contains('open')) mod.classList.add('open');
    };
})();

/* ===== merged from lora_civitai.js ===== */
/**
 * tools/lora/lora_civitai.js
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
