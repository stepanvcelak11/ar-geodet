# -*- coding: utf-8 -*-
u"""MASKOT TOTI (24. 9. 2026, na přání: maskot k učení jako Duolingo + nahrání vlastních hlášek).

Od 6. 10. 2026 je Toti JEN v Geo kartičkách („nech Totiho pouze ve výukových kartičkách“).
Kontroluje: Toti v rohu Geo kartiček, klepnutí = nabídka, kvíz se skóre, vysvětlení pojmu;
v Poznávačce, Cvičných úlohách, Odhadni to, Cestě učení ani na hlavní obrazovce NENÍ;
panel (jméno, ztlumit, nahrát soubor); parser souboru s hláškami; v angličtině mluví anglicky.

python scripts/test_maskot.py [port] [--shots DIR]
"""
import os
import sys
import json
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9059)
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


async def shot(page, jmeno):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        await page.screenshot(path=os.path.join(SHOTS, jmeno + '.png'))


async def otevri(page, k):
    await page.evaluate("() => { document.querySelectorAll('.modal-overlay').forEach(m => { if (m.id !== 'tools-modal' && getComputedStyle(m).display !== 'none') m.style.display = 'none'; }); const su = document.getElementById('agsu'); if (su) su.style.display = 'none'; }")
    await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
    await page.wait_for_timeout(800)
    await page.evaluate("(k) => { for (let i = 0; i < 3; i++) document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click()); const r = document.querySelector('#tools-modal .ag-uk-i[data-k=\"' + k + '\"]'); if (r) { r.scrollIntoView(); r.click(); } }", k)
    await page.wait_for_timeout(2200)


VIDITELNY = """(sel) => { const e = [...document.querySelectorAll(sel)].find(x => x.getClientRects().length); if (!e) return null;
  const r = e.getBoundingClientRect(); return { txt: (e.querySelector('.mk-text') || {}).textContent || '', cls: e.className, w: r.width, h: r.height, x: r.left, y: r.top, b: r.bottom, r: r.right }; }"""


async def beh(url, lang):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ' if lang == 'cs' else 'en-GB', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        init = boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');"
        if lang != 'cs':
            init += "localStorage.setItem('agJazyk_v1','%s'); localStorage.setItem('agLang','%s');" % (lang, lang)
        await page.add_init_script(init)
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        await V.cekej(page, "document.body.classList.contains('app-started')", 60)
        # maskot je ag/lazy — na vytíženém stroji se fronta rozjede až po desítkách sekund; počkat na něj
        await page.evaluate("() => new Promise(r => AGLazy.need('js/maskot.js', r))")
        await V.cekej(page, "!!window.AGMaskot", 120)

        if lang == 'cs':
            # ---- parser ----
            await page.evaluate("() => new Promise(r => AGLazy.need('js/maskot.js', r))")
            p1 = await page.evaluate("""() => AGMaskot._test.rozparsuj('# komentář\\n[spravne]\\nTrefa!\\nBingo {jmeno}\\n\\nspatne: Vedle.\\n[neznama]\\nNěco\\nBez kategorie')""")
            ok('P1 text: [kategorie], „kat: text“, komentář, neznámá kategorie → tip', p1 == {'spravne': ['Trefa!', 'Bingo {jmeno}'], 'spatne': ['Vedle.'], 'tip': ['Něco', 'Bez kategorie']}, p1)
            p2 = await page.evaluate("""() => AGMaskot._test.rozparsuj('{"uvod":["Ahoj"],"spravne":"Jo"}')""")
            ok('P2 JSON objekt i s jednou hláškou místo pole', p2 == {'uvod': ['Ahoj'], 'spravne': ['Jo']}, p2)
            p3 = await page.evaluate("() => { const v = AGMaskot._test.vzor(); const h = AGMaskot._test.rozparsuj(v); return AGMaskot._test.KAT.every(k => (h[k] || []).length > 0); }")
            ok('P3 stažený vzor se dá nahrát zpátky (všechny kategorie)', p3)

        # ---- TOTI JEN V GEO KARTIČKÁCH (6. 10. 2026) ----
        await otevri(page, 'scroll-uceni')
        ok('G1 [%s] Geo kartičky: Toti v rohu s úvodní hláškou' % lang, await V.cekej(page, "(() => { const m = document.querySelector('#agsu .ag-maskot.mk-roh'); return m && m.getClientRects().length && (m.querySelector('.mk-text').textContent || '').length > 5; })()", 40))
        await page.wait_for_timeout(1500)
        g0 = await page.evaluate(VIDITELNY, '#agsu .ag-maskot.mk-roh')
        await shot(page, lang + '_karticky')
        ok('G2 [%s] Toti celý na obrazovce (vlevo dole)' % lang, g0 and g0['x'] >= 0 and g0['r'] <= 393 and g0['b'] <= 852, g0)
        await page.evaluate("() => document.querySelector('#agsu .ag-maskot.mk-roh .mk-btn').click()")
        await page.wait_for_timeout(600)
        menu = await page.evaluate("() => [...document.querySelectorAll('#agsu .ag-maskot .mk-akce button')].map(b => b.textContent)")
        await shot(page, lang + '_karticky_menu')
        if lang == 'cs':
            ok('G3 klepnutí = nabídka Zeptej se mě / Vysvětli pojem / Poraď / Lekce / ⋯', menu[:4] == ['Zeptej se mě', 'Vysvětli pojem', 'Poraď', 'Lekce'], menu)
        else:
            ok('G3 [en] nabídka anglicky', len(menu) >= 4 and not any(__import__('re').search('[ěščřžýůďťň]', m) for m in menu), menu)
        await page.evaluate("() => document.querySelector('#agsu .ag-maskot .mk-akce button').click()")
        await page.wait_for_timeout(2500)
        q = await page.evaluate("() => ({ t: document.querySelector('#agsu .ag-maskot .mk-text').textContent, m: [...document.querySelectorAll('#agsu .ag-maskot .mk-akce button')].map(b => b.textContent) })")
        await shot(page, lang + '_karticky_kviz')
        ok('G4 [%s] kvíz: otázka z definice pojmu + 3 možnosti' % lang, len(q['m']) == 3 and len(q['t']) > 20, q)
        await page.evaluate("() => document.querySelector('#agsu .ag-maskot .mk-akce button').click()")
        await page.wait_for_timeout(1500)
        po = await page.evaluate("() => ({ cls: document.querySelector('#agsu .ag-maskot').className, sk: (document.querySelector('#agsu .ag-maskot .mk-skore') || {}).textContent || '', n: document.querySelectorAll('#agsu .ag-maskot .mk-akce button').length })")
        ok('G5 [%s] odpověď: nálada + skóre kvízu + další tlačítka' % lang, ('mk-radost' in po['cls'] or 'mk-smutek' in po['cls']) and '/ 1' in po['sk'] and po['n'] >= 2, po)
        if lang == 'en':
            cz = await page.evaluate("() => /[ěščřžýůďťň]/i.test(document.querySelector('#agsu .ag-maskot .mk-text').textContent)")
            ok('G6 [en] Toti mluví anglicky', not cz)
        await page.evaluate("() => AGMaskot.vysvetli()")
        await page.wait_for_timeout(2500)
        vy = await page.evaluate("() => ({ t: document.querySelector('#agsu .ag-maskot .mk-text').textContent, n: document.querySelectorAll('#agsu .ag-maskot .mk-akce button').length })")
        ok('G7 [%s] Vysvětli pojem: pojem s definicí + další tlačítka' % lang, ':' in vy['t'] and len(vy['t']) > 40 and vy['n'] == 2, vy)

        # ---- JINDE UŽ TOTI NENÍ ----
        for k, sel, nm in [('poznavacka', '#ag-pz-modal', 'N1'), ('cvicne-ulohy', '#ag-ul-modal', 'N2'), ('odhadovacka', '#odhad-modal', 'N3'), ('cesta-uceni', '#ag-cu', 'N4')]:
            await otevri(page, k)
            await page.wait_for_timeout(1500)
            st = await page.evaluate("(sel) => { const m = document.querySelector(sel); return { okno: !!(m && m.getClientRects().length), toti: !!(m && m.querySelector('.ag-maskot')) }; }", sel)
            ok('%s [%s] %s bez Totiho (okno otevřené)' % (nm, lang, k), st['okno'] and not st['toti'], st)
        await page.evaluate("() => { document.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; m.classList.remove('ag-open'); }); ['agsu', 'ag-cu'].forEach(i => { const e = document.getElementById(i); if (e) e.style.display = 'none'; }); }")
        await page.wait_for_timeout(2500)
        ok('N5 [%s] na hlavní obrazovce žádný plovoucí Toti' % lang, await page.evaluate("() => !document.getElementById('ag-maskot-plovak') && ![...document.querySelectorAll('.ag-maskot')].some(m => m.getClientRects().length)"))

        if lang == 'cs':
            # ---- panel (z Geo kartiček) ----
            await otevri(page, 'scroll-uceni')
            await V.cekej(page, "!!document.querySelector('#agsu .ag-maskot.mk-roh')", 20)
            await page.evaluate("() => AGMaskot.nastaveni()")
            await page.wait_for_timeout(500)
            await shot(page, 'cs_panel')
            ok('C1 panel maskota je NAVRCHU (klik doprostřed tlačítka trefí panel)', await page.evaluate("() => { const b = document.querySelector('#ag-mk-panel button[data-k=nahrat]'); if (!b) return false; const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b; }"))
            ok('C1b panel už nenabízí Totiho na hlavní obrazovce ani upovídanost', await page.evaluate("() => !document.querySelector('#ag-mk-panel [data-k=spolecnik], #ag-mk-panel [data-k=ukecanost]')"))
            await page.fill('#ag-mk-panel input[data-k=jmeno]', 'Laserka')
            # nahrání souboru přes skutečný <input type=file>
            async with page.expect_file_chooser() as fc:
                await page.evaluate("() => document.querySelector('#ag-mk-panel button[data-k=nahrat]').click()")
            ch = await fc.value
            await ch.set_files(files=[{'name': 'hlasky.txt', 'mimeType': 'text/plain', 'buffer': '[uvod]\nJsem {jmeno} a měřím!\n[spravne]\nMoje vlastní trefa!\n'.encode('utf-8')}])
            await page.wait_for_timeout(700)
            st = await page.evaluate("() => document.querySelector('#ag-mk-panel .mkp-stav').textContent")
            ok('C2 nahraný soubor: „Nahráno hlášek: 2“', '2' in st, st)
            await page.evaluate("() => document.querySelector('#ag-mk-panel input[data-k=jen]').click()")
            await page.evaluate("() => document.querySelector('#ag-mk-panel button[data-k=zavrit]').click()")
            await page.evaluate("() => AGMaskot.rekni('spravne')")
            await page.wait_for_timeout(2500)
            m3 = await page.evaluate(VIDITELNY, '#agsu .ag-maskot')
            jm = await page.evaluate("() => document.querySelector('#agsu .mk-jmeno').textContent")
            ok('C3 „jen moje hlášky“ + nové jméno: řekne vlastní hlášku, jmenuje se Laserka', m3 and m3['txt'] == 'Moje vlastní trefa!' and jm == 'Laserka', (m3, jm))
            await page.evaluate("() => AGMaskot.nastaveni()")
            await page.evaluate("() => document.querySelector('#ag-mk-panel input[data-k=zap]').click()")
            await page.evaluate("() => document.querySelector('#ag-mk-panel button[data-k=zavrit]').click()")
            m4 = await page.evaluate(VIDITELNY, '#agsu .ag-maskot')
            ok('C4 ztlumený maskot: jen malá ikonka bez bubliny', m4 and 'mk-off' in m4['cls'] and m4['h'] < 50, m4)
            ulozeno = await page.evaluate("() => JSON.parse(localStorage.getItem('agMaskot_v1'))")
            ok('C5 nastavení uložené (jméno, vypnuto, vlastní hlášky)', ulozeno.get('jmeno') == 'Laserka' and ulozeno.get('zap') is False and ulozeno.get('vlastni', {}).get('spravne') == ['Moje vlastní trefa!'], ulozeno)
        ok('Z [%s] bez chyb v konzoli' % lang, not chyby, chyby[:5])
        await ctx.close()
        await br.close()


def main():
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server nenastartoval'); sys.exit(1)
    try:
        asyncio.run(beh(url, 'cs'))
        asyncio.run(beh(url, 'en'))
    finally:
        srv.terminate()
    n = len(VYSLEDKY); d = sum(VYSLEDKY)
    print('\n%d/%d OK' % (d, n))
    sys.exit(0 if d == n else 1)


if __name__ == '__main__':
    main()
