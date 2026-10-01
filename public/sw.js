/* Catalyst service worker — install shell + Web Push.
   No offline caching yet: this only exists to make the app installable
   and to receive push notifications when the app/tab is closed. */

const APP_NAME = "Catalyst";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* ------------------------------- Push ------------------------------- */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data && event.data.text() };
  }

  const title = data.title || APP_NAME;
  const body = data.body || "You have a new notification.";
  const url = data.url || "/notifications";
  // Group by entity so repeated pings on the same bug/task replace, not stack.
  const tag = data.tag || "catalyst-notification";

  const options = {
    body,
    tag,
    renotify: true,
    // Buzz pattern (Android). iOS ignores this.
    vibrate: data.vibrate || [180, 80, 180],
    // Let the OS play its default notification sound.
    silent: false,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    timestamp: Date.now(),
    data: { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          // Focus an existing tab and route it to the target.
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) client.navigate(url).catch(() => {});
            return;
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

/* Expired subscription — tell the page so it can re-subscribe. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      clients.forEach((c) => c.postMessage({ type: "pushsubscriptionchange" }));
    }),
  );
});
