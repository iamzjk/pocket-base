import { requireStore } from "@/lib/auth";
import { errorResponse, readMutation, requireId } from "@/lib/errors";
import { jsonResponse } from "@/lib/json-response";
import { requestInput, runConversation } from "@/lib/conversation-flow";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readMutation(request);
    return jsonResponse(await runConversation(await requireStore(request), requireId((await params).id), requestInput(body, "discussion")));
  } catch (error) { return errorResponse(error); }
}
