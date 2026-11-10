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
  notes?: string | null;
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
  notes?: string | null;
}
export interface SaveInput extends GeneratedGame {
  projectId?: string;
  baseRevisionId?: string;
  prompt: string;
  conversationRequestId?: string;
  conversationRequestStartedAt?: string;
}
export interface ConversationMessage {
  id: string; kind: "user" | "assistant" | "proposal" | "saved" | "restored";
  text: string; version: number; createdAt: string; revisionId?: string;
}
export interface Proposal { id: string; brief: string; version: number; baseRevisionId: string | null }
export interface Conversation {
  id: string; projectId: string | null; title: string; version: number;
  summary: string; contextVersion: number; proposal: Proposal | null;
  messages: ConversationMessage[]; updatedAt: string;
}
export type ConversationListItem = Pick<Conversation, "id" | "projectId" | "title" | "updatedAt">;
export interface ConversationRequestInput {
  requestId: string; version: number; baseRevisionId?: string;
  kind: "discussion" | "direct" | "proposal"; prompt?: string; proposalId?: string;
}
export interface ConversationRequest {
  id: string; conversationId: string; version: number; kind: ConversationRequestInput["kind"];
  status: "pending" | "failed" | "complete"; prompt: string; inputPrompt?: string; brief?: string;
  projectId: string | null; baseRevisionId: string | null; startedAt: string;
}
export interface Discussion { reply: string; summary: string; proposal?: string | null }
export interface Store {
  conversations(): Promise<ConversationListItem[]>;
  createConversation(projectId?: string): Promise<Conversation>;
  conversation(id: string): Promise<Conversation | null>;
  deleteConversation(id: string): Promise<void>;
  beginConversationRequest(id: string, input: ConversationRequestInput): Promise<ConversationRequest>;
  completeDiscussion(id: string, result: Discussion, startedAt?: string): Promise<Conversation>;
  failConversationRequest(id: string, startedAt?: string): Promise<void>;
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
