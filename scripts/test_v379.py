# -*- coding: utf-8 -*-
u"""Regrese k v379 (19. 9. 2026 odp.) — čtvrté kolo hodnocení, dávka 2: E3 + E4 + E5.

  E3  Úřední body Francie (IGN Géoplateforme WFS: site-rbf, point-rdf, rn) a Španělska (IGN España WMS
      GetFeatureInfo: RED_ROI, RED_REGENTE, RED_NAP) v js/body-svet.js — s podstrčenou odpovědí služby
      (tvar zachycený naostro 19. 9. 2026) simulace FR/ES vloží body do arPoints se správnou kategorií,
      výškou a odkazem na fiche/reseñu; texty o „čtyřech zemích" říkají šest.
  E4  Parcela klepnutím mimo ČR (js/zdroje-zemi.js AGZdroje.parcela: PL ULDK, FR apicarto, NL PDOK) —
      js/parcela-klik.js tap() v cizí zemi ukáže kartu s číslem, obcí, výměrou a zvýrazní hranici.
  E5  Výška terénu podle země (js/dmr-terrain.js): CZ DMR 5G, CH swisstopo, FR IGN altimétrie, jinde
      dlaždice Terrarium; window.terrainElevInfo() popisuje zdroj a UI (vyska-gps, parcela-klik) podle něj.

Spouští se z kořene repa (vlastní port 9379, vlastní server):
    python scripts/test_v379.py
"""
import io, os, re, sys, json, asyncio, struct, zlib
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as V
from ag_boot import boot
PORT = 9379
OKS = []


def ok(n, c, info=''):
    OKS.append(bool(c)); print(('OK    ' if c else 'CHYBA ') + n + ('' if c else '  -- %s' % (info,)))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def nacti(rel):
    return json.load(io.open(os.path.join(ROOT, rel), encoding='utf-8'))


# ---- podstrčené odpovědi (tvary zachycené 19. 9. 2026) ---------------------------------------
FR_RBF = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": "site-rbf.fid-1", "geometry": {"type": "Point", "coordinates": [2.4353677, 48.83947246]}, "properties": {"id": "7505601", "nom": "PARIS I", "types": "RBF", "etat": "Bon etat", "url": "https://geodesie.ign.fr/fiches/index.php?module=e&action=fichepdf&source=gp&sit_no=7505601"}}]}
FR_RDF = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": "point-rdf.fid-2", "geometry": {"type": "Point", "coordinates": [2.34201915, 48.84055603]}, "properties": {"id": "75056AM", "nom": "75056AM-01", "no": "a", "groupe_info": "PARIS AM", "reseau": "RDF", "etat": "Bon etat", "picto": "PT_RDF_GOOD", "url": "https://data.geopf.fr/annexes/geodesie/pt-rsgf-175343.pdf"}}]}
FR_RN = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": "rn.fid-3", "geometry": {"type": "Point", "coordinates": [2.350925, 48.854808]}, "properties": {"id": 495773, "nom": "P.C.L3 - 69", "etat": "BON ETAT", "picto": "PT_RN_GOOD", "altitude": "27.719", "insee": "75104", "e": 6523.7, "n": 68618.4, "lambda": 2.3509, "phi": 48.8548, "url": "https://fiches-geodesie.ign.fr/st-datageod.php/pt-nivf-495773.pdf"}}]}
ES_GFI = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "id": "RED_ROI.55956", "geometry": {"type": "Point", "coordinates": [-409192.78, 4929222.39]}, "properties": {"numero": 55956, "nombre": "Hospital de la Princesa", "municipio": "Madrid", "provincia": "Madrid", "hoja": "0559", "long_etrs89": -3.67584133361111, "lat_etrs89": 40.4340719488889, "alt_elip": 793.603, "x_etrs89": 442677.121, "y_etrs89": 4476156.046, "huso": 30, "alt_orto": 742.49, "resena": "https://datos-geodesia.ign.es/Red_Geodesica/Hoja0559/055956.pdf"}},
    {"type": "Feature", "id": "RED_NAP.847011", "geometry": {"type": "Point", "coordinates": [-414150.27, 4927156.03]}, "properties": {"numero": 847011, "nombre": "SP Glorieta de San Vicente S", "nombre_muni": "Madrid", "nombre_prov": "Madrid", "tipo": "Principal", "longitud_etrs89": -3.72037516666667, "latitud_etrs89": 40.4199415833333, "altitud_elipsoidal": 643.378, "ortometrica": 592.334753926172, "resena": "https://datos-geodesia.ign.es/REDNAP/Lin00847/847011.pdf", "linea": "Campamento - IGN - Atocha - Abrahantes"}}]}
PL_ULDK = "0\n146510_8.0502.1/3|mazowieckie|powiat Warszawa|Warszawa (miasto)|5-05-02|1/3|SRID=4326;POLYGON((21.0117 52.2290,21.0127 52.2290,21.0127 52.2304,21.0117 52.2304,21.0117 52.2290))\n"
FR_PARC = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": "parcelle.1", "geometry": {"type": "MultiPolygon", "coordinates": [[[[2.3515, 48.8560], [2.3530, 48.8560], [2.3530, 48.8572], [2.3515, 48.8572], [2.3515, 48.8560]]]]}, "properties": {"numero": "0003", "feuille": 1, "section": "AE", "code_dep": "75", "nom_com": "Paris", "code_com": "056", "idu": "75104000AE0003", "contenance": 15168, "code_insee": "75056"}}]}
NL_PARC = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": "perceel.x", "geometry": {"type": "Polygon", "coordinates": [[[4.9035, 52.3670], [4.9048, 52.3670], [4.9048, 52.3682], [4.9035, 52.3682], [4.9035, 52.3670]]]}, "properties": {"identificatieLokaalID": "11530358470000", "kadastraleGemeenteWaarde": "Amsterdam", "sectie": "P", "AKRKadastraleGemeenteCodeWaarde": "ASD12", "kadastraleGrootteWaarde": 14105.0, "perceelnummer": 3584}}]}


def png_terrarium(h):
    """1 dlaždice 256×256 PNG s konstantní výškou h (Terrarium: R*256+G+B/256-32768)."""
    v = int(round((h + 32768) * 256)); r = (v >> 16) & 255; g = (v >> 8) & 255; b = v & 255
    row = b'\x00' + bytes([r, g, b]) * 256
    raw = row * 256
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 256, 256, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


TER_PNG = png_terrarium(172.0)
CORS = {'Access-Control-Allow-Origin': '*'}


async def route(route_, request):
    u = request.url
    try:
        if 'data.geopf.fr/wfs' in u:
            d = FR_RN if 'IGNF_GEODESIE:rn' in u else (FR_RDF if 'point-rdf' in u else FR_RBF)
            return await route_.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps(d))
        if 'ign.es/wms-inspire' in u:
            return await route_.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps(ES_GFI))
        if 'uldk.gugik.gov.pl' in u:
            return await route_.fulfill(status=200, content_type='text/plain', headers=CORS, body=PL_ULDK)
        if 'apicarto.ign.fr' in u:
            return await route_.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps(FR_PARC))
        if 'service.pdok.nl/kadaster/kadastralekaart' in u:
            return await route_.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps(NL_PARC))
        if 'api3.geo.admin.ch/rest/services/height' in u:
            return await route_.fulfill(status=200, content_type='application/json', headers=CORS, body='{"height":"408.4"}')
        if 'data.geopf.fr/altimetrie' in u:
            return await route_.fulfill(status=200, content_type='application/json', headers=CORS, body='{"elevations": [34.83]}')
        if 'elevation-tiles-prod/terrarium' in u:
            return await route_.fulfill(status=200, content_type='image/png', headers=CORS, body=TER_PNG)
        if 'api3.geo.admin.ch' in u or 'pdok.nl' in u or 'open-meteo' in u or 'met.no' in u or 'rainviewer' in u or 'brightsky' in u:
            return await route_.abort()
    except Exception:
        pass
    await V.route_vse(route_, request)


def staticke():
    bs = src('js/body-svet.js')
    ok('E3 body-svet.js: FR (WFS IGN) a ES (WMS IGN España) v ZEME', "var ZEME = { CH: CH, NL: NL, FR: FR, ES: ES };" in bs and 'data.geopf.fr/wfs/ows' in bs and 'redes-geodesicas' in bs)
    ok('E3 body-svet.js: stahni() umí víc adres (FR = 3 vrstvy)', 'z.urls ? z.urls(lat, lng)' in bs and 'Promise.all(qs.map(jeden))' in bs)
    ok(u'E3 texty: šest zemí s úředními body', u'Francie a Španělsko' in src('js/zdroje-zemi.js') and u'Francie (IGN), Španělsko (IGN)' in src('js/grafika.js') and u'Francie a Španělsko' in src('js/zeme-svet.js'))
    core = nacti('data/jazyky.json'); n = len(core['poradi'])
    ok(u'E3 jádro: nové věty o šesti zemích přeložené', sum(1 for k in core['t'] if u'Francie a Španělsko' in k or u'Francie (IGN)' in k) == 3 and all(len(core['t'][k]) == n for k in core['t'] if u'Francie' in k))
    ok(u'E3 jádro: vzor „ještě N m" bere i mezery v čísle', any(r[0].startswith(u'^ještě ([') for r in core['re']))
    zz = src('js/zdroje-zemi.js')
    ok('E4 zdroje-zemi.js: PARCELY PL/FR/NL + AGZdroje.parcela/maParcelu', 'var PARCELY = {' in zz and 'uldk.gugik.gov.pl' in zz and 'apicarto.ign.fr' in zz and 'kadastralekaart/wfs' in zz and 'parcela: parcela, maParcelu: maParcelu' in zz)
    pk = src('js/parcela-klik.js')
    ok('E4 parcela-klik.js: tap() mimo ČR → tapCizi (AGZdroje.parcela), karta vykresliCizi', 'function tapCizi(' in pk and 'function vykresliCizi(' in pk and 'AGZdroje.maParcelu(kod)' in pk)
    dt = src('js/dmr-terrain.js')
    ok('E5 dmr-terrain.js: zdroje CZ/CH/FR/* + terrainElevInfo', "CZ: { zdroj: 'DMR 5G'" in dt and "CH: { zdroj: 'swissALTI3D'" in dt and "FR: { zdroj: 'RGE ALTI'" in dt and "'*': { zdroj: 'EU-DEM/SRTM'" in dt and 'window.terrainElevInfo = function' in dt)
    ok(u'E5 dmr-terrain.js: cache buňky mimo CZ nese kód země', "z === 'CZ' ? k : z + ':' + k" in dt)
    vg = src('js/vyska-gps.js')
    ok(u'E5 vyska-gps.js: popisek a σ podle terrainElevInfo, DMR poznámka jen v ČR', 'window.terrainElevInfo()' in vg and "info.zdroj === 'DMR 5G' ? T('Výška terénu DMR 5G')" in vg and "if (info.zdroj === 'DMR 5G') {" in vg)
    ok(u'E5 parcela-klik.js: řádek Terén podle zdroje', "radek('Terén (' + ti.zdroj + ')'" in pk)
    for l in core['poradi']:
        d = nacti('data/jazyky-%s.json' % l)['t']
        ok(u'E4/E5 rozšíření %s: nové klíče' % l, all(k in d for k in (u'Parcela', u'Zkopírovat číslo parcely', u'Výška terénu', u'Terén jen orientačně', u'Vzít výšku terénu')))


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        init = boot(tarif='pro') + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.removeItem('agDmrElev_v1'); localStorage.setItem('agZemeUvod_v1', JSON.stringify({FR: 1, ES: 1, PL: 1, NL: 1, CH: 1, AT: 1}));"
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': 48.8566, 'longitude': 2.3522, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        await ctx.add_init_script(init)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)))
        await page.route('**/*', route)
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        await V.cekej(page, "document.body.classList.contains('app-started')", 40)
        await page.wait_for_timeout(2500)
        await page.evaluate("() => new Promise(r => AGLazy.need('js/body-svet.js', () => AGLazy.need('js/zdroje-zemi.js', () => AGLazy.need('js/parcela-klik.js', () => AGLazy.need('js/dmr-terrain.js', r)))))")
        await page.wait_for_timeout(500)
        # E3 FR (poloha Paříž, země podle GPS)
        s1 = await page.evaluate("""async () => { AGSour.nastav('FR'); await new Promise(r => setTimeout(r, 400));
            var n = await AGBodySvet.obnov(true); var b = arPoints.filter(p => p.vrstva === 'FR');
            var byId = {}; b.forEach(p => byId[p.id] = p);
            return { kod: AGSour.kod(), n: n, celkem: b.length, kat: b.map(p => p.cat).sort(), rn: byId['fr_rn_495773'] && { vyska: byId['fr_rn_495773'].vyska, gu: byId['fr_rn_495773'].rawData.GEODETICKE_UDAJE, typ: byId['fr_rn_495773'].type, e: byId['fr_rn_495773'].rawData.E_L93 },
                rbf: byId['fr_rbf_7505601'] && byId['fr_rbf_7505601'].cat, rdf: byId['fr_rdf_75056AM'] && byId['fr_rdf_75056AM'].cat }; }""")
        ok(u'E3 FR: 3 body IGN (RBF→TB, RDF→ZHB, RN→NIVEL), výška RN, fiche, Lambert-93', s1 and s1['kod'] == 'FR' and s1['celkem'] == 3 and s1['kat'] == ['NIVEL', 'TB', 'ZHB'] and s1['rn'] and abs(s1['rn']['vyska'] - 27.719) < 0.001 and 'pt-nivf' in s1['rn']['gu'] and s1['rn']['typ'] == 'vyskovy' and s1['rn']['e'] and abs(s1['rn']['e'] - 652600) < 2000, s1)
        # E3 ES
        s2 = await page.evaluate("""async () => { for (var i = arPoints.length - 1; i >= 0; i--) if (arPoints[i].vrstva === 'FR') arPoints.splice(i, 1);
            AGSour.nastav('ES'); await new Promise(r => setTimeout(r, 400)); var n = await AGBodySvet.obnov(true);
            var b = arPoints.filter(p => p.vrstva === 'ES'); var byId = {}; b.forEach(p => byId[p.id] = p);
            return { kod: AGSour.kod(), n: n, celkem: b.length, roi: byId['es_roi_55956'] && { cat: byId['es_roi_55956'].cat, lat: byId['es_roi_55956'].lat, vyska: byId['es_roi_55956'].vyska, gu: byId['es_roi_55956'].rawData.GEODETICKE_UDAJE },
                nap: byId['es_nap_847011'] && { cat: byId['es_nap_847011'].cat, vyska: byId['es_nap_847011'].vyska, druh: byId['es_nap_847011'].druh } }; }""")
        ok(u'E3 ES: ROI→TB s ETRS89 polohou a alt_orto, NAP→NIVEL s ortometrickou výškou', s2 and s2['kod'] == 'ES' and s2['celkem'] == 2 and s2['roi'] and s2['roi']['cat'] == 'TB' and abs(s2['roi']['lat'] - 40.43407) < 0.0001 and abs(s2['roi']['vyska'] - 742.49) < 0.01 and 'Hoja0559' in s2['roi']['gu'] and s2['nap'] and s2['nap']['cat'] == 'NIVEL' and abs(s2['nap']['vyska'] - 592.335) < 0.001 and 'Principal' in s2['nap']['druh'], s2)
        # E4 parcely
        for kod, lat, lng, cislo, obec in (('PL', 52.2297, 21.0122, '1/3', 'Warszawa (miasto)'), ('FR', 48.8566, 2.3522, 'AE 0003', 'Paris'), ('NL', 52.3676, 4.9041, 'Amsterdam P 3584', 'Amsterdam')):
            s3 = await page.evaluate("""async (a) => { AGSour.nastav(a.kod); await new Promise(r => setTimeout(r, 300)); document.querySelectorAll('.ag-dlg-overlay').forEach(o => o.remove());
                var p = await AGZdroje.parcela(a.lat, a.lng); AGParcelaKlik.tap(a.lat, a.lng); await new Promise(r => setTimeout(r, 1200));
                var m = document.getElementById('ag-pcl-modal'); return { kod: AGSour.kod(), cislo: p && p.cislo, obec: p && p.obec, vymera: p && p.vymera, rings: p && p.rings.length, txt: m ? m.innerText.replace(/\\s+/g, ' ').slice(0, 300) : '', poly: document.querySelectorAll('.ag-pcl-poly').length }; }""", {'kod': kod, 'lat': lat, 'lng': lng})
            ok(u'E4 %s: parcela %s, %s, karta + hranice v mapě' % (kod, cislo, obec), s3 and s3['kod'] == kod and s3['cislo'] == cislo and s3['obec'] == obec and s3['rings'] >= 1 and cislo in s3['txt'] and s3['poly'] == 1, s3)
        s4 = await page.evaluate("() => { var t = document.getElementById('ag-pcl-modal').innerText; return t; }")
        ok(u'E4 NL karta: výměra 14 105 m² i z grafiky (blízko)', u'14 105 m²' in s4 and (u'z grafiky' in s4 or 'geometry' in s4), s4[:200])
        await page.evaluate("() => AGParcelaKlik.close()")
        # E5 výšky podle země
        s5 = await page.evaluate("""async () => { var out = {};
            for (const z of [['CH', 47.3769, 8.5417], ['FR', 48.8566, 2.3522], ['AT', 48.2082, 16.3738]]) { AGSour.nastav(z[0]); await new Promise(r => setTimeout(r, 300)); document.querySelectorAll('.ag-dlg-overlay').forEach(o => o.remove());
                var h = await window.terrainElevAsync(z[1], z[2]); var i = window.terrainElevInfo(); out[z[0]] = { h: h, zdroj: i.zdroj, sigma: i.sigma, system: i.system, presne: i.presne }; }
            return out; }""")
        ok(u'E5 CH: swissALTI3D 408,4 m LN02 (σ 0,5)', s5 and s5['CH'] and abs(s5['CH']['h'] - 408.4) < 0.01 and s5['CH']['zdroj'] == 'swissALTI3D' and s5['CH']['system'] == 'LN02' and s5['CH']['presne'], s5 and s5['CH'])
        ok(u'E5 FR: RGE ALTI 34,83 m NGF-IGN69', s5 and s5['FR'] and abs(s5['FR']['h'] - 34.83) < 0.01 and s5['FR']['zdroj'] == 'RGE ALTI', s5 and s5['FR'])
        ok(u'E5 AT: dlaždice Terrarium 172 m, jen orientačně (σ 5)', s5 and s5['AT'] and abs(s5['AT']['h'] - 172.0) < 0.2 and s5['AT']['sigma'] == 5 and not s5['AT']['presne'], s5 and s5['AT'])
        # E5 UI: Nový bod v Rakousku ukazuje „Výška terénu EU-DEM/SRTM" a poznámku „jen orientačně"
        s6 = await page.evaluate("""async () => { AGSour.nastav('AT'); await new Promise(r => setTimeout(r, 300)); document.querySelectorAll('.ag-dlg-overlay').forEach(o => o.remove());
            openNewPointModal(); await new Promise(r => setTimeout(r, 300));
            gpsAvgResult = { lat: 48.2082, lng: 16.3738, alt: 220.0, acc: 0.9, n: 5 }; try { AGVyskaGps && AGVyskaGps.check && AGVyskaGps.check(); } catch (e) {}
            var box = document.getElementById('ag-vz'); if (!box) return { box: false };
            await new Promise(r => setTimeout(r, 1500)); return { box: true, t: box.innerText.replace(/\\s+/g, ' ').slice(0, 400) }; }""")
        ok(u'E5 Nový bod v Rakousku: terén EU-DEM/SRTM, orientačně, bez „DMR 5G" a „Bpv"', s6 and s6.get('box') and 'EU-DEM' in s6['t'] and 'DMR 5G' not in s6['t'] and '(Bpv)' not in s6['t'], s6)
        ok('E3–E5 bez chyb stránky', not chyby, chyby[:3])
        await br.close()


def main():
    staticke()
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server se nespustil'); sys.exit(2)
    try:
        asyncio.run(beh(url + '?t=' + str(os.getpid())))
    finally:
        srv.terminate()
    print('\n%d/%d OK' % (sum(OKS), len(OKS)))
    sys.exit(0 if all(OKS) else 1)


if __name__ == '__main__':
    main()
