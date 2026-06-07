// AR Geodet — Service Worker (v15)
// Strategie: vlastni kod = NEJDRIV SIT (vzdy cerstvy), CDN/dlazdice = NEJDRIV CACHE.
// Instalace je ODOLNA: jeden nedostupny soubor neshodi prevzeti nove verze.
const CACHE_NAME = 'argeodet-offline-v12'; // shodne s ulozenim pro offline (logika.js) — nemenit
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    './css/style.css',
    './js/logika.js',
    './js/grafika.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.9.0/proj4.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/esri-leaflet@3.0.12/dist/esri-leaflet.js'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // Kazdy soubor zvlast — selhani jednoho nesmi zablokovat instalaci (a tim i aktualizaci).
        await Promise.allSettled(ASSETS_TO_CACHE.map(async url => {
            try {
                const res = await fetch(new Request(url, { cache: 'reload' }));
                if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
            } catch (e) { /* offline / blokovany CDN — preskocit, nevadi */ }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const url = event.request.url;
    if (url.includes('cuzk.gov.cz/arcgis/rest')) return;

    // Vlastni kod aplikace (stejny puvod): NEJDRIV SIT — aby byl vzdy cerstvy.
    // Pri vypadku site se pouzije cache (offline rezim funguje dal).
    if (url.startsWith(self.location.origin)) {
        event.respondWith(
            fetch(event.request).then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            }).catch(() => caches.match(event.request))
        );
        return;
    }

    // Knihovny z CDN, fonty a dlazdice map: NEJDRIV CACHE (rychle, setri data, funguje offline).
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            return fetch(event.request).then(response => {
                if (url.startsWith('http')) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
                }
                return response;
            }).catch(() => {});
        })
    );
});
