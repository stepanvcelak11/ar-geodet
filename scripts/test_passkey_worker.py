# -*- coding: utf-8 -*-
u"""PASSKEY v cloud/worker.js (25. 9. 2026, 7. hodnocení f1) — TOK a kontroly ve V8 nad falešnou D1.

Kryptografie (SHA-256, ECDSA) je tu jen naoko (digest = nuly, verify = příznak) — skutečný podpis
z virtuálního autentizátoru ověřuje scripts/test_passkey.py v prohlížeči stejnými funkcemi workeru.
Tady: výzva (jednorázová, typ, platnost), původ (jen appka / localhost), příznaky UP+UV, neznámý
klíč, zablokovaný účet, odpověď jako /login, klíč vlastníka jen u klíče svázaného s OWNER_KEY,
registrace (jen ES256, vlastník jen se správným klíčem), smazání s účtem, /health v >= 31.
Spuštění:  python scripts/test_passkey_worker.py
"""
import io
import json
import os
import sys
import base64
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_prodej_worker as H  # noqa: E402

NULA = '00' * 32
OWNER = 'K' * 30
EXTRA = r'''
if (typeof TextDecoder === 'undefined') { globalThis.TextDecoder = function () {}; TextDecoder.prototype.decode = function (u) { u = new Uint8Array(u); var s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } }; }
crypto.subtle.digest = function () { return Promise.resolve(new Uint8Array(32).buffer); };
globalThis.__VERIFY = true;
crypto.subtle.verify = function () { return Promise.resolve(globalThis.__VERIFY); };
var _imp = crypto.subtle.importKey;
crypto.subtle.importKey = function (fmt, data, alg) { if (fmt === 'spki' && new Uint8Array(data).length < 10) return Promise.reject(new Error('bad')); return _imp.apply(this, arguments); };
'''


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


def main():
    src = io.open(H.W, encoding='utf-8').read().replace('export default {', 'globalThis.WORKER = {')
    r = H.MiniRacer()
    r.eval(H.SHIM)
    r.eval(EXTRA)
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

    ACC = {'id': 'acc1', 'code': 'ABCDEFGH', 'name': 'Tester', 'pass_hash': NULA, 'salt': 'aa', 'iters': 40000, 'tarif': 'zaklad', 'disabled': 0, 'created': 1}
    USER = {'id': 'u1', 'firm_id': 'f1', 'name': 'Tester', 'role': 'admin', 'disabled': 0, 'acc_id': 'acc1', 'own': 1, 'left_ts': None,
            'perms': '{}', 'auto_lock': 0, 'max_users': 1, 'frozen': 0, 'pass_hash': NULA, 'salt': 'aa', 'iters': 40000}
    CH = b64u(b'V' * 32)

    def base(vyzva=None, cred=None, acc=None):
        r.eval('DB.reset()')
        a = dict(ACC); a.update(acc or {})
        rule('/FROM users u JOIN firms f ON f\\.id = u\\.firm_id WHERE u\\.id=\\?/', 'function(){ return { first: %s }; }' % json.dumps(USER))
        rule('/SELECT \\* FROM accounts WHERE id=\\?/', 'function(){ return { first: %s }; }' % json.dumps(a))
        rule('/SELECT n, until FROM guard/', 'function(){ return { first: null }; }')
        rule('/FROM pk_challenges WHERE ch=\\?/', 'function(x){ return { first: %s && x[0] === %s.ch ? %s : null }; }' % (json.dumps(bool(vyzva)), json.dumps(vyzva or {}), json.dumps(vyzva)))
        rule('/SELECT \\* FROM passkeys WHERE cred_id=\\?/', 'function(x){ return { first: %s && x[0] === "cred1" ? %s : null }; }' % (json.dumps(bool(cred)), json.dumps(cred)))
        rule('/FROM users u JOIN firms f ON f\\.id=u\\.firm_id WHERE u\\.acc_id=\\?/', 'function(){ return { all: [{ uid: "u1", firm_id: "f1", role: "admin", own: 1, left_ts: null, disabled: 0, name: "Moje", code: "FFFFFF" }] }; }')
        r.eval('ENV = (function (o) { return function () { var e = o(); e.OWNER_KEY = %s; return e; }; })(ENV)' % json.dumps(OWNER)) if not r.eval('typeof __ENVP') == 'boolean' else None
        r.eval('globalThis.__ENVP = true')
        r.eval('globalThis.__VERIFY = true')

    def cd(typ, ch=CH, origin='https://stepanvcelak11.github.io'):
        return b64u(json.dumps({'type': typ, 'challenge': ch, 'origin': origin}).encode())

    def auth_data(flags=0x05):
        return b64u(bytes(32) + bytes([flags]) + bytes(4))
    SIG = b64u(bytes([0x30, 0x44, 0x02, 0x20]) + b'\x01' * 32 + bytes([0x02, 0x20]) + b'\x02' * 32)
    ORIG = {'Origin': 'https://stepanvcelak11.github.io'}
    VYZVA_GET = {'ch': CH, 'ts': 9e15, 'acc_id': None, 'kind': 'get'}
    CRED = {'cred_id': 'cred1', 'acc_id': 'acc1', 'pub': b64u(b'P' * 91), 'alg': -7, 'owner': 0, 'created': 1}

    base()
    h = call('GET', '/health')
    ok('H1 /health v >= 31 a passkey:true', (h['data'].get('v') or 0) >= 31 and h['data'].get('passkey') is True, h['data'].get('v'))

    # ---- přihlášení ----
    base()
    s1 = call('POST', '/passkey/login/start', {}, ORIG)
    ok('L1 start: výzva + rpId appky, výzva uložená (typ get)', s1['status'] == 200 and len(s1['data'].get('challenge') or '') >= 40 and s1['data'].get('rpId') == 'stepanvcelak11.github.io'
       and any((l.get('sql') or '').startswith('INSERT INTO pk_challenges') and l['args'][3] == 'get' for l in log()), s1)
    base()
    s2 = call('POST', '/passkey/login/start', {}, {'Origin': 'https://zla-stranka.example'})
    ok('L2 cizí původ 400', s2['status'] == 400, s2)
    TELO = {'id': 'cred1', 'clientDataJSON': cd('webauthn.get'), 'authenticatorData': auth_data(), 'signature': SIG}
    base(vyzva=VYZVA_GET, cred=CRED)
    f1 = call('POST', '/passkey/login/finish', TELO, ORIG)
    ok('L3 platný podpis: odpověď jako /login (token, účet, uživatel), výzva smazaná', f1['status'] == 200 and f1['data'].get('token') and f1['data'].get('ucet', {}).get('code') == 'ABCDEFGH'
       and f1['data'].get('user', {}).get('id') == 'u1' and any((l.get('sql') or '').startswith('DELETE FROM pk_challenges WHERE ch=') for l in log()), f1)
    ok('L4 bez klíče vlastníka (klíč není svázaný s OWNER_KEY)', 'ownerKey' not in f1['data'], f1['data'].keys())
    base(vyzva=None, cred=CRED)
    f2 = call('POST', '/passkey/login/finish', TELO, ORIG)
    ok('L5 výzva neexistuje / použitá 400', f2['status'] == 400, f2)
    base(vyzva=dict(VYZVA_GET, kind='create'), cred=CRED)
    f3 = call('POST', '/passkey/login/finish', TELO, ORIG)
    ok('L6 výzva z registrace nejde použít k přihlášení 400', f3['status'] == 400, f3)
    base(vyzva=dict(VYZVA_GET, ts=1), cred=CRED)
    f4 = call('POST', '/passkey/login/finish', TELO, ORIG)
    ok('L7 prošlá výzva (> 5 min) 400', f4['status'] == 400, f4)
    base(vyzva=VYZVA_GET, cred=None)
    f5 = call('POST', '/passkey/login/finish', TELO, ORIG)
    ok('L8 neznámý klíč 401', f5['status'] == 401, f5)
    base(vyzva=VYZVA_GET, cred=CRED)
    f6 = call('POST', '/passkey/login/finish', dict(TELO, authenticatorData=auth_data(0x01)), ORIG)
    ok('L9 bez ověření uživatele (UV, Face ID) 401', f6['status'] == 401, f6)
    base(vyzva=VYZVA_GET, cred=CRED)
    f7 = call('POST', '/passkey/login/finish', dict(TELO, clientDataJSON=cd('webauthn.get', origin='https://jina.example')), ORIG)
    ok('L10 clientData z jiné stránky 401', f7['status'] == 401, f7)
    base(vyzva=VYZVA_GET, cred=CRED)
    r.eval('globalThis.__VERIFY = false')
    f8 = call('POST', '/passkey/login/finish', TELO, ORIG)
    ok('L11 podpis nesedí 401', f8['status'] == 401, f8)
    base(vyzva=VYZVA_GET, cred=CRED, acc={'disabled': 1})
    f9 = call('POST', '/passkey/login/finish', TELO, ORIG)
    ok('L12 zablokovaný účet 403', f9['status'] == 403, f9)
    base(vyzva=VYZVA_GET, cred=dict(CRED, owner=1))
    f10 = call('POST', '/passkey/login/finish', TELO, ORIG)
    ok('L13 klíč vlastníka: odpověď vrátí OWNER_KEY', f10['status'] == 200 and f10['data'].get('ownerKey') == OWNER, f10['data'].get('ownerKey'))

    # ---- registrace (s přihlášením) ----
    tok = r.eval('TOKEN("u1","f1","acc1")')
    AUTH = dict(ORIG, Authorization='Bearer ' + tok)
    base()
    g0 = call('POST', '/passkey/register/start', {}, ORIG)
    ok('R0 bez přihlášení 401', g0['status'] == 401, g0)
    base()
    g1 = call('POST', '/passkey/register/start', {}, AUTH)
    ok('R1 start: výzva typu create svázaná s účtem, uživatel = kód účtu', g1['status'] == 200 and g1['data'].get('user', {}).get('name') == 'ABCDEFGH'
       and any((l.get('sql') or '').startswith('INSERT INTO pk_challenges') and l['args'][2] == 'acc1' and l['args'][3] == 'create' for l in log()), g1)
    VYZVA_REG = {'ch': CH, 'ts': 9e15, 'acc_id': 'acc1', 'kind': 'create'}
    REG = {'id': 'cred1', 'clientDataJSON': cd('webauthn.create'), 'publicKey': b64u(b'P' * 91), 'alg': -7, 'name': 'iPhone · 25. 9. 2026'}

    def zapsano():
        return [l for l in log() if (l.get('sql') or '').startswith('INSERT OR REPLACE INTO passkeys')]
    base(vyzva=VYZVA_REG)
    g2 = call('POST', '/passkey/register/finish', REG, AUTH)
    z = zapsano()
    ok('R2 finish: klíč uložen k účtu, bez příznaku vlastníka', g2['status'] == 200 and len(z) == 1 and z[0]['args'][1] == 'acc1' and z[0]['args'][4] == 0, (g2, z))
    base(vyzva=VYZVA_REG)
    g3 = call('POST', '/passkey/register/finish', dict(REG, ownerKey=OWNER), AUTH)
    z = zapsano()
    ok('R3 se správným klíčem vlastníka → owner=1', g3['status'] == 200 and z and z[0]['args'][4] == 1 and g3['data'].get('owner') is True, (g3, z))
    base(vyzva=VYZVA_REG)
    g4 = call('POST', '/passkey/register/finish', dict(REG, ownerKey='spatny-klic-' + 'x' * 20), AUTH)
    z = zapsano()
    ok('R4 se špatným klíčem vlastníka → owner=0', g4['status'] == 200 and z and z[0]['args'][4] == 0, (g4, z))
    base(vyzva=VYZVA_REG)
    g5 = call('POST', '/passkey/register/finish', dict(REG, alg=-257), AUTH)
    ok('R5 jiný algoritmus než ES256 400 a nic se neuloží', g5['status'] == 400 and not zapsano(), g5)
    base(vyzva=dict(VYZVA_REG, acc_id='acc2'))
    g6 = call('POST', '/passkey/register/finish', REG, AUTH)
    ok('R6 výzva jiného účtu 400', g6['status'] == 400 and not zapsano(), g6)
    base(vyzva=VYZVA_REG)
    g7 = call('POST', '/passkey/register/finish', dict(REG, publicKey=b64u(b'xx')), AUTH)
    ok('R7 neplatný veřejný klíč 400', g7['status'] == 400 and not zapsano(), g7)

    # ---- smazání účtu maže i klíče ----
    base()
    rule('/FROM users WHERE acc_id=\\?/', 'function(){ return { all: [] }; }')
    call('POST', '/account/delete', {'password': 'cokoli'}, AUTH)
    ok('D1 /account/delete smaže i přístupové klíče', any((l.get('sql') or '').startswith('DELETE FROM passkeys WHERE acc_id=?') for l in log()),
       [l.get('sql') for l in log() if (l.get('sql') or '').startswith('DELETE')])

    n = len(vys); bad = n - sum(vys)
    print('\n%d/%d OK' % (n - bad, n))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
