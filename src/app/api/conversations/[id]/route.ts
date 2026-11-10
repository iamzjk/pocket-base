import { requireStore } from "@/lib/auth";
import { errorResponse, readMutation, requireId, StudioError } from "@/lib/errors";
import { jsonResponse } from "@/lib/json-response";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await (await requireStore(request)).conversation(requireId((await params).id));
    if (!c) throw new StudioError("That conversation couldn't be found.", 404);
    return jsonResponse(c);
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await readMutation(request);
    await (await requireStore(request)).deleteConversation(requireId((await params).id));
    return jsonResponse({ ok: true });
  } catch (error) { return errorResponse(error); }
}
