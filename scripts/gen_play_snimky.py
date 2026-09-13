#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ===== QTRIG — GRAFIKA DO GOOGLE PLAY ZE SKUTECNYCH SNIMKU ====================
# Z fotek obrazovky z telefonu (13. 9. 2026, iPhone, 1179x2556) udela to, co
# Play Console chce a bere:
#
#     play/snimky/feature.png         1024 x 500   feature graphic (povinny banner)
#     play/snimky/01-ar.png ... 05    1080 x 1920  screenshoty telefonu (9:16)
#
# PROC NE SUROVE FOTKY: Play odmitne obrazek, jehoz delsi strana je vic nez 2x
# delsi nez kratsi (iPhone 1179x2556 = 2,17), a nahore ma iOS stavovy radek
# s hodinami, baterii a cervenou tecku nahravani obrazovky — na androidim
# listingu pusobi cize. Tady se stavovy radek ustrihne (177 px = 59 pt x 3)
# a snimek se posadi do ramu 9:16 s nadpisem a jednou vetou nad nim.
#
# PROC PRES PROHLIZEC (Playwright) A NE PIL: nadpisy jsou v pismech appky
# (Sora / Inter z css/fonts.css) a logo je PRIMO icon.svg — jediny zdroj pravdy
# ikony, stejne jako u make-icons.py. V Pillow by se sazba i logo kreslily
# podruhe rucne a casem by se rozesly.
#
# ⚠⚠ TOHLE JSOU SKUTECNE SNIMKY BEZICI APPKY, ne kresba. Kreslene panely
#   z play/promo.html (play/promo/play-1..4.png) do obchodu jako screenshoty
#   NEPATRI (zavadejici zaznam = duvod k zamitnuti); nanejvys jako inspirace.
#
# Zdrojove fotky se hledaji v koreni repa (IMG_*.PNG jsou v .gitignore, do repa
# nepatri — vysledky v play/snimky/ ano). Kdyz nektera chybi, preskoci se.
#
# Pouziti (z korene repa):  python scripts/gen_play_snimky.py [port]
# ==============================================================================
import asyncio
import os
import subprocess
import sys
import time
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'play', 'snimky')
TMP = os.path.join(ROOT, 'tmp', 'play')          # tmp/ je v .gitignore
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8420
STATUS_BAR = 177                                  # iPhone 15 Pro: 59 pt x 3

# Poradi = poradi v obchode. Prvni dva snimky vidi kazdy hned v seznamu, proto
# AR a karta bodu — to je to, co appku odlisuje.
SNIMKY = [
    ('01-ar', 'IMG_6293.PNG',
     'Bod vidíš rovnou v kameře',
     'Bodové pole ČÚZK v rozšířené realitě — se vzdáleností a směrem. Pod tím mapa s trasou k bodu.'),
    ('02-karta-bodu', 'IMG_6294.PNG',
     'Karta bodu: metry i směr',
     'Vzdálenost, azimut, souřadnice S-JTSK, výška Bpv a rádius, ve kterém bod v terénu hledat.'),
    ('03-katastr', 'IMG_6295.PNG',
     'Katastr pod nohama',
     'Parcely, hranice a čísla přímo v mapě. Body kolem tebe seřazené podle vzdálenosti.'),
    ('04-body', 'IMG_6297.PNG',
     'Vlastní body a zakázky',
     'Souřadnice S-JTSK, přesnost, export i import (CSV, DXF). Navedení na bod jedním klepnutím.'),
    ('05-novy-bod', 'IMG_6298.PNG',
     'Nový bod: GPS, mapa, fotka',
     'Průměr GPS, klepnutí do mapy nebo přečtení souřadnic z fotky. Kódy bodů rovnou do CSV/DXF.'),
]

CSS = r'''
@import url('../../css/fonts.css');
* { box-sizing: border-box; }
html, body { margin: 0; background: #0c1014; }
body { font-family: 'Inter', system-ui, sans-serif; color: #e8edf2; }
.panel {
  position: relative; overflow: hidden;
  background:
    radial-gradient(ellipse 70% 55% at 50% 100%, rgba(76,205,153,0.22), transparent 70%),
    linear-gradient(135deg, #1c222a 0%, #0c1014 100%);
}
.panel::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px);
  background-size: 60px 60px;
}
/* ---- screenshot 1080x1920 ---- */
.shot { width: 1080px; height: 1920px; }
.shot .hd { position: absolute; left: 72px; right: 72px; top: 96px; text-align: center; }
.shot h1 { font-family: 'Sora', 'Inter', sans-serif; font-weight: 700; font-size: 60px; line-height: 1.12;
           margin: 0 0 22px; letter-spacing: -0.01em; }
.shot p  { font-size: 33px; line-height: 1.38; margin: 0; color: #b6bec9; }
.shot .phone {
  position: absolute; left: 50%; top: 392px; transform: translateX(-50%);
  width: 824px; border-radius: 54px; overflow: hidden;
  border: 3px solid rgba(255,255,255,0.14);
  box-shadow: 0 40px 90px rgba(0,0,0,0.6), 0 0 0 14px rgba(0,0,0,0.35);
  background: #0f1216;
}
.shot .phone img { display: block; width: 100%; height: auto; }
.shot .brand { position: absolute; left: 0; right: 0; top: 24px; text-align: center;
               font-family: 'Sora', sans-serif; font-weight: 700; font-size: 26px;
               letter-spacing: 0.22em; color: #4ccd99; opacity: 0.9; }
/* ---- feature graphic 1024x500 ---- */
.feature { width: 1024px; height: 500px; }
.feature .logo { position: absolute; left: 62px; top: 110px; width: 280px; height: 280px; }
.feature .txt { position: absolute; left: 368px; top: 112px; width: 372px; }
.feature h1 { font-family: 'Sora', sans-serif; font-weight: 800; font-size: 84px; line-height: 1;
              margin: 0 0 16px; letter-spacing: 0.04em; }
.feature .tag { font-family: 'Sora', sans-serif; font-weight: 600; font-size: 27px; line-height: 1.2; color: #4ccd99; margin: 0 0 18px; }
.feature .sub { font-size: 19px; line-height: 1.45; color: #b6bec9; margin: 0; }
.feature .phone {
  position: absolute; right: -110px; top: 58px; width: 330px;
  border-radius: 40px; overflow: hidden; transform: rotate(-8deg);
  border: 3px solid rgba(255,255,255,0.14);
  box-shadow: 0 30px 70px rgba(0,0,0,0.65), 0 0 0 10px rgba(0,0,0,0.35);
  background: #0f1216;
}
.feature .phone img { display: block; width: 100%; }
'''


def oriznout(src, dst):
    """Ustrihne stavovy radek iOS; zbytek necha, spodek prekryje ram."""
    im = Image.open(src).convert('RGB')
    w, h = im.size
    im = im.crop((0, STATUS_BAR, w, h)).save(dst, 'PNG', optimize=True)


def html_snimek(nazev, nadpis, veta, img):
    return ('<div class="panel shot" data-out="%s" data-w="1080" data-h="1920">'
            '<div class="brand">QTRIG</div>'
            '<div class="hd"><h1>%s</h1><p>%s</p></div>'
            '<div class="phone"><img src="%s"></div></div>' % (nazev, nadpis, veta, img))


def html_feature(logo_svg, img):
    return ('<div class="panel feature" data-out="feature" data-w="1024" data-h="500">'
            '<div class="logo">%s</div>'
            '<div class="txt"><h1>QTRIG</h1>'
            '<p class="tag">Bodové pole v rozšířené realitě</p>'
            '<p class="sub">Body ČÚZK v kameře · mapa a katastr · vytyčování a měření · funguje offline</p></div>'
            '<div class="phone"><img src="%s"></div></div>' % (logo_svg, img))


def server():
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/tmp/play/index.html' % port
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                return srv, u
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None, None


async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print('Chybi Playwright:  pip install playwright  &&  python -m playwright install chromium')
        return 2
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)

    with open(os.path.join(ROOT, 'icon.svg'), 'r', encoding='utf-8') as f:
        logo = f.read().replace('<svg ', '<svg width="280" height="280" ', 1)

    casti = []
    prvni = None
    for nazev, fotka, nadpis, veta in SNIMKY:
        src = os.path.join(ROOT, fotka)
        if not os.path.exists(src):
            print('CHYBI %s — snimek %s se preskoci' % (fotka, nazev), file=sys.stderr)
            continue
        dst = os.path.join(TMP, nazev + '.png')
        oriznout(src, dst)
        casti.append(html_snimek(nazev, nadpis, veta, nazev + '.png'))
        if prvni is None:
            prvni = nazev + '.png'
    if not casti:
        print('Zadna zdrojova fotka (IMG_*.PNG v koreni repa).')
        return 1
    casti.insert(0, html_feature(logo, prvni))

    with open(os.path.join(TMP, 'index.html'), 'w', encoding='utf-8') as f:
        f.write('<!doctype html><html lang="cs"><meta charset="utf-8"><style>%s</style><body>%s</body></html>'
                % (CSS, ''.join(casti)))

    srv, url = server()
    if not srv:
        print('Nepodarilo se nastartovat testovaci server.')
        return 2
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            ctx = await browser.new_context(viewport={'width': 1200, 'height': 2000}, device_scale_factor=1)
            page = await ctx.new_page()
            await page.goto(url, wait_until='networkidle')
            await page.evaluate('document.fonts.ready')
            await page.wait_for_timeout(500)
            uzly = await page.eval_on_selector_all(
                '[data-out]', "els => els.map(e => ({ id: e.getAttribute('data-out'),"
                " w: +e.getAttribute('data-w'), h: +e.getAttribute('data-h') }))")
            for u in uzly:
                el = page.locator('[data-out="%s"]' % u['id'])
                cesta = os.path.join(OUT, u['id'] + '.png')
                await el.screenshot(path=cesta)
                box = await el.bounding_box()
                im = Image.open(cesta)
                sedi = im.size == (u['w'], u['h'])
                print('  %-14s %5d x %5d  %s' % (u['id'], im.size[0], im.size[1], 'OK' if sedi else 'POZOR: ma byt %dx%d' % (u['w'], u['h'])))
            await browser.close()
    finally:
        srv.terminate()
    print('\nHotovo -> %s' % OUT)
    print('Play Console: feature.png = feature graphic, 01-..05-*.png = screenshoty telefonu (v tomhle poradi).')
    return 0


sys.exit(asyncio.run(main()))
