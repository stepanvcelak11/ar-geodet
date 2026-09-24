# -*- coding: utf-8 -*-
u"""ZBYTKY ČEŠTINY V ANGLIČTINĚ (24. 9. 2026, e2 ze 6. kola hodnocení).

⚠ PROČ: překlad jde přes slovník (js/jazyky.js, klíč = přesný český text). Nový text
  v modulu, složený text s číslem („Prší — až 0,4 mm/h“) nebo datum formátované natvrdo
  česky projde všemi ostatními sadami, a Angličan pak v nástroji čte češtinu.

Co dělá: appka v angličtině, projde VŠECHNY nástroje z panelu Nástroje a hlavní okna;
v každém sebere viditelné texty s českou diakritikou (ěščřžýůďťň). Text se počítá, jen když
tam je i o 1,1 s později (modul právě překreslil a překladač ještě nedoběhl = není chyba).
Vlastní jména (ČÚZK, RÚIAN, názvy krajů a obcí z dat) jsou na seznamu POVOLENO.

python scripts/test_cestina_zbytky.py [port]
"""
import os
import re
import sys
import asyncio

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9058)
VYSLEDKY = []
# vlastní jména a data (ne text appky): slova s diakritikou, která smí zůstat
POVOLENO = {'ČÚZK', 'RÚIAN', 'ÚAZK', 'Hlavní', 'město', 'Středočeský', 'Jihočeský', 'Plzeňský', 'Karlovarský', 'Ústecký', 'Liberecký',
            'Královéhradecký', 'Pardubický', 'Jihomoravský', 'Olomoucký', 'Moravskoslezský', 'Zlínský', 'kraj', 'Vysočina', 'Křovák',
            'Křováka', 'Ruzyně', 'Libuš', 'Černošice', 'Dobříš'}
CZ = re.compile(r'[ěščřžýůďťňĚŠČŘŽÝŮĎŤŇ]')

SBER = """() => { const out = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const t = n.textContent.trim(); if (t.length < 3 || !/[ěščřžýůďťňĚŠČŘŽÝŮĎŤŇ]/.test(t)) continue; const el = n.parentElement; if (!el || el.closest('script,style,svg,pre,textarea,[contenteditable]')) continue;
    let p = el, hid = false; while (p && p !== document.body) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) { hid = true; break; } p = p.parentElement; } if (hid) continue;
    const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue; out.add(t.slice(0, 160)); }
  return [...out]; }"""


def ok(jmeno, podminka, detail=''):
    VYSLEDKY.append(bool(podminka))
    print(('OK    ' if podminka else 'CHYBA ') + jmeno + ('' if podminka else '  -- ' + str(detail)[:1500]))


def cesky(s):
    # citát v uvozovkách (nápis na značce „Nivelační značka“) je český i v cizím textu
    s = re.sub(r'"[^"]*("|$)|„[^“]*(“|$)', ' ', s)
    slova = [w for w in re.findall(r'[\wÀ-ž]+', s) if CZ.search(w)]
    return [w for w in slova if w not in POVOLENO]


async def sber(page):
    a = set(await page.evaluate(SBER))
    await page.wait_for_timeout(1100)   # ne násobek běžných intervalů překreslení (500/700 ms)
    b = set(await page.evaluate(SBER))
    return sorted(s for s in (a & b) if cesky(s))


async def beh(url):
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(locale='en-GB', viewport={'width': 393, 'height': 852}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 4}, permissions=['geolocation'])
        page = await ctx.new_page()
        await page.route('**/*', V.route_vse)
        await page.add_init_script(boot(tarif='pro') + "localStorage.setItem('agZemeUvod_v1','CZ'); localStorage.setItem('agSlabsiTelefon_v1','off');"
                                   "localStorage.setItem('agJazyk_v1','en'); localStorage.setItem('agLang','en');")
        await page.goto(url, wait_until='domcontentloaded', timeout=90000)
        ok('A0 start', await V.cekej(page, "document.body.classList.contains('app-started')", 60))
        ok('A1 angličtina i s rozšířeným slovníkem', await V.cekej(page, "window.AGJazyk && AGJazyk.get() === 'en' && AGJazyk.t('Vlastních bodů v zakázce:') !== 'Vlastních bodů v zakázce:'", 40))
        await page.wait_for_timeout(1500)
        nalez = {}
        z = await sber(page)
        if z:
            nalez['hlavní obrazovka'] = z
        for nazev, js in [('Nový bod', "() => openNewPointModal()"), ('Mé body', "() => openManageModal()"), ('Nastavení', "() => openSettings()")]:
            await page.evaluate(js)
            await page.wait_for_timeout(1200)
            z = await sber(page)
            if z:
                nalez[nazev] = z
            await page.evaluate("() => { try { closeCustomModal(); } catch (e) {} try { closeManageModal(); } catch (e) {} const s = document.getElementById('settings-modal'); if (s) s.style.display = 'none'; }")
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(900)
        klice = await page.evaluate("() => { for (let i = 0; i < 3; i++) document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click()); return [...new Set([...document.querySelectorAll('#tools-modal .ag-uk-i[data-k]')].map(e => e.getAttribute('data-k')))]; }")
        ok('A2 v panelu Nástroje je aspoň 40 nástrojů', len(klice) >= 40, len(klice))
        for k in klice:
            await page.evaluate("() => { document.querySelectorAll('#ag-fb-volba, #ag-fb').forEach(e => e.remove()); document.querySelectorAll('.ag-dlg-overlay').forEach(e => e.remove()); document.querySelectorAll('.modal-overlay').forEach(m => { if (m.id !== 'tools-modal' && getComputedStyle(m).display !== 'none') m.style.display = 'none'; }); }")
            await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
            await page.wait_for_timeout(700)
            await page.evaluate("(k) => { for (let i = 0; i < 3; i++) document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click()); const r = document.querySelector('#tools-modal .ag-uk-i[data-k=\"' + k + '\"]'); if (r) { r.scrollIntoView(); r.click(); } }", k)
            await page.wait_for_timeout(1800)
            z = await sber(page)
            if z:
                nalez[k] = z
        vse = {k: v for k, v in nalez.items()}
        ok('B1 žádný nástroj ani hlavní okno neukazuje v angličtině češtinu (%d míst)' % sum(len(v) for v in vse.values()), not vse,
           '\n' + '\n'.join('  %s: %s' % (k, ' | '.join(v[:4])) for k, v in vse.items()))
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
