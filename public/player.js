import { startGame } from "/sandbox.js?v=3";

const PLAYER_VERSION = "3";
const gameId = document.body.dataset.gameId;
const base = "/play/" + gameId + "/";
const stage = document.getElementById("stage");
const status = document.getElementById("offline-state");
const help = document.getElementById("install-help");
let currentGame, registration, installPrompt, detach, pendingRevision, previousFocus, checking = false;
let playingOffline = false, downloaded = false;
function showStatus(text, ready = false) { status.textContent = text; status.classList.toggle("ready", ready); }
function render(game) {
  if (detach) detach();
  const frame = document.createElement("iframe");
  frame.title = game.title;
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("allow", "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'");
  const notice = document.createElement("div");
  notice.className = "game-status";
  const message = document.createElement("p"), retry = document.createElement("button");
  retry.className = "retry-button"; retry.textContent = "Try again";
  retry.onclick = () => render(currentGame);
  notice.append(message, retry);
  stage.replaceChildren(frame, notice);
  detach = startGame(frame, game.id, game.html, state => {
    notice.hidden = state === "ready";
    notice.setAttribute("role", state === "loading" ? "status" : "alert");
    retry.hidden = state === "loading";
    message.textContent = state === "loading" ? "Opening your game…" : state === "timeout"
      ? "This game is taking too long to start. Try restarting."
      : "This game couldn't start properly. Try restarting, or ask its creator for a fix.";
  });
  document.getElementById("game-name").textContent = game.title;
  document.title = game.title;
  currentGame = game;
}
function talk(type, extra = {}) {
  return new Promise((resolve, reject) => {
    const worker = registration?.active;
    if (!worker) return reject(new Error("Offline play isn't ready yet."));
    const message = new MessageChannel();
    const timer = setTimeout(() => { message.port1.close(); reject(new Error("Download paused. Try again online.")); }, 45_000);
    message.port1.onmessage = e => {
      clearTimeout(timer); message.port1.close();
      e.data?.error ? reject(new Error(e.data.error)) : resolve(e.data);
    };
    worker.postMessage({ type, ...extra }, [message.port2]);
  });
}
async function prepareOffline() {
  if (!("serviceWorker" in navigator)) return showStatus("Play online on this browser");
  try {
    const existing = await navigator.serviceWorker.getRegistration(base);
    registration = existing?.active && existing.scope === new URL(base, location.href).href
      ? existing : await navigator.serviceWorker.register("/game-worker.js?v=3", { scope: base });
    if (navigator.onLine) await registration.update().catch(() => {});
    if (registration.installing || registration.waiting || !registration.active) {
      await new Promise((resolve, reject) => {
        const worker = registration.installing || registration.waiting;
        if (!worker) return reject(new Error("Offline play couldn't start."));
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
          if (worker.state === "redundant") reject(new Error("Offline play couldn't start."));
        });
        if (worker.state === "activated") resolve();
      });
    }
    const meta = await talk("STATUS");
    if (meta.revisionId === currentGame.revisionId && meta.playerVersion === PLAYER_VERSION) { downloaded = true; return showStatus(playingOffline || !navigator.onLine ? "Playing offline" : "Ready offline", true); }
    showStatus("Saving for offline…");
    await talk("DOWNLOAD", { revisionId: currentGame.revisionId, activate: true });
    downloaded = true;
    showStatus("Ready offline", true);
  } catch { showStatus(navigator.onLine ? "Offline download paused · tap to retry" : "Go online to finish downloading"); }
}
async function checkUpdate() {
  if (!registration || !currentGame || !navigator.onLine || checking) return;
  checking = true;
  try {
    const response = await fetch(base + "game.json", { cache: "no-store" });
    if (response.status === 404) { showStatus("This game is no longer published"); return; }
    if (!response.ok) return;
    const latest = await response.json();
    if (latest.revisionId === currentGame.revisionId) {
      const meta = await talk("STATUS");
      if (meta.revisionId !== currentGame.revisionId || meta.playerVersion !== PLAYER_VERSION) await prepareOffline();
      else showStatus("Ready offline", true);
      return;
    }
    await talk("DOWNLOAD", { revisionId: latest.revisionId, activate: false });
    pendingRevision = latest.revisionId;
    document.getElementById("update").hidden = false;
    showStatus("An update is ready", true);
  } catch { /* Keep the current, playable version. */ }
  finally { checking = false; }
}
document.getElementById("restart").onclick = () => { if (currentGame) render(currentGame); };
document.getElementById("update").onclick = async () => {
  try { await talk("ACTIVATE", { revisionId: pendingRevision }); location.reload(); }
  catch { showStatus("The update isn't ready. Try again online."); }
};
status.tabIndex = 0;
status.setAttribute("role", "button");
status.setAttribute("aria-label", "Offline download status. Activate to retry download.");
status.onclick = () => currentGame && prepareOffline();
status.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); status.click(); } };
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; });
window.addEventListener("appinstalled", () => { document.getElementById("install").hidden = true; });
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
if (standalone) { document.getElementById("install").hidden = true; document.body.classList.add("standalone"); }
function closeHelp() { help.hidden = true; previousFocus?.focus(); }
document.getElementById("install").onclick = async () => {
  if (installPrompt) {
    await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null;
    return;
  }
  previousFocus = document.activeElement;
  document.getElementById("help-text").textContent = /iPhone|iPad|iPod/.test(navigator.userAgent)
    ? "In Safari, open Share, choose Add to Home Screen, keep Open as Web App enabled if shown, then tap Add."
    : "Open your browser's menu and choose Install app or Add to Home screen. On a computer, look for the install icon in the address bar.";
  help.hidden = false;
  document.getElementById("close-help").focus();
};
document.getElementById("close-help").onclick = closeHelp;
document.getElementById("got-it").onclick = closeHelp;
help.addEventListener("keydown", e => {
  if (e.key === "Escape") closeHelp();
  if (e.key === "Tab") {
    const first = document.getElementById("close-help"), last = document.getElementById("got-it");
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
window.addEventListener("online", checkUpdate);
window.addEventListener("offline", () => showStatus(downloaded ? "Playing offline" : "Go online to finish downloading", downloaded));
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
(async () => {
  try {
    const response = await fetch(base + "game.json", { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 404 ? "This game isn't published right now." : "Open this game online once to download it.");
    playingOffline = response.headers.get("X-Pocket-Offline") === "1";
    render(await response.json());
    await prepareOffline();
  } catch (error) {
    const message = document.createElement("p"); message.className = "loading"; message.textContent = error.message;
    stage.replaceChildren(message); showStatus("Couldn't open this game");
  }
})();
