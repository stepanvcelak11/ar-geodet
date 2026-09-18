# -*- coding: utf-8 -*-
u"""Regrese k v368 (18. 9. 2026) — FRANCOUZŠTINA + mapa Evropy po zemích + počasí po zemích:

  F1  data: jádro (data/jazyky.json) má fr v 'jazyky' i 'poradi' a 6 překladů u každého klíče;
      rozšíření data/jazyky-fr.json má stejné klíče jako en; navody/predpisy/ulohy/co-je-noveho-fr.json
      existují a bez českých zbytků (test_jazyky_data to hlídá obecně, tady jen že fr je v LANGS).
  F2  js/jazyky.js: LANGS má fr, detect() vrátí fr pro telefon ve francouzštině, locale() dá fr-FR.
  F3  V prohlížeči (locale fr-FR, bez uložené volby): appka běží francouzsky (detect), Nastavení
      má francouzský titulek, návod „?" u Kompasu je francouzsky, Historie aktualizací bez češtiny
      a dny slovy francouzsky.
  M1  js/mapa-vektor.js: soubor po zemi z data/mapa-dily.json (dil()) — země rozdělená na díly
      vrací <kod>-N.pmtiles podle polohy, nerozdělená <kod>.pmtiles; scripts/mapa-evropa.py existuje.
  P1  js/pocasi.js: regionální modely mají 'zeme' a modelyZde() je mimo tu zemi vynechá
      (AROME France se pro Prahu nesmí volat).

Spouští se z kořene repa (vlastní port 9368, vlastní server):
    python scripts/test_v368.py
"""
import io, os, re, sys, json, asyncio
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as V
from ag_boot import boot
PORT = 9368
# jen písmena, která francouzština NEMÁ (é á í ú jsou i francouzsky)
CZ = re.compile(u'[ěščřžýůďťňĚŠČŘŽÝŮĎŤŇ]')
OKS = []


def ok(n, c, info=''):
    OKS.append(bool(c)); print(('OK    ' if c else 'CHYBA ') + n + ('' if c else '  -- %s' % (info,)))


def nacti(rel):
    return json.load(io.open(os.path.join(ROOT, rel), encoding='utf-8'))


def ceska_slova(t):
    return [w for w in re.findall(u'[A-Za-zÀ-ž’]+', t) if CZ.search(w) and w not in (u'ČÚZK', u'ČHMÚ', u'Křovák', u'Křováka', u'Kokeš', u'Sněžka', u'Sněžku', u'ŘLP', u'ČSN', u'ČR', u'Štátna', u'sieť', u'Bpv')]


def staticke():
    core = nacti('data/jazyky.json')
    ok('F1 jádro: fr v jazyky i poradi', ['fr', u'Français'] in core['jazyky'] and core['poradi'][-1] == 'fr')
    n = len(core['poradi'])
    ok('F1 jádro: %d překladů u každého klíče, žádný prázdný' % n, all(len(v) == n and all(v) for v in core['t'].values()))
    ok('F1 jádro: vzory re mají %d sloupců' % (n + 1), all(len(r) == n + 1 for r in core['re']))
    fr = nacti('data/jazyky-fr.json'); en = nacti('data/jazyky-en.json')
    ok('F1 jazyky-fr.json: jazyk fr, stejné klíče jako en (%d)' % len(en['t']), fr.get('jazyk') == 'fr' and set(fr['t']) == set(en['t']))
    zb = [k for k, v in fr['t'].items() if v == k and len(k) > 3 and ceska_slova(k)]
    ok('F1 jazyky-fr.json: nepřeložené klíče s diakritikou', not zb, zb[:5])
    for f in ('navody', 'predpisy', 'ulohy', 'co-je-noveho'):
        ok('F1 data/%s-fr.json existuje' % f, os.path.exists(os.path.join(ROOT, 'data/%s-fr.json' % f)))
    cjn = nacti('data/co-je-noveho-fr.json'); cs = nacti('data/co-je-noveho.json')
    ok('F1 co-je-noveho-fr: stejná vydání jako česky', [v['v'] for v in cjn['verze']] == [v['v'] for v in cs['verze']])
    ok('F1 co-je-noveho-fr: v368 přeloženo (francouzština + Evropa)', any(v['v'] == 368 and u'fran' in v['nadpis'].lower() for v in cjn['verze']))
    tj = io.open(os.path.join(ROOT, 'scripts/test_jazyky_data.py'), encoding='utf-8').read()
    ok('F1 test_jazyky_data.py má fr v LANGS', "'it', 'fr'" in tj)
    jz = io.open(os.path.join(ROOT, 'js/jazyky.js'), encoding='utf-8').read()
    ok('F2 js/jazyky.js LANGS má fr', "{ c: 'fr', n: 'Français' }" in jz)
    ok('F2 js/jazyky.js detect() zná fr', "c === 'fr'" in jz)
    ok('F2 js/jazyky.js locale() fr-FR', "fr: 'fr-FR'" in jz)
    mv = io.open(os.path.join(ROOT, 'js/mapa-vektor.js'), encoding='utf-8').read()
    ok('M1 mapa-vektor.js: díly po zemi (data/mapa-dily.json, dil())', 'mapa-dily.json' in mv and 'function dil(' in mv)
    ok('M1 scripts/mapa-evropa.py existuje', os.path.exists(os.path.join(ROOT, 'scripts/mapa-evropa.py')))
    ok('M1 data/mapa-dily.json je JSON se zeměmi', isinstance(nacti('data/mapa-dily.json'), dict))
    pc = io.open(os.path.join(ROOT, 'js/pocasi.js'), encoding='utf-8').read()
    ok('P1 pocasi.js: modelyZde + zeme u regionálních modelů', 'function modelyZde(' in pc and "zeme:" in pc and 'meteofrance' in pc)


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        init = boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.removeItem('agJazyk_v1');"
        ctx = await br.new_context(locale='fr-FR', viewport={'width': 412, 'height': 915}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        await ctx.add_init_script(init)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)))
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(2500)
        await page.evaluate("() => { if (typeof startAppFromWelcome === 'function') startAppFromWelcome(); }")
        await page.wait_for_timeout(3000)
        lang = await page.evaluate("() => window.AGJazyk && AGJazyk.get()")
        ok('F3 telefon fr-FR → appka běží francouzsky (detect)', lang == 'fr', lang)
        t = await page.evaluate("() => AGJazyk.t('Nastavení')")
        ok(u'F3 t(Nastavení) = Réglages', t == u'Réglages', t)
        t = await page.evaluate("() => AGJazyk.t('Zavřít')")
        ok(u'F3 t(Zavřít) francouzsky', t and not CZ.search(t), t)
        h = await page.evaluate("() => AGReg.helpAsync('kompas').then(r => r && r.h)")
        ok(u'F3 návod Kompas je francouzsky (boussole)', h and 'boussole' in h.lower() and not ceska_slova(h), (h or '')[:120])
        await page.evaluate("() => new Promise(res => { const go = () => res(agToolHelp('kompas', 'Kompas')); if (typeof agToolHelp === 'function') go(); else AGLazy.need('js/tools-plus.js', go); })")
        await page.wait_for_timeout(1500)
        bub = await page.evaluate("() => { const b = document.getElementById('ag-tp-hm-b'), t = document.getElementById('ag-tp-hm-t'); return { t: t && t.textContent, b: b && b.textContent.slice(0, 160) }; }")
        ok(u'F3 okno „?" u Kompasu: tělo francouzsky', bub.get('b') and 'nord' in bub['b'].lower() and not ceska_slova(bub['b']), bub)
        await page.evaluate("() => { const c = document.querySelector('.ag-tp-close'); if (c) c.click(); }")
        DUMP = """(sel) => { const root = document.querySelector(sel); if (!root) return null;
            const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const out = [];
            while (w.nextNode()) { const t = w.currentNode.nodeValue.trim(); if (t) out.push(t); } return out; }"""
        await page.evaluate("() => new Promise(res => AGLazy.need('js/historie-aktualizaci.js', () => { AGHistorie.open(); res(); }))")
        await page.wait_for_timeout(3000)
        hist = await page.evaluate(DUMP, '.hist-ov') or []
        zb = sorted(set(w for t in hist for w in ceska_slova(t)))
        ok(u'F3 Historie aktualizací: bez češtiny (%d uzlů)' % len(hist), hist and not zb, zb[:10])
        ok(u'F3 Historie: dny slovy francouzsky', any(re.match(u'^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \\d+ ', t, re.I) for t in hist), [t for t in hist if re.search(u'\\d{4}$', t)][:2])
        await page.evaluate("() => AGHistorie.close()")
        await page.evaluate("() => AGJazyk.set('cs')")
        await page.wait_for_timeout(1500)
        t = await page.evaluate("() => AGJazyk.t('Nastavení')")
        ok(u'F3 po přepnutí na cs zase česky', t == u'Nastavení', t)
        # P1 počasí: regionální modely jen ve své zemi (podle místa předpovědi, ne telefonu)
        pm = await page.evaluate("() => new Promise(res => { const go = () => res({ cz: agPocasiModely(50.08, 14.43), fr: agPocasiModely(48.86, 2.35), no: agPocasiModely(60.39, 5.32) }); if (window.agPocasiModely) return go(); const sc = document.createElement('script'); sc.src = 'js/pocasi.js?t=' + Date.now(); sc.onload = go; document.head.appendChild(sc); })")
        ok('P1 Praha: ALADIN ano, AROME France ne', 'chmi_aladin_cz_1km' in pm['cz'] and 'meteofrance_arome_france_hd' not in pm['cz'], pm['cz'])
        ok(u'P1 Paříž: AROME France ano, ALADIN ne', 'meteofrance_arome_france_hd' in pm['fr'] and 'chmi_aladin_cz_1km' not in pm['fr'], pm['fr'])
        ok('P1 Bergen: MET Norway ano, globální modely všude', 'metno_nordic' in pm['no'] and 'ecmwf_ifs025' in pm['no'] and 'ecmwf_ifs025' in pm['fr'], pm['no'])
        ok('F3 bez chyb stránky', not chyby, chyby[:3])
        await br.close()


def main():
    staticke()
    srv, url = V.server(PORT)
    if not srv:
        print('CHYBA server se nespustil'); sys.exit(2)
    try:
        asyncio.run(beh(url + '?t=' + str(os.getpid())))
    finally:
        srv.terminate()
    print('\n%d/%d OK' % (sum(OKS), len(OKS)))
    sys.exit(0 if all(OKS) else 1)


if __name__ == '__main__':
    main()
