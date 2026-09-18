# -*- coding: utf-8 -*-
u"""Regrese k 2. kolu hodnocení 18. 9. 2026 (v356) — vybrané návrhy R1, R2, R3 (R5 = tests.yml, R6 udělal v355):

  R1  Nový bod: souřadnice z GPS průměru se vyplní SAMY hned po otevření (bez klepnutí na „Z průměru GPS“),
      dole je živá poznámka „Zprůměrováno z N…“; přepsání pole Y automatiku zastaví; Nový bod → Uložit = 2 klepnutí.
  R2  Klepnutí v mapě otevře kartu bodu i 27 px od značky (dřív 25), 31 px už ne; v režimu rukavic 33 px ano.
  R3  Brána: „Zapomenuté heslo? Mám obnovovací kód“ → formulář (kód účtu, obnovovací kód, 2× heslo), kontroly
      vstupu, POST /account/recover, po úspěchu přihlášení a karta s NOVÝM obnovovacím kódem; registrace ukáže
      obnovovací kód; O aplikaci má tlačítko „Obnovovací kód…“.

Spuštění:  python scripts/test_v356.py [port]
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
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8998)
vysledky = []
LAT, LNG = V.LAT, V.LNG


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def staticke():
    g = src('js/grafika.js')
    ok('R1s openNewPointModal spouští agAutoGpsStart', 'agAutoGpsStart();' in g and "closeCustomModal() { document.getElementById('custom-modal-overlay').style.display = 'none'; try { agAutoGpsStop(); }" in g)
    ok('R2s poloměr klepnutí 28 px / rukavice 34 px', "document.body.classList.contains('ag-glove') ? 34 : 28" in g and 'pixelDist <= _tapR' in g)
    w = src('cloud/worker.js')
    ok('R3s worker: /account/recover + /account/recovery + recovery v /register', "path === '/account/recover'" in w and "path === '/account/recovery'" in w and 'recovery: recovery,' in w and 'v: 28' in w)
    u = src('js/ucty.js')
    ok('R3s ucty.js: brána má „Zapomenuté heslo? Mám obnovovací kód“ a už netvrdí, že heslo nejde obnovit', 'id="agg-forgot">Zapomenuté heslo? Mám obnovovací kód' in u and 'Heslo proto nejde obnovit' not in u)
    ok('R3s O aplikaci: tlačítko Obnovovací kód', 'AGUcty.obnovovaciKod()' in src('index.html'))


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        init = boot(tarif='zaklad') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');"
        ctx, page = await V.stranka(br, url, init, chyby)
        ok('0 appka nastartovala', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        await V.cekej(page, "typeof userLat === 'number' && userLat", 30)
        await page.wait_for_timeout(1500)

        # ---- R1: Nový bod — průměr GPS sám --------------------------------------------------
        # v headless chodí jediný fix → průměr má n=1; podstrčit hotový průměr (n=5), jak ho staví updateGpsAveraging
        await page.evaluate("() => { gpsAvgResult = { lat: %f, lng: %f, n: 5, total: 5, sigma: 0.8, sterr: 0.36, acc: 3, coarse: false, alt: 280, altSterr: 0.5, altN: 5, manual: false, ts: Date.now() }; window.AGFix = { ts: Date.now() }; }" % (LAT, LNG))
        await page.evaluate("() => openNewPointModal()")
        await page.wait_for_timeout(1500)
        r1 = await page.evaluate("""() => ({ y: document.getElementById('custom-y').value, x: document.getElementById('custom-x').value, auto: document.getElementById('custom-y').dataset.agAuto,
            note: (document.getElementById('custom-acc-note') || {}).innerText || '', noteVidet: (document.getElementById('custom-acc-note') || {}).style.display, dialog: !!document.querySelector('.ag-dlg-overlay'),
            origin: window._agPointOrigin, timer: !!window._agAutoGpsTimer })""")
        ok('R1 Y/X vyplněné hned po otevření bez klepnutí, poznámka „Zprůměrováno z 5“, žádný dialog', r1['y'] and r1['x'] and float(r1['y'].replace(',', '.')) > 100000 and 'Zprůměrováno' in r1['note'] and '5' in r1['note'] and r1['noteVidet'] == 'block' and not r1['dialog'] and r1['origin'] == 'gps-avg', r1)
        # průměr se zpřesní → pole se doplní znovu (živě)
        await page.evaluate("() => { gpsAvgResult.n = 12; gpsAvgResult.sterr = 0.21; }")
        await page.wait_for_timeout(1400)
        r1b = await page.evaluate("() => ((document.getElementById('custom-acc-note') || {}).innerText || '')")
        ok('R1 poznámka se obnovuje živě (n = 12)', '12' in r1b and '0,21' in r1b.replace('.', ','), r1b)
        # ruční přepsání Y automatiku zastaví
        await page.fill('#custom-y', '600000,00')
        await page.evaluate("() => { gpsAvgResult.n = 20; }")
        await page.wait_for_timeout(1400)
        r1c = await page.evaluate("() => ({ y: document.getElementById('custom-y').value, auto: document.getElementById('custom-y').dataset.agAuto || null })")
        ok('R1 přepsání Y rukou automatiku vypne (hodnota zůstane, data-ag-auto pryč)', r1c['y'] == '600000,00' and r1c['auto'] is None, r1c)
        await page.fill('#custom-y', '')   # ručně psaná hodnota by se jinak vrátila z rozdělané práce (draft-store.js)
        await page.evaluate("() => closeCustomModal()")
        # bez průměru: poznámka místo dialogu
        await page.evaluate("() => { gpsAvgResult = { coarse: true, acc: 65, n: 0, total: 0, manual: false, ts: Date.now() }; }")
        await page.evaluate("() => openNewPointModal()")
        await page.wait_for_timeout(1200)
        r1d = await page.evaluate("() => ({ y: document.getElementById('custom-y').value, note: (document.getElementById('custom-acc-note') || {}).innerText || '', dialog: !!document.querySelector('.ag-dlg-overlay') })")
        ok('R1 bez satelitního fixu: prázdná pole, poznámka „čekám na fix“, žádný dialog', not r1d['y'] and 'síťová poloha' in r1d['note'] and not r1d['dialog'], r1d)
        await page.evaluate("() => closeCustomModal()")
        await page.evaluate("() => { gpsAvgResult = null; }")

        # ---- R2: poloměr klepnutí ---------------------------------------------------------
        async def klik_od_bodu(dx):
            await page.evaluate("() => { const s = document.getElementById('bottom-sheet'); if (s) { s.classList.remove('open'); } activePointIdForModal = null; }")
            p = await page.evaluate("() => { const pt = arPoints.find(x => x.id === 'p_ppbp'); const c = map.latLngToContainerPoint([pt.lat, pt.lng]); const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + c.x, y: r.top + c.y }; }")
            await page.mouse.click(p['x'] + dx, p['y'])
            await page.wait_for_timeout(700)
            return await page.evaluate("() => document.getElementById('bottom-sheet').classList.contains('open')")
        ok('R2 klepnutí 27 px od značky otevře kartu', await klik_od_bodu(27))
        ok('R2 klepnutí 31 px od značky kartu neotevře', not await klik_od_bodu(31))
        await page.evaluate("() => document.body.classList.add('ag-glove')")
        ok('R2 v režimu rukavic otevře i 33 px', await klik_od_bodu(33))
        await page.evaluate("() => { document.body.classList.remove('ag-glove'); const s = document.getElementById('bottom-sheet'); if (s) s.classList.remove('open'); }")

        # ---- R3: O aplikaci má tlačítko -------------------------------------------------------
        r3o = await page.evaluate("() => { const b = Array.from(document.querySelectorAll('#about-modal button, .modal-overlay button')).find(b => /Obnovovací kód/.test(b.textContent)); return !!b; }")
        ok('R3 tlačítko „Obnovovací kód…“ v O aplikaci', r3o)
        vazne = [x for x in chyby if 'favicon' not in x and 'net::ERR' not in x and 'Failed to fetch' not in x and 'ERR_FAILED' not in x and 'Failed to load resource' not in x]
        ok('Z1 bez chyb stránky', not vazne, vazne[:5])
        await ctx.close()

        # ---- R3: brána bez účtu → obnova hesla (API podstrčené) ----------------------------------
        ctx2 = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, service_workers='block')
        p2 = await ctx2.new_page()
        chyby2 = []
        p2.on('pageerror', lambda e: chyby2.append('pageerror: ' + str(e)))
        vol = []

        async def api(route, req):
            u = req.url
            if 'workers.dev' in u or '/account/recover' in u or u.endswith('/login') or '/register' in u:
                body = None
                try: body = json.loads(req.post_data or 'null')
                except Exception: body = None
                vol.append((req.method, u.split('workers.dev')[-1] if 'workers.dev' in u else u, body))
                if u.endswith('/account/recover'):
                    if body and body.get('recovery') == 'AAAAABBBBBCCCCCDDDDD' and body.get('code') == 'ABCDEFGH':
                        return await route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps({'ok': True, 'recovery': 'ZZZZZ-YYYYY-XXXXX-WWWWW'}))
                    return await route.fulfill(status=401, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps({'error': 'Nesprávný kód účtu nebo obnovovací kód.'}))
                if u.endswith('/login'):
                    return await route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps({
                        'token': 'tok.abc', 'ucet': {'id': 'acc1', 'code': 'ABCDEFGH', 'name': 'Tester', 'tarif': 'zaklad', 'tarifDo': 0},
                        'user': {'id': 'u1', 'name': 'Tester', 'role': 'admin'},
                        'prostory': [{'firmId': 'f1', 'uid': 'u1', 'role': 'admin', 'vlastni': True, 'archiv': False, 'nazev': 'Moje', 'kod': 'AAAAAA'}],
                        'config': {'enabled': True, 'cloud': True, 'firmName': 'Moje', 'perms': {}, 'users': [{'id': 'u1', 'name': 'Tester', 'role': 'admin'}], 'firmId': 'f1', 'code': 'AAAAAA'}}))
                if u.endswith('/health'):
                    return await route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps({'ok': True, 'v': 28, 'recovery': True}))
                return await route.abort()
            return await V.route_vse(route, req)
        await p2.route('**/*', api)
        await p2.goto(url, wait_until='domcontentloaded', timeout=60000)
        await V.cekej(p2, "document.getElementById('ag-gate')", 40)
        await p2.wait_for_timeout(800)
        await p2.evaluate("() => document.getElementById('agg-show-join').click()")
        await p2.wait_for_timeout(300)
        g = await p2.evaluate("() => { const b = document.getElementById('agg-forgot'); const n = document.querySelector('#ag-gate .agg-note'); return { btn: !!b, videt: !!(b && b.offsetParent), note: n ? n.textContent : '' }; }")
        ok('R3 brána: tlačítko „Zapomenuté heslo? Mám obnovovací kód“ je vidět po rozbalení přihlášení, poznámka mluví o obnovovacím kódu', g['btn'] and g['videt'] and 'obnovovací kód' in g['note'] and 'nejde obnovit' not in g['note'], g)
        await p2.fill('#agg-code', 'abcdefgh')
        await p2.evaluate("() => document.getElementById('agg-forgot').click()")
        await p2.wait_for_timeout(400)
        f = await p2.evaluate("() => { const o = document.getElementById('ag-obnova'); return { je: !!o, kod: o ? o.querySelector('#ago-code').value : null, pole: o ? o.querySelectorAll('input').length : 0 }; }")
        ok('R3 formulář obnovy: 4 pole, kód účtu předvyplněný z brány (velkými)', f['je'] and f['kod'] == 'ABCDEFGH' and f['pole'] == 4, f)
        await p2.fill('#ago-rec', 'aaaaa-bbbbb-ccccc-dddd')
        await p2.fill('#ago-p1', 'noveheslo1'); await p2.fill('#ago-p2', 'noveheslo1')
        await p2.evaluate("() => document.getElementById('ago-go').click()")
        await p2.wait_for_timeout(300)
        e1 = await p2.evaluate("() => document.getElementById('ago-err').textContent")
        ok('R3 krátký obnovovací kód se chytí na klientovi (bez volání serveru)', '20 znaků' in e1 and not vol, (e1, vol))
        await p2.fill('#ago-rec', 'aaaaa-bbbbb-ccccc-ddddd')
        await p2.fill('#ago-p2', 'jine')
        await p2.evaluate("() => document.getElementById('ago-go').click()")
        await p2.wait_for_timeout(300)
        e2 = await p2.evaluate("() => document.getElementById('ago-err').textContent")
        ok('R3 neshodná hesla se chytí na klientovi', 'neshodují' in e2, e2)
        await p2.fill('#ago-p2', 'noveheslo1')
        await p2.evaluate("() => document.getElementById('ago-go').click()")
        await V.cekej(p2, "document.getElementById('ag-kod')", 30)
        await p2.wait_for_timeout(500)
        k = await p2.evaluate("() => { const o = document.getElementById('ag-kod'); return { je: !!o, text: o ? o.innerText : '', gate: !!document.getElementById('ag-gate'), obnova: !!document.getElementById('ag-obnova'), ucet: localStorage.getItem('agUcet_v1') || '' }; }")
        rec_call = [v for v in vol if v[1].endswith('/account/recover')]
        log_call = [v for v in vol if v[1].endswith('/login')]
        ok('R3 server dostal kód účtu velkými + obnovovací kód bez pomlček + nové heslo', rec_call and rec_call[0][2] == {'code': 'ABCDEFGH', 'recovery': 'AAAAABBBBBCCCCCDDDDD', 'password': 'noveheslo1'}, rec_call)
        ok('R3 po obnově se appka přihlásila novým heslem a ukázala NOVÝ obnovovací kód', log_call and log_call[0][2].get('password') == 'noveheslo1' and k['je'] and 'ZZZZZ-YYYYY-XXXXX-WWWWW' in k['text'] and 'ABCDEFGH' in k['text'] and not k['obnova'] and 'ABCDEFGH' in k['ucet'], k)
        ok('R3 karta má tlačítko Zkopírovat', await p2.evaluate("() => !!document.getElementById('agk-copy')"))
        vazne2 = [x for x in chyby2 if 'favicon' not in x and 'net::ERR' not in x and 'Failed to fetch' not in x]
        ok('Z2 brána bez chyb stránky', not vazne2, vazne2[:5])
        await ctx2.close()
        await br.close()


def main():
    staticke()
    srv, url = V.server(PORT)
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
