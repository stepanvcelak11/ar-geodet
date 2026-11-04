# -*- coding: utf-8 -*-
u"""DOMŮ — úvodní obrazovka po přihlášení (4. 11. 2026, js/domov.js).

Po vstupu do appky: pozdrav, počasí dnes (offline poslední stažené), zakázka, poznámky
k zakázce (uloží se k zakázce), sdílení, nastavení před výjezdem (vzhled, venkovní režim,
písmo), stav, průběh nabíhání, JÍT MĚŘIT. Nástroje tu nejsou. V jednoduchém režimu se
neukazuje, vypnout jde dole i v Nastavení, ranní brífink se ten den sám neotevře.

python scripts/test_domov.py [port] [--snimek]
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

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9134)
SNIMEK = '--snimek' in sys.argv
VYSLEDKY = []
ZAVRI = "() => { document.querySelectorAll('.ag-dlg-overlay.open .ag-dlg-btn:not(.ag-ok)').forEach(b => b.click()); }"
WX = {'current': {'temperature_2m': 11.6, 'weather_code': 2, 'wind_speed_10m': 3.1},
      'daily': {'weather_code': [61], 'temperature_2m_max': [14.2], 'temperature_2m_min': [5.8], 'precipitation_sum': [2.4], 'precipitation_probability_max': [70],
                'wind_speed_10m_max': [6.2], 'wind_gusts_10m_max': [11], 'sunrise': ['2026-11-04T06:58'], 'sunset': ['2026-11-04T16:32']},
      'hourly': {'precipitation': [0] * 13 + [0.6, 0.9, 0.4] + [0] * 8}}


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True, service_workers='block', device_scale_factor=2 if SNIMEK else 1,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        wx = {'n': 0}

        async def route(rt, rq):
            if 'api.open-meteo.com/v1/forecast' in rq.url and 'current=' in rq.url:
                wx['n'] += 1
                return await rt.fulfill(status=200, content_type='application/json', body=json.dumps(WX), headers={'Access-Control-Allow-Origin': '*'})
            return await V.route_vse(rt, rq)
        await page.route('**/*', route)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off'); if (!sessionStorage.getItem('agdT')) { sessionStorage.setItem('agdT', '1'); localStorage.removeItem('agDomov_v1'); localStorage.removeItem('agBrifinkLastShown'); }")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 po přihlášení se ukáže Domů', await V.cekej(page, "document.body.classList.contains('app-started') && !!window.AGDomov && AGDomov.otevreno()", 60))
        ok('A1 pozdrav se jménem a datum', await page.evaluate("() => /Tester/.test(document.getElementById('agd-pozdrav').textContent) && document.getElementById('agd-datum').textContent.length > 5"))
        ok('A2 počasí: teplota, popis, déšť s hodinami, slunce', await V.cekej(page, "(() => { const t = document.getElementById('agd-wx').textContent; return /12°/.test(t) && /Polojasno/.test(t) && /13–16 h/.test(t) && /06:58–16:32/.test(t); })()", 15),
           await page.evaluate("() => document.getElementById('agd-wx').textContent"))
        ok('A3 zakázka s počtem bodů', await page.evaluate("() => document.getElementById('agd-zak').textContent.length > 0 && /bod/i.test(document.getElementById('agd-zak-sub').textContent)"))
        ok('A4 sdílení: poslat/načíst zakázku, QR', await page.evaluate("() => ['poslat','nacist','qr','skenovat'].every(a => !!document.querySelector('#ag-domov [data-agd=\"' + a + '\"]'))"))
        ok('A5 žádné nástroje (dlaždice) na úvodní obrazovce', await page.evaluate("() => !document.querySelector('#ag-domov .tool-tile, #ag-domov .ag-uk-i')"))
        ok('A6 průběh nabíhání appky', await page.evaluate("() => !document.getElementById('agd-prubeh').hidden && document.getElementById('agd-prubeh-t').textContent.length > 0"))
        ok('A7 ranní brífink se dnes sám neotevře', await page.evaluate("() => localStorage.getItem('agBrifinkLastShown') === new Date().toISOString().slice(0,10) || !!localStorage.getItem('agBrifinkLastShown')"))
        await page.evaluate("() => window.AGLazy && AGLazy.flush && AGLazy.flush()")
        ok('A8 po doběhnutí: „Vše připraveno"', await V.cekej(page, "/připraveno/.test(document.getElementById('agd-prubeh-t').textContent)", 40))
        if SNIMEK:
            await page.evaluate(ZAVRI)
            await page.wait_for_timeout(500)
            d = os.environ.get('SNIMKY', '.')
            await page.screenshot(path=os.path.join(d, 'domov-1.png'))
            await page.evaluate("() => document.querySelector('#ag-domov .agd-scroll').scrollTop = 9999")
            await page.wait_for_timeout(300)
            await page.screenshot(path=os.path.join(d, 'domov-2.png'))

        # poznámky k zakázce
        await page.evaluate(ZAVRI)
        await page.fill('#agd-pozn', 'Klíč u souseda, brána 4412')
        await page.wait_for_timeout(900)
        ok('B1 poznámka uložena k zakázce', await page.evaluate("() => getStoredData('agPoznamkyZakazky') === 'Klíč u souseda, brána 4412' && /Uloženo/.test(document.getElementById('agd-pozn-st').textContent)"))

        # nastavení před výjezdem
        fs0 = await page.evaluate("() => visSettings.fontScale || 1")
        await page.click('#ag-domov [data-fs="1"]')
        await page.click('#agd-outdoor')
        await page.click('#agd-mode [data-mode="light"]')
        r = await page.evaluate("() => ({ fs: visSettings.fontScale, css: getComputedStyle(document.documentElement).getPropertyValue('--ag-font-scale').trim(), out: document.body.classList.contains('outdoor-mode'), light: document.body.classList.contains('light-mode'), ulozeno: JSON.parse(getStoredData('arVisSettings12') || '{}') })")
        ok('C1 větší písmo: +10 %, uloženo i použito', abs(r['fs'] - (fs0 + 0.1)) < 0.001 and r['css'] == str(r['fs']).rstrip('0').rstrip('.') or abs(float(r['css'] or 0) - r['fs']) < 0.001, r)
        ok('C2 venkovní režim zapnut a uložen', r['out'] and r['ulozeno'].get('outdoorMode') is True, r)
        ok('C3 světlý vzhled zapnut a uložen', r['light'] and r['ulozeno'].get('mode') == 'light', r)

        # JÍT MĚŘIT
        await page.click('#agd-jit')
        ok('D1 JÍT MĚŘIT zavře Domů', not await page.evaluate("() => AGDomov.otevreno()"))
        # Nastavení → Časté
        await page.evaluate(ZAVRI)
        await page.evaluate("() => openSettings()")
        ok('D2 Nastavení → Časté: Otevřít a vypínač', await V.cekej(page, "!!document.getElementById('agd-set-open') && document.getElementById('agd-set-auto').checked", 10))
        await page.evaluate("() => { const c = document.getElementById('agd-set-auto'); c.checked = false; c.dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('agd-set-open').click(); }")
        ok('D3 otevřít z Nastavení; vypnuto po startu uloženo', await page.evaluate("() => AGDomov.otevreno() && JSON.parse(localStorage.getItem('agDomov_v1')).auto === false"))
        ok('D4 menu Více → Domů', await page.evaluate("() => !!document.getElementById('agd-menu-btn')"))

        # znovu načíst: vypnuto → neukáže se; počasí z cache bez sítě
        await page.reload(wait_until='domcontentloaded')
        await V.cekej(page, "document.body.classList.contains('app-started')", 60)
        await page.wait_for_timeout(1500)
        ok('E1 vypnuté „po spuštění" = po startu se neukáže', not await page.evaluate("() => AGDomov.otevreno()"))
        await ctx.set_offline(True)
        n0 = wx['n']
        await page.evaluate("() => { const c = JSON.parse(localStorage.getItem('agDomovWx_v1')); c.t -= 3600000; localStorage.setItem('agDomovWx_v1', JSON.stringify(c)); AGDomov.otevri(); }")
        ok('E2 bez signálu: poslední stažené počasí se štítkem', await V.cekej(page, "/12°/.test(document.getElementById('agd-wx').textContent) && /bez signálu/.test(document.getElementById('agd-wx').textContent)", 10) and wx['n'] == n0)
        await ctx.set_offline(False)
        await page.evaluate("() => AGDomov.zavri()")

        # jednoduchý režim: Domů se neukazuje
        await page.evaluate("() => { localStorage.setItem('agJednoduchy_v1','1'); }")
        ok('F1 v jednoduchém režimu se Domů neotevře', await page.evaluate("() => AGDomov.otevri() === false && !AGDomov.otevreno()"))
        await page.evaluate("() => localStorage.setItem('agJednoduchy_v1','0')")
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
