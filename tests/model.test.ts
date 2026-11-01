import test from "node:test";
import assert from "node:assert/strict";
import { freeModel, generateGame } from "../src/lib/generate";
import { starters } from "../src/lib/starters";
test("model configuration and requests can only use free inference", async () => {
  const previous = process.env.OPENROUTER_MODEL, key = process.env.OPENROUTER_API_KEY, fetchOriginal = globalThis.fetch;
  try {
    process.env.OPENROUTER_MODEL = "vendor/paid";
    assert.throws(freeModel, /free game-making model/);
    process.env.OPENROUTER_MODEL = "openrouter/free";
    process.env.OPENROUTER_API_KEY = "fictional-test-key";
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "openrouter/free");
      assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
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
