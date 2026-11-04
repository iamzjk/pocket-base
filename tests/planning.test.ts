import test from "node:test";
import assert from "node:assert/strict";
import { generateGame } from "../src/lib/generate";
import { starters } from "./fixtures/games";

const names = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_PLANNER_MODEL", "OPENROUTER_MAX_INPUT_PRICE", "OPENROUTER_MAX_OUTPUT_PRICE",
  "OPENROUTER_REASONING_EFFORT", "OPENROUTER_MAX_OUTPUT_TOKENS", "OPENROUTER_PROVIDER_SORT", "OPENROUTER_PLANNER_MAX_INPUT_PRICE", "OPENROUTER_PLANNER_MAX_OUTPUT_PRICE",
  "OPENROUTER_PLANNER_REASONING_EFFORT", "OPENROUTER_PLANNER_MAX_OUTPUT_TOKENS", "OPENROUTER_PLANNER_PROVIDER_SORT", "POCKET_BASE_GENERATION_TIMEOUT_MS", "POCKET_BASE_PLANNING_TIMEOUT_MS", "POCKET_BASE_MAX_PLAN_WORDS"];
async function isolated(run: () => Promise<void>) {
  const before = Object.fromEntries(names.map(name => [name, process.env[name]])), fetcher = globalThis.fetch;
  try {
    for (const name of names) delete process.env[name];
    process.env.OPENROUTER_API_KEY = "fictional-test-key";
    await run();
  } finally {
    globalThis.fetch = fetcher;
    for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; }
  }
}
const response = (value: unknown) => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });

test("creation uses Sol's short plan and exactly one Terra build, with no automatic iteration", async () => {
  await isolated(async () => {
    const requests: Record<string, any>[] = [], events: string[] = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); requests.push(body); events.push(body.model);
      if (requests.length === 1) return response({ plan: "A fictional moon game with large touch controls.", improvementPrompt: "PRIVATE unrequested polish pass" });
      return response(starters[0]);
    };
    const game = await generateGame("Fictional moon catching", undefined, async () => { events.push("reserve build"); });
    assert.equal(game.title, starters[0].title);
    assert.equal(requests.length, 2);
    assert.deepEqual(events, ["openai/gpt-6.1-sol", "reserve build", "openai/gpt-6.1-terra"]);
    assert.deepEqual(requests[0].provider.max_price, { prompt: 2, completion: 10 });
    assert.deepEqual(requests[1].provider.max_price, { prompt: 1, completion: 5 });
    for (const body of requests) { assert.deepEqual(body.reasoning, { effort: "medium", exclude: true }); assert.equal(body.models, undefined); }
    assert.equal(requests[0].max_tokens, 8000); assert.equal(requests[1].max_tokens, 100000);
    assert.match(requests[0].messages[0].content, /up to 400 words/);
    assert.equal(requests[0].messages[1].content, "Fictional moon catching");
    assert.match(requests[1].messages[1].content, /^Fictional moon catching\n/);
    assert.match(requests[1].messages[1].content, /fictional moon game with large touch controls/);
    assert.equal(JSON.stringify(requests[1]).includes("PRIVATE unrequested"), false);
  });
});

test("invalid or incomplete plans stop before charging or calling the builder", async () => {
  await isolated(async () => {
    for (const plan of [null, {}, { plan: " " }, { plan: 4 }, { plan: "word ".repeat(401) }, { plan: "x".repeat(12801) }]) {
      let calls = 0, reserved = false;
      globalThis.fetch = async () => { calls++; return response(plan); };
      await assert.rejects(generateGame("Fictional idea", undefined, async () => { reserved = true; }), /design plan/);
      assert.equal(calls, 1); assert.equal(reserved, false);
    }
    globalThis.fetch = async () => response({ plan: "A valid fictional plan." });
    await assert.rejects(generateGame("Fictional idea", undefined, async () => { throw new Error("Fictional quota"); }), /Fictional quota/);
  });
});

test("planner configuration is separate from builder configuration", async () => {
  await isolated(async () => {
    Object.assign(process.env, { OPENROUTER_PLANNER_MODEL: "vendor/planner", OPENROUTER_PLANNER_MAX_INPUT_PRICE: "0.5", OPENROUTER_PLANNER_MAX_OUTPUT_PRICE: "2",
      OPENROUTER_PLANNER_MAX_OUTPUT_TOKENS: "2048", OPENROUTER_PLANNER_REASONING_EFFORT: "low", OPENROUTER_PLANNER_PROVIDER_SORT: "latency", POCKET_BASE_MAX_PLAN_WORDS: "75" });
    const requests: Record<string, any>[] = [];
    globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return response(requests.length === 1 ? { plan: "A valid fictional plan." } : starters[0]); };
    await generateGame("Fictional idea");
    assert.equal(requests[0].model, "vendor/planner"); assert.equal(requests[0].max_tokens, 2048);
    assert.deepEqual(requests[0].reasoning, { effort: "low", exclude: true });
    assert.deepEqual(requests[0].provider, { max_price: { prompt: 0.5, completion: 2 }, require_parameters: true, sort: "latency" });
    assert.match(requests[0].messages[0].content, /up to 75 words/);
    assert.equal(requests[1].model, "openai/gpt-6.1-terra"); assert.equal(requests[1].max_tokens, 100000);
    assert.deepEqual(requests[1].reasoning, { effort: "medium", exclude: true });
  });
});

test("both phases share one deadline and expired planning cannot start a build", async () => {
  await isolated(async () => {
    const timeout = AbortSignal.timeout, warn = console.warn;
    const timers: { milliseconds: number; controller: AbortController }[] = [];
    try {
      console.warn = () => {};
      AbortSignal.timeout = milliseconds => { const controller = new AbortController(); timers.push({ milliseconds, controller }); return controller.signal; };
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        if (calls === 1) return response({ plan: "A valid fictional plan." });
        assert.equal(init?.signal, timers[0].controller.signal);
        const body = response(starters[0]);
        body.json = async () => { timers[0].controller.abort(); throw new TypeError("PRIVATE interrupted body"); };
        return body;
      };
      await assert.rejects(generateGame("Fictional idea"), error => { assert.equal((error as { status: number }).status, 504); return true; });
      assert.deepEqual(timers.map(timer => timer.milliseconds), [290000, 60000]);
      assert.equal(calls, 2);
      timers.length = 0; calls = 0;
      globalThis.fetch = async () => {
        calls++; const body = response({ plan: "A valid fictional plan." });
        body.json = async () => { timers[1].controller.abort(); throw new TypeError("PRIVATE plan body"); }; return body;
      };
      await assert.rejects(generateGame("Fictional idea"), error => { assert.equal((error as { status: number }).status, 504); return true; });
      assert.equal(calls, 1);
    } finally { AbortSignal.timeout = timeout; console.warn = warn; }
  });
});

test("edits use one builder call and do not depend on planner configuration", async () => {
  await isolated(async () => {
    process.env.OPENROUTER_PLANNER_MODEL = "invalid";
    process.env.OPENROUTER_PLANNER_REASONING_EFFORT = "invalid";
    let calls = 0, reserved = false;
    const previous = { ...starters[0], id: "r1", projectId: "p1", createdAt: new Date().toISOString(), prompt: "Old private prompt" };
    globalThis.fetch = async (_url, init) => {
      calls++; const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "openai/gpt-6.1-terra"); assert.equal(body.messages.length, 3);
      assert.ok(body.messages[1].content.endsWith(previous.html)); assert.equal(body.messages[2].content, "Make it brighter");
      return response(starters[0]);
    };
    await generateGame("Make it brighter", previous, async () => { reserved = true; });
    assert.equal(calls, 1); assert.equal(reserved, false);
  });
});
