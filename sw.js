// AR Geodet — Service Worker (verze = SHELL_CACHE niz; TENTO komentar needituj)
// Strategie: vlastni kod = CACHE-FIRST (verzovano bumpem SHELL_CACHE + update banner),
//            index.html (navigace) = stale-while-revalidate (pojistka),
//            CDN/dlazdice = NEJDRIV CACHE.
// Instalace je ODOLNA: jeden nedostupny soubor neshodi prevzeti nove verze.
//
// DVE oddelene cache:
//   SHELL_CACHE — kod appky + knihovny z CDN. Verzuje se (bump pri vydani), pri aktivaci
//                 se stare verze maze => uzivatel po updatu dostane cerstvy kod.
//   TILE_CACHE  — mapove dlazdice ulozene tlacitkem "Ulozit pro Offline". STABILNI nazev,
//                 NEMAZE se pri updatu => update kodu nesmaze uzivateli stazene mapy.
const SHELL_CACHE = 'argeodet-shell-v174';   // integrace 6 (pocasi v173 + store-prep v172 + ucty v171 + audit v168)
const TILE_CACHE = 'argeodet-offline-v12'; // shodne s caches.open(...) v logika.js — nemenit
const KEEP_CACHES = [SHELL_CACHE, TILE_CACHE];

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    './css/style.css?v=173', // verze v adrese shodná s <link> v index.html — nemíchat se starou cache
    './css/vylepseni.css',
    './css/zpravodaj.css',
    './data/zpravodaj.json',
    './css/predpisy.css',
    './data/predpisy.json',
    './js/err-log.js',
    './js/geo-core.js',
    './js/logika.js',
    './js/grafika.js',
    './js/vytycovani.js',
    './js/satelity.js',
    './js/kalkulacka.js',
    './js/export.js',
    './js/kompas-check.js',
    './js/zaloha.js',
    './js/auto-zaloha.js',
    './js/undo.js',
    './js/kos.js',
    './js/zakazky.js',
    './js/pruvodce.js',
    './js/sdileni.js',
    './js/tachymetrie.js',
    './js/zpravodaj.js',
    './js/predpisy.js',
    './js/gnss-quality.js',
    './css/gnss-quality.css',
    './js/gps-warn.js',
    './css/gps-warn.css',
    './js/csv-validate.js',
    './js/kml-export.js',
    './js/dxf-export.js',
    './js/vfk.js',
    './js/compass-stability.js',
    './css/compass-stability.css',
    './js/calib-profiles.js',
    './css/calib-profiles.css',
    './js/ref-calibration.js',
    './css/ref-calibration.css',
    './js/sky-obstruction.js',
    './css/sky-obstruction.css',
    './js/cadastre-area.js',
    './css/cadastre-area.css',
    './js/ar-fusion.js',
    './js/theme-dark.js',
    './js/field-tools.js',
    './js/hidden-points.js',
    './js/vrstvy.js',
    './js/orient-point.js',
    './js/offset-point.js',
    './js/stakeout-line.js',
    './js/track-log.js',
    './js/linalg.js',
    './js/ar-resection.js',
    './js/ar-intersection.js',
    './js/rajon.js',
    './js/free-station.js',
    './js/journal.js',
    './js/localization-helmert.js',
    './js/job-transfer.js',
    './js/utility-networks.js',
    './js/photo-shot.js',
    './js/ar-visual-track.js',
    './js/rangefinder.js',
    './js/vyska-objektu.js',
    './js/epochy.js',
    './js/pocasi.js',
    './css/pocasi.css',
    './js/ar-calibrate.js',
    './js/ar-calib2.js',
    './css/ar-calibrate.css',
    './js/project-import.js',
    './js/cadastre-vector.js',
    './css/ar-fusion.css',
    './js/dmr-terrain.js',
    './css/dmr-terrain.css',
    './js/power-save.js',
    './css/power-save.css',
    './js/idle-timers.js',
    './js/parcela.js',
    './js/dmt-volume.js',
    './css/dmt-volume.css',
    './js/check-distance.js',
    './css/check-distance.css',
    './js/brutal-gps.js',
    './css/brutal-gps.css',
    './js/urovnani.js',
    './css/urovnani.css',
    './js/postupy.js',
    './js/zapisnik.js',
    './js/tools-plus.js',
    './js/qc-engine.js',
    './js/ucty.js',
    './js/ucty-admin.js',
    './css/qc-engine.css',
    './css/tools-polish.css',
    './js/tutorial-pro.js',
    './js/fullscreen.js',
    './js/view-cycle.js',
    './js/app-search.js',
    './js/pdf-protocol.js',
    './js/vylepseni.js',
    './js/welcome-card.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    './js/lib/proj4-2.9.0.min.js',
    './js/lib/leaflet-1.9.4.js',
    './js/lib/esri-leaflet-3.0.12.js',
    './js/lib/satellite-5.0.0.min.js',
    './js/lib/qrcode.min.js',
    './js/lib/jsqr.min.js'
];

// Mapove dlazdice (OSM, CUZK WMS) ukladame do TILE_CACHE, aby prezily update kodu.
function isTile(url) {
    return url.includes('tile.openstreetmap.org')
        || url.includes('cuzk.gov.cz/arcgis1')   // ortofoto WMS
        || url.includes('services.cuzk.cz/wms')   // katastr WMS
        || url.includes('services.cuzk.gov.cz/wms');
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        // Kazdy soubor zvlast — selhani jednoho nesmi zablokovat instalaci (a tim i aktualizaci).
        await Promise.allSettled(ASSETS_TO_CACHE.map(async url => {
            try {
                const res = await fetch(new Request(url, { cache: 'reload' }));
                if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
            } catch (e) { /* offline / blokovany CDN — preskocit, nevadi */ }
        }));
        // skipWaiting az na vyzadani z appky (po souhlasu uzivatele s obnovou)
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => !KEEP_CACHES.includes(key)).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', event => {
    const url = event.request.url;
    if (url.includes('cuzk.gov.cz/arcgis/rest')) return; // dotazy na bodova pole vzdy ze site
    if (url.includes('celestrak.org')) return; // drahy druzic (TLE) vzdy ze site — appka si je cachuje sama v localStorage
    if (url.includes('api.open-meteo.com') || url.includes('geocoding-api.open-meteo.com') || url.includes('api.met.no')) return; // pocasi vzdy ze site — posledni data si pocasi.js cachuje samo v localStorage

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
                    caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone));
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
                if (url.startsWith('http')) {
                    const targetCache = isTile(url) ? TILE_CACHE : SHELL_CACHE;
                    const responseClone = response.clone();
                    caches.open(targetCache).then(cache => cache.put(event.request, responseClone));
                }
                return response;
            }).catch(() => {});
        })
    );
});
