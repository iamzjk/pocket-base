import { requireStore } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
export async function GET(request: Request) {
  try { return Response.json(await (await requireStore(request)).list(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
