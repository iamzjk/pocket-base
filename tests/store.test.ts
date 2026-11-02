import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DemoStore, DEMO_OWNER } from "../src/lib/demo-store";
import { starters } from "./fixtures/games";
test("draft revisions, ownership, publish/restore, and stale writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pocket-store-test-"));
  try {
    const own = new DemoStore(DEMO_OWNER, dir);
    const other = new DemoStore("00000000-0000-4000-8000-000000000002", dir);
    assert.deepEqual(await own.list(), []);
    assert.deepEqual(await own.publishedGames(), { games: [], hasMore: false });
    const first = await own.save({ ...starters[0], iconSvg: "fictional-original-icon", prompt: "PRIVATE first prompt" });
    assert.equal(await other.detail(first.id), null);
    await assert.rejects(other.select(first.id, first.currentRevisionId, "publish"), /couldn't be found/);
    await assert.rejects(other.save({ ...starters[0], projectId: first.id, baseRevisionId: first.currentRevisionId, prompt: "steal" }), /couldn't be found/);
    assert.equal(await own.publicGame(first.id), null);
    await own.select(first.id, first.currentRevisionId, "publish");
    const next = await own.save({ ...starters[0], title: "Draft title", iconSvg: "fictional-new-icon", prompt: "PRIVATE draft", projectId: first.id, baseRevisionId: first.currentRevisionId });
    assert.equal(next.revisions.find(r=>r.id===next.currentRevisionId)?.iconSvg,"fictional-original-icon");
    const publicGame = await other.publicGame(first.id);
    assert.equal(publicGame?.revisionId, first.currentRevisionId);
    assert.equal(publicGame?.title, first.title);
    assert.equal(JSON.stringify(publicGame).includes("PRIVATE"), false);
    assert.deepEqual((await other.publishedGames()).games, [{ id: first.id, revisionId: first.currentRevisionId, title: first.title, description: first.description, theme: first.theme }]);
    await assert.rejects(own.save({ ...starters[0], projectId: first.id, baseRevisionId: first.currentRevisionId, prompt: "stale" }), /another tab/);
    const restored = await own.select(first.id, first.currentRevisionId, "restore");
    assert.equal(restored.revisions.length, 2);
    assert.equal(restored.publishedRevisionId, first.currentRevisionId);
    await own.select(first.id, next.currentRevisionId, "publish");
    assert.equal((await other.publicGame(first.id))?.title, "Draft title");
    await own.unpublish(first.id);
    assert.equal(await other.publicGame(first.id), null);
    assert.deepEqual(await own.publishedGames(), { games: [], hasMore: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the shared library lists published revisions from all owners and paginates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pocket-library-test-"));
  try {
    const own = new DemoStore(DEMO_OWNER, directory), other = new DemoStore("00000000-0000-4000-8000-000000000002", directory);
    const ids: string[] = [];
    for (let i=0;i<25;i++) {
      const creator = i % 2 ? own : other;
      const game = await creator.save({ ...starters[0], title: "Published fixture " + i, prompt: "PRIVATE fixture prompt" });
      await creator.select(game.id, game.currentRevisionId, "publish"); ids.push(game.id);
      await creator.save({ ...starters[0], title: "PRIVATE draft title", projectId: game.id, baseRevisionId: game.currentRevisionId, prompt: "PRIVATE edit" });
    }
    await other.save({ ...starters[0], title: "PRIVATE unpublished game", prompt: "PRIVATE" });
    const first = await own.publishedGames(), second = await own.publishedGames(first.games.length);
    assert.equal(first.games.length, 24); assert.equal(first.hasMore, true);
    assert.equal(second.games.length, 1); assert.equal(second.hasMore, false);
    assert.deepEqual([...first.games,...second.games].map(g=>g.id).sort(), ids.sort());
    assert.equal(JSON.stringify([first,second]).includes("PRIVATE"), false);
    assert.deepEqual(Object.keys(first.games[0]).sort(), ["description","id","revisionId","theme","title"]);
    assert.ok((await own.list()).every(g => g.ownerId === DEMO_OWNER));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
