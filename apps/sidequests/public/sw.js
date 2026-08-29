/**
 * Cache-first shell so the app opens with no signal — which is the normal state
 * of a phone abroad. Nothing here talks to a server; quests are generated on
 * device, so once the shell is cached the app is fully self-contained.
 */
const CACHE = "sidequest-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["./", "./index.html", "./manifest.webmanifest"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          // Offline navigation: fall back to the cached shell.
          if (request.mode === "navigate") {
            const shell = await caches.match("./index.html");
            if (shell) return shell;
          }
          return Response.error();
        });
    }),
  );
});
