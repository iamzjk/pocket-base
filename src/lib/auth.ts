import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { DemoStore, DEMO_OWNER } from "./demo-store";
import { SupabaseStore } from "./supabase-store";
import { StudioError } from "./errors";
import type { Store } from "./types";

export function demoAllowed(host: string) {
  let hostname: string;
  try { hostname = new URL("http://" + host).hostname; } catch { return false; }
  return process.env.POCKET_BASE_DEMO === "true" && !process.env.VERCEL &&
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}
export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}
export async function sessionClient() {
  const config = supabaseConfig();
  if (!config) throw new StudioError("A grown-up needs to finish setting up this studio.", 503);
  const jar = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: { getAll: () => jar.getAll(), setAll: entries => {
      try { entries.forEach(({ name, value, options }) => jar.set(name, value, options)); }
      catch { /* The proxy refreshes cookies when rendering a server component. */ }
    } },
  });
}
export async function context(request?: Request): Promise<{ store: Store | null; user: { id: string } | null; demo: boolean; configured: boolean }> {
  const host = request ? request.headers.get("host") || new URL(request.url).host : (await headers()).get("host") || "";
  if (demoAllowed(host)) return { store: new DemoStore(), user: { id: DEMO_OWNER }, demo: true, configured: true };
  if (!supabaseConfig()) return { store: null, user: null, demo: false, configured: false };
  const client = await sessionClient();
  const { data: { user } } = await client.auth.getUser();
  return { store: user ? new SupabaseStore(client) : null, user: user ? { id: user.id } : null, demo: false, configured: true };
}
export async function requireStore(request: Request) {
  const ctx = await context(request);
  if (!ctx.store) throw new StudioError(ctx.configured ? "Ask a grown-up to sign in to your studio." : "A grown-up needs to finish setting up this studio.", ctx.configured ? 401 : 503);
  return ctx.store;
}
export async function publicStore(request: Request): Promise<Store> {
  if (demoAllowed(request.headers.get("host") || new URL(request.url).host)) return new DemoStore();
  const config = supabaseConfig();
  if (!config) throw new StudioError("This studio is still getting ready. Try again later.", 503);
  return new SupabaseStore(createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } }));
}
