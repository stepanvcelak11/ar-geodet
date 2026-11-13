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
WX = {'elevation': 250.0, 'current': {'temperature_2m': 11.6, 'weather_code': 2, 'wind_speed_10m': 3.1, 'pressure_msl': 1018.0, 'surface_pressure': 988.0},
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
        ok('A0b dialog svítící při startu (kompas, Face ID…) je NAD Domů, ne pod ním', await page.evaluate("() => { const d = document.querySelector('.ag-dlg-overlay.open, .modal-overlay[style*=\"flex\"]'); if (!d) return true; const r = d.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && !el.closest('#ag-domov'); }"))
        ok('A1 pozdrav se jménem a datum', await page.evaluate("() => /Tester/.test(document.getElementById('agd-pozdrav').textContent) && document.getElementById('agd-datum').textContent.length > 5"))
        ok('A2 počasí: teplota, popis, déšť s hodinami, slunce', await V.cekej(page, "(() => { const t = document.getElementById('agd-wx').textContent; return /12°/.test(t) && /Polojasno/.test(t) && /13–16 h/.test(t) && /06:58–16:32/.test(t); })()", 15),
           await page.evaluate("() => document.getElementById('agd-wx').textContent"))
        # tlak: moře 1018, ve 250 m (terén, bez GPS výšky) ≈ 988 hPa (barometrická rovnice, 11,6 °C)
        tl = await page.evaluate("() => document.getElementById('agd-wx').textContent")
        ok('A2b tlak na moři i přepočtený na výšku', '1018 hPa' in tl and ('988 hPa' in tl or '987 hPa' in tl or '989 hPa' in tl) and 'm n. m.' in tl, tl)
        ok('A2c přepočet tlaku: 1013,25 hPa v 1000 m při 15 °C ≈ 899 hPa', await page.evaluate("() => { const w = {elevation: 1000, current: {pressure_msl: 1013.25, temperature_2m: 8.5}}; AGDomov._pocasi({w: Object.assign({daily: {}}, w)}); return /89[89] hPa/.test(document.getElementById('agd-wx').textContent); }"),
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

        # poznámky k zakázce (skryté pod tlačítkem na kartě zakázky)
        await page.evaluate(ZAVRI)
        await page.click('#agd-pozn-btn')
        await page.fill('#agd-pozn', 'Klíč u souseda, brána 4412')
        await page.wait_for_timeout(900)
        ok('B1 poznámka uložena k zakázce', await page.evaluate("() => getStoredData('agPoznamkyZakazky') === 'Klíč u souseda, brána 4412' && /Uloženo/.test(document.getElementById('agd-pozn-st').textContent)"))

        # kontrast na slunci z řádku ikon
        await page.evaluate(ZAVRI)
        await page.click('#agd-outdoor')
        r = await page.evaluate("() => ({ out: document.body.classList.contains('outdoor-mode'), ulozeno: JSON.parse(getStoredData('arVisSettings12') || '{}'), on: document.getElementById('agd-outdoor').classList.contains('on') })")
        ok('C1 „Na slunci" zapne venkovní režim a uloží ho', r['out'] and r['on'] and r['ulozeno'].get('outdoorMode') is True, r)
        await page.click('#agd-outdoor')

        # ZAKÁZKY: jedna u tebe (body 40–120 m od polohy), jedna v Brně; otevřená je bez bodů
        await page.evaluate("""async (ll) => {
            const [lat, lng] = ll;
            const u = [{id:'u1', name:'L1', lat: lat + 0.0004, lng: lng, mts: Date.now() - 86400000}, {id:'u2', name:'L2', lat: lat + 0.0010, lng: lng + 0.0005, mts: Date.now() - 2*86400000}];
            const b = [{id:'b1', name:'B1', lat: 49.195, lng: 16.608, mts: Date.now() - 9*86400000}];
            await _idbSet('proj_les_arCustomPoints12', JSON.stringify(u));
            await _idbSet('proj_brno_arCustomPoints12', JSON.stringify(b));
            projects.push({id:'proj_les', name:'U lesa 123/4'}, {id:'proj_brno', name:'Brno Kraví hora'});
            localStorage.setItem('arProjectsList', JSON.stringify(projects));
            AGDomov.zavri(); AGDomov.otevri();
        }""", [V.LAT, V.LNG])
        ok('J1 zakázka, u které stojíš, je nahoře: „Jsi u této zakázky"', await V.cekej(page, "/U lesa 123\\/4/.test(document.getElementById('agd-zak').textContent) && /Jsi u této/.test(document.getElementById('agd-hl').textContent)", 15),
           await page.evaluate("() => document.getElementById('agd-hl').textContent"))
        ok('J2 u zakázky počet bodů a kdy naposledy', await page.evaluate("() => /2 body/.test(document.getElementById('agd-zak-sub').textContent) && /včera/.test(document.getElementById('agd-zak-sub').textContent)"),
           await page.evaluate("() => document.getElementById('agd-zak-sub').textContent"))
        ok('J3 ostatní zakázky: vzdálenost (Brno v km), otevřená označená', await page.evaluate("() => { const t = document.getElementById('agd-sez').textContent; return /Brno Kraví hora/.test(t) && /\\d+ km/.test(t) && /otevřená/.test(t); }"),
           await page.evaluate("() => document.getElementById('agd-sez').textContent"))
        if SNIMEK:
            await page.wait_for_timeout(500)
            d = os.environ.get('SNIMKY', '.')
            await page.screenshot(path=os.path.join(d, 'domov-3.png'))
        await page.click('#agd-jit')
        ok('J4 „Otevřít a měřit" přepne zakázku a pustí do terénu', await V.cekej(page, "!AGDomov.otevreno() && activeProjectId === 'proj_les'", 10), await page.evaluate("() => activeProjectId"))

        # nová zakázka přímo z Domů
        await page.evaluate("() => AGDomov.otevri()")
        await page.click('#ag-domov [data-agd="nova-otevri"]')
        await page.fill('#agd-nova-in', 'Parcela 77/1 Lhota')
        await page.click('#ag-domov [data-agd="nova"]')
        ok('N1 Nová zakázka: jméno → založit a měřit', await V.cekej(page, "!AGDomov.otevreno() && projects.some(p => p.name === 'Parcela 77/1 Lhota' && p.id === activeProjectId)", 10),
           await page.evaluate("() => projects.map(p => p.name)"))

        # zpátky na zakázku u lesa (kvůli dalším krokům)
        await page.evaluate("() => { AGDomov.otevri(); }")
        await page.click('#ag-domov .agd-z[data-zak="proj_les"]')
        ok('N2 klepnutí na řádek zakázky = přepnout a jít měřit', await V.cekej(page, "!AGDomov.otevreno() && activeProjectId === 'proj_les'", 10))
        await page.evaluate("() => AGDomov.otevri()")
        await page.click('#ag-domov .agd-z[data-zak="proj_brno"]')
        await V.cekej(page, "activeProjectId === 'proj_brno'", 10)

        # JÍT MĚŘIT
        await page.evaluate("() => AGDomov.otevri()")
        await page.evaluate(ZAVRI)
        await page.click('#ag-domov .agd-x')   # křížek = měřit v OTEVŘENÉ zakázce (ne v navržené)
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

        # CHYTŘE: dnes už ukázáno a appka běžela před chvílí → po startu se Domů NEukáže,
        # ale GPS ukáže, že stojíš u jiné zakázky (otevřená je Brno) → nabídka „Přepnout"
        await page.evaluate("() => { localStorage.setItem('agDomov_v1', JSON.stringify({auto:true})); localStorage.setItem('agDomovAkt_v1', JSON.stringify({den: (d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'))(new Date()), ts: Date.now()})); }")
        await page.reload(wait_until='domcontentloaded')
        await V.cekej(page, "document.body.classList.contains('app-started')", 60)
        await page.wait_for_timeout(1500)
        ok('S1 chytře: dnes už viděno a bez pauzy → rovnou do terénu', not await page.evaluate("() => AGDomov.otevreno()"))
        ok('S2 u jiné zakázky, než je otevřená → nabídka „Jsi u zakázky…"', await V.cekej(page, "!!document.querySelector('#agd-tip.on') && /U lesa/.test(document.getElementById('agd-tip').textContent)", 25),
           await page.evaluate("() => ({ a: activeProjectId, s: AGDomov._seznam().map(z => [z.id, z.d && Math.round(z.d)]) })"))
        await page.evaluate(ZAVRI)
        await page.evaluate("() => document.querySelector('#agd-tip [data-t=\"ano\"]').click()")
        ok('S3 „Přepnout" otevře zakázku u tebe', await V.cekej(page, "activeProjectId === 'proj_les' && !document.querySelector('#agd-tip.on')", 10))
        await page.evaluate("() => localStorage.setItem('agDomovAkt_v1', JSON.stringify({den: '2000-01-01', ts: Date.now() - 5*3600000}))")
        await page.reload(wait_until='domcontentloaded')
        ok('S4 po pauze delší než 3 h se Domů ukáže', await V.cekej(page, "document.body.classList.contains('app-started') && AGDomov.otevreno()", 60))
        await page.evaluate("() => AGDomov.zavri()")

        # jednoduchý režim: Domů se neukazuje
        await page.evaluate("() => { localStorage.setItem('agJednoduchy_v1','1'); }")
        ok('F1 v jednoduchém režimu se Domů neotevře', await page.evaluate("() => AGDomov.otevri() === false && !AGDomov.otevreno()"))
        await page.evaluate("() => localStorage.setItem('agJednoduchy_v1','0')")
        # zkratka z ikony appky (Nový bod): Domů ji nesmí zakrýt (5. 11. 2026)
        p2 = await ctx.new_page()
        await p2.route('**/*', route)
        await p2.add_init_script("localStorage.removeItem('agDomov_v1');")
        await p2.goto(url + ('&' if '?' in url else '?') + 'zkratka=novy-bod', wait_until='domcontentloaded', timeout=90000)
        await V.cekej(p2, "document.body.classList.contains('app-started') && !!window.AGDomov", 60)
        await p2.wait_for_timeout(4000)
        r = await p2.evaluate("() => ({ domov: AGDomov.otevreno(), novy: document.getElementById('custom-modal-overlay').style.display })")
        ok('G1 spuštění zkratkou „Nový bod": okno bodu, Domů se neukáže', not r['domov'] and r['novy'] == 'flex', r)
        await p2.close()
        # přihlášení svítí při startu → Domů až PO něm (13. 11. 2026: „vůbec nevidím úvodní obrazovku")
        p3 = await ctx.new_page()
        await p3.route('**/*', route)
        await p3.add_init_script("""localStorage.setItem('agDomov_v1', JSON.stringify({auto:true, v:2})); localStorage.removeItem('agDomovAkt_v1');
            window.addEventListener('ag:app-started', () => { const d = document.createElement('div'); d.id = 'ag-login'; d.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000'; document.body.appendChild(d); setTimeout(() => d.remove(), 3000); }, true);""")
        await p3.goto(url, wait_until='domcontentloaded', timeout=90000)
        await V.cekej(p3, "document.body.classList.contains('app-started') && !!document.getElementById('ag-login')", 60)
        await p3.wait_for_timeout(1200)
        pod = await p3.evaluate("() => AGDomov.otevreno()")
        ok('H1 Domů se ukáže až po přihlášení (ne pod přihlašovací obrazovkou)', not pod and await V.cekej(p3, "!document.getElementById('ag-login') && AGDomov.otevreno()", 15), pod)
        await p3.close()
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
