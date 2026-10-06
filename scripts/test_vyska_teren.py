# -*- coding: utf-8 -*-
u"""VÝŠKA BODU Z TERÉNNÍHO MODELU JAKO VÝCHOZÍ (6. 10. 2026, hodnocení — návrh 6).

Kontroluje: bod z průměrované GPS dostane do pole Z výšku z DMR 5G sám (a hlášku, že je
z terénu), „Vrátit výšku z GPS“ vrátí GPS; uložený bod má prov.z = 'dmr' a karta bodu u výšky
píše „(terén)“; při velkém rozdílu GPS − terén (násep, zásyp) se nic samo nemění a nabídne se
volba jako dřív; přepínač v Nastavení → AR & přesnost automatiku vypne.

python scripts/test_vyska_teren.py [port]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9098)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


# Nový bod z průměrované GPS; terén podvržený (DMR o `rozdil` m níž než GPS v Bpv)
VYPLN = """async (rozdil) => {
  document.querySelectorAll('.ag-dlg-overlay').forEach(o => o.remove());
  openNewPointModal(); await new Promise(r => setTimeout(r, 300));
  const N = getGeoidUndulation(userLat, userLng);
  gpsAvgResult = { lat: userLat, lng: userLng, alt: 300 + N, altSterr: 2.1, altN: 30, acc: 1.2, sterr: 0.8, sigma: 2.5, n: 30, total: 30, coarse: false, manual: false, ts: Date.now() };
  window.terrainElevAsync = () => Promise.resolve(300 - rozdil);
  window.terrainElevInfo = () => ({ kod: 'CZ', zdroj: 'DMR 5G', sigma: 0.3, system: 'Bpv', presne: true });
  fillAveragedGPS();
  // terén se dotahuje asynchronně — počkat, až box ukáže výsledek (pod zátěží CI to trvá)
  for (let i = 0; i < 100 && !document.querySelector('#agvz-back, #agvz-use'); i++) await new Promise(r => setTimeout(r, 100));
  const box = document.getElementById('ag-vz');
  return { z: document.getElementById('custom-z').value, src: window._agZSrc, t: box ? box.innerText.replace(/\\s+/g, ' ') : '',
           back: !!document.getElementById('agvz-back'), use: !!document.getElementById('agvz-use') }; }"""


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
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started') && !!userLat && !!window.AGVyska", 60))

        r = await page.evaluate(VYPLN, 1.2)
        ok('T1 bod z GPS: výška z DMR 5G doplněná sama (298,80)', r['z'] == '298.80' and r['src'] == 'dmr', r)
        ok('T2 hláška „Výška vzata z terénu“ + tlačítko Vrátit výšku z GPS', 'Výška vzata z terénu' in r['t'] and r['back'] and not r['use'], r)
        await page.evaluate("() => document.getElementById('agvz-back').click()")
        zp = await page.evaluate("() => ({ z: document.getElementById('custom-z').value, src: window._agZSrc })")
        ok('T3 „Vrátit výšku z GPS“ vrátí 300,00 a zdroj gps', zp['z'] == '300.00' and zp['src'] == 'gps', zp)

        r = await page.evaluate(VYPLN, 1.2)
        await page.evaluate("() => { document.getElementById('custom-name').value = 'VYS-1'; saveCustomPoint(); }")
        await page.wait_for_timeout(800)
        b = await page.evaluate("() => { const p = persistentCustomPoints.find(x => x.name === 'VYS-1'); return p ? { v: p.vyska, z: p.prov && p.prov.z } : null; }")
        ok('U1 uložený bod: výška z terénu a prov.z = dmr', b and abs(b['v'] - 298.8) < 0.005 and b['z'] == 'dmr', b)
        await page.evaluate("() => { const p = arPoints.find(x => x.name === 'VYS-1'); showDetails(p, 5); }")
        await page.wait_for_timeout(600)
        u2 = await page.evaluate("() => document.getElementById('bottom-sheet').innerText.replace(/\\s+/g, ' ')")
        ok('U2 karta bodu u výšky říká, že je z terénu', '298,80 m z terénu' in u2.lower(), u2[-900:])
        await page.evaluate("() => { if (typeof closeBottomSheet === 'function') closeBottomSheet(); }")

        r = await page.evaluate(VYPLN, 6)
        ok('B1 velký rozdíl (6 m, násep/zásyp): nic se samo nemění, nabídne volbu', r['z'] == '300.00' and r['use'] and not r['back'], r)

        await page.evaluate("() => { openSettings(); if (typeof switchTab === 'function') switchTab('tab-ar'); AGVyska.ui(); }")
        ok('S1 Nastavení → AR & přesnost má přepínač „Výška bodu z terénního modelu“ (zapnutý)', await page.evaluate("() => { const i = document.getElementById('s-vyska-teren'); return !!i && i.checked; }"))
        await page.evaluate("() => { document.getElementById('s-vyska-teren').click(); document.getElementById('settings-modal').style.display = 'none'; }")
        r = await page.evaluate(VYPLN, 1.2)
        ok('S2 vypnuto: výška zůstane z GPS, terén se jen nabídne', r['z'] == '300.00' and r['use'] and not r['back'], r)
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
