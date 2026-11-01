import { context } from "@/lib/auth";
import { starters } from "@/lib/starters";
import { Studio } from "@/components/studio";
import type { Project } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function Home() {
  const ctx = await context();
  let projects: Project[] = [];
  let error = "";
  try { projects = ctx.store ? await ctx.store.list() : []; }
  catch { error = "Your studio couldn't reach its saved games. Try refreshing in a moment."; }
  return <Studio initialProjects={projects} starters={starters.map(({ html: _html, ...s }) => s)} signedIn={!!ctx.user}
    demo={ctx.demo} configured={ctx.configured} aiConnected={!!process.env.OPENROUTER_API_KEY} initialError={error}/>;
}
