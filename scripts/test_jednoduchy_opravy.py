# -*- coding: utf-8 -*-
u"""OPRAVY JEDNODUCHÉHO REŽIMU (15. 11. 2026).

Hlášení: „kalibrace po hraně blbne · občas se mi zapne klasicky, i když mám jednoduchý režim ·
někdy se mi nezapne úvodní obrazovka, i když ji chci pokaždé · Kde se dá měřit v podchodu
ukazuje, že měřit mohu".

  D  Domů se ukáže i v jednoduchém režimu, leží NAD ním; zavřením je vidět režim;
     Nastavení z Domů režim jen pozastaví a po zavření se vrátí
  W  pojistka: zapnutý režim, který není vidět (a nic ho nepozastavilo), se sám vrátí
  K  kalibrace po hraně: přebal se NEVRACÍ sám, když okno kalibrace zmizí (klepe se do mapy)
  Q  Kde se dá měřit: v tunelu/podchodu červená (0), pod mostem nejvýš oranžová
  Z  bez chyb stránky
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9145)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


ZAVRI = "() => { document.querySelectorAll('.ag-dlg-overlay.open .ag-dlg-btn:not(.ag-ok)').forEach(b => b.click()); }"
NAHORE = "(id) => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return !!(e && e.closest('#' + id)); }"


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True, service_workers='block',
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agJednoduchy_v1','1'); localStorage.setItem('agDomov_v1', JSON.stringify({auto:true, rezim:'vzdy'}));")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        await V.cekej(page, "document.body.classList.contains('ag-jr-on')", 60)
        await page.evaluate(ZAVRI)
        ok('D1 Domů se ukáže i v jednoduchém režimu', await V.cekej(page, "document.body.classList.contains('ag-domov-on')", 15),
           await page.evaluate("() => localStorage.getItem('agDomovDuvod_v1')"))
        await page.evaluate(ZAVRI)
        ok('D2 Domů leží nad přebalem režimu (je vidět)', await V.cekej(page, "(%s)('ag-domov')" % NAHORE, 5))
        ok('D3 tlačítko „Jednoduchý režim" na Domů se v režimu neukazuje', await page.evaluate("() => { const b = document.querySelector('#ag-domov [data-agd=\"jednoduchy\"]'); return !b || b.hidden; }"))
        await page.evaluate("() => AGDomov.zavri()")
        ok('D4 zavřením Domů je vidět jednoduchý režim', await V.cekej(page, "(%s)('ag-jr')" % NAHORE, 5))
        await page.evaluate("() => AGDomov.otevri()")
        await page.click('#ag-domov [data-agd="nastaveni"]')
        ok('D5 Nastavení z Domů: režim ustoupí, Nastavení je vidět', await V.cekej(page, "AGJednoduchy.pauza() && getComputedStyle(document.getElementById('settings-modal')).display !== 'none' && (%s)('settings-modal')" % NAHORE, 5))
        await page.wait_for_timeout(1000)   # člověk Nastavení chvíli používá
        await page.evaluate("() => { document.getElementById('settings-modal').style.display = 'none'; }")
        ok('D6 po zavření Nastavení je zpátky jednoduchý režim', await V.cekej(page, "!AGJednoduchy.pauza() && (%s)('ag-jr')" % NAHORE, 5))

        # ---- W pojistka
        await page.evaluate("() => { document.getElementById('ag-jr').classList.remove('jr-on'); document.body.classList.remove('ag-jr-on'); }")
        ok('W1 zmizelý přebal zapnutého režimu se sám vrátí', await V.cekej(page, "document.getElementById('ag-jr').classList.contains('jr-on')", 6))

        # ---- K kalibrace po hraně bez automatického návratu
        await page.click('#ag-jr-vrstvy-btn')
        await page.click('#ag-jr-vrstvy [data-vr="hrana"]')
        ok('K1 kalibrace po hraně se otevře v plné appce', await V.cekej(page, "AGJednoduchy.pauza() && !!window.AGHrana", 8))
        await page.wait_for_timeout(800)
        # okno kalibrace se schová (výběr čáry klepáním do mapy) → uprostřed je mapa
        await page.evaluate("() => { document.querySelectorAll('.modal-overlay, [id*=hrana], [id*=hr-]').forEach(m => { if (m.id !== 'map' && getComputedStyle(m).position === 'fixed') m.style.display = 'none'; }); }")
        await page.wait_for_timeout(2000)
        ok('K2 přebal se nevrátí přes mapu sám (zpátky jen tlačítkem nahoře)', await page.evaluate("() => AGJednoduchy.pauza() && !document.getElementById('ag-jr-pill').hidden"))
        await page.click('#ag-jr-pill')
        ok('K3 tlačítko „Jednoduchý režim" vrátí přebal', await V.cekej(page, "!AGJednoduchy.pauza()", 3))

        # ---- Q kvalita GPS: tunel a most z vektorové mapy (podstrčená data)
        await page.evaluate("() => new Promise(r => { if (window.AGKvalitaGpsMapa) return r(); const sc = document.createElement('script'); sc.src = 'js/mapa-kvality-gps.js'; sc.onload = r; sc.onerror = r; document.head.appendChild(sc); })")
        q = await page.evaluate("""(a) => {
            const lat = a[0], lng = a[1], m = 111320, ml = 111320 * Math.cos(lat * Math.PI / 180);
            const cara = (dy, dx1, dx2, props) => { const l = [{ lat: lat + dy / m, lng: lng + dx1 / ml }, { lat: lat + dy / m, lng: lng + dx2 / ml }]; l.vlastnosti = props; return l; };
            window.AGMapaVektor = window.AGMapaVektor || {};
            const stara = { cary: AGMapaVektor.cary, plochy: AGMapaVektor.plochy, bud: AGHrany.budovyPolygony };
            AGMapaVektor.cary = function (vr) { return vr === 'roads' ? [cara(0, -40, 40, { kind: 'path', is_tunnel: true }), cara(30, -40, 40, { kind: 'major_road', is_bridge: true }), cara(-30, -40, 40, { kind: 'minor_road' })] : []; };
            AGMapaVektor.plochy = function () { return []; };
            AGHrany.budovyPolygony = function () { return []; };
            try {
                AGKvalitaGpsMapa.spocitej({ lat: lat, lng: lng });
                const sk = (dy) => AGKvalitaGpsMapa.skoreV(lat + dy / m, lng);
                return { tunel: sk(0), most: sk(30), silnice: sk(-30), volno: sk(-15) };
            } finally { AGMapaVektor.cary = stara.cary; AGMapaVektor.plochy = stara.plochy; AGHrany.budovyPolygony = stara.bud; }
        }""", [V.LAT, V.LNG])
        ok('Q1 v podchodu/tunelu: žádná obloha (červená)', q['tunel'] is not None and q['tunel'] < 0.6, q)
        ok('Q2 pod mostem nejvýš oranžová', q['most'] is not None and 0.6 <= q['most'] <= 0.7, q)
        ok('Q3 obyčejná silnice a volné místo zůstanou zelené', (q['silnice'] or 0) >= 0.85 and (q['volno'] or 0) >= 0.85, q)
        ok('Z bez chyb stránky', not chyby, chyby[:5])
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
