# -*- coding: utf-8 -*-
u"""v387 (23. 9. 2026, 5. hodnocení — n4 + n2; n3 hlídá scripts/test_start_bez_chyb.py):
  D1  „Funguje mi všechno?“ má řádek Displej (celá obrazovka / okno prohlížeče, výřez)
  D2  s výřezem iPhonu a režimem z plochy (display-mode: standalone) = zelený „celá obrazovka“
  V1  prázdný Vytyčovací checklist: Nahrát ze souboru + Body z fotky + Ukázat i úřední body
  V2  „Ukázat i úřední body“ vypne filtr Jen vlastní body
  P1  prázdný Protokol vytyčení: tlačítko Otevřít Vytyčovací checklist (a opravdu ho otevře)
python scripts/test_v387.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9051)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


async def otevri_zdravi(page):
    await page.evaluate("() => new Promise(r => { const go = () => { AGZdravi.open ? AGZdravi.open() : window.agOpenZdravi(); r(); }; if (window.AGZdravi) go(); else AGLazy.need('js/zdravi-appky.js', go); })")
    await V.cekej(page, "!!document.querySelector('#ag-zdravi-body .zd-row[data-k=displej]')", 20)
    return await page.evaluate("() => { const r = document.querySelector('#ag-zdravi-body .zd-row[data-k=displej]'); return r ? { st: r.className, tx: r.textContent } : null; }")


async def beh(url):
    chyby = []
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ');")
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        ok('A0 appka nastartovala', await V.cekej(page, "document.body.classList.contains('app-started')", 40))
        await page.wait_for_timeout(1500)

        d1 = await otevri_zdravi(page)
        ok('D1 „Funguje mi všechno?“ má řádek Displej', d1 and 'Displej' in d1['tx'], d1)
        await page.evaluate("() => { const m = document.getElementById('ag-zdravi-modal'); if (m) m.style.display = 'none'; }")

        # D2: výřez iPhonu + „spuštěno z plochy“
        cdp = await ctx.new_cdp_session(page)
        await cdp.send('Emulation.setSafeAreaInsetsOverride', {'insets': {'top': 59, 'bottom': 34, 'left': 0, 'right': 0}})
        await page.evaluate("""() => { const mm = window.matchMedia.bind(window);
            window.matchMedia = q => /display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); }""")
        d2 = await otevri_zdravi(page)
        ok('D2 z plochy s výřezem → zelený řádek „celá obrazovka · výřez 59 / 34 px“', d2 and ' ok' in (' ' + d2['st']) and 'celá obrazovka' in d2['tx'] and '59 / 34' in d2['tx'], d2)
        await page.evaluate("() => { const m = document.getElementById('ag-zdravi-modal'); if (m) m.style.display = 'none'; }")

        # V: prázdný checklist (zakázka bez vlastních bodů, filtr Jen vlastní body zapnutý)
        await page.evaluate("() => new Promise(r => AGLazy.need('js/vytycovani.js', () => { openStakeoutModal(); r(); }))")
        await page.wait_for_timeout(700)
        v1 = await page.evaluate("() => [...document.querySelectorAll('#stakeout-modal .ag-empty-body button')].map(b => b.textContent.trim())")
        ok('V1 prázdný checklist: Nahrát ze souboru, Body z fotky, Ukázat i úřední body', 'Nahrát ze souboru' in v1 and 'Body z fotky' in v1 and 'Ukázat i úřední body' in v1, v1)
        await page.evaluate("() => { const b = [...document.querySelectorAll('#stakeout-modal .ag-empty-body button')].find(x => /úřední/.test(x.textContent)); b && b.click(); }")
        await page.wait_for_timeout(500)
        ok('V2 „Ukázat i úřední body“ vypne filtr', await page.evaluate("() => !document.getElementById('stk-only-custom').checked && stakeoutOnlyCustom === false"))
        await page.evaluate("() => { document.getElementById('stakeout-modal').style.display = 'none'; }")

        # P: prázdný protokol vytyčení
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(1500)
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(800)
        await page.evaluate("() => { for (let i = 0; i < 3; i++) document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click()); const r = document.querySelector('#tools-modal .ag-uk-i[data-k=\"protokol-vytyceni\"]'); if (r) { r.scrollIntoView(); r.click(); } }")
        await page.wait_for_timeout(1200)
        ma = await page.evaluate("() => !!document.getElementById('ag-pv-go-check')")
        await page.evaluate("() => { const b = document.getElementById('ag-pv-go-check'); b && b.click(); }")
        await page.wait_for_timeout(700)
        ok('P1 prázdný protokol → Otevřít Vytyčovací checklist (otevře ho)', ma and await page.evaluate("() => document.getElementById('stakeout-modal').style.display === 'flex'"), ma)

        ok('E1 bez chyb stránky', not chyby, chyby[:4])
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
