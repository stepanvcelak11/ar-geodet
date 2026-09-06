# -*- coding: utf-8 -*-
"""Hlida delici caru mezi ZAKLADEM (zdarma) a PRO (placenou verzi).

PROC EXISTUJE: co je za penize, je zapsane na JEDINEM miste - jako pole `pro: 1`
u zaznamu v js/tools-registry.js. Cte to ale VIC veci naraz (zamky za behu,
delene sestaveni, jednoduchy rezim, rozcestniky) a kazda z nich se da rozbit
tise. Nejhorsi tri zpusoby, a presne ty tenhle skript hlida:

  1) NASTROJ, O KTEREM SE NIKDO NEROZHODL. Novy nastroj bez `pro` spadne
     automaticky do Zakladu. To je spravna vychozi volba (radsi rozdat nez
     omylem zamknout), ale ma to byt VEDOME - proto se novy nastroj musi
     objevit ve vypisu nize a nekdo se na nej ma podivat.

  2) OSIRELY ROZCESTNIK. Rozcestnik (`hub: 1`) neni nastroj, je to radek, ktery
     rozbaluje jine nastroje. Kdyz jsou vsechny jeho polozky `pro`, musi byt
     `pro` i on sam - jinak Zaklad ukaze radek, pod kterym neni nic. A naopak:
     `pro` rozcestnik se smisenymi polozkami by Zakladu sebral i polozky, ktere
     ma mit zdarma.

  3) ZAMCENA POZVANKA. Kdo ma Pro, muze pozvat cloveka bez Pro, aby mu delal na
     zakazce. Ten se musi mit CIM prihlasit a cim predat data - jinak je cela
     firemni cast Pro k nicemu, protoze sef nema koho pozvat. Klice v
     MUSI_ZUSTAT_ZDARMA proto `pro` byt nesmi, i kdyz "firemne" vypadaji.

Krome hlidani vypisuje MAPU NASTROJ -> SOUBOR, kterou potrebuje delene
sestaveni (scripts/build.mjs --zaklad musi vedet, ktere soubory vynechat).
Pro nastroje BEZ vlastniho souboru (staticke dlazdice v index.html, rozcestniky)
se z balicku vynechat nedaji - ty musi zamknout az js/pro-zamky.js za behu.

Spusteni:  python scripts/check_verze.py
           python scripts/check_verze.py --mapa    (jen mapa nastroj -> soubor, JSON)
Navratovy kod 1 = delici cara je rozbita.
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from check_tools_registry import registered_ids  # noqa: E402  (sdilime jeden scanner)


# Nastroje, ktere `pro` byt NESMI, at uz vypadaji jakkoli firemne.
# Duvod u kazdeho, aby to nikdo pozdeji "neuklidil" do Pro.
MUSI_ZUSTAT_ZDARMA = {
    'job-transfer': u'pozvany bez Pro musi prevzit zakazku a poslat data zpatky',
    'prenosy-zarizeni': u'rozcestnik nad job-transfer; kdyby byl pro, pozvany se k prenosu nedostane',
}


def read(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8', errors='replace').read()


def zaznamy():
    """[(klic, telo zaznamu)] z pole T v js/tools-registry.js."""
    src = read('js/tools-registry.js')
    body = src[src.index('var T = ['):]
    return re.findall(r"\{ k: '([^']+)'(.*?)\n(?=\s*(?:\{ k:|\]|//))", body, re.S)


def main():
    recs = zaznamy()
    if len(recs) < 50:
        sys.stderr.write('check_verze: z registru se vycetlo jen %d zaznamu - zmenil se zapis pole T?\n' % len(recs))
        return 1

    pro, base, hub, inhub, popis = set(), set(), set(), {}, {}
    for k, body in recs:
        if 'pro: 1' in body:
            pro.add(k)
        if 'base: 1' in body:
            base.add(k)
        if 'hub: 1' in body:
            hub.add(k)
        m = re.search(r"inhub: '([^']*)'", body)
        if m:
            inhub.setdefault(m.group(1), []).append(k)
        m = re.search(r"vl: '([^']*)'", body)
        popis[k] = m.group(1) if m else ''

    soubory = registered_ids()

    if '--mapa' in sys.argv:
        sys.stdout.write(json.dumps({
            'pro': sorted(pro),
            'zaklad': sorted(set(k for k, _ in recs) - pro),
            'soubory': {k: soubory[k] for k in sorted(pro) if k in soubory},
            'bez_souboru': sorted(k for k in pro if k not in soubory),
        }, ensure_ascii=False, indent=1))
        return 0

    chyby = []

    # 1) `pro` a `base` se vylucuji
    for k in sorted(pro & base):
        chyby.append(u'%s: je zaroven `pro: 1` a `base: 1`. Zakladni sada jednoducheho '
                     u'rezimu je z definice zdarma - bud zrus `base`, nebo `pro`.' % k)

    # 2) rozcestnik je `pro` prave tehdy, kdyz jsou `pro` vsechny jeho polozky
    for h in sorted(hub):
        polozky = inhub.get(h, [])
        if not polozky:
            continue
        vsechny_pro = all(p in pro for p in polozky)
        if vsechny_pro and h not in pro:
            chyby.append(u'%s: vsechny jeho polozky (%s) jsou `pro`, ale rozcestnik `pro` neni. '
                         u'V Zakladu by zbyl radek, pod kterym neni nic - pridej mu `pro: 1`.'
                         % (h, ', '.join(polozky)))
        if not vsechny_pro and h in pro:
            zdarma = [p for p in polozky if p not in pro]
            chyby.append(u'%s: je `pro`, ale obsahuje polozky, ktere `pro` nejsou (%s). '
                         u'Zaklad by o ne prisel - bud zrus `pro` u rozcestniku, nebo ho '
                         u'pridej i tem polozkam.' % (h, ', '.join(zdarma)))

    # 3) pozvanka bez Pro musi zustat prujezdna
    for k, proc in sorted(MUSI_ZUSTAT_ZDARMA.items()):
        if k in pro:
            chyby.append(u'%s: nesmi byt `pro` - %s.' % (k, proc))

    # ---- vypis ----
    vsechny = [k for k, _ in recs]
    zaklad = [k for k in vsechny if k not in pro]
    bez_souboru = sorted(k for k in pro if k not in soubory)

    out = sys.stdout
    out.write(u'ZAKLAD: %d nastroju    PRO: %d nastroju\n' % (len(zaklad), len(pro)))
    out.write(u'Pro nastroju s vlastnim souborem: %d (ty --zaklad vynecha uz pri sestaveni)\n'
              % (len(pro) - len(bez_souboru)))
    if bez_souboru:
        out.write(u'Pro nastroju bez vlastniho souboru: %d - zamyka je az js/pro-zamky.js za behu:\n'
                  % len(bez_souboru))
        out.write(u'  ' + u', '.join(bez_souboru) + u'\n')

    if chyby:
        out.write(u'\nCHYBY (%d):\n' % len(chyby))
        for c in chyby:
            out.write(u'  - ' + c + u'\n')
        return 1

    out.write(u'\nOK - delici cara Zaklad/Pro je v poradku.\n')
    return 0


if __name__ == '__main__':
    if sys.version_info[0] >= 3:
        try:
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    sys.exit(main())
