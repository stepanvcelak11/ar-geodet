# -*- coding: utf-8 -*-
u"""MOJE PŘESNOST (25. 9. 2026, 6. hodnocení a1 + a2) — js/moje-presnost.js proti podvrženému serveru.

Kontroluje: model iPhonu podle displeje; kontrolní bod (prov.checkOf + checkRef) → místo se
skutečnou chybou GPS; okno nástroje (počet, medián, seznam); vrstva v mapě s legendou; tip
v Novém bodu podle nejbližší kontroly; Terénní zkouška pošle JEN model a čísla (bez polohy) a
ukáže srovnání s ostatními; vypnuté sdílení = žádný dotaz na server.

python scripts/test_moje_presnost.py [port]
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

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9088)
VYSLEDKY = []
SERVER = {'post': [], 'get': []}
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


async def stats_route(route, request):
    hdr = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'}
    if request.method == 'OPTIONS':
        return await route.fulfill(status=204, headers=hdr)
    if request.method == 'POST':
        SERVER['post'].append(json.loads(request.post_data or '{}'))
        return await route.fulfill(status=200, content_type='application/json', headers=hdr, body='{"ok":true}')
    SERVER['get'].append(request.url)
    return await route.fulfill(status=200, content_type='application/json', headers=hdr,
                               body=json.dumps({'ok': True, 'model': 'x', 'n': 37, 'median': 2.8, 'p25': 2.1, 'p75': 3.6}))


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, screen={'width': 393, 'height': 852}, device_scale_factor=3,
                                   user_agent=UA, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.route('**/stats/phone**', stats_route)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        await page.evaluate("() => new Promise(r => AGLazy.need('js/moje-presnost.js', r))")
        ok('A1 modul', await V.cekej(page, "!!window.AGMojePresnost", 60))
        ok('M1 model iPhonu podle displeje 393×852@3', await page.evaluate("() => AGMojePresnost._test.modelUA()") == 'iPhone 14 Pro/15/15 Pro/16')

        # kontrolní bod: ref R a kontrola C 2,5 m vedle
        n = await page.evaluate("""() => { const r = mistniToLatLng(743200, 1042100), c = mistniToLatLng(743202.5, 1042100);
            addImportedPoints([{ name: 'R1', lat: r.lat, lng: r.lng, origin: 'import' }, { name: 'R1-k', lat: c.lat, lng: c.lng, origin: 'import' }]);
            const ref = persistentCustomPoints.find(p => p.name === 'R1'), k = persistentCustomPoints.find(p => p.name === 'R1-k');
            k.prov.checkOf = ref.id;   // kontrola uložená v době před checkRef — dohledá se podle id
            AGMojePresnost._test.sesbirejKontroly(); return AGMojePresnost.mista(); }""")
        ok('K1 kontrolní bod → místo se skutečnou chybou ≈ 2,5 m', len(n) == 1 and abs(n[0]['d'] - 2.5) < 0.05, n)

        # okno nástroje
        await page.evaluate("() => AGMojePresnost.open()")
        await page.wait_for_timeout(800)
        o = await page.evaluate("() => { const m = document.getElementById('ag-mp-modal'); return m ? { t: m.innerText, vis: getComputedStyle(m).display } : null; }")
        ok('O1 okno: model, 1 kontrola, medián ±2,5 m', o and o['vis'] == 'flex' and 'iPhone 14 Pro/15/15 Pro/16' in o['t'] and '±2,5 m' in o['t'], o)
        await page.evaluate("() => document.getElementById('ag-mp-mapa').click()")
        await page.wait_for_timeout(600)
        mp = await page.evaluate("() => ({ pas: !!document.getElementById('ag-mp-pas'), kruhy: document.querySelectorAll('#map path.leaflet-interactive').length })")
        ok('O2 Ukázat v mapě: kruhy v mapě + legenda s tlačítkem Skrýt', mp['pas'] and mp['kruhy'] >= 2, mp)
        await page.evaluate("() => document.querySelector('#ag-mp-pas button').click()")
        ok('O3 Skrýt legendu i vrstvu odebere', await page.evaluate("() => !document.getElementById('ag-mp-pas')"))

        # tip v Novém bodu (poloha kousek od kontroly)
        await page.evaluate("() => { const c = mistniToLatLng(743230, 1042120); userLat = c.lat; userLng = c.lng; }")
        await page.evaluate("() => openNewPointModal()")
        await page.wait_for_timeout(500)
        tip = await page.evaluate("() => (document.getElementById('ag-mp-tip') || {}).textContent || ''")
        ok('N1 Nový bod: tip podle nejbližší kontroly (≈ 36 m, ±2,5 m)', 'Podle tvé kontroly' in tip and '±2,5 m' in tip, tip)
        await page.evaluate("() => { try { closeCustomModal(); } catch (e) {} }")

        # sdílení vypnuté (boot) → žádný dotaz na server
        await page.evaluate("() => AGMojePresnost.zkouska({ gps: { r95: 3.1 }, kompas: { dif: -4 } }, 2.9, null)")
        await page.wait_for_timeout(800)
        ok('S0 sdílení vypnuté: nic neodešlo ani se nečetlo', not SERVER['post'] and not SERVER['get'], SERVER)
        # zapnout sdílení a dokončit zkoušku
        await page.evaluate("() => localStorage.setItem('agMojePresnost_v1', JSON.stringify({ sdilet: true }))")
        stat = await page.evaluate("""async () => { const box = document.createElement('div'); document.body.appendChild(box);
            AGMojePresnost.zkouska({ gps: { r95: 3.1 }, kompas: { dif: -4 }, bod: { d: 1.8, name: 'TB 7', lat: 50.0756, lng: 14.4379 } }, 2.9, box);
            await new Promise(r => setTimeout(r, 1500)); return box.textContent; }""")
        post = SERVER['post'][0] if SERVER['post'] else {}
        ok('S1 odešel jen model a čísla (odhad 2,9, kompas 4), žádná poloha', post.get('model') == 'iPhone 14 Pro/15/15 Pro/16' and post.get('odhad') == 2.9 and post.get('kompas') == 4
           and 'lat' not in post and 'lng' not in post and '50.0756' not in json.dumps(post), post)
        ok('S2 výsledek ukáže srovnání: typicky ±2,8 m (37 zkoušek)', 'typicky ±2,8 m (37' in stat, stat)
        ok('S3 4. krok zkoušky (bod) přibyl do mapy přesnosti', await page.evaluate("() => AGMojePresnost.mista().some(m => m.z === 'zkouska' && m.d === 1.8)"))
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
