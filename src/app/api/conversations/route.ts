import { requireStore } from "@/lib/auth";
import { errorResponse, readMutation, requireId } from "@/lib/errors";
import { jsonResponse } from "@/lib/json-response";
export async function GET(request: Request) {
  try { return jsonResponse(await (await requireStore(request)).conversations()); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const body = await readMutation(request);
    return jsonResponse(await (await requireStore(request)).createConversation(body.projectId ? requireId(body.projectId) : undefined));
  } catch (error) { return errorResponse(error); }
}
