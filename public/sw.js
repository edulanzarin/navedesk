/**
 * Service Worker mínimo para habilitar a instalação como PWA.
 *
 * Estratégia: Network-first com fallback para cache. Cacheia assets
 * estáticos no install para garantir que o app shell carregue offline
 * (requisito mínimo para o prompt "Instalar app" aparecer no Chrome).
 */

const CACHE_NAME = "navedesk-v1";

const PRECACHE_URLS = ["/", "/navedesk.png"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== CACHE_NAME)
                        .map((key) => caches.delete(key)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    // Ignora requests não-GET (POST de Server Actions, etc.)
    if (event.request.method !== "GET") return;

    // Ignora requests para APIs e auth (não faz sentido cachear)
    const url = new URL(event.request.url);
    if (url.pathname.startsWith("/api/")) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cacheia respostas bem-sucedidas de assets estáticos
                if (
                    response.ok &&
                    (url.pathname.startsWith("/_next/static/") ||
                        url.pathname.match(/\.(png|jpg|svg|ico|css|js)$/))
                ) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Fallback para cache quando offline
                return caches.match(event.request);
            }),
    );
});
