import { publicStore } from "@/lib/auth";
import { errorResponse, StudioError } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    const value = new URL(request.url).searchParams.get("offset") || "0";
    const offset = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(offset) || offset > 2_147_483_647) throw new StudioError("Choose a valid library page.");
    return Response.json(await (await publicStore(request)).publishedGames(offset), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
