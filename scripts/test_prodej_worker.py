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
#   A) /health hlasi v:20, prodej:true a stav klice vlastnika (ownerKey)
#   J) brzda vydani: GET /vydano (verejne) null -> POST /owner/vydat 296 -> 296; bez klice 403
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
#   K) X-AG-Ver/X-AG-Dev -> accounts.ver/dev (1x za hodinu); GET/POST /account/contact;
#      /owner/ucty nese ver, dev, contact (13. 9. 2026)
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
    deriveBits: function (alg) { var n = (alg && alg.name === 'ECDH') ? 32 : 32; return Promise.resolve(new Uint8Array(n).buffer); },
    // Web Push (13. 9. 2026): klice VAPID + ECDH + AES-GCM jen naoko — testuje se tok, ne kryptografie
    generateKey: function () { return Promise.resolve({ publicKey: { k: 'pub' }, privateKey: { k: 'priv' } }); },
    exportKey: function (fmt, key) { if (fmt === 'jwk') return Promise.resolve({ kty: 'EC', crv: 'P-256', x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', y: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }); return Promise.resolve(new Uint8Array(65).buffer); },
    encrypt: function (alg, key, data) { return Promise.resolve(new Uint8Array(new Uint8Array(data).length + 16).buffer); }
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
    ok('A1 /health v:20', h['data'].get('v') == 20, h['data'].get('v'))
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
    # data firmy ke stazeni do vlastni appky (12. 9. 2026): jobs + zive body ze sync_points
    rule(r'/SELECT id, code, name FROM firms WHERE id=\?/', 'function(a){ return { first: a[0] === "f1" ? { id: "f1", code: "ABCDEF", name: "Geo s.r.o." } : null }; }')
    rule(r'/SELECT job_key, name, deleted FROM jobs WHERE firm_id=\?/', 'function(){ return { all: [{ job_key: "pole", name: "Pole u lesa", deleted: 0 }, { job_key: "stara", name: "Stara", deleted: 1 }] }; }')
    rule(r'/FROM sync_points WHERE firm_id=\? AND deleted=0/', 'function(){ return { all: [{ job_key: "pole", point_id: "cp_1", data: JSON.stringify({ name: "101", lat: 50.1, lng: 14.4, kod: "obruba" }), ts: 5, uname: "Jan" }, { job_key: "bezjmena", point_id: "cp_2", data: JSON.stringify({ name: "7", lat: 50.2, lng: 14.5 }), ts: 6, uname: null }, { job_key: "pole", point_id: "cp_x", data: "{rozbite", ts: 7, uname: null }] }; }')
    fd = call('GET', '/owner/firms/f1/data', headers=OWN)
    jobs = { j['key']: j for j in (fd['data'].get('jobs') or []) }
    ok('A9 GET /owner/firms/:id/data vraci firmu, zakazky a body (rozbity JSON se preskoci, smazana zakazka bez bodu se nevypisuje)',
       fd['status'] == 200 and fd['data'].get('firm', {}).get('code') == 'ABCDEF' and set(jobs) == {'pole', 'bezjmena'}
       and jobs['pole']['name'] == 'Pole u lesa' and len(jobs['pole']['points']) == 1 and jobs['pole']['points'][0]['id'] == 'cp_1'
       and jobs['pole']['points'][0]['uname'] == 'Jan' and jobs['bezjmena']['name'] == 'bezjmena', fd)
    ok('A10 /owner/firms/neznama/data -> 404', call('GET', '/owner/firms/neni/data', headers=OWN)['status'] == 404)

    # ---- V) VLASTNIK PLUS (12. 9. 2026, 13 schvalenych navrhu) ------------------
    rule(r'/COUNT\(\*\) AS n FROM feedback WHERE done=0 AND kind=\'pro\'/', 'function(){ return { first: { n: 2 } }; }')
    rule(r'/COUNT\(\*\) AS n FROM feedback WHERE done=0 AND kind!=\'pro\'/', 'function(){ return { first: { n: 3 } }; }')
    rule(r'/COUNT\(DISTINCT uid\) AS n FROM usage/', 'function(){ return { first: { n: 4 } }; }')
    rule(r'/COUNT\(\*\) AS n FROM sync_points WHERE srv>=/', 'function(){ return { first: { n: 40 } }; }')
    rule(r'/SELECT data FROM sync_points WHERE srv>=/', 'function(){ return { all: [{ data: JSON.stringify({ lat: 50.011, lng: 14.402 }) }, { data: JSON.stringify({ lat: 50.012, lng: 14.403 }) }, { data: JSON.stringify({ lat: 49.2, lng: 16.6 }) }, { data: "{x" }] }; }')
    rule(r'/FROM usage u LEFT JOIN firms f/', 'function(){ return { all: [{ uid: "u1", uname: "Jan", firm_id: "f1", ts: Date.now() - 60000, n: 5, firma: "Geo s.r.o." }] }; }')
    rule(r'/FROM accounts WHERE tarif=\'pro\' AND tarif_do>\? AND tarif_do<=\?/', 'function(){ return { all: [{ id: "acc9", code: "AAAA9999", name: "Eva", tarif_do: Date.now() + 3 * 864e5 }] }; }')
    lite = call('GET', '/owner/prehled?lite=1', headers=OWN)
    ok('V1 /owner/prehled?lite=1 = jen zadosti a zpravy (tecka na vstupech)', lite['status'] == 200 and lite['data'].get('zadosti') == 2 and lite['data'].get('zpravy') == 3 and 'lidi24' not in lite['data'], lite)
    pr = call('GET', '/owner/prehled', headers=OWN)
    ok('V2 /owner/prehled: souhrn 24 h, kdo je v terenu, shluky (rozbity JSON preskocen), vyprsi',
       pr['status'] == 200 and pr['data'].get('lidi24') == 4 and pr['data'].get('body24') == 40 and len(pr['data'].get('online') or []) == 1
       and len(pr['data'].get('shluky') or []) == 2 and sum(x['n'] for x in pr['data']['shluky']) == 3 and (pr['data'].get('vyprsi') or [{}])[0].get('code') == 'AAAA9999', pr)
    # denik: tarif zapise radek do owner_log
    r.eval('LOG.length = 0')
    call('POST', '/owner/tarif', body={'id': 'acc1', 'tarif': 'pro', 'dni': 14}, headers=OWN)
    logs = [l for l in log() if l.get('op') == 'run' and 'INSERT INTO owner_log' in (l.get('sql') or '')]
    ok('V3 zapnuti Pro zapise do deniku vlastnika (akce pro-zapnout, 14 dni)', logs and logs[-1]['args'][1] == 'pro-zapnout' and '14' in str(logs[-1]['args'][3]), logs[-1:] if logs else log()[-3:])
    rule(r'/FROM owner_log ORDER BY id DESC/', 'function(){ return { all: [{ id: 5, ts: 1, akce: "pro-zapnout", cil: "K7QM3XP2 Jan", detail: "14 dní" }] }; }')
    lg = call('GET', '/owner/log', headers=OWN)
    ok('V4 GET /owner/log vraci radky deniku', lg['status'] == 200 and (lg['data'].get('rows') or [{}])[0].get('akce') == 'pro-zapnout', lg)
    # vzkaz
    r.eval('LOG.length = 0')
    vz = call('POST', '/owner/vzkaz', body={'acc_id': 'acc1', 'txt': 'Pro máš na 14 dní.'}, headers=OWN)
    ins = [l for l in log() if l.get('op') == 'run' and 'INSERT INTO vzkazy' in (l.get('sql') or '')]
    ok('V5 POST /owner/vzkaz ulozi vzkaz uctu', vz['status'] == 200 and ins and ins[-1]['args'][1] == 'acc1' and ins[-1]['args'][3] == 'Pro máš na 14 dní.', (vz, ins[-1:] if ins else None))
    ok('V6 vzkaz bez prijemce -> 400', call('POST', '/owner/vzkaz', body={'txt': 'x'}, headers=OWN)['status'] == 400)
    # /config nese nepřečtené vzkazy prihlaseneho; precteno je oznaci
    rule(r'/FROM vzkazy WHERE read_ts IS NULL/', 'function(a){ return { all: a[0] === "acc1" ? [{ id: 7, ts: 1, txt: "Ahoj", acc_id: "acc1", firm_id: null }] : [] }; }')
    cfg = call('GET', '/config', headers=AUTH)
    ok('V7 /config prinese vzkazy pro ucet (komu: ty)', cfg['status'] == 200 and (cfg['data'].get('vzkazy') or [{}])[0].get('txt') == 'Ahoj' and cfg['data']['vzkazy'][0].get('komu') == 'ty', cfg['data'].get('vzkazy'))
    r.eval('LOG.length = 0')
    pc = call('POST', '/vzkaz/precteno', body={'id': 7}, headers=AUTH)
    upd = [l for l in log() if l.get('op') == 'run' and 'UPDATE vzkazy SET read_ts' in (l.get('sql') or '')]
    ok('V8 POST /vzkaz/precteno oznaci JEN svuj vzkaz (acc_id/firm_id v dotazu)', pc['status'] == 200 and upd and upd[-1]['args'][1] == 7 and upd[-1]['args'][2] == 'acc1', upd[-1:] if upd else log()[-2:])
    # poznamka
    r.eval('LOG.length = 0')
    pz = call('POST', '/owner/ucty/acc1/pozn', body={'note': 'volat v pátek'}, headers=OWN)
    up2 = [l for l in log() if l.get('op') == 'run' and 'UPDATE accounts SET note' in (l.get('sql') or '')]
    ok('V9 POST /owner/ucty/:id/pozn ulozi poznamku', pz['status'] == 200 and pz['data'].get('note') == 'volat v pátek' and up2 and up2[-1]['args'] == ['volat v pátek', 'acc1'], (pz, up2[-1:] if up2 else None))
    # pohled ocima uctu
    rule(r'/SELECT id, code, name, tarif, tarif_do, disabled, created, last_login, note FROM accounts WHERE id=\?/', 'function(a){ return { first: a[0] === "acc1" ? { id: "acc1", code: "K7QM3XP2", name: "Jan", tarif: "zaklad", tarif_do: null, disabled: 0, created: 1, last_login: 2, note: "volat" } : null }; }')
    rule(r'/FROM users u JOIN firms f ON f\.id=u\.firm_id WHERE u\.acc_id=\?/', 'function(){ return { all: [{ uid: "u1", role: "admin", own: 0, left_ts: null, disabled: 0, last_login: 2, firm_id: "f1", name: "Geo s.r.o.", code: "ABCDEF", perms: "{}", frozen: 0 }] }; }')
    rule(r'/FROM usage WHERE uid IN/', 'function(){ return { all: [{ k: "openMeasureModal", n: 9, last: 5 }] }; }')
    po = call('GET', '/owner/ucty/acc1/pohled', headers=OWN)
    ok('V10 GET /owner/ucty/:id/pohled: ucet, clenstvi, nastroje', po['status'] == 200 and po['data']['ucet']['code'] == 'K7QM3XP2' and po['data']['clenstvi'][0]['nazev'] == 'Geo s.r.o.' and po['data']['nastroje'][0]['k'] == 'openMeasureModal', po)
    ok('V11 pohled neznameho uctu -> 404', call('GET', '/owner/ucty/nikdo/pohled', headers=OWN)['status'] == 404)
    # zaloha: tabulky bez hesel
    rule(r'/FROM accounts$/', 'function(){ return { all: [{ id: "acc1", code: "K7QM3XP2", name: "Jan", tarif: "zaklad" }] }; }')
    ex = call('GET', '/owner/export', headers=OWN)
    tb = (ex['data'] or {}).get('tabulky') or {}
    ok('V12 GET /owner/export vraci vsechny tabulky, ucty bez hesel', ex['status'] == 200 and set(['firms', 'users', 'accounts', 'jobs', 'sync_points', 'feedback', 'orders', 'vzkazy', 'owner_log', 'meta']) <= set(tb) and all('pass_hash' not in x for x in tb.get('accounts', [])), sorted(tb))
    ok('V13 /owner/prehled bez klice -> 403', call('GET', '/owner/prehled', headers={'X-Owner-Key': 'spatny-klic-aspon-24-znaku-xx'})['status'] == 403)
    # errors: souhrn podle verze
    rule(r'/FROM errors WHERE ts>=\? GROUP BY ver/', 'function(){ return { all: [{ ver: "v290", n: 12, sigs: 3, firms: 2 }] }; }')
    er = call('GET', '/owner/errors', headers=OWN)
    ok('V14 /owner/errors nese souhrn podle verze appky', er['status'] == 200 and (er['data'].get('verze') or [{}])[0].get('ver') == 'v290', er['data'])

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
    # (fio_stav cte i hlidac vlny chyb z cronu — 13. 9. 2026 — ten s bankou nesouvisi)
    ok('G7 bez FIO_TOKEN cron nic nedela', not [l for l in log() if 'fio' in l['sql'].lower() and 'fio_stav' not in l['sql'].lower()])
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

    # ---- J) brzda vydani (12. 9. 2026) -----------------------------------------
    # Vlastnik vyviji a testuje, lidem venku se nova verze instaluje az po „pustit".
    # Server drzi jen cislo verze v k/v tabulce fio_stav pod klicem 'vydano'.
    base_rules()
    r.eval('globalThis.VYD = null;')
    rule('/SELECT v FROM fio_stav WHERE k=\?/', 'function(a){ return { first: (a[0] === "vydano" && VYD) ? { v: VYD } : null }; }')
    rule('/INSERT OR REPLACE INTO fio_stav/', 'function(a){ if (a[0] === "vydano") VYD = a[1]; return { run: true }; }')
    v0 = call('GET', '/vydano')
    ok('J1 GET /vydano je verejne a bez brzdy vraci verze:null', v0['status'] == 200 and v0['data'].get('verze') is None, v0)
    v1 = call('POST', '/owner/vydat', {'verze': 296, 'pozn': 'karta bodu'}, headers=OWN)
    ok('J2 POST /owner/vydat zapise verzi', v1['status'] == 200 and v1['data'].get('verze') == 296 and v1['data'].get('pozn') == 'karta bodu', v1)
    v2 = call('GET', '/vydano')
    ok('J3 GET /vydano pak vraci 296 (to cte sw.js pred instalaci)', v2['data'].get('verze') == 296 and v2['data'].get('ts'), v2)
    v3 = call('POST', '/owner/vydat', {'verze': 297})
    ok('J4 bez klice vlastnika 403', v3['status'] in (401, 403), v3['status'])
    v4 = call('POST', '/owner/vydat', {'verze': 'abc'}, headers=OWN)
    ok('J5 nesmyslna verze 400', v4['status'] == 400, v4)
    v5 = call('POST', '/owner/vydat', {'verze': None}, headers=OWN)
    ok('J6 verze:null brzdu vypne', v5['status'] == 200 and v5['data'].get('verze') is None and call('GET', '/vydano')['data'].get('verze') is None, v5)
    lg = [l for l in log() if 'owner_log' in l.get('sql', '') and 'INSERT' in l.get('sql', '')]
    ok('J7 vydani se zapisuje do deniku vlastnika', any(x.get('args', [None, None])[1] == 'vydani' for x in lg), [x.get('args') for x in lg][:3])

    # ---- K) verze appky u uctu + kontakt (13. 9. 2026, navrhy pred betou) --------
    # Appka posila X-AG-Ver / X-AG-Dev s kazdym dotazem; server je zapise k uctu
    # (nejvys 1x za hodinu), konzole vlastnika pak vidi, kdo jede na stare verzi.
    base_rules()
    r.eval('LOG.length = 0')
    rule('/UPDATE accounts SET ver=\?, ver_ts=\?, dev=\? WHERE id=\?/', 'function(a){ LOG.push({ ver: a }); return { run: 1 }; }')
    rule('/SELECT contact FROM accounts WHERE id=\?/', 'function(){ return { first: { contact: null } }; }')
    k1 = call('GET', '/account/contact', headers=dict(AUTH, **{'X-AG-Ver': 'v301', 'X-AG-Dev': 'iOS 18.6 PWA'}))
    vl = [l for l in log() if l.get('ver')]
    ok('K1 hlavicka X-AG-Ver zapise verzi a telefon k uctu', vl and vl[-1]['ver'][0] == 'v301' and vl[-1]['ver'][2] == 'iOS 18.6 PWA' and vl[-1]['ver'][3] == 'acc1', vl[-1:] if vl else log()[-3:])
    r.eval('LOG.length = 0')
    base_rules(acc={'ver': 'v301', 'dev': 'iOS 18.6 PWA', 'ver_ts': 10**14})
    rule('/UPDATE accounts SET ver=\?, ver_ts=\?, dev=\? WHERE id=\?/', 'function(a){ LOG.push({ ver: a }); return { run: 1 }; }')
    rule('/SELECT contact FROM accounts WHERE id=\?/', 'function(){ return { first: { contact: null } }; }')
    call('GET', '/account/contact', headers=dict(AUTH, **{'X-AG-Ver': 'v301', 'X-AG-Dev': 'iOS 18.6 PWA'}))
    ok('K2 stejna verze do hodiny se znovu nezapisuje', not [l for l in log() if l.get('ver')], log()[-2:])
    call('GET', '/account/contact', headers=AUTH)
    ok('K3 bez hlavicky se nic nezapisuje', not [l for l in log() if l.get('ver')])
    base_rules()
    rule('/SELECT contact FROM accounts WHERE id=\?/', 'function(a){ return { first: a[0] === "acc1" ? { contact: "+420 777 123 456" } : null }; }')
    rule('/UPDATE accounts SET contact=\? WHERE id=\?/', 'function(a){ LOG.push({ kontakt: a }); return { run: 1 }; }')
    kc = call('GET', '/account/contact', headers=AUTH)
    ok('K4 GET /account/contact vraci kontakt uctu', kc['status'] == 200 and kc['data'].get('contact') == '+420 777 123 456', kc)
    kp = call('POST', '/account/contact', body={'contact': '  jan@firma.cz '}, headers=AUTH)
    kl = [l for l in log() if l.get('kontakt')]
    ok('K5 POST /account/contact ulozi orezany kontakt', kp['status'] == 200 and kl and kl[-1]['kontakt'] == ['jan@firma.cz', 'acc1'], (kp, kl[-1:]))
    kp2 = call('POST', '/account/contact', body={'contact': ''}, headers=AUTH)
    kl = [l for l in log() if l.get('kontakt')]
    ok('K6 prazdny kontakt = NULL (smazani)', kp2['status'] == 200 and kl[-1]['kontakt'] == [None, 'acc1'], kl[-1:])
    ok('K7 bez prihlaseni 401', call('GET', '/account/contact')['status'] == 401)
    rule('/FROM accounts ORDER BY created DESC LIMIT 200/', 'function(){ return { all: [%s] }; }' % json.dumps(dict(ACC, ver='v299', ver_ts=5, dev='Android 14', contact='jan@firma.cz')))
    rule('/FROM users u JOIN firms f ON f\.id=u\.firm_id WHERE u\.acc_id IN/', 'function(){ return { all: [] }; }')
    rule('/FROM usage g JOIN users u ON u\.id=g\.uid/', 'function(){ return { all: [] }; }')
    rule('/FROM orders WHERE acc_id IN/', 'function(){ return { all: [] }; }')
    ou = call('GET', '/owner/ucty', None, OWN)
    row = ((ou['data'] or {}).get('ucty') or [None])[0] or {}
    ok('K8 /owner/ucty nese ver, dev a kontakt', row.get('ver') == 'v299' and row.get('dev') == 'Android 14' and row.get('contact') == 'jan@firma.cz', row)

    # ---- L) grafy vlastnika (13. 9. 2026) ---------------------------------------
    base_rules()
    rule('/SELECT day, n FROM stats WHERE day>=/', 'function(){ return { all: [{ day: "2026-09-12", n: 40 }, { day: "2026-09-13", n: 55 }] }; }')
    rule('/COUNT\(DISTINCT uid\) AS n FROM usage WHERE ts>=\? GROUP BY day/', 'function(){ return { all: [{ day: "2026-09-13", n: 3 }] }; }')
    rule('/SELECT ver, COUNT\(\*\) AS n FROM accounts GROUP BY ver/', 'function(){ return { all: [{ ver: "v302", n: 4 }, { ver: null, n: 2 }] }; }')
    rule('/SELECT k, COUNT\(\*\) AS n FROM usage WHERE ts>=/', 'function(){ return { all: [{ k: "openMeasureModal", n: 12 }] }; }')
    rule('/SELECT COUNT\(\*\) AS n FROM accounts$/', 'function(){ return { first: { n: 6 } }; }')
    gr = call('GET', '/owner/grafy', headers=OWN)
    ok('L1 GET /owner/grafy vraci denni rady, verze a nastroje', gr['status'] == 200 and gr['data'].get('dotazy') and gr['data']['dotazy'][1]['n'] == 55 and gr['data']['lide'][0]['n'] == 3 and gr['data']['verze'][0]['ver'] == 'v302' and gr['data']['nastroje'][0]['k'] == 'openMeasureModal', gr)
    ok('L2 /owner/grafy bez klice 401/403', call('GET', '/owner/grafy')['status'] in (401, 403))

    # ---- M) brzda na hadani klice pocita JEN chybne klice (13. 9. 2026) -----------
    # Do te doby zvedl kazdy pozadavek pocitadlo a smazal ho az po overeni; konzole
    # strili 4-6 dotazu naraz, takze se spravnym klicem prisla po chvili 429 na hodinu.
    def guard_ops():
        return [l['sql'][:40] for l in log() if 'guard' in l['sql'] and l['op'] == 'run']
    base_rules()
    m1 = call('GET', '/owner/ucty', headers=OWN)
    ok('M1 spravny klic bez zaznamu v guard: 200 a do guard se NIC nezapsalo', m1['status'] == 200 and not guard_ops(), (m1['status'], guard_ops()))
    base_rules()
    m2 = call('GET', '/owner/ucty', headers={'X-Owner-Key': 'spatny-klic-spatny-klic-spatny'})
    ok('M2 chybny klic: 403 a pocitadlo se zvedlo', m2['status'] == 403 and any('guard' in g for g in guard_ops()), (m2['status'], guard_ops()))
    base_rules()
    rule('/SELECT n, until FROM guard/', 'function(){ return { first: { n: 10, until: Date.now() + 3600e3 } }; }')
    m3 = call('GET', '/owner/ucty', headers=OWN)
    ok('M3 zamceno po deseti chybnych: 429 i se spravnym klicem (a nic dalsiho se nezapisuje)', m3['status'] == 429 and not guard_ops(), (m3['status'], guard_ops()))
    base_rules()
    rule('/SELECT n, until FROM guard/', 'function(){ return { first: { n: 3, until: Date.now() + 3600e3 } }; }')
    m4 = call('GET', '/owner/ucty', headers=OWN)
    ok('M4 par chybnych pokusu + spravny klic: 200 a pocitadlo se smaze', m4['status'] == 200 and any(g.startswith('DELETE FROM guard') for g in guard_ops()), (m4['status'], guard_ops()))
    base_rules()
    rule('/SELECT n, until FROM guard/', 'function(){ return { first: { n: 10, until: Date.now() - 1000 } }; }')
    m5 = call('GET', '/owner/ucty', headers=OWN)
    ok('M5 prosla hodina: zamek uz neplati', m5['status'] == 200, m5['status'])
    base_rules()
    rule('/SELECT n, until FROM guard/', 'function(){ return { first: { n: 10, until: Date.now() + 600e3 } }; }')
    m6 = call('GET', '/owner/ucty', headers=OWN)
    ok('M6 429 nese retryAfter (sekundy do vyprseni)', m6['status'] == 429 and 590 <= (m6['data'].get('retryAfter') or 0) <= 600, m6['data'])

    # ---- N) konzole vlastnika, 2. kolo (13. 9. 2026) ---------------------------------
    base_rules()
    rule('/SELECT name, code, ver, created FROM accounts WHERE created>=/', 'function(){ return { all: [{ name: "Karel", code: "K1", ver: "v305", created: 5 }] }; }')
    rule('/SELECT sig, MIN\(ts\) AS m FROM errors GROUP BY sig/', 'function(){ return { first: { n: 2 } }; }')
    rule('/SELECT uname, SUM\(n\) AS n, MAX\(ver\) AS ver FROM errors/', 'function(){ return { all: [{ uname: "Karel", n: 30, ver: "v305" }] }; }')
    n1 = call('GET', '/owner/prehled?od=%d' % (1789000000000), headers=OWN)
    ok('N1 /owner/prehled?od= vraci novinky od casu (noviLide, noveDruhy, chybyUcty, od)', n1['status'] == 200 and n1['data'].get('od') == 1789000000000 and n1['data']['noviLide'][0]['name'] == 'Karel' and n1['data'].get('noveDruhy') == 2 and n1['data']['chybyUcty'][0]['n'] == 30, n1['data'])
    base_rules()
    n2 = call('GET', '/owner/grafy?dni=7', headers=OWN)
    ok('N2 /owner/grafy?dni=7 vraci dni a minule obdobi', n2['status'] == 200 and n2['data'].get('dni') == 7 and isinstance(n2['data'].get('minule'), dict) and 'lide' in n2['data']['minule'], n2['data'])
    base_rules()
    rule('/FROM accounts WHERE created>=\? ORDER BY created$/', 'function(){ return { all: [{ id: "a1", code: "K1", name: "Karel", created: 1000 }, { id: "a2", code: "K2", name: "Petr", created: 2000 }] }; }')
    rule("/g\.t='pt-add'/", 'function(){ return { all: [{ a: "a1", t: 1500 }] }; }')
    rule('/MAX\(g\.ts\) AS t FROM usage g JOIN users/', 'function(){ return { all: [{ a: "a1", t: 1000 + 3 * 864e5 }] }; }')
    rule("/kind='hodnoceni' AND ts>=/", 'function(){ return { all: [{ meta: JSON.stringify({ ucet: "k1" }), ts: 9 }] }; }')
    n3 = call('GET', '/owner/trychtyr', headers=OWN)
    d3 = n3['data'] or {}
    ok('N3 /owner/trychtyr: registrace 2, prvni bod 1, 3. den 1, hodnoceni 1', n3['status'] == 200 and d3.get('registrace') == 2 and d3.get('bod') == 1 and d3.get('den3') == 1 and d3.get('hodnoceni') == 1 and d3['lidi'][0]['bod'] == 1500, d3)
    base_rules()
    rule('/SELECT COUNT\(\*\) AS n FROM usage$/', 'function(){ return { first: { n: 12345 } }; }')
    n4 = call('GET', '/owner/kapacita', headers=OWN)
    ok('N4 /owner/kapacita: tabulky, limity, odhad velikosti', n4['status'] == 200 and n4['data']['tab'].get('usage') == 12345 and n4['data'].get('limitDen') == 100000 and n4['data'].get('bajty', 0) > 0, n4['data'])
    base_rules()
    rule('/SELECT COUNT\(\*\) AS n FROM usage WHERE ts</', 'function(){ return { first: { n: 777 } }; }')
    n5 = call('GET', '/owner/uklid?dni=60', headers=OWN)
    ok('N5 GET /owner/uklid = nahled (usage 777, dni 60)', n5['status'] == 200 and n5['data']['nahled'].get('usage') == 777 and n5['data'].get('dni') == 60, n5['data'])
    rule('/DELETE FROM usage WHERE ts</', 'function(){ LOG.push({ del: "usage" }); return { run: { changes: 777 } }; }')
    n6 = call('POST', '/owner/uklid', body={'co': ['usage', 'guard'], 'dni': 60}, headers=OWN)
    smazano = [l for l in log() if l.get('del') == 'usage']
    body_del = [l for l in log() if 'sql' in l and l['sql'].startswith('DELETE FROM sync_points')]
    ok('N6 POST /owner/uklid maze jen vybrane tabulky, body nikdy, zapis do deniku', n6['status'] == 200 and n6['data']['hotovo'].get('usage') == 777 and 'errors' not in n6['data']['hotovo'] and smazano and not body_del and any('owner_log' in l['sql'] for l in log() if 'sql' in l), n6['data'])
    base_rules()
    rule('/FROM accounts WHERE UPPER\(name\) LIKE/', 'function(a){ return { all: a[0] === "%KAREL%" ? [{ id: "a1", code: "K1", name: "Karel" }] : [] }; }')
    n7 = call('GET', '/owner/hledej?q=karel', headers=OWN)
    ok('N7 /owner/hledej najde ucet podle jmena (case-insensitive) a vraci vsechny ctyri skupiny', n7['status'] == 200 and n7['data']['ucty'][0]['name'] == 'Karel' and all(k in n7['data'] for k in ('firmy', 'zpravy', 'chyby')), n7['data'])
    ok('N7b kratky dotaz vrati prazdno bez SQL', call('GET', '/owner/hledej?q=k', headers=OWN)['data'].get('ucty') == [])
    base_rules()
    rule('/SELECT id, code, name, created, last_login, ver, ver_ts, dev FROM accounts WHERE id=/', 'function(){ return { first: { id: "acc1", code: "K7QM3XP2", name: "Tester" } }; }')
    rule('/SELECT id, name FROM users WHERE acc_id=/', 'function(){ return { all: [{ id: "u1", name: "Karel" }] }; }')
    rule('/FROM usage WHERE uid IN \(\?\) AND ts>=\? GROUP BY day, t, k/', 'function(){ return { all: [{ day: "2026-09-11", t: "pt-add", k: null, n: 14 }, { day: "2026-09-11", t: "tool", k: "openDmtVolume", n: 2 }] }; }')
    rule('/FROM errors WHERE uname IN \(\?\) AND ts>=\? GROUP BY day/', 'function(){ return { all: [{ day: "2026-09-13", n: 2, msg: "export DXF" }] }; }')
    n8 = call('GET', '/owner/ucty/acc1/denik', headers=OWN)
    d8 = n8['data'] or {}
    ok('N8 /owner/ucty/:id/denik: dny s body, nastroji a chybami', n8['status'] == 200 and len(d8.get('dny') or []) == 2 and d8['dny'][0]['body'] == 14 and d8['dny'][0]['nastroje'] == ['openDmtVolume'] and d8['dny'][1]['chyby'] == 2, d8)
    base_rules()
    rule('/SELECT id FROM accounts WHERE code=/', 'function(a){ return { first: a[0] === "K7QM3XP2" ? { id: "acc1" } : null }; }')
    rule('/INSERT INTO vzkazy/', 'function(a){ LOG.push({ vzkaz: a }); return { run: 1 }; }')
    n9 = call('POST', '/owner/vzkaz', body={'code': 'k7qm3xp2', 'txt': 'Díky, opraveno.'}, headers=OWN)
    vz = [l for l in log() if 'vzkaz' in l]
    ok('N9 /owner/vzkaz podle KODU uctu (odpoved ze schranky) dohleda id', n9['status'] == 200 and vz and vz[0]['vzkaz'][1] == 'acc1', (n9, vz))
    ok('N9b neznamy kod = 404', call('POST', '/owner/vzkaz', body={'code': 'NIC', 'txt': 'x'}, headers=OWN)['status'] == 404)
    base_rules()
    rule("/SELECT v FROM meta WHERE k='vapid'/", 'function(){ return { first: null }; }')
    rule("/INSERT OR REPLACE INTO meta\(k,v\) VALUES\('vapid'/", 'function(a){ LOG.push({ vapid: a[0] }); return { run: 1 }; }')
    n10 = call('GET', '/owner/push', headers=OWN)
    ok('N10 GET /owner/push vyrobi VAPID klic napoprve a vrati verejny', n10['status'] == 200 and n10['data'].get('vapid') and [l for l in log() if 'vapid' in l], n10['data'])
    rule('/INSERT INTO push_subs/', 'function(a){ LOG.push({ sub: a }); return { run: 1 }; }')
    n11 = call('POST', '/owner/push', body={'sub': {'endpoint': 'https://web.push.apple.com/abc', 'keys': {'p256dh': 'BAAA', 'auth': 'AAAA'}}, 'co': {'chyby': False}, 'dev': 'iPhone'}, headers=OWN)
    sb = [l for l in log() if 'sub' in l]
    ok('N11 POST /owner/push ulozi odber s volbami', n11['status'] == 200 and sb and 'apple' in sb[0]['sub'][0] and '"chyby":false' in sb[0]['sub'][4], (n11, sb))
    ok('N11b neuplny odber = 400', call('POST', '/owner/push', body={'sub': {'endpoint': 'x'}}, headers=OWN)['status'] == 400)
    # nova zprava → push (fetch na endpoint); odber ma zapnute zpravy
    base_rules()
    rule('/SELECT id, endpoint, p256dh, auth, co FROM push_subs/', 'function(){ return { all: [{ id: 1, endpoint: "https://web.push.apple.com/abc", p256dh: "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", auth: "AAAAAAAAAAAAAAAA", co: JSON.stringify({ zpravy: true }) }] }; }')
    rule("/SELECT v FROM meta WHERE k='vapid'/", 'function(){ return { first: { v: JSON.stringify({ pub: { kty: "EC", crv: "P-256", x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", y: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, priv: { kty: "EC", crv: "P-256", d: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } }) } }; }')
    rule('/INSERT INTO feedback/', 'function(a){ LOG.push({ fb: a }); return { run: 1 }; }')
    r.eval('FETCH_LOG.length = 0; FETCH_REPLY = { status: 201, body: {} }')
    n12 = call('POST', '/feedback', body={'kind': 'chyba', 'txt': 'Padá export.', 'who': 'Karel'})
    fl = json.loads(r.eval('JSON.stringify(FETCH_LOG)'))
    ok('N12 nova zprava posle push na odber (fetch na push server)', n12['status'] == 200 and any('web.push.apple.com' in u for u in fl), (n12, fl))
    r.eval('FETCH_LOG.length = 0')
    n13 = call('POST', '/owner/push/test', headers=OWN)
    fl = json.loads(r.eval('JSON.stringify(FETCH_LOG)'))
    ok('N13 /owner/push/test posle zkusebni push', n13['status'] == 200 and any('web.push.apple.com' in u for u in fl), (n13, fl))

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
