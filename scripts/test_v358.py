# -*- coding: utf-8 -*-
"""PRUCHOD APPKOU 18. 9. 2026, 2. kolo (v358): brana, lazy-load, preklady.

  A  NOVY UZIVATEL: brana → „Dalsi moznosti" → „Zalozit jen pro toto zarizeni" → PIN → Zavrit pruvodce
     → APPKA SE SPUSTI. Do v357 zustala cerna obrazovka jen s dokem (gateCheck: firma existuje → return,
     init() uz probehl, pojistka 6 s dobehla s otevrenym pruvodcem).
  B  LAZY-LOAD: AGLazy.need(src, cb) na modul, ktery uz leti siti (po flush je fronta prazdna, skript
     jeste nedobehl) zavola cb AZ PO nacteni — drive hned, a menu „Navod a prohlidka" padalo na
     „startTutorial is not defined". Pojistka na klepnuti drzi i tlacitka bocniho menu (#side-menu [onclick]).
  C  SLOVNIK: vzory „jeste N m" / „postuj jeste N s" a klic „cekam na GPS" (tlacitko Nasel jsem ho
     v karte bodu zustavalo v EN/DE/PL/ES/IT cesky).

Spusteni: python scripts/test_v358.py [port]
"""
import os
import sys
import io
import json
import asyncio
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as T  # noqa: E402
from ag_boot import boot  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9290)
vysledky = []
LAT, LNG = T.LAT, T.LNG


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


def staticke():
    print('--- staticke ---')
    d = json.load(io.open(os.path.join(ROOT, 'data', 'jazyky.json'), encoding='utf-8'))
    re_keys = [r[0] for r in d.get('re', [])]
    ok('C0 slovnik ma vzor „ještě N m" a „postůj ještě N s"', '^ještě (\\d+) m$' in re_keys and '^postůj ještě (\\d+) s$' in re_keys, re_keys[-3:])
    ok('C0 slovnik zna „čekám na GPS" ve vsech jazycich', len(d['t'].get('čekám na GPS', [])) == len(d['poradi']))
    ll = io.open(os.path.join(ROOT, 'js', 'lazy-load.js'), encoding='utf-8').read()
    ok('B0 lazy-load: pojistka klepnuti kryje i #side-menu [onclick]', "#side-menu [onclick]" in ll)
    ok('B0 lazy-load: need() ceka na rozjety skript (hotovo[])', 'hotovo[src] = true' in ll)
    u = io.open(os.path.join(ROOT, 'js', 'ucty.js'), encoding='utf-8').read()
    ok('A0 ucty.gateCheck: firma bez bezici appky → enterApp()', 'FIRMA ZALOŽENÁ ZA BĚHU' in u)


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()

        print('--- A) novy uzivatel: lokalni firma → appka bezi ---')
        chyby = []
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)[:200]))
        await page.route('**/*', T.route_vse)
        await page.goto(url, wait_until='domcontentloaded', timeout=45000)
        await page.wait_for_timeout(2500)
        ok('A1 bez uctu stoji brana', await page.evaluate("() => !!document.getElementById('ag-gate') && !document.body.classList.contains('app-started')"))
        await page.evaluate("() => document.getElementById('agg-new').click()")
        await page.wait_for_timeout(1000)
        await page.evaluate("() => document.getElementById('agfa-w-local').click()")
        await page.wait_for_timeout(900)
        await page.evaluate("() => { var b = Array.from(document.querySelectorAll('.ag-dlg-overlay.open button')).find(b => /Jsem správce/.test(b.textContent)); if (b) b.click(); }")
        await page.wait_for_timeout(900)
        ok('A2 formular lokalni firmy', await page.evaluate("() => !!document.getElementById('agfa-w-go') && !!document.getElementById('agfa-w-pin')"))
        await page.evaluate("() => { [['agfa-w-firm','Zkušební prostor'],['agfa-w-name','Tester Dva'],['agfa-w-pin','1234'],['agfa-w-pin2','1234']].forEach(a => { var e = document.getElementById(a[0]); if (e) { e.value = a[1]; e.dispatchEvent(new Event('input', { bubbles: true })); } }); document.getElementById('agfa-w-go').click(); }")
        await page.wait_for_timeout(2500)
        ok('A3 firemni rezim zapnut (dialog)', await page.evaluate("() => /Firemní režim zapnut/.test((document.querySelector('.ag-dlg-overlay.open') || {}).textContent || '')"))
        await page.evaluate("() => { var d = document.querySelector('.ag-dlg-overlay.open'); var bs = d ? d.querySelectorAll('button') : []; if (bs.length) bs[bs.length - 1].click(); }")
        await page.wait_for_timeout(800)
        await page.evaluate("() => { var m = document.getElementById('agfa-modal'); var b = m && Array.from(m.querySelectorAll('button')).find(b => /^Zavřít$/.test(b.textContent.trim()) && b.getBoundingClientRect().height > 0); if (b) b.click(); }")
        started = await T.cekej(page, "document.body.classList.contains('app-started')", 15)
        ok('A4 po zavreni pruvodce appka BEZI (mapa, ne cerna obrazovka)', started, await page.evaluate("() => ({ started: document.body.classList.contains('app-started'), gate: !!document.getElementById('ag-gate'), firma: !!localStorage.getItem('agFirma_v1') })"))
        ok('A5 zadna brana pres appku', await page.evaluate("() => !document.getElementById('ag-gate') && !document.getElementById('ag-login')"))
        ok('A6 zadna chyba stranky', not chyby, chyby[:3])
        await ctx.close()

        print('--- B) lazy-load: need() na rozjety modul + pojistka menu ---')
        chyby = []
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)[:200]))

        # tutorial-pro.js a pruvodce.js zdrzet o 2,5 s — simulace pomaleho spoje
        async def zdrz(route, request):
            u = request.url
            if u.endswith('/js/tutorial-pro.js') or u.endswith('/js/pruvodce.js'):
                await asyncio.sleep(2.5)
                try:
                    return await route.continue_()
                except Exception:
                    return
            return await T.route_vse(route, request)
        await page.route('**/*', zdrz)
        await page.add_init_script(boot(tarif='pro') + T.SEED + "localStorage.setItem('agViewMode','map');")
        await page.goto(url, wait_until='domcontentloaded', timeout=45000)
        await T.cekej(page, "document.body.classList.contains('app-started')")
        await page.wait_for_timeout(500)
        # flush = vsechno leti siti; hned potom need() na tutorial: callback musi pockat
        b1 = await page.evaluate("""() => new Promise(res => { AGLazy.flush(); var t0 = Date.now(); var pred = typeof window.startTutorial; AGLazy.need('js/tutorial-pro.js', function () { res({ pred: pred, po: typeof window.startTutorial, ms: Date.now() - t0 }); }); setTimeout(function () { res({ pred: pred, po: 'timeout', ms: Date.now() - t0 }); }, 9000); })""")
        ok('B1 need() na letici modul zavola callback az po nacteni (startTutorial = function)', b1 and b1['po'] == 'function' and b1['ms'] >= 1000, b1)
        # menu „Pruvodce ukolem" klepnute driv, nez dorazi pruvodce.js: pojistka klepnuti podrzi
        await page.reload(wait_until='domcontentloaded')
        await T.cekej(page, "document.body.classList.contains('app-started')")
        await page.wait_for_timeout(300)
        chyby.clear()
        await page.evaluate("() => { document.getElementById('side-menu').classList.add('open'); }")
        await page.wait_for_timeout(200)
        await page.click('#pruv-menu-btn')
        await page.wait_for_timeout(6000)
        b2 = await page.evaluate("() => ({ fn: typeof window.openPruvodce, okno: !!Array.from(document.querySelectorAll('.modal-overlay, [id*=pruv]')).find(e => e.id !== 'side-menu' && /pr[uů]vodce/i.test(e.id + ' ' + e.className) && e.getBoundingClientRect().height > 100 && getComputedStyle(e).display !== 'none') })")
        ok('B2 menu „Pruvodce ukolem" klepnute pred nactenim modulu: zadny ReferenceError', not [c for c in chyby if 'not defined' in c], chyby[:3])
        ok('B3 pruvodce se po dotazeni otevrel', b2 and b2['fn'] == 'function' and b2['okno'], b2)
        await ctx.close()

        print('--- C) preklady: karta bodu v EN ---')
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        page = await ctx.new_page()
        await page.route('**/*', T.route_vse)
        await page.add_init_script(boot(tarif='pro') + T.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agJazyk_v1','en'); localStorage.setItem('agLang','en');")
        await page.goto(url, wait_until='domcontentloaded', timeout=45000)
        await T.cekej(page, "document.body.classList.contains('app-started')")
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(3000)
        c1 = await page.evaluate("() => [AGJazyk.t('ještě 40 m'), AGJazyk.t('postůj ještě 5 s'), AGJazyk.t('čekám na GPS')]")
        ok('C1 t(): „ještě 40 m" → „40 m to go", „postůj ještě 5 s", „čekám na GPS"', c1 == ['40 m to go', 'stand still 5 s more', 'waiting for GPS'], c1)
        await page.evaluate("() => { const pt = arPoints.find(x => x && x.id === 'p_ppbp'); showDetails(pt, 40); }")
        await page.wait_for_timeout(3500)
        c2 = await page.evaluate("() => Array.from(document.querySelectorAll('#bottom-sheet button')).map(b => b.textContent.replace(/\\s+/g, ' ').trim()).find(t => /found/i.test(t))")
        ok('C2 tlacitko „I found it" v karte bez ceskeho zbytku', c2 and 'ještě' not in c2 and 'to go' in c2, c2)
        await br.close()


def main():
    staticke()
    srv, url = T.server(PORT)
    if not srv:
        print('CHYBA server se nespustil'); return 1
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
