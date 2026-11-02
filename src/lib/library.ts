import type { GameLibrary, PublishedGame } from "./types";
import { StudioError } from "./errors";
import { MAX_LIBRARY_QUERY_CHARACTERS } from "./limits";

export function libraryQuery(value: string): string {
  const query = value.trim();
  if (query.length > MAX_LIBRARY_QUERY_CHARACTERS || /[\u0000-\u001f\u007f]/.test(query))
    throw new StudioError("Search with up to 200 characters of plain text.");
  return query;
}

type LibraryGame = Omit<PublishedGame, "playCount"> & { playCount?: number | null };
export type LibraryResponse = Omit<GameLibrary, "games" | "leaderboard"> & {
  games: LibraryGame[];
  leaderboard?: LibraryGame[] | null;
};

// A running development server or older API can still return pre-counter metadata.
export function normalizeLibrary(library: LibraryResponse): GameLibrary {
  const withCount = (game: LibraryGame): PublishedGame => ({ ...game, playCount: game.playCount ?? 0 });
  return { games: library.games.map(withCount), hasMore: library.hasMore,
    leaderboard: (library.leaderboard ?? []).map(withCount) };
}
