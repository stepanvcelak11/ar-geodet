# -*- coding: utf-8 -*-
u"""ZABEZPEČENÍ PŘIHLÁŠENÍ (14. 11. 2026, js/ucty.js).

P1  nová sůl PINu je „p2$…" a PIN se odvozuje PBKDF2 (ne holé SHA-256)
P2  starý PIN (SHA-256) projde a po přihlášení se sám převede na PBKDF2
P3  převedený PIN funguje při dalším přihlášení, špatný PIN ne
T1  cloudová firma: „přihlášený" telefon BEZ tokenu ze serveru → přihlašovací obrazovka
T2  s tokenem se nic neděje

python scripts/test_bezpecnost_prihlaseni.py [port]
"""
import os
import sys
import json
import hashlib
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9160)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


STAV = "() => ({ login: !!document.getElementById('ag-login'), start: document.body.classList.contains('app-started'), user: (JSON.parse(localStorage.getItem('agFirma_v1') || '{}').users || [])[0] || null })"


async def nacti(page, url, nastav):
    await page.evaluate("(js) => sessionStorage.setItem('agBezKrok', js)", nastav)
    await page.goto(url, wait_until='domcontentloaded', timeout=90000)
    await V.cekej(page, "document.body.classList.contains('app-started') || !!document.getElementById('ag-login')", 60)
    await page.wait_for_timeout(1500)


async def prihlas(page, pin):
    st = await page.evaluate("() => ({ login: !!document.getElementById('ag-login'), user: !!document.querySelector('#ag-login .agl-user'), start: document.body.classList.contains('app-started'), trust: localStorage.getItem('agFirmaTrust_v1'), sess: localStorage.getItem('agFirmaSess_v1') })")
    if not st['user']:
        print('   (stav před přihlášením: %s)' % st)
        return
    await page.click('#ag-login .agl-user')
    await page.fill('#ag-login .agl-pin', pin)
    await page.click('#ag-login .agl-pinbox .agl-btn')
    await V.cekej(page, "!document.getElementById('ag-login') || !!(document.querySelector('#ag-login .agl-err') || {}).textContent", 20)
    await page.wait_for_timeout(1500)


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True, service_workers='block')
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        # falešný server firmy (jen /health — dosažitelnost)
        # ostatní cesty „bez signálu" (status 0), ať prázdná odpověď nepřepíše firmu
        await page.route('**/fakeapi/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"ok":true}') if '/fakeapi/health' in r.request.url else r.abort())
        await page.add_init_script(boot(tarif='pro') + """
            localStorage.setItem('agZemeUvod_v1', 'CZ');
            localStorage.setItem('agDomov_v1', JSON.stringify({ auto: false, v: 3 }));
            var k = sessionStorage.getItem('agBezKrok');
            if (k) { sessionStorage.removeItem('agBezKrok'); try { (new Function(k))(); } catch (e) { console.error(e); } }
        """)
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        await V.cekej(page, "!!window.AGUcty && !!AGUcty.hashPin", 60)

        r = await page.evaluate("async () => { const s = AGUcty.makeSalt(); const h = await AGUcty.hashPin('1234', s); const h2 = await AGUcty.hashPin('1234', s); return { s, h, stejne: h === h2 }; }")
        ok('P1 nová sůl p2$ a PBKDF2 hash', r['s'].startswith('p2$') and r['h'].startswith('p2$') and len(r['h']) == 67 and r['stejne'], r)

        stary = hashlib.sha256(b'abc123|1234').hexdigest()
        LOK = ("var f = JSON.parse(localStorage.getItem('agFirma_v1')); f.users[0].salt = 'abc123'; f.users[0].pinHash = '%s'; f.users[0].noPin = false;"
               " localStorage.setItem('agFirma_v1', JSON.stringify(f)); localStorage.removeItem('agFirmaSess_v1'); localStorage.removeItem('agFirmaTrust_v1');"
               " localStorage.setItem('agLockStart_v1', '1');") % stary
        await nacti(page, url, LOK)
        await prihlas(page, '1234')
        r = await page.evaluate(STAV)
        ok('P2 starý PIN projde a převede se na PBKDF2', not r['login'] and r['user'] and r['user']['salt'].startswith('p2$') and r['user']['pinHash'].startswith('p2$'), r)

        # boot() při každém načtení vrací výchozí firmu → převedeného uživatele vrátit zpět
        ODHL = ("var f = JSON.parse(localStorage.getItem('agFirma_v1')); f.users[0] = %s; localStorage.setItem('agFirma_v1', JSON.stringify(f));" % json.dumps(r['user'])) + " localStorage.removeItem('agFirmaSess_v1'); localStorage.removeItem('agFirmaTrust_v1'); localStorage.setItem('agLockStart_v1', '1');"
        await nacti(page, url, ODHL)
        await prihlas(page, '9999')
        r = await page.evaluate(STAV)
        ok('P3a špatný PIN neprojde', r['login'], r)
        await nacti(page, url, ODHL)
        await prihlas(page, '1234')
        r = await page.evaluate(STAV)
        ok('P3b převedený PIN projde', not r['login'] and r['start'], r)

        CLOUD = ("var f = JSON.parse(localStorage.getItem('agFirma_v1')); f.cloud = true; f.code = 'TEST'; f.api = location.origin + '/fakeapi';"
                 " localStorage.setItem('agFirma_v1', JSON.stringify(f)); localStorage.removeItem('agFirmaTrust_v1');"
                 " localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: f.users[0].id, ts: Date.now() }));")
        await nacti(page, url, CLOUD + " localStorage.removeItem('agFirmaTok_v1');")
        await V.cekej(page, "!!document.getElementById('ag-login')", 20)
        r = await page.evaluate("() => ({ login: !!document.getElementById('ag-login'), sess: localStorage.getItem('agFirmaSess_v1'), cloud: AGUcty.isCloud && AGUcty.isCloud(), tok: localStorage.getItem('agFirmaTok_v1'), own: localStorage.getItem('agVlastnik_v1'), online: navigator.onLine })")
        ok('T1 cloud bez tokenu → přihlašovací obrazovka', r['login'] and not r['sess'], r)

        await nacti(page, url, CLOUD + " localStorage.setItem('agFirmaTok_v1', JSON.stringify({ token: 't', userId: f.users[0].id }));")
        await page.wait_for_timeout(9000)
        r = await page.evaluate("() => ({ login: !!document.getElementById('ag-login'), sess: !!localStorage.getItem('agFirmaSess_v1') })")
        ok('T2 s tokenem zůstává přihlášený', not r['login'] and r['sess'], r)

        ok('Z bez chyb stránky', not chyby, chyby[:5])
        await ctx.close()
        await br.close()


def main():
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server nenastartoval')
        sys.exit(1)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    print('\n%d/%d OK' % (sum(VYSLEDKY), len(VYSLEDKY)))
    sys.exit(0 if all(VYSLEDKY) else 1)


if __name__ == '__main__':
    main()
