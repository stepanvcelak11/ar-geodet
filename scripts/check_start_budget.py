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
#   python scripts/check_start_budget.py --dist    # tyz soupis, ale nad ZABALENOU
#                                                  # verzi (po `npm run build -- --apply`)
#
# PROC REZIM --dist: uzivatel venku nedostava zdroje z repa, ale vysledek buildu
# (.github/workflows/pages.yml). Merit rozpocet startu jen nad zdrojovym
# index.html tedy meri neco jineho, nez co si geodet stahne do telefonu. Do
# 5.9.2026 byl ten rozdil obrovsky: scripts/build.mjs bral do bundlu i moduly
# oznacene <script type="ag/lazy" data-src=...>, takze co odkladaci vrstva ve
# zdrojich usetrila, bylo v zabalene verzi zpatky — a spustilo se to VSECHNO
# pred prvnim obrazem. Od te doby bundle obsahuje jen eager moduly a odlozene
# radky zustavaji v index.html, takze --dist meri stejnou vec jako zdroje.
# Rezim zustava: az se to nekdy zase rozejde, uvidi se to tady.
#
# STROP V REZIMU --dist je zamerne TENTYZ jako pro zdroje (LIMIT_JS_KB). Neni to
# vycucane cislo: minifikace ma ubirat, ne pridavat, takze zabaleny kod pred
# prvnim vykreslenim NESMI vazit vic nez nezabalene eager zdroje. Kdyz vazi,
# znamena to, ze se do nej pribalilo neco, co se pri startu nacitat nemelo.
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
#   CO S TIM DAL - PROVERENO 3.9.2026, CESTA PRES cadastre-vector JE SLEPA:
#   scripts/check_lazy.py nabizi jako nejvetsiho kandidata js/cadastre-vector.js
#   (26 kB, "nikdo jiny ho pri startu nezminuje"), ale ODLOZIT HO NELZE. Jeho
#   register() pri nacteni vola load() + startLive(): natahne ulozene parcely
#   a rovnou je kresli do mapy i do AR. V lazy vrstve by se hranice objevily az
#   po flushi (tedy az po prvnim tuknuti na dok/Nastroje) - uzivatel by po
#   restartu appky videl mapu bez svych parcel. Presne proto ho hlavicka
#   js/lazy-load.js jmenovite radi mezi moduly, ktere musi zustat s `defer`
#   (spolu s geo-overlay a track-log). Heuristika check_lazy.py o vkladani do
#   ciziho DOM nevi - jeji seznam kandidatu je namet, ne verdikt.
#   Kdo bude strop chtit srazit zpatky, musi hledat jinde (nebo cadastre-vector
#   rozdelit na male eager jadro, ktere kresli ulozene parcely, a lazy zbytek
#   s celym nastrojem).
#
# ZVYSENO 5.9.2026: 2060 -> 2120 kB. Duvod (VEDOME, ne tise):
#   Opravy z prohlidky 5.9. pridaly do eager modulu ~70 kB a strop uz praskl
#   (2084 kB pri prvnim mereni, 2098 kB o hodinu pozdeji — vlna oprav jeste
#   bezela). Nejvetsi polozky: js/lazy-tools.js +10,6 kB, js/grafika.js +11 kB,
#   js/logika.js +7,6 kB, js/cloud-sync.js +4,7 kB, novy js/sdilet-soubor.js
#   +3,9 kB, js/kos.js +3,2 kB, js/lazy-load.js +3,1 kB. Odlozit nejde ani jeden:
#   jsou to jadro, cloud, kos a samotna odkladaci vrstva.
#   PODSTATNE: prirustek u js/lazy-tools.js je CISTA VYHRA, i kdyz cislo tady
#   roste — 18 novych zastupnych dlazdic znamena, ze 18 nastroju (~495 kB) se
#   presunulo z fronty "stahne se vzdy 700 ms po startu" na "stahne se az na
#   klepnuti". Skutecna datova narocnost startu tedy KLESLA, jen se ta uspora
#   v tomhle merid'ku nezobrazuje: meri se eager JS, ne odlozeny.
#   Rezerva je zase mala (~1 %). Kdo bude chtit strop srazit zpatky, ma dve
#   cesty: rozdelit js/localization-helmert.js (42 kB, ale loadModel() musi
#   zustat eager — obnovuje ulozenou lokalizaci zakazky), nebo js/grafika.js.
# ZVYSENO 6.9.2026: 2120 -> 2128 kB. Duvod (VEDOME, ne tise):
#   Prace na rychlosti startu pridala ~5 kB ZDROJE (odkladaci pomocnik
#   AG.poPrvnimDoteku v js/ag-guard.js, davkove kresleni znacek v js/grafika.js
#   a jejich komentare) a strop o 3 kB praskl. Ty kilobajty ale start
#   NEZDRZUJI, naopak: merenim v prohlizeci (produkcni balicek, CPU 4x,
#   zakazka o 1000 bodech, median z 5 kol) kleslo zablokovani hlavniho vlakna
#   pri startu z 1 952 ms na 910 ms a nejdelsi souvisla uloha z 679 na 389 ms.
#   Strop hlida BAJTY, ale smysl ma CAS — a ten se zlepsil o polovinu.
#   Rezerva zustava mala (~0,2 %). Kdo bude chtit strop srazit zpatky:
#   nejblizsi kandidati na odlozeni jsou js/seznam-souradnic.js (23 kB, okno
#   se otevira z Nastroju) a js/localization-helmert.js (46 kB) — obojí
#   OVERIT SPUSTENIM, ne odhadem.
# ZVYSENO 6.9.2026 (podruhe): 2128 -> 2168 kB, 74 -> 76 souboru. Duvod:
#   Rozdeleni appky na ZAKLAD (zdarma) a PRO (placene) pridalo dva eager
#   moduly, js/licence.js (odpoved na "ma tenhle telefon Pro?") a
#   js/pro-zamky.js (zamky ve vsech pohledech naraz). ODLOZIT SE NEDA ANI
#   JEDEN, a neni to pohodlnost:
#     * licence.js musi odpovedet DRIV, nez se zacnou registrovat nastroje
#       (obal registrace se rozhoduje podle isPro()), a musi odpovedet
#       SYNCHRONNE — proto si nese vlastni SHA-256 misto crypto.subtle,
#       coz je vetsina jeho velikosti;
#     * pro-zamky.js, ktery se nacte pozde, je zamek s oknem dokoran: do
#       nez se stihne obalit registrace a odchyt kliku, jde placeny nastroj
#       normalne otevrit. Odlozeny zamek nezamyka.
#   Co to stoji: +31 kB na kritickou cestu (~1,5 %). Co to vraci: v balicku
#   ZAKLAD (scripts/build.mjs --zaklad) se z eager vrstvy VYPUSTI Pro moduly,
#   takze temto uzivatelum start naopak vyrazne zlehci — tenhle strop meri
#   zdroje, tedy vzdycky to TEZSI z obou vydani.
#   Rezerva ~0,4 %. Kdo bude chtit strop srazit: kandidati na odlozeni jsou
#   dal js/seznam-souradnic.js (23 kB) a js/localization-helmert.js (46 kB)
#   — obojí OVERIT SPUSTENIM, ne odhadem.
# ZVYSENO 6.9.2026 (potreti): 2168 -> 2192 kB. Duvod:
#   Nove prihlasovani (ucty, prostory, tarif). Host byl zrusen, takze appka
#   ted VZDYCKY zacina prihlasovaci branou — a k ni pribyla obrazovka zalozeni
#   uctu a prepinac prostoru. Vsechno je to v js/ucty.js, ktery uz eager JE
#   (drzi branu pri startu), takze zadny NOVY soubor nepribyl; +12 kB je cena
#   za to, ze se clovek bez uctu vubec ma jak dovnitr dostat.
#   ⚠ ODLOZIT SE TO NEDA. Brana stoji PRED prvnim obrazem a modul, ktery se
#     nacte pozde, ji neukaze — presne tim uz jednou zpod zamku vyjela cela
#     appka bez prihlaseni (viz pojistka v <head> index.html).
#   Rezerva ~0,5 %. Kandidati na odlozeni zustavaji tíž: js/seznam-souradnic.js
#   (23 kB) a js/localization-helmert.js (46 kB) — OVERIT SPUSTENIM, ne odhadem.
LIMIT_JS_KB = 2192
LIMIT_CSS_KB = 320
LIMIT_JS_SOUBORU = 76

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
    ap.add_argument('--dist', action='store_true',
                    help='mer ZABALENOU verzi (index.html po `npm run build -- --apply`)')
    args = ap.parse_args()

    eager, lazy, css = zdroje()

    if args.dist:
        # Zabalena verze pozna podle toho, ze v index.html visi bundle z dist/.
        # Bez teto pojistky by rezim tise meril zdroje a tvaril se, ze meri build.
        bundle = [p for p in eager if p.startswith('dist/')]
        if not bundle:
            print('CHYBA - index.html neni zabaleny (zadny <script src="dist/…">).')
            print('  Nejdriv:  npm run build -- --apply')
            return 2
        chybi = [p for p in bundle if not os.path.isfile(os.path.join(ROOT, p))]
        if chybi:
            print('CHYBA - bundle v index.html ukazuje na neexistujici soubor: %s' % ', '.join(chybi))
            return 2
        print('ZABALENA VERZE (to, co si stahne telefon):')
        print('  bundle: %s (%.0f kB)' % (bundle[0], velikost(bundle[0]) / 1024))
        if lazy:
            print('  odlozeno mimo bundle: %d modulu (data-src) — nacte je js/lazy-load.js'
                  % len(lazy))
        else:
            # Prazdny seznam po --apply znamena, ze se odlozene radky z index.html
            # ztratily (spolkla je regularka v build.mjs) — v telefonu by pak
            # nastroje bud vubec nebyly, nebo by se spustily uz pri startu.
            print('CHYBA - v zabalene verzi NEZUSTAL zadny odlozeny modul (data-src).')
            print('        Bud jsou vsechny v bundlu (= start se prodrazil), nebo se')
            print('        radky pri --apply ztratily a nastroje se nenactou vubec.')
            print('        Presne tohle se delo do 5. 9. 2026 a poznalo se to az v terenu.')
            # ⚠ TADY MUSI BYT NAVRATOVY KOD, ne jen vypis. Krok "Rozpocet startu
            # ZABALENE verze" v .github/workflows/pages.yml je BRANA — ma nasazeni
            # zastavit. Do 5. 9. 2026 tahle vetev jen tiskla a skript koncil nulou,
            # takze brana nikdy nesepnula z duvodu, kvuli kteremu vznikla. Zapsat to
            # do `chyby` nejde: ten seznam se zaklada az pod timhle blokem.
            return 2
    js_b = sum(velikost(p) for p in eager)
    css_b = sum(velikost(p) for p in css)
    lazy_b = sum(velikost(p) for p in lazy)
    lib_b = sum(velikost(p) for p in eager if p.startswith(LIB_PREFIX))

    chyby = []
    if js_b / 1024 > LIMIT_JS_KB:
        chyby.append('EAGER JS {:.0f} kB > strop {} kB'.format(js_b / 1024, LIMIT_JS_KB))
    if css_b / 1024 > LIMIT_CSS_KB:
        chyby.append('EAGER CSS {:.0f} kB > strop {} kB'.format(css_b / 1024, LIMIT_CSS_KB))
    # Pocet souboru se hlida jen u zdroju — zabalena verze ma z podstaty jeden
    # bundle plus knihovny, tam by ta cast merila nesmysl.
    if not args.dist and len(eager) > LIMIT_JS_SOUBORU:
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
        if args.dist:
            print('  0) V ZABALENE VERZI zkontroluj nejdriv, kolik modulu zustalo mimo')
            print('     bundle (radek "odlozeno mimo bundle" vyse). Kdyz je jich 0,')
            print('     spadly do bundlu moduly s data-src a pred prvnim vykreslenim')
            print('     se spusti VSECHNO — i kdyz zdroje strop drzi.')
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
