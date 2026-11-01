export const themes = ["cosmic", "mint", "peach", "lemon", "lilac"] as const;
export type Theme = typeof themes[number];
export interface Revision {
  id: string;
  projectId: string;
  title: string;
  description: string;
  theme: Theme;
  html: string;
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
}
export interface GeneratedGame {
  title: string;
  description: string;
  theme: Theme;
  html: string;
}
export interface SaveInput extends GeneratedGame {
  projectId?: string;
  baseRevisionId?: string;
  prompt: string;
}
export interface Store {
  list(): Promise<Project[]>;
  detail(id: string): Promise<ProjectDetail | null>;
  save(input: SaveInput): Promise<ProjectDetail>;
  select(id: string, revisionId: string, action: "restore" | "publish"): Promise<ProjectDetail>;
  unpublish(id: string): Promise<void>;
  reserveGeneration(): Promise<string>;
  finishGeneration(id: string): Promise<void>;
  publicGame(id: string): Promise<PublicGame | null>;
}
