# -*- coding: utf-8 -*-
u"""HLÁŠENÍ PROVOZU (14. 11. 2026, js/hlaseni-provozu.js + worker v33 POST /alive).

Vlastník neviděl v konzoli lidi, kteří appku používají bez firmy. Appka teď 1× denně
pošle „jsem naživu" (náhodný kód zařízení, verze, Základ/Pro, jazyk, systém, kód účtu).
Vypnout jde v Nastavení → Účet a aplikace → Soukromí — ale bez hlášení není Pro (rozhodnutí vlastníka)
a přepínač na to PŘED vypnutím upozorní.

  H  po startu odejde právě jedno hlášení s povolenými poli, bez polohy; druhý start
     téhož dne nic neposílá
  N  přepínač v Nastavení → Účet a aplikace → Soukromí s kódem zařízení
  P  vypnutí s Pro: varování „Přijdeš o verzi Pro", Zrušit nechá vše být, potvrzení Pro
     vypne (důvod 'hlaseni'), karta Pro nabídne zapnout; zapnutí Pro vrátí a pošle hlášení
  Z  bez Pro: varování „Nebudeš moct dostat verzi Pro"
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

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9139)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


ZAVRI = "() => { document.querySelectorAll('.ag-dlg-overlay.open .ag-dlg-btn:not(.ag-ok)').forEach(b => b.click()); }"
OTEVRI_NASTAVENI = "() => { const m = document.getElementById('settings-modal'); m.style.display = 'flex'; if (typeof switchTab === 'function') switchTab('tab-ucet'); const r = document.getElementById('ag-hl-row'); if (r) r.scrollIntoView(); }"


async def beh(p, url, tarif, hlaseni):
    if True:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, service_workers='block',
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))

        async def route(r, q):
            if q.url.endswith('/alive') and q.method == 'POST':
                hlaseni.append(json.loads(q.post_data or '{}'))
                return await r.fulfill(status=200, content_type='application/json', body='{"ok":true}', headers={'Access-Control-Allow-Origin': '*'})
            return await V.route_vse(r, q)
        await page.route('**/*', route)
        await page.add_init_script(boot(tarif=tarif) + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agDomov_v1', JSON.stringify({auto:false}));")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        await V.cekej(page, "document.body.classList.contains('app-started') && !!window.AGHlaseni", 60)
        return br, ctx, page, chyby


async def hlavni(url):
    async with async_playwright() as p:
        await hlavni2(p, url)


async def hlavni2(p, url):
    # ---- s Pro
    hl = []
    br, ctx, page, chyby = await beh(p, url, 'pro', hl)
    for _ in range(40):
        if hl:
            break
        await page.wait_for_timeout(250)
    ok('H1 po startu odejde hlášení', len(hl) == 1, hl)
    h = hl[0] if hl else {}
    ok('H2 jen povolená pole (dev, ver, tarif, lang, os, ucet), bez polohy', set(h.keys()) <= {'dev', 'ver', 'tarif', 'lang', 'os', 'ucet'} and 'lat' not in json.dumps(h), h)
    ok('H3 kód zařízení je náhodný, verze a tarif Pro sedí', len(h.get('dev', '')) >= 12 and h.get('ver', '').startswith('v') and h.get('tarif') == 'pro' and h.get('ucet') == 'TESTACC1', h)
    await page.reload(wait_until='domcontentloaded')
    await V.cekej(page, "document.body.classList.contains('app-started') && !!window.AGHlaseni", 60)
    await page.wait_for_timeout(5500)
    ok('H4 druhý start téhož dne už nic neposílá', len(hl) == 1, len(hl))
    ok('H5 kód zařízení zůstává stejný', await page.evaluate("(d) => AGHlaseni.zarizeni() === d", h.get('dev', '')))

    await page.evaluate(ZAVRI)
    await page.evaluate(OTEVRI_NASTAVENI)
    ok('N1 přepínač v Nastavení → Účet a aplikace → Soukromí, zapnutý, s kódem zařízení', await V.cekej(page, "(() => { const r = document.getElementById('ag-hl-row'); return r && document.getElementById('ag-hl-switch').checked && /[A-Z0-9]{4}-[A-Z0-9]{4}/.test(r.textContent); })()", 8))
    ok('P0 před vypnutím je Pro', await page.evaluate("() => AGLic.isPro()"))
    await page.click('#ag-hl-row .st-sw')
    ok('P1 vypnutí s Pro varuje „Přijdeš o verzi Pro"', await V.cekej(page, "!!document.querySelector('.ag-dlg-overlay.open') && /Přijdeš o verzi Pro/.test(document.querySelector('.ag-dlg-overlay.open').textContent)", 4))
    await page.evaluate(ZAVRI)
    ok('P2 „Nechat zapnuté" nic nezmění', await V.cekej(page, "document.getElementById('ag-hl-switch').checked && AGLic.isPro() && localStorage.getItem('agHlaseni_v1') !== '0'", 3))
    await page.click('#ag-hl-row .st-sw')
    await V.cekej(page, "!!document.querySelector('.ag-dlg-overlay.open .ag-ok')", 4)
    await page.click('.ag-dlg-overlay.open .ag-ok')
    ok('P3 potvrzené vypnutí: přepínač vypnutý, Pro pryč (důvod hlaseni)', await V.cekej(page, "!document.getElementById('ag-hl-switch').checked && !AGLic.isPro() && AGLic.stav().duvod === 'hlaseni'", 4))
    n = len(hl)
    await page.evaluate("() => AGHlaseni.nahlas(true)")
    await page.wait_for_timeout(800)
    ok('P4 s vypnutým hlášením nic neodchází ani vynuceně', len(hl) == n, len(hl))
    await page.evaluate("() => { document.getElementById('settings-modal').style.display = 'none'; AGProZamky.karta('dmt-volume'); }")
    ok('P5 karta Pro řekne proč a nabídne zapnutí', await V.cekej(page, "!!document.querySelector('.agp-hlaseni button')", 5))
    await page.click('.agp-hlaseni button')
    ok('P6 zapnutí z karty vrátí Pro a pošle hlášení', await V.cekej(page, "AGLic.isPro() && localStorage.getItem('agHlaseni_v1') !== '0'", 4) and await V.cekej(page, "true", 1))
    await page.wait_for_timeout(800)
    ok('P7 po zapnutí odešlo hlášení', len(hl) == n + 1, len(hl))
    ok('Z1 bez chyb stránky (Pro)', not chyby, chyby[:5])
    await br.close()

    # ---- bez Pro
    hl2 = []
    br, ctx, page, chyby = await beh(p, url, 'zaklad', hl2)
    await page.evaluate(ZAVRI)
    await page.evaluate(OTEVRI_NASTAVENI)
    await V.cekej(page, "!!document.getElementById('ag-hl-row')", 8)
    await page.click('#ag-hl-row .st-sw')
    ok('Z2 bez Pro varuje „Nebudeš moct dostat verzi Pro"', await V.cekej(page, "!!document.querySelector('.ag-dlg-overlay.open') && /Nebudeš moct dostat verzi Pro/.test(document.querySelector('.ag-dlg-overlay.open').textContent)", 4))
    ok('Z3 bez chyb stránky (Základ)', not chyby, chyby[:5])
    await br.close()


def main():
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    try:
        asyncio.run(hlavni(url))
    finally:
        srv.terminate()
    n = len(VYSLEDKY); d = sum(VYSLEDKY)
    print('\n%d/%d OK' % (d, n))
    sys.exit(0 if d == n else 1)


if __name__ == '__main__':
    main()
