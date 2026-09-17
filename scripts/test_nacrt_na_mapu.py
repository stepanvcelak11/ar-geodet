# -*- coding: utf-8 -*-
"""NACRT NA MAPE (17. 9. 2026, vyber N2 ze stranky „Jak jeste usnadnit dohledavani bodu").

  A  karta TB s oficialnim nacrtem CUZK ma tlacitko „Polozit nacrt na mapu" (modul se dotahne pres AGLazy)
     → vyber znacky bodu v nacrtu → vyber rohu v nacrtu → klepnuti do mapy (dispatcher grafika.js)
     → prichyceni k lomovemu bodu katastru (RUIAN mock) → Helmert sedi (bod na 0/0, roh na +20/+10,
     meritko 0,25 m/px) → vrstva v mape, pruh dole, AR platno, localStorage
  B  restart appky → nacrt se sam vrati; karta hlasi „lezi na mape"; Sundat vse uklidi
  C  matematika: afinni ze 3 dvojic (rms ~0), zrcadlo se pozna, snap do 3 m / mimo

Spusteni: python scripts/test_nacrt_na_mapu.py [port]
"""
import io
import os
import sys
import json
import zlib
import struct
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
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9137)
vysledky = []
LAT, LNG = 50.0755, 14.4378
MLAT = 111132.954 - 559.822 * math.cos(2 * math.radians(LAT)) + 1.175 * math.cos(4 * math.radians(LAT))
MLNG = 111412.84 * math.cos(math.radians(LAT)) - 93.5 * math.cos(3 * math.radians(LAT))
IMG_W, IMG_H = 200, 160
# roh budovy: 20 m vychodne, 10 m severne od bodu; v nacrtu na (180, 40), bod na (100, 80)
ROH_LAT, ROH_LNG = LAT + 10.0 / MLAT, LNG + 20.0 / MLNG


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


def png(w, h):
    """jednobarevny PNG (RGBA) — nacrt jako obrazek, obsah je jedno"""
    raw = b''.join(b'\x00' + bytes([230, 230, 230, 255] * w) for _ in range(h))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


PNG = png(IMG_W, IMG_H)


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
            t = urllib.request.urlopen('http://127.0.0.1:%d/js/nacrt-na-mapu.js' % p, timeout=2).read().decode('utf-8', 'replace')
            if 'AGNacrtMapa' in t and srv.poll() is None:
                return srv, u
        except Exception:
            pass
        srv.terminate()
    return None, None


SEED = "localStorage.setItem('default_arOfflinePoints12', %s);" % json.dumps(json.dumps([
    {'id': 'p_tb', 'name': '28', 'lat': LAT, 'lng': LNG, 'cat': 'TB', 'type': 'polohovy', 'hidden': False, 'vyska': 348.41,
     'rawData': {'ZTLTL': '1425', 'CISLO': 28, 'PL': 0, 'VYSKA': '   348.41', 'NAZEV_KU': 'Test',
                 'GEODETICKE_UDAJE': 'https://geoportal.cuzk.cz/mistopis2/mistopis_soap_hh.asp?NAME=BP_TB&TYP=TB&HID=1'}}]))


async def stranka(br, url, init, chyby):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)

    async def route_vse(route, request):
        u = request.url
        try:
            if '/cuzk/nacrt?' in u:
                return await route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                                           body=json.dumps({'ok': True, 'page': 'https://dataz.cuzk.gov.cz/gu.php?1=1', 'img': [
                                               {'url': 'https://dataz.cuzk.gov.cz/mistopis.php?id=1', 'role': 'nacrt', 'w': IMG_W, 'h': IMG_H}]}))
            if 'dataz.cuzk.gov.cz/mistopis.php' in u:
                return await route.fulfill(status=200, content_type='image/png', body=PNG)
            if 'RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/5/query' in u:
                # parcela s lomovym bodem = roh budovy
                ring = [[ROH_LNG, ROH_LAT], [ROH_LNG + 30.0 / MLNG, ROH_LAT], [ROH_LNG + 30.0 / MLNG, ROH_LAT + 30.0 / MLAT], [ROH_LNG, ROH_LAT + 30.0 / MLAT], [ROH_LNG, ROH_LAT]]
                return await route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                                           body=json.dumps({'features': [{'attributes': {'id': 1, 'zdroj': 1}, 'geometry': {'rings': [ring]}}]}))
            if 'cuzk.cz/' in u or 'cuzk.gov.cz/' in u or 'openstreetmap' in u or 'workers.dev' in u:
                return await route.abort()
        except Exception:
            pass
        try:
            await route.continue_()
        except Exception:
            pass
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


async def tap_v_nacrtu(page, px, py):
    """klepne v pickeru na pixel obrazku (px, py) — prepocet pres fit() v modulu"""
    r = await page.evaluate("""() => { var w = document.getElementById('ag-nm-wrap').getBoundingClientRect();
        return { l: w.left, t: w.top, w: w.width, h: w.height }; }""")
    s = min(r['w'] / IMG_W, r['h'] / IMG_H)
    ox = (r['w'] - IMG_W * s) / 2
    oy = (r['h'] - IMG_H * s) / 2
    await page.mouse.click(r['l'] + ox + px * s, r['t'] + oy + py * s)
    await page.wait_for_timeout(150)


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        init = boot(tarif='pro') + SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');"
        ctx, page = await stranka(br, url, init, chyby)
        ok('0 appka nastartovala', await cekej(page, "document.body.classList.contains('app-started')"))
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        await page.wait_for_timeout(800)

        # ---- A: karta → tlacitko → dva vybery v nacrtu → klepnuti do mapy ----------------------
        await page.evaluate("() => { var p = arPoints.find(x => x.id === 'p_tb'); showDetails(p, 2); }")
        ok('A1 pod oficialnim nacrtem je tlacitko „Polozit nacrt na mapu"',
           await cekej(page, "document.getElementById('ag-kb-nm') && /Položit náčrt na mapu/.test(document.getElementById('ag-kb-nm').textContent)", 30),
           await page.evaluate("() => (document.getElementById('ag-kb-nm') || {}).textContent"))
        await page.click('#ag-kb-nm')
        ok('A2 otevrel se vyber „Kde je v nacrtu bod?"', await cekej(page, "document.getElementById('ag-nm-pick') && /Kde je v náčrtu bod/.test(document.querySelector('#ag-nm-pick h3').textContent)", 20))
        await page.wait_for_timeout(300)
        ok('A3 tlacitko „Tady je bod" je do klepnuti vypnute', await page.evaluate("() => document.getElementById('ag-nm-ok').disabled"))
        await tap_v_nacrtu(page, 100, 80)
        ok('A4 klepnuti v nacrtu zapne tlacitko', await page.evaluate("() => !document.getElementById('ag-nm-ok').disabled"))
        await page.click('#ag-nm-ok')
        ok('A5 druhy krok: „Roh, ktery najdes i v mape"', await cekej(page, "document.getElementById('ag-nm-pick') && /Roh, který najdeš i v mapě/.test(document.querySelector('#ag-nm-pick h3').textContent)", 20))
        await page.wait_for_timeout(300)
        cp1 = await page.evaluate("() => AGNacrtMapa._test.S.cps.map(c => [c.px, c.py, c.e, c.n])")
        ok('A6 prvni vlicovaci bod = znacka bodu (100/80 px → 0/0 m)', len(cp1) == 1 and abs(cp1[0][0] - 100) < 2 and abs(cp1[0][1] - 80) < 2 and cp1[0][2] == 0 and cp1[0][3] == 0, cp1)
        await tap_v_nacrtu(page, 180, 40)
        await page.click('#ag-nm-ok')
        ok('A7 ceka se na mapu: armed, pruh „klepni v mape", karta zavrena',
           await cekej(page, "AGNacrtMapa.armed && document.getElementById('ag-nm-bar') && /klepni/i.test(document.getElementById('ag-nm-bar').textContent) && !document.getElementById('bottom-sheet').classList.contains('open')", 15),
           await page.evaluate("() => ({ armed: AGNacrtMapa.armed, bar: (document.getElementById('ag-nm-bar') || {}).textContent, open: document.getElementById('bottom-sheet').classList.contains('open') })"))
        # klepnuti do mapy: 1 m vedle rohu → prichyti se k lomovemu bodu z RUIAN (mock)
        await page.evaluate("() => { map.fire('click', { latlng: L.latLng(%.9f, %.9f), originalEvent: null }); }" % (ROH_LAT + 1.0 / MLAT, ROH_LNG))
        ok('A8 klepnuti do mapy vzal dispatcher (armed spadl)', await cekej(page, "!AGNacrtMapa.armed", 10))
        ok('A9 transformace postavena, vrstva v mape, pruh s ovladanim',
           await cekej(page, "AGNacrtMapa.active() === 'p_tb' && document.querySelector('.ag-nm-canvas') && document.getElementById('ag-nm-op')", 30),
           await page.evaluate("() => ({ act: AGNacrtMapa.active(), cv: !!document.querySelector('.ag-nm-canvas'), bar: (document.getElementById('ag-nm-bar') || {}).textContent })"))
        t = await page.evaluate("""() => { var S = AGNacrtMapa._test.S, a = S.T.fwd(100, 80), b = S.T.fwd(180, 40), i = S.T.inv(20, 10);
            return { a: a, b: b, i: i, scale: S.T.scale, cps: S.cps.map(c => [c.e, c.n]), zdroj: S.zdroj, rms: S.T.rms, corner: S.T.fwd(0, 0) }; }""")
        ok('A10 roh prichycen na 20/10 m (DKM), Helmert: bod → 0/0, roh → 20/10, inverze zpet na 180/40 px, 0,25 m/px',
           abs(t['cps'][1][0] - 20) < 0.05 and abs(t['cps'][1][1] - 10) < 0.05 and t['zdroj'] == 'katastr'
           and abs(t['a']['e']) < 0.1 and abs(t['a']['n']) < 0.1 and abs(t['b']['e'] - 20) < 0.1 and abs(t['b']['n'] - 10) < 0.1
           and abs(t['i']['px'] - 180) < 0.5 and abs(t['i']['py'] - 40) < 0.5 and abs(t['scale'] - 0.25) < 0.005 and t['rms'] is None, t)
        # levy horni roh obrazku (0,0): vektor od bodu (-100, +80 v-up) px → otoceno o uhel rohu: smer (80,40) ↔ (20,10) = stejny → bez otoceni, jen 0,25 m/px
        ok('A11 roh obrazku (0,0) → −25 m / +20 m (bez otoceni, meritko 0,25)', abs(t['corner']['e'] + 25) < 0.1 and abs(t['corner']['n'] - 20) < 0.1, t['corner'])
        bar = await page.evaluate("() => document.getElementById('ag-nm-bar').textContent")
        ok('A12 pruh rika meritko a puvod rohu', '1 px = 0,25 m' in bar and 'DKM' in bar and 'Sundat' in bar, bar)
        ok('A13 AR platno v #ar-overlay (AR zapnute)', await page.evaluate("() => !!document.querySelector('#ar-overlay .ag-nm-ar') && AGNacrtMapa._test.S.ar"))
        st = await page.evaluate("() => JSON.parse(localStorage.getItem('agNacrtNaMape_v1'))")
        ok('A14 ulozeno: bod, adresa nacrtu, 2 vlicovaci body', st and st['id'] == 'p_tb' and 'mistopis.php' in st['url'] and len(st['cps']) == 2 and st['role'] == 'nacrt', st)
        # pruhlednost posuvnikem
        await page.evaluate("() => { var r = document.getElementById('ag-nm-op'); r.value = 30; r.dispatchEvent(new Event('input')); }")
        op = await page.evaluate("() => ({ s: AGNacrtMapa._test.S.op, cv: document.querySelector('.ag-nm-canvas').style.opacity })")
        ok('A15 posuvnik meni pruhlednost vrstvy', abs(op['s'] - 0.3) < 0.001 and abs(float(op['cv']) - 0.3) < 0.001, op)

        # ---- B: restart → obnova; karta hlasi „lezi na mape"; Sundat --------------------------
        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_timeout(2500)
        ok('B1 po restartu se nacrt sam vrati (vrstva v mape, active)', await cekej(page, "window.AGNacrtMapa && AGNacrtMapa.active() === 'p_tb' && document.querySelector('.ag-nm-canvas')", 30))
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        await page.evaluate("() => { var p = arPoints.find(x => x.id === 'p_tb'); showDetails(p, 2); }")
        ok('B2 karta bodu: tlacitko hlasi „lezi na mape"', await cekej(page, "document.getElementById('ag-kb-nm') && /leží na mapě/.test(document.getElementById('ag-kb-nm').textContent) && document.getElementById('ag-kb-nm').classList.contains('on')", 30),
           await page.evaluate("() => (document.getElementById('ag-kb-nm') || {}).textContent"))
        await page.click('#ag-kb-nm')
        ok('B3 klepnuti otevre ovladaci pruh (ne novy vyber)', await cekej(page, "document.getElementById('ag-nm-op') && !document.getElementById('ag-nm-pick')", 10))
        await page.click('#ag-nm-off')
        r = await page.evaluate("() => ({ act: AGNacrtMapa.active(), cv: !!document.querySelector('.ag-nm-canvas'), ls: localStorage.getItem('agNacrtNaMape_v1'), bar: !!document.getElementById('ag-nm-bar') })")
        ok('B4 Sundat: vrstva pryc, pamet prazdna, pruh pryc', r['act'] is None and not r['cv'] and r['ls'] is None and not r['bar'], r)
        ok('B5 dlazdice v Nastrojich (registr + navod)', await page.evaluate("""() => { var reg = (window.AGReg && AGReg.all) ? AGReg.all() : null; var t = reg ? reg.find(x => x.k === 'nacrt-na-mapu') : null;
            return !!(t && t.fn === 'agOpenNacrtNaMapu' && typeof window.agOpenNacrtNaMapu === 'function'); }"""))

        # ---- C: matematika ------------------------------------------------------------------------
        c = await page.evaluate("""() => { var B = AGNacrtMapa._test.buildTransform;
            // otoceni o 90° doleva + meritko 0,5: (u,v) → e = -0.5 v, n = 0.5 u
            var f = function (px, py) { var u = px, v = -py; return { e: -0.5 * v, n: 0.5 * u }; };
            var cps = [[10, 20], [150, 30], [40, 140]].map(function (p) { var w = f(p[0], p[1]); return { px: p[0], py: p[1], e: w.e, n: w.n }; });
            var T = B(cps), q = T.fwd(77, 91), qq = f(77, 91), inv = T.inv(q.e, q.n);
            var mir = B([{ px: 0, py: 0, e: 0, n: 0 }, { px: 100, py: 0, e: 10, n: 0 }, { px: 0, py: 100, e: 0, n: 10 }]);   // py dolu ↔ n nahoru = zrcadlo
            var sn = AGNacrtMapa._test.snapTo({ lat: %.9f, lng: %.9f }, [{ lat: %.9f, lng: %.9f, zdroj: 2 }]);
            var sn2 = AGNacrtMapa._test.snapTo({ lat: %.9f, lng: %.9f }, [{ lat: %.9f, lng: %.9f }]);
            return { rms: T.rms, scale: T.scale, de: q.e - qq.e, dn: q.n - qq.n, ipx: inv.px, ipy: inv.py, mirror: T.mirror, mir: mir && mir.mirror, sn: sn, sn2: sn2, one: B([{ px: 1, py: 1, e: 0, n: 0 }]) }; }""" % (
            LAT, LNG, LAT + 2.5 / MLAT, LNG, LAT, LNG, LAT + 3.5 / MLAT, LNG))
        ok('C1 afinni ze 3 dvojic: rms 0, meritko 0,5, fwd/inv sedi, neni zrcadlo', abs(c['rms']) < 1e-6 and abs(c['scale'] - 0.5) < 1e-6 and abs(c['de']) < 1e-6 and abs(c['dn']) < 1e-6 and abs(c['ipx'] - 77) < 1e-6 and abs(c['ipy'] - 91) < 1e-6 and not c['mirror'], c)
        ok('C2 zrcadlove vlicovaci body se poznaji', c['mir'] is True, c['mir'])
        ok('C3 snap: 2,5 m → prichyti (zdroj UKM), 3,5 m → ne, 1 bod → null', c['sn'] and abs(c['sn']['d'] - 2.5) < 0.05 and c['sn']['zdroj'] == 2 and c['sn2'] is None and c['one'] is None, c)

        d = await page.evaluate("""() => { var src = document.createElement('canvas'); src.width = 100; src.height = 100; var sc = src.getContext('2d');
            sc.fillStyle = '#ff0000'; sc.fillRect(0, 0, 50, 100); sc.fillStyle = '#0000ff'; sc.fillRect(50, 0, 50, 100);
            var dst = document.createElement('canvas'); dst.width = 300; dst.height = 300; var dc = dst.getContext('2d');
            // ctverec 100×100 → lichobezník na zemi: horni hrana uzsi (perspektiva), dva trojuhelniky jako v arLoop
            var p00 = { x: 100, y: 50 }, p10 = { x: 200, y: 50 }, p01 = { x: 20, y: 250 }, p11 = { x: 280, y: 250 };
            var T = AGNacrtMapa._test.drawTri;
            T(dc, src, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, p00, p10, p01);
            T(dc, src, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, p10, p11, p01);
            function px(x, y) { var q = dc.getImageData(x, y, 1, 1).data; return [q[0], q[2], q[3]]; }
            return { levaDole: px(60, 240), pravaDole: px(240, 240), levaNahore: px(120, 60), pravaNahore: px(180, 60), mimo: px(10, 10), stredDole: px(150, 240) }; }""")
        ok('C4 trojuhelnikove mapovani textury: leva pulka cervena, prava modra, mimo nic',
           d['levaDole'][0] > 200 and d['levaDole'][1] < 50 and d['pravaDole'][1] > 200 and d['pravaDole'][0] < 50
           and d['levaNahore'][0] > 200 and d['pravaNahore'][1] > 200 and d['mimo'][2] == 0 and d['stredDole'][2] > 200, d)

        vazne = [x for x in chyby if 'favicon' not in x and 'net::ERR' not in x and '404' not in x and 'tile.openstreetmap' not in x and '/owner/' not in x and '403' not in x and 'Failed to fetch' not in x and 'ERR_FAILED' not in x]
        ok('Z bez chyb stranky', not vazne, vazne[:5])
        await ctx.close()
        await br.close()


def main():
    srv, url = server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    sys.exit(1 if spatne else 0)


if __name__ == '__main__':
    main()
