import { fileURLToPath } from "node:url";
import path from "node:path";
import { projectEnvironment } from "./migrate.mjs";

const hook = "pg-functions://postgres/public/before_user_created";
function googleSite(env) {
  try {
    const site=new URL(env.POCKET_BASE_SITE_URL || "");
    const local=!env.VERCEL && ["localhost","127.0.0.1","[::1]"].includes(site.hostname);
    if((site.protocol!=="https:" && !(local && site.protocol==="http:")) || site.username || site.password || site.pathname!=="/" || site.search || site.hash) return null;
    return site.origin;
  } catch {return null;}
}
/**
 * Run only after the new account UI is deployed. Never called by app startup.
 * @param {{env?: Record<string, string | undefined>, fetcher?: typeof fetch, apply?: boolean, google?: boolean}} options
 */
export async function configureAuth(options = {}) {
  const env = options.env || await projectEnvironment(fileURLToPath(new URL("../",import.meta.url)));
  const fetcher = options.fetcher || fetch;
  const apply = options.apply || false;
  if (apply && env.VERCEL_ENV && env.VERCEL_ENV !== "production") throw new Error("Preview environments cannot change shared authentication settings.");
  const site=googleSite(env);
  const callback=site ? site+"/auth/callback" : null;
  if(apply && options.google && (!site || !env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET))
    throw new Error("Set private GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and a canonical POCKET_BASE_SITE_URL before configuring Google.");
  const match=env.NEXT_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/);
  if (!match || !env.SUPABASE_ACCESS_TOKEN) throw new Error("Set the hosted Supabase URL and SUPABASE_ACCESS_TOKEN in your private environment.");
  const url=`https://api.supabase.com/v1/projects/${match[1]}/config/auth`;
  const headers={Authorization:"Bearer "+env.SUPABASE_ACCESS_TOKEN,"Content-Type":"application/json"};
  const read=async()=>{
    const response=await fetcher(url,{headers,signal:AbortSignal.timeout(20_000)});
    if(!response.ok)throw new Error(`Couldn't check Supabase authentication settings (HTTP ${response.status}).`);
    return response.json();
  };
  let config=await read();
  if(apply) {
    const ready=await fetcher(env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,"")+"/rest/v1/rpc/studio_migration_versions",{
      method:"POST",headers:{apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(20_000),
    });
    const versions=ready.ok ? await ready.json() : [];
    if(!Array.isArray(versions) || !["005","006","007","008",...(options.google ? ["013","014"] : [])].every(v=>versions.includes(v)))throw new Error("Apply Pocket Base release migrations before enabling signup.");
    if(config.hook_before_user_created_enabled && config.hook_before_user_created_uri !== hook)
      throw new Error("A different signup hook is active. Preserve it and review the configuration before changing it.");
    const response=await fetcher(url,{method:"PATCH",headers,signal:AbortSignal.timeout(20_000),body:JSON.stringify({
      disable_signup:false,external_email_enabled:true,external_anonymous_users_enabled:false,mailer_autoconfirm:true,
      password_min_length:Math.max(8,Number(config.password_min_length)||0),
      security_captcha_enabled:false,
      hook_before_user_created_enabled:true,hook_before_user_created_uri:hook,
      ...(options.google ? {
        external_google_enabled:true,external_google_client_id:env.GOOGLE_OAUTH_CLIENT_ID,external_google_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,
        site_url:site,
        uri_allow_list:[...new Set([...(config.uri_allow_list || "").split(",").map(value=>value.trim()).filter(Boolean),callback])].join(","),
      } : {}),
    })});
    if(!response.ok)throw new Error(`Couldn't update Supabase authentication settings (HTTP ${response.status}).`);
    config=await read();
  }
  // Return only explicitly public status, never the Management API's raw response.
  const status={signupEnabled:config.disable_signup===false && config.external_email_enabled===true,immediateSignIn:config.mailer_autoconfirm===true,
    captchaDisabled:config.security_captcha_enabled===false,
    signupHookEnabled:config.hook_before_user_created_enabled===true && config.hook_before_user_created_uri===hook};
  const google={googleProviderEnabled:config.external_google_enabled===true,
    googleCredentialsConfigured:!!config.external_google_client_id && !!config.external_google_secret,
    googleSiteConfigured:!!site && config.site_url===site,
    googleCallbackAllowed:!!callback && (config.uri_allow_list || "").split(",").map(value=>value.trim()).includes(callback)};
  if(apply && (!Object.values(status).every(Boolean) || (options.google && !Object.values(google).every(Boolean))))throw new Error("Authentication settings were updated but verification failed. Check the settings before accepting registrations.");
  return {...status,...google,googleSignInEnabled:env.POCKET_BASE_GOOGLE_SIGN_IN==="true" && !!site};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await configureAuth({apply:process.argv.includes("--apply"),google:process.argv.includes("--google")}),null,2)); }
  catch(error) { console.error(error instanceof Error ? error.message : "Authentication setup failed."); process.exitCode=1; }
}
