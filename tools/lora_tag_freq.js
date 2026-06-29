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