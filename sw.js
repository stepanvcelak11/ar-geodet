const CACHE_NAME = 'argeodet-offline-v12';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/logika.js',
    './js/grafika.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.9.0/proj4.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/esri-leaflet@3.0.12/dist/esri-leaflet.js'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const url = event.request.url;
    if (url.includes('cuzk.gov.cz/arcgis/rest')) return;

    // Vlastni kod aplikace (stejny puvod): NEJDRIV SIT - aby byl vzdy cerstvy.
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

    // Knihovny z CDN a dlazdice map: NEJDRIV CACHE (rychle, setri data).
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
