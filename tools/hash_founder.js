/**
 * tools/hash_founder.js
 * Módulo independente para o CivitAI Hash Founder
 */
(function() {
    const style = document.createElement('style');
    style.innerHTML = `
        .hf-body { 
            padding: 12px; 
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
            overflow: hidden;
        }
        .hf-row { display: flex; gap: 8px; margin-bottom: 8px; min-width: 0; }
        .hf-input { 
            flex: 1; min-width: 0; background: #0d0d0d; border: 1px solid #2a3a2e; border-radius: 6px; color: #eee; padding: 8px 12px; font-size: 13px; outline: none; 
            box-sizing: border-box;
        }
        .hf-input:focus { border-color: #00aa66; }
        .hf-btn { background: #00aa66; color: #000; border: none; border-radius: 6px; padding: 8px 12px; font-weight: bold; cursor: pointer; font-size: 13px; white-space: nowrap; }
        .hf-btn:hover { background: #00cc88; }
        .hf-btn-detect { background: #1a3a5c; color: #4db8ff; border: 1px solid #2a5a8c; border-radius: 6px; padding: 8px 12px; font-weight: bold; cursor: pointer; font-size: 13px; white-space: nowrap; }
        
        .hf-list { 
            background: #0d0d0d; border: 1px solid #1e3d28; border-radius: 6px; max-height: 220px; overflow-y: auto; margin-top: 8px; 
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
        }
        .hf-item { 
            padding: 10px; border-bottom: 1px solid #1e2a20; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: 0.1s; 
            box-sizing: border-box; min-width: 0;
        }
        .hf-item:hover { background: #1a2a1e; }
        .hf-item:last-child { border-bottom: none; }
        .hf-hash { color: #eee; font-family: monospace; font-size: 12px; word-break: break-all; }
        .hf-status { font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 4px; white-space: nowrap; margin-left: 8px; flex-shrink: 0; }
        .hf-pending { background: #2a2000; color: #ffd040; }
        .hf-found { background: #1a3a5c; color: #4db8ff; }
        .hf-notfound { background: #4a1118; color: #ffb6c0; }
    `;
    document.head.appendChild(style);

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    window.addEventListener('DOMContentLoaded', () => {
        if (typeof window.registerToolModule !== 'function') return;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div style="font-size:12px;color:#888;padding:0 12px 10px;">Not every hex string is a CivitAI model hash. Detection extracts all 8–64 character hex sequences.</div>
            <div class="hf-body">
                <div class="hf-row">
                    <input type="text" id="hfInput" class="hf-input" placeholder="Paste hash or click a detected one...">
                    <button class="hf-btn" id="hfSearchBtn">Search</button>
                    <button class="hf-btn-detect" id="hfDetectBtn">Detect</button>
                </div>
                <div class="hf-list" id="hfList">
                    <div style="padding:14px;text-align:center;color:#555;font-size:13px;">No hashes detected yet. Load an image and click "Detect".</div>
                </div>
            </div>
        `;

        window.registerToolModule('🔎 CivitAI Hash Founder', '#00cc88', wrapper);

        initHashFounderLogic();
    });

    function initHashFounderLogic() {
        const hInput = document.getElementById('hfInput');
        const hList = document.getElementById('hfList');

        document.getElementById('hfSearchBtn').onclick = () => {
            const h = hInput.value.trim();
            if (h) window.open(`https://civitai.com/api/v1/model-versions/by-hash/${encodeURIComponent(h)}`, '_blank');
        };

        hInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('hfSearchBtn').onclick(); });

        document.getElementById('hfDetectBtn').onclick = () => {
            const rawEl = document.getElementById('fullText');
            if (!rawEl || !rawEl.value.trim()) { alert("No raw metadata available. Load an image first."); return; }
            
            const raw = rawEl.value;
            const regex = /\b([a-fA-F0-9]{8,64})\b/g;
            const seen = new Set();
            const hashes = [];
            let m;
            
            while ((m = regex.exec(raw)) !== null) {
                const h = m[1].toLowerCase();
                if (!seen.has(h) && !/^\d+$/.test(h)) { seen.add(h); hashes.push(h); }
            }
            
            hList.innerHTML = '';
            
            if (hashes.length === 0) {
                hList.innerHTML = '<div style="padding:14px;text-align:center;color:#555;font-size:13px;">No valid hashes found in the raw text.</div>';
                return;
            }
            
            hashes.forEach(h => {
                const item = document.createElement('div');
                item.className = 'hf-item';
                item.innerHTML = `<span class="hf-hash">${h}</span><span class="hf-status hf-pending" id="hfstatus-${h}">Pending</span>`;
                
                item.onclick = () => {
                    hInput.value = h;
                    if (item.dataset.url) {
                        window.open(item.dataset.url, '_blank');
                    } else {
                        checkHash(h, document.getElementById(`hfstatus-${h}`), item);
                    }
                };
                hList.appendChild(item);
            });

            processQueue(hashes);
        };

        async function processQueue(hashes) {
            for (const h of hashes) {
                const statusEl = document.getElementById(`hfstatus-${h}`);
                const itemEl = statusEl.parentElement;
                if (statusEl && statusEl.classList.contains('hf-pending')) {
                    await checkHash(h, statusEl, itemEl);
                    await sleep(250);
                }
            }
        }

        async function checkHash(hash, statusEl, itemEl) {
            statusEl.textContent = "Checking...";
            statusEl.className = "hf-status hf-pending";
            try {
                const r = await fetch(`https://civitai.com/api/v1/model-versions/by-hash/${encodeURIComponent(hash)}`);
                if (r.ok) {
                    const data = await r.json();
                    statusEl.textContent = "Found";
                    statusEl.className = "hf-status hf-found";
                    if (data && data.modelId) {
                        itemEl.dataset.url = `https://civitai.com/models/${data.modelId}?modelVersionId=${data.id}`;
                        
                        // Atualiza o texto da linha: Nome do Modelo - Hash
                        const modelName = data.model?.name || data.name || "Model";
                        const hashSpan = itemEl.querySelector('.hf-hash');
                        if (hashSpan) {
                            hashSpan.textContent = `${modelName} - ${hash}`;
                        }
                    }
                } else {
                    statusEl.textContent = "Not Found";
                    statusEl.className = "hf-status hf-notfound";
                }
            } catch(e) {
                statusEl.textContent = "Error";
                statusEl.className = "hf-status hf-notfound";
            }
        }
    }
})();