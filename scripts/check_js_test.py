#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_js_test.py — sebekontrola skriptu scripts/check_js.py.

Proc: hledani duplicitnich klicu si musi samo poradit s retezci, komentari,
regexy, switch-case i navesti. Kdyby se detekce nechtene "vypnula", skript by
tise hlasil OK a nikdo by si toho nevsiml - tenhle test je pojistka.

Kazdy pripad rika, jestli SE MA ozvat (True), nebo mlcet (False).

Pouziti:  python scripts/check_js_test.py     # exit 1 pri selhani
"""

import importlib.util
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('check_js', ROOT / 'scripts' / 'check_js.py')
cj = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cj)

FAKE = ROOT / 'js' / '__test__.js'

DUP_CASES = [
    ('duplicitni klic v TOOL_HELP (realny pripad z historie repa)', True, """
        var TOOL_HELP = {
            'bezpecnost': { t: 'Bezpecnost', h: '<p>neco</p>' },
            'pocasi': { t: 'Pocasi', h: '<p>jine</p>' },
            'bezpecnost': { t: 'Prepsano', h: '<p>tise prepise prvni</p>' }
        };
    """),
    ('stejny klic ve dvou ruznych objektech', False,
     "var A = { t: 1, h: 2 };\nvar B = { t: 3, h: 4 };"),
    ('stejny klic ve vnorenem objektu', False,
     "var A = { t: 1, sub: { t: 2 } };"),
    ('dvojtecka v retezci a URL v komentari', False,
     "// https://example.com/a:b\nvar A = { u: 'http://x/y:z', v: 'a:b' };"),
    ('switch s default dvakrat (nejsou to klice)', False,
     "function f(x){ switch(x){ case 1: return 1; default: return 0; } }\n"
     "function g(x){ switch(x){ case 1: return 1; default: return 0; } }"),
    ('regularni vyraz s lomitky a dvojteckou', False,
     r"var A = { r: /a\/b:c/g, s: 'x' };"),
    ('duplicita mezi metodou a klicem', True,
     "var A = { init: function(){ return 1; }, name: 'x', init: 2 };"),
    ('duplicita v objektu uvnitr pole', True,
     "var A = [ { a: 1, b: 2 }, { a: 3, a: 4 } ];"),
    ('ternarni operator v hodnote', False,
     "var A = { a: x ? 1 : 2, b: 3 };"),
    ('objektovy literal predany jako argument', True,
     "f({ a: 1, b: 2, a: 3 });"),
    ('navesti u smycky (neni objekt)', False,
     "outer: for(var i=0;i<3;i++){ break outer; }\n"
     "outer2: for(var i=0;i<3;i++){ break outer2; }"),
    ('sablonovy retezec s dvojteckou', False,
     "var A = { a: `x:${y}`, b: 2 };"),
]

HTML_CASES = [
    ('duplicitni id', True, '<div id="a"></div><span id="b"></span><p id="a"></p>'),
    ('ruzna id', False, '<div id="a"></div><span id="b"></span>'),
    ('prvky bez id', False, '<div></div><span></span>'),
]


def main():
    fails = 0

    for name, should, src in DUP_CASES:
        cj.problems.clear()
        cj.check_dup_keys(FAKE, textwrap.dedent(src))
        got = bool(cj.problems)
        ok = got == should
        fails += 0 if ok else 1
        print('  %-6s %s -> %s' % ('OK' if ok else 'CHYBA', name,
                                   'nahlaseno' if got else 'ticho'))
        if not ok and got:
            print('         %s' % cj.problems[0][:130])

    for name, should, html in HTML_CASES:
        cj.problems.clear()
        p = cj.IndexCheck()
        p.feed(html)
        got = bool(cj.problems)
        ok = got == should
        fails += 0 if ok else 1
        print('  %-6s html: %s -> %s' % ('OK' if ok else 'CHYBA', name,
                                         'nahlaseno' if got else 'ticho'))

    # SBER INLINE <script> z index.html. Kdyby prestal fungovat, 22 kB kodu
    # (mimo jine firemni zamek) by zase tise vypadlo z kontroly syntaxe — a
    # presne kvuli takovemu tichemu vypadku tenhle sebetest existuje.
    inline_cases = [
        ('inline skript se sebere', ['var x = 1;'],
         '<script src="js/a.js"></script><script>var x = 1;</script>'),
        ('skript se src se nesbira', [],
         '<script src="js/a.js"></script>'),
        ('odlozeny modul (ag/lazy) se nesbira', [],
         '<script type="ag/lazy" data-src="js/b.js"></script>'),
        ('dva bloky = dva zaznamy', ['a();', 'b();'],
         '<script>a();</script><div></div><script>b();</script>'),
    ]
    for name, cekano, html in inline_cases:
        cj.problems.clear()
        p = cj.IndexCheck()
        p.feed(html)
        got = [src.strip() for _, src in p.inline]
        ok = got == cekano
        fails += 0 if ok else 1
        print('  %-6s inline: %s -> %s' % ('OK' if ok else 'CHYBA', name, got))

    total = len(DUP_CASES) + len(HTML_CASES) + len(inline_cases)
    if fails:
        print('\nSELHALO %d z %d testu' % (fails, total))
        return 1
    print('\nOK - vsech %d testu proslo.' % total)
    return 0


if __name__ == '__main__':
    sys.exit(main())
