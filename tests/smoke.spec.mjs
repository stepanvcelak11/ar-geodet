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
            // Ranní brífink (js/brifink.js) se sám otevře 1× denně a je to celoobrazovkový
            // modál — přes něj se nedá klikat a testy pak umíraly na timeout. Vypínáme ho
            // NATVRDO ('agBrifinkAuto' = '0') a k tomu značíme, že dnes už byl
            // ('agBrifinkLastShown'). Dřív tu byl klíč 'agBrifinkSeen_v1', který ale
            // brifink.js vůbec nečte — potlačení tedy nefungovalo.
            localStorage.setItem('agBrifinkAuto', '0');
            localStorage.setItem('agBrifinkLastShown', new Date().toISOString().slice(0, 10));
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

    // DIAGNOSTIKA: když něco leží přes celou appku (modál, brána, brífink), klikání
    // v dalších testech umře na timeout a z hlášky se nedá poznat proč. Radši to
    // řekneme jménem prvku hned tady.
    const blokuje = await page.evaluate(() => {
        const jde = [];
        document.querySelectorAll('.modal-overlay, #ag-gate, #ag-login').forEach((el) => {
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return;
            const r = el.getBoundingClientRect();
            if (r.width > innerWidth * 0.6 && r.height > innerHeight * 0.6) jde.push(el.id || el.className);
        });
        return jde;
    });
    expect(blokuje, 'přes appku leží celoobrazovkový prvek — další testy by umřely na timeout').toEqual([]);

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

// ===== REGRESE z prohlížečového auditu 8.8. =====================================
// Čtyři chyby, které se v konzoli NEPROJEVILY jako error (takže je test „žádné chyby
// v konzoli" propustil) a přesto byly vidět na obrazovce. Každá má vlastní tvrzení.

test('REGRESE: appka se po startu sama NEREloaduje', async ({ page, context }) => {
    // sw.js volá při 'activate' clients.claim(). Na PRVNÍM načtení (ještě bez
    // controlleru) tím vystřelí 'controllerchange' hned po instalaci — a handler
    // v js/logika.js appku ~2 s po klepnutí na „Spustit vyhledávání" natvrdo
    // reloadoval zpátky na úvodní obrazovku. Navíc se tím přerušilo dotahování
    // modulů, takže se zaregistrovala jen ČÁST nástrojů (43 místo 70).
    await bootApp(page, context);
    const boot1 = await page.evaluate(() => performance.timeOrigin);
    await page.waitForTimeout(6000);           // reload chodil cca 2 s po startu
    const boot2 = await page.evaluate(() => performance.timeOrigin);
    expect(boot2, 'stránka se znovu načetla (performance.timeOrigin se změnil)').toBe(boot1);
    expect(await page.evaluate(() => document.body.classList.contains('app-started'))).toBe(true);
});

test('REGRESE: vstupy na úvodní obrazovce a řádek terénu se vloží', async ({ page, context }) => {
    // js/zpravodaj.js i js/predpisy.js volaly wrap.insertBefore(btn, kotva…), ale
    // kotva leží v .w-c-actions, ne přímo v .modal-content → NotFoundError (jen
    // console.warn) a tlačítka na úvodní obrazovce CHYBĚLA. Stejná chyba v
    // js/dmr-terrain.js znamenala, že se nevyrobil #btn-terrain, a protože
    // js/map-tools.js bez něj řádek „Terén (DMR 5G)" SKRÝVÁ, byl celý terénní AR
    // z UI nedostupný.
    const warns = [];
    page.on('console', (m) => { if (m.type() === 'warning' && /insertBefore/.test(m.text())) warns.push(m.text()); });

    await page.addInitScript(() => {
        try {
            localStorage.setItem('agGuest_v1', JSON.stringify({ ts: Date.now() }));
            localStorage.setItem('agTutProSeen', '1');
            localStorage.setItem('agBrifinkAuto', '0');
            localStorage.setItem('agBrifinkLastShown', new Date().toISOString().slice(0, 10));
        } catch (e) { }
    });
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#welcome-start-btn')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2500);

    await expect(page.locator('#zpr-welcome-btn'), 'tlačítko Geo zpravodaj na úvodní obrazovce').toHaveCount(1);
    await expect(page.locator('#prd-welcome-btn'), 'tlačítko Předpisy & odchylky na úvodní obrazovce').toHaveCount(1);

    await page.locator('#welcome-start-btn').click();
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('app-started')), { timeout: 20000 }).toBe(true);
    await page.waitForTimeout(2500);
    await expect(page.locator('#btn-terrain'), '#btn-terrain vyrobený dmr-terrain.js').toHaveCount(1);
    await page.locator('#map-ctrl-toggle').click();
    await expect(page.locator('#ms-terrain'), 'řádek „Terén (DMR 5G)" v panelu Mapa a vrstvy').toBeVisible();

    expect(warns, 'insertBefore selhalo:\n' + warns.join('\n')).toEqual([]);
});

test('REGRESE: lazy nástroj s objektovým API (DGPS) appku nezamrzne', async ({ page, context }) => {
    // js/dgps.js se brání dvojímu načtení přes `if (window.AGDgps) return;`. Tam ale
    // ležel ZÁSTUPCE z js/lazy-tools.js, takže se modul rovnou ukončil a nic
    // nedefinoval; openTool pak vyresolvoval znovu tentýž stub a zavolal ho:
    //   stub -> load() (slib už splněný) -> stub -> …
    // Nekonečná smyčka v mikrotaskách = úplné zamrznutí appky (nereagovalo nic,
    // ani vykreslování). Test proto hlídá, že appka po otevření DGPS ODPOVÍDÁ.
    await bootApp(page, context);
    await page.evaluate(() => { const m = document.getElementById('tools-modal'); if (m) m.style.display = 'flex'; });
    await page.locator('#tools-modal .tool-tile[data-tool="dgps"]').click();

    // modál se dotáhne asynchronně (lazy load) — a hlavně: appka musí žít
    await expect(page.locator('#ag-dgps-modal')).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => 1 + 1), { timeout: 5000 }).toBe(2);
    await expect(page.locator('#ag-dgps-modal')).toContainText('Základna');

    // pojistka proti návratu smyčky: opener už NESMÍ být zástupce
    expect(await page.evaluate(() => !!(window.AGDgps && window.AGDgps.open && window.AGDgps.open._agLazyStub)),
        'AGDgps.open zůstal zástupcem z lazy-tools.js').toBe(false);
});

test('karta bodu: navigační pruh a akce', async ({ page, context }) => {
    await bootApp(page, context);

    // vlastní bod 30 m severně od podvržené polohy → karta se otevře přes showDetails
    const ok = await page.evaluate(() => {
        // POZOR: arPoints je v logika.js `let` na nejvyšší úrovni — tedy globální
        // lexikální binding, NE vlastnost window. Sahat na `window.arPoints` proto
        // vždy vrátilo undefined a celý test se tiše přeskakoval.
        if (typeof showDetails !== 'function' || typeof arPoints === 'undefined') return false;
        const pt = {
            id: 'test-bod-1', name: 'TEST-1', type: 'custom', cat: 'CUSTOM',
            lat: 50.0875 + 0.00027, lng: 14.4213, vyska: 200.5
        };
        arPoints.push(pt);
        showDetails(pt, 30);
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
