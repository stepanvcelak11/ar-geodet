# -*- coding: utf-8 -*-
u"""Regrese k průchodu appkou 15. 9. 2026 večer (v335) — 11 nálezů z klikání přes všech
64 nástrojů (tmavý i světlý motiv, Pro):

  A  KOLIZE ID: GNSS předpověď a Geo-fotka měly TÝŽ #ag-gf-modal (+ #ag-gf-style) → kdo otevřel
     Geo-fotku, dostal pod „GNSS předpověď" její okno; Postupy měření × Průvodce prvním měřením
     sdílely #ag-pm-style (druhý bez CSS); Parcela na klik × Pro klíče #ag-pk-modal
  B  Funguje mi všechno?: AGLic.jePro neexistuje (isPro) → řádek Účet hlásil Základ i s Pro
  C  Stopa trasy: refreshPanel() před display:flex → prázdné tlačítko a statistika
  D  Ročenka: měsíce „led led úno … lis" (mesicZkr bral index 1–12, pole je 0–11)
  E  Deník dne: pět tlačítek v jednom řádku → „Zavřít" uříznuté; Offset bod: pole azimutu
     zmáčknuté na 10 px (.btn width:100 % ve flexu); Parcela: vlastní ✕ pod křížkem modal-close;
     Poznávačka: popisek v SVG uříznutý; Slunce: štítek řádku lámaný do tří řádků;
     jezdec „Stáhnout v okruhu300 m" (st-slider-head jen v Nastavení); Profily: select oříznutý
  F  Světlý motiv: 45× žlutá natvrdo (#fbbf24) na bílé → var(--warning); Oměrné hlavička tabulky
  G  GNSS předpověď: „Měř 20:00–20:00" (celé okno = 24 h)

Spuštění:  python scripts/test_pruchod_15_9.py [port]
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
import test_v329 as V329  # noqa: E402  (server s ověřením stromu, route_vse, SEED, cekej)

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8995)
vysledky = []
LAT, LNG = V329.LAT, V329.LNG


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def staticke():
    # A — kolize id mezi moduly: žádné dva moduly nesmí sdílet id modálu/stylu
    ids = {}
    for f in sorted(os.listdir(os.path.join(ROOT, 'js'))):
        if not f.endswith('.js'):
            continue
        s = src('js/' + f)
        for m in re.finditer(r"""(?:\.id\s*=\s*|id=\\?["'])([A-Za-z][\w-]{3,})""", s):
            ids.setdefault(m.group(1), set()).add(f)
        for m in re.finditer(r"""(?:STYLE_ID|DLG_ID|OV_ID|MODAL_ID|PANEL_ID)\s*=\s*['"]([\w-]+)['"]""", s):
            ids.setdefault(m.group(1), set()).add(f)
    kolize = [(k, sorted(v)) for k, v in ids.items() if len(v) > 1 and re.search(r'-(modal|style|ov|overlay)$', k)]
    ok('A1 žádné dva moduly nesdílí id modálu/stylu', not kolize, kolize)
    ok('A2 GNSS předpověď má vlastní předponu ag-gp-', "'ag-gf-modal'" not in src('js/gnss-forecast.js') and "'ag-gp-modal'" in src('js/gnss-forecast.js'))
    # B
    z = src('js/zdravi-appky.js')
    ok('B1 Funguje mi všechno? čte AGLic.isPro', 'AGLic.isPro()' in z and 'AGLic.jePro()' not in z)
    # D
    r = src('js/rocenka.js')
    ok('D1 Ročenka: zkratka měsíce bere index 0–11', "'lis', 'pro'][+m || 0]" in r)
    # E
    ok('E1 Deník dne: patička zalamuje', 'flex-wrap:wrap' in src('js/denik-dne.js'))
    ok('E2 Offset bod: tlačítko Z kompasu nebere celou šířku', 'flex:0 0 auto;width:auto;" id="agof-compass"' in src('js/offset-point.js'))
    ok('E3 st-slider-head platí i mimo Nastavení', re.search(r'^\.st-slider-head \{', src('css/style.css'), re.M) is not None)
    ok('E4 Poznávačka: popisek mimo SVG', 'pz-cap' in src('js/poznavacka.js'))
    ok('E5 Parcela: vlastní ✕ schovaný, místo pro křížek modal-close', '#agpc-close{display:none;}' in src('js/parcela.js'))
    ok('E6 Slunce: štítek řádku na vlastním řádku', 'flex:1 1 100%' in src('js/slunce.js'))
    ok('E7 student-start.js (Kdo jsi) je od 18. 9. 2026 večer odpojený', 'src="js/student-start.js"' not in src('index.html'))
    # F — žlutá natvrdo jako barva textu (mimo popisek nad ortofotem v kartě bodu)
    zle = []
    for f in sorted(os.listdir(os.path.join(ROOT, 'js'))):
        if not f.endswith('.js'):
            continue
        s = src('js/' + f)
        for m in re.finditer(r'(?<![-\w])color:\s*#fbbf24(?![\w])', s):
            ctx = s[max(0, m.start() - 40):m.start()]
            if '.ag-kb-ml.om' in ctx:
                continue
            zle.append(f)
    ok('F1 žádná žlutá natvrdo jako barva textu (var(--warning))', not zle, zle)
    ok('F2 tokens.css přebíjí inline #fbbf24 ve světlém motivu', 'body.light-mode [style*="color:#fbbf24"]' in src('css/tokens.css'))
    ok('F3 Oměrné: hlavička tabulky z tokenu', 'background: var(--bg-color, #161b21)' in src('css/check-distance.css'))
    # H — emoji jako ikony nikde (15. 9. 2026 „oprav ty ikony všude"); výjimky: výběr symbolu
    #     avataru (ucty-admin AVA_EMOJI = obsah, ne ikona) a klávesa ⌫ v kalkulačce
    emo = re.compile(u'[\U0001F300-🫿🀀-🋿✅❌⭐⌚-⏿▶✎⬆➕☀-☄☇-☙☛-⚟⚢-⛿]')
    emoji_soubory = []
    for f in sorted(os.listdir(os.path.join(ROOT, 'js'))):
        if not f.endswith('.js'):
            continue
        for l in src('js/' + f).splitlines():
            st = l.strip()
            if st.startswith('//') or st.startswith('*') or st.startswith('/*') or 'AVA_EMOJI' in l or "'⌫'" in l:
                continue
            if emo.search(l):
                emoji_soubory.append(f + ': ' + ''.join(sorted(set(emo.findall(l)))))
    ok('H1 žádné emoji jako ikony v js (mimo avatar a ⌫)', not emoji_soubory, emoji_soubory[:8])
    for f in ('data/navody.json', 'data/co-je-noveho.json'):
        ok('H2 bez emoji v ' + f, not emo.search(src(f)))
    ok('H3 sprite má nové ikony (car, tripod, box, clock, play, pause, calendar, moon, walk, watch, print, palette, mountain, trophy)',
       all(('symbol id="i-%s"' % k) in src('index.html') for k in ('car', 'tripod', 'box', 'clock', 'play', 'pause', 'calendar', 'moon', 'walk', 'watch', 'print', 'palette', 'mountain', 'trophy')))
    # G
    ok('G1 GNSS předpověď: celé okno = „kdykoli v příštích 24 h"', "kdykoli v příštích 24 h" in src('js/gnss-forecast.js'))


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
        page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)
        await page.route('**/*', V329.route_vse)
        await page.add_init_script(boot(tarif='pro') + V329.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        await page.goto(url, wait_until='domcontentloaded', timeout=45000)
        ok('0 appka nastartovala', await V329.cekej(page, "document.body.classList.contains('app-started')"))
        await V329.cekej(page, "typeof userLat === 'number' && userLat", 30)
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(3000)

        # A — Geo-fotka a pak GNSS předpověď: dvě různá okna
        await page.evaluate("() => { if (typeof agOpenGeoFoto === 'function') agOpenGeoFoto(); else if (window.AGGeoFoto && AGGeoFoto.open) AGGeoFoto.open(); }")
        await page.wait_for_timeout(600)
        await page.evaluate("() => { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); if (typeof agOpenGnssForecast === 'function') agOpenGnssForecast(); }")
        await page.wait_for_timeout(1200)
        a = await page.evaluate("() => { var m = document.getElementById('ag-gp-modal'); var g = document.getElementById('ag-gf-modal'); return { gp: m ? (m.querySelector('h3') || {}).textContent : null, gf: g ? (g.querySelector('h3') || {}).textContent : null, gpVis: !!(m && m.style.display === 'flex') }; }")
        ok('A3 po Geo-fotce se GNSS předpověď otevře ve vlastním okně', a['gp'] and 'GNSS' in a['gp'] and a['gpVis'] and (a['gf'] is None or 'Geo' in a['gf']), a)
        await page.evaluate("() => document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none')")

        # B — řádek Účet s Pro
        await page.evaluate("() => { if (typeof agOpenZdravi === 'function') agOpenZdravi(); else if (window.AGZdravi && AGZdravi.open) AGZdravi.open(); }")
        await V329.cekej(page, "document.querySelector('#ag-zdravi-modal') && /Účet/.test(document.getElementById('ag-zdravi-modal').textContent)", 20)
        b = await page.evaluate("() => { var m = document.getElementById('ag-zdravi-modal'); return m ? m.textContent.replace(/\\s+/g, ' ') : ''; }")
        ok('B2 Funguje mi všechno?: účet Pro hlásí „Pro"', re.search(r'Tester[^.]*· Pro', b) is not None and 'jen v telefonu · Základ' not in b, b[:300])
        await page.evaluate("() => document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none')")

        # C — Stopa trasy: tlačítko má text hned po otevření
        await page.evaluate("() => { if (typeof agOpenTrackLog === 'function') agOpenTrackLog(); }")
        await page.wait_for_timeout(500)
        c = await page.evaluate("() => { var b = document.getElementById('agtr-toggle'); var st = document.getElementById('agtr-stats'); return { btn: b ? b.textContent.trim() : null, st: st ? st.textContent.trim() : null }; }")
        ok('C1 Stopa trasy: tlačítko „Spustit nahrávání" i statistika hned po otevření', c['btn'] and 'nahráván' in c['btn'] and c['st'], c)
        await page.evaluate("() => document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none')")

        # E — Offset bod: pole azimutu má rozumnou šířku
        await page.evaluate("() => { if (typeof agOpenOffsetTool === 'function') agOpenOffsetTool(); }")
        await page.wait_for_timeout(700)
        e = await page.evaluate("() => { var i = document.getElementById('agof-az'); return i ? Math.round(i.getBoundingClientRect().width) : null; }")
        ok('E8 Offset bod: pole azimutu široké aspoň 120 px', e is not None and e >= 120, e)
        await page.evaluate("() => document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none')")

        # D — Ročenka: řada měsíců
        # Ročenka je v MANIFESTu js/lazy-tools.js (stahuje se až na klepnutí) → přes AGLazyTools.open
        await page.evaluate("() => { if (window.AGLazyTools && AGLazyTools.open) return AGLazyTools.open('rocenka'); if (window.AGRocenka) AGRocenka.open(); }")
        await V329.cekej(page, "document.querySelector('.agroc-mes-l')", 50)
        d = await page.evaluate("() => Array.from(document.querySelectorAll('.agroc-mes-l')).map(e => e.textContent)")
        if not d:
            print('   ročenka:', await page.evaluate("() => { var m = document.getElementById('ag-roc-modal'); return m ? [m.style.display, m.textContent.replace(/\s+/g, ' ').slice(0, 200)] : 'neni'; }"))
        ok('D2 Ročenka: měsíce led…pro bez duplicity', d[:2] == ['led', 'úno'] and d[-1:] == ['pro'] and len(d) == 12, d)

        vazne = [x for x in chyby if 'favicon' not in x and 'net::ERR' not in x and '404' not in x and 'Failed to fetch' not in x and 'ERR_FAILED' not in x and 'Failed to load resource' not in x]
        ok('Z bez chyb stránky', not vazne, vazne[:5])
        await ctx.close()
        await br.close()


def main():
    staticke()
    srv, url = V329.server(PORT)
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
