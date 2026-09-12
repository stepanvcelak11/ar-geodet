#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ===== QTRIG — BRZDA VYDÁNÍ v sw.js (holé V8, bez prohlížeče) ===================
# PROČ: sw.js se od 12. 9. 2026 před instalací nové verze ptá serveru (GET /vydano),
# jestli ji vlastník už pustil ostatním. Chyba v téhle bráně má dva špatné konce:
#   • brána moc zavřená  → lidem se appka NIKDY neaktualizuje (i vlastníkovi)
#   • brána moc otevřená → brzda nefunguje a každý push skáče lidem do appky
# Prohlížeč tu není (Node ani Playwright pro SW instalaci), tak se sw.js načte do
# py_mini_racer s dosimulovaným `self`, `caches` a `fetch` a zavolá se handler
# 'install' v šesti situacích.
#
#   1) první instalace (žádná předchozí shell cache)          → instaluje
#   2) předchozí verze + venku je STARŠÍ verze                 → ODMÍTNE
#   3) předchozí verze + venku je TATÁŽ verze                  → instaluje
#   4) předchozí verze + brzda vypnutá (verze null)           → instaluje
#   5) předchozí verze + telefon vlastníka (cache ag-vlastnik) → instaluje, na server se ani neptá
#   6) předchozí verze + server nedostupný                     → instaluje (fail-open)
#   7) kontrola běží PŘED stahováním souborů (odmítnutí = 0 stažených souborů)
#
# Použití (z kořene repa):  python scripts/test_brzda_vydani.py
# ================================================================================
import io
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW = os.path.join(ROOT, 'sw.js')

try:
    from py_mini_racer import MiniRacer
except ImportError:
    print('py_mini_racer chybí (pip install py-mini-racer)')
    sys.exit(2)

SHIM = r"""
var OUT = null, FETCHED = [], VYDANO_DOTAZ = 0;
var HANDLERS = {};
var self = globalThis;
self.addEventListener = function (n, f) { HANDLERS[n] = f; };
self.clients = { claim: function () { return Promise.resolve(); } };
self.skipWaiting = function () { return Promise.resolve(); };
self.location = { href: 'https://example.test/sw.js', origin: 'https://example.test' };
function setTimeout(f) { return 1; } function clearTimeout() {}
function AbortController() { this.signal = {}; this.abort = function () {}; }
function Request(u, o) { this.url = u; this.opts = o; }
function Response(b, o) { this.body = b; this.ok = true; this.status = 200; this.type = 'basic'; this.json = function () { return Promise.resolve(JSON.parse(b)); }; }
var CACHE_NAMES = [];
function mkCache(name) { return { match: function () { return Promise.resolve(undefined); }, put: function () { return Promise.resolve(); }, keys: function () { return Promise.resolve([]); }, delete: function () { return Promise.resolve(true); } }; }
var caches = {
    keys: function () { return Promise.resolve(CACHE_NAMES.slice()); },
    has: function (n) { return Promise.resolve(CACHE_NAMES.indexOf(n) >= 0); },
    open: function (n) { if (CACHE_NAMES.indexOf(n) < 0) CACHE_NAMES.push(n); return Promise.resolve(mkCache(n)); },
    delete: function (n) { CACHE_NAMES = CACHE_NAMES.filter(function (x) { return x !== n; }); return Promise.resolve(true); }
};
var VYDANO = { ok: true, verze: null, fail: false };
function fetch(req) {
    var url = (typeof req === 'string') ? req : req.url;
    if (url.indexOf('/vydano') >= 0) {
        VYDANO_DOTAZ++;
        if (VYDANO.fail) return Promise.reject(new Error('sit'));
        var r = new Response(JSON.stringify({ verze: VYDANO.verze, ts: 1 })); r.ok = VYDANO.ok; return Promise.resolve(r);
    }
    FETCHED.push(url);
    return Promise.resolve(new Response('x'));
}
function RUN(scen) {
    OUT = null; FETCHED = []; VYDANO_DOTAZ = 0;
    CACHE_NAMES = scen.caches.slice(); VYDANO = scen.vydano;
    var p = null;
    HANDLERS.install({ waitUntil: function (x) { p = x; } });
    Promise.resolve(p).then(function () { OUT = { ok: true, fetched: FETCHED.length, dotaz: VYDANO_DOTAZ, caches: CACHE_NAMES }; },
                             function (e) { OUT = { ok: false, err: String(e && e.message || e), fetched: FETCHED.length, dotaz: VYDANO_DOTAZ }; });
}
"""

vysledky = []


def ok(nazev, cond, detail=None):
    vysledky.append((bool(cond), nazev))
    print('  %s %s%s' % ('OK   ' if cond else 'CHYBA', nazev, ('  -> ' + json.dumps(detail, ensure_ascii=False)[:200]) if (detail is not None and not cond) else ''))


def main():
    src = io.open(SW, encoding='utf-8').read()
    m = re.search(r"const SHELL_CACHE = 'argeodet-shell-v(\d+)'", src)
    if not m:
        print('SHELL_CACHE nenalezen'); return 1
    verze = int(m.group(1))
    print('sw.js verze v%d' % verze)
    r = MiniRacer()
    r.eval(SHIM)
    r.eval(src)

    def run(caches, vydano):
        r.eval('RUN(%s)' % json.dumps({'caches': caches, 'vydano': vydano}))
        out = r.eval('JSON.stringify(OUT)')
        if not out or out == 'null':
            raise RuntimeError('install handler se nedočkal (setTimeout uvnitř?)')
        return json.loads(out)

    stara = 'argeodet-shell-v%d' % (verze - 1)

    o = run([], {'ok': True, 'verze': verze - 1, 'fail': False})
    ok('1 první instalace bez předchozí verze se nebrzdí (a na server se neptá)', o['ok'] and o['dotaz'] == 0 and o['fetched'] > 10, o)

    o = run([stara], {'ok': True, 'verze': verze - 1, 'fail': False})
    ok('2 předchozí verze + venku starší → instalace ODMÍTNUTA', not o['ok'] and 'vlastnik' in o.get('err', ''), o)
    ok('7 odmítnutí přijde PŘED stahováním souborů (0 stažených)', not o['ok'] and o['fetched'] == 0, o)

    o = run([stara], {'ok': True, 'verze': verze, 'fail': False})
    ok('3 venku tatáž verze → instaluje', o['ok'] and o['fetched'] > 10, o)

    o = run([stara], {'ok': True, 'verze': None, 'fail': False})
    ok('4 brzda vypnutá (verze null) → instaluje', o['ok'], o)

    o = run([stara, 'ag-vlastnik'], {'ok': True, 'verze': verze - 1, 'fail': False})
    ok('5 telefon vlastníka → instaluje a na server se ani neptá', o['ok'] and o['dotaz'] == 0, o)

    o = run([stara], {'ok': True, 'verze': verze - 1, 'fail': True})
    ok('6 server nedostupný → instaluje (fail-open)', o['ok'], o)

    o = run([stara], {'ok': False, 'verze': verze - 1, 'fail': False})
    ok('6b server vrací chybu (5xx) → instaluje (fail-open)', o['ok'], o)

    # aktivace nesmí smazat značku vlastníka
    r.eval("CACHE_NAMES = ['%s', 'ag-vlastnik', 'argeodet-offline-v12']; OUT = null; var pa = null; HANDLERS.activate({ waitUntil: function (x) { pa = x; } }); Promise.resolve(pa).then(function () { OUT = CACHE_NAMES; });" % ('argeodet-shell-v%d' % verze))
    zb = json.loads(r.eval('JSON.stringify(OUT)') or 'null')
    ok('8 activate nechá značku ag-vlastnik (i offline dlaždice) být', zb is not None and 'ag-vlastnik' in zb and 'argeodet-offline-v12' in zb, zb)

    chyb = [n for (o_, n) in vysledky if not o_]
    print('\n%d/%d OK' % (len(vysledky) - len(chyb), len(vysledky)))
    if chyb:
        print('CHYBA: ' + '; '.join(chyb)); return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
