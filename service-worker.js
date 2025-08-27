const CACHE_NAME = "genzura-cache-v1";
const urlsToCache = [
  "/",
  "/index.html",
  "/home.html",
  "/login.html",
  "/admin.html",
  "/notifications.html",
  "/overview.html",
  "/stock.html",
  "/transactions.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// Install & cache resources
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Fetch from cache or network
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// Update service worker
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
});
