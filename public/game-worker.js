/* Trusted platform code. Never generate a worker from game source. */
const PLAYER_VERSION = "7"; // Bump with changes to player.js, sandbox.js, or player.css.
const base = new URL(self.registration.scope);
const gameId = base.pathname.split("/").filter(Boolean).pop();
const prefix = "pocket-base:" + gameId + ":";
const metaCache = prefix + "meta";
const metaURL = new URL("__offline", base).href;
const gameURL = new URL("game.json", base).href;
const assets = [
  base.href,
  new URL("/player.js?v=" + PLAYER_VERSION, base).href,
  new URL("/sandbox.js?v=" + PLAYER_VERSION, base).href,
  new URL("/player.css?v=" + PLAYER_VERSION, base).href,
  new URL("manifest.webmanifest", base).href,
  ...[180, 192, 512].map(size => new URL("icons/" + size + ".png", base).href),
];
let downloadQueue = Promise.resolve();
function serializeDownload(task) {
  const result = downloadQueue.catch(() => {}).then(task);
  downloadQueue = result;
  return result;
}
async function metadata() {
  const cache = await caches.open(metaCache);
  const response = await cache.match(metaURL);
  return response ? response.json() : {};
}
async function writeMetadata(value) {
  const cache = await caches.open(metaCache);
  await cache.put(metaURL, new Response(JSON.stringify({ ...value, playerVersion: PLAYER_VERSION }), { headers: { "Content-Type": "application/json" } }));
}
function offlineCopy(response, url) {
  if (!response || url !== gameURL) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Pocket-Offline", "1");
  return new Response(response.body, { status: response.status, headers });
}
async function cached(url) {
  const meta = await metadata();
  if (!meta.active) return;
  return (await caches.open(meta.active)).match(url);
}
function download(revisionId, activate) {
  return serializeDownload(() => performDownload(revisionId, activate));
}
async function performDownload(revisionId, activate) {
  if (!/^[a-f0-9-]{36}$/i.test(revisionId)) throw new Error("Invalid game version.");
  const before = await metadata();
  const name = prefix + PLAYER_VERSION + ":" + revisionId;
  if (before.active === name) return { ready: true, revisionId };
  if (before.pending === name) {
    if (activate) await writeMetadata({ active: name, revisionId, pending: null, pendingRevisionId: null });
    return { ready: true, revisionId };
  }
  const task = (async () => {
    try {
      const response = await fetch(gameURL, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("This game couldn't be downloaded.");
      const game = await response.clone().json();
      if (game.id !== gameId || game.revisionId !== revisionId) throw new Error("A new version is available. Reopen the game to download it.");
      const responses = await Promise.all(assets.map(async url => {
        const r = await fetch(url, { cache: "reload", credentials: "omit" });
        if (!r.ok || r.redirected) throw new Error("The download didn't finish. Your previous version is safe.");
        return r;
      }));
      const release = await caches.open(name);
      await release.put(gameURL, response);
      await Promise.all(assets.map((url, i) => release.put(url, responses[i])));
      // Only point at a release once every required file is stored.
      const meta = await metadata();
      if (activate || !meta.active) await writeMetadata({ active: name, revisionId, pending: null, pendingRevisionId: null });
      else await writeMetadata({ ...meta, pending: name, pendingRevisionId: revisionId });
      const retained = await metadata();
      const all = await caches.keys();
      await Promise.all(all.filter(key => key.startsWith(prefix) && key !== metaCache && key !== retained.active && key !== retained.pending).map(key => caches.delete(key)));
      return { ready: true, revisionId };
    } catch (error) {
      const meta = await metadata();
      if (meta.active !== name && meta.pending !== name) await caches.delete(name);
      throw error;
    }
  })();
  return task;
}
self.addEventListener("install", event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });
self.addEventListener("message", event => {
  const port = event.ports[0];
  if (!port || !event.source?.url || !event.source.url.startsWith(base.href)) return;
  event.waitUntil((async () => {
    try {
      const message = event.data || {};
      if (message.type === "DOWNLOAD") port.postMessage(await download(message.revisionId, message.activate === true));
      else if (message.type === "STATUS") port.postMessage(await metadata());
      else if (message.type === "ACTIVATE") {
        await serializeDownload(async () => {
          const meta = await metadata();
          if (!meta.pending || meta.pendingRevisionId !== message.revisionId) throw new Error("The update isn't ready. Try again online.");
          await writeMetadata({ active: meta.pending, revisionId: meta.pendingRevisionId, pending: null, pendingRevisionId: null });
        });
        port.postMessage({ ready: true });
      }
    } catch (error) { port.postMessage({ error: error.message || "The download didn't finish." }); }
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== base.origin) return;
  if (url.href === gameURL || (request.mode === "navigate" && url.pathname === base.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        // A real unpublish (404) stops fresh online access. Transient failures can use the downloaded copy.
        if (response.status < 500) return response;
        const fallback = await cached(request.url);
        return offlineCopy(fallback, request.url) || response;
      } catch {
        const fallback = await cached(request.url);
        return offlineCopy(fallback, request.url) || new Response("Open this game online once to download it.", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
  } else if (assets.includes(url.href) || ["/player.js", "/sandbox.js", "/player.css"].includes(url.pathname)) {
    event.respondWith((async () => (await cached(url.href)) || fetch(request))());
  }
});
