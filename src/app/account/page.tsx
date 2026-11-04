import { context, supabaseConfig } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
import { PublicNameForm } from "@/components/public-name-form";
import { PocketMark } from "@/components/artwork";
import { googleEnabled } from "@/lib/google-auth";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

export default async function Account({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const config = supabaseConfig();
  const params = await searchParams;
  const ctx = await context();
  let pending = false;
  let profileError = "";
  if (ctx.store && !ctx.demo) {
    try { pending = !(await ctx.store.profile())?.displayName; }
    catch { profileError = "Your public name couldn’t load. Please refresh and try again."; }
    if (!pending && !profileError && !params.error) redirect("/");
  }
  const error = params.error === "google_cancelled" ? "Google sign-in was cancelled. You can try again or use email."
    : params.error === "google" ? "Google sign-in couldn't finish. Please try again from this page." : "";
  return <main className="account-page"><a className="brand" href="/" aria-label="Pocket Base home"><PocketMark/><span>pocket<span className="brand-light">base</span></span></a>
    {pending || profileError ? <PublicNameForm loadError={profileError}/> : <AuthForm config={config} google={googleEnabled()} initialError={error}/>}
  </main>;
}
