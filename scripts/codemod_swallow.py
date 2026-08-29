#!/usr/bin/env python3
# ===== AR Geodet — PREVODNIK PRAZDNYCH catch (e) {} NA AG.swallow ==============
# PROC: v js/ bylo pres 1500 prazdnych catchu. Jsou tam spravne — appka v terenu
# nesmi spadnout kvuli tomu, ze telefon odmitl localStorage nebo ze chybi jeden
# modul. Jenze tim se ztratila i informace, ZE se neco stalo. Kdyz prijde
# z terenu reklamace, neni se ceho chytit.
#
# CO DELA: prazdny blok catchu naplni jednim volanim
#     catch (e) {}   ->   catch (e) { AG.swallow(e, 'soubor:funkce'); }
# Chyba se dal SPOLKNE (nic se nevyhodi, uzivatel nic nevidi), ale zapise se do
# Protokolu chyb. Popis mista se odvodi z nazvu nejblizsi funkce nad radkem,
# takze zaznam rovnou rekne, kde to prasklo.
#
# CO NEDELA:
#   * nesaha na catch, ktery uz neco dela (i kdyby to byl jen komentar),
#   * nesaha na js/ag-guard.js (definuje AG.swallow — kruh),
#   * nesaha na js/lib/* (cizi knihovny),
#   * nesaha na soubory vyjmenovane v --skip (rozdelana prace jine session).
#
# Je IDEMPOTENTNI: druhy beh uz nic nezmeni.
#
# Pouziti:
#     python scripts/codemod_swallow.py --dry-run          # jen ukaze pocty
#     python scripts/codemod_swallow.py                    # zapise
#     python scripts/codemod_swallow.py --skip a.js,b.js   # vynecha soubory
# ==============================================================================
import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(ROOT, 'js')

# Soubory, ktere se nikdy neprevadeji.
NEVER = {'ag-guard.js'}

# prazdny catch: catch (cokoliv) { bile znaky }
EMPTY_CATCH = re.compile(r'catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*\}')

# nazev funkce pro popis mista
FN_PATTERNS = [
    re.compile(r'function\s+([A-Za-z_$][\w$]*)\s*\('),
    re.compile(r'([A-Za-z_$][\w$]*)\s*[:=]\s*function\s*\('),
    re.compile(r'([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>'),
]


try:
    import esprima
except ImportError:
    esprima = None


def parsuje(text):
    """True = kod je syntakticky v poradku. Bez esprimy se kontrola preskoci
       (vraci True), pak ji zastane az CI (scripts/check_js.py --require-node)."""
    if esprima is None:
        return True
    try:
        esprima.parseScript(text)
        return True
    except Exception:
        return False


def read(path):
    with open(path, 'r', encoding='utf-8', newline='') as f:
        return f.read()


def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def nearest_function(text, pos):
    """nazev nejblizsi funkce zacinajici PRED pozici pos"""
    best, best_at = None, -1
    okno = text[:pos]
    # staci projit poslednich ~4000 znaku, dal uz je nazev stejne k nicemu
    start = max(0, len(okno) - 4000)
    for pat in FN_PATTERNS:
        for m in pat.finditer(okno, start):
            if m.start() > best_at:
                best_at, best = m.start(), m.group(1)
    return best


def je_v_komentari(text, pos):
    """Radkovy komentar pred pozici na temze radku, nebo blokovy komentar kolem.
       V komentarich se `catch (e) {}` cituje jako priklad — prepsat ho by
       neublizilo, ale zaznam by lhal a diff by byl zbytecne velky."""
    zac = text.rfind('\n', 0, pos) + 1
    radek = text[zac:pos]
    if '//' in radek:
        return True
    otevreno = text.rfind('/*', 0, pos)
    if otevreno != -1 and text.rfind('*/', 0, pos) < otevreno:
        return True
    return False


def convert(path, rel):
    text = read(path)
    modul = os.path.splitext(os.path.basename(rel))[0]
    pocet = [0]

    def repl(m):
        if je_v_komentari(text, m.start()):
            return m.group(0)
        var = m.group(1)
        fn = nearest_function(text, m.start())
        kde = modul + (':' + fn if fn else '')
        pocet[0] += 1
        # `window.AG &&` a `AG.swallow &&` NENI zbytecne: ag-guard.js je
        # odpojitelna vrstva. Kdyby chybel, holé `AG.swallow(...)` by uvnitr
        # catch bloku vyhodilo TypeError — a tim by prazdny catch, ktery mel
        # appku uchranit od padu, sam appku shodil. Presne naopak, nez ma byt.
        return ("catch (%s) { window.AG && AG.swallow && AG.swallow(%s, '%s'); }"
                % (var, var, kde))

    novy = EMPTY_CATCH.sub(repl, text)
    return novy, pocet[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='jen spocitat, nezapisovat')
    ap.add_argument('--skip', default='', help='soubory k vynechani, oddelene carkou')
    args = ap.parse_args()

    skip = NEVER | {s.strip() for s in args.skip.split(',') if s.strip()}

    celkem, souboru = 0, 0
    preskoceno = []
    nerozparsovano = []
    for name in sorted(os.listdir(JS_DIR)):
        if not name.endswith('.js'):
            continue
        if name in skip:
            path = os.path.join(JS_DIR, name)
            n = len(EMPTY_CATCH.findall(read(path)))
            if n:
                preskoceno.append((name, n))
            continue
        path = os.path.join(JS_DIR, name)
        puvodni = read(path)
        novy, n = convert(path, name)
        if not n:
            continue
        # POJISTKA: prevod se zapise, jen kdyz vysledek PORAD parsuje. Bez toho
        # by jedna spatne trefena zavorka tise rozbila modul a projevila se az
        # v terenu.
        if parsuje(puvodni) and not parsuje(novy):
            nerozparsovano.append(name)
            print('  PRESKOCENO (vysledek by neparsoval): {}'.format(name))
            continue
        celkem += n
        souboru += 1
        print('  {:>4}x  {}'.format(n, name))
        if not args.dry_run:
            write(path, novy)

    print('\n{} prazdnych catchu v {} souborech{}.'.format(
        celkem, souboru, ' (jen nahled, nic se nezapsalo)' if args.dry_run else ' PREVEDENO'))
    if nerozparsovano:
        print('\nCHYBA — tyhle soubory by prevod rozbil, zustaly beze zmeny:')
        for name in nerozparsovano:
            print('  ' + name)
        return 1
    if preskoceno:
        print('\nVYNECHANO (--skip) — zbyva prevest az bude soubor volny:')
        for name, n in preskoceno:
            print('  {:>4}x  {}'.format(n, name))
    return 0


if __name__ == '__main__':
    sys.exit(main())
