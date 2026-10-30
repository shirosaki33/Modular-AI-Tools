/* =========================================================================
   PROMPT HELPER — HELP (❓ button in the top bar, same look as the Tag Manager)

   Self-contained: injects its own button, modal and CSS. Add one line to the HTML:
       <script src="tools/prompt_helper_help.js"></script>
   The button goes into #topbar-right (created by "prompt helper.html").
========================================================================= */
(function () {
    'use strict';

    const css = `
        #btn-help { background: none; font-size: 18px; padding: 6px 12px; color: #888; border: 1px solid #333; border-radius: 6px; margin-left: 5px; cursor: pointer; }
        #btn-help:hover { color: #00ff99; border-color: #00ff99; background: none; }
        #phh-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 2000; justify-content: center; align-items: center; backdrop-filter: blur(5px); }
        #phh-overlay.active { display: flex; }
        #phh-modal { background: #1b1b1b; padding: 20px; border-radius: 10px; border: 1px solid #333; width: 760px; max-width: 94vw; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.9); }
        #phh-modal h3 { margin: 0; font-size: 16px; color: #eee; border-bottom: 1px solid #333; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
        #phh-close { background: transparent; border: none; color: #ff4444; font-size: 24px; cursor: pointer; font-weight: bold; line-height: 1; padding: 0; }
        #phh-close:hover { background: transparent; color: #ff8888; }
        #phh-toc { display: flex; flex-wrap: wrap; gap: 6px; }
        #phh-toc button { background: #151515; color: #9ecfff; border: 1px solid #2a3a4e; border-radius: 14px; padding: 4px 10px; font-size: 11px; cursor: pointer; font-weight: bold; }
        #phh-toc button:hover { background: #1a3a5c; color: #fff; }
        #phh-body { font-size: 13px; color: #ccc; line-height: 1.6; max-height: 66vh; overflow-y: auto; padding-right: 6px; }
        #phh-body h4 { margin: 18px 0 6px; font-size: 14px; }
        #phh-body h4:first-child { margin-top: 0; }
        #phh-body h5 { margin: 12px 0 4px; font-size: 13px; color: #eee; }
        #phh-body p { margin: 0 0 10px; }
        #phh-body ul, #phh-body ol { padding-left: 20px; margin: 0 0 12px; }
        #phh-body li { margin-bottom: 6px; }
        #phh-body code { background: #0d0d0d; border: 1px solid #2a2a2a; border-radius: 4px; padding: 1px 5px; color: #ffcc99; font-size: 12px; }
        #phh-body pre { background: #0d0d0d; border: 1px solid #2a2a2a; border-radius: 6px; padding: 10px 12px; margin: 6px 0 12px; overflow-x: auto; color: #b8f0d0; font-size: 12px; line-height: 1.5; }
        #phh-body a { color: #4db8ff; text-decoration: none; }
        #phh-body a:hover { text-decoration: underline; }
        #phh-body .phh-note { background: #0d1f2a; border: 1px solid #144a63; padding: 8px 10px; border-radius: 6px; margin: 0 0 12px; }
        #phh-body .phh-warn { background: #1a1500; border: 1px solid #aa8800; color: #ffcc66; padding: 8px 10px; border-radius: 6px; margin: 0 0 12px; }
        #phh-body table { border-collapse: collapse; width: 100%; margin: 6px 0 12px; font-size: 12px; }
        #phh-body th, #phh-body td { border: 1px solid #2a2a2a; padding: 5px 8px; text-align: left; vertical-align: top; }
        #phh-body th { background: #151515; color: #aaa; }
        #phh-foot { display: flex; justify-content: flex-end; }
        #phh-foot button { background: transparent; border: 1px solid #555; color: #aaa; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; }
        #phh-foot button:hover { background: #333; color: #fff; }
    `;

    const SECTIONS = [
        ['start', 'Start here', '#00ff99', `
            <p>Prompt Helper has three areas: the <b>Tag Lookup</b> panel (left), and three tabs on the right: <b>Google Translate</b>, <b>Ollama Translate</b> and <b>Image → Prompt</b>.</p>
            <h5>Where it runs matters</h5>
            <ul>
                <li><b>Localhost</b> (the <code>Modular AI Tools localhost.bat</code> files, or <code>python server_max.py</code>): everything works, including the <b>PyTorch</b> mode, the shared tag cache, and automatic model discovery in the <code>models/</code> folder.</li>
                <li><b>Online version</b> (GitHub Pages): everything works except PyTorch and the automatic <code>models/</code> search. ONNX models are added with the <b>📁 Set model folder</b> button; WebGPU models are cached by the browser.</li>
                <li><b>Opening the .html directly (<code>file://</code>)</b>: possible, but browsers restrict multi-threading and GPU there, so the image tools are slow. Prefer localhost or the online version.</li>
            </ul>`],
        ['lookup', '🏷️ Tag Lookup', '#4db8ff', `
            <p>Type a tag (for example <code>1girl</code> or <code>blue hair</code>) and press <b>Search</b> or pick one of the suggestions. Danbooru and e621 are searched together; each card shows the post count, the category, aliases and the wiki text.</p>
            <ul>
                <li><b>SFW (e926)</b> on the e621 card switches e621 to its safe-for-work site.</li>
                <li>On localhost the lookup shares its cache with the Tag Manager, so tags you already looked up there appear instantly.</li>
            </ul>`],
        ['google', '🌐 Google Translate', '#4db8ff', `
            <ol>
                <li>Pick <b>I type in</b> and <b>Translate to</b> (⇄ swaps them and also swaps the texts).</li>
                <li>Type or paste the text and press <b>Translate</b> (or <code>Ctrl+Enter</code>).</li>
            </ol>
            <ul>
                <li><b>Fix vocabulary / spelling</b>: asks Google for a spelling suggestion in your language first, then translates the corrected text. <b>Fix only</b> corrects without translating.</li>
                <li><b>Live translate</b>: translates by itself a moment after you stop typing.</li>
                <li><b>Detect language</b> works as the source language.</li>
            </ul>`],
        ['ollama', '🦙 Ollama Translate', '#66ccff', `
            <p>Same idea as the Google tab, but the translation is done by a model running in your own <a href="https://ollama.com" target="_blank">Ollama</a>.</p>
            <ol>
                <li>Install Ollama and pull a model that follows instructions, for example <code>ollama pull qwen2.5</code>, <code>llama3</code>, <code>mistral</code> or <code>gemma2</code>.</li>
                <li>Keep the URL as <code>http://127.0.0.1:11434</code> (change it only if Ollama runs elsewhere), press <b>🔄</b> and choose the model.</li>
                <li>Type the text and press <b>Translate with Ollama</b>.</li>
            </ol>
            <p class="phh-note">If the list stays empty, Ollama is not running or is blocking the page. Start it with the environment variable <code>OLLAMA_ORIGINS=*</code>.</p>`],
        ['image', '🖼️ Image → Prompt', '#b890ff', `
            <p>Turns an image into text you can use as a prompt or caption: tags or a natural-language description.</p>
            <ol>
                <li>Choose the <b>Mode</b> (ONNX tagger, WebGPU or PyTorch — explained below).</li>
                <li>Choose the <b>Model</b>. Markers: <code>✅</code> already on your disk, <code>⬇️</code> will be downloaded on first use, <code>📁</code> local folder, <code>🏷️</code> ONNX tagger.</li>
                <li>Choose the <b>Hardware</b>, drop / click / paste (<code>Ctrl+V</code>) an image, and press <b>Generate prompt</b>. The model loads automatically on first use (or press <b>Load model</b> to prepare it).</li>
                <li>Use <b>📋 Copy</b>, or <b>🌐 Translate</b> to see the result translated in the box right below (nothing is sent to another tab). The language is remembered.</li>
                <li><b>⏏ Unload from memory</b> frees RAM / VRAM (files stay on disk). <b>🧹 Delete downloaded model</b> removes the files the app downloaded (it is dimmed for models the app does not own, such as your own folders).</li>
                <li><b>⏹ Cancel</b> appears while something is running.</li>
            </ol>
            <h5>Controls</h5>
            <table>
                <tr><th>Control</th><th>What it does</th></tr>
                <tr><td>Task</td><td>Florence-2 / PromptGen only: which kind of text to produce (caption, detailed caption, OCR, tags...).</td></tr>
                <tr><td>Prompt</td><td>Chat-style models (SmolVLM and other local vision-language models): the instruction sent with the image.</td></tr>
                <tr><td>Max tokens</td><td>Upper limit for the answer length. Raise it for long tasks (PromptGen mixed captions: 512–1024).</td></tr>
                <tr><td>Beams</td><td>PyTorch only. Higher = slightly better but slower and uses more memory. 3 is a good default.</td></tr>
                <tr><td>Threshold</td><td>Taggers only: minimum confidence for a tag (0.35 default). Lower = more tags, higher = fewer and safer.</td></tr>
                <tr><td>Storage</td><td>WebGPU only: where downloaded files go (Auto, browser cache, or a folder you choose).</td></tr>
            </table>

            <h5>🏷️ ONNX tagger (browser)</h5>
            <p>Runs WD14 / SmilingWolf style taggers directly in the browser with onnxruntime-web — the same method as the Tag Manager's ONNX mode. The result is a comma-separated tag list (the <i>rating</i> category is skipped).</p>
            <ol>
                <li>Download a tagger and its tag list from <a href="https://huggingface.co/SmilingWolf" target="_blank">huggingface.co/SmilingWolf</a>: the <code>model.onnx</code> and the <code>selected_tags.csv</code>.</li>
                <li>Keep them together. Either layout works:
<pre>models/onnx/wd-vit-tagger-v3/model.onnx
models/onnx/wd-vit-tagger-v3/selected_tags.csv

models/onnx/my-tagger.onnx
models/onnx/my-tagger.csv</pre>
                    The CSV is matched in this order: <code>&lt;model name&gt;.csv</code>, <code>&lt;model name&gt;_tags.csv</code>, <code>selected_tags.csv</code>, <code>tags.csv</code>, or the only .csv in the folder.</li>
                <li><b>Localhost:</b> everything inside <code>models/onnx</code> is found automatically. <b>Anywhere:</b> press <b>📁 Set model folder</b> and choose any folder; it is scanned recursively and remembered (Chrome / Edge). If the browser asks again after a restart, the button turns into <b>Reconnect model folder</b>.</li>
                <li>Hardware: <b>WebGPU</b> (fast, falls back to CPU by itself) or <b>CPU (WASM)</b>.</li>
            </ol>

            <h5>🚀 WebGPU (browser)</h5>
            <p>Florence-2 Base and SmolVLM (256M / 500M) run in the browser through Transformers.js. The first load downloads the model from Hugging Face (a few hundred MB); after that it works offline. Where the files go is chosen in <b>Storage</b>: <b>Auto</b> (the <code>models/</code> folder on localhost, the browser cache online), <b>Browser cache</b>, or <b>Choose a folder</b>. WebGPU can be unstable with some drivers — the app then retries without graph optimization and finally on the CPU.</p>

            <h5>🔥 PyTorch / ONNX (local server) — see the next section</h5>`],
        ['pytorch', '🔥 PyTorch in detail', '#ff9966', `
            <h5>What it is</h5>
            <p>In this mode the model does <b>not</b> run in the browser. The page talks to the small Python server (<code>server_max.py</code>, port 8100), which hands the work to <code>florence_backend.py</code>. That script loads the model with <b>PyTorch</b> (GPU through CUDA if you have an NVIDIA card, otherwise CPU), runs it, and sends the text back. Because it uses your own Python, it can run bigger models, <b>Florence-2 PromptGen v2.0</b>, any model saved on your disk, and ONNX taggers through Python. It only exists on localhost: the mode is hidden on the online version.</p>
            <pre>Browser page  ──HTTP──▶  server_max.py  ──▶  florence_backend.py  ──▶  PyTorch / ONNX Runtime ──▶ GPU or CPU
 (localhost:8100)                                              models/ folder (files on disk)</pre>

            <h5>What to install</h5>
            <p>You need <b>Python 3.10 or newer</b>. Use the same Python that starts the server (<code>python --version</code>). Optional but tidy: a virtual environment (<code>python -m venv venv</code>, then activate it) before the installs below. Always install with <code>python -m pip</code> so the packages go to the right Python.</p>
            <table>
                <tr><th>For</th><th>Command</th></tr>
                <tr><td>PyTorch with an NVIDIA GPU</td><td><code>python -m pip install torch --index-url https://download.pytorch.org/whl/cu124</code><br>(example for CUDA 12.4 — copy the exact command for your system from <a href="https://pytorch.org/get-started/locally/" target="_blank">pytorch.org/get-started/locally</a>)</td></tr>
                <tr><td>PyTorch, CPU only</td><td><code>python -m pip install torch</code></td></tr>
                <tr><td>Models and images (required)</td><td><code>python -m pip install transformers pillow huggingface_hub</code></td></tr>
                <tr><td>PromptGen and the <code>microsoft/</code> Florence models</td><td><code>python -m pip install einops timm</code></td></tr>
                <tr><td>Newer native Florence-2 (<code>florence-community/</code>)</td><td><code>python -m pip install -U transformers</code></td></tr>
                <tr><td>ONNX taggers through Python</td><td><code>python -m pip install onnxruntime</code> — or <code>onnxruntime-gpu</code> for CUDA (install only one of the two)</td></tr>
            </table>
            <p>Check the GPU: <code>python -c "import torch; print(torch.__version__, torch.cuda.is_available())"</code> must print <code>True</code> for GPU use. <b>Restart the server</b> after installing anything.</p>
            <p class="phh-note">The badge at the top of the tab tells you the state: <b>🔥 CUDA: &lt;GPU&gt;</b> = GPU ready, <b>🖥️ CPU only</b> = works but slower (a CPU-only PyTorch build, or no NVIDIA GPU), <b>⚠️ PyTorch missing</b> / <b>⚠️ ONNX Runtime missing</b> = install the packages above, <b>⚠️ Server offline</b> = start the page through the .bat file / <code>server_max.py</code> and keep <code>florence_backend.py</code> next to it.</p>

            <h5>Which models it offers</h5>
            <ul>
                <li><b>Florence-2 PromptGen v2.0 (MiaoshouAI) — Base / Large:</b> fine-tuned for image prompts. Tasks: <code>Generate tags</code>, <code>Caption</code>, <code>Detailed caption</code>, <code>More detailed caption</code>, <code>Analyze</code> (composition / shot description), <code>Mixed caption</code> and <code>Mixed caption +</code> (caption and tags together, the most detailed). Use a higher Max tokens (512–1024) for the long ones.</li>
                <li><b>Florence-2 Base / Large FT</b> (<code>florence-community/</code> native, or <code>microsoft/</code> with remote code): Caption, Detailed caption, More detailed caption, OCR and Object labels.</li>
                <li><b>Your own folders:</b> any folder with <code>config.json</code> plus <code>.safetensors</code> or <code>pytorch_model.bin</code>. Florence-2 / PromptGen folders get the right task list; other vision-language models run with the generic loader and the <b>Prompt</b> box.</li>
                <li><b>ONNX taggers</b> (<code>🏷️</code>): the same <code>models/onnx</code> files as the browser mode, executed by Python's onnxruntime (CUDA if <code>onnxruntime-gpu</code> is installed).</li>
            </ul>

            <h5>Where files live and how they are found</h5>
            <ul>
                <li><b>Downloads:</b> models marked <code>⬇️</code> are downloaded on the first <b>Load</b> into <code>models/</code> (Hugging Face cache layout, <code>models--org--name</code>), with a progress bar. After that they load offline.</li>
                <li><b>Automatic search</b> of <code>models/</code>: Hugging Face cache folders, plain model folders (<code>models/my-model</code> or <code>models/org/my-model</code>), and ONNX taggers in <code>models/onnx</code>.</li>
                <li><b>📁 Add model folder:</b> opens a folder dialog on your PC and remembers the folder (stored by the server in <code>local/model_folders.json</code>); it is scanned up to 4 levels deep. If the dialog cannot open, you are asked to type the path. To forget a folder, delete its line from that file.</li>
                <li><b>Delete downloaded model</b> only removes what the app downloaded. Your own folders are never touched.</li>
            </ul>

            <h5>Hardware, speed and memory</h5>
            <ul>
                <li><b>Auto</b> uses CUDA when PyTorch can see it, otherwise the CPU. On the GPU the model runs in half precision (fp16); on the CPU in fp32. If loading on the GPU fails (for example out of VRAM) it retries on the CPU by itself.</li>
                <li>PromptGen and the <code>microsoft/</code> models use the repository's own code with caching turned off for compatibility, so long outputs are slower than with the native models. Large models and many beams need more VRAM.</li>
                <li><b>Unload from memory</b> releases VRAM / RAM. Switching Mode also unloads the previous model.</li>
            </ul>

            <h5>Safety note</h5>
            <p>PromptGen and the <code>microsoft/</code> models need <i>remote code</i> (they run Python from the model repository). For that reason downloads are limited to the repositories <code>microsoft/Florence-2*</code>, <code>florence-community/Florence-2*</code> and <code>MiaoshouAI/Florence-2*</code>. Folders you add yourself are your responsibility: only add folders you trust. Folder changes are only accepted from pages served by your own computer.</p>

            <h5>Troubleshooting</h5>
            <ul>
                <li><b>"PyTorch / transformers not available"</b>: run the install commands above with the same Python the server uses, then restart the server.</li>
                <li><b>Shows CPU only but you have an NVIDIA card</b>: you installed the CPU build of torch. Reinstall it with the CUDA command from pytorch.org.</li>
                <li><b>"No native Florence-2"</b>: run <code>python -m pip install -U transformers</code> or choose a <code>microsoft/</code> / <code>MiaoshouAI/</code> model.</li>
                <li><b>Error mentioning einops or timm</b>: <code>python -m pip install einops timm</code>.</li>
                <li><b>ONNX tagger says "outputs N scores but the CSV lists M tags"</b>: the CSV does not belong to that model.</li>
                <li><b>Download stuck or interrupted</b>: press <b>⏹ Cancel</b>, then load again; finished files are kept.</li>
            </ul>`],
        ['hub', 'Other tools in the hub', '#ffcc66', `
            <ul>
                <li><b>🏷️ Tag Manager:</b> batch auto-caption datasets (ONNX / WebGPU / Ollama), manage comma-separated tags and natural-language descriptions.</li>
                <li><b>🖼️ Gallery Holder:</b> view images next to their JSON sidecars, batch-edit tags and organize datasets.</li>
                <li><b>🕵️ PNG Metadata Reader:</b> read the prompt and settings embedded in AI-generated images.</li>
                <li><b>📋 LoRA Metadata Reader:</b> inspect <code>.safetensors</code> LoRA files (training parameters, base model, dataset info).</li>
                <li><b>📚 Lora Evaluate:</b> browse your local LoRA library, match files to Civitai by hash and inspect training metadata.</li>
                <li><b>🧮 LoRA Calculator:</b> calculate steps, epochs and parameters for training.</li>
            </ul>
            <p>All tools work with your files directly in the browser; nothing is uploaded (the only network calls are the ones you trigger: tag lookup, Google Translate, model downloads).</p>`]
    ];

    function build() {
        if (document.getElementById('phh-overlay')) return;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);

        const toc = SECTIONS.map(([id, title]) => `<button type="button" data-target="phh-${id}">${title}</button>`).join('');
        const body = SECTIONS.map(([id, title, color, html]) =>
            `<h4 id="phh-${id}" style="color:${color};">${title}</h4>${html}`).join('');

        const overlay = document.createElement('div');
        overlay.id = 'phh-overlay';
        overlay.innerHTML = `
            <div id="phh-modal" role="dialog" aria-modal="true" aria-label="Help">
                <h3><span>❓ Help &amp; Instructions</span><button id="phh-close" type="button" title="Close">&times;</button></h3>
                <div id="phh-toc">${toc}</div>
                <div id="phh-body">${body}</div>
                <div id="phh-foot"><button type="button" id="phh-close2">Close</button></div>
            </div>`;
        document.body.appendChild(overlay);

        const close = () => overlay.classList.remove('active');
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        overlay.querySelector('#phh-close').onclick = close;
        overlay.querySelector('#phh-close2').onclick = close;
        overlay.querySelectorAll('#phh-toc button').forEach(b => {
            b.onclick = () => {
                const t = document.getElementById(b.dataset.target);
                if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' });
            };
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('active')) close(); });

        const btn = document.createElement('button');
        btn.id = 'btn-help';
        btn.type = 'button';
        btn.title = 'Help';
        btn.textContent = '❓';
        btn.onclick = () => window.showHelp();
        const holder = document.getElementById('topbar-right') || document.getElementById('topbar');
        if (holder) holder.appendChild(btn);
    }

    window.showHelp = function (section) {
        build();
        document.getElementById('phh-overlay').classList.add('active');
        const body = document.getElementById('phh-body');
        body.scrollTop = 0;
        if (section) { const t = document.getElementById('phh-' + section); if (t) t.scrollIntoView({ block: 'start' }); }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
