# -*- coding: utf-8 -*-
u"""Regrese k v382 (19. 9. 2026) — PORTUGALŠTINA (E7, 2. část; 4. kolo hodnocení, výběr „ano"):

  N1  data: jádro (data/jazyky.json) má pt v 'jazyky' i 'poradi' a 8 překladů u každého klíče
      a 9 sloupců u vzorů; rozšíření data/jazyky-pt.json má stejné klíče jako en (názvy zemí včetně);
      navody/predpisy/ulohy/co-je-noveho-pt.json existují a co-je-noveho-pt má stejná vydání jako česky
      (test_jazyky_data hlídá strukturu a české zbytky obecně).
  N2  js/jazyky.js: LANGS má pt, detect() zná pt, locale() dá pt-PT; test_jazyky_data.py má pt v LANGS;
      build-zpravodaj.mjs zná portugalštinu.
  N3  V prohlížeči (locale pt-PT, bez uložené volby): appka běží portugalsky (detect), t(Nastavení) =
      Definições, návod „?" u Kompasu je portugalsky (bússola, norte), Historie aktualizací bez češtiny
      a dny slovy portugalsky (segunda-feira…domingo), názvy zemí v Nastavení → Země měření portugalsky
      (Portugal, Chéquia), po přepnutí na cs zase česky.

Spouští se z kořene repa (vlastní port 9381, vlastní server):
    python scripts/test_v382.py
"""
import io, os, re, sys, json, asyncio
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as V
from ag_boot import boot
PORT = 9382
# jen písmena, která portugalština NEMÁ (é, á, í, ú, ó, â… má i portugalština)
CZ = re.compile(u'[ěščřžýůďťňĚŠČŘŽÝŮĎŤŇ]')
OKS = []


def ok(n, c, info=''):
    OKS.append(bool(c)); print(('OK    ' if c else 'CHYBA ') + n + ('' if c else '  -- %s' % (info,)))


def nacti(rel):
    return json.load(io.open(os.path.join(ROOT, rel), encoding='utf-8'))


def ceska_slova(t):
    return [w for w in re.findall(u'[A-Za-zÀ-ž’]+', t) if CZ.search(w) and w not in (u'ČÚZK', u'ČHMÚ', u'Křovák', u'Křováka', u'Kokeš', u'Sněžka', u'Sněžku', u'ŘLP', u'ČSN', u'ČR', u'Štátna', u'sieť', u'Bpv', u'Štěpán', u'Včelák', u'GKÚ', u'RÚIAN', u'Tsjechië', u'Chéquia', u'Nahlížení', u'Geoprohlížeč', u'ČVUT', u'ZČU', u'ŠD')]


def staticke():
    core = nacti('data/jazyky.json')
    ok('N1 jádro: pt v jazyky i poradi', ['pt', u'Português'] in core['jazyky'] and 'pt' in core['poradi'])
    n = len(core['poradi'])
    ok('N1 jádro: %d překladů u každého klíče, žádný prázdný' % n, all(len(v) == n and all(v) for v in core['t'].values()))
    ok('N1 jádro: vzory re mají %d sloupců' % (n + 1), all(len(r) == n + 1 for r in core['re']))
    ok(u'N1 jádro: t(Nastavení) pt = Definições', core['t'][u'Nastavení'][core['poradi'].index('pt')] == u'Definições', core['t'][u'Nastavení'])
    nl = nacti('data/jazyky-pt.json'); en = nacti('data/jazyky-en.json')
    ok('N1 jazyky-pt.json: jazyk pt, stejné klíče jako en (%d)' % len(en['t']), nl.get('jazyk') == 'pt' and set(nl['t']) == set(en['t']))
    zb = [k for k, v in nl['t'].items() if v == k and len(k) > 3 and ceska_slova(k)]
    ok('N1 jazyky-pt.json: nepřeložené klíče s diakritikou', not zb, zb[:5])
    ok(u'N1 názvy zemí portugalsky (Portugalsko → Portugal, Česko → Chéquia, Nizozemsko → Países Baixos)', nl['t'].get(u'Portugalsko') == 'Portugal' and nl['t'].get(u'Česko') == u'Chéquia' and nl['t'].get(u'Nizozemsko') == u'Países Baixos', [nl['t'].get(k) for k in (u'Portugalsko', u'Česko', u'Nizozemsko')])
    for f in ('navody', 'predpisy', 'ulohy', 'co-je-noveho'):
        ok('N1 data/%s-pt.json existuje' % f, os.path.exists(os.path.join(ROOT, 'data/%s-pt.json' % f)))
    cjn = nacti('data/co-je-noveho-pt.json'); cs = nacti('data/co-je-noveho.json')
    ok('N1 co-je-noveho-pt: stejná vydání jako česky', [v['v'] for v in cjn['verze']] == [v['v'] for v in cs['verze']])
    ok(u'N1 co-je-noveho-pt: v382 přeloženo (português)', any(v['v'] == 382 and u'português' in v['nadpis'].lower() for v in cjn['verze']), [v['nadpis'] for v in cjn['verze'][:1]])
    tj = io.open(os.path.join(ROOT, 'scripts/test_jazyky_data.py'), encoding='utf-8').read()
    ok('N2 test_jazyky_data.py má pt v LANGS', "'nl', 'pt'" in tj)
    jz = io.open(os.path.join(ROOT, 'js/jazyky.js'), encoding='utf-8').read()
    ok('N2 js/jazyky.js LANGS má pt', "{ c: 'pt', n: 'Português' }" in jz)
    ok('N2 js/jazyky.js detect() zná pt', "c === 'pt'" in jz)
    ok('N2 js/jazyky.js locale() pt-PT', "pt: 'pt-PT'" in jz)
    bz = io.open(os.path.join(ROOT, 'scripts/build-zpravodaj.mjs'), encoding='utf-8').read()
    ok(u'N2 build-zpravodaj.mjs zná portugalštinu', u"pt: 'portugalštiny'" in bz)


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        init = boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.removeItem('agJazyk_v1');"
        ctx = await br.new_context(locale='pt-PT', viewport={'width': 412, 'height': 915}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        await ctx.add_init_script(init)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)))
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(2500)
        await page.evaluate("() => { if (typeof startAppFromWelcome === 'function') startAppFromWelcome(); }")
        await page.wait_for_timeout(3000)
        lang = await page.evaluate("() => window.AGJazyk && AGJazyk.get()")
        ok('N3 telefon pt-PT → appka běží portugalsky (detect)', lang == 'pt', lang)
        t = await page.evaluate("() => AGJazyk.t('Nastavení')")
        ok(u'N3 t(Nastavení) = Definições', t == u'Definições', t)
        t = await page.evaluate("() => AGJazyk.t('Zavřít')")
        ok(u'N3 t(Zavřít) = Fechar', t == 'Fechar', t)
        loc = await page.evaluate("() => AGJazyk.locale()")
        ok('N3 locale() = pt-PT', loc == 'pt-PT', loc)
        h = await page.evaluate("() => AGReg.helpAsync('kompas').then(r => r && r.h)")
        ok(u'N3 návod Kompas je portugalsky (bússola, norte)', h and u'bússola' in h.lower() and 'norte' in h.lower() and not ceska_slova(h), (h or '')[:120])
        await page.evaluate("() => new Promise(res => { const go = () => res(agToolHelp('kompas', 'Kompas')); if (typeof agToolHelp === 'function') go(); else AGLazy.need('js/tools-plus.js', go); })")
        await page.wait_for_timeout(1500)
        bub = await page.evaluate("() => { const b = document.getElementById('ag-tp-hm-b'), t = document.getElementById('ag-tp-hm-t'); return { t: t && t.textContent, b: b && b.textContent.slice(0, 160) }; }")
        ok(u'N3 okno „?" u Kompasu: tělo portugalsky', bub.get('b') and 'norte' in bub['b'].lower() and not ceska_slova(bub['b']), bub)
        await page.evaluate("() => { const c = document.querySelector('.ag-tp-close'); if (c) c.click(); }")
        DUMP = """(sel) => { const root = document.querySelector(sel); if (!root) return null;
            const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const out = [];
            while (w.nextNode()) { const t = w.currentNode.nodeValue.trim(); if (t) out.push(t); } return out; }"""
        await page.evaluate("() => new Promise(res => AGLazy.need('js/historie-aktualizaci.js', () => { AGHistorie.open(); res(); }))")
        await page.wait_for_timeout(3000)
        hist = await page.evaluate(DUMP, '.hist-ov') or []
        zb = sorted(set(w for t in hist for w in ceska_slova(t)))
        ok(u'N3 Historie aktualizací: bez češtiny (%d uzlů)' % len(hist), hist and not zb, zb[:10])
        ok(u'N3 Historie: dny slovy portugalsky', any(re.match(u'^(segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado|domingo),? \\d+ ', t, re.I) for t in hist), [t for t in hist if re.search(u'\\d{4}$', t)][:2])
        await page.evaluate("() => AGHistorie.close()")
        # názvy zemí v Nastavení → Země měření (select naplněný z registru, přeložený přes t())
        zeme = await page.evaluate("""() => { try { if (window.AGSettings && AGSettings.reveal) AGSettings.reveal('s-zeme'); } catch (e) {}
            var s = document.getElementById('s-zeme'); if (!s) return null; return Array.from(s.options).map(o => o.textContent.trim()); }""")
        ok(u'N3 Země měření: názvy zemí portugalsky (Portugal, Chéquia, Alemanha)', zeme and any('Portugal' in z for z in zeme) and any(u'Chéquia' in z for z in zeme) and any('Alemanha' in z for z in zeme), (zeme or [])[:8])
        await page.evaluate("() => AGJazyk.set('cs')")
        await page.wait_for_timeout(1500)
        t = await page.evaluate("() => AGJazyk.t('Nastavení')")
        ok(u'N3 po přepnutí na cs zase česky', t == u'Nastavení', t)
        ok('N3 bez chyb stránky', not chyby, chyby[:3])
        await br.close()


def main():
    staticke()
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server se nespustil'); sys.exit(2)
    try:
        asyncio.run(beh(url))
    finally:
        srv.terminate()
    print('\n%d/%d OK' % (sum(OKS), len(OKS)))
    sys.exit(0 if all(OKS) else 1)


if __name__ == '__main__':
    main()
