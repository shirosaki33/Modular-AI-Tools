/* ── v6.7 ComfyUI (NovelAI) parser ─────────────────────────────────────────
   Detects NovelAI custom nodes inside ComfyUI and resolves merged prompt nodes
   into the main Positive/Negative prompt fields. Character prompts stay in
   their own character section and are not concatenated into the main prompt.

   INTERNAL NOTE:
   This parser is intentionally isolated/exclusive to ComfyUI workflows that use
   NovelAI custom nodes. Do not merge Wan/LTXV/video/generic Comfy helpers into
   this block, and do not let generic video routing override this parser unless
   the ComfyUI NovelAI node handling is being edited directly. */

(function () {
  function _cnTxt(v) { return v === undefined || v === null ? '' : String(v); }
  function _cnNodeTitle(node) { return _cnTxt((node && node._meta && node._meta.title) || (node && node.title) || ''); }
  function _cnWidgets(node) { return Array.isArray(node && node.widgets_values) ? node.widgets_values : []; }
  function _cnIsMuted(node) { return !!(node && (node.mode === 4 || node.mode === '4')); }

  function _cnHasComfyNovelAI(json) {
    if (!json || typeof json !== 'object') return false;
    for (var id in json) {
      var n = json[id];
      var t = _cnTxt(n && n.class_type);
      if (/^NovelAI(?:T2I|I2I|Parameters|Character|CharacterStack|RetrySettings|Token)$/i.test(t)) return true;
    }
    return false;
  }

  function _cnFindNodes(json, re) {
    var out = [];
    if (!json || typeof json !== 'object') return out;
    for (var id in json) {
      var n = json[id];
      var t = _cnTxt(n && n.class_type);
      if (re.test(t)) out.push({ id: String(id), node: n });
    }
    return out;
  }

  function _cnFirstNode(json, re) {
    var all = _cnFindNodes(json, re).filter(function (x) { return !_cnIsMuted(x.node); });
    return all[0] || null;
  }

  function _cnInputNode(json, val) {
    if (!Array.isArray(val) || !json) return null;
    var id = String(val[0] === undefined || val[0] === null ? '' : val[0]);
    return id && json[id] ? { id: id, node: json[id] } : null;
  }

  function _cnResolveString(json, val, depth, seen) {
    depth = depth || 0;
    seen  = seen  || {};
    if (depth > 20) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    var ref = _cnInputNode(json, val);
    if (!ref) return '';
    if (seen[ref.id]) return '';
    seen[ref.id] = true;
    var node  = ref.node || {};
    var inp   = node.inputs || {};
    var type  = _cnTxt(node.class_type);
    var title = _cnNodeTitle(node);
    var all   = type + ' ' + title;
    var wv    = _cnWidgets(node);

    if (/List of strings|String.*Concat|Concat|Join|Merge/i.test(all)) {
      var delim = inp.delimiter;
      if (delim === undefined || delim === null || Array.isArray(delim))
        delim = wv.length ? wv[wv.length - 1] : ' ';
      delim = _cnTxt(delim || ' ');
      var keys = Object.keys(inp).filter(function (k) {
        return /^string_?\d+$/i.test(k) || /^text_?\d+$/i.test(k) || /^input_?\d+$/i.test(k);
      });
      keys.sort(function (a, b) {
        var na = Number((a.match(/\d+/) || [9999])[0]);
        var nb = Number((b.match(/\d+/) || [9999])[0]);
        return na - nb;
      });
      var parts = [];
      keys.forEach(function (k) {
        var s = _cnResolveString(json, inp[k], depth + 1, Object.assign({}, seen));
        if (_cnTxt(s).trim()) parts.push(_cnTxt(s).trim());
      });
      return parts.join(delim).replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
    }

    var direct = inp.value;
    if (direct === undefined) direct = inp.text;
    if (direct === undefined) direct = inp.prompt;
    if (direct === undefined) direct = inp.string;
    if (direct === undefined) direct = inp.caption;
    if (direct === undefined) direct = inp.positive;
    if (direct === undefined) direct = inp.negative;
    if (direct === undefined) direct = inp.negative_prompt;
    if (direct === undefined) direct = inp.uc;
    if (typeof direct === 'string') return direct;
    if (Array.isArray(direct)) return _cnResolveString(json, direct, depth + 1, seen);

    var widgetString = wv.find(function (v) { return typeof v === 'string' && v.trim(); });
    if (widgetString) return widgetString;

    var linkKeys = Object.keys(inp)
      .filter(function (k) { return Array.isArray(inp[k]); })
      .sort(function (a, b) {
        var na = Number((a.match(/\d+/) || [9999])[0]);
        var nb = Number((b.match(/\d+/) || [9999])[0]);
        return na - nb;
      });
    for (var i = 0; i < linkKeys.length; i++) {
      var got = _cnResolveString(json, inp[linkKeys[i]], depth + 1, Object.assign({}, seen));
      if (_cnTxt(got).trim()) return got;
    }
    return '';
  }

  function _cnDisplayModel(raw) {
    var s   = _cnTxt(raw).trim();
    var low = s.toLowerCase().replace(/[\s_]+/g, '-');
    if (/nai-diffusion-4-5-full|v4\.5.*4bde2a90/.test(low))    return 'NAI Diffusion 4.5 FULL';
    if (/nai-diffusion-4-5-curated|v4\.5.*c02d4f98/.test(low)) return 'NAI Diffusion 4.5 Curated';
    if (/nai-diffusion-4-full|v4.*37442fca/.test(low))          return 'NAI Diffusion 4.0 FULL';
    if (/nai-diffusion-4-curated|v4.*7abffa2a/.test(low))       return 'NAI Diffusion 4.0 Curated';
    return s ? (typeof cleanName === 'function' ? cleanName(s) : s) : '';
  }

  function _cnParamNode(json, naiNode) {
    var inp = (naiNode && naiNode.inputs) || {};
    return _cnInputNode(json, inp.parameters) || _cnFirstNode(json, /^NovelAIParameters$/i);
  }

  function _cnFormatGridPosition(col, row) {
    var c = _cnTxt(col).trim().toUpperCase();
    var r = _cnTxt(row).trim();
    if (!c || !r) return '';
    return '→ ' + c + r;
  }

  function _cnParseCharacterPrompts(json, positionMode) {
    var chars        = [];
    var isRandomMode = /random/i.test(_cnTxt(positionMode));
    _cnFindNodes(json, /^NovelAICharacter$/i).forEach(function (ref) {
      var n   = ref.node || {};
      var inp = n.inputs || {};
      var wv  = _cnWidgets(n);
      var enabled = inp.enabled;
      if (enabled === undefined) enabled = wv.length ? wv[0] : true;
      if (enabled === false || enabled === 'false') return;
      var pos = inp.prompt;
      var neg = inp.negative;
      if (pos === undefined) pos = wv[1];
      if (neg === undefined) neg = wv[2];
      pos = (typeof cleanPrompt === 'function') ? cleanPrompt(_cnTxt(pos)) : _cnTxt(pos).trim();
      neg = (typeof cleanPrompt === 'function') ? cleanPrompt(_cnTxt(neg)) : _cnTxt(neg).trim();
      if (!(pos || neg)) return;
      var charObj = { positive: pos, negative: neg };
      if (!isRandomMode) {
        var col = inp.position_col;
        var row = inp.position_row;
        if (col === undefined) col = wv[3];
        if (row === undefined) row = wv[4];
        var label = _cnFormatGridPosition(col, row);
        if (label) charObj.name = label;
      }
      chars.push(charObj);
    });
    return chars;
  }

  function _cnParseComfyNovelAI(text, json) {
    if (!_cnHasComfyNovelAI(json)) return null;
    var main   = _cnFirstNode(json, /^NovelAI(?:T2I|I2I)$/i)
              || _cnFirstNode(json, /^NovelAIT2I$/i)
              || _cnFirstNode(json, /^NovelAII2I$/i);
    var out    = makeParsedV4('ComfyUI (NovelAI)');
    var inp    = (main && main.node && main.node.inputs) || {};
    var wvMain = _cnWidgets(main && main.node);
    var pRef   = _cnParamNode(json, main && main.node);
    var p      = (pRef && pRef.node && pRef.node.inputs) || {};
    var pWv    = _cnWidgets(pRef && pRef.node);

    var width  = p.width  !== undefined ? p.width  : pWv[0];
    var height = p.height !== undefined ? p.height : pWv[1];
    var model  = p.model  !== undefined ? p.model  : pWv[2];

    out.models.checkpoint = _cnDisplayModel(model);
    addParamV4(out.params, 'Steps',       p.steps       !== undefined ? p.steps       : pWv[6]);
    addParamV4(out.params, 'CFG',         p.cfg_scale   !== undefined ? p.cfg_scale   : (p.scale !== undefined ? p.scale : pWv[7]));
    addParamV4(out.params, 'CFG Rescale', p.cfg_rescale !== undefined ? p.cfg_rescale : pWv[8]);
    addParamV4(out.params, 'Seed',        p.seed        !== undefined ? p.seed        : pWv[3]);
    addSizeParamV4(out.params, (width && height) ? (width + ' x ' + height) : '', '', '');
    addParamV4(out.params, 'Sampler',     p.sampler     !== undefined ? p.sampler     : pWv[4]);
    addParamV4(out.params, 'Scheduler',   p.scheduler   !== undefined ? p.scheduler   : (p.noise_schedule !== undefined ? p.noise_schedule : pWv[5]));

    var pos = _cnResolveString(json, inp.prompt,          0, {});
    var neg = _cnResolveString(json, inp.negative_prompt, 0, {});
    if (!pos && typeof wvMain[0] === 'string') pos = wvMain[0];
    if (!neg && typeof wvMain[1] === 'string') neg = wvMain[1];
    out.prompts.positive = (typeof cleanPrompt === 'function') ? cleanPrompt(pos) : _cnTxt(pos).trim();
    out.prompts.negative = (typeof cleanPrompt === 'function') ? cleanPrompt(neg) : _cnTxt(neg).trim();

    var stack       = _cnInputNode(json, inp.characters) || _cnFirstNode(json, /^NovelAICharacterStack$/i);
    var stackInputs = (stack && stack.node && stack.node.inputs) || {};
    var stackWv     = _cnWidgets(stack && stack.node);
    var stackMode   = stackInputs.position_mode !== undefined ? stackInputs.position_mode : stackWv[0];
    out.prompts.characters = _cnParseCharacterPrompts(json, stackMode);

    function addExtra(label, val) {
      if (val === undefined || val === null || val === '') return;
      if (typeof val === 'boolean') val = val ? 'true' : 'false';
      var row = label + ': ' + val;
      if (typeof _addUnique === 'function') _addUnique(out.extras, row, { keepRaw: true, allowNodeWords: true });
      else if (out.extras.indexOf(row) === -1) out.extras.push(row);
    }
    // Runtime-only values intentionally hidden: raw model, seed mode, noise schedule,
    // UC preset, batch size, check_anlas, retry settings.
    // Boolean feature flags shown only when enabled.
    function addTrueExtra(label, val) {
      if (val === true || val === 'true' || val === 1 || val === '1') addExtra(label, 'true');
    }
    addTrueExtra('Quality Toggle',  p.quality_toggle  !== undefined ? p.quality_toggle  : pWv[10]);
    addTrueExtra('Prefer Brownian', p.prefer_brownian !== undefined ? p.prefer_brownian : pWv[11]);
    addTrueExtra('SM',              p.sm              !== undefined ? p.sm              : pWv[12]);
    addTrueExtra('SM Dyn',          p.sm_dyn          !== undefined ? p.sm_dyn          : pWv[13]);
    addTrueExtra('Legacy',          p.legacy          !== undefined ? p.legacy          : pWv[15]);
    if (/random/i.test(_cnTxt(stackMode)) && (out.prompts.characters || []).length)
      addExtra('Character Position', 'Random');

    return out;
  }

  // ── Hook into detectSource ──────────────────────────────────────────────
  if (typeof detectSource === 'function') {
    var _baseDetectSource_v67cn = detectSource;
    detectSource = function (text, json) {
      if (_cnHasComfyNovelAI(json)) return 'ComfyUI (NovelAI)';
      return _baseDetectSource_v67cn(text, json);
    };
  }

  // ── Hook into parseMetadataV4 ───────────────────────────────────────────
  if (typeof parseMetadataV4 === 'function') {
    var _baseParseMetadataV4_v67cn = parseMetadataV4;
    parseMetadataV4 = function (text, json, mode) {
      if ((mode || 'image') !== 'video' && _cnHasComfyNovelAI(json)) {
        var parsed = _cnParseComfyNovelAI(text, json);
        if (parsed) return parsed;
      }
      return _baseParseMetadataV4_v67cn(text, json, mode);
    };
  }
})();
