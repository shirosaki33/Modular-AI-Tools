/**
 * tools/civitai_lora.js
 * Handles all Civitai links for: LoRAs, Checkpoint, VAE, Text Encoders.
 * Runs after applyMetadataToUI() via window.onMetadataLoaded hook.
 */

(function () {
    'use strict';

    const CIVITAI_API  = 'https://civitai.com/api/v1/';
    const CIVITAI_SITE = 'https://civitai.red/models';
    const LINK_TEXT    = '↗';

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function cleanModelName(v) {
        return String(v || '')
            .replace(/\\/g, '/')
            .split('/').pop()
            .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, '')
            .replace(/_/g, ' ')
            .trim();
    }

    function buildSearchUrl(name, type) {
        const q = cleanModelName(name);
        let url = CIVITAI_SITE + '?query=' + encodeURIComponent(q);
        if (type) url += '&types=' + encodeURIComponent(type);
        return url;
    }

    function buildLoraSearchUrl(query, checkpointContext) {
        let q = String(query || '').replace(/[_-]/g, ' ').replace(/[^a-zA-Z0-9 ]/g, '').trim();
        if (checkpointContext && !/unknown/i.test(checkpointContext)) {
            const ctx = checkpointContext.replace(/\.(safetensors|ckpt)$/i, '').split(/[\\/]/).pop().replace(/[_-]/g, ' ');
            if (/z image|zimage/i.test(ctx))        q += ' zimage';
            else if (/pony/i.test(ctx))              q += ' pony';
            else if (/illustrious|ilxl/i.test(ctx)) q += ' illustrious';
            else if (/flux/i.test(ctx))              q += ' flux';
        }
        return CIVITAI_SITE + '?types=LORA&query=' + encodeURIComponent(q.trim());
    }

    function makeSearchLink(url, title) {
        const a = document.createElement('a');
        a.href        = url;
        a.target      = '_blank';
        a.rel         = 'noopener noreferrer';
        a.textContent = LINK_TEXT;
        a.title       = title || 'Search on Civitai';
        
        a.style.cssText = [
            'margin-left: 8px',
            'color: #ffb24d',
            'background: rgba(255, 178, 77, 0.1)',
            'border: 1px solid rgba(255, 178, 77, 0.4)',
            'border-radius: 4px',
            'padding: 1px 6px',
            'font-size: 13px',
            'font-weight: bold',
            'text-decoration: none',
            'cursor: pointer',
            'display: inline-flex',
            'align-items: center',
            'justify-content: center',
            'transition: all 0.2s ease',
            'flex-shrink: 0'
        ].join(';');
        
        a.onmouseover = () => { a.style.background = '#2a1600'; a.style.borderColor = '#ffb24d'; };
        a.onmouseout  = () => { a.style.background = 'rgba(255, 178, 77, 0.1)'; a.style.borderColor = 'rgba(255, 178, 77, 0.4)'; };
        return a;
    }

    function makeExactLink(url, label, weightStr) {
        const wrap = document.createElement('span');
        wrap.style.display = 'inline-flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '6px';

        const a = document.createElement('a');
        a.href        = url;
        a.target      = '_blank';
        a.rel         = 'noopener noreferrer';
        a.textContent = label;
        a.style.color          = '#4db8ff';
        a.style.textDecoration = 'none';
        a.onmouseover = () => { a.style.textDecoration = 'underline'; };
        a.onmouseout  = () => { a.style.textDecoration = 'none'; };
        
        wrap.appendChild(a);
        if (weightStr) {
            const w = document.createElement('span');
            w.textContent = weightStr;
            wrap.appendChild(w);
        }
        return wrap;
    }

    async function fetchByHash(hash) {
        try {
            const r = await fetch(
                CIVITAI_API + 'model-versions/by-hash/' + encodeURIComponent(hash),
                { signal: AbortSignal.timeout(10000) }
            );
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            return null;
        }
    }

    // ------------------------------------------------------------------
    // Fix Visual Layouts (Equal Sizes)
    // ------------------------------------------------------------------
    function fixContainerLayouts() {
        const loraList = document.getElementById('loraList');
        if (loraList) {
            loraList.style.display = 'grid';
            loraList.style.gridTemplateColumns = 'repeat(auto-fill, minmax(260px, 1fr))';
            loraList.style.gap = '10px';
            loraList.style.alignItems = 'stretch'; 
            
            const items = loraList.querySelectorAll('.lora-item');
            items.forEach(item => {
                item.style.height = '100%'; 
                item.style.boxSizing = 'border-box';
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.justifyContent = 'space-between';
                
                const textSpan = item.querySelector('span');
                if (textSpan) {
                    textSpan.style.display = 'inline-flex';
                    textSpan.style.alignItems = 'center';
                    textSpan.style.flexWrap = 'wrap';
                    textSpan.style.width = '100%';
                }
            });
        }
    }

    // ------------------------------------------------------------------
    // Dynamic Alert Box
    // ------------------------------------------------------------------

    function showLocalNameAlert() {
        let alertBox = document.getElementById('civitai-dynamic-alert');
        if (!alertBox) {
            alertBox = document.createElement('div');
            alertBox.id = 'civitai-dynamic-alert';
            // Ajustado margin para 0 para aproveitar o gap natural da coluna principal
            alertBox.style.cssText = 'margin: 0; padding: 10px 14px; border-left: 3px solid #ffd040; border-right: 3px solid #ffd040; background: #101723; color: #f5f5f5; border-radius: 7px; font-size: 13.5px; line-height: 1.45; text-align: center; display: block; width: 100%; box-sizing: border-box; clear: both;';
            
            const panelLeft = document.querySelector('.panel-left');
            const loraList = document.getElementById('loraList');
            
            if (panelLeft) {
                // Insere logo APÓS a caixa preta toda (.panel-left), fora do seu fundo
                panelLeft.parentNode.insertBefore(alertBox, panelLeft.nextSibling);
            } else if (loraList) {
                loraList.parentNode.insertBefore(alertBox, loraList.nextSibling);
            }
        }
        alertBox.style.display = 'block';
        alertBox.innerHTML = '<span style="color:#ffd040;margin:0 6px;font-size:14px;line-height:1;">⚠️</span> Model names in white are local filenames from the metadata and may not match official titles. Click the ↗ icon to search on Civitai <span style="color:#ffd040;margin:0 6px;font-size:14px;line-height:1;">⚠️</span>';
    }

    function hideLocalNameAlert() {
        const alertBox = document.getElementById('civitai-dynamic-alert');
        if (alertBox) alertBox.style.display = 'none';
    }

    // ------------------------------------------------------------------
    // Hash extraction from raw text
    // ------------------------------------------------------------------

    function extractCheckpointHash(raw) {
        const t = String(raw || '');
        let m = t.match(/\b(?:Model hash|Checkpoint hash)\s*:\s*([a-f0-9]{8,64})\b/i);
        if (m) return m[1].toLowerCase();
        m = t.match(/"(?:model_hash|checkpoint_hash|modelHash)"\s*:\s*"([a-f0-9]{8,64})"/i);
        if (m) return m[1].toLowerCase();
        return '';
    }

    function extractVaeHash(raw) {
        const t = String(raw || '');
        let m = t.match(/\bVAE hash\s*:\s*([a-f0-9]{8,64})\b/i);
        if (m) return m[1].toLowerCase();
        m = t.match(/"vae_hash"\s*:\s*"([a-f0-9]{8,64})"/i);
        if (m) return m[1].toLowerCase();
        return '';
    }

    // ------------------------------------------------------------------
    // LoRA enrichment
    // ------------------------------------------------------------------

    async function enrichLoras() {
        const items = document.querySelectorAll('#loraList .lora-item');
        if (!items.length) return;

        for (const div of items) {
            const hash       = div.dataset.loraHash   || '';
            const baseName   = div.dataset.loraName   || '';
            const weightStr  = div.dataset.loraWeight || '';
            const query      = div.dataset.loraQuery  || baseName;
            const ckptCtx    = div.dataset.loraCkptCtx || '';
            const fullStr    = div.dataset.loraFull   || baseName + weightStr;
            const textSpan   = div.querySelector('span');

            if (!textSpan) continue;

            if (hash) {
                textSpan.style.color = '#888';
                textSpan.textContent = baseName + ' (looking up…)' + weightStr;

                const data = await fetchByHash(hash);

                if (data && data.modelId) {
                    const realName = (data.model && data.model.name) || data.name || baseName;
                    const url = 'https://civitai.com/models/' + data.modelId +
                                (data.id ? '?modelVersionId=' + data.id : '');
                    textSpan.textContent = '';
                    textSpan.appendChild(makeExactLink(url, realName, weightStr));
                } else {
                    textSpan.style.color = '#eee';
                    textSpan.textContent = fullStr;
                    textSpan.appendChild(makeSearchLink(
                        buildLoraSearchUrl(query, ckptCtx),
                        'Hash not found on Civitai — search by name'
                    ));
                    showLocalNameAlert();
                }
            } else {
                textSpan.style.color = '#eee';
                textSpan.textContent = fullStr;
                textSpan.appendChild(makeSearchLink(
                    buildLoraSearchUrl(query, ckptCtx),
                    'No hash available — search by name on Civitai'
                ));
                showLocalNameAlert();
            }
        }
    }

    // ------------------------------------------------------------------
    // Checkpoint & Extras enrichment
    // ------------------------------------------------------------------

    async function enrichCheckpoint(meta, raw) {
        const el = document.getElementById('val-ckpt');
        if (!el || el.querySelector('a')) return;

        el.style.display = 'inline-flex';
        el.style.alignItems = 'center';

        const name = String(meta.ckpt || '').trim();
        if (!name || name === '—') return;

        const hash = extractCheckpointHash(raw);

        if (hash) {
            el.style.color = '#888';
            el.textContent = name + ' (looking up…)';

            const data = await fetchByHash(hash);

            if (data && data.modelId) {
                const realName = (data.model && data.model.name) || data.name || name;
                const url = 'https://civitai.com/models/' + data.modelId +
                            (data.id ? '?modelVersionId=' + data.id : '');
                el.textContent = '';
                const a = document.createElement('a');
                a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
                a.textContent = realName;
                a.style.color = '#4db8ff'; a.style.textDecoration = 'none';
                a.onmouseover = () => { a.style.textDecoration = 'underline'; };
                a.onmouseout  = () => { a.style.textDecoration = 'none'; };
                el.appendChild(a);
            } else {
                el.style.color = '#eee';
                el.textContent = name;
                el.appendChild(makeSearchLink(
                    buildSearchUrl(name, 'Checkpoint'),
                    'Hash not found on Civitai — search by name'
                ));
                showLocalNameAlert();
            }
        } else {
            el.style.color = '#eee';
            el.textContent = name;
            el.appendChild(makeSearchLink(
                buildSearchUrl(name, 'Checkpoint'),
                'No hash available — search by name on Civitai'
            ));
            showLocalNameAlert();
        }
    }

    function findExtraRow(labelText) {
        const info = document.getElementById('topbarInfo');
        if (!info) return null;
        for (const row of info.querySelectorAll('.extra-topbar-row')) {
            const lbl = row.querySelector('.topbar-label');
            if (lbl && lbl.textContent.replace(':', '').trim().toLowerCase() === labelText.toLowerCase()) {
                return row;
            }
        }
        return null;
    }

    function getValueSpan(row) {
        if (!row) return null;
        const spans = row.querySelectorAll('span');
        for (const s of spans) {
            if (!s.classList.contains('topbar-label')) return s;
        }
        return null;
    }

    async function enrichExtraRow(labelText, modelName, hash, civitaiType) {
        const row = findExtraRow(labelText);
        if (!row || row.querySelector('a')) return;
        const span = getValueSpan(row);
        if (!span) return;

        span.style.display = 'inline-flex';
        span.style.alignItems = 'center';
        span.style.flexWrap = 'wrap';
        span.style.gap = '4px';

        if (hash) {
            span.style.color = '#888';
            span.textContent = modelName + ' (looking up…)';

            const data = await fetchByHash(hash);

            if (data && data.modelId) {
                const realName = (data.model && data.model.name) || data.name || modelName;
                const url = 'https://civitai.com/models/' + data.modelId +
                            (data.id ? '?modelVersionId=' + data.id : '');
                span.textContent = '';
                const a = document.createElement('a');
                a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
                a.textContent = realName;
                a.style.color = '#4db8ff'; a.style.textDecoration = 'none';
                a.onmouseover = () => { a.style.textDecoration = 'underline'; };
                a.onmouseout  = () => { a.style.textDecoration = 'none'; };
                span.appendChild(a);
            } else {
                span.style.color = '#eee';
                span.textContent = modelName;
                span.appendChild(makeSearchLink(
                    buildSearchUrl(modelName, civitaiType),
                    'Hash not found on Civitai — search by name'
                ));
                showLocalNameAlert();
            }
        } else {
            span.appendChild(makeSearchLink(
                buildSearchUrl(modelName, civitaiType),
                'No hash available — search by name on Civitai'
            ));
            showLocalNameAlert();
        }
    }

    async function enrichVae(meta, raw) {
        const vae = meta._extras && meta._extras.vae;
        if (!vae) return;
        await enrichExtraRow('VAE', vae, extractVaeHash(raw), 'VAE');
    }

    function enrichTextEncoders(meta) {
        const te = meta._extras && meta._extras.clipText;
        if (!te) return;
        const row = findExtraRow('Text Encoders');
        if (!row || row.querySelector('a')) return;
        const span = getValueSpan(row);
        if (!span) return;

        span.style.display = 'inline-flex';
        span.style.alignItems = 'center';
        span.style.flexWrap = 'wrap';

        const names = String(te).split(' | ');
        span.textContent = '';
        names.forEach((n, i) => {
            if (i > 0) span.appendChild(document.createTextNode(' | '));
            const nameSpan = document.createElement('span');
            nameSpan.style.color = '#eee';
            nameSpan.style.display = 'inline-flex';
            nameSpan.style.alignItems = 'center';
            nameSpan.textContent = n.trim();
            nameSpan.appendChild(makeSearchLink(
                buildSearchUrl(n.trim(), ''),
                'Search text encoder on Civitai'
            ));
            span.appendChild(nameSpan);
        });
        showLocalNameAlert();
    }

    // ------------------------------------------------------------------
    // Entry point
    // ------------------------------------------------------------------

    function runEnrichment() {
        const meta = window.currentMeta;
        const raw  = window.currentRawText || '';
        
        hideLocalNameAlert(); // Reseta aviso anterior
        
        if (!meta) return;

        fixContainerLayouts();

        setTimeout(async () => {
            await enrichLoras();
            await enrichCheckpoint(meta, raw);
            await enrichVae(meta, raw);
            enrichTextEncoders(meta);
        }, 60);
    }

    function install() {
        const prev = window.onMetadataLoaded;
        window.onMetadataLoaded = function () {
            if (typeof prev === 'function') prev();
            runEnrichment();
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
    } else {
        install();
    }

})();