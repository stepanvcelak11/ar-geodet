# -*- coding: utf-8 -*-
"""HLASENI 17. 9. 2026 (v347): navigace zdmi, tihovy bod, vrstva Kde se da merit, prekazky,
3D prace s body, chodniky a vysky ve 3D, paska AR, pruh nahore, mistopisny nacrt, simulace zeme.

  A  TIHOVY BOD: bod stazeny starsi verzi (cat PBPP) dostane po novem stazeni (vrstva 48) cat TIHA
     (kolecko → sestiuhelnik, nadpis karty „Tíhový bod"); migrace i bez rawData
  B  PRUH NAHORE: #ag-safe-top je skutecny prvek, previewMode mu pise barvu inline (svetly/tmavy)
  C  KDE SE DA MERIT: po vypoctu je v mape pilulka „Skrýt", klepnuti vrstvu schova i pilulku
  D  TRASA: data z dlazdic (zdroj 'dlaždice', nezavisle na vyrezu — mapa oddalena na z13), lomy na
     ose cesty; cil uvnitr budovy → trasa konci u nejblizsiho mista (nedosazitelne); start uvnitr
     budovy → nejdriv k vychodu (vychod.jak), prvni lom = vychod; paska: ryska = cil, tecka = lom
  E  PREKAZKY: druhy (DRUHY), vyber druhu pred kreslenim (#ag-prekazka-vyber), popisek v mape
     (.ag-prek-tip), prejmenovani, prekazka na ceste cestu zavre (trasa ji obejde)
  F  3D: vrstvy chodniky-3d / zelen-les / sloupky-3d / trasa-cara, projekce globe, svetly motiv =
     varianta den bez chyb, chodniky z dat (features > 0), sloupek bodu z DMR (mock 248 m → +2,3 m),
     karta bodu po klepnuti + Navigovat = highlightedPointId + trasa v 3D, Karta bodu otevre kartu
  G  MISTOPISNY NACRT: nastroj v MANIFESTu, otevre se k bodu, Vzdalenost dvema klepnutimi = kota
     (~ spravna delka, prichyceni k bodu), objekt strom, cara plot, text, podklad papir/mapa/orto,
     ulozeni per bod (agNacrty), PNG export (blob > 10 kB), Zpet, Smazat
  H  SIMULACE ZEME: AGZemeSimulace('DE') → zeme DE, rucni poloha v Berline, ukonceni = zpet

Spusteni: python scripts/test_v347.py [port]
"""
import os
import sys
import json
import asyncio
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_mapa_vektor as T  # noqa: E402  (server, stranka, cekej, INIT, LAT/LNG)

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9250)
vysledky = []
LAT, LNG = T.LAT, T.LNG


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


async def beh(url):
    from playwright.async_api import async_playwright
    fixture = url.replace('/index.html', '/tests/fixtures/mapa-praha.pmtiles')
    async with async_playwright() as pw:
        br = await pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        chyby = []
        # stary tihovy bod ulozeny jako PBPP (bez rawData) + vlastni bod
        stary = [{'id': 'p_50.075900_14.438200', 'name': '12', 'lat': 50.0759, 'lng': 14.4382, 'type': 'polohovy', 'cat': 'PBPP', 'hidden': False, 'currentDist': 0}]
        init = (T.INIT + "localStorage.setItem('agMapaVektor_v1', JSON.stringify({zap:true, url:%s})); localStorage.setItem('agPohled3d_v1', JSON.stringify({teren:false}));"
                "localStorage.setItem('default_arOfflinePoints12', %s);" % (json.dumps(fixture), json.dumps(json.dumps(stary))))
        ctx, page = await T.stranka(br, url, init, chyby)
        # CUZK identify → jeden tihovy bod (vrstva 48) na miste stareho PBPP
        cuzk = {'results': [{'layerId': 48, 'layerName': 'Tihove body', 'attributes': {'CISLO': '12', 'NAZEV_BODU': 'Kostel sv. Jakuba', 'VYSKA': '251.2', 'NAZEV_KU': 'Praha', 'NAZEV_OKRES': 'Praha'}, 'geometry': {'x': 14.4382, 'y': 50.0759}}]}

        async def route_cuzk(route, request):
            try:
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(cuzk), headers={'Access-Control-Allow-Origin': '*'})
            except Exception:
                pass
        await page.route('**/BodovaPole/MapServer/identify**', route_cuzk)
        ok('0 appka nastartovala', await T.cekej(page, "document.body.classList.contains('app-started')"))
        ok('0b vektorova mapa zapnuta (fixture)', await T.cekej(page, "window.AGMapaVektor && AGMapaVektor.stav() === 'zapnuto' && AGMapaVektor.mapa() && AGMapaVektor.mapa().isStyleLoaded()", 60), await page.evaluate("() => window.AGMapaVektor && [AGMapaVektor.stav(), AGMapaVektor.chyba()]"))

        # ================= A: tihovy bod ==================================================
        a0 = await page.evaluate("() => { var p = arPoints.find(x => x.name === '12'); return p && { cat: p.cat, druh: p.druh }; }")
        a1 = await page.evaluate("async () => { await fetchGeodata(%f, %f, 300); var p = arPoints.find(x => x.name === '12'); return p && { cat: p.cat, type: p.type, druh: p.druh, nazev: p.nazevBodu }; }" % (LAT, LNG))
        ok('A1 stary bod PBPP → po stazeni vrstvy 48 cat TIHA (druh Tíhový bod, jmeno)', a1 and a1['cat'] == 'TIHA' and a1['type'] == 'tihovy' and 'hov' in (a1['druh'] or '') and a1['nazev'] == 'Kostel sv. Jakuba', [a0, a1])
        a2 = await page.evaluate("() => { var p = arPoints.find(x => x.name === '12'); drawAllMarkersOnMap(); var n = 0; document.querySelectorAll('#map .custom-map-marker svg polygon').forEach(pg => { if (pg.getAttribute('points').indexOf('12,2 21,7') === 0) n++; }); showDetails(p, 10); return { hex: n, sub: document.getElementById('det-subtitle').textContent, title: document.getElementById('det-title') && document.getElementById('det-title').textContent }; }")
        ok('A2 v mape sestiuhelnik, karta ma v hlavicce Tíhový bod', a2 and a2['hex'] >= 1 and 'hov' in a2['sub'], a2)
        await page.evaluate("() => { try { closeBottomSheet(); } catch (e) {} }")

        # ================= B: pruh nahore ===================================================
        b = await page.evaluate("() => { var st = document.getElementById('ag-safe-top'); previewMode('light'); var l = st.style.background; previewMode('dark'); var d = st.style.background; return { je: !!st, uvnitr: !!(st && st.closest('#settings-modal .modal-content')), l: l, d: d, cs: getComputedStyle(document.querySelector('#settings-modal .modal-content'), '::before').content }; }")
        ok('B1 #ag-safe-top existuje v Nastaveni, previewMode pise barvu inline (svetla → tmava)', b and b['je'] and b['uvnitr'] and 'rgb(247, 248, 250)' in b['l'] and 'rgb(14, 18, 24)' in b['d'] and b['cs'] in ('none', 'normal'), b)

        # ================= C: kde se da merit — pilulka skryt ===============================
        await page.evaluate("() => AGLazyTools.load('js/mapa-kvality-gps.js')")
        ok('C0 modul nacteny', await T.cekej(page, "window.AGKvalitaGpsMapa", 30))
        await page.evaluate("() => { map.setView([%f, %f], 17, { animate: false }); }" % (LAT, LNG))
        await T.cekej(page, "AGMapaVektor.budovy().length > 50", 60)
        c1 = await page.evaluate("() => { AGKvalitaGpsMapa.spocitej({ lat: %f, lng: %f }); AGKvalitaGpsMapa.prepni(true); var p = document.getElementById('ag-kvgps-pill'); return { pill: !!p, txt: p && p.textContent, overlay: !!document.querySelector('.ag-kvgps-overlay') }; }" % (LAT, LNG))
        ok('C1 po vypoctu je v mape pilulka „Kde se dá měřit · Skrýt" a vrstva', c1 and c1['pill'] and 'Skrýt' in c1['txt'] and c1['overlay'], c1)
        c2 = await page.evaluate("() => { document.getElementById('ag-kvgps-pill').click(); return { pill: !!document.getElementById('ag-kvgps-pill'), overlay: !!document.querySelector('.ag-kvgps-overlay'), radek: !document.getElementById('ms-kvgps').classList.contains('ctrl-active') }; }")
        ok('C2 klepnuti na pilulku schova vrstvu i pilulku, radek ve Vrstvach neaktivni', c2 and not c2['pill'] and not c2['overlay'] and c2['radek'], c2)

        # ================= D: trasa z dlazdic, osa cesty, vychod, nedosazitelne ==============
        ok('D0 moduly trasy a dat', await T.cekej(page, "window.AGTrasa && window.AGMapaData && window.AGOkoli && window.AGHrany", 30))
        await page.evaluate("() => { map.setView([%f, %f], 13, { animate: false }); }" % (LAT, LNG))   # oddalena mapa = vyrez bez budov
        await page.wait_for_timeout(800)
        d1 = await page.evaluate("""async () => { var me = { lat: %f, lng: %f }; var c = { lat: me.lat + 0.0012, lng: me.lng + 0.0015 };
            var d = await AGMapaData.oblast({ s: me.lat - 0.001, w: me.lng - 0.002, n: c.lat + 0.001, e: c.lng + 0.002 });
            var p = { id: 'cil-d', name: 'CilD', lat: c.lat, lng: c.lng, type: 'custom', cat: 'CUSTOM', hidden: false }; arPoints.push(p); highlightedPointId = 'cil-d';
            var t = AGTrasa.prepocitej('test'); var r = AGTrasa.rastr(me, c);
            var naOse = 0, lomu = 0; if (t) t.body.slice(1, -1).forEach(q => { lomu++; var best = 1e9; r.osy.forEach(o => { for (var j = 0; j + 1 < o.l.length; j++) { var pr = AGHrany.prumet(o.l[j], o.l[j + 1], q); if (pr && pr.d < best) best = pr.d; } }); if (best < 0.6) naOse++; });
            var vyrezBudov = AGMapaVektor.budovy().length;
            return { budov: d.buildings.length, roads: d.roads.length, zdroj: t && t.zdroj, lomu: lomu, naOse: naOse, bunka: t && t.bunka, ms: t && t.ms, delka: t && t.delka, vyrezBudov: vyrezBudov, nedos: t && t.nedosazitelne }; }""" % (LAT, LNG))
        ok('D1 mapa oddalena (vyrez bez budov), trasa presto z DLAZDIC (budovy > 1000), mrizka 1 m, < 2 s', d1 and d1['zdroj'] == 'dlaždice' and d1['budov'] > 1000 and d1['bunka'] == 1 and d1['ms'] < 2000 and d1['lomu'] >= 2, d1)
        ok('D2 vetsina lomu lezi na ose cesty (do 0,6 m)', d1 and d1['lomu'] and d1['naOse'] >= d1['lomu'] * 0.5, d1)
        d3 = await page.evaluate("""() => { var me = { lat: %f, lng: %f }; var b = AGHrany.budovyPolygony(me.lat, me.lng, 150).map(x => { var r = x.rings[0]; var cx = 0, cy = 0; r.forEach(q => { cx += q.lng; cy += q.lat; }); return { lat: cy / r.length, lng: cx / r.length, ring: r }; }).filter(x => AGOkoli.vyhodnot(x.lat, x.lng).uvnitr)[0];
            if (!b) return { zadna: true };
            var p = { id: 'cil-in', name: 'VBudove', lat: b.lat, lng: b.lng, type: 'custom', cat: 'CUSTOM', hidden: false }; arPoints.push(p); highlightedPointId = 'cil-in';
            var t = AGTrasa.prepocitej('test'); return { t: !!t, nedos: t && t.nedosazitelne, lomu: t && t.body.length, popup: t && t.body.length > 1, konecUvnitr: t && AGOkoli.vyhodnot(t.body[t.body.length - 1].lat, t.body[t.body.length - 1].lng).uvnitr, predUvnitr: t && AGOkoli.vyhodnot(t.body[t.body.length - 2].lat, t.body[t.body.length - 2].lng).uvnitr }; }""" % (LAT, LNG))
        await page.evaluate("() => { map.setView([%f, %f], 17, { animate: false }); }" % (LAT, LNG))
        await T.cekej(page, "AGMapaVektor.budovy().length > 50", 30)
        d3 = await page.evaluate("""() => { var me = { lat: %f, lng: %f }; var b = AGHrany.budovyPolygony(me.lat, me.lng, 150).map(x => { var r = x.rings[0]; var cx = 0, cy = 0; r.forEach(q => { cx += q.lng; cy += q.lat; }); return { lat: cy / r.length, lng: cx / r.length }; }).filter(x => AGOkoli.vyhodnot(x.lat, x.lng).uvnitr)[0];
            if (!b) return { zadna: true };
            var p = { id: 'cil-in', name: 'VBudove', lat: b.lat, lng: b.lng, type: 'custom', cat: 'CUSTOM', hidden: false }; arPoints.push(p); highlightedPointId = 'cil-in';
            var t = AGTrasa.prepocitej('test'); return { t: !!t, nedos: t && t.nedosazitelne, lomu: t && t.body.length, konecUvnitr: t && !!AGOkoli.vyhodnot(t.body[t.body.length - 1].lat, t.body[t.body.length - 1].lng).uvnitr, predUvnitr: t && !!AGOkoli.vyhodnot(t.body[t.body.length - 2].lat, t.body[t.body.length - 2].lng).uvnitr }; }""" % (LAT, LNG))
        ok('D3 cil uprostred budovy: trasa existuje, nedosazitelne, konci u budovy (predposledni lom venku, posledni = cil uvnitr)', d3 and d3['t'] and d3['nedos'] and d3['konecUvnitr'] and not d3['predUvnitr'], d3)
        d4 = await page.evaluate("""() => { var me = arPoints.find(x => x.id === 'cil-in'); var c = { lat: %f, lng: %f };
            var r = AGTrasa.rastr(me, c); var t = AGTrasa.spocitej(me, { id: 'x', name: 'x', lat: c.lat, lng: c.lng });
            return { t: !!t, vychod: t && t.vychod && { jak: t.vychod.jak, d: t.vychod.d }, prvniLomVenku: t && !AGOkoli.vyhodnot(t.body[1].lat, t.body[1].lng).uvnitr, prvniLomJeVychod: t && t.vychod && t.body[1].lat === t.vychod.bod.lat, zdroj: t && t.zdroj, budov: r.budovy.length }; }""" % (LAT, LNG))
        ok('D4 start uvnitr budovy: trasa nejdriv k VYCHODU (odhad strana k ulici), prvni lom = vychod, venku', d4 and d4['t'] and d4['vychod'] and d4['vychod']['jak'] in ('ulice', 'vchod') and d4['prvniLomJeVychod'] and d4['prvniLomVenku'], d4)
        # paska: ryska = cil (primy smer), tecka = dalsi lom
        await page.evaluate("() => { viewMode = 'both'; try { applyViewMode(); } catch (e) {} highlightedPointId = 'cil-d'; AGTrasa.prepocitej('test'); try { updateNavGlow && updateNavGlow(true); } catch (e) {} }")
        await page.wait_for_timeout(600)
        d5 = await page.evaluate("""() => { var el = document.querySelector('.ag-cil-paska'); if (!el) return { paska: false, cil: highlightedPointId, hd: typeof currentHeading, started: document.body.classList.contains('app-started') };
            var lom = el.querySelector('.ag-cil-lom'), zn = el.querySelector('.ag-cil-znak'); var smer = AGTrasa.smer(); var me = { lat: userLat, lng: userLng }, c = arPoints.find(x => x.id === 'cil-d'); var primy = GeoCore.getBearing(me.lat, me.lng, c.lat, c.lng);
            return { paska: true, on: el.classList.contains('on'), lom: !!lom, lomZobrazen: lom && lom.style.display, smer: smer, primy: primy, znakTx: zn.style.transform, lomTx: lom && lom.style.transform, hd: currentHeading }; }""")
        ok('D5 paska: tecka dalsiho lomu existuje a je zobrazena, kdyz se lom lisi od primeho smeru', d5 and d5['paska'] and d5['lom'] and (d5['lomZobrazen'] == 'block' or abs(((d5['smer'] - d5['primy'] + 540) % 360) - 180) < 3), d5)
        await page.evaluate("() => { viewMode = 'map'; try { applyViewMode(); } catch (e) {} highlightedPointId = null; ['cil-d', 'cil-in'].forEach(id => { var i = arPoints.findIndex(x => x.id === id); if (i >= 0) arPoints.splice(i, 1); }); }")

        # ================= E: prekazky =======================================================
        e1 = await page.evaluate("""() => { var m = 1 / 111320; var q = { lat: %f + 60 * m, lng: %f };
            AGOkoli.pridejPrekazku({ lat: q.lat - 3 * m, lng: q.lng - 4 * m }, { lat: q.lat + 3 * m, lng: q.lng + 4 * m }, 'Jáma u vjezdu', 'vykop');
            var tips = [].slice.call(document.querySelectorAll('#map .ag-prek-tip')).map(t => t.textContent);
            var druhy = Object.keys(AGOkoli.DRUHY); AGOkoli.vyberDruh(); var box = document.getElementById('ag-prekazka-vyber'); var btns = box ? box.querySelectorAll('button[data-d]').length : 0;
            box.querySelector('button[data-d="stroj"]').click(); var armed = AGOkoli.armed, boxPryc = !document.getElementById('ag-prekazka-vyber');
            AGOkoli.take(q.lat + 10 * m, q.lng); AGOkoli.take(q.lat + 14 * m, q.lng + 6 * m);
            var posl = AGOkoli.prekazky()[AGOkoli.prekazky().length - 1];
            return { druhy: druhy.length, tips: tips, btns: btns, armed: armed, boxPryc: boxPryc, posl: posl && { nazev: posl.nazev, druh: posl.druh }, n: AGOkoli.prekazky().length }; }""" % (LAT, LNG))
        ok('E1 druhy prekazek (7), popisek v mape „V Jáma u vjezdu", vyber druhu → Stroj → dve klepnuti = prekazka druhu stroj', e1 and e1['druhy'] == 7 and any('Jáma u vjezdu' in t for t in e1['tips']) and e1['btns'] == 8 and e1['armed'] and e1['boxPryc'] and e1['posl'] and e1['posl']['druh'] == 'stroj' and e1['posl']['nazev'] == 'Stroj / bagr', e1)
        e2 = await page.evaluate("() => { window.agPrompt = (o) => Promise.resolve('Bagr Petra'); return new Promise(res => { AGOkoli.prejmenuj(AGOkoli.prekazky().length - 1); setTimeout(() => { var p = AGOkoli.prekazky()[AGOkoli.prekazky().length - 1]; var tips = [].slice.call(document.querySelectorAll('#map .ag-prek-tip')).map(t => t.textContent); res({ nazev: p.nazev, tip: tips.some(t => t.indexOf('Bagr Petra') >= 0) }); }, 100); }); }")
        ok('E2 prejmenovani prekazky se propise do popisku v mape', e2 and e2['nazev'] == 'Bagr Petra' and e2['tip'], e2)
        await page.evaluate("() => { while (AGOkoli.prekazky().length) AGOkoli.smazPrekazku(0); }")

        # ================= F: 3D ==============================================================
        await page.evaluate("() => { previewMode('light'); window.terrainElevAsync = (lat, lng) => Promise.resolve(248.0); }")
        await page.evaluate("() => AGLazyTools.load('js/pohled-3d.js')")
        ok('F0 modul 3D nacteny', await T.cekej(page, "window.AGPohled3d && AGPohled3d.karta", 30))
        await page.evaluate("() => { arPoints.push({ id: 'vys1', name: 'NIV', lat: %f + 0.0002, lng: %f, type: 'vyskovy', cat: 'NIVEL', hidden: false, vyska: 250.3 }); window.agOpenPohled3d(); }" % (LAT, LNG))
        ok('F1 3D okno bezi ve svetlem motivu', await T.cekej(page, "document.getElementById('ag3d') && AGPohled3d.mapa() && AGPohled3d.mapa().isStyleLoaded && AGPohled3d.mapa().isStyleLoaded()", 60))
        await page.wait_for_timeout(2500)
        f2 = await page.evaluate("""() => { var m = AGPohled3d.mapa(); var st = m.getStyle(); var ids = st.layers.map(l => l.id);
            return { varianta: AGMapaVektor.varianta(), bg: st.layers[0].paint['background-color'], proj: st.projection && st.projection.type, ids: ['chodniky-3d', 'zelen-les', 'zelen-krovi', 'sloupky-3d', 'trasa-cara', 'body-kruh', 'budovy-3d'].filter(i => ids.indexOf(i) < 0),
                chod: AGPohled3d.chodnikyGeo().features.length, chodZdroj: m.getSource('chodniky') && m.getSource('chodniky').serialize().data.features.length, sloupky: AGPohled3d.sloupkyGeo().features.map(f => [f.properties.name, f.properties.popis]), btns: ['ag3d-zelen', 'ag3d-chodniky'].every(i => document.getElementById(i)) }; }""")
        ok('F2 svetly motiv = varianta den (svetle pozadi), projekce globe, vsechny nove vrstvy, chodniky z dat > 100, sloupek NIV +2,3 m', f2 and f2['varianta'] == 'den' and f2['bg'] == '#f1f2ee' and f2['proj'] == 'globe' and not f2['ids'] and f2['chod'] > 100 and f2['chodZdroj'] > 100 and ['NIV', '+2,3 m'] in f2['sloupky'] and f2['btns'], f2)
        f3 = await page.evaluate("""() => { var p = arPoints.find(x => x.id === 'vys1'); AGPohled3d.karta(p); var k = document.getElementById('ag3d-karta'); var info = document.getElementById('ag3d-k-info').textContent; document.getElementById('ag3d-k-nav').click();
            return { hidden: k.hidden, jmeno: document.getElementById('ag3d-k-jmeno').textContent, info: info, cil: highlightedPointId, nav: document.getElementById('ag3d-k-nav').textContent, trasa: AGPohled3d.trasaGeo().features.length, cilVeStylu: AGPohled3d.mapa().getSource('body').serialize().data.features.some(f => f.properties.cil === 1) }; }""")
        ok('F3 klepnuti na bod = karta (jmeno, H, nad terenem, vzdalenost), Navigovat = highlightedPointId + trasa v 3D + zvyrazneny cil', f3 and not f3['hidden'] and f3['jmeno'] == 'NIV' and '2,3 m nad terénem' in f3['info'] and 'ode mě' in f3['info'] and f3['cil'] == 'vys1' and 'Zrušit' in f3['nav'] and f3['trasa'] >= 1 and f3['cilVeStylu'], f3)
        f4 = await page.evaluate("() => { document.getElementById('ag3d-k-karta').click(); return { zavreno: document.getElementById('ag3d').style.display === 'none', karta: document.getElementById('bottom-sheet').classList.contains('open'), titul: document.getElementById('det-title') && document.getElementById('det-title').textContent, cil: highlightedPointId }; }")
        ok('F4 „Karta bodu" zavre 3D a otevre kartu bodu appky; navigace bezi dal (split)', f4 and f4['zavreno'] and f4['karta'] and f4['cil'] == 'vys1', f4)
        await page.evaluate("() => { try { closeBottomSheet(); } catch (e) {} highlightedPointId = null; previewMode('dark'); }")
        chyby3d = [c for c in chyby if 'pohled-3d' in c or 'maplibre' in c.lower() and 'Failed to load' not in c]
        ok('F5 zadna chyba stranky z 3D', not [c for c in chyby if c.startswith('pageerror')], [c for c in chyby if c.startswith('pageerror')][:3] or chyby3d[:3])

        # ================= G: mistopisny nacrt ================================================
        ok('G0 nastroj v MANIFESTu + registru', await page.evaluate("() => !!(AGLazyTools.manifest.some(t => t.id === 'mistopisny-nacrt') && window.AGReg)"))
        await page.evaluate("() => AGLazyTools.load('js/mistopisny-nacrt.js')")
        ok('G1 modul nacteny', await T.cekej(page, "window.AGNacrt && AGNacrt.otevri", 30))
        g2 = await page.evaluate("""async () => { var p = arPoints.find(x => x.id === 'vys1'); AGNacrt.otevri(p); await new Promise(r => setTimeout(r, 2500));
            var m = AGNacrt.mapa(); var k = 1 / 111320, kl = k / Math.cos(p.lat * Math.PI / 180);
            AGNacrt.rezim('vzdalenost'); AGNacrt.klik(L.latLng(p.lat + 0.00000004, p.lng)); AGNacrt.klik(L.latLng(p.lat, p.lng + 12.0 * kl));
            AGNacrt.rezim('objekt'); AGNacrt.klik(L.latLng(p.lat + 5 * k, p.lng + 5 * kl));
            AGNacrt.rezim('cara'); AGNacrt.klik(L.latLng(p.lat - 5 * k, p.lng)); AGNacrt.klik(L.latLng(p.lat - 5 * k, p.lng + 8 * kl)); document.getElementById('agn-hotovo').click();
            window.agPrompt = (o) => Promise.resolve('roh garáže'); AGNacrt.rezim('text'); AGNacrt.klik(L.latLng(p.lat + 2 * k, p.lng - 3 * kl)); await new Promise(r => setTimeout(r, 100));
            var pr = AGNacrt.prvky(); var dim = pr.find(x => x.t === 'dim');
            var ulozeno = AGNacrt.data()[p.id]; var koty = [].slice.call(document.querySelectorAll('#agn .agn-kota')).map(e => e.textContent);
            return { otevreno: document.getElementById('agn').style.display === 'block', mapa: !!m, typy: pr.map(x => x.t), dimA: dim && dim.a.lat === p.lat && dim.a.lng === p.lng, delka: dim && GeoCore.getDistance(dim.a.lat, dim.a.lng, dim.b.lat, dim.b.lng), koty: koty, ulozeno: ulozeno && ulozeno.prvky.length, obrysy: document.querySelectorAll('#agn-mapa path').length, info: document.getElementById('agn-info').textContent }; }""")
        ok('G2 nacrt: otevren k bodu, kota prichycena k bodu (12,0 m), objekt, cara plot, text; ulozeno k bodu; obrysy z mapy', g2 and g2['otevreno'] and g2['mapa'] and g2['typy'] == ['dim', 'obj', 'cara', 'text'] and g2['dimA'] and abs(g2['delka'] - 12.0) < 0.05 and any('12,0' in kk for kk in g2['koty']) and g2['ulozeno'] == 4 and g2['obrysy'] > 20, g2)
        g3 = await page.evaluate("""async () => { window.agPrompt = (o) => Promise.resolve('11,85'); var m = AGNacrt.mapa(); AGNacrt.rezim('vyber'); var pl = null; m.eachLayer(l => { if (l instanceof L.Polyline && !(l instanceof L.Polygon) && l.options.color === '#1a237e') pl = l; }); pl.fire('click', { latlng: pl.getLatLngs()[0], originalEvent: new Event('click') }); await new Promise(r => setTimeout(r, 150));
            var dim = AGNacrt.prvky().find(x => x.t === 'dim'); var koty = [].slice.call(document.querySelectorAll('#agn .agn-kota.pasmo')).map(e => e.textContent);
            AGNacrt.podklad('orto'); var orto = document.querySelectorAll('#agn-mapa .leaflet-tile-pane img, #agn-mapa .leaflet-tile').length >= 0 && !document.getElementById('agn').classList.contains('papir'); AGNacrt.podklad('mapa'); AGNacrt.podklad('papir'); var papir = document.getElementById('agn').classList.contains('papir');
            var blob = null; window.agShareOrDownload = (b, n) => { blob = { size: b.size, name: n }; return Promise.resolve('download'); }; AGNacrt.exportPng(); await new Promise(r => setTimeout(r, 1500));
            document.querySelector('#agn [data-rezim="smazat"]').click(); var mk = null; m.eachLayer(l => { if (l instanceof L.Marker && l.options.icon && l.options.icon.options.className === 'agn-obj') mk = l; }); mk.fire('click', { originalEvent: new Event('click') });
            var poSmazani = AGNacrt.prvky().length; document.getElementById('agn-zpet').click(); var poZpet = AGNacrt.prvky().length;
            return { pasmo: dim && dim.v, koty: koty, orto: orto, papir: papir, blob: blob, poSmazani: poSmazani, poZpet: poZpet, ulozeno: AGNacrt.data()['vys1'].podklad }; }""")
        ok('G3 kota z pasma 11,85 (tucne), podklady orto/mapa/papir, PNG export (blob > 10 kB), Smazat objekt, Zpet', g3 and g3['pasmo'] == 11.85 and any('11,85' in kk for kk in g3['koty']) and g3['orto'] and g3['papir'] and g3['blob'] and g3['blob']['size'] > 10000 and g3['blob']['name'].endswith('.png') and g3['poSmazani'] == 3 and g3['poZpet'] == 4 and g3['ulozeno'] == 'papir', g3)
        await page.evaluate("() => AGNacrt.zavri()")

        # ================= H: simulace zeme ===================================================
        ok('H0 modul zeme-svet nacteny', await T.cekej(page, "window.AGZemeSimulace && window.AGManualPos && window.AGSour", 30))
        h1 = await page.evaluate("() => { AGZemeSimulace('DE'); return { kod: AGSour.kod(), rezim: AGSour.rezim(), man: AGManualPos.active, lat: AGManualPos.lat, lng: AGManualPos.lng, sys: AGSour.popisky().system }; }")
        ok('H1 simulace DE: zeme DE, rucni poloha v Berline, souradnice UTM', h1 and h1['kod'] == 'DE' and h1['man'] and abs(h1['lat'] - 52.52) < 0.01 and abs(h1['lng'] - 13.405) < 0.01 and 'UTM' in (h1['sys'] or ''), h1)
        h2 = await page.evaluate("() => { AGZemeSimulace('DE'); return { rezim: AGSour.rezim(), man: AGManualPos.active }; }")
        ok('H2 druhe klepnuti = konec simulace (auto, GPS)', h2 and h2['rezim'] == 'auto' and not h2['man'], h2)

        pe = [c for c in chyby if c.startswith('pageerror')]
        ok('Z zadna chyba stranky za cely beh', not pe, pe[:4])
        await br.close()


def main():
    srv, url = T.server(PORT)
    if not srv:
        print('CHYBA server se nespustil'); return 1
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
