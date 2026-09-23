# -*- coding: utf-8 -*-
u"""Body z fotky (23. 9. 2026, v386, n8): „z fotky se zapíše jen jeden bod, i když je jich víc;
přidat výběr z galerie; OCR přepisuje špatně“.

Hlídá (bez sítě — samotné OCR = Tesseract z CDN se tu nespouští, textové výstupy jsou podstrčené):
  P*  rozbor textu: tabulka 6 bodů, záměny O/l/S/B v číslech, ztracená desetinná tečka,
      „596 956,46“, štítek přes víc řádků (Bod / Y: / X: / Z:), hlavička tabulky se nebere,
      čísla bodů „3B“ se nepřepisují, neúplný řádek (jen Y) se nezahodí
  U1  dlaždice „Z fotky“ otevře volbu Vyfotit / Z galerie
  U2  Vyfotit = input s capture, Z galerie = input BEZ capture a s multiple
  U3  #ocr-file (záloha) už nemá capture → iPhone nabídne i galerii
  R*  přehled: řádky, fotka, značky „k ověření“, tlačítko Uložit N bodů, uložení přes
      addImportedPoints (původ foto-ocr), výřez iPhonu (nic pod Dynamic Islandem)
Živé OCR na syntetických fotkách: AG_OCR_ZIVE=1 python scripts/test_foto_body.py (potřebuje síť).

python scripts/test_foto_body.py [port]
"""
import io
import os
import re
import sys
import json
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = V.ROOT
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9047)
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:500]))


TABULKA = u"""Seznam souřadnic S-JTSK
Číslo      Y            X            Z
4001   743215.42   1042118.37   245.31
4002   743298.10   1042071.55   244.87
4003   743350.86   1O42133.02   246.02
4004   743301.77   1042190.64
4005   743240,05   1042202,19   245,66
4006   743188.93   1042160.71   245.12"""


async def beh(url):
    chyby = []
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': 49.9, 'longitude': 14.2, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ');")
        cdp = await ctx.new_cdp_session(page)
        await cdp.send('Emulation.setSafeAreaInsetsOverride', {'insets': {'top': 59, 'bottom': 34, 'left': 0, 'right': 0}})
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        ok('A0 appka nastartovala', await V.cekej(page, "document.body.classList.contains('app-started')", 40))
        await page.evaluate("() => new Promise(r => AGLazy.need('js/foto-body.js', r))")
        ok('A1 modul AGFotoBody', await page.evaluate("() => !!(window.AGFotoBody && AGFotoBody.open)"))

        # ---------------- P) rozbor textu
        r = await page.evaluate("(t) => AGFotoBody._test.textNaBody(t)", TABULKA)
        ok('P1 tabulka: 6 bodů (hlavička se nebere)', len(r) == 6, [(b['name'], b['y'], b['x']) for b in r])
        b3 = next((b for b in r if b['name'] == '4003'), {})
        ok('P2 „1O42133.02“ (písmeno O) → 1042133.02', b3.get('x') == 1042133.02, b3)
        b5 = next((b for b in r if b['name'] == '4005'), {})
        ok('P3 desetinná čárka „743240,05“ + Z 245,66', b5.get('y') == 743240.05 and b5.get('z') == 245.66, b5)
        b4 = next((b for b in r if b['name'] == '4004'), {})
        ok('P4 řádek bez Z → z null', b4.get('z') is None and b4.get('x') == 1042190.64, b4)
        r = await page.evaluate("() => AGFotoBody._test.textNaBody('12  74321542  104211837  245.31')")
        ok('P5 ztracená desetinná tečka 74321542 → 743215.42 (+ poznámka)', len(r) == 1 and abs(r[0]['y'] - 743215.42) < 1e-6 and abs(r[0]['x'] - 1042118.37) < 1e-6 and r[0]['opravy'], r)
        r = await page.evaluate("() => AGFotoBody._test.textNaBody('7  743 215,42  1 042 118,37')")
        ok('P6 tisíce s mezerou „743 215,42“ „1 042 118,37“', len(r) == 1 and r[0]['y'] == 743215.42 and r[0]['x'] == 1042118.37, r)
        r = await page.evaluate("() => AGFotoBody._test.textNaBody('Bod č. 4002\\nY: 743 298,10\\nX: 1 042 071,55\\nZ: 244,87')")
        ok('P7 štítek přes 4 řádky (Bod / Y: / X: / Z:)', len(r) == 1 and r[0]['name'] == '4002' and r[0]['y'] == 743298.1 and r[0]['x'] == 1042071.55 and r[0]['z'] == 244.87, r)
        r = await page.evaluate("() => AGFotoBody._test.textNaBody('3B  743215.42  1042118.37\\nl2A 743298.1O 1042071.55')")
        ok('P8 čísla bodů „3B“ se nepřepisují, v souřadnici „743298.1O“ → .10', len(r) == 2 and r[0]['name'] == '3B' and r[1]['y'] == 743298.1, r)
        r = await page.evaluate("() => AGFotoBody._test.textNaBody('4001  743215.42  1O4/2118.37\\n4002  743298.10  1042071.55')")
        ok('P9 neúplný řádek (jen Y) se nezahodí → neuplny', len(r) == 2 and r[0].get('neuplny') and r[0]['y'] == 743215.42 and r[1]['name'] == '4002', r)
        r = await page.evaluate("() => AGFotoBody._test.textNaBody('Zakázka Horní Počernice 2026\\nstrana 1/3')")
        ok('P10 text bez souřadnic → 0 bodů', r == [], r)

        # ---------------- U) volba zdroje
        await page.evaluate("() => openNewPointModal()")
        await page.wait_for_timeout(900)
        await page.evaluate("() => { const b = [...document.querySelectorAll('#custom-create-helpers button')].find(x => /Z fotky/.test(x.textContent)); b && b.click(); }")
        await page.wait_for_timeout(700)
        u1 = await page.evaluate("() => { const v = document.getElementById('ag-fb-volba'); return v ? [...v.querySelectorAll('button')].map(b => b.textContent.trim()) : null; }")
        ok('U1 dlaždice „Z fotky“ → volba Vyfotit / Z galerie', u1 and any('Vyfotit' in x for x in u1) and any('galerie' in x for x in u1), u1)
        # Z galerie: zachytit vznikající input (click() by otevřel dialog souboru)
        inp = await page.evaluate("""() => new Promise(res => {
            const orig = HTMLInputElement.prototype.click;
            HTMLInputElement.prototype.click = function () { HTMLInputElement.prototype.click = orig; res({ cap: this.getAttribute('capture'), multi: this.multiple, accept: this.accept }); };
            document.querySelector('#ag-fb-volba [data-k=galerie]').click();
        })""")
        ok('U2 Z galerie: bez capture, multiple, jen obrázky', inp['cap'] is None and inp['multi'] and inp['accept'] == 'image/*', inp)
        await page.evaluate("() => AGFotoBody.open()")
        await page.wait_for_timeout(300)
        inp2 = await page.evaluate("""() => new Promise(res => {
            const orig = HTMLInputElement.prototype.click;
            HTMLInputElement.prototype.click = function () { HTMLInputElement.prototype.click = orig; res({ cap: this.getAttribute('capture'), multi: this.multiple }); };
            document.querySelector('#ag-fb-volba [data-k=foto]').click();
        })""")
        ok('U2b Vyfotit: capture=environment', inp2['cap'] == 'environment' and not inp2['multi'], inp2)
        ok('U3 záložní #ocr-file bez capture (iPhone nabídne i galerii)', await page.evaluate("() => !document.getElementById('ocr-file').hasAttribute('capture')"))
        await page.evaluate("() => { document.querySelectorAll('input[type=file]').forEach(i => { if (!i.id) i.remove(); }); closeCustomModal(); }")

        # ---------------- R) přehled s podstrčenými body
        n0 = await page.evaluate("() => persistentCustomPoints.length")
        await page.evaluate("""() => {
            const c = document.createElement('canvas'); c.width = 800; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#f5f4ee'; x.fillRect(0, 0, 800, 400);
            const body = AGFotoBody._test.textNaBody('4001 743215.42 1042118.37 245.31\\n4002 743298.10 1042071.55\\n4003 743350.86 1048133.02\\n4004 743301.77 1042190.64');
            body.forEach((b, i) => { b.foto = 0; b.bbox = { x0: 20, y0: 20 + i * 60, x1: 700, y1: 60 + i * 60 }; b.jistota = 'ok'; });
            body[1].jistota = 'neshoda'; body[1].alt = { name: '4002', y: 743298.16, x: 1042071.55 };
            body[2].odlehly = 5.9;
            AGFotoBody._test.prehled(body, [c], ['text']);
        }""")
        await page.wait_for_timeout(500)
        rr = await page.evaluate("""() => { const o = document.getElementById('ag-fb'); if (!o) return null;
            const h = o.querySelector('.fb-head').getBoundingClientRect();
            return { radky: o.querySelectorAll('.fb-row').length, save: o.querySelector('.fb-save').textContent, znacky: [...o.querySelectorAll('.fb-z span')].map(s => s.textContent),
                     head: Math.round(h.top), canvas: o.querySelector('canvas').width }; }""")
        ok('R1 přehled: 4 řádky, fotka vykreslená', rr and rr['radky'] == 4 and rr['canvas'] > 0, rr)
        ok('R2 značky: neshoda dvou pokusů + „daleko od ostatních“', rr and any('liší' in z for z in rr['znacky']) and any('daleko od ostatních' in z for z in rr['znacky']), rr and rr['znacky'])
        ok('R3 hlavička pod výřezem iPhonu (≥ 59 px)', rr and rr['head'] >= 59, rr)
        ok('R4 tlačítko „Uložit bodů: 4“', rr and '4' in rr['save'], rr)
        # odškrtnout odlehlý bod a opravit Y u 4001
        await page.evaluate("""() => { const rows = document.querySelectorAll('#ag-fb .fb-row');
            const cb = rows[2].querySelector('input[type=checkbox]'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
            const y = rows[0].querySelector('input[data-k=y]'); y.value = '743215.40'; y.dispatchEvent(new Event('change', { bubbles: true })); }""")
        ok('R5 odškrtnutí → „Uložit bodů: 3“', '3' in await page.evaluate("() => document.querySelector('#ag-fb .fb-save').textContent"))
        await page.screenshot(path=os.path.join(os.environ.get('AG_SHOTS', os.path.dirname(os.path.abspath(__file__))), '_foto_body_prehled.png')) if os.environ.get('AG_SHOTS') else None
        await page.evaluate("() => document.querySelector('#ag-fb .fb-save').click()")
        await page.wait_for_timeout(600)
        po = await page.evaluate("""(n0) => ({ n: persistentCustomPoints.length - n0, zavreno: !document.getElementById('ag-fb'),
            body: persistentCustomPoints.slice(n0).map(p => ({ name: p.name, origin: p.prov && p.prov.origin, v: p.vyska, y: agMistni(p.lat, p.lng).y })) })""", n0)
        ok('R6 uloženo 3 body, přehled zavřený', po['n'] == 3 and po['zavreno'], po)
        ok('R7 původ foto-ocr, opravené Y 743215.40, výška 245.31', all(b['origin'] == 'foto-ocr' for b in po['body']) and abs(po['body'][0]['y'] - 743215.40) < 0.01 and po['body'][0]['v'] == 245.31, po['body'])

        # ---------------- živé OCR (volitelně)
        if os.environ.get('AG_OCR_ZIVE'):
            d = os.environ.get('AG_OCR_DIR')
            if d:
                import base64, glob
                for f in sorted(glob.glob(os.path.join(d, '*.jpg'))):
                    src = 'data:image/jpeg;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
                    body = await page.evaluate("""async (src) => { const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
                        const r = await AGFotoBody._test.prectiFotku(img, 'test'); return r.body.filter(b => !b.neuplny).length; }""", src)
                    print('      živě', os.path.basename(f), body, 'bodů')

        # ---------------- N) dlaždice v Nástrojích
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(1500)
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(600)
        await page.evaluate("() => { for (let i = 0; i < 3; i++) document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click()); }")
        n1 = await page.evaluate("() => { const r = document.querySelector('#tools-modal .ag-uk-i[data-k=\"body-z-fotky\"]'); if (!r) return null; r.scrollIntoView(); r.click(); return (r.textContent || '').trim().slice(0, 80); }")
        await page.wait_for_timeout(600)
        ok('N1 Nástroje → Body z fotky otevře volbu Vyfotit / Z galerie', n1 and 'Body z fotky' in n1 and await page.evaluate("() => !!document.getElementById('ag-fb-volba')"), n1)
        await page.evaluate("() => { const v = document.getElementById('ag-fb-volba'); v && v.remove(); }")

        ok('E1 bez chyb stránky', not chyby, chyby[:4])
        await ctx.close()
        await br.close()


def main():
    js = io.open(os.path.join(ROOT, 'js', 'foto-body.js'), encoding='utf-8').read()
    ok('S1 js/foto-body.js v index.html (ag/lazy) i v sw.js',
       'data-src="js/foto-body.js"' in io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
       and "'./js/foto-body.js'" in io.open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read())
    ok('S2 bez whitelistu jen číslic (nutil písmena číst jako číslice)', 'tessedit_char_whitelist' not in js)
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
