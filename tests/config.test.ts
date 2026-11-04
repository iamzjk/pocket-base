import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentLimits, generationSettings, planningSettings } from "../src/lib/config";
import { generationModel, generateGame } from "../src/lib/generate";
import { validateGame } from "../src/lib/game";
import { DemoStore } from "../src/lib/demo-store";
import { SupabaseStore } from "../src/lib/supabase-store";
import { Studio } from "../src/components/studio";
import { starters } from "./fixtures/games";

const names=["POCKET_BASE_MAX_PROMPT_CHARACTERS","POCKET_BASE_MAX_GAME_BYTES","POCKET_BASE_GENERATION_TIMEOUT_MS","OPENROUTER_MAX_OUTPUT_TOKENS","OPENROUTER_REASONING_EFFORT","OPENROUTER_PROVIDER_SORT","OPENROUTER_MAX_INPUT_PRICE","OPENROUTER_MAX_OUTPUT_PRICE","OPENROUTER_MODEL","OPENROUTER_API_KEY",
  "POCKET_BASE_PLANNING_TIMEOUT_MS","POCKET_BASE_MAX_PLAN_WORDS","OPENROUTER_PLANNER_MODEL","OPENROUTER_PLANNER_MAX_OUTPUT_TOKENS","OPENROUTER_PLANNER_REASONING_EFFORT","OPENROUTER_PLANNER_PROVIDER_SORT","OPENROUTER_PLANNER_MAX_INPUT_PRICE","OPENROUTER_PLANNER_MAX_OUTPUT_PRICE"];
async function environment(values:Record<string,string>,run:()=>unknown|Promise<unknown>){
  const before=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try{for(const name of names)delete process.env[name];Object.assign(process.env,values);await run();}
  finally{for(const name of names){if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];}}
}

test("default limits and rendered input limits match the documented configuration",async()=>{
  await environment({},()=>{
    assert.deepEqual(contentLimits(),{maxPromptCharacters:100000,maxGameBytes:5000000,maxMutationBytes:602048});
    assert.deepEqual(generationSettings(),{timeoutMs:290000,maxTokens:100000,reasoningEffort:"medium",providerSort:"price"});
    assert.deepEqual(planningSettings(),{timeoutMs:60000,maxTokens:8000,maxPlanWords:400,reasoningEffort:"medium",providerSort:"price"});
    const markup=renderToStaticMarkup(createElement(Studio,{initialDisplayName:"",version:"test",view:"studio",initialProjects:[],initialLibrary:{games:[],hasMore:false},signedIn:false,demo:false,configured:true,aiConnected:false,maxPromptCharacters:73}));
    assert.ok(markup.includes('maxLength="73"'));
  });
});

test("runtime settings reach provider requests, including Terra's own price caps",async()=>{
  await environment({OPENROUTER_MODEL:"openai/gpt-6.1-terra",OPENROUTER_API_KEY:"fictional",POCKET_BASE_GENERATION_TIMEOUT_MS:"280000",OPENROUTER_MAX_OUTPUT_TOKENS:"8192",OPENROUTER_REASONING_EFFORT:"low",OPENROUTER_PROVIDER_SORT:"latency"},async()=>{
    const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout;
    let calls=0;
    try{
      AbortSignal.timeout=duration=>{assert.equal(duration,280000);return new AbortController().signal;};
      globalThis.fetch=async(_input,init)=>{
        calls++;const body=JSON.parse(String(init?.body));
        assert.equal(body.model,"openai/gpt-6.1-terra");assert.equal(body.max_tokens,8192);
        assert.deepEqual(body.provider,{max_price:{prompt:1,completion:5},require_parameters:true,sort:"latency"});
        assert.deepEqual(body.reasoning,{effort:"low",exclude:true});assert.equal(body.models,undefined);
        return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(starters[0])}}]});
      };
      await generateGame("A fictional edit",{...starters[0],id:"r1",projectId:"p1",prompt:"Fictional",createdAt:new Date().toISOString()});assert.equal(calls,1);
    }finally{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;}
  });
});

test("custom models require both price caps and free routing stays free",async()=>{
  await environment({OPENROUTER_MODEL:"vendor/custom"},()=>{assert.throws(generationModel,/price caps/);});
  await environment({OPENROUTER_MODEL:"vendor/custom",OPENROUTER_MAX_INPUT_PRICE:"0.5",OPENROUTER_MAX_OUTPUT_PRICE:"2"},()=>{assert.deepEqual(generationModel().provider.max_price,{prompt:0.5,completion:2});});
  await environment({OPENROUTER_MODEL:"openrouter/free",OPENROUTER_MAX_INPUT_PRICE:"10",OPENROUTER_MAX_OUTPUT_PRICE:"10"},()=>{assert.deepEqual(generationModel().provider.max_price,{prompt:0,completion:0});});
  await environment({OPENROUTER_MODEL:"openrouter/free"},()=>{assert.equal(generationModel("plan").model,"openrouter/free");assert.deepEqual(generationModel("plan").provider.max_price,{prompt:0,completion:0});});
  await environment({OPENROUTER_MODEL:"openrouter/free",OPENROUTER_PLANNER_MODEL:"openai/gpt-6.1-sol"},()=>{assert.throws(()=>generationModel("plan"),/free planner/);});
});

test("invalid settings fail before any provider request and never echo their values",async()=>{
  await environment({POCKET_BASE_GENERATION_TIMEOUT_MS:"290000"},()=>assert.equal(generationSettings().timeoutMs,290000));
  for(const [name,value,read] of [
    ["POCKET_BASE_MAX_PROMPT_CHARACTERS","100001",contentLimits],
    ["POCKET_BASE_MAX_GAME_BYTES","10000001",contentLimits],
    ["POCKET_BASE_GENERATION_TIMEOUT_MS","290001",generationSettings],
    ["OPENROUTER_MAX_OUTPUT_TOKENS","1.5",generationSettings],
    ["OPENROUTER_REASONING_EFFORT","PRIVATE",generationSettings],
    ["OPENROUTER_PROVIDER_SORT","PRIVATE",generationSettings],
    ["OPENROUTER_MAX_INPUT_PRICE","PRIVATE",generationModel],
    ["POCKET_BASE_MAX_PLAN_WORDS","1001",planningSettings],
    ["POCKET_BASE_PLANNING_TIMEOUT_MS","290001",planningSettings],
    ["OPENROUTER_PLANNER_REASONING_EFFORT","PRIVATE",planningSettings],
    ["OPENROUTER_PLANNER_PROVIDER_SORT","PRIVATE",planningSettings],
  ] as const){
    await environment({[name]:value},()=>{assert.throws(read,error=>{assert.ok((error as Error).message.includes(name));assert.equal((error as Error).message.includes("PRIVATE"),false);return true;});});
  }
});

test("source limits count UTF-8 bytes and can increase without changing validation safety",async()=>{
  const game={...starters[0],html:starters[0].html+" ".repeat(1000000)};
  await environment({POCKET_BASE_MAX_GAME_BYTES:"1000000"},()=>assert.throws(()=>validateGame(game),/too big/));
  await environment({POCKET_BASE_MAX_GAME_BYTES:"1500000"},()=>{assert.equal(validateGame(game).title,game.title);});
  await environment({POCKET_BASE_MAX_GAME_BYTES:"10000"},()=>assert.throws(()=>validateGame({...starters[0],html:starters[0].html+"星".repeat(4000)}),/too big/));
});

test("both stores enforce configured prompt and source limits before writing",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"pocket-config-"));
  let writes=0;
  const hosted=new SupabaseStore({rpc:async()=>{writes++;return {data:null,error:null};}} as unknown as SupabaseClient);
  try{
    await environment({POCKET_BASE_MAX_PROMPT_CHARACTERS:"3",POCKET_BASE_MAX_GAME_BYTES:"10000"},async()=>{
      for(const store of [new DemoStore(undefined,dir),hosted]){
        await assert.rejects(store.save({...starters[0],prompt:"long"}),/1 to 3 characters/);
        await assert.rejects(store.save({...starters[0],prompt:"ok",html:" ".repeat(10001)}),/size limit/);
      }
      assert.equal(writes,0);
    });
    await environment({},async()=>{const saved=await new DemoStore(undefined,dir).save({...starters[0],prompt:"星".repeat(100000)});assert.equal(saved.revisions[0].prompt.length,100000);});
  }finally{await rm(dir,{recursive:true,force:true});}
});
