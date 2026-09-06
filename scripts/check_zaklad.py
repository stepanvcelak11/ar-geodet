# -*- coding: utf-8 -*-
"""Hleda vazby, ktere by ROZBILY balicek ZAKLAD.

PROC: v balicku Zaklad (scripts/vydani.py --zaklad) Pro moduly VUBEC NEJSOU.
Kdyz na neco z nich sahne modul, ktery v Zakladu zustava, nespadne build ani
zadna staticka kontrola — appka se tise rozbije az u uzivatele, a jen na tom
jednom vydani, ktere se pri vyvoji nespousti. Presne ta trida chyby, kterou
nikdo nenajde.

CO SKRIPT DELA: pro kazdy Pro modul najde, co VYSTAVUJE do okna (`window.X = `),
a pak hleda, jestli na to nesahaji moduly, ktere v Zakladu zustavaji.

CO TENHLE SKRIPT NEUMI: dynamicke odkazy (`window['ag' + jmeno]`), volani pres
retezec v datech a zavislosti pres CSS. Je to sito na nejcastejsi pripad, ne
dukaz. Dukaz je SPUSTIT balicek Zaklad — proto se tenhle skript nesmi brat jako
nahrada bootu.

Spusteni:  python scripts/check_zaklad.py
Navratovy kod 1 = Zaklad by sahal na neco, co v nem neni.
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from check_tools_registry import registered_ids  # noqa: E402
from check_verze import zaznamy                  # noqa: E402

# Co se z odkazu na globaly NEPOCITA: vlastni obsluha modulu a bezne zkratky.
IGNOR = set(['window', 'document', 'console', 'JSON', 'Math', 'Date', 'Object', 'Array'])


def read(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8', errors='replace').read()


def main():
    recs = zaznamy()
    pro_klice = set(k for k, b in recs if 'pro: 1' in b)
    soubory = registered_ids()                     # klic nastroje -> jmeno souboru v js/

    pro_soubory = set()
    for k in pro_klice:
        if k in soubory:
            pro_soubory.add('js/' + soubory[k])

    # Soubory, ktere v Zakladu ZUSTAVAJI = vsechny ostatni js krome lib.
    vsechny = set()
    for name in sorted(os.listdir(os.path.join(ROOT, 'js'))):
        if name.endswith('.js'):
            vsechny.add('js/' + name)
    zaklad_soubory = vsechny - pro_soubory

    # 1) co Pro moduly vystavuji do okna
    #
    # ⚠ GLOBAL PATRI PRU, JEN KDYZ HO ZADNY SOUBOR ZE ZAKLADU NEDEFINUJE TAKY.
    #   Pri prvnim behu tenhle skript nahlasil 269 "vazeb" a vsechny byly falesne:
    #   appka ma sdilene pomocniky (agAlert, agInfo, agRegisterFieldTool,
    #   quickToast), ktere si skoro kazdy modul obranne dodefinuje sam. Sito je
    #   pak priradilo tomu souboru, na ktery narazilo prvni — a kdyz to nahodou
    #   byl Pro modul, vypadalo to, ze na nej saha pul appky. Rozhoduje se proto
    #   podle toho, kdo ten nazev definuje, ne kdo ho definuje PRVNI.
    def definovane(soubory):
        out = {}
        for f in sorted(soubory):
            src = read(f)
            for m in re.finditer(r"window\.([A-Za-z_$][\w$]*)\s*=", src):
                jm = m.group(1)
                if jm not in IGNOR:
                    out.setdefault(jm, f)
        return out

    v_pro = definovane(pro_soubory)
    v_zakladu = definovane(zaklad_soubory)
    vystavuje = dict((jm, f) for jm, f in v_pro.items() if jm not in v_zakladu)

    # 2) sahaji na to moduly, ktere zustavaji?
    #
    # ⚠ HLASI SE JEN VAZBA BEZ POJISTKY. Appka je psana obranne: skoro kazde
    #   volani ciziho modulu se nejdriv zepta, jestli tam je (`if (window.X)`,
    #   `typeof window.X !== 'function'`, `!!(window.X && ...)`). Takova vazba je
    #   v Zakladu v poradku — modul proste neni a vetev se preskoci; presne pro
    #   tenhle pripad je tam ta kontrola napsana. Vypisovat i je znamena utopit
    #   ten jeden skutecny nalez v tuctu znamych (pri prvnim behu jich bylo 12 a
    #   ošetřených bylo VSECH DVANACT).
    def strezeno(radek_txt, jm):
        j = re.escape(jm)
        return re.search(
            r"typeof\s+window\.%s|window\.%s\s*(&&|\?|\|\|)|(if\s*\(\s*|!!\(\s*|&&\s*)window\.%s\b" % (j, j, j),
            radek_txt) is not None

    nalezy = []
    for f in sorted(zaklad_soubory):
        src = read(f)
        radky = src.split('\n')
        for jm, kde in sorted(vystavuje.items()):
            # `window.X` nebo hole `X(` — hole jmeno hleda jen tehdy, kdyz zacina
            # na typicky prefix appky, jinak by to chytalo bezne promenne
            vzory = [r"window\.%s\b" % re.escape(jm)]
            if jm.startswith('ag') or jm.startswith('AG') or jm.startswith('open'):
                vzory.append(r"(?<![\w$.])%s\s*\(" % re.escape(jm))
            hotovo = False
            for v in vzory:
                if hotovo:
                    break
                for m in re.finditer(v, src):
                    ci = src.count('\n', 0, m.start())
                    txt = radky[ci] if ci < len(radky) else ''
                    pred = txt[:m.start() - (src.rfind('\n', 0, m.start()) + 1)]
                    if '//' in pred or pred.lstrip().startswith('*'):
                        continue                       # jen komentar, ne volani
                    okoli = src[max(0, m.start() - 40):m.start()]
                    if re.search(r"(var|let|const|function)\s*$", okoli):
                        continue                       # vlastni definice tehoz nazvu
                    # Pojistka byva o radek nebo dva VYS, ne na tomtez radku:
                    #   if (typeof window.getStoredData !== 'function') return null;
                    #   var d = window.getStoredData();          <- tohle je ten nalez
                    # Proto se kouka i do osmi predchozich radku. Sirsi okno uz by
                    # zacalo omlouvat vazby, ktere s tou hlidkou nemaji nic spolecneho.
                    if any(strezeno(radky[j], jm) for j in range(max(0, ci - 8), ci + 1)):
                        continue                       # vazba s pojistkou = v poradku
                    nalezy.append((f, ci + 1, jm, kde))
                    hotovo = True
                    break

    # Vytrid opakovani teze dvojice soubor+global
    videno = set()
    unikat = []
    for f, radek, jm, kde in nalezy:
        if (f, jm) in videno:
            continue
        videno.add((f, jm))
        unikat.append((f, radek, jm, kde))

    out = sys.stdout
    out.write('Pro modulu s vlastnim souborem: %d\n' % len(pro_soubory))
    out.write('Souboru, ktere v Zakladu zustavaji: %d\n' % len(zaklad_soubory))
    out.write('Globalu, ktere Pro moduly vystavuji: %d\n\n' % len(vystavuje))

    if unikat:
        out.write('ZAKLAD SAHA NA PRO MODULY (%d mist):\n' % len(unikat))
        for f, radek, jm, kde in unikat:
            out.write('  %s:%d  ->  window.%s  (definuje %s)\n' % (f, radek, jm, kde))
        out.write('\nCO S TIM: bud ten globál obalit kontrolou (`if (window.X) ...`),\n'
                  'nebo modul z Pro presunout do Zakladu, nebo tu vazbu zrusit.\n')
        return 1

    out.write('OK - zadny modul ze Zakladu nesaha na Pro modul.\n')
    return 0


if __name__ == '__main__':
    if sys.version_info[0] >= 3:
        try:
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    sys.exit(main())
