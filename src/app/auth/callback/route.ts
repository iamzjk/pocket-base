import { sessionClient, supabaseConfig } from "@/lib/auth";
import { finishGoogle, googleEnabled } from "@/lib/google-auth";

export async function GET(request: Request) {
  let destination = "/account?error=google";
  if (googleEnabled() && supabaseConfig()) {
    try { destination = await finishGoogle(await sessionClient(), new URL(request.url).searchParams); }
    catch { /* Keep configuration and provider failures private. */ }
  }
  return new Response(null, { status: 303, headers: {
    Location: destination, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  } });
}
