import test from "node:test";
import assert from "node:assert/strict";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finishGoogle, googleEnabled, googleSite, startGoogle } from "../src/lib/google-auth";

const env = { POCKET_BASE_GOOGLE_SIGN_IN: "true", POCKET_BASE_SITE_URL: "https://studio.example" };
test("Google is opt-in and only starts from the canonical origin", async () => {
  let calls = 0;
  const client = { auth: { signInWithOAuth: async () => { calls++; throw new Error("PRIVATE provider failure"); } } } as unknown as SupabaseClient;
  assert.equal(googleEnabled({}), false);
  assert.equal(googleEnabled({ VERCEL_ENV: "preview" }), false);
  for (const site of ["http://public.example", "https://user:pass@example.test", "https://example.test/path", "https://example.test?next=other", "javascript:alert(1)"])
    assert.equal(googleSite({ POCKET_BASE_SITE_URL: site }), null);
  assert.equal(googleSite({ POCKET_BASE_SITE_URL: "http://localhost:3000" }), "http://localhost:3000");
  assert.equal(googleSite({ POCKET_BASE_SITE_URL: "http://localhost:3000", VERCEL: "1" }), null);
  await assert.rejects(startGoogle(client, "https://studio.example", {}), /isn't available/);
  await assert.rejects(startGoogle(client, "https://other.example", env), /main address/);
  assert.equal(calls, 0);
  await assert.rejects(startGoogle(client, "https://studio.example", env), /Couldn't start Google/);
});

test("Supabase SSR persists a PKCE verifier cookie and exchanges it for verified session cookies", async () => {
  const jar = new Map<string, string>();
  const writes: { name: string; value: string; options: CookieOptions }[] = [];
  const requests: { url: string; body: Record<string, string> }[] = [];
  const access = ["e30", Buffer.from(JSON.stringify({ sub: "fictional-user", exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url"), "fictional"].join(".");
  const create = () => createServerClient("https://fictional.supabase.co", "fictional-publishable", {
    cookies: { getAll: () => [...jar].map(([name,value]) => ({name,value})), setAll: entries => {
      for (const entry of entries) { writes.push(entry); jar.set(entry.name, entry.value); }
    } },
    global: { fetch: async (input, init) => {
      const url = String(input), body = JSON.parse(String(init?.body || "{}"));
      requests.push({url,body});
      if (url.endsWith("/user")) return Response.json({ id: "fictional-user", email: "creator@example.test" });
      if (url.endsWith("/creator_profile")) return Response.json({displayName:null});
      return Response.json({ access_token: access, refresh_token: "issued-refresh", token_type: "bearer", expires_in:3600, user: { id: "fictional-user" } });
    } },
  });
  const { url } = await startGoogle(create(), "https://studio.example", env);
  const authorization = new URL(url);
  assert.equal(authorization.pathname, "/auth/v1/authorize");
  assert.equal(authorization.searchParams.get("provider"), "google");
  assert.equal(authorization.searchParams.get("redirect_to"), "https://studio.example/auth/callback");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "s256");
  assert.ok(authorization.searchParams.get("code_challenge"));
  assert.equal(authorization.searchParams.get("scopes"), "openid email profile");
  assert.ok(writes.some(entry => entry.name.endsWith("-code-verifier") && entry.value));
  assert.equal(await finishGoogle(create(), new URLSearchParams({code:"issued-code",next:"https://evil.example"})), "/account");
  const exchange = requests.find(request => request.url.includes("grant_type=pkce"))!;
  assert.equal(exchange.body.auth_code, "issued-code");
  assert.ok(exchange.body.code_verifier);
  assert.ok(requests.some(request => request.url.endsWith("/user")));
  assert.ok(writes.some(entry => entry.name === "sb-fictional-auth-token" && entry.value));
  assert.ok(writes.some(entry => entry.name.endsWith("-code-verifier") && !entry.value));
});

test("callbacks use fixed destinations and never expose provider errors", async () => {
  let exchanges=0, verified=true, name:string|null="Existing creator", exchangeError=false;
  const client={auth:{exchangeCodeForSession:async()=>{exchanges++;return {data:{session:{}},error:exchangeError?{message:"PRIVATE expired or replayed code"}:null};},getUser:async()=>({data:{user:verified?{id:"existing"}:null},error:null})},rpc:async()=>({data:{displayName:name},error:null})} as unknown as SupabaseClient;
  for (const params of [new URLSearchParams(),new URLSearchParams({error:"provider_failure",error_description:"PRIVATE"}),new URLSearchParams({code:"x".repeat(4097)})])
    assert.equal(await finishGoogle(client,params),"/account?error=google");
  assert.equal(await finishGoogle(client,new URLSearchParams({error:"access_denied"})),"/account?error=google_cancelled");
  assert.equal(exchanges,0);
  assert.equal(await finishGoogle(client,new URLSearchParams({code:"valid",next:"//evil.example"})),"/");
  name=null; assert.equal(await finishGoogle(client,new URLSearchParams({code:"valid"})),"/account");
  verified=false; assert.equal(await finishGoogle(client,new URLSearchParams({code:"valid"})),"/account?error=google");
  exchangeError=true; assert.equal(await finishGoogle(client,new URLSearchParams({code:"expired"})),"/account?error=google");
});
