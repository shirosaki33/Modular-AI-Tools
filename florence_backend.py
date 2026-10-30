"""Image -> Prompt backend (PyTorch + ONNX Runtime) for Prompt Helper.

Used by server_max.py (localhost only). Heavy imports (torch / transformers /
onnxruntime) are lazy, so the server still starts fast when this feature is
never used. The top of this file only needs the Python standard library.

What it runs
    * Florence-2 (microsoft/, florence-community/) .............. PyTorch
    * Florence-2 PromptGen v2.0 (MiaoshouAI/) ................... PyTorch
    * Local folders with safetensors / pytorch_model.bin ........ PyTorch
        - Florence-2 / PromptGen folders (model_type "florence2")
        - other vision-language models (generic chat-template loader)
    * ONNX taggers (SmilingWolf WD14 style: model.onnx + csv) ... onnxruntime

Requirements
    pip install torch transformers pillow huggingface_hub
    pip install onnxruntime            (or onnxruntime-gpu)  - ONNX taggers only
    Florence-2 remote-code models may also need: pip install einops timm

Where models are found
    models/                    Hugging Face cache layout (models--org--name)  and
                               plain model folders (models/<name>, models/<org>/<name>)
    models/onnx/               ONNX taggers (flat files or one folder per model)
    extra folders              added from the page (stored in local/model_folders.json)
"""
import gc
import io
import json
import os
import re
import shutil
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(ROOT, 'models')
FOLDERS_FILE = os.path.join(ROOT, 'local', 'model_folders.json')

# ---------------------------------------------------------------- tasks
TASKS_FLORENCE = ('CAPTION', 'DETAILED_CAPTION', 'MORE_DETAILED_CAPTION', 'OCR', 'OD')
# MiaoshouAI/Florence-2-*-PromptGen-v2.0 (see the model card).
TASKS_PROMPTGEN = ('GENERATE_TAGS', 'CAPTION', 'DETAILED_CAPTION', 'MORE_DETAILED_CAPTION',
                   'ANALYZE', 'MIXED_CAPTION', 'MIXED_CAPTION_PLUS')

# trust_remote_code executes code from the repo, so only known repos are allowed.
ALLOWED_PREFIXES = ('microsoft/Florence-2', 'florence-community/Florence-2', 'MiaoshouAI/Florence-2')
MODEL_ID_RE = re.compile(r'^[\w.\-]+/[\w.\-]+$')
IGNORE_PATTERNS = ['*.onnx', 'onnx/*', '*.msgpack', '*.h5', '*.ot', '*.tflite']

MAX_DEPTH = 4
SKIP_DIRS = {'__pycache__', 'node_modules', 'snapshots_tmp', '.git'}


class _Cancelled(Exception):
    pass


class _Busy(Exception):
    pass


_state_lock = threading.Lock()
_gen_lock = threading.Lock()
_cancel = threading.Event()
_S = {'state': 'idle', 'message': '', 'error': '', 'model': None,
      'device': None, 'device_pref': None, 'obj': None}
_P = {'loaded': 0, 'total': 0, 'file': ''}


def _set(**kw):
    with _state_lock:
        _S.update(kw)


# ---------------------------------------------------------------- dependencies
def _deps():
    try:
        import torch
        import transformers
    except Exception as e:  # noqa: BLE001
        raise RuntimeError('PyTorch / transformers not available ({}). Run: pip install torch transformers pillow huggingface_hub'.format(e))
    return torch, transformers


def _ort():
    try:
        import onnxruntime
    except Exception as e:  # noqa: BLE001
        raise RuntimeError('onnxruntime not available ({}). Run: pip install onnxruntime  (or onnxruntime-gpu)'.format(e))
    return onnxruntime


# ---------------------------------------------------------------- paths / folders
def _norm(p):
    return os.path.normcase(os.path.abspath(p))


def _inside(path, base):
    try:
        return os.path.commonpath([_norm(path), _norm(base)]) == _norm(base)
    except ValueError:  # different drives on Windows
        return False


def folders():
    """Extra folders added from the page that still exist."""
    try:
        with open(FOLDERS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return [p for p in data if isinstance(p, str) and os.path.isdir(p)]


def _save_folders(items):
    os.makedirs(os.path.dirname(FOLDERS_FILE), exist_ok=True)
    tmp = FOLDERS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    os.replace(tmp, FOLDERS_FILE)


def add_folder(path):
    path = os.path.abspath(os.path.expanduser(str(path or '').strip().strip('"')))
    if not os.path.isdir(path):
        raise ValueError('Folder not found: {}'.format(path))
    items = folders()
    if not any(_norm(p) == _norm(path) for p in items):
        items.append(path)
        _save_folders(items)
        return path, True
    return path, False


def remove_folder(path):
    items = folders()
    keep = [p for p in items if _norm(p) != _norm(str(path or ''))]
    if len(keep) != len(items):
        _save_folders(keep)
    return len(keep) != len(items)


def pick_folder():
    """Opens a native folder dialog on the machine running the server (tkinter in a child process)."""
    import subprocess
    import sys
    code = ("import tkinter as tk\nfrom tkinter import filedialog\nr = tk.Tk()\nr.withdraw()\n"
            "try:\n    r.attributes('-topmost', True)\nexcept Exception:\n    pass\n"
            "print(filedialog.askdirectory(title='Select a model folder') or '')\n")
    try:
        out = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, timeout=600)
    except Exception as e:  # noqa: BLE001
        raise RuntimeError('Folder dialog not available ({}).'.format(e))
    if out.returncode != 0:
        raise RuntimeError('Folder dialog not available (tkinter is missing). Type the folder path instead.')
    path = out.stdout.strip()
    if not path:
        return {'path': '', 'added': False}
    path, added = add_folder(path)
    return {'path': path, 'added': added}


def _allowed_roots():
    return [MODELS_DIR] + folders()


def _key(path):
    """Id suffix: relative to ROOT (forward slashes) when inside it, else absolute."""
    path = os.path.abspath(path)
    if _inside(path, ROOT):
        return os.path.relpath(path, ROOT).replace('\\', '/')
    return path.replace('\\', '/')


def _resolve_path(key):
    p = key if os.path.isabs(key) else os.path.join(ROOT, key)
    p = os.path.abspath(p)
    if not any(_inside(p, r) for r in _allowed_roots()):
        raise ValueError('Path is outside models/ and the added folders: {}'.format(key))
    return p


# ---------------------------------------------------------------- scanning
def _dir_size(path):
    total = 0
    for base, _d, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    return total


def _read_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _has_weights(d):
    try:
        for f in os.listdir(d):
            lf = f.lower()
            if lf.endswith('.safetensors') or lf.endswith('.pt') or lf.endswith('.pth') \
                    or (lf.startswith('pytorch_model') and lf.endswith('.bin')):
                return True
    except OSError:
        pass
    return False


def _is_model_dir(d):
    return os.path.isfile(os.path.join(d, 'config.json')) and _has_weights(d)


def _display_name(d):
    """org/name for Hugging Face cache snapshots, else the folder name."""
    parts = os.path.abspath(d).replace('\\', '/').split('/')
    for i in range(len(parts) - 1, -1, -1):
        if parts[i].startswith('models--'):
            bits = parts[i].split('--', 2)
            if len(bits) == 3:
                return bits[1] + '/' + bits[2]
    return os.path.basename(os.path.abspath(d))


def _is_promptgen(d, name=''):
    if 'promptgen' in (name or d).lower() or 'promptgen' in d.lower():
        return True
    try:
        with open(os.path.join(d, 'README.md'), 'r', encoding='utf-8', errors='ignore') as f:
            return 'promptgen' in f.read(6000).lower()
    except OSError:
        return False


def _family_for_dir(d):
    cfg = _read_json(os.path.join(d, 'config.json'))
    if cfg.get('model_type') == 'florence2':
        return 'promptgen' if _is_promptgen(d, _display_name(d)) else 'florence'
    return 'vlm'


def _walk_dirs(root, depth=MAX_DEPTH):
    """Yields directories under root (root included), depth-limited, skipping noise."""
    stack = [(root, 0)]
    while stack:
        d, lvl = stack.pop()
        yield d
        if lvl >= depth:
            continue
        try:
            names = sorted(os.listdir(d), reverse=True)
        except OSError:
            continue
        for n in names:
            p = os.path.join(d, n)
            if n.startswith('.') or n in SKIP_DIRS or not os.path.isdir(p):
                continue
            stack.append((p, lvl + 1))


def _find_csv(onnx_path):
    d = os.path.dirname(onnx_path)
    base = os.path.splitext(os.path.basename(onnx_path))[0]
    try:
        files = os.listdir(d)
    except OSError:
        return None
    lower = {f.lower(): f for f in files}
    for cand in (base + '.csv', base + '_tags.csv', 'selected_tags.csv', 'tags.csv'):
        if cand.lower() in lower:
            return os.path.join(d, lower[cand.lower()])
    csvs = [f for f in files if f.lower().endswith('.csv')]
    if len(csvs) == 1:
        return os.path.join(d, csvs[0])
    return None


def scan_taggers(roots):
    """ONNX taggers: every *.onnx that has a tag CSV next to it."""
    found, seen = [], set()
    for root in roots:
        if not os.path.isdir(root):
            continue
        for d in _walk_dirs(root):
            try:
                names = sorted(os.listdir(d))
            except OSError:
                continue
            for n in names:
                p = os.path.join(d, n)
                if not n.lower().endswith('.onnx') or not os.path.isfile(p) or _norm(p) in seen:
                    continue
                csv_path = _find_csv(p)
                if not csv_path:
                    continue
                seen.add(_norm(p))
                base = os.path.splitext(n)[0]
                name = os.path.basename(d) if base.lower() in ('model', 'model_optimized', 'model_fp16') and _norm(d) != _norm(root) else base
                try:
                    size = os.path.getsize(p)
                except OSError:
                    size = 0
                found.append({'id': 'tagger:' + _key(p), 'name': name, 'rel': _key(p), 'csv': _key(csv_path),
                              'size': size, 'inside_root': _inside(p, ROOT)})
    found.sort(key=lambda m: m['name'].lower())
    return found


def _scan_hub_cache():
    out = []
    if not os.path.isdir(MODELS_DIR):
        return out
    for name in sorted(os.listdir(MODELS_DIR)):
        path = os.path.join(MODELS_DIR, name)
        if not name.startswith('models--') or not os.path.isdir(path):
            continue
        bits = name.split('--', 2)
        snaps = os.path.join(path, 'snapshots')
        try:
            ok = len(bits) == 3 and os.path.isdir(snaps) and any(os.scandir(snaps))
        except OSError:
            ok = False
        if ok:
            out.append({'id': bits[1] + '/' + bits[2], 'size': _dir_size(path)})
    return out


def _scan_local_models():
    """Plain folders with config.json + weights, in models/ and in the added folders."""
    found, seen = [], set()

    def consider(d, source):
        if _norm(d) in seen or not _is_model_dir(d):
            return False
        seen.add(_norm(d))
        cfg = _read_json(os.path.join(d, 'config.json'))
        fam = _family_for_dir(d)
        found.append({'id': 'local:' + _key(d), 'name': _display_name(d), 'family': fam,
                      'model_type': cfg.get('model_type', ''), 'source': source, 'size': _dir_size(d)})
        return True

    # models/: only first two levels, never the hub cache or the onnx folder.
    if os.path.isdir(MODELS_DIR):
        for a in sorted(os.listdir(MODELS_DIR)):
            pa = os.path.join(MODELS_DIR, a)
            if a.startswith('.') or a.startswith('models--') or a == 'onnx' or not os.path.isdir(pa):
                continue
            if consider(pa, 'models'):
                continue
            for b in sorted(os.listdir(pa)):
                pb = os.path.join(pa, b)
                if not b.startswith('.') and os.path.isdir(pb):
                    consider(pb, 'models')
    for root in folders():
        for d in _walk_dirs(root):
            consider(d, 'folder')
    found.sort(key=lambda m: m['name'].lower())
    return found


def scan_all():
    roots = [os.path.join(MODELS_DIR, 'onnx')] + folders()
    return {'dir': 'models', 'exists': os.path.isdir(MODELS_DIR), 'hub': _scan_hub_cache(),
            'local': _scan_local_models(), 'taggers': scan_taggers(roots), 'folders': folders()}


# ---------------------------------------------------------------- model specs
def _check_model_id(model_id):
    if not isinstance(model_id, str) or not MODEL_ID_RE.match(model_id) or not model_id.startswith(ALLOWED_PREFIXES):
        raise ValueError('Model not allowed: {}'.format(model_id))
    return model_id


def _model_dir(model_id):
    return os.path.join(MODELS_DIR, 'models--' + model_id.replace('/', '--'))


def _is_cached(model_id):
    snaps = os.path.join(_model_dir(model_id), 'snapshots')
    try:
        return os.path.isdir(snaps) and any(os.scandir(snaps))
    except OSError:
        return False


def _spec(model_id):
    """Describes how to run a model id: hub id, local:<path> or tagger:<path>."""
    if not isinstance(model_id, str) or not model_id:
        raise ValueError('No model selected.')
    if model_id.startswith('tagger:'):
        path = _resolve_path(model_id[len('tagger:'):])
        if not os.path.isfile(path):
            raise ValueError('ONNX file not found: {}'.format(path))
        csv_path = _find_csv(path)
        if not csv_path:
            raise ValueError('No tag CSV found next to {} (expected <name>.csv or selected_tags.csv).'.format(os.path.basename(path)))
        return {'kind': 'tagger', 'src': path, 'csv': csv_path, 'local': True, 'name': os.path.basename(path)}
    if model_id.startswith('local:'):
        path = _resolve_path(model_id[len('local:'):])
        if not os.path.isdir(path) or not os.path.isfile(os.path.join(path, 'config.json')):
            raise ValueError('Model folder not found (or no config.json): {}'.format(path))
        cfg = _read_json(os.path.join(path, 'config.json'))
        family = _family_for_dir(path)
        remote = family != 'vlm' and 'auto_map' in cfg
        return {'kind': 'torch', 'src': path, 'local': True, 'family': family,
                'native': family != 'vlm' and not remote, 'remote': remote, 'name': _display_name(path)}
    _check_model_id(model_id)
    low = model_id.lower()
    return {'kind': 'torch', 'src': model_id, 'local': False,
            'family': 'promptgen' if 'promptgen' in low else 'florence',
            'native': low.startswith('florence-community/'),
            'remote': not low.startswith('florence-community/'), 'name': model_id}


def tasks_for(family):
    return TASKS_PROMPTGEN if family == 'promptgen' else TASKS_FLORENCE


def _resolve_device(torch, pref):
    if pref == 'cpu':
        return 'cpu'
    if torch.cuda.is_available():
        return 'cuda'
    if pref == 'auto' and getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


# ---------------------------------------------------------------- status
def status(model=None):
    kind = 'tagger' if (model or '').startswith('tagger:') else 'torch'
    info = {'available': False, 'deps_error': '', 'torch': '', 'transformers': '', 'onnxruntime': '',
            'cuda': False, 'gpu': '', 'cached': False, 'kind': kind, 'providers': []}
    if kind == 'tagger':
        try:
            ort = _ort()
            provs = list(ort.get_available_providers())
            info.update(available=True, onnxruntime=ort.__version__, providers=provs,
                        cuda='CUDAExecutionProvider' in provs, gpu='CUDA' if 'CUDAExecutionProvider' in provs else '')
        except RuntimeError as e:
            info['deps_error'] = str(e)
    else:
        try:
            torch, tf = _deps()
            info.update(available=True, torch=torch.__version__, transformers=tf.__version__,
                        cuda=bool(torch.cuda.is_available()))
            if info['cuda']:
                info['gpu'] = torch.cuda.get_device_name(0)
        except RuntimeError as e:
            info['deps_error'] = str(e)
    if model:
        try:
            spec = _spec(model)
            info['cached'] = True if spec['local'] else _is_cached(model)
            info['family'] = spec.get('family', '')
        except ValueError:
            pass
    with _state_lock:
        info.update(state=_S['state'], message=_S['message'], error=_S['error'],
                    progress=dict(_P),
                    loaded=({'model': _S['model'], 'device': _S['device'], 'device_pref': _S['device_pref']}
                            if _S['obj'] is not None else None))
    return info


# ---------------------------------------------------------------- loading
def _make_tqdm():
    from huggingface_hub.utils import tqdm as hf_tqdm

    class T(hf_tqdm):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            if getattr(self, 'unit', '') == 'B' and getattr(self, 'total', None):
                _P['total'] += int(self.total)
            desc = getattr(self, 'desc', None)
            if desc:
                _P['file'] = str(desc)

        def update(self, n=1):
            if _cancel.is_set():
                raise _Cancelled()
            r = super().update(n)
            if getattr(self, 'unit', '') == 'B' and n:
                _P['loaded'] += int(n)
            return r

    return T


def _build(torch, tf, spec, dtype):
    src = spec['src']
    kw = {'torch_dtype': dtype}
    if spec['local']:
        kw['local_files_only'] = True
    else:
        kw['cache_dir'] = MODELS_DIR
    pkw = {k: v for k, v in kw.items() if k != 'torch_dtype'}

    if spec['family'] == 'vlm':
        # Generic vision-language model: first loader class that accepts it.
        last = None
        model = None
        for cls_name in ('AutoModelForImageTextToText', 'AutoModelForVision2Seq', 'AutoModelForCausalLM'):
            cls = getattr(tf, cls_name, None)
            if cls is None:
                continue
            try:
                model = cls.from_pretrained(src, **kw)
                break
            except Exception as e:  # noqa: BLE001
                last = e
        if model is None:
            raise RuntimeError('Could not load this model with the generic loader ({}). It may need custom code or a newer transformers.'.format(last))
        processor = tf.AutoProcessor.from_pretrained(src, **pkw)
        return model, processor

    if spec['native']:
        cls = getattr(tf, 'Florence2ForConditionalGeneration', None)
        if cls is None:
            raise RuntimeError('This transformers version has no native Florence-2. Run: pip install -U transformers (or pick a microsoft/... or MiaoshouAI/... model).')
        model = cls.from_pretrained(src, **kw)
        processor = tf.AutoProcessor.from_pretrained(src, **pkw)
    else:
        model = tf.AutoModelForCausalLM.from_pretrained(src, trust_remote_code=True, attn_implementation='eager', **kw)
        processor = tf.AutoProcessor.from_pretrained(src, trust_remote_code=True, **pkw)
    return model, processor


def _free():
    with _state_lock:
        _S['obj'] = None
        _S['model'] = None
        _S['device'] = None
        _S['device_pref'] = None
    gc.collect()
    try:
        import sys
        torch = sys.modules.get('torch')
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


def _read_tags(csv_path):
    """SmilingWolf-style CSV (tag_id,name,category,count) -> [(name, category)]."""
    import csv
    with open(csv_path, 'r', newline='', encoding='utf-8-sig') as f:
        rows = [r for r in csv.reader(f) if r]
    if len(rows) < 2:
        raise ValueError('The tag CSV is empty.')
    head = [h.strip().lower() for h in rows[0]]
    ni = head.index('name') if 'name' in head else 1
    ci = head.index('category') if 'category' in head else 2
    tags = []
    for r in rows[1:]:
        if ni >= len(r):
            continue
        cat = 0
        if ci < len(r) and re.match(r'^-?\d+$', r[ci].strip()):
            cat = int(r[ci].strip())
        tags.append((r[ni].replace('_', ' '), cat))
    return tags


def _load_tagger(spec, device_pref):
    ort = _ort()
    avail = ort.get_available_providers()
    want_cuda = device_pref in ('auto', 'cuda') and 'CUDAExecutionProvider' in avail
    providers = (['CUDAExecutionProvider'] if want_cuda else []) + ['CPUExecutionProvider']
    _set(message='Loading ONNX tagger...')
    try:
        sess = ort.InferenceSession(spec['src'], providers=providers)
    except Exception as e:  # noqa: BLE001
        if not want_cuda:
            raise
        print('[florence] ONNX CUDA failed ({}); falling back to CPU'.format(e), flush=True)
        sess = ort.InferenceSession(spec['src'], providers=['CPUExecutionProvider'])
    if _cancel.is_set():
        raise _Cancelled()
    tags = _read_tags(spec['csv'])
    inp = sess.get_inputs()[0]
    shape = list(inp.shape)
    size = 448
    if len(shape) == 4:
        if shape[3] == 3 and isinstance(shape[1], int):
            size = shape[1]
        elif shape[1] == 3:
            raise ValueError('This tagger expects channels-first (NCHW) input. Only WD14/SmilingWolf-style NHWC taggers are supported.')
    used = sess.get_providers()[0].replace('ExecutionProvider', '')
    return {'kind': 'tagger', 'sess': sess, 'tags': tags, 'size': size, 'input': inp.name}, used


def _load_worker(model_id, device_pref):
    try:
        spec = _spec(model_id)
        _free()
        _cancel.clear()
        _P.update(loaded=0, total=0, file='')
        _set(state='loading', message='Loading...', error='')

        if spec['kind'] == 'tagger':
            obj, device = _load_tagger(spec, device_pref)
            with _state_lock:
                _S.update(state='ready', message='Tagger ready ({}).'.format(device), error='',
                          model=model_id, device=device, device_pref=device_pref, obj=obj)
            return

        torch, tf = _deps()
        if not spec['local']:
            _set(message='Downloading model files...')
            from huggingface_hub import snapshot_download
            try:
                snapshot_download(model_id, cache_dir=MODELS_DIR, ignore_patterns=IGNORE_PATTERNS,
                                  tqdm_class=_make_tqdm())
            except TypeError:  # very old huggingface_hub without tqdm_class
                snapshot_download(model_id, cache_dir=MODELS_DIR, ignore_patterns=IGNORE_PATTERNS)
            if _cancel.is_set():
                raise _Cancelled()

        device = _resolve_device(torch, device_pref)
        dtype = torch.float16 if device == 'cuda' else torch.float32
        _set(message='Loading model into memory ({})...'.format(device))
        try:
            model, processor = _build(torch, tf, spec, dtype)
            model.to(device)
        except Exception as e:  # noqa: BLE001  (e.g. out of VRAM) -> CPU fallback
            if device == 'cpu':
                raise
            print('[florence] {} failed ({}); falling back to CPU'.format(device, e), flush=True)
            _free()
            device, dtype = 'cpu', torch.float32
            _set(message='GPU failed, falling back to CPU...')
            model, processor = _build(torch, tf, spec, dtype)
            model.to('cpu')
        model.eval()
        if _cancel.is_set():
            raise _Cancelled()
        obj = {'kind': 'torch', 'model': model, 'processor': processor, 'spec': spec}
        with _state_lock:
            _S.update(state='ready', message='Model ready ({}).'.format(device), error='',
                      model=model_id, device=device, device_pref=device_pref, obj=obj)
    except _Cancelled:
        _free()
        _set(state='cancelled', message='', error='Cancelled.')
    except Exception as e:  # noqa: BLE001
        _free()
        _set(state='error', message='', error=str(e))


def load(model_id, device_pref):
    spec = _spec(model_id)          # validates the id / path first
    if device_pref not in ('auto', 'cuda', 'cpu'):
        device_pref = 'auto'
    if spec['kind'] == 'tagger':
        _ort()
    else:
        _deps()
    with _state_lock:
        if _S['state'] == 'loading':
            raise _Busy('A model is already loading.')
        _S['state'] = 'loading'
    threading.Thread(target=_load_worker, args=(model_id, device_pref), daemon=True).start()


# ---------------------------------------------------------------- inference
def _clean(text):
    return re.sub(r'\s+', ' ', str(text or '')).strip()


def _strip_special(decoded, token):
    t = str(decoded or '')
    for s in ('<s>', '</s>', '<pad>', '<unk>', token):
        t = t.replace(s, ' ')
    return t


def _tag_image(image, size):
    """WD14 preprocessing: white background, letterbox to size x size, BGR float32 NHWC."""
    import numpy as np
    from PIL import Image
    if image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info):
        image = image.convert('RGBA')
        bg = Image.new('RGBA', image.size, (255, 255, 255, 255))
        bg.alpha_composite(image)
        image = bg
    image = image.convert('RGB')
    scale = min(size / image.width, size / image.height)
    w, h = max(1, round(image.width * scale)), max(1, round(image.height * scale))
    resample = getattr(getattr(Image, 'Resampling', Image), 'BICUBIC')
    image = image.resize((w, h), resample)
    canvas = Image.new('RGB', (size, size), (255, 255, 255))
    canvas.paste(image, ((size - w) // 2, (size - h) // 2))
    arr = np.asarray(canvas, dtype=np.float32)[:, :, ::-1]    # RGB -> BGR
    return np.ascontiguousarray(arr)[None, ...]


def _generate_tagger(obj, image_bytes, params, device):
    from PIL import Image
    t0 = time.time()
    try:
        threshold = float(params.get('threshold', 0.35))
    except (TypeError, ValueError):
        threshold = 0.35
    threshold = min(1.0, max(0.0, threshold))
    exclude = {t.strip().lower() for t in str(params.get('exclude', '')).split(',') if t.strip()}
    prefix = [t.strip() for t in str(params.get('prefix', '')).split(',') if t.strip()]
    image = Image.open(io.BytesIO(image_bytes))
    arr = _tag_image(image, obj['size'])
    out = obj['sess'].run(None, {obj['input']: arr})[0]
    probs = out[0].reshape(-1)
    tags = obj['tags']
    if len(probs) != len(tags):
        raise ValueError('The model outputs {} scores but the CSV lists {} tags - wrong CSV for this model?'.format(len(probs), len(tags)))
    picked = [(float(probs[i]), tags[i][0]) for i in range(len(tags))
              if probs[i] >= threshold and tags[i][1] != 9 and tags[i][0].lower() not in exclude]
    picked.sort(key=lambda x: -x[0])
    names = [n for _p, n in picked]
    final = prefix + [n for n in names if n not in prefix]
    return {'text': ', '.join(final), 'count': len(final), 'seconds': round(time.time() - t0, 2), 'device': device}


def _florence_text(parsed, token, decoded):
    out = parsed.get(token) if isinstance(parsed, dict) else parsed
    if isinstance(out, str):
        text = out
        if text.startswith(token):
            text = text[len(token):]
        return text
    if isinstance(out, dict) and isinstance(out.get('labels'), list):
        seen, labels = set(), []
        for lb in out['labels']:
            lb = _clean(lb).lower()
            if lb and lb not in seen:
                seen.add(lb)
                labels.append(lb)
        return ', '.join(labels)
    return None


def generate(image_bytes, params):
    max_tokens = max(16, min(int(params.get('max_tokens', 256)), 1024))
    beams = max(1, min(int(params.get('beams', 3)), 8))
    with _state_lock:
        if _S['state'] == 'loading':
            raise _Busy('The model is still loading.')
        obj, device = _S['obj'], _S['device']
    if obj is None:
        raise RuntimeError('No model loaded. Load a model first.')
    if not _gen_lock.acquire(blocking=False):
        raise _Busy('Another generation is running.')
    try:
        _cancel.clear()
        if obj['kind'] == 'tagger':
            return _generate_tagger(obj, image_bytes, params, device)

        torch, tf = _deps()
        from PIL import Image
        model, processor, spec = obj['model'], obj['processor'], obj['spec']
        t0 = time.time()
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        dtype = next(model.parameters()).dtype

        class _Stop(tf.StoppingCriteria):
            def __call__(self, input_ids, scores, **kw):
                return torch.full((input_ids.shape[0],), _cancel.is_set(), dtype=torch.bool, device=input_ids.device)

        def to_dev(raw):
            return {k: (v.to(device, dtype) if v.is_floating_point() else v.to(device)) for k, v in raw.items()}

        kwargs = dict(max_new_tokens=max_tokens, num_beams=beams, do_sample=False,
                      stopping_criteria=tf.StoppingCriteriaList([_Stop()]))

        if spec['family'] == 'vlm':
            prompt = _clean(params.get('prompt', '')) or 'Describe this image in detail.'
            messages = [{'role': 'user', 'content': [{'type': 'image'}, {'type': 'text', 'text': prompt}]}]
            chat = processor.apply_chat_template(messages, add_generation_prompt=True)
            inputs = to_dev(processor(text=chat, images=[image], return_tensors='pt'))
            with torch.inference_mode():
                ids = model.generate(**inputs, **kwargs)
            if _cancel.is_set():
                raise _Cancelled()
            ids = ids[:, inputs['input_ids'].shape[1]:]
            dec = getattr(processor, 'batch_decode', None) or processor.tokenizer.batch_decode
            text = dec(ids, skip_special_tokens=True)[0]
            return {'text': _clean(text), 'seconds': round(time.time() - t0, 2), 'device': device}

        task = str(params.get('task', 'MORE_DETAILED_CAPTION'))
        if task not in tasks_for(spec['family']):
            raise ValueError('Unknown task for this model: {}'.format(task))
        token = '<{}>'.format(task)
        inputs = to_dev(processor(text=token, images=image, return_tensors='pt'))
        if not spec['native']:
            kwargs['use_cache'] = False  # works around remote-code issues on newer transformers
        with torch.inference_mode():
            ids = model.generate(**inputs, **kwargs)
        if _cancel.is_set():
            raise _Cancelled()

        decoded = processor.batch_decode(ids, skip_special_tokens=False)[0]
        text = None
        try:
            parsed = processor.post_process_generation(decoded, task=token, image_size=(image.width, image.height))
            text = _florence_text(parsed, token, decoded)
        except Exception as e:  # noqa: BLE001
            if spec['family'] != 'promptgen':
                raise
            print('[florence] post_process_generation failed ({}); using the raw text'.format(e), flush=True)
        if text is None:
            if spec['family'] != 'promptgen':
                raise ValueError('This Florence-2 task returned structured data that is not supported as text.')
            text = _strip_special(decoded, token)   # PromptGen answers are plain text
        return {'text': _clean(text), 'seconds': round(time.time() - t0, 2), 'device': device}
    finally:
        _gen_lock.release()


# ---------------------------------------------------------------- management
def cancel():
    _cancel.set()


def unload():
    with _state_lock:
        if _S['state'] == 'loading':
            raise _Busy('Cannot unload while loading.')
    _free()
    _set(state='idle', message='', error='')


def clear_cache(model_id):
    if isinstance(model_id, str) and (model_id.startswith('local:') or model_id.startswith('tagger:')):
        raise ValueError('Only models downloaded by this app (Hugging Face cache inside models/) can be deleted here. Delete local folders yourself.')
    _check_model_id(model_id)
    with _state_lock:
        if _S['state'] == 'loading':
            raise _Busy('Cannot delete while loading.')
        current = _S['model']
    if current == model_id:
        _free()
        _set(state='idle', message='', error='')
    path = _model_dir(model_id)
    if os.path.abspath(os.path.dirname(path)) != os.path.abspath(MODELS_DIR):
        raise ValueError('Invalid path.')
    existed = os.path.isdir(path)
    if existed:
        shutil.rmtree(path, ignore_errors=True)
    return existed


# ---------------------------------------------------------------- router
def handle(method, route, query, body):
    """Returns (http_code, dict)."""
    try:
        if method == 'GET' and route == 'status':
            return 200, status(query.get('model'))
        if method == 'GET' and route == 'models':
            return 200, scan_all()
        if method == 'POST' and route == 'load':
            data = json.loads(body.decode('utf-8') or '{}')
            load(data.get('model', ''), data.get('device', 'auto'))
            return 200, {'ok': True}
        if method == 'POST' and route == 'generate':
            return 200, generate(body, query)
        if method == 'POST' and route == 'cancel':
            cancel()
            return 200, {'ok': True}
        if method == 'POST' and route == 'unload':
            unload()
            return 200, {'ok': True}
        if method == 'POST' and route == 'clear_cache':
            data = json.loads(body.decode('utf-8') or '{}')
            return 200, {'ok': True, 'deleted': clear_cache(data.get('model', ''))}
        if method == 'POST' and route == 'pick_folder':
            return 200, pick_folder()
        if method == 'POST' and route == 'add_folder':
            data = json.loads(body.decode('utf-8') or '{}')
            path, added = add_folder(data.get('path', ''))
            return 200, {'ok': True, 'path': path, 'added': added}
        if method == 'POST' and route == 'remove_folder':
            data = json.loads(body.decode('utf-8') or '{}')
            return 200, {'ok': True, 'removed': remove_folder(data.get('path', ''))}
        return 404, {'error': 'Unknown Florence endpoint: {}'.format(route)}
    except _Busy as e:
        return 409, {'error': str(e)}
    except _Cancelled:
        return 499, {'error': 'Cancelled.'}
    except Exception as e:  # noqa: BLE001
        return 500, {'error': str(e)}
