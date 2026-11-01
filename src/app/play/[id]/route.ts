import { publicStore } from "@/lib/auth";
import { errorResponse, requireId } from "@/lib/errors";
import { playerDocument, PLAYER_POLICY } from "@/lib/pwa";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = requireId((await params).id);
    if (!new URL(request.url).pathname.endsWith("/")) {
      const url = new URL(request.url); url.pathname += "/";
      return Response.redirect(url, 308);
    }
    const game = await (await publicStore(request)).publicGame(id);
    if (!game) return new Response("This game isn't published right now.", { status: 404 });
    return new Response(playerDocument(game), { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": PLAYER_POLICY, "X-Frame-Options": "DENY",
    } });
  } catch (error) { return errorResponse(error); }
}
