export const themes = ["cosmic", "mint", "peach", "lemon", "lilac"] as const;
export type Theme = typeof themes[number];
export interface Revision {
  id: string;
  projectId: string;
  title: string;
  description: string;
  theme: Theme;
  html: string;
  iconSvg?: string | null;
  prompt: string;
  createdAt: string;
}
export interface Project {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  theme: Theme;
  currentRevisionId: string;
  publishedRevisionId: string | null;
  publishedAt?: string | null;
  updatedAt: string;
  createdAt: string;
}
export interface ProjectDetail extends Project { revisions: Revision[] }
export interface PublicGame {
  id: string;
  revisionId: string;
  title: string;
  description: string;
  theme: Theme;
  html: string;
  iconSvg?: string | null;
}
export type GameIcon = Pick<PublicGame, "title" | "theme" | "iconSvg">;
export type PublishedGame = Pick<PublicGame, "id" | "revisionId" | "title" | "description" | "theme"> & { creatorName: string; updatedAt: string; playCount: number };
export interface CreatorProfile { displayName: string | null }
export interface GameLibrary { games: PublishedGame[]; hasMore: boolean; leaderboard: PublishedGame[] }
export const LIBRARY_PAGE_SIZE = 24;
export interface GeneratedGame {
  title: string;
  description: string;
  theme: Theme;
  html: string;
  iconSvg?: string | null;
}
export interface SaveInput extends GeneratedGame {
  projectId?: string;
  baseRevisionId?: string;
  prompt: string;
}
export interface Store {
  profile(): Promise<CreatorProfile>;
  saveProfile(displayName: string): Promise<CreatorProfile>;
  list(): Promise<Project[]>;
  detail(id: string): Promise<ProjectDetail | null>;
  projectIcon(id: string): Promise<GameIcon | null>;
  save(input: SaveInput): Promise<ProjectDetail>;
  select(id: string, revisionId: string, action: "restore" | "publish"): Promise<ProjectDetail>;
  unpublish(id: string): Promise<void>;
  deleteGame(id: string): Promise<void>;
  reserveGeneration(parentAttemptId?: string): Promise<string>;
  finishGeneration(id: string): Promise<void>;
  publicGame(id: string): Promise<PublicGame | null>;
  recordGameOpen(id: string, visitorId: string): Promise<void>;
  publishedGames(offset?: number, query?: string): Promise<GameLibrary>;
}
