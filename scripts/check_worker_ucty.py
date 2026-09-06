# -*- coding: utf-8 -*-
u"""Brána nad cloud/worker.js: drží nový model účtů a tarifů pohromadě?

⚠ PROČ STATICKY A NE SPUŠTĚNÍM: worker běží na Cloudflare Workers nad D1.
  Rozběhnout ho lokálně znamená Node + wrangler + SQLite binding; na tomhle
  stroji Node není a v CI by to znamenalo druhou sadu závislostí jen kvůli
  jednomu souboru. Nasazení hlídá check_worker_deployed.py (porovná `v`
  z /health), tenhle skript hlídá to, co by se v kódu dalo tiše rozbít.

CO SE HLÍDÁ — každá položka je chyba, která by se venku projevila až na penězích
nebo na cizích datech:

  1) PLACENÁ CESTA BEZ BRÁNY. Když se přidá nová placená routa a zapomene se na
     PLACENE_CESTY, prodává se něco, co dostane každý zdarma.
  2) BRÁNA AŽ ZA ROUTOU. Tarif se musí vyhodnotit DŘÍV, než se placená cesta
     obslouží — jinak brána existuje, ale nikdy se k ní nedojde.
  3) TARIF PŘED ROLÍ. Sólo uživatel je ve svém prostoru admin, takže rolí projde
     na všechno. Kdyby se tarif kontroloval až po roli, měl by placené věci zdarma.
  4) ARCHIV, KTERÝ JDE ZAPSAT. Kdo z firmy odešel, nesmí do ní psát; jinak by
     bývalý zaměstnanec měnil firmě data.
  5) TOKEN BEZ ÚČTU. Bez `a` v tokenu by se tarif musel dohledávat jinak a
     přepnutí prostoru by ztratilo identitu.
  6) MIGRACE, KTERÁ MAŽE. ensureUctySchema smí jen přidávat — jediné DROP nebo
     DELETE v migraci znamená nevratnou ztrátu dat u živých firem.

Spuštění:  python scripts/check_worker_ucty.py
Návratový kód 1 = něco z toho neplatí.
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = os.path.join(ROOT, 'cloud', 'worker.js')

chyby = []


def hlaska(t):
    chyby.append(t)


def main():
    src = io.open(W, encoding='utf-8').read()

    # ---- kde ve zdroji stojí která brána ----------------------------------
    i_auth = src.find('const me = await auth(env, req);')
    i_tarif = src.find("if (placenaCesta(path) && me.tarif !== 'pro')")
    i_archiv = src.find("if (me.leftTs && req.method !== 'GET') {")
    if i_auth < 0:
        hlaska(u'nenalezeno volani auth() v hlavni vetvi — zmenil se tvar souboru?')
        return vypis()
    if i_tarif < 0:
        hlaska(u'CHYBI TARIFNI BRANA: `if (placenaCesta(path) && me.tarif !== \'pro\')`. '
               u'Bez ni je kazda placena cesta zdarma.')
    if i_archiv < 0:
        hlaska(u'CHYBI BRANA ARCHIVU — byvaly clen firmy by do ni mohl zapisovat.')

    # ---- 1) seznam placenych cest -----------------------------------------
    m = re.search(r'const PLACENE_CESTY = \[(.*?)\];', src, re.S)
    if not m:
        hlaska(u'nenalezen seznam PLACENE_CESTY.')
        return vypis()
    placene = re.findall(r"'([^']+)'", m.group(1))
    if not placene:
        hlaska(u'PLACENE_CESTY je prazdny — nic by se neplatilo.')

    # Kazda placena cesta musi mit ve workeru routu, jinak je to preklep.
    for p in placene:
        if ("path === '%s'" % p) not in src and ("path.indexOf('%s" % p) not in src \
                and ("path === '%s/" % p) not in src:
            # prefixove cesty (/watch) maji routy s lomitkem
            if not re.search(r"path === '%s/" % re.escape(p), src):
                hlaska(u'PLACENE_CESTY obsahuje %s, ale takova routa ve workeru neni '
                       u'(preklep? presunuta cesta?).' % p)

    # ---- 2) brana musi stat PRED obsluhou placenych cest -------------------
    # ⚠ POZOR NA FALESNY POPLACH: `path === '/watch/points'` se ve workeru
    #   vyskytuje i v PODMINCE, ktera omezuje token hodinek — a ta stoji pred
    #   tarifni branou zcela spravne. Za obsluhu routy se proto pocita jen radek,
    #   ktery zaroven vetvi podle metody (`req.method === ...`), tedy skutecny
    #   dispatch. Prvni verze tohohle skriptu na tom hlasila dve neexistujici vady.
    if i_tarif > 0:
        pozice = 0
        for radek in src.split('\n'):
            konec = pozice + len(radek) + 1
            jeDispatch = ('req.method' in radek and 'path ===' in radek) \
                or radek.strip().startswith("if (path === '")
            if jeDispatch and pozice < i_tarif:
                for p in placene:
                    if re.search(r"path === '%s(?:/[\w-]+)?'" % re.escape(p), radek):
                        # /watch/pair a /watch/hello jsou schvalne PRED prihlasenim
                        # (parovani hodinek na kod, bez tokenu) — tarif se u nich
                        # vymaha az pri praci s daty.
                        if '/watch/pair' in radek or '/watch/hello' in radek:
                            continue
                        hlaska(u'placena cesta se obsluhuje na pozici %d, tedy PRED tarifni '
                               u'branou (%d) — brana by se u ni nikdy neuplatnila:\n      %s'
                               % (pozice, i_tarif, radek.strip()[:120]))
            pozice = konec

    # ---- 3) tarif se vyhodnocuje pred rolí ---------------------------------
    i_role = src.find("if (me.role !== 'admin') return err(403, 'Jen admin.');", i_auth)
    if i_tarif > 0 and i_role > 0 and i_tarif > i_role:
        hlaska(u'tarifni brana stoji AZ ZA prvni kontrolou role. Solo uzivatel je ve svem '
               u'prostoru admin, takze by rolí prosel na placene veci zdarma.')

    # ---- 4) archiv je jen ke cteni ----------------------------------------
    if i_archiv > 0:
        usek = src[i_archiv:i_archiv + 900]
        # ⚠ Prepinac prostoru musi zustat prujezdny i z archivu: prepnuti i vstup
        #   do firmy jsou POST, takze by je zakaz zapisu zavrel a clovek by se
        #   z archivovaneho prostoru UZ NEDOSTAL VEN. (Presne to tu jednu verzi bylo.)
        if "path !== '/spaces'" not in usek:
            hlaska(u'brana archivu nepousti /spaces/* — kdo se prihlasi do archivu, '
                   u'nedostane se z nej ven (prepnuti prostoru je POST).')
        # a cteni musi byt orezane casem odchodu, jinak by byvaly clen videl,
        # co firma namerila po jeho odchodu
        if 'me.leftTs ||' not in src:
            hlaska(u'archiv se necti orezany casem odchodu (`me.leftTs || …` v dotazech) — '
                   u'byvaly clen by videl i to, co firma namerila potom.')

    # ---- 5) token nese ucet ------------------------------------------------
    if not re.search(r'async function makeToken\(env, user, accId\)', src):
        hlaska(u'makeToken uz nebere id uctu — token by ztratil identitu pri prepnuti prostoru.')
    if 'p.a = accId || user.acc_id' not in src:
        hlaska(u'makeToken nezapisuje `a` (id uctu) do tokenu.')

    # ---- 6) migrace smi jen pridavat ---------------------------------------
    m = re.search(r'async function ensureUctySchema\(env\) \{(.*?)\n\}', src, re.S)
    if not m:
        hlaska(u'nenalezena ensureUctySchema — nova schemata by se na server nedostala.')
    else:
        telo = m.group(1)
        for zakazane in ('DROP ', 'DELETE ', 'TRUNCATE'):
            if zakazane in telo.upper():
                hlaska(u'ensureUctySchema obsahuje %s — migrace smi jen PRIDAVAT. '
                       u'Bezi automaticky na zive databazi.' % zakazane.strip())
        for sl in ('acc_id', 'left_ts', 'own'):
            if sl not in telo:
                hlaska(u'ensureUctySchema nepridava sloupec users.%s.' % sl)
        if 'CREATE TABLE IF NOT EXISTS accounts' not in telo:
            hlaska(u'ensureUctySchema nezaklada tabulku accounts.')

    # ---- 7) nove routy existuji -------------------------------------------
    for cesta in ('/register', '/spaces', '/spaces/switch', '/spaces/join',
                  '/spaces/leave', '/spaces/archiv-pryc', '/owner/tarif'):
        if ("path === '%s'" % cesta) not in src:
            hlaska(u'chybi routa %s.' % cesta)

    # ---- 8) prihlaseni kodem uctu ------------------------------------------
    if 'kod.length === 8' not in src:
        hlaska(u'prihlaseni nerozlisuje osmiznakovy kod uctu od sestiznakoveho kodu firmy.')

    return vypis()


def vypis():
    if chyby:
        sys.stdout.write(u'CHYBY (%d):\n' % len(chyby))
        for c in chyby:
            sys.stdout.write(u'  - ' + c + u'\n')
        return 1
    sys.stdout.write(u'OK - ucty, tarify a archiv v cloud/worker.js drzi pohromade.\n')
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    sys.exit(main())
