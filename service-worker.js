const CACHE_NAME = "genzura-cache-v3"; // bump version for each deploy
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

// Install: cache files immediately
self.addEventListener("install", (event) => {
  self.skipWaiting(); // activate new SW immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

// Activate: delete old caches and take control
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
  clients.claim();
});

// Fetch: network-first, fallback to cache
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return; // ignore non-GET requests
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // update cache with fresh response
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => caches.match(event.request)) // fallback if offline
  );
});

// Notify clients when new SW takes over
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
