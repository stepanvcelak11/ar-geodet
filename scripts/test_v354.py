# -*- coding: utf-8 -*-
u"""Regrese k hodnocení appky 18. 9. 2026 (v354) — vybrané návrhy N1, N2, N4, N5 (N3 hlídá test_v332, N8 check_slovnik_nastroje.py):

  N1  Trasa terénem bez dat NEotevírá modální dialog (agInfo = okno Rozumím leželo přes dělič, CI červené),
      říká to pilulka #ag-trasa-pill dole v mapě, která sama zmizí.
  N2  Vektorová mapa má jedno místo: v Nastavení → Vzhled už NENÍ přepínač „Nová mapa (vektor, beta)",
      v Data je jen adresa PMTiles; žádný zdroják neposílá uživatele na „Nastavení → Vzhled → Nová mapa".
  N4  Nastavení má záložku Ovládání (levá ruka, jednoduchý režim, slabší telefon) a Vzhled je bez sekce Ovládání.
  N5  Na nízkém displeji (320×568, 844×390) se dok nekryje s kolečkem Mapa/Split/AR (#ag-view-wheel).

Spuštění:  python scripts/test_v354.py [port]
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
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8997)
vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def staticke():
    t = src('js/trasa-terenem.js')
    ok('N1s trasa-terenem: důvod bez trasy jde pilulkou, ne agInfo', "pilulka('Trasa terénem: '" in t and "agInfo('Trasa terénem" not in t)
    d = src('js/ar-dosah.js')
    ok('N1s ar-dosah: dobíhající stahování po zrušení výběru nic nevybírá (generace)', 'if (gen !== _gen) return;' in d)
    zle = []
    for f in sorted(os.listdir(os.path.join(ROOT, 'js'))):
        if f.endswith('.js') and 'Nastavení → Vzhled → Nová mapa' in src('js/' + f):
            zle.append(f)
    ok('N2s žádný modul neposílá do „Nastavení → Vzhled → Nová mapa"', not zle, zle)
    mv = src('js/mapa-vektor.js')
    ok('N2s mapa-vektor: řádek v Nastavení jde do tab-data a bez přepínače', "document.getElementById('tab-data')" in mv and 'id="s-mapa-vektor"' not in mv)
    ix = src('index.html')
    ok('N4s index.html má záložku Ovládání (6. v DOM) a levá ruka v ní', 'id="tab-ovladani"' in ix and ix.index('id="tabbtn-profily"') < ix.index('id="tabbtn-ovladani"') and ix.index('id="tab-ovladani"') < ix.index('id="s-lefthand"'))
    ok('N5s style.css: dok na nízkém displeji zvednutý (max-height: 640px)', '@media (max-height: 640px)' in src('css/style.css'))


DOK_JS = """() => {
  const r = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const w = document.getElementById('ag-view-wheel'); if (!w) return { chybi: 'wheel' };
  const wr = r(w);
  const btns = [...document.querySelectorAll('#dock .dock-btn')].map(r);
  const ov = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const top = document.elementFromPoint((wr.l + wr.r) / 2, (wr.t + wr.b) / 2);
  return { kolize: btns.some(b => ov(b, wr)), pod: top ? (top.closest && top.closest('#ag-view-wheel') ? 'ag-view-wheel' : (top.id || String(top.className))) : null, dockTop: Math.min(...btns.map(b => b.t)), dockBottom: Math.max(...btns.map(b => b.b)), wheelTop: wr.t, n: btns.length };
}"""


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        init = boot(tarif='zaklad') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');"
        # ---- N5: nízké displeje ----
        for (w, h) in ((320, 568), (844, 390)):
            ctx = await br.new_context(locale='cs-CZ', viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True,
                                       geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
            page = await ctx.new_page()
            page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
            await page.route('**/*', V.route_vse)
            await page.add_init_script(init)
            await page.goto(url, wait_until='domcontentloaded', timeout=60000)
            await V.cekej(page, "document.body.classList.contains('app-started') && document.getElementById('ag-view-wheel')", 60)
            await page.wait_for_timeout(1200)
            d = await page.evaluate(DOK_JS)
            ok('N5 %dx%d: dok (5 chipů) se nekryje s kolečkem pohledu' % (w, h), d.get('n') == 5 and not d.get('kolize') and d.get('dockBottom', 1e9) <= d.get('wheelTop', 0), d)
            ok('N5 %dx%d: pod středem kolečka je kolečko' % (w, h), d.get('pod') == 'ag-view-wheel', d)
            ok('N5 %dx%d: dok nezasahuje pod horní okraj' % (w, h), d.get('dockTop', -1) >= 0, d)
            await ctx.close()

        # ---- N1, N2, N4 ----
        ctx, page = await V.stranka(br, url, init, chyby)
        ok('0 appka nastartovala', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(2500)
        # N1: cíl bez dat mapy → pilulka, žádný dialog
        await page.evaluate("() => { AGTrasa.nastav({ zap: true }); highlightedPointId = 'p_ppbp'; AGTrasa.prepocitej('test'); }")
        await page.wait_for_timeout(1500)
        p = await page.evaluate("() => { const p = document.getElementById('ag-trasa-pill'); const mc = document.getElementById('map-container'); return { text: p ? p.textContent : null, vMape: !!(p && mc && mc.contains(p)), dialog: !!document.querySelector('.ag-dlg-overlay'), videt: p ? p.getBoundingClientRect().height > 10 : false }; }")
        ok('N1 bez dat trasy: pilulka „Trasa terénem: …" v mapě, žádný dialog', p['text'] and p['text'].startswith('Trasa terénem:') and p['vMape'] and p['videt'] and not p['dialog'], p)
        await page.evaluate("() => { const p = document.getElementById('ag-trasa-pill'); if (p) p.click(); }")
        await page.wait_for_timeout(300)
        ok('N1 klepnutí pilulku zavře', await page.evaluate("() => !document.getElementById('ag-trasa-pill')"))
        # N2: nastavení
        await page.evaluate("() => openSettings()")
        await page.wait_for_timeout(900)
        n2 = await page.evaluate("""() => ({
            vzhledBezMapy: !document.getElementById('tab-vzhled').textContent.includes('Nová mapa (vektor'),
            prepinac: !!document.getElementById('s-mapa-vektor'),
            urlVData: !!(document.getElementById('s-mapa-url') && document.getElementById('tab-data').contains(document.getElementById('s-mapa-url'))),
            ovladani: !!document.getElementById('tab-ovladani'),
            levaRuka: !!(document.getElementById('s-lefthand') && document.getElementById('tab-ovladani').contains(document.getElementById('s-lefthand'))),
            jr: !!(document.getElementById('ag-jr-setrow') && document.getElementById('tab-ovladani').contains(document.getElementById('ag-jr-setrow'))),
            lite: !!(document.getElementById('agl-card') && document.getElementById('tab-ovladani').contains(document.getElementById('agl-card'))),
            vzhledBezOvladani: !Array.from(document.querySelectorAll('#tab-vzhled .set-h')).some(h => /^Ovládání$/.test((h.getAttribute('data-ag-cs') || h.textContent).trim())),
            tabBtn: !!document.getElementById('tabbtn-ovladani'),
            tabIndex: Array.from(document.querySelectorAll('#settings-modal .tab-btn')).indexOf(document.getElementById('tabbtn-ovladani'))
        })""")
        ok('N2 Vzhled bez přepínače vektorové mapy, adresa PMTiles v Data', n2['vzhledBezMapy'] and not n2['prepinac'] and n2['urlVData'], n2)
        ok('N4 záložka Ovládání existuje, je 6. v DOM a má levou ruku, jednoduchý režim i slabší telefon', n2['ovladani'] and n2['tabBtn'] and n2['tabIndex'] == 5 and n2['levaRuka'] and n2['jr'] and n2['lite'], n2)
        ok('N4 Vzhled už nemá sekci Ovládání', n2['vzhledBezOvladani'], n2)
        # N4: záložka jde otevřít klepnutím a řádky jsou vidět
        await page.evaluate("() => document.getElementById('tabbtn-ovladani').click()")
        await page.wait_for_timeout(500)
        v = await page.evaluate("() => { const t = document.getElementById('tab-ovladani'); const r = document.getElementById('s-lefthand').closest('.st-row').getBoundingClientRect(); return { aktivni: t.classList.contains('active'), videt: r.height > 10 && r.width > 100 }; }")
        ok('N4 klepnutí na Ovládání záložku otevře a levá ruka je vidět', v['aktivni'] and v['videt'], v)
        vazne = [x for x in chyby if 'favicon' not in x and 'net::ERR' not in x and 'Failed to fetch' not in x and 'ERR_FAILED' not in x and 'Failed to load resource' not in x]
        ok('Z bez chyb stránky', not vazne, vazne[:5])
        await ctx.close()
        await br.close()


def main():
    staticke()
    srv, url = V.server(PORT)
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
