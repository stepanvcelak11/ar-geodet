# -*- coding: utf-8 -*-
u"""Regrese k v380 (19. 9. 2026 odp.) — čtvrté kolo hodnocení, dávka 3: E6 + E8 + G3.

  E6  js/hledat-misto.js: hledání místa/adresy (Photon) + souřadnice v jakémkoli zápisu (WGS84 desetinně,
      DMS, dvojice v místním systému země přes AGSour.zMistnich), mapa skočí, akce Vzít jako mou polohu /
      Uložit jako bod / Navigovat sem / Zkopírovat odkaz; odkaz ?bod=lat,lng,název → bod v zakázce + cíl
      navigace + mapa; ?geo=geo:lat,lng (manifest protocol_handlers); v kartě bodu „Poslat odkaz na bod";
      js/csv-validate.js hlídá rozsah S-JTSK jen v CZ/SK (v Německu padal každý bod).
  E8  js/zdroje-zemi.js RTK: karta „Měříš v zemi" má řádek Korekce RTK (síť, provozovatel, odkaz, zdarma);
      Nastavení → Země měření řádek #s-zeme-rtk.
  G3  Brána: „Jen se podívat — bez účtu, data zůstanou v telefonu" (#agg-look) založí lokální firmu
      s adminem bez PINu a spustí appku; po reloadu zůstává přihlášen.

Spouští se z kořene repa (vlastní port 9380, vlastní server):
    python scripts/test_v380.py
"""
import io, os, re, sys, json, asyncio
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as V
from ag_boot import boot
PORT = 9380
OKS = []


def ok(n, c, info=''):
    OKS.append(bool(c)); print(('OK    ' if c else 'CHYBA ') + n + ('' if c else '  -- %s' % (info,)))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def nacti(rel):
    return json.load(io.open(os.path.join(ROOT, rel), encoding='utf-8'))


PHOTON = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"osm_type": "W", "osm_id": 783052052, "osm_key": "place", "osm_value": "square", "type": "locality", "name": "Alexanderplatz", "district": "Mitte", "city": "Berlin", "country": "Deutschland", "countrycode": "DE"}, "geometry": {"type": "Point", "coordinates": [13.4136358, 52.5219814]}},
    {"type": "Feature", "properties": {"osm_type": "N", "osm_id": 1, "osm_key": "railway", "osm_value": "station", "name": "Berlin Alexanderplatz", "street": "Dircksenstraße", "housenumber": "2", "postcode": "10179", "city": "Berlin", "country": "Deutschland"}, "geometry": {"type": "Point", "coordinates": [13.41108, 52.52146]}}]}


async def route(route_, request):
    u = request.url
    try:
        if 'photon.komoot.io' in u:
            return await route_.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(PHOTON))
    except Exception:
        pass
    await V.route_vse(route_, request)


def staticke():
    hm = src('js/hledat-misto.js')
    ok('E6 hledat-misto.js: Photon, souřadnice, odkaz ?bod=, geo:, karta bodu', 'photon.komoot.io' in hm and 'function souradnice(' in hm and "PARAM = 'bod'" in hm and "q.get('geo')" in hm and "id = 'ag-kb-share'" in hm and 'AGSour.zMistnich(x, y)' in hm)
    ok('E6 index.html načítá js/hledat-misto.js odloženě', 'data-src="js/hledat-misto.js"' in src('index.html'))
    ok('E6 registr: hledat-misto (Před výjezdem) + návod v 7 souborech', "{ k: 'hledat-misto', fn: 'agOpenHledatMisto'" in src('js/tools-registry.js') and all('hledat-misto' in nacti('data/navody%s.json' % s) for s in ('', '-en', '-de', '-pl', '-es', '-it', '-fr')))
    ok('E6 manifest: protocol_handlers geo:', '"protocol": "geo"' in src('manifest.json'))
    ok(u'E6 csv-validate.js: rozsah S-JTSK jen v CZ/SK', "if (_k !== 'CZ' && _k !== 'SK') return true;" in src('js/csv-validate.js'))
    ok('E6 sw.js má hledat-misto.js', "'./js/hledat-misto.js'" in src('sw.js'))
    zz = src('js/zdroje-zemi.js')
    ok('E8 zdroje-zemi.js: RTK tabulka + řádek v kartě', 'var RTK = {' in zz and "CZ: { n: 'CZEPOS'" in zz and "row(T('Korekce RTK')" in zz and 'rtkPro: rtkPro' in zz and len(re.findall(r"^\s+[A-Z]{2}: \{ n: '", zz, re.M)) >= 35)
    ok(u'E8 zeme-svet.js: řádek #s-zeme-rtk v Nastavení', "id = 's-zeme-rtk'" in src('js/zeme-svet.js'))
    uc = src('js/ucty.js')
    ok(u'G3 ucty.js: tlačítko #agg-look + lokální účet bez PINu', 'id="agg-look"' in uc and "lokalniNahled: true" in uc and "noPin: true" in uc and "usageLog('login', 'nahled')" in uc)
    core = nacti('data/jazyky.json')
    for l in core['poradi']:
        d = nacti('data/jazyky-%s.json' % l)['t']
        ok(u'E6/E8/G3 rozšíření %s: nové klíče' % l, all(k in d for k in (u'Najít místo nebo adresu', u'Vzít jako mou polohu', u'Poslat odkaz na bod kolegovi', u'Korekce RTK', u'Jen se podívat — bez účtu, data zůstanou v telefonu')))


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        # --- E6: odkaz na bod + hledání (Praha, Pro) --------------------------------------------
        chyby = []
        init = boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');"
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        await ctx.add_init_script(init)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)))
        await page.route('**/*', route)
        await page.goto(url + '&bod=50.0800,14.4400,Zkouska%20odkazu', wait_until='domcontentloaded', timeout=60000)
        await V.cekej(page, "document.body.classList.contains('app-started')", 40)
        await V.cekej(page, "typeof highlightedPointId !== 'undefined' && !!highlightedPointId", 20)
        s1 = await page.evaluate("() => ({ search: location.search, pt: arPoints.filter(p => p.name === 'Zkouska odkazu').map(p => ({lat: p.lat, lng: p.lng, cat: p.cat, id: p.id})), hl: highlightedPointId, c: map.getCenter(), z: map.getZoom(), btn: !!document.getElementById('btn-hledat-misto') })")
        ok(u'E6 ?bod=…: bod v zakázce, cíl navigace, mapa na něm, parametr smazán', s1 and len(s1['pt']) == 1 and abs(s1['pt'][0]['lat'] - 50.08) < 1e-6 and s1['hl'] == s1['pt'][0]['id'] and abs(s1['c']['lat'] - 50.08) < 1e-4 and s1['z'] >= 17 and 'bod=' not in s1['search'], s1)
        ok(u'E6 tlačítko „Najít místo" v panelu Vrstvy', s1 and s1['btn'])
        s2 = await page.evaluate("(qs) => qs.map(q => AGHledat.souradnice(q))", ['50,0755 14,4378', '14.4378 50.0755', '50°04\'32"N 14°26\'16"E', '741817,8 1044492,5', '1 044 492,5 741 817,8', 'Alexanderplatz'])
        ok(u'E6 souřadnice: desetinné, prohozené, DMS, S-JTSK Y X (i s mezerami v tisících), text=null',
           s2 and abs(s2[0]['lat'] - 50.0755) < 1e-6 and abs(s2[1]['lat'] - 50.0755) < 1e-6 and abs(s2[2]['lng'] - 14.43778) < 1e-4 and s2[3] and abs(s2[3]['lat'] - 50.0755) < 1e-4 and s2[3]['popis'] == 'S-JTSK' and s2[5] is None, s2)
        await page.evaluate("() => AGHledat.open('Alexanderplatz Berlin')")
        await page.wait_for_timeout(1500)
        s3 = await page.evaluate("() => [...document.querySelectorAll('#aghm-body button[data-i]')].map(b => b.textContent)")
        ok(u'E6 hledání (Photon): 2 výsledky s adresou', s3 and len(s3) == 2 and 'Alexanderplatz' in s3[0] and 'Berlin' in s3[0], s3)
        await page.evaluate("() => document.querySelector('#aghm-body button[data-i]').click()")
        await page.wait_for_timeout(600)
        s4 = await page.evaluate("() => ({ c: map.getCenter(), pin: document.querySelectorAll('.ag-hm-pin').length, acts: [...document.querySelectorAll('#aghm-acts button')].map(b => b.getAttribute('data-act')) })")
        ok(u'E6 výběr výsledku: mapa skočí do Berlína, značka, 4 akce', s4 and abs(s4['c']['lat'] - 52.52198) < 1e-3 and s4['pin'] == 1 and s4['acts'] == ['poloha', 'bod', 'nav', 'odkaz'], s4)
        s5 = await page.evaluate("() => { document.querySelector('#aghm-acts button[data-act=nav]').click(); return { n: arPoints.filter(p => /Alexanderplatz/.test(p.name)).length, toast: (document.getElementById('quick-toast')||{}).innerText || '' }; }")
        ok(u'E6 Navigovat sem v jiné zemi (Berlín při zemi CZ): bod se neuloží, hláška o jiné zemi', s5 and s5['n'] == 0 and u'jiné zemi' in s5['toast'], s5)
        await page.evaluate("() => { AGHledat && document.getElementById('aghm-close').click(); }")
        s6 = await page.evaluate("() => AGHledat.odkaz(50.0755, 14.4378, 'Mezník 1')")
        ok(u'E6 odkaz na bod: …?bod=50.0755,14.4378,Mezn%C3%ADk%201', s6.endswith('?bod=50.0755,14.4378,Mezn%C3%ADk%201'), s6)
        await page.evaluate("() => { const p = arPoints.find(p => p.name === '1047'); showDetails(p, 40); }")
        await page.wait_for_timeout(1200)
        s7 = await page.evaluate("() => { const b = document.getElementById('ag-kb-share'); return b ? b.textContent : null; }")
        ok(u'E6 karta bodu: řádek „Poslat odkaz na bod kolegovi"', s7 and 'Poslat odkaz' in s7, s7)
        await page.evaluate("() => { try { closeBottomSheet(); } catch (e) {} }")
        # E8: karta „Měříš v zemi" s RTK
        s8 = await page.evaluate("""async () => { await new Promise(r => AGLazy.need('js/zdroje-zemi.js', r)); const k = AGZdroje.uvodHtml('DE'); const k2 = AGZdroje.uvodHtml('PL'); return { de: k.html, pl: k2.html, rtk: AGZdroje.rtkPro('CZ') }; }""")
        ok(u'E8 karta DE: Korekce RTK SAPOS (zdarma) + odkaz; PL ASG-EUPOS', s8 and 'SAPOS' in s8['de'] and 'sapos.de' in s8['de'] and 'zdarma' in s8['de'] and 'ASG-EUPOS' in s8['pl'] and s8['rtk']['n'] == 'CZEPOS', s8 and s8['de'][-300:])
        ok('E6/E8 bez chyb stránky', not chyby, chyby[:3])
        await ctx.close()

        # --- G3: brána → Jen se podívat ------------------------------------------------------------
        chyby2 = []
        ctx2 = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                    geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        p2 = await ctx2.new_page()
        p2.on('pageerror', lambda e: chyby2.append(str(e)))
        await p2.route('**/*', V.route_vse)
        await p2.goto(url, wait_until='domcontentloaded', timeout=60000)
        await p2.wait_for_timeout(4000)
        g1 = await p2.evaluate("() => { const b = document.getElementById('agg-look'); return b ? { t: b.textContent, h: b.getBoundingClientRect().height, gate: !!document.getElementById('ag-gate') } : null; }")
        ok(u'G3 brána má „Jen se podívat" (≥44 px)', g1 and g1['gate'] and g1['h'] >= 44 and u'bez účtu' in g1['t'], g1)
        await p2.evaluate("() => document.getElementById('agg-look').click()")
        await V.cekej(p2, "document.body.classList.contains('app-started')", 30)
        await p2.wait_for_timeout(1500)
        g2 = await p2.evaluate("() => ({ started: document.body.classList.contains('app-started'), gate: !!document.getElementById('ag-gate'), login: !!document.getElementById('ag-login'), user: (AGUcty.currentUser() || {}).name, firm: (AGUcty.getFirm && AGUcty.getFirm() || {}).firmName })")
        ok(u'G3 jedno klepnutí → appka běží, lokální účet „Já" ve firmě „Jen tento telefon"', g2 and g2['started'] and not g2['gate'] and not g2['login'] and g2['user'] == u'Já', g2)
        await p2.reload(wait_until='domcontentloaded')
        await V.cekej(p2, "document.body.classList.contains('app-started')", 30)
        g3 = await p2.evaluate("() => ({ started: document.body.classList.contains('app-started'), gate: !!document.getElementById('ag-gate'), login: !!document.getElementById('ag-login') })")
        ok(u'G3 po reloadu zůstává přihlášen (bez brány)', g3 and g3['started'] and not g3['gate'] and not g3['login'], g3)
        ok('G3 bez chyb stránky', not chyby2, chyby2[:3])
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
