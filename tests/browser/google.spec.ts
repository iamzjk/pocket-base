import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const base="http://127.0.0.1:3218";
async function consent(page:Page, choice:string) {
  await page.goto(base+"/account");
  await page.getByRole("button",{name:"Continue with Google",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Fictional Google consent"})).toBeVisible();
  await page.getByRole("link",{name:choice,exact:true}).click();
}

test("Google signup resumes an empty public-name step, gates private APIs, and supports logout",async({page})=>{
  await consent(page,"New user");
  await expect(page).toHaveURL(base+"/account");
  await expect(page.getByRole("heading",{name:"Choose your public name"})).toBeVisible();
  await expect(page.getByLabel("Public name",{exact:true})).toHaveValue("");
  expect(await (await page.request.get(base+"/api/profile")).json()).toEqual({displayName:null});
  for(const route of ["/api/projects","/api/projects/60000000-0000-4000-8000-000000000001","/api/projects/60000000-0000-4000-8000-000000000001/icon"])
    expect((await page.request.get(base+route)).status()).toBe(403);
  expect((await page.request.post(base+"/api/generate",{headers:{Origin:base},data:{prompt:"Fictional idea"}})).status()).toBe(403);
  await page.reload();await expect(page.getByLabel("Public name",{exact:true})).toHaveValue("");
  await page.goto(base+"/");await expect(page).toHaveURL(base+"/account");
  await page.getByLabel("Public name",{exact:true}).fill("<invalid>");
  await page.getByRole("button",{name:"Open my studio"}).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("public name");
  await page.getByLabel("Public name",{exact:true}).fill("Fictional Google creator");
  await page.getByRole("button",{name:"Open my studio"}).click();
  await expect(page).toHaveURL(base+"/");
  await page.getByRole("button",{name:"Account settings"}).click();
  await expect(page.getByLabel("Public name",{exact:true})).toHaveValue("Fictional Google creator");
  expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.includes("auth-token")))).toBe(false);
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.getByRole("link",{name:"Sign in / Sign up",exact:true})).toBeVisible();
});

test("unfinished Google profiles can sign out",async({page})=>{
  await consent(page,"New user");
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.getByRole("button",{name:"Continue with Google",exact:true})).toBeVisible();
  expect((await page.request.get(base+"/api/profile")).status()).toBe(401);
});

test("returning and automatically linked users retain their public name, user ID, and studio",async({page})=>{
  await page.goto(base+"/account");
  await page.getByLabel("Email",{exact:true}).fill("existing@example.test");
  await page.getByLabel("Password",{exact:true}).fill("fictional-password");
  await page.getByRole("button",{name:"Open my studio"}).click();await expect(page).toHaveURL(base+"/");
  const before=await (await page.request.get(base+"/api/projects")).json();
  const profile=await (await page.request.get(base+"/api/profile")).json();
  await page.getByRole("button",{name:"Account settings"}).click();await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.getByRole("link",{name:"Sign in / Sign up",exact:true})).toBeVisible();
  await consent(page,"Linked email user");await expect(page).toHaveURL(base+"/");
  expect(await (await page.request.get(base+"/api/projects")).json()).toEqual(before);
  expect(await (await page.request.get(base+"/api/profile")).json()).toEqual(profile);
  await page.getByRole("button",{name:"Account settings"}).click();await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.getByRole("link",{name:"Sign in / Sign up",exact:true})).toBeVisible();
  await consent(page,"Returning user");await expect(page).toHaveURL(base+"/");
  expect(await (await page.request.get(base+"/api/profile")).json()).toEqual({displayName:"Returning Google creator"});
});

test("cancelled, missing, expired, invalid, and replayed callbacks fail safely and can retry",async({page,request})=>{
  await consent(page,"Cancel");await expect(page.locator(".auth-card").getByRole("alert")).toContainText("cancelled");
  await consent(page,"Expired code");await expect(page.locator(".auth-card").getByRole("alert")).toContainText("couldn't finish");
  for(const query of ["","?code=invalid&next=https://evil.example","?error=private_provider_error&error_description=PRIVATE"]) {
    const response=await request.get(base+"/auth/callback"+query,{maxRedirects:0});
    expect(response.status()).toBe(303);expect(response.headers().location).toBe("/account?error=google");
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  let callback="";
  page.on("request",request=>{if(request.url().includes("/auth/callback?code="))callback=request.url();});
  await consent(page,"Returning user");await expect(page).toHaveURL(base+"/");
  expect(callback).toContain("code=");
  const replay=await page.request.get(callback,{maxRedirects:0});expect(replay.headers().location).toBe("/account?error=google");
});

test("Google is available on both tabs, supports keyboard access, and fits phones and desktop",async({page,request})=>{
  const evidence=process.env.AGENT_DESK_EVIDENCE_DIR || path.join(os.tmpdir(),"pocket-base-evidence");
  await mkdir(evidence,{recursive:true});
  for(const width of [320,390,1440]) {
    await page.setViewportSize({width,height:900});await page.goto(base+"/account");
    for(const tab of ["Create account","Sign in"]) {
      await page.getByRole("button",{name:tab,exact:true}).click();
      const google=page.getByRole("button",{name:"Continue with Google",exact:true});
      await expect(google).toBeVisible();await google.focus();await expect(google).toBeFocused();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:path.join(evidence,"google-"+tab.replaceAll(" ","-")+"-"+width+".png"),fullPage:true});
    }
  }
  await page.getByRole("button",{name:"Continue with Google",exact:true}).press("Enter");
  await expect(page.getByRole("heading",{name:"Fictional Google consent"})).toBeVisible();
  await page.getByRole("link",{name:"New user",exact:true}).click();
  await expect(page).toHaveURL(base+"/account");
  await expect(page.getByRole("heading",{name:"Choose your public name"})).toBeVisible();
  await expect(page.locator(".account-page")).toHaveCount(1);
  await page.setViewportSize({width:320,height:740});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:path.join(evidence,"google-public-name-320.png"),fullPage:true});
  const disabled=await request.get("http://127.0.0.1:3217/auth/callback?code=fictional",{maxRedirects:0});
  expect(disabled.headers().location).toBe("/account?error=google");
  // The demo server has Google disabled by default even alongside a configured fixture server.
  expect((await request.post("http://127.0.0.1:3217/api/auth",{headers:{Origin:"http://127.0.0.1:3217"},data:{action:"google"}})).status()).toBe(503);
});

test("Google initiation shows progress, rejects cross-origin requests, and recovers from a failed start",async({page,request})=>{
  expect((await request.post(base+"/api/auth",{headers:{Origin:"https://other.example"},data:{action:"google"}})).status()).toBe(403);
  await page.goto(base+"/account");
  let release=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/api/auth",async route=>{
    await gate;
    await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Couldn't start Google sign-in. Please try again."})});
  });
  await page.getByRole("button",{name:"Continue with Google",exact:true}).click();
  await expect(page.getByRole("button",{name:"Connecting to Google…",exact:true})).toBeDisabled();
  await expect(page.getByLabel("Email",{exact:true})).toBeDisabled();
  release();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("Please try again");
  await expect(page.getByRole("button",{name:"Continue with Google",exact:true})).toBeEnabled();
  await page.unroute("**/api/auth");
  await page.getByRole("button",{name:"Continue with Google",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Fictional Google consent"})).toBeVisible();
});
