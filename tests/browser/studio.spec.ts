import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DemoStore, DEMO_OWNER } from "../../src/lib/demo-store";
import { starters, starterIds } from "../fixtures/games";
import { PLAYER_VERSION } from "../../src/lib/pwa";
import { classicGames } from "../../src/lib/classic-games";

function store() { return new DemoStore(DEMO_OWNER, process.env.POCKET_BASE_E2E_DATA_DIR); }
const evidence = process.env.AGENT_DESK_EVIDENCE_DIR || path.join(os.tmpdir(), "pocket-base-evidence");
async function screenshot(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, name + ".png"), fullPage: true });
}
test("phone and desktop builder: play, preserve failed edits, publish, and unpublish", async ({ page, request }) => {
  await store().save({ ...starters[1], title: "Phone memory fixture", prompt: "Fictional private test game." });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Imagine it. Make it yours." })).toBeVisible();
  await screenshot(page, "home-phone");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await screenshot(page, "home-desktop");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Edit Phone memory fixture", exact: true }).click();
  await expect(page).toHaveURL(/\?game=/);
  const id = new URL(page.url()).searchParams.get("game")!;
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("heading", { name: "Matcha Match" })).toBeVisible();
  await frame.getByRole("button", { name: "Reveal card 1", exact: true }).click();
  await screenshot(page, "editor-phone");
  const before = await (await request.get("/api/projects/" + id)).json();
  await page.getByRole("tab", { name: "Make changes" }).click();
  await page.getByLabel("Describe a change to your game").fill("Try the busy model");
  await page.getByRole("button", { name: "Make this change" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "game maker" })).toContainText("busy or has reached its allowance");
  const after = await (await request.get("/api/projects/" + id)).json();
  expect(after.currentRevisionId).toBe(before.currentRevisionId);
  expect(after.revisions).toHaveLength(before.revisions.length);
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Publish my game" }).click();
  await expect(page.getByRole("button", { name: "This version is live" })).toBeVisible();
  await expect(page.getByLabel("Your public play link")).toHaveValue(new RegExp("/play/" + id + "/$"));
  const publicGame = await (await request.get("/play/" + id + "/game.json")).json();
  expect(publicGame.revisionId).toBe(before.currentRevisionId);
  expect(Object.keys(publicGame).sort()).toEqual(["description","html","iconSvg","id","revisionId","theme","title"].sort());
  await page.locator("summary").filter({ hasText: "Take this game offline" }).click();
  await page.getByRole("button", { name: "Unpublish game" }).click();
  await expect(page.getByRole("button", { name: "Publish my game" })).toBeVisible();
  expect((await request.get("/play/" + id + "/game.json")).status()).toBe(404);
  const csrf = await request.post("/api/generate", { data: { prompt: "Fictional cross-origin game" }, headers: { origin: "https://other.example" } });
  expect(csrf.status()).toBe(403);
});

test("public PWAs have distinct identities, persist isolated saves, and reload offline", async ({ context, page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const a = starterIds[0], b = starterIds[1];
  await page.goto("/play/" + a + "/");
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Star Catcher" })).toBeVisible();
  await screenshot(page, "player-phone");
  const manifestA = await (await request.get("/play/" + a + "/manifest.webmanifest")).json();
  const manifestB = await (await request.get("/play/" + b + "/manifest.webmanifest")).json();
  expect(manifestA.id).not.toBe(manifestB.id);
  expect(manifestA.scope).toBe("/play/" + a + "/");
  expect(manifestA.display).toBe("standalone");
  const cdp = await context.newCDPSession(page);
  const install = await cdp.send("Page.getAppManifest");
  expect(install.errors).toEqual([]);
  expect(install.url).toContain(a);
  for (const size of [180,192,512]) {
    const icon = await request.get("/play/" + a + "/icons/" + size + ".png");
    expect(icon.status()).toBe(200);
    const bytes = await icon.body();
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
  const frameA = page.frames().find(f => f.parentFrame());
  await frameA!.evaluate(async () => { await (window as any).PocketBase.save("progress", { level: 7 }); });
  const second = await context.newPage();
  await second.goto("/play/" + b + "/");
  await expect(second.getByText("Ready offline", { exact: true })).toBeVisible();
  const frameB = second.frames().find(f => f.parentFrame());
  expect(await frameB!.evaluate(async () => (window as any).PocketBase.load("progress"))).toBe(null);
  await frameB!.evaluate(async () => { await (window as any).PocketBase.save("progress", { level: 2 }); });
  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => r.scope));
  expect(scopes.some(scope => scope.endsWith("/play/" + a + "/"))).toBe(true);
  expect(scopes.some(scope => scope.endsWith("/play/" + b + "/"))).toBe(true);
  expect(scopes.some(scope => new URL(scope).pathname === "/")).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Star Catcher" })).toBeVisible();
  await expect(page.getByText("Playing offline", { exact: true })).toBeVisible();
  expect(await page.frames().find(f => f.parentFrame())!.evaluate(async () => (window as any).PocketBase.load("progress"))).toEqual({ level: 7 });
  await second.reload();
  await expect(second.frameLocator("iframe").getByRole("heading", { name: "Matcha Match" })).toBeVisible();
  expect(await second.frames().find(f => f.parentFrame())!.evaluate(async () => (window as any).PocketBase.load("progress"))).toEqual({ level: 2 });
  const names = await page.evaluate(() => caches.keys());
  expect(names.every(name => name.startsWith("pocket-base:"))).toBe(true);
  await context.setOffline(false);
});

test("publishing updates requires no deployment and incomplete downloads retain the prior game", async ({ context, page }) => {
  const db = store();
  const first = await db.save({ ...starters[0], title: "Update fixture", prompt: "A private fictional first prompt" });
  await db.select(first.id, first.currentRevisionId, "publish");
  await page.goto("/play/" + first.id + "/");
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
  const next = await db.save({ ...starters[0], title: "Second release", html: starters[0].html.replaceAll("Star Catcher", "Second release"),
    prompt: "A private fictional change", projectId: first.id, baseRevisionId: first.currentRevisionId });
  await db.select(first.id, next.currentRevisionId, "publish");
  let interrupted = 0;
  await context.route("**/icons/512.png", route => { interrupted++; return route.abort(); });
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect.poll(() => interrupted).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Update & restart" })).toBeHidden();
  await context.unroute("**/icons/512.png");
  // Exercise going online before offline startup finishes registering its worker.
  await page.addInitScript(() => {
    const original = navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker);
    navigator.serviceWorker.getRegistration = async (...args) => {
      if (!navigator.onLine) await new Promise(resolve => setTimeout(resolve,250));
      return original(...args);
    };
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Star Catcher" })).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(page.getByRole("button", { name: "Update & restart" })).toBeVisible();
  // An update must not interrupt the running game.
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Star Catcher" })).toBeVisible();
  await page.getByRole("button", { name: "Update & restart" }).click();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Second release" })).toBeVisible();
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Second release" })).toBeVisible();
  await context.setOffline(false);
});

test("generated code cannot access the parent, browser storage, network fetch, or service workers", async ({ page }) => {
  await page.goto("/play/" + starterIds[1] + "/");
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
  const frame = page.frames().find(f => f.parentFrame())!;
  const result = await frame.evaluate(async () => {
    let parentBlocked = false, storageBlocked = false, networkBlocked = false, workerBlocked = false;
    try { void parent.document.body; } catch { parentBlocked = true; }
    try { localStorage.setItem("attack", "bad"); } catch { storageBlocked = true; }
    try { await fetch("/api/projects"); } catch { networkBlocked = true; }
    try { await navigator.serviceWorker.register("/game-worker.js", { scope: "/" }); } catch { workerBlocked = true; }
    return { parentBlocked, storageBlocked, networkBlocked, workerBlocked };
  });
  expect(result).toEqual({ parentBlocked: true, storageBlocked: true, networkBlocked: true, workerBlocked: true });
});

test("create, revise, restore, and republish through the complete API with a fictional model", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Describe your game idea").fill("A little bubble game");
  await page.getByRole("button", { name: "Make it", exact: true }).click();
  await expect(page).toHaveURL(/\?game=/);
  const id = new URL(page.url()).searchParams.get("game")!;
  const originalLogo = (await (await request.get("/api/projects/" + id)).json()).revisions[0].iconSvg;
  expect(originalLogo).toContain("#9ed9c7");
  await expect(page.frameLocator("iframe").getByRole("button", { name: "Pop a moon bubble" })).toBeVisible();
  await page.frameLocator("iframe").getByRole("button", { name: "Pop a moon bubble" }).click();
  await expect(page.frameLocator("iframe").getByText("Popped 1")).toBeVisible();
  await page.getByRole("tab", { name: "Make changes" }).click();
  await page.getByLabel("Describe a change to your game").fill("Make the bubbles rainbow");
  await page.getByRole("button", { name: "Make this change" }).click();
  await expect(page.frameLocator("iframe").getByRole("button", { name: "Pop a rainbow bubble" })).toBeVisible();
  const revisedGame = await (await request.get("/api/projects/" + id)).json();
  expect(revisedGame.revisions.find((r: { id: string }) => r.id === revisedGame.currentRevisionId).iconSvg).toBe(originalLogo);
  await page.getByRole("button", { name: "Versions" }).click();
  await page.locator(".version-row").filter({ hasText: "A little bubble game" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.frameLocator("iframe").getByRole("button", { name: "Pop a moon bubble" })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Publish my game" }).click();
  await expect(page.getByRole("button", { name: "This version is live" })).toBeVisible();
  const firstPublic = await (await request.get("/play/" + id + "/game.json")).json();
  expect(firstPublic.html).toContain("Pop a moon bubble");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Versions" }).click();
  await page.locator(".version-row").filter({ hasText: "Make the bubbles rainbow" }).getByRole("button", { name: "Restore" }).click();
  expect((await (await request.get("/play/" + id + "/game.json")).json()).revisionId).toBe(firstPublic.revisionId);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Publish these changes" }).click();
  await expect(page.getByRole("button", { name: "This version is live" })).toBeVisible();
  expect((await (await request.get("/play/" + id + "/game.json")).json()).html).toContain("Pop a rainbow bubble");
});

test("all five game fixtures respond to touch and remain usable after phone rotation", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    for (let i=0;i<starters.length;i++) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("http://127.0.0.1:3217/play/" + starterIds[i] + "/");
      await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
      const frame = page.frameLocator("iframe");
      await expect(frame.getByRole("heading", { name: starters[i].title })).toBeVisible();
      if (i === 0) {
        const canvas = frame.locator("canvas");
        const bounds = await canvas.boundingBox();
        await page.touchscreen.tap(bounds!.x + bounds!.width * .5, bounds!.y + bounds!.height * .8);
        await frame.getByRole("button", { name: "Start over" }).tap();
        await expect(frame.locator("#score")).toContainText("Stars 0");
      } else if (i === 1) {
        const card = frame.getByRole("button", { name: "Reveal card 1", exact: true });
        await card.tap();
        await expect(card).not.toHaveText("✦");
      } else if (i === 2) {
        const before = await frame.locator("canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());
        await frame.getByRole("button", { name: "Move down" }).tap();
        const after = await frame.locator("canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());
        expect(after !== before).toBe(true);
        await frame.getByRole("button", { name: "Wander again" }).tap();
      } else if (i === 3) {
        await frame.getByRole("button", { name: "Saturn", exact: true }).tap();
        await expect(frame.getByText("You got it! ✨", { exact: true })).toBeVisible();
        await frame.getByRole("button", { name: "Next question →" }).tap();
        await expect(frame.getByText("How many arms does an octopus have?", { exact: true })).toBeVisible();
      } else {
        const canvas = frame.locator("canvas");
        const before = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
        const bounds = await canvas.boundingBox();
        await page.touchscreen.tap(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
        const after = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
        expect(after !== before).toBe(true);
        await frame.getByRole("button", { name: "A fresh canvas" }).tap();
        expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL()) === before).toBe(true);
      }
      await page.setViewportSize({ width: 844, height: 390 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const button = frame.getByRole("button").last();
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeVisible();
    }
  } finally { await context.close(); }
});

test("studio controls remain reachable across phone sizes, rotation, and keyboard resizing", async ({ browser }) => {
  await store().save({ ...starters[1], title: "Mobile memory fixture", prompt: "Fictional mobile test game." });
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  async function fits() {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const outside = await page.locator(".editor button:visible, .editor textarea:visible").evaluateAll(elements => elements.filter(e => {
      const r = e.getBoundingClientRect();
      return r.top < -1 || r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
    }).map(e => e.getAttribute("aria-label") || e.textContent));
    expect(outside).toEqual([]);
  }
  async function touchTargets() {
    expect(await page.locator("button:visible").evaluateAll(elements => elements.filter(e => {
      const r = e.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5;
    }).map(e => e.getAttribute("aria-label") || e.textContent))).toEqual([]);
  }
  try {
    await page.goto("http://127.0.0.1:3217/");
    await touchTargets();
    // Open from well down the page: the editor must reset the document scroll.
    await page.getByRole("button", { name: "Edit Mobile memory fixture", exact: true }).tap();
    const card = page.frameLocator("iframe").getByRole("button", { name: "Reveal card 1", exact: true });
    await card.tap(); await expect(card).not.toHaveText("✦");
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }, { width: 390, height: 440 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole("tab", { name: "Make changes" }).tap();
      await page.getByLabel("Describe a change to your game").fill("Keep this draft after rotating");
      await fits(); await touchTargets();
      await page.getByRole("tab", { name: "Play", exact: true }).tap();
      await expect(card).not.toHaveText("✦"); await fits();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "Make changes" }).tap();
    await expect(page.getByLabel("Describe a change to your game")).toHaveValue("Keep this draft after rotating");
    // Model browsers whose keyboard resizes the visual viewport alone.
    await page.evaluate(() => {
      Object.defineProperty(visualViewport, "height", { configurable: true, get: () => 360 });
      visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect.poll(async () => (await page.locator(".studio").boundingBox())?.height).toBe(360);
    const send = await page.getByRole("button", { name: "Make this change" }).boundingBox();
    expect(send!.y + send!.height).toBeLessThanOrEqual(360);
    await page.getByRole("button", { name: "Versions", exact: true }).tap();
    const dialog = await page.getByRole("dialog").boundingBox();
    expect(dialog!.y).toBeGreaterThanOrEqual(0);
    expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(360);
    await page.getByRole("button", { name: "Close dialog" }).tap();
    await page.evaluate(() => {
      delete (visualViewport as any).height;
      visualViewport!.dispatchEvent(new Event("resize"));
    });
    await page.getByRole("button", { name: "Publish", exact: true }).tap();
    await page.getByRole("button", { name: "Publish my game" }).tap();
    await expect(page.getByRole("button", { name: "This version is live" })).toBeVisible();
    await screenshot(page, "mobile-publish");
    await page.getByRole("button", { name: "Close dialog" }).tap();
    await screenshot(page, "mobile-chat");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole("region", { name: "Game conversation" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Playable game preview" })).toBeVisible();
    await fits();
  } finally { await context.close(); }
});

test("player installation help fits a rotated phone and refreshes older offline assets", async ({ page, context }) => {
  const id = starterIds[0];
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/play/" + id + "/");
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
  // Simulate an installed release from before the player layout upgrade.
  await page.evaluate(async ({ gameId, PLAYER_VERSION }) => {
    const meta = await caches.open("pocket-base:" + gameId + ":meta");
    const url = new URL("__offline", location.href).href;
    const value = await (await meta.match(url))!.json();
    const previousVersion = String(Number(PLAYER_VERSION) - 1);
    const oldName = value.active.replace(":" + PLAYER_VERSION + ":", ":" + previousVersion + ":");
    const oldCache = await caches.open(oldName), currentCache = await caches.open(value.active);
    for (const request of await currentCache.keys()) await oldCache.put(request, (await currentCache.match(request))!);
    await caches.delete(value.active);
    await meta.put(url, Response.json({ ...value, active: oldName, playerVersion: previousVersion }));
  }, { gameId: id, PLAYER_VERSION });
  await page.reload();
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
  expect(await page.evaluate(async gameId => {
    const meta = await caches.open("pocket-base:" + gameId + ":meta");
    return (await (await meta.match(new URL("__offline", location.href).href))!.json()).playerVersion;
  }, id)).toBe(PLAYER_VERSION);
  await page.getByRole("button", { name: "Add to phone" }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  const help = page.locator(".help-card");
  const box = await help.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Got it" }).click();
  await context.setOffline(true); await page.reload();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Star Catcher" })).toBeVisible();
  await expect(page.getByText("Playing offline", { exact: true })).toBeVisible();
  await context.setOffline(false);
});

test("startup errors stay visible after readiness and offline download complete", async ({ page }) => {
  const db = store();
  const game = await db.save({ ...starters[0], title: "Startup failure fixture", prompt: "Fictional runtime failure.",
    html: '<!doctype html><html><head><style>html,body{margin:0;height:100%}</style></head><body><canvas width="320" height="480"></canvas><script>throw new Error("Fictional startup failure");</script></body></html>' });
  await db.select(game.id, game.currentRevisionId, "publish");
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const pathname of ["/?game=" + game.id, "/play/" + game.id + "/"]) {
      await page.goto(pathname);
      const failure = page.getByRole("alert").filter({ hasText: "This game couldn't start properly" });
      await expect(failure).toBeVisible();
      // DOM readiness arrives after this exception; it must not erase the error.
      await page.waitForTimeout(100);
      await expect(failure).toBeVisible();
      if (pathname.startsWith("/play/")) await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
      await expect(failure).toBeVisible();
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      const bounds = await retry.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await retry.click(); await expect(failure).toBeVisible();
    }
  }
  await screenshot(page, "startup-error-desktop");
});

test("retry restarts the game and the device-save bridge in studio and public play", async ({ page }) => {
  const db = store();
  const game = await db.save({ ...starters[0], title: "Retry fixture", prompt: "Fictional transient startup failure.",
    html: '<!doctype html><html><head><style>body{margin:0;background:#a6d4c7;font:20px system-ui}</style></head><body><main id="game"></main><script>(async()=>{const retry=await PocketBase.load("settings");if(!retry){await PocketBase.save("settings",{retry:true});throw new Error("Fictional first-attempt failure");}document.getElementById("game").textContent="Ready to play";})()</script></body></html>' });
  await db.select(game.id, game.currentRevisionId, "publish");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const pathname of ["/?game=" + game.id, "/play/" + game.id + "/"]) {
    await page.goto(pathname);
    await expect(page.getByRole("alert").filter({ hasText: "couldn't start properly" })).toBeVisible();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.frameLocator("iframe").getByText("Ready to play", { exact: true })).toBeVisible();
    await expect(page.locator(".game-status:visible")).toHaveCount(0);
    await page.frames().find(f => f.parentFrame())!.evaluate(async () => (window as any).PocketBase.save("settings", null));
  }
});

test("hidden previews wait for space before starting and preserve immediate device saves", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { startGame } = await import("/sandbox.js" as string);
    const holder = document.createElement("div"); holder.id = "startup-holder";
    holder.style.cssText = "display:none;width:320px;height:480px";
    const frame = document.createElement("iframe"); frame.id = "startup-frame";
    frame.setAttribute("sandbox", "allow-scripts"); frame.style.cssText = "width:100%;height:100%;border:0";
    holder.append(frame); document.body.append(holder);
    const states: string[] = []; (window as any).startupStates = states;
    (window as any).stopStartup = startGame(frame, "fictional-hidden-frame", '<!doctype html><html><body><main id="game"></main><script>(async()=>{if(!document.documentElement.clientWidth)throw new Error("No space");const saved=await PocketBase.load("progress");document.getElementById("game").textContent=saved===null?"Device save ready":"Unexpected save";})()</script></body></html>', (state: string) => states.push(state));
  });
  await page.waitForTimeout(100);
  expect(await page.locator("#startup-frame").getAttribute("srcdoc")).toBeNull();
  expect(await page.evaluate(() => (window as any).startupStates)).toEqual(["loading"]);
  await page.locator("#startup-holder").evaluate(el => { el.style.display = "block"; });
  await expect(page.frameLocator("#startup-frame").getByText("Device save ready", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).startupStates)).toEqual(["loading", "ready"]);
  await page.evaluate(() => { (window as any).stopStartup(); document.getElementById("startup-holder")!.remove(); });
});

test("a frame that never starts shows a timeout and a retry action", async ({ page }) => {
  await page.addInitScript(() => {
    const property = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "srcdoc")!;
    Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", { ...property, set() { this.dataset.startAttempted = "yes"; } });
  });
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?game=" + starterIds[0]);
  await page.locator('iframe[data-start-attempted="yes"]').waitFor();
  await expect(page.getByRole("status").filter({ hasText: "Opening your game" })).toBeVisible();
  await page.clock.fastForward(13_000);
  await expect(page.getByRole("alert").filter({ hasText: "taking too long to start" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
});

test("the shared game library shows other owners' published versions and refreshes on unpublish", async ({ page, request }) => {
  const db = new DemoStore("00000000-0000-4000-8000-000000000088", process.env.POCKET_BASE_E2E_DATA_DIR);
  const game = await db.save({ ...starters[1], title: "Community garden fixture", prompt: "PRIVATE community prompt" });
  await db.select(game.id, game.currentRevisionId, "publish");
  await db.save({ ...starters[1], title: "PRIVATE community draft", description: "PRIVATE draft description", projectId: game.id, baseRevisionId: game.currentRevisionId, prompt: "PRIVATE edit" });
  await db.save({ ...starters[0], title: "PRIVATE community unpublished", prompt: "PRIVATE idea" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library");
  const library = page.getByRole("region", { name: "Game library" });
  await expect(library.getByRole("link", { name: "Play Community garden fixture", exact: true })).toBeVisible();
  await expect(page.getByText("v1.1.0", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Start with / })).toHaveCount(0);
  expect((await page.content()).includes("PRIVATE community")).toBe(false);
  const result = await (await request.get("/api/library")).json();
  const listed = result.games.find((g: { id: string }) => g.id === game.id);
  expect(Object.keys(listed).sort()).toEqual(["creatorName","description","id","revisionId","theme","title","updatedAt"]);
  expect(listed.title).toBe("Community garden fixture"); expect(listed.revisionId).toBe(game.currentRevisionId);
  expect((await request.get("/api/projects/" + game.id)).status()).toBe(404);
  expect((await request.post("/api/projects", { data: { starter: "stars" } })).status()).toBe(405);
  await library.getByRole("link", { name: "Play Community garden fixture", exact: true }).click();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Matcha Match" })).toBeVisible();
  await db.unpublish(game.id);
  await page.goto("/library");
  await expect(library.getByRole("link", { name: "Play Community garden fixture", exact: true })).toHaveCount(0);
  await db.select(game.id, game.currentRevisionId, "publish");
  await library.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(library.getByRole("link", { name: "Play Community garden fixture", exact: true })).toBeVisible();
  for (const viewport of [{ width: 320, height: 568 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await screenshot(page, "library-" + viewport.width);
  }
});

test("the game library paginates and recovers from refresh errors", async ({ page, request }) => {
  const db = new DemoStore("00000000-0000-4000-8000-000000000089", process.env.POCKET_BASE_E2E_DATA_DIR);
  for (let i=0;i<25;i++) {
    const game = await db.save({ ...starters[0], title: "Library page fixture " + i, prompt: "Fictional public listing." });
    await db.select(game.id, game.currentRevisionId, "publish");
  }
  await page.goto("/library");
  const library = page.getByRole("region", { name: "Game library" });
  await library.getByRole("button", { name: "Show more games", exact: true }).click();
  await expect(library.getByRole("link", { name: /^Play Library page fixture / })).toHaveCount(25);
  await page.route("**/api/library?offset=0", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fictional library connection failure." }) }));
  await library.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(library.getByRole("alert")).toContainText("Fictional library connection failure");
  await expect(library.getByRole("link", { name: /^Play Library page fixture / })).toHaveCount(25);
  await page.unroute("**/api/library?offset=0");
  await library.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(library.getByRole("alert")).toHaveCount(0);
  await expect(library.locator(".published-card")).toHaveCount(24);
  for (const offset of ["-1","bad","2147483648"]) expect((await request.get("/api/library?offset=" + offset)).status()).toBe(400);
});

test("original catalog games show public metadata in one phone column and have distinct install identities",async({page,request})=>{
  await page.goto("/library");
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:760,height:900},{width:768,height:1024},{width:1440,height:900}]) {
    await page.setViewportSize(viewport);
    const columns=await page.locator(".published-grid").evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(viewport.width<=760 ? 1 : viewport.width<=1050 ? 3 : 4);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const result=await(await request.get("/api/library?offset=24")).json();
  // Earlier tests publish enough games that the originals may be on a later page.
  const all=[...(await(await request.get("/api/library")).json()).games,...result.games];
  for(const classic of classicGames) {
    const listed=all.find((g:{id:string})=>g.id===classic.id);
    expect(listed?.creatorName).toBe("Pocket Base");
    expect((await request.get("/play/"+classic.id+"/game.json")).status()).toBe(200);
  }
  const icon=page.locator('link[rel="apple-touch-icon"]');
  expect(await icon.getAttribute("sizes")).toBe("180x180");
  const rootManifest=await(await request.get("/manifest.webmanifest")).json();
  expect(rootManifest.name).toBe("Pocket Base");expect(rootManifest.id).toBe("/");expect(rootManifest.display).toBe("standalone");
  const gameManifest=await(await request.get("/play/"+classicGames[0].id+"/manifest.webmanifest")).json();
  expect(gameManifest.id).not.toBe(rootManifest.id);
  for(const asset of ["/favicon.ico",await icon.getAttribute("href"),...rootManifest.icons.map((i:{src:string})=>i.src)]) {
    expect((await request.get(asset!)).status()).toBe(200);
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:"Account settings"}).click();
  await page.getByLabel("Public name",{exact:true}).fill("Fictional family studio");
  await page.getByRole("button",{name:"Save public name"}).click();
  await expect(page.getByRole("status")).toContainText("Public name saved");
});

test("creation and edit requests accept 5,000 characters and reject larger prompts",async({page,request})=>{
  const headers={Origin:"http://127.0.0.1:3217","Content-Type":"application/json"};
  expect((await request.post("/api/generate",{headers,data:{prompt:"a".repeat(5001)}})).status()).toBe(400);
  const created=await request.post("/api/generate",{headers,data:{prompt:"星".repeat(5000)}});
  expect(created.status()).toBe(200);
  const game=await created.json();
  expect(game.revisions[0].prompt.length).toBe(5000);
  const escaped=JSON.stringify({prompt:"星".repeat(5000),projectId:game.id,baseRevisionId:game.currentRevisionId}).replaceAll("星","\\u661f");
  const edited=await request.post("/api/generate",{headers,data:escaped});
  expect(edited.status()).toBe(200);
  expect((await edited.json()).revisions).toHaveLength(2);
  await page.goto("/");
  await expect(page.locator("#idea")).toHaveAttribute("maxlength","5000");
  await page.goto("/?game="+game.id);
  await expect(page.locator("#change")).toHaveAttribute("maxlength","5000");
});

test("timeouts while reading successful provider responses keep new and edited games safe",async({page,request})=>{
  const before=await store().list();
  const created=await request.post("/api/generate",{headers:{Origin:"http://127.0.0.1:3217"},data:{prompt:"timeout model"}});
  expect(created.status()).toBe(504);
  expect((await created.json()).error).toContain("ran out of time");
  expect((await store().list()).length).toBe(before.length);
  const game=await store().save({...starters[0],prompt:"Fictional safe original"});
  await page.goto("/?game="+game.id);
  await page.locator("#change").fill("timeout model");
  await page.getByRole("button",{name:"Make this change"}).click();
  await expect(page.locator(".error-banner")).toContainText("ran out of time");
  const unchanged=await store().detail(game.id);
  expect(unchanged?.currentRevisionId).toBe(game.currentRevisionId);
  expect(unchanged?.revisions).toHaveLength(1);
  await expect(page.getByRole("button",{name:"Make this change"})).toBeEnabled();
});
