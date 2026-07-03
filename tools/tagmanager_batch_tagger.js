/* =========================================================================
   BATCH AUTO TAGGER MODULE (ONNX / WebGPU & Offline VLMs)
   Universal Compatibility: Tag Manager & Gallery Holder
========================================================================= */

let taggersDirHandle = null;
let onnxSession = null;
let currentSessionModel = null;
let tagsDB = []; 
let availableModelsObjects = []; 

// Instância Global para os Offline VLMs (Florence-2)
let florencePipeline = null;
let currentVlmSession = null;

// Motor Global para o WD14 (ONNX puro) apontando para a versão fixa
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;

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
    let savedHandle = await getTaggersHandle();
    if (savedHandle) {
        try {
            if (await savedHandle.queryPermission({ mode: 'read' }) === 'granted') {
                taggersDirHandle = savedHandle; 
                await scanTaggersFolder();
            } else { 
                // CORREÇÃO: Guarda a pasta na memória para o botão saber o que pedir
                taggersDirHandle = savedHandle; 
                const btn = document.getElementById('btn-set-taggers');
                if(btn) btn.textContent = '🔄 Reconnect Taggers'; 
            }
        } catch(e) {}
    }
});

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
    const modeSelect = document.getElementById('batch-mode-select');
    const mode = modeSelect ? modeSelect.value : 'tags';
    const { files } = getTargetEnv();
    
    if(btn) {
        if (mode === 'tags') {
            if (tagsDB.length > 0 && files && files.length > 0) btn.disabled = false;
            else btn.disabled = true;
        } else {
            if (files && files.length > 0) btn.disabled = false;
            else btn.disabled = true;
        }
    }
}

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
    const currentVal = promptBox.value.trim();

    if (KNOWN_VLM_DEFAULT_PROMPTS.includes(currentVal)) {
        promptBox.value = isFlorence ? '<MORE_DETAILED_CAPTION>' : 'Describe this image in detail.';
    }

    if (help) {
        help.textContent = isFlorence
            ? 'Florence-2 task tokens: <CAPTION>, <DETAILED_CAPTION>, <MORE_DETAILED_CAPTION>, <OCR>.'
            : 'SmolVLM: escreva a instrução em linguagem natural (ex: "Describe this image in detail.").';
    }
}

window.clearVlmModelCache = async function() {
    if (!('caches' in window)) {
        if(window.showAlert) window.showAlert("Cache API não suportada neste navegador.", "error");
        return;
    }
    if (!confirm("Isso vai apagar do navegador os arquivos do modelo VLM já baixados (ex: Florence-2, ~300MB). Ele será baixado novamente na próxima vez que você rodar o batch. Deseja continuar?")) return;

    try {
        const deleted = await caches.delete('transformers-cache');
        florencePipeline = null;
        currentVlmSession = null;

        if(window.showAlert) {
            window.showAlert(deleted ? "Cache do modelo limpo com sucesso!" : "Nenhum cache encontrado (já estava limpo).", "success");
        }
    } catch (e) {
        console.error(e);
        if(window.showAlert) window.showAlert("Erro ao limpar o cache. Veja o console.", "error");
    }
}

window.generateEmptyFiles = async function() {
    const { handle: targetHandle, files: targetFiles } = getTargetEnv();
    if (!targetFiles || !targetHandle) return;
    
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
            const baseName = img.baseName || img.name.substring(0, img.name.lastIndexOf('.'));
            const fileName = format === 'json' ? baseName + '.json' : baseName + '.txt';
            const contentStr = format === 'json' ? '{\n  "tags": ""\n}' : '';
            
            // Fallback para manter compatibilidade com o Gallery (que não tem parentDirHandle individual)
            const actualHandle = img.parentDirHandle || targetHandle;
            
            const fileHandle = await actualHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            const blob = new Blob([contentStr], { type: "text/plain;charset=utf-8" });
            await writable.write(blob);
            await writable.close();
            
            img.hasFile = true;
            img.content = "";
            img.type = 'tags';
            img.ext = format; 
            created++;

            if (typeof currentJsonFiles !== 'undefined' && format === 'json') {
                currentJsonFiles.add(fileName);
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

// ====== SISTEMA DE CANCELAMENTO ======
window.isBatchCancelled = false;

window.stopBatchTagging = function() {
    window.isBatchCancelled = true;
    if(window.showAlert) window.showAlert("Canceling process... Please wait for the current image.", "warn");
    const cancelBtn = document.getElementById('btn-cancel-batch');
    if(cancelBtn) cancelBtn.textContent = "Stopping...";
};

window.startBatchTagging = async function() {
    const { handle: targetHandle, files: targetFiles } = getTargetEnv();
    if (!targetFiles || !targetFiles.length || !targetHandle) {
        if(window.showAlert) window.showAlert("No images or folder loaded.", "error");
        return;
    }
    
    const mode = document.getElementById('batch-mode-select').value;
    const hwMode = document.getElementById('hardware-select').value; 
    
    if (mode === 'tags' && !tagsDB.length) {
        if(window.showAlert) window.showAlert("Please select a valid Tagger model.", "error");
        return;
    }
    
    if ((await targetHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if ((await targetHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
            if(window.showAlert) window.showAlert("Write permission denied. Cannot save files.", "error");
            return;
        }
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
                
                const modelFileHandle = await selectedModelObj.dirHandle.getFileHandle(selectedModelObj.fileName);
                const arrayBuffer = await (await modelFileHandle.getFile()).arrayBuffer();
                
                let provider = 'wasm';
                if (hwMode === 'webgpu') {
                    if (!navigator.gpu) { 
                        if(window.showAlert) window.showAlert("WebGPU not supported. Forcing CPU WASM.", "warn"); 
                    } else {
                        provider = 'webgpu';
                    }
                }
                
                try {
                    onnxSession = await ort.InferenceSession.create(arrayBuffer, { executionProviders: [provider] });
                } catch(e) {
                    if (provider === 'webgpu') {
                        console.warn("WebGPU failed:", e);
                        if(window.showAlert) window.showAlert("WebGPU failed. Forcing CPU WASM.", "warn");
                        onnxSession = await ort.InferenceSession.create(arrayBuffer, { executionProviders: ['wasm'] });
                    } else {
                        throw e;
                    }
                }
                currentSessionModel = selectedModelObj.displayName;
            }
            
            let processed = 0;
            
            for (let idx = 0; idx < targetFiles.length; idx++) {
                if (window.isBatchCancelled) {
                    if(window.showAlert) window.showAlert("Batch process canceled by user.", "info");
                    break;
                }

                const imgObj = targetFiles[idx];
                const baseName = imgObj.baseName || imgObj.name.substring(0, imgObj.name.lastIndexOf('.'));
                
                const canvas = await preprocessImage(imgObj.url);
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                const imgData = ctx.getImageData(0, 0, BATCH_TARGET_SIZE, BATCH_TARGET_SIZE).data;
                
                const float32Data = new Float32Array(BATCH_TARGET_SIZE * BATCH_TARGET_SIZE * 3);
                for (let i = 0; i < BATCH_TARGET_SIZE * BATCH_TARGET_SIZE; i++) {
                    float32Data[i * 3 + 0] = imgData[i * 4 + 2];
                    float32Data[i * 3 + 1] = imgData[i * 4 + 1];
                    float32Data[i * 3 + 2] = imgData[i * 4 + 0];
                }
                
                const tensor = new ort.Tensor('float32', float32Data, [1, BATCH_TARGET_SIZE, BATCH_TARGET_SIZE, 3]);
                const results = await onnxSession.run({ [onnxSession.inputNames[0]]: tensor });
                const outputData = results[onnxSession.outputNames[0]].data; 
                
                let tagList = [];
                for (let i = 0; i < tagsDB.length; i++) {
                    if (outputData[i] >= threshold && tagsDB[i].category !== 9) {
                        const tName = tagsDB[i].name;
                        if (!excludeArray.includes(tName.toLowerCase())) {
                            tagList.push({ name: tName, conf: outputData[i] });
                        }
                    }
                }
                
                tagList.sort((a,b) => b.conf - a.conf);
                let finalTags = tagList.map(t => t.name);
                
                if (prefix) {
                    const prefixArray = prefix.split(',').map(t => t.trim()).filter(t => t);
                    finalTags = [...prefixArray, ...finalTags.filter(t => !prefixArray.includes(t))];
                }
                
                const finalContent = finalTags.join(', ');
                imgObj.content = finalContent;
                imgObj.type = 'tags';
                imgObj.hasFile = true;
                imgObj.ext = format; 
                
                const fileName = format === 'json' ? baseName + '.json' : baseName + '.txt';
                const contentStr = format === 'json' ? JSON.stringify({ tags: finalContent }, null, 2) : finalContent;
                
                const actualHandle = imgObj.parentDirHandle || targetHandle;
                const fileHandle = await actualHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                const blob = new Blob([contentStr], { type: "text/plain;charset=utf-8" });
                await writable.write(blob);
                await writable.close();
                
                if(window.masterTagSet) finalTags.forEach(t => masterTagSet.add(t));
                if(typeof currentJsonFiles !== 'undefined' && format === 'json') currentJsonFiles.add(fileName);
                
                processed++;
                progressBar.style.width = `${(processed / targetFiles.length) * 100}%`;
                progressText.textContent = `${processed} / ${targetFiles.length} Processed`;
            }
        
        } else if (mode === 'nl-vlm') {
            const promptPrefix = document.getElementById('batch-vlm-prompt').value.trim() || '<MORE_DETAILED_CAPTION>';
            const vlmModelId = document.getElementById('vlm-model-select').value;
            const modelIdLower = vlmModelId.toLowerCase();
            const isFlorence = modelIdLower.includes('florence');
            const isSmolVLM = modelIdLower.includes('smolvlm');
            let processed = 0;

            if (!isFlorence && !isSmolVLM) {
                if(window.showAlert) window.showAlert("Este modelo VLM ainda não está implementado nesta versão.", "error");
                throw new Error("Selected VLM is not yet implemented.");
            }

            const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

            if (!florencePipeline || currentVlmSession !== vlmModelId) {
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
                    if(window.showAlert) window.showAlert(`${vlmModelId.split('/').pop()} carregado com sucesso!`, "success");
                } catch(e) {
                    if (deviceTarget === 'webgpu') {
                        console.warn("WebGPU failed with default config, trying again without graph optimization:", e);
                        try {
                            florencePipeline = await loadModel('webgpu', { graphOptimizationLevel: 'disabled' });
                            currentVlmSession = vlmModelId;
                            if(window.showAlert) window.showAlert("Modelo carregado na GPU (sem otimização de grafo)!", "success");
                        } catch (e2) {
                            console.error("WebGPU falhou mesmo sem otimização de grafo, caindo para CPU WASM:", e2);
                            if(window.showAlert) window.showAlert("WebGPU incompatível com este modelo. Usando CPU WASM.", "warn");
                            florencePipeline = await loadModel('wasm');
                            currentVlmSession = vlmModelId;
                        }
                    } else {
                        throw e;
                    }
                }
            }

            const { load_image } = await import(TRANSFORMERS_CDN);

            for (let idx = 0; idx < targetFiles.length; idx++) {
                if (window.isBatchCancelled) {
                    if(window.showAlert) window.showAlert("Batch process canceled by user.", "info");
                    break;
                }

                const imgObj = targetFiles[idx];
                const baseName = imgObj.baseName || imgObj.name.substring(0, imgObj.name.lastIndexOf('.'));
                let finalContent = "";

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
                    finalContent = parsed[promptPrefix] || "";

                    if (typeof finalContent === 'string' && finalContent.startsWith(promptPrefix)) {
                        finalContent = finalContent.replace(promptPrefix, '').trim();
                    }
                    finalContent = (finalContent || "").trim();

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
                }

                imgObj.content = finalContent;
                imgObj.type = 'nl';
                imgObj.hasFile = true;
                imgObj.ext = format;

                const fileName = format === 'json' ? baseName + '.json' : baseName + '.txt';
                const contentStr = format === 'json' ? JSON.stringify({ caption: finalContent }, null, 2) : finalContent;
                
                const actualHandle = imgObj.parentDirHandle || targetHandle;
                const fileHandle = await actualHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                const blob = new Blob([contentStr], { type: "text/plain;charset=utf-8" });
                await writable.write(blob);
                await writable.close();

                if(typeof currentJsonFiles !== 'undefined' && format === 'json') currentJsonFiles.add(fileName);

                processed++;
                progressBar.style.width = `${(processed / targetFiles.length) * 100}%`;
                progressText.textContent = `${processed} / ${targetFiles.length} Processed`;
            }
        }
        
        if (!window.isBatchCancelled) {
            if(window.showAlert) window.showAlert("Batch processing complete!", "success");
        }
    } catch (e) { 
        console.error(e); 
        if(window.showAlert) window.showAlert("Critical error. Check the console.", 'error'); 
    } finally { 
        btn.disabled = false; 
        if(cancelBtn) cancelBtn.style.display = 'none';

        const dlContainer = document.getElementById('vlm-dl-container');
        if(dlContainer) dlContainer.style.display = 'none'; 

        if(typeof window.refreshDataset === 'function') {
            await window.refreshDataset();
        } else {
            if(window.refreshListStatus) window.refreshListStatus();
            if(window.renderMasterTagList && mode === 'tags') window.renderMasterTagList();
            if(typeof selectedIndices !== 'undefined' && selectedIndices.size > 0 && window.renderEditor) window.renderEditor();
            if(typeof renderGrid === 'function') window.renderGrid();
        }
    }
}