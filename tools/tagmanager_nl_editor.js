/* =========================================================================
   NATURAL LANGUAGE (NL) EDITOR MODULE
   Exclusive for plain text, Native Translation, and Gemini correction.
========================================================================= */

const nlStyle = document.createElement('style');
nlStyle.innerHTML = `
    .nl-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; background: #151515; padding: 10px; border-radius: 8px; border: 1px solid #222; align-items: center;}
    .btn-nl { background: #1a3a5c; color: #4db8ff; border: 1px solid #2a5a8c; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; transition: 0.1s;}
    .btn-nl:hover { background: #4db8ff; color: #000; }
    .btn-gemini { background: #2f1a5c; color: #b890ff; border: 1px solid #4a2a8c; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 12px; transition: 0.1s;}
    .btn-gemini:hover { background: #b890ff; color: #000; }
    .toolbar-divider { width: 1px; height: 24px; background: #333; margin: 0 4px; }
`;
document.head.appendChild(nlStyle);

let nlToolbarInitialized = false;

function initNLToolbar() {
    if(nlToolbarInitialized) return;
    const container = document.getElementById('nl-editor-container');
    const ta = document.getElementById('nl-textarea');
    
    const toolbar = document.createElement('div');
    toolbar.className = 'nl-toolbar';
    toolbar.innerHTML = `
        <div style="display:flex; gap:8px;">
            <button class="btn-nl" onclick="translateNL('en')">🌐 Translate (EN-US)</button>
            <button class="btn-nl" onclick="customTranslateNL()">🌐 Translate to...</button>
        </div>
        <div class="toolbar-divider"></div>
        <div style="display:flex; gap:8px; margin-left: auto;">
            <button class="btn-gemini" onclick="triggerGeminiFix('en-US')">✨ Gemini (EN-US)</button>
            <button class="btn-gemini" onclick="customGeminiFix()">✨ Gemini to...</button>
        </div>
    `;
    container.insertBefore(toolbar, ta);
    nlToolbarInitialized = true;
}

// === NATIVE TRANSLATION VIA PUBLIC GOOGLE API ===
window.translateNL = async function(targetLang) {
    const ta = document.getElementById('nl-textarea');
    const originalText = ta.value.trim();
    if(!originalText) return;

    const backup = ta.value;
    ta.value = "🌐 Translating...";

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(originalText)}`;
        const res = await fetch(url);
        const data = await res.json();
        
        let translated = "";
        if(data && data[0]) {
            data[0].forEach(part => { if(part[0]) translated += part[0]; });
        }
        
        ta.value = translated;
        ta.onchange(); // Triggers auto-save
        if(window.showAlert) showAlert(`Translated to ${targetLang.toUpperCase()}!`, "success");
    } catch(e) {
        ta.value = backup;
        if(window.showAlert) showAlert("Error translating. Check your connection.", "error");
    }
};

window.customTranslateNL = function() {
    const lang = prompt("Enter the target language code (e.g., pt, es, fr, ja, en):", "pt");
    if(lang) translateNL(lang.trim().toLowerCase());
};

// === MAIN NL MODE ROUTER ===
window.renderNLEditor = function(imgObj) {
    initNLToolbar();
    const nlTextArea = document.getElementById('nl-textarea');
    nlTextArea.onchange = null; 
    nlTextArea.value = selectedIndices.size > 1 ? "< Multiple NL images selected. >" : imgObj.content;
    
    nlTextArea.onchange = () => {
        selectedIndices.forEach(idx => { 
            imageFiles[idx].content = nlTextArea.value; 
            imageFiles[idx].hasFile = true; 
            imageFiles[idx].type = 'nl'; 
            if(!imageFiles[idx].ext) imageFiles[idx].ext = document.getElementById('topbar-save-format').value;
        });
        if(typeof refreshListStatus === 'function') refreshListStatus(); 
    };
};

// === GEMINI INTEGRATION ===
window.customGeminiFix = function() {
    const lang = prompt("Enter the target language code for Gemini (e.g., pt-BR, es, ja, en-US):", "en-US");
    if(lang) triggerGeminiFix(lang.trim());
};

window.triggerGeminiFix = async function(targetLang) {
    const ta = document.getElementById('nl-textarea');
    const originalText = ta.value.trim();
    if(!originalText) return;

    const backup = ta.value;
    ta.value = "✨ Processing in Gemini... please wait.";

    try {
        /* === GEMINI API SKELETON === */
        /*
        const API_KEY = 'YOUR_KEY_HERE_IN_THE_FUTURE';
        
        // Strict instruction injecting the desired language
        const prompt = \`Fix the grammar, spelling, and phrasing of the following text. Translate it to \${targetLang}. Return ONLY the final corrected text in \${targetLang}, without any markdown, quotes, explanations, or conversational filler:\\n\\n\` + originalText;
        
        const response = await fetch(\`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=\${API_KEY}\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        const corrected = data.candidates[0].content.parts[0].text.trim();
        ta.value = corrected;
        */

        // Simulation while API key is not set
        setTimeout(() => {
            ta.value = originalText + ` (Simulation: Grammar corrected and forced to ${targetLang}!)`;
            ta.onchange(); 
            if(window.showAlert) showAlert(`Processed by Gemini in ${targetLang}!`, "success");
        }, 1200);

    } catch (e) {
        ta.value = backup;
        if(window.showAlert) showAlert("Error connecting to Gemini.", "error");
    }
}