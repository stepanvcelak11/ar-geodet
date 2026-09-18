# -*- coding: utf-8 -*-
u"""Regrese k rozhodnutí z 15. 9. 2026 večer (v332): NÁSTROJE JAKO LISTOVÁNÍ.

  A  PÁSEK SLOVES + STRÁNKY: první stránka Moje, pak slovesa z registru (jedno = jedna
     stránka), žádná stránka nepřesahuje displej o víc než ~jednu obrazovku; okno se
     otevírá na Moje; AGUkony.go() přepíná; klávesy ←/→ listují
  B  MOJE: Pokračovat, pás „Co dnes děláš" (rezim-prace) je UVNITŘ Moje, ★ Připnuté
     (hvězdička v řádku připne/odepne), u připnutého je vidět gesto / „+ gesto"
  C  ROZCESTNÍK se rozbalí NA MÍSTĚ (řádek › → položky pod ním), sbalený nemá položky v DOM
  D  ZÁKLAD: zamčené Pro nástroje NEJSOU ve slovesech, jsou na poslední stránce „Pro"
     (se slovesem v titulku); v Pro tarifu stránka Pro NENÍ
  E  KOLEČKO NÁSTROJŮ PRYČ: soubor ani <script> neexistují, sw.js ho necachuje,
     AGKolecko není; gesta žijí dál (AGGesta.assignFor, AGUkony.has)

Spuštění:  python scripts/test_v332.py [port]
"""
import io
import os
import re
import sys
import json
import asyncio
import subprocess
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from ag_boot import boot  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9131)
SNIMKY = '--snimky' in sys.argv
vysledky = []
LAT, LNG = 50.0755, 14.4378


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


def server(port):
    for pokus in range(6):
        p = port + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % p
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(p)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                break
            except Exception:
                time.sleep(0.4)
        # ⚠ Port může držet server JINÉ session nad jiným stromem — ověřit, že na
        #   portu běží TENTO strom (listování má v seznamu úkonů pásek sloves).
        try:
            t = urllib.request.urlopen('http://127.0.0.1:%d/js/nastroje-ukony.js' % p, timeout=2).read().decode('utf-8', 'replace')
            if 'ag-uk-tabs' in t and srv.poll() is None:
                return srv, u
        except Exception:
            pass
        srv.terminate()
    return None, None


async def route_vse(route, request):
    u = request.url
    if '127.0.0.1' not in u and ('cuzk' in u or 'openstreetmap' in u or 'workers.dev' in u or 'tile' in u):
        try:
            return await route.abort()
        except Exception:
            return
    try:
        await route.continue_()
    except Exception:
        pass


async def stranka(br, url, init, chyby):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               device_scale_factor=2 if SNIMKY else 1,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)
    await page.route('**/*', route_vse)
    if init:
        await page.add_init_script(init)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    await page.wait_for_timeout(3000)
    return ctx, page


async def cekej(page, vyraz, kol=25):
    for _ in range(kol):
        if await page.evaluate('() => !!(' + vyraz + ')'):
            return True
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(400)
    return False


async def otevri_nastroje(page):
    await page.evaluate("() => { var m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; }")
    await page.wait_for_timeout(600)
    await page.evaluate('() => window.AGLazy && AGLazy.flush()')
    await page.wait_for_timeout(1600)
    await page.evaluate('() => window.AGUkony && AGUkony.rebuild()')
    await page.wait_for_timeout(300)


async def stav(page):
    return await page.evaluate("""() => {
        var host = document.getElementById('ag-uk-list'); if (!host) return null;
        var pages = host.querySelector('.ag-uk-pages');
        var out = { vidno: getComputedStyle(host).display !== 'none', cur: AGUkony.page(), ids: AGUkony.pages(),
                    tabs: Array.from(host.querySelectorAll('.ag-uk-tab')).map(t => t.textContent.trim()),
                    vybrany: (host.querySelector('.ag-uk-tab[aria-selected="true"]') || {}).textContent || '',
                    vyska: pages ? pages.offsetHeight : 0, scrollW: pages ? pages.scrollWidth : 0, clientW: pages ? pages.clientWidth : 0,
                    strany: {} };
        host.querySelectorAll('.ag-uk-page').forEach(function (p) {
            var id = p.getAttribute('data-page');
            out.strany[id] = { h: p.offsetHeight, radky: Array.from(p.querySelectorAll('.ag-uk-i')).map(r => r.getAttribute('data-k')).filter(Boolean),
                               zamky: p.querySelectorAll('.ag-uk-i[data-agpro="1"]').length, hlavicka: (p.querySelector('.ag-uk-h') || {}).textContent || '' };
        });
        return out;
    }""")


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        out_dir = os.path.join(ROOT, 'tmp', 'v332')
        if SNIMKY:
            os.makedirs(out_dir, exist_ok=True)

        # ================= PRO =================
        seed = ("localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');"
                "localStorage.setItem('agToolFavs_v1', JSON.stringify(['brutal-gps','openStakeoutModal']));"
                "localStorage.setItem('agLastTool_v1', JSON.stringify({ key: 'openCheckDist', label: 'Oměrné / kontrola', ts: Date.now() }));")
        ctx, page = await stranka(br, url, boot(tarif='pro') + seed, chyby)
        ok('0 appka nastartovala', await cekej(page, "document.body.classList.contains('app-started')"))
        await cekej(page, "window.AGUkony && window.AGReg", 30)
        await page.wait_for_timeout(1000)

        # ---- E: kolečko pryč ----------------------------------------------------------
        ok('E1 AGKolecko neexistuje, žádný <script> na kolecko-nastroju.js', await page.evaluate(
            "() => !window.AGKolecko && !document.querySelector('script[src*=\"kolecko\"],script[data-src*=\"kolecko\"]') && !document.getElementById('ag-kn')"))
        sw = io.open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
        ok('E2 sw.js kolečko necachuje, soubor v repu není', 'kolecko-nastroju' not in sw and not os.path.exists(os.path.join(ROOT, 'js', 'kolecko-nastroju.js')))
        ix = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
        ok('E3 index.html bez <script> kolečka', 'data-src="js/kolecko-nastroju.js"' not in ix and 'src="js/kolecko-nastroju.js"' not in ix)

        # ---- A: pásek + stránky ---------------------------------------------------------
        await otevri_nastroje(page)
        s = await stav(page)
        ok('A1 seznam úkonů stojí a je vidět (listování)', s and s['vidno'], s)
        if s:
            verbs = await page.evaluate("() => AGReg.groups().map(g => g.t)")
            ok('A2 první stránka je Moje a okno se na ní otevřelo', s['ids'][0] == 'moje' and s['cur'] == 'moje' and s['vybrany'].endswith('Moje'), (s['ids'][:3], s['cur'], s['vybrany']))
            # 18. 9. 2026 (N3): Před výjezdem, Firma a papíry, Příručka a výpočty a Učit se jsou sekce na stránce „Další"
            ok('A3 terénní slovesa mají stránku v pořadí registru; 4 kancelářská jsou sekce na „Další"', [i for i in s['ids'] if i in verbs] == [v for v in verbs if v in s['ids']] and len([i for i in s['ids'] if i in verbs]) == 8
               and not any(v in s['ids'] for v in ('Před výjezdem', 'Firma a papíry', 'Příručka a výpočty', 'Učit se')) and 'dalsi' in s['ids'], s['ids'])
            ok('A3b stránka Další má sekce sloučených sloves (ag-uk-dalsi) s řádky', await page.evaluate("() => { var p = document.querySelector('.ag-uk-page[data-page=\"dalsi\"]'); var s = p ? p.querySelectorAll('.ag-uk-g.ag-uk-dalsi') : []; return s.length >= 3 && Array.from(s).every(x => x.querySelectorAll('.ag-uk-i').length > 0); }"))
            ok('A4 v Pro tarifu stránka „pro" NENÍ', 'pro' not in s['ids'], s['ids'])
            ok('A5 pás stránek roluje vodorovně (scrollWidth = N × šířka)', s['scrollW'] >= (len(s['ids']) - 0.5) * s['clientW'] and s['clientW'] > 200, (s['scrollW'], s['clientW'], len(s['ids'])))
            dlouhe = {k: v['h'] for k, v in s['strany'].items() if v['h'] > 1900}
            ok('A6 žádná stránka nepřesahuje ~2 obrazovky (dřív sloupec 4 470 px)', not dlouhe, dlouhe)
            ok('A7 výška pásu = výška aktivní stránky (Moje), ne nejvyšší', abs(s['vyska'] - s['strany']['moje']['h']) <= 2 and s['vyska'] < max(v['h'] for v in s['strany'].values()) + 3, (s['vyska'], {k: v['h'] for k, v in s['strany'].items()}))
            # přepnutí programem + klávesou
            await page.evaluate("() => AGUkony.go('Změřit', true)")
            await page.wait_for_timeout(500)
            s2 = await stav(page)
            ok('A8 AGUkony.go(„Změřit") přepne stránku, vybraný pásek i výšku', s2['cur'] == 'Změřit' and s2['vybrany'] == 'Změřit' and abs(s2['vyska'] - s2['strany']['Změřit']['h']) <= 2, (s2['cur'], s2['vybrany'], s2['vyska'], s2['strany']['Změřit']['h']))
            ok('A9 stránka Změřit má hlavičku s počtem a jen své nástroje', 'ZMĚŘIT' in s2['strany']['Změřit']['hlavicka'].upper() and 'openMeasureModal' in s2['strany']['Změřit']['radky'] and 'openStakeoutModal' not in s2['strany']['Změřit']['radky'], s2['strany']['Změřit'])
            await page.keyboard.press('ArrowRight')
            await page.wait_for_timeout(600)
            s3 = await stav(page)
            ok('A10 šipka → listuje na další sloveso', s3['cur'] == s['ids'][s['ids'].index('Změřit') + 1], (s3['cur'], s['ids']))
            # klepnutí na pásek
            await page.evaluate("() => Array.from(document.querySelectorAll('.ag-uk-tab')).find(t => t.getAttribute('data-page') === 'Vytyčit').click()")
            await page.wait_for_timeout(600)
            s4 = await stav(page)
            ok('A11 klepnutí na sloveso v pásku přepne stránku', s4['cur'] == 'Vytyčit', s4['cur'])
            if SNIMKY:
                await page.evaluate("() => AGUkony.go('moje', true)"); await page.wait_for_timeout(500)
                await page.screenshot(path=os.path.join(out_dir, 'pro-moje.png'))
                await page.evaluate("() => AGUkony.go('Změřit', true)"); await page.wait_for_timeout(500)
                await page.screenshot(path=os.path.join(out_dir, 'pro-zmerit.png'))

        # ---- B: Moje ------------------------------------------------------------------------
        await page.evaluate("() => AGUkony.go('moje', true)")
        await page.wait_for_timeout(400)
        b = await page.evaluate("""() => {
            var m = document.querySelector('.ag-uk-page[data-page="moje"]'); if (!m) return null;
            var fav = m.querySelector('.ag-uk-fav');
            return { pokracovat: !!m.querySelector('.ag-uk-now'), pokrText: (m.querySelector('.ag-uk-now') || {}).textContent || '',
                     rp: !!(document.getElementById('ag-rp-wrap') && m.contains(document.getElementById('ag-rp-wrap'))),
                     favRows: fav ? Array.from(fav.querySelectorAll('.ag-uk-i')).map(r => r.getAttribute('data-k')) : null,
                     hvezdy: fav ? fav.querySelectorAll('.ag-uk-star.on').length : 0,
                     gesta: fav ? Array.from(fav.querySelectorAll('.ag-uk-gest')).map(g => g.textContent.trim()) : [],
                     poradit: !!m.querySelector('.ag-uk-foot'), editbtn: (function () { var b = document.getElementById('ag-tp-editbtn'); return b ? getComputedStyle(b).display : 'none'; })() };
        }""")
        ok('B1 Moje: Pokračovat s naposledy použitým nástrojem nahoře', b and b['pokracovat'] and 'Oměrné' in b['pokrText'], b)
        # 18. 9. 2026 večer (Nastavení nanovo, volba 2B): js/rezim-prace.js je ODPOJENÝ — pás ani profil práce v Nastavení nejsou
        ok('B2 Moje: pás „Co dnes děláš" je výchozím stavem schovaný (prvek skrytý nebo mimo Moje)', b and (not b['rp'] or await page.evaluate("() => { var w = document.getElementById('ag-rp-wrap'); return !w || w.hidden; }")), b)
        ok('B2b rezim-prace odpojen: bez pásu, bez selectu profilu, bez záložky Profily', await page.evaluate("() => !window.AGRezimPrace && !document.getElementById('ag-rp-sel') && !document.getElementById('ag-rp-wrap') && !document.getElementById('tab-profily')"))
        ok('B3 Moje: ★ Připnuté = oba připnuté ze seedu, hvězdičky svítí', b and b['favRows'] == ['brutal-gps', 'openStakeoutModal'] and b['hvezdy'] == 2, b)
        ok('B4 Moje: u připnutých je gesto (výchozí ↓→ ↓↑ pro Přesnou GPS) nebo „+ gesto"', b and len(b['gesta']) == 2 and any('↓' in g and '↑' in g for g in b['gesta']) and any('gesto' in g for g in b['gesta']), b and b['gesta'])
        ok('B5 Moje: „Poradit, co použít" v patičce; tlačítko „Upravit oblíbené" schované', b and b['poradit'] and b['editbtn'] == 'none', b)
        # připnout hvězdičkou v řádku (na stránce Změřit) → objeví se v Moje
        await page.evaluate("() => AGUkony.go('Změřit', true)")
        await page.wait_for_timeout(300)
        await page.evaluate("() => document.querySelector('.ag-uk-page[data-page=\"Změřit\"] .ag-uk-i[data-k=\"startAreaMode\"] .ag-uk-star').click()")
        await page.wait_for_timeout(500)
        b2 = await page.evaluate("""() => ({ favs: JSON.parse(localStorage.getItem('agToolFavs_v1') || '[]'), cur: AGUkony.page(),
            vMoje: Array.from(document.querySelectorAll('.ag-uk-page[data-page="moje"] .ag-uk-fav .ag-uk-i')).map(r => r.getAttribute('data-k')),
            modalOpen: document.getElementById('tools-modal').style.display !== 'none' })""")
        ok('B6 hvězdička v řádku připne nástroj (klíč agToolFavs_v1), nespustí ho, stránka zůstává', b2['favs'] == ['brutal-gps', 'openStakeoutModal', 'startAreaMode'] and 'startAreaMode' in b2['vMoje'] and b2['cur'] == 'Změřit' and b2['modalOpen'], b2)
        await page.evaluate("() => document.querySelector('.ag-uk-page[data-page=\"Změřit\"] .ag-uk-i[data-k=\"startAreaMode\"] .ag-uk-star').click()")
        await page.wait_for_timeout(400)
        ok('B7 druhé klepnutí odepne', await page.evaluate("() => JSON.parse(localStorage.getItem('agToolFavs_v1')).length === 2"))
        # „?" otevře návod, nespustí nástroj
        await page.evaluate("() => document.querySelector('.ag-uk-page[data-page=\"Změřit\"] .ag-uk-i[data-k=\"openMeasureModal\"] .ag-uk-q').click()")
        await page.wait_for_timeout(600)
        q = await page.evaluate("() => ({ help: !!document.querySelector('#ag-tp-hm.open'), tools: document.getElementById('tools-modal').style.display !== 'none' })")
        ok('B8 „?" v řádku otevře návod a Nástroje zůstávají', q['help'] and q['tools'], q)
        await page.evaluate("() => { var h = document.querySelector('#ag-tp-hm'); if (h) h.classList.remove('open'); }")

        # ---- C: rozcestník na místě -------------------------------------------------------
        await page.evaluate("() => AGUkony.go('Přesné měření', true)")
        await page.wait_for_timeout(300)
        c0 = await page.evaluate("""() => { var p = document.querySelector('.ag-uk-page[data-page="Přesné měření"]');
            var row = p.querySelector('.ag-uk-i[data-k="opravit-gps"]'); var sub = p.querySelector('.ag-uk-sub[data-sub="opravit-gps"]');
            return { row: !!row, exp: row && row.getAttribute('aria-expanded'), subRows: sub ? sub.querySelectorAll('.ag-uk-i').length : -1, hidden: sub ? sub.hidden : null,
                     samostatne: !!p.querySelector('.ag-uk-i[data-k="korekce-z-mapy"]') }; }""")
        ok('C1 rozcestník „Opravit GPS" je jeden řádek se šipkou, sbalený bez položek v DOM', c0['row'] and c0['exp'] == 'false' and c0['subRows'] == 0 and c0['hidden'] and not c0['samostatne'], c0)
        h_pred = (await stav(page))['vyska']
        await page.evaluate("() => document.querySelector('.ag-uk-page[data-page=\"Přesné měření\"] .ag-uk-i[data-k=\"opravit-gps\"]').click()")
        await page.wait_for_timeout(500)
        c1 = await page.evaluate("""() => { var p = document.querySelector('.ag-uk-page[data-page="Přesné měření"]');
            var row = p.querySelector('.ag-uk-i[data-k="opravit-gps"]'); var sub = p.querySelector('.ag-uk-sub[data-sub="opravit-gps"]');
            return { exp: row.getAttribute('aria-expanded'), hidden: sub.hidden, klice: Array.from(sub.querySelectorAll('.ag-uk-i')).map(r => r.getAttribute('data-k')),
                     hubOkno: !!document.querySelector('#ag-th-ov.open'), tools: document.getElementById('tools-modal').style.display !== 'none' }; }""")
        ok('C2 klepnutí rozbalí položky pod řádkem (ne druhé okno), Nástroje zůstávají', c1['exp'] == 'true' and not c1['hidden'] and 'korekce-z-mapy' in c1['klice'] and 'ref-calibration' in c1['klice'] and not c1['hubOkno'] and c1['tools'], c1)
        h_po = (await stav(page))['vyska']
        ok('C3 výška pásu se po rozbalení přepočítá', h_po > h_pred + 40, (h_pred, h_po))
        # položka rozbaleného rozcestníku spustí nástroj stejnou cestou (klik na dlaždici)
        # spuštění = klik na PŮVODNÍ dlaždici v mřížce (stejná cesta jako všude) — chytíme ho v capture fázi a zastavíme
        await page.evaluate("""() => { window.__spusteno = []; document.addEventListener('click', function (e) {
            var t = e.target.closest && e.target.closest('#tools-modal .tool-tile'); if (t) { window.__spusteno.push(t.getAttribute('data-tool')); e.stopPropagation(); e.preventDefault(); } }, true); }""")
        await page.evaluate("() => document.querySelector('.ag-uk-sub[data-sub=\"opravit-gps\"] .ag-uk-i[data-k=\"ref-calibration\"]').click()")
        await page.wait_for_timeout(200)
        ok('C4 položka rozcestníku spouští klikem na svou dlaždici v mřížce', await page.evaluate("() => window.__spusteno.join(',') === 'ref-calibration'"), await page.evaluate("() => window.__spusteno"))
        if SNIMKY:
            await page.screenshot(path=os.path.join(out_dir, 'pro-rozcestnik.png'))
        # zavřít a znovu otevřít = zase Moje, rozcestník sbalený
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'none'; }")
        await page.wait_for_timeout(300)
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'flex'; }")
        await page.wait_for_timeout(700)
        c5 = await page.evaluate("""() => ({ cur: AGUkony.page(), exp: (document.querySelector('.ag-uk-i[data-k="opravit-gps"]') || {}).getAttribute && document.querySelector('.ag-uk-i[data-k="opravit-gps"]').getAttribute('aria-expanded') })""")
        ok('C5 po zavření a otevření okna zase Moje, rozcestník sbalený', c5['cur'] == 'moje' and c5['exp'] == 'false', c5)
        await ctx.close()

        # ================= ZÁKLAD =================
        ctx, page = await stranka(br, url, boot(tarif='zaklad') + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');", chyby)
        ok('D0 Základ nastartoval', await cekej(page, "document.body.classList.contains('app-started')"))
        await cekej(page, "window.AGUkony && window.AGProZamky", 30)
        await otevri_nastroje(page)
        await page.evaluate("() => window.AGProZamky && AGProZamky.oznac && AGProZamky.oznac()")
        await page.wait_for_timeout(300)
        d = await stav(page)
        ok('D1 v Základu je poslední stránka „pro" a v pásku je „Pro"', d and d['ids'][-1] == 'pro' and 'Pro' in d['tabs'], d and (d['ids'][-3:], d['tabs'][-2:]))
        if d:
            ve_slovesech = {k: v['zamky'] for k, v in d['strany'].items() if k not in ('pro',) and v['zamky']}
            ok('D2 ve slovesech ani v Moje NENÍ žádný zamčený řádek', not ve_slovesech, ve_slovesech)
            pro = d['strany']['pro']
            ok('D3 stránka Pro nese zamčené nástroje (≥ 20), všechny se zámkem', len(pro['radky']) >= 20 and pro['zamky'] == len(pro['radky']), (len(pro['radky']), pro['zamky']))
            capy = await page.evaluate("() => Array.from(document.querySelectorAll('.ag-uk-page[data-page=\"pro\"] .ag-uk-cap')).map(c => c.textContent)")
            ok('D4 na Pro jsou nástroje po slovesech (titulky Změřit, Vytyčit…)', 'Změřit' in capy and 'Vytyčit' in capy and len(capy) >= 6, capy)
            ok('D5 hlavička „Ve verzi Pro" + tlačítko „Co všechno umí Pro"', 'VE VERZI PRO' in pro['hlavicka'].upper() and await page.evaluate("() => !!Array.from(document.querySelectorAll('.ag-uk-page[data-page=\"pro\"] button')).find(b => /umí Pro/.test(b.textContent))"))
            ok('D6 Změřit v Základu má jen volné nástroje (Vzdálenost, Plocha; Oměrné schované 18. 9. 2026)', set(d['strany']['Změřit']['radky']) >= {'openMeasureModal', 'startAreaMode'} and 'openDmtVolume' not in d['strany']['Změřit']['radky'] and 'openCheckDist' not in d['strany']['Změřit']['radky'], d['strany']['Změřit']['radky'])
            # zamčené položky rozcestníku (kalibrace-hranou je Pro) nejsou v rozbalení, jsou na Pro (18. 9. 2026: rozcestník Opravit GPS, Srovnat jinak je schovaný)
            await page.evaluate("() => AGUkony.go('Přesné měření', true)")
            await page.wait_for_timeout(300)
            await page.evaluate("() => document.querySelector('.ag-uk-page[data-page=\"Přesné měření\"] .ag-uk-i[data-k=\"opravit-gps\"]').click()")
            await page.wait_for_timeout(400)
            d8 = await page.evaluate("""() => ({ sub: Array.from(document.querySelectorAll('.ag-uk-sub[data-sub="opravit-gps"] .ag-uk-i')).map(r => r.getAttribute('data-k')),
                pod: (document.querySelector('.ag-uk-i[data-k="opravit-gps"] small') || {}).textContent || '',
                pro: Array.from(document.querySelectorAll('.ag-uk-page[data-page="pro"] .ag-uk-i')).map(r => r.getAttribute('data-k')) })""")
            ok('D8 v Základu rozcestník rozbalí jen volné položky, Pro položka (chůzí po hraně) je na stránce Pro a podtitulek ji neslibuje',
               'korekce-z-mapy' in d8['sub'] and 'ref-calibration' in d8['sub'] and 'kalibrace-hranou' not in d8['sub'] and 'kalibrace-hranou' in d8['pro'] and 'hraně' not in d8['pod'], d8)
            # klepnutí na zamčený řádek = karta Pro, ne nástroj
            await page.evaluate("() => AGUkony.go('pro', true)")
            await page.wait_for_timeout(300)
            # 18. 9. 2026: Kubatury (openDmtVolume) jsou schované → zamčený řádek = Výška objektu (Pro)
            await page.evaluate("() => document.querySelector('.ag-uk-page[data-page=\"pro\"] .ag-uk-i[data-k=\"vyska-objektu\"]').click()")
            await page.wait_for_timeout(700)
            karta = await page.evaluate("() => !!document.querySelector('#ag-pro-karta.on, #ag-pz-modal.on, [id^=ag-pro][class~=on]') || !!Array.from(document.querySelectorAll('[id*=pro]')).find(e => /karta|zamek|zamky/.test(e.id) && e.classList.contains('on'))")
            dmt = await page.evaluate("() => { var m = document.getElementById('vyska-objektu-modal') || document.getElementById('ag-vo-modal') || document.querySelector('[id*=vyska-objektu]'); return m ? (m.style.display || (m.classList.contains('open') ? 'open' : '')) : 'none'; }")
            ok('D7 zamčený řádek na Pro otevře kartu Pro, ne nástroj', karta and dmt in ('none', ''), (karta, dmt))
            if SNIMKY:
                await page.evaluate("() => { document.querySelectorAll('.on').forEach(function(){}); }")
                await page.screenshot(path=os.path.join(out_dir, 'zaklad-pro.png'))
        await ctx.close()

        # ---- E: gesta žijí -----------------------------------------------------------------
        ctx, page = await stranka(br, url, boot(tarif='pro') + "localStorage.setItem('agViewMode','map');", chyby)
        await cekej(page, "document.body.classList.contains('app-started')")
        await cekej(page, "window.AGGesta && window.AGUkony", 30)
        g = await page.evaluate("() => ({ assign: typeof AGGesta.assignFor === 'function', arrows: AGGesta.arrows && AGGesta.arrows('UD'), has: AGUkony.has('pocasi') })")
        ok('E4 AGGesta.assignFor + arrows existují, AGUkony.has dál odpovídá gestům', g['assign'] and g['arrows'] == '↑↓' and g['has'], g)
        await ctx.close()

        rel = [c for c in chyby if 'favicon' not in c and 'net::ERR' not in c and 'Failed to load resource' not in c]
        ok('Z bez chyb v konzoli', not rel, rel[:5])
        await br.close()


if __name__ == '__main__':
    srv, url = server(PORT)
    if not url:
        print('CHYBA server se nerozjel'); sys.exit(2)
    print(url)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    n = sum(1 for v in vysledky if not v[1])
    print('\n%d/%d OK' % (len(vysledky) - n, len(vysledky)))
    sys.exit(1 if n else 0)
