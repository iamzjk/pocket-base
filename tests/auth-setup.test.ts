import test from "node:test";
import assert from "node:assert/strict";

test("auth setup enables signup and its rate-limit hook while disabling CAPTCHA",async()=>{
  const {configureAuth}=await import("../scripts/configure-auth.mjs");
  const env={NEXT_PUBLIC_SUPABASE_URL:"https://abcdefghijklmnopqrst.supabase.co",SUPABASE_ACCESS_TOKEN:"fictional-private-token",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"fictional-publishable-key"};
  let config:Record<string,unknown>={disable_signup:true,mailer_autoconfirm:false,password_min_length:12,
    security_captcha_enabled:true,security_captcha_secret:"PRIVATE response",rate_limit_token_refresh:100,rate_limit_verify:20};
  const writes:Record<string,unknown>[]=[];
  const fetcher:typeof fetch=async(url,options)=>{
    if(String(url).includes("studio_migration_versions"))return Response.json(["001","002","003","004","005","006","007","008"]);
    assert.equal(String(url),"https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth");
    assert.equal((options?.headers as Record<string,string>).Authorization,"Bearer fictional-private-token");
    if(options?.method==="PATCH") {const body=JSON.parse(String(options.body));writes.push(body);config={...config,...body};}
    return Response.json(config);
  };
  const check=await configureAuth({env,fetcher});
  assert.deepEqual(check,{signupEnabled:false,immediateSignIn:false,captchaDisabled:false,signupHookEnabled:false,googleProviderEnabled:false,googleCredentialsConfigured:false,googleSiteConfigured:false,googleCallbackAllowed:false,googleSignInEnabled:false});
  assert.equal(JSON.stringify(check).includes("PRIVATE"),false);assert.equal(writes.length,0);
  await assert.rejects(configureAuth({env:{...env,VERCEL_ENV:"preview"},fetcher,apply:true}),/Preview environments/);
  assert.equal(writes.length,0);
  const result=await configureAuth({env,fetcher,apply:true});
  assert.deepEqual(result,{signupEnabled:true,immediateSignIn:true,captchaDisabled:true,signupHookEnabled:true,googleProviderEnabled:false,googleCredentialsConfigured:false,googleSiteConfigured:false,googleCallbackAllowed:false,googleSignInEnabled:false});
  assert.equal(writes.length,1);assert.equal(writes[0].password_min_length,12);
  assert.equal(writes[0].security_captcha_enabled,false);
  assert.equal(writes[0].security_captcha_secret,undefined);
  assert.equal(config.rate_limit_token_refresh,100);
  assert.equal(config.rate_limit_verify,20);
  assert.equal(writes[0].hook_before_user_created_uri,"pg-functions://postgres/public/before_user_created");
  assert.equal(writes[0].external_anonymous_users_enabled,false);
  config.hook_before_user_created_uri="pg-functions://postgres/public/unrelated_hook";
  await assert.rejects(configureAuth({env,fetcher,apply:true}),/different signup hook/);
  assert.equal(writes.length,1);
});

test("auth setup refuses pending migrations and never exposes raw provider errors",async()=>{
  const {configureAuth}=await import("../scripts/configure-auth.mjs");
  const env={NEXT_PUBLIC_SUPABASE_URL:"https://abcdefghijklmnopqrst.supabase.co",SUPABASE_ACCESS_TOKEN:"fictional-private-token",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"fictional-publishable-key"};
  const pending:typeof fetch=async url=>Response.json(String(url).includes("studio_migration_versions") ? ["001"] : {});
  await assert.rejects(configureAuth({env,fetcher:pending,apply:true}),/Apply Pocket Base release migrations/);
  await assert.rejects(configureAuth({env,fetcher:async()=>Response.json({message:"PRIVATE response"},{status:401})}),e=>{
    assert.match((e as Error).message,/HTTP 401/);assert.equal((e as Error).message.includes("PRIVATE"),false);return true;
  });
});

test("explicit Google setup preserves other providers and allowlist entries and reports only safe readiness flags",async()=>{
  const {configureAuth}=await import("../scripts/configure-auth.mjs");
  const env={NEXT_PUBLIC_SUPABASE_URL:"https://abcdefghijklmnopqrst.supabase.co",SUPABASE_ACCESS_TOKEN:"PRIVATE token",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"fictional-key",
    GOOGLE_OAUTH_CLIENT_ID:"PRIVATE client",GOOGLE_OAUTH_CLIENT_SECRET:"PRIVATE secret",POCKET_BASE_SITE_URL:"https://studio.example"};
  let config:Record<string,unknown>={uri_allow_list:"https://unrelated.example/auth",external_github_enabled:true,password_min_length:14,rate_limit_verify:10};
  let writes=0;
  const fetcher:typeof fetch=async(url,options)=>{
    if(String(url).includes("studio_migration_versions"))return Response.json(["005","006","007","008","013"]);
    if(options?.method==="PATCH") {writes++; config={...config,...JSON.parse(String(options.body))};}
    return Response.json(config);
  };
  await assert.rejects(configureAuth({env:{...env,GOOGLE_OAUTH_CLIENT_SECRET:""},fetcher,apply:true,google:true}),/private GOOGLE/);
  for(const site of ["https://studio.example/path","http://studio.example","https://user:password@studio.example"]) await assert.rejects(configureAuth({env:{...env,POCKET_BASE_SITE_URL:site},fetcher,apply:true,google:true}),/canonical/);
  assert.equal(writes,0);
  const status=await configureAuth({env,fetcher,apply:true,google:true});
  assert.equal(status.googleProviderEnabled,true);assert.equal(status.googleCredentialsConfigured,true);
  assert.equal(status.googleSiteConfigured,true);assert.equal(status.googleCallbackAllowed,true);assert.equal(status.googleSignInEnabled,false);
  assert.equal(JSON.stringify(status).includes("PRIVATE"),false);
  assert.equal(config.external_google_client_id,env.GOOGLE_OAUTH_CLIENT_ID);assert.equal(config.external_google_secret,env.GOOGLE_OAUTH_CLIENT_SECRET);
  assert.equal(config.uri_allow_list,"https://unrelated.example/auth,https://studio.example/auth/callback");
  assert.equal(config.external_github_enabled,true);assert.equal(config.rate_limit_verify,10);assert.equal(config.password_min_length,14);
  await configureAuth({env,fetcher,apply:true,google:true});
  assert.equal(config.uri_allow_list,"https://unrelated.example/auth,https://studio.example/auth/callback");
  const enabled=await configureAuth({env:{...env,POCKET_BASE_GOOGLE_SIGN_IN:"true"},fetcher});assert.equal(enabled.googleSignInEnabled,true);
  await configureAuth({env:{...env,VERCEL_ENV:"preview"},fetcher});
  assert.equal(writes,2);
  await assert.rejects(configureAuth({env,apply:true,google:true,fetcher:async url=>Response.json(String(url).includes("studio_migration_versions")?["005","006","007","008"]:{})}),/Apply Pocket Base/);
});
