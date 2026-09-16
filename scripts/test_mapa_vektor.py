# -*- coding: utf-8 -*-
"""VLASTNI VEKTOROVA MAPA (16. 9. 2026, faze 2 — A1 + M1): js/mapa-vektor.js + js/mapa-styl.js.

  A  vypnuto (vychozi): podklad je rastr OSM, knihovny MapLibre se NEstahuji, v Nastaveni →
     Vzhled je prepinac „Nová mapa (vektor, beta)"
  B  zapnuti s mistni fixture (tests/fixtures/mapa-praha.pmtiles pres Range na test_server):
     knihovny se dotahnou, v Leafletu je platno MapLibre (#map.base-vektor), styl nacteny,
     v dlazdicich jsou budovy (querySourceFeatures > 0) a vykreslene prvky (queryRenderedFeatures),
     AGMapaVektor.budovy() vraci polygony s vyskou, prepnuti Ortofoto a zpet mapu neztrati
  C  styl: tmavy motiv → varianta noc (pozadi tmave), rucni „modrotisk" → setStyle,
     „tisk" → bile pozadi; styl „den" ma 4 varianty a vsechny projdou validaci vrstev
  D  vypnuti vrati rastr OSM; nastaveni prezije reload (localStorage)
  E  VYKRES DXF JAKO VRSTVA (M3): tabulka LAYER s barvami ACI, LWPOLYLINE jako retezec, osa se
     stanicenim po 100 m, klepnuti na caru = popup se stanicenim, radek „Výkres (DXF)" ve Vrstvach,
     AGProjektDxf.vrcholy() pro prichyceni, prepnuti schova/ukaze
  F  3D POHLED (M2): nastroj z MANIFESTu (lazy) otevre celoobrazovkovou mapu MapLibre se stylem
     podkladu + budovy-3d (fill-extrusion s vyskou), body zakazky, vykres DXF (osa tlustsi), moje
     poloha; tlacitka 2D/3D a Teren prepinaji; zavreni uklidi mapu
  G  PRICHYCENI K ROHU (P2): novy bod 0,3 m od bodu vykresu → dialog „Přichytit…" → souradnice z
     vykresu, prov.origin vykres, acc 0,05, prov.prichyceni; vypnuto = bez dialogu; roh budovy z mapy
  H  KOREKCE PODLE HRANY (P1): stopa 8 fixu 1,5 m severne od hrany HRANA (200 m) → navrh posun 1,5 m
     na jih (zdroj dxf), aplikace = agRefShift src hrana-auto; kolma stopa = zadny navrh; rezim ptat = dialog
  I  KVALITA GPS (P3): vypocet 220x220 m, vrstva v mape, uvnitr budovy 0, na volnem >0,6, radek ve Vrstvach

Spusteni: python scripts/test_mapa_vektor.py [port]
"""
import os
import sys
import json
import asyncio
import subprocess
import time
import urllib.request
import math
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from ag_boot import boot  # noqa: E402
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9200)
vysledky = []
LAT, LNG = 50.0755, 14.4378   # uvnitr fixture (14.425–14.455, 50.065–50.085)


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


def server(port):
    for pokus in range(6):
        p = port + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % p
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(p)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                break
            except Exception:
                time.sleep(0.4)
        try:
            t = urllib.request.urlopen('http://127.0.0.1:%d/js/mapa-vektor.js' % p, timeout=2).read().decode('utf-8', 'replace')
            req = urllib.request.Request('http://127.0.0.1:%d/tests/fixtures/mapa-praha.pmtiles' % p, headers={'Range': 'bytes=0-15'})
            r = urllib.request.urlopen(req, timeout=2)
            if 'AGMapaVektor' in t and r.status == 206 and srv.poll() is None:
                return srv, u
        except Exception:
            pass
        srv.terminate()
    return None, None


async def stranka(br, url, init, chyby):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)

    async def route_vse(route, request):
        u = request.url
        try:
            if 'cuzk.cz/' in u or 'cuzk.gov.cz/' in u or 'openstreetmap' in u or 'workers.dev' in u or 'protomaps.github.io' in u or 'amazonaws.com' in u:
                return await route.abort()
        except Exception:
            pass
        try:
            await route.continue_()
        except Exception:
            pass
    await page.route('**/*', route_vse)
    if init:
        await page.add_init_script(init)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    await page.wait_for_timeout(2500)
    return ctx, page


async def cekej(page, vyraz, kol=25):
    for _ in range(kol):
        if await page.evaluate('() => !!(' + vyraz + ')'):
            return True
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(400)
    return False


def dxf_test():
    """Maly DXF v S-JTSK (zaporny Krovak jako z CADu): osa = LWPOLYLINE 3 body ~ 320 m na vrstve OSA
    (ACI 1 cervena), hrana LINE na vrstve HRANA (ACI 5 modra), bod POINT na vrstve BODY, text."""
    from pyproj import Transformer
    t = Transformer.from_crs(4326, 5514, always_xy=True)
    def yx(lat, lng):
        x, y = t.transform(lng, lat); return x, y   # proj4 poradi: [-Y, -X] = CAD X, CAD Y
    m = 111320.0; ml = m * math.cos(math.radians(LAT))
    A = yx(LAT, LNG); B = yx(LAT + 100 / m, LNG + 100 / ml); C = yx(LAT + 100 / m, LNG + 300 / ml)
    H1 = yx(LAT - 20 / m, LNG); H2 = yx(LAT - 20 / m, LNG + 200 / ml)
    P = yx(LAT + 50 / m, LNG + 50 / ml)
    def p(code, val): return '%d\n%s\n' % (code, val)
    s = p(0, 'SECTION') + p(2, 'TABLES') + p(0, 'TABLE') + p(2, 'LAYER')
    for name, aci in (('OSA', 1), ('HRANA', 5), ('BODY', 3)):
        s += p(0, 'LAYER') + p(2, name) + p(70, 0) + p(62, aci) + p(6, 'CONTINUOUS')
    s += p(0, 'ENDTAB') + p(0, 'ENDSEC') + p(0, 'SECTION') + p(2, 'ENTITIES')
    s += p(0, 'LWPOLYLINE') + p(8, 'OSA') + p(90, 3) + p(70, 0)
    for q in (A, B, C): s += p(10, '%.3f' % q[0]) + p(20, '%.3f' % q[1])
    s += p(0, 'LINE') + p(8, 'HRANA') + p(10, '%.3f' % H1[0]) + p(20, '%.3f' % H1[1]) + p(11, '%.3f' % H2[0]) + p(21, '%.3f' % H2[1])
    s += p(0, 'POINT') + p(8, 'BODY') + p(10, '%.3f' % P[0]) + p(20, '%.3f' % P[1])
    s += p(0, 'TEXT') + p(8, 'BODY') + p(10, '%.3f' % P[0]) + p(20, '%.3f' % P[1]) + p(40, 1) + p(1, 'SACHTA 12')
    s += p(0, 'ENDSEC') + p(0, 'EOF')
    return s


INIT = (boot(tarif='pro') + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.setItem('arLastPos', JSON.stringify({lat:%f,lng:%f}));" % (LAT, LNG)
        + "localStorage.setItem('default_arCustomPoints12', %s);" % json.dumps(json.dumps([{'id': 'c1', 'name': 'Bod 1', 'lat': LAT, 'lng': LNG + 0.0004, 'type': 'custom', 'cat': 'CUSTOM', 'hidden': False, 'vyska': 250.0}])))


async def beh(url):
    from playwright.async_api import async_playwright
    fixture = url.replace('/index.html', '/tests/fixtures/mapa-praha.pmtiles')
    async with async_playwright() as pw:
        br = await pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])

        # ================= A: vychozi = vypnuto =================================
        chyby = []
        ctx, page = await stranka(br, url, INIT + "localStorage.removeItem('agMapaVektor_v1');", chyby)
        ok('A0 appka nastartovala', await cekej(page, "document.body.classList.contains('app-started')"))
        ok('A1 modul je nacteny a vypnuty', await cekej(page, "window.AGMapaVektor && AGMapaVektor.stav() === 'vypnuto'", 60), await page.evaluate("() => window.AGMapaVektor && AGMapaVektor.stav()"))
        ok('A2 knihovny MapLibre se NEstahuji, dokud je vypnuto', await page.evaluate("() => !window.maplibregl && !document.querySelector('script[src*=\"maplibre-gl-5\"]')"))
        ok('A3 podklad je rastr OSM (.leaflet-tile v mape, zadne platno MapLibre)', await page.evaluate("() => !!document.querySelector('#map .leaflet-tile-pane img, #map .leaflet-tile') && !document.querySelector('#map .maplibregl-canvas')"))
        await page.evaluate("() => { openSettings(); switchTab('tab-vzhled', document.querySelectorAll('.tab-btn')[0]); }")
        ok('A4 Nastaveni → Vzhled: prepinac „Nová mapa (vektor, beta)", styl a adresa schovane', await cekej(page, "document.getElementById('s-mapa-vektor') && !document.getElementById('s-mapa-vektor').checked && document.getElementById('s-mapa-vektor-vice').style.display === 'none'", 20))

        # ================= B: zapnuti s fixture ====================================
        await page.evaluate("() => { document.getElementById('s-mapa-url').value = %s; document.getElementById('s-mapa-url').dispatchEvent(new Event('change')); }" % json.dumps(fixture))
        await page.evaluate("() => { var s = document.getElementById('s-mapa-vektor'); s.checked = true; s.dispatchEvent(new Event('change')); document.getElementById('settings-modal').style.display = 'none'; }")
        ok('B1 po zapnuti se dotahly knihovny a stav = zapnuto', await cekej(page, "window.maplibregl && window.pmtiles && L.maplibreGL && AGMapaVektor.stav() === 'zapnuto'", 60), await page.evaluate("() => [AGMapaVektor.stav(), AGMapaVektor.chyba()]"))
        ok('B2 v Leafletu je platno MapLibre a #map ma tridu base-vektor', await cekej(page, "document.querySelector('#map .maplibregl-canvas') && document.getElementById('map').classList.contains('base-vektor')", 30))
        ok('B3 styl je nacteny a zdroj je nase fixture', await cekej(page, "AGMapaVektor.mapa() && AGMapaVektor.mapa().isStyleLoaded() && AGMapaVektor.mapa().getStyle().sources.pm.url.indexOf('tests/fixtures/mapa-praha.pmtiles') > 0", 60),
           await page.evaluate("() => { var m = AGMapaVektor.mapa(); return m ? [m.isStyleLoaded(), m.getStyle() && m.getStyle().sources, AGMapaVektor.posledniChyba()] : null; }"))
        await page.evaluate("() => { map.setView([%f, %f], 17, { animate: false }); }" % (LAT, LNG))
        ok('B4 dlazdice obsahuji budovy (querySourceFeatures > 50)', await cekej(page, "AGMapaVektor.budovy().length > 50", 60), await page.evaluate("() => AGMapaVektor.budovy().length"))
        await cekej(page, "AGMapaVektor.budovy().length > 50", 30)
        b = await page.evaluate("() => { var f = AGMapaVektor.budovy(); var s = f.filter(x => x.properties && x.properties.height != null).length; var g = f[0] && f[0].geometry && f[0].geometry.type; return { n: f.length, sVyskou: s, typ: g, priklad: f[0] && f[0].geometry && f[0].geometry.coordinates && f[0].geometry.coordinates[0] && f[0].geometry.coordinates[0][0] }; }")
        ok('B5 budovy jsou polygony v lng/lat, cast ma vysku', b and b['typ'] in ('Polygon', 'MultiPolygon') and b['priklad'] and 14.3 < b['priklad'][0] < 14.6 and 50.0 < b['priklad'][1] < 50.2, b)
        r = await page.evaluate("() => { var m = AGMapaVektor.mapa(); return { budovy: m.queryRenderedFeatures({ layers: ['budovy'] }).length, silnice: m.queryRenderedFeatures({ layers: ['silnice'] }).length, vrstvy: m.getStyle().layers.length }; }")
        ok('B6 vykreslene prvky: budovy i silnice (WebGL bezi)', r and r['budovy'] > 0 and r['silnice'] > 0, r)
        await page.evaluate("() => { agMapSetBase('ortofoto'); }")
        await page.wait_for_timeout(400)
        ok('B7 prepnuti na Ortofoto schova platno', await page.evaluate("() => !map.hasLayer(baseLayers.osm) && !document.getElementById('map').classList.contains('base-vektor')"))
        await page.evaluate("() => { agMapSetBase('osm'); }")
        await page.wait_for_timeout(400)
        ok('B8 zpet na Mapu = zase vektor', await cekej(page, "map.hasLayer(baseLayers.osm) && document.getElementById('map').classList.contains('base-vektor') && AGMapaVektor.mapa()", 10))

        # ================= C: styly ================================================
        ok('C1 svetly motiv → varianta den', await page.evaluate("() => AGMapaVektor.varianta() === 'den' || AGMapaVektor.varianta() === 'noc'"), await page.evaluate("() => [AGMapaVektor.varianta(), document.body.className]"))
        for v in ('noc', 'modrotisk', 'tisk', 'den'):
            await page.evaluate("() => AGMapaVektor.nastav({ styl: %s })" % json.dumps(v))
            await page.wait_for_timeout(500)
            pal = await page.evaluate("() => AGMapaStyl.PALETY[%s].zem" % json.dumps(v))
            got = await page.evaluate("() => { var m = AGMapaVektor.mapa(); var l = m.getStyle().layers[0]; return [m.getStyle().name, l.paint['background-color']]; }")
            ok('C2 styl „%s": setStyle prosel, pozadi = paleta' % v, got and got[0].endswith(v) and got[1] == pal, got)
        vals = await page.evaluate("() => AGMapaStyl.VARIANTY.map(v => { var s = AGMapaStyl.vytvor(v, 'x.pmtiles'); return [v, s.layers.length, s.layers.every(l => l.id && l.type && (l.type === 'background' || (l.source === 'pm' && l['source-layer'])))]; })")
        ok('C3 vsechny 4 varianty stylu maji stejne vrstvy a kazda vrstva ma zdroj', all(x[2] for x in vals) and len(set(x[1] for x in vals)) == 1 and vals[0][1] >= 20, vals)
        await page.evaluate("() => AGMapaVektor.nastav({ styl: 'auto' })")

        # ================= D: vypnuti + persistence ================================
        await page.evaluate("() => AGMapaVektor.nastav({ zap: false })")
        await page.wait_for_timeout(600)
        d1 = await page.evaluate("() => [AGMapaVektor.stav(), document.getElementById('map').className, map.hasLayer(baseLayers.osm), typeof baseLayers.osm.getTileUrl]")
        ok('D1 vypnuti vrati rastr OSM', d1[0] == 'vypnuto' and 'base-vektor' not in d1[1] and d1[2] and d1[3] == 'function', d1)
        # ================= E: vykres DXF jako vrstva (M3) ============================
        ok('E0 modul importu projektu ma API AGProjektDxf', await cekej(page, "window.AGProjektDxf && AGProjektDxf.nacti", 30))
        d = await page.evaluate("(txt) => { var d = AGProjektDxf.nacti(txt); return { polys: d.polys.length, vrstvy: Object.keys(d.layers), aci: [d.layers.OSA.aci, d.layers.HRANA.aci], body: d.points.length, texty: d.texts.length, osaPts: d.polys[0].pts.length }; }", dxf_test())
        ok('E1 parser: 2 retezce (osa 3 body + hrana), barvy vrstev z tabulky LAYER, 1 bod, 1 text', d and d['polys'] == 2 and d['aci'] == [1, 5] and d['body'] == 1 and d['texty'] == 1 and d['osaPts'] == 3, d)
        ok('E2 radek „Výkres (DXF)" ve Vrstvach se odkryl a je aktivni', await cekej(page, "document.getElementById('ms-dxf') && !document.getElementById('ms-dxf').hidden && document.getElementById('ms-dxf').classList.contains('ctrl-active')", 10))
        c = await page.evaluate("() => { var out = []; map.eachLayer(l => { if (l instanceof L.Polyline && !(l instanceof L.Polygon) && l.options && l.options.interactive && l.options.bubblingMouseEvents === false) out.push({ barva: l.options.color, w: l.options.weight, n: l.getLatLngs().length }); }); return out; }")
        ok('E3 cary v mape maji barvy CADu (OSA cervena #ff3b30, HRANA modra #3a6cff)', len(c) == 2 and sorted(x['barva'] for x in c) == ['#3a6cff', '#ff3b30'], c)
        await page.evaluate("() => { var d = AGProjektDxf.design(); d.osa = 'OSA'; AGProjektDxf.prepni(true); }")
        st = await page.evaluate("() => { var o = AGProjektDxf.osa(); var s = AGProjektDxf.stanicteni({ lat: %f + 100 / 111320, lng: %f + 200 / (111320 * Math.cos(%f * Math.PI / 180)) }); return { delka: o && AGProjektDxf.delkaPoly(o), stan: s && s.stan, text: s && s.text, d: s && s.d, znacky: document.querySelectorAll('.agpi-stan').length }; }" % (LAT, LNG, LAT))
        ok('E4 osa: delka ~341 m (141 + 200), stanicteni bodu na ose ~241 m = „km 0,241", kolma vzdalenost ~0, znacky po 100 m (4)',
           st and abs(st['delka'] - 341.4) < 1.5 and abs(st['stan'] - 241.4) < 1.5 and st['text'] == 'km 0,241' and st['d'] < 0.5 and st['znacky'] == 4, st)
        v = await page.evaluate("() => AGProjektDxf.vrcholy().map(v => v.co)")
        ok('E5 vrcholy pro prichyceni: bod + 3 lomy osy + 2 lomy hrany', len(v) == 6 and sum(1 for x in v if 'osa' in x) == 3, v)
        pp = await page.evaluate("() => { var poly = null; map.eachLayer(l => { if (l instanceof L.Polyline && l.options && l.options.weight === 4) poly = l; }); if (!poly) return null; var ll = poly.getLatLngs()[1]; poly.fire('click', { latlng: ll, originalEvent: {} }); var el = document.querySelector('.leaflet-popup-content'); return el ? el.textContent : null; }")
        ok('E6 klepnuti na osu otevre popup: vrstva OSA, delka, stanicteni km 0,141', pp and 'OSA' in pp and 'km 0,141' in pp, pp)
        await page.evaluate("() => AGProjektDxf.prepni(false)")
        n = await page.evaluate("() => { var n = 0; map.eachLayer(l => { if (l instanceof L.Polyline && l.options && l.options.bubblingMouseEvents === false) n++; }); return [n, document.getElementById('ms-dxf').classList.contains('ctrl-active'), localStorage.getItem('agDxfVrstva_v1')]; }")
        ok('E7 prepnuti radku vykres schova (0 car) a pamatuje si to', n == [0, False, '0'], n)
        await page.evaluate("() => AGProjektDxf.prepni(true)")

        # ================= F: 3D pohled (M2) =========================================
        await page.evaluate("() => { localStorage.setItem('agPohled3d_v1', JSON.stringify({ teren: false, pitch: 60 })); }")
        ok('F0 nastroj 3D pohled je v MANIFESTu lazy nastroju', await page.evaluate("() => !!(window.AGLazyTools && AGLazyTools.manifest.some(t => t.id === 'pohled-3d'))"))
        await page.evaluate("() => AGLazyTools.load('js/pohled-3d.js')")
        ok('F1 modul se nacetl a registroval (agOpenPohled3d)', await cekej(page, "typeof window.agOpenPohled3d === 'function'", 30))
        await page.evaluate("() => { window.agOpenPohled3d(); }")
        ok('F2 okno #ag3d je videt a MapLibre mapa bezi', await cekej(page, "document.getElementById('ag3d') && document.getElementById('ag3d').style.display === 'block' && window.AGPohled3d.mapa() && AGPohled3d.mapa().isStyleLoaded && AGPohled3d.mapa().isStyleLoaded()", 60),
           await page.evaluate("() => window.AGPohled3d && [!!document.getElementById('ag3d'), AGPohled3d.mapa() && AGPohled3d.mapa().isStyleLoaded()]"))
        s3 = await page.evaluate("() => { var m = AGPohled3d.mapa(); var st = m.getStyle(); var ids = st.layers.map(l => l.id); var ex = st.layers.find(l => l.id === 'budovy-3d'); return { ids: ids.filter(i => /budovy|vykres|body|ja-|stin/.test(i)), typ: ex && ex.type, vyska: ex && JSON.stringify(ex.paint['fill-extrusion-height']), teren: !!st.terrain, pitch: m.getPitch(), body: m.getSource('body').serialize().data.features.length, vykres: m.getSource('vykres').serialize().data.features.length, ja: m.getSource('ja').serialize().data.features.length }; }")
        ok('F3 styl: budovy-3d = fill-extrusion s vyskou z OSM (coalesce height, 8), body/vykres/ja zdroje, pitch 60, teren vypnuty',
           s3 and s3['typ'] == 'fill-extrusion' and 'height' in s3['vyska'] and 'budovy-3d' in s3['ids'] and 'vykres-cary' in s3['ids'] and 'body-kruh' in s3['ids'] and not s3['teren'] and abs(s3['pitch'] - 60) < 1 and s3['body'] >= 1 and s3['vykres'] >= 3 and s3['ja'] == 1, s3)
        await page.evaluate("() => { AGPohled3d.mapa().jumpTo({ center: [%f, %f], zoom: 17.5 }); }" % (LNG, LAT))
        ok('F4 vykreslene 3D budovy (queryRenderedFeatures budovy-3d > 0)', await cekej(page, "AGPohled3d.mapa().queryRenderedFeatures({ layers: ['budovy-3d'] }).length > 0", 40), await page.evaluate("() => AGPohled3d.mapa().queryRenderedFeatures({ layers: ['budovy-3d'] }).length"))
        await page.click('#ag3d-pitch'); await page.wait_for_timeout(700)
        ok('F5 tlacitko 2D/3D sklopi na 0 a ulozi', await page.evaluate("() => AGPohled3d.mapa().getPitch() < 1 && JSON.parse(localStorage.getItem('agPohled3d_v1')).pitch === 0"))
        await page.click('#ag3d-teren'); await page.wait_for_timeout(700)
        ok('F6 tlacitko Teren zapne terrain + hillshade ve stylu', await cekej(page, "AGPohled3d.mapa().getStyle().terrain && AGPohled3d.mapa().getStyle().layers.some(l => l.id === 'stin')", 20))
        await page.click('#ag3d-zavrit'); await page.wait_for_timeout(300)
        ok('F7 zavreni schova okno a uklidi mapu', await page.evaluate("() => document.getElementById('ag3d').style.display === 'none' && !AGPohled3d.mapa()"))
        # ================= G: prichyceni k rohu (P2) ===================================
        ok('G0 moduly hrany + prichyceni + hrana-auto nacteny', await cekej(page, "window.AGHrany && window.AGPrichyceni && window.AGHranaAuto", 30))
        m = 111320.0; ml = m * math.cos(math.radians(LAT))
        B = (LAT + 100 / m, LNG + 100 / ml)     # 2. vrchol osy z DXF
        k = await page.evaluate("() => AGPrichyceni.kandidat(%f + 0.3 / 111320, %f)" % B)
        ok('G1 kandidat 0,3 m od lomu osy vykresu: zdroj dxf, d ~0,3', k and k['zdroj'] == 'dxf' and abs(k['d'] - 0.3) < 0.05 and 'osa' in k['popis'], k)
        ok('G2 1,0 m od lomu vykresu uz kandidat neni (dosah 0,6)', await page.evaluate("() => AGPrichyceni.kandidat(%f + 1.0 / 111320, %f) === null" % B))
        r = await page.evaluate("""() => { openNewPointModal(); var mm = agMistni(%f + 0.3 / 111320, %f);
            document.getElementById('custom-name').value = 'Snap1'; document.getElementById('custom-y').value = mm.y.toFixed(2); document.getElementById('custom-x').value = mm.x.toFixed(2);
            window._agPointOrigin = 'gps-avg'; var n0 = persistentCustomPoints.length; saveCustomPoint();
            return { n0: n0, dlg: (document.querySelector('.ag-dlg-title') || {}).textContent || '', pribylHned: persistentCustomPoints.length !== n0 }; }""" % B)
        ok('G3 saveCustomPoint otevre dialog „Přichytit k bodu výkresu?" a bod jeste neulozi', r and 'Přichytit' in r['dlg'] and not r['pribylHned'], r)
        await page.click('.ag-dlg-ok'); await page.wait_for_timeout(400)
        p = await page.evaluate("() => { var p = persistentCustomPoints.find(q => q.name === 'Snap1'); return p ? { d: GeoCore.getDistance(p.lat, p.lng, %f, %f), origin: p.prov && p.prov.origin, acc: p.acc, pri: p.prov && p.prov.prichyceni } : { names: persistentCustomPoints.map(q => q.name), open: !!document.querySelector('.ag-dlg-overlay.open'), t: (document.querySelector('.ag-dlg-title') || {}).textContent, msg: ((document.querySelector('.ag-dlg-msg') || {}).textContent || '').slice(0, 160) }; }" % B)
        ok('G4 bod ma souradnice lomu (d < 10 cm; pyproj vs proj4js), origin vykres, acc 0,05, prov.prichyceni', p and 'd' in p and p['d'] < 0.1 and p['origin'] == 'vykres' and p['acc'] == 0.05 and p['pri'] and abs(p['pri']['d'] - 0.3) < 0.05, p)
        await page.evaluate("() => AGPrichyceni.nastav({ zap: false })")
        r2 = await page.evaluate("""() => { openNewPointModal(); var mm = agMistni(%f + 0.3 / 111320, %f);
            document.getElementById('custom-name').value = 'Snap2'; document.getElementById('custom-y').value = mm.y.toFixed(2); document.getElementById('custom-x').value = mm.x.toFixed(2);
            window._agPointOrigin = 'gps-avg'; var n0 = persistentCustomPoints.length; saveCustomPoint();
            var p = persistentCustomPoints.find(q => q.name === 'Snap2'); return { pribylHned: persistentCustomPoints.length === n0 + 1, dlg: document.querySelector('.ag-dlg-overlay.open') ? (document.querySelector('.ag-dlg-title') || {}).textContent : '', origin: p && p.prov && p.prov.origin }; }""" % B)
        ok('G5 vypnute prichytavani: bod se ulozi rovnou bez dialogu (origin gps-avg)', r2 and r2['pribylHned'] and 'Přichytit' not in r2['dlg'] and r2['origin'] == 'gps-avg', r2)
        await page.evaluate("() => AGPrichyceni.nastav({ zap: true })")
        bud = await page.evaluate("() => { var f = AGMapaVektor.budovy(); if (!f.length) return null; var g = f[0].geometry; var c = (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0])[0]; var v = AGHrany.nejblizsiVrchol(c[1] + 0.4 / 111320, c[0], 1.2); return v && { zdroj: v.zdroj, d: v.d, popis: v.popis, presnost: v.presnost }; }")
        ok('G6 roh budovy z vektorove mapy: nejblizsiVrchol do 0,4 m → zdroj budova, presnost 0,5', bud and bud['zdroj'] == 'budova' and bud['d'] <= 0.45 and bud['presnost'] == 0.5, bud)

        # ================= H: korekce podle hrany (P1) =================================
        await page.evaluate("() => { AGHranaAuto.vymaz(); localStorage.removeItem('agRefShift'); window.agRefShift = null; }")
        # hrana HRANA: H1 (LAT-20 m, LNG) → H2 (LAT-20 m, LNG+200 m). Stopa: 8 fixu po 5 m, 1,5 m SEVERNE od hrany (+ sum ±0,1 m)
        await page.evaluate("""() => { var m = 111320, ml = m * Math.cos(%f * Math.PI / 180); var t0 = Date.now() - 60000;
            for (var i = 0; i < 9; i++) { var e = 40 + i * 5, n = -20 + 1.5 + ((i %% 2) ? 0.1 : -0.1); AGHranaAuto.vlozFix(%f + n / m, %f + e / ml, t0 + i * 5000, 3); } }""" % (LAT, LAT, LNG))
        nav = await page.evaluate("() => { var n = AGHranaAuto.vyhodnot(); return n && { posun: n.posun, zdroj: n.zdroj, popis: n.popis, n: n.n, delka: n.delka, dN: n.dN, dE: n.dE, rozptyl: n.rozptyl, uhel: n.uhel }; }")
        ok('H1 vyhodnoceni stopy: navrh posun ~1,5 m, zdroj dxf (HRANA), 9 fixu, 40 m, posun na JIH (dN ~ -1,5, dE ~ 0)',
           nav and abs(nav['posun'] - 1.5) < 0.15 and nav['zdroj'] == 'dxf' and 'HRANA' in nav['popis'] and nav['n'] == 9 and abs(nav['dN'] + 1.5) < 0.15 and abs(nav['dE']) < 0.1 and nav['rozptyl'] < 0.2 and nav['uhel'] < 3, nav)
        await page.evaluate("() => AGHranaAuto.aplikuj(AGHranaAuto.vyhodnot())")
        sh = await page.evaluate("() => { var s = window.agRefShift; return s && { src: s.src, dN: s.dlat * 111320, on: s.on, mode: s.mode, ref: s.ref, ls: !!localStorage.getItem('agRefShift') }; }")
        ok('H2 aplikace = agRefShift src hrana-auto, 1D, dN ~ -1,5 m, ulozeno', sh and sh['src'] == 'hrana-auto' and abs(sh['dN'] + 1.5) < 0.15 and sh['on'] and sh['mode'] == '1d' and sh['ls'], sh)
        await page.evaluate("""() => { AGHranaAuto.vymaz(); var m = 111320, ml = m * Math.cos(%f * Math.PI / 180); var t0 = Date.now() - 60000;
            for (var i = 0; i < 9; i++) { var e = 100, n = -20 + 1.5 + i * 5; AGHranaAuto.vlozFix(%f + n / m, %f + e / ml, t0 + i * 5000, 3); } }""" % (LAT, LAT, LNG))
        ok('H3 stopa KOLMO k hrane = zadny navrh', await page.evaluate("() => AGHranaAuto.vyhodnot() === null"))
        await page.evaluate("""() => { AGHranaAuto.vymaz(); window.agRefShift = null; localStorage.removeItem('agRefShift'); AGHranaAuto.nastav({ rezim: 'ptat' });
            var m = 111320, ml = m * Math.cos(%f * Math.PI / 180); var t0 = Date.now() - 60000;
            for (var i = 0; i < 9; i++) { var e = 40 + i * 5, n = -20 - 2.0; AGHranaAuto.vlozFix(%f + n / m, %f + e / ml, t0 + i * 5000, 3); }
            AGHranaAuto.tik._posl = 0; AGHranaAuto.tik(); }""" % (LAT, LAT, LNG))
        ok('H4 rezim „zeptat se": tik otevre dialog „Srovnat GPS podle hrany?" s 2,0 m', await cekej(page, "document.querySelector('.ag-dlg-title') && /Srovnat GPS podle hrany/.test(document.querySelector('.ag-dlg-title').textContent) && /(1,9[0-9]|2,0[0-9]) m/.test(document.querySelector('.ag-dlg-msg').textContent)", 10),
           await page.evaluate("() => [(document.querySelector('.ag-dlg-title') || {}).textContent, (document.querySelector('.ag-dlg-msg') || {}).textContent]"))
        await page.click('.ag-dlg-cancel'); await page.wait_for_timeout(300)
        ok('H5 „Ne" = bez korekce a hrana umlcena', await page.evaluate("() => !window.agRefShift && !!AGHranaAuto.vyhodnot() && (AGHranaAuto.tik._posl = 0, AGHranaAuto.tik(), !document.querySelector('.ag-dlg-overlay.open'))"))

        # ================= I: mapa kvality GPS (P3) ====================================
        await page.evaluate("() => AGLazyTools.load('js/mapa-kvality-gps.js')")
        ok('I0 modul nacteny', await cekej(page, "window.AGKvalitaGpsMapa", 30))
        v = await page.evaluate("() => { var v = AGKvalitaGpsMapa.spocitej({ lat: %f, lng: %f }); AGKvalitaGpsMapa.prepni(true); var f = AGMapaVektor.budovy().filter(x => x.geometry && (x.geometry.type === 'Polygon' || x.geometry.type === 'MultiPolygon')).map(x => { var g = x.geometry; var ring = (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]); var cx = 0, cy = 0; ring.forEach(c => { cx += c[0]; cy += c[1]; }); return { cx: cx / ring.length, cy: cy / ring.length, d: GeoCore.getDistance(cy / ring.length, cx / ring.length, v.stred.lat, v.stred.lng) }; }).sort((a, b) => a.d - b.d)[0]; var cx = f.cx, cy = f.cy; return { budov: v.budov, cells: v.cells, stat: v.stat, ms: v.ms, uvnitr: AGKvalitaGpsMapa.skoreV(cy, cx), radek: !document.getElementById('ms-kvgps').hidden, overlay: !!document.querySelector('.ag-kvgps-overlay') }; }" % (LAT, LNG))
        ok('I1 vypocet: budovy > 20, mrizka 55x55, vsechny tri tridy zastoupene, vrstva v mape, radek ve Vrstvach', v and v['budov'] > 20 and v['cells'] == 55 and v['stat']['z'] > 0 and v['stat']['c'] > 0 and v['overlay'] and v['radek'], v)
        ok('I2 uvnitr budovy skore 0 (nemeritelne)', v and v['uvnitr'] == 0, v and v['uvnitr'])
        mx = await page.evaluate("() => { var p = AGKvalitaGpsMapa.posledni(); var best = 0; for (var i = 0; i < p.mrizka.length; i++) if (p.mrizka[i] > best) best = p.mrizka[i]; return best; }")
        ok('I3 nekde na volnem je skore ≥ 0,85', mx >= 0.85, mx)
        await page.evaluate("() => AGKvalitaGpsMapa.prepni(false)")
        ok('I4 prepnuti radku vrstvu schova', await page.evaluate("() => !document.querySelector('.ag-kvgps-overlay') && !document.getElementById('ms-kvgps').classList.contains('ctrl-active')"))

        chyby_a = [c for c in chyby if 'Failed to load resource' not in c and 'WebGL' not in c]
        ok('A–I bez chyb stranky', not chyby_a, chyby_a[:5])
        await ctx.close()

        chyby = []
        # novy kontext = prazdne uloziste → nastaveni se podstrci tak, jak ho modul uklada
        ctx, page = await stranka(br, url, INIT + "localStorage.setItem('agMapaVektor_v1', JSON.stringify({zap:true, styl:'auto', url:%s}));" % json.dumps(fixture), chyby)
        await cekej(page, "document.body.classList.contains('app-started')")
        ok('D2 po startu se vektorova mapa zapne sama (nastaveni v localStorage)', await cekej(page, "window.AGMapaVektor && AGMapaVektor.stav() === 'zapnuto' && document.querySelector('#map .maplibregl-canvas')", 60), await page.evaluate("() => window.AGMapaVektor && [AGMapaVektor.stav(), AGMapaVektor.chyba(), AGMapaVektor.nastaveni()]"))
        await ctx.close()
        await br.close()


def main():
    srv, url = server(PORT)
    if not srv:
        print('CHYBA: server se nepodarilo spustit (nebo neumi Range)'); return 2
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('-' * 60)
    print('proslo %d / %d' % (len(vysledky) - len(spatne), len(vysledky)))
    return 1 if spatne else 0


if __name__ == '__main__':
    sys.exit(main())
