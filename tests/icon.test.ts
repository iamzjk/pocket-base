import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { sanitizeIconSvg, fallbackIconSvg } from "../src/lib/icon";
import { validateGame } from "../src/lib/game";
import { starters } from "./fixtures/games";
import { renderIconPng } from "../src/lib/icon-png";
import { SupabaseStore } from "../src/lib/supabase-store";
import { createClient } from "@supabase/supabase-js";

const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#ff3366"/><circle cx="256" cy="256" r="100" fill="#fff"/></svg>';
test("safe SVG icons render as correctly sized PNGs and invalid icons fall back", async () => {
  const clean = sanitizeIconSvg(icon);
  assert.ok(clean);
  for (const size of [180,192,512]) {
    const png: Buffer = await sharp(Buffer.from(clean)).resize(size).png().toBuffer();
    const meta: { width?: number; height?: number } = await sharp(png).metadata(); assert.equal(meta.width,size); assert.equal(meta.height,size);
  }
  const generated = validateGame({ ...starters[0], iconSvg: icon });
  assert.equal(generated.iconSvg, clean);
  assert.ok(sanitizeIconSvg(fallbackIconSvg('A <dangerous> title','mint')));
  assert.ok(sanitizeIconSvg(validateGame({ ...starters[0], iconSvg: '<svg><script>bad()</script></svg>' }).iconSvg));
});
test("SVG icons cannot load outside resources, execute code, or inject HTML/CSS", () => {
  for (const content of [
    '<script>alert(1)</script>', '<foreignObject><div>bad</div></foreignObject>',
    '<image href="https://example.test/a.png"/>', '<use href="file:///etc/passwd"/>',
    '<style>rect{fill:url(https://example.test)}</style>', '<rect style="fill:red"/>',
    '<rect onload="alert(1)"/>', '<rect fill="url(https://example.test)"/>',
    '<rect fill="u\\72l(\\68ttp://example.test)"/>', '<animate attributeName="fill"/>',
  ]) assert.equal(sanitizeIconSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'+content+'</svg>'),null);
  assert.equal(sanitizeIconSvg(icon.repeat(2)),null);
  assert.equal(sanitizeIconSvg(icon.replace('0 0 512 512','0 0 999999 512')),null);
  assert.equal(sanitizeIconSvg('<!DOCTYPE svg>'+icon),null);
  assert.equal(sanitizeIconSvg('x'.repeat(30001)),null);
});

test("PNG thumbnails use the saved logo and safely fall back for absent or unsafe SVG", async () => {
  const game = { title: "Fictional logo fixture", theme: "mint" as const, iconSvg: icon };
  const png = await renderIconPng(game, 192);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 192); assert.equal(metadata.height, 192);
  const pixels = await sharp(png).removeAlpha().raw().toBuffer();
  assert.deepEqual([...pixels.subarray(0,3)], [255,51,102]);
  const fallback = await renderIconPng({ ...game, iconSvg: null }, 192);
  assert.equal(png.equals(fallback), false);
  const unsafe = await renderIconPng({ ...game, iconSvg: '<svg><script>alert(1)</script></svg>' }, 192);
  assert.equal(unsafe.equals(fallback), true);
});

test("Supabase studio thumbnails read only the current revision's logo metadata under RLS", async () => {
  const id = "60000000-0000-4000-8000-000000000001", revision = "60000000-0000-4000-8000-000000000002";
  const calls: URL[] = [];
  let visible = true;
  const client = createClient("https://fictional.supabase.test", "fictional-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input)); calls.push(url);
      if (url.pathname.endsWith("/projects")) return Response.json(visible ? { current_revision_id: revision } : null);
      assert.equal(url.pathname, "/rest/v1/revisions");
      return Response.json({ title: "Fictional current draft", theme: "mint", icon_svg: icon });
    } },
  });
  const store = new SupabaseStore(client);
  assert.deepEqual(await store.projectIcon(id), { title: "Fictional current draft", theme: "mint", iconSvg: icon });
  assert.equal(calls[0].searchParams.get("select"), "current_revision_id");
  assert.equal(calls[0].searchParams.get("id"), "eq." + id);
  assert.equal(calls[1].searchParams.get("select"), "title,theme,icon_svg");
  assert.equal(calls[1].searchParams.get("id"), "eq." + revision);
  assert.equal(calls[1].searchParams.get("project_id"), "eq." + id);
  visible = false; calls.length = 0;
  assert.equal(await store.projectIcon(id), null);
  assert.equal(calls.length, 1);
});
