# -*- coding: utf-8 -*-
u"""Regrese k v372 (18. 9. 2026 večer; v371 vzala souběžná session) — třetí kolo hodnocení, návrhy T1–T6 (vybráno vše):

  T1  START BEZ SIGNÁLU: nová instalace bez internetu (worker i data mapy nedostupné) — na bráně
      se NEUKÁŽE toast „Něco se pokazilo“ ani „Mapa jede z rastru“; mapa-vektor hlásí síťový stav.
  T2  ROZCESTNÍKY: žádná hláška neposílá do zrušeného menu „Více“ (scripts/check_texty.py projde);
      panel Body ukazuje cestu ke koši „Nástroje → Zaznamenat → Obnovit smazaný bod“; záložka
      v Nástrojích se jmenuje „Další nástroje“ (EN „Other tools“, ne „Next“).
  T3  CI: test_v358/test_v365 berou počet jazyků z jádra (poradi), fr-FR čeká fr; test_slabsi_dosah
      a test_v371 jsou v tests.yml; release-check má krok „Posledni regrese“; konzole vlastníka má
      řádek #agv-regrese.
  T4  VIZUÁL: Tachymetrie na 390 px — všechna tlačítka lišty uvnitř displeje; dok při písmu 130 %
      má „Nástroje“ a „Nastavení“ na jednom řádku; karta úředního bodu se 4 akcemi = mřížka 2×2.
  T5  STAV SPOJENÍ: AGSpojeni počítá z výsledků fetch — při aborted cizích požadavcích je stav
      „slaby“ a detail GPS říká „Signál slabý“; po úspěšné odpovědi „chodi“ a „Data chodí“.
  T6  JAZYKY: v EN Novém bodu žádné české texty (kód kvality, Proč?, výška terénu); francouzské
      vzory `re` nejsou kopie italštiny (kromě 4 shodných slov); Co je nového v371 v 7 souborech.

Spouští se z kořene repa (vlastní port 9371, vlastní server):
    python scripts/test_v372.py
"""
import io, os, re, sys, json, asyncio
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as V
from ag_boot import boot
PORT = 9372
CZ = re.compile(u'[ěščřžýůďťňĚŠČŘŽÝŮĎŤŇ]')
OKS = []


def ok(n, c, info=''):
    OKS.append(bool(c)); print(('OK    ' if c else 'CHYBA ') + n + ('' if c else '  -- %s' % (info,)))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def staticke():
    print('--- staticke ---')
    import subprocess
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'check_texty.py')], capture_output=True, text=True, encoding='utf-8', errors='replace')
    ok('T2 check_texty.py projde (žádné „Více →“ v hláškách)', r.returncode == 0, r.stdout[-300:])
    ok('T2 nastroje-ukony: záložka „Další nástroje“', "page(PAGE_DALSI, 'Další nástroje', 'Další nástroje')" in src('js/nastroje-ukony.js'))
    ok('T2 release-check volá check_texty', 'check_texty.py' in src('.github/workflows/release-check.yml'))
    ok('T1 mapa-vektor: selhání dat = síťový stav (e.sitova), bez toastu v tichém režimu', 'e.sitova = true' in src('js/mapa-vektor.js') and "if (e && e.sitova) {" in src('js/mapa-vektor.js'))
    t358 = src('scripts/test_v358.py'); t365 = src('scripts/test_v365.py')
    ok('T3 test_v358 bere počet jazyků z jádra', "len(d['poradi'])" in t358 and "== 5)" not in t358)
    ok('T3 test_v365 bere počet jazyků z jádra a fr-FR čeká fr', "len(d['poradi'])" in t365 and "('fr-FR', 'fr'" in t365 and "('fr-FR', 'en'" not in t365)
    ty = src('.github/workflows/tests.yml')
    ok('T3 tests.yml má test_slabsi_dosah a test_v372', 'test_slabsi_dosah' in ty and 'test_v372' in ty)
    ok('T3 release-check: krok Posledni regrese', 'Posledni regrese nad main' in src('.github/workflows/release-check.yml'))
    ok('T3 konzole vlastníka: řádek regrese', "id=\"agv-regrese\"" in src('js/vlastnik.js') and 'workflows/tests.yml/runs' in src('js/vlastnik.js'))
    ok('T4 tachymetrie: lišta se na telefonu zalomí', 'flex-wrap:wrap;overflow-x:visible' in src('js/tachymetrie.js'))
    ok('T4 dok: popisek i chip rostou jen do 1,2×', src('css/style.css').count('min(1.2, var(--ag-font-scale, 1))') >= 4)
    ok('T4 karta bodu: 4 akce = mřížka 2×2', '#ag-kb-acts:has(> button:nth-child(4)){display:grid' in src('js/karta-bodu-plus.js'))
    ok('T5 stavovy-pruh: AGSpojeni + obal fetch', 'window.AGSpojeni' in src('js/stavovy-pruh.js') and "__agSpoj" in src('js/stavovy-pruh.js') and "t: 'Signál slabý'" in src('js/stavovy-pruh.js'))
    ok('T5 logika: pilulka po 15 s bez odpovědi', 'Body z ČÚZK nedošly' in src('js/logika.js'))
    ok('T6 qc-engine a vyska-gps přes AGJazyk.t()', "T('horší než kód 5')" in src('js/qc-engine.js') and "T('Proč?')" in src('js/qc-engine.js') and "T('Výška terénu DMR 5G')" in src('js/vyska-gps.js'))
    core = json.load(io.open(os.path.join(ROOT, 'data', 'jazyky.json'), encoding='utf-8'))
    n = len(core['poradi']); ifr = core['poradi'].index('fr'); iit = core['poradi'].index('it')
    same = [r[0] for r in core['re'] if r[1 + ifr] == r[1 + iit]]
    ok('T6 fr vzory nejsou kopie it (zbývají jen shodná slova: Base, sat., ŠD, novembre)', len(same) <= 4, same[:8])
    ok('T6 jádro: vzor „Něco se pokazilo“ vede do Nástrojů', any('Detail: Nástroje → Další nástroje → Protokol chyb' in r[0] for r in core['re']))
    ok('T5 jádro: vzory „Signál slabý“ (3 nové)', sum(1 for r in core['re'] if r[0].startswith('^Telefon hlásí internet') or r[0].startswith('^Internet je, poslední odpověď')) == 3)
    for l in core['poradi']:
        d = json.load(io.open(os.path.join(ROOT, 'data', 'jazyky-%s.json' % l), encoding='utf-8'))['t']
        ok('T2/T5 slovník %s: nové cesty a stavy' % l, 'Signál slabý' in d and 'Data chodí' in d and any('Nástroje → Zaznamenat → Obnovit smazaný bod' in k for k in d) and not any('Více → ' in k for k in d), [k for k in d if 'Více → ' in k][:3])
    for f in ['co-je-noveho.json'] + ['co-je-noveho-%s.json' % l for l in core['poradi']]:
        d = json.load(io.open(os.path.join(ROOT, 'data', f), encoding='utf-8'))
        # ⚠ NE „první záznam je v372": ten test padal každé další vydání (v373–v377 měly
        #   červené CI jen kvůli němu, 19. 9. 2026 G1). Hlídá se, že záznam v372 EXISTUJE.
        z = [v for v in d['verze'] if v.get('v') == 372]
        ok('Co je nového v372: %s' % f, len(z) == 1 and len(z[0]['body']) == 6)
    m = re.search(r"argeodet-shell-v(\d+)", src('sw.js'))
    ok('SHELL_CACHE >= v372', "argedet" not in src('sw.js') and bool(m) and int(m.group(1)) >= 372)


VIS_TEXTS = """() => {
  const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const t = n.textContent.trim(); if (!t || t.length < 3) continue; const el = n.parentElement; if (!el) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    let p = el, hid = false; while (p && p !== document.body) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') { hid = true; break; } p = p.parentElement; }
    if (!hid) out.push(t.slice(0, 240)); }
  return out; }"""
TOAST_HOOK = """(function () { window.__agToasty = []; var iv = setInterval(function () { if (typeof window.quickToast === 'function' && !window.quickToast.__hook) { var p = window.quickToast; var q = function (m) { window.__agToasty.push(String(m)); return p.apply(this, arguments); }; q.__hook = 1; window.quickToast = q; clearInterval(iv); } }, 50); })();"""


async def ctx_page(br, url, init, w=390, h=844, locale='cs-CZ', scheme='dark', chyby=None):
    ctx = await br.new_context(locale=locale, viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block', color_scheme=scheme)
    page = await ctx.new_page()
    if chyby is not None:
        page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)[:200]))
    await page.route('**/*', V.route_vse)
    await page.add_init_script(TOAST_HOOK + (init or ''))
    await page.goto(url, wait_until='domcontentloaded', timeout=60000)
    return ctx, page


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        chyby = []

        print('--- T1 nová instalace bez signálu ---')
        ctx, page = await ctx_page(br, url, '', chyby=chyby)
        await page.wait_for_timeout(7000)
        toasty = await page.evaluate('() => window.__agToasty || []')
        vis = await page.evaluate("() => { const t = document.getElementById('quick-toast'); return t ? (t.style.opacity !== '0' ? t.innerText : '') : ''; }")
        ok('T1 na bráně žádný toast „Něco se pokazilo“ / „Mapa jede z rastru“', not [t for t in toasty if 'Něco se pokazilo' in t or 'Mapa jede z rastru' in t] and 'Něco se pokazilo' not in vis, toasty[:4])
        st = await page.evaluate("() => window.AGMapaVektor ? [AGMapaVektor.stav(), AGMapaVektor.chyba()] : null")
        ok('T1 mapa-vektor: stav chyba se síťovým textem (bez signálu)', st and st[0] == 'chyba' and 'bez signálu' in (st[1] or ''), st)
        ok('T1 brána je vidět (Přihlásit se)', any('Přihlásit' in t for t in await page.evaluate(VIS_TEXTS)))
        await ctx.close()

        print('--- T5 slabý signál: všechno cizí padá ---')
        ctx, page = await ctx_page(br, url, boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');", chyby=chyby)
        async def abort_cizi(route, request):
            try:
                if request.url.startswith('http://127.0.0.1'): await route.continue_()
                else: await route.abort()
            except Exception:
                pass
        await page.route('**/*', abort_cizi)   # nad route_vse: cizí padá vždy (i ČÚZK identify, které route_vse plní)
        await V.cekej(page, "document.body.classList.contains('app-started')", 40)
        await page.wait_for_timeout(2500)
        await page.evaluate("() => Promise.all([fetch('https://ags.cuzk.gov.cz/x').catch(() => 0), fetch('https://ar-geodet-api.ar-geodet.workers.dev/health').catch(() => 0)])")
        await page.wait_for_timeout(800)
        sp = await page.evaluate("() => window.AGSpojeni ? AGSpojeni.stav() : null")
        ok('T5 AGSpojeni: při padajících požadavcích stav „slaby“', sp and sp['k'] == 'slaby' and sp['selhani'] >= 2, sp)
        await page.evaluate("() => window.AGStatusBar && AGStatusBar.open()")
        await page.wait_for_timeout(1800)
        dbg = await page.evaluate("() => [typeof AGStatusBar, (document.getElementById('ag-sp') || {}).className, (document.getElementById('ag-sp') || {innerText: ''}).innerText.slice(0, 120)]")
        vis = await page.evaluate("() => { const b = document.querySelector('#ag-sp .ag-sp-body'); return b ? b.innerText.split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean) : []; }")
        ok('T5 detail GPS: „Telefon hlásí internet, ale data nechodí“ místo „Internet je“', any(t.startswith('Telefon hlásí internet, ale data nechodí') for t in vis) and not any('Internet je' in t for t in vis), (vis, dbg))
        ok('T2 detail GPS: tip vede do Nastavení → Zakázka a data', any('Nastavení → Zakázka a data' in t for t in vis) or not any('Uložit pro offline' in t for t in vis), [t for t in vis if 'offline' in t][:3])
        await page.evaluate("() => window.AGStatusBar && AGStatusBar.close()")
        # úspěšná cizí odpověď → chodi
        await page.route('https://spojeni.test/**', lambda route, req: asyncio.ensure_future(route.fulfill(status=200, content_type='text/plain', body='ok', headers={'Access-Control-Allow-Origin': '*'})))
        await page.evaluate("() => fetch('https://spojeni.test/ping').then(r => r.text()).catch(() => null)")
        await page.wait_for_timeout(600)
        sp2 = await page.evaluate("() => window.AGSpojeni ? AGSpojeni.stav() : null")
        ok('T5 AGSpojeni: po úspěšné odpovědi „chodi“', sp2 and sp2['k'] == 'chodi', sp2)
        # T2 — panel Body: cesta ke koši (v panelu hromadných akcí za „Vybrat")
        await page.evaluate("() => openManageModal()")
        await page.wait_for_timeout(1200)
        await page.evaluate("() => { const b = [...document.querySelectorAll('#manage-modal button')].find(b => b.textContent.trim() === 'Vybrat'); b && b.click(); }")
        await page.wait_for_timeout(700)
        vis = await page.evaluate(VIS_TEXTS)
        ok('T2 Body: koš = Nástroje → Zaznamenat → Obnovit smazaný bod', any('Nástroje → Zaznamenat → Obnovit smazaný bod' in t for t in vis) and not any('Více → Koš' in t for t in vis), [t for t in vis if 'koš' in t][:2])
        await page.evaluate("() => { document.getElementById('manage-modal').style.display = 'none'; }")
        # T2 — Nástroje: záložka Další nástroje
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(2500)
        tabs = await page.evaluate("() => [...document.querySelectorAll('#tools-modal .ag-uk-tab')].map(t => t.textContent.trim())")
        ok('T2 Nástroje: záložka „Další nástroje“', 'Další nástroje' in tabs and 'Další' not in tabs, tabs)
        # T4 — Tachymetrie na 390 px: všechna tlačítka lišty uvnitř
        await page.evaluate("() => { const r = document.querySelector('#tools-modal .ag-uk-i[data-k=\"openTachymetrie\"]'); r && r.click(); }")
        await page.wait_for_timeout(2500)
        await page.evaluate('() => window.AGLazy && AGLazy.flush()')
        await page.wait_for_timeout(800)
        tb = await page.evaluate("() => [...document.querySelectorAll('#tachy-actions .tb-btn, #tachy-actions .tb-sel')].map(b => ({t: (b.textContent || b.title || '').trim().slice(0, 12), r: Math.round(b.getBoundingClientRect().right), w: Math.round(b.getBoundingClientRect().width)}))")
        ok('T4 Tachymetrie: lišta má prvky a všechny končí uvnitř 390 px', len(tb) >= 8 and all(b['r'] <= 390 and b['w'] > 0 for b in tb), tb)
        await page.evaluate("() => { const m = document.getElementById('tachy-modal'); if (m) m.style.display = 'none'; document.querySelectorAll('[id$=\"-modal\"], .modal-overlay').forEach(x => { if (x.id !== 'welcome-screen') x.style.display = 'none'; }); }")
        await page.wait_for_timeout(500)
        # T4 — karta úředního bodu: 4 akce v mřížce
        r = await page.evaluate("() => { const m = [...document.querySelectorAll('.leaflet-marker-icon')].find(e => e.textContent.trim() === '1047'); if (!m) return null; const b = m.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }")
        ok('T4 značka 1047 v mapě', bool(r), r)
        if r:
            await page.touchscreen.tap(r[0], r[1])
            await page.wait_for_timeout(2500)
            acts = await page.evaluate("() => { const a = document.getElementById('ag-kb-acts'); if (!a) return null; const bs = [...a.querySelectorAll('button')]; return {n: bs.length, disp: getComputedStyle(a).display, hs: bs.map(b => Math.round(b.getBoundingClientRect().height)), ws: bs.map(b => Math.round(b.getBoundingClientRect().width))}; }")
            ok('T4 karta bodu: 4 akce, mřížka, stejně vysoké, ≥ 150 px široké', acts and acts['n'] == 4 and acts['disp'] == 'grid' and max(acts['hs']) - min(acts['hs']) <= 2 and min(acts['ws']) >= 150, acts)
        await ctx.close()

        print('--- T4 dok při písmu 130 % (světlý) ---')
        ctx, page = await ctx_page(br, url, boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agDarkDefault1','1'); localStorage.setItem('default_arVisSettings12', JSON.stringify({mode:'light', fontScale:1.3, theme:'smaragd'}));", scheme='light', chyby=chyby)
        await V.cekej(page, "document.body.classList.contains('app-started')", 40)
        await page.wait_for_timeout(2000)
        lab = await page.evaluate("""() => [...document.querySelectorAll('#dock .dock-btn > span:not(.dock-fab)')].map(s => { const rg = document.createRange(); rg.selectNodeContents(s); return {t: s.textContent.trim(), lines: rg.getClientRects().length, fs: getComputedStyle(s).fontSize}; })""")
        ok('T4 dok 130 %: „Nástroje“ a „Nastavení“ na jednom řádku (popisek 12 px, chip 67 px)', all(l['lines'] == 1 for l in lab if l['t'] in ('Nástroje', 'Nastavení')) and all(abs(float(l['fs'].replace('px', '')) - 12) < 0.2 for l in lab), lab)
        await ctx.close()

        print('--- T6 angličtina: Nový bod bez češtiny ---')
        ctx, page = await ctx_page(br, url, boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.removeItem('agJazyk_v1');", locale='en-US', chyby=chyby)
        await V.cekej(page, "document.body.classList.contains('app-started')", 40)
        await page.wait_for_timeout(2500)
        await page.evaluate("() => document.getElementById('dock-nastroje-btn').click()")
        await page.wait_for_timeout(2000)
        tabs = await page.evaluate("() => [...document.querySelectorAll('#tools-modal .ag-uk-tab')].map(t => t.textContent.trim())")
        ok('T2 EN: záložka „Other tools“ (ne „Next“)', 'Other tools' in tabs and 'Next' not in tabs, tabs)
        await page.evaluate("() => { document.getElementById('tools-modal').style.display = 'none'; }")
        await page.evaluate("() => openNewPointModal()")
        await page.wait_for_timeout(4000)
        vis = await page.evaluate(VIS_TEXTS)
        zb = [t for t in vis if CZ.search(t) and not re.search(u'ČÚZK|ČHMÚ|Křovák|Bpv|S-JTSK|Testovací|Tester|Praha', t)]
        ok('T6 EN Nový bod: žádné české texty (kód kvality, Proč?, výška terénu…)', not zb, zb[:6])
        ok('T6 EN Nový bod: štítek výšky přeložený', any('Terrain height' in t for t in vis) or not any('DMR 5G' in t for t in vis), [t for t in vis if 'DMR' in t][:3])
        await ctx.close()

        ok('0 chyb stránky ve všech bězích', not chyby, chyby[:3])
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
