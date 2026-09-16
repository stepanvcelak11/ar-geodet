#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_zeme_data.py — vyrobí datové soubory pro měření mimo ČR (registr zemí, 16. 9. 2026).

VÝSTUPY (commitují se, generují se jen při změně zdroje):
    data/egm2008.bin        undulace geoidu EGM2008: Evropa 5' (lat 34–72, lon −12–45)
                            + celý svět 1°, int16 v centimetrech, little-endian.
                            Hlavička = jeden řádek JSON zakončený \\n, pak bloky za sebou.
    data/zeme-hranice.json  obrysy evropských zemí (Natural Earth 50 m, zjednodušené
                            na ~1 km), klíč = ISO 3166-1 alpha-2. Slouží k určení země
                            z GPS bez signálu; u hranic se země hlídá ručně v Nastavení.
    js/wmm2025-koef.js      koeficienty World Magnetic Model 2025 (NOAA/NCEI) pro
                            deklinaci kdekoli na světě — window.AGWmmKoef.

ZDROJE (stáhnout curl -L do složky, kterou skript dostane jako 1. argument;
Python tady na síť nemůže, viz paměť env-python-ssl-curl):
    egm2008-5.tar.bz2       https://sourceforge.net/projects/geographiclib/files/geoids-distrib/egm2008-5.tar.bz2/download
    WMM2025COF.zip          https://www.ncei.noaa.gov/sites/default/files/2024-12/WMM2025COF.zip
    ne50.json               https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson

Použití:  python scripts/gen_zeme_data.py <složka se staženými zdroji>
"""
import io
import json
import math
import os
import struct
import sys
import tarfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Temp', 'claude', 'dl')

# Evropský výřez v 5' mřížce. Hranice jsou násobky 5', aby řádky/sloupce seděly na uzly.
EU = dict(lat0=72.0, lat1=34.0, lon0=-12.0, lon1=45.0, step=5.0 / 60.0)
# Země, jejichž obrysy se ukládají (Evropa + sousedé, kde má smysl rozlišovat CRS).
ZEME = ('CZ SK PL DE AT HU CH LI FR NL BE LU GB IE SI HR IT ES PT DK NO SE FI EE LV LT '
        'RO BG RS BA ME MK AL GR XK UA MD BY TR CY MT IS AD MC SM').split()


def egm():
    t = tarfile.open(os.path.join(SRC, 'egm2008-5.tar.bz2'))
    data = t.extractfile('geoids/egm2008-5.pgm').read()
    pos = 0
    toks = []
    lines = []
    while len(toks) < 4:
        nl = data.index(b'\n', pos)
        line = data[pos:nl].decode()
        pos = nl + 1
        lines.append(line)
        if line.startswith('#'):
            continue
        toks += line.split()
    W, H = int(toks[1]), int(toks[2])
    off = [float(l.split()[2]) for l in lines if l.startswith('# Offset')][0]
    sc = [float(l.split()[2]) for l in lines if l.startswith('# Scale')][0]
    raw = data[pos:pos + W * H * 2]
    # řádek 0 = lat 90, sloupec 0 = lon 0, krok 5' (W = 4320, H = 2161)
    vals = struct.unpack('>%dH' % (W * H), raw)

    def N(row, col):
        return off + sc * vals[row * W + (col % W)]

    def cm(v):
        return max(-32768, min(32767, int(round(v * 100))))

    # Evropa 5' — přímo uzly mřížky (žádná interpolace)
    rows = int(round((EU['lat0'] - EU['lat1']) / EU['step'])) + 1
    cols = int(round((EU['lon1'] - EU['lon0']) / EU['step'])) + 1
    eu = []
    for r in range(rows):
        lat = EU['lat0'] - r * EU['step']
        row = int(round((90.0 - lat) * 12))
        for c in range(cols):
            lon = EU['lon0'] + c * EU['step']
            col = int(round((lon % 360.0) * 12))
            eu.append(cm(N(row, col)))
    # Svět 1° — každý 12. uzel; sloupce 0..360 včetně (361), aby bilineár nemusel řešit přechod přes 360
    wr, wc = 181, 361
    world = []
    for r in range(wr):
        for c in range(wc):
            world.append(cm(N(r * 12, (c % 360) * 12)))
    hdr = {
        'zdroj': 'EGM2008 (NGA), 5\' mřížka z GeographicLib; jednotky cm, int16 LE',
        'eu': {'lat0': EU['lat0'], 'lon0': EU['lon0'], 'step': EU['step'], 'rows': rows, 'cols': cols},
        'svet': {'lat0': 90.0, 'lon0': 0.0, 'step': 1.0, 'rows': wr, 'cols': wc},
    }
    out = io.BytesIO()
    out.write((json.dumps(hdr, separators=(',', ':')) + '\n').encode('ascii'))
    out.write(struct.pack('<%dh' % len(eu), *eu))
    out.write(struct.pack('<%dh' % len(world), *world))
    path = os.path.join(ROOT, 'data', 'egm2008.bin')
    with open(path, 'wb') as f:
        f.write(out.getvalue())
    print('data/egm2008.bin: %d B (Evropa %dx%d, svět %dx%d)' % (len(out.getvalue()), rows, cols, wr, wc))
    # kontrolní hodnoty pro testy
    def bil(lat, lon):
        fy = (90 - lat) * 12
        fx = (lon % 360) * 12
        y0, x0 = int(fy), int(fx)
        dy, dx = fy - y0, fx - x0
        return ((N(y0, x0) * (1 - dx) + N(y0, x0 + 1) * dx) * (1 - dy)
                + (N(y0 + 1, x0) * (1 - dx) + N(y0 + 1, x0 + 1) * dx) * dy)
    for name, la, lo in (('Praha', 50.0875, 14.4213), ('Brno', 49.195, 16.608), ('Wien', 48.2, 16.37),
                         ('Berlin', 52.52, 13.4), ('Warszawa', 52.23, 21.01), ('Reykjavik', 64.13, -21.9)):
        print('   %-10s N = %.2f m' % (name, bil(la, lo)))


def wmm():
    z = zipfile.ZipFile(os.path.join(SRC, 'WMM2025COF.zip'))
    name = [n for n in z.namelist() if n.endswith('WMM.COF')][0]
    txt = z.read(name).decode()
    lines = txt.splitlines()
    epoch = float(lines[0].split()[0])
    koef = []
    for l in lines[1:]:
        p = l.split()
        if len(p) < 6 or p[0].startswith('9999'):
            continue
        n, m = int(p[0]), int(p[1])
        koef.append([n, m, float(p[2]), float(p[3]), float(p[4]), float(p[5])])
    js = ('// GENEROVÁNO scripts/gen_zeme_data.py — NEUPRAVOVAT RUČNĚ.\n'
          '// World Magnetic Model 2025 (NOAA/NCEI, epocha %.1f, platí 2025–2030): koeficienty\n'
          '// [n, m, g, h, dg/dt, dh/dt] v nT. Čte js/zeme-svet.js (deklinace kdekoli na světě).\n'
          'window.AGWmmKoef = { epocha: %.1f, k: %s };\n' % (epoch, epoch, json.dumps(koef, separators=(',', ':'))))
    path = os.path.join(ROOT, 'js', 'wmm2025-koef.js')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    print('js/wmm2025-koef.js: %d B, %d koeficientů, epocha %.1f' % (len(js), len(koef), epoch))
    # testovací hodnoty NOAA (deklinace) pro tests/cases-zeme.js
    tv = [n for n in z.namelist() if n.endswith('TestValues.txt')]
    if tv:
        print('   testovací hodnoty: ' + tv[0])
        for l in z.read(tv[0]).decode().splitlines()[:14]:
            print('   ' + l)


def dp(points, tol):
    """Douglas–Peucker ve stupních (stačí: jde o určení země, ne o katastr)."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy) or 1e-12
    imax, dmax = 0, 0.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / L
        if d > dmax:
            imax, dmax = i, d
    if dmax > tol:
        a = dp(points[:imax + 1], tol)
        b = dp(points[imax:], tol)
        return a[:-1] + b
    return [points[0], points[-1]]


def hranice():
    d = json.load(open(os.path.join(SRC, 'ne50.json'), encoding='utf-8'))
    out = {}
    for f in d['features']:
        p = f['properties']
        iso = p.get('ISO_A2_EH') or p.get('ISO_A2')
        if iso == '-99':
            iso = p.get('ISO_A2_EH')
        if iso not in ZEME:
            continue
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        rings = []
        for poly in polys:
            ring = [(round(x, 3), round(y, 3)) for x, y in poly[0]]
            # uzavřený prstenec: první == poslední bod, takže se napřed rozdělí v nejvzdálenějším
            # bodě od začátku (jinak by DP viděl úsečku nulové délky a smázl všechno)
            x0, y0 = ring[0]
            k = max(range(len(ring)), key=lambda i: (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2)
            ring = dp(ring[:k + 1], 0.01)[:-1] + dp(ring[k:], 0.01)
            if len(ring) < 4:
                continue
            # zámořská území mimo Evropu (Francouzská Guyana, Kanáry ne — ty patří k ES) pryč
            xs = [q[0] for q in ring]
            ys = [q[1] for q in ring]
            if max(xs) < -32 or min(ys) < 27 or min(xs) > 50:
                continue
            rings.append([[q[0], q[1]] for q in ring])
        if rings:
            out[iso] = rings
    chybi = [z for z in ZEME if z not in out]
    path = os.path.join(ROOT, 'data', 'zeme-hranice.json')
    s = json.dumps(out, separators=(',', ':'))
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)
    print('data/zeme-hranice.json: %d B, %d zemí%s' % (len(s), len(out), (', CHYBÍ ' + ' '.join(chybi)) if chybi else ''))


if __name__ == '__main__':
    egm()
    wmm()
    hranice()
