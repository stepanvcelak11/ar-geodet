// AR Geodet — Service Worker (v88)
// Strategie: vlastni kod = NEJDRIV SIT (vzdy cerstvy), CDN/dlazdice = NEJDRIV CACHE.
// Instalace je ODOLNA: jeden nedostupny soubor neshodi prevzeti nove verze.
//
// DVE oddelene cache:
//   SHELL_CACHE — kod appky + knihovny z CDN. Verzuje se (bump pri vydani), pri aktivaci
//                 se stare verze maze => uzivatel po updatu dostane cerstvy kod.
//   TILE_CACHE  — mapove dlazdice ulozene tlacitkem "Ulozit pro Offline". STABILNI nazev,
//                 NEMAZE se pri updatu => update kodu nesmaze uzivateli stazene mapy.
const SHELL_CACHE = 'argeodet-shell-v88';
const TILE_CACHE = 'argeodet-offline-v12'; // shodne s caches.open(...) v logika.js — nemenit
const KEEP_CACHES = [SHELL_CACHE, TILE_CACHE];

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    './css/style.css',
    './css/vylepseni.css',
    './css/zpravodaj.css',
    './data/zpravodaj.json',
    './css/predpisy.css',
    './data/predpisy.json',
    './js/logika.js',
    './js/grafika.js',
    './js/vytycovani.js',
    './js/satelity.js',
    './js/kalkulacka.js',
    './js/export.js',
    './js/kompas-check.js',
    './js/zaloha.js',
    './js/undo.js',
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
    './js/ar-stabilize.js',
    './js/theme-dark.js',
    './js/field-tools.js',
    './js/orient-point.js',
    './js/offset-point.js',
    './js/stakeout-line.js',
    './js/track-log.js',
    './js/ar-resection.js',
    './js/project-import.js',
    './js/cadastre-vector.js',
    './css/ar-stabilize.css',
    './js/dmr-terrain.js',
    './css/dmr-terrain.css',
    './js/power-save.js',
    './css/power-save.css',
    './js/parcela.js',
    './js/dmt-volume.js',
    './css/dmt-volume.css',
    './js/check-distance.js',
    './css/check-distance.css',
    './js/tutorial-pro.js',
    './js/vylepseni.js',
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

    // Vlastni kod aplikace (stejny puvod): NEJDRIV SIT — aby byl vzdy cerstvy.
    // Pri vypadku site se pouzije cache (offline rezim funguje dal).
    if (url.startsWith(self.location.origin)) {
        event.respondWith(
            fetch(event.request).then(response => {
                const clone = response.clone();
                caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone));
                return response;
            }).catch(() => caches.match(event.request))
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
