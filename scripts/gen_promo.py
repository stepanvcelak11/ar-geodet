#!/usr/bin/env python3
# ===== AR Geodet — PROPAGACNI OBRAZKY DO OBCHODU ==============================
# Z predlohy `play/promo.html` vyrenderuje hotove PNG v presnych rozmerech,
# ktere chce Google Play a App Store:
#
#     play/promo/feature.png     1024 x  500   Play "feature graphic" (povinny)
#     play/promo/play-1..8.png   1080 x 1920   Play, screenshoty telefonu
#     play/promo/ios-1..8.png    1290 x 2796   App Store, 6,7"
#
# PROC PRES PROHLIZEC A NE PRES PIL: panely maji gradienty, kulate rohy, sit na
# pozadi a hlavne SAZBU TEXTU (zalomeni, ligatury, ruzne rezy). V Pillow by to
# byl rucni layout engine; tady je to CSS, ktere se navic da upravit a hned
# videt v prohlizeci. `play/make-play-graphics.py` (feature graphic z geometrie
# ikony + prerovnani surovych screenshotu) zustava — dela neco jineho.
#
# VLASTNI FOTKY: dej je do `play/promo-fotky/` jako 1.jpg .. 8.jpg (nebo .png)
# a skript spust znovu. Dokud tam nejsou, je v ramecku napsane, JAKY SNIMEK tam
# patri — takze prvni beh slouzi jako seznam, co v terenu nafotit.
#
# Pouziti (z korene repa):   python scripts/gen_promo.py [port]
# ==============================================================================
import asyncio
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'play', 'promo')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8410


async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print('Chybi Playwright:  pip install playwright  &&  python -m playwright install chromium')
        return 2

    os.makedirs(OUT, exist_ok=True)

    # Server se zkousi na vic portech: na Windows zustava port po predchozim behu
    # chvili obsazeny a jednorazovy pokus by skoncil zahadnym timeoutem.
    srv = None
    url = None
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/play/promo.html' % port
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                url = u
                break
            except Exception:
                time.sleep(0.4)
        if url:
            break
        srv.terminate()
    if not url:
        print('Nepodarilo se nastartovat testovaci server.')
        return 2

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            # deviceScaleFactor = 1: PNG ma presne tolik pixelu, kolik ma CSS.
            ctx = await browser.new_context(viewport={'width': 1400, 'height': 1000},
                                            device_scale_factor=1)
            page = await ctx.new_page()
            await page.goto(url, wait_until='networkidle')
            await page.wait_for_timeout(900)   # fotky z promo-fotky/ se dohledavaji asynchronne

            uzly = await page.eval_on_selector_all(
                '[data-promo]',
                "els => els.map(e => ({ id: e.getAttribute('data-promo'),"
                " w: +e.getAttribute('data-w'), h: +e.getAttribute('data-h') }))")
            if not uzly:
                print('V predloze nejsou zadne panely (chybi data-promo).')
                return 1

            fotek = await page.eval_on_selector_all('.shot img', 'els => els.length')
            print('predloha: %d panelu, vlastnich fotek nalezeno: %d' % (len(uzly), fotek))

            for u in uzly:
                el = page.locator('[data-promo="%s"]' % u['id'])
                cesta = os.path.join(OUT, u['id'] + '.png')
                await el.screenshot(path=cesta)
                # kontrola rozmeru: kdyby CSS pretekla, obchod obrazek odmitne
                velikost = await el.bounding_box()
                sedi = velikost and round(velikost['width']) == u['w'] and round(velikost['height']) == u['h']
                print('  %-12s %5d x %5d  %s' % (u['id'], u['w'], u['h'],
                                                 'OK' if sedi else 'POZOR: %sx%s' % (
                                                     round(velikost['width']) if velikost else '?',
                                                     round(velikost['height']) if velikost else '?')))
            await browser.close()
    finally:
        if srv:
            srv.terminate()

    print('\nHotovo -> %s' % OUT)
    print('Nahravat do Play Console: feature.png (feature graphic) + play-*.png (screenshoty telefonu).')
    print('Do App Store Connect: ios-*.png (6,7").')
    print('Az budes mit vlastni fotky, dej je do play/promo-fotky/ (1.jpg .. 8.jpg) a spust znovu.')
    return 0


sys.exit(asyncio.run(main()))
