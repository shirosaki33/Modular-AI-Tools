/**
 * tools/lora_ui_widgets.js
 *
 * Consolidação de 2 módulos de UI: galeria de imagens/vídeos do preview
 * e widgets de feedback (banners, status, alerta de sem-internet).
 */

let galleryImages = []; let galleryIndex  = 0; let galleryRenderId = 0;

function resetMediaPreview() {
	galleryRenderId++; galleryImages = []; galleryIndex  = 0;
	const wrap = document.getElementById('imageWrap'), img = document.getElementById('modelImage'), ph = document.getElementById('imagePlaceholder');
	wrap.classList.remove('has-gallery');
	wrap.querySelectorAll('.image-loading, video').forEach(e => e.remove());
	img.onload = null; img.onerror = null; img.style.display = 'none'; img.removeAttribute('src');
	ph.style.display = 'flex';
	document.getElementById('galleryDots').innerHTML = ''; document.getElementById('galleryCounter').textContent = '';
}

function setGallery(urls) {
	if (!Array.isArray(urls) || urls.length === 0) { resetMediaPreview(); return; }
	galleryImages = urls; galleryIndex  = 0; const renderId = ++galleryRenderId;
	const wrap = document.getElementById('imageWrap');
	if (urls.length > 1) wrap.classList.add('has-gallery'); else wrap.classList.remove('has-gallery');
	document.getElementById('galleryDots').innerHTML = urls.map((_, i) => '<span class="gallery-dot' + (i === 0 ? ' active' : '') + '" onclick="galleryGoTo(' + i + ')"></span>').join('');
	renderGalleryFrame(0, renderId);
}

function renderGalleryFrame(idx, renderId = ++galleryRenderId) {
	if (!galleryImages.length || !galleryImages[idx]) { resetMediaPreview(); return; }
	galleryIndex = idx;
	const img = document.getElementById('modelImage'), ph = document.getElementById('imagePlaceholder'), counter = document.getElementById('galleryCounter'), dotsEl = document.getElementById('galleryDots'), wrap = document.getElementById('imageWrap');
	const item = galleryImages[idx], url = typeof item === 'string' ? item : item.url || '';
	if (!url) { resetMediaPreview(); return; }

	ph.style.display = 'none'; img.style.display = 'none'; img.onload = null; img.onerror = null; img.removeAttribute('src');
	wrap.querySelectorAll('.image-loading, video').forEach(e => e.remove());
	const loader = document.createElement('div'); loader.className = 'image-loading'; loader.innerHTML = '<div class="spinner"></div> Loading…'; wrap.appendChild(loader);

	const isVideo = (item.type || '').toLowerCase() === 'video' || (item.mimeType || item.mime || '').toLowerCase().startsWith('video/') || url.toLowerCase().match(/\.(mp4|webm|mov)$/);
	if (isVideo) {
		const vid = document.createElement('video');
		vid.autoplay = true; vid.loop = true; vid.muted = true; vid.playsInline = true; vid.controls = true;
		vid.style.width = '100%'; vid.style.height = '100%'; vid.style.objectFit = 'contain'; vid.style.borderRadius = '8px';
		vid.onloadeddata = () => { if (renderId !== galleryRenderId) return; loader.remove(); };
		vid.onerror = () => { if (renderId !== galleryRenderId) return; loader.remove(); ph.style.display = 'flex'; };
		vid.src = url; wrap.appendChild(vid);
	} else {
		img.onload = () => { if (renderId !== galleryRenderId) return; img.style.display = 'block'; loader.remove(); };
		img.onerror = () => { if (renderId !== galleryRenderId) return; loader.remove(); ph.style.display = 'flex'; };
		img.src = url;
	}
	counter.textContent = (idx + 1) + ' / ' + galleryImages.length;
	dotsEl.querySelectorAll('.gallery-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}

window.galleryStep = function(delta) {
	if (!galleryImages.length) return;
	const next = (galleryIndex + delta + galleryImages.length) % galleryImages.length;
	renderGalleryFrame(next);
};
window.galleryGoTo = function(idx) { renderGalleryFrame(idx); };

// ===================================================================
// Banners, status e feedback de conexão
// ===================================================================

let _bannerTimer = null; let _outdatedTimer = null;

window.showBanner = function(type, msg) {
	const el = document.getElementById('resultBanner'), text = document.getElementById('resultBannerText');
	if (type === true) type = 'found'; if (type === false) type = 'not-found';
	el.className = 'result-banner ' + type; text.textContent = msg;
	if (_bannerTimer) clearTimeout(_bannerTimer); _bannerTimer = setTimeout(() => hideBanner(), 15000);
};
window.hideBanner = function() {
	if (_bannerTimer) { clearTimeout(_bannerTimer); _bannerTimer = null; }
	document.getElementById('resultBanner').className = 'result-banner'; document.getElementById('resultBannerText').textContent = '';
};
window.showOutdatedBanner = function() {
	document.getElementById('outdatedBanner').classList.add('visible');
	if (_outdatedTimer) clearTimeout(_outdatedTimer); _outdatedTimer = setTimeout(() => hideOutdatedBanner(), 15000);
};
window.hideOutdatedBanner = function() {
	if (_outdatedTimer) { clearTimeout(_outdatedTimer); _outdatedTimer = null; }
	document.getElementById('outdatedBanner').classList.remove('visible');
};

function setStatus(type, msg) {
	const el = document.getElementById('civitaiStatus');
	el.className = 'civitai-status ' + (type || ''); el.textContent = msg;
}

window.checkInternet = async function() {
	try {
		const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
		const r = await fetch('https://danbooru.donmai.us/tags.json?search[name]=1girl&limit=1', { signal: ctrl.signal, cache: 'no-store' });
		clearTimeout(t); return r.ok;
	} catch(e) { return false; }
};

window.showOtAlert = function(msg) {
	const bar = document.getElementById('otAlertBar'); bar.textContent = msg; bar.style.display = 'block';
	setTimeout(() => { bar.style.display = 'none'; }, 6000);
};