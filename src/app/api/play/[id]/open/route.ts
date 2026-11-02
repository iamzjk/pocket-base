import { publicStore } from "@/lib/auth";
import { errorResponse, readMutation, requireId, StudioError, UUID } from "@/lib/errors";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = requireId((await params).id);
    const body = await readMutation(request);
    if (typeof body.visitorId !== "string" || !UUID.test(body.visitorId)) throw new StudioError("That game visit couldn't be recorded.");
    await (await publicStore(request)).recordGameOpen(id, body.visitorId);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
