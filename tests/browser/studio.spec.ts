import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DemoStore, DEMO_OWNER } from "../../src/lib/demo-store";
import { starters, starterIds } from "../../src/lib/starters";

function store() { return new DemoStore(DEMO_OWNER, process.env.POCKET_BASE_E2E_DATA_DIR); }
const evidence = process.env.AGENT_DESK_EVIDENCE_DIR || path.join(os.tmpdir(), "pocket-base-evidence");
async function screenshot(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, name + ".png"), fullPage: true });
}
test("phone and desktop builder: play, preserve failed edits, publish, and unpublish", async ({ page, request }) => {
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
  await page.getByRole("button", { name: "Start with Matcha Match", exact: true }).click();
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
  expect(Object.keys(publicGame).sort()).toEqual(["description","html","id","revisionId","theme","title"].sort());
  await page.locator("summary").filter({ hasText: "Take this game offline" }).click();
  await page.getByRole("button", { name: "Unpublish game" }).click();
  await expect(page.getByRole("button", { name: "Publish my game" })).toBeVisible();
  expect((await request.get("/play/" + id + "/game.json")).status()).toBe(404);
  const csrf = await request.post("/api/projects", { data: { starter: "stars" }, headers: { origin: "https://other.example" } });
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
  await expect(page.frameLocator("iframe").getByRole("button", { name: "Pop a moon bubble" })).toBeVisible();
  await page.frameLocator("iframe").getByRole("button", { name: "Pop a moon bubble" }).click();
  await expect(page.frameLocator("iframe").getByText("Popped 1")).toBeVisible();
  await page.getByRole("tab", { name: "Make changes" }).click();
  await page.getByLabel("Describe a change to your game").fill("Make the bubbles rainbow");
  await page.getByRole("button", { name: "Make this change" }).click();
  await expect(page.frameLocator("iframe").getByRole("button", { name: "Pop a rainbow bubble" })).toBeVisible();
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

test("all five starters respond to touch and remain usable after phone rotation", async ({ browser }) => {
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
