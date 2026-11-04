import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { DemoStore } from "../src/lib/demo-store";

const owners = ["00000000-0000-4000-8000-000000000031", "00000000-0000-4000-8000-000000000032", "00000000-0000-4000-8000-000000000033"];

test("local planning/build reservations count twice and retain the active request lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pocket-planning-quota-"));
  try {
    const own = new DemoStore(owners[0], directory), other = new DemoStore(owners[1], directory);
    const parent = await own.reserveGeneration();
    await assert.rejects(other.reserveGeneration(parent), /expired/);
    const child = await own.reserveGeneration(parent);
    await assert.rejects(own.reserveGeneration(), /already being made/);
    await assert.rejects(own.reserveGeneration(parent), /already being made/);
    await own.finishGeneration(child);
    await assert.rejects(own.reserveGeneration(), /already being made/);
    await own.finishGeneration(parent);
    await assert.rejects(own.reserveGeneration(parent), /expired/);
    for (let i = 2; i < 19; i++) { const id = await own.reserveGeneration(); await own.finishGeneration(id); }
    const last = await own.reserveGeneration();
    await assert.rejects(own.reserveGeneration(last), /allowance/);
    await own.finishGeneration(last);
    const state = JSON.parse(await readFile(path.join(directory, "demo.json"), "utf8"));
    assert.equal(state.attempts.length, 20);
    assert.equal(state.attempts.every((attempt: { finished: boolean }) => attempt.finished), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("hosted planning/build reservations enforce ownership, leases, and both daily quotas", async () => {
  const db = new PGlite();
  async function asUser(owner: string | null) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner || ""]);
    await db.exec(owner ? "set role authenticated" : "set role anon");
  }
  async function reserve(parent?: string) {
    return (await db.query<{ id: string }>(parent ? "select public.reserve_generation_step($1) id" : "select public.reserve_generation() id", parent ? [parent] : [])).rows[0].id;
  }
  const finish = (id: string) => db.query("select public.finish_generation($1)", [id]);
  try {
    await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated;");
    for (const owner of owners) await db.query("insert into auth.users(id) values($1)", [owner]);
    for (const file of ["001_studio.sql", "011_configurable_generation_limits.sql", "013_generation_planning.sql"])
      await db.exec(await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
    await asUser(owners[0]);
    const parent = await reserve();
    await asUser(owners[1]); await assert.rejects(reserve(parent), /PS_EXPIRED/);
    await asUser(null); await assert.rejects(reserve(parent), /permission denied/);
    await asUser(owners[0]);
    const child = await reserve(parent);
    await assert.rejects(reserve(parent), /PS_BUSY/); await assert.rejects(reserve(), /PS_BUSY/);
    await finish(child); await assert.rejects(reserve(), /PS_BUSY/);
    await finish(parent); await assert.rejects(reserve(parent), /PS_EXPIRED/);
    // An expired parent cannot start another paid phase.
    const midnight = await reserve();
    await db.exec("reset role");
    await db.query("update public.generation_attempts set created_at=now()-interval '361 seconds' where id=$1", [midnight]);
    await asUser(owners[0]); await assert.rejects(reserve(midnight), /PS_EXPIRED/); await finish(midnight);
    for (let i = 3; i < 19; i++) { const id = await reserve(); await finish(id); }
    const last = await reserve(); await assert.rejects(reserve(last), /PS_QUOTA/); await finish(last);
    await asUser(owners[1]);
    for (let i = 0; i < 20; i += 2) { const a = await reserve(), b = await reserve(a); await finish(b); await finish(a); }
    await asUser(owners[2]); await assert.rejects(reserve(), /PS_QUOTA/);
  } finally { await db.close(); }
});
