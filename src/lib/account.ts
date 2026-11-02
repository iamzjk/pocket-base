import type { SupabaseClient } from "@supabase/supabase-js";
import { publicName } from "./profile";
import { StudioError } from "./errors";

export async function authenticate(client: SupabaseClient, input: {
  signup: boolean; email: string; password: string; displayName: string; captchaToken: string; captchaRequired?: boolean;
}) {
  // Before CAPTCHA activation, existing users can still sign in. Registration
  // always requires a challenge; enabled Supabase CAPTCHA also independently
  // rejects any sign-in request without a valid token.
  if ((input.signup || input.captchaRequired !== false) && !input.captchaToken)
    throw new StudioError("Complete the security check to continue.");
  const email = input.email.trim();
  if (!email || email.length > 254 || !input.password || input.password.length > 200)
    throw new StudioError("Enter your email and password.");
  const result = input.signup
    ? await client.auth.signUp({ email, password: input.password,
        options: { data: { display_name: publicName(input.displayName) }, captchaToken: input.captchaToken } })
    : await client.auth.signInWithPassword({ email, password: input.password,
        ...(input.captchaToken ? { options: { captchaToken: input.captchaToken } } : {}) });
  if (result.error) {
    const code = result.error.code || "";
    if (result.error.status === 429) throw new StudioError("Too many attempts. Please try again later.", 429);
    if (code === "captcha_failed") throw new StudioError("The security check expired or failed. Please try it again.");
    if (code === "user_already_exists" || code === "email_exists") throw new StudioError("An account already uses that email. Try signing in.");
    if (code === "weak_password") throw new StudioError("Choose a stronger password with at least 8 characters.");
    throw new StudioError(input.signup ? "Couldn't create your account. Check your details and try again." : "That sign-in didn't work. Check your email and password.");
  }
  if (!result.data.session) throw new StudioError("Your account couldn't sign in yet. Please try signing in again later.", 503);
  return { accessToken: result.data.session.access_token, refreshToken: result.data.session.refresh_token };
}

export async function acceptSession(client: SupabaseClient, body: Record<string, unknown>) {
  if (body.action !== "session" || typeof body.accessToken !== "string" || typeof body.refreshToken !== "string" ||
      !body.accessToken || !body.refreshToken || body.accessToken.length > 10_000 || body.refreshToken.length > 2_000)
    throw new StudioError("Please sign in again.", 401);
  // Verify with Auth before writing any cookies. Never trust user data from the body.
  const verified = await client.auth.getUser(body.accessToken);
  if (verified.error || !verified.data.user) throw new StudioError("Please sign in again.", 401);
  const saved = await client.auth.setSession({ access_token: body.accessToken, refresh_token: body.refreshToken });
  if (saved.error || !saved.data.session) throw new StudioError("Couldn't finish signing in. Please try again.", 401);
}
