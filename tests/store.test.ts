import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { DemoStore, DEMO_OWNER } from "../src/lib/demo-store";
import { classicListings } from "../src/lib/classic-games";
import { starters } from "./fixtures/games";
const emptyLibrary = { games: classicListings.map(game => ({ ...game, playCount: 0 })), hasMore: false, leaderboard: [] };
test("draft revisions, ownership, publish/restore, and stale writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pocket-store-test-"));
  try {
    const own = new DemoStore(DEMO_OWNER, dir);
    const other = new DemoStore("00000000-0000-4000-8000-000000000002", dir);
    assert.deepEqual(await own.list(), []);
    assert.deepEqual(await own.publishedGames(), emptyLibrary);
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
    const listed = (await other.publishedGames()).games.find(g=>g.id===first.id)!;
    assert.equal(listed.revisionId, first.currentRevisionId);
    assert.equal(listed.creatorName, "Local creator");
    assert.ok(listed.updatedAt);
    await assert.rejects(own.save({ ...starters[0], projectId: first.id, baseRevisionId: first.currentRevisionId, prompt: "stale" }), /another tab/);
    const restored = await own.select(first.id, first.currentRevisionId, "restore");
    assert.equal(restored.revisions.length, 2);
    assert.equal(restored.publishedRevisionId, first.currentRevisionId);
    await own.select(first.id, next.currentRevisionId, "publish");
    assert.equal((await other.publicGame(first.id))?.title, "Draft title");
    await own.unpublish(first.id);
    assert.equal(await other.publicGame(first.id), null);
    assert.deepEqual(await own.publishedGames(), emptyLibrary);
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
    assert.equal(second.games.length, 6); assert.equal(second.hasMore, false);
    assert.deepEqual([...first.games,...second.games].map(g=>g.id).sort(), [...ids,...classicListings.map(g=>g.id)].sort());
    assert.equal(JSON.stringify([first,second]).includes("PRIVATE"), false);
    assert.deepEqual(Object.keys(first.games[0]).sort(), ["creatorName","description","id","playCount","revisionId","theme","title","updatedAt"]);
    assert.ok((await own.list()).every(g => g.ownerId === DEMO_OWNER));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("local search filters public titles, descriptions and creators before pagination", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pocket-search-test-"));
  try {
    const own = new DemoStore(DEMO_OWNER, directory), other = new DemoStore(randomUUID(), directory);
    await other.saveProfile("Meadow maker");
    const games = [];
    for (let i = 0; i < 25; i++) {
      const game = await other.save({ ...starters[0], title: "Meadow search fixture " + i + (i === 0 ? " Dodge" : ""),
        description: "A 100% turtle_underwater adventure", prompt: "PRIVATE prompt needle" });
      await other.select(game.id, game.currentRevisionId, "publish"); games.push(game);
    }
    const first = games[0];
    const edit = await other.save({ ...starters[0], title: "PRIVATE draft needle", projectId: first.id,
      baseRevisionId: first.currentRevisionId, prompt: "PRIVATE edit" });
    await other.save({ ...starters[0], title: "PRIVATE unpublished needle", prompt: "PRIVATE" });
    const file = path.join(directory, "demo.json"), state = JSON.parse(await readFile(file, "utf8"));
    state.projects.find((p: { id: string }) => p.id === first.id).publishedAt = "2000-01-01T00:00:00.000Z";
    await writeFile(file, JSON.stringify(state));
    assert.equal((await own.publishedGames()).games.some(g => g.id === first.id), false);
    const result = await own.publishedGames(0, "  MEADOW SEARCH FIXTURE 0  ");
    assert.deepEqual(result.games.map(g => g.id), [first.id]);
    assert.deepEqual((await own.publishedGames(0, "dOd")).games.map(g => g.id), [first.id]);
    assert.equal(result.games[0].revisionId, first.currentRevisionId);
    for (const query of ["Meadow maker", "100%", "turtle_underwater"]) {
      const page = await own.publishedGames(0, query), more = await own.publishedGames(24, query);
      assert.equal(page.games.length, 24); assert.equal(page.hasMore, true);
      assert.equal(more.games.length, 1); assert.equal(more.hasMore, false);
      assert.equal(new Set([...page.games,...more.games].map(g => g.id)).size, 25);
    }
    for (const query of ["PRIVATE", "PocketBase.load", DEMO_OWNER, "missing needle", "turtle%", "turtleXunderwater"])
      assert.deepEqual((await own.publishedGames(0, query)).games, []);
    assert.equal((await own.publishedGames(0, "Pocket Base")).games.length, 5);
    await assert.rejects(own.publishedGames(0, "a".repeat(201)), /up to 200/);
    await other.select(first.id, edit.currentRevisionId, "publish");
    assert.deepEqual((await own.publishedGames(0, "Meadow search fixture 0")).games, []);
    assert.deepEqual((await own.publishedGames(0, "PRIVATE draft needle")).games.map(g => g.id), [first.id]);
    await other.unpublish(first.id);
    assert.deepEqual((await own.publishedGames(0, "PRIVATE draft needle")).games, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("local opens deduplicate atomically, expire, and survive revisions and unpublishing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pocket-plays-test-"));
  try {
    const own = new DemoStore(DEMO_OWNER, directory), other = new DemoStore(randomUUID(), directory);
    const game = await own.save({ ...starters[0], prompt: "PRIVATE idea" });
    const visitor = randomUUID();
    await assert.rejects(other.recordGameOpen(game.id, visitor), /isn't published/);
    await assert.rejects(other.recordGameOpen(randomUUID(), visitor), /isn't published/);
    await own.select(game.id, game.currentRevisionId, "publish");
    const listing = async () => (await own.publishedGames()).games.find(g => g.id === game.id)!;
    const publishedAt = (await listing()).updatedAt;
    await Promise.all(Array.from({ length: 8 }, () => other.recordGameOpen(game.id, visitor)));
    assert.equal((await listing()).playCount, 1);
    await other.recordGameOpen(game.id, randomUUID());
    await other.recordGameOpen(classicListings[0].id, visitor);
    assert.equal((await listing()).playCount, 2);
    assert.equal((await listing()).updatedAt, publishedAt);

    const file = path.join(directory, "demo.json");
    const state = JSON.parse(await readFile(file, "utf8"));
    for (const visit of state.playVisitors) visit.countedAt -= 30 * 60_000;
    await writeFile(file, JSON.stringify(state));
    await other.recordGameOpen(game.id, visitor);
    assert.equal((await listing()).playCount, 3);
    const expired = JSON.parse(await readFile(file, "utf8"));
    assert.equal(expired.playVisitors.length, 1);
    const edit = await own.save({ ...starters[0], title: "PRIVATE new title", projectId: game.id, baseRevisionId: game.currentRevisionId, prompt: "PRIVATE edit" });
    assert.equal((await listing()).title, game.title);
    assert.equal((await listing()).playCount, 3);
    await own.select(game.id, edit.currentRevisionId, "publish");
    assert.equal((await listing()).playCount, 3);
    await own.unpublish(game.id);
    assert.equal((await other.publishedGames()).leaderboard.some(g => g.id === game.id), false);
    await assert.rejects(other.recordGameOpen(game.id, randomUUID()), /isn't published/);
    await own.select(game.id, game.currentRevisionId, "publish");
    assert.equal((await listing()).playCount, 3);
    assert.equal(JSON.stringify(await other.publishedGames()).includes("PRIVATE"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("local top ten ranks all published games beyond the requested page with deterministic ties", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pocket-ranking-test-"));
  try {
    const db = new DemoStore(DEMO_OWNER, directory);
    const classic = classicListings[0];
    await db.recordGameOpen(classic.id, randomUUID());
    await db.recordGameOpen(classic.id, randomUUID());
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const game = await db.save({ ...starters[0], title: "Ranking fixture " + i, prompt: "PRIVATE" });
      await db.select(game.id, game.currentRevisionId, "publish");
      await db.recordGameOpen(game.id, randomUUID());
      ids.push(game.id);
    }
    const file = path.join(directory, "demo.json");
    const state = JSON.parse(await readFile(file, "utf8"));
    state.projects.forEach((p: { publishedAt: string }) => { p.publishedAt = "2099-01-01T00:00:00.000Z"; });
    await writeFile(file, JSON.stringify(state));
    const page = await db.publishedGames();
    assert.equal(page.games.length, 24);
    assert.equal(page.hasMore, true);
    assert.equal(page.games.some(g => g.id === classic.id), false);
    assert.deepEqual(page.leaderboard.map(g => g.id), [classic.id, ...ids.sort().slice(0,9)]);
    assert.deepEqual((await db.publishedGames(24)).leaderboard, page.leaderboard);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("local public names and publication dates track only public changes",async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"pocket-profile-test-"));
  try {
    const store=new DemoStore(DEMO_OWNER,directory);
    const first=await store.save({...starters[0],prompt:"PRIVATE"});
    await store.select(first.id,first.currentRevisionId,"publish");
    const listing=async()=>(await store.publishedGames()).games.find(g=>g.id===first.id)!;
    const before=await listing();
    const edit=await store.save({...starters[0],title:"PRIVATE edit",projectId:first.id,baseRevisionId:first.currentRevisionId,prompt:"PRIVATE"});
    await store.select(first.id,first.currentRevisionId,"restore");
    await store.select(first.id,first.currentRevisionId,"publish");
    await store.saveProfile(" New public name ");
    assert.deepEqual(await store.profile(),{displayName:"New public name"});
    assert.equal((await listing()).updatedAt,before.updatedAt);
    assert.equal((await listing()).creatorName,"New public name");
    assert.equal((await listing()).title,before.title);
    await assert.rejects(store.saveProfile("<bad>"),/public name/);
    await store.select(first.id,edit.currentRevisionId,"publish");
    assert.notEqual((await listing()).updatedAt,before.updatedAt);
  } finally {await rm(directory,{recursive:true,force:true});}
});
