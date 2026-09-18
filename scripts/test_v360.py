# -*- coding: utf-8 -*-
u"""Regrese k úklidu 18. 9. 2026 (v360): navigace k dalekému bodu, podklad mapy, Nástroje, Nastavení → Aplikace.

  A  TRASA K DALEKÉMU CÍLI (hlášení „k niveláku a k TB vede pořád jen přímka"): do 18. 9. se nad 3 km trasa
     nepočítala. Teď 4,4 km → trasa z dlaždic z14, 9 km → z13, 18 km → trasa (hrubá mřížka), 25 km → přímka
     s důvodem „dál než 20 km". Cíl na zdi budovy (nivelační čep) → trasa dojde AŽ K NĚMU (oprava: `b`
     se v hledej() četlo před deklarací, uvolnění políčka cíle nikdy neproběhlo).
  B  PODKLAD MAPY: karta rastru (#ms-base-osm) je pryč; v Podkladu jsou Mapa (vektor), Ortofoto a Katastr
     (přepínač vrstvy, #btn-katastr); ve Vrstvách řádek Katastrální mapa už není; vektor je VÝCHOZÍ zapnutý
     (bez uložené volby + fixture → stav zapnuto); hlídač okolí hlásí toastem, ne dialogem.
  C  NÁSTROJE (uživatel prošel všechny): 17 dalších schovaných (strop 30), žádný schovaný nástroj v seznamu
     úkonů ani v okně rozcestníku; Srovnat AR = jen Kompas + Srovnat sever; Přesné měření = průvodce, Přesná GPS,
     Opravit GPS (rozcestník: chůzí po hraně · z mapy · podle bodu), Dvěma telefony (DGPS · akustika),
     Kontrolní měření, Kde se dá měřit; Lovci bodů v Učit se; Skryté body v Zaznamenat; Vzdálené body do AR
     v Podkladech; „Proč ±N m?" bere živou přesnost GPS; profily práce bez schovaných nástrojů;
     Korekce přejmenovaná na „Skutečnou délku z pásma nebo dálkoměru".
  D  NASTAVENÍ → APLIKACE (dřív Údržba + boční „Více"): čtyři sekce v pořadí Pomoc a návody · O aplikaci ·
     Záloha · Místo v telefonu; tlačítka modulů na svém místě (Funguje mi všechno?, Napsat autorovi pod Pomoc;
     Historie pod O aplikaci); žádné tlačítko „Více" (toggleMenu); Skryté body v Data → Zakázka; pruh pod
     záložkami = Návod; záložka se jmenuje Aplikace; hledání v Nastavení zná „Aplikace".
  E  bez chyb stránky

Spuštění:  python scripts/test_v360.py [port]
"""
import io
import os
import re
import sys
import json
import asyncio

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_mapa_vektor as T  # noqa: E402  (server s fixture, stranka, cekej, INIT)

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9260)
vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


SCHOVANE = ['ar-metr', 'openCheckDist', 'openDmtVolume', 'track-log', 'kvalita-bodu', 'overeni-bodu', 'usadit-ar',
            'srovnat-sever', 'ar-calib2', 'orient-point', 'sever-slunce', 'fov-kalib', 'ar-visual-track',
            'sky-obstruction', 'prohlidka', 'vektor-mapa', 'brifink']


def staticke():
    t = src('js/trasa-terenem.js')
    ok('A0s trasa-terenem: MAX_STRANA 20 km, BLIZKO 3 km, větší rozpočet buněk pro dálku', 'MAX_STRANA = 20000' in t and 'BLIZKO = 3000' in t and 'MAX_BUNEK_DALKA' in t)
    ok('A0s hledej(): `b` deklarované PŘED uvolněním políčka cíle (R0)', t.index('var minC = 0.7, b = r.bunka;') < t.index('var R0 = Math.ceil(2 / b);'))
    ok('A0s mapa-data: limity dlaždic po zoomu (z15/z14/z13), cache ≥ 64', "MAX_DLAZDIC = { 15: 16, 14: 25, 13: 64 }" in src('js/mapa-data.js') and 'MAX_CACHE = 100' in src('js/mapa-data.js'))
    ix = src('index.html')
    ok('B0s index.html: bez karty rastru, Katastr karta v Podkladu, žádný řádek Katastrální mapa ve Vrstvách', 'id="ms-base-osm"' not in ix and 'id="btn-katastr" class="ms-pod-c' in ix and 'class="ms-row" id="btn-katastr"' not in ix)
    ok('B0s mapa-vektor: výchozí zapnuto', "var st = { zap: true, styl: 'auto', url: '' }" in src('js/mapa-vektor.js'))
    h = src('js/hlidac-okoli.js')
    ok('B0s hlídač okolí hlásí změnu stavu toastem, ne dialogem agInfo (s mapou pro všechny by nag vyskakoval u každého domu)', "window.agInfo && window.agInfo(s.text" not in h and "quickToast" in h[h.index('function tik()'):h.index('function popisProBod')])
    r = src('js/tools-registry.js')
    for k in SCHOVANE:
        m = re.search(r"\{ k: '%s'[^\n]*" % re.escape(k), r)
        ok('C0s %s je hidden' % k, m and 'hidden: 1' in m.group(0), m and m.group(0)[:80])
    ok('C0s strop schovaných je 30', 'HIDDEN_MAX = 30' in src('scripts/check_tools_registry.py'))
    ok('C0s rozcestníky opravit-gps a dva-telefony v registru i v HUBS', "k: 'opravit-gps'" in r and "k: 'dva-telefony'" in r and "id: 'opravit-gps'" in src('js/tools-hub.js') and "id: 'dva-telefony'" in src('js/tools-hub.js'))
    ok('C0s korekce přejmenovaná', "vl: 'Skutečnou délku z pásma nebo dálkoměru'" in r and "vl: 'S korekcí na teplotu a tlak'" not in r)
    ok('C0s profily práce bez schovaných nástrojů', not any(("'%s'" % k) in r[r.index('var PROFILES'):r.index('var T = [')] for k in SCHOVANE))
    ok('C0s návody rozcestníků ve všech jazycích', all(('"opravit-gps"' in src('data/navody%s.json' % l) and '"dva-telefony"' in src('data/navody%s.json' % l)) for l in ['', '-en', '-de', '-pl', '-es', '-it']))
    ok('D0s index.html: Aplikace bez „Více" (toggleMenu) v tab-udrzba, Skryté body v tab-data, pruh = Návod', 'toggleMenu' not in ix[ix.index('id="tab-udrzba"'):ix.index('id="tab-profily"')] and ix.index('id="set-skryte-body"') > ix.index('id="tab-data"') and ix.index('id="set-skryte-body"') < ix.index('id="tab-udrzba"') and 'toggleMenu' not in ix[ix.index('id="ag-set-strip"'):ix.index('class="modal-body"')])


async def beh(url):
    from playwright.async_api import async_playwright
    fixture = url.replace('/index.html', '/tests/fixtures/mapa-praha.pmtiles')
    async with async_playwright() as pw:
        br = await pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        chyby = []
        # ŽÁDNÁ uložená volba mapy (agMapaVektor_v1) — vektor musí naběhnout sám; adresa dat = fixture přes Nastavení → Data
        init = T.INIT + "localStorage.removeItem('agMapaVektor_v1'); localStorage.setItem('agMapaVektor_v1', JSON.stringify({url:%s}));" % json.dumps(fixture)
        ctx, page = await T.stranka(br, url, init, chyby)
        ok('0 appka nastartovala', await T.cekej(page, "document.body.classList.contains('app-started')"))

        # ================= B: podklad ==========================================================
        ok('B1 vektorová mapa naběhla SAMA (bez uložené volby zap)', await T.cekej(page, "window.AGMapaVektor && AGMapaVektor.nastaveni().zap === true && AGMapaVektor.stav() === 'zapnuto' && AGMapaVektor.mapa() && AGMapaVektor.mapa().isStyleLoaded()", 90), await page.evaluate("() => window.AGMapaVektor && [AGMapaVektor.stav(), AGMapaVektor.nastaveni(), AGMapaVektor.chyba()]"))
        await page.evaluate("() => { document.getElementById('map-controls').classList.add('expanded'); AGMapaPanel.tab('podklad'); }")
        await page.wait_for_timeout(400)
        b2 = await page.evaluate("""() => { var pod = document.querySelector('.ms-tab[data-ms-tab="podklad"]'); var karty = Array.from(pod.querySelectorAll('#ms-base .ms-pod-c')).map(b => ({ id: b.id, on: b.classList.contains('on'), t: b.querySelector('b').textContent.trim() }));
            var vr = document.querySelector('.ms-tab[data-ms-tab="vrstvy"]'); return { karty: karty, rastr: !!document.getElementById('ms-base-osm'), katastrVeVrstvach: !!vr.querySelector('#btn-katastr'), katastrVPodkladu: !!pod.querySelector('#btn-katastr') }; }""")
        ok('B2 Podklad = Mapa (svítí) · Ortofoto · Katastr; bez karty rastru; Katastr není ve Vrstvách', b2 and [k['id'] for k in b2['karty']] == ['ms-base-vektor', 'btn-baselayer', 'btn-katastr'] and b2['karty'][0]['on'] and b2['karty'][0]['t'] == 'Mapa' and not b2['karty'][1]['on'] and not b2['rastr'] and b2['katastrVPodkladu'] and not b2['katastrVeVrstvach'], b2)
        b3 = await page.evaluate("() => { var k = document.getElementById('btn-katastr'); k.click(); var po = k.classList.contains('ctrl-active') && !!visSettings.showKatastr; k.click(); return { po: po, zpet: !k.classList.contains('ctrl-active') && !visSettings.showKatastr, mapaOn: document.getElementById('ms-base-vektor').classList.contains('on') }; }")
        ok('B3 karta Katastr zapíná/vypíná vrstvu, karta Mapa svítí dál', b3 and b3['po'] and b3['zpet'] and b3['mapaOn'], b3)
        await page.evaluate("() => { document.getElementById('map-controls').classList.remove('expanded'); }")

        # ================= A: daleký cíl =======================================================
        ok('A0 moduly trasy a dat', await T.cekej(page, "window.AGTrasa && window.AGMapaData && window.AGHrany", 30))
        await page.evaluate("() => { map.setView([50.0670, 14.4270], 17, { animate: false }); userLat = 50.0670; userLng = 14.4270; }")
        await T.cekej(page, "AGMapaVektor.budovy().length > 20", 60)
        a = await page.evaluate("""async () => {
            var me = { lat: 50.0670, lng: 14.4270 }; var out = {};
            var cases = [['4km', 0.03, 0.04, 'NIVEL'], ['9km', 0.06, 0.09, 'TB'], ['18km', 0.12, 0.18, 'TB'], ['22km', 0.2, 0.25, 'TB']];
            for (var i = 0; i < cases.length; i++) {
                var c = cases[i], cil = { lat: me.lat + c[1], lng: me.lng + c[2] };
                var p = { id: 'p_' + c[0], name: c[0], lat: cil.lat, lng: cil.lng, type: c[3] === 'NIVEL' ? 'vyskovy' : 'polohovy', cat: c[3], hidden: false, currentDist: 0 };
                arPoints.push(p); highlightedPointId = p.id;
                var t0 = Date.now(); var t = AGTrasa.prepocitej('test');
                // první výsledek bývá z výřezu (mapa na obrazovce); po dojetí dlaždic se trasa přepočítá sama
                for (var k = 0; k < 60 && ((!t && /stahuj|načítaj/.test(AGTrasa.diag())) || (t && t.zdroj !== 'dlaždice')); k++) { await new Promise(r => setTimeout(r, 500)); t = AGTrasa.trasa(); }
                out[c[0]] = { t: !!t, diag: AGTrasa.diag(), lomu: t && t.body.length, delka: t && Math.round(t.delka), bunka: t && t.bunka, z: t && t.z, zdroj: t && t.zdroj, ms: t && t.ms, cas: Date.now() - t0, d: Math.round(AGHrany.dist(me, cil)) };
                highlightedPointId = null; arPoints.splice(arPoints.indexOf(p), 1);
            }
            return out; }""")
        ok('A1 nivelační bod 4,4 km: trasa z dlaždic z14 (ne přímka), mřížka ≤ 8 m', a and a['4km']['t'] and a['4km']['z'] == 14 and a['4km']['zdroj'] == 'dlaždice' and a['4km']['lomu'] >= 3 and a['4km']['bunka'] <= 8, a and a['4km'])
        ok('A2 TB 9 km: trasa z dlaždic z13, do 4 s', a and a['9km']['t'] and a['9km']['z'] == 13 and a['9km']['lomu'] >= 3 and a['9km']['cas'] < 4000, a and a['9km'])
        ok('A3 TB 18 km: trasa existuje (hrubá mřížka ≤ 28 m)', a and a['18km']['t'] and a['18km']['bunka'] <= 28, a and a['18km'])
        ok('A4 22 km (strana obdélníku > 20 km): přímka s důvodem „dál než 20 km"', a and not a['22km']['t'] and 'dál než 20 km' in a['22km']['diag'], a and a['22km'])
        # cíl na zdi: budovy z DLAŽDIC (AGMapaData), ne z výřezu mapy — výřez závisí na tom, co MapLibre zrovna načetl
        await page.evaluate("() => { userLat = %f; userLng = %f; }" % (T.LAT, T.LNG))
        a5 = await page.evaluate("""async () => { var me = { lat: %f, lng: %f };
            var d = await AGMapaData.oblast({ s: me.lat - 0.002, w: me.lng - 0.003, n: me.lat + 0.002, e: me.lng + 0.003 });
            // zeď, která má PŘED SEBOU volno (v pražském bloku je většina zdí sdílená se sousedem → uvnitř bloku)
            var polys = []; d.buildings.forEach(f => { if (f.geom === 'Polygon') f.polys.forEach(pp => polys.push(pp[0])); });
            function vRingu(ring, q) { var ins = false; for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) { var yi = ring[i].lat, xi = ring[i].lng, yj = ring[j].lat, xj = ring[j].lng; if (((yi > q.lat) !== (yj > q.lat)) && (q.lng < (xj - xi) * (q.lat - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
            function vBudove(q) { for (var i = 0; i < polys.length; i++) if (vRingu(polys[i], q)) return true; return false; }
            var m = AGHrany.mPerDeg(me.lat), zed = null;
            for (var pi = 0; pi < polys.length && !zed; pi++) {
                var ring = polys[pi]; if (ring.length < 4 || AGHrany.dist(me, ring[0]) < 30 || AGHrany.dist(me, ring[0]) > 150) continue;
                for (var ei = 0; ei + 1 < ring.length && !zed; ei++) {
                    var a = ring[ei], c = ring[ei + 1], L = AGHrany.dist(a, c); if (L < 6) continue;
                    var mid = { lat: (a.lat + c.lat) / 2, lng: (a.lng + c.lng) / 2 };
                    var dx = (c.lng - a.lng) * m.lng, dy = (c.lat - a.lat) * m.lat, nx = -dy / L, ny = dx / L;   // normála v metrech
                    [1, -1].forEach(function (sg) { if (zed) return; var q = { lat: mid.lat + sg * ny * 4 / m.lat, lng: mid.lng + sg * nx * 4 / m.lng }; if (!vBudove(q)) zed = mid; });
                }
            }
            if (!zed) return { zadna: true, t: false, budov: d.buildings.length };
            var p = { id: 'p_cep', name: 'NB-čep', lat: zed.lat, lng: zed.lng, type: 'vyskovy', cat: 'NIVEL', hidden: false, currentDist: 0 }; arPoints.push(p); highlightedPointId = p.id;
            var t = AGTrasa.prepocitej('test'); var out = { t: !!t, nedos: t && t.nedosazitelne, lomu: t && t.body.length, konecNaCili: t && Math.abs(t.body[t.body.length - 1].lat - zed.lat) < 1e-9, zdroj: t && t.zdroj, diag: AGTrasa.diag() };
            highlightedPointId = null; arPoints.splice(arPoints.indexOf(p), 1); return out; }""" % (T.LAT, T.LNG))
        ok('A5 nivelační čep NA ZDI budovy: trasa dojde až k němu (ne „nedosažitelné")', a5 and a5['t'] and not a5['nedos'] and a5['konecNaCili'], a5)

        # ================= C: nástroje =========================================================
        await page.evaluate("() => { document.getElementById('map-controls').classList.remove('expanded'); }")
        await page.tap('#dock-nastroje-btn')
        ok('C0 seznam úkonů otevřený', await T.cekej(page, "window.AGUkony && document.getElementById('ag-uk-list') && getComputedStyle(document.getElementById('tools-modal')).display !== 'none'", 30))
        await page.evaluate("() => { currentGpsAccuracy = 2.7; AGUkony.rebuild(); }")
        await page.wait_for_timeout(400)
        c = await page.evaluate("""() => {
            var host = document.getElementById('ag-uk-list'); var strany = {};
            host.querySelectorAll('.ag-uk-page').forEach(function (p) { strany[p.getAttribute('data-page')] = Array.from(p.querySelectorAll('.ag-uk-i:not(.ag-uk-sub-i)')).map(r => r.getAttribute('data-k')).filter(Boolean); });
            var vsechny = [].concat.apply([], Object.keys(strany).map(k => strany[k]));
            var hub = host.querySelector('.ag-uk-i[data-k="opravit-gps"]'); var hubSub = hub ? hub.querySelector('.ag-uk-i-h, small, .ag-uk-sub-t') : null;
            var hubRow = hub && hub.textContent;
            var gnss = host.querySelector('.ag-uk-i[data-k="gnss-signal"]'); if (gnss) gnss.click();
            var procRow = host.querySelector('.ag-uk-sub-i[data-k="chybovy-rozpocet"]');
            return { strany: strany, vsechny: vsechny, hubRow: hubRow, proc: procRow && procRow.textContent, hubItems: AGReg.hubItems('gnss-signal'), pod: AGReg.hubItems('podklady-katastr'), lovci: AGReg.get('lovci-bodu').verb, skryte: AGReg.get('hidden-points').verb, dosah: AGReg.hubOf('ar-dosah') }; }""")
        schov_v_seznamu = [k for k in SCHOVANE if c and k in c['vsechny']]
        ok('C1 žádný schovaný nástroj v seznamu úkonů', c and not schov_v_seznamu, schov_v_seznamu)
        ok('C2 Srovnat AR = jen Kompas + Srovnat sever', c and c['strany'].get('Srovnat AR') == ['kompas', 'agOpenCalibrate'], c and c['strany'].get('Srovnat AR'))
        ok('C3 Přesné měření = průvodce, Přesná GPS, Opravit GPS, Dvěma telefony, Kontrolní měření, Kde se dá měřit', c and c['strany'].get('Přesné měření') == ['presne-mereni', 'brutal-gps', 'opravit-gps', 'dva-telefony', 'dvoji-mereni', 'kvalita-gps-mapa'], c and c['strany'].get('Přesné měření'))
        ok('C4 řádek Opravit GPS vypisuje své položky', c and c['hubRow'] and 'chůzí po hraně' in c['hubRow'] and 'z mapy za chůze' in c['hubRow'] and 'podle známého bodu' in c['hubRow'], c and c['hubRow'])
        ok('C5 „Proč ±2,7 m?" bere živou přesnost GPS (rozbalený Signál GNSS)', c and c['proc'] and 'Proč ±2,7 m?' in c['proc'], c and c['proc'])
        ok('C6 hubItems bez schovaných (sky-obstruction), Podklady mají ar-dosah, ne prohlidku', c and 'sky-obstruction' not in c['hubItems'] and 'ar-dosah' in c['pod'] and 'prohlidka' not in c['pod'] and 'vektor-mapa' not in c['pod'], c and (c['hubItems'], c['pod']))
        # „Učit se" je sekce na stránce Další (sloučená slovesa, test_v332 A3b)
        ok('C7 Lovci bodů v Učit se (stránka Další), Skryté body v Zaznamenat, Vzdálené body v rozcestníku Podklady', c and c['lovci'] == 'Učit se' and c['skryte'] == 'Zaznamenat' and c['dosah'] == 'podklady-katastr' and 'lovci-bodu' in c['strany'].get('dalsi', []) and 'lovci-bodu' not in c['strany'].get('Zaznamenat', []) and 'hidden-points' in c['strany'].get('Zaznamenat', []) and 'hidden-points' not in c['strany'].get('Katastr a podklady', []), c and (c['lovci'], c['skryte'], c['dosah'], c['strany'].get('dalsi')))
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'none'; }")

        # ================= D: Nastavení → Aplikace =============================================
        await page.evaluate("() => { openSettings(); switchTab('tab-udrzba', document.getElementById('tabbtn-udrzba')); }")
        await page.wait_for_timeout(1200)
        d = await page.evaluate("""() => {
            var tab = document.getElementById('tab-udrzba'); var kids = Array.from(tab.children); var sekce = [], cur = null;
            kids.forEach(function (el) { if (el.classList.contains('set-h')) { cur = { h: (el.getAttribute('data-ag-cs') || el.textContent).trim(), ids: [] }; sekce.push(cur); } else if (cur) { cur.ids.push(el.id || (el.getAttribute('onclick') || '').slice(0, 30)); } });
            var lbl = document.querySelector('#tabbtn-udrzba b'); var strip = document.getElementById('ag-set-vice');
            var sk = document.getElementById('set-skryte-body');
            return { sekce: sekce, lbl: lbl && lbl.textContent.trim(), vice: !!tab.querySelector('[onclick*="toggleMenu"]'), strip: strip && (strip.getAttribute('onclick') || ''), skryteVData: !!(sk && sk.closest('#tab-data')), skrytePodZakazka: (function () { if (!sk) return false; var p = sk.previousElementSibling; while (p && !p.classList.contains('set-h')) p = p.previousElementSibling; return !!(p && /Zakázka/.test(p.getAttribute('data-ag-cs') || p.textContent)); })(), hled: (window.AGSettingsSearch || window.AGNastaveniHledani) ? true : null }; }""")
        nadpisy = [s['h'] for s in d['sekce']] if d else []
        ok('D1 Aplikace: sekce v pořadí Pomoc a návody · O aplikaci · Záloha · Místo v telefonu', d and nadpisy[:4] == ['Pomoc a návody', 'O aplikaci', 'Záloha', 'Místo v telefonu'], nadpisy)
        def sek(h):
            return next((s['ids'] for s in d['sekce'] if s['h'] == h), []) if d else []
        ok('D2 Pomoc a návody = Návod, Funguje mi všechno?, Napsat autorovi', 'set-navod-btn' in sek('Pomoc a návody') and 'ag-zdravi-set-btn' in sek('Pomoc a návody') and 'ag-fb-set-btn' in sek('Pomoc a návody'), sek('Pomoc a návody'))
        ok('D3 O aplikaci = O aplikaci + Historie aktualizací', 'set-about-btn' in sek('O aplikaci') and 'hist-set-btn' in sek('O aplikaci'), sek('O aplikaci'))
        ok('D4 Záloha má tlačítka zálohy a profil zařízení; Místo v telefonu má úklid', any('exportAllData' in x for x in sek('Záloha')) and 'ag-dev-box' in sek('Záloha') and any('clearAllPoints' in x for x in sek('Místo v telefonu')), (sek('Záloha'), sek('Místo v telefonu')))
        ok('D5 záložka se jmenuje Aplikace, bez „Více", pruh pod záložkami = Návod (startTutorial)', d and d['lbl'] == 'Aplikace' and not d['vice'] and 'startTutorial' in (d['strip'] or '') and 'toggleMenu' not in (d['strip'] or ''), d and (d['lbl'], d['vice'], d['strip']))
        ok('D6 Skryté body v Data pod sekcí Zakázka', d and d['skryteVData'] and d['skrytePodZakazka'], d)
        await page.evaluate("() => { document.getElementById('settings-modal').style.display = 'none'; }")

        vazne = [x for x in chyby if 'Failed to load resource' not in x and 'WebGL' not in x and 'ERR_FAILED' not in x]
        ok('E bez chyb stránky', not vazne, vazne[:5])
        await ctx.close()


def main():
    staticke()
    srv, url = T.server(PORT)
    if not srv:
        print('CHYBA: server se nepodarilo spustit'); return 2
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('-' * 60)
    print('proslo %d / %d' % (len(vysledky) - len(spatne), len(vysledky)))
    return 1 if spatne else 0


if __name__ == '__main__':
    sys.exit(main())
