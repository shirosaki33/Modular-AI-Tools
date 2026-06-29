/* ── Generic Fallback Parser (v4) ──────────────────────────────────────────
   Fallback for unknown sources: extracts common SD-style fields via regex.
   Also defines the main parseMetadataV4 dispatcher that routes to all other
   parsers. Load this LAST among the parser scripts so all parsers are already
   defined when the dispatcher runs.
   Source lines: 3106-3125 */

function parseUnknownV4(text, json) {
  const out = makeParsedV4("Unknown");
  out.models.checkpoint = detectCheckpoint(text, json);
  const w = grab(text, /"width"\s*:\s*([0-9]+)/i);
  const h = grab(text, /"height"\s*:\s*([0-9]+)/i);
  addParamV4(out.params, "Steps",     grab(text, /Steps:\s*([^,\n]+)/i)        || grab(text, /"steps"\s*:\s*([0-9]+)/i));
  addParamV4(out.params, "CFG",       grab(text, /CFG scale:\s*([^,\n]+)/i)    || grab(text, /"cfg"\s*:\s*([0-9.]+)/i));
  addParamV4(out.params, "Seed",      grab(text, /Seed:\s*([^,\n]+)/i)         || grab(text, /"seed"\s*:\s*([0-9]+)/i));
  addSizeParamV4(out.params, grab(text, /Size:\s*([^,\n]+)/i) || (w && h ? w + " x " + h : ""), "", "");
  addParamV4(out.params, "Sampler",   grab(text, /Sampler:\s*([^,\n]+)/i)      || grab(text, /"sampler_name"\s*:\s*"([^"]+)"/i));
  addParamV4(out.params, "Scheduler", grab(text, /Schedule type:\s*([^,\n]+)/i) || grab(text, /"scheduler"\s*:\s*"([^"]+)"/i));
  return out;
}

function parseMetadataV4(text, json, mode) {
  const source = mode === "video" ? "ComfyUI (Video)" : detectSource(text || "", json);
  if (source === "Stable Diffusion (SwarmUI)") return parseSwarmV4(text, json);
  if (source.startsWith("Stable Diffusion"))   return parseStableV4(text, json, source);
  if (source === "NovelAI")                    return parseNovelAIV4(text, json);
  if (mode === "video" || isComfyVideoGraphV4(json || {}, text || "")) return parseComfyVideoV4(text, json, "ComfyUI (Video)");
  // ComfyUI (standard) and unknown fall through to the generic extractor
  return parseUnknownV4(text, json);
}
