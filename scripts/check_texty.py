#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_texty.py — hlášky v appce nesmí posílat uživatele do míst, která už neexistují.

Proč (18. 9. 2026 večer, T2): menu „Více" (#side-menu) je od 8. 8. 2026 schované, ale
11 hlášek v 8 souborech ho dál nabízelo jako cestu („Více → Koš", „menu Více → Uložit
pro offline", „Nastavení → Více → Napsat autorovi"…). Uživatel pak hledal menu, které
v appce není. Skript projde js/*.js a index.html a spadne, když najde takový odkaz
v ŘETĚZCI (komentáře se nepočítají — historie, proč něco vzniklo, může „Více" zmiňovat).

Kontrola je záměrně hloupá: hledá vzory z tabulky ZAKAZANE v řádcích, které nejsou
celé komentář. Když přibude další zrušený vchod, přidej ho do tabulky.

Spuštění: python scripts/check_texty.py   (0 = OK, 1 = nález)
"""
import io
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (regex, proč je to špatně / kam to má vést)
ZAKAZANE = [
    (re.compile(u'Více\\s*→'), u'menu „Více" je schované — Koš = Nástroje → Zaznamenat → Obnovit smazaný bod, Protokol chyb = Nástroje → Další nástroje, offline = Nastavení → Zakázka a data, účet = Nastavení → Účet a aplikace'),
    (re.compile(u'menu\\s+Více'), u'menu „Více" je schované (viz výše)'),
    (re.compile(u'přes\\s+„Více'), u'menu „Více" je schované — Split je tlačítko vpravo dole'),
    (re.compile(u'v\\s+menu\\s+<b>Více'), u'menu „Více" je schované'),
]
# ⚠ Pouze hlášky pro uživatele: řádek, který je celý komentář, se přeskočí; blok /* … */ také.
KOMENTAR = re.compile(r'^\s*(//|\*|/\*|<!--)')


def soubory():
    out = []
    jsd = os.path.join(ROOT, 'js')
    for n in sorted(os.listdir(jsd)):
        if n.endswith('.js') and not os.path.isdir(os.path.join(jsd, n)):
            out.append(os.path.join('js', n))
    out.append('index.html')
    return out


def main():
    nalezy = []
    for rel in soubory():
        p = os.path.join(ROOT, rel)
        try:
            radky = io.open(p, encoding='utf-8', errors='replace').read().split('\n')
        except OSError:
            continue
        v_bloku = False
        for i, r in enumerate(radky, 1):
            s = r.strip()
            if v_bloku:
                if '*/' in s:
                    v_bloku = False
                continue
            if s.startswith('/*') and '*/' not in s:
                v_bloku = True
                continue
            if s.startswith('<!--') and '-->' not in s:
                v_bloku = True
                continue
            if KOMENTAR.match(r):
                continue
            # kus řádku za // je komentář (hrubě — url:// se tu v hláškách nevyskytuje)
            kod = re.split(r'(?<!:)//', r, maxsplit=1)[0]
            for rx, proc in ZAKAZANE:
                if rx.search(kod):
                    nalezy.append((rel, i, kod.strip()[:110], proc))
                    break
    # --- TESTY PŘIBITÉ NA ČÍSLO VYDÁNÍ (19. 9. 2026, G1) ---------------------------------
    # test_v372.py chtěl `verze[0]['v'] == 372` a `'argeodet-shell-v372'` — a od v373 shazoval
    # CI pět vydání za sebou, aniž si toho kdo všiml. Test vydání smí chtít „záznam existuje"
    # a „SHELL_CACHE >= N", nikdy rovnost s aktuálním číslem.
    PRIBITE = [
        (re.compile(r"\['verze'\]\[0\]\['v'\]\s*==\s*\d+"), u"chce, aby PRVNÍ záznam Co je nového byl jeho verze — spadne s příštím vydáním; hledej záznam podle v"),
        (re.compile(r"'argeodet-shell-v\d+'\s+in\s+src"), u"chce přesné SHELL_CACHE — spadne s příštím vydáním; porovnávej >="),
    ]
    for jm in sorted(os.listdir(os.path.join(ROOT, 'scripts'))):
        if not (jm.startswith('test_') and jm.endswith('.py')):
            continue
        try:
            radky = io.open(os.path.join(ROOT, 'scripts', jm), encoding='utf-8', errors='replace').read().split('\n')
        except OSError:
            continue
        for i, r in enumerate(radky, 1):
            if KOMENTAR.match(r):
                continue
            for rx, proc in PRIBITE:
                if rx.search(r):
                    nalezy.append(('scripts/' + jm, i, r.strip()[:110], proc))
                    break
    if nalezy:
        print('CHYBA: hlášky ukazují na zrušené menu „Více" nebo test přibitý na číslo vydání (%d):' % len(nalezy))
        for rel, i, uk, proc in nalezy:
            print('  %s:%d  %s' % (rel, i, uk))
            print('      → %s' % proc)
        return 1
    print('OK - žádná hláška neposílá uživatele do zrušeného menu (kontrolováno %d souborů).' % len(soubory()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
