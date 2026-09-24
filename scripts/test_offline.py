# -*- coding: utf-8 -*-
u"""LETADLOVÝ REŽIM (24. 9. 2026, b3 ze 6. kola hodnocení).

⚠ PROČ: terén bez signálu je hlavní případ použití, ale všechny ostatní sady běží se
  service_workers='block' — tedy nikdy z offline mezipaměti. Po v389 se navíc deset modulů
  načítá odloženě (ag/lazy) a nástroje po klepnutí (js/lazy-tools.js); kdyby některý chyběl
  v ASSETS_TO_CACHE, v terénu by se prostě neotevřel a žádný test by si toho nevšiml.

Co dělá: appka se nainstaluje (service worker + předběžná mezipaměť), pak se VYPNE SÍŤ,
appka se restartuje a projde: start, Nový bod, Nástroje, Nastavení, Mé body a 10 nástrojů.
Žádný vlastní soubor appky (stejný původ) nesmí selhat, protokol chyb bez nesíťových chyb.

python scripts/test_offline.py [port]
"""
import os
import re
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9057)
VYSLEDKY = []
NASTROJE = ['openMeasureModal', 'vyska-objektu', 'openCalcModal', 'openDictModal', 'predpisy', 'postupy',
            'protokol-vytyceni', 'terenni-zkouska', 'openStakeoutModal', 'zdravi-appky']
SITOVE = re.compile(r'NetworkError|bez signálu|Failed to fetch|Load failed|net::|ERR_|timeout|síť|offline|HTTP \d{3}|abort', re.I)


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


async def beh(url):
    origin = re.match(r'(https?://[^/]+)', url).group(1)
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'],
                                   service_workers='allow')
        page = await ctx.new_page()
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 online start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        # instalace SW + předběžná mezipaměť
        sw = await V.cekej(page, "(() => { window.__agSwReady = window.__agSwReady || (navigator.serviceWorker && navigator.serviceWorker.ready.then(() => window.__agSwOk = true)); return !!window.__agSwOk; })()", 90)
        ok('A1 service worker nainstalovaný', sw)
        n = await page.evaluate("""async () => { const ks = await caches.keys(); const sh = ks.find(k => /shell/.test(k)); if (!sh) return { ks, n: 0 };
            const c = await caches.open(sh); return { ks, n: (await c.keys()).length }; }""")
        ok('A2 předběžná mezipaměť naplněná (≥ 250 souborů)', n['n'] >= 250, n)
        await page.reload(wait_until='domcontentloaded')
        await V.cekej(page, "document.body.classList.contains('app-started')", 60)
        ok('A3 stránka řízená service workerem', await page.evaluate("() => !!navigator.serviceWorker.controller"))

        # ---- LETADLOVÝ REŽIM ----
        chyby, spadle = [], []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        page.on('requestfailed', lambda r: spadle.append(r.url) if r.url.startswith(origin) else None)
        await ctx.set_offline(True)
        await page.evaluate("() => localStorage.removeItem('agErrorLog')")
        await page.reload(wait_until='domcontentloaded', timeout=90000)
        ok('B1 offline: appka nastartuje', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        await page.wait_for_timeout(3000)
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(2500)
        for js in ["() => openNewPointModal()", "() => closeCustomModal()", "() => openManageModal()", "() => closeManageModal()",
                   "() => openSettings()", "() => { document.getElementById('settings-modal').style.display = 'none'; }"]:
            try:
                await page.evaluate(js)
            except Exception as e:
                chyby.append('krok ' + js + ': ' + str(e)[:150])
            await page.wait_for_timeout(600)
        otevrene = {}
        for k in NASTROJE:
            await page.evaluate("() => { document.querySelectorAll('.modal-overlay').forEach(m => { if (m.id !== 'tools-modal' && getComputedStyle(m).display !== 'none') m.style.display = 'none'; }); }")
            await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
            await page.wait_for_timeout(900)
            await page.evaluate("(k) => { for (let i = 0; i < 3; i++) document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click()); const r = document.querySelector('#tools-modal .ag-uk-i[data-k=\"' + k + '\"]'); if (r) { r.scrollIntoView(); r.click(); } }", k)
            await page.wait_for_timeout(2200)
            otevrene[k] = await page.evaluate("""() => { const vis = [...document.querySelectorAll('.modal-overlay, [id^="ag-"]')].filter(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return e.id !== 'tools-modal' && cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 300; }); return vis.map(e => e.id).slice(0, 2); }""")
        nic = [k for k, v in otevrene.items() if not v]
        ok('B2 offline: všech 10 nástrojů se otevře', not nic, {k: otevrene[k] for k in nic})
        ok('B3 offline: žádný vlastní soubor appky nechybí', not spadle, sorted(set(spadle))[:10])
        log = await page.evaluate("() => { try { return JSON.parse(localStorage.getItem('agErrorLog') || '[]').map(e => e.msg || e.sig); } catch (e) { return []; } }")
        log = [m for m in log if not SITOVE.search(m or '')]
        ok('B4 offline: protokol chyb bez nesíťových chyb', not log, log[:5])
        ok('B5 offline: bez pageerror', not chyby, chyby[:5])
        vse = await page.evaluate("""async () => {
            const src = new Set([...document.querySelectorAll('script[type="ag/lazy"]')].map(s => s.getAttribute('data-src')));
            try { (window.AGLazyTools && AGLazyTools.manifest || []).forEach(t => { if (t.src) src.add(t.src); if (t.css) src.add(t.css); }); } catch (e) {}
            const bad = [];
            for (const u of src) { try { const r = await fetch(u); if (!r.ok) bad.push(u + ' ' + r.status); } catch (e) { bad.push(u); } }
            return { n: src.size, bad };
        }""")
        ok('B6 offline: každý odložený modul a nástroj na klepnutí je v mezipaměti (%d souborů)' % vse['n'], vse['n'] > 100 and not vse['bad'], vse['bad'][:10])
        data = await page.evaluate("""async () => { const bad = [];
            for (const u of ['data/egm2008.bin', 'data/zeme-hranice.json', 'data/mapa-dily.json', 'data/jazyky.json', 'data/navody.json', 'data/predpisy.json', 'data/ulohy.json', 'data/co-je-noveho.json']) {
                try { const r = await fetch(u); if (!r.ok) bad.push(u + ' ' + r.status); } catch (e) { bad.push(u); } }
            return bad; }""")
        ok('B7 offline: datové soubory (geoid, hranice zemí, díly mapy, slovník, návody, předpisy) jsou v mezipaměti', not data, data)
        await ctx.close()
        await br.close()


def main():
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    n = len(VYSLEDKY); d = sum(VYSLEDKY)
    print('\n%d/%d OK' % (d, n))
    sys.exit(0 if d == n else 1)


if __name__ == '__main__':
    main()
