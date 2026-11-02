// Disposable local Supabase Auth double and a second production app instance.
// No real credentials, external requests, or application test bypasses.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";

const accounts=new Map();
const sessions=new Map();
const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
function issue(account) {
  const header=encode({alg:"HS256",typ:"JWT"});
  const payload=encode({sub:account.id,aud:"authenticated",role:"authenticated",exp:Math.floor(Date.now()/1000)+3600});
  const token=header+"."+payload+"."+createHmac("sha256","fictional-signing-key").update(header+"."+payload).digest("base64url");
  const refresh=randomUUID(); sessions.set(token,account); sessions.set(refresh,account);
  return {access_token:token,refresh_token:refresh,token_type:"bearer",expires_in:3600,user:user(account)};
}
const user=account=>({id:account.id,email:account.email,aud:"authenticated",role:"authenticated",app_metadata:{provider:"email",providers:["email"]},user_metadata:{display_name:account.name},created_at:"2026-01-01T00:00:00Z",identities:[]});
const existing={id:randomUUID(),email:"existing@example.test",password:"fictional-password",name:"Existing creator"};
accounts.set(existing.email,existing);
function projectFor(account) {
  return { id:account.projectId ||= randomUUID(), owner_id:account.id,
    current_revision_id:account.revisionId ||= randomUUID(), published_revision_id:null,
    title:"Fictional account logo game",description:"A private fictional browser fixture.",theme:"mint",
    created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z" };
}
const server=createServer(async(req,res)=>{
  res.setHeader("Content-Type","application/json");
  res.setHeader("X-Supabase-Api-Version","2024-01-01");
  res.setHeader("Access-Control-Allow-Origin","http://127.0.0.1:3218");
  res.setHeader("Access-Control-Allow-Headers","authorization,apikey,content-type,x-client-info,x-supabase-api-version");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Expose-Headers","X-Supabase-Api-Version");
  const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  if(req.method==="OPTIONS")return send(200,{});
  const url=new URL(req.url,"http://127.0.0.1:3219");
  const body=[];for await(const chunk of req)body.push(chunk);
  let input={}; try {if(body.length)input=JSON.parse(Buffer.concat(body).toString());}catch{return send(400,{});}
  const account=sessions.get(req.headers.authorization?.replace(/^Bearer /,""));
  if(url.pathname==="/health")return send(200,{ok:true});
  if(url.pathname==="/auth/v1/user")return account ? send(200,user(account)) : send(401,{code:"bad_jwt",msg:"Invalid test token"});
  if(url.pathname==="/auth/v1/logout")return send(200,{});
  if(url.pathname==="/auth/v1/signup" || url.pathname==="/auth/v1/token") {
    if(url.searchParams.get("grant_type")==="refresh_token") {
      const account=sessions.get(input.refresh_token);return account ? send(200,issue(account)) : send(401,{});
    }
    if(input.gotrue_meta_security?.captcha_token!=="fictional-captcha")return send(400,{code:"captcha_failed",msg:"Test CAPTCHA rejected"});
    if(url.pathname.endsWith("signup")) {
      if(accounts.has(input.email))return send(400,{code:"user_already_exists",msg:"Existing test account"});
      if(!input.data?.display_name?.trim())return send(400,{code:"validation_failed",msg:"Name required"});
      const account={id:randomUUID(),email:input.email,password:input.password,name:input.data.display_name.trim()};
      accounts.set(account.email,account);return send(200,issue(account));
    }
    const account=accounts.get(input.email);
    return account?.password===input.password ? send(200,issue(account)) : send(400,{code:"invalid_credentials",msg:"Test sign-in failed"});
  }
  if(url.pathname==="/rest/v1/projects") {
    const project=account ? projectFor(account) : null;
    const matches=project && (!url.searchParams.has("id") || url.searchParams.get("id")==="eq."+project.id);
    return send(200,matches ? [url.searchParams.get("select")==="current_revision_id" ? {current_revision_id:project.current_revision_id} : project] : []);
  }
  if(url.pathname==="/rest/v1/revisions") {
    const project=account ? projectFor(account) : null;
    const matches=project && url.searchParams.get("id")==="eq."+project.current_revision_id && url.searchParams.get("project_id")==="eq."+project.id;
    return send(200,matches ? [{title:project.title,theme:project.theme,
      icon_svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#8acfb5"/><circle cx="256" cy="256" r="140" fill="#fff"/></svg>'}] : []);
  }
  // Keep this double on the older schema to exercise compatibility during rollout.
  if(url.pathname==="/rest/v1/rpc/published_games")return send(200,{games:[{
    id:"60000000-0000-4000-8000-000000000001",revisionId:"60000000-0000-4000-8000-000000000002",
    title:"Legacy library fixture",description:"Fictional older listing",theme:"mint",
    creatorName:"Fictional creator",updatedAt:"2026-01-01T00:00:00Z"
  }],hasMore:false});
  if(url.pathname==="/rest/v1/rpc/creator_profile")return account ? send(200,{displayName:account.name}) : send(401,{});
  if(url.pathname==="/rest/v1/rpc/save_creator_profile" && account) {account.name=input.p_display_name;return send(200,{displayName:account.name});}
  return send(404,{code:"fixture_not_found",message:"Fictional endpoint is unavailable."});
});
server.listen(3219,"127.0.0.1",()=>{
  const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3218"],{
    stdio:"inherit",env:{...process.env,POCKET_BASE_DEMO:"false",NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:3219",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"fictional-publishable-key",NEXT_PUBLIC_HCAPTCHA_SITEKEY:"fictional-sitekey",OPENROUTER_API_KEY:"",SUPABASE_ACCESS_TOKEN:"",
      NODE_OPTIONS:"--import="+path.join(process.cwd(),"tests/fixtures/local-network-only.mjs")},
  });
  const stop=()=>{child.kill("SIGTERM");server.close();};
  process.on("SIGTERM",stop);process.on("SIGINT",stop);
  child.on("exit",code=>{server.close();process.exit(code || 0);});
});
