"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { authenticate } from "@/lib/account";

export function AuthForm({ config, google = false, initialError = "" }: { config: { url: string; key: string } | null; google?: boolean; initialError?: string }) {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [googleBusy, setGoogleBusy] = useState(false);
  async function continueWithGoogle() {
    if (busy) return;
    setBusy(true); setGoogleBusy(true); setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "google" }) });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Couldn't start Google sign-in. Please try again.");
      location.assign(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect. Please try again.");
      setBusy(false); setGoogleBusy(false);
    }
  }
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
    {config && google && <>
      <button type="button" className="google-button" onClick={continueWithGoogle} disabled={busy}>
        {googleBusy ? <LoaderCircle className="spin" size={18}/> : <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.49l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59A6 6 0 0 1 12 5.96Z"/></svg>}
        {googleBusy ? "Connecting to Google…" : "Continue with Google"}
      </button>
      <p className="auth-divider">or use email</p>
    </>}
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
