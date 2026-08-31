#!/usr/bin/env python3
# ===== AR Geodet - OPRAVY Z 31. 8. 2026 =======================================
# Overuje v Chromiu ctyri veci, ktere se ten den menily:
#
#   A) STAVOVA BUBLINA je zase HUBENA PILULKA (js/stavovy-pruh.js).
#      Vyrostla na 48 px, protoze se hlavicka zalamovala na dva radky. Staticky
#      se to nepozna - vyska vznika az slozenim pisma, odsazeni a flex-wrap.
#
#   B) ROCENKA a BODY NA SOBE jsou CELOOBRAZOVKOVE MODALY (js/rocenka.js,
#      js/kolize-bodu.js). Mely `class="modal"`, coz je trida, ktera v appce
#      NEEXISTUJE - <div> pak nedostal position:fixed a protoze je <body>
#      flex-sloupec (kamera + mapa), stal se z okna TRETI SLOUPEC LAYOUTU:
#      ve splitu se vykreslilo misto mapy a kamera nad nim bezela dal.
#
#   C) LISTA "Nova verze" se ukaze NEJVYS JEDNOU ZA DEN (js/co-je-noveho.js)
#      a aktualizovat jde trvale z okna Historie aktualizaci
#      (js/historie-aktualizaci.js). Bez druhe poloviny by se prvni zmena
#      zvrhla v "nedá se aktualizovat vubec".
#
#   D) GESTA: po aktivacnim gestu staci na kazdou sipku zkratky KRATSI TAH
#      (js/gesta-zkratky.js). Meri se DOTYKEM pres CDP a plynulym tahem po
#      8 px - mysi ani skoky prstu by to nezmerily poctive (viz zkusenost
#      z 29. 8., kdy prave skoky zamaskovaly dve vady rozpoznavani).
#
# Pouziti (z korene repa):  python scripts/test_opravy_31_8.py [port]
# ==============================================================================
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8461
URL = None

# Prihlaseny admin lokalni firmy bez hesla: appka se dostane rovnou dovnitr,
# takze se testuje appka a ne prihlasovaci obrazovka.
BOOT = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('arSurveyor','Stepan');
  localStorage.setItem('agFirmaBioAsk_v1', String(Date.now()));
  (function () {
    var f = { enabled: true, firmName: 'Test', createdTs: Date.now(), autoLockMin: 0,
      users: [{ id: 'u1', name: 'Stepan', role: 'admin', salt: 'aa', pinHash: 'x', noPin: true }] };
    localStorage.setItem('agFirma_v1', JSON.stringify(f));
    localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: 'u1', ts: Date.now() }));
  })();
"""

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)) if detail else ''))


def server():
    """Na Windows zustava port po predchozim behu chvili obsazeny - zkousi se vic."""
    global URL
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % port
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                URL = u
                return srv
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None


async def nacti(page):
    for _ in range(4):
        try:
            await page.goto(URL, wait_until='domcontentloaded', timeout=45000)
            break
        except Exception:
            await page.wait_for_timeout(1500)
    await page.wait_for_timeout(2200)
    await page.evaluate("() => { if (typeof window.startAppFromWelcome === 'function') startAppFromWelcome(); }")
    # Gesta i Rocenka jsou lazy moduly - bez tohohle bychom testovali prazdno.
    for _ in range(40):
        if await page.evaluate("() => typeof window.AGGesta === 'object' && typeof window.openRocenka === 'function'"):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(400)
    await page.wait_for_timeout(2500)     # appka se musi usadit (mapa, HUD, moduly)


async def tah(cdp, body, krok=8):
    x, y = body[0]
    await cdp.send('Input.dispatchTouchEvent',
                   {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 1}]})
    for (tx, ty) in body[1:]:
        dx, dy = tx - x, ty - y
        n = max(1, int(round(max(abs(dx), abs(dy)) / krok)))
        for i in range(1, n + 1):
            await cdp.send('Input.dispatchTouchEvent',
                           {'type': 'touchMove',
                            'touchPoints': [{'x': x + dx * i / n, 'y': y + dy * i / n, 'id': 1}]})
        x, y = tx, ty
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


async def main():
    from playwright.async_api import async_playwright
    srv = server()
    if not srv:
        print('Testovaci server nenabehl.')
        return 2
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            ctx = await browser.new_context(viewport={'width': 412, 'height': 915}, has_touch=True,
                                            permissions=['geolocation'],
                                            geolocation={'latitude': 50.08, 'longitude': 14.43, 'accuracy': 3})
            await ctx.add_init_script(BOOT)
            page = await ctx.new_page()
            chyby = []
            page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
            cdp = await ctx.new_cdp_session(page)
            await nacti(page)

            # ---- A) stavova bublina ------------------------------------------
            b = await page.evaluate("""() => {
                const el = document.getElementById('ag-sp'); if (!el) return null;
                const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
                const h = el.querySelector('.ag-sp-head');
                return { v: Math.round(r.height), radius: cs.borderRadius,
                         wrap: h ? getComputedStyle(h).flexWrap : '?',
                         stred: Math.round(Math.abs((r.left + r.right) / 2 - innerWidth / 2)) };
            }""")
            print('A) STAVOVA BUBLINA:', json.dumps(b))
            # 30 px nechava rezervu na vetsi pismo v nastaveni, ale druhy radek
            # (kvuli kteremu z bubliny byl "tlusty pruh") se pod nej uz nevejde.
            ok('bublina je hubena (< 30 px)', b and b['v'] < 30, b and b['v'])
            ok('bublina je pilulka (999px)', b and b['radius'].startswith('999'), b and b['radius'])
            ok('hlavicka se nezalamuje', b and b['wrap'] == 'nowrap', b and b['wrap'])
            ok('bublina je vystredena', b and b['stred'] <= 2, b and b['stred'])

            # ---- B) Rocenka / Body na sobe -----------------------------------
            for jm, fn, mid in (('Rocenka', 'openRocenka', 'ag-roc-modal'),
                                ('Body na sobe', 'openKolizeBodu', 'ag-kol-modal')):
                otevreno = await page.evaluate("(f) => { if (typeof window[f] === 'function') { window[f](); return true; } return false; }", fn)
                if not otevreno:
                    ok(jm + ': modul je k dispozici', False, 'window.' + fn + ' neexistuje')
                    continue
                await page.wait_for_timeout(1400)
                m = await page.evaluate("""(id) => {
                    const el = document.getElementById(id); if (!el) return null;
                    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
                    return { cls: el.className, pos: cs.position, w: Math.round(r.width), h: Math.round(r.height),
                             okno: [innerWidth, innerHeight] };
                }""", mid)
                ok(jm + ': je modal-overlay (ne mrtva trida "modal")',
                   m and 'modal-overlay' in m['cls'], m and m['cls'])
                ok(jm + ': stoji pres celou obrazovku (fixed, ne treti sloupec layoutu)',
                   m and m['pos'] == 'fixed' and m['w'] == m['okno'][0] and m['h'] == m['okno'][1], m)
                await page.evaluate("(id) => { const e = document.getElementById(id); if (e) e.style.display = 'none'; }", mid)
                await page.wait_for_timeout(300)

            # ---- C) lista nova verze ------------------------------------------
            # ⚠ „Poprve za den se ukaze" tady MERIT NEJDE: prvnich 120 s po startu
            #   listu drzi „klid po startu" (js/welcome-card.js) a test tak dlouho
            #   cekat nebude. Meri se druha polovina, ktera je stejne dulezita:
            #   kdyz uz dnesni den utracen JE, lista se schova - a aktualizovat
            #   pujde poradad z okna Historie aktualizaci.
            await page.evaluate("""() => {
                window.__agUpdateWaiting = true;
                localStorage.setItem('agUpdBannerDen_v1',
                    (function () { var d = new Date();
                        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })());
                document.getElementById('update-banner').style.display = 'flex';
            }""")
            await page.wait_for_timeout(1800)
            vid = await page.evaluate("() => getComputedStyle(document.getElementById('update-banner')).display")
            drzeno = await page.evaluate("() => document.getElementById('update-banner').getAttribute('data-ag-held')")
            ok('lista uz dnes byla -> schova se', vid == 'none', vid)
            ok('a nevrati ji zpatky ani "klid po startu"', drzeno is None, drzeno)

            await page.evaluate("() => window.agOpenHistorie && agOpenHistorie()")
            await page.wait_for_timeout(1500)
            ok('v Historii aktualizaci je trvale tlacitko Aktualizovat',
               await page.evaluate("() => !!document.querySelector('.hist-up-go')"))
            # odznak dosypava tik po 4 s (a pri startu jeste nova verze necekala)
            odznak = False
            for _ in range(12):
                odznak = await page.evaluate(
                    "() => !!document.querySelector('#hist-menu-btn .hist-badge, #hist-set-btn .hist-badge')")
                if odznak:
                    break
                await page.wait_for_timeout(800)
            ok('u vstupu do Historie sviti odznak "nova verze"', odznak)
            await page.evaluate("() => window.AGHistorie && AGHistorie.close()")
            await page.wait_for_timeout(400)

            # ---- D) gesta ------------------------------------------------------
            # Aktivacni gesto ma vzdy plny prah (54 px) - ten se zamerne nemenil.
            # Meri se DRUHA POLOVINA: o kolik kratsi smi byt ramena zkratky.
            # Vychozi zkratka: prefix DR + UD = Pocasi (js/gesta-zkratky.js).
            async def zkratka(d):
                await nacti(page)
                await page.evaluate("""() => {
                    window.__spusteno = [];
                    if (window.AGUkony && AGUkony.run) {
                        const o = AGUkony.run.bind(AGUkony);
                        AGUkony.run = function (k) { window.__spusteno.push(k); return o(k); };
                    }
                }""")
                x, y, P = 206, 300, 54
                await tah(cdp, [(x, y), (x, y + P), (x + P, y + P), (x + P, y + P - d), (x + P, y + P)])
                await page.wait_for_timeout(600)
                return 'pocasi' in (await page.evaluate("() => window.__spusteno") or [])

            kratke = await zkratka(34)
            dlouhe = await zkratka(54)
            ok('zkratka jede i s kratkymi rameny (34 px)', kratke)
            ok('zkratka jede dal i s plnymi rameny (54 px)', dlouhe)

            print('--- chyby v konzoli (%d) ---' % len(chyby))
            for e in chyby[:10]:
                print(' ', e.encode('ascii', 'replace').decode('ascii'))
            ok('zadna chyba v konzoli', len(chyby) == 0, chyby[:2])
            await browser.close()
    finally:
        srv.terminate()

    spatne = [j for dobre, j in vysledky if not dobre]
    print('\nVYSLEDEK: %d/%d' % (len(vysledky) - len(spatne), len(vysledky)))
    return 1 if spatne else 0


sys.exit(asyncio.run(main()))
