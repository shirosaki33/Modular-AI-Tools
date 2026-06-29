/* ── Civitai Generator Parser (v7.5 / v7.7 / v7.8 / v13.1) ───────────────
   Reads Civitai Generator metadata from EXIF/UserComment/PNG text payloads.
   Keeps it isolated from Stable Diffusion classic parsing.
   Includes: route-priority override, final dispatcher, and LoRA version links.
   Load AFTER the base helpers (makeParsedV4, addParamV4, etc.) and BEFORE the
   generic fallback dispatcher (09_generic_fallback.js). */

/* ── v7.5 Civitai Generator dedicated parser + source/version links ──────────
   Reads Civitai Generator metadata from EXIF/UserComment/PNG text payloads.
   Keeps it isolated from Stable Diffusion classic parsing. */
(function(){
  var CIVITAI_WEB = 'https://civitai.com/';
  var CIVITAI_RED_MODEL_BASE = (typeof PNG_CIVITAI_MODEL_BASE !== 'undefined') ? PNG_CIVITAI_MODEL_BASE : 'https://civitai.red/models/';
  var CIVITAI_API = (typeof PNG_CIVITAI_API !== 'undefined') ? PNG_CIVITAI_API : 'https://civitai.com/api/v1/';
  var _lastCivitaiParsedV75 = null;

  function _c75Str(v){ return String(v === undefined || v === null ? '' : v); }
  function _c75Safe(v){ return (typeof _safeHtml === 'function') ? _safeHtml(_c75Str(v)) : _c75Str(v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function _c75Clean(v){ return (typeof cleanName === 'function') ? cleanName(v) : _c75Str(v).replace(/\\/g,'/').split('/').pop().replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i,'').replace(/_/g,' ').trim(); }
  function _c75Grab(text, re){ var m = _c75Str(text).match(re); return m ? (m[1] || '') : ''; }
  function _c75AddParam(rows, label, value){ if (typeof addParamV4 === 'function') addParamV4(rows, label, value); else { value = _c75Str(value).trim(); if (value) rows.push([label, value]); } }
  function _c75AddSize(rows, size, hires, upscale){ if (typeof addSizeParamV4 === 'function') addSizeParamV4(rows, size, hires, upscale); else if (size) rows.push(['Size', size]); }
  function _c75Prompt(v){ return (typeof cleanPrompt === 'function') ? cleanPrompt(v) : _c75Str(v).replace(/\\n/g,'\n').replace(/\\"/g,'"').trim(); }
  function _c75MakeParsed(source){ return (typeof makeParsedV4 === 'function') ? makeParsedV4(source) : { source: source, models:{checkpoint:'',vae:'',clipText:''}, params:[], loras:[], extras:[], prompts:{positive:'',negative:'',characters:[]} }; }
  function _c75DedupePush(arr, value){
    value = _c75Str(value).trim();
    if (!value) return;
    var key = value.toLowerCase().replace(/\s+/g,' ');
    if (!arr.some(function(x){ return _c75Str(x).toLowerCase().replace(/\s+/g,' ') === key; })) arr.push(value);
  }

  function _c75FindBalanced(text, start, openChar, closeChar){
    var s = _c75Str(text);
    var depth = 0, inString = false, escape = false;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return '';
  }

  function _c75JsonAfterLabel(text, label, openChar, closeChar){
    var s = _c75Str(text);
    var idx = s.search(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'i'));
    if (idx < 0) return null;
    var colon = s.indexOf(':', idx);
    var start = s.indexOf(openChar, colon + 1);
    if (start < 0) return null;
    var raw = _c75FindBalanced(s, start, openChar, closeChar);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
  }

  function _c75CivitaiResources(text){
    var arr = _c75JsonAfterLabel(text, 'Civitai resources', '[', ']');
    return Array.isArray(arr) ? arr : [];
  }

  function _c75CivitaiMetadata(text){
    var obj = _c75JsonAfterLabel(text, 'Civitai metadata', '{', '}');
    return obj && typeof obj === 'object' ? obj : null;
  }

  function _c75IsCivitai(text, json){
    var s = _c75Str(text);
    if (/\bCivitai\s+(resources|metadata)\s*:/i.test(s)) return true;
    if (json && typeof json === 'object') {
      if (json.ecosystem && (json.workflow || json.outputFormat || json.resources)) return true;
      if (Array.isArray(json.resources) && json.resources.some(function(r){ return r && r.modelVersionId; })) return true;
    }
    return false;
  }

  function _c75ResourceName(r){
    if (!r) return '';
    var name = _c75Str(r.modelName || r.name || '').trim();
    var ver = _c75Str(r.modelVersionName || r.versionName || '').trim();
    if (name && ver) return name + ' | Version: ' + ver;
    return name || ver;
  }

  function _c75CivitaiVersionUrl(versionId){
    versionId = _c75Str(versionId).trim();
    return versionId ? (CIVITAI_API + 'model-versions/' + encodeURIComponent(versionId)) : CIVITAI_WEB;
  }

  async function _c75OpenVersionId(versionId, fallbackName, linkEl){
    versionId = _c75Str(versionId).trim();
    if (!versionId) {
      window.open(CIVITAI_WEB, '_blank', 'noopener');
      return;
    }
    if (linkEl) linkEl.classList.add('resolving');
    try {
      var r = await fetch(CIVITAI_API + 'model-versions/' + encodeURIComponent(versionId), { signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined });
      var data = null;
      try { data = await r.json(); } catch(e) {}
      var modelId = data && (data.modelId || (data.model && data.model.id));
      var url = modelId ? (CIVITAI_RED_MODEL_BASE + modelId + '?modelVersionId=' + encodeURIComponent(versionId)) : '';
      if (!url && fallbackName) url = CIVITAI_WEB + 'models?query=' + encodeURIComponent(_c75Str(fallbackName));
      window.open(url || _c75CivitaiVersionUrl(versionId), '_blank', 'noopener');
    } catch(e) {
      var searchUrl = fallbackName ? (CIVITAI_WEB + 'models?query=' + encodeURIComponent(_c75Str(fallbackName))) : _c75CivitaiVersionUrl(versionId);
      window.open(searchUrl, '_blank', 'noopener');
    } finally {
      if (linkEl) linkEl.classList.remove('resolving');
    }
  }

  function _c75ParseCivitai(text, json){
    var meta = _c75CivitaiMetadata(text) || (json && json.workflow && json.resources ? json : null) || {};
    var resources = _c75CivitaiResources(text);
    if (!resources.length && Array.isArray(meta.resources)) {
      resources = meta.resources.map(function(r){
        return {
          type: r.type,
          weight: r.weight || r.strength,
          modelVersionId: r.modelVersionId || r.id,
          modelName: r.modelName || r.name || '',
          modelVersionName: r.modelVersionName || r.versionName || ''
        };
      });
    }

    var out = _c75MakeParsed('Civitai');
    out._civitai = { metadata: meta, resources: resources, checkpointVersionId: '', loraVersions: {} };

    var checkpoint = resources.find(function(r){ return r && /^checkpoint$/i.test(_c75Str(r.type)); });
    if (checkpoint) {
      out.models.checkpoint = _c75ResourceName(checkpoint);
      out._civitai.checkpointVersionId = _c75Str(checkpoint.modelVersionId || checkpoint.id || '').trim();
    } else {
      out.models.checkpoint = _c75Clean(_c75Grab(text, /(?:^|[,\n])\s*Model\s*:\s*([^,\n]+)/i) || _c75Grab(text, /(?:^|[,\n])\s*Checkpoint\s*:\s*([^,\n]+)/i) || '---');
    }

    var embeds = [];
    resources.forEach(function(r){
      var type = _c75Str(r && r.type).toLowerCase();
      if (type === 'lora') {
        var line = _c75ResourceName(r);
        if (r.weight !== undefined && r.weight !== null && _c75Str(r.weight) !== '') line += ' | Weight: ' + r.weight;
        _c75DedupePush(out.loras, line);
        var id = _c75Str(r.modelVersionId || r.id || '').trim();
        if (id) out._civitai.loraVersions[line.toLowerCase().replace(/\s+/g,' ')] = id;
      } else if (type === 'embed' || type === 'textualinversion' || type === 'textual inversion') {
        var eLine = _c75ResourceName(r);
        if (r.weight !== undefined && r.weight !== null && _c75Str(r.weight) !== '') eLine += ' | Weight: ' + r.weight;
        _c75DedupePush(embeds, eLine);
      }
    });
    embeds.forEach(function(v){ out.extras.push('Embedding: ' + v); });

    var w = meta.width || (meta.aspectRatio && meta.aspectRatio.width) || _c75Grab(text, /Size:\s*(\d+)x\d+/i);
    var h = meta.height || (meta.aspectRatio && meta.aspectRatio.height) || _c75Grab(text, /Size:\s*\d+x(\d+)/i);
    var size = (w && h) ? (w + ' x ' + h) : _c75Grab(text, /Size:\s*([^,\n]+)/i);
    _c75AddParam(out.params, 'Steps', meta.steps || _c75Grab(text, /Steps:\s*([^,\n]+)/i));
    _c75AddParam(out.params, 'CFG', meta.cfgScale || meta.cfgscale || meta.cfg || _c75Grab(text, /CFG scale:\s*([^,\n]+)/i));
    _c75AddParam(out.params, 'Seed', meta.seed || _c75Grab(text, /Seed:\s*([^,\n]+)/i));
    _c75AddParam(out.params, 'Clip Skip', meta.clipSkip || meta.clip_skip || _c75Grab(text, /Clip skip:\s*([^,\n]+)/i));
    _c75AddSize(out.params, size, '', '');
    _c75AddParam(out.params, 'Sampler', meta.sampler || _c75Grab(text, /Sampler:\s*([^,\n]+)/i));
    _c75AddParam(out.params, 'Scheduler', meta.scheduler || meta.scheduleType || _c75Grab(text, /Schedule type:\s*([^,\n]+)/i));
    if (meta.workflow) out.extras.push('Workflow: ' + meta.workflow);
    if (meta.ecosystem) out.extras.push('Ecosystem: ' + meta.ecosystem);
    if (meta.outputFormat) out.extras.push('Output Format: ' + meta.outputFormat);
    var created = _c75Grab(text, /Created Date:\s*([^,\n]+)/i) || meta.createdDate || meta.createdAt || '';
    if (created) out.extras.push('Created Date: ' + created);
    if (Array.isArray(meta.triggerWords) && meta.triggerWords.length) out.extras.push('Trigger Words: ' + meta.triggerWords.join(' | '));

    out.prompts.positive = _c75Prompt(meta.prompt || _c75Grab(text, /^(.*?)(?:Negative prompt:|Steps:|Sampler:|$)/is));
    out.prompts.negative = _c75Prompt(meta.negativePrompt || meta.negative_prompt || _c75Grab(text, /Negative prompt:\s*(.*?)(?:Steps:|Sampler:|CFG scale:|Seed:|Size:|$)/is));

    _lastCivitaiParsedV75 = out;
    window._lastCivitaiParsedV75 = out;
    return out;
  }

  if (typeof detectSource === 'function' && !detectSource._pngCivitaiV75) {
    var _baseDetectSource75 = detectSource;
    detectSource = function(text, json){
      if (_c75IsCivitai(text, json)) return 'Civitai';
      return _baseDetectSource75.apply(this, arguments);
    };
    detectSource._pngCivitaiV75 = true;
  }

  if (typeof parseMetadataV4 === 'function' && !parseMetadataV4._pngCivitaiV75) {
    var _baseParseMetadata75 = parseMetadataV4;
    parseMetadataV4 = function(text, json, mode){
      if ((mode || 'image') !== 'video' && _c75IsCivitai(text, json)) return _c75ParseCivitai(text, json);
      _lastCivitaiParsedV75 = null;
      window._lastCivitaiParsedV75 = null;
      return _baseParseMetadata75.apply(this, arguments);
    };
    parseMetadataV4._pngCivitaiV75 = true;
  }

  if (typeof sourceLink === 'function' && !sourceLink._pngCivitaiV75) {
    var _baseSourceLink75 = sourceLink;
    sourceLink = function(name){
      if (name === 'Civitai') return '<a href="https://civitai.com/" target="_blank" rel="noopener noreferrer">Civitai</a>';
      return _baseSourceLink75.apply(this, arguments);
    };
    sourceLink._pngCivitaiV75 = true;
  }

  if (typeof renderTopV4 === 'function' && !renderTopV4._pngCivitaiV75) {
    var _baseRenderTop75 = renderTopV4;
    renderTopV4 = function(parsed){
      var ret = _baseRenderTop75.apply(this, arguments);
      try {
        if (parsed && parsed.source === 'Civitai' && parsed._civitai && parsed._civitai.checkpointVersionId && topbar) {
          var rows = topbar.querySelectorAll('.topbar-row');
          var cpRow = rows && rows.length ? rows[0] : null;
          if (cpRow) {
            var name = parsed.models && parsed.models.checkpoint ? parsed.models.checkpoint : 'Civitai checkpoint';
            var id = parsed._civitai.checkpointVersionId;
            cpRow.innerHTML = '<span class="label">Checkpoint:</span> <a href="' + _c75CivitaiVersionUrl(id) + '" target="_blank" rel="noopener noreferrer" class="checkpoint-civitai-link" title="Open checkpoint version on Civitai">' + _c75Safe(name) + '</a>';
            var a = cpRow.querySelector('a');
            if (a) a.onclick = function(e){ if (e) e.preventDefault(); _c75OpenVersionId(id, name, a); return false; };
          }
        }
      } catch(e) {}
      return ret;
    };
    renderTopV4._pngCivitaiV75 = true;
  }

  if (typeof renderLoraListV4 === 'function' && !renderLoraListV4._pngCivitaiV75) {
    var _baseRenderLora75 = renderLoraListV4;
    renderLoraListV4 = function(rows, rawText, checkpointContext){
      var civ = window._lastCivitaiParsedV75;
      if (!civ || civ.source !== 'Civitai' || !Array.isArray(rows) || !rows.length) {
        return _baseRenderLora75.apply(this, arguments);
      }
      var list = document.getElementById('loraList');
      var box = document.getElementById('loraBox');
      if (!list || !box) return _baseRenderLora75.apply(this, arguments);
      list.innerHTML = '';
      rows.forEach(function(txt){
        var div = document.createElement('div');
        div.className = 'item';
        var key = _c75Str(txt).toLowerCase().replace(/\s+/g,' ');
        var id = civ._civitai && civ._civitai.loraVersions ? civ._civitai.loraVersions[key] : '';
        if (id) {
          var a = document.createElement('a');
          a.href = _c75CivitaiVersionUrl(id);
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.className = 'lora-civitai-link available';
          a.textContent = txt;
          a.title = 'Open exact LoRA version from Civitai metadata';
          a.onclick = function(e){ if (e) e.preventDefault(); _c75OpenVersionId(id, txt, a); return false; };
          div.appendChild(a);
        } else {
          div.textContent = txt;
        }
        list.appendChild(div);
      });
      box.style.display = rows.length ? 'block' : 'none';
};
    renderLoraListV4._pngCivitaiV75 = true;
  }




/* ── v7.7 final Civitai route priority override ─────────────────────────────
   Forces Civitai Generator metadata to use the dedicated Civitai parser before
   any Stable Diffusion fallback can claim the file because of Steps/Sampler text.
*/
(function(){
  var CIVITAI_WEB77 = 'https://civitai.com/';
  var CIVITAI_API77 = (typeof PNG_CIVITAI_API !== 'undefined') ? PNG_CIVITAI_API : 'https://civitai.com/api/v1/';
  var CIVITAI_MODEL_BASE77 = (typeof PNG_CIVITAI_MODEL_BASE !== 'undefined') ? PNG_CIVITAI_MODEL_BASE : 'https://civitai.red/models/';

  function _cv77Str(v){ return String(v === undefined || v === null ? '' : v); }
  function _cv77Safe(v){
    if (typeof _safeHtml === 'function') return _safeHtml(_cv77Str(v));
    return _cv77Str(v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }
  function _cv77Clean(v){ return (typeof cleanName === 'function') ? cleanName(v) : _cv77Str(v).replace(/\\/g,'/').split('/').pop().replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i,'').replace(/_/g,' ').trim(); }
  function _cv77Prompt(v){ return (typeof cleanPrompt === 'function') ? cleanPrompt(v) : _cv77Str(v).replace(/\\n/g,'\n').replace(/\\"/g,'"').trim(); }
  function _cv77AddParam(rows, label, value){
    value = _cv77Str(value).trim();
    if (!value || value === 'undefined' || value === 'null') return;
    if (typeof addParamV4 === 'function') addParamV4(rows, label, value);
    else rows.push([label, value]);
  }
  function _cv77AddSize(rows, size){
    size = _cv77Str(size).trim();
    if (!size) return;
    if (typeof addSizeParamV4 === 'function') addSizeParamV4(rows, size, '', '');
    else rows.push(['Size', size]);
  }
  function _cv77MakeParsed(source){
    return (typeof makeParsedV4 === 'function') ? makeParsedV4(source) : { source: source, models:{checkpoint:'',vae:'',clipText:''}, params:[], loras:[], extras:[], prompts:{positive:'',negative:'',characters:[]} };
  }
  function _cv77Grab(text, re){ var m = _cv77Str(text).match(re); return m ? (m[1] || '') : ''; }
  function _cv77NormKey(v){ return _cv77Str(v).toLowerCase().replace(/\s+/g,' ').trim(); }
  function _cv77DedupePush(arr, value){
    value = _cv77Str(value).trim();
    if (!value) return;
    var key = _cv77NormKey(value);
    if (!arr.some(function(x){ return _cv77NormKey(x) === key; })) arr.push(value);
  }

  function _cv77FindBalanced(text, start, openChar, closeChar){
    var s = _cv77Str(text);
    var depth = 0, inString = false, escape = false;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return '';
  }

  function _cv77JsonAfterLabel(text, label, openChar, closeChar){
    var s = _cv77Str(text);
    var idx = s.search(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'i'));
    if (idx < 0) return null;
    var colon = s.indexOf(':', idx);
    var start = s.indexOf(openChar, colon + 1);
    if (start < 0) return null;
    var raw = _cv77FindBalanced(s, start, openChar, closeChar);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
  }

  function _cv77IsCivitai(text, json){
    var s = _cv77Str(text);
    if (/\bCivitai\s+(resources|metadata)\s*:/i.test(s)) return true;
    if (json && typeof json === 'object') {
      if (json.ecosystem && (json.workflow || json.outputFormat || json.resources)) return true;
      if (Array.isArray(json.resources) && json.resources.some(function(r){ return r && (r.modelVersionId || /checkpoint|lora|textual/i.test(_cv77Str(r.type))); })) return true;
    }
    return false;
  }

  function _cv77ResourceName(r){
    if (!r) return '';
    var name = _cv77Str(r.modelName || r.name || '').trim();
    var ver = _cv77Str(r.modelVersionName || r.versionName || '').trim();
    if (name && ver) return name + ' | Version: ' + ver;
    return name || ver || (r.modelVersionId ? ('Version ID: ' + r.modelVersionId) : '');
  }

  function _cv77VersionHref(versionId){
    versionId = _cv77Str(versionId).trim();
    return versionId ? (CIVITAI_API77 + 'model-versions/' + encodeURIComponent(versionId)) : CIVITAI_WEB77;
  }

  async function _cv77OpenVersion(versionId, fallbackName, linkEl){
    versionId = _cv77Str(versionId).trim();
    if (!versionId) {
      window.open(CIVITAI_WEB77 + (fallbackName ? ('models?query=' + encodeURIComponent(fallbackName)) : ''), '_blank', 'noopener');
      return;
    }
    if (linkEl) linkEl.classList.add('resolving');
    try {
      var opts = {};
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(10000);
      var r = await fetch(CIVITAI_API77 + 'model-versions/' + encodeURIComponent(versionId), opts);
      var data = null;
      try { data = await r.json(); } catch(e) {}
      var modelId = data && (data.modelId || (data.model && data.model.id));
      var url = modelId ? (CIVITAI_MODEL_BASE77 + modelId + '?modelVersionId=' + encodeURIComponent(versionId)) : '';
      if (!url && fallbackName) url = CIVITAI_WEB77 + 'models?query=' + encodeURIComponent(fallbackName);
      window.open(url || _cv77VersionHref(versionId), '_blank', 'noopener');
    } catch(e) {
      var fallback = fallbackName ? (CIVITAI_WEB77 + 'models?query=' + encodeURIComponent(fallbackName)) : _cv77VersionHref(versionId);
      window.open(fallback, '_blank', 'noopener');
    } finally {
      if (linkEl) linkEl.classList.remove('resolving');
    }
  }

  function _cv77ParseCivitai(text, json){
    text = _cv77Str(text);
    var meta = _cv77JsonAfterLabel(text, 'Civitai metadata', '{', '}') || (json && json.ecosystem ? json : {}) || {};
    var resources = _cv77JsonAfterLabel(text, 'Civitai resources', '[', ']');
    if (!Array.isArray(resources)) resources = [];
    if (!resources.length && Array.isArray(meta.resources)) resources = meta.resources.map(function(r){
      return {
        type: r.type,
        weight: r.weight !== undefined ? r.weight : r.strength,
        modelVersionId: r.modelVersionId || r.id,
        modelName: r.modelName || r.name || '',
        modelVersionName: r.modelVersionName || r.versionName || ''
      };
    });

    var out = _cv77MakeParsed('Civitai');
    out._civitai = { metadata: meta, resources: resources, checkpointVersionId: '', loraVersions: {} };

    var checkpoint = resources.find(function(r){ return r && /checkpoint/i.test(_cv77Str(r.type)); });
    if (checkpoint) {
      out.models.checkpoint = _cv77ResourceName(checkpoint) || 'Civitai checkpoint';
      out._civitai.checkpointVersionId = _cv77Str(checkpoint.modelVersionId || checkpoint.id || '').trim();
    } else {
      out.models.checkpoint = _cv77Clean(_cv77Grab(text, /(?:^|[,\n])\s*Model\s*:\s*([^,\n]+)/i) || _cv77Grab(text, /(?:^|[,\n])\s*Checkpoint\s*:\s*([^,\n]+)/i) || '---');
    }

    resources.forEach(function(r){
      if (!r) return;
      var type = _cv77Str(r.type).toLowerCase();
      var line = _cv77ResourceName(r);
      var weight = r.weight !== undefined ? r.weight : r.strength;
      if (weight !== undefined && weight !== null && _cv77Str(weight) !== '') line += ' | Weight: ' + weight;
      var id = _cv77Str(r.modelVersionId || r.id || '').trim();
      if (/lora/.test(type)) {
        _cv77DedupePush(out.loras, line);
        if (id) out._civitai.loraVersions[_cv77NormKey(line)] = id;
      } else if (/embed|textual/.test(type)) {
        _cv77DedupePush(out.extras, 'Embedding: ' + line);
      }
    });

    var w = meta.width || (meta.aspectRatio && meta.aspectRatio.width) || _cv77Grab(text, /Size:\s*(\d+)x\d+/i);
    var h = meta.height || (meta.aspectRatio && meta.aspectRatio.height) || _cv77Grab(text, /Size:\s*\d+x(\d+)/i);
    var size = (w && h) ? (w + ' x ' + h) : _cv77Grab(text, /Size:\s*([^,\n]+)/i);

    _cv77AddParam(out.params, 'Steps', meta.steps || _cv77Grab(text, /Steps:\s*([^,\n]+)/i));
    _cv77AddParam(out.params, 'CFG', meta.cfgScale || meta.cfgscale || meta.cfg || _cv77Grab(text, /CFG scale:\s*([^,\n]+)/i));
    _cv77AddParam(out.params, 'Seed', meta.seed || _cv77Grab(text, /Seed:\s*([^,\n]+)/i));
    _cv77AddParam(out.params, 'Clip Skip', meta.clipSkip || meta.clip_skip || _cv77Grab(text, /Clip skip:\s*([^,\n]+)/i));
    _cv77AddSize(out.params, size);
    _cv77AddParam(out.params, 'Sampler', meta.sampler || _cv77Grab(text, /Sampler:\s*([^,\n]+)/i));
    _cv77AddParam(out.params, 'Scheduler', meta.scheduler || meta.scheduleType || _cv77Grab(text, /Schedule type:\s*([^,\n]+)/i));

    if (meta.workflow) out.extras.push('Workflow: ' + meta.workflow);
    if (meta.ecosystem) out.extras.push('Ecosystem: ' + meta.ecosystem);
    if (meta.outputFormat || meta.output) out.extras.push('Output Format: ' + (meta.outputFormat || meta.output));
    var created = _cv77Grab(text, /Created Date:\s*([^,\n]+)/i) || meta.createdDate || meta.createdAt || '';
    if (created) out.extras.push('Created Date: ' + created);
    if (Array.isArray(meta.triggerWords) && meta.triggerWords.length) out.extras.push('Trigger Words: ' + meta.triggerWords.join(' | '));

    out.prompts.positive = _cv77Prompt(meta.prompt || _cv77Grab(text, /^(.*?)(?:Negative prompt:|Steps:|Sampler:|$)/is));
    out.prompts.negative = _cv77Prompt(meta.negativePrompt || meta.negative_prompt || _cv77Grab(text, /Negative prompt:\s*(.*?)(?:Steps:|Sampler:|CFG scale:|Seed:|Size:|$)/is));

    window._lastCivitaiParsedV77 = out;
    return out;
  }

  if (typeof detectSource === 'function') {
    var _baseDetect77 = detectSource;
    detectSource = function(text, json){
      if (_cv77IsCivitai(text, json)) return 'Civitai';
      return _baseDetect77.apply(this, arguments);
    };
  }

  if (typeof sourceLink === 'function') {
    var _baseSourceLink77 = sourceLink;
    sourceLink = function(name){
      if (name === 'Civitai') return '<a href="https://civitai.com/" target="_blank" rel="noopener noreferrer">Civitai</a>';
      return _baseSourceLink77.apply(this, arguments);
    };
  }

  if (typeof parseMetadataV4 === 'function') {
    var _baseParse77 = parseMetadataV4;
    parseMetadataV4 = function(text, json, mode){
      if ((mode || 'image') !== 'video' && _cv77IsCivitai(text, json)) return _cv77ParseCivitai(text, json);
      window._lastCivitaiParsedV77 = null;
      return _baseParse77.apply(this, arguments);
    };
  }

  if (typeof processMetadataV4 === 'function') {
    var _baseProcess77 = processMetadataV4;
    processMetadataV4 = function(raw, parsedJSON, mode){
      if ((mode || 'image') !== 'video' && _cv77IsCivitai(raw, parsedJSON)) {
        _lastRawTextForLoraLinks = raw || '';
        var parsed = _cv77ParseCivitai(raw || '', parsedJSON || null);
        if (typeof mergeSharedExtrasIntoParsedV4 === 'function') {
          try { mergeSharedExtrasIntoParsedV4(parsed, raw || '', parsedJSON || null, mode || 'image'); } catch(e) {}
        }
        if (typeof renderParsedV4 === 'function') renderParsedV4(parsed);
        return;
      }
      window._lastCivitaiParsedV77 = null;
      return _baseProcess77.apply(this, arguments);
    };
  }

  if (typeof renderTopV4 === 'function') {
    var _baseRenderTop77 = renderTopV4;
    renderTopV4 = function(parsed){
      var ret = _baseRenderTop77.apply(this, arguments);
      try {
        if (parsed && parsed.source === 'Civitai' && parsed._civitai && parsed._civitai.checkpointVersionId && topbar) {
          var rows = topbar.querySelectorAll('.topbar-row');
          var cpRow = rows && rows.length ? rows[0] : null;
          var id = parsed._civitai.checkpointVersionId;
          var name = (parsed.models && parsed.models.checkpoint) ? parsed.models.checkpoint : 'Civitai checkpoint';
          if (cpRow) {
            cpRow.innerHTML = '<span class="label">Checkpoint:</span> <a href="' + _cv77VersionHref(id) + '" target="_blank" rel="noopener noreferrer" class="checkpoint-civitai-link available" title="Open checkpoint version on Civitai">' + _cv77Safe(name) + '</a>';
            var a = cpRow.querySelector('a');
            if (a) a.onclick = function(e){ if (e) e.preventDefault(); _cv77OpenVersion(id, name, a); return false; };
          }
        }
      } catch(e) {}
      return ret;
    };
  }

  if (typeof renderLoraListV4 === 'function') {
    var _baseRenderLora77 = renderLoraListV4;
    renderLoraListV4 = function(rows, rawText, checkpointContext){
      var civ = window._lastCivitaiParsedV77;
      if (!civ || civ.source !== 'Civitai' || !Array.isArray(rows) || !rows.length) {
        return _baseRenderLora77.apply(this, arguments);
      }
      var list = document.getElementById('loraList');
      var box = document.getElementById('loraBox');
      if (!list || !box) return _baseRenderLora77.apply(this, arguments);
      list.innerHTML = '';
      rows.forEach(function(txt){
        var div = document.createElement('div');
        div.className = 'item';
        var id = civ._civitai && civ._civitai.loraVersions ? civ._civitai.loraVersions[_cv77NormKey(txt)] : '';
        if (id) {
          var a = document.createElement('a');
          a.href = _cv77VersionHref(id);
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.className = 'lora-civitai-link available';
          a.textContent = txt;
          a.title = 'Open exact LoRA version from Civitai metadata';
          a.onclick = function(e){ if (e) e.preventDefault(); _cv77OpenVersion(id, txt, a); return false; };
          div.appendChild(a);
        } else {
          div.textContent = txt;
        }
        list.appendChild(div);
      });
      box.style.display = rows.length ? 'block' : 'none';
};
  }

  window.pngReaderCivitaiForceParseV77 = {
    isCivitai: _cv77IsCivitai,
    parse: _cv77ParseCivitai
  };




   Pipeline: extract raw metadata once -> detect source once -> route to the
   matching parser. Civitai is detected before Stable Diffusion because Civitai
   generator metadata also contains the normal SD "Steps/Sampler/CFG" tail.
*/
(function(){
  function _v78Str(v){ return String(v === undefined || v === null ? '' : v); }
  function _v78Clean(v){ return (typeof cleanName === 'function') ? cleanName(v) : _v78Str(v).replace(/\\/g,'/').split('/').pop().replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i,'').replace(/_/g,' ').trim(); }
  function _v78Prompt(v){ return (typeof cleanPrompt === 'function') ? cleanPrompt(v) : _v78Str(v).replace(/\\n/g,'\n').replace(/\\"/g,'"').trim(); }
  function _v78MakeParsed(source){ return (typeof makeParsedV4 === 'function') ? makeParsedV4(source) : { source: source, models:{checkpoint:'',vae:'',clipText:''}, params:[], loras:[], extras:[], prompts:{positive:'',negative:'',characters:[]} }; }
  function _v78AddParam(rows, label, value){
    value = _v78Str(value).trim();
    if (!value || value === 'undefined' || value === 'null') return;
    if (typeof addParamV4 === 'function') addParamV4(rows, label, value);
    else rows.push([label, value]);
  }
  function _v78AddSize(rows, size){
    size = _v78Str(size).trim();
    if (!size) return;
    if (typeof addSizeParamV4 === 'function') addSizeParamV4(rows, size, '', '');
    else rows.push(['Size', size]);
  }
  function _v78Grab(text, re){ var m = _v78Str(text).match(re); return m ? (m[1] || '') : ''; }
  function _v78Norm(v){ return _v78Str(v).toLowerCase().replace(/\s+/g,' ').trim(); }
  function _v78PushUnique(arr, value){
    value = _v78Str(value).trim();
    if (!value) return;
    var key = _v78Norm(value);
    if (!arr.some(function(x){ return _v78Norm(x) === key; })) arr.push(value);
  }
  function _v78FindBalanced(text, start, openChar, closeChar){
    var s = _v78Str(text);
    var depth = 0, inString = false, escape = false;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return '';
  }
  function _v78JsonAfterLabel(text, label, openChar, closeChar){
    var s = _v78Str(text);
    var re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'i');
    var m = re.exec(s);
    if (!m) return null;
    var start = s.indexOf(openChar, m.index + m[0].length);
    if (start < 0) return null;
    var raw = _v78FindBalanced(s, start, openChar, closeChar);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
  }
  function _v78LooksCivitai(text, json){
    var s = _v78Str(text);
    if (/\bCivitai\s+(resources|metadata)\s*:/i.test(s)) return true;
    if (json && typeof json === 'object') {
      if (json.ecosystem && (json.workflow || json.outputFormat || json.output || json.resources)) return true;
      if (Array.isArray(json.resources) && json.resources.some(function(r){ return r && (r.modelVersionId || r.id || /checkpoint|lora|textual|embed/i.test(_v78Str(r.type))); })) return true;
    }
    return false;
  }
  function _v78DetectSource(text, json, mode){
    var s = _v78Str(text);
    if ((mode || 'image') === 'video') return 'ComfyUI (Video)';
    if (_v78LooksCivitai(s, json)) return 'Civitai';
    if (typeof isSwarmJSON === 'function' && isSwarmJSON(json)) return 'Stable Diffusion (SwarmUI)';
    if (s.indexOf('"sui_image_params"') !== -1 || s.indexOf('"sui_models"') !== -1 || /swarm_version/i.test(s)) return 'Stable Diffusion (SwarmUI)';
    var comfyJson = json && typeof json === 'object' && Object.values(json || {}).some(function(n){ return n && typeof n === 'object' && n.class_type; });
    if (s.indexOf('class_type') !== -1 || comfyJson) return 'ComfyUI';
    if (json && (json.v4_prompt !== undefined || json.uc !== undefined || json.noise_schedule !== undefined)) return 'NovelAI';
    if (/novelai/i.test(s)) return 'NovelAI';
    if (/\bSteps:\s*\d/i.test(s) || /\bSampler:\s*[^,\n]+/i.test(s) || /\bCFG scale:\s*[\d.]/i.test(s) || /\bModel hash:\s*/i.test(s)) return 'Stable Diffusion';
    return 'Unknown';
  }
  function _v78ResourceNameFromMaps(r, lookup){
    if (!r) return '';
    var id = _v78Str(r.modelVersionId || r.id || '').trim();
    var full = id && lookup ? lookup[id] : null;
    if (full) r = Object.assign({}, full, r);
    var name = _v78Str(r.modelName || r.name || '').trim();
    var ver = _v78Str(r.modelVersionName || r.versionName || '').trim();
    if (name && ver) return name + ' | Version: ' + ver;
    return name || ver || (id ? ('Version ID: ' + id) : '');
  }
  function _v78VersionHref(versionId){
    var api = (typeof PNG_CIVITAI_API !== 'undefined') ? PNG_CIVITAI_API : 'https://civitai.com/api/v1/';
    versionId = _v78Str(versionId).trim();
    return versionId ? (api + 'model-versions/' + encodeURIComponent(versionId)) : 'https://civitai.com/';
  }
  function _v78ParseCivitai(text, json){
    text = _v78Str(text);
    var explicitResources = _v78JsonAfterLabel(text, 'Civitai resources', '[', ']');
    if (!Array.isArray(explicitResources)) explicitResources = [];
    var meta = _v78JsonAfterLabel(text, 'Civitai metadata', '{', '}') || (_v78LooksCivitai(text, json) && json && typeof json === 'object' ? json : {}) || {};
    var metaResources = Array.isArray(meta.resources) ? meta.resources : [];

    var lookupByVersion = {};
    explicitResources.forEach(function(r){
      var id = _v78Str(r && (r.modelVersionId || r.id || '')).trim();
      if (id) lookupByVersion[id] = r;
    });

    var resources = explicitResources.slice();
    metaResources.forEach(function(r){
      if (!r) return;
      var id = _v78Str(r.modelVersionId || r.id || '').trim();
      var already = id && resources.some(function(x){ return _v78Str(x && (x.modelVersionId || x.id || '')).trim() === id; });
      if (!already) resources.push(r);
    });

    var out = _v78MakeParsed('Civitai');
    out._civitai = { metadata: meta, resources: resources, checkpointVersionId: '', loraVersions: {} };

    var checkpoint = resources.find(function(r){ return r && /checkpoint/i.test(_v78Str(r.type)); });
    if (checkpoint) {
      out.models.checkpoint = _v78ResourceNameFromMaps(checkpoint, lookupByVersion) || 'Civitai checkpoint';
      out._civitai.checkpointVersionId = _v78Str(checkpoint.modelVersionId || checkpoint.id || '').trim();
    } else {
      out.models.checkpoint = _v78Clean(_v78Grab(text, /(?:^|[,\n])\s*Model\s*:\s*([^,\n]+)/i) || _v78Grab(text, /(?:^|[,\n])\s*Checkpoint\s*:\s*([^,\n]+)/i) || '---');
    }

    resources.forEach(function(r){
      if (!r) return;
      var type = _v78Str(r.type).toLowerCase();
      var line = _v78ResourceNameFromMaps(r, lookupByVersion);
      var weight = r.weight !== undefined ? r.weight : r.strength;
      if (weight !== undefined && weight !== null && _v78Str(weight) !== '') line += ' | Weight: ' + weight;
      var id = _v78Str(r.modelVersionId || r.id || '').trim();
      if (/lora/.test(type)) {
        _v78PushUnique(out.loras, line || (id ? ('LoRA Version ID: ' + id) : 'LoRA'));
        if (id) out._civitai.loraVersions[_v78Norm(line || ('LoRA Version ID: ' + id))] = id;
      } else if (/embed|textual/.test(type)) {
        _v78PushUnique(out.extras, 'Embedding: ' + (line || (id ? ('Version ID: ' + id) : 'Civitai embedding')));
      }
    });

    var w = meta.width || (meta.aspectRatio && meta.aspectRatio.width) || _v78Grab(text, /Size:\s*(\d+)x\d+/i);
    var h = meta.height || (meta.aspectRatio && meta.aspectRatio.height) || _v78Grab(text, /Size:\s*\d+x(\d+)/i);
    var size = (w && h) ? (w + ' x ' + h) : _v78Grab(text, /Size:\s*([^,\n]+)/i);

    _v78AddParam(out.params, 'Steps', meta.steps || _v78Grab(text, /Steps:\s*([^,\n]+)/i));
    _v78AddParam(out.params, 'CFG', meta.cfgScale || meta.cfgscale || meta.cfg || _v78Grab(text, /CFG scale:\s*([^,\n]+)/i));
    _v78AddParam(out.params, 'Seed', meta.seed || _v78Grab(text, /Seed:\s*([^,\n]+)/i));
    _v78AddParam(out.params, 'Clip Skip', meta.clipSkip || meta.clip_skip || _v78Grab(text, /Clip skip:\s*([^,\n]+)/i));
    _v78AddSize(out.params, size);
    _v78AddParam(out.params, 'Sampler', meta.sampler || _v78Grab(text, /Sampler:\s*([^,\n]+)/i));
    _v78AddParam(out.params, 'Scheduler', meta.scheduler || meta.scheduleType || _v78Grab(text, /Schedule type:\s*([^,\n]+)/i));

    if (meta.workflow) _v78PushUnique(out.extras, 'Workflow: ' + meta.workflow);
    if (meta.ecosystem) _v78PushUnique(out.extras, 'Ecosystem: ' + meta.ecosystem);
    if (meta.outputFormat || meta.output) _v78PushUnique(out.extras, 'Output Format: ' + (meta.outputFormat || meta.output));
    var created = _v78Grab(text, /Created Date:\s*([^,\n]+)/i) || meta.createdDate || meta.createdAt || '';
    if (created) _v78PushUnique(out.extras, 'Created Date: ' + created);
    if (Array.isArray(meta.triggerWords) && meta.triggerWords.length) _v78PushUnique(out.extras, 'Trigger Words: ' + meta.triggerWords.join(' | '));

    out.prompts.positive = _v78Prompt(meta.prompt || _v78Grab(text, /^(.*?)(?:Negative prompt:|Steps:|Sampler:|$)/is));
    out.prompts.negative = _v78Prompt(meta.negativePrompt || meta.negative_prompt || _v78Grab(text, /Negative prompt:\s*(.*?)(?:Steps:|Sampler:|CFG scale:|Seed:|Size:|$)/is));

    window._lastCivitaiParsedV77 = out;
    window._lastCivitaiParsedV78 = out;
    return out;
  }

  var _v78PreviousDetectSource = (typeof detectSource === 'function') ? detectSource : null;
  detectSource = function(text, json){
    return _v78DetectSource(text, json, 'image');
  };

  if (typeof sourceLink === 'function') {
    var _v78BaseSourceLink = sourceLink;
    sourceLink = function(name){
      if (name === 'Civitai') return '<a href="https://civitai.com/" target="_blank" rel="noopener noreferrer">Civitai</a>';
      return _v78BaseSourceLink.apply(this, arguments);
    };
  }

  parseMetadataV4 = function(text, json, mode){
    var source = _v78DetectSource(text || '', json || null, mode || 'image');
    if (source === 'Civitai') return _v78ParseCivitai(text || '', json || null);
    window._lastCivitaiParsedV77 = null;




/* ── v13.1 CivitAI resources → LoRA version links ────────────────────────────
   CivitAI generator metadata may provide modelVersionId entries instead of
   Lora hashes. v12.9 routed LoRAs only through hash lookup, so these LoRAs were
   left as name suggestions even though the exact CivitAI version was known.
   This override keeps hash behavior untouched and adds exact modelVersionId
   support for LoRA rows.
*/
(function(){
  if (window.__pngReaderCivitaiLoraResourceLinksV131) return;
  window.__pngReaderCivitaiLoraResourceLinksV131 = true;

  var API = (typeof PNG_CIVITAI_API !== 'undefined') ? PNG_CIVITAI_API : 'https://civitai.com/api/v1/';
  var WEB = (typeof PNG_CIVITAI_MODEL_BASE !== 'undefined') ? PNG_CIVITAI_MODEL_BASE : 'https://civitai.red/models/';
  var SEARCH = 'https://civitai.red/models?types=LORA&query=';
  var versionCache = new Map();

  function safe(v){ return String(v === undefined || v === null ? '' : v); }
  function norm(v){
    return safe(v)
      .replace(/\s*\|\s*Weight\s*:.+$/i, '')
      .replace(/\s*\|\s*Clip\s*:.+$/i, '')
      .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, '')
      .replace(/^\s*<lora:/i, '')
      .replace(/["']/g, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  function compact(v){ return norm(v).replace(/[^a-z0-9]+/g, ''); }
  function displayNameFromLine(txt){
    return safe(txt)
      .replace(/\s*\|\s*Weight\s*:.+$/i, '')
      .replace(/\s*\|\s*Clip\s*:.+$/i, '')
      .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i, '')
      .trim();
  }
  function suggestionQueryFromLine(txt){
    return displayNameFromLine(txt)
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/[<>{}\[\]()`"']/g, ' ')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function findBalanced(s, start, openChar, closeChar){
    var depth = 0, inString = false, escape = false;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return '';
  }
  function jsonAfterLabel(text, label, openChar, closeChar){
    var s = safe(text);
    var idx = s.search(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'i'));
    if (idx < 0) return null;
    var colon = s.indexOf(':', idx);
    var start = s.indexOf(openChar, colon + 1);
    if (start < 0) return null;
    var raw = findBalanced(s, start, openChar, closeChar);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
  }
  function resourceDisplay(r){
    if (!r) return '';
    var name = safe(r.modelName || r.name || '').trim();
    var ver = safe(r.modelVersionName || r.versionName || '').trim();
    if (name && ver) return name + ' | Version: ' + ver;
    return name || ver || '';
  }
  function collectCivitaiLoraVersions(raw){
    var entries = [];
    function addKey(map, key, id){
      key = norm(key);
      if (key && id && !map.has(key)) map.set(key, id);
    }
    var exact = new Map();
    var compactEntries = [];
    function addEntry(label, id){
      label = safe(label).trim();
      id = safe(id).trim();
      if (!label || !id) return;
      addKey(exact, label, id);
      compactEntries.push({ key: compact(label), id: id });
    }
    var resources = jsonAfterLabel(raw, 'Civitai resources', '[', ']');
    if (!Array.isArray(resources)) resources = [];
    var meta = jsonAfterLabel(raw, 'Civitai metadata', '{', '}') || null;
    if (meta && Array.isArray(meta.resources)) {
      meta.resources.forEach(function(r){
        if (!r) return;
        var id = safe(r.modelVersionId || r.id || '').trim();
        if (!id) return;
        var already = resources.some(function(x){ return safe(x && (x.modelVersionId || x.id || '')).trim() === id; });
        if (!already) resources.push(r);
      });
    }
    resources.forEach(function(r){
      if (!r || !/lora/i.test(safe(r.type))) return;
      var id = safe(r.modelVersionId || r.versionId || r.id || '').trim();
      if (!id) return;
      var display = resourceDisplay(r);
      var weight = r.weight !== undefined ? r.weight : r.strength;
      var displayWithWeight = display;
      if (weight !== undefined && weight !== null && safe(weight) !== '') displayWithWeight += ' | Weight: ' + weight;
      [display, displayWithWeight, r.modelName, r.modelVersionName, r.name, r.versionName].forEach(function(v){ addEntry(v, id); });
    });
    return { exact: exact, compactEntries: compactEntries };
  }
  function findVersionForLine(txt, versionLookup){
    if (!versionLookup) return '';
    var names = [displayNameFromLine(txt), txt];
    for (var i = 0; i < names.length; i++) {
      var key = norm(names[i]);
      if (key && versionLookup.exact.has(key)) return versionLookup.exact.get(key);
    }
    var comps = names.map(compact).filter(Boolean);
    for (var c = 0; c < comps.length; c++) {
      var matches = versionLookup.compactEntries.filter(function(e){ return e.key && e.key === comps[c]; });
      var ids = [];
      matches.forEach(function(e){ if (ids.indexOf(e.id) === -1) ids.push(e.id); });
      if (ids.length === 1) return ids[0];
    }
    return '';
  }
  function getHashForLine(txt, hashMap){
    var name = displayNameFromLine(txt);
    var hash = '';
    try {
      if (typeof _loraLinkNormName === 'function') {
        hash = hashMap.get(_loraLinkNormName(name)) || hashMap.get(_loraLinkNormName(txt)) || '';
      } else {
        hash = hashMap.get(norm(name)) || hashMap.get(norm(txt)) || '';
      }
    } catch(e) {}
    if (!hash) {
      var m = safe(txt).match(/<lora:([^:>]+):?[^>]*>/i);
      if (m) {
        try { hash = hashMap.get(typeof _loraLinkNormName === 'function' ? _loraLinkNormName(m[1]) : norm(m[1])) || ''; } catch(e) {}
      }
    }
    return safe(hash).trim();
  }
