// ─────────────────────────────────────────────────────────────────────────────
// Hallnect service worker — date alerts only.
//
// Registered by the search page's "Tell me if one frees up" button, never on
// page load. It shows the notification lib/date-alerts.server.ts sends and
// opens the hall when it is tapped. That is all it does.
//
// NO FETCH HANDLER, deliberately. Without one the worker never sees a page
// request, so it cannot serve a stale page, cache a payment step, or break
// the site if it has a bug. Do not add caching here without a plan for
// invalidating it on every deploy.
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Hallnect";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      // The Hallnect monogram; the diary's home-screen icon is the same mark.
      icon: "/diary-icon-192.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      data: { url: typeof data.url === "string" ? data.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever this site: a payload naming another origin opens the homepage.
  let target = new URL("/", self.location.origin);
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
    if (u.origin === self.location.origin) target = u;
  } catch (e) {
    /* keep the homepage */
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url === target.href && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
