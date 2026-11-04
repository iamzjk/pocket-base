import { sessionClient } from "@/lib/auth";
import { errorResponse, readMutation, StudioError } from "@/lib/errors";
import { acceptSession } from "@/lib/account";
import { startGoogle } from "@/lib/google-auth";
export async function POST(request: Request) {
  try {
    const body = await readMutation(request);
    const client = await sessionClient();
    if (body.action === "google") {
      return Response.json(await startGoogle(client, request.headers.get("origin") || ""), { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "logout") {
      const { error } = await client.auth.signOut();
      if (error) throw new StudioError("Couldn't sign out. Try again.", 503);
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    await acceptSession(client, body);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
