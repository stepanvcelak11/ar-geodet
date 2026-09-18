# -*- coding: utf-8 -*-
u"""Regrese k hlášení z 15. 9. 2026 (v318).

  A  BRÁNA: „Další možnosti" → Zavřít nesmí pustit dovnitř bez účtu (pojistka startu po 6 s
     viděla „žádná brána" a appku spustila; průvodce po zavření bránu vrátí hned)
  B  PROTOKOL CHYB: nenačtené dlaždice mapy (obrázky) se nezapisují jako chyby
  C  KONZOLE: pohled při chybě serveru zůstane otevřený se „Zkusit znovu" (dřív alert + skok
     na rozcestník = „nejde rozkliknout")
  D  Kamera z Google Play: návod říká, kde se povoluje (Chrome), ne „ikona zámku"

Spuštění:  python scripts/test_v318.py [port]
"""
import io
import os
import sys
import asyncio
import subprocess
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8991)
vysledky = []


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


# konzole vlastníka bez serveru: /health ok, /owner/errors = 500 (simulace výpadku)
BOOT_VL = """
  localStorage.setItem('agTutProSeen','1'); localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agMapaVektor_v1', JSON.stringify({ zap: false, styl: 'auto', url: '' }));   // od v360 vychozi zapnuta; test bez blokovane site
  localStorage.setItem('agVlastnik_v1','1'); localStorage.setItem('agFbKey_v1','klic-na-zkousku');
  (function () { var orig = window.fetch.bind(window); window.fetch = function (u, o) { var s = String((u && u.url) || u || '');
    function od(x, st) { return Promise.resolve(new Response(JSON.stringify(x), { status: st || 200, headers: {'Content-Type': 'application/json'} })); }
    if (s.indexOf('/owner/errors') >= 0) return od({ error: 'simulovaný výpadek' }, 500);
    if (s.indexOf('/owner/firms') >= 0) return od({ ok: true, firms: [], flags: { off: [] } });
    if (s.indexOf('/owner/prehled') >= 0) return od({ error: 'vypadek' }, 500);
    if (s.indexOf('/health') >= 0) return od({ ok: true, v: 23, owner: true, fb: true, flags: true, errors: true });
    return orig(u, o); }; })();
"""


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []

        # ---- A: brána ----------------------------------------------------------------
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
        await page.goto(url, wait_until='domcontentloaded', timeout=45000)
        await page.wait_for_timeout(4300)   # klepnout těsně před pojistkou startu (6 s od load)
        st0 = await page.evaluate("() => ({ gate: !!document.getElementById('ag-gate'), started: document.body.classList.contains('app-started') })")
        ok('A0 bez účtu stojí brána a appka neběží', st0['gate'] and not st0['started'], st0)
        await page.evaluate("() => document.getElementById('agg-new').click()")
        for _ in range(30):
            if await page.evaluate("() => (document.getElementById('agfa-modal')||{style:{}}).style.display === 'flex'"):
                break
            await page.wait_for_timeout(300)
        await page.wait_for_timeout(800)
        await page.evaluate("() => { const m = document.getElementById('agfa-modal'); Array.from(m.querySelectorAll('button')).find(x => x.textContent.trim() === 'Zavřít').click(); }")
        await page.wait_for_timeout(300)
        st1 = await page.evaluate("() => ({ gate: !!document.getElementById('ag-gate'), started: document.body.classList.contains('app-started') })")
        ok('A1 po Zavřít je brána HNED zpátky', st1['gate'], st1)
        await page.wait_for_timeout(4000)   # přes 6. sekundu
        st2 = await page.evaluate("() => ({ gate: !!document.getElementById('ag-gate'), started: document.body.classList.contains('app-started') })")
        ok('A2 ani po pojistce startu appka bez účtu NEBĚŽÍ', st2['gate'] and not st2['started'], st2)
        src = io.open(os.path.join(ROOT, 'js', 'ucty.js'), encoding='utf-8').read()
        ok('A3 pojistka startu bere průvodce jako bránu', "var w = document.getElementById('agfa-modal');" in src and 'gateCheck: gateCheck' in src)

        # ---- B: protokol chyb --------------------------------------------------------
        n = await page.evaluate("""() => new Promise(res => { const before = (function () { try { return JSON.parse(localStorage.getItem('agErrorLog') || '[]').length; } catch (e) { return -1; } })();
            const img = document.createElement('img'); img.src = 'https://tile.openstreetmap.org/18/1/1.png?x=' + Date.now(); img.onerror = () => setTimeout(() => res({ before, after: (function () { try { return JSON.parse(localStorage.getItem('agErrorLog') || '[]').length; } catch (e) { return -1; } })() }), 300); document.body.appendChild(img); setTimeout(() => res({ before, after: 'timeout' }), 8000); })""")
        el = io.open(os.path.join(ROOT, 'js', 'err-log.js'), encoding='utf-8').read()
        ok('B1 nenačtený obrázek (dlaždice mapy) se do protokolu NEzapíše', "toUpperCase() === 'IMG'" in el and 'tile\\.openstreetmap' in el and (n['after'] == 'timeout' or n['after'] == n['before']), n)
        await ctx.close()

        # ---- C: konzole při výpadku ----------------------------------------------------
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        await ctx.add_init_script(BOOT_VL)
        page = await ctx.new_page()
        await page.goto(url, wait_until='load', timeout=45000)
        await page.wait_for_timeout(2500)
        await page.evaluate("() => { if (typeof window.startAppFromWelcome === 'function') startAppFromWelcome(); }")
        await page.wait_for_timeout(1500)
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        for _ in range(25):
            if await page.evaluate("() => typeof window.agOpenKonzole === 'function'"):
                break
            await page.wait_for_timeout(400)
        await page.evaluate("() => window.agOpenKonzole()")
        await page.wait_for_timeout(1500)
        await page.evaluate("() => window.AGVlastnik.jdi('errors')")
        await page.wait_for_timeout(1500)
        c = await page.evaluate("""() => { const b = document.getElementById('agv-body'); const nav = document.getElementById('agv-nav'); return { txt: b ? b.textContent.trim().slice(0, 120) : '', znovu: !!document.getElementById('agv-znovu'), navHidden: nav ? nav.hidden : null, dlazdice: document.querySelectorAll('#agv-modal .agv-it').length, dialog: !!document.querySelector('.ag-dlg-overlay.open') }; }""")
        ok('C1 Chyby od lidí při výpadku serveru: pohled zůstane, ukáže důvod a „Zkusit znovu"', c['znovu'] and c['dlazdice'] == 0 and not c['dialog'], c)
        ok('C2 Zpět v hlavičce je vidět', c['navHidden'] is False, c)
        vp = io.open(os.path.join(ROOT, 'js', 'vlastnik-plus.js'), encoding='utf-8').read()
        ok('C3 žádný pohled už při chybě neskáče na rozcestník (jdi po sayFail)', vp.count("jdi(''); return;") <= 1, vp.count("jdi(''); return;"))
        ok('C4 hlídač „chyba u jednoho člověka" vede na účet, když server pošle acc', "'pohled:' + d.chybyUcty[0].acc" in vp and "kam.indexOf('pohled:') === 0" in vp)
        ok('C5 tečka „něco čeká" se po schránce přepočítá hned', 'badgeRefresh' in vp and 'AGVlastnikPlus.badgeRefresh()' in io.open(os.path.join(ROOT, 'js', 'zpetna-vazba.js'), encoding='utf-8').read())
        await ctx.close()

        # ---- D: kamera z Playe --------------------------------------------------------
        g = io.open(os.path.join(ROOT, 'js', 'grafika.js'), encoding='utf-8').read()
        ok('D1 návod ke kameře zná appku z Google Play (Chrome → Nastavení webu)', 'Nastavení webu' in g and 'Aplikace → <b>Chrome</b>' in g and "ikona zámku v adresním řádku → Oprávnění → Kamera.<br>• Android" not in g)

        vazne = [c for c in chyby if 'favicon' not in c]
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
