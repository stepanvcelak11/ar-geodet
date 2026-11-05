# -*- coding: utf-8 -*-
u"""ŘAZENÍ NÁSTROJŮ PODLE POUŽÍVÁNÍ (4. 11. 2026, js/field-tools.js).

V každé skupině Nástrojů jsou nahoře nástroje otevírané nejčastěji (aspoň 2×), skupiny
zůstávají na místě, ★ Oblíbené se neřadí, vypínač v Nastavení → Ovládání vrátí pořadí.

python scripts/test_razeni_nastroju.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9132)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


# Vizuální pořadí skupiny: dlaždice za nadpisem seřazené podle polohy na obrazovce.
SKUPINA = """() => {
  const grid = document.querySelector('#tools-modal .tool-grid');
  const kids = Array.from(grid.children).filter(e => e.getClientRects().length > 0);
  kids.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (ra.top - rb.top) || (ra.left - rb.left); });
  const out = []; let cur = null;
  for (const el of kids) {
    if (el.classList.contains('tool-cat') || el.classList.contains('ag-ft-head')) { cur = { h: el.textContent.trim().slice(0, 30), id: el.id, t: [] }; out.push(cur); continue; }
    if (cur && (el.classList.contains('tool-tile') || el.classList.contains('ag-ft-tile'))) {
      const dt = el.getAttribute('data-tool') || ((el.getAttribute('onclick') || '').match(/([A-Za-z_$][\\w$]*)\\s*\\(/g) || []).pop();
      cur.t.push((dt || '').replace(/\\s*\\($/, ''));
    }
  }
  return out;
}"""


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True, service_workers='block',
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.setItem('agDomov_v1', JSON.stringify({auto:false}));")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        await page.evaluate("() => { document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); window.AGLazy && AGLazy.flush && AGLazy.flush(); }")
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'flex'; }")
        ok('A1 mřížka nástrojů hotová', await V.cekej(page, "document.querySelectorAll('#tools-modal .ag-ft-tile').length > 20", 30))
        await page.wait_for_timeout(1500)
        # SEZNAM ÚKONŮ (to, co člověk v Nástrojích vidí): stránka slovesa se 4+ řádky
        STR = """() => Array.from(document.querySelectorAll('#ag-uk-list .ag-uk-page')).map(pg => ({ id: pg.getAttribute('data-page') || pg.id, k: Array.from(pg.querySelectorAll(':scope .ag-uk-i[data-k]')).filter(b => !b.closest('.ag-uk-sub')).map(b => b.getAttribute('data-k')) }))"""
        ok('A2 seznam úkonů postavený', await V.cekej(page, "document.querySelectorAll('#ag-uk-list .ag-uk-i[data-k]').length > 10", 20))
        pred = await page.evaluate(STR)
        sk = next((g for g in pred if len(g['k']) >= 4 and g['id'] not in ('moje', 'pro', 'dalsi')), None)
        ok('A3 stránka slovesa se 4+ nástroji', sk is not None, pred[:3])
        posledni, druhy = sk['k'][-1], sk['k'][-2]
        await page.evaluate("([a, b]) => { const u = JSON.parse(localStorage.getItem('agToolUsage_v1') || '{}'); u[a] = 9; u[b] = 3; localStorage.setItem('agToolUsage_v1', JSON.stringify(u)); AGUkony.rebuild(); }", [posledni, druhy])
        await page.wait_for_timeout(300)
        po = await page.evaluate(STR)
        sk2 = next(g for g in po if g['id'] == sk['id'])
        ok('B1 nejpoužívanější nástroj stránky je první, druhý nejpoužívanější druhý', sk2['k'][:2] == [posledni, druhy], (sk['k'], sk2['k']))
        ok('B2 stránky (slovesa) zůstaly ve stejném pořadí', [g['id'] for g in po] == [g['id'] for g in pred])
        ok('B3 na stránce jsou pořád tytéž nástroje', sorted(sk2['k']) == sorted(sk['k']))
        await page.evaluate("(a) => { const u = JSON.parse(localStorage.getItem('agToolUsage_v1') || '{}'); u[a] = 1; localStorage.setItem('agToolUsage_v1', JSON.stringify(u)); AGUkony.rebuild(); }", sk['k'][0])
        po1 = next(g for g in await page.evaluate(STR) if g['id'] == sk['id'])
        ok('B4 jedno použití nic nepřehází', po1['k'][2:] == [x for x in sk['k'] if x not in (posledni, druhy)], po1['k'])

        # MŘÍŽKA (ukazuje se při hledání a v jednoduchém režimu nástrojů): totéž v rámci skupiny
        await page.evaluate("() => { document.body.classList.remove('ag-uk-on'); agFilterTools(); }")
        mr = await page.evaluate(SKUPINA)
        g1 = next((g for g in mr if posledni in g['t']), None)
        ok('B5 mřížka: nejpoužívanější nástroj je ve své skupině první', g1 is not None and g1['t'][0] == posledni, g1)
        await page.evaluate("() => { const g = document.querySelector('#tools-modal .tool-grid'); const d = document.createElement('div'); d.className = 'tool-cat'; d.textContent = 'Test'; g.appendChild(d); }")
        await page.wait_for_timeout(300)
        po2 = await page.evaluate(SKUPINA)
        ok('B6 mřížka: prvek přidaný cizím modulem na konec zůstane na konci', po2 and po2[-1]['h'] == 'Test', [g['h'] for g in po2][-3:])
        await page.evaluate("() => { document.body.classList.add('ag-uk-on'); }")

        # hledání: relevance, nadpisy schované
        await page.fill('#tools-search', 'kompas')
        await page.wait_for_timeout(300)
        n = await page.evaluate("() => Array.from(document.querySelectorAll('#tools-modal .tool-grid > *')).filter(e => e.getClientRects().length > 0 && (e.classList.contains('tool-tile') || e.classList.contains('ag-ft-tile'))).length")
        ok('C1 hledání funguje dál', n >= 1, n)
        # 5. 11. 2026: „zadám počasí a zapne se mi firma" — js/ucty-admin.js při agucty:perms
        #   přepíše display dlaždice „Firma a účty" a ta bez pořadí skočila NAHORU pod prst
        await page.fill('#tools-search', 'počasí')
        await page.wait_for_timeout(300)
        await page.evaluate("() => { const t = document.querySelector('#tools-modal .tool-tile[data-tool=\"ucty-firma\"]'); if (t) t.style.display = ''; window.dispatchEvent(new Event('agucty:perms')); }")
        await page.wait_for_timeout(300)
        prvni = await page.evaluate("() => { const v = Array.from(document.querySelectorAll('#tools-modal .tool-grid > .tool-tile')).filter(e => e.getClientRects().length > 0); v.sort((a, b) => (+getComputedStyle(a).order) - (+getComputedStyle(b).order)); return v.map(e => e.getAttribute('data-tool') || e.textContent.trim().slice(0, 20)); }")
        ok('C2 hledání „počasí": Firma a účty se neukáže ani po přepnutí oprávnění, první je Počasí', 'ucty-firma' not in prvni and prvni and 'pocasi' in prvni[0].lower().replace('í', 'i').replace('č', 'c').replace('a', 'a'), prvni[:4])
        box = await page.evaluate("() => { const b = document.getElementById('ag-as-tools'); return b ? b.style.order : null; }")
        await page.fill('#tools-search', 'po')
        await page.wait_for_timeout(300)
        box = await page.evaluate("() => { const b = document.getElementById('ag-as-tools'); return b ? b.style.order : 'x'; }")
        ok('C3 blok „Jinde v appce" zůstává pod výsledky (order 9999)', box in ('9999', 'x'), box)
        await page.fill('#tools-search', '')

        # vypnutí v Nastavení
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'none'; openSettings(); }")
        ok('D1 vypínač v Nastavení → Ovládání', await V.cekej(page, "!!document.getElementById('s-tool-sort') && document.getElementById('s-tool-sort').checked", 10))
        await page.evaluate("() => { const c = document.getElementById('s-tool-sort'); c.checked = false; c.dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('settings-modal').style.display='none'; document.getElementById('tools-modal').style.display = 'flex'; }")
        await page.wait_for_timeout(300)
        await page.evaluate("() => AGUkony.rebuild()")
        po3 = next(g for g in await page.evaluate(STR) if g['id'] == sk['id'])
        ok('D2 vypnuto = původní pořadí', po3['k'] == sk['k'], (sk['k'], po3['k']))
        ok('Z bez chyb stránky', not chyby, chyby[:5])
        await ctx.close()
        await br.close()


def main():
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
