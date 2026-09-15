# -*- coding: utf-8 -*-
u"""Regrese k v321/v324 (15. 9. 2026): dva nástroje „zpřesnění GPS čistě softwarem".
  A  AKUSTICKÝ DÁLKOMĚR (js/akusticky-dalkomer.js): dlaždice + návod, okno se otevře,
     mikrofon se zapne (fake zařízení Chromia) a telefon B přejde do „Poslouchám",
     uložené délky → protínání z délek → bod v zakázce s prov.origin 'akustika'
  B  KALIBRACE CHŮZÍ PO HRANĚ (js/kalibrace-hranou.js): čára ze dvou bodů, simulovaná
     chůze s posunutou GPS, výsledek = správný vektor, Zapnout korekci → agRefShift
  H  HLÍDAČ PLATNOSTI (js/ref-calibration.js): pilulka zelená/oranžová/červená, toasty
     5 min před vypršením, po 20 min, na 200 m a 300 m (každý jednou), klepnutí, vypnutí
Matematika obou je zvlášť v scripts/test_akustika.py a scripts/test_hrana.py.
Spuštění:  python scripts/test_zpresneni_gps.py [port]
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
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8987)
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
                return srv, u
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None, None


def ll(x, y):
    return {'lat': LAT + y / MLAT, 'lng': LNG + x / MLNG}


# dva body: A (0,0) a B (60 m na východ) — čára pro kalibraci; C (30, 0) a D (30, 40) pro protínání
PA, PB, PC, PD = ll(0, 0), ll(60, 0), ll(30, 0), ll(30, 40)
BODY = [
    {'id': 'cp_A', 'name': 'HRANA-A', 'lat': PA['lat'], 'lng': PA['lng'], 'cat': 'CUSTOM', 'type': 'custom'},
    {'id': 'cp_B', 'name': 'HRANA-B', 'lat': PB['lat'], 'lng': PB['lng'], 'cat': 'CUSTOM', 'type': 'custom'},
    {'id': 'cp_C', 'name': 'ZNAMY-C', 'lat': PC['lat'], 'lng': PC['lng'], 'cat': 'CUSTOM', 'type': 'custom'},
    {'id': 'cp_D', 'name': 'ZNAMY-D', 'lat': PD['lat'], 'lng': PD['lng'], 'cat': 'CUSTOM', 'type': 'custom'},
]
# cíl protínání: (9, 12) od C → d1 = 15; od D: (9, -28) → d2 = 29.41
CIL = ll(30 + 9, 12)
D1, D2 = math.hypot(9, 12), math.hypot(9, 28)
DELKY = [
    {'t': 1758000000000, 'd': round(D1, 3), 'u': 0.03, 'n': 3, 'pt': {'id': 'cp_C', 'name': 'ZNAMY-C', 'lat': PC['lat'], 'lng': PC['lng']}, 'note': ''},
    {'t': 1758000100000, 'd': round(D2, 3), 'u': 0.03, 'n': 3, 'pt': {'id': 'cp_D', 'name': 'ZNAMY-D', 'lat': PD['lat'], 'lng': PD['lng']}, 'note': ''},
]
SEED = ("localStorage.setItem('default_arCustomPoints12', %s); localStorage.setItem('agAkuDelky_v1', %s);"
        % (json.dumps(json.dumps(BODY)), json.dumps(json.dumps(DELKY))))


async def stranka(br, url, init, chyby):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation', 'microphone'])
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
        br = await pw.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        chyby = []
        ctx, page = await stranka(br, url, boot(tarif='pro') + SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');", chyby)
        await cekej(page, "document.body.classList.contains('app-started')")
        await cekej(page, "typeof userLat === 'number' && userLat", 30)

        # ---- registr + dlaždice --------------------------------------------------
        reg = await page.evaluate("""() => ({ aku: AGReg.help('akusticky-dalkomer'), hr: AGReg.help('kalibrace-hranou'), pro: [AGReg.rec ? !!AGReg.rec('akusticky-dalkomer').pro : null] })""")
        ok('R1 oba nástroje mají v registru návod', reg['aku'] and reg['aku']['t'] and reg['hr'] and reg['hr']['t'], reg)
        nav = await page.evaluate("""() => AGReg.helpAsync('akusticky-dalkomer').then(h => (h.h || '').length)""")
        ok('R2 tělo návodu (data/navody.json) se dotáhne', nav > 400, nav)
        tiles = await page.evaluate("""() => ({ aku: !!document.querySelector('[data-tool="akusticky-dalkomer"]'), hr: !!document.querySelector('[data-tool="kalibrace-hranou"]'), lazy: !!(window.AGLazyTools) })""")
        ok('R3 dlaždice obou nástrojů existují (zástupce z lazy-tools)', tiles['aku'] and tiles['hr'], tiles)

        # ---- B: kalibrace chůzí po hraně ---------------------------------------------
        await page.evaluate("() => AGLazyTools.open('kalibrace-hranou')")
        ok('B1 okno se otevře', await cekej(page, "window.AGHrana && document.getElementById('ag-hr-modal') && getComputedStyle(document.getElementById('ag-hr-modal')).display === 'flex'"), chyby[-3:])
        # čára ze dvou bodů
        await page.select_option('#ag-hr-pa', 'cp_A')
        await page.select_option('#ag-hr-pb', 'cp_B')
        await page.wait_for_timeout(300)
        txt = await page.evaluate("() => document.getElementById('ag-hr-body').textContent")
        ok('B2 čára ze dvou bodů: 60 m, rovná → jen kolmá složka', ('60 m' in txt) and ('rovná' in txt), txt[:200])
        await page.fill('#ag-hr-off-in', '0,5')
        await page.click('#ag-hr-go')
        await page.wait_for_timeout(500)
        ok('B3 při chůzi je lišta dole a okno schované', await page.evaluate("() => !!document.getElementById('ag-hr-bar') && getComputedStyle(document.getElementById('ag-hr-modal')).display === 'none'"))
        # simulovaná chůze: pravda = 0,5 m vpravo od čáry (tj. jih), GPS přičítá (+1.2 V, -2.5 S) + šum
        import random
        random.seed(7)
        for i in range(40):
            x = 2 + i * 1.4
            gx, gy = x + 1.2 + random.gauss(0, 0.4), -0.5 - 2.5 + random.gauss(0, 0.4)
            p = ll(gx, gy)
            await ctx.set_geolocation({'latitude': p['lat'], 'longitude': p['lng'], 'accuracy': 4})
            await page.wait_for_timeout(120)
        live = await page.evaluate("() => (document.getElementById('ag-hr-live') || {}).textContent || ''")
        ok('B4 živý stav hlásí fixy a odhad', ('fix' in live) and ('lže' in live), live)
        await page.click('#ag-hr-bar-stop')
        await page.wait_for_timeout(500)
        res = await page.evaluate("() => (document.querySelector('#ag-hr-body .hr-card.green') || {}).textContent || ''")
        ok('B5 výsledek: GPS lže o ~2,5 m kolmo k čáře', ('Výsledek' in res) and ('jen kolmo' in res) and any(('o 2,%d' % d) in res for d in (3, 4, 5, 6, 7)), res[:300])
        await page.click('#ag-hr-apply')
        await page.wait_for_timeout(300)
        sh = await page.evaluate("() => { var s = window.agRefShift; if (!s) return null; return { on: s.on, src: s.src, dN: s.dlat * 111320, dE: s.dlng * 111320 * Math.cos(50.0755 * Math.PI / 180), ls: !!localStorage.getItem('agRefShift') }; }")
        ok('B6 Zapnout korekci → agRefShift (posun +2,5 m na sever, nic na východ)', sh and sh['on'] and sh['src'] == 'hrana' and 2.2 < sh['dN'] < 2.8 and abs(sh['dE']) < 0.05 and sh['ls'], sh)
        okno = await page.evaluate("() => (document.querySelector('#ag-hr-body .hr-card') || {}).textContent || ''")
        ok('B6b okno ukazuje platnost korekce (zbývající minuty + vzdálenost)', ('platí ještě' in okno) and ('m od místa' in okno), okno[:200])
        await page.click('#ag-hr-close')
        ok('B7 Zavřít uklidí čáru z mapy', await page.evaluate("() => getComputedStyle(document.getElementById('ag-hr-modal')).display === 'none' && !document.getElementById('ag-hr-bar')"))

        # ---- H: hlídač platnosti korekce (js/ref-calibration.js) -------------------------
        await page.evaluate("() => window.agRefShiftWatch()")
        pill = await page.evaluate("() => { const p = document.getElementById('agref-pill'); return p ? { cls: p.className, txt: p.textContent } : null; }")
        ok('H1 po zapnutí svítí zelená pilulka „Korekce GPS · ještě 20 min"', pill and 'show' in pill['cls'] and 'warn' not in pill['cls'] and 'Korekce GPS' in pill['txt'] and 'ještě' in pill['txt'], pill)
        toasty = []
        await page.expose_function('_agToastSpy', lambda m: toasty.append(m))
        await page.evaluate("() => { const o = window.quickToast; window.quickToast = function (m) { window._agToastSpy(String(m)); return o && o.apply(this, arguments); }; }")
        # čas: 16 min → oranžová + toast „vyprší za 4 min"
        await page.evaluate("() => { window.agRefShift.t = Date.now() - 16 * 60000; localStorage.setItem('agRefShift', JSON.stringify(window.agRefShift)); window.agRefShiftWatch(); }")
        pill = await page.evaluate("() => ({ cls: document.getElementById('agref-pill').className, txt: document.getElementById('agref-pill').textContent })")
        ok('H2 v 16 min: oranžová pilulka „ještě 4 min" + toast o vypršení', 'warn' in pill['cls'] and 'ještě 4 min' in pill['txt'] and any('vyprší za' in t for t in toasty), (pill, toasty))
        # 21 min → červená + toast „starší než 20 min"
        await page.evaluate("() => { window.agRefShift.t = Date.now() - 21 * 60000; window.agRefShiftWatch(); }")
        pill = await page.evaluate("() => ({ cls: document.getElementById('agref-pill').className, txt: document.getElementById('agref-pill').textContent })")
        ok('H3 ve 21 min: červená pilulka + toast „starší než 20 min"', 'bad' in pill['cls'] and 'starší než 20 min' in pill['txt'] and any('starší než 20 min' in t for t in toasty), (pill, toasty))
        n0 = len(toasty)
        await page.evaluate("() => window.agRefShiftWatch()")
        ok('H4 stejný stupeň se toastem neopakuje', len(toasty) == n0, toasty)
        # vzdálenost: čerstvá korekce, odejdi 250 m → oranžová podle vzdálenosti, 320 m → červená
        await page.evaluate("() => { window.agRefShift.t = Date.now(); window.agRefShiftWatch(); }")
        p250 = ll(30, -250)
        await ctx.set_geolocation({'latitude': p250['lat'], 'longitude': p250['lng'], 'accuracy': 4})
        await page.wait_for_timeout(1500)
        await page.evaluate("() => window.agRefShiftWatch()")
        pill = await page.evaluate("() => ({ cls: document.getElementById('agref-pill').className, txt: document.getElementById('agref-pill').textContent })")
        ok('H5 250 m od místa: oranžová + toast „200 m"', 'warn' in pill['cls'] and 'm od místa' in pill['txt'] and any('od místa kalibrace' in t and '300 m' in t for t in toasty), (pill, toasty[-2:]))
        p320 = ll(30, -320)
        await ctx.set_geolocation({'latitude': p320['lat'], 'longitude': p320['lng'], 'accuracy': 4})
        await page.wait_for_timeout(1500)
        await page.evaluate("() => window.agRefShiftWatch()")
        pill = await page.evaluate("() => ({ cls: document.getElementById('agref-pill').className, txt: document.getElementById('agref-pill').textContent })")
        ok('H6 320 m: červená „za hranicí 300 m"', 'bad' in pill['cls'] and 'za hranicí 300 m' in pill['txt'], pill)
        # klepnutí na pilulku otevře nástroj, který korekci vyrobil
        await page.click('#agref-pill .txt')
        await page.wait_for_timeout(500)
        ok('H7 klepnutí na pilulku otevře Kalibraci chůzí po hraně', await page.evaluate("() => getComputedStyle(document.getElementById('ag-hr-modal')).display === 'flex'"))
        await page.click('#ag-hr-off')
        await page.wait_for_timeout(300)
        ok('H8 Vypnout → pilulka zhasne', await page.evaluate("() => !document.getElementById('agref-pill').classList.contains('show') && !(window.agRefShift && window.agRefShift.on)"))
        await page.click('#ag-hr-close')
        await ctx.set_geolocation({'latitude': LAT, 'longitude': LNG, 'accuracy': 3})
        await page.wait_for_timeout(800)

        # ---- A: akustický dálkoměr -------------------------------------------------
        await page.evaluate("() => AGLazyTools.open('akusticky-dalkomer')")
        ok('A1 okno se otevře s postupem', await cekej(page, "window.AGAkustika && document.getElementById('ag-aku-modal') && getComputedStyle(document.getElementById('ag-aku-modal')).display === 'flex' && document.querySelector('#ag-aku-body details')"), chyby[-3:])
        # telefon B: mikrofon (fake) → poslouchám
        await page.click('#ag-aku-go-b')
        await page.wait_for_timeout(2500)
        bt = await page.evaluate("() => document.getElementById('ag-aku-body').textContent")
        ok('A2 „Stojím na známém bodě" zapne mikrofon a poslouchá', ('Poslouchám' in bt) and ('Hz' in bt), bt[:300])
        await page.click('#ag-aku-bstop')
        await page.wait_for_timeout(300)
        # telefon A: měřím — mikrofon jede, pípne (fake mikrofon nic neslyší → kola selžou, ale nic nespadne)
        await page.click('#ag-aku-go-a')
        await page.wait_for_timeout(1500)
        at = await page.evaluate("() => document.getElementById('ag-aku-body').textContent")
        ok('A3 „Měřím" zapne mikrofon a nabídne Změřit', ('Změřit' in at) and (not any('akustika' in c for c in chyby)), (at[:200], chyby[-3:]))
        await page.click('#ag-aku-astop')
        await page.wait_for_timeout(300)
        # délky → protínání → bod
        await page.click('#ag-aku-delky')
        await page.wait_for_timeout(300)
        n = await page.evaluate("() => document.querySelectorAll('.ag-aku-ck').length")
        ok('A4 seznam uložených délek (2)', n == 2, n)
        await page.check('.ag-aku-ck[data-i="0"]')
        await page.check('.ag-aku-ck[data-i="1"]')
        await page.click('#ag-aku-prot')
        await page.wait_for_timeout(400)
        pt = await page.evaluate("() => document.getElementById('ag-aku-prot-out').textContent")
        ok('A5 protínání spočítá dva průsečíky s úhlem', ('Protínání z délek' in pt) and ('úhel' in pt) and ('1:' in pt) and ('2:' in pt), pt[:300])
        await page.fill('#ag-aku-pname', 'AKU-TEST')
        # vyber průsečík blíž cíli (9,12) od C — ten správný
        vyber = await page.evaluate("""(cil) => { const bs = [...document.querySelectorAll('#ag-aku-prot-out button[data-s]')]; return bs.map(b => b.getAttribute('data-s')); }""", CIL)
        # klepni na oba postupně? ne — najdi ten, jehož souřadnice sedí, přes GeoCore
        volba = await page.evaluate("""(cil) => { const m = { lat: 111320, lng: 111320 * Math.cos(cil.lat * Math.PI / 180) }; const bs = [...document.querySelectorAll('#ag-aku-prot-out button[data-s]')]; let best = null, bd = 1e9; bs.forEach(b => { const t = b.textContent; const mm = t.match(/Y\\s*([\\d.]+)\\s+X\\s*([\\d.]+)/); let d = 1e9; if (mm && window.GeoCore && GeoCore.toSJTSK) { const q = GeoCore.toSJTSK(cil.lat, cil.lng); d = Math.hypot(+mm[1] - q.y, +mm[2] - q.x); } else { const m2 = t.match(/([\\d.]+),\\s*([\\d.]+)/); if (m2) d = Math.hypot((+m2[1] - cil.lat) * m.lat, (+m2[2] - cil.lng) * m.lng); } if (d < bd) { bd = d; best = b.getAttribute('data-s'); } }); return { best, bd }; }""", CIL)
        ok('A6 jeden z průsečíků je cíl (do 5 cm)', volba['bd'] < 0.05, volba)
        await page.click('#ag-aku-prot-out button[data-s="%s"]' % volba['best'])
        await page.wait_for_timeout(500)
        saved = await page.evaluate("""(cil) => { const p = persistentCustomPoints.find(q => q.name === 'AKU-TEST'); if (!p) return null; const m = { lat: 111320, lng: 111320 * Math.cos(cil.lat * Math.PI / 180) }; return { origin: p.prov && p.prov.origin, d: Math.hypot((p.lat - cil.lat) * m.lat, (p.lng - cil.lng) * m.lng), acc: p.acc, delky: p.prov && p.prov.delky && p.prov.delky.length }; }""", CIL)
        ok('A7 bod uložen s prov.origin akustika a oběma délkami', saved and saved['origin'] == 'akustika' and saved['d'] < 0.05 and saved['delky'] == 2 and saved['acc'] and saved['acc'] < 0.2, saved)

        ok('Z0 bez chyb v konzoli z nových modulů', not any(('akustik' in c or 'hrana' in c or 'kalibrace-hranou' in c) for c in chyby), chyby[-5:])
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
