// ValijApp service worker: caches only the app shell. Supabase / API responses are never cached.
const VERSION = "valijapp-v2-13";
const SHELL = [
  "./", "index.html", "css/app.css", "manifest.webmanifest",
  "js/main.js", "js/config.js", "js/supabase.js", "js/dom.js", "js/format.js", "js/calc.js", "js/legacy.js",
  "js/auth.js", "js/install.js", "js/icons.js", "js/ui.js", "js/client.js",
  "js/admin/app.js", "js/admin/store.js", "js/admin/home.js", "js/admin/clients.js", "js/admin/movements.js",
  "js/admin/cash.js", "js/admin/promo.js", "js/admin/more.js", "js/admin/migrate.js", "js/admin/xlsx.js",
  "js/admin/sync.js", "js/admin/picker.js", "js/admin/access.js", "js/admin/payments.js", "js/client-pay.js", "js/contact.js",
  "js/vendor/supabase-js-2.117.2.esm.js",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // only same-origin GETs of the shell; everything else (Supabase, Google, CDNs) goes straight to the network
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // network first so a new deploy shows up right away; cache is the offline fallback
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
