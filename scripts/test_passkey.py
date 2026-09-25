# -*- coding: utf-8 -*-
u"""PŘIHLÁŠENÍ PŘES FACE ID — PASSKEY (25. 9. 2026, 7. hodnocení f1): prohlížeč + skutečná kryptografie.

Chromium dostane VIRTUÁLNÍ AUTENTIZÁTOR (CDP WebAuthn: rezidentní klíč, ověření uživatele) a appka
na http://localhost vytvoří skutečný přístupový klíč a skutečný podpis. Server je podvržený jen
pro přenos; OVĚŘENÍ dělají funkce z cloud/worker.js (pkOverRegistraci, pkOverPrihlaseni) spuštěné
v prohlížeči se skutečným WebCrypto — stejný kód, který běží na Cloudflare. Podvržený podpis nebo
jiná výzva musí neprojít.

python scripts/test_passkey.py [port]
"""
import os
import io
import sys
import json
import base64
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9092)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VYSLEDKY = []
S = {'reg': None, 'login': None, 'ch': [], 'owner': False}
OWNER = 'vlastnik-' + 'k' * 24


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


async def pk_route(route, request):
    hdr = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'}
    if request.method == 'OPTIONS':
        return await route.fulfill(status=204, headers=hdr)
    u = request.url
    b = json.loads(request.post_data or '{}') if request.method == 'POST' else {}

    def odp(d, st=200):
        return route.fulfill(status=st, content_type='application/json', headers=hdr, body=json.dumps(d))
    if '/passkey/register/start' in u:
        ch = b64u(os.urandom(32)); S['ch'].append(ch)
        return await odp({'ok': True, 'challenge': ch, 'rpId': 'localhost', 'user': {'id': b64u(b'acc1'), 'name': 'ABCDEFGH', 'displayName': 'Tester'}, 'exclude': []})
    if '/passkey/register/finish' in u:
        S['reg'] = b; S['owner'] = b.get('ownerKey') == OWNER
        return await odp({'ok': True, 'owner': S['owner']})
    if '/passkey/login/start' in u:
        ch = b64u(os.urandom(32)); S['ch'].append(ch)
        return await odp({'ok': True, 'challenge': ch, 'rpId': 'localhost', 'timeout': 60000})
    if '/passkey/login/finish' in u:
        S['login'] = b
        out = {'token': 'TOK-PASSKEY', 'ucet': {'id': 'acc1', 'code': 'ABCDEFGH', 'name': 'Tester', 'tarif': 'pro', 'tarifDo': 0},
               'user': {'id': 'u1', 'name': 'Tester', 'role': 'admin'}, 'prostory': [], 'config': None, 'passkey': True}
        if S['owner']:
            out['ownerKey'] = OWNER
        return await odp(out)
    return await odp({'error': 'neznámé'}, 404)


async def beh():
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    url = url.replace('127.0.0.1', 'localhost')      # WebAuthn: rpId nesmí být IP adresa
    try:
        async with async_playwright() as p:
            br = await p.chromium.launch()
            ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                       geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
            page = await ctx.new_page()
            chyby = []
            page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
            await page.route('**/*', V.route_vse)
            await page.route('**/passkey/**', pk_route)
            await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ');")
            cdp = await ctx.new_cdp_session(page)
            await cdp.send('WebAuthn.enable')
            auth = await cdp.send('WebAuthn.addVirtualAuthenticator', {'options': {'protocol': 'ctap2', 'transport': 'internal', 'hasResidentKey': True,
                                                                                   'hasUserVerification': True, 'isUserVerified': True, 'automaticPresenceSimulation': True}})
            await page.goto(url, wait_until='domcontentloaded', timeout=90000)
            ok('A0 start (localhost)', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
            await page.evaluate("() => new Promise(r => AGLazy.need('js/passkey.js', r))")
            ok('A1 modul a podpora passkey', await page.evaluate("() => !!(window.AGPasskey && AGPasskey.podpora())"))

            # zapnutí jako vlastník (klíč vlastníka v telefonu)
            await page.evaluate("(k) => { localStorage.setItem('agVlastnik_v1', '1'); localStorage.setItem('agFbKey_v1', k); }", OWNER)
            z = await page.evaluate("() => AGPasskey.zapnout().then(v => v, e => ({ chyba: String(e && e.message || e) }))")
            ok('R1 zapnutí: skutečný klíč vytvořen a odeslán (id, clientData, SPKI, ES256)', z.get('ok') and S['reg'] and S['reg'].get('alg') == -7 and len(S['reg'].get('publicKey') or '') > 100, (z, S['reg'] and list(S['reg'].keys())))
            ok('R2 s klíčem vlastníka → server ho sváže (owner)', z.get('owner') is True and S['reg'].get('ownerKey') == OWNER, z)
            cred = await cdp.send('WebAuthn.getCredentials', {'authenticatorId': auth['authenticatorId']})
            ok('R3 v autentizátoru je REZIDENTNÍ klíč pro localhost (přežije přeinstalaci — drží ho telefon, ne appka)', len(cred['credentials']) == 1 and cred['credentials'][0]['isResidentCredential'] and cred['credentials'][0]['rpId'] == 'localhost', cred)

            # appka „přeinstalovaná“: smazat vše kromě autentizátoru, přihlásit se klíčem
            await page.evaluate("() => { ['agVlastnik_v1', 'agFbKey_v1', 'agPasskey_v1'].forEach(k => localStorage.removeItem(k)); }")
            l = await page.evaluate("() => AGPasskey.prihlasit().then(d => ({ ok: true, user: d.user }), e => ({ chyba: String(e && e.message || e) }))")
            ok('L1 přihlášení přes Face ID: podpis odeslán, přihlášení převzato', l.get('ok') and S['login'] and S['login'].get('signature'), (l, S['login'] and list(S['login'].keys())))
            st = await page.evaluate("() => ({ tok: localStorage.getItem('agFirmaTok_v1') || '', owner: localStorage.getItem('agVlastnik_v1'), key: localStorage.getItem('agFbKey_v1') })")
            ok('L2 token z přihlášení klíčem uložen', 'TOK-PASSKEY' in st['tok'], st)
            ok('L3 klíč vlastníka obnoven do telefonu (vlastnický režim bez psaní klíče)', st['owner'] == '1' and st['key'] == OWNER, st)

            # ---- OVĚŘENÍ SKUTEČNÉHO PODPISU FUNKCEMI WORKERU (WebCrypto v prohlížeči) ----
            wsrc = io.open(os.path.join(ROOT, 'cloud', 'worker.js'), encoding='utf-8').read().replace('export default {', 'globalThis.WORKER = {')
            har = await ctx.new_page()
            # bezpečný kontext (localhost), jinak crypto.subtle chybí; prázdná stránka podvržená trasou
            hurl = url.split('/index.html')[0] + '/__harness.html'
            await har.route('**/__harness.html', lambda rt, rq: rt.fulfill(status=200, content_type='text/html', body='<!doctype html><title>h</title>'))
            await har.goto(hurl)
            await har.add_script_tag(content=wsrc)
            ctxo = {'origin': url.split('/index.html')[0].rstrip('/'), 'rpId': 'localhost'}
            reg_ch, log_ch = S['ch'][0], S['ch'][1]
            v1 = await har.evaluate("([b, c, ch]) => pkOverRegistraci(b, c, ch)", [S['reg'], ctxo, reg_ch])
            ok('W1 worker ověří registraci (clientData, původ, výzva, SPKI P-256)', v1.get('ok'), v1)
            v2 = await har.evaluate("([b, pub, c, ch]) => pkOverPrihlaseni(b, pub, c, ch)", [S['login'], S['reg']['publicKey'], ctxo, log_ch])
            ok('W2 worker ověří SKUTEČNÝ podpis ECDSA P-256 z autentizátoru (rpIdHash, UP+UV)', v2.get('ok'), v2)
            spatne = dict(S['login'])
            ad = bytearray(base64.urlsafe_b64decode(spatne['authenticatorData'] + '=' * (-len(spatne['authenticatorData']) % 4)))
            ad[-1] ^= 0x01
            spatne['authenticatorData'] = b64u(bytes(ad))
            v3 = await har.evaluate("([b, pub, c, ch]) => pkOverPrihlaseni(b, pub, c, ch)", [spatne, S['reg']['publicKey'], ctxo, log_ch])
            ok('W3 pozměněná data → podpis nesedí', not v3.get('ok') and 'Podpis' in (v3.get('err') or ''), v3)
            v4 = await har.evaluate("([b, pub, c, ch]) => pkOverPrihlaseni(b, pub, c, ch)", [S['login'], S['reg']['publicKey'], ctxo, reg_ch])
            ok('W4 jiná výzva → odmítnuto', not v4.get('ok'), v4)
            v5 = await har.evaluate("([b, pub, c, ch]) => pkOverPrihlaseni(b, pub, c, ch)", [S['login'], S['reg']['publicKey'], {'origin': 'https://stepanvcelak11.github.io', 'rpId': 'stepanvcelak11.github.io'}, log_ch])
            ok('W5 klíč z jiné domény (rpId/původ) → odmítnuto', not v5.get('ok'), v5)
            await har.close()

            # brána bez účtu: tlačítko „Přihlásit přes Face ID“
            p2 = await ctx.new_page()
            await p2.route('**/*', V.route_vse)
            await p2.add_init_script("localStorage.clear(); localStorage.setItem('agZemeUvod_v1','CZ');")
            await p2.goto(url, wait_until='domcontentloaded', timeout=90000)
            ok('G1 brána bez účtu nabízí „Přihlásit přes Face ID“', await V.cekej(p2, "(() => { const b = document.getElementById('agg-pk'); return b && b.textContent.indexOf('Face ID') >= 0; })()", 60))
            await p2.close()
            ok('Z bez chyb v konzoli', not chyby, chyby[:5])
            await ctx.close()
            await br.close()
    finally:
        srv.terminate()


def main():
    asyncio.run(beh())
    n = len(VYSLEDKY); d = sum(VYSLEDKY)
    print('\n%d/%d OK' % (d, n))
    sys.exit(0 if d == n else 1)


if __name__ == '__main__':
    main()
