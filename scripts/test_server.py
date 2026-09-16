#!/usr/bin/env python3
# ===== QTRIG — STATICKY SERVER PRO SMOKE TESTY ==============================
# PROC vlastni skript misto `python3 -m http.server`:
#
#   `python3 -m http.server` jede v rezimu HTTP/1.0, kde se spojeni ZAVIRA po
#   kazde odpovedi. Appka si pri startu tahne ~145 assetu (120 <script> tagu
#   + 24 CSS + ikony), takze prohlizec musel otevrit 145 samostatnych TCP
#   spojeni. Na vytizenem CI runneru se cast z nich resetne (ERR_CONNECTION_RESET)
#   a prohlizec proste NENACTE nahodny skript. Kdyz vypadne treba js/logika.js
#   nebo proj4, appka spadne na necem jako:
#       ReferenceError: filters is not defined
#       TypeError: map.on is not a function      (map = <div id="map">, ne Leaflet)
#   Vypadalo to jako chyba appky, ale je to chyba TESTOVACIHO SERVERU. Smoke test
#   proto neprosel ani jednou od zavedeni.
#
#   Tenhle server drzi HTTP/1.1 s keep-alive (jedno spojeni obslouzi mnoho
#   souboru) a je vicevlaknovy. Overeno: s nim appka nastartuje s 0 chybami
#   v konzoli, bez nej pada nahodne.
#
# Pouziva ho playwright.config.mjs (webServer.command). Rucne:
#   python scripts/test_server.py 8099
# ================================================================================
import sys
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    # KLICOVE: HTTP/1.1 => keep-alive. SimpleHTTPRequestHandler posila
    # Content-Length u vsech statickych souboru, takze je to bezpecne.
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass  # log kazdeho z ~145 pozadavku by jen zaplavil vystup testu

    def end_headers(self):
        # Testy maji cachovani vypnute — jinak by druhy beh videl stary soubor.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    # HTTP RANGE (16. 9. 2026, vektorova mapa): PMTiles se ctou po kouskach hlavickou
    # Range: bytes=a-b. SimpleHTTPRequestHandler ji ignoruje a posle cely soubor, cimz
    # by knihovna pmtiles dostala spatne bajty. Tady jen pro soubory .pmtiles (zbytek
    # jako driv), odpoved 206 + Content-Range, jako to dela Cloudflare/R2.
    def do_GET(self):
        rng = self.headers.get('Range')
        if not rng or '.pmtiles' not in self.path:
            return super().do_GET()
        path = self.translate_path(self.path.split('?', 1)[0])
        if not os.path.isfile(path):
            self.send_error(404); return
        size = os.path.getsize(path)
        try:
            a, b = rng.replace('bytes=', '').split('-')
            a = int(a); b = int(b) if b else size - 1
        except Exception:
            self.send_error(416); return
        b = min(b, size - 1)
        if a > b:
            self.send_error(416); return
        with open(path, 'rb') as fh:
            fh.seek(a); data = fh.read(b - a + 1)
        self.send_response(206)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, b, size))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    ThreadingHTTPServer.allow_reuse_address = True
    srv = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=ROOT))
    print('Testovaci server (HTTP/1.1 keep-alive) bezi na http://127.0.0.1:%d' % port, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
