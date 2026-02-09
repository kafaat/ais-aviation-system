// AIS Aviation System - Service Worker
// Provides offline support, caching strategies, background sync, and push notifications

const CACHE_NAME = "ais-v1";
const OFFLINE_URL = "/offline.html";

// Essential assets to pre-cache during install
const PRECACHE_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

// File extensions that use cache-first strategy
const STATIC_EXTENSIONS = [
  ".js",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
];

// Background sync tag for offline booking drafts
const BOOKING_SYNC_TAG = "booking-draft-sync";

// ─── Install Event ──────────────────────────────────────────────────────────────
// Pre-cache essential assets so the app shell loads instantly on repeat visits
// and the offline fallback is always available.
self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => {
        // Use addAll for atomic caching - if any asset fails, none are cached.
        // We catch individual failures gracefully since icons may not exist yet.
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(err => {
              console.warn(`[SW] Failed to pre-cache ${url}:`, err.message);
            })
          )
        );
      })
      .then(() => {
        // Force this SW to become the active SW immediately
        return self.skipWaiting();
      })
  );
});

// ─── Activate Event ─────────────────────────────────────────────────────────────
// Clean up old caches from previous versions to free storage space
// and ensure the new SW takes control of all open clients.
self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => {
              console.info(`[SW] Deleting old cache: ${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // Take control of all open tabs/windows immediately
        return self.clients.claim();
      })
  );
});

// ─── Fetch Event ────────────────────────────────────────────────────────────────
// Route requests to the appropriate caching strategy:
// - API calls: network-first (freshness matters)
// - Static assets: cache-first (immutable after build)
// - Navigation: network-first with offline fallback
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests and http/https
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip non-GET requests (POST, PUT, DELETE, etc.)
  if (request.method !== "GET") {
    return;
  }

  // Strategy routing
  if (isApiRequest(url)) {
    event.respondWith(networkFirstStrategy(request));
  } else if (isStaticAsset(url)) {
    event.respondWith(cacheFirstStrategy(request));
  } else if (request.mode === "navigate") {
    event.respondWith(navigationStrategy(request));
  } else {
    // Default: network-first for anything else
    event.respondWith(networkFirstStrategy(request));
  }
});

// ─── Caching Strategies ─────────────────────────────────────────────────────────

/**
 * Cache-first strategy: serve from cache, fall back to network.
 * Best for static assets (JS, CSS, images, fonts) that are fingerprinted
 * and immutable after build.
 */
async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    // Serve from cache immediately, update cache in background
    refreshCache(request);
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_error) {
    // If both cache and network fail, return a basic error response
    return new Response("Asset not available offline", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

/**
 * Network-first strategy: try network, fall back to cache.
 * Best for API calls and dynamic content where freshness is critical.
 */
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Cache successful responses for offline fallback
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_error) {
    // Network failed - try serving from cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // For API requests, return a structured JSON error
    if (isApiRequest(new URL(request.url))) {
      return new Response(
        JSON.stringify({
          error: "OFFLINE",
          message: "You are currently offline. This data is not available.",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response("Content not available offline", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

/**
 * Navigation strategy: network-first with offline HTML fallback.
 * For page navigations, always try network first. If offline,
 * serve the dedicated offline page.
 */
async function navigationStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_error) {
    // Try to serve a cached version of the requested page
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Fall back to the offline page
    const offlinePage = await caches.match(OFFLINE_URL);
    if (offlinePage) {
      return offlinePage;
    }

    // Last resort: inline offline message
    return new Response(
      `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Offline</title></head>
<body style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;">
<div style="text-align:center;">
<h1>You're Offline</h1>
<p>Please check your internet connection and try again.</p>
<button onclick="location.reload()">Retry</button>
</div></body></html>`,
      {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }
    );
  }
}

// ─── Helper Functions ───────────────────────────────────────────────────────────

/** Check if the URL is an API request */
function isApiRequest(url) {
  return (
    url.pathname.startsWith("/api/trpc/") || url.pathname.startsWith("/api/")
  );
}

/** Check if the URL points to a static asset based on file extension */
function isStaticAsset(url) {
  return STATIC_EXTENSIONS.some(ext => url.pathname.endsWith(ext));
}

/** Refresh a cached asset in the background without blocking the response */
function refreshCache(request) {
  fetch(request)
    .then(response => {
      if (response.ok) {
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, response);
        });
      }
    })
    .catch(() => {
      // Silently fail - the cached version is still valid
    });
}

// ─── Background Sync ────────────────────────────────────────────────────────────
// Handles offline booking drafts: when a user creates a booking while offline,
// the draft is saved to IndexedDB and synced when connectivity is restored.
self.addEventListener("sync", event => {
  if (event.tag === BOOKING_SYNC_TAG) {
    event.waitUntil(syncBookingDrafts());
  }
});

/**
 * Sync booking drafts stored in IndexedDB to the server.
 * Each draft is sent individually; successful syncs are removed from storage.
 */
async function syncBookingDrafts() {
  try {
    const db = await openDraftsDB();
    const drafts = await getAllDrafts(db);

    for (const draft of drafts) {
      try {
        const response = await fetch("/api/trpc/bookings.create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft.data),
        });

        if (response.ok) {
          await deleteDraft(db, draft.id);
          // Notify the client that the draft was synced
          const clients = await self.clients.matchAll({ type: "window" });
          clients.forEach(client => {
            client.postMessage({
              type: "BOOKING_SYNCED",
              draftId: draft.id,
            });
          });
        }
      } catch (_error) {
        // Individual draft sync failed - will retry on next sync event
        console.warn(`[SW] Failed to sync draft ${draft.id}`);
      }
    }
  } catch (_error) {
    console.warn("[SW] Background sync failed:", _error);
  }
}

// ─── IndexedDB Helpers for Booking Drafts ───────────────────────────────────────

const DRAFTS_DB_NAME = "ais-booking-drafts";
const DRAFTS_STORE_NAME = "drafts";
const DRAFTS_DB_VERSION = 1;

function openDraftsDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFTS_DB_NAME, DRAFTS_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFTS_STORE_NAME)) {
        db.createObjectStore(DRAFTS_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllDrafts(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFTS_STORE_NAME, "readonly");
    const store = transaction.objectStore(DRAFTS_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteDraft(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFTS_STORE_NAME, "readwrite");
    const store = transaction.objectStore(DRAFTS_STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ─── Push Notifications ─────────────────────────────────────────────────────────
// Handles incoming push notifications for flight updates, booking confirmations,
// gate changes, price alerts, etc.
self.addEventListener("push", event => {
  if (!event.data) {
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch (_error) {
    payload = {
      title: "AIS Aviation",
      body: event.data.text(),
      icon: "/icons/icon-192x192.png",
    };
  }

  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192x192.png",
    badge: "/icons/icon-96x96.png",
    vibrate: [100, 50, 100],
    tag: payload.tag || "ais-notification",
    renotify: Boolean(payload.renotify),
    data: {
      url: payload.url || "/",
      ...payload.data,
    },
    actions: payload.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || "AIS Aviation", options)
  );
});

// Handle notification click - open the relevant page
self.addEventListener("notificationclick", event => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  // Handle action button clicks
  if (event.action) {
    // Specific action handling can be added here
    // e.g., "view-booking", "dismiss", "check-gate"
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(clientList => {
        // Focus an existing tab if one is already open
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Open a new tab if none exist
        return self.clients.openWindow(targetUrl);
      })
  );
});

// Handle notification close (for analytics)
self.addEventListener("notificationclose", _event => {
  // Can be used for tracking notification dismissals
});

// ─── Message Handling ───────────────────────────────────────────────────────────
// Handle messages from the main application thread
self.addEventListener("message", event => {
  const { type } = event.data || {};

  switch (type) {
    case "SKIP_WAITING":
      // Called when the user accepts an update prompt
      self.skipWaiting();
      break;

    case "GET_VERSION":
      // Report the current cache version
      event.source?.postMessage({
        type: "VERSION",
        version: CACHE_NAME,
      });
      break;

    case "CLEAR_CACHE":
      // Allow the app to request a full cache clear
      caches.delete(CACHE_NAME).then(() => {
        event.source?.postMessage({ type: "CACHE_CLEARED" });
      });
      break;

    default:
      break;
  }
});
