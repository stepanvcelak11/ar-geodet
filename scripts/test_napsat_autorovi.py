#!/usr/bin/env python3
# ===== AR Geodet - CESTA "NAPSAT AUTOROVI" (v276) =============================
# PROC TENHLE TEST EXISTUJE: 5. 9. 2026 se pri prohlidce zmerilo, ze zprava
# autorovi appky je NEDOSAZITELNA pro toho, kdo ma k psani nejvic duvodu.
#
#   * #menu-toggle-btn (tlacitko, ktere otevira panel "Vice" s polozkou
#     "Napsat autorovi") ma v css/style.css DVAKRAT `display:none !important`
#     - od prechodu na dok se panel otevira jen z Nastaveni -> Udrzba.
#   * Zalozka Udrzba je HOSTOVI schovana opravnenim (GUEST_ALLOW v js/ucty.js).
#   * Host tedy nemel k autorovi zadnou viditelnou cestu - PRESTOZE ho server
#     schvalne pousti psat bez prihlaseni (POST /feedback bez tokenu).
#
# Opravou je trvaly radek v paticce Nastaveni a Nastroju (injectFooters()
# v js/zpetna-vazba.js), ktery stoji MIMO zalozky, takze na nej applyPerms()
# nesaha. Tenhle test hlida, ze to tak zustane:
#
#   A) HOST vidi radek hned po otevreni Nastaveni, bez rolovani, a terc ma
#      aspon 44 px (rukavice).
#   B) Klepnuti zavre Nastaveni a otevre okno "Napsat autorovi".
#   C) Radek je i v paticce Nastroju, a to MIMO .tool-grid (jinak by ho schovalo
#      opravneni role nebo filtr hledani).
#   D) Popisky vsude rikaji "Napsat autorovi" (ne "Napiste mi") a slovnik
#      data/jazyky.json na ne zna preklad - jinak by po prepnuti jazyka zustaly
#      cesky.
#   E) Gesto: v js/gesta-zkratky.js je akce act:napiste a miri na radek v
#      Nastaveni (kdyz se vrstva zpetne vazby odpoji, prvek proste neni).
#
# Pouziti (z korene repa):  python scripts/test_napsat_autorovi.py [port]
# Navratovy kod: 0 = vse OK, 1 = aspon jedna vada.
# ==============================================================================
import asyncio
import io
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
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8951
URL = None

# Host = clovek, ktery appku prave dostal odkazem a jen klepl na "Pokracovat
# bez prihlaseni". Presne ten, kdo ma k psani nejvic duvodu.
BOOT_HOST = """
  localStorage.setItem('agGuest_v1', JSON.stringify({ts: Date.now()}));
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agBrifinkLastShown', new Date().toISOString().slice(0,10));
"""

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)[:300]) if detail != '' else ''))


def server():
    """Na Windows zustava port po predchozim behu chvili obsazeny - zkousi se vic."""
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
    await page.wait_for_timeout(2200)
    # Vrstva zpetne vazby je odlozeny modul - bez flushe by radek jeste nebyl.
    for _ in range(40):
        if await page.evaluate("() => !!window.AGZpetna"):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(400)
    # #welcome-screen ma z-index 999999 a chytal by vsechny kliky
    await page.evaluate("() => { var w=document.getElementById('welcome-screen'); if(w) w.style.display='none'; }")
    await page.wait_for_timeout(800)


# Prvek se pocita za VIDITELNY, jen kdyz document.elementFromPoint v jeho stredu
# vrati jeho samotneho nebo jeho potomka - zavrena okna appky nemaji display:none,
# jen parkuji mimo displej (viz poznamky k vizualnimu auditu).
VIDITELNOST = """(id) => {
  var el = document.getElementById(id);
  if (!el) return { chybi: true };
  var r = el.getBoundingClientRect();
  var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  var t = document.elementFromPoint(cx, cy);
  return { chybi: false, w: Math.round(r.width), h: Math.round(r.height),
           top: Math.round(r.top), bottom: Math.round(r.bottom),
           vVyrezu: r.top >= 0 && r.bottom <= window.innerHeight,
           jeVidet: !!(t && (t === el || el.contains(t))),
           text: (el.innerText || '').trim(),
           vMrizce: !!el.closest('.tool-grid') };
}"""


async def test_host(ctx):
    page = await ctx.new_page()
    await nacti(page)

    # A) host otevre Nastaveni (jedina cesta, kterou ma) a radek musi byt hned videt
    await page.evaluate("() => { if (typeof openSettings === 'function') openSettings(); }")
    await page.wait_for_timeout(1500)
    v = await page.evaluate(VIDITELNOST, 'ag-fb-foot-set')
    ok('A1 radek "Napsat autorovi" je v Nastaveni', not v.get('chybi'), v)
    if not v.get('chybi'):
        ok('A2 host ho vidi bez rolovani', v['jeVidet'] and v['vVyrezu'], v)
        ok('A3 terc ma aspon 44 px (rukavice)', v['h'] >= 44, v)
        # kdyby se ocitl v .modal-body, patril by jedne zalozce a host by ho neuvidel
        rodic = await page.evaluate("() => { var e=document.getElementById('ag-fb-foot-set');"
                                    " return e ? (e.parentElement.className || '') : ''; }")
        ok('A4 stoji mimo zalozky (.modal-content)', 'modal-content' in rodic, rodic)

    # kontrolni tvrzeni k duvodu, proc radek vznikl: Udrzba je hostovi zavrena
    udrzba = await page.evaluate("() => { var t=document.getElementById('tab-udrzba');"
                                 " return t ? getComputedStyle(t).display : 'CHYBI'; }")
    ok('A5 (kontext) Udrzba je hostovi porad schovana', udrzba == 'none', udrzba)

    # B) klepnuti otevre okno a zavre Nastaveni
    await page.click('#ag-fb-foot-set')
    await page.wait_for_timeout(1200)
    stav = await page.evaluate("""() => {
      var m = document.getElementById('ag-fb-modal');
      var s = document.getElementById('settings-modal');
      return { okno: !!m && getComputedStyle(m).display !== 'none',
               nadpis: m ? ((m.querySelector('h2') || {}).innerText || '').trim() : '',
               nastaveniZavrena: !s || s.style.display === 'none',
               textarea: !!document.getElementById('ag-fb-txt') }; }""")
    ok('B1 klepnuti otevre okno zpravy', stav['okno'], stav)
    ok('B2 Nastaveni se pod nim zavrou', stav['nastaveniZavrena'], stav)
    ok('B3 v okne je pole na zpravu', stav['textarea'], stav)
    ok('B4 nadpis rika "Napsat autorovi"', 'Napsat autorovi' in stav['nadpis'], stav['nadpis'])
    await page.evaluate("() => { if (window.AGZpetna) AGZpetna.close(); }")
    await page.wait_for_timeout(600)

    # C) paticka Nastroju
    await page.evaluate("() => { var n=document.getElementById('tools-modal'); if(n) n.style.display='flex'; }")
    await page.wait_for_timeout(1200)
    v2 = await page.evaluate(VIDITELNOST, 'ag-fb-foot-tools')
    ok('C1 radek je i v paticce Nastroju', not v2.get('chybi'), v2)
    if not v2.get('chybi'):
        ok('C2 stoji mimo mrizku dlazdic', not v2['vMrizce'], v2)
        ok('C3 terc ma aspon 44 px', v2['h'] >= 44, v2)
    await page.evaluate("() => { var n=document.getElementById('tools-modal'); if(n) n.style.display='none'; }")

    # D) popisky
    p = await page.evaluate("""() => { var o={};
      ['ag-fb-menu-btn','ag-fb-set-btn','ag-fb-foot-set','ag-fb-foot-tools'].forEach(function(id){
        var e=document.getElementById(id); o[id]= e ? (e.innerText||'').trim() : null; });
      return o; }""")
    ok('D1 popisek v panelu Vice = "Napsat autorovi"', p['ag-fb-menu-btn'] == 'Napsat autorovi', p)
    ok('D2 nikde nezustalo "Napiste mi"',
       not any('Napi' in (t or '') and 'te mi' in (t or '') for t in p.values()), p)
    await page.close()


def test_slovnik():
    """Texty, ktere si modul sklada sam, jdou pres AGJazyk.t() - bez zaznamu ve
    slovniku by po prepnuti jazyka zustaly cesky."""
    p = os.path.join(ROOT, 'data', 'jazyky.json')
    d = json.load(io.open(p, encoding='utf-8'))
    t = d.get('t', {})
    for klic in [u'Napsat autorovi', u'Napsat autorovi — nápady a chyby',
                 u'Něco nesedí, nebo něco chybí? Napsat autorovi']:
        h = t.get(klic)
        ok('D3 slovnik zna "%s"' % klic[:34], isinstance(h, list) and len(h) == 3 and all(h), h)


def test_gesto():
    """Akce se spousti .click() na radek v Nastaveni - kdyz se vrstva zpetne vazby
    odpoji, prvek neexistuje a zkratka nic nespusti (stejne jako u schovanych dlazdic)."""
    s = io.open(os.path.join(ROOT, 'js', 'gesta-zkratky.js'), encoding='utf-8').read()
    ok('E1 akce act:napiste je v seznamu', "'act:napiste'" in s)
    ok('E2 miri na #ag-fb-foot-set', "'#ag-fb-foot-set'" in s)


async def main():
    from playwright.async_api import async_playwright
    srv = server()
    if not srv:
        print('CHYBA: testovaci server nenabehl')
        return 1
    print('Server: ' + str(URL))
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                            permissions=['geolocation'],
                                            geolocation={'latitude': 50.0875, 'longitude': 14.4213},
                                            service_workers='block')
            await ctx.add_init_script(BOOT_HOST)
            await test_host(ctx)
            await ctx.close()
            await browser.close()
    finally:
        srv.terminate()

    test_slovnik()
    test_gesto()

    spatne = [j for (o, j) in vysledky if not o]
    print('\n' + ('=' * 62))
    print('Hotovo: %d/%d' % (len(vysledky) - len(spatne), len(vysledky)))
    for j in spatne:
        print('  CHYBA: ' + j)
    return 1 if spatne else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
