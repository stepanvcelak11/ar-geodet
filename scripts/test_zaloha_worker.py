# -*- coding: utf-8 -*-
u"""ZÁLOHA DO ÚČTU v cloud/worker.js (25. 9. 2026, 6. hodnocení b1) — ve V8 nad falešnou D1
(stejný SHIM jako scripts/test_prodej_worker.py).
  • POST /account/backup {data: base64} uloží zálohu do jednoho ze DVOU slotů (nová přepíše starší),
  • GET /account/backup = seznam (bez dat), GET ?slot=N = data,
  • bez tokenu 401, bez účtu 400, příliš velká 413, ne-base64 400, brzda 429,
  • /account/delete smaže i zálohy, /health v >= 29 a zaloha:true.
Spuštění:  python scripts/test_zaloha_worker.py
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

NULA = '00' * 32


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

    ACC = {'id': 'acc1', 'code': 'ABCDEFGH', 'name': 'Tester', 'pass_hash': NULA, 'salt': 'aa', 'iters': 40000, 'tarif': 'zaklad',
           'disabled': 0, 'created': 1, 'rec_hash': NULA, 'rec_salt': 'bb'}
    USER = {'id': 'u1', 'firm_id': 'f1', 'name': 'Tester', 'role': 'admin', 'disabled': 0, 'acc_id': 'acc1', 'own': 1, 'left_ts': None,
            'perms': '{}', 'auto_lock': 0, 'max_users': 1, 'frozen': 0, 'pass_hash': NULA, 'salt': 'aa', 'iters': 40000}

    def base(sloty=None, guard=None):
        r.eval('DB.reset()')
        rule('/FROM users u JOIN firms f ON f\\.id = u\\.firm_id WHERE u\\.id=\\?/', 'function(){ return { first: %s }; }' % json.dumps(USER))
        rule('/SELECT \\* FROM accounts WHERE id=\\?/', 'function(){ return { first: %s }; }' % json.dumps(ACC))
        rule('/SELECT n, until FROM guard/', 'function(){ return { first: %s }; }' % json.dumps(guard))
        rule('/SELECT slot, ts FROM zalohy WHERE acc_id=\\?/', 'function(){ return { all: %s }; }' % json.dumps(sloty or []))
        rule('/SELECT slot, ts, size, body_n, ver, dev FROM zalohy WHERE acc_id=\\? ORDER BY ts DESC/', 'function(){ return { all: %s }; }' % json.dumps(sloty or []))
        rule('/SELECT slot, ts, size, body_n, ver, dev, data FROM zalohy WHERE acc_id=\\? AND slot=\\?/',
             'function(a){ return { first: a[1] === 1 ? { slot: 1, ts: 5, size: 8, body_n: 3, ver: "v397", dev: "iPhone", data: "SDRzSUFBQUFBQUFB" } : null }; }')

    def zapisy():
        return [l for l in log() if 'sql' in l and l['sql'].startswith('INSERT OR REPLACE INTO zalohy')]

    tok = r.eval('TOKEN("u1","f1","acc1")')
    AUTH = {'Authorization': 'Bearer ' + tok}
    DATA = 'H4sIAAAAAAAA/6tWyk0tLk5MT1WyUlAqS8wpTVWqBQBLkh6cFAAAAA=='

    base()
    h = call('GET', '/health')
    ok('H1 /health v >= 29 a zaloha:true', h['status'] == 200 and (h['data'].get('v') or 0) >= 29 and h['data'].get('zaloha') is True, h['data'].get('v'))

    base()
    a0 = call('POST', '/account/backup', {'data': DATA})
    ok('A0 bez tokenu 401', a0['status'] == 401, a0)
    base()
    a1 = call('POST', '/account/backup', {'data': DATA, 'body_n': 12, 'ver': 'v397', 'dev': 'iPhone 15'}, AUTH)
    z = zapisy()
    ok('A1 první záloha: 200, slot 0, uložená data, počet bodů, verze', a1['status'] == 200 and a1['data'].get('slot') == 0 and len(z) == 1
       and z[0]['args'][0] == 'acc1' and z[0]['args'][1] == 0 and z[0]['args'][4] == 12 and z[0]['args'][5] == 'v397' and z[0]['args'][7] == DATA, (a1, z))
    ok('A2 tabulka se zakládá sama (CREATE TABLE IF NOT EXISTS zalohy)', any('CREATE TABLE IF NOT EXISTS zalohy' in (l.get('sql') or '') for l in log()))
    base([{'slot': 0, 'ts': 100}])
    a3 = call('POST', '/account/backup', {'data': DATA}, AUTH)
    ok('A3 druhá záloha jde do slotu 1', a3['status'] == 200 and a3['data'].get('slot') == 1, a3)
    base([{'slot': 0, 'ts': 300}, {'slot': 1, 'ts': 100}])
    a4 = call('POST', '/account/backup', {'data': DATA}, AUTH)
    ok('A4 třetí záloha přepíše STARŠÍ slot (1), poslední dobrá zůstane', a4['status'] == 200 and a4['data'].get('slot') == 1, a4)
    base()
    a5 = call('POST', '/account/backup', {'data': 'A' * 1500004}, AUTH)
    ok('A5 příliš velká (> 1,5 MB) 413 a nic se nezapíše', a5['status'] == 413 and not zapisy(), a5['status'])
    base()
    a6 = call('POST', '/account/backup', {'data': '<script>alert(1)</script>'}, AUTH)
    ok('A6 ne-base64 400', a6['status'] == 400 and not zapisy(), a6)
    base(guard={'n': 40, 'until': 9e15})
    a7 = call('POST', '/account/backup', {'data': DATA}, AUTH)
    ok('A7 brzda: 41. záloha za den 429', a7['status'] == 429 and not zapisy(), a7)

    base([{'slot': 1, 'ts': 5, 'size': 8, 'body_n': 3, 'ver': 'v397', 'dev': 'iPhone'}])
    g1 = call('GET', '/account/backup', None, AUTH)
    ok('G1 seznam záloh bez dat', g1['status'] == 200 and len(g1['data'].get('zalohy') or []) == 1 and 'data' not in g1['data']['zalohy'][0], g1)
    g2 = call('GET', '/account/backup?slot=1', None, AUTH)
    ok('G2 ?slot=1 vrátí data', g2['status'] == 200 and g2['data'].get('data') == 'SDRzSUFBQUFBQUFB', g2)
    g3 = call('GET', '/account/backup?slot=0', None, AUTH)
    ok('G3 prázdný slot 404', g3['status'] == 404, g3)

    # smazání účtu smaže i zálohy
    base()
    rule('/FROM users u JOIN firms f ON f\\.id=u\\.firm_id WHERE u\\.acc_id=\\?/', 'function(){ return { all: [] }; }')
    rule('/FROM users WHERE acc_id=\\?/', 'function(){ return { all: [] }; }')
    call('POST', '/account/delete', {'password': 'cokoli'}, AUTH)
    ok('D1 /account/delete smaže i zálohy účtu', any((l.get('sql') or '').startswith('DELETE FROM zalohy WHERE acc_id=?') and l['args'] == ['acc1'] for l in log()),
       [l.get('sql') for l in log() if (l.get('sql') or '').startswith('DELETE')])

    n = len(vys); bad = n - sum(vys)
    print('\n%d/%d OK' % (n - bad, n))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
