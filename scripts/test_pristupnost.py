# -*- coding: utf-8 -*-
u"""PŘÍSTUPNOST (25. 9. 2026, 6. hodnocení c1) — axe-core + velké písmo.

1) axe-core (z jsdelivr) na hlavní obrazovce, v Novém bodu, Nástrojích, Nastavení (i stránka
   Vzhled), Mých bodech, kartě bodu, Cestě učení a panelu Totiho: žádné nálezy závažnosti
   critical/serious. Vědomá výjimka: meta-viewport (zvětšení stránky prsty by rozbilo gesta
   mapy a AR; náhradou je vlastní velikost písma, viz 2).
2) Velikost písma 200 % (Nastavení → Vzhled): hlavní okna nepřetékají do strany.

python scripts/test_pristupnost.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9084)
AXE = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js'
VYJIMKY = ['meta-viewport']
VYSLEDKY = []
ZAVRI = """() => { document.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; m.classList.remove('ag-open'); });
    const bs = document.getElementById('bottom-sheet'); if (bs) bs.classList.remove('open');
    ['ag-cu', 'ag-mk-panel'].forEach(id => { const e = document.getElementById(id); if (e) { if (id === 'ag-mk-panel') e.remove(); else e.style.display = 'none'; } }); }"""
OBRAZOVKY = [
    ('hlavní obrazovka', None),
    ('Nový bod', "() => openNewPointModal()"),
    ('Nástroje', "() => document.getElementById('dock-nastroje-btn').click()"),
    ('Nastavení', "() => openSettings()"),
    ('Nastavení → Vzhled', "() => { openSettings(); switchTab('tab-vzhled'); }"),
    ('Mé body', "() => openManageModal()"),
    ('karta bodu', "() => { const p = arPoints.find(x => x.cat === 'TB') || arPoints[0]; if (p) showDetails(p, 20); }"),
    ('Cesta učení', "() => AGLazyTools.load('js/cesta-uceni.js').then(() => agOpenCesta())"),
    ('panel Totiho', "() => AGMaskot.nastaveni()"),
]


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:900]))


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
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        await page.evaluate("() => Promise.all(['js/pristupnost.js', 'js/maskot.js'].map(s => new Promise(r => AGLazy.need(s, r))))")
        ok('A1 modul přístupnosti běží', await V.cekej(page, "!!window.AGPristupnost", 60))
        await page.wait_for_timeout(2500)
        await page.add_script_tag(url=AXE)
        ok('A2 axe-core načtený', await V.cekej(page, "!!window.axe", 40))
        for jm, js in OBRAZOVKY:
            await page.evaluate(ZAVRI)
            if js:
                await page.evaluate(js)
            await page.wait_for_timeout(1600)
            await page.evaluate("() => AGPristupnost.obnov()")
            r = await page.evaluate("""async (vyj) => { const rules = {}; vyj.forEach(v => rules[v] = { enabled: false });
                const r = await axe.run(document, { resultTypes: ['violations'], rules });
                return r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious').map(v => v.id + ' ×' + v.nodes.length + ': ' + v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')); }""", VYJIMKY)
            ok('X %s: žádné kritické ani vážné nálezy axe' % jm, not r, r)
        # velké písmo 200 %
        await page.evaluate(ZAVRI)
        await page.evaluate("() => { document.documentElement.style.setProperty('--ag-font-scale', 2); }")
        for jm, js in OBRAZOVKY[:7]:
            await page.evaluate(ZAVRI)
            if js:
                await page.evaluate(js)
            await page.wait_for_timeout(1000)
            pr = await page.evaluate("() => ({ sw: document.documentElement.scrollWidth, w: innerWidth })")
            ok('P %s při písmu 200 %%: nic nepřetéká do strany' % jm, pr['sw'] <= pr['w'] + 1, pr)
        ok('P0 jezdec Velikost písma jde do 200 %', await page.evaluate("() => document.getElementById('v-font-scale').max === '200'"))
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
