import test from "node:test";
import assert from "node:assert/strict";
import { readMutation } from "../src/lib/errors";
import { MAX_PROMPT_CHARACTERS, MAX_MUTATION_BYTES } from "../src/lib/limits";
test("same-origin browser requests work behind Next's internal hostname while cross-origin requests fail", async () => {
  const request = (origin: string) => new Request("http://localhost:3217/api/projects", {
    method: "POST", headers: { host: "127.0.0.1:3217", origin, "content-type": "application/json" },
    body: JSON.stringify({ starter: "memory" }),
  });
  assert.deepEqual(await readMutation(request("http://127.0.0.1:3217")), { starter: "memory" });
  await assert.rejects(readMutation(request("https://other.example")), /make changes from your studio/);
  const production = new Request("http://internal/api/projects", {
    method: "POST", headers: { host: "pocket.example", origin: "https://pocket.example",
      "x-forwarded-proto": "https", "content-type": "application/json" }, body: "{}",
  });
  assert.deepEqual(await readMutation(production), {});
});

test("100,000-character Unicode prompts fit even when JSON escapes every character",async()=>{
  const escaped='{"prompt":"'+"\\u661f".repeat(MAX_PROMPT_CHARACTERS)+'"}';
  const request=(body:string)=>new Request("https://pocket.example/api/generate",{method:"POST",
    headers:{host:"pocket.example",origin:"https://pocket.example","content-type":"application/json"},body});
  assert.deepEqual(await readMutation(request(escaped)),{prompt:"星".repeat(MAX_PROMPT_CHARACTERS)});
  await assert.rejects(readMutation(request(JSON.stringify({prompt:"a".repeat(MAX_MUTATION_BYTES)}))),/too long/);
});

test("oversized chunked requests are stopped before the entire body is read",async()=>{
  let cancelled=false;
  const body=new ReadableStream<Uint8Array>({
    pull(controller){controller.enqueue(new Uint8Array(MAX_MUTATION_BYTES+1));},
    cancel(){cancelled=true;},
  });
  const request=new Request("https://pocket.example/api/generate",{method:"POST",
    headers:{origin:"https://pocket.example","content-type":"application/json"},body,duplex:"half"} as RequestInit);
  await assert.rejects(readMutation(request),error=>{assert.equal((error as {status:number}).status,413);return true;});
  assert.equal(cancelled,true);
});
