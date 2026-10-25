"""Modular AI Tools - local server (port 8100).
Usage: python server_max.py [chrome] [page.html]  (default: index.html)
"""
import http.server, json, os, subprocess, sys, threading, time, webbrowser
from urllib.parse import quote

PORT = 8100
ROOT = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIR = os.path.join(ROOT, 'local')
os.chdir(ROOT)

args = [a for a in sys.argv[1:] if a]
CHROME = any(a.lower() == 'chrome' for a in args)
PAGE = next((a for a in args if a.lower() != 'chrome'), 'index.html')


def log(tag, msg):
    """Console log line: [HH:MM:SS] [TAG] message (ASCII only, safe for any cmd)."""
    print('[{}] [{:<6}] {}'.format(time.strftime('%H:%M:%S'), tag, msg), flush=True)


def human_size(n):
    return '{} B'.format(n) if n < 1024 else '{:.1f} KB'.format(n / 1024) if n < 1024 * 1024 else '{:.2f} MB'.format(n / 1024 / 1024)


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

    def do_GET(self):
        if self.path.split('?')[0] == '/api/installed_tools':
            names = sorted(f for f in os.listdir(ROOT) if f.lower().endswith('.html'))
            return self._reply(200, json.dumps(names).encode('utf-8'))
        super().do_GET()

    def do_POST(self):
        if self.path != '/api/save_local_cache':
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