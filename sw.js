// Service worker : garde l'app en cache pour qu'elle s'ouvre sans réseau.
// Stratégie « cache d'abord, mise à jour en arrière-plan » : l'app démarre
// instantanément, et une nouvelle version mise en ligne est prise en compte
// au lancement suivant.

const CACHE = "ma-collection-v1";
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "store.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Les navigations (ouverture de l'app, quelle que soit la route) servent index.html.
    const key = request.mode === "navigate" ? "index.html" : request;
    const cached = await cache.match(key, { ignoreSearch: true });
    const refresh = fetch(request)
      .then((response) => {
        if (response.ok || response.type === "opaque") cache.put(key, response.clone());
        return response;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(refresh);
      return cached;
    }
    return (await refresh) || new Response("Hors ligne", { status: 503, statusText: "Hors ligne" });
  })());
});
