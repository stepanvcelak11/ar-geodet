# -*- coding: utf-8 -*-
"""MERENI MIMO CR — registr zemi (16. 9. 2026, v339): js/sour-zeme.js + js/zeme-svet.js.

  A  PRAHA: nic se nezmenilo — karta bodu „S-JTSK Y/X", „Výška Bpv", CSV export Y;X,
     popisky formulare, AGSour hlasi CZ, data (geoid, obrysy, WMM) se dotahla
  B  BERLIN (geolokace): appka sama prepne na Nemecko — karta bodu „ETRS89 / UTM 33N E/N",
     vyska „DHHN2016 (NHN)", CSV export v UTM (E ~391 779, N ~5 820 072), popisky formulare,
     rucne zadany bod E/N se ulozi na spravne misto, undulace z EGM2008 (~39,5 m), deklinace
     WMM (~4–5° v Berline), Nastaveni → Data ma radek „Země měření"
  C  RUCNI VOLBA: prepnuti na Rakousko v Nastaveni → MGI GK M34 Y/X, GHA; zpet na auto
  D  ZDROJE PO ZEMICH (C3): AT → katastr BEV (DKM_GST) + ortofoto basemap.at, zpet CZ → CUZK;
     Berlin → ortofoto Esri (fallback), katastr zustava CUZK (DE nema narodni)

Spusteni: python scripts/test_zeme.py [port]
"""
import io
import os
import sys
import json
import asyncio
import subprocess
import time
import urllib.request
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from ag_boot import boot  # noqa: E402
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9140)
vysledky = []
PRAHA = (50.0755, 14.4378)
BERLIN = (52.5200, 13.4050)


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


def server(port):
    for pokus in range(6):
        p = port + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % p
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(p)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                break
            except Exception:
                time.sleep(0.4)
        # port muze drzet server JINE session nad jinym stromem → overit, ze bezi TENTO strom
        try:
            t = urllib.request.urlopen('http://127.0.0.1:%d/js/sour-zeme.js' % p, timeout=2).read().decode('utf-8', 'replace')
            if 'window.AGSour' in t and srv.poll() is None:
                return srv, u
        except Exception:
            pass
        srv.terminate()
    return None, None


async def stranka(br, url, init, chyby, lat, lng):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': lat, 'longitude': lng, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)

    async def route_vse(route, request):
        u = request.url
        try:
            if 'cuzk.cz/' in u or 'cuzk.gov.cz/' in u or 'openstreetmap' in u or 'workers.dev' in u:
                return await route.abort()
        except Exception:
            pass
        try:
            await route.continue_()
        except Exception:
            pass
    await page.route('**/*', route_vse)
    if init:
        await page.add_init_script(init)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    await page.wait_for_timeout(2500)
    return ctx, page


async def cekej(page, vyraz, kol=25):
    for _ in range(kol):
        if await page.evaluate('() => !!(' + vyraz + ')'):
            return True
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(400)
    return False


INIT = boot(tarif='pro') + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.removeItem('agZeme_v1');"
# Vlastni bod presne na stanovisku (v obou mestech)
def seed(lat, lng):
    return "localStorage.setItem('default_arCustomPoints12', %s);" % json.dumps(json.dumps([
        {'id': 'c1', 'name': 'Bod 1', 'lat': lat, 'lng': lng, 'type': 'custom', 'cat': 'CUSTOM', 'hidden': False, 'vyska': 123.45}]))


async def karta_bodu(page):
    await page.evaluate("() => { var p = arPoints.find(x => x.id === 'c1'); showDetails(p, 1); }")
    await page.wait_for_timeout(600)
    return await page.evaluate("() => Array.from(document.querySelectorAll('.geo-data-row')).map(r => r.textContent.replace(/\\s+/g, ' ').trim())")


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()

        # ================= A: PRAHA — chovani beze zmeny =====================================
        chyby = []
        ctx, page = await stranka(br, url, INIT + seed(*PRAHA), chyby, *PRAHA)
        ok('A0 appka nastartovala', await cekej(page, "document.body.classList.contains('app-started')"))
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        ok('A1 registr zemi: AGSour existuje, rezim auto, zeme CZ', await page.evaluate("() => window.AGSour && AGSour.rezim() === 'auto' && AGSour.kod() === 'CZ'"))
        ok('A2 data sveta se dotahla (geoid EGM2008, obrysy zemi, WMM)', await cekej(page, "window.AGGeoid && AGGeoid.nacteno() && AGSour.maHranice() && window.AGWmm && AGWmm.pripraveno()", 40),
           await page.evaluate("() => ({ geoid: window.AGGeoid && AGGeoid.stav(), hranice: window.AGSour && AGSour.maHranice(), wmm: !!(window.AGWmm && AGWmm.pripraveno()) })"))
        radky = await karta_bodu(page)
        ok('A3 karta bodu v CR: „S-JTSK Y", „S-JTSK X", „Výška Bpv" (texty beze zmeny)',
           any(r.startswith('S-JTSK Y') for r in radky) and any(r.startswith('S-JTSK X') for r in radky) and any(r.startswith('Výška Bpv') for r in radky), radky)
        yx = await page.evaluate("() => { var m = agMistni(%f, %f); var s = GeoCore.toSJTSK(%f, %f); return { m: m, s: s }; }" % (PRAHA + PRAHA))
        ok('A4 agMistni v CR = toSJTSK (kladne Y/X)', abs(yx['m']['y'] - yx['s']['y']) < 1e-6 and abs(yx['m']['x'] - yx['s']['x']) < 1e-6 and yx['m']['y'] > 0, yx)
        und = await page.evaluate("() => getGeoidUndulation(%f, %f)" % PRAHA)
        ok('A5 undulace v Praze z EGM2008 + posun Bpv: 44,9–45,1 m (drive vzorec 44,8)', 44.9 <= und <= 45.15, und)
        dek = await page.evaluate("() => getDeclination(%f, %f)" % PRAHA)
        ok('A6 deklinace v Praze z WMM2025: 4,5–6°', 4.5 <= dek <= 6.0, dek)
        lab = await page.evaluate("() => [document.getElementById('custom-y-lab').textContent, document.getElementById('custom-x-lab').textContent, document.getElementById('custom-z-lab').textContent]")
        ok('A7 popisky formulare bodu v CR beze zmeny', lab == ['S-JTSK Y (v metrech):', 'S-JTSK X (v metrech):', 'Výška Z / Bpv (v metrech) — volitelné:'], lab)
        # CSV export: obalime _exportVen
        csv = await page.evaluate("() => { var out = null; var o = window._exportVen; window._exportVen = function (n, t, c) { out = c; }; try { exportPointsCSV(); } finally { window._exportVen = o; } return out; }")
        ok('A8 CSV export v CR: Y;X kladne v rozsahu S-JTSK', csv and ';7' in csv and ';10' in csv and csv.split(';')[1].startswith('74'), csv)
        # Nastaveni → Data → Zeme mereni
        await page.evaluate("() => { openSettings(); switchTab('tab-data', document.querySelectorAll('.tab-btn')[2]); }")
        ok('A9 Nastaveni → Data ma radek „Země měření" s volbou Automaticky + zeme',
           await cekej(page, "document.getElementById('s-zeme') && document.getElementById('s-zeme').options.length > 30 && document.getElementById('s-zeme').value === 'auto'", 20),
           await page.evaluate("() => { var s = document.getElementById('s-zeme'); return s ? [s.options.length, s.value, (document.getElementById('s-zeme-info') || {}).textContent] : null; }"))
        info = await page.evaluate("() => (document.getElementById('s-zeme-info') || {}).textContent || ''")
        ok('A10 popis stavu: Česko · S-JTSK (Y, X) · výšky Bpv · deklinace', 'Česko' in info and 'S-JTSK (Y, X)' in info and 'Bpv' in info and 'deklinace' in info, info)

        # ---- C: rucni volba Rakousko (ve stejne strance) ----------------------------------
        await page.evaluate("() => { var s = document.getElementById('s-zeme'); s.value = 'AT'; s.dispatchEvent(new Event('change')); document.getElementById('settings-modal').style.display = 'none'; }")
        await page.wait_for_timeout(300)
        radky = await karta_bodu(page)
        ok('C1 po rucnim prepnuti na Rakousko karta bodu: „MGI / Austria GK M31 Y/X" (Praha je v pasmu M31), „Výška GHA"',
           any('MGI / Austria GK M31 Y' in r for r in radky) and any('GHA' in r for r in radky), radky)
        lab = await page.evaluate("() => [document.getElementById('custom-y-lab').textContent, document.getElementById('custom-z-lab').textContent]")
        ok('C2 popisky formulare prepnute', lab[0].startswith('MGI / Austria GK M31 Y') and 'GHA' in lab[1], lab)
        await page.evaluate("() => { var s = document.getElementById('s-zeme'); s.value = 'auto'; s.dispatchEvent(new Event('change')); }")
        await page.wait_for_timeout(300)
        ok('C3 zpet na auto = CZ', await page.evaluate("() => AGSour.kod() === 'CZ' && AGSour.rezim() === 'auto'"))
        # ---- D: zdroje po zemich (C3) --------------------------------------------------------
        ok('D0 modul zdroju nacteny a v CR nechal CUZK', await cekej(page, "window.AGZdroje && AGZdroje.aktualni() === 'CZ' && katastrLayer._url.indexOf('cuzk') > 0", 30))
        await page.evaluate("() => { var s = document.getElementById('s-zeme'); s.value = 'AT'; s.dispatchEvent(new Event('change')); }")
        await page.wait_for_timeout(500)
        dz = await page.evaluate("() => ({ akt: AGZdroje.aktualni(), kat: katastrLayer._url, lay: katastrLayer.wmsParams.layers, orto: baseLayers.ortofoto._url })")
        ok('D1 Rakousko: katastr BEV DKM_GST, ortofoto basemap.at', dz and dz['akt'] == 'AT' and 'bev.gv.at' in dz['kat'] and dz['lay'] == 'DKM_GST' and 'wien.gv.at' in dz['orto'], dz)
        await page.evaluate("() => { agMapSetBase('ortofoto'); }")
        await page.wait_for_timeout(300)
        ok('D2 podklad Ortofoto = rakouska vrstva v mape', await page.evaluate("() => map.hasLayer(baseLayers.ortofoto) && baseLayers.ortofoto._url.indexOf('wien.gv.at') > 0"))
        await page.evaluate("() => { var s = document.getElementById('s-zeme'); s.value = 'auto'; s.dispatchEvent(new Event('change')); }")
        await page.wait_for_timeout(500)
        dz2 = await page.evaluate("() => ({ akt: AGZdroje.aktualni(), kat: katastrLayer._url, lay: katastrLayer.wmsParams.layers, orto: baseLayers.ortofoto._url, vMape: map.hasLayer(baseLayers.ortofoto) })")
        ok('D3 zpet CZ: katastr i ortofoto CUZK, ortofoto zustalo zobrazene', dz2 and dz2['akt'] == 'CZ' and 'cuzk' in dz2['kat'] and dz2['lay'] == 'KN' and 'cuzk' in dz2['orto'] and dz2['vMape'], dz2)
        await page.evaluate("() => { agMapSetBase('osm'); }")
        chyby = [c for c in chyby if 'Failed to load resource' not in c]
        ok('A/C bez chyb stranky', not chyby, chyby[:5])
        await ctx.close()

        # ================= B: BERLIN — automaticke prepnuti ==================================
        chyby = []
        ctx, page = await stranka(br, url, INIT + seed(*BERLIN), chyby, *BERLIN)
        ok('B0 appka nastartovala v Berline', await cekej(page, "document.body.classList.contains('app-started')"))
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        ok('B1 registr sam prepnul na Nemecko', await cekej(page, "window.AGSour && AGSour.kod() === 'DE'", 20), await page.evaluate("() => window.AGSour && AGSour.kod()"))
        await cekej(page, "window.AGGeoid && AGGeoid.nacteno() && AGSour.maHranice()", 40)
        radky = await karta_bodu(page)
        ok('B2 karta bodu: „ETRS89 / UTM 33N E", „ETRS89 / UTM 33N N", „Výška DHHN2016 (NHN)"',
           any(r.startswith('ETRS89 / UTM 33N E') for r in radky) and any(r.startswith('ETRS89 / UTM 33N N') for r in radky) and any('DHHN2016' in r for r in radky), radky)
        m = await page.evaluate("() => agMistni(%f, %f)" % BERLIN)
        ok('B3 souradnice Berlina v UTM 33N: E 391 779 ±2 m, N 5 820 072 ±2 m', abs(m['y'] - 391779.26) < 2 and abs(m['x'] - 5820072.16) < 2, m)
        csv = await page.evaluate("() => { var out = null; var o = window._exportVen; window._exportVen = function (n, t, c) { out = c; }; try { exportPointsCSV(); } finally { window._exportVen = o; } return out; }")
        ok('B4 CSV export v UTM (E;N)', csv and ';39177' in csv and ';582007' in csv, csv)
        lab = await page.evaluate("() => [document.getElementById('custom-y-lab').textContent, document.getElementById('custom-x-lab').textContent, document.getElementById('custom-z-lab').textContent]")
        ok('B5 popisky formulare: E/N (v metrech), vyska DHHN2016', lab[0].startswith('ETRS89 / UTM 33N E') and lab[1].startswith('ETRS89 / UTM 33N N') and 'DHHN2016' in lab[2], lab)
        und = await page.evaluate("() => getGeoidUndulation(%f, %f)" % BERLIN)
        ok('B6 undulace v Berline z EGM2008 (39,5 m) + posun DHHN 0,01', 39.4 <= und <= 39.6, und)
        dek = await page.evaluate("() => getDeclination(%f, %f)" % BERLIN)
        ok('B7 deklinace v Berline z WMM2025: 4–5,5°', 4.0 <= dek <= 5.5, dek)
        # rucni zadani bodu v E/N: 100 m vychodne od stanoviska
        await page.evaluate("() => { openNewPointModal(); }")
        await page.wait_for_timeout(300)
        await page.evaluate("() => { document.getElementById('custom-name').value = 'Rucni'; document.getElementById('custom-y').value = '%s'; document.getElementById('custom-x').value = '%s'; document.getElementById('custom-z').value = ''; saveCustomPoint(); }" % ('391879.26', '5820072.16'))
        await page.wait_for_timeout(600)
        p2 = await page.evaluate("() => { var p = persistentCustomPoints.find(q => q.name === 'Rucni'); return p ? { lat: p.lat, lng: p.lng, d: GeoCore.getDistance(%f, %f, p.lat, p.lng), b: GeoCore.getBearing(%f, %f, p.lat, p.lng) } : null; }" % (BERLIN + BERLIN))
        ok('B8 rucne zadany bod E+100 m lezi 100 m vychodne (UTM, ne Krovak)', p2 and abs(p2['d'] - 100) < 1 and abs(p2['b'] - 90) < 2.5, p2)
        ok('D4 Berlin: ortofoto = Esri World Imagery (DE nema narodni), katastr zustava CUZK', await cekej(page, "window.AGZdroje && AGZdroje.aktualni() === 'DE' && baseLayers.ortofoto._url.indexOf('arcgisonline') > 0 && katastrLayer._url.indexOf('cuzk') > 0", 30), await page.evaluate("() => window.AGZdroje && [AGZdroje.aktualni(), baseLayers.ortofoto._url]"))
        chyby = [c for c in chyby if 'Failed to load resource' not in c]
        ok('B bez chyb stranky', not chyby, chyby[:5])
        await ctx.close()
        await br.close()


def main():
    srv, url = server(PORT)
    if not srv:
        print('CHYBA: server se nepodarilo spustit'); return 2
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
