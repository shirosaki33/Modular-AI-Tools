/**
 * tools/lora_prompt_tools.js
 *
 * Consolidação de 2 módulos: UI de prompts (toggle do card, colapso de
 * textarea, renderPrompts) e o popout de detecção de tags no Danbooru.
 *
 * IMPORTANTE: este arquivo precisa carregar ANTES de tools/danbooru.js —
 * ele expõe window.openDetectPopout/closeDetectPopout que o módulo do
 * Danbooru pode referenciar já na inicialização.
 */

let _cardPromptOpen = true;
function toggleCardPrompt() {
	_cardPromptOpen = !_cardPromptOpen;
	const body = document.getElementById('cardPromptBody');
	const btn  = document.getElementById('cardPromptToggleBtn');
	if (_cardPromptOpen) {
		body.classList.remove('collapsed');
		body.style.maxHeight = body.scrollHeight + 'px';
		btn.textContent = '▲';
	} else {
		body.style.maxHeight = body.scrollHeight + 'px';
		requestAnimationFrame(() => {
			body.classList.add('collapsed');
			body.style.maxHeight = '0px';
		});
		btn.textContent = '▼';
	}
}

window.copyFromArea = function(id, btn) {
	const el = document.getElementById(id);
	if (!el) return;
	navigator.clipboard.writeText(el.value).then(() => {
		const was = btn.textContent;
		btn.classList.add('copied'); btn.textContent = '✓';
		setTimeout(() => { btn.classList.remove('copied'); btn.textContent = was; }, 1400);
	});
};

const HALF_LINES = 4;
function getHalfH(textarea) {
	const cs = window.getComputedStyle(textarea);
	const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
	return Math.round(HALF_LINES * lh + (parseFloat(cs.paddingTop) || 8) + (parseFloat(cs.paddingBottom) || 8) + 2);
}

window.autoResizeTextarea = function(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
window.cycleBlockState = function(wrap, btn) { applyBlockState(wrap, btn, wrap.getAttribute('data-state') === 'half' ? 'full' : 'half', null); };

function applyBlockState(wrap, btn, state, halfH) {
	wrap.setAttribute('data-state', state);
	const ta = wrap.querySelector('textarea');
	if (state === 'full') { wrap.style.maxHeight = (ta ? ta.scrollHeight + 2 : 9999) + 'px'; btn.textContent = '▲'; } 
	else { wrap.style.maxHeight = (halfH || (ta ? getHalfH(ta) : 98)) + 'px'; btn.textContent = '▼'; }
}

window.initBlockCollapse = function(wrap, btn, fullHeight) {
	const ta = wrap.querySelector('textarea');
	const halfH = ta ? getHalfH(ta) : 98;
	wrap.style.setProperty('--half-h', halfH + 'px');
	if (fullHeight > halfH) { btn.classList.add('visible'); applyBlockState(wrap, btn, 'half', halfH); } 
	else { btn.classList.remove('visible'); wrap.style.maxHeight = fullHeight + 'px'; wrap.setAttribute('data-state', 'full'); }
};

function renderPrompts(meta) {
	const section = document.getElementById('promptSection');
	const tfRaw   = findVal(meta, ['ss_tag_frequency','tag_frequency']);
	let hasContent = false;
	if (tfRaw) {
		try {
			const obj = JSON.parse(tfRaw);
			const folders = Object.entries(obj);
			if (folders.length > 0) {
				section.innerHTML = '';
				folders.forEach(([folder, tagMap], idx) => {
					const sorted = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).map(([t]) => t);
					const areaId = 'promptArea_' + idx, wrapId = 'promptWrap_' + idx, btnId = 'promptBtn_' + idx;
					const block = document.createElement('div');
					block.className = 'prompt-block';
					block.innerHTML =
						'<div class="promptBox"><span class="prompt-label">📁 ' + window.escHtml(folder) + '</span><button class="copy-btn" title="Copy" onclick="copyFromArea(\'' + areaId + '\',this)">⧉</button></div>' +
						'<div class="prompt-ta-wrap" id="' + wrapId + '" data-state="full"><textarea class="promptArea" id="' + areaId + '">' + window.escHtml(sorted.join(', ')) + '</textarea></div>' +
						'<button class="prompt-block-toggle" id="' + btnId + '" onclick="cycleBlockState(document.getElementById(\'' + wrapId + '\'),this)">▼</button>';
					section.appendChild(block);
					requestAnimationFrame(() => {
						const ta = document.getElementById(areaId), wrap = document.getElementById(wrapId), btn = document.getElementById(btnId);
						if (ta && wrap && btn) { window.autoResizeTextarea(ta); requestAnimationFrame(() => window.initBlockCollapse(wrap, btn, ta.scrollHeight + 18)); }
					});
				});
				hasContent = true;
			}
		} catch { }
	}

	if (!hasContent) {
		const prompt = findVal(meta, ['activation_text','activation_tag','instance_prompt_text','trigger_word','trigger_phrase','training_prompt','prompt']);
		const areaId = 'positiveText', wrapId = 'promptWrap_0', btnId  = 'promptBtn_0';
		section.innerHTML =
			'<div class="prompt-block"><div class="promptBox"><span class="prompt-label">Prompt</span><button class="copy-btn" onclick="copyFromArea(\'' + areaId + '\',this)" title="Copy">⧉</button></div>' +
			'<div class="prompt-ta-wrap" id="' + wrapId + '" data-state="full"><textarea class="promptArea" id="' + areaId + '" placeholder="No prompt data found in metadata…">' + window.escHtml(prompt || '') + '</textarea></div>' +
			'<button class="prompt-block-toggle" id="' + btnId + '" onclick="cycleBlockState(document.getElementById(\'' + wrapId + '\'),this)">▼</button></div>';
		requestAnimationFrame(() => {
			const ta = document.getElementById(areaId), wrap = document.getElementById(wrapId), btn = document.getElementById(btnId);
			if (ta && wrap && btn) { window.autoResizeTextarea(ta); requestAnimationFrame(() => window.initBlockCollapse(wrap, btn, ta.scrollHeight + 18)); }
		});
	}
}

// ===================================================================
// Popout de detecção de tags Danbooru
// ===================================================================

const DANBOORU_CAT = { 0: { label: 'General', color: '#aaa' }, 1: { label: 'Artist', color: '#f9a825' }, 3: { label: 'Copyright', color: '#ae80ff' }, 4: { label: 'Character', color: '#5bc0de' }, 5: { label: 'Meta', color: '#888' } };
window.DANBOORU_CAT = DANBOORU_CAT;

window.openDetectPopout = async function() {
	const overlay = document.getElementById('detectOverlay'), body = document.getElementById('detectPopoutBody'), filterRow = document.getElementById('detectFilterRow');
	overlay.classList.add('open');
	body.innerHTML = '<div class="detect-popout-empty">🔎 Scanning LoRA training tags…</div>'; filterRow.innerHTML = '';
	const rawTags = extractTagsFromMeta();
	if (rawTags.length === 0) { body.innerHTML = '<div class="detect-popout-empty">No training tags found. Load a LoRA first.</div>'; return; }
	const unique = [...new Set(rawTags.map(t => t.toLowerCase().replace(/ /g,'_')))].slice(0, 200);
	let found = [];
	try {
		const chunkSize = 30;
		for (let i = 0; i < unique.length; i += chunkSize) {
			const chunk = unique.slice(i, i + chunkSize);
			const query = chunk.map(t => 'search[name_array][]=' + encodeURIComponent(t)).join('&');
			const res = await fetch('https://danbooru.donmai.us/tags.json?' + query + '&limit=' + chunkSize);
			if (res.ok) found = found.concat(await res.json());
		}
	} catch(e) { body.innerHTML = '<div class="detect-popout-empty" style="color:#f66">Network error. Check your connection.</div>'; return; }
	found.sort((a,b) => b.post_count - a.post_count);
	renderDetectPopout(found, null);
};

function extractTagsFromMeta() {
	const tfRaw = findVal(currentMeta || {}, ['ss_tag_frequency','tag_frequency']);
	if (!tfRaw) return [];
	try { const obj = JSON.parse(tfRaw); const tags = []; for (const sub of Object.values(obj)) { if (sub && typeof sub === 'object') { for (const tag of Object.keys(sub)) tags.push(tag); } } return tags; } catch { return []; }
}

window.renderDetectPopout = function(tags, filterCat) {
	const body = document.getElementById('detectPopoutBody'), filterRow = document.getElementById('detectFilterRow');
	const cats = {}; tags.forEach(t => { cats[t.category] = (cats[t.category]||0)+1; });
	filterRow.innerHTML = '';
	const allBtn = document.createElement('button'); allBtn.className = 'detect-filter-btn' + (filterCat===null?' active':''); allBtn.textContent = 'All'; allBtn.onclick = () => window.renderDetectPopout(tags, null);
	filterRow.appendChild(allBtn);
	Object.entries(cats).sort((a,b)=>a[0]-b[0]).forEach(([cat, count]) => {
		const info = DANBOORU_CAT[cat] || { label: 'Other', color: '#888' };
		const btn = document.createElement('button'); btn.className = 'detect-filter-btn' + (filterCat==cat?' active':''); btn.style.color = info.color; btn.textContent = info.label + ' (' + count + ')'; btn.onclick = () => window.renderDetectPopout(tags, parseInt(cat));
		filterRow.appendChild(btn);
	});
	const filtered = filterCat === null ? tags : tags.filter(t => t.category == filterCat);
	if (filtered.length === 0) { body.innerHTML = '<div class="detect-popout-empty">No Danbooru tags found in LoRA training data.</div>'; return; }
	body.innerHTML = '';
	filtered.forEach(t => {
		const info = DANBOORU_CAT[t.category] || { label: '', color: '#888' };
		const item = document.createElement('div'); item.className = 'detect-tag-item';
		item.innerHTML = '<span class="detect-tag-dot" style="background:' + info.color + '"></span><span class="detect-tag-label">' + t.name.replace(/_/g,' ') + '</span><span class="detect-tag-count">' + Number(t.post_count).toLocaleString() + ' posts</span>';
		item.onclick = () => { if(document.getElementById('danbooruInput')) document.getElementById('danbooruInput').value = t.name; window.closeDetectPopout(); if(window.danbooruSearch) window.danbooruSearch(t.name); };
		body.appendChild(item);
	});
};

window.closeDetectPopout = function(e) { if (e && e.target !== document.getElementById('detectOverlay')) return; document.getElementById('detectOverlay').classList.remove('open'); };