# -*- coding: utf-8 -*-
u"""PŘESNOST PODLE MODELU TELEFONU v cloud/worker.js (25. 9. 2026, 6. hodnocení a1) — V8 nad falešnou D1.
  • POST /stats/phone bez přihlášení: jen model a čísla (žádná poloha), validace, brzda na IP,
  • GET /stats/phone?model= → n, medián, kvartily (od 3 zkoušek), GET /stats/phones → přehled modelů,
  • /health v >= 30 a stats:true.
Spuštění:  python scripts/test_stats_worker.py
"""
import io
import json
import os
import sys
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_prodej_worker as H  # noqa: E402


def main():
    src = io.open(H.W, encoding='utf-8').read().replace('export default {', 'globalThis.WORKER = {')
    r = H.MiniRacer()
    r.eval(H.SHIM)
    r.eval(src)
    vys = []

    def ok(jm, cond, det=''):
        vys.append(bool(cond))
        print(('  OK    ' if cond else '  CHYBA ') + jm + (('  -> ' + str(det)[:300]) if det != '' else ''))

    def call(method, path, body=None, headers=None):
        r.eval('CALL(%s, %s, %s, %s, ENV())' % (json.dumps(method), json.dumps(path), json.dumps(body), json.dumps(headers or {})))
        out = r.eval('JSON.stringify(OUT)')
        return json.loads(out) if out else None

    def log():
        return json.loads(r.eval('JSON.stringify(LOG)'))

    def rule(regex, js_fn):
        r.eval('DB.on(%s, %s)' % (regex, js_fn))

    def base(guard=None, odhady=None, vse=None):
        r.eval('DB.reset()')
        rule('/SELECT n, until FROM guard/', 'function(){ return { first: %s }; }' % json.dumps(guard))
        rule('/SELECT odhad FROM phone_stats WHERE model=\\?/', 'function(a){ return { all: %s }; }' % json.dumps([{'odhad': x} for x in (odhady or [])]))
        rule('/SELECT model, odhad FROM phone_stats/', 'function(){ return { all: %s }; }' % json.dumps(vse or []))

    def vlozeno():
        return [l for l in log() if (l.get('sql') or '').startswith('INSERT INTO phone_stats')]

    base()
    h = call('GET', '/health')
    ok('H1 /health v >= 30 a stats:true', (h['data'].get('v') or 0) >= 30 and h['data'].get('stats') is True, h['data'].get('v'))

    base()
    a1 = call('POST', '/stats/phone', {'model': 'iPhone 14 Pro/15/15 Pro/16', 'os': 'iOS 18.6', 'odhad': 2.8, 'r95': 3.1, 'kompas': 4.2, 'bod': 1.9, 'lat': 50.1, 'lng': 14.4})
    v = vlozeno()
    ok('A1 bez přihlášení 200, uloží model a čísla', a1['status'] == 200 and len(v) == 1 and v[0]['args'][1] == 'iPhone 14 Pro/15/15 Pro/16' and v[0]['args'][3] == 2.8, (a1, v))
    ok('A2 ŽÁDNÁ poloha se neukládá (lat/lng z požadavku nikde)', v and 50.1 not in v[0]['args'] and 14.4 not in v[0]['args'] and 'lat' not in v[0]['sql'], v)
    ok('A3 tabulka se zakládá sama', any('CREATE TABLE IF NOT EXISTS phone_stats' in (l.get('sql') or '') for l in log()))
    base()
    a4 = call('POST', '/stats/phone', {'model': '<script>', 'odhad': 3})
    ok('A4 nesmyslný model 400', a4['status'] == 400 and not vlozeno(), a4)
    base()
    a5 = call('POST', '/stats/phone', {'model': 'SM-S911B', 'odhad': 'x'})
    ok('A5 chybí odhad 400', a5['status'] == 400 and not vlozeno(), a5)
    base(guard={'n': 12, 'until': 9e15})
    a6 = call('POST', '/stats/phone', {'model': 'SM-S911B', 'odhad': 3})
    ok('A6 brzda na IP: 13. zkouška za den 429', a6['status'] == 429 and not vlozeno(), a6)

    base(odhady=[2.0, 3.0, 4.0, 5.0])
    g1 = call('GET', '/stats/phone?model=SM-S911B')
    ok('G1 medián a kvartily od 3 zkoušek (2,3,4,5 → 3,5; 2,8; 4,3 po zaokrouhlení)', g1['data'].get('n') == 4 and g1['data'].get('median') == 3.5 and g1['data'].get('p25') == 2.8 and g1['data'].get('p75') == 4.3, g1['data'])
    base(odhady=[2.0, 3.0])
    g2 = call('GET', '/stats/phone?model=SM-S911B')
    ok('G2 pod 3 zkoušky: n, ale bez mediánu', g2['data'].get('n') == 2 and g2['data'].get('median') is None, g2['data'])
    base(vse=[{'model': 'A', 'odhad': 2}, {'model': 'A', 'odhad': 4}, {'model': 'A', 'odhad': 3}, {'model': 'B', 'odhad': 9}])
    g3 = call('GET', '/stats/phones')
    ok('G3 přehled: jen modely s ≥ 3 zkouškami, s mediánem', g3['data'].get('telefony') == [{'model': 'A', 'n': 3, 'median': 3}], g3['data'])

    n = len(vys); bad = n - sum(vys)
    print('\n%d/%d OK' % (n - bad, n))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
