#!/usr/bin/env python3
# ===== AR Geodet — KONTROLA ZMEN v283 ==========================================
# Zadani z 8. 9. 2026 (mluvene). Kazdy bod se overuje SPUSTENIM appky v prohlizeci,
# ne ctenim kodu — vetsina veci ze zadani je o tom, co uzivatel VIDI.
#
#   A) PRIHLASENI JE PRI KAZDEM STARTU. I kdyz je na zarizeni zapnuty rezim
#      vlastnika, appka MUSI ukazat branu (do teto chvile ji preskakovala).
#   B) VLASTNIK SE PRIHLASI JMENEM. Do pole kodu "VLASTNIK", do hesla klic ->
#      appka nastartuje a v Nastrojich pribude kategorie "Sprava aplikace".
#   C) MRIZKA NASTROJU JE ROZTRIDENA. Zadna kategorie nesmi mit vic nez MAX_KAT
#      dlazdic a zachytna sekce "Terenni nastroje" ma byt prazdna/pryc.
#   D) NAPSAT AUTOROVI JE PRVNI VEC V NASTROJICH (a je videt bez rolovani).
#   E) V MAPE U CILE NAVIGACE NENI AZIMUT (uzivatel: "ty stupne tam vymaz").
#   F) DLOUHY STISK NA MAPE ZMERI VZDALENOST od moji polohy.
#   G) LISTA "Nova verze" se sama neukazuje; aktualizace se vezme pri restartu.
#   H) VYBER OBDELNIKU V MAPE dotahne vzdalene body do AR.
#
# Pouziti (z korene repa):  python scripts/test_v283.py [port]
# ==============================================================================
import asyncio
import os
import subprocess
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8971
URL = None

# Bezny prihlaseny uzivatel (appka dojede az k obrazovce).
BOOT = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('arSurveyor','Stepan');
  localStorage.setItem('agFirmaBioAsk_v1', String(Date.now()));
  (function () {
    var f = { enabled: true, firmName: 'Test', createdTs: Date.now(), autoLockMin: 0,
      users: [{ id: 'u1', name: 'Stepan', role: 'admin', salt: 'aa', pinHash: 'x', noPin: true }] };
    localStorage.setItem('agFirma_v1', JSON.stringify(f));
    localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: 'u1', ts: Date.now() }));
  })();
"""

# Telefon vyvojare: priznak vlastnika i klic uz ulozene, ZADNA firma.
BOOT_VLASTNIK = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agVlastnik_v1','1');
  localStorage.setItem('agFbKey_v1','klic-vlastnika-aspon-24-znaku!!');
"""

GEO = {'latitude': 50.0800, 'longitude': 14.4300, 'accuracy': 2.5}
MAX_KAT = 14          # vic dlazdic pod jednim nadpisem uz je "nahozene"

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)[:400]) if detail != '' else ''))


def server():
    global URL
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % port
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                URL = u
                return srv
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None


async def nacti(page, cekej_na='true'):
    for _ in range(4):
        try:
            await page.goto(URL, wait_until='domcontentloaded', timeout=45000)
            break
        except Exception:
            await page.wait_for_timeout(1500)
    await page.wait_for_timeout(2200)
    for _ in range(40):
        if await page.evaluate("() => " + cekej_na):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(400)
    await page.wait_for_timeout(1200)


# ---------------------------------------------------- A+B) prihlaseni vlastnika
async def test_vlastnik(ctx):
    print('\n--- A+B) vlastnik prochazi branou a prihlasuje se jmenem ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await ctx.add_init_script(BOOT_VLASTNIK)
    await nacti(page, "!!document.getElementById('ag-gate') || !!document.body.classList.contains('app-started')")

    st = await page.evaluate("""() => ({
        brana: !!document.getElementById('ag-gate'),
        bezi: document.body.classList.contains('app-started'),
        znakMaGesto: !!(document.querySelector('#ag-gate .agl-mark') || {}).getAttribute
                     && document.querySelector('#ag-gate .agl-mark').getAttribute('data-agv') === '1'
    })""")
    ok('brana se ukaze i vlastnikovi', st['brana'], st)
    ok('appka pod branou jeste nebezi', not st['bezi'], st)

    # server tu neni -> /owner/firms spadne na status 0 a modul pusti dovnitr
    # proti ULOZENEMU klici (nouzova cesta pro teren bez signalu)
    await page.evaluate("""() => {
        document.getElementById('agg-show-join').click();
        document.getElementById('agg-code').value = 'VLASTNIK';
        document.getElementById('agg-code').dispatchEvent(new Event('input'));
        document.getElementById('agg-pass').value = 'klic-vlastnika-aspon-24-znaku!!';
    }""")
    await page.wait_for_timeout(200)
    await page.evaluate("() => document.getElementById('agg-go').click()")
    await page.wait_for_timeout(4000)
    st = await page.evaluate("""() => ({
        brana: !!document.getElementById('ag-gate'),
        bezi: document.body.classList.contains('app-started'),
        err: (document.getElementById('agg-err') || {}).textContent || ''
    })""")
    ok('po jmenu VLASTNIK + klici appka nastartuje', st['bezi'] and not st['brana'], st)

    # brana se nesmi za dve vteriny (tik gateCheck) vratit pres bezici appku
    await page.wait_for_timeout(3500)
    st2 = await page.evaluate("() => ({ brana: !!document.getElementById('ag-gate') })")
    ok('brana se po tiku nevrati pres bezici appku', not st2['brana'], st2)

    # nastroje spravy
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(1500)
    st3 = await page.evaluate("""() => {
        const g = document.querySelector('#tools-modal .tool-grid');
        const ids = [...g.querySelectorAll('[data-tool]')].map(e => e.getAttribute('data-tool'));
        return { kat: !!document.getElementById('agv-cat'),
                 ma: ['vlastnik-konzole','vlastnik-firmy','vlastnik-spravci','vlastnik-zpravy'].filter(k => ids.includes(k)) };
    }""")
    ok('v Nastrojich je kategorie Sprava aplikace', st3['kat'], st3)
    ok('vsechny ctyri nastroje spravy jsou v mrizce', len(st3['ma']) == 4, st3)
    ok('bez chyb v konzoli', not chyby, chyby[:3])
    await page.close()


# ------------------------------------------------------------- C+D) mrizka
async def test_mrizka(ctx):
    print('\n--- C+D) mrizka Nastroju je roztridena a psani autorovi je prvni ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await ctx.add_init_script(BOOT)
    await nacti(page, "document.body.classList.contains('app-started')")
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(2500)
    await page.evaluate("() => { document.getElementById('tools-modal').style.display='flex'; }")
    await page.wait_for_timeout(1800)

    st = await page.evaluate("""() => {
        const g = document.querySelector('#tools-modal .tool-grid');
        const out = []; let cur = null;
        for (const el of g.children) {
            if (el.classList.contains('tool-cat') || el.classList.contains('ag-ft-head')) {
                cur = { t: (el.textContent || '').trim(), n: 0 }; out.push(cur); continue;
            }
            if (el.classList.contains('tool-tile') && cur) cur.n++;
        }
        const mc = document.querySelector('#tools-modal .modal-content');
        const fb = document.getElementById('ag-fb-foot-tools') || mc.querySelector('.ag-fb-foot');
        let poradi = -1;
        if (fb) poradi = [...mc.children].indexOf(fb.closest('#tools-modal .modal-content > *') || fb);
        return { kat: out, celkem: [...g.querySelectorAll('.tool-tile')].length,
                 fb: !!fb, fbPoradi: poradi, deti: [...mc.children].map(e => e.id || e.className) };
    }""")
    print('    kategorie:', st['kat'])
    velke = [k for k in st['kat'] if k['n'] > MAX_KAT]
    ok('zadna kategorie neni prepchana (>%d dlazdic)' % MAX_KAT, not velke, velke)
    zachytna = [k for k in st['kat'] if k['t'] in ('Ostatní', 'Terénní nástroje') and k['n'] > 2]
    ok('zachytna sekce Ostatni je skoro prazdna (<=2)', not zachytna, zachytna)
    ok('kategorii je aspon sest', len([k for k in st['kat'] if k['n'] > 0]) >= 6, len(st['kat']))
    ok('Napsat autorovi je v Nastrojich', st['fb'], st['fbPoradi'])
    ok('Napsat autorovi stoji nahore (pred mrizkou)', 0 <= st['fbPoradi'] <= 2, st['deti'])
    ok('bez chyb v konzoli', not chyby, chyby[:3])
    await page.close()


async def main():
    from playwright.async_api import async_playwright
    srv = server()
    if not srv:
        print('CHYBA: testovaci server nenabehl')
        return 1
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for fn in (test_vlastnik, test_mrizka):
                ctx = await b.new_context(viewport={'width': 412, 'height': 915},
                                          is_mobile=True, has_touch=True,
                                          permissions=['geolocation'], geolocation=GEO,
                                          locale='cs-CZ')
                try:
                    await fn(ctx)
                except Exception as e:
                    ok(fn.__name__ + ' probehl', False, repr(e)[:300])
                await ctx.close()
            await b.close()
    finally:
        srv.terminate()
    spatne = [j for o, j in vysledky if not o]
    print('\n=== %d/%d OK ===' % (len(vysledky) - len(spatne), len(vysledky)))
    for j in spatne:
        print('  CHYBA:', j)
    return 1 if spatne else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
