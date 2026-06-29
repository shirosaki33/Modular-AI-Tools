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