import { sessionClient } from "@/lib/auth";
import { errorResponse, readMutation, StudioError } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    const body = await readMutation(request);
    const client = await sessionClient();
    if (body.action === "logout") {
      const { error } = await client.auth.signOut();
      if (error) throw new StudioError("Couldn't sign out. Try again.", 503);
      return Response.json({ ok: true });
    }
    if (body.action !== "login" || typeof body.email !== "string" || typeof body.password !== "string" ||
        body.email.length > 254 || body.password.length > 200) throw new StudioError("Enter your studio email and password.");
    const { error } = await client.auth.signInWithPassword({ email: body.email, password: body.password });
    if (error) throw new StudioError("That sign-in didn't work. Check with the grown-up who set up your studio.", 401);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
