import { requireStore } from "@/lib/auth";
import { errorResponse, requireId, StudioError } from "@/lib/errors";
import { jsonResponse } from "@/lib/json-response";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = requireId((await params).id);
    const game = await (await requireStore(request)).detail(id);
    if (!game) throw new StudioError("That game couldn't be found.", 404);
    return jsonResponse(game);
  } catch (error) { return errorResponse(error); }
}
