const CACHE_NAME = "genzura-cache-v2"; // bump version on deploy
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
  self.skipWaiting(); // activate new SW immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

// Activate: remove old caches
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
  clients.claim(); // take control of all clients immediately
});

// Fetch: network-first, fallback to cache
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // optionally update cache
        if (event.request.method === "GET") {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
