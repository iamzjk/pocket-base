import { randomUUID } from "node:crypto";
import { contentLimits } from "./config";
import { StudioError } from "./errors";
import type { Conversation, ConversationMessage, ConversationRequest, ConversationRequestInput, Discussion, ProjectDetail } from "./types";

export const MAX_NOTES_CHARACTERS = 8000;
export function userPrompt(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  const max = contentLimits().maxPromptCharacters;
  if (!text || text.length > max) throw new StudioError("Describe your idea in 1 to " + max.toLocaleString("en-US") + " characters.");
  return text;
}
export function validateDiscussion(value: unknown): Discussion {
  const r = value as Discussion | null;
  if (!r || typeof r.reply !== "string" || !r.reply.trim() || r.reply.length > 8000 || typeof r.summary !== "string" || r.summary.length > 4000
    || (r.proposal != null && (typeof r.proposal !== "string" || !r.proposal.trim() || r.proposal.length > 12800 || r.proposal.trim().split(/\s+/u).length > 400)))
    throw new StudioError("The game maker couldn't finish a readable discussion. Please try again.", 502);
  return { reply: r.reply.trim(), summary: r.summary, proposal: r.proposal?.trim() || null };
}
export function message(c: Conversation, kind: ConversationMessage["kind"], text: string, revisionId?: string) {
  c.messages.push({ id: randomUUID(), kind, text, version: c.version, createdAt: new Date().toISOString(), ...(revisionId ? { revisionId } : {}) });
  c.updatedAt = new Date().toISOString();
}
export function checkRequest(c: Conversation, r: ConversationRequest, base: string | null) {
  if (r.status !== "pending" || r.version !== c.version || r.baseRevisionId !== base || Date.now() - Date.parse(r.startedAt) >= 360000)
    throw new StudioError("This discussion or game changed. Refresh before trying again.", 409);
}
export function beginRequest(c: Conversation, input: ConversationRequestInput, base: string | null, existing?: ConversationRequest): ConversationRequest {
  if (existing) {
    if (existing.conversationId !== c.id || existing.kind !== input.kind || (input.kind !== "proposal" && (existing.inputPrompt ?? existing.prompt) !== input.prompt))
      throw new StudioError("This request ID has already been used.", 409);
    if (existing.status === "complete") return existing;
    if (existing.status === "pending" && Date.now() - Date.parse(existing.startedAt) < 360000)
      throw new StudioError("This request is already in progress.", 409);
    if (existing.version !== c.version || existing.baseRevisionId !== base) throw new StudioError("This discussion changed. Refresh before trying again.", 409);
    existing.status = "pending"; existing.startedAt = new Date(Math.max(Date.now(), Date.parse(existing.startedAt) + 1)).toISOString(); return existing;
  }
  if (input.version !== c.version || (input.baseRevisionId || null) !== base)
    throw new StudioError("This discussion or game changed. Refresh before trying again.", 409);
  let brief: string | undefined;
  let prompt: string;
  if (input.kind === "proposal") {
    if (!c.proposal || c.proposal.id !== input.proposalId || c.proposal.version !== c.version || c.proposal.baseRevisionId !== base)
      throw new StudioError("This proposal changed. Continue the discussion before building.", 409);
    brief = c.proposal.brief;
    const users = c.messages.filter(m => m.kind === "user");
    prompt = (c.projectId ? users.at(-1) : users[0])?.text || "";
  } else {
    prompt = userPrompt(input.prompt);
    c.version++; c.proposal = null;
    if (c.messages.length === 0) c.title = prompt.slice(0, 70);
    message(c, "user", prompt);
  }
  if (input.kind === "direct" && !c.projectId) prompt = c.messages.find(m => m.kind === "user")!.text;
  return { inputPrompt: input.prompt, id: input.requestId, conversationId: c.id, version: c.version, kind: input.kind, prompt, brief,
    status: "pending", projectId: c.projectId, baseRevisionId: base, startedAt: new Date().toISOString() };
}
export function finishDiscussion(c: Conversation, r: ConversationRequest, result: Discussion, base: string | null) {
  checkRequest(c, r, base);
  const reply = validateDiscussion(result);
  c.summary = reply.summary;
  message(c, "assistant", reply.reply);
  if (reply.proposal) {
    c.proposal = { id: randomUUID(), brief: reply.proposal, version: c.version, baseRevisionId: base };
    message(c, "proposal", reply.proposal);
  }
  r.status = "complete";
  return c;
}
export function resetConversation(c: Conversation, kind: "saved" | "restored", revisionId: string) {
  c.version++; c.summary = ""; c.proposal = null; c.contextVersion = c.version;
  message(c, kind, kind === "saved" ? "Saved version" : "Restored version", revisionId);
}
// Only private server-side generation uses notes. Browser responses omit them.
export function studioProject(p: ProjectDetail): ProjectDetail {
  return { ...p, revisions: p.revisions.map(({ notes: _notes, ...r }) => r) };
}
export function recentDiscussion(c: Conversation) {
  const turns = [...new Set(c.messages.filter(m => m.kind === "user" && m.version > c.contextVersion).map(m => m.version))].slice(-6);
  let remaining = 100000;
  return c.messages.filter(m => turns.includes(m.version) && ["user", "assistant", "proposal"].includes(m.kind)).reverse().flatMap(m => {
    if (!remaining) return [];
    const text = m.text.slice(-remaining); remaining -= text.length;
    return [{ kind: m.kind, text }];
  }).reverse();
}
