#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ===== QTRIG — PRODEJ PRO: routy workeru v holém V8 ===========================
# PROC TENHLE TEST EXISTUJE: cloud/worker.js bezi na Cloudflare nad D1 a na tomhle
# stroji (ani v CI) neni Node ani wrangler. Prodej Pro je ale prvni cast workeru,
# kde chyba stoji PENIZE: spatne spocitane dny, dvakrat zapnute Pro, platba
# spolknuta bez odezvy. Staticka kontrola (check_worker_ucty.py) tohle nechyta.
#
# JAK: worker se nacte do py_mini_racer (`export default {` -> `globalThis.WORKER`),
# dosimuji se Headers/Response/URL/crypto/TextEncoder/btoa/fetch a D1 se nahradi
# FALESNOU databazi, ktera odpovida podle vzoru SQL a VSECHNO ZAPISUJE do logu.
# Test pak tvrdi, jake UPDATE/INSERT s jakymi hodnotami musely probehnout.
#
# ⚠ Vsechno musi byt na Promise/microtaskach — py_mini_racer nema smycku udalosti,
#   takze setTimeout uvnitr workeru by test tise zasekl (OUT zustane null).
#
#   A) /health hlasi v:13, prodej:true a stav klice vlastnika (ownerKey)
#   B) POST /objednavky bez PRODEJ_IBAN -> 503 (prodej vypnuty), s IBAN -> 8mistny
#      VS, SPAYD s castkou a VS, cenik se dvema produkty, zkouska 3 dny
#   C) jiny produkt zrusi starou otevrenou objednavku a zalozi novou (jina castka)
#   D) POST /zkouska zapne Pro na 3 dny a zapise trial_ts; podruhe 409
#   E) rucni „zaplaceno": rocni castka = +365 dni, mesicni = +30 dni; prodlouzeni
#      se pocita od konce beziciho Pro; druhe oznaceni 409
#   F) /owner/blokace zapise disabled=1 do accounts i users
#   G) cron/Fio: platba s VS se sparuje (zapne Pro), neznama skonci jako
#      nezarazena, tentyz pohyb podruhe se preskoci, druhy dotaz do 30 s se
#      nepusti (brzda banky)
#   H) /objednavky NENI placena cesta (kdo Pro nema, musi si ho umet objednat)
#   I) /owner/ucty vraci k uctu prostory, aktivitu a objednavky
#
# Pouziti (z korene repa):  python scripts/test_prodej_worker.py
# Navratovy kod: 0 = vse OK, 1 = aspon jedna vada.
# ==============================================================================
import io
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = os.path.join(ROOT, 'cloud', 'worker.js')

try:
    from py_mini_racer import MiniRacer
except Exception:
    print('CHYBA: chybi py_mini_racer (pip install py-mini-racer)')
    sys.exit(1)

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)[:300]) if detail != '' else ''))


SHIM = r'''
// ---- prostredi Workers, kolik je potreba ----------------------------------------
var _b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
globalThis.btoa = function (s) {
  var out = '', i = 0;
  for (; i + 2 < s.length; i += 3) {
    var n = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8) | s.charCodeAt(i + 2);
    out += _b64[n >> 18] + _b64[(n >> 12) & 63] + _b64[(n >> 6) & 63] + _b64[n & 63];
  }
  if (i < s.length) {
    var n2 = s.charCodeAt(i) << 16 | ((i + 1 < s.length) ? s.charCodeAt(i + 1) << 8 : 0);
    out += _b64[n2 >> 18] + _b64[(n2 >> 12) & 63] + ((i + 1 < s.length) ? _b64[(n2 >> 6) & 63] : '=') + '=';
  }
  return out;
};
globalThis.atob = function (s) {
  s = s.replace(/=+$/, ''); var out = '', buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    buf = (buf << 6) | _b64.indexOf(s[i]); bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); }
  }
  return out;
};
globalThis.TextEncoder = function () {};
TextEncoder.prototype.encode = function (s) {
  var a = []; s = unescape(encodeURIComponent(String(s)));
  for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i));
  return new Uint8Array(a);
};
// falesny HMAC: deterministicka funkce dat (staci, aby se makeToken a readToken shodly)
function FAKE_SIGN(bytes) {
  var h = 2166136261, out = new Uint8Array(32);
  for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; }
  for (var j = 0; j < 32; j++) { h = Math.imul(h ^ j, 16777619) >>> 0; out[j] = h & 255; }
  return out.buffer;
}
globalThis.crypto = {
  getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = (Math.random() * 4294967296) >>> 0; return a; },
  subtle: {
    importKey: function () { return Promise.resolve({}); },
    sign: function (alg, key, data) { return Promise.resolve(FAKE_SIGN(new Uint8Array(data))); },
    deriveBits: function () { return Promise.resolve(new Uint8Array(32).buffer); }
  }
};
globalThis.Headers = function (init) { this._m = {}; if (init) for (var k in init) this.set(k, init[k]); };
Headers.prototype.get = function (k) { var v = this._m[String(k).toLowerCase()]; return v == null ? null : v; };
Headers.prototype.set = function (k, v) { this._m[String(k).toLowerCase()] = String(v); };
globalThis.Response = function (body, init) {
  init = init || {}; this.body = body; this.status = init.status || 200; this.ok = this.status >= 200 && this.status < 300;
  this.headers = new Headers(init.headers || {});
};
Response.prototype.json = function () { try { return Promise.resolve(JSON.parse(this.body)); } catch (e) { return Promise.reject(e); } };
Response.prototype.text = function () { return Promise.resolve(String(this.body)); };
globalThis.URL = function (u) {
  var m = /^(https?:\/\/[^\/]+)(\/[^?#]*)?(\?[^#]*)?/.exec(u);
  this.origin = m ? m[1] : ''; this.pathname = (m && m[2]) || '/';
  var q = {}; ((m && m[3]) || '').slice(1).split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
  this.searchParams = { get: function (k) { return q.hasOwnProperty(k) ? q[k] : null; } };
};
globalThis.FETCH_LOG = []; globalThis.FETCH_REPLY = null;
globalThis.fetch = function (url, init) {
  FETCH_LOG.push(url);
  var r = typeof FETCH_REPLY === 'function' ? FETCH_REPLY(url) : FETCH_REPLY;
  if (!r) return Promise.resolve(new Response('{}', { status: 500 }));
  return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status || 200 }));
};
// ---- falesna D1 ----------------------------------------------------------------------
// DB.on(regex, fn) — fn(args, sql) vraci {first:..} / {all:[..]} / {run:{changes:n}};
// prvni sedici vzor vyhrava; bez vzoru: first null, all [], run changes 1.
globalThis.LOG = []; globalThis.RULES = [];
globalThis.DB = {
  on: function (re, fn) { RULES.unshift([re, fn]); },
  reset: function () { RULES.length = 0; LOG.length = 0; },
  prepare: function (sql) {
    var args = [];
    var find = function () { for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(sql)) return RULES[i][1](args, sql) || {}; return {}; };
    var st = {
      bind: function () { args = Array.prototype.slice.call(arguments); return st; },
      first: function () { LOG.push({ sql: sql, args: args, op: 'first' }); var r = find(); return Promise.resolve(r.first === undefined ? null : r.first); },
      all: function () { LOG.push({ sql: sql, args: args, op: 'all' }); var r = find(); return Promise.resolve({ results: r.all || [] }); },
      run: function () { LOG.push({ sql: sql, args: args, op: 'run' }); var r = find(); if (r.throw) return Promise.reject(new Error(r.throw)); return Promise.resolve({ meta: { changes: r.run && r.run.changes != null ? r.run.changes : 1 } }); }
    };
    return st;
  },
  batch: function (arr) { return Promise.resolve(arr.map(function () { return { meta: { changes: 1 } }; })); }
};
function ENV(extra) { var e = { DB: DB, OWNER_KEY: 'klic-vlastnika-aspon-24-znaku-dlouhy', TOKEN_SECRET: 'tajemstvi' }; for (var k in (extra || {})) e[k] = extra[k]; return e; }
function b64u(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function bytesOf(s) { return new TextEncoder().encode(s); }
function TOKEN(uid, fid, aid) {
  var payload = b64u(JSON.stringify({ u: uid, f: fid, exp: Date.now() + 864e5, a: aid }));
  var sig = FAKE_SIGN(bytesOf(payload));
  var s = String.fromCharCode.apply(null, new Uint8Array(sig));
  return payload + '.' + b64u(s);
}
function REQ(method, path, body, headers) {
  var h = new Headers(headers || {});
  return { method: method, url: 'https://api.test' + path, headers: h,
           json: function () { return Promise.resolve(body == null ? null : JSON.parse(JSON.stringify(body))); } };
}
var CTX = { waitUntil: function (p) { if (p && p.catch) p.catch(function () {}); } };
globalThis.OUT = null;
function CALL(method, path, body, headers, env) {
  OUT = null;
  WORKER.fetch(REQ(method, path, body, headers), env || ENV(), CTX).then(function (r) {
    return r.json().then(function (d) { OUT = { status: r.status, data: d }; }, function () { OUT = { status: r.status, data: null }; });
  }, function (e) { OUT = { status: -1, data: { error: String(e && e.stack || e) } }; });
}
function CRON(env) { OUT = null; WORKER.scheduled({}, env, CTX).then(function () { OUT = { ok: true }; }, function (e) { OUT = { ok: false, error: String(e) }; }); }
'''

# Kanonicke radky: ucet, clenstvi (vlastni prostor), firma.
ACC = {'id': 'acc1', 'code': 'K7QM3XP2', 'name': 'Tester', 'pass_hash': 'x', 'salt': 'y', 'iters': 1,
       'tarif': 'zaklad', 'tarif_do': None, 'disabled': 0, 'created': 1, 'last_login': 1, 'trial_ts': None}
USER = {'id': 'u1', 'firm_id': 'f1', 'name': 'Tester', 'role': 'admin', 'disabled': 0, 'acc_id': 'acc1',
        'left_ts': None, 'own': 1, 'frozen': 0, 'maxUsers': 1}

DEN = 864e5


def main():
    src = io.open(W, encoding='utf-8').read().replace('export default {', 'globalThis.WORKER = {')
    r = MiniRacer()
    r.eval(SHIM)
    r.eval(src)

    def call(method, path, body=None, headers=None, env=None):
        r.eval('CALL(%s, %s, %s, %s, %s)' % (json.dumps(method), json.dumps(path), json.dumps(body),
                                              json.dumps(headers or {}), env or 'ENV()'))
        out = r.eval('JSON.stringify(OUT)')
        out = json.loads(out) if out else None
        if out is None:
            raise RuntimeError('worker se nedockal odpovedi (setTimeout uvnitr?) u ' + path)
        return out

    def log():
        return r.eval('JSON.stringify(LOG)') and json.loads(r.eval('JSON.stringify(LOG)'))

    def rule(regex, js_fn):
        r.eval('DB.on(%s, %s)' % (regex, js_fn))

    def base_rules(acc=None, user=None):
        r.eval('DB.reset()')
        a = dict(ACC); a.update(acc or {})
        u = dict(USER); u.update(user or {})
        rule('/FROM users u JOIN firms f ON f\\.id = u\\.firm_id WHERE u\\.id=\\?/', 'function(){ return { first: %s }; }' % json.dumps(u))
        rule('/SELECT \\* FROM accounts WHERE id=\\?/', 'function(){ return { first: %s }; }' % json.dumps(a))
        rule('/SELECT \\* FROM accounts WHERE code=\\?/', 'function(a){ return { first: a[0] === %s ? %s : null }; }' % (json.dumps(a['code']), json.dumps(a)))
        rule('/SELECT \\* FROM accounts WHERE id=\\? OR code=\\?/', 'function(a){ return { first: (a[0] === "acc1" || a[1] === %s) ? %s : null }; }' % (json.dumps(a['code']), json.dumps(a)))
        rule('/SELECT n, until FROM guard/', 'function(){ return { first: null }; }')
        return a, u

    tok = r.eval('TOKEN("u1","f1","acc1")')
    AUTH = {'Authorization': 'Bearer ' + tok}
    OWN = {'X-Owner-Key': 'klic-vlastnika-aspon-24-znaku-dlouhy'}
    IBAN = "ENV({PRODEJ_IBAN:'CZ65 0800 0000 1920 0014 5399', PRODEJ_UCET:'19-2000145399/0800'})"

    # ---- A) health -------------------------------------------------------------
    base_rules()
    h = call('GET', '/health')
    ok('A1 /health v:13', h['data'].get('v') == 13, h['data'].get('v'))
    ok('A2 /health prodej:true', h['data'].get('prodej') is True)
    # 12. 9. 2026: /health rika, v jakem stavu je OWNER_KEY ('ok' | 'chybi' | 'kratky') —
    # uzivatel klic „nastavoval nekolikrat" a appka hlasila jen obecnou 503.
    ok('A3 /health ownerKey:ok s klicem >= 24 znaku', h['data'].get('ownerKey') == 'ok', h['data'].get('ownerKey'))
    h2 = call('GET', '/health', env='Object.assign(ENV(), { OWNER_KEY: "kratky" })')
    ok('A4 /health ownerKey:kratky pod 24 znaku', h2['data'].get('ownerKey') == 'kratky', h2['data'].get('ownerKey'))
    h3 = call('GET', '/health', env='Object.assign(ENV(), { OWNER_KEY: undefined })')
    ok('A5 /health ownerKey:chybi bez klice', h3['data'].get('ownerKey') == 'chybi', h3['data'].get('ownerKey'))
    o3 = call('GET', '/owner/ucty', headers=OWN, env='Object.assign(ENV(), { OWNER_KEY: undefined })')
    ok('A6 /owner/* bez klice: 503 + ownerKey:chybi v tele (appka z toho sklada presnou hlasku)',
       o3['status'] == 503 and o3['data'].get('ownerKey') == 'chybi' and 'Secret' in (o3['data'].get('error') or ''), o3)
    o4 = call('GET', '/owner/ucty', headers=OWN, env='Object.assign(ENV(), { OWNER_KEY: "kratky" })')
    ok('A7 /owner/* s kratkym klicem: 503 + ownerKey:kratky', o4['status'] == 503 and o4['data'].get('ownerKey') == 'kratky', o4)
    # zadost o Pro: kind 'pro' projde whitelistem schranky
    rule('/INSERT INTO feedback/', 'function(a){ LOG.push({ fb: a }); return { run: 1 }; }')
    fb = call('POST', '/feedback', body={'kind': 'pro', 'txt': 'Chci Pro.', 'contact': 'x@y.cz', 'who': 'Jan · K7QM3XP2', 'meta': {'ucet': 'K7QM3XP2'}})
    fbl = [l for l in log() if l.get('fb')]
    ok('A8 POST /feedback kind=pro se ulozi jako pro (ne jine)', fb['status'] == 200 and fbl and fbl[-1]['fb'][1] == 'pro', (fb, fbl[-1:] if fbl else None))

    # ---- B) objednavka ---------------------------------------------------------
    base_rules()
    o = call('POST', '/objednavky', {'produkt': 'rok'}, AUTH)
    ok('B1 bez PRODEJ_IBAN je prodej vypnuty (503)', o['status'] == 503, o)
    base_rules()
    rule('/SELECT \\* FROM orders WHERE vs=\\?/', 'function(a){ return { first: { vs: a[0], acc_id: "acc1", code: "K7QM3XP2", amount: 990, dni: 365, created: Date.now(), paid_ts: null, cancelled: 0 } }; }')
    o = call('POST', '/objednavky', {'produkt': 'rok'}, AUTH, IBAN)
    ok('B2 objednavka zalozena (200)', o['status'] == 200, o)
    ob = (o['data'] or {}).get('objednavka') or {}
    vs = ob.get('vs')
    ok('B3 VS ma 8 cislic', isinstance(vs, int) and 10000000 <= vs <= 99999999, vs)
    ok('B4 SPAYD nese IBAN, castku, VS i zpravu', ob.get('spayd', '').startswith('SPD*1.0*ACC:CZ6508000000192000145399*AM:990.00*CC:CZK*X-VS:%s*MSG:QTRIG PRO K7QM3XP2' % vs), ob.get('spayd'))
    pr = (o['data'] or {}).get('prodej') or {}
    ok('B5 cenik: mesic 149 + rok 990', [(p['k'], p['cena'], p['dni']) for p in pr.get('produkty', [])] == [('mesic', 149, 30), ('rok', 990, 365)], pr.get('produkty'))
    ok('B6 zkouska 3 dny, nepouzita', pr.get('zkouska') == {'dni': 3, 'pouzita': False, 'kdy': 0}, pr.get('zkouska'))
    ok('B7 stav ceka, msg s kodem uctu', ob.get('stav') == 'ceka' and ob.get('msg') == 'QTRIG PRO K7QM3XP2', ob)
    ins = [l for l in log() if l['sql'].startswith('INSERT INTO orders')]
    ok('B8 INSERT INTO orders s castkou 990 a 365 dny', len(ins) == 1 and ins[0]['args'][3] == 990 and ins[0]['args'][4] == 365, ins and ins[0]['args'])

    # ---- C) jiny produkt zrusi starou -------------------------------------------
    base_rules()
    rule('/SELECT \\* FROM orders WHERE acc_id=\\? AND paid_ts IS NULL AND cancelled=0/', 'function(){ return { first: { vs: 11111111, acc_id: "acc1", code: "K7QM3XP2", amount: 990, dni: 365, created: 1, paid_ts: null, cancelled: 0 } }; }')
    rule('/SELECT \\* FROM orders WHERE vs=\\?/', 'function(a){ return { first: { vs: a[0], acc_id: "acc1", code: "K7QM3XP2", amount: 149, dni: 30, created: Date.now(), paid_ts: null, cancelled: 0 } }; }')
    o = call('POST', '/objednavky', {'produkt': 'mesic'}, AUTH, IBAN)
    L = log()
    zrus = [l for l in L if l['sql'].startswith('UPDATE orders SET cancelled=1')]
    ins = [l for l in L if l['sql'].startswith('INSERT INTO orders')]
    ok('C1 stara rocni objednavka zrusena', len(zrus) == 1 and zrus[0]['args'] == [11111111], zrus)
    ok('C2 nova mesicni zalozena (149 Kc / 30 dni)', len(ins) == 1 and ins[0]['args'][3] == 149 and ins[0]['args'][4] == 30, ins and ins[0]['args'])
    ok('C3 odpoved nese novou castku', (o['data'].get('objednavka') or {}).get('castka') == 149, o['data'])
    base_rules()
    rule('/SELECT \\* FROM orders WHERE acc_id=\\? AND paid_ts IS NULL AND cancelled=0/', 'function(){ return { first: { vs: 22222222, acc_id: "acc1", code: "K7QM3XP2", amount: 990, dni: 365, created: 1, paid_ts: null, cancelled: 0 } }; }')
    o = call('POST', '/objednavky', {'produkt': 'rok'}, AUTH, IBAN)
    ins = [l for l in log() if l['sql'].startswith('INSERT INTO orders')]
    ok('C4 stejny produkt = tataz objednavka (zadny INSERT, tyz VS)', not ins and (o['data'].get('objednavka') or {}).get('vs') == 22222222, o['data'])

    # ---- D) zkouska -------------------------------------------------------------
    base_rules()
    z = call('POST', '/zkouska', {}, AUTH)
    ok('D1 zkouska zapnuta (200, tarif pro)', z['status'] == 200 and z['data'].get('tarif') == 'pro', z)
    L = log()
    tr = [l for l in L if 'SET trial_ts=?' in l['sql']]
    up = [l for l in L if l['sql'].startswith('UPDATE accounts SET tarif=?, tarif_do=?')]
    ok('D2 zapsano trial_ts', len(tr) == 1, tr)
    ok('D3 Pro na 3 dny (tarif_do ~ +3 d)', len(up) == 1 and up[0]['args'][0] == 'pro' and abs(up[0]['args'][1] - (r.eval('Date.now()') + 3 * DEN)) < 60e3, up and up[0]['args'])
    base_rules(acc={'trial_ts': 123})
    z = call('POST', '/zkouska', {}, AUTH)
    ok('D4 podruhe 409', z['status'] == 409, z)
    base_rules()
    rule('/UPDATE accounts SET trial_ts=\\?/', 'function(){ return { run: { changes: 0 } }; }')
    z = call('POST', '/zkouska', {}, AUTH)
    ok('D5 zavod dvou klepnuti: bez zmeny radku 409, Pro se nezapne', z['status'] == 409 and not [l for l in log() if l['sql'].startswith('UPDATE accounts SET tarif=?')], z)

    # ---- E) rucni zaplaceno -----------------------------------------------------
    def order_rule(amount, paid=None, cancelled=0):
        rule('/SELECT \\* FROM orders WHERE vs=\\?/', 'function(a){ return { first: { vs: a[0], acc_id: "acc1", code: "K7QM3XP2", amount: %d, dni: %d, created: 1, paid_ts: %s, cancelled: %d } }; }' % (amount, 365 if amount >= 990 else 30, 'null' if paid is None else paid, cancelled))
    base_rules(); order_rule(990)
    e = call('POST', '/owner/objednavky/12345678/zaplaceno', {}, OWN)
    ok('E1 rocni objednavka -> 200', e['status'] == 200, e)
    L = log()
    upo = [l for l in L if l['sql'].startswith('UPDATE orders SET paid_ts=?')]
    up = [l for l in L if l['sql'].startswith('UPDATE accounts SET tarif=?, tarif_do=?')]
    ok('E2 objednavka oznacena (vlastnik, 990, 365 dni)', len(upo) == 1 and upo[0]['args'][1] == 'vlastnik' and upo[0]['args'][2] == 990 and upo[0]['args'][4] == 365, upo and upo[0]['args'])
    ok('E3 Pro na 365 dni', len(up) == 1 and abs(up[0]['args'][1] - (r.eval('Date.now()') + 365 * DEN)) < 60e3, up and up[0]['args'])
    base_rules(); order_rule(149)
    e = call('POST', '/owner/objednavky/12345678/zaplaceno', {}, OWN)
    up = [l for l in log() if l['sql'].startswith('UPDATE accounts SET tarif=?, tarif_do=?')]
    ok('E4 mesicni castka = 30 dni', e['status'] == 200 and len(up) == 1 and abs(up[0]['args'][1] - (r.eval('Date.now()') + 30 * DEN)) < 60e3, up and up[0]['args'])
    konec = r.eval('Date.now()') + 10 * DEN
    base_rules(acc={'tarif': 'pro', 'tarif_do': konec}); order_rule(990)
    e = call('POST', '/owner/objednavky/12345678/zaplaceno', {}, OWN)
    up = [l for l in log() if l['sql'].startswith('UPDATE accounts SET tarif=?, tarif_do=?')]
    ok('E5 prodlouzeni se pocita od konce beziciho Pro (+10 d +365 d)', len(up) == 1 and abs(up[0]['args'][1] - (konec + 365 * DEN)) < 60e3, up and up[0]['args'])
    base_rules(); order_rule(990, paid=555)
    e = call('POST', '/owner/objednavky/12345678/zaplaceno', {}, OWN)
    ok('E6 uz zaplacena -> 409, Pro se nezapne podruhe', e['status'] == 409 and not [l for l in log() if l['sql'].startswith('UPDATE accounts SET tarif=?')], e)
    base_rules(); order_rule(990)
    rule('/UPDATE orders SET paid_ts=\\?/', 'function(){ return { run: { changes: 0 } }; }')
    e = call('POST', '/owner/objednavky/12345678/zaplaceno', {}, OWN)
    ok('E7 zavod: UPDATE bez zmeny radku = zadne Pro', e['status'] == 409 and not [l for l in log() if l['sql'].startswith('UPDATE accounts SET tarif=?')], e)
    e = call('POST', '/owner/objednavky/12345678/zaplaceno', {}, {'X-Owner-Key': 'spatny'})
    ok('E8 bez klice vlastnika 403', e['status'] == 403, e)
    base_rules(); order_rule(990)
    e = call('POST', '/owner/objednavky/12345678/zaplaceno', {'castka': 100}, OWN)
    ok('E9 castka pod mesic -> 409 (podplaceno)', e['status'] == 409, e)

    # ---- F) blokace -------------------------------------------------------------
    base_rules()
    f = call('POST', '/owner/blokace', {'code': 'K7QM3XP2', 'disabled': 1}, OWN)
    L = log()
    ok('F1 blokace 200', f['status'] == 200, f)
    ok('F2 disabled=1 v accounts i users', any(l['sql'].startswith('UPDATE accounts SET disabled=?') and l['args'][0] == 1 for l in L)
       and any(l['sql'].startswith('UPDATE users SET disabled=?') and l['args'][0] == 1 for l in L), [l['sql'] for l in L if 'disabled' in l['sql']])
    base_rules(acc={'disabled': 1})
    g = call('GET', '/objednavky/moje', None, AUTH)
    ok('F3 zablokovany ucet dostane 401 hned (auth cte ucet z DB)', g['status'] == 401, g)

    # ---- G) Fio cron ------------------------------------------------------------
    def fio_env():
        return "ENV({PRODEJ_IBAN:'CZ6508000000192000145399', FIO_TOKEN:'tok'})"
    tx = {'accountStatement': {'transactionList': {'transaction': [
        {'column22': {'value': 100}, 'column0': {'value': '2026-09-11+0200'}, 'column1': {'value': 990.0}, 'column14': {'value': 'CZK'},
         'column5': {'value': '12345678'}, 'column16': {'value': 'QTRIG PRO K7QM3XP2'}, 'column10': {'value': 'Jan Novak'}},
        {'column22': {'value': 101}, 'column0': {'value': '2026-09-11+0200'}, 'column1': {'value': 500.0}, 'column14': {'value': 'CZK'},
         'column5': {'value': ''}, 'column16': {'value': 'nic'}, 'column10': {'value': 'Nekdo'}},
        {'column22': {'value': 102}, 'column0': {'value': '2026-09-11+0200'}, 'column1': {'value': -300.0}, 'column14': {'value': 'CZK'}}
    ]}}}
    r.eval('FETCH_REPLY = %s' % json.dumps({'status': 200, 'body': tx}))
    base_rules(); order_rule(990)
    rule('/SELECT v FROM fio_stav WHERE k=\\?/', 'function(){ return { first: null }; }')
    rule('/SELECT id FROM fio_pohyby WHERE id=\\?/', 'function(){ return { first: null }; }')
    r.eval('CRON(%s)' % fio_env()); cr = json.loads(r.eval('JSON.stringify(OUT)') or 'null')
    ok('G1 cron dobehl', cr and cr.get('ok'), cr)
    L = log()
    ok('G2 dotaz na Fio za posledni tyden (periods)', any('fioapi.fio.cz/v1/rest/periods/tok/' in u for u in json.loads(r.eval('JSON.stringify(FETCH_LOG)'))))
    up = [l for l in L if l['sql'].startswith('UPDATE accounts SET tarif=?, tarif_do=?')]
    ok('G3 platba s VS spojena s objednavkou -> Pro na rok', len(up) == 1 and abs(up[0]['args'][1] - (r.eval('Date.now()') + 365 * DEN)) < 60e3, up and up[0]['args'])
    poh = [l for l in L if l['sql'].startswith('INSERT OR IGNORE INTO fio_pohyby')]
    stavy = dict((p['args'][0], p['args'][8]) for p in poh)
    ok('G4 pohyby zapsane: 100 sparovano, 101 nezarazeno, odchozi 102 ignorovan', stavy == {'100': 'sparovano', '101': 'nezarazeno'}, stavy)
    base_rules(); order_rule(990)
    rule('/SELECT v FROM fio_stav WHERE k=\\?/', 'function(a){ return { first: a[0] === "posledni_dotaz" ? { v: String(Date.now() - 5000) } : null }; }')
    r.eval('FETCH_LOG.length = 0'); r.eval('CRON(%s)' % fio_env())
    ok('G5 druhy dotaz do 30 s se do banky nepusti', not json.loads(r.eval('JSON.stringify(FETCH_LOG)')), r.eval('JSON.stringify(FETCH_LOG)'))
    base_rules(); order_rule(990)
    rule('/SELECT v FROM fio_stav WHERE k=\\?/', 'function(){ return { first: null }; }')
    rule('/SELECT id FROM fio_pohyby WHERE id=\\?/', 'function(a){ return { first: { id: a[0] } }; }')
    r.eval('CRON(%s)' % fio_env())
    ok('G6 uz videny pohyb se nezpracuje podruhe', not [l for l in log() if l['sql'].startswith('UPDATE accounts SET tarif=?')])
    base_rules(); order_rule(990)
    rule('/SELECT v FROM fio_stav WHERE k=\\?/', 'function(){ return { first: null }; }')
    rule('/SELECT id FROM fio_pohyby WHERE id=\\?/', 'function(){ return { first: null }; }')
    r.eval('CRON(ENV({PRODEJ_IBAN:"CZ6508000000192000145399"}))')
    ok('G7 bez FIO_TOKEN cron nic nedela', not [l for l in log() if 'fio' in l['sql'].lower()])
    # platba bez VS, ale s kodem uctu ve zprave, bez otevrene objednavky -> zalozi a zaplati
    tx2 = {'accountStatement': {'transactionList': {'transaction': [
        {'column22': {'value': 200}, 'column0': {'value': '2026-09-11+0200'}, 'column1': {'value': 149.0}, 'column14': {'value': 'CZK'},
         'column5': {'value': ''}, 'column16': {'value': 'pro qtrig k7qm3xp2 diky'}, 'column10': {'value': 'Jan Novak'}}]}}}
    r.eval('FETCH_REPLY = %s' % json.dumps({'status': 200, 'body': tx2}))
    base_rules()
    rule('/SELECT v FROM fio_stav WHERE k=\\?/', 'function(){ return { first: null }; }')
    rule('/SELECT id FROM fio_pohyby WHERE id=\\?/', 'function(){ return { first: null }; }')
    rule('/SELECT \\* FROM orders WHERE vs=\\?/', 'function(a){ return { first: { vs: a[0], acc_id: "acc1", code: "K7QM3XP2", amount: 149, dni: 30, created: 1, paid_ts: null, cancelled: 0 } }; }')
    r.eval('CRON(%s)' % fio_env())
    L = log()
    ins = [l for l in L if l['sql'].startswith('INSERT INTO orders')]
    up = [l for l in L if l['sql'].startswith('UPDATE accounts SET tarif=?, tarif_do=?')]
    ok('G8 kod uctu ve zprave bez VS: objednavka vznikne sama a Pro na mesic', len(ins) == 1 and ins[0]['args'][4] == 30 and len(up) == 1 and abs(up[0]['args'][1] - (r.eval('Date.now()') + 30 * DEN)) < 60e3, (ins and ins[0]['args'], up and up[0]['args']))

    # ---- H) /objednavky neni placena cesta --------------------------------------
    src_txt = io.open(W, encoding='utf-8').read()
    import re
    m = re.search(r'const PLACENE_CESTY = \[(.*?)\];', src_txt, re.S)
    placene = re.findall(r"'([^']+)'", m.group(1)) if m else []
    ok('H1 /objednavky ani /zkouska nejsou v PLACENE_CESTY', '/objednavky' not in placene and '/zkouska' not in placene, placene)
    base_rules()
    g = call('GET', '/objednavky/moje', None, AUTH, IBAN)
    ok('H2 ucet se Zakladem cte sve objednavky (200)', g['status'] == 200 and 'prodej' in (g['data'] or {}), g)

    # ---- I) /owner/ucty ---------------------------------------------------------
    base_rules()
    rule('/FROM accounts ORDER BY created DESC LIMIT 200/', 'function(){ return { all: [%s] }; }' % json.dumps(ACC))
    rule('/FROM users u JOIN firms f ON f\\.id=u\\.firm_id WHERE u\\.acc_id IN/', 'function(){ return { all: [{ acc_id: "acc1", role: "admin", own: 0, left_ts: null, disabled: 0, last_login: 5, nazev: "Geo s.r.o.", kod: "ABCDEF", lidi: 3 }] }; }')
    rule('/FROM usage g JOIN users u ON u\\.id=g\\.uid/', 'function(){ return { all: [{ acc_id: "acc1", ts: 777, n: 12 }] }; }')
    rule('/FROM orders WHERE acc_id IN/', 'function(){ return { all: [{ acc_id: "acc1", n: 2, zaplaceno: 1, ceka: 1 }] }; }')
    u = call('GET', '/owner/ucty', None, OWN)
    row = ((u['data'] or {}).get('ucty') or [None])[0] or {}
    ok('I1 /owner/ucty 200 s radkem uctu', u['status'] == 200 and row.get('code') == 'K7QM3XP2', u)
    ok('I2 prostory (firma, role, lidi)', row.get('prostory') == [{'nazev': 'Geo s.r.o.', 'kod': 'ABCDEF', 'role': 'admin', 'vlastni': False, 'archiv': False, 'lidi': 3, 'lastLogin': 5}], row.get('prostory'))
    ok('I3 aktivita = max(usage, last_login), akce za 30 d', row.get('aktivita') == 777 and row.get('akcí30d') == 12, (row.get('aktivita'), row.get('akcí30d')))
    ok('I4 objednavky u uctu', row.get('objednavky') == {'n': 2, 'zaplaceno': 1, 'ceka': 1}, row.get('objednavky'))
    ok('I5 odpoved nese cenik pro konzoli', ((u['data'] or {}).get('prodej') or {}).get('produkty') is not None)

    return vypis()


def vypis():
    chyb = [j for (o_, j) in vysledky if not o_]
    print('\n%d/%d OK' % (len(vysledky) - len(chyb), len(vysledky)))
    if chyb:
        print('CHYBA: ' + '; '.join(chyb))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
