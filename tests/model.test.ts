import test from "node:test";
import assert from "node:assert/strict";
import { generationModel, generateGame, MAX_GENERATION_TOKENS } from "../src/lib/generate";
import { generationSettings } from "../src/lib/config";
import { starters } from "./fixtures/games";
const revision = () => ({ ...starters[0], id: "r1", projectId: "p1", prompt: "Fictional idea", createdAt: new Date().toISOString() });
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
      return Response.json({ choices: [{ message: { content: JSON.stringify(calls === 1 ? { plan: "A fictional star-catching game." } : starters[0]) }, finish_reason: "stop" }] });
    };
    assert.equal((await generateGame("A fictional star game")).title, "Star Catcher");
    assert.equal(calls, 2);
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

test("DeepSeek is explicit, price capped, and uses medium reasoning without model fallback", async () => {
  const previous = process.env.OPENROUTER_MODEL, key = process.env.OPENROUTER_API_KEY, originalFetch = globalThis.fetch;
  try {
    delete process.env.OPENROUTER_MODEL;
    assert.equal(generationModel().model, "openai/gpt-6.1-terra");
    assert.equal(generationModel("plan").model, "openai/gpt-6.1-sol");
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
      assert.deepEqual(body.reasoning, { effort: "medium", exclude: true });
      assert.equal(body.max_tokens, MAX_GENERATION_TOKENS);
      assert.equal(body.models, undefined);
      return Response.json({ choices: [{ message: { content: JSON.stringify(starters[0]) }, finish_reason: "stop" }] });
    };
    assert.equal((await generateGame("A fictional star game", revision())).title, "Star Catcher");
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
      { status: 408, error: { message: privateValue }, message: /ran out of time/, result: 504 },
      { status: 504, error: { message: privateValue }, message: /ran out of time/, result: 504 },
      { status: 200, error: { code: 502, message: privateValue, metadata: { error_type: "timeout" } }, message: /ran out of time/, result: 504 },
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
    await assert.rejects(generateGame("test"), /unreadable response/);
    globalThis.fetch = async () => Response.json(null);
    await assert.rejects(generateGame("test"), /didn't finish/);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "error", message: { content: "PRIVATE partial game" }, error: { code: 504, metadata: { error_type: "timeout" } } }] });
    await assert.rejects(generateGame("test"), /ran out of time/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = originalModel;
  }
});

test("timeouts after successful headers are distinguished from malformed JSON and interrupted connections",async()=>{
  const previousModel=process.env.OPENROUTER_MODEL,previousKey=process.env.OPENROUTER_API_KEY;
  const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout,originalWarn=console.warn;
  const diagnostics:unknown[][]=[];
  let calls=0;
  try {
    process.env.OPENROUTER_MODEL="~deepseek/deepseek-flash-latest";
    process.env.OPENROUTER_API_KEY="PRIVATE key";
    console.warn=(...args:unknown[])=>{diagnostics.push(args);};
    for(const [error,status,pattern] of [
      [new DOMException("PRIVATE timeout","TimeoutError"),504,/ran out of time/],
      [new DOMException("PRIVATE abort","AbortError"),504,/ran out of time/],
      [new TypeError("PRIVATE disconnected"),502,/connection.*interrupted/i],
      [new SyntaxError("PRIVATE malformed payload"),502,/unreadable response/],
    ] as const) {
      globalThis.fetch=async()=>{calls++;const response=new Response("",{headers:{"x-generation-id":"gen-test-123"}});response.json=async()=>{throw error;};return response;};
      await assert.rejects(generateGame("PRIVATE idea"),e=>{
        assert.equal((e as {status:number}).status,status);assert.match((e as Error).message,pattern);return true;
      });
    }
    assert.equal(calls,4); // No automatic retries.
    assert.equal(JSON.stringify(diagnostics).includes("PRIVATE"),false);
    const info=diagnostics[0][1] as Record<string,unknown>;
    assert.equal(info.category,"timeout");assert.equal(info.stage,"body");assert.equal(info.status,200);assert.equal(info.generationId,"gen-test-123");
    // Some fetch implementations report a TypeError when the shared deadline
    // aborts the body. The signal, rather than the error name, is authoritative.
    AbortSignal.timeout=(duration:number)=>{assert.equal(duration,generationSettings().timeoutMs);return AbortSignal.abort(new DOMException("PRIVATE deadline","TimeoutError"));};
    globalThis.fetch=async()=>{const response=new Response("");response.json=async()=>{throw new TypeError("PRIVATE body error");};return response;};
    await assert.rejects(generateGame("PRIVATE idea",revision()),e=>{assert.equal((e as {status:number}).status,504);return true;});
    assert.equal(JSON.stringify(diagnostics).includes("PRIVATE"),false);
  } finally {
    globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;console.warn=originalWarn;
    if(previousModel===undefined)delete process.env.OPENROUTER_MODEL;else process.env.OPENROUTER_MODEL=previousModel;
    if(previousKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previousKey;
  }
});

test("connection failures before headers are reported separately from deadline expiry",async()=>{
  const key=process.env.OPENROUTER_API_KEY,model=process.env.OPENROUTER_MODEL,fetcher=globalThis.fetch,warn=console.warn;
  try {
    process.env.OPENROUTER_API_KEY="fictional-key";process.env.OPENROUTER_MODEL="~deepseek/deepseek-flash-latest";
    console.warn=()=>{};
    globalThis.fetch=async()=>{throw new TypeError("connection failed");};
    await assert.rejects(generateGame("Fictional idea"),e=>{assert.equal((e as {status:number}).status,503);assert.match((e as Error).message,/couldn't connect/);return true;});
    globalThis.fetch=async()=>{throw new DOMException("timed out","TimeoutError");};
    await assert.rejects(generateGame("Fictional idea"),e=>{assert.equal((e as {status:number}).status,504);return true;});
  } finally {
    globalThis.fetch=fetcher;console.warn=warn;
    if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;
    if(model===undefined)delete process.env.OPENROUTER_MODEL;else process.env.OPENROUTER_MODEL=model;
  }
});

test("new games plan and create an SVG icon while edits preserve the stored icon", async () => {
  const model = process.env.OPENROUTER_MODEL, key = process.env.OPENROUTER_API_KEY, originalFetch = globalThis.fetch;
  const firstIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#123456"/></svg>';
  const changedIcon = firstIcon.replace('#123456','#abcdef');
  try {
    process.env.OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash"; process.env.OPENROUTER_API_KEY = "fictional-test-key";
    const requests: { messages: { content: string }[]; max_tokens: number }[] = [];
    globalThis.fetch = async (_url,init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(requests.length === 1
        ? { plan: "A fictional focused game design." }
        : { ...starters[0], designBrief: "A fictional focused design.", iconSvg: requests.length === 2 ? firstIcon : changedIcon }) } }] });
    };
    const created = await generateGame("A fictional new game"); assert.ok(created.iconSvg?.includes('#123456'));
    const previous = { ...created, id: "r1", projectId: "p1", prompt: "Fictional", createdAt: new Date().toISOString() };
    const edited = await generateGame("Make the game faster",previous);
    assert.equal(edited.iconSvg,created.iconSvg);
    assert.equal(requests.length,3); assert.equal(requests[0].max_tokens,8_000); assert.equal(requests[1].max_tokens,100_000);
    assert.match(requests[0].messages[0].content,/single plan string/);
    assert.match(requests[1].messages[0].content,/designBrief/);
    assert.match(requests[1].messages[0].content,/also return iconSvg/);
    assert.match(requests[2].messages[0].content,/Omit iconSvg/);
    assert.ok(requests[2].messages.some(message => message.content.includes(previous.html)));
    assert.equal(requests[2].messages.some(message => message.content.includes(previous.iconSvg!)),false);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "incomplete game" } }] });
    await assert.rejects(generateGame("Fictional long game"),/response limit/);
  } finally {
    globalThis.fetch=originalFetch;
    if(model===undefined)delete process.env.OPENROUTER_MODEL;else process.env.OPENROUTER_MODEL=model;
    if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;
  }
});
