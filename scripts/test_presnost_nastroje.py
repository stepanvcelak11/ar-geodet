# -*- coding: utf-8 -*-
u"""STAČÍ NA TO TELEFON? (6. 10. 2026, hodnocení — návrh 3).

Kontroluje: nástroj s `acc` v registru (vytyčení podle seznamu, ±0,10 m) při přesnosti telefonu
±4 m po spuštění ukáže pruh „Na tohle telefon teď nestačí“ s oběma čísly; nástroj se přitom
normálně otevře (nic se neblokuje); „Jak zpřesnit“ otevře Jak měřit přesně z mobilu; „U tohoto už
neukazovat“ se zapamatuje; nástroj bez `acc` nic neukáže; při dost dobré přesnosti taky nic.

python scripts/test_presnost_nastroje.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9095)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


ZAVRI = "() => { document.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; m.classList.remove('ag-open'); }); const p = document.getElementById('ag-pn-pruh'); if (p) p.remove(); }"


async def otevri(page, k):
    await page.evaluate(ZAVRI)
    await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
    await page.wait_for_timeout(800)
    await page.evaluate("(k) => { for (let i = 0; i < 3; i++) document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click()); const r = document.querySelector('#tools-modal .ag-uk-i[data-k=\"' + k + '\"]'); if (r) { r.scrollIntoView(); r.click(); } }", k)
    await page.wait_for_timeout(1500)


PRUH = "() => { const p = document.getElementById('ag-pn-pruh'); return p ? p.textContent : null; }"


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
        await page.evaluate("() => Promise.all(['js/nejistota.js', 'js/presnost-nastroje.js'].map(s => new Promise(r => AGLazy.need(s, r))))")
        ok('A1 modul načtený, registr zná potřebnou přesnost vytyčení (±0,1 m)', await V.cekej(page, "!!window.AGPresnostNastroje && AGReg.get('openStakeoutModal').acc === 0.1", 60))

        await page.evaluate("() => { currentGpsAccuracy = 4; }")
        await otevri(page, 'openStakeoutModal')
        txt = await page.evaluate(PRUH)
        ok('P1 vytyčení při ±4 m: pruh „Na tohle telefon teď nestačí“ s ±0,10 m a ±4,0 m', txt and 'nestačí' in txt and '±0,10 m' in txt and '±4,0 m' in txt, txt)
        ok('P2 nástroj se přitom otevřel (nic se neblokuje)', await page.evaluate("() => { const m = document.getElementById('stakeout-modal') || document.querySelector('.modal-overlay[style*=\"flex\"]'); return !!m && getComputedStyle(m).display !== 'none'; }"))
        ok('P3 pruh leží nad oknem nástroje', await page.evaluate("() => { const p = document.getElementById('ag-pn-pruh'); const r = p.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + 12) && p.contains(document.elementFromPoint(r.left + r.width / 2, r.top + 12)); }"))
        await page.evaluate("() => document.querySelector('#ag-pn-pruh button[data-a=jak]').click()")
        ok('J1 „Jak zpřesnit“ otevře Jak měřit přesně z mobilu', await V.cekej(page, "!!window.AGPresneMereni || !!document.querySelector('[id*=\"presne\"][style*=\"flex\"], [id*=\"presne\"].ag-open')", 30))

        await otevri(page, 'openStakeoutModal')
        await page.evaluate("() => document.querySelector('#ag-pn-pruh button[data-a=skryt]').click()")
        await otevri(page, 'openStakeoutModal')
        ok('S1 „U tohoto už neukazovat“ se zapamatuje', await page.evaluate(PRUH) is None and await page.evaluate("() => !!JSON.parse(localStorage.getItem('agPresnostNastroje_v1')).skryte.openStakeoutModal"))

        await otevri(page, 'kompas')
        ok('N1 nástroj bez potřebné přesnosti (Kompas) nic neukáže', await page.evaluate(PRUH) is None)
        await page.evaluate("() => { currentGpsAccuracy = 0.5; }")
        await otevri(page, 'rajon')
        ok('N2 rajón (±1 m) při ±0,5 m nic neukáže', await page.evaluate(PRUH) is None)
        await page.evaluate("() => { currentGpsAccuracy = 3; }")
        await otevri(page, 'rajon')
        ok('N3 rajón při ±3 m pruh ukáže', 'nestačí' in (await page.evaluate(PRUH) or ''))
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
