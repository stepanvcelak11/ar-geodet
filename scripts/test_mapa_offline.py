# -*- coding: utf-8 -*-
u"""VLASTNÍ MAPA BEZ SIGNÁLU + KLASICKÁ MAPA PRYČ (15. 10. 2026).

Uživatel: „Je apka provozu schopná v offline? … při zapínání mi tam problikne klasická mapa, kterou
jsme dávali pryč… dej ji úplně pryč." Rastr OSM se při startu kreslil, než ho vlastní mapa nahradila,
a offline držel jen on — vlastní mapa (PMTiles Range mimo service worker) se bez signálu nenačetla.

  A  start: žádný požadavek na tile.openstreetmap.org, v mapě žádná rastrová dlaždice
  B  prohlížení ukládá kusy dat do telefonu (argeodet-mapa-v1); „Uložit okolí" (ulozOblast) do
     argeodet-mapa-offline-v1
  C  BEZ SIGNÁLU (všechny požadavky na .pmtiles odříznuté): mapa se zapne z uložené hlavičky,
     budovy jsou v datech i vykreslené
  D  oblast do vlastní cache 'argeodet-mapa-o-<id>', smazání ji odstraní
  E  pomalý signál při prvním startu (hlavička za 6 s, v telefonu nic): mapa se i tak načte
  S  sw.js nemaže cache 'argeodet-mapa-*' při aktualizaci; v kódu appky není rastr OSM

python scripts/test_mapa_offline.py [port]
"""
import os
import sys
import json
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_mapa_vektor as MV  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9320)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VYSLEDKY = []
LAT, LNG = MV.LAT, MV.LNG


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


async def stranka(ctx, url, init, chyby, pozadavky, bez_signalu=False):
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))

    async def route(rt, rq):
        u = rq.url
        pozadavky.append(u)
        try:
            if bez_signalu and '.pmtiles' in u:
                return await rt.abort('internetdisconnected')
            if 'cuzk.cz/' in u or 'cuzk.gov.cz/' in u or 'openstreetmap' in u or 'workers.dev' in u or 'protomaps.github.io' in u or 'amazonaws.com' in u:
                return await rt.abort()
        except Exception:
            pass
        try:
            await rt.continue_()
        except Exception:
            pass
    await page.route('**/*', route)
    await page.add_init_script(init)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    return page


async def beh(url):
    from playwright.async_api import async_playwright
    fixture = url.replace('/index.html', '/tests/fixtures/mapa-praha.pmtiles')
    init = MV.INIT + "localStorage.setItem('agMapaVektor_v1', JSON.stringify({zap:true, styl:'auto', url:%s}));" % json.dumps(fixture)
    async with async_playwright() as pw:
        br = await pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        chyby, poz = [], []
        page = await stranka(ctx, url, init, chyby, poz)
        cekej = MV.cekej
        ok('A0 start', await cekej(page, "document.body.classList.contains('app-started')", 60))
        ok('A1 vlastní mapa zapnutá', await cekej(page, "window.AGMapaVektor && AGMapaVektor.stav() === 'zapnuto' && document.querySelector('#map .maplibregl-canvas')", 60),
           await page.evaluate("() => window.AGMapaVektor && [AGMapaVektor.stav(), AGMapaVektor.chyba()]"))
        a2 = await page.evaluate("() => ({ dlazdice: document.querySelectorAll('#map .leaflet-tile').length, osm: typeof baseLayers.osm.getTileUrl })")
        ok('A2 žádný požadavek na rastr OSM, žádná rastrová dlaždice v mapě', not [u for u in poz if 'openstreetmap' in u] and a2['dlazdice'] == 0, (a2, [u for u in poz if 'openstreetmap' in u][:3]))

        await page.evaluate("() => { map.setView([%f, %f], 17, { animate: false }); }" % (LAT, LNG))
        ok('B0 budovy v datech', await cekej(page, "AGMapaVektor.budovy().length > 50", 60))
        vt = None
        for _ in range(40):
            vt = await page.evaluate("() => AGMapaVektor.vTelefonu()")
            if vt and vt['prohlizeni'] > 3:
                break
            await page.wait_for_timeout(500)
        ok('B1 prohlížení uložilo kusy dat do telefonu (argeodet-mapa-v1)', vt and vt['prohlizeni'] > 3, vt)
        r = await page.evaluate("""() => AGMapaVektor.ulozOblast({ s: %f, w: %f, n: %f, e: %f }, [12, 13, 14, 15, 16, 17], null, 3000)""" % (LAT - 0.004, LNG - 0.006, LAT + 0.004, LNG + 0.006))
        ok('B2 „Uložit okolí" (ulozOblast): dlaždice z12–z15 uložené, z16+ nad maximem dat vynechané', r and r['total'] > 4 and r['ok'] >= r['total'] - 1 and r['net'] == 0, r)
        hl = await page.evaluate("""async () => { var c = await caches.open('argeodet-mapa-offline-v1'); var k = await c.keys(); return { n: k.length, hlavicka: k.some(r => r.url.indexOf('/h?') > 0) }; }""")
        ok('B3 v argeodet-mapa-offline-v1 jsou kusy dat i hlavička', hl['n'] > r['total'] and hl['hlavicka'], hl)
        # starší kusy z prohlížení smazat → offline musí jet jen z „Uložit okolí"
        await page.evaluate("() => caches.delete('argeodet-mapa-v1')")
        await page.close()

        # ================= C: BEZ SIGNÁLU ==========================================
        chyby2, poz2 = [], []
        page = await stranka(ctx, url, init + "localStorage.setItem('arLastPos', JSON.stringify({lat:%f,lng:%f}));" % (LAT, LNG), chyby2, poz2, bez_signalu=True)
        ok('C0 start bez signálu', await cekej(page, "document.body.classList.contains('app-started')", 60))
        ok('C1 vlastní mapa se zapnula z telefonu (hlavička uložená, data odříznutá)', await cekej(page, "window.AGMapaVektor && AGMapaVektor.stav() === 'zapnuto'", 60),
           await page.evaluate("() => window.AGMapaVektor && [AGMapaVektor.stav(), AGMapaVektor.chyba()]"))
        await page.evaluate("() => { map.setView([%f, %f], 15.5, { animate: false }); }" % (LAT, LNG))
        ok('C2 budovy v datech bez signálu', await cekej(page, "AGMapaVektor.budovy().length > 50", 60), await page.evaluate("() => [AGMapaVektor.budovy().length, AGMapaVektor.posledniChyba()]"))
        c3 = await page.evaluate("() => { var m = AGMapaVektor.mapa(); return m ? { budovy: m.queryRenderedFeatures({ layers: ['budovy'] }).length, silnice: m.queryRenderedFeatures({ layers: ['silnice'] }).length } : null; }")
        ok('C3 mapa je vykreslená (budovy i silnice) bez signálu', c3 and c3['budovy'] > 0 and c3['silnice'] > 0, c3)
        ok('C4 požadavky na data opravdu šly do zdi (test simuluje výpadek)', [u for u in poz2 if '.pmtiles' in u], len(poz2))

        # ================= D: oblast ve vlastní cache ===============================
        d = await page.evaluate("""async () => {
            var r = await AGMapaVektor.ulozOblast({ s: %f, w: %f, n: %f, e: %f }, [13, 14], null, 0, { cache: 'argeodet-mapa-o-okres_TEST' });
            var pred = (await (await caches.open('argeodet-mapa-o-okres_TEST')).keys()).length;
            var n = await AGMapaVektor.smazUlozenou('argeodet-mapa-o-okres_TEST');
            var po = (await caches.keys()).indexOf('argeodet-mapa-o-okres_TEST');
            return { r: r, pred: pred, smazano: n, po: po, zbyva: (await caches.keys()).indexOf('argeodet-mapa-offline-v1') >= 0 };
        }""" % (LAT - 0.002, LNG - 0.003, LAT + 0.002, LNG + 0.003))
        ok('D1 oblast se uloží do své cache (i bez signálu z uložených kusů) a smazání odstraní jen ji', d and d['pred'] > 0 and d['smazano'] == 1 and d['po'] < 0 and d['zbyva'], d)
        await ctx.close()

        # ================= E: POMALÝ SIGNÁL PŘI PRVNÍM STARTU ======================
        # (17. 10. 2026, CI: hlavička dat přišla za > 4 s, zdroj ji odmítl a pmtiles si odmítnutí
        #  pamatoval natrvalo → 0 budov). Bez uložené hlavičky se na síť čeká, jak dlouho to trvá.
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        chyby3, pomale = [], {'n': 0}
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby3.append('pageerror: ' + str(e)))

        async def route_pomala(rt, rq):
            u = rq.url
            try:
                if 'cuzk.cz/' in u or 'cuzk.gov.cz/' in u or 'openstreetmap' in u or 'workers.dev' in u or 'protomaps.github.io' in u or 'amazonaws.com' in u:
                    return await rt.abort()
                if '.pmtiles' in u and 'bytes=0-' in (rq.headers.get('range') or ''):
                    pomale['n'] += 1
                    await asyncio.sleep(6)          # hlavička až za 6 s (limit byl 4 s)
            except Exception:
                pass
            try:
                await rt.continue_()
            except Exception:
                pass
        await page.route('**/*', route_pomala)
        await page.add_init_script(init)
        await page.goto(url, wait_until='domcontentloaded', timeout=45000)
        ok('E0 start (pomalý signál, v telefonu nic)', await cekej(page, "document.body.classList.contains('app-started')", 60))
        await cekej(page, "window.AGMapaVektor && AGMapaVektor.stav() === 'zapnuto'", 60)
        await page.evaluate("() => { map.setView([%f, %f], 17, { animate: false }); }" % (LAT, LNG))
        ok('E1 hlavička za 6 s: mapa se i tak načte a má budovy', await cekej(page, "AGMapaVektor.stav() === 'zapnuto' && AGMapaVektor.budovy().length > 50", 80),
           await page.evaluate("() => window.AGMapaVektor && [AGMapaVektor.stav(), AGMapaVektor.budovy().length, AGMapaVektor.posledniChyba(), %d]" % 0))
        ok('E2 zpoždění opravdu proběhlo', pomale['n'] >= 1, pomale)

        vazne = [c for c in chyby + chyby2 + chyby3 if 'WebGL' not in c]
        ok('Z bez chyb stránky', not vazne, vazne[:5])
        await ctx.close()
        await br.close()

    sw = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    ok('S1 sw.js: aktualizace nemaže cache vlastní mapy (argeodet-mapa-*)', "key.indexOf('argeodet-mapa-') !== 0" in sw and "MAPA_CACHE = 'argeodet-mapa-v1'" in sw)
    mv = open(os.path.join(ROOT, 'js', 'mapa-vektor.js'), encoding='utf-8').read()
    ok('S2 názvy cache v js/mapa-vektor.js sedí se sw.js', "MAPA_CACHE = 'argeodet-mapa-v1', MAPA_OFFLINE = 'argeodet-mapa-offline-v1'" in mv and "MAPA_OFFLINE = 'argeodet-mapa-offline-v1'" in sw)
    rastr = []
    for dp, dn, fn in os.walk(os.path.join(ROOT, 'js')):
        if os.sep + 'lib' in dp:
            continue
        for f in fn:
            if f.endswith('.js'):
                for i, radek in enumerate(open(os.path.join(dp, f), encoding='utf-8'), 1):
                    if 'tile.openstreetmap.org/' in radek and 'tileLayer' in radek:
                        rastr.append('%s:%d' % (f, i))
    ok('S3 v kódu appky není žádná rastrová vrstva OSM (L.tileLayer na tile.openstreetmap.org)', not rastr, rastr)


def main():
    srv, url = MV.server(PORT)
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
