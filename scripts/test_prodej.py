#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ===== QTRIG - PRODEJ PRO: karta koupe, zkouska zdarma, konzole Lide a prodej ==
# PROC TENHLE TEST EXISTUJE: koupe Pro je prvni misto v appce, kde chyba stoji
# uzivatele penize nebo vlastnika zakaznika. Server ma vlastni test
# (scripts/test_prodej_worker.py); tady se appka SPOUSTI v Chromiu a server se
# podvrhne (ctx.route), aby se dalo overit, co clovek doopravdy vidi a co appka
# doopravdy posle:
#
#   A) Karta Verze Pro v Zakladu ma tlacitko Koupit; v appce z Google Play (TWA)
#      ho NEMA - pravidla Play zakazuji vlastni platbu v appce z obchodu.
#   B) Klepnuti na Koupit donacte js/pro-koupe.js a ukaze cenik (mesic/rok),
#      zkousku zdarma a souhlas s podminkami. Bez souhlasu se objednavka nezalozi.
#   C) Se souhlasem se posle POST /objednavky s vybranym produktem a vykresli se
#      QR platba + udaje (VS, IBAN, zprava). „Uz jsem zaplatil" po zaplaceni na
#      serveru rozsviti Pro v telefonu HNED (agUcet_v1 + AGLic), ne az za minutu.
#   D) Zkouska zdarma: POST /zkouska a Pro se rozsviti; zamky zmizi.
#   E) Vypnuty prodej (bez IBAN): zadne tlacitko Zaplatit, jen vysvetleni.
#   F) Konzole vlastnika „Lide a prodej": seznam uctu, detail, +rok posle
#      /owner/tarif {dni:365}, Zablokovat posle /owner/blokace {disabled:1};
#      zalozka Objednavky: Zaplaceno posle /owner/objednavky/<vs>/zaplaceno,
#      nezarazena platba jde priradit kodem uctu.
#   G) podminky.html existuje a rika to, co karta slibuje (§ 1837 pism. l).
#
# Pouziti (z korene repa):  python scripts/test_prodej.py [port]
# Navratovy kod: 0 = vse OK, 1 = aspon jedna vada.
# ==============================================================================
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8991
URL = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot

API = 'https://ar-geodet-api.ar-geodet.workers.dev'

# Prihlaseny ucet + token, aby cloudFetch vubec sel na server (podvrzeny).
BOOT = boot() + """
localStorage.setItem('agFirmaTok_v1', JSON.stringify({ token: 'x.y', userId: 'test-user-1' }));
localStorage.removeItem('agProdej_v1');
localStorage.removeItem('agTwa_v1');
"""
BOOT_TWA = BOOT + "localStorage.setItem('agTwa_v1', '1');"
BOOT_OWNER = BOOT + "localStorage.setItem('agFbKey_v1', 'klic-vlastnika-aspon-24-znaku-dlouhy');"

PRODEJ = {
    'produkty': [{'k': 'mesic', 'nazev': 'Měsíc', 'dni': 30, 'cena': 149}, {'k': 'rok', 'nazev': 'Rok', 'dni': 365, 'cena': 990}],
    'iban': 'CZ6508000000192000145399', 'ucet': '19-2000145399/0800', 'prijemce': 'QTRIG',
    'zapnuto': True, 'automat': True, 'zkouska': {'dni': 3, 'pouzita': False, 'kdy': 0}
}

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)[:300]) if detail != '' else ''))


def server():
    global URL
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % port
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                # ⚠ NA PORTU MUZE SEDET CIZI SERVER (souběžná session testuje jiný
                #   strom) — pak by se testoval cizí kód. Náš strom se pozná podle
                #   souboru, který jinde není.
                urllib.request.urlopen(u.replace('index.html', 'js/pro-koupe.js'), timeout=1).read(64)
                URL = u
                return srv
            except urllib.error.HTTPError:
                break
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None


class Server(object):
    """Podvrzeny worker: stav objednavky a tarifu drzi v pameti, zapisuje, co dostal."""

    def __init__(self, prodej=None):
        self.prodej = json.loads(json.dumps(prodej or PRODEJ))
        self.objednavky = []
        self.tarif = 'zaklad'
        self.tarifDo = 0
        self.log = []

    def moje(self):
        return {'objednavky': self.objednavky, 'prodej': self.prodej, 'tarif': self.tarif, 'tarifDo': self.tarifDo}

    async def handle(self, route):
        req = route.request
        path = req.url.replace(API, '').split('?')[0]
        body = None
        try:
            body = json.loads(req.post_data) if req.post_data else None
        except Exception:
            body = None
        self.log.append((req.method, path, body))
        st, data = 404, {'error': 'nic'}
        if path == '/objednavky/moje':
            st, data = 200, self.moje()
        elif path == '/objednavky' and req.method == 'POST':
            if not self.prodej.get('zapnuto'):
                st, data = 503, {'error': 'Prodej ještě není zapnutý.'}
            else:
                pr = [p for p in self.prodej['produkty'] if p['k'] == (body or {}).get('produkt', 'rok')][0]
                o = {'vs': 12345678, 'castka': pr['cena'], 'dni': pr['dni'], 'created': 1, 'stav': 'ceka', 'zaplaceno': 0,
                     'msg': 'QTRIG PRO TESTACC1',
                     'spayd': 'SPD*1.0*ACC:CZ6508000000192000145399*AM:%d.00*CC:CZK*X-VS:12345678*MSG:QTRIG PRO TESTACC1' % pr['cena']}
                self.objednavky = [o]
                st, data = 200, {'objednavka': o, 'prodej': self.prodej, 'tarif': self.tarif, 'tarifDo': self.tarifDo}
        elif path == '/zkouska' and req.method == 'POST':
            self.tarif = 'pro'; self.tarifDo = int(time.time() * 1000) + 3 * 864e5
            self.prodej['zkouska']['pouzita'] = True
            st, data = 200, {'ok': True, 'tarif': 'pro', 'tarifDo': self.tarifDo, 'dni': 3}
        elif path.startswith('/objednavky/') and req.method == 'DELETE':
            self.objednavky = []
            st, data = 200, {'ok': True}
        elif path == '/owner/ucty':
            st, data = 200, {'ucty': [
                {'id': 'acc1', 'code': 'K7QM3XP2', 'name': 'Jan Novák', 'tarif': 'zaklad', 'tarif_do': None, 'disabled': 0,
                 'created': 1, 'last_login': 2, 'trial_ts': None, 'tarifPlati': False,
                 'prostory': [{'nazev': 'Geo s.r.o.', 'kod': 'ABCDEF', 'role': 'admin', 'vlastni': False, 'archiv': False, 'lidi': 3, 'lastLogin': 2},
                              {'nazev': None, 'kod': None, 'role': 'admin', 'vlastni': True, 'archiv': False, 'lidi': 1, 'lastLogin': 2}],
                 'aktivita': int(time.time() * 1000) - 3600e3, 'akcí30d': 12, 'objednavky': {'n': 1, 'zaplaceno': 0, 'ceka': 1}},
                {'id': 'acc2', 'code': 'ZZZZ2222', 'name': 'Petra Malá', 'tarif': 'pro', 'tarif_do': int(time.time() * 1000) + 9e8, 'disabled': 0,
                 'created': 1, 'last_login': 2, 'trial_ts': 5, 'tarifPlati': True, 'prostory': [], 'aktivita': 0, 'akcí30d': 0,
                 'objednavky': {'n': 0, 'zaplaceno': 0, 'ceka': 0}}
            ], 'prodej': self.prodej}
        elif path == '/owner/objednavky':
            st, data = 200, {'objednavky': [
                {'vs': 12345678, 'acc_id': 'acc1', 'code': 'K7QM3XP2', 'jmeno': 'Jan Novák', 'amount': 990, 'dni': 365, 'created': 1,
                 'paid_ts': None, 'paid_by': None, 'cancelled': 0}],
                'pohyby': [{'id': '555', 'ts': 1, 'castka': 990, 'mena': 'CZK', 'vs': '', 'msg': 'neco', 'nazev': 'Neznámý', 'stav': 'nezarazeno'}],
                'fio': {'nastaveno': True, 'posledniOk': int(time.time() * 1000)}, 'prodej': self.prodej}
        elif path in ('/owner/tarif', '/owner/blokace') or path.endswith('/zaplaceno') or path.endswith('/priradit') or path == '/owner/fio/zkontrolovat':
            st, data = 200, {'ok': True}
        elif path == '/feedback' and req.method == 'POST':
            st, data = 200, {'ok': True, 'ts': 1}
        elif path == '/feedback' and req.method == 'GET':
            st, data = 200, {'messages': [
                {'id': 7, 'ts': 1, 'kind': 'pro', 'txt': 'Chci Pro na protokoly.', 'contact': 'jan@example.cz',
                 'meta': json.dumps({'ucet': 'K7QM3XP2', 'zadost': 'pro'}), 'who': 'Jan Novák · K7QM3XP2', 'done': 0},
                {'id': 8, 'ts': 1, 'kind': 'chyba', 'txt': 'neco jineho', 'contact': None, 'meta': None, 'who': None, 'done': 0}
            ], 'open': 2}
        elif path == '/feedback/done' and req.method == 'POST':
            st, data = 200, {'ok': True}
        elif path == '/config':
            st, data = 503, {'error': 'test'}
        await route.fulfill(status=st, content_type='application/json',
                            headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*'},
                            body=json.dumps(data, ensure_ascii=False))


async def nacti(page):
    for _ in range(4):
        try:
            await page.goto(URL, wait_until='domcontentloaded', timeout=45000)
            break
        except Exception:
            await page.wait_for_timeout(1500)
    await page.wait_for_timeout(2400)
    for _ in range(30):
        if await page.evaluate("() => !!window.AGProZamky && !!window.AGLic"):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(400)
    await page.evaluate("() => { var w=document.getElementById('welcome-screen'); if(w) w.style.display='none'; }")
    await page.wait_for_timeout(700)


async def pockej(page, js, n=30, krok=300):
    for _ in range(n):
        try:
            if await page.evaluate(js):
                return True
        except Exception:
            pass
        await page.wait_for_timeout(krok)
    return False


async def nova(ctx, srv, boot_js):
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text) if m.type == 'error' else None)
    await page.add_init_script(boot_js)
    await ctx.route(API + '/**', srv.handle)
    await nacti(page)
    # potvrzovaci dialogy odklepnout, at test nestoji na modalu
    await page.evaluate("() => { window.agAsk = function () { return Promise.resolve(true); }; window.confirm = function () { return true; }; }")
    return page, chyby


async def bezi(ctx):
    # ---- A) tlacitko Koupit v karte ------------------------------------------------
    # 12. 9. 2026: karta je v odlozenem js/pro-karta.js a Koupit se ukaze AZ KDYZ server
    # rekne prodej.zapnuto (tiche GET /objednavky/moje po otevreni karty). Do te doby
    # je hlavni tlacitko „Pozadat o Pro" — Pro se neprodava samo, vlastnik ho zapina
    # na zadost (rozhodnuti uzivatele 12. 9. 2026).
    srv = Server()
    page, chyby = await nova(ctx, srv, BOOT)
    await page.evaluate("() => AGProZamky.prehled()")
    ok('A0 karta se otevre a nacte (js/pro-karta.js) s tlacitkem Pozadat o Pro',
       await pockej(page, "() => !!window.AGProKarta && !!document.querySelector('#ag-pro-modal.on .agp-zadost')"))
    vid = await pockej(page, "() => !!document.querySelector('#ag-pro-modal .agp-koupit')")
    txt = await page.evaluate("() => (document.querySelector('#ag-pro-modal .agp-koupit')||{}).textContent || ''")
    ok('A1 se zapnutym prodejem na serveru karta ukaze i Koupit', vid and 'koupit' in txt.lower(), txt)
    ok('A1b cenik se pri tom ulozil (agProdej_v1.prodej.zapnuto)', await page.evaluate("() => { var c=JSON.parse(localStorage.getItem('agProdej_v1')||'null'); return !!(c && c.prodej && c.prodej.zapnuto); }"))
    ok('A1c karta ma krizek a JE pres celou obrazovku', await page.evaluate("() => { var m=document.getElementById('ag-pro-modal'); var r=m.getBoundingClientRect(); return !!m.querySelector('.agp-x') && r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }"))

    # ---- B) cenik po klepnuti -----------------------------------------------------
    await page.click('#ag-pro-modal .agp-koupit')
    nacteno = await pockej(page, "() => !!window.AGProKoupe && !!document.querySelector('#ag-koupe-modal.on .agk-pr')")
    ok('B1 Koupit donacte js/pro-koupe.js a otevre cenik', nacteno)
    ceny = await page.evaluate("() => Array.from(document.querySelectorAll('#ag-koupe-modal .agk-pr b')).map(function(b){return b.textContent;})")
    ok('B2 cenik ukazuje mesic 149 Kc a rok 990 Kc', ceny == ['149 Kč', '990 Kč'], ceny)
    ok('B3 rok je predvybrany a ma stitek usetris', await page.evaluate("() => { var r=document.querySelector('#ag-koupe-modal .agk-pr[data-pr=rok]'); return r && r.classList.contains('on') && /ušetříš/.test(r.textContent); }"))
    ok('B4 nabizi zkousku zdarma na 3 dny', await page.evaluate("() => /3 dny zdarma/.test((document.querySelector('#agk-zkouska')||{}).textContent||'')"))
    ok('B5 souhlas s podminkami je nezaskrtnuty a odkazuje na podminky.html', await page.evaluate("() => { var c=document.querySelector('#agk-souhlas'); var a=document.querySelector('#ag-koupe-modal label.agk-souhlas a'); return c && !c.checked && a && /podminky\\.html$/.test(a.getAttribute('href')); }"))
    await page.click('#agk-objednat')
    await page.wait_for_timeout(300)
    ok('B6 bez souhlasu se objednavka nezalozi (hlaska, zadny POST)',
       await page.evaluate("() => /souhlas/i.test((document.querySelector('#ag-koupe-modal .agk-hl')||{}).textContent||'')")
       and not [l for l in srv.log if l[1] == '/objednavky' and l[0] == 'POST'], srv.log[-2:])

    # ---- C) objednavka a QR ---------------------------------------------------------
    await page.click('#ag-koupe-modal .agk-pr[data-pr=mesic]')
    await page.wait_for_timeout(200)
    await page.check('#agk-souhlas')
    await page.click('#agk-objednat')
    qr = await pockej(page, "() => !!document.querySelector('#ag-koupe-modal #agk-qr img')", 40)
    posty = [l for l in srv.log if l[1] == '/objednavky' and l[0] == 'POST']
    ok('C1 POST /objednavky s vybranym produktem (mesic)', len(posty) == 1 and (posty[0][2] or {}).get('produkt') == 'mesic', posty)
    ok('C2 vykreslil se QR kod platby', qr)
    udaje = await page.evaluate("() => (document.querySelector('#ag-koupe-modal .agk-udaje')||{}).textContent||''")
    ok('C3 udaje: castka 149, VS 12345678, IBAN, zprava s kodem uctu',
       '149 Kč' in udaje and '12345678' in udaje and 'CZ6508000000192000145399' in udaje and 'QTRIG PRO TESTACC1' in udaje, udaje[:200])
    ok('C4 rika, ze se Pro zapne samo (automat)', await page.evaluate("() => /samo/.test((document.querySelector('#ag-koupe-modal .agk-pozn')||{}).textContent||'')"))
    ok('C5 pred zaplacenim Pro NENI', not await page.evaluate("() => AGLic.isPro()"))
    # server: zaplaceno
    srv.objednavky[0]['stav'] = 'zaplacena'; srv.objednavky[0]['spayd'] = ''
    srv.tarif = 'pro'; srv.tarifDo = int(time.time() * 1000) + 30 * 864e5
    await page.click('#agk-overit')
    hotovo = await pockej(page, "() => /dorazila/.test((document.querySelector('#ag-koupe-modal .agk-hl')||{}).textContent||'')", 30)
    ok('C6 „Uz jsem zaplatil" po zaplaceni na serveru hlasi dorazeni', hotovo)
    ok('C7 Pro se rozsvitilo HNED (AGLic i agUcet_v1)', await page.evaluate("() => AGLic.isPro() && JSON.parse(localStorage.getItem('agUcet_v1')).tarif === 'pro'"))
    ok('C8 karta rika, do kdy Pro plati', await page.evaluate("() => /Pro máš zapnuté do/.test((document.querySelector('#ag-koupe-modal .agk-pod')||{}).textContent||'')"))
    ok('C9 cenik se ulozil pro offline (agProdej_v1)', await page.evaluate("() => { var c=JSON.parse(localStorage.getItem('agProdej_v1')||'null'); return !!(c && c.prodej && c.prodej.produkty.length===2); }"))
    await page.close()

    # ---- A2) TWA: zadny prodej --------------------------------------------------
    srv = Server()
    page, _ = await nova(ctx, srv, BOOT_TWA)
    await page.evaluate("() => AGProZamky.prehled()")
    await page.wait_for_timeout(300)
    await pockej(page, "() => !!window.AGProKarta && !!document.querySelector('#ag-pro-modal.on .agp-zadost')")
    await page.wait_for_timeout(600)
    ok('A2 v appce z Google Play (TWA) tlacitko Koupit NENI', await page.evaluate("() => !document.querySelector('#ag-pro-modal .agp-koupit')"))
    ok('A3 pole na klic v TWA zustava', await page.evaluate("() => !!document.querySelector('#ag-pro-modal #agp-klic')"))
    await page.close()

    # ---- Z) zadost o Pro ------------------------------------------------------------
    srv = Server(dict(PRODEJ, zapnuto=False, iban=''))
    page, chyby_z = await nova(ctx, srv, BOOT)
    await page.evaluate("() => AGProZamky.karta('dronview')")
    ok('Z1 zamceny nastroj: karta ma Pozadat o Pro a NE Koupit (prodej vypnuty)',
       await pockej(page, "() => !!document.querySelector('#ag-pro-modal.on .agp-zadost') && !document.querySelector('#ag-pro-modal .agp-koupit')"))
    await page.click('#ag-pro-modal .agp-zadost')
    ok('Z2 formular zadosti (jmeno predvyplnene z uctu, kontakt, zprava)',
       await pockej(page, "() => document.querySelector('#agp-z-jm') && document.querySelector('#agp-z-jm').value === 'Tester' && !!document.querySelector('#agp-z-kon') && !!document.querySelector('#agp-z-tx')"))
    await page.click('#ag-pro-modal .agp-z-poslat')
    await page.wait_for_timeout(200)
    ok('Z3 bez kontaktu se neposle a rekne proc', await page.evaluate("() => /kontakt/i.test(document.getElementById('agp-z-hl').textContent)") and not [l for l in srv.log if l[1] == '/feedback'])
    await page.fill('#agp-z-kon', 'jan@example.cz')
    await page.fill('#agp-z-tx', 'Potrebuju dronove zony.')
    await page.click('#ag-pro-modal .agp-z-poslat')
    posl = await pockej(page, "() => !!document.querySelector('#ag-pro-modal .agp-done')")
    fb = [l for l in srv.log if l[1] == '/feedback']
    ok('Z4 POST /feedback kind=pro, kontakt, kod uctu v meta a v who', posl and fb and fb[-1][2].get('kind') == 'pro' and fb[-1][2].get('contact') == 'jan@example.cz'
       and (fb[-1][2].get('meta') or {}).get('ucet') == 'TESTACC1' and 'TESTACC1' in (fb[-1][2].get('who') or ''), fb[-1:] if fb else srv.log[-3:])
    ok('Z5 po odeslani si appka pamatuje datum zadosti', await page.evaluate("() => !!localStorage.getItem('agProZadost_v1')"))
    await page.click('#ag-pro-modal .agp-z-ok')
    await page.evaluate("() => AGProZamky.prehled()")
    ok('Z6 karta priste rika, ze zadost uz odesla', await pockej(page, "() => /odešla/.test((document.querySelector('#ag-pro-modal .agp-zadost')||{}).textContent||'')"))
    await page.click('#ag-pro-modal .agp-x')
    ok('Z7 krizek kartu zavre', await pockej(page, "() => !document.getElementById('ag-pro-modal').classList.contains('on')"))
    ok('Z8 zadna chyba v konzoli', not [c for c in chyby_z if 'pro-karta' in c or 'pro-zamky' in c], chyby_z[:3])
    await page.close()

    # ---- D) zkouska zdarma --------------------------------------------------------
    srv = Server()
    page, chyby_d = await nova(ctx, srv, BOOT)
    n0 = await page.evaluate("() => { AGProZamky.oznac(); return document.querySelectorAll('[data-agpro=\\\"1\\\"]').length; }")
    await page.evaluate("() => AGProZamky.koupit()")
    je = await pockej(page, "() => !!document.querySelector('#agk-zkouska')")
    ok('D0 karta nabizi zkousku', je, '' if je else await page.evaluate("() => { var m=document.getElementById('ag-koupe-modal'); return (m ? m.textContent : 'bez modalu').slice(0, 300) + ' | tarif=' + (JSON.parse(localStorage.getItem('agUcet_v1')||'{}').tarif) + ' | pro=' + AGLic.isPro() + ' | cache=' + localStorage.getItem('agProdej_v1'); }"))
    if je:
        await page.click('#agk-zkouska')
    zap = await pockej(page, "() => AGLic.isPro()", 30)
    ok('D1 zkouska posle POST /zkouska a Pro se rozsviti', zap and [l for l in srv.log if l[1] == '/zkouska'], srv.log[-3:])
    await page.wait_for_timeout(400)
    n1 = await page.evaluate("() => { AGProZamky.oznac(); return document.querySelectorAll('[data-agpro=\\\"1\\\"]').length; }")
    ok('D2 zamky zmizely (pred %d, po %d)' % (n0, n1), n0 > 0 and n1 == 0)
    ok('D3 hlaska rika, do kdy zkouska plati', await page.evaluate("() => /3 dny/.test((document.querySelector('#ag-koupe-modal .agk-hl')||{}).textContent||'')"))
    ok('D4 zkousku uz karta podruhe nenabizi', not await page.evaluate("() => !!document.querySelector('#agk-zkouska')"))
    await page.close()

    # ---- E) prodej vypnuty ---------------------------------------------------------
    srv = Server(dict(PRODEJ, zapnuto=False, iban=''))
    page, _ = await nova(ctx, srv, BOOT)
    await page.evaluate("() => AGProZamky.koupit()")
    await pockej(page, "() => !!document.querySelector('#ag-koupe-modal.on .agk-pr')")
    ok('E1 vypnuty prodej: zadne tlacitko Zaplatit, cenik ano', await page.evaluate("() => !document.querySelector('#agk-objednat') && document.querySelectorAll('#ag-koupe-modal .agk-pr').length === 2"))
    ok('E2 vysvetleni, ze se zatim plati klicem', await page.evaluate("() => /klíčem/.test((document.querySelector('#ag-koupe-modal .agk-pozn')||{}).textContent||'')"))
    await page.close()

    # ---- F) konzole vlastnika --------------------------------------------------------
    srv = Server()
    page, chyby_f = await nova(ctx, srv, BOOT_OWNER)
    await page.evaluate("() => AGLazy.need('js/prodej-konzole.js', function(){ AGProdej.open(); })")
    ok('F1 Lide a prodej se otevre a vypise ucty', await pockej(page, "() => document.querySelectorAll('#ag-pd-modal .pd-row[data-u]').length === 2"))
    ok('F2 radek nese jmeno, kod, firmu, tarif a aktivitu', await page.evaluate("() => { var r=document.querySelector('#ag-pd-modal .pd-row[data-u=acc1]').textContent; return /Jan Novák/.test(r) && /K7QM3XP2/.test(r) && /Geo s\\.r\\.o\\./.test(r) && /Základ/.test(r) && /před/.test(r); }"))
    ok('F3 ucet s Pro ukazuje „Pro do"', await page.evaluate("() => /Pro do/.test(document.querySelector('#ag-pd-modal .pd-row[data-u=acc2]').textContent)"))
    await page.click('#ag-pd-modal .pd-row[data-u=acc1]')
    await page.wait_for_timeout(200)
    ok('F4 detail: +mesic / +rok / navzdy / Zablokovat / Zpravy', await page.evaluate("() => { var d=document.querySelector('#ag-pd-modal .pd-det'); return d && d.querySelector('[data-pro][data-dni=\\\"30\\\"]') && d.querySelector('[data-pro][data-dni=\\\"365\\\"]') && d.querySelector('[data-pro][data-dni=\\\"0\\\"]') && d.querySelector('[data-blok]') && d.querySelector('[data-zpravy]'); }"))
    await page.click('#ag-pd-modal [data-pro][data-dni="365"]')
    await page.wait_for_timeout(600)
    tar = [l for l in srv.log if l[1] == '/owner/tarif']
    ok('F5 +rok posle /owner/tarif {tarif:pro, dni:365}', tar and tar[-1][2] == {'id': 'acc1', 'tarif': 'pro', 'dni': 365}, tar)
    # po akci se seznam nacte znovu a rozbaleny detail ZUSTAVA rozbaleny
    ok('F5b po akci zustava detail rozbaleny', await pockej(page, "() => !!document.querySelector('#ag-pd-modal .pd-det [data-blok]')"))
    await page.click('#ag-pd-modal [data-blok]')
    await page.wait_for_timeout(600)
    blk = [l for l in srv.log if l[1] == '/owner/blokace']
    ok('F6 Zablokovat posle /owner/blokace {disabled:1}', blk and blk[-1][2] == {'id': 'acc1', 'disabled': 1}, blk)
    await pockej(page, "() => !!document.querySelector('#ag-pd-modal [data-tab=obj]')")
    await page.click('#ag-pd-modal [data-tab=obj]')
    await page.wait_for_timeout(200)
    ok('F7 zalozka Objednavky: stav banky, objednavka, nezarazena platba', await page.evaluate("() => { var m=document.getElementById('ag-pd-modal'); return !!m.querySelector('.pd-fio') && !!m.querySelector('.pd-row[data-o=\\\"12345678\\\"]') && !!m.querySelector('.pd-nez'); }"))
    await page.click('#ag-pd-modal .pd-row[data-o="12345678"]')
    await page.wait_for_timeout(200)
    await page.click('#ag-pd-modal [data-zapl]')
    await page.wait_for_timeout(600)
    ok('F8 Zaplaceno posle /owner/objednavky/12345678/zaplaceno', [l for l in srv.log if l[1] == '/owner/objednavky/12345678/zaplaceno'])
    await pockej(page, "() => !!document.querySelector('#ag-pd-modal .pd-nez')")
    await page.fill('#ag-pd-modal [data-kod]', 'k7qm3xp2')
    await page.click('#ag-pd-modal [data-prirad]')
    await page.wait_for_timeout(600)
    pri = [l for l in srv.log if l[1].endswith('/priradit')]
    ok('F9 prirazeni nezarazene platby posle kod uctu velkymi', pri and pri[-1][2] == {'code': 'K7QM3XP2'}, pri)
    nase = [c for c in (chyby + chyby_d + chyby_f) if 'pro-koupe' in c or 'prodej-konzole' in c or 'AGProKoupe' in c or 'AGProdej' in c]
    # zalozka Zadosti (12. 9. 2026): zadost s kodem uctu -> Zapnout Pro navzdy -> /owner/tarif + /feedback/done
    await page.click('#ag-pd-modal [data-tab="zad"]')
    ok('F11 zalozka Zadosti ukaze jen zadosti o Pro (ne chyby) s uctem ze seznamu',
       await pockej(page, "() => document.querySelectorAll('#ag-pd-modal .pd-nez[data-zad]').length === 1 && /Jan Novák/.test(document.querySelector('#ag-pd-modal .pd-nez[data-zad]').textContent)"))
    await page.click('#ag-pd-modal [data-zpro][data-dni="0"]')
    await page.wait_for_timeout(600)
    tarZ = [l for l in srv.log if l[1] == '/owner/tarif']
    doneZ = [l for l in srv.log if l[1] == '/feedback/done']
    ok('F12 Zapnout Pro navzdy posle /owner/tarif {acc1, pro, 0} a zadost vyridi', tarZ and tarZ[-1][2] == {'id': 'acc1', 'tarif': 'pro', 'dni': 0} and doneZ and doneZ[-1][2].get('id') == 7, (tarZ[-1:], doneZ[-1:]))
    ok('F10 zadna chyba z novych modulu v konzoli', not nase, nase[:3])
    await page.close()

    # ---- G) podminky ------------------------------------------------------------------
    page = await ctx.new_page()
    await page.goto(URL.replace('index.html', 'podminky.html'), wait_until='domcontentloaded')
    t = await page.evaluate("() => document.body.textContent")
    ok('G1 podminky.html: predplatne, neobnovuje se samo, § 1837 pism. l, zkouska', all(x in t for x in ['předplatné', 'neobnovuje samo', '1837', 'Zkušební verze']))
    await page.close()


async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print('PRESKOCENO - playwright tu neni')
        return 0
    srv = server()
    if not srv:
        print('CHYBA - testovaci server nenabehl')
        return 1
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844},
                                      user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
                                                 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1',
                                      service_workers='block')
            await bezi(ctx)
            await b.close()
    finally:
        srv.terminate()

    spatne = [j for o, j in vysledky if not o]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    if spatne:
        print('VADY:')
        for j in spatne:
            print('  - ' + j)
        return 1
    print('OK - koupe Pro, zkouska i konzole Lide a prodej drzi.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
