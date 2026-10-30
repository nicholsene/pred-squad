/* Offline support: app shell is network-first (cache fallback), data is network-first with the
   last copy kept so the app still opens with the most recent stats offline. */
const SHELL = "squad-shell-v16";
const DATA = "squad-data-v1";
const SHELL_FILES = ["./", "index.html", "style.css", "app.js", "engine.js", "session.js", "minimap.js", "insights.js", "scan.js", "photo-prep.js", "camera.js", "photo-time.js", "photo-router.js", "scan-quality.js", "match-focus.js", "match-focus.css", "match.js", "itemlab.js", "mechanics.js", "profiles.js", "optimizer.js", "optimizer-ui.js", "buildplans.js", "counterbuild.js", "planning.js", "buildscan.js", "itemvision.js", "scoreboard.js", "sb-digits.json", "manifest.webmanifest",
  "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/data/")) {
    const key = url.origin + url.pathname; // ignore cache-busting query
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); e.waitUntil(caches.open(DATA).then(c => c.put(key, copy))); }
      return r;
    }).catch(() => caches.open(DATA).then(c => c.match(key)).then(r => r || Response.error())));
    return;
  }
  // shell: network-first so updates show on the next open; cached copy only when offline
  e.respondWith(caches.open(SHELL).then(c => fetch(e.request, { cache: "no-cache" }).then(r => {
    if (r.ok) e.waitUntil(c.put(e.request, r.clone())); return r;
  }).catch(() => c.match(e.request).then(hit => hit || c.match("index.html")))));
});
