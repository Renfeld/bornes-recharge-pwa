// Service Worker pour PWA - Gestion du cache et fonctionnement hors-ligne
// Version du cache (incrémenter à chaque mise à jour)
const CACHE_NAME = 'bornes-recharge-v1.0.0';
const OFFLINE_URL = '/';

// Ressources critiques à mettre en cache (stratégie Cache First)
const STATIC_CACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  // Leaflet CSS et JS depuis CDN
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  // MarkerCluster CSS et JS depuis CDN
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.4.1/MarkerCluster.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.4.1/MarkerCluster.Default.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.4.1/leaflet.markercluster.min.js'
];

// Tuiles OpenStreetMap à mettre en cache (stratégie Network First avec fallback)
const TILE_CACHE_PATTERN = /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/;

// Installation du Service Worker
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installation en cours...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Cache ouvert');
        // Préchargement des ressources critiques
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => {
        console.log('Service Worker: Ressources statiques mises en cache');
        // Force l'activation immédiate du nouveau SW
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Erreur lors de l\'installation:', error);
      })
  );
});

// Activation du Service Worker
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activation en cours...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        // Suppression des anciens caches
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('Service Worker: Suppression ancien cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activation terminée');
        // Prise de contrôle immédiate de toutes les pages
        return self.clients.claim();
      })
      .catch((error) => {
        console.error('Service Worker: Erreur lors de l\'activation:', error);
      })
  );
});

// Interception des requêtes réseau
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Stratégie Cache First pour les ressources statiques
  if (STATIC_CACHE_URLS.includes(request.url) || request.url.includes('.css') || request.url.includes('.js')) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            console.log('Service Worker: Ressource servie depuis le cache:', request.url);
            return cachedResponse;
          }
          
          // Si pas en cache, récupérer depuis le réseau et mettre en cache
          return fetch(request)
            .then((networkResponse) => {
              if (networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME)
                  .then((cache) => {
                    cache.put(request, responseClone);
                  });
              }
              return networkResponse;
            })
            .catch((error) => {
              console.error('Service Worker: Erreur réseau pour ressource statique:', error);
              // Retourner page offline si disponible
              if (request.mode === 'navigate') {
                return caches.match(OFFLINE_URL);
              }
              throw error;
            });
        })
    );
    return;
  }
  
  // Stratégie Network First pour les tuiles OpenStreetMap (avec cache de 24h)
  if (TILE_CACHE_PATTERN.test(request.url)) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME + '-tiles')
              .then((cache) => {
                // Ajouter en-tête d'expiration pour les tuiles (24h)
                const headers = new Headers(responseClone.headers);
                headers.set('sw-cache-timestamp', Date.now().toString());
                const cachedResponse = new Response(responseClone.body, {
                  status: responseClone.status,
                  statusText: responseClone.statusText,
                  headers: headers
                });
                cache.put(request, cachedResponse);
              });
          }
          return networkResponse;
        })
        .catch(() => {
          // Fallback sur cache si réseau indisponible
          return caches.match(request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                // Vérifier si la tuile n'est pas trop ancienne (24h)
                const cacheTimestamp = cachedResponse.headers.get('sw-cache-timestamp');
                if (cacheTimestamp) {
                  const ageInHours = (Date.now() - parseInt(cacheTimestamp)) / (1000 * 60 * 60);
                  if (ageInHours < 24) {
                    console.log('Service Worker: Tuile servie depuis le cache (offline):', request.url);
                    return cachedResponse;
                  }
                }
              }
              
              // Tuile placeholder en cas d'indisponibilité complète
              return new Response(
                '<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg"><rect width="256" height="256" fill="#f3f4f6"/><text x="128" y="128" text-anchor="middle" fill="#9ca3af" font-family="Arial" font-size="14">Hors ligne</text></svg>',
                {
                  headers: {
                    'Content-Type': 'image/svg+xml',
                    'Cache-Control': 'no-cache'
                  }
                }
              );
            });
        })
    );
    return;
  }
  
  // Stratégie Network First pour les autres requêtes
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          return networkResponse;
        })
        .catch(() => {
          // Fallback sur page principale en cas d'erreur réseau
          console.log('Service Worker: Navigation offline, retour vers page principale');
          return caches.match(OFFLINE_URL);
        })
    );
    return;
  }
  
  // Pour toutes les autres requêtes, stratégie par défaut
  event.respondWith(
    fetch(request)
      .catch(() => {
        return caches.match(request);
      })
  );
});

// Gestion des messages du client (optionnel)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('Service Worker: Mise à jour forcée demandée');
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_CACHE_SIZE') {
    // Calculer la taille du cache pour informations
    caches.open(CACHE_NAME)
      .then((cache) => cache.keys())
      .then((keys) => {
        event.ports[0].postMessage({
          type: 'CACHE_SIZE',
          size: keys.length
        });
      });
  }
});

// Nettoyage périodique du cache des tuiles (éviter accumulation excessive)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'tile-cleanup') {
    event.waitUntil(
      caches.open(CACHE_NAME + '-tiles')
        .then((cache) => {
          return cache.keys()
            .then((requests) => {
              const now = Date.now();
              const expiredRequests = [];
              
              return Promise.all(
                requests.map((request) => {
                  return cache.match(request)
                    .then((response) => {
                      if (response) {
                        const timestamp = response.headers.get('sw-cache-timestamp');
                        if (timestamp) {
                          const ageInHours = (now - parseInt(timestamp)) / (1000 * 60 * 60);
                          if (ageInHours > 24) {
                            expiredRequests.push(request);
                          }
                        }
                      }
                    });
                })
              ).then(() => {
                // Supprimer les tuiles expirées
                return Promise.all(
                  expiredRequests.map((request) => cache.delete(request))
                );
              }).then(() => {
                console.log(`Service Worker: ${expiredRequests.length} tuiles expirées supprimées`);
              });
            });
        })
    );
  }
});

// Gestion des erreurs globales du Service Worker
self.addEventListener('error', (event) => {
  console.error('Service Worker: Erreur globale:', event.error);
});

// Notification de mise à jour disponible
self.addEventListener('updatefound', () => {
  console.log('Service Worker: Nouvelle version détectée');
});

console.log('Service Worker: Chargé et prêt');
