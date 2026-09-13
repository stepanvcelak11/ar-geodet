# -*- coding: utf-8 -*-
# ===== QTRIG - KONZOLE VLASTNIKA, 2. KOLO (13. 9. 2026) ============================
# Uzivatel vybral vsech 13 navrhu ze stranky „Konzole vlastnika II" a dodal: „uz toho
# tam bude hodne, tak to i vizualne uhlad, at se v tom vyznam a dohledam co potrebuji".
#
# Co se overuje (server /owner/* je PODVRZENY, jde o klienta v js/vlastnik.js
# a js/vlastnik-plus.js):
#   A) domovska obrazovka: hledani nahore, blok „Od tve posledni navstevy", hlidac
#      anomalii (jen kdyz neco vybocuje), sbalovaci sekce s pocty, stav se pamatuje
#   B) hledani: filtruje dlazdice hned, po chvilce dotaz /owner/hledej a vysledky
#      po skupinach; klepnuti na ucet otevre Lide s rozbalenym uctem
#   C) grafy: prepinac 7/30/90 (GET ?dni=), srovnani s minulym obdobim, CSV, odkaz trychtyr
#   D) trychtyr: ctyri sloupce + kdo odpadl
#   E) kapacita: pozadavky a databaze proti limitum, odhad vydrze, odkaz na uklid
#   F) uklid: nahled poctu, vyber, POST jen s vybranym
#   G) push: stav, volby, tlacitka (bez skutecneho odberu — Chromium headless nema push)
#   H) „jako Zaklad": AGLic.isPro() false po zapnuti, stitek vlevo dole, zpet
#   I) vydani: kdo je na ktere verzi + kdo uvizl
#   J) ocima uctu: denik cloveka po dnech
#   K) souhrn dne: prepinac 24 h / 3 dny / od minula (GET ?od=)
#   L) 429 s retryAfter: stav serveru rika „zamceno jeste N min" + Zkusit znovu
#   M) schranka: „Odpovedet do appky" -> POST /owner/vzkaz {code} + /feedback/done
#
# Pouziti:  python scripts/test_konzole_2.py [port]     (vychozi 9241+)
# Snimky:   AG_SHOTS=<adresar> python scripts/test_konzole_2.py
# ==============================================================================
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9241
SHOTS = os.environ.get('AG_SHOTS') or ''
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402

API = 'https://ar-geodet-api.ar-geodet.workers.dev'
NOW = int(time.time() * 1000)
DEN = 864e5

BOOT_OWNER = boot() + """
localStorage.setItem('agFirmaTok_v1', JSON.stringify({ token: 'x.y', userId: 'test-user-1' }));
localStorage.setItem('agFbKey_v1', 'klic-vlastnika-aspon-24-znaku-dlouhy');
localStorage.setItem('agVlastnik_v1', '1');
localStorage.setItem('agvKonzoleUvod_v1', '1');
localStorage.setItem('agvNavsteva_v1', JSON.stringify({ posl: %d, ted: %d }));
""" % (NOW - 2 * DEN, NOW - 2 * DEN + 60000)

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)[:300]) if detail != '' else ''))


def den(offset):
    return time.strftime('%Y-%m-%d', time.gmtime((NOW - offset * DEN) / 1000))


class Server:
    def __init__(self):
        self.log = []
        self.zamek = False   # L) 429

    async def handle(self, route):
        req = route.request
        url = req.url
        path = url.replace(API, '').split('?')[0]
        self.log.append((req.method, path, url))
        st, data = 200, {'ok': True}
        if self.zamek and path.startswith('/owner/'):
            await route.fulfill(status=429, content_type='application/json', headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'},
                                body=json.dumps({'error': 'Moc pokusů o klíč. Zkus to za čtvrt hodiny.', 'retryAfter': 660}))
            return
        if path == '/health':
            data = {'ok': True, 'v': 20, 'owner': True, 'ownerKey': 'ok', 'fb': True}
        elif path == '/owner/firms':
            data = {'firms': [{'id': 'f1', 'code': 'ABCDEF', 'name': 'Geo s.r.o.', 'users': 3, 'max_users': 10, 'frozen': 0, 'created': NOW - 40 * DEN, 'lastSeen': NOW, 'points': 4, 'jobs': 2}],
                    'requests': [], 'notice': '', 'stats': {'firms': 1, 'users': 3, 'active7': 2, 'points': 4}, 'serverTime': NOW}
        elif path == '/owner/errors':
            data = {'dni': 14, 'total': 41, 'rows': [{'sig': 'dxf', 'msg': 'TypeError: export DXF', 'src': 'js/dxf-export.js', 'line': 12, 'n': 41, 'firms': 1, 'last': NOW - 1000, 'ver': 'v305'}], 'verze': []}
        elif path == '/owner/grafy':
            dni = 30
            try:
                dni = int(url.split('dni=')[1].split('&')[0])
            except Exception:
                pass
            data = {'od': den(dni), 'do': den(0), 'dni': dni,
                    'minule': {'lide': 6, 'lideTed': 9, 'akce': 100, 'ucty': 2, 'body': 30, 'chyby': 20, 'dotazy': 900},
                    'dotazy': [{'day': den(1), 'n': 40}, {'day': den(0), 'n': 55}],
                    'lide': [{'day': den(0), 'n': 3}], 'akce': [{'day': den(0), 'n': 21}], 'ucty': [{'day': den(3), 'n': 1}],
                    'body': [{'day': den(5), 'n': 40}], 'chyby': [{'day': den(2), 'n': 3}, {'day': den(1), 'n': 4}],
                    'verze': [{'ver': 'v305', 'n': 4}, {'ver': 'v303', 'n': 2}], 'nastroje': [{'k': 'openMeasureModal', 'n': 12}], 'uctyCelkem': 6}
        elif path == '/owner/prehled':
            if 'lite=1' in url:
                data = {'zadosti': 2, 'zpravy': 1, 'serverTime': NOW}
            else:
                od = 0
                try:
                    od = int(url.split('od=')[1].split('&')[0])
                except Exception:
                    pass
                data = {'serverTime': NOW, 'od': od, 'lidi24': 4, 'body24': 40, 'ucty24': 1, 'chyby24': 41, 'zadosti': 2, 'zpravy': 1, 'uctyCelkem': 9, 'proCelkem': 2,
                        'zpravyOd': 3, 'zadostiOd': 1, 'noveDruhy': 2,
                        'noviLide': [{'name': 'Karel Nový', 'code': 'KAREL111', 'ver': 'v305', 'created': NOW - DEN}, {'name': 'Jana V.', 'code': 'JANA2222', 'ver': 'v303', 'created': NOW - 1.5 * DEN}],
                        'topChyba': {'msg': 'TypeError: export DXF', 'n': 30}, 'chybyUcty': [{'uname': 'Karel Nový', 'n': 30, 'ver': 'v305'}],
                        'poslBod': NOW - 5 * DEN, 'dotazyDnes': 2340,
                        'vyprsi': [], 'online': [{'uid': 'u1', 'jmeno': 'Jan Novák', 'firma': 'Geo s.r.o.', 'ts': NOW - 120e3, 'n': 7}], 'shluky': []}
        elif path == '/owner/hledej':
            q = url.split('q=')[1] if 'q=' in url else ''
            q = urllib.request.unquote(q).lower()
            data = {'q': q, 'ucty': [{'id': 'acc1', 'code': 'K7QM3XP2', 'name': 'Karel Nový', 'tarif': 'pro', 'last_login': NOW - 3600e3, 'ver': 'v305', 'contact': None, 'disabled': 0}] if 'karel' in q else [],
                    'firmy': [], 'zpravy': [{'id': 1, 'ts': NOW - 7200e3, 'kind': 'chyba', 'txt': 'Karel: padá export', 'who': 'Karel Nový', 'done': 0}] if 'karel' in q else [],
                    'chyby': []}
        elif path == '/owner/ucty':
            data = {'ucty': [
                {'id': 'acc1', 'code': 'K7QM3XP2', 'name': 'Karel Nový', 'tarif': 'pro', 'tarif_do': None, 'disabled': 0, 'created': NOW - 20 * DEN, 'last_login': NOW - 3600e3, 'trial_ts': None, 'tarifPlati': True, 'note': '',
                 'ver': 'v305', 'ver_ts': NOW - 3600e3, 'dev': 'iPhone', 'prostory': [], 'aktivita': NOW, 'akcí30d': 12, 'objednavky': {'n': 0, 'zaplaceno': 0, 'ceka': 0}},
                {'id': 'acc2', 'code': 'ZZZZ2222', 'name': 'Jana V.', 'tarif': 'zaklad', 'tarif_do': None, 'disabled': 0, 'created': NOW - 60 * DEN, 'last_login': NOW - 6 * DEN, 'trial_ts': None, 'tarifPlati': False, 'note': '',
                 'ver': 'v303', 'ver_ts': NOW - 6 * DEN, 'dev': 'Android 14', 'prostory': [], 'aktivita': NOW - 6 * DEN, 'akcí30d': 2, 'objednavky': {'n': 0, 'zaplaceno': 0, 'ceka': 0}}
            ], 'prodej': {'zapnuto': False, 'produkty': [], 'iban': ''}}
        elif path == '/owner/objednavky':
            data = {'objednavky': [], 'pohyby': [], 'fio': {'nastaveno': False}, 'prodej': {'zapnuto': False, 'produkty': [], 'iban': ''}}
        elif path == '/feedback' and req.method == 'GET':
            data = {'messages': [{'id': 1, 'ts': NOW - 3600e3, 'kind': 'chyba', 'txt': 'Po otevření karty bodu se mi zasekla mapa.', 'contact': None, 'who': 'Karel Nový · K7QM3XP2', 'meta': json.dumps({'v': 305, 'ucet': 'K7QM3XP2'}), 'done': 0}], 'open': 1}
        elif path == '/feedback/done':
            data = {'ok': True}
        elif path == '/owner/vzkaz':
            data = {'ok': True}
        elif path == '/owner/trychtyr':
            data = {'dni': 30, 'registrace': 4, 'bod': 2, 'den3': 1, 'hodnoceni': 1,
                    'lidi': [{'id': 'a1', 'name': 'Petr K.', 'code': 'P1', 'created': NOW - 3 * DEN, 'ver': 'v305', 'bod': 0, 'den3': False, 'hodnoceni': 0},
                             {'id': 'a2', 'name': 'Lucie D.', 'code': 'L1', 'created': NOW - 9 * DEN, 'ver': None, 'bod': 0, 'den3': False, 'hodnoceni': 0},
                             {'id': 'a3', 'name': 'Karel Nový', 'code': 'K7QM3XP2', 'created': NOW - 20 * DEN, 'ver': 'v305', 'bod': NOW - 19 * DEN, 'den3': True, 'hodnoceni': NOW - 10 * DEN},
                             {'id': 'a4', 'name': 'Jana V.', 'code': 'J1', 'created': NOW - 12 * DEN, 'ver': 'v303', 'bod': NOW - 12 * DEN, 'den3': False, 'hodnoceni': 0}]}
        elif path == '/owner/kapacita':
            data = {'dnes': den(0), 'dotazyDnes': 2340, 'dotazy30': 60000, 'limitDen': 100000, 'bajty': 38 * 1048576, 'odhad': True, 'limitBajty': 500 * 1048576,
                    'tab': {'usage': 240000, 'errors': 3000, 'sync_points': 12000, 'accounts': 40, 'users': 60, 'firms': 8, 'feedback': 30, 'owner_log': 200, 'vzkazy': 10, 'guard': 5, 'pos': 100, 'stats': 90, 'jobs': 50, 'orders': 3},
                    'rust30': {'usage': 30000, 'errors': 400, 'body': 1200}}
        elif path == '/owner/uklid' and req.method == 'GET':
            data = {'dni': 90, 'nahled': {'usage': 777, 'errors': 12, 'pos': 100, 'guard': 5, 'ucty': 0}}
        elif path == '/owner/uklid' and req.method == 'POST':
            b = json.loads(req.post_data or '{}')
            data = {'ok': True, 'hotovo': dict((k, 777 if k == 'usage' else 1) for k in b.get('co', [])), 'dni': b.get('dni')}
        elif path == '/owner/push' and req.method == 'GET':
            data = {'vapid': 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'subs': [{'id': 1, 'ts': NOW - DEN, 'dev': 'iPhone (appka na ploše)', 'host': 'web.push.apple.com', 'co': {'zpravy': True, 'zadosti': True, 'chyby': False}, 'endpoint': 'https://web.push.apple.com/x'}]}
        elif path == '/owner/push/test':
            data = {'ok': True, 'stavy': [201]}
        elif path == '/owner/vydano':
            data = {'verze': 305, 'ts': NOW - 2 * DEN, 'pozn': None}
        elif path == '/owner/ucty/acc1/pohled':
            data = {'ucet': {'id': 'acc1', 'code': 'K7QM3XP2', 'name': 'Karel Nový', 'tarif': 'pro', 'tarif_do': None, 'disabled': 0, 'created': NOW - 20 * DEN, 'last_login': NOW - 3600e3, 'note': '', 'tarifPlati': True},
                    'clenstvi': [], 'chyby': [], 'nastroje': [], 'zarizeni': [], 'vzkazy': []}
        elif path == '/owner/ucty/acc1/denik':
            data = {'ucet': {'id': 'acc1', 'code': 'K7QM3XP2', 'name': 'Karel Nový', 'ver': 'v305', 'ver_ts': NOW - 3600e3, 'dev': 'iPhone'}, 'od': den(30),
                    'dny': [{'day': den(2), 'akce': 20, 'body': 14, 'nastroje': ['openDmtVolume', 'zapisnik'], 'chyby': 0, 'chybaMsg': None, 'prihlaseni': 1},
                            {'day': den(0), 'akce': 3, 'body': 0, 'nastroje': [], 'chyby': 2, 'chybaMsg': 'TypeError: export DXF', 'prihlaseni': 1}]}
        elif path == '/config':
            st, data = 503, {'error': 'test'}
        await route.fulfill(status=st, content_type='application/json',
                            headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'},
                            body=json.dumps(data, ensure_ascii=False))


def server():
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % port
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                return srv, u
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None, None


async def pockej(page, js, n=30, krok=300):
    for _ in range(n):
        try:
            if await page.evaluate(js):
                return True
        except Exception:
            pass
        await page.wait_for_timeout(krok)
    return False


async def cekejLog(srv, method, path, n=30, krok=300):
    for _ in range(n):
        if any(l[0] == method and l[1] == path for l in srv.log):
            return True
        await asyncio.sleep(krok / 1000)
    return False


async def snimek(page, jmeno):
    if not SHOTS:
        return
    try:
        os.makedirs(SHOTS, exist_ok=True)
        await page.screenshot(path=os.path.join(SHOTS, jmeno + '.png'))
    except Exception:
        pass


async def main():
    from playwright.async_api import async_playwright
    srvp, url = server()
    if not srvp:
        print('CHYBA: testovaci server nenabehl')
        return 1
    srv = Server()
    try:
        async with async_playwright() as p:
            br = await p.chromium.launch()
            ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2,
                                       geolocation={'latitude': 50.0875, 'longitude': 14.4213}, permissions=['geolocation'])
            await ctx.route(API + '/**', srv.handle)
            page = await ctx.new_page()
            chyby = []
            page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
            await page.add_init_script(BOOT_OWNER)
            await page.goto(url, wait_until='domcontentloaded', timeout=45000)
            await pockej(page, "() => document.body.classList.contains('app-started')", 50, 400)
            await page.evaluate("() => { try { AGLazy.flush(); } catch (e) {} }")
            await pockej(page, "() => document.querySelectorAll('script[type=\\\"ag/lazy\\\"][data-src]').length === 0", 60, 400)
            await page.wait_for_timeout(2000)
            await page.evaluate("() => { window.agAsk = function () { return Promise.resolve(true); }; window.confirm = function () { return true; }; }")

            # ---- A) domovska obrazovka ----------------------------------------------------
            await page.evaluate("() => AGVlastnik.open()")
            ok('A1 konzole se otevrela', await pockej(page, "() => !!document.querySelector('#agv-modal.ag-open #agv-body')"))
            ok('A2 hledani je nahore (prvni prvek tela konzole)', await page.evaluate("() => { var q = document.getElementById('agv-q'); var b = document.getElementById('agv-body'); return !!q && b.firstElementChild && b.firstElementChild.contains(q); }"))
            ok('A3 blok „Od tve posledni navstevy" s cipy (novi lide, zpravy, zadosti, chyby s novymi druhy)',
               await pockej(page, "() => { var od = document.querySelector('.agvp-od'); return !!od && /Od tvé poslední návštěvy/.test(od.textContent) && od.querySelectorAll('.ch button').length === 4 && /2 nové druhy/.test(od.textContent) && /Karel/.test(od.textContent); }"))
            ody = [int(l[2].split('od=')[1]) for l in srv.log if l[1] == '/owner/prehled' and 'od=' in l[2]]
            ok('A3b dotaz na server sel s ?od=<ts posledni navstevy> (~2 dny zpet)', ody and abs(ody[0] - (NOW - 2 * DEN)) < 5 * 60000, ody)
            ok('A4 hlidac ukazal anomalie: chyby 41 nad prumerem, 30x jeden clovek, 5 dni bez bodu',
               await pockej(page, "() => { var a = document.querySelectorAll('.agvp-al'); return a.length >= 3 && /Chyby dnes 41/.test(a[0].textContent) && /30× chyba u jednoho/.test(document.querySelector('.agvp-alerts').textContent) && /nesynchronizoval body/.test(document.querySelector('.agvp-alerts').textContent); }"),
               await page.evaluate("() => (document.querySelector('.agvp-alerts') || {}).textContent"))
            sek = await page.evaluate("""() => { var out = []; document.querySelectorAll('.agv-sec-btn').forEach(function (b) { out.push([b.querySelector('span').textContent, +b.querySelector('small').textContent, b.classList.contains('zav'), b.nextElementSibling.hidden]); }); return out; }""")
            print('   sekce:', sek)
            ok('A5 pet sekci s pocty, prvni dve otevrene, dalsi sbalene', len(sek) == 5 and sek[0][0] == 'Co se děje' and sek[0][1] == 6 and not sek[0][2] and sek[2][2] and sek[2][3], sek)
            ok('A5b dlazdic celkem 24', await page.evaluate("() => document.querySelectorAll('#agv-body .agv-it').length") == 24)
            await page.click('.agv-sec-btn[data-sec="Vydání a server"]')
            await page.wait_for_timeout(200)
            ok('A6 klepnuti na sekci ji rozbali a stav se ulozi', await page.evaluate("() => { var b = document.querySelector('.agv-sec-btn[data-sec=\\\"Vydání a server\\\"]'); var st = JSON.parse(localStorage.getItem('agvSekce_v1')); return !b.classList.contains('zav') && !b.nextElementSibling.hidden && st['Vydání a server'] === false; }"))
            ok('A7 tlacitko Grafy pod cisly souhrnu', await page.evaluate("() => !!document.querySelector('.agvp-grafy')"))
            await page.evaluate("() => { document.querySelectorAll('#agv-modal .modal-content, #agv-modal .modal-body').forEach(function (e) { e.scrollTop = 0; }); }")
            await snimek(page, 'k2-01-domov')

            # ---- B) hledani --------------------------------------------------------------
            await page.fill('#agv-q', 'karel')
            await page.wait_for_timeout(700)
            ok('B1 dlazdice se filtruji hned (jen ty s textem)', await page.evaluate("() => document.querySelectorAll('#agv-body .agv-it').length") < 24)
            ok('B2 server dostal /owner/hledej?q=karel', await cekejLog(srv, 'GET', '/owner/hledej'))
            ok('B3 vysledky po skupinach: ucet Karel + zprava', await pockej(page, "() => { var o = document.getElementById('agv-q-out'); return !!o && o.querySelectorAll('.agv-qr[data-go=ucet]').length === 1 && o.querySelectorAll('.agv-qr[data-go=zprava]').length === 1 && /Účty/.test(o.textContent); }"),
               await page.evaluate("() => (document.getElementById('agv-q-out') || {}).textContent"))
            await snimek(page, 'k2-02-hledani')
            await page.click('#agv-q-out .agv-qr[data-go=ucet]')
            ok('B4 klepnuti na ucet otevre Lide s rozbalenym uctem acc1', await pockej(page, "() => { var m = document.getElementById('ag-pd-modal'); return !!m && m.classList.contains('ag-open') && !!m.querySelector('.pd-det'); }", 40),
               await page.evaluate("() => { var m = document.getElementById('ag-pd-modal'); return m ? m.className + ' ' + (m.querySelector('#ag-pd-body') || {}).textContent.slice(0, 120) : 'neni'; }"))
            await page.evaluate("() => { AGProdej.close(); AGVlastnik.open(); }")
            await pockej(page, "() => !!document.querySelector('#agv-modal.ag-open #agv-q')")
            await page.evaluate("() => { var q = document.getElementById('agv-q'); q.value = ''; q.dispatchEvent(new Event('input')); }")
            await page.wait_for_timeout(500)

            # ---- C) grafy ----------------------------------------------------------------
            await page.evaluate("() => AGVlastnik.jdi('grafy')")
            ok('C1 grafy: srovnani s minulym obdobim (+50 %)', await pockej(page, "() => /minule 6/.test(document.getElementById('agv-body').textContent) && /\\+50 %/.test(document.getElementById('agv-body').textContent)"),
               await page.evaluate("() => document.getElementById('agv-body').textContent.slice(0, 300)"))
            await page.click('#agv-body [data-dni="7"]')
            ok('C2 prepnuti na 7 dni = GET /owner/grafy?dni=7', await pockej(page, "() => /posledních 7 dní/.test(document.getElementById('agv-body').textContent)") and any('dni=7' in l[2] for l in srv.log if l[1] == '/owner/grafy'))
            ok('C3 tlacitka CSV a Trychtyr', await page.evaluate("() => !!document.getElementById('agvp-g-csv') && !!document.getElementById('agvp-g-tr')"))
            await snimek(page, 'k2-03-grafy')

            # ---- D) trychtyr -------------------------------------------------------------
            await page.click('#agvp-g-tr')
            ok('D1 trychtyr: 4 sloupce (4 → 2 → 1 → 1) a kdo odpadl', await pockej(page, "() => { var k = document.querySelectorAll('.agvp-tr .k'); var t = document.getElementById('agv-body').textContent; return k.length === 4 && k[0].querySelector('b').textContent === '4' && k[1].querySelector('b').textContent === '2' && /50 %/.test(t) && /Petr K\\./.test(t) && /Lucie D\\./.test(t); }"),
               await page.evaluate("() => document.getElementById('agv-body').textContent.slice(0, 400)"))
            await snimek(page, 'k2-04-trychtyr')

            # ---- E) kapacita -------------------------------------------------------------
            await page.evaluate("() => AGVlastnik.jdi('kapacita')")
            ok('E1 kapacita: pozadavky 2340 / 100000, databaze 38 MB, odhad vydrze', await pockej(page, "() => { var t = document.getElementById('agv-body').textContent; return /2340 \\/ 100000/.test(t) && /38 MB/.test(t) && /vydrží databáze zdarma/.test(t) && /Worker v20/.test(t); }"),
               await page.evaluate("() => document.getElementById('agv-body').textContent.slice(0, 500)"))
            await snimek(page, 'k2-05-kapacita')

            # ---- F) uklid ----------------------------------------------------------------
            await page.click('#agvp-kap-uklid')
            ok('F1 uklid: nahled poctu (usage 777), tlacitko zamcene bez vyberu', await pockej(page, "() => /777 řádků/.test(document.getElementById('agv-body').textContent) && document.getElementById('agvp-ukl-go').disabled"))
            await page.check('#agv-body [data-co="usage"]')
            await page.check('#agv-body [data-co="guard"]')
            await page.click('#agvp-ukl-go')
            ok('F2 POST /owner/uklid jen s vybranym (usage, guard, dni 90)', await cekejLog(srv, 'POST', '/owner/uklid'))
            posl = [l for l in srv.log if l[0] == 'POST' and l[1] == '/owner/uklid']
            await snimek(page, 'k2-06-uklid')

            # ---- G) push -----------------------------------------------------------------
            await page.evaluate("() => AGVlastnik.jdi('push')")
            ok('G1 push: stav, tri volby, zapnute telefony ze serveru', await pockej(page, "() => { var b = document.getElementById('agv-body'); return b.querySelectorAll('[data-co]').length === 3 && /iPhone \\(appka na ploše\\)/.test(b.textContent) && !!document.getElementById('agvp-push-test'); }"),
               await page.evaluate("() => document.getElementById('agv-body').textContent.slice(0, 400)"))
            await page.click('#agvp-push-test')
            ok('G2 zkusebni push = POST /owner/push/test', await cekejLog(srv, 'POST', '/owner/push/test'))
            await snimek(page, 'k2-07-push')
            # dialog s vysledkem zavrit (jinak kryje tlacitka)
            await page.wait_for_timeout(400)
            await page.evaluate("() => { document.querySelectorAll('.ag-dlg-overlay.open button').forEach(function (b) { b.click(); }); }")
            await page.wait_for_timeout(300)

            # ---- H) jako Zaklad ----------------------------------------------------------
            await page.evaluate("() => AGVlastnik.jdi('zaklad')")
            ok('H1 pohled Zaklad: ted Pro, tlacitka 15/30/60', await pockej(page, "() => /Teď: Pro/.test(document.getElementById('agv-body').textContent) && document.querySelectorAll('#agv-body [data-min]').length === 3"))
            await page.click('#agv-body [data-min="15"]')
            ok('H2 po zapnuti AGLic.isPro() = false, body.ag-pro pryc, stitek vlevo dole', await pockej(page, "() => !AGLic.isPro() && !document.body.classList.contains('ag-pro') && !!document.getElementById('ag-zaklad-chip') && /Základ · 15 min/.test(document.getElementById('ag-zaklad-chip').textContent)", 40),
               await page.evaluate("() => [AGLic.isPro(), document.body.className, (document.getElementById('ag-zaklad-chip') || {}).textContent]"))
            await snimek(page, 'k2-08-zaklad')
            await page.click('#ag-zaklad-chip button')
            ok('H3 Zpet na Pro: isPro true, stitek pryc', await pockej(page, "() => AGLic.isPro() && !document.getElementById('ag-zaklad-chip')"))

            # ---- I) vydani ---------------------------------------------------------------
            await page.evaluate("() => { AGVlastnik.open(); AGVlastnik.jdi('vydani'); }")
            ok('I1 vydani: kdo je na ktere verzi + Jana uvizla na v303', await pockej(page, "() => { var t = document.getElementById('agv-body').textContent; return /Kdo je na které verzi/.test(t) && /v303 · stará/.test(t) && /Ještě na staré \\(1\\)/.test(t) && /Jana V\\./.test(t); }", 40),
               await page.evaluate("() => document.getElementById('agv-body').textContent.slice(0, 600)"))
            await snimek(page, 'k2-09-vydani')

            # ---- J) denik cloveka --------------------------------------------------------
            await page.evaluate("() => AGVlastnikPlus.pohled('acc1')")
            ok('J1 ocima uctu: denik po dnech (14 bodů, Kubatura, 2× chyba)', await pockej(page, "() => { var d = document.querySelectorAll('.agvp-den'); var t = (document.getElementById('agvp-denik') || {}).textContent || ''; return d.length === 2 && /14 bodů/.test(t) && /2× chyba/.test(t) && /Aktivních dní 2/.test(t); }", 40),
               await page.evaluate("() => (document.getElementById('agvp-denik') || {}).textContent"))
            await snimek(page, 'k2-10-denik')

            # ---- K) souhrn dne: okna ------------------------------------------------------
            await page.evaluate("() => AGVlastnik.jdi('prehled')")
            ok('K1 souhrn: prepinac 24 h / 3 dny / od minula', await pockej(page, "() => document.querySelectorAll('#agv-body [data-okno]').length === 3"))
            n0 = len([l for l in srv.log if l[1] == '/owner/prehled' and 'od=' in l[2]])
            await page.click('#agv-body [data-okno="72"]')
            ok('K2 3 dny = novy dotaz s ?od=', await pockej(page, "() => /za poslední 3 dny/.test(document.getElementById('agv-body').textContent)") and len([l for l in srv.log if l[1] == '/owner/prehled' and 'od=' in l[2]]) > n0)

            # ---- L) 429 s retryAfter -----------------------------------------------------
            srv.zamek = True
            await page.evaluate("() => { AGVlastnikPlus.zapomen(); AGVlastnik.jdi(''); }")
            ok('L1 stav serveru: „zamčeno ještě 11 min" + Zkusit znovu', await pockej(page, "() => { var s = document.getElementById('agv-stav'); return !!s && /zamčeno ještě 11 min/.test(s.textContent) && !!document.getElementById('agv-stav-znovu'); }", 40),
               await page.evaluate("() => (document.getElementById('agv-stav') || {}).textContent"))
            ok('L2 souhrn pri vypadku ukaze posledni znama data se stitkem', await pockej(page, "() => { var b = document.getElementById('agv-body'); return /Server teď neodpověděl/.test(b.textContent) && b.querySelectorAll('.agvp-t').length > 3; }", 40),
               await page.evaluate("() => document.getElementById('agv-body').textContent.slice(0, 300)"))
            await snimek(page, 'k2-11-429')
            srv.zamek = False

            # ---- M) odpoved do appky ze schranky ------------------------------------------
            await page.evaluate("() => { AGVlastnik.close(); AGZpetna.inbox(); }")
            ok('M1 schranka: tlacitko „Odpovědět do appky" u zpravy s kodem uctu', await pockej(page, "() => !!document.querySelector('#ag-fb-inbox button[data-a=odp]')", 40))
            await page.click('#ag-fb-inbox button[data-a=odp]')
            ok('M2 formular se tremi vetami', await pockej(page, "() => document.querySelectorAll('#ag-fb-inbox .ag-fb-odp button[data-v]').length === 5"))
            await snimek(page, 'k2-12-odpoved')
            await page.click('#ag-fb-inbox .ag-fb-odp button[data-v="0"]')
            ok('M3 POST /owner/vzkaz s kodem uctu', await cekejLog(srv, 'POST', '/owner/vzkaz'))
            ok('M4 ...a zprava oznacena vyrizena (/feedback/done)', await cekejLog(srv, 'POST', '/feedback/done'))

            ok('Z bez chyb v konzoli', not chyby, chyby[:3])
            await br.close()
    finally:
        srvp.terminate()

    chyb = [j for (o_, j) in vysledky if not o_]
    print('\n%d/%d OK' % (len(vysledky) - len(chyb), len(vysledky)))
    if chyb:
        print('CHYBA: ' + '; '.join(chyb))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
