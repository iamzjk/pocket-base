import { context, publicStore } from "@/lib/auth";
import { Studio } from "@/components/studio";
import type { Project, GameLibrary, CreatorProfile } from "@/lib/types";
import { version } from "../../package.json";
<<<<<<< Updated upstream
import { redirect } from "next/navigation";
=======
import { contentLimits } from "@/lib/config";
>>>>>>> Stashed changes
export default async function StudioPage({ view }: { view: "studio" | "library" }) {
  const ctx = await context();
  // Complete the profile before reading private projects, including after an interrupted OAuth signup.
  let profile: CreatorProfile | null = null;
  let error = "";
  try { profile = ctx.store ? await ctx.store.profile() : null; }
  catch {
    if (view === "studio") redirect("/account");
    error = "Your account name couldn’t load. Try refreshing in a moment.";
  }
  if (view === "studio" && ctx.store && !profile?.displayName) redirect("/account");
  let projects: Project[] = [];
  let library: GameLibrary = { games: [], hasMore: false, leaderboard: [] };
  let libraryError = "";
  const displayName = profile?.displayName || "";
  const [privateResult, publicResult] = await Promise.allSettled([
    view === "studio" && ctx.store ? ctx.store.list() : Promise.resolve([]),
    view === "library" && ctx.configured ? publicStore().then(store => store.publishedGames()) : Promise.resolve(library),
  ]);
  if (privateResult.status === "fulfilled") projects = privateResult.value;
  else error = "Your studio couldn't reach its saved games. Try refreshing in a moment.";
  if (publicResult.status === "fulfilled") library = publicResult.value;
  else libraryError = "The game library couldn't load. Try again in a moment.";
  return <Studio initialDisplayName={displayName} initialProjects={projects} initialLibrary={library} version={version} view={view} signedIn={!!ctx.user}
    maxPromptCharacters={contentLimits().maxPromptCharacters}
    demo={ctx.demo} configured={ctx.configured} aiConnected={!!process.env.OPENROUTER_API_KEY} initialError={error} initialLibraryError={libraryError}/>;
}
