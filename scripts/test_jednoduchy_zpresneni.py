# -*- coding: utf-8 -*-
u"""PRŮVODCE „ZPŘESNIT GPS" V JEDNODUCHÉM REŽIMU (16. 11. 2026).

Hlášení: „kalibrace mi nejde naklikat v jednoduchém režimu na obrazovku mapy, protože když si
zobrazím mapu, tak se mi ten nástroj vypne". Kalibrace chůzí po hraně má teď v režimu vlastní
tři kroky (klepni hranu → JDU → ZAPNOUT), počítá ji pořád js/kalibrace-hranou.js.

  O  Vrstvy → Zpřesnit GPS otevře průvodce v režimu (žádná pauza, podklad ortofoto)
  C  klepání do mapy přidává vrcholy, Vrátit bod, krátká hrana se nepustí dál
  W  chůze s GPS posunutou o 2 m na sever → průběh, výsledek ≈ 2 m
  A  ZAPNOUT ZPŘESNĚNÍ → korekce zapnutá (src hrana), domů, podklad zpátky
  P  Plná verze nástroje otevře původní okno
  Z  bez chyb stránky
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9146)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


ZAVRI = "() => { document.querySelectorAll('.ag-dlg-overlay.open .ag-dlg-btn:not(.ag-ok)').forEach(b => b.click()); }"
M = 111320.0


async def klepni_ll(page, lat, lng):
    xy = await page.evaluate("(a) => { const p = map.latLngToContainerPoint([a[0], a[1]]), r = document.getElementById('map').getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; }", [lat, lng])
    await page.mouse.click(xy[0], xy[1])
    await page.wait_for_timeout(350)


async def beh(url):
    import math
    ml = M * math.cos(V.LAT * math.pi / 180)
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, service_workers='block',
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agJednoduchy_v1','1'); localStorage.setItem('agDomov_v1', JSON.stringify({auto:false}));")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        await V.cekej(page, "document.body.classList.contains('ag-jr-on')", 60)
        await page.wait_for_timeout(800)
        await page.evaluate(ZAVRI)
        # Pro se ověřuje až po startu — dřív by klepnutí ukázalo kartu Pro (v CI se to stalo)
        await V.cekej(page, "!!window.AGProZamky && !AGProZamky.zamceno('kalibrace-hranou')", 30)
        podklad0 = await page.evaluate("() => visSettings.baseLayer")

        # ---- O otevření
        await page.click('#ag-jr-vrstvy-btn')
        await page.click('#ag-jr-vrstvy [data-vr="hrana"]')
        ok('O1 průvodce se otevře v jednoduchém režimu', await V.cekej(page, "AGJednoduchy.stranka() === 'hr' && !AGJednoduchy.pauza()", 10),
           await page.evaluate("() => [AGJednoduchy.stranka(), AGJednoduchy.pauza(), typeof window.AGHrana, window.AGHrana && Object.keys(AGHrana), !!window.AGProZamky && AGProZamky.zamceno('kalibrace-hranou'), [...document.querySelectorAll('.ag-dlg-overlay.open, .modal-overlay')].filter(e => getComputedStyle(e).display !== 'none').map(e => (e.id || '') + ':' + e.innerText.slice(0, 60))]"))
        ok('O2 mapa je v okně průvodce', await V.cekej(page, "!!document.querySelector('#ag-jr-mapa-hr #map')", 5))
        ok('O3 podklad se přepnul na ortofoto', await V.cekej(page, "visSettings.baseLayer === 'ortofoto'", 5), podklad0)
        ok('O4 DALŠÍ je bez hrany zamčené', await page.evaluate("() => document.getElementById('ag-jr-hr-btn').disabled"))
        await page.wait_for_timeout(500)
        await page.evaluate("() => { map.setView([%f, %f], 19, {animate:false}); }" % (V.LAT, V.LNG))
        await page.wait_for_timeout(300)

        # ---- C klepání (hrana 30 m západ→východ přes moji polohu)
        A = (V.LAT, V.LNG - 15 / ml)
        B = (V.LAT, V.LNG + 15 / ml)
        await klepni_ll(page, A[0], A[1])
        ok('C1 klepnutí přidá vrchol', await page.evaluate("() => AGHrana.pruvodce.cara().n") == 1)
        await klepni_ll(page, V.LAT, V.LNG - 6 / ml)   # 9 m
        ok('C2 krátká hrana: DALŠÍ zamčené a upozornění', await page.evaluate("() => document.getElementById('ag-jr-hr-btn').disabled && /krátká/.test(document.getElementById('ag-jr-hr-info').textContent)"),
           await page.evaluate("() => document.getElementById('ag-jr-hr-info').textContent"))
        await page.click('#ag-jr-hr-mala [data-hr="zpet"]')
        ok('C3 Vrátit bod', await page.evaluate("() => AGHrana.pruvodce.cara().n") == 1)
        await klepni_ll(page, B[0], B[1])
        c = await page.evaluate("() => AGHrana.pruvodce.cara()")
        ok('C4 hrana 2 body ~30 m, DALŠÍ odemčené', c['n'] == 2 and 27 < c['delka'] < 33 and not await page.evaluate("() => document.getElementById('ag-jr-hr-btn').disabled"), c)
        ok('C5 čára je v mapě', await page.evaluate("() => document.querySelectorAll('#ag-jr-mapa-hr path.leaflet-interactive').length >= 1"))
        await page.click('#ag-jr-hr-btn')
        ok('C6 krok 2: JDU', await page.evaluate("() => /JDU/.test(document.getElementById('ag-jr-hr-btn').textContent)"))

        # ---- W chůze: GPS 2 m na sever od hrany, tam i zpět
        await ctx.set_geolocation({'latitude': A[0] + 2 / M, 'longitude': A[1], 'accuracy': 4})
        await page.wait_for_timeout(400)
        await page.click('#ag-jr-hr-btn')
        ok('W1 chůze běží', await page.evaluate("() => !!AGHrana.pruvodce.chuze()"))
        kroky = 26
        for i in list(range(kroky + 1)) + list(range(kroky, -1, -1)):
            x = -15 + 30.0 * i / kroky
            await ctx.set_geolocation({'latitude': V.LAT + 2 / M, 'longitude': V.LNG + x / ml, 'accuracy': 4})
            await page.wait_for_timeout(90)
        await page.wait_for_timeout(600)
        st = await page.evaluate("() => AGHrana.pruvodce.chuze()")
        ok('W2 průběh: měření i prošlá délka', st and st['n'] >= 12 and st['prosel'] >= 25, st)
        ok('W3 na obrazovce je průběh', await page.evaluate("() => !!document.querySelector('#ag-jr-hr-info .jr-hr-prubeh') && /prošel jsi/.test(document.getElementById('ag-jr-hr-info').textContent)"))
        await page.click('#ag-jr-hr-btn')
        r = await page.evaluate("() => AGHrana.pruvodce.vysledek()")
        ok('W4 výsledek ≈ 2 m na sever', r and not r.get('err') and abs(r['vN'] - 2) < 0.4 and abs(r['vE']) < 0.6, r)
        ok('W5 obrazovka výsledku: číslo a ZAPNOUT', await page.evaluate("() => /[12],\\d m/.test(document.getElementById('ag-jr-hr-info').textContent) && /ZAPNOUT/.test(document.getElementById('ag-jr-hr-btn').textContent)"),
           await page.evaluate("() => document.getElementById('ag-jr-hr-info').textContent"))

        # ---- A zapnout
        await page.click('#ag-jr-hr-btn')
        await page.wait_for_timeout(800)
        ok('A0 bez vyskakovacích hlášek (podklad se vrací tiše, i bez signálu)', await page.evaluate("() => !document.querySelector('.ag-dlg-overlay.open')"),
           await page.evaluate("() => [...document.querySelectorAll('.ag-dlg-overlay.open')].map(d => d.innerText.slice(0, 80))"))
        await page.evaluate(ZAVRI)
        s = await page.evaluate("() => window.agRefShift")
        ok('A1 korekce zapnutá z hrany, posun ≈ −2 m', s and s.get('on') and s.get('src') == 'hrana' and abs(s['dlat'] * M + 2) < 0.4, s)
        ok('A2 zpátky na domovské stránce', await page.evaluate("() => AGJednoduchy.stranka() === 'home'"))
        ok('A3 podklad se vrátil', await V.cekej(page, "visSettings.baseLayer === %r" % podklad0, 5), await page.evaluate("() => visSettings.baseLayer"))
        ok('A4 stav GPS ukazuje korekci', await V.cekej(page, "/korekce/.test(document.getElementById('ag-jr-stav').textContent)", 3))
        ok('A5 čára z mapy zmizela', await page.evaluate("() => !document.querySelector('#map path[stroke=\"#fbbf24\"]')"))

        # ---- P plná verze + znovu průvodce ukáže zapnuté zpřesnění
        await page.click('#ag-jr-vrstvy-btn')
        await page.click('#ag-jr-vrstvy [data-vr="hrana"]')
        await V.cekej(page, "AGJednoduchy.stranka() === 'hr'", 5)
        ok('P1 průvodce hlásí zapnuté zpřesnění a nabízí vypnutí', await page.evaluate("() => /zapnuté/.test(document.getElementById('ag-jr-hr-info').textContent) && !!document.querySelector('#ag-jr-hr-mala [data-hr=\"vypnout\"]')"))
        await page.click('#ag-jr-hr-plna')
        ok('P2 Plná verze otevře okno kalibrace', await V.cekej(page, "AGJednoduchy.pauza() && getComputedStyle(document.getElementById('ag-hr-modal')).display !== 'none'", 6))
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
