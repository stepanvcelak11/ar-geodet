# -*- coding: utf-8 -*-
u"""OPTIMALIZACE 4. 11. 2026 (profil startu na slabém telefonu, CPU 4×).

  O1 seznam Nástrojů (js/nastroje-ukony.js) se v zavřeném okně nestaví — ani na žádost
     js/moje-aktivita.js; postaví se při otevření okna a je úplný.
  O2 js/android.js: změny stylu mimo okna (stavový pruh, HUD) nespouštějí procházení oken.
  O3 mapa kvality GPS se počítá ve Web Workeru a výsledek je stejný jako na hlavním vlákně.

python scripts/test_optimalizace_11_4.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9135)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True, service_workers='block',
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        await page.evaluate("() => window.AGLazy && AGLazy.flush && AGLazy.flush()")
        await V.cekej(page, "window.AGLazy && AGLazy.hotovo()", 60)
        await page.wait_for_timeout(3000)

        # O1
        n = await page.evaluate("() => document.querySelectorAll('#ag-uk-list .ag-uk-i').length")
        ok('O1a po startu (okno zavřené) seznam Nástrojů není postavený', n == 0, n)
        await page.evaluate("() => AGUkony.rebuild()")
        n = await page.evaluate("() => document.querySelectorAll('#ag-uk-list .ag-uk-i').length")
        ok('O1b rebuild() při zavřeném okně jen poznamená', n == 0, n)
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'flex'; }")
        ok('O1c po otevření okna je seznam postavený a úplný', await V.cekej(page, "document.querySelectorAll('#ag-uk-list .ag-uk-i[data-k]').length > 30 && document.body.classList.contains('ag-uk-on')", 10),
           await page.evaluate("() => document.querySelectorAll('#ag-uk-list .ag-uk-i[data-k]').length"))
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'none'; }")

        # O2
        r = await page.evaluate("""async () => {
            const puv = AGZpet.otevrene; let n = 0;
            AGZpet.otevrene = function () { n++; return puv.apply(this, arguments); };
            // otevrene() volá check() přes uzávěr — počítat přes querySelectorAll se selektorem oken
            const qsa = Document.prototype.querySelectorAll; let k = 0;
            Document.prototype.querySelectorAll = function (s) { if (String(s).indexOf('.modal-overlay, .ag-dlg-overlay') === 0) k++; return qsa.call(this, s); };
            const guard0 = AGZpet._test.guard();
            const el = document.createElement('div'); document.body.appendChild(el);
            const t0 = performance.now();
            for (let i = 0; i < 30; i++) { el.style.width = i + 'px'; await new Promise(r => requestAnimationFrame(r)); }
            const bezOken = k;
            // js/android.js má navíc pojistný tik jednou za 2 s — ten smí do měření spadnout
            const tiky = Math.ceil((performance.now() - t0) / 2000);
            const m = document.getElementById('settings-modal'); m.style.display = 'flex';
            await new Promise(r => setTimeout(r, 100));
            const sOknem = k;
            m.style.display = 'none';
            Document.prototype.querySelectorAll = qsa; AGZpet.otevrene = puv; el.remove();
            return { bezOken, sOknem, guard0, tiky };
        }""")
        ok('O2a 30 změn stylu mimo okna = žádné procházení oken (kromě pojistného tiku po 2 s)', r['bezOken'] <= r['tiky'], r)
        # se strážnou v historii (okno už otevřené) check() schválně nic neprochází — jako dřív
        ok('O2b otevření okna se pozná dál', r['sOknem'] >= 1 or r['guard0'], r)

        # O3
        await page.evaluate("() => AGLazyTools.load('js/mapa-kvality-gps.js')")
        ok('O3a modul mapy kvality GPS', await V.cekej(page, "!!window.AGKvalitaGpsMapa && !!AGKvalitaGpsMapa.spocitejNaPozadi", 30))
        r = await page.evaluate("""async () => {
            const n = 110, v = new Float32Array(n * n);
            for (let y = 40; y < 60; y++) for (let x = 30; x < 50; x++) v[y * n + x] = 12;   // „dům" 40 × 40 m, 12 m vysoký
            for (let y = 70; y < 90; y++) for (let x = 60; x < 64; x++) v[y * n + x] = 6;
            const K = { BUNKA: 4, PX: 2, AZ: 16, DOSAH: 60, KROK: 2, MASKA: 10 };
            const sync = AGKvalitaGpsMapa.mrizkaZ(v, n, 55, K);
            const src = 'var mrizkaZ = ' + AGKvalitaGpsMapa.mrizkaZ.toString() + ';self.onmessage=function(e){var d=e.data;var m=mrizkaZ(d.v,d.n,d.cells,d.K);self.postMessage({m:m},[m.buffer]);};';
            const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
            const m = await new Promise(ok => { w.onmessage = e => ok(e.data.m); w.postMessage({ v, n, cells: 55, K }); });
            let rozdil = 0, cerv = 0; for (let i = 0; i < sync.length; i++) { rozdil = Math.max(rozdil, Math.abs(sync[i] - m[i])); if (sync[i] < 0.6) cerv++; }
            return { rozdil, delka: m.length, cerv };
        }""")
        ok('O3b worker spočítá totéž co hlavní vlákno (a stínění u „domu" vidí)', r['rozdil'] < 1e-6 and r['delka'] == 55 * 55 and r['cerv'] > 50, r)
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
