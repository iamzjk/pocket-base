import type { PublicGame } from "./types";
export const PLAYER_VERSION = "5";
export function escapeHTML(value: string) {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
export function gameManifest(game: PublicGame) {
  const base = "/play/" + game.id + "/";
  return {
    id: base, name: game.title, short_name: game.title.slice(0, 18), description: game.description,
    start_url: base, scope: base, display: "standalone", background_color: "#faf8f2", theme_color: "#faf8f2",
    categories: ["games", "entertainment"], lang: "en", prefer_related_applications: false,
    icons: [192, 512].flatMap(size => [
      { src: base + "icons/" + size + ".png", sizes: size + "x" + size, type: "image/png", purpose: "any" },
      { src: base + "icons/" + size + ".png", sizes: size + "x" + size, type: "image/png", purpose: "maskable" },
    ]),
  };
}
export function playerDocument(game: PublicGame) {
  const title = escapeHTML(game.title);
  const base = "/play/" + game.id + "/";
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="theme-color" content="#faf8f2"><meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '<meta name="apple-mobile-web-app-title" content="' + title + '">',
    '<meta name="robots" content="noindex,nofollow"><title>' + title + ' · Pocket Base</title>',
    '<link rel="manifest" href="' + base + 'manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="' + base + 'icons/180.png">',
    '<link rel="icon" href="' + base + 'icons/192.png">',
    '<link rel="stylesheet" href="/player.css?v=' + PLAYER_VERSION + '">',
    '</head><body data-game-id="' + game.id + '">',
    '<header class="player-bar"><span class="player-logo" aria-hidden="true">p.</span><strong id="game-name">' + title + '</strong>',
    '<button id="restart" title="Restart game" aria-label="Restart game">↻</button>',
    '<button id="install" class="install-button">Add to phone</button></header>',
    '<main id="stage"><p class="loading" id="loading" role="status">Opening a little world…</p></main>',
    '<footer class="player-footer"><span id="offline-state" role="status">Getting ready…</span>',
    '<button id="update" hidden>Update & restart</button><span class="made-with">Made in Pocket Base</span></footer>',
    '<section id="install-help" class="help" hidden role="dialog" aria-modal="true" aria-labelledby="help-title">',
    '<div class="help-card"><button id="close-help" class="close-help" aria-label="Close installation help">×</button>',
    '<span class="help-icon">✦</span><h2 id="help-title">A little world.<br>One tap away.</h2><p id="help-text"></p>',
    '<p class="help-note">Wait for “Ready offline” before your first offline adventure.</p><button id="got-it">Got it</button></div></section>',
    '<script type="module" src="/player.js?v=' + PLAYER_VERSION + '"></script></body></html>',
  ].join("");
}
export const PLAYER_POLICY = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "media-src data: blob:", "connect-src 'self'",
  "frame-src 'self' about:", "worker-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join("; ");
