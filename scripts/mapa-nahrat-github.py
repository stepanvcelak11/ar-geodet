#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mapa-nahrat-github.py — nahraje výřez mapy (PMTiles, do 2 GB) jako asset vydání GitHubu „mapa-data",
odkud ho worker /mapa/<soubor> servíruje appce (viz cloud/README-mapa.md).

    python scripts/mapa-nahrat-github.py %TEMP%\\qtrig-mapa\\sk.pmtiles        # → asset sk.pmtiles
    python scripts/mapa-nahrat-github.py cr.pmtiles cz.pmtiles                 # jiný název assetu

Token bere z git credential helperu (stejný, kterým se pushuje). Stejnojmenný asset napřed smaže.
Nahrává curl (Python tu na síť nemůže). 1,8 GB trvá ~4–5 min.
"""
import json
import os
import subprocess
import sys

REPO = 'stepanvcelak11/ar-geodet'
TAG = 'mapa-data'


def token():
    out = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith('password='):
            return line.split('=', 1)[1].strip()
    sys.exit('CHYBA: token GitHubu není v git credential helperu (git push musí fungovat bez hesla).')


def api(tok, url, method='GET', data=None, ctype='application/json'):
    args = ['curl', '-s', '-X', method, '-H', 'Authorization: Bearer ' + tok, '-H', 'Content-Type: ' + ctype, url]
    if data is not None:
        args += ['--data-binary', data]
    r = subprocess.run(args, capture_output=True, text=True, encoding='utf-8')
    try:
        return json.loads(r.stdout) if r.stdout.strip() else {}
    except Exception:
        return {'raw': r.stdout[:300]}


def main():
    if len(sys.argv) < 2:
        print(__doc__); return 2
    src = os.path.expandvars(sys.argv[1])
    if not os.path.isfile(src):
        src2 = os.path.join(os.environ.get('TEMP', ''), 'qtrig-mapa', sys.argv[1])
        if os.path.isfile(src2):
            src = src2
        else:
            sys.exit('CHYBA: soubor nenalezen: ' + sys.argv[1])
    name = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(src)
    size = os.path.getsize(src)
    if size > 2 * 1024 ** 3:
        sys.exit('CHYBA: %s má %.2f GB — asset vydání smí mít nejvýš 2 GB. Použij R2 (cloud/README-mapa.md).' % (name, size / 1024 ** 3))
    tok = token()
    rel = api(tok, 'https://api.github.com/repos/%s/releases/tags/%s' % (REPO, TAG))
    if not rel.get('id'):
        sys.exit('CHYBA: vydání %s neexistuje: %s' % (TAG, rel.get('message')))
    for a in rel.get('assets', []):
        if a['name'] == name:
            print('Mažu starý asset', name)
            api(tok, 'https://api.github.com/repos/%s/releases/assets/%d' % (REPO, a['id']), 'DELETE')
    print('Nahrávám %s (%.2f GB) jako %s …' % (src, size / 1024 ** 3, name))
    r = subprocess.run(['curl', '-s', '-X', 'POST', '-H', 'Authorization: Bearer ' + tok, '-H', 'Content-Type: application/octet-stream',
                        '--data-binary', '@' + src, 'https://uploads.github.com/repos/%s/releases/%d/assets?name=%s' % (REPO, rel['id'], name),
                        '-w', '\n%{http_code} %{time_total}s'], capture_output=True, text=True, encoding='utf-8')
    body, _, stat = r.stdout.rpartition('\n')
    try:
        d = json.loads(body)
    except Exception:
        d = {}
    if d.get('state') == 'uploaded':
        print('Hotovo: %s (%s) — %s' % (d['browser_download_url'], stat, 'appka to čte přes worker /mapa/' + name))
        return 0
    print('CHYBA:', stat, (d.get('message') or body[:300]))
    return 1


if __name__ == '__main__':
    sys.exit(main())
