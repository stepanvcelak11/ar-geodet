#!/usr/bin/env python3
# ===== AR Geodet — STATICKY SERVER PRO SMOKE TESTY ==============================
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
