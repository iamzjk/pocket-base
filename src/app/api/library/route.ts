import { publicStore } from "@/lib/auth";
import { errorResponse, StudioError } from "@/lib/errors";
import { libraryQuery } from "@/lib/library";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const value = params.get("offset") || "0";
    const offset = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(offset) || offset > 2_147_483_647) throw new StudioError("Choose a valid library page.");
    const query = libraryQuery(params.get("q") || "");
    return Response.json(await (await publicStore(request)).publishedGames(offset, query), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
