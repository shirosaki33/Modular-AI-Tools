/* =========================================================================
   ⚙️ SETTINGS LAYOUT + 🧩 FEATURES (Tag Manager)
   ---------------------------------------------------------------------
   1) 🧩 Features group in the ⚙️ menu:
        📌 Pin image        on / off   ('feature-pin-image')   off = no 📌 buttons, no pinned panel
        🖤 B&W / Manga      on / off   ('feature-bw')          off = no 🖤 button
        🎨 Unpack PSD       Default / Unpack only / Hide        (tagmanager_psd.js, 'psd-unpack-mode')
   2) The ⚙️ menu is reorganized in fixed sections (every module used to just
      append its options): General · Image list · Features · Tag Interrogator ·
      Local AI · NL / Caption Rules · Highlights · Notifications · Backup.
      Each section title folds / unfolds it (state remembered in this browser).
      Options injected later by other modules are sorted into their section the
      next time the menu is opened.
   Loads after the other Tag Manager modules.
========================================================================= */
(function () {
    'use strict';

    const ORDER = ['general', 'imagelist', 'folders', 'features', 'interrogator', 'localai', 'nl', 'highlights', 'notifications', 'backup'];
    const FOLD_KEY = 'tm-settings-folded';
    const KEY_PIN = 'feature-pin-image', KEY_BW = 'feature-bw';

    const st = document.createElement('style');
    st.textContent = `
        #settings-dropdown.open { max-height: calc(100vh - 70px); overflow-y: auto; }
        #settings-dropdown { gap: 6px; min-width: 260px; }
        #settings-dropdown .sg-section { display: flex; flex-direction: column; gap: 8px; border: 1px solid #1e2c40; border-radius: 6px; background: #0f1622; }
        #settings-dropdown .sg-head { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; padding: 6px 8px; font-size: 11px; font-weight: bold; color: #4db8ff; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #1e2c40; }
        #settings-dropdown .sg-head:hover { color: #8fd4ff; }
        #settings-dropdown .sg-head .sg-caret { display: inline-block; width: 10px; transition: transform .15s; color: #6a8ab0; }
        #settings-dropdown .sg-section.folded .sg-caret { transform: rotate(-90deg); }
        #settings-dropdown .sg-section.folded .sg-head { border-bottom: none; }
        #settings-dropdown .sg-section.folded .sg-body { display: none; }
        #settings-dropdown .sg-body { display: flex; flex-direction: column; gap: 8px; padding: 2px 10px 10px; }
        #settings-dropdown .sg-body > .settings-group-label,
        #settings-dropdown .sg-body > div > .settings-group-label:first-child { display: none; }
        #settings-dropdown .sg-body hr { display: none; }
        #settings-dropdown .sg-body select { font-size: 12px; }
        body.tm-no-pin .list-pin-btn, body.tm-no-pin .btn-archive-pin, body.tm-no-pin #col-pinned, body.tm-no-pin #resizer-pinned { display: none !important; }
        body.tm-no-bw #btn-grayscale { display: none !important; }
    `;
    document.head.appendChild(st);

    const getS = async (k, d) => { try { return typeof window.getSetting === 'function' ? await window.getSetting(k, d) : d; } catch (e) { return d; } };
    const saveS = (k, v) => { try { if (typeof window.saveSetting === 'function') window.saveSetting(k, v); } catch (e) {} };

    /* ---------- 🧩 FEATURES ---------- */
    function applyPin(on) {
        document.body.classList.toggle('tm-no-pin', !on);
        if (!on && window.pinnedImage && typeof window.unpinImage === 'function') { try { window.unpinImage(); } catch (e) {} }
    }
    function applyBw(on) {
        document.body.classList.toggle('tm-no-bw', !on);
        if (!on) { const m = document.getElementById('modal-bw-convert'); if (m) m.classList.remove('active'); }
    }

    function injectFeatures() {
        const dd = document.getElementById('settings-dropdown');
        if (!dd || document.getElementById('settings-features-group')) return;
        const grp = document.createElement('div');
        grp.id = 'settings-features-group';
        grp.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
        grp.innerHTML = `
            <div class="settings-group-label">🧩 Features</div>
            <label title="📌 on each image of the list + the Pinned panel. Off: the buttons and the panel are hidden (an image pinned now is unpinned)."><input type="checkbox" id="feature-pin-image"> 📌 Pin image</label>
            <label title="🖤 button (B&amp;W / Manga / styles converter) in the Dataset toolbar. Off: the button is hidden."><input type="checkbox" id="feature-bw"> 🖤 B&amp;W / Manga converter</label>
            <label title="What the 🎨 PSD icon does when the folder has .psd / .psb / .xcf files.&#10;Default: opens PSD Import (person crop, unpack, manual).&#10;Unpack only: the icon only unpacks every new PSD as native PNGs, then disappears.&#10;Hide: the function is off (no icon).">🎨 Unpack PSD:
                <select id="feature-psd-mode">
                    <option value="default">Default</option>
                    <option value="unpack">Unpack only</option>
                    <option value="hide">Hide</option>
                </select>
            </label>`;
        dd.appendChild(grp);

        const pin = document.getElementById('feature-pin-image');
        const bw = document.getElementById('feature-bw');
        const psd = document.getElementById('feature-psd-mode');
        pin.onchange = () => { saveS(KEY_PIN, pin.checked); applyPin(pin.checked); };
        bw.onchange = () => { saveS(KEY_BW, bw.checked); applyBw(bw.checked); };
        psd.onchange = () => { if (window.TMPsd && window.TMPsd.setMode) window.TMPsd.setMode(psd.value); };
        (async () => {
            const p = await getS(KEY_PIN, true), b = await getS(KEY_BW, true);
            pin.checked = p !== false; bw.checked = b !== false;
            applyPin(pin.checked); applyBw(bw.checked);
            psd.value = await getS('psd-unpack-mode', 'default');
            if (!['default', 'unpack', 'hide'].includes(psd.value)) psd.value = 'default';
        })();
    }

    /* ---------- LAYOUT ---------- */
    function keyOf(text) {
        const t = String(text || '');
        if (/General/i.test(t)) return 'general';
        if (/Image list/i.test(t)) return 'imagelist';
        if (/Folders/i.test(t)) return 'folders';
        if (/Features/i.test(t)) return 'features';
        if (/Interrogator/i.test(t)) return 'interrogator';
        if (/Local AI/i.test(t)) return 'localai';
        if (/NL \/ Caption|Caption Rules/i.test(t)) return 'nl';
        if (/Highlight/i.test(t)) return 'highlights';
        if (/Notification/i.test(t)) return 'notifications';
        if (/Backup/i.test(t)) return 'backup';
        return 'x-' + t.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
    }
    function readFolded() { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function saveFolded(o) { try { localStorage.setItem(FOLD_KEY, JSON.stringify(o)); } catch (e) {} }

    function sectionFor(dd, key, title) {
        let sec = dd.querySelector(`:scope > .sg-section[data-key="${key}"]`);
        if (sec) return sec;
        sec = document.createElement('div');
        sec.className = 'sg-section';
        sec.dataset.key = key;
        const head = document.createElement('div');
        head.className = 'sg-head';
        head.innerHTML = `<span class="sg-caret">▾</span><span class="sg-title"></span>`;
        head.querySelector('.sg-title').textContent = String(title || key).trim();
        const body = document.createElement('div');
        body.className = 'sg-body';
        sec.appendChild(head); sec.appendChild(body);
        dd.appendChild(sec);
        const folded = readFolded();
        if (folded[key]) sec.classList.add('folded');
        head.onclick = (e) => {
            e.stopPropagation();
            sec.classList.toggle('folded');
            const f = readFolded(); f[key] = sec.classList.contains('folded'); saveFolded(f);
        };
        return sec;
    }

    // insertBefore with a reference that already moved into a section: fall back to append.
    function guardDropdown(dd) {
        if (dd.__sgGuard) return;
        dd.__sgGuard = true;
        const ins = dd.insertBefore.bind(dd);
        dd.insertBefore = function (node, ref) {
            if (ref && ref.parentNode !== dd) return dd.appendChild(node);
            return ins(node, ref);
        };
    }

    function organize() {
        const dd = document.getElementById('settings-dropdown');
        if (!dd) return;
        guardDropdown(dd);
        const loose = Array.from(dd.children).filter(c => !c.classList.contains('sg-section'));
        if (!loose.length) return;
        let cur = null, curTitle = '';
        const buckets = new Map();      // key -> { title, nodes[] }
        loose.forEach(node => {
            if (node.tagName === 'HR') { node.remove(); return; }
            // a group starts at a label, or at a block whose first element is a label
            const fe = node.firstElementChild;
            const label = node.classList.contains('settings-group-label') ? node
                : (fe && fe.classList && fe.classList.contains('settings-group-label') ? fe : null);
            if (label) { cur = keyOf(label.textContent); curTitle = label.textContent; }
            else if (node.id === 'settings-local-ai') { cur = 'localai'; curTitle = '🤖 Local AI'; }
            const k = cur || 'general';
            if (!buckets.has(k)) buckets.set(k, { title: curTitle || '⚙️ General', nodes: [] });
            buckets.get(k).nodes.push(node);
        });
        buckets.forEach((b, k) => {
            const sec = sectionFor(dd, k, b.title);
            const body = sec.querySelector('.sg-body');
            b.nodes.forEach(n => body.appendChild(n));
        });
        // fixed order (unknown sections go before Backup)
        const secs = Array.from(dd.querySelectorAll(':scope > .sg-section'));
        const rank = s => { const i = ORDER.indexOf(s.dataset.key); return i === -1 ? ORDER.indexOf('backup') - 0.5 : i; };
        secs.sort((a, b) => rank(a) - rank(b)).forEach(s => dd.appendChild(s));
    }
    window.tmOrganizeSettings = organize;

    function hookOpen() {
        const btn = document.getElementById('btn-settings');
        if (btn && !btn.__sgHooked) {
            btn.__sgHooked = true;
            btn.addEventListener('click', () => setTimeout(organize, 0), true);
        }
        const orig = window.toggleSettings;
        if (typeof orig === 'function' && !orig.__sg) {
            const w = function () { organize(); return orig.apply(this, arguments); };
            w.__sg = true;
            window.toggleSettings = w;
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        injectFeatures();
        hookOpen();
        setTimeout(organize, 1600);       // after the modules that inject late (notifications ~1.2 s)
        setTimeout(() => { hookOpen(); organize(); }, 3500);
    });
})();
