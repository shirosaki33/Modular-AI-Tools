/* =========================================================================
   BATCH AUTO TAGGER MODULE (ONNX / WebGPU & Offline VLMs)
   Universal Compatibility: Tag Manager & Gallery Holder
========================================================================= */

let taggersDirHandle = null;
let onnxSession = null;
let currentSessionModel = null;
let tagsDB = [];
let onnxSession2 = null;
let currentSessionModel2 = null;
let tagsDB2 = [];
let availableModelsObjects = []; 

// Instância Global para os Offline VLMs (Florence-2)
let florencePipeline = null;
let currentVlmSession = null;

// FIX: se o script do onnxruntime-web (CDN) falhar ao carregar por qualquer
// motivo (rede, bloqueio, offline), `ort` fica undefined e esta linha
// lançava uma exceção NO TOPO DO ARQUIVO — o que impedia TODO o resto deste
// arquivo de ser definido (nenhuma função do Batch Tagger existiria em
// window), sem nenhum aviso claro sobre por que o botão "🤖 Auto-Caption"
// simplesmente não funciona. Agora isso é protegido: se `ort` não estiver
// disponível, avisamos no console e seguimos — o resto do app continua
// funcionando normalmente, só o Batch Tagger (que já depende de `ort` de
// qualquer jeito) fica indisponível, e window.startBatchTagging já tem seu
// próprio try/catch pra avisar o usuário caso tente usá-lo mesmo assim.
if (typeof ort !== 'undefined' && ort.env && ort.env.wasm) {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
} else {
    console.warn('[Batch Tagger] onnxruntime-web (ort) did not load — ONNX Tagger mode will be unavailable until the page is reloaded with network access to the CDN.');
}


/* =========================================================================
   OLLAMA (VISION) PROVIDER
   ---------------------------------------------------------------------
   Terceiro modo de processamento do Batch ("🦙 Ollama"). Consulta o
   servidor Ollama local (GET /api/tags) e, pra cada modelo instalado,
   POST /api/show pra descobrir se ele suporta VISION — assim o dropdown
   só lista modelos que realmente aceitam imagem (Qwen-VL, LLaVA, Gemma3,
   Llama3.2-Vision, MiniCPM-V...), sem digitar nome de modelo na mão.
   Detecção: campo "capabilities" (Ollama recente); fallback pra famílias
   "clip"/"mllama", projector_info ou chaves ".vision." em model_info
   (Ollama mais antigo).
========================================================================= */
window._ollamaVisionCache = window._ollamaVisionCache || new Map(); // "url|model" -> bool
window._ollamaRefreshing = false;

function getOllamaBaseUrl() {
    const el = document.getElementById('ollama-url');
    let v = (el && el.value ? el.value : '').trim() || 'http://127.0.0.1:11434';
    if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
    return v.replace(/\/+$/, '');
}

async function ollamaModelHasVision(baseUrl, name) {
    const key = baseUrl + '|' + name;
    if (window._ollamaVisionCache.has(key)) return window._ollamaVisionCache.get(key);
    let isVision = false;
    try {
        const res = await fetch(baseUrl + '/api/show', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: name, name: name })
        });
        if (res.ok) {
            const d = await res.json();
            if (Array.isArray(d.capabilities)) {
                isVision = d.capabilities.includes('vision');
            } else {
                const fam = ((d.details && d.details.families) || []).map(f => String(f).toLowerCase());
                const keys = Object.keys(d.model_info || {});
                isVision = fam.some(f => ['clip', 'mllama', 'siglip'].includes(f))
                    || !!d.projector_info
                    || keys.some(k => k.includes('.vision.') || k.includes('clip.'));
            }
        }
    } catch (e) { /* trata como não-vision */ }
    window._ollamaVisionCache.set(key, isVision);
    return isVision;
}

window.refreshOllamaModels = async function (silent = false) {
    const select = document.getElementById('ollama-model-select');
    const status = document.getElementById('ollama-model-status');
    const btn = document.getElementById('btn-ollama-refresh');
    if (!select || window._ollamaRefreshing) return;

    // Modo automático (ao abrir o modo): se a lista já foi carregada, não refaz.
    if (silent && select.options.length > 1 && select.options[0].value !== '') return;

    window._ollamaRefreshing = true;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Scanning...'; }
    if (status) { status.style.color = '#888'; status.textContent = 'Asking Ollama for installed models...'; }

    const previous = select.value || (typeof window.getSetting === 'function' ? await window.getSetting('ollama-last-model', '') : '');
    try {
        const baseUrl = getOllamaBaseUrl();
        const res = await fetch(baseUrl + '/api/tags');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const all = (data.models || []).map(m => m.name || m.model).filter(Boolean);

        const flags = await Promise.all(all.map(n => ollamaModelHasVision(baseUrl, n)));
        const visionModels = all.filter((_, i) => flags[i]).sort((a, b) => a.localeCompare(b));

        select.innerHTML = '';
        if (visionModels.length === 0) {
            select.innerHTML = '<option value="">-- No vision models found --</option>';
            if (status) {
                status.style.color = '#ffcc66';
                status.textContent = `Ollama is running (${all.length} model(s) installed) but none support vision. Try: ollama pull qwen2.5vl:7b`;
            }
        } else {
            visionModels.forEach(n => {
                const opt = document.createElement('option');
                opt.value = n; opt.textContent = n;
                select.appendChild(opt);
            });
            if (previous && visionModels.includes(previous)) select.value = previous;
            if (status) {
                status.style.color = '#00ff99';
                status.textContent = `✅ ${visionModels.length} vision model(s) found (${all.length - visionModels.length} text-only model(s) hidden).`;
            }
        }
    } catch (e) {
        console.warn('[Ollama] Could not list models:', e);
        select.innerHTML = '<option value="">-- Ollama not reachable --</option>';
        if (status) {
            status.style.color = '#ff6060';
            status.textContent = '❌ Could not reach Ollama. Make sure it is running at the URL above (and, if needed, started with OLLAMA_ORIGINS=*).';
        }
        if (!silent && window.showAlert) window.showAlert('Could not connect to Ollama.', 'error');
    } finally {
        window._ollamaRefreshing = false;
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh Models'; }
        if (select.value && typeof window.saveSetting === 'function') window.saveSetting('ollama-last-model', select.value);
    }
};

window.onOllamaUrlChanged = function () {
    const el = document.getElementById('ollama-url');
    if (el && typeof window.saveSetting === 'function') window.saveSetting('ollama-url', el.value.trim());
    window.refreshOllamaModels();
};

window.onOllamaModelChanged = function () {
    const sel = document.getElementById('ollama-model-select');
    if (sel && sel.value && typeof window.saveSetting === 'function') window.saveSetting('ollama-last-model', sel.value);
};

const OLLAMA_PROMPT_NL = 'Describe this image in detail.';
const OLLAMA_PROMPT_TAGS = 'List booru-style tags describing this image (subject, hair, eyes, clothing, pose, expression, background, art style). Use lowercase English tags separated by commas. Output ONLY the tags, nothing else.';

window.updateOllamaPromptDefault = function () {
    const mode = document.getElementById('ollama-output-mode');
    const box = document.getElementById('ollama-prompt');
    if (!mode || !box) return;
    const cur = box.value.trim();
    // Só troca se o usuário não personalizou o prompt
    if (cur === '' || cur === OLLAMA_PROMPT_NL || cur === OLLAMA_PROMPT_TAGS) {
        box.value = mode.value === 'tags' ? OLLAMA_PROMPT_TAGS : OLLAMA_PROMPT_NL;
    }
    if (typeof window.saveSetting === 'function') window.saveSetting('ollama-output-mode', mode.value);
};

/* Redimensiona antes de enviar (acelera MUITO em modelos grandes) e
   devolve base64 sem o prefixo data:. Fundo branco evita PNG transparente
   virar preto ao converter pra JPEG. */
async function ollamaImageToBase64(url, maxSide) {
    const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Could not load image'));
        i.src = url;
    });
    let w = img.naturalWidth, h = img.naturalHeight;
    if (maxSide > 0) {
        const s = Math.min(1, maxSide / Math.max(w, h));
        w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.92).split(',')[1];
}

/* Remove lixo típico de LLM: cercas de markdown, "Here is the description:",
   negrito/asteriscos e quebras de linha. */
function cleanLLMText(text) {
    let t = String(text || '').trim();
    t = t.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
    t = t.replace(/^\s*(sure[!,.]?\s*)?(here('s| is| are)[^:\n]{0,80}:)\s*/i, '');
    t = t.replace(/\*\*|__/g, '').replace(/^\s*[*#>]+\s*/gm, '');
    t = t.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\s{2,}/g, ' ');
    return t.trim();
}

function parseTagsFromLLM(text) {
    const raw = String(text || '').replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
        .replace(/^\s*(sure[!,.]?\s*)?(here('s| is| are)[^:\n]{0,80}:)\s*/i, '')
        .replace(/[\r\n]+/g, ',');
    const out = [], seen = new Set();
    raw.split(',').forEach(p => {
        let t = p.trim().replace(/^[-*•\d.)\s]+/, '').replace(/\*\*|__/g, '').replace(/[.;:]+$/, '').replace(/_/g, ' ').trim().toLowerCase();
        if (!t || t.length > 60 || seen.has(t)) return;
        seen.add(t); out.push(t);
    });
    return out;
}

/* Retorna { text, failed, fatal, error }. "fatal" = Ollama fora do ar /
   modelo inexistente — não adianta tentar as próximas imagens. */
async function captionViaOllama(imgUrl, opts) {
    let b64;
    try {
        b64 = await ollamaImageToBase64(imgUrl, opts.maxSide);
    } catch (e) {
        return { text: '', failed: true, fatal: false, error: e.message };
    }
    try {
        const res = await fetch(opts.baseUrl + '/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: opts.model,
                prompt: opts.prompt,
                images: [b64],
                stream: false,
                keep_alive: '10m',
                options: { temperature: opts.temperature }
            })
        });
        if (!res.ok) {
            let detail = '';
            try { detail = (await res.json()).error || ''; } catch (e) {}
            return { text: '', failed: true, fatal: res.status === 404, error: `HTTP ${res.status}${detail ? ': ' + detail : ''}` };
        }
        const data = await res.json();
        const txt = cleanLLMText(data.response || '');
        if (!txt) return { text: '', failed: true, fatal: false, error: 'Empty response from model' };
        return { text: txt, failed: false, fatal: false };
    } catch (e) {
        return { text: '', failed: true, fatal: true, error: 'Cannot reach Ollama (' + (e.message || e) + ')' };
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.getSetting !== 'function') return;
    const urlEl = document.getElementById('ollama-url');
    const outEl = document.getElementById('ollama-output-mode');
    if (urlEl) urlEl.value = await window.getSetting('ollama-url', 'http://127.0.0.1:11434');
    if (outEl) { outEl.value = await window.getSetting('ollama-output-mode', 'nl'); window.updateOllamaPromptDefault(); }
});

const dbNameTaggers = 'TagManagerDB';

function initTaggerDB() { 
    return new Promise((res, rej) => { 
        try {
            const req = indexedDB.open(dbNameTaggers, 1); 
            req.onupgradeneeded = e => e.target.result.createObjectStore('handles'); 
            req.onsuccess = e => res(e.target.result); 
            req.onerror = e => rej(e.target.error); 
        } catch (err) {
            rej(err);
        }
    }); 
}

async function saveTaggersHandle(h) { 
    try {
        const db = await initTaggerDB(); 
        return new Promise(r => { 
            const tx = db.transaction('handles', 'readwrite'); 
            tx.objectStore('handles').put(h, 'taggers_dir'); 
            tx.oncomplete = r; 
        }); 
    } catch (e) {}
}

async function getTaggersHandle() { 
    try {
        const db = await initTaggerDB(); 
        return new Promise(r => { 
            const tx = db.transaction('handles', 'readonly'); 
            const req = tx.objectStore('handles').get('taggers_dir'); 
            req.onsuccess = () => r(req.result); 
            req.onerror = () => r(null); 
        }); 
    } catch (e) { return null; }
}

window.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.updateVlmPromptDefault === 'function') window.updateVlmPromptDefault();

    let savedHandle = await getTaggersHandle();
    if (savedHandle) {
        try {
            if (await savedHandle.queryPermission({ mode: 'read' }) === 'granted') {
                taggersDirHandle = savedHandle; 
                await scanTaggersFolder();
            } else { 
                taggersDirHandle = savedHandle; 
                const btn = document.getElementById('btn-set-taggers');
                if(btn) btn.textContent = '🔄 Reconnect Taggers'; 
            }
        } catch(e) {}
    }
});

/* =========================================================================
   RECURSIVE MODE (📁🔁)
   ---------------------------------------------------------------------
   Varre a pasta raiz carregada (window.rootHandle / currentImagesHandle)
   e TODAS as suas subpastas recursivamente (pulando "_trash" e
   "_archive", igual ao loadGallery normal), montando uma lista "solta"
   de pseudo-imagens no MESMO formato que o resto do batch já espera
   (name, baseName, ext, content, hasFile, type, url, parentDirHandle).

   Cada item guarda seu PRÓPRIO parentDirHandle (a subpasta de onde veio
   de verdade), então window.saveImageToDisk() já funciona sem
   modificação nenhuma — cada legenda é salva de volta na pasta do
   personagem correspondente.

   Isto é INDEPENDENTE do array window.imageFiles (que continua sendo só
   a pasta/subpasta atualmente exibida na lista à esquerda) — por isso,
   ao final do batch, refreshDataset() só vai "enxergar" as mudanças da
   pasta que estiver aberta no momento; as outras já foram salvas no
   disco normalmente, só não aparecem na lista até você navegar até lá. */
window._recursiveBatchUrls = window._recursiveBatchUrls || [];

async function collectImagesRecursively(dirHandle, list = [], stats = { folders: 0 }) {
    stats.folders++;
    let entries;
    try {
        entries = dirHandle.values();
    } catch (e) {
        console.warn('[Recursive Mode] Could not read folder', dirHandle && dirHandle.name, e);
        return list;
    }

    for await (const entry of entries) {
        try {
            if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
                const baseName = entry.name.substring(0, entry.name.lastIndexOf('.'));
                let content = ""; let hasFile = false; let ext = "txt";

                try {
                    const txtHandle = await dirHandle.getFileHandle(baseName + '.txt');
                    content = await (await txtHandle.getFile()).text();
                    hasFile = true; ext = "txt";
                } catch (e) {}

                if (!hasFile) {
                    try {
                        const jsonHandle = await dirHandle.getFileHandle(baseName + '.json');
                        const jsonObj = JSON.parse(await (await jsonHandle.getFile()).text());
                        if (jsonObj.tags) content = jsonObj.tags; else if (jsonObj.caption) content = jsonObj.caption;
                        hasFile = true; ext = "json";
                    } catch (e) {}
                }

                const file = await entry.getFile();
                const url = URL.createObjectURL(file);
                window._recursiveBatchUrls.push(url);

                list.push({
                    name: entry.name,
                    baseName: baseName,
                    ext: ext,
                    content: content,
                    hasFile: hasFile,
                    type: 'tags',
                    url: url,
                    handle: entry,
                    parentDirHandle: dirHandle,
                    folderLabel: dirHandle.name || '',
                    pendingAdd: [],
                    hidden: false,
                    dirty: false
                });
            } else if (entry.kind === 'directory' && entry.name !== '_trash' && entry.name !== '_archive') {
                await collectImagesRecursively(entry, list, stats);
            }
        } catch (e) {
            // Uma subpasta/arquivo específico com problema (permissão, nome
            // corrompido, etc.) não deve derrubar o scan inteiro — pula e
            // continua com o resto.
            console.warn('[Recursive Mode] Skipped an entry due to error:', entry && entry.name, e);
        }
    }
    return list;
}

function revokeRecursiveBatchUrls() {
    window._recursiveBatchUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
    window._recursiveBatchUrls = [];
}

window.updateRecursiveModeUI = function () {
    if (typeof window.checkBatchReadyState === 'function') window.checkBatchReadyState();
};

function getTargetEnv() {
    let handle = window.currentImagesHandle || (typeof currentImagesHandle !== 'undefined' ? currentImagesHandle : null);
    if (!handle) handle = window.currentHandle || (typeof currentHandle !== 'undefined' ? currentHandle : null);
    
    let files = window.imageFiles || (typeof imageFiles !== 'undefined' ? imageFiles : null);
    if (!files) files = window.currentFiles || (typeof currentFiles !== 'undefined' ? currentFiles : null);
    
    return { handle, files };
}

window.selectTaggersFolder = async function() {
    try {
        if (typeof window.showDirectoryPicker === 'undefined') {
            if (window.showAlert) window.showAlert("Your browser does not support Directory Selection. Use Chrome or Edge.", "error");
            return;
        }

        if (document.getElementById('btn-set-taggers').textContent.includes('Reconnect') && taggersDirHandle) {
            if (await taggersDirHandle.requestPermission({ mode: 'read' }) === 'granted') {
                document.getElementById('btn-set-taggers').textContent = '📁 Set Directory'; 
                await scanTaggersFolder(); 
                return;
            }
        }
        taggersDirHandle = await window.showDirectoryPicker({ mode: 'read' });
        await saveTaggersHandle(taggersDirHandle);
        document.getElementById('btn-set-taggers').textContent = '📁 Set Directory';
        await scanTaggersFolder();
    } catch (e) { 
        if (e.name !== 'AbortError') {
            console.error(e);
            if(window.showAlert) window.showAlert("Error opening directory: " + e.message, "error");
        }
    }
}

async function findModelsRecursively(dirHandle, path = '') {
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.match(/\.(onnx|pt|pth|safetensors|bin|ckpt|tflite|pb)$/i)) {
            const ext = entry.name.substring(entry.name.lastIndexOf('.'));
            const base = entry.name.substring(0, entry.name.lastIndexOf('.'));
            availableModelsObjects.push({ 
                displayName: path + base + ` (${ext})`, 
                baseName: base, 
                fileName: entry.name,
                dirHandle: dirHandle 
            });
        } else if (entry.kind === 'directory') {
            await findModelsRecursively(entry, path + entry.name + '/');
        }
    }
}

async function scanTaggersFolder() {
    if (!taggersDirHandle) return;
    availableModelsObjects = [];
    try {
        await findModelsRecursively(taggersDirHandle, '');
        const select = document.getElementById('model-select');
        if (availableModelsObjects.length > 0) {
            select.innerHTML = '<option value="">-- Select Tagger Model --</option>';
            availableModelsObjects.forEach((m, index) => select.innerHTML += `<option value="${index}">${m.displayName}</option>`);
            if(window.showAlert) window.showAlert("Tagger models loaded successfully.", "success");
        }
        if (typeof window.syncSecondModelSelect === 'function') window.syncSecondModelSelect();
    } catch (e) { console.error(e); }
}

window.loadSelectedModelData = async function() {
    const select = document.getElementById('model-select');
    if (!select || select.value === "") { tagsDB = []; if(typeof window.checkBatchReadyState==='function') window.checkBatchReadyState(); return; }
    const selectedModel = availableModelsObjects[select.value];
    try {
        const csvHandle = await selectedModel.dirHandle.getFileHandle(`${selectedModel.baseName}.csv`);
        const text = await (await csvHandle.getFile()).text();
        tagsDB = text.split('\n').slice(1).filter(l => l.trim()).map(line => {
            const parts = line.split(',');
            return { name: parts[1].replace(/_/g, ' '), category: parseInt(parts[2]) };
        });
        if(typeof window.checkBatchReadyState==='function') window.checkBatchReadyState();
    } catch (e) { 
        tagsDB = []; if(typeof window.checkBatchReadyState==='function') window.checkBatchReadyState(); 
        if(window.showAlert) window.showAlert("Warning: .csv file not found for this model.", "warn");
    }
}

window.checkBatchReadyState = function() {
    const btn = document.getElementById('btn-start-batch');
    if (!btn) return;

    // Antes o botão só habilitava com tagsDB já carregado (modelo selecionado)
    // E arquivos já detectados na pasta atual — se qualquer um faltasse, o
    // clique no botão simplesmente não fazia NADA, sem nenhum aviso (parecia
    // que o Recursive Mode, ou o app, "não estava processando"). Agora o
    // botão só fica desabilitado se não existir NENHUMA pasta carregada;
    // qualquer outro pré-requisito faltando (modelo do tagger, 0 imagens
    // encontradas etc.) é validado dentro de window.startBatchTagging(), que
    // já mostra um alerta explicando exatamente o que falta.
    const hasFolder = !!(window.rootHandle || window.currentImagesHandle);
    btn.disabled = !hasFolder;
}

/* =========================================================================
   SECOND MODEL REVIEW (ONNX)
   ---------------------------------------------------------------------
   Checkbox imediatamente ANTES do Review Mode (ghost tags). Desmarcado,
   não mostra nada. Marcado, abre uma cópia do seletor do primeiro modelo
   (modelo + threshold) para um segundo passe.

   O passe 2 só ACRESCENTA tags que a lógica dele (csv + threshold próprios)
   encontrou e que o modelo principal não tinha colocado. Não remove nada
   que o primeiro passe já inseriu. No Review Mode essas tags extras entram
   como ghost tags (💡), junto com as do primeiro modelo.
========================================================================= */
function parseTaggerCsv(text) {
    return text.split('\n').slice(1).filter(l => l.trim()).map(line => {
        const parts = line.split(',');
        return { name: parts[1].replace(/_/g, ' '), category: parseInt(parts[2]) };
    });
}

window.loadSelectedModelData2 = async function () {
    const select = document.getElementById('model-select-2');
    if (!select || select.value === '') { tagsDB2 = []; return; }
    const selectedModel = availableModelsObjects[select.value];
    if (!selectedModel) { tagsDB2 = []; return; }
    try {
        const csvHandle = await selectedModel.dirHandle.getFileHandle(`${selectedModel.baseName}.csv`);
        const text = await (await csvHandle.getFile()).text();
        tagsDB2 = parseTaggerCsv(text);
    } catch (e) {
        tagsDB2 = [];
        if (window.showAlert) window.showAlert('Warning: .csv file not found for the second model.', 'warn');
    }
};

window.syncSecondModelSelect = function () {
    const src = document.getElementById('model-select');
    const dst = document.getElementById('model-select-2');
    if (!src || !dst) return;
    const prev = dst.value;
    dst.innerHTML = src.innerHTML;
    if (dst.options[0] && dst.options[0].value === '') dst.options[0].textContent = '-- Select Second Tagger Model --';
    if (prev && Array.from(dst.options).some(o => o.value === prev)) dst.value = prev;
    else dst.value = '';
};

function cloneTaggerField(sourceId, newId) {
    const src = document.getElementById(sourceId);
    if (!src) return null;
    let block = src;
    const parent = src.parentElement;
    if (parent && parent.tagName !== 'BODY' && parent.tagName !== 'FORM') {
        const n = parent.querySelectorAll('input, select, textarea').length;
        if (n === 1 && !parent.querySelector('#review-mode-toggle, #second-model-review-toggle, #second-model-panel')) {
            block = parent;
        }
    }
    const wrap = document.createElement('div');
    wrap.className = 'second-model-field';
    if (block === src) {
        const prev = src.previousElementSibling;
        if (prev && !prev.querySelector('input, select, textarea, button') && /^(LABEL|SPAN|P|DIV|B|STRONG)$/.test(prev.tagName)) {
            const labelClone = prev.cloneNode(true);
            if (labelClone.tagName === 'LABEL') labelClone.setAttribute('for', newId);
            wrap.appendChild(labelClone);
        }
    }
    const clone = block.cloneNode(true);
    const el = clone.id === sourceId ? clone : clone.querySelector('#' + sourceId);
    if (!el) return null;
    el.id = newId;
    el.onchange = null;
    el.oninput = null;
    el.onclick = null;
    el.removeAttribute('onchange');
    el.removeAttribute('oninput');
    el.removeAttribute('onclick');
    clone.querySelectorAll('label[for="' + sourceId + '"]').forEach(l => l.setAttribute('for', newId));
    if (clone !== el && clone.id) clone.removeAttribute('id');
    wrap.appendChild(clone);
    return wrap;
}

function fallbackTaggerField(kind) {
    const wrap = document.createElement('div');
    wrap.className = 'second-model-field';
    if (kind === 'model') {
        wrap.innerHTML = '<label for="model-select-2">Model</label><select id="model-select-2"></select>';
    } else {
        const src = document.getElementById('threshold');
        const value = src && src.value ? src.value : '0.35';
        const min = src && src.min ? src.min : '0';
        const max = src && src.max ? src.max : '1';
        const step = src && src.step ? src.step : '0.01';
        wrap.innerHTML = `<label for="threshold-2">Threshold</label><input id="threshold-2" type="number" min="${min}" max="${max}" step="${step}" value="${value}">`;
    }
    return wrap;
}

function buildSecondModelPanel() {
    const panel = document.getElementById('second-model-panel');
    if (!panel || panel.dataset.built === '1') return;
    panel.dataset.built = '1';
    const note = document.createElement('div');
    note.className = 'second-model-note';
    note.textContent = 'Second pass only adds tags this model finds that the first one missed. Nothing already kept is removed.';
    panel.appendChild(note);
    panel.appendChild(cloneTaggerField('model-select', 'model-select-2') || fallbackTaggerField('model'));
    panel.appendChild(cloneTaggerField('threshold', 'threshold-2') || fallbackTaggerField('threshold'));
    const sel = panel.querySelector('#model-select-2');
    if (sel) sel.addEventListener('change', () => window.loadSelectedModelData2());
    window.syncSecondModelSelect();
}

window.updateSecondModelReviewUI = function () {
    const on = !!(document.getElementById('second-model-review-toggle') && document.getElementById('second-model-review-toggle').checked);
    const panel = document.getElementById('second-model-panel');
    if (!panel) return;
    if (on) {
        buildSecondModelPanel();
        window.syncSecondModelSelect();
        panel.style.display = 'block';
    } else {
        panel.style.display = 'none';
    }
};

function updateSecondModelModeVisibility() {
    const wrap = document.getElementById('second-model-review-wrap');
    if (!wrap) return;
    const modeEl = document.getElementById('batch-mode-select');
    const isTags = !modeEl || modeEl.value === 'tags';
    wrap.style.display = isTags ? '' : 'none';
    if (isTags) window.updateSecondModelReviewUI();
}

function reviewModeAnchor(toggle) {
    const label = toggle.closest('label');
    if (label && !label.querySelector('#model-select, #threshold, #batch-mode-select')) return label;
    let node = toggle;
    while (node.parentElement && node.parentElement.tagName !== 'BODY') {
        const p = node.parentElement;
        if (p.querySelectorAll('input, select, textarea').length > 2 || p.querySelector('#model-select')) break;
        node = p;
    }
    return node;
}

function injectSecondModelReviewUI() {
    if (document.getElementById('second-model-review-toggle')) return true;
    const toggle = document.getElementById('review-mode-toggle');
    if (!toggle) return false;
    if (!document.getElementById('second-model-review-style')) {
        const style = document.createElement('style');
        style.id = 'second-model-review-style';
        style.textContent = `
            #second-model-review-wrap { margin: 8px 0; }
            #second-model-review-wrap > label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
            #second-model-panel { display: none; margin: 6px 0 10px 22px; padding: 8px 10px; border: 1px dashed #555; border-radius: 6px; }
            #second-model-panel .second-model-note { font-size: 11px; color: #999; margin-bottom: 8px; }
            #second-model-panel .second-model-field { margin: 0 0 8px 0; }
            #second-model-panel .second-model-field:last-child { margin-bottom: 0; }
        `;
        document.head.appendChild(style);
    }
    const anchor = reviewModeAnchor(toggle);
    const wrap = document.createElement('div');
    wrap.id = 'second-model-review-wrap';
    wrap.innerHTML = `
        <label title="After the main ONNX tagger, run a second model and add only the tags it finds missing.">
            <input type="checkbox" id="second-model-review-toggle">
            Second Model Review
        </label>
        <div id="second-model-panel"></div>
    `;
    anchor.parentElement.insertBefore(wrap, anchor);
    document.getElementById('second-model-review-toggle').addEventListener('change', () => window.updateSecondModelReviewUI());
    window.updateSecondModelReviewUI();
    return true;
}

function bootSecondModelReviewUI() {
    let tries = 0;
    const tick = () => {
        const ok = injectSecondModelReviewUI();
        const modeSel = document.getElementById('batch-mode-select');
        if (modeSel && !modeSel.dataset.secondModelHook) {
            modeSel.dataset.secondModelHook = '1';
            modeSel.addEventListener('change', updateSecondModelModeVisibility);
        }
        updateSecondModelModeVisibility();
        if (!ok && tries++ < 40) setTimeout(tick, 250);
    };
    tick();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootSecondModelReviewUI);
else bootSecondModelReviewUI();

const KNOWN_VLM_DEFAULT_PROMPTS = [
    '<CAPTION>', '<DETAILED_CAPTION>', '<MORE_DETAILED_CAPTION>', '<OCR>',
    'Describe this image in detail.', ''
];

window.updateVlmPromptDefault = function() {
    const select = document.getElementById('vlm-model-select');
    const promptBox = document.getElementById('batch-vlm-prompt');
    const help = document.getElementById('vlm-prompt-help');
    if (!select || !promptBox) return;

    const isFlorence = select.value.toLowerCase().includes('florence');
    const isJoy = select.value.toLowerCase().includes('joycaption');
    const currentVal = promptBox.value.trim();

    if (KNOWN_VLM_DEFAULT_PROMPTS.includes(currentVal)) {
        promptBox.value = isFlorence ? '<MORE_DETAILED_CAPTION>' : 'Describe this image in detail.';
    }

    if (help) {
        help.textContent = isFlorence
            ? 'Florence-2 task tokens: <CAPTION>, <DETAILED_CAPTION>, <MORE_DETAILED_CAPTION>, <OCR>.'
            : 'SmolVLM/JoyCaption: escreva a instrução em linguagem natural (ex: "Describe this image in detail.").';
    }

    // JoyCaption runs via local Ollama — it never downloads/caches anything in the browser,
    // so the browser-cache warning and "Clear Model Cache" button don't apply to it.
    const downloadWarning = document.getElementById('vlm-download-warning');
    const clearCacheContainer = document.getElementById('vlm-clear-cache-container');
    const ollamaInfo = document.getElementById('vlm-ollama-info');
    if (downloadWarning) downloadWarning.style.display = isJoy ? 'none' : 'block';
    if (clearCacheContainer) clearCacheContainer.style.display = isJoy ? 'none' : 'block';
    if (ollamaInfo) ollamaInfo.style.display = isJoy ? 'block' : 'none';
}

window.clearVlmModelCache = async function() {
    if (!('caches' in window)) {
        if(window.showAlert) window.showAlert("Cache API is not supported in this browser.", "error");
        return;
    }
    if (!confirm("This will delete the already-downloaded VLM model files from your browser (e.g. Florence-2, ~300MB). It will be downloaded again the next time you run the batch. Continue?")) return;

    try {
        const deleted = await caches.delete('transformers-cache');
        florencePipeline = null;
        currentVlmSession = null;

        if(window.showAlert) {
            window.showAlert(deleted ? "Model cache cleared successfully!" : "No cache found (already clean).", "success");
        }
    } catch (e) {
        console.error(e);
        if(window.showAlert) window.showAlert("Error clearing the cache. Check the console.", "error");
    }
}

window.generateEmptyFiles = async function() {
    const { handle: targetHandle, files: targetFiles } = getTargetEnv();
    if (!targetFiles || !targetHandle) return;
    
    const folderAlreadyHasCaptions = targetFiles.some(img => img.hasFile);
    if (folderAlreadyHasCaptions) {
        if (!confirm("⚠️ WARNING: This folder already contains caption files (.txt or .json). Creating new missing files may mix formats within your current dataset. Are you sure you want to continue scanning and create the missing empty files?")) {
            return;
        }
    }

    if ((await targetHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if ((await targetHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
            if(window.showAlert) window.showAlert("Write permission denied.", "error");
            return;
        }
    }

    const format = document.getElementById('save-format').value;
    let created = 0;
    
    for (const img of targetFiles) {
        if (!img.hasFile) {
            img.baseName = img.baseName || img.name.substring(0, img.name.lastIndexOf('.'));
            img.parentDirHandle = img.parentDirHandle || targetHandle;
            img.content = "";
            img.type = 'tags';
            img.ext = format;

            const ok = await window.saveImageToDisk(img);
            if (ok) {
                img.hasFile = true;
                created++;
            }
        }
    }
    
    if(window.refreshListStatus) window.refreshListStatus();
    if(typeof updateGridCounters === 'function') updateGridCounters();
    if(window.showAlert) window.showAlert(`Created ${created} empty files.`, "success");
}

const BATCH_TARGET_SIZE = 448;

async function preprocessImage(imgUrl) {
    return new Promise((resolve) => {
        const img = new Image(); img.src = imgUrl;
        img.onload = () => {
            const canvas = document.getElementById('offscreen-canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, BATCH_TARGET_SIZE, BATCH_TARGET_SIZE);
            const scale = Math.min(BATCH_TARGET_SIZE / img.width, BATCH_TARGET_SIZE / img.height);
            const w = img.width * scale, h = img.height * scale;
            ctx.drawImage(img, (BATCH_TARGET_SIZE - w) / 2, (BATCH_TARGET_SIZE - h) / 2, w, h);
            resolve(canvas);
        };
    });
}

async function createOnnxSession(modelObj, hwMode) {
    const modelFileHandle = await modelObj.dirHandle.getFileHandle(modelObj.fileName);
    const arrayBuffer = await (await modelFileHandle.getFile()).arrayBuffer();
    let provider = 'wasm';
    if (hwMode === 'webgpu') {
        if (!navigator.gpu) {
            if (window.showAlert) window.showAlert('WebGPU not supported. Forcing CPU WASM.', 'warn');
        } else {
            provider = 'webgpu';
        }
    }
    try {
        return await ort.InferenceSession.create(arrayBuffer, { executionProviders: [provider] });
    } catch (e) {
        if (provider === 'webgpu') {
            console.warn('WebGPU failed:', e);
            if (window.showAlert) window.showAlert('WebGPU failed. Forcing CPU WASM.', 'warn');
            return await ort.InferenceSession.create(arrayBuffer, { executionProviders: ['wasm'] });
        }
        throw e;
    }
}

async function inferTags(session, tags, imgUrl, threshold, excludeArray) {
    const canvas = await preprocessImage(imgUrl);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, BATCH_TARGET_SIZE, BATCH_TARGET_SIZE).data;
    const float32Data = new Float32Array(BATCH_TARGET_SIZE * BATCH_TARGET_SIZE * 3);
    for (let i = 0; i < BATCH_TARGET_SIZE * BATCH_TARGET_SIZE; i++) {
        float32Data[i * 3 + 0] = imgData[i * 4 + 2];
        float32Data[i * 3 + 1] = imgData[i * 4 + 1];
        float32Data[i * 3 + 2] = imgData[i * 4 + 0];
    }
    const tensor = new ort.Tensor('float32', float32Data, [1, BATCH_TARGET_SIZE, BATCH_TARGET_SIZE, 3]);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const outputData = results[session.outputNames[0]].data;
    const tagList = [];
    for (let i = 0; i < tags.length; i++) {
        if (outputData[i] >= threshold && tags[i].category !== 9) {
            const tName = tags[i].name;
            if (!excludeArray.includes(tName.toLowerCase())) tagList.push({ name: tName, conf: outputData[i] });
        }
    }
    tagList.sort((a, b) => b.conf - a.conf);
    return tagList.map(t => t.name);
}

function updateDownloadProgress(data) {
    const dlContainer = document.getElementById('vlm-dl-container');
    const dlFile = document.getElementById('vlm-dl-file');
    const dlPercent = document.getElementById('vlm-dl-percent');
    const dlBar = document.getElementById('vlm-dl-bar');
    
    if(!dlContainer) return;
    dlContainer.style.display = 'block';

    if (data.status === 'init') {
        dlFile.textContent = `Starting: ${data.file}`;
    } else if (data.status === 'download') {
        dlFile.textContent = `Downloading: ${data.file}`;
    } else if (data.status === 'progress') {
        const percent = Math.round((data.loaded / data.total) * 100);
        dlPercent.textContent = `${percent}%`;
        dlBar.style.width = `${percent}%`;
        dlFile.textContent = `Processing: ${data.file}`;
    } else if (data.status === 'done') {
        dlFile.textContent = `Done: ${data.file}`;
        dlPercent.textContent = `100%`;
        dlBar.style.width = `100%`;
    }
}

/* === SISTEMA DE CANCELAMENTO === */
window.isBatchCancelled = false;

window.stopBatchTagging = function() {
    window.isBatchCancelled = true;
    if(window.showAlert) window.showAlert("Canceling process... Please wait for the current image.", "warn");
    const cancelBtn = document.getElementById('btn-cancel-batch');
    if(cancelBtn) cancelBtn.textContent = "Stopping...";
};

window.startBatchTagging = async function() {
    const recursiveToggle = document.getElementById('recursive-mode-toggle');
    const isRecursive = !!(recursiveToggle && recursiveToggle.checked);

    let targetHandle, targetFiles;

    if (isRecursive) {
        // Prioriza a pasta que está sendo EXIBIDA agora (window.currentImagesHandle —
        // que muda conforme você navega pelos dropdowns "Subfolders"/"Inner
        // Folders"/"Deeper Folders"), e não sempre a raiz (window.rootHandle).
        // Assim, se você entrou 2 níveis dentro da franquia antes de rodar o
        // batch, o scan recursivo começa DALI pra baixo, não do topo.
        const rootForScan = window.currentImagesHandle || window.rootHandle;
        if (!rootForScan) {
            if(window.showAlert) window.showAlert("No folder loaded.", "error");
            return;
        }
        if(window.showAlert) window.showAlert("🔁 Scanning all subfolders recursively... this can take a moment for big franchise folders.", "info");
        revokeRecursiveBatchUrls();
        const stats = { folders: 0 };
        try {
            targetFiles = await collectImagesRecursively(rootForScan, [], stats);
        } catch (e) {
            console.error(e);
            if(window.showAlert) window.showAlert("Error scanning subfolders recursively. Check the console.", "error");
            return;
        }
        console.log(`[Recursive Mode] Scanned ${stats.folders} folder(s), found ${targetFiles.length} image(s).`);
        if (targetFiles.length === 0) {
            if(window.showAlert) window.showAlert(`🔁 Scanned ${stats.folders} folder(s) starting from "${rootForScan.name}", but found 0 images inside. Make sure the images are directly inside the character subfolders (.png/.jpg/.jpeg/.webp).`, "error");
            return;
        }
        if(window.showAlert) window.showAlert(`🔁 Found ${targetFiles.length} image(s) across ${stats.folders} folder(s). Starting batch...`, "info");
        targetHandle = rootForScan;
    } else {
        const env = getTargetEnv();
        targetHandle = env.handle;
        targetFiles = env.files;
    }

    if (!targetFiles || !targetFiles.length || !targetHandle) {
        if(window.showAlert) window.showAlert(isRecursive ? "No images found recursively in this folder." : "No images or folder loaded.", "error");
        return;
    }
    
    const mode = document.getElementById('batch-mode-select').value;
    const hwMode = document.getElementById('hardware-select').value; 
    
    if (mode === 'tags' && !tagsDB.length) {
        if(window.showAlert) window.showAlert("Please select a valid Tagger model.", "error");
        return;
    }
    let useSecondModel = false;
    let threshold2 = 0.35;
    let selectedModelObj2 = null;
    if (mode === 'tags' && document.getElementById('second-model-review-toggle') && document.getElementById('second-model-review-toggle').checked) {
        const sel2 = document.getElementById('model-select-2');
        if (!sel2 || sel2.value === '') {
            if(window.showAlert) window.showAlert('Second Model Review is on, but no second tagger model is selected.', 'error');
            return;
        }
        selectedModelObj2 = availableModelsObjects[sel2.value];
        if (!selectedModelObj2) {
            if(window.showAlert) window.showAlert('Second model selection is invalid. Set the taggers folder again.', 'error');
            return;
        }
        if (!tagsDB2.length) await window.loadSelectedModelData2();
        if (!tagsDB2.length) {
            if(window.showAlert) window.showAlert('Second model has no .csv tags file.', 'error');
            return;
        }
        const th2el = document.getElementById('threshold-2');
        threshold2 = th2el ? parseFloat(th2el.value) : parseFloat(document.getElementById('threshold').value);
        if (!isFinite(threshold2)) threshold2 = 0.35;
        useSecondModel = true;
    }
    if (mode === 'ollama-vision') {
        const ollamaSel = document.getElementById('ollama-model-select');
        if (!ollamaSel || !ollamaSel.value) {
            if(window.showAlert) window.showAlert("Select an Ollama vision model first (press 🔄 Refresh Models).", "error");
            return;
        }
    }
    
    if ((await targetHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if ((await targetHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
            if(window.showAlert) window.showAlert("Write permission denied. Cannot save files.", "error");
            return;
        }
    }
    
    const reviewModeToggleEl = document.getElementById('review-mode-toggle');
    let reviewModeActive = !!(reviewModeToggleEl && reviewModeToggleEl.checked);

    // Review Mode (sugestões-fantasma 💡) depende do array global window.imageFiles
    // e de datasetConfig/pendingTagsStore da pasta ATUAL — coisas que não existem
    // pras imagens de outras subpastas coletadas recursivamente. Em vez de fingir
    // que funciona (e perder as sugestões silenciosamente), desligamos e avisamos.
    if (isRecursive && reviewModeActive) {
        reviewModeActive = false;
        if (reviewModeToggleEl) reviewModeToggleEl.checked = false;
        if(window.showAlert) window.showAlert("⚠️ Review Mode isn't supported together with Recursive Mode — saving tags directly to disk instead.", "warn");
    }

    window.isBatchCancelled = false;
    const btn = document.getElementById('btn-start-batch'); btn.disabled = true;
    const cancelBtn = document.getElementById('btn-cancel-batch');
    if(cancelBtn) {
        cancelBtn.style.display = 'block';
        cancelBtn.textContent = '⏹ Cancel';
    }

    const format = document.getElementById('save-format').value;
    
    document.getElementById('progress-container').style.display = 'block';
    document.getElementById('progress-text').style.display = 'block';
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    
    try {
        if (mode === 'tags') {
            const threshold = parseFloat(document.getElementById('threshold').value);
            const prefix = document.getElementById('prefix').value.trim();
            const excludeStr = document.getElementById('exclude') ? document.getElementById('exclude').value.trim() : '';
            const excludeArray = excludeStr.split(',').map(t => t.trim().toLowerCase()).filter(t => t);

            const select = document.getElementById('model-select');
            const selectedModelObj = availableModelsObjects[select.value];
            
            if (!onnxSession || currentSessionModel !== selectedModelObj.displayName) {
                if(window.showAlert) window.showAlert(`Loading ${selectedModelObj.fileName}... this might take a while.`, 'info');
                onnxSession = await createOnnxSession(selectedModelObj, hwMode);
                currentSessionModel = selectedModelObj.displayName;
            }

            if (useSecondModel) {
                if (selectedModelObj2.displayName === selectedModelObj.displayName) {
                    if (onnxSession2 && onnxSession2 !== onnxSession) {
                        try { await onnxSession2.release(); } catch (e) {}
                    }
                    onnxSession2 = onnxSession;
                    currentSessionModel2 = currentSessionModel;
                } else if (!onnxSession2 || currentSessionModel2 !== selectedModelObj2.displayName || onnxSession2 === onnxSession) {
                    if (onnxSession2 && onnxSession2 !== onnxSession) {
                        try { await onnxSession2.release(); } catch (e) {}
                        onnxSession2 = null;
                    }
                    if(window.showAlert) window.showAlert(`Loading second model ${selectedModelObj2.fileName}... this might take a while.`, 'info');
                    onnxSession2 = await createOnnxSession(selectedModelObj2, hwMode);
                    currentSessionModel2 = selectedModelObj2.displayName;
                }
            }
            
            let processed = 0;
            
            for (let idx = 0; idx < targetFiles.length; idx++) {
                if (window.isBatchCancelled) {
                    if(window.showAlert) window.showAlert("Batch process canceled by user.", "info");
                    break;
                }

                const imgObj = targetFiles[idx];
                if (imgObj.hidden) continue;
                const baseName = imgObj.baseName || imgObj.name.substring(0, imgObj.name.lastIndexOf('.'));

                let finalTags = await inferTags(onnxSession, tagsDB, imgObj.url, threshold, excludeArray);
                
                if (prefix) {
                    const prefixArray = prefix.split(',').map(t => t.trim()).filter(t => t);
                    finalTags = [...prefixArray, ...finalTags.filter(t => !prefixArray.includes(t))];
                }

                // Passe 2: só entra tag que o segundo modelo previu e o primeiro
                // ainda não tinha. Não tira tag do primeiro passe nem do arquivo.
                if (useSecondModel && onnxSession2 && tagsDB2.length) {
                    const extra = await inferTags(onnxSession2, tagsDB2, imgObj.url, threshold2, excludeArray);
                    const have = new Set(finalTags.map(t => String(t).toLowerCase()));
                    extra.forEach(t => {
                        const key = String(t).toLowerCase();
                        if (!have.has(key)) {
                            finalTags.push(t);
                            have.add(key);
                        }
                    });
                }
                
                if (reviewModeActive) {
                    const existingTags = (imgObj.content || '').split(',').map(t => t.trim()).filter(t => t);
                    const existingSet = new Set(existingTags);
                    imgObj.pendingAdd = finalTags.filter(t => !existingSet.has(t));

                    if (typeof pendingTagsStore !== 'undefined') {
                        if (imgObj.pendingAdd.length > 0) pendingTagsStore[baseName] = imgObj.pendingAdd;
                        else delete pendingTagsStore[baseName];
                    }

                    // NOVO: marca tags que JÁ EXISTEM na imagem mas que o tagger NÃO
                    // confirmou de volta nesta passada — ou seja, o modelo "discorda"
                    // que essa tag deveria estar ali. Não mexe no arquivo em disco
                    // (Review Mode nunca escreve nada sozinho); só fica marcado pra
                    // revisão visual (ver tagmanager_review_unconfirmed.js).
                    // Tags "NL:" (caption embutida) e tags que o usuário colocou na
                    // lista de Exclude são ignoradas aqui — o tagger nunca as
                    // consideraria de qualquer forma, então não é "desconfirmação".
                    if (typeof window.pendingRemoveStore === 'undefined') window.pendingRemoveStore = {};
                    const finalSet = new Set(finalTags);
                    imgObj.pendingRemove = existingTags.filter(t =>
                        !finalSet.has(t) && !t.startsWith('NL:') && !excludeArray.includes(t.toLowerCase())
                    );
                    if (imgObj.pendingRemove.length > 0) window.pendingRemoveStore[baseName] = imgObj.pendingRemove;
                    else delete window.pendingRemoveStore[baseName];

                    processed++;
                    progressBar.style.width = `${(processed / targetFiles.length) * 100}%`;
                    progressText.textContent = `${processed} / ${targetFiles.length} Processed`;
                    continue;
                }

                imgObj.pendingAdd = [];
                if (typeof pendingTagsStore !== 'undefined') delete pendingTagsStore[baseName];

                const finalContent = finalTags.join(', ');
                imgObj.content = finalContent;
                imgObj.type = 'tags';
                imgObj.hasFile = true;
                imgObj.ext = format; 
                imgObj.parentDirHandle = imgObj.parentDirHandle || targetHandle;
                
                await window.saveImageToDisk(imgObj);
                
                if(window.masterTagSet) finalTags.forEach(t => masterTagSet.add(t));
                
                processed++;
                progressBar.style.width = `${(processed / targetFiles.length) * 100}%`;
                progressText.textContent = `${processed} / ${targetFiles.length} Processed`;
            }

            if (typeof savePendingTagsStore === 'function') await savePendingTagsStore(targetHandle);
        
        } else if (mode === 'nl-vlm' || mode === 'ollama-vision') {
            const isOllamaMode = mode === 'ollama-vision';
            const promptPrefix = isOllamaMode
                ? (document.getElementById('ollama-prompt').value.trim() || 'Describe this image in detail.')
                : (document.getElementById('batch-vlm-prompt').value.trim() || '<MORE_DETAILED_CAPTION>');
            const vlmModelId = isOllamaMode
                ? document.getElementById('ollama-model-select').value
                : document.getElementById('vlm-model-select').value;
            const modelIdLower = vlmModelId.toLowerCase();
            // No modo Ollama o nome do modelo é livre (ex: "qwen2.5vl:7b"), então
            // nunca pode cair nos ramos Florence/SmolVLM só por coincidência de nome.
            const isFlorence = !isOllamaMode && modelIdLower.includes('florence');
            const isSmolVLM = !isOllamaMode && modelIdLower.includes('smolvlm');
            const isJoyAPI = isOllamaMode || modelIdLower.includes('joycaption');
            const ollamaBaseUrl = getOllamaBaseUrl();
            const ollamaModelName = isOllamaMode ? vlmModelId : 'user-v4/joycaption-beta';
            const ollamaOutputMode = isOllamaMode ? document.getElementById('ollama-output-mode').value : 'nl';
            const ollamaMaxSide = isOllamaMode ? (parseInt(document.getElementById('ollama-max-side').value, 10) || 0) : 0;
            window._batchFailedCaptions = 0;
            let processed = 0;

            if (!isFlorence && !isSmolVLM && !isJoyAPI) {
                if(window.showAlert) window.showAlert("This VLM model is not yet implemented in this version.", "error");
                throw new Error("Selected VLM is not yet implemented.");
            }

            const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

            if (!isJoyAPI && (!florencePipeline || currentVlmSession !== vlmModelId)) {
                if(window.showAlert) window.showAlert(`Loading ${vlmModelId.split('/').pop()}... First run requires a download.`, "info");

                const importedModule = await import(TRANSFORMERS_CDN);
                const { AutoProcessor, env } = importedModule;
                const ModelClass = isFlorence ? importedModule.Florence2ForConditionalGeneration : importedModule.AutoModelForVision2Seq;

                env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
                env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;

                let deviceTarget = 'wasm';
                if (hwMode === 'webgpu' && navigator.gpu) deviceTarget = 'webgpu';

                async function loadModel(device, sessionOptions) {
                    const dtypeConfig = isFlorence
                        ? (device === 'wasm' ? 'q8' : 'fp16')
                        : (device === 'wasm'
                            ? { embed_tokens: 'fp32', vision_encoder: 'q8', decoder_model_merged: 'q8' }
                            : { embed_tokens: 'fp16', vision_encoder: 'q4', decoder_model_merged: 'q4' });

                    const opts = { dtype: dtypeConfig, device, progress_callback: updateDownloadProgress };
                    if (sessionOptions) opts.session_options = sessionOptions;

                    const model = await ModelClass.from_pretrained(vlmModelId, opts);
                    const processor = await AutoProcessor.from_pretrained(vlmModelId);
                    return { model, processor };
                }

                try {
                    florencePipeline = await loadModel(deviceTarget);
                    currentVlmSession = vlmModelId;
                    if(window.showAlert) window.showAlert(`${vlmModelId.split('/').pop()} loaded successfully!`, "success");
                } catch(e) {
                    if (deviceTarget === 'webgpu') {
                        console.warn("WebGPU failed with default config, trying again without graph optimization:", e);
                        try {
                            florencePipeline = await loadModel('webgpu', { graphOptimizationLevel: 'disabled' });
                            currentVlmSession = vlmModelId;
                            if(window.showAlert) window.showAlert("Model loaded on GPU (without graph optimization)!", "success");
                        } catch (e2) {
                            console.error("WebGPU failed even without graph optimization, falling back to CPU WASM:", e2);
                            if(window.showAlert) window.showAlert("WebGPU is incompatible with this model. Using CPU WASM.", "warn");
                            florencePipeline = await loadModel('wasm');
                            currentVlmSession = vlmModelId;
                        }
                    } else {
                        throw e;
                    }
                }
            }

            // O carregamento do load_image só é necessário se não for API
            let load_image = null;
            if (!isJoyAPI) {
                const module = await import(TRANSFORMERS_CDN);
                load_image = module.load_image;
            }

            for (let idx = 0; idx < targetFiles.length; idx++) {
                if (window.isBatchCancelled) {
                    if(window.showAlert) window.showAlert("Batch process canceled by user.", "info");
                    break;
                }

                const imgObj = targetFiles[idx];
                if (imgObj.hidden) continue;
                const baseName = imgObj.baseName || imgObj.name.substring(0, imgObj.name.lastIndexOf('.'));
                let finalContent = "";
                let captionFailed = false;

                if (isFlorence) {
                    const image = await load_image(imgObj.url);
                    const prompts = florencePipeline.processor.construct_prompts(promptPrefix);
                    const inputs = await florencePipeline.processor(image, prompts);

                    const generated_ids = await florencePipeline.model.generate({
                        ...inputs,
                        max_new_tokens: 256
                    });

                    const generatedText = florencePipeline.processor.batch_decode(generated_ids, { skip_special_tokens: false })[0];
                    const parsed = florencePipeline.processor.post_process_generation(generatedText, promptPrefix, image.size);
                    finalContent = parsed[promptPrefix];

                    if (typeof finalContent === 'string') {
                        if (finalContent.startsWith(promptPrefix)) {
                            finalContent = finalContent.replace(promptPrefix, '').trim();
                        }
                        finalContent = finalContent.trim();
                    } else {
                        // Tasks like <OD> / <DENSE_REGION_CAPTION> return structured data (bboxes + labels),
                        // not plain text — not supported as a caption/tag in this version.
                        finalContent = "Error: this Florence-2 task returns structured data (not text) and is not supported.";
                    }

                } else if (isSmolVLM) {
                    const instruction = promptPrefix.startsWith('<') ? 'Describe this image in detail.' : promptPrefix;
                    const image = await load_image(imgObj.url);
                    const messages = [{ role: "user", content: [{ type: "image" }, { type: "text", text: instruction }] }];
                    const textPrompt = florencePipeline.processor.apply_chat_template(messages, { add_generation_prompt: true });
                    const inputs = await florencePipeline.processor(textPrompt, [image], { do_image_splitting: false });

                    const generated_ids = await florencePipeline.model.generate({
                        ...inputs,
                        max_new_tokens: 256
                    });

                    const generated_texts = florencePipeline.processor.batch_decode(
                        generated_ids.slice(null, [inputs.input_ids.dims.at(-1), null]),
                        { skip_special_tokens: true }
                    );
                    finalContent = (generated_texts[0] || "").trim();
                    
                } else if (isJoyAPI) {
                    const r = await captionViaOllama(imgObj.url, {
                        baseUrl: ollamaBaseUrl,
                        model: ollamaModelName,
                        prompt: promptPrefix,
                        maxSide: ollamaMaxSide,
                        temperature: 0.1
                    });
                    finalContent = r.text;
                    captionFailed = r.failed;
                    if (r.failed) {
                        console.error('[Ollama] Caption failed for', imgObj.name, '-', r.error);
                        if (r.fatal) {
                            if(window.showAlert) window.showAlert('Ollama error: ' + r.error + ' — batch stopped.', 'error');
                            window.isBatchCancelled = true;
                            break;
                        }
                    }
                }

                // Falha isolada numa imagem: NUNCA grava mensagem de erro como legenda.
                if (captionFailed || (isFlorence && finalContent.startsWith('Error'))) {
                    window._batchFailedCaptions++;
                    processed++;
                    progressBar.style.width = `${(processed / targetFiles.length) * 100}%`;
                    progressText.textContent = `${processed} / ${targetFiles.length} Processed`;
                    continue;
                }

                // OLLAMA -> saída em TAGS (lista separada por vírgula, estilo booru)
                if (isOllamaMode && ollamaOutputMode === 'tags') {
                    const parsedTags = parseTagsFromLLM(finalContent);
                    const existingList = imgObj.content ? imgObj.content.split(',').map(t => t.trim()).filter(t => t) : [];
                    const existingLower = new Set(existingList.map(t => t.toLowerCase()));
                    const newTags = parsedTags.filter(t => !existingLower.has(t));

                    if (reviewModeActive) {
                        if (!imgObj.pendingAdd) imgObj.pendingAdd = [];
                        newTags.forEach(t => { if (!imgObj.pendingAdd.includes(t)) imgObj.pendingAdd.push(t); });
                        if (typeof pendingTagsStore !== 'undefined') {
                            if (imgObj.pendingAdd.length > 0) pendingTagsStore[baseName] = imgObj.pendingAdd;
                            else delete pendingTagsStore[baseName];
                        }
                    } else {
                        imgObj.type = 'tags';
                        imgObj.content = [...existingList, ...newTags].join(', ');
                        imgObj.hasFile = true;
                        imgObj.ext = format;
                        imgObj.parentDirHandle = imgObj.parentDirHandle || targetHandle;
                        await window.saveImageToDisk(imgObj);
                        if (window.masterTagSet) newTags.forEach(t => masterTagSet.add(t));
                    }

                    processed++;
                    progressBar.style.width = `${(processed / targetFiles.length) * 100}%`;
                    progressText.textContent = `${processed} / ${targetFiles.length} Processed`;
                    continue;
                }

                // GHOST MODE PARA LINGUAGEM NATURAL E VLM
                if (reviewModeActive) {
                    if (!imgObj.pendingAdd) imgObj.pendingAdd = [];
                    // Escapa vírgulas reais para não quebrar o parser de tags (split por ',')
                    // e envolve em "NL:" para que, ao ser aceita, vire uma tag híbrida de linguagem natural.
                    const nlSuggestion = 'NL:' + finalContent.replace(/,/g, '，');
                    const existingTagsList = imgObj.content ? imgObj.content.split(',').map(t => t.trim()) : [];
                    
                    if (!existingTagsList.includes(nlSuggestion) && !imgObj.pendingAdd.includes(nlSuggestion) && finalContent) {
                        imgObj.pendingAdd.push(nlSuggestion);
                        if (typeof pendingTagsStore !== 'undefined') {
                            pendingTagsStore[baseName] = imgObj.pendingAdd;
                        }
                    }
                    
                    processed++;
                    progressBar.style.width = `${(processed / targetFiles.length) * 100}%`;
                    progressText.textContent = `${processed} / ${targetFiles.length} Processed`;
                    continue;
                }

                // LÓGICA DE SALVAMENTO DIRETO (Modo Híbrido)
                // O caption gerado pelo VLM vira uma tag "NL:" dentro do sistema unificado de tags.
                let existingTags = imgObj.content ? imgObj.content.trim() : "";

                if (finalContent) {
                    const nlTag = 'NL:' + finalContent.replace(/,/g, '，');
                    finalContent = existingTags ? `${nlTag}, ${existingTags}` : nlTag;
                }

                imgObj.type = 'tags';
                imgObj.content = finalContent;
                imgObj.hasFile = true;
                imgObj.ext = format;
                imgObj.parentDirHandle = imgObj.parentDirHandle || targetHandle;

                await window.saveImageToDisk(imgObj);

                processed++;
                progressBar.style.width = `${(processed / targetFiles.length) * 100}%`;
                progressText.textContent = `${processed} / ${targetFiles.length} Processed`;
            }

            if (typeof savePendingTagsStore === 'function') await savePendingTagsStore(targetHandle);
        }
        
        if (!window.isBatchCancelled && !reviewModeActive) {
            const failedN = window._batchFailedCaptions || 0;
            if (failedN > 0) {
                if(window.showAlert) window.showAlert(`Batch finished, but ${failedN} image(s) failed and were skipped (existing captions untouched). Check the console.`, "warn");
            } else {
                if(window.showAlert) window.showAlert("Batch processing complete!", "success");
            }
            window._batchFailedCaptions = 0;
        }
    } catch (e) { 
        console.error(e); 
        if(window.showAlert) window.showAlert("Critical error. Check the console.", 'error'); 
    } finally { 
        btn.disabled = false; 
        if(cancelBtn) cancelBtn.style.display = 'none';

        if (isRecursive) revokeRecursiveBatchUrls();

        const dlContainer = document.getElementById('vlm-dl-container');
        if(dlContainer) dlContainer.style.display = 'none'; 

        if (reviewModeActive) {
            if(window.refreshListStatus) window.refreshListStatus();
            if(typeof window.renderImageList === 'function') window.renderImageList();
            if(window.renderMasterTagList) window.renderMasterTagList();
            if(typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && window.renderEditor) window.renderEditor();
            if(typeof window.updateSuggestFilterVisibility === 'function') window.updateSuggestFilterVisibility();
            if(window.showAlert) window.showAlert("Suggestions generated! Review the ghost tags (💡) and accept the ones you want.", "info");
        } else if(typeof window.refreshDataset === 'function') {
            await window.refreshDataset();
        } else {
            if(window.refreshListStatus) window.refreshListStatus();
            if(window.renderMasterTagList && mode === 'tags') window.renderMasterTagList();
            if(typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && window.renderEditor) window.renderEditor();
            if(typeof renderGrid === 'function') window.renderGrid();
        }
    }
}