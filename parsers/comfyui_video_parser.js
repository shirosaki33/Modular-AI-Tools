/* ── ComfyUI Video Parser (v5.9 / v8.9 / v9.5 / v9.6) ────────────────────
   Detects and parses ComfyUI video workflows (WanVideo, LTXV, HunyuanVideo,
   AnimateDiff, SVD). Also handles WEBP metadata extraction, relaxed JSON
   parsing for NaN/Infinity values, and ComfyUI extras/details cleanup.
   Load AFTER comfy.js and BEFORE the generic fallback dispatcher. */

function collectComfyVideoOutputV4(graph, facts){
    _comfyVideoForEachNode(graph, function(node){
      var type = _comfyVideoType(node);
      var inp = node.inputs || {};
      var wv = _comfyVideoWidgets(node);
      if (/VHS_VideoCombine|VideoCombine|SaveVideo/i.test(type)) {
        var parts = [];
        var fmt = inp.format || inp.container || (typeof wv[0] === 'string' ? wv[0] : '');
        var fps = _comfyVideoResolve(graph, inp.frame_rate, ['value','fps','float','number','Xi','Xf']);
        var crf = inp.crf;
        if (fmt) parts.push(String(fmt).replace(/^video\//i, '').toUpperCase());
        if (fps !== undefined && fps !== null && String(fps).trim() !== '') parts.push(_comfyVideoFmt(fps) + ' fps');
        if (crf !== undefined && crf !== null && String(crf).trim() !== '') parts.push('CRF ' + _comfyVideoFmt(crf));
        if (parts.length) facts.output = 'Video Output: ' + parts.join(' | ');
      }
    });
  }
  function collectWanVideoHelpersV4(graph, facts){
    var painter = _comfyVideoFindNodes(graph, /PainterFLF2V/i)[0] || null;
    var size = '';
    var frames = '';
    var motion = '';
    if (painter) {
      var inpP = painter.node.inputs || {};
      var wvP = _comfyVideoWidgets(painter.node, painter.id);
      var w = _comfyVideoResolve(graph, inpP.width, ['width','value','Xi','Xf']);
      var h = _comfyVideoResolve(graph, inpP.height, ['height','value','Xi','Xf']);
      if (!(Number(w) > 0 && Number(h) > 0) && Number(wvP[0]) > 0 && Number(wvP[1]) > 0) { w = wvP[0]; h = wvP[1]; }
      if (Number(w) > 0 && Number(h) > 0) size = Math.round(Number(w)) + ' x ' + Math.round(Number(h));
      frames = _comfyVideoResolve(graph, inpP.length, ['value','Xi','Xf']);
      if ((frames === '' || frames === undefined) && wvP[2] !== undefined) frames = wvP[2];
      motion = _comfyVideoResolve(graph, inpP.motion_amplitude, ['value','Xi','Xf']);
      if ((motion === '' || motion === undefined) && wvP[4] !== undefined) motion = wvP[4];
    }
    var fpsNode = _comfyVideoFirstByTitle(graph, /^Frame rate$/i);
    var fps = fpsNode ? _comfyVideoNodeValue(graph, fpsNode.node, fpsNode.id, ['value','Xi','Xf'], 0) : '';
    var durNode = _comfyVideoFirstByTitle(graph, /^Duration$/i);
    var duration = durNode ? _comfyVideoNodeValue(graph, durNode.node, durNode.id, ['value','Xi','Xf'], 0) : '';
    var speedNode = _comfyVideoFirstByTitle(graph, /^Speed$/i);
    var speed = speedNode ? _comfyVideoNodeValue(graph, speedNode.node, speedNode.id, ['value','Xi','Xf'], 0) : '';

    var samplers = _comfyVideoFindNodes(graph, /ClownsharKSampler_Beta/i);
    var primary = null;
    var primaryScore = -99999;
    for (var i = 0; i < samplers.length; i++) {
      var t = _comfyVideoTitle(samplers[i].node);
      var si = samplers[i].node.inputs || {};
      var sc = 0;
      if (/ClownsharKSampler\s+High/i.test(t)) sc += 300;
      if (/\bHigh\b/i.test(t)) sc += 120;
      if (/\bLow\b/i.test(t)) sc -= 80;
      if (/Sampler\s*2/i.test(t)) sc -= 120;
      if (/Sampler\s*3/i.test(t)) sc -= 260;
      if (/resample/i.test(String(si.sampler_mode || ''))) sc -= 50;
      if (/beta/i.test(String(si.scheduler || ''))) sc -= 60;
      var stv = Number(_comfyVideoResolve(graph, si.steps, ['steps','value','Xi','Xf']));
      var dnv = Number(_comfyVideoResolve(graph, si.denoise, ['denoise','value']));
      if (Number.isFinite(stv) && stv >= 2) sc += 30;
      if (Number.isFinite(stv) && stv <= 1) sc -= 100;
      if (Number.isFinite(dnv) && dnv >= 0.7) sc += 20;
      if (Number.isFinite(dnv) && dnv < 0.35) sc -= 80;
      if (sc > primaryScore) { primary = samplers[i]; primaryScore = sc; }
    }
    var p = { size:size };
    if (primary) {
      var inp = primary.node.inputs || {};
      p.steps = _comfyVideoResolve(graph, inp.steps, ['steps','value','Xi','Xf']);
      p.cfg = _comfyVideoResolve(graph, inp.cfg, ['cfg','value','Xi','Xf']);
      p.seed = _comfyVideoResolve(graph, inp.seed, ['seed','noise_seed','value','Xi','Xf']);
      p.sampler = _comfyVideoResolve(graph, inp.sampler_name || inp.sampler, ['sampler_name','sampler','value']);
      p.scheduler = _comfyVideoResolve(graph, inp.scheduler, ['scheduler','value']);
      p.denoise = _comfyVideoResolve(graph, inp.denoise, ['denoise','value']);
    }
    var stepsNode = _comfyVideoFirstByTitle(graph, /^Steps$/i);
    var sliderSteps = stepsNode ? _comfyVideoNodeValue(graph, stepsNode.node, stepsNode.id, ['steps','value','Xi','Xf'], 0) : '';
    if (sliderSteps !== '' && (!p.steps || Number(p.steps) <= 1)) p.steps = sliderSteps;
    facts.params = _comfyVideoBuildParams(p);

    var info = [];
    if (size) info.push('Size: ' + size);
    if (frames !== '' && frames !== undefined) info.push('Frames: ' + _comfyVideoFmt(frames));
    if (duration !== '' && duration !== undefined) info.push('Duration: ' + _comfyVideoFmt(duration) + 's');
    if (fps !== '' && fps !== undefined) info.push('FPS: ' + _comfyVideoFmt(fps));
    if (motion !== '' && motion !== undefined) info.push('Motion: ' + _comfyVideoFmt(motion));
    if (speed !== '' && speed !== undefined) info.push('Speed: ' + _comfyVideoFmt(speed));
    if (info.length) _comfyVideoAddUnique(facts.lines, 'Wan Settings: ' + info.join(' | '));
    if (primary && (p.sampler || p.scheduler || p.denoise)) {
      var sp = [];
      if (p.sampler) sp.push(_comfyVideoText(p.sampler));
      if (p.scheduler) sp.push('Scheduler: ' + _comfyVideoText(p.scheduler));
      if (p.denoise) sp.push('Denoise: ' + _comfyVideoFmt(p.denoise));
      _comfyVideoAddUnique(facts.lines, 'Wan Sampling: ' + sp.join(' | '));
    }

    var nags = _comfyVideoFindNodes(graph, /WanVideoNAG/i);
    if (nags.length) {
      var ni = nags[0].node.inputs || {};
      var np = [];
      if (ni.nag_scale !== undefined) np.push('Scale: ' + _comfyVideoFmt(ni.nag_scale));
      if (ni.nag_alpha !== undefined) np.push('Alpha: ' + _comfyVideoFmt(ni.nag_alpha));
      if (ni.nag_tau !== undefined) np.push('Tau: ' + _comfyVideoFmt(ni.nag_tau));
      if (np.length) _comfyVideoAddUnique(facts.lines, 'Wan NAG: ' + np.join(' | '));
    }
    var enh = _comfyVideoFindNodes(graph, /WanVideoEnhanceAVideoKJ/i);
    if (enh.length) {
      var ep = [];
      enh.forEach(function(e){
        var label = /low/i.test(_comfyVideoTitle(e.node)) ? 'Low' : (/high/i.test(_comfyVideoTitle(e.node)) ? 'High' : 'Weight');
        var weight = (e.node.inputs || {}).weight;
        if (weight !== undefined) ep.push(label + ': ' + _comfyVideoFmt(weight));
      });
      if (ep.length) _comfyVideoAddUnique(facts.lines, 'Wan Enhance: ' + ep.join(' | '));
    }
  }
  function collectLTXVVideoHelpersV4(graph, facts){
    var size = '';
    var dimNode = _comfyVideoFindNodes(graph, /SDXL Empty Latent Image|Video Width|Video Height|Video Width and Hight/i)[0] || null;
    if (dimNode) {
      var dims = _comfyVideoText((dimNode.node.inputs || {}).dimensions || '').match(/(\d+)\s*[x×]\s*(\d+)/i);
      if (dims) size = dims[1] + ' x ' + dims[2];
    }
    var empty = _comfyVideoFindNodes(graph, /EmptyLTXVLatentVideo/i)[0] || null;
    var frames = '';
    if (empty) {
      var ei = empty.node.inputs || {};
      frames = _comfyVideoResolve(graph, ei.length, ['value','Xi','Xf']);
      if (!size) {
        var ew = _comfyVideoResolve(graph, ei.width, ['width','value','Xi','Xf']);
        var eh = _comfyVideoResolve(graph, ei.height, ['height','value','Xi','Xf']);
        if (Number(ew) > 0 && Number(eh) > 0) size = Math.round(Number(ew)) + ' x ' + Math.round(Number(eh));
      }
    }
    var prevFrames = _comfyVideoFirstByTitle(graph, /Preview frames/i);
    if (prevFrames) frames = _comfyVideoNodeValue(graph, prevFrames.node, prevFrames.id, ['preview_text','value'], 0) || frames;
    var secNode = _comfyVideoFirstByTitle(graph, /Video seconds|Seconds/i);
    var seconds = secNode ? _comfyVideoNodeValue(graph, secNode.node, secNode.id, ['value','Xi','Xf'], 0) : '';
    var fpsNode = _comfyVideoFirstByTitle(graph, /Video FPS/i);
    var fps = fpsNode ? _comfyVideoNodeValue(graph, fpsNode.node, fpsNode.id, ['value','Xi','Xf'], 0) : '';

    var ks = _comfyVideoFindNodes(graph, /KSamplerSelect/i)[0] || null;
    var sig = _comfyVideoFindNodes(graph, /ManualSigmas/i)[0] || null;
    var cfg = (_comfyVideoFindNodes(graph, /CFGGuider/i)[0] || {}).node;
    var noise = (_comfyVideoFindNodes(graph, /RandomNoise/i)[0] || {}).node;
    var p = { size:size };
    if (sig && sig.node.inputs && sig.node.inputs.sigmas) {
      var nums = _comfyVideoText(sig.node.inputs.sigmas).split(',').map(function(x){ return x.trim(); }).filter(Boolean);
      if (nums.length > 1) p.steps = String(nums.length - 1);
      p.scheduler = 'manual sigmas';
    }
    if (ks) p.sampler = _comfyVideoFirstScalar((ks.node.inputs || {}).sampler_name, _comfyVideoWidgets(ks.node, ks.id)[0]);
    if (cfg) p.cfg = _comfyVideoFirstScalar((cfg.inputs || {}).cfg, _comfyVideoWidgets(cfg)[0]);
    if (noise) p.seed = _comfyVideoFirstScalar((noise.inputs || {}).noise_seed, _comfyVideoWidgets(noise)[0]);
    facts.params = _comfyVideoBuildParams(p);

    var info = [];
    if (size) info.push('Size: ' + size);
    if (frames !== '' && frames !== undefined) info.push('Frames: ' + _comfyVideoFmt(frames));
    if (seconds !== '' && seconds !== undefined) info.push('Duration: ' + _comfyVideoFmt(seconds) + 's');
    if (fps !== '' && fps !== undefined) info.push('FPS: ' + _comfyVideoFmt(fps));
    if (info.length) _comfyVideoAddUnique(facts.lines, 'LTX Settings: ' + info.join(' | '));

    var ups = [];
    _comfyVideoFindNodes(graph, /LatentUpscaleModelLoader/i).forEach(function(e){
      var model = (e.node.inputs || {}).model_name || _comfyVideoWidgets(e.node, e.id)[0] || '';
      if (model) _comfyVideoAddUnique(ups, (typeof cleanName === 'function' ? cleanName(model) : String(model)));
    });
    if (ups.length) _comfyVideoAddUnique(facts.lines, 'Upscale Models: ' + ups.join(' / '));
  }
  function collectComfyVideoAudioV4(graph, facts){
    _comfyVideoForEachNode(graph, function(node){
      var all = _comfyVideoAll(node);
      var inp = node.inputs || {};
      if (/LoadAudio|AudioVAE|LTXVAudio/i.test(all) || inp.audio !== undefined || inp.trim_to_audio === true) facts.audio = true;
      if (/^LoadAudio$/i.test(_comfyVideoType(node)) && inp.audio) facts.audioSource = _comfyVideoText(inp.audio);
    });
  }
  function collectComfyVideoFactsV4(promptGraph, rawText){
    var facts = { isVideo:false, engines:[], lines:[], output:'', audio:false, audioSource:'', params:[] };
    var graph = promptGraph && typeof promptGraph === 'object' ? promptGraph : null;
    if (!graph) graph = {};
    _comfyVideoForEachNode(graph, function(node){
      var all = _comfyVideoAll(node);
      if (/(LTXV|WanVideo|HunyuanVideo|AnimateDiff|VHS_|VideoCombine|SaveVideo|LoadVideo|Stable\s*Video|\bSVD\b|Temporal|PainterFLF2V)/i.test(all)) facts.isVideo = true;
      if (/PainterFLF2V|WanVideo|ClownsharKSampler_Beta/i.test(all)) _comfyVideoAddUnique(facts.engines, 'WanVideo');
      if (/LTXV/i.test(all)) _comfyVideoAddUnique(facts.engines, 'LTXV');
      if (/HunyuanVideo/i.test(all)) _comfyVideoAddUnique(facts.engines, 'HunyuanVideo');
      if (/AnimateDiff|ADE_/i.test(all)) _comfyVideoAddUnique(facts.engines, 'AnimateDiff');
      if (/Stable\s*Video|\bSVD\b/i.test(all)) _comfyVideoAddUnique(facts.engines, 'SVD');
    });
    if (!facts.engines.length && /LTXV/i.test(_comfyVideoText(rawText))) _comfyVideoAddUnique(facts.engines, 'LTXV');
    if (!facts.engines.length && /WanVideo|PainterFLF2V|ClownsharKSampler_Beta/i.test(_comfyVideoText(rawText))) _comfyVideoAddUnique(facts.engines, 'WanVideo');
    if (facts.engines.length) facts.isVideo = true;
    collectComfyVideoOutputV4(graph, facts);
    collectComfyVideoAudioV4(graph, facts);
    if (facts.engines.some(function(x){ return /WanVideo/i.test(x); })) collectWanVideoHelpersV4(graph, facts);
    if (facts.engines.some(function(x){ return /LTXV/i.test(x); })) collectLTXVVideoHelpersV4(graph, facts);
    return facts;
  }
  function cleanComfyVideoExtrasV4(existing, facts){
    var out = [];
    if (facts && facts.engines && facts.engines.length) _comfyVideoAddUnique(out, 'Video / Animation: ' + facts.engines.join(' + '));
    (facts.lines || []).forEach(function(x){ _comfyVideoAddUnique(out, x); });
    if (facts.audioSource) _comfyVideoAddUnique(out, 'Audio Source: ' + facts.audioSource);
    else if (facts.audio) _comfyVideoAddUnique(out, 'Audio: enabled');
    if (facts.output) _comfyVideoAddUnique(out, facts.output);

    // Preserve a few genuinely useful non-video processors if another workflow uses them,
    // but do not preserve generic upscaler/method/sampler noise from disabled video branches.
    (existing || []).forEach(function(row){
      var s = _comfyVideoText(row).trim();
      if (!s || s.indexOf('__HTML__') === 0) return;
      if (/^(Video\s*\/\s*Animation|Mode|Audio|Audio Source|Video Output|Input|Wan Settings|Wan Sampling|Wan Internal Stages|Wan NAG|Wan Enhance|LTX Settings|Upscale Models)\s*:/i.test(s)) return;
      if (/^(Upscaler|Upscale Method|Hirefix|Output Size|Refiner|ControlNet Apply)\s*:/i.test(s)) return;
      if (/\b(VHS|LTXV|WanVideo|PainterFLF2V|HunyuanVideo|AnimateDiff|SVD|Stable Video|Temporal|Context|Switch|Conditioning|Latent|ImgToVideo|VideoCombine|Load Input Video|Load Video|EmptyLTXV|Audio VAE|CropGuides|ManualSigmas|SamplerCustomAdvanced|ClownsharKSampler)\b/i.test(s)) return;
      if (/^(Detail Daemon|SeedVR2|SeedVR2 DiT|SeedVR2 VAE|ADetailer|Face Detailer|ADetailer \/ Detailer)\b/i.test(s)) _comfyVideoAddUnique(out, s);
    });
    return out;
  }
  function cleanComfyVideoParamsV4(rows){
    var out = [], seen = {}, seenSize = false;
    function isSizeRow(label, value){
      label = _comfyVideoText(label).trim();
      value = _comfyVideoText(value).trim();
      if (/^(__SIZE__|Size)$/i.test(label)) return true;
      if (/<span[^>]*class=["']label["'][^>]*>\s*Size\s*:<\/span>/i.test(value)) return true;
      if (/\bSize\s*:\s*\d+\s*[x×]\s*\d+/i.test(value)) return true;
      return false;
    }
    (rows || []).forEach(function(row){
      if (!row || !Array.isArray(row) || row.length < 2) return;
      var label = _comfyVideoText(row[0]).trim();
      var value = _comfyVideoText(row[1]).trim();
      if (!label || !value) return;
      if (isSizeRow(label, value)) {
        if (seenSize) return;
        seenSize = true;
      }
      var key = label.toLowerCase() + '::' + value.toLowerCase().replace(/\s+/g, ' ');
      if (seen[key]) return;
      seen[key] = true;
      out.push(row);
    });
    return out;
  }

function isComfyVideoGraphV4(json, text = "") {
  return !!(collectComfyVideoFactsV4(json || {}, text || "").isVideo);
}

function _comfyVideoBuildParsedV4(text, json, source, facts) {
  const out = makeParsedV4("ComfyUI (Video)");
  const models = collectAllModelLoaders(json || {});
  const mainModel = (models.checkpoints && models.checkpoints.length) ? models.checkpoints : (models.unets || []);
  out.models.checkpoint = joinModelsV4(mainModel);
  out.models.vae = joinModelsV4(models.vaes || []);
  out.models.clipText = joinModelsV4(models.clips || [], models.text_encoders || []);

  out.params = cleanComfyVideoParamsV4((facts && facts.params) || []);
  out.extraParams = [];

  const prompts = json ? collectAllPromptNodes(json) : { positive: "", negative: "", characters: [] };
  out.prompts.positive = prompts.positive || "";
  out.prompts.negative = prompts.negative || "";
  if (!out.prompts.positive && !out.prompts.negative) out.prompts.positive = "[Prompt not available]";

  out.loras = collectAllLoraLoaders(json || {});

  const baseExtras = [];
  collectSmprojExtras(_lastSmprojJSON).forEach(e => baseExtras.push(e));
  collectExtras(json || {}).forEach(e => baseExtras.push(e));
  const wf = normalizeComfyWorkflow(_lastWorkflowJSON);
  if (wf && wf !== json) collectExtras(wf).forEach(e => baseExtras.push(e));
  out.extras = orderComfyExtrasV4(cleanComfyVideoExtrasV4(baseExtras, facts || { isVideo:false, engines:[] }));
  return out;
}

function parseComfyVideoV4(text, json, source) {
  const facts = collectComfyVideoFactsV4(json || {}, text || "");
  return _comfyVideoBuildParsedV4(text || "", json || {}, source || "ComfyUI (Video)", facts);
}

function collectAllParameters(json) {




   Routes video metadata through the same V4 Comfy helpers as PNG/JPG and
   accepts Comfy prompt JSON containing non-standard NaN/Infinity values. */
(function(){
  function v59SanitizeJsonConstants(text) {
    const s = String(text || "");
    let out = "", inString = false, escape = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escape) { out += ch; escape = false; continue; }
      if (ch === "\\") { out += ch; escape = true; continue; }
      if (ch === '"') { out += ch; inString = !inString; continue; }
      if (!inString) {
        const prev = s[i - 1] || "";
        if (s.slice(i, i + 3) === "NaN" && (!prev || !/[A-Za-z0-9_$]/.test(prev)) && !/[A-Za-z0-9_$]/.test(s[i + 3] || "")) {
          out += "null"; i += 2; continue;
        }
        if (s.slice(i, i + 8) === "Infinity" && (!prev || !/[A-Za-z0-9_$]/.test(prev)) && !/[A-Za-z0-9_$]/.test(s[i + 8] || "")) {
          out += "null"; i += 7; continue;
        }
        if (s.slice(i, i + 9) === "-Infinity" && (!prev || !/[A-Za-z0-9_$]/.test(prev)) && !/[A-Za-z0-9_$]/.test(s[i + 9] || "")) {
          out += "null"; i += 8; continue;
        }
      }
      out += ch;
    }
    return out;
  }

  window.parseJsonRelaxedV59 = function(text) {
    if (text === undefined || text === null) return null;
    if (typeof text === "object") return text;
    const raw = String(text || "").trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) {}
    try { return JSON.parse(v59SanitizeJsonConstants(raw)); } catch(e) {}
    return null;
  };

  function v59BalancedEndString(text, start) {
    let depth = 0, inString = false, escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  function v59ExtractBalancedAfterLabel(text, label) {
    const raw = String(text || "");
    const labelIdx = raw.indexOf(label);
    if (labelIdx === -1) return "";
    const start = raw.indexOf("{", labelIdx + label.length);
    if (start === -1) return "";
    const end = v59BalancedEndString(raw, start);
    return end === -1 ? "" : raw.slice(start, end + 1);
  }

  const v59OldTryParseCommentJSON = typeof tryParseCommentJSON === "function" ? tryParseCommentJSON : null;
  tryParseCommentJSON = function(text) {
    if (v59OldTryParseCommentJSON) {
      const old = v59OldTryParseCommentJSON(text);
      if (old) return old;
    }
    if (!text) return null;
    const raw = String(text || "");
    const trimmed = raw.replace(/^parameters[\s\u0000]*/i, "").replace(/^[\s\u0000]+/, "").trim();

    if (trimmed.startsWith("{")) {
      const direct = window.parseJsonRelaxedV59(trimmed);
      if (direct) return direct;
    }

    const promptJson = v59ExtractBalancedAfterLabel(trimmed, "prompt");
    if (promptJson) {
      const parsed = window.parseJsonRelaxedV59(promptJson);
      if (parsed) return parsed;
    }

    const swarmIdx = trimmed.indexOf('"sui_image_params"');
    if (swarmIdx !== -1) {
      let start = trimmed.lastIndexOf("{", swarmIdx);
      while (start !== -1) {
        const end = v59BalancedEndString(trimmed, start);
        if (end !== -1 && end >= swarmIdx) {
          const parsed = window.parseJsonRelaxedV59(trimmed.slice(start, end + 1));
          if (parsed) return parsed;
        }
        start = trimmed.lastIndexOf("{", start - 1);
      }
    }

    const commentJson = v59ExtractBalancedAfterLabel(trimmed, "Comment");
    if (commentJson) {
      const parsed = window.parseJsonRelaxedV59(commentJson);
      if (parsed) return parsed;
    }
    return null;
  };

  const v59OldTryParseWorkflow = typeof tryParseComfyWorkflowJSON === "function" ? tryParseComfyWorkflowJSON : null;
  tryParseComfyWorkflowJSON = function(text) {
    const old = v59OldTryParseWorkflow ? v59OldTryParseWorkflow(text) : null;
    if (old) return old;
    const raw = v59ExtractBalancedAfterLabel(String(text || ""), "workflow");
    return raw ? window.parseJsonRelaxedV59(raw) : null;
  };

  function v59FindBalancedBytes(bytes, start) {
    let depth = 0, inString = false, escape = false;
    for (let i = start; i < bytes.length; i++) {
      const b = bytes[i];
      if (escape) { escape = false; continue; }
      if (b === 0x5C) { escape = true; continue; }
      if (b === 0x22) { inString = !inString; continue; }
      if (inString) continue;
      if (b === 0x7B) depth++;
      else if (b === 0x7D) { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  function v59BytesIndexOf(bytes, pattern, from = 0) {
    const needle = typeof pattern === "string" ? Array.from(pattern).map(c => c.charCodeAt(0)) : pattern;
    outer: for (let i = Math.max(0, from); i <= bytes.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  function v59ByteLastIndexOf(bytes, byteValue, from) {
    for (let i = Math.min(from, bytes.length - 1); i >= 0; i--) if (bytes[i] === byteValue) return i;
    return -1;
  }

  function v59DecodeBytes(bytes, start, end) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(start, end));
  }

  function v59ValidMetadataJson(raw) {
    const parsed = window.parseJsonRelaxedV59(raw);
    return !!(parsed && typeof parsed === "object");
  }

  window.extractWebMComment = function(bytes) {
    if (!bytes || !bytes.length) return null;

    const comment = [67,79,77,77,69,78,84]; // COMMENT
    let idx = 0;
    while ((idx = v59BytesIndexOf(bytes, comment, idx)) !== -1) {
      const limit = Math.min(bytes.length, idx + 4096);
      for (let k = idx + comment.length; k < limit; k++) {
        if (bytes[k] !== 0x7B) continue;
        const end = v59FindBalancedBytes(bytes, k);
        if (end !== -1) {
          const raw = v59DecodeBytes(bytes, k, end + 1);
          if (v59ValidMetadataJson(raw)) return raw;
        }
      }
      idx += comment.length;
    }

    const patterns = ['"prompt"', '"workflow"', '"class_type"', 'PNGReaderGenericMetadata', 'parameters-json', 'smproj'];
    for (const pattern of patterns) {
      let p = 0;
      while ((p = v59BytesIndexOf(bytes, pattern, p)) !== -1) {
        const searchStart = Math.max(0, p - 200000);
        let start = v59ByteLastIndexOf(bytes, 0x7B, p);
        while (start >= searchStart) {
          const end = v59FindBalancedBytes(bytes, start);
          if (end !== -1 && end >= p) {
            const raw = v59DecodeBytes(bytes, start, end + 1);
            if (v59ValidMetadataJson(raw)) return raw;
          }
          start = v59ByteLastIndexOf(bytes, 0x7B, start - 1);
        }
        p += pattern.length;
      }
    }
    return null;
  };

  function v59NormalizeVideoWorkflowCandidate(value) {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value.nodes) && typeof normalizeComfyWorkflow === "function") return normalizeComfyWorkflow(value);
    if (value.nodes && typeof normalizeComfyWorkflow === "function") return normalizeComfyWorkflow(value);
    return value;
  }

  function v59UnpackVideoJson(raw) {
    const out = { outer: null, prompt: null, workflow: null, params: null, smproj: null };
    const outer = window.parseJsonRelaxedV59(raw);
    if (!outer || typeof outer !== "object") return out;
    out.outer = outer;

    if (typeof outer.prompt === "string") out.prompt = window.parseJsonRelaxedV59(outer.prompt);
    else if (outer.prompt && typeof outer.prompt === "object") out.prompt = outer.prompt;

    if (typeof outer.workflow === "string") out.workflow = window.parseJsonRelaxedV59(outer.workflow);
    else if (outer.workflow && typeof outer.workflow === "object") out.workflow = outer.workflow;

    out.params = outer["parameters-json"] || outer.parameters || null;
    out.smproj = outer.smproj || null;

    if (!out.prompt) {
      const directLooksComfy = Object.values(outer).some(v => v && typeof v === "object" && v.class_type);
      if (directLooksComfy || outer.class_type) out.prompt = outer;
    }
    if (!out.prompt && out.workflow) out.prompt = v59NormalizeVideoWorkflowCandidate(out.workflow);
    return out;
  }

  parseWebM = function(bytes, videoType) {
    const raw = extractWebMComment(bytes);
    const ext = String(videoType || "webm").toUpperCase();

    _lastParsedJSON = null;
    _lastWorkflowJSON = null;
    _lastParamsJSON = null;
    _lastSmprojJSON = null;

    if (!raw) {
      fullText.value = "";
      buildTop("", null);
      loraBox.style.display = "none";
      paramBox.style.display = "none";
      extraBox.style.display = "none";
      clearCharBlocks();
      setPromptBox(positiveText, "");
      setPromptBox(negativeText, "");
      updateNegativeVisibility();
      showAlert("No metadata found in this file", "red");
      return;
    }

    const unpacked = v59UnpackVideoJson(raw);
    if (!unpacked.outer && !unpacked.prompt && typeof parseWebMGenericFallbackV4 === "function") {
      return parseWebMGenericFallbackV4(bytes, videoType, raw);
    }

    const promptJSON = unpacked.prompt || null;
    _lastParsedJSON = promptJSON;
    _lastWorkflowJSON = unpacked.workflow || null;
    _lastParamsJSON = unpacked.params || null;
    _lastSmprojJSON = unpacked.smproj || null;

    fullText.value = raw;
    const ok = processMetadataV4(raw, promptJSON, "video");
    if (!ok) return;
    if (typeof window._pngReaderScheduleVideoSizeFallbackV63 === "function") {
      window._pngReaderScheduleVideoSizeFallbackV63();




/* ── v8.9 image input/raw coverage: WEBP + stricter image routing ──────────
   Goal: every supported still-image input can at least populate Raw when the
   metadata is present. PNG keeps tEXt/iTXt/zTXt/eXIf support; JPEG keeps EXIF,
   XMP and comment support; WEBP now reads EXIF, XMP and textual fallback chunks.
*/
(function(){
  function _v89Latin1(bytes){
    if (typeof decodeLatin1 === 'function') return decodeLatin1(bytes || new Uint8Array());
    var out = '';
    bytes = bytes || new Uint8Array();
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }
  function _v89Decode(bytes, enc){
    try { return new TextDecoder(enc || 'utf-8', { fatal:false }).decode(bytes || new Uint8Array()); }
    catch(e){ return ''; }
  }
  function _v89IsWebp(bytes){
    return !!(bytes && bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50);
  }
  function _v89U32LE(bytes, off){
    return ((bytes[off] | (bytes[off+1] << 8) | (bytes[off+2] << 16) | (bytes[off+3] << 24)) >>> 0);
  }
  function _v89LooksUseful(text){
    return /Civitai\s+(resources|metadata)\s*:|PNGReaderGenericMetadata|Negative prompt\s*:|\bSteps\s*:\s*\d+|\bSampler\s*:|\bCFG scale\s*:|<lora:|\bworkflow\b|\bprompt\b|NovelAI|ComfyUI/i.test(String(text || ''));
  }
  function _v89Clean(raw){
    raw = String(raw || '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
    if (typeof cleanupMetadataPayload === 'function') raw = cleanupMetadataPayload(raw);
    return String(raw || '').trim();
  }
  function _v89ExifTextFromWebpChunk(data){
    data = data || new Uint8Array();
    var candidates = [];
    try {
      if (_v89Latin1(data.slice(0, 6)) === 'Exif\u0000\u0000') candidates.push(data);
      else if (_v89Latin1(data.slice(0, 2)) === 'II' || _v89Latin1(data.slice(0, 2)) === 'MM') {
        var pref = new Uint8Array(6 + data.length);
        pref.set([69,120,105,102,0,0], 0); // Exif\0\0
        pref.set(data, 6);
        candidates.push(pref);
      }
    } catch(e) {}

    for (var i = 0; i < candidates.length; i++) {
      try {
        if (typeof jpegExtractExifText === 'function') {
          var arr = jpegExtractExifText(candidates[i]);
          if (arr && arr.length) return arr.join('\n');
        }
      } catch(e) {}
    }

    // Fallback scan catches raw UTF-8/UTF-16 text stored inside unusual EXIF payloads.
    if (typeof decodeExifOrRawMetadataBytes === 'function') {
      try { return decodeExifOrRawMetadataBytes(data) || ''; } catch(e) {}
    }
    var attempts = [_v89Decode(data, 'utf-8'), _v89Decode(data, 'utf-16le'), _v89Decode(data, 'utf-16be'), _v89Latin1(data)];
    for (var j = 0; j < attempts.length; j++) if (_v89LooksUseful(attempts[j])) return attempts[j];
    return '';
  }
  function _v89ProcessImageRaw(raw){
    raw = _v89Clean(raw);
    if (typeof processImageRawMetadataGenericV4 === 'function') {
      return processImageRawMetadataGenericV4(raw, { mode: 'image', noMetadataMessage: 'No metadata found in this file' });
    }
    if (!raw) {
      if (typeof showAlert === 'function') showAlert('No metadata found in this file', 'red');
      if (typeof buildTop === 'function') buildTop('', null);
      if (typeof updateNegativeVisibility === 'function') updateNegativeVisibility();
      return false;
    }
    if (typeof fullText !== 'undefined' && fullText) fullText.value = raw;
    var parsedJSON = (typeof tryParseCommentJSON === 'function') ? tryParseCommentJSON(raw) : null;
    if (typeof processMetadataV4 === 'function') return processMetadataV4(raw, parsedJSON, 'image');
    return false;
  }

  function _v121ShowNoWebpMetadataAlert(){
    try {
      if (typeof clearMetadataDisplayForErrorV4 === 'function') clearMetadataDisplayForErrorV4('', false);
      else {
        if (typeof fullText !== 'undefined' && fullText) fullText.value = '';
        if (typeof buildTop === 'function') buildTop('', null);
        if (typeof updateNegativeVisibility === 'function') updateNegativeVisibility();
      }
    } catch(e) {}
    if (typeof showAlert === 'function') showAlert('No metadata found in this file', 'red');
    return false;
  }

  window.parseWEBP = parseWEBP = function(bytes){
    bytes = bytes || new Uint8Array();
    if (!_v89IsWebp(bytes)) {
      try { if (typeof clearMetadataDisplayForErrorV4 === 'function') clearMetadataDisplayForErrorV4('', false); } catch(e) {}
      if (typeof showAlert === 'function') showAlert('Invalid WEBP file', 'red');
      return;
    }

    var rawParts = [];
    var pos = 12;
    while (pos + 8 <= bytes.length) {
      var type = _v89Latin1(bytes.slice(pos, pos + 4));
      var size = _v89U32LE(bytes, pos + 4);
      var start = pos + 8;
      var end = start + size;
      if (end > bytes.length) break;
      var data = bytes.slice(start, end);

      try {
        if (type === 'EXIF') {
          var exifText = _v89ExifTextFromWebpChunk(data);
          if (exifText && exifText.trim()) rawParts.push(exifText);
        } else if (type === 'XMP ') {
          var xmp = _v89Decode(data, 'utf-8') || _v89Latin1(data);
          if (xmp && xmp.trim()) rawParts.push(xmp);
        } else if (/^(ICCP|ANIM|ANMF|ALPH|VP8 |VP8L|VP8X)$/i.test(type)) {
          // Binary image/animation chunks — never dump these into Raw.
        } else {
          var txt = _v89Decode(data, 'utf-8') || _v89Latin1(data);
          if (_v89LooksUseful(txt)) rawParts.push(txt);
        }
      } catch(e) {}

      pos = end + (size % 2); // RIFF chunks are padded to even size.
    }

    var raw = rawParts.join('\n\n');
    if (!raw && typeof decodeExifOrRawMetadataBytes === 'function') {
      try { raw = decodeExifOrRawMetadataBytes(bytes) || ''; } catch(e) {}
    }
    raw = _v89Clean(raw);
    if (!raw) return _v121ShowNoWebpMetadataAlert();
    _v89ProcessImageRaw(raw);
  };
})();





    if (j && Object.keys(j).some(function(id){ return j[id] && j[id].class_type; })) return j;
    j = _v95NormalizeWorkflowJson(wf);
    if (j && Object.keys(j).some(function(id){ return j[id] && j[id].class_type; })) return j;
    return null;
  }
  function _v95Sinks(json){
    var ids = [];
    Object.keys(json || {}).forEach(function(id){
      var node = json[id];
      if (!node) return;
      var type = _v95Text(node.class_type || '');
      var title = _v95Text(_v95NodeTitle(node) || '');
      var all = type + ' ' + title;
      if (/SaveImage|PreviewImage|VHS_VideoCombine|VideoCombine|SaveAnimatedWEBP|SaveWEBM|SaveMP4|SaveVideo|VideoSave|Image Save|Export/i.test(all)) ids.push(String(id));
    });
    if (!ids.length) {
      Object.keys(json || {}).forEach(function(id){
        var n = json[id];
        var all = _v95Text(n && n.class_type || '') + ' ' + _v95Text(_v95NodeTitle(n) || '');
        if (/KSampler|SamplerCustom|Sampler/i.test(all) && !/SamplerSelect|Scheduler/i.test(all)) ids.push(String(id));
      });
    }
    return ids;
  }
  function _v95ActiveLinks(json, node){
    try { if (typeof _comfyActiveLinkedInputsV4 === 'function') return _comfyActiveLinkedInputsV4(json, node) || []; } catch(e) {}
    var inp = (node && node.inputs) || {};
    return Object.keys(inp).map(function(k){ return inp[k]; }).filter(Array.isArray);
  }
  function _v95ActiveNodeSet(json){
    var active = new Set();
    function walk(id, depth){
      id = String(id || '');
      if (!id || !json || !json[id] || active.has(id) || depth > 120) return;
      active.add(id);
      _v95ActiveLinks(json, json[id]).forEach(function(v){ walk(_v95LinkId(v), depth + 1); });
    }
    _v95Sinks(json).forEach(function(id){ walk(id, 0); });
    return active;
  }
  function _v95Resolve(json, v, keys){
    try { if (typeof _resolveComfyInputValue === 'function') return _resolveComfyInputValue(json, v, keys || ['value']); } catch(e) {}
    return Array.isArray(v) ? '' : v;
  }
  function _v95ResolveSize(json, node){
    var inp = (node && node.inputs) || {};
    var pair = null;
    try {
      if (typeof _sizePair === 'function') pair = _sizePair(inp.width || inp.target_width || inp.upscale_width || inp.W || '', inp.height || inp.target_height || inp.upscale_height || inp.H || '');
    } catch(e) {}
    if (!pair) return '';
    return pair.w + ' x ' + pair.h;
  }
  function _v95CollectActiveComfyDetails(json){
    var out = [];
    if (!json || typeof json !== 'object') return out;
    var active = _v95ActiveNodeSet(json);
    Object.keys(json).forEach(function(id){
      if (!active.has(String(id))) return;
      var node = json[id];
      if (!node) return;
      var type = _v95Text(node.class_type || '');
      var title = _v95Text(_v95NodeTitle(node) || '');
      var all = type + ' ' + title;
      var inp = node.inputs || {};
      var wv = _v95Widgets(node);

      if (/DetailDaemon(?:Sampler|GraphSigmas)?Node|Detail Daemon/i.test(all)) {
        var parts = [];
        _v95Kv(parts, 'Amount', _v95First(inp.detail_amount, wv[0]));
        var st = _v95First(inp.start, wv[1]);
        var ed = _v95First(inp.end, wv[2]);
        if (st !== '' || ed !== '') parts.push('Range: ' + (st !== '' ? st : '?') + '-' + (ed !== '' ? ed : '?'));
        _v95Kv(parts, 'Bias', _v95First(inp.bias, wv[3]));
        _v95Kv(parts, 'Exponent', _v95First(inp.exponent, wv[4]));
        _v95Kv(parts, /GraphSigmas/i.test(type) ? 'CFG Scale' : 'CFG Override', _v95First(inp.cfg_scale_override, inp.cfg_scale, wv[9]), { skipZero:true });
        _v95Add(out, 'Detail Daemon' + (parts.length ? ': ' + parts.join(' | ') : ''));
      }

      if (/SeedVR2VideoUpscaler/i.test(all)) {
        var sp = [];
        _v95Kv(sp, 'Resolution', _v95First(inp.resolution, wv[2]));
        _v95Kv(sp, 'Max', _v95First(inp.max_resolution, wv[3]), { skipZero:true });
        _v95Kv(sp, 'Batch', _v95First(inp.batch_size, wv[4]));
        _v95Kv(sp, 'Color', _v95First(inp.color_correction, wv[6]));
        _v95Add(out, 'SeedVR2' + (sp.length ? ': ' + sp.join(' | ') : ''));
      }
      if (/SeedVR2LoadDiTModel/i.test(all)) {
        var dm = _v95First(inp.model, wv[0]);
        var dp = [];
        if (_v95IsRealName(dm)) dp.push(_v95CleanName(dm));
        _v95Kv(dp, 'Blocks Swap', _v95First(inp.blocks_to_swap, wv[2]), { skipZero:true });
        _v95Kv(dp, 'Attention', _v95First(inp.attention_mode, wv[6], wv[7]));
        if (dp.length) _v95Add(out, 'SeedVR2 DiT: ' + dp.join(' | '));
      }
      if (/SeedVR2LoadVAEModel/i.test(all)) {
        var vm = _v95First(inp.model, wv[0]);
        var vp = [];
        if (_v95IsRealName(vm)) vp.push(_v95CleanName(vm));
        _v95Kv(vp, 'Encode Tile', _v95First(inp.encode_tile_size, wv[3]));
        _v95Kv(vp, 'Decode Tile', _v95First(inp.decode_tile_size, wv[6]));
        if (vp.length) _v95Add(out, 'SeedVR2 VAE: ' + vp.join(' | '));
      }

      if (/UpscaleModelLoader|Upscale Model Loader/i.test(all)) {
        var upModel = _v95First(inp.model_name, inp.upscale_model, inp.upscale_model_name, wv[0]);
        if (_v95IsRealName(upModel)) _v95Add(out, 'Upscaler: ' + _v95CleanName(upModel));
      }
      if (/UltimateSDUpscale|Ultimate SD Upscale/i.test(all)) _v95Add(out, 'Ultimate SD Upscale');
      if (/ImageScale|ImageResize|Resize Image|LatentUpscale|UpscaleLatent|Scale Image|ImageScaleBy/i.test(all)) {
        var size = _v95ResolveSize(json, node);
        var method = _v95First(inp.upscale_method, inp.method, inp.interpolation, inp.mode, wv.find(function(v){ return typeof v === 'string' && /(nearest|bilinear|bicubic|lanczos|area)/i.test(v); }));
        if (size) _v95Add(out, 'Resize / Scale: ' + size);
        if (method) _v95Add(out, 'Upscale Method: ' + method);
      }

      if (/ControlNetLoader|ControlNet Loader|Load ControlNet|DiffControlNetLoader|T2IAdapterLoader|Load T2I Adapter/i.test(all)) {
        var cnModel = _v95First(inp.control_net_name, inp.controlnet_name, inp.model_name, inp.t2i_adapter_name, wv[0]);
        if (_v95IsRealName(cnModel)) _v95Add(out, 'ControlNet: ' + _v95CleanName(cnModel));
      }
      if (/ControlNetApply|Apply ControlNet|T2IAdapterApply/i.test(all)) {
        var strength = _v95First(inp.strength, wv.find(function(v){ return typeof v === 'number' && v >= 0 && v <= 5; }));
        _v95Add(out, 'ControlNet Apply' + (strength !== '' ? ' | Strength: ' + strength : ''));
      }
      if (/controlnet/i.test(type) && !/ControlNetLoader|ControlNet Loader|Load ControlNet|ControlNetApply|Apply ControlNet/i.test(all)) {
        var pModel = _v95First(inp.control_net_name, inp.controlnet_name, inp.model_name, inp.name, _v95Resolve(json, _v95First(inp.model_patch, inp.control_net, inp.controlnet, inp.patch), ['name','model_name','control_net_name','controlnet_name']));
        var pStrength = _v95First(inp.strength, wv.find(function(v){ return typeof v === 'number' && v >= 0 && v <= 5; }));
        if (_v95IsRealName(pModel)) _v95Add(out, 'ControlNet: ' + _v95CleanName(pModel) + (pStrength !== '' ? ' | Strength: ' + pStrength : ''));
      }

      var passive = /^(PreviewImage|Image Comparer|Fast Groups Bypasser|Note)$/i.test(type.replace(/\s*\([^)]*\)\s*$/, ''));
      var detailer = !passive && /^(ADetailer|FaceDetailer|SEGSDetailer|DetailerForEach|DetailerDebug|UltralyticsDetectorProvider|BboxDetectorSEGS|SAMLoader)/i.test(type);
      if (detailer) {
        var det = _v95First(inp.bbox_detector, inp.segm_detector, inp.detector, inp.model_name, inp.ad_model, inp.sam_model, wv.find(function(v){ return typeof v === 'string' && /\.(safetensors|pt|pth|onnx)$/i.test(v); }));
        if (_v95IsRealName(det)) _v95Add(out, (/face/i.test(all) ? 'Face Detailer: ' : 'ADetailer / Detailer: ') + _v95CleanName(det));
        else _v95Add(out, /face/i.test(all) ? 'Face Detailer' : 'ADetailer / Detailer');
      }

      if (/ModelSamplingDiscrete|Model Sampling Discrete/i.test(all)) {
        var sampling = _v95First(inp.sampling, wv[0]);
        var zsnr = _v95First(inp.zsnr, wv[1]);
        if (sampling) _v95Add(out, 'Model Sampling: ' + sampling + (zsnr ? ' | ZSNR' : ''));
      }
      if (/ModelSamplingFlux|FluxGuidance/i.test(all)) {
        var fg = _v95First(inp.max_shift, inp.base_shift, inp.guidance, wv[0]);
        _v95Add(out, 'FLUX Guidance' + (fg !== '' ? ': ' + fg : ''));
      }
      if (/RescaleCFG|CFGRescale/i.test(all)) {
        var rc = _v95First(inp.multiplier, inp.scale, wv[0]);
        _v95Add(out, 'Rescale CFG' + (rc !== '' ? ': ' + rc : ''));
      }
      if (/FreeU|FreeU_V2/i.test(all)) _v95Add(out, 'FreeU');
      if (/PerturbedAttention|PAG|SelfAttentionGuidance|SAG/i.test(all)) _v95Add(out, type.replace(/_/g, ' '));
      if (/Refiner|SDXLRefiner/i.test(all)) _v95Add(out, 'Refiner');
      if (/AnimateDiff|VideoLinearCFGGuidance|ADE_|Temporal|SVD|Stable Video|WanVideo|LTXV|HunyuanVideo/i.test(all)) _v95Add(out, 'Video / Animation: ' + type.replace(/_/g, ' '));
    });
    return out;
  }
  function _v95FallbackComfyExtras(originalExtras){
    var out = [];
    (originalExtras || []).forEach(function(x){
      x = _v95Trim(x);
      if (!x || /^__HTML__/i.test(x)) return;
      if (/^(Hires fix|Hirefix|Output Size)\s*:/i.test(x)) return;
      if (/^Hires fix$/i.test(x)) return;
      _v95Add(out, x);
    });
    return out;
  }
  function _v95PrepareComfyParsed(parsed){
    if (!_v95IsComfy(parsed)) return parsed;
    var json = _v95GetComfyJson();
    var activeDetails = _v95CollectActiveComfyDetails(json);
    var fallback = _v95FallbackComfyExtras(parsed.extras || []);
    var merged = [];
    activeDetails.concat(fallback).forEach(function(x){ _v95Add(merged, x); });
    parsed.extras = merged;
    return parsed;
  }

  if (typeof renderParsedV4 === 'function' && !renderParsedV4._pngComfyDetailsV95Wrapped) {
    var _baseRenderParsedV4_v95 = renderParsedV4;
    renderParsedV4 = function(parsed){
      parsed = _v95PrepareComfyParsed(parsed || {});
      var ret = _baseRenderParsedV4_v95.apply(this, arguments);
      try {
        if (_v95IsComfy(parsed)) {
          var extraList = document.getElementById('extraList');
          if (extraList) {
            Array.prototype.forEach.call(extraList.querySelectorAll('.item'), function(item){
              var t = _v95Trim(item.textContent || '');
              if (/^(Hires|Hires fix|Hirefix|Output Size)\s*:/i.test(t) || /^Hires fix$/i.test(t)) item.remove();
            });
            var extraBox = document.getElementById('extraBox');
            if (extraBox) extraBox.style.display = extraList.children.length ? 'block' : 'none';
          }
          var detailsList = document.getElementById('extraDetailsList');
          if (detailsList) {
            Array.prototype.forEach.call(detailsList.querySelectorAll('.item'), function(item){
              var t = _v95Trim(item.textContent || '');
              if (/^(Hires|Hires fix|Hirefix|Output Size)\s*:/i.test(t) || /^Hires fix$/i.test(t)) item.remove();
            });
            var detailsBox = document.getElementById('extraDetailsBox');
            if (detailsBox) detailsBox.style.display = detailsList.children.length ? detailsBox.style.display : 'none';
          }
        }
      } catch(e) {}
      if (typeof window.pngReaderApplySystemSettingsV94 === 'function') window.pngReaderApplySystemSettingsV94();
      return ret;
    };
    renderParsedV4._pngComfyDetailsV95Wrapped = true;
  }

  window.pngReaderComfyDetailsV95 = { collectActiveComfyDetails: _v95CollectActiveComfyDetails };
})();




/* ── v9.6 Complementary / Details cleanup ─────────────────────────────────
   Final cleanup after the Systems/Details patches:
   - ADetailer summary stays in normal Complementary
   - Hires is removed from normal Complementary
   - Hires appears only in Complementary Details as explicit fields
   - duplicate Details rows are collapsed aggressively
*/
(function(){
  if (window.__pngReaderComplementaryCleanupV96) return;
  window.__pngReaderComplementaryCleanupV96 = true;

  function t(v){ return v === undefined || v === null ? '' : String(v).trim(); }
