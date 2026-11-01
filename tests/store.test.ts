import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DemoStore, DEMO_OWNER } from "../src/lib/demo-store";
import { starters } from "../src/lib/starters";
test("draft revisions, ownership, publish/restore, and stale writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pocket-store-test-"));
  try {
    const own = new DemoStore(DEMO_OWNER, dir);
    const other = new DemoStore("00000000-0000-4000-8000-000000000002", dir);
    const first = await own.save({ ...starters[0], prompt: "PRIVATE first prompt" });
    assert.equal(await other.detail(first.id), null);
    await assert.rejects(other.select(first.id, first.currentRevisionId, "publish"), /couldn't be found/);
    await assert.rejects(other.save({ ...starters[0], projectId: first.id, baseRevisionId: first.currentRevisionId, prompt: "steal" }), /couldn't be found/);
    assert.equal(await own.publicGame(first.id), null);
    await own.select(first.id, first.currentRevisionId, "publish");
    const next = await own.save({ ...starters[0], title: "Draft title", prompt: "PRIVATE draft", projectId: first.id, baseRevisionId: first.currentRevisionId });
    const publicGame = await other.publicGame(first.id);
    assert.equal(publicGame?.revisionId, first.currentRevisionId);
    assert.equal(publicGame?.title, first.title);
    assert.equal(JSON.stringify(publicGame).includes("PRIVATE"), false);
    await assert.rejects(own.save({ ...starters[0], projectId: first.id, baseRevisionId: first.currentRevisionId, prompt: "stale" }), /another tab/);
    const restored = await own.select(first.id, first.currentRevisionId, "restore");
    assert.equal(restored.revisions.length, 2);
    assert.equal(restored.publishedRevisionId, first.currentRevisionId);
    await own.select(first.id, next.currentRevisionId, "publish");
    assert.equal((await other.publicGame(first.id))?.title, "Draft title");
    await own.unpublish(first.id);
    assert.equal(await other.publicGame(first.id), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
