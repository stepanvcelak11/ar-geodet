# -*- coding: utf-8 -*-
u"""Regrese k v368 (18. 9. 2026) — FRANCOUZŠTINA + mapa Evropy po zemích + počasí po zemích:

  F1  data: jádro (data/jazyky.json) má fr v 'jazyky' i 'poradi' a 6 překladů u každého klíče;
      rozšíření data/jazyky-fr.json má stejné klíče jako en; navody/predpisy/ulohy/co-je-noveho-fr.json
      existují a bez českých zbytků (test_jazyky_data to hlídá obecně, tady jen že fr je v LANGS).
  F2  js/jazyky.js: LANGS má fr, detect() vrátí fr pro telefon ve francouzštině, locale() dá fr-FR.
  F3  V prohlížeči (locale fr-FR, bez uložené volby): appka běží francouzsky (detect), Nastavení
      má francouzský titulek, návod „?" u Kompasu je francouzsky, Historie aktualizací bez češtiny
      a dny slovy francouzsky.
  M1  js/mapa-vektor.js: soubor po zemi z data/mapa-dily.json (dil()) — země rozdělená na díly
      vrací <kod>-N.pmtiles podle polohy, nerozdělená <kod>.pmtiles; scripts/mapa-evropa.py existuje.
  P1  js/pocasi.js: regionální modely mají 'zeme' a modelyZde() je mimo tu zemi vynechá
      (AROME France se pro Prahu nesmí volat).
  S1  js/body-svet.js (v369): úřední body ve Švýcarsku (swisstopo identify) a Nizozemsku (PDOK RDinfo)
      — s podstrčenou odpovědí služby (tvar zachycený 18. 9. 2026) simulace CH/NL vloží body do arPoints
      se správnou kategorií, polohou (LV95 → WGS84) a zdrojem; panel Body a hláška po přejezdu hranice
      říkají, kde stát body zveřejňuje (CZ, SK, CH, NL) a kde ne.
  S2  Karta „Měříš v zemi X" (zdroje-zemi.js uvod/naplanujUvod): po přejezdu hranice jedna karta místo dvou
      hlášek (souřadnice, výšky, úřední body ano/ne, katastr, ortofoto); po startu appky rovnou v cizině
      se ukáže jednou na zemi (agZemeUvod_v1), až appka běží a nic ji nepřekrývá.

Spouští se z kořene repa (vlastní port 9368, vlastní server):
    python scripts/test_v368.py
"""
import io, os, re, sys, json, asyncio
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as V
from ag_boot import boot
PORT = 9368
# jen písmena, která francouzština NEMÁ (é á í ú jsou i francouzsky)
CZ = re.compile(u'[ěščřžýůďťňĚŠČŘŽÝŮĎŤŇ]')
OKS = []


def ok(n, c, info=''):
    OKS.append(bool(c)); print(('OK    ' if c else 'CHYBA ') + n + ('' if c else '  -- %s' % (info,)))


def nacti(rel):
    return json.load(io.open(os.path.join(ROOT, rel), encoding='utf-8'))


def ceska_slova(t):
    return [w for w in re.findall(u'[A-Za-zÀ-ž’]+', t) if CZ.search(w) and w not in (u'ČÚZK', u'ČHMÚ', u'Křovák', u'Křováka', u'Kokeš', u'Sněžka', u'Sněžku', u'ŘLP', u'ČSN', u'ČR', u'Štátna', u'sieť', u'Bpv')]


def staticke():
    core = nacti('data/jazyky.json')
    ok('F1 jádro: fr v jazyky i poradi', ['fr', u'Français'] in core['jazyky'] and core['poradi'][-1] == 'fr')
    n = len(core['poradi'])
    ok('F1 jádro: %d překladů u každého klíče, žádný prázdný' % n, all(len(v) == n and all(v) for v in core['t'].values()))
    ok('F1 jádro: vzory re mají %d sloupců' % (n + 1), all(len(r) == n + 1 for r in core['re']))
    fr = nacti('data/jazyky-fr.json'); en = nacti('data/jazyky-en.json')
    ok('F1 jazyky-fr.json: jazyk fr, stejné klíče jako en (%d)' % len(en['t']), fr.get('jazyk') == 'fr' and set(fr['t']) == set(en['t']))
    zb = [k for k, v in fr['t'].items() if v == k and len(k) > 3 and ceska_slova(k)]
    ok('F1 jazyky-fr.json: nepřeložené klíče s diakritikou', not zb, zb[:5])
    for f in ('navody', 'predpisy', 'ulohy', 'co-je-noveho'):
        ok('F1 data/%s-fr.json existuje' % f, os.path.exists(os.path.join(ROOT, 'data/%s-fr.json' % f)))
    cjn = nacti('data/co-je-noveho-fr.json'); cs = nacti('data/co-je-noveho.json')
    ok('F1 co-je-noveho-fr: stejná vydání jako česky', [v['v'] for v in cjn['verze']] == [v['v'] for v in cs['verze']])
    ok('F1 co-je-noveho-fr: v368 přeloženo (francouzština + Evropa)', any(v['v'] == 368 and u'fran' in v['nadpis'].lower() for v in cjn['verze']))
    tj = io.open(os.path.join(ROOT, 'scripts/test_jazyky_data.py'), encoding='utf-8').read()
    ok('F1 test_jazyky_data.py má fr v LANGS', "'it', 'fr'" in tj)
    jz = io.open(os.path.join(ROOT, 'js/jazyky.js'), encoding='utf-8').read()
    ok('F2 js/jazyky.js LANGS má fr', "{ c: 'fr', n: 'Français' }" in jz)
    ok('F2 js/jazyky.js detect() zná fr', "c === 'fr'" in jz)
    ok('F2 js/jazyky.js locale() fr-FR', "fr: 'fr-FR'" in jz)
    mv = io.open(os.path.join(ROOT, 'js/mapa-vektor.js'), encoding='utf-8').read()
    ok('M1 mapa-vektor.js: díly po zemi (data/mapa-dily.json, dil())', 'mapa-dily.json' in mv and 'function dil(' in mv)
    ok('M1 scripts/mapa-evropa.py existuje', os.path.exists(os.path.join(ROOT, 'scripts/mapa-evropa.py')))
    ok('M1 data/mapa-dily.json je JSON se zeměmi', isinstance(nacti('data/mapa-dily.json'), dict))
    pc = io.open(os.path.join(ROOT, 'js/pocasi.js'), encoding='utf-8').read()
    ok('P1 pocasi.js: modelyZde + zeme u regionálních modelů', 'function modelyZde(' in pc and "zeme:" in pc and 'meteofrance' in pc)


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        init = boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.removeItem('agJazyk_v1');"
        ctx = await br.new_context(locale='fr-FR', viewport={'width': 412, 'height': 915}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        await ctx.add_init_script(init)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)))
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(2500)
        await page.evaluate("() => { if (typeof startAppFromWelcome === 'function') startAppFromWelcome(); }")
        await page.wait_for_timeout(3000)
        lang = await page.evaluate("() => window.AGJazyk && AGJazyk.get()")
        ok('F3 telefon fr-FR → appka běží francouzsky (detect)', lang == 'fr', lang)
        t = await page.evaluate("() => AGJazyk.t('Nastavení')")
        ok(u'F3 t(Nastavení) = Réglages', t == u'Réglages', t)
        t = await page.evaluate("() => AGJazyk.t('Zavřít')")
        ok(u'F3 t(Zavřít) francouzsky', t and not CZ.search(t), t)
        h = await page.evaluate("() => AGReg.helpAsync('kompas').then(r => r && r.h)")
        ok(u'F3 návod Kompas je francouzsky (boussole)', h and 'boussole' in h.lower() and not ceska_slova(h), (h or '')[:120])
        await page.evaluate("() => new Promise(res => { const go = () => res(agToolHelp('kompas', 'Kompas')); if (typeof agToolHelp === 'function') go(); else AGLazy.need('js/tools-plus.js', go); })")
        await page.wait_for_timeout(1500)
        bub = await page.evaluate("() => { const b = document.getElementById('ag-tp-hm-b'), t = document.getElementById('ag-tp-hm-t'); return { t: t && t.textContent, b: b && b.textContent.slice(0, 160) }; }")
        ok(u'F3 okno „?" u Kompasu: tělo francouzsky', bub.get('b') and 'nord' in bub['b'].lower() and not ceska_slova(bub['b']), bub)
        await page.evaluate("() => { const c = document.querySelector('.ag-tp-close'); if (c) c.click(); }")
        DUMP = """(sel) => { const root = document.querySelector(sel); if (!root) return null;
            const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const out = [];
            while (w.nextNode()) { const t = w.currentNode.nodeValue.trim(); if (t) out.push(t); } return out; }"""
        await page.evaluate("() => new Promise(res => AGLazy.need('js/historie-aktualizaci.js', () => { AGHistorie.open(); res(); }))")
        await page.wait_for_timeout(3000)
        hist = await page.evaluate(DUMP, '.hist-ov') or []
        zb = sorted(set(w for t in hist for w in ceska_slova(t)))
        ok(u'F3 Historie aktualizací: bez češtiny (%d uzlů)' % len(hist), hist and not zb, zb[:10])
        ok(u'F3 Historie: dny slovy francouzsky', any(re.match(u'^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \\d+ ', t, re.I) for t in hist), [t for t in hist if re.search(u'\\d{4}$', t)][:2])
        await page.evaluate("() => AGHistorie.close()")
        await page.evaluate("() => AGJazyk.set('cs')")
        await page.wait_for_timeout(1500)
        t = await page.evaluate("() => AGJazyk.t('Nastavení')")
        ok(u'F3 po přepnutí na cs zase česky', t == u'Nastavení', t)
        # P1 počasí: regionální modely jen ve své zemi (podle místa předpovědi, ne telefonu)
        pm = await page.evaluate("() => new Promise(res => { const go = () => res({ cz: agPocasiModely(50.08, 14.43), fr: agPocasiModely(48.86, 2.35), no: agPocasiModely(60.39, 5.32) }); if (window.agPocasiModely) return go(); const sc = document.createElement('script'); sc.src = 'js/pocasi.js?t=' + Date.now(); sc.onload = go; document.head.appendChild(sc); })")
        ok('P1 Praha: ALADIN ano, AROME France ne', 'chmi_aladin_cz_1km' in pm['cz'] and 'meteofrance_arome_france_hd' not in pm['cz'], pm['cz'])
        ok(u'P1 Paříž: AROME France ano, ALADIN ne', 'meteofrance_arome_france_hd' in pm['fr'] and 'chmi_aladin_cz_1km' not in pm['fr'], pm['fr'])
        ok('P1 Bergen: MET Norway ano, globální modely všude', 'metno_nordic' in pm['no'] and 'ecmwf_ifs025' in pm['no'] and 'ecmwf_ifs025' in pm['fr'], pm['no'])
        # S1 úřední body CH / NL (podstrčené odpovědi služeb — tvar zachycený naostro 18. 9. 2026)
        CH_ODP = {'results': [
            {'featureId': 'CH030000116611667410', 'layerBodId': 'ch.swisstopo.fixpunkte-lfp1', 'geometry': {'x': 2600000.0, 'y': 1200000.0, 'spatialReference': {'wkid': 2056}},
             'attributes': {'punktname': 'Koordinaten-Ursprung', 'nummer': '11667410', 'n95': 1200000.0, 'e95': 2600000.0, 'h02': 556.68, 'proto_url': 'https://api3.geo.admin.ch/featureattachments/x.pdf', 'ordnung': 'LFP1 3. Ordnung', 'kennzeichnung': 'Granitpfeiler', 'zugang': None}},
            {'featureId': 'CH030000116611667519', 'layerBodId': 'ch.swisstopo.fixpunkte-lfp2', 'geometry': {'x': 2600057.8, 'y': 1199360.5, 'spatialReference': {'wkid': 2056}},
             'attributes': {'status': 'verifiziert', 'koordinate': '2600057.843 / 1199360.496', 'hoehe_geom_m': None, 'url_punktprotokoll': 'https://fpds2.ch/protokolle/y.pdf', 'punktzeichen': 'Turm', 'kanton': 'BE', 'label': 'CH030000116611667519'}},
            {'featureId': 'CH0200000BES_35', 'layerBodId': 'ch.swisstopo.fixpunkte-hfp1', 'geometry': {'x': 2599647.9, 'y': 1198791.8, 'spatialReference': {'wkid': 2056}},
             'attributes': {'punktname': 'BES 35', 'e95': 2599647.942, 'n95': 1198791.758, 'h02': 521.77, 'proto_url': 'https://api3.geo.admin.ch/featureattachments/z.pdf', 'ordnung': 'HFP1.HFP1', 'kennzeichnung': 'Bolzen l+t, horizontal'}}]}
        NL_ODP = {'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'id': 'punten.1', 'properties': {'blad': '250', 'punt': 111, 'bladdeel': 'A', 'benaming': 'H.K. Westertoren Amsterdam', 'ingerekend': 'Ja', 'xrd': 120698.0, 'yrd': 487526.0, 'gps': 0, 'afbeelding': 'https://www.nsgi.nl/iv-api/rdinfo/images/250/250111e.jpg'},
             'geometry': {'type': 'Point', 'coordinates': [4.883482, 52.374535]}},
            {'type': 'Feature', 'id': 'punten.2', 'properties': {'blad': '250', 'punt': 999, 'benaming': 'GPS kernnet', 'xrd': 121000.0, 'yrd': 487000.0, 'gps': 1},
             'geometry': {'type': 'Point', 'coordinates': [4.8880, 52.3698]}}]}
        async def route_ch(route):
            try: await route.fulfill(status=200, content_type='application/json', body=json.dumps(CH_ODP).encode('utf-8'), headers={'Access-Control-Allow-Origin': '*'})
            except Exception: pass
        async def route_nl(route):
            try: await route.fulfill(status=200, content_type='application/json', body=json.dumps(NL_ODP).encode('utf-8'), headers={'Access-Control-Allow-Origin': '*'})
            except Exception: pass
        await page.route('**/api3.geo.admin.ch/**', route_ch)
        await page.route('**/service.pdok.nl/**', route_nl)
        await page.evaluate("() => { const sc = document.createElement('script'); sc.src = 'js/body-svet.js?t=' + Date.now(); document.head.appendChild(sc); }")
        await page.wait_for_timeout(1200)
        s1 = await page.evaluate("""async () => { if (!window.AGBodySvet) return null; AGZemeSimulace('CH'); await new Promise(r => setTimeout(r, 700)); var n = await AGBodySvet.obnov(true);
            var ch = arPoints.filter(p => p.zdroj === 'swisstopo'); var tb = ch.find(p => p.name === '11667410'), z = ch.find(p => p.cat === 'ZHB'), h = ch.find(p => p.cat === 'NIVEL');
            var out = { kod: AGSour.kod(), n: n, ch: ch.length, tb: tb && { lat: tb.lat, lng: tb.lng, cat: tb.cat, druh: tb.druh, vyska: tb.vyska, link: tb.rawData.GEODETICKE_UDAJE, vrstva: tb.vrstva }, z: z && { name: z.name, ku: z.ku, lat: z.lat }, h: h && { name: h.name, vyska: h.vyska, type: h.type },
                zdrojCH: AGBodySvet.zdrojPro('CH'), zdrojPL: AGBodySvet.zdrojPro('PL'), zdrojSK: AGBodySvet.zdrojPro('SK') };
            AGZemeSimulace('CH'); return out; }""")
        ok(u'S1 CH: 3 body swisstopo (LFP1 → TB, LFP2 → ZHB, HFP1 → NIVEL s výškou), poloha z LV95 (počátek LV95 = 46,95108 N, 7,43863 E ve WGS84, ne Bessel lat_0/lon_0)', s1 and s1['kod'] == 'CH' and s1['ch'] == 3 and s1['tb'] and s1['tb']['cat'] == 'TB' and abs(s1['tb']['lat'] - 46.95108) < 0.0003 and abs(s1['tb']['lng'] - 7.43863) < 0.0003
           and s1['tb']['vyska'] == 556.68 and s1['tb']['link'] and s1['tb']['vrstva'] == 'CH' and s1['z'] and s1['z']['name'] == '11667519' and s1['z']['ku'] == 'BE' and s1['h'] and s1['h']['vyska'] == 521.77 and s1['h']['type'] == 'vyskovy', s1)
        ok(u'S1 zdrojPro: CH swisstopo, SK GKÚ SR, PL nic', s1 and s1['zdrojCH'] == 'swisstopo' and s1['zdrojSK'] == u'GKÚ SR' and not s1['zdrojPL'], s1 and (s1['zdrojCH'], s1['zdrojPL']))
        s2 = await page.evaluate("""async () => { AGZemeSimulace('NL'); await new Promise(r => setTimeout(r, 700)); var n = await AGBodySvet.obnov(true);
            var nl = arPoints.filter(p => p.zdroj === 'Kadaster RDinfo'); var a = nl.find(p => p.name === '250111'), b = nl.find(p => p.name === '250999');
            var out = { kod: AGSour.kod(), n: n, nl: nl.length, a: a && { cat: a.cat, lat: a.lat, lng: a.lng, nazev: a.nazevBodu, link: Object.values(a.rawData).find(v => /^http/.test(String(v))) }, b: b && b.cat };
            AGZemeSimulace('NL'); return out; }""")
        ok(u'S1 NL: 2 body RDinfo (bez GPS → ZHB, GPS kernnet → TB), název a foto bodu', s2 and s2['kod'] == 'NL' and s2['nl'] == 2 and s2['a'] and s2['a']['cat'] == 'ZHB' and abs(s2['a']['lat'] - 52.3745) < 0.001 and s2['a']['nazev'] == 'H.K. Westertoren Amsterdam' and s2['a']['link'] and s2['b'] == 'TB', s2)
        await page.evaluate("() => { for (var i = arPoints.length - 1; i >= 0; i--) if (arPoints[i].zdroj === 'swisstopo' || arPoints[i].zdroj === 'Kadaster RDinfo') arPoints.splice(i, 1); }")
        gr = io.open(os.path.join(ROOT, 'js/grafika.js'), encoding='utf-8').read()
        ok(u'S1 panel Body říká, kde stát body zveřejňuje (CZ, SK, CH, NL)', u'Švýcarsko (swisstopo), Nizozemsko (Kadaster)' in gr)
        zz = io.open(os.path.join(ROOT, 'js/zdroje-zemi.js'), encoding='utf-8').read()
        ok(u'S1 hláška po přejezdu hranice: úřední body ano/ne', 'function uvodHtml' in zz and u'Úřední body tu stát nezveřejňuje' in zz and 'AGBodySvet.zdrojPro' in zz and 'naplanujUvod' in zz)
        ok('S1 index.html načítá js/body-svet.js', 'js/body-svet.js' in io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read())
        # S2 karta „Měříš v zemi" — přejezd (simulace PL) a start v cizině (naplanujUvod)
        s3 = await page.evaluate("""async () => { localStorage.removeItem(AGZdroje.UVOD_KLIC); AGZemeSimulace('PL'); await new Promise(r => setTimeout(r, 900));
            var ov = document.querySelector('.ag-dlg-overlay.open'); var t = ov && ov.querySelector('.ag-dlg-title').textContent, m = ov && ov.querySelector('.ag-dlg-msg').textContent;
            var videno = JSON.parse(localStorage.getItem(AGZdroje.UVOD_KLIC) || '{}');
            if (ov) ov.querySelector('.ag-dlg-ok').click(); await new Promise(r => setTimeout(r, 300));
            AGZemeSimulace('PL'); await new Promise(r => setTimeout(r, 500));
            var ov2 = document.querySelector('.ag-dlg-overlay.open'); if (ov2) ov2.querySelector('.ag-dlg-ok').click();
            return { t: t, m: (m || '').slice(0, 400), pl: !!videno.PL, kod: AGSour.kod() }; }""")
        ok(u'S2 přejezd do Polska: jedna karta „Měříš v zemi: Polsko" s úředními body NE, souřadnicemi a katastrem', s3 and s3['t'] and u'Polsko' in s3['t'] and u'nezveřejňuje' in s3['m'] and 'PL-2000' in s3['m'] and 'KIEG' in s3['m'] and s3['pl'], s3)
        s4 = await page.evaluate("""async () => { localStorage.removeItem(AGZdroje.UVOD_KLIC); AGZemeSimulace('CH'); await new Promise(r => setTimeout(r, 900));
            var ov = document.querySelector('.ag-dlg-overlay.open'); var m = ov && ov.querySelector('.ag-dlg-msg').textContent; if (ov) ov.querySelector('.ag-dlg-ok').click(); await new Promise(r => setTimeout(r, 300));
            AGZemeSimulace('CH'); await new Promise(r => setTimeout(r, 500)); var ov2 = document.querySelector('.ag-dlg-overlay.open'); if (ov2) ov2.querySelector('.ag-dlg-ok').click();
            return (m || '').slice(0, 300); }""")
        ok(u'S2 přejezd do Švýcarska: karta říká úřední body ANO — swisstopo, LV95', s4 and 'swisstopo' in s4 and 'LV95' in s4 and u'nezveřejňuje' not in s4, s4)
        s5 = await page.evaluate("""async () => { localStorage.removeItem(AGZdroje.UVOD_KLIC); AGZemeSimulace('DE'); await new Promise(r => setTimeout(r, 900));
            var ov = document.querySelector('.ag-dlg-overlay.open'); if (ov) ov.querySelector('.ag-dlg-ok').click(); await new Promise(r => setTimeout(r, 300));
            localStorage.removeItem(AGZdroje.UVOD_KLIC);   // jako čerstvá instalace v Německu
            AGZdroje.naplanujUvod('DE'); await new Promise(r => setTimeout(r, 2600));
            var ov2 = document.querySelector('.ag-dlg-overlay.open'); var t = ov2 && ov2.querySelector('.ag-dlg-title').textContent; if (ov2) ov2.querySelector('.ag-dlg-ok').click();
            await new Promise(r => setTimeout(r, 300)); AGZdroje.naplanujUvod('DE'); await new Promise(r => setTimeout(r, 2600)); var ov3 = document.querySelector('.ag-dlg-overlay.open');
            AGZemeSimulace('DE'); await new Promise(r => setTimeout(r, 400)); var ov4 = document.querySelector('.ag-dlg-overlay.open'); if (ov4) ov4.querySelector('.ag-dlg-ok').click();
            return { t: t, znovu: !!ov3, kod: AGSour.kod() }; }""")
        ok(u'S2 start appky v Německu: karta se ukáže sama (bez přejezdu), podruhé už ne', s5 and s5['t'] and u'Německo' in s5['t'] and not s5['znovu'], s5)
        ok('F3 bez chyb stránky', not chyby, chyby[:3])
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
