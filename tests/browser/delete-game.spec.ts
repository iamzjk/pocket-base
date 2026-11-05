import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DemoStore, DEMO_OWNER } from "../../src/lib/demo-store";
import { classicListings } from "../../src/lib/classic-games";
import { starters } from "../fixtures/games";

for (const width of [320, 390, 1440]) for (const published of [false, true]) {
  test(`owners can cancel and confirm deletion of a ${published ? "published game" : "draft"} at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const db = new DemoStore(DEMO_OWNER, process.env.POCKET_BASE_E2E_DATA_DIR);
    const first = await db.save({ ...starters[0], title: `Fictional deletion ${width} ${published ? "published" : "draft"}`, prompt: "PRIVATE fictional idea" });
    if (published) await db.select(first.id, first.currentRevisionId, "publish");
    const edited = await db.save({ ...starters[0], title: first.title, projectId: first.id,
      baseRevisionId: first.currentRevisionId, prompt: "PRIVATE fictional edit" });
    await page.goto("/?game=" + first.id);
    await expect(page.getByRole("button", { name: "Game options", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Game options", exact: true }).click();
    await page.getByRole("button", { name: "Delete game", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this game?", exact: true });
    await expect(dialog).toContainText(first.title);
    await expect(dialog).toContainText("all its saved versions");
    await expect(dialog).toContainText("cannot be undone");
    await expect(dialog).toContainText("offline");
    await expect(dialog.getByRole("button", { name: "Keep game", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect((await db.detail(first.id))?.revisions).toHaveLength(2);
    await page.getByRole("button", { name: "Game options", exact: true }).click();
    await page.getByRole("button", { name: "Delete game", exact: true }).click();
    await dialog.getByRole("button", { name: "Keep game", exact: true }).click();
    expect((await db.detail(first.id))?.currentRevisionId).toBe(edited.currentRevisionId);
    expect((await request.get("/play/" + first.id + "/game.json")).status()).toBe(published ? 200 : 404);
    await page.getByRole("button", { name: "Game options", exact: true }).click();
    await page.getByRole("button", { name: "Delete game", exact: true }).click();
    const evidence = process.env.AGENT_DESK_EVIDENCE_DIR || path.join(os.tmpdir(), "pocket-base-evidence");
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, `delete-${width}-${published ? "published" : "draft"}.png`) });
    if (width === 1440 && published) {
      const endpoint = "**/api/projects/" + first.id;
      await page.route(endpoint, route => route.request().method() === "DELETE"
        ? route.fulfill({ status: 503, json: { error: "Fictional deletion failed. Try again." } }) : route.continue());
      await dialog.getByRole("button", { name: "Delete game", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("Fictional deletion failed");
      expect((await db.detail(first.id))?.revisions).toHaveLength(2);
      await page.unroute(endpoint);
    }
    await dialog.getByRole("button", { name: "Delete game", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL("http://127.0.0.1:3217/");
    await expect(page.getByRole("heading", { name: "Your little worlds" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open " + first.title, exact: true })).toHaveCount(0);
    expect(await db.detail(first.id)).toBe(null);
    for (const endpoint of ["/api/projects/" + first.id, "/api/projects/" + first.id + "/icon",
      "/play/" + first.id + "/", "/play/" + first.id + "/game.json", "/play/" + first.id + "/icons/192.png"]) {
      expect((await request.get(endpoint)).status()).toBe(404);
    }
    const library = await (await request.get("/api/library?q=" + encodeURIComponent(first.title))).json();
    expect(library.games).toHaveLength(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Open " + first.title, exact: true })).toHaveCount(0);
  });
}

test("delete API rejects missing sessions, foreign origins, other owners and catalog games", async ({ request }) => {
  const own = new DemoStore(DEMO_OWNER, process.env.POCKET_BASE_E2E_DATA_DIR);
  const other = new DemoStore(randomUUID(), process.env.POCKET_BASE_E2E_DATA_DIR);
  const game = await own.save({ ...starters[0], prompt: "Fictional owned deletion fixture" });
  const foreign = await other.save({ ...starters[0], prompt: "PRIVATE other owner" });
  const endpoint = "/api/projects/" + game.id;
  const origin = "http://127.0.0.1:3217";
  expect((await request.delete(endpoint, { data: {} })).status()).toBe(403);
  expect((await request.delete(endpoint, { headers: { origin: "https://other.example" }, data: {} })).status()).toBe(403);
  expect((await request.delete("http://127.0.0.1:3218" + endpoint, {
    headers: { origin: "http://127.0.0.1:3218" }, data: {},
  })).status()).toBe(401);
  for (const id of [foreign.id, classicListings[0].id, randomUUID(), "not-a-game"])
    expect((await request.delete("/api/projects/" + id, { headers: { origin }, data: {} })).status()).toBe(404);
  expect(await own.detail(game.id)).not.toBe(null);
  expect(await other.detail(foreign.id)).not.toBe(null);
  expect((await request.delete(endpoint, { headers: { origin }, data: {} })).status()).toBe(200);
  expect((await request.delete(endpoint, { headers: { origin }, data: {} })).status()).toBe(404);
});
