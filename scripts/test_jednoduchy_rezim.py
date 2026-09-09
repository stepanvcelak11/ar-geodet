#!/usr/bin/env python3
# ===== AR Geodet — JEDNODUCHY REZIM (js/jednoduchy-rezim.js) ===================
# Rezim schova CELOU appku za dve tlacitka. Prave proto ho nejde overit ctenim
# kodu: musi se spustit a saha se na nej PRSTEM. Test proto jede v prohlizeci
# (Playwright, mobilni viewport 412x915, povolena poloha).
#
# Co se overuje:
#   A) ZAPNUTI: prepinac v Nastaveni -> Vzhled -> Ovladani rezim zapne, prebal
#      SKUTECNE prekryva appku (elementFromPoint uprostred i v rozich obrazovky
#      vraci prvek uvnitr #ag-jr). ⚠ el.click() z JS prochazi i pres prekryti,
#      takze samotne "tlacitko slo kliknout" nic nedokazuje — viz nalez z GeoGame.
#   B) NOVY BOD Z GPS: prumerovani skonci, bod se ulozi pres addImportedPoints
#      (tedy s provenienci 'gps-avg') a JE v persistentCustomPoints.
#   C) NOVY BOD RUCNE: Y/X v S-JTSK se prevedou na tytez souradnice, jake vraci
#      sjtskToLatLng — bod nesmi skoncit jinde, nez uzivatel zadal.
#   D) SEZNAM: body jsou serazene OD NEJBLIZSIHO a vzdalenosti sedi na metry.
#   E) NAVIGACE: po klepnuti na bod je videt vzdalenost a sipka se otaci podle
#      azimutu (kontrolujeme, ze uhel odpovida rozdilu azimut - smer).
#   F) VYPNUTI: "Cela appka" prebal sundá a volba se NEDRZI po restartu.
#   G) TRVANLIVOST: se zapnutou volbou naskoci rezim sam po nacteni appky.
#   I) NAZEV: predvyplneni ze serie i nahradni dopocet z nejvyssiho cisla v zakazce
#      (bez nej by clovek v jednoduchem rezimu musel cislo vymyslet sam).
#   H) BODY SE NEZASPINI: v ulozenych bodech nesmi zustat pomocne pole (_jrD
#      apod.) — seznam pracuje s obaly, ne s body samotnymi.
#
# Pouziti (z korene repa):  python scripts/test_jednoduchy_rezim.py [port]
# ==============================================================================
import asyncio
import os
import subprocess
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8955
URL = None

# Prihlaseny uzivatel, at appka nastartuje az k obrazovce (viz enterApp v ucty.js).
BOOT = """
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

BOOT_ZAPNUTO = BOOT + "\n  localStorage.setItem('agJednoduchy_v1','1');\n"

GEO = {'latitude': 50.0800, 'longitude': 14.4300, 'accuracy': 2.5}

vysledky = []


def ok(jmeno, podminka, detail=''):
    vysledky.append((bool(podminka), jmeno))
    print(('  OK    ' if podminka else '  CHYBA ') + jmeno + (('  -> ' + str(detail)[:400]) if detail != '' else ''))


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
    for _ in range(40):
        if await page.evaluate("() => " + cekej_na):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(400)
    await page.wait_for_timeout(1500)


# ------------------------------------------------------- A) zapnuti + prekryti
async def test_zapnuti(ctx):
    print('\n--- A) prepinac zapne rezim a prebal opravdu prekryva appku ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await nacti(page, "!!document.getElementById('ag-jr-switch')")

    st = await page.evaluate("""() => {
        const cb = document.getElementById('ag-jr-switch');
        const row = document.getElementById('ag-jr-setrow');
        return { prepinac: !!cb, radek: !!row, uvnitrNastaveni: !!(row && row.closest('#settings-modal')),
                 popisek: row ? (row.querySelector('.st-lab') || {}).innerText || '' : '' };
    }""")
    ok('prepinac je v Nastaveni', st['prepinac'] and st['uvnitrNastaveni'], st)
    ok('popisek rika, co rezim dela', 'Jednoduchý režim' in st['popisek'], st['popisek'][:80])

    # zapnout PRSTEM (klepnutim na prepinac), ne primym volanim API
    # Nastaveni otevrit tak, jak je otevira uzivatel, a klepnout na VIDITELNOU cast
    # prepinace (.st-sw-face) — samotny <input> je v teto appce skryty (opacity 0).
    await page.evaluate("() => { if (typeof openSettings === 'function') openSettings(); else { const m = document.getElementById('settings-modal'); if (m) m.style.display = 'flex'; } }")
    await page.wait_for_timeout(600)
    await page.evaluate("""() => {
        // zalozka Vzhled (tam patri sekce Ovladani) + doskrolovat na radek
        const t = [...document.querySelectorAll('#settings-modal .tab-btn')].find(b => /Vzhled/.test(b.innerText));
        if (t) t.click();
        const r = document.getElementById('ag-jr-setrow'); if (r) r.scrollIntoView({ block: 'center' });
    }""")
    await page.wait_for_timeout(400)
    await page.click('#ag-jr-setrow .st-sw')
    await page.wait_for_timeout(900)

    st = await page.evaluate("""() => {
        const jr = document.getElementById('ag-jr');
        const w = innerWidth, h = innerHeight;
        // ⚠ el.click() z JS projde i pres prekryti — proto se ptame, CO je opravdu
        // nahore v peti bodech obrazovky (rohy jsou uvnitr bezpecnych zon).
        const body = [[w/2,h/2],[24,80],[w-24,80],[24,h-40],[w-24,h-40]];
        const kryje = body.map(([x,y]) => {
            const el = document.elementFromPoint(x,y);
            return !!(el && jr && jr.contains(el));
        });
        const cs = jr ? getComputedStyle(jr) : null;
        return {
            zapnuto: !!(jr && jr.classList.contains('jr-on')),
            display: cs ? cs.display : null,
            klic: localStorage.getItem('agJednoduchy_v1'),
            kryje: kryje,
            nastaveniZavrena: (document.getElementById('settings-modal') || {}).style.display === 'none',
            tlacitka: [...document.querySelectorAll('#ag-jr-home button')].map(b => b.innerText.replace(/\\s+/g,' ').trim())
        };
    }""")
    ok('rezim je zapnuty a ulozeny', st['zapnuto'] and st['klic'] == '1', st)
    ok('prebal kryje celou obrazovku (5 bodu)', all(st['kryje']), st['kryje'])
    ok('Nastaveni se zavrela, at je prebal videt', st['nastaveniZavrena'], st['nastaveniZavrena'])
    ok('na uvodu jsou prave 3 tlacitka (2 velka + odchod)', len(st['tlacitka']) == 3, st['tlacitka'])
    ok('bez chyb v konzoli', not chyby, chyby)
    await page.close()


# ------------------------------------------------------------ B+C+D+E) provoz
async def test_provoz(ctx):
    print('\n--- B) novy bod z GPS, C) rucne, D) seznam, E) navigace ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await nacti(page, "!!(window.AGJednoduchy && document.getElementById('ag-jr'))")

    zap = await page.evaluate("() => { AGJednoduchy.zapni(); return !!document.getElementById('ag-jr').classList.contains('jr-on'); }")
    ok('rezim jde zapnout i z API', zap)

    # --- B) bod z GPS: klepneme na "PRIDAT BOD" -> "Z GPS" -> ULOZIT
    await page.click('#ag-jr-pridat')
    await page.wait_for_timeout(400)
    predvyplneno = await page.evaluate("() => document.getElementById('ag-jr-nazev').value")
    await page.evaluate("() => { document.getElementById('ag-jr-nazev').value = 'JR1'; document.getElementById('ag-jr-nazev').dispatchEvent(new Event('input')); }")
    st = await page.evaluate("""() => ({
        zamcene: document.getElementById('ag-jr-ulozit').disabled,
        popis: document.getElementById('ag-jr-ulozit').innerText.trim()
    })""")
    ok('ULOZIT je zamcene, dokud nejsou souradnice', st['zamcene'], st)
    ok('zamcene tlacitko rekne, co chybi', 'SOUŘADNICE' in st['popis'], st['popis'])

    await page.click('#ag-jr-zgps')
    await page.wait_for_timeout(7200)          # prumerovani je 6 s
    st = await page.evaluate("""() => ({
        vysledek: (document.getElementById('ag-jr-vysledek') || {}).innerText || '',
        ulozitZamcene: document.getElementById('ag-jr-ulozit').disabled
    })""")
    ok('mereni GPS skoncilo a hlasi vysledek', 'Změřeno' in st['vysledek'], st['vysledek'][:120])
    ok('ULOZIT se odemklo', not st['ulozitZamcene'], st)

    await page.click('#ag-jr-ulozit')
    await page.wait_for_timeout(900)
    st = await page.evaluate("""() => {
        const p = persistentCustomPoints.find(q => q.name === 'JR1');
        return { je: !!p, origin: p && p.prov && p.prov.origin, acc: p && p.acc,
                 lat: p && p.lat, lng: p && p.lng,
                 doma: document.getElementById('ag-jr-home').classList.contains('jr-vidno') };
    }""")
    ok('bod z GPS je v zakazce', st['je'], st)
    ok('bod ma provenienci gps-avg (ne "rucne")', st['origin'] == 'gps-avg', st['origin'])
    ok('bod sedi na simulovanou polohu (do 1 m)',
       st['je'] and abs(st['lat'] - GEO['latitude']) < 1e-5 and abs(st['lng'] - GEO['longitude']) < 1e-5, st)
    ok('po ulozeni jsme zpatky na uvodu rezimu', st['doma'], st['doma'])
    ok('nazev se predvyplnuje ze serie (nebo je prazdny)', isinstance(predvyplneno, str), repr(predvyplneno))

    # --- C) bod rucne: Y/X musi skoncit presne tam, kam patri
    await page.click('#ag-jr-pridat')
    await page.wait_for_timeout(300)
    serie = await page.evaluate("() => document.getElementById('ag-jr-nazev').value")
    ok('serie se po ulozeni posunula (JR1 -> JR2)', serie == 'JR2', serie)
    await page.click('#ag-jr-zruky')
    await page.wait_for_timeout(200)
    await page.evaluate("""() => {
        const s = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); };
        s('ag-jr-nazev', 'JR2');
        s('ag-jr-y', '742000,00');
        s('ag-jr-x', '1043000,00');
    }""")
    await page.wait_for_timeout(400)
    zamek = await page.evaluate("() => document.getElementById('ag-jr-ulozit').disabled")
    ok('ULOZIT se odemklo i u rucniho zadani', not zamek, zamek)
    await page.click('#ag-jr-ulozit')
    await page.wait_for_timeout(900)
    st = await page.evaluate("""() => {
        const p = persistentCustomPoints.find(q => q.name === 'JR2');
        const c = sjtskToLatLng(742000, 1043000);
        return { je: !!p, dlat: p ? Math.abs(p.lat - c.lat) : null, dlng: p ? Math.abs(p.lng - c.lng) : null,
                 origin: p && p.prov && p.prov.origin };
    }""")
    ok('rucne zadany bod je v zakazce', st['je'], st)
    ok('rucny bod lezi presne na zadanem Y/X',
       st['je'] and st['dlat'] < 1e-9 and st['dlng'] < 1e-9, st)
    ok('rucny bod ma provenienci "ruc"', st['origin'] == 'ruc', st['origin'])

    # --- H) body se nesmi zaspinit pomocnymi poli ze seznamu
    await page.click('#ag-jr-jit')
    await page.wait_for_timeout(900)
    st = await page.evaluate("""() => {
        const klice = new Set();
        persistentCustomPoints.forEach(p => Object.keys(p).forEach(k => klice.add(k)));
        return { klice: [...klice], ulozene: getStoredData('arCustomPoints12') || '' };
    }""")
    spinave = [k for k in st['klice'] if k.startswith('_')]
    ok('v bodech nezustalo zadne pomocne pole', not spinave, spinave)
    ok('ani v ulozenych datech neni _jrD', '_jrD' not in st['ulozene'], st['ulozene'][:120])

    # --- D) seznam: poradi od nejblizsiho + vzdalenosti sedi
    st = await page.evaluate("""() => {
        const radky = [...document.querySelectorAll('#ag-jr-seznam .jr-radek')];
        const jm = radky.map(r => r.querySelector('.jr-radek-jm').innerText.trim());
        const vz = radky.map(r => r.querySelector('.jr-radek-vzd').innerText.trim());
        const d = {};
        persistentCustomPoints.forEach(p => { d[p.name] = getDistance(userLat, userLng, p.lat, p.lng); });
        return { jm, vz, d, videt: document.getElementById('ag-jr-list').classList.contains('jr-vidno') };
    }""")
    ok('seznam je videt', st['videt'], st['videt'])
    poradi_ok = all(st['d'][st['jm'][i]] <= st['d'][st['jm'][i + 1]] + 1e-6 for i in range(len(st['jm']) - 1))
    ok('seznam je serazeny od nejblizsiho', poradi_ok and len(st['jm']) == 2, {'jm': st['jm'], 'd': st['d']})
    ok('nejblizsi je bod z GPS (stojime na nem)', st['jm'][0] == 'JR1', st['jm'])
    # cislo v seznamu musi sedet na skutecnou vzdalenost (do 1 m), ne byt jen "nejake"
    def _m(t):
        return float(t.replace(' ', ' ').replace(' m', '').replace(' km', '').replace(',', '.')) * (1000 if 'km' in t else 1)
    ok('vzdalenosti v seznamu sedi na skutecne (do 1 m)',
       all(abs(_m(st['vz'][i]) - st['d'][st['jm'][i]]) < 1.0 for i in range(len(st['jm']))),
       {'vz': st['vz'], 'd': st['d']})

    # --- E) navigace: uhel sipky = azimut - smer
    await page.evaluate("() => { smoothedHeading = 90; }")   # telefon miri na vychod
    await page.click('#ag-jr-seznam .jr-radek:last-child')
    await page.wait_for_timeout(700)
    st = await page.evaluate("""() => {
        const p = persistentCustomPoints.find(q => q.name === 'JR2');
        const az = getBearing(userLat, userLng, p.lat, p.lng);
        const tr = document.getElementById('ag-jr-sipka').style.transform;
        const m = /rotate\\(([-0-9.]+)deg\\)/.exec(tr);
        return { videt: document.getElementById('ag-jr-go').classList.contains('jr-vidno'),
                 nazev: document.getElementById('ag-jr-cilnazev').innerText.trim(),
                 vzd: document.getElementById('ag-jr-vzd').innerText.replace(/\\s+/g,' ').trim(),
                 pozn: document.getElementById('ag-jr-pozn').innerText.trim(),
                 uhel: m ? parseFloat(m[1]) : null,
                 ocekavany: ((az - 90) % 360 + 360) % 360,
                 skutecnaVzd: getDistance(userLat, userLng, p.lat, p.lng) };
    }""")
    ok('navigacni obrazovka je videt a jmenuje cil', st['videt'] and st['nazev'] == 'JR2', st)
    ok('sipka je otocena podle azimutu (do 1 stupne)',
       st['uhel'] is not None and abs(((st['uhel'] - st['ocekavany'] + 180) % 360) - 180) < 1.0, st)
    vzd_cislo = float(st['vzd'].replace(' ', ' ').replace('m', '').replace('k', '').strip().replace(',', '.'))
    if 'km' in st['vzd']:
        vzd_cislo *= 1000
    ok('vzdalenost na navigaci sedi na skutecnou (do 1 m)',
       abs(vzd_cislo - st['skutecnaVzd']) < 1.0, {'text': st['vzd'], 'skutecna': st['skutecnaVzd']})
    ok('napoveda neni varovna, kdyz kompas hlasi smer', 'azimutu' not in st['pozn'], st['pozn'])

    # bez kompasu: sipka nesmi lhat, ma se ozvat azimutem
    await page.evaluate("() => { smoothedHeading = null; }")
    await page.wait_for_timeout(600)
    st = await page.evaluate("""() => ({
        pozn: document.getElementById('ag-jr-pozn').innerText.trim(),
        varovani: document.getElementById('ag-jr-pozn').classList.contains('jr-varovani')
    })""")
    ok('bez kompasu se misto sipky rekne azimut', 'azimutu' in st['pozn'] and st['varovani'], st)

    # --- F) odchod z rezimu
    await page.evaluate("() => { smoothedHeading = 0; }")
    await page.click('#ag-jr-go [data-jr-zpet="list"]')
    await page.wait_for_timeout(300)
    await page.click('#ag-jr-list [data-jr-zpet="home"]')
    await page.wait_for_timeout(300)
    await page.click('#ag-jr-konec')
    await page.wait_for_timeout(700)
    st = await page.evaluate("""() => {
        const jr = document.getElementById('ag-jr');
        const el = document.elementFromPoint(innerWidth/2, innerHeight/2);
        return { zapnuto: jr.classList.contains('jr-on'), klic: localStorage.getItem('agJednoduchy_v1'),
                 kryje: !!(el && jr.contains(el)),
                 prepinac: (document.getElementById('ag-jr-switch') || {}).checked };
    }""")
    ok('"Cela appka" prebal sunda', not st['zapnuto'] and not st['kryje'], st)
    ok('volba se ulozila jako vypnuta', st['klic'] == '0', st['klic'])
    ok('prepinac v Nastaveni se srovnal', st['prepinac'] is False, st['prepinac'])
    ok('bez chyb v konzoli', not chyby, chyby)
    await page.close()


# ------------------------------------------------- G) rezim prezije restart
async def test_po_restartu(ctx):
    print('\n--- G) se zapnutou volbou naskoci rezim sam po startu appky ---')
    page = await ctx.new_page()
    chyby = []
    stazeno = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    # kolikrat se soubor opravdu stahne (rychla cesta v <head> ma odlozenou
    # polozku vyradit, jinak by si prohlizec sahl pro tyz modul dvakrat)
    page.on('request', lambda r: stazeno.append(r.url) if 'jednoduchy-rezim.js' in r.url else None)
    for _ in range(4):
        try:
            await page.goto(URL, wait_until='commit', timeout=45000)
            break
        except Exception:
            await page.wait_for_timeout(1500)
    # ⚠ PLACHTA: dokud modul nepostavi svou obrazovku, nesmi byt videt mapa ani dok.
    # ⚠ ODOLNE PROTI PRAZDNEMU DOKUMENTU. `wait_until='commit'` se vraci uz ve chvili,
    #   kdy je navigace potvrzena, ale HTML jeste nemusi byt rozparsovane - a v tom
    #   okamziku je `document.documentElement` NULL. Prvni odecet pak shodil CELY test
    #   vyjimkou "Cannot read properties of null (reading 'classList')" misto toho, aby
    #   pockal o 50 ms dele. Merenim overeno, ze plachta i rezim naskoci spravne
    #   (prelock hned, jr-on do ~1 s); byla to vada testu, ne appky.
    plachta = None
    for _ in range(40):
        plachta = await page.evaluate(
            "() => ({ prelock: !!(document.documentElement"
            " && document.documentElement.classList.contains('ag-jr-prelock')),"
            " jr: !!document.getElementById('ag-jr') })")
        if plachta['prelock'] or plachta['jr']:
            break
        await page.wait_for_timeout(50)
    ok('pres appku je hned plachta (zadne probliknuti mapy)', plachta and plachta['prelock'], plachta)
    # ⚠ ZADNE DALSI page.goto() — stahovani se pocita v ramci JEDNOHO nacteni stranky
    for _ in range(60):
        if await page.evaluate("() => !!(document.getElementById('ag-jr') && document.getElementById('ag-jr').classList.contains('jr-on'))"):
            break
        await page.wait_for_timeout(300)
    await page.wait_for_timeout(2500)
    ok('modul se stahl prave jednou (odlozena polozka se vyradila)', len(stazeno) == 1, stazeno)
    st = await page.evaluate("""() => {
        const jr = document.getElementById('ag-jr');
        const el = document.elementFromPoint(innerWidth/2, innerHeight/2);
        return { zapnuto: !!(jr && jr.classList.contains('jr-on')),
                 kryje: !!(el && jr && jr.contains(el)),
                 doma: !!document.getElementById('ag-jr-home').classList.contains('jr-vidno'),
                 plachtaPryc: !document.documentElement.classList.contains('ag-jr-prelock'),
                 kamera: !!(typeof currentVideoStream !== 'undefined' && currentVideoStream) };
    }""")
    ok('rezim naskocil sam', st['zapnuto'] and st['kryje'], st)
    ok('zacina na uvodu rezimu', st['doma'], st['doma'])
    ok('kamera pod prebalem nebezi (baterie)', not st['kamera'], st['kamera'])
    ok('plachta je po startu sundana', st['plachtaPryc'], st['plachtaPryc'])
    ok('bez chyb v konzoli', not chyby, chyby)
    await page.close()



# ------------------------------------------------- I) predvyplneni nazvu bodu
async def test_nazev(ctx):
    print('\n--- I) nazev bodu se predvyplni i bez rozjete serie ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await nacti(page, "!!(window.AGJednoduchy && typeof window.addImportedPoints === 'function')")
    # body prisly IMPORTEM — serie (agPointSerie) se tim nerozjede
    st = await page.evaluate("""async () => {
        removeStoredData('agPointSerie');
        const arr = [];
        ['101','102','103'].forEach((n,i) => { const c = sjtskToLatLng(742000+i*40, 1043000+i*40); arr.push({name:n, lat:c.lat, lng:c.lng}); });
        window.addImportedPoints(arr);
        await new Promise(r => setTimeout(r, 600));
        AGJednoduchy.zapni();
        document.getElementById('ag-jr-pridat').click();
        await new Promise(r => setTimeout(r, 400));
        return { serie: getStoredData('agPointSerie'), navrh: document.getElementById('ag-jr-nazev').value };
    }""")
    ok('serie opravdu nebezi (test by jinak nic nedokazoval)', not st['serie'], st['serie'])
    ok('nazev se dopocital z nejvyssiho cisla v zakazce (104)', st['navrh'] == '104', st)
    ok('bez chyb v konzoli', not chyby, chyby)
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
            for boot, fn in ((BOOT, test_zapnuti), (BOOT, test_provoz), (BOOT, test_nazev),
                             (BOOT_ZAPNUTO, test_po_restartu)):
                ctx = await browser.new_context(locale='cs-CZ', viewport={'width': 412, 'height': 915}, has_touch=True,
                                                permissions=['geolocation'], geolocation=GEO,
                                                service_workers='block')
                await ctx.add_init_script(boot)
                await fn(ctx)
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
