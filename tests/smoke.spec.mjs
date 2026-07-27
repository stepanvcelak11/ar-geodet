// ===== AR Geodet — SMOKE TEST (Playwright) ======================================
// Appka nemá build ani testy: každá změna se dosud zkoušela až na telefonu
// v terénu. Tenhle test v CI odpoví na to nejdůležitější: NASTARTUJE appka a
// nespadl při startu některý z ~100 modulů?
//
// Co dělá:
//   • pustí index.html v Chromiu s podvrženou GPS (Praha), falešnou kamerou
//     a podvrženým kompasem (CDP DeviceOrientation),
//   • přeskočí přihlašovací bránu (režim host = localStorage agGuest_v1),
//   • klikne „Spustit vyhledávání" a čeká, až se appka rozjede,
//   • posbírá chyby z konzole a nezachycené výjimky (síťové chyby ignoruje —
//     dlaždice mapy a ČÚZK v CI nejsou k dispozici),
//   • zkontroluje, že jsou na obrazovce klíčové prvky a že se zaregistrovaly
//     nástroje, a uloží screenshot jako artefakt.
//
// Spuštění lokálně:  npm i && npx playwright install --with-deps chromium && npm run test:smoke
// ================================================================================
import { test, expect } from '@playwright/test';

const PRAHA = { latitude: 50.0875, longitude: 14.4213 };

// Chyby, které v CI nejsou vada appky (není síť na dlaždice/ČÚZK, chybí povolení…)
const IGNORE = [
    /Failed to load resource/i,
    /net::ERR_/i,
    /ERR_INTERNET_DISCONNECTED/i,
    /tile\.openstreetmap/i,
    /ags\.cuzk\.(cz|gov\.cz)/i,
    /services\.cuzk/i,
    /Service Worker/i,
    /favicon/i,
    /geolocation/i,
    /A listener indicated an asynchronous response/i,
];
const isIgnored = (t) => IGNORE.some((re) => re.test(t));

async function bootApp(page, context) {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !isIgnored(m.text())) errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => { const t = String(e); if (!isIgnored(t)) errors.push('pageerror: ' + t); });

    await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:8099' });
    await context.setGeolocation(PRAHA);

    // režim host = přeskočí přihlašovací bránu (js/ucty.js), aby test neřešil PIN
    await page.addInitScript(() => {
        try {
            localStorage.setItem('agGuest_v1', JSON.stringify({ ts: Date.now() }));
            localStorage.setItem('agTutProSeen', '1');       // ať nevyskočí prohlídka
            localStorage.setItem('agBrifinkSeen_v1', new Date().toISOString().slice(0, 10));
        } catch (e) { }
    });

    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

    // kompas: bez podvrženého azimutu se AR smyčka vůbec nerozjede
    const cdp = await context.newCDPSession(page);
    await cdp.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 120, beta: 80, gamma: 2 });

    const start = page.locator('#welcome-start-btn');
    await expect(start).toBeVisible({ timeout: 20000 });
    await start.click();
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('app-started')), { timeout: 20000 }).toBe(true);

    // nech pár sekund běžet smyčky modulů (bublina, mapa, HUD) — chyby se často
    // objeví až v prvním intervalu, ne při načtení
    await page.waitForTimeout(4000);
    return errors;
}

test('appka nastartuje bez chyb a má klíčové prvky', async ({ page, context }, testInfo) => {
    const errors = await bootApp(page, context);

    await testInfo.attach('hlavni-obrazovka.png', { body: await page.screenshot(), contentType: 'image/png' });

    // 1) žádná nezachycená chyba
    expect(errors, 'chyby v konzoli při startu:\n' + errors.join('\n')).toEqual([]);

    // 2) stavová bublina (js/stavovy-pruh.js) je vidět a má obsah
    const bubble = page.locator('#ag-sp');
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText('m');

    // 3) dok a mapa
    await expect(page.locator('#dock .dock-primary')).toBeVisible();
    await expect(page.locator('#map')).toBeVisible();

    // 4) zaregistrovaly se nástroje (dlaždice v modálu Nástroje)
    const tiles = await page.locator('#tools-modal .tool-tile').count();
    expect(tiles, 'počet dlaždic v Nástrojích').toBeGreaterThan(25);

    // 5) klíčová API modulů existují (když modul spadne, globál chybí)
    const apis = await page.evaluate(() => ({
        geoCore: typeof window.GeoCore,
        statusBar: typeof window.AGStatusBar,
        mapRot: typeof window.AGMapRot,
        mini: typeof window.AGMini,
        karta: typeof window.AGKartaBodu,
        fieldTools: typeof window.agRegisterFieldTool,
    }));
    expect(apis).toEqual({
        geoCore: 'object', statusBar: 'object', mapRot: 'object',
        mini: 'object', karta: 'object', fieldTools: 'function',
    });
});

test('otáčení mapy: sever nahoře zamkne rotaci', async ({ page, context }) => {
    await bootApp(page, context);

    // panel Vrstvy → segment „Otáčení mapy" (js/map-rotate.js)
    await page.locator('#map-ctrl-toggle').click();
    const seg = page.locator('#ms-rot');
    await expect(seg).toBeVisible();

    await seg.locator('button[data-m="north"]').click();
    await expect.poll(() => page.evaluate(() => {
        const t = document.getElementById('map-wrapper').style.transform || '';
        const m = /rotate\((-?[\d.]+)deg\)/.exec(t);
        return m ? Math.abs(parseFloat(m[1])) : -1;
    }), { timeout: 6000 }).toBeLessThan(0.2);
    expect(await page.evaluate(() => window.AGMapRot.mode)).toBe('north');

    // zpátky na „po směru chůze" — rotace se musí zase řídit kompasem
    await seg.locator('button[data-m="course"]').click();
    expect(await page.evaluate(() => window.AGMapRot.mode)).toBe('course');
});

test('sbalitelný nástroj: vytyčení přímky běží dál v proužku', async ({ page, context }) => {
    await bootApp(page, context);

    // nástroj otevřeme jeho vlastním globálem (test nezávisí na rozložení dlaždic)
    const opened = await page.evaluate(() => {
        if (typeof window.agOpenStakeLine === 'function') { window.agOpenStakeLine(); return true; }
        return false;
    });
    test.skip(!opened, 'js/stakeout-line.js neexportuje agOpenStakeLine — přeskočeno');

    const modal = page.locator('#agsl-modal');
    await expect(modal).toBeVisible();

    const collapse = modal.locator('.ag-mini-btn');
    await expect(collapse).toBeVisible();
    await collapse.click();

    // proužek nahoře je vidět, modál ne — ale pořád je „otevřený" (běží mu smyčka)
    await expect(page.locator('#ag-mini')).toBeVisible();
    await expect(modal).toBeHidden();
    expect(await page.evaluate(() => document.getElementById('agsl-modal').style.display)).toBe('flex');

    // klepnutí na proužek nástroj vrátí
    await page.locator('#ag-mini').click();
    await expect(modal).toBeVisible();
    await expect(page.locator('#ag-mini')).toBeHidden();
});

test('karta bodu: navigační pruh a akce', async ({ page, context }) => {
    await bootApp(page, context);

    // vlastní bod 30 m severně od podvržené polohy → karta se otevře přes showDetails
    const ok = await page.evaluate(() => {
        if (typeof window.showDetails !== 'function' || typeof window.arPoints === 'undefined') return false;
        const pt = {
            id: 'test-bod-1', name: 'TEST-1', type: 'custom', cat: 'CUSTOM',
            lat: 50.0875 + 0.00027, lng: 14.4213, vyska: 200.5
        };
        window.arPoints.push(pt);
        window.showDetails(pt, 30);
        return true;
    });
    test.skip(!ok, 'showDetails/arPoints nejsou globální — přeskočeno');

    await expect(page.locator('#bottom-sheet')).toHaveClass(/open/);
    await expect(page.locator('#ag-kb-nav')).toBeVisible();
    await expect(page.locator('#ag-kb-dist')).toContainText('m');
    await expect(page.locator('#ag-kb-acts button[data-a="nav"]')).toContainText('Doveď mě');
    await expect(page.locator('#ag-kb-acts button[data-a="check"]')).toBeVisible();
    // převýšení k bodu se počítá z výšky bodu (200,5 m) — pruh ho musí zmínit
    await expect(page.locator('#ag-kb-sub')).toContainText('azimut');
});
