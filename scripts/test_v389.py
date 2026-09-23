# -*- coding: utf-8 -*-
u"""v389 (23. 9. 2026, 5. hodnocení — n6 + n5; + oprava obfuskace při nasazení):
  S1  10 modulů odložených za první vykreslení (ag/lazy), rozpočet startu pod novým stropem 1960 kB
  S2  scripts/obfuscate.mjs dává každému souboru vlastní identifiersPrefix (kolize globálů = charAt)
  L1  odložené moduly po startu opravdu doběhnou (AGCilNav, AGLocalize, agRegisterFieldTool kompas-check…)
  T1  Terénní zkouška: dlaždice v Nástrojích (Přesné měření) otevře okno se 4 kroky
  T2  krok GPS (zkrácený na 3 s): „95 % fixů do … m“
  T3  krok Kamera: výsledek o zorném úhlu
  T4  krok Kompas: výsledek (Slunce nad obzorem → odchylka, pod obzorem → rada přeskočit)
  T5  krok Známý bod (vlastní bod 5 m vedle, zkrácený na 3 s): „Na bodu … vedle“
  T6  souhrn „Tvůj telefon měří na ±X m“ + Poslat autorovi otevře zprávu s výsledkem
python scripts/test_v389.py [port]
"""
import io
import os
import re
import sys
import asyncio
import subprocess

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = V.ROOT
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9055)
VYSLEDKY = []
LAZY = ['kompas-check', 'cadastre-area', 'kos', 'cloud-sync', 'mini-panel', 'ar-visual-track', 'localization-helmert', 'cil-navigace', 'app-search', 'nastaveni-hledani']


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


def src(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8').read()


def staticke():
    h = src('index.html')
    spatne = [f for f in LAZY if ('data-src="js/%s.js"' % f) not in h or ('<script defer src="js/%s.js"' % f) in h]
    ok('S1 10 modulů je ag/lazy (ne defer)', not spatne, spatne)
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'check_start_budget.py'), '--check'], capture_output=True, text=True, encoding='utf-8', errors='replace')
    m = re.search(r'\((\d+) kB JS', r.stdout)
    ok('S1 rozpočet startu drží pod 1960 kB', r.returncode == 0 and m and int(m.group(1)) <= 1960, r.stdout.strip()[-200:])
    o = src('scripts/obfuscate.mjs')
    ok('S2 obfuskace: identifiersPrefix pro každý soubor', 'identifiersPrefix: prefixPro(rel)' in o)


async def beh(url):
    chyby = []
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'], service_workers='block')
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        try:
            cdp = await ctx.new_cdp_session(page)
            await cdp.send('DeviceOrientation.setDeviceOrientationOverride', {'alpha': 30, 'beta': 80, 'gamma': 0})
        except Exception:
            pass
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 appka nastartovala', await V.cekej(page, "document.body.classList.contains('app-started')", 40))
        ok('L1 odložené moduly po startu doběhnou (AGCilNav, AGLocalize, kos, mini-panel)',
           await V.cekej(page, "!!(window.AGCilNav && window.AGLocalize) && [...document.scripts].some(s => /js\\/kos\\.js/.test(s.src)) && [...document.scripts].some(s => /mini-panel\\.js/.test(s.src))", 60),
           await page.evaluate("() => [typeof window.AGCilNav, typeof window.AGLocalize, [...document.scripts].map(s => s.src.split('/').pop()).filter(n => /kos|mini-panel|cil-nav|localization/.test(n))]"))

        # vlastní bod 5 m od polohy (krok Známý bod)
        await page.evaluate("() => window.addImportedPoints([{ name: 'ZK1', lat: %f, lng: %f, origin: 'import' }])" % (V.LAT + 0.000045, V.LNG))
        # otevřít z Nástrojů
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(1500)
        await page.evaluate("() => { window.AGLazy && AGLazy.flush(); for (let i = 0; i < 3; i++) document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click()); }")
        await V.cekej(page, "!!document.querySelector('#tools-modal .ag-uk-i[data-k=\"terenni-zkouska\"]')", 20)
        await page.evaluate("() => { const r = document.querySelector('#tools-modal .ag-uk-i[data-k=\"terenni-zkouska\"]'); r.scrollIntoView(); r.click(); }")
        ok('T1 Nástroje → Terénní zkouška: okno se 4 kroky', await V.cekej(page, "document.querySelectorAll('#ag-tz-modal .tz-k').length === 4 && document.getElementById('ag-tz-modal').style.display === 'flex'", 15))
        await page.evaluate("() => { AGTerenniZkouska._test.cfg.gpsS = 3; AGTerenniZkouska._test.cfg.bodS = 3; }")

        await page.evaluate("() => document.querySelector('#ag-tz-modal .tz-k[data-k=gps] button').click()")
        await page.wait_for_timeout(4200)
        g = await page.evaluate("() => document.querySelector('#ag-tz-modal .tz-k[data-k=gps] .tz-out').textContent")
        ok('T2 GPS: „95 % fixů do … m od průměru“', '95 % fixů do' in g, g)

        await page.evaluate("() => document.querySelector('#ag-tz-modal .tz-k[data-k=fov] button').click()")
        f = await page.evaluate("() => document.querySelector('#ag-tz-modal .tz-k[data-k=fov] .tz-out').textContent")
        ok('T3 Kamera: výsledek o zorném úhlu', 'Zorný úhel' in f, f)

        await page.evaluate("() => document.querySelector('#ag-tz-modal .tz-k[data-k=kompas] button').click()")
        k = await page.evaluate("() => document.querySelector('#ag-tz-modal .tz-k[data-k=kompas] .tz-out').textContent")
        ok('T4 Kompas: odchylka od Slunce, nebo rada přeskočit (Slunce pod obzorem)', ('vedle Slunce' in k) or ('pod obzorem' in k) or ('Kompas nehlásí' in k), k)

        await page.evaluate("() => document.querySelector('#ag-tz-modal .tz-k[data-k=bod] button').click()")
        await page.wait_for_timeout(4200)
        b = await page.evaluate("() => document.querySelector('#ag-tz-modal .tz-k[data-k=bod] .tz-out').textContent")
        ok('T5 Známý bod: „Na bodu ZK1 ukazuje GPS … m vedle (ΔY, ΔX)“', 'Na bodu ZK1' in b and 'ΔY' in b, b)

        s = await page.evaluate("() => { const x = document.querySelector('#ag-tz-modal .tz-sum'); return x && !x.hidden ? x.textContent : null; }")
        ok('T6 souhrn „Tvůj telefon měří na ±X m“', s and 'Tvůj telefon měří na' in s, s)
        await page.evaluate("() => document.getElementById('ag-tz-send').click()")
        ok('T6 Poslat autorovi → zpráva s výsledkem zkoušky', await V.cekej(page, "(() => { const t = document.getElementById('ag-fb-txt'); return !!t && /Terénní zkouška telefonu/.test(t.value) && /GPS 60 s/.test(t.value); })()", 15),
           await page.evaluate("() => { const t = document.getElementById('ag-fb-txt'); return t ? t.value.slice(0, 200) : null; }"))

        ok('E1 bez chyb stránky', not chyby, chyby[:4])
        await ctx.close()
        await br.close()


def main():
    staticke()
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    n = len(VYSLEDKY); d = sum(VYSLEDKY)
    print('\n%d/%d OK' % (d, n))
    sys.exit(0 if d == n else 1)


if __name__ == '__main__':
    main()
