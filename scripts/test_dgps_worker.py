# -*- coding: utf-8 -*-
u"""DGPS ŽIVĚ v cloud/worker.js (15. 9. 2026): /dgps/push a /dgps/pull ve V8 nad
falešnou D1 (stejný SHIM jako scripts/test_prodej_worker.py). Hlídá, že základna
uloží celý log pod šestiznakový kód, rover ho stejným kódem dostane zpět a špatný
kód / prázdné tělo se odmítnou — bez přihlášení (kód je tajemství, jako u hodinek).
Spuštění:  python scripts/test_dgps_worker.py
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
import test_prodej_worker as H  # noqa: E402  (SHIM, W, MiniRacer)


def main():
    src = io.open(H.W, encoding='utf-8').read().replace('export default {', 'globalThis.WORKER = {')
    r = H.MiniRacer()
    r.eval(H.SHIM)
    r.eval(src)
    vys = []

    def ok(jm, cond, det=''):
        vys.append(bool(cond))
        print(('  OK    ' if cond else '  CHYBA ') + jm + (('  -> ' + str(det)[:300]) if det != '' else ''))

    def call(method, path, body=None):
        r.eval('CALL(%s, %s, %s, {}, ENV())' % (json.dumps(method), json.dumps(path), json.dumps(body)))
        out = r.eval('JSON.stringify(OUT)')
        return json.loads(out) if out else None

    def log():
        return json.loads(r.eval('JSON.stringify(LOG)'))

    # falešná tabulka dgps_live: jeden řádek v paměti JS
    r.eval('''
      globalThis.DG = null;
      DB.on(/INSERT INTO dgps_live/, function (a) { DG = { code: a[0], base: a[1], buckets: a[2], ts: a[3], pulls: (DG && DG.code === a[0]) ? DG.pulls : 0 }; return { run: { changes: 1 } }; });
      DB.on(/SELECT pulls FROM dgps_live WHERE code=\\?/, function (a) { return { first: (DG && DG.code === a[0]) ? { pulls: DG.pulls } : null }; });
      DB.on(/SELECT base, buckets, ts, pulls FROM dgps_live WHERE code=\\?/, function (a) { return { first: (DG && DG.code === a[0]) ? DG : null }; });
      DB.on(/UPDATE dgps_live SET pulls=pulls\\+1/, function (a) { if (DG && DG.code === a[0]) DG.pulls++; return { run: { changes: 1 } }; });
    ''')
    h = call('GET', '/health')
    ok('H /health hlásí v ≥ 24 a dgps:true', h['status'] == 200 and h['data'].get('v', 0) >= 24 and h['data'].get('dgps') is True, h['data'])

    base = {'name': 'PBPP 241', 'lat': 50.0755, 'lng': 14.4378, 'vyska': 235.4}
    bk = [{'t': 1789000000000 + i * 60000, 'dE': 1.2345 + i * 0.01, 'dN': -0.8, 'dU': None if i % 2 else 0.5, 'n': 40} for i in range(5)]
    p = call('POST', '/dgps/push', {'code': 'ab12cd', 'base': base, 'buckets': bk})
    ok('P1 push uloží log (kód se normalizuje na velká písmena)', p['status'] == 200 and p['data'].get('n') == 5 and r.eval('DG.code') == 'AB12CD', p)
    ok('P2 hodnoty zaokrouhlené na mm, dU null zůstane null', json.loads(r.eval('DG.buckets'))[0]['dE'] == 1.235 and json.loads(r.eval('DG.buckets'))[1]['dU'] is None, r.eval('DG.buckets')[:120])
    ok('P3 push bez kódu → 400', call('POST', '/dgps/push', {'code': 'ab', 'base': base, 'buckets': bk})['status'] == 400)
    ok('P4 push bez polohy základny → 400', call('POST', '/dgps/push', {'code': 'AB12CD', 'buckets': bk})['status'] == 400)
    g = call('GET', '/dgps/pull?code=AB12CD')
    ok('R1 pull vrátí základnu i bloky', g['status'] == 200 and g['data']['base']['name'] == 'PBPP 241' and len(g['data']['buckets']) == 5 and 'stale' in g['data'], g)
    g2 = call('GET', '/dgps/pull?code=ab12cd')
    ok('R2 pull s malými písmeny funguje a počítá stažení', g2['status'] == 200 and r.eval('DG.pulls') == 2, r.eval('DG.pulls'))
    ok('R3 neznámý kód → 404', call('GET', '/dgps/pull?code=ZZZZZZ')['status'] == 404)
    ok('R4 krátký kód → 400', call('GET', '/dgps/pull?code=AB')['status'] == 400)
    p2 = call('POST', '/dgps/push', {'code': 'AB12CD', 'base': base, 'buckets': bk + [{'t': 1789000400000, 'dE': 1, 'dN': 1, 'n': 3}]})
    ok('P5 další push přepíše log a vrátí počet stažení', p2['status'] == 200 and p2['data'].get('n') == 6 and p2['data'].get('pulls') == 2, p2)
    ok('X žádná cesta DGPS nechce přihlášení (ani jedna odpověď 401)', all(x['status'] != 401 for x in (p, g, g2, p2)))
    n = sum(1 for v in vys if not v)
    print('\n%d/%d OK' % (len(vys) - n, len(vys)))
    return 1 if n else 0


if __name__ == '__main__':
    sys.exit(main())
