# -*- coding: utf-8 -*-
u"""Regrese k hlášení uživatele z 11. 9. 2026 (větev oprava-11-9).

Co se hlásilo (mluvené, iPhone) a co tu drží:
  A  logo na přihlašovací obrazovce bylo STARÉ (hledáček bez Q) — brána si klonuje
     .welcome-logo z index.html a ten nikdo při přejmenování na QTRIG nepřekreslil
  B  „Další možnosti" na bráně v Základu nic nedělaly — otevírají průvodce
     z js/ucty-admin.js, který se do balíčku Základu nedává
  C  křížek vpravo nahoře v Nástrojích a v Bodech nezavíral — neviditelný křížek
     ZAVŘENÉHO okna „Nový bod" ležel na témže místě a pseudo-prvek s
     `pointer-events:auto` prolomil `pointer-events:none` zavřeného okna
  D  „QTRIG PRO" na přihlašovací obrazovce, když telefon Pro má
  E  „Kompas mlčí" vyskakovalo, i když se jen čekalo na první dotek (iOS) —
     hlídač nesmí počítat ticho, dokud kompas čeká na gesto
  F  Základ je výrazně menší (dělicí čára), zámky drží v seznamu úkonů
  G  panel Vrstvy: jen Mapa/Ortofoto (+ otáčení) zdarma, ostatní zamčené; Terén DMR 5G pryč
  H  přehled „Co je v Pro" ve „Více" + znak Pro (body.ag-pro)
  I  kolečko nástrojů: v Základu bez Pro nástrojů

Spuštění:  python scripts/test_opravy_11_9.py [port]
"""
import io
import os
import sys
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

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8931)
vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


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


async def stranka(br, url, init, chyby):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844},
                               has_touch=True, is_mobile=True)
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text) if m.type == 'error' else None)
    if init:
        await page.add_init_script(init)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    await page.wait_for_timeout(3000)
    return ctx, page


async def cekej_moduly(page, vyraz, kol=25):
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

        # ---- A + B: brána bez účtu ------------------------------------------
        chyby = []
        ctx, page = await stranka(br, url, None, chyby)
        g = await page.evaluate("""() => {
            var g = document.getElementById('ag-gate'); if (!g) return null;
            var svg = g.querySelector('.agl-mark svg');
            return { arcs: svg ? svg.querySelectorAll('path').length : 0,
                     ocasek: !!(svg && svg.querySelector('line')),
                     dalsi: !!g.querySelector('#agg-new'),
                     pro: !!g.querySelector('.agl-pro') };
        }""")
        ok('A1 brána stojí', g is not None)
        ok('A2 logo brány je Q (4 oblouky + 4 závorky + ocásek)', g and g['arcs'] == 8 and g['ocasek'], g)
        ok('B1 v Pro vydání je „Další možnosti" (ucty-admin.js existuje)', g and g['dalsi'] is True, g)
        ok('D1 bez Pro není štítek PRO', g and g['pro'] is False, g)
        await ctx.close()

        ctx, page = await stranka(br, url, "window.__AG_VYDANI='zaklad';", chyby)
        dalsi = await page.evaluate("() => !!document.querySelector('#ag-gate #agg-new')")
        ok('B2 v Základu „Další možnosti" na bráně NENÍ', dalsi is False)
        await ctx.close()

        ctx, page = await stranka(br, url, "localStorage.setItem('agTarifUctu_v1', JSON.stringify({tarif:'pro', do:0}));", chyby)
        brand = await page.evaluate("() => { var l=document.querySelector('#ag-gate .agl-logo'); return l ? l.innerText.replace(/\\s+/g,'') : null; }")
        ok('D2 s Pro tarifem brána hlásí QTRIG PRO', brand == 'QTRIGPRO', brand)
        await ctx.close()

        # ---- C: křížky zavírají dotykem (Základ účet) -------------------------
        ctx, page = await stranka(br, url, boot(tarif='zaklad'), chyby)
        await cekej_moduly(page, 'window.AGUkony && window.AGProZamky')
        for name, mid in (('Nástroje', 'tools-modal'), ('Body', 'manage-modal')):
            await page.tap('#dock button:has-text("%s")' % name)
            await page.wait_for_timeout(1000)
            r = await page.evaluate("""(mid) => {
                var m = document.getElementById(mid); var x = m.querySelector(':scope > .agmc-x');
                if (!x) return null; var b = x.getBoundingClientRect();
                var top = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2);
                return { x: b.left + b.width/2, y: b.top + b.height/2, open: m.classList.contains('ag-open'),
                         nadKrizkem: top === x || x.contains(top) };
            }""", mid)
            ok('C1 %s: otevřeno a křížek je NAHOŘE (nic ho nekryje)' % name, r and r['open'] and r['nadKrizkem'], r)
            if r:
                await page.touchscreen.tap(r['x'], r['y'])
                await page.wait_for_timeout(700)
                zavreno = await page.evaluate("(mid) => !document.getElementById(mid).classList.contains('ag-open')", mid)
                ok('C2 %s: klepnutí na křížek okno zavře' % name, zavreno)
            await page.evaluate("(mid) => { var m=document.getElementById(mid); m.style.display='none'; }", mid)
            await page.wait_for_timeout(300)

        # ---- E: hlídač kompasu čeká na dotek --------------------------------
        # Ve zdroji: podmínka _cekamNaDotyk musí stát PŘED měřením ticha a nesmí
        # otevírat okno. (Chování na iOS se v Chromiu nedá vyvolat — WebKit tam
        # requestPermission mimo gesto splní hodnotou 'denied'.)
        src = io.open(os.path.join(ROOT, 'js', 'grafika.js'), encoding='utf-8').read()
        i1 = src.find('if (_cekamNaDotyk) { _compassSilentFrom = 0;')
        i2 = src.find('if (_compassMute) {')
        ok('E1 hlídač kompasu nepočítá ticho, dokud se čeká na dotek', 0 < i1 < i2, (i1, i2))

        # ---- F: dělicí čára v seznamu úkonů ---------------------------------
        await page.tap('#dock button:has-text("Nástroje")')
        await page.wait_for_timeout(1200)
        await page.evaluate('() => window.AGProZamky && AGProZamky.oznac && AGProZamky.oznac()')
        await page.wait_for_timeout(300)
        ukony = await page.evaluate("""() => {
            var out = { vse: 0, zamek: 0, volne: [] };
            document.querySelectorAll('.ag-uk-i').forEach(function (el) {
                var k = el.getAttribute('data-k') || el.getAttribute('data-tool');
                if (!k) return;
                out.vse++;
                if (el.getAttribute('data-agpro') === '1') out.zamek++; else out.volne.push(k);
            });
            return out;
        }""")
        ok('F1 seznam úkonů má položky', ukony['vse'] > 20, ukony['vse'])
        ok('F2 v Základu je zamčená VĚTŠINA úkonů (uživatel: „dostanu se skoro všude")',
           ukony['zamek'] > ukony['vse'] / 2, ukony)
        for k in ('stakeout-line', 'geo-foto', 'ar-metr', 'project-import'):
            ok('F3 nově Pro: %s má zámek' % k, k not in ukony['volne'], ukony['volne'])
        for k in ('openMeasureModal', 'brutal-gps', 'openStakeoutModal', 'kompas', 'openKatastr'):
            ok('F4 zůstává zdarma: %s' % k, k in ukony['volne'], ukony['volne'])
        for k in ('hlas-kod', 'kontrola-vrstvy', 'firma-chat'):
            je = await page.evaluate("(k) => !!(window.AGReg && AGReg.all().some(function (r) { return r.k === k; }))", k)
            ok('F5 zrušený nástroj %s v registru NENÍ' % k, je is False)
        await page.evaluate("() => { var m=document.getElementById('tools-modal'); m.style.display='none'; }")
        await page.wait_for_timeout(300)

        # ---- G: panel Vrstvy ---------------------------------------------------
        # panel se otevírá z lišty („Vrstvy" v doku); kolečko #map-ctrl-toggle je výchozí schované
        await page.tap('#dock button:has-text("Vrstvy")')
        await page.wait_for_timeout(900)
        vr = await page.evaluate("""() => {
            var s = document.getElementById('map-sheet'); if (!s) return null;
            var lock = function (id) { var e = document.getElementById(id); return e ? e.getAttribute('data-agpro') === '1' : null; };
            return { teren: !!document.getElementById('ms-terrain'),
                     katastr: lock('btn-katastr'), orto: lock('btn-baselayer'), osm: lock('ms-base-osm'),
                     naMe: (function () { var b = s.querySelector('.ms-tile[onclick*="recenterOnUser"]'); return b ? b.getAttribute('data-agpro') === '1' : null; })() };
        }""")
        ok('G1 řádek Terén (DMR 5G) zmizel', vr and vr['teren'] is False, vr)
        ok('G2 Katastrální mapa je v Základu zamčená', vr and vr['katastr'] is True, vr)
        # 12. 9. 2026: v panelu zůstává zdarma JEN podklad a otáčení — „Na mě" je zamčené
        ok('G3 Mapa / Ortofoto zdarma, Na mě zamčené', vr and not vr['orto'] and not vr['osm'] and vr['naMe'] is True, vr)
        await page.tap('#btn-katastr')
        await page.wait_for_timeout(700)
        kat = await page.evaluate("""() => ({ aktivni: document.getElementById('btn-katastr').classList.contains('ctrl-active'),
            karta: !!document.querySelector('#ag-pro-modal.on, .ag-mt-pro.on, [data-ag-pro-karta].on') })""")
        ok('G4 klepnutí na zamčený Katastr vrstvu NEZAPNE', kat['aktivni'] is False, kat)

        # ---- H: přehled Pro + znak Pro --------------------------------------
        ok('H1 v Základu body NEMÁ ag-pro', await page.evaluate("() => !document.body.classList.contains('ag-pro')"))
        maPrehled = await cekej_moduly(page, 'window.AGProPrehled', 10)
        ok('H2 modul přehledu je načtený', maPrehled)
        if maPrehled:
            await page.evaluate('() => AGProPrehled.open()')
            await page.wait_for_timeout(600)
            radky = await page.evaluate("""() => { var m = document.getElementById('ag-prehled-modal'); if (!m) return -1;
                var r = m.getBoundingClientRect(); return (r.width > 0 && r.height > 0) ? m.querySelectorAll('tr, .agpp-row, [data-k]').length : -2; }""")
            ok('H3 přehled se otevře a má řádky nástrojů', radky > 20, radky)
        ok('I0 bez chyb v konzoli (Základ)', not [c for c in chyby if 'favicon' not in c.lower()], chyby[:4])
        await ctx.close()

        # ---- Pro účet: znak Pro, kytka ----------------------------------------
        chyby2 = []
        ctx, page = await stranka(br, url, boot(tarif='pro'), chyby2)
        await cekej_moduly(page, 'window.AGUkony && window.AGProZamky && window.AGProPrehled')
        await page.wait_for_timeout(1500)
        ok('H4 s Pro má body třídu ag-pro', await page.evaluate("() => document.body.classList.contains('ag-pro')"))
        await page.tap('#dock button:has-text("Nástroje")')
        await page.wait_for_timeout(1200)
        await page.evaluate('() => window.AGProZamky && AGProZamky.oznac && AGProZamky.oznac()')
        z = await page.evaluate("() => document.querySelectorAll('.ag-uk-i[data-agpro=\"1\"]').length")
        ok('H5 s Pro není v seznamu úkonů žádný zámek', z == 0, z)
        ok('I1 bez chyb v konzoli (Pro)', not [c for c in chyby2 if 'favicon' not in c.lower()], chyby2[:4])
        await ctx.close()
        await br.close()


def main():
    srv, url = server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    sys.exit(1 if spatne else 0)


if __name__ == '__main__':
    main()
