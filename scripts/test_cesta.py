# -*- coding: utf-8 -*-
u"""CESTA UČENÍ (f3) + TOTI V PRŮVODCI PRVNÍM MĚŘENÍM (f4) — 25. 9. 2026, 7. hodnocení.

Kontroluje: cesta 18 lekcí v 5 tématech, odemyká se postupně; lekce se dá projít (výběr
i číselná odpověď), chyba se vrátí na konec, konec dá XP, korunku za bez chyby, denní cíl
a sérii; Toti sedí v hlavičce; maskot pozná ohroženou sérii; průvodce prvním měřením má
Totiho, který čte kroky.

python scripts/test_cesta.py [port] [--shots DIR]
"""
import os
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9077)
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
VYSLEDKY = []


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


async def shot(page, jm):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        await page.screenshot(path=os.path.join(SHOTS, jm + '.png'))


ODPOVEZ = """async (spatne) => {
    const q = AGCesta._test.otazka(); if (!q) return 'zadna';
    if (q.typ === 'mcq') {
        const b = [...document.querySelectorAll('#ag-cu .cu-moz button')].find(x => spatne ? x.textContent !== q.spravne : x.textContent === q.spravne);
        b.click();
    } else {
        const i = document.querySelector('#cu-in'); i.value = spatne ? '1' : String(q.v).replace('.', ','); i.dispatchEvent(new Event('input'));
    }
    await new Promise(r => setTimeout(r, 60));
    document.querySelector('#ag-cu .cu-dole .cu-go').click();          // Zkontrolovat
    await new Promise(r => setTimeout(r, 80));
    const fb = document.querySelector('#ag-cu .cu-dole').className;
    document.querySelector('#ag-cu .cu-dole .cu-go').click();          // Pokračovat
    await new Promise(r => setTimeout(r, 80));
    return fb;
}"""


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        chyby = []
        page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        await page.evaluate("() => new Promise(r => AGLazy.need('js/maskot.js', r))")
        # otevřít z panelu Nástroje (jako člověk)
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(800)
        await page.evaluate("() => { for (let i = 0; i < 3; i++) document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click()); const r = document.querySelector('#tools-modal .ag-uk-i[data-k=\"cesta-uceni\"]'); if (r) { r.scrollIntoView(); r.click(); } }")
        ok('A1 Cesta učení se otevře z panelu Nástroje', await V.cekej(page, "(() => { const d = document.getElementById('ag-cu'); return d && getComputedStyle(d).display === 'flex' && d.querySelectorAll('.cu-uzel').length > 0; })()", 60))
        await page.wait_for_timeout(1500)
        await shot(page, 'cesta_mapa')
        m = await page.evaluate("""() => ({ uzly: document.querySelectorAll('#ag-cu .cu-uzel').length, ted: document.querySelectorAll('#ag-cu .cu-uzel.ted').length,
            zam: document.querySelectorAll('#ag-cu .cu-uzel.zamceno').length, temata: [...document.querySelectorAll('#ag-cu .cu-tema b')].map(b => b.textContent),
            toti: !!document.querySelector('#ag-cu .cu-toti .ag-maskot.mk-mini') })""")
        ok('M1 cesta: 18 lekcí v 5 tématech, jedna svítí, 17 zamčených', m['uzly'] == 18 and m['ted'] == 1 and m['zam'] == 17 and len(m['temata']) == 5, m)
        ok('M2 Toti v hlavičce (mini)', m['toti'], m)
        # zamčená lekce nejde
        await page.evaluate("() => document.querySelectorAll('#ag-cu .cu-uzel.zamceno')[0].click()")
        await page.wait_for_timeout(300)
        ok('M3 klepnutí na zamčenou lekci ji neotevře', await page.evaluate("() => !AGCesta._test.lekce()"))

        # 1. lekce bez chyby
        await page.evaluate("() => document.querySelector('#ag-cu .cu-uzel.ted').click()")
        ok('L1 lekce začne otázkou s možnostmi', await V.cekej(page, "!!document.querySelector('#ag-cu .cu-moz button')", 40))
        await shot(page, 'cesta_otazka')
        fb = []
        for _ in range(12):
            if await page.evaluate("() => !AGCesta._test.lekce() || AGCesta._test.lekce().konec"):
                break
            fb.append(await page.evaluate(ODPOVEZ, False))
        ok('L2 všech 6 odpovědí správně (zelená lišta)', len(fb) == 6 and all('ok' in f for f in fb), fb)
        await shot(page, 'cesta_konec')
        k = await page.evaluate("() => ({ h: (document.querySelector('#ag-cu .cu-konec h2') || {}).textContent, s: AGCesta.stav() })")
        s = k['s']
        ok('L3 konec „Bez chyby!“, XP, korunka, denní cíl splněn, série 1', k['h'] == 'Bez chyby!' and s['xp'] >= 20 and s['hotove'].get('pojmy:0', {}).get('perfekt') and s['dnesN'] == 1 and s['streak']['n'] == 1, k)
        await page.evaluate("() => document.querySelector('#ag-cu .cu-dole .cu-go').click()")
        await page.wait_for_timeout(500)
        m2 = await page.evaluate("() => { const u = [...document.querySelectorAll('#ag-cu .cu-uzel')]; return { prvni: u[0].textContent, koruna: !!u[0].querySelector('.cu-korunka'), druhyTed: u[1].classList.contains('ted') }; }")
        ok('M4 po lekci: první ✓ s korunkou, druhá svítí', '✓' in m2['prvni'] and m2['koruna'] and m2['druhyTed'], m2)

        # 2. lekce s chybou: vrátí se na konec, bez korunky
        await page.evaluate("() => document.querySelector('#ag-cu .cu-uzel.ted').click()")
        await V.cekej(page, "!!document.querySelector('#ag-cu .cu-moz button')", 40)
        f1 = await page.evaluate(ODPOVEZ, True)
        delka = await page.evaluate("() => AGCesta._test.lekce().fronta.length")
        ok('C1 špatná odpověď: červená lišta a otázka se vrátí na konec (zbývá 6)', 'bad' in f1 and delka == 6, (f1, delka))
        for _ in range(12):
            if await page.evaluate("() => AGCesta._test.lekce().konec"):
                break
            await page.evaluate(ODPOVEZ, False)
        s2 = await page.evaluate("() => AGCesta.stav()")
        ok('C2 lekce s chybou: hotová, bez korunky, XP přibyly', s2['hotove'].get('pojmy:1') and not s2['hotove']['pojmy:1'].get('perfekt') and s2['xp'] > s['xp'], s2['hotove'])

        # číselná otázka (Výpočty)
        await page.evaluate("() => AGCesta._test.startLekce('vypocty', 0)")
        ok('V1 Výpočty: číselná otázka se zadáním a polem', await V.cekej(page, "!!document.querySelector('#cu-in') && AGCesta._test.otazka().typ === 'cislo'", 40))
        await shot(page, 'cesta_vypocet')
        fv = await page.evaluate(ODPOVEZ, False)
        ok('V2 správné číslo (s čárkou) v toleranci → zelená', 'ok' in fv, fv)

        # maskot: ohrožená série
        ser = await page.evaluate("""() => { const d = new Date(); d.setDate(d.getDate() - 1); const f = x => x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2);
            const s = AGCesta.stav(); s.streak = { n: 4, last: f(d) }; localStorage.setItem('agCestaUceni_v1', JSON.stringify(s)); return AGMaskot._test.serieOhrozena(); }""")
        ok('S1 maskot pozná ohroženou sérii (včera splněno, dnes ne) → 4', ser == 4, ser)
        await page.evaluate("() => AGCesta.close()")

        # f4: Toti v průvodci prvním měřením
        await page.evaluate("() => new Promise(r => AGLazy.need('js/prvni-mereni.js', r))")
        await page.evaluate("() => { localStorage.removeItem('agPrvniMereni_v1'); AGPrvniMereni.start(); }")
        ok('P1 průvodce prvním měřením má Totiho s bublinou', await V.cekej(page, "(() => { const m = document.querySelector('#ag-pm .pm-toti .ag-maskot.mk-mini'); return m && (m.querySelector('.mk-text').textContent || '').length > 10; })()", 40))
        await page.wait_for_timeout(1200)
        await shot(page, 'pruvodce_toti')
        # kroky s polohou se v testu odškrtnou samy (Toti pochválí) — pak přečte další krok
        p2 = await V.cekej(page, "(() => { const x = document.querySelector('#ag-pm .mk-text'); return x && x.textContent.indexOf(':') > 0 && x.textContent.length > 25; })()", 30)
        txt = await page.evaluate("() => document.querySelector('#ag-pm .mk-text').textContent")
        ok('P2 Toti čte název a radu kroku', p2, txt)
        await page.evaluate("() => AGPrvniMereni.close()")
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
