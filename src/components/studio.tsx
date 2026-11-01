"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, ArrowRight, Plus, Play, ChevronLeft, History, Globe, Copy, Check, Smartphone, LoaderCircle, Sparkles, X, LogOut, RotateCcw } from "lucide-react";
import { PocketMark, GameArtwork } from "./artwork";
import type { Project, ProjectDetail, Revision, Theme } from "@/lib/types";
import { sandboxDocument, attachGameBridge } from "../../public/sandbox.js";

type Starter = { key: string; title: string; description: string; theme: Theme; tag: string; prompt: string };
type Props = { initialProjects: Project[]; starters: Starter[]; signedIn: boolean; demo: boolean; configured: boolean; aiConnected: boolean; initialError?: string };
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Something didn't finish. Please try again.");
  return value;
}
function GamePreview({ revision, projectId }: { revision: Revision; projectId: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [hiccup, setHiccup] = useState(false);
  const [restart, setRestart] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const channel = crypto.randomUUID();
    setHiccup(false);
    ref.current.srcdoc = sandboxDocument(revision.html, channel);
    return attachGameBridge(ref.current, projectId, channel, () => setHiccup(true));
  }, [revision, projectId, restart]);
  return <div className="preview-window">
    <div className="preview-toolbar"><span><i/> Live preview</span><button className="icon-button" aria-label="Restart preview" onClick={() => setRestart(r => r + 1)}><RotateCcw size={16}/></button></div>
    <iframe ref={ref} title={"Preview of " + revision.title} sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'"/>
    {hiccup && <div className="preview-hiccup" role="status">A little hiccup. Try restarting or restoring a version.</div>}
  </div>;
}
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></div>{children}
  </dialog>;
}

export function Studio(props: Props) {
  const [projects, setProjects] = useState(props.initialProjects);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(props.initialError || "");
  const [tab, setTab] = useState<"chat" | "play">("chat");
  const [modal, setModal] = useState<"login" | "share" | "versions" | null>(null);
  const [copied, setCopied] = useState(false);
  const [signedIn, setSignedIn] = useState(props.signedIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const chatBottom = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const current = project?.revisions.find(r => r.id === project.currentRevisionId);
  const loadSequence = useRef(0);
  const updateProject = useCallback((p: ProjectDetail) => {
    setProject(p);
    setProjects(list => [p, ...list.filter(x => x.id !== p.id)]);
  }, []);
  const openProject = useCallback(async (id: string, push = true) => {
    const sequence = ++loadSequence.current;
    setBusy("open"); setError("");
    try {
      const p = await api<ProjectDetail>("/api/projects/" + id);
      if (sequence !== loadSequence.current) return;
      updateProject(p); setChange(""); setTab("play");
      if (push) history.pushState({}, "", "/?game=" + p.id);
    } catch (e) { if (sequence === loadSequence.current) setError((e as Error).message); }
    finally { if (sequence === loadSequence.current) setBusy(""); }
  }, [updateProject]);
  useEffect(() => {
    const navigate = () => {
      const id = new URL(location.href).searchParams.get("game");
      if (id && props.signedIn) void openProject(id, false);
      else { loadSequence.current++; setProject(null); setBusy(""); }
    };
    navigate(); window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, [openProject, props.signedIn]);
  useEffect(() => { chatBottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [project, busy]);
  function home() {
    if (busy) return;
    setProject(null); setError(""); setChange(""); history.pushState({}, "", "/");
  }
  function needLogin() {
    if (signedIn) return false;
    if (!props.configured) setError("A grown-up needs to finish setting up this studio.");
    else setModal("login");
    return true;
  }
  async function createStarter(key: string) {
    if (needLogin() || busy) return;
    setBusy("starter"); setError("");
    try {
      const p = await api<ProjectDetail>("/api/projects", { starter: key });
      updateProject(p); setTab("play"); history.pushState({}, "", "/?game=" + p.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (needLogin() || busy) return;
    const text = project ? change.trim() : prompt.trim();
    if (!text) return;
    setError(""); setBusy("generate");
    try {
      const p = await api<ProjectDetail>("/api/generate", { prompt: text,
        ...(project ? { projectId: project.id, baseRevisionId: project.currentRevisionId } : {}) });
      updateProject(p); setChange(""); setPrompt(""); setTab("play");
      if (!project) history.pushState({}, "", "/?game=" + p.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function versionAction(action: "publish" | "restore" | "unpublish", revisionId?: string) {
    if (!project || busy) return;
    setError(""); setBusy(action);
    try {
      const result = await api<ProjectDetail | { ok: true }>("/api/projects/" + project.id + "/versions", { action, revisionId });
      if ("id" in result) updateProject(result);
      else updateProject({ ...project, publishedRevisionId: null });
      if (action === "restore") { setModal(null); setTab("play"); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy("login");
    try { await api("/api/auth", { action: "login", email, password }); setSignedIn(true); location.reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function logout() {
    setBusy("logout"); setError("");
    try { await api("/api/auth", { action: "logout" }); location.assign("/"); }
    catch (e) { setError((e as Error).message); setBusy(""); }
  }
  const playURL = project && typeof window !== "undefined" ? location.origin + "/play/" + project.id + "/" : "";
  return <div className={"studio " + (project ? "is-editing" : "")}>
    <header className="topbar">
      <button className="brand" onClick={home} disabled={!!busy} aria-label="Pocket Base home"><PocketMark/><span>pocket<span className="brand-light">base</span></span></button>
      <div className="header-right">
        {props.demo && <span className="demo-badge">Starter playground</span>}
        <button className="studio-nav" onClick={home} disabled={!!busy}><span className="nav-dot"/><span>My studio</span></button>
        {signedIn ? <button className="avatar" aria-label={props.demo ? "Demo family studio" : "Sign out of studio"} onClick={() => { if (!props.demo) void logout(); }} disabled={!!busy}>P{!props.demo && <LogOut className="logout-icon" size={13}/>}</button>
          : <button className="small-button" onClick={() => props.configured ? setModal("login") : setError("A grown-up needs to finish setting up this studio.")}>Sign in</button>}
      </div>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setError("")}><X size={17}/></button></div>}
    {!project ? <main className="home-page">
      <section className="hero">
        <div className="hero-content">
          <div className="eyebrow"><span className="little-star">✦</span> A LITTLE IDEA GOES A LONG WAY</div>
          <h1>Imagine it.<br/><span>Make it yours.</span></h1>
          <p className="hero-description">A game, a doodle, a tiny adventure.<br className="desktop-break"/> What will you bring to life today?</p>
          <form className="idea-box" onSubmit={generate}>
            <label className="sr-only" htmlFor="idea">Describe your game idea</label>
            <textarea ref={promptRef} id="idea" placeholder="A game where I catch stars in outer space…" value={prompt} maxLength={2000} onChange={e => setPrompt(e.target.value)} disabled={!!busy}/>
            <div className="idea-bottom"><span><Sparkles size={14}/>{busy === "generate" ? "Making a little magic…" : "Your imagination starts here"}</span>
              <button className="primary-button" type="submit" disabled={!prompt.trim() || !!busy}>{busy === "generate" ? <LoaderCircle className="spin" size={17}/> : <>Make it <ArrowUpRight size={17}/></>}</button></div>
          </form>
          <div className="idea-chips"><span>Or try</span>{["A fruit memory game", "A friendly frog maze"].map((text,i) => <button key={text} disabled={!!busy} onClick={() => { setPrompt(props.starters[i + 1].prompt); promptRef.current?.focus(); }}>{text}<Plus size={12}/></button>)}</div>
          {props.demo && <p className="demo-note">{props.aiConnected ? "Local playground · Your games are saved on this computer." : "Explore the playable starters below. Original AI games need a grown-up to connect the game maker."}</p>}
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="floating-star star-one">✳</span><span className="floating-star star-two">✦</span>
          <div className="back-card"/><div className="hero-game"><div className="hero-game-top"><span><i/> YOUR NEXT LITTLE WORLD</span><span>•••</span></div><GameArtwork theme="cosmic"/><div className="hero-game-bottom"><span>Star Catcher<small>Made of stardust. And your ideas.</small></span><span className="mini-play"><Play size={18} fill="currentColor"/></span></div></div>
          <div className="made-by-you"><Sparkles size={16}/> made by you <span>♡</span></div><div className="pocket-sticker"><Smartphone size={19}/><span>Make it.<br/><strong>Pocket it.</strong></span></div>
          <svg className="doodle-arrow" viewBox="0 0 100 90"><path d="M5 8c70-5 85 30 45 44-28 8-39-12-13-15 24-3 27 24 29 43m-14-8 14 10 10-16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      </section>
      <section className="starter-section">
        <div className="section-heading"><div><div className="eyebrow subdued">A SPARK TO GET YOU STARTED</div><h2>Big fun. Small beginnings.</h2></div><span className="section-note"><span>✧</span> Pick one. Make it your own.</span></div>
        <div className="starter-grid">{props.starters.map(s => <article className="starter-card" key={s.key}>
          <button className="art-button" aria-label={"Start with " + s.title} disabled={!!busy} onClick={() => createStarter(s.key)}><GameArtwork theme={s.theme} title={s.title}/><span className="card-open"><ArrowUpRight size={19}/></span></button>
          <div className="card-details"><span className="card-tag">{s.tag}</span><button className="card-title" disabled={!!busy} onClick={() => createStarter(s.key)}>{s.title}</button><p>{s.description}</p></div>
        </article>)}</div>
      </section>
      <section className="library-section">
        <div className="section-heading"><div><div className="eyebrow subdued">A HOME FOR YOUR IMAGINATION</div><h2>Your little worlds <span className="count">{projects.length}</span></h2></div><button className="text-button" onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); promptRef.current?.focus(); }}><Plus size={16}/> New idea</button></div>
        {projects.length ? <div className="library-grid">{projects.map(p => <article className="library-card" key={p.id}>
          <button className={"library-art art-" + p.theme} aria-label={"Open " + p.title} disabled={!!busy} onClick={() => openProject(p.id)}><GameArtwork theme={p.theme}/></button>
          <div className="library-info"><button className="card-title" disabled={!!busy} onClick={() => openProject(p.id)}>{p.title}</button><span className={"publish-label " + (p.publishedRevisionId ? "is-public" : "")}>{p.publishedRevisionId ? <><Globe size={11}/> Published</> : "Just for you"}</span></div>
          <button className="icon-button" aria-label={"Edit " + p.title} disabled={!!busy} onClick={() => openProject(p.id)}><ArrowUpRight size={19}/></button>
        </article>)}</div> : <div className="empty-library"><PocketMark/><p>Your first little world belongs right here.</p><span>Start with an idea above, or pick a starter.</span></div>}
      </section>
      <section className="phone-callout"><span className="phone-callout-icon"><Smartphone size={28}/></span><div><h3>A little world in your pocket.</h3><p>Publish a game, add it to your home screen, and take it on an offline adventure.</p></div><span className="callout-spark">✦</span></section>
      <footer className="home-footer"><span>Dream it. Build it. Pocket it.</span><span>Made for curious minds <span className="footer-heart">♡</span></span></footer>
    </main> : <main className="editor">
      <div className="editor-heading"><div className="editor-heading-left"><button className="icon-button back" aria-label="Back to my studio" onClick={home} disabled={!!busy}><ChevronLeft size={21}/></button><div><h1>{project.title}</h1><span>{project.publishedRevisionId === project.currentRevisionId ? "This version is published" : project.publishedRevisionId ? "New changes · ready when you are" : "Your own little world"}</span></div></div>
        <div className="editor-actions"><button className="secondary-button" aria-label="Versions" onClick={() => { setError(""); setModal("versions"); }} disabled={!!busy}><History size={16}/><span>Versions</span></button><button className="primary-button" onClick={() => { setError(""); setModal("share"); }} disabled={!!busy}><Globe size={16}/>Publish</button></div></div>
      <div className="mobile-tabs" role="tablist" aria-label="Game editor"><button role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}><Sparkles size={16}/> Make changes</button><button role="tab" aria-selected={tab === "play"} onClick={() => setTab("play")}><Play size={16}/> Play</button></div>
      <div className={"editor-panels tab-" + tab}>
        <section className="chat-panel" aria-label="Game conversation"><div className="chat-scroll"><div className="studio-intro"><span className="assistant-icon"><Sparkles size={19}/></span><h2>A little world, made by you.</h2><p>Tell me what you'd like to change. A new character? More stars? A whole new twist?</p></div>
          {[...project.revisions].sort((a,b) => a.createdAt.localeCompare(b.createdAt)).map((r,i) => <div className="conversation" key={r.id}><div className="user-message">{r.prompt}</div><div className="studio-message"><Sparkles size={15}/><div><p>{r.description}</p><span className="version-pill"><Check size={11}/> Version {i+1} saved {r.id === project.currentRevisionId && "· current"}</span></div></div></div>)}
          {busy === "generate" && <div className="thinking" role="status"><LoaderCircle className="spin" size={17}/> Making a little magic. This may take a minute…</div>}<div ref={chatBottom}/></div>
          <form className="change-form" onSubmit={generate}><label className="sr-only" htmlFor="change">Describe a change to your game</label><div className="change-box"><textarea id="change" placeholder="Make the stars rainbow colored…" value={change} onChange={e => setChange(e.target.value)} maxLength={2000} disabled={!!busy}/><button className="send-button" aria-label="Make this change" disabled={!change.trim() || !!busy}>{busy === "generate" ? <LoaderCircle className="spin" size={19}/> : <ArrowUp size={20}/>}</button></div><span className="composer-note">Every version is saved. Curiosity encouraged.</span></form>
        </section>
        <section className="preview-panel" aria-label="Playable game preview">{current && <GamePreview revision={current} projectId={project.id}/>}<p className="preview-caption"><Smartphone size={13}/> Touch to play. Publish to take it with you.</p></section>
      </div>
    </main>}
    {busy === "open" && <div className="loading-toast" role="status"><LoaderCircle size={17} className="spin"/> Opening your little world…</div>}
    {modal === "login" && <Modal title="Welcome to your studio" onClose={() => { setModal(null); setPassword(""); }}><p className="modal-description">Ask a grown-up to sign in with your family's studio account.</p><form className="login-form" onSubmit={login}><label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254}/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={200}/></label>{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary-button" disabled={!!busy}>{busy === "login" ? <LoaderCircle className="spin" size={17}/> : <>Open my studio <ArrowRight size={16}/></>}</button></form></Modal>}
    {modal === "versions" && project && <Modal title="Room to experiment" onClose={() => setModal(null)}><p className="modal-description">Go back to a favorite version. Your other versions stay saved, and your published game stays as it is.</p><div className="version-list">{project.revisions.map((r,i) => <div className="version-row" key={r.id}><div><strong>{r.title}</strong><span>{r.prompt.slice(0,100)}</span><small>{new Date(r.createdAt).toLocaleString()} {r.id === project.publishedRevisionId && "· Published"}</small></div><button className="small-button" disabled={!!busy || r.id === project.currentRevisionId} onClick={() => versionAction("restore", r.id)}>{r.id === project.currentRevisionId ? "Current" : "Restore"}</button></div>)}</div>{error && <p className="inline-error" role="alert">{error}</p>}</Modal>}
    {modal === "share" && project && <Modal title="Let your little world out" onClose={() => setModal(null)}><div className={"share-art art-" + project.theme}><GameArtwork theme={project.theme}/></div><p className="modal-description">Anyone with your link can play, add it to their home screen, and download it for offline adventures.</p>
      {project.publishedRevisionId && <><label className="link-label" htmlFor="play-link">Your public play link</label><div className="share-link"><input id="play-link" readOnly value={playURL} onFocus={e => e.target.select()}/><button className="icon-button" aria-label="Copy play link" onClick={async () => { try { await navigator.clipboard.writeText(playURL); setCopied(true); setTimeout(() => setCopied(false),2500); } catch { setError("Select the link to copy it manually."); } }}>{copied ? <Check size={18}/> : <Copy size={18}/>}</button></div><a className="play-link" href={playURL} target="_blank" rel="noreferrer">Open published game <ArrowUpRight size={15}/></a></>}
      <button className="primary-button publish-button" disabled={!!busy || project.publishedRevisionId === project.currentRevisionId} onClick={() => versionAction("publish", project.currentRevisionId)}>{busy === "publish" ? <LoaderCircle className="spin" size={17}/> : project.publishedRevisionId === project.currentRevisionId ? <><Check size={17}/> This version is live</> : <><Globe size={17}/>{project.publishedRevisionId ? "Publish these changes" : "Publish my game"}</>}</button>
      {project.publishedRevisionId && <details className="unpublish-details"><summary>Take this game offline</summary><p>This stops new public access. Copies already downloaded can still be played offline.</p><button className="text-button danger" disabled={!!busy} onClick={() => versionAction("unpublish")}>Unpublish game</button></details>}
      {error && <p className="inline-error" role="alert">{error}</p>}</Modal>}
  </div>;
}
