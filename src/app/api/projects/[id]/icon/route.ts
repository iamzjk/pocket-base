import { requireStore } from "@/lib/auth";
import { errorResponse, requireId, StudioError } from "@/lib/errors";
import { renderIconPng } from "@/lib/icon-png";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = requireId((await params).id);
    const game = await (await requireStore(request)).projectIcon(id);
    if (!game) throw new StudioError("That game couldn't be found.", 404);
    const png = await renderIconPng(game, 192);
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
