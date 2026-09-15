# -*- coding: utf-8 -*-
"""OPRAVA VYSKY NA ZNAMEM BODE + tlacitko „Opravit GPS" v karte bodu (15. 9. 2026 vecer, v338).

  A  karta nivelacniho bodu: ctverecek „Opravit GPS" (js/karta-bodu-plus.js) → dialog
     s upozornenim „musis stat na bode" + vyska bodu → agRefShift ma dlat/dlng I dh
  B  novy bod z GPS prumeru dostane posun polohy i vysky (obaleny saveCustomPoint);
     vyska z DMR (window._agZSrc = 'dmr') se NEposouva
  C  dialog nastroje: nivelacni body v nabidce (s „· H"), vyber predvyplni vysku,
     pole „Telefon nad znackou" se odecita; pilulka hlasi i vysku
  D  TB bez vysky (VYSKA 0.00) → jen poloha, dialog to rekne

Spusteni: python scripts/test_v338.py [port]
"""
import io
import os
import sys
import json
import asyncio
import subprocess
import time
import math
import urllib.request
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from ag_boot import boot  # noqa: E402
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8995)
vysledky = []
LAT, LNG = 50.0755, 14.4378
MLAT = 111320.0
MLNG = 111320.0 * math.cos(math.radians(LAT))
H_NIV = 250.000          # vyska nivelacniho bodu (Bpv)
ALT_GPS = 293.0          # elipsoidicka vyska z GPS (N v Praze ~44,7 → Bpv ~248,3)


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


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
            t = urllib.request.urlopen('http://127.0.0.1:%d/js/ref-calibration.js' % p, timeout=2).read().decode('utf-8', 'replace')
            if 'agRefCalibrateFromPoint' in t and srv.poll() is None:
                return srv, u
        except Exception:
            pass
        srv.terminate()
    return None, None


# nivelacni bod 1 m severne (uzivatel „na nem stoji", GPS lze o metr), TB 30 m vychodne bez vysky
SEED = "localStorage.setItem('default_arOfflinePoints12', %s);" % json.dumps(json.dumps([
    {'id': 'p_niv', 'name': 'Kk1-12', 'lat': LAT + 1.0 / MLAT, 'lng': LNG, 'cat': 'NIVEL', 'type': 'vyskovy', 'hidden': False, 'vyska': H_NIV,
     'rawData': {'PORAD': 'Kk1', 'CISLO': '12', 'VYSKA': '   250.000', 'NAZEV_KU': 'Test'}},
    {'id': 'p_tb', 'name': '28', 'lat': LAT, 'lng': LNG + 30.0 / MLNG, 'cat': 'TB', 'type': 'polohovy', 'hidden': False, 'vyska': 0,
     'rawData': {'ZTLTL': '1425', 'CISLO': 28, 'PL': 0, 'VYSKA': '     0.00', 'NAZEV_KU': 'Test'}}]))

# prumerovana GPS s vyskou — Playwright geolocation vysku neumi, tak se podstrci primo
GPS_JS = "gpsAvgResult = { lat: %f, lng: %f, n: 12, total: 12, sigma: 0.4, sterr: 0.25, acc: 2.5, coarse: false, alt: %f, altSterr: 0.7, altN: 12, ts: Date.now() };" % (LAT, LNG, ALT_GPS)


async def stranka(br, url, init, chyby):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
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
    await page.wait_for_timeout(3000)
    return ctx, page


async def cekej(page, vyraz, kol=25):
    for _ in range(kol):
        if await page.evaluate('() => !!(' + vyraz + ')'):
            return True
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(400)
    return False


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        ctx, page = await stranka(br, url, boot(tarif='pro') + SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.removeItem('agRefShift');", chyby)
        ok('0 appka nastartovala', await cekej(page, "document.body.classList.contains('app-started')"))
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        await page.wait_for_timeout(1000)

        # ---- A: karta nivelacniho bodu → Opravit GPS ------------------------------------
        await page.evaluate("() => { %s var p = arPoints.find(x => x.id === 'p_niv'); showDetails(p, 1); }" % GPS_JS)
        ok('A1 v karte bodu je ctverecek „Opravit GPS"', await cekej(page, "document.querySelector('#ag-kb-acts button[data-a=\"ref\"]')", 20))
        await page.click('#ag-kb-acts button[data-a="ref"]')
        ok('A2 klepnuti otevre potvrzeni s upozornenim, ze musim stat na bode, a s vyskou bodu',
           await cekej(page, "document.querySelector('.ag-dlg-title') && /Opravit GPS podle bodu Kk1-12/.test(document.querySelector('.ag-dlg-title').textContent)", 20),
           await page.evaluate("() => (document.querySelector('.ag-dlg-title') || {}).textContent"))
        msg = await page.evaluate("() => (document.querySelector('.ag-dlg-msg') || {}).textContent || ''")
        ok('A3 text: „Musíš stát přímo na bodě", výška 250,00 m, polož telefon na značku, nivelační = poloha na metr',
           'Musíš stát přímo na bodě' in msg and '250,00 m' in msg and 'Polož telefon na značku' in msg and 'Nivelační bod' in msg, msg[:400])
        oc = await page.evaluate("() => getGeoidUndulation(%f, %f)" % (LAT, LNG))
        dh_oc = H_NIV - (ALT_GPS - oc)
        await page.click('.ag-dlg-ok')
        ok('A4 po potvrzeni agRefShift: posun polohy +1 m na sever a posun vysky dh = H − (alt − N)',
           await cekej(page, "window.agRefShift && window.agRefShift.on && window.agRefShift.dh != null", 20),
           await page.evaluate("() => window.agRefShift"))
        sh = await page.evaluate("() => { var s = window.agRefShift; return s ? { dN: s.dlat * %f, dE: s.dlng * %f, dh: s.dh, refH: s.refH, src: s.src, ref: s.ref } : null; }" % (MLAT, MLNG))
        ok('A5 hodnoty posunu', sh and 0.9 < sh['dN'] < 1.1 and abs(sh['dE']) < 0.05 and abs(sh['dh'] - dh_oc) < 0.005 and sh['refH'] == H_NIV and sh['src'] == 'ref' and sh['ref'] == 'Kk1-12', {'sh': sh, 'ocekavano_dh': dh_oc, 'N': oc})
        ok('A6 hlaska „Kalibrace zapnuta" rika i vysku', await cekej(page, "document.querySelector('.ag-dlg-title') && /Kalibrace zapnuta/.test(document.querySelector('.ag-dlg-title').textContent) && /Výška/.test(document.querySelector('.ag-dlg-msg').textContent)", 15),
           await page.evaluate("() => (document.querySelector('.ag-dlg-msg') || {}).textContent"))
        await page.click('.ag-dlg-ok')
        await page.wait_for_timeout(300)
        await page.evaluate("() => { window.agRefShiftWatch(); }")
        pill = await page.evaluate("() => { var p = document.getElementById('agref-pill'); return p ? p.textContent : ''; }")
        ok('A7 pilulka korekce hlasi i vysku', 'Korekce GPS' in pill and 'výška' in pill, pill)
        await page.evaluate("() => { try { closeBottomSheet(); } catch (e) {} }")

        # ---- B: novy bod z GPS prumeru dostane posun polohy i vysky --------------------------
        r = await page.evaluate("""() => { %s openNewPointModal(); fillAveragedGPS();
            document.getElementById('custom-name').value = 'T1';
            var z = parseFloat(document.getElementById('custom-z').value), zs = window._agZSrc;
            var n0 = persistentCustomPoints.length;
            saveCustomPoint();
            var p = persistentCustomPoints[persistentCustomPoints.length - 1];
            return { pribyl: persistentCustomPoints.length === n0 + 1, zPole: z, zSrc: zs, vyska: p && p.vyska, lat: p && p.lat, origin: p && p.prov && p.prov.origin, rs: p && p.refShift }; }""" % GPS_JS)
        ok('B1 fillAveragedGPS: Z = Bpv z GPS (alt − N), zdroj vysky = gps', r['zSrc'] == 'gps' and abs(r['zPole'] - (ALT_GPS - oc)) < 0.01, r)
        ok('B2 ulozeny bod: poloha +1 m na sever, VYSKA = vyska bodu (GPS Bpv + dh ≈ 250,00)', r['pribyl'] and r['origin'] == 'gps-avg' and abs((r['lat'] - LAT) * MLAT - 1.0) < 0.05 and abs(r['vyska'] - H_NIV) < 0.015 and r['rs'] and abs(r['rs']['dh'] - dh_oc) < 0.005, r)
        r2 = await page.evaluate("""() => { %s openNewPointModal(); fillAveragedGPS();
            document.getElementById('custom-name').value = 'T2'; document.getElementById('custom-z').value = '247.10'; window._agZSrc = 'dmr';
            saveCustomPoint();
            var p = persistentCustomPoints[persistentCustomPoints.length - 1];
            return { name: p.name, vyska: p.vyska, lat: p.lat, rs: p.refShift }; }""" % GPS_JS)
        ok('B3 vyska prepsana z DMR se NEposouva (poloha ano)', r2['name'] == 'T2' and abs(r2['vyska'] - 247.10) < 0.005 and abs((r2['lat'] - LAT) * MLAT - 1.0) < 0.05 and r2['rs'] and r2['rs'].get('dh') is None, r2)
        await page.evaluate("() => { window._agZSrc = null; try { closeNewPointModal && closeNewPointModal(); } catch (e) {} }")

        # ---- C: dialog nastroje --------------------------------------------------------------
        await page.evaluate("() => { %s openRefCalibration(); }" % GPS_JS)
        ok('C1 dialog otevren, pole vyska + telefon nad znackou', await cekej(page, "document.getElementById('agref-modal') && document.getElementById('agref-modal').style.display === 'flex' && document.getElementById('agref-h') && document.getElementById('agref-hp')", 20))
        c = await page.evaluate("""() => { var sel = document.getElementById('agref-select'); var opts = Array.from(sel.options).map(o => o.textContent);
            var i = opts.findIndex(t => /Kk1-12/.test(t)); if (i < 0) return { opts: opts };
            sel.value = sel.options[i].value; sel.dispatchEvent(new Event('change'));
            return { opt: opts[i], h: document.getElementById('agref-h').value, y: document.getElementById('agref-y').value, gps: document.getElementById('agref-gps').textContent }; }""")
        ok('C2 nivelacni bod v nabidce s „nivelační · H", vyber predvyplni vysku 250.000 i Y/X', c.get('opt') and 'nivelační' in c['opt'] and '· H' in c['opt'] and c['h'] == '250.000' and c['y'], c)
        ok('C3 dialog ukazuje vysku Bpv z GPS', 'Výška Bpv z GPS' in (c.get('gps') or '') and ('%.2f' % (ALT_GPS - oc)).replace('.', ',') in c['gps'], c.get('gps'))
        await page.evaluate("() => { document.getElementById('agref-hp').value = '1.2'; }")
        await page.click('#agref-apply')
        ok('C4 Spocitat → dialog Kalibrace zapnuta', await cekej(page, "document.querySelector('.ag-dlg-title') && /Kalibrace zapnuta/.test(document.querySelector('.ag-dlg-title').textContent)", 15))
        await page.click('.ag-dlg-ok')
        sh2 = await page.evaluate("() => { var s = window.agRefShift; return { dh: s.dh, hp: s.hp, st: document.getElementById('agref-state').textContent }; }")
        ok('C5 telefon 1,2 m nad znackou se odecte: dh = H − (Bpv_gps − 1,2)', abs(sh2['dh'] - (H_NIV - (ALT_GPS - oc - 1.2))) < 0.005 and sh2['hp'] == 1.2 and 'výška' in sh2['st'], {'sh2': sh2, 'oc': H_NIV - (ALT_GPS - oc - 1.2)})
        await page.evaluate("() => document.getElementById('agref-close').click()")

        # ---- D: TB bez vysky → jen poloha ----------------------------------------------------
        await page.evaluate("() => { %s var p = arPoints.find(x => x.id === 'p_tb'); showDetails(p, 30); }" % GPS_JS)
        await cekej(page, "document.querySelector('#ag-kb-acts button[data-a=\"ref\"]')", 20)
        await page.click('#ag-kb-acts button[data-a="ref"]')
        await cekej(page, "document.querySelector('.ag-dlg-title') && /Opravit GPS podle bodu 28/.test(document.querySelector('.ag-dlg-title').textContent)", 20)
        d = await page.evaluate("() => (document.querySelector('.ag-dlg-msg') || {}).textContent || ''")
        ok('D1 TB bez vysky: „Bod nemá výšku — opraví se jen poloha", a varovani, ze jsem 30 m od bodu', 'Bod nemá výšku' in d and 'jen poloha' in d and '30,1 m' in d and 'to je moc' in d, d[:400])
        await page.click('.ag-dlg-ok')
        await cekej(page, "document.querySelector('.ag-dlg-title') && /Kalibrace zapnuta/.test(document.querySelector('.ag-dlg-title').textContent)", 15)
        d2 = await page.evaluate("() => ({ msg: (document.querySelector('.ag-dlg-msg') || {}).textContent || '', dh: window.agRefShift.dh, refH: window.agRefShift.refH })")
        ok('D2 posun bez vysky (dh prazdne)', d2['dh'] is None and d2['refH'] is None and 'jen poloha' in d2['msg'], d2)
        await page.click('.ag-dlg-ok')

        vazne = [c for c in chyby if 'favicon' not in c and 'net::ERR' not in c and '404' not in c and 'tile.openstreetmap' not in c and '/owner/' not in c and '403' not in c and 'Failed to fetch' not in c and 'ERR_FAILED' not in c]
        ok('Z bez chyb stranky', not vazne, vazne[:5])
        await ctx.close()
        await br.close()


def main():
    srv, url = server(PORT)
    if not srv:
        print('CHYBA: server nenastartoval')
        sys.exit(2)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    sys.exit(1 if spatne else 0)


if __name__ == '__main__':
    main()
