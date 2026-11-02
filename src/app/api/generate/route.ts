import { requireStore } from "@/lib/auth";
import { errorResponse, readMutation, requireId, StudioError } from "@/lib/errors";
import { generationModel, generateGame } from "@/lib/generate";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const body = await readMutation(request);
    const store = await requireStore(request);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt || prompt.length > 2000) throw new StudioError("Describe your idea in 1 to 2,000 characters.");
    let previous;
    let projectId: string | undefined;
    let baseRevisionId: string | undefined;
    if (body.projectId) {
      projectId = requireId(body.projectId);
      baseRevisionId = requireId(body.baseRevisionId);
      const project = await store.detail(projectId);
      if (!project) throw new StudioError("That game couldn't be found.", 404);
      if (project.currentRevisionId !== baseRevisionId) throw new StudioError("This game changed in another tab. Refresh before trying again.", 409);
      previous = project.revisions.find(r => r.id === baseRevisionId);
    }
    if (!process.env.OPENROUTER_API_KEY) throw new StudioError("AI game-making isn't connected yet. Ask a grown-up to connect it; you can still play the starter games.", 503);
    generationModel();
    const attempt = await store.reserveGeneration();
    try {
      const game = await generateGame(prompt, previous);
      return Response.json(await store.save({ ...game, prompt, projectId, baseRevisionId }));
    } finally {
      await store.finishGeneration(attempt).catch(() => {});
    }
  } catch (error) { return errorResponse(error); }
}
