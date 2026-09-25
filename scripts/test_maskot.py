# -*- coding: utf-8 -*-
u"""MASKOT TOTI (24. 9. 2026, na přání: maskot k učení jako Duolingo + nahrání vlastních hlášek).

Kontroluje: maskot se objeví v Poznávačce, Cvičných úlohách, Odhadni to a Geo kartičkách;
správná / špatná odpověď změní náladu a hlášku; panel ⋯ (jméno, ztlumit, nahrát soubor);
parser souboru s hláškami (text s [kategoriemi], „kat: text“, JSON); v angličtině mluví anglicky.

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

        # ---- Poznávačka ----
        await otevri(page, 'poznavacka')
        ok('A1 [%s] Poznávačka: maskot nad otázkou s úvodní hláškou' % lang, await V.cekej(page, "(() => { const m = document.querySelector('#ag-pz-modal .ag-maskot'); return m && m.getClientRects().length && (m.querySelector('.mk-text').textContent || '').length > 5; })()", 40))
        await page.wait_for_timeout(2500)
        m0 = await page.evaluate(VIDITELNY, '#ag-pz-modal .ag-maskot')
        await shot(page, lang + '_poznavacka_uvod')
        ok('A2 [%s] maskot celý v okně (šířka ≥ 250, SVG 66×80)' % lang, m0 and m0['w'] >= 250 and m0['r'] <= 393, m0)
        # správná odpověď
        spravna = await page.evaluate("""() => { const popis = document.querySelector('#ag-pz-body .pz-popis').textContent; const q = AGPoznavacka.otazky.find(x => (window.AGJazyk ? AGJazyk.t(x.popis) : x.popis) === popis);
            const b = [...document.querySelectorAll('#ag-pz-modal .pz-opt')].find(x => x.getAttribute('data-n') === (q && q.n)); if (b) b.click(); return !!b; }""")
        await page.wait_for_timeout(700)
        m1 = await page.evaluate(VIDITELNY, '#ag-pz-modal .ag-maskot')
        await shot(page, lang + '_poznavacka_spravne')
        ok('A3 [%s] správná odpověď → radost a jiná hláška' % lang, spravna and m1 and 'mk-radost' in m1['cls'] and m1['txt'] != m0['txt'], (spravna, m1))
        await page.evaluate("() => document.getElementById('ag-pz-next').click()")
        await page.wait_for_timeout(400)
        await page.evaluate("""() => { const popis = document.querySelector('#ag-pz-body .pz-popis').textContent; const q = AGPoznavacka.otazky.find(x => (window.AGJazyk ? AGJazyk.t(x.popis) : x.popis) === popis);
            const b = [...document.querySelectorAll('#ag-pz-modal .pz-opt')].find(x => x.getAttribute('data-n') !== (q && q.n)); if (b) b.click(); }""")
        await page.wait_for_timeout(700)
        m2 = await page.evaluate(VIDITELNY, '#ag-pz-modal .ag-maskot')
        await shot(page, lang + '_poznavacka_spatne')
        ok('A4 [%s] špatná odpověď → smutek' % lang, m2 and 'mk-smutek' in m2['cls'], m2)
        if lang == 'en':
            cz = await page.evaluate("() => /[ěščřžýůďťň]/i.test(document.querySelector('#ag-pz-modal .mk-text').textContent)")
            ok('A5 [en] maskot mluví anglicky', not cz)

        # ---- Cvičné úlohy, Odhadni to, Geo kartičky ----
        for k, sel, nm in [('cvicne-ulohy', '#ag-ul-modal .ag-maskot', 'B1'), ('odhadovacka', '#odhad-modal .ag-maskot', 'B2'), ('scroll-uceni', '#agsu .ag-maskot.mk-roh', 'B3')]:
            await otevri(page, k)
            hotovo = await V.cekej(page, "(() => { const m = document.querySelector(%s); return m && m.getClientRects().length > 0; })()" % json.dumps(sel), 40)
            await page.wait_for_timeout(1500)
            await shot(page, lang + '_' + k)
            ok('%s [%s] maskot v nástroji %s' % (nm, lang, k), hotovo)

        if lang == 'cs':
            # ---- TOTI 2: plovoucí společník na hlavní obrazovce (25. 9. 2026) ----
            await page.evaluate("() => { document.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; m.classList.remove('ag-open'); }); const su = document.getElementById('agsu'); if (su) su.style.display = 'none'; }")
            await page.evaluate("""() => { const s = JSON.parse(localStorage.getItem('agMaskot_v1') || '{}'); s.spolecnik = true; s.ukecanost = 'ukecany'; s.zap = true;
                localStorage.setItem('agMaskot_v1', JSON.stringify(s)); AGMaskot._test.plovak(); AGMaskot._test.hlidej(); AGMaskot._test.reset(); }""")
            await page.wait_for_timeout(2500)
            pv = await page.evaluate("""() => { const p = document.getElementById('ag-maskot-plovak'); if (!p) return null; const b = p.querySelector('.mk-btn').getBoundingClientRect();
                return { skryt: p.classList.contains('mk-skryt'), w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.left), dole: Math.round(innerHeight - b.bottom) }; }""")
            await shot(page, 'cs_plovak')
            ok('T1 plovoucí Toti na hlavní obrazovce, větší (78×95), vlevo dole', pv and not pv['skryt'] and pv['w'] >= 76 and pv['h'] >= 92 and pv['x'] < 30 and pv['dole'] < 80, pv)
            await page.evaluate("() => document.querySelector('#ag-maskot-plovak .mk-btn').click()")
            await page.wait_for_timeout(600)
            menu = await page.evaluate("() => [...document.querySelectorAll('#ag-maskot-plovak .mk-akce button')].map(b => b.textContent)")
            await shot(page, 'cs_plovak_menu')
            ok('T2 klepnutí = nabídka Zeptej se mě / Vysvětli pojem / Poraď / ⋯', menu[:3] == ['Zeptej se mě', 'Vysvětli pojem', 'Poraď'], menu)
            await page.evaluate("() => document.querySelector('#ag-maskot-plovak .mk-akce button').click()")
            await page.wait_for_timeout(2500)
            q = await page.evaluate("() => ({ t: document.querySelector('#ag-maskot-plovak .mk-text').textContent, m: [...document.querySelectorAll('#ag-maskot-plovak .mk-akce button')].map(b => b.textContent) })")
            await shot(page, 'cs_plovak_kviz')
            ok('T3 kvíz: otázka z definice pojmu + 3 možnosti', '„' in q['t'] and len(q['m']) == 3, q)
            spravna = await page.evaluate("""() => { const txt = document.querySelector('#ag-maskot-plovak .mk-text').textContent;
                const dict = window.agGeoDict || []; const b = [...document.querySelectorAll('#ag-maskot-plovak .mk-akce button')];
                const hit = b.find(x => { const p = dict.find(d => d.t === x.textContent); return p && txt.indexOf(p.d.replace(/\\s+/g, ' ').trim().slice(0, 25).replace(new RegExp(p.t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'), 'gi'), '…')) >= 0; });
                (hit || b[0]).click(); return !!hit; }""")
            await page.wait_for_timeout(1500)
            po = await page.evaluate("() => ({ cls: document.getElementById('ag-maskot-plovak').className, sk: (document.querySelector('#ag-maskot-plovak .mk-skore') || {}).textContent || '', b: [...document.querySelectorAll('#ag-maskot-plovak .mk-akce button')].map(b => b.textContent) })")
            await shot(page, 'cs_plovak_odpoved')
            ok('T4 odpověď: nálada + skóre „Kvíz: x / 1“ + Další otázka', ('mk-radost' in po['cls'] or 'mk-smutek' in po['cls']) and '/ 1' in po['sk'] and 'Další otázka' in po['b'], (spravna, po))
            await page.evaluate("() => AGMaskot.vysvetli()")
            await page.wait_for_timeout(2500)
            vy = await page.evaluate("() => ({ t: document.querySelector('#ag-maskot-plovak .mk-text').textContent, b: [...document.querySelectorAll('#ag-maskot-plovak .mk-akce button')].map(b => b.textContent) })")
            ok('T5 Vysvětli pojem: pojem s definicí + Další pojem', ':' in vy['t'] and len(vy['t']) > 40 and 'Další pojem' in vy['b'], vy)
            # komentář k uložení bodu
            await page.evaluate("() => AGMaskot._test.reset()")
            pred = await page.evaluate("() => document.querySelector('#ag-maskot-plovak .mk-text').textContent")
            await page.evaluate("""() => { const ll = mistniToLatLng(743300.5, 1042200.25); window.addImportedPoints([{ name: 'KOM-1', lat: ll.lat, lng: ll.lng, origin: 'import' }]); }""")
            await page.wait_for_timeout(2600)
            kom = await page.evaluate("() => ({ t: document.querySelector('#ag-maskot-plovak .mk-text').textContent, cls: document.getElementById('ag-maskot-plovak').className })")
            await shot(page, 'cs_plovak_bod')
            ok('T6 uložení bodu → Toti to okomentuje', kom['t'] != pred and len(kom['t']) > 5 and 'mk-ticho' not in kom['cls'], kom)
            # pod otevřeným oknem se schová
            await page.evaluate("() => openSettings()")
            await page.wait_for_timeout(2600)
            ok('T7 otevřené okno (Nastavení) → plovák schovaný', await page.evaluate("() => document.getElementById('ag-maskot-plovak').classList.contains('mk-skryt')"))
            await page.evaluate("() => { const s = document.getElementById('settings-modal'); s.style.display = 'none'; s.classList.remove('ag-open'); }")
            await page.wait_for_timeout(2600)
            ok('T8 okno zavřené → plovák zpátky', await page.evaluate("() => !document.getElementById('ag-maskot-plovak').classList.contains('mk-skryt')"))
            # tichý režim: bez klepnutí mlčí
            tichy = await page.evaluate("""() => { const s = JSON.parse(localStorage.getItem('agMaskot_v1')); s.ukecanost = 'tichy'; localStorage.setItem('agMaskot_v1', JSON.stringify(s)); AGMaskot._test.reset();
                const r = AGMaskot.komentuj('bod_ulozen', { bod: 'X' }); s.ukecanost = 'ukecany'; localStorage.setItem('agMaskot_v1', JSON.stringify(s)); return r; }""")
            ok('T9 upovídanost „Jen když na něj klepnu“ → sám nekomentuje', tichy is False)
            # hlas (f5): speechSynthesis se zavolá s textem bubliny
            hl = await page.evaluate("""() => { const s = JSON.parse(localStorage.getItem('agMaskot_v1')); s.hlas = true; localStorage.setItem('agMaskot_v1', JSON.stringify(s));
                window.__rec = []; if (window.speechSynthesis) { speechSynthesis.speak = (u) => window.__rec.push({ t: u.text, l: u.lang }); } AGMaskot._test.reset();
                AGMaskot.komentuj('online', null, { vzdy: true }); s.hlas = false; localStorage.setItem('agMaskot_v1', JSON.stringify(s)); return window.__rec; }""")
            ok('T10 „Mluví nahlas“: hláška jde do hlasu telefonu v jazyce appky', hl and hl[0]['t'] and hl[0]['l'] == 'cs-CZ', hl)
            # ---- panel ----
            await page.evaluate("() => { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); const su = document.getElementById('agsu'); if (su) su.style.display = 'none'; }")
            await otevri(page, 'poznavacka')
            await page.evaluate("() => document.querySelector('#ag-pz-modal .ag-maskot .mk-vic').click()")
            await page.wait_for_timeout(500)
            await shot(page, 'cs_panel')
            ok('C1 ⋯ otevře panel maskota a je NAVRCHU (klik doprostřed tlačítka trefí panel)', await page.evaluate("() => { const b = document.querySelector('#ag-mk-panel button[data-k=nahrat]'); if (!b) return false; const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b; }"))
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
            m3 = await page.evaluate(VIDITELNY, '#ag-pz-modal .ag-maskot')
            jm = await page.evaluate("() => document.querySelector('#ag-pz-modal .mk-jmeno').textContent")
            ok('C3 „jen moje hlášky“ + nové jméno: řekne vlastní hlášku, jmenuje se Laserka', m3 and m3['txt'] == 'Moje vlastní trefa!' and jm == 'Laserka', (m3, jm))
            await page.evaluate("() => AGMaskot.nastaveni()")
            await page.evaluate("() => document.querySelector('#ag-mk-panel input[data-k=zap]').click()")
            await page.evaluate("() => document.querySelector('#ag-mk-panel button[data-k=zavrit]').click()")
            m4 = await page.evaluate(VIDITELNY, '#ag-pz-modal .ag-maskot')
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
