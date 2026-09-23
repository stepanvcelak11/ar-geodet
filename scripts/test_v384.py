# -*- coding: utf-8 -*-
u"""Regrese k v384 (19. 9. 2026 noc): hranice parcel a chodniky ve vlastni mape, modrotisk pryc.

Prani uzivatele: „v ty mape, jak je ciste ve 2D, abych tam mohl videt hranice pozemku … chodnik nebo
hrany podel silnice, ktery se da kalibrovat za chuze" + „modrotisk dej pryc, den/noc/tisk nech".

  A  STYL: varianty jen den · noc · tisk (AGMapaStyl.VARIANTY, tlacitka #ms-styl bez Modrotisku); ulozeny
     styl 'modrotisk' spadne na 'auto'; motiv Modrotisk (body.theme-blueprint) → varianta noc; kazda varianta
     ma vrstvy chodniky, prechody, parcely-hranice, parcely-cisla a zdroj 'parcely' (GeoJSON, prazdny).
  B  CHODNIKY: v dlazdicich (fixture Praha) jsou kind=path + kind_detail sidewalk/crossing; vrstva 'chodniky' je
     vykreslena (queryRenderedFeatures > 0 na z17), vrstva 'cesty' uz chodniky NEobsahuje (filtr), sirky
     sidewalk/crossing v SIRKY (ne vychozich 7 px).
  C  PARCELY VEKTOROVE: karta Katastr + vektor + Cesko + z ≥ 16 → AGMapaParcely.aktivni(); dotaz na RUIAN
     (podstrceny: 2 parcely se spolecnou hranou) → pocet() = 2, zdroj 'parcely' ma data, 'parcely-hranice'
     vykreslena; WMS katastrLayer NENI na mape (hranice by byly dvakrat); prepnuti stylu (tisk) parcely
     zachova (style.load → setData); Ortofoto → aktivni false + WMS zpet; zpet na Mapu → WMS zase pryc;
     Katastr vypnout → zdroj prazdny; bunky se nestahuji dvakrat (druhy moveend bez dotazu).
  D  KALIBRACE PO HRANE: AGHrana._test.snapParcelyMapy klepnuti 2 m od spolecne hrany → prichyceni na
     hranu (d ≈ 2, lng = hrana); 10 m od hrany → nic; snapChodnik 2 m od chodniku z dlazdic → bod na care,
     kd = sidewalk; bez vektoru (Ortofoto) → null.
  E  STATIKA: index.html bez data-styl="modrotisk", mapa-parcely.js v index.html i sw.js, slovniky 8 jazyku
     maji novy klic karty Katastr, Co je noveho v384 ve vsech 9 souborech; bez chyb stranky.

Spusteni:  python scripts/test_v384.py [port]
"""
import io
import os
import re
import sys
import json
import asyncio

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_mapa_vektor as T  # noqa: E402  (server s fixture, cekej, INIT, LAT/LNG)

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9280)
LAT, LNG = T.LAT, T.LNG
vysledky = []
ruian = {'dotazy': 0}


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


# dve parcely 60 x 60 m se spolecnou hranou na poledniku LNG (ESRI JSON jako z RUIAN)
def parcely_json():
    m = 111320.0
    dlat, dlng = 30 / m, 30 / (m * 0.6428)
    a = [[LNG - 2 * dlng, LAT - dlat], [LNG, LAT - dlat], [LNG, LAT + dlat], [LNG - 2 * dlng, LAT + dlat], [LNG - 2 * dlng, LAT - dlat]]
    b = [[LNG, LAT - dlat], [LNG + 2 * dlng, LAT - dlat], [LNG + 2 * dlng, LAT + dlat], [LNG, LAT + dlat], [LNG, LAT - dlat]]
    return json.dumps({'features': [
        {'attributes': {'id': 1001, 'cisloparcely': '123/1', 'zdroj': 1, 'druhpozemkukod': 2}, 'geometry': {'rings': [a]}},
        {'attributes': {'id': 1002, 'cisloparcely': '123/2', 'zdroj': 2, 'druhpozemkukod': 14}, 'geometry': {'rings': [b]}},
    ]})


def staticke():
    ix = src('index.html')
    ok('E1 index.html: tlacitko Modrotisk pryc, Den/Noc/Tisk zustavaji', 'data-styl="modrotisk"' not in ix and 'data-styl="noc"' in ix and 'data-styl="tisk"' in ix and 'data-styl="den"' in ix)
    ok('E2 js/mapa-parcely.js je v index.html (ag/lazy) i v sw.js', 'data-src="js/mapa-parcely.js"' in ix and './js/mapa-parcely.js' in src('sw.js'))
    st = src('js/mapa-styl.js')
    ok('E3 styl: bez palety modrotisk, s klici chodnik/parcela, vrstvy chodniky + parcely', "modrotisk: {" not in st and st.count('chodnik:') == 3 and st.count('parcela:') == 3 and "id: 'chodniky'" in st and "id: 'parcely-hranice'" in st and "id: 'parcely-cisla'" in st)
    chybi = []
    for l in ('en', 'de', 'pl', 'es', 'it', 'fr', 'nl', 'pt'):
        j = json.loads(src('data/jazyky-%s.json' % l)).get('t', {})
        if 'hranice a čísla parcel; klepnutí = vlastník' not in j or 'parcely přes podklad; klepnutí = vlastník' in j:
            chybi.append(l)
    ok('E4 slovniky 8 jazyku maji novy klic karty Katastr (stary pryc)', not chybi, chybi)
    chybi = []
    for f in ('', '-en', '-de', '-pl', '-es', '-it', '-fr', '-nl', '-pt'):
        j = json.loads(src('data/co-je-noveho%s.json' % f))
        if not any(v.get('v') == 384 for v in j.get('verze', [])):
            chybi.append(f or 'cs')
    ok('E5 Co je noveho v384 ve vsech 9 souborech', not chybi, chybi)
    # ⚠ NE rovnost: pribite cislo verze shodi test pri KAZDEM dalsim vydani (23. 9. 2026 u v385)
    _m = re.search(r"SHELL_CACHE = 'argeodet-shell-v(\d+)'", src('sw.js'))
    ok('E6 SHELL_CACHE >= v384', bool(_m) and int(_m.group(1)) >= 384, _m and _m.group(0))
    ok('E7 pohled-3d a mapa-vektor bez varianty modrotisk', "'modrotisk'" not in src('js/pohled-3d.js') and "return 'modrotisk'" not in src('js/mapa-vektor.js'))


async def stranka(br, url, init, chyby):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))

    async def route_vse(route, request):
        u = request.url
        try:
            if 'Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/5/query' in u:
                ruian['dotazy'] += 1
                return await route.fulfill(status=200, content_type='application/json', body=parcely_json())
            if 'cuzk.cz/' in u or 'cuzk.gov.cz/' in u or 'openstreetmap' in u or 'workers.dev' in u or 'protomaps.github.io' in u or 'amazonaws.com' in u:
                return await route.abort()
        except Exception:
            pass
        try:
            await route.continue_()
        except Exception:
            pass
    await page.route('**/*', route_vse)
    await page.add_init_script(init)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    await page.wait_for_timeout(2500)
    return ctx, page


async def beh(url):
    from playwright.async_api import async_playwright
    fixture = url.replace('/index.html', '/tests/fixtures/mapa-praha.pmtiles')
    async with async_playwright() as pw:
        br = await pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        chyby = []
        # ulozeny styl 'modrotisk' (z drivejska) + karta Katastr vypnuta
        init = T.INIT + ("localStorage.setItem('agMapaVektor_v1', JSON.stringify({zap:true, styl:'modrotisk', url:%s}));" % json.dumps(fixture)
                         + "try{var v=JSON.parse(localStorage.getItem('arVisSettings12')||'{}');v.showKatastr=false;v.baseLayer='osm';localStorage.setItem('arVisSettings12',JSON.stringify(v));}catch(e){}")
        ctx, page = await stranka(br, url, init, chyby)
        ok('A0 appka nastartovala', await T.cekej(page, "document.body.classList.contains('app-started')"))
        ok('A1 vektorova mapa bezi (fixture)', await T.cekej(page, "window.AGMapaVektor && AGMapaVektor.stav() === 'zapnuto' && AGMapaVektor.mapa() && AGMapaVektor.mapa().isStyleLoaded()", 60), await page.evaluate("() => window.AGMapaVektor && [AGMapaVektor.stav(), AGMapaVektor.chyba()]"))
        ok('A2 ulozeny styl modrotisk spadl na auto; VARIANTY = den/noc/tisk', await page.evaluate("() => AGMapaVektor.nastaveni().styl === 'auto' && JSON.stringify(AGMapaStyl.VARIANTY) === '[\"den\",\"noc\",\"tisk\"]'"), await page.evaluate("() => [AGMapaVektor.nastaveni(), AGMapaStyl.VARIANTY]"))
        ok('A3 #ms-styl: Podle motivu · Den · Noc · Tisk (bez Modrotisku)', await page.evaluate("() => { var b = Array.from(document.querySelectorAll('#ms-styl [data-styl]')).map(x => x.getAttribute('data-styl')); return JSON.stringify(b) === '[\"auto\",\"den\",\"noc\",\"tisk\"]'; }"), await page.evaluate("() => Array.from(document.querySelectorAll('#ms-styl [data-styl]')).map(x => x.getAttribute('data-styl'))"))
        v = await page.evaluate("() => { document.body.classList.add('theme-blueprint'); var v = AGMapaVektor.varianta(); document.body.classList.remove('theme-blueprint'); return v; }")
        ok('A4 motiv Modrotisk (theme-blueprint) → varianta noc', v == 'noc', v)
        vr = await page.evaluate("() => AGMapaStyl.VARIANTY.map(v => { var s = AGMapaStyl.vytvor(v, 'x.pmtiles'); var ids = s.layers.map(l => l.id); return [v, !!s.sources.parcely && s.sources.parcely.type === 'geojson', ['chodniky', 'prechody', 'parcely-hranice', 'parcely-cisla'].every(i => ids.indexOf(i) >= 0), s.layers.filter(l => l.source === 'parcely').every(l => l.paint['line-color'] === AGMapaStyl.PALETY[v].parcela || l.paint['text-color'] === AGMapaStyl.PALETY[v].parcela)]; })")
        ok('A5 kazda varianta ma zdroj parcely + vrstvy chodniky/prechody/parcely v barve palety', all(x[1] and x[2] and x[3] for x in vr), vr)

        # ================= B: chodniky =============================================
        await page.evaluate("() => map.setView([%f, %f], 17, { animate: false })" % (LAT, LNG))
        await page.wait_for_timeout(2500)
        r = await page.evaluate("""() => { var m = AGMapaVektor.mapa(); var q = l => m.queryRenderedFeatures({ layers: [l] });
            var ch = q('chodniky'), ce = q('cesty');
            return { chodniky: ch.length, kd: Array.from(new Set(ch.map(f => f.properties.kind_detail))), cestyChodnik: ce.filter(f => ['sidewalk', 'crossing'].indexOf(f.properties.kind_detail) >= 0).length, cesty: ce.length,
                sirky: (function () { var s = JSON.stringify(m.getStyle().layers.find(l => l.id === 'cesty').paint['line-width']); return s.indexOf('"sidewalk"') >= 0 && s.indexOf('"crossing"') >= 0; })() }; }""")
        ok('B1 vrstva chodniky je vykreslena (sidewalk/crossing z dlazdic)', r and r['chodniky'] > 0 and 'sidewalk' in r['kd'], r)
        ok('B2 vrstva cesty uz chodniky neobsahuje, sirky sidewalk/crossing v SIRKY', r and r['cestyChodnik'] == 0 and r['cesty'] > 0 and r['sirky'], r)

        # ================= C: parcely vektorove ====================================
        ok('C0 modul mapa-parcely nacteny, zatim neaktivni (Katastr vypnuty)', await T.cekej(page, "window.AGMapaParcely && !AGMapaParcely.aktivni()", 20))
        n0 = ruian['dotazy']
        await page.evaluate("() => toggleKatastr()")
        ok('C1 karta Katastr + vektor + Cesko + z17 → aktivni, RUIAN dotazan, 2 parcely v pameti', await T.cekej(page, "AGMapaParcely.aktivni() && AGMapaParcely.pocet() === 2", 30), await page.evaluate("() => [AGMapaParcely.aktivni(), AGMapaParcely.stat(), AGSour && AGSour.kod()]"))
        ok('C2 RUIAN dotaz probehl (podstrceny)', ruian['dotazy'] > n0, ruian)
        await page.wait_for_timeout(1500)
        r = await page.evaluate("""() => { var m = AGMapaVektor.mapa(); var ids = {}; m.querySourceFeatures('parcely').forEach(f => { ids[f.properties.id] = 1; }); return { data: Object.keys(ids).length, hranice: m.queryRenderedFeatures({ layers: ['parcely-hranice'] }).length, wms: map.hasLayer(katastrLayer), kat: visSettings.showKatastr }; }""")
        ok('C3 zdroj parcely ma 2 prvky, hranice vykreslene, WMS katastr NENI na mape', r and r['data'] == 2 and r['hranice'] > 0 and r['wms'] is False and r['kat'] is True, r)
        await page.evaluate("() => map.panBy([15, 15], { animate: false })")
        await page.wait_for_timeout(1200)
        n1 = ruian['dotazy']
        await page.evaluate("() => map.panBy([-15, -15], { animate: false })")
        await page.wait_for_timeout(1200)
        ok('C4 posun zpet do stazenych bunek = zadny dalsi dotaz', ruian['dotazy'] == n1 and await page.evaluate("() => AGMapaParcely.stat().bunky > 0"), [ruian, await page.evaluate("() => AGMapaParcely.stat()")])
        await page.evaluate("() => AGMapaVektor.nastav({ styl: 'tisk' })")
        await T.cekej(page, "AGMapaVektor.mapa().getStyle().name.endsWith('tisk')", 20)
        ok('C5 prepnuti stylu (tisk) parcely zachova (style.load → setData)', await T.cekej(page, "AGMapaVektor.mapa().querySourceFeatures('parcely').length >= 2 && AGMapaVektor.mapa().queryRenderedFeatures({ layers: ['parcely-hranice'] }).length > 0", 20), await page.evaluate("() => [AGMapaVektor.mapa().getStyle().name, AGMapaVektor.mapa().querySourceFeatures('parcely').length]"))
        await page.evaluate("() => AGMapaVektor.nastav({ styl: 'auto' })")
        await page.evaluate("() => agMapSetBase('ortofoto')")
        ok('C6 Ortofoto → parcely neaktivni a WMS katastr zpet na mape', await T.cekej(page, "!AGMapaParcely.aktivni() && map.hasLayer(katastrLayer)", 20), await page.evaluate("() => [AGMapaParcely.aktivni(), map.hasLayer(katastrLayer)]"))
        await page.evaluate("() => agMapSetBase('osm')")
        ok('C7 zpet na Mapu → WMS zase pryc, parcely aktivni', await T.cekej(page, "AGMapaParcely.aktivni() && !map.hasLayer(katastrLayer)", 20), await page.evaluate("() => [AGMapaParcely.aktivni(), map.hasLayer(katastrLayer)]"))
        await page.evaluate("() => map.setView([%f, %f], 14, { animate: false })" % (LAT, LNG))
        await page.wait_for_timeout(800)
        n2 = ruian['dotazy']
        await page.evaluate("() => map.setView([%f, %f], 14.5, { animate: false })" % (LAT + 0.01, LNG + 0.01))
        await page.wait_for_timeout(1000)
        ok('C8 pod z16 se nic nestahuje', ruian['dotazy'] == n2, ruian)
        await page.evaluate("() => map.setView([%f, %f], 17, { animate: false })" % (LAT, LNG))
        await page.wait_for_timeout(800)

        # ================= D: kalibrace po hrane ===================================
        await page.evaluate("() => AGLazyTools.open('kalibrace-hranou')")
        ok('D0 modul kalibrace po hrane', await T.cekej(page, "window.AGHrana && AGHrana._test && AGHrana._test.snapParcelyMapy", 30))
        m_lng = 1 / (111320 * 0.6428)
        d = await page.evaluate("() => { var s = AGHrana._test.snapParcelyMapy({ lat: %f, lng: %f }); return s ? [s.d, s.lng, s.zdroj] : null; }" % (LAT, LNG + 2 * m_lng))
        ok('D1 klepnuti 2 m od spolecne hrany parcel → prichyceni na hranu (bez site)', d and 1.5 < d[0] < 2.5 and abs(d[1] - LNG) < 1e-7, d)
        d2 = await page.evaluate("() => AGHrana._test.snapParcelyMapy({ lat: %f, lng: %f })" % (LAT, LNG + 10 * m_lng))
        ok('D2 10 m od hrany → nic', d2 is None, d2)
        # po setView z C8 (z14 → z17) se dlazdice teprve nacitaji — bez cekani D3 obcas nevidel zadny chodnik (23. 9. 2026)
        await T.cekej(page, "AGMapaVektor.cary('roads', ['path']).some(l => l.vlastnosti.kind_detail === 'sidewalk' && l.length >= 2)", 20)
        c = await page.evaluate("""() => { var ls = AGMapaVektor.cary('roads', ['path']).filter(l => l.vlastnosti.kind_detail === 'sidewalk' && l.length >= 2);
            if (!ls.length) return { chyba: 'zadny chodnik' };
            var l = ls[0], a = l[0], b = l[1], mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
            var t = { lat: mid.lat + 2 / 111320, lng: mid.lng };
            var s = AGHrana._test.snapChodnik(t);
            return { s: s, t: t, dl: Math.hypot((b.lng - a.lng) * 111320 * 0.6428, (b.lat - a.lat) * 111320) }; }""")
        ok('D3 klepnuti 2 m od chodniku z dlazdic → prichyceni (kd sidewalk, d ≤ 2 m)', c and c.get('s') and c['s']['kd'] == 'sidewalk' and c['s']['d'] <= 2.05, c)
        await page.evaluate("() => agMapSetBase('ortofoto')")
        await page.wait_for_timeout(500)
        c2 = await page.evaluate("() => AGHrana._test.snapChodnik({ lat: %f, lng: %f })" % (LAT, LNG))
        ok('D4 bez vektoru (Ortofoto) chodnik nechyta', c2 is None, c2)
        await page.evaluate("() => agMapSetBase('osm')")
        await page.wait_for_timeout(500)
        await page.evaluate("() => toggleKatastr()")
        ok('C9 Katastr vypnout → zdroj parcely prazdny, neaktivni', await T.cekej(page, "!AGMapaParcely.aktivni() && AGMapaVektor.mapa().querySourceFeatures('parcely').length === 0 && AGMapaVektor.mapa().queryRenderedFeatures({ layers: ['parcely-hranice'] }).length === 0", 20), await page.evaluate("() => [AGMapaParcely.aktivni(), AGMapaVektor.mapa().querySourceFeatures('parcely').length]"))

        ok('E8 bez chyb stranky', not chyby, chyby[:5])
        await ctx.close()
        await br.close()


def main():
    staticke()
    srv, url = T.server(PORT)
    if not srv:
        ok('server', False, 'test_server nenastartoval')
    else:
        try:
            asyncio.run(beh(url))
        finally:
            srv.terminate()
    n = sum(1 for _, p, _ in vysledky if p)
    print('\n%d/%d OK' % (n, len(vysledky)))
    for j, p, d in vysledky:
        if not p:
            print('  CHYBA', j, str(d)[:300])
    sys.exit(0 if n == len(vysledky) else 1)


if __name__ == '__main__':
    main()
