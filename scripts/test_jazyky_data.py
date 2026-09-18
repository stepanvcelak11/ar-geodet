# -*- coding: utf-8 -*-
u"""Regrese k překladům 18. 9. 2026 (v356) — DATOVÉ soubory po jazyce a slovník:

  D1  data/navody-xx.json, predpisy-xx.json, ulohy-xx.json existují pro en/de/pl/es/it, mají stejné klíče
      jako české originály a neobsahují český text (mimo jména ČÚZK, Křovák, Kokeš…).
  D2  Všech 5 rozšíření slovníku má STEJNOU sadu klíčů (es/it dřív o 27 klíčů chudší).
  D3  sw.js: jazykové soubory (jazyky-xx, navody-xx, …) jdou stale-while-revalidate do DICT_CACHE
      (cache-first tam držel cizojazyčnou appku navždy na prvním staženém slovníku).
  B1  V prohlížeči (jazyk it): bublina „?" u nástroje ukáže italský návod (AGReg.helpAsync),
      Předpisy (openPredpisy) mají italské kategorie, Cvičné úlohy italské zadání,
      Geo kartičky (AGScrollUceni) italský nadpis úlohy; po přepnutí na cs se návod vrátí do češtiny.

Spuštění:  python scripts/test_jazyky_data.py [port]
"""
import io
import os
import re
import sys
import json
import asyncio

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from ag_boot import boot  # noqa: E402
import test_v329 as V  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9187)
LANGS = ['en', 'de', 'pl', 'es', 'it']
vysledky = []
CZ = re.compile(u'[ěščřžůňťď]')
# vlastní jména, která zůstávají česky i v překladu
VYJIMKY = ('ČÚZK', 'ČHMÚ', 'ŘLP', 'ŠD', 'Křovák', 'Kokeš', 'Nahlížení', 'Geoprohlížeč', 'Kč', 'Sb.', 'ČSN', 'ČVUT', 'Průmyslová')


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:400]))


def nacti(rel):
    return json.load(io.open(os.path.join(ROOT, rel), encoding='utf-8'))


def ceska_slova(text):
    out = []
    for w in re.findall(u'\\w*[ěščřžůňťď]\\w*', text):
        if not any(v in w for v in VYJIMKY):
            out.append(w)
    return out


def klice(o, key=None, acc=None, path=''):
    """Struktura bez hodnot: sada cest (klíče slovníků + délky seznamů)."""
    if acc is None:
        acc = set()
    if isinstance(o, dict):
        for k, v in o.items():
            acc.add(path + '/' + k)
            klice(v, k, acc, path + '/' + k)
    elif isinstance(o, list):
        acc.add(path + '#%d' % len(o))
        for i, v in enumerate(o):
            klice(v, key, acc, path + '[%d]' % i)
    return acc


def texty(o, acc=None, key=None):
    if acc is None:
        acc = []
    if isinstance(o, dict):
        for k, v in o.items():
            texty(v, acc, k)
    elif isinstance(o, list):
        for v in o:
            texty(v, acc, key)
    elif isinstance(o, str) and key not in ('id', 'odkaz', 'zdroj', 'platnost', 'typ', 'k', '_'):
        acc.append(o)
    return acc


def staticke():
    for base in ('navody', 'predpisy', 'ulohy'):
        cs = nacti('data/%s.json' % base)
        for l in LANGS:
            p = 'data/%s-%s.json' % (base, l)
            if not os.path.exists(os.path.join(ROOT, p)):
                ok('D1 %s existuje' % p, False, 'chybí')
                continue
            j = nacti(p)
            ok('D1 %s: stejná struktura jako originál' % p, klice(j) == klice(cs), sorted(klice(j) ^ klice(cs))[:5])
            zbytky = []
            for t in texty(j):
                zbytky += ceska_slova(t)
            ok('D1 %s: bez českých zbytků' % p, not zbytky, sorted(set(zbytky))[:12])
    if 'navody' == 'navody':
        cs = nacti('data/navody.json')
        for l in LANGS:
            j = nacti('data/navody-%s.json' % l)
            spatne = [k for k in cs if k != '_' and sorted(re.findall(r'</?[a-z]+', j.get(k, ''))) != sorted(re.findall(r'</?[a-z]+', cs[k]))]
            ok('D1 navody-%s: stejné HTML tagy jako česky' % l, not spatne, spatne[:5])
    sady = {l: set(nacti('data/jazyky-%s.json' % l)['t']) for l in LANGS}
    ok('D2 všech 5 rozšíření slovníku má stejné klíče', all(sady[l] == sady['en'] for l in LANGS),
       {l: len(sady[l] ^ sady['en']) for l in LANGS})
    core = nacti('data/jazyky.json')
    ok('D2 jádro: 5 překladů u každého klíče', all(len(v) == 5 and all(v) for v in core['t'].values()))
    ok('D2 jádro: vzory re mají 6 sloupců', all(len(r) == 6 for r in core['re']))
    sw = io.open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    ok('D3 sw.js: isLangData + stale-while-revalidate do DICT_CACHE', 'function isLangData(url)' in sw and 'if (isLangData(url)) {' in sw
       and sw.index('if (isLangData(url)) {') < sw.index('caches.open(isFont(url) ? FONT_CACHE : (isDict(url) ? DICT_CACHE : SHELL_CACHE))'))
    jz = io.open(os.path.join(ROOT, 'js/jazyky.js'), encoding='utf-8').read()
    ok('D3 js/jazyky.js: AGJazyk.fetchData/dataUrl', 'fetchData: fetchData' in jz and 'dataUrl: dataUrl' in jz)
    for f, needle in (('js/tools-registry.js', 'AGJazyk.fetchData'), ('js/predpisy.js', 'AGJazyk.fetchData'), ('js/cvicne-ulohy.js', 'AGJazyk.fetchData'), ('js/scroll-uceni.js', 'AGJazyk.fetchData')):
        ok('D3 %s čte data přes AGJazyk.fetchData' % f, needle in io.open(os.path.join(ROOT, f), encoding='utf-8').read())


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        init = boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.setItem('agJazyk_v1','it');"
        ctx = await br.new_context(locale='it-IT', viewport={'width': 412, 'height': 915}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        await ctx.add_init_script(init)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)))
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(2500)
        await page.evaluate("() => { if (typeof startAppFromWelcome === 'function') startAppFromWelcome(); }")
        await page.wait_for_timeout(2500)
        lang = await page.evaluate("() => window.AGJazyk && AGJazyk.get()")
        ok('B1 appka běží italsky', lang == 'it', lang)
        h = await page.evaluate("() => AGReg.helpAsync('kompas').then(r => r && r.h)")
        ok('B1 návod Kompas je italsky (helpAsync)', h and 'bussola' in h.lower() and not CZ.search(h.replace('ČÚZK', '')), (h or '')[:120])
        # okno „?" (js/tools-plus.js: agToolHelp) — titulek přes slovník, tělo z data/navody-it.json
        await page.evaluate("() => new Promise(res => { const go = () => res(agToolHelp('kompas', 'Kompas')); if (typeof agToolHelp === 'function') go(); else AGLazy.need('js/tools-plus.js', go); })")
        await page.wait_for_timeout(1500)
        bub = await page.evaluate("() => { const b = document.getElementById('ag-tp-hm-b'), t = document.getElementById('ag-tp-hm-t'); return { t: t && t.textContent, b: b && b.textContent.slice(0, 160) }; }")
        ok('B1 okno „?" u Kompasu: tělo italsky', bub.get('b') and 'nord' in bub['b'].lower() and not CZ.search(bub['b']), bub)
        ok('B1 okno „?" u Kompasu: titulek přeložený', bub.get('t') and not CZ.search(bub['t']), bub.get('t'))
        await page.evaluate("() => { const c = document.querySelector('.ag-tp-close'); if (c) c.click(); }")
        # Předpisy
        await page.evaluate("() => new Promise(res => { if (typeof openPredpisy === 'function') return res(openPredpisy()); AGLazy.need('js/predpisy.js', () => res(openPredpisy())); })")
        await page.wait_for_timeout(3000)
        prd = await page.evaluate("() => { const s = document.querySelector('.prd-sheet'); return s ? s.textContent.replace(/\\s+/g, ' ').slice(0, 600) : null; }")
        ok('B1 Předpisy italsky (Tolleranze e precisione)', prd and 'Tolleranze' in prd and 'Mezní odchylky' not in prd, (prd or '')[:200])
        await page.evaluate("() => { const b = document.querySelector('.prd-sheet [data-close], .prd-sheet .prd-close, .prd-sheet button'); if (b) b.click(); }")
        # Cvičné úlohy
        await page.evaluate("() => AGLazyTools.open('cvicne-ulohy')")
        await page.wait_for_timeout(3500)
        await page.evaluate("() => { const b = document.querySelector('#ag-ul-modal .ul-row[data-ul]'); if (b) b.click(); }")
        await page.wait_for_timeout(800)
        ul = await page.evaluate("() => { const m = document.getElementById('ag-ul-modal'); return m ? m.textContent.replace(/\\s+/g, ' ').slice(0, 800) : null; }")
        ok('B1 Cvičné úlohy italsky (Dalle coordinate dei punti)', ul and ('Dalle coordinate' in ul or 'determina' in ul.lower()) and 'Ze souřadnic' not in ul, (ul or '')[:200])
        await page.evaluate("() => { if (window.AGUlohy) AGUlohy.close(); }")
        # Geo kartičky
        await page.evaluate("() => AGLazyTools.open('scroll-uceni')")
        await page.wait_for_timeout(4000)
        su = await page.evaluate("() => { const k = AGScrollUceni.karty(); const o = k.filter(x => x.typ === 'otazka' || (x.nh || '').indexOf('loha') >= 0)[0]; return { n: k.length, nh: o ? o.nh : null, txt: document.body.textContent.indexOf('Dalle coordinate') >= 0 || document.body.textContent.indexOf('Nella stazione') >= 0 }; }")
        ok('B1 Geo kartičky: otázky z italských úloh', su.get('n', 0) > 0 and su.get('txt'), su)
        # přepnutí zpět na cs → návod česky
        await page.evaluate("() => AGJazyk.set('cs')")
        await page.wait_for_timeout(1500)
        h2 = await page.evaluate("() => AGReg.helpAsync('kompas').then(r => r && r.h)")
        ok('B1 po přepnutí na cs je návod zase česky', h2 and 'růžice' in h2, (h2 or '')[:100])
        await ctx.close()
        await br.close()
        ok('B1 bez chyb stránky', not chyby, chyby[:3])


def main():
    staticke()
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server se nespustil'); sys.exit(2)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    spatne = [v for v in vysledky if not v[1]]
    print('\n%d/%d OK' % (len(vysledky) - len(spatne), len(vysledky)))
    sys.exit(1 if spatne else 0)


if __name__ == '__main__':
    main()
