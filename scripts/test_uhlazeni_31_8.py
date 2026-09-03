#!/usr/bin/env python3
# ===== AR Geodet - UHLAZENI Z 31. 8. 2026 (v271) ==============================
# Overuje v Chromiu sest veci, ktere se ten den menily. Vsechny maji spolecne to,
# ze se STATICKY (gropem po zdrojacich) nepoznaji - vznikaji az slozenim registru,
# lazy modulu, CSS a DOM:
#
#   A) VYCHOD Z OMEZENEHO REZIMU (js/ucty.js). Klic agGuest_v1 se nastavi natrvalo
#      a od te chvile uz branu nikdo neukaze. Jedina pilulka nahore se navic sliva
#      do centra upozorneni, takze slovo "prihlasit" nebylo na obrazovce NIKDE.
#      Testuje se, ze pruh #ag-guest-exit je VIDET (ne jen v DOM) a ze po klepnuti
#      naskoci prihlasovaci brana.
#
#   B) SEZNAM UKONU je kratsi o rozcestniky (js/nastroje-ukony.js + `inhub`
#      v js/tools-registry.js). Do 31. 8. se rozcestnik v seznamu preskakoval a
#      vypisovaly se jeho POLOZKY, takze slucovani neuslo ani radek. Testuje se
#      obracene: radek rozcestniku ANO, jeho polozky NE, `hidden` nastroje NE.
#
#   C) KARTA BODU uz nema pecet #ag-ov-seal (js/overeni-bodu.js) - svitila skoro
#      u kazdeho bodu jako "Jedine urceni - neovereno". Zaroven se overuje, ze
#      VERDIKT z appky nezmizel: nastroj "Overeni bodu" se doflushuje z lazy
#      vrstvy, opravdu otevre a postavi soupis.
#
#   D) OKNO NEPROBLIKAVA (js/modal-close.js): pri otevreni dostane atribut
#      data-agmc-usazeni a zase ho ztrati. Kontroluje se OBOJI - ze plachta padne
#      (jinak by okno zustalo prazdne) a ze se u klidneho okna drzi jen kratce.
#
#   E) PROHLIDKA OKOLI je celoobrazovkove okno (.modal-overlay) a "Ukazat v
#      kamere" ji sbali do pilulky #ag-ph-pill u spodni hrany.
#
#   F) STAVOVA BUBLINA je o tri px vyssi nez ve v270 (21 -> 24 px), a porad na
#      JEDEN radek.
#
#   G) PANEL FIRMY OCIMA ZAMESTNANCE (js/ucty-admin.js). Prepnuti firmy zilo do
#      31. 8. jen v adminske sekci, takze "prepnout firmu mi to nedovoli" platilo
#      doslova. Testuje se, ze neadmin ma sekci "Firmy" se seznamem firem a
#      "+ Pripojit dalsi firmu", ze adminske sekce nevidi a ze telo sekce NENI
#      prazdne (prazdny panel byl puvodni reklamace).
#
# Pouziti (z korene repa):  python scripts/test_uhlazeni_31_8.py [port]
# ==============================================================================
import asyncio
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8471
URL = None

# Prihlaseny admin lokalni firmy bez hesla: appka jde rovnou dovnitr, takze se
# testuje appka a ne prihlasovaci obrazovka.
BOOT_ADMIN = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('arSurveyor','Stepan');
  localStorage.setItem('agFirmaBioAsk_v1', String(Date.now()));
  (function () {
    var f = { enabled: true, firmName: 'Test', createdTs: Date.now(), autoLockMin: 0,
      users: [{ id: 'u1', name: 'Stepan', role: 'admin', salt: 'aa', pinHash: 'x', noPin: true }] };
    localStorage.setItem('agFirma_v1', JSON.stringify(f));
    localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: 'u1', ts: Date.now() }));
  })();
"""

# Zamestnanec (NE admin): prave pro nej sekce "Firmy" 31. 8. vznikla - do te doby
# vedla jedina cesta k prepnuti firmy pres adminskou sekci.
BOOT_ZAM = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('arSurveyor','Josef');
  localStorage.setItem('agFirmaBioAsk_v1', String(Date.now()));
  (function () {
    var f = { enabled: true, firmName: 'Test', createdTs: Date.now(), autoLockMin: 0,
      users: [{ id: 'u1', name: 'Stepan', role: 'admin', salt: 'aa', pinHash: 'x', noPin: true },
              { id: 'u2', name: 'Josef', role: 'zamestnanec', salt: 'bb', pinHash: 'y', noPin: true }] };
    localStorage.setItem('agFirma_v1', JSON.stringify(f));
    localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: 'u2', ts: Date.now() }));
  })();
"""

# Host: presne stav, do ktereho se uzivatel zamkl tlacitkem "Pokracovat bez
# prihlaseni" - zadna firma, jen priznak agGuest_v1.
BOOT_HOST = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('agGuest_v1','1');
"""

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)) if detail else ''))


def server():
    """Na Windows zustava port po predchozim behu chvili obsazeny - zkousi se vic."""
    global URL
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % port
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                URL = u
                return srv
            except Exception:
                time.sleep(0.4)
        srv.terminate()
    return None


async def nacti(page, cekej_na='true'):
    for _ in range(4):
        try:
            await page.goto(URL, wait_until='domcontentloaded', timeout=45000)
            break
        except Exception:
            await page.wait_for_timeout(1500)
    await page.wait_for_timeout(2200)
    await page.evaluate("() => { if (typeof window.startAppFromWelcome === 'function') startAppFromWelcome(); }")
    # ⚠ Bez flushe odlozenych modulu hlasi pulka nastroju "is not defined" falesne
    # (viz zkusenost z testu Nastroju). Ceka se na konkretni modul volajiciho testu.
    for _ in range(40):
        if await page.evaluate("() => " + cekej_na):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(400)
    await page.wait_for_timeout(2200)     # appka se musi usadit (mapa, HUD, moduly)


async def test_host(ctx):
    """A) vychod z omezeneho rezimu"""
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await nacti(page, "typeof window.AGUcty === 'object'")

    st = await page.evaluate("""() => {
        const e = document.getElementById('ag-guest-exit');
        if (!e) return { je: false };
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        return { je: true,
                 vidno: cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05,
                 vObraze: r.top >= 0 && r.bottom <= innerHeight + 1 && r.width > 40,
                 dole: Math.round(innerHeight - r.bottom),
                 text: (e.textContent || '').replace(/\\s+/g, ' ').trim() };
    }""")
    ok('A1 pruh "vychod z omezeneho rezimu" je v DOM', st.get('je'), st)
    if st.get('je'):
        ok('A2 pruh je opravdu videt a cely v obraze', st.get('vidno') and st.get('vObraze'), st)
        ok('A3 pruh nabizi prihlaseni slovy', 'Přihlásit' in (st.get('text') or ''), st.get('text'))

    # A4: klepnuti = prihlasovaci brana. Klepe se PRVKEM (ne souradnici) - pruh
    # muze byt cizim prvkem prekryty a to uz je jina vada.
    await page.evaluate("() => document.getElementById('ag-guest-exit').click()")
    await page.wait_for_timeout(900)
    gate = await page.evaluate("""() => {
        const g = document.getElementById('ag-gate') || document.getElementById('ag-login');
        if (!g) return { je: false };
        const cs = getComputedStyle(g);
        return { je: true, vidno: cs.display !== 'none' && cs.visibility !== 'hidden' };
    }""")
    ok('A4 klepnuti otevre prihlasovaci branu', gate.get('je') and gate.get('vidno'), gate)

    ok('A5 host nabootoval bez chyby v konzoli', not chyby, chyby[:3])
    await page.close()


async def test_admin(ctx):
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await nacti(page, "typeof window.AGReg === 'object' && typeof window.AGHub === 'object'")

    # ---- B) seznam ukonu ----------------------------------------------------
    await page.evaluate("() => { const m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; }")
    await page.wait_for_timeout(1600)
    # seznam se prestavuje az kdyz se ustali mrizka - flush + chvile navic
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(1800)

    sez = await page.evaluate("""() => {
        const host = document.getElementById('ag-uk-list');
        if (!host) return null;
        const cs = getComputedStyle(host);
        const rows = [...host.querySelectorAll('.ag-uk-i')];
        return { vidno: cs.display !== 'none',
                 pocet: rows.length,
                 klice: rows.map(r => r.getAttribute('data-k') || '').filter(Boolean) };
    }""")
    ok('B1 seznam ukonu se vykreslil', sez and sez.get('vidno') and sez.get('pocet', 0) > 20, sez and sez.get('pocet'))
    if sez:
        klice = set(sez['klice'])
        huby = await page.evaluate("() => AGReg.all().filter(r => r.hub).map(r => r.k)")
        # Rozcestnik se v seznamu ukaze jen tehdy, kdyz jeho dlazdice v mrizce
        # opravdu stoji (tools-hub.js je lazy) - jinak by se testovalo prazdno.
        stojici = await page.evaluate("""() => AGReg.all().filter(r => r.hub)
            .filter(r => !![...document.querySelectorAll('#tools-modal .tool-tile')]
                .find(t => (t.getAttribute('data-tool') || '') === r.k)).map(r => r.k)""")
        chybi_hub = [h for h in stojici if h not in klice]
        ok('B2 kazdy postaveny rozcestnik ma v seznamu svuj radek',
           not chybi_hub, {'chybi': chybi_hub, 'stoji': len(stojici), 'huby': len(huby)})

        polozky = await page.evaluate("""() => AGReg.all().filter(r => r.inhub)
            .filter(r => AGReg.hubOf(r.k) && !![...document.querySelectorAll('#tools-modal .tool-tile')]
                .find(t => (t.getAttribute('data-tool') || '') === r.inhub)).map(r => r.k)""")
        navic = [p for p in polozky if p in klice]
        ok('B3 polozky rozcestniku uz v seznamu nestoji samostatne',
           not navic, {'navic': navic, 'polozek': len(polozky)})

        skryte = await page.evaluate("() => AGReg.hiddenKeys()")
        vidno_skryte = [s for s in skryte if s in klice]
        ok('B4 `hidden` nastroje v seznamu nejsou', not vidno_skryte, {'skryte': skryte, 'vidno': vidno_skryte})

        # a hlavne: TY nastroje z appky nezmizely - jdou dal spustit
        ziji = await page.evaluate("""() => {
            const out = {};
            for (const k of AGReg.hiddenKeys()) {
                const t = [...document.querySelectorAll('#tools-modal .tool-tile')]
                    .find(x => (x.getAttribute('data-tool') || '') === k);
                out[k] = { dlazdice: !!t, keys: !!(AGReg.get(k) || {}).keys };
            }
            return out;
        }""")
        ok('B5 skryty nastroj zustava v appce (dlazdice v DOM + synonyma pro hledani)',
           all(v['dlazdice'] and v['keys'] for v in ziji.values()) if ziji else False, ziji)

    # ---- D) usazeni okna ----------------------------------------------------
    usaz = await page.evaluate("""async () => {
        const ov = document.getElementById('settings-modal');
        if (!ov) return { je: false };
        let mel = false;
        const mo = new MutationObserver(() => { if (ov.hasAttribute('data-agmc-usazeni')) mel = true; });
        mo.observe(ov, { attributes: true, attributeFilter: ['data-agmc-usazeni'] });
        const t0 = performance.now();
        ov.style.display = 'flex';
        await new Promise(r => setTimeout(r, 1400));
        mo.disconnect();
        return { je: true, mel, visi: ov.hasAttribute('data-agmc-usazeni'), ms: Math.round(performance.now() - t0) };
    }""")
    ok('D1 okno pri otevreni dostane plachtu usazeni', usaz.get('mel'), usaz)
    ok('D2 plachta zase spadne (okno nezustane prazdne)', usaz.get('je') and not usaz.get('visi'), usaz)
    await page.evaluate("() => { const m = document.getElementById('settings-modal'); if (m) m.style.display = 'none'; }")
    await page.wait_for_timeout(300)

    # ---- C) karta bodu bez peceti ------------------------------------------
    karta = await page.evaluate("""async () => {
        if (typeof window.showDetails !== 'function') return { skip: 'showDetails neni' };
        const pt = { id: 'test-ov-1', name: 'Zkusebni bod', lat: 50.08, lng: 14.43, alt: 200,
                     ts: Date.now(), acc: 0.02, type: 'bod' };
        try { showDetails(pt); } catch (e) { return { skip: 'showDetails spadlo: ' + e.message }; }
        await new Promise(r => setTimeout(r, 600));
        return { seal: !!document.getElementById('ag-ov-seal'),
                 karta: !!document.getElementById('det-body') };
    }""")
    if karta.get('skip'):
        ok('C1 karta bodu (preskoceno)', False, karta['skip'])
    else:
        ok('C1 karta bodu se otevrela', karta.get('karta'), karta)
        ok('C2 pecet "Jedine urceni - neovereno" je z karty pryc', not karta.get('seal'), karta)

    # Pecet z karty odesla, ale VERDIKT nesmi zmizet z appky - zustava v nastroji
    # "Overeni bodu". Nestaci sahnout na globalni jmeno: modul je LAZY (v index.html
    # jako <script type="ag/lazy">), takze se nejdriv musi doflushovat, a pak se
    # nastroj OPRAVDU otevre - jen existujici funkce jeste neznamena, ze soupis
    # postavi (prave v nem se mazala cast, ve ktere pecet zila).
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(500)
    tool = await page.evaluate("""async () => {
        const api = window.AGOvereni;
        if (!api || typeof api.open !== 'function') return { api: false };
        try { api.open(); } catch (e) { return { api: true, spadlo: e.message }; }
        await new Promise(r => setTimeout(r, 700));
        const m = document.getElementById('ag-ov-modal');
        const out = { api: true, modal: !!m,
                      vidno: !!(m && m.offsetWidth > 0 && m.offsetHeight > 0),
                      tabulka: !!(m && m.querySelector('table, .ag-ov-empty, p')) };
        if (m) m.style.display = 'none';
        return out;
    }""")
    ok('C3 nastroj Overeni bodu zil dal (AGOvereni.open existuje)', tool.get('api'), tool)
    ok('C4 soupis se opravdu postavi', tool.get('modal') and tool.get('vidno') and tool.get('tabulka'), tool)

    # ---- F) stavova bublina -------------------------------------------------
    b = await page.evaluate("""() => {
        const el = document.getElementById('ag-sp'); if (!el) return null;
        const r = el.getBoundingClientRect();
        const h = el.querySelector('.ag-sp-head');
        const hr = h ? h.getBoundingClientRect() : null;
        return { v: Math.round(r.height),
                 pismo: h ? getComputedStyle(h).fontSize : '?',
                 pad: h ? getComputedStyle(h).paddingTop : '?',
                 radky: hr ? Math.round(hr.height) : 0 };
    }""")
    # VE v270 byla pilulka 21 px (pismo 11px/1 + 2x4px odsazeni + 2x1px ramecek),
    # od 31. 8. je 24 px (pismo 12px + 2x5px odsazeni) - tedy o 3 px vyssi. Strop 34
    # px drzi, ze je to porad pilulka na jeden radek, ne "tlusty pruh" z v269.
    ok('F1 bublina je vyssi nez ve v270 (21 px), ale porad pilulka',
       bool(b) and 21 < b['v'] <= 34, b)
    ok('F2 hlavicka drzi jeden radek', bool(b) and b['radky'] <= 26, b)

    ok('Z1 appka nabootovala a odbehla testy bez chyby v konzoli', not chyby, chyby[:3])
    await page.close()


async def test_prohlidka(ctx):
    """E) prohlidka okoli pres celou obrazovku + pilulka"""
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await nacti(page, "typeof window.agOpenProhlidka === 'function' || typeof window.AGProhlidka === 'object'")

    otev = await page.evaluate("""async () => {
        const fn = window.agOpenProhlidka || (window.AGProhlidka && AGProhlidka.open);
        if (typeof fn !== 'function') return { skip: 'prohlidka nema verejny vstup' };
        try { fn(); } catch (e) { return { skip: 'spadlo: ' + e.message }; }
        await new Promise(r => setTimeout(r, 1200));
        const el = document.getElementById('ag-ph-panel') ||
                   [...document.querySelectorAll('[id^="ag-ph"]')].find(x => x.className.includes('modal-overlay'));
        if (!el) return { je: false };
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        return { je: true, id: el.id, tridy: el.className, pos: cs.position,
                 sirka: Math.round(r.width), vyska: Math.round(r.height),
                 W: innerWidth, H: innerHeight,
                 mc: !!el.querySelector('.modal-content'),
                 cam: !!el.querySelector('#ag-ph-cam') };
    }""")
    if otev.get('skip'):
        ok('E1 prohlidka (preskoceno)', False, otev['skip'])
    elif not otev.get('je'):
        ok('E1 prohlidka otevrela okno', False, otev)
    else:
        ok('E1 okno prohlidky je .modal-overlay (ne mrtva trida .modal)',
           'modal-overlay' in otev['tridy'] and otev['pos'] == 'fixed', otev)
        ok('E2 okno jede pres CELOU obrazovku (ne karta u spodni hrany)',
           otev['sirka'] >= otev['W'] - 2 and otev['vyska'] >= otev['H'] - 2, otev)
        ok('E3 okno ma .modal-content (krizek a swipe z modal-close.js)', otev['mc'], otev)

        pill = await page.evaluate("""async () => {
            const b = document.getElementById('ag-ph-cam');
            if (!b) return { skip: 'tlacitko Ukazat v kamere neni' };
            b.click();
            await new Promise(r => setTimeout(r, 900));
            const p = document.getElementById('ag-ph-pill');
            const el = document.getElementById('ag-ph-panel');
            const pcs = p ? getComputedStyle(p) : null, pr = p ? p.getBoundingClientRect() : null;
            return { pilulka: !!p,
                     vidno: !!pcs && pcs.display !== 'none',
                     panelSkryty: !el || getComputedStyle(el).display === 'none',
                     vyska: pr ? Math.round(pr.height) : 0,
                     dole: pr ? Math.round(innerHeight - pr.bottom) : -1,
                     vObraze: !!pr && pr.top >= 0 && pr.bottom <= innerHeight + 1 };
        }""")
        if pill.get('skip'):
            ok('E4 sbaleni do kamery (preskoceno)', False, pill['skip'])
        else:
            ok('E4 "Ukazat v kamere" schova panel a nechá pilulku',
               pill['pilulka'] and pill['vidno'] and pill['panelSkryty'], pill)
            ok('E5 pilulka je uzka a u spodni hrany (ne uprostred obrazovky)',
               pill['vyska'] and pill['vyska'] < 90 and pill['vObraze'] and pill['dole'] < 260, pill)

    ok('Z2 prohlidka nezpusobila chybu v konzoli', not chyby, chyby[:3])
    await page.close()


async def test_firmy(ctx):
    """G) panel firmy ocima ZAMESTNANCE - sekce Firmy a pruh s prepnutim."""
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await nacti(page, "typeof window.AGUcty === 'object'")
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(600)

    st = await page.evaluate("""async () => {
        if (!window.AGUctyAdmin || typeof AGUctyAdmin.open !== 'function') return { api: false };
        AGUctyAdmin.open();
        await new Promise(r => setTimeout(r, 900));
        const nav = document.getElementById('agfa-nav');
        const body = document.getElementById('agfa-body');
        const sekce = nav ? [...nav.querySelectorAll('button[data-s]')].map(b => b.getAttribute('data-s')) : [];
        return { api: true, admin: !!(window.AGUcty && AGUcty.isAdmin && AGUcty.isAdmin()),
                 sekce: sekce,
                 // zeleny pruh nahore ma tlacitko na prihlaseni/prepnuti VZDY
                 pruh: (() => { const b = document.getElementById('agfa-fb-switch');
                                return b ? (b.textContent || '').trim() : ''; })(),
                 telo: body ? (body.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200) : '' };
    }""")
    ok('G1 panel firmy se otevrel a uzivatel NENI admin', st.get('api') and st.get('admin') is False, st)
    ok('G2 zamestnanec ma v panelu sekci "Firmy"', 'firmy' in (st.get('sekce') or []), st.get('sekce'))
    ok('G3 adminske sekce zamestnanci nesviti',
       not [x for x in (st.get('sekce') or []) if x in ('prehled', 'uzivatele', 'opravneni')], st.get('sekce'))
    ok('G4 zeleny pruh nabizi prihlaseni/prepnuti', 'epnout' in (st.get('pruh') or ''), st.get('pruh'))

    # Telo sekce NESMI byt prazdne - prave to uzivatel reklamoval ("nic tam neni").
    fy = await page.evaluate("""async () => {
        const nav = document.getElementById('agfa-nav');
        const b = nav && nav.querySelector('button[data-s="firmy"]');
        if (b) b.click();
        await new Promise(r => setTimeout(r, 700));
        const body = document.getElementById('agfa-body');
        const t = body ? (body.textContent || '') : '';
        return { seznam: !!document.getElementById('agfa-firms'),
                 pripojit: !!document.getElementById('agfa-f-join2'),
                 delka: t.replace(/\\s+/g, ' ').trim().length,
                 zamek: !!document.getElementById('agfa-fy-lock') };
    }""")
    ok('G5 sekce Firmy ma seznam firem (a neni prazdna)', fy.get('seznam') and fy.get('delka', 0) > 80, fy)
    ok('G6 je tam "+ Pripojit dalsi firmu (kod)" i odhlaseni', fy.get('pripojit') and fy.get('zamek'), fy)
    ok('G7 panel firmy nabootoval bez chyby v konzoli', not chyby, chyby[:3])
    await page.close()


async def main():
    from playwright.async_api import async_playwright
    srv = server()
    if not srv:
        print('Testovaci server nenabehl.')
        return 2
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            geo = {'latitude': 50.08, 'longitude': 14.43, 'accuracy': 3}

            print('\n--- A) omezeny rezim (host) ---')
            ctx = await browser.new_context(viewport={'width': 412, 'height': 915}, has_touch=True,
                                            permissions=['geolocation'], geolocation=geo)
            await ctx.add_init_script(BOOT_HOST)
            await test_host(ctx)
            await ctx.close()

            print('\n--- B/C/D/F) seznam ukonu, karta bodu, usazeni oken, bublina ---')
            ctx = await browser.new_context(viewport={'width': 412, 'height': 915}, has_touch=True,
                                            permissions=['geolocation'], geolocation=geo)
            await ctx.add_init_script(BOOT_ADMIN)
            await test_admin(ctx)
            await ctx.close()

            print('\n--- G) panel firmy ocima zamestnance ---')
            ctx = await browser.new_context(viewport={'width': 412, 'height': 915}, has_touch=True,
                                            permissions=['geolocation'], geolocation=geo)
            await ctx.add_init_script(BOOT_ZAM)
            await test_firmy(ctx)
            await ctx.close()

            print('\n--- E) prohlidka okoli ---')
            ctx = await browser.new_context(viewport={'width': 412, 'height': 915}, has_touch=True,
                                            permissions=['geolocation'], geolocation=geo)
            await ctx.add_init_script(BOOT_ADMIN)
            await test_prohlidka(ctx)
            await ctx.close()

            await browser.close()
    finally:
        srv.terminate()

    spatne = [j for (o, j) in vysledky if not o]
    print('\n' + ('=' * 62))
    print('Hotovo: %d/%d' % (len(vysledky) - len(spatne), len(vysledky)))
    for j in spatne:
        print('  CHYBA: ' + j)
    return 1 if spatne else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
