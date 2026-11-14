# -*- coding: utf-8 -*-
u"""PRUH DOLE NA iPHONU Z PLOCHY + DÉLKA MĚŘENÍ V JEDNODUCHÉM REŽIMU (14. 11. 2026).

Hlášení: „ve spodní části mám pruh, kde vůbec nic není, jako kdyby se celá appka o centimetr
posunula výš" (iPhone, appka z plochy, jednoduchý režim i Nástroje).

  V1  iOS z plochy hlásí stránku o stavový řádek menší → --app-vh = celý displej
  V2  po návratu z pozadí iOS chvíli hlásí i displej menší → výška se NEZMENŠÍ (pamatuje si max)
  V3  přebal jednoduchého režimu je vysoký jako --app-vh (dřív inset:0 → pruh dole)
  D1  délka měření „Z GPS" jde vybrat (5 s / 10 s / 30 s / 1 min), výchozí 10 s, pamatuje se
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9143)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


# iPhone z plochy: stránka 793 px, displej 852 px (screen.height); window.__scr jde měnit z testu
IOS = """
try { Object.defineProperty(navigator, 'standalone', { get: function () { return true; } }); } catch (e) {}
window.__scr = 852;
try { Object.defineProperty(screen, 'height', { get: function () { return window.__scr; } }); } catch (e) {}
"""


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 793}, has_touch=True, is_mobile=True, service_workers='block',
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(IOS + boot() + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agJednoduchy_v1','1'); localStorage.setItem('agDomov_v1', JSON.stringify({auto:false}));")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        await V.cekej(page, "document.body.classList.contains('ag-jr-on')", 60)
        await page.wait_for_timeout(1000)
        v = await page.evaluate("() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-vh'))")
        ok('V1 iPhone z plochy: výška appky = celý displej (852), ne zkrácená stránka (793)', v == 852, v)
        # návrat z pozadí, iOS chvíli hlásí menší displej
        await page.evaluate("() => { window.__scr = 793; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); }")
        await page.wait_for_timeout(600)
        v2 = await page.evaluate("() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-vh'))")
        ok('V2 po návratu z pozadí se výška nezmenší (žádný pruh dole)', v2 == 852, v2)
        h = await page.evaluate("() => document.getElementById('ag-jr').getBoundingClientRect().height")
        ok('V3 přebal jednoduchého režimu sahá až dolů (výška = --app-vh)', abs(h - 852) < 1, h)

        await page.evaluate("() => { document.querySelectorAll('.ag-dlg-overlay.open .ag-dlg-btn:not(.ag-ok)').forEach(b => b.click()); }")
        await page.click('#ag-jr-pridat')
        ok('D1 výchozí délka měření je 10 s', await V.cekej(page, "document.querySelector('[data-doba=\"10\"]').classList.contains('on')", 3))
        await page.click('[data-doba="30"]')
        ok('D2 volba 30 s se zapamatuje', await page.evaluate("() => localStorage.getItem('agJrDoba_v1') === '30' && document.querySelector('[data-doba=\"30\"]').classList.contains('on')"))
        await page.click('#ag-jr-zgps')
        ok('D3 měření běží 30 s', await V.cekej(page, "/ještě <b>(29|30) s/.test(document.getElementById('ag-jr-vysledek').innerHTML)", 3))
        await page.click('#ag-jr-zgps')
        ok('Z bez chyb stránky', not chyby, chyby[:5])
        await br.close()


def main():
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    n = len(VYSLEDKY); d = sum(VYSLEDKY)
    print('\n%d/%d OK' % (d, n))
    sys.exit(0 if d == n else 1)


if __name__ == '__main__':
    main()
