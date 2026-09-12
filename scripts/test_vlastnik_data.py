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
    ok('C3 volani GET /owner/firms/f1/data a vyber zakazek (2)', await pockej(page, "() => document.querySelectorAll('#ag-sa-jobs [data-job]').length === 2") and ('GET', '/owner/firms/f1/data') in srv.log, srv.log[-3:])
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


async def main():
    from playwright.async_api import async_playwright
    srv, url = server(PORT)
    if not srv:
        print('CHYBA: test server nenabehl'); return 1
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            await beh(br, url)
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
