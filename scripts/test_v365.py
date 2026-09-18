# -*- coding: utf-8 -*-
"""NASTAVENÍ NANOVO 18. 9. 2026 večer (v365) — první obrazovka Časté + kategorie, stránky místo záložek.

Na přání: „nastavení je hodně složitý, nepřehledný a prostě není dobrý … to důležité vepředu, méně
používané stranou, a ať jde poznat, co kde je; Profily bych klidně celý zahodil." Vybráno 1A 2B 3A 4A.

  S  STATICKY: index.html má #set-home (karta #set-caste se šesti volbami + řádky kategorií s data-tab
     pro 8 stránek), žádná záložka Profily, žádný pruh záložek ani #ag-set-strip; js/rezim-prace.js a
     js/nastaveni-lista.js nejsou v index.html ani v sw.js; slovník má nové klíče v 5 jazycích.
  A  PRVNÍ OBRAZOVKA: openSettings ukáže #set-home (Zpět schované), v kartě Časté jsou dosah AR, dosah
     mapa, max. bodů, Světlý/Tmavý, venkovní režim a chipy druhů bodů; kategorie = 8 řádků.
  B  STRÁNKY: klepnutí na kategorii otevře stránku (název v hlavičce, Zpět), Zpět vrátí první obrazovku;
     openSettings vždy začíná na první obrazovce; Android Zpět na stránce vede na první obrazovku.
  C  STĚHOVÁNÍ (nastaveni-poradek): Přesnost z mapy + Země + Data mapy + tlačítko vrstev na Mapa a body,
     Slabší telefon + Úspora baterie na Výkon a baterie, rukavice + jednoduchý režim v Ovládání, profil
     zařízení a Uvolnit místo v Záloha a údržba; zrcadlo účtu (Kde pracuju, Verze Pro…) na Účet a aplikace;
     schované řádky (Jednoduchý panel Nástrojů, Zjednodušené Nástroje, Napsat autorovi, Funguje mi
     všechno?) mají .ag-set-drop; žádná sekce „Další volby"; žádný profil nastavení / práce / Kdo jsi.
  D  ULOŽENÍ: jezdec dosahu v kartě Časté → Uložit vše → po znovuotevření hodnota drží (ids beze změny).
  E  HLEDÁNÍ + APP-SEARCH: „rukavice" najde řádek s cestou Ovládání, reveal otevře stránku; AGAppSearch
     „mapa a body" otevře stránku Mapa a body.
  F  ROLE: zaměstnanec bez set.tab-ar nevidí řádek kategorie AR kamera ani stránku.
  G  JAZYK (it): řádky kategorií i nadpis stránky italsky, karta Časté bez češtiny.

Spuštění: python scripts/test_v365.py [port]
"""
import os
import sys
import io
import re
import json
import asyncio
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import test_v329 as T  # noqa: E402
from ag_boot import boot  # noqa: E402

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 9365)
vysledky = []
LAT, LNG = T.LAT, T.LNG
PAGES = ['tab-ar', 'tab-mapa', 'tab-vzhled', 'tab-ovladani', 'tab-vykon', 'tab-data', 'tab-udrzba', 'tab-ucet']


def ok(jmeno, podminka, detail=''):
    vysledky.append((jmeno, bool(podminka), detail))
    print(('OK   ' if podminka else 'CHYBA') + ' ' + jmeno + ('' if podminka else '  -- ' + str(detail)[:600]))


def src(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def staticke():
    print('--- S) staticke ---')
    ix = src('index.html')
    m = ix[ix.index('id="settings-modal"'):]
    m = m[:m.index('\n    </div>\n')]
    ok('S1 první obrazovka #set-home s kartou #set-caste', 'id="set-home"' in m and 'id="set-caste"' in m and m.index('id="set-home"') < m.index('class="modal-body"'))
    caste = m[m.index('id="set-caste"'):m.index('id="set-cats"')]
    ok('S2 karta Časté: dosah AR, dosah mapa, max. bodů, Světlý/Tmavý, venkovní režim, druhy bodů', all(x in caste for x in ['id="s-ar-radius-slider"', 'id="s-map-radius-slider"', 'id="s-max-ar-slider"', 'id="seg-mode"', 'id="s-outdoor"', 'id="f-tb"', 'id="f-custom"']))
    tabs = re.findall(r'data-tab="(tab-[a-z]+)"', m)
    ok('S3 kategorie = 8 řádků s data-tab v pořadí', tabs == PAGES, tabs)
    ok('S4 každý řádek kategorie je .tab-btn s onclick switchTab (kvůli ucty.js) a má název + podtitulek', len(re.findall(r'class="tab-btn set-cat" data-tab="tab-[a-z]+" onclick="switchTab\(', m)) == 8 and m.count('<span class="tb-tx"><b>') == 8)
    ok('S5 stránky = 8 × .settings-tab s data-title, žádná Profily', all(('id="%s" class="settings-tab" data-title=' % p) in m for p in PAGES) and 'tab-profily' not in m)
    ok('S6 bez pruhu záložek, bez #ag-set-strip, hlavička se Zpět', 'class="tab-buttons' not in m and 'ag-set-strip' not in m and 'id="set-back"' in m and 'id="set-title"' in m)
    ok('S7 ids ovládacích prvků zůstaly (saveSettings čte podle id)', all(('id="%s"' % i) in m for i in ['v-font-scale', 's-auto-outdoor', 's-wakelock', 'v-theme', 's-anim', 'v-adaptive-glass', 'v-dock-arc', 'col-tb', 'v-marker-scale', 'col-arrow', 'v-arrow-shape', 'v-hud-scale', 'v-panel-opacity', 's-auto-compass', 's-tilt-comp', 's-heading-smooth', 's-fovh', 's-fovv', 's-eyeh', 's-camera-select', 's-project-select', 's-search-name', 's-katastr-source', 'restore-file', 'storage-usage', 's-lefthand', 's-vibration', 'set-skryte-body', 'set-about-btn', 'set-navod-btn', 'set-sdilet-app', 'v-mode', 'tgl-info', 'v-ar-height-slider']))
    skripty = re.findall(r'<script[^>]+(?:src|data-src)="js/([a-z0-9-]+\.js)"', ix)
    ok('S8 rezim-prace.js, nastaveni-lista.js a student-start.js odpojené z index.html', 'rezim-prace.js' not in skripty and 'nastaveni-lista.js' not in skripty and 'student-start.js' not in skripty and 'nastaveni-poradek.js' in skripty and 'nastaveni-hledani.js' in skripty and 'profily.js' in skripty)
    sw = src('sw.js')
    ok('S9 sw.js bez odpojených modulů', "'./js/rezim-prace.js'" not in sw and "'./js/nastaveni-lista.js'" not in sw)
    d = json.load(io.open(os.path.join(ROOT, 'data', 'jazyky.json'), encoding='utf-8'))
    ok('S10 slovník: nové klíče Nastavení v 5 jazycích', all(len(d['t'].get(k, [])) == 5 for k in ['Časté', 'Kategorie', 'Méně často', 'AR kamera', 'Mapa a body', 'Výkon a baterie', 'Zakázka a data', 'Záloha a údržba', 'Účet a aplikace', 'Body v kameře', 'Body v mapě', 'Telefon v ruce', 'Zkratky', 'Druh úředních bodů', 'Zpět na Nastavení']))
    po = src('js/nastaveni-poradek.js')
    ok('S11 poradek: MOVE_SEC, HIDE, mirrorMenu, bez skládání sekcí', 'MOVE_SEC' in po and "var HIDE = [" in po and 'function mirrorMenu' in po and 'agSetFold_v1' not in po)
    hl = src('js/nastaveni-hledani.js')
    ok('S12 hledání bez krátkého pohledu', 'agShortSettings_v1' not in hl and 'function tagTab' not in hl and 'function injectToggle' not in hl and "getElementById('set-home')" in hl)
    gr = src('js/grafika.js')
    ok('S13 grafika: agSettingsHome + openSettings začíná doma', 'function agSettingsHome' in gr and "agSettingsHome(); applyVisualSettings();" in gr)
    an = src('js/android.js')
    ok('S14 android Zpět na stránce → první obrazovka', "data-page" in an and 'agSettingsHome' in an)
    css = src('css/style.css')
    ok('S15 style.css: .set-head, .set-cat, .ag-set-drop; pryč .settings-tiles a .ag-set-strip', '.set-head' in css and '.set-cat' in css and '.ag-set-drop' in css and '.settings-tiles' not in css.replace('pruh záložek .settings-tiles', '') and '.ag-set-strip {' not in css)


async def novy(br, url, boot_js, extra=''):
    ctx = await br.new_context(locale='cs-CZ', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                               geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append('pageerror: ' + str(e)[:200]))
    await page.route('**/*', T.route_vse)
    await page.add_init_script(boot_js + T.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agVektor_v1','0');" + extra)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    await T.cekej(page, "document.body.classList.contains('app-started')")
    await page.wait_for_timeout(1200)
    await page.evaluate("() => { try { AGLazy && AGLazy.flush && AGLazy.flush(); } catch (e) {} }")
    await page.wait_for_timeout(2500)
    return ctx, page, chyby


async def beh(url):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch()

        print('--- A) první obrazovka ---')
        ctx, page, chyby = await novy(br, url, boot(tarif='pro'))
        await page.evaluate("() => openSettings()")
        await page.wait_for_timeout(1200)
        a = await page.evaluate("""() => {
            var home = document.getElementById('set-home'), back = document.getElementById('set-back');
            function vis(id) { var e = document.getElementById(id); if (!e) return false; var row = e.closest('.st-row, .st-slider, .st-chips') || e; var r = row.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !!e.closest('#set-caste'); }
            var cats = Array.from(document.querySelectorAll('#set-home .set-cat')).map(b => ({ tab: b.getAttribute('data-tab'), t: b.querySelector('b').textContent.trim(), vis: b.getBoundingClientRect().height > 40 }));
            return { home: !!home && !home.hidden && getComputedStyle(home).display !== 'none', back: !!back && back.hidden, title: document.getElementById('set-title').textContent.trim(),
                     caste: ['s-ar-radius-slider', 's-map-radius-slider', 's-max-ar-slider', 'seg-mode', 's-outdoor', 'f-tb'].map(vis),
                     cats: cats, search: !!document.getElementById('ag-ns-search') && document.getElementById('ag-ns-search').nextElementSibling === home,
                     aktivniStranky: document.querySelectorAll('#settings-modal .settings-tab.active').length,
                     casteTop: document.getElementById('set-caste').getBoundingClientRect().top, vh: window.innerHeight };
        }""")
        ok('A1 openSettings = první obrazovka, Zpět schované, nadpis Nastavení', a['home'] and a['back'] and a['title'] == 'Nastavení' and a['aktivniStranky'] == 0, a)
        ok('A2 karta Časté má všech 6 voleb a je vidět bez rolování', all(a['caste']) and a['casteTop'] < a['vh'] / 2, (a['caste'], a['casteTop']))
        ok('A3 kategorie = 8 viditelných řádků v pořadí', [c['tab'] for c in a['cats']] == PAGES and all(c['vis'] for c in a['cats']), a['cats'])
        ok('A4 hledání stojí mezi hlavičkou a první obrazovkou', a['search'])

        print('--- B) stránky ---')
        b = []
        for p in PAGES:
            await page.evaluate("(p) => document.querySelector('#settings-modal .set-cat[data-tab=\"' + p + '\"]').click()", p)
            await page.wait_for_timeout(350)
            b.append(await page.evaluate("""(p) => { var pg = document.getElementById(p);
                return { p: p, active: pg.classList.contains('active') && getComputedStyle(pg).display !== 'none', home: document.getElementById('set-home').hidden,
                         back: !document.getElementById('set-back').hidden, title: document.getElementById('set-title').textContent.trim(), want: pg.getAttribute('data-title'),
                         jiny: document.querySelectorAll('#settings-modal .settings-tab.active').length, dp: document.getElementById('settings-modal').getAttribute('data-page') }; }""", p))
            await page.evaluate("() => document.getElementById('set-back').click()")
            await page.wait_for_timeout(250)
            b[-1]['zpet'] = await page.evaluate("() => !document.getElementById('set-home').hidden && document.getElementById('set-back').hidden && document.getElementById('set-title').textContent.trim() === 'Nastavení' && !document.getElementById('settings-modal').getAttribute('data-page')")
        ok('B1 každá kategorie otevře svou stránku (název v hlavičce, Zpět, první obrazovka schovaná, jediná aktivní)', all(x['active'] and x['home'] and x['back'] and x['title'] == x['want'] and x['jiny'] == 1 and x['dp'] == x['p'] for x in b), [x for x in b if not (x['active'] and x['home'] and x['back'] and x['title'] == x['want'])])
        ok('B2 Zpět vrátí první obrazovku', all(x['zpet'] for x in b), [x['p'] for x in b if not x['zpet']])
        await page.evaluate("() => { switchTab('tab-vzhled'); document.getElementById('settings-modal').style.display = 'none'; openSettings(); }")
        await page.wait_for_timeout(300)
        ok('B3 openSettings po zavření na stránce začíná zase doma', await page.evaluate("() => !document.getElementById('set-home').hidden && !document.getElementById('settings-modal').getAttribute('data-page')"))
        # Android Zpět: na stránce → domů, doma → zavřít
        await page.evaluate("() => switchTab('tab-ovladani')")
        await page.wait_for_timeout(700)
        await page.go_back()
        await page.wait_for_timeout(700)
        b4 = await page.evaluate("() => ({ open: document.getElementById('settings-modal').style.display === 'flex', home: !document.getElementById('set-home').hidden })")
        ok('B4 Android Zpět na stránce vede na první obrazovku (okno zůstává)', b4['open'] and b4['home'], b4)

        print('--- C) stěhování řádků modulů ---')
        c = await page.evaluate("""() => {
            function inTab(id, tab) { var e = document.getElementById(id); return !!(e && e.closest('#' + tab)); }
            function secOf(title) { var h = Array.from(document.querySelectorAll('#settings-modal .settings-tab > .set-h')).find(h => (h.getAttribute('data-ag-cs') || h.textContent).trim() === title); return h ? h.parentNode.id : null; }
            function hidden(id) { var e = document.getElementById(id); if (!e) return 'neni'; var r = e.closest('.settings-tab') ? e : e; return getComputedStyle(e).display === 'none' || !!e.closest('.ag-set-drop') ? 'skryto' : 'VIDET'; }
            return { presnost: secOf('Přesnost z mapy'), zeme: secOf('Země a souřadnice'), pmtiles: secOf('Data mapy (vektor)'), cloud: secOf('Firemní cloud'),
                     mapfab: inTab('s-mapfab', 'tab-mapa'), prichyt: inTab('s-prichyceni', 'tab-mapa'), okoli: inTab('s-okoli', 'tab-mapa'), trasa: inTab('s-trasa', 'tab-mapa'), szeme: inTab('s-zeme', 'tab-mapa'), url: inTab('s-mapa-url', 'tab-mapa'),
                     lite: inTab('agl-card', 'tab-vykon'), power: inTab('agp-card', 'tab-vykon'),
                     glove: inTab('ag-glove-row', 'tab-ovladani'), jr: inTab('ag-jr-setrow', 'tab-ovladani'), gz: inTab('ag-gz-setrow', 'tab-ovladani'),
                     fusion: inTab('ag-arfusion-row', 'tab-ar'), vt: inTab('agvt-settings-row', 'tab-ar'),
                     dev: inTab('ag-dev-box', 'tab-udrzba'), uvolnit: inTab('ag-uvolnit', 'tab-udrzba'), skryte: inTab('set-skryte-body', 'tab-udrzba'), quota: inTab('ag-quota', 'tab-data'), dup: inTab('ag-dup-project-btn', 'tab-data'),
                     hist: inTab('hist-set-btn', 'tab-ucet'), about: inTab('set-about-btn', 'tab-ucet'), navod: inTab('set-navod-btn', 'tab-ucet'),
                     mirror: Array.from(document.querySelectorAll('#set-ucet-proxy [data-mirror]')).map(b => b.getAttribute('data-mirror')),
                     lang: inTab('ag-lang-sel', 'tab-vzhled'), night: inTab('ag-night-auto', 'tab-vzhled'),
                     drop: { ts: hidden('ag-ts-setrow'), ua: hidden('ag-ua-simple-row'), fb: hidden('ag-fb-set-btn'), zdravi: hidden('ag-zdravi-set-btn'), foot: hidden('ag-fb-foot-set') },
                     dalsi: !!secOf('Další volby'), prazdne: Array.from(document.querySelectorAll('#settings-modal .settings-tab > .set-h')).filter(h => { var n = h.nextElementSibling; while (n && (n.classList.contains('ag-set-drop') || getComputedStyle(n).display === 'none')) n = n.nextElementSibling; return !n || n.classList.contains('set-h'); }).map(h => h.textContent.trim()),
                     profily: !!(document.getElementById('ag-prof-bar') || document.getElementById('ag-rp-sel') || document.getElementById('ag-ss-setrow') || document.getElementById('tab-profily') || window.AGRezimPrace) };
        }""")
        ok('C1 Mapa a body: Přesnost z mapy, Země, Data mapy (sekce i s řádky) + tlačítko vrstev', c['presnost'] == 'tab-mapa' and c['zeme'] == 'tab-mapa' and c['pmtiles'] == 'tab-mapa' and c['mapfab'] and c['prichyt'] and c['okoli'] and c['trasa'] and c['szeme'] and c['url'], c)
        ok('C2 Výkon a baterie: Slabší telefon + Úspora baterie', c['lite'] and c['power'], c)
        ok('C3 Ovládání: rukavice, jednoduchý režim, gesta; AR kamera: fúze + stabilizace', c['glove'] and c['jr'] and c['gz'] and c['fusion'] and c['vt'], c)
        ok('C4 Záloha a údržba: profil zařízení, Uvolnit místo, Skryté body; Zakázka a data: kopie zakázky, cloud, úložiště', c['dev'] and c['uvolnit'] and c['skryte'] and c['quota'] and c['dup'] and c['cloud'] in (None, 'tab-data'), c)   # Firemní cloud jen s cloudovou firmou
        ok('C5 Účet a aplikace: O aplikaci, Historie, Návod + zrcadlo účtu (prostory, zamknout, admin, Pro)', c['about'] and c['hist'] and c['navod'] and 'ag-prostory-btn' in c['mirror'] and 'agfa-switch-btn' in c['mirror'] and 'ag-pro-menu-btn' in c['mirror'], c['mirror'])
        ok('C6 schované řádky: Jednoduchý panel Nástrojů, Zjednodušené Nástroje, Napsat autorovi, Funguje mi všechno?', all(v in ('skryto', 'neni') for v in c['drop'].values()), c['drop'])
        ok('C7 žádná sekce „Další volby", žádný nadpis nad ničím, žádné profily', not c['dalsi'] and not c['prazdne'] and not c['profily'], (c['dalsi'], c['prazdne'], c['profily']))
        ok('C8 Vzhled: jazyk (a noční režim v Pokročilém)', c['lang'] and c['night'], c)

        print('--- D) uložení ---')
        await page.evaluate("() => { agSettingsHome(); var s = document.getElementById('s-ar-radius-slider'); s.value = 250; s.dispatchEvent(new Event('input')); saveSettings(); }")
        await page.wait_for_timeout(600)
        await page.evaluate("() => openSettings()")
        await page.wait_for_timeout(500)
        d1 = await page.evaluate("() => ({ v: document.getElementById('s-ar-radius-slider').value, txt: document.getElementById('s-ar-radius-val').textContent, zavreno: true })")
        ok('D1 jezdec dosahu v kartě Časté se ukládá (250 m drží po znovuotevření)', d1['v'] == '250' and d1['txt'] == '250', d1)

        print('--- E) hledání + app-search ---')
        await page.evaluate("() => { document.getElementById('ag-ns-q').focus(); AGSettings.search('rukavic'); }")
        await page.wait_for_timeout(300)
        e1 = await page.evaluate("() => Array.from(document.querySelectorAll('#ag-ns-res .ag-ns-hit')).map(b => b.textContent.replace(/\\s+/g, ' ').trim()).slice(0, 3)")
        ok('E1 hledání „rukavic" → řádek s cestou Ovládání → Telefon v ruce', any('Ovládání' in x and 'Telefon v ruce' in x for x in e1), e1)
        await page.evaluate("() => AGSettings.reveal('ag-glove-cb')")
        await page.wait_for_timeout(500)
        ok('E2 reveal otevře stránku Ovládání', await page.evaluate("() => document.getElementById('tab-ovladani').classList.contains('active') && document.getElementById('set-title').textContent.trim() === 'Ovládání'"))
        await page.evaluate("() => { document.getElementById('settings-modal').style.display = 'none'; var h = AGAppSearch.find('mapa a body'); h[0].run(); }")
        await page.wait_for_timeout(500)
        ok('E3 AGAppSearch „mapa a body" otevře stránku Mapa a body', await page.evaluate("() => document.getElementById('settings-modal').style.display === 'flex' && document.getElementById('tab-mapa').classList.contains('active')"))
        vazne = [x for x in chyby if 'favicon' not in x and 'net::ERR' not in x and 'Failed to fetch' not in x and 'ERR_FAILED' not in x]
        ok('Z1 bez chyb stránky', not vazne, vazne[:5])
        await ctx.close()

        print('--- F) role zaměstnanec bez AR ---')
        ctx, page, chyby = await novy(br, url, boot(role='zamestnanec', perms={'zamestnanec': {'set.tab-ar': False}}))
        await page.evaluate("() => openSettings()")
        await page.wait_for_timeout(1500)
        f = await page.evaluate("() => { var b = document.querySelector('#settings-modal .set-cat[data-tab=\"tab-ar\"]'), m = document.querySelector('#settings-modal .set-cat[data-tab=\"tab-mapa\"]'); return { ar: b ? getComputedStyle(b).display : 'neni', mapa: m ? getComputedStyle(m).display : 'neni', page: getComputedStyle(document.getElementById('tab-ar')).display, caste: !!document.getElementById('set-caste') }; }")
        ok('F1 zaměstnanec bez set.tab-ar: řádek AR kamera i stránka schované, ostatní zůstávají', f['ar'] == 'none' and f['page'] == 'none' and f['mapa'] != 'none' and f['caste'], f)
        await ctx.close()

        print('--- G) italsky ---')
        ctx, page, chyby = await novy(br, url, boot(tarif='pro'), "localStorage.setItem('agJazyk_v1','it');")
        await page.wait_for_timeout(1500)
        await page.evaluate("() => openSettings()")
        await page.wait_for_timeout(1500)
        g = await page.evaluate("""() => ({ cats: Array.from(document.querySelectorAll('#set-home .set-cat b')).map(b => b.textContent.trim()),
            caste: document.getElementById('set-caste').innerText, sh: Array.from(document.querySelectorAll('#set-home > .set-h')).map(h => h.textContent.trim()) })""")
        await page.evaluate("() => document.querySelector('#settings-modal .set-cat[data-tab=\"tab-ar\"]').click()")
        await page.wait_for_timeout(900)
        g['title'] = await page.evaluate("() => document.getElementById('set-title').textContent.trim()")
        cesky = [w for w in ['Viditelnost', 'Dosah', 'Vzhled', 'Venkovní', 'Druh', 'bodů'] if w in g['caste']]
        ok('G1 kategorie italsky (Fotocamera AR, Mappa e punti…)', 'Fotocamera AR' in g['cats'] and 'Mappa e punti' in g['cats'] and 'Account e app' in g['cats'], g['cats'])
        ok('G2 nadpisy Frequenti / Categorie / Meno spesso, karta Časté bez češtiny', g['sh'][:3] == ['Frequenti', 'Categorie', 'Meno spesso'] and not cesky, (g['sh'], cesky))
        ok('G3 nadpis otevřené stránky italsky', g['title'] == 'Fotocamera AR', g['title'])
        await ctx.close()

        print('--- H) jazyk systému bez uložené volby ---')
        # (na přání 18. 9. večer: „ať se aplikace zapíná v jazyce systému, pokud ho má, jinak anglicky")
        for loc, want, slovo in [('de-DE', 'de', 'AR-Kamera'), ('fr-FR', 'en', 'AR camera'), ('cs-CZ', 'cs', 'AR kamera'), ('sk-SK', 'cs', 'AR kamera')]:
            ctx = await br.new_context(locale=loc, viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True,
                                       geolocation={'latitude': LAT, 'longitude': LNG, 'accuracy': 3}, permissions=['geolocation'], service_workers='block')
            page = await ctx.new_page()
            await page.route('**/*', T.route_vse)
            await page.add_init_script(boot(tarif='pro') + T.SEED + "localStorage.setItem('agViewMode','map'); localStorage.setItem('agVektor_v1','0'); localStorage.removeItem('agJazyk_v1');")
            await page.goto(url, wait_until='domcontentloaded', timeout=45000)
            await T.cekej(page, "document.body.classList.contains('app-started')")
            await page.wait_for_timeout(2500)
            await page.evaluate("() => openSettings()")
            await page.wait_for_timeout(1200)
            h = await page.evaluate("() => ({ lang: document.documentElement.getAttribute('lang'), ls: localStorage.getItem('agJazyk_v1'), ar: document.querySelector('#set-home .set-cat[data-tab=\"tab-ar\"] b').textContent.trim() })")
            ok('H %s → appka v „%s" (kategorie „%s")' % (loc, want, slovo), h['lang'] == want and h['ls'] == want and h['ar'] == slovo, h)
            await ctx.close()
        await br.close()


def main():
    staticke()
    srv, url = T.server(PORT)
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
