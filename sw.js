/**
 * ProPWA — sw.js
 * Service Worker: Stale-While-Revalidate, offline fallback, auto-update
 * @version 1.0.0
 */

"use strict";

const CACHE_VERSION = "v1.0.0";
const STATIC_CACHE = `propwa-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `propwa-dynamic-${CACHE_VERSION}`;
const OFFLINE_URL = "./offline-fallback.html";

/** Assets to pre-cache on install */
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./sw.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./offline-fallback.html"
];

/* ─────────────────────────────
   INSTALL — pre-cache statics
───────────────────────────── */
self.addEventListener("install", (event) => {
  console.info("[SW] Installing...", CACHE_VERSION);
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => {
        console.info("[SW] Static assets cached");
        return self.skipWaiting(); // Force activate immediately
      })
      .catch((err) => console.warn("[SW] Pre-cache failed:", err))
  );
});

/* ─────────────────────────────
   ACTIVATE — clean old caches
───────────────────────────── */
self.addEventListener("activate", (event) => {
  console.info("[SW] Activating...", CACHE_VERSION);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
            .map((key) => {
              console.info("[SW] Deleting old cache:", key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim()) // Take control of all clients
  );
});

/* ─────────────────────────────
   FETCH — routing strategies
───────────────────────────── */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, chrome-extension, and cross-origin non-API requests
  if (request.method !== "GET") return;
  if (url.protocol === "chrome-extension:") return;

  // API requests → Network First
  if (
    url.pathname.includes("/api/") ||
    url.hostname !== self.location.hostname
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML navigation → Stale While Revalidate (offline fallback)
  if (
    request.mode === "navigate" ||
    request.headers.get("accept")?.includes("text/html")
  ) {
    event.respondWith(staleWhileRevalidateWithFallback(request));
    return;
  }

  // Static assets → Cache First
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Dynamic content → Stale While Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

/* ─────────────────────────────
   STRATEGY: Cache First
   Best for: immutable static assets
───────────────────────────── */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await putInCache(STATIC_CACHE, request, response.clone());
    return response;
  } catch {
    return offlineFallback(request);
  }
}

/* ─────────────────────────────
   STRATEGY: Network First
   Best for: API / dynamic data
───────────────────────────── */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await putInCache(DYNAMIC_CACHE, request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

/* ─────────────────────────────
   STRATEGY: Stale While Revalidate
   Best for: pages, non-critical assets
───────────────────────────── */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) putInCache(DYNAMIC_CACHE, request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

/* ─────────────────────────────
   STRATEGY: SWR with offline fallback
   Best for: HTML navigations
───────────────────────────── */
async function staleWhileRevalidateWithFallback(request) {
  const cached = await caches.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) putInCache(DYNAMIC_CACHE, request, response.clone());
      return response;
    })
    .catch(async () => {
      // Return offline fallback page
      const fallback = await caches.match(OFFLINE_URL);
      return (
        fallback ||
        new Response("<h1>Offline</h1>", {
          headers: { "Content-Type": "text/html" }
        })
      );
    });

  return cached || networkPromise;
}

/* ─────────────────────────────
   HELPERS
───────────────────────────── */
async function putInCache(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (e) {
    console.warn("[SW] Cache put failed:", e);
  }
}

async function offlineFallback(request) {
  const fallback = await caches.match(OFFLINE_URL);
  if (fallback) return fallback;
  return new Response(JSON.stringify({ error: "Offline", url: request.url }), {
    headers: { "Content-Type": "application/json" },
    status: 503
  });
}

function isStaticAsset(pathname) {
  return /\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|webp|avif|gif)$/.test(
    pathname
  );
}

/* ─────────────────────────────
   PUSH NOTIFICATIONS
───────────────────────────── */
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || "ProPWA";
  const options = {
    body: data.body || "New notification",
    icon: data.icon || "./icon-192.png",
    badge: data.badge || "./icon-192.png",
    tag: data.tag || "propwa",
    data: { url: data.url || "./" },
    actions: [{ action: "open", title: "Open App" }]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        const url = event.notification.data?.url || "./";
        const existing = list.find((c) => c.url === url);
        if (existing) return existing.focus();
        return clients.openWindow(url);
      })
  );
});

/* ─────────────────────────────
   BACKGROUND SYNC (future-ready)
───────────────────────────── */
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-data") {
    console.info("[SW] Background sync triggered");
    // event.waitUntil(syncData());
  }
});
