# -*- coding: utf-8 -*-
u"""ÚŘEDNÍ BODY RAKOUSKA — dlaždice z otevřených dat BEV (25. 9. 2026, 6. hodnocení e1).

BEV (Bundesamt für Eich- und Vermessungswesen) dává trigonometrické body (TP) jako CSV,
licence CC BY 4.0 — ale jeho server NEPOSÍLÁ Access-Control-Allow-Origin, takže appka
v prohlížeči CSV stáhnout nesmí (a 28 MB by stejně nechtěla). Tenhle skript ho předem rozřeže
na dlaždice 0,25° × 0,25° v data/body-at/ a js/body-svet.js si stáhne jen ty kolem uživatele.

Použití (Python nemá na tomhle stroji SSL → CSV stáhni curlem):
    curl -o at_tp.csv https://data.bev.gv.at/download/Festpunkte/Lage/ETRS89/TP/20241001/AT_ETRS89_TP_20241001.csv
    python scripts/body_at.py at_tp.csv
Novější stav: v https://data.bev.gv.at (Festpunkte → Lage → ETRS89 → TP) je adresář s datem
(Stichtag); změň adresu a STICHTAG níže.

Záznam v dlaždici = pole (krátké kvůli velikosti):
    [jméno, šířka, délka, výška n. m., řád, stabilizace, místní název, datum měření, střední chyba m]
    jméno   = „číslo-list ÖK50“ jako v rakouské praxi (497-40), u vedlejších značek + kód (497-40 T1)
    výška   = elipsoidická výška ETRS89 − undulace geoidu Rakouska (UNDULATION_GRS80), na cm
"""
import csv
import io
import json
import math
import os
import sys

STICHTAG = '2024-10-01'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'body-at')
KROK = 4          # dlaždice 1/4 stupně


def f(v):
    try:
        return float(str(v).replace(',', '.'))
    except ValueError:
        return None


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    rows = csv.DictReader(io.open(sys.argv[1], encoding='utf-8-sig'), delimiter=';')
    dl = {}
    n = 0
    for r in rows:
        lat, lng = f(r['BREITE']), f(r['LAENGE'])
        if lat is None or lng is None:
            continue
        h, und = f(r['HOEHE']), f(r['UNDULATION_GRS80'])
        vyska = round(h - und, 2) if h is not None and und is not None else None
        kz = (r['KENNZEICHEN'] or '').strip()
        jm = '%s-%s' % (r['PUNKTNUMMER'].strip(), r['OeK50_BMN_NR'].strip()) + ('' if kz in ('', 'A1') else ' ' + kz)
        mx = [f(r[k]) for k in ('mX', 'mY', 'mZ')]
        m = round(math.sqrt(sum(x * x for x in mx if x is not None)), 3) if any(x is not None for x in mx) else None
        rec = [jm, round(lat, 7), round(lng, 7), vyska, int(r['ORDNUNG']) if r['ORDNUNG'].strip().isdigit() else None,
               r['STABART'].strip() or None, r['PUNKTNAME'].strip() or None, r['MESSDATUM'].strip() or None, m]
        key = '%d_%d' % (math.floor(lat * KROK), math.floor(lng * KROK))
        dl.setdefault(key, []).append(rec)
        n += 1
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        if old.endswith('.json'):
            os.remove(os.path.join(OUT, old))
    for key, recs in dl.items():
        recs.sort(key=lambda x: x[0])
        with io.open(os.path.join(OUT, key + '.json'), 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(recs, fh, ensure_ascii=False, separators=(',', ':'))
    idx = {'zdroj': 'BEV — Festpunkte Lage ETRS89 (TP), CC BY 4.0', 'stichtag': STICHTAG, 'krok': KROK, 'bodu': n,
           'dlazdice': sorted(dl.keys())}
    with io.open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(idx, fh, ensure_ascii=False, separators=(',', ':'))
    vel = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
    print('bodů %d, dlaždic %d, celkem %.1f MB, největší %.0f kB' % (n, len(dl), vel / 1e6,
          max(os.path.getsize(os.path.join(OUT, k + '.json')) for k in dl) / 1e3))


if __name__ == '__main__':
    main()
