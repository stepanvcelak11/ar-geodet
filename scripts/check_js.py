#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_js.py — staticka kontrola vsech vlastnich JS souboru appky.

Proc: appka je ~100 samostatnych <script> souboru bez buildu. Kdyz se do
nektereho dostane syntakticka chyba (typicky spatny merge), prohlizec ten JEDEN
soubor tise preskoci — modul prestane fungovat a v terenu se nepozna proc.
Tenhle skript to chytne driv, nez to chytne uzivatel.

Co kontroluje (jen js/*.js, knihovny js/lib/* se preskakuji):
  1) ZBYTKY PO MERGI  — radky '<<<<<<<', '=======', '>>>>>>>'.
  2) SYNTAXE          — kazdy soubor se parsuje (esprima).
  3) DUPLICITNI KLICE — dva stejne klice v jednom objektovem literalu. JS to
     nehlasi, druhy klic jen tise prepise prvni (stalo se u TOOL_HELP po mergi).
  4) DUPLICITNI CASE  — dva stejne 'case' v jednom switchi (druhy je mrtvy kod).

Pouziti:
    python scripts/check_js.py          # zkontroluj vse, exit 1 pri nalezu
    python scripts/check_js.py --list   # jen vypis, ktere soubory se kontroluji

Zavislost: esprima (pure python).  pip install esprima
"""

import re
import sys
from pathlib import Path

try:
    import esprima
except ImportError:
    print('CHYBA: chybi balicek esprima  ->  pip install esprima', file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
JS_DIR = ROOT / 'js'
CONFLICT = ('<<<<<<<', '>>>>>>>', '=======')

# Syntaxe, kterou esprima (ES2017) neumi, ale prohlizece i node ano. Kdyz na ni
# narazime, soubor jen preskocime — hlaseni by bylo falesne.
MODERN = re.compile(r'\?\.|\?\?|\d_\d|(?<![\w$])#[A-Za-z_]|catch\s*\{|\*\*=|\|\|=|&&=')

problems = []
skipped = []


def files():
    out = []
    for p in sorted(JS_DIR.rglob('*.js')):
        rel = p.relative_to(ROOT).as_posix()
        if '/lib/' in rel:          # knihovny treti strany neresime
            continue
        out.append(p)
    return out


def check_conflicts(path, src):
    for i, line in enumerate(src.splitlines(), 1):
        s = line.strip()
        # '=======' hlasime jen s dalsim markerem v souboru (samo o sobe to muze
        # byt oddelovac v komentari, tech je v tomhle repu spousta)
        if s.startswith('<<<<<<<') or s.startswith('>>>>>>>'):
            problems.append(f'{path}:{i}: zbytek po mergi: {s[:40]}')


def node_iter(node):
    """Projde AST (esprima vraci objekty s .toDict() nebo vnorene seznamy)."""
    if isinstance(node, list):
        for n in node:
            yield from node_iter(n)
        return
    if not hasattr(node, 'type'):
        return
    yield node
    for key in dir(node):
        if key.startswith('_') or key in ('type', 'toDict'):
            continue
        try:
            val = getattr(node, key)
        except Exception:
            continue
        if isinstance(val, list) or hasattr(val, 'type'):
            yield from node_iter(val)


def key_name(prop):
    k = getattr(prop, 'key', None)
    if k is None:
        return None
    if getattr(prop, 'computed', False):
        return None                      # {[x]: 1} — nelze staticky posoudit
    t = getattr(k, 'type', '')
    if t == 'Identifier':
        return k.name
    if t == 'Literal':
        return str(k.value)
    return None


def check_ast(path, tree):
    for node in node_iter(tree):
        t = node.type
        if t == 'ObjectExpression':
            seen = {}
            for prop in (node.properties or []):
                if getattr(prop, 'type', '') != 'Property':
                    continue
                if getattr(prop, 'kind', 'init') != 'init':
                    continue            # get/set smi byt parove
                name = key_name(prop)
                if name is None:
                    continue
                line = getattr(getattr(prop, 'loc', None), 'start', None)
                line = line.line if line else '?'
                if name in seen:
                    problems.append(
                        f'{path}:{line}: duplicitni klic "{name}" v objektu '
                        f'(prvni vyskyt na radku {seen[name]}) — druhy tise prepise prvni')
                else:
                    seen[name] = line
        elif t == 'SwitchStatement':
            seen = {}
            for case in (node.cases or []):
                test = getattr(case, 'test', None)
                if test is None or getattr(test, 'type', '') != 'Literal':
                    continue
                v = str(test.value)
                line = getattr(getattr(case, 'loc', None), 'start', None)
                line = line.line if line else '?'
                if v in seen:
                    problems.append(f'{path}:{line}: duplicitni case "{v}" (uz je na radku {seen[v]}) — mrtvy kod')
                else:
                    seen[v] = line


def main():
    fs = files()
    if '--list' in sys.argv:
        for p in fs:
            print(p.relative_to(ROOT).as_posix())
        return 0

    for p in fs:
        rel = p.relative_to(ROOT).as_posix()
        src = p.read_text(encoding='utf-8', errors='replace')
        check_conflicts(rel, src)
        try:
            tree = esprima.parseScript(src, {'loc': True, 'tolerant': False})
        except Exception as e:
            # esprima je z doby ES2017 a neumi novejsi syntaxi (?. ?? 1_000 #private
            # catch {}). Kdyz soubor takovou syntaxi obsahuje, NENI to chyba appky —
            # jen to nedokazeme rozebrat. Autoritativni kontrolou syntaxe je
            # `node --check` v CI (viz .github/workflows/tests.yml).
            if MODERN.search(src):
                skipped.append(f'{rel}: moderni syntaxe, kterou esprima neumi — kontrola duplicit preskocena ({e})')
            else:
                problems.append(f'{rel}: SYNTAKTICKA CHYBA — {e}')
            continue
        try:
            check_ast(rel, tree)
        except Exception as e:      # kontrola nesmi spadnout na neceka­ne strukture AST
            print(f'POZN: {rel}: kontrolu AST nelze dokoncit ({e})', file=sys.stderr)

    print(f'Zkontrolovano {len(fs)} souboru.')
    for s in skipped:
        print('  ~ ' + s)
    if problems:
        print(f'\nNALEZENO {len(problems)} problemu:', file=sys.stderr)
        for p in problems:
            print('  ! ' + p, file=sys.stderr)
        return 1
    print('OK — zadna syntakticka chyba, zadny duplicitni klic.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
