#!/usr/bin/env python3
# ===== AR Geodet - ZAKLAD vs PRO: zamky placene verze =========================
# PROC TENHLE TEST EXISTUJE: appka se deli na ZAKLAD (zdarma, cely den v terenu)
# a PRO (placene, pridava protokoly, objemy, firmu a pokrocile vypocty). Co je
# ci, stoji v js/tools-registry.js jako `pro: 1`; zda to telefon ma, rika
# js/licence.js; zamyka js/pro-zamky.js.
#
# Zamek se da rozbit TISE. Statické kontroly na to nestaci - proto se tady appka
# SPOUSTI a zamek se zkousi obejit stejne, jak by ho obesel uzivatel:
#
#   A) Cisty telefon nema Pro a appka nabehne bez chyb v konzoli.
#   B) Pro nastroj je VIDET (rozhodnuti: zamecek, ne zmizeni) a ma znacku.
#   C) Nastroj ze ZAKLADU znacku nema - jinak by se zamykalo, co ma byt zdarma.
#   D) Klepnuti na zamceny nastroj ho NEOTEVRE, otevre kartu "co to umi".
#   E) OBEJITI KLIKU: zavolani oteviraci funkce naprimo (gesto, hledani, konzole)
#      taky neotevre nastroj, ale kartu. Klik je jen jedna z peti cest.
#   F) Spatny klic neodemkne a rekne proc.
#   G) Platny klic odemkne: znacky zmizi a TYZ nastroj uz se otevre normalne
#      (dukaz, ze obal pousti puvodni funkci dal, misto aby ji nahradil).
#   H) Vstup ke koupi je v "Vice" - tedy MIMO zalozky Nastaveni a mimo
#      .tool-grid, na ktere sahaji opravneni role (tou pasti uz jednou propadlo
#      "Napsat autorovi", viz scripts/test_napsat_autorovi.py).
#   I) POZVANKA BEZ PRO: job-transfer a prenosy-zarizeni nesmi byt zamcene -
#      kdo ma Pro, muze pozvat cloveka bez Pro, aby mu delal na zakazce, a ten
#      musi mit cim prevzit zakazku a poslat data zpatky.
#
# Pouziti (z korene repa):  python scripts/test_pro_verze.py [port]
# Navratovy kod: 0 = vse OK, 1 = aspon jedna vada.
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

BOOT = """
  localStorage.setItem('agGuest_v1', JSON.stringify({ts: Date.now()}));
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agBrifinkLastShown', new Date().toISOString().slice(0,10));
  localStorage.removeItem('agLicence_v1');
"""

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)[:300]) if detail != '' else ''))


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


async def nacti(page):
    for _ in range(4):
        try:
            await page.goto(URL, wait_until='domcontentloaded', timeout=45000)
            break
        except Exception:
            await page.wait_for_timeout(1500)
    await page.wait_for_timeout(2400)
    # zamky se ve svem tiku dozvi o dlazdicich az po registraci modulu
    for _ in range(30):
        if await page.evaluate("() => !!window.AGProZamky && !!window.AGLic"):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(400)
    await page.evaluate("() => { var w=document.getElementById('welcome-screen'); if(w) w.style.display='none'; }")
    await page.wait_for_timeout(900)


# Ceka, az periodicky tik zamku oznaci dlazdice (bezi po 1,5 s).
async def pockej_na_znacky(page):
    for _ in range(20):
        n = await page.evaluate("() => document.querySelectorAll('[data-agpro=\\\"1\\\"]').length")
        if n > 0:
            return n
        await page.evaluate("() => window.AGProZamky && AGProZamky.oznac()")
        await page.wait_for_timeout(350)
    return 0


async def bezi(ctx):
    chyby = []
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text) if m.type == 'error' else None)
    await page.add_init_script(BOOT)
    await nacti(page)

    # ---- A) cisty telefon -----------------------------------------------------
    ok('A1 js/licence.js nabehl', await page.evaluate("() => !!window.AGLic"))
    ok('A2 js/pro-zamky.js nabehl', await page.evaluate("() => !!window.AGProZamky"))
    ok('A3 cisty telefon nema Pro', await page.evaluate("() => window.AGLic && AGLic.isPro() === false"))
    ok('A4 registr zna delici caru',
       await page.evaluate("() => window.AGReg && AGReg.proKeys().length > 20"),
       await page.evaluate("() => window.AGReg ? AGReg.proKeys().length : 'AGReg chybi'"))

    # ---- B/C) znacky ----------------------------------------------------------
    await page.evaluate("() => { if (typeof openToolsModal === 'function') openToolsModal(); "
                        "else { var m=document.getElementById('tools-modal'); if(m) m.style.display='block'; } }")
    await page.wait_for_timeout(1200)
    n = await pockej_na_znacky(page)
    ok('B1 zamcene nastroje jsou oznacene', n > 0, 'oznaceno prvku: %d' % n)

    # Pro nastroj musi byt VIDET (rozhodnuti: zamecek, ne zmizeni). Bereme
    # nastroj, ktery se registruje sam a ma tedy dlazdici i radek v ukonech.
    # Prvek se hleda STEJNYMI TREMI PRAVIDLY jako v appce (js/pro-zamky.js,
    # js/field-tools.js): `data-tool` u injektovane dlazdice, `data-k` u radku
    # v seznamu ukonu a jmeno posledni volane funkce z `onclick` u statickych
    # dlazdic v index.html. Hledat jen podle data-tool by u nastroju ze ZAKLADU
    # (openMeasureModal je staticka dlazdice) nenaslo nic a test by hlasil vadu,
    # ktera neexistuje - presne to se pri prvnim behu stalo.
    NAJDI = """(k) => {
      var el = document.querySelector('[data-tool="' + k + '"], [data-k="' + k + '"]');
      if (!el) {
        var vse = document.querySelectorAll('#tools-modal [onclick], .ag-uk-i, .tool-tile');
        for (var i = 0; i < vse.length; i++) {
          var oc = vse[i].getAttribute('onclick') || '';
          var ms = oc.match(/([A-Za-z_$][\\w$]*)\\s*\\(/g);
          var last = ms ? ms[ms.length - 1].replace(/\\s*\\($/, '') : null;
          if (last === k) { el = vse[i]; break; }
        }
      }
      return el ? { je: true, zamek: el.getAttribute('data-agpro') === '1' } : { je: false };
    }"""
    stav = {}
    for kl in ('epochy', 'kontrola-vrstvy', 'openDmtVolume'):
        stav[kl] = await page.evaluate(NAJDI, kl)
    stav['zaklad'] = await page.evaluate(NAJDI, 'openMeasureModal')
    nalezene = [k for k in ('epochy', 'kontrola-vrstvy', 'openDmtVolume') if stav[k]['je']]
    ok('B2 Pro nastroj v seznamu je (nezmizel)', len(nalezene) > 0, stav)
    ok('B3 a je oznaceny zamkem',
       all(stav[k]['zamek'] for k in nalezene) if nalezene else False, stav)
    ok('C1 nastroj ze Zakladu zamek NEMA',
       stav['zaklad']['je'] and not stav['zaklad']['zamek'], stav['zaklad'])

    # ---- I) pozvanka bez Pro musi projit --------------------------------------
    prujezd = await page.evaluate("""() => {
      var r = {};
      ['job-transfer','prenosy-zarizeni'].forEach(function (k) {
        r[k] = window.AGReg ? !!AGReg.isPro(k) : null;
      });
      return r;
    }""")
    ok('I1 job-transfer neni za penize (pozvany preda zakazku)', prujezd['job-transfer'] is False, prujezd)
    ok('I2 prenosy-zarizeni nejsou za penize', prujezd['prenosy-zarizeni'] is False, prujezd)

    # ---- D) klik zamceny nastroj neotevre --------------------------------------
    klik = await page.evaluate("""() => {
      var el = document.querySelector('[data-agpro="1"]');
      if (!el) return { chybi: true };
      el.click();
      var m = document.getElementById('ag-pro-modal');
      return { chybi: false, karta: !!(m && m.classList.contains('on')),
               nazev: m ? (m.querySelector('.agp-nazev') || {}).textContent : '' };
    }""")
    await page.wait_for_timeout(500)
    ok('D1 klepnuti otevre kartu "co to umi"', klik.get('karta') is True, klik)
    ok('D2 karta rika, o ktery nastroj slo', bool((klik.get('nazev') or '').strip()), klik)
    await page.evaluate("() => { var m=document.getElementById('ag-pro-modal'); if(m) m.classList.remove('on'); }")

    # ---- E) obejiti klikem mimo: volani funkce naprimo ------------------------
    obchoz = await page.evaluate("""() => {
      var k = null, klice = (window.AGReg && AGReg.proKeys()) || [];
      for (var i = 0; i < klice.length; i++) { if (typeof window[klice[i]] === 'function') { k = klice[i]; break; } }
      if (!k) return { zadna: true };
      try { window[k](); } catch (e) { return { k: k, spadlo: String(e) }; }
      var m = document.getElementById('ag-pro-modal');
      return { k: k, karta: !!(m && m.classList.contains('on')) };
    }""")
    await page.wait_for_timeout(500)
    if obchoz.get('zadna'):
        ok('E1 (preskoceno - zadny Pro nastroj nema globalni funkci)', True, obchoz)
    else:
        ok('E1 volani oteviraci funkce naprimo nastroj neotevre',
           obchoz.get('karta') is True, obchoz)
    await page.evaluate("() => { var m=document.getElementById('ag-pro-modal'); if(m) m.classList.remove('on'); }")

    # ---- E2) OKNO PO PREPSANI FUNKCE ------------------------------------------
    # Presne to, co dela odkladaci vrstva: pod jmeno Pro nastroje zapise novou
    # funkci (skutecny modul si po nacteni prepise zastupce) a hned se vola.
    # Zamek, ktery se obnovuje az v intervalu, tady PROPADNE - mezi zapisem a
    # tikem je az 1,5 s, kdy pod tim jmenem visi hola funkce. Test proto necha
    # BEZ jakehokoli cekani. E1 vyse na tomhle padal zhruba obden.
    okno = await page.evaluate("""() => {
      var k = null, klice = (window.AGReg && AGReg.proKeys()) || [];
      for (var i = 0; i < klice.length; i++) { if (typeof window[klice[i]] === 'function') { k = klice[i]; break; } }
      if (!k) return { zadna: true };
      var otevreno = false;
      window[k] = function () { otevreno = true; };   // "modul se donacetl"
      try { window[k](); } catch (e) { return { k: k, spadlo: String(e) }; }
      var m = document.getElementById('ag-pro-modal');
      return { k: k, otevreno: otevreno, karta: !!(m && m.classList.contains('on')) };
    }""")
    if okno.get('zadna'):
        ok('E2 (preskoceno - zadny Pro nastroj nema globalni funkci)', True, okno)
    else:
        ok('E2 prepsani funkce zamek neobejde (okno po donacteni modulu)',
           okno.get('otevreno') is False and okno.get('karta') is True, okno)
    await page.evaluate("() => { var m=document.getElementById('ag-pro-modal'); if(m) m.classList.remove('on'); }")

    # ---- H) vstup ke koupi je ve "Vice" ---------------------------------------
    vstup = await page.evaluate("""() => {
      var b = document.getElementById('ag-pro-menu-btn');
      if (!b) return { chybi: true };
      return { chybi: false, text: (b.textContent || '').trim(),
               vZalozce: !!b.closest('#settings-modal'), vMrizce: !!b.closest('.tool-grid') };
    }""")
    ok('H1 vstup "Verze Pro" je ve Vice', vstup.get('chybi') is False, vstup)
    if not vstup.get('chybi'):
        ok('H2 stoji mimo zalozky Nastaveni i mimo mrizku (applyPerms na nej nesaha)',
           not vstup['vZalozce'] and not vstup['vMrizce'], vstup)

    # ---- F) spatny klic --------------------------------------------------------
    spatny = await page.evaluate("""() => {
      var r = AGLic.uloz('ARG-1111-1111-1111-1111');
      return { ok: !!(r && r.ok), duvod: r && r.duvod, pro: AGLic.isPro() };
    }""")
    ok('F1 vymysleny klic neodemkne', spatny['ok'] is False and spatny['pro'] is False, spatny)
    ok('F2 a rekne proc', spatny.get('duvod') in ('podpis', 'tvar', 'verze', 'vyprsel'), spatny)

    # ---- G) platny klic odemkne -----------------------------------------------
    odemk = await page.evaluate("""() => {
      var klic = AGLic.vyrob(1, 0);
      var r = AGLic.uloz(klic);
      return { klic: klic, ok: !!(r && r.ok), pro: AGLic.isPro() };
    }""")
    ok('G1 platny klic odemkne Pro', odemk['ok'] is True and odemk['pro'] is True, odemk)

    await page.evaluate("() => window.AGProZamky && AGProZamky.oznac()")
    await page.wait_for_timeout(600)
    zbylo = await page.evaluate("() => document.querySelectorAll('[data-agpro=\\\"1\\\"]').length")
    ok('G2 po odemceni zamky zmizely', zbylo == 0, 'zbylo znacek: %s' % zbylo)

    # TYZ nastroj se ted uz musi otevrit normalne - dukaz, ze obal pousti puvodni
    # funkci dal. Kdyby ji nahradil, karta by se otevrela znovu.
    if not obchoz.get('zadna') and obchoz.get('k'):
        prosel = await page.evaluate("""(k) => {
          var m = document.getElementById('ag-pro-modal');
          if (m) m.classList.remove('on');
          try { window[k](); } catch (e) { return { spadlo: String(e) }; }
          m = document.getElementById('ag-pro-modal');
          return { karta: !!(m && m.classList.contains('on')) };
        }""", obchoz['k'])
        await page.wait_for_timeout(500)
        ok('G3 s licenci se tyz nastroj uz otevre (obal pousti dal)',
           prosel.get('karta') is False and not prosel.get('spadlo'), prosel)

    # ---- A5) konzole ------------------------------------------------------------
    # Cizi hlaseni (sit, kamera, GPS) nas nezajimaji - jen chyby z nasich modulu.
    nase = [c for c in chyby if 'licence' in c.lower() or 'pro-zamky' in c.lower()
            or 'AGLic' in c or 'AGProZamky' in c]
    ok('A5 zadna chyba z licence/zamku v konzoli', len(nase) == 0, nase[:3])

    await page.close()


async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print('PRESKOCENO - playwright tu neni')
        return 0
    srv = server()
    if not srv:
        print('CHYBA - testovaci server nenabehl')
        return 1
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(viewport={'width': 390, 'height': 844},
                                      user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
                                                 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1',
                                      service_workers='block')
            await bezi(ctx)
            await b.close()
    finally:
        srv.terminate()

    spatne = [j for o, j in vysledky if not o]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    if spatne:
        print('VADY:')
        for j in spatne:
            print('  - ' + j)
        return 1
    print('OK - delici cara Zaklad/Pro drzi i za behu.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
