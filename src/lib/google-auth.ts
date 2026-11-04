import type { SupabaseClient } from "@supabase/supabase-js";
import { StudioError } from "./errors";

export function googleSite(env: Record<string, string | undefined> = process.env): string | null {
  try {
    const site = new URL(env.POCKET_BASE_SITE_URL || "");
    const local = !env.VERCEL && ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname);
    if ((site.protocol !== "https:" && !(local && site.protocol === "http:")) ||
        site.username || site.password || site.pathname !== "/" || site.search || site.hash) return null;
    return site.origin;
  } catch { return null; }
}

export function googleEnabled(env: Record<string, string | undefined> = process.env) {
  return env.POCKET_BASE_GOOGLE_SIGN_IN === "true" && googleSite(env) !== null;
}

export async function startGoogle(client: SupabaseClient, origin: string, env: Record<string, string | undefined> = process.env) {
  if (!googleEnabled(env)) throw new StudioError("Google sign-in isn't available right now. Use email or try again later.", 503);
  const site = googleSite(env)!;
  if (origin !== site) throw new StudioError("Open the studio's main address to continue with Google.", 403);
  try {
    const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: {
      redirectTo: site + "/auth/callback", skipBrowserRedirect: true, scopes: "openid email profile",
    } });
    if (error || !data.url) throw new Error();
    return { url: data.url };
  } catch { throw new StudioError("Couldn't start Google sign-in. Please try again.", 503); }
}

// Only these fixed paths can leave the callback. Never echo provider errors or a supplied `next`.
export async function finishGoogle(client: SupabaseClient, params: URLSearchParams): Promise<string> {
  if (params.has("error")) return params.get("error") === "access_denied" ? "/account?error=google_cancelled" : "/account?error=google";
  const code = params.get("code");
  if (!code || code.length > 4096) return "/account?error=google";
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error || !data.session) return "/account?error=google";
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user) return "/account?error=google";
    const profile = await client.rpc("creator_profile");
    if (profile.error || !profile.data) return "/account?error=google";
    return profile.data.displayName ? "/" : "/account";
  } catch { return "/account?error=google"; }
}
