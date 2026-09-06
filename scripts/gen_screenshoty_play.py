#!/usr/bin/env python3
# ===== AR Geodet — SKUTECNE SNIMKY OBRAZOVKY DO GOOGLE PLAY ===================
# Vyfoti BEZICI appku (ne kreslene panely) v rozmeru, ktery Google Play bere:
#
#     play/screenshoty/01-mapa.png .. 05-*.png    1080 x 1920 (pomer presne 9:16)
#
# PROC TENHLE SKRIPT EXISTUJE VEDLE scripts/gen_promo.py:
#   gen_promo.py renderuje play/promo.html — to jsou KRESLENE ilustrace, ne
#   snimky appky. Google vyzaduje, aby snimky obrazovky odpovidaly skutecnemu
#   vzhledu aplikace; kreslene panely nahrane jako screenshoty jsou bezny duvod
#   k zamitnuti za zavadejici zaznam. Tenhle skript proto foti realnou appku.
#
# JAK SE OBCHAZI PRIHLASOVACI BRANA:
#   js/ucty.js drzi pri startu branu (#ag-gate). Pouziva se REZIM VLASTNIKA
#   (agVlastnik_v1='1', js/vlastnik.js) — brana se preskoci a can() vraci
#   vsude true, takze je videt cela appka.
#   (Hostovsky rezim, ktery se tu driv zminoval jako alternativa, byl 6. 9.
#   2026 zrusen — bez profilu se do appky nedostane nikdo.)
#
# ⚠ ROZMER: viewport 360x640 CSS pri device_scale_factor=3 => PNG 1080x1920.
#   Neni to nahodne cislo: 360x640 je klasicky androidi telefon, takze appka
#   sazi MOBILNI rozvrzeni. Kdyby se dalo 540x960, appka by se rozlozila jinak.
#
# ⚠ BODY: seje se do localStorage klice `default_arCustomPoints12`. Funguje to
#   proto, ze getStoredData() (js/logika.js) cte pro IDB klice localStorage
#   VZDY, dokud neni nahydrovana pamet _idbMem. Prazdna appka by dala prazdne
#   snimky, a ty by v obchode nikoho neoslovily.
#
# Pouziti (z korene repa):   python scripts/gen_screenshoty_play.py [port]
# ==============================================================================
import asyncio
import json
import os
import random
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'play', 'screenshoty')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8460

# Stred sceny — Pardubice, rovina u silnice (uzivatel dela pokladku silnic).
LAT, LNG = 50.0380, 15.7790

NAZVY = [
    ('R1-14', 'Rohový bod', 0.9),
    ('OS-101', 'Osa vozovky', 1.2),
    ('OS-102', 'Osa vozovky', 1.1),
    ('OS-103', 'Osa vozovky', 1.4),
    ('KR-7', 'Kraj zpevnění', 2.0),
    ('KR-8', 'Kraj zpevnění', 1.8),
    ('SO-201', 'Šachta', 0.7),
    ('SO-202', 'Šachta', 0.8),
    ('LOM-3', 'Lom obrubníku', 1.5),
    ('LOM-4', 'Lom obrubníku', 1.6),
    ('VB-12', 'Vytyčovací bod', 0.6),
    ('VB-13', 'Vytyčovací bod', 0.9),
]


def demo_body():
    """Vyrobi hodnoverne body kolem osy silnice (mirny oblouk, ne nahodny shluk)."""
    random.seed(7)                       # stejne snimky pri kazdem spusteni
    out = []
    t0 = int(time.time() * 1000) - 3 * 3600 * 1000
    for i, (jm, kod, acc) in enumerate(NAZVY):
        # osa vede k severovychodu, body se od ni rozestupuji na obe strany
        s = i / (len(NAZVY) - 1.0)
        lat = LAT + s * 0.0016 + (random.random() - 0.5) * 0.00035
        lng = LNG + s * 0.0024 + (random.random() - 0.5) * 0.00045
        out.append({
            'id': 'cp_demo_%d' % i,
            'name': jm,
            'lat': round(lat, 7),
            'lng': round(lng, 7),
            'cat': 'CUSTOM',
            'type': 'custom',
            'mts': t0 + i * 420000,
            'vyska': round(223.4 + s * 1.9 + (random.random() - 0.5) * 0.3, 2),
            'kod': kod,
            'acc': acc,
            'prov': {'origin': 'gps', 'ts': t0 + i * 420000, 'acc': acc, 'qc': None},
        })
    return out


# Bezi PRED skripty appky: nastavi rezim vlastnika (zadna brana), jmeno meric,
# posledni polohu (aby mapa hned centrovala na scenu) a demo body.
def boot_script():
    return """
try {
  localStorage.setItem('agVlastnik_v1','1');        // rezim vlastnika: bez brany, vse povoleno
  localStorage.setItem('agTutProSeen','1');         // bez uvodniho tutorialu pres obrazovku
  localStorage.setItem('agBrifinkAuto','0');        // rannni brifink neotevirat sam
  localStorage.setItem('arSurveyor','Stepan');
  localStorage.setItem('arLastPos', JSON.stringify({lat: %f, lng: %f}));   // stred shluku bodu
  localStorage.setItem('default_arCustomPoints12', %s);
  localStorage.setItem('arActiveProjectId','default');
  localStorage.setItem('arProjectsList', JSON.stringify([{id:'default', name:'Obchvat II/322'}]));
} catch (e) {}
""" % (LAT + 0.0008, LNG + 0.0012, json.dumps(json.dumps(demo_body())))


# --- Co se foti. `pred` je JS, ktery obrazovku otevre; `cekat` je ms navic. ----
# ⚠ Pred KAZDYM zaberem se stranka nacte znovu. Drivejsi verze jen schovavala
#   otevrena okna pres querySelectorAll('[id$="-modal"]') — okno "Vlozit bod"
#   tomu selektoru neodpovida, zustalo navrchu a snimek 05 vysel jako kopie 04.
#   Reload je pomalejsi, ale nemuze lhat.
ZABERY = [
    {'id': '01-mapa', 'popis': 'Hlavni obrazovka s mapou a body',
     'pred': None, 'cekat': 2500},
    {'id': '02-body', 'popis': 'Seznam bodu / sprava',
     'pred': "openManageModal()", 'cekat': 1400},
    {'id': '03-nastroje', 'popis': 'Nastroje',
     'pred': "document.getElementById('tools-modal').style.display='flex'", 'cekat': 1400,
     # posun dolu na mrizku dlazdic: nahore je jen vyber profilu, ktery o appce nic nerekne
     # Zarovnat na HLAVICKU kategorie: .tool-cat je sticky, takze pri libovolnem
     # posunu prekryva radek pod sebou a snimek vypada jako zavada vykresleni.
     'po': "var m=document.querySelector('#tools-modal .modal-body');"
           "if(m){var r0=m.getBoundingClientRect(),c=m.querySelectorAll('.tool-cat');"
           "for(var i=0;i<c.length;i++){var d=c[i].getBoundingClientRect().top-r0.top+m.scrollTop;"
           "if(d>300){m.scrollTop=d-4;break;}}}"},
    {'id': '04-novy-bod', 'popis': 'Zalozeni noveho bodu',
     'pred': "openNewPointModal()", 'cekat': 1200},
    {'id': '05-vytyceni', 'popis': 'Vytyceni osy (pokladka silnice)',
     'pred': "agOpenStakeLine()", 'cekat': 1400},
]

# Stavova bublina ("GPS bez fixu…") je docasne hlaseni, ne soucast rozvrzeni.
# Na snimku do obchodu prekryva horni tretinu, tak se sklidi jako by ji uzivatel
# odklikl. Nic jineho se neschovava.
# `#ag-sp` je sama bublina (js/stavovy-pruh.js:346), `#ag-stack` jen sloupec,
# do ktereho ji upozorneni.js adoptuje — schovat je proto potreba obe.
SKLIDIT_BUBLINU = ("try{['ag-sp','ag-stack'].forEach(function(i){"
                   "var e=document.getElementById(i); if(e)e.style.setProperty('display','none','important');});"
                   "}catch(e){}")

async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print('Chybi Playwright:  pip install playwright  &&  python -m playwright install chromium')
        return 2

    os.makedirs(OUT, exist_ok=True)

    # Server na vic portech: na Windows zustava port po predchozim behu obsazeny.
    srv = None
    url = None
    for pokus in range(6):
        port = PORT + pokus * 2
        u = 'http://127.0.0.1:%d/index.html' % port
        srv = subprocess.Popen([sys.executable, os.path.join(ROOT, 'scripts', 'test_server.py'), str(port)],
                               cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            try:
                urllib.request.urlopen(u, timeout=1).read(64)
                url = u
                break
            except Exception:
                time.sleep(0.4)
        if url:
            break
        srv.terminate()
    if not url:
        print('Nepodarilo se nastartovat testovaci server.')
        return 2

    chyby = []
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(args=['--use-fake-ui-for-media-stream'])
            ctx = await browser.new_context(
                viewport={'width': 360, 'height': 640},
                device_scale_factor=3,            # 360*3 x 640*3 = 1080 x 1920
                is_mobile=True, has_touch=True,
                locale='cs-CZ',
                geolocation={'latitude': LAT + 0.0008, 'longitude': LNG + 0.0012, 'accuracy': 3},
                permissions=['geolocation'],
            )
            await ctx.add_init_script(boot_script())
            page = await ctx.new_page()
            page.on('pageerror', lambda e: chyby.append(str(e)[:200]))
            await page.goto(url, wait_until='domcontentloaded')
            await page.wait_for_timeout(3500)     # start appky + nacteni dlazdic mapy

            # Kolik bodu appka opravdu vidi (kdyby seti selo, snimky by byly prazdne)
            pocet = await page.evaluate(
                "() => { try { return (typeof persistentCustomPoints !== 'undefined' &&"
                " persistentCustomPoints.length) || 0; } catch(e) { return -1; } }")
            print('bodu v appce: %s' % pocet)
            if pocet in (0, -1):
                print('POZOR: appka nevidi zadne body — snimky budou prazdne.')

            brana = await page.evaluate("() => !!document.getElementById('ag-gate')")
            if brana:
                print('POZOR: prihlasovaci brana je stale videt (rezim vlastnika nezabral).')

            for z in ZABERY:
                await page.goto(url, wait_until='domcontentloaded')
                await page.wait_for_timeout(3200)      # start appky + dlazdice mapy
                if z['pred']:
                    try:
                        await page.evaluate('() => { %s }' % z['pred'])
                    except Exception as e:
                        print('  %-14s PRESKOCENO (%s)' % (z['id'], str(e)[:90]))
                        continue
                await page.wait_for_timeout(z['cekat'])
                if z.get('po'):
                    try:
                        await page.evaluate('() => { %s }' % z['po'])
                        await page.wait_for_timeout(500)
                    except Exception:
                        pass
                await page.evaluate(SKLIDIT_BUBLINU)
                await page.wait_for_timeout(250)
                cesta = os.path.join(OUT, z['id'] + '.png')
                await page.screenshot(path=cesta)
                kb = os.path.getsize(cesta) // 1024
                print('  %-14s %-38s %5d kB' % (z['id'], z['popis'], kb))

            await browser.close()
    finally:
        if srv:
            srv.terminate()

    if chyby:
        print('\nChyby v konzoli appky (%d):' % len(chyby))
        for c in chyby[:5]:
            print('  ' + c)

    print('\nHotovo -> %s   (1080 x 1920, pomer 9:16)' % OUT)
    print('Do Play Console: Zaznam v obchode -> Snimky obrazovky telefonu.')
    print('AR pohled se takhle vyfotit NEDA (headless prohlizec nema kameru) — ten')
    print('udelej na telefonu a pridej k temhle jako dalsi snimek.')
    return 0


sys.exit(asyncio.run(main()))
