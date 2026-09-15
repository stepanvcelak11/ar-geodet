# -*- coding: utf-8 -*-
u"""Regrese k přáním z 15. 9. 2026 večer (v329).

  A  STAVOVÁ BUBLINA: hláška s čísly „nebliká zleva doprava" — fitHead uřízl azimut, mirrorAz ho
     5× za vteřinu vracel; teď se uříznutý kus u téže hlášky už nestaví (šířka pilulky stojí)
  B  NÁSTROJE: Oměrné / Stopa trasy / Dnešek v terénu se nové instalaci NEschovávají (seed v5),
     řádek rozcestníku vypisuje své položky (kalibrace chůzí po hraně, stažení okresu…)
  C  KLIK DO PARCELY: při zapnuté Katastrální mapě klik do prázdné mapy = karta parcely z RÚIAN
     (číslo, k.ú., výměra, druh, využití, budova) + tlačítko na vlastníka v Nahlížení; bez katastru nic
  D  OFICIÁLNÍ NÁČRT ČÚZK v kartě úředního bodu (obrázek z geodetických údajů přes worker),
     odkaz na celé údaje zůstává; vlastní bod má dál náčrt z appky
  E  Lovci bodů / Stáhnout oblast bez „Pokémon Go"; dnešní nástroje bez emoji v tlačítkách

Spuštění:  python scripts/test_v329.py [port]
"""
import io
import os
import re
import sys
import json
import asyncio
import subprocess
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from ag_boot import boot  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8993)
vysledky = []
LAT, LNG = 50.0755, 14.4378


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
        # ⚠ Port může držet server JINÉ session nad jiným stromem (viděno 15. 9. 2026:
        #   test tiše proběhl nad cizí kopií appky bez js/parcela-klik.js). Ověřit, že
        #   na portu opravdu běží TENTO strom, jinak zkusit další port.
        try:
            t = urllib.request.urlopen('http://127.0.0.1:%d/js/parcela-klik.js' % p, timeout=2).read().decode('utf-8', 'replace')
            if 'AGParcelaKlik' in t and srv.poll() is None:
                return srv, u
        except Exception:
            pass
        srv.terminate()
    return None, None


# úřední bod s odkazem na geodetické údaje + vlastní bod bez odkazu (oba 40 m od uživatele)
GU_URL = 'https://geoportal.cuzk.cz/mistopis2/mistopis_soap_hh.asp?NAME=BP_PPBP&TYP=PPBP&HID=test'
SEED = "localStorage.setItem('default_arOfflinePoints12', %s); localStorage.setItem('default_arCustomPoints12', %s);" % (
    json.dumps(json.dumps([{'id': 'p_ppbp', 'name': '1047', 'lat': LAT + 40 / 111320.0, 'lng': LNG, 'cat': 'PBPP', 'type': 'polohovy',
                            'hidden': False, 'rawData': {'CISLO_BODU': '1047', 'GEODETICKE_UDAJE': GU_URL, 'VYSKA': '258.4'}}])),
    json.dumps(json.dumps([{'id': 'p_vlastni', 'name': 'V1', 'lat': LAT - 40 / 111320.0, 'lng': LNG, 'cat': 'CUSTOM', 'type': 'polohovy', 'hidden': False}])))

# 1×1 PNG (průhledný) jako „obrázek ČÚZK" — obsluhuje ho route níže
PNG1 = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8cfc00000020001e221bc330000000049454e44ae426082')

RUIAN_PARCELA = {'features': [{'attributes': {'id': 2091035101, 'cisloparcely': '4079/1', 'kmenovecislo': 4079, 'poddelenicisla': 1, 'druhcislovanikod': 2,
                                              'vymeraparcely': 16239.0, 'druhpozemkukod': 14, 'zpusobyvyuzitipozemku': 17, 'katastralniuzemi': 727164},
                               'geometry': {'rings': [[[LNG - 0.001, LAT - 0.001], [LNG + 0.001, LAT - 0.001], [LNG + 0.001, LAT + 0.001], [LNG - 0.001, LAT + 0.001], [LNG - 0.001, LAT - 0.001]]]}}]}
RUIAN_KU = {'features': [{'attributes': {'kod': 727164, 'nazev': 'Vinohrady', 'existujedigitalnimapa': '1'}}]}
RUIAN_OBEC = {'features': [{'attributes': {'kod': 554782, 'nazev': 'Praha'}}]}
RUIAN_SO = {'features': [{'attributes': {'kod': 21676356, 'cisladomovni': '77', 'typstavebnihoobjektukod': 1, 'zpusobvyuzitikod': 6, 'pocetpodlazi': 7, 'zastavenaplocha': 487, 'pocetbytu': 46}}]}


async def route_vse(route, request):
    u = request.url
    try:
        if 'Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/5/query' in u:
            return await route.fulfill(status=200, content_type='application/json', body=json.dumps(RUIAN_PARCELA), headers={'Access-Control-Allow-Origin': '*'})
        if 'Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/7/query' in u:
            return await route.fulfill(status=200, content_type='application/json', body=json.dumps(RUIAN_KU), headers={'Access-Control-Allow-Origin': '*'})
        if 'Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/12/query' in u:
            return await route.fulfill(status=200, content_type='application/json', body=json.dumps(RUIAN_OBEC), headers={'Access-Control-Allow-Origin': '*'})
        if 'Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/3/query' in u:
            return await route.fulfill(status=200, content_type='application/json', body=json.dumps(RUIAN_SO), headers={'Access-Control-Allow-Origin': '*'})
        if '/cuzk/nacrt?' in u:
            return await route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                                       body=json.dumps({'ok': True, 'page': 'https://dataz.cuzk.gov.cz/gu.php?1=1', 'img': [
                                           {'url': 'https://dataz.cuzk.gov.cz/mistopis.php?id=1', 'role': 'nacrt', 'w': 265, 'h': 250},
                                           {'url': 'https://dataz.cuzk.gov.cz/mistopis.php?id=2', 'role': 'detail', 'w': 185, 'h': 200}]}))
        if 'dataz.cuzk.gov.cz/mistopis.php' in u:
            return await route.fulfill(status=200, content_type='image/png', body=PNG1)
        if 'cuzk.cz/' in u or 'cuzk.gov.cz/' in u or 'openstreetmap' in u or 'workers.dev' in u:
            return await route.abort()
    except Exception:
        pass
    try:
        await route.continue_()
    except Exception:
        pass


async def stranka(br, url, init, chyby):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)
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
        ctx, page = await stranka(br, url, boot(tarif='pro') + SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');", chyby)
        ok('0 appka nastartovala', await cekej(page, "document.body.classList.contains('app-started')"))
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        await cekej(page, "window.AGParcelaKlik && window.AGKartaBoduPlus === undefined || window.AGParcelaKlik", 20)
        await page.wait_for_timeout(1500)

        # ---- A: stavová bublina — uříznutý azimut se u téže hlášky nevrací -----------
        a = await page.evaluate("""() => new Promise(res => {
            var sp = document.getElementById('ag-sp'); if (!sp) return res({ chybi: true });
            // dlouhé upozornění z centra = pilulka se musí zkrátit (azimut/přesnost ven)
            if (!window.AGNotify) return res({ chybi: true });
            AGNotify.set('test-dlouha', { level: 'warn', text: 'GPS bez fixu už dlouho — poloha může být posunutá o desítky metrů, srovnej se na známém bodě' });
            var comp = document.getElementById('compass-debug');
            var sirky = [], n = 0;
            setTimeout(function () {
                var t = setInterval(function () {
                    comp.innerHTML = '<span class="hud-k">Az</span> ' + (100 + n) + '°';   // mirrorAz tiká 5×/s
                    sirky.push(Math.round(sp.getBoundingClientRect().width));
                    if (++n >= 14) { clearInterval(t); res({ sirky: sirky, az: !!sp.querySelector('.ag-sp-az'), txt: (sp.querySelector('.ag-sp-alert') || {}).textContent || '' }); AGNotify.clear('test-dlouha'); }
                }, 220);
            }, 900);
        })""")
        if a.get('chybi'):
            ok('A1 bublina existuje', False, a)
        else:
            posledni = a['sirky'][4:]
            ok('A1 šířka pilulky s dlouhou hláškou se během tiků azimutu NEMĚNÍ', max(posledni) - min(posledni) <= 2, a)
            ok('A2 hláška v pilulce zůstala', 'GPS bez fixu' in a['txt'], a)

        # ---- B: nástroje viditelné v seznamu úkonů --------------------------------------
        await page.evaluate("() => { if (typeof openToolsModal === 'function') openToolsModal(); else { var m=document.getElementById('tools-modal'); if(m) m.style.display='block'; } }")
        await page.wait_for_timeout(2000)
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(1200)
        b = await page.evaluate("""() => { var rows = {}; document.querySelectorAll('#tools-modal .ag-uk-i').forEach(function (r) { var k = r.getAttribute('data-k'); if (k) rows[k] = (r.querySelector('small') || {}).textContent || ''; }); return rows; }""")
        ok('B1 Oměrné jsou v seznamu úkonů (nová instalace je už neschovává)', 'openCheckDist' in b, list(b.keys())[:30])
        ok('B2 Stopa trasy je v seznamu úkonů', 'track-log' in b)
        # (v330: kalibrace chůzí po hraně a posun na známý bod odešly do sekce „Přesné měření" —
        #  rozcestník vypisuje zbylé položky, viz scripts/test_presne_mereni.py)
        ok('B3 řádek „Srovnat jinak" vypisuje své položky živě (podle Slunce), bez Helmerta', 'srovnat-sever' in b and 'slunce' in b['srovnat-sever'].lower() and 'Helmert' not in b['srovnat-sever'], b.get('srovnat-sever'))
        ok('B3b kalibrace chůzí po hraně je řádek sekce Přesné měření', 'kalibrace-hranou' in b, list(b.keys())[:40])
        ok('B4 řádek „Podklady a katastr" vypisuje stažení okresu', 'podklady-katastr' in b and 'okres' in b['podklady-katastr'], b.get('podklady-katastr'))
        ok('B5 řádek „Počasí a světlo" vypisuje Dnešek v terénu', 'pocasi-svetlo' in b and 'dnešek v terénu' in b['pocasi-svetlo'], b.get('pocasi-svetlo'))
        ok('B6 Lovci bodů bez Pokémon Go', 'lovci-bodu' in b and 'Pok' not in b['lovci-bodu'], b.get('lovci-bodu'))
        await page.evaluate("() => { var m = document.getElementById('tools-modal'); if (m) m.style.display = 'none'; }")

        # ---- C: klik do parcely -----------------------------------------------------------
        await cekej(page, "window.AGParcelaKlik", 20)
        # bez katastru: klik do prázdna nic neotevře
        await page.evaluate("() => { visSettings.showKatastr = false; map.fire('click', { latlng: L.latLng(%f, %f), originalEvent: { clientX: 195, clientY: 500 } }); }" % (LAT + 0.0002, LNG + 0.0002))
        await page.wait_for_timeout(800)
        c0 = await page.evaluate("() => { var m = document.getElementById('ag-pcl-modal'); return m ? m.style.display : 'none'; }")
        ok('C0 bez katastrální mapy klik do prázdna kartu parcely NEotevře', c0 != 'flex', c0)
        await page.evaluate("() => { visSettings.showKatastr = true; map.fire('click', { latlng: L.latLng(%f, %f), originalEvent: { clientX: 195, clientY: 500 } }); }" % (LAT + 0.0002, LNG + 0.0002))
        await cekej(page, "document.querySelector('#ag-pcl-modal .agpk-row')", 20)
        c = await page.evaluate("""() => { var m = document.getElementById('ag-pcl-modal'); if (!m) return null; return { disp: m.style.display, title: m.querySelector('#agpk-title').textContent, sub: m.querySelector('#agpk-sub').textContent, body: m.querySelector('#agpk-body').textContent, acts: Array.from(m.querySelectorAll('#agpk-acts button')).map(b => b.textContent), poly: !!document.querySelector('path.ag-pcl-poly') }; }""")
        ok('C1 s katastrální mapou se otevře karta parcely 4079/1', c and c['disp'] == 'flex' and 'Parcela 4079/1' in c['title'], c)
        ok('C2 k.ú. a obec z RÚIAN', c and 'Vinohrady' in c['sub'] and '727164' in c['sub'] and 'Praha' in c['sub'], c and c['sub'])
        ok('C3 výměra, druh pozemku, způsob využití podle číselníků', c and '16 239' in c['body'] and 'ostatní plocha' in c['body'] and 'ostatní komunikace' in c['body'], c and c['body'][:300])
        ok('C4 budova z RÚIAN (č.p. 77, bytový dům, 7 podlaží)', c and 'č.p. 77' in c['body'] and 'bytový dům' in c['body'] and '487' in c['body'], c and c['body'][:400])
        ok('C5 tlačítko na vlastníka (Nahlížení do KN)', c and any('Vlastník' in x for x in c['acts']), c and c['acts'])
        ok('C6 obrys parcely zvýrazněn v mapě', c and c['poly'], c and c['poly'])
        u = await page.evaluate("() => AGParcelaKlik.nahlizeniUrl(%f, %f)" % (LAT, LNG))
        m = re.search(r'MapaIdentifikace\.aspx\?l=KN&x=(-?\d+(?:\.\d+)?)&y=(-?\d+(?:\.\d+)?)', u or '')
        ok('C7 odkaz do Nahlížení = S-JTSK se záporným znaménkem (x=−Y, y=−X)', m and -760000 < float(m.group(1)) < -720000 and -1060000 < float(m.group(2)) < -1030000, u)
        await page.evaluate("() => AGParcelaKlik.close()")
        c8 = await page.evaluate("() => ({ disp: document.getElementById('ag-pcl-modal').style.display, poly: !!document.querySelector('path.ag-pcl-poly') })")
        ok('C8 zavření karty sundá zvýraznění z mapy', c8['disp'] == 'none' and not c8['poly'], c8)

        # ---- D: oficiální náčrt v kartě bodu -----------------------------------------
        await page.evaluate("() => { var p = arPoints.find(x => x.id === 'p_ppbp'); showDetails(p, 40); }")
        await cekej(page, "document.querySelector('#ag-kb-of img')", 25)
        d = await page.evaluate("""() => { var of = document.getElementById('ag-kb-of'); var sk = document.getElementById('ag-kb-sk'); return { imgs: of ? Array.from(of.querySelectorAll('img')).map(i => i.getAttribute('src')) : null, dva: !!(of && of.classList.contains('dva')), link: sk ? (sk.querySelector('.ag-kb-of-foot a') || {}).href : null, mapa: !!document.getElementById('ag-kb-mapa'), app: !!document.getElementById('ag-kb-app') }; }""")
        ok('D1 úřední bod: v kartě je oficiální náčrt ČÚZK (obrázek místopisu + detail)', d['imgs'] and len(d['imgs']) == 2 and 'mistopis.php?id=1' in d['imgs'][0] and d['dva'], d)
        ok('D2 odkaz na celé geodetické údaje ČÚZK zůstal', d['link'] and 'mistopis_soap_hh.asp' in d['link'], d)
        ok('D3 náčrt z appky se u úředního bodu nekreslí (jen na přepínač)', not d['mapa'] and d['app'], d)
        ls = await page.evaluate("() => { try { return Object.keys(JSON.parse(localStorage.getItem('agNacrtCuzk_v1') || '{}')).length; } catch (e) { return -1; } }")
        ok('D4 adresy náčrtu si telefon pamatuje (offline)', ls == 1, ls)
        await page.evaluate("() => document.getElementById('ag-kb-app').click()")
        await page.wait_for_timeout(600)
        d5 = await page.evaluate("() => ({ mapa: !!document.getElementById('ag-kb-mapa'), of: !!document.getElementById('ag-kb-of'), zpet: (document.getElementById('ag-kb-app') || {}).textContent || '' })")
        ok('D5 přepínač ukáže náčrt z appky a nabídne návrat', d5['mapa'] and not d5['of'] and 'oficiální' in d5['zpet'], d5)
        await page.evaluate("() => { closeBottomSheet(); var p = arPoints.find(x => x.id === 'p_vlastni'); showDetails(p, 40); }")
        await page.wait_for_timeout(900)
        d6 = await page.evaluate("() => ({ mapa: !!document.getElementById('ag-kb-mapa'), of: !!document.getElementById('ag-kb-of') })")
        ok('D6 vlastní bod: dál náčrt z appky', d6['mapa'] and not d6['of'], d6)
        await page.evaluate("() => closeBottomSheet()")

        # ---- D7–D10: karta bodu bez rozbalovátka „všechny úřední záznamy" (15. 9. večer) ------
        # Surový výpis rawData karta neukazuje — všechno z polí BodovaPole už má nahoře; jediné,
        # co tam bylo navíc (mapový list ZM50 / SMO-5), teď dává agCuzkKartaRows.
        d7 = await page.evaluate("""() => { var p = arPoints.find(x => x.id === 'p_ppbp'); showDetails(p, 40); var b = document.getElementById('det-body'); return { details: !!b.querySelector('details'), txt: b.textContent }; }""")
        ok('D7 karta úředního bodu už nemá rozbalovátko „Zobrazit všechny úřední záznamy"', not d7['details'] and 'úřední záznamy' not in d7['txt'] and 'Stabilizace' not in d7['txt'], d7['txt'][:200])
        await page.evaluate("() => closeBottomSheet()")
        d8 = await page.evaluate("""() => { var pt = agCuzkBod(18, { ZTLTL: '1425', CISLO: 19, PL: 0, DRUH: 'TB', Y: '  744233.46', X: ' 1042459.18', VYSKA: '   348.41', B: null, L: null, HEL: null, GPS: null, GEODETICKE_UDAJE: 'https://geoportal.cuzk.cz/mistopis2/mistopis_soap_hh.asp?NAME=BP_TB&TYP=TB&HID=x', NAZEV_OKRES: 'Hlavní město Praha', NAZEV_KU: 'Hradčany', ZM50: ' 1224', NAZEV_SMO5: 'PRAHA 7-1', CISLO_SMO5: '60771', TYPV: 0, OBJECTID: 2597, ID: 2597 }, 14.4, 50.09, 40, null); return { zm50: pt.zm50, smo5: pt.smo5, rows: agCuzkKartaRows(pt) }; }""")
        ok('D8 agCuzkBod vytáhne mapový list (ZM50 bez mezery, SMO-5 název + číslo)', d8['zm50'] == '1224' and d8['smo5'] == 'PRAHA 7-1 (60771)', d8)
        ok('D9 řádek „Mapový list" v kartě bodu', 'Mapový list' in d8['rows'] and 'ZM50 1224' in d8['rows'] and 'SMO-5 PRAHA 7-1 (60771)' in d8['rows'], d8['rows'][-300:])
        d10 = await page.evaluate("""() => { var pt = agCuzkBod(42, { OBJECTID: 1627, ID: 1627, CISLO_KU: 729272, CISLO: 1034, Y: '  744558.83', X: ' 1041866.44', VYSKA: null, PRESNOST: 3, GEODETICKE_UDAJE: 'https://x/', NAZEV_OKRES: 'Hlavní město Praha', NAZEV_KU: 'Dejvice', CISLO_SMO5: 60770 }, 14.4, 50.09, 40, null); return { zm50: pt.zm50, smo5: pt.smo5, rows: agCuzkKartaRows(pt) }; }""")
        ok('D10 PPBP: jen číslo SMO-5 (bez ZM50), číselné pole přežije', d10['zm50'] is None and d10['smo5'] == '60770' and 'SMO-5 60770' in d10['rows'] and 'ZM50' not in d10['rows'], d10)

        # ---- E: texty a ikony ---------------------------------------------------------
        for f in ['js/tools-registry.js', 'data/navody.json', 'data/co-je-noveho.json', 'js/oblasti-offline.js']:
            s = io.open(os.path.join(ROOT, f), encoding='utf-8').read()
            s = '\n'.join(l for l in s.split('\n') if not l.strip().startswith('//'))
            ok('E1 bez „Pokémon" v ' + f, 'okémon' not in s and 'okemon' not in s.lower())
        emo = re.compile(u'[\U0001F300-\U0001FAFF]')
        for f in ['js/akusticky-dalkomer.js', 'js/kalibrace-hranou.js', 'js/dgps.js', 'js/lovci-bodu.js', 'js/oblasti-offline.js', 'js/parcela-klik.js']:
            s = io.open(os.path.join(ROOT, f), encoding='utf-8').read()
            s = '\n'.join(l for l in s.split('\n') if not l.strip().startswith('//'))
            ok('E2 bez emoji v ' + f, not emo.search(s), [m.group(0) for m in emo.finditer(s)][:5])
        ih = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
        ok('E3 sprite má i-sound / i-stop / i-map', all(('symbol id="i-%s"' % k) in ih for k in ('sound', 'stop', 'map')))
        wk = io.open(os.path.join(ROOT, 'cloud', 'worker.js'), encoding='utf-8').read()
        ok('E4 worker: /cuzk/nacrt + v ≥ 25', "path === '/cuzk/nacrt'" in wk and int(re.search(r"v: (\d+),", wk).group(1)) >= 25)
        sw = io.open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
        ok('E5 service worker drží náčrty ČÚZK v TILE_CACHE', "dataz.cuzk.gov.cz" in sw and "bodovapole.cuzk.gov.cz" in sw)

        vazne = [c for c in chyby if 'favicon' not in c and 'net::ERR' not in c and '404' not in c and 'tile.openstreetmap' not in c and '/owner/' not in c and '403' not in c and 'Failed to fetch' not in c and 'ERR_FAILED' not in c]
        ok('Z bez chyb stránky', not vazne, vazne[:5])
        await ctx.close()
        await br.close()


def main():
    srv, url = server(PORT)
    if not srv:
        print('CHYBA server se nespustil'); sys.exit(2)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    sys.exit(1 if spatne else 0)


if __name__ == '__main__':
    main()
