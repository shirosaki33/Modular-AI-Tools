/**
 * tools/metadata_editor.js
 * Full Metadata Edit + Kill Metadata subsystem — ported from PNG Metadata Reader v5–v6.
 * Integrates with registerToolModule(). Supports PNG and JPEG overwrite/kill in-browser.
 */
(function () {

  /* ── Styles ─────────────────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
.me-status{background:#0d0d0d;border:1px solid #2c2c45;color:#9ea8ff;border-radius:7px;padding:8px 10px;font-size:12px;margin-bottom:12px;word-break:break-word}
.me-subtitle{margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid #25253d;color:#9ea8ff;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.me-grid-2,.me-grid-3,.me-grid-4{display:grid;gap:10px;margin-bottom:8px}
.me-grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.me-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.me-grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.me-field{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#888;min-width:0}
.me-field span{color:#aaa}
.me-input,.me-textarea{display:block!important;width:100%;box-sizing:border-box;background:#0d0d0d;border:1px solid #2c2c45;border-radius:7px;color:#eee;padding:8px 10px;font-size:13px;outline:none;transition:border .15s,box-shadow .15s;font-family:inherit}
.me-input:focus,.me-textarea:focus{border-color:#6f78ff;box-shadow:0 0 0 2px rgba(111,120,255,.12)}
.me-textarea{resize:none;overflow:hidden;min-height:42px;color:#00ff99;line-height:1.45}
.me-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
.me-actions.me-top{margin-top:0;margin-bottom:10px}
.me-btn-main,.me-btn-sec,.me-btn-danger,.me-btn-kill{border-radius:6px;padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer;transition:background .15s,border .15s,color .15s}
.me-btn-main{background:#00aa66;color:#06140d;border:1px solid #00aa66}.me-btn-main:hover{background:#00cc88;border-color:#00cc88}
.me-btn-sec{background:#181828;color:#9ea8ff;border:1px solid #33335a}.me-btn-sec:hover{background:#20203a}
.me-btn-danger,.me-btn-kill{background:#4a1118;color:#ffb6c0;border:1px solid #7a222c}.me-btn-danger:hover,.me-btn-kill:hover{background:#6a1822;color:#fff}
.me-danger-note{background:#1f1013;border:1px solid #5a252c;color:#ffb6c0;border-radius:7px;padding:9px 10px;font-size:12px;line-height:1.45}
.me-video-alert{display:none;background:#2a0000;border:1px solid #aa0000;color:#ff6060;border-radius:7px;padding:9px 10px;font-size:12px;line-height:1.45;margin:8px 0 12px;text-align:center}
.me-muted{font-size:12px;color:#777;line-height:1.5;margin-bottom:8px}
.me-char-list,.me-line-list{display:flex;flex-direction:column;gap:10px;margin-bottom:10px}
.me-char-card{background:#0d0d0d;border:1px solid #2c2c45;border-radius:8px;padding:10px}
.me-char-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;color:#9ea8ff;font-size:12px;font-weight:700}
.me-char-remove{background:none;border:1px solid #4a2530;color:#ff9aaa;border-radius:5px;padding:4px 8px;font-size:11px;cursor:pointer}
.me-char-remove:hover{background:#3a121a;color:#fff}
.me-line-card{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:start;background:#0d0d0d;border:1px solid #2c2c45;border-radius:8px;padding:8px}
.me-line-remove{background:none;border:1px solid #4a2530;color:#ff9aaa;border-radius:5px;padding:6px 8px;font-size:11px;cursor:pointer;line-height:1.2}
.me-line-remove:hover{background:#3a121a;color:#fff}
.me-sep{height:1px;background:#25253d;margin:14px 0}
@media(max-width:600px){.me-grid-2,.me-grid-3,.me-grid-4{grid-template-columns:1fr}.me-line-card{grid-template-columns:1fr}}
`;
  document.head.appendChild(style);

  /* ── State ───────────────────────────────────────────────────────────────── */
  let _currentFile = null;
  let _currentBytes = null;
  let _currentKind = 'none'; // 'png' | 'jpeg' | 'webm' | 'mp4' | 'none'
  let _charCounter = 0;

  /* ── Kind detection ───────────────────────────────────────────────────────── */
  function detectKind(bytes, file) {
    const name = ((file && file.name) || '').toLowerCase();
    const type = ((file && file.type) || '').toLowerCase();
    if (bytes && bytes.length > 7 && bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4E&&bytes[3]===0x47) return 'png';
    if (bytes && bytes.length > 1 && bytes[0]===0xFF&&bytes[1]===0xD8) return 'jpeg';
    if (name.endsWith('.webm') || type==='video/webm') return 'webm';
    if (name.endsWith('.mp4') || type==='video/mp4') return 'mp4';
    if (name.endsWith('.png') || type==='image/png') return 'png';
    if (name.endsWith('.jpg')||name.endsWith('.jpeg')||type==='image/jpeg') return 'jpeg';
    return 'unknown';
  }
  function mimeFor(kind) {
    if (kind==='png') return 'image/png';
    if (kind==='jpeg') return 'image/jpeg';
    if (kind==='webm') return 'video/webm';
    if (kind==='mp4') return 'video/mp4';
    return 'application/octet-stream';
  }
  function isVideo() { return _currentKind==='webm'||_currentKind==='mp4'; }
  function isEditableImage() { return _currentKind==='png'||_currentKind==='jpeg'; }

  /* ── CRC32 (for PNG chunks) ───────────────────────────────────────────────── */
  let _crc32Table = null;
  function buildCrcTable() {
    if (_crc32Table) return _crc32Table;
    _crc32Table = new Uint32Array(256);
    for (let n=0;n<256;n++) {
      let c=n;
      for (let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
      _crc32Table[n]=c>>>0;
    }
    return _crc32Table;
  }
  function crc32(typeBytes, dataBytes) {
    const t=buildCrcTable();
    let c=0xFFFFFFFF;
    for (let i=0;i<typeBytes.length;i++) c=t[(c^typeBytes[i])&0xFF]^(c>>>8);
    for (let i=0;i<dataBytes.length;i++) c=t[(c^dataBytes[i])&0xFF]^(c>>>8);
    return (c^0xFFFFFFFF)>>>0;
  }
  function asciiBytes(str) {
    const out=new Uint8Array(str.length);
    for (let i=0;i<str.length;i++) out[i]=str.charCodeAt(i)&0xFF;
    return out;
  }
  function writeU32(arr, v) {
    arr.push((v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255);
  }
  function makePngChunk(type, dataBytes) {
    const tb=asciiBytes(type);
    const out=[];
    writeU32(out,dataBytes.length);
    for (const b of tb) out.push(b);
    for (const b of dataBytes) out.push(b);
    writeU32(out,crc32(tb,dataBytes));
    return new Uint8Array(out);
  }
  function pngTextChunk(keyword, text) {
    const enc=new TextEncoder();
    const key=String(keyword||'Comment').replace(/[\0\n\r]/g,' ').trim().slice(0,79)||'Comment';
    const keyBytes=enc.encode(key);
    const textBytes=enc.encode(String(text||''));
    const data=new Uint8Array(keyBytes.length+1+textBytes.length);
    data.set(keyBytes,0);
    data[keyBytes.length]=0;
    data.set(textBytes,keyBytes.length+1);
    return makePngChunk('tEXt',data);
  }

  /* ── PNG chunk parser & builder ──────────────────────────────────────────── */
  function parsePngChunks(bytes) {
    const chunks=[];
    let pos=8;
    while (pos+12<=bytes.length) {
      const len=((bytes[pos]<<24)|(bytes[pos+1]<<16)|(bytes[pos+2]<<8)|bytes[pos+3])>>>0;
      const type=String.fromCharCode(bytes[pos+4],bytes[pos+5],bytes[pos+6],bytes[pos+7]);
      const dataStart=pos+8;
      const dataEnd=dataStart+len;
      const chunkEnd=dataEnd+4;
      if (dataEnd>bytes.length||chunkEnd>bytes.length) throw new Error('Invalid PNG chunk: '+type);
      chunks.push({type,data:bytes.slice(dataStart,dataEnd),raw:bytes.slice(pos,chunkEnd)});
      pos=chunkEnd;
      if (type==='IEND') break;
    }
    return chunks;
  }
  function buildPng(originalBytes, insertChunks, mode) {
    const chunks=parsePngChunks(originalBytes);
    const out=[];
    for (const b of originalBytes.slice(0,8)) out.push(b);
    const textTypes=new Set(['tEXt','iTXt','zTXt']);
    const criticalTypes=new Set(['IHDR','PLTE','IDAT','IEND']);
    let inserted=false;
    chunks.forEach(chunk => {
      if (chunk.type==='IEND'&&!inserted) {
        (insertChunks||[]).forEach(c=>{for(const b of c)out.push(b);});
        inserted=true;
      }
      if (mode==='kill') { if (!criticalTypes.has(chunk.type)) return; }
      else if (mode==='replaceText') { if (textTypes.has(chunk.type)) return; }
      for (const b of chunk.raw) out.push(b);
    });
    return new Uint8Array(out);
  }

  /* ── JPEG segment builder ─────────────────────────────────────────────────── */
  function makeJpegComSegment(text) {
    const enc=new TextEncoder();
    const bytes=enc.encode(text);
    const segs=[];
    const max=60000;
    for (let i=0;i<bytes.length;i+=max) {
      const chunk=bytes.slice(i,i+max);
      const len=chunk.length+2;
      const seg=new Uint8Array(len+2);
      seg[0]=0xFF;seg[1]=0xFE;
      seg[2]=(len>>>8)&255;seg[3]=len&255;
      seg.set(chunk,4);
      segs.push(seg);
    }
    return segs;
  }
  function buildJpeg(originalBytes, insertSegments, mode) {
    const out=[0xFF,0xD8];
    let pos=2,inserted=false;
    const skip=m=>(m>=0xE0&&m<=0xEF)||m===0xFE;
    const pushBytes=arr=>{for(const b of arr)out.push(b);};
    if (mode!=='kill') { (insertSegments||[]).forEach(pushBytes); inserted=true; }
    while (pos<originalBytes.length) {
      if (originalBytes[pos]!==0xFF){pushBytes(originalBytes.slice(pos));break;}
      while(originalBytes[pos]===0xFF&&originalBytes[pos+1]===0xFF)pos++;
      const marker=originalBytes[pos+1];
      if (marker===undefined) break;
      if (marker===0xDA){pushBytes(originalBytes.slice(pos));break;}
      if (marker===0xD9){pushBytes(originalBytes.slice(pos,pos+2));break;}
      if (marker===0x01||(marker>=0xD0&&marker<=0xD7)){pushBytes(originalBytes.slice(pos,pos+2));pos+=2;continue;}
      if (pos+4>originalBytes.length) break;
      const len=(originalBytes[pos+2]<<8)|originalBytes[pos+3];
      const end=pos+2+len;
      if (end>originalBytes.length||len<2) break;
      if (!skip(marker)) pushBytes(originalBytes.slice(pos,end));
      pos=end;
    }
    return new Uint8Array(out);
  }

  /* ── Video metadata kill (text scrub) ────────────────────────────────────── */
  function findBalancedEnd(bytes, start) {
    let depth=0,inStr=false,esc=false;
    for (let i=start;i<bytes.length;i++) {
      const b=bytes[i];
      if(esc){esc=false;continue;}
      if(b===0x5C){esc=true;continue;}
      if(b===0x22){inStr=!inStr;continue;}
      if(inStr) continue;
      if(b===0x7B)depth++;
      else if(b===0x7D){depth--;if(depth===0)return i;}
    }
    return -1;
  }
  function bytesIndexOf(bytes, pattern, from) {
    const needle=typeof pattern==='string'?Array.from(pattern).map(c=>c.charCodeAt(0)):pattern;
    from=from||0;
    outer:for(let i=from;i<=bytes.length-needle.length;i++){
      for(let j=0;j<needle.length;j++) if(bytes[i+j]!==needle[j]) continue outer;
      return i;
    }
    return -1;
  }
  function byteLastIndexOf(bytes, val, from) {
    for(let i=Math.min(from,bytes.length-1);i>=0;i--) if(bytes[i]===val) return i;
    return -1;
  }
  function videoKill(bytes) {
    const out=new Uint8Array(bytes);
    const patterns=['COMMENT','"prompt"','"workflow"','"class_type"','PNGReaderGenericMetadata','parameters-json'];
    const ranges=[];
    const addRange=(s,e)=>{if(s>=0&&e>=s&&!ranges.some(r=>Math.max(r[0],s)<=Math.min(r[1],e)))ranges.push([s,e]);};
    patterns.forEach(pat=>{
      let idx=0;
      while((idx=bytesIndexOf(bytes,pat,idx))!==-1){
        const limit=Math.min(bytes.length,idx+5000);
        let start=-1;
        for(let k=idx+pat.length;k<limit;k++){if(bytes[k]===0x7B){start=k;break;}}
        if(start!==-1){const end=findBalancedEnd(bytes,start);if(end!==-1)addRange(start,end);}
        // also try backward search
        const back=byteLastIndexOf(bytes,0x7B,idx);
        if(back>=0){const end=findBalancedEnd(bytes,back);if(end>=idx)addRange(back,end);}
        idx+=pat.length;
      }
    });
    ranges.forEach(([s,e])=>{for(let i=s;i<=e&&i<out.length;i++)out[i]=0x20;});
    return {bytes:out,count:ranges.length};
  }

  /* ── Auto-resize textarea ────────────────────────────────────────────────── */
  function autoResize(el) {
    if(!el||el.tagName!=='TEXTAREA') return;
    const fit=()=>{el.style.height='0px';el.style.height=(Math.max(el.scrollHeight,42))+'px';};
    fit();requestAnimationFrame(fit);setTimeout(fit,25);
  }

  /* ── DOM helpers ─────────────────────────────────────────────────────────── */
  function get(id){return document.getElementById(id);}
  function val(id){const el=get(id);return el?String(el.value||''):'';  }
  function trimval(id){return val(id).trim();}
  function setVal(id,v){const el=get(id);if(!el)return;el.value=v||'';if(el.tagName==='TEXTAREA')autoResize(el);}

  /* ── Status ──────────────────────────────────────────────────────────────── */
  function setStatus(msg) {
    const el=get('me-status');
    if(el) el.textContent=msg||'Load an image or video to edit/remove metadata.';
  }

  /* ── Line rows (LoRA / Complementary) ────────────────────────────────────── */
  function addLineRow(containerId, value) {
    const box=get(containerId);
    if(!box) return;
    const card=document.createElement('div');
    card.className='me-line-card';
    card.innerHTML='<textarea class="me-textarea me-line-input" rows="1" placeholder="New line"></textarea><button class="me-line-remove" type="button">Remove</button>';
    const ta=card.querySelector('textarea');
    ta.value=value||'';
    ta.addEventListener('input',()=>autoResize(ta));
    card.querySelector('button').onclick=()=>card.remove();
    box.appendChild(card);
    autoResize(ta);
  }
  function removeLastLineRow(containerId) {
    const box=get(containerId);
    if(box&&box.lastElementChild) box.lastElementChild.remove();
  }
  function setLineRows(containerId, text) {
    const box=get(containerId);
    if(!box) return;
    box.innerHTML='';
    String(text||'').split(/\r?\n+/).map(x=>x.trim()).filter(Boolean).forEach(row=>addLineRow(containerId,row));
  }
  function readLineRows(containerId) {
    const box=get(containerId);
    if(!box) return '';
    return Array.from(box.querySelectorAll('.me-line-input'))
      .map(ta=>String(ta.value||'').trim()).filter(Boolean).join('\n');
  }

  /* ── Character prompts ───────────────────────────────────────────────────── */
  function clearCharacters() {
    const box=get('me-char-list');
    if(box) box.innerHTML='';
    _charCounter=0;
  }
  function addCharacter(positive, negative, name) {
    const box=get('me-char-list');
    if(!box) return;
    _charCounter++;
    const idx=_charCounter;
    const card=document.createElement('div');
    card.className='me-char-card';
    card.innerHTML=
      '<div class="me-char-head"><span>Character '+idx+'</span><button class="me-char-remove" type="button">Remove</button></div>'+
      '<label class="me-field"><span>Name / Label</span><input class="me-input me-char-name" type="text" placeholder="Character '+idx+'"></label>'+
      '<label class="me-field" style="margin-top:6px"><span>Positive Prompt</span><textarea class="me-textarea me-char-pos" rows="3" placeholder="Character positive prompt"></textarea></label>'+
      '<label class="me-field" style="margin-top:6px"><span>Negative Prompt</span><textarea class="me-textarea me-char-neg" rows="3" placeholder="Character negative prompt"></textarea></label>';
    box.appendChild(card);
    card.querySelector('.me-char-remove').onclick=()=>card.remove();
    card.querySelector('.me-char-name').value=name||('Character '+idx);
    const taPos=card.querySelector('.me-char-pos');
    const taNeg=card.querySelector('.me-char-neg');
    taPos.value=positive||'';taNeg.value=negative||'';
    [taPos,taNeg].forEach(ta=>{ta.addEventListener('input',()=>autoResize(ta));autoResize(ta);});
  }
  function removeLastCharacter() {
    const box=get('me-char-list');
    if(box&&box.lastElementChild) box.lastElementChild.remove();
  }
  function readCharacters() {
    return Array.from(document.querySelectorAll('#me-char-list .me-char-card')).map((card,i)=>({
      name:(card.querySelector('.me-char-name')?.value||('Character '+(i+1))).trim(),
      positive:(card.querySelector('.me-char-pos')?.value||'').trim(),
      negative:(card.querySelector('.me-char-neg')?.value||'').trim()
    })).filter(c=>c.name||c.positive||c.negative);
  }

  /* ── Auto-fill from PNG Reader's current state ───────────────────────────── */
  function autoFill() {
    // Prompts
    setVal('me-pos', get('positiveText')?.value||'');
    setVal('me-neg', get('negativeText')?.value||'');

    // Parameters from paramList
    const paramText=(get('paramList')?.innerText||'');
    const grab=(re)=>(paramText.match(re)||['',''])[1].trim();
    setVal('me-steps', grab(/Steps:\s*([^\n]+)/i));
    setVal('me-cfg', grab(/CFG(?:\s*Scale)?:\s*([^\n]+)/i)||grab(/Scale:\s*([^\n]+)/i));
    setVal('me-seed', grab(/Seed:\s*([^\n]+)/i));
    setVal('me-sampler', grab(/Sampler:\s*([^\n]+)/i));
    setVal('me-scheduler', grab(/Scheduler:\s*([^\n]+)/i)||grab(/Schedule type:\s*([^\n]+)/i));
    setVal('me-clip-skip', grab(/Clip Skip:\s*([^\n]+)/i));
    const sizem=paramText.match(/Size:\s*([\d]+)\s*[x×]\s*([\d]+)/i);
    setVal('me-width', sizem?sizem[1]:'');
    setVal('me-height', sizem?sizem[2]:'');
    setVal('me-denoise', grab(/Denoising Strength:\s*([^\n]+)/i)||grab(/Strength:\s*([^\n]+)/i));
    setVal('me-hires-scale', grab(/Hires(?:\s*Upscale):\s*([^\n]+)/i));
    setVal('me-hires-steps', grab(/Hires(?:\s*Steps):\s*([^\n]+)/i));
    setVal('me-hires-upscaler', grab(/Hires(?:\s*Upscaler):\s*([^\n]+)/i));

    // Topbar: Source / Checkpoint / VAE / CLIP
    const topText=(get('topbar')?.innerText||'');
    const topGrab=(label)=>{
      const m=topText.match(new RegExp(label+'[:\\s]+([^\\n]+)','i'));
      return m?m[1].trim().replace(/^—$/,''):'';
    };
    setVal('me-source', topGrab('Source'));
    setVal('me-checkpoint', topGrab('Checkpoint'));
    setVal('me-vae', topGrab('VAE'));
    const clipRaw=topGrab('CLIP/Text_ENC')||topGrab('CLIP')||'';
    // split clip vs text encoders heuristically
    const clipParts=clipRaw.split(/\s*\|\s*/);
    const clips=[], encs=[];
    clipParts.forEach(p=>{
      if(/t5|umt5|text[-_ ]?encoder|qwen|llm|xxl|fp8|gguf/i.test(p)) encs.push(p);
      else if(p) clips.push(p);
    });
    setVal('me-clip', clips.join(' | '));
    setVal('me-text-encoders', encs.join(' | '));

    // Model hash from raw text
    const rawText=(typeof _lastRawTextForLoraLinks!=='undefined')?_lastRawTextForLoraLinks:'';
    const hashm=rawText.match(/\b(?:Model hash|Checkpoint hash|model_hash)\s*[:\s]+([a-f0-9]{8,64})\b/i);
    setVal('me-model-hash', hashm?hashm[1]:'');

    // LoRAs
    const loraItems=Array.from(get('loraList')?.querySelectorAll('.item')||[]).map(el=>el.textContent.trim()).filter(Boolean);
    setLineRows('me-lora-rows', loraItems.join('\n'));

    // Extras
    const extraItems=Array.from(get('extraList')?.querySelectorAll('.item')||[]).map(el=>el.textContent.trim()).filter(Boolean);
    setLineRows('me-extra-rows', extraItems.join('\n'));

    // Characters
    clearCharacters();
    const charBoxes=Array.from(document.querySelectorAll('#charBlocksContainer > div'));
    charBoxes.forEach((wrap,i)=>{
      const textareas=wrap.querySelectorAll('textarea');
      const titles=wrap.querySelectorAll('.promptTitle');
      let pos='', neg='';
      titles.forEach(t=>{
        const label=(t.textContent||'').replace(/⧉/g,'').trim().toLowerCase();
        const ta=t.nextElementSibling;
        if(!ta||ta.tagName!=='TEXTAREA') return;
        if(label.includes('negative')) neg=ta.value||'';
        else pos=ta.value||'';
      });
      if(pos||neg) addCharacter(pos,neg,'Character '+(i+1));
    });

    setStatus('Fields auto-filled from the currently loaded image.');
  }

  /* ── Build chunk list from editor fields ─────────────────────────────────── */
  function buildChunkPairs() {
    const pairs=[];
    const put=(k,v)=>{ k=String(k||'').trim(); v=String(v||'').trim(); if(k&&v) pairs.push([k,v]); };
    put('PNGReaderGenericMetadata','1');
    put('Source',trimval('me-source'));
    put('Checkpoint',trimval('me-checkpoint'));
    put('Model',trimval('me-checkpoint'));
    put('Model Hash',trimval('me-model-hash'));
    put('VAE',trimval('me-vae'));
    put('CLIP',trimval('me-clip'));
    put('Text Encoders',trimval('me-text-encoders'));
    put('Positive Prompt',val('me-pos'));
    put('Negative Prompt',val('me-neg'));
    put('Steps',trimval('me-steps'));
    put('CFG',trimval('me-cfg'));
    put('Seed',trimval('me-seed'));
    put('Sampler',trimval('me-sampler'));
    put('Scheduler',trimval('me-scheduler'));
    put('Width',trimval('me-width'));
    put('Height',trimval('me-height'));
    const w=trimval('me-width'),h=trimval('me-height');
    if(w&&h) put('Size',w+'x'+h);
    put('Clip Skip',trimval('me-clip-skip'));
    put('Denoising Strength',trimval('me-denoise'));
    put('Hires Upscale',trimval('me-hires-scale'));
    put('Hires Steps',trimval('me-hires-steps'));
    put('Hires Upscaler',trimval('me-hires-upscaler'));
    const chars=readCharacters();
    if(chars.length) {
      put('Character Prompts',JSON.stringify(chars,null,2));
      chars.forEach((c,i)=>{
        if(c.name) put('Character '+(i+1)+' Name',c.name);
        if(c.positive) put('Character '+(i+1)+' Positive',c.positive);
        if(c.negative) put('Character '+(i+1)+' Negative',c.negative);
      });
    }
    put('LoRAs',readLineRows('me-lora-rows'));
    put('Complementary',readLineRows('me-extra-rows'));
    const merged=new Map();
    pairs.forEach(([k,v])=>merged.set(k,v));
    return Array.from(merged.entries()).filter(([k,v])=>k&&v);
  }

  /* ── Download helper ─────────────────────────────────────────────────────── */
  function download(bytes, filename, mime) {
    const blob=new Blob([bytes],{type:mime||'application/octet-stream'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=filename||'file';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  /* ── Overwrite metadata ──────────────────────────────────────────────────── */
  function doWrite() {
    if(!_currentFile||!_currentBytes){alert('Load a file first.');return;}
    if(!isEditableImage()){alert('Metadata Edit supports image files only (PNG or JPEG).');return;}
    const pairs=buildChunkPairs();
    if(!pairs.length){alert('No metadata fields are filled.');return;}
    try {
      let out;
      if(_currentKind==='png'){
        const chunks=pairs.map(([k,v])=>pngTextChunk(k,v));
        out=buildPng(_currentBytes,chunks,'replaceText');
      } else {
        const commentText='PNGReaderGenericMetadata\n'+JSON.stringify(Object.fromEntries(pairs),null,2);
        out=buildJpeg(_currentBytes,makeJpegComSegment(commentText),'replaceText');
      }
      download(out,_currentFile.name,mimeFor(_currentKind));
      setStatus('Metadata overwritten. Download created as '+_currentFile.name+'.');
    } catch(e){alert('Could not write metadata: '+e.message);}
  }

  /* ── Kill metadata ───────────────────────────────────────────────────────── */
  function doKill() {
    if(!_currentFile||!_currentBytes){alert('Load a file first.');return;}
    try {
      let out, msg;
      if(_currentKind==='png'){
        out=buildPng(_currentBytes,[],'kill');
        msg='PNG metadata removed.';
      } else if(_currentKind==='jpeg'){
        out=buildJpeg(_currentBytes,[],'kill');
        msg='JPEG metadata removed.';
      } else if(isVideo()){
        const res=videoKill(_currentBytes);
        if(!res.count){alert('No removable textual metadata found in this video.');return;}
        out=res.bytes;
        msg='Video: '+res.count+' embedded metadata block(s) scrubbed.';
      } else {
        alert('Unsupported file type for Kill Metadata.');return;
      }
      download(out,_currentFile.name,mimeFor(_currentKind));
      setStatus(msg+' Download created as '+_currentFile.name+'.');
    } catch(e){alert('Could not remove metadata: '+e.message);}
  }

  /* ── Clear editor ────────────────────────────────────────────────────────── */
  function doClear() {
    ['me-source','me-checkpoint','me-model-hash','me-vae','me-clip','me-text-encoders',
     'me-pos','me-neg','me-steps','me-cfg','me-seed','me-sampler','me-scheduler',
     'me-width','me-height','me-clip-skip','me-denoise','me-hires-scale','me-hires-steps','me-hires-upscaler']
    .forEach(id=>setVal(id,''));
    setLineRows('me-lora-rows','');
    setLineRows('me-extra-rows','');
    clearCharacters();
    setStatus('Fields cleared.');
  }

  /* ── Update UI mode based on loaded file ─────────────────────────────────── */
  function updateMode() {
    const videoAlert=get('me-video-alert');
    const writeBtn=get('me-write-btn');
    const killBtn=get('me-kill-btn');
    if(!_currentFile||!_currentBytes){
      if(videoAlert) videoAlert.style.display='none';
      setStatus('Load an image or video to edit/remove metadata.');
      return;
    }
    if(isVideo()){
      if(videoAlert) videoAlert.style.display='block';
      if(writeBtn){writeBtn.disabled=true;writeBtn.style.display='none';}
      setStatus('Video loaded. Metadata Edit is blocked; use Kill Metadata for basic cleanup.');
    } else {
      if(videoAlert) videoAlert.style.display='none';
      if(writeBtn){writeBtn.disabled=false;writeBtn.style.display='';}
      setStatus(_currentFile.name+' ready. Overwrite metadata or kill it below.');
    }
  }

  /* ── Hook into the global loadFile if available ──────────────────────────── */
  function hookLoadFile() {
    if (typeof window.loadFile !== 'function') return;
    if (window.loadFile._meHooked) return;
    const origLoad = window.loadFile;
    window.loadFile = function(file) {
      _currentFile = file || null;
      _currentBytes = null;
      _currentKind = 'none';
      updateMode();
      const ret = origLoad.apply(this, arguments);
      if (file) {
        const r = new FileReader();
        r.onload = e => {
          _currentBytes = new Uint8Array(e.target.result);
          _currentKind = detectKind(_currentBytes, file);
          updateMode();
          setTimeout(autoFill, 80);
        };
        r.onerror = () => setStatus('Could not read the file for Metadata Edit.');
        r.readAsArrayBuffer(file);
      }
      return ret;
    };
    window.loadFile._meHooked = true;
  }

  /* ── Build the UI wrapper ────────────────────────────────────────────────── */
  function buildUI() {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding:12px;box-sizing:border-box;width:100%';
    wrapper.innerHTML = `
<div class="me-status" id="me-status">Load an image or video to edit/remove metadata.</div>

<div class="me-actions me-top">
  <button class="me-btn-sec" type="button" id="me-fill-btn">↺ Auto-fill from image</button>
  <button class="me-btn-sec" type="button" id="me-clear-btn">Clear fields</button>
</div>

<div class="me-subtitle">Model / Source</div>
<div class="me-grid-3">
  <label class="me-field"><span>Source</span><input class="me-input" id="me-source" type="text" placeholder="Stable Diffusion / NovelAI / ComfyUI"></label>
  <label class="me-field"><span>Checkpoint / Model</span><input class="me-input" id="me-checkpoint" type="text" placeholder="model.safetensors"></label>
  <label class="me-field"><span>Model Hash</span><input class="me-input" id="me-model-hash" type="text" placeholder="hash"></label>
  <label class="me-field"><span>VAE</span><input class="me-input" id="me-vae" type="text" placeholder="vae.safetensors"></label>
  <label class="me-field"><span>CLIP</span><input class="me-input" id="me-clip" type="text" placeholder="clip model(s)"></label>
  <label class="me-field"><span>Text Encoders</span><input class="me-input" id="me-text-encoders" type="text" placeholder="t5 / umt5 / text encoder"></label>
</div>

<div class="me-subtitle">Prompts</div>
<label class="me-field"><span>Positive Prompt</span><textarea class="me-textarea" id="me-pos" rows="5" placeholder="Positive prompt"></textarea></label>
<label class="me-field" style="margin-top:8px"><span>Negative Prompt</span><textarea class="me-textarea" id="me-neg" rows="4" placeholder="Negative prompt"></textarea></label>

<div class="me-subtitle">Character Prompts</div>
<div class="me-muted">Optional per-character prompts (e.g. NovelAI). Leave empty if not needed.</div>
<div id="me-char-list" class="me-char-list"></div>
<div class="me-actions me-top">
  <button class="me-btn-sec" type="button" id="me-char-add-btn">+ Add character</button>
  <button class="me-btn-sec" type="button" id="me-char-rem-btn">− Remove character</button>
</div>

<div class="me-subtitle">Generation Parameters</div>
<div class="me-grid-4">
  <label class="me-field"><span>Steps</span><input class="me-input" id="me-steps" type="text" placeholder="28"></label>
  <label class="me-field"><span>CFG / Scale</span><input class="me-input" id="me-cfg" type="text" placeholder="7"></label>
  <label class="me-field"><span>Seed</span><input class="me-input" id="me-seed" type="text" placeholder="123456"></label>
  <label class="me-field"><span>Clip Skip</span><input class="me-input" id="me-clip-skip" type="text" placeholder="2"></label>
  <label class="me-field"><span>Sampler</span><input class="me-input" id="me-sampler" type="text" placeholder="DPM++ 2M"></label>
  <label class="me-field"><span>Scheduler</span><input class="me-input" id="me-scheduler" type="text" placeholder="Karras / normal"></label>
  <label class="me-field"><span>Width</span><input class="me-input" id="me-width" type="text" placeholder="832"></label>
  <label class="me-field"><span>Height</span><input class="me-input" id="me-height" type="text" placeholder="1216"></label>
  <label class="me-field"><span>Denoising / Strength</span><input class="me-input" id="me-denoise" type="text" placeholder="0.45"></label>
  <label class="me-field"><span>Hires Upscale</span><input class="me-input" id="me-hires-scale" type="text" placeholder="1.5"></label>
  <label class="me-field"><span>Hires Steps</span><input class="me-input" id="me-hires-steps" type="text" placeholder="10"></label>
  <label class="me-field"><span>Hires Upscaler</span><input class="me-input" id="me-hires-upscaler" type="text" placeholder="4x-UltraSharp"></label>
</div>

<div class="me-subtitle">LoRAs</div>
<div class="me-muted">Each row is one LoRA line.</div>
<div id="me-lora-rows" class="me-line-list"></div>
<div class="me-actions me-top">
  <button class="me-btn-sec" type="button" id="me-lora-add-btn">+ Add LoRA</button>
  <button class="me-btn-sec" type="button" id="me-lora-rem-btn">− Remove LoRA</button>
</div>

<div class="me-subtitle">Complementary</div>
<div class="me-muted">Each row is one Complementary line.</div>
<div id="me-extra-rows" class="me-line-list"></div>
<div class="me-actions me-top">
  <button class="me-btn-sec" type="button" id="me-extra-add-btn">+ Add</button>
  <button class="me-btn-sec" type="button" id="me-extra-rem-btn">− Remove</button>
</div>

<div class="me-actions">
  <button class="me-btn-main" type="button" id="me-write-btn">⬇ Overwrite metadata and download file</button>
</div>
<div class="me-muted" style="margin-top:6px">Rewrites text metadata in-browser. Image pixels are untouched.</div>

<div class="me-sep"></div>

<div class="me-video-alert" id="me-video-alert">Video files cannot be fully edited here. Use Kill Metadata below for basic cleanup.</div>
<div class="me-danger-note">Kill Metadata removes all supported metadata and downloads a clean file using the original filename. Image/video data is kept untouched when possible.</div>
<div class="me-actions" style="margin-top:10px">
  <button class="me-btn-kill" type="button" id="me-kill-btn">🧨 Remove metadata and download file</button>
</div>
`;

    // Wire buttons
    wrapper.querySelector('#me-fill-btn').onclick = autoFill;
    wrapper.querySelector('#me-clear-btn').onclick = doClear;
    wrapper.querySelector('#me-char-add-btn').onclick = ()=>addCharacter('','','');
    wrapper.querySelector('#me-char-rem-btn').onclick = removeLastCharacter;
    wrapper.querySelector('#me-lora-add-btn').onclick = ()=>addLineRow('me-lora-rows','');
    wrapper.querySelector('#me-lora-rem-btn').onclick = ()=>removeLastLineRow('me-lora-rows');
    wrapper.querySelector('#me-extra-add-btn').onclick = ()=>addLineRow('me-extra-rows','');
    wrapper.querySelector('#me-extra-rem-btn').onclick = ()=>removeLastLineRow('me-extra-rows');
    wrapper.querySelector('#me-write-btn').onclick = doWrite;
    wrapper.querySelector('#me-kill-btn').onclick = doKill;

    // Auto-resize all textareas on input
    wrapper.addEventListener('input', e=>{
      if(e.target&&e.target.tagName==='TEXTAREA') autoResize(e.target);
    });

    // Auto-fill on expand
    wrapper._onExpand = function() {
      hookLoadFile();
      // If a file is already loaded but we haven't hooked yet, try to grab bytes
      if(!_currentFile&&typeof _lastLoadedFileName!=='undefined') {
        // can't recover bytes post-hoc, just fill from DOM
      }
      autoFill();
    };

    return wrapper;
  }

  /* ── Register with the tool system ──────────────────────────────────────── */
  window.addEventListener('DOMContentLoaded', () => {
    if (typeof window.registerToolModule !== 'function') return;
    const wrapper = buildUI();
    window.registerToolModule('✏️ Metadata Editor', '#00cc88', wrapper);
    hookLoadFile();
  });

})();