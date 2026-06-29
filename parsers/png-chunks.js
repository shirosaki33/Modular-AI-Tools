window.lerChunksPNG = async function(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const chunks = new Map();
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return chunks;
    const dec = new TextDecoder('latin1');
    const decUtf8 = new TextDecoder('utf-8', { fatal: false });
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = (bytes[offset]<<24)|(bytes[offset+1]<<16)|(bytes[offset+2]<<8)|bytes[offset+3];
        const type = dec.decode(bytes.slice(offset+4, offset+8));
        const data = bytes.slice(offset+8, offset+8+length);
        offset += 12 + length;
        if (type === 'IEND') break;
        if (type === 'tEXt') { const n = data.indexOf(0); if (n !== -1) chunks.set(dec.decode(data.slice(0,n)), dec.decode(data.slice(n+1))); }
        if (type === 'iTXt') { const n = data.indexOf(0); if (n === -1 || data[n+1] !== 0) continue; let r = n+3; while(r<data.length&&data[r]!==0)r++; r++; while(r<data.length&&data[r]!==0)r++; r++; chunks.set(dec.decode(data.slice(0,n)), decUtf8.decode(data.slice(r))); }
    }
    return chunks;
};