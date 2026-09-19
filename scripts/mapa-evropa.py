#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mapa-evropa.py — vlastní vektorová mapa (PMTiles) pro CELOU EVROPU: země po zemi, velké země po DÍLECH
do 2 GB (strop assetu vydání GitHubu), rovnou nahráno do vydání „mapa-data" (worker /mapa/<soubor>).

    python scripts/mapa-evropa.py --vse              # všech 45 zemí registru (data/zeme-hranice.json), přeskočí hotové
    python scripts/mapa-evropa.py de fr              # jen vybrané
    python scripts/mapa-evropa.py de --znovu         # i když asset už existuje
    python scripts/mapa-evropa.py --stav             # co je nahrané a co chybí, nic nestahuje

CO DĚLÁ (18. 9. 2026 večer, na přání: „udělej mou vlastní mapu pro celou Evropu"):
  1. odhadne velikost souboru země (plocha obrysu × hustota OSM podle země — kalibrace: CZ 22,7 MB na
     1000 km², AT 12,6, HU 10,5, SK 16,7),
  2. když by přesáhla DIL_MAX, rozřeže obrys na svislé díly se stejnou plochou (díly = <kód>-1, <kód>-2…),
  3. každý díl vyřízne go-pmtiles z denního sestavení Protomaps (jako scripts/mapa-vyrez.py, region = obrys
     ořezaný na díl, roztažený o 1,5 %), a když přesto vyjde přes DIL_MAX, půlí ho dál (nejvýš 3×),
  4. nahraje jako asset vydání (curl, token z git credential helperu — viz mapa-nahrat-github.py) a soubor
     v %TEMP% smaže (na C: je málo místa: jeden díl naráz),
  5. do data/mapa-dily.json zapíše bboxy dílů — podle nich appka (js/mapa-vektor.js) vybere soubor podle
     polohy. Země v jednom souboru v seznamu nejsou (jméno = kód).
Běh je dlouhý (Evropa ≈ 40–50 GB stažení + nahrání, hodiny) — pouštět na pozadí, průběh je v
%TEMP%/qtrig-mapa/evropa.log. Kdykoli jde přerušit a pustit znovu: hotové díly se přeskočí.
"""
import io
import json
import math
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
vyrez = importlib.import_module('mapa-vyrez')
nahrat = importlib.import_module('mapa-nahrat-github')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIL_MAX = 1.85 * 1024 ** 3        # GitHub asset smí 2 GB; rezerva na odhad
DIL_CIL = 1.4 * 1024 ** 3         # na kolik se míří při řezání (ať díl po nepřesném odhadu nepřeteče)
# test řezání na malé zemi: QTRIG_DIL_MB=20 python scripts/mapa-evropa.py lu --znovu
if os.environ.get('QTRIG_DIL_MB'):
    DIL_CIL = float(os.environ['QTRIG_DIL_MB']) * 1024 ** 2; DIL_MAX = DIL_CIL * 1.3
# hustota dat OSM: MB na 1000 km² (kalibrace z hotových souborů CZ/AT/HU/SK; ostatní odhad podle
# hustoty osídlení a stavu OSM v zemi — na řezání to stačí, přetečení se stejně hlídá po výřezu)
HUSTOTA = {'CZ': 23, 'AT': 13, 'HU': 11, 'SK': 17, 'DE': 24, 'NL': 40, 'BE': 32, 'LU': 30, 'CH': 22, 'LI': 20,
           'PL': 15, 'FR': 14, 'GB': 18, 'IE': 10, 'IT': 16, 'ES': 9, 'PT': 10, 'DK': 18, 'SI': 16, 'HR': 10,
           'RS': 8, 'BA': 6, 'ME': 6, 'MK': 6, 'AL': 6, 'XK': 8, 'RO': 8, 'BG': 8, 'GR': 7, 'CY': 8, 'MT': 30,
           'SE': 6, 'NO': 6, 'FI': 5, 'IS': 3, 'EE': 8, 'LV': 7, 'LT': 8, 'BY': 4, 'UA': 5, 'MD': 6, 'TR': 4,
           'AD': 20, 'MC': 40, 'SM': 20}
PRESKOCIT = {'RU'}


def log(slozka, *a):
    s = time.strftime('%H:%M:%S ') + ' '.join(str(x) for x in a)
    print(s, flush=True)
    try:
        with io.open(os.path.join(slozka, 'evropa.log'), 'a', encoding='utf-8') as f:
            f.write(s + '\n')
    except Exception:
        pass


# ---- geometrie (rovinná aproximace: lon × cos(lat)) --------------------------------------
def plocha_km2(polys):
    s = 0.0
    for ring in polys:
        if len(ring) < 3:
            continue
        lat0 = sum(p[1] for p in ring) / len(ring)
        k = math.cos(math.radians(lat0))
        a = 0.0
        for i in range(len(ring)):
            x1, y1 = ring[i][0] * k, ring[i][1]
            x2, y2 = ring[(i + 1) % len(ring)][0] * k, ring[(i + 1) % len(ring)][1]
            a += x1 * y2 - x2 * y1
        s += abs(a) / 2 * 111.32 ** 2
    return s


def orez(ring, bbox):
    """Sutherland–Hodgman: kruh (seznam [lon,lat]) ořezaný na bbox [x0,y0,x1,y1]."""
    x0, y0, x1, y1 = bbox

    def clip(pts, inside, inter):
        out = []
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            ia, ib = inside(a), inside(b)
            if ia and ib:
                out.append(b)
            elif ia and not ib:
                out.append(inter(a, b))
            elif not ia and ib:
                out.append(inter(a, b)); out.append(b)
        return out

    def ix(a, b, x):
        t = (x - a[0]) / (b[0] - a[0]) if b[0] != a[0] else 0
        return [x, a[1] + (b[1] - a[1]) * t]

    def iy(a, b, y):
        t = (y - a[1]) / (b[1] - a[1]) if b[1] != a[1] else 0
        return [a[0] + (b[0] - a[0]) * t, y]
    pts = [p for p in ring]
    if pts and pts[0] == pts[-1]:
        pts = pts[:-1]
    pts = clip(pts, lambda p: p[0] >= x0, lambda a, b: ix(a, b, x0))
    if pts: pts = clip(pts, lambda p: p[0] <= x1, lambda a, b: ix(a, b, x1))
    if pts: pts = clip(pts, lambda p: p[1] >= y0, lambda a, b: iy(a, b, y0))
    if pts: pts = clip(pts, lambda p: p[1] <= y1, lambda a, b: iy(a, b, y1))
    return pts if len(pts) >= 3 else None


def orez_vse(polys, bbox):
    out = []
    for r in polys:
        c = orez(r, bbox)
        if c:
            out.append(c)
    return out


def bbox_of(polys):
    xs = [p[0] for r in polys for p in r]; ys = [p[1] for r in polys for p in r]
    return [min(xs), min(ys), max(xs), max(ys)]


def rezy_lon(polys, n):
    """Rozřeže obrys na n svislých pásů se zhruba stejnou plochou (řezy = kvantily plochy podle lon)."""
    b = bbox_of(polys)
    bins = 80
    w = (b[2] - b[0]) / bins
    pl = []
    for i in range(bins):
        pl.append(plocha_km2(orez_vse(polys, [b[0] + i * w, b[1], b[0] + (i + 1) * w, b[3]])))
    tot = sum(pl) or 1
    cuts, acc, k = [b[0]], 0.0, 1
    for i in range(bins):
        acc += pl[i]
        if k < n and acc >= tot * k / n:
            cuts.append(b[0] + (i + 1) * w); k += 1
    cuts.append(b[2])
    dily = []
    for i in range(len(cuts) - 1):
        bb = [cuts[i], b[1], cuts[i + 1], b[3]]
        c = orez_vse(polys, bb)
        if c:
            dily.append(c)
    return dily


def pulit(polys):
    b = bbox_of(polys)
    if (b[2] - b[0]) * math.cos(math.radians((b[1] + b[3]) / 2)) >= (b[3] - b[1]):
        return rezy_lon(polys, 2)
    # vodorovné půlení podle plochy
    bins, h = 60, (b[3] - b[1]) / 60
    pl = [plocha_km2(orez_vse(polys, [b[0], b[1] + i * h, b[2], b[1] + (i + 1) * h])) for i in range(bins)]
    tot, acc, cut = sum(pl) or 1, 0.0, b[1] + h * 30
    for i in range(bins):
        acc += pl[i]
        if acc >= tot / 2:
            cut = b[1] + (i + 1) * h; break
    return [d for d in (orez_vse(polys, [b[0], b[1], b[2], cut]), orez_vse(polys, [b[0], cut, b[2], b[3]])) if d]


def roztah(polys, f=1.015):
    out = []
    for ring in polys:
        cx = sum(q[0] for q in ring) / len(ring); cy = sum(q[1] for q in ring) / len(ring)
        r = [[cx + (q[0] - cx) * f, cy + (q[1] - cy) * f] for q in ring]
        if r[0] != r[-1]:
            r.append(r[0])
        out.append([r])
    return {'type': 'MultiPolygon', 'coordinates': out}


# ---- stav na GitHubu ---------------------------------------------------------------------
def assety(tok):
    rel = nahrat.api(tok, 'https://api.github.com/repos/%s/releases/tags/%s' % (nahrat.REPO, nahrat.TAG))
    if not rel.get('id'):
        sys.exit('CHYBA: vydání mapa-data neexistuje: %s' % rel.get('message'))
    return rel, dict((a['name'], a['size']) for a in rel.get('assets', []))


def nahraj(tok, rel, src, name, slozka):
    size = os.path.getsize(src)
    for a in rel.get('assets', []):
        if a['name'] == name:
            nahrat.api(tok, 'https://api.github.com/repos/%s/releases/assets/%d' % (nahrat.REPO, a['id']), 'DELETE')
    for pokus in range(3):
        r = subprocess.run(['curl', '-s', '-X', 'POST', '-H', 'Authorization: Bearer ' + tok, '-H', 'Content-Type: application/octet-stream', '-H', 'Expect:', '--max-time', '3600',
                            '--data-binary', '@' + src, 'https://uploads.github.com/repos/%s/releases/%d/assets?name=%s' % (nahrat.REPO, rel['id'], name),
                            '-w', '\n%{http_code} %{time_total}s'], capture_output=True, text=True, encoding='utf-8')
        body, _, stat = r.stdout.rpartition('\n')
        try:
            d = json.loads(body)
        except Exception:
            d = {}
        if d.get('state') == 'uploaded':
            log(slozka, 'nahráno', name, '%.2f GB' % (size / 1024 ** 3), stat)
            return True
        log(slozka, 'nahrání selhalo (%d/3):' % (pokus + 1), stat, (d.get('message') or body[:200]))
        # nedokončený asset smazat, ať se dá nahrát znovu
        rel2, ex = assety(tok)
        for a in rel2.get('assets', []):
            if a['name'] == name:
                nahrat.api(tok, 'https://api.github.com/repos/%s/releases/assets/%d' % (nahrat.REPO, a['id']), 'DELETE')
        time.sleep(30)
    return False


# ---- výřez jednoho dílu ------------------------------------------------------------------
def vyrizni(exe, src, polys, out, slozka):
    reg = out + '.region.geojson'
    json.dump(roztah(polys), open(reg, 'w', encoding='utf-8'))
    t0 = time.time()
    # 3 pokusy: Cloudflare občas zavře spojení uprostřed stahování (18. 9. BG, 19. 9. NL) a jinak by
    # se země vzdala a čekala na další celý průchod --vse
    for pokus in range(3):
        if os.path.exists(out):
            os.remove(out)
        r = subprocess.run([exe, 'extract', src, out, '--region=' + reg])
        if r.returncode == 0 and os.path.exists(out):
            break
        log(slozka, 'výřez selhal (%d/3):' % (pokus + 1), os.path.basename(out))
        time.sleep(30)
    else:
        return None
    log(slozka, 'výřez', os.path.basename(out), '%.2f GB za %.0f s' % (os.path.getsize(out) / 1024 ** 3, time.time() - t0))
    return os.path.getsize(out)


def dily_json_cesta():
    return os.path.join(ROOT, 'data', 'mapa-dily.json')


def nacti_dily():
    try:
        return json.load(io.open(dily_json_cesta(), encoding='utf-8'))
    except Exception:
        return {'_': 'Díly vektorové mapy po zemích (generuje scripts/mapa-evropa.py): kód země → seznam {f: soubor bez .pmtiles, bbox: [lon0, lat0, lon1, lat1]}. Země, která tu není, má jeden soubor <kód>.pmtiles. Čte js/mapa-vektor.js.', 'dily': {}}


def uloz_dily(d):
    # jeden díl = jeden řádek, ať je soubor k přečtení i v diffu
    radky = ['{', ' "_": ' + json.dumps(d.get('_', ''), ensure_ascii=False) + ',', ' "dily": {']
    kody = sorted(d.get('dily', {}))
    for i, k in enumerate(kody):
        radky.append('  "%s": [' % k)
        dl = d['dily'][k]
        for j, x in enumerate(dl):
            radky.append('   ' + json.dumps(x, ensure_ascii=False, separators=(', ', ': ')) + (',' if j < len(dl) - 1 else ''))
        radky.append('  ]' + (',' if i < len(kody) - 1 else ''))
    radky += [' }', '}']
    txt = chr(10).join(radky) + chr(10)
    json.loads(txt)
    io.open(dily_json_cesta(), 'w', encoding='utf-8', newline=chr(10)).write(txt)


def zeme_hotova(kod, ex, dily):
    k = kod.lower()
    if kod in dily.get('dily', {}):
        return all((x['f'] + '.pmtiles') in ex for x in dily['dily'][kod])
    return (k + '.pmtiles') in ex


def zpracuj(kod, polys, exe, src, tok, slozka, znovu):
    rel, ex = assety(tok)
    dily = nacti_dily()
    if not znovu and zeme_hotova(kod, ex, dily):
        log(slozka, kod, 'už je nahraná — přeskakuji'); return True
    km2 = plocha_km2(polys)
    odhad = km2 / 1000 * HUSTOTA.get(kod, 12) * 1024 ** 2
    n = max(1, int(math.ceil(odhad / DIL_CIL)))
    log(slozka, '==', kod, '%.0f km², odhad %.2f GB → %d díl(ů)' % (km2, odhad / 1024 ** 3, n))
    fronta = [polys] if n == 1 else rezy_lon(polys, n)
    hotove = []          # [(polys, soubor)]
    poradi = 0
    hloubka = {}
    while fronta:
        cast = fronta.pop(0)
        poradi += 1
        jm = '%s-tmp%d' % (kod.lower(), poradi)
        out = os.path.join(slozka, jm + '.pmtiles')
        size = vyrizni(exe, src, cast, out, slozka)
        if size is None:
            log(slozka, 'CHYBA výřezu', jm); return False
        if size > DIL_MAX:
            h = hloubka.get(id(cast), 0)
            if h >= 3:
                log(slozka, 'CHYBA: díl', jm, 'je přes 2 GB i po 3 půleních'); return False
            os.remove(out)
            poradi -= 1
            pul = pulit(cast)
            for p in pul:
                hloubka[id(p)] = h + 1
            fronta = pul + fronta
            log(slozka, 'díl přes limit → půlím na', len(pul))
            continue
        hotove.append((cast, jm, out))
    # pojmenování: jeden díl = <kód>.pmtiles, víc dílů = <kód>-1…
    if len(hotove) == 1:
        cast, jm, out = hotove[0]
        cil = kod.lower() + '.pmtiles'
        if os.path.basename(out) != cil:
            os.replace(out, os.path.join(slozka, cil)); out = os.path.join(slozka, cil)
        hotove = [(cast, kod.lower(), out)]
        dily.setdefault('dily', {}).pop(kod, None)
    else:
        nove = []
        for i, (cast, jm, out) in enumerate(hotove):
            cil = '%s-%d.pmtiles' % (kod.lower(), i + 1)
            if os.path.basename(out) != cil:
                os.replace(out, os.path.join(slozka, cil)); out = os.path.join(slozka, cil)
            nove.append((cast, '%s-%d' % (kod.lower(), i + 1), out))
        hotove = nove
        dily.setdefault('dily', {})[kod] = [{'f': jm, 'bbox': [round(v, 3) for v in bbox_of(cast)]} for cast, jm, out in hotove]
    rel, ex = assety(tok)
    # staré soubory té země, které v nové sadě nejsou (např. dřív jeden, teď díly) — pryč
    nova = set(jm + '.pmtiles' for _, jm, _ in hotove)
    for a in rel.get('assets', []):
        nm = a['name']
        if (nm == kod.lower() + '.pmtiles' or nm.startswith(kod.lower() + '-')) and nm not in nova:
            log(slozka, 'mažu starý asset', nm)
            nahrat.api(tok, 'https://api.github.com/repos/%s/releases/assets/%d' % (nahrat.REPO, a['id']), 'DELETE')
    for cast, jm, out in hotove:
        if not nahraj(tok, rel, out, jm + '.pmtiles', slozka):
            return False
        try:
            os.remove(out); os.remove(out + '.region.geojson')
        except Exception:
            pass
    uloz_dily(dily)
    log(slozka, kod, 'HOTOVO:', ', '.join(jm for _, jm, _ in hotove))
    return True


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    znovu = '--znovu' in sys.argv
    slozka = os.path.join(os.environ.get('TEMP', '.'), 'qtrig-mapa')
    os.makedirs(slozka, exist_ok=True)
    hran = json.load(io.open(os.path.join(ROOT, 'data', 'zeme-hranice.json'), encoding='utf-8'))
    tok = nahrat.token()
    if '--stav' in sys.argv:
        rel, ex = assety(tok); dily = nacti_dily()
        for k in sorted(hran):
            print(k, 'OK' if zeme_hotova(k, ex, dily) else 'chybí', [n for n in ex if n.startswith(k.lower() + '.') or n.startswith(k.lower() + '-')])
        return 0
    kody = sorted(hran) if '--vse' in sys.argv else [a.upper() for a in args]
    if not kody:
        print(__doc__); return 2
    # pořadí: malé země napřed (rychle vidět výsledek), velké nakonec
    kody.sort(key=lambda k: plocha_km2(hran[k]) * HUSTOTA.get(k, 12))
    exe = vyrez.pmtiles_exe(slozka)
    src = vyrez.posledni_build()
    log(slozka, 'zdroj', src, '| země:', ' '.join(kody))
    spatne = []
    for k in kody:
        if k in PRESKOCIT or k not in hran:
            continue
        try:
            if not zpracuj(k, hran[k], exe, src, tok, slozka, znovu):
                spatne.append(k)
        except Exception as e:
            log(slozka, 'CHYBA', k, repr(e)[:300]); spatne.append(k)
    log(slozka, 'KONEC; nepovedlo se:', ' '.join(spatne) or 'nic')
    return 1 if spatne else 0


if __name__ == '__main__':
    sys.exit(main())
