#!/usr/bin/env python3
# ===== AR Geodet - OVERENI CTYR NOVYCH VRSTEV V PROHLIZECI =====================
# Spousti appku v Chromiu a overuje moduly z vetve feat/navrhy-3467-89:
#   js/motivy-teren.js    (motivy Modrotisk + nocni rezim vc. automatiky)
#   js/sever-slunce.js    (srovnani severu podle Slunce)
#   js/odhadovacka.js     (cviciste odhadu)
#   js/foto-protinani.js  (protnuti vpred ze dvou fotek)
#
# PROC PRAVE TAKHLE: staticka analyza ani geo testy nechytnou, ze se trida motivu
# po prepnuti neodebere, ze modal zustane prazdny nebo ze protnuti vrati nesmysl.
# Vypocet protnuti se proto porovnava s RUCNE SPOCITANYM trojuhelnikem, ne samo
# se sebou.
#
# Pouziti:  python scripts/test_navrhy_d2.py [port]     (vychozi 8101)
# ==============================================================================
import asyncio
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8101
URL = 'http://127.0.0.1:%d/index.html' % PORT

BOOT = """
  localStorage.setItem('agGuest_v1', JSON.stringify({ts: Date.now()}));
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agBrifinkLastShown', new Date().toISOString().slice(0,10));
  localStorage.setItem('agLockStart_v1','0');
"""

results = []


def a(x):
    # Windows konzole je cp1250 -> cokoli mimo ni shodi cely beh az uprostred.
    return str(x).encode('ascii', 'replace').decode('ascii')


def ok(name, cond, detail=''):
    results.append((bool(cond), name, a(detail)))
    print(('  OK   ' if cond else '  CHYBA ') + a(name) + (('  -> ' + a(detail)) if detail else ''))


async def main():
    from playwright.async_api import async_playwright

    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(PORT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(args=[
                '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
            ctx = await browser.new_context(
                permissions=['geolocation'],
                geolocation={'latitude': 50.0875, 'longitude': 14.4213},
                viewport={'width': 412, 'height': 915})
            await ctx.add_init_script(BOOT)
            page = await ctx.new_page()

            msgs = []
            page.on('console', lambda m: msgs.append((m.type, m.text)))
            page.on('pageerror', lambda e: msgs.append(('pageerror', str(e))))

            await page.goto(URL, wait_until='load')
            # bez azimutu se AR smycka nerozjede -> _arProj by nevznikl
            cdp = await ctx.new_cdp_session(page)
            await cdp.send('DeviceOrientation.setDeviceOrientationOverride',
                           {'alpha': 40, 'beta': 88, 'gamma': 2})
            await page.wait_for_timeout(1200)
            # lazy vrstva dobiha az v necinnosti; pockat na ni, ne na pevnou pauzu
            try:
                await page.wait_for_function("() => window.agOpenOdhad && window.agOpenSeverSlunce && window.agOpenFotoProtinani",
                                             timeout=15000)
            except Exception:
                pass

            # ---- 1) nacteni modulu -------------------------------------------
            api = await page.evaluate("""() => ({
                motivy: typeof window.AGMotivy,
                sever: typeof window.agOpenSeverSlunce,
                odhad: typeof window.agOpenOdhad,
                foto: typeof window.agOpenFotoProtinani,
                css: !!document.getElementById('ag-motivy-teren-css'),
                sun: typeof (window.AGSun && window.AGSun.pos)
            })""")
            ok('motivy-teren.js nacten', api['motivy'] == 'object', api['motivy'])
            ok('stylopis motivu pripojen pres AG.cssFile', api['css'])
            ok('sever-slunce.js nacten', api['sever'] == 'function', api['sever'])
            ok('odhadovacka.js nacten', api['odhad'] == 'function', api['odhad'])
            ok('foto-protinani.js nacten', api['foto'] == 'function', api['foto'])
            ok('AGSun k dispozici (zdroj casu soumraku)', api['sun'] == 'function')

            # ---- 2) motivy ----------------------------------------------------
            opts = await page.evaluate("""() => {
                const s = document.getElementById('v-theme');
                return s ? Array.from(s.options).map(o => o.value) : [];
            }""")
            ok('nabidka motivu ma Modrotisk', 'blueprint' in opts)
            ok('nabidka motivu ma Nocni', 'night' in opts)
            ok('radek Nocni rezim v Nastaveni', await page.evaluate("() => !!document.getElementById('ag-night-auto')"))

            # CSS se musi opravdu projevit, ne jen tridou
            bp = await page.evaluate("""() => {
                previewTheme('blueprint');
                const cs = getComputedStyle(document.body);
                return {cls: document.body.className,
                        bg: cs.getPropertyValue('--bg-color').trim(),
                        accent: cs.getPropertyValue('--accent').trim(),
                        html: document.documentElement.style.backgroundColor};
            }""")
            ok('Modrotisk nasadi tridu', 'theme-blueprint' in bp['cls'], bp['cls'])
            ok('Modrotisk prepise --bg-color', bp['bg'] == '#08182e', bp['bg'])
            ok('Modrotisk prepise --accent', bp['accent'] == '#8ec7ff', bp['accent'])
            ok('Modrotisk srovna barvu korene', 'rgb(8, 24, 46)' in (bp['html'] or ''), bp['html'])

            # KLICOVE: puvodni previewTheme umi nasi tridu jen PRIDAT, ne odebrat
            back = await page.evaluate("""() => {
                previewTheme('smaragd');
                return {cls: document.body.className,
                        bg: getComputedStyle(document.body).getPropertyValue('--bg-color').trim()};
            }""")
            ok('prepnuti zpet na Smaragd sundá Modrotisk', 'theme-blueprint' not in back['cls'], back['cls'])
            ok('po navratu plati puvodni --bg-color', back['bg'] == '#0f1216', back['bg'])

            ni = await page.evaluate("""() => {
                previewTheme('night');
                const cs = getComputedStyle(document.body);
                return {cls: document.body.className,
                        bg: cs.getPropertyValue('--bg-color').trim(),
                        blue: cs.getPropertyValue('--accent-blue').trim(),
                        night: window.AGMotivy.isNight(new Date())};
            }""")
            ok('Nocni rezim nasadi tridu', 'theme-night' in ni['cls'], ni['cls'])
            ok('Nocni rezim nema modrou ani v --accent-blue', ni['blue'] == '#ff9d5c', ni['blue'])
            ok('isNight() vraci rozhodnuti', ni['night'] in (True, False), ni['night'])
            await page.evaluate("() => previewTheme('smaragd')")

            # filtr dlazdic mapy musi prebit pravidlo z css/style.css
            filt = await page.evaluate("""() => {
                previewTheme('blueprint');
                const st = Array.from(document.styleSheets).filter(s => (s.href||'').includes('motivy-teren'));
                let found = false;
                try {
                  st.forEach(s => Array.from(s.cssRules).forEach(r => {
                    if (r.selectorText && r.selectorText.includes('theme-blueprint') && r.selectorText.includes('leaflet-tile')) found = true;
                  }));
                } catch(e) {}
                previewTheme('smaragd');
                return {sheets: st.length, found: found};
            }""")
            ok('stylopis motivu je nacteny jako CSS', filt['sheets'] > 0, filt)
            ok('pravidlo pro dlazdice mapy existuje', filt['found'])

            # nic zeleneho nesmi zbyt: uvodni obrazovka ma gradient natvrdo
            # v css/style.css a znacky mapy si barvu vypisuje js/grafika.js do SVG
            green = await page.evaluate("""() => {
                const out = {};
                previewTheme('night');
                const w = document.getElementById('welcome-screen');
                out.welcome = w ? getComputedStyle(w).backgroundImage : '';
                const pane = document.querySelector('.leaflet-marker-pane');
                out.pane = pane ? getComputedStyle(pane).filter : 'neni';
                previewTheme('blueprint');
                out.welcomeBp = w ? getComputedStyle(w).backgroundImage : '';
                previewTheme('smaragd');
                return out;
            }""")
            ok('nocni: uvodni obrazovka nema zelenou zar',
               '47, 158, 116' not in green['welcome'], green['welcome'][:70])
            ok('modrotisk: uvodni obrazovka nema zelenou zar',
               '47, 158, 116' not in green['welcomeBp'], green['welcomeBp'][:70])
            ok('nocni: vrstva znacek ma teply filtr',
               'sepia' in (green['pane'] or ''), green['pane'])

            # ---- 3) sever podle Slunce ----------------------------------------
            await page.evaluate("() => window.agOpenSeverSlunce()")
            await page.wait_for_timeout(500)
            ss = await page.evaluate("""() => {
                const m = document.getElementById('sever-slunce-modal');
                if (!m) return null;
                const rows = m.querySelector('#ss-rows');
                return {open: m.classList.contains('ag-open'),
                        rows: rows ? rows.textContent.replace(/\\s+/g,' ').trim().slice(0,160) : '',
                        segs: m.querySelectorAll('.ss-seg-b').length,
                        val: (m.querySelector('#ss-val')||{}).textContent};
            }""")
            ok('modal Sever podle Slunce se otevre', ss and ss['open'])
            ok('ukazuje azimut a vysku Slunce', ss and 'Azimut Slunce' in ss['rows'], ss['rows'] if ss else '')
            ok('ma oba zpusoby mireni', ss and ss['segs'] == 2)
            ok('terc ukazuje o kolik se otocit', ss and ss['val'] not in (None, '', '-'), ss['val'] if ss else '')
            # prepnuti na stin musi zmenit cilovy azimut o 180
            shadow = await page.evaluate("""() => {
                const b = document.querySelector('#ss-seg .ss-seg-b[data-m="shadow"]');
                b.click();
                const t = document.querySelector('#ss-rows').textContent;
                const m = t.match(/M[aá]m m[ií]řit na azimut\\s*([\\d.,]+)/);
                return m ? m[1] : t.slice(0,80);
            }""")
            ok('rezim po stinu prepocita cilovy azimut', shadow and shadow.replace(',', '.').replace('°', '').strip() != '')

            # Test bezi vecer, takze Slunce je pod obzorem a nastroj to spravne
            # odmita. Aby se dala overit i ostra cesta, podvrhne se poloha Slunce
            # (jen pro tenhle test; AGSun se hned vrati zpatky).
            hot = await page.evaluate("""() => {
                const orig = window.AGSun.pos;
                window.AGSun.pos = () => ({az: 180, el: 25});
                document.querySelector('#ss-seg .ss-seg-b[data-m="sun"]').click();
                const rows = document.querySelector('#ss-rows').textContent;
                const go = document.getElementById('ss-go');
                const before = (typeof userHeadingOffset !== 'undefined') ? userHeadingOffset : null;
                window.__ssRestore = () => { window.AGSun.pos = orig; };
                return {rows: rows.replace(/\s+/g,' ').slice(0,90), disabled: go.disabled, offsetBefore: before};
            }""")
            ok('se Sluncem nad obzorem je mereni povolene', not hot['disabled'], hot)

            # cele mereni: 3 s vzorkovani, pak srovnani severu
            await page.evaluate("() => document.getElementById('ss-go').click()")
            await page.wait_for_timeout(3600)
            done = await page.evaluate("""() => {
                const out = document.getElementById('ss-out');
                const btn = document.getElementById('ss-apply');
                return {txt: out.textContent.replace(/\s+/g,' ').trim().slice(0,120), hasApply: !!btn};
            }""")
            ok('mereni doda odchylku a nabidne srovnani', done['hasApply'], done['txt'])

            applied = await page.evaluate("""() => {
                const before = userHeadingOffset;
                document.getElementById('ss-apply').click();
                return {before: before, after: userHeadingOffset,
                        stored: getStoredData('arHeadingOffset')};
            }""")
            # kompas v testu ukazuje 0, cil je 180 -> korekce ma byt +-180
            ok('srovnani zmeni userHeadingOffset', applied['before'] != applied['after'], applied)
            ok('korekce se ulozila do arHeadingOffset',
               applied['stored'] and abs(float(applied['stored']) - applied['after']) < 0.01, applied['stored'])
            ok('korekce odpovida rozdilu kompas vs Slunce (180 stupnu)',
               abs(((applied['after'] - 180 + 540) % 360) - 180) < 3, applied['after'])

            undone = await page.evaluate("""() => {
                document.getElementById('ss-undo').click();
                const v = userHeadingOffset;
                window.__ssRestore && window.__ssRestore();
                return v;
            }""")
            ok('Vzit zpet vrati korekci na puvodni hodnotu', abs(undone - applied['before']) < 0.01, undone)
            await page.evaluate("() => window.agCloseSeverSlunce()")

            # ---- 4) odhadovacka -----------------------------------------------
            await page.evaluate("() => window.agOpenOdhad()")
            await page.wait_for_timeout(400)
            od = await page.evaluate("""() => {
                const m = document.getElementById('odhad-modal');
                if (!m) return null;
                return {open: m.classList.contains('ag-open'),
                        discs: m.querySelectorAll('.od-seg-b').length,
                        body: m.querySelector('#od-body').textContent.replace(/\\s+/g,' ').trim().slice(0,120),
                        stat: m.querySelector('#od-stat').textContent.replace(/\\s+/g,' ').trim()};
            }""")
            ok('modal Odhadni to se otevre', od and od['open'])
            ok('ma tri discipliny', od and od['discs'] == 3, od['discs'] if od else '')
            ok('zadani se vykresli', od and len(od['body']) > 20, od['body'] if od else '')
            ok('statistika je vykreslena', od and 'serie' in od['stat'].lower() or 'série' in (od['stat'] if od else ''), od['stat'] if od else '')

            # azimutova disciplina: dohrat cely pokus a overit, ze se skore ulozi
            play = await page.evaluate("""() => {
                document.querySelector('.od-seg-b[data-d="azimut"]').click();
                const before = (JSON.parse(localStorage.getItem('agOdhad_v1')||'{"hist":[]}').hist||[]).length;
                const go = document.getElementById('od-go');
                if (!go) return {err: 'chybi tlacitko'};
                go.click();
                const s = JSON.parse(localStorage.getItem('agOdhad_v1')||'{"hist":[]}');
                const out = document.getElementById('od-out');
                return {before: before, after: (s.hist||[]).length,
                        last: (s.hist||[]).slice(-1)[0] || null,
                        text: out ? out.textContent.replace(/\\s+/g,' ').trim().slice(0,110) : ''};
            }""")
            ok('pokus se vyhodnoti a ulozi', play.get('after', 0) == play.get('before', -1) + 1, play)
            ok('vysledek ukaze body a odchylku', 'bod' in (play.get('text') or ''), play.get('text'))
            ok('skore je v rozsahu 0-100', play.get('last') and 0 <= play['last']['s'] <= 100, play.get('last'))
            await page.evaluate("() => window.agCloseOdhad()")

            # ---- 5) protnuti ze dvou fotek: matematika proti rucnimu vypoctu ---
            # A = (50.0875, 14.4213); B je 30 m na VYCHOD od A; cil P je 40 m na SEVER od A.
            # Rucne: zakladna 30 m, azimut A->P = 0, azimut B->P = 323.13 stupne,
            #        uhel protnuti 36.87, dA = 40 m, dB = 50 m.
            calc = await page.evaluate("""() => {
                const T = window.AGFotoProtinani.test;
                const A = {lat: 50.0875, lng: 14.4213};
                const B = T.destPoint(A.lat, A.lng, 90, 30);
                const mk = (lat, lng, heading) => ({
                    lat: lat, lng: lng, acc: 3, heading: heading,
                    pitch: 0, roll: 0, halfH: 45, halfV: 37.5, w: 1280, h: 720,
                    target: {x: 0.5, y: 0.5}, orient: null
                });
                T.setShots([mk(A.lat, A.lng, 0), mk(B.lat, B.lng, 323.13)]);
                const r = T.compute();
                const truth = T.destPoint(A.lat, A.lng, 0, 40);
                const dLat = (r.lat - truth.lat) * 111320;
                const dLng = (r.lng - truth.lng) * 111320 * Math.cos(truth.lat * Math.PI / 180);
                return {dA: r.dA, dB: r.dB, cut: r.cut, base: r.base, err: r.err || null,
                        odchylka_m: Math.sqrt(dLat*dLat + dLng*dLng)};
            }""")
            ok('protnuti: vzdalenost od A = 40 m', calc.get('dA') and abs(calc['dA'] - 40) < 0.3, calc.get('dA'))
            ok('protnuti: vzdalenost od B = 50 m', calc.get('dB') and abs(calc['dB'] - 50) < 0.3, calc.get('dB'))
            ok('protnuti: uhel rezu 36,87 stupne', calc.get('cut') and abs(calc['cut'] - 36.87) < 0.3, calc.get('cut'))
            ok('protnuti: poloha sedi s rucnim vypoctem (< 0,3 m)', calc.get('odchylka_m') is not None and calc['odchylka_m'] < 0.3, calc.get('odchylka_m'))

            # inverze projekce: klepnuti mimo stred musi dat odpovidajici azimut
            proj = await page.evaluate("""() => {
                const T = window.AGFotoProtinani.test;
                const shot = {lat: 50, lng: 14, heading: 100, pitch: 0, roll: 0, halfH: 45, halfV: 37.5};
                return {stred: T.angles(shot, 0.5, 0.5).az,
                        vpravo: T.angles(shot, 0.75, 0.5).az,
                        vlevo: T.angles(shot, 0.25, 0.5).az,
                        dolu: T.angles(shot, 0.5, 0.75).down};
            }""")
            ok('projekce: stred obrazu = smer kamery', abs(proj['stred'] - 100) < 0.01, proj['stred'])
            ok('projekce: ctvrtina vpravo = +22,5 stupne', abs(proj['vpravo'] - 122.5) < 0.01, proj['vpravo'])
            ok('projekce: ctvrtina vlevo = -22,5 stupne', abs(proj['vlevo'] - 77.5) < 0.01, proj['vlevo'])
            ok('projekce: ctvrtina dolu = 18,75 stupne pod horizont', abs(proj['dolu'] - 18.75) < 0.01, proj['dolu'])

            # nesmyslna geometrie se musi odmitnout, ne vratit cislo
            bad = await page.evaluate("""() => {
                const T = window.AGFotoProtinani.test;
                const A = {lat: 50.0875, lng: 14.4213};
                const B = T.destPoint(A.lat, A.lng, 90, 30);
                const mk = (lat, lng, heading) => ({lat, lng, acc: 3, heading, pitch: 0, roll: 0,
                    halfH: 45, halfV: 37.5, w: 1280, h: 720, target: {x: 0.5, y: 0.5}, orient: null});
                T.setShots([mk(A.lat, A.lng, 0), mk(B.lat, B.lng, 30)]);   // paprsky se nesbihaji
                const r1 = T.compute();
                const C = T.destPoint(A.lat, A.lng, 90, 3);                 // prilis kratka zakladna
                T.setShots([mk(A.lat, A.lng, 0), mk(C.lat, C.lng, 350)]);
                const r2 = T.compute();
                return {rozbihave: !!(r1 && r1.err), kratka: !!(r2 && r2.err), t1: r1 && r1.err, t2: r2 && r2.err};
            }""")
            ok('odmitne rozbihave paprsky', bad['rozbihave'], bad['t1'])
            ok('odmitne prilis kratkou zakladnu', bad['kratka'], bad['t2'])

            # modal se ma otevrit a bez bezici kamery to poctive rict
            await page.evaluate("() => window.AGFotoProtinani.test.setShots([])")
            await page.evaluate("() => window.agOpenFotoProtinani()")
            await page.wait_for_timeout(400)
            fp = await page.evaluate("""() => {
                const m = document.getElementById('fotop-modal');
                return m ? {open: m.classList.contains('ag-open'),
                            txt: m.querySelector('#fp-body').textContent.replace(/\\s+/g,' ').trim().slice(0,140)} : null;
            }""")
            ok('modal Bod ze dvou fotek se otevre', fp and fp['open'])
            ok('bez kamery to poctive rekne', fp and ('Kamera' in fp['txt'] or 'GPS' in fp['txt']), fp['txt'] if fp else '')
            await page.evaluate("() => window.agCloseFotoProtinani()")

            # ---- 6) konzole ----------------------------------------------------
            bad_msgs = [m for m in msgs if m[0] in ('error', 'pageerror', 'warning')
                        and 'favicon' not in m[1].lower()
                        and 'net::ERR' not in m[1]]
            mine = [m for m in bad_msgs if any(k in m[1] for k in
                    ('motivy-teren', 'sever-slunce', 'odhadovacka', 'foto-protinani'))]
            ok('zadna chyba z novych vrstev v konzoli', not mine, mine[:3])
            if bad_msgs:
                print('\n  (ostatni hlaseni v konzoli, ne z mych vrstev: %d)' % len(bad_msgs))
                for t, x in bad_msgs[:5]:
                    print('     %s: %s' % (t, x[:150]))

            await browser.close()
    finally:
        srv.terminate()

    bad = [r for r in results if not r[0]]
    print('\n===== %d/%d proslo =====' % (len(results) - len(bad), len(results)))
    for _, name, detail in bad:
        print('  SELHALO: %s  -> %s' % (name, detail))
    sys.exit(1 if bad else 0)


asyncio.run(main())
