#!/usr/bin/env python3
# ===== AR Geodet - DIAGNOSTIKA: nastroj "misto mapy", split s kamerou ===========
# Hlaseni z terenu: "nejaky nastroj se mi zapl misto mapy a byl splitnuty s kamerou".
# Skript prepne appku do rezimu Split (kamera + mapa), postupne otevre AR nastroje
# a po kazdem se zepta rozvrzeni:
#   - je #map-container videt?  - bezi kamera (video ma stream)?  - kdo drzi spodek?
# Po zavreni nastroje se stejne mereni opakuje - hleda se stav, ktery se NEVRATIL.
#
# Pouziti:  python scripts/diag_split_nastroj.py [port]
# ==============================================================================
import asyncio
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
URL = 'http://127.0.0.1:%d/index.html' % PORT
OUT = os.environ.get('AG_SHOTS', os.path.join(ROOT, '_diag'))

import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from ag_boot import BOOT_UCET

# ⚠ HOST BYL ZRUSEN 6. 9. 2026 — driv se sem appka pouštěla přes
#   `agGuest_v1`. Ted se nastartuje PRIHLASENA k lokalnimu prostoru;
#   je to tentyz stav, jaky v telefonu zustane po beznem prihlaseni
#   (viz scripts/ag_boot.py), ne zvlastni cesta pro testy.
BOOT = BOOT_UCET

LAYOUT_JS = r"""
() => {
  const g = id => document.getElementById(id);
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { top: Math.round(r.top), h: Math.round(r.height), disp: cs.display, pos: cs.position, z: cs.zIndex }; };
  const v = document.querySelector('#camera-container video') || g('camera-feed');
  return {
    viewMode: (typeof viewMode !== 'undefined') ? viewMode : '?',
    cam: box(g('camera-container')),
    map: box(g('map-container')),
    resizer: box(g('resizer')),
    stream: !!(v && v.srcObject),
    bodyCls: [...document.body.classList].filter(c => /clean|mode/.test(c)).join(' '),
    // co je videt v dolni polovine displeje uprostred
    dolePod: (() => { const el = document.elementFromPoint(innerWidth/2, innerHeight*0.75);
      return el ? (el.id || el.className && String(el.className).slice(0,40) || el.tagName) : null; })()
  };
}
"""

TOOLS = [
    ('Vyska objektu', 'agOpenVyskaObjektu', 'agCloseVyskaObjektu'),
    ('Rajon', 'agOpenRajon', 'agCloseRajon'),
    ('AR protinani', 'agOpenIntersection', 'agCloseIntersection'),
    ('Presna GPS', 'agOpenBrutalGps', 'agCloseBrutalGps'),
]


def a(x):
    return str(x).encode('ascii', 'replace').decode('ascii')


async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(PORT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(args=[
                '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
            ctx = await browser.new_context(
                permissions=['geolocation', 'camera'],
                geolocation={'latitude': 50.0875, 'longitude': 14.4213},
                viewport={'width': 412, 'height': 915})
            await ctx.add_init_script(BOOT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: print('  PAGEERROR ' + a(e)))
            await page.goto(URL, wait_until='load')
            await page.wait_for_timeout(1500)
            await page.evaluate("() => startAppFromWelcome && startAppFromWelcome()")
            await page.wait_for_timeout(2500)

            # kdo vsechno je k dispozici
            have = await page.evaluate("(names) => names.filter(n => typeof window[n] === 'function')",
                                       [t[1] for t in TOOLS] + [t[2] for t in TOOLS])
            print('dostupne globaly: ' + a(have))

            # rezim Split
            await page.evaluate("() => { viewMode = 'both'; applyViewMode(); }")
            await page.wait_for_timeout(1500)
            base = await page.evaluate(LAYOUT_JS)
            print('VYCHOZI SPLIT: ' + a(json.dumps(base, ensure_ascii=False)))
            await page.screenshot(path=os.path.join(OUT, 'split-0-vychozi.png'))

            for i, (label, opn, cls) in enumerate(TOOLS):
                if opn not in have:
                    print('- %s: neni nactene (lazy?)' % a(label))
                    continue
                print('--- ' + a(label) + ' ---')
                await page.evaluate("(n) => window[n]()", opn)
                await page.wait_for_timeout(1800)
                st = await page.evaluate(LAYOUT_JS)
                print('  OTEVRENO: ' + a(json.dumps(st, ensure_ascii=False)))
                await page.screenshot(path=os.path.join(OUT, 'split-%d-%s-open.png' % (i + 1, opn)))
                if cls in have:
                    await page.evaluate("(n) => window[n]()", cls)
                    await page.wait_for_timeout(1500)
                    st2 = await page.evaluate(LAYOUT_JS)
                    print('  ZAVRENO : ' + a(json.dumps(st2, ensure_ascii=False)))
                    await page.screenshot(path=os.path.join(OUT, 'split-%d-%s-close.png' % (i + 1, opn)))
                    diff = [k for k in ('viewMode', 'stream', 'bodyCls')
                            if json.dumps(st2.get(k)) != json.dumps(base.get(k))]
                    mh = (st2.get('map') or {}).get('h'), (base.get('map') or {}).get('h')
                    if diff or mh[0] != mh[1]:
                        print('  >>> NEVRATILO SE DO VYCHOZIHO: %s  mapa h %s -> %s' % (a(diff), mh[1], mh[0]))
                    # srovnat zpet pro dalsi kolo
                    await page.evaluate("() => { viewMode = 'both'; applyViewMode(); }")
                    await page.wait_for_timeout(1200)
            await browser.close()
    finally:
        srv.terminate()


asyncio.run(main())
