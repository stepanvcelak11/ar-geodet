# -*- coding: utf-8 -*-
u"""JEDNODUCHÝ REŽIM S MAPOU (4. 11. 2026, js/jednoduchy-rezim.js).

Na domovské stránce okno s mapou appky (prvek #map se přesune, žádná druhá mapa),
klepnutí na bod v mapě = karta bodu → navigace, v navigaci menší mapa s čarou k cíli a „Poslat bod",
po odchodu z režimu je #map zpátky v #map-wrapper.

python scripts/test_jednoduchy_mapa.py [port] [--snimek]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9133)
SNIMEK = '--snimek' in sys.argv
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


# Headless Chromium nemá kompas → appka ukáže „Kompas nemá povolení" přes celou obrazovku.
ZAVRI = "() => { document.querySelectorAll('.ag-dlg-overlay.open .ag-dlg-btn:not(.ag-ok)').forEach(b => b.click()); }"


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True, service_workers='block', device_scale_factor=2 if SNIMEK else 1,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.setItem('agJednoduchy_v1','1'); localStorage.setItem('agDomov_v1', JSON.stringify({auto:false}));")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start v jednoduchém režimu', await V.cekej(page, "document.body.classList.contains('app-started') && document.body.classList.contains('ag-jr-on')", 60))
        ok('A1 mapa appky je v okně domovské stránky (žádná druhá mapa)', await V.cekej(page, "document.getElementById('map').parentNode.id === 'ag-jr-mapa-home' && !document.getElementById('ag-jr-mapa-home').hidden && document.querySelectorAll('.leaflet-container').length === 1", 15))
        r = await page.evaluate("() => { const m = document.getElementById('ag-jr-mapa-home').getBoundingClientRect(); const b = document.getElementById('ag-jr-pridat').getBoundingClientRect(); return { mh: m.height, bh: b.height, bb: b.bottom, vh: innerHeight }; }")
        ok('A2 okno mapy je velké, tlačítka pořád na palec (≥ 84 px) a na displeji', r['mh'] > 250 and r['bh'] >= 84 and r['bb'] <= r['vh'], r)
        # bod 20 m severně
        await page.evaluate("(a) => { addImportedPoints([{ name: '501', lat: a[0] + 20/111320, lng: a[1] }]); }", [V.LAT, V.LNG])
        await page.wait_for_timeout(500)
        await page.evaluate("() => AGJednoduchy.zapni()")   # znovu domů → souhrn
        await page.evaluate(ZAVRI)
        ok('A3 souhrn nad tlačítky (počet bodů, poslední)', await V.cekej(page, "/501/.test(document.getElementById('ag-jr-souhrn').textContent)", 5))
        await page.wait_for_timeout(600)
        pt = await page.evaluate("(a) => { const q = map.latLngToContainerPoint([a[0] + 20/111320, a[1]]); const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + q.x + 6, y: r.top + q.y - 4 }; }", [V.LAT, V.LNG])
        if SNIMEK:
            await page.evaluate(ZAVRI)
            await page.wait_for_timeout(2500)
            await page.screenshot(path=os.path.join(os.environ.get('SNIMKY', '.'), 'jr-domu.png'))
        await page.evaluate(ZAVRI)
        await page.wait_for_timeout(400)
        await page.mouse.click(pt['x'], pt['y'])
        # od 14. 11. 2026 klepnutí otevře KARTU BODU, navigace až tlačítkem v ní
        ok('B0 klepnutí na bod v mapě otevře kartu bodu', await V.cekej(page, "!document.getElementById('ag-jr-karta').hidden && /501/.test(document.getElementById('ag-jr-karta').textContent) && AGJednoduchy.stranka() === 'home'", 5), pt)
        await page.click('#ag-jr-karta-jit')
        ok('B1 „Navigovat sem" na kartě spustí navigaci k bodu', await V.cekej(page, "AGJednoduchy.stranka() === 'go' && /501/.test(document.getElementById('ag-jr-cilnazev').textContent)", 5), pt)
        ok('B2 v navigaci je mapa s čarou k cíli', await V.cekej(page, "document.getElementById('map').parentNode.id === 'ag-jr-mapa-go' && !!document.querySelector('#map path.leaflet-interactive[stroke-dasharray], #map path[stroke-dasharray=\"8 8\"]')", 5))
        ok('B3 tlačítko Poslat bod', await page.evaluate("() => !!document.getElementById('ag-jr-poslat') && document.getElementById('ag-jr-poslat').getClientRects().length > 0"))
        if SNIMEK:
            await page.wait_for_timeout(800)
            await page.screenshot(path=os.path.join(os.environ.get('SNIMKY', '.'), 'jr-navigace.png'))
        # žádný modál plné appky se klepnutím do mapy neotevřel
        mod = await page.evaluate("() => Array.from(document.querySelectorAll('.modal-overlay')).filter(m => m.style.display === 'flex' || m.classList.contains('open')).map(m => m.id)")
        ok('B4 klepnutí do mapy neotevřelo nic z plné appky', not mod, mod)
        await page.evaluate(ZAVRI)
        await page.click('[data-jr-zpet="list"]')
        ok('C1 seznam bodů: mapa se vrátila na své místo', await V.cekej(page, "document.getElementById('map').parentNode.id === 'map-wrapper' && !document.querySelector('#map path[stroke-dasharray=\"8 8\"]')", 5))
        await page.click('#ag-jr-list [data-jr-zpet="home"]')
        ok('C2 zpět domů: mapa zase v okně', await V.cekej(page, "document.getElementById('map').parentNode.id === 'ag-jr-mapa-home'", 5))
        await page.evaluate(ZAVRI); await page.click('#ag-jr-konec')
        ok('C3 Celá appka: #map zpátky v #map-wrapper, režim vypnutý', await V.cekej(page, "document.getElementById('map').parentNode.id === 'map-wrapper' && !document.body.classList.contains('ag-jr-on')", 5))
        ok('Z bez chyb stránky', not chyby, chyby[:5])
        await ctx.close()
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
