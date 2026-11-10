/* ===== merged from lora_meta_tools.js ===== */
(function() {
    const style = document.createElement('style');
    style.innerHTML = `
        .tag-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; width: 100%; box-sizing: border-box; }
        .tag-bar-bg { flex: 1; background: #222; border-radius: 999px; height: 6px; overflow: hidden; min-width: 0; }
        .tag-bar-fill { height: 100%; background: #00cc88; border-radius: 999px; }
        .tag-name { color: #ccc; min-width: 120px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tag-count { color: #555; min-width: 30px; text-align: right; }
    `;
    document.head.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = "width:100%; box-sizing:border-box;";
    wrapper.innerHTML = `<div class="tag-freq-scroll" id="tagFreqContent" style="max-height: 340px; overflow-y: auto; padding-right: 4px; font-size: 12px; color: #777;">No tags detected yet.</div>`;
    window.registerToolModule('📊 Tag Frequency', '#00cc88', wrapper);

    window.renderTagFrequency = function(meta) {
        const el = document.getElementById('tagFreqContent');
        if (!el) return;
        const raw = meta['ss_tag_frequency'] || meta['tag_frequency'];
        if (!raw) { el.textContent = 'No tag frequency data found.'; return; }
        try {
            const obj = JSON.parse(raw);
            const merged = {};
            for (const sub of Object.values(obj)) {
                if (sub && typeof sub === 'object') {
                    for (const [tag, cnt] of Object.entries(sub)) merged[tag] = (merged[tag] || 0) + Number(cnt);
                }
            }
            const sorted = Object.entries(merged).sort((a,b) => b[1]-a[1]).slice(0, 100);
            const max = sorted[0]?.[1] || 1;
            el.innerHTML = sorted.map(([tag, cnt]) =>
                '<div class="tag-row"><span class="tag-name">' + window.escHtml(tag) + '</span><div class="tag-bar-bg"><div class="tag-bar-fill" style="width:' + (cnt/max*100).toFixed(1) + '%"></div></div><span class="tag-count">' + cnt + '</span></div>'
            ).join('');
        } catch { el.textContent = 'Could not parse tag data.'; }
    };
})();

/* ===== merged from lora_meta_tools.js ===== */
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

/* ===== merged from lora_meta_tools.js ===== */
(function() {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = "width:100%; box-sizing:border-box;";
    wrapper.innerHTML = `<div class="meta-editor-scroll" id="metaEditorContent" style="max-height: 380px; overflow-y: auto; padding-right: 4px; font-size: 12px; color: #777;">Load a file first.</div>`;
    window.registerToolModule('✏️ Metadata Editor', '#00cc88', wrapper);

    window.renderMetaEditor = function(meta) {
        const el = document.getElementById('metaEditorContent');
        if (!el) return;
        const keys = Object.keys(meta);
        if (!keys.length) { el.textContent = 'No metadata.'; return; }
        // Previne blowout (min-width: 0)
        el.innerHTML = keys.map(k =>
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;width:100%; box-sizing:border-box;">' +
            '<span style="flex-shrink:0;min-width:120px;max-width:160px;color:#666;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + window.escHtml(k) + '">' + window.escHtml(k) + '</span>' +
            '<input style="flex:1;min-width:0;background:#111;border:1px solid #2a2a2a;border-radius:5px;color:#e0e0e0;padding:4px 8px;font-size:12px;box-sizing:border-box;" value="' + window.escHtml(String(meta[k])) + '" data-key="' + window.escHtml(k) + '">' +
            '</div>').join('');
    };
})();
