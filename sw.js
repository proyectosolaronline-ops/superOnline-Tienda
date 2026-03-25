// sw.js - Service Worker optimizado para Tienda Online PWA
const CACHE_NAME = 'tienda-v1.3'; // Cambia la versión cuando actualices (v1.4, v1.5...)
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './screenshots/desktop-wide.png',
  './screenshots/mobile-narrow.png'
];

// Instalación - Cachear archivos esenciales
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cache abierto');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Activar inmediatamente
  );
});

// Activación - Limpiar cachés antiguas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Borrando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Tomar control de todas las pestañas
  );
});

// Estrategia Cache First + Network fallback (ideal para tienda)
self.addEventListener('fetch', event => {
  // No cachear peticiones al backend (POST, acciones dinámicas)
  if (event.request.url.includes('?action=') || 
      event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Devolver caché si existe
        if (cachedResponse) {
          return cachedResponse;
        }

        // Si no está en caché, ir a la red
        return fetch(event.request).then(networkResponse => {
          // Solo cachear respuestas válidas (status 200)
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          // Clonar la respuesta para guardarla en caché
          const responseToCache = networkResponse.clone();

          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });

          return networkResponse;
        });
      })
      .catch(() => {
        // Offline fallback (opcional: puedes mostrar una página offline)
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      })
  );
});

// Actualización automática cuando hay nueva versión
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('Service Worker registrado correctamente');
