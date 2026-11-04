# -*- coding: utf-8 -*-
u"""HLÍDAČ SKOKŮ GPS PODLE KROKŮ (4. 11. 2026, js/hlidac-skoku.js).

Fix, který leží dál, než dovolují kroky od posledního dobrého fixu, je skok GPS —
poloha jde dál podle kroků a kompasu. Pojistky: po 4 odmítnutích se fix přijme,
výrazně přesnější fix se přijme hned, v autě (rychle bez kroků) se nehlídá,
bez pohybového čidla se nehlídá vůbec.

python scripts/test_hlidac_skoku.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9131)
VYSLEDKY = []
M = 1 / 111320.0   # 1 m severně ve stupních


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
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.setItem('agDomov_v1', JSON.stringify({auto:false}));")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        await page.evaluate("() => window.AGLazy && AGLazy.need('js/hlidac-skoku.js')")
        ok('A1 modul načten (odloženě)', await V.cekej(page, "!!window.AGHlidacSkoku && typeof window.agHlidacSkoku === 'function'", 30))

        r = await page.evaluate("""(M) => {
            const H = AGHlidacSkoku, L = 50.0755, G = 14.4378, o = {};
            H._reset(); H.nastav(true);
            // bez čidla: všechno projde
            o.bezCidla = H.hlidej(L + 30 * M, G, 5, 0);
            H._reset(); H._cidlo();
            o.prvni = H.hlidej(L, G, 5, 0);
            H._krok(1);
            o.skok = H.hlidej(L + 15 * M, G, 5, 0);             // 1 krok, 15 m → skok
            o.blizko = H.hlidej(o.skok ? o.skok.lat + 2 * M : L, G, 5, 0);   // 2 m od dopočtu → v pořádku
            // 4 odmítnutí, páté přijmout
            H._reset(); H._cidlo(); H.hlidej(L, G, 5, 0);
            o.serie = [];
            for (let i = 0; i < 5; i++) { H._cidlo(); o.serie.push(!!H.hlidej(L + 20 * M, G, 5, 0)); }
            // výrazně přesnější fix po špatném
            H._reset(); H._cidlo(); H.hlidej(L, G, 12, 0);
            o.presnejsi = H.hlidej(L + 25 * M, G, 3, 0);
            // auto: rychle bez kroků
            H._reset(); H._cidlo(); H.hlidej(L, G, 5, 0);
            o.auto = H.hlidej(L + 30 * M, G, 5, 15);
            // chůze: 20 kroků, 14 m → v pořádku
            H._reset(); H._cidlo(); H.hlidej(L, G, 5, 0); H._krok(20);
            o.chuze = H.hlidej(L + 14 * M, G, 5, 0);
            // vypnuto
            H.nastav(false); H._reset(); H._cidlo(); H.hlidej(L, G, 5, 0);
            o.vyp = H.hlidej(L + 30 * M, G, 5, 0);
            H.nastav(true);
            return o;
        }""", M)
        ok('B1 bez pohybového čidla se nehlídá', r['bezCidla'] is None, r)
        ok('B2 první fix se přijme', r['prvni'] is None, r)
        sk = r['skok']
        ok('B3 1 krok a fix 15 m dál = skok, poloha zůstane u dopočtu (< 2 m od výchozí)', sk is not None and abs(sk['lat'] - 50.0755) / M < 2 and sk.get('dr'), sk)
        ok('B4 fix 2 m od dopočtu projde', r['blizko'] is None, r)
        ok('B5 čtyři odmítnutí po sobě, páté se přijme (GPS má pravdu)', r['serie'] == [True, True, True, True, False], r['serie'])
        ok('B6 výrazně přesnější fix se přijme hned', r['presnejsi'] is None, r)
        ok('B7 v autě (15 m/s) se nehlídá', r['auto'] is None, r)
        ok('B8 20 kroků a 14 m = normální chůze, projde', r['chuze'] is None, r)
        ok('B9 vypnuté v Nastavení = nehlídá', r['vyp'] is None, r)

        # integrace s logika.js: skok GPS nepohne userLat
        await page.evaluate("() => { AGHlidacSkoku._reset(); AGHlidacSkoku._cidlo(); }")
        await ctx.set_geolocation({'latitude': V.LAT + 1 * M, 'longitude': V.LNG, 'accuracy': 4})
        await page.wait_for_timeout(1500)
        await page.evaluate("() => AGHlidacSkoku._cidlo()")
        await ctx.set_geolocation({'latitude': V.LAT + 25 * M, 'longitude': V.LNG, 'accuracy': 4})
        await page.wait_for_timeout(1500)
        d = await page.evaluate("(L) => ({ m: (userLat - L) / (1/111320), acc: currentGpsAccuracy, raw: window.AGFixRaw && (AGFixRaw.lat - L) * 111320 })", V.LAT)
        ok('C1 skok 24 m bez kroků: poloha v appce zůstala (AGFixRaw má surový fix)', d['m'] < 3 and d['raw'] and d['raw'] > 20, d)

        # Nastavení → AR & přesnost
        await page.evaluate("() => { const b = document.getElementById('settings-btn'); if (b) b.click(); else if (window.openSettings) openSettings(); }")
        ok('D1 přepínač v Nastavení', await V.cekej(page, "!!document.getElementById('s-hlidac-skoku') && document.getElementById('s-hlidac-skoku').checked", 10))
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
