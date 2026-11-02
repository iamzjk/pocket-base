import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { sanitizeIconSvg, fallbackIconSvg } from "../src/lib/icon";
import { validateGame } from "../src/lib/game";
import { starters } from "./fixtures/games";

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
