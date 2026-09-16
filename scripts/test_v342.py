# -*- coding: utf-8 -*-
"""OPRAVA GPS Z MAPY ZA CHUZE (16. 9. 2026, v342) — napad uzivatele: klepnu do mapy, kde stojim,
appka spocita vektor (klepnuti − GPS) a pricita ho i ZIVE POLOZE (AR, navigace, prumer) 10 min / 100 m.

  A  nastroj se otevre z Nastroju (MANIFEST), okno ma „Jednoduse" + stav prumeru GPS
  B  spocitej: klepnuti 3 m vychodne od prumeru GPS → posun 3 m V, presnost = klik ⊕ sterr
  C  zapni(live): agRefShift src 'mapa', live; dalsi GPS fix → userLat/userLng posunute proti
     AGFixRaw presne o vektor; pilulka „Korekce GPS … ještě N min"
  D  ulozeny bod z prumeru GPS: NEposouva se podruhe (refShift.live), poloha = posunuty prumer
  E  jeden fix (bez prumeru) → varovani „spíš náhodná"; vypni → zivy posun 0; expirace (t − 11 min)
     → agZivyPosun null; statická Poloha z mapy aktivni → rawGps null
  F  navod v navody.json, karta 7 v pruvodci Presne mereni, registr

Spusteni: python scripts/test_v342.py [port]
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
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9169)
vysledky = []
LAT, LNG = 50.0755, 14.4378
MLAT = 111320.0
MLNG = 111320.0 * math.cos(math.radians(LAT))


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


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
        try:
            t = urllib.request.urlopen('http://127.0.0.1:%d/js/ref-calibration.js' % p, timeout=2).read().decode('utf-8', 'replace')
            if 'agZivyPosun' in t and srv.poll() is None:
                return srv, u
        except Exception:
            pass
        srv.terminate()
    return None, None


GPS_JS = "gpsAvgResult = { lat: %f, lng: %f, n: 20, total: 20, sigma: 0.6, sterr: 0.4, acc: 2.5, coarse: false, alt: null, altSterr: null, altN: 0, ts: Date.now() };" % (LAT, LNG)


async def stranka(br, url, init, chyby):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)

    async def route_vse(route, request):
        u = request.url
        try:
            if 'cuzk.cz/' in u or 'cuzk.gov.cz/' in u or 'openstreetmap' in u or 'workers.dev' in u:
                return await route.abort()
        except Exception:
            pass
        try:
            await route.continue_()
        except Exception:
            pass
    await page.route('**/*', route_vse)
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
        ctx, page = await stranka(br, url, boot(tarif='pro') + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.removeItem('agRefShift');", chyby)
        ok('0 appka nastartovala', await cekej(page, "document.body.classList.contains('app-started')"))
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        await page.wait_for_timeout(800)

        # ---- A: otevreni z Nastroju ---------------------------------------------------------
        await page.evaluate("() => AGLazyTools.open('korekce-z-mapy')")
        ok('A1 nastroj se nacetl a otevrel', await cekej(page, "window.AGKorekceMapa && document.getElementById('agkm-modal') && document.getElementById('agkm-modal').style.display === 'flex'", 25))
        await page.evaluate("() => { %s AGKorekceMapa.open(); }" % GPS_JS)
        await page.wait_for_timeout(300)
        a = await page.evaluate("() => document.getElementById('agkm-body').textContent")
        ok('A2 okno: „Jednoduše", stav prumeru GPS (20 mereni), tlacitko Klepnout', 'Jednoduše' in a and '20 měření' in a and 'Klepnout, kde stojím' in a, a[:300])
        reg = await page.evaluate("() => ({ reg: !!(window.AGToolsRegistry ? null : true), tile: !!document.querySelector('#tools-modal .tool-tile[data-tool=\"korekce-z-mapy\"]') })")
        ok('A3 dlazdice v Nastrojich (Presne mereni)', reg['tile'], reg)

        # ---- B: vypocet ---------------------------------------------------------------------
        b = await page.evaluate("""([la, ln, mlng]) => { %s const v = AGKorekceMapa._test.spocitej(la, ln + 3.0 / mlng, 19); return v && { mag: v.mag, dE: v.dE, dN: v.dN, klik: v.klik, acc: v.acc, from: v.gps.from, n: v.gps.n }; }""" % GPS_JS, [LAT, LNG, MLNG])
        ok('B1 klepnuti 3 m vychodne → posun 3,0 m V, klik ±1,5 m (zoom 19 = 0,19 m/px × 8 px), presnost = √(klik²+0,4²)', b and abs(b['mag'] - 3.0) < 0.02 and abs(b['dE'] - 3.0) < 0.02 and abs(b['dN']) < 0.02 and b['from'] == 'avg' and abs(b['acc'] - math.sqrt(b['klik'] ** 2 + 0.16)) < 0.01 and 1.4 < b['klik'] < 1.6, b)

        # ---- C: zapnout live → zivy posun v dalsim fixu ------------------------------------------
        await page.evaluate("""([la, ln, mlng]) => { %s const v = AGKorekceMapa._test.spocitej(la, ln + 3.0 / mlng, 19); AGKorekceMapa._test.zapni(v, true); }""" % GPS_JS, [LAT, LNG, MLNG])
        sh = await page.evaluate("() => ({ src: window.agRefShift.src, live: window.agRefShift.live, on: window.agRefShift.on, ls: JSON.parse(localStorage.getItem('agRefShift')).src })")
        ok('C1 agRefShift src mapa, live, ulozeno', sh['src'] == 'mapa' and sh['live'] and sh['on'] and sh['ls'] == 'mapa', sh)
        await ctx.set_geolocation({'latitude': LAT + 10.0 / MLAT, 'longitude': LNG, 'accuracy': 3})
        await page.wait_for_timeout(2500)
        c = await page.evaluate("() => ({ raw: window.AGFixRaw, u: [userLat, userLng], zp: window.agZivyPosun() })")
        dE = (c['u'][1] - c['raw']['lng']) * MLNG; dN = (c['u'][0] - c['raw']['lat']) * MLAT
        ok('C2 novy fix: userLat/userLng = surovy fix + 3 m vychodne (AGFixRaw nezmeneny)', abs(dE - 3.0) < 0.05 and abs(dN) < 0.05 and abs(c['raw']['lat'] - (LAT + 10.0 / MLAT)) < 1e-7 and c['zp'], {'dE': dE, 'dN': dN, 'zp': c['zp']})
        await page.evaluate("() => window.agRefShiftWatch()")
        pill = await page.evaluate("() => { var p = document.getElementById('agref-pill'); return p ? p.textContent : ''; }")
        ok('C3 pilulka: Korekce GPS ~3 m, jeste ~10 min', 'Korekce GPS' in pill and 'min' in pill, pill)
        ok('C4 okno nastroje hlasi zapnutou opravu s zivou polohou', await cekej(page, "AGKorekceMapa.open() || document.getElementById('agkm-body').textContent.indexOf('živou polohu') >= 0", 5), await page.evaluate("() => document.getElementById('agkm-body').textContent.slice(0, 200)"))
        await page.evaluate("() => AGKorekceMapa.close()")

        # ---- D: ulozeny bod se neposouva podruhe ---------------------------------------------
        d = await page.evaluate("""([la, ln, mlng]) => { gpsAvgResult = { lat: la, lng: ln + 3.0 / mlng, n: 20, total: 20, sigma: 0.6, sterr: 0.4, acc: 2.5, coarse: false, alt: null, altSterr: null, altN: 0, ts: Date.now() };
            openNewPointModal(); fillAveragedGPS(); document.getElementById('custom-name').value = 'M1'; var n0 = persistentCustomPoints.length; saveCustomPoint();
            var p = persistentCustomPoints[persistentCustomPoints.length - 1];
            return { pribyl: persistentCustomPoints.length === n0 + 1, dE: (p.lng - ln) * mlng, rs: p.refShift }; }""", [LAT, LNG, MLNG])
        ok('D1 bod z (uz posunuteho) prumeru: +3 m V, ne +6; refShift.live, src mapa', d['pribyl'] and abs(d['dE'] - 3.0) < 0.05 and d['rs'] and d['rs'].get('live') and d['rs'].get('src') == 'mapa', d)
        await page.evaluate("() => { try { closeNewPointModal && closeNewPointModal(); } catch (e) {} }")

        # ---- E: jeden fix, vypnuti, expirace, staticka poloha z mapy ---------------------------
        e1 = await page.evaluate("""([la, ln, mlng]) => { gpsAvgResult = null; const v = AGKorekceMapa._test.spocitej(la, ln + 2.0 / mlng, 19); return v && { from: v.gps.from, gpsAcc: v.gpsAcc, acc: v.acc }; }""", [LAT, LNG, MLNG])
        ok('E1 bez prumeru = jeden fix (AGFixRaw): presnost GPS ≥ 1,5 m', e1 and e1['from'] == 'fix' and e1['gpsAcc'] >= 1.5 and e1['acc'] > e1['gpsAcc'], e1)
        e2 = await page.evaluate("() => { AGKorekceMapa._test.vypni(); return { on: window.agRefShift.on, zp: window.agZivyPosun() }; }")
        ok('E2 vypnout → zivy posun null', e2['on'] is False and e2['zp'] is None, e2)
        e3 = await page.evaluate("() => { window.agRefShift.on = true; window.agRefShift.t = Date.now() - 11 * 60000; return window.agZivyPosun(); }")
        ok('E3 starsi nez 10 min → zivy posun null (sam se prestane pricitat)', e3 is None, e3)
        # AGManualPos.active je getter → statickou polohu z mapy zapnout doopravdy (take) a pak zrusit
        e4 = await page.evaluate("([la, ln]) => { window.agRefShift.t = Date.now(); AGManualPos.take(la, ln, 19); var r = AGKorekceMapa._test.rawGps(); var act = AGManualPos.active; AGManualPos.clear(); return { r: r, act: act }; }", [LAT, LNG])
        e4 = None if (e4['act'] and e4['r'] is None) else (e4['r'] or e4)
        ok('E4 staticka Poloha z mapy aktivni → zadna GPS k oprave', e4 is None, e4)

        # ---- F: navod, pruvodce, registr ---------------------------------------------------------
        nav = json.load(io.open(os.path.join(ROOT, 'data', 'navody.json'), encoding='utf-8'))
        ok('F1 navod korekce-z-mapy: Jednoduse, 30–60 s, 10 min / 100 m, jeden fix', 'korekce-z-mapy' in nav and all(w in nav['korekce-z-mapy'] for w in ('Jednoduše', '30–60 s', '10 min / 100 m', 'jednoho fixu')))
        reg = io.open(os.path.join(ROOT, 'js', 'tools-registry.js'), encoding='utf-8').read()
        ok('F2 registr + pruvodce Presne mereni', "k: 'korekce-z-mapy'" in reg and "k: 'korekce-z-mapy'" in io.open(os.path.join(ROOT, 'js', 'presne-mereni.js'), encoding='utf-8').read())

        vazne = [c for c in chyby if 'favicon' not in c and 'net::ERR' not in c and '404' not in c and 'Failed to load resource' not in c and 'Failed to fetch' not in c and 'ERR_FAILED' not in c]
        ok('Z bez chyb stranky', not vazne, vazne[:5])
        await ctx.close()
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
