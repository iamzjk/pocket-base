"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { authenticate } from "@/lib/account";

export function AuthForm({ config }: { config: { url: string; key: string } | null }) {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!config || busy) return;
    setBusy(true); setError("");
    try {
      // No localStorage session or PKCE redirect: hand the issued session to SSR cookies.
      const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" } });
      const session = await authenticate(client, { signup, email, password, displayName });
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "session", ...session }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn't finish signing in.");
      location.assign("/");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="auth-card" aria-labelledby="account-heading">
    {config && <div className="auth-tabs" role="group" aria-label="Account access">
      <button type="button" className={!signup ? "is-active" : ""} disabled={busy} onClick={() => { setSignup(false); setPassword(""); setError(""); }}>Sign in</button>
      <button type="button" className={signup ? "is-active" : ""} disabled={busy} onClick={() => { setSignup(true); setPassword(""); setError(""); }}>Create account</button>
    </div>}
    <h1 id="account-heading">{signup ? "A studio of your own" : "Welcome to your studio"}</h1>
    <p className="modal-description">{signup ? "Make little games and share them with everyone." : "Sign in to keep creating your little worlds."}</p>
    {!config ? <p className="inline-error" role="alert">Account access isn’t available yet. You can still play games in the library.</p> : <form className="login-form" onSubmit={submit}>
      {signup && <div><label htmlFor="public-name">Public name<input id="public-name" aria-describedby="public-name-help" autoComplete="nickname" value={displayName} onChange={e=>setDisplayName(e.target.value)} required maxLength={80} disabled={busy}/></label><small id="public-name-help">Shown with your published games. You can change it later.</small></div>}
      <label>Email<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254} disabled={busy}/></label>
      <label>Password<input type="password" autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={e=>setPassword(e.target.value)} required minLength={signup ? 8 : undefined} maxLength={200} disabled={busy}/></label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <>{signup ? "Create my account" : "Open my studio"}<ArrowRight size={16}/></>}</button>
    </form>}
    <a className="play-link" href="/library">Browse the game library <ArrowRight size={15}/></a>
  </section>;
}
