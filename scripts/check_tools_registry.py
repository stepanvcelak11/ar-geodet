# -*- coding: utf-8 -*-
"""Hlida, ze js/tools-registry.js sedi se skutecnymi nastroji appky.

PROC EXISTUJE: kazdy nastroj se registruje sam (window.agRegisterFieldTool), ale
CO O NEM PLATI — kategorie, sloveso v seznamu ukonu, synonyma pro hledani, navod
pod "?" — bylo driv rozepsane v sesti rucnich tabulkach v peti souborech. Nic to
nekontrolovalo, takze se to opakovane nedopsalo: Kompas nebyl ve slovesech ani
v zakladni sade (uzivatel ho nenasel), DronView mel navod pod klicem openDronView
misto dronview (takze u dlazdice nebylo "?"), 19 nastroju nemelo synonyma.

Ted je vsechno v js/tools-registry.js a tenhle skript hlida, ze se registr
nerozejde s realitou. Bezi v CI (.github/workflows/release-check.yml).

Spusteni:  python scripts/check_tools_registry.py
Navratovy kod 1 = neco chybi.
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8', errors='replace').read()


# ---- 1. nastroje, ktere se v appce SKUTECNE registruji -----------------------
def registered_ids():
    """id z window.agRegisterFieldTool( ... ) napric js/*.js.

    Dva zapisy, oba se v repu pouzivaji:
        agRegisterFieldTool({ id: 'neco', ... })
        var item = { id: 'neco', ... }; agRegisterFieldTool(item);
    """
    ids = {}
    for name in sorted(os.listdir(os.path.join(ROOT, 'js'))):
        if not name.endswith('.js'):
            continue
        src = read('js/' + name)
        if 'agRegisterFieldTool' not in src:
            continue
        for m in re.finditer(r"agRegisterFieldTool\(\s*\{(.{0,400}?)\bid\s*:\s*'([^']+)'", src, re.S):
            ids[m.group(2)] = name
        # varianta s promennou: vezmi jmeno argumentu a najdi jeho deklaraci
        for m in re.finditer(r"agRegisterFieldTool\(\s*([A-Za-z_$][\w$]*)\s*\)", src):
            var = m.group(1)
            d = re.search(r"\b(?:var|let|const)\s+" + re.escape(var) +
                          r"\s*=\s*\{(.{0,400}?)\bid\s*:\s*'([^']+)'", src, re.S)
            if d:
                ids[d.group(2)] = name
    return ids


def static_tile_keys():
    """Klice statickych dlazdic z index.html (nazev oteviraci funkce z onclick)."""
    html = read('index.html')
    out = {}
    for m in re.finditer(r'class="tool-tile"[^>]*onclick="([^"]+)"', html):
        oc = m.group(1)
        fns = re.findall(r"(?:^|[;\s(])(?:window\.)?(ag[A-Za-z]\w*|open[A-Z]\w*|start[A-Z]\w*)\s*\(", oc)
        if fns:
            out[fns[-1]] = 'index.html'
    return out


# ---- 2. registr -------------------------------------------------------------
# Registr je JS, takze se musi spustit. V CI je predinstalovany Node, na
# vyvojarskem stroji Node neni, ale je py_mini_racer (V8 v Pythonu) — zkousi se
# oboje. Kdyz neni ani jedno, skript se PRESKOCI; s prepinacem --require-js
# misto toho spadne, aby CI nesvitilo zelene, aniz by cokoli overilo.
def _eval_js(expr):
    """Spusti tools-registry.js a vrati hodnotu `expr` jako JSON (nebo None)."""
    src = read('js/tools-registry.js')
    try:
        from py_mini_racer import MiniRacer
        ctx = MiniRacer()
        ctx.eval('var window = this;')
        ctx.eval(src)
        return json.loads(ctx.eval('JSON.stringify(' + expr + ')'))
    except ImportError:
        pass
    import subprocess
    import tempfile
    node = None
    for cand in ('node', 'node.exe'):
        try:
            subprocess.check_output([cand, '--version'], stderr=subprocess.STDOUT)
            node = cand
            break
        except Exception:
            continue
    if not node:
        return None
    fd, path = tempfile.mkstemp(suffix='.js')
    os.close(fd)
    try:
        io.open(path, 'w', encoding='utf-8').write(
            u'var window = globalThis;\n' + src +
            u'\nprocess.stdout.write(JSON.stringify(' + expr + '));\n')
        out = subprocess.check_output([node, path])
        return json.loads(out.decode('utf-8'))
    finally:
        os.unlink(path)


def load_registry():
    recs = _eval_js('window.AGReg.all()')
    if recs is None:
        if '--require-js' in sys.argv:
            print('CHYBA: neni Node ani py_mini_racer, registr nejde spustit '
                  '(a bezi se s --require-js)')
            sys.exit(1)
        print('PRESKOCENO: neni Node ani py_mini_racer, registr nejde spustit')
        sys.exit(0)
    return recs


# ---- 1b. moduly, ktere appka vubec NENACITA ---------------------------------
def orphan_modules():
    """js/*.js, ktere registruji nastroj, ale nikdo je nenacita.

    PROC: registered_ids() cte soubory NA DISKU, ne to, co appka opravdu spusti.
    Osirely modul tedy prosel jako platny nastroj — a registr k nemu klidne mel
    dlazdici, navod i sloveso, jen se v appce nikdy neobjevil. Presne to se stalo
    js/geo-overlay.js: 487 radku a zaznam v registru, ale zadny <script> v
    index.html, takze nastroj "Podlozit plan do mapy" fakticky neexistoval.

    Nacteni muze byt trojí: bezny <script src>, lazy <script type="ag/lazy"
    data-src> nebo MANIFEST v js/lazy-tools.js (ten stahuje az na klepnuti).
    """
    html = read('index.html')
    lazy = read('js/lazy-tools.js')
    out = {}
    jsdir = os.path.join(ROOT, 'js')
    for fn in sorted(os.listdir(jsdir)):
        if not fn.endswith('.js'):
            continue
        src = read('js/' + fn)
        if 'agRegisterFieldTool' not in src:
            continue
        base = fn[:-3]
        if ('js/' + fn) in html:
            continue
        if ("'" + base + "'") in lazy or ('"' + base + '"') in lazy:
            continue
        out[fn] = True
    return out


def main():
    recs = load_registry()
    by = {r['k']: r for r in recs}

    tools = {}
    tools.update(registered_ids())
    tools.update(static_tile_keys())

    errs, warns = [], []

    # kazdy skutecny nastroj musi mit zaznam, a ten zaznam musi byt uplny
    for k in sorted(tools):
        r = by.get(k)
        if not r:
            errs.append(u'%s (%s): NENI v registru — chybi mu sloveso, synonyma i navod'
                        % (k, tools[k]))
            continue
        if not r.get('help'):
            errs.append(u'%s: nema navod (help) — u dlazdice se neukaze "?"' % k)
        if not r.get('keys'):
            errs.append(u'%s: nema synonyma (keys) — nejde najit hledanim' % k)
        if not r.get('verb') and not r.get('noverb'):
            errs.append(u'%s: nema sloveso (verb) — spadne do zachytneho "Dalsi nastroje"' % k)
        if r.get('verb') and not r.get('vl'):
            errs.append(u'%s: ma sloveso, ale chybi popisek (vl)' % k)

    # zaznam bez nastroje = zbytek po smazanem modulu; hub/notile jsou vyjimky
    for r in recs:
        k = r['k']
        if k in tools or r.get('hub') or r.get('notile'):
            continue
        warns.append(u'%s: zaznam v registru, ale zadny nastroj se tak neregistruje '
                     u'(smazany modul? preklep v klici?)' % k)

    # modul lezi v js/, registruje nastroj — ale appka ho nenacita, takze nic
    # z toho nikdy nebezi. Do teto kontroly osirely modul prosel jako platny.
    for fn in sorted(orphan_modules()):
        errs.append(u'js/%s registruje nastroj, ale NENI v index.html ani v '
                    u'MANIFESTu js/lazy-tools.js — v appce se nikdy nespusti '
                    u'(zapojit, nebo smazat i se zaznamem v registru)' % fn)

    # profily smi ukazovat jen na existujici nastroje
    profs = _eval_js('window.AGReg.profiles()') or []
    for p in profs:
        for t in p.get('tools', []):
            if t not in by:
                errs.append(u'typ prace "%s" ukazuje na %s, ktery v registru neni' % (p['id'], t))

    print(u'nastroju v appce: %d, zaznamu v registru: %d' % (len(tools), len(recs)))
    for w in warns:
        print(u'  UPOZORNENI  ' + w)
    for e in errs:
        print(u'  CHYBI       ' + e)
    if errs:
        print(u'\nNEPROSLO: %d neuplnych zaznamu. Doplnit v js/tools-registry.js.' % len(errs))
        return 1
    print(u'\nOK - registr sedi se skutecnymi nastroji.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
