/**
 * tools/lora_meta_reader.js
 *
 * Consolidação de 3 módulos (antes separados em arquivos menores, o que deu
 * risco de erro por arquivo faltando/typo): resolução de campos de metadados,
 * detecção de data/duração de treino e o preenchimento dos cards de Model Data.
 *
 * Esta é a peça que efetivamente LÊ e INTERPRETA os metadados do .safetensors
 * — se algo aparecer errado na tela (epoch, steps, timing, etc.), é aqui que
 * se mexe.
 */


const FIELDS = {
	'v-prediction_type':            ['modelspec.prediction_type','ss_v_pred_model','ss_prediction_type','prediction_type','v_parameterization'],
	'v-batch_size':                 ['ss_batch_size_per_device','ss_total_batch_size','train_batch_size','batch_size'],
	'v-gradient_accumulation_steps':['ss_gradient_accumulation_steps','gradient_accumulation_steps'],
	'v-resolution':                 ['ss_resolution','resolution'],
	'v-clip_skip':                  ['ss_clip_skip','clip_skip'],
	'v-epoch':                      ['ss_epoch','ss_num_train_epochs','num_train_epochs'],
	'v-steps':                      ['ss_steps','ss_max_train_steps','max_train_steps'],
	'v-network_module':             ['ss_network_module','network_module'],
	'v-network_args_algo':          ['ss_network_args','network_args'],
	'v-network_dropout':            ['ss_network_dropout','network_dropout'],
	'v-ip_noise_gamma':             ['ss_ip_noise_gamma','ip_noise_gamma'],
	'v-optimizer_type':             ['ss_optimizer','ss_optimizer_type','optimizer_type'],
	'v-lr_scheduler':               ['ss_lr_scheduler','lr_scheduler'],
	'v-learning_rate':              ['ss_learning_rate','learning_rate'],
	'v-text_encoder_lr':            ['ss_text_encoder_lr','text_encoder_lr'],
	'v-unet_lr':                    ['ss_unet_lr','unet_lr'],
	'v-optimizer_args':             ['ss_optimizer_args','optimizer_args'],
	'v-min_snr_gamma':              ['ss_min_snr_gamma','min_snr_gamma'],
	'v-lr_warmup_steps':            ['ss_lr_warmup_steps','lr_warmup_steps'],
	'v-noise_offset':               ['ss_noise_offset','noise_offset'],
	'v-pyramid_noise_iterations':   ['ss_multires_noise_iterations','ss_pyramid_noise_iterations','pyramid_noise_iterations'],
	'v-pyramid_noise_discount':     ['ss_multires_noise_discount','ss_pyramid_noise_discount','pyramid_noise_discount'],
};
const JOIN_FIELDS = {
	'v-dim_alpha':     [['ss_network_dim','network_dim'],   ['ss_network_alpha','network_alpha']],
	'v-conv_dim_alpha':[['ss_conv_dim','conv_dim'],         ['ss_conv_alpha','conv_alpha']],
};
function findVal(meta, keys) {
	for (const k of keys) {
		if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') return String(meta[k]);
	}
	return null;
}
window.escHtml = function(s) {
	return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};

function parseJsonMeta(raw) {
	if (!raw || raw === 'None' || raw === 'null') return null;
	try { return JSON.parse(raw); } catch { try { return JSON.parse(String(raw).replace(/'/g, '"')); } catch { return null; } }
}

// Trainers conhecidos (ordem importa: mais específicos primeiro). Casam contra o texto de TODO o metadata em minúsculas.
const TOOL_SIGNATURES = [
	['EasyLoRA',             /lora[-_\s]?easy|lora_easy_training_scripts|easy[-_\s]?lora|loraeasy/],
	['ai-toolkit',           /ai[-_\s]?toolkit|ostris\/ai-toolkit/],
	['OneTrainer',           /one[-_\s]?trainer/],
	['SimpleTuner',          /simple[-_\s]?tuner/],
	['Musubi Tuner',         /musubi/],
	['FluxGym',              /flux\s*gym|fluxgym/],
	['EveryDream',           /everydream/],
	['diffusion-pipe',       /diffusion[-_\s]?pipe/],
	['DiffSynth-Studio',     /diffsynth/],
	['finetrainers',         /finetrainers/],
	['ComfyUI-FluxTrainer',  /comfyui[-_\s]?fluxtrainer|flux[-_\s]?trainer/],
	['SD-Trainer',           /akegarasu|sd[-_\s]?trainer/],
	['AutoTrain',            /autotrain/],
	['Citron Trainer',       /citron|lora_anima|anima-preview|circlestone-labs\/anima/]
];

// Plataformas/serviços de treino online (campo "Source").
const PLATFORM_SIGNATURES = [
	['Civitai Spine Controller', /civitai\s+spine\s+controller/],
	['ModelScope / MuseAI',      /model\s?scope|muse\s?ai|魔搭/],
	['TensorArt',                /tensor[._\s-]?art/],
	['SeaArt',                   /sea[._\s-]?art/],
	['LiblibAI',                 /liblib/],
	['Shakker',                  /shakker/],
	['fal.ai',                   /fal[._-]ai/],
	['Civitai',                  /civitai/],
	['Hugging Face',             /hugging\s*face|huggingface/]
];
const GENERIC_PLATFORMS = ['Civitai', 'Hugging Face'];

const TOOL_REPOS = {
	'ai-toolkit': 'https://github.com/ostris/ai-toolkit',
	'easylora': 'https://github.com/derrian-distro/LoRA_Easy_Training_Scripts',
	'kohya / sd-scripts': 'https://github.com/kohya-ss/sd-scripts',
	'onetrainer': 'https://github.com/Nerogar/OneTrainer',
	'simpletuner': 'https://github.com/bghira/SimpleTuner',
	'musubi tuner': 'https://github.com/kohya-ss/musubi-tuner',
	'fluxgym': 'https://github.com/fluxgym/fluxgym',
	'everydream': 'https://github.com/victorchall/EveryDream2trainer',
	'citron trainer': 'https://github.com/citronlegacy/citron-anima-lora-trainer-ui',
	'diffusion-pipe': 'https://github.com/tdrussell/diffusion-pipe',
	'diffsynth-studio': 'https://github.com/modelscope/DiffSynth-Studio',
	'finetrainers': 'https://github.com/huggingface/finetrainers',
	'comfyui-fluxtrainer': 'https://github.com/kijai/ComfyUI-FluxTrainer',
	'sd-trainer': 'https://github.com/Akegarasu/lora-scripts',
	'autotrain': 'https://github.com/huggingface/autotrain-advanced',
	'diffusers': 'https://github.com/huggingface/diffusers'
};

function normalizeSoftwareName(name) {
	const raw = String(name || '').trim(), low = raw.toLowerCase();
	const hit = TOOL_SIGNATURES.find(([, rx]) => rx.test(low));
	if (hit) return hit[0];
	if (/sd[-_\s]?scripts[-_\s]?compatible/.test(low)) return 'sd-scripts compatible metadata';
	if (/sd[-_\s]?scripts|kohya/.test(low)) return 'kohya / sd-scripts';
	if (/diffusers/.test(low)) return 'Diffusers';
	return raw;
}

function knownTrainingToolRepo(label, rawRepo = '') {
	const repo = String(rawRepo || '').trim();
	if (/^https?:\/\/github\.com\//i.test(repo)) return repo;
	return TOOL_REPOS[String(label || '').toLowerCase()] || '';
}

function normalizeTrainingSource(source) {
	const s = String(source || '').trim();
	if (!s || s === 'None' || s === 'null') return '';
	const hit = PLATFORM_SIGNATURES.find(([, rx]) => rx.test(s.toLowerCase()));
	if (hit) return hit[0];
	return /local/i.test(s) ? 'Local' : s;
}

function detectTrainingSource(meta, searchable = '') {
	const direct = findVal(meta, ['training_source', 'source', 'platform', 'training_platform', 'ss_training_source', 'modelspec.source', 'modelspec.source_platform']);
	const notes = findVal(meta, ['notes','ss_training_comment','training_comment','comment']) || '';
	const haystack = (String(notes) + '\n' + String(direct || '') + '\n' + String(searchable || '')).toLowerCase();
	const strong = PLATFORM_SIGNATURES.find(([n, rx]) => !GENERIC_PLATFORMS.includes(n) && rx.test(haystack));
	if (strong) return strong[0];
	if (/civitai/.test(haystack) && /(training|trainer|spine|job|via)/.test(haystack)) return 'Civitai';
	return normalizeTrainingSource(direct);
}

function makeTrainingToolInfo(label, version = '', repo = '', source = '') {
	label = normalizeSoftwareName(label);
	version = String(version || '').trim();
	return { label, version, repo: knownTrainingToolRepo(label, repo), source: normalizeTrainingSource(source) };
}

function detectSystemInfo(meta) {
	const searchable = Object.entries(meta || {}).map(([k, v]) => k + ': ' + v).join('\n');
	const source = detectTrainingSource(meta, searchable);
	const low = searchable.toLowerCase();

	const softwareRaw = findVal(meta, ['software','ss_software','training_software','trainer','tool']);
	const software = parseJsonMeta(softwareRaw);
	if (software && typeof software === 'object') {
		const name = software.name || software.tool || software.software || software.package;
		const version = software.version || software.ver || software.release;
		const repo = software.repo || software.repository || software.url || '';
		let label = name ? normalizeSoftwareName(name) : null;
		if (!label && repo) label = normalizeSoftwareName(repo.split('/').filter(Boolean).pop() || repo);
		if (label) return makeTrainingToolInfo(label, version, repo, source);
	} else if (softwareRaw) {
		const label = normalizeSoftwareName(softwareRaw);
		if (label) return makeTrainingToolInfo(label, '', '', source);
	}

	const hit = TOOL_SIGNATURES.find(([, rx]) => rx.test(low));
	if (hit) return makeTrainingToolInfo(hit[0], '', '', source);

	if (meta['ss_sd_scripts_commit_hash'] || /sd[-_\s]?scripts|kohya[-_\s]?ss|github\.com\/kohya-ss\/sd-scripts|\bkohya\b/.test(low)) return makeTrainingToolInfo('kohya / sd-scripts', '', '', source);

	const ssKeyCount = Object.keys(meta || {}).filter(k => /^ss_/.test(k)).length;
	if (ssKeyCount >= 8 && (meta['ss_network_module'] || meta['ss_tag_frequency'] || meta['ss_datasets'])) {
		return makeTrainingToolInfo('sd-scripts compatible metadata', '', '', source);
	}
	if (/diffusers/i.test(findVal(meta, ['modelspec.implementation','implementation','pipeline','library']) || '')) return makeTrainingToolInfo('Diffusers', '', '', source);

	if (source) return makeTrainingToolInfo(source, '', '', '');
	return null;
}

function setSystemCardsVisibility(showTool, showSource) {
	const container = document.querySelector('.system-container');
	const toolCard = document.getElementById('v-system_tool')?.closest('.system-card');
	const sourceCard = document.getElementById('v-system_source')?.closest('.system-card');
	if (!container || !toolCard || !sourceCard) return;

	toolCard.classList.toggle('hidden', !showTool);
	sourceCard.classList.toggle('hidden', !showSource);
	container.classList.toggle('hidden', !showTool && !showSource);
	container.classList.toggle('single', (showTool && !showSource) || (!showTool && showSource));
}

function setSystemInfo(info) {
	const toolEl = document.getElementById('v-system_tool');
	const sourceEl = document.getElementById('v-system_source');
	if (!toolEl || !sourceEl) return;

	const setEmpty = (el) => { el.textContent = '—'; el.classList.add('empty'); };
	setEmpty(toolEl); setEmpty(sourceEl); setSystemCardsVisibility(false, false);
	if (!info) return;

	const hasTool = !!(info.label && String(info.label).trim());
	const hasSource = !!(info.source && String(info.source).trim() && (!hasTool || info.source.toLowerCase() !== info.label.toLowerCase()));
	if (hasTool) {
		toolEl.textContent = '';
		toolEl.classList.remove('empty');
		const text = info.label + (info.version ? ' ' + info.version : '');
		if (info.repo) {
			const a = document.createElement('a'); a.href = info.repo; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = text + ' ↗'; toolEl.appendChild(a);
		} else {
			const nameSpan = document.createElement('span'); nameSpan.textContent = text; toolEl.appendChild(nameSpan);
		}
	}
	if (hasSource) { sourceEl.textContent = info.source; sourceEl.classList.remove('empty'); }
	setSystemCardsVisibility(hasTool, hasSource);
}

function resolvePredictionType(meta) {
	const direct = findVal(meta, ['modelspec.prediction_type','ss_prediction_type','prediction_type']);
	if (direct) return direct;
	const vpred = findVal(meta, ['ss_v_pred_model','v_parameterization','v_pred']);
	if (vpred && (vpred === '1' || vpred === 'true' || vpred === 'True')) return 'v_prediction';
	return 'epsilon';
}

function resolveBatch(meta) {
	const direct = ['ss_batch_size_per_device', 'ss_total_batch_size', 'train_batch_size', 'batch_size', 'per_device_train_batch_size'];
	for (const k of direct) {
		const v = meta[k];
		if (v !== undefined && v !== null && v !== '' && v !== 'null' && v !== 'None') return String(v);
	}
	if (meta.ss_datasets && Array.isArray(meta.ss_datasets)) {
		const ds = meta.ss_datasets[0];
		if (ds?.batch_size_per_device) return String(ds.batch_size_per_device);
	}
	const numBatches = meta['ss_num_batches_per_epoch'];
	if (numBatches) {
		let imgCount = 0;
		const ni = meta['ss_num_train_images'];
		if (ni) imgCount = parseInt(ni);
		const nb = parseInt(numBatches);
		if (imgCount > 0 && nb > 0) return String(Math.round(imgCount / nb));
	}
	return null;
}

function resolveResolution(meta) {
	const keys = ['modelspec.resolution', 'ss_resolution', 'resolution', 'image_size', 'train_resolution'];
	let raw = null;
	for (const k of keys) {
		const v = meta[k];
		if (v !== undefined && v !== null && v !== '' && v !== 'null' && v !== 'None') { raw = String(v); break; }
	}
	if (!raw && meta.ss_datasets && Array.isArray(meta.ss_datasets) && meta.ss_datasets[0]?.resolution) {
		const r = meta.ss_datasets[0].resolution;
		raw = Array.isArray(r) ? r.join('x') : String(r);
	}
	if (!raw) return null;
	const mX = raw.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
	if (mX) return mX[1] + 'x' + mX[2];
	const mT = raw.match(/(\d+)\D+(\d+)/);
	if (mT) return mT[1] + 'x' + mT[2];
	const mS = raw.match(/^(\d+)$/);
	if (mS) return mS[1] + 'x' + mS[1];
	return raw;
}

function parseDatasetDirs(raw) {
	try {
		const obj = JSON.parse(raw);
		let totalImgs = 0;
		const entries = Object.entries(obj).map(([name, info]) => {
			const repeats  = info.n_repeats || info.repeats || extractRepeatsFromName(name) || null;
			const imgCount = info.img_count || info.num_images || extractImgCountFromName(name) || 0;
			totalImgs += imgCount;
			const label = formatDatasetLabel(name, repeats, imgCount);
			return { label, imgCount };
		});
		return { entries, totalImgs };
	} catch {
		return { entries: [{ label: raw, imgCount: 0 }], totalImgs: 0 };
	}
}

function extractRepeatsFromName(name) { const m = name.match(/^(\d+)_/); return m ? parseInt(m[1]) : null; }
function extractImgCountFromName(name) { const m = name.match(/\((\d+)\)\s*$/); return m ? parseInt(m[1]) : 0; }
function formatDatasetLabel(name, repeats, imgCount) {
	const cleanName = name.replace(/^\d+_/, '');
	let label = '';
	if (repeats !== null) label += repeats + '_';
	label += cleanName;
	if (imgCount > 0) label += ' • (' + imgCount + ')';
	return label;
}

function sanitizeCivitaiDesc(raw) {
	if (!raw) return '';
	const allowed = { A: ['href', 'target'], P: [], BR: [], STRONG: [], B: [], EM: [], I: [], U: [], S: [], H1: [], H2: [], H3: [], H4: [], UL: [], OL: [], LI: [], SPAN: [], DIV: [], BLOCKQUOTE: [] };
	const tmp = document.createElement('div'); tmp.innerHTML = raw;
	tmp.querySelectorAll('img').forEach(img => { const badge = document.createElement('span'); badge.className = 'img-placeholder'; badge.textContent = '[img]'; img.replaceWith(badge); });
	function sanitizeNode(node) {
		if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();
		if (node.nodeType !== Node.ELEMENT_NODE) return null;
		const tag = node.tagName.toUpperCase();
		if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT') return null;
		const frag = document.createDocumentFragment();
		node.childNodes.forEach(child => { const cleaned = sanitizeNode(child); if (cleaned) frag.appendChild(cleaned); });
		if (!(tag in allowed)) return frag;
		const el = document.createElement(tag === 'A' ? 'a' : tag.toLowerCase());
		(allowed[tag] || []).forEach(attr => {
			const val = node.getAttribute(attr);
			if (val) {
				if (attr === 'href') { if (/^(https?:|\/|#)/i.test(val)) el.setAttribute('href', val); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
				else { el.setAttribute(attr, val); }
			}
		});
		el.appendChild(frag);
		return el;
	}
	const out = document.createElement('div');
	tmp.childNodes.forEach(child => { const cleaned = sanitizeNode(child); if (cleaned) out.appendChild(cleaned); });
	return out.innerHTML;
}
window.sanitizeCivitaiDescLocal = sanitizeCivitaiDesc;

// ===================================================================
// Detecção de data/duração de treino (fix de plausibilidade da duração
// estimada por nome de arquivo — ver problema_de_modelspec.txt)
// ===================================================================

(function() {
	function parseMetaDate(raw) {
		if (!raw || raw === 'None' || raw === 'null') return null;
		const s = String(raw).trim();
		if (!s) return null;
		if (/^\d{10}(?:\.\d+)?$/.test(s)) { const d = new Date(parseFloat(s) * 1000); return isNaN(d.getTime()) ? null : d; }
		if (/^\d{13}$/.test(s)) { const d = new Date(parseInt(s, 10)); return isNaN(d.getTime()) ? null : d; }
		const d = new Date(s);
		return isNaN(d.getTime()) ? null : d;
	}

	function parseTrainingStartFromOutputName(meta) {
		const raw = findVal(meta, ['ss_output_name', 'output_name', 'modelspec.title', 'name']);
		if (!raw) return null;
		const m = String(raw).match(/(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{0,3})/);
		if (!m) return null;
		const [, y, mo, d, h, mi, se, msRaw] = m;
		const ms = msRaw ? parseInt(msRaw.padEnd(3, '0').slice(0, 3), 10) : 0;
		const dt = new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(mi, 10), parseInt(se, 10), ms);
		return isNaN(dt.getTime()) ? null : dt;
	}

	function formatTrainingDateTime(d) {
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function formatDurationFromSeconds(seconds, estimated = false) {
		const secs = Math.max(0, Math.round(seconds));
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		const s = secs % 60;
		let dur = '';
		if (h > 0) dur += h + 'h ';
		if (m > 0 || h > 0) dur += m + 'm ';
		dur += s + 's';
		return (estimated ? '≈ ' : '') + dur.trim();
	}

	// Menor tempo/step fisicamente plausível entre trainers/hardware conhecidos.
	// Serve de guarda contra timestamps de nome de arquivo que na verdade são
	// horário de SALVAMENTO do checkpoint (ex: ai-toolkit / Civitai Spine
	// Controller), e não o início real do treino.
	const MIN_SECONDS_PER_STEP = 0.5;

	function isPlausibleDuration(durationSeconds, meta) {
		const steps = parseInt(findVal(meta, ['ss_steps', 'ss_max_train_steps', 'max_train_steps']) || '0', 10);
		if (!steps || steps <= 0) return true; // sem steps para comparar, não bloqueia
		return durationSeconds >= steps * MIN_SECONDS_PER_STEP;
	}

	function detectTrainingTiming(meta) {
		const endRaw = findVal(meta, ['ss_training_finished_at', 'training_finished_at', 'training_date', 'modelspec.date', 'date', 'created_at', 'createdAt']);
		const startRaw = findVal(meta, ['ss_training_started_at', 'training_started_at', 'started_at', 'startedAt']);

		const end = parseMetaDate(endRaw);
		const explicitStart = parseMetaDate(startRaw);
		const estimatedStart = explicitStart ? null : parseTrainingStartFromOutputName(meta);
		const start = explicitStart || estimatedStart;

		let dateText = null;
		let timeText = null;
		if (end) {
			dateText = formatTrainingDateTime(end);
			if (start && end.getTime() > start.getTime()) {
				const durationSeconds = (end.getTime() - start.getTime()) / 1000;
				if (estimatedStart && !isPlausibleDuration(durationSeconds, meta)) {
					// Estimativa por nome de arquivo reprovou na checagem de
					// plausibilidade — não inventa duração, mostra só a data.
					timeText = null;
				} else {
					timeText = formatDurationFromSeconds(durationSeconds, !!estimatedStart);
				}
			} else {
				timeText = end.toLocaleTimeString('en-GB', { hour12: false });
			}
		} else if (endRaw) { dateText = endRaw; }
		return { dateText, timeText };
	}

	window.detectTrainingTiming = detectTrainingTiming;
})();

// ===================================================================
// populateUI / setField — preenche os cards de Model Data a partir do
// meta parseado. Inclui o fix do bug de Epoch (chave 'ss_num_epochs').
// ===================================================================

function populateUI(meta) {
	const bm = findVal(meta, ['ss_sd_model_name','ss_base_model_version','base_model','checkpoint','sd_model_name']);
	if (bm) {
		let cleanName = String(bm).trim().replace(/\.(safetensors|ckpt|pt|pth|bin|ckpt\.safetensors)$/i, '').replace(/^.*[\/\\]/, '');
		setField('baseModelValue', cleanName, false);
		document.getElementById('baseModelValue').style.color = '#ffffff';
	}

	const vae    = findVal(meta, ['ss_vae_name','vae','vae_name']);
	const vaeRow = document.getElementById('vaeRow');
	if (vae) { setField('vaeValue', vae, false); document.getElementById('vaeValue').style.color = '#ffffff'; vaeRow.style.display = 'block'; }
	else     { vaeRow.style.display = 'none'; }

	for (const [id, keys] of Object.entries(FIELDS)) {
		let val = findVal(meta, keys);
		if (['v-prediction_type','v-batch_size','v-resolution','v-epoch','v-steps'].includes(id)) continue;
		if (id === 'v-network_args_algo' && val) {
			try {
				const obj = JSON.parse(val);
				val = obj.algo || obj.algorithm || obj.network_args_algo || null;
				if (!val) {
					const dora = obj.use_dora || obj.dora || obj.dora_linear_layer || null;
					val = (dora === true || dora === 'True' || dora === '1' || dora === 1) ? 'DoRA' : null;
				}
				if (!val) val = Object.entries(obj).filter(([k]) => k !== 'use_dora' && k !== 'dora').map(([k,v]) => k + ':' + v).join(', ') || null;
			} catch {
				const m = val.match(/algo["'\s:=]+([^\s"',}]+)/i);
				val = m ? m[1] : val;
			}
		}

		if (id === 'v-network_args_algo' && (!val || val === '—')) {
			const doraKey = findVal(meta, ['ss_use_dora','use_dora','ss_dora','dora']);
			if (doraKey && (doraKey === '1' || doraKey.toLowerCase() === 'true')) val = 'DoRA';
		}

		if (id === 'v-optimizer_type' && val) {
			let clean = String(val).trim().split(',')[0].trim().replace(/\s*\([^)]*\)?/g, '').trim();
			const dotParts = clean.split('.');
			clean = dotParts[dotParts.length - 1].split('_')[0].split('-')[0].trim();
			val = clean || val;
		}
		setField(id, val);
	}

	setField('v-prediction_type', resolvePredictionType(meta));
	setField('v-batch_size', resolveBatch(meta));
	setField('v-resolution', resolveResolution(meta));
	
	const epochCur   = findVal(meta, ['ss_epoch']);
	const epochTotal = findVal(meta, ['ss_num_epochs','ss_num_train_epochs','num_train_epochs']);
	if (epochCur && epochTotal && epochCur !== epochTotal) setField('v-epoch', epochCur + ' of ' + epochTotal);
	else if (epochCur || epochTotal) { const e = epochCur || epochTotal; setField('v-epoch', e + ' of ' + e); }

	// Steps atuais: alguns trainers (ex: ai-toolkit / Civitai Spine Controller)
	// gravam ss_steps sempre igual a ss_max_train_steps, independente de qual
	// checkpoint/epoch intermediário foi salvo — o valor não reflete o
	// progresso real deste checkpoint. Quando temos epoch atual e total,
	// estimamos os steps reais por proporção: (steps_totais / epochs_totais) *
	// epoch_atual. Marcado com "≈" por ser estimativa, igual ao Train Time.
	const stepsRaw    = findVal(meta, ['ss_steps']);
	const stepsTotal  = findVal(meta, ['ss_max_train_steps','max_train_steps']);
	const epochCurNum   = parseFloat(epochCur);
	const epochTotalNum = parseFloat(epochTotal);
	const stepsTotalNum = parseFloat(stepsTotal);

	let stepsCurDisplay = stepsRaw;
	let stepsEstimated  = false;
	if (!isNaN(epochCurNum) && !isNaN(epochTotalNum) && epochTotalNum > 0 && !isNaN(stepsTotalNum)) {
		stepsCurDisplay = String(Math.round((stepsTotalNum / epochTotalNum) * epochCurNum));
		stepsEstimated = true;
	}

	if (stepsCurDisplay && stepsTotal) {
		setField('v-steps', (stepsEstimated ? '≈' : '') + stepsCurDisplay + ' of ' + stepsTotal);
	} else if (stepsTotal) {
		setField('v-steps', stepsTotal + ' of ' + stepsTotal);
	} else if (stepsCurDisplay) {
		setField('v-steps', stepsCurDisplay);
	}

	const rawOptArgs = findVal(meta, ['ss_optimizer_args','optimizer_args']);
	if (rawOptArgs) {
		try { setField('v-optimizer_args', JSON.stringify(JSON.parse(rawOptArgs), null, 2)); }
		catch { setField('v-optimizer_args', rawOptArgs); }
	} else {
		const rawOpt = findVal(meta, ['ss_optimizer','ss_optimizer_type','optimizer_type']);
		if (rawOpt) {
			const m = rawOpt.match(/\(([^)]+)\)/);
			if (m) {
				const obj = {};
				m[1].split(',').forEach(p => { const [k, v] = p.split('=').map(s => s.trim()); if (k) obj[k] = v || ''; });
				setField('v-optimizer_args', JSON.stringify(obj, null, 2));
			}
		}
	}

	for (const [id, [k1arr, k2arr]] of Object.entries(JOIN_FIELDS)) {
		const v1 = findVal(meta, k1arr), v2 = findVal(meta, k2arr);
		setField(id, (v1 || v2) ? (v1||'?') + ' / ' + (v2||'?') : null);
	}

	const trainTiming = detectTrainingTiming(meta);
	setField('v-train_date', trainTiming.dateText);
	setField('v-train_time', trainTiming.timeText);
	setSystemInfo(detectSystemInfo(meta));
	
	const dsRaw = findVal(meta, ['ss_dataset_dirs','dataset_dirs']);
	const dsEl  = document.getElementById('datasetContent');
	const hintEl = document.getElementById('datasetFormatHint');
	let datasetImgCount = 0;
	if (dsRaw) {
		const { entries, totalImgs } = parseDatasetDirs(dsRaw);
		datasetImgCount = totalImgs;
		if (entries.length > 0) {
			const allTagsHTML = entries.map(e => '<span class="dataset-tag">' + window.escHtml(e.label) + '</span>').join('');
			let html = `<div style="font-size:11px;color:#888;margin-bottom:10px;font-style:italic;text-align:center;">(repeats)_dataset • (images)</div>`;
			if (entries.length > 6) {
				html += `
					<div class="dataset-tags" id="datasetTagsVisible">${entries.slice(0, 6).map(e => '<span class="dataset-tag">' + window.escHtml(e.label) + '</span>').join('')}</div>
					<div class="dataset-tags" id="datasetTagsFull" style="display:none;margin-top:8px;">${allTagsHTML}</div>
					<button class="prompt-block-toggle visible" id="datasetToggleBtn" style="margin-top:12px;width:100%;font-size:13px;">▼ (${entries.length})</button>
				`;
			} else { html += `<div class="dataset-tags">${allTagsHTML}</div>`; }
			dsEl.innerHTML = html;
			if (hintEl) hintEl.style.display = 'none';
			if (entries.length > 6) {
				const btn = document.getElementById('datasetToggleBtn'), visible = document.getElementById('datasetTagsVisible'), full = document.getElementById('datasetTagsFull');
				if (btn && visible && full) {
					let expanded = false;
					btn.onclick = () => {
						expanded = !expanded;
						if (expanded) { visible.style.display = 'none'; full.style.display = 'flex'; btn.innerHTML = '▲ '; } 
						else { visible.style.display = 'flex'; full.style.display = 'none'; btn.innerHTML = `▼ (${entries.length})`; }
					};
				}
			}
		}
	}
		
	const ni = findVal(meta, ['ss_num_train_images','num_train_images']);
	if (datasetImgCount > 0) setField('v-total_images', String(datasetImgCount));
	else if (ni && !ni.startsWith('{')) setField('v-total_images', ni);
	
	const cmt = findVal(meta, ['ss_training_comment','training_comment','comment','notes']);
	const trainingInfoRaw = findVal(meta, ['training_info']);
	let trainingInfoText = '';
	if (trainingInfoRaw) {
		try {
			const info = JSON.parse(trainingInfoRaw);
			trainingInfoText = (info && typeof info === 'object')
				? Object.entries(info).map(([k, v]) => k + ': ' + v).join(', ')
				: String(trainingInfoRaw);
		} catch { trainingInfoText = String(trainingInfoRaw); }
	}
	const commentParts = [];
	if (cmt) commentParts.push(cmt);
	if (trainingInfoText) commentParts.push('training_info → ' + trainingInfoText);
	document.getElementById('v-training_comment').textContent = commentParts.join('\n');

	renderPrompts(meta);
	
	const metaCreator = findVal(meta, ['modelspec.author','ss_creator','creator','author','ss_author','model_author']);
	if (metaCreator) {
		const creatorLabelRow = document.getElementById('creatorLabelRow');
		const creatorLink     = document.getElementById('creatorNameLink');
		const creatorFallbk   = document.getElementById('creatorAvatarFallback');
		const creatorAvatar   = document.getElementById('creatorAvatar');
		// Só usa o autor do metadata se o Civitai ainda não preencheu o criador.
		if (creatorLink && creatorAvatar && creatorFallbk && (!creatorLabelRow || creatorLabelRow.style.display === 'none' || !creatorLabelRow.style.display)) {
			creatorLink.textContent = metaCreator;
			creatorLink.href = '#';
			creatorLink.removeAttribute('target');
			creatorAvatar.style.display = 'none';
			creatorFallbk.style.display = 'flex';
			if (creatorLabelRow) creatorLabelRow.style.display = 'block';
		}
	}
}

function setField(id, val, isCardValue = true) {
	const el = document.getElementById(id);
	if (!el) return;
	if (val !== null && val !== undefined && val !== '') {
		el.textContent = val; el.classList.remove('empty');
		if (!el.querySelector('a')) el.style.color = '#ffffff';
	} else { el.textContent = '—'; el.classList.add('empty'); el.style.color = ''; }
}

// ===================================================================
// expandMeta — trainers online (ModelScope/MuseAI e similares) gravam blocos
// JSON como string em chaves próprias. Aqui eles são "achatados" no topo para que
// findVal() e os resolvers achem os campos. Não toca em chaves ss_* / modelspec.*
// (ex.: ss_tag_frequency) e nunca sobrescreve um valor já preenchido.
// ===================================================================
window.expandMeta = function(meta) {
	const out = { ...(meta || {}) };
	for (const [k, v] of Object.entries(meta || {})) {
		if (typeof v !== 'string' || /^ss_|^modelspec\./.test(k)) continue;
		const t = v.trim();
		if (t[0] !== '{' || !t.endsWith('}')) continue;
		const o = parseJsonMeta(t);
		if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
		for (const [pk, pv] of Object.entries(o)) {
			if (out[pk] === undefined || out[pk] === '' || out[pk] === 'None')
				out[pk] = (pv && typeof pv === 'object') ? JSON.stringify(pv) : String(pv);
		}
	}
	return out;
};

// ===================================================================
// SHA-256 de arquivo (usado pelo Lora Metadata Reader e pelo Lora Evaluate)
// ===================================================================
/* SHA-256 do arquivo inteiro.
   Antes: o arquivo era lido em pedaços E copiado inteiro de novo para um só
   buffer (2× o tamanho em RAM — LoRAs/checkpoints de 2 GB+ travavam a aba).
   Agora: até 768 MB usa o SHA-256 nativo do navegador com UMA cópia; acima
   disso, calcula em streaming (pedaço a pedaço, memória constante). */
const SHA256_NATIVE_LIMIT = 768 * 1024 * 1024;

function createSha256() {
	const K = new Uint32Array([
		0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
		0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
		0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
		0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
	const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
	const W = new Uint32Array(64);
	const buf = new Uint8Array(64); let bufLen = 0; let total = 0;
	function block(d, o) {
		for (let i = 0; i < 16; i++) W[i] = (d[o+i*4] << 24) | (d[o+i*4+1] << 16) | (d[o+i*4+2] << 8) | d[o+i*4+3];
		for (let i = 16; i < 64; i++) {
			const a = W[i-15], b = W[i-2];
			const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
			const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
			W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0;
		}
		let a = H[0], b = H[1], c = H[2], dd = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
		for (let i = 0; i < 64; i++) {
			const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
			const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
			const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
			const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
			h = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0;
		}
		H[0] += a; H[1] += b; H[2] += c; H[3] += dd; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
	}
	return {
		update(data) {
			let i = 0; total += data.length;
			if (bufLen) {
				while (bufLen < 64 && i < data.length) buf[bufLen++] = data[i++];
				if (bufLen === 64) { block(buf, 0); bufLen = 0; }
			}
			for (; i + 64 <= data.length; i += 64) block(data, i);
			while (i < data.length) buf[bufLen++] = data[i++];
		},
		hex() {
			const bits = total * 8;
			const pad = new Uint8Array(((bufLen < 56) ? 56 : 120) - bufLen + 8);
			pad[0] = 0x80;
			const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
			const n = pad.length;
			pad[n-8] = hi >>> 24; pad[n-7] = hi >>> 16; pad[n-6] = hi >>> 8; pad[n-5] = hi;
			pad[n-4] = lo >>> 24; pad[n-3] = lo >>> 16; pad[n-2] = lo >>> 8; pad[n-1] = lo;
			this.update(pad);
			return Array.from(H).map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
		}
	};
}

window.loraSha256 = async function(file, onProgress) {
	if (file.size <= SHA256_NATIVE_LIMIT && crypto && crypto.subtle) {
		if (onProgress) onProgress(0.05);
		const buf = await file.arrayBuffer();
		if (onProgress) onProgress(0.6);
		const digest = await crypto.subtle.digest('SHA-256', buf);
		if (onProgress) onProgress(1);
		return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
	}
	const sha = createSha256();
	const reader = file.stream().getReader();
	let loaded = 0, lastPaint = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		sha.update(value); loaded += value.byteLength;
		if (onProgress && loaded - lastPaint > 16 * 1024 * 1024) { lastPaint = loaded; onProgress(loaded / file.size); await new Promise(r => setTimeout(r, 0)); }
	}
	if (onProgress) onProgress(1);
	return sha.hex();
};
