# -*- coding: utf-8 -*-
u"""JEDNODUCHÝ REŽIM — MAPA PRO DOHLEDÁVÁNÍ A VLASTNÍ BODOVÉ POLE (14. 11. 2026, 2. kolo).

Přání uživatele: „pointa appky je dohledávání bodů … geodet si vytváří vlastní bodové pole,
aby je nemusel náročně hledat" + „v jednoduchém režimu ortofoto a katastr, zpřesnění po hraně
a kvalita GPS".

  L  Vrstvy v okně mapy: Mapa / Ortofoto, Katastr, Kde se dá měřit, chůze po hraně, balíček
  G  kruh přesnosti GPS kolem polohy (barva podle ±), korekce GPS ve stavovém řádku
  M  podržení prstu v mapě = vzdálenost a azimut ode mě, karta se neotevře
  N  nový bod s místopisem (stabilizace, popis, fotka se směrem) → js/vlastni-pole.js
  K  karta bodu: místopis, fotka, stav Nalezen / Nenalezen / Zničen, puntík v mapě,
     úprava místopisu; úřední bod ukáže místopisný náčrt ČÚZK
  H  hledací režim do 10 m: kruh nejistoty, místopis, fotka přes kameru, stav
  V  vytyčení: fotka kolíku k záznamu vytyčení, vytyčený dnes = sytě zelený puntík
  Z  bez chyb stránky

python scripts/test_jednoduchy_pole.py [port]
"""
import os
import sys
import base64
import asyncio
import tempfile

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9141)
VYSLEDKY = []
# 1×1 JPEG
JPEG = base64.b64decode('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=')


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


ZAVRI = "() => { document.querySelectorAll('.ag-dlg-overlay.open .ag-dlg-btn:not(.ag-ok)').forEach(b => b.click()); }"
DRZ = """(a) => new Promise(res => {
  const slot = document.getElementById('ag-jr-mapa-home'), r = slot.getBoundingClientRect();
  const x = r.left + r.width * 0.3, y = r.top + r.height * 0.3;
  const t = new Touch({ identifier: 1, target: slot, clientX: x, clientY: y });
  slot.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
  setTimeout(() => { slot.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] })); res(true); }, 750);
})"""


async def beh(url, foto):
    async with async_playwright() as p:
        br = await p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True, service_workers='block',
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation', 'camera'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))

        async def route(r, q):
            if '/cuzk/nacrt?' in q.url:
                return await r.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                                       body='{"ok":true,"page":"https://dataz.cuzk.gov.cz/gu.php?1=1","img":[{"url":"https://dataz.cuzk.gov.cz/mistopis.php?id=1","role":"nacrt"}]}')
            return await V.route_vse(r, q)
        await page.route('**/*', route)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.setItem('agJednoduchy_v1','1'); localStorage.setItem('agDomov_v1', JSON.stringify({auto:false}));")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start v jednoduchém režimu', await V.cekej(page, "document.body.classList.contains('ag-jr-on') && document.getElementById('map').parentNode.id === 'ag-jr-mapa-home'", 60))
        await page.evaluate("() => new Promise(r => window.AGLazy ? AGLazy.need('js/vlastni-pole.js', r) : r())")
        ok('A1 modul vlastního bodového pole načtený', await V.cekej(page, "!!window.AGPole", 10))
        await page.evaluate("(a) => { addImportedPoints([{ name: '801', lat: a[0] + 20/111320, lng: a[1] }]); }", [V.LAT, V.LNG])
        await page.wait_for_timeout(1200)
        await page.evaluate(ZAVRI)

        # ---- L vrstvy
        await page.click('#ag-jr-vrstvy-btn')
        ok('L1 tlačítko Vrstvy otevře panel (Mapa/Ortofoto, Katastr, Kde se dá měřit, hrana, balíček)', await V.cekej(page, "(() => { const v = document.getElementById('ag-jr-vrstvy'); return !v.hidden && ['mapa','ortofoto','katastr','kvalita','hrana','balicek'].every(k => v.querySelector('[data-vr=' + k + ']')); })()", 3))
        await page.click('#ag-jr-vrstvy [data-vr="ortofoto"]')
        ok('L2 Ortofoto přepne podklad', await V.cekej(page, "visSettings.baseLayer === 'ortofoto'", 3))
        await page.click('#ag-jr-vrstvy [data-vr="katastr"]')
        ok('L3 Katastr se zapne (Pro)', await V.cekej(page, "visSettings.showKatastr === true", 3))
        await page.click('#ag-jr-vrstvy [data-vr="mapa"]')
        ok('L4 Mapa vrátí vlastní mapu', await V.cekej(page, "visSettings.baseLayer !== 'ortofoto'", 3))
        await page.wait_for_timeout(600); await page.evaluate(ZAVRI)
        await page.click('#ag-jr-vrstvy [data-vr="katastr"]')
        await page.evaluate(ZAVRI)
        await page.click('#ag-jr-vrstvy-btn')
        ok('L5 druhé klepnutí panel zavře, mapa zůstala v okně', await V.cekej(page, "document.getElementById('ag-jr-vrstvy').hidden && document.getElementById('map').parentNode.id === 'ag-jr-mapa-home'", 3))

        # ---- G kvalita GPS a korekce
        ok('G1 kruh přesnosti GPS kolem polohy (±4 m = oranžová)', await V.cekej(page, "(() => { const k = document.querySelector('#map path.jr-gps-kruh'); return !!k && /#f59e0b/i.test(k.getAttribute('stroke') || ''); })()", 4))
        await page.evaluate("() => { window.agRefShift = { on: true, t: Date.now(), dlat: 0.000006, dlng: 0, src: 'hrana-auto' }; }")
        ok('G2 korekce podle hrany je vidět ve stavovém řádku', await V.cekej(page, "/korekce podle hrany/.test(document.getElementById('ag-jr-stav').textContent)", 3))
        await page.evaluate("() => { window.agRefShift = null; }")

        # ---- M měření podržením
        await page.evaluate(DRZ, {})
        ok('M1 podržení prstu ukáže vzdálenost a azimut ode mě', await V.cekej(page, "!document.getElementById('ag-jr-mereni').hidden && /od tebe/.test(document.getElementById('ag-jr-mereni').textContent)", 3))
        ok('M2 karta se přitom neotevřela', await page.evaluate("() => document.getElementById('ag-jr-karta').hidden"))

        # ---- N nový bod s místopisem
        await page.click('#ag-jr-pridat')
        await page.click('#ag-jr-pole summary')
        await page.click('#ag-jr-pole [data-stab="kolik"]')
        await page.fill('#ag-jr-pole .jr-popis', 'roh plotu, 1,2 m od sloupku')
        async with page.expect_file_chooser() as fc:
            await page.click('#ag-jr-pole [data-foto]')
        await (await fc.value).set_files(foto)
        ok('N1 fotka místa se ukáže v náhledu', await V.cekej(page, "(() => { const i = document.querySelector('#ag-jr-pole img'); return i && !i.hidden && i.src.startsWith('data:image'); })()", 5))
        await page.fill('#ag-jr-nazev', '901')
        await page.click('#ag-jr-zgps')
        await page.wait_for_timeout(1200)
        await page.click('#ag-jr-zgps')
        await V.cekej(page, "!document.getElementById('ag-jr-ulozit').disabled", 4)
        await page.click('#ag-jr-ulozit')
        ok('N2 bod uložen i s místopisem (kolík, popis, fotka)', await V.cekej(page, "(() => { const b = persistentCustomPoints.find(p => p.name === '901'); const i = b && AGPole.info(b.id); return !!(i && i.stab === 'kolik' && /sloupku/.test(i.popis) && i.foto); })()", 5))

        # ---- K karta bodu
        await page.evaluate("() => AGJednoduchy.otevriKartu(persistentCustomPoints.find(p => p.name === '901').id)")
        ok('K1 karta ukáže místopis, fotku a „V terénu zatím neověřen"', await V.cekej(page, "(() => { const k = document.getElementById('ag-jr-karta'); return !k.hidden && /kolík/.test(k.textContent) && /sloupku/.test(k.textContent) && !!k.querySelector('#ag-jr-karta-img') && /neověřen/.test(k.textContent); })()", 4))
        await page.click('#ag-jr-karta .jr-karta-stav [data-st="ok"]')
        ok('K2 „Nalezen" zapíše stav a karta ukáže „ověřen dnes"', await V.cekej(page, "(() => { const id = persistentCustomPoints.find(p => p.name === '901').id; const s = AGPole.stav(id); return s && s.s === 'ok' && /ověřen/.test(document.getElementById('ag-jr-karta').textContent); })()", 3))
        ok('K3 v mapě má bod modrý puntík ověření', await V.cekej(page, "[...document.querySelectorAll('.custom-map-marker')].some(m => /#3b82f6/i.test(m.innerHTML))", 4))
        await page.click('#ag-jr-karta-mist')
        await V.cekej(page, "!!document.querySelector('#ag-jr-karta .jr-popis')", 3)
        await page.fill('#ag-jr-karta .jr-popis', 'u vrby, 3 m od cesty')
        await page.click('#ag-jr-karta [data-uloz]')
        ok('K4 úprava místopisu z karty se uloží', await V.cekej(page, "/vrby/.test(AGPole.info(persistentCustomPoints.find(p => p.name === '901').id).popis) && /vrby/.test(document.getElementById('ag-jr-karta').textContent)", 3))
        await page.click('#ag-jr-karta-x')
        # úřední bod s odkazem na geodetické údaje
        await page.evaluate("(a) => { arPoints.push({ id: 'tb-test-1', name: 'TB 7', cat: 'TB', lat: a[0] - 15/111320, lng: a[1], rawData: { GEODETICKE_UDAJE: 'https://geoportal.cuzk.cz/mistopis2/mistopis_soap_hh.asp?NAME=BP_TB&TYP=TB&HID=f' } }); AGJednoduchy.otevriKartu('tb-test-1'); }", [V.LAT, V.LNG])
        ok('K5 úřední bod: v kartě místopisný náčrt ČÚZK a odkaz na geodetické údaje', await V.cekej(page, "(() => { const n = document.getElementById('ag-jr-karta-nacrt'); return !!n && !!n.querySelector('img[src*=\"mistopis.php\"]') && /geodetické údaje/.test(n.textContent); })()", 6))
        await page.click('#ag-jr-karta-x')

        # ---- H hledací režim
        await ctx.set_geolocation({'latitude': V.LAT + 15 / 111320, 'longitude': V.LNG, 'accuracy': 4})
        b901 = await page.evaluate("() => persistentCustomPoints.find(p => p.name === '901').id")
        await page.evaluate("() => AGJednoduchy.naviguj(persistentCustomPoints.find(p => p.name === '801').id)")
        await page.evaluate(ZAVRI)
        ok('H1 do 10 m od bodu: hledací panel (kruh ±, stav bodu)', await V.cekej(page, "(() => { const h = document.getElementById('ag-jr-hledej'); return !h.hidden && /±/.test(h.textContent) && !!h.querySelector('[data-st=\"znicen\"]'); })()", 8))
        await page.click('#ag-jr-hledej [data-st="znicen"]')
        ok('H2 „Zničen" z hledacího panelu zapíše stav', await V.cekej(page, "(() => { const s = AGPole.stav(persistentCustomPoints.find(p => p.name === '801').id); return s && s.s === 'znicen'; })()", 3))
        await page.click('#ag-jr-go [data-jr-zpet="list"]')
        await page.click('#ag-jr-list [data-jr-zpet="home"]')
        await ctx.set_geolocation({'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4})
        await page.evaluate("(id) => AGJednoduchy.naviguj(id)", b901)
        ok('H3 bod s fotkou: v hledacím panelu fotka a „Fotka přes kameru"', await V.cekej(page, "!!document.querySelector('#ag-jr-hledej #ag-jr-hl-kam') && !!document.querySelector('#ag-jr-hledej #ag-jr-hl-img')", 8))
        await page.click('#ag-jr-hl-kam')
        ok('H4 fotka přes živý obraz kamery (s posuvníkem průhlednosti)', await V.cekej(page, "(() => { const o = document.getElementById('ag-pole-kam'); return !!o && !!o.querySelector('input[type=range]') && o.querySelector('img').src.startsWith('data:image'); })()", 5))
        await page.click('#ag-pole-kam button')
        ok('H5 zavřít fotku přes kameru', await V.cekej(page, "!document.getElementById('ag-pole-kam')", 3))
        await page.click('#ag-jr-go [data-jr-zpet="list"]')
        await page.click('#ag-jr-list [data-jr-zpet="home"]')

        # ---- V vytyčení s fotkou kolíku
        await page.evaluate("() => new Promise(r => AGLazy.need('js/vytycovani.js', r))")
        await page.evaluate("() => AGJednoduchy.nastroje()")
        await page.evaluate("() => { const x = document.querySelector('#ag-jr-nas-hotovo'); if (x) { [...document.querySelectorAll('#ag-jr-nas [data-jr-vyb][aria-pressed=true]')].forEach(b => b.click()); document.querySelector('#ag-jr-nas [data-jr-vyb=\"openStakeoutModal\"]').click(); x.click(); } }")
        await page.click('#ag-jr-nas [data-jr-nas="openStakeoutModal"]')
        await V.cekej(page, "AGJednoduchy.stranka() === 'vyt'", 4)
        await page.click('#ag-jr-vyt-seznam [data-jr-vyt]')
        await V.cekej(page, "!document.getElementById('ag-jr-vyt-btn').hidden", 3)
        vid = await page.evaluate("() => AGJednoduchy.stranka() === 'go' && document.getElementById('ag-jr-cilnazev').textContent")
        await page.click('#ag-jr-vyt-btn')
        async with page.expect_file_chooser() as fc2:
            await page.click('#ag-jr-vyt-foto')
        await (await fc2.value).set_files(foto)
        ok('V1 fotka kolíku se zapíše k záznamu vytyčení', await V.cekej(page, "Object.keys(stakeoutData).some(k => stakeoutData[k] && stakeoutData[k].foto)", 5), vid)
        ok('V2 vytyčený dnes má v mapě sytě zelený puntík', await V.cekej(page, "[...document.querySelectorAll('.custom-map-marker')].some(m => /#10b981/i.test(m.innerHTML))", 4))
        ok('V3 na stránce vytyčení je Protokol vytyčení', await page.evaluate("() => !!document.getElementById('ag-jr-vyt-protokol')"))
        ok('T1 trasa terénem umí hranice parcel (AGTrasa.hranic)', await page.evaluate("() => !window.AGTrasa || typeof AGTrasa.hranic === 'function'"))
        ok('Z bez chyb stránky', not chyby, chyby[:5])
        await ctx.close()
        await br.close()


def main():
    tmp = tempfile.mkdtemp()
    foto = os.path.join(tmp, 'misto.jpg')
    with open(foto, 'wb') as f:
        f.write(JPEG)
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    try:
        asyncio.run(beh(url, foto))
    finally:
        srv.terminate()
    n = len(VYSLEDKY); d = sum(VYSLEDKY)
    print('\n%d/%d OK' % (d, n))
    sys.exit(0 if d == n else 1)


if __name__ == '__main__':
    main()
