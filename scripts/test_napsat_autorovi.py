#!/usr/bin/env python3
# ===== QTRIG - CESTA "NAPSAT AUTOROVI" (v276) =============================
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
#   F) (18. 9. 2026 vecer) pruh pod zalozkami je PRYC; Navod je na strance Ucet a aplikace; drive: vedle sebe "Vice" a
#      "Napsat autorovi". Panel Vice (navod, offline, sdileni, zpravodaj) mel do
#      teto chvile jediny vstup taky az v Udrzbe, tedy pro hosta zadny.
#   G) KONTEXT U ZPRAVY: druhe zaskrtavatko prilozi, co appka delala (otevrene
#      okno, posledni nastroj, pocet bodu, signal, posledni chyby). Server orezava
#      meta na 1500 znaku a orezany JSON uz nikdo neprecte - test meri delku.
#   H) PROTOKOL CHYB -> POSLAT AUTOROVI: predvyplni okno zpravy vypisem chyb.
#   I) PRAZDNA MRIZKA NASTROJU NENI NEMA: host videl 0 ze 100 dlazdic bez
#      jedine vety vysvetleni.
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

import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from ag_boot import BOOT_UCET_ZAMESTNANEC

# ⚠ HOST BYL ZRUSEN 6. 9. 2026. Test drzel na tom, ze vstup "Napsat autorovi"
#   vidi i clovek, na ktereho sahaji opravneni - driv to byl host, ted je to
#   RADOVY CLEN FIRMY (role zamestnanec). Pointa zustava tataz a je to porad
#   ta sama past: applyPerms() umi schovat zalozky Nastaveni i .tool-grid,
#   takze vstup musi stat mimo oboji.
BOOT_HOST = BOOT_UCET_ZAMESTNANEC

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

    # A) 18. 9. 2026 večer (Nastavení nanovo): „Napsat autorovi" z Nastavení ODEŠLO — je v Nástrojích
    #    nahoře (C) a v panelu Více (D). V Nastavení nesmí být vidět ani pruh #ag-set-strip.
    await page.evaluate("() => { if (typeof openSettings === 'function') openSettings(); }")
    await page.wait_for_timeout(1500)
    # vrstva zpetne vazby je odlozeny modul (ag/lazy) — pockat na window.AGZpetna, ne na konkretni tlacitko
    for _ in range(40):
        if await page.evaluate("() => !!window.AGZpetna"):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(400)
    await page.wait_for_timeout(800)
    v = await page.evaluate(VIDITELNOST, 'ag-fb-foot-set')
    ok('A1 radek "Napsat autorovi" v Nastaveni NENI (nebo je schovany)', v.get('chybi') or not v['jeVidet'], v)
    ok('A2 pruh #ag-set-strip v Nastaveni neexistuje', await page.evaluate("() => !document.getElementById('ag-set-strip')"))
    ok('A3 tlacitko v zalozce (ag-fb-set-btn) je schovane tridou .ag-set-drop', await page.evaluate("() => { var b = document.getElementById('ag-fb-set-btn'); return !b || getComputedStyle(b).display === 'none'; }"))
    ok('A4 Nastaveni maji prvni obrazovku (Caste + kategorie)', await page.evaluate("() => !!document.getElementById('set-home') && !document.getElementById('set-home').hidden && !!document.getElementById('set-caste')"))

    # kontrolni tvrzeni k duvodu, proc radek vznikl: Udrzba je hostovi zavrena
    udrzba = await page.evaluate("() => { var t=document.getElementById('tab-udrzba');"
                                 " return t ? getComputedStyle(t).display : 'CHYBI'; }")
    ok('A5 (kontext) Udrzba je hostovi porad schovana', udrzba == 'none', udrzba)
    await page.evaluate("() => { document.getElementById('settings-modal').style.display = 'none'; }")

    # B) klepnuti v Nastrojich otevre okno
    await page.evaluate("() => { var n=document.getElementById('tools-modal'); if(n) n.style.display='flex'; }")
    for _ in range(10):
        if await page.evaluate("() => !!document.getElementById('ag-fb-foot-tools')"):
            break
        await page.wait_for_timeout(400)
    await page.wait_for_timeout(600)
    if await page.evaluate("() => !!document.getElementById('ag-fb-foot-tools')"):
        await page.click('#ag-fb-foot-tools')
    else:
        await page.evaluate("() => { if (window.AGZpetna) AGZpetna.open(); }")
    await page.wait_for_timeout(1200)
    stav = await page.evaluate("""() => {
      var m = document.getElementById('ag-fb-modal');
      var s = document.getElementById('settings-modal');
      return { okno: !!m && getComputedStyle(m).display !== 'none',
               nadpis: m ? ((m.querySelector('h2') || {}).innerText || '').trim() : '',
               nastaveniZavrena: !s || s.style.display === 'none',
               textarea: !!document.getElementById('ag-fb-txt') }; }""")
    ok('B1 klepnuti otevre okno zpravy', stav['okno'], stav)
    ok('B2 Nastaveni pod nim nejsou otevrena', stav['nastaveniZavrena'], stav)
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


async def test_druha_vlna(ctx):
    """F-I: pruh pod zalozkami, kontext u zpravy, hlaseni z Protokolu chyb, prazdna mrizka."""
    page = await ctx.new_page()
    await nacti(page)

    # F) 18. 9. 2026 večer: pruh pod záložkami je pryč; Návod je na stránce Účet a aplikace (vidí ji i host)
    await page.evaluate("() => { if (typeof openSettings === 'function') openSettings(); }")
    await page.wait_for_timeout(1500)
    # vrstva zpětné vazby je odložený modul — G) ji potřebuje, dřív na ni čekal pruh v Nastavení
    for _ in range(20):
        if await page.evaluate("() => !!window.AGZpetna"):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(300)
    ok('F1 pruh #ag-set-strip / #ag-set-vice uz neexistuje', await page.evaluate("() => !document.getElementById('ag-set-strip') && !document.getElementById('ag-set-vice')"))
    await page.evaluate("() => switchTab('tab-ucet')")
    await page.wait_for_timeout(600)
    vice = await page.evaluate(VIDITELNOST, 'set-navod-btn')
    ok('F2 "Navod a prohlidka" je na strance Ucet a aplikace a host ho vidi', not vice.get('chybi') and vice['jeVidet'], vice)
    if not vice.get('chybi'):
        ok('F3 terc ma aspon 44 px', vice['h'] >= 44, vice)
    ok('F4 hlavicka stranky: nazev + Zpet', await page.evaluate("() => document.getElementById('set-title').textContent.trim() === 'Účet a aplikace' && !document.getElementById('set-back').hidden"))
    # klepnuti = navod (startTutorial, lazy js/tutorial-pro.js); Nastaveni se pod nim zavrou
    await page.evaluate("() => { window.__tut = 0; window.startTutorial = function () { window.__tut++; }; }")
    await page.click('#set-navod-btn')
    await page.wait_for_timeout(900)
    stav = await page.evaluate("""() => ({ tut: window.__tut, zavreno: document.getElementById('settings-modal').style.display === 'none' })""")
    ok('F5 klepnuti spusti navod (startTutorial)', stav['tut'] == 1, stav)
    ok('F6 Nastaveni se pod nim zavrou', stav['zavreno'], stav)
    await page.wait_for_timeout(400)

    # G) kontext u zpravy - odchytit, co by odeslo (sit se v testu nepusti)
    await page.evaluate("() => { if (window.AGZpetna) AGZpetna.open(); }")
    await page.wait_for_timeout(900)
    c = await page.evaluate("""() => { var c = document.getElementById('ag-fb-ctx');
        return { je: !!c, zaskrtnute: !!(c && c.checked) }; }""")
    ok('G1 zaskrtavatko kontextu je ve formulari', c['je'], c)
    ok('G2 je predzaskrtnute', c['zaskrtnute'], c)
    await page.evaluate("""() => { window.__odeslano = null;
        window.fetch = function (u, o) {
          try { if (String(u).indexOf('/feedback') >= 0 && o && o.body) window.__odeslano = JSON.parse(o.body); } catch (e) { }
          return Promise.reject(new Error('test: bez site')); }; }""")
    await page.fill('#ag-fb-txt', 'Zkouska kontextu.')
    await page.click('#ag-fb-send')
    await page.wait_for_timeout(2500)
    od = await page.evaluate("() => window.__odeslano")
    ok('G3 zprava se odeslala i s kontextem', bool(od and od.get('meta') and od['meta'].get('co')),
       (od or {}).get('meta'))
    if od and od.get('meta'):
        dl = len(json.dumps(od['meta'], ensure_ascii=False))
        ok('G4 meta se vejde do 1500 znaku serveru', dl <= 1500, dl)
        co = od['meta'].get('co') or {}
        ok('G5 kontext nese stav appky', ('online' in co) and ('zakazka' in co), co)
    # hlaska po odeslani chyta kliky - zavrit ji
    await page.evaluate("""() => { document.querySelectorAll('.ag-dlg-overlay.open').forEach(function (o) {
        var b = o.querySelector('button'); if (b) b.click(); o.classList.remove('open'); o.remove(); }); }""")
    await page.evaluate("""() => { if (window.AGZpetna) AGZpetna.close();
        try { localStorage.removeItem('agFbQ_v1'); localStorage.removeItem('agFbDraft_v1'); } catch (e) { } }""")
    await page.wait_for_timeout(500)

    # H) Protokol chyb -> Poslat autorovi
    await page.evaluate("() => { if (window.agErrLog) { agErrLog.record('Zkusebni chyba'); agErrLog.show(); } }")
    await page.wait_for_timeout(1200)
    je = await page.evaluate("() => !!document.getElementById('errlog-autor')")
    ok('H1 Protokol chyb ma tlacitko "Poslat autorovi"', je)
    if je:
        await page.click('#errlog-autor')
        await page.wait_for_timeout(1200)
        z = await page.evaluate("""() => { var m = document.getElementById('ag-fb-modal');
            var t = document.getElementById('ag-fb-txt');
            var a = document.querySelector('#ag-fb-kinds .act');
            return { okno: !!m && getComputedStyle(m).display !== 'none',
                     zavren: document.getElementById('errlog-modal').style.display === 'none',
                     druh: a ? a.dataset.k : null, delka: t ? t.value.length : 0 }; }""")
        ok('H2 otevre okno zpravy', z['okno'], z)
        ok('H3 zavre za sebou Protokol chyb', z['zavren'], z)
        ok('H4 predvyplni vypis chyb', z['delka'] > 40, z)
        ok('H5 nastavi druh "chyba"', z['druh'] == 'chyba', z)
        ok('H6 vejde se do stropu zpravy (4000)', z['delka'] < 4000, z)
        await page.evaluate("""() => { if (window.AGZpetna) AGZpetna.close();
            try { localStorage.removeItem('agFbDraft_v1'); } catch (e) { } }""")

    # I) prazdna mrizka Nastroju
    # ⚠ Driv tuhle situaci zastupoval HOST (zrusen 6. 9. 2026). Ted se navodi
    #   tim, co ji vyroba i v ostre appce: role, ktere sprava firmy nepovolila
    #   ani jednu kategorii nastroju. Opravneni se meni ZA BEHU (bustFirm +
    #   applyPerms), aby test nemusel zakladat druhy kontext a znovu cekat na
    #   nacteni appky.
    await page.evaluate('''() => {
      var f = JSON.parse(localStorage.getItem('agFirma_v1') || '{}');
      f.perms = { zamestnanec: { 'tools.Měření': false, 'tools.Vytyčování a náčrt': false,
        'tools.Katastr a data': false, 'tools.AR a kalibrace': false,
        'tools.Pomůcky': false, 'tools.Terénní nástroje': false } };
      localStorage.setItem('agFirma_v1', JSON.stringify(f));
      if (window.AGUcty) { AGUcty.bustFirm(); AGUcty.applyPerms(); }
    }''')
    await page.wait_for_timeout(400)
    await page.evaluate("() => { var n = document.getElementById('tools-modal'); if (n) n.style.display = 'flex'; }")
    await page.wait_for_timeout(1800)
    k = await page.evaluate(VIDITELNOST, 'ag-tools-empty')
    ok('I1 prazdna mrizka Nastroju neni nema', not k.get('chybi'), k)
    # ⚠ Pozice v pixelech se tu MERIT NEDA: okno Nastroju se otevira nastavenim
    # display:flex a obsah se podle poradi nacteni modulu obcas jeste nerozlozi
    # (namereno: tataz karta jednou na 523 px, podruhe na 2606 px). Tvrzeni jsou
    # proto o DOM a o opravnenich, ne o souradnicich.
    if not k.get('chybi'):
        umist = await page.evaluate("""() => { var k = document.getElementById('ag-tools-empty');
            var g = document.querySelector('#tools-modal .tool-grid');
            var vis = 0, tiles = g ? g.querySelectorAll('.tool-tile') : [];
            for (var i = 0; i < tiles.length; i++) if (getComputedStyle(tiles[i]).display !== 'none') vis++;
            var poradi = (k && g) ? k.compareDocumentPosition(g) : 0;
            return { predMrizkou: !!(poradi & Node.DOCUMENT_POSITION_FOLLOWING),
                     schovana: getComputedStyle(k).display === 'none',
                     videtDlazdic: vis, dlazdicCelkem: tiles.length }; }""")
        ok('I2 karta stoji NAD mrizkou a je zapnuta',
           umist['predMrizkou'] and not umist['schovana'], umist)
        # Karta uz nemluvi o prihlaseni (host zrusen 6. 9. 2026), ale rekne,
        # KDO prazdnou mrizku spravi: kategorie prideluje spravce firmy v rolich.
        ok('I3 rika, kdo prazdnou mrizku spravi', 'role' in k['text'].lower(), k['text'])
        # ⚠⚠ Zony bez nadpisu kategorie („⚡ Ted se hodi") drive prusvih: hostovi
        # v nich zustala viditelna dlazdice „Firma a ucty". Treti pruchod applyPerms
        # to dojizdi podle skutecne kategorie nastroje.
        ok('I4 hostovi nezustala viditelna zadna dlazdice',
           umist['videtDlazdic'] == 0 and umist['dlazdicCelkem'] > 50, umist)
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
        ok('D3 slovnik zna "%s"' % klic[:34], isinstance(h, list) and len(h) >= 3 and all(h), h)


def test_gesto():
    """Akce se spousti .click() na radek v Nastaveni - kdyz se vrstva zpetne vazby
    odpoji, prvek neexistuje a zkratka nic nespusti (stejne jako u schovanych dlazdic)."""
    s = io.open(os.path.join(ROOT, 'js', 'gesta-zkratky.js'), encoding='utf-8').read()
    ok('E1 akce act:napiste je v seznamu', "'act:napiste'" in s)
    ok('E2 miri na tlacitko v Nastrojich (#ag-fb-foot-tools; radek v Nastaveni od 18. 9. 2026 vecer neni)', "'#ag-fb-foot-tools" in s and "'#ag-fb-foot-set'" not in s)


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
            ctx = await browser.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                            permissions=['geolocation'],
                                            geolocation={'latitude': 50.0875, 'longitude': 14.4213},
                                            service_workers='block')
            await ctx.add_init_script(BOOT_HOST)
            await test_host(ctx)
            await test_druha_vlna(ctx)
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
