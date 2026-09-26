/*
 * Notification service worker.
 *
 * Mobile browsers (Android Chrome in particular) do not allow `new Notification()`
 * — the constructor is present but illegal, and throws:
 *   "Failed to construct 'Notification': Illegal constructor.
 *    Use ServiceWorkerRegistration.showNotification() instead."
 * The constructor is also blocked on desktop Chrome for installed/standalone apps.
 *
 * So notifications are always displayed from here, via
 * ServiceWorkerRegistration.showNotification(), which is the supported route on
 * every platform. This worker does nothing else: it has no offline caching, so it
 * cannot serve a stale copy of the app.
 *
 * It must be served from the site root (/notification-sw.js) so its scope can be
 * "/" — Vite keeps it in the project root rather than public/ so that the public
 * folder stays free of an index.html (which would shadow the app in dev).
 */

self.addEventListener("install", () => {
  // Take over as soon as possible; there is no cached state to lose.
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

// Tapping a notification focuses the app instead of opening a second copy.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })
  );
});