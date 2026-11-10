import { requestInput, runConversation } from "@/lib/conversation-flow";
import { studioProject } from "@/lib/conversations";
import { requireStore } from "@/lib/auth";
import { errorResponse, readMutation, requireId, StudioError } from "@/lib/errors";
import { generationModel, generateGame } from "@/lib/generate";
import { contentLimits, generationSettings, planningSettings } from "@/lib/config";
import { jsonResponse } from "@/lib/json-response";
export async function POST(request: Request) {
  try {
    const body = await readMutation(request);
    const store = await requireStore(request);
    if (body.conversationId) return jsonResponse(await runConversation(store, requireId(body.conversationId), requestInput(body, body.proposalId ? "proposal" : "direct")));
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const { maxPromptCharacters } = contentLimits();
    if (!prompt || prompt.length > maxPromptCharacters) throw new StudioError("Describe your idea in 1 to " + maxPromptCharacters.toLocaleString("en-US") + " characters.");
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
    if (!process.env.OPENROUTER_API_KEY) throw new StudioError("AI game-making isn't connected yet. Ask a grown-up to connect it; you can still play published games in the library.", 503);
    generationModel();
    generationSettings();
    if (!previous) { generationModel("plan"); planningSettings(); }
    const attempt = await store.reserveGeneration();
    let buildAttempt: string | undefined;
    try {
      const game = await generateGame(prompt, previous, async () => {
        buildAttempt = await store.reserveGeneration(attempt);
      });
      return jsonResponse(studioProject(await store.save({ ...game, notes: game.notes ?? previous?.notes ?? null, prompt, projectId, baseRevisionId })));
    } finally {
      if (buildAttempt) await store.finishGeneration(buildAttempt).catch(() => {});
      await store.finishGeneration(attempt).catch(() => {});
    }
  } catch (error) { return errorResponse(error); }
}
