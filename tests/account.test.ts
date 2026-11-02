import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticate, acceptSession } from "../src/lib/account";
import { publicName } from "../src/lib/profile";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthForm } from "../src/components/auth-form";

test("auth requires CAPTCHA, sends required public names, and returns only issued session tokens",async()=>{
  const calls:{operation:string;input:unknown}[]=[];
  const success={data:{session:{access_token:"issued-access",refresh_token:"issued-refresh"}},error:null};
  const client={auth:{signUp:async(input:unknown)=>{calls.push({operation:"signup",input});return success;},signInWithPassword:async(input:unknown)=>{calls.push({operation:"login",input});return success;}}} as unknown as SupabaseClient;
  const input={signup:true,email:" creator@example.test ",password:"fictional-password",displayName:" Creator ",captchaToken:"solved"};
  await assert.rejects(authenticate(client,{...input,captchaToken:""}),/security check/);
  await assert.rejects(authenticate(client,{...input,displayName:"<bad>"}),/public name/);
  assert.equal(calls.length,0);
  assert.deepEqual(await authenticate(client,input),{accessToken:"issued-access",refreshToken:"issued-refresh"});
  assert.deepEqual(calls[0],{operation:"signup",input:{email:"creator@example.test",password:input.password,options:{data:{display_name:"Creator"},captchaToken:"solved"}}});
  await authenticate(client,{...input,signup:false});
  assert.deepEqual(calls[1],{operation:"login",input:{email:"creator@example.test",password:input.password,options:{captchaToken:"solved"}}});
  assert.equal(publicName("🎮 Creator"),"🎮 Creator");
});
test("auth errors do not disclose provider payloads or report success without a session",async()=>{
  const input={signup:true,email:"creator@example.test",password:"fictional-password",displayName:"Creator",captchaToken:"solved"};
  for(const [error,pattern] of [
    [{code:"captcha_failed",status:400},/security check/],
    [{code:"email_exists",status:400},/already uses/],
    [{code:"over_request_rate_limit",status:429},/Too many/],
    [{code:"weak_password",status:400},/stronger password/],
    [{code:"unexpected",status:500},/Couldn't create/],
  ] as const) {
    const client={auth:{signUp:async()=>({data:{session:null},error:{...error,message:"PRIVATE upstream"}})}} as unknown as SupabaseClient;
    await assert.rejects(authenticate(client,input),e=>{assert.match((e as Error).message,pattern);assert.equal((e as Error).message.includes("PRIVATE"),false);return true;});
  }
  const client={auth:{signUp:async()=>({data:{session:null},error:null})}} as unknown as SupabaseClient;
  await assert.rejects(authenticate(client,input),/couldn't sign in yet/);
});

test("pending CAPTCHA setup preserves existing sign-in while registration stays protected",async()=>{
  const markup=renderToStaticMarkup(createElement(AuthForm,{config:{url:"https://fictional.example",key:"fictional-key"}}));
  assert.ok(markup.includes("Open my studio"));assert.equal(markup.includes("Create account"),false);
  assert.equal(markup.includes('class="primary-button" disabled'),false);
  const calls:unknown[]=[];
  const client={auth:{signInWithPassword:async(input:unknown)=>{calls.push(input);return {data:{session:{access_token:"access",refresh_token:"refresh"}},error:null};}}} as unknown as SupabaseClient;
  const input={signup:false,email:"existing@example.test",password:"fictional-password",displayName:"",captchaToken:"",captchaRequired:false};
  await authenticate(client,input);
  assert.deepEqual(calls,[{email:input.email,password:input.password}]);
  await assert.rejects(authenticate(client,{...input,signup:true,displayName:"Creator"}),/security check/);
  await assert.rejects(authenticate(client,{...input,captchaRequired:true}),/security check/);
  assert.equal(calls.length,1);
});
test("session handoff verifies tokens with Auth before writing session cookies",async()=>{
  const calls:string[]=[];
  let valid=false;
  const client={auth:{getUser:async()=>{calls.push("verify");return {data:{user:valid ? {id:"verified"} : null},error:null};},setSession:async()=>{calls.push("save");return {data:{session:{}},error:null};}}} as unknown as SupabaseClient;
  const body={action:"session",accessToken:"issued-access",refreshToken:"issued-refresh",user:{id:"forged"}};
  await assert.rejects(acceptSession(client,{...body,accessToken:7}),/sign in again/);
  assert.deepEqual(calls,[]);
  await assert.rejects(acceptSession(client,body),/sign in again/);
  assert.deepEqual(calls,["verify"]);
  valid=true; calls.length=0;
  await acceptSession(client,body);assert.deepEqual(calls,["verify","save"]);
});
