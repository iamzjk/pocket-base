import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { classicGames } from "../src/lib/classic-games";
import { validateGame } from "../src/lib/game";
import type { GameLibrary } from "../src/lib/types";

const owners = ["00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012"];
async function migration(db: PGlite, file: string) {
  await db.exec(await readFile(new URL("../supabase/migrations/"+file, import.meta.url), "utf8"));
}
async function bootstrap(db: PGlite) {
  await db.exec("create role anon; create role authenticated; create role supabase_auth_admin; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated;");
  for (const [i,id] of owners.entries()) await db.query("insert into auth.users(id,email) values($1,$2)",[id,i ? "other@example.org" : "family+studio@gmail.com"]);
  for (const file of ["001_studio.sql","002_migration_readiness.sql","003_published_game_library.sql","004_game_icons_and_size.sql"]) await migration(db,file);
}
async function asUser(db: PGlite, id: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || ""]);
  await db.exec(id ? "set role authenticated" : "set role anon");
}

test("release migrations restore originals, preserve published dates, and expose only public names", async t => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await asUser(db,owners[0]);
    type Saved = { id: string; current_revision_id: string; published_at: string | null };
    async function save(id: string | null = null, base: string | null = null, title="Public fixture") {
      return (await db.query<{ g: Saved }>("select public.save_game($1,$2,$3,'Description','mint',$4,'PRIVATE prompt') g",[id,base,title,classicGames[0].html])).rows[0].g;
    }
    const legacy = await save();
    await db.query("select public.select_revision($1,$2,'publish')",[legacy.id,legacy.current_revision_id]);
    await db.exec("reset role");
    await db.query("update public.revisions set created_at='2026-01-01T00:00:00Z' where id=$1",[legacy.current_revision_id]);
    await db.query("update public.projects set updated_at='2026-10-01T00:00:00Z' where id=$1",[legacy.id]);
    for (const file of ["005_library_profiles.sql","006_signup_protection.sql","007_classic_games.sql","008_longer_prompts.sql","009_game_play_counts.sql","010_library_search.sql"]) await migration(db,file);
    const page = async (offset=0,limit=24) => (await db.query<{ l: GameLibrary }>("select public.published_games($1,$2) l",[offset,limit])).rows[0].l;
    await t.test("legacy names use email local parts and dates use the public revision", async () => {
      const game=(await page()).games.find(g=>g.id===legacy.id)!;
      assert.equal(game.creatorName,"family+studio");
      assert.equal(Date.parse(game.updatedAt),Date.parse("2026-01-01T00:00:00Z"));
      await asUser(db,owners[1]);
      assert.deepEqual((await db.query<{ p: unknown }>("select public.creator_profile() p")).rows[0].p,{displayName:"other"});
    });
    await t.test("all originals match maintained source and are playable anonymously", async () => {
      await asUser(db,null);
      for (const classic of classicGames) {
        const game=(await db.query<{ g: Record<string,unknown> }>("select public.public_game($1) g",[classic.id])).rows[0].g;
        assert.equal(game.html,classic.html); assert.equal(game.revisionId,classic.revisionId);
        assert.equal(validateGame(game).title,classic.title);
        assert.equal("creatorName" in game,false);
        assert.equal("ownerId" in game,false);
      }
      const games=[];
      for(let offset=0;;offset++) { const result=await page(offset,1); games.push(...result.games); if(!result.hasMore)break; }
      assert.equal(games.length,6);
      assert.equal(new Set(games.map(g=>g.id)).size,6);
      assert.deepEqual(games.filter(g=>g.creatorName==="Pocket Base").map(g=>g.id).sort(),classicGames.map(g=>g.id).sort());
      assert.deepEqual(Object.keys(games[0]).sort(),["creatorName","description","id","playCount","revisionId","theme","title","updatedAt"]);
      assert.ok(games.every(g => g.playCount === 0));
      assert.deepEqual((await page()).leaderboard, []);
      assert.equal(JSON.stringify(games).includes("@"),false);
      await assert.rejects(db.query("select * from public.library_catalog"),/permission denied/);
      await assert.rejects(db.query("select * from public.creator_profiles"),/permission denied/);
    });
    await t.test("drafts, restores, repeated publishes, and name changes preserve the public date", async () => {
      await asUser(db,owners[0]);
      const before=(await page()).games.find(g=>g.id===legacy.id)!;
      const edit=await save(legacy.id,legacy.current_revision_id,"PRIVATE draft");
      await db.query("select public.select_revision($1,$2,'restore')",[legacy.id,legacy.current_revision_id]);
      await db.query("select public.select_revision($1,$2,'publish')",[legacy.id,legacy.current_revision_id]);
      await db.query("select public.save_creator_profile('  New public name  ')");
      const unchanged=(await page()).games.find(g=>g.id===legacy.id)!;
      assert.equal(unchanged.updatedAt,before.updatedAt); assert.equal(unchanged.creatorName,"New public name");
      assert.equal(unchanged.title,before.title);
      await db.query("select public.select_revision($1,$2,'publish')",[legacy.id,edit.current_revision_id]);
      const changed=(await page()).games.find(g=>g.id===legacy.id)!;
      assert.notEqual(changed.updatedAt,before.updatedAt); assert.equal(changed.revisionId,edit.current_revision_id);
      await db.query("select public.unpublish_game($1)",[legacy.id]);
      assert.equal((await page()).games.some(g=>g.id===legacy.id),false);
      await db.query("select public.select_revision($1,$2,'publish')",[legacy.id,legacy.current_revision_id]);
      assert.notEqual((await page()).games.find(g=>g.id===legacy.id)!.updatedAt,changed.updatedAt);
    });
    await t.test("saved revision prompts accept 5,000 characters and reject 5,001",async()=>{
      await asUser(db,owners[0]);
      await db.query("select public.save_game(null,null,'Long prompt','Description','mint',$1,$2)",[classicGames[0].html,"星".repeat(5000)]);
      await assert.rejects(db.query("select public.save_game(null,null,'Too long','Description','mint',$1,$2)",[classicGames[0].html,"a".repeat(5001)]),/revisions_prompt_check/);
    });
    await t.test("public opens deduplicate, expire, and preserve publication dates and totals", async () => {
      await asUser(db, owners[0]);
      const draft = await save();
      const open = (id: string, visitor = randomUUID()) => db.query("select public.record_game_open($1,$2)", [id,visitor]);
      const visitor = randomUUID();
      const listing = async () => (await page()).games.find(g => g.id === legacy.id)!;
      const before = await listing();
      await asUser(db, null);
      await assert.rejects(open(draft.id), /PS_NOT_FOUND/);
      await assert.rejects(open(randomUUID()), /PS_NOT_FOUND/);
      await assert.rejects(db.query("select public.record_game_open(null,null)"), /PS_BAD_OPEN/);
      await Promise.all(Array.from({ length: 8 }, () => open(legacy.id, visitor)));
      assert.equal((await listing()).playCount, 1);
      await open(legacy.id);
      await open(classicGames[0].id, visitor);
      assert.equal((await listing()).playCount, 2);
      assert.equal((await listing()).updatedAt, before.updatedAt);
      for (const role of ["anon", "authenticated"]) {
        await db.exec("reset role; set role " + role);
        for (const table of ["game_play_counts", "game_play_visitors"]) {
          await assert.rejects(db.query("select * from public." + table), /permission denied/);
          await assert.rejects(db.query("delete from public." + table), /permission denied/);
        }
      }
      await db.exec("reset role; update public.game_play_visitors set counted_at = clock_timestamp() - interval '30 minutes'; set role anon;");
      await open(legacy.id, visitor);
      assert.equal((await listing()).playCount, 3);
      await db.exec("reset role");
      assert.equal((await db.query<{ n: number }>("select count(*)::integer n from public.game_play_visitors")).rows[0].n, 1);
      await asUser(db, owners[0]);
      const edited = await save(legacy.id, legacy.current_revision_id, "New public title");
      assert.equal((await listing()).title, before.title);
      assert.equal((await listing()).playCount, 3);
      await db.query("select public.select_revision($1,$2,'publish')", [legacy.id, edited.current_revision_id]);
      assert.equal((await listing()).playCount, 3);
      await db.query("select public.unpublish_game($1)", [legacy.id]);
      await asUser(db, null);
      await assert.rejects(open(legacy.id), /PS_NOT_FOUND/);
      assert.equal((await page()).leaderboard.some(g => g.id === legacy.id), false);
      await asUser(db, owners[0]);
      await db.query("select public.select_revision($1,$2,'publish')", [legacy.id, legacy.current_revision_id]);
      assert.equal((await listing()).playCount, 3);
    });
    await t.test("the top ten spans every page and uses publication dates then IDs to break ties", async () => {
      await asUser(db, owners[0]);
      const ids: string[] = [];
      for (let i = 0; i < 25; i++) {
        const game = await save(null, null, "Ranking fixture " + i);
        await db.query("select public.select_revision($1,$2,'publish')", [game.id,game.current_revision_id]);
        await db.query("select public.record_game_open($1,$2)", [game.id,randomUUID()]);
        ids.push(game.id);
      }
      await db.exec("reset role");
      await db.query("update public.projects set published_at='2000-01-01' where id=$1", [legacy.id]);
      await db.query("update public.projects set published_at='2099-01-01' where id=any($1::uuid[])", [ids]);
      await asUser(db,null);
      const result = await page();
      assert.equal(result.games.some(g => g.id === legacy.id), false);
      assert.equal(result.hasMore, true);
      assert.deepEqual(result.leaderboard.map(g => g.id), [legacy.id,...ids.sort().slice(0,9)]);
      assert.deepEqual((await page(24)).leaderboard,result.leaderboard);
      assert.deepEqual(Object.keys(result.leaderboard[0]).sort(),["creatorName","description","id","playCount","revisionId","theme","title","updatedAt"]);
      const serialized = JSON.stringify(result);
      for (const privateValue of ["PRIVATE", "visitorId", "countedAt", "@", ...owners]) assert.equal(serialized.includes(privateValue), false);
    });
    await t.test("profiles cannot mutate another account and new users must supply valid names", async () => {
      await asUser(db,owners[1]);
      await db.query("select public.save_creator_profile('Other name')");
      await assert.rejects(db.query("select public.save_creator_profile('<script>')"),/check constraint/);
      await asUser(db,owners[0]);
      assert.equal((await db.query<{ p: {displayName:string} }>("select public.creator_profile() p")).rows[0].p.displayName,"New public name");
      await assert.rejects(db.query("update public.creator_profiles set display_name='stolen'"),/permission denied/);
      await db.exec("reset role");
      await assert.rejects(db.query("insert into auth.users(id,email) values(gen_random_uuid(),'new@example.test')"),/null value/);
      const created=(await db.query<{ id:string }>("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'new@example.test','{\"display_name\":\"New creator\"}') returning id")).rows[0].id;
      await asUser(db,created);
      assert.deepEqual((await db.query<{p:unknown}>("select public.creator_profile() p")).rows[0].p,{displayName:"New creator"});
      await asUser(db,null);
      await assert.rejects(db.query("select public.save_creator_profile('oops')"),/permission denied/);
    });
  } finally { await db.close(); }
});

test("public search filters published metadata across all pages without revealing private matches", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    for (const file of ["005_library_profiles.sql","007_classic_games.sql","008_longer_prompts.sql","009_game_play_counts.sql","010_library_search.sql"]) await migration(db,file);
    await asUser(db, owners[0]);
    await db.query("select public.save_creator_profile('Meadow maker')");
    const save = async (title: string, id: string | null = null, base: string | null = null) =>
      (await db.query<{ g: { id: string; current_revision_id: string } }>(
        "select public.save_game($1,$2,$3,'A 100% turtle_underwater adventure','mint',$4,'PRIVATE prompt needle') g",
        [id,base,title,classicGames[0].html])).rows[0].g;
    const games = [];
    for (let i = 0; i < 25; i++) {
      const game = await save("Meadow search fixture " + i + (i === 0 ? " Dodge" : ""));
      await db.query("select public.select_revision($1,$2,'publish')", [game.id,game.current_revision_id]);
      games.push(game);
    }
    const first = games[0];
    const edit = await save("PRIVATE draft needle", first.id, first.current_revision_id);
    await save("PRIVATE unpublished needle");
    await db.exec("reset role");
    await db.query("update public.projects set published_at='2000-01-01' where id=$1", [first.id]);
    const search = async (query: string, offset = 0) => (await db.query<{ l: GameLibrary }>(
      "select public.published_games($1,24,$2) l", [offset,query])).rows[0].l;
    for (const owner of [null, owners[1]]) {
      await asUser(db, owner);
      assert.equal((await search("")).games.some(g => g.id === first.id), false);
      const result = await search("  MEADOW SEARCH FIXTURE 0  ");
      assert.deepEqual(result.games.map(g => g.id), [first.id]);
      assert.deepEqual((await search("dOd")).games.map(g => g.id), [first.id]);
      assert.equal(result.games[0].revisionId, first.current_revision_id);
      assert.deepEqual(Object.keys(result.games[0]).sort(), ["creatorName","description","id","playCount","revisionId","theme","title","updatedAt"]);
      for (const query of ["Meadow maker", "100%", "turtle_underwater"]) {
        const page = await search(query), more = await search(query, 24);
        assert.equal(page.games.length, 24); assert.equal(page.hasMore, true);
        assert.equal(more.games.length, 1); assert.equal(more.hasMore, false);
        assert.equal(new Set([...page.games,...more.games].map(g => g.id)).size, 25);
      }
      for (const query of ["PRIVATE", "PocketBase.load", owners[0], "family+studio@gmail.com", "missing needle", "turtle%", "turtleXunderwater"])
        assert.deepEqual((await search(query)).games, []);
      assert.equal((await search("Pocket Base")).games.length, 5);
      assert.equal((await search(classicGames[0].title)).games.some(g => g.id === classicGames[0].id), true);
      await assert.rejects(search("a".repeat(201)), /PS_BAD_SEARCH/);
      await assert.rejects(search("bad\nquery"), /PS_BAD_SEARCH/);
    }
    await asUser(db, owners[0]);
    await db.query("select public.select_revision($1,$2,'publish')", [first.id,edit.current_revision_id]);
    assert.deepEqual((await search("Meadow search fixture 0")).games, []);
    assert.deepEqual((await search("PRIVATE draft needle")).games.map(g => g.id), [first.id]);
    await db.query("select public.unpublish_game($1)", [first.id]);
    assert.deepEqual((await search("PRIVATE draft needle")).games, []);
  } finally { await db.close(); }
});

test("signup hook enforces rolling limits, IP grouping, expiration, and private execution", async t => {
  const db=new PGlite();
  try {
    await bootstrap(db);
    await migration(db,"006_signup_protection.sql");
    const call=async (ip: string | null, name="Creator") => (await db.query<{r:{error?:{http_code:number}}}>("select public.before_user_created($1::jsonb) r",[JSON.stringify({metadata:{ip_address:ip},user:{user_metadata:{display_name:name}}})])).rows[0].r;
    const reset=()=>db.exec("reset role; truncate public.signup_attempts; set role supabase_auth_admin;");
    await t.test("three per hour, including concurrent requests",async()=>{
      await reset();
      const outcomes=await Promise.all(Array.from({length:5},()=>call("203.0.113.4")));
      assert.equal(outcomes.filter(r=>!r.error).length,3);
      assert.equal(outcomes.filter(r=>r.error?.http_code===429).length,2);
      assert.deepEqual(await call("203.0.113.5"),{});
    });
    await t.test("IPv6 /64 and IPv4-mapped addresses share counters",async()=>{
      await reset();
      for(const ip of ["2001:db8:1::1","2001:db8:1::2","2001:db8:1::3"]) assert.deepEqual(await call(ip),{});
      assert.equal((await call("2001:db8:1::ffff")).error?.http_code,429);
      assert.deepEqual(await call("2001:db8:2::1"),{});
      for(let i=0;i<3;i++) assert.deepEqual(await call("::ffff:203.0.113.9"),{});
      assert.equal((await call("203.0.113.9")).error?.http_code,429);
    });
    await t.test("daily and global limits survive rotating addresses, then expire",async()=>{
      await reset(); await db.exec("reset role");
      await db.exec("insert into public.signup_attempts(network,created_at) select '203.0.113.4',clock_timestamp()-interval '2 hours' from generate_series(1,10)");
      await db.exec("set role supabase_auth_admin");
      assert.equal((await call("203.0.113.4")).error?.http_code,429);
      await db.exec("reset role; truncate public.signup_attempts; insert into public.signup_attempts(network,created_at) select '203.0.113.8',clock_timestamp()-interval '2 hours' from generate_series(1,100); set role supabase_auth_admin;");
      assert.equal((await call("198.51.100.6")).error?.http_code,429);
      await db.exec("reset role; update public.signup_attempts set created_at=clock_timestamp()-interval '25 hours'; set role supabase_auth_admin;");
      assert.deepEqual(await call("198.51.100.6"),{});
    });
    await t.test("missing names/addresses fail closed and clients cannot forge hook calls",async()=>{
      await reset();
      for(const ip of [null,"invalid","203.0.113.0/24"]) assert.equal((await call(ip)).error?.http_code,400);
      for(const name of [" ","<tag>","a".repeat(81),"bad\nname"]) assert.equal((await call("203.0.113.2",name)).error?.http_code,400);
      for(const role of ["anon","authenticated"]) {
        await db.exec("reset role; set role "+role);
        await assert.rejects(call("203.0.113.2"),/permission denied/);
        await assert.rejects(db.query("select * from public.signup_attempts"),/permission denied/);
      }
    });
  } finally { await db.close(); }
});
