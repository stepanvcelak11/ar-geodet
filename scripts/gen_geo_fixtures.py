#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_geo_fixtures.py — generator referencnich dat pro geodeticke testy.

PROC: appka pocita S-JTSK pres proj4js (js/lib/proj4-2.9.0.min.js) s definici
EPSG:5514, kterou si sama nastavuje v js/logika.js. Do dneska nic neoverovalo, ze
to vraci spravna cisla ani ve KTEREM PORADI. Tenhle skript vezme UPLNE STEJNY
proj-string a prozene ho autoritativnim PROJ (pres pyproj), takze vznikne
referencni sada, proti ktere se JS da testovat.

Zamerne se NEpouziva CRS.from_epsg(5514) z databaze PROJ: ta ma jinou (presnejsi)
transformacni pipeline nez +towgs84 sedmiprvkovy Helmert v definici appky. Test ma
overit, ze proj4js pocita SPRAVNE TU DEFINICI, kterou mu appka dava — ne ze se
definice appky rovna nejlepsimu dostupnemu modelu (to je jina, geodeticka otazka).

Vystup: tests/fixtures/geo-sjtsk.json  (cti tests/cases-geo.js)

Pouziti:
    python scripts/gen_geo_fixtures.py            # zapise fixtures
    python scripts/gen_geo_fixtures.py --check    # jen overi, ze soubor je aktualni

Zavislost: pyproj  (pip install pyproj). Neni potreba pro beh appky ani pro CI
testy — fixtures se commituji, generuji se jen kdyz se meni definice projekce.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tests' / 'fixtures' / 'geo-sjtsk.json'

# PRESNE definice z js/logika.js — pri zmene tam zmen i tady A pregeneruj fixtures.
KROVAK_PROJ4 = (
    "+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 "
    "+alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel "
    "+towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs"
)

# Pojmenovane body: mesta po CR (pokryti rozsahu Y i X) + body ZA hranicemi, kde
# drivejsi heuristika min/max prohazovala osy (regrese na konkretni chybu).
NAMED = [
    ("Praha-centrum",        50.0875, 14.4213, "CZ"),
    ("Brno",                 49.1951, 16.6068, "CZ"),
    ("Ostrava",              49.8209, 18.2625, "CZ"),
    ("Plzen",                49.7384, 13.3736, "CZ"),
    ("Cheb-zapad",           50.0796, 12.3740, "CZ"),
    ("Ceske-Budejovice",     48.9745, 14.4747, "CZ"),
    ("Liberec",              50.7663, 15.0543, "CZ"),
    ("Zlin-vychod",          49.2265, 17.6686, "CZ"),
    ("Jesenik-sever",        50.2294, 17.2039, "CZ"),
    ("Breclav-jih",          48.7589, 16.8820, "CZ"),
    # --- za hranicemi: sem heuristika min/max sahala spatne ---
    ("DE-Frankfurt",         50.1109,  8.6821, "mimo-CR"),
    ("BE-Brusel",            50.8503,  4.3517, "mimo-CR"),
    ("DE-Norimberk",         49.4521, 11.0767, "mimo-CR"),
    ("AT-Innsbruck",         47.2692, 11.4041, "mimo-CR"),
    ("PL-Wroclaw",           51.1079, 17.0385, "mimo-CR"),
    ("SK-Kosice",            48.7164, 21.2611, "mimo-CR"),
]


def build():
    from pyproj import CRS, Transformer  # importuje se az tady, ať --help funguje bez pyprojgen
    import pyproj

    crs = CRS.from_proj4(KROVAK_PROJ4)
    fwd = Transformer.from_crs("EPSG:4326", crs, always_xy=True)

    points = []
    for name, lat, lng, zone in NAMED:
        ox, oy = fwd.transform(lng, lat)
        points.append({
            "name": name, "zone": zone,
            "lat": round(lat, 7), "lng": round(lng, 7),
            # raw = presne to, co ma vratit proj4('EPSG:4326','EPSG:5514',[lng,lat])
            "raw0": round(ox, 4), "raw1": round(oy, 4),
            # kontrakt GeoCore.toSJTSK -> kladne metry, y = zapadni osa, x = jizni
            "y": round(abs(ox), 4), "x": round(abs(oy), 4),
        })

    # Pravidelna mrizka pres CR — chytne systematicky posun, ktery by na 16 bodech proklouzl.
    grid = []
    lat = 48.6
    while lat <= 51.05 + 1e-9:
        lng = 12.1
        while lng <= 18.85 + 1e-9:
            ox, oy = fwd.transform(lng, lat)
            grid.append({
                "lat": round(lat, 6), "lng": round(lng, 6),
                "y": round(abs(ox), 4), "x": round(abs(oy), 4),
            })
            lng += 0.75
        lat += 0.35

    # Referencni VZDALENOSTI z geodetiky na WGS84 elipsoidu (Geod.inv = presne reseni,
    # ne aproximace). Hlidaji getDistance: do dneska pouzival haversine s globalnim
    # polomerem 6371 km a v CR tim kazdou vzdalenost systematicky zkracoval o ~1700 ppm.
    geod = pyproj.Geod(ellps='WGS84')
    pairs = []
    for name, lat, lng, zone in NAMED:
        if zone != "CZ":
            continue
        for tag, dlat, dlng in (("~1.4km", 0.009, 0.014), ("~140m", 0.0009, 0.0014), ("~14m", 0.00009, 0.00014)):
            lat2, lng2 = lat + dlat, lng + dlng
            _, _, d = geod.inv(lng, lat, lng2, lat2)
            pairs.append({
                "at": "%s %s" % (name, tag),
                "lat1": round(lat, 7), "lng1": round(lng, 7),
                "lat2": round(lat2, 7), "lng2": round(lng2, 7),
                "m": round(d, 4),
            })

    return {
        "_comment": (
            "GENEROVANO scripts/gen_geo_fixtures.py — needitovat rucne. "
            "Referencni hodnoty pochazi z PROJ pres pyproj na TOTOZNEM proj-stringu, "
            "jaky appka nastavuje v js/logika.js."
        ),
        "proj4": KROVAK_PROJ4,
        "generatedBy": {"pyproj": pyproj.__version__, "proj": pyproj.proj_version_str},
        # Tolerance pro srovnani proj4js vs PROJ. proj4js resi +towgs84 stejnym
        # 7-prvkovym Helmertem, takze rozdil je numericky, ne modelovy — v praxi
        # jednotky milimetru. 0,05 m je strop, pod kterym je to pro geodezii sum,
        # ale zaroven 6 rady pod tim, co by znamenalo prohozene osy nebo spatnou definici.
        "tolM": 0.05,
        "points": points,
        "grid": grid,
        "distances": {
            "_comment": "geodetika WGS84 (pyproj Geod.inv) — reference pro getDistance",
            # 60 ppm = 1,2 cm na 200 m. Gaussuv polomer ve stredni sirce dava v CR
            # nejhorsi 32 ppm, takze je tu rezerva; puvodnich 1700 ppm sem nesahne.
            "tolPpm": 60,
            "pairs": pairs,
        },
    }


def main():
    check = '--check' in sys.argv[1:]
    try:
        data = build()
    except ImportError:
        print("CHYBA: chybi pyproj. Nainstaluj: python -m pip install pyproj", file=sys.stderr)
        return 2

    new = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=False) + "\n"

    if check:
        if not OUT.exists():
            print("KONTROLA SELHALA: %s neexistuje. Spust: python scripts/gen_geo_fixtures.py" % OUT.relative_to(ROOT))
            return 1
        old = OUT.read_text(encoding='utf-8')
        # generatedBy se meni s verzi pyproj/PROJ na stroji — pro kontrolu ho ignoruj,
        # jinak by CI padala jen proto, ze runner ma jinou verzi PROJ.
        def norm(txt):
            try:
                d = json.loads(txt)
                d.pop('generatedBy', None)
                return json.dumps(d, ensure_ascii=False, sort_keys=True)
            except Exception:
                return txt
        if norm(old) != norm(new):
            print("KONTROLA SELHALA: tests/fixtures/geo-sjtsk.json neodpovida definici projekce.")
            print("Oprava: python scripts/gen_geo_fixtures.py")
            return 1
        print("OK: fixtures souhlasi s definici projekce (%d bodu + %d v mrizce)."
              % (len(data['points']), len(data['grid'])))
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(new, encoding='utf-8')
    print("Zapsano %s — %d pojmenovanych bodu + %d v mrizce (PROJ %s)."
          % (OUT.relative_to(ROOT), len(data['points']), len(data['grid']), data['generatedBy']['proj']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
