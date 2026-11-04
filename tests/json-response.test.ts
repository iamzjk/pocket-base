import test from "node:test";
import assert from "node:assert/strict";
import { jsonResponse } from "../src/lib/json-response";

test("large game responses stream JSON in chunks without corrupting Unicode or cache policy",async()=>{
  const value={html:"🎃星".repeat(750000),prompt:"Fictional private prompt"};
  const response=jsonResponse(value);
  assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.equal(response.headers.get("content-type"),"application/json; charset=utf-8");
  assert.equal(response.headers.has("content-length"),false);
  const reader=response.body!.getReader();
  const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;assert.ok(value.byteLength<=65536);chunks.push(value);}
  assert.ok(chunks.length>1);
  const bytes=Buffer.concat(chunks);
  assert.ok(bytes.byteLength>4500000);
  assert.deepEqual(JSON.parse(bytes.toString("utf8")),value);
  const published=jsonResponse({title:"Fictional public game"},{headers:{"Cache-Control":"no-store"}});
  assert.equal(published.headers.get("cache-control"),"no-store");
  assert.deepEqual(await published.json(),{title:"Fictional public game"});
});
