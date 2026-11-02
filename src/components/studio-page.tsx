import { context, publicStore } from "@/lib/auth";
import { Studio } from "@/components/studio";
import type { Project, GameLibrary } from "@/lib/types";
import { version } from "../../package.json";
export default async function StudioPage({ view }: { view: "studio" | "library" }) {
  const ctx = await context();
  let projects: Project[] = [];
  let library: GameLibrary = { games: [], hasMore: false };
  let error = "";
  let libraryError = "";
  let displayName = "";
  const [privateResult, publicResult, profileResult] = await Promise.allSettled([
    view === "studio" && ctx.store ? ctx.store.list() : Promise.resolve([]),
    view === "library" && ctx.configured ? publicStore().then(store => store.publishedGames()) : Promise.resolve(library),
    ctx.store ? ctx.store.profile() : Promise.resolve(null),
  ]);
  if (privateResult.status === "fulfilled") projects = privateResult.value;
  else error = "Your studio couldn't reach its saved games. Try refreshing in a moment.";
  if (publicResult.status === "fulfilled") library = publicResult.value;
  else libraryError = "The game library couldn't load. Try again in a moment.";
  if (profileResult.status === "fulfilled") displayName = profileResult.value?.displayName || "";
  else error ||= "Your account name couldn’t load. Try refreshing in a moment.";
  return <Studio initialDisplayName={displayName} initialProjects={projects} initialLibrary={library} version={version} view={view} signedIn={!!ctx.user}
    demo={ctx.demo} configured={ctx.configured} aiConnected={!!process.env.OPENROUTER_API_KEY} initialError={error} initialLibraryError={libraryError}/>;
}
