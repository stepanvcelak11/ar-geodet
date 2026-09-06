// Konfigurace smoke testů (tests/*.spec.mjs). Appka je statická, takže si test
// pustí HTTP server nad kořenem repa (file:// by neprošlo kvůli service workeru
// a modulům).
//
// POZOR na server: dřív tu bylo `python3 -m http.server`, které jede v HTTP/1.0
// BEZ keep-alive. Appka si při startu tahne ~145 assetů, takže to znamenalo 145
// samostatných TCP spojení — na CI runneru se část resetla, prohlížeč nenačetl
// náhodný skript a test padal na „filters is not defined" / „map.on is not a
// function". Vypadalo to jako chyba appky, ale byla to chyba serveru; proto
// smoke test neprošel ani jednou od zavedení. scripts/test_server.py drží
// HTTP/1.1 s keep-alive — s ním appka startuje s 0 chybami v konzoli.
import { defineConfig, devices } from '@playwright/test';

const PORT = 8099;

export default defineConfig({
    testDir: './tests',
    timeout: 90000,
    expect: { timeout: 15000 },
    fullyParallel: false,          // appka sahá na localStorage a jeden port
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    // ⚠⚠ REPORTER 'github' JE TU KVŮLI DIAGNOSTICE, NE KVŮLI KRÁSE. Logy běhů
    //   Actions jsou pro nepřihlášeného nedostupné (HTTP 403), takže když smoke
    //   test spadne jen na CI, není JAK zjistit proč — a hádání stálo 6. 9. 2026
    //   několik kol nasazení naprázdno. Tenhle reportér vypisuje chyby jako
    //   ::error:: anotace, a ty se u veřejného repozitáře dají přečíst přes API
    //   (check-runs → annotations) i bez přístupu k logům. Pár řádků navíc ve
    //   výpisu je za tu možnost levná cena.
    reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        locale: 'cs-CZ',
        timezoneId: 'Europe/Prague',
        // telefon, ne desktop — appka je postavená na mobilní layout
        ...devices['Pixel 7'],
        isMobile: true,
        hasTouch: true,
        permissions: ['geolocation'],
        geolocation: { latitude: 50.0875, longitude: 14.4213 },
        // service worker v testu jen šumí (cachuje, hlásí chyby u nedostupných CDN);
        // konzistenci jeho seznamu assetů kontroluje scripts/gen_sw_assets.py --check
        serviceWorkers: 'block',
        screenshot: 'only-on-failure',
        video: 'off',
        trace: process.env.CI ? 'retain-on-failure' : 'off',
        launchOptions: {
            args: [
                // AR potřebuje kameru — Chromium dodá testovací obraz sám
                '--use-fake-device-for-media-stream',
                '--use-fake-ui-for-media-stream',
                '--autoplay-policy=no-user-gesture-required',
            ],
        },
    },
    projects: [{ name: 'chromium-mobil', use: { ...devices['Pixel 7'] } }],
    webServer: {
        // NE `python3 -m http.server` — viz komentář nahoře (HTTP/1.0 bez keep-alive
        // = náhodně nenačtené skripty = falešně červený test).
        command: `python3 scripts/test_server.py ${PORT}`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    },
});
