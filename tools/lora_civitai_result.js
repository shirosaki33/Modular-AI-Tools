/**
 * tools/lora_civitai_result.js
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

        const creatorRow = creatorName ? [['Creator', '<a href="' + (creatorUrl||'#') + '" target="_blank">' + window.escHtml(creatorName) + '</a>']] : [];
        const hashRow = matchedHash ? [['Matched Hash', '<span style="font-family:monospace;color:#00ff99;">' + window.escHtml(matchedHash) + '</span>']] : [];

        const rows = [...creatorRow,
            ['Model',      '<a href="' + civUrl + '" target="_blank">' + window.escHtml(modelName) + '</a>'],
            ['Version',    window.escHtml(ver.name || '—')],
            ...hashRow,
            ['Base Model', window.escHtml(ver.baseModel || '—')],
            ['Type',       window.escHtml(ver.model?.type || '—')],
            ['Downloads',  (ver.stats?.downloadCount ?? 0).toLocaleString()],
            ['Rating',     ver.stats?.rating ? ver.stats.rating.toFixed(1) + ' ⭐ (' + ver.stats.ratingCount + ')' : '—'],
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