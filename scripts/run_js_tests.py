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
#
# 'zaloha' = ma modul jeste vlastni proj4 zalohu pro pripad, ze geo-core.js chybi?
#   True  -> obe cesty musi dat TOTEZ (pujde-li nekdo premapovat klice spatne, rozejdou se).
#   False -> modul zalohu ZAMERNE nema a bez GeoCore vraci null. Duvod (5. 9. 2026):
#            zaloha mela poradi os zadratovane natvrdo, a poradi os je prave to jedine,
#            co GeoCore hlida (_resolveAxis) — pri zmene proj4 by tise prohodila Y a X.
#            V geodeticke appce je "souradnici neznam" lepsi nez "souradnice vedle".
#            Test proto u techhle modulu tvrdi OPAK: cesta bez GeoCore MUSI vratit null.
#   ⚠ Kdo zalohu z modulu odstrani, MUSI tady prehodit True na False — jinak se test
#     zastavi na tom, ze "jedna z cest vratila null", a nerekne, ze to byl zamer.
DELEGATING = [
    ('js/check-distance.js',       'obj', 'Y', 'X',  1, False),
    ('js/dmt-volume.js',           'obj', 'Y', 'X',  1, True),
    ('js/localization-helmert.js', 'obj', 'Y', 'X',  1, True),
    ('js/pdf-protocol.js',         'obj', 'y', 'x',  1, True),
    ('js/zavady.js',               'obj', 'y', 'x',  1, False),
    ('js/dxf-export.js',           'obj', 'y', 'x', -1, True),
    ('js/vylepseni.js',            'arr',   0,   1, -1, True),
    ('js/geo-foto.js',             'obj', 'y', 'x',  1, False),
    ('js/vysilacka.js',            'obj', 'y', 'x',  1, False),
    ('js/indoor.js',               'obj', 'y', 'x',  1, False),
    ('js/obchuzka.js',             'obj', 'y', 'x',  1, False),
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
    """Overi, ze kazdy modul bere S-JTSK z GeoCore — a ze jeho druha cesta dela, co ma.

    Tohle je pojistka na refaktor „jedno geodeticke jadro": kdyz nekdo premapuje klice
    spatne (napr. {Y:s.x}) nebo zapomene znamenko u DXF, cisla se rozejdou a tady to
    spadne. Bez toho by se to poznalo az na vykresu u zakaznika.

    Moduly se ZALOHOU: obe cesty musi dat totez.
    Moduly BEZ zalohy (viz sloupec 'zaloha' v DELEGATING): cesta bez GeoCore musi
    vratit null. Kdyby tam nekdo zalohu vratil, vrati misto null cislo — a prave to
    tenhle test zachyti, protoze zaloha ma poradi os zadratovane a GeoCore ho hlida.
    """
    from py_mini_racer import MiniRacer
    results = []
    PTS = [(50.0875, 14.4213), (49.1951, 16.6068), (48.7589, 16.8820), (50.1109, 8.6821)]

    for rel, kind, ky, kx, sign, zaloha in DELEGATING:
        name = ('delegace: %s vraci s GeoCore totez jako bez nej' if zaloha
                else 'delegace: %s pocita jen pres GeoCore, bez nej vraci null') % rel.replace('js/', '')
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
                if a is None:
                    raise RuntimeError('delegace na GeoCore vratila null (lat=%s lng=%s)' % (lat, lng))
                pa = (a[ky], a[kx])
                # znamenko musi odpovidat deklarovanemu zameru modulu
                if sign < 0 and pa[0] > 0:
                    raise RuntimeError('ceka se znamenkovy (negativni) Krovak, doslo %+.1f' % pa[0])
                if sign > 0 and pa[0] < 0:
                    raise RuntimeError('ceka se kladny Krovak, doslo %+.1f' % pa[0])
                if not zaloha:
                    # Modul zalohu zamerne nema: bez GeoCore nesmi vzniknout ZADNE cislo.
                    if b is not None:
                        raise RuntimeError('bez GeoCore vratil %r misto null — vratila se sem '
                                           'proj4 zaloha se zadratovanym poradim os? '
                                           '(lat=%s lng=%s)' % (b, lat, lng))
                    continue
                if b is None:
                    raise RuntimeError('zaloha bez GeoCore vratila null (lat=%s lng=%s) — '
                                       'kdyz uz byla odstranena, prepis sloupec zaloha v DELEGATING '
                                       'na False' % (lat, lng))
                pb = (b[ky], b[kx])
                worst = max(worst, abs(pa[0] - pb[0]), abs(pa[1] - pb[1]))
            if worst > 1e-6:
                raise RuntimeError('delegace a fallback se rozchazi o %.6f m' % worst)
            results.append({'name': name, 'ok': True,
                            'detail': ('obe cesty shodne (max rozdil %.1e m)' % worst) if zaloha
                                      else 'delegace pocita, cesta bez GeoCore vraci null'})
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


def suite_obchuzka(read_fn):
    """Overi vypocet kubatury v js/obchuzka.js na ulohach se ZNAMYM vysledkem.

    Proc zrovna tohle: z objemu se fakturuje. Vzorec pro komoly jehlan
    (V = h/3 * (A1 + A2 + sqrt(A1*A2))) i prolozeni roviny MNC pres vysky hrany se
    daji rozbit uklidovou upravou tak, ze vysledek porad vypada rozumne — jen je
    o desitky procent vedle. Testuje se proti rucne dopocitanym hodnotam.

    Souradnicovy prevod se pro test nahrazuje trivialnim (1 stupen = 100 000 m),
    aby sla geometrie spocitat presne na papire; sam prevod hlida suite_delegace.
    """
    from py_mini_racer import MiniRacer
    results = []
    STUB = ("var window = this;"
            "var document = { readyState:'complete', getElementById:function(){return null;},"
            " createElement:function(){return { style:{}, getContext:function(){return null;},"
            " appendChild:function(){}, addEventListener:function(){},"
            " querySelector:function(){return { addEventListener:function(){}, style:{} };} };},"
            " addEventListener:function(){}, querySelectorAll:function(){return [];},"
            " head:{appendChild:function(){}}, documentElement:{appendChild:function(){}},"
            " body:{appendChild:function(){}} };"
            "var localStorage = { _d:{}, getItem:function(k){return this._d[k]||null;},"
            " setItem:function(k,v){this._d[k]=v;}, removeItem:function(k){} };"
            "var navigator = {};"
            "function setTimeout(){return 0;} function setInterval(){return 0;}"
            "function clearInterval(){} function clearTimeout(){}"
            "window.GeoCore = { toSJTSK: function(lat,lng){ return { y: lng*100000, x: lat*100000 }; } };"
            "window.getDistance = function(a,b,c,d){ var dy=(d-b)*100000, dx=(c-a)*100000;"
            " return Math.sqrt(dy*dy+dx*dx); };")

    def square(size, z, off=0.0):
        d = size / 100000.0
        o = off / 100000.0
        return [
            {'lat': o, 'lng': o, 'z': z, 'acc': 1.0, 'ts': 0},
            {'lat': o, 'lng': o + d, 'z': z, 'acc': 1.0, 'ts': 0},
            {'lat': o + d, 'lng': o + d, 'z': z, 'acc': 1.0, 'ts': 0},
            {'lat': o + d, 'lng': o, 'z': z, 'acc': 1.0, 'ts': 0},
        ]

    # nakloneny teren: spad 5 % ve smeru Y; teziste ctverce 10x10 lezi na Y = 5 m
    slope = square(10, 100.0)
    for q in slope:
        q['z'] = 100.0 + q['lng'] * 100000 * 0.05

    CASES = [
        ('obchuzka: komoly jehlan (svahovane steny)',
         {'top': square(10, 100.0), 'bot': square(6, 97.0, 2.0), 'depth': None},
         {'A1': 100.0, 'A2': 36.0, 'h': 3.0, 'V': 196.0, 'mode': 'frustum'}),
        ('obchuzka: svisle steny z rucne zadane hloubky',
         {'top': square(10, 100.0), 'bot': [], 'depth': 2.5},
         {'A1': 100.0, 'h': 2.5, 'V': 250.0, 'mode': 'depth'}),
        ('obchuzka: rovina MNC respektuje spad terenu',
         {'top': slope, 'bot': [{'lat': 0.5 / 100000, 'lng': 5 / 100000, 'z': 97.25, 'acc': 1.0, 'ts': 0}],
          'depth': None},
         {'zTop': 100.25, 'h': 3.0, 'V': 300.0, 'mode': 'vertical'}),
    ]
    try:
        ctx = MiniRacer()
        ctx.eval(STUB)
        ctx.eval(read_fn('js/obchuzka.js'))
    except Exception as e:
        return [{'name': 'obchuzka: vypocet kubatury', 'ok': False,
                 'detail': 'modul se nepodarilo nacist: %s: %s' % (type(e).__name__, e)}]

    for name, job, want in CASES:
        try:
            got = ctx.call('window.AGObchuzka.compute', job)
            if got is None:
                raise RuntimeError('compute() vratil null')
            bad = []
            for k, v in want.items():
                g = got.get(k)
                if isinstance(v, str):
                    if g != v:
                        bad.append('%s: %r != %r' % (k, g, v))
                elif g is None or abs(float(g) - v) > 1e-6:
                    bad.append('%s: %s misto %s' % (k, g, v))
            if bad:
                raise RuntimeError('; '.join(bad))
            results.append({'name': name, 'ok': True,
                            'detail': 'V = %.1f m3, h = %.2f m' % (got['V'], got['h'])})
        except Exception as e:
            results.append({'name': name, 'ok': False, 'detail': '%s: %s' % (type(e).__name__, e)})
    return results


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


def suite_vstupy(read_fn):
    """Cisla z formularu (agNum) a hledani bodu (agFold/agMatchQuery).

    Ceska klavesnice pise desetinnou CARKU a <input type="number"> ji na Safari
    zahodi — agNum() je jedine misto, kde se cislo z formulare parsuje, takze
    kdyz se rozbije ono, rozbije se zadavani souradnic v cele appce.
    """
    from py_mini_racer import MiniRacer
    results = []

    def t(name, fn):
        try:
            d = fn()
            results.append({'name': name, 'ok': True, 'detail': d or ''})
        except Exception as e:
            results.append({'name': name, 'ok': False, 'detail': str(e)})

    src = read_fn('js/logika.js')
    ctx = MiniRacer()
    ctx.eval('var window = this; var console = { log: function(){}, warn: function(){}, error: function(){} };')
    m = re.search(r'var _AG_DIA = \{.*?\};', src, re.S)
    if not m:
        raise RuntimeError('v js/logika.js chybi tabulka _AG_DIA')
    ctx.eval(m.group(0))
    # agFold/agMatchQuery jsou v logika.js, ale agNum bydli v js/vstupy.js
    # (odpojitelna vrstva "cisla z formularu"). Bezne v prohlizeci se nacita PRED
    # logika.js a je to JEDINE misto, kde se cislo z formulare parsuje.
    for fname in ('agFold', 'agMatchQuery'):
        ctx.eval(extract_fn(src, fname))
    vstupy = read_fn('js/vstupy.js')
    # parse() pouziva dve regexove konstanty z okoli modulu — bez nich by spadl
    # parse() pouziva dve regexove konstanty z okoli modulu - bez nich by spadl
    for rx in ('SPACES', 'MINUS'):
        mrx = re.search(r'var ' + rx + r' = /[^\n]*;', vstupy)
        if not mrx:
            raise RuntimeError('v js/vstupy.js chybi konstanta %s' % rx)
        ctx.eval(mrx.group(0))
    for fname in ('parse', 'agNum'):          # agNum stoji na pomocniku parse()
        ctx.eval(extract_fn(vstupy, fname))
    # agNum umi cist i pole podle ID; v testu zadne DOM nemame, takze ho podstrcime
    ctx.eval('var document = { getElementById: function(){ return null; } };')
    # agMatchQuery si drzi stav v promennych z okoli — doplnime je
    ctx.eval('var _agFoldCache = new WeakMap(); var _agQRaw = null; var _agQFold = "";')

    def num(expr):
        # POZOR: JSON.stringify(NaN) je "null", takze pres JSON by se NaN od null
        # nepoznalo. Ptame se proto na NaN zvlast.
        if ctx.eval('Number.isNaN(agNum(%s))' % json.dumps(expr)):
            return 'NaN'
        return json.loads(ctx.eval('JSON.stringify(agNum(%s))' % json.dumps(expr)))

    def check_num(inp, want):
        got = num(inp)
        if got != want:
            raise AssertionError('agNum(%r) = %r, cekano %r' % (inp, got, want))

    t('agNum: desetinna carka i tecka', lambda: [
        check_num('596956,46', 596956.46), check_num('596956.46', 596956.46), 'obe formy stejne'][-1])
    t('agNum: mezery v tisicich vcetne pevne (U+00A0)', lambda: [
        check_num('1 163 343,34', 1163343.34),
        check_num(u'1\u00a0163\u00a0343,34', 1163343.34), 'mezery zahozeny'][-1])
    t('agNum: unicode minus a pomlcka', lambda: [
        check_num(u'\u22120,05', -0.05), check_num('-0,05', -0.05), 'zaporne vysky projdou'][-1])
    t('agNum: prazdny a nesmyslny vstup je NaN', lambda: [
        check_num('', 'NaN'), check_num('   ', 'NaN'), check_num('abc', 'NaN'),
        # tohle je ten dulezity: parseFloat("12abc") vrati 12, u souradnice past
        check_num('12abc', 'NaN'), 'NaN (isNaN ho pozna, null by prosel)'][-1])
    t('agNum: nula neni null', lambda: [check_num('0', 0), check_num('0,00', 0), 'nula projde'][-1])

    def fold(s):
        return json.loads(ctx.eval('JSON.stringify(agFold(%s))' % json.dumps(s)))

    t('agFold: sundava diakritiku a zmensuje', lambda: [
        (_ for _ in ()).throw(AssertionError('sachta: ' + fold(u'\u0160achta')))
        if fold(u'\u0160achta') != 'sachta' else None,
        'Sachta -> sachta'][-1])

    def match(name, kod, q):
        return json.loads(ctx.eval(
            'JSON.stringify(agMatchQuery(%s, %s))'
            % (json.dumps({'name': name, 'kod': kod}), json.dumps(q))))

    def check_match(name, kod, q, want):
        got = match(name, kod, q)
        if got != want:
            raise AssertionError('agMatchQuery(%r/%r, %r) = %r, cekano %r' % (name, kod, q, got, want))

    t('agMatchQuery: prazdny dotaz projde vsechno', lambda: [
        check_match('B1', '', '', True), check_match('B1', '', None, True), 'bez filtru'][-1])
    t('agMatchQuery: hleda i v KODU bodu', lambda: [
        check_match('101', 'obruba', 'obruba', True),
        check_match('101', 'obruba', 'sachta', False), 'kod se prohledava'][-1])
    t('agMatchQuery: nezavisle na diakritice a velikosti pismen', lambda: [
        check_match(u'\u0160achta 12', '', 'sachta', True),
        check_match('sachta 12', '', u'\u0160ACHTA', True), 'sachta == Sachta'][-1])
    t('agMatchQuery: bod bez kodu nespadne', lambda: [
        check_match('B1', None, 'b1', True), 'undefined kod je v poradku'][-1])

    return results


def suite_parse_csv(read, proj_def):
    """parseCoordsCSV z js/logika.js — ctení seznamu souradnic z terenu.

    Testuje se PRAVA funkce vytazena ze zdroje (ne opsana kopie), stejne jako
    u getDistance. Krome tvaru souboru hlida hlavne past s kodem bodu:
    parseFloat('3B') vraci 3, takze kod zacinajici cislici se driv ulozil
    jako VYSKA 3 m a kod se ztratil.
    """
    from py_mini_racer import MiniRacer
    results = []

    def t(name, fn):
        try:
            results.append({'name': name, 'ok': True, 'detail': fn() or ''})
        except Exception as e:
            results.append({'name': name, 'ok': False, 'detail': str(e)})

    src = read('js/logika.js')
    ctx = MiniRacer()
    ctx.eval('var window = this; var console = { log: function(){}, warn: function(){}, error: function(){} };')
    ctx.eval(read('js/lib/proj4-2.9.0.min.js'))
    ctx.eval('proj4.defs("EPSG:5514", %s);' % json.dumps(proj_def))
    ctx.eval(read('js/geo-core.js'))
    for fname in ('sjtskToLatLng', 'parseCoordsCSV'):
        ctx.eval(extract_fn(src, fname))

    def parse(text):
        return json.loads(ctx.eval('JSON.stringify(parseCoordsCSV(%s))' % json.dumps(text)))

    REF = '1;743210,45;1043210,12'
    base = parse(REF)
    if len(base) != 1:
        raise RuntimeError('parseCoordsCSV nevratil referencni bod')
    LAT, LNG = base[0]['lat'], base[0]['lng']

    def check_xy(text, note):
        out = parse(text)
        if len(out) != 1:
            raise AssertionError('%s: ceka 1 bod, dostal %d' % (note, len(out)))
        p = out[0]
        if abs(p['lat'] - LAT) > 1e-9 or abs(p['lng'] - LNG) > 1e-9:
            raise AssertionError('%s: souradnice se lisi (%r,%r vs %r,%r)'
                                 % (note, p['lat'], p['lng'], LAT, LNG))
        return p

    t('parseCoordsCSV: oddelovac ; , tab i mezera', lambda: [
        check_xy('1;743210,45;1043210,12', 'strednik'),
        check_xy('1\t743210,45\t1043210,12', 'tabulator'),
        check_xy('1 743210,45 1043210,12', 'mezera'),
        check_xy('1,743210.45,1043210.12', 'carka'),
        'vsechny ctyri davaji tentyz bod'][-1])

    t('parseCoordsCSV: desetinna carka i tecka', lambda: [
        check_xy('1;743210,45;1043210,12', 'carka'),
        check_xy('1;743210.45;1043210.12', 'tecka'),
        'obe formy stejne'][-1])

    t('parseCoordsCSV: kladny i zaporny Krovak', lambda: [
        check_xy('1;743210,45;1043210,12', 'kladny'),
        check_xy('1;-743210,45;-1043210,12', 'zaporny'),
        'znamenko nerozhoduje'][-1])

    t('parseCoordsCSV: hlavicka, komentar a prazdne radky se preskoci', lambda: [
        check_xy('# export z Gromy\ncislo;Y;X\n\n1;743210,45;1043210,12\n', 'smeti kolem'),
        'zbyde jen datovy radek'][-1])

    def check_zk(text, vyska, kod, note):
        p = check_xy(text, note)
        if p.get('vyska') != vyska or p.get('kod') != kod:
            raise AssertionError('%s: vyska=%r kod=%r, cekano vyska=%r kod=%r'
                                 % (note, p.get('vyska'), p.get('kod'), vyska, kod))

    t('parseCoordsCSV: ctvrty sloupec je vyska Bpv', lambda: [
        check_zk('1;743210,45;1043210,12;250,15', 250.15, None, 'jen vyska'), 'Z se precte'][-1])
    t('parseCoordsCSV: textovy sloupec je kod bodu', lambda: [
        check_zk('1;743210,45;1043210,12;obruba', None, 'obruba', 'jen kod'), 'kod se precte'][-1])
    t('parseCoordsCSV: vyska i kod zaroven', lambda: [
        check_zk('1;743210,45;1043210,12;250,15;obruba', 250.15, 'obruba', 'oboji'), 'oboji'][-1])

    # REGRESE: tohle je ta chyba, kvuli ktere suite vznikla
    t('REGRESE: kod zacinajici cislici ("3B") NENI vyska', lambda: [
        check_zk('1;743210,45;1043210,12;3B', None, '3B', 'kod 3B'),
        check_zk('1;743210,45;1043210,12;2A', None, '2A', 'kod 2A'),
        check_zk('1;743210,45;1043210,12;250,15;3B', 250.15, '3B', 'vyska + kod 3B'),
        'parseFloat("3B")===3 uz neprojde jako vyska 3 m'][-1])

    t('parseCoordsCSV: neuplny radek se zahodi', lambda: [
        (_ for _ in ()).throw(AssertionError('radek se dvema sloupci prosel'))
        if len(parse('1;743210,45')) != 0 else None,
        (_ for _ in ()).throw(AssertionError('radek bez cisel prosel'))
        if len(parse('bod;abc;def')) != 0 else None,
        'nic se nevlozi'][-1])

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
        results += suite_obchuzka(read)
        results += suite_lint_argorder(read)
        results += suite_vstupy(read)
        results += suite_parse_csv(read, proj_def)
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
