import { generationSettings, planningSettings } from "./config";
import { recentDiscussion, studioProject, userPrompt } from "./conversations";
import { StudioError, requireId } from "./errors";
import { discussGame, generateGame, generationModel } from "./generate";
import type { Store, ConversationRequestInput } from "./types";

export function requestInput(body: Record<string, unknown>, kind: ConversationRequestInput["kind"]): ConversationRequestInput {
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 0) throw new StudioError("Refresh this discussion before continuing.", 409);
  return { requestId: requireId(body.requestId), version: Number(body.version), kind,
    ...(body.baseRevisionId ? { baseRevisionId: requireId(body.baseRevisionId) } : {}),
    ...(kind === "proposal" ? { proposalId: requireId(body.proposalId) } : { prompt: userPrompt(body.prompt) }) };
}
export async function runConversation(store: Store, id: string, input: ConversationRequestInput) {
  const operation = await store.beginConversationRequest(id, input);
  if (operation.status === "complete") {
    if (operation.kind === "discussion") return await store.conversation(id);
    const p = operation.projectId && await store.detail(operation.projectId);
    if (!p) throw new StudioError("That game couldn't be found.", 404);
    return studioProject(p);
  }
  let attempt: string | undefined, buildAttempt: string | undefined;
  try {
    const c = await store.conversation(id);
    if (!c) throw new StudioError("That conversation couldn't be found.", 404);
    const project = c.projectId ? await store.detail(c.projectId) : null;
    if ((project?.currentRevisionId || null) !== operation.baseRevisionId) throw new StudioError("This game changed. Refresh before trying again.", 409);
    const previous = project?.revisions.find(r => r.id === operation.baseRevisionId);
    if (!process.env.OPENROUTER_API_KEY) throw new StudioError("AI game-making isn't connected yet.", 503);
    if (input.kind === "discussion") { generationModel("plan"); planningSettings(); }
    else {
      generationModel(); generationSettings();
      if (!previous && input.kind === "direct") { generationModel("plan"); planningSettings(); }
    }
    attempt = await store.reserveGeneration();
    if (input.kind === "discussion") return await store.completeDiscussion(operation.id, await discussGame(c, previous), operation.startedAt);
    // User-authored prompts remain separate from generated proposals and private notes.
    const userDecisions = recentDiscussion(c).filter(m => m.kind === "user");
    const discussionContext = JSON.stringify({ summary: c.summary, recentUserDecisions: userDecisions });
    const context = operation.brief ? operation.brief + "\n\nDiscussion decisions (latest user decisions take priority):\n" + discussionContext : undefined;
    const inferencePrompt = input.kind === "direct" && (c.summary || userDecisions.length > 1)
      ? operation.prompt + "\n\nDiscussion decisions (latest user decisions take priority):\n" + discussionContext
      : operation.prompt;
    const game = await generateGame(inferencePrompt, previous, async () => {
      buildAttempt = await store.reserveGeneration(attempt);
    }, context);
    return studioProject(await store.save({ ...game, notes: game.notes ?? previous?.notes ?? null, prompt: operation.prompt,
      projectId: project?.id, baseRevisionId: previous?.id, conversationRequestId: operation.id, conversationRequestStartedAt: operation.startedAt }));
  } catch (error) {
    await store.failConversationRequest(operation.id, operation.startedAt).catch(() => {});
    throw error;
  } finally {
    if (buildAttempt) await store.finishGeneration(buildAttempt).catch(() => {});
    if (attempt) await store.finishGeneration(attempt).catch(() => {});
  }
}
