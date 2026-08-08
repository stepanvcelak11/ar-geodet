// AR Geodet â€” Service Worker (verze = SHELL_CACHE niz; TENTO komentar needituj)
// Strategie: vlastni kod = CACHE-FIRST (verzovano bumpem SHELL_CACHE + update banner),
//            index.html (navigace) = stale-while-revalidate (pojistka),
//            CDN/dlazdice = NEJDRIV CACHE.
// Instalace je ODOLNA: jeden nedostupny soubor neshodi prevzeti nove verze.
//
// DVE oddelene cache:
//   SHELL_CACHE â€” kod appky + knihovny z CDN. Verzuje se (bump pri vydani), pri aktivaci
//                 se stare verze maze => uzivatel po updatu dostane cerstvy kod.
//   TILE_CACHE  â€” mapove dlazdice ulozene tlacitkem "Ulozit pro Offline". STABILNI nazev,
//                 NEMAZE se pri updatu => update kodu nesmaze uzivateli stazene mapy.
const SHELL_CACHE = 'argeodet-shell-v220';   // Nastroje maji jediny pohled (seznam ukonu, sbalitelne skupiny), Vice uklizeno, rozlisene ikony
const TILE_CACHE = 'argeodet-offline-v12'; // shodne s caches.open(...) v logika.js — nemenit
// FONT_CACHE — vlastni pisma (fonts/*.woff2, ~209 kB). Pisma se NIKDY nemeni,
// takze by bylo plytvani stahovat je znovu pri kazdem bumpu verze. STABILNI nazev,
// nemaze se pri updatu (stejny princip jako TILE_CACHE u mapovych dlazdic).
const FONT_CACHE = 'argeodet-fonts-v1';
const KEEP_CACHES = [SHELL_CACHE, TILE_CACHE, FONT_CACHE];

const ASSETS_TO_CACHE = [
    // >>> GENEROVANO scripts/gen_sw_assets.py — needitovat rucne
    // (spust: python scripts/gen_sw_assets.py ; pri vydani --bump)
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    './apple-touch-icon.png',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-192.png',
    './icon-maskable-512.png',
    './css/fonts.css',
    './js/lib/leaflet-1.9.4.css',
    './css/tokens.css?v=220',
    './css/style.css?v=220',
    './css/vylepseni.css?v=220',
    './css/zpravodaj.css',
    './css/predpisy.css',
    './css/gnss-quality.css',
    './css/gps-warn.css',
    './css/compass-stability.css',
    './css/calib-profiles.css',
    './css/ref-calibration.css',
    './css/sky-obstruction.css',
    './css/cadastre-area.css',
    './css/ar-fusion.css',
    './css/ar-calibrate.css',
    './css/dmr-terrain.css',
    './css/power-save.css',
    './css/dmt-volume.css',
    './css/check-distance.css',
    './css/brutal-gps.css',
    './css/qc-engine.css',
    './css/pocasi.css',
    './css/tools-polish.css',
    './css/tokens-outdoor.css',
    './js/lib/proj4-2.9.0.min.js',
    './js/geo-core.js',
    './js/err-log.js',
    './js/dialog-bridge.js',
    './js/vstupy.js',
    './js/lib/leaflet-1.9.4.js',
    './js/power-save.js',
    './js/idle-timers.js',
    './js/logika.js',
    './js/grafika.js',
    './js/journal.js',
    './js/dmt-volume.js',
    './js/check-distance.js',
    './js/lib/satellite-5.0.0.min.js',
    './js/vytycovani.js',
    './js/cil-navigace.js',
    './js/satelity.js',
    './js/kalkulacka.js',
    './js/export.js',
    './js/kompas-check.js',
    './js/zaloha.js',
    './js/auto-zaloha.js',
    './js/undo.js',
    './js/kos.js',
    './js/zakazky.js',
    './js/zakazka-sablony.js',
    './js/pruvodce.js',
    './js/sdileni.js',
    './js/tachymetrie.js',
    './js/zpravodaj.js',
    './js/predpisy.js',
    './js/gnss-quality.js',
    './js/gps-warn.js',
    './js/gps-trust.js',
    './js/draft-store.js',
    './js/csv-validate.js',
    './js/kml-export.js',
    './js/dxf-export.js',
    './js/vfk.js',
    './js/compass-stability.js',
    './js/calib-profiles.js',
    './js/ref-calibration.js',
    './js/sky-obstruction.js',
    './js/cadastre-area.js',
    './js/ar-fusion.js',
    './js/ar-visual-track.js',
    './js/theme-dark.js',
    './js/dmr-terrain.js',
    './js/parcela.js',
    './js/field-tools.js',
    './js/lazy-tools.js',
    './js/hidden-points.js',
    './js/orient-point.js',
    './js/offset-point.js',
    './js/brutal-gps.js',
    './js/gps-campaign.js',
    './js/gps-semafor.js',
    './js/pdr-offset.js',
    './js/stakeout-line.js',
    './js/track-log.js',
    './js/fov-kalibrace.js',
    './js/tools-back.js',
    './js/modal-close.js',
    './js/lazy-load.js',
    './js/track-ar.js',
    './js/linalg.js',
    './js/ar-resection.js',
    './js/ar-intersection.js',
    './js/rajon.js',
    './js/free-station.js',
    './js/localization-helmert.js',
    './js/utility-networks.js',
    './js/job-transfer.js',
    './js/vyska-objektu.js',
    './js/epochy.js',
    './js/epochy-pripominky.js',
    './js/ar-calibrate.js',
    './js/ar-calib2.js',
    './js/project-import.js',
    './js/cadastre-vector.js',
    './js/tutorial-pro.js',
    './js/tools-plus.js',
    './js/tools-simple.js',
    './js/rezim-prace.js',
    './js/profily.js',
    './js/pokracovat.js',
    './js/shortcuts.js',
    './js/fullscreen.js',
    './js/view-cycle.js',
    './js/map-tools.js',
    './js/poloha-z-mapy.js',
    './js/app-search.js',
    './js/pdf-protocol.js',
    './js/vylepseni.js',
    './js/welcome-card.js',
    './js/qc-engine.js',
    './js/ucty.js',
    './js/ucty-admin.js',
    './js/dochazka.js',
    './js/firma-chat.js',
    './js/cloud-sync.js',
    './js/zavady.js',
    './js/brifink.js',
    './js/hlasovky.js',
    './js/hlas-kod.js',
    './js/geo-foto.js',
    './js/vysilacka.js',
    './js/indoor.js',
    './js/obchuzka.js',
    './js/slunce.js',
    './js/kde-je.js',
    './js/bezpecnost.js',
    './js/usadit-ar.js',
    './js/tools-hub.js',
    './js/stavovy-pruh.js',
    './js/upozorneni.js',
    './js/filtr-info.js',
    './js/nastroje-ukony.js',
    './js/moje-aktivita.js',
    './js/nastaveni-hledani.js',
    './js/nastaveni-poradek.js',
    './js/kompas-magneticky.js',
    './js/vyska-gps.js',
    './js/offline-sbal.js',
    './js/ucty-privacy.js',
    './js/map-rotate.js',
    './js/karta-bodu.js',
    './js/mini-panel.js',
    './data/zpravodaj.json',
    './data/predpisy.json',
    './js/lib/qrcode.min.js',
    './js/lib/jsqr.min.js',
    './fonts/inter-var-latin.woff2',
    './fonts/inter-var-latin-ext.woff2',
    './fonts/jetbrains-mono-var-latin.woff2',
    './fonts/jetbrains-mono-var-latin-ext.woff2',
    './fonts/sora-var-latin.woff2',
    './fonts/sora-var-latin-ext.woff2',
    './js/lib/images/layers.png',
    './js/lib/images/layers-2x.png',
    './js/lib/images/marker-icon.png',
    './js/pocasi.js',
    './js/zapisnik.js',
    './js/dgps.js',
    './js/vrstvy.js',
    './js/kontrola-vrstvy.js',
    './js/denik-dne.js',
    './js/kniha-jizd.js',
    './js/postupy.js',
    './js/gnss-forecast.js',
    './js/korekce.js',
    './js/checklist.js',
    // <<< KONEC GENEROVANEHO SEZNAMU
];

// Vlastni pisma ukladame do FONT_CACHE, aby prezila update kodu (viz vyse).
// POZOR: pisma appky lezi v /fonts/ (variabilni rezy), ne v /css/fonts/. Kdyz se
// tady testovala jen stara cesta, do stabilni FONT_CACHE nespadlo NIC a vsech
// 209 kB pisem se stahovalo znovu pri KAZDEM bumpu SHELL_CACHE — presne to, cemu
// mela FONT_CACHE zabranit. Obe cesty tu nechavame kvuli starym instalacim.
function isFont(url) { return url.includes('/fonts/') || url.endsWith('.woff2'); }

// Mapove dlazdice (OSM, CUZK WMS) ukladame do TILE_CACHE, aby prezily update kodu.
function isTile(url) {
    return url.includes('tile.openstreetmap.org')
        || url.includes('cuzk.gov.cz/arcgis1')   // ortofoto WMS
        || url.includes('services.cuzk.cz/wms')   // katastr WMS
        || url.includes('services.cuzk.gov.cz/wms');
}

// Predchozi verze shellu (argeodet-shell-v211 pri instalaci v212). Slouzi jako
// ZALOHA pri instalaci: kdyz nejde sit, vezmeme starou kopii souboru misto zadne.
async function previousShellCaches() {
    try {
        const keys = await caches.keys();
        return keys.filter(k => k.indexOf('argeodet-shell-') === 0 && k !== SHELL_CACHE);
    } catch (e) { return []; }
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        const fontCache = await caches.open(FONT_CACHE);
        // Kazdy soubor zvlast â€” selhani jednoho nesmi zablokovat instalaci (a tim i aktualizaci).
        await Promise.allSettled(ASSETS_TO_CACHE.map(async url => {
            // PISMA: uz je mame z minule verze? Necha se to tak — jsou to ~900 kB, ktere
            // se nemeni, a stahovat je znovu pri kazdem bumpu verze by byla skoda dat.
            const font = isFont(url);
            const target = font ? fontCache : cache;
            if (font && await target.match(url)) return;
            try {
                const res = await fetch(new Request(url, { cache: 'reload' }));
                if (res && (res.ok || res.type === 'opaque')) await target.put(url, res);
            } catch (e) { /* offline / blokovany CDN â€” preskocit, nevadi */ }
        }));
        // skipWaiting az na vyzadani z appky (po souhlasu uzivatele s obnovou)
    })());
});

// Jednorazovy uklid vadnych dlazdic: driv se do TILE_CACHE ulozila i chybova odpoved
// (404/429 od dlazdicoveho serveru) a cache-first ji pak vracel navzdy => v mape zustala
// trvala dira. Mazou se JEN odpovedi se stavem >= 400; opaque (status 0) a 200 zustavaji,
// takze uzivateli nezmizi mapy stazene pro offline.
async function purgeBadTiles() {
    try {
        const cache = await caches.open(TILE_CACHE);
        const reqs = await cache.keys();
        for (const req of reqs) {
            const res = await cache.match(req);
            if (res && res.status >= 400) await cache.delete(req);
        }
    } catch (e) { /* uklid je nepovinny */ }
}

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => !KEEP_CACHES.includes(key)).map(key => caches.delete(key))))
            .then(purgeBadTiles)
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', event => {
    const url = event.request.url;
    if (url.includes('cuzk.gov.cz/arcgis/rest')) return; // dotazy na bodova pole vzdy ze site
    if (url.includes('celestrak.org')) return; // drahy druzic (TLE) vzdy ze site â€” appka si je cachuje sama v localStorage
    if (url.includes('api.open-meteo.com') || url.includes('geocoding-api.open-meteo.com') || url.includes('api.met.no')
        || url.includes('api.brightsky.dev') || url.includes('api.rainviewer.com') || url.includes('rainviewer.com/v2')
        || url.includes('tilecache.rainviewer.com')) return; // pocasi + srazkovy radar vzdy ze site â€” posledni data si pocasi.js cachuje samo v localStorage

    // Vlastni kod aplikace (stejny puvod): CACHE-FIRST. Cerstvy kod se k uzivateli
    // dostava JEN pres bump verze SW (install znovu stahne ASSETS_TO_CACHE ->
    // update banner -> SKIP_WAITING -> reload). Driv tu byl stale-while-revalidate
    // na KAZDY soubor: v terenu zbytecne stahoval JS znovu a znovu a per-file
    // revalidace umela namichat nekompatibilni verze (index v141 + logika v140).
    // Vyjimka: NAVIGACE (index.html) zustava SWR jako pojistka, kdyby se pri
    // vydani zapomnel bumpnout SHELL_CACHE.
    if (url.startsWith(self.location.origin)) {
        const isNav = event.request.mode === 'navigate' || url === self.location.origin + '/' || url.endsWith('/index.html');
        if (isNav) {
            event.respondWith(
                caches.match(event.request).then(cached => {
                    const network = fetch(event.request).then(response => {
                        if (response && response.ok) {
                            const clone = response.clone();
                            caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone));
                        }
                        return response;
                    }).catch(() => cached);
                    return cached || network;
                })
            );
            return;
        }
        event.respondWith(
            caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
                if (response && response.ok) {
                    const clone = response.clone();
                    // pisma do vlastni (neverzovane) cache, at prezijou update kodu
                    caches.open(isFont(url) ? FONT_CACHE : SHELL_CACHE).then(cache => cache.put(event.request, clone));
                }
                return response;
            }))
        );
        return;
    }

    // Knihovny z CDN, fonty a dlazdice map: NEJDRIV CACHE (rychle, setri data, funguje offline).
    // caches.match() prohledava obe cache, takze najde i offline ulozene dlazdice.
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            return fetch(event.request).then(response => {
                // Ulozit JEN povedenou odpoved. Driv se cachovalo cokoli vcetne 404/429
                // od dlazdicoveho serveru => takova dira v mape uz zustala navzdy,
                // protoze cache-first ji dal vracel misto noveho pokusu.
                const okToCache = response && (response.ok || response.type === 'opaque');
                if (url.startsWith('http') && okToCache) {
                    const targetCache = isTile(url) ? TILE_CACHE : (isFont(url) ? FONT_CACHE : SHELL_CACHE);
                    const responseClone = response.clone();
                    caches.open(targetCache).then(cache => cache.put(event.request, responseClone));
                }
                return response;
            }).catch(() => {});
        })
    );
});
