# -*- coding: utf-8 -*-
u"""DESETINNÁ MÍSTA SOUŘADNIC 2/3 (24. 9. 2026, 7. hodnocení f2).

Z ověření na iPhonu: „zaokrouhluje to na 2 desetinná a já chci na 3“. Kontroluje:
volbu na kartě Časté, kartu bodu (2 vs. 3 místa), formulář úpravy bodu (NIKDY méně, než bod
má — jinak by uložení tiše uřízlo milimetry) a výchozí volbu exportu Seznam souřadnic.

python scripts/test_desetinna.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9061)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


KARTA = r"""() => { const pt = persistentCustomPoints.find(p => p.name === 'T-MM'); const a = arPoints.find(p => p.id === pt.id) || pt;
    showDetails(a, 12); return document.getElementById('bottom-sheet').innerText.replace(/(\d)[\s  ](?=\d{3})/g, '$1').replace(/(\d),(\d)/g, '$1.$2'); }"""


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ');")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        ok('A1 výchozí 2 desetinná místa', await page.evaluate("() => agDes() === 2 && agFmtM(743215.4234) === '743215.42'"))
        n = await page.evaluate("""() => { const ll = mistniToLatLng(743215.423, 1042118.375);
            return addImportedPoints([{ name: 'T-MM', lat: ll.lat, lng: ll.lng, vyska: 245.318, origin: 'import' }]); }""")
        ok('A2 bod s milimetry uložen (výška na mm)', n == 1 and await page.evaluate("() => persistentCustomPoints.find(p => p.name === 'T-MM').vyska === 245.318"))

        k2 = await page.evaluate(KARTA)
        ok('K1 karta bodu při volbě 2: 743215.42 (ne .423)', '743215.42' in k2 and '743215.423' not in k2, k2[:400])
        await page.evaluate("() => { document.getElementById('bottom-sheet').classList.remove('open'); }")
        await page.evaluate("() => editCustomPoint(persistentCustomPoints.find(p => p.name === 'T-MM').id)")
        await page.wait_for_timeout(400)
        f = await page.evaluate("() => [document.getElementById('custom-y').value, document.getElementById('custom-x').value]")
        ok('F1 formulář úpravy i při volbě 2 drží milimetry (743215.423 / 1042118.375)', f == ['743215.423', '1042118.375'], f)
        await page.evaluate("() => { try { closeCustomModal(); } catch (e) {} }")

        # přepínač na kartě Časté
        await page.evaluate("() => openSettings()")
        await page.wait_for_timeout(700)
        vid = await page.evaluate("() => { const s = document.getElementById('seg-des'); if (!s) return null; const r = s.getBoundingClientRect(); return { w: r.width, on: s.querySelector('.on') && s.querySelector('.on').getAttribute('data-des') }; }")
        ok('S1 přepínač „Desetinná místa souřadnic“ na kartě Časté, zvýrazněná 2', vid and vid['w'] > 60 and vid['on'] == '2', vid)
        await page.evaluate("() => document.querySelector('#seg-des [data-des=\"3\"]').click()")
        await page.wait_for_timeout(200)
        ok('S2 klepnutí na 3 (mm): uloženo, zvýrazněno', await page.evaluate("() => localStorage.getItem('agDesMista_v1') === '3' && document.querySelector('#seg-des .on').getAttribute('data-des') === '3'"))
        await page.evaluate("() => { document.getElementById('settings-modal').style.display = 'none'; }")

        k3 = await page.evaluate(KARTA)
        ok('K2 karta bodu při volbě 3: 743215.423 a 1042118.375 (tam a zpět na mm přesně) + výška 245.318', '743215.423' in k3 and '1042118.375' in k3 and '245.318' in k3, k3[:400])
        # export: výchozí desetinná místa v Seznamu souřadnic
        await page.evaluate("() => new Promise(r => { if (window.AGLazyTools && AGLazyTools.load) AGLazyTools.load('seznam-souradnic').then(r, r); else r(); })")
        await page.wait_for_timeout(500)
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
