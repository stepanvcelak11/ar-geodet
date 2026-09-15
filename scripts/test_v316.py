# -*- coding: utf-8 -*-
u"""Regrese k v316 (14. 9. 2026): tři vybrané optimalizace + senzory pod nástroji + odpověď na vzkaz.

  A  POPISKY MAPY se při otáčení nepřepisují každý snímek — srovnají se až po ustálení
     (změřeno: 79 % hlavního vlákna → 0)
  B  AR ZNAČKY jen pro body v dosahu a jen když běží kamera (bylo 816 prvků místo 16)
  C  OKNO BODY: první dávka 30 řádků, zbytek v nečinnosti / při dorolování; hledání
     si dostaví všechno
  D  ÚSPORA BATERIE a nástroje: okno nástroje s data-ag-needs drží kameru/kompas/GPS
     (výška objektu: „zhasla kamera a jak mám změřit objekt?"); AGPower.hold drží GPS
     záznamu stopy pod kalkulačkou
  E  VZKAZ OD VLASTNÍKA má tlačítko Odpovědět; zpráva nese kód účtu (vlastník může
     odpovědět do appky); worker přijímá kind 'odpoved'

Spuštění:  python scripts/test_v316.py [port]
"""
import io
import os
import re
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

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8981)
vysledky = []
LAT, LNG = 50.0755, 14.4378


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


def body(n, cat, rmax):
    out = []
    for i in range(n):
        r = 5 + (rmax - 5) * ((i * 37) % n) / float(n)
        a = (i * 2.399963)   # zlatý úhel — rovnoměrně dokola
        out.append({'id': '%s_%d' % (cat, i), 'name': '%s-%d' % (cat, i), 'lat': LAT + r * math.cos(a) / 111320.0,
                    'lng': LNG + r * math.sin(a) / (111320.0 * math.cos(math.radians(LAT))), 'cat': cat, 'type': 'polohovy', 'hidden': False})
    return out


SEED = "localStorage.setItem('default_arCustomPoints12', %s); localStorage.setItem('default_arOfflinePoints12', %s);" % (
    json.dumps(json.dumps(body(200, 'CUSTOM', 500))), json.dumps(json.dumps(body(100, 'PBPP', 280))))

VZKAZ = """(function(){ try { var f = JSON.parse(localStorage.getItem('agFirma_v1')); f.vzkazy = [{ id: 777, ts: Date.now(), txt: 'Ahoj, jak ti jde appka?', komu: 'ucet' }]; localStorage.setItem('agFirma_v1', JSON.stringify(f)); } catch (e) {} })();"""


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


KOMPAS = """(ms) => new Promise(res => { let a = 0; const t = setInterval(() => { a = (a + 0.6) % 360; const ev = new Event('deviceorientationabsolute'); ev.alpha = a; ev.beta = 85; ev.gamma = 2; ev.absolute = true; window.dispatchEvent(ev); }, 16); setTimeout(() => { clearInterval(t); res(a); }, ms); })"""


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []

        ctx, page = await stranka(br, url, boot(tarif='pro') + SEED + VZKAZ + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');", chyby)
        await cekej(page, "document.body.classList.contains('app-started')")
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        await ctx.set_geolocation({'latitude': LAT + 0.3 / 111320.0, 'longitude': LNG, 'accuracy': 3})
        await page.wait_for_timeout(2500)

        # ---- A: popisky po ustálení -------------------------------------------
        await page.evaluate("() => { window._labelsDirty = true; }")
        await page.evaluate(KOMPAS, 800)
        st = await page.evaluate("""() => { const els = document.querySelectorAll('.map-label-text'); const rot = new Set(); els.forEach(e => rot.add(e.style.transform)); return { n: els.length, ruzne: rot.size, mapRot: Math.round(mapRotation) }; }""")
        ok('A0 v mapě jsou popisky bodů', st['n'] > 50, st)
        # při otáčení: popisky se nepřepisují -> jejich transform NEodpovídá živému mapRotation
        a = await page.evaluate("""() => { const before = document.querySelector('.map-label-text').style.transform; return before; }""")
        await page.evaluate(KOMPAS, 700)
        b = await page.evaluate("""() => ({ tf: document.querySelector('.map-label-text').style.transform, rot: Math.round(mapRotation) })""")
        ok('A1 během otáčení se transform popisků NEPŘEPISUJE', a == b['tf'], (a, b))
        await page.wait_for_timeout(700)
        # srovnávají se jen popisky VE VÝŘEZU (ostatní až když se do něj dostanou)
        c = await page.evaluate(r"""() => { const b = map.getBounds(); let el = null, mimo = null; markersGroup.eachLayer(l => { const e = l.getElement && l.getElement(); const t = e && e.querySelector('.map-label-text'); if (!t) return; if (b.contains(l.getLatLng())) { if (!el) el = t; } else if (!mimo) mimo = t; });
            const deg = (t) => { const m = (t ? t.style.transform : '').match(/rotate\(([-\d.]+)deg\)/); return m ? +m[1] : null; };
            return { deg: deg(el), degMimo: deg(mimo), rot: mapRotation }; }""")
        ok('A2 po ustálení (0,7 s) se popisky ve výřezu srovnaly na aktuální natočení', c['deg'] is not None and abs(((c['deg'] - c['rot'] + 540) % 360) - 180) < 2.5, c)
        ok('A2b popisky mimo výřez se nesrovnávají (ušetřený zásek)', c['degMimo'] is None or abs(((c['degMimo'] - c['rot'] + 540) % 360) - 180) >= 2.5 or c['degMimo'] == c['deg'], c)
        # dotyk: s prstem na displeji se mapa nepřekresluje (klepnutí by se ztratilo)
        d0 = await page.evaluate("""() => { document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); const gen0 = _drawGen; drawAllMarkersOnMap(); const odlozeno = (_drawGen === gen0); document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return { odlozeno: odlozeno, dotyk: AG.dotyk() }; }""")
        await page.wait_for_timeout(400)
        d1 = await page.evaluate("() => ({ dotyk: AG.dotyk(), znacky: markersGroup.getLayers().length })")
        ok('A4 s prstem na displeji se překreslení mapy odloží a po zvednutí doběhne', d0['odlozeno'] and d0['dotyk'] and not d1['dotyk'] and d1['znacky'] > 50, (d0, d1))
        # ROZDÍLOVÉ PŘEKRESLENÍ (v326) + dvojice bodů se STEJNÝM id (v327, 15. 9. 2026):
        # nivelační značka a PPBP na témže místě dostanou z stableId totéž id — rejstřík
        # značek klíčovaný jen podle id kreslil z dvojice jediný bod a při každém
        # překreslení je přehazoval. Teď zůstávají obě značky a nic se nepřestavuje.
        a5 = await page.evaluate("""() => { const q = arPoints.find(p => p.cat !== 'CUSTOM' && p.currentDist != null && p.currentDist < 150) || arPoints[0];
            const dvojce = Object.assign({}, q, { cat: q.cat === 'NIVEL' ? 'PBPP' : 'NIVEL', name: q.name + '-DVOJCE', rawData: q.rawData || {} });
            arPoints.push(dvojce); drawAllMarkersOnMap();
            const ids = () => markersGroup.getLayers().map(l => l._leaflet_id).sort((x, y) => x - y);
            return new Promise(r => setTimeout(() => { const a = ids(); drawAllMarkersOnMap(); setTimeout(() => { const b = ids();
                const oba = markersGroup.getLayers().filter(l => (l.options.icon.options.html || '').includes(q.name)).length;
                arPoints.pop(); drawAllMarkersOnMap();
                r({ oba: oba, stejne: a.length === b.length && a.every((v, i) => v === b[i]), n: a.length }); }, 600); }, 600)); }""")
        ok('A5 dva body se stejným id (nivelační + PPBP na jednom místě) se kreslí OBA a překreslení je nepřestavuje', a5['oba'] == 2 and a5['stejne'], a5)
        src = io.open(os.path.join(ROOT, 'js', 'grafika.js'), encoding='utf-8').read()
        ok('A3 renderAR už nepřepisuje transform popisků každý snímek', "window._mapLabelEls.forEach(el => { el.style.transform = `rotate(${_mapHdg}deg)`; });" not in src and '_lblSettle(_mapHdg)' in src)

        # ---- B: AR značky ---------------------------------------------------------
        n0 = await page.evaluate("() => document.querySelectorAll('.ar-marker').length")
        ok('B1 v režimu Pouze mapa se AR značky nestaví (0 prvků)', n0 == 0, n0)
        await page.evaluate("() => { viewMode = 'both'; applyViewMode(); }")
        await page.wait_for_timeout(1500)
        b1 = await page.evaluate("""() => ({ el: document.querySelectorAll('.ar-marker').length, vDosahu: arPoints.filter(p => p.currentDist != null && p.currentDist <= arRadius && !p.hidden).length, bezDist: arPoints.filter(p => p.currentDist == null).length, arRadius, celkem: arPoints.length })""")
        ok('B2 po zapnutí kamery jen značky bodů v dosahu (ne všech %d)' % b1['celkem'], 0 < b1['el'] <= b1['vDosahu'] + 2 and b1['el'] < b1['celkem'] / 2, b1)
        ok('B3 žádný bod bez vzdálenosti (dopočítá se)', b1['bezDist'] == 0, b1)

        # ---- D: potřeby nástrojů ---------------------------------------------------
        ok('D0 AGPower.needs existuje', await page.evaluate("() => !!(window.AGPower && AGPower.needs && AGPower.hold)"))
        await page.evaluate("() => { if (window.AGLazy) AGLazy.flush(); }")
        await cekej(page, "typeof window.agOpenVyskaObjektu === 'function'", 20)
        await page.evaluate("() => agOpenVyskaObjektu()")
        await page.wait_for_timeout(4000)   # > 2,5 s prodleva uspání kamery
        d = await page.evaluate("""() => { const m = document.getElementById('agvo-modal'); const ind = document.getElementById('ag-pwr'); return { otevreno: !!(m && m.style.display === 'flex'), needs: AGPower.needs(), title: ind ? ind.title : '', attr: m && m.getAttribute('data-ag-needs') }; }""")
        ok('D1 okno Výška objektu hlásí potřebu kamery a kompasu', d['otevreno'] and d['needs']['kamera'] and d['needs']['kompas'], d)
        ok('D2 kamera se pod oknem nástroje NEUSPALA', 'kamera' not in d['title'], d)
        await page.evaluate("() => agCloseVyskaObjektu()")
        # kalkulačka = těžké okno → GPS usne; držení ji vrátí
        await page.evaluate("() => { const m = document.getElementById('settings-modal'); m.style.display = 'flex'; }")
        await page.wait_for_timeout(4500)
        g1 = await page.evaluate("() => ({ title: (document.getElementById('ag-pwr') || {}).title || '', n: AGPowerGps.activeCount() })")
        ok('D3 pod Nastavením GPS spí (dosavadní chování)', 'GPS' in g1['title'] and g1['n'] == 0, g1)
        await page.evaluate("() => AGPower.hold('gps', 'test')")
        await page.wait_for_timeout(1500)
        g2 = await page.evaluate("() => ({ title: (document.getElementById('ag-pwr') || {}).title || '', n: AGPowerGps.activeCount(), needs: AGPower.needs() })")
        ok('D4 AGPower.hold(gps) GPS probudí i pod Nastavením (záznam stopy)', g2['n'] > 0 and g2['needs']['gps'], g2)
        await page.evaluate("() => { AGPower.release('gps', 'test'); document.getElementById('settings-modal').style.display = 'none'; }")
        # výčet oken s deklarací
        n_needs = 0
        for f in os.listdir(os.path.join(ROOT, 'js')):
            if f.endswith('.js') and 'data-ag-needs' in io.open(os.path.join(ROOT, 'js', f), encoding='utf-8').read():
                n_needs += 1
        ok('D5 potřebu senzorů deklaruje aspoň 30 modulů nástrojů (je %d)' % n_needs, n_needs >= 30, n_needs)
        tl = io.open(os.path.join(ROOT, 'js', 'track-log.js'), encoding='utf-8').read()
        ok('D6 záznam stopy drží GPS přes AGPower.hold', "AGPower.hold('gps', 'track-log')" in tl)

        # ---- C: okno Body po dávkách -------------------------------------------------
        dlg = await page.evaluate("() => { const d = document.querySelector('.ag-dlg-overlay.open'); const t = d ? d.textContent.split(/\\s+/).join(' ').slice(0, 120) : ''; document.querySelectorAll('.ag-dlg-overlay').forEach(o => o.remove()); return t; }")
        if dlg: print('    (dialog zavřen: %s)' % dlg)
        await page.evaluate("() => { document.querySelectorAll('.modal-overlay').forEach(m => { if (m.id !== 'manage-modal') m.style.display = 'none'; }); }")
        await page.tap('#dock button:has-text("Body")')
        await page.wait_for_timeout(250)
        c0 = await page.evaluate("() => ({ rows: document.querySelectorAll('#manage-list .cp-item').length, more: !!document.querySelector('#manage-list .mng-more'), txt: (document.querySelector('#manage-list .mng-more') || {}).textContent || '' })")
        ok('C1 hned po otevření je postavená první dávka (zlomek z 200) a zástupce „dalších N bodů…"', 0 < c0['rows'] <= 100 and c0['more'] and 'dalších' in c0['txt'], c0)
        await page.wait_for_timeout(2500)
        c1 = await page.evaluate("() => ({ rows: document.querySelectorAll('#manage-list .cp-item').length, more: !!document.querySelector('#manage-list .mng-more') })")
        ok('C2 v nečinnosti se seznam dostaví celý (200 řádků, zástupce zmizí)', c1['rows'] == 200 and not c1['more'], c1)
        # hledání: nový render + okamžitý dotaz musí najít i bod z konce
        await page.evaluate("() => { _mngQuery = ''; renderManageList(); }")
        await page.wait_for_timeout(300)
        await page.evaluate("() => { const si = document.getElementById('mng-search'); si.value = 'CUSTOM-199'; si.dispatchEvent(new Event('input', { bubbles: true })); }")
        await page.wait_for_timeout(300)
        c2 = await page.evaluate("() => { const vis = Array.from(document.querySelectorAll('#manage-list .cp-item')).filter(e => e.style.display !== 'none'); return { rows: document.querySelectorAll('#manage-list .cp-item').length, vis: vis.length, nazev: vis[0] ? vis[0].textContent.slice(0, 30) : '' }; }")
        ok('C3 hledání dostaví všechny řádky a najde bod z konce seznamu', c2['rows'] == 200 and c2['vis'] == 1 and 'CUSTOM-199' in c2['nazev'], c2)
        css = io.open(os.path.join(ROOT, 'css', 'style.css'), encoding='utf-8').read()
        ok('C4 řádky mimo obrazovku se nerozvrhují (content-visibility:auto)', '#manage-list .cp-item.mngr { content-visibility: auto;' in css)
        await page.evaluate("() => { document.getElementById('manage-modal').style.display = 'none'; }")

        # ---- E: odpověď na vzkaz ------------------------------------------------------
        await cekej(page, "window.AGNotify && AGNotify.has && AGNotify.has('ag-vzkaz-777')", 20)
        e1 = await page.evaluate("""() => { if (!window.AGNotify || !AGNotify.has('ag-vzkaz-777')) return { has: false }; try { AGNotify.expand(); AGNotify.render(); } catch (e) {} const box = document.getElementById('ag-nbox'); const acts = box ? Array.from(box.querySelectorAll('.ag-nact')).map(b => b.textContent) : []; return { has: true, acts: acts }; }""")
        ok('E1 vzkaz od vlastníka visí v upozorněních s tlačítkem Odpovědět', e1['has'] and 'Odpovědět' in e1['acts'], e1)
        zv = io.open(os.path.join(ROOT, 'js', 'zpetna-vazba.js'), encoding='utf-8').read()
        ok('E2 zpráva autorovi nese kód účtu (meta.ucet) → vlastník může odpovědět do appky', 'o.ucet = String(_u.code)' in zv and 'poslat: poslat' in zv)
        wk = io.open(os.path.join(ROOT, 'cloud', 'worker.js'), encoding='utf-8').read()
        ok('E3 worker přijímá kind odpoved a hlásí „Odpověď na vzkaz"', "'hodnoceni', 'odpoved']" in wk and "'Odpověď na vzkaz'" in wk and int(re.search(r"v: (\d+),", wk).group(1)) >= 22)
        sa = io.open(os.path.join(ROOT, 'js', 'sprava-appky.js'), encoding='utf-8').read()
        ok('E4 odpověď jde přes AGZpetna.poslat s odkazem na vzkaz', "AGZpetna.poslat({ kind: 'odpoved'" in sa and "meta: { vzkaz: v.id" in sa)

        vazne = [c for c in chyby if 'favicon' not in c and 'net::ERR' not in c and '404' not in c and 'tile.openstreetmap' not in c and '/owner/' not in c and '403' not in c]
        ok('Z bez chyb stránky', not vazne, vazne[:5])
        await ctx.close()
        await br.close()


def main():
    srv, url = server(PORT)
    if not srv:
        print('CHYBA server se nespustil'); sys.exit(2)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    sys.exit(1 if spatne else 0)


if __name__ == '__main__':
    main()
