import { test, expect, type Page } from "@playwright/test";

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
