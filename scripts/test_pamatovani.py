# -*- coding: utf-8 -*-
u"""PAMATOVANÉ PŘIHLÁŠENÍ (13. 11. 2026, js/ucty.js).

Uživatel: „aby si mobil pamatoval, že jsem se už jednou přihlásil, a nemusel jsem se pokaždé
přihlašovat — ale třeba každé 15. otevření ať to vyžaduje přihlášení".

A  pamatované přihlášení (bez Face ID): start rovnou do appky, počítadlo +1
B  pamatované přihlášení s Face ID: start rovnou do appky (dřív se ptal Face ID při KAŽDÉM startu)
C  15. spuštění (TRUST_MAX): kontrolní přihlášení
D  Face ID z telefonu zmizelo → přihlášení (pamatování stálo na něm)

python scripts/test_pamatovani.py [port]
"""
import os
import sys
import json
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9150)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


STAV = "() => ({ login: !!document.getElementById('ag-login'), start: document.body.classList.contains('app-started'), trust: JSON.parse(localStorage.getItem('agFirmaTrust_v1') || 'null'), hint: (document.querySelector('#ag-login .agl-hint') || {}).textContent || '' })"


async def nacti(page, url, nastav):
    # stav se zapíše před startem appky (init skript běží při každé navigaci → jen jednou na krok)
    await page.evaluate("(js) => sessionStorage.setItem('agPamKrok', js)", nastav)
    await page.goto(url, wait_until='domcontentloaded', timeout=90000)
    await V.cekej(page, "document.body.classList.contains('app-started') || !!document.getElementById('ag-login')", 60)
    await page.wait_for_timeout(2500)
    return await page.evaluate(STAV)


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True, service_workers='block')
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + """
            localStorage.setItem('agZemeUvod_v1', 'CZ');
            localStorage.setItem('agLockStart_v1', '1');          // přihlášení při startu ZAPNUTÉ (výchozí v appce)
            var k = sessionStorage.getItem('agPamKrok');
            if (k) { sessionStorage.removeItem('agPamKrok'); try { (new Function(k))(); } catch (e) { console.error(e); } }
        """)
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        await page.wait_for_timeout(1500)
        T = "localStorage.setItem('agFirmaTrust_v1', JSON.stringify(%s));"
        # účet s PINem — bez PINu by lokální přihlášení prošlo samo (pick → finish)
        PIN = " var f = JSON.parse(localStorage.getItem('agFirma_v1')); f.users[0].pinHash = 'x'; localStorage.setItem('agFirma_v1', JSON.stringify(f));"

        r = await nacti(page, url, T % "{userId: 'test-user-1', mode: 'auto', n: 0, ts: Date.now()}" + " localStorage.removeItem('agFirmaBio_v1');")
        ok('A pamatované přihlášení: rovnou do appky, počítadlo 1', not r['login'] and r['start'] and r['trust'] and r['trust']['n'] == 1, r)

        r = await nacti(page, url, T % "{userId: 'test-user-1', mode: 'bio', n: 3, ts: Date.now()}" + " localStorage.setItem('agFirmaBio_v1', JSON.stringify({'test-user-1': {id: 'AAAA', ts: Date.now()}}));")
        ok('B s Face ID: rovnou do appky, Face ID se při každém startu NEptá', not r['login'] and r['start'] and r['trust'] and r['trust']['n'] == 4 and r['trust']['mode'] == 'bio', r)

        mx = await page.evaluate("() => AGUcty.TRUST_MAX")
        ok('C0 kontrolní přihlášení každé 15. spuštění', mx == 15, mx)
        r = await nacti(page, url, T % "{userId: 'test-user-1', mode: 'bio', n: 15, ts: Date.now()}" + PIN)
        ok('C 15. spuštění: kontrolní přihlášení', r['login'] and 'Kontrolní' in r['hint'], r)

        r = await nacti(page, url, T % "{userId: 'test-user-1', mode: 'bio', n: 2, ts: Date.now()}" + " localStorage.removeItem('agFirmaBio_v1');" + PIN)
        ok('D Face ID z telefonu zmizelo → přihlášení, pamatování zrušeno', r['login'] and not r['trust'], r)

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
