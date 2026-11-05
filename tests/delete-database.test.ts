import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("PostgreSQL deletion checks ownership and atomically removes published games and their history", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role supabase_auth_admin; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated;");
    const owner = randomUUID(), other = randomUUID();
    await db.query("insert into auth.users(id,email) values($1,'owner@example.test'),($2,'other@example.test')", [owner, other]);
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(migrations)).filter(file => file.endsWith(".sql")).sort())
      await db.exec(await readFile(new URL(file, migrations), "utf8"));
    async function asUser(id: string | null) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || ""]);
      await db.exec(id ? "set role authenticated" : "set role anon");
    }
    const html = "<!doctype html><body>" + "Fictional game ".repeat(20) + "</body>";
    async function save(id: string | null = null, base: string | null = null) {
      return (await db.query<{ g: { id: string; current_revision_id: string; revisions: unknown[] } }>(
        "select public.save_game($1,$2,'Deletion fixture','Description','mint',$3,'PRIVATE prompt') g", [id, base, html])).rows[0].g;
    }
    const remove = (id: string) => db.query("select public.delete_game($1)", [id]);
    await asUser(owner);
    const first = await save();
    await db.query("select public.select_revision($1,$2,'publish')", [first.id, first.current_revision_id]);
    const draft = await save(first.id, first.current_revision_id);
    assert.equal(draft.revisions.length, 2);
    const keep = await save();
    const attempt = (await db.query<{ id: string }>("select public.reserve_generation() id")).rows[0].id;
    await assert.rejects(db.query("delete from public.projects where id=$1", [first.id]), /permission denied/);
    await asUser(other);
    await assert.rejects(remove(first.id), /PS_NOT_FOUND/);
    await assert.rejects(remove(keep.id), /PS_NOT_FOUND/);
    const otherGame = await save();
    await db.query("select public.select_revision($1,$2,'publish')", [otherGame.id, otherGame.current_revision_id]);
    await asUser(null);
    await assert.rejects(remove(first.id), /permission denied/);
    await db.exec("set role authenticated");
    await assert.rejects(remove(first.id), /PS_UNAUTHORIZED/);
    await asUser(owner);
    await assert.rejects(remove(randomUUID()), /PS_NOT_FOUND/);
    await assert.rejects(remove("10000000-0000-4000-8000-000000000001"), /PS_NOT_FOUND/);
    await db.exec("reset role");
    await db.query("update public.creator_profiles set display_name=null where user_id=$1", [owner]);
    await asUser(owner);
    await assert.rejects(remove(first.id), /PS_PROFILE_REQUIRED/);
    await db.query("select public.save_creator_profile('Owner')");
    await db.query("select public.record_game_open($1,$2)", [first.id, randomUUID()]);
    await db.query("select public.record_game_open($1,$2)", [otherGame.id, randomUUID()]);
    await remove(first.id);
    await assert.rejects(remove(first.id), /PS_NOT_FOUND/);
    await assert.rejects(save(first.id, draft.current_revision_id), /PS_NOT_FOUND/);
    await assert.rejects(db.query("select public.select_revision($1,$2,'restore')", [first.id, first.current_revision_id]), /PS_NOT_FOUND/);
    assert.equal((await db.query<{ g: unknown }>("select public.project_detail($1) g", [first.id])).rows[0].g, null);
    await assert.rejects(db.query("select public.reserve_generation()"), /PS_BUSY/);
    await remove(keep.id);
    await asUser(null);
    assert.equal((await db.query<{ g: unknown }>("select public.public_game($1) g", [first.id])).rows[0].g, null);
    const library = (await db.query<{ l: { games: { id: string }[]; leaderboard: { id: string }[] } }>("select public.published_games() l")).rows[0].l;
    assert.equal(library.games.some(game => game.id === first.id), false);
    assert.equal(library.leaderboard.some(game => game.id === first.id), false);
    assert.ok(library.games.some(game => game.id === otherGame.id));
    await assert.rejects(db.query("select public.record_game_open($1,$2)", [first.id, randomUUID()]), /PS_NOT_FOUND/);
    await db.exec("reset role");
    for (const [table, key] of [["projects", "id"], ["revisions", "project_id"], ["game_play_counts", "game_id"], ["game_play_visitors", "game_id"]])
      assert.equal((await db.query(`select * from public.${table} where ${key}=$1`, [first.id])).rows.length, 0);
    assert.equal((await db.query("select * from public.generation_attempts where id=$1", [attempt])).rows.length, 1);
    assert.equal((await db.query("select * from public.game_play_counts where game_id=$1", [otherGame.id])).rows.length, 1);
    assert.equal((await db.query("select * from public.revisions where project_id=$1", [otherGame.id])).rows.length, 1);
  } finally { await db.close(); }
});
