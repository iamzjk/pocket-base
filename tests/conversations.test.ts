import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DemoStore } from "../src/lib/demo-store";
import { SupabaseStore } from "../src/lib/supabase-store";
import { runConversation } from "../src/lib/conversation-flow";
import { recentDiscussion, studioProject, validateDiscussion } from "../src/lib/conversations";
import type { Conversation, ConversationRequestInput, ProjectDetail, Store } from "../src/lib/types";
import { starters } from "./fixtures/games";

const discussion = { reply: "A gentle moon game. Here is the proposal.", summary: "Gentle tap controls.", proposal: "Tap moon bubbles. Keep the device save format stable." };
const response = (value: unknown) => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
for (const backend of ["local", "PostgreSQL"] as const) test(`${backend} conversations: discussion, approval, notes, atomic linking, deduplication, failures, restore, ownership and privacy`, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pocket-conversation-"));
  const database = backend === "PostgreSQL" ? new PGlite() : null;
  const owner = randomUUID(), other = randomUUID();
  const fetcher = globalThis.fetch;
  const beforeEnv = { ...process.env };
  try {
    let actor: string = owner;
    if (database) {
      await database.exec("create role anon; create role authenticated; create role supabase_auth_admin; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated;");
      await database.query("insert into auth.users(id,email) values($1,'owner@example.test'),($2,'other@example.test')", [owner,other]);
      const migrations = new URL("../supabase/migrations/", import.meta.url);
      for (const file of (await readdir(migrations)).filter(f => f.endsWith(".sql")).sort()) await database.exec(await readFile(new URL(file,migrations), "utf8"));
    }
    const asUser = async (id: string) => {
      actor = id;
      if (database) {
        await database.exec("reset role");
        await database.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
        await database.exec("set role authenticated");
      }
    };
    const storeFor = (id: string): Store => database ? new SupabaseStore({
      rpc: async (name: string, args: Record<string, unknown> = {}) => {
        assert.equal(actor, id);
        try {
          const keys = Object.keys(args);
          const query = `select public.${name}(${keys.map((k,i) => `${k} => $${i+1}`).join(",")}) data`;
          const result = await database.query<{ data: unknown }>(query, Object.values(args));
          return { data: result.rows[0].data, error: null };
        } catch (error) { return { data: null, error: { message: (error as Error).message } }; }
      },
    } as unknown as SupabaseClient) : new DemoStore(id, directory);
    const store = storeFor(owner), stranger = storeFor(other);
    await asUser(owner);
    Object.assign(process.env, { OPENROUTER_API_KEY: "fictional", OPENROUTER_MODEL: "openai/gpt-6.1-terra", OPENROUTER_PLANNER_MODEL: "openai/gpt-6.1-sol" });
    const calls: Record<string, any>[] = [];
    let failure = false, invalidNotes = false;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); calls.push(body);
      if (failure) return new Response("private provider error", { status: 429 });
      return response(body.messages[0].content.includes("Discuss the user's game") ? discussion : body.messages[0].content.includes("single plan string") ? { plan: "A tiny moon game." } : { ...starters[0], notes: invalidNotes ? "x".repeat(8001) : "PRIVATE notes, score schema {best:number}, build " + calls.length });
    };
    let c = await store.createConversation();
    const send = (c: Conversation, text: string, baseRevisionId?: string): ConversationRequestInput => ({ requestId: randomUUID(), kind: "discussion", version: c.version, prompt: text, baseRevisionId });
    const first = send(c, "Original fictional idea");
    c = await runConversation(store, c.id, first) as Conversation;
    assert.equal(c.projectId, null); assert.equal(c.messages.length,3); assert.ok(c.proposal);
    assert.equal(calls.length,1); assert.equal(calls[0].model,"openai/gpt-6.1-sol");
    assert.equal((await store.conversations()).filter(x=>!x.projectId).length,1);
    await runConversation(store,c.id,first); assert.equal(calls.length,1);
    const oldProposal = c.proposal!;
    c = await runConversation(store,c.id,send(c,"Use mint colors")) as Conversation;
    await assert.rejects(runConversation(store,c.id,{requestId:randomUUID(),kind:"proposal",version:c.version,proposalId:oldProposal.id}), /changed|another tab/);
    const approve: ConversationRequestInput = { requestId: c.proposal!.id, kind:"proposal", version:c.version, proposalId:c.proposal!.id };
    const project = await runConversation(store,c.id,approve) as ProjectDetail;
    assert.equal(calls.length,3); assert.equal(calls.at(-1)!.model,"openai/gpt-6.1-terra");
    assert.equal(project.revisions.length,1); assert.equal(project.revisions[0].prompt,"Original fictional idea");
    assert.equal("notes" in project.revisions[0],false);
    const raw = await store.detail(project.id); assert.match(raw!.revisions[0].notes!,/PRIVATE notes/);
    assert.ok(JSON.stringify(calls.at(-1)).includes("Use mint colors"));
    const duplicate = await runConversation(store,c.id,approve) as ProjectDetail;
    assert.equal(duplicate.id,project.id); assert.equal(duplicate.revisions.length,1); assert.equal(calls.length,3);
    c = (await store.conversation(c.id))!; assert.equal(c.projectId,project.id); assert.equal(c.proposal,null);
    assert.equal(c.summary,""); assert.ok(c.messages.some(m=>m.kind==="saved"));
    assert.equal((await store.createConversation(project.id)).id,c.id);
    const originalBase = project.currentRevisionId;
    c = await runConversation(store,c.id,send(c,"Brighter bubbles",originalBase)) as Conversation;
    assert.equal((await store.detail(project.id))!.currentRevisionId,originalBase);
    const discussionRequest = calls.at(-1)!;
    assert.equal(JSON.parse(discussionRequest.messages[1].content).currentGame.html, raw!.revisions[0].html);
    assert.ok(JSON.stringify(discussionRequest).includes("PRIVATE notes"));
    const edited = await runConversation(store,c.id,{requestId:c.proposal!.id,kind:"proposal",version:c.version,proposalId:c.proposal!.id,baseRevisionId:originalBase}) as ProjectDetail;
    assert.equal(edited.revisions.length,2); assert.equal(edited.revisions.find(r=>r.id===edited.currentRevisionId)!.prompt,"Brighter bubbles");
    assert.equal(calls.length,5);
    assert.notEqual((await store.detail(project.id))!.revisions.find(r=>r.id===edited.currentRevisionId)!.notes,raw!.revisions[0].notes);
    c = (await store.conversation(c.id))!;
    const failed: ConversationRequestInput = { requestId:randomUUID(),kind:"direct",version:c.version,prompt:"A precise change",baseRevisionId:edited.currentRevisionId };
    failure = true;
    await assert.rejects(runConversation(store,c.id,failed),/busy/);
    assert.equal((await store.detail(project.id))!.currentRevisionId,edited.currentRevisionId);
    failure = false; invalidNotes = true;
    await assert.rejects(runConversation(store,c.id,failed),/notes/);
    invalidNotes = false;
    const direct = await runConversation(store,c.id,failed) as ProjectDetail;
    assert.equal(direct.revisions.length,3); assert.equal(calls.length,8);
    assert.equal(calls.at(-1)!.messages.length,3);
    assert.ok(JSON.stringify(calls.at(-1)).includes("PRIVATE notes"));
    assert.equal(calls.at(-1)!.messages.filter((m: {content:string})=>m.content.includes("<!DOCTYPE") || m.content.includes("<!doctype")).length,1);
    c = (await store.conversation(c.id))!;
    const pending = send(c,"New discussion",direct.currentRevisionId);
    await store.beginConversationRequest(c.id,pending);
    await assert.rejects(store.beginConversationRequest(c.id,pending),/progress|already being made/);
    const stale = (await store.conversation(c.id))!;
    await store.select(project.id,originalBase,"restore");
    await assert.rejects(store.completeDiscussion(pending.requestId,discussion),/changed|another tab/);
    assert.equal((await store.detail(project.id))!.revisions.find(r=>r.id===originalBase)!.notes,raw!.revisions[0].notes);
    c = (await store.conversation(c.id))!;
    assert.equal(c.proposal,null); assert.equal(c.summary,""); assert.ok(c.messages.length>=stale.messages.length);
    await assert.rejects(runConversation(store,c.id,send(stale,"Stale tab",originalBase)),/changed|another tab/);
    await store.select(project.id,originalBase,"publish");
    assert.equal(JSON.stringify(await store.publicGame(project.id)).includes("PRIVATE"),false);
    if (backend==="local") assert.equal(JSON.stringify(await store.publishedGames()).includes("PRIVATE"),false);
    assert.equal(JSON.stringify(studioProject((await store.detail(project.id))!)).includes("PRIVATE notes"),false);
    await asUser(other);
    assert.equal(await stranger.conversation(c.id),null);
    assert.deepEqual(await stranger.conversations(),[]);
    await assert.rejects(stranger.beginConversationRequest(c.id,send(c,"steal",originalBase)),/found/);
    await assert.rejects(stranger.createConversation(project.id),/found/);
    await asUser(owner);
    await assert.rejects(store.deleteConversation(c.id),/options|another tab/);
    const abandoned = await store.createConversation(); await store.deleteConversation(abandoned.id);
    assert.equal(await store.conversation(abandoned.id),null);
    await store.deleteGame(project.id); assert.equal(await store.conversation(c.id),null);
    // Legacy games get notes on their next build and import history without paid backfill.
    const legacy = await store.save({...starters[0],notes:null,prompt:"Legacy idea"});
    const legacyConversation = await store.createConversation(legacy.id);
    assert.equal(legacyConversation.messages.filter(m=>m.kind==="user")[0].text,"Legacy idea");
    assert.deepEqual(recentDiscussion(legacyConversation),[]);
    const editRequest = await store.beginConversationRequest(legacyConversation.id,{requestId:randomUUID(),kind:"direct",version:0,baseRevisionId:legacy.currentRevisionId,prompt:"Precise legacy edit"});
    await assert.rejects(store.beginConversationRequest(legacyConversation.id,{requestId:randomUUID(),kind:"discussion",version:editRequest.version,baseRevisionId:legacy.currentRevisionId,prompt:"Concurrent message"}),/progress|already being made/);
    await store.select(legacy.id,legacy.currentRevisionId,"restore");
    await assert.rejects(store.save({...starters[0],prompt:editRequest.prompt,projectId:legacy.id,baseRevisionId:legacy.currentRevisionId,conversationRequestId:editRequest.id}),/changed|another tab/);
    assert.equal((await store.detail(legacy.id))!.revisions.length,1);
    await store.deleteGame(legacy.id);
    const fresh = await store.createConversation();
    const callCount = calls.length;
    const created = await runConversation(store,fresh.id,{requestId:randomUUID(),kind:"direct",version:0,prompt:"Precise new game"}) as ProjectDetail;
    assert.equal(created.revisions.length,1); assert.equal(calls.length-callCount,2);
    // An expired worker cannot complete or cancel a newer explicit retry.
    const expiredConversation = await store.createConversation();
    const retryInput = send(expiredConversation,"Retry a fictional discussion");
    const expired = await store.beginConversationRequest(expiredConversation.id,retryInput);
    if (database) {
      await database.exec("reset role");
      await database.query("update public.conversation_requests set document=jsonb_set(document,'{startedAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) where id=$1",[expired.id]);
      await asUser(owner);
    } else {
      const file=path.join(directory,"demo.json"); const state=JSON.parse(await readFile(file,"utf8"));
      state.conversationRequests.find((r:{id:string})=>r.id===expired.id).startedAt="2000-01-01T00:00:00Z";
      await writeFile(file,JSON.stringify(state));
    }
    const renewed = await store.beginConversationRequest(expiredConversation.id,retryInput);
    await assert.rejects(store.completeDiscussion(expired.id,discussion,expired.startedAt),/expired|changed|another tab/);
    await store.failConversationRequest(expired.id,expired.startedAt);
    const resumed = await store.completeDiscussion(renewed.id,discussion,renewed.startedAt);
    assert.equal(resumed.messages.filter(m=>m.kind==="user").length,1);
    let count: number;
    if (database) {
      await database.exec("reset role");
      const rows=(await database.query<{finished_at:string|null}>("select finished_at from public.generation_attempts where owner_id=$1",[owner])).rows;
      count=rows.length; assert.ok(rows.every(r=>r.finished_at));
      await asUser(owner);
    } else {
      const state=JSON.parse(await readFile(path.join(directory,"demo.json"),"utf8"));
      count=state.attempts.length; assert.ok(state.attempts.every((r:{finished:boolean})=>r.finished));
    }
    assert.equal(count,calls.length);
    // Discussion shares the existing allowance, including failed provider attempts.
    for(let i=count;i<20;i++) await store.finishGeneration(await store.reserveGeneration());
    const noAllowance = await store.createConversation();
    const beforeQuota = calls.length;
    await assert.rejects(runConversation(store,noAllowance.id,send(noAllowance,"Over the allowance")),/allowance/);
    assert.equal(calls.length,beforeQuota);
    if (database) {
      await database.exec("reset role; set role anon");
      for (const table of ["game_conversations","game_messages","conversation_requests"]) await assert.rejects(database.query(`select * from public.${table}`),/permission denied/);
      await assert.rejects(database.query("select public.conversation_command(null,'list')"),/permission denied/);
      await assert.rejects(database.query("select public.save_game_source(null,null,'x','x','mint',$1,'x',null)",[starters[0].html]),/permission denied/);
    }
  } finally {
    globalThis.fetch = fetcher;
    for (const key of Object.keys(process.env)) if (!(key in beforeEnv)) delete process.env[key];
    Object.assign(process.env,beforeEnv);
    await database?.close(); await rm(directory,{recursive:true,force:true});
  }
});

test("rolling conversational context is six exchanges and 100,000 characters; output bounds reject invalid proposals and summaries",()=>{
  const c: Conversation = {id:randomUUID(),projectId:null,title:"Idea",version:10,summary:"",contextVersion:2,proposal:null,updatedAt:new Date().toISOString(),messages:[]};
  for(let version=1;version<=10;version++) for(const kind of ["user","assistant"] as const) c.messages.push({id:randomUUID(),kind,text:kind+"x".repeat(12000),version,createdAt:c.updatedAt});
  const context=recentDiscussion(c);
  assert.ok(context.length<=12); assert.ok(context.reduce((n,m)=>n+m.text.length,0)<=100000);
  c.contextVersion=9; assert.equal(recentDiscussion(c).length,2);
  for(const value of [{...discussion,summary:"x".repeat(4001)},{...discussion,proposal:"word ".repeat(401)},{...discussion,reply:""}]) assert.throws(()=>validateDiscussion(value),/discussion/);
});
