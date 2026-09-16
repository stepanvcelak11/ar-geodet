# -*- coding: utf-8 -*-
"""ANDROID (16. 9. 2026): uzivatel ma jen iPhone → appka se tu prozene v emulaci Chromu na
Androidu (Pixel 7: UA Android, 412×915, dotyk) s KOMPASEM PO ANDROIDSKU — zadne
webkitCompassHeading, zadne requestPermission, jen 'deviceorientationabsolute' s alpha
(magneticky sever, heading = 360 − alpha) a vedle nej RELATIVNI 'deviceorientation', ktere
se musi ignorovat. Kamera fake (Chromium), poloha Praha.

  A  start bez dotazu na povoleni kompasu, AR ma zivy smer: bod na vychode je uprostred,
     kdyz alpha = 270 (heading 90), a vpravo od stredu, kdyz alpha = 315 (heading 45);
     relativni udalosti s jinym alpha smer NEROZHODI; zadny dialog „Kompas nema povoleni"
  B  vsechny dlazdice Nastroju (Pro) jdou otevrit: 0 chyb stranky, otevrene okno se vejde
     do displeje 412×915 (zadny prvek okna mimo obrazovku)
  C  tlacitko ZPET Androidu (js/android.js): straz v historii, Zpet zavre nejvyssi okno
     (dialog → karta → nic), rucne zavrene okno + Zpet appku nevyhodi
  D  stavovy pruh nehlasi kompas jako nepovoleny / mlcici; libela bere +g (Android znamenko)
  E  Android API: bez requestPermission, s fullscreen; beforeinstallprompt → po chvili dialog
     „Pridat QTRIG na plochu?“ → Pridat zavola prompt(); Ted ne = klid 14 dni

Spusteni: python scripts/test_android.py [port]
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
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9149)
vysledky = []
LAT, LNG = 50.0755, 14.4378
MLAT = 111320.0
MLNG = 111320.0 * math.cos(math.radians(LAT))
DEVICE = os.environ.get('AG_DEVICE', 'Pixel 7')   # AG_DEVICE='Galaxy S8' = 360×740
W, H = 412, 915


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
        try:
            t = urllib.request.urlopen('http://127.0.0.1:%d/js/logika.js' % p, timeout=2).read().decode('utf-8', 'replace')
            if 'agUpdPill' in t and srv.poll() is None:
                return srv, u
        except Exception:
            pass
        srv.terminate()
    return None, None


SEED = "localStorage.setItem('default_arOfflinePoints12', %s);" % json.dumps(json.dumps([
    {'id': 'p_east', 'name': '601', 'lat': LAT, 'lng': LNG + 60.0 / MLNG, 'cat': 'PBPP', 'type': 'polohovy', 'hidden': False, 'vyska': 250, 'vrstva': 42, 'rawData': {'CISLO': '601', 'VYSKA': '250.00'}},
    {'id': 'p_north', 'name': '602', 'lat': LAT + 60.0 / MLAT, 'lng': LNG, 'cat': 'PBPP', 'type': 'polohovy', 'hidden': False, 'vyska': 250, 'vrstva': 42, 'rawData': {'CISLO': '602', 'VYSKA': '250.00'}}]))

# Kompas po androidsku: absolutni udalost kazdych 100 ms (alpha z window.__agAlpha),
# relativni udalost s jinym alpha kazdych 130 ms (musi se ignorovat).
KOMPAS = """
(function () {
  window.__agAlpha = 0;
  function fire(type, alpha, abs) {
    try {
      var ev = new DeviceOrientationEvent(type, { alpha: alpha, beta: 75, gamma: 0, absolute: abs });
      window.dispatchEvent(ev);
    } catch (e) {}
  }
  setInterval(function () { fire('deviceorientationabsolute', window.__agAlpha, true); }, 100);
  setInterval(function () { fire('deviceorientation', (window.__agAlpha + 137) % 360, false); }, 130);
})();
"""


async def cekej(page, vyraz, kol=25):
    for _ in range(kol):
        if await page.evaluate('() => !!(' + vyraz + ')'):
            return True
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(400)
    return False


async def stranka(pw, br, url, init, chyby):
    global W, H
    dev = dict(pw.devices[DEVICE])
    W, H = dev['viewport']['width'], dev['viewport']['height']
    dev.pop('default_browser_type', None)
    ctx = await br.new_context(locale='cs-CZ', geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3},
                               permissions=['geolocation'], service_workers='block', **dev)
    page = await ctx.new_page()
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
    page.on('console', lambda m: chyby.append('console: ' + m.text + ' @ ' + str((m.location or {}).get('url', ''))) if m.type == 'error' else None)

    async def route_vse(route, request):
        u = request.url
        try:
            if 'cuzk.cz/' in u or 'cuzk.gov.cz/' in u or 'openstreetmap' in u or 'workers.dev' in u or 'mapy.cz' in u or 'mapy.com' in u:
                return await route.abort()
        except Exception:
            pass
        try:
            await route.continue_()
        except Exception:
            pass
    await page.route('**/*', route_vse)
    await page.add_init_script(init)
    await page.goto(url, wait_until='domcontentloaded', timeout=60000)
    await page.wait_for_timeout(3000)
    return ctx, page


MARKER_X = """(id) => { const p = arPoints.find(x => x.id === id); if (!p || !p.element) return null;
    const r = p.element.getBoundingClientRect(); if (!r.width) return null; return Math.round(r.left + r.width / 2); }"""


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        chyby = []
        ctx, page = await stranka(pw, br, url, boot(tarif='pro') + SEED + KOMPAS
                                  + "localStorage.setItem('agViewMode','ar'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.setItem('arCompassCalibShown','1');", chyby)
        ua = await page.evaluate("() => navigator.userAgent")
        ok('0 emulace Androidu (UA) a appka nastartovala', 'Android' in ua and await cekej(page, "document.body.classList.contains('app-started')"), ua)
        await cekej(page, "typeof userLat === 'number' && userLat", 30)
        await page.wait_for_timeout(2500)

        # ---- A: kompas po androidsku -----------------------------------------------------------
        a0 = await page.evaluate("() => ({ denied: !!window.AGCompassDenied, dlg: !!document.querySelector('.ag-dlg-title') && document.querySelector('.ag-dlg-title').textContent, view: localStorage.getItem('agViewMode'), heading: currentHeading, markers: document.querySelectorAll('.ar-marker').length, camDlg: !!document.getElementById('camera-load-btn') })")
        ok('A1 zadny dialog „Kompas nema povoleni", AGCompassDenied false', not a0['denied'] and not (a0['dlg'] and 'Kompas' in str(a0['dlg'])), a0)
        # heading 90 (vychod) = alpha 270 → bod na vychode uprostred
        await page.evaluate("() => { window.__agAlpha = 270; }")
        await page.wait_for_timeout(2500)
        hx = await page.evaluate("() => ({ h: currentHeading, e: (%s)('p_east'), n: (%s)('p_north') })" % (MARKER_X, MARKER_X))
        ok('A2 alpha 270 → heading ≈ 90 (360 − alpha), bod na vychode uprostred displeje', hx['h'] is not None and abs(((hx['h'] - 90 + 180) % 360) - 180) < 12 and hx['e'] is not None and abs(hx['e'] - W / 2) < 60, hx)
        await page.evaluate("() => { window.__agAlpha = 315; }")   # heading 45 → vychod vpravo od stredu, sever vlevo
        await page.wait_for_timeout(2500)
        hx2 = await page.evaluate("() => ({ h: currentHeading, e: (%s)('p_east'), n: (%s)('p_north') })" % (MARKER_X, MARKER_X))
        ok('A3 alpha 315 → heading ≈ 45: vychod vpravo, sever vlevo od stredu', hx2['h'] is not None and abs(((hx2['h'] - 45 + 180) % 360) - 180) < 12 and hx2['e'] is not None and hx2['n'] is not None and hx2['e'] > W / 2 + 30 and hx2['n'] < W / 2 - 30, hx2)
        # relativni udalosti (alpha + 137) nesmi smer rozhodit — heading porad ~45
        await page.wait_for_timeout(1500)
        hx3 = await page.evaluate("() => currentHeading")
        ok('A4 relativni deviceorientation (jine alpha) se ignoruje — smer drzi', hx3 is not None and abs(((hx3 - 45 + 180) % 360) - 180) < 12, hx3)

        # ---- D: stavovy pruh / kompas + libela ----------------------------------------------------
        d = await page.evaluate("""() => { const sp = document.getElementById('ag-stav-pruh') || document.querySelector('.ag-sp'); const t = sp ? sp.textContent : '';
            const al = document.querySelector('.ag-dlg-title'); return { sp: t.slice(0, 160), dlg: al ? al.textContent : null }; }""")
        ok('D1 stavovy pruh nehlasi kompas nepovoleny/mlcici', 'Kompas' not in d['sp'] and 'kompas' not in d['sp'].lower(), d)

        # ---- C: tlacitko Zpet Androidu (js/android.js) ------------------------------------
        ok('C0 na hlavni obrazovce neni nic „otevrene" (AGZpet.otevrene prazdne)', await cekej(page, "window.AGZpet && AGZpet.otevrene().length === 0", 10),
           await page.evaluate("() => window.AGZpet ? AGZpet.otevrene().map(e => e.id || e.className) : 'bez modulu'"))
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'flex'; }")
        ok('C1 po otevreni Nastroju je v historii straz', await cekej(page, "AGZpet._test.guard()", 10))
        await page.go_back()
        await page.wait_for_timeout(900)
        c = await page.evaluate("() => ({ vis: document.getElementById('tools-modal').classList.contains('ag-open'), started: document.body.classList.contains('app-started'), url: location.href })")
        ok('C2 Zpet (history.back) zavre Nastroje a appka zustane', not c['vis'] and c['started'] and 'index.html' in c['url'], c)
        # dve okna nad sebou: karta bodu + dialog agConfirm → Zpet zavre jen dialog, pak kartu
        await page.evaluate("() => { var p = arPoints.find(x => x.id === 'p_east'); showDetails(p, 60); }")
        await cekej(page, "document.getElementById('bottom-sheet').classList.contains('open') && AGZpet._test.guard()", 10)
        await page.evaluate("() => { window.__agDlg = agConfirm({ title: 'Test', message: 'x', okText: 'Ano', cancelText: 'Ne' }); }")
        await page.wait_for_timeout(500)
        await page.go_back()
        await page.wait_for_timeout(700)
        c3 = await page.evaluate("() => ({ dlg: !!document.querySelector('.ag-dlg-overlay.open'), sheet: document.getElementById('bottom-sheet').classList.contains('open') })")
        await page.go_back()
        await page.wait_for_timeout(700)
        c4 = await page.evaluate("() => ({ sheet: document.getElementById('bottom-sheet').classList.contains('open'), started: document.body.classList.contains('app-started'), url: location.href })")
        ok('C3 dva Zpet za sebou: nejdriv dialog (jako Zrusit), pak karta bodu; appka zustane', not c3['dlg'] and c3['sheet'] and not c4['sheet'] and c4['started'] and 'index.html' in c4['url'], (c3, c4))
        # straz po rucnim zavreni okna: dalsi Zpet nic nezavre, ale appku nevyhodi
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'flex'; }")
        await cekej(page, "AGZpet._test.guard()", 10)
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'none'; }")
        await page.go_back()
        await page.wait_for_timeout(700)
        c5 = await page.evaluate("() => ({ started: document.body.classList.contains('app-started'), url: location.href })")
        ok('C4 okno zavrene rucne + Zpet → appka zustane (straz se tise sni)', c5['started'] and 'index.html' in c5['url'], c5)

        # ---- E: guardy API --------------------------------------------------------------------------
        e = await page.evaluate("""() => { const r = {}; try { r.share = typeof navigator.share; r.vib = typeof navigator.vibrate; r.wl = 'wakeLock' in navigator; r.fs = typeof document.documentElement.requestFullscreen; r.dm = typeof DeviceMotionEvent; r.rp = typeof DeviceOrientationEvent.requestPermission; } catch (x) { r.err = String(x); } return r; }""")
        ok('E1 Android: bez DeviceOrientationEvent.requestPermission, s fullscreen API — appka bezi', e.get('rp') == 'undefined' and e.get('fs') == 'function', e)

        # ---- E2: nabidka instalace z beforeinstallprompt ------------------------------------
        e2 = await page.evaluate("""() => new Promise(res => {
            const ev = new Event('beforeinstallprompt', { cancelable: true }); let prompted = 0; ev.prompt = () => { prompted++; return Promise.resolve(); };
            window.dispatchEvent(ev);
            const muze = AGAndroid.muzeInstalovat();
            AGAndroid._test.nabidnout();
            setTimeout(() => {
                const t = document.querySelector('.ag-dlg-overlay.open .ag-dlg-title'); const title = t ? t.textContent : null;
                const okb = document.querySelector('.ag-dlg-overlay.open .ag-dlg-ok'); if (okb) okb.click();
                setTimeout(() => res({ muze, title, prompted, def: ev.defaultPrevented }), 300);
            }, 400);
        })""")
        ok('E2 beforeinstallprompt → dialog „Pridat QTRIG na plochu?" → Pridat zavola prompt()', e2['muze'] and e2['title'] and 'na plochu' in e2['title'] and e2['prompted'] == 1 and e2['def'], e2)

        # ---- B: pruchod vsemi dlazdicemi Nastroju ---------------------------------------------------
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'flex'; }")
        await page.wait_for_timeout(800)
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(2500)
        tiles = await page.evaluate("() => Array.from(document.querySelectorAll('#tools-modal .tool-tile')).map(t => t.getAttribute('data-tool') || (t.getAttribute('onclick') || '').slice(0, 60)).filter(Boolean)")
        ok('B0 nasel jsem dlazdice Nastroju (>= 50)', len(tiles) >= 50, len(tiles))
        nalezy = []
        precheck = len(chyby)
        for key in tiles:
            try:
                await page.evaluate("""() => { document.querySelectorAll('.modal-overlay').forEach(m => { if (m.id !== 'tools-modal') m.style.display = 'none'; });
                    document.querySelectorAll('.ag-dlg-overlay').forEach(m => m.classList.remove('open')); document.getElementById('tools-modal').style.display = 'flex'; }""")
                await page.wait_for_timeout(150)
                n0 = len(chyby)
                r = await page.evaluate("(k) => { const t = Array.from(document.querySelectorAll('#tools-modal .tool-tile')).find(t => (t.getAttribute('data-tool') || (t.getAttribute('onclick') || '').slice(0, 60)) === k); if (!t) return 'neni'; t.click(); return 'ok'; }", key)
                if r != 'ok':
                    continue
                await page.wait_for_timeout(900)
                # co je otevrene: nejvyssi viditelny modal; prvky mimo displej?
                mimo = await page.evaluate("""([W, H]) => {
                    const vis = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const x = r.left + r.width / 2, y = r.top + r.height / 2; const e = document.elementFromPoint(Math.min(W - 1, Math.max(0, x)), Math.min(H - 1, Math.max(0, y))); return !!(e && (e === el || el.contains(e))); };
                    const out = [];
                    document.querySelectorAll('.modal-overlay, .ag-dlg-overlay, [role=dialog]').forEach(m => {
                        if (getComputedStyle(m).display === 'none') return;
                        m.querySelectorAll('button, input, select, h2, h3').forEach(el => {
                            if (!vis(el)) return;
                            const r = el.getBoundingClientRect();
                            // svisle jen mimo rolovaci kontejner: tlacitko dole v rolujicim okne se doroluje, to neni chyba
                            let sc = null, a = el.parentElement; while (a && a !== document.body) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 2) { sc = a; break; } a = a.parentElement; }
                            const svisle = !sc && (r.bottom > H + 2 || r.top < -2);
                            if (r.right > W + 2 || r.left < -2 || svisle) out.push((el.id || el.className || el.tagName) + ' ' + [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)].join(','));
                        });
                    });
                    return out.slice(0, 4);
                }""", [W, H])
                nove = [c for c in chyby[n0:] if 'net::ERR' not in c and 'Failed to load resource' not in c and 'ERR_FAILED' not in c and 'Failed to fetch' not in c]
                if nove or mimo:
                    nalezy.append({'nastroj': key, 'chyby': nove[:2], 'mimo': mimo})
            except Exception as ex:
                nalezy.append({'nastroj': key, 'vyjimka': str(ex)[:160]})
        ok('B1 pruchod %d dlazdicemi: bez chyb stranky a bez prvku mimo displej' % len(tiles), not nalezy, json.dumps(nalezy, ensure_ascii=False)[:1500])

        vazne = [c for c in chyby if 'favicon' not in c and 'net::ERR' not in c and '404' not in c and 'Failed to load resource' not in c and 'Failed to fetch' not in c and 'ERR_FAILED' not in c]
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
