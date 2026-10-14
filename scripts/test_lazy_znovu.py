# -*- coding: utf-8 -*-
u"""ODLOŽENÝ MODUL SE PO VÝPADKU SIGNÁLU NAČTE ZNOVU (14. 10. 2026, hlášení z terénu v411).

Telefon ztratil signál ve chvíli, kdy js/lazy-load.js stahoval konec fronty, a posledních
10 modulů (Face ID, kruh nejistoty, nabídka u úředního bodu…) chybělo až do zavření appky.

Kontroluje: modul, jehož první stažení selže, se po události `online` načte znovu; do protokolu
chyb se výpadek nezapíše (není to chyba appky); modul, který nedorazí ani po všech pokusech,
se zapíše jednou s poznámkou o pokusech; sw.js umí chybějící položky předcache doplnit
(doplnChybejici, zpráva AG_DOPLN, volání při navigaci).

python scripts/test_lazy_znovu.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9112)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True, service_workers='block',
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        pocet = {'nej': 0, 'kn': 0}

        async def route(rt, rq):
            u = rq.url
            if '/js/nejistota.js' in u:
                pocet['nej'] += 1
                if pocet['nej'] == 1:
                    return await rt.abort('internetdisconnected')     # první pokus: bez signálu
            if '/js/kotva-nabidka.js' in u:
                pocet['kn'] += 1
                return await rt.abort('internetdisconnected')         # nedorazí nikdy
            return await V.route_vse(rt, rq)
        await page.route('**/*', route)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        ok('A1 první stažení js/nejistota.js selhalo, modul chybí', await V.cekej(page, "!!document.querySelector('script[data-ag-lazy]') && !window.AGNejistota", 60) and pocet['nej'] >= 1, pocet)
        await page.wait_for_timeout(4000)
        log = await page.evaluate("() => JSON.stringify((window.agErrLog && agErrLog.list) ? agErrLog.list() : (localStorage.getItem('agErrLog_v1') || ''))")
        ok('A2 výpadek signálu se hned nezapisuje do protokolu chyb', 'nepodařilo se načíst js/nejistota.js' not in log, log[-400:])

        await page.evaluate("() => window.dispatchEvent(new Event('online'))")
        ok('B1 po návratu signálu (online) se modul načte znovu', await V.cekej(page, "!!window.AGNejistota", 30), pocet)
        # kotva-nabidka: další pokusy přes online (bez čekání na 20/90 s)
        for _ in range(4):
            await page.evaluate("() => window.dispatchEvent(new Event('online'))")
            await page.wait_for_timeout(1500)
        log = await page.evaluate("() => JSON.stringify((window.agErrLog && agErrLog.list) ? agErrLog.list() : (localStorage.getItem('agErrLog_v1') || ''))")
        ok('B2 modul, který nedorazí ani napotřetí, se zapíše jednou (s počtem pokusů), bez záznamů za každý pokus', log.count('"msg":"lazy-load: nepodařilo se načíst js/kotva-nabidka.js (ani po') == 1 and 'Nepodařilo se načíst: http' not in log and pocet['kn'] == 4, (pocet, log[-500:]))
        ok('Z bez chyb stránky', not chyby, chyby[:5])
        await ctx.close()
        await br.close()

    sw = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    ok('S1 sw.js: doplnChybejici dotahuje chybějící položky předcache', 'async function doplnChybejici(' in sw and 'if (await target.match(url)) continue;' in sw)
    ok('S3 sw.js: vlastní knihovny s verzí v názvu (MapLibre) jdou do stabilní LIB_CACHE, aktualizace je nesmaže', 'function isOwnLib(url)' in sw and '(isOwnLib(url) ? LIB_CACHE : SHELL_CACHE)' in sw)
    ok('S2 sw.js: doplnění při navigaci a na zprávu AG_DOPLN', 'event.waitUntil(doplnChybejici(false))' in sw and "e.data === 'AG_DOPLN'" in sw)


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
