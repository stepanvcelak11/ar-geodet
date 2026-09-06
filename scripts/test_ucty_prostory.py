#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ===== AR Geodet - NOVE PRIHLASOVANI: ucty, prostory, tarif ===================
# Model rozhodnuty 6. 9. 2026: HOST SE RUSI (bez profilu se do appky nedostane
# nikdo), identita je UCET s vlastnim kodem, misto kde clovek pracuje je PROSTOR
# a TARIF DRZI UCET, ne prostor.
#
# Co se tu overuje SPUSTENIM (staticky se nic z toho nepozna):
#   U1  bez uctu stoji brana a nabizi obe cesty (prihlasit / zalozit ucet)
#   U2  stary hostovsky klic uz appku neodemyka a sam se uklidi
#   U3  registrace: ctyri pole, hlaska o neobnovitelnem hesle, kontrola shody
#   U4  po registraci se ukaze KOD UCTU - jedina cesta zpatky na jinem telefonu
#   U5  tarif 'pro' z uctu odemyka Pro nastroje (druha cesta vedle klice)
#   U6  prepinac prostoru se v Zakladu NEUKAZUJE (slovo "firma" solo uzivatel
#       nema videt), s tarifem Pro ano
#
# Server se tu NEVOLA. /register a /login se podvrhuji pres ctx.route, protoze
# testujeme klienta - a taky proto, ze zakladat ucty na ostrem serveru kvuli
# testu je posledni vec, kterou chceme.
# ⚠ MUSI to byt ctx.route (ne page.route) + service_workers='block': dotazy
#   pres service worker page.route NEODCHYTI (uz jednou to stalo pul dne).
#
# Pouziti (z korene repa):  python scripts/test_ucty_prostory.py [port]
# Navratovy kod: 0 = vse OK, 1 = aspon jedna vada.
# ==============================================================================
import asyncio
import json
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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9021)
URL = None
API = 'https://ar-geodet-api.ar-geodet.workers.dev'

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno
          + (('  -> ' + str(detail)[:280]) if detail != '' else ''))


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


# Odpoved podvrzeneho /register — tvarem presne ta, kterou vraci cloud/worker.js.
REG_ODPOVED = {
    'token': 'test.token',
    'ucet': {'id': 'a1', 'code': 'QWER5678', 'name': 'Jan Novak', 'tarif': 'zaklad'},
    'user': {'id': 'u1', 'name': 'Jan Novak', 'role': 'admin'},
    'prostory': [{'firmId': 'f1', 'uid': 'u1', 'role': 'admin', 'vlastni': True,
                  'archiv': False, 'nazev': None, 'kod': None}],
    'config': {
        'firm': {'code': 'ABC123', 'name': 'Moje mereni', 'autoLockMin': 0, 'perms': {}},
        'users': [{'id': 'u1', 'name': 'Jan Novak', 'role': 'admin'}],
        'limits': {'users': 1, 'maxUsers': 1, 'frozen': 0},
        'serverTime': 0
    }
}


async def nacti(page):
    for _ in range(4):
        try:
            await page.goto(URL, wait_until='domcontentloaded', timeout=45000)
            break
        except Exception:
            await page.wait_for_timeout(1500)
    await page.wait_for_timeout(2400)
    for _ in range(25):
        if await page.evaluate("() => typeof window.AGUcty === 'object'"):
            break
        await page.wait_for_timeout(300)
    await page.wait_for_timeout(600)


async def brana(browser):
    """U1-U4: prazdny telefon se starym hostovskym klicem."""
    ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    # Podvrzeny server: /register vrati hotovy ucet, nic jineho se nevola.
    async def obsluha(route):
        if route.request.url.endswith('/register'):
            await route.fulfill(status=200, content_type='application/json',
                                body=json.dumps(REG_ODPOVED))
        else:
            await route.fulfill(status=500, content_type='application/json', body='{"error":"nic"}')
    await ctx.route(API + '/**', obsluha)
    # Stary hostovsky klic SCHVALNE: driv by appku odemkl natrvalo.
    await ctx.add_init_script("""
      localStorage.setItem('agGuest_v1', JSON.stringify({ts: Date.now()}));
      localStorage.setItem('agTutProSeen','1');
      localStorage.setItem('agBrifinkAuto','0');
    """)
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await nacti(page)

    g = await page.evaluate("""() => {
      var g = document.getElementById('ag-gate');
      if (!g) return { je: false };
      return { je: true, vidno: getComputedStyle(g).display !== 'none',
               prihlasit: !!document.getElementById('agg-show-join'),
               zalozit: !!document.getElementById('agg-reg'),
               host: !!document.getElementById('agg-guest') };
    }""")
    ok('U1a bez uctu stoji brana', g.get('je') and g.get('vidno'), g)
    ok('U1b brana nabizi prihlaseni i zalozeni uctu', g.get('prihlasit') and g.get('zalozit'), g)
    ok('U2a tlacitko "pokracovat bez prihlaseni" uz neexistuje', not g.get('host'), g)
    ok('U2b stary klic agGuest_v1 se uklidil',
       await page.evaluate("() => localStorage.getItem('agGuest_v1')") is None)

    # ---- U3 registrace -------------------------------------------------------
    await page.click('#agg-reg')
    await page.wait_for_timeout(500)
    r = await page.evaluate("""() => {
      var o = document.getElementById('ag-reg');
      if (!o) return { je: false };
      return { je: true,
               poli: o.querySelectorAll('input').length,
               text: (o.textContent || '').replace(/\\s+/g, ' ') };
    }""")
    ok('U3a "Zalozit ucet" otevre registraci', r.get('je'), r)
    ok('U3b ma jmeno, nazev prostoru a heslo dvakrat', r.get('poli') == 4, r)
    # Bez teto vety clovek nezjisti, ze o data prijde - a zjisti to az pozde.
    ok('U3c rekne, ze heslo nejde obnovit',
       'nejde obnovit' in (r.get('text') or '').lower(), (r.get('text') or '')[:160])
    # ⚠⚠ REGISTRACE MUSI PREZIT TIK POJISTKY. gateCheck() bezi po 2 s a kdyz
    #   v jeho seznamu "brana uz stoji" chybi obrazovka zalozeni uctu, polozi se
    #   pres ni prihlaseni a clovek prijde o vsechno napsane. Presne to se stalo
    #   a poznalo se to az podle toho, ze klepnuti na tlacitko trefilo hlasku
    #   pod branou. Ceka se schvalne DELE nez 2 s.
    await page.fill('#agr-name', 'Jan Novak')
    await page.wait_for_timeout(2600)
    prekryto = await page.evaluate("""() => ({
      brana: !!document.getElementById('ag-gate'),
      regStoji: !!document.getElementById('ag-reg'),
      jmeno: (document.getElementById('agr-name') || {}).value || ''
    })""")
    ok('U3e registraci nepolozi po dvou vterinach brana',
       prekryto['regStoji'] and not prekryto['brana'], prekryto)
    ok('U3f a nezmizi, co uz clovek napsal', prekryto['jmeno'] == 'Jan Novak', prekryto)

    # Neshoda hesel se NESMI odeslat na server.
    await page.fill('#agr-name', 'Jan Novak')
    await page.fill('#agr-space', 'Moje mereni')
    await page.fill('#agr-pass', 'heslo12345')
    await page.fill('#agr-pass2', 'heslo54321')
    await page.click('#agr-go')
    await page.wait_for_timeout(400)
    hl = await page.evaluate("() => (document.getElementById('agr-err')||{}).textContent || ''")
    ok('U3d neshoda hesel se neodesle', 'neshoduj' in hl.lower(), hl)

    # ---- U4 kod uctu po registraci -------------------------------------------
    await page.fill('#agr-pass2', 'heslo12345')
    await page.click('#agr-go')
    await page.wait_for_timeout(1500)
    k = await page.evaluate("""() => {
      var o = document.getElementById('ag-kod');
      if (!o) return { je: false };
      return { je: true, text: (o.textContent || '').replace(/\\s+/g, ' ') };
    }""")
    ok('U4a po registraci se ukaze kod uctu', k.get('je'), k)
    ok('U4b a je to opravdu ten kod ze serveru', 'QWER5678' in (k.get('text') or ''), k)
    ok('U4c ucet se ulozil do telefonu',
       await page.evaluate("() => { var u = JSON.parse(localStorage.getItem('agUcet_v1')||'null'); return u && u.code; }") == 'QWER5678')
    ok('U4d registrace nabootovala bez chyby v konzoli', not chyby, chyby[:3])
    await ctx.close()


async def tarif(browser, tarif_uctu, cekej_pro):
    """U5/U6: tarif uctu odemyka Pro; prepinac prostoru jen s Pro."""
    ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    await ctx.add_init_script(boot(tarif=tarif_uctu))
    page = await ctx.new_page()
    await nacti(page)
    for _ in range(25):
        if await page.evaluate("() => !!(window.AGLic && window.AGProZamky)"):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(300)
    await page.wait_for_timeout(900)

    je = await page.evaluate("() => !!(window.AGLic && AGLic.isPro())")
    zdroj = await page.evaluate("() => (window.AGLic && AGLic.stav().zdroj) || null")
    ok('U5 tarif %s -> isPro() = %s' % (tarif_uctu, cekej_pro), je is cekej_pro,
       {'isPro': je, 'zdroj': zdroj})
    if cekej_pro:
        ok('U5b a licence hlasi, ze to je z UCTU (ne z klice)', zdroj == 'ucet', zdroj)

    # Prepinac prostoru: v Zakladu se neukazuje vubec (solo uzivatel se o zadne
    # "firme" nema dozvedet), s Pro ano.
    for _ in range(12):
        vid = await page.evaluate("() => !!document.getElementById('ag-prostory-btn')")
        if vid == cekej_pro:
            break
        await page.wait_for_timeout(400)
    ok('U6 prepinac prostoru u tarifu %s: %s' % (tarif_uctu, 'je' if cekej_pro else 'neni'),
       vid == cekej_pro, {'videt': vid})
    await ctx.close()


async def main():
    from playwright.async_api import async_playwright
    srv = server()
    if not srv:
        print('CHYBA: testovaci server nenabehl')
        return 1
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            await brana(br)
            await tarif(br, 'zaklad', False)
            await tarif(br, 'pro', True)
            await br.close()
    finally:
        srv.terminate()

    vad = [j for o, j in vysledky if not o]
    print('\n%d/%d OK' % (len(vysledky) - len(vad), len(vysledky)))
    if vad:
        print('VADY:')
        for j in vad:
            print('  - ' + j)
        return 1
    print('OK - ucty, prostory a tarif drzi i za behu.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
