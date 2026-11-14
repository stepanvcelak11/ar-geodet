# -*- coding: utf-8 -*-
u"""JEDNODUCHÝ REŽIM — POSUN MAPY, KAMERA, KARTA BODU, NÁSTROJE (14. 11. 2026).

Přání uživatele: v mapě jednoduchého režimu hýbat prstem (a pak tlačítko na
vycentrování), místo mapy si pustit kameru s body v AR, klepnutím na bod vidět jeho
informace a mít po ruce nejvýš 10 vybraných nástrojů schovaných pod malým tlačítkem.

  A  posun prstem (dotyk) i myší + zoom kolečkem / dvěma prsty; posun vypne sledování
     polohy a objeví se „Vycentrovat", které ji zase zapne
  B  karta bodu: souřadnice, vzdálenost; klepnutí hned po posunu kartu neotevře
  C  přepínač Kamera: #camera-container v okně, zobrazení „ar"; zpět Mapa; volba se pamatuje;
     klepnutí na AR značku = karta bodu (žádný modál plné appky)
  D  nástroje: napoprvé výběr (předvybraná základní sada, strop 10), pak jen vybrané;
     spuštění schová přebal (pauza), po zavření okna nástroje se přebal vrátí sám;
     tlačítko „Jednoduchý režim" vrátí přebal i ručně
  Z  žádná chyba stránky

python scripts/test_jednoduchy_plus.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9137)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


ZAVRI = "() => { document.querySelectorAll('.ag-dlg-overlay.open .ag-dlg-btn:not(.ag-ok)').forEach(b => b.click()); }"
# syntetický tah prstem po okně mapy (Playwright neumí vícebodový dotyk)
TAH = """(a) => {
  const slot = document.getElementById('ag-jr-mapa-home'), r = slot.getBoundingClientRect();
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const t = (x, y, id) => new Touch({ identifier: id || 1, target: slot, clientX: x, clientY: y });
  const ev = (typ, l) => slot.dispatchEvent(new TouchEvent(typ, { bubbles: true, cancelable: true, touches: l, targetTouches: l, changedTouches: l }));
  if (a.dva) {
    ev('touchstart', [t(x0 - 40, y0, 1), t(x0 + 40, y0, 2)]);
    for (let i = 1; i <= 5; i++) ev('touchmove', [t(x0 - 40 - i * 16, y0, 1), t(x0 + 40 + i * 16, y0, 2)]);
    ev('touchend', []);
  } else {
    ev('touchstart', [t(x0, y0)]);
    for (let i = 1; i <= 6; i++) ev('touchmove', [t(x0 + i * a.dx / 6, y0 + i * a.dy / 6)]);
    ev('touchend', []);
  }
  return true;
}"""


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True, service_workers='block',
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation', 'camera'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.setItem('agJednoduchy_v1','1'); localStorage.setItem('agDomov_v1', JSON.stringify({auto:false}));")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start v jednoduchém režimu s mapou v okně', await V.cekej(page, "document.body.classList.contains('ag-jr-on') && document.getElementById('map').parentNode.id === 'ag-jr-mapa-home'", 60))
        await page.evaluate("(a) => { addImportedPoints([{ name: '701', lat: a[0] + 20/111320, lng: a[1], vyska: 312.5 }]); }", [V.LAT, V.LNG])
        await page.wait_for_timeout(1500)
        await page.evaluate(ZAVRI)
        ok('A1 bez posunu je „Vycentrovat" schované', await page.evaluate("() => document.querySelector('#ag-jr-mapa-home [data-jr-ja]').hidden"))
        c0 = await page.evaluate("() => { const c = map.getCenter(); return [c.lat, c.lng, map.getZoom()]; }")
        await page.evaluate(TAH, {'dx': 120, 'dy': 90})
        c1 = await page.evaluate("() => { const c = map.getCenter(); return [c.lat, c.lng, map.getZoom()]; }")
        ok('A2 tah prstem posune mapu', abs(c1[0] - c0[0]) + abs(c1[1] - c0[1]) > 1e-5, [c0, c1])
        ok('A3 posun vypne sledování a ukáže „Vycentrovat"', await V.cekej(page, "window._mapHold === true && !document.querySelector('#ag-jr-mapa-home [data-jr-ja]').hidden", 3))
        await page.wait_for_timeout(2500)
        c2 = await page.evaluate("() => { const c = map.getCenter(); return [c.lat, c.lng]; }")
        ok('A4 mapa zůstane, kam ji prst dal (neuskočí zpět na polohu)', abs(c2[0] - c1[0]) + abs(c2[1] - c1[1]) < 1e-6, [c1, c2])
        await page.evaluate(TAH, {'dva': True})
        z2 = await page.evaluate("() => map.getZoom()")
        ok('A5 roztažení dvěma prsty přiblíží mapu', z2 > c1[2] + 0.3, [c1[2], z2])
        r = await page.evaluate("() => document.getElementById('ag-jr-mapa-home').getBoundingClientRect().toJSON()")
        await page.mouse.move(r['x'] + r['width'] / 2, r['y'] + r['height'] / 2)
        await page.mouse.wheel(0, 300)
        await page.wait_for_timeout(200)
        z3 = await page.evaluate("() => map.getZoom()")
        ok('A6 kolečko myši oddálí mapu', z3 < z2, [z2, z3])
        await page.click('#ag-jr-mapa-home [data-jr-ja]')
        ok('A7 „Vycentrovat" vrátí mapu na polohu a zapne sledování', await V.cekej(page, "(() => { const c = map.getCenter(); return window._mapHold === false && Math.abs(c.lat - %f) < 2e-4 && Math.abs(c.lng - %f) < 3e-4 && document.querySelector('#ag-jr-mapa-home [data-jr-ja]').hidden; })()" % (V.LAT, V.LNG), 4))

        # ---- B karta bodu
        await page.wait_for_timeout(800)
        pt = await page.evaluate("(a) => { const q = map.latLngToContainerPoint([a[0] + 20/111320, a[1]]); const r = document.getElementById('map').getBoundingClientRect(); return { x: r.left + q.x + 4, y: r.top + q.y - 3 }; }", [V.LAT, V.LNG])
        await page.mouse.click(pt['x'], pt['y'])
        ok('B1 klepnutí na bod = karta (jméno, S-JTSK, výška, vzdálenost)', await V.cekej(page, "(() => { const k = document.getElementById('ag-jr-karta'); return !k.hidden && /701/.test(k.textContent) && /S-JTSK/.test(k.textContent) && /312,5/.test(k.textContent) && /od tebe/.test(k.textContent); })()", 4), pt)
        mod = await page.evaluate("() => Array.from(document.querySelectorAll('.modal-overlay')).filter(m => m.style.display === 'flex' || m.classList.contains('open')).map(m => m.id)")
        ok('B2 neotevřel se žádný modál plné appky', not mod, mod)
        await page.click('#ag-jr-karta-x')
        ok('B3 křížek kartu zavře', await V.cekej(page, "document.getElementById('ag-jr-karta').hidden", 2))
        # tah, který skončí na bodu, kartu neotevře
        await page.evaluate(TAH, {'dx': 30, 'dy': 0})
        await page.mouse.click(pt['x'] + 30, pt['y'])
        ok('B4 klepnutí hned po tahu kartu neotevře', await page.evaluate("() => document.getElementById('ag-jr-karta').hidden"))
        await page.click('#ag-jr-mapa-home [data-jr-ja]')

        # ---- C kamera
        await page.click('#ag-jr-pohled')
        ok('C1 přepínač: kamera v okně, zobrazení „ar"', await V.cekej(page, "document.getElementById('camera-container').parentNode.id === 'ag-jr-mapa-home' && viewMode === 'ar' && AGJednoduchy.pohled() === 'kamera' && !document.getElementById('ag-jr-mapa-home').hidden", 5))
        ok('C2 kamera opravdu jede (video má stream)', await V.cekej(page, "!!document.getElementById('camera-feed').srcObject", 6))
        ok('C3 tlačítko teď nabízí „Mapa", „Vycentrovat" schované', await page.evaluate("() => /Mapa/.test(document.getElementById('ag-jr-pohled').textContent) && document.querySelector('#ag-jr-mapa-home [data-jr-ja]').hidden"))
        # klepnutí na AR značku (bez kompasu se nevykreslí — podstrčíme ji)
        mk = await page.evaluate("""() => { const p = arPoints.find(q => q.name === '701'); if (!p) return null;
            let el = p.element; if (!el) { el = document.createElement('div'); el.className = 'ar-marker'; el.textContent = '701'; p.element = el; }
            const ov = document.getElementById('ar-overlay'); if (el.parentNode !== ov) ov.appendChild(el);
            el.style.cssText += ';opacity:1;transform:translate(120px,120px);display:block;';
            const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }""")
        if mk:
            await page.mouse.click(mk['x'], mk['y'])
            ok('C4 klepnutí na AR značku = karta bodu', await V.cekej(page, "!document.getElementById('ag-jr-karta').hidden && /701/.test(document.getElementById('ag-jr-karta').textContent)", 3), mk)
            mod = await page.evaluate("() => Array.from(document.querySelectorAll('.modal-overlay')).filter(m => m.style.display === 'flex' || m.classList.contains('open')).map(m => m.id)")
            ok('C5 a nic z plné appky (detail bodu) se neotevřelo', not mod, mod)
        else:
            ok('C4 bod 701 je v arPoints', False)
        await page.click('#ag-jr-jit')
        ok('C6 odchod z domovské stránky kameru vypne', await V.cekej(page, "viewMode === 'map' && !document.getElementById('camera-feed').srcObject && document.getElementById('camera-container').parentNode.id !== 'ag-jr-mapa-home'", 5))
        await page.click('#ag-jr-list [data-jr-zpet="home"]')
        ok('C7 návrat domů: kamera zase běží (volba se pamatuje)', await V.cekej(page, "viewMode === 'ar' && document.getElementById('camera-container').parentNode.id === 'ag-jr-mapa-home'", 5))
        await page.click('#ag-jr-pohled')
        ok('C8 zpět na mapu: kamera vypnutá, mapa v okně', await V.cekej(page, "viewMode === 'map' && document.getElementById('map').parentNode.id === 'ag-jr-mapa-home' && document.getElementById('camera-container').parentNode.id === 'app-container' || (viewMode === 'map' && document.getElementById('map').parentNode.id === 'ag-jr-mapa-home' && !document.getElementById('ag-jr-mapa-home').contains(document.getElementById('camera-container')))", 5))

        # ---- D nástroje
        await page.evaluate(ZAVRI)
        await page.click('#ag-jr-nas-btn')
        ok('D1 napoprvé výběr nástrojů s předvybranou základní sadou', await V.cekej(page, "!document.getElementById('ag-jr-nas').hidden && document.querySelectorAll('#ag-jr-nas [data-jr-vyb][aria-pressed=true]').length >= 3", 4))
        n_vse = await page.evaluate("() => document.querySelectorAll('#ag-jr-nas [data-jr-vyb]').length")
        ok('D2 v nabídce jsou nástroje appky (> 15)', n_vse > 15, n_vse)
        # dobrat do stropu a zkusit jedenáctý
        await page.evaluate("() => { let b; while ((b = document.querySelector('#ag-jr-nas [data-jr-vyb][aria-pressed=false]:not(.jr-nas-plno)')) && document.querySelectorAll('#ag-jr-nas [data-jr-vyb][aria-pressed=true]').length < 10) b.click(); }")
        await page.evaluate("() => { const b = document.querySelector('#ag-jr-nas [data-jr-vyb][aria-pressed=false]'); if (b) b.click(); }")
        nvyb = await page.evaluate("() => document.querySelectorAll('#ag-jr-nas [data-jr-vyb][aria-pressed=true]').length")
        ok('D3 strop 10 nástrojů', nvyb == 10, nvyb)
        ma_mereni = await page.evaluate("() => !!document.querySelector('#ag-jr-nas [data-jr-vyb=\"openMeasureModal\"][aria-pressed=true]')")
        if not ma_mereni:
            await page.evaluate("() => { document.querySelector('#ag-jr-nas [data-jr-vyb][aria-pressed=true]').click(); document.querySelector('#ag-jr-nas [data-jr-vyb=\"openMeasureModal\"]').click(); }")
        await page.click('#ag-jr-nas-hotovo')
        ok('D4 po uložení jen vybrané nástroje (10) a „Upravit výběr"', await V.cekej(page, "document.querySelectorAll('#ag-jr-nas [data-jr-nas]').length === 10 && !!document.getElementById('ag-jr-nas-upravit') && JSON.parse(localStorage.getItem('agJrNastroje_v1')).length === 10", 3))
        await page.click('#ag-jr-nas-zavri')
        await page.click('#ag-jr-nas-btn')
        ok('D5 příště se otevře rovnou seznam vybraných', await V.cekej(page, "document.querySelectorAll('#ag-jr-nas [data-jr-nas]').length === 10 && !document.querySelector('#ag-jr-nas [data-jr-vyb]')", 3))
        await page.click('#ag-jr-nas [data-jr-nas="openMeasureModal"]')
        ok('D6 spuštění nástroje: přebal schovaný, nahoře „Jednoduchý režim", okno nástroje vidět', await V.cekej(page, "AGJednoduchy.pauza() && getComputedStyle(document.getElementById('ag-jr')).display === 'none' && !document.getElementById('ag-jr-pill').hidden && getComputedStyle(document.getElementById('measure-modal')).display !== 'none'", 5))
        ok('D7 mapa je po dobu nástroje zpátky v plné appce', await page.evaluate("() => document.getElementById('map').parentNode.id === 'map-wrapper'"))
        await page.evaluate("() => { if (typeof closeModal === 'function') closeModal('measure-modal'); else document.getElementById('measure-modal').style.display = 'none'; }")
        ok('D8 po zavření okna nástroje se přebal vrátí sám', await V.cekej(page, "!AGJednoduchy.pauza() && getComputedStyle(document.getElementById('ag-jr')).display !== 'none' && document.getElementById('ag-jr-pill').hidden && document.getElementById('map').parentNode.id === 'ag-jr-mapa-home'", 5))
        # ruční návrat tlačítkem
        await page.click('#ag-jr-nas-btn')
        await page.click('#ag-jr-nas [data-jr-nas="openMeasureModal"]')
        await V.cekej(page, "AGJednoduchy.pauza()", 3)
        await page.click('#ag-jr-pill')
        ok('D9 tlačítko „Jednoduchý režim" vrátí přebal ručně', await V.cekej(page, "!AGJednoduchy.pauza() && getComputedStyle(document.getElementById('ag-jr')).display !== 'none'", 3))
        await page.evaluate("() => { if (typeof closeModal === 'function') closeModal('measure-modal'); }")
        await page.evaluate(ZAVRI); await page.click('#ag-jr-konec')
        ok('E1 Celá appka: mapa i kamera na svých místech', await V.cekej(page, "!document.body.classList.contains('ag-jr-on') && document.getElementById('map').parentNode.id === 'map-wrapper' && !document.getElementById('ag-jr-mapa-home').contains(document.getElementById('camera-container'))", 5))
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
