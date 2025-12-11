/* ============================================================
   Service Worker – تشغيل الموقع كتطبيق PWA يعمل بدون إنترنت
   ============================================================ */

const CACHE_NAME = "eyelhekaya-cache-v1";

const FILES_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/stories.json",

  // أيقونات (لو موجودة)
  "/icon-192.png",
  "/icon-512.png"
];

/* ============================
   تثبيت Service Worker
   ============================ */
self.addEventListener("install", (event) => {
  console.log("[Service Worker] Installing...");
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("[Service Worker] Caching files...");
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

/* ============================
   التفعيل
   ============================ */
self.addEventListener("activate", (event) => {
  console.log("[Service Worker] Activated");
  event.waitUntil(self.clients.claim());
});

/* ============================
   التعامل مع الطلبات Fetch
   ============================ */
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then(response => {
      // لو موجود في الكاش → رجّعه فورًا
      if (response) return response;

      // لو مش موجود → هاته من الشبكة مباشرة
      return fetch(event.request).catch(() =>
        caches.match("/index.html") // fallback
      );
    })
  );
});

