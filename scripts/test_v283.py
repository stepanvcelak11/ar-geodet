#!/usr/bin/env python3
# ===== AR Geodet — KONTROLA ZMEN v283 ==========================================
# Zadani z 8. 9. 2026 (mluvene). Kazdy bod se overuje SPUSTENIM appky v prohlizeci,
# ne ctenim kodu — vetsina veci ze zadani je o tom, co uzivatel VIDI.
#
#   A) PRIHLASENI JE PRI KAZDEM STARTU. I kdyz je na zarizeni zapnuty rezim
#      vlastnika, appka MUSI ukazat branu (do teto chvile ji preskakovala).
#   B) VLASTNIK SE PRIHLASI JMENEM. Do pole kodu "VLASTNIK", do hesla klic ->
#      appka nastartuje a v Nastrojich pribude kategorie "Sprava aplikace".
#   C) MRIZKA NASTROJU JE ROZTRIDENA. Zadna kategorie nesmi mit vic nez MAX_KAT
#      dlazdic a zachytna sekce "Terenni nastroje" ma byt prazdna/pryc.
#   D) NAPSAT AUTOROVI JE PRVNI VEC V NASTROJICH (a je videt bez rolovani).
#   E) V MAPE U CILE NAVIGACE NENI AZIMUT (uzivatel: "ty stupne tam vymaz").
#   F) DLOUHY STISK NA MAPE ZMERI VZDALENOST od moji polohy.
#   G) LISTA "Nova verze" se sama neukazuje; aktualizace se vezme pri restartu.
#   H) VYBER OBDELNIKU V MAPE dotahne vzdalene body do AR.
#
# Pouziti (z korene repa):  python scripts/test_v283.py [port]
# ==============================================================================
import asyncio
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
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8971
URL = None

# Bezny prihlaseny uzivatel (appka dojede az k obrazovce).
BOOT = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('arSurveyor','Stepan');
  localStorage.setItem('agFirmaBioAsk_v1', String(Date.now()));
  (function () {
    var f = { enabled: true, firmName: 'Test', createdTs: Date.now(), autoLockMin: 0,
      users: [{ id: 'u1', name: 'Stepan', role: 'admin', salt: 'aa', pinHash: 'x', noPin: true }] };
    localStorage.setItem('agFirma_v1', JSON.stringify(f));
    localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: 'u1', ts: Date.now() }));
  })();
"""

# Telefon vyvojare: priznak vlastnika i klic uz ulozene, ZADNA firma.
BOOT_VLASTNIK = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agVlastnik_v1','1');
  localStorage.setItem('agFbKey_v1','klic-vlastnika-aspon-24-znaku!!');
"""

GEO = {'latitude': 50.0800, 'longitude': 14.4300, 'accuracy': 2.5}
MAX_KAT = 14          # vic dlazdic pod jednim nadpisem uz je "nahozene"

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)[:400]) if detail != '' else ''))


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
    # ⚠ Pod zatezenym strojem (soubezne bezici agenti) appka nabiha i 20 s, takze
    #   cekani MUSI byt smyckou na podminku, ne pevnym timeoutem.
    for _ in range(60):
        try:
            if await page.evaluate("() => " + cekej_na):
                break
        except Exception:
            pass
        try:
            await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        except Exception:
            pass
        await page.wait_for_timeout(500)
    await page.wait_for_timeout(1500)


# ---------------------------------------------------- A+B) prihlaseni vlastnika
async def test_vlastnik(ctx):
    print('\n--- A+B) vlastnik prochazi branou a prihlasuje se jmenem ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await ctx.add_init_script(BOOT_VLASTNIK)
    await nacti(page, "!!document.getElementById('ag-gate') || !!document.body.classList.contains('app-started')")

    for _ in range(40):
        if await page.evaluate("() => !!document.getElementById('ag-gate')"):
            break
        await page.wait_for_timeout(500)
    st = await page.evaluate("""() => ({
        brana: !!document.getElementById('ag-gate'),
        bezi: document.body.classList.contains('app-started'),
        vlastnik: (() => { try { return localStorage.getItem('agVlastnik_v1'); } catch (e) { return '?'; } })()
    })""")
    ok('brana se ukaze i vlastnikovi', st['brana'], st)
    ok('appka pod branou jeste nebezi', not st['bezi'], st)

    # server tu neni -> /owner/firms spadne na status 0 a modul pusti dovnitr
    # proti ULOZENEMU klici (nouzova cesta pro teren bez signalu)
    await page.evaluate("""() => {
        document.getElementById('agg-show-join').click();
        document.getElementById('agg-code').value = 'VLASTNIK';
        document.getElementById('agg-code').dispatchEvent(new Event('input'));
        document.getElementById('agg-pass').value = 'klic-vlastnika-aspon-24-znaku!!';
    }""")
    await page.wait_for_timeout(200)
    await page.evaluate("() => document.getElementById('agg-go').click()")
    # ⚠ Cekat na VYSLEDEK, ne pevnou dobu: overeni klice jde na server, ktery tu
    #   neni, a nez sit vyprsi, trva to pod zatezenym strojem i pres 10 s.
    for _ in range(40):
        if await page.evaluate("() => document.body.classList.contains('app-started')"):
            break
        await page.wait_for_timeout(500)
    await page.wait_for_timeout(800)
    st = await page.evaluate("""() => ({
        brana: !!document.getElementById('ag-gate'),
        bezi: document.body.classList.contains('app-started'),
        err: (document.getElementById('agg-err') || {}).textContent || ''
    })""")
    ok('po jmenu VLASTNIK + klici appka nastartuje', st['bezi'] and not st['brana'], st)

    # brana se nesmi za dve vteriny (tik gateCheck) vratit pres bezici appku
    await page.wait_for_timeout(3500)
    st2 = await page.evaluate("() => ({ brana: !!document.getElementById('ag-gate') })")
    ok('brana se po tiku nevrati pres bezici appku', not st2['brana'], st2)

    # nastroje spravy
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(1500)
    st3 = await page.evaluate("""() => {
        const g = document.querySelector('#tools-modal .tool-grid');
        const ids = [...g.querySelectorAll('[data-tool]')].map(e => e.getAttribute('data-tool'));
        return { kat: !!document.getElementById('agv-cat'),
                 ma: ['vlastnik-konzole','vlastnik-firmy','vlastnik-spravci','vlastnik-zpravy'].filter(k => ids.includes(k)) };
    }""")
    ok('v Nastrojich je kategorie Sprava aplikace', st3['kat'], st3)
    ok('vsechny ctyri nastroje spravy jsou v mrizce', len(st3['ma']) == 4, st3)
    ok('bez chyb v konzoli', not chyby, chyby[:3])
    await page.close()


# ------------------------------------------------------------- C+D) mrizka
async def test_mrizka(ctx):
    print('\n--- C+D) mrizka Nastroju je roztridena a psani autorovi je prvni ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await ctx.add_init_script(BOOT)
    await nacti(page, "document.body.classList.contains('app-started')")
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(2500)
    await page.evaluate("() => { document.getElementById('tools-modal').style.display='flex'; }")
    for _ in range(40):
        st0 = await page.evaluate("""() => ({
            dlazdic: document.querySelectorAll('#tools-modal .tool-tile').length,
            fb: !!document.getElementById('ag-fb-foot-tools')
        })""")
        if st0['dlazdic'] > 60 and st0['fb']:
            break
        await page.wait_for_timeout(500)
    await page.wait_for_timeout(800)

    st = await page.evaluate("""() => {
        const g = document.querySelector('#tools-modal .tool-grid');
        const out = []; let cur = null;
        for (const el of g.children) {
            if (el.classList.contains('tool-cat') || el.classList.contains('ag-ft-head')) {
                cur = { t: (el.textContent || '').trim(), n: 0 }; out.push(cur); continue;
            }
            if (el.classList.contains('tool-tile') && cur) cur.n++;
        }
        const mc = document.querySelector('#tools-modal .modal-content');
        const fb = document.getElementById('ag-fb-foot-tools') || mc.querySelector('.ag-fb-foot');
        let poradi = -1;
        if (fb) poradi = [...mc.children].indexOf(fb.closest('#tools-modal .modal-content > *') || fb);
        return { kat: out, celkem: [...g.querySelectorAll('.tool-tile')].length,
                 fb: !!fb, fbPoradi: poradi, deti: [...mc.children].map(e => e.id || e.className) };
    }""")
    print('    kategorie:', st['kat'])
    velke = [k for k in st['kat'] if k['n'] > MAX_KAT]
    ok('zadna kategorie neni prepchana (>%d dlazdic)' % MAX_KAT, not velke, velke)
    zachytna = [k for k in st['kat'] if k['t'] in ('Ostatní', 'Terénní nástroje') and k['n'] > 2]
    ok('zachytna sekce Ostatni je skoro prazdna (<=2)', not zachytna, zachytna)
    ok('kategorii je aspon sest', len([k for k in st['kat'] if k['n'] > 0]) >= 6, len(st['kat']))
    ok('Napsat autorovi je v Nastrojich', st['fb'], st['fbPoradi'])
    ok('Napsat autorovi stoji nahore (pred mrizkou)', 0 <= st['fbPoradi'] <= 2, st['deti'])
    ok('bez chyb v konzoli', not chyby, chyby[:3])
    await page.close()


# ---------------------------------------------- E+F+G) mapa, mereni prstem, lista
DOTYK = """([x, y, typ]) => {
    const el = document.getElementById('map-container');
    const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    el.dispatchEvent(new TouchEvent(typ, {
        bubbles: true, cancelable: true,
        touches: typ === 'touchend' ? [] : [t],
        targetTouches: typ === 'touchend' ? [] : [t],
        changedTouches: [t]
    }));
}"""


async def test_mapa(ctx):
    print('\n--- E+F+G) mapa: stupne pryc, mereni prstem, lista aktualizace ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await ctx.add_init_script(BOOT)
    await nacti(page, "document.body.classList.contains('app-started')")
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(2500)

    # G) lista "Nova verze" nesmi byt klikaci (uzivatel: zadny tlacitko)
    st = await page.evaluate("""() => {
        const b = document.getElementById('update-banner');
        return { je: !!b, onclick: b ? (b.getAttribute('onclick') || '') : 'NENI',
                 text: b ? (b.textContent || '').trim() : '' };
    }""")
    ok('lista Nova verze uz neni tlacitko', st['je'] and not st['onclick'], st)
    ok('lista rika, ze se verze vezme po restartu', 'spu' in st['text'] or 'restart' in st['text'].lower(), st['text'][:90])

    # pripominka zalohy: zadny plovouci pruh nad appkou
    st = await page.evaluate("() => ({ pruh: !!document.getElementById('ag-backup-bar') })")
    ok('plovouci pruh se zalohou uz v appce neni', not st['pruh'], st)

    # E) popisek cile navigace v mape: vzdalenost bez stupnu
    st = await page.evaluate("""() => {
        // vyrob bod ~120 m severne a udelej z nej cil navigace
        const lat = userLat, lng = userLng;
        if (lat == null) return { chyba: 'bez GPS' };
        const id = 'test-cil-1';
        const p = { id: id, name: 'Cil', lat: lat + 0.0011, lng: lng, type: 'custom' };
        arPoints.push(p);
        highlightedPointId = id;   // POZOR: `let` ve skript-scope, window.x je jina promenna
        if (typeof viewMode !== 'undefined' && viewMode === 'ar') { viewMode = 'both'; if (typeof applyViewMode === 'function') applyViewMode(); }
        if (window.AGCilNav && AGCilNav.redraw) AGCilNav.redraw(true);
        return { ok: true, view: (typeof viewMode !== 'undefined') ? viewMode : '?',
                 bezi: (typeof appStarted !== 'undefined') ? appStarted : '?',
                 modul: !!window.AGCilNav, bodu: arPoints.length };
    }""")
    print('    priprava cile:', st)
    await page.wait_for_timeout(2500)
    st = await page.evaluate("""() => {
        const l = [...document.querySelectorAll('.ag-cil-lbl')].map(e => (e.textContent || '').trim());
        return { popisky: l,
                 aureola: document.querySelectorAll('.ag-cil-halo').length,
                 cary: document.querySelectorAll('#map path[stroke="#fbbf24"]').length,
                 geo: (typeof getDistance === 'function') && (typeof getBearing === 'function'),
                 cil: (typeof highlightedPointId !== 'undefined') ? highlightedPointId : '?', view: (typeof viewMode !== 'undefined') ? viewMode : '?' };
    }""")
    stupne = [t for t in st['popisky'] if '\u00b0' in t or ' g' in t]
    ok('popisek cile v mape existuje', len(st['popisky']) > 0, st)
    ok('popisek cile neobsahuje stupne', not stupne, st)

    # F) podrzeni jednoho prstu na mape = vzdalenost od moji polohy
    await page.evaluate(DOTYK, [220, 400, 'touchstart'])
    await page.wait_for_timeout(900)
    st = await page.evaluate("""() => {
        const l = [...document.querySelectorAll('.tfm-label')].map(e => (e.textContent || '').trim());
        const cary = document.querySelectorAll('#map path.leaflet-interactive, #map path').length;
        return { stitky: l, cary: cary };
    }""")
    ok('po podrzeni prstu je videt vzdalenost', len(st['stitky']) > 0, st)
    await page.evaluate(DOTYK, [220, 400, 'touchend'])

    # a posun prstem se tim nesmi rozbit: rychly tah mapu posune
    stred0 = await page.evaluate("() => { const c = map.getCenter(); return [c.lat, c.lng]; }")
    await page.evaluate(DOTYK, [200, 300, 'touchstart'])
    await page.evaluate(DOTYK, [200, 240, 'touchmove'])
    await page.evaluate(DOTYK, [200, 180, 'touchmove'])
    await page.evaluate(DOTYK, [200, 180, 'touchend'])
    await page.wait_for_timeout(400)
    stred1 = await page.evaluate("() => { const c = map.getCenter(); return [c.lat, c.lng]; }")
    ok('rychly tah mapou porad posouva mapu', stred0 != stred1, [stred0, stred1])

    ok('bez chyb v konzoli', not chyby, chyby[:3])
    await page.close()


# ------------------------------------------- H) vzdalene body do AR pres vyrez
async def test_dosah(ctx):
    print('\n--- H) vyber obdelnikem pusti vzdalene body do AR ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await ctx.add_init_script(BOOT)
    await nacti(page, "document.body.classList.contains('app-started')")
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(2500)

    st = await page.evaluate("""() => ({ modul: !!window.AGDosah, dosah: (typeof arRadius !== 'undefined') ? arRadius : null })""")
    ok('modul AGDosah je nactenY', st['modul'], st)

    # bod ~800 m severne = daleko za beznym dosahem 150 m
    st = await page.evaluate("""() => {
        if (userLat == null) return { chyba: 'bez GPS' };
        const id = 'test-daleky-1';
        arPoints.push({ id: id, name: 'Daleky', lat: userLat + 0.0072, lng: userLng, cat: 'CUSTOM', hidden: false });
        window._lastCalcCount = -1;
        // mapa musi bod obsahovat, jinak ho obdelnik na obrazovce nemuze trefit
        map.fitBounds(L.latLngBounds([[userLat, userLng], [userLat + 0.0072, userLng]]), { padding: [40, 40] });
        window._mapHold = true;      // jinak dalsi GPS fix mapu vycentruje zpet na me
        return { ok: true, dosah: arRadius, bodu: arPoints.length };
    }""")
    print('    priprava:', st)
    await page.wait_for_timeout(1500)

    pred = await page.evaluate("""() => {
        const p = arPoints.find(x => x.id === 'test-daleky-1');
        if (p) { p.currentDist = getDistance(userLat, userLng, p.lat, p.lng); p.currentBearing = null; }
        if (typeof initARMarkers === 'function') initARMarkers();
        return { vzdy: !!(window.AGDosah && AGDosah.vzdy('test-daleky-1')),
                 element: !!(p && p.element), dist: p ? Math.round(p.currentDist || 0) : null };
    }""")
    ok('daleky bod je pred vyberem mimo AR', not pred['vzdy'] and not pred['element'], pred)

    # spustit nastroj a natahnout obdelnik pres celou mapu
    await page.evaluate("() => window.agOpenArDosah && window.agOpenArDosah()")
    await page.wait_for_timeout(600)
    st = await page.evaluate("() => ({ vrstva: !!document.getElementById('ag-dosah-vrstva'), lista: !!document.getElementById('ag-dosah-lista') })")
    ok('vyber obdelnikem se otevrel', st['vrstva'] and st['lista'], st)

    await page.evaluate("""() => {
        const p = arPoints.find(x => x.id === 'test-daleky-1');
        // ⚠ #map lezi v #map-wrapper o rozmeru 150vmax (kvuli otaceni mapy), takze
        //   Leaflet "fituje" do plochy VETSI nez obrazovka a videt je jen jeji stred.
        //   Bez odzoomovani by bod zustal nad hornim okrajem displeje.
        map.fitBounds(L.latLngBounds([[userLat, userLng], [p.lat, p.lng]]), { padding: [40, 40] });
        map.setZoom(map.getZoom() - 2);
        window._mapHold = true;
    }""")
    await page.wait_for_timeout(800)
    kde = await page.evaluate("""([x1, y1, x2, y2]) => {
        const p = arPoints.find(x => x.id === 'test-daleky-1');
        const rohy = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(c => window.agScreenToLatLng(c[0], c[1]));
        if (rohy.some(r => !r)) return { chyba: 'agScreenToLatLng nevraci' };
        const la = rohy.map(r => r.lat), ln = rohy.map(r => r.lng);
        return { uvnitr: p.lat >= Math.min(...la) && p.lat <= Math.max(...la)
                      && p.lng >= Math.min(...ln) && p.lng <= Math.max(...ln),
                 bod: [p.lat.toFixed(5), p.lng.toFixed(5)],
                 vyrez: [Math.min(...la).toFixed(5), Math.max(...la).toFixed(5)] };
    }""", [5, 60, 405, 880])
    print('    lezi bod v tazenem obdelniku?', kde)
    await page.mouse.move(5, 60)
    await page.mouse.down()
    await page.mouse.move(200, 400, steps=6)
    await page.mouse.move(405, 880, steps=6)
    await page.mouse.up()
    await page.wait_for_timeout(1200)

    po = await page.evaluate("""() => {
        const p = arPoints.find(x => x.id === 'test-daleky-1');
        return { pocet: window.AGDosah ? AGDosah.pocet() : -1,
                 vzdy: !!(window.AGDosah && AGDosah.vzdy('test-daleky-1')),
                 element: !!(p && p.element),
                 obrys: !!(p && p.element && p.element.classList.contains('ag-daleko')),
                 hlaska: (document.querySelector('#ag-dosah-lista .txt') || {}).textContent || '' };
    }""")
    ok('obdelnik vybral daleky bod', po['vzdy'] and po['pocet'] >= 1, po)
    ok('daleky bod dostal znacku v AR', po['element'], po)
    ok('vybrany bod je poznat obrysem', po['obrys'], po)

    # azimut se musi dopocitat i za _brgLim, jinak nema znacka kam
    await page.evaluate("() => { window._lastCalcCount = -1; }")
    await page.wait_for_timeout(2200)
    az = await page.evaluate("""() => {
        const p = arPoints.find(x => x.id === 'test-daleky-1');
        return { bearing: p ? p.currentBearing : null, dist: p ? Math.round(p.currentDist || 0) : null };
    }""")
    ok('vzdaleny bod ma spocitany azimut', az['bearing'] != None, az)

    # zavrit + zrusit vyber
    await page.evaluate("() => { const b = document.getElementById('ag-dosah-zrus'); if (b) b.click(); }")
    await page.wait_for_timeout(500)
    kon = await page.evaluate("() => ({ pocet: window.AGDosah ? AGDosah.pocet() : -1 })")
    ok('zruseni vyberu funguje', kon['pocet'] == 0, kon)
    await page.evaluate("() => { const b = document.getElementById('ag-dosah-hotovo'); if (b) b.click(); }")

    ok('bez chyb v konzoli', not chyby, chyby[:3])
    await page.close()


# ------------------------------------------------ I) kompas se pta jen v gestu
# Podstrcime iOS API: requestPermission, ktere si vede pocitadlo a vraci 'denied'.
# Presne tak se chova WebKit na dotaz MIMO gesto uzivatele — a prave to appka do
# 8. 9. 2026 vydavala za "uzivatel nepovolil".
IOS = """
  window.__ios = { volani: 0, gesta: [] };
  window.DeviceOrientationEvent = window.DeviceOrientationEvent || function () {};
  window.DeviceOrientationEvent.requestPermission = function () {
    window.__ios.volani++;
    var g = false;
    try { g = !!(navigator.userActivation && navigator.userActivation.isActive); } catch (e) {}
    window.__ios.gesta.push(g);
    return Promise.resolve('denied');
  };
"""


async def test_kompas(ctx):
    print('\n--- I) kompas: dotaz na povoleni jen v geste uzivatele ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await ctx.add_init_script(BOOT + IOS)
    await nacti(page, "document.body.classList.contains('app-started')")
    await page.wait_for_timeout(2500)

    st = await page.evaluate("""() => ({
        volani: window.__ios.volani, gesta: window.__ios.gesta,
        odepren: !!window.AGCompassDenied,
        okno: !!document.querySelector('.ag-dlg, .modal-overlay[style*="flex"]') &&
              (document.body.innerText || '').includes('Kompas nemá povolení')
    })""")
    ok('pri startu se appka na povoleni NEPTA', st['volani'] == 0, st)
    ok('okno "Kompas nema povoleni" po startu nenaskoci', not st['okno'], st)
    ok('priznak AGCompassDenied neni nastaveny', not st['odepren'], st)

    # skutecny dotek: ted uz se ptat SMI (a odpoved 'denied' uz zamitnuti opravdu je)
    await page.touchscreen.tap(200, 500)
    await page.wait_for_timeout(1500)
    st = await page.evaluate("""() => ({
        volani: window.__ios.volani, gesta: window.__ios.gesta,
        odepren: !!window.AGCompassDenied
    })""")
    ok('po doteku se appka zepta', st['volani'] >= 1, st)
    ok('dotaz probehl v geste uzivatele', bool(st['gesta']) and all(st['gesta']), st)
    ok('teprve ted se hlasi zamitnuti', st['odepren'], st)

    # a po dalsim doteku se pokus zopakuje (drive uz nikdy)
    pred = st['volani']
    await page.evaluate("() => { const d = document.querySelector('.ag-dlg-x, .ag-dlg button'); if (d) d.click(); }")
    await page.wait_for_timeout(400)
    await page.touchscreen.tap(120, 300)
    await page.wait_for_timeout(1200)
    st = await page.evaluate("() => ({ volani: window.__ios.volani })")
    ok('pokus se po dalsim doteku zopakuje', st['volani'] > pred, {'pred': pred, 'po': st['volani']})

    ok('bez chyb v konzoli', not chyby, chyby[:3])
    await page.close()


async def main():
    from playwright.async_api import async_playwright
    srv = server()
    if not srv:
        print('CHYBA: testovaci server nenabehl')
        return 1
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for fn in (test_vlastnik, test_mrizka, test_mapa, test_dosah, test_kompas):
                ctx = await b.new_context(viewport={'width': 412, 'height': 915},
                                          is_mobile=True, has_touch=True,
                                          permissions=['geolocation'], geolocation=GEO,
                                          locale='cs-CZ')
                try:
                    await fn(ctx)
                except Exception as e:
                    ok(fn.__name__ + ' probehl', False, repr(e)[:300])
                await ctx.close()
            await b.close()
    finally:
        srv.terminate()
    spatne = [j for o, j in vysledky if not o]
    print('\n=== %d/%d OK ===' % (len(vysledky) - len(spatne), len(vysledky)))
    for j in spatne:
        print('  CHYBA:', j)
    return 1 if spatne else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
