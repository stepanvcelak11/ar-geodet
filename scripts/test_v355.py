# -*- coding: utf-8 -*-
"""PRUCHOD APPKOU 18. 9. 2026 (v355): opravy toho, co pri klikani vsemi nastroji blblo.

  A  INDEXEDDB: prehled mista (Nastaveni → Udrzba, AGStore.report) NESMI zakladat cizi databaze.
     `indexedDB.open(name)` bez verze neexistujici DB vytvoril prazdnou (v1) a modul s `open(name, 1)`
     uz nikdy nedostal onupgradeneeded → kazdy zapis padal na „object store was not found" (toast
     „Neco se pokazilo (ucty:usageLog)"). A2: usageLog po reportu zapise. A3: SAMOLECBA — DB zalozena
     prazdnou (verze 1, zadny sklad) se pri otevreni modulem doplni (verze+1) a zapis projde.
  B  MISTOPISNY NACRT: tlacitko „Posun" nese ikonu, ne text „undefined" (klic IK.vyber = id rezimu).
  C  KARTA BODU: uredni bod BEZ Y/X v rawData dostane S-JTSK z polohy (drive pomlcky);
     Y/X na 320 px se neuriznou (font podle sirky).
  D  VZDALENE BODY DO AR: pruhledna plachta pres mapu nedostane kolecko „Sbalit" (lezelo pres pilulku).
  E  KATASTR: kolecko „Sbalit" nelezi pres nadpis okna (nadpis dostane misto, text se zkrati trojteckou).
  F  ZASTARALE HLASKY: „Nastaveni → Vzhled → Nova mapa" uz nikde (od v350 je vektor v panelu Mapa → Podklad).

Spusteni: python scripts/test_v355.py [port]
"""
import os
import sys
import io
import re
import asyncio
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as T  # noqa: E402  (server, route_vse, cekej, SEED, LAT/LNG)
from ag_boot import boot  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9270)
vysledky = []
LAT, LNG = T.LAT, T.LNG


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def staticke():
    print('--- B/F) staticke kontroly zdrojaku ---')
    s = src('js/mistopisny-nacrt.js')
    m = re.search(r"var IK = \{(.*?)\n    \};", s, re.S)
    klice = set(re.findall(r"^\s*(\w+):\s*'<svg", m.group(1), re.M)) if m else set()
    rezimy = set(re.findall(r"tl\('(\w+)'", s))
    ok('B1 kazdy rezim listy nacrtu ma ikonu (zadne „undefined")', rezimy and rezimy <= klice, {'rezimy': sorted(rezimy), 'chybi': sorted(rezimy - klice)})
    zastarale = []
    for f in os.listdir(os.path.join(ROOT, 'js')):
        if not f.endswith('.js'):
            continue
        t = src('js/' + f)
        for mm in re.finditer(r"Nastavení → Vzhled → Nová mapa", t):
            zastarale.append(f)
    ok('F1 zadna hlaska uz neposila do „Nastaveni → Vzhled → Nova mapa"', not zastarale, zastarale)
    a = src('js/ag-store.js')
    ok('A0 ag-store: cizi DB se pri oldVersion 0 nezaklada (abort upgradu) v open() i storesOf()', a.count("oldVersion === 0") >= 2)


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)))
        page.on('console', lambda m: chyby.append('console: ' + m.text[:300]) if m.type == 'error' and 'ERR_FAILED' not in m.text else None)
        await page.route('**/*', T.route_vse)
        await page.add_init_script(boot(tarif='pro') + T.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');")
        await page.goto(url, wait_until='domcontentloaded', timeout=45000)
        await T.cekej(page, "document.body.classList.contains('app-started')")
        await T.cekej(page, "typeof userLat === 'number' && userLat", 30)
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(2500)

        print('--- A) IndexedDB: prehled mista nezaklada databaze, samolecba ---')
        pred = await page.evaluate("async () => (await indexedDB.databases()).map(d => d.name + '@' + d.version).sort()")
        await page.evaluate("async () => { await AGStore.report(); }")
        po = await page.evaluate("async () => (await indexedDB.databases()).map(d => d.name + '@' + d.version).sort()")
        ok('A1 AGStore.report() nezalozil zadnou novou databazi', pred == po, {'pred': pred, 'po': po})
        a2 = await page.evaluate("""async () => { AGUcty.usageLog('test', 'v354'); await new Promise(r => setTimeout(r, 900)); const q = await AGUcty.usageQuery(Date.now() - 60000); return q.length; }""")
        ok('A2 usageLog po prehledu mista zapise (drive „object store was not found")', a2 >= 1, a2)
        a3 = await page.evaluate("""async () => {
            // rozbita DB, jak ji do v353 zakladal prehled mista: verze 1, zadny sklad
            await new Promise(r => { const d = indexedDB.deleteDatabase('argeodet-journal'); d.onsuccess = d.onerror = d.onblocked = r; });
            await new Promise(r => { const o = indexedDB.open('argeodet-journal'); o.onsuccess = () => { o.result.close(); r(); }; o.onerror = r; });
            AGJournal.commit({ op: 'test', id: 'x1', after: { name: 'x' } });
            await new Promise(r => setTimeout(r, 1200));
            return await new Promise(r => { const o = indexedDB.open('argeodet-journal'); o.onsuccess = () => { const n = Array.from(o.result.objectStoreNames); const v = o.result.version; o.result.close(); r({ sklady: n, verze: v }); }; o.onerror = () => r(null); });
        }""")
        ok('A3 zurnal se samolecbou doplni sklad ops (verze 2) a zapis projde', a3 and 'ops' in a3['sklady'] and a3['verze'] >= 2, a3)
        ok('A4 zadny toast „Neco se pokazilo" behem A', not (await page.evaluate("() => Array.from(document.querySelectorAll('.ag-toast, #ag-toast, #undo-toast')).some(t => /pokazilo/.test(t.textContent || '') && t.getBoundingClientRect().height > 0)")))

        print('--- C) karta bodu: S-JTSK z polohy, Y/X se neurizne ---')
        c1 = await page.evaluate("""() => { const pt = arPoints.find(x => x && x.id === 'p_ppbp'); showDetails(pt, 40);
            const yx = document.querySelector('#bottom-sheet .ag-kb-t.yx'); const bs = yx ? Array.from(yx.querySelectorAll('b')).map(b => b.textContent.trim()) : [];
            return { bs, y: parseFloat((bs[0] || '').replace(/\\s/g, '').replace(',', '.')), x: parseFloat((bs[1] || '').replace(/\\s/g, '').replace(',', '.')) }; }""")
        ok('C1 uredni bod bez Y/X v datech ukaze S-JTSK z polohy (Y ~741 8xx, X ~1 044 4xx)', c1 and 741000 < c1['y'] < 743000 and 1044000 < c1['x'] < 1045000, c1)
        await page.set_viewport_size({'width': 320, 'height': 568})
        await page.wait_for_timeout(600)
        c2 = await page.evaluate("""() => { const pt = arPoints.find(x => x && x.id === 'p_ppbp'); try { closeBottomSheet(); } catch (e) {} showDetails(pt, 40);
            return Array.from(document.querySelectorAll('#bottom-sheet .ag-kb-t.yx b')).map(b => ({ t: b.textContent.trim(), sw: b.scrollWidth, cw: b.clientWidth, fs: getComputedStyle(b).fontSize })); }""")
        ok('C2 na 320 px se Y ani X neurizne (scrollWidth <= clientWidth)', c2 and len(c2) == 2 and all(v['sw'] <= v['cw'] + 1 for v in c2), c2)
        await page.evaluate("() => { try { closeBottomSheet(); } catch (e) {} }")
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.wait_for_timeout(400)

        print('--- D) Vzdalene body do AR: plachta bez kolecka Sbalit ---')
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(1500)
        # 18. 9. 2026: Vzdálené body do AR jsou položka rozcestníku Podklady a katastr → napřed rozbalit řádek
        await page.evaluate("() => { AGUkony.go('Katastr a podklady', true); document.querySelector('#tools-modal .ag-uk-i[data-k=\"podklady-katastr\"]').click(); }")
        await page.wait_for_timeout(500)
        await page.evaluate("() => document.querySelector('#tools-modal .ag-uk-sub[data-sub=\"podklady-katastr\"] .ag-uk-i[data-k=\"ar-dosah\"]').click()")
        await page.wait_for_timeout(3500)
        d1 = await page.evaluate("() => ({ vrstva: !!document.getElementById('ag-dosah-vrstva'), fab: Array.from(document.querySelectorAll('.ag-mini-fab')).filter(f => f.parentElement && f.parentElement.id === 'ag-dosah-vrstva').length })")
        ok('D1 plachta vyberu existuje a nema kolecko Sbalit', d1 and d1['vrstva'] and d1['fab'] == 0, d1)
        await page.evaluate("() => { var b = document.getElementById('ag-dosah-zrus'); if (b) b.click(); }")
        await page.wait_for_timeout(500)

        print('--- E) Katastr: kolecko Sbalit nelezi pres nadpis ---')
        await page.evaluate("() => { var m = document.getElementById('tools-modal'); if (getComputedStyle(m).display === 'none') document.getElementById('dock-nastroje-btn').click(); }")
        await page.wait_for_timeout(1200)
        await page.evaluate("() => document.querySelector('#tools-modal .ag-uk-i[data-k=\"openKatastr\"]').click()")
        await page.wait_for_timeout(3500)
        e1 = await page.evaluate("""() => { const w = document.getElementById('ag-katastr-okno'); if (!w) return null;
            const f = w.querySelector('.ag-mini-fab'); const t = w.querySelector('.agk-t'); if (!f || !t) return { fab: !!f, t: !!t };
            const fr = f.getBoundingClientRect(); const b = t.querySelector('b'); const rects = Array.from(b.getClientRects());
            const prekryv = rects.some(r => r.right > fr.left + 2 && r.left < fr.right - 2 && r.bottom > fr.top && r.top < fr.bottom);
            return { prekryv, pad: t.style.paddingRight, fab: [Math.round(fr.left), Math.round(fr.right)], text: b.textContent, textR: rects.map(r => Math.round(r.right)) }; }""")
        ok('E1 text nadpisu Katastru nekonci pod koleckem Sbalit', e1 and e1.get('prekryv') is False, e1)

        pe = [c for c in chyby if c.startswith('pageerror')]
        ok('Z zadna chyba stranky za cely beh', not pe, pe[:4])
        await br.close()


def main():
    staticke()
    srv, url = T.server(PORT)
    if not srv:
        print('CHYBA server se nespustil'); return 1
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('-' * 60)
    print('proslo %d / %d' % (len(vysledky) - len(spatne), len(vysledky)))
    return 1 if spatne else 0


if __name__ == '__main__':
    sys.exit(main())
