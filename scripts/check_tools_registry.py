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


def load_navody():
    """data/navody.json = { klic: '<html navodu>' }. None = soubor chybi/je rozbity."""
    p = os.path.join(ROOT, 'data', 'navody.json')
    if not os.path.isfile(p):
        return None
    try:
        with io.open(p, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


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

    # ---- tela navodu jsou v data/navody.json, ne v registru ----------------------
    # Registr rika, ze nastroj navod MA (help: {t}); text je v JSONu pod tymz klicem.
    # Rozdeleni ma smysl jen dokud obe strany sedi — jinak se u dlazdice ukaze "?",
    # ktere otevre prazdne okno. Proto se hlida obema smery.
    navody = load_navody()
    if navody is None:
        errs.append(u'data/navody.json chybi nebo neni platny JSON — u vsech dlazdic '
                    u'by "?" otevrelo prazdne okno')
    else:
        for r in recs:
            k = r['k']
            if not r.get('help'):
                continue
            if not (navody.get(k) or '').strip():
                errs.append(u'%s: ma help v registru, ale v data/navody.json chybi text' % k)
            elif not r['help'].get('t'):
                errs.append(u'%s: navod nema titulek (help.t)' % k)
        for k in sorted(navody):
            if k.startswith('_'):
                continue                     # '_' = poznamka v hlavicce souboru
            if k not in by:
                warns.append(u'%s: text v data/navody.json, ale zadny zaznam v registru '
                             u'(prejmenovany klic? smazany nastroj?)' % k)
            elif not by[k].get('help'):
                errs.append(u'%s: text v data/navody.json, ale registr u nej nema help '
                            u'— "?" se u dlazdice neukaze' % k)

    # ---- rozcestniky (`hub` / `inhub`) a schovane nastroje (`hidden`) -----------
    # OD 31. 8. 2026 se clenstvi v rozcestniku pise JEN sem (pole `inhub`) a ctou
    # ho DVA pohledy: mrizka dlazdic (js/tools-hub.js) i seznam ukonu
    # (js/nastroje-ukony.js). Oba podle nej nastroj ze sveho vypisu VYNECHAJI —
    # takze preklep v `inhub` (nebo rozcestnik, ktery uz neexistuje) neni kosmeticka
    # vada: nastroj zmizi z mrizky i ze seznamu a zbyde po nem prazdno.
    # A `hidden` je "at to neprekazi", ne "smazat" — jedina cesta k takovemu
    # nastroji vede pres hledani, takze BEZ `keys` by fakticky zmizel z appky.
    for r in recs:
        k = r['k']
        h = r.get('inhub')
        if h:
            cil = by.get(h)
            if not cil:
                errs.append(u'%s: inhub ukazuje na "%s", ktery v registru NENI — '
                            u'nastroj vypadne z mrizky i ze seznamu ukonu' % (k, h))
            elif not cil.get('hub'):
                errs.append(u'%s: inhub ukazuje na "%s", ale ten neni rozcestnik '
                            u'(chybi mu hub: 1) — v mrizce zadna takova dlazdice nestoji' % (k, h))
            if r.get('hub'):
                errs.append(u'%s: ma zaroven hub: 1 i inhub — rozcestnik nemuze byt '
                            u'polozkou jineho rozcestniku' % k)
        if r.get('hidden') and not (r.get('keys') or '').strip():
            errs.append(u'%s: ma hidden: 1, ale zadna synonyma (keys) — schovany nastroj '
                        u'se da otevrit uz jen hledanim, takze by z appky zmizel uplne' % k)

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
