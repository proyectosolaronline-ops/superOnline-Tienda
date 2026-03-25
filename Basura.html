// LandingKit — Service Worker mínimo
// Solo necesario para activar el prompt de instalación PWA en Chrome Android
// No cachea nada — la tienda siempre carga fresco del servidor

const CACHE = 'lk-v1';

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(clients.claim());
});

// Sin caché — fetch directo siempre
self.addEventListener('fetch', function(e) {
  e.respondWith(fetch(e.request).catch(function() {
    return new Response('Sin conexión', { status: 503 });
  }));
});
