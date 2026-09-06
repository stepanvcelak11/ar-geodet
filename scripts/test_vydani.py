#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ===== AR Geodet - DELENE SESTAVENI: opravdu se ZAKLAD sestavi a nabehne? =====
# Delici cara mezi vydanimi se da rozbit tise a nejhorsi zpusoby jsou dva:
#
#   1) Z balicku ZAKLADU vypadne soubor, na kterem stoji start. Mapa
#      nastroj -> soubor sama o sobe nestaci (js/field-tools.js registruje
#      jediny Pro nastroj `dronview` a nese CELOU mrizku Nastroju), takze
#      staticka kontrola v check_verze.py hlida jeste dve podminky. Jestli
#      staci, se pozna jedine tak, ze se ZAKLAD SESTAVI A SPUSTI.
#
#   2) Naopak: Pro kod v Zakladu zustane. Pak se za penize prodava neco, co
#      ma kazdy uz ted v balicku.
#
# Test proto obe vydani opravdu sestavi do docasnych kopii stromu a pak:
#   Z1-Z5  staticky: co v Zakladu zbylo a co zmizelo, znacka vydani, cache
#   R1-R7  za behu:  Zaklad nabehne bez chyb, Pro nastroje maji zamek a kartu
#                    s prechodem na /pro/, nastroj ze Zakladu se otevre
#
# Pouziti (z korene repa):  python scripts/test_vydani.py [port]
# Navratovy kod: 0 = vse OK, 1 = aspon jedna vada.
# ==============================================================================
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
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
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno
          + (('  -> ' + str(detail)[:300]) if detail != '' else ''))


# ---- sestaveni kopie stromu -------------------------------------------------
# Kopiruje se schvalne CELY strom (bez .git a node_modules): scripts/vydani.py
# maze soubory a musi mit co mazat. Do pracovniho stromu se pritom nesahne.
VYNECHAT = shutil.ignore_patterns('.git', 'node_modules', '_archiv', 'dist',
                                  'playwright-report', 'test-results', '__pycache__')


def postav(kam, vydani):
    shutil.copytree(ROOT, kam, ignore=VYNECHAT)
    for faze in ('--pred', '--po'):
        if faze == '--po':
            # gen_sw_assets.py musi probehnout MEZI fazemi: prvni faze meni
            # index.html (odebira Pro <script> radky), generator z nej cte
            # seznam assetu a druha faze az potom prilepi ke jmenu cache
            # priponu vydani (na jmene s priponou by se generator nesesel).
            subprocess.check_call([sys.executable, os.path.join(kam, 'scripts', 'gen_sw_assets.py')],
                                  cwd=kam, stdout=subprocess.DEVNULL)
        subprocess.check_call([sys.executable, os.path.join(kam, 'scripts', 'vydani.py'),
                               '--' + vydani, faze], cwd=kam, stdout=subprocess.DEVNULL)


def cti(kam, rel):
    with io.open(os.path.join(kam, rel), encoding='utf-8', errors='replace') as f:
        return f.read()


# ---- staticke kontroly ------------------------------------------------------
def staticky(zaklad, pro):
    mapa = json.loads(subprocess.check_output(
        [sys.executable, os.path.join(ROOT, 'scripts', 'check_verze.py'), '--mapa']).decode('utf-8'))

    # Z1 Pro soubory v Zakladu opravdu nejsou
    zbyle = [f for f in mapa['smazatelne'] if os.path.exists(os.path.join(zaklad, f))]
    ok('Z1 Pro soubory v balicku Zakladu nejsou', not zbyle, zbyle or '%d vynechano' % len(mapa['smazatelne']))

    # Z2 ... a v Pro naopak vsechny jsou
    chybne = [f for f in mapa['smazatelne'] if not os.path.exists(os.path.join(pro, f))]
    ok('Z2 v balicku Pro jsou vsechny', not chybne, chybne)

    # Z3 v index.html Zakladu nezustal odkaz na smazany soubor. Kdyby zustal,
    #    build.mjs spadne na "Chybi soubory" (eager), nebo se v terenu stahuje
    #    404 (odlozeny) - a to se pozna az u zakaznika.
    html = cti(zaklad, 'index.html')
    visi = [f for f in mapa['smazatelne'] if ('"%s"' % f) in html]
    ok('Z3 index.html Zakladu neodkazuje na smazany soubor', not visi, visi)

    # Z4 v ASSETS_TO_CACHE nesmi byt soubor, ktery ve stromu neni: cache.addAll()
    #    je atomicke a jediny 404 zahodi celou predcache -> appka je offline mrtva
    sw = cti(zaklad, 'sw.js')
    seznam = sw[sw.index('ASSETS_TO_CACHE'):]
    seznam = seznam[:seznam.index('];')]
    chybi = []
    for radek in seznam.split('\n'):
        radek = radek.strip().strip(',').strip("'\"")
        if not radek.startswith('./') or radek == './':
            continue
        cesta = radek.split('?')[0][2:]
        if not os.path.exists(os.path.join(zaklad, cesta)):
            chybi.append(cesta)
    ok('Z4 predcache Zakladu necachuje neexistujici soubor', not chybi, chibi_str(chybi))

    # Z5 znacka vydani a jmeno cache. Obe vydani bydli na TEMZE originu
    #    (Zaklad na koreni, Pro pod /pro/) a `caches` je per-origin - stejne
    #    jmeno by znamenalo, ze si vydani prepisuji shell navzajem.
    ok('Z5a Zaklad je oznaceny jako zaklad', "window.__AG_VYDANI = 'zaklad'" in html)
    ok('Z5b Pro je oznacene jako pro', "window.__AG_VYDANI = 'pro'" in cti(pro, 'index.html'))
    c1 = radka_cache(sw)
    c2 = radka_cache(cti(pro, 'sw.js'))
    ok('Z5c vydani nesdili jmeno cache', c1 and c2 and c1 != c2, '%s vs %s' % (c1, c2))


def chibi_str(x):
    return x if x else 'vse existuje'


def radka_cache(sw):
    import re
    m = re.search(r"const SHELL_CACHE = '([^']+)'", sw)
    return m.group(1) if m else None


# ---- beh v prohlizeci -------------------------------------------------------
BOOT = """
  localStorage.setItem('agGuest_v1', JSON.stringify({ts: Date.now()}));
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agBrifinkLastShown', new Date().toISOString().slice(0,10));
  localStorage.removeItem('agLicence_v1');
"""


def server(kam, port):
    for pokus in range(6):
        p = port + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % p
        srv = subprocess.Popen([sys.executable, os.path.join(kam, 'scripts', 'test_server.py'), str(p)],
                               cwd=kam, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                return srv, u
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None, None


async def za_behu(url):
    from playwright.async_api import async_playwright
    chyby, ch404 = [], []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        ctx = await br.new_context(viewport={'width': 390, 'height': 844})
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
        page.on('console', lambda m: chyby.append('console: ' + m.text) if m.type == 'error' else None)
        # 404 na smazany Pro modul je presne to, co delene sestaveni nesmi
        # vyrobit - proto se sleduji odpovedi, ne jen konzole.
        page.on('response', lambda r: ch404.append(r.url) if r.status == 404 else None)
        await page.add_init_script(BOOT)
        for _ in range(4):
            try:
                await page.goto(url, wait_until='domcontentloaded', timeout=45000)
                break
            except Exception:
                await page.wait_for_timeout(1500)
        await page.wait_for_timeout(2600)
        for _ in range(30):
            if await page.evaluate("() => !!window.AGProZamky && !!window.AGLic"):
                break
            await page.evaluate("() => window.AGLazy && AGLazy.flush()")
            await page.wait_for_timeout(400)
        await page.evaluate("() => { var w=document.getElementById('welcome-screen'); if(w) w.style.display='none'; }")
        await page.wait_for_timeout(900)

        ok('R1 Zaklad nabehl (licence i zamky)',
           await page.evaluate("() => !!(window.AGLic && window.AGProZamky)"))
        ok('R2 hlasi se jako vydani zaklad',
           await page.evaluate("() => window.AGLic && AGLic.vydani() === 'zaklad'"),
           await page.evaluate("() => window.AGLic ? AGLic.vydani() : '-'"))
        # ⚠ MRIZKA NASTROJU je duvod, proc tenhle test vznikl: js/field-tools.js
        #   se do seznamu "smazatelnych" jednou uz dostal a Zaklad by se nasadil
        #   uplne bez Nastroju. Staticky se to nepozna.
        await page.evaluate("() => { if (typeof openToolsModal === 'function') openToolsModal(); "
                            "else { var m=document.getElementById('tools-modal'); if(m) m.style.display='block'; } }")
        await page.wait_for_timeout(1400)
        dlazdic = await page.evaluate("() => document.querySelectorAll('#tools-modal .tool-tile').length")
        ok('R3 mrizka Nastroju v Zakladu existuje', dlazdic > 20, 'dlazdic: %d' % dlazdic)

        znacek = 0
        for _ in range(20):
            znacek = await page.evaluate("() => document.querySelectorAll('[data-agpro=\\\"1\\\"]').length")
            if znacek:
                break
            await page.evaluate("() => window.AGProZamky && AGProZamky.oznac()")
            await page.wait_for_timeout(350)
        ok('R4 Pro nastroje jsou videt a maji zamek', znacek > 0, 'oznaceno: %d' % znacek)

        karta = await page.evaluate("""() => {
          var el = document.querySelector('[data-agpro="1"]');
          if (!el) return { chybi: true };
          el.click();
          var m = document.getElementById('ag-pro-modal');
          if (!m) return { chybi: true };
          var r = m.querySelector('.agp-prechod');
          return { chybi: false, karta: m.classList.contains('on'),
                   prechod: !!(r && !r.hidden),
                   cil: (m.querySelector('.agp-otevri') ? 'ano' : 'ne') };
        }""")
        ok('R5 klepnuti na zamceny nastroj otevre kartu', karta.get('karta') is True, karta)
        ok('R6 karta v Zakladu nabizi prechod na /pro/', karta.get('prechod') is True, karta)
        await page.evaluate("() => { var m=document.getElementById('ag-pro-modal'); if(m) m.classList.remove('on'); }")

        # Nastroj ZE ZAKLADU se musi otevrit normalne - kdyby delene sestaveni
        # vyhodilo neco navic, poznalo by se to prave tady.
        zaklad_ok = await page.evaluate("""() => {
          if (typeof window.openMeasureModal !== 'function') return { chybi: true };
          try { window.openMeasureModal(); } catch (e) { return { spadlo: String(e) }; }
          var m = document.getElementById('ag-pro-modal');
          return { zamek: !!(m && m.classList.contains('on')) };
        }""")
        ok('R7 nastroj ze Zakladu se otevre (nezamkl se omylem)',
           zaklad_ok.get('chybi') is not True and zaklad_ok.get('spadlo') is None
           and zaklad_ok.get('zamek') is False, zaklad_ok)

        vazne = [c for c in chyby if 'favicon' not in c.lower()]
        ok('R8 zadna chyba v konzoli', not vazne, vazne[:4])
        pro404 = [u for u in ch404 if u.endswith('.js') or u.endswith('.css')]
        ok('R9 nic se nestahuje na 404 (smazany Pro modul)', not pro404, pro404[:4])
        await br.close()


def main():
    import asyncio
    tmp = tempfile.mkdtemp(prefix='ag-vydani-')
    zaklad, pro = os.path.join(tmp, 'zaklad'), os.path.join(tmp, 'pro')
    try:
        print('Sestavuji obe vydani do %s ...' % tmp)
        postav(zaklad, 'zaklad')
        postav(pro, 'pro')
        staticky(zaklad, pro)
        # --staticky: bez prohlizece. Pouziva release-check.yml, aby zustal
        # rychly; spusteni Zakladu hlida job "regrese" v tests.yml.
        if '--staticky' not in sys.argv:
            srv, url = server(zaklad, PORT)
            if not srv:
                ok('R0 testovaci server nenabehl', False)
            else:
                try:
                    asyncio.run(za_behu(url))
                finally:
                    srv.terminate()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    vad = [j for o, j in vysledky if not o]
    print('\n%d/%d OK' % (len(vysledky) - len(vad), len(vysledky)))
    if vad:
        print('VADY:')
        for j in vad:
            print('  - ' + j)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
