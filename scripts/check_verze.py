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


# Pro nastroje, ktere scanner NENAJDE, protoze se neregistruji pres
# agRegisterFieldTool({id:...}) - jsou to staticke dlazdice v index.html volane
# z onclick. Soubor u nich PRESTO existuje a delene sestaveni ho z balicku
# Zakladu vynechat MUSI, jinak si Zaklad stahuje kod, ktery nikdy nespusti.
#
# ⚠ SMI SEM JEN ODLOZENY MODUL (<script type="ag/lazy" data-src=...>). U eager
#   skriptu by vynechani znamenalo, ze `onclick` v index.html vola neexistujici
#   funkci a klik by spadl do konzole misto na zamek; u odlozeneho se nestane
#   nic - js/lazy-load.js ho proste nema odkud vzit a klik odchyti driv
#   js/pro-zamky.js (capture faze).
# Hlida to kontrola nize: kazdy zaznam musi byt `pro`, soubor musi existovat
# a v index.html musi byt zapsany jako odlozeny.
RUCNE_SOUBORY = {
    'openDmtVolume': 'dmt-volume.js',
    'openTachymetrie': 'tachymetrie.js',
}

# Soubory, ktere do Zakladu nepatri, i kdyz to nejsou nastroje z registru.
# Klic je popis duvodu (vypisuje se v --mapa), hodnota cesta od korene repa.
PRO_SOUBORY_NAVIC = {
    'js/pro-klice.js': u'dilna vlastnika appky na vyrobu licencnich klicu',
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
    # rucni doplnky (staticke dlazdice) - az po scanneru, aby ho neprepsaly tise
    for k, f in RUCNE_SOUBORY.items():
        if k not in soubory:
            soubory[k] = f

    # ---- ktery soubor smi delene sestaveni z balicku ZAKLADU vynechat --------
    # DVE PODMINKY, A KAZDA MA SVUJ VLASTNI PRIPAD, KTERY UZ NASTAL:
    #
    # (a) VSECHNY nastroje v souboru musi byt `pro`. Mapa nastroj -> soubor sama
    #     o sobe nestaci: jeden soubor umi hostit vic nastroju a vynechanim by
    #     Zaklad prisel i o ty zdarma.
    #
    # (b) ⚠⚠ SOUBOR MUSI BYT ODLOZENY (`type="ag/lazy"` v index.html nebo zaznam
    #     v MANIFESTu js/lazy-tools.js). Podminka (a) sama LZE: js/field-tools.js
    #     registruje JEDINY nastroj, `dronview`, a ten `pro` je - jenze v temze
    #     souboru bydli CELA MRIZKA NASTROJU, ktera se neregistruje pres
    #     agRegisterFieldTool, takze o ni scanner nevi. Podle (a) by soubor vysel
    #     jako "cisty Pro" a Zaklad by se nasadil BEZ NASTROJU.
    #     Odlozeny modul je proti tomu z definice pouhy nastroj: nacita se az po
    #     prvnim obraze, takze na nem nemuze stat start appky. Co se spousti pri
    #     startu (eager <script src>), zustava v obou vydanich a zamyka se az za
    #     behu pres js/pro-zamky.js - stoji to par set kB v Zakladu a je to
    #     jedina varianta, kde se nema co tise rozbit.
    html_src = read('index.html')
    try:
        lazy_src = read('js/lazy-tools.js')
    except OSError:
        lazy_src = u''

    def je_odlozeny(cesta):
        if ('data-src="%s"' % cesta) in html_src:
            return True
        return ("src: '%s'" % cesta) in lazy_src or ("src: './%s'" % cesta) in lazy_src

    v_souboru = {}
    for k, f in soubory.items():
        v_souboru.setdefault('js/' + f, []).append(k)
    smazatelne, sdilene, eager = [], {}, {}
    for f, klice in sorted(v_souboru.items()):
        if not any(k in pro for k in klice):
            continue
        zdarma = sorted(k for k in klice if k not in pro)
        if zdarma:
            sdilene[f] = zdarma
        elif not je_odlozeny(f):
            eager[f] = sorted(klice)
        else:
            smazatelne.append(f)

    if '--mapa' in sys.argv:
        sys.stdout.write(json.dumps({
            'pro': sorted(pro),
            'smazatelne': sorted(set(smazatelne) | set(PRO_SOUBORY_NAVIC)),
            'sdilene': sdilene,
            'eager': eager,
            'zaklad': sorted(set(k for k, _ in recs) - pro),
            'soubory': {k: soubory[k] for k in sorted(pro) if k in soubory},
            'navic': sorted(PRO_SOUBORY_NAVIC),
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

    # 4) rucni mapa nastroj -> soubor musi sedet, jinak delene sestaveni tise
    #    vynecha soubor, ktery Zaklad potrebuje (nebo naopak necha Pro kod uvnitr)
    html = read('index.html')
    for k, f in sorted(RUCNE_SOUBORY.items()):
        if k not in pro:
            chyby.append(u'RUCNE_SOUBORY: %s uz neni `pro` - vyrad ho odtud, jinak by '
                         u'--zaklad vynechal soubor nastroje, ktery ma byt zdarma.' % k)
            continue
        if not os.path.exists(os.path.join(ROOT, 'js', f)):
            chyby.append(u'RUCNE_SOUBORY: js/%s neexistuje (nastroj %s).' % (f, k))
            continue
        if ('data-src="js/%s"' % f) not in html:
            chyby.append(u'RUCNE_SOUBORY: js/%s uz v index.html neni odlozeny (ag/lazy data-src). '
                         u'Eager soubor se z balicku vynechat nesmi - onclick by volal '
                         u'neexistujici funkci misto zamku.' % f)
    for f in sorted(PRO_SOUBORY_NAVIC):
        if not os.path.exists(os.path.join(ROOT, f)):
            chyby.append(u'PRO_SOUBORY_NAVIC: %s neexistuje.' % f)

    # ---- vypis ----
    vsechny = [k for k, _ in recs]
    zaklad = [k for k in vsechny if k not in pro]
    bez_souboru = sorted(k for k in pro if k not in soubory)

    out = sys.stdout
    out.write(u'ZAKLAD: %d nastroju    PRO: %d nastroju\n' % (len(zaklad), len(pro)))
    out.write(u'Pro nastroju s vlastnim souborem: %d\n' % (len(pro) - len(bez_souboru)))
    out.write(u'Souboru vynechanych uz pri sestaveni (scripts/vydani.py --zaklad): %d\n'
              % (len(smazatelne) + len(PRO_SOUBORY_NAVIC)))
    if sdilene:
        out.write(u'Sdilene soubory - Pro nastroj bydli spolu s nastrojem zdarma, takze\n'
                  u'se z balicku vynechat NESMI; zamyka az js/pro-zamky.js za behu:\n')
        for f in sorted(sdilene):
            out.write(u'  %s  (zdarma: %s)\n' % (f, ', '.join(sdilene[f])))
    if eager:
        out.write(u'Pro soubory spoustene pri STARTU (ne odlozene) - v balicku Zakladu\n'
                  u'zustavaji a zamykaji se az za behu, protoze na nich muze stat start:\n')
        for f in sorted(eager):
            out.write(u'  %s  (%s)\n' % (f, ', '.join(eager[f])))
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
