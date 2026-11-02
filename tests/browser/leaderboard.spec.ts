import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DemoStore, DEMO_OWNER } from "../../src/lib/demo-store";
import { starters } from "../fixtures/games";
import { classicGames } from "../../src/lib/classic-games";

const origin = "http://127.0.0.1:3217";
function store(owner = DEMO_OWNER) { return new DemoStore(owner, process.env.POCKET_BASE_E2E_DATA_DIR); }
async function published(db: DemoStore, title: string, html = starters[0].html) {
  const game = await db.save({ ...starters[0], title, html, prompt: "PRIVATE fictional leaderboard test." });
  await db.select(game.id, game.currentRevisionId, "publish");
  return game;
}
async function playCount(db: DemoStore, id: string) {
  for (let offset = 0;; offset += 24) {
    const page = await db.publishedGames(offset);
    const game = page.games.find(g => g.id === id);
    if (game) return game.playCount;
    if (!page.hasMore) throw new Error("Published test game missing");
  }
}
function openResponse(page: Page, id: string) {
  return page.waitForResponse(response => response.url() === origin + "/api/play/" + id + "/open" && response.request().method() === "POST");
}

test("older database and API responses work on initial load, refresh and pagination", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const base = "http://127.0.0.1:3218";
  await page.goto(base + "/library");
  await expect(page.getByRole("link", { name: "Play Legacy library fixture", exact: true })).toBeVisible();
  await expect(page.locator(".published-count")).toHaveText("0 plays");
  await expect(page.getByText("Play a game to start the leaderboard.")).toBeVisible();
  const response = await page.request.get(base + "/api/library");
  const result = await response.json();
  expect(response.status()).toBe(200);
  expect(result.leaderboard).toEqual([]);
  expect(result.games[0].playCount).toBe(0);
  const { playCount: _count, ...olderGame } = result.games[0];
  await page.route("**/api/library?offset=0", route => route.fulfill({ json: { games: [olderGame], hasMore: true } }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show more games", exact: true })).toBeVisible();
  await expect(page.locator(".published-count")).toHaveText("0 plays");
  await page.route("**/api/library?offset=1", route => route.fulfill({ json: { games: [{ ...olderGame,
    id: "60000000-0000-4000-8000-000000000003", title: "Second legacy fixture" }], hasMore: false } }));
  await page.getByRole("button", { name: "Show more games", exact: true }).click();
  await expect(page.getByRole("link", { name: "Play Second legacy fixture", exact: true })).toBeVisible();
  await expect(page.locator(".published-count")).toHaveText(["0 plays", "0 plays"]);
  expect(errors).toEqual([]);
});

test("online opens deduplicate across refreshes and tabs while previews, restarts and offline play add none", async ({ page, context, browser, request }) => {
  const db = store(), game = await published(db, "Online counter fixture");
  const base = "/play/" + game.id + "/";
  let reports = 0;
  context.on("request", request => { if (request.url().endsWith("/api/play/" + game.id + "/open")) reports++; });
  try {
    await page.goto("/?game=" + game.id);
    await expect(page.frameLocator("iframe").getByRole("heading", { name: "Star Catcher" })).toBeVisible();
    await expect(page.locator(".game-status")).toBeHidden();
    for (const asset of [base, base + "game.json", base + "manifest.webmanifest", base + "icons/192.png"]) expect((await request.get(asset)).status()).toBe(200);
    expect(await playCount(db, game.id)).toBe(0);
    expect(reports).toBe(0);

    const initial = openResponse(page, game.id);
    await page.goto(base);
    const first = await initial;
    expect(first.status()).toBe(204);
    const visitorId = first.request().postDataJSON().visitorId;
    await expect.poll(() => playCount(db, game.id)).toBe(1);
    await page.getByRole("button", { name: "Restart game", exact: true }).click();
    await expect(page.locator(".game-status")).toBeHidden();
    expect(reports).toBe(1);

    const reloaded = openResponse(page, game.id);
    await page.reload();
    expect((await reloaded).request().postDataJSON().visitorId).toBe(visitorId);
    const tab = await context.newPage();
    const reopened = openResponse(tab, game.id);
    await tab.goto(base);
    expect((await reopened).request().postDataJSON().visitorId).toBe(visitorId);
    await tab.close();
    expect(await playCount(db, game.id)).toBe(1);
    expect(reports).toBe(3);

    await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator(".game-status")).toBeHidden();
    await expect(page.getByText("Playing offline", { exact: true })).toBeVisible();
    expect(reports).toBe(3);
    const onlineCheck = page.waitForResponse(response => response.url() === origin + base + "game.json");
    await context.setOffline(false);
    await onlineCheck;
    await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
    expect(reports).toBe(3);
    expect(await playCount(db, game.id)).toBe(1);

    const separate = await browser.newContext();
    try {
      const otherPage = await separate.newPage();
      const otherOpen = openResponse(otherPage, game.id);
      await otherPage.goto(origin + base);
      expect((await otherOpen).status()).toBe(204);
      await expect.poll(() => playCount(db, game.id)).toBe(2);
    } finally { await separate.close(); }
  } finally { await context.setOffline(false); await db.unpublish(game.id); }
});

test("failed startup, reporting failures and blocked counting storage preserve gameplay", async ({ page }) => {
  const db = store();
  const broken = await published(db, "Broken counter fixture", '<!doctype html><html><head><style>html,body{height:100%;margin:0}</style></head><body><script>throw new Error("Fictional startup failure");</script></body></html>');
  const healthy = await published(db, "Counter outage fixture");
  let reports = 0;
  page.on("request", request => { if (request.url().includes("/api/play/")) reports++; });
  try {
    await page.goto("/play/" + broken.id + "/");
    await expect(page.getByRole("alert").filter({ hasText: "couldn't start properly" })).toBeVisible();
    await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
    expect(await playCount(db, broken.id)).toBe(0);
    expect(reports).toBe(0);

    await page.route("**/api/play/" + healthy.id + "/open", route => route.fulfill({ status: 503, body: "Fictional counter outage" }));
    const failedReport = openResponse(page, healthy.id);
    await page.goto("/play/" + healthy.id + "/");
    expect((await failedReport).status()).toBe(503);
    await expect(page.locator(".game-status")).toBeHidden();
    await expect(page.frameLocator("iframe").getByRole("heading", { name: "Star Catcher" })).toBeVisible();
    expect(await playCount(db, healthy.id)).toBe(0);
    await page.getByRole("button", { name: "Restart game", exact: true }).click();
    await expect(page.locator(".game-status")).toBeHidden();
    expect(reports).toBe(1);

    await page.addInitScript(() => {
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key) {
        if (key.endsWith(":play-visitor")) throw new DOMException("Fictional storage failure", "SecurityError");
        return get.call(this, key);
      };
    });
    await page.reload();
    await expect(page.locator(".game-status")).toBeHidden();
    expect(reports).toBe(1);
    expect(await playCount(db, healthy.id)).toBe(0);
  } finally { await db.unpublish(broken.id); await db.unpublish(healthy.id); }
});

test("public top ten shows counts, refreshes after publication changes and fits phones and desktop", async ({ page, request }) => {
  const db = store(randomUUID()), games = [];
  await db.saveProfile("Fictional creator with a long public name for layout checks");
  try {
    for (let i = 0; i < 11; i++) {
      const game = await published(db, i === 10 ? "A fictional adventure with an especially long title for small screens" : "Ranked fixture " + i);
      games.push(game);
      for (let j = 0; j < i + 2; j++) await db.recordGameOpen(game.id, randomUUID());
    }
    await page.goto("/library");
    const ranking = page.getByRole("region", { name: "Most played", exact: true });
    await expect(ranking.getByRole("listitem")).toHaveCount(10);
    expect(await ranking.locator(".leaderboard-rank").allTextContents()).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)));
    expect(await ranking.getByRole("link").evaluateAll(links => links.map(link => link.getAttribute("href")))).toEqual(games.slice(1).reverse().map(game => "/play/" + game.id + "/"));
    await expect(ranking.locator(".leaderboard-count").first()).toHaveText("12 plays");
    await expect(page.locator('.published-card[href="/play/' + classicGames[0].id + '/"] .published-count')).toHaveText("0 plays");

    const before = await (await request.get("/api/library")).json();
    expect(before.leaderboard).toHaveLength(10);
    expect(Object.keys(before.leaderboard[0]).sort()).toEqual(["creatorName","description","id","playCount","revisionId","theme","title","updatedAt"]);
    expect(JSON.stringify(before)).not.toContain("PRIVATE");
    const first = games[0];
    for (let i = 0; i < 11; i++) await db.recordGameOpen(first.id, randomUUID());
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(ranking.getByRole("link").first()).toHaveAttribute("href", "/play/" + first.id + "/");
    await expect(ranking.locator(".leaderboard-count").first()).toHaveText("13 plays");
    const after = await (await request.get("/api/library")).json();
    expect(after.games.find((g: { id: string }) => g.id === first.id).updatedAt).toBe(before.games.find((g: { id: string }) => g.id === first.id).updatedAt);

    await db.unpublish(first.id);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(ranking.locator('a[href="/play/' + first.id + '/"]')).toHaveCount(0);
    const endpoint = "/api/play/" + first.id + "/open";
    const headers = { origin };
    expect((await request.post(endpoint, { headers, data: { visitorId: randomUUID() } })).status()).toBe(404);
    await db.select(first.id, first.currentRevisionId, "publish");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(ranking.locator(".leaderboard-count").first()).toHaveText("13 plays");
    expect((await request.post(endpoint, { headers: { origin: "https://other.example" }, data: { visitorId: randomUUID() } })).status()).toBe(403);
    expect((await request.post(endpoint, { data: { visitorId: randomUUID() } })).status()).toBe(403);
    expect((await request.post(endpoint, { headers, data: {} })).status()).toBe(400);
    expect((await request.post(endpoint, { headers, data: { visitorId: "invalid" } })).status()).toBe(400);
    expect((await request.post("/api/play/invalid/open", { headers, data: { visitorId: randomUUID() } })).status()).toBe(404);
    expect((await request.get(endpoint)).status()).toBe(405);

    const evidence = process.env.AGENT_DESK_EVIDENCE_DIR || path.join(os.tmpdir(), "pocket-base-evidence");
    await mkdir(evidence, { recursive: true });
    for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (viewport.width <= 760) expect((await ranking.getByRole("link").nth(1).boundingBox())!.height).toBeLessThan(120);
      await page.screenshot({ path: path.join(evidence, "leaderboard-" + viewport.width + ".png"), fullPage: true });
      await ranking.screenshot({ path: path.join(evidence, "leaderboard-ranking-" + viewport.width + ".png") });
    }
    await ranking.getByRole("link").first().focus();
    await expect(ranking.getByRole("link").first()).toBeFocused();

    await page.route("**/api/library?offset=0", route => route.fulfill({ json: { games: [], hasMore: false, leaderboard: [] } }));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(ranking.getByText("Play a game to start the leaderboard.")).toBeVisible();
  } finally { for (const game of games) await db.unpublish(game.id); }
});
