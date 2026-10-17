#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ===== QTRIG — ANGLICKÁ GRAFIKA DO GOOGLE PLAY (17. 10. 2026) ===================
# Uživatel: „Vygeneruj mi vše potřebné, abych mohl zprovoznit aplikaci v angličtině na
# Google Play." Česká sada (play/snimky/, scripts/gen_play_snimky.py) je z fotek iPhonu;
# tady se vyfotí BĚŽÍCÍ appka přepnutá do angličtiny (headless Chromium, stejně jako
# scripts/gen_screenshoty_play.py) a posadí se do stejného rámu s anglickým nadpisem:
#
#     play/en/raw/*.png              1080 x 1920  surové snímky appky (anglicky)
#     play/en/screenshots/01..05.png 1080 x 1920  rám 9:16 s nadpisem → Play Console
#     play/en/feature.png            1024 x 500   feature graphic (anglicky)
#
# ⚠ SKUTEČNÉ SNÍMKY, NE KRESBA (zavádějící záznam = důvod k zamítnutí). Body na snímcích jsou
#   VLASTNÍ body uživatele (zakázka), ne úřední body — ty by šly jen ze sítě ČÚZK. Mapa je
#   vlastní mapa appky z místní fixture (tests/fixtures/mapa-praha.pmtiles, střed Prahy),
#   takže skript jede i bez internetu.
# ⚠ AR POHLED (kamera) headless vyfotit nejde. Když v kořeni repa leží EN_AR.PNG (snímek
#   obrazovky z telefonu přepnutého do angličtiny), přidá se jako první screenshot.
#
# Použití (z kořene repa):   python scripts/gen_play_en.py [port]
# ==============================================================================
import asyncio
import json
import os
import random
import subprocess
import sys
import time
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EN = os.path.join(ROOT, 'play', 'en')
RAW = os.path.join(EN, 'raw')
SHOTS = os.path.join(EN, 'screenshots')
TMP = os.path.join(ROOT, 'tmp', 'play-en')
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8480)
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

LAT, LNG = 50.0755, 14.4390          # uvnitř fixture mapy (14.425–14.455, 50.065–50.085)

BODY = [
    ('A-101', 'Kerb corner', 0.9), ('A-102', 'Kerb corner', 1.1), ('A-103', 'Road axis', 1.2),
    ('A-104', 'Road axis', 1.0), ('A-105', 'Road axis', 1.4), ('MH-1', 'Manhole', 0.7),
    ('MH-2', 'Manhole', 0.8), ('G-11', 'Gully', 1.5), ('G-12', 'Gully', 1.3),
    ('SO-21', 'Setting-out point', 0.6), ('SO-22', 'Setting-out point', 0.9), ('F-5', 'Fence corner', 1.6),
]

# (soubor, nadpis, věta) — pořadí = pořadí v obchodě
SNIMKY = [
    ('01-map', 'Your points on your own map',
     'Survey points, job points and your position on a clean map that also works without signal.'),
    ('02-point-card', 'Point card: metres and direction',
     'Distance, bearing, national grid coordinates, height and accuracy — and one tap to navigate.'),
    ('03-points', 'Points and jobs',
     'Your own points sorted into jobs. Export and import CSV and DXF, codes ready for CAD.'),
    ('04-new-point', 'New point: GPS, map or photo',
     'Average the GPS, tap the map or read coordinates from a photo. Point codes go straight to CSV/DXF.'),
    ('05-tools', 'Field tools in your pocket',
     'Setting out, offsets, areas, intersections, free station and a calculator that shows the working.'),
]
AR = ('00-ar', 'See the point through the camera',
      'Official survey control points in augmented reality, with distance and direction.')

ZABERY = {
    '01-map': {'pred': None, 'cekat': 6000},
    '02-point-card': {'pred': "var p = arPoints.find(function (x) { return x.name === 'MH-1'; }); showDetails(p, map.distance([userLat, userLng], [p.lat, p.lng]));", 'cekat': 1800},
    '03-points': {'pred': "openManageModal()", 'cekat': 1600},
    '04-new-point': {'pred': "openNewPointModal()", 'cekat': 1400},
    '05-tools': {'pred': "document.getElementById('tools-modal').style.display='flex'", 'cekat': 1600,
                 'po': "var m=document.querySelector('#tools-modal .modal-body');"
                       "if(m){var r0=m.getBoundingClientRect(),c=m.querySelectorAll('.tool-cat');"
                       "for(var i=0;i<c.length;i++){var d=c[i].getBoundingClientRect().top-r0.top+m.scrollTop;"
                       "if(d>300){m.scrollTop=d-4;break;}}}"},
}

SKLIDIT = ("try{['ag-sp','ag-stack'].forEach(function(i){var e=document.getElementById(i);"
           "if(e)e.style.setProperty('display','none','important');});"
           "document.querySelectorAll('.ag-toast,.quick-toast,#quick-toast').forEach(function(e){e.style.display='none';});}catch(e){}")


def demo_body():
    random.seed(11)
    out, t0 = [], int(time.time() * 1000) - 3 * 3600 * 1000
    for i, (jm, kod, acc) in enumerate(BODY):
        s = i / (len(BODY) - 1.0)
        out.append({'id': 'cp_en_%d' % i, 'name': jm, 'cat': 'CUSTOM', 'type': 'custom',
                    'lat': round(LAT - 0.0009 + s * 0.0018 + (random.random() - 0.5) * 0.0003, 7),
                    'lng': round(LNG - 0.0014 + s * 0.0028 + (random.random() - 0.5) * 0.0004, 7),
                    'mts': t0 + i * 420000, 'vyska': round(192.4 + s * 2.1, 2), 'kod': kod, 'acc': acc,
                    'prov': {'origin': 'gps', 'ts': t0 + i * 420000, 'acc': acc, 'qc': None}})
    return out


def boot(fixture):
    from ag_boot import boot as agb
    return agb(tarif='pro') + """
try {
  localStorage.setItem('agJazyk_v1', 'en');
  localStorage.setItem('agViewMode', 'map');
  localStorage.setItem('agSlabsiTelefon_v1', 'off');
  localStorage.setItem('agMapaVektor_v1', JSON.stringify({ zap: true, styl: 'den', url: %s }));
  localStorage.setItem('arLastPos', JSON.stringify({ lat: %f, lng: %f }));
  localStorage.setItem('default_arCustomPoints12', %s);
  localStorage.setItem('arProjectsList', JSON.stringify([{ id: 'default', name: 'Ring road, section 2' }]));
  localStorage.setItem('arActiveProjectId', 'default');
  localStorage.setItem('agZemeUvod_v1', 'CZ');
  localStorage.setItem('agOkoli_v1', JSON.stringify({ zap: false }));   // varování „uvnitř budovy“ je stav polohy, ne vzhled appky
} catch (e) {}
""" % (json.dumps(fixture), LAT, LNG, json.dumps(json.dumps(demo_body())))


def server(cesta):
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/%s' % (port, cesta)
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen('http://127.0.0.1:%d/index.html' % port, timeout=1).read(64)
                return srv, u, port
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None, None, None


async def foto_appky(pw, url, fixture):
    br = await pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream'])
    ctx = await br.new_context(viewport={'width': 360, 'height': 640}, device_scale_factor=3, is_mobile=True, has_touch=True,
                               locale='en-GB', geolocation={'latitude': LAT, 'longitude': LNG + 0.0004, 'accuracy': 3},
                               permissions=['geolocation'], service_workers='block')
    await ctx.add_init_script(boot(fixture))

    async def route(rt, rq):
        u = rq.url
        if not u.startswith('http://127.0.0.1'):
            try:
                return await rt.abort()
            except Exception:
                return
        try:
            await rt.continue_()
        except Exception:
            pass
    chyby = []
    for nazev, _, _ in SNIMKY:
        z = ZABERY[nazev]
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)[:160]))
        await page.route('**/*', route)
        await page.goto(url, wait_until='domcontentloaded')
        for _ in range(60):
            if await page.evaluate("() => document.body.classList.contains('app-started') && window.AGJazyk && AGJazyk.get && AGJazyk.get() === 'en'"):
                break
            await page.wait_for_timeout(500)
        await page.evaluate("() => { try { map.setView([%f, %f], 17.3, { animate: false }); } catch (e) {} }" % (LAT, LNG))
        for _ in range(40):
            if await page.evaluate("() => !!(window.AGMapaVektor && AGMapaVektor.stav() === 'zapnuto' && AGMapaVektor.mapa() && AGMapaVektor.mapa().areTilesLoaded())"):
                break
            await page.wait_for_timeout(500)
        await page.evaluate("() => { var d = document.querySelector('.ag-dlg-overlay.open .ag-dlg-cancel'); if (d) d.click(); }")
        if z['pred']:
            try:
                await page.evaluate('() => { %s }' % z['pred'])
            except Exception as e:
                print('  %-14s PRESKOCENO (%s)' % (nazev, str(e)[:100]))
                await page.close()
                continue
        await page.wait_for_timeout(z['cekat'])
        if z.get('po'):
            await page.evaluate('() => { %s }' % z['po'])
            await page.wait_for_timeout(400)
        await page.evaluate(SKLIDIT)
        await page.wait_for_timeout(300)
        cz = await page.evaluate("""() => { var t = document.body.innerText || ''; var m = t.match(/[^\\n]*[ěščřžůťďň][^\\n]*/gi) || []; return m.slice(0, 6); }""")
        if cz:
            print('  %-14s pozor, česky zbylo: %s' % (nazev, cz))
        await page.screenshot(path=os.path.join(RAW, nazev + '.png'))
        print('  %-14s ok' % nazev)
        await page.close()
    await br.close()
    return chyby


def html_snimek(nazev, nadpis, veta, img):
    return ('<div class="panel shot" data-out="%s" data-w="1080" data-h="1920"><div class="brand">QTRIG</div>'
            '<div class="hd"><h1>%s</h1><p>%s</p></div><div class="phone"><img src="%s"></div></div>' % (nazev, nadpis, veta, img))


def html_feature(logo, img):
    return ('<div class="panel feature" data-out="feature" data-w="1024" data-h="500"><div class="logo">%s</div>'
            '<div class="txt"><h1>QTRIG</h1><p class="tag">Survey points in augmented reality</p>'
            '<p class="sub">Control points in the camera · your own map · setting out and field maths · works offline</p></div>'
            '<div class="phone"><img src="%s"></div></div>' % (logo, img))


def nacti_css():
    # CSS rámu je v scripts/gen_play_snimky.py (jeden zdroj vzhledu obou sad) — skript se při
    # importu sám spouští, proto se z něj CSS jen vyřízne jako text.
    t = open(os.path.join(ROOT, 'scripts', 'gen_play_snimky.py'), encoding='utf-8').read()
    a = t.index("CSS = r'''") + len("CSS = r'''")
    return t[a:t.index("'''", a)]


async def ramuj(pw, port):
    with open(os.path.join(ROOT, 'icon.svg'), encoding='utf-8') as f:
        logo = f.read().replace('<svg ', '<svg width="280" height="280" ', 1)
    casti, poradi = [], []
    ar = os.path.join(ROOT, 'EN_AR.PNG')
    if os.path.exists(ar):
        im = Image.open(ar).convert('RGB'); w, h = im.size
        im.crop((0, 177, w, h)).save(os.path.join(RAW, AR[0] + '.jpg'), 'JPEG', quality=92)
        casti.append(html_snimek(AR[0], AR[1], AR[2], '../../play/en/raw/%s.jpg' % AR[0])); poradi.append(AR[0])
    for nazev, nadpis, veta in SNIMKY:
        if os.path.exists(os.path.join(RAW, nazev + '.png')):
            casti.append(html_snimek(nazev, nadpis, veta, '../../play/en/raw/%s.png' % nazev)); poradi.append(nazev)
    prvni = '../../play/en/raw/%s.%s' % (poradi[0], 'jpg' if poradi[0] == AR[0] else 'png')
    casti.insert(0, html_feature(logo, prvni))
    os.makedirs(TMP, exist_ok=True)
    with open(os.path.join(TMP, 'index.html'), 'w', encoding='utf-8') as f:
        f.write('<!doctype html><html lang="en"><meta charset="utf-8"><style>%s</style><body>%s</body></html>'
                % (nacti_css(), ''.join(casti)))
    br = await pw.chromium.launch()
    page = await br.new_page(viewport={'width': 1200, 'height': 2000})
    await page.goto('http://127.0.0.1:%d/tmp/play-en/index.html' % port)
    await page.wait_for_timeout(1500)
    for i, el in enumerate(await page.query_selector_all('.panel')):
        out = await el.get_attribute('data-out')
        if out == 'feature':
            cil = os.path.join(EN, 'feature.png')
        else:
            cil = os.path.join(SHOTS, '%02d-%s.png' % (i, out.split('-', 1)[1]))
        await el.screenshot(path=cil)
        print('  %-40s %s' % (os.path.relpath(cil, ROOT), Image.open(cil).size))
    await br.close()


async def main():
    from playwright.async_api import async_playwright
    for d in (RAW, SHOTS):
        os.makedirs(d, exist_ok=True)
        for f in os.listdir(d):
            if f.endswith('.png'):
                os.remove(os.path.join(d, f))
    srv, url, port = server('index.html')
    if not srv:
        print('server nenastartoval'); return 2
    try:
        async with async_playwright() as pw:
            fixture = 'http://127.0.0.1:%d/tests/fixtures/mapa-praha.pmtiles' % port
            chyby = await foto_appky(pw, url, fixture)
            await ramuj(pw, port)
    finally:
        srv.terminate()
    if chyby:
        print('chyby stránky:', chyby[:4])
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
