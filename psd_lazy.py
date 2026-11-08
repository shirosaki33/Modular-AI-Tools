"""Lazy PSD / PSB layer reader (multi-GB files) for the Tag Manager PSD Import.

psd-tools loads every channel of every layer into RAM when a file is opened, which
freezes the app on a +2 GB .psb. This reader only parses the layer *records*
(names, bounds, channel offsets - a few hundred bytes per layer) and decodes the
pixels of ONE layer at a time with seek + read. The file is never written.

  idx = PsdIndex.from_file(open(path, 'rb'))     # fast, tiny memory
  idx.layers                                      # [LayerRec ...] bottom -> top
  idx.layer_image(fp, rec)                        # PIL RGBA, native resolution

It can also parse from the first bytes of a file only (see HeadFile / NeedMore), which
is how the app counts layers of a huge file without uploading it.

Supported: PSD (version 1) and PSB (version 2); RGB / Grayscale / CMYK; 8 and 16 bit;
RAW / RLE / ZIP / ZIP+prediction channels; layer groups (hidden-group inheritance);
16/32-bit documents that keep layers inside Lr16 / Lr32 / Layr blocks.
Not supported: 32-bit float documents, Lab / Indexed / Multichannel (clear error).
"""
import struct

BIG_KEYS = {b'LMsk', b'Lr16', b'Lr32', b'Layr', b'Mt16', b'Mt32', b'Mtrn', b'Alph', b'FMsk', b'lnk2',
            b'lnk3', b'lnkE', b'FXid', b'FEid', b'FELS', b'PxSD', b'pths', b'extd', b'extn', b'cinf', b'artd'}
LAYER_BLOCKS = (b'Lr16', b'Lr32', b'Layr')
SECTION_KEYS = (b'lsct', b'lsdk')


class NeedMore(Exception):
    """Raised by HeadFile when the parser needs bytes past the end of the head."""

    def __init__(self, end):
        super().__init__('need %d bytes' % end)
        self.end = end


class HeadFile:
    """File-like object over the first bytes of a file (total = real file size)."""

    def __init__(self, data, total):
        self.d = data
        self.total = total
        self.pos = 0

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.total + off)
        return self.pos

    def read(self, n):
        end = self.pos + n
        if end > len(self.d) and len(self.d) < self.total:
            raise NeedMore(end)
        chunk = self.d[self.pos:end]
        self.pos += len(chunk)
        return chunk


class LayerRec:
    __slots__ = ('name', 'top', 'left', 'bottom', 'right', 'channels', 'hidden', 'section', 'group', 'opacity')

    @property
    def width(self):
        return max(0, self.right - self.left)

    @property
    def height(self):
        return max(0, self.bottom - self.top)


class _Group:
    __slots__ = ('parent', 'hidden')

    def __init__(self, parent):
        self.parent = parent
        self.hidden = False


def _rd(fp, fmt):
    size = struct.calcsize(fmt)
    data = fp.read(size)
    if len(data) < size:
        raise ValueError('Unexpected end of file (truncated or not a PSD/PSB).')
    return struct.unpack(fmt, data)


def _pad(length, divisor):
    return (-length) % divisor


class PsdIndex:
    def __init__(self):
        self.version = 1
        self.width = 0
        self.height = 0
        self.depth = 8
        self.mode = 3
        self.layers = []

    # ------------------------------------------------------------ parsing
    @classmethod
    def from_file(cls, fp):
        self = cls()
        self._parse(fp)
        return self

    def _parse(self, fp):
        fp.seek(0)
        if fp.read(4) != b'8BPS':
            raise ValueError('Not a Photoshop file.')
        (self.version,) = _rd(fp, '>H')
        if self.version not in (1, 2):
            raise ValueError('Unsupported PSD version %d.' % self.version)
        fp.read(6)
        _, self.height, self.width, self.depth, self.mode = _rd(fp, '>HIIHH')
        (n,) = _rd(fp, '>I')
        fp.seek(n, 1)                                   # color mode data
        (n,) = _rd(fp, '>I')
        fp.seek(n, 1)                                   # image resources
        big = self.version == 2
        (lm_len,) = _rd(fp, '>Q' if big else '>I')
        lm_start = fp.tell()
        lm_end = lm_start + lm_len
        self.layers = []
        if lm_len == 0:
            return
        (li_len,) = _rd(fp, '>Q' if big else '>I')
        li_start = fp.tell()
        if li_len > 0:
            self._parse_layer_info(fp, li_start)
        if self.layers:
            return
        # 16 / 32-bit documents: the layers live in a global tagged block.
        fp.seek(li_start + li_len)
        (gm,) = _rd(fp, '>I')                           # global layer mask info
        fp.seek(gm, 1)
        while fp.tell() + 12 <= lm_end:
            sig = fp.read(4)
            if sig not in (b'8BIM', b'8B64'):
                break
            key = fp.read(4)
            (length,) = _rd(fp, '>Q' if (big and key in BIG_KEYS) else '>I')
            start = fp.tell()
            if key in LAYER_BLOCKS:
                self._parse_layer_info(fp, start)
                break
            fp.seek(start + length + _pad(length, 4))

    def _parse_layer_info(self, fp, start):
        big = self.version == 2
        fp.seek(start)
        (count,) = _rd(fp, '>h')
        count = abs(count)
        recs = []
        for _ in range(count):
            recs.append(self._parse_record(fp, big))
        cursor = fp.tell()                              # channel image data starts here
        for rec in recs:
            for ch in rec.channels:
                ch[2] = cursor
                cursor += ch[1]
        self._build_groups(recs)
        self.layers = recs

    def _parse_record(self, fp, big):
        rec = LayerRec()
        rec.top, rec.left, rec.bottom, rec.right = _rd(fp, '>iiii')
        (nch,) = _rd(fp, '>H')
        rec.channels = []
        for _ in range(nch):
            (cid,) = _rd(fp, '>h')
            (ln,) = _rd(fp, '>Q' if big else '>I')
            rec.channels.append([cid, ln, 0])
        fp.read(4)                                      # '8BIM'
        fp.read(4)                                      # blend key
        rec.opacity, _clip, flags, _fill = _rd(fp, '>BBBB')
        rec.hidden = bool(flags & 2)
        (extra_len,) = _rd(fp, '>I')
        extra_end = fp.tell() + extra_len
        (mask_len,) = _rd(fp, '>I')
        fp.seek(mask_len, 1)
        (blend_len,) = _rd(fp, '>I')
        fp.seek(blend_len, 1)
        (nl,) = _rd(fp, '>B')
        raw_name = fp.read(nl)
        fp.seek(_pad(nl + 1, 4), 1)
        try:
            rec.name = raw_name.decode('mac_roman')
        except Exception:  # noqa: BLE001
            rec.name = raw_name.decode('latin-1', 'replace')
        rec.section = 0
        rec.group = None
        while fp.tell() + 12 <= extra_end:
            sig = fp.read(4)
            if sig not in (b'8BIM', b'8B64'):
                break
            key = fp.read(4)
            (length,) = _rd(fp, '>Q' if (big and key in BIG_KEYS) else '>I')
            start = fp.tell()
            if key == b'luni' and length >= 4:
                data = fp.read(length)
                (n,) = struct.unpack('>I', data[:4])
                try:
                    rec.name = data[4:4 + n * 2].decode('utf-16-be')
                except Exception:  # noqa: BLE001
                    pass
            elif key in SECTION_KEYS and length >= 4:
                (rec.section,) = struct.unpack('>I', fp.read(4))
            nxt = start + length
            # block padding is 4 in practice; fall back to 2 / 1 when the next signature does not line up
            for padding in (4, 2, 1):
                cand = nxt + _pad(length, padding)
                if cand + 4 > extra_end:
                    nxt = cand
                    break
                fp.seek(cand)
                if fp.read(4) in (b'8BIM', b'8B64'):
                    nxt = cand
                    break
            fp.seek(nxt)
        fp.seek(extra_end)
        return rec

    @staticmethod
    def _build_groups(recs):
        """Records are bottom -> top: a type-3 divider opens a group, its header (1/2) closes it."""
        stack = []
        for rec in recs:
            if rec.section == 3:                        # '</Layer group>' marker
                g = _Group(stack[-1] if stack else None)
                stack.append(g)
                rec.group = g
            elif rec.section in (1, 2):                 # group header
                g = stack.pop() if stack else _Group(None)
                g.hidden = rec.hidden
                rec.group = g
            else:
                rec.group = stack[-1] if stack else None

    # ------------------------------------------------------------ filtering
    @staticmethod
    def effective_hidden(rec):
        if rec.hidden:
            return True
        g = rec.group
        while g is not None:
            if g.hidden:
                return True
            g = g.parent
        return False

    def usable_layers(self, include_hidden):
        """[(record, original index)], skipped [{'name','reason'}] - bottom -> top."""
        out, skipped = [], []
        for i, rec in enumerate(self.layers):
            if rec.section in (1, 2, 3):
                continue                                # group header / divider: not an image
            if rec.width <= 0 or rec.height <= 0:
                skipped.append({'name': rec.name, 'reason': 'empty'})
                continue
            if not include_hidden and self.effective_hidden(rec):
                skipped.append({'name': rec.name, 'reason': 'hidden'})
                continue
            out.append(rec)
        return out, skipped

    # ------------------------------------------------------------ pixels
    def layer_image(self, fp, rec):
        """Decodes ONE layer (RGBA, native resolution) reading only its own channel bytes."""
        import numpy as np
        from PIL import Image
        from psd_tools.compression import decompress
        from psd_tools.constants import Compression

        if self.depth not in (8, 16):
            raise ValueError('%d-bit documents are not supported (use 8 or 16 bit).' % self.depth)
        w, h = rec.width, rec.height
        planes = {}
        for cid, length, offset in rec.channels:
            if cid < -1 or length < 2:                  # skip layer / vector masks and empty channels
                continue
            fp.seek(offset)
            blob = fp.read(length)
            comp = Compression(struct.unpack('>H', blob[:2])[0])
            raw = decompress(blob[2:], comp, w, h, self.depth, self.version)
            if self.depth == 16:
                arr = (np.frombuffer(raw, dtype='>u2').reshape(h, w) >> 8).astype(np.uint8)
            else:
                arr = np.frombuffer(raw, dtype=np.uint8).reshape(h, w)
            planes[cid] = arr
        full = np.full((h, w), 255, dtype=np.uint8)
        if self.mode == 3:                              # RGB
            if not all(c in planes for c in (0, 1, 2)):
                raise ValueError('Layer is missing colour channels.')
            r, g, b = planes[0], planes[1], planes[2]
        elif self.mode in (1, 8):                       # Grayscale / Duotone
            if 0 not in planes:
                raise ValueError('Layer is missing its gray channel.')
            r = g = b = planes[0]
        elif self.mode == 4:                            # CMYK (stored inverted: 255 = no ink)
            if not all(c in planes for c in (0, 1, 2, 3)):
                raise ValueError('Layer is missing CMYK channels.')
            k = planes[3].astype(np.uint16)
            r = (planes[0].astype(np.uint16) * k // 255).astype(np.uint8)
            g = (planes[1].astype(np.uint16) * k // 255).astype(np.uint8)
            b = (planes[2].astype(np.uint16) * k // 255).astype(np.uint8)
        else:
            raise ValueError('Colour mode %d is not supported (RGB, Grayscale and CMYK only).' % self.mode)
        a = planes.get(-1, full)
        return Image.fromarray(np.dstack([r, g, b, a]), 'RGBA')
