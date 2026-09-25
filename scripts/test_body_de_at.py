# -*- coding: utf-8 -*-
u"""ÚŘEDNÍ BODY V NĚMECKU A RAKOUSKU (25. 9. 2026, 6. hodnocení e1) — js/body-svet.js.

  AT  skutečné dlaždice data/body-at (BEV, scripts/body_at.py) → body kolem Vídně v arPoints, výška, řád.
  DE  Berlín: podstrčená odpověď AFIS WFS (tvar zachycený 25. 9. 2026) → NIVEL s výškou DHHN2016;
      mimo Berlín/MV/BW se nic nestahuje a appka řekne, že spolková země body nezveřejňuje.

python scripts/test_body_de_at.py [port]
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

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9096)
OKS = []
BE = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": "c_afis_hfp3.DEBE0701a0000003", "geometry": {"type": "Point", "coordinates": [13.41370678, 52.51167425]},
      "properties": {"uuid": "DEBE0701a0000003", "pkn": "3446761430", "bezpvm": "Mauerbolzen", "nal": "01-Mitte; Mitte; 10179; Köpenicker Str. 92", "crs": "ETRS89_UTM33", "rew": "  392349.626", "how": " 5819133.135", "crshoh2": "DE_DHHN2016_NH", "hoh2": "35.286", "uwd": "2022-07-01"}}]}
PRAZDNE = {"type": "FeatureCollection", "features": []}
DOTAZY = []


def ok(n, c, info=''):
    OKS.append(bool(c)); print(('OK    ' if c else 'CHYBA ') + n + ('' if c else '  -- %s' % (info,)))


async def route(rt, rq):
    u = rq.url
    if 'gdi.berlin.de' in u or 'geodaten-mv.de' in u or 'lgl-bw.de' in u:
        DOTAZY.append(u)
        body = BE if 'c_afis_hfp3' in u else PRAZDNE
        return await rt.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
    await V.route_vse(rt, rq)


async def beh():
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server'); sys.exit(1)
    try:
        async with async_playwright() as p:
            br = await p.chromium.launch()
            ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                       geolocation={'latitude': 48.2519, 'longitude': 16.3217, 'accuracy': 4}, permissions=['geolocation'], service_workers='block')
            page = await ctx.new_page()
            chyby = []
            page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
            await page.route('**/*', route)
            await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1', JSON.stringify({AT: 1, DE: 1, CZ: 1}));")
            await page.goto(url, wait_until='domcontentloaded', timeout=90000)
            ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
            await page.evaluate("() => new Promise(r => AGLazy.need('js/body-svet.js', r))")
            at = await page.evaluate("""async () => { AGSour.nastav('AT'); await new Promise(r => setTimeout(r, 300));
                var b = await AGBodySvet.stahni(AGBodySvet.ZEME.AT, 48.2519, 16.3217);
                var s = b.find(x => x.name === '1-40'); return { n: b.length, s: s && { cat: s.cat, vyska: s.vyska, druh: s.druh, nazev: s.nazevBodu, lat: s.lat } }; }""")
            ok('AT dlaždice BEV: body kolem Vídně (Sievering 1-40, výška ~248 m, TP 5. řádu)', at['n'] > 20 and at['s'] and at['s']['cat'] == 'TB' and 240 < at['s']['vyska'] < 256 and '5. Ordnung' in at['s']['druh'], at)
            de = await page.evaluate("""async () => { AGSour.nastav('DE'); await new Promise(r => setTimeout(r, 300));
                var b = await AGBodySvet.stahni(AGBodySvet.ZEME.DE, 52.5117, 13.4137); var s = b[0];
                var mimo = await AGBodySvet.stahni(AGBodySvet.ZEME.DE, 50.94, 6.96);
                return { n: b.length, s: s && { id: s.id, cat: s.cat, vyska: s.vyska, e: s.rawData.E_UTM33, popis: s.popis }, mimo: mimo.length, zdroj: AGBodySvet.zdrojPro('DE') }; }""")
            ok('DE Berlín: výškový bod AFIS → NIVEL, výška DHHN2016, UTM33', de['n'] == 1 and de['s']['id'] == 'de_be_3446761430' and de['s']['cat'] == 'NIVEL' and abs(de['s']['vyska'] - 35.286) < 1e-6 and abs(de['s']['e'] - 392349.626) < 1e-3, de)
            ok('DE Berlín: dotaz na 6 vrstev (hfp1–3, ggp1–3), mimo Berlín/MV/BW (Kolín) žádný dotaz', len(DOTAZY) == 6 and de['mimo'] == 0, (len(DOTAZY), de['mimo']))
            ok('DE zdroj pro kartu země', 'AFIS' in (de['zdroj'] or ''), de['zdroj'])
            ok('Z bez chyb v konzoli', not chyby, chyby[:4])
            await br.close()
    finally:
        srv.terminate()


def main():
    asyncio.run(beh())
    n = len(OKS); d = sum(OKS)
    print('\n%d/%d OK' % (d, n))
    sys.exit(0 if d == n else 1)


if __name__ == '__main__':
    main()
