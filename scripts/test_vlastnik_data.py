# -*- coding: utf-8 -*-
# ===== QTRIG - VLASTNIK: VIDITELNE VSTUPY + STAZENI DAT FIRMY (12. 9. 2026) =====
# Hlaseni uzivatele: „dej tu konzoli po mem prihlaseni do nastaveni/vice/nastroje,
# abych to dokazal najit" a „z jakekoliv firmy si stahnout data a dat si je k sobe
# do aplikace (napriklad vytvorene body)".
#
# Co se overuje (server /owner/* je PODVRZENY, jde o klienta):
#   A) v rezimu vlastnika je vstup do konzole v Nastaveni (pod zalozkami), v Nastrojich
#      (nahore + sekce „Vlastnik aplikace" v seznamu ukonu) i ve Vice
#   B) bez rezimu vlastnika tam nic z toho neni
#   D) Face ID vlastnika: po prihlaseni klicem nabidka, zapnuti (virtualni WebAuthn
#      autentikator pres CDP), po restartu zlate tlacitko na prihlaseni -> vstup bez klice
#   E) „Prepnout firmu" na prihlasovaci obrazovce: ulozene profily telefonu
#   C) Vsechny firmy -> detail -> „Stahnout body do me appky" -> GET /owner/firms/:id/data
#      -> vyber zakazek -> „Ulozit vsechny" vyrobi mistni zakazky „Firma · Zakazka"
#      a body do nich (dedup podle id pri opakovanem stazeni; do AKTIVNI zakazky pres
#      addImportedPoints)
#
# Pouziti:  python scripts/test_vlastnik_data.py [port]     (vychozi 8991+)
# ==============================================================================
import asyncio
import io
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8993
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402

API = 'https://ar-geodet-api.ar-geodet.workers.dev'
NOW = int(time.time() * 1000)

BOOT_OWNER = boot() + """
localStorage.setItem('agFirmaTok_v1', JSON.stringify({ token: 'x.y', userId: 'test-user-1' }));
localStorage.setItem('agFbKey_v1', 'klic-vlastnika-aspon-24-znaku-dlouhy');
localStorage.setItem('agVlastnik_v1', '1');
"""
BOOT_PLAIN = boot() + "localStorage.removeItem('agVlastnik_v1'); localStorage.removeItem('agFbKey_v1');"

FIRMA = {'id': 'f1', 'code': 'ABCDEF', 'name': 'Geo s.r.o.'}
DATA = {
    'firm': FIRMA,
    'jobs': [
        {'key': 'pole u lesa', 'name': 'Pole u lesa', 'deleted': False, 'points': [
            {'id': 'cp_1', 'name': '101', 'lat': 50.09, 'lng': 14.42, 'vyska': 210.5, 'kod': 'obruba', 'ts': NOW, 'uname': 'Jan'},
            {'id': 'cp_2', 'name': '102', 'lat': 50.091, 'lng': 14.421, 'ts': NOW, 'uname': 'Jan'},
            {'id': 'cp_3', 'name': '103', 'lat': 50.092, 'lng': 14.422, 'acc': 1.2, 'ts': NOW}
        ]},
        {'key': 'silnice ii/101', 'name': 'Silnice II/101', 'deleted': False, 'points': [
            {'id': 'cp_9', 'name': 'S1', 'lat': 50.1, 'lng': 14.5, 'ts': NOW}
        ]}
    ],
    'total': 4, 'capped': False, 'serverTime': NOW
}

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('  OK   ' if podminka else '  CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


def server(port):
    for pokus in range(6):
        p = port + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % p
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(p)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                # ⚠ overit, ze server servíruje TENHLE strom (souběžné session)
                txt = urllib.request.urlopen(u.replace('index.html', 'scripts/test_vlastnik_data.py'), timeout=1).read(400).decode('utf-8', 'replace')
                if 'VLASTNIK: VIDITELNE VSTUPY' in txt:
                    return srv, u
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None, None


class Server:
    def __init__(self):
        self.log = []

    async def handle(self, route):
        req = route.request
        path = req.url.replace(API, '').split('?')[0]
        self.log.append((req.method, path))
        st, data = 200, {'ok': True}
        if path == '/health':
            data = {'ok': True, 'v': 14, 'owner': True, 'ownerKey': 'ok', 'fb': True}
        elif path == '/owner/firms':
            data = {'firms': [dict(FIRMA, users=3, max_users=10, frozen=0, created=NOW - 40 * 864e5, lastSeen=NOW, points=4, jobs=2)],
                    'requests': [], 'notice': '', 'stats': {'firms': 1, 'users': 3, 'active7': 2, 'points': 4}, 'serverTime': NOW}
        elif path == '/owner/firms/f1/data':
            data = DATA
        # ---- vlastnik plus (12. 9. 2026) ----
        elif path == '/owner/prehled':
            if 'lite=1' in req.url:
                data = {'zadosti': 2, 'zpravy': 1, 'serverTime': NOW}
            else:
                data = {'serverTime': NOW, 'lidi24': 4, 'body24': 40, 'ucty24': 1, 'chyby24': 3, 'zadosti': 2, 'zpravy': 1, 'uctyCelkem': 9, 'proCelkem': 2,
                        'vyprsi': [{'id': 'acc2', 'code': 'ZZZZ2222', 'name': 'Petra Malá', 'tarif_do': NOW + 3 * 864e5}],
                        'online': [{'uid': 'u1', 'jmeno': 'Jan Novák', 'firma': 'Geo s.r.o.', 'ts': NOW - 120e3, 'n': 7}],
                        'shluky': [{'lat': 50.08, 'lng': 14.42, 'n': 30}, {'lat': 49.2, 'lng': 16.6, 'n': 10}]}
        elif path == '/owner/log':
            data = {'rows': [{'id': 3, 'ts': NOW - 3600e3, 'akce': 'pro-zapnout', 'cil': 'K7QM3XP2 Jan Novák', 'detail': '14 dní'}, {'id': 2, 'ts': NOW - 7200e3, 'akce': 'vzkaz', 'cil': 'acc1', 'detail': 'Ahoj'}], 'more': False}
        elif path == '/owner/ucty':
            data = {'ucty': [
                {'id': 'acc1', 'code': 'K7QM3XP2', 'name': 'Jan Novák', 'tarif': 'zaklad', 'tarif_do': None, 'disabled': 0, 'created': NOW - 20 * 864e5, 'last_login': NOW - 3600e3, 'trial_ts': None, 'tarifPlati': False, 'note': 'volat v pátek',
                 'prostory': [{'nazev': 'Geo s.r.o.', 'kod': 'ABCDEF', 'role': 'admin', 'vlastni': False, 'archiv': False, 'lidi': 3, 'lastLogin': NOW}], 'aktivita': NOW, 'akcí30d': 12, 'objednavky': {'n': 0, 'zaplaceno': 0, 'ceka': 0}},
                {'id': 'acc2', 'code': 'ZZZZ2222', 'name': 'Petra Malá', 'tarif': 'pro', 'tarif_do': NOW + 3 * 864e5, 'disabled': 0, 'created': NOW - 60 * 864e5, 'last_login': NOW, 'trial_ts': None, 'tarifPlati': True, 'prostory': [], 'aktivita': NOW, 'akcí30d': 2, 'objednavky': {'n': 0, 'zaplaceno': 0, 'ceka': 0}}
            ], 'prodej': {'zapnuto': False, 'produkty': [], 'iban': ''}}
        elif path == '/owner/objednavky':
            data = {'objednavky': [], 'pohyby': [], 'fio': {'nastaveno': False}, 'prodej': {'zapnuto': False, 'produkty': [], 'iban': ''}}
        elif path == '/feedback' and req.method == 'GET':
            data = {'messages': [{'id': 7, 'ts': NOW, 'kind': 'pro', 'txt': 'Chci Pro.', 'contact': 'jan@example.cz', 'meta': json.dumps({'ucet': 'K7QM3XP2', 'zadost': 'pro'}), 'who': 'Jan Novák · K7QM3XP2', 'done': 0}], 'open': 1}
        elif path == '/owner/ucty/acc1/pohled':
            data = {'ucet': {'id': 'acc1', 'code': 'K7QM3XP2', 'name': 'Jan Novák', 'tarif': 'zaklad', 'tarif_do': None, 'disabled': 0, 'created': NOW - 20 * 864e5, 'last_login': NOW - 3600e3, 'note': 'volat v pátek', 'tarifPlati': False},
                    'clenstvi': [{'firm_id': 'f1', 'nazev': 'Geo s.r.o.', 'kod': 'ABCDEF', 'role': 'admin', 'vlastni': False, 'archiv': False, 'blokovan': False, 'lastLogin': NOW, 'frozen': 0, 'perms': {}}],
                    'chyby': [{'ts': NOW - 5000e3, 'msg': 'TypeError: x is null', 'src': 'js/grafika.js', 'line': 12, 'n': 2, 'ver': 'v290', 'dev': 'iPhone'}],
                    'nastroje': [{'k': 'openMeasureModal', 'n': 9, 'last': NOW - 86400e3}], 'zarizeni': [{'dev': 'iPhone 15', 'last': NOW, 'n': 20}], 'vzkazy': []}
        elif path == '/owner/export':
            data = {'ts': NOW, 'verze': 15, 'tabulky': {'firms': [FIRMA], 'users': [], 'accounts': [{'id': 'acc1', 'code': 'K7QM3XP2', 'name': 'Jan Novák'}], 'jobs': [], 'sync_points': [], 'feedback': [], 'orders': [], 'vzkazy': [], 'owner_log': [], 'meta': []}}
        elif path == '/config':
            st, data = 503, {'error': 'test'}
        await route.fulfill(status=st, content_type='application/json',
                            headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'},
                            body=json.dumps(data, ensure_ascii=False))


KOMPAS = """
for (const E of [window.DeviceOrientationEvent, window.DeviceMotionEvent]) { if (E && typeof E.requestPermission === 'function') E.requestPermission = () => Promise.resolve('granted'); }
setInterval(() => { if (typeof DeviceOrientationEvent === 'undefined') return; const T = { alpha: 120, beta: 80, gamma: 2, absolute: true };
  window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', T)); window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', T)); }, 100);
"""


async def nova(br, url, seed, srv):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': 50.0875, 'longitude': 14.4213}, permissions=['geolocation'])
    await ctx.route(API + '/**', srv.handle)
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    await page.add_init_script(seed + KOMPAS)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    for _ in range(50):
        if await page.evaluate("() => document.body.classList.contains('app-started')"):
            break
        await page.wait_for_timeout(400)
    await page.evaluate("() => { try { AGLazy.flush(); } catch (e) {} }")
    for _ in range(60):
        if await page.evaluate("() => document.querySelectorAll('script[type=\\\"ag/lazy\\\"][data-src]').length === 0"):
            break
        await page.wait_for_timeout(400)
    await page.wait_for_timeout(2500)
    await page.evaluate("() => { window.agAsk = function () { return Promise.resolve(true); }; window.confirm = function () { return true; }; }")
    return ctx, page, chyby


# ⚠ CI (12. 9. 2026): klepnutí → potvrzovací dialog → fetch je asynchronní; na pomalém runneru
#   POST v protokolu ještě nebyl, když se sada ptala hned. Proto se na požadavek ČEKÁ.
async def cekejLog(page, srv, method, path, n=30, krok=300):
    for _ in range(n):
        if (method, path) in srv.log:
            return True
        await page.wait_for_timeout(krok)
    return False


async def pockej(page, js, n=30, krok=300):
    for _ in range(n):
        try:
            if await page.evaluate(js):
                return True
        except Exception:
            pass
        await page.wait_for_timeout(krok)
    return False


async def beh(br, url):
    # ---- A) vstupy v rezimu vlastnika --------------------------------------------
    srv = Server()
    ctx, page, chyby = await nova(br, url, BOOT_OWNER, srv)
    ok('A1 Nastaveni: zlaty vstup do konzole pod zalozkami', await pockej(page, "() => { var b=document.getElementById('agv-set-btn'); return !!b && b.closest('#settings-modal') && /Konzole vlastníka/.test(b.textContent); }"))
    ok('A2 Nastroje: vstup do konzole nahore (pred hledanim)', await pockej(page, "() => { var b=document.getElementById('agv-tools-btn'), h=document.getElementById('tools-search'); return !!b && !!h && (b.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; }"))
    ok('A3 Vice: tlacitko Konzole vlastnika', await page.evaluate("() => !!document.getElementById('agv-menu-btn')"))
    await page.tap('#dock button:has-text("Nástroje")')
    await page.wait_for_timeout(1200)
    sek = await page.evaluate("() => { var s=document.querySelector('.ag-uk-owner'); if(!s) return null; return { prvni: document.querySelector('.ag-uk-g') === s, n: s.querySelectorAll('.ag-uk-i').length, open: !s.classList.contains('ag-uk-closed'), t: s.querySelector('.ag-uk-h span').textContent }; }")
    ok('A4 seznam ukonu: sekce „Vlastnik aplikace" je PRVNI, otevrena, s polozkami', sek and sek['prvni'] and sek['open'] and sek['n'] >= 3, sek)
    ok('A5 zadna vlastnik-* polozka nezbyla v „Dalsi nastroje"', await page.evaluate("() => !document.querySelector('.ag-uk-g:not(.ag-uk-owner) .ag-uk-i[data-k^=\\\"vlastnik-\\\"]')"))
    # klepnuti na vstup v Nastrojich otevre konzoli a zavre Nastroje
    await page.evaluate("() => document.getElementById('agv-tools-btn').click()")
    ok('A6 vstup z Nastroju otevre Konzoli vlastnika a Nastroje zavre', await pockej(page, "() => { var k=document.getElementById('agv-modal'); var t=document.getElementById('tools-modal'); return !!k && getComputedStyle(k).display !== 'none' && (!t || getComputedStyle(t).display === 'none' || !t.classList.contains('ag-open')); }"), await page.evaluate("() => Array.from(document.querySelectorAll('[id$=modal]')).filter(m => getComputedStyle(m).display !== 'none').map(m => m.id)"))
    await page.evaluate("() => AGVlastnik.close()")

    # ---- C) stazeni dat firmy --------------------------------------------------
    await page.evaluate("() => { if (window.AGSprava) AGSprava.open(); else AGLazy.need('js/sprava-appky.js', function () { AGSprava.open(); }); }")
    ok('C1 Vsechny firmy se otevrou a firma je v seznamu', await pockej(page, "() => !!document.querySelector('#ag-sa-modal [data-f=f1]')"))
    await page.evaluate("() => document.querySelector('#ag-sa-modal [data-f=f1]').click()")
    ok('C2 detail firmy ma „Stahnout body do me appky"', await pockej(page, "() => !!document.querySelector('#ag-sa-modal [data-data=f1]')"))
    # ⚠ vychozi zakazka zije jen v pameti (`projects`), 'arProjectsList' je do prvniho zapisu prazdny
    pred = await page.evaluate("() => (typeof projects !== 'undefined' && Array.isArray(projects)) ? projects.length : JSON.parse(localStorage.getItem('arProjectsList')||'[]').length")
    await page.evaluate("() => document.querySelector('#ag-sa-modal [data-data=f1]').click()")
    ok('C3 volani GET /owner/firms/f1/data a vyber zakazek (2)', await pockej(page, "() => document.querySelectorAll('#ag-sa-jobs [data-job]').length === 2") and await cekejLog(page, srv, 'GET', '/owner/firms/f1/data'), srv.log[-3:])
    await page.evaluate("() => document.getElementById('ag-sa-jobs-all').click()")
    ok('C4 „Ulozit vsechny" dobehne', await pockej(page, "() => document.getElementById('ag-sa-jobs-all').textContent === 'Uloženo'"))
    proj = await page.evaluate("() => JSON.parse(localStorage.getItem('arProjectsList')||'[]').map(p => p.name)")
    ok('C5 vznikly zakazky „Geo s.r.o. · Pole u lesa" a „Geo s.r.o. · Silnice II/101"', 'Geo s.r.o. · Pole u lesa' in proj and 'Geo s.r.o. · Silnice II/101' in proj and len(proj) == pred + 2, proj)
    body = await page.evaluate("""async () => {
        var list = JSON.parse(localStorage.getItem('arProjectsList')||'[]');
        var p = list.filter(x => x.name === 'Geo s.r.o. · Pole u lesa')[0]; if (!p) return null;
        var fk = p.id + '_arCustomPoints12';
        var raw = (typeof _idbGet === 'function') ? await _idbGet(fk) : null;
        if (raw == null) raw = localStorage.getItem(fk);
        var a = JSON.parse(raw || '[]');
        return { n: a.length, ids: a.map(x => x.id).sort(), kod: (a.filter(x => x.id === 'cp_1')[0]||{}).kod, vyska: (a.filter(x => x.id === 'cp_1')[0]||{}).vyska, prov: (a.filter(x => x.id === 'cp_1')[0]||{}).prov };
    }""")
    ok('C6 body zakazky v ulozisti (3), s kodem, vyskou a proveniencí firmy', body and body['n'] == 3 and body['ids'] == ['cp_1', 'cp_2', 'cp_3'] and body['kod'] == 'obruba' and body['vyska'] == 210.5 and (body['prov'] or {}).get('firma') == 'ABCDEF', body)
    # opakovane stazeni nezdvoji
    await page.evaluate("() => document.getElementById('ag-sa-jobs-x').click()")
    await page.evaluate("() => document.querySelector('#ag-sa-modal [data-data=f1]').click()")
    await pockej(page, "() => document.querySelectorAll('#ag-sa-jobs [data-job]').length === 2")
    await page.evaluate("() => document.getElementById('ag-sa-jobs-all').click()")
    await pockej(page, "() => document.getElementById('ag-sa-jobs-all').textContent === 'Uloženo'")
    body2 = await page.evaluate("""async () => {
        var list = JSON.parse(localStorage.getItem('arProjectsList')||'[]');
        var p = list.filter(x => x.name === 'Geo s.r.o. · Pole u lesa')[0];
        var fk = p.id + '_arCustomPoints12';
        var raw = (typeof _idbGet === 'function') ? await _idbGet(fk) : null;
        if (raw == null) raw = localStorage.getItem(fk);
        return { n: JSON.parse(raw||'[]').length, zakazek: list.length };
    }""")
    ok('C7 opakovane stazeni body ani zakazky nezdvoji', body2 and body2['n'] == 3 and body2['zakazek'] == pred + 2, body2)
    # zakazka je videt v prepinaci zakazek a po prepnuti ma body v pameti
    sel = await page.evaluate("() => { var s=document.getElementById('s-project-select'); return s ? Array.from(s.options).map(o => o.textContent) : null; }")
    ok('C8 nove zakazky jsou v prepinaci zakazek (Nastaveni -> Data)', sel and 'Geo s.r.o. · Pole u lesa' in sel, sel)
    await page.evaluate("() => { var s=document.getElementById('s-project-select'); var o=Array.from(s.options).filter(o => o.textContent === 'Geo s.r.o. · Pole u lesa')[0]; s.value = o.value; if (typeof changeProjectFromSettings === 'function') changeProjectFromSettings(); else changeProject(); }")
    ok('C9 po prepnuti na stazenou zakazku jsou 3 body v pameti appky', await pockej(page, "() => typeof arPoints !== 'undefined' && arPoints.filter(p => p.cat === 'CUSTOM').length === 3"), await page.evaluate("() => typeof arPoints !== 'undefined' ? arPoints.filter(p => p.cat === 'CUSTOM').length : 'arPoints?'"))
    ok('C10 zadna chyba v konzoli', not [c for c in chyby if 'sprava-appky' in c or 'vlastnik' in c or 'nastroje-ukony' in c], chyby[:3])
    await ctx.close()

    # ---- B) bez rezimu vlastnika nic ----------------------------------------------
    srv = Server()
    ctx, page, chyby = await nova(br, url, BOOT_PLAIN, srv)
    await page.wait_for_timeout(2500)
    ok('B1 bez rezimu: zadny vstup v Nastaveni, Nastrojich ani ve Vice', await page.evaluate("() => !document.getElementById('agv-set-btn') && !document.getElementById('agv-tools-btn') && !document.getElementById('agv-menu-btn')"))
    await page.tap('#dock button:has-text("Nástroje")')
    await page.wait_for_timeout(1000)
    ok('B2 bez rezimu: zadna sekce Vlastnik aplikace', await page.evaluate("() => !document.querySelector('.ag-uk-owner')"))
    await ctx.close()


# ⚠ init skript běží při KAŽDÉ navigaci — po reloadu by seed smazal právě zapnutý režim
# vlastníka i Face ID; proto se seje jen napoprvé (značka v sessionStorage)
SEED_LOGIN = "if (!sessionStorage.getItem('agTestSeed')) { sessionStorage.setItem('agTestSeed', '1');" + chr(10) + boot() + """
localStorage.setItem('agLockStart_v1', '1');
localStorage.removeItem('agVlastnik_v1'); localStorage.removeItem('agFbKey_v1');
var f = JSON.parse(localStorage.getItem('agFirma_v1')); f.cloud = true; f.code = 'ABC123'; f.firmName = 'Moje firma s.r.o.'; localStorage.setItem('agFirma_v1', JSON.stringify(f));
localStorage.setItem('agFirmy_v1', JSON.stringify([
  { key: 'c:ABC123', label: 'Moje firma s.r.o.', code: 'ABC123', cloud: true, ts: 1, snap: { agFirma_v1: JSON.stringify(f) } },
  { key: 'c:XYZ789', label: 'Druhá firma a.s.', code: 'XYZ789', cloud: true, ts: 2, snap: { agFirma_v1: JSON.stringify(Object.assign({}, f, { code: 'XYZ789', firmName: 'Druhá firma a.s.' })) } }
]));
}
"""


async def beh2(br, url):
    # ---- D) Face ID vlastnika ----------------------------------------------------
    srv = Server()
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    await ctx.route(API + '/**', srv.handle)
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    cdp = await ctx.new_cdp_session(page)
    await cdp.send('WebAuthn.enable')
    auth = await cdp.send('WebAuthn.addVirtualAuthenticator', {'options': {
        'protocol': 'ctap2', 'transport': 'internal', 'hasResidentKey': True, 'hasUserVerification': True,
        'isUserVerified': True, 'automaticPresenceSimulation': True}})
    await page.add_init_script(SEED_LOGIN + KOMPAS)
    # ⚠ WebAuthn NEBERE IP ADRESU jako RP ID (127.0.0.1 → SecurityError) — jede se přes localhost
    await page.goto(url.replace('127.0.0.1', 'localhost'), wait_until='domcontentloaded', timeout=45000)
    ok('D0 prihlasovaci obrazovka firmy stoji', await pockej(page, "() => !!document.getElementById('ag-login')"))
    # E) prepnout firmu (nez se prihlasime)
    ok('E1 na prihlaseni je „Prepnout firmu" (dva ulozene profily, zadne prostory uctu)', await pockej(page, "() => !!document.getElementById('agl-swfirm')"))
    await page.evaluate("() => document.getElementById('agl-swfirm').click()")
    ok('E2 rozcestnik vypise obe firmy, aktualni je „tady jsi"', await pockej(page, "() => { var b=document.querySelectorAll('#ag-firmy .agg-prof'); return b.length === 2 && Array.from(b).some(x => x.disabled && /tady jsi/.test(x.textContent)); }"))
    await page.evaluate("() => document.querySelector('#ag-firmy .agg-prof[data-key=\"c:XYZ789\"]').click()")
    ok('E3 po volbe stoji prihlaseni DRUHE firmy', await pockej(page, "() => { var l=document.getElementById('ag-login'); return !!l && /Druhá firma/.test((l.querySelector('.agl-firmchip')||{}).textContent||'') && !document.getElementById('ag-firmy'); }"),
       await page.evaluate("() => (document.querySelector('#ag-login .agl-firmchip')||{}).textContent"))
    # D) prihlaseni VLASTNIK + klic → nabidka Face ID
    await page.evaluate("() => document.getElementById('agl-other').click()")
    await page.wait_for_timeout(300)
    await page.fill('#ag-login .agl-name', 'VLASTNIK')
    await page.fill('#ag-login .agl-pin', 'klic-vlastnika-aspon-24-znaku-dlouhy')
    await page.evaluate("() => document.querySelector('#ag-login .agl-pinbox .agl-btn').click()")
    ok('D1 klic prosel (rezim vlastnika zapnuty, appka bezi)', await pockej(page, "() => localStorage.getItem('agVlastnik_v1') === '1' && document.body.classList.contains('app-started')", 40))
    ok('D2 nabidka „Priste jako vlastnik pres Face ID?"', await pockej(page, "() => !!document.getElementById('agv-bio-yes')"))
    await page.evaluate("() => document.getElementById('agv-bio-yes').click()")
    ok('D3 zapnuti ulozi WebAuthn klic pro pseudo-ucet vlastnik', await pockej(page, "() => { try { var o = JSON.parse(localStorage.getItem('agFirmaBio_v1')||'{}'); return !!(o.vlastnik && o.vlastnik.id); } catch (e) { return false; } }", 40),
       await page.evaluate("() => localStorage.getItem('agFirmaBio_v1')"))
    # restart: prihlaseni musi nabidnout zlate tlacitko
    await page.reload(wait_until='domcontentloaded')
    ok('D4 po restartu stoji prihlaseni a je na nem „Vlastnik — odemknout Face ID"', await pockej(page, "() => !!document.getElementById('ag-login') && !!document.getElementById('agv-bio-btn')", 60))
    await page.evaluate("() => document.getElementById('agv-bio-btn').click()")
    ok('D5 Face ID pusti vlastnika dovnitr bez klice', await pockej(page, "() => !document.getElementById('ag-login') && document.body.classList.contains('app-started') && !!document.getElementById('agv-menu-btn')", 60))
    ok('D6 zadna chyba v konzoli', not [c for c in chyby if 'vlastnik' in c or 'ucty' in c], chyby[:3])
    await cdp.send('WebAuthn.removeVirtualAuthenticator', {'authenticatorId': auth['authenticatorId']})
    await ctx.close()


async def beh3(br, url):
    # ---- F) VLASTNIK PLUS: souhrn, tecka, denik, kalendar, zaloha, ocima uctu, vzkaz, CSV ----
    srv = Server()
    ctx, page, chyby = await nova(br, url, BOOT_OWNER, srv)
    await page.evaluate("() => { window.agAsk = function () { return Promise.resolve(true); }; window.confirm = function () { return true; }; window.agPrompt = function () { return Promise.resolve('Pro máš na 14 dní.'); }; }")
    ok('F1 tecka „neco ceka" (2 zadosti + 1 zprava = 3) na zlatych vstupech', await pockej(page, "() => { var b=document.querySelector('#agv-set-btn .agvp-badge'); return !!b && b.textContent === '3' && !!document.querySelector('#agv-tools-btn .agvp-badge'); }", 40))
    await page.evaluate("() => AGVlastnik.open()")
    ok('F2 konzole ma nahore dlazdice souhrnu (lide 4, body 40, zadosti 2, chyby 3, Pro vyprsi)', await pockej(page, "() => { var t=Array.from(document.querySelectorAll('#agv-modal .agvp-t')).map(x => x.textContent.replace(/\\s+/g,' ').trim()); return t.length >= 6 && t.some(x => /^4 ?lidí/i.test(x)) && t.some(x => /^40 ?bodů/i.test(x)) && t.some(x => /^2 ?žádostí/i.test(x)) && t.some(x => /^3 ?chyb/i.test(x)) && t.some(x => /vyprší|končí/i.test(x)); }"),
       await page.evaluate("() => Array.from(document.querySelectorAll('#agv-modal .agvp-t')).map(x => x.textContent.trim())"))
    await page.evaluate("() => { var b=Array.from(document.querySelectorAll('#agv-modal .agv-it')).filter(x => /Souhrn dne/.test(x.textContent))[0]; b.click(); }")
    ok('F3 pohled Souhrn dne: kdo je v terenu (Jan Novak, pred 2 min) + mapa shluku', await pockej(page, "() => /Jan Novák/.test(document.getElementById('agv-body').textContent) && /před \\d+ min/.test(document.getElementById('agv-body').textContent) && !!document.querySelector('#agvp-map .leaflet-container, #agvp-map .leaflet-pane')", 40),
       await page.evaluate("() => document.getElementById('agv-body').textContent.slice(0, 300)"))
    await page.evaluate("() => AGVlastnik.jdi('denik')")
    ok('F4 Denik vlastnika vypise akce lidsky (Zapnuto Pro — K7QM3XP2 Jan Novak, 14 dni)', await pockej(page, "() => /Zapnuto Pro/.test(document.getElementById('agv-body').textContent) && /14 dní/.test(document.getElementById('agv-body').textContent) && /Vzkaz/.test(document.getElementById('agv-body').textContent)"))
    await page.evaluate("() => AGVlastnik.jdi('kalendar')")
    ok('F5 Kalendar: Petra Mala do 7 dni, tlacitka + mesic / + rok', await pockej(page, "() => /Do 7 dní/.test(document.getElementById('agv-body').textContent) && /Petra Malá/.test(document.getElementById('agv-body').textContent) && !!document.querySelector('#agv-body [data-pro=acc2][data-dni=\"365\"]')"))
    await page.evaluate("() => document.querySelector('#agv-body [data-pro=acc2][data-dni=\"365\"]').click()")
    ok('F6 + rok posle /owner/tarif {acc2, pro, 365}', await cekejLog(page, srv, 'POST', '/owner/tarif'), srv.log[-4:])
    # zaloha: soubor se stahne (download event)
    await page.evaluate("() => AGVlastnik.jdi('zaloha')")
    await pockej(page, "() => !!document.getElementById('agvp-zal')")
    async with page.expect_download(timeout=15000) as dl:
        await page.evaluate("() => document.getElementById('agvp-zal').click()")
    d = await dl.value
    ok('F7 Zaloha serveru stahne qtrig-zaloha-*.json', d.suggested_filename.startswith('qtrig-zaloha-') and d.suggested_filename.endswith('.json'), d.suggested_filename)
    ok('F7b po stazeni napise velikost a pocty', await pockej(page, "() => /kB/.test((document.getElementById('agvp-zal-st')||{}).textContent||'') && /accounts 1/.test(document.getElementById('agvp-zal-st').textContent)"))
    # Lide: poznamka, vzkaz, ocima uctu, 14 dni zkusebne
    await page.evaluate("() => { AGVlastnik.close(); if (window.AGProdej) AGProdej.open('lide'); else AGLazy.need('js/prodej-konzole.js', function () { AGProdej.open('lide'); }); }")
    ok('F8 Lide: radek uctu', await pockej(page, "() => !!document.querySelector('#ag-pd-modal .pd-row[data-u=acc1]')"))
    await page.evaluate("() => document.querySelector('#ag-pd-modal .pd-row[data-u=acc1]').click()")
    ok('F9 detail: poznamka predvyplnena ze serveru + tlacitka Vzkaz a Ocima uctu', await pockej(page, "() => { var i=document.querySelector('#ag-pd-modal [data-pozn=acc1]'); return !!i && i.value === 'volat v pátek' && !!document.querySelector('#ag-pd-modal [data-vzkaz=acc1]') && !!document.querySelector('#ag-pd-modal [data-ocima=acc1]'); }"))
    await page.fill('#ag-pd-modal [data-pozn=acc1]', 'volat v pondělí')
    await page.evaluate("() => document.querySelector('#ag-pd-modal [data-poznulozit=acc1]').click()")
    ok('F10 Ulozit poznamku posle POST /owner/ucty/acc1/pozn', await cekejLog(page, srv, 'POST', '/owner/ucty/acc1/pozn') and await pockej(page, "() => document.querySelector('#ag-pd-modal [data-poznulozit=acc1]').textContent === 'Uloženo'"), srv.log[-3:])
    await page.evaluate("() => document.querySelector('#ag-pd-modal [data-vzkaz=acc1]').click()")
    ok('F11 Vzkaz do appky posle POST /owner/vzkaz', await cekejLog(page, srv, 'POST', '/owner/vzkaz'), srv.log[-3:])
    await page.evaluate("() => { document.querySelectorAll('.ag-dlg-overlay.open .ag-dlg-ok').forEach(b => b.click()); }")
    await page.evaluate("() => document.querySelector('#ag-pd-modal [data-ocima=acc1]').click()")
    ok('F12 Ocima uctu: karta s tarifem, clenstvim, nastroji a chybami', await pockej(page, "() => { var t=(document.getElementById('agv-body')||{}).textContent||''; return /Očima účtu: Jan Novák/.test(t) && /Geo s.r.o./.test(t) && /TypeError/.test(t) && /iPhone 15/.test(t); }", 40),
       await page.evaluate("() => ((document.getElementById('agv-body')||{}).textContent||'').slice(0,200)"))
    await page.evaluate("() => { AGVlastnik.close(); AGProdej.open('zad'); }")
    ok('F13 Zadosti: tlacitko „na 14 dni zkusebne"', await pockej(page, "() => !!document.querySelector('#ag-pd-modal [data-zpro][data-dni=\"14\"]')"))
    await page.evaluate("() => AGProdej.close()")
    # Vsechny firmy: CSV + vzkaz firme
    await page.evaluate("() => { if (window.AGSprava) AGSprava.open(); }")
    await pockej(page, "() => !!document.querySelector('#ag-sa-modal [data-f=f1]')")
    await page.evaluate("() => document.querySelector('#ag-sa-modal [data-f=f1]').click()")
    ok('F14 detail firmy: Vzkaz firme do appky', await pockej(page, "() => !!document.querySelector('#ag-sa-modal [data-vzkazf=f1]')"))
    await page.evaluate("() => document.querySelector('#ag-sa-modal [data-data=f1]').click()")
    await pockej(page, "() => !!document.getElementById('ag-sa-jobs-csv')")
    async with page.expect_download(timeout=15000) as dl2:
        await page.evaluate("() => document.getElementById('ag-sa-jobs-csv').click()")
    d2 = await dl2.value
    cesta = await d2.path()
    obsah = io.open(cesta, encoding='utf-8-sig').read() if cesta else ''
    ok('F15 CSV bodu firmy: hlavicka + 4 radky, Y/X v S-JTSK', d2.suggested_filename.endswith('.csv') and obsah.count('\n') >= 4 and obsah.startswith('zakazka;cislo;kod;Y;X') and ';obruba;' in obsah and '742' in obsah, obsah[:200])
    ok('F16 zadna chyba v konzoli', not [c for c in chyby if 'vlastnik' in c or 'prodej' in c or 'sprava' in c], chyby[:3])
    await ctx.close()

    # ---- G) UZIVATEL: vzkaz od vlastnika se ukaze a po krizku odejde /vzkaz/precteno --------
    srv = Server()
    async def cfg(route):
        await route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'},
                            body=json.dumps({'firm': {'id': 'f1', 'code': 'ABC123', 'name': 'Moje firma s.r.o.', 'perms': {}}, 'users': [{'id': 'test-user-1', 'name': 'Tester', 'role': 'admin'}],
                                             'me': {'id': 'test-user-1', 'name': 'Tester', 'role': 'admin', 'ucet': 'test-acc-1', 'tarif': 'zaklad'},
                                             'vzkazy': [{'id': 7, 'ts': NOW, 'txt': 'Pro máš na 14 dní zkušebně.', 'komu': 'ty'}]}))
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, geolocation={'latitude': 50.0875, 'longitude': 14.4213}, permissions=['geolocation'])
    # ⚠ Playwright bere routy od POSLEDNÍ registrované — obecná musí jít první
    await ctx.route(API + '/**', srv.handle)
    await ctx.route(API + '/config*', cfg)
    page = await ctx.new_page()
    await page.add_init_script(BOOT_PLAIN + "localStorage.setItem('agFirmaTok_v1', JSON.stringify({ token: 'x.y', userId: 'test-user-1' })); var f = JSON.parse(localStorage.getItem('agFirma_v1')); f.cloud = true; f.code = 'ABC123'; localStorage.setItem('agFirma_v1', JSON.stringify(f));" + KOMPAS)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    ok('G1 vzkaz od vlastnika se ukaze v upozorneni', await pockej(page, "() => !!(window.AGNotify && AGNotify.has('ag-vzkaz-7'))", 60),
       await page.evaluate("() => ({ has: !!(window.AGNotify && AGNotify.has && AGNotify.has('ag-vzkaz-7')), firma: (JSON.parse(localStorage.getItem('agFirma_v1')||'{}').vzkazy) })"))
    await page.evaluate("() => { try { AGNotify.dismiss('ag-vzkaz-7'); } catch (e) {} }")
    ok('G2 krizek posle POST /vzkaz/precteno {id:7}', await cekejLog(page, srv, 'POST', '/vzkaz/precteno'), srv.log[-3:])
    await ctx.close()


async def main():
    from playwright.async_api import async_playwright
    srv, url = server(PORT)
    if not srv:
        print('CHYBA: test server nenabehl'); return 1
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            await beh(br, url)
            await beh2(br, url)
            await beh3(br, url)
            await br.close()
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    if spatne:
        print('VADY:')
        for v in spatne:
            print('  - ' + v[0])
        return 1
    print('OK - vstupy vlastnika a stazeni dat firmy funguji.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
