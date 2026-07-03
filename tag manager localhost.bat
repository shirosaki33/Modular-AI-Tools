@echo off
title Modular Tools - Servidor de IA Local
color 0A

echo ========================================================
echo   🚀 starting modular ai tool server
echo ========================================================
echo.

>server_max.py echo import http.server
>>server_max.py echo import socketserver
>>server_max.py echo class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
>>server_max.py echo     def end_headers(self):
>>server_max.py echo         self.send_header("Cross-Origin-Opener-Policy", "same-origin")
>>server_max.py echo         self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
>>server_max.py echo         super().end_headers()
>>server_max.py echo socketserver.TCPServer.allow_reuse_address = True
>>server_max.py echo with socketserver.TCPServer(("", 8100), MyHTTPRequestHandler) as httpd:
>>server_max.py echo     httpd.serve_forever()

start "" "http://localhost:8100/tag manager.html"

python server_max.py