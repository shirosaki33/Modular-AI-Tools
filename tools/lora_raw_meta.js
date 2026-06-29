(function() {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = "width:100%; box-sizing:border-box;";
    wrapper.innerHTML = `
        <button class="raw-export-btn" onclick="window.exportRawTxtLocal()" style="background: #0d1f18; border: 1px solid #1a4a30; color: #00cc88; border-radius: 6px; padding: 6px 12px; font-size: 11px; font-weight: 600; cursor: pointer; margin-bottom: 10px; transition: 0.15s;">Export TXT</button>
        <div class="meta-raw" id="metaRaw" style="background: #0a0a0a; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 11px; color: #777; max-height: 340px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;">Load a .safetensors file to see raw metadata.</div>
    `;
    window.registerToolModule('🗂 Raw Metadata', '#00cc88', wrapper);

    window.renderMetaRaw = function(meta) {
        const el = document.getElementById('metaRaw');
        if (el) el.textContent = JSON.stringify(meta, null, 2);
    };

    window.exportRawTxtLocal = function() {
        const meta = window.currentMetaLocal ? window.currentMetaLocal() : {};
        if (!Object.keys(meta).length) { alert('Load a .safetensors file first.'); return; }
        const rawText = JSON.stringify(meta, null, 2);
        const blob = new Blob([rawText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fn = window.currentLoraNameLocal ? window.currentLoraNameLocal() : 'lora_metadata';
        a.download = fn.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) + '_raw_metadata.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    };
})();