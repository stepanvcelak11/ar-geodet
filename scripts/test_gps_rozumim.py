#!/usr/bin/env python3
# ===== AR Geodet - "ROZUMIM" U SLABE GPS (1. 9. 2026) =========================
# Overuje v Chromiu, ze varovani "Slaba GPS - ted nemer" jde odkliknout PRIMO
# ze sbalene stavove pilulky a ze odkliknuti VYDRZI:
#
#   A) Pri presnosti nad prahem (>10 m) se hlaska objevi v centru upozorneni
#      a sbalena pilulka #ag-sp u ni ukaze krizek .ag-sp-x ("Rozumim").
#   B) Klepnuti na krizek hlasku vyskrtne (AGNotify uz ji nema, text zmizi
#      z pilulky) - jedno tuknuti misto cesty pres detail a kartu upozorneni.
#   C) PAMET: kratky zablesk dobre presnosti (pod prah na ~2 s) a navrat na
#      13 m hlasku NEVZKRISI - presne tohle drive delalo, ze se varovani
#      porad vracelo a prekazelo (odkliknuti se zapomnelo jedinym tikem).
#   D) VYRAZNE zhorseni (>1,5x hodnoty pri odkliknuti) hlasku zase UKAZE -
#      odkliknuti nesmi umlcet novou, horsi situaci.
#
# Pouziti (z korene repa):  python scripts/test_gps_rozumim.py [port]
# ==============================================================================
import asyncio
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8493
URL = None

BOOT_ADMIN = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('arSurveyor','Stepan');
  localStorage.setItem('agFirmaBioAsk_v1', String(Date.now()));
  (function () {
    var f = { enabled: true, firmName: 'Test', createdTs: Date.now(), autoLockMin: 0,
      users: [{ id: 'u1', name: 'Stepan', role: 'admin', salt: 'aa', pinHash: 'x', noPin: true }] };
    localStorage.setItem('agFirma_v1', JSON.stringify(f));
    localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: 'u1', ts: Date.now() }));
  })();
"""

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)) if detail else ''))


def server():
    global URL
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % port
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                URL = u
                return srv
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None


async def nacti(page, cekej_na='true'):
    for _ in range(4):
        try:
            await page.goto(URL, wait_until='domcontentloaded', timeout=45000)
            break
        except Exception:
            await page.wait_for_timeout(1500)
    await page.wait_for_timeout(2200)
    await page.evaluate("() => { if (typeof window.startAppFromWelcome === 'function') startAppFromWelcome(); }")
    for _ in range(40):
        if await page.evaluate("() => " + cekej_na):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(400)
    await page.wait_for_timeout(2200)


# Nastavi hlasenou presnost a prizivi fix, aby gps-trust nehlasil "ztracena"
# (ta by hlasku o presnosti potlacila pres SUPPRESS v centru upozorneni).
#
# ⚠⚠ DVE PASTI, kvuli kterym test dlouho merikoval do prazdna (hlaska se NIKDY
#    neobjevila a body B/C/D pak prosly jen proto, ze nebylo co ukazovat):
#   1) `window.currentGpsAccuracy = 25` NENI ta promenna, kterou appka cte.
#      V js/logika.js je `let currentGpsAccuracy` (script scope), takze vlastnost
#      na window je UPLNE JINA vec a gps-warn ji nevidi. Musi se prirazovat BEZ
#      `window.` - bare prirazeni projde scope chainem az na to `let`. Totez plati
#      pro userLat/userLng a viewMode. (`window.AGFix` naopak vlastnost na window
#      OPRAVDU je - tu logika.js sama takhle nastavuje.)
#   2) gps-warn v samostatne MAPE zamerne mlci (`arVisible()`), a appka startuje
#      prave v mape. Bez prepnuti na AR se varovani neukaze ani pri 100 m.
#      A prepnout se musi PRIRAZENIM DO viewMode BEZ applyViewMode(): to totiz
#      spusti kameru, headless Chromium zadnou nema a handleCameraError v
#      js/grafika.js srazi appku obratem zpatky do mapy (v prubehu jednoho tiku).
NASTAV_ACC = """(m) => {
    try {
        currentGpsAccuracy = m;
        userLat = 50.08; userLng = 14.42;
        viewMode = 'both';   // BEZ applyViewMode() - viz poznamka 2) vyse
    } catch (e) { return 'PRIRAZENI SPADLO: ' + e.message; }
    window.AGFix = window.AGFix || {};
    window.AGFix.ts = Date.now();
    return currentGpsAccuracy;
}"""


async def cekej_na_stav(page, chci_hlasku, max_s=8.0):
    """Ceka, az AGNotify.has('gps-acc') == chci_hlasku; prizivuje fix i AR rezim.

    Fix se musi prizivovat porad: jinak gps-trust ohlasi "ztracena poloha" a ta
    hlasku o presnosti pres SUPPRESS prebije. Stejne tak AR rezim - appka se do
    samostatne mapy vraci sama (chybejici kamera, ale i vlastni ovladani), a v
    mape gps-warn zamerne mlci.
    """
    konec = time.time() + max_s
    while time.time() < konec:
        ma = await page.evaluate("() => !!(window.AGNotify && AGNotify.has('gps-acc'))")
        await page.evaluate("""() => {
            if (window.AGFix) AGFix.ts = Date.now();
            try { viewMode = 'both'; } catch (e) {}
        }""")
        if bool(ma) == chci_hlasku:
            return True
        await page.wait_for_timeout(350)
    return False


async def main():
    from playwright.async_api import async_playwright
    srv = server()
    if not URL:
        print('CHYBA: nejde spustit test_server.py')
        return 1
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            ctx = await browser.new_context(viewport={'width': 390, 'height': 780})
            await ctx.add_init_script(BOOT_ADMIN)
            page = await ctx.new_page()
            chyby = []
            page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
            await nacti(page, "typeof window.AGNotify === 'object' && typeof window.AGStatusBar === 'object'")

            # ---- A) slaba GPS -> hlaska + krizek v pilulce -----------------------
            dosedlo = await page.evaluate(NASTAV_ACC, 25)
            ok('A0 presnost 25 m dosedla na promennou, kterou appka cte', dosedlo == 25, dosedlo)
            ok('A1 hlaska gps-acc se objevi (25 m)', await cekej_na_stav(page, True, 12.0))
            await page.wait_for_timeout(800)   # nudgeBar + tick pruhu
            st = await page.evaluate("""() => {
                const x = document.querySelector('#ag-sp .ag-sp-x');
                const head = document.querySelector('#ag-sp .ag-sp-head');
                const el = document.getElementById('ag-sp');
                return {
                    x: !!x, xVidet: !!(x && x.offsetWidth > 0 && x.offsetHeight > 0),
                    text: head ? head.textContent : '',
                    vyska: el ? el.getBoundingClientRect().height : 0
                };
            }""")
            ok('A2 pilulka nese text hlasky', 'Slabá GPS' in st['text'], st['text'][:60])
            ok('A3 krizek .ag-sp-x je videt', st['x'] and st['xVidet'])
            # vyska pilulky se krizkem nesmi hnout (12px pismo + 2x5px odsazeni
            # + ramecek ~ 24 px; strop 26 px necha rezervu na zaokrouhlovani)
            ok('A4 pilulka zustala nizka (<=26 px)', 0 < st['vyska'] <= 26, st['vyska'])

            # ---- B) klepnuti na krizek hlasku vyskrtne ---------------------------
            # Nejdriv z cesty dialog, ktery patri JEN do testovaciho Chromia:
            # prepnuti do AR spusti kameru, headless zadnou nema a appka na to
            # spravne rekne "Kamera nejde spustit". Modalni dialog pilulku
            # prekryva PRAVEM, takze by hit-test nize merikoval tuhle hlasku.
            await page.evaluate("""() => {
                const b = document.querySelector('.ag-dlg-overlay.open .ag-dlg-ok');
                if (b) b.click();
                document.querySelectorAll('.ag-dlg-overlay.open').forEach(o => o.classList.remove('open'));
            }""")
            await page.wait_for_timeout(300)
            # Klik jako hit-test: co je v miste krizku NAVRCHU? Na telefonu je pruh
            # nad vsim (z-index 645), v testovacim Chromiu to musi platit taky.
            hit = await page.evaluate("""() => {
                const x = document.querySelector('#ag-sp .ag-sp-x');
                if (!x) return { top: 'krizek chybi' };
                const r = x.getBoundingClientRect();
                const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                var dlg = document.querySelector('.ag-dlg-overlay.open');
                return { top: el ? (el.id || el.className || el.tagName) : '?',
                         dialog: dlg ? (dlg.textContent || '').slice(0, 120) : '',
                         vKrizku: !!(el && (el === x || x.contains(el) || el.closest('#ag-sp'))) };
            }""")
            ok('B0 krizek neni prekryty jinym prvkem', hit.get('vKrizku'),
               str(hit.get('top')) + ((' | dialog: ' + hit['dialog']) if hit.get('dialog') else ''))
            await page.evaluate("() => { const x = document.querySelector('#ag-sp .ag-sp-x'); if (x) x.click(); }")
            ok('B1 hlaska po "Rozumim" zmizela', await cekej_na_stav(page, False, 3.0))
            await page.wait_for_timeout(2500)  # dva tiky gps-warn pri stale 25 m
            ma = await page.evaluate("() => !!(window.AGNotify && AGNotify.has('gps-acc'))")
            ok('B2 pri stejne presnosti se nevraci', not ma)
            txt = await page.evaluate("() => (document.querySelector('#ag-sp .ag-sp-head')||{}).textContent || ''")
            ok('B3 text zmizel i z pilulky', 'Slabá GPS' not in txt, txt[:60])

            # ---- C) zablesk dobre presnosti odkliknuti nezapomene ----------------
            await page.evaluate(NASTAV_ACC, 8)
            await page.wait_for_timeout(2300)  # dva tiky "dobre" (mene nez 3 min)
            await page.evaluate(NASTAV_ACC, 13)
            objevila = await cekej_na_stav(page, True, 4.0)
            ok('C1 po zablesku 8 m a navratu na 13 m mlci', not objevila)

            # ---- D) vyrazne zhorseni (>1,5x) se zase ohlasi ----------------------
            await page.evaluate(NASTAV_ACC, 45)
            ok('D1 pri 45 m (>1,5x 25 m) se hlaska vrati', await cekej_na_stav(page, True, 6.0))
            await page.wait_for_timeout(800)
            txt = await page.evaluate("() => (document.querySelector('#ag-sp .ag-sp-head')||{}).textContent || ''")
            ok('D2 pilulka ji zase nese i s krizkem', 'Slabá GPS' in txt and bool(
                await page.evaluate("() => !!document.querySelector('#ag-sp .ag-sp-x')")), txt[:60])

            vazne = [c for c in chyby if 'favicon' not in c]
            ok('JS bez chyb na strance', not vazne, '; '.join(vazne[:3]))
            await browser.close()
    finally:
        if srv:
            srv.terminate()

    spatne = [j for (v, j) in vysledky if not v]
    print()
    print('VYSLEDEK: %d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    return 1 if spatne else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
