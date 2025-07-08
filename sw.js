self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open('opic-helper-store').then((cache) => {
            return cache.addAll([
                '.',
                'index.html',
                'style.css',
                'script.js',
                'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
            ]);
        })
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => {
            return response || fetch(e.request);
        })
    );
});