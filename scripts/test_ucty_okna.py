# -*- coding: utf-8 -*-
u"""RYCHLEJŠÍ START — VZÁCNÁ OKNA ÚČTU AŽ NA KLEPNUTÍ (25. 9. 2026, 6. hodnocení d1).

Okna Vytvořit účet, Zapomenuté heslo, Smazat účet, Firmy na zařízení, Nový obnovovací kód, Kód účtu
a Prostory jsou v js/ucty-okna.js; js/ucty.js má jen pahýly, které modul načtou při prvním otevření.
Hlídá: při startu se modul nestahuje, každé okno se přes pahýl otevře, bez chyb v konzoli, a ucty.js
zůstane menší (návrat kódu zpátky by start zase zpomalil).

python scripts/test_ucty_okna.py [port]
"""
import os
import io
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9094)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


# (jméno pro výpis, volání, id okna)
OKNA = [
    ('Vytvořit účet', 'AGUcty.showRegister()', 'ag-reg'),
    ('Prostory', 'AGUcty.showProstory()', 'ag-prostory'),
    ('Firmy na zařízení', 'AGUcty.showFirmy()', 'ag-firmy'),
    ('Smazat účet', 'AGUcty.smazatUcet()', 'ag-smazani'),
    ('Nový obnovovací kód', 'AGUcty.obnovovaciKod()', 'ag-rec'),
]


async def beh():
    src = io.open(os.path.join(ROOT, 'js', 'ucty.js'), encoding='utf-8').read()
    ok('S1 ucty.js je bez vzácných oken (pahýly → js/ucty-okna.js)', 'okna(function (O) { O.showRegister' in src and len(src) < 215000, len(src))
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    try:
        async with async_playwright() as p:
            br = await p.chromium.launch()
            ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                       geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
            page = await ctx.new_page()
            chyby = []
            nacteno = []
            page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
            page.on('request', lambda r: nacteno.append(r.url) if 'ucty-okna.js' in r.url else None)
            await page.route('**/*', V.route_vse)
            await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ');")
            await page.goto(url, wait_until='domcontentloaded', timeout=90000)
            ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
            await page.wait_for_timeout(1500)
            html = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
            ok('A1 okna účtu nejsou před prvním vykreslením (jen ag/lazy, ne defer)', 'type="ag/lazy" data-src="js/ucty-okna.js"' in html and 'src="js/ucty-okna.js"' not in html.replace('data-src="js/ucty-okna.js"', ''))
            for jm, volani, oid in OKNA:
                await page.evaluate("() => { try { " + volani + "; } catch (e) { window.__okErr = String(e); } }")
                vidno = await V.cekej(page, "!!document.getElementById('" + oid + "')", 15)
                err = await page.evaluate("() => window.__okErr || ''")
                ok('O ' + jm + ' se otevře přes pahýl (#' + oid + ')', vidno and not err, err)
                await page.evaluate("() => { const o = document.getElementById('" + oid + "'); if (o) o.remove(); }")
            ok('A2 modul se stáhl jen jednou (pahýl i ag/lazy sdílí jedno načtení)', len(nacteno) == 1, nacteno)

            # brána PŘED startem appky (ag/lazy ještě neběží): Vytvořit účet a Zapomenuté heslo
            p2 = await ctx.new_page()
            p2.on('pageerror', lambda e: chyby.append(str(e)[:200]))
            await p2.route('**/*', V.route_vse)
            await p2.add_init_script("localStorage.clear(); localStorage.setItem('agZemeUvod_v1','CZ');")
            await p2.goto(url, wait_until='domcontentloaded', timeout=90000)
            ok('G0 brána bez účtu', await V.cekej(p2, "!!document.getElementById('agg-reg')", 60))
            await p2.evaluate("() => document.getElementById('agg-reg').click()")
            ok('G1 z brány se otevře Vytvořit účet', await V.cekej(p2, "!!document.getElementById('ag-reg')", 15))
            await p2.reload(wait_until='domcontentloaded')     # Vytvořit účet bránu nahradilo — znovu od brány
            await V.cekej(p2, "!!document.getElementById('agg-forgot')", 60)
            await p2.evaluate("() => document.getElementById('agg-forgot').click()")
            ok('G2 z brány se otevře Zapomenuté heslo', await V.cekej(p2, "!!document.getElementById('ag-obnova')", 15))
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
