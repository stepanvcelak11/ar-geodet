#!/usr/bin/env python3
# ===== AR Geodet - VYTYCENI LOMENE OSY SE STANICENIM (js/stakeout-line.js) =====
# Do 5. 9. 2026 umel nastroj jen primku A->B. U pokladky silnice je ale denni
# chleba LOMENA OSA se stanicenim od zacatku useku - a se stanicenim pocatku,
# aby cisla sedela s projektem (osa zacina treba na km 1,200).
#
# Testuje se to, co pri cteni kodu neni videt, protoze vznika az slozenim modulu
# za behu:
#
#   A) GEOMETRIE OSY. Tri body do "L" (100 m vychod + 100 m sever) musi dat dva
#      useky, delku 200 m a stanicenu lomu 100 m. Zpetne: pointAt(150) prevedeny
#      pres stationOf() musi vratit tychz 150 m a nulovy odstup - tedy ze se
#      staniceni PRENASI PRES LOM a nepocita se vzdusnou carou.
#
#   B) NEJBLIZSI USEK. Poloha u druheho useku se musi cist na druhem useku
#      (ne na prvnim, jehoz nekonecna primka je blizko), a odstup musi mit
#      spravne znamenko (+ vlevo ve smeru osy).
#
#   C) STANICENI POCATKU. S poctatkem 1200 musi odecet i vytycovany bod pracovat
#      s absolutnim stanicenim - a vnitrni geometrie (a tedy i kresba v AR) musi
#      zustat od nuly, jinak by se okno a obraz rozesly.
#
#   D) SMLOUVA S AR VRSTVOU. js/stakeout-line-ar.js si bere geometrii pres
#      window.AGStakeLine (g.A, g.B, g.len, pointAt, stationOf). Kdyby se
#      prestavbou ztratil kterykoli z nich, kresba osy v kamere zmizi potichu.
#
#   E) KOLIKY PO KROKU. "Vytyc celou osu po 25 m" musi nasypat body na CELE
#      nasobky kroku vcetne konce osy a ulozit je do zakazky.
#
#   F) OKNO. Pridani lomu prida radek, odebrani ho ubere, pod dva vrcholy nejde
#      jit - a zivy odecet ukazuje, na kterem useku uzivatel stoji.
#
# Pouziti (z korene repa):  python scripts/test_lomena_osa.py [port]
# ==============================================================================
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8951
URL = None

LAT0, LNG0 = 50.0800, 14.4200

BOOT = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('arSurveyor','Stepan');
"""

# Tri body do "L": A -> 100 m na vychod -> 100 m na sever.
# Metry na stupen se berou ze stejneho GeoCore, jaky pouziva nastroj - test tim
# nemeri prevod souradnic (ten ma vlastni testy v scripts/run_js_tests.py), ale
# geometrii osy.
SEED = """async () => {
  const m = GeoCore.metersPerDeg(%f);
  const A = { name:'OS1', lat:%f, lng:%f };
  const B = { name:'OS2', lat:A.lat, lng:A.lng + 100/m.lng };
  const C = { name:'OS3', lat:B.lat + 100/m.lat, lng:B.lng };
  window.addImportedPoints([A,B,C]);
  return arPoints.filter(p => /^OS[123]$/.test(p.name)).length;
}""" % (LAT0, LAT0, LNG0)

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)[:400]) if detail != '' else ''))


def blizko(a, b, tol=0.05):
    try:
        return abs(float(a) - float(b)) <= tol
    except Exception:
        return False


def server():
    """Na Windows zustava port po predchozim behu chvili obsazeny - zkousi se vic."""
    global URL
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % port
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                URL = u
                return srv
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None


async def nacti(page, cekej_na='true'):
    for _ in range(4):
        try:
            await page.goto(URL, wait_until='domcontentloaded', timeout=45000)
            break
        except Exception:
            await page.wait_for_timeout(1500)
    await page.wait_for_timeout(2200)
    # ⚠ Bez flushe odlozenych modulu hlasi pulka nastroju "is not defined" falesne.
    #   Frontu odlozenych modulu je nutne poustet OPAKOVANE - prvni volani prijde
    #   drive, nez se vubec AGLazy stihne ohlasit, a bez navratove hodnoty by test
    #   sel dal s nenactenym nastrojem (a spadl az o 50 radku niz na necem jinem).
    hotovo = False
    for _ in range(60):
        if await page.evaluate("() => " + cekej_na):
            hotovo = True
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(500)
    await page.wait_for_timeout(1500)
    if not hotovo:
        raise RuntimeError('appka se nenacetla do 30 s (podminka: %s)' % cekej_na)


async def main():
    from playwright.async_api import async_playwright
    srv = server()
    if not srv:
        print('CHYBA: testovaci server nenastartoval')
        return 1
    chyby = []
    try:
        async with async_playwright() as pw:
            b = await pw.chromium.launch()
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                                      geolocation={'latitude': LAT0, 'longitude': LNG0},
                                      permissions=['geolocation'], service_workers='block')
            await ctx.add_init_script(BOOT)
            page = await ctx.new_page()
            page.on('pageerror', lambda e: chyby.append(str(e)[:220]))
            await nacti(page, "typeof window.agOpenStakeLine === 'function' && typeof window.addImportedPoints === 'function'")

            n = await page.evaluate(SEED)
            ok('zalozeny tri body osy (L, 100+100 m)', n == 3, n)

            # nastroj se musi otevrit a sam si vzit dva nejblizsi body
            await page.evaluate("() => window.agOpenStakeLine()")
            await page.wait_for_timeout(600)

            # ---------------------------------------------------------- A) geometrie
            print('\n--- A) staniceni jde PRES LOM ---')
            g = await page.evaluate("""() => {
                const S = window.AGStakeLine;
                const ids = arPoints.filter(p => /^OS[123]$/.test(p.name)).sort((a,b)=>a.name<b.name?-1:1).map(p=>p.id);
                // vrcholy se nastavuji pres <select>y v okne, at se testuje i UI cesta
                const box = document.getElementById('agsl-verts');
                document.getElementById('agsl-add').click();
                const sel = box.querySelectorAll('select');
                for (let i=0;i<3;i++){ sel[i].value = ids[i]; sel[i].dispatchEvent(new Event('change',{bubbles:true})); }
                const g = S.geometry();
                const p150 = S.pointAt(g, 150, 0);
                const back = S.stationOf(g, p150.lat, p150.lng);
                const p50 = S.pointAt(g, 50, 3);
                const back50 = S.stationOf(g, p50.lat, p50.lng);
                const pOver = S.pointAt(g, 250, 0);
                const backOver = S.stationOf(g, pOver.lat, pOver.lng);
                return { segs: g.segs.length, len: g.len, lom: g.verts[1].s, bent: g.bent,
                         A: g.A.name, B: g.B.name,
                         back150: back.station, off150: back.offset, seg150: back.seg,
                         back50: back50.station, off50: back50.offset,
                         over: backOver.station };
            }""")
            ok('osa ma dva useky', g['segs'] == 2, g)
            ok('delka osy je 200 m (ne 141 m vzdusnou carou)', blizko(g['len'], 200, 0.3), g['len'])
            ok('staniceni lomu je 100 m', blizko(g['lom'], 100, 0.3), g['lom'])
            ok('zacatek je OS1, konec OS3', g['A'] == 'OS1' and g['B'] == 'OS3', g)
            ok('bod ve staniceni 150 se cte zpatky jako 150', blizko(g['back150'], 150, 0.1), g['back150'])
            ok('bod na ose ma nulovy odstup', blizko(g['off150'], 0, 0.05), g['off150'])
            ok('bod ve staniceni 150 lezi na DRUHEM useku', g['seg150'] == 1, g['seg150'])
            ok('odsazeny bod (+3 m vlevo) se cte jako 50 m / +3 m', blizko(g['back50'], 50, 0.1) and blizko(g['off50'], 3, 0.05), g)
            ok('za koncem osy se pokracuje v prodlouzeni (250 m)', blizko(g['over'], 250, 0.2), g['over'])

            # ---------------------------------------------------- B) nejblizsi usek
            print('\n--- B) odecet si najde spravny usek ---')
            r = await page.evaluate("""() => {
                const S = window.AGStakeLine, g = S.geometry();
                // 5 m vlevo od osy ve staniceni 160 (druhy usek smeruje na sever,
                // vlevo od nej je tedy zapad)
                const p = S.pointAt(g, 160, 5);
                const me = S.stationOf(g, p.lat, p.lng);
                return { st: me.station, off: me.offset, seg: me.seg };
            }""")
            ok('poloha u druheho useku se cte na druhem useku', r['seg'] == 1, r)
            ok('staniceni 160 m', blizko(r['st'], 160, 0.15), r['st'])
            ok('odstup +5 m (vlevo)', blizko(r['off'], 5, 0.05), r['off'])

            # ---------------------------------------------- C) staniceni pocatku
            print('\n--- C) staniceni pocatku posune cisla, ne geometrii ---')
            c = await page.evaluate("""() => {
                const s0 = document.getElementById('agsl-s0');
                s0.value = '1200'; s0.dispatchEvent(new Event('input',{bubbles:true}));
                const st = document.getElementById('agsl-stat');
                st.value = '1350'; st.dispatchEvent(new Event('input',{bubbles:true}));
                const S = window.AGStakeLine, g = S.geometry();
                const p150 = S.pointAt(g, 150, 0);
                const out = document.getElementById('agsl-stake-out').textContent;
                const head = document.getElementById('agsl-lineinfo').textContent;
                return { s0: S.startStation(), len: g.len, out: out, head: head, p150: p150 };
            }""")
            ok('startStation() vraci 1200', blizko(c['s0'], 1200, 0.001), c['s0'])
            ok('vnitrni delka osy zustala 200 m', blizko(c['len'], 200, 0.3), c['len'])
            ok('nahled vytyceni pise absolutni staniceni 1350', '1350' in c['out'], c['out'])
            ok('hlavicka pise rozsah staniceni', '1200' in c['head'] and '1400' in c['head'], c['head'])

            # vytyceny bod na st. 1350 musi sedet s vnitrnim 150
            d = await page.evaluate("""() => {
                const S = window.AGStakeLine, g = S.geometry();
                const a = S.pointAt(g, 150, 0);
                document.getElementById('agsl-name').value = 'KM1350';
                document.getElementById('agsl-save').click();
                const p = arPoints.find(q => q.name === 'KM1350');
                return p ? getDistance(a.lat, a.lng, p.lat, p.lng) : -1;
            }""")
            await page.wait_for_timeout(500)
            ok('ulozeny bod st. 1350 lezi na vnitrnim staniceni 150', d >= 0 and d < 0.05, d)

            # ------------------------------------------------- D) smlouva s AR
            print('\n--- D) AR vrstva dostane, co potrebuje ---')
            ar = await page.evaluate("""() => {
                const S = window.AGStakeLine, g = S.geometry();
                return { api: ['geometry','pointAt','stationOf'].every(k => typeof S[k] === 'function'),
                         A: !!(g.A && g.A.lat), B: !!(g.B && g.B.lat), len: g.len > 0,
                         verts: g.verts.length,
                         // vzorkovani osy po 2 m nesmi u lomene osy uriznout roh:
                         // vzorek presne v lomu musi sedet na vrcholu
                         lom: getDistance(S.pointAt(g, g.verts[1].s, 0).lat, S.pointAt(g, g.verts[1].s, 0).lng,
                                          g.verts[1].p.lat, g.verts[1].p.lng) };
            }""")
            ok('AGStakeLine ma geometry/pointAt/stationOf', ar['api'], ar)
            ok('geometrie ma A, B i delku', ar['A'] and ar['B'] and ar['len'], ar)
            ok('vrcholy jsou k dispozici pro kresbu lomu', ar['verts'] == 3, ar['verts'])
            ok('vzorek ve staniceni lomu sedi na vrcholu', ar['lom'] < 0.05, ar['lom'])

            # --------------------------------------------- E) koliky po kroku
            print('\n--- E) vytyceni cele osy po 25 m ---')
            e = await page.evaluate("""() => {
                const st = document.getElementById('agsl-step');
                st.value = '25'; st.dispatchEvent(new Event('input',{bubbles:true}));
                const pre = document.getElementById('agsl-bpre'); pre.value = 'K';
                const nahled = document.getElementById('agsl-batch-out').textContent;
                const pred = arPoints.length;
                document.getElementById('agsl-batch').click();
                return { nahled: nahled, pred: pred };
            }""")
            await page.wait_for_timeout(800)
            e2 = await page.evaluate("""() => {
                const S = window.AGStakeLine, g = S.geometry();
                const k = arPoints.filter(p => /^K1[234]\\d\\d$/.test(p.name)).map(p => p.name).sort();
                // kazdy kolik musi sedet na svem staniceni
                let max = 0;
                k.forEach(nm => {
                    const p = arPoints.find(q => q.name === nm);
                    const cil = S.pointAt(g, parseFloat(nm.slice(1)) - S.startStation(), 0);
                    max = Math.max(max, getDistance(p.lat, p.lng, cil.lat, cil.lng));
                });
                return { jmena: k, max: max };
            }""")
            ok('nahled hlasi 9 koliku (1200..1400 po 25 m)', '9' in e['nahled'], e['nahled'])
            ok('nasypano 9 koliku K1200..K1400', len(e2['jmena']) == 9, e2['jmena'])
            ok('prvni je K1200, posledni K1400', e2['jmena'][0] == 'K1200' and e2['jmena'][-1] == 'K1400', e2['jmena'])
            ok('kazdy kolik sedi na svem staniceni', e2['max'] < 0.05, e2['max'])

            # ------------------------------------------------------- F) okno
            print('\n--- F) okno: pridavani a ubirani lomu ---')
            f = await page.evaluate("""() => {
                const box = document.getElementById('agsl-verts');
                const pred = box.querySelectorAll('select').length;
                document.getElementById('agsl-add').click();
                const po = box.querySelectorAll('select').length;
                box.querySelectorAll('.agsl-x[data-i]')[3].click();
                const zpet = box.querySelectorAll('select').length;
                // pod dva vrcholy to jit nesmi - krizky u dvouvrcholove osy zmizi
                box.querySelectorAll('.agsl-x[data-i]')[0].click();
                const dno = box.querySelectorAll('select').length;
                const krizky = box.querySelectorAll('.agsl-x[data-i]').length;
                return { pred: pred, po: po, zpet: zpet, dno: dno, krizky: krizky };
            }""")
            ok('lom se prida', f['pred'] == 3 and f['po'] == 4, f)
            ok('lom se da odebrat', f['zpet'] == 3, f)
            ok('pod dva vrcholy to nejde', f['dno'] == 2, f)
            ok('u dvouvrcholove osy uz krizky nejsou', f['krizky'] == 0, f)

            live = await page.evaluate("""async () => {
                // zpatky na tri vrcholy a postavit se k druhemu useku
                const ids = arPoints.filter(p => /^OS[123]$/.test(p.name)).sort((a,b)=>a.name<b.name?-1:1).map(p=>p.id);
                document.getElementById('agsl-add').click();
                const sel = document.getElementById('agsl-verts').querySelectorAll('select');
                for (let i=0;i<3;i++){ sel[i].value = ids[i]; sel[i].dispatchEvent(new Event('change',{bubbles:true})); }
                return true;
            }""")
            # Zivy odecet se necha dojet vlastnim tikem (300 ms) - testuje se, ze
            # okno ukazuje TOTEZ, co spocita stationOf(), vcetne useku a lomu.
            # (Prohlizec drzi polohu na prvnim vrcholu; ze si odecet najde i druhy
            # usek, je overene primo na geometrii v casti B.)
            await page.wait_for_timeout(900)
            txt = await page.evaluate("() => document.getElementById('agsl-live').textContent")
            ok('zivy odecet hlasi, na kterem useku stojim', 'Úsek 1/2' in txt and '#OS1 → #OS2' in txt, txt[:200])
            ok('zivy odecet pouziva absolutni staniceni (1200, ne 0)', 'Staničení1200.00 m' in txt.replace('\n', ''), txt[:200])
            ok('zivy odecet hlasi vzdalenost do lomu', 'Do lomu #OS2' in txt and '100.00' in txt, txt[:200])
            ok('zivy odecet hlasi zbytek do konce osy', 'Zbývá do #OS3' in txt and '200.00' in txt, txt[:200])

            ok('zadna chyba v konzoli', not chyby, chyby)
            await b.close()
    finally:
        srv.terminate()

    spadlo = [j for o, j in vysledky if not o]
    print('\n================ VYSLEDEK ================')
    print('  prosLo: %d / %d' % (len(vysledky) - len(spadlo), len(vysledky)))
    for j in spadlo:
        print('  SPADLO: ' + j)
    return 1 if spadlo else 0


sys.exit(asyncio.run(main()))
