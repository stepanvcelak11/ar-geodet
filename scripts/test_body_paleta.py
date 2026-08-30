#!/usr/bin/env python3
# Overeni navrhu A1 (terenni radek) + A2 (detail na tuknuti) + B1 (paleta nastroju).
import asyncio, json, os, subprocess, sys, time

ROOT = r'C:\Users\stepa\Desktop\ar_geodet'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8135
URL = 'http://127.0.0.1:%d/index.html' % PORT
OUT = os.environ.get('AG_SHOTS', os.path.join(ROOT, '_diag'))
BOOT = """
  localStorage.setItem('agGuest_v1', JSON.stringify({ts: Date.now()}));
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agBrifinkLastShown', new Date().toISOString().slice(0,10));
  localStorage.setItem('agLockStart_v1','0');
"""
PTS = [
    {"name": "1001", "lat": 50.0875, "lng": 14.4213, "vyska": 231.44, "acc": 0.25, "kod": "ROH",
     "prov": {"origin": "gps-avg", "ts": 0, "acc": 0.25}},
    {"name": "1002", "lat": 50.0878, "lng": 14.4219, "vyska": 232.10, "acc": 1.20, "kod": "SLOUP",
     "prov": {"origin": "gps-avg", "ts": 0, "acc": 1.20}},
    {"name": "1003", "lat": 50.0871, "lng": 14.4205, "vyska": 230.77, "acc": 2.40,
     "prov": {"origin": "import", "ts": 0, "acc": 2.40}},
    {"name": "H-2045-sachta-vychod-dlouhy-nazev", "lat": 50.0866, "lng": 14.4231, "vyska": 229.90,
     "acc": 6.60, "kod": "SACHTA", "prov": {"origin": "import", "ts": 0, "acc": 6.60}},
    {"name": "2001", "lat": 50.0881, "lng": 14.4240, "vyska": 233.12, "acc": 0.31, "kod": "HRANICE",
     "prov": {"origin": "gps-avg", "src": "garmin", "ts": 0, "acc": 0.31}},
]
res = []


def a(x):
    return str(x).encode('ascii', 'replace').decode('ascii')


def ok(n, c, d=''):
    res.append((bool(c), n))
    print(('  OK    ' if c else '  CHYBA ') + a(n) + (('  -> ' + a(d)) if d else ''))


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(PORT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=ROOT)
    time.sleep(1.5)
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as pw:
            b = await pw.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
            ctx = await b.new_context(permissions=['geolocation', 'camera'],
                                      geolocation={'latitude': 50.0875, 'longitude': 14.4213},
                                      viewport={'width': 412, 'height': 915})
            await ctx.add_init_script(BOOT)
            p = await ctx.new_page()
            errs = []
            p.on('pageerror', lambda e: errs.append(str(e)))
            await p.goto(URL, wait_until='load')
            await p.wait_for_timeout(1500)
            await p.evaluate("() => startAppFromWelcome && startAppFromWelcome()")
            await p.wait_for_timeout(2500)
            # lazy vrstva (duvera.js) musi dobehnout, jinak se pouzije zaloha
            try:
                await p.wait_for_function("() => !!window.AGDuvera", timeout=12000)
                ok('js/duvera.js se nacetl (jednotna stupnice presnosti)', True)
            except Exception:
                ok('js/duvera.js se nacetl (jednotna stupnice presnosti)', False, 'bezi zaloha v grafika.js')
            now = await p.evaluate("() => Date.now()")
            pts = json.loads(json.dumps(PTS))
            for k, off in zip(pts, (60000, 3600000, 86400000 * 2, 86400000 * 9, 300000)):
                k['prov']['ts'] = now - off
            await p.evaluate("(x) => window.addImportedPoints(x)", pts)
            await p.wait_for_timeout(500)
            # aby slo overit i chovani bez ceho appka pocita se skrytymi body
            await p.evaluate("() => openManageModal()")
            await p.wait_for_timeout(900)
            # toast z Wake Locku prekryva hlavicku - at nekazi fotku
            await p.evaluate("() => document.querySelectorAll('#quick-toast,.quick-toast').forEach(e => e.remove())")

            # ---- A1: radky ----
            n = await p.evaluate("() => document.querySelectorAll('#manage-list .cp-item.mngr').length")
            ok('vsech 5 bodu je v seznamu jako radek', n == 5, 'nalezeno %d' % n)
            h = await p.evaluate("() => { const e = document.querySelector('#manage-list .cp-item.mngr'); return e ? Math.round(e.getBoundingClientRect().height) : 0; }")
            ok('radek je nizky (drive karta ~150 px)', 0 < h < 70, 'vyska %d px' % h)
            kpi = await p.evaluate("() => [...document.querySelectorAll('.mng-kpi b')].map(e => e.textContent)")
            ok('souhrn zakazky ukazuje tri cisla', len(kpi) == 3, str(kpi))
            ok('souhrn zna pocet bodu', kpi and kpi[0] == '5', str(kpi))
            far = await p.evaluate("() => [...document.querySelectorAll('.mngr-far b')].map(e => e.textContent)")
            ok('kazdy radek ma vzdalenost', len(far) == 5, str(far))
            az = await p.evaluate("() => [...document.querySelectorAll('.mngr-far small')].map(e => e.textContent)")
            ok('radky maji azimut nebo "stojis na nem"', all(x.strip() for x in az), str(az))
            # barva presnosti podle stupnice
            cols = await p.evaluate("""() => [...document.querySelectorAll('.mngr-acc')].map(e => ({
                t: e.textContent, q: e.getAttribute('data-q'), c: getComputedStyle(e).color }))""")
            print('     presnosti: ' + a(json.dumps(cols, ensure_ascii=False)))
            qs = [c['q'] for c in cols]
            ok('presnost je odstupnovana (ne vsechno stejne)', len(set(qs)) >= 2, str(qs))
            ok('nejhorsi bod (+-6,6 m) je oznaceny jako spatny', 'bad' in qs, str(qs))
            # stari
            age = await p.evaluate("() => [...document.querySelectorAll('.mngr-id small')].map(e => e.textContent.split('\\u00b7')[0].trim())")
            print('     stari: ' + a(json.dumps(age, ensure_ascii=False)))
            ok('u bodu je videt stari mereni', all(x for x in age), str(age))
            # puvod = barva prouzku
            orig = await p.evaluate("() => [...document.querySelectorAll('.cp-item.mngr')].map(e => (e.dataset.orig || '') + '/' + (e.classList.contains('cp-watch') ? 'watch' : ''))")
            ok('bod z hodinek je rozeznatelny', any('watch' in x for x in orig), str(orig))
            ok('importovany bod je rozeznatelny', any(x.startswith('import') for x in orig), str(orig))
            await p.screenshot(path=os.path.join(OUT, 'A1-seznam.png'))

            # ---- hledani porad funguje ----
            await p.evaluate("() => { const i = document.getElementById('mng-search'); i.value = 'sloup'; i.dispatchEvent(new Event('input')); }")
            await p.wait_for_timeout(400)
            vis = await p.evaluate("() => [...document.querySelectorAll('#manage-list .cp-item.mngr')].filter(e => e.style.display !== 'none').length")
            ok('hledani podle kodu porad funguje', vis == 1, 'videt %d' % vis)
            await p.evaluate("() => { const i = document.getElementById('mng-search'); i.value = ''; i.dispatchEvent(new Event('input')); }")
            await p.wait_for_timeout(300)

            # ---- razeni chipy ----
            await p.evaluate("() => [...document.querySelectorAll('[data-sort]')].find(b => b.dataset.sort === 'dist').click()")
            await p.wait_for_timeout(600)
            order = await p.evaluate("() => [...document.querySelectorAll('.mngr-id > b')].map(e => e.textContent.trim().split(' ')[0])")
            ok('chip "Nejblizsi" seradil seznam', order and order[0] == '1001', str(order))

            # ---- A2: detail na tuknuti ----
            await p.evaluate("() => document.querySelector('#manage-list .cp-item.mngr').click()")
            await p.wait_for_timeout(500)
            det = await p.evaluate("() => !!document.querySelector('.cp-item.mngr.mngr-open .mngr-det')")
            ok('tuknuti na radek rozbali detail', det)
            fields = await p.evaluate("() => [...document.querySelectorAll('.mngr-det .mngr-grid i')].map(e => e.textContent)")
            ok('detail ukazuje Y, X, Z a cas mereni', fields == ['Y', 'X', 'Z', 'Měřeno'], str(fields))
            yv = await p.evaluate("() => { const b = document.querySelector('.mngr-det .mngr-grid b'); return b ? b.textContent : ''; }")
            ok('Y v detailu je souradnice S-JTSK', yv.replace('.', '').isdigit() and len(yv) > 6, yv)
            acts = await p.evaluate("() => [...document.querySelectorAll('.mngr-det .mngr-act')].map(e => e.textContent)")
            ok('detail ma ctyri akce vc. Navest', acts == ['Navést', 'Upravit', 'Kopírovat', 'Smazat'], str(acts))
            await p.screenshot(path=os.path.join(OUT, 'A2-detail.png'))
            # druhy bod zavre prvni
            await p.evaluate("() => document.querySelectorAll('#manage-list .cp-item.mngr')[1].click()")
            await p.wait_for_timeout(400)
            opened = await p.evaluate("() => document.querySelectorAll('.cp-item.mngr.mngr-open').length")
            ok('rozbaleny je vzdy jen jeden bod', opened == 1, 'rozbaleno %d' % opened)
            # zavreni tymz radkem
            await p.evaluate("() => document.querySelectorAll('#manage-list .cp-item.mngr')[1].click()")
            await p.wait_for_timeout(400)
            opened = await p.evaluate("() => document.querySelectorAll('.cp-item.mngr.mngr-open').length")
            ok('dalsi tuknuti detail zase zavre', opened == 0, 'rozbaleno %d' % opened)

            # ---- Navest = puvodni chovani (zameri bod a zavre seznam) ----
            await p.evaluate("() => document.querySelector('#manage-list .cp-item.mngr').click()")
            await p.wait_for_timeout(400)
            await p.evaluate("() => document.querySelector('.mngr-det .mngr-act-go').click()")
            await p.wait_for_timeout(700)
            closed = await p.evaluate("() => document.getElementById('manage-modal').style.display")
            ok('"Navest" zameri bod a zavre seznam', closed == 'none', closed)

            # ---- rezim vyberu porad funguje ----
            await p.evaluate("() => openManageModal()")
            await p.wait_for_timeout(700)
            await p.evaluate("() => document.getElementById('mng-selbtn').click()")
            await p.wait_for_timeout(500)
            await p.evaluate("() => document.querySelector('#manage-list .cp-item.mngr').click()")
            await p.wait_for_timeout(300)
            sel = await p.evaluate("() => document.querySelectorAll('.cp-item.mng-selected').length")
            ok('rezim vyberu (hromadne akce) porad funguje', sel == 1, 'vybrano %d' % sel)
            hasBulk = await p.evaluate("() => !!document.querySelector('.mng-actions #mng-del')")
            ok('panel hromadnych akci je videt', hasBulk)
            await p.screenshot(path=os.path.join(OUT, 'A1-vyber.png'))
            await p.evaluate("() => document.getElementById('mng-selbtn').click()")
            await p.wait_for_timeout(400)
            await p.evaluate("() => closeManageModal()")
            await p.wait_for_timeout(300)

            # ---- B1: paleta nastroju ----
            await p.evaluate("() => { const m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; }")
            await p.wait_for_timeout(600)
            await p.evaluate("() => { const m = document.getElementById('tools-modal'); if (m) m.style.display = 'none'; }")
            await p.evaluate("() => window.AGGesta && window.AGGesta.open()")
            await p.wait_for_timeout(700)
            await p.evaluate("() => { const a = document.getElementById('ag-gz-add'); if (a) a.click(); }")
            await p.wait_for_timeout(800)
            has = await p.evaluate("() => !!document.getElementById('ag-gz-tools')")
            ok('okno vyberu nastroje se otevre', has)
            if has:
                rows = await p.evaluate("() => document.querySelectorAll('#ag-gz-tools button.ag-gz-t').length")
                ok('polozky maji novy tvar (ikona + text)', rows > 5, '%d radku' % rows)
                icos = await p.evaluate("() => [...document.querySelectorAll('#ag-gz-tools .ag-gz-ic svg')].length")
                ok('kazda polozka ma ikonu', icos == rows, '%d ikon / %d radku' % (icos, rows))
                cats = await p.evaluate("() => [...new Set([...document.querySelectorAll('#ag-gz-tools .ag-gz-ic')].map(e => e.className))]")
                ok('ikony maji barvu podle kategorie', len(cats) >= 2, str(cats))
                hot = await p.evaluate("() => document.querySelectorAll('#ag-gz-tools .ag-gz-t-hot').length")
                ok('prvni vysledek je zvyrazneny (potvrdi ho Enter)', hot == 1, '%d' % hot)
                await p.screenshot(path=os.path.join(OUT, 'B1-paleta.png'))
                # hledani + zvyrazneni + synonyma
                await p.evaluate("() => { const i = document.getElementById('ag-gz-q'); i.value = 'vzdál'; i.dispatchEvent(new Event('input')); }")
                await p.wait_for_timeout(400)
                mark = await p.evaluate("() => { const e = document.querySelector('#ag-gz-tools em'); return e ? e.textContent : ''; }")
                ok('napsany text je ve vysledku zvyrazneny', mark.lower().startswith('vzd'), mark)
                await p.screenshot(path=os.path.join(OUT, 'B1-hledani.png'))
                # synonymum, ktere v nazvu nastroje NENI
                await p.evaluate("() => { const i = document.getElementById('ag-gz-q'); i.value = 'pasmo'; i.dispatchEvent(new Event('input')); }")
                await p.wait_for_timeout(400)
                syn = await p.evaluate("() => [...document.querySelectorAll('#ag-gz-tools button.ag-gz-t b')].map(e => e.textContent)")
                ok('hleda i podle synonym z registru ("pasmo")', len(syn) > 0, str(syn))
                # Enter otevre prvni vysledek
                await p.evaluate("() => { const i = document.getElementById('ag-gz-q'); i.value = 'vzdál'; i.dispatchEvent(new Event('input')); }")
                await p.wait_for_timeout(300)
                await p.focus('#ag-gz-q')
                await p.keyboard.press('Enter')
                await p.wait_for_timeout(600)
                gone = await p.evaluate("() => document.getElementById('ag-gz-pick').style.display")
                ok('Enter potvrdi prvni vysledek', gone == 'none', gone)

            print('\nchyby stranky: ' + a(errs[:5] if errs else 'zadne'))
            bad = [n for good, n in res if not good]
            print('\nVYSLEDEK: %d/%d' % (len(res) - len(bad), len(res)))
            for n in bad:
                print('  SELHALO: ' + a(n))
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
