# -*- coding: utf-8 -*-
u"""STOJÍŠ U ÚŘEDNÍHO BODU? OPRAV PODLE NĚJ GPS (6. 10. 2026, hodnocení — návrh 5).

Kontroluje: po zastavení (8 s) do pár metrů od TB se ukáže nabídka s názvem bodu a vzdáleností;
„Opravit GPS“ otevře potvrzení opravy podle bodu (js/ref-calibration.js); průchod kolem (bez
prodlevy), chůze, běžící korekce, nivelační bod a otevřené okno nic neukážou; na týž bod se do
12 h znovu neptá; „Neptat se“ vypne nabídku a přepínač v Nastavení → Mapa a body ji vrátí.

python scripts/test_kotva_nabidka.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9096)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


PRIPRAV = """(o) => {
  document.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; m.classList.remove('ag-open'); });
  document.querySelectorAll('.ag-dlg-overlay').forEach(m => m.remove());
  const bs = document.getElementById('bottom-sheet'); if (bs) bs.classList.remove('open');
  window.agFixState = () => ({ state: 'fresh' }); currentGpsAccuracy = 4; gpsSpeed = o.rych || 0; window.agRefShift = o.korekce ? { on: true, t: Date.now(), dlat: 0, dlng: 0 } : null;
  for (let i = arPoints.length - 1; i >= 0; i--) if (String(arPoints[i].id).indexOf('kn-') === 0) arPoints.splice(i, 1);
  arPoints.push({ id: 'kn-' + o.cat, name: o.cat + ' 12-4', cat: o.cat, lat: userLat + o.d / 111320, lng: userLng });
  AGKotvaNabidka._test.reset(); }"""
TIK = "(dt) => { const t0 = 1e12; AGKotvaNabidka._test.tik(t0); const r = AGKotvaNabidka._test.tik(t0 + dt); const el = document.getElementById('ag-kn-pruh'); return { r: !!r, txt: el ? el.textContent : null }; }"


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started') && !!userLat", 60))
        await page.evaluate("() => new Promise(r => AGLazy.need('js/kotva-nabidka.js', r))")
        ok('A1 modul načtený', await V.cekej(page, "!!window.AGKotvaNabidka", 60))

        await page.evaluate(PRIPRAV, {'cat': 'TB', 'd': 2.4})
        r = await page.evaluate(TIK, 3000)
        ok('N1 jen průchod kolem (bez 8 s prodlevy) nic nenabídne', not r['r'] and r['txt'] is None, r)
        await page.evaluate(PRIPRAV, {'cat': 'TB', 'd': 2.4})
        r = await page.evaluate(TIK, 9000)
        ok('K1 zastavení u TB: nabídka s názvem bodu a vzdáleností', r['r'] and 'TB 12-4' in r['txt'] and '2,4 m' in r['txt'] and 'Opravit GPS' in r['txt'], r)
        await page.evaluate("() => document.querySelector('#ag-kn-pruh button[data-a=ano]').click()")
        ok('K2 „Opravit GPS“ otevře potvrzení opravy podle bodu', await V.cekej(page, "[...document.querySelectorAll('.ag-dlg-overlay, .modal-overlay')].some(m => getComputedStyle(m).display !== 'none' && /Opravit GPS podle bodu TB 12-4/.test(m.textContent))", 30))
        await page.evaluate(PRIPRAV, {'cat': 'TB', 'd': 2.4})
        r = await page.evaluate(TIK, 9000)
        ok('K3 na týž bod se do 12 h znovu neptá', not r['r'], r)

        await page.evaluate("() => localStorage.removeItem('agKotvaNabidka_v1')")
        for jm, o, popis in [('N2', {'cat': 'TB', 'd': 2.4, 'rych': 1.3}, 'chůze'), ('N3', {'cat': 'TB', 'd': 2.4, 'korekce': True}, 'běžící korekce'),
                             ('N4', {'cat': 'NIVEL', 'd': 2.4}, 'nivelační bod'), ('N5', {'cat': 'TB', 'd': 25}, 'bod 25 m daleko')]:
            await page.evaluate(PRIPRAV, o)
            r = await page.evaluate(TIK, 9000)
            ok('%s %s → nic' % (jm, popis), not r['r'] and r['txt'] is None, r)
        await page.evaluate(PRIPRAV, {'cat': 'ZHB', 'd': 2.4})
        await page.evaluate("() => { const m = document.createElement('div'); m.className = 'modal-overlay ag-open'; m.id = 'kn-test-okno'; m.style.cssText = 'display:flex;position:fixed;inset:0;'; document.body.appendChild(m); }")
        await page.wait_for_timeout(600)   # okno najíždí (opacity) — počkat, až opravdu leží přes obraz
        r = await page.evaluate(TIK, 9000)
        ok('N6 otevřené okno → nic (nepřerušuje práci)', not r['r'], r)
        await page.evaluate("() => document.getElementById('kn-test-okno').remove()")

        await page.evaluate(PRIPRAV, {'cat': 'PBPP', 'd': 3})
        r = await page.evaluate(TIK, 9000)
        await page.evaluate("() => document.querySelector('#ag-kn-pruh button[data-a=nikdy]').click()")
        ok('V1 „Neptat se“ nabídku vypne', r['r'] and await page.evaluate("() => !AGKotvaNabidka.zapnuto()"), r)
        await page.evaluate("() => { openSettings(); if (typeof switchTab === 'function') switchTab('tab-ar'); AGKotvaNabidka._test.ui(); }")
        sw = await page.evaluate("() => { const i = document.getElementById('s-kotva-nabidka'); return i ? { checked: i.checked } : null; }")
        ok('V2 Nastavení → Mapa a body má přepínač (teď vypnutý)', sw and sw['checked'] is False, sw)
        await page.evaluate("() => document.getElementById('s-kotva-nabidka').click()")
        ok('V3 přepínač nabídku zase zapne', await page.evaluate("() => AGKotvaNabidka.zapnuto()"))
        ok('Z bez chyb v konzoli', not chyby, chyby[:5])
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
