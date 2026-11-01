import { requireStore } from "@/lib/auth";
import { errorResponse, requireId, StudioError } from "@/lib/errors";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = requireId((await params).id);
    const game = await (await requireStore(request)).detail(id);
    if (!game) throw new StudioError("That game couldn't be found.", 404);
    return Response.json(game, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
