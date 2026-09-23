# -*- coding: utf-8 -*-
u"""HLÍDAČ CHYB STARTU (23. 9. 2026, n3 z 5. hodnocení).

⚠ PROČ: dvě chyby, které uživateli při KAŽDÉM startu házely toast „Něco se pokazilo“
  (zeme-svet:rtk — řádek RTK vkládaný do prvku mimo stránku; power-save:updateGpsAvgPanel —
  GPS dřív než grafika.js), prošly všemi 52 sadami testů. Žádná totiž nečetla PROTOKOL CHYB
  APPKY (localStorage agErrorLog, js/err-log.js) — chyby, které appka sama spolkne přes
  AG.swallow, nejsou pageerror, takže je test nevidí, ale uživatel ano.

Co dělá: nastartuje appku v šesti podobách a v každé projde hlavní obrazovky (pohledy
Mapa / AR / Split, Nástroje, Nastavení, Mé body, Nový bod). Na konci musí být protokol chyb
prázdný (síťové chyby se nepočítají — test běží bez sítě) a žádný pageerror.

  K1 tmavý motiv, Pro          K4 Základ (bez Pro)
  K2 světlý motiv              K5 cizina (Berlín, de-DE)
  K3 jednoduchý režim          K6 slabší telefon

python scripts/test_start_bez_chyb.py [port]
"""
import os
import re
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9049)
VYSLEDKY = []
SITOVE = re.compile(r'NetworkError|bez signálu|Failed to fetch|Load failed|net::|ERR_|timeout|Timeout|síť|offline|HTTP \d{3}|abort', re.I)


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


KONFIGURACE = [
    ('K1 tmavý, Pro', dict(tarif='pro', init='', loc='cs-CZ', lat=V.LAT, lng=V.LNG, svetly=False)),
    ('K2 světlý', dict(tarif='pro', init='', loc='cs-CZ', lat=V.LAT, lng=V.LNG, svetly=True)),
    ('K3 jednoduchý režim', dict(tarif='pro', init="localStorage.setItem('agJednoduchy_v1','1');", loc='cs-CZ', lat=V.LAT, lng=V.LNG, svetly=False, jednoduchy=True)),
    ('K4 Základ', dict(tarif='zaklad', init='', loc='cs-CZ', lat=V.LAT, lng=V.LNG, svetly=False)),
    ('K5 cizina (Berlín, de-DE)', dict(tarif='pro', init="localStorage.removeItem('agZemeUvod_v1');", loc='de-DE', lat=52.52, lng=13.405, svetly=False)),
    ('K6 slabší telefon', dict(tarif='pro', init="localStorage.setItem('agSlabsiTelefon_v1','on');", loc='cs-CZ', lat=V.LAT, lng=V.LNG, svetly=False)),
]

PROJIT = [
    "() => { viewMode = 'ar'; applyViewMode(); }",
    "() => { viewMode = 'both'; applyViewMode(); }",
    "() => { viewMode = 'map'; applyViewMode(); }",
    "() => document.getElementById('dock-nastroje-btn').click()",
    "() => { document.getElementById('tools-modal') && (document.getElementById('tools-modal').style.display = 'none'); openSettings(); }",
    "() => { document.getElementById('settings-modal').style.display = 'none'; openManageModal(); }",
    "() => { closeManageModal(); openNewPointModal(); }",
    "() => { closeCustomModal(); }",
]


async def jedna(br, url, nazev, k):
    chyby = []
    ctx = await br.new_context(locale=k['loc'], viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': k['lat'], 'longitude': k['lng'], 'accuracy': 4}, permissions=['geolocation'],
                               service_workers='block')
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)[:200]))
    await page.route('**/*', V.route_vse)
    await page.add_init_script(boot(tarif=k['tarif']) + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.removeItem('agErrorLog');" + k['init'])
    try:
        cdp = await ctx.new_cdp_session(page)
        await cdp.send('DeviceOrientation.setDeviceOrientationOverride', {'alpha': 30, 'beta': 80, 'gamma': 0})
    except Exception:
        pass
    await page.goto(url, wait_until='domcontentloaded', timeout=60000)
    start = await V.cekej(page, "document.body.classList.contains('app-started') || !!document.getElementById('ag-jr')", 40)
    await page.wait_for_timeout(4000)
    if k['svetly']:
        await page.evaluate("() => { try { visSettings.mode = 'light'; previewMode('light'); } catch (e) {} }")
        await page.wait_for_timeout(600)
    if not k.get('jednoduchy'):
        for js in PROJIT:
            try:
                await page.evaluate(js)
            except Exception as e:
                chyby.append('krok: ' + js[:50] + ' → ' + str(e)[:120])
            await page.wait_for_timeout(700)
    await page.wait_for_timeout(2500)   # GPS tiky, odložené moduly (ag/lazy) doběhnou
    log = await page.evaluate("() => { try { return JSON.parse(localStorage.getItem('agErrorLog') || '[]').map(e => (e.msg || e.sig || '?') + ' ×' + (e.n || 1)); } catch (e) { return ['čtení protokolu: ' + e]; } }")
    log = [m for m in log if not SITOVE.search(m)]
    ok(nazev + ': appka nastartovala', start)
    ok(nazev + ': protokol chyb appky prázdný', not log, log[:6])
    ok(nazev + ': bez pageerror', not chyby, chyby[:4])
    await ctx.close()


async def main_async(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        for nazev, k in KONFIGURACE:
            await jedna(br, url, nazev, k)
        await br.close()


def main():
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    try:
        asyncio.run(main_async(url))
    finally:
        srv.terminate()
    n = len(VYSLEDKY); d = sum(VYSLEDKY)
    print('\n%d/%d OK' % (d, n))
    sys.exit(0 if d == n else 1)


if __name__ == '__main__':
    main()
