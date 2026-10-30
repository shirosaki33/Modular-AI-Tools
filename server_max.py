"""Modular AI Tools - local server (port 8100).
Usage: python server_max.py [chrome] [page.html]  (default: index.html)
"""
import http.server, json, os, re, shutil, subprocess, sys, threading, time, webbrowser
from urllib.parse import quote, urlparse, parse_qs

PORT = 8100
ROOT = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIR = os.path.join(ROOT, 'local')
MODELS_DIR = os.path.join(ROOT, 'models')  # model files (Prompt Helper / Florence-2)
MODEL_ID_RE = re.compile(r'^[\w.\-]+/[\w.\-]+$')  # "org/name"
LOCAL_HOSTS = ('localhost', '127.0.0.1', '::1')
os.chdir(ROOT)

args = [a for a in sys.argv[1:] if a]
CHROME = any(a.lower() == 'chrome' for a in args)
PAGE = next((a for a in args if a.lower() != 'chrome'), 'index.html')


def log(tag, msg):
    """Console log line: [HH:MM:SS] [TAG] message (ASCII only, safe for any cmd)."""
    print('[{}] [{:<6}] {}'.format(time.strftime('%H:%M:%S'), tag, msg), flush=True)


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

    def do_POST(self):
        route = self.path.split('?')[0]
        if not self._same_origin():
            return self._forbidden(route)
        if route.startswith('/api/florence/'):
            return self._florence('POST')
        if route == '/api/save_model_file':
            return self._save_model_file()
        if route == '/api/delete_model':
            return self._delete_model()
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


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False  # on Windows, True allows two servers on the same port


def open_browser():
    url = 'http://localhost:{}/{}'.format(PORT, quote(PAGE))
    if CHROME and os.name == 'nt':
        try:
            subprocess.Popen(['cmd', '/c', 'start', '', 'chrome', url])
            return
        except Exception:
            pass
    webbrowser.open(url)


try:
    httpd = Server(('127.0.0.1', PORT), Handler)
except OSError:
    log('INFO', 'Port {} is already in use - a server is already running. Opening it in the browser.'.format(PORT))
    open_browser()
    time.sleep(2)
    sys.exit(0)

log('INFO', 'Server running at http://localhost:{}  (press Ctrl+C to stop)'.format(PORT))
log('INFO', 'Serving folder: {}'.format(ROOT))
log('INFO', 'Cache files are saved to: {}'.format(LOCAL_DIR))
threading.Timer(0.5, open_browser).start()
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    log('INFO', 'Server stopped.')
