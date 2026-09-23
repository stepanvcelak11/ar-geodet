# -*- coding: utf-8 -*-
u"""Celá obrazovka na iPhonu (23. 9. 2026, v385): „apka není na celou obrazovku, pod Dynamic
Islandem je černý pruh“.

Hlídá:
  S1  index.html má apple-mobile-web-app-status-bar-style = black-translucent (ne „black“)
  S2  js/cela-obrazovka.js je v index.html i v sw.js
  A*  s výřezem iPhonu (safe-area 59/34 přes CDP Emulation.setSafeAreaInsetsOverride):
      nic klikatelného ani žádný text nezajede pod Dynamic Island na hlavní obrazovce,
      v kameře, ve splitu, v Mých bodech, v Novém bodu a v Nastavení
  N1  hlavička Nastavení nezakrývá pole hledání (dřív se výřez počítal dvakrát)
  C1  při startu žádný záznam v protokolu chyb (zeme-svet:rtk, power-save:updateGpsAvgPanel)
  M1  prázdné Mé body nabízejí Přidat bod + Nahrát ze souboru
  R1  AGCelaObrazovka.staraIkona() v Chromu = false (rada se neukáže mimo iPhone z plochy)

python scripts/test_cela_obrazovka.py [port]
"""
import io
import os
import re
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = V.ROOT
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9043)
W, H, TOP, BOT = 393, 852, 59, 34
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


def src(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8').read()


KOLIZE_JS = """([TOP]) => {
  const out = [];
  const vis = el => { let p = el; while (p && p !== document.documentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; p = p.parentElement; } return true; };
  for (const el of document.querySelectorAll('button, a, input, select, textarea, [role=button], h1, h2, h3, label, span, b, p, div, li')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.height > innerHeight * 0.6) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const inter = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.getAttribute('role') === 'button';
    if (!own && !inter) continue;
    if (!(r.top < TOP - 2 && r.bottom > 2)) continue;
    if (!vis(el)) continue;
    const t = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.max(1, Math.min(r.bottom - 1, TOP - 3)));
    if (!t || !(t === el || el.contains(t) || t.contains(el))) continue;
    out.push((el.id || (el.closest('[id]') || {}).id || el.tagName) + ': ' + (el.textContent || '').trim().slice(0, 30) + ' @' + Math.round(r.top));
  }
  return out.slice(0, 8);
}"""


def staticke():
    h = src('index.html')
    m = re.search(r'<meta name="apple-mobile-web-app-status-bar-style" content="([^"]+)"', h)
    ok('S1 status-bar-style = black-translucent', m and m.group(1) == 'black-translucent', m and m.group(1))
    ok('S2 js/cela-obrazovka.js v index.html i v sw.js', 'src="js/cela-obrazovka.js"' in h and "'./js/cela-obrazovka.js'" in src('sw.js'))


async def beh(url):
    chyby = []
    async with async_playwright() as p:
        br = await p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': W, 'height': H}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3},
                                   permissions=['geolocation', 'camera'], service_workers='block')
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        cdp = await ctx.new_cdp_session(page)
        await cdp.send('Emulation.setSafeAreaInsetsOverride', {'insets': {'top': TOP, 'bottom': BOT, 'left': 0, 'right': 0}})
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        ok('A0 appka nastartovala', await V.cekej(page, "document.body.classList.contains('app-started')", 40))
        await page.wait_for_timeout(3500)
        ins = await page.evaluate("() => AGCelaObrazovka.insetTop()")
        ok('A1 výřez nahoře emulovaný (env(safe-area-inset-top) = 59)', ins == TOP, ins)
        err = await page.evaluate("() => { try { return JSON.parse(localStorage.getItem('agErrorLog') || '[]').map(e => e.msg); } catch (e) { return [String(e)]; } }")
        err = [e for e in err if not re.search(r'NetworkError|bez signálu|Failed to fetch', e or '')]
        ok('C1 start bez záznamu v protokolu chyb', not err, err)
        ok('R1 rada „přidej ikonu znovu“ se v Chromu neukáže', await page.evaluate("() => AGCelaObrazovka.staraIkona()") is False)

        for vm in ('map', 'ar', 'both'):
            await page.evaluate("(vm) => { viewMode = vm; applyViewMode(); }", vm)
            await page.wait_for_timeout(1500)
            await page.evaluate("() => document.querySelectorAll('.ag-dlg-overlay').forEach(o => { o.classList.remove('open'); o.remove(); })")
            k = await page.evaluate(KOLIZE_JS, [TOP])
            ok('A2 %s: nic pod Dynamic Islandem' % vm, not k, k)
        await page.evaluate("() => { viewMode = 'map'; applyViewMode(); }")
        await page.wait_for_timeout(600)

        await page.evaluate("() => openManageModal()")
        await page.wait_for_timeout(900)
        ok('A3 Mé body: nic pod Dynamic Islandem', not await page.evaluate(KOLIZE_JS, [TOP]))
        m1 = await page.evaluate("() => [...document.querySelectorAll('#manage-list .ag-empty-body button')].map(b => b.textContent.trim())")
        ok('M1 prázdné Mé body: Přidat bod + Nahrát ze souboru', any('Přidat bod' in t for t in m1) and any('Nahrát ze souboru' in t for t in m1), m1)
        await page.evaluate("() => closeManageModal()")

        await page.evaluate("() => openNewPointModal()")
        await page.wait_for_timeout(1200)
        ok('A4 Nový bod: nic pod Dynamic Islandem', not await page.evaluate(KOLIZE_JS, [TOP]))
        await page.evaluate("() => { const m = document.getElementById('custom-modal-overlay'); if (m) m.style.display = 'none'; }")

        await page.evaluate("() => openSettings()")
        await page.wait_for_timeout(1000)
        ok('A5 Nastavení: nic pod Dynamic Islandem', not await page.evaluate(KOLIZE_JS, [TOP]))
        n1 = await page.evaluate("""() => { const h = document.querySelector('#settings-modal .set-head').getBoundingClientRect();
            const t = document.querySelector('#settings-modal .set-head h2').getBoundingClientRect();
            const s = document.getElementById('ag-ns-search'); const r = s ? s.getBoundingClientRect() : null;
            return { h2: Math.round(t.top), headBot: Math.round(h.bottom), search: r ? Math.round(r.top) : null }; }""")
        ok('N1 hlavička Nastavení: nadpis pod výřezem, pole hledání pod hlavičkou (nezakryté)',
           n1['h2'] >= TOP and n1['h2'] < TOP + 40 and (n1['search'] is None or n1['search'] >= n1['headBot'] - 1), n1)

        ok('E1 bez chyb stránky', not chyby, chyby[:4])
        await ctx.close()
        await br.close()


def main():
    staticke()
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
