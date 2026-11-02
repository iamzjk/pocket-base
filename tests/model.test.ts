import test from "node:test";
import assert from "node:assert/strict";
import { generationModel, generateGame } from "../src/lib/generate";
import { starters } from "../src/lib/starters";
test("free model requests enforce zero-price providers", async () => {
  const previous = process.env.OPENROUTER_MODEL, key = process.env.OPENROUTER_API_KEY, fetchOriginal = globalThis.fetch;
  try {
    process.env.OPENROUTER_MODEL = "vendor/paid";
    assert.throws(generationModel, /supported game-making model/);
    process.env.OPENROUTER_MODEL = "openrouter/free";
    process.env.OPENROUTER_API_KEY = "fictional-test-key";
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "openrouter/free");
      assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
      assert.equal(body.provider.require_parameters, true);
      assert.equal(body.models, undefined);
      return Response.json({ choices: [{ message: { content: JSON.stringify(starters[0]) }, finish_reason: "stop" }] });
    };
    assert.equal((await generateGame("A fictional star game")).title, "Star Catcher");
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response("provider details should not escape", { status: 429 });
    await assert.rejects(generateGame("test"), /allowance/);
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(generateGame("test"), /isn't connected/);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (previous === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = previous;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
  }
});

test("DeepSeek is explicit, price capped, and uses no model fallback or extra reasoning", async () => {
  const previous = process.env.OPENROUTER_MODEL, key = process.env.OPENROUTER_API_KEY, originalFetch = globalThis.fetch;
  try {
    delete process.env.OPENROUTER_MODEL;
    assert.equal(generationModel().model, "deepseek/deepseek-v4.1-flash");
    process.env.OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash";
    process.env.OPENROUTER_API_KEY = "fictional-test-key";
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "deepseek/deepseek-v4.1-flash");
      assert.deepEqual(body.provider.max_price, { prompt: 0.30, completion: 1.20 });
      assert.equal(body.provider.sort, "price");
      assert.equal(body.provider.require_parameters, true);
      assert.deepEqual(body.reasoning, { enabled: false });
      assert.equal(body.max_tokens, 10_000);
      assert.equal(body.models, undefined);
      return Response.json({ choices: [{ message: { content: JSON.stringify(starters[0]) }, finish_reason: "stop" }] });
    };
    assert.equal((await generateGame("A fictional star game")).title, "Star Catcher");
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ error: { message: "No endpoint under price cap" } }, { status: 404 });
    await assert.rejects(generateGame("test"), error => {
      assert.match((error as Error).message, /within the configured price caps/);
      assert.equal((error as Error).message.includes("free"), false);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = previous;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
  }
});

test("provider failures explain the problem without leaking upstream data or retrying", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;
  try {
    process.env.OPENROUTER_API_KEY = "fictional-test-key";
    process.env.OPENROUTER_MODEL = "openrouter/free";
    const privateValue = "fictional-private-provider-value";
    const cases = [
      { status: 400, error: { metadata: { provider_name: "Google AI Studio", raw: JSON.stringify({ error: { reason: "API_KEY_INVALID", message: privateValue } }) } }, message: /provider rejected its credentials/, result: 502 },
      { status: 401, error: { message: privateValue }, message: /check OPENROUTER_API_KEY/, result: 503 },
      { status: 402, error: { message: privateValue }, message: /account allowance/, result: 503 },
      { status: 403, error: { message: privateValue }, message: /blocked this request/, result: 502 },
      { status: 404, error: { message: privateValue }, message: /No free game-making provider/, result: 503 },
      { status: 429, error: { message: privateValue }, message: /allowance/, result: 429 },
      { status: 503, error: { message: privateValue }, message: /unavailable right now/, result: 502 },
      { status: 200, error: { code: 429, message: privateValue }, message: /allowance/, result: 429 },
    ];
    for (const item of cases) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json({ error: item.error }, { status: item.status }); };
      await assert.rejects(generateGame("A fictional test game"), error => {
        assert.match((error as Error).message, item.message);
        assert.equal((error as { status: number }).status, item.result);
        assert.equal((error as Error).message.includes(privateValue), false);
        return true;
      });
      assert.equal(calls, 1);
    }
    globalThis.fetch = async () => new Response(privateValue, { status: 502 });
    await assert.rejects(generateGame("test"), /unavailable right now/);
    globalThis.fetch = async () => new Response(privateValue);
    await assert.rejects(generateGame("test"), /readable response/);
    globalThis.fetch = async () => Response.json(null);
    await assert.rejects(generateGame("test"), /didn't finish/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = originalModel;
  }
});
