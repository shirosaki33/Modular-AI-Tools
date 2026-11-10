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
    /* Rebuilds a .safetensors file with a new __metadata__ block.
       Layout: [8 bytes: header length, little-endian][JSON header][tensor data].
       The tensor offsets in the header are relative to the start of the data
       section, so only the header changes; the data section is reused as a
       Blob slice (no copy in RAM, even for multi-GB files). */
    window.buildEditedSafetensorsBlob = async function(file, newMeta) {
        const lenBuf = await file.slice(0, 8).arrayBuffer();
        const oldLen = Number(new DataView(lenBuf).getBigUint64(0, true));
        if (!(oldLen > 0) || oldLen > file.size - 8) throw new Error('Invalid safetensors header length');
        const header = JSON.parse(new TextDecoder().decode(await file.slice(8, 8 + oldLen).arrayBuffer()));
        const out = { __metadata__: newMeta };
        for (const [k, v] of Object.entries(header)) if (k !== '__metadata__') out[k] = v;
        const json = new TextEncoder().encode(JSON.stringify(out));
        const pad = (8 - (json.length % 8)) % 8;           // keep the data section 8-byte aligned
        const total = json.length + pad;
        const prefix = new ArrayBuffer(8);
        new DataView(prefix).setBigUint64(0, BigInt(total), true);
        const padding = new Uint8Array(pad).fill(0x20);    // spaces are legal JSON whitespace
        return new Blob([prefix, json, padding, file.slice(8 + oldLen)], { type: 'application/octet-stream' });
    };

    const wrapper = document.createElement('div');
    wrapper.style.cssText = "width:100%; box-sizing:border-box;";
    wrapper.innerHTML =
        '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px;">' +
            '<button type="button" id="metaEdAdd" style="background:#0d1f18;border:1px solid #1a4a30;color:#00cc88;border-radius:6px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer;">+ Add field</button>' +
            '<button type="button" id="metaEdReset" style="background:#1b1b1b;border:1px solid #333;color:#aaa;border-radius:6px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer;">Reset</button>' +
            '<button type="button" id="metaEdSave" style="background:#0d1f18;border:1px solid #1a4a30;color:#00ff99;border-radius:6px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer;margin-left:auto;">Save as new .safetensors ⭳</button>' +
        '</div>' +
        '<div id="metaEdStatus" style="font-size:11px;color:#777;margin-bottom:8px;min-height:14px;"></div>' +
        '<div class="meta-editor-scroll" id="metaEditorContent" style="max-height: 380px; overflow-y: auto; padding-right: 4px; font-size: 12px; color: #777;">Load a file first.</div>' +
        '<div style="font-size:11px;color:#555;margin-top:8px;">The original file is never modified — a copy is downloaded. The copy has a different SHA-256, so Civitai hash lookups for it will no longer match.</div>';
    window.registerToolModule('✏️ Metadata Editor', '#00cc88', wrapper);

    let _orig = {};
    const content = () => document.getElementById('metaEditorContent');
    const status  = (msg, color) => { const s = document.getElementById('metaEdStatus'); if (s) { s.textContent = msg || ''; s.style.color = color || '#777'; } };
    const FIELD_CSS = 'flex:1;min-width:0;background:#111;border:1px solid #2a2a2a;border-radius:5px;color:#e0e0e0;padding:4px 8px;font-size:12px;box-sizing:border-box;font-family:inherit;';

    function makeRow(key, value, isNew) {
        const row = document.createElement('div');
        row.className = 'meta-ed-row';
        row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;width:100%;box-sizing:border-box;';
        let keyEl;
        if (isNew) {
            keyEl = document.createElement('input');
            keyEl.placeholder = 'new_key';
            keyEl.style.cssText = 'flex-shrink:0;width:150px;background:#111;border:1px solid #2a2a2a;border-radius:5px;color:#e0e0e0;padding:4px 8px;font-size:12px;box-sizing:border-box;';
            keyEl.className = 'meta-ed-key';
        } else {
            keyEl = document.createElement('span');
            keyEl.textContent = key; keyEl.title = key;
            keyEl.style.cssText = 'flex-shrink:0;min-width:120px;max-width:160px;color:#666;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-top:5px;';
            row.dataset.key = key;
        }
        // <input> strips line breaks from its value, so multi-line values get a textarea.
        const multi = String(value).includes('\n');
        const field = document.createElement(multi ? 'textarea' : 'input');
        if (multi) field.rows = Math.min(6, String(value).split('\n').length);
        field.value = value;
        field.style.cssText = FIELD_CSS + (multi ? 'resize:vertical;' : '');
        field.className = 'meta-ed-value';
        field.addEventListener('input', () => { row.dataset.dirty = '1'; });
        const del = document.createElement('button');
        del.type = 'button'; del.textContent = '✕'; del.title = 'Remove this field';
        del.style.cssText = 'flex-shrink:0;background:none;border:1px solid #2a2a2a;border-radius:5px;color:#a55;cursor:pointer;padding:3px 8px;font-size:12px;';
        del.addEventListener('click', () => {
            const removed = row.dataset.removed === '1';
            row.dataset.removed = removed ? '' : '1';
            row.style.opacity = removed ? '1' : '0.35';
            field.disabled = !removed;
            del.textContent = removed ? '✕' : '↺';
        });
        row.append(keyEl, field, del);
        if (isNew) row.dataset.dirty = '1';
        return row;
    }

    window.renderMetaEditor = function(meta) {
        const el = content();
        if (!el) return;
        _orig = {};
        for (const [k, v] of Object.entries(meta || {})) _orig[k] = String(v);
        status('');
        el.textContent = '';
        const keys = Object.keys(_orig);
        if (!keys.length) { el.textContent = 'No metadata. Use "+ Add field" to create some.'; el.dataset.empty = '1'; return; }
        el.dataset.empty = '';
        keys.forEach(k => el.appendChild(makeRow(k, _orig[k], false)));
    };

    function collect() {
        const el = content();
        const result = {};
        const seen = new Set();
        for (const row of el.querySelectorAll('.meta-ed-row')) {
            if (row.dataset.removed === '1') continue;
            const isNew = !row.dataset.key;
            const key = isNew ? row.querySelector('.meta-ed-key').value.trim() : row.dataset.key;
            if (!key) continue;                                   // empty new row: ignore
            if (seen.has(key)) throw new Error('Duplicate key: ' + key);
            seen.add(key);
            // Untouched rows keep the exact original string (line breaks included).
            result[key] = (row.dataset.dirty === '1' || isNew) ? row.querySelector('.meta-ed-value').value : _orig[key];
        }
        return result;
    }

    document.getElementById('metaEdAdd').addEventListener('click', () => {
        const el = content();
        if (el.dataset.empty === '1') { el.textContent = ''; el.dataset.empty = ''; }
        const row = makeRow('', '', true);
        el.appendChild(row);
        el.scrollTop = el.scrollHeight;
        row.querySelector('.meta-ed-key').focus();
    });
    document.getElementById('metaEdReset').addEventListener('click', () => { window.renderMetaEditor(_orig); });
    document.getElementById('metaEdSave').addEventListener('click', async () => {
        const file = window.currentFileLocal ? window.currentFileLocal() : null;
        if (!file) { status('Load a .safetensors file first.', '#ff6060'); return; }
        try {
            const newMeta = collect();
            status('Building file…');
            const blob = await window.buildEditedSafetensorsBlob(file, newMeta);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name.replace(/\.safetensors$/i, '') + '_edited.safetensors';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
            status('Saved ' + Object.keys(newMeta).length + ' field(s) to ' + a.download, '#00cc88');
        } catch (e) {
            status('Could not save: ' + (e && e.message ? e.message : e), '#ff6060');
        }
    });
})();
