import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { StudioError } from "./errors";
import { LIBRARY_PAGE_SIZE, type Project, type Revision, type SaveInput, type Store, type ProjectDetail, type PublicGame, type GameLibrary } from "./types";

export const DEMO_OWNER = "00000000-0000-4000-8000-000000000001";
interface State { projects: Project[]; revisions: Revision[]; attempts: { id: string; ownerId: string; at: string; finished: boolean }[] }
const globalQueue = globalThis as typeof globalThis & { pocketQueue?: Promise<unknown> };
export function initialState(): State {
  return { projects: [], revisions: [], attempts: [] };
}
export class DemoStore implements Store {
  constructor(private ownerId = DEMO_OWNER, private directory = process.env.POCKET_BASE_DATA_DIR || path.join(process.cwd(), ".local")) {}
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
      if (action === "publish") p.publishedRevisionId = r.id;
      else Object.assign(p, { currentRevisionId: r.id, title: r.title, description: r.description, theme: r.theme });
      p.updatedAt = new Date().toISOString();
      return this.view(s, p);
    }, true);
  }
  async unpublish(id: string) { await this.transaction(s => { this.owned(s, id).publishedRevisionId = null; }, true); }
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
      const p = s.projects.find(p => p.id === id);
      const r = p && s.revisions.find(r => r.id === p.publishedRevisionId && r.projectId === p.id);
      return p && r ? { id: p.id, revisionId: r.id, title: r.title, description: r.description, theme: r.theme, html: r.html, iconSvg: r.iconSvg || null } : null;
    });
  }
  async publishedGames(offset = 0): Promise<GameLibrary> {
    return this.transaction(s => {
      const published = s.projects.flatMap(p => {
        const r = s.revisions.find(r => r.id === p.publishedRevisionId && r.projectId === p.id);
        return r ? [{ id: p.id, revisionId: r.id, title: r.title, description: r.description, theme: r.theme, createdAt: r.createdAt }] : [];
      }).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      return {
        games: published.slice(offset, offset + LIBRARY_PAGE_SIZE).map(({ createdAt: _date, ...game }) => game),
        hasMore: published.length > offset + LIBRARY_PAGE_SIZE,
      };
    });
  }
}
