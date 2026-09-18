# -*- coding: utf-8 -*-
u"""OBNOVOVACÍ KÓD ÚČTU v cloud/worker.js (18. 9. 2026, hodnocení R3) — ve V8 nad falešnou D1
(stejný SHIM jako scripts/test_prodej_worker.py). Registrace nechce e-mail, takže heslo nešlo
obnovit vůbec; teď má účet druhý klíč:
  • /register vrací `recovery` (4×5 znaků z abecedy bez O/0/I/1/L) a uloží jeho PBKDF2 hash,
  • POST /account/recover {code, recovery, password} bez tokenu: ověří, nastaví nové heslo,
    otočí kód a vrátí nový; špatný kód 401, krátké heslo 400, brzda na kód+IP,
  • POST /account/recovery (s tokenem, heslo znovu) vydá nový kód pro starší účty.
⚠ sham crypto.subtle.deriveBits vrací 32 nul → „správný“ hash je '00'*32 pro jakýkoli vstup.
Spuštění:  python scripts/test_obnova_uctu_worker.py
"""
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

    def base(acc=None):
        r.eval('DB.reset()')
        a = dict(ACC); a.update(acc or {})
        rule('/FROM users u JOIN firms f ON f\\.id = u\\.firm_id WHERE u\\.id=\\?/', 'function(){ return { first: %s }; }' % json.dumps(USER))
        rule('/SELECT \\* FROM accounts WHERE id=\\?/', 'function(){ return { first: %s }; }' % json.dumps(a))
        rule('/SELECT \\* FROM accounts WHERE code=\\?/', 'function(a){ return { first: a[0] === %s ? %s : null }; }' % (json.dumps(a['code']), json.dumps(a)))
        rule('/SELECT n, until FROM guard/', 'function(){ return { first: null }; }')
        return a

    # ---- H) health ----------------------------------------------------------------
    base()
    h = call('GET', '/health')
    ok('H1 /health v >= 28 a recovery:true', h['status'] == 200 and (h['data'].get('v') or 0) >= 28 and h['data'].get('recovery') is True, h['data'].get('v'))

    # ---- A) registrace vrátí obnovovací kód a uloží jeho hash ------------------------
    # SHIM nemá crypto.randomUUID (registrace ho potřebuje pro id účtu/prostoru/uživatele)
    r.eval('if (!crypto.randomUUID) crypto.randomUUID = function () { return "uuid-" + Math.random().toString(16).slice(2); };')
    base()
    a = call('POST', '/register', {'name': 'Tester', 'spaceName': 'Moje', 'password': 'tajneheslo1'})
    rec = (a.get('data') or {}).get('recovery')
    ok('A1 /register vrací recovery ve tvaru XXXXX-XXXXX-XXXXX-XXXXX z abecedy bez O/0/I/1/L', a['status'] == 200 and isinstance(rec, str) and re.fullmatch(r'[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}', rec) is not None, (a['status'], rec))
    upd = [l for l in log() if 'sql' in l and l['sql'].startswith('UPDATE accounts SET rec_hash=?, rec_salt=?')]
    ok('A2 hash obnovovacího kódu se zapsal k účtu (ne kód sám)', len(upd) == 1 and upd[0]['args'][0] == NULA and upd[0]['args'][0] != rec and upd[0]['args'][2] == a['data']['ucet']['id'], upd)
    ok('A3 v odpovědi je i token a kód účtu jako dřív', bool(a['data'].get('token')) and len(a['data']['ucet']['code']) == 8)

    # ---- B) obnova hesla bez tokenu -------------------------------------------------
    base()
    b0 = call('POST', '/account/recover', {'code': 'ABCDEFGH', 'recovery': 'AAAAA-BBBBB-CCCCC-DDDDD'})
    ok('B1 bez nového hesla 400', b0['status'] == 400, b0)
    b1 = call('POST', '/account/recover', {'code': 'ABCDEFGH', 'recovery': 'AAAAA-BBBBB-CCCCC-DDDDD', 'password': 'kratke'})
    ok('B2 heslo pod 8 znaků 400', b1['status'] == 400, b1)
    b2 = call('POST', '/account/recover', {'code': 'ABCDEFGH', 'recovery': 'AAAAA-BBBBB-CCCC', 'password': 'noveheslo123'})
    ok('B3 obnovovací kód špatné délky 400', b2['status'] == 400, b2)
    base({'rec_hash': 'ff' * 32})
    b3 = call('POST', '/account/recover', {'code': 'ABCDEFGH', 'recovery': 'AAAAA-BBBBB-CCCCC-DDDDD', 'password': 'noveheslo123'})
    zmena = [l for l in log() if 'sql' in l and l['sql'].startswith('UPDATE accounts SET pass_hash')]
    ok('B4 špatný obnovovací kód 401 a heslo se nemění', b3['status'] == 401 and not zmena, (b3, zmena))
    base({'rec_hash': None, 'rec_salt': None})
    b4 = call('POST', '/account/recover', {'code': 'ABCDEFGH', 'recovery': 'AAAAA-BBBBB-CCCCC-DDDDD', 'password': 'noveheslo123'})
    ok('B5 účet bez obnovovacího kódu (starší) → 401, ne 500', b4['status'] == 401, b4)
    base()
    b5 = call('POST', '/account/recover', {'code': 'abcdefgh', 'recovery': 'aaaaa bbbbb-ccccc_ddddd', 'password': 'noveheslo123'})
    sqls = [(l['sql'], l['args']) for l in log() if 'sql' in l]
    pass_upd = [x for q, x in sqls if q.startswith('UPDATE accounts SET pass_hash=?, salt=?, iters=? WHERE id=?')]
    user_upd = [x for q, x in sqls if q.startswith('UPDATE users SET pass_hash=?, salt=?, iters=? WHERE acc_id=? AND own=1')]
    rec_upd = [x for q, x in sqls if q.startswith('UPDATE accounts SET rec_hash=?, rec_salt=?')]
    novy = (b5.get('data') or {}).get('recovery')
    ok('B6 správný kód (malá písmena, mezery, podtržítko se normalizují): 200, nové heslo u účtu i vlastního uživatele',
       b5['status'] == 200 and len(pass_upd) == 1 and pass_upd[0][3] == 'acc1' and len(user_upd) == 1 and user_upd[0][3] == 'acc1', (b5, pass_upd, user_upd))
    ok('B7 kód se otočil: nový hash zapsán a nový kód v odpovědi', len(rec_upd) == 1 and isinstance(novy, str) and re.fullmatch(r'[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}', novy) is not None, (rec_upd, novy))
    ok('B8 brzda přihlášení účtu se po obnově uvolní (DELETE FROM guard log2:KOD)', any(q.startswith('DELETE FROM guard') and x and x[0] == 'log2:ABCDEFGH' for q, x in sqls), [x for q, x in sqls if q.startswith('DELETE FROM guard')])
    ok('B9 zápis do deníku vlastníka (heslo-obnoveno)', any(q.startswith('INSERT INTO owner_log') and 'heslo-obnoveno' in json.dumps(x) for q, x in sqls))
    # brzda: 6. pokus na týž kód z jedné IP → 429
    base({'rec_hash': 'ff' * 32})
    rule('/SELECT n, until FROM guard/', 'function(a){ return { first: (a[0] || "").indexOf("rec:") === 0 ? { n: 5, until: Date.now() + 60000 } : null }; }')
    b6 = call('POST', '/account/recover', {'code': 'ABCDEFGH', 'recovery': 'AAAAA-BBBBB-CCCCC-DDDDD', 'password': 'noveheslo123'})
    ok('B10 po pěti pokusech 429', b6['status'] == 429, b6)

    # ---- C) nový kód pro přihlášený účet (s tokenem, heslo znovu) ---------------------
    tok = r.eval('TOKEN("u1","f1","acc1")')
    AUTH = {'Authorization': 'Bearer ' + tok}
    base()
    c1 = call('POST', '/account/recovery', {}, AUTH)
    ok('C1 bez hesla 400', c1['status'] == 400, c1)
    base({'pass_hash': 'ff' * 32})
    c2 = call('POST', '/account/recovery', {'password': 'spatne'}, AUTH)
    ok('C2 špatné heslo 401', c2['status'] == 401, c2)
    base()
    c3 = call('POST', '/account/recovery', {'password': 'cokoli'}, AUTH)
    rec_upd = [l['args'] for l in log() if 'sql' in l and l['sql'].startswith('UPDATE accounts SET rec_hash=?, rec_salt=?')]
    ok('C3 správné heslo: nový kód v odpovědi a hash u účtu acc1', c3['status'] == 200 and re.fullmatch(r'[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}', c3['data'].get('recovery') or '') is not None and rec_upd and rec_upd[0][2] == 'acc1', (c3, rec_upd))
    c4 = call('POST', '/account/recovery', {'password': 'cokoli'})
    ok('C4 bez tokenu 401', c4['status'] == 401, c4)

    n = len(vys); bad = n - sum(vys)
    print('\n%d/%d OK' % (n - bad, n))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
