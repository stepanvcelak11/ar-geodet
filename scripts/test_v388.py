# -*- coding: utf-8 -*-
u"""v388 (23. 9. 2026, 5. hodnocení — n1 + n7):
  H1  okna modulů (Zápisníky, Postupy měření, Náčrt/Tachymetrie, Počasí) zavírá TENTÝŽ kulatý křížek
      jako ostatní nástroje: .agmc-x, 40 px, vpravo nahoře, aria-label Zavřít, a opravdu zavře
  H2  Postupy: v podstránce „‹ Zpět“ (text), zpátky na seznamu zase křížek
  B1  karta VLASTNÍHO bodu → řádek „Nástroje k tomuto bodu“ → Moje nahoře „K bodu …“ se třemi nástroji k vytyčení a kontrole
  B2  karta ÚŘEDNÍHO bodu → „K bodu …“ se Srovnat sever podle bodu
  B3  bez karty bodu sekce není
python scripts/test_v388.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9053)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


OTEVRI_NASTROJ = """(k) => new Promise(res => {
    document.getElementById('dock-nastroje-btn').click();
    setTimeout(() => { window.AGLazy && AGLazy.flush();
        for (let i = 0; i < 3; i++) document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded="false"]').forEach(h => h.click());
        const r = document.querySelector('#tools-modal .ag-uk-i[data-k="' + k + '"]'); if (r) { r.scrollIntoView(); r.click(); }
        setTimeout(res, 1800); }, 1200);
})"""
KRIZEK = """(sel) => { const b = document.querySelector(sel); if (!b) return null; const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    return { agmc: b.classList.contains('agmc-x'), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), br: cs.borderRadius, al: b.getAttribute('aria-label'), t: b.textContent.trim() }; }"""
MOJE_BOD = """() => { const s = document.querySelector('#tools-modal .ag-uk-bod'); if (!s) return null;
    return { h: s.querySelector('.ag-uk-h').textContent, k: [...s.querySelectorAll('.ag-uk-i')].map(b => b.getAttribute('data-k')), prvni: s === document.querySelector('#tools-modal .ag-uk-page[data-page] .ag-uk-g, #tools-modal .ag-uk-page[data-page] section') }; }"""


async def beh(url):
    chyby = []
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ');")
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        ok('A0 appka nastartovala', await V.cekej(page, "document.body.classList.contains('app-started')", 40))
        await page.wait_for_timeout(2500)

        for k, sel, ov in (('zapisnik', '#ag-zb-back', '#ag-zb-ov'), ('postupy', '#ag-pm-back', '#ag-pm-ov'),
                           ('openTachymetrie', '#tachy-x', '#tachy-modal'), ('pocasi', '#ag-wx-close', '#ag-wx-overlay')):
            await page.evaluate(OTEVRI_NASTROJ, k)
            x = await page.evaluate(KRIZEK, sel)
            ok('H1 %s: kulatý křížek .agmc-x 40 px vpravo, aria-label Zavřít' % k,
               x and x['agmc'] and x['w'] == 40 and x['h'] == 40 and x['x'] > 300 and x['br'] == '50%' and x['al'] == 'Zavřít', x)
            if k == 'postupy':
                await page.evaluate("() => document.querySelector('#ag-pm-ov .ag-pm-item').click()")
                await page.wait_for_timeout(500)
                z = await page.evaluate(KRIZEK, sel)
                await page.evaluate("() => document.getElementById('ag-pm-back').click()")
                await page.wait_for_timeout(500)
                zz = await page.evaluate(KRIZEK, sel)
                ok('H2 Postupy: podstránka „‹ Zpět“ (text), zpátky křížek', z and not z['agmc'] and 'Zpět' in z['t'] and zz and zz['agmc'], [z, zz])
            await page.evaluate("(s) => document.querySelector(s).click()", sel)
            await page.wait_for_timeout(700)
            zav = await page.evaluate("""(o) => { const e = document.querySelector(o); if (!e) return true; const cs = getComputedStyle(e);
                return cs.display === 'none' || cs.visibility === 'hidden' || !e.classList.contains('open') && cs.opacity === '0' || e.getBoundingClientRect().height === 0 || cs.pointerEvents === 'none'; }""", ov)
            ok('H1 %s: křížek okno zavře' % k, zav)
            await page.evaluate("() => { const m = document.getElementById('tools-modal'); if (m) m.style.display = 'none'; }")

        # H3 (v390): hlavní akce dole u palce — Výška objektu: „Spustit zaměřování“ + Zavřít u spodní hrany
        await page.evaluate("() => new Promise(r => AGLazy.need('js/vyska-objektu.js', () => { window.agOpenVyskaObjektu(); r(); }))")
        await page.wait_for_timeout(900)
        h3 = await page.evaluate("() => { const g = document.getElementById('agvo-go'); const z = g && g.nextElementSibling; if (!g || !z) return null; return { go: Math.round(g.getBoundingClientRect().top), zav: Math.round(z.getBoundingClientRect().bottom), h: innerHeight }; }")
        ok('H3 Výška objektu: hlavní akce dole u palce (Spustit zaměřování nad Zavřít u spodní hrany)', h3 and h3['go'] > h3['h'] * 0.6 and h3['zav'] > h3['h'] - 120, h3)
        await page.evaluate("() => { window.agCloseVyskaObjektu && agCloseVyskaObjektu(); }")

        # B3: bez karty
        await page.evaluate("() => { closeBottomSheet && closeBottomSheet(); }")
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(1500)
        ok('B3 bez karty bodu sekce „K bodu“ není', await page.evaluate(MOJE_BOD) is None)
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'none'; }")

        # B1: vlastní bod
        await page.evaluate("""() => { window.addImportedPoints([{ name: 'Test 4002', lat: %f, lng: %f, origin: 'import' }]);
            const p = arPoints.find(x => x.name === 'Test 4002'); showDetails(p, 12); }""" % (V.LAT + 0.0002, V.LNG + 0.0002))
        await page.wait_for_timeout(900)
        await page.evaluate("() => document.getElementById('ag-kb-nastroje').click()")
        await page.wait_for_timeout(1600)
        b1 = await page.evaluate(MOJE_BOD)
        ok('B1 karta vlastního bodu → „K bodu Test 4002“: kontrolní měření, checklist, protokol',
           b1 and 'Test 4002' in b1['h'] and b1['k'][:3] == ['dvoji-mereni', 'openStakeoutModal', 'protokol-vytyceni'], b1)
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'none'; closeBottomSheet(); }")

        # B2: úřední bod (z fixture ČÚZK)
        await V.cekej(page, "arPoints.some(p => p.cat && p.cat !== 'CUSTOM')", 20)
        await page.evaluate("() => { const p = arPoints.find(x => x.cat && x.cat !== 'CUSTOM'); showDetails(p, 30); }")
        await page.wait_for_timeout(900)
        ma = await page.evaluate("() => { const b = document.getElementById('ag-kb-nastroje'); return b ? b.textContent : null; }")
        ok('B0 karta bodu má řádek „Nástroje k tomuto bodu“', ma and 'Nástroje k tomuto bodu' in ma, ma)
        await page.evaluate("() => document.getElementById('ag-kb-nastroje').click()")
        await page.wait_for_timeout(1600)
        b2 = await page.evaluate(MOJE_BOD)
        ok('B2 karta úředního bodu → „K bodu“ se Srovnat sever podle bodu', b2 and 'úřední' in b2['h'] and 'orient-point' in b2['k'], b2)

        ok('E1 bez chyb stránky', not chyby, chyby[:4])
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
