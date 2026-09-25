# -*- coding: utf-8 -*-
u"""ZÁLOHA DO ÚČTU v appce (25. 9. 2026, 6. hodnocení b1) — js/zaloha-ucet.js proti podvrženému serveru.

Kontroluje: záloha odejde (gzip+base64), obsahuje body a NE přihlašovací údaje ani fotky; karta
v Nastavení → Záloha a údržba ukáže stav; automatika chce zálohu po 20 nových bodech; na
PRÁZDNÉM telefonu appka sama nabídne obnovu a po potvrzení body vrátí (reload).

python scripts/test_zaloha_ucet.py [port]
"""
import os
import sys
import json
import gzip
import base64
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9073)
VYSLEDKY = []
SERVER = {'zalohy': []}


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


async def backup_route(route, request):
    hdr = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'}
    if request.method == 'OPTIONS':
        return await route.fulfill(status=204, headers=hdr)
    if request.method == 'POST':
        b = json.loads(request.post_data or '{}')
        z = SERVER['zalohy']
        slot = 0 if not z else (1 if len(z) == 1 and z[0]['slot'] == 0 else sorted(z, key=lambda x: x['ts'])[0]['slot'])
        SERVER['zalohy'] = [x for x in z if x['slot'] != slot] + [{'slot': slot, 'ts': 1790300000000 + len(z), 'size': len(b['data']), 'body_n': b.get('body_n'), 'data': b['data'], 'auth': request.headers.get('authorization', '')}]
        return await route.fulfill(status=200, content_type='application/json', headers=hdr, body=json.dumps({'ok': True, 'slot': slot}))
    if 'slot=' in request.url:
        s = int(request.url.split('slot=')[1].split('&')[0])
        z = [x for x in SERVER['zalohy'] if x['slot'] == s]
        if not z:
            return await route.fulfill(status=404, content_type='application/json', headers=hdr, body=json.dumps({'error': 'Záloha nenalezena.'}))
        return await route.fulfill(status=200, content_type='application/json', headers=hdr, body=json.dumps(dict(z[0], ok=True)))
    lst = [{k: v for k, v in x.items() if k not in ('data', 'auth')} for x in sorted(SERVER['zalohy'], key=lambda x: -x['ts'])]
    return await route.fulfill(status=200, content_type='application/json', headers=hdr, body=json.dumps({'ok': True, 'zalohy': lst}))


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.route('**/account/backup**', backup_route)      # později registrovaná trasa má přednost
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ');")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        await page.evaluate("() => new Promise(r => AGLazy.need('js/zaloha-ucet.js', r))")
        ok('A1 modul a API zálohy', await V.cekej(page, "!!(window.AGZalohaUcet && window.AGZaloha && AGZaloha.sestav && AGZaloha.obnov)", 60))
        ok('A2 přihlášený účet (boot)', await page.evaluate("() => !!(AGUcty.ucet && AGUcty.ucet())"))
        # ag_boot automatiku vypíná (falešný token v ostatních testech) — tady ji zapnout
        await page.evaluate("() => localStorage.setItem('agZalohaUcet_v1', JSON.stringify({}))")
        await page.evaluate("""() => { const arr = []; for (let i = 0; i < 3; i++) { const ll = mistniToLatLng(743200 + i * 5.123, 1042100 + i * 5.456); arr.push({ name: 'ZU' + i, lat: ll.lat, lng: ll.lng, vyska: 250 + i, origin: 'import' }); }
            window.addImportedPoints(arr); localStorage.setItem('agFirmaTok_v1', JSON.stringify({ token: 'TAJNE-TOKEN' })); }""")
        await page.wait_for_timeout(800)
        v = await page.evaluate("() => AGZalohaUcet.zalohuj(true)")
        ok('Z1 ruční záloha do účtu: ok', v and v.get('ok'), v)
        z = SERVER['zalohy']
        ok('Z2 server dostal 1 zálohu se 3 body a tokenem účtu v hlavičce', len(z) == 1 and z[0]['body_n'] == 3 and z[0]['auth'].startswith('Bearer '), [(x['slot'], x['body_n'], x['size']) for x in z])
        payload = json.loads(gzip.decompress(base64.b64decode(z[0]['data'])).decode('utf-8')) if z else {}
        text = json.dumps(payload, ensure_ascii=False)
        ok('Z3 obsah: gzip + base64 → záloha QTRIG typu „ucet“ s body ZU0–ZU2', payload.get('app') == 'QTRIG' and payload.get('type') == 'ucet' and 'ZU0' in text and 'ZU2' in text, list(payload.keys()))
        ok('Z4 BEZ přihlašovacích údajů (agFirmaTok_v1, TAJNE-TOKEN) a bez fotek (extra prázdné)', 'agFirmaTok_v1' not in payload.get('data', {}) and 'TAJNE-TOKEN' not in text and not payload.get('extra'), [k for k in payload.get('data', {}) if 'Firma' in k])
        ok('Z5 automatika: hned po záloze už nechce další', await page.evaluate("() => AGZalohaUcet._test.potreba() === false"))
        await page.evaluate("""() => { const arr = []; for (let i = 0; i < 20; i++) { const ll = mistniToLatLng(743400 + i * 3, 1042300 + i * 3); arr.push({ name: 'N' + i, lat: ll.lat, lng: ll.lng, origin: 'import' }); } window.addImportedPoints(arr); }""")
        ok('Z6 po 20 nových bodech ji chce zase', await page.evaluate("() => AGZalohaUcet._test.potreba() === true"))

        # karta v Nastavení
        await page.evaluate("() => { openSettings(); switchTab('tab-udrzba'); }")
        await page.wait_for_timeout(900)
        k = await page.evaluate("() => { const e = document.getElementById('ag-zu'); const r = e && e.getBoundingClientRect(); return e ? { w: r.width, t: document.getElementById('ag-zu-stav').textContent, b: [...e.querySelectorAll('button')].map(x => x.textContent.trim()) } : null; }")
        await page.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'zu_karta.png'))
        ok('K1 karta Záloha do účtu: stav „Naposledy … bodů: 3“ + Zálohovat teď / Obnovit z účtu', k and k['w'] > 200 and 'Naposledy' in k['t'] and 'bodů: 3' in k['t'] and 'Zálohovat teď' in k['b'] and 'Obnovit z účtu' in k['b'], k)
        await page.evaluate("() => { const s = document.getElementById('settings-modal'); s.style.display = 'none'; s.classList.remove('ag-open'); }")

        # prázdný telefon → nabídka obnovy → potvrdit → body zpátky
        await page.evaluate("""() => { persistentCustomPoints.length = 0; arPoints.length = 0; setStoredData('arCustomPoints12', '[]');
            const s = JSON.parse(localStorage.getItem('agZalohaUcet_v1') || '{}'); delete s.nabidnutoTs; localStorage.setItem('agZalohaUcet_v1', JSON.stringify(s)); }""")
        ok('O0 telefon prázdný (0 bodů)', await page.evaluate("() => persistentCustomPoints.length === 0"))
        await page.evaluate("() => AGZalohaUcet.nabidka()")
        dlg = await V.cekej(page, "(() => { const d = document.querySelector('.ag-dlg-overlay'); return d && /Obnovit zálohu z účtu/.test(d.textContent) && /bodů: 3/.test(d.textContent); })()", 30)
        ok('O1 appka sama nabídne obnovu (datum, počet bodů)', dlg)
        async with page.expect_navigation(timeout=60000):
            await page.evaluate("() => { const b = document.querySelector('.ag-dlg-overlay .ag-dlg-ok'); b && b.click(); }")
        await page.wait_for_load_state('domcontentloaded')
        start2 = await V.cekej(page, "document.body.classList.contains('app-started') && typeof persistentCustomPoints !== 'undefined'", 120)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'zu_po_obnove.png'))
        n = await page.evaluate("() => (typeof persistentCustomPoints === 'undefined') ? 'NENI' : persistentCustomPoints.map(p => p.name).sort()")
        ok('O2a appka po obnově nastartovala', start2)
        ok('O2 po obnově (reload) jsou body ZU0–ZU2 zpátky', n == ['ZU0', 'ZU1', 'ZU2'], n)
        ok('O3 přihlášení zůstalo (token telefonu se zálohou nepřepsal)', await page.evaluate("() => (localStorage.getItem('agFirmaTok_v1') || '').indexOf('TAJNE-TOKEN') >= 0"))
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
