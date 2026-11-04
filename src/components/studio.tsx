"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, ArrowRight, Plus, Play, ChevronLeft, History, Globe, Copy, Check, Smartphone, LoaderCircle, Sparkles, X, LogOut, RotateCcw, Search } from "lucide-react";
import { PocketMark, GameArtwork } from "./artwork";
import type { Project, ProjectDetail, Revision, CreatorProfile } from "@/lib/types";
import { startGame } from "../../public/sandbox.js";
import { MAX_LIBRARY_QUERY_CHARACTERS, MAX_PROMPT_CHARACTERS } from "@/lib/limits";
import { normalizeLibrary, type LibraryResponse } from "@/lib/library";

type Props = { initialDisplayName: string; version: string; view: "studio" | "library"; initialProjects: Project[]; initialLibrary: LibraryResponse; signedIn: boolean; demo: boolean; configured: boolean; aiConnected: boolean; initialError?: string; initialLibraryError?: string };
async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, body === undefined ? { cache: "no-store", signal } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Something didn't finish. Please try again.");
  return value;
}
function playCountLabel(count: number) { return count.toLocaleString("en-US") + (count === 1 ? " play" : " plays"); }
function projectIconURL(project: Project) { return "/api/projects/" + project.id + "/icon?revision=" + project.currentRevisionId; }
function GamePreview({ revision, projectId }: { revision: Revision; projectId: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "timeout">("loading");
  const [restart, setRestart] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    return startGame(ref.current, projectId, revision.html, setState);
  }, [revision.id, revision.html, projectId, restart]);
  return <div className="preview-window">
    <div className="preview-toolbar"><span><i/> Live preview</span><button className="icon-button" aria-label="Restart preview" onClick={() => setRestart(r => r + 1)}><RotateCcw size={16}/></button></div>
    <div className="preview-stage"><iframe ref={ref} title={"Preview of " + revision.title} sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'"/>
      {state !== "ready" && <div className="game-status" role={state === "loading" ? "status" : "alert"}>
        {state === "loading" ? <><LoaderCircle className="spin" size={24}/><p>Opening your game…</p></> : <><p>{state === "timeout" ? "This game is taking too long to start." : "This game couldn't start properly."} Try restarting. If it keeps happening, restore a previous version or ask for a fix.</p><button className="primary-button" onClick={() => setRestart(r => r + 1)}><RotateCcw size={16}/>Try again</button></>}
      </div>}
    </div>
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
  const [libraryResponse, setLibrary] = useState(props.initialLibrary);
  const library = normalizeLibrary(libraryResponse);
  const [libraryError, setLibraryError] = useState(props.initialLibraryError || "");
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryOffset, setLibraryOffset] = useState(props.initialLibrary.games.length);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryResultsQuery, setLibraryResultsQuery] = useState("");
  const query = librarySearch.trim();
  const libraryReady = libraryResultsQuery === query;
  const libraryQueryRef = useRef("");
  const librarySearchRef = useRef<HTMLInputElement>(null);
  const libraryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const libraryController = useRef<AbortController | null>(null);
  const librarySequence = useRef(0);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [prompt, setPrompt] = useState("");
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(props.initialError || "");
  const [tab, setTab] = useState<"chat" | "play">("chat");
  const [modal, setModal] = useState<"account" | "share" | "versions" | null>(null);
  const [copied, setCopied] = useState(false);
  const signedIn = props.signedIn;
  const [displayName, setDisplayName] = useState(props.initialDisplayName);
  const [profileSaved, setProfileSaved] = useState(false);
  const studioRef = useRef<HTMLDivElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const current = project?.revisions.find(r => r.id === project.currentRevisionId);
  const loadSequence = useRef(0);
  const updateProject = useCallback((p: ProjectDetail) => {
    setProject(p);
    setProjects(list => [p, ...list.filter(x => x.id !== p.id)]);
  }, []);
  const loadLibrary = useCallback(async (offset = 0, query = libraryQueryRef.current) => {
    const sequence = ++librarySequence.current;
    if (libraryTimer.current) clearTimeout(libraryTimer.current);
    libraryTimer.current = null;
    libraryController.current?.abort();
    const controller = new AbortController();
    libraryController.current = controller;
    setLibraryBusy(true); setLibraryError("");
    try {
      const result = normalizeLibrary(await api<LibraryResponse>("/api/library?offset=" + offset
        + (query ? "&q=" + encodeURIComponent(query) : ""), undefined, controller.signal));
      if (sequence !== librarySequence.current) return;
      setLibrary(current => ({ ...result, games: offset
        ? [...new Map([...current.games, ...result.games].map(game => [game.id, game])).values()]
        : result.games }));
      setLibraryOffset(offset + result.games.length);
      setLibraryResultsQuery(query);
    } catch (e) { if (sequence === librarySequence.current) setLibraryError((e as Error).message); }
    finally { if (sequence === librarySequence.current) setLibraryBusy(false); }
  }, []);
  function searchLibrary(value: string) {
    setLibrarySearch(value);
    const query = value.trim();
    if (query === libraryQueryRef.current) return;
    libraryQueryRef.current = query;
    // Invalidate immediately, including during the debounce, so an older page cannot replace this search.
    librarySequence.current++;
    libraryController.current?.abort();
    if (libraryTimer.current) clearTimeout(libraryTimer.current);
    setLibraryBusy(true); setLibraryError("");
    libraryTimer.current = setTimeout(() => void loadLibrary(0, query), 250);
  }
  useEffect(() => () => {
    librarySequence.current++;
    libraryController.current?.abort();
    if (libraryTimer.current) clearTimeout(libraryTimer.current);
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
    const navigate = (event?: PopStateEvent) => {
      const id = new URL(location.href).searchParams.get("game");
      if (id && props.signedIn && props.view === "studio") void openProject(id, false);
      else { loadSequence.current++; setProject(null); setBusy(""); if (event) void loadLibrary(); }
    };
    navigate(); window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, [openProject, props.signedIn, props.view, loadLibrary]);
  useEffect(() => {
    const scroll = chatScroll.current;
    scroll?.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" });
  }, [project, busy, tab]);
  useEffect(() => {
    if (project?.id) window.scrollTo(0, 0);
  }, [project?.id]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    // Mobile keyboards can resize only the visual viewport. Keep the composer
    // and dialogs inside it, while leaving pinch zoom under the user's control.
    const resize = () => {
      if (viewport.scale === 1) studioRef.current?.style.setProperty("--studio-height", viewport.height + "px");
    };
    resize();
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, []);
  function home() {
    if (busy) return;
    if (props.view === "library") { location.assign("/"); return; }
    setProject(null); setError(""); setChange(""); history.pushState({}, "", "/");
  }
  function needLogin() {
    if (signedIn) return false;
    if (!props.configured) setError("A grown-up needs to finish setting up this studio.");
    else location.assign("/account");
    return true;
  }
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (needLogin() || busy) return;
    const text = project ? change.trim() : prompt.trim();
    if (!text) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy("profile"); setProfileSaved(false);
    try {
      const profile = await api<CreatorProfile>("/api/profile", { displayName });
      setDisplayName(profile.displayName || ""); setProfileSaved(true);
      if (props.view === "library") void loadLibrary();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function logout() {
    setBusy("logout"); setError("");
    try { await api("/api/auth", { action: "logout" }); location.assign("/"); }
    catch (e) { setError((e as Error).message); setBusy(""); }
  }
  const playURL = project && typeof window !== "undefined" ? location.origin + "/play/" + project.id + "/" : "";
  return <div ref={studioRef} className={"studio " + (project ? "is-editing" : "")}>
    <header className="topbar">
      <button className="brand" onClick={home} disabled={!!busy} aria-label="Pocket Base home"><PocketMark/><span>pocket<span className="brand-light">base</span></span></button>
      <div className="header-right">
        {props.demo && <span className="demo-badge">Local playground</span>}
        <nav className="studio-navigation" aria-label="Main navigation"><a className={"studio-nav " + (props.view === "studio" ? "is-active" : "")} href="/" aria-current={props.view === "studio" ? "page" : undefined}><span className="nav-dot"/>My studio</a><a className={"studio-nav " + (props.view === "library" ? "is-active" : "")} href="/library" aria-current={props.view === "library" ? "page" : undefined}><Globe size={15}/>Game library</a></nav>
        {signedIn ? <button className="avatar" aria-label="Account settings" onClick={() => { setError(""); setProfileSaved(false); setModal("account"); }} disabled={!!busy}>{displayName.slice(0,1).toUpperCase() || "P"}</button>
          : <a className="small-button" href="/account">Sign in / Sign up</a>}
      </div>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setError("")}><X size={17}/></button></div>}
    {!project ? <main className={"home-page " + (props.view === "library" ? "library-page" : "")}>
      {props.view === "studio" && <section className="hero">
        <div className="hero-content">
          <div className="eyebrow"><span className="little-star">✦</span> A LITTLE IDEA GOES A LONG WAY</div>
          <h1>Imagine it.<br/><span>Make it yours.</span></h1>
          <p className="hero-description">A game, a doodle, a tiny adventure.<br className="desktop-break"/> What will you bring to life today?</p>
          <form className="idea-box" onSubmit={generate}>
            <label className="sr-only" htmlFor="idea">Describe your game idea</label>
            <textarea ref={promptRef} id="idea" placeholder="A game where I catch stars in outer space…" value={prompt} maxLength={MAX_PROMPT_CHARACTERS} onChange={e => setPrompt(e.target.value)} disabled={!!busy}/>
            <div className="idea-bottom"><span><Sparkles size={14}/>{busy === "generate" ? "Making a little magic…" : "Your imagination starts here"}</span>
              <button className="primary-button" type="submit" disabled={!prompt.trim() || !!busy}>{busy === "generate" ? <LoaderCircle className="spin" size={17}/> : <>Make it <ArrowUpRight size={17}/></>}</button></div>
          </form>
          {props.demo && <p className="demo-note">{props.aiConnected ? "Local playground · Your games are saved on this computer." : "Ask a grown-up to connect the game maker, then bring your own idea to life."}</p>}
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="floating-star star-one">✳</span><span className="floating-star star-two">✦</span>
          <div className="back-card"/><div className="hero-game"><div className="hero-game-top"><span><i/> YOUR NEXT LITTLE WORLD</span><span>•••</span></div><GameArtwork theme="cosmic"/><div className="hero-game-bottom"><span>Your next creation<small>Made from your imagination.</small></span><span className="mini-play"><Play size={18} fill="currentColor"/></span></div></div>
          <div className="made-by-you"><Sparkles size={16}/> made by you <span>♡</span></div><div className="pocket-sticker"><Smartphone size={19}/><span>Make it.<br/><strong>Pocket it.</strong></span></div>
          <svg className="doodle-arrow" viewBox="0 0 100 90"><path d="M5 8c70-5 85 30 45 44-28 8-39-12-13-15 24-3 27 24 29 43m-14-8 14 10 10-16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      </section>}
      {props.view === "library" && <section className="published-section" aria-label="Game library" aria-busy={libraryBusy}>
        <div className="section-heading"><div><div className="eyebrow subdued">MADE HERE. PLAYED EVERYWHERE.</div><h2>Game library</h2></div><button className="text-button" disabled={libraryBusy} onClick={() => void loadLibrary()}><RotateCcw size={15} className={libraryBusy ? "spin" : ""}/>Refresh</button></div>
        <p className="library-description">Games published by everyone. Pick one and play — no sign-in needed.</p>
        <form className="library-search" role="search" aria-label="Search games" onSubmit={event => { event.preventDefault(); void loadLibrary(); }}>
          <label htmlFor="library-search">Search games</label>
          <div className="library-search-field"><Search size={19} aria-hidden="true"/>
            <input ref={librarySearchRef} id="library-search" type="search" placeholder="Title, description, or creator" value={librarySearch}
              maxLength={MAX_LIBRARY_QUERY_CHARACTERS} onChange={event => searchLibrary(event.target.value)}
              onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); searchLibrary(""); } }}/>
            {librarySearch && <button className="icon-button" type="button" aria-label="Clear search" onClick={() => { searchLibrary(""); librarySearchRef.current?.focus(); }}><X size={18}/></button>}
          </div>
        </form>
        {libraryError && <p className="inline-error" role="alert">{libraryError}</p>}
        {!query && <section className="leaderboard" aria-label="Most played">
          <div className="leaderboard-heading"><h3>Most played</h3><span>All time · Top 10</span></div>
          <p className="leaderboard-note">Counted when a game opens online. Repeat opens within 30 minutes count once per browser.</p>
          {library.leaderboard.length ? <ol className="leaderboard-list">{library.leaderboard.map((game,index) => <li key={game.id}>
            <a href={"/play/" + game.id + "/"} aria-label={"Play " + game.title + " · rank " + (index + 1)}>
              <span className="leaderboard-rank" aria-hidden="true">{index + 1}</span>
              <img src={"/play/" + game.id + "/icons/192.png"} width={44} height={44} alt="" loading="lazy"/>
              <span className="leaderboard-info"><strong>{game.title}</strong><span>By {game.creatorName}</span></span>
              <span className="leaderboard-count">{playCountLabel(game.playCount)}</span>
            </a>
          </li>)}</ol> : <p className="leaderboard-empty">{libraryError ? "Rankings couldn't load. Try refreshing." : "Play a game to start the leaderboard."}</p>}
        </section>}
        <h3 className="recent-games-heading">{query ? "Search results" : "Recently updated"}</h3>
        <p className="library-search-status" role="status">{query && !libraryError ? libraryBusy ? "Searching games…"
          : libraryReady ? library.games.length + (library.hasMore ? "+" : "") + (library.games.length === 1 ? " game found" : " games found") : "" : ""}</p>
        {libraryReady && library.games.length ? <div className="published-grid">{library.games.map(game => <a className="published-card" href={"/play/" + game.id + "/"} aria-label={"Play " + game.title} key={game.id}>
          <div className={"published-cover art-" + game.theme}><img src={"/play/" + game.id + "/icons/192.png"} width={96} height={96} alt="" loading="lazy"/><span className="card-open"><Play size={18} fill="currentColor"/></span></div>
          <div className="card-details"><h3>{game.title}</h3><p>{game.description}</p><div className="published-meta"><span>By {game.creatorName}</span><span>Updated <time dateTime={game.updatedAt}>{new Date(game.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}</time></span><span className="published-count"><Play size={12} aria-hidden="true"/>{playCountLabel(game.playCount)}</span></div><span className="published-play">Play game <ArrowUpRight size={15}/></span></div>
        </a>)}</div> : !libraryError && <div className="empty-library">{query ? <Search/> : <Globe/>}<p>{libraryBusy ? query ? "Searching the game library…" : "Opening the game library…"
          : query ? "No games found" : "The next little world could be yours."}</p><span>{query ? "Try a different title, description, or creator name." : "Published games will appear here for everyone to play."}</span></div>}
        {libraryReady && library.hasMore && <div className="library-more"><button className="secondary-button" disabled={libraryBusy} onClick={() => void loadLibrary(libraryOffset)}>{libraryBusy ? <><LoaderCircle className="spin" size={16}/>Loading games…</> : <>Show more games <Plus size={16}/></>}</button></div>}
      </section>}
      {props.view === "studio" && <><section className="library-section">
        <div className="section-heading"><div><div className="eyebrow subdued">A HOME FOR YOUR IMAGINATION</div><h2>Your little worlds <span className="count">{projects.length}</span></h2></div><button className="text-button" onClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); promptRef.current?.focus(); }}><Plus size={16}/> New idea</button></div>
        {projects.length ? <div className="library-grid">{projects.map(p => <article className="library-card" key={p.id}>
          <button className={"library-art art-" + p.theme} aria-label={"Open " + p.title} disabled={!!busy} onClick={() => openProject(p.id)}><img src={projectIconURL(p)} width={64} height={64} alt="" loading="lazy"/></button>
          <div className="library-info"><button className="card-title" disabled={!!busy} onClick={() => openProject(p.id)}>{p.title}</button><span className={"publish-label " + (p.publishedRevisionId ? "is-public" : "")}>{p.publishedRevisionId ? <><Globe size={11}/> Published</> : "Just for you"}</span></div>
          <button className="icon-button" aria-label={"Edit " + p.title} disabled={!!busy} onClick={() => openProject(p.id)}><ArrowUpRight size={19}/></button>
        </article>)}</div> : <div className="empty-library"><PocketMark/><p>Your first little world belongs right here.</p><span>Start with your own idea above.</span></div>}
      </section>
      <section className="phone-callout"><span className="phone-callout-icon"><Smartphone size={28}/></span><div><h3>A little world in your pocket.</h3><p>Publish a game, add it to your home screen, and take it on an offline adventure.</p></div><span className="callout-spark">✦</span></section>
      </>}<footer className="home-footer"><span>Dream it. Build it. Pocket it.</span><span className="app-version" aria-label={"Version " + props.version}>v{props.version}</span><span>Made for curious minds <span className="footer-heart">♡</span></span></footer>
    </main> : <main className="editor">
      <div className="editor-heading"><div className="editor-heading-left"><button className="icon-button back" aria-label="Back to my studio" onClick={home} disabled={!!busy}><ChevronLeft size={21}/></button><div><h1>{project.title}</h1><span>{project.publishedRevisionId === project.currentRevisionId ? "This version is published" : project.publishedRevisionId ? "New changes · ready when you are" : "Your own little world"}</span></div></div>
        <div className="editor-actions"><button className="secondary-button" aria-label="Versions" onClick={() => { setError(""); setModal("versions"); }} disabled={!!busy}><History size={16}/><span>Versions</span></button><button className="primary-button" onClick={() => { setError(""); setModal("share"); }} disabled={!!busy}><Globe size={16}/>Publish</button></div></div>
      <div className="mobile-tabs" role="tablist" aria-label="Game editor" onKeyDown={e => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === "Home" ? "chat" : e.key === "End" ? "play" : tab === "chat" ? "play" : "chat";
        setTab(next); document.getElementById("studio-tab-" + next)?.focus();
      }}><button id="studio-tab-chat" role="tab" aria-controls="studio-chat" aria-selected={tab === "chat"} tabIndex={tab === "chat" ? 0 : -1} onClick={() => setTab("chat")}><Sparkles size={16}/> Make changes</button><button id="studio-tab-play" role="tab" aria-controls="studio-play" aria-selected={tab === "play"} tabIndex={tab === "play" ? 0 : -1} onClick={() => setTab("play")}><Play size={16}/> Play</button></div>
      <div className={"editor-panels tab-" + tab}>
        <section id="studio-chat" className="chat-panel" aria-label="Game conversation"><div ref={chatScroll} className="chat-scroll"><div className="studio-intro"><span className="assistant-icon"><Sparkles size={19}/></span><h2>A little world, made by you.</h2><p>Tell me what you'd like to change. A new character? More stars? A whole new twist?</p></div>
          {[...project.revisions].sort((a,b) => a.createdAt.localeCompare(b.createdAt)).map((r,i) => <div className="conversation" key={r.id}><div className="user-message">{r.prompt}</div><div className="studio-message"><Sparkles size={15}/><div><p>{r.description}</p><span className="version-pill"><Check size={11}/> Version {i+1} saved {r.id === project.currentRevisionId && "· current"}</span></div></div></div>)}
          {busy === "generate" && <div className="thinking" role="status"><LoaderCircle className="spin" size={17}/> Making a little magic. This may take a minute…</div>}</div>
          <form className="change-form" onSubmit={generate}><label className="sr-only" htmlFor="change">Describe a change to your game</label><div className="change-box"><textarea id="change" placeholder="Make the stars rainbow colored…" value={change} onChange={e => setChange(e.target.value)} maxLength={MAX_PROMPT_CHARACTERS} disabled={!!busy}/><button className="send-button" aria-label="Make this change" disabled={!change.trim() || !!busy}>{busy === "generate" ? <LoaderCircle className="spin" size={19}/> : <ArrowUp size={20}/>}</button></div><span className="composer-note">Every version is saved. Curiosity encouraged.</span></form>
        </section>
        <section id="studio-play" className="preview-panel" aria-label="Playable game preview">{current && <GamePreview revision={current} projectId={project.id}/>}<p className="preview-caption"><Smartphone size={13}/> Touch to play. Publish to take it with you.</p></section>
      </div>
    </main>}
    {busy === "open" && <div className="loading-toast" role="status"><LoaderCircle size={17} className="spin"/> Opening your little world…</div>}
    {modal === "account" && <Modal title="Your account" onClose={() => setModal(null)}><p className="modal-description">Your public name appears with every game you publish.</p><form className="login-form" onSubmit={saveProfile}><label>Public name<input autoComplete="nickname" value={displayName} onChange={e => { setDisplayName(e.target.value); setProfileSaved(false); }} required maxLength={80} disabled={!!busy}/></label>{error && <p className="inline-error" role="alert">{error}</p>}<button className="primary-button" disabled={!!busy}>{busy === "profile" ? <LoaderCircle className="spin" size={17}/> : <>Save public name <Check size={16}/></>}</button>{profileSaved && <p className="profile-saved" role="status">Public name saved.</p>}</form>{!props.demo && <button className="text-button account-signout" onClick={() => void logout()} disabled={!!busy}><LogOut size={16}/>Sign out</button>}</Modal>}
    {modal === "versions" && project && <Modal title="Room to experiment" onClose={() => setModal(null)}><p className="modal-description">Go back to a favorite version. Your other versions stay saved, and your published game stays as it is.</p><div className="version-list">{project.revisions.map((r,i) => <div className="version-row" key={r.id}><div><strong>{r.title}</strong><span>{r.prompt.slice(0,100)}</span><small>{new Date(r.createdAt).toLocaleString()} {r.id === project.publishedRevisionId && "· Published"}</small></div><button className="small-button" disabled={!!busy || r.id === project.currentRevisionId} onClick={() => versionAction("restore", r.id)}>{r.id === project.currentRevisionId ? "Current" : "Restore"}</button></div>)}</div>{error && <p className="inline-error" role="alert">{error}</p>}</Modal>}
    {modal === "share" && project && <Modal title="Let your little world out" onClose={() => setModal(null)}><div className={"share-art art-" + project.theme}><img src={projectIconURL(project)} width={96} height={96} alt=""/></div><p className="modal-description">Publishing adds your game to the public game library. Anyone can find, play, and add it to their home screen for offline adventures.</p>
      {project.publishedRevisionId && <><label className="link-label" htmlFor="play-link">Your public play link</label><div className="share-link"><input id="play-link" readOnly value={playURL} onFocus={e => e.target.select()}/><button className="icon-button" aria-label="Copy play link" onClick={async () => { try { await navigator.clipboard.writeText(playURL); setCopied(true); setTimeout(() => setCopied(false),2500); } catch { setError("Select the link to copy it manually."); } }}>{copied ? <Check size={18}/> : <Copy size={18}/>}</button></div><a className="play-link" href={playURL} target="_blank" rel="noreferrer">Open published game <ArrowUpRight size={15}/></a></>}
      <button className="primary-button publish-button" disabled={!!busy || project.publishedRevisionId === project.currentRevisionId} onClick={() => versionAction("publish", project.currentRevisionId)}>{busy === "publish" ? <LoaderCircle className="spin" size={17}/> : project.publishedRevisionId === project.currentRevisionId ? <><Check size={17}/> This version is live</> : <><Globe size={17}/>{project.publishedRevisionId ? "Publish these changes" : "Publish my game"}</>}</button>
      {project.publishedRevisionId && <details className="unpublish-details"><summary>Take this game offline</summary><p>This stops new public access. Copies already downloaded can still be played offline.</p><button className="text-button danger" disabled={!!busy} onClick={() => versionAction("unpublish")}>Unpublish game</button></details>}
      {error && <p className="inline-error" role="alert">{error}</p>}</Modal>}
  </div>;
}
