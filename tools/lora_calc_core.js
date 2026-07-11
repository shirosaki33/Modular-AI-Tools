/* =========================================================================
   LORA CALCULATOR CORE - SINGLE PANEL (MANUAL)
   Handles Manual Math and UI Initialization.
========================================================================= */

// ==========================================
// 1. DATA DEFINITIONS & DEFAULTS
// ==========================================
const categories = [
    { id: 'charBase', title: 'Base Character', desc: 'Default face and standard anatomy', weight: 16, default: 1, icon: '🧍', group: 'identity' },
    { id: 'transform', title: 'Complex Transformations', desc: 'Alternate forms, major anatomical changes', weight: 16, default: 0, icon: '🌀', group: 'identity' },
    { id: 'outfitSimple', title: 'Simple Outfits', desc: 'Basic clothes, swimwear, standard uniforms', weight: 8, default: 1, icon: '👕', group: 'neutral' },
    { id: 'outfitComplex', title: 'Complex Outfits', desc: 'Armors, mechas, highly intricate dresses', weight: 16, default: 0, icon: '🛡️', group: 'identity' },
    { id: 'objects', title: 'Objects & Weapons', desc: 'Custom swords, vehicles, specific items', weight: 8, default: 0, icon: '🗡️', group: 'neutral' },
    { id: 'poses', title: 'Poses & Actions', desc: 'Dynamic angles, signature combat moves', weight: 8, default: 0, icon: '🤸', group: 'neutral' },
    { id: 'detailSimple', title: 'Simple Details', desc: 'Tattoos, scars, glasses, jewelry', weight: 4, default: 0, icon: '💎', group: 'identity' },
    { id: 'artStyle', title: 'Art Styles', desc: 'Specific artist trace, watercolor, 3D render', weight: 16, default: 0, icon: '🎨', group: 'style' },
    { id: 'concept', title: 'Concepts & Scenarios', desc: 'Cyberpunk, complex backgrounds, themes', weight: 16, default: 0, icon: '🌆', group: 'style' }
];

const DIMINISH = [1, 0.7, 0.5, 0.35];

function diminishedWeight(count) {
    let total = 0;
    for (let i = 0; i < count; i++) total += DIMINISH[Math.min(i, DIMINISH.length - 1)];
    return total;
}

const RANK_LADDER = [8, 16, 24, 32, 48, 64, 96, 128, 192, 256];
const RANK_THRESHOLDS = [24, 48, 65, 80, 111, 140, 184, 220, 285];

function scoreToTierIndex(score) {
    for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
        if (score <= RANK_THRESHOLDS[i]) return i;
    }
    return RANK_LADDER.length - 1;
}

const BASE_MODELS = {
    anima: { label: 'Anima (CircleStone Labs)', rankBias: 1.0, mbPerRank: 2.8125, alphaRatio: 0.5 },
    sd15: { label: 'SD 1.5', rankBias: 1.0, mbPerRank: 1.125, alphaRatio: 0.5 },
    sdxl: { label: 'SDXL / Pony / Illustrious', rankBias: 1.0, mbPerRank: 4.0, alphaRatio: 0.5 },
    flux: { label: 'FLUX.1', rankBias: 0.6, mbPerRank: 10.0, alphaRatio: 0.5 }
};
window.selectedBaseModel = 'anima';

function formatSize(mb) {
    return mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10;
}

function computeRankData(counters) {
    let rawScore = 0, identityScore = 0, styleScore = 0;
    categories.forEach(cat => {
        const count = counters[cat.id] || 0;
        const contribution = cat.weight * diminishedWeight(count);
        rawScore += contribution;
        if (cat.group === 'identity') identityScore += contribution;
        if (cat.group === 'style') styleScore += contribution;
    });

    const model = BASE_MODELS[window.selectedBaseModel] || BASE_MODELS.anima;
    let tierIdx = scoreToTierIndex(rawScore * model.rankBias);

    let profile = 'Balanced';
    if (rawScore > 0) {
        if (identityScore / rawScore >= 0.55) {
            tierIdx = Math.min(tierIdx + 1, RANK_LADDER.length - 1);
            profile = 'Likeness-heavy';
        } else if (styleScore / rawScore >= 0.55) {
            tierIdx = Math.max(tierIdx - 1, 0);
            profile = 'Style-heavy';
        }
    }

    const rank = RANK_LADDER[tierIdx];
    const alpha = Math.max(1, Math.round(rank * model.alphaRatio));
    const sizeMB = rank * model.mbPerRank;

    return { rawScore: Math.round(rawScore * 10) / 10, rank, alpha, sizeMB: formatSize(sizeMB), profile, tierIdx };
}

const GAUGE_TIER_LABELS = RANK_LADDER.map(String);
const WEIGHT_BAR_REFERENCE = 16 * diminishedWeight(4);

let manualCounters = {};

// ==========================================
// 2. UI INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    buildManualUI();

    const modelSel = document.getElementById('base-model-select');
    if (modelSel) {
        modelSel.value = window.selectedBaseModel;
        const noteEl = document.getElementById('calib-note');
        if (noteEl) noteEl.innerText = CALIB_NOTES[window.selectedBaseModel] || '';
    }
});

// ==========================================
// 3. MANUAL COUNTERS & MATH
// ==========================================
function buildManualUI() {
    const container = document.getElementById('manual-counters');
    container.innerHTML = '';
    
    categories.forEach(cat => {
        manualCounters[cat.id] = cat.default;
        
        const row = document.createElement('div');
        row.className = 'counter-row manual';
        row.innerHTML = `
            <div class="counter-icon">${cat.icon}</div>
            <div class="counter-label">
                <div class="counter-title-row">
                    <span class="counter-title">${cat.title}</span>
                    <span class="weight-tag">×${cat.weight}</span>
                </div>
                <span class="counter-desc">${cat.desc}</span>
                <div class="weight-bar-track"><div class="weight-bar-fill" id="bar-${cat.id}"></div></div>
            </div>
            <div class="counter-controls">
                <button class="counter-btn minus" onclick="window.updateCounter('${cat.id}', -1)">-</button>
                <span class="counter-value" id="val-${cat.id}">${cat.default}</span>
                <button class="counter-btn" onclick="window.updateCounter('${cat.id}', 1)">+</button>
            </div>
        `;
        container.appendChild(row);
    });
    categories.forEach(cat => updateWeightBar(cat.id, manualCounters[cat.id], cat.weight));
    buildGauge('gauge-manual', 'manual-fill');
    calculateManualRank();
}

function buildGauge(containerId, fillClass) {
    const el = document.getElementById(containerId);
    if (!el || el.children.length > 0) return;
    RANK_LADDER.forEach(() => {
        const seg = document.createElement('div');
        seg.className = `gauge-segment ${fillClass}`;
        el.appendChild(seg);
    });
    const ticksEl = document.getElementById(containerId.replace('gauge-', 'ticks-'));
    if (ticksEl) {
        ticksEl.innerHTML = GAUGE_TIER_LABELS.map(v => `<span>${v}</span>`).join('');
    }
}

function updateGauge(containerId, fillClass, tierIdx) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const filledCount = tierIdx + 1;
    Array.from(el.children).forEach((seg, i) => {
        seg.classList.toggle('filled', i < filledCount);
        seg.classList.toggle('head', i === filledCount - 1);
    });
}

function updateWeightBar(catId, count, weight) {
    const bar = document.getElementById(`bar-${catId}`);
    if (!bar) return;
    const contribution = weight * diminishedWeight(count);
    const pct = Math.min(100, (contribution / WEIGHT_BAR_REFERENCE) * 100);
    bar.style.width = `${pct}%`;
}

const CALIB_NOTES = {
    anima: 'calibrated with real data: Citron Legacy Trainer (kohya sd-scripts) at rank 32 / alpha 16 = 90 MB — note that the official CircleStone LoRA (trained via diffusion-pipe) is larger at the same rank (132 MB), as it targets more layers',
    sd15: 'community estimate for attention LoRA in fp16 — actual size varies with trained modules',
    sdxl: 'community estimate for attention LoRA in fp16 — actual size varies with trained modules',
    flux: 'community estimate; FLUX usually needs less rank since the prior is already very strong'
};

window.onBaseModelChange = function() {
    const sel = document.getElementById('base-model-select');
    if (!sel) return;
    window.selectedBaseModel = sel.value;
    const noteEl = document.getElementById('calib-note');
    if (noteEl) noteEl.innerText = CALIB_NOTES[sel.value] || '';
    calculateManualRank();
}

window.updateCounter = function(id, change) {
    manualCounters[id] += change;
    if (manualCounters[id] < 0) manualCounters[id] = 0;
    document.getElementById(`val-${id}`).innerText = manualCounters[id];
    const cat = categories.find(c => c.id === id);
    if (cat) updateWeightBar(id, manualCounters[id], cat.weight);
    calculateManualRank();
}

function calculateManualRank() {
    const data = computeRankData(manualCounters);

    document.getElementById('raw-score').innerText = data.rawScore;
    document.getElementById('final-rank').innerText = data.rank;
    document.getElementById('final-alpha').innerText = data.alpha;
    document.getElementById('final-size').innerText = `~${data.sizeMB} MB`;
    const modelEl = document.getElementById('final-model');
    if (modelEl) modelEl.innerText = (BASE_MODELS[window.selectedBaseModel] || BASE_MODELS.sdxl).label;
    const profileEl = document.getElementById('final-profile');
    if (profileEl) profileEl.innerText = data.profile;
    updateGauge('gauge-manual', 'manual-fill', data.tierIdx);
}