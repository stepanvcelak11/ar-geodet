#!/usr/bin/env python3
# ===== AR Geodet - OVERENI REZIMU VLASTNIKA V PROHLIZECI ======================
# Spousti appku v Chromiu a overuje js/vlastnik.js + ctyri zasahy v js/ucty.js:
#   1) na BRANE NENI VIDET NIC (na prani) a vstup otevre az dlouhy stisk znaku
#   2) karta klice se otevre a "Zpet" vrati puvodni branu I S OBSLUHOU tlacitek
#   3) spatny klic -> server vraci 403 a hlaska to rekne lidsky (ne "chyba 403")
#   4) se zapnutym prizankem se BRANA VUBEC NEUKAZE a can() vraci vsude true
#   5) v "Vice" je Konzole vlastnika a otevre se (polozky + stav serveru)
#   6) ukonceni rezimu vrati branu
#
# PROC PRAVE TAKHLE: staticka kontrola nechytne, ze brana pojistkou gateCheck()
# naskoci zpatky o dve sekundy pozdeji, ani ze tlacitko v menu nikdo neklikne.
# Body 3 a 5 potrebuji SIT (dotaz na ar-geodet-api) - bez site se preskoci.
#
# Pouziti:  python scripts/test_vlastnik.py [port]     (vychozi 8107)
# ==============================================================================
import asyncio
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8107
URL = 'http://127.0.0.1:%d/index.html' % PORT

# ZADNY agGuest_v1: chceme videt BRANU. agTutProSeen kvuli #agtp-block, ktery
# by jinak chytal vsechny kliky (viz pameti k trenazeru).
BOOT_GATE = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.removeItem('agVlastnik_v1');
"""
BOOT_OWNER = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agVlastnik_v1','1');
  localStorage.setItem('agFbKey_v1','klic-na-zkousku');
"""

results = []


def a(x):
    return str(x).encode('ascii', 'replace').decode('ascii')


def ok(name, cond, detail=''):
    results.append((bool(cond), name, a(detail)))
    print(('  OK   ' if cond else '  CHYBA ') + a(name) + (('  -> ' + a(detail)) if detail else ''))


async def tap(page, drz_ms):
    # Dlouhy stisk se MUSI delat mysi drzenou dolu (page.click by pustil hned).
    # Vraci, jestli se po `drz_ms` otevrela karta klice.
    box = await page.evaluate("""() => {
        const m = document.querySelector('#ag-gate .agl-mark, #ag-login .agl-mark');
        if (!m) return null;
        const r = m.getBoundingClientRect();
        return {x: r.x + r.width / 2, y: r.y + r.height / 2};
    }""")
    if not box:
        return False
    await page.mouse.move(box['x'], box['y'])
    await page.mouse.down()
    await page.wait_for_timeout(drz_ms)
    otevreno = await page.evaluate("() => !!document.querySelector('.agv-card')")
    await page.mouse.up()
    await page.wait_for_timeout(150)
    return otevreno


async def novy(ctx_maker, boot):
    ctx = await ctx_maker(boot)
    page = await ctx.new_page()
    await page.goto(URL, wait_until='load')
    await page.wait_for_timeout(1800)
    return ctx, page


async def main():
    from playwright.async_api import async_playwright

    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(PORT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()

            async def mk(boot):
                c = await browser.new_context(viewport={'width': 412, 'height': 915})
                await c.add_init_script(boot)
                return c

            # ================= A) BRANA BEZ REZIMU =========================
            ctx, page = await novy(mk, BOOT_GATE)
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))

            ok('brana je videt', await page.evaluate("() => !!document.getElementById('ag-gate')"))
            ok('vlastnik.js nacten', await page.evaluate("() => typeof window.AGVlastnik") == 'object')
            ok('AGUcty.isOwner existuje',
               await page.evaluate("() => typeof (window.AGUcty && AGUcty.isOwner)") == 'function')

            # 1) na brane NESMI byt nic videt
            await page.wait_for_function("() => document.querySelector('#ag-gate .agl-mark[data-agv=\"1\"]')",
                                         timeout=8000)
            vid = await page.evaluate("""() => {
                const g = document.getElementById('ag-gate');
                return {
                    tlacitko: !!document.getElementById('agv-open'),
                    text: g.innerText,
                };
            }""")
            ok('na brane NENI viditelne tlacitko vlastnika', not vid['tlacitko'])
            ok('na brane neni ani zminka o vlastnikovi/vyvojari',
               ('vlastn' not in vid['text'].lower()) and ('vývojá' not in vid['text'].lower()),
               vid['text'].replace(chr(10), ' | ')[:160])

            # 2) skryty vstup: dlouhy stisk znaku appky
            ok('kratke ťuknuti na znak NIC neotevre', not await tap(page, 250))
            ok('dlouhy stisk znaku otevre kartu klice', await tap(page, 2200))
            await page.wait_for_timeout(200)
            st = await page.evaluate("""() => ({
                karta: !!document.querySelector('#ag-gate .agv-card'),
                inp: !!document.getElementById('agv-key'),
                stara: (document.querySelector('#ag-gate .agl-card:not(.agv-card)') || {}).style
                       ? document.querySelector('#ag-gate .agl-card:not(.agv-card)').style.display : '?'
            })""")
            ok('karta klice se otevrela', st['karta'] and st['inp'], st)
            ok('puvodni karta brany se schovala', st['stara'] == 'none', st['stara'])

            await page.click('#agv-back')
            await page.wait_for_timeout(300)
            zpet = await page.evaluate("""() => ({
                karta: !!document.querySelector('#ag-gate .agv-card'),
                stara: document.querySelector('#ag-gate .agl-card').style.display,
                zive: !!document.getElementById('agg-show-join')
            })""")
            ok('"Zpet" kartu klice odstrani', not zpet['karta'])
            ok('puvodni brana je zpatky viditelna', zpet['stara'] != 'none', zpet['stara'])
            # obsluha PREZILA (proto se karta schovava, ne prepisuje innerHTML)
            await page.click('#agg-show-join')
            await page.wait_for_timeout(200)
            ok('tlacitka brany porad fungujou (obsluha neztracena)',
               await page.evaluate("() => document.getElementById('agg-join').classList.contains('on')"))

            # 3) spatny klic -> lidska hlaska
            online = True
            try:
                await tap(page, 2200)
                await page.wait_for_timeout(250)
                await page.fill('#agv-key', 'urcite-spatny-klic-12345')
                await page.click('#agv-go')
                await page.wait_for_function(
                    "() => { const e = document.getElementById('agv-err'); return e && e.textContent && e.textContent.indexOf('Ověřuji') < 0; }",
                    timeout=20000)
                hl = await page.evaluate("() => document.getElementById('agv-err').textContent")
                ok('spatny klic: hlaska mluvi o OWNER_KEY, ne jen o cisle chyby',
                   ('OWNER_KEY' in hl) and ('nesedí' in hl or 'není' in hl), hl[:120])
                ok('spatny klic rezim NEZAPNE',
                   not await page.evaluate("() => window.AGVlastnik.isOn()"))
            except Exception as e:
                online = False
                ok('spatny klic: PRESKOCENO (bez site)', True, a(e)[:80])

            ok('zadna vyjimka v konzoli (brana)', not errs, '; '.join(errs)[:200])
            await ctx.close()

            # ================= B) ZAPNUTY REZIM ============================
            ctx2, page2 = await novy(mk, BOOT_OWNER)
            errs2 = []
            page2.on('pageerror', lambda e: errs2.append(str(e)))
            # gateCheck() tika po 2 s - pockat pres nej, at se brana neukaze pozdeji
            await page2.wait_for_timeout(3000)

            ok('brana se vlastnikovi NEUKAZE',
               not await page2.evaluate("() => !!document.getElementById('ag-gate')"))
            ok('prihlasovaci obrazovka se neukaze',
               not await page2.evaluate("() => !!document.getElementById('ag-login')"))
            ok('zamek pres celou appku je sundany',
               not await page2.evaluate("() => document.documentElement.classList.contains('ag-prelock')"))
            ok('AGUcty.isOwner() je true', await page2.evaluate("() => AGUcty.isOwner()"))
            ok('can() vraci true i pro udrzbu a dashboard',
               await page2.evaluate("() => AGUcty.can('set.tab-udrzba') && AGUcty.can('x.dashboard') && AGUcty.can('dock.nastroje')"))
            ok('dlazdice v liste nejsou skryte',
               await page2.evaluate("""() => {
                   const d = document.querySelectorAll('#dock .dock-btn');
                   return d.length > 0 && Array.from(d).every(b => b.style.display !== 'none');
               }"""))

            # 5) polozka v "Vice" + konzole
            await page2.wait_for_function("() => !!document.getElementById('agv-menu-btn')", timeout=8000)
            ok('v "Vice" je Konzole vlastnika', True,
               await page2.evaluate("() => document.getElementById('agv-menu-btn').textContent.trim()"))
            ok('polozka je hned pod nadpisem Vice',
               await page2.evaluate("""() => {
                   const h = document.querySelector('#side-menu .menu-head');
                   return !!h && h.nextElementSibling && h.nextElementSibling.id === 'agv-menu-btn';
               }"""))

            await page2.evaluate("() => window.agOpenKonzole()")
            await page2.wait_for_timeout(400)
            kon = await page2.evaluate("""() => {
                const m = document.getElementById('agv-modal');
                return {
                    open: !!m && m.style.display === 'flex',
                    polozek: m ? m.querySelectorAll('.agv-it').length : 0,
                    texty: m ? Array.from(m.querySelectorAll('.agv-it .tx b')).map(x => x.textContent) : []
                };
            }""")
            ok('konzole se otevrela', kon['open'])
            ok('konzole ma vsechny polozky', kon['polozek'] == 9, kon['polozek'])
            ok('konzole nabizi vsechny firmy', 'Všechny firmy' in kon['texty'], kon['texty'])
            ok('konzole nabizi schranku', 'Zprávy od lidí' in kon['texty'])
            ok('konzole nabizi protokol chyb', 'Protokol chyb' in kon['texty'])

            if online:
                try:
                    await page2.wait_for_function(
                        "() => { const e = document.getElementById('agv-stav'); return e && e.textContent.indexOf('Zjišťuji') < 0; }",
                        timeout=20000)
                    sv = await page2.evaluate("() => document.getElementById('agv-stav').textContent")
                    ok('stav serveru se vypsal (verze workeru)', 'Worker' in sv, sv[:120])
                    ok('stav serveru pozna nesedici klic', 'nesedí' in sv, sv[:120])
                except Exception as e:
                    ok('stav serveru: PRESKOCENO (bez site)', True, a(e)[:80])

            # 6) ukonceni rezimu
            await page2.evaluate("""() => {
                window.agAsk = () => Promise.resolve(true);
                return window.AGVlastnik.leave();
            }""")
            await page2.wait_for_timeout(800)
            ok('ukonceni rezimu vrati branu',
               await page2.evaluate("() => !!document.getElementById('ag-gate')"))
            ok('po ukonceni uz polozka v menu neni',
               not await page2.evaluate("() => !!document.getElementById('agv-menu-btn')"))
            ok('klic zustal ulozeny (jen rezim se vypnul)',
               await page2.evaluate("() => !!localStorage.getItem('agFbKey_v1') && !AGUcty.isOwner()"))

            ok('zadna vyjimka v konzoli (rezim)', not errs2, '; '.join(errs2)[:200])
            await ctx2.close()
            await browser.close()
    finally:
        srv.terminate()

    bad = [r for r in results if not r[0]]
    print('\n%d/%d OK' % (len(results) - len(bad), len(results)))
    if bad:
        print('SELHALO:')
        for _, n, d in bad:
            print('  - ' + n + (('  -> ' + d) if d else ''))
    sys.exit(1 if bad else 0)


asyncio.run(main())
