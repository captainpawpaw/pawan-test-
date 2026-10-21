// Training Ledger's offline worker. The build fills in VERSION and PRECACHE
// (see vite.config.js): the app, the exercise library and the food lists are
// stored on install, so the app opens with no connection.
const VERSION = "__VERSION__";
const CACHE = `ledger-${VERSION}`;
const RUNTIME = "ledger-runtime"; // things fetched later, e.g. the label reader
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ledger-") && k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return; // online lookups stay online

  // Pages: the newest when online, the stored copy when not.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put("./", res.clone())); return res; })
        .catch(() => caches.match("./", { ignoreSearch: true }).then((r) => r || caches.match(req, { ignoreSearch: true }))),
    );
    return;
  }

  // Everything else: the stored copy if there is one, else the network (and keep it).
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === "basic") caches.open(RUNTIME).then((c) => c.put(req, res.clone()));
      return res;
    })),
  );
});
