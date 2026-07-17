/* Gate Visa Checklist offline application shell.
 *
 * Passenger records are handled by the application data layer. This worker
 * only keeps the static application shell available when the network is down.
 */
const SHELL_VERSION = "2026.07.17.2";
const CACHE_PREFIX = "excelbase-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${SHELL_VERSION}`;
const CORE_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/brand/ido-logo.jpg",
];

function isCacheableResponse(response) {
  return response && response.ok && (response.type === "basic" || response.type === "default");
}

async function cacheResponse(cache, request, response) {
  if (!isCacheableResponse(response)) return;
  await cache.put(request, response.clone());
}

function shellAssetUrls(html) {
  const urls = new Set();
  const attributePattern = /(?:src|href)=["']([^"']+)["']/g;
  let match;

  while ((match = attributePattern.exec(html)) !== null) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (url.origin !== self.location.origin) continue;
      if (
        url.pathname.startsWith("/_next/static/") ||
        url.pathname.startsWith("/brand/") ||
        url.pathname.startsWith("/icon") ||
        url.pathname === "/apple-touch-icon.png"
      ) {
        urls.add(`${url.pathname}${url.search}`);
      }
    } catch {
      // An invalid optional asset must not prevent the worker from installing.
    }
  }

  return [...urls];
}

async function fetchAndCache(cache, url) {
  const request = new Request(url, { cache: "reload", credentials: "same-origin" });
  const response = await fetch(request);
  if (!isCacheableResponse(response)) throw new Error(`Shell asset could not be cached: ${url}`);
  await cacheResponse(cache, url, response);
  return response;
}

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const rootResponse = await fetch(new Request("/", { cache: "reload", credentials: "same-origin" }));

  if (!isCacheableResponse(rootResponse)) {
    throw new Error("Gate Visa Checklist application shell could not be fetched.");
  }

  await cache.put("/", rootResponse.clone());
  const html = await rootResponse.text();
  const discoveredAssets = shellAssetUrls(html);
  if (discoveredAssets.length === 0) throw new Error("No application shell bundles were discovered.");
  const optionalAssets = CORE_ASSETS.filter((url) => url !== "/" && !discoveredAssets.includes(url));

  // The generated Next.js bundles are essential. If one cannot be cached, the
  // installation is retried instead of reporting a misleading offline-ready state.
  await Promise.all(discoveredAssets.map((url) => fetchAndCache(cache, url)));
  await Promise.allSettled(optionalAssets.map((url) => fetchAndCache(cache, url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage({ type: "SHELL_VERSION", version: SHELL_VERSION });
  }
});

async function networkWithTimeout(request, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function navigationResponse(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await networkWithTimeout(request);
    if (!isCacheableResponse(response)) throw new Error("Navigation response is not cacheable.");
    await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) || (await cache.match("/")) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  await cacheResponse(cache, request, response);
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then(async (response) => {
      await cacheResponse(cache, request, response);
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }

  return (await fresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/sw.js") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});
