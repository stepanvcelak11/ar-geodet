# -*- coding: utf-8 -*-
u"""KRUH NEJISTOTY U NAVIGOVANÉHO BODU (6. 10. 2026, hodnocení — návrh 4).

Kontroluje: σ_bod = √(σ_GPS² + (d·sin σ_kompas)²) stejně jako „Proč ±4 m?“; po zvýraznění bodu
je v mapě přerušovaný kruh o poloměru přesnosti GPS; snímek AR (renderAR) nakreslí kolem bodu
elipsu a HUD řekne „hledej v okruhu ±X m“; stojím-li uvnitř oblasti, elipsa zmizí a HUD řekne
„hledej kolem sebe“; vypínač na obrazovce „Proč ±4 m?“ vše uklidí; bez zvýrazněného bodu nic.

python scripts/test_nejistota.py [port]
"""
import os
import sys
import math
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9093)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


# bod 30 m severně od testovací polohy; telefon míří na sever, kamera mírně dolů
BOD = """(dLat) => { const lat = userLat + dLat, lng = userLng;
  window.addImportedPoints([{ name: 'NEJ-1', lat: lat, lng: lng, origin: 'import' }]);
  const p = arPoints.find(x => x.name === 'NEJ-1'); highlightedPointId = p.id; return p.id; }"""
# (viewMode se nastaví i tady: přepínání oken mezitím umí vrátit samotnou mapu, kde se AR nepromítá)
SNIMEK = "() => { if (viewMode === 'map') viewMode = 'both'; renderAR({ webkitCompassHeading: 0, alpha: 0, beta: 70, gamma: 0 }); }"


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started') && !!userLat", 60))
        await page.evaluate("() => new Promise(r => AGLazy.need('js/nejistota.js', r))")
        ok('A1 modul načtený', await V.cekej(page, "!!window.AGNejistota", 60))

        # ---- výpočet ----
        s = await page.evaluate("() => { currentGpsAccuracy = 4; localStorage.removeItem('agCalibInfo'); window.AGFix && (AGFix.n = 0); return AGNejistota.sigma(30, true); }")
        cekam = math.sqrt(4 ** 2 + (30 * math.sin(math.radians(s['kompas']))) ** 2)
        ok('V1 σ_bod = √(σ_GPS² + (d·sin σ_k)²)', abs(s['bod'] - cekam) < 1e-6 and s['gps'] == 4, (s, cekam))
        m = await page.evaluate("() => AGNejistota.sigma(30, false)")
        ok('V2 v mapě jen poloha (kompas nehraje roli)', abs(m['bod'] - 4) < 1e-9, m)
        # stejná čísla jako obrazovka „Proč ±4 m?“
        await page.evaluate("() => new Promise(r => AGLazy.need('js/chybovy-rozpocet.js', r))")
        await V.cekej(page, "typeof window.agOpenChybovyRozpocet === 'function'", 30)
        await page.evaluate("() => agOpenChybovyRozpocet()")
        await page.wait_for_timeout(500)
        big = await page.evaluate("() => (document.querySelector('#ag-cr-modal .cr-big') || {}).textContent || ''")
        ok('V3 „Proč ±4 m?“ má vypínač kruhu nejistoty a počítá z týchž senzorů', await page.evaluate("() => !!document.getElementById('ag-cr-nej') && document.getElementById('ag-cr-nej').checked") and '±' in big, big)
        await page.evaluate("() => { document.getElementById('ag-cr-modal').style.display = 'none'; }")

        # ---- mapa ----
        await page.evaluate("() => { viewMode = 'both'; applyViewMode(); }")
        await page.evaluate(BOD, 30 / 111320)
        await page.evaluate("() => AGNejistota._test.mapaTik()")
        kr = await page.evaluate("""() => { let c = null; map.eachLayer(l => { if (l instanceof L.Circle && l.options.dashArray === '6 5') c = l; });
            return c ? { r: c.getRadius(), lat: c.getLatLng().lat, cil: arPoints.find(x => x.name === 'NEJ-1').lat } : null; }""")
        ok('M1 v mapě přerušovaný kruh kolem bodu, poloměr = přesnost GPS', kr and abs(kr['r'] - 4) < 0.1 and abs(kr['lat'] - kr['cil']) < 1e-9, kr)

        # ---- AR ----
        ma_render = await page.evaluate("() => typeof renderAR === 'function'")
        ok('R0 renderAR je k dispozici', ma_render)
        await page.evaluate(SNIMEK)
        ar = await page.evaluate("""() => { const poly = document.querySelector('#ag-nej-ar polygon'); const h = document.getElementById('ag-nej-hud');
            return { n: poly ? poly.getAttribute('points').split(' ').length : 0, hud: h ? h.textContent : '', vid: h ? h.style.display !== 'none' : false }; }""")
        ok('R1 snímek AR nakreslí elipsu kolem navigovaného bodu', ar['n'] == 32, ar)
        ok('R2 HUD: „hledej v okruhu ±X m“', ar['vid'] and 'hledej v okruhu ±' in ar['hud'], ar)
        # stojím uvnitř oblasti (bod 2 m daleko, σ ≥ 4 m)
        await page.evaluate("() => { const p = arPoints.find(x => x.name === 'NEJ-1'); p.lat = userLat + 2 / 111320; p.currentDist = null; }")
        await page.evaluate(SNIMEK)
        uv = await page.evaluate("() => ({ n: document.querySelectorAll('#ag-nej-ar polygon').length, hud: document.getElementById('ag-nej-hud').textContent })")
        ok('R3 uvnitř oblasti: elipsa zmizí, HUD „hledej kolem sebe“', uv['n'] == 0 and 'kolem sebe' in uv['hud'], uv)
        # vypínač
        await page.evaluate("() => { const p = arPoints.find(x => x.name === 'NEJ-1'); p.lat = userLat + 30 / 111320; AGNejistota.zapni(false); }")
        await page.evaluate(SNIMEK)
        vy = await page.evaluate("""() => { let c = 0; map.eachLayer(l => { if (l instanceof L.Circle && l.options.dashArray === '6 5') c++; });
            const h = document.getElementById('ag-nej-hud'); return { poly: document.querySelectorAll('#ag-nej-ar polygon').length, kruh: c, hud: h && h.style.display !== 'none' }; }""")
        ok('O1 vypnuto: žádná elipsa, kruh ani řádek v HUD', vy['poly'] == 0 and vy['kruh'] == 0 and not vy['hud'], vy)
        await page.evaluate("() => AGNejistota.zapni(true)")
        # bez navigovaného bodu
        await page.evaluate("() => { highlightedPointId = null; }")
        await page.evaluate(SNIMEK)
        await page.evaluate("() => AGNejistota._test.mapaTik()")
        bez = await page.evaluate("""() => { let c = 0; map.eachLayer(l => { if (l instanceof L.Circle && l.options.dashArray === '6 5') c++; });
            return { poly: document.querySelectorAll('#ag-nej-ar polygon').length, kruh: c }; }""")
        ok('O2 bez navigovaného bodu nic', bez['poly'] == 0 and bez['kruh'] == 0, bez)
        ok('Z bez chyb v konzoli', not chyby, chyby[:5])
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
