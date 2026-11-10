import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { DemoStore, DEMO_OWNER } from "../../src/lib/demo-store";
import { starters } from "../fixtures/games";

const coralLogo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#ef846a"/><circle cx="256" cy="256" r="140" fill="#fff7df"/><path d="m230 145 100 110-100 110-65-110z" fill="#633969"/></svg>';
const greenLogo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#58a98d"/><path d="m256 95 155 280H101z" fill="#fff7df"/><circle cx="256" cy="290" r="48" fill="#f6b867"/></svg>';

test("studio cards and publishing show saved logos, including for private games", async ({ page, request }) => {
  const db = new DemoStore(DEMO_OWNER, process.env.POCKET_BASE_E2E_DATA_DIR);
  const coral = await db.save({ ...starters[0], title: "Coral comet logo fixture", iconSvg: coralLogo, prompt: "Fictional coral logo" });
  const green = await db.save({ ...starters[0], title: "Green lantern logo fixture", iconSvg: greenLogo, prompt: "Fictional green logo" });
  const other = new DemoStore(randomUUID(), process.env.POCKET_BASE_E2E_DATA_DIR);
  const privateGame = await other.save({ ...starters[0], title: "Other owner's logo fixture", iconSvg: greenLogo, prompt: "PRIVATE fictional idea" });
  const iconURL = "/api/projects/" + coral.id + "/icon";
  const response = await request.get(iconURL);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const png = await response.body();
  expect((await sharp(png).metadata()).width).toBe(192);
  expect([...(await sharp(png).removeAlpha().raw().toBuffer()).subarray(0,3)]).toEqual([239,132,106]);
  expect((await request.get("/play/" + coral.id + "/icons/192.png")).status()).toBe(404);
  expect((await request.get("/api/projects/" + privateGame.id + "/icon")).status()).toBe(404);
  expect((await request.get("/api/projects/not-a-game/icon")).status()).toBe(404);
  expect((await request.get("http://127.0.0.1:3218" + iconURL)).status()).toBe(401);

  await page.goto("/");
  for (const game of [coral, green]) {
    const button = page.getByRole("button", { name: "Open " + game.title, exact: true });
    await button.scrollIntoViewIfNeeded();
    const image = button.locator("img");
    await expect(image).toHaveAttribute("src", "/api/projects/" + game.id + "/icon?revision=" + game.currentRevisionId);
    await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 192)).toBe(true);
    await expect(button.locator("svg")).toHaveCount(0);
  }
  const evidence = process.env.AGENT_DESK_EVIDENCE_DIR || path.join(os.tmpdir(), "pocket-base-evidence");
  await mkdir(evidence, { recursive: true });
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("region", { name: "Your games", exact: true }).screenshot({ path: path.join(evidence, "studio-logos-" + viewport.width + ".png") });
  }

  await page.getByRole("button", { name: "Edit " + coral.title, exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const logo = page.getByRole("dialog").locator(".share-art img");
  await expect(logo).toHaveAttribute("src", iconURL + "?revision=" + coral.currentRevisionId);
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 192)).toBe(true);
  await page.getByRole("button", { name: "Publish my game", exact: true }).click();
  await expect(page.getByRole("button", { name: "This version is live", exact: true })).toBeVisible();
  expect((await (await request.get("/play/" + coral.id + "/icons/192.png")).body()).equals(png)).toBe(true);

  const edited = await db.save({ ...starters[0], title: "Coral comet revised fixture", theme: "mint", iconSvg: greenLogo,
    projectId: coral.id, baseRevisionId: coral.currentRevisionId, prompt: "Fictional edit preserving the saved logo" });
  expect((await (await request.get(iconURL)).body()).equals(png)).toBe(true);
  expect((await (await request.get("/play/" + coral.id + "/icons/192.png")).body()).equals(png)).toBe(true);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open " + edited.title, exact: true }).locator("img"))
    .toHaveAttribute("src", iconURL + "?revision=" + edited.currentRevisionId);
  await db.unpublish(coral.id);
  expect((await request.get(iconURL)).status()).toBe(200);
  expect((await request.get("/play/" + coral.id + "/icons/192.png")).status()).toBe(404);
});
