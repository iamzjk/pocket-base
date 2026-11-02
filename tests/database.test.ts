import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("the PostgreSQL migration enforces ownership, publishing, and shared quotas", async t => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$; grant usage on schema auth to anon,authenticated;");
    const owners = ["00000000-0000-4000-8000-000000000011","00000000-0000-4000-8000-000000000012","00000000-0000-4000-8000-000000000013"];
    for (const id of owners) await db.query("insert into auth.users values($1)", [id]);
    await db.exec(await readFile(new URL("../supabase/migrations/001_studio.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/002_migration_readiness.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/003_published_game_library.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/004_game_icons_and_size.sql", import.meta.url), "utf8"));
    assert.deepEqual((await db.query<{ versions: string[] }>("select public.studio_migration_versions() as versions")).rows[0].versions, []);
    await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text); insert into supabase_migrations.schema_migrations values ('001',array['PRIVATE migration source'],'studio'),('002',array['PRIVATE migration source'],'migration_readiness'),('003',array['PRIVATE migration source'],'published_game_library'),('004',array['PRIVATE migration source'],'game_icons_and_size');");
    async function asUser(id: string | null) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || ""]);
      await db.exec(id ? "set role authenticated" : "set role anon");
    }
    const html = "<!doctype html><html><body>" + "safe fictional data ".repeat(10) + "</body></html>";
    async function save(projectId: string | null, base: string | null, title: string) {
      const result = await db.query<{ game: { id: string; current_revision_id: string; published_revision_id: string | null; revisions: unknown[] } }>(
        "select public.save_game($1,$2,$3,'Public description','cosmic',$4,'PRIVATE prompt') as game", [projectId,base,title,html]);
      return result.rows[0].game;
    }
    await asUser(owners[0]);
    const first = await save(null, null, "First published title");
    await t.test("anonymous visitors cannot read tables or use private functions", async () => {
      await asUser(null);
      await assert.rejects(db.query("select * from public.projects"), /permission denied/);
      await assert.rejects(db.query("select public.project_detail($1)",[first.id]), /permission denied/);
      assert.deepEqual((await db.query<{ versions: string[] }>("select public.studio_migration_versions() as versions")).rows[0].versions, ["001", "002", "003", "004"]);
      await assert.rejects(db.query("select * from supabase_migrations.schema_migrations"), /permission denied/);
      assert.equal((await db.query<{ game: unknown }>("select public.public_game($1) as game",[first.id])).rows[0].game, null);
    });
    await t.test("another owner cannot read or mutate the project", async () => {
      await asUser(owners[1]);
      assert.equal((await db.query("select * from public.projects")).rows.length,0);
      assert.equal((await db.query<{ d: unknown }>("select public.project_detail($1) as d",[first.id])).rows[0].d,null);
      await assert.rejects(save(first.id,first.current_revision_id,"Stolen"), /PS_NOT_FOUND/);
      await assert.rejects(db.query("select public.select_revision($1,$2,'publish')",[first.id,first.current_revision_id]), /PS_NOT_FOUND/);
      await assert.rejects(db.query("select public.unpublish_game($1)",[first.id]), /PS_NOT_FOUND/);
    });
    await t.test("draft metadata stays private and restore retains all revisions", async () => {
      await asUser(owners[0]);
      await db.query("select public.select_revision($1,$2,'publish')",[first.id,first.current_revision_id]);
      const second = await save(first.id,first.current_revision_id,"Secret draft title");
      await assert.rejects(save(first.id,first.current_revision_id,"Stale write"), /PS_CONFLICT/);
      await asUser(null);
      const game = (await db.query<{ g: { title: string; revisionId: string } }>("select public.public_game($1) as g",[first.id])).rows[0].g;
      assert.equal(game.title,"First published title");
      assert.equal(game.revisionId,first.current_revision_id);
      assert.equal(JSON.stringify(game).includes("PRIVATE"),false);
      await asUser(owners[0]);
      await db.query("select public.select_revision($1,$2,'restore')",[first.id,first.current_revision_id]);
      const d = (await db.query<{ d: { revisions: unknown[] } }>("select public.project_detail($1) as d",[first.id])).rows[0].d;
      assert.equal(d.revisions.length,2);
      await db.query("select public.select_revision($1,$2,'publish')",[first.id,second.current_revision_id]);
      await db.query("select public.unpublish_game($1)",[first.id]);
      await asUser(null);
      assert.equal((await db.query<{ g: unknown }>("select public.public_game($1) as g",[first.id])).rows[0].g,null);
    });
    await t.test("the anonymous library lists only published versions from every owner", async () => {
      await asUser(owners[0]);
      const a = await save(null,null,"Published by first owner");
      await db.query("select public.select_revision($1,$2,'publish')",[a.id,a.current_revision_id]);
      await save(a.id,a.current_revision_id,"PRIVATE first owner's draft");
      await asUser(owners[1]);
      const b = await save(null,null,"Published by second owner");
      await db.query("select public.select_revision($1,$2,'publish')",[b.id,b.current_revision_id]);
      await save(null,null,"PRIVATE unpublished game");
      await asUser(null);
      type Page = { games: { id: string; revisionId: string; title: string }[]; hasMore: boolean };
      const page = async (offset: number) => (await db.query<{ library: Page }>("select public.published_games($1,1) as library",[offset])).rows[0].library;
      const firstPage=await page(0), secondPage=await page(1);
      assert.equal(firstPage.games.length,1); assert.equal(firstPage.hasMore,true); assert.equal(secondPage.hasMore,false);
      assert.deepEqual([...firstPage.games,...secondPage.games].map(g=>g.id).sort(),[a.id,b.id].sort());
      assert.equal([...firstPage.games,...secondPage.games].find(g=>g.id===a.id)!.revisionId,a.current_revision_id);
      assert.deepEqual(Object.keys(firstPage.games[0]).sort(),["description","id","revisionId","theme","title"]);
      assert.equal(JSON.stringify([firstPage,secondPage]).includes("PRIVATE"),false);
      await assert.rejects(db.query("select public.published_games(-1,1)"), /PS_BAD_PAGE/);
      await assert.rejects(db.query("select public.published_games(0,1000)"), /PS_BAD_PAGE/);
      await assert.rejects(db.query("select * from public.projects"), /permission denied/);
      await asUser(owners[1]); await db.query("select public.unpublish_game($1)",[b.id]);
      await asUser(null); assert.deepEqual((await page(0)).games.map(g=>g.id),[a.id]);
    });
    await t.test("game edits retain the stored logo and larger source can be saved", async () => {
      await asUser(owners[0]);
      const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#123456"/></svg>';
      type IconGame = { id: string; current_revision_id: string; revisions: { id: string; icon_svg: string }[] };
      const first = (await db.query<{ g: IconGame }>("select public.save_game(null,null,'Logo fixture','Description','cosmic',$1,'PRIVATE',$2) as g",[html,icon])).rows[0].g;
      const bigger = html + " ".repeat(210000);
      const edit = (await db.query<{ g: IconGame }>("select public.save_game($1,$2,'Changed title','Description','mint',$3,'PRIVATE',$4) as g",[first.id,first.current_revision_id,bigger,icon.replace('#123456','#abcdef')])).rows[0].g;
      assert.equal(edit.revisions.find(r=>r.id===edit.current_revision_id)!.icon_svg,icon);
      await db.query("select public.select_revision($1,$2,'publish')",[edit.id,edit.current_revision_id]);
      await asUser(null);
      const published=(await db.query<{ g: { iconSvg: string } }>("select public.public_game($1) as g",[edit.id])).rows[0].g;
      assert.equal(published.iconSvg,icon);
      await assert.rejects(db.query("select public.save_game(null,null,'Bad','D','mint',$1,'PRIVATE',null)",[html]),/permission denied/);
    });
    await t.test("leases and quotas apply across users and server instances", async () => {
      await asUser(owners[0]);
      const firstAttempt = (await db.query<{ id: string }>("select public.reserve_generation() as id")).rows[0].id;
      await assert.rejects(db.query("select public.reserve_generation()"), /PS_BUSY/);
      await db.query("select public.finish_generation($1)",[firstAttempt]);
      for (let i=1;i<20;i++) {
        const id = (await db.query<{ id: string }>("select public.reserve_generation() as id")).rows[0].id;
        await db.query("select public.finish_generation($1)",[id]);
      }
      await assert.rejects(db.query("select public.reserve_generation()"), /PS_QUOTA/);
      await asUser(owners[1]);
      for (let i=0;i<20;i++) {
        const id = (await db.query<{ id: string }>("select public.reserve_generation() as id")).rows[0].id;
        await db.query("select public.finish_generation($1)",[id]);
      }
      await asUser(owners[2]);
      await assert.rejects(db.query("select public.reserve_generation()"), /PS_QUOTA/);
    });
  } finally { await db.close(); }
});
