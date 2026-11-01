import test from "node:test";
import assert from "node:assert/strict";
import { validateGame, parseGeneration } from "../src/lib/game";
import { starters, starterIds } from "../src/lib/starters";
import { gameManifest, playerDocument } from "../src/lib/pwa";
import { sandboxDocument } from "../public/sandbox.js";
import { demoAllowed } from "../src/lib/auth";
test("all five fictional starters contain syntactically valid, self-contained games", () => {
  for (const starter of starters) {
    const game = validateGame(starter);
    assert.equal(game.title, starter.title);
    assert.ok(game.html.includes("<script>"));
    assert.equal(game.html.includes("http-equiv"), false);
  }
});
test("model JSON fences are accepted and incomplete or invalid code is rejected", () => {
  const fence = String.fromCharCode(96).repeat(3);
  assert.equal(parseGeneration(fence + "json\n" + JSON.stringify(starters[0]) + "\n" + fence).title, "Star Catcher");
  assert.throws(() => parseGeneration("{"), /readable game/);
  assert.throws(() => validateGame({ ...starters[0], html: starters[0].html.replace("<script>", "<script>function( {") }), /code hiccup/);
  assert.throws(() => validateGame({ ...starters[0], html: starters[0].html.replace("<script>", '<script src="https://example.com/a.js">') }), /outside library/);
});
test("untrusted metadata, navigation attributes, and event handlers are removed", () => {
  const html = starters[0].html.replace("<head>", '<head><meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com">')
    .replace("<body>", '<body onload="alert(1)"><a href="https://example.com">go</a><iframe src="https://example.com"></iframe>');
  const game = validateGame({ ...starters[0], html });
  assert.equal(game.html.includes("http-equiv"), false);
  assert.equal(game.html.includes("onload="), false);
  assert.equal(game.html.includes("<iframe"), false);
  assert.equal(game.html.includes('href="https://'), false);
  const document = sandboxDocument(game.html, "example-channel");
  assert.ok(document.indexOf("Content-Security-Policy") < document.indexOf(game.html));
  assert.ok(document.includes("connect-src 'none'"));
  assert.ok(document.includes("worker-src 'none'"));
});
test("each game has its own stable PWA identity, scoped URL, icons, and escaped shell", () => {
  const game = { ...starters[0], id: starterIds[0], revisionId: "r1" };
  const a = gameManifest(game), b = gameManifest({ ...game, id: starterIds[1] });
  assert.notEqual(a.id, b.id);
  assert.equal(a.id, gameManifest({ ...game, revisionId: "r2" }).id);
  assert.equal(a.start_url, a.scope);
  assert.equal(a.display, "standalone");
  assert.ok(a.icons.some(icon => icon.sizes === "512x512"));
  const shell = playerDocument({ ...game, title: '</title><script>alert("bad")</script>' });
  assert.ok(shell.includes("&lt;/title&gt;"));
  assert.equal(shell.includes('alert("bad")'), false);
  assert.equal(shell.includes(game.html), false);
});
test("demo access requires explicit configuration, a loopback host, and no Vercel runtime", () => {
  const original = process.env.POCKET_BASE_DEMO, vercel = process.env.VERCEL;
  try {
    process.env.POCKET_BASE_DEMO = "true"; delete process.env.VERCEL;
    assert.equal(demoAllowed("127.0.0.1:3217"), true);
    assert.equal(demoAllowed("pocket.example"), false);
    assert.equal(demoAllowed("localhost.evil.example"), false);
    process.env.VERCEL = "1";
    assert.equal(demoAllowed("127.0.0.1:3217"), false);
  } finally {
    if (original === undefined) delete process.env.POCKET_BASE_DEMO; else process.env.POCKET_BASE_DEMO = original;
    if (vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = vercel;
  }
});
