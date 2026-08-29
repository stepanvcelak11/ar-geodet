#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ===== AR Geodet — BEZI NA SERVERU TO, CO MAM V REPU? ==========================
# PROC EXISTUJE: cloud/worker.js se nasazuje RUCNE (`wrangler deploy` ve slozce
# cloud/, chce prihlaseni do Cloudflare). Uz nekolikrat se stalo, ze zmena
# workeru lezela v repu tydny a nikdo nevedel, jestli je venku — poznamka
# "ZBYVA nasadit cloud/worker.js" se opakuje u nekolika ruznych ukolu.
#
# ZVENCI TO NEJDE POZNAT JINAK NEZ PODLE /health: worker vraci 401 DRIV, nez se
# podiva na cestu, takze i vymyslena cesta odpovi "Neplatne prihlaseni" — podle
# odpovedi se neda poznat, ktere endpointy nasazena verze vubec zna. Jediny
# spolehlivy ukazatel je pole `v` v odpovedi GET /health.
#
# CO SKRIPT DELA: precte ocekavane `v` z cloud/worker.js, zavola /health zive
# sluzby a porovna. Rozdil = zmena lezi v repu a NENI nasazena.
#
# ZAMERNE NENI V CI: chodi po siti a zavisi na cizi sluzbe. CI ma byt o kodu.
# Tenhle skript se pousti rucne — hlavne PO nasazeni, jako potvrzeni.
#
# Pouziti:
#   python scripts/check_worker_deployed.py
#   python scripts/check_worker_deployed.py --url https://jiny-worker.example.dev
#
# Navratovy kod: 0 = nasazene sedi s repem, 1 = nesedi / nedosahnutelne.
# ==============================================================================
import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(ROOT, 'cloud', 'worker.js')
UCTY = os.path.join(ROOT, 'js', 'ucty.js')


def read(p):
    with open(p, 'r', encoding='utf-8', errors='replace') as f:
        return f.read()


def ocekavana_verze():
    """`v` z radku s odpovedi /health v cloud/worker.js."""
    m = re.search(r"path === '/health'\s*\)\s*return json\(\{([^}]*)\}", read(WORKER))
    if not m:
        return None
    v = re.search(r"\bv:\s*(\d+)", m.group(1))
    return int(v.group(1)) if v else None


def adresa():
    """Vychozi adresa API se bere z js/ucty.js, at neni zapsana dvakrat."""
    m = re.search(r"DEFAULT_API\s*=\s*'([^']+)'", read(UCTY))
    return m.group(1) if m else None


def health(url):
    """curl misto urllib: python v tomhle prostredi nema SSL (viz poznamky k repu)."""
    try:
        out = subprocess.run(['curl', '-s', '-m', '20', url.rstrip('/') + '/health'],
                             capture_output=True, text=True, timeout=40)
        if out.returncode != 0 or not out.stdout.strip():
            return None, 'sluzba neodpovedela (curl %d)' % out.returncode
        return json.loads(out.stdout), None
    except FileNotFoundError:
        return None, 'curl neni k dispozici'
    except json.JSONDecodeError:
        return None, 'odpoved neni JSON: ' + out.stdout[:120]
    except Exception as e:                                  # noqa: BLE001
        return None, str(e)[:160]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default=None, help='adresa workeru (jinak z js/ucty.js)')
    args = ap.parse_args()

    chci = ocekavana_verze()
    url = args.url or adresa()
    if chci is None:
        print('CHYBA: v cloud/worker.js se nepodarilo najit `v` u odpovedi /health.')
        return 1
    if not url:
        print('CHYBA: neznam adresu API (DEFAULT_API v js/ucty.js).')
        return 1

    print('repo cloud/worker.js:  v%d' % chci)
    print('sluzba %s' % url)
    h, chyba = health(url)
    if chyba:
        print('  NEDOSAZITELNE: %s' % chyba)
        print('  (bez site se to overit neda — skript nic netvrdi)')
        return 1

    mam = h.get('v')
    print('  /health:             v%s  %s' % (mam, json.dumps(
        {k: v for k, v in h.items() if k not in ('ts',)}, ensure_ascii=False)))

    if mam == chci:
        print('\nOK - nasazeny worker odpovida tomu, co je v repu.')
        return 0

    print('\nNESEDI - nasazena verze je STARSI nez cloud/worker.js v repu.')
    print('  Nasazeni (musi ho spustit clovek s prihlasenim do Cloudflare):')
    print('      cd cloud && wrangler deploy')
    print('  Pak znovu tenhle skript. Postup i alternativa pres webovy editor')
    print('  jsou v cloud/README.md.')
    print('\n  Pozn.: zmeny, ktere `v` nebumply, tenhle skript rozlisit NEUMI.')
    print('  O starsich upravach tedy rekne jen tolik, ze nasazene je starsi nez repo.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
