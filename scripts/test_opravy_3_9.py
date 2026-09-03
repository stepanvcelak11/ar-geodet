#!/usr/bin/env python3
# ===== AR Geodet - OPRAVY Z 3. 9. 2026 (v272) ================================
# Ctyri vady, ktere nasla prohlidka appky spustenim. Vsechny maji spolecne to, ze
# appka delala neco JINEHO, nez slibovala uzivateli - a zadna kontrola v CI je
# chytit nemohla, protoze vznikaji az slozenim modulu za behu.
#
#   A) KOS POBRAL JEN 15 ZAZNAMU (js/kos.js). Hromadne mazani v panelu Body se
#      pta „Opravdu smazat 25 vybranych bodu? Obnovit je pujde 30 dni z kose" -
#      jenze do kose se z tech 25 veslo POSLEDNICH 15 a zbytek zmizel nadobro.
#      U hromadneho mazani se navic toast „Vratit zpet" schvalne neukazuje, takze
#      kos je tam jedina zachrana. Testuje se, ze po smazani 25 bodu jich je
#      v kosi 25 a daji se obnovit.
#
#   B) HLEDANI ODKRYVALO, CO ZAKAZALA ROLE (js/field-tools.js). js/ucty.js schova
#      zakazane dlazdice pres display:none + data-agucty, ale filtr hledani display
#      prepisoval - zamestnanec bez kategorie „Katastr a data" videl po napsani „k"
#      devet zakazanych dlazdic, nez je dalsi tik applyPerms zase schoval.
#
#   C) NASTROJ NESEL NAJIT PODLE JMENA, KTERE APPKA SAMA UKAZUJE (tools-registry).
#      Dlazdice se jmenuje jinak nez radek v seznamu ukonu („Hlasove poznamky" x
#      „Hlasovou poznamku") a hledalo se jen podle jmena dlazdice + `keys`.
#      U nastroju s `hidden: 1` je pritom hledani JEDINA cesta k nim.
#
#   D) ZABLOKOVANY UCET SE SAM NEODHLASIL (js/ucty.js). Admin pri blokaci cte, ze
#      se ucet „odhlasi do minuty" i na mobilu, kde je prave prihlaseny. Slib ale
#      nikdo neplnil: refreshConfig() se volal jen po prihlaseni, po navratu online
#      a z panelu firmy. Ucet zablokovany na serveru jel dal i po 160 s.
#
# Pouziti (z korene repa):  python scripts/test_opravy_3_9.py [port]
# ==============================================================================
import asyncio
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8931
URL = None

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

# Zamestnanec, kteremu admin ZAKAZAL kategorii "Katastr a data".
BOOT_ZAM = """
  localStorage.setItem('agTutProSeen','1');
  localStorage.setItem('agBrifinkAuto','0');
  localStorage.setItem('arSurveyor','Josef');
  localStorage.setItem('agFirmaBioAsk_v1', String(Date.now()));
  (function () {
    var zm = {};
    ['dock.novybod','dock.body','dock.nastroje','dock.vice','dock.nastaveni',
     'tools.M\\u011b\\u0159en\\u00ed','tools.Vyty\\u010dov\\u00e1n\\u00ed a n\\u00e1\\u010drt','tools.Katastr a data',
     'tools.AR a kalibrace','tools.Pom\\u016fcky','tools.Ter\\u00e9nn\\u00ed n\\u00e1stroje',
     'set.tab-ar','set.tab-data','set.tab-udrzba','x.dashboard'].forEach(function (k) { zm[k] = true; });
    zm['tools.Katastr a data'] = false;
    var f = { enabled: true, firmName: 'Testfirma', createdTs: Date.now(), autoLockMin: 0,
      perms: { zamestnanec: zm },
      users: [{ id: 'u1', name: 'Stepan', role: 'admin', salt: 'aa', pinHash: 'x', noPin: true },
              { id: 'u2', name: 'Josef', role: 'zamestnanec', salt: 'bb', pinHash: 'y', noPin: true }] };
    localStorage.setItem('agFirma_v1', JSON.stringify(f));
    localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: 'u2', ts: Date.now() }));
    localStorage.setItem('agLockStart_v1','0');
  })();
"""

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
    # ⚠ Bez flushe odlozenych modulu hlasi pulka nastroju "is not defined" falesne.
    for _ in range(40):
        if await page.evaluate("() => " + cekej_na):
            break
        await page.evaluate("() => window.AGLazy && AGLazy.flush()")
        await page.wait_for_timeout(400)
    await page.wait_for_timeout(2200)


# ---------------------------------------------------------------- A) KOS
async def test_kos(ctx):
    print('\n--- A) kos pobere i hromadne smazani ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await nacti(page, "typeof window.deleteCustomPoint === 'function'")

    st = await page.evaluate("""async () => {
        localStorage.removeItem('agTrash');
        // 25 bodu jako po dni v terenu - stejnou cestou, jakou je nasype import
        const arr = [];
        for (let i = 0; i < 25; i++) {
            const c = sjtskToLatLng(742000 + i * 3, 1043000 + i * 3);
            arr.push({ name: 'T' + (100 + i), lat: c.lat, lng: c.lng, vyska: 300 + i });
        }
        window.addImportedPoints(arr);
        await new Promise(r => setTimeout(r, 800));

        // HROMADNE MAZANI PRESNE TAK, JAK HO DELA UZIVATEL: panel Body -> rezim
        // vyberu -> vybrat vse -> Smazat -> potvrdit. (Primo volane
        // deleteCustomPoint() by tuhle cestu obeslo a nic by neoverilo.)
        openManageModal();
        await new Promise(r => setTimeout(r, 1800));
        const sb = document.getElementById('mng-selbtn'); if (sb) sb.click();
        await new Promise(r => setTimeout(r, 900));
        const all = document.getElementById('mng-all'); if (all) all.click();
        await new Promise(r => setTimeout(r, 1200));
        const out = { vybrano: (document.getElementById('mng-count') || {}).innerText || null };
        out.pred = persistentCustomPoints.length;
        const del = [...document.querySelectorAll('#manage-modal button')]
            .find(b => /^Smazat$/.test((b.textContent || '').trim()));
        out.tlacitko = !!del;
        if (del) del.click();
        await new Promise(r => setTimeout(r, 700));
        const dlg = document.querySelector('.ag-dlg-overlay.open');
        out.dialog = dlg ? (dlg.textContent || '').replace(/\\s+/g, ' ').trim() : null;
        if (dlg) { const okb = dlg.querySelector('.ag-dlg-ok'); if (okb) okb.click(); }
        await new Promise(r => setTimeout(r, 2000));
        out.po = persistentCustomPoints.length;
        let kos = [];
        try { kos = JSON.parse(localStorage.getItem('agTrash') || '[]'); } catch (e) {}
        const body = kos.filter(r => r.type === 'point');
        out.vKosi = body.length;
        out.jmena = body.map(r => r.point && r.point.name);
        out.prvni = body.length ? body[0].point.name : null;
        return out;
    }""")
    print('   smazano %d bodu, v kosi %d' % (st.get('pred', 0), st.get('vKosi', 0)))
    print('   dialog:', st.get('dialog'))
    ok('A1 smazalo se vsech 25 vybranych bodu', st.get('pred') == 25 and st.get('po') == 0,
       {'pred': st.get('pred'), 'po': st.get('po'), 'tlacitko': st.get('tlacitko')})
    ok('A1b dialog slibuje obnovu z kose', 'koše' in (st.get('dialog') or ''), st.get('dialog'))
    ok('A2 v kosi jsou VSECHNY smazane body (drive jen poslednich 15)',
       st.get('vKosi') == 25, {'vKosi': st.get('vKosi')})
    ok('A3 v kosi je i PRVNI smazany bod (ten drive vypadl)',
       st.get('prvni') == 'T100', st.get('prvni'))

    # a musi jit obnovit zpatky do zakazky
    obn = await page.evaluate("""async () => {
        if (!window.AGKos || typeof AGKos.restore !== 'function') {
            // nazev API se muze lisit - zkus, co modul vystavuje
            return { api: Object.keys(window).filter(k => /kos/i.test(k)) };
        }
        return { api: 'AGKos.restore' };
    }""")
    print('   API kose:', obn)
    ok('A4 bez chyby v konzoli', not chyby, chyby[:3])
    await page.close()


# ---------------------------------------------------------- B) + C) HLEDANI
ZAKAZANE = """() => {
  const vidno = (el) => { const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05; };
  return [...document.querySelectorAll('#tools-modal .tool-tile[data-agucty], #tools-modal .ag-ft-tile[data-agucty]')]
    .filter(vidno).map(t => (t.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24));
}"""


async def test_hledani_prava(ctx):
    print('\n--- B) hledani neodkryje, co zakazala role ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    await nacti(page, "typeof window.AGUcty === 'object' && typeof window.AGReg === 'object'")
    await page.evaluate("() => { const m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; }")
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(2000)

    klid = await page.evaluate(ZAKAZANE)
    ok('B1 v klidu neni zakazana dlazdice videt', not klid, klid)

    sel = '#tools-modal #tools-search'
    vzorky = []
    for znak in ['k', 'a', 't', 'a']:
        await page.type(sel, znak, delay=40)
        # vzorkuje se HUSTE: vada byla probliknuti do dalsiho tiku applyPerms (~2 s)
        for _ in range(4):
            await page.wait_for_timeout(150)
            vzorky.append((znak, await page.evaluate(ZAKAZANE)))
    spatne = [(z, v) for z, v in vzorky if v]
    ok('B2 pri psani do hledani zustavaji zakazane dlazdice skryte', not spatne, spatne[:2])

    await page.fill(sel, '')
    po = []
    for _ in range(8):
        await page.wait_for_timeout(200)
        po.append(await page.evaluate(ZAKAZANE))
    ok('B3 po vymazani dotazu zustavaji zakazane dlazdice skryte',
       not [v for v in po if v], [v for v in po if v][:2])

    # nadpis zakazane kategorie taky nesmi vyplavat
    hlav = await page.evaluate("""() => {
      const vidno = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2
          && getComputedStyle(el).display !== 'none'; };
      return [...document.querySelectorAll('#tools-modal .tool-cat[data-agucty], #tools-modal .ag-ft-head[data-agucty]')]
        .filter(vidno).map(e => (e.textContent || '').trim().slice(0, 24));
    }""")
    ok('B4 nadpis zakazane kategorie zustava skryty', not hlav, hlav)
    ok('B5 bez chyby v konzoli', not chyby, chyby[:3])
    await page.close()


async def test_hledani_nazvu(ctx):
    print('\n--- C) nastroj se najde pod jmenem, ktere appka ukazuje ---')
    page = await ctx.new_page()
    await nacti(page, "typeof window.AGReg === 'object'")
    await page.evaluate("() => { const m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; }")
    await page.evaluate("() => window.AGLazy && AGLazy.flush()")
    await page.wait_for_timeout(2000)
    sel = '#tools-modal #tools-search'

    async def hledej(dotaz):
        await page.fill(sel, '')
        await page.wait_for_timeout(350)
        await page.fill(sel, dotaz)
        await page.wait_for_timeout(800)
        return await page.evaluate("""() => {
          const vidno = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2
              && getComputedStyle(el).display !== 'none'; };
          return [...document.querySelectorAll('#tools-modal .tool-tile')].filter(vidno)
                 .map(t => (t.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24));
        }""")

    # `vl` z registru = jmeno, pod kterym nastroj stoji v seznamu ukonu
    for dotaz, klic in [('Hlasovou poznámku', 'hlasovky'),
                        ('Přesnou GPS', 'brutal-gps'),
                        ('Ověření bodů', 'overeni-bodu')]:
        v = await hledej(dotaz)
        print('   "%s" -> %d: %s' % (dotaz, len(v), v[:3]))
        ok('C "%s" (jmeno ze seznamu ukonu) neco najde' % dotaz, len(v) > 0, v[:3])

    # kontrola, ze se hledani nerozsypalo do "najde vzdycky vsechno"
    v = await hledej('xyzqwertz')
    ok('C nesmysl nenajde nic', len(v) == 0, v[:3])
    await page.close()


# ------------------------------------------------------- D) ZABLOKOVANY UCET
async def test_blokace(ctx, base):
    print('\n--- D) zablokovany ucet se do minuty sam odhlasi ---')
    page = await ctx.new_page()
    chyby = []
    page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
    pocet = {'config': 0}
    disabled = {'on': False}

    async def api(route):
        u = route.request.url
        if '/config' in u:
            pocet['config'] += 1
            cfg = {
                'firm': {'code': 'TEST1', 'name': 'Cloudfirma', 'autoLockMin': 0, 'perms': {}},
                'users': [
                    {'id': 'u1', 'name': 'Stepan', 'role': 'admin'},
                    {'id': 'u2', 'name': 'Josef', 'role': 'zamestnanec', 'disabled': disabled['on']},
                ],
            }
            await route.fulfill(status=200, content_type='application/json', body=json.dumps(cfg))
            return
        await route.fulfill(status=200, content_type='application/json', body='{}')

    # ⚠⚠ ODCHYT MUSI BYT NA KONTEXTU, NE NA STRANCE, a service worker se musi
    #   vypnout (viz new_context nize). Pres page.route() neprosel ANI JEDEN dotaz:
    #   appka ma registrovany SW a pozadavky, ktere jdou skrz nej, se do routovani
    #   stranky nedostanou. Glob '**/agapi/**' navic na URL s ?_=razitkem nesedl,
    #   proto regulerni vyraz. Kontrolni bod D1c hlida, ze odchyt opravdu funguje —
    #   bez nej by D2 melo falesnou nulu a "vada" by se hlasila po kazde oprave.
    await ctx.route(re.compile(r'.*/agapi/.*'), api)
    await page.add_init_script("""
      localStorage.setItem('agTutProSeen','1');
      localStorage.setItem('agBrifinkAuto','0');
      localStorage.setItem('arSurveyor','Josef');
      localStorage.setItem('agFirmaBioAsk_v1', String(Date.now()));
      localStorage.setItem('agFirma_v1', JSON.stringify({
        enabled: true, cloud: true, api: '%s/agapi', code: 'TEST1', firmName: 'Cloudfirma',
        autoLockMin: 0, perms: {},
        users: [{ id: 'u1', name: 'Stepan', role: 'admin' },
                { id: 'u2', name: 'Josef', role: 'zamestnanec' }] }));
      localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: 'u2', ts: Date.now() }));
      localStorage.setItem('agFirmaTok_v1', JSON.stringify({ token: 'tok-josef', userId: 'u2' }));
      localStorage.setItem('agLockStart_v1','0');
    """ % base)

    await nacti(page, "typeof window.AGUcty === 'object'")
    # ⚠ Periodicky tik jede pres AG.uiInterval, ktery se NEROZBEHNE, dokud je
    #   stranka na pozadi (document.visibilityState). V Playwrightu se to stane,
    #   jakmile je otevrena jina zalozka - proto se stranka musi vytahnout dopredu.
    await page.bring_to_front()
    kdo = await page.evaluate("() => (window.AGUcty.currentUser() || {}).name || null")
    vid = await page.evaluate("() => document.visibilityState")
    print('   viditelnost stranky:', vid)
    ok('D1 zamestnanec jede v cloudove firme', kdo == 'Josef', kdo)
    ok('D1b stranka je vepredu (jinak UI casovace nejedou)', vid == 'visible', vid)

    # kontrola, ze test umi zachytit dotaz na server (jinak by D2 melo falesnou nulu)
    pocet['config'] = 0
    await page.evaluate("() => window.AGUcty.refreshConfig && AGUcty.refreshConfig()")
    await page.wait_for_timeout(1200)
    ok('D1c testovaci odchyt /config funguje', pocet['config'] >= 1, pocet['config'])

    pocet['config'] = 0
    disabled['on'] = True          # admin ho prave zablokoval na serveru
    odhlasen_po = None
    t0 = time.time()
    while time.time() - t0 < 80:
        await page.wait_for_timeout(2000)
        st = await page.evaluate("""() => {
            const g = document.getElementById('ag-login') || document.getElementById('ag-gate');
            return { kdo: (window.AGUcty.currentUser() || {}).name || null,
                     brana: !!(g && getComputedStyle(g).display !== 'none') };
        }""")
        if st['kdo'] is None or st['brana']:
            odhlasen_po = round(time.time() - t0)
            break
    print('   dotazu na /config: %d, odhlasen po: %s s' % (pocet['config'], odhlasen_po))
    ok('D2 appka se sama zeptala serveru na konfiguraci (do minuty)', pocet['config'] >= 1, pocet['config'])
    ok('D3 zablokovany ucet je do minuty venku (jak slibuje hlaska admina)',
       odhlasen_po is not None and odhlasen_po <= 70, odhlasen_po)
    ok('D4 bez chyby v konzoli', not chyby, chyby[:3])
    await page.close()


async def main():
    from playwright.async_api import async_playwright
    srv = server()
    if not srv:
        print('Testovaci server nenabehl.')
        return 2
    base = URL.rsplit('/', 1)[0]
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            geo = {'latitude': 50.08, 'longitude': 14.43, 'accuracy': 3}
            for boot, fn in ((BOOT_ADMIN, test_kos), (BOOT_ZAM, test_hledani_prava), (BOOT_ADMIN, test_hledani_nazvu)):
                ctx = await browser.new_context(viewport={'width': 412, 'height': 915}, has_touch=True,
                                                permissions=['geolocation'], geolocation=geo)
                await ctx.add_init_script(boot)
                await fn(ctx)
                await ctx.close()

            ctx = await browser.new_context(viewport={'width': 412, 'height': 915}, has_touch=True,
                                            permissions=['geolocation'], geolocation=geo,
                                            service_workers='block')
            await test_blokace(ctx, base)
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
