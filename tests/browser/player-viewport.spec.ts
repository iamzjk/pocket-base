import { test, expect, type Page } from "@playwright/test";
import { DemoStore, DEMO_OWNER } from "../../src/lib/demo-store";

const html = `<!doctype html><html><head><style>
html,body{overscroll-behavior:auto;overflow:auto}
html::after{content:"";position:absolute;left:calc(100% + 200px);top:0;width:200px;height:200px}
body{margin:0;padding:12px;display:flex;flex-direction:column;gap:8px;background:#211c34;color:white;font:16px system-ui}
h1{font-size:18px;margin:0}canvas{display:block;width:100%;flex:1;min-height:60px;background:#8054db}
#menu{height:96px;flex-shrink:0;overflow:auto;background:#30213f}#menu p{margin:0;padding:12px}
button{min-height:44px;flex-shrink:0;font:inherit}
</style></head><body><h1>Touch viewport fixture</h1><canvas aria-label="Drawing surface"></canvas>
<div id="menu" aria-label="Scrollable game menu">${Array.from({ length: 14 }, (_, i) => `<p>Menu option ${i + 1}</p>`).join("")}</div>
<button id="tap">Tapped 0</button><script>
let taps=0;document.getElementById('tap').addEventListener('click',e=>e.target.textContent='Tapped '+(++taps));
window.moves=0;window.cancelled=0;
const canvas=document.querySelector('canvas');
canvas.addEventListener('pointerdown',e=>canvas.setPointerCapture(e.pointerId));
canvas.addEventListener('pointermove',()=>window.moves++);
canvas.addEventListener('pointercancel',()=>window.cancelled++);
</script></body></html>`;

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    for (let step = 1; step <= 12; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
        x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12,
      }] });
      await page.waitForTimeout(16);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await session.detach(); }
}

test("phone game windows stay fixed during drags while drawing and menus work online and offline", async ({ browser }) => {
  const db = new DemoStore(DEMO_OWNER, process.env.POCKET_BASE_E2E_DATA_DIR);
  const game = await db.save({ title: "Touch viewport fixture", description: "Fictional gesture regression game.", theme: "lilac", html, prompt: "Fictional touch fixture." });
  await db.select(game.id, game.currentRevisionId, "publish");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    async function gestures() {
      const frame = page.frameLocator("iframe");
      await expect(frame.getByRole("heading", { name: "Touch viewport fixture" })).toBeVisible();
      const before = await page.locator("iframe").boundingBox();
      const canvas = await frame.getByLabel("Drawing surface").boundingBox();
      const x = canvas!.x + canvas!.width / 2, y = canvas!.y + canvas!.height / 2;
      // Both axes used to pan an overflowing document and cancel game drags.
      await drag(page, { x, y }, { x: x - 90, y });
      await drag(page, { x, y }, { x, y: y + Math.min(60, canvas!.height / 3) });
      expect(await page.locator("iframe").boundingBox()).toEqual(before);
      expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
      const gameFrame = page.frames().find(f => f.parentFrame())!;
      expect(await gameFrame.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
      expect(await gameFrame.evaluate(() => (window as any).moves)).toBeGreaterThan(10);
      expect(await gameFrame.evaluate(() => (window as any).cancelled)).toBe(0);
      const menu = frame.getByLabel("Scrollable game menu");
      const bounds = await menu.boundingBox();
      await drag(page, { x: bounds!.x + 40, y: bounds!.y + 80 }, { x: bounds!.x + 40, y: bounds!.y + 15 });
      await expect.poll(() => menu.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
      // Swiping past a menu boundary must not move the game document.
      await menu.evaluate(e => { e.scrollTop = 0; });
      await drag(page, { x: bounds!.x + 40, y: bounds!.y + 15 }, { x: bounds!.x + 40, y: bounds!.y + 80 });
      expect(await gameFrame.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
      expect(await page.locator("iframe").boundingBox()).toEqual(before);
      await frame.getByRole("button").tap();
      await expect(frame.getByRole("button")).toHaveText(/Tapped [1-9]/);
      const size = page.viewportSize()!;
      expect(before!.y).toBeGreaterThanOrEqual(0);
      expect(before!.y + before!.height).toBeLessThanOrEqual(size.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto("http://127.0.0.1:3217/?game=" + game.id);
    await gestures();
    await page.getByRole("button", { name: "Back to My studio" }).tap();
    // Leaving the fixed editor restores normal library/studio scrolling.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.goto("http://127.0.0.1:3217/play/" + game.id + "/");
    await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
    await gestures();
    await page.setViewportSize({ width: 844, height: 390 });
    await gestures();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText("Playing offline", { exact: true })).toBeVisible();
    await gestures();
  } finally { await context.close(); }
});
