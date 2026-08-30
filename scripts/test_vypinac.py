#!/usr/bin/env python3
# ===== AR Geodet - VYPINAC MODULU, CHYBY OD LIDI, ZEBRICEK NASTROJU ============
# Overuje v Chromiu tri veci, ktere se pridaly 30. 8. 2026:
#   A) js/priznaky.js  - vypnuty nastroj se NEZAREGISTRUJE a vypnuty lazy modul
#                        se VUBEC NESTAHNE (a lazy fronta u nej nezustane viset)
#   B) js/vlastnik.js  - tri nove pohledy konzole (vypinac / chyby / zebricek)
#   C) js/err-log.js   - odesilani chyb existuje a bez cloudove firmy MLCI
#
# PROC PRAVE TAKHLE: staticky se neda poznat, ze zablokovany lazy modul zasekne
# `AGLazy.need` (callback by se nikdy nespustil a nastroj by se tvaril, ze se
# porad nacita), ani ze se pohled konzole vykresli prazdny. Server se NEVOLA -
# fetch je podvrzeny, takze test nezavisi na siti ani na spravnem OWNER_KEY.
#
# Pouziti:  python scripts/test_vypinac.py [port]     (vychozi 8161)
# ==============================================================================
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8161
URL = 'http://127.0.0.1:%d/index.html' % PORT

# Podvrzene odpovedi serveru. Klic /owner/* je jedno jaky - fetch se k siti
# vubec nedostane.
FAKE = {
    'firms': {'firms': [], 'requests': [], 'days': [], 'notice': None,
              'flags': {'off': ['brutal-gps', 'js/trenazer.js'], 'ts': 1}},
    'errors': {'dni': 14, 'total': 41, 'rows': [
        {'sig': 'a', 'msg': 'map.on is not a function', 'src': 'js/grafika.js', 'line': 812,
         'n': 33, 'firms': 3, 'last': 1788000000000, 'ver': 'v265'},
        {'sig': 'b', 'msg': 'filters is not defined', 'src': 'js/logika.js', 'line': 4110,
         'n': 8, 'firms': 1, 'last': 1787900000000, 'ver': 'v264'}]},
    'usage': {'dni': 30, 'firms': 4, 'lidi': 9, 'rows': [
        {'k': 'brutal-gps', 'n': 240, 'firms': 4, 'lidi': 9, 'last': 1788000000000},
        {'k': 'kompas', 'n': 60, 'firms': 2, 'lidi': 3, 'last': 1788000000000}]},
}

BOOT = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agVlastnik_v1','1');
  localStorage.setItem('agFbKey_v1','klic-na-zkousku');
  localStorage.setItem('agPriznaky_v1', JSON.stringify({off:['brutal-gps','js/trenazer.js'], ts:1}));
  window.__put = [];
  (function () {
    var FAKE = __FAKE__;
    var orig = window.fetch.bind(window);
    window.fetch = function (u, o) {
      var s = String((u && u.url) || u || '');
      function od(x) {
        return Promise.resolve(new Response(JSON.stringify(x), {
          status: 200, headers: {'Content-Type': 'application/json'} }));
      }
      if (s.indexOf('/owner/flags') >= 0) {
        try { window.__put.push(JSON.parse((o && o.body) || '{}')); } catch (e) { window.__put.push(null); }
        return od({ok: true});
      }
      if (s.indexOf('/owner/errors') >= 0) return od(FAKE.errors);
      if (s.indexOf('/owner/usage') >= 0) return od(FAKE.usage);
      if (s.indexOf('/owner/firms') >= 0) return od(FAKE.firms);
      if (s.indexOf('/health') >= 0) return od({ok: true, v: 9, owner: true, fb: true, flags: true, errors: true});
      return orig(u, o);
    };
  })();
"""

results = []


def a(x):
    return str(x).encode('ascii', 'replace').decode('ascii')


def ok(name, cond, detail=''):
    results.append((bool(cond), name, a(detail)))
    print(('  OK   ' if cond else '  CHYBA ') + a(name) + (('  -> ' + a(detail)) if detail else ''))


async def main():
    from playwright.async_api import async_playwright

    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(PORT)],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(URL, timeout=1).read(64)
            break
        except Exception:
            time.sleep(0.5)
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            ctx = await browser.new_context(viewport={'width': 412, 'height': 915})
            await ctx.add_init_script(BOOT.replace('__FAKE__', json.dumps(FAKE)))
            page = await ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e) + ' || ' + str(getattr(e, 'stack', ''))[:400]))
            await page.goto(URL, wait_until='load')
            await page.wait_for_timeout(2500)
            # #welcome-screen chyta kliky pres celou obrazovku - bez jeho zavreni
            # by kazdy page.click() skoncil na "intercepts pointer events".
            await page.evaluate("() => { if (typeof window.startAppFromWelcome === 'function') startAppFromWelcome(); }")
            await page.wait_for_timeout(1500)

            # ================= A) VYPINAC OPRAVDU VYPINA ====================
            ok('priznaky.js nacten', await page.evaluate("() => typeof window.AGFlags") == 'object')
            m = await page.evaluate("""() => ({
                tool: AGFlags.off('brutal-gps'),
                soubor: AGFlags.off('js/trenazer.js'),
                tecka: AGFlags.off('./js/trenazer.js'),
                jiny: AGFlags.off('js/kompas-check.js'),
                kratke: AGFlags.off('gps')
            })""")
            ok('vypnuty nastroj je poznat', m['tool'])
            ok('vypnuty soubor je poznat i s ./ na zacatku', m['soubor'] and m['tecka'], m)
            ok('nevypnuty soubor projde', not m['jiny'])
            ok('castecna shoda NEVYPINA (kratke id by vyplo pul appky)', not m['kratke'])

            # lazy modul se opravdu nestahl
            await page.evaluate("() => window.AGLazy && AGLazy.flush()")
            await page.wait_for_timeout(1200)
            skr = await page.evaluate("""() => ({
                trenazer: !!document.querySelector('script[src*="trenazer"]'),
                jiny: !!document.querySelector('script[src*="kalkulacka"]')
            })""")
            ok('vypnuty lazy modul se NESTAHL', not skr['trenazer'])
            ok('ostatni lazy moduly se stahly dal', skr['jiny'])

            # need() na vypnutem modulu nesmi zustat viset
            cb = await page.evaluate("""() => new Promise(res => {
                let hotovo = false;
                AGLazy.need('js/trenazer.js', () => { hotovo = true; res('zavolano'); });
                setTimeout(() => res(hotovo ? 'zavolano' : 'VISI'), 2500);
            })""")
            ok('AGLazy.need na vypnutem modulu callback spusti (nezasekne se)', cb == 'zavolano', cb)

            # vypnuty nastroj se nesmi dostat ani do mrizky Nastroju
            reg = await page.evaluate("""() => {
                const f = () => {};
                window.agRegisterFieldTool({id: 'brutal-gps', label: 'Vypnuty', onClick: f, cat: 'Pomůcky'});
                window.agRegisterFieldTool({id: 'zkouska-zapnuta', label: 'Zapnuty', onClick: f, cat: 'Pomůcky'});
                if (typeof window.agFtSyncTiles === 'function') agFtSyncTiles();
                return {
                    vypnuty: !!document.querySelector('[data-tool="brutal-gps"]'),
                    zapnuty: !!document.querySelector('[data-tool="zkouska-zapnuta"]')
                };
            }""")
            kdo = await page.evaluate("""() => {
                const el = document.querySelector('[data-tool="brutal-gps"]');
                if (!el) return 'neni';
                return el.tagName + ' class=' + el.className + ' parent=' + (el.parentElement && el.parentElement.className);
            }""")
            ok('vypnuty nastroj NEMA dlazdici', not reg['vypnuty'], str(reg) + ' :: ' + str(kdo))
            ok('nevypnuty nastroj dlazdici ma', reg['zapnuty'], reg)

            # ================= B) POHLEDY KONZOLE ==========================
            await page.evaluate("() => window.agOpenKonzole()")
            await page.wait_for_timeout(400)

            # --- vypinac
            await page.evaluate("""() => {
                const b = Array.from(document.querySelectorAll('#agv-modal .agv-it'))
                    .find(x => x.textContent.indexOf('Vypínač') >= 0);
                b.click();
            }""")
            await page.wait_for_timeout(900)
            fl = await page.evaluate("""() => ({
                nadpis: (document.querySelector('#agv-modal .agv-h2') || {}).textContent || '',
                radky: document.querySelectorAll('#agv-modal .agv-row').length,
                zaskrtnute: document.querySelectorAll('#agv-modal .agv-row input:checked').length,
                zpet: !!document.getElementById('agv-zpet'),
                pole: !!document.getElementById('agv-add')
            })""")
            ok('pohled vypinace se vykreslil', 'Vypínač' in fl['nadpis'], fl['nadpis'])
            ok('vypinac nabizi nastroje z registru', fl['radky'] > 20, fl['radky'])
            ok('vypinac ukazuje, co uz je vypnute', fl['zaskrtnute'] == 2, fl['zaskrtnute'])
            ok('vypinac ma pole na rucni zadani', fl['pole'])

            # rucne pridat soubor a ulozit -> co se posle na server
            await page.evaluate("""() => {
                document.getElementById('agv-add').value = 'js/odhadovacka.js';
                document.getElementById('agv-addb').click();
            }""")
            await page.wait_for_timeout(400)
            await page.evaluate("() => document.getElementById('agv-save').click()")
            await page.wait_for_timeout(700)
            put = await page.evaluate("() => window.__put")
            poslano = (put[-1] or {}).get('off', []) if put else []
            ok('ulozeni posle na server cely seznam', sorted(poslano) == sorted(
                ['brutal-gps', 'js/trenazer.js', 'js/odhadovacka.js']), poslano)
            ok('ucinek je hned i v tomhle telefonu',
               await page.evaluate("() => AGFlags.off('js/odhadovacka.js')"))

            # zavrit hlasku a vratit se
            await page.evaluate("""() => {
                document.querySelectorAll('.modal-overlay').forEach(m => {
                    if (m.id !== 'agv-modal') m.style.display = 'none';
                });
            }""")

            # --- chyby
            await page.evaluate("() => { window.AGVlastnik.close(); window.agOpenKonzole(); }")
            await page.wait_for_timeout(400)
            await page.evaluate("""() => {
                Array.from(document.querySelectorAll('#agv-modal .agv-it'))
                    .find(x => x.textContent.indexOf('Chyby od lidí') >= 0).click();
            }""")
            await page.wait_for_timeout(900)
            er = await page.evaluate("""() => ({
                nadpis: (document.querySelector('#agv-modal .agv-h2') || {}).textContent || '',
                radky: document.querySelectorAll('#agv-modal .agv-err').length,
                prvni: (document.querySelector('#agv-modal .agv-err .ms') || {}).textContent || '',
                pocet: (document.querySelector('#agv-modal .agv-err .hd b') || {}).textContent || '',
                firmy: !!document.querySelector('#agv-modal .agv-err .fm'),
                filtr: document.querySelectorAll('#agv-modal [data-dni]').length
            })""")
            ok('pohled chyb se vykreslil', 'Chyby' in er['nadpis'], er['nadpis'])
            ok('chyby se vypsaly', er['radky'] == 2, er['radky'])
            ok('nejcastejsi chyba je prvni', er['pocet'] == '33x'.replace('x', '×'), er['pocet'])
            ok('chyba ukazuje hlasku', 'map.on' in er['prvni'], er['prvni'])
            ok('chyba napric firmami ma odznak', er['firmy'])
            ok('jde prepnout obdobi', er['filtr'] == 4, er['filtr'])

            # --- zebricek
            # kliky pres evaluate: nad konzoli muze viset dialog z predchoziho kroku
            # a Playwright by cekal na "element receives pointer events" az do timeoutu
            await page.evaluate("() => document.getElementById('agv-zpet').click()")
            await page.wait_for_timeout(400)
            await page.evaluate("""() => {
                Array.from(document.querySelectorAll('#agv-modal .agv-it'))
                    .find(x => x.textContent.indexOf('doopravdy') >= 0).click();
            }""")
            await page.wait_for_timeout(900)
            us = await page.evaluate("""() => {
                const t = document.getElementById('agv-body').textContent;
                return {
                    nadpis: (document.querySelector('#agv-modal .agv-h2') || {}).textContent || '',
                    bary: document.querySelectorAll('#agv-modal .agv-bar').length,
                    nikdo: t.indexOf('Neotevřel nikdo') >= 0,
                    shrnuti: t.indexOf('4 firem') >= 0 && t.indexOf('9 lidí') >= 0
                };
            }""")
            ok('pohled zebricku se vykreslil', 'doopravdy' in us['nadpis'], us['nadpis'])
            ok('zebricek ma pruhy', us['bary'] == 2, us['bary'])
            ok('zebricek shrnuje firmy a lidi', us['shrnuti'])
            ok('zebricek vypisuje i nepouzite nastroje', us['nikdo'])

            # ================= C) ODESILANI CHYB ============================
            snd = await page.evaluate("""() => ({
                api: typeof (window.agErrLog && window.agErrLog.send),
                razitko: localStorage.getItem('agErrSent_v1')
            })""")
            ok('err-log umi odeslat', snd['api'] == 'function', snd['api'])
            # bez cloudove firmy se nesmi nic poslat (a hlavne to nesmi spadnout)
            posl = await page.evaluate("""() => {
                const pred = window.__put.length;
                window.agErrLog.record('zkouska odeslani');
                window.agErrLog.send();
                return window.__put.length - pred;
            }""")
            ok('bez cloudove firmy odesilani MLCI', posl == 0, posl)

            ok('zadna vyjimka v konzoli', not errs, '; '.join(errs)[:200])
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
