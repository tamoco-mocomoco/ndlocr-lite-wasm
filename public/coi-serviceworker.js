/*! coi-serviceworker v0.1.7 - Guido Zuidhof and nicolo-ribaudo, licensed under MIT */
let coepCredentialless = false;
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("message", (ev) => {
    if (ev.data && ev.data.type === "deregister") {
      self.registration
        .unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((client) => client.navigate(client.url)));
    }
  });
  self.addEventListener("fetch", function (e) {
    if (
      e.request.cache === "only-if-cached" &&
      e.request.mode !== "same-origin"
    ) {
      return;
    }
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.status === 0) return res;
          const newHeaders = new Headers(res.headers);
          newHeaders.set(
            "Cross-Origin-Embedder-Policy",
            coepCredentialless ? "credentialless" : "require-corp"
          );
          newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: newHeaders,
          });
        })
        .catch((e) => console.error(e))
    );
  });
} else {
  (() => {
    const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
    window.sessionStorage.removeItem("coiReloadedBySelf");
    const coepDegrading = reloadedBySelf === "coepdegrade";
    if (window.crossOriginIsolated !== false || reloadedBySelf) return;
    if (
      window.isSecureContext &&
      !navigator.serviceWorker
    ) return;
    if (!window.isSecureContext) {
      !coepDegrading &&
        console.log(
          "COOP/COEP Service Worker not registered, a]context is not secure."
        );
      return;
    }
    navigator.serviceWorker
      .register(window.document.currentScript.src)
      .then(
        (registration) => {
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            worker.addEventListener("statechange", () => {
              if (worker.state === "activated") {
                window.sessionStorage.setItem("coiReloadedBySelf", "true");
                window.location.reload();
              }
            });
          });
          if (registration.active && !navigator.serviceWorker.controller) {
            window.sessionStorage.setItem("coiReloadedBySelf", "true");
            window.location.reload();
          }
        },
        (err) => {
          console.error("COOP/COEP Service Worker failed to register:", err);
        }
      );
  })();
}
