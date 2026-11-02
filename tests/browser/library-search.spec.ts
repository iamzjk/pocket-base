import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DemoStore } from "../../src/lib/demo-store";
import { starters } from "../fixtures/games";

test("library search finds partial words across all pages and tracks public revisions", async ({ page, request }) => {
  const db = new DemoStore(randomUUID(), process.env.POCKET_BASE_E2E_DATA_DIR);
  await db.saveProfile("Fictional Grove Maker");
  const games = [];
  try {
    for (let i = 0; i < 26; i++) {
      const game = await db.save({ ...starters[0], title: "Search grove fixture " + (i === 0 ? "Dodge" : i),
        description: i === 0 ? "Sail the whispering tide." : "A fictional woodland adventure.", prompt: "PRIVATE search prompt needle" });
      await db.select(game.id, game.currentRevisionId, "publish"); games.push(game);
    }
    const first = games[0];
    const edit = await db.save({ ...starters[0], title: "PRIVATE search draft needle", description: "PRIVATE draft description needle",
      projectId: first.id, baseRevisionId: first.currentRevisionId, prompt: "PRIVATE search edit" });
    await db.save({ ...starters[0], title: "PRIVATE search unpublished needle", prompt: "PRIVATE idea" });

    const initial = await (await request.get("/api/library")).json();
    expect(initial.games.some((game: { id: string }) => game.id === first.id)).toBe(false);
    await page.goto("/library");
    const search = page.getByRole("searchbox", { name: "Search games", exact: true });
    await search.fill("dOd");
    const card = page.locator('.published-card[href="/play/' + first.id + '/"]');
    await expect(card).toBeVisible();
    await expect(page.locator(".published-card")).toHaveCount(1);
    await expect(page.getByRole("status")).toHaveText("1 game found");
    await expect(page.getByRole("region", { name: "Most played", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Recently updated", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Search results", exact: true })).toBeVisible();

    const evidence = process.env.AGENT_DESK_EVIDENCE_DIR || path.join(os.tmpdir(), "pocket-base-evidence");
    await mkdir(evidence, { recursive: true });
    for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(search).toBeVisible();
      await page.screenshot({ path: path.join(evidence, "library-search-" + viewport.width + ".png"), fullPage: true });
    }
    await search.fill("  WHISPERING TID  ");
    await expect(card).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("1 game found");
    await search.fill("fictional grove mak");
    await expect(page.locator(".published-card")).toHaveCount(24);
    await expect(page.getByRole("status")).toHaveText("24+ games found");
    await page.getByRole("button", { name: "Show more games", exact: true }).click();
    await expect(page.locator(".published-card")).toHaveCount(26);
    await expect(page.getByRole("status")).toHaveText("26 games found");
    expect(await page.locator(".published-card").evaluateAll(cards => new Set(cards.map(card => card.getAttribute("href"))).size)).toBe(26);
    await expect(page.getByRole("button", { name: "Show more games", exact: true })).toHaveCount(0);

    for (const query of ["PRIVATE search", "PRIVATE draft description", "missing search needle"]) {
      await search.fill(query);
      await expect(page.getByText("No games found", { exact: true })).toBeVisible();
      await expect(page.locator(".published-card")).toHaveCount(0);
    }
    for (const query of ["a".repeat(201), "bad\u0000query", "bad\nquery"])
      expect((await request.get("/api/library?q=" + encodeURIComponent(query))).status()).toBe(400);
    const api = await (await request.get("/api/library?q=dod")).json();
    expect(api.games.map((game: { id: string }) => game.id)).toEqual([first.id]);
    expect(Object.keys(api.games[0]).sort()).toEqual(["creatorName","description","id","playCount","revisionId","theme","title","updatedAt"]);
    expect(JSON.stringify(api.games)).not.toContain("PRIVATE");

    await search.fill("dod");
    await expect(card).toBeVisible();
    await db.select(first.id, edit.currentRevisionId, "publish");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("No games found", { exact: true })).toBeVisible();
    await search.fill("draft needle");
    await expect(card).toBeVisible();
    await db.unpublish(first.id);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("No games found", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("region", { name: "Most played", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recently updated", exact: true })).toBeVisible();
    await expect(page.locator(".published-card")).toHaveCount(24);

    await search.fill("grove fixture 1");
    await expect(page.getByRole("status")).toHaveText("11 games found");
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(page.locator(".published-card")).toHaveCount(24);
    await search.fill("grove fixture 25");
    await expect(page.locator(".published-card")).toHaveCount(1);
    await page.locator(".published-card").click();
    await expect(page.frameLocator("iframe").getByRole("heading", { name: "Star Catcher" })).toBeVisible();
    await page.goBack();
    await expect(search).toBeVisible();
  } finally { for (const game of games) await db.unpublish(game.id); }
});

test("new queries and clearing ignore older requests and search recovers from failures", async ({ page }) => {
  let startOld!: () => void, releaseOld!: () => void, finishOld!: () => void;
  const oldStarted = new Promise<void>(resolve => { startOld = resolve; });
  const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
  const oldFinished = new Promise<void>(resolve => { finishOld = resolve; });
  const game = { id: "60000000-0000-4000-8000-000000000004", revisionId: "60000000-0000-4000-8000-000000000005",
    title: "Latest search fixture", description: "Fictional search result", theme: "mint", creatorName: "Fictional creator", updatedAt: "2026-01-01T00:00:00Z", playCount: 0 };
  let fail = true;
  await page.route("**/api/library?**", async route => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "older") {
      startOld(); await oldGate;
      await route.fulfill({ json: { games: [{ ...game, title: "Stale search fixture" }], hasMore: true, leaderboard: [] } });
      finishOld(); return;
    }
    if (query === "failure" && fail) return route.fulfill({ status: 503, json: { error: "Fictional search connection failure." } });
    await route.fulfill({ json: { games: [game], hasMore: false, leaderboard: [] } });
  });
  try {
    await page.goto("/library");
    const search = page.getByRole("searchbox", { name: "Search games", exact: true });
    await search.fill("older");
    await oldStarted;
    await search.fill("latest");
    await expect(page.getByRole("link", { name: "Play Latest search fixture", exact: true })).toBeVisible();
    releaseOld(); await oldFinished;
    await expect(page.getByRole("link", { name: "Play Stale search fixture", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Play Latest search fixture", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show more games", exact: true })).toHaveCount(0);
    await search.fill("failure");
    const library = page.getByRole("region", { name: "Game library", exact: true });
    await expect(library.getByRole("alert")).toHaveText("Fictional search connection failure.");
    await expect(page.locator(".published-card")).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(library.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Play Latest search fixture", exact: true })).toBeVisible();
    await search.fill("older");
    await search.fill("");
    await expect(page.getByRole("region", { name: "Most played", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Play Stale search fixture", exact: true })).toHaveCount(0);
  } finally { releaseOld(); }
});
