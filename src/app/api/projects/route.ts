import { requireStore } from "@/lib/auth";
import { errorResponse, readMutation, StudioError } from "@/lib/errors";
import { starters } from "@/lib/starters";
import { validateGame } from "@/lib/game";
export async function GET(request: Request) {
  try { return Response.json(await (await requireStore(request)).list(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const body = await readMutation(request);
    const store = await requireStore(request);
    const starter = starters.find(s => s.key === body.starter);
    if (!starter) throw new StudioError("Pick a starter to remix.");
    const game = validateGame(starter);
    return Response.json(await store.save({ ...game, prompt: "Started with " + starter.title + "." }), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
