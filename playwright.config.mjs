// Konfigurace smoke testů (tests/*.spec.mjs). Appka je statická, takže si test
// pustí obyčejný HTTP server nad korenem repa (file:// by neprošlo kvůli
// service workeru a modulům).
import { defineConfig, devices } from '@playwright/test';

const PORT = 8099;

export default defineConfig({
    testDir: './tests',
    timeout: 90000,
    expect: { timeout: 15000 },
    fullyParallel: false,          // appka sahá na localStorage a jeden port
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
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
        command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    },
});
