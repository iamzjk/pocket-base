import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beginRequest, checkRequest, finishDiscussion, resetConversation } from "./conversations";
import type { Conversation, ConversationRequest, ConversationRequestInput, Discussion } from "./types";
import { requireId, StudioError } from "./errors";
import { classicGames, classicListings } from "./classic-games";
import { publicName } from "./profile";
import { libraryQuery } from "./library";
import { validateSaveLimits } from "./save-limits";
import { GENERATION_LEASE_SECONDS } from "./limits";
import { LIBRARY_PAGE_SIZE, type Project, type Revision, type SaveInput, type Store, type ProjectDetail, type PublicGame, type GameLibrary, type GameIcon } from "./types";

export const DEMO_OWNER = "00000000-0000-4000-8000-000000000001";
interface State {
  conversations?: (Conversation & { ownerId: string })[];
  conversationRequests?: (ConversationRequest & { ownerId: string })[];
  projects: Project[]; revisions: Revision[]; profiles?: Record<string, string>;
  attempts: { id: string; ownerId: string; at: string; finished: boolean }[];
  playCounts?: Record<string, number>;
  playVisitors?: { gameId: string; visitorId: string; countedAt: number }[];
}
const globalQueue = globalThis as typeof globalThis & { pocketQueue?: Promise<unknown> };
export function initialState(): State {
  return { projects: [], revisions: [], attempts: [] };
}
export class DemoStore implements Store {
  constructor(private ownerId = DEMO_OWNER, private directory = process.env.POCKET_BASE_DATA_DIR || path.join(process.cwd(), ".local")) {}
  private ownedConversation(s: State, id: string) {
    const c = s.conversations?.find(c => c.id === id && c.ownerId === this.ownerId);
    if (!c) throw new StudioError("That conversation couldn't be found.", 404);
    return c;
  }
  async conversations() { return this.transaction(s => (s.conversations || []).filter(c => c.ownerId === this.ownerId)
    .map(({ id, projectId, title, updatedAt }) => ({ id, projectId, title, updatedAt })).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))); }
  async createConversation(projectId?: string) {
    return this.transaction(s => {
      const p = projectId ? this.owned(s, projectId) : null;
      const list = s.conversations ||= [];
      const existing = p && list.find(c => c.projectId === p.id && c.ownerId === this.ownerId);
      if (existing) return existing;
      const c: Conversation & { ownerId: string } = { id: randomUUID(), ownerId: this.ownerId, projectId: p?.id || null, title: p?.title || "New idea",
        version: 0, contextVersion: 0, summary: "", proposal: null, messages: [], updatedAt: new Date().toISOString() };
      if (p) for (const r of s.revisions.filter(r => r.projectId === p.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt))) {
        c.messages.push({id:randomUUID(),kind:"user",text:r.prompt,version:0,createdAt:r.createdAt},
          {id:randomUUID(),kind:"saved",text:"Saved version",version:0,createdAt:r.createdAt,revisionId:r.id});
      }
      list.push(c); return c;
    }, true);
  }
  async conversation(id: string) { return this.transaction(s => s.conversations?.find(c => c.id === id && c.ownerId === this.ownerId) || null); }
  async deleteConversation(id: string) { await this.transaction(s => {
    const c = this.ownedConversation(s, id);
    if (c.projectId) throw new StudioError("Delete the game from Game options instead.", 409);
    s.conversations = s.conversations!.filter(x => x.id !== c.id);
    s.conversationRequests = s.conversationRequests?.filter(r => r.conversationId !== c.id);
  }, true); }
  async beginConversationRequest(id: string, input: ConversationRequestInput) {
    return this.transaction(s => {
      const c = this.ownedConversation(s, id);
      const base = c.projectId ? this.owned(s, c.projectId).currentRevisionId : null;
      const requests = s.conversationRequests ||= [];
      const existing = requests.find(r => r.id === input.requestId);
      if (existing && existing.ownerId !== this.ownerId) throw new StudioError("This request ID has already been used.", 409);
      if (!existing && requests.some(r => r.conversationId === c.id && r.version === c.version && r.status === "pending" && Date.now() - Date.parse(r.startedAt) < 360000))
        throw new StudioError("This request is already in progress.", 409);
      const r = beginRequest(c, input, base, existing);
      if (!existing) requests.push({ ...r, ownerId: this.ownerId });
      return r;
    }, true);
  }
  async completeDiscussion(id: string, result: Discussion, startedAt?: string) { return this.transaction(s => {
    const r = s.conversationRequests?.find(r => r.id === id && r.ownerId === this.ownerId);
    if (!r || r.kind !== "discussion") throw new StudioError("That request couldn't be found.", 404);
    if (startedAt && r.startedAt !== startedAt) throw new StudioError("This request expired. Please try again.", 409);
    const c = this.ownedConversation(s, r.conversationId);
    return finishDiscussion(c, r, result, c.projectId ? this.owned(s, c.projectId).currentRevisionId : null);
  }, true); }
  async failConversationRequest(id: string, startedAt?: string) { await this.transaction(s => {
    const r = s.conversationRequests?.find(r => r.id === id && r.ownerId === this.ownerId);
    if (r?.status === "pending" && (!startedAt || r.startedAt === startedAt)) r.status = "failed";
  }, true); }
  async profile() { return this.transaction(s => ({ displayName: s.profiles?.[this.ownerId] || "Local creator" })); }
  async saveProfile(displayName: string) {
    const name = publicName(displayName);
    return this.transaction(s => { (s.profiles ||= {})[this.ownerId] = name; return { displayName: name }; }, true);
  }
  private async transaction<T>(fn: (state: State) => T, mutate = false): Promise<T> {
    const task = (globalQueue.pocketQueue || Promise.resolve()).catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true });
      const file = path.join(this.directory, "demo.json");
      let state: State;
      try { state = JSON.parse(await readFile(file, "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        state = initialState();
      }
      const result = fn(state);
      if (mutate) {
        const temporary = file + "." + randomUUID() + ".tmp";
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
        await rename(temporary, file);
      }
      return result;
    });
    globalQueue.pocketQueue = task;
    return task;
  }
  private owned(s: State, id: string) {
    const p = s.projects.find(p => p.id === id && p.ownerId === this.ownerId);
    if (!p) throw new StudioError("That game couldn't be found.", 404);
    return p;
  }
  private view(s: State, p: Project): ProjectDetail {
    return { ...p, revisions: s.revisions.filter(r => r.projectId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }
  async list() { return this.transaction(s => s.projects.filter(p => p.ownerId === this.ownerId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))); }
  async detail(id: string) { return this.transaction(s => { const p = s.projects.find(p => p.id === id && p.ownerId === this.ownerId); return p ? this.view(s, p) : null; }); }
  async projectIcon(id: string): Promise<GameIcon | null> {
    return this.transaction(s => {
      const p = s.projects.find(p => p.id === id && p.ownerId === this.ownerId);
      const r = p && s.revisions.find(r => r.id === p.currentRevisionId && r.projectId === p.id);
      return r ? { title: r.title, theme: r.theme, iconSvg: r.iconSvg || null } : null;
    });
  }
  async save(input: SaveInput): Promise<ProjectDetail> {
    validateSaveLimits(input);
    return this.transaction(s => {
      const now = new Date().toISOString();
      const operation = input.conversationRequestId ? s.conversationRequests?.find(r => r.id === input.conversationRequestId && r.ownerId === this.ownerId) : undefined;
      const conversation = operation ? this.ownedConversation(s, operation.conversationId) : undefined;
      if (input.conversationRequestId) {
        if (!operation || !conversation || operation.kind === "discussion" || operation.projectId !== (input.projectId || null) || operation.prompt !== input.prompt || (input.conversationRequestStartedAt && operation.startedAt !== input.conversationRequestStartedAt)) throw new StudioError("That request couldn't be found.", 409);
        checkRequest(conversation, operation, input.baseRevisionId || null);
      }
      const p = input.projectId ? this.owned(s, input.projectId) : {
        id: randomUUID(), ownerId: this.ownerId, title: input.title, description: input.description, theme: input.theme,
        currentRevisionId: "", publishedRevisionId: null, createdAt: now, updatedAt: now,
      };
      if (input.projectId && p.currentRevisionId !== input.baseRevisionId)
        throw new StudioError("This game changed in another tab. Refresh before trying again.", 409);
      if (!input.projectId) s.projects.push(p);
      const previous = s.revisions.find(r => r.id === p.currentRevisionId && r.projectId === p.id);
      const r: Revision = { title: input.title, description: input.description, theme: input.theme, html: input.html, prompt: input.prompt, notes: input.notes ?? previous?.notes ?? null, iconSvg: previous?.iconSvg || input.iconSvg || null, id: randomUUID(), projectId: p.id, createdAt: now };
      s.revisions.push(r);
      Object.assign(p, { title: r.title, description: r.description, theme: r.theme, currentRevisionId: r.id, updatedAt: now });
      const c = conversation || s.conversations?.find(c => c.projectId === p.id);
      if (c) { c.projectId = p.id; resetConversation(c, "saved", r.id); }
      if (operation) { operation.status = "complete"; operation.projectId = p.id; }
      return this.view(s, p);
    }, true);
  }
  async select(id: string, revisionId: string, action: "restore" | "publish") {
    return this.transaction(s => {
      const p = this.owned(s, id);
      const r = s.revisions.find(r => r.id === revisionId && r.projectId === p.id);
      if (!r) throw new StudioError("That version couldn't be found.", 404);
      if (action === "publish") {
        if (p.publishedRevisionId !== r.id) p.publishedAt = new Date().toISOString();
        p.publishedRevisionId = r.id;
      }
      else {
        Object.assign(p, { currentRevisionId: r.id, title: r.title, description: r.description, theme: r.theme });
        const c = s.conversations?.find(c => c.projectId === p.id);
        if (c) resetConversation(c, "restored", r.id);
      }
      p.updatedAt = new Date().toISOString();
      return this.view(s, p);
    }, true);
  }
  async unpublish(id: string) { await this.transaction(s => { const p = this.owned(s, id); p.publishedRevisionId = null; p.publishedAt = null; }, true); }
  async deleteGame(id: string) {
    await this.transaction(s => {
      const p = this.owned(s, id);
      s.projects = s.projects.filter(project => project.id !== p.id);
      s.revisions = s.revisions.filter(revision => revision.projectId !== p.id);
      const ids = s.conversations?.filter(c => c.projectId === p.id).map(c => c.id) || [];
      s.conversations = s.conversations?.filter(c => !ids.includes(c.id));
      s.conversationRequests = s.conversationRequests?.filter(r => !ids.includes(r.conversationId));
      if (s.playCounts) delete s.playCounts[p.id];
      if (s.playVisitors) s.playVisitors = s.playVisitors.filter(visit => visit.gameId !== p.id);
    }, true);
  }
  async reserveGeneration(parentAttemptId?: string) {
    return this.transaction(s => {
      const active = (a: State["attempts"][number]) => a.ownerId === this.ownerId && !a.finished
        && Date.now() - Date.parse(a.at) < GENERATION_LEASE_SECONDS * 1_000;
      if (parentAttemptId && !s.attempts.some(a => a.id === parentAttemptId && active(a)))
        throw new StudioError("This game-making request expired. Please try again.", 409);
      const today = new Date().toISOString().slice(0, 10);
      const attempts = s.attempts.filter(a => a.at.startsWith(today));
      if (attempts.length >= 40 || attempts.filter(a => a.ownerId === this.ownerId).length >= 20)
        throw new StudioError("That's today's game-making allowance. Your games are still here to play.", 429);
      if (s.attempts.some(a => a.id !== parentAttemptId && active(a)))
        throw new StudioError("A game is already being made. Give it a moment.", 409);
      const id = randomUUID();
      s.attempts.push({ id, ownerId: this.ownerId, at: new Date().toISOString(), finished: false });
      return id;
    }, true);
  }
  async finishGeneration(id: string) { await this.transaction(s => { const a = s.attempts.find(a => a.id === id && a.ownerId === this.ownerId); if (a) a.finished = true; }, true); }
  async publicGame(id: string): Promise<PublicGame | null> {
    return this.transaction(s => {
      const classic = classicGames.find(g => g.id === id);
      if (classic) { const { creatorName: _name, updatedAt: _date, ...game } = classic; return game; }
      const p = s.projects.find(p => p.id === id);
      const r = p && s.revisions.find(r => r.id === p.publishedRevisionId && r.projectId === p.id);
      return p && r ? { id: p.id, revisionId: r.id, title: r.title, description: r.description, theme: r.theme, html: r.html, iconSvg: r.iconSvg || null } : null;
    });
  }
  async publishedGames(offset = 0, query = ""): Promise<GameLibrary> {
    const search = libraryQuery(query).toLowerCase();
    return this.transaction(s => {
      const community = s.projects.filter(p => !classicGames.some(g => g.id === p.id)).flatMap(p => {
        const r = s.revisions.find(r => r.id === p.publishedRevisionId && r.projectId === p.id);
        return r ? [{ id: p.id, revisionId: r.id, title: r.title, description: r.description, theme: r.theme,
          creatorName: s.profiles?.[p.ownerId] || "Local creator", updatedAt: p.publishedAt || r.createdAt }] : [];
      });
      const published = [...classicListings, ...community].map(game => ({ ...game, playCount: s.playCounts?.[game.id] || 0 }))
        .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      const matches = published.filter(game => [game.title, game.description, game.creatorName]
        .some(value => value.toLowerCase().includes(search)));
      return {
        games: matches.slice(offset, offset + LIBRARY_PAGE_SIZE),
        hasMore: matches.length > offset + LIBRARY_PAGE_SIZE,
        leaderboard: published.filter(game => game.playCount > 0).sort((a,b) => b.playCount - a.playCount
          || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0,10),
      };
    });
  }
  async recordGameOpen(id: string, visitorId: string) {
    id = requireId(id).toLowerCase();
    visitorId = requireId(visitorId).toLowerCase();
    await this.transaction(s => {
      const project = s.projects.find(p => p.id === id);
      if (!classicGames.some(game => game.id === id) && !s.revisions.some(r => r.id === project?.publishedRevisionId && r.projectId === id))
        throw new StudioError("This game isn't published right now.", 404);
      const now = Date.now();
      s.playVisitors = (s.playVisitors || []).filter(visit => visit.countedAt > now - 30 * 60_000);
      if (s.playVisitors.some(visit => visit.gameId === id && visit.visitorId === visitorId)) return;
      s.playVisitors.push({ gameId: id, visitorId, countedAt: now });
      const counts = s.playCounts ||= {};
      counts[id] = (counts[id] || 0) + 1;
    }, true);
  }
}
