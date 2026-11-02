import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireId, StudioError } from "./errors";
import { classicGames, classicListings } from "./classic-games";
import { publicName } from "./profile";
import { libraryQuery } from "./library";
import { LIBRARY_PAGE_SIZE, type Project, type Revision, type SaveInput, type Store, type ProjectDetail, type PublicGame, type GameLibrary } from "./types";

export const DEMO_OWNER = "00000000-0000-4000-8000-000000000001";
interface State {
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
  async save(input: SaveInput): Promise<ProjectDetail> {
    return this.transaction(s => {
      const now = new Date().toISOString();
      const p = input.projectId ? this.owned(s, input.projectId) : {
        id: randomUUID(), ownerId: this.ownerId, title: input.title, description: input.description, theme: input.theme,
        currentRevisionId: "", publishedRevisionId: null, createdAt: now, updatedAt: now,
      };
      if (input.projectId && p.currentRevisionId !== input.baseRevisionId)
        throw new StudioError("This game changed in another tab. Refresh before trying again.", 409);
      if (!input.projectId) s.projects.push(p);
      const previous = s.revisions.find(r => r.id === p.currentRevisionId && r.projectId === p.id);
      const r: Revision = { ...input, iconSvg: previous?.iconSvg || input.iconSvg || null, id: randomUUID(), projectId: p.id, createdAt: now };
      s.revisions.push(r);
      Object.assign(p, { title: r.title, description: r.description, theme: r.theme, currentRevisionId: r.id, updatedAt: now });
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
      else Object.assign(p, { currentRevisionId: r.id, title: r.title, description: r.description, theme: r.theme });
      p.updatedAt = new Date().toISOString();
      return this.view(s, p);
    }, true);
  }
  async unpublish(id: string) { await this.transaction(s => { const p = this.owned(s, id); p.publishedRevisionId = null; p.publishedAt = null; }, true); }
  async reserveGeneration() {
    return this.transaction(s => {
      const today = new Date().toISOString().slice(0, 10);
      const attempts = s.attempts.filter(a => a.at.startsWith(today));
      if (attempts.length >= 40 || attempts.filter(a => a.ownerId === this.ownerId).length >= 20)
        throw new StudioError("That's today's game-making allowance. Your games are still here to play.", 429);
      if (attempts.some(a => a.ownerId === this.ownerId && !a.finished && Date.now() - Date.parse(a.at) < 300_000))
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
