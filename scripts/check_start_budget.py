#!/usr/bin/env python3
# ===== AR Geodet - ROZPOCET STARTU (brana v CI) ================================
# PROC TENHLE SKRIPT EXISTUJE:
# Prohlizec musi VSECHNY soubory, ktere jsou v index.html zapsane jako obycejny
# <script src> a <link rel=stylesheet>, stahnout, naparsovat a spustit JESTE PRED
# prvnim vykreslenim. Kazdy novy modul, ktery se tam pridal, tedy zdrazil START
# VSEM uzivatelum - i tem, kteri ten nastroj za cely den neotevrou.
#
# Priklad z 29.8.2026: eager JS narostl na 2273 kB v 79 souborech. Presun devíti
# modulu na <script type="ag/lazy" data-src=...> (vrstva js/lazy-load.js) srazil
# prvni vykresleni z 892 ms na 588 ms a start appky z 1794 ms na 1344 ms.
# Nic takoveho ale nedrzelo: za tri mesice by to naroslo zpatky a nikdo by si
# toho nevsimnul, protoze se to neprojevi jako chyba - jen jako "appka se nejak
# dlouho otevira".
#
# CO SKRIPT DELA: secte bajty vsech EAGER zdroju z index.html a porovna se
# stropem. Kdyz strop praskne, vypise NEJVETSI polozky a pripomene, ze vetsina
# nastroju patri do lazy vrstvy.
#
# STROP SE SMI ZVYSIT - ale vedome, jednim commitem, s duvodem v teto hlavicce.
# Neni to zakaz rustu, je to zarazka proti TICHEMU rustu.
#
# CO SE NEPOCITA: lazy skripty (type="ag/lazy"), pisma (nacitaji se az pri
# vykreslovani textu a maji font-display), obrazky a ikony.
#
# Pouziti:
#   python scripts/check_start_budget.py           # soupis + verdikt
#   python scripts/check_start_budget.py --check   # jen verdikt (CI, navratovy kod)
# ==============================================================================
import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')

# ---- STROPY ------------------------------------------------------------------
# Stav pri zavedeni (29.8.2026): JS 1945 kB / 70 souboru, CSS 298 kB / 26 souboru.
# Rezerva je zamerne mala (~3 %), aby se o strop zavadilo hned, ne az za pul roku.
#
# ZVYSENO 31.8.2026: 2000 -> 2060 kB. Duvod (aby to nebyl tichy rust):
#   Strop uz praskl na main SAM OD SEBE - po slouceni vetvi (commit 49cce1a) bylo
#   EAGER JS 2023 kB, tedy CI na main svitilo cervene, aniz by si toho kdo vsiml.
#   Opravy z 31.8. pridaly dalsich ~9 kB do modulu, ktere EAGER byt MUSI:
#   js/ucty.js (vychod z omezeneho rezimu je potreba hned pri startu),
#   js/tools-registry.js (cte z nej mrizka i seznam ukonu), js/modal-close.js
#   (obaluje otevirani oken) a js/stavovy-pruh.js. Zadny z nich odlozit nejde.
#   Novy strop nechava zase jen ~1,4 % rezervy, takze zaraz proti tichemu rustu
#   plati dal.
#   CO S TIM DAL (neudelano, je to na samostatny commit s overenim spustenim):
#   nejvetsi eager nastroj, ktery se otevira az z dlazdice, je js/cadastre-vector.js
#   (26 kB) - patri do lazy vrstvy. Po jeho presunu se strop muze vratit dolu.
LIMIT_JS_KB = 2060
LIMIT_CSS_KB = 320
LIMIT_JS_SOUBORU = 74

# Cizi knihovny neumime zmensit ani odlozit (mapa je bez nich prazdna), ale maji
# byt videt v soupisu, aby bylo jasne, kolik z rozpoctu zabiraji.
LIB_PREFIX = 'js/lib/'


def read(p):
    with open(p, 'r', encoding='utf-8', errors='replace') as f:
        return f.read()


def velikost(rel):
    p = os.path.join(ROOT, rel)
    return os.path.getsize(p) if os.path.isfile(p) else 0


def zdroje():
    """Vrati (eager_js, lazy_js, eager_css) jako seznamy relativnich cest.

       Verzovaci razitko (?v=263) se odstrihne - na disku je soubor bez nej."""
    h = read(INDEX)
    # <script ...src="..."> BEZ type="ag/lazy"
    eager_js = re.findall(r'<script\b(?![^>]*type="ag/lazy")[^>]*\ssrc="([^"]+)"', h)
    lazy_js = re.findall(r'data-src="([^"]+)"', h)
    css = re.findall(r'<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"', h)
    css += re.findall(r'<link\b[^>]*href="([^"]+)"[^>]*rel="stylesheet"', h)

    def uklid(seznam, pripona):
        out = []
        for s in seznam:
            s = s.split('?')[0]
            if s.startswith(('http:', 'https:', '//')):
                continue          # z CDN se nic nenacita (js/fonty jsou v repu)
            if s.endswith(pripona) and s not in out:
                out.append(s)
        return out

    return uklid(eager_js, '.js'), uklid(lazy_js, '.js'), uklid(css, '.css')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='jen verdikt (pro CI)')
    args = ap.parse_args()

    eager, lazy, css = zdroje()
    js_b = sum(velikost(p) for p in eager)
    css_b = sum(velikost(p) for p in css)
    lazy_b = sum(velikost(p) for p in lazy)
    lib_b = sum(velikost(p) for p in eager if p.startswith(LIB_PREFIX))

    chyby = []
    if js_b / 1024 > LIMIT_JS_KB:
        chyby.append('EAGER JS {:.0f} kB > strop {} kB'.format(js_b / 1024, LIMIT_JS_KB))
    if css_b / 1024 > LIMIT_CSS_KB:
        chyby.append('EAGER CSS {:.0f} kB > strop {} kB'.format(css_b / 1024, LIMIT_CSS_KB))
    if len(eager) > LIMIT_JS_SOUBORU:
        chyby.append('EAGER JS {} souboru > strop {}'.format(len(eager), LIMIT_JS_SOUBORU))

    if not args.check or chyby:
        print('PRED PRVNIM VYKRESLENIM:')
        print('  JS  {:>6.0f} kB  v {} souborech   (strop {} kB / {} souboru)'
              .format(js_b / 1024, len(eager), LIMIT_JS_KB, LIMIT_JS_SOUBORU))
        print('      z toho cizi knihovny {:.0f} kB ({})'
              .format(lib_b / 1024, ', '.join(os.path.basename(p) for p in eager if p.startswith(LIB_PREFIX)) or '-'))
        print('  CSS {:>6.0f} kB  v {} souborech   (strop {} kB)'
              .format(css_b / 1024, len(css), LIMIT_CSS_KB))
        print('  odlozeno (ag/lazy): {:.0f} kB v {} souborech'.format(lazy_b / 1024, len(lazy)))

    if chyby:
        print('\nCHYBA - rozpocet startu prekrocen:')
        for c in chyby:
            print('  * ' + c)
        vlastni = [(velikost(p), p) for p in eager if not p.startswith(LIB_PREFIX)]
        vlastni.sort(reverse=True)
        print('\nNEJVETSI VLASTNI EAGER MODULY (kandidati na odlozeni):')
        for v, p in vlastni[:12]:
            print('  {:>7.1f} kB  {}'.format(v / 1024, p))
        print('\nCO S TIM:')
        print('  1) Nastroj, ktery se otevira az z dlazdice, patri do lazy vrstvy:')
        print('       <script type="ag/lazy" data-src="js/neco.js"></script>')
        print('     Kandidaty najde: python scripts/check_lazy.py')
        print('     Presun je nutne OVERIT SPUSTENIM appky (npm run test:smoke).')
        print('  2) EAGER musi zustat: jadro, uvodni obrazovka, cokoli v renderovaci')
        print('     smycce a moduly, ktere obaluji cizi funkci (viz hlavicka lazy-load.js).')
        print('  3) Kdyz rust opravdu patri do startu, zvedni strop v tomto souboru')
        print('     a duvod napis do jeho hlavicky. Vedome ano, tise ne.')
        return 1

    if not args.check:
        print('\nOK - rozpocet startu drzi.')
    else:
        print('OK - rozpocet startu drzi ({:.0f} kB JS / {:.0f} kB CSS).'.format(js_b / 1024, css_b / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
