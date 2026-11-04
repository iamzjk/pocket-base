import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const base="http://127.0.0.1:3218";
async function localAuth(page: Page) {
  await page.route("**/auth/v1/**",route=>{
    if(new URL(route.request().url()).origin!=="http://127.0.0.1:3219") {
      void route.abort(); throw new Error("Auth browser checks must only contact the local test service.");
    }
    const body=route.request().method()==="POST" ? route.request().postDataJSON() : null;
    expect(body?.gotrue_meta_security?.captcha_token).toBeUndefined();
    return route.continue();
  });
  await page.route("**/*hcaptcha*",route=>{
    void route.abort();throw new Error("Account forms must not load CAPTCHA services.");
  });
}

test("public signup requires a name, persists a cookie session, and edits public names without CAPTCHA",async({page})=>{
  await localAuth(page);await page.goto(base+"/library");
  await page.getByRole("link",{name:"Sign in / Sign up",exact:true}).click();
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await page.getByLabel("Email",{exact:true}).fill("new-creator@example.test");
  await page.getByLabel("Password",{exact:true}).fill("fictional-password");
  await page.getByRole("button",{name:"Create my account"}).click();
  await expect(page).toHaveURL(base+"/account");
  expect(await page.getByLabel("Public name",{exact:true}).evaluate((input:HTMLInputElement)=>input.validity.valueMissing)).toBe(true);
  await page.getByLabel("Public name",{exact:true}).fill("<invalid>");
  await page.getByRole("button",{name:"Create my account"}).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("public name");
  await page.getByLabel("Public name",{exact:true}).fill("Fictional creator");
  await page.getByRole("button",{name:"Create my account"}).click();
  await expect(page).toHaveURL(base+"/");
  await expect(page.getByRole("button",{name:"Account settings"})).toBeVisible();
  expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.includes("auth-token")))).toBe(false);
  await page.reload();
  await page.getByRole("button",{name:"Account settings"}).click();
  await expect(page.getByLabel("Public name",{exact:true})).toHaveValue("Fictional creator");
  await page.getByLabel("Public name",{exact:true}).fill("Updated creator");
  await page.getByRole("button",{name:"Save public name"}).click();
  await expect(page.getByRole("status")).toContainText("Public name saved");
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.getByRole("link",{name:"Sign in / Sign up",exact:true})).toBeVisible();
});

test("registration rate limits and duplicate emails preserve form data and allow sign-in",async({page})=>{
  await localAuth(page);await page.goto(base+"/account");
  await page.getByLabel("Email",{exact:true}).fill("existing@example.test");
  await page.getByLabel("Password",{exact:true}).fill("fictional-password");
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await page.getByLabel("Public name",{exact:true}).fill("Existing creator");
  await page.getByLabel("Password",{exact:true}).fill("fictional-password");
  await page.route("**/auth/v1/signup",route=>route.fulfill({status:429,contentType:"application/json",body:JSON.stringify({code:"over_request_rate_limit",msg:"Fictional registration limit"})}));
  await page.getByRole("button",{name:"Create my account"}).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("Too many attempts");
  await expect(page.getByLabel("Public name",{exact:true})).toHaveValue("Existing creator");
  await expect(page.getByLabel("Email",{exact:true})).toHaveValue("existing@example.test");
  await page.unroute("**/auth/v1/signup");
  await page.getByRole("button",{name:"Create my account"}).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("already uses");
  await expect(page.getByLabel("Email",{exact:true})).toHaveValue("existing@example.test");
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByLabel("Password",{exact:true}).fill("fictional-password");
  await page.getByRole("button",{name:"Open my studio"}).click();
  await expect(page).toHaveURL(base+"/");
});

test("account forms fit narrow phones and rejected token handoffs never sign in",async({page,request})=>{
  await localAuth(page);await page.setViewportSize({width:320,height:568});await page.goto(base+"/account");
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const denied=await request.post(base+"/api/auth",{headers:{Origin:base},data:{action:"session",accessToken:"forged",refreshToken:"forged"}});
  expect(denied.status()).toBe(401);
  expect(denied.headers()["set-cookie"]).toBeUndefined();
  expect((await request.post(base+"/api/auth",{headers:{Origin:"https://other.example"},data:{action:"session",accessToken:"forged",refreshToken:"forged"}})).status()).toBe(403);
  expect((await request.get(base+"/api/profile")).status()).toBe(401);
});

test("signed-in Supabase sessions load private studio logos through the image endpoint", async ({ page, request }) => {
  await localAuth(page); await page.goto(base + "/account");
  await page.getByLabel("Email", { exact: true }).fill("existing@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fictional-password");
  await page.getByRole("button", { name: "Open my studio" }).click();
  await expect(page).toHaveURL(base + "/");
  const image = page.getByRole("button", { name: "Open Fictional account logo game", exact: true }).locator("img");
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 192)).toBe(true);
  const url = base + await image.getAttribute("src");
  const icon = await page.request.get(url);
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toBe("image/png");
  expect(icon.headers()["cache-control"]).toBe("private, no-store");
  expect((await request.get(url)).status()).toBe(401);
  expect((await page.request.get(base + "/api/projects/60000000-0000-4000-8000-000000000099/icon")).status()).toBe(404);
});

test("public account links and both account forms fit phones and desktop", async ({ page }) => {
  await localAuth(page);
  const evidence = process.env.AGENT_DESK_EVIDENCE_DIR || path.join(os.tmpdir(), "pocket-base-evidence");
  await mkdir(evidence, { recursive: true });
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/", "/library"]) {
      await page.goto(base + route);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("link", { name: "Sign in / Sign up", exact: true }).click();
      await expect(page.getByRole("group", { name: "Account access" })).toBeVisible();
    }
    await page.getByLabel("Email", { exact: true }).fill("fictional-creator@example.test");
    await page.getByLabel("Password", { exact: true }).fill("fictional-password");
    for (const signup of [false, true]) {
      await page.getByRole("button", { name: signup ? "Create account" : "Sign in", exact: true }).click();
      if (signup) await page.getByLabel("Public name", { exact: true }).fill("Fictional creator");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("button", { name: signup ? "Create my account" : "Open my studio" })).toBeVisible();
      await page.screenshot({ path: path.join(evidence, "account-" + (signup ? "signup-" : "signin-") + viewport.width + ".png"), fullPage: true });
    }
  }
});
