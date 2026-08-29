#!/usr/bin/env python3
# ===== AR Geodet — CO SE DA ODLOZIT ZA PRVNI VYKRESLENI =======================
# PROC: pri startu se PRED prvnim vykreslenim stahne a spusti ~2,4 MB JavaScriptu
# v skoro sta souborech. Vetsina z toho jsou nastroje, ktere se za cely den ani
# neotevrou — a kazdy novy nastroj zdrazoval start VSEM.
#
# Appka uz ma vrstvu js/lazy-load.js: skript zapsany jako
#     <script type="ag/lazy" data-src="js/neco.js"></script>
# se nacte az ~0,7 s PO vykresleni, v davkach po ctyrech, v poradi dokumentu.
# Modul pak bezi uplne stejne jako predtim — jen uz nebrzdi start.
#
# CO TENHLE SKRIPT DELA:
#   1) rozdeli <script> v index.html na EAGER (brzdi start) a LAZY,
#   2) u kazdeho EAGER modulu najde nazvy, ktere vystavuje do window,
#   3) spocita, kolik JINYCH EAGER modulu ty nazvy zminuje.
#      Nula = nikdo ho pri startu nepotrebuje => kandidat na odlozeni.
#
# POZOR — tohle je NAPOVEDA, ne rozhodnuti, a ZAMERNE NENI branou v CI.
# Skript cte jen nazvy, ne skutecny bezici kod, takze:
#   * necte, jestli modul pri startu kresli do mapy, hlasi odznak nebo obaluje
#     funkci appky (tema, uvodni obrazovka, fullscreen musi zustat eager),
#   * "zminka" v eager modulu jeste neznamena potrebu PRI STARTU — vetsina jich
#     je uvnitr funkci, ktere se volaji az na klepnuti uzivatele. Presne proto
#     ma js/lazy-load.js flush() na prvni dotyk listy a AGLazy.need().
# Jediny spolehlivy test presunu je SPUSTIT appku (npm run test:smoke) a overit,
# ze nabehne bez chyb a se stejnym poctem dlazdic.
#
# Pouziti:
#   python scripts/check_lazy.py            # soupis kandidatu
#   python scripts/check_lazy.py --check    # jen soupis podezrelych, bez kandidatu
# ==============================================================================
import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'index.html')

# Moduly, ktere musi zustat EAGER, i kdyz na ne nikdo nesaha. Duvod u kazdeho.
MUSI_EAGER = {
    'js/lazy-load.js': 'sam obsluhuje odlozene nacitani',
    'js/lazy-tools.js': 'zastupne dlazdice nastroju',
    'js/err-log.js': 'chyta chyby startu ostatnich modulu',
    'js/ag-guard.js': 'AG.swallow volaji moduly hned pri startu',
    'js/geo-core.js': 'geodeticke jadro + AG.esc',
    'js/idle-timers.js': 'AG.uiInterval pouzivaji moduly hned',
    'js/power-save.js': 'musi byt pred logika.js',
    'js/logika.js': 'jadro appky',
    'js/grafika.js': 'jadro appky',
    'js/tools-registry.js': 'registr cte mrizka nastroju pri prvnim otevreni',
}


def read(p):
    with open(p, 'r', encoding='utf-8', errors='replace') as f:
        return f.read()


def skripty():
    h = read(INDEX)
    eager = re.findall(r'<script\b(?![^>]*type="ag/lazy")[^>]*\ssrc="([^"?]+)"', h)
    lazy = re.findall(r'data-src="([^"?]+)"', h)
    return eager, lazy, h


# nazvy vystavene do window
EXPORT_RE = [
    re.compile(r'window\.([A-Za-z_$][\w$]*)\s*='),
    re.compile(r'^\s{0,4}function\s+([A-Za-z_$][\w$]*)\s*\(', re.M),
]


def exporty(path):
    if not os.path.isfile(path):
        return set()
    text = read(path)
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    out = set()
    for pat in EXPORT_RE:
        for m in pat.finditer(text):
            n = m.group(1)
            if len(n) > 2 and n not in ('init', 'open', 'close', 'render', 'build'):
                out.add(n)
    return out


def vlastni_api(exp_map):
    """Necha jen nazvy, ktere definuje JEDINY soubor.

       Bez tohohle je vysledek nepouzitelny: desitky modulu si OBRANNE definuji
       tehoz pomocnika (`window.agAlert = window.agAlert || …`, agNum, quickToast,
       agRegisterFieldTool). Takovy nazev pak "vystavuje" pul appky a kazdy modul
       vypada, ze ho vsichni potrebuji. Skutecne API modulu je to, co definuje
       jenom on."""
    kolik = {}
    for _, ex in exp_map.items():
        for n in ex:
            kolik[n] = kolik.get(n, 0) + 1
    return {p: {n for n in ex if kolik.get(n) == 1} for p, ex in exp_map.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='jen kontrola pro CI')
    args = ap.parse_args()

    eager, lazy, html = skripty()
    eager = [p for p in eager if p.endswith('.js')]
    texty = {p: read(os.path.join(ROOT, p)) for p in eager if os.path.isfile(os.path.join(ROOT, p))}

    # API se pocita pres VSECHNY moduly (eager i lazy) — jinak by nazev, ktery
    # definuje eager i lazy modul, vysel jako "vlastni"
    vse = list(dict.fromkeys(eager + [p for p in lazy if p.endswith('.js')]))
    exp_map = {p: exporty(os.path.join(ROOT, p)) for p in vse if os.path.isfile(os.path.join(ROOT, p))}
    API = vlastni_api(exp_map)

    def zminky(jmena, krome):
        """kolik EAGER modulu (mimo `krome`) zminuje nektery z nazvu"""
        kdo = set()
        for p, t in texty.items():
            if p == krome:
                continue
            for n in jmena:
                if re.search(r'\b' + re.escape(n) + r'\b', t):
                    kdo.add(p)
                    break
        return kdo

    # ---- tvrde pravidlo: LAZY modul nesmi nikdo potrebovat pri startu --------
    chyby = []
    for p in lazy:
        full = os.path.join(ROOT, p)
        if not os.path.isfile(full):
            continue
        text = read(full)
        api = {n for n in API.get(p, set()) if re.search(r'window\.' + re.escape(n) + r'\s*=', text)}
        if not api:
            continue
        kdo = zminky(api, p)
        # lazy-tools.js zminuje API vsech odlozenych nastroju SCHVALNE (stuby)
        kdo.discard('js/lazy-tools.js')
        if kdo:
            chyby.append((p, sorted(api)[:4], sorted(kdo)[:4]))

    if chyby:
        print('K OVERENI — odlozeny modul, jehoz API nekdo z eager modulu zminuje.')
        print('            Vetsinou je to volani UVNITR funkce (az na klepnuti), coz')
        print('            je v poradku. Problem by to bylo jen pri volani hned pri startu:')
        for p, api, kdo in chyby:
            print('  {}  (API {})  zminuji: {}'.format(p, ', '.join(api), ', '.join(kdo)))
    else:
        print('OK - zadny odlozeny modul nikdo z eager modulu nezminuje.')

    if args.check:
        return 0

    # ---- napoveda: co by slo odlozit ----------------------------------------
    velikost = lambda p: os.path.getsize(os.path.join(ROOT, p)) if os.path.isfile(os.path.join(ROOT, p)) else 0
    celkem_eager = sum(velikost(p) for p in eager)
    print('\nEAGER: {} souboru, {:.0f} kB pred prvnim vykreslenim'.format(len(eager), celkem_eager / 1024))
    print('LAZY:  {} souboru, {:.0f} kB'.format(len(lazy), sum(velikost(p) for p in lazy) / 1024))

    kandidati = []
    for p in eager:
        if p in MUSI_EAGER:
            continue
        if p.startswith('js/lib/'):
            continue          # cizi knihovny (Leaflet, proj4) — mapa je bez nich prazdna
        full = os.path.join(ROOT, p)
        if not os.path.isfile(full):
            continue
        ex = API.get(p, set())
        kdo = zminky(ex, p) if ex else set()
        if not kdo:
            kandidati.append((velikost(p), p))

    kandidati.sort(reverse=True)
    usetri = sum(v for v, _ in kandidati)
    print('\nKANDIDATI NA ODLOZENI (nikdo jiny je pri startu nezminuje) — {} souboru, {:.0f} kB:'
          .format(len(kandidati), usetri / 1024))
    for v, p in kandidati:
        print('  {:>7.1f} kB  {}'.format(v / 1024, p))
    print('\nPo presunu by EAGER klesl na {:.0f} kB. OVERIT SPUSTENIM, ne jen timhle skriptem.'
          .format((celkem_eager - usetri) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
