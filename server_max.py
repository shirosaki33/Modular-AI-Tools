"""Modular AI Tools - local server (port 8100).
Usage: python server_max.py [chrome] [page.html]  (default: index.html)
"""
import http.server, json, os, re, shutil, stat, subprocess, sys, threading, time, webbrowser
from urllib.parse import quote, urlparse, parse_qs

PORT = 8100
ROOT = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIR = os.path.join(ROOT, 'local')
BACKUP_DIR = os.path.join(LOCAL_DIR, 'backups')   # automatic daily copies (see daily_backup)
BACKUP_FILES = ('user_config.json', 'user_presets.json', 'evaluator_results.json', 'nl_known_texts.json', 'danbooru_cache.json', 'e621_cache.json')
BACKUP_KEEP = 4                                    # 4 copies + the file in use = 5 versions
MODELS_DIR = os.path.join(ROOT, 'models')  # model files (Prompt Helper / Florence-2)
MODEL_ID_RE = re.compile(r'^[\w.\-]+/[\w.\-]+$')  # "org/name"
LOCAL_HOSTS = ('localhost', '127.0.0.1', '::1')
os.chdir(ROOT)

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

    def do_GET(self):
        route = self.path.split('?')[0]
        if route.startswith('/api/') and not self._same_origin():
            return self._forbidden(route)
        if route.startswith('/api/florence/'):
            return self._florence('GET')
        if route == '/api/installed_tools':
            names = sorted(f for f in os.listdir(ROOT) if f.lower().endswith('.html'))
            return self._reply(200, json.dumps(names).encode('utf-8'))
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

    def _client_log(self):
        """Errors of the open pages (tools/client_error_log.js) printed in the cmd."""
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
        if route != '/api/save_local_cache':
            log('FAILED', 'Unknown POST endpoint: {}'.format(self.path))
            return self._reply(404, b'{"status": "error", "message": "unknown endpoint"}')

        rel = '?'
        tmp = None
        try:
            n = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(n).decode('utf-8'))
            rel = str(data.get('file', '')) or '?'
            target = os.path.abspath(os.path.join(ROOT, rel))
            if os.path.commonpath([target, LOCAL_DIR]) != LOCAL_DIR:
                raise ValueError('path is outside the local/ folder')
            if not target.lower().endswith('.json'):
                raise ValueError('only .json files can be saved to local/')
            existed = os.path.exists(target)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            tmp = target + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data.get('data'), f, ensure_ascii=False)
            if existed:
                daily_backup(target)
            os.replace(tmp, target)
            log('OK', '{} {} successfully ({})'.format(
                rel.replace('\\', '/'), 'modified' if existed else 'created', human_size(os.path.getsize(target))))
            self._reply(200, b'{"status": "success"}')
        except Exception as e:
            log('FAILED', 'Could not save {}: {}'.format(rel.replace('\\', '/'), e))
            if tmp and os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
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


httpd = bind_server()

log('INFO', 'Server running at http://localhost:{}  (press Ctrl+C to stop)'.format(PORT))
log('INFO', 'Serving folder: {}'.format(ROOT))
log('INFO', 'Cache files are saved to: {}'.format(LOCAL_DIR))
threading.Timer(0.5, open_browser).start()
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    log('INFO', 'Server stopped.')
