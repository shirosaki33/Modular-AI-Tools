/* =========================================================================
   parsers/png-chunks.js — reads the text chunks of a PNG
   window.lerChunksPNG(file) -> Promise<Map<keyword, text>>

   tEXt   keyword \0 text            (UTF-8 when valid, else Latin-1: some
                                      tools write raw UTF-8 into tEXt)
   zTXt   keyword \0 method \0 zlib  (deflate-compressed Latin-1 / UTF-8)
   iTXt   keyword \0 flag method lang \0 transkey \0 text (UTF-8, may be
                                      zlib-compressed when flag = 1)
   Compressed chunks use DecompressionStream (all current browsers); if it
   is missing they are skipped instead of breaking the whole read.
   The first chunk with a given keyword wins (same as before).
========================================================================= */
(function () {
    const latin1 = new TextDecoder('latin1');
    const utf8Strict = new TextDecoder('utf-8', { fatal: true });
    const utf8 = new TextDecoder('utf-8', { fatal: false });

    function decodeText(bytes) {
        try { return utf8Strict.decode(bytes); } catch (e) { return latin1.decode(bytes); }
    }

    async function inflate(bytes) {
        if (typeof DecompressionStream !== 'function') return null;
        try {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (e) {
            console.warn('[png-chunks] could not decompress a text chunk:', e);
            return null;
        }
    }

    window.lerChunksPNG = async function (file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const chunks = new Map();
        if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) return chunks;

        const put = (key, value) => { if (key && value != null && !chunks.has(key)) chunks.set(key, value); };
        let offset = 8;
        while (offset + 12 <= bytes.length) {
            const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
            const type = latin1.decode(bytes.subarray(offset + 4, offset + 8));
            const end = offset + 8 + length;
            if (end + 4 > bytes.length) break;                 // truncated file
            const data = bytes.subarray(offset + 8, end);
            offset = end + 4;
            if (type === 'IEND') break;

            try {
                if (type === 'tEXt') {
                    const n = data.indexOf(0);
                    if (n > 0) put(latin1.decode(data.subarray(0, n)), decodeText(data.subarray(n + 1)));
                } else if (type === 'zTXt') {
                    const n = data.indexOf(0);
                    if (n > 0 && data[n + 1] === 0) {
                        const raw = await inflate(data.subarray(n + 2));
                        if (raw) put(latin1.decode(data.subarray(0, n)), decodeText(raw));
                    }
                } else if (type === 'iTXt') {
                    const n = data.indexOf(0);
                    if (n <= 0) continue;
                    const compressed = data[n + 1] === 1;
                    let r = n + 3;                                  // skip flag + method
                    while (r < data.length && data[r] !== 0) r++;   // language tag
                    r++;
                    while (r < data.length && data[r] !== 0) r++;   // translated keyword
                    r++;
                    let text = data.subarray(Math.min(r, data.length));
                    if (compressed) { text = await inflate(text); if (!text) continue; }
                    put(latin1.decode(data.subarray(0, n)), utf8.decode(text));
                }
            } catch (e) {
                console.warn('[png-chunks] skipped a bad ' + type + ' chunk:', e);
            }
        }
        return chunks;
    };
})();
