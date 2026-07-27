#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_js_tests.py — spusti geodeticke testy appky v opravdovem JS enginu.

PROC PYTHON: na vyvojarskem stroji neni node ani npm (viz scripts/README-build.md),
takze testy, ktere by slo spustit jen nodem, by se lokalne nikdy neovirily a padaly
by az v Actions. Tenhle runner pouziva V8 pres py_mini_racer, takze stejna sada
bezi lokalne i v CI, bez npm.

Nacte v tomhle poradi (jako index.html):
    js/lib/proj4-2.9.0.min.js
    proj4.defs("EPSG:5514", ...)     <- vytazeno PRIMO z js/logika.js, ne opsane
    js/geo-core.js
    tests/cases-geo.js
pak zavola AGGeoTests.run() a vypise vysledek.

Pouziti:
    python scripts/run_js_tests.py            # spusti testy
    python scripts/run_js_tests.py -v         # vypise i detail u proslych

Zavislost: py_mini_racer  (pip install py-mini-racer)
Exit kod: 0 vse proslo, 1 nejaky test padl, 2 nepodarilo se vubec spustit.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(rel):
    p = ROOT / rel
    if not p.exists():
        raise FileNotFoundError('chybi %s' % rel)
    return p.read_text(encoding='utf-8', errors='replace')


def extract_proj_def():
    """Vytahne radek proj4.defs("EPSG:5514", ...) z js/logika.js.

    Zamerne se NEopisuje do testu: kdyby nekdo zmenil definici v logika.js, test
    musi jet na TE NOVE — jinak by testoval neco, co appka nepouziva, a prave ten
    rozdil je to nejnebezpecnejsi, co se muze stat.
    """
    src = read('js/logika.js')
    m = re.search(r'proj4\.defs\(\s*"EPSG:5514"\s*,\s*"([^"]+)"\s*\)', src)
    if not m:
        raise RuntimeError('v js/logika.js se nenasla definice proj4.defs("EPSG:5514", ...)')
    return m.group(1)


# Moduly, ktere maji vlastni toSJTSK delegujici na GeoCore, a tvar, jaky vraci.
# 'sign' = -1 znamena, ze modul zamerne vraci ZNAMENKOVY (negativni) Krovak do DXF.
DELEGATING = [
    ('js/check-distance.js',       'obj', 'Y', 'X',  1),
    ('js/dmt-volume.js',           'obj', 'Y', 'X',  1),
    ('js/localization-helmert.js', 'obj', 'Y', 'X',  1),
    ('js/pdf-protocol.js',         'obj', 'y', 'x',  1),
    ('js/zavady.js',               'obj', 'y', 'x',  1),
    ('js/dxf-export.js',           'obj', 'y', 'x', -1),
    ('js/vylepseni.js',            'arr',   0,   1, -1),
]


def extract_fn(src, name):
    """Vytahne `function <name>(...) { ... }` vcetne vyvazeneho tela."""
    i = src.find('function %s(' % name)
    if i < 0:
        raise RuntimeError('nenasel jsem function %s(' % name)
    j = src.index('{', i)
    d = 0
    k = j
    while k < len(src):
        if src[k] == '{':
            d += 1
        elif src[k] == '}':
            d -= 1
            if d == 0:
                break
        k += 1
    return src[i:k + 1]


def suite_delegace(read_fn, proj_def):
    """Overi, ze v kazdem modulu dava DELEGACE na GeoCore totez jako jeho vlastni fallback.

    Tohle je pojistka na refaktor „jedno geodeticke jadro": kdyz nekdo premapuje klice
    spatne (napr. {Y:s.x}) nebo zapomene znamenko u DXF, cisla se rozejdou a tady to
    spadne. Bez toho by se to poznalo az na vykresu u zakaznika.
    """
    from py_mini_racer import MiniRacer
    results = []
    PTS = [(50.0875, 14.4213), (49.1951, 16.6068), (48.7589, 16.8820), (50.1109, 8.6821)]

    for rel, kind, ky, kx, sign in DELEGATING:
        name = 'delegace: %s vraci s GeoCore totez jako bez nej' % rel.replace('js/', '')
        try:
            fn = extract_fn(read_fn(rel), 'toSJTSK')
            ctx = MiniRacer()
            ctx.eval('var window = this; var console={log:function(){},warn:function(){},error:function(){}};')
            ctx.eval(read_fn('js/lib/proj4-2.9.0.min.js'))
            ctx.eval('proj4.defs("EPSG:5514", %s);' % json.dumps(proj_def))
            ctx.eval(read_fn('js/geo-core.js'))
            ctx.eval('var __mod = (function(){ %s; return toSJTSK; })();' % fn)
            worst = 0.0
            for lat, lng in PTS:
                withCore = ctx.eval('JSON.stringify(__mod(%r, %r))' % (lat, lng))
                ctx.eval('var __savedCore = window.GeoCore; window.GeoCore = undefined;')
                without = ctx.eval('JSON.stringify(__mod(%r, %r))' % (lat, lng))
                ctx.eval('window.GeoCore = __savedCore;')
                a, b = json.loads(withCore), json.loads(without)
                if a is None or b is None:
                    raise RuntimeError('jedna z cest vratila null (lat=%s lng=%s)' % (lat, lng))
                if kind == 'obj':
                    pa, pb = (a[ky], a[kx]), (b[ky], b[kx])
                else:
                    pa, pb = (a[ky], a[kx]), (b[ky], b[kx])
                worst = max(worst, abs(pa[0] - pb[0]), abs(pa[1] - pb[1]))
                # znamenko musi odpovidat deklarovanemu zameru modulu
                if sign < 0 and pa[0] > 0:
                    raise RuntimeError('ceka se znamenkovy (negativni) Krovak, doslo %+.1f' % pa[0])
                if sign > 0 and pa[0] < 0:
                    raise RuntimeError('ceka se kladny Krovak, doslo %+.1f' % pa[0])
            if worst > 1e-6:
                raise RuntimeError('delegace a fallback se rozchazi o %.6f m' % worst)
            results.append({'name': name, 'ok': True,
                            'detail': 'obe cesty shodne (max rozdil %.1e m)' % worst})
        except Exception as e:
            results.append({'name': name, 'ok': False, 'detail': '%s: %s' % (type(e).__name__, e)})
    return results


def suite_logika_getdistance(read_fn, proj_def):
    """Overi zalozni (fallback) kopii getDistance v js/logika.js.

    logika.js deleguje na GeoCore, ale drzi si vlastni kopii vzorce pro pripad, ze
    geo-core.js neni nactene. Ta kopie je RUCNE opsana, takze se od jadra muze rozejit —
    a rozejde se tise, protoze fallback se pouzije jen v konfiguraci, kterou nikdo netestuje.
    """
    from py_mini_racer import MiniRacer
    name = 'logika.js: zalozni getDistance da totez jako GeoCore'
    try:
        fn = extract_fn(read_fn('js/logika.js'), 'getDistance')
        ctx = MiniRacer()
        ctx.eval('var window = this; var console={log:function(){},warn:function(){},error:function(){}};')
        ctx.eval(read_fn('js/lib/proj4-2.9.0.min.js'))
        ctx.eval('proj4.defs("EPSG:5514", %s);' % json.dumps(proj_def))
        ctx.eval(read_fn('js/geo-core.js'))
        # GeoCore schovame, aby se uvnitr funkce pouzila prave ta zalozni cesta
        ctx.eval('var __fallback = (function(){ var GeoCore = undefined; %s; return getDistance; })();' % fn)
        worst = 0.0
        for (a, b, c, d) in [(50.0755, 14.4378, 50.0845, 14.4518),
                             (49.1951, 16.6068, 49.1960, 16.6082),
                             (48.97, 14.47, 48.9701, 14.4701),
                             (50.77, 15.05, 50.85, 15.20)]:
            fb = ctx.eval('__fallback(%r, %r, %r, %r)' % (a, b, c, d))
            core = ctx.eval('GeoCore.getDistance(%r, %r, %r, %r)' % (a, b, c, d))
            worst = max(worst, abs(fb - core))
        if worst > 1e-9:
            raise RuntimeError('zalozni kopie se od GeoCore lisi o %.9f m' % worst)
        return [{'name': name, 'ok': True, 'detail': 'shodne (max rozdil %.1e m)' % worst}]
    except Exception as e:
        return [{'name': name, 'ok': False, 'detail': '%s: %s' % (type(e).__name__, e)}]


def suite_lint_argorder(read_fn):
    """Hlida poradi parametru u toSJTSK/fromSJTSK v CELEM repu.

    Do dneska mela vylepseni.js podpis toSJTSK(lng, lat) — jediny takovy pripad v repu.
    Vysledek byl spravny, dokud si toho nikdo nevsiml; prvni „uklidova" uprava, ktera by
    to volani sjednotila, by tise prohodila souradnice. Delegacni test to nechyti (obe
    cesty jsou uvnitr te same funkce), takze je na to zvlast tenhle zdrojovy lint.
    """
    results = []
    files = sorted((ROOT / 'js').glob('*.js'))
    bad = []
    checked = 0
    call_re = re.compile(r'\btoSJTSK\s*\(')
    for p in files:
        src = p.read_text(encoding='utf-8', errors='replace')
        for m in call_re.finditer(src):
            # preskoc definice (function toSJTSK(...))
            before = src[max(0, m.start() - 20):m.start()]
            if 'function ' in before:
                continue
            # prvni argument = text do prvni carky na urovni 0
            i = m.end()
            depth = 0
            arg = []
            while i < len(src):
                c = src[i]
                if c in '([{':
                    depth += 1
                elif c in ')]}':
                    if depth == 0:
                        break
                    depth -= 1
                elif c == ',' and depth == 0:
                    break
                arg.append(c)
                i += 1
            a = ''.join(arg).strip()
            if not a:
                continue
            checked += 1
            low = a.lower()
            looks_lng = ('lng' in low or 'lon' in low)
            looks_lat = 'lat' in low
            if looks_lng and not looks_lat:
                ln = src[:m.start()].count('\n') + 1
                bad.append('%s:%d  toSJTSK(%s, ...)' % (p.name, ln, a))
    results.append({
        'name': 'lint: toSJTSK se vsude vola jako (lat, lng)',
        'ok': not bad,
        'detail': ('zkontrolovano %d volani' % checked) if not bad
                  else ('delka na prvnim miste: ' + '; '.join(bad)),
    })
    return results


def main():
    verbose = '-v' in sys.argv[1:] or '--verbose' in sys.argv[1:]
    try:
        from py_mini_racer import MiniRacer
    except ImportError:
        print('CHYBA: chybi py_mini_racer. Nainstaluj: python -m pip install py-mini-racer', file=sys.stderr)
        return 2

    try:
        proj_def = extract_proj_def()
        ctx = MiniRacer()
        # Minimalni prostredi: moduly appky pisou na window a nekdy sahnou na console.
        ctx.eval('var window = this; var console = { log: function(){}, warn: function(){}, error: function(){} };')
        ctx.eval(read('js/lib/proj4-2.9.0.min.js'))
        ctx.eval('proj4.defs("EPSG:5514", %s);' % json.dumps(proj_def))
        ctx.eval(read('js/geo-core.js'))
        ctx.eval(read('tests/cases-geo.js'))
        fixtures = read('tests/fixtures/geo-sjtsk.json')
        ctx.eval('var __fx = %s;' % fixtures)
        raw = ctx.eval('JSON.stringify(AGGeoTests.run({'
                       ' GeoCore: window.GeoCore, proj4: window.proj4, fixtures: __fx }))')
        results = json.loads(raw)
        results += suite_delegace(read, proj_def)
        results += suite_logika_getdistance(read, proj_def)
        results += suite_lint_argorder(read)
    except Exception as e:
        print('CHYBA pri spousteni testu: %s: %s' % (type(e).__name__, e), file=sys.stderr)
        return 2

    ok = [r for r in results if r['ok']]
    bad = [r for r in results if not r['ok']]

    print('GEODETICKE TESTY (V8, definice projekce vytazena z js/logika.js)')
    print('-' * 72)
    for r in results:
        mark = 'OK  ' if r['ok'] else 'CHYBA'
        line = '%-5s %s' % (mark, r['name'])
        if r['detail'] and (verbose or not r['ok']):
            line += '\n        -> %s' % r['detail']
        print(line)
    print('-' * 72)
    print('proslo %d / %d' % (len(ok), len(results)))
    if bad:
        print('\nPADLO:')
        for r in bad:
            print('  - %s\n      %s' % (r['name'], r['detail']))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
