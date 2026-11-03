// Service worker mínimo: permite instalar la app y abrirla sin conexión.
// Las marcas igual necesitan internet (la hora la pone el servidor).
const CACHE = "horarios-v21";
const ARCHIVOS = ["./", "index.html", "estilos.css", "app.js", "config.js", "manifest.webmanifest", "tema.js", "casa.png", "logo-claro.png", "logo-oscuro.png", "icono-192.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Abre al instante con lo guardado en el celular y, por detrás, baja la versión nueva
  // (se ve la próxima vez que se abre). Sin nada guardado, va a internet.
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request, { ignoreSearch: true }).then((guardado) => {
    const deRed = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (guardado) { e.waitUntil(deRed.catch(() => {})); return guardado; }
    return deRed;
  })));
});
