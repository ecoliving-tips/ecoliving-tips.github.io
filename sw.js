// Swaram - Service Worker for Offline Support

const CACHE_NAME = 'swaram-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/songs.html',
    '/setlist.html',
    '/request.html',
    '/css/styles.css',
    '/js/main.js',
    '/js/songs.js',
    '/js/i18n.js',
    '/js/chord-diagrams.js',
    '/js/setlist.js',
    '/i18n/translations.json',
    '/songs/index.json',
    '/assets/favicon.svg',
    '/assets/favicon.png',
    '/manifest.json',
    // Generated pages (auto-updated by build.js)
    '/songs/anna-pesaha/',
    '/lyrics/anna-pesaha/',
    '/songs/krooshakum-meshayil/',
    '/lyrics/krooshakum-meshayil/',
    '/songs/va-va-eeshoye/',
    '/lyrics/va-va-eeshoye/',
    '/category/holy-mass/',
    '/category/holy-communion/',
    '/artist/traditional-syro-malabar/',
    '/artist/fr-binoj-mulavarickal/'
];

// Install: cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch: network-first for pages, cache-first for assets
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip external requests
    if (url.origin !== self.location.origin) return;

    // Static assets: cache-first
    if (url.pathname.match(/\.(css|js|json|png|svg|ico|woff2?)$/)) {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                });
            })
        );
        return;
    }

    // HTML pages: network-first, cache visited pages
    if (event.request.mode === 'navigate' || event.request.headers.get('accept').includes('text/html')) {
        event.respondWith(
            fetch(event.request).then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            }).catch(() => {
                return caches.match(event.request).then(cached => {
                    return cached || caches.match('/index.html');
                });
            })
        );
        return;
    }
});
