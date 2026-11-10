import { studioProject } from "@/lib/conversations";
import { requireStore } from "@/lib/auth";
import { errorResponse, readMutation, requireId, StudioError } from "@/lib/errors";
import { jsonResponse } from "@/lib/json-response";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = requireId((await params).id);
    const game = await (await requireStore(request)).detail(id);
    if (!game) throw new StudioError("That game couldn't be found.", 404);
    return jsonResponse(studioProject(game));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await readMutation(request);
    const id = requireId((await params).id);
    await (await requireStore(request)).deleteGame(id);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
