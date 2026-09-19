# -*- coding: utf-8 -*-
u"""Regrese k v378 (19. 9. 2026 odp.) — čtvrté kolo hodnocení, dávka 1: G1 + G2 + E1 + E2.

  G1  CI bylo červené od v373 kvůli scripts/test_v372.py, který chtěl `verze[0].v == 372`
      a přesné SHELL_CACHE. Teď hledá záznam podle čísla a porovnává >=; scripts/check_texty.py
      hlídá, že žádný test_v*.py nepřibíjí aktuální číslo vydání.
  G2  Jednoduchý režim: první GPS fix přišel dřív než grafika.js → toast „updateInfoPanel is not
      defined". logika.js volá přes typeof; err-log.js v jednoduchém režimu toast neukazuje.
  E1  V cizině žádná čeština: sour-zeme.js místo české hlášky „Jsi v zemi" přivolá zdroje-zemi.js
      (karta přeložená); panel Body „Mé body (<systém země>)"; vyska-gps.js „(Bpv)" jen v ČR;
      hláška „GPS nedodává čerstvé fixy (N s)" má vzor ve slovníku; název země v kartě přes T().
  E2  Mimo ČR se na ČÚZK nesahá (fetchGeodata); registr má `zeme` a seznam úkonů nekreslí
      cadastre-vector / cadastre-area / oblasti-offline / nacrt-na-mapu / predpisy mimo jejich země;
      „Katastr — kde stojím" otevře portál země (AGZdroje.portal); Bright Sky jen u DWD zemí.

  Prohlížeč: start Pro ve Vídni (de-AT) — žádný český dialog, karta „Du misst in: Österreich",
  0 dotazů na ags.cuzk.gov.cz, panel Body „(MGI / Austria GK M34)", seznam úkonů bez oblasti-offline,
  Katastr → window.open na kataster.bev.gv.at; simulace CZ → řádky se vrátí. Jednoduchý režim v Praze
  bez toastu „Něco se pokazilo".

Spouští se z kořene repa (vlastní port 9378, vlastní server):
    python scripts/test_v378.py
"""
import io, os, re, sys, json, asyncio
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as V
from ag_boot import boot
PORT = 9378
CZ = re.compile(u'[ěščřžýůďťňĚŠČŘŽÝŮĎŤŇ]')
OKS = []


def ok(n, c, info=''):
    OKS.append(bool(c)); print(('OK    ' if c else 'CHYBA ') + n + ('' if c else '  -- %s' % (info,)))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def nacti(rel):
    return json.load(io.open(os.path.join(ROOT, rel), encoding='utf-8'))


def staticke():
    t = src('scripts/test_v372.py')
    ok('G1 test_v372 hledá záznam v372 podle čísla, ne jako první', "v.get('v') == 372" in t and "[0]['v'] == 372" not in t)
    ok('G1 test_v372 SHELL_CACHE >= 372', 'int(m.group(1)) >= 372' in t and "'argeodet-shell-v372'" not in t)
    ct = src('scripts/check_texty.py')
    ok('G1 check_texty hlídá přibité testy vydání', 'PRIBITE' in ct and "argeodet-shell-v" in ct)
    lg = src('js/logika.js')
    ok('G2 logika.js: GPS fix volá updateInfoPanel přes typeof', lg.count("if (typeof updateInfoPanel === 'function') updateInfoPanel();") >= 1 and "else if (typeof updateInfoPanel === 'function') { updateInfoPanel(); }" in lg)
    ok('G2 err-log.js: v jednoduchém režimu bez toastu', "agJednoduchy_v1') === '1') return;" in src('js/err-log.js'))
    sz = src('js/sour-zeme.js')
    ok(u'E1 sour-zeme.js: česká hláška „Jsi v zemi" je pryč, přivolá se zdroje-zemi.js', "'Jsi v zemi: '" not in sz and "AGLazy.need('js/zdroje-zemi.js')" in sz)
    ok(u'E1 index.html: „Mé body" + #manage-crs', 'id="manage-crs"' in src('index.html') and u'Mé body (S-JTSK)</h2>' not in src('index.html'))
    ok(u'E1 grafika.js: manage-crs z registru zemí', "manage-crs" in src('js/grafika.js') and "AGSour.crs().nazev" in src('js/grafika.js'))
    vg = src('js/vyska-gps.js')
    ok(u'E1 vyska-gps.js: výškový systém země místo „(Bpv)"', "_z.vyska.nazev" in vg and "T('Výška z GPS') + ' (' + vs + ')'" in vg)
    zz = src('js/zdroje-zemi.js')
    ok(u'E1 zdroje-zemi.js: název země a ortofota přes T()', "T('Měříš v zemi') + ': ' + T(jm)" in zz and "esc(T(orto.nazev))" in zz)
    core = nacti('data/jazyky.json')
    n = len(core['poradi'])
    ok(u'E1 jádro: vzor „GPS nedodává čerstvé fixy (N s)"', any(r[0].startswith(u'^GPS nedodává čerstvé fixy') and len(r) == n + 1 for r in core['re']))
    ok(u'E1 jádro: obecný vzor „země · systém (osy) · výšky X · deklinace"', any(u'· výšky (.+) · deklinace' in r[0] for r in core['re']))
    for l in core['poradi']:
        d = nacti('data/jazyky-%s.json' % l)['t']
        ok(u'E1/E2 rozšíření %s: nové klíče' % l, u'Výška z GPS' in d and u'Esri World Imagery (svět)' in d and u'Katastr země' in d and not any(CZ.search(d[k]) for k in (u'Výška z GPS', u'Katastr země')))
    ok(u'E2 logika.js: mimo ČR se ČÚZK nevolá', 'mimoCZ' in lg and 'if (!zTelefonu && !mimoCZ) {' in lg)
    reg = src('js/tools-registry.js')
    for k in ('cadastre-vector', 'cadastre-area', 'oblasti-offline', 'nacrt-na-mapu'):
        ok(u'E2 registr: %s jen v CZ' % k, "{ k: '%s', zeme: ['CZ']," % k in reg)
    ok(u'E2 registr: predpisy CZ+SK', "{ k: 'predpisy', zeme: ['CZ', 'SK']," in reg)
    nu = src('js/nastroje-ukony.js')
    ok(u'E2 nastroje-ukony.js: skryto() = hidden nebo mimo zemi, otisk zná zemi', 'function mimoZemi(' in nu and 'function skryto(' in nu and "'|z:' + zemeKod()" in nu and 'HIDDEN[k]' not in nu.replace('HIDDEN[k] || mimoZemi(k)', ''))
    ok(u'E2 zdroje-zemi.js: PORTALY + portal()', 'var PORTALY = {' in zz and 'function portal()' in zz and 'zbgis.skgeodesy.sk' in zz and 'geoportail.gouv.fr' in zz)
    ok(u'E2 grafika.js: openKatastr → AGZdroje.portal()', 'AGZdroje.portal()' in src('js/grafika.js'))
    ok(u'E2 pocasi.js: Bright Sky jen u DWD zemí', 'bsZde' in src('js/pocasi.js') and "j && parseBrightsky(j)" in src('js/pocasi.js'))


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        # --- Vídeň, telefon německy ------------------------------------------------------
        chyby = []; cuzk = []
        init = boot(tarif='pro') + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off'); localStorage.removeItem('agZemeUvod_v1'); localStorage.removeItem('agJazyk'); localStorage.removeItem('agLang'); window.__opened = []; window.open = function (u) { window.__opened.push(u); return null; };"
        ctx = await br.new_context(locale='de-AT', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': 48.2082, 'longitude': 16.3738, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        await ctx.add_init_script(init)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)))
        page.on('request', lambda r: cuzk.append(r.url) if 'cuzk.gov.cz' in r.url or 'cuzk.cz' in r.url else None)
        await page.route('**/*', V.route_vse)
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        await V.cekej(page, "document.body.classList.contains('app-started')", 40)
        d = None
        for _ in range(10):
            d = await page.evaluate("() => { const ov = document.querySelector('.ag-dlg-overlay.open'); if (!ov) return null; return { t: (ov.querySelector('.ag-dlg-title')||{}).textContent || '', m: ((ov.querySelector('.ag-dlg-msg')||{}).textContent || '').slice(0, 300) }; }")
            if d: break
            await page.wait_for_timeout(1000)
        ok(u'E1 Vídeň: karta „Du misst in: Österreich" (ne český toast „Jsi v zemi")', d and d['t'].startswith('Du misst in') and u'Österreich' in d['t'] and 'Rakousko' not in d['t'], d)
        ok(u'E1 Vídeň: text karty bez češtiny', d and not CZ.search(d['m'].replace(u'Tschechien', '')), d and d['m'][:200])
        await page.evaluate("() => document.querySelectorAll('.ag-dlg-overlay').forEach(o => { o.classList.remove('open'); o.remove(); })")
        await page.wait_for_timeout(3000)
        ok(u'E2 Vídeň: 0 dotazů na ČÚZK při startu', not cuzk, cuzk[:3])
        kod = await page.evaluate("() => AGSour.kod()")
        ok(u'E1 registr zemí: AT', kod == 'AT', kod)
        await page.evaluate("() => openManageModal()")
        await page.wait_for_timeout(800)
        h2 = await page.evaluate("() => document.querySelector('#manage-modal h2').textContent.replace(/\\s+/g, ' ').trim()")
        ok(u'E1 panel Body: „Meine Punkte (MGI / Austria GK M34)"', 'S-JTSK' not in h2 and 'MGI' in h2 and 'Meine Punkte' in h2, h2)
        await page.evaluate("() => { document.getElementById('manage-modal').style.display = 'none'; }")
        # seznam úkonů: rozbalit rozcestníky, hledat klíče
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(2000)
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(600)
        for _ in range(3):
            await page.evaluate("() => document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click())")
            await page.wait_for_timeout(250)
        keys = await page.evaluate("() => [...document.querySelectorAll('#tools-modal .ag-uk-i[data-k]')].map(r => r.getAttribute('data-k'))")
        ok(u'E2 Vídeň: seznam úkonů bez oblasti-offline / cadastre-area / cadastre-vector / nacrt-na-mapu / predpisy', keys and not any(k in keys for k in ('oblasti-offline', 'cadastre-area', 'cadastre-vector', 'nacrt-na-mapu', 'predpisy')), [k for k in keys if k in ('oblasti-offline', 'cadastre-area', 'cadastre-vector', 'nacrt-na-mapu', 'predpisy')])
        ok(u'E2 Vídeň: ostatní nástroje zůstaly (pocasi, openKatastr, openTachymetrie)', all(k in keys for k in ('pocasi', 'openKatastr', 'openTachymetrie')), len(keys))
        await page.evaluate("() => { const r = document.querySelector('#tools-modal .ag-uk-i[data-k=\"openKatastr\"]'); r && r.click(); }")
        await page.wait_for_timeout(1200)
        op = await page.evaluate("() => window.__opened")
        kw = await page.evaluate("() => { const m = document.getElementById('agk-modal') || document.querySelector('[id^=agk]'); return m ? getComputedStyle(m).display : 'none'; }")
        ok(u'E2 Vídeň: Katastr otevře BEV portál, ne iKatastr', op and 'kataster.bev.gv.at' in op[0], (op, kw))
        # simulace návratu do ČR: řádky se vrátí
        await page.evaluate("() => document.querySelectorAll('.ag-dlg-overlay').forEach(o => o.remove())")
        await page.evaluate("() => { if (window.AGZemeSimulace) AGZemeSimulace('CZ'); else AGSour.nastav('CZ'); }")
        await page.wait_for_timeout(1500)
        await page.evaluate("() => document.querySelectorAll('.ag-dlg-overlay').forEach(o => o.remove())")
        await page.evaluate("() => { const tm = document.getElementById('tools-modal'); if (tm) tm.style.display = 'none'; }")
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(1500)
        for _ in range(3):
            await page.evaluate("() => document.querySelectorAll('#tools-modal .ag-uk-i[aria-expanded=\"false\"]').forEach(h => h.click())")
            await page.wait_for_timeout(250)
        keys2 = await page.evaluate("() => [...document.querySelectorAll('#tools-modal .ag-uk-i[data-k]')].map(r => r.getAttribute('data-k'))")
        ok(u'E2 zpět v ČR: oblasti-offline a predpisy jsou v seznamu', 'oblasti-offline' in keys2 and 'predpisy' in keys2, [k for k in ('oblasti-offline', 'predpisy') if k not in keys2])
        ok('E1/E2 Vídeň bez chyb stránky', not chyby, chyby[:3])
        await ctx.close()

        # --- Praha, jednoduchý režim: bez toastu „Něco se pokazilo" --------------------------
        chyby2 = []
        init2 = boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agJednoduchy_v1','1');"
        ctx2 = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                    geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        await ctx2.add_init_script(init2)
        p2 = await ctx2.new_page()
        p2.on('pageerror', lambda e: chyby2.append(str(e)))
        await p2.route('**/*', V.route_vse)
        await p2.goto(url, wait_until='domcontentloaded', timeout=60000)
        await V.cekej(p2, "document.body.classList.contains('app-started')", 40)
        await p2.wait_for_timeout(3500)
        txt = await p2.evaluate("() => document.body.innerText")
        ok(u'G2 jednoduchý režim: obrazovka bez „Něco se pokazilo"', u'Něco se pokazilo' not in txt and 'updateInfoPanel' not in txt, [l for l in txt.split('\n') if u'pokazilo' in l][:2])
        jr = await p2.evaluate("() => document.body.classList.contains('ag-jr-on')")
        ok(u'G2 jednoduchý režim běží', jr)
        # simulovaná chyba: v jednoduchém režimu jde jen do protokolu, ne do toastu
        await p2.evaluate("() => { try { AG.swallow(new Error('zkouska-jr'), 'test:jr'); } catch (e) {} }")
        await p2.wait_for_timeout(1500)
        txt2 = await p2.evaluate("() => document.body.innerText")
        ok(u'G2 jednoduchý režim: AG.swallow neukáže toast', 'zkouska-jr' not in txt2)
        ok('G2 bez chyb stránky', not chyby2, chyby2[:3])
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
