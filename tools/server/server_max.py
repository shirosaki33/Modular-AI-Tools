"""Modular AI Tools - local server (port 8100).
Usage: python tools/server/server_max.py [chrome] [page.html]  (default: index.html)

What it does by itself (settings: local/server_config.json, created on the first run):
  - warm-up: PyTorch / transformers / onnxruntime are imported and checked in the background right at start, so the
    pages do not wait for it (first "status" call used to take several seconds); the pip update check is done once;
  - big cache files (Danbooru / e621 caches, wiki_full.json...) are saved in a background thread: the page gets its answer
    at once and the server does not re-encode the data (it used to freeze every other request for seconds);
  - Danbooru / e621 auto-fill: tools/server/booru_autofill.py runs as a separate process and keeps filling the caches
    (missing counts / wiki texts, then new tags of each site's catalog) while no page that uses those files is open.
"""
import atexit, heapq, http.server, json, os, re, shutil, stat, subprocess, sys, threading, time, webbrowser
from urllib.parse import quote, unquote, urlparse, parse_qs

PORT = 8100
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # project root (this file lives in tools/server/)
LOCAL_DIR = os.path.join(ROOT, 'local')
BACKUP_DIR = os.path.join(LOCAL_DIR, 'backups')   # automatic daily copies (see daily_backup)
BACKUP_FILES = ('user_config.json', 'user_presets.json', 'evaluator_results.json', 'nl_known_texts.json', 'danbooru_cache.json', 'e621_cache.json')
BACKUP_KEEP = 4                                    # 4 copies + the file in use = 5 versions
MODELS_DIR = os.path.join(ROOT, 'models')  # model files (Prompt Helper / Florence-2)
MODEL_ID_RE = re.compile(r'^[\w.\-]+/[\w.\-]+$')  # "org/name"
LOCAL_HOSTS = ('localhost', '127.0.0.1', '::1')
os.chdir(ROOT)

CONFIG_FILE = os.path.join(LOCAL_DIR, 'server_config.json')
WAKE_FILE = os.path.join(LOCAL_DIR, '.autofill_wake')   # 'Check now' in the index: the worker checks right away
STOP_FILE = os.path.join(LOCAL_DIR, '.autofill_stop')   # the auto-fill worker saves and exits when this file appears
WATCHED_FILES = ('danbooru_cache.json', 'e621_cache.json', 'wiki_full.json', 'unknown_tags.json')   # files the pages and the worker share
PRESENCE_TTL = 150      # a page that sent no ping for this long (seconds) is considered closed (background tabs ping slowly)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from booru_autofill import DEFAULTS as _AUTOFILL_DEFAULTS
except Exception:
    _AUTOFILL_DEFAULTS = {'enabled': False}
DEFAULT_CONFIG = {
    '_about': 'Settings of tools/server/server_max.py. Edit this file and restart the server; missing keys use the defaults.',
    'warmup': {'pytorch': True, 'onnxruntime': True, 'pip_check': True},
    'cache_saves': {'background': True, 'background_min_kb': 256},
    'booru_autofill': _AUTOFILL_DEFAULTS,
    'request_queue': {'enabled': True, 'check_online_every_seconds': 60, 'retry_when_down_seconds': 60, 'max_wait_seconds': 120},
}


def _merge(base, extra):
    out = dict(base)
    for k, v in (extra or {}).items():
        out[k] = _merge(base[k], v) if isinstance(base.get(k), dict) and isinstance(v, dict) else v
    return out


def load_config():
    """local/server_config.json merged over the defaults. Created with the defaults when it does not exist."""
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            user = json.load(f)
        return _merge(DEFAULT_CONFIG, user if isinstance(user, dict) else {})
    except FileNotFoundError:
        try:
            os.makedirs(LOCAL_DIR, exist_ok=True)
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
        except OSError:
            pass
    except Exception as e:
        print('[WARN  ] server_config.json could not be read ({}): using the defaults'.format(e), flush=True)
    return _merge(DEFAULT_CONFIG, {})



AUTOMATION_PAGES = ('tag manager.html', 'prompt helper.html')      # the automations only make sense when one of them is installed in this folder


def tools_installed():
    try:
        names = {f.lower() for f in os.listdir(ROOT)}
    except OSError:
        return False
    return any(n in names for n in AUTOMATION_PAGES)


def _gate_automation(cfg):
    """Safety trigger: without Tag Manager / Prompt Helper in the folder the automations stay off. True = something was switched off."""
    if tools_installed():
        return False
    a = cfg.get('booru_autofill')
    if not isinstance(a, dict) or not (a.get('enabled') or a.get('random_download')):
        return False
    a['enabled'] = False
    a['random_download'] = False
    return True


CONFIG = load_config()
if _gate_automation(CONFIG):
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as _f:
            json.dump(CONFIG, _f, ensure_ascii=False, indent=2)
        print('[WARN  ] Tag Manager / Prompt Helper were not found in this folder: the automations were switched off', flush=True)
    except OSError:
        pass

_EDITABLE_TEXT = {'wiki_mode': ('auto', 'off', 'short', 'full')}
_FREE_TEXT = {'e621_username'}                   # letters, digits, _ . - and spaces only
_NOT_EDITABLE = {'_about', 'api_base', 'user_agent'}          # api_base only exists to test the worker against a fake API


def _sanitize(default, value, name=''):
    """Takes from `value` only the keys that exist in `default`, with the same type (bool / whole number / known text)."""
    if isinstance(default, dict):
        out = {}
        for k, dv in default.items():
            if k in _NOT_EDITABLE or not isinstance(value, dict) or k not in value:
                continue
            got = _sanitize(dv, value[k], k)
            if got is not None:
                out[k] = got
        return out
    if isinstance(default, bool):
        return value if isinstance(value, bool) else None
    if isinstance(default, int):
        try:
            n = int(float(value))
        except (TypeError, ValueError):
            return None
        return max(0, min(n, 10 ** 7))
    if isinstance(default, str):
        if name in _FREE_TEXT:
            t = re.sub(r'[^A-Za-z0-9_.\- ]', '', str(value)).strip()[:60]
            return t
        return value if value in _EDITABLE_TEXT.get(name, ()) else None
    return None


def save_config_changes(changes):
    """Applies the settings sent by the index page: written to local/server_config.json (the worker re-reads it every few
    seconds) and to the running server (cache_saves). The warm-up options are used the next time the server starts."""
    clean = _sanitize({k: v for k, v in DEFAULT_CONFIG.items() if k not in _NOT_EDITABLE}, changes)
    new = _merge(CONFIG, clean)
    _gate_automation(new)                          # cannot be switched on without Tag Manager / Prompt Helper in the folder
    tmp = CONFIG_FILE + '.tmp'
    os.makedirs(LOCAL_DIR, exist_ok=True)
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(new, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_FILE)
    CONFIG.clear()
    CONFIG.update(new)
    p = AUTOFILL.get('proc')
    if (CONFIG.get('booru_autofill') or {}).get('enabled') and (p is None or p.poll() is not None):
        start_autofill()                           # switched on from the index while the worker was not running
    return CONFIG

# ---------------------------------------------------------------- request queue to Danbooru / e621
# EVERY request to the two sites (the pages, through tools/shared/booru_status.js, and the auto-fill worker) goes through
# one queue per site: one request at a time, a pause between requests, pages before the background worker, and the
# first thing the queue always does is to check that the site is online - only when it is, the requests go on.
BOORU_UA = 'ModularAITools/1.0 (local Tag Manager; github.com/shirosaki33/Modular-AI-Tools)'
PAGE_GAP = {'danbooru': 0.25, 'e621': 1.0}        # pause after a request made for a page (the worker uses the delays of its own settings)


class _SiteQueue:
    def __init__(self):
        self.cv = threading.Condition()
        self.heap, self.seq, self.busy = [], 0, False
        self.next_at = 0.0          # earliest start of the next request (pause between requests)
        self.cool_until = 0.0       # the site refused / is down: nothing is sent before this
        self.state = {'state': 'checking', 'reason': '', 'ms': None, 'at': 0.0, 'host': ''}

    def acquire(self, prio, max_wait):
        deadline = time.time() + max_wait
        with self.cv:
            self.seq += 1
            t = (prio, self.seq)
            heapq.heappush(self.heap, t)
            while True:
                now = time.time()
                ready = max(self.next_at, self.cool_until)
                if self.heap[0] == t and not self.busy and now >= ready:
                    heapq.heappop(self.heap)
                    self.busy = True
                    return True
                if now >= deadline:
                    self.heap.remove(t)
                    heapq.heapify(self.heap)
                    self.cv.notify_all()
                    return False
                self.cv.wait(timeout=0.5)

    def release(self, gap, cool=0.0):
        with self.cv:
            self.busy = False
            now = time.time()
            self.next_at = now + gap
            if cool:
                self.cool_until = max(self.cool_until, now + cool)
            self.cv.notify_all()

    def pending(self):
        with self.cv:
            return len(self.heap)


_BOORU_Q = {'danbooru': _SiteQueue(), 'e621': _SiteQueue()}


def _booru_site(url):
    try:
        u = urlparse(url)
    except Exception:
        return None
    host = (u.hostname or '').lower()
    if u.scheme != 'https' or u.username or u.port not in (None, 443):
        return None
    if host == 'donmai.us' or host.endswith('.donmai.us'):
        return 'danbooru'
    if host in ('e621.net', 'e926.net') or host.endswith('.e621.net') or host.endswith('.e926.net'):
        return 'e621'
    return None


def _booru_ua(site):
    c = CONFIG.get('booru_autofill') or {}
    if str(c.get('user_agent') or '').strip():
        return str(c['user_agent']).strip()
    if site == 'e621':
        name = re.sub(r'[^A-Za-z0-9_.\- ]', '', str(c.get('e621_username') or '')).strip()
        if name:
            return 'ModularAITools/1.0 (by {} on e621)'.format(name)
    return BOORU_UA


def _booru_get(site, url, timeout=25):
    """(status, body bytes, response headers). status 0 = no connection."""
    import urllib.request, urllib.error
    req = urllib.request.Request(url, headers={'User-Agent': _booru_ua(site), 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(16 * 1024 * 1024), r.headers
    except urllib.error.HTTPError as e:
        try:
            body = e.read(64 * 1024)
        except Exception:
            body = b''
        return e.code, body, e.headers
    except Exception as e:
        return 0, str(e).encode('utf-8', 'replace'), {}


def _booru_probe(site, host):
    """Same test as the dots of the pages: GET /tags.json?limit=1 must answer fast and with valid JSON."""
    t0 = time.time()
    code, body, _h = _booru_get(site, 'https://{}/tags.json?limit=1&_={}'.format(host, int(t0 * 1000)), timeout=8)
    ms = int((time.time() - t0) * 1000)
    if code == 0:
        return {'state': 'offline', 'reason': 'Could not connect', 'ms': None}
    if code == 429:
        return {'state': 'issues', 'reason': 'Rate limited (HTTP 429)', 'ms': ms}
    if code == 403:
        return {'state': 'issues', 'reason': 'Request blocked (HTTP 403)', 'ms': ms}
    if code in (502, 503, 504) or 520 <= code <= 530:
        return {'state': 'offline', 'reason': 'Server unavailable (HTTP {})'.format(code), 'ms': ms}
    if code >= 500 or code != 200:
        return {'state': 'issues', 'reason': 'Unexpected response (HTTP {})'.format(code), 'ms': ms}
    try:
        json.loads(body.decode('utf-8'))
    except Exception:
        return {'state': 'issues', 'reason': 'Invalid response body', 'ms': ms}
    return {'state': 'online', 'reason': '', 'ms': ms}


def booru_proxy(url, prio):
    """(status, body, extra headers) for GET `url` (a Danbooru / e621 address) after waiting in the queue of its site."""
    site = _booru_site(url)
    if not site:
        return 400, b'{"status": "error", "message": "not a Danbooru / e621 address"}', {}
    cfg = CONFIG.get('request_queue') or {}
    q = _BOORU_Q[site]
    hdr = {'X-Booru-Queue': '1'}
    if not q.acquire(prio, max(5, float(cfg.get('max_wait_seconds', 120)))):
        hdr['X-Booru-Down'] = 'queue timeout'
        return 503, b'{"error": "queue timeout"}', hdr
    gap, cool = (PAGE_GAP[site] if prio == 0 else None), 0.0
    if gap is None:
        gap = max(0.0, float(((CONFIG.get('booru_autofill') or {}).get('request_delay_ms') or {}).get(site, 400)) / 1000.0)
    if site == 'e621':
        gap = max(gap, 1.0)                            # e621: never faster than 1 request per second
    try:
        st = q.state
        host = urlparse(url).hostname
        # 1st: is the site online? (always checked when the last check is old, or when the site was not online)
        if st['state'] != 'online' or host != st['host'] or time.time() - st['at'] > float(cfg.get('check_online_every_seconds', 60)):
            res = _booru_probe(site, host)
            st.update(res, at=time.time(), host=host)
            if res['state'] != 'online':
                log('WARN', '{}: the site is not online ({}) - requests wait {}s'.format(site, res['reason'], int(cfg.get('retry_when_down_seconds', 60))))
        if st['state'] != 'online':
            cool = max(5.0, float(cfg.get('retry_when_down_seconds', 60)))
            hdr['X-Booru-Down'] = st['reason'] or st['state']
            return 503, json.dumps({'error': 'site not online', 'reason': st['reason']}).encode('utf-8'), hdr
        code, body, h = _booru_get(site, url)
        try:
            ra = int(h.get('Retry-After') or 0)
        except Exception:
            ra = 0
        if h:
            hdr['X-Upstream-Server'] = str(h.get('Server') or '')
        if ra:
            hdr['Retry-After'] = str(ra)
        if code == 0:
            st['at'] = 0.0                                  # connection failed: check the site again before the next request
            return 502, body, hdr
        if code in (429, 403) or code >= 500:
            st['at'] = 0.0
            if code in (429, 403):
                cool = max(float(ra), 30.0 if code == 429 else 60.0)
        return code, body, hdr
    finally:
        q.release(gap, cool)


def booru_queue_status():
    out = {}
    for site, q in _BOORU_Q.items():
        st = q.state
        out[site] = {'state': st['state'], 'reason': st['reason'], 'ms': st['ms'], 'pending': q.pending(),
                     'checked_ago': round(time.time() - st['at'], 1) if st['at'] else None}
    return out


args = [a for a in sys.argv[1:] if a]
CHROME = any(a.lower() == 'chrome' for a in args)
PAGE = next((a for a in args if a.lower() != 'chrome'), 'index.html')


def _enable_ansi():
    """Windows cmd only shows colors after virtual-terminal mode is turned on."""
    if os.name != 'nt':
        return sys.stdout.isatty()
    try:
        import ctypes
        k = ctypes.windll.kernel32
        h = k.GetStdHandle(-11)                     # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint32()
        if not k.GetConsoleMode(h, ctypes.byref(mode)):
            return False
        return bool(k.SetConsoleMode(h, mode.value | 0x0004))   # ENABLE_VIRTUAL_TERMINAL_PROCESSING
    except Exception:
        return False


COLOR = _enable_ansi()
C_RED, C_YEL, C_DIM, C_CYAN, C_OFF = ('\033[91m', '\033[93m', '\033[90m', '\033[96m', '\033[0m') if COLOR else ('', '', '', '', '')
TAG_COLOR = {'BACKUP': C_CYAN, 'ERROR': C_RED, 'FAILED': C_RED, 'JS-ERR': C_RED, 'BLOCK': C_YEL, 'JS-WRN': C_YEL, 'JS': C_CYAN}
_print_lock = threading.Lock()


def log(tag, msg):
    """Console log line: [HH:MM:SS] [TAG] message. Errors in red, warnings in yellow."""
    c = TAG_COLOR.get(tag, '')
    line = '[{}] [{:<6}] {}'.format(time.strftime('%H:%M:%S'), tag, msg)
    with _print_lock:
        try:
            print(c + line + (C_OFF if c else ''), flush=True)
        except UnicodeEncodeError:                  # old cmd code pages: drop what it cannot show
            print((c + line + (C_OFF if c else '')).encode(sys.stdout.encoding or 'ascii', 'replace').decode(sys.stdout.encoding or 'ascii'), flush=True)


def daily_backup(target):
    """Before the FIRST change of the day, copies the current file to local/backups/YYYY-MM-DD/.
    Keeps only the newest BACKUP_KEEP days. Never blocks the save if it fails."""
    name = os.path.basename(target)
    if name not in BACKUP_FILES or not os.path.isfile(target):
        return
    try:
        day_dir = os.path.join(BACKUP_DIR, time.strftime('%Y-%m-%d'))
        dst = os.path.join(day_dir, name)
        if os.path.exists(dst):
            return
        os.makedirs(day_dir, exist_ok=True)
        shutil.copy2(target, dst)
        log('BACKUP', 'Daily copy: local/backups/{}/{}'.format(os.path.basename(day_dir), name))
        days = sorted(d for d in os.listdir(BACKUP_DIR) if re.match(r'^\d{4}-\d{2}-\d{2}$', d) and os.path.isdir(os.path.join(BACKUP_DIR, d)))
        for old in days[:-BACKUP_KEEP]:
            shutil.rmtree(os.path.join(BACKUP_DIR, old), ignore_errors=True)
            log('BACKUP', 'Removed old copy: local/backups/{}'.format(old))
    except Exception as e:
        log('FAILED', 'Daily backup of {}: {}'.format(name, e))


def human_size(n):
    return '{} B'.format(n) if n < 1024 else '{:.1f} KB'.format(n / 1024) if n < 1024 * 1024 else '{:.2f} MB'.format(n / 1024 / 1024)


# ---------------------------------------------------------------- saving local/*.json
_SAVE_HEAD = re.compile(rb'\{\s*"file"\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*"data"\s*:\s*')


def split_save_body(raw):
    """(relative path, bytes of the JSON to write) from a POST /api/save_local_cache body.

    The pages always send {"file": ..., "data": <json>}. Then the <json> part is written AS IS: the server neither parses
    nor re-encodes tens of MB (that used to hold the whole server for seconds and freeze the other pages). Any other
    shape of body goes the slow way (parse + encode), as before."""
    m = _SAVE_HEAD.match(raw)
    if m:
        body = raw[m.end():].rstrip()
        if body.endswith(b'}'):
            payload = body[:-1].rstrip()
            if payload[:1] in (b'{', b'[') and payload[-1:] in (b'}', b']'):
                return str(json.loads(m.group(1).decode('utf-8'))) or '?', payload
    data = json.loads(raw.decode('utf-8'))
    return str(data.get('file', '')) or '?', json.dumps(data.get('data'), ensure_ascii=False).encode('utf-8')


def write_cache_file(target, rel, payload, existed):
    """tmp file -> daily copy of the old one -> atomic replace. Never raises (logs instead)."""
    tmp = target + '.tmp'
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(tmp, 'wb') as f:
            f.write(payload)
        if existed:
            daily_backup(target)
        os.replace(tmp, target)
        log('OK', '{} {} successfully ({})'.format(rel.replace('\\', '/'), 'modified' if existed else 'created', human_size(len(payload))))
        return True
    except Exception as e:
        log('FAILED', 'Could not save {}: {}'.format(rel.replace('\\', '/'), e))
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        return False


class CacheWriter:
    """Writes the big cache files in a background thread. One pending write per file: a newer save of the same file
    replaces an older one that did not start yet (newest wins, same rule the pages use). A page that asks for a file
    waits for its pending write first (wait()), so it never reads something older than what it just saved."""

    def __init__(self):
        self._cv = threading.Condition()
        self._pending = {}
        self._writing = set()
        self._thread = None

    def submit(self, target, rel, payload, existed):
        with self._cv:
            self._pending[target] = (rel, payload, existed)
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, name='cache-writer', daemon=True)
                self._thread.start()
            self._cv.notify_all()

    def _run(self):
        while True:
            with self._cv:
                while not self._pending:
                    if not self._cv.wait(timeout=5) and not self._pending:
                        self._thread = None          # idle: the thread ends, the next submit() starts a new one
                        return
                target = next(iter(self._pending))
                rel, payload, existed = self._pending.pop(target)
                self._writing.add(target)
            try:
                write_cache_file(target, rel, payload, existed)
            finally:
                with self._cv:
                    self._writing.discard(target)
                    self._cv.notify_all()

    def wait(self, target=None, timeout=30):
        """Blocks until the pending write of `target` (or of everything) is on disk."""
        end = time.time() + timeout
        with self._cv:
            while (target in self._pending or target in self._writing) if target else (self._pending or self._writing):
                left = end - time.time()
                if left <= 0:
                    return False
                self._cv.wait(left)
        return True


WRITER = CacheWriter()
atexit.register(lambda: WRITER.wait(timeout=30))


# ---------------------------------------------------------------- pages that use the shared cache files
_presence_lock = threading.Lock()
_pages = {}            # page id -> time of its last ping
_presence_last = 0.0   # last time a page USED the shared files (a lookup / a save: tools/shared/tagmanager_booru_core.js)
_worker_state = 'idle'   # 'working' while the auto-fill worker holds the files in memory


def presence_touch(page_id=None, closing=False):
    global _presence_last
    now = time.time()
    with _presence_lock:
        if page_id:
            if closing:
                _pages.pop(page_id, None)
            else:
                _pages[page_id] = now
        _presence_last = now


def presence_state():
    """Active while a page pinged recently or the files were touched in the last few seconds (a page that is closing
    still writes its caches): the auto-fill worker stays away from the files then."""
    now = time.time()
    grace = float((CONFIG.get('booru_autofill') or {}).get('idle_grace_seconds', 20))
    with _presence_lock:
        for k, t in list(_pages.items()):
            if now - t > PRESENCE_TTL:
                del _pages[k]
        mt = {}
        for name in WATCHED_FILES:                                # lets a page notice that the worker saved newer data
            try:
                mt['local/' + name] = int(os.path.getmtime(os.path.join(LOCAL_DIR, name)) * 1000)
            except OSError:
                pass
        return {'active': bool(_pages) or (now - _presence_last) < grace, 'pages': len(_pages),
                'idle_for': round(now - _presence_last, 1) if _presence_last else None, 'pid': os.getpid(),
                'worker': (_worker_state if (AUTOFILL.get('proc') is not None and AUTOFILL['proc'].poll() is None) else 'idle'), 'mtimes': mt}


def dir_size(path):
    total = 0
    for base, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    return total


def scan_models():
    """Lists what is inside models/ so the Prompt Helper can find it automatically.

    onnx    -> <org>/<name>/ with config.json + onnx/*.onnx  (WebGPU mode, Transformers.js layout)
    taggers -> models/onnx/**.onnx that have a tag CSV next to them (ONNX tagger mode)
    pytorch -> models--<org>--<name>/snapshots/*             (PyTorch mode, Hugging Face cache layout)
    """
    onnx, torch_models = [], []
    if os.path.isdir(MODELS_DIR):
        for org in sorted(os.listdir(MODELS_DIR)):
            org_path = os.path.join(MODELS_DIR, org)
            if org.startswith('.') or not os.path.isdir(org_path):
                continue
            if org.startswith('models--'):
                parts = org.split('--', 2)
                snaps = os.path.join(org_path, 'snapshots')
                if len(parts) == 3 and os.path.isdir(snaps) and any(os.scandir(snaps)):
                    torch_models.append({'id': parts[1] + '/' + parts[2], 'size': dir_size(org_path)})
                continue
            for name in sorted(os.listdir(org_path)):
                path = os.path.join(org_path, name)
                onnx_dir = os.path.join(path, 'onnx')
                if name.startswith('.') or not os.path.isfile(os.path.join(path, 'config.json')) or not os.path.isdir(onnx_dir):
                    continue
                if any(f.lower().endswith('.onnx') for f in os.listdir(onnx_dir)):
                    onnx.append({'id': org + '/' + name, 'size': dir_size(path)})
    taggers = []
    try:
        import florence_backend  # stdlib-only at import time
        taggers = [t for t in florence_backend.scan_taggers([os.path.join(MODELS_DIR, 'onnx')]) if t.get('inside_root')]
    except Exception as e:
        log('FAILED', 'Could not scan models/onnx: {}'.format(e))
    return {'dir': 'models', 'exists': os.path.isdir(MODELS_DIR), 'onnx': onnx, 'pytorch': torch_models,
            'taggers': taggers}


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'  # closes the connection after each response

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        # credentialless: enables SharedArrayBuffer without blocking Civitai/Danbooru images
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass  # keep the console clean: only file operations are logged

    def _reply(self, code, body=b''):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _host_ok(self):
        """Blocks DNS-rebinding: the Host header must point at this machine."""
        host = (self.headers.get('Host') or '').strip().lower()
        if not host:
            return True
        if host.startswith('['):  # [::1]:8100
            name = host[1:host.find(']')] if ']' in host else host[1:]
        else:
            name = host.rsplit(':', 1)[0] if host.count(':') == 1 else host
        return name in LOCAL_HOSTS

    def _same_origin(self):
        """API calls are only accepted from pages served by this machine.

        Blocks other websites open in the browser from silently calling the local API
        (writing cache files, downloading/deleting models, loading local models).
        """
        if not self._host_ok():
            return False
        site = (self.headers.get('Sec-Fetch-Site') or '').lower()
        if site and site not in ('same-origin', 'none'):
            return False
        origin = self.headers.get('Origin')
        if not origin or origin == 'null':
            # 'null' comes from sandboxed/file:// pages; only trust it when the browser also says same-origin
            return not origin or site in ('same-origin', 'none')
        host = (urlparse(origin).hostname or '').lower()
        return host in LOCAL_HOSTS

    def _forbidden(self, route):
        log('BLOCK', 'Rejected {} {} (origin: {})'.format(self.command, route, self.headers.get('Origin') or '-'))
        return self._reply(403, json.dumps({'status': 'error', 'error': 'Request rejected: only pages served by this machine can use the local API.'}).encode('utf-8'))

    def _florence(self, method):
        """Image -> Prompt API: /api/florence/<route>. Logic lives in florence_backend.py."""
        parsed = urlparse(self.path)
        route = parsed.path[len('/api/florence/'):]
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        try:
            import florence_backend
            body = b''
            if method == 'POST':
                n = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(n) if n else b''
            code, data = florence_backend.handle(method, route, query, body)
            if route in ('load', 'generate', 'unload', 'clear_cache', 'add_folder', 'remove_folder'):
                log('FLOR', '{} -> {}'.format(route, code if code != 200 else 'OK'))
        except Exception as e:
            log('FAILED', 'Florence {}: {}'.format(route, e))
            code, data = 500, {'error': str(e)}
        self._reply(code, json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def _psd(self, method):
        """PSD Import API: /api/psd/<route>. Logic lives in psd_backend.py."""
        parsed = urlparse(self.path)
        route = parsed.path[len('/api/psd/'):]
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        try:
            import psd_backend
            body = b''
            if method == 'POST':
                n = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(n) if n else b''
            code, data = psd_backend.handle(method, route, query, body)
            if route in ('analyze', 'release') or code != 200:
                log('PSD', '{} -> {}'.format(route, code if code != 200 else 'OK'))
        except Exception as e:
            log('FAILED', 'PSD {}: {}'.format(route, e))
            code, data = 500, {'error': str(e)}
        self._reply(code, json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_GET(self):
        route = self.path.split('?')[0]
        if route.startswith('/api/') and not self._same_origin():
            return self._forbidden(route)
        if route.startswith('/api/florence/'):
            return self._florence('GET')
        if route.startswith('/api/psd/'):
            return self._psd('GET')
        if route == '/api/installed_tools':
            names = sorted(f for f in os.listdir(ROOT) if f.lower().endswith('.html'))
            return self._reply(200, json.dumps(names).encode('utf-8'))
        if route == '/api/booru_presence':
            return self._reply(200, json.dumps(presence_state()).encode('utf-8'))
        if route == '/api/server_config':
            body = {'config': CONFIG, 'tools_installed': tools_installed(), 'defaults': {k: v for k, v in DEFAULT_CONFIG.items() if k not in _NOT_EDITABLE}}
            return self._reply(200, json.dumps(body, ensure_ascii=False).encode('utf-8'))
        if route == '/api/booru_fetch':
            q = parse_qs(urlparse(self.path).query)
            if not (CONFIG.get('request_queue') or {}).get('enabled', True):
                return self._reply(404, b'{"status": "error", "message": "request queue is off"}')
            url = (q.get('url') or [''])[0]
            try:
                prio = 0 if (q.get('prio') or ['0'])[0] == '0' else 1
            except Exception:
                prio = 1
            code, body, hdr = booru_proxy(url, prio)
            try:
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                for k, v in hdr.items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionError):
                pass
            return
        if route == '/api/server_status':
            return self._reply(200, json.dumps(server_status(), ensure_ascii=False).encode('utf-8'))
        if route == '/api/models_info':
            return self._reply(200, json.dumps({'dir': 'models', 'exists': os.path.isdir(MODELS_DIR)}).encode('utf-8'))
        if route == '/api/models_list':
            try:
                return self._reply(200, json.dumps(scan_models()).encode('utf-8'))
            except Exception as e:
                log('FAILED', 'Could not scan models/: {}'.format(e))
                return self._reply(500, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        if not self._host_ok():
            return self._forbidden(route)
        if route.startswith('/local/') and route.lower().endswith('.json'):
            target = os.path.abspath(os.path.join(ROOT, unquote(route).lstrip('/')))
            WRITER.wait(target)                                       # never serve a file older than the last save of it
        super().do_GET()

    def _save_model_file(self):
        rel = '?'
        tmp = None
        try:
            query = parse_qs(urlparse(self.path).query)
            rel = (query.get('path') or [''])[0].replace('\\', '/').strip('/')
            if not rel:
                raise ValueError('missing path')
            target = os.path.abspath(os.path.join(MODELS_DIR, rel))
            if os.path.commonpath([target, MODELS_DIR]) != MODELS_DIR:
                raise ValueError('path is outside the models/ folder')
            n = int(self.headers.get('Content-Length', 0))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            tmp = target + '.part'
            with open(tmp, 'wb') as f:
                left = n
                while left > 0:
                    chunk = self.rfile.read(min(1024 * 1024, left))
                    if not chunk:
                        raise IOError('connection closed before the file was complete')
                    f.write(chunk)
                    left -= len(chunk)
            os.replace(tmp, target)
            log('OK', 'models/{} saved ({})'.format(rel, human_size(os.path.getsize(target))))
            self._reply(200, b'{"status": "success"}')
        except Exception as e:
            log('FAILED', 'Could not save models/{}: {}'.format(rel, e))
            if tmp and os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            self._reply(500, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))

    def _delete_model(self):
        """Deletes models/<org>/<name>/ (a Transformers.js / ONNX model downloaded by the WebGPU mode)."""
        mid = '?'
        try:
            n = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(n).decode('utf-8')) if n else {}
            mid = str(data.get('id', ''))
            if not MODEL_ID_RE.match(mid):
                raise ValueError('invalid model id')
            org, name = mid.split('/')
            if org.startswith('.') or name.startswith('.') or org.startswith('models--'):
                raise ValueError('invalid model id')
            target = os.path.abspath(os.path.join(MODELS_DIR, org, name))
            if os.path.dirname(os.path.dirname(target)) != MODELS_DIR:
                raise ValueError('path is outside the models/ folder')
            existed = os.path.isdir(target)
            if existed:
                shutil.rmtree(target)
                try:
                    os.rmdir(os.path.dirname(target))  # drops the org folder only when it is empty
                except OSError:
                    pass
                log('OK', 'models/{} deleted'.format(mid))
            self._reply(200, json.dumps({'status': 'success', 'deleted': existed}).encode('utf-8'))
        except Exception as e:
            log('FAILED', 'Could not delete models/{}: {}'.format(mid, e))
            self._reply(500, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))

    def _folder_dates(self):
        """Gallery Timeline: creation/modification date of folders (metadata only, no file is read).

        The browser cannot see a folder's creation date, so the page sends the real path of the
        directory it opened plus the relative folders it found, and this returns their dates.
        """
        try:
            n = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(n).decode('utf-8')) if n else {}
            root = os.path.abspath(str(data.get('root', '')).strip().strip('"'))
            if not os.path.isdir(root):
                raise ValueError('folder not found on disk: {}'.format(root))
            dates = {}
            for rel in data.get('folders', []):
                rel = str(rel).replace('\\', '/').strip('/')
                target = os.path.abspath(os.path.join(root, *rel.split('/'))) if rel else root
                try:
                    if os.path.commonpath([target, root]) != root:
                        continue
                    st = os.stat(target)
                except (OSError, ValueError):
                    continue
                if not stat.S_ISDIR(st.st_mode):
                    continue
                created = getattr(st, 'st_birthtime', None) or st.st_ctime  # st_ctime = creation time on Windows
                dates[rel] = {'created': int(created * 1000), 'modified': int(st.st_mtime * 1000)}
            log('OK', 'Folder dates read: {} folder(s) of {}'.format(len(dates), root))
            self._reply(200, json.dumps({'status': 'success', 'dates': dates}).encode('utf-8'))
        except Exception as e:
            log('FAILED', 'Could not read folder dates: {}'.format(e))
            self._reply(500, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))

    def _read_json(self):
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n).decode('utf-8')) if n else {}

    def _trash_file(self):
        """Gallery Timeline: moves an image (and its .json sidecar) to the Recycle Bin."""
        try:
            _, target = _resolve_in_root(self._read_json(), True)
            moved = []
            base = os.path.splitext(target)[0]
            for path in (target, base + '.json'):
                if os.path.isfile(path):
                    _trash_path(path)
                    moved.append(os.path.basename(path))
            log('OK', 'Moved to the Recycle Bin: {}'.format(', '.join(moved)))
            self._reply(200, json.dumps({'status': 'success', 'moved': moved}).encode('utf-8'))
        except Exception as e:
            log('FAILED', 'Could not move to the Recycle Bin: {}'.format(e))
            self._reply(500, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))

    def _open_folder(self):
        """Gallery Timeline: opens the file manager on the image's folder (selecting the image when possible)."""
        try:
            data = self._read_json()
            _, target = _resolve_in_root(data, False)
            if os.path.isfile(target):
                folder, select = os.path.dirname(target), target
            else:
                folder, select = target, None
            if not os.path.isdir(folder):
                raise ValueError('folder not found on disk: {}'.format(folder))
            if os.name == 'nt':
                subprocess.Popen('explorer /select,"{}"'.format(select) if select else 'explorer "{}"'.format(folder))
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', '-R', select] if select else ['open', folder])
            else:
                subprocess.Popen(['xdg-open', folder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            log('OK', 'Opened folder: {}'.format(folder))
            self._reply(200, b'{"status": "success"}')
        except Exception as e:
            log('FAILED', 'Could not open the folder: {}'.format(e))
            self._reply(500, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))

    def _copy_file(self):
        """Gallery Timeline: puts the image FILE on the system clipboard (like Ctrl+C in the file manager),
        so pasting it in ComfyUI / Explorer / Discord brings the original file, metadata included."""
        try:
            _, target = _resolve_in_root(self._read_json(), True)
            if os.name == 'nt':
                ps = "Set-Clipboard -LiteralPath '{}'".format(target.replace("'", "''"))
                r = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-STA', '-Command', ps],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20,
                                   creationflags=0x08000000)  # CREATE_NO_WINDOW
                if r.returncode != 0:
                    raise RuntimeError((r.stderr or b'').decode('utf-8', 'replace').strip() or 'Set-Clipboard failed')
            elif sys.platform == 'darwin':
                r = subprocess.run(['osascript', '-e', 'set the clipboard to (POSIX file "{}")'.format(target.replace('\\', '\\\\').replace('"', '\\"'))],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=20)
                if r.returncode != 0:
                    raise RuntimeError((r.stderr or b'').decode('utf-8', 'replace').strip() or 'osascript failed')
            else:
                raise ValueError('copying a file to the clipboard is only supported on Windows and macOS')
            log('OK', 'Copied to the clipboard: {}'.format(target))
            self._reply(200, b'{"status": "success"}')
        except Exception as e:
            log('FAILED', 'Could not copy the file to the clipboard: {}'.format(e))
            self._reply(500, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))

    def _locate_folder(self):
        """Tag Manager 📂 Go to: finds the real path of a folder the browser opened.

        The page writes a temporary marker file into the folder (through the browser) and sends its
        name; this returns the folder that contains it. `candidates` (paths typed by the user) are
        checked first; otherwise folders with the same name are searched on the drives (limited time).
        """
        try:
            data = self._read_json()
            name = str(data.get('name', '')).strip()
            marker = str(data.get('marker', '')).strip()
            if not marker.startswith('_tm_locate_') or '/' in marker or '\\' in marker:
                raise ValueError('invalid marker')
            for c in data.get('candidates') or []:
                c = os.path.abspath(str(c).strip().strip('"'))
                if os.path.isfile(os.path.join(c, marker)):
                    log('OK', 'Folder located: {}'.format(c))
                    return self._reply(200, json.dumps({'status': 'success', 'path': c}).encode('utf-8'))
            if data.get('candidates'):
                return self._reply(200, json.dumps({'status': 'error', 'message': 'not found'}).encode('utf-8'))
            found = _find_marked_folder(name, marker)
            if found:
                log('OK', 'Folder located: {}'.format(found))
                return self._reply(200, json.dumps({'status': 'success', 'path': found}).encode('utf-8'))
            self._reply(200, json.dumps({'status': 'error', 'message': 'not found'}).encode('utf-8'))
        except Exception as e:
            log('FAILED', 'Could not locate the folder: {}'.format(e))
            self._reply(500, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))

    def _presence_post(self):
        """Pages that use the Danbooru / e621 files tell they are open (tools/shared/tagmanager_booru_core.js)."""
        try:
            n = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(min(n, 4096)).decode('utf-8')) if n else {}
            global _worker_state
            if data.get('worker') in ('working', 'idle'):          # the auto-fill worker tells whether it holds the files
                _worker_state = data['worker']
            else:                                                  # a page: 'use' = it is looking tags up / saving them right now
                presence_touch()                                   # only "used a moment ago" counts: an open page that does not touch tags does not block the worker
            self._reply(200, b'{"status": "success"}')
        except Exception:
            self._reply(400, b'{"status": "error"}')

    def _client_log(self):
        """Errors of the open pages (tools/tagmanager/client_error_log.js) printed in the cmd."""
        try:
            n = int(self.headers.get('Content-Length', 0))
            if n > 512 * 1024:
                return self._reply(413, b'{"status": "error"}')
            data = json.loads(self.rfile.read(n).decode('utf-8')) if n else {}
            for it in (data.get('items') or [])[:100]:
                level = str(it.get('level') or 'error')
                msg = str(it.get('message') or '').strip()
                page = str(it.get('page') or '')
                tag = {'error': 'JS-ERR', 'warn': 'JS-WRN'}.get(level, 'JS')
                where = ''
                if it.get('source'):
                    where = ' ({}{})'.format(it['source'], ':{}:{}'.format(it.get('line'), it.get('col')) if it.get('line') else '')
                count = ' (x{})'.format(it['count']) if it.get('count') else ''
                first, *rest = (msg.splitlines() or [''])
                log(tag, '{} | {}{}{}'.format(page, first[:600], where, count))
                extra = rest[:12]
                stack = [l for l in str(it.get('stack') or '').splitlines() if l.strip() and l.strip() not in [r.strip() for r in rest]]
                if level != 'info':
                    for l in (extra + stack[:8]):
                        with _print_lock:
                            print('{}           {}{}'.format(C_DIM, l.strip()[:300], C_OFF), flush=True)
            self._reply(200, b'{"status": "success"}')
        except Exception as e:
            log('FAILED', 'Bad client log: {}'.format(e))
            self._reply(400, b'{"status": "error"}')

    def do_POST(self):
        route = self.path.split('?')[0]
        if not self._same_origin():
            return self._forbidden(route)
        if route == '/api/client_log':
            return self._client_log()
        if route.startswith('/api/florence/'):
            return self._florence('POST')
        if route.startswith('/api/psd/'):
            return self._psd('POST')
        if route == '/api/save_model_file':
            return self._save_model_file()
        if route == '/api/delete_model':
            return self._delete_model()
        if route == '/api/folder_dates':
            return self._folder_dates()
        if route == '/api/trash_file':
            return self._trash_file()
        if route == '/api/open_folder':
            return self._open_folder()
        if route == '/api/copy_file':
            return self._copy_file()
        if route == '/api/locate_folder':
            return self._locate_folder()
        if route == '/api/booru_presence':
            return self._presence_post()
        if route == '/api/autofill_control':
            try:
                n = int(self.headers.get('Content-Length', 0))
                data = json.loads(self.rfile.read(min(n, 4096)).decode('utf-8')) if n else {}
                p = AUTOFILL.get('proc')
                if data.get('action') != 'check_now':
                    return self._reply(400, b'{"status": "error", "message": "unknown action"}')
                if not (p and p.poll() is None):
                    return self._reply(409, json.dumps({'status': 'error', 'message': 'The auto-fill worker is not running (turn it on first).'}).encode('utf-8'))
                open(WAKE_FILE, 'w').close()
                log('INFO', 'Auto-fill: check requested from the index')
                return self._reply(200, b'{"status": "success"}')
            except Exception as e:
                return self._reply(400, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        if route == '/api/server_config':
            try:
                n = int(self.headers.get('Content-Length', 0))
                data = json.loads(self.rfile.read(min(n, 65536)).decode('utf-8')) if n else {}
                cfg = save_config_changes(data if isinstance(data, dict) else {})
                return self._reply(200, json.dumps({'status': 'success', 'config': cfg}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                log('FAILED', 'Could not save the settings: {}'.format(e))
                return self._reply(400, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))
        if route != '/api/save_local_cache':
            log('FAILED', 'Unknown POST endpoint: {}'.format(self.path))
            return self._reply(404, b'{"status": "error", "message": "unknown endpoint"}')

        rel = '?'
        try:
            n = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(n) if n else b''
            if len(raw) != n:
                raise IOError('connection closed before the file was complete')   # never write a cut-off body
            rel, payload = split_save_body(raw)
            del raw
            target = os.path.abspath(os.path.join(ROOT, rel))
            if os.path.commonpath([target, LOCAL_DIR]) != LOCAL_DIR:
                raise ValueError('path is outside the local/ folder')
            if not target.lower().endswith('.json'):
                raise ValueError('only .json files can be saved to local/')
            if os.path.basename(target) in WATCHED_FILES:
                presence_touch()                                  # a page is writing the shared files: the auto-fill worker stays away
            existed = os.path.exists(target)
            bg = CONFIG.get('cache_saves') or {}
            if bg.get('background', True) and len(payload) >= int(bg.get('background_min_kb', 256)) * 1024:
                WRITER.submit(target, rel, payload, existed)      # big file: answer now, write in the background
                return self._reply(200, b'{"status": "success"}')
            if not write_cache_file(target, rel, payload, existed):
                raise IOError('could not write the file (see the message above)')
            self._reply(200, b'{"status": "success"}')
        except Exception as e:
            log('FAILED', 'Could not save {}: {}'.format(rel.replace('\\', '/'), e))
            self._reply(500, json.dumps({'status': 'error', 'message': str(e)}).encode('utf-8'))


def _trash_path(path):
    """Moves a file to the system Recycle Bin / Trash (never a permanent delete)."""
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes

        class SHFILEOPSTRUCTW(ctypes.Structure):
            _pack_ = 8 if ctypes.sizeof(ctypes.c_void_p) == 8 else 1
            _fields_ = [('hwnd', wintypes.HWND), ('wFunc', wintypes.UINT), ('pFrom', wintypes.LPCWSTR),
                        ('pTo', wintypes.LPCWSTR), ('fFlags', ctypes.c_ushort), ('fAnyOperationsAborted', wintypes.BOOL),
                        ('hNameMappings', ctypes.c_void_p), ('lpszProgressTitle', wintypes.LPCWSTR)]
        op = SHFILEOPSTRUCTW()
        op.wFunc = 3                                    # FO_DELETE
        op.pFrom = path + '\0'                          # the API wants a double-null terminated list
        op.fFlags = 0x0040 | 0x0010 | 0x0004 | 0x0400   # ALLOWUNDO | NOCONFIRMATION | SILENT | NOERRORUI
        rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
        if rc or op.fAnyOperationsAborted:
            raise OSError('Windows could not move the file to the Recycle Bin (code {})'.format(rc))
        return
    if sys.platform == 'darwin':
        r = subprocess.run(['osascript', '-e', 'tell application "Finder" to delete POSIX file "{}"'.format(path.replace('"', '\\"'))],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if r.returncode:
            raise OSError('Finder could not move the file to the Trash')
        return
    for cmd in (['gio', 'trash', path], ['trash-put', path]):
        try:
            if subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                return
        except OSError:
            pass
    base = os.path.join(os.environ.get('XDG_DATA_HOME') or os.path.expanduser('~/.local/share'), 'Trash')   # freedesktop fallback
    os.makedirs(os.path.join(base, 'files'), exist_ok=True)
    os.makedirs(os.path.join(base, 'info'), exist_ok=True)
    name, n = os.path.basename(path), 0
    while os.path.exists(os.path.join(base, 'files', name)):
        n += 1
        name = '{}.{}'.format(os.path.basename(path), n)
    with open(os.path.join(base, 'info', name + '.trashinfo'), 'w', encoding='utf-8') as f:
        f.write('[Trash Info]\nPath={}\nDeletionDate={}\n'.format(quote(path), time.strftime('%Y-%m-%dT%H:%M:%S')))
    shutil.move(path, os.path.join(base, 'files', name))


_LOCATE_SKIP = {'windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin', 'system volume information',
                'appdata', 'node_modules', '.git', '__pycache__', 'proc', 'sys', 'dev', 'usr', 'lib', 'bin', 'sbin', 'boot', 'snap'}


def _find_marked_folder(name, marker, max_depth=6, time_limit=10.0):
    """Breadth-first search for a folder called `name` that contains `marker`. Starts near this server
    (its folder and parents), then every drive / the home folder. Gives up after `time_limit` seconds."""
    t0 = time.time()
    starts = []
    p = ROOT
    while True:
        starts.append(p)
        parent = os.path.dirname(p)
        if parent == p:
            break
        p = parent
    if os.name == 'nt':
        import string
        starts += ['{}:\\'.format(d) for d in string.ascii_uppercase if os.path.isdir('{}:\\'.format(d))]
    else:
        starts += [os.path.expanduser('~'), '/mnt', '/media', '/Volumes', '/']
    seen = set()
    want = name.lower()
    for start in starts:
        queue = [(start, 0)]
        while queue:
            if time.time() - t0 > time_limit:
                return None
            folder, depth = queue.pop(0)
            key = os.path.normcase(os.path.abspath(folder))
            if key in seen:
                continue
            seen.add(key)
            if len(seen) % 100 == 0:
                time.sleep(0.005)                      # a long disk search must not starve the other requests
            if os.path.basename(folder.rstrip('\\/')).lower() == want and os.path.isfile(os.path.join(folder, marker)):
                return os.path.abspath(folder)
            if depth >= max_depth:
                continue
            try:
                with os.scandir(folder) as it:
                    for e in it:
                        try:
                            if e.is_dir(follow_symlinks=False) and not e.name.startswith(('.', '$')) and e.name.lower() not in _LOCATE_SKIP:
                                queue.append((e.path, depth + 1))
                        except OSError:
                            continue
            except OSError:
                continue
    return None


def _resolve_in_root(data, need_file):
    """root + folder (relative) + name -> absolute path, which must stay inside root."""
    root = os.path.abspath(str(data.get('root', '')).strip().strip('"'))
    if not os.path.isdir(root):
        raise ValueError('folder not found on disk: {}'.format(root))
    folder = str(data.get('folder', '')).replace('\\', '/').strip('/')
    name = str(data.get('name', ''))
    if '/' in name or '\\' in name:
        raise ValueError('invalid file name')
    target = os.path.abspath(os.path.join(root, *([p for p in folder.split('/') if p] + ([name] if name else []))))
    if os.path.commonpath([target, root]) != root:
        raise ValueError('path is outside the opened folder')
    if need_file and not os.path.isfile(target):
        raise ValueError('file not found on disk: {}'.format(target))
    return root, target


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False  # on Windows, True allows two servers on the same port


def open_browser():
    if os.environ.get('MODULAR_NO_BROWSER'):   # set when florence_backend restarts the server after a pip update
        return
    url = 'http://localhost:{}/{}'.format(PORT, quote(PAGE))
    if CHROME and os.name == 'nt':
        try:
            subprocess.Popen(['cmd', '/c', 'start', '', 'chrome', url])
            return
        except Exception:
            pass
    webbrowser.open(url)


def _run(cmd):
    """Runs a command and returns its text output ('' on any failure)."""
    try:
        out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15).stdout
        return out.decode('utf-8', 'replace')
    except Exception:
        return ''


def find_port_owner(port):
    """Returns [(pid, process_name)] of the processes LISTENING on the port (best effort)."""
    pids = []
    if os.name == 'nt':
        # Do not rely on the word LISTENING: it is translated on non-English Windows.
        for line in _run(['netstat', '-ano', '-p', 'TCP']).splitlines():
            cols = line.split()
            if len(cols) >= 5 and cols[0].upper() == 'TCP' and cols[1].endswith(':{}'.format(port)) and cols[2].endswith(':0') and cols[-1].isdigit():
                if int(cols[-1]) not in pids:
                    pids.append(int(cols[-1]))
    else:
        for tok in _run(['lsof', '-t', '-iTCP:{}'.format(port), '-sTCP:LISTEN']).split():
            if tok.isdigit() and int(tok) not in pids:
                pids.append(int(tok))
        if not pids:
            for m in re.finditer(r'pid=(\d+)', ''.join(l for l in _run(['ss', '-ltnp']).splitlines() if ':{} '.format(port) in l)):
                if int(m.group(1)) not in pids:
                    pids.append(int(m.group(1)))
    out = []
    for pid in pids:
        name = '?'
        if os.name == 'nt':
            row = _run(['tasklist', '/FI', 'PID eq {}'.format(pid), '/FO', 'CSV', '/NH']).strip().splitlines()
            if row and row[0].startswith('"'):
                name = row[0].split('","')[0].strip('"')
        else:
            name = _run(['ps', '-p', str(pid), '-o', 'comm=']).strip() or '?'
        out.append((pid, name))
    return out


def kill_pid(pid):
    if os.name == 'nt':
        _run(['taskkill', '/PID', str(pid), '/F', '/T'])
    else:
        try:
            os.kill(pid, 15)
            time.sleep(1)
            os.kill(pid, 9)
        except OSError:
            pass


def ask(prompt):
    try:
        return input(prompt).strip().lower()
    except (EOFError, KeyboardInterrupt):
        return 'n'


def bind_server():
    """Starts the server; if the port is busy, asks what to do instead of just failing."""
    global PORT
    while True:
        try:
            return Server(('127.0.0.1', PORT), Handler)
        except OSError:
            pass
        owners = find_port_owner(PORT)
        log('WARN', 'Port {} is already in use.'.format(PORT))
        for pid, name in owners:
            log('WARN', 'Used by: {} (PID {})'.format(name, pid))
        if not owners:
            log('WARN', 'Could not find which program is using it.')
        if not sys.stdin or not sys.stdin.isatty():              # nobody to ask: previous behavior
            log('INFO', 'Opening the server that is already running.')
            open_browser()
            time.sleep(2)
            sys.exit(0)
        print()
        print('  [Y] Close the previous one and start a new server here (default)')
        print('  [O] Keep the previous one and just open it in the browser')
        print('  [P] Start this one on another free port')
        print('  [Q] Quit')
        choice = ask('Choose [Y/O/P/Q]: ') or 'y'
        if choice.startswith('o'):
            open_browser()
            time.sleep(2)
            sys.exit(0)
        if choice.startswith('q'):
            sys.exit(0)
        if choice.startswith('p'):
            PORT += 1
            log('INFO', 'Trying port {}...'.format(PORT))
            continue
        if not owners:
            log('ERROR', 'Nothing to close automatically. Close the old console window / python process (Task Manager) or choose P.')
            continue
        for pid, name in owners:
            if pid == os.getpid():
                continue
            log('INFO', 'Closing {} (PID {})...'.format(name, pid))
            kill_pid(pid)
        for _ in range(20):                                       # give the OS a moment to free the port
            time.sleep(0.5)
            try:
                srv = Server(('127.0.0.1', PORT), Handler)
                log('INFO', 'Previous server closed.')
                return srv
            except OSError:
                pass
        log('ERROR', 'The port is still busy (the process may need administrator rights to close). Run this as administrator, or choose P.')


WARMUP = {'state': 'off', 'detail': {}}
AUTOFILL = {'proc': None}


def _warmup():
    """Imports and checks the heavy Python packages in the background, so the first call from a page is instant."""
    cfg = CONFIG.get('warmup') or {}
    if not (cfg.get('pytorch') or cfg.get('onnxruntime') or cfg.get('pip_check')):
        return
    WARMUP['state'] = 'running'
    t0 = time.time()
    try:
        import florence_backend as fb
    except Exception as e:
        WARMUP.update(state='failed', error=str(e))
        log('FAILED', 'Warm-up: florence_backend could not be imported: {}'.format(e))
        return
    if cfg.get('pytorch', True):
        try:
            st = fb.status()                       # imports torch + transformers and probes CUDA (later calls are instant)
            WARMUP['detail']['pytorch'] = {k: st.get(k) for k in ('available', 'torch', 'transformers', 'cuda', 'gpu', 'deps_error')}
            if st.get('available'):
                log('INFO', 'PyTorch ready: torch {} / transformers {} / {}'.format(
                    st.get('torch'), st.get('transformers'), ('GPU: ' + str(st.get('gpu'))) if st.get('cuda') else 'no CUDA GPU (CPU mode)'))
            else:
                log('WARN', 'PyTorch is not usable: {}'.format(st.get('deps_error')))
        except Exception as e:
            WARMUP['detail']['pytorch'] = {'error': str(e)}
            log('WARN', 'PyTorch check failed: {}'.format(e))
    if cfg.get('onnxruntime', True):
        try:
            ort = fb._ort()
            WARMUP['detail']['onnxruntime'] = {'version': ort.__version__, 'providers': list(ort.get_available_providers())}
            log('INFO', 'onnxruntime ready: {} ({})'.format(ort.__version__, ', '.join(ort.get_available_providers())))
        except Exception as e:
            WARMUP['detail']['onnxruntime'] = {'error': str(e)}
    if cfg.get('pip_check', True):
        try:
            orig, box = fb.deps_check, {'t': 0.0, 'v': None, 'lock': threading.Lock()}

            def cached():                          # the PyPI check is asked once and kept for 5 minutes
                with box['lock']:
                    if box['v'] is None or time.time() - box['t'] > 300:
                        box['v'] = orig()
                        box['t'] = time.time()
                    return box['v']
            fb.deps_check = cached
            r = cached()
            WARMUP['detail']['pip'] = {'needs_update': r.get('needs_update')}
            if r.get('needs_update'):
                log('INFO', 'Packages with an update or missing: {}'.format(', '.join(r['needs_update'])))
        except Exception as e:
            WARMUP['detail']['pip'] = {'error': str(e)}
    WARMUP['state'] = 'done'
    WARMUP['seconds'] = round(time.time() - t0, 1)


def start_autofill():
    cfg = CONFIG.get('booru_autofill') or {}
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'booru_autofill.py')
    if not cfg.get('enabled', False) or not os.path.isfile(script) or not tools_installed():
        return
    try:
        if os.path.exists(STOP_FILE):
            os.remove(STOP_FILE)
        AUTOFILL['proc'] = subprocess.Popen([sys.executable, '-u', script, '--root', ROOT, '--port', str(PORT), '--server-pid', str(os.getpid())], cwd=ROOT)
        log('INFO', 'Danbooru / e621 auto-fill started in the background (PID {}). Settings: local/server_config.json'.format(AUTOFILL['proc'].pid))
    except Exception as e:
        log('FAILED', 'Could not start the auto-fill worker: {}'.format(e))


def stop_autofill():
    p = AUTOFILL.get('proc')
    if not p or p.poll() is not None:
        return
    try:
        open(STOP_FILE, 'w').close()               # the worker saves what it has and exits
        p.wait(timeout=30)
    except Exception:
        try:
            p.terminate()
        except Exception:
            pass
    try:
        os.remove(STOP_FILE)
    except OSError:
        pass


def server_status():
    state = {}
    try:
        with open(os.path.join(LOCAL_DIR, 'autofill_state.json'), 'r', encoding='utf-8') as f:
            state = json.load(f)
    except Exception:
        pass
    sched = {}
    try:
        with open(os.path.join(LOCAL_DIR, 'autofill_status.json'), 'r', encoding='utf-8') as f:
            sched = json.load(f)
    except Exception:
        pass
    p = AUTOFILL.get('proc')
    return {'pid': os.getpid(), 'warmup': WARMUP, 'presence': presence_state(),
            'autofill': {'running': bool(p and p.poll() is None), 'state': state, 'schedule': sched}, 'queue': booru_queue_status(), 'tools_installed': tools_installed(),
            'config': {k: v for k, v in CONFIG.items() if not k.startswith('_')}}


httpd = bind_server()

log('INFO', 'Server running at http://localhost:{}  (press Ctrl+C to stop)'.format(PORT))
log('INFO', 'Serving folder: {}'.format(ROOT))
log('INFO', 'Cache files are saved to: {}'.format(LOCAL_DIR))
threading.Thread(target=_warmup, name='warmup', daemon=True).start()
start_autofill()
atexit.register(stop_autofill)
threading.Timer(0.5, open_browser).start()
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    log('INFO', 'Stopping (saving pending files)...')
    stop_autofill()
    WRITER.wait(timeout=30)
    log('INFO', 'Server stopped.')
