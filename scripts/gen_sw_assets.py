#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_sw_assets.py — generator seznamu ASSETS_TO_CACHE v sw.js + sprava verze cache.

Cte index.html (lokalni <script src>, <link rel="stylesheet">, manifest, ikony)
a manifest.json (ikony) a z nich sestavi seznam ASSETS_TO_CACHE. Ten NAHRADI
v sw.js mezi markery:

    // >>> GENEROVANO scripts/gen_sw_assets.py — needitovat rucne
    ...
    // <<< KONEC GENEROVANEHO SEZNAMU

Verze: zdroj pravdy je SHELL_CACHE v sw.js ('argeodet-shell-vNNN'). Skript
propisuje ?v=NNN k css/style.css v ASSETS i v index.html <link>.

Pouziti:
    python scripts/gen_sw_assets.py            # prepise sw.js (+ index.html ?v=)
    python scripts/gen_sw_assets.py --bump     # zvedne NNN o 1 a propise vsude
    python scripts/gen_sw_assets.py --check    # nic nezapisuje, jen validuje
                                               # (exit 1 pri nesouladu)

Bez zavislosti mimo stdlib (na vyvojarskem stroji neni Node, jen Python).
Zapisuje UTF-8 bez BOM a zachovava puvodni konce radku (CRLF/LF).
"""

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SW_PATH = ROOT / 'sw.js'
INDEX_PATH = ROOT / 'index.html'
MANIFEST_PATH = ROOT / 'manifest.json'

MARKER_BEGIN = '// >>> GENEROVANO scripts/gen_sw_assets.py — needitovat rucne'
MARKER_END = '// <<< KONEC GENEROVANEHO SEZNAMU'

# ---------------------------------------------------------------------------
# EXTRA: polozky, ktere NEJDOU odvodit z index.html / manifest.json.
# Sem patri i externi CDN URL a soubory nacitane az za behu (fetch/lazy load).
# ---------------------------------------------------------------------------
EXTRA_ASSETS = [
    './data/zpravodaj.json',       # cte js/zpravodaj.js pres fetch
    './data/predpisy.json',        # cte js/predpisy.js pres fetch
    './data/co-je-noveho.json',    # cte js/co-je-noveho.js pres fetch (s razitkem ?t=)
    './data/jazyky.json',          # cte js/jazyky.js pres fetch (jen kdyz nekdo prepne jazyk;
                                   #   v predcache byt MUSI, jinak cizojazycna appka
                                   #   po prvnim spusteni offline spadne zpatky do cestiny)
    './data/navody.json',
    # STYLOPISY ODLOZENYCH NASTROJU: v index.html uz nejsou (blokovaly by
    #   prvni vykresleni), pripojuje si je modul sam pres AG.cssFile().
    './css/bodove-pole.css',
    './css/dvoji-mereni.css',
    './css/balicek-zakazky.css',
    './css/duvera.css',                   # js/duvera.js — jednotny vzhled "jak moc verit cislu"
    './css/rocenka.css',                  # js/rocenka.js + js/odznaky.js          # tela navodu pod "?" — cte js/tools-registry.js pres fetch
    './js/lib/qrcode.min.js',      # line (lazy) nacitani QR generatoru
    './js/lib/jsqr.min.js',        # line (lazy) nacitani QR ctecky
    # PISMA + OBRAZKY LEAFLETU: v index.html nejsou, odkazuji na ne az CSS soubory
    # (css/fonts.css, js/lib/leaflet-1.9.4.css). Bez nich by appka offline nabehla
    # v systemovem pisme. Driv se oboje tahalo z CDN a v predcache to vubec nebylo.
    './fonts/inter-var-latin.woff2',
    './fonts/inter-var-latin-ext.woff2',
    './fonts/jetbrains-mono-var-latin.woff2',
    './fonts/jetbrains-mono-var-latin-ext.woff2',
    './fonts/sora-var-latin.woff2',
    './fonts/sora-var-latin-ext.woff2',
    './js/lib/images/layers.png',
    './js/lib/images/layers-2x.png',
    './js/lib/images/marker-icon.png',
    # NASTROJE S DELENYM NACITANIM (js/lazy-tools.js) — uz nejsou v index.html,
    # ale MUSI zustat v predcache, jinak je v terenu bez signalu nejde otevrit.
    './js/pocasi.js',
    './js/zapisnik.js',
    './js/dgps.js',
    './js/vrstvy.js',
    './js/kontrola-vrstvy.js',
    './js/denik-dne.js',
    './js/kniha-jizd.js',
    './js/postupy.js',
    './js/gnss-forecast.js',
    './js/korekce.js',
    './js/checklist.js',
]

# VLASTNI PISMA (bod 8): nahradila render-blokujici <link> na fonts.googleapis.com.
# Nejsou v index.html primo (odkazuje na ne css/fonts.css), takze je sem musime dat rucne.
# V sw.js maji vlastni FONT_CACHE se stabilnim nazvem — pri bumpu verze se nestahuji znovu.
#
# POZOR na dva zpusoby self-hostingu: dve soubezne vetve nasadily pisma kazda
# jinak a merge z toho udelal zmet (css/fonts.css skoncil jako uriznuty komentar
# a appka jela v systemovem pisme). Plati VARIABILNI varianta z ./fonts/ —
# 6 souboru / 209 kB misto 22 statickych rezu / 887 kB. Ty jsou v EXTRA_ASSETS
# vyse; sem uz nepatri, jinak by service worker stahoval 887 kB, na ktere
# css/fonts.css vubec neodkazuje.
FONT_ASSETS = [
    './css/fonts.css',
]
EXTRA_ASSETS += FONT_ASSETS

# Soubory verzovane pres ?v=NNN (musi sedet s SHELL_CACHE). Korenove styly NESMI
# prijit ze stare HTTP/CDN cache (Safari je michal a vracel cerny pruh dole),
# proto maji verzi i v adrese. tokens.css je stejne kriticky: bez promennych
# by se appka rozpadla, kdyby prisel stary soubor k novemu style.css.
# vylepseni.css prepisuje globalni pravidla (vc. oprav layoutu pro Android) —
# stara verze k novemu style.css umi rozbit fullscreen, proto se verzuje taky.
VERSIONED_CSS = ['./css/tokens.css', './css/style.css', './css/vylepseni.css']


# ---------------------------------------------------------------------------
# Pomocne I/O: zachovat kodovani (UTF-8 bez BOM) a konce radku
# ---------------------------------------------------------------------------

def read_text(path):
    """Vrati (text, eol). Text ma normalizovane '\n', eol je '\r\n' nebo '\n'."""
    raw = path.read_bytes()
    if raw.startswith(b'\xef\xbb\xbf'):
        raw = raw[3:]
    text = raw.decode('utf-8')
    eol = '\r\n' if '\r\n' in text else '\n'
    return text.replace('\r\n', '\n'), eol


def write_text(path, text, eol):
    """Zapise UTF-8 bez BOM s puvodnimi konci radku."""
    if eol != '\n':
        text = text.replace('\n', eol)
    path.write_bytes(text.encode('utf-8'))


# ---------------------------------------------------------------------------
# Parsovani index.html
# ---------------------------------------------------------------------------

class IndexParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []      # lokalni <script src>
        self.stylesheets = []  # lokalni <link rel="stylesheet">
        self.icons = []        # <link rel="icon"|"apple-touch-icon">
        self.manifest = None   # <link rel="manifest">

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'script' and a.get('src'):
            self.scripts.append(a['src'])
        # Moduly odlozene na pozdeji (js/lazy-load.js) maji type="ag/lazy" a adresu
        # v data-src, aby je prohlizec pri startu nestahoval. Do cache patri STEJNE
        # jako driv - bez nich by appka offline prisla o nastroje.
        elif tag == 'script' and a.get('data-src'):
            self.scripts.append(a['data-src'])
        elif tag == 'link':
            rel = (a.get('rel') or '').lower()
            href = a.get('href')
            if not href:
                return
            if 'stylesheet' in rel:
                self.stylesheets.append(href)
            elif rel == 'manifest':
                self.manifest = href
            elif 'icon' in rel:  # icon, apple-touch-icon
                self.icons.append(href)


def is_external(url):
    return url.startswith(('http://', 'https://', '//'))


def normalize(url):
    """Lokalni cestu prevede na styl './...' a odstrizne query string."""
    url = url.split('?')[0].split('#')[0]
    if url.startswith('./'):
        url = url[2:]
    return './' + url


def collect_assets(version):
    """Sestavi kompletni seznam ASSETS_TO_CACHE pro danou verzi NNN."""
    html_text, _ = read_text(INDEX_PATH)
    parser = IndexParser()
    parser.feed(html_text)

    manifest_icons = []
    manifest_data = json.loads(MANIFEST_PATH.read_text(encoding='utf-8-sig'))
    for icon in manifest_data.get('icons', []):
        src = icon.get('src')
        if src and not is_external(src):
            manifest_icons.append(src)

    assets = ['./', './index.html', './manifest.json']
    for group in (parser.icons, manifest_icons, parser.stylesheets, parser.scripts):
        for url in group:
            if is_external(url):
                continue  # externi drzime rucne v EXTRA_ASSETS
            assets.append(normalize(url))
    assets.extend(EXTRA_ASSETS)

    # dedup pri zachovani poradi + verzovani korenovych CSS
    seen = set()
    result = []
    for a in assets:
        key = a.split('?')[0]
        if key in seen:
            continue
        seen.add(key)
        if key in VERSIONED_CSS:
            a = '%s?v=%d' % (key, version)
        result.append(a)
    return result


# ---------------------------------------------------------------------------
# sw.js: verze + seznam
# ---------------------------------------------------------------------------

SHELL_RE = re.compile(r"(const SHELL_CACHE = 'argeodet-shell-v)(\d+)(')")


def read_shell_version(sw_text):
    m = SHELL_RE.search(sw_text)
    if not m:
        sys.exit('CHYBA: v sw.js nenalezen SHELL_CACHE (argeodet-shell-vNNN).')
    return int(m.group(2))


def render_block(assets):
    """Vygeneruje radky mezi markery (odsazeni 4 mezery jako zbytek pole)."""
    lines = ['    ' + MARKER_BEGIN,
             '    // (spust: python scripts/gen_sw_assets.py ; pri vydani --bump)']
    for a in assets:
        lines.append("    '%s'," % a)
    lines.append('    ' + MARKER_END)
    return '\n'.join(lines)


def replace_assets_block(sw_text, assets):
    """Vlozi/nahradi generovany blok v poli ASSETS_TO_CACHE."""
    block = render_block(assets)
    if MARKER_BEGIN in sw_text and MARKER_END in sw_text:
        pattern = re.compile(
            r'[ \t]*' + re.escape(MARKER_BEGIN) + r'.*?' + re.escape(MARKER_END),
            re.S)
        return pattern.sub(lambda _m: block, sw_text, count=1)
    # prvni beh: nahradit cely obsah pole ASSETS_TO_CACHE
    pattern = re.compile(r'(const ASSETS_TO_CACHE = \[\n).*?(\n\];)', re.S)
    if not pattern.search(sw_text):
        sys.exit('CHYBA: v sw.js nenalezeno pole ASSETS_TO_CACHE.')
    return pattern.sub(lambda m: m.group(1) + block + m.group(2), sw_text, count=1)


def parse_current_assets(sw_text):
    """Vytahne aktualni polozky pole ASSETS_TO_CACHE (mezi [ a ];)."""
    m = re.search(r'const ASSETS_TO_CACHE = \[(.*?)\];', sw_text, re.S)
    if not m:
        sys.exit('CHYBA: v sw.js nenalezeno pole ASSETS_TO_CACHE.')
    entries = []
    for em in re.finditer(r"'([^']+)'", m.group(1)):
        entries.append(em.group(1))
    return entries


def set_shell_version(sw_text, version):
    return SHELL_RE.sub(lambda m: m.group(1) + str(version) + m.group(3), sw_text, count=1)


# ---------------------------------------------------------------------------
# index.html: <link ... href="css/style.css?v=NNN">
# ---------------------------------------------------------------------------

def _index_css_re(asset):
    """Regex na <link href="css/<jmeno>.css[?v=N]"> pro verzovany asset."""
    name = re.escape(asset[len('./css/'):])
    return re.compile(r'(href=["\'](?:\./)?css/' + name + r')(\?v=\d+)?(["\'])')


INDEX_CSS_RES = [(a, _index_css_re(a)) for a in VERSIONED_CSS]


def set_index_css_version(html_text, version):
    for asset, rx in INDEX_CSS_RES:
        if not rx.search(html_text):
            sys.exit('CHYBA: v index.html nenalezen <link> na %s.' % asset[2:])
        html_text = rx.sub(lambda m: '%s?v=%d%s' % (m.group(1), version, m.group(3)),
                           html_text, count=1)
    return html_text


def read_index_css_version(html_text):
    """Vrati verzi jen kdyz ji VSECHNY verzovane CSS maji shodnou (jinak None)."""
    found = []
    for asset, rx in INDEX_CSS_RES:
        m = rx.search(html_text)
        if not m or not m.group(2):
            return None
        found.append(int(m.group(2)[3:]))
    return found[0] if len(set(found)) == 1 else None


# ---------------------------------------------------------------------------
# Kontroly
# ---------------------------------------------------------------------------

def check_files_exist(assets):
    """Vrati seznam lokalnich polozek, ktere neexistuji na disku."""
    missing = []
    for a in assets:
        if is_external(a) or a == './':
            continue
        rel = a.split('?')[0][2:]
        if not (ROOT / rel).is_file():
            missing.append(a)
    return missing


def run_check():
    sw_text, _ = read_text(SW_PATH)
    html_text, _ = read_text(INDEX_PATH)
    errors = []

    version = read_shell_version(sw_text)
    expected = collect_assets(version)
    current = parse_current_assets(sw_text)

    if MARKER_BEGIN not in sw_text or MARKER_END not in sw_text:
        errors.append('sw.js: chybi markery generovaneho seznamu — spust '
                      'python scripts/gen_sw_assets.py')

    # 1) seznam v sw.js == vygenerovany
    if current != expected:
        cur_set, exp_set = set(current), set(expected)
        for a in sorted(exp_set - cur_set):
            errors.append('sw.js: v ASSETS_TO_CACHE CHYBI polozka %s' % a)
        for a in sorted(cur_set - exp_set):
            errors.append('sw.js: v ASSETS_TO_CACHE polozka NAVIC %s' % a)
        if cur_set == exp_set:
            errors.append('sw.js: ASSETS_TO_CACHE ma jine poradi nez generator '
                          '— spust python scripts/gen_sw_assets.py')

    # 2) vsechny lokalni assety existuji na disku
    for a in check_files_exist(expected):
        errors.append('disk: soubor %s neexistuje (referencovan v index.html/manifest/EXTRA)' % a)

    # 3) verze se shoduji vsude: SHELL_CACHE == ?v= v sw.js i v index.html
    #    (u KAZDEHO verzovaneho CSS — tokens.css i style.css)
    for asset in VERSIONED_CSS:
        sw_css = None
        for a in current:
            if a.startswith(asset + '?v='):
                sw_css = int(a.split('?v=')[1])
        if sw_css != version:
            errors.append('verze: SHELL_CACHE=v%d, ale sw.js ma %s?v=%s' % (version, asset, sw_css))
    idx_css = read_index_css_version(html_text)
    if idx_css != version:
        errors.append('verze: SHELL_CACHE=v%d, ale index.html ma u korenovych CSS ?v=%s '
                      '(nebo se verze mezi tokens.css a style.css lisi)' % (version, idx_css))

    if errors:
        print('KONTROLA SELHALA (%d problemu):' % len(errors))
        for e in errors:
            print('  - ' + e)
        print('\nOprava: python scripts/gen_sw_assets.py  (pripadne --bump pri vydani)')
        return 1
    print('OK: sw.js ASSETS_TO_CACHE (%d polozek) i verze v%d jsou konzistentni.'
          % (len(current), version))
    return 0


# ---------------------------------------------------------------------------
# Zapis
# ---------------------------------------------------------------------------

def run_write(bump):
    sw_text, sw_eol = read_text(SW_PATH)
    html_text, html_eol = read_text(INDEX_PATH)

    version = read_shell_version(sw_text)
    if bump:
        version += 1
        sw_text = set_shell_version(sw_text, version)
        print('Verze zvednuta na v%d (SHELL_CACHE).' % version)

    assets = collect_assets(version)
    missing = check_files_exist(assets)
    if missing:
        print('CHYBA: tyto referencovane soubory neexistuji na disku:')
        for a in missing:
            print('  - ' + a)
        return 1

    sw_text = replace_assets_block(sw_text, assets)
    html_text = set_index_css_version(html_text, version)

    write_text(SW_PATH, sw_text, sw_eol)
    write_text(INDEX_PATH, html_text, html_eol)
    print('Zapsano: sw.js (%d polozek, v%d) + index.html (?v=%d).'
          % (len(assets), version, version))
    return 0


def main():
    args = sys.argv[1:]
    known = {'--check', '--bump'}
    unknown = [a for a in args if a not in known]
    if unknown:
        sys.exit('Neznamy argument: %s (povolene: --check, --bump)' % ' '.join(unknown))
    if '--check' in args:
        if '--bump' in args:
            sys.exit('--check a --bump nelze kombinovat.')
        sys.exit(run_check())
    sys.exit(run_write('--bump' in args))


if __name__ == '__main__':
    main()
