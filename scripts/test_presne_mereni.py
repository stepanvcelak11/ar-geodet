# -*- coding: utf-8 -*-
"""Sekce PRESNE MERENI (15. 9. 2026, v329) — spusteni cele appky v Chromiu (Playwright):

  S  sekce v registru a v seznamu ukonu (Presna GPS, kalibrace, DGPS, akustika,
     kontrolni mereni + pruvodce), rozcestnik Srovnat jinak uz obe kalibrace nema
  G  pruvodce „Jak merit presne z mobilu" (js/presne-mereni.js): 8 karet, tlacitka
     otevrou nastroj (Presna GPS), obrazek „kam s telefonem" v Presne GPS
  T  kalibrace chuzi (js/kalibrace-hranou.js): uzavreny tvar = cely vektor,
     plavani chyby behem chuze, interpolace pred/po, zpetny prepocet bodu
  U  cely tok „pred a po" v UI: predchozi korekce + bod ulozeny mezi tim →
     po druhe chuzi dialog „Kalibrace pred a po" → bod prepocten podle casu
  D  DGPS: docasna zakladna z bodu Presne GPS (AGDgps.openBase)

Spusteni: python scripts/test_presne_mereni.py [port]
"""
import io
import os
import sys
import json
import asyncio
import subprocess
import time
import math
import urllib.request
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from ag_boot import boot  # noqa: E402
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8993)
vysledky = []
LAT, LNG = 50.0755, 14.4378
MLAT = 111320.0
MLNG = 111320.0 * math.cos(math.radians(LAT))


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


def server(port):
    for pokus in range(6):
        p = port + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % p
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(p)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                return srv, u
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None, None


def ll(x, y):
    return {'lat': LAT + y / MLAT, 'lng': LNG + x / MLNG}


PA, PB = ll(0, 0), ll(60, 0)
# bod „mezi kalibracemi": ulozen pred 5 min s korekci z predchozi chuze (t = TPREV)
NOW_MS = int(time.time() * 1000)
TPREV = NOW_MS - 10 * 60000
PREV_DLAT = 1.0 / MLAT       # predchozi korekce: +1,0 m na sever (GPS lhala o 1 m na jih)
PM = ll(30, -20)
BODY = [
    {'id': 'cp_A', 'name': 'HRANA-A', 'lat': PA['lat'], 'lng': PA['lng'], 'cat': 'CUSTOM', 'type': 'custom'},
    {'id': 'cp_B', 'name': 'HRANA-B', 'lat': PB['lat'], 'lng': PB['lng'], 'cat': 'CUSTOM', 'type': 'custom'},
    {'id': 'cp_M', 'name': 'MEZI-1', 'lat': PM['lat'] + PREV_DLAT, 'lng': PM['lng'], 'cat': 'CUSTOM', 'type': 'custom',
     'refShift': {'dlat': PREV_DLAT, 'dlng': 0, 't': TPREV}, 'prov': {'origin': 'ruc', 'ts': NOW_MS - 5 * 60000, 'acc': 3}},
    {'id': 'cp_G', 'name': 'BG-ZAKL', 'lat': ll(10, 10)['lat'], 'lng': ll(10, 10)['lng'], 'cat': 'CUSTOM', 'type': 'custom', 'acc': 0.42,
     'prov': {'origin': 'gps-avg', 'ts': NOW_MS - 3 * 60000, 't0': NOW_MS - 13 * 60000, 'acc': 0.42, 'refShift': {'dlat': PREV_DLAT, 'dlng': 0, 't': TPREV}}},
]
PREV = {'dlat': PREV_DLAT, 'dlng': 0, 't': TPREV, 'acc': 0.4, 'on': True, 'lat': PA['lat'], 'lng': PA['lng'], 'src': 'hrana', 'mode': '1d'}
SEED = ("localStorage.setItem('default_arCustomPoints12', %s); localStorage.setItem('agRefShift', %s);"
        % (json.dumps(json.dumps(BODY)), json.dumps(json.dumps(PREV))))


async def stranka(br, url, init, chyby):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'])
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)
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


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        ctx, page = await stranka(br, url, boot(tarif='pro') + SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');", chyby)
        await cekej(page, "document.body.classList.contains('app-started')")
        await cekej(page, "typeof userLat === 'number' && userLat", 30)

        # ---- S: sekce v registru -------------------------------------------------------
        g = await page.evaluate("""() => { const gs = AGReg.groups(); const f = t => (gs.find(x => x.t === t) || {items: []}).items.map(i => i.k);
            return { verbs: gs.map(x => x.t), pm: f('Přesné měření'), ar: f('Srovnat AR'), urcit: f('Určit nový bod'), zmerit: f('Změřit') }; }""")
        chce = ['presne-mereni', 'brutal-gps', 'kalibrace-hranou', 'ref-calibration', 'dgps', 'akusticky-dalkomer', 'dvoji-mereni']
        ok('S1 sekce „Přesné měření" je mezi slovesy hned za „Určit nový bod"', g['verbs'].index('Přesné měření') == g['verbs'].index('Určit nový bod') + 1, g['verbs'])
        ok('S2 sekce má všech 7 nástrojů, průvodce první', g['pm'][0] == 'presne-mereni' and all(k in g['pm'] for k in chce), g['pm'])
        ok('S3 kalibrace zmizely ze „Srovnat AR", Přesná GPS/DGPS/akustika z „Určit nový bod", kontrolní měření ze „Změřit"',
           not any(k in g['ar'] for k in ('ref-calibration', 'kalibrace-hranou')) and not any(k in g['urcit'] for k in ('brutal-gps', 'dgps', 'akusticky-dalkomer')) and 'dvoji-mereni' not in g['zmerit'], g)
        hub = await page.evaluate("() => (window.AGHub && AGHub.hubs ? AGHub.hubs() : []).filter(h => h.id === 'srovnat-sever').map(h => h.poradi)[0] || null")
        ok('S4 rozcestník „Srovnat jinak" už kalibrace GPS nenabízí', hub is None or not any(k in hub for k in ('ref-calibration', 'kalibrace-hranou')), hub)
        lst = await page.evaluate("""() => { try { if (window.AGUkony && AGUkony.rebuild) AGUkony.rebuild(); } catch (e) {}
            return Array.from(document.querySelectorAll('.ag-uk-h')).map(h => (h.textContent || '').replace(/\\s+/g, ' ').trim()); }""")
        ok('S5 seznam úkonů má hlavičku Přesné měření', any('Přesné měření'.upper() in t.upper() for t in lst), lst)
        role = await page.evaluate("() => !!document.querySelector('.tool-grid .tool-cat') && Array.from(document.querySelectorAll('.tool-grid .tool-cat')).some(e => e.textContent.trim() === 'Přesné měření')")
        ok('S6 mřížka má nadpis kategorie Přesné měření (klikací cíl)', role)

        # ---- G: průvodce ------------------------------------------------------------------
        await page.evaluate("() => AGLazyTools.open('presne-mereni')")
        ok('G1 průvodce se otevře', await cekej(page, "window.AGPresne && document.getElementById('ag-presne-modal') && getComputedStyle(document.getElementById('ag-presne-modal')).display === 'flex'"), chyby[-3:])
        gi = await page.evaluate("""() => { const b = document.getElementById('ag-presne-body'); return { karet: b.querySelectorAll('.pm-card').length, btn: b.querySelectorAll('button[data-run]').length,
            txt: b.textContent, tab: b.querySelectorAll('.pm-tab').length }; }""")
        ok('G2 průvodce: 8 karet s postupem, tlačítka, tabulka „co čekat" + „kde jde kalibrovat"', gi['karet'] == 8 and gi['btn'] >= 9 and gi['tab'] >= 2 and 'Kde jde kalibrovat' in gi['txt'] and 'plusko' in gi['txt'] and 'dočasn' in gi['txt'], (gi['karet'], gi['btn'], gi['tab']))
        await page.click('#ag-presne-body button[data-run="brutal-gps"]')
        ok('G3 tlačítko v průvodci otevře Přesnou GPS a průvodce se schová', await cekej(page, "document.getElementById('ag-bgps-overlay') && document.getElementById('ag-bgps-overlay').classList.contains('on') && getComputedStyle(document.getElementById('ag-presne-modal')).display === 'none'"), chyby[-3:])
        pl = await page.evaluate("""() => { const p = document.getElementById('bgps-place'); if (!p) return null; const r = p.getBoundingClientRect();
            return { svg: !!p.querySelector('svg'), txt: p.textContent, vis: r.height > 40, how: !!p.querySelector('.bgps-how') }; }""")
        ok('G4 Přesná GPS ukazuje „kam s telefonem": obrázek + střed/anténa + jednoduchý postup', pl and pl['svg'] and pl['vis'] and pl['how'] and 'střed telefonu' in pl['txt'] and 'anténa' in pl['txt'].lower(), pl and pl['txt'][:120])
        await page.click('#bgps-close')

        # ---- T: matematika kalibrace ----------------------------------------------------------
        await page.evaluate("() => AGLazyTools.open('kalibrace-hranou')")
        ok('T0 kalibrace chůzí se načte', await cekej(page, "window.AGHrana && AGHrana._test && AGHrana._test.reapply"), chyby[-3:])
        t = await page.evaluate("""() => {
            const T = AGHrana._test, lat0 = 50.0, lng0 = 14.0, m = { lat: 111320, lng: 111320 * Math.cos(50 * Math.PI / 180) };
            const ll = (x, y) => ({ lat: lat0 + y / m.lat, lng: lng0 + x / m.lng });
            let seed = 7; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
            const gauss = () => { const u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
            // čtverec 40 m uzavřený; chyba GPS (1.5 V, -2.0 S) na začátku, plave na (2.5 V, -2.0 S) na konci
            const sq = [ll(0, 0), ll(40, 0), ll(40, 40), ll(0, 40), ll(0, 0)];
            const line = new T.Line(sq), fixes = []; let tt = 0;
            const total = line.len; let done = 0;
            line.seg.forEach(s => { for (let k = 0; k < s.L; k += 1.2) {
                const f = (done + k) / total, vE = 1.5 + 1.0 * f, vN = -2.0;
                const tx = s.a.x + k * s.ux, ty = s.a.y + k * s.uy;
                const p = ll(tx + vE + 0.5 * gauss(), ty + vN + 0.5 * gauss()), pr = line.project(p.lat, p.lng);
                fixes.push({ nx: pr.nx, ny: pr.ny, e: pr.e, s: pr.s, acc: 5, t: (tt += 1000) });
            } done += s.L; });
            const q = T.solve(fixes, line.spread() >= T.ANGLE_2D);
            const rov = new T.Line([ll(0, 0), ll(50, 0)]);
            // interpolace
            const prev = { dlat: 0.00001, dlng: 0.00002, t: 1000 }, next = { dlat: 0.00003, dlng: 0.00002, t: 3000 };
            const mid = T.interpShift(prev, next, 2000), before = T.interpShift(prev, next, 500), after = T.interpShift(prev, next, 9000);
            return { closed: line.closed, rovClosed: rov.closed, mode: q.mode, vE: q.vE, vN: q.vN, drift: q.drift, mid, before, after };
        }""")
        ok('T1 uzavřený čtverec: Line.closed, řeší se celý vektor (≈ střed plavání 2,0 V / −2,0 S)', t['closed'] and not t['rovClosed'] and t['mode'] == '2d' and abs(t['vE'] - 2.0) < 0.35 and abs(t['vN'] + 2.0) < 0.35, t)
        ok('T2 plavání chyby během chůze ≈ 0,5 m na východ (první vs. druhá půlka, bias 1,5→2,5)', t['drift'] and 0.3 < t['drift']['mag'] < 0.9 and t['drift']['dE'] > 0.3 and abs(t['drift']['dN']) < 0.3, t['drift'])
        ok('T3 interpolace: uprostřed půlka, před začátkem prev, po konci next', abs(t['mid']['dlat'] - 0.00002) < 1e-9 and t['mid']['f'] == 0.5 and t['before']['f'] == 0 and t['after']['f'] == 1, t['mid'])
        r = await page.evaluate(("""() => {
            const T = AGHrana._test, prev = window.agRefShift, now = NOWMS;
            const next = { dlat: prev.dlat + 1.0 / 111320, dlng: 0, t: now };   // nová korekce: +2,0 m S (posun o 1 m za 10 min)
            const c = T.betweenCandidates(prev, now).map(p => p.name);
            const pM = persistentCustomPoints.find(p => p.id === 'cp_M'), pG = persistentCustomPoints.find(p => p.id === 'cp_G');
            const latM0 = pM.lat, latG0 = pG.lat;
            const res = T.reapply(prev, next, T.betweenCandidates(prev, now));
            const dM = (pM.lat - latM0) * 111320, dG = (pG.lat - latG0) * 111320;
            const c2 = T.betweenCandidates(prev, now).map(p => p.name);
            return { c, res, dM, dG, fM: pM.refShift.f, fG: pG.prov.refShift.f, interpM: !!pM.refShift.interp, c2, tM: T.pointTime(pM), tG: T.pointTime(pG), srcM: pM.refShift.src };
        }""").replace('NOWMS', str(NOW_MS)))
        ok('T4 kandidáti = body s korekcí z předchozí chůze uložené mezi tím (ruční i z Přesné GPS)', sorted(r['c']) == ['BG-ZAKL', 'MEZI-1'], r['c'])
        ok('T5 přepočet podle času: bod v půlce (5 min po první chůzi) +0,5 m, bod Přesné GPS podle středu okupace (2 min po → +0,2 m)',
           r['res']['n'] == 2 and abs(r['dM'] - 0.5) < 0.05 and abs(r['dG'] - 0.2) < 0.05 and abs(r['fM'] - 0.5) < 0.02 and abs(r['fG'] - 0.2) < 0.02, r)
        ok('T6 přepočtený bod má refShift.interp a podruhé se už nenabídne', r['interpM'] and r['c2'] == [], r['c2'])
        ok('T6b přepočet zachová původ korekce (src hrana) — kvůli kartě bodu a důvěře', r.get('srcM') == 'hrana', r.get('srcM'))
        # vrátit body do stavu před přepočtem (kvůli U)
        await page.evaluate("""() => { const pM = persistentCustomPoints.find(p => p.id === 'cp_M'); pM.lat -= 0.5 / 111320; pM.refShift = { dlat: window.agRefShift.dlat, dlng: 0, t: window.agRefShift.t, src: 'hrana' };
            const pG = persistentCustomPoints.find(p => p.id === 'cp_G'); pG.lat -= 0.2 / 111320; pG.prov.refShift = { dlat: window.agRefShift.dlat, dlng: 0, t: window.agRefShift.t, src: 'hrana' }; }""")

        # ---- U: celý tok „před a po" v UI ------------------------------------------------------
        await page.evaluate("() => AGHrana.open()")
        await page.wait_for_timeout(300)
        okno = await page.evaluate("() => document.getElementById('ag-hr-body').textContent")
        ok('U1 okno má nahoře „Jednoduše" s postupem a hlásí platnou korekci z chůze', 'Jednoduše' in okno and 'platí ještě' in okno and 'z chůze po hraně' in okno, okno[:200])
        await page.select_option('#ag-hr-pa', 'cp_A')
        await page.select_option('#ag-hr-pb', 'cp_B')
        await page.wait_for_timeout(300)
        okno = await page.evaluate("() => document.getElementById('ag-hr-body').textContent")
        ok('U2 čára z bodů ukazuje zdroj a přesnost čáry', 'z uložených bodů' in okno and '±0,05 m' in okno, okno[:300])
        await page.click('#ag-hr-go')
        await page.wait_for_timeout(400)
        import random
        random.seed(3)
        # GPS teď lže o −2,0 m S (dřív −1,0): pravda na čáře, fix = pravda + (0, −2.0) + šum
        for i in range(40):
            x = 2 + i * 1.4
            p = ll(x + random.gauss(0, 0.4), -2.0 + random.gauss(0, 0.4))
            await ctx.set_geolocation({'latitude': p['lat'], 'longitude': p['lng'], 'accuracy': 4})
            await page.wait_for_timeout(110)
        await page.click('#ag-hr-bar-stop')
        await page.wait_for_timeout(500)
        res = await page.evaluate("() => Array.from(document.querySelectorAll('#ag-hr-body .hr-card')).map(c => c.textContent).find(t => t.indexOf('Výsledek') >= 0) || ''")
        ok('U3 výsledek hlásí „celkem ±" s přesností čáry a ohlašuje přepočet po zapnutí', 'celkem ±' in res and 'nabídnu přepočet' in res, res[:400])
        await page.click('#ag-hr-apply')
        ok('U4 po zapnutí dialog „Kalibrace před a po" (posun ~1 m, 2 body)', await cekej(page, "document.querySelector('.ag-dlg-title') && document.querySelector('.ag-dlg-title').textContent.indexOf('Kalibrace před a po') === 0 && /Přepočítat 2 bod/.test(document.querySelector('.ag-dlg-ok').textContent)", 10), chyby[-3:])
        dlg = await page.evaluate("() => document.querySelector('.ag-dlg-msg').textContent")
        ok('U5 dialog říká, o kolik se chyba posunula, a jmenuje body', 'posunula o' in dlg and 'MEZI-1' in dlg and 'BG-ZAKL' in dlg, dlg[:300])
        await page.click('.ag-dlg-ok')
        await page.wait_for_timeout(600)
        u = await page.evaluate("""() => { const pM = persistentCustomPoints.find(p => p.id === 'cp_M'); const s = window.agRefShift;
            return { dM: (pM.lat - %r) * 111320, interp: pM.refShift && pM.refShift.interp === s.t, src: s.src, dN: s.dlat * 111320, f: pM.refShift && pM.refShift.f, fOcek: (5 * 60000) / (s.t - %r),
                     ls: JSON.parse(getStoredData('arCustomPoints12')).find(p => p.id === 'cp_M').refShift.interp === s.t }; }""" % (PM['lat'] + PREV_DLAT, TPREV))
        ok('U6 bod mezi chůzemi posunut podle času (podíl 5 min z doby mezi chůzemi) a uložen', 1.7 < u['dN'] < 2.3 and abs(u['f'] - u['fOcek']) < 0.03 and abs(u['dM'] - u['fOcek'] * (u['dN'] - 1.0)) < 0.12 and u['interp'] and u['ls'], u)
        await page.click('#ag-hr-close')

        # ---- D: DGPS dočasná základna ----------------------------------------------------------
        await page.evaluate("() => AGLazyTools.open('dgps')")
        ok('D0 DGPS se načte', await cekej(page, "window.AGDgps && AGDgps.openBase"), chyby[-3:])
        menu = await page.evaluate("() => document.getElementById('ag-dgps-body').textContent")
        ok('D1 menu DGPS má „Jednoduše" s postupem a dočasnou základnou', 'Jednoduše' in menu and 'dočasn' in menu and 'kód' in menu, menu[:200])
        await page.evaluate("() => AGDgps.openBase('cp_G')")
        await page.wait_for_timeout(300)
        d = await page.evaluate("""() => { const b = document.getElementById('ag-dgps-body'); const sel = b.querySelector('#ag-dgps-pt');
            return { sel: sel && sel.value, opt: sel && sel.options[sel.selectedIndex].textContent, txt: b.textContent }; }""")
        ok('D2 openBase předvybere bod z Přesné GPS jako dočasnou základnu (±0,42 m)', d['sel'] == 'cp_G' and 'dočasná základna' in d['opt'] and '0,42' in d['opt'] and 'Dočasná základna z bodu BG-ZAKL' in d['txt'], d)
        await page.click('#ag-dgps-back')
        await page.click('#ag-dgps-close')
        await page.wait_for_timeout(300)

        # ---- I: souhra se zbytkem appky ----------------------------------------------------
        await page.evaluate("() => { try { closeBottomSheet(); } catch (e) {} var p = arPoints.find(x => x.id === 'cp_M'); showDetails(p, 40); }")
        await cekej(page, "document.getElementById('ag-kb-bento')", 40)
        karta = await page.evaluate("() => (document.getElementById('ag-kb-bento') || {}).textContent || ''")
        ok('I1 karta bodu ukazuje dlaždici „Korekce GPS" s velikostí a původem (před a po)', 'Korekce GPS' in karta and 'chůze po hraně' in karta and 'před a po' in karta, karta[:300])
        duv = await page.evaluate("() => { const p = persistentCustomPoints.find(x => x.id === 'cp_M'); const v = AGDuvera.bod(p); return { proc: v.proc, kor: v.korekce }; }")
        ok('I2 karta důvěry (js/duvera.js) říká, že se k bodu přičetla korekce z chůze po hraně', duv['kor'] and 'chůze po hraně' in duv['kor'] and 'před a po' in duv['kor'] and duv['kor'] in duv['proc'], duv)
        await page.evaluate("() => { try { closeBottomSheet(); } catch (e) {} }")
        # DGPS z QR nesmí bod s korekcí z chůze opravit podruhé
        dq = await page.evaluate("""() => { const now = Date.now(); const log = { kind: 'dgps-log', base: { name: 'ZAKL', lat: %r, lng: %r }, t0: now - 30 * 60000, t1: now, buckets: [{ t: now - 60000, dE: 0.5, dN: 0.5, n: 30 }] };
            const rows = AGDgps._test.candidates ? AGDgps._test.candidates(log) : null; return rows ? rows.map(r => [r.p.name, r.state]) : 'bez _test.candidates'; }""" % (LAT, LNG))
        ok('I3 DGPS z QR bere bod z Přesné GPS s korekcí (prov.refShift) jako už korigovaný', dq == 'bez _test.candidates' or any(n == 'BG-ZAKL' and st == 'done' for n, st in dq), dq)
        kol = await page.evaluate("() => { if (!window.AGKolecko || !AGKolecko.groups) return null; const g = AGKolecko.groups(); const pm = g.find(x => x.full === 'Přesné měření' || x.t === 'Přesné měření'); return { n: g.length, pm: pm ? pm.items.length : 0 }; }")
        ok('I4 kolečko nástrojů zná skupinu Přesné měření (7 položek)', kol is None or (kol['pm'] == 7), kol)
        ges = await page.evaluate("() => !!(window.AGUkony && AGUkony.has && AGUkony.has('presne-mereni') && AGUkony.has('kalibrace-hranou'))")
        ok('I5 seznam úkonů/gesta umí nové nástroje spustit (AGUkony.has)', ges)
        ok('Z0 bez chyb v konzoli z nových modulů', not any(('presne' in c or 'hrana' in c or 'brutal' in c or 'dgps' in c) for c in chyby), chyby[-5:])
        await br.close()


def main():
    srv, url = server(PORT)
    if not srv:
        print('CHYBA: server nenastartoval')
        sys.exit(2)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    sys.exit(1 if spatne else 0)


if __name__ == '__main__':
    main()
