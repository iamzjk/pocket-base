import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

for (const legacyPlanning of [false, true]) test("Google onboarding preserves existing creators and guards direct writes until name completion (013 " + (legacyPlanning ? "planning" : "Google") + ")", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role supabase_auth_admin; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated;");
    const existing=randomUUID(), google=randomUUID();
    await db.query("insert into auth.users(id,email) values($1,'original@example.test')",[existing]);
    const migrations=new URL("../supabase/migrations/",import.meta.url);
    let existingGame: {id:string;current_revision_id:string} | undefined;
    for(const file of (await readdir(migrations)).filter(file=>file.endsWith(".sql")).sort()) {
      if (file.startsWith("014_")) {
        await asUser(existing);
        await db.query("select public.save_creator_profile('Original creator')");
        existingGame = await save();
        await db.exec("reset role");
      }
      const source = legacyPlanning && file.startsWith("013_")
        ? new URL("./fixtures/legacy-generation-planning.sql", import.meta.url) : new URL(file,migrations);
      await db.exec(await readFile(source,"utf8"));
    }
    async function asUser(id:string) {
      await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec("set role authenticated");
    }
    async function save() {
      return (await db.query<{g:{id:string;current_revision_id:string}}>("select public.save_game(null,null,'Fictional game','Description','mint',$1,'PRIVATE') g",["<!doctype html><body>"+"fictional ".repeat(20)+"</body>"])).rows[0].g;
    }
    await asUser(existing);
    assert.deepEqual((await db.query<{p:unknown}>("select public.creator_profile() p")).rows[0].p,{displayName:"Original creator"});
    const game=existingGame!;
    assert.equal((await db.query<{g:{id:string}}>("select public.project_detail($1) g",[game.id])).rows[0].g.id,game.id);
    await db.exec("reset role");
    await db.query("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,'google@example.test','{\"provider\":\"google\",\"providers\":[\"google\"]}','{\"name\":\"Private Google Name\",\"display_name\":\"Do not copy\"}')",[google]);
    await asUser(google);
    assert.deepEqual((await db.query<{p:unknown}>("select public.creator_profile() p")).rows[0].p,{displayName:null});
    await assert.rejects(save(),/PS_PROFILE_REQUIRED/);
    await assert.rejects(db.query("select public.reserve_generation()"),/PS_PROFILE_REQUIRED/);
    for(const name of [null,""," ","<tag>","x".repeat(81),"bad\nname"])
      await assert.rejects(db.query("select public.save_creator_profile($1)",[name]),/PS_BAD_PROFILE/);
    await db.query("select public.save_creator_profile('  Chosen creator  ')");
    await save();
    const parent=(await db.query<{id:string}>("select public.reserve_generation() id")).rows[0].id;
    const child=(await db.query<{id:string}>("select public.reserve_generation_step($1) id",[parent])).rows[0].id;
    await assert.rejects(db.query("select public.reserve_generation_step($1)",[parent]),/PS_BUSY/);
    await db.query("select public.finish_generation($1)",[child]);
    await db.query("select public.finish_generation($1)",[parent]);
    await asUser(existing);
    assert.deepEqual((await db.query<{p:unknown}>("select public.creator_profile() p")).rows[0].p,{displayName:"Original creator"});
    await db.exec("reset role");
    // Simulate a legacy project belonging to a now-incomplete profile, covering all existing RPCs.
    await db.query("update public.creator_profiles set display_name=null where user_id=$1",[existing]);
    await asUser(existing);
    for(const action of ["publish","restore"])
      await assert.rejects(db.query("select public.select_revision($1,$2,$3)",[game.id,game.current_revision_id,action]),/PS_PROFILE_REQUIRED/);
    await assert.rejects(db.query("select public.unpublish_game($1)",[game.id]),/PS_PROFILE_REQUIRED/);
    await assert.rejects(db.query("select public.save_game($1,$2,'Edit','Description','mint',$3,'PRIVATE')",[game.id,game.current_revision_id,"<!doctype html><body>"+"fictional ".repeat(20)+"</body>"]),/PS_PROFILE_REQUIRED/);
    await db.exec("reset role");
    await assert.rejects(db.query("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'spoof@example.test','{\"provider\":\"google\",\"app_metadata\":{\"provider\":\"google\"}}')"),/PS_BAD_PROFILE/);
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'email@example.test','{\"display_name\":\"Email creator\"}')");
    await db.exec("set role anon");
    await assert.rejects(db.query("select public.save_creator_profile('stolen')"),/permission denied/);
    await assert.rejects(db.query("select public.reserve_generation_step($1)",[parent]),/permission denied/);
  } finally {await db.close();}
});

test("Google and email share protected rolling signup limits and user metadata cannot spoof Google",async()=>{
  const db=new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role supabase_auth_admin; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb); create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;");
    const migrations=new URL("../supabase/migrations/",import.meta.url);
    for(const file of (await readdir(migrations)).filter(file=>file.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(file,migrations),"utf8"));
    const call=async(ip:string|null,provider:string,name?:string,spoof=false)=>(await db.query<{r:{error?:{http_code:number}}}>("select public.before_user_created($1::jsonb) r",[JSON.stringify({metadata:{ip_address:ip},user:{app_metadata:{provider},user_metadata:{display_name:name,...(spoof?{provider:"google",app_metadata:{provider:"google"}}:{})}}})])).rows[0].r;
    await db.exec("set role supabase_auth_admin");
    assert.equal((await call("203.0.113.1","email",undefined,true)).error?.http_code,400);
    assert.equal((await call("203.0.113.1","email","<bad>")).error?.http_code,400);
    assert.deepEqual(await call("203.0.113.1","google"),{});
    assert.deepEqual(await call("203.0.113.1","email","Creator"),{});
    assert.deepEqual(await call("203.0.113.1","google"),{});
    assert.equal((await call("203.0.113.1","google")).error?.http_code,429);
    for(const ip of [null,"bad","203.0.113.0/24"]) assert.equal((await call(ip,"google")).error?.http_code,400);
    for(const ip of ["2001:db8:1::1","2001:db8:1::2","2001:db8:1::3"]) assert.deepEqual(await call(ip,"google"),{});
    assert.equal((await call("2001:db8:1::ffff","email","Creator")).error?.http_code,429);
    await db.exec("reset role; truncate public.signup_attempts; insert into public.signup_attempts(network,created_at) select '203.0.113.4',clock_timestamp()-interval '2 hours' from generate_series(1,10); set role supabase_auth_admin;");
    assert.equal((await call("203.0.113.4","google")).error?.http_code,429);
    await db.exec("reset role; truncate public.signup_attempts; insert into public.signup_attempts(network,created_at) select '203.0.113.8',clock_timestamp()-interval '2 hours' from generate_series(1,100); set role supabase_auth_admin;");
    assert.equal((await call("203.0.113.9","google")).error?.http_code,429);
    await db.exec("reset role; update public.signup_attempts set created_at=clock_timestamp()-interval '25 hours'; set role supabase_auth_admin;");
    assert.deepEqual(await call("203.0.113.9","google"),{});
    for(const role of ["anon","authenticated"]) {
      await db.exec("reset role; set role "+role);
      await assert.rejects(call("203.0.113.8","google"),/permission denied/);
      await assert.rejects(db.query("select * from public.signup_attempts"),/permission denied/);
    }
    await db.exec("reset role; drop table public.signup_attempts; set role supabase_auth_admin;");
    await assert.rejects(call("203.0.113.9","google"),/does not exist/);
  } finally {await db.close();}
});
