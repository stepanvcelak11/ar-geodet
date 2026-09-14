# -*- coding: utf-8 -*-
u"""Regrese k hlášení z 14. 9. 2026 (v315): sdílení appky jen pro vlastníka,
menší dosah bodů, režim „Slabší telefon".

  A  „Sdílet aplikaci (QR)" v panelu Více vidí jen VLASTNÍK (lidi, co si appku
     stáhli přes QR jako PWA, se v Google Play nikdy neobjevili jako testeři)
  B  výchozí dosah: mapa 300 m (dřív 1000), AR 100 m (dřív 150); uložené staré
     výchozí 1000/150 se jednou srovnají, jiná uložená hodnota se nechá
  C  úřední body dál než dosah v mapě se do mapy NEKRESLÍ; vlastní body ano
  D  Slabší telefon: ručně zapnuto → html.ag-lite, karta v Nastavení; automaticky
     při ≤ 3 GB paměti; vypnuto → nic

Spuštění:  python scripts/test_slabsi_dosah.py [port]
"""
import io
import os
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

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8971)
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
                return srv, u
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None, None


# body: posun o metry na sever (1 m ≈ 1/111320°)
def bod(name, dn, cat):
    return {'id': 'p_' + name, 'name': name, 'lat': LAT + dn / 111320.0, 'lng': LNG, 'cat': cat,
            'type': 'polohovy', 'hidden': False}


SEED = """
localStorage.setItem('default_arOfflinePoints12', %s);
localStorage.setItem('default_arCustomPoints12', %s);
""" % (json.dumps(json.dumps([bod('blizko', 100, 'PBPP'), bod('stred', 250, 'TB'), bod('daleko', 340, 'PBPP')])),
       json.dumps(json.dumps([bod('muj-daleko', 340, 'CUSTOM')])))


async def stranka(br, url, init, chyby, geo=True):
    kw = dict(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    if geo:
        kw.update(geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'])
    ctx = await br.new_context(**kw)
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)
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

        # ---- A: sdílení appky jen pro vlastníka ------------------------------
        ctx, page = await stranka(br, url, boot(tarif='zaklad'), chyby)
        await cekej(page, "document.body.classList.contains('app-started')")
        await page.wait_for_timeout(2500)
        a = await page.evaluate("""() => { var b = document.getElementById('menu-sdilet-app'); return b ? b.hidden : null; }""")
        ok('A1 běžný účet: „Sdílet aplikaci (QR)" je schované', a is True, a)
        ok('A2 pruh Nastavení už neslibuje sdílení', await page.evaluate("() => !/sdílení/.test(document.getElementById('ag-set-vice').textContent)"))

        # ---- B: nové výchozí + migrace ---------------------------------------
        r = await page.evaluate("() => ({ mapa: mapRadius, ar: arRadius, w: +document.getElementById('s-map-radius-slider').value, a: +document.getElementById('s-ar-radius-slider').value })")
        ok('B1 čistý start: dosah mapa 300 m, AR 100 m', r['mapa'] == 300 and r['ar'] == 100, r)
        ok('B2 táhla v Nastavení ukazují totéž', r['w'] == 300 and r['a'] == 100, r)
        await ctx.close()

        ctx, page = await stranka(br, url, boot(tarif='zaklad') + "localStorage.setItem('default_arRadiusMap','1000'); localStorage.setItem('default_arRadiusAR','150');", chyby)
        await cekej(page, "document.body.classList.contains('app-started')")
        r = await page.evaluate("() => ({ mapa: mapRadius, ar: arRadius, flag: getStoredData('arDosah315') })")
        ok('B3 uložené STARÉ výchozí 1000/150 se jednou srovnají na 300/100', r['mapa'] == 300 and r['ar'] == 100 and r['flag'] == '1', r)
        await ctx.close()

        ctx, page = await stranka(br, url, boot(tarif='zaklad') + "localStorage.setItem('default_arRadiusMap','2000'); localStorage.setItem('default_arRadiusAR','500');", chyby)
        await cekej(page, "document.body.classList.contains('app-started')")
        r = await page.evaluate("() => ({ mapa: mapRadius, ar: arRadius })")
        ok('B4 vlastní nastavený dosah 2000/500 se NEsahá', r['mapa'] == 2000 and r['ar'] == 500, r)
        await ctx.close()

        # ---- A (vlastník) ------------------------------------------------------
        ctx, page = await stranka(br, url, "localStorage.setItem('agVlastnik_v1','1'); localStorage.setItem('agFbKey_v1','x'); " + boot(tarif='pro'), chyby)
        await cekej(page, "document.body.classList.contains('app-started')")
        await page.wait_for_timeout(2500)
        a = await page.evaluate("""() => { var b = document.getElementById('menu-sdilet-app'); return b ? b.hidden : null; }""")
        ok('A3 vlastník: „Sdílet aplikaci (QR)" vidí', a is False, a)
        await ctx.close()

        # ---- C: dosah v mapě -----------------------------------------------------
        ctx, page = await stranka(br, url, boot(tarif='zaklad') + SEED, chyby)
        await cekej(page, "document.body.classList.contains('app-started')")
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        await page.wait_for_timeout(2500)
        # druhý fix (o 0,3 m vedle) — v terénu GPS tiká každou sekundu, Playwright dá jen jeden
        await ctx.set_geolocation({'latitude': LAT + 0.3 / 111320.0, 'longitude': LNG, 'accuracy': 3})
        await page.wait_for_timeout(1500)
        m = await page.evaluate("""() => {
            var jmena = [];
            markersGroup.eachLayer(function (l) { var el = l.getElement && l.getElement(); if (el) { var t = el.querySelector('.map-label-text'); jmena.push(t ? t.textContent : '?'); } });
            return { fix: typeof userLat === 'number', dosah: mapRadius, jmena: jmena.sort(),
                     dist: arPoints.map(function (p) { return p.name + ':' + Math.round(p.currentDist || -1); }) };
        }""")
        ok('C0 GPS fix dorazil', m['fix'], m)
        ok('C1 úřední body do 300 m jsou v mapě', 'blizko' in m['jmena'] and 'stred' in m['jmena'], m)
        ok('C2 úřední bod 340 m daleko (za dosahem, ale ve výřezu) v mapě NENÍ', 'daleko' not in m['jmena'], m)
        ok('C3 vlastní bod 340 m daleko v mapě JE (zakázka se nekrátí)', 'muj-daleko' in m['jmena'], m)
        # zvětšení dosahu z Nastavení → vzdálený bod se objeví
        await page.evaluate("() => { document.getElementById('s-map-radius-slider').value = 1000; saveSettings(); }")
        await page.wait_for_timeout(1500)
        j2 = await page.evaluate("""() => { var j = []; markersGroup.eachLayer(function (l) { var el = l.getElement && l.getElement(); if (el) { var t = el.querySelector('.map-label-text'); j.push(t ? t.textContent : '?'); } }); return j; }""")
        ok('C4 po zvětšení dosahu na 1000 m se vzdálený úřední bod objeví', 'daleko' in j2, j2)

        # ---- D: slabší telefon -------------------------------------------------
        ok('D0 modul AGLite je načtený', await page.evaluate("() => !!window.AGLite"))
        ok('D1 výchozí (silný stroj): plné zobrazení', await page.evaluate("() => !document.documentElement.classList.contains('ag-lite') && !AGLite.lite"))
        await page.evaluate("() => AGLite.nastav('on')")
        await page.wait_for_timeout(400)
        d = await page.evaluate("""() => ({ cls: document.documentElement.classList.contains('ag-lite'), lite: AGLite.lite,
            karta: !!document.getElementById('agl-card'), vTabu: !!document.querySelector('#tab-ar #agl-card'),
            sel: (document.getElementById('agl-rezim') || {}).value, stav: (document.getElementById('agl-stav') || {}).textContent,
            ulozeno: localStorage.getItem('agSlabsiTelefon_v1') })""")
        ok('D2 ručně zapnuto → třída ag-lite + AGLite.lite', d['cls'] and d['lite'], d)
        ok('D3 karta „Slabší telefon" je v Nastavení → AR & přesnost', d['karta'] and d['vTabu'] and d['sel'] == 'on', d)
        ok('D4 stav hlásí úsporné zobrazení (ručně)', 'úsporné' in (d['stav'] or '') and 'ručně' in (d['stav'] or ''), d)
        ok('D5 volba se ukládá', d['ulozeno'] == 'on', d)
        # sklo pryč v celé appce
        bf = await page.evaluate("() => getComputedStyle(document.querySelector('.modal-content')).backdropFilter")
        ok('D6 bez skla (backdrop-filter none) v modálech', bf in ('none', ''), bf)
        await page.evaluate("() => AGLite.nastav('off')")
        await page.wait_for_timeout(300)
        ok('D7 vypnuto → bez třídy', await page.evaluate("() => !document.documentElement.classList.contains('ag-lite') && !AGLite.lite"))
        await ctx.close()

        ctx, page = await stranka(br, url, "Object.defineProperty(navigator, 'deviceMemory', { get: function () { return 2; } });" + boot(tarif='zaklad'), chyby)
        await page.wait_for_timeout(500)
        d = await page.evaluate("() => ({ cls: document.documentElement.classList.contains('ag-lite'), lite: !!(window.AGLite && AGLite.lite) })")
        ok('D8 telefon s 2 GB: úsporné zobrazení automaticky', d['cls'] and d['lite'], d)
        await ctx.close()

        # ---- grafika.js: háčky režimu stojí -----------------------------------
        src = io.open(os.path.join(ROOT, 'js', 'grafika.js'), encoding='utf-8').read()
        ok('D9 kompas 20×/s, kamera 480p, strop 40 značek, otáčení mapy po 0,8°, menší dávky',
           src.count('AGLite.lite') >= 5 and 'AGLite.camVideo' in src and 'maxPts = 40' in src, src.count('AGLite.lite'))

        # 403 z /owner/prehled = konzole vlastníka bez klíče (test A3 vlastníka bez serveru) — není chyba appky
        vazne = [c for c in chyby if 'favicon' not in c and 'net::ERR' not in c and '404' not in c and 'tile.openstreetmap' not in c and '/owner/' not in c]
        ok('Z bez chyb stránky', not vazne, vazne[:5])
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
