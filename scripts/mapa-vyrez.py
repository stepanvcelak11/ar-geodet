#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mapa-vyrez.py — vyrobí data pro vlastní vektorovou mapu (PMTiles) z denního sestavení
Protomaps (OpenStreetMap, celá planeta ~140 GB) — stáhne se JEN výřez.

    python scripts/mapa-vyrez.py test        # Praha, pár MB (fixture pro testy)
    python scripts/mapa-vyrez.py cr          # Česko (~1–2 GB)
    python scripts/mapa-vyrez.py stred       # ČR + SK + PL + AT + DE (pilot, ~6–8 GB)
    python scripts/mapa-vyrez.py evropa      # celá Evropa (~25–35 GB)
    python scripts/mapa-vyrez.py 14.4,50.0,14.6,50.2   # vlastní bbox lon0,lat0,lon1,lat1

Výstup: <složka>/<název>.pmtiles (složka = 2. argument, jinak %TEMP%/qtrig-mapa).
Nástroj: go-pmtiles (Go, jeden .exe) — skript ho stáhne z GitHubu curl-em, když chybí
(Python tady na síť nemůže, viz paměť env-python-ssl-curl).

NAHRÁNÍ (ručně, viz cloud/wrangler.toml): Cloudflare R2 → bucket qtrig-mapa → soubor
evropa.pmtiles; appka čte https://ar-geodet-api.ar-geodet.workers.dev/mapa/evropa.pmtiles.
Do 300 MB stačí dashboard; větší přes `wrangler r2 object put` nebo rclone (S3 API).
Vlastní adresu jde zadat v Nastavení → Vzhled → Adresa dat mapy (i místní server s Range).
"""
import os
import subprocess
import sys
import time
import zipfile

REGIONY = {
    'test': ('14.425,50.065,14.455,50.085', 11),   # fixture tests/fixtures/mapa-praha.pmtiles (od z11)
    'praha': ('14.22,49.94,14.71,50.18', 0),
    'cr': ('12.05,48.53,18.90,51.08', 0),
    # sousedé — soubory po zemích (worker /mapa/<kód>.pmtiles; do 2 GB jde jako asset vydání GitHubu)
    'sk': ('16.80,47.70,22.60,49.65', 0),
    'at': ('9.50,46.35,17.20,49.05', 0),
    'hu': ('16.10,45.70,22.95,48.62', 0),
    'si': ('13.35,45.40,16.65,46.90', 0),
    'pl': ('14.05,49.00,24.20,54.90', 0),
    'de': ('5.85,47.25,15.05,55.10', 0),
    'stred': ('5.85,45.8,24.2,55.1', 0),           # DE+AT+CZ+SK+PL
    'evropa': ('-12,34,45,72', 0),
}
PM_VER = '1.31.2'
PM_URL = 'https://github.com/protomaps/go-pmtiles/releases/download/v%s/go-pmtiles_%s_Windows_x86_64.zip' % (PM_VER, PM_VER)
BUILD_INDEX = 'https://build.protomaps.com/'


def curl(url, out):
    r = subprocess.run(['curl', '-sL', '-o', out, url, '-w', '%{http_code}'], capture_output=True, text=True)
    return r.stdout.strip()


def pmtiles_exe(slozka):
    exe = os.path.join(slozka, 'pmtiles.exe')
    if os.path.isfile(exe):
        return exe
    z = os.path.join(slozka, 'pmtiles.zip')
    print('Stahuji go-pmtiles %s…' % PM_VER)
    if curl(PM_URL, z) != '200':
        sys.exit('CHYBA: nelze stáhnout ' + PM_URL)
    zipfile.ZipFile(z).extract('pmtiles.exe', slozka)
    return exe


def posledni_build():
    # denní sestavení se jmenuje YYYYMMDD.pmtiles; index HTML je 404, tak zkusíme HEAD posledních dní
    for d in range(0, 7):
        t = time.gmtime(time.time() - d * 86400)
        name = time.strftime('%Y%m%d', t) + '.pmtiles'
        r = subprocess.run(['curl', '-sIL', BUILD_INDEX + name], capture_output=True, text=True)
        if 'HTTP/1.1 200' in r.stdout or 'HTTP/2 200' in r.stdout:
            return BUILD_INDEX + name
    sys.exit('CHYBA: nenašel jsem žádné sestavení na ' + BUILD_INDEX)


def main():
    if len(sys.argv) < 2:
        print(__doc__); return 2
    co = sys.argv[1]
    slozka = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.environ.get('TEMP', '.'), 'qtrig-mapa')
    os.makedirs(slozka, exist_ok=True)
    bbox, minz = REGIONY.get(co, (co, 0))
    if bbox.count(',') != 3:
        sys.exit('CHYBA: neznámý region a není to bbox: ' + co)
    exe = pmtiles_exe(slozka)
    src = posledni_build()
    out = os.path.join(slozka, (co if co in REGIONY else 'vyrez') + '.pmtiles')
    args = [exe, 'extract', src, out, '--bbox=' + bbox]
    if minz:
        args.append('--minzoom=%d' % minz)
    print('Zdroj:', src); print('Výřez:', bbox, '→', out)
    t0 = time.time()
    r = subprocess.run(args)
    if r.returncode != 0:
        sys.exit('CHYBA: pmtiles extract skončil s kódem %d' % r.returncode)
    mb = os.path.getsize(out) / 1048576
    print('Hotovo za %.0f s: %s (%.1f MB)' % (time.time() - t0, out, mb))
    print('Nahrát do R2 (bucket qtrig-mapa) jako evropa.pmtiles — viz cloud/wrangler.toml.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
