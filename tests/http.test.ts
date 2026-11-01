import test from "node:test";
import assert from "node:assert/strict";
import { readMutation } from "../src/lib/errors";
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
