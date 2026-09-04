@echo off
title Modular Tools - Servidor de IA Local
color 0A

echo ========================================================
echo   🚀 starting modular ai tool server
echo ========================================================
echo.

>server_max.py echo import http.server
>>server_max.py echo import socketserver
>>server_max.py echo import json
>>server_max.py echo import os
>>server_max.py echo.
>>server_max.py echo class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
>>server_max.py echo     def end_headers(self):
>>server_max.py echo         self.send_header("Cross-Origin-Opener-Policy", "same-origin")
>>server_max.py echo         self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
>>server_max.py echo         super().end_headers()
>>server_max.py echo.
>>server_max.py echo     def do_POST(self):
>>server_max.py echo         if self.path == '/api/save_local_cache':
>>server_max.py echo             content_length = int(self.headers.get('Content-Length', 0))
>>server_max.py echo             post_data = self.rfile.read(content_length)
>>server_max.py echo             try:
>>server_max.py echo                 data = json.loads(post_data.decode('utf-8'))
>>server_max.py echo                 file_path = data.get('file')
>>server_max.py echo                 content = data.get('data')
>>server_max.py echo                 os.makedirs(os.path.dirname(file_path), exist_ok=True)
>>server_max.py echo                 with open(file_path, 'w', encoding='utf-8') as f:
>>server_max.py echo                     json.dump(content, f, ensure_ascii=False)
>>server_max.py echo                 self.send_response(200)
>>server_max.py echo                 self.send_header('Content-type', 'application/json')
>>server_max.py echo                 self.end_headers()
>>server_max.py echo                 self.wfile.write(b'{"status": "success"}')
>>server_max.py echo             except Exception as e:
>>server_max.py echo                 self.send_response(500)
>>server_max.py echo                 self.end_headers()
>>server_max.py echo                 print(f"Erro ao salvar: {e}")
>>server_max.py echo         else:
>>server_max.py echo             self.send_response(404)
>>server_max.py echo             self.end_headers()
>>server_max.py echo.
>>server_max.py echo socketserver.TCPServer.allow_reuse_address = True
>>server_max.py echo with socketserver.TCPServer(("", 8100), MyHTTPRequestHandler) as httpd:
>>server_max.py echo     httpd.serve_forever()

start "" "http://localhost:8100/tag manager.html"

python server_max.py