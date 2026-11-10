"""PSD / PSB / XCF -> person detection backend for the Tag Manager ("PSD Import").

Formats (detected by file signature, not by extension):
  .psd / .psb  Photoshop (psd-tools; PSB = large document, same API)
  .xcf         GIMP (gimpformats; pip install gimpformats)

Used by server_max.py (localhost only), route prefix /api/psd/.

Flow
  1. POST analyze   : body = raw .psd / .psb / .xcf bytes. Reads every pixel layer (native resolution),
                      keeps them in a one-PSD session cache and returns the layer list.
  2. POST layer     : ?session=..&index=N  -> runs segm_person_yolo8m on that layer and returns the people boxes plus the layer
                      as a base64 PNG (the browser does the crop / bucket / save).
  3. POST thumb     : ?session=..&index=N&size=320 -> small JPEG (base64) for the manual-crop list.
  3b. Huge files (+150 MB): upload_start / upload_chunk (16 MB pieces into a temp file), then analyze?upload=ID;
                      count_head counts layers from the first bytes only; trim frees decoded layers between blocks.
  4. POST release   : frees the session (and deletes the temp upload) and unloads YOLO (VRAM back for Florence etc).
  5. POST detect    : body = any image bytes -> person boxes (used by the 🪣 Auto Bucket "seg body").
     POST unload    : unloads YOLO only.
  (SAM ViT refinement was removed in 2026-11.)

Layers are decoded lazily (small LRU), so a 40-layer PSD does not sit in RAM all at once.
The PSD file is only ever read from the upload - it is never written.

Heavy imports (torch / ultralytics / psd_tools) happen lazily, so the server
starts even when they are not installed. Missing packages are reported by GET status.

Models (all stay inside models/):
  models/psd/person_yolov8m-seg.pt   (Bingsu/adetailer; downloaded on first use if missing)
"""
import base64
import gc
import glob
import hashlib
import io
import json
import atexit
import os
import shutil
import tempfile
import threading
import time
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # project root (this file lives in tools/server/)
MODELS_DIR = os.path.join(ROOT, 'models')
PSD_MODELS_DIR = os.path.join(MODELS_DIR, 'psd')

YOLO_REPO = 'Bingsu/adetailer'
YOLO_FILE = 'person_yolov8m-seg.pt'
MAX_PEOPLE = 6          # safety cap per layer
YOLO_CONF = 0.30
YOLO_IMGSZ = 1280       # layers are ~2k screenshots: a bigger input keeps small people

_lock = threading.RLock()
LAYER_LRU = 3
_S = {'psd': None, 'session': None, 'layers': [], 'name': '', 'cache': OrderedDict(), 'thumbs': {},
      'fp': None, 'tmp': None}
UPLOAD_DIR = os.path.join(tempfile.gettempdir(), 'tagmanager_psd_uploads')
_UP = {}                # upload id -> {'path','size','name','got'}
UPLOAD_MAX_CHUNK = 64 * 1024 * 1024
_M = {'yolo': None, 'yolo_path': None, 'device': 'cpu'}


# ---------------------------------------------------------------- dependencies
def _missing():
    """Names of the pip packages that are not importable."""
    out = []
    for mod, pkg in (('gimpformats', 'gimpformats'), ('psd_tools', 'psd-tools'), ('PIL', 'pillow'), ('numpy', 'numpy'),
                     ('torch', 'torch'), ('ultralytics', 'ultralytics')):
        try:
            __import__(mod)
        except Exception:  # noqa: BLE001
            out.append(pkg)
    return out


def _find_yolo():
    """Any *person*seg*.pt inside models/ (depth <= 3). Returns the path or None."""
    exact = os.path.join(PSD_MODELS_DIR, YOLO_FILE)
    if os.path.isfile(exact):
        return exact
    for depth in ('*', os.path.join('*', '*'), os.path.join('*', '*', '*')):
        for p in glob.glob(os.path.join(MODELS_DIR, depth, '*.pt')):
            n = os.path.basename(p).lower()
            if 'person' in n and 'seg' in n:
                return p
    for p in glob.glob(os.path.join(MODELS_DIR, '*.pt')):
        n = os.path.basename(p).lower()
        if 'person' in n and 'seg' in n:
            return p
    return None


def status():
    return {
        'missing': _missing(),
        'yolo': _find_yolo(),
        'yolo_downloadable': '{}/{}'.format(YOLO_REPO, YOLO_FILE),
        'loaded': {'yolo': bool(_M['yolo'])},
        'session': _S['session'],
    }


# ---------------------------------------------------------------- PSD
def _flatten_layers(psd):
    """Pixel/smart-object layers in document order (bottom -> top), groups expanded."""
    out = []

    def walk(items):
        for layer in items:
            if layer.is_group():
                walk(layer)
            else:
                out.append(layer)

    walk(psd)
    return out


def _visible(layer):
    """Layer and every parent group visible."""
    cur = layer
    while cur is not None and not getattr(cur, 'is_root', lambda: False)():
        if not cur.is_visible():
            return False
        cur = cur.parent
    return True


def _psd_layers(body, include_hidden, skipped):
    """Photoshop PSD / PSB. Returns (canvas_w, canvas_h, [layer dict])."""
    from psd_tools import PSDImage
    psd = PSDImage.open(io.BytesIO(body))
    layers = []
    for layer in _flatten_layers(psd):
        name = layer.name or 'Layer'
        if not include_hidden and not _visible(layer):
            skipped.append({'name': name, 'reason': 'hidden'})
            continue
        if layer.kind not in ('pixel', 'smartobject', 'type', 'shape'):
            skipped.append({'name': name, 'reason': layer.kind})
            continue
        if layer.width <= 0 or layer.height <= 0:
            skipped.append({'name': name, 'reason': 'empty'})
            continue
        layers.append({'name': name, 'get': (lambda ref=layer: ref.topil()), 'w': layer.width, 'h': layer.height})
    return psd.width, psd.height, layers


def _xcf_layers(body, include_hidden, skipped):
    """GIMP XCF. Returns (canvas_w, canvas_h, [layer dict]) in bottom -> top order (like PSD)."""
    try:
        from gimpformats.gimpXcfDocument import GimpDocument
    except Exception:  # noqa: BLE001
        raise RuntimeError('GIMP .xcf files need the gimpformats package. Run: pip install gimpformats')
    doc = GimpDocument()
    doc.decode(body)
    layers = []

    def walk(node, parent_visible):
        for ch in node.children:
            if hasattr(ch, 'children'):                       # group
                opt = getattr(ch, 'layer_options', None)
                gv = True if opt is None or opt.visible is None else bool(opt.visible)
                walk(ch, parent_visible and gv)
                continue
            name = ch.name or 'Layer'
            vis = parent_visible and bool(ch.visible)
            if not include_hidden and not vis:
                skipped.append({'name': name, 'reason': 'hidden'})
                continue
            if not ch.width or not ch.height:
                skipped.append({'name': name, 'reason': 'empty'})
                continue
            layers.append({'name': name, 'get': (lambda ref=ch: ref.image), 'w': int(ch.width), 'h': int(ch.height)})

    walk(doc.walkTree(), True)
    layers.reverse()                                          # XCF lists the top layer first
    return doc.width, doc.height, layers


def _lazy_layers(fp, include_hidden):
    """Lazy PSD / PSB reader (psd_lazy.py): only the layer index is parsed; pixels are read per layer."""
    import psd_lazy
    idx = psd_lazy.PsdIndex.from_file(fp)
    recs, skipped = idx.usable_layers(include_hidden)
    layers = [{'name': r.name or 'Layer', 'get': (lambda rec=r: idx.layer_image(fp, rec)), 'w': r.width, 'h': r.height}
              for r in recs]
    return idx.width, idx.height, layers, skipped


def _collect(body, query, fp=None):
    """Parses a PSD / PSB / XCF. `fp` = open file object (big uploads) or None to use `body`.
    Returns (canvas_w, canvas_h, layers, skipped)."""
    if fp is None and not body:
        raise ValueError('Empty upload.')
    miss = [m for m in _missing() if m in ('psd-tools', 'pillow', 'numpy')]
    if miss:
        raise RuntimeError('Missing packages: {}. Run: pip install {}'.format(', '.join(miss), ' '.join(miss)))

    include_hidden = query.get('hidden') == '1'
    skipped = []
    if fp is not None:
        fp.seek(0)
        head = fp.read(9)
        fp.seek(0)
    else:
        head = body[:9]
    if head[:4] == b'8BPS':                                   # PSD (v1) and PSB (v2)
        if fp is None:
            fp = io.BytesIO(body)
        try:
            cw, ch, layers, skipped = _lazy_layers(fp, include_hidden)
        except Exception as e:  # noqa: BLE001
            if body:                                          # small upload: psd-tools can still try
                cw, ch, layers = _psd_layers(body, include_hidden, skipped)
                fp = None
            else:
                raise RuntimeError('Could not read this PSD/PSB: {}'.format(e))
        return cw, ch, layers, skipped, fp
    if head[:9] == b'gimp xcf ':
        data = body if fp is None else fp.read()
        cw, ch, layers = _xcf_layers(data, include_hidden, skipped)
        return cw, ch, layers, skipped, None
    raise ValueError('Unsupported file. Supported: .psd, .psb (Photoshop) and .xcf (GIMP).')


def count(body, query):
    """How many layers analyze() would return (no session is created, nothing is decoded)."""
    _, _, layers, skipped, _fp = _collect(body, query)
    return {'layers': len(layers), 'skipped': len(skipped)}


def count_head(body, query):
    """Counts layers from the FIRST bytes of a huge PSD / PSB (the layer index is stored before the pixels).
    Returns {'layers','skipped'} or {'need': N} (send at least N bytes) or {'unknown': True} (e.g. .xcf)."""
    import psd_lazy
    if body[:4] != b'8BPS':
        return {'unknown': True}
    total = int(query.get('total', '0')) or len(body)
    try:
        idx = psd_lazy.PsdIndex.from_file(psd_lazy.HeadFile(body, total))
    except psd_lazy.NeedMore as e:
        return {'need': e.end}
    recs, skipped = idx.usable_layers(query.get('hidden') == '1')
    return {'layers': len(recs), 'skipped': len(skipped)}


def _close_session():
    """Closes the open file and deletes the temp upload (the original PSD is never touched)."""
    fp, tmp = _S.get('fp'), _S.get('tmp')
    _S['fp'] = None
    _S['tmp'] = None
    if fp is not None:
        try:
            fp.close()
        except Exception:  # noqa: BLE001
            pass
    if tmp:
        _drop_upload(tmp)


def _drop_upload(path):
    for k in [k for k, v in _UP.items() if v['path'] == path]:
        _UP.pop(k, None)
    try:
        os.remove(path)
    except OSError:
        pass


def upload_start(query):
    """Chunked upload of a huge file into a temp file (browser -> localhost), so no 2 GB body is ever held in RAM."""
    size = int(query.get('size', '0'))
    if size <= 0:
        raise ValueError('Empty upload.')
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    free = shutil.disk_usage(UPLOAD_DIR).free
    if free < size * 1.02 + 64 * 1024 * 1024:
        raise RuntimeError('Not enough free disk space for a temporary copy ({:.1f} GB needed, {:.1f} GB free in {}).'
                           .format(size / 1e9, free / 1e9, UPLOAD_DIR))
    uid = hashlib.sha1((query.get('name', '') + str(size) + str(time.time())).encode()).hexdigest()[:14]
    path = os.path.join(UPLOAD_DIR, uid + '.bin')
    with open(path, 'wb'):
        pass
    _UP[uid] = {'path': path, 'size': size, 'name': query.get('name', ''), 'got': 0}
    return {'upload': uid, 'chunk': 16 * 1024 * 1024}


def upload_chunk(query, body):
    up = _UP.get(query.get('upload', ''))
    if not up:
        raise ValueError('Upload expired. Try again.')
    if len(body) > UPLOAD_MAX_CHUNK:
        raise ValueError('Chunk too large.')
    off = int(query.get('offset', '0'))
    with open(up['path'], 'r+b') as f:
        f.seek(off)
        f.write(body)
    up['got'] = max(up['got'], off + len(body))
    return {'received': up['got'], 'size': up['size']}


def analyze(body, query):
    """Parses the file once; layer pixels are decoded on demand (see _layer_img).
    `upload=<id>` (no body) analyzes a chunk-uploaded temp file."""
    path = None
    fp = None
    if query.get('upload'):
        up = _UP.get(query['upload'])
        if not up:
            raise ValueError('Upload expired. Try again.')
        if up['got'] < up['size']:
            raise ValueError('Upload incomplete ({} of {} bytes).'.format(up['got'], up['size']))
        path = up['path']
        fp = open(path, 'rb')
    try:
        cw, ch, layers, skipped, keep = _collect(body, query, fp)
    except Exception:
        if fp is not None:
            fp.close()
        if path:
            _drop_upload(path)
        raise
    if fp is not None and keep is None:                       # XCF was read fully into RAM: temp not needed
        fp.close()
        _drop_upload(path)
        path = None
    elif keep is not None and fp is None:
        fp = keep                                             # in-memory BytesIO of a small PSD

    sid = hashlib.sha1((query.get('name', '') + str(len(body)) + str(time.time())).encode()).hexdigest()[:12] + '-' + str(int(time.time()))
    with _lock:
        _close_session()
        _S['session'] = sid
        _S['layers'] = layers
        _S['psd'] = None
        _S['fp'] = fp if keep is not None or path else None
        _S['tmp'] = path
        _S['name'] = query.get('name', '')
        _S['cache'] = OrderedDict()
        _S['thumbs'] = {}
    return {
        'session': sid,
        'canvas': [cw, ch],
        'layers': [{'index': i, 'name': l['name'], 'w': l['w'], 'h': l['h']} for i, l in enumerate(layers)],
        'skipped': skipped,
    }


def trim():
    """Frees decoded layers (block switch): RAM / VRAM back, thumbnails stay cached."""
    with _lock:
        _S['cache'] = OrderedDict()
    _free()
    return {'ok': True}


def _cleanup_uploads(max_age=86400):
    try:
        for n in os.listdir(UPLOAD_DIR):
            p = os.path.join(UPLOAD_DIR, n)
            if os.path.isfile(p) and time.time() - os.path.getmtime(p) > max_age:
                os.remove(p)
    except OSError:
        pass


def _cleanup_all():
    try:
        _close_session()
        for v in list(_UP.values()):
            try:
                os.remove(v['path'])
            except OSError:
                pass
    except Exception:  # noqa: BLE001
        pass


atexit.register(_cleanup_all)
_cleanup_uploads()


def _check_session(query):
    sid = query.get('session', '')
    idx = int(query.get('index', '-1'))
    if sid != _S['session'] or idx < 0 or idx >= len(_S['layers']):
        raise ValueError('PSD session expired. Open the PSD again.')
    return idx


def _layer_img(idx):
    """RGBA PIL image of one layer at native resolution (small LRU cache)."""
    cache = _S['cache']
    if idx in cache:
        cache.move_to_end(idx)
        return cache[idx]
    img = _S['layers'][idx]['get']()
    if img is None:
        raise ValueError('This layer has no pixels.')
    img = img.convert('RGBA')
    cache[idx] = img
    while len(cache) > LAYER_LRU:
        cache.popitem(last=False)
    return img


def thumb(query):
    """Small JPEG of a layer for the manual-crop list (cached; ~20-40 KB each)."""
    from PIL import Image
    size = max(96, min(640, int(query.get('size', '320'))))
    with _lock:
        idx = _check_session(query)
        if idx in _S['thumbs']:
            return _S['thumbs'][idx]
        rgba = _layer_img(idx)
        bg = Image.new('RGB', rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[3])
        bg.thumbnail((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        bg.save(buf, format='JPEG', quality=82)
        out = {'index': idx, 'w': _S['layers'][idx]['w'], 'h': _S['layers'][idx]['h'],
               'jpg': base64.b64encode(buf.getvalue()).decode('ascii')}
        _S['thumbs'][idx] = out
        return out


# ---------------------------------------------------------------- models
def _torch():
    import torch
    return torch


def _free():
    gc.collect()
    try:
        torch = _torch()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


def _device(pref):
    torch = _torch()
    if pref == 'cpu':
        return 'cpu'
    return 'cuda' if torch.cuda.is_available() else 'cpu'


def _ensure_yolo(device):
    if _M['yolo'] is not None:
        return _M['yolo']
    path = _find_yolo()
    if not path:
        from huggingface_hub import hf_hub_download
        os.makedirs(PSD_MODELS_DIR, exist_ok=True)
        path = hf_hub_download(YOLO_REPO, YOLO_FILE, local_dir=PSD_MODELS_DIR)
    from ultralytics import YOLO
    model = YOLO(path)
    _M['yolo'] = model
    _M['yolo_path'] = path
    _M['device'] = device
    return model


def release():
    with _lock:
        _close_session()
        _S['session'] = None
        _S['layers'] = []
        _S['psd'] = None
        _S['cache'] = OrderedDict()
        _S['thumbs'] = {}
        _M['yolo'] = None
        _M['yolo_path'] = None
    _free()
    return {'ok': True}


# ---------------------------------------------------------------- detection
def _bbox_of_mask(mask):
    """mask: 2-D bool numpy array -> [x1, y1, x2, y2] (x2/y2 exclusive) or None."""
    import numpy as np
    ys, xs = np.where(mask)
    if xs.size == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def _yolo_people(img_rgb, min_area_pct):
    """Runs the person-seg model. Returns [{'box':[x1,y1,x2,y2], 'score':f, 'poly_box':[...]}]."""
    import numpy as np
    model = _M['yolo']
    w, h = img_rgb.size
    res = model.predict(np.asarray(img_rgb), conf=YOLO_CONF, imgsz=YOLO_IMGSZ,
                        device=_M['device'], verbose=False)
    out = []
    if not res:
        return out
    r = res[0]
    if r.boxes is None or len(r.boxes) == 0:
        return out
    boxes = r.boxes.xyxy.cpu().numpy()
    confs = r.boxes.conf.cpu().numpy()
    polys = r.masks.xy if (r.masks is not None and r.masks.xy is not None) else [None] * len(boxes)
    for b, c, poly in zip(boxes, confs, polys):
        x1, y1, x2, y2 = [float(v) for v in b]
        if poly is not None and len(poly) > 2:
            # the polygon hugs the body tighter than the detection box
            px1, py1 = float(poly[:, 0].min()), float(poly[:, 1].min())
            px2, py2 = float(poly[:, 0].max()), float(poly[:, 1].max())
            x1, y1, x2, y2 = px1, py1, px2, py2
        x1, y1 = max(0.0, x1), max(0.0, y1)
        x2, y2 = min(float(w), x2), min(float(h), y2)
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        if (x2 - x1) * (y2 - y1) < (min_area_pct / 100.0) * w * h:
            continue
        out.append({'box': [x1, y1, x2, y2], 'score': float(c)})
    out.sort(key=lambda p: p['score'], reverse=True)
    return out[:MAX_PEOPLE]


def layer(query):
    use_det = query.get('detect', '1') != '0'
    min_area = float(query.get('min_area', '3'))
    with _lock:
        idx = _check_session(query)
        item = _S['layers'][idx]
        rgba = _layer_img(idx)
    if use_det:
        miss = [m for m in _missing() if m in ('torch', 'ultralytics')]
        if miss:
            raise RuntimeError('Missing packages: {}. Run: pip install {}'.format(', '.join(miss), ' '.join(miss)))

    # flatten transparency over white: screenshots are opaque, soft edges stay predictable
    from PIL import Image
    bg = Image.new('RGB', rgba.size, (255, 255, 255))
    bg.paste(rgba, mask=rgba.split()[3])

    people = []
    if use_det:
        device = _device(query.get('device', 'auto'))
        with _lock:
            _ensure_yolo(device)
            people = _yolo_people(bg, min_area)

    # Output = the layer untouched. Opaque screenshots drop the (useless) alpha channel.
    has_alpha = rgba.getchannel('A').getextrema()[0] < 255
    out_img = rgba if has_alpha else bg
    buf = io.BytesIO()
    out_img.save(buf, format='PNG', compress_level=3)
    return {
        'index': idx,
        'name': item['name'],
        'w': bg.width, 'h': bg.height,
        'people': people,
        'png': base64.b64encode(buf.getvalue()).decode('ascii'),
    }


def detect(body, query):
    """Person boxes (segm_person_yolo8m) on ANY image (raw bytes in the body). Used by the 🪣 Auto Bucket
    to pick the best bucket / crop around the body. Returns {'w','h','people':[{'box','score'}]}."""
    miss = [m for m in _missing() if m in ('torch', 'ultralytics', 'pillow', 'numpy')]
    if miss:
        raise RuntimeError('Missing packages: {}. Run: pip install {}'.format(', '.join(miss), ' '.join(miss)))
    if not body:
        raise RuntimeError('Empty image.')
    from PIL import Image
    img = Image.open(io.BytesIO(body))
    img.load()
    rgba = img.convert('RGBA')
    bg = Image.new('RGB', rgba.size, (255, 255, 255))
    bg.paste(rgba, mask=rgba.split()[3])
    min_area = float(query.get('min_area', '3'))
    device = _device(query.get('device', 'auto'))
    with _lock:
        _ensure_yolo(device)
        people = _yolo_people(bg, min_area)
    return {'w': bg.width, 'h': bg.height, 'people': people}


def unload():
    """Unloads YOLO only (keeps any PSD session)."""
    with _lock:
        _M['yolo'] = None
        _M['yolo_path'] = None
    _free()
    return {'ok': True}


# ---------------------------------------------------------------- router
def handle(method, route, query, body):
    """Returns (http_code, dict)."""
    try:
        if method == 'GET' and route == 'status':
            return 200, status()
        if method == 'POST' and route == 'analyze':
            return 200, analyze(body, query)
        if method == 'POST' and route == 'count':
            return 200, count(body, query)
        if method == 'POST' and route == 'count_head':
            return 200, count_head(body, query)
        if method == 'POST' and route == 'upload_start':
            return 200, upload_start(query)
        if method == 'POST' and route == 'upload_chunk':
            return 200, upload_chunk(query, body)
        if method == 'POST' and route == 'trim':
            return 200, trim()
        if method == 'POST' and route == 'layer':
            return 200, layer(query)
        if method == 'POST' and route == 'thumb':
            return 200, thumb(query)
        if method == 'POST' and route == 'release':
            return 200, release()
        if method == 'POST' and route == 'detect':
            return 200, detect(body, query)
        if method == 'POST' and route == 'unload':
            return 200, unload()
        return 404, {'error': 'Unknown PSD endpoint: {}'.format(route)}
    except Exception as e:  # noqa: BLE001
        return 500, {'error': str(e)}
