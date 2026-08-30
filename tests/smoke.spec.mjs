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
        // Značka „odložené moduly jsou dotažené". Většina nástrojů se načítá až po
        // vykreslení (js/lazy-load.js) a test, který na to nepočká, hlásí náhodně
        // „chybí dlaždice" nebo „funkce není". Posluchač MUSÍ být z init skriptu —
        // událost přijde dřív, než se test stihne zeptat. Init skript běží při
        // KAŽDÉ navigaci, takže značka platí i po reloadu appky.
        window.__agLazyDone = false;
        window.addEventListener('ag:lazy-done', () => { window.__agLazyDone = true; });
    });

    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

    // kompas: bez podvrženého azimutu se AR smyčka vůbec nerozjede
    const cdp = await context.newCDPSession(page);
    await cdp.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 120, beta: 80, gamma: 2 });

    const start = page.locator('#welcome-start-btn');
    await expect(start).toBeVisible({ timeout: 20000 });
    await start.click();
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('app-started')), { timeout: 20000 }).toBe(true);

    // Dotáhni odložené moduly HNED a počkej, až budou venku. Dřív tu byla jen
    // pevná pauza 4 s a test si zahrával s náhodou: kolik nástrojů se do té doby
    // stihlo zaregistrovat, takový byl výsledek. Na zatíženém runneru to je jinak
    // než na vývojářském stroji a přibývající moduly to posouvají.
    await page.evaluate(() => { try { window.AGLazy && window.AGLazy.flush && window.AGLazy.flush(); } catch (e) { } });
    await page.waitForFunction(() => {
        if (window.__agLazyDone === true) return true;
        // pojistka: kdyby vrstva js/lazy-load.js zmizela ze sestavy, událost by
        // nikdy nepřišla a test by umřel na timeout místo toho, aby prošel
        return document.querySelectorAll('script[type="ag/lazy"][data-src]').length === 0;
    }, null, { timeout: 40000 });

    // …a teprve pak nech chvíli běžet smyčky modulů (bublina, mapa, HUD) — chyby
    // se často objeví až v prvním intervalu, ne při načtení. Dlaždice se navíc
    // doregistrovávají vlastními tiky modulů (1,2–1,7 s).
    await page.waitForTimeout(3000);

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
    // Mez je 60, ne 25: appka jich má přes 80 a chyba, kvůli které se jich
    // registrovala jen ČÁST (43 ze 70 při self-reloadu), by pod hranicí 25 prošla.
    // Na to, že se počkalo na dotažení odložených modulů, je teď spoleh.
    const tiles = await page.locator('#tools-modal .tool-tile').count();
    expect(tiles, 'počet dlaždic v Nástrojích').toBeGreaterThan(60);

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

    // Tlačítko „Sbalit" se 29. 8. 2026 z pilulky v hlavičce (.ag-mini-btn) změnilo
    // na kulaté vedle křížku (.ag-mini-fab) — viz js/mini-panel.js. Test na starou
    // třídu padal a s ním celý workflow včetně nasazení na Pages, přestože appka
    // byla v pořádku. Bereme obě jména, ať přejmenování shodí test až tehdy, když
    // tlačítko opravdu zmizí.
    const collapse = modal.locator('.ag-mini-fab, .ag-mini-btn');
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

    // POZOR — proč NE klepnutí na dlaždici (kvůli tomu byl tenhle test od zavedení
    // červený a s ním celý workflow, včetně nasazení na Pages):
    // bootApp přeskakuje přihlašovací bránu režimem HOST (agGuest_v1). Host má ale
    // omezená oprávnění a js/ucty.js je vymáhá SKRÝVÁNÍM dlaždic — dlaždici označí
    // `data-agucty="1"` a nastaví jí display:none (ucty.js, applyPerms). Dělá to
    // v ticku, takže i kdyby ji hledání odkrylo, hned se zase schová. V režimu
    // host je tak skrytá zhruba třetina mřížky včetně DGPS, takže `.click()` na ni
    // neměl šanci a skončil vypršením. Není to vada appky: host na DGPS prostě nemá.
    //
    // Otevíráme proto stejným globálem, na který ukazuje i dlaždice
    // (js/lazy-tools.js, `open: 'AGDgps.open'`). Regrese se tím testuje beze změny:
    // window.AGDgps.open je před načtením ZÁSTUPCE (_agLazyStub) a právě jeho
    // zavolání dřív roztočilo nekonečnou smyčku.
    expect(await page.evaluate(() => !!(window.AGDgps && window.AGDgps.open && window.AGDgps.open._agLazyStub)),
        'AGDgps.open měl být před otevřením zástupce z lazy-tools.js — jinak tenhle test netestuje nic').toBe(true);
    await page.evaluate(() => window.AGDgps.open());

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

// ================================================================================
//  STAVOVA BUBLINA: JEDEN RADEK PRES CELOU SIRKU
// ================================================================================
// Silueta presnosti (panacek s kruhem) stala vlevo nahore od 29. do 30. 8. 2026 a
// bublina se o ni odsouvala doprava — text se tim mackal do dvou radku. Uzivatel ji
// zrusil („za tu cenu to neni treba"). Tenhle test hlida, ze se odsazeni nevrati:
// bublina musi byt vystredena a jeji hlaska na JEDNOM radku.
test('stavova bublina: vystredena pres celou sirku, hlaska na jednom radku', async ({ page, context }) => {
    await context.setGeolocation({ ...PRAHA, accuracy: 2 });
    const errors = await bootApp(page, context);

    const sp = page.locator('#ag-sp');
    await expect(sp).toBeVisible();

    const m = await page.evaluate(() => {
        const el = document.getElementById('ag-sp');
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const a = el.querySelector('.ag-sp-alert');
        return {
            stred: Math.abs((r.left + r.right) / 2 - innerWidth / 2),
            maxW: cs.maxWidth,
            sirkaOkna: innerWidth,
            zalomeni: a ? getComputedStyle(a).whiteSpace : 'nowrap',
            silueta: !!document.getElementById('ag-sil'),
        };
    });

    // panacek uz v appce nesmi byt
    expect(m.silueta).toBe(false);
    // bublina stoji ve stredu obrazovky (odchylka do 2 px kvuli zaokrouhleni)
    expect(m.stred).toBeLessThan(2);
    // ma k dispozici celou sirku (94vw), ne 94vw minus silueta
    expect(parseFloat(m.maxW)).toBeGreaterThan(m.sirkaOkna * 0.9);
    // hlaska se neláme na dva radky
    expect(m.zalomeni).toBe('nowrap');

    expect(errors, errors.join('\n')).toEqual([]);
});

// ================================================================================
//  REGRESE: posluchači se při zavření okna odhlásí
// ================================================================================
// Měřeno 29. 8. 2026: appka ŽÁDNÝ podstatný únik nemá (10 otevření a zavření všech
// nástrojů přidalo 7 posluchačů celkem, což je jednorázová inicializace). Poměr
// 1139 addEventListener : 27 removeEventListener ve zdrojácích klame — drtivá
// většina se navěsí JEDNOU při startu. Tenhle test to drží: kdyby někdo příště
// zapsal posluchač do open() bez odhlášení v close(), počet poroste lineárně.
test('REGRESE: opakované otevření okna nehromadí posluchače', async ({ page, context }) => {
    await page.addInitScript(() => {
        const T = new Map();
        const kam = (o) => (o === window ? 'window' : o === document ? 'document'
            : o === document.body ? 'body' : null);
        const obal = (jmeno, delta) => {
            const orig = EventTarget.prototype[jmeno];
            EventTarget.prototype[jmeno] = function (typ) {
                const k = kam(this);
                if (k) T.set(k + ':' + typ, (T.get(k + ':' + typ) || 0) + delta);
                return orig.apply(this, arguments);
            };
        };
        obal('addEventListener', 1);
        obal('removeEventListener', -1);
        window.__posluchacu = () => { let s = 0; for (const v of T.values()) if (v > 0) s += v; return s; };
    });

    const errors = await bootApp(page, context);

    // Protokol kvality je vlastní okno tohohle projektu a zavírá se přes AG.scope —
    // na něm se dá únik změřit spolehlivě a bez klikání do cizích modálů.
    await expect.poll(() => page.evaluate(() => typeof window.agOpenKvalitaBodu),
        { timeout: 15000 }).toBe('function');

    const pred = await page.evaluate(() => {
        window.agOpenKvalitaBodu(); window.AGKvalita.close();   // první otevření = jednorázová stavba okna
        return window.__posluchacu();
    });
    const po = await page.evaluate(() => {
        for (let i = 0; i < 15; i++) { window.agOpenKvalitaBodu(); window.AGKvalita.close(); }
        return window.__posluchacu();
    });

    expect(po - pred, `po 15 otevřeních a zavřeních přibylo ${po - pred} posluchačů — okno je neodhlašuje`).toBe(0);
    expect(errors, errors.join('\n')).toEqual([]);
});

// ================================================================================
//  REGRESE: přihlášení se nesmí zaseknout napořád
// ================================================================================
// Nahlášeno z terénu 29. 8. 2026: „zadávám správné heslo a hned mě to vykopne, že
// je moc pokusů." Byly to DVĚ vady, které se navzájem krmily:
//   1) klient počítal jako „špatné heslo" KAŽDOU odpověď serveru, tedy i 429
//      („moc pokusů") — jeden zámek na serveru tak přidával chyby i v telefonu,
//   2) počitadlo v localStorage se NIKDY nesnižovalo a mazal ho jen ÚSPĚŠNÝ
//      přihlášení. Kdo se dostal přes 9 chyb, dostával od té chvíle 15minutový
//      zámek po každém dalším nezdaru — a k úspěchu se nemohl dostat, protože
//      appka odmítla i správné heslo dřív, než se zeptala serveru.
const FIRMA_TEST = {
    enabled: true, cloud: true, api: 'https://api.test.invalid',
    code: 'TESTFIRMA', name: 'Testovaci',
    users: [{ id: 'u1', name: 'Stepan', role: 'vedeni' }],
};

async function bootLogin(page, context, failZaznam, odpoved) {
    await page.addInitScript(([f, z]) => {
        try {
            localStorage.setItem('agFirma_v1', JSON.stringify(f));
            localStorage.setItem('agTutProSeen', '1');
            localStorage.setItem('agBrifinkAuto', '0');
            if (z === null) localStorage.removeItem('agLoginFail_v1');
            else localStorage.setItem('agLoginFail_v1', JSON.stringify(z));
        } catch (e) { }
    }, [FIRMA_TEST, failZaznam]);

    let dotazu = 0;
    if (odpoved) {
        await context.route(/^https:\/\/api\.test\.invalid\/.*/, (route) => {
            dotazu++;
            route.fulfill({
                status: odpoved.status, contentType: 'application/json',
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: odpoved.error }),
            });
        });
    }
    await page.goto('/index.html', { waitUntil: 'load' });
    await expect(page.locator('#ag-login')).toBeAttached({ timeout: 20000 });
    await page.waitForTimeout(1500);
    return () => dotazu;
}

const stavPrihlaseni = (page) => page.evaluate(() => {
    const btn = document.querySelector('#ag-login .agl-pinbox .agl-btn');
    return {
        tlacitko: (btn?.textContent || '').trim(),
        zamceno: !!btn?.disabled,
        pocitadlo: localStorage.getItem('agLoginFail_v1'),
        hlaska: (document.querySelector('#ag-login .agl-err')?.textContent || '').trim(),
    };
});

test('REGRESE: zaseklé počitadlo pokusů se odpustí (jinak se nedá přihlásit vůbec)', async ({ page, context }) => {
    // přesně ten zaseknutý záznam z verze před opravou: velké n, zámek do budoucna,
    // a hlavně BEZ `ts` — nemáme podle čeho soudit stáří, takže se musí zahodit
    await bootLogin(page, context, { n: 12, until: Date.now() + 900000 });
    const s = await stavPrihlaseni(page);
    expect(s.zamceno, 'staré počitadlo drží uživatele zamčeného napořád').toBe(false);
    expect(s.tlacitko).toBe('Přihlásit');
    expect(s.pocitadlo).toBe(null);
});

test('REGRESE: čerstvý zámek platí dál (brzda proti hádání hesla nesmí zmizet)', async ({ page, context }) => {
    await bootLogin(page, context, { n: 7, until: Date.now() + 300000, ts: Date.now() });
    const s = await stavPrihlaseni(page);
    expect(s.zamceno, 'brzda proti hádání hesla přestala fungovat').toBe(true);
    expect(s.tlacitko).toBe('Zamčeno');
    expect(s.hlaska).toContain('Příliš mnoho pokusů');
});

test('REGRESE: 429 ze serveru se NEpočítá jako špatné heslo, 401 ano', async ({ page, context }) => {
    // 429 = brzda na serveru. Počítat ji jako uhádnutí hesla znamenalo, že se obě
    // brzdy sčítaly, až se přihlášení zaseklo úplně.
    const dotazu429 = await bootLogin(page, context, null,
        { status: 429, error: 'Příliš mnoho pokusů. Zkus to za 15 minut.' });
    await page.evaluate(() => {
        for (let i = 0; i < 3; i++) {
            document.querySelector('#ag-login .agl-user')?.click();
            const p = document.querySelector('#ag-login input.agl-pin'); if (p) p.value = 'spravneheslo';
            document.querySelector('#ag-login .agl-pinbox .agl-btn')?.click();
        }
    });
    await page.waitForTimeout(2500);
    expect(dotazu429(), 'dotazy vůbec nedošly na (podvržený) server').toBeGreaterThan(0);
    const po429 = await stavPrihlaseni(page);
    expect(po429.pocitadlo, 'brzda serveru přidala chybu i do telefonu — přesně to zaseklo přihlášení').toBe(null);
});

test('REGRESE: 401 (opravdu špatné heslo) se počítat MUSÍ', async ({ page, context }) => {
    await bootLogin(page, context, null, { status: 401, error: 'Nesprávné jméno nebo heslo.' });
    await page.evaluate(() => {
        for (let i = 0; i < 3; i++) {
            document.querySelector('#ag-login .agl-user')?.click();
            const p = document.querySelector('#ag-login input.agl-pin'); if (p) p.value = 'spatneheslo';
            document.querySelector('#ag-login .agl-pinbox .agl-btn')?.click();
        }
    });
    await page.waitForTimeout(2500);
    const s = await stavPrihlaseni(page);
    expect(s.pocitadlo, 'špatné heslo se přestalo počítat — PIN by šlo uhádnout hrubou silou').not.toBe(null);
    expect(JSON.parse(s.pocitadlo).n).toBeGreaterThan(0);
});

// ===== DEN V TERÉNU (dlouhý průchod appkou) =====================================
// Ostatní testy zkoušejí appku po kouskách: nastartuje, otevře se okno, spočítá se
// číslo. Chyby, které lidi z terénu hlásí nejčastěji, ale nejsou v jednom kroku —
// jsou ve ŠVU mezi kroky: bod se uloží, ale nepřežije zabití appky; odškrtnutí
// zůstane, ale ztratí se, kde jsi doopravdy stál; po restartu se dotáhne jen část
// nástrojů. Tenhle test projde celý den najednou a přes restart.
//
// Krok „RESTART" je tu jádro věci: iOS Safari běžně zabije PWA při přepnutí na
// foťák nebo při telefonátu. Co restart nepřežije, je v terénu ztracená práce.
test('den v terénu: bod → vytyčení → restart appky → nic se neztratilo', async ({ page, context }) => {
    const errors = await bootApp(page, context);

    // ---- 1) nový bod přes SKUTEČNÝ formulář (ne přes API) --------------------
    await page.evaluate(() => openNewPointModal());
    await expect(page.locator('#custom-modal-overlay')).toBeVisible({ timeout: 8000 });

    // 5 m severně od podvržené polohy; do polí jdou S-JTSK metry s desetinnou ČÁRKOU
    const yx = await page.evaluate(() => {
        const s = proj4('EPSG:4326', 'EPSG:5514', [14.4213, 50.0875 + 5 / 111320]);
        return { y: Math.abs(s[0]).toFixed(2).replace('.', ','), x: Math.abs(s[1]).toFixed(2).replace('.', ',') };
    });
    await page.fill('#custom-name', 'DEN1');
    await page.fill('#custom-y', yx.y);
    await page.fill('#custom-x', yx.x);
    await page.fill('#custom-z', '312,45');
    await page.click('#custom-modal-overlay .btn-primary');

    await expect.poll(() => page.evaluate(
        () => persistentCustomPoints.some((p) => p.name === 'DEN1')), { timeout: 8000 }).toBe(true);

    const bod = await page.evaluate(() => {
        const p = persistentCustomPoints.find((q) => q.name === 'DEN1');
        return { vyska: p.vyska, vAr: arPoints.some((q) => q.name === 'DEN1') };
    });
    expect(bod.vyska, 'výška Z se neuložila').toBe(312.45);
    expect(bod.vAr, 'bod se neobjevil v zobrazení (arPoints)').toBe(true);

    // ---- 2) vytyčení: odškrtnutí musí zapsat i SKUTEČNOU polohu --------------
    // Bez ní je „protokol vytyčení" jen soupis toho, co se mělo vytyčit
    // (js/protokol-vytyceni.js).
    const vytyceni = await page.evaluate(() => {
        const p = arPoints.find((q) => q.name === 'DEN1');
        toggleStaked(p);
        const rec = stakeoutData[p.id];
        const r = (window.AGProtVyt ? AGProtVyt.radky() : []).find((x) => x.name === 'DEN1');
        return { odskrtnuto: !!rec, poloha: !!(rec && rec.sy), vProtokolu: !!r, dp: r && r.dp != null ? r.dp : null };
    });
    expect(vytyceni.odskrtnuto, 'bod se neodškrtl').toBe(true);
    expect(vytyceni.poloha, 'k odškrtnutí se nezapsala skutečná poloha').toBe(true);
    expect(vytyceni.vProtokolu, 'bod není v protokolu vytyčení').toBe(true);
    // bod je 5 m od podvržené polohy telefonu → odchylka musí vyjít kolem 5 m
    expect(vytyceni.dp).toBeGreaterThan(3);
    expect(vytyceni.dp).toBeLessThan(8);

    // ---- 3) rozdělaná práce (js/draft-store.js) ------------------------------
    await page.evaluate(() => {
        AGDraft.register('test-den', { label: 'Zkouška', open: () => { } });
        AGDraft.save('test-den', { krok: 2 }, 'Zkouška');
    });
    await page.waitForTimeout(900);      // AGDraft má debounce 400 ms

    // ---- 4) RESTART APPKY ----------------------------------------------------
    // POZOR: podvržený kompas (CDP) přežije reload sám; druhý override skončí
    // chybou „sensor type is already overridden", proto se neposílá znovu.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const start2 = page.locator('#welcome-start-btn');
    await expect(start2).toBeVisible({ timeout: 20000 });
    await start2.click();
    await expect.poll(() => page.evaluate(
        () => document.body.classList.contains('app-started')), { timeout: 20000 }).toBe(true);
    await page.evaluate(() => { try { window.AGLazy && window.AGLazy.flush && window.AGLazy.flush(); } catch (e) { } });
    await page.waitForFunction(() => {
        if (window.__agLazyDone === true) return true;
        // pojistka: kdyby vrstva js/lazy-load.js zmizela ze sestavy, událost by
        // nikdy nepřišla a test by umřel na timeout místo toho, aby prošel
        return document.querySelectorAll('script[type="ag/lazy"][data-src]').length === 0;
    }, null, { timeout: 40000 });
    await page.waitForTimeout(2000);

    // ---- 5) co všechno restart přežilo --------------------------------------
    const po = await page.evaluate(() => {
        const p = persistentCustomPoints.find((q) => q.name === 'DEN1');
        const ar = arPoints.find((q) => q.name === 'DEN1');
        const rec = ar ? stakeoutData[ar.id] : null;
        const d = window.AGDraft ? AGDraft.load('test-den') : null;
        const r = (window.AGProtVyt ? AGProtVyt.radky() : []).find((x) => x.name === 'DEN1');
        return {
            bod: !!p, vyska: p ? p.vyska : null,
            odskrtnuto: !!rec, poloha: !!(rec && rec.sy),
            draft: d ? d.state.krok : null,
            protokol: !!r,
            dlazdic: document.querySelectorAll('#tools-modal .tool-tile').length,
        };
    });
    expect(po.bod, 'bod nepřežil restart appky').toBe(true);
    expect(po.vyska, 'výška se restartem ztratila').toBe(312.45);
    expect(po.odskrtnuto, 'odškrtnutí vytyčení nepřežilo restart').toBe(true);
    expect(po.poloha, 'skutečná poloha u odškrtnutí nepřežila restart').toBe(true);
    expect(po.draft, 'rozdělaná práce se po restartu nenabídla').toBe(2);
    expect(po.protokol, 'protokol vytyčení po restartu bod nevidí').toBe(true);
    expect(po.dlazdic, 'po restartu se zaregistrovala jen část nástrojů').toBeGreaterThan(60);

    expect(errors, 'chyby v konzoli:\n' + errors.join('\n')).toEqual([]);
});
