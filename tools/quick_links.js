/**
 * tools/quick_links.js
 * Botão "+" no topbar com balão de atalhos para os apps do ecossistema.
 * Detecta a página atual com base no título da UI e arquivo.
 *
 * Versão LOCAL: se o .html de outro app não estiver instalado, mostra
 * "not installed" no lugar do botão Local (o link Online continua).
 * Detecção: 1) tools/installed_tools.js (gerado pelos .bat de instalação)
 *           2) em http(s)/localhost, teste HEAD em cada arquivo
 *           3) em file:// sem manifesto, assume que existe (comportamento antigo)
 * Se estiver na versão Online (GitHub Pages), o botão Local fica desabilitado.
 */
(function() {
    const style = document.createElement('style');
    style.innerHTML = `
        #ql-btn {
            background: none; font-size: 18px; padding: 5px 11px; color: #888;
            border: 1px solid #333; border-radius: 6px; cursor: pointer; transition: 0.15s;
            line-height: 1; font-weight: bold;
        }
        #ql-btn:hover { color: #00ff99; border-color: #00ff99; }

        #ql-balloon {
            display: none; position: absolute; top: 52px; right: 0;
            background: #111827; border: 1px solid #263b5a; border-radius: 10px;
            padding: 14px; z-index: 1100; box-shadow: 0 8px 24px rgba(0,0,0,0.85);
            width: 380px; max-width: 92vw; text-align: left;
        }
        #ql-balloon.open { display: block; }
        #ql-balloon::before {
            content: ''; position: absolute; top: -7px; right: 14px;
            width: 12px; height: 12px; background: #111827;
            border-left: 1px solid #263b5a; border-top: 1px solid #263b5a;
            transform: rotate(45deg);
        }
        .ql-title {
            color: #9ecfff; font-size: 11px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.6px; border-bottom: 1px solid #1e2d40;
            padding-bottom: 8px; margin-bottom: 10px;
        }
        .ql-row {
            display: flex; align-items: center; gap: 6px;
            padding: 5px 0; border-bottom: 1px solid #141c2a;
        }
        .ql-row:last-of-type { border-bottom: none; }
        .ql-icon { font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }
        .ql-label { font-size: 12px; color: #ccc; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ql-link {
            display: inline-block; padding: 3px 8px; border-radius: 4px;
            font-size: 11px; font-weight: bold; text-decoration: none;
            cursor: pointer; transition: 0.15s; white-space: nowrap; flex-shrink: 0;
        }
        .ql-link-local  { background: #0f2a1a; color: #00cc88; border: 1px solid #1a4a2a; }
        .ql-link-local:hover  { background: #143520; color: #00ff99; border-color: #00aa66; }
        .ql-link-online { background: #0f1e3a; color: #4db8ff; border: 1px solid #1e3a6a; }
        .ql-link-online:hover { background: #142a55; color: #9ecfff; border-color: #4db8ff; }

        /* Versão Web: Local indisponível */
        .ql-link-disabled { background: #111; color: #555; border: 1px solid #222; cursor: not-allowed; text-decoration: line-through; }

        /* Versão local: HTML não encontrado */
        .ql-link-missing { background: #241a08; color: #e8c22e; border: 1px solid #5a4510; cursor: help; }

        .ql-no-url { font-size: 10px; color: #333; padding: 3px 6px; }
        .ql-current-badge {
            font-size: 10px; color: #556; padding: 3px 6px;
            border: 1px solid #222; border-radius: 4px; flex-shrink: 0;
        }
    `;
    document.head.appendChild(style);

    const APPS = [
        { key: 'hub',              icon: '🧰',  label: 'Modular AI Tools (Hub)', localFile: 'index.html',                 onlineUrl: 'https://shirosaki33.github.io/Modular-AI-Tools/' },
        { key: 'png_reader',       icon: '🕵️', label: 'PNG Metadata Reader',    localFile: 'png metadata reader.html',   onlineUrl: 'https://shirosaki33.github.io/Modular-AI-Tools/png%20metadata%20reader.html' },
        { key: 'lora_reader',      icon: '📋',  label: 'LoRA Metadata Reader',   localFile: 'Lora Metadata Reader.html',  onlineUrl: 'https://shirosaki33.github.io/Modular-AI-Tools/Lora%20Metadata%20Reader.html' },
        { key: 'gallery',          icon: '🖼️', label: 'Gallery Holder',         localFile: 'gallery holder.html',        onlineUrl: 'https://shirosaki33.github.io/Modular-AI-Tools/gallery%20holder.html' },
        { key: 'tag_manager',      icon: '🏷️', label: 'Tag Manager',            localFile: 'tag manager.html',           onlineUrl: 'https://shirosaki33.github.io/Modular-AI-Tools/tag%20manager.html' },        
        { key: 'lora_calc',        icon: '🧮',  label: 'LoRA Calculator',        localFile: 'lora calculator.html',       onlineUrl: 'https://shirosaki33.github.io/Modular-AI-Tools/lora%20calculator.html' },
        { key: 'lora_evaluate',    icon: '📚',  label: 'Lora Evaluate',          localFile: 'Lora Evaluate.html',         onlineUrl: 'https://shirosaki33.github.io/Modular-AI-Tools/Lora%20Evaluate.html' },
        { key: 'prompt_helper',    icon: '✨',  label: 'Prompt Helper',          localFile: 'prompt helper.html',         onlineUrl: 'https://shirosaki33.github.io/Modular-AI-Tools/prompt%20helper.html' }
    ];

    // Verifica se não é ambiente local (file://) nem um servidor de desenvolvimento (localhost)
    const isRunningOnline = window.location.protocol !== 'file:' && !['localhost', '127.0.0.1'].includes(window.location.hostname);

    // Pasta onde este script vive (tools/) — de onde sai o installed_tools.js
    const BASE = (function() {
        try {
            return document.currentScript.src.replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
        } catch (e) { return 'tools/'; }
    })();

    // null = desconhecido (não bloqueia o botão Local) | array de nomes em minúsculas
    let installedList = null;

    function isInstalled(app) {
        if (installedList === null) return true;
        return installedList.includes(app.localFile.toLowerCase());
    }

    async function detectInstalled() {
        if (isRunningOnline) return;

        // 1) manifesto gerado pelos .bat
        const gotManifest = await new Promise(res => {
            const s = document.createElement('script');
            s.src = BASE + 'installed_tools.js?t=' + Date.now();
            s.onload = () => { s.remove(); res(true); };
            s.onerror = () => { s.remove(); res(false); };
            document.head.appendChild(s);
        });
        if (gotManifest && Array.isArray(window.MAT_INSTALLED)) {
            installedList = window.MAT_INSTALLED.map(n => String(n).toLowerCase());
            return;
        }

        // 2) localhost: pergunta ao servidor se cada arquivo existe
        if (/^https?:$/.test(window.location.protocol)) {
            const found = [];
            await Promise.all(APPS.map(async app => {
                try {
                    const r = await fetch(encodeURI(app.localFile), { method: 'HEAD', cache: 'no-store' });
                    if (r.ok) found.push(app.localFile.toLowerCase());
                } catch (e) { /* ignora */ }
            }));
            installedList = found;
        }
        // 3) file:// sem manifesto: mantém null (assume instalado)
    }

    // Sistema de detecção de app robusto
    function detectCurrentApp() {
        const title = document.title || '';
        const uiTitle = document.getElementById('app-title') ? document.getElementById('app-title').textContent : '';
        const filename = decodeURIComponent(window.location.pathname.split('/').pop() || '');

        // Verificações Específicas primeiro para evitar conflitos
        if (/^index\.html$/i.test(filename) || /modular ai tools/i.test(title)) return 'hub';
        if (/lora[ _-]?gallery/i.test(filename) || /lora gallery/i.test(title) || /lora gallery/i.test(uiTitle)) return 'lora_gallery';
        if (/interrogator/i.test(filename) || /interrogator/i.test(title) || /interrogator/i.test(uiTitle)) return 'tag_interrogator';
        if (/evaluate/i.test(uiTitle) || /evaluate/i.test(title) || /evaluate/i.test(filename)) return 'lora_evaluate';
        if (/calculator/i.test(uiTitle) || /calculator/i.test(title) || /calculator/i.test(filename)) return 'lora_calc';

        // Busca específica por 'lora' e 'png', sem a palavra genérica 'reader'
        if (/lora/i.test(uiTitle) || /lora/i.test(title)) return 'lora_reader';
        if (/png/i.test(uiTitle) || /png/i.test(title)) return 'png_reader';

        // Verificações Padrão
        if (/gallery/i.test(uiTitle) || /gallery/i.test(title)) return 'gallery';
        if (/prompt helper/i.test(uiTitle) || /prompt helper/i.test(title) || /prompt.?helper/i.test(filename)) return 'prompt_helper';
        if (/tag/i.test(uiTitle) || /tag/i.test(title)) return 'tag_manager';

        // Fallbacks pelo nome do arquivo
        if (/evaluate/i.test(filename)) return 'lora_evaluate';
        if (/calculator/i.test(filename)) return 'lora_calc';
        if (/lora/i.test(filename) && !/calculator|evaluate|gallery/i.test(filename)) return 'lora_reader';
        if (/gallery|interface/i.test(filename)) return 'gallery';
        if (/png/i.test(filename)) return 'png_reader';
        if (/prompt.?helper/i.test(filename)) return 'prompt_helper';
        if (/tag/i.test(filename)) return 'tag_manager';

        return null;
    }

    function initQuickLinks() {
        const topbarRight = document.querySelector('.topbar-section.right, #topbar-right');
        if (!topbarRight) return;

        // Evita duplicar se o script rodar duas vezes
        if (document.getElementById('ql-btn')) return;

        const currentAppKey = detectCurrentApp();

        const qlWrapper = document.createElement('div');
        qlWrapper.style.cssText = 'position: relative; display: inline-block;';

        const btn = document.createElement('button');
        btn.id = 'ql-btn';
        btn.title = 'Quick Links';
        btn.textContent = '➕';

        const balloon = document.createElement('div');
        balloon.id = 'ql-balloon';
        qlWrapper.appendChild(btn);
        qlWrapper.appendChild(balloon);
        topbarRight.appendChild(qlWrapper);

        btn.onclick = (e) => {
            e.stopPropagation();
            const isOpen = balloon.classList.toggle('open');
            if (isOpen) {
                renderBalloon();
                // Reconfere o que está instalado (pega instalações feitas com a página aberta)
                detectInstalled().then(() => { if (balloon.classList.contains('open')) renderBalloon(); });
            }
        };

        document.addEventListener('click', (e) => {
            if (balloon.classList.contains('open') && !balloon.contains(e.target) && e.target !== btn) {
                balloon.classList.remove('open');
            }
        });

        function renderBalloon() {
            balloon.innerHTML = `<div class="ql-title">🔗 Quick Links</div>`;

            APPS.forEach(app => {
                const isCurrent = app.key === currentAppKey;

                const row = document.createElement('div');
                row.className = 'ql-row';

                if (isCurrent) {
                    row.innerHTML = `
                        <span class="ql-icon">${app.icon}</span>
                        <span class="ql-label" style="color:#556;">${app.label}</span>
                        <span class="ql-current-badge">current</span>
                    `;
                    balloon.appendChild(row);
                    return;
                }

                let localBtnHtml;
                if (isRunningOnline) {
                    localBtnHtml = `<span class="ql-link ql-link-disabled" title="Indisponível na versão Web">Local ↗</span>`;
                } else if (!isInstalled(app)) {
                    localBtnHtml = `<span class="ql-link ql-link-missing" title="${app.localFile} não encontrado — rode install_tools.bat para instalar">not installed</span>`;
                } else {
                    localBtnHtml = `<a class="ql-link ql-link-local" href="${encodeURI(app.localFile)}" target="_blank" rel="noopener">Local ↗</a>`;
                }

                row.innerHTML = `
                    <span class="ql-icon">${app.icon}</span>
                    <span class="ql-label">${app.label}</span>
                    ${localBtnHtml}
                    ${app.onlineUrl
                        ? `<a class="ql-link ql-link-online" href="${app.onlineUrl}" target="_blank">Online ↗</a>`
                        : `<span class="ql-no-url">—</span>`
                    }
                `;
                balloon.appendChild(row);
            });
        }

        // Já deixa a detecção pronta antes do primeiro clique
        detectInstalled();
    }

    // Execução à prova de falhas
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initQuickLinks);
    } else {
        initQuickLinks();
    }
})();