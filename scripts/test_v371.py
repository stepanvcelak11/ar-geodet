# -*- coding: utf-8 -*-
u"""Regrese k v371 (18. 9. 2026 noc) — PRŮCHOD APPKOU po v365–v370 („projdi apku a upravuj, co nefunguje,
vizuálně nesedí"):

  J1  data/jazyky.json: francouzský sloupec vzorů (re) není opsaný z italštiny (v368 měl 168 z 188 vzorů
      italsky: „GPS senza fix 8 s · posizione incerta" ve francouzské appce); vzor „X MB z Y MB" bere i GB;
      vzor deníku bere „1 bod / 2 body / 5 bodů".
  J2  texty po přestavbě Nastavení (v365) a podkladu (v360): „Země měření" je v Mapa a body (ne Zakázka a data),
      vektorová mapa se zapíná „Vrstvy → Podklad → Mapa" (ne Vektor) — ve zdrojích, slovnících i návodech.
  N1  Skoky do Nastavení vedou na správnou stránku: filtr-info „Zobrazit filtry" na kartu Časté (chipy druhů),
      „Max. bodů v AR" na kartu Časté; tlačítko Změnit u „Země měření" v panelu Mapa a tlačítko Nastavení
      u „Přesnost z mapy" na stránku Mapa a body.
  N2  Karta „Měříš v zemi": souřadnice TÉ země (PL → PL-2000), ne právě aktivního Česka; věta o Nastavení říká
      Mapa a body; tlačítko „Co tu appka umí" je skutečné tlačítko (.btn), ne nestylovaný prvek.
  N3  Nástroje: dlaždice „Náčrt bodu na mapě" existuje (registr ji znal, modul ji nevyráběl → hledání i seznam
      úkonů vedly do prázdna); Parcela má jeden ovladač minimalizace (data-ag-mini-off) a kulatá tlačítka.
  N4  Čísla česky s čárkou: Údržba „Využito 0,0 MB z ~3,0 GB", Funguje mi všechno? „±3,0 m", Slunce „stín 9,5 m",
      Bezpečnost S-JTSK „741 789,46".

Spouští se z kořene repa (vlastní port 9371, vlastní server):
    python scripts/test_v371.py
"""
import io, os, re, sys, json, asyncio
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as V
from ag_boot import boot
PORT = 9371
OKS = []


def ok(n, c, info=''):
    OKS.append(bool(c)); print(('OK    ' if c else 'CHYBA ') + n + ('' if c else '  -- %s' % (info,)))


def cti(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def nacti(rel):
    return json.loads(cti(rel))


def staticke():
    core = nacti('data/jazyky.json'); L = core['poradi']
    i_it, i_fr = L.index('it') + 1, L.index('fr') + 1
    kopie = [r[0] for r in core['re'] if r[i_fr] == r[i_it] and r[1] != r[i_it] and len(r[i_it]) > 12]
    ok('J1 vzory re: fr sloupec není italština (%d vzorů)' % len(core['re']), len(kopie) <= 2, kopie[:5])
    fr = [r for r in core['re'] if r[0].startswith(u'^GPS bez fixu (\\d+) (s|min) · poloha')]
    ok(u'J1 vzor „GPS bez fixu N s · poloha nejistá" francouzsky', fr and 'sans fix' in fr[0][i_fr], fr and fr[0][i_fr])
    ok(u'J1 vzor „z ~X MB (N %) · trvalé:" bere i GB', any('(MB|GB)' in r[0] and u'trvalé' in r[0] for r in core['re']))
    ok(u'J1 vzor deníku „N bod/body/bodů bez časového razítka"', any(u'(?:bod|body|bodů) bez časového razítka' in r[0] for r in core['re']))
    ok(u'J2 jádro: klíč „Zemi změníš v Nastavení → Mapa a body → Země měření."',
       u'Zemi změníš v Nastavení → Mapa a body → Země měření.' in core['t'] and u'Zemi změníš v Nastavení → Zakázka a data → Země měření.' not in core['t'])
    ok(u'J2 zdroje-zemi.js: věta o Nastavení říká Mapa a body', u'Nastavení → Mapa a body → Země měření' in cti('js/zdroje-zemi.js') and u'Zakázka a data → Země' not in cti('js/zdroje-zemi.js'))
    zdroje = ['js/mapa-vektor.js', 'js/mapa-kvality-gps.js', 'js/mistopisny-nacrt.js', 'js/pohled-3d.js', 'data/navody.json']
    zb = [f for f in zdroje if u'Podklad → Vektor' in cti(f)]
    ok(u'J2 „Vrstvy → Podklad → Vektor" už nikde (podklad se jmenuje Mapa)', not zb, zb)
    for l in L:
        d = nacti('data/jazyky-%s.json' % l)['t']
        ok(u'J2 jazyky-%s: klíč adresy PMTiles říká „Podklad → Mapa"' % l,
           any(k.endswith(u'Vrstvy → Podklad → Mapa.') for k in d) and not any(k.endswith(u'Vrstvy → Podklad → Vektor.') for k in d))
        n = nacti('data/navody-%s.json' % l)
        ok(u'J2 navody-%s: bez „→ Vektor/Vector/Vektor/Wektor/Vettore/Vecteur"' % l,
           not re.search(u'→ (Vector|Vektor|Wektor|Vettore|Vecteur)\\b', n['pohled-3d'] + n['kvalita-gps-mapa']))
    ok(u'J2 index.html: podtitulek Zakázka a data bez „katastr" (katastr je v Mapa a body)',
       u'<b>Zakázka a data</b><small>zakázka, firemní cloud, offline, úložiště</small>' in cti('index.html'))
    ih = cti('index.html')
    ok(u'N1 index.html: Změnit u Země měření → s-zeme / tab-mapa (ne tab-data)', "AGSettings.reveal('s-zeme')" in ih and "switchTab('tab-data',document.querySelector('[data-tab=" not in ih)
    ok(u'N1 index.html: Nastavení u Přesnost z mapy → s-prichyceni / tab-mapa (ne tab-ar)', "AGSettings.reveal('s-prichyceni')" in ih and "switchTab('tab-ar',document.querySelector('.tab-btn[onclick" not in ih)
    fi = cti('js/filtr-info.js')
    ok(u'N1 filtr-info.js: skoky přes AGSettings.reveal, ne klik na tab-data/tab-ar', "AGSettings.reveal('f-tb')" in fi and "AGSettings.reveal('s-max-ar-slider')" in fi and 'tab-btn[onclick*="tab-data"]' not in fi)
    ok(u'N2 zeme-svet.js: „Co tu appka umí" je .btn (třída ag-btn-mini neexistovala)', 'class="ag-btn-mini"' not in cti('js/zeme-svet.js') and '<button type="button" class="btn btn-secondary" style="display:inline-block;width:auto' in cti('js/zeme-svet.js'))
    ok(u'N3 nacrt-na-mapu.js registruje dlaždici', "agRegisterFieldTool({ id: 'nacrt-na-mapu'" in cti('js/nacrt-na-mapu.js'))
    ok(u'N3 parcela.js: data-ag-mini-off + kulatá tlačítka hlavičky', "data-ag-mini-off" in cti('js/parcela.js') and 'border-radius:50%' in cti('js/parcela.js'))
    ok(u'N4 logika.js: Využito s čárkou a GB', "replace('.', ',')" in cti('js/logika.js').split('agRenderStorageUsage')[1][:900] and "' GB'" in cti('js/logika.js'))
    for f, needle in (('js/zdravi-appky.js', "toFixed(1).replace('.', ',')"), ('js/slunce.js', "var m1 = function"), ('js/bezpecnost.js', 'function fmtS'),
                      ('js/indoor.js', "toFixed(2).replace('.', ',')"), ('js/plakat-dne.js', "toFixed(1).replace('.', ',')"), ('js/denik-dne.js', "body.noTs === 1 ? 'bod'")):
        ok(u'N4 %s: české číslo (%s)' % (f, needle[:28]), needle in cti(f))
    ok(u'N3 test_jazyky_data hlídá opsaný sloupec vzorů', u'opsaný ze sousedního jazyka' in cti('scripts/test_jazyky_data.py'))


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        chyby = []
        init = boot(tarif='pro') + V.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agSlabsiTelefon_v1','off');"
        ctx = await br.new_context(locale='cs-CZ', viewport={'width': 412, 'height': 915}, has_touch=True, is_mobile=True,
                                   geolocation={'latitude': V.LAT, 'longitude': V.LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
        await ctx.add_init_script(init)
        page = await ctx.new_page()
        page.on('pageerror', lambda e: chyby.append(str(e)))
        await page.goto(url, wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(2500)
        await page.evaluate("() => { if (typeof startAppFromWelcome === 'function') startAppFromWelcome(); }")
        await page.wait_for_timeout(2500)
        await page.evaluate("() => { try { AGLazy.flush(); } catch (e) {} }")
        await page.wait_for_timeout(2500)

        # N1 filtr-info → karta Časté
        r = await page.evaluate("""() => new Promise(res => {
            const go = () => { try { AGFiltrInfo.openFilters(); } catch (e) { return res({ err: String(e) }); }
                setTimeout(() => { const m = document.getElementById('settings-modal'), home = document.getElementById('set-home'), f = document.getElementById('f-tb');
                    res({ open: !!m && getComputedStyle(m).display !== 'none', home: !!home && !home.hidden, page: m && m.getAttribute('data-page'), fVis: !!f && f.closest('.st-chip') && f.closest('.st-chip').getBoundingClientRect().width > 0 }); }, 700); };
            if (window.AGFiltrInfo) go(); else res({ err: 'AGFiltrInfo chybí' }); })""")
        ok(u'N1 „Zobrazit filtry" otevře Nastavení na kartě Časté s chipy druhů', r.get('open') and r.get('home') and r.get('fVis') and not r.get('page'), r)
        await page.evaluate("() => { try { document.getElementById('settings-modal').style.display = 'none'; document.getElementById('settings-modal').classList.remove('ag-open'); } catch (e) {} }")
        # N1 Změnit u Země měření (panel Mapa) → tab-mapa, select s-zeme viditelný
        r = await page.evaluate("""() => new Promise(res => { const b = document.querySelector('#ms-zeme button'); if (!b) return res({ err: 'bez tlačítka' }); b.click();
            setTimeout(() => { const m = document.getElementById('settings-modal'), s = document.getElementById('s-zeme');
                res({ page: m && m.getAttribute('data-page'), sVis: !!s && s.getBoundingClientRect().width > 0 }); }, 700); })""")
        ok(u'N1 Změnit u Země měření → stránka Mapa a body, výběr země vidět', r.get('page') == 'tab-mapa' and r.get('sVis'), r)
        await page.evaluate("() => { try { agSettingsHome(); document.getElementById('settings-modal').style.display = 'none'; document.getElementById('settings-modal').classList.remove('ag-open'); } catch (e) {} }")
        r = await page.evaluate("""() => new Promise(res => { const b = document.querySelector('#ms-presnost button'); if (!b) return res({ err: 'bez tlačítka' }); b.click();
            setTimeout(() => { const m = document.getElementById('settings-modal'), s = document.getElementById('s-prichyceni');
                res({ page: m && m.getAttribute('data-page'), sVis: !!s && s.closest('.st-row') && s.closest('.st-row').getBoundingClientRect().width > 0 }); }, 700); })""")
        ok(u'N1 Nastavení u Přesnost z mapy → stránka Mapa a body, řádek přichytávání vidět', r.get('page') == 'tab-mapa' and r.get('sVis'), r)
        # N2 karta „Měříš v zemi" pro PL: souřadnice PL-2000, věta Mapa a body; tlačítko Co tu appka umí = .btn
        r = await page.evaluate("""() => new Promise(res => { const go = () => { const k = AGZdroje.uvodHtml('PL'); const co = document.getElementById('s-zeme-co');
                res({ title: k.title, pl2000: /PL-2000/.test(k.html), jtsk: /S-JTSK/.test(k.html), veta: /Mapa a body/.test(k.html), btn: !!co && !!co.querySelector('button.btn') }); };
            if (window.AGZdroje) go(); else AGLazy.need('js/zdroje-zemi.js', go); })""")
        ok(u'N2 karta pro Polsko: PL-2000 (ne S-JTSK), věta Mapa a body', r.get('pl2000') and not r.get('jtsk') and r.get('veta'), r)
        ok(u'N2 „Co tu appka umí" je tlačítko .btn', r.get('btn'), r)
        # N3 dlaždice Náčrt bodu na mapě
        r = await page.evaluate("""() => new Promise(res => { const go = () => setTimeout(() => res({ tile: !!document.querySelector('#tools-modal .tool-tile[data-tool="nacrt-na-mapu"]'), run: !!(window.AGReg && AGReg.get && AGReg.get('nacrt-na-mapu')) }), 300);
            if (window.AGNacrtMapa) go(); else AGLazy.need('js/nacrt-na-mapu.js', go); })""")
        ok(u'N3 dlaždice „Náčrt bodu na mapě" existuje a seznam úkonů ji zná', r.get('tile') and r.get('run'), r)
        # N4 Údržba: Využito s čárkou, kvóta v GB (Chromium hlásí kvótu v GB)
        r = await page.evaluate("""() => new Promise(res => { const go = async () => { await agRenderStorageUsage(); res((document.getElementById('storage-usage') || {}).innerHTML || ''); };
            if (typeof agRenderStorageUsage === 'function') go(); else res(''); })""")
        ok(u'N4 Údržba: „Využito 0,0 MB z ~N GB" (čárka, GB)', re.search(u'Využito <b>\\d+,\\d MB</b> z ~[\\d,]+ (GB|MB)', r) is not None and '.0 MB' not in r, r[:120])
        # N4 Funguje mi všechno? — GPS ±3,0 m
        r = await page.evaluate("""() => new Promise(res => { const go = () => { try { AGZdravi.open(); } catch (e) { return res({ err: String(e) }); }
                setTimeout(() => { const t = document.body.innerText; const m = t.match(/±\\d[.,]\\d m/); res({ m: m && m[0] }); }, 2500); };
            if (window.AGZdravi) go(); else AGLazy.need('js/zdravi-appky.js', go); })""")
        ok(u'N4 Funguje mi všechno?: přesnost „±3,0 m" s čárkou', r.get('m') and ',' in r['m'], r)
        ok('bez chyb stránky', not chyby, chyby[:3])
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
