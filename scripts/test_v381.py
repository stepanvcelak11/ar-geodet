# -*- coding: utf-8 -*-
u"""Regrese k v381 (19. 9. 2026) — NIZOZEMŠTINA (E7, 4. kolo hodnocení, výběr „ano"):

  N1  data: jádro (data/jazyky.json) má nl v 'jazyky' i 'poradi' a 7 překladů u každého klíče
      a 8 sloupců u vzorů; rozšíření data/jazyky-nl.json má stejné klíče jako en (názvy zemí včetně);
      navody/predpisy/ulohy/co-je-noveho-nl.json existují a co-je-noveho-nl má stejná vydání jako česky
      (test_jazyky_data hlídá strukturu a české zbytky obecně).
  N2  js/jazyky.js: LANGS má nl, detect() zná nl, locale() dá nl-NL; test_jazyky_data.py má nl v LANGS;
      build-zpravodaj.mjs zná nizozemštinu.
  N3  V prohlížeči (locale nl-NL, bez uložené volby): appka běží nizozemsky (detect), t(Nastavení) =
      Instellingen, návod „?" u Kompasu je nizozemsky (kompas, noorden), Historie aktualizací bez češtiny
      a dny slovy nizozemsky (maandag…zondag), názvy zemí v Nastavení → Země měření nizozemsky
      (Nederland, Tsjechië), po přepnutí na cs zase česky.

Spouští se z kořene repa (vlastní port 9381, vlastní server):
    python scripts/test_v381.py
"""
import io, os, re, sys, json, asyncio
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as V
from ag_boot import boot
PORT = 9381
# jen písmena, která nizozemština NEMÁ (é, á, ÉÉN má i nizozemština)
CZ = re.compile(u'[ěščřžýůďťňĚŠČŘŽÝŮĎŤŇ]')
OKS = []


def ok(n, c, info=''):
    OKS.append(bool(c)); print(('OK    ' if c else 'CHYBA ') + n + ('' if c else '  -- %s' % (info,)))


def nacti(rel):
    return json.load(io.open(os.path.join(ROOT, rel), encoding='utf-8'))


def ceska_slova(t):
    return [w for w in re.findall(u'[A-Za-zÀ-ž’]+', t) if CZ.search(w) and w not in (u'ČÚZK', u'ČHMÚ', u'Křovák', u'Křováka', u'Kokeš', u'Sněžka', u'Sněžku', u'ŘLP', u'ČSN', u'ČR', u'Štátna', u'sieť', u'Bpv', u'Štěpán', u'Včelák', u'GKÚ', u'RÚIAN', u'Tsjechië', u'Nahlížení', u'Geoprohlížeč', u'ČVUT', u'ZČU', u'ŠD')]


def staticke():
    core = nacti('data/jazyky.json')
    ok('N1 jádro: nl v jazyky i poradi', ['nl', u'Nederlands'] in core['jazyky'] and 'nl' in core['poradi'])
    n = len(core['poradi'])
    ok('N1 jádro: %d překladů u každého klíče, žádný prázdný' % n, all(len(v) == n and all(v) for v in core['t'].values()))
    ok('N1 jádro: vzory re mají %d sloupců' % (n + 1), all(len(r) == n + 1 for r in core['re']))
    ok(u'N1 jádro: t(Nastavení) nl = Instellingen', core['t'][u'Nastavení'][-1] == 'Instellingen', core['t'][u'Nastavení'])
    nl = nacti('data/jazyky-nl.json'); en = nacti('data/jazyky-en.json')
    ok('N1 jazyky-nl.json: jazyk nl, stejné klíče jako en (%d)' % len(en['t']), nl.get('jazyk') == 'nl' and set(nl['t']) == set(en['t']))
    zb = [k for k, v in nl['t'].items() if v == k and len(k) > 3 and ceska_slova(k)]
    ok('N1 jazyky-nl.json: nepřeložené klíče s diakritikou', not zb, zb[:5])
    ok(u'N1 názvy zemí nizozemsky (Nizozemsko → Nederland, Česko → Tsjechië, Švýcarsko → Zwitserland)', nl['t'].get(u'Nizozemsko') == 'Nederland' and nl['t'].get(u'Česko') == u'Tsjechië' and nl['t'].get(u'Švýcarsko') == 'Zwitserland', [nl['t'].get(k) for k in (u'Nizozemsko', u'Česko', u'Švýcarsko')])
    for f in ('navody', 'predpisy', 'ulohy', 'co-je-noveho'):
        ok('N1 data/%s-nl.json existuje' % f, os.path.exists(os.path.join(ROOT, 'data/%s-nl.json' % f)))
    cjn = nacti('data/co-je-noveho-nl.json'); cs = nacti('data/co-je-noveho.json')
    ok('N1 co-je-noveho-nl: stejná vydání jako česky', [v['v'] for v in cjn['verze']] == [v['v'] for v in cs['verze']])
    ok(u'N1 co-je-noveho-nl: v381 přeloženo (Nederlands)', any(v['v'] == 381 and 'nederlands' in v['nadpis'].lower() for v in cjn['verze']), [v['nadpis'] for v in cjn['verze'][:1]])
    tj = io.open(os.path.join(ROOT, 'scripts/test_jazyky_data.py'), encoding='utf-8').read()
    ok('N2 test_jazyky_data.py má nl v LANGS', "'fr', 'nl'" in tj)
    jz = io.open(os.path.join(ROOT, 'js/jazyky.js'), encoding='utf-8').read()
    ok('N2 js/jazyky.js LANGS má nl', "{ c: 'nl', n: 'Nederlands' }" in jz)
    ok('N2 js/jazyky.js detect() zná nl', "c === 'nl'" in jz)
    ok('N2 js/jazyky.js locale() nl-NL', "nl: 'nl-NL'" in jz)
    bz = io.open(os.path.join(ROOT, 'scripts/build-zpravodaj.mjs'), encoding='utf-8').read()
    ok(u'N2 build-zpravodaj.mjs zná nizozemštinu', u"nl: 'nizozemštiny'" in bz)


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        init = boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.removeItem('agJazyk_v1');"
        ctx = await br.new_context(locale='nl-NL', viewport={'width': 412, 'height': 915}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        await ctx.add_init_script(init)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)))
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(2500)
        await page.evaluate("() => { if (typeof startAppFromWelcome === 'function') startAppFromWelcome(); }")
        await page.wait_for_timeout(3000)
        lang = await page.evaluate("() => window.AGJazyk && AGJazyk.get()")
        ok('N3 telefon nl-NL → appka běží nizozemsky (detect)', lang == 'nl', lang)
        t = await page.evaluate("() => AGJazyk.t('Nastavení')")
        ok(u'N3 t(Nastavení) = Instellingen', t == u'Instellingen', t)
        t = await page.evaluate("() => AGJazyk.t('Zavřít')")
        ok(u'N3 t(Zavřít) = Sluiten', t == 'Sluiten', t)
        loc = await page.evaluate("() => AGJazyk.locale()")
        ok('N3 locale() = nl-NL', loc == 'nl-NL', loc)
        h = await page.evaluate("() => AGReg.helpAsync('kompas').then(r => r && r.h)")
        ok(u'N3 návod Kompas je nizozemsky (kompas, noorden)', h and 'kompas' in h.lower() and 'noorden' in h.lower() and not ceska_slova(h), (h or '')[:120])
        await page.evaluate("() => new Promise(res => { const go = () => res(agToolHelp('kompas', 'Kompas')); if (typeof agToolHelp === 'function') go(); else AGLazy.need('js/tools-plus.js', go); })")
        await page.wait_for_timeout(1500)
        bub = await page.evaluate("() => { const b = document.getElementById('ag-tp-hm-b'), t = document.getElementById('ag-tp-hm-t'); return { t: t && t.textContent, b: b && b.textContent.slice(0, 160) }; }")
        ok(u'N3 okno „?" u Kompasu: tělo nizozemsky', bub.get('b') and 'noorden' in bub['b'].lower() and not ceska_slova(bub['b']), bub)
        await page.evaluate("() => { const c = document.querySelector('.ag-tp-close'); if (c) c.click(); }")
        DUMP = """(sel) => { const root = document.querySelector(sel); if (!root) return null;
            const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const out = [];
            while (w.nextNode()) { const t = w.currentNode.nodeValue.trim(); if (t) out.push(t); } return out; }"""
        await page.evaluate("() => new Promise(res => AGLazy.need('js/historie-aktualizaci.js', () => { AGHistorie.open(); res(); }))")
        await page.wait_for_timeout(3000)
        hist = await page.evaluate(DUMP, '.hist-ov') or []
        zb = sorted(set(w for t in hist for w in ceska_slova(t)))
        ok(u'N3 Historie aktualizací: bez češtiny (%d uzlů)' % len(hist), hist and not zb, zb[:10])
        ok(u'N3 Historie: dny slovy nizozemsky', any(re.match(u'^(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag) \\d+ ', t, re.I) for t in hist), [t for t in hist if re.search(u'\\d{4}$', t)][:2])
        await page.evaluate("() => AGHistorie.close()")
        # názvy zemí v Nastavení → Země měření (select naplněný z registru, přeložený přes t())
        zeme = await page.evaluate("""() => { try { if (window.AGSettings && AGSettings.reveal) AGSettings.reveal('s-zeme'); } catch (e) {}
            var s = document.getElementById('s-zeme'); if (!s) return null; return Array.from(s.options).map(o => o.textContent.trim()); }""")
        ok(u'N3 Země měření: názvy zemí nizozemsky (Nederland, Tsjechië, Duitsland)', zeme and any('Nederland' in z for z in zeme) and any(u'Tsjechië' in z for z in zeme) and any('Duitsland' in z for z in zeme), (zeme or [])[:8])
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
