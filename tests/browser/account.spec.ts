import { test, expect, type Page } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AuthForm } from "../../src/components/auth-form";
import { PocketMark } from "../../src/components/artwork";

const base="http://127.0.0.1:3218";
async function captcha(page: Page) {
  await page.route("**/auth/v1/**",route=>{
    if(new URL(route.request().url()).origin!=="http://127.0.0.1:3219") {
      void route.abort(); throw new Error("Auth browser checks must only contact the local test service.");
    }
    return route.continue();
  });
  await page.route("https://js.hcaptcha.com/**",route=>route.fulfill({contentType:"application/javascript",body:`
    const widgets = new Map(); let sequence = 0;
    window.hcaptcha = {
      render(container, options) {
        const id = String(++sequence); const button = document.createElement("button");
        button.type = "button"; button.textContent = "Complete security check";
        button.onclick = () => { options.callback("fictional-captcha"); button.disabled = true; };
        container.appendChild(button); widgets.set(id, {container, options});
        window.expireFixtureCaptcha = () => { options["expired-callback"](); button.disabled = false; };
        return id;
      },
      remove(id) { const widget = widgets.get(id); if (widget) widget.container.replaceChildren(); widgets.delete(id); }
    };
    window.pocketCaptchaReady();
  `}));
}

test("public signup requires a name and CAPTCHA, persists a cookie session, and edits public names",async({page})=>{
  await captcha(page);await page.goto(base+"/account");
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await page.getByLabel("Email",{exact:true}).fill("new-creator@example.test");
  await page.getByLabel("Password",{exact:true}).fill("fictional-password");
  await expect(page.getByRole("button",{name:"Create my account"})).toBeDisabled();
  await page.getByRole("button",{name:"Complete security check"}).click();
  await page.getByRole("button",{name:"Create my account"}).click();
  await expect(page).toHaveURL(base+"/account");
  expect(await page.getByLabel("Public name",{exact:true}).evaluate((input:HTMLInputElement)=>input.validity.valueMissing)).toBe(true);
  await page.getByLabel("Public name",{exact:true}).fill("<invalid>");
  await page.getByRole("button",{name:"Create my account"}).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("public name");
  await page.getByLabel("Public name",{exact:true}).fill("Fictional creator");
  await page.getByRole("button",{name:"Complete security check"}).click();
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
  await expect(page.getByRole("link",{name:"Sign in",exact:true})).toBeVisible();
});

test("sign-in handles expired CAPTCHA and duplicate registration without losing form data",async({page})=>{
  await captcha(page);await page.goto(base+"/account");
  await page.getByLabel("Email",{exact:true}).fill("existing@example.test");
  await page.getByLabel("Password",{exact:true}).fill("fictional-password");
  await page.getByRole("button",{name:"Complete security check"}).click();
  await page.evaluate("window.expireFixtureCaptcha()");
  await expect(page.getByRole("button",{name:"Open my studio"})).toBeDisabled();
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  await page.getByLabel("Public name",{exact:true}).fill("Existing creator");
  await page.getByLabel("Password",{exact:true}).fill("fictional-password");
  await page.getByRole("button",{name:"Complete security check"}).click();
  await page.getByRole("button",{name:"Create my account"}).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("already uses");
  await expect(page.getByLabel("Email",{exact:true})).toHaveValue("existing@example.test");
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByLabel("Password",{exact:true}).fill("fictional-password");
  await page.getByRole("button",{name:"Complete security check"}).click();
  await page.getByRole("button",{name:"Open my studio"}).click();
  await expect(page).toHaveURL(base+"/");
});

test("account forms fit narrow phones and rejected token handoffs never sign in",async({page,request})=>{
  await captcha(page);await page.setViewportSize({width:320,height:568});await page.goto(base+"/account");
  await page.getByRole("button",{name:"Create account",exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const denied=await request.post(base+"/api/auth",{headers:{Origin:base},data:{action:"session",accessToken:"forged",refreshToken:"forged"}});
  expect(denied.status()).toBe(401);
  expect(denied.headers()["set-cookie"]).toBeUndefined();
  expect((await request.post(base+"/api/auth",{headers:{Origin:"https://other.example"},data:{action:"session",accessToken:"forged",refreshToken:"forged"}})).status()).toBe(403);
  expect((await request.get(base+"/api/profile")).status()).toBe(401);
});

test("signed-in Supabase sessions load private studio logos through the image endpoint", async ({ page, request }) => {
  await captcha(page); await page.goto(base + "/account");
  await page.getByLabel("Email", { exact: true }).fill("existing@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fictional-password");
  await page.getByRole("button", { name: "Complete security check" }).click();
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

test("sign-in-only layout has no redundant selector and fits phones and desktop", async ({ page }) => {
  // Render the real component with pending CAPTCHA configuration for a layout-only fixture.
  const stylesheet = await readFile(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const markup = renderToStaticMarkup(createElement("main", { className: "account-page" },
    createElement("a", { className: "brand", href: "/", "aria-label": "Pocket Base home" },
      createElement(PocketMark), createElement("span", null, "pocket", createElement("span", { className: "brand-light" }, "base"))),
    createElement(AuthForm, { config: { url: "http://127.0.0.1:3219", key: "fictional-key" } })));
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'
    + stylesheet + '</style></head><body>' + markup + '</body></html>');
  await expect(page.getByRole("group", { name: "Account access" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Welcome to your studio" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("fictional-creator@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fictional-password");
  const evidence = process.env.AGENT_DESK_EVIDENCE_DIR || path.join(os.tmpdir(), "pocket-base-evidence");
  await mkdir(evidence, { recursive: true });
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Open my studio" })).toBeVisible();
    await page.screenshot({ path: path.join(evidence, "account-signin-" + viewport.width + ".png"), fullPage: true });
  }
});
