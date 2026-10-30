/* =========================================================================
   BATCH AUTO TAGGER MODULE (ONNX / WebGPU, Offline VLMs, Ollama, PyTorch)
   ---------------------------------------------------------------------
   Modos:
   - 🏷️ Tagger (ONNX)      -> roda aqui (onnxruntime-web).
   - 🖥️ Natural Language   -> engine do Prompt Helper via tagmanager_batch_vlm.js (window.TMVlm).
   - 🔥 PyTorch / ONNX      -> idem, servidor local (só localhost).
   - 🦙 Ollama              -> servidor Ollama local.

   O caminho legado Florence/SmolVLM/JoyCaption (para o Gallery Holder) foi
   removido: o Gallery não carrega este arquivo e os modos acima já cobrem
   esses modelos.
========================================================================= */

let taggersDirHandle = null;
let onnxSession = null;
let currentSessionModel = null;
let tagsDB = [];
let onnxSession2 = null;
let currentSessionModel2 = null;
let tagsDB2 = [];
let availableModelsObjects = [];
// Taggers come from two places: models/onnx on localhost (found automatically)
// and a folder picked by the user. availableModelsObjects is the merge of both.
let serverTaggers = [];
let folderTaggers = [];

// Se o onnxruntime-web (CDN) não carregar, `ort` fica undefined: avisa no
// console e segue — só o modo ONNX Tagger fica indisponível.
if (typeof ort !== 'undefined' && ort.env && ort.env.wasm) {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
} else {
    console.warn('[Batch Tagger] onnxruntime-web (ort) did not load — ONNX Tagger mode will be unavailable until the page is reloaded with network access to the CDN.');
}

// Same list used by the folder dropdowns (tagmanager_ui_core.js).
function isSystemFolderName(name) {
    if (typeof window.isSystemDirName === 'function') return window.isSystemDirName(name);
    return name === '_trash' || name === '_archive' || name === '_rename_cache';
}


/* =========================================================================
   OLLAMA (VISION) PROVIDER
   ---------------------------------------------------------------------
   Consulta o Ollama local (GET /api/tags) e, para cada modelo instalado,
   POST /api/show para descobrir se ele suporta VISION — o dropdown só
   lista modelos que aceitam imagem.
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

/* Redimensiona antes de enviar e devolve base64 sem o prefixo data:.
   Fundo branco evita PNG transparente virar preto ao converter pra JPEG. */
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
        let t = p.trim().replace(/^(?:[-*•]+\s*|\d+[.)]\s+)/, '').replace(/\*\*|__/g, '').replace(/[.;:]+$/, '').replace(/_/g, ' ').trim().toLowerCase();
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
    // localhost: ONNX taggers inside models/onnx show up by themselves
    await scanServerTaggers();

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
   Varre a pasta carregada e TODAS as subpastas (pulando as pastas de
   sistema "_trash", "_archive" e "_rename_cache"), montando pseudo-imagens
   no mesmo formato que o resto do batch espera. Cada item guarda o
   PRÓPRIO parentDirHandle, então window.saveImageToDisk() salva cada
   legenda ao lado da sua imagem.
========================================================================= */
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
            } else if (entry.kind === 'directory' && !isSystemFolderName(entry.name)) {
                await collectImagesRecursively(entry, list, stats);
            }
        } catch (e) {
            // Uma entrada com problema não derruba o scan inteiro.
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
    const handle = window.currentImagesHandle || (typeof currentImagesHandle !== 'undefined' ? currentImagesHandle : null);
    const files = window.imageFiles || (typeof imageFiles !== 'undefined' ? imageFiles : null);
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
            folderTaggers.push({
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

/* Rebuilds the model <select> from the localhost list + the picked folder.
   Option values are indexes into availableModelsObjects. */
function rebuildTaggerModelList() {
    const select = document.getElementById('model-select');
    const prev = (select && select.value !== '' && availableModelsObjects[select.value])
        ? availableModelsObjects[select.value].displayName : '';
    availableModelsObjects = [...serverTaggers, ...folderTaggers];
    if (select && availableModelsObjects.length > 0) {
        select.innerHTML = '<option value="">-- Select Tagger Model --</option>';
        availableModelsObjects.forEach((m, index) => {
            const opt = document.createElement('option');
            opt.value = String(index);
            opt.textContent = (m.server ? '🏠 ' : '📁 ') + m.displayName;
            select.appendChild(opt);
        });
        const keep = prev ? availableModelsObjects.findIndex(m => m.displayName === prev) : -1;
        select.value = keep >= 0 ? String(keep) : '';
        if (keep < 0) tagsDB = [];
    }
    const hint = document.getElementById('tagger-source-hint');
    if (hint) {
        const bits = [];
        if (serverTaggers.length) bits.push(`${serverTaggers.length} found in <code>models/onnx</code> (🏠)`);
        if (folderTaggers.length) bits.push(`${folderTaggers.length} found in the chosen folder (📁)`);
        hint.innerHTML = bits.length
            ? bits.join(' · ') + '. Use <b>Set Directory</b> to add another folder.'
            : 'On localhost, ONNX taggers inside <code>models/onnx</code> are found automatically. Use <b>Set Directory</b> to add any other folder.';
    }
    if (typeof window.syncSecondModelSelect === 'function') window.syncSecondModelSelect();
    if (typeof window.checkBatchReadyState === 'function') window.checkBatchReadyState();
}

const TAGGER_IS_LOCALHOST = (typeof window.MAT_IS_LOCAL === 'boolean')
    ? window.MAT_IS_LOCAL
    : ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const taggerUrlFor = rel => '/' + String(rel).split('/').map(encodeURIComponent).join('/');

/* localhost only: server_max.py lists every .onnx that has a tag CSV inside models/onnx */
async function scanServerTaggers() {
    if (!TAGGER_IS_LOCALHOST || !document.getElementById('model-select')) return;
    try {
        const res = await fetch('/api/models_list', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        serverTaggers = (data.taggers || []).map(t => ({
            displayName: `${t.name} (${t.rel})`,
            baseName: t.name,
            fileName: String(t.rel).split('/').pop(),
            server: true,
            onnxUrl: taggerUrlFor(t.rel),
            csvUrl: taggerUrlFor(t.csv)
        }));
        rebuildTaggerModelList();
    } catch (e) { /* static server without the endpoint: only the manual folder is available */ }
}

async function scanTaggersFolder() {
    if (!taggersDirHandle) return;
    folderTaggers = [];
    try {
        await findModelsRecursively(taggersDirHandle, '');
        rebuildTaggerModelList();
        if (folderTaggers.length > 0 && window.showAlert) window.showAlert("Tagger models loaded successfully.", "success");
    } catch (e) { console.error(e); }
}

/* CSV next to the model, same lookup order as the Prompt Helper:
   <model>.csv · <model>_tags.csv · selected_tags.csv · tags.csv · the only .csv in the folder */
function pickTaggerCsv(onnxName, names) {
    const base = onnxName.replace(/\.[^.]+$/, '');
    const lower = new Map(names.map(n => [n.toLowerCase(), n]));
    for (const c of [base + '.csv', base + '_tags.csv', 'selected_tags.csv', 'tags.csv']) {
        if (lower.has(c.toLowerCase())) return lower.get(c.toLowerCase());
    }
    const csvs = names.filter(n => /\.csv$/i.test(n));
    return csvs.length === 1 ? csvs[0] : null;
}

async function readTaggerCsvText(model) {
    if (model.server) {
        const res = await fetch(model.csvUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.text();
    }
    const names = [];
    for await (const e of model.dirHandle.values()) if (e.kind === 'file') names.push(e.name);
    const csvName = pickTaggerCsv(model.fileName, names);
    if (!csvName) throw new Error('csv not found');
    const csvHandle = await model.dirHandle.getFileHandle(csvName);
    return await (await csvHandle.getFile()).text();
}

window.loadSelectedModelData = async function() {
    const select = document.getElementById('model-select');
    if (!select || select.value === "") { tagsDB = []; if(typeof window.checkBatchReadyState==='function') window.checkBatchReadyState(); return; }
    const selectedModel = availableModelsObjects[select.value];
    try {
        tagsDB = parseTaggerCsv(await readTaggerCsvText(selectedModel));
        if(typeof window.checkBatchReadyState==='function') window.checkBatchReadyState();
    } catch (e) {
        tagsDB = []; if(typeof window.checkBatchReadyState==='function') window.checkBatchReadyState();
        if(window.showAlert) window.showAlert("Warning: .csv file not found for this model.", "warn");
    }
}

window.checkBatchReadyState = function() {
    const btn = document.getElementById('btn-start-batch');
    if (!btn) return;
    // Só desabilita sem pasta carregada; os outros pré-requisitos são
    // validados em startBatchTagging(), que explica o que falta.
    const hasFolder = !!(window.rootHandle || window.currentImagesHandle);
    btn.disabled = !hasFolder;
}

/* =========================================================================
   SECOND MODEL REVIEW (ONNX)
   ---------------------------------------------------------------------
   O passe 2 só ACRESCENTA tags que o segundo modelo encontrou e que o
   principal não tinha colocado. No Review Mode entram como ghost tags (💡).
========================================================================= */
function parseTaggerCsv(text) {
    return text.split('\n').slice(1).filter(l => l.trim()).map(line => {
        const parts = line.split(',');
        return { name: (parts[1] || '').replace(/_/g, ' '), category: parseInt(parts[2]) };
    });
}

window.loadSelectedModelData2 = async function () {
    const select = document.getElementById('model-select-2');
    if (!select || select.value === '') { tagsDB2 = []; return; }
    const selectedModel = availableModelsObjects[select.value];
    if (!selectedModel) { tagsDB2 = []; return; }
    try {
        tagsDB2 = parseTaggerCsv(await readTaggerCsvText(selectedModel));
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

function buildSecondModelPanel() {
    const panel = document.getElementById('second-model-panel');
    if (!panel || panel.dataset.built === '1') return;
    panel.dataset.built = '1';
    const src = document.getElementById('threshold');
    const value = src && src.value ? src.value : '0.35';
    const min = src && src.min ? src.min : '0';
    const max = src && src.max ? src.max : '1';
    const step = src && src.step ? src.step : '0.01';
    panel.innerHTML = `
        <div class="second-model-note">The second pass only <b>adds</b> tags this model finds that the first one missed. Nothing already kept is removed. With Review Mode on, they show up as ghost tags (💡).</div>
        <div class="second-model-field smr-model">
            <label for="model-select-2">Second tagger model</label>
            <select id="model-select-2"></select>
        </div>
        <div class="second-model-field smr-th">
            <label for="threshold-2">Threshold</label>
            <input id="threshold-2" type="number" min="${min}" max="${max}" step="${step}" value="${value}" title="Minimum confidence for the second model">
        </div>`;
    const sel = panel.querySelector('#model-select-2');
    if (sel) sel.addEventListener('change', () => window.loadSelectedModelData2());
    window.syncSecondModelSelect();
}

window.updateSecondModelReviewUI = function () {
    const toggle = document.getElementById('second-model-review-toggle');
    const on = !!(toggle && toggle.checked);
    const panel = document.getElementById('second-model-panel');
    const wrap = document.getElementById('second-model-review-wrap');
    if (!panel) return;
    if (wrap) wrap.classList.toggle('open', on);
    if (on) {
        buildSecondModelPanel();
        window.syncSecondModelSelect();
        panel.style.display = 'grid';
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
            #second-model-review-wrap { margin: 0 0 15px 0; background: #150f26; border: 1px solid #3a2570; border-radius: 8px; padding: 10px 12px; transition: border-color .15s, background .15s; }
            #second-model-review-wrap.open { border-color: #6a42c0; background: #1a1230; }
            #second-model-review-wrap > label { display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; font-size: 12px; font-weight: bold; color: #b890ff; }
            #second-model-review-wrap > label input { width: auto; margin: 0; accent-color: #b890ff; }
            #second-model-review-wrap .smr-sub { font-size: 11px; color: #8a78b8; margin: 3px 0 0 26px; line-height: 1.4; }
            #second-model-panel { display: none; grid-template-columns: minmax(0, 1fr) 130px; gap: 10px 12px; margin: 12px 0 0 0; padding-top: 12px; border-top: 1px solid #3a2570; }
            #second-model-panel .second-model-note { grid-column: 1 / -1; font-size: 11px; color: #a89cc8; line-height: 1.5; background: #0f0a1d; border: 1px solid #2a1a55; border-radius: 6px; padding: 7px 10px; }
            #second-model-panel .second-model-field { margin: 0; min-width: 0; }
            #second-model-panel .second-model-field label { display: block; font-size: 10px; color: #8a78b8; text-transform: uppercase; font-weight: bold; letter-spacing: .5px; margin-bottom: 5px; }
            #second-model-panel .second-model-field select, #second-model-panel .second-model-field input { width: 100%; box-sizing: border-box; min-width: 0; text-overflow: ellipsis; background: #0f0a1d; border: 1px solid #3a2570; color: #d8c8ff; }
            #second-model-panel .second-model-field select:focus, #second-model-panel .second-model-field input:focus { border-color: #b890ff; }
        `;
        document.head.appendChild(style);
    }
    const anchor = reviewModeAnchor(toggle);
    const wrap = document.createElement('div');
    wrap.id = 'second-model-review-wrap';
    wrap.innerHTML = `
        <label title="After the main ONNX tagger, run a second model and add only the tags it finds missing.">
            <input type="checkbox" id="second-model-review-toggle">
            <span>🔍 Second Model Review</span>
        </label>
        <div class="smr-sub">Run another ONNX tagger afterwards and add only the tags the first one missed.</div>
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
    if(window.showAlert) window.showAlert(`Created ${created} empty files.`, "success");
}

const BATCH_TARGET_SIZE = 448;

async function preprocessImage(imgUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.getElementById('offscreen-canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, BATCH_TARGET_SIZE, BATCH_TARGET_SIZE);
            const scale = Math.min(BATCH_TARGET_SIZE / img.width, BATCH_TARGET_SIZE / img.height);
            const w = img.width * scale, h = img.height * scale;
            ctx.drawImage(img, (BATCH_TARGET_SIZE - w) / 2, (BATCH_TARGET_SIZE - h) / 2, w, h);
            resolve(canvas);
        };
        // Antes, uma imagem corrompida deixava esta Promise pendurada para sempre e o batch travava.
        img.onerror = () => reject(new Error('Could not decode image'));
        img.src = imgUrl;
    });
}

async function createOnnxSession(modelObj, hwMode) {
    let arrayBuffer;
    if (modelObj.server) {
        // localhost: the model sits in models/onnx and is served by server_max.py
        const res = await fetch(modelObj.onnxUrl);
        if (!res.ok) throw new Error('Could not read ' + modelObj.fileName + ' (HTTP ' + res.status + ')');
        arrayBuffer = await res.arrayBuffer();
    } else {
        const modelFileHandle = await modelObj.dirHandle.getFileHandle(modelObj.fileName);
        arrayBuffer = await (await modelFileHandle.getFile()).arrayBuffer();
    }
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

/* === SISTEMA DE CANCELAMENTO === */
window.isBatchCancelled = false;

window.stopBatchTagging = function() {
    window.isBatchCancelled = true;
    // Natural Language / PyTorch: also interrupts a model download / load / generation in progress
    if (window.TMVlm) window.TMVlm.cancel();
    if(window.showAlert) window.showAlert("Canceling process... Please wait for the current image.", "warn");
    const cancelBtn = document.getElementById('btn-cancel-batch');
    if(cancelBtn) cancelBtn.textContent = "Stopping...";
};

window.startBatchTagging = async function() {
    const recursiveToggle = document.getElementById('recursive-mode-toggle');
    const isRecursive = !!(recursiveToggle && recursiveToggle.checked);

    let targetHandle, targetFiles;

    if (isRecursive) {
        // Começa da pasta EXIBIDA agora (currentImagesHandle), não sempre da raiz.
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

    if (mode === 'tags' && typeof ort === 'undefined') {
        if(window.showAlert) window.showAlert("ONNX Runtime did not load (no network access to the CDN?). Reload the page and try again.", "error");
        return;
    }
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
    // Natural Language (WebGPU) and PyTorch share the engine panel driven by tagmanager_batch_vlm.js
    const isEngineMode = !!(window.TMVlm && window.TMVlm.handles(mode));
    if (mode === 'pytorch' && !isEngineMode) {
        if(window.showAlert) window.showAlert("PyTorch mode is only available on localhost (start the app with the .bat file).", "error");
        return;
    }
    if (mode === 'nl-vlm' && !isEngineMode) {
        if(window.showAlert) window.showAlert("The Natural Language engine did not load (tagmanager_batch_vlm.js / prompt_helper_florence_webgpu.js). Reload the page and try again.", "error");
        return;
    }
    if (isEngineMode) {
        const problem = window.TMVlm.validate();
        if (problem) {
            if(window.showAlert) window.showAlert(problem, "error");
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

    // Review Mode depende de imageFiles / pendingTagsStore da pasta ATUAL —
    // não existe para imagens de outras subpastas coletadas recursivamente.
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
    const setProgress = (processed) => {
        progressBar.style.width = `${(processed / targetFiles.length) * 100}%`;
        progressText.textContent = `${processed} / ${targetFiles.length} Processed`;
    };
    window._batchFailedCaptions = 0;

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
            const prefixArray = prefix ? prefix.split(',').map(t => t.trim()).filter(t => t) : [];

            for (let idx = 0; idx < targetFiles.length; idx++) {
                if (window.isBatchCancelled) {
                    if(window.showAlert) window.showAlert("Batch process canceled by user.", "info");
                    break;
                }

                const imgObj = targetFiles[idx];
                if (imgObj.hidden) continue;
                const baseName = imgObj.baseName || imgObj.name.substring(0, imgObj.name.lastIndexOf('.'));

                let finalTags;
                try {
                    finalTags = await inferTags(onnxSession, tagsDB, imgObj.url, threshold, excludeArray);
                } catch (e) {
                    console.error('[Tagger] Failed on', imgObj.name, e);
                    window._batchFailedCaptions++;
                    processed++; setProgress(processed);
                    continue;
                }

                if (prefixArray.length) {
                    finalTags = [...prefixArray, ...finalTags.filter(t => !prefixArray.includes(t))];
                }

                // Passe 2: só entra tag que o segundo modelo previu e o primeiro não tinha.
                if (useSecondModel && onnxSession2 && tagsDB2.length) {
                    try {
                        const extra = await inferTags(onnxSession2, tagsDB2, imgObj.url, threshold2, excludeArray);
                        const have = new Set(finalTags.map(t => String(t).toLowerCase()));
                        extra.forEach(t => {
                            const key = String(t).toLowerCase();
                            if (!have.has(key)) {
                                finalTags.push(t);
                                have.add(key);
                            }
                        });
                    } catch (e) { console.warn('[Tagger] Second model failed on', imgObj.name, e); }
                }

                if (reviewModeActive) {
                    const existingTags = (imgObj.content || '').split(',').map(t => t.trim()).filter(t => t);
                    const existingSet = new Set(existingTags);
                    imgObj.pendingAdd = finalTags.filter(t => !existingSet.has(t));

                    if (typeof pendingTagsStore !== 'undefined') {
                        if (imgObj.pendingAdd.length > 0) pendingTagsStore[baseName] = imgObj.pendingAdd;
                        else delete pendingTagsStore[baseName];
                    }

                    // Tags que JÁ EXISTEM mas o tagger não confirmou nesta passada:
                    // ficam marcadas para revisão (tagmanager_review_unconfirmed.js).
                    // "NL:" e tags da lista Exclude são ignoradas.
                    if (typeof window.pendingRemoveStore === 'undefined') window.pendingRemoveStore = {};
                    const finalSet = new Set(finalTags);
                    imgObj.pendingRemove = existingTags.filter(t =>
                        !finalSet.has(t) && !t.startsWith('NL:') && !excludeArray.includes(t.toLowerCase())
                    );
                    if (imgObj.pendingRemove.length > 0) window.pendingRemoveStore[baseName] = imgObj.pendingRemove;
                    else delete window.pendingRemoveStore[baseName];

                    processed++; setProgress(processed);
                    continue;
                }

                imgObj.pendingAdd = [];
                if (typeof pendingTagsStore !== 'undefined') delete pendingTagsStore[baseName];

                imgObj.content = finalTags.join(', ');
                imgObj.type = 'tags';
                imgObj.hasFile = true;
                imgObj.ext = format;
                imgObj.parentDirHandle = imgObj.parentDirHandle || targetHandle;

                await window.saveImageToDisk(imgObj);

                if(window.masterTagSet) finalTags.forEach(t => masterTagSet.add(t));

                processed++; setProgress(processed);
            }

            if (typeof savePendingTagsStore === 'function') await savePendingTagsStore(targetHandle);

        } else if (mode === 'nl-vlm' || mode === 'ollama-vision' || mode === 'pytorch') {
            const isOllamaMode = mode === 'ollama-vision';
            const ollamaPrompt = isOllamaMode ? (document.getElementById('ollama-prompt').value.trim() || OLLAMA_PROMPT_NL) : '';
            const ollamaBaseUrl = getOllamaBaseUrl();
            const ollamaModelName = isOllamaMode ? document.getElementById('ollama-model-select').value : '';
            const ollamaOutputMode = isOllamaMode ? document.getElementById('ollama-output-mode').value : 'nl';
            const ollamaMaxSide = isOllamaMode ? (parseInt(document.getElementById('ollama-max-side').value, 10) || 0) : 0;
            let processed = 0;

            // Engine modes (WebGPU / PyTorch): download + load the model once, before the first image.
            let engineReady = true;
            if (isEngineMode) {
                window.TMVlm.setBatchBusy(true);
                if(window.showAlert) window.showAlert("Preparing the model... the first run may need a download.", "info");
                try {
                    await window.TMVlm.prepare();
                } catch (e) {
                    engineReady = false;
                    window.isBatchCancelled = true;   // also hides the "complete" message at the end
                    if (e && e.cancelled) {
                        if(window.showAlert) window.showAlert("Batch process canceled by user.", "info");
                    } else {
                        console.error(e);
                        if(window.showAlert) window.showAlert("Could not load the model: " + ((e && e.message) || e), "error");
                    }
                }
            }

            for (let idx = 0; idx < targetFiles.length; idx++) {
                if (!engineReady) break;
                if (window.isBatchCancelled) {
                    if(window.showAlert) window.showAlert("Batch process canceled by user.", "info");
                    break;
                }

                const imgObj = targetFiles[idx];
                if (imgObj.hidden) continue;
                const baseName = imgObj.baseName || imgObj.name.substring(0, imgObj.name.lastIndexOf('.'));
                let finalContent = "";
                let captionFailed = false;
                let resultKind = 'nl';

                if (isEngineMode) {
                    const r = await window.TMVlm.captionImage(imgObj);
                    if (r.cancelled) {
                        window.isBatchCancelled = true;
                        if(window.showAlert) window.showAlert("Batch process canceled by user.", "info");
                        break;
                    }
                    finalContent = r.text || '';
                    captionFailed = !!r.failed;
                    resultKind = r.kind || 'nl';
                    if (r.failed) {
                        console.error('[Auto-Caption] Caption failed for', imgObj.name, '-', r.error);
                        if (r.fatal) {
                            if(window.showAlert) window.showAlert('Model error: ' + r.error + ' — batch stopped.', 'error');
                            window.isBatchCancelled = true;
                            break;
                        }
                    }
                } else {
                    const r = await captionViaOllama(imgObj.url, {
                        baseUrl: ollamaBaseUrl,
                        model: ollamaModelName,
                        prompt: ollamaPrompt,
                        maxSide: ollamaMaxSide,
                        temperature: 0.1
                    });
                    finalContent = r.text;
                    captionFailed = r.failed;
                    resultKind = ollamaOutputMode === 'tags' ? 'tags' : 'nl';
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
                if (captionFailed) {
                    window._batchFailedCaptions++;
                    processed++; setProgress(processed);
                    continue;
                }

                // Saída em TAGS (lista separada por vírgula, estilo booru)
                if (resultKind === 'tags') {
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

                    processed++; setProgress(processed);
                    continue;
                }

                // Linguagem natural: vira uma tag "NL:" (vírgulas reais viram "，"
                // para não quebrar o split(',') das tags).
                const nlTag = finalContent ? 'NL:' + finalContent.replace(/,/g, '，') : '';

                if (reviewModeActive) {
                    if (!imgObj.pendingAdd) imgObj.pendingAdd = [];
                    const existingTagsList = imgObj.content ? imgObj.content.split(',').map(t => t.trim()) : [];
                    if (nlTag && !existingTagsList.includes(nlTag) && !imgObj.pendingAdd.includes(nlTag)) {
                        imgObj.pendingAdd.push(nlTag);
                        if (typeof pendingTagsStore !== 'undefined') pendingTagsStore[baseName] = imgObj.pendingAdd;
                    }
                    processed++; setProgress(processed);
                    continue;
                }

                const existingTags = imgObj.content ? imgObj.content.trim() : "";
                imgObj.type = 'tags';
                imgObj.content = nlTag ? (existingTags ? `${nlTag}, ${existingTags}` : nlTag) : existingTags;
                imgObj.hasFile = true;
                imgObj.ext = format;
                imgObj.parentDirHandle = imgObj.parentDirHandle || targetHandle;

                await window.saveImageToDisk(imgObj);

                processed++; setProgress(processed);
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

        if (window.TMVlm) { window.TMVlm.setBatchBusy(false); window.TMVlm.hideProgress(); }

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
        }
    }
}
