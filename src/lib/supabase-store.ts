import type { SupabaseClient } from "@supabase/supabase-js";
import { LIBRARY_PAGE_SIZE, type Project, type ProjectDetail, type Revision, type SaveInput, type Store, type PublicGame, type GameLibrary } from "./types";
import { StudioError } from "./errors";
import { publicName } from "./profile";

type Row = Record<string, unknown>;
function project(row: Row): Project {
  return { id: String(row.id), ownerId: String(row.owner_id), title: String(row.title),
    description: String(row.description), theme: row.theme as Project["theme"],
    currentRevisionId: String(row.current_revision_id), publishedRevisionId: row.published_revision_id as string | null,
    publishedAt: row.published_at as string | null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function detail(row: Row): ProjectDetail {
  return { ...project(row), revisions: (row.revisions as Row[]).map(r => ({
    id: String(r.id), projectId: String(r.project_id), title: String(r.title),
    description: String(r.description), theme: r.theme as Revision["theme"], html: String(r.html),
    prompt: String(r.prompt), iconSvg: typeof r.icon_svg === "string" ? r.icon_svg : null, createdAt: String(r.created_at),
  })) };
}
export function databaseError(error: { message: string } | null) {
  if (!error) return;
  if (error.message.includes("PS_NOT_FOUND")) throw new StudioError("That game or version couldn't be found.", 404);
  if (error.message.includes("PS_UNAUTHORIZED")) throw new StudioError("Ask a grown-up to sign in to your studio.", 401);
  if (error.message.includes("PS_CONFLICT")) throw new StudioError("This game changed in another tab. Refresh before trying again.", 409);
  if (error.message.includes("PS_BUSY")) throw new StudioError("A game is already being made. Give it a moment.", 409);
  if (error.message.includes("PS_QUOTA")) throw new StudioError("That's today's game-making allowance. Your games are still here to play.", 429);
  throw new StudioError("Your studio couldn't reach its saved games. Try again in a moment.", 503);
}
export class SupabaseStore implements Store {
  constructor(private client: SupabaseClient) {}
  async profile() {
    const { data, error } = await this.client.rpc("creator_profile");
    databaseError(error);
    return data;
  }
  async saveProfile(displayName: string) {
    const { data, error } = await this.client.rpc("save_creator_profile", { p_display_name: publicName(displayName) });
    databaseError(error);
    return data;
  }
  async list() {
    const { data, error } = await this.client.from("projects").select("*").order("updated_at", { ascending: false });
    databaseError(error);
    return (data || []).map(project);
  }
  async detail(id: string) {
    const { data, error } = await this.client.rpc("project_detail", { p_id: id });
    databaseError(error);
    return data ? detail(data) : null;
  }
  async save(input: SaveInput) {
    const { data, error } = await this.client.rpc("save_game", {
      p_project_id: input.projectId || null, p_base_revision_id: input.baseRevisionId || null,
      p_title: input.title, p_description: input.description, p_theme: input.theme, p_html: input.html, p_prompt: input.prompt, p_icon_svg: input.iconSvg || null,
    });
    databaseError(error);
    return detail(data);
  }
  async select(id: string, revisionId: string, action: "restore" | "publish") {
    const { data, error } = await this.client.rpc("select_revision", { p_id: id, p_revision_id: revisionId, p_action: action });
    databaseError(error);
    return detail(data);
  }
  async unpublish(id: string) {
    const { error } = await this.client.rpc("unpublish_game", { p_id: id });
    databaseError(error);
  }
  async reserveGeneration() {
    const { data, error } = await this.client.rpc("reserve_generation");
    databaseError(error);
    return data as string;
  }
  async finishGeneration(id: string) {
    const { error } = await this.client.rpc("finish_generation", { p_id: id });
    databaseError(error);
  }
  async publicGame(id: string): Promise<PublicGame | null> {
    const { data, error } = await this.client.rpc("public_game", { p_id: id });
    databaseError(error);
    return data || null;
  }
  async publishedGames(offset = 0): Promise<GameLibrary> {
    const { data, error } = await this.client.rpc("published_games", { p_offset: offset, p_limit: LIBRARY_PAGE_SIZE });
    databaseError(error);
    return data;
  }
}
