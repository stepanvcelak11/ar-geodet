# -*- coding: utf-8 -*-
"""v339 (16. 9. 2026): tihove body zvlast, cisla pridruzenych bodu, popisky zrusenych bodu,
karta bodu bez „Stav", napoveda Kontrolni bod × Opravit GPS, klik do parcely s ochranou uzemi,
kalibrace chuzi po hranici katastru (RUIAN zive), DGPS robustni blok + vazeni, pilulka
stahovani nove verze, webova stranka.

  A  agCuzkBod: vrstva 48 → cat TIHA; liche vrstvy (popisky, i zrusenych) → null;
     TB s PL → jmeno „19.3"; migrace ulozeneho bodu (TB→TIHA, „19"→„19.3")
  B  karta tihoveho bodu: podtitul „Tihovy bod · jmeno", bez dlazdice Stav, bez tlacitek
     Vytyceno a Opravit GPS, napoveda pod tlacitky; karta TB: radek Triangulacni list, Opravit GPS
  C  mapa: znacka tihoveho bodu = sestiuhelnik (polygon 6 vrcholu), oranzova
  D  klik do parcely (RUIAN mock): vymera z grafiky, hranice DKM, adresa, BPEJ rozepsane,
     CHKO s odkazem, ochranne pasmo bodu, budova (konstrukce, dokonceni)
  E  kalibrace hranou: snapNaHranici prichyti na usek (ne jen vrchol), dal nez 4 m nic
  F  DGPS liveOffset: blok mimo radu vyrazen, cerstve bloky vazi vic
  G  agUpdPill: progress → text s procenty a sirka pruhu, done → trida done, hide
  H  web/index.html: nacte se bez chyb, bez vodorovneho prelivani, odkazy na appku a soukromi

Spusteni: python scripts/test_v339.py [port]
"""
import io
import os
import sys
import json
import asyncio
import subprocess
import time
import math
import urllib.request
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from ag_boot import boot  # noqa: E402
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9139)
vysledky = []
LAT, LNG = 50.0755, 14.4378
MLAT = 111320.0
MLNG = 111320.0 * math.cos(math.radians(LAT))


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


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
        # port muze drzet server JINE session nad jinym stromem → overit, ze bezi TENTO strom
        try:
            t = urllib.request.urlopen('http://127.0.0.1:%d/js/logika.js' % p, timeout=2).read().decode('utf-8', 'replace')
            if 'agCuzkMigrujBod' in t and srv.poll() is None:
                return srv, u
        except Exception:
            pass
        srv.terminate()
    return None, None


# ulozene body ze STARSI verze appky: tihovy bod jako TB, pridruzeny bod bez poradi
SEED = "localStorage.setItem('default_arOfflinePoints12', %s);" % json.dumps(json.dumps([
    {'id': 'p_tiha', 'name': '2010.00', 'lat': LAT + 20.0 / MLAT, 'lng': LNG, 'cat': 'TB', 'type': 'polohovy', 'hidden': False, 'vyska': 203.3, 'vrstva': 48,
     'druh': 'Tíhový bod (ZTBP)', 'nazevBodu': 'Praha', 'rawData': {'CISLO': '2010.00', 'NAZEV_BODU': 'Praha', 'VYSKA': '   203.30'}},
    {'id': 'p_tb', 'name': '19', 'lat': LAT, 'lng': LNG + 30.0 / MLNG, 'cat': 'TB', 'type': 'polohovy', 'hidden': False, 'vyska': 348.41, 'vrstva': 18, 'list': '1425',
     'druh': 'Trigonometrický bod (ZPBP)', 'rawData': {'ZTLTL': '1425', 'CISLO': '19', 'PL': '0', 'VYSKA': '   348.41', 'NAZEV_KU': 'Test'}},
    {'id': 'p_tb3', 'name': '19', 'lat': LAT + 40.0 / MLAT, 'lng': LNG + 30.0 / MLNG, 'cat': 'TB', 'type': 'polohovy', 'hidden': False, 'vyska': 0, 'vrstva': 20, 'list': '1425',
     'druh': 'Přidružený bod k TB', 'rawData': {'ZTLTL': '1425', 'CISLO': '19', 'PL': '3', 'VYSKA': '     0.00', 'NAZEV_KU': 'Test'}}]))

# RUIAN mock: parcela (ctverec 40 m), KU, obec, budova, adresa, identify (BPEJ + CHKO + OP bodu)
D = 20.0
RING = [[LNG - D / MLNG, LAT - D / MLAT], [LNG + D / MLNG, LAT - D / MLAT], [LNG + D / MLNG, LAT + D / MLAT], [LNG - D / MLNG, LAT + D / MLAT], [LNG - D / MLNG, LAT - D / MLAT]]
RUIAN = {
    'parcela': {'features': [{'attributes': {'id': 1, 'cisloparcely': '123/4', 'kmenovecislo': 123, 'poddelenicisla': 4, 'druhcislovanikod': 2, 'vymeraparcely': 1580, 'druhpozemkukod': 8, 'zpusobyvyuzitipozemku': None, 'katastralniuzemi': 727181, 'zdroj': 1, 'platiod': 1413241200000}, 'geometry': {'rings': [RING]}}]},
    'ku': {'features': [{'attributes': {'kod': 727181, 'nazev': 'Testov', 'existujedigitalnimapa': '1'}}]},
    'obec': {'features': [{'attributes': {'kod': 1, 'nazev': 'Testovice'}}]},
    'budova': {'features': [{'attributes': {'kod': 5, 'cisladomovni': '12', 'typstavebnihoobjektukod': 1, 'zpusobvyuzitikod': 7, 'pocetpodlazi': 2, 'zastavenaplocha': 140, 'pocetbytu': 1, 'dokonceni': 946684800000, 'druhkonstrukcekod': 1, 'podlahovaplocha': 210, 'obestavenyprostor': 900}}]},
    'adresa': {'features': [{'attributes': {'adresa': 'Testovská 12, 11000 Testovice', 'psc': 11000}, 'geometry': {'x': LNG + 3.0 / MLNG, 'y': LAT}}]},
    'identify': {'results': [
        {'layerId': 28, 'layerName': 'BonitovanaPudneEkologickaJednotka', 'attributes': {'Název účelového prvku': '22210'}},
        {'layerId': 40, 'layerName': 'ChranenaKrajinnaOblast', 'attributes': {'Název účelového prvku': 'Křivoklátsko', 'Odkaz do agendového systému zdroje dat': 'https://drusop.aopk.gov.cz/x?CIS=24'}},
        {'layerId': 25, 'layerName': 'OchrannePasmoZnackyBoduZakladnihoBodovehoPole', 'attributes': {'Název účelového prvku': 'Null'}},
    ]},
}


async def stranka(br, url, init, chyby, mock_ruian=False):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)

    async def route_vse(route, request):
        u = request.url
        try:
            if mock_ruian and 'RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/' in u:
                if '/identify?' in u:
                    body = RUIAN['identify']
                elif '/5/query' in u:
                    body = RUIAN['parcela']
                elif '/7/query' in u:
                    body = RUIAN['ku']
                elif '/12/query' in u:
                    body = RUIAN['obec']
                elif '/3/query' in u:
                    body = RUIAN['budova']
                elif '/1/query' in u:
                    body = RUIAN['adresa']
                else:
                    body = {'features': []}
                return await route.fulfill(status=200, content_type='application/json', body=json.dumps(body), headers={'Access-Control-Allow-Origin': '*'})
            if 'cuzk.cz/' in u or 'cuzk.gov.cz/' in u or 'openstreetmap' in u or 'workers.dev' in u:
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
    await page.wait_for_timeout(3000)
    return ctx, page


async def cekej(page, vyraz, kol=25):
    for _ in range(kol):
        if await page.evaluate('() => !!(' + vyraz + ')'):
            return True
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(400)
    return False


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        ctx, page = await stranka(br, url, boot(tarif='pro') + SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.removeItem('agRefShift');", chyby, mock_ruian=True)
        ok('0 appka nastartovala', await cekej(page, "document.body.classList.contains('app-started')"))
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        await page.wait_for_timeout(800)

        # ---- A: trideni bodu ze sluzby ------------------------------------------------
        a = await page.evaluate("""() => {
            const g = (l, a) => agCuzkBod(l, a, 14.4, 50.1, 0);
            const tiha = g(48, { CISLO: '2010.00', NAZEV_BODU: 'Praha', VYSKA: '  203.30' });
            const lbl = g(19, { ZTLTL: '1425', CISLO: '19', PL: '0' });
            const zrus = g(11, { ZTLTL: '1420', CISLO: '39', PL: '0' });
            const tb = g(18, { ZTLTL: '1425', CISLO: '19', PL: '0', VYSKA: '  348.41' });
            const zb = g(20, { ZTLTL: '1425', CISLO: '19', PL: '3', VYSKA: '    0.00' });
            const seed = arPoints.filter(p => p.id === 'p_tiha' || p.id === 'p_tb3').map(p => ({ id: p.id, cat: p.cat, name: p.name, type: p.type }));
            return { tiha: tiha && { cat: tiha.cat, type: tiha.type, name: tiha.name, nazev: tiha.nazevBodu }, lbl: lbl, zrus: zrus,
                     tb: tb && { name: tb.name, c12: tb.cislo12, list: tb.list }, zb: zb && { name: zb.name, c12: zb.cislo12 }, seed: seed };
        }""")
        ok('A1 vrstva 48 → cat TIHA, type tihovy, jmeno Praha', a['tiha'] and a['tiha']['cat'] == 'TIHA' and a['tiha']['type'] == 'tihovy' and a['tiha']['nazev'] == 'Praha', a['tiha'])
        ok('A2 popisek (licha vrstva 19) → null', a['lbl'] is None, a['lbl'])
        ok('A3 popisek ZRUSENEHO bodu (vrstva 11) → null', a['zrus'] is None, a['zrus'])
        ok('A4 TB: jmeno „19", uplne cislo 000914250190, list 1425', a['tb'] and a['tb']['name'] == '19' and a['tb']['c12'] == '000914250190' and a['tb']['list'] == '1425', a['tb'])
        ok('A5 pridruzeny bod PL 3: jmeno „19.3", uplne cislo 000914250193', a['zb'] and a['zb']['name'] == '19.3' and a['zb']['c12'] == '000914250193', a['zb'])
        seed = {s['id']: s for s in a['seed']}
        ok('A6 migrace ulozeneho tihoveho bodu TB → TIHA', seed.get('p_tiha', {}).get('cat') == 'TIHA' and seed['p_tiha']['type'] == 'tihovy', seed.get('p_tiha'))
        ok('A7 migrace ulozeneho pridruzeneho bodu „19" → „19.3"', seed.get('p_tb3', {}).get('name') == '19.3', seed.get('p_tb3'))

        # ---- B: karta bodu -------------------------------------------------------------
        await page.evaluate("() => { var p = arPoints.find(x => x.id === 'p_tiha'); showDetails(p, 20); }")
        ok('B1 karta tihoveho bodu se otevrela s napovedou pod tlacitky', await cekej(page, "document.getElementById('ag-kb-hint') && document.getElementById('bottom-sheet').classList.contains('open')", 20))
        b = await page.evaluate("""() => {
            const bs = document.getElementById('bottom-sheet');
            const acts = [...document.querySelectorAll('#ag-kb-acts button')].map(b => b.getAttribute('data-a'));
            const tiles = [...document.querySelectorAll('#ag-kb-bento .ag-kb-t small')].map(s => s.textContent.trim());
            return { sub: document.getElementById('det-subtitle').textContent, acts, tiles, hint: document.getElementById('ag-kb-hint').textContent,
                     hex: !!document.querySelector('#ag-kb-bento .ic svg path[d^="M12 3l8"]'), txt: bs.innerText };
        }""")
        ok('B2 podtitul „Tihovy bod · Praha"', 'Tíhový bod' in b['sub'] and 'Praha' in b['sub'], b['sub'])
        ok('B3 zadna dlazdice Stav (vytyceno)', 'Stav' not in b['tiles'] and 'nevytyčeno' not in b['txt'], b['tiles'])
        ok('B4 u uredniho bodu neni tlacitko Vytyceno; u tihoveho ani Opravit GPS', 'staked' not in b['acts'] and 'ref' not in b['acts'] and 'check' in b['acts'], b['acts'])
        ok('B5 napoveda vysvetluje Kontrolni bod', 'Kontrolní bod' in b['hint'] and 'záznam' in b['hint'], b['hint'])
        ok('B6 ikona v mozaice = sestiuhelnik', b['hex'])
        await page.evaluate("() => { closeBottomSheet(); var p = arPoints.find(x => x.id === 'p_tb'); showDetails(p, 30); }")
        await cekej(page, "document.getElementById('ag-kb-hint') && document.getElementById('bottom-sheet').classList.contains('open') && document.getElementById('det-title').textContent.indexOf('19') >= 0", 20)
        b2 = await page.evaluate("""() => ({ acts: [...document.querySelectorAll('#ag-kb-acts button')].map(b => b.getAttribute('data-a')), txt: document.getElementById('bottom-sheet').textContent,
                                          hint: document.getElementById('ag-kb-hint').textContent, chips: [...document.querySelectorAll('#det-subtitle .ag-kb-chip')].map(c => c.textContent) })""")
        ok('B7 karta TB: radek Triangulacni list 1425 + chip TL', 'Triangulační list' in b2['txt'] and any('TL 1425' in c for c in b2['chips']), (b2['chips'], b2['txt'][:300]))
        ok('B8 karta TB: Opravit GPS je, Vytyceno neni, napoveda ma obe veci', 'ref' in b2['acts'] and 'staked' not in b2['acts'] and 'Opravit GPS' in b2['hint'], (b2['acts'], b2['hint']))
        await page.evaluate("() => closeBottomSheet()")

        # ---- C: znacka v mape ------------------------------------------------------------
        c = await page.evaluate("""() => { const s = getMapMarkerSVG('TIHA', '#f97316'); return { pts: (s.match(/points="([^"]+)"/) || [])[1] || '', col: s.indexOf('#f97316') >= 0, barva: agBarvaBodu({ cat: 'TIHA' }) }; }""")
        ok('C1 znacka tihoveho bodu = sestiuhelnik, oranzova', c['pts'].count(',') == 6 and c['col'] and c['barva'] == '#f97316', c)

        # ---- D: klik do parcely (RUIAN mock) ------------------------------------------------
        await page.evaluate("() => new Promise(r => AGLazy.need('js/parcela-klik.js', r))")
        ok('D1 modul parcela-klik', await cekej(page, "window.AGParcelaKlik", 10))
        await page.evaluate("([la, ln]) => { visSettings.showKatastr = true; AGParcelaKlik.tap(la, ln); }", [LAT, LNG])
        d2 = False
        for _ in range(80):   # bez AGLazy.flush — ten by mezitím tahal všechny odložené moduly a karta by čekala desítky sekund
            if await page.evaluate("() => !!(document.getElementById('ag-pcl-modal') && document.getElementById('ag-pcl-modal').textContent.indexOf('Ochrana a omezení') >= 0)"):
                d2 = True
                break
            await page.wait_for_timeout(400)
        ok('D2 karta parcely se naplnila', d2)
        d = await page.evaluate("() => document.getElementById('ag-pcl-modal').innerText")   # innerText = i s CSS text-transform (nadpisy sekci velkymi)
        ok('D3 cislo, k.u., vymera uredni i z grafiky', 'Parcela 123/4' in d and 'Testov' in d and '1 580 m²' in d and 'Výměra z grafiky' in d and '1 6' in d, d[:600])
        ok('D4 druh pozemku kod 8 = trvaly travni porost, hranice DKM, plati od', 'trvalý travní porost' in d and 'DKM — digitální' in d and 'Platí od' in d, d[:800])
        ok('D5 adresa do 40 m', 'Testovská 12' in d, d[:800])
        ok('D6 budova: konstrukce, podlahova plocha, dokonceni 2000', 'cihly, tvárnice' in d and '210 m²' in d and '2000' in d and '900 m³' in d, d[:1200])
        ok('D7 BPEJ rozepsane', 'BPEJ' in d and '22210' in d and 'klimatický region 2' in d and 'rovina (1–3°)' in d, d[:1500])
        ok('D8 CHKO s odkazem + ochranne pasmo bodu ZBP', 'CHKO' in d and 'Křivoklátsko' in d and 'Ochranné pásmo značky bodu ZBP' in d and 'zde platí' in d, d[:1500])
        ok('D9 odkaz na Nahlizeni zustal', 'Nahlížení do KN' in d)
        await page.evaluate("() => AGParcelaKlik.close()")

        # ---- E: kalibrace chuzi — prichyceni na hranici ---------------------------------
        await page.evaluate("() => AGLazyTools.open('kalibrace-hranou')")
        ok('E1 modul kalibrace-hranou', await cekej(page, "window.AGHrana && AGHrana._test && AGHrana._test.snapNaHranici", 20))
        await page.evaluate("() => { var d = document.getElementById('ag-hr-modal'); if (d) d.style.display = 'none'; }")
        e = await page.evaluate("""([la, ln, mlat, mlng]) => {
            const parc = { zdroj: 2, rings: [[{ lat: la, lng: ln }, { lat: la + 100 / mlat, lng: ln }, { lat: la + 100 / mlat, lng: ln + 100 / mlng }, { lat: la, lng: ln }]] };
            const s = AGHrana._test.snapNaHranici;
            const uProstred = s({ lat: la + 50 / mlat, lng: ln + 2.5 / mlng }, parc);   // 2,5 m vedle svisle hrany, uprostred
            const daleko = s({ lat: la + 50 / mlat, lng: ln + 6 / mlng }, parc);        // 6 m = mimo
            return { u: uProstred && { d: uProstred.d, dlng: (uProstred.lng - ln) * mlng, dlat: (uProstred.lat - la) * mlat, zdroj: uProstred.zdroj }, daleko };
        }""", [LAT, LNG, MLAT, MLNG])
        ok('E2 klepnuti 2,5 m vedle hrany → prumet NA USEK (ne vrchol): x≈0, y≈50 m, d≈2,5', e['u'] and abs(e['u']['d'] - 2.5) < 0.05 and abs(e['u']['dlng']) < 0.05 and abs(e['u']['dlat'] - 50) < 0.5 and e['u']['zdroj'] == 2, e['u'])
        ok('E3 klepnuti 6 m od hrany → nic', e['daleko'] is None, e['daleko'])

        # ---- F: DGPS liveOffset --------------------------------------------------------
        await page.evaluate("() => AGLazyTools.open('dgps')")
        ok('F1 modul dgps', await cekej(page, "window.AGDgps && AGDgps._test && AGDgps._test.liveOffset", 20))
        await page.evaluate("() => { var d = document.getElementById('ag-dgps-modal'); if (d) d.style.display = 'none'; }")
        f = await page.evaluate("""() => {
            const t = Date.now(), B = [];
            for (let i = 0; i < 6; i++) B.push({ t: t - (5 - i) * 30000, dE: 1.0 + (i === 2 ? 6.0 : 0), dN: -0.5, n: 20 });   // blok 2 = odraz +6 m
            const a = AGDgps._test.liveOffset({ base: { lat: 50, lng: 14 }, buckets: B });
            const C = [];
            for (let i = 0; i < 6; i++) C.push({ t: t - (5 - i) * 30000, dE: i < 3 ? 0 : 2.0, dN: 0, n: 20 });   // stare 0, cerstve 2
            const b = AGDgps._test.liveOffset({ base: { lat: 50, lng: 14 }, buckets: C });
            return { a: a && { dE: a.dE, n: a.n }, b: b && b.dE };
        }""")
        ok('F2 blok mimo radu (+6 m) vyrazen: dE≈1,0 z 5 bloku', f['a'] and abs(f['a']['dE'] - 1.0) < 0.05 and f['a']['n'] == 5, f['a'])
        ok('F3 cerstve bloky vazi vic: dE mezi 1,0 a 2,0, bliz k 2', f['b'] is not None and 1.3 < f['b'] < 2.0, f['b'])

        # ---- G: pilulka stahovani -----------------------------------------------------------
        g = await page.evaluate("""() => {
            agUpdPill('start'); const el = document.getElementById('ag-upd-pill'); const s0 = el.classList.contains('on') && el.classList.contains('spin');
            agUpdPill('progress', { done: 120, total: 240 }); const t1 = el.querySelector('.ag-upd-txt').textContent, w1 = el.querySelector('.ag-upd-bar i').style.width;
            agUpdPill('done'); const s2 = el.classList.contains('done') && !el.classList.contains('spin');
            agUpdPill('hide'); const s3 = !el.classList.contains('on');
            return { s0, t1, w1, s2, s3 };
        }""")
        ok('G1 start → pilulka viditelna, toci se', g['s0'], g)
        ok('G2 progress 120/240 → „50 %" a pruh 50%', '50 %' in g['t1'] and g['w1'] == '50%', g)
        ok('G3 done → fajfka bez toceni; hide → schovana', g['s2'] and g['s3'], g)

        vazne = [c for c in chyby if 'favicon' not in c and 'net::ERR' not in c and '404' not in c and 'tile.openstreetmap' not in c and '/owner/' not in c and '403' not in c and 'Failed to fetch' not in c and 'ERR_FAILED' not in c]
        ok('Z bez chyb stranky', not vazne, vazne[:5])
        await ctx.close()

        # ---- H: webova stranka ---------------------------------------------------------------
        ctx2 = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, is_mobile=True)
        page2 = await ctx2.new_page()
        ch2 = []
        page2.on('pageerror', lambda e: ch2.append(str(e)))
        page2.on('requestfailed', lambda r: ch2.append('FAIL ' + r.url))
        await page2.goto(url.replace('index.html', 'web/index.html'), wait_until='load', timeout=45000)
        await page2.wait_for_timeout(800)
        await page2.evaluate("() => new Promise(r => { let y = 0; const t = setInterval(() => { y += 700; window.scrollTo(0, y); if (y > document.body.scrollHeight) { clearInterval(t); r(); } }, 60); })")
        await page2.wait_for_timeout(1500)
        h = await page2.evaluate("""() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, title: document.title,
            app: !!document.querySelector('a[href="../"]'), soukromi: !!document.querySelector('a[href="../soukromi.html"]'),
            imgs: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length, sekce: ['co', 'ukazky', 'verze', 'presnost', 'instalace', 'faq'].every(id => document.getElementById(id)) })""")
        ok('H1 web se nacetl bez chyb, bez vodorovneho prelivani', not ch2 and h['sw'] <= h['cw'], (ch2[:3], h))
        ok('H2 web: nazev, odkaz na appku a soukromi, vsechny sekce, obrazky', 'QTRIG' in h['title'] and h['app'] and h['soukromi'] and h['sekce'] and h['imgs'] >= 5, h)
        await ctx2.close()
        await br.close()


def main():
    srv, url = server(PORT)
    if not srv:
        print('CHYBA: server nenastartoval')
        sys.exit(2)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    sys.exit(1 if spatne else 0)


if __name__ == '__main__':
    main()
