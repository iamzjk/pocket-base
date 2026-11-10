import { studioProject } from "@/lib/conversations";
import { requireStore } from "@/lib/auth";
import { errorResponse, readMutation, requireId, StudioError } from "@/lib/errors";
import { jsonResponse } from "@/lib/json-response";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readMutation(request);
    const id = requireId((await params).id);
    const store = await requireStore(request);
    if (body.action === "unpublish") {
      await store.unpublish(id);
      return Response.json({ ok: true });
    }
    if (body.action !== "publish" && body.action !== "restore") throw new StudioError("Choose a version action.");
    return jsonResponse(studioProject(await store.select(id, requireId(body.revisionId), body.action)));
  } catch (error) { return errorResponse(error); }
}
