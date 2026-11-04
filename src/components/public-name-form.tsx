"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";

export function PublicNameForm({ loadError = "" }: { loadError?: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await mutate("/api/profile", { displayName: name }, "/");
  }
  async function mutate(url: string, body: Record<string, string>, destination: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn't finish that. Please try again.");
      location.assign(destination);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't connect. Please try again."); setBusy(false); }
  }
  return <section className="auth-card" aria-labelledby="name-heading">
    <h1 id="name-heading">Choose your public name</h1>
    <p className="modal-description">Shown with your published games. You can change it later.</p>
    <form className="login-form" onSubmit={submit}>
      <label>Public name<input autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} maxLength={80} required disabled={busy || !!loadError}/></label>
      {(error || loadError) && <p className="inline-error" role="alert">{error || loadError}</p>}
      <button className="primary-button" disabled={busy || !!loadError}>{busy ? <LoaderCircle className="spin" size={17}/> : <>Open my studio<ArrowRight size={16}/></>}</button>
      <button type="button" className="small-button" disabled={busy} onClick={() => mutate("/api/auth", { action: "logout" }, "/account")}>Sign out</button>
    </form>
    <a className="play-link" href="/library">Browse the game library <ArrowRight size={15}/></a>
  </section>;
}
