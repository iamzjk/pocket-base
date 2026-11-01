import { publicStore } from "@/lib/auth";
import { errorResponse, requireId, StudioError } from "@/lib/errors";
import { gameManifest } from "@/lib/pwa";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const game = await (await publicStore(request)).publicGame(requireId((await params).id));
    if (!game) throw new StudioError("This game isn't published right now.", 404);
    return Response.json(gameManifest(game), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
