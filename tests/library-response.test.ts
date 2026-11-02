import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { libraryQuery, normalizeLibrary, type LibraryResponse } from "../src/lib/library";
import { SupabaseStore } from "../src/lib/supabase-store";
import { Studio } from "../src/components/studio";

const legacy: LibraryResponse = { games: [{ id: "60000000-0000-4000-8000-000000000001",
  revisionId: "60000000-0000-4000-8000-000000000002", title: "Legacy library fixture",
  description: "Fictional older listing", theme: "mint", creatorName: "Fictional creator", updatedAt: "2026-01-01T00:00:00Z" }], hasMore: true };

test("older library responses get an empty leaderboard and zero play counts without changing metadata", () => {
  const result = normalizeLibrary(legacy);
  assert.deepEqual(result, { games: [{ ...legacy.games[0], playCount: 0 }], hasMore: true, leaderboard: [] });
  assert.equal("playCount" in legacy.games[0], false);
  assert.deepEqual(normalizeLibrary({ ...legacy, leaderboard: null }).leaderboard, []);
  const current = { games: [{ ...legacy.games[0], playCount: 7 }], hasMore: false,
    leaderboard: [{ ...legacy.games[0], playCount: 7 }] };
  assert.deepEqual(normalizeLibrary(current), current);
});

test("Supabase public library responses normalize older database results for SSR and the API", async () => {
  const client = { rpc: async (name: string, args: unknown) => {
    assert.equal(name, "published_games");
    assert.deepEqual(args, { p_offset: 24, p_limit: 24 });
    return { data: legacy, error: null };
  } } as unknown as SupabaseClient;
  assert.deepEqual(await new SupabaseStore(client).publishedGames(24), normalizeLibrary(legacy));
});

test("the library renders older initial props without missing leaderboard or count crashes", () => {
  const markup = renderToStaticMarkup(createElement(Studio, { initialDisplayName: "", version: "test",
    view: "library", initialProjects: [], initialLibrary: legacy, signedIn: false, demo: false,
    configured: true, aiConnected: false }));
  assert.ok(markup.includes("Legacy library fixture"));
  assert.ok(markup.includes("0 plays"));
  assert.ok(markup.includes("Play a game to start the leaderboard."));
});

test("Supabase search passes bounded plain text to the public metadata function", async () => {
  const client = { rpc: async (name: string, args: unknown) => {
    assert.equal(name, "published_games");
    assert.deepEqual(args, { p_offset: 24, p_limit: 24, p_query: "100% turtle_underwater" });
    return { data: legacy, error: null };
  } } as unknown as SupabaseClient;
  const store = new SupabaseStore(client);
  assert.deepEqual(await store.publishedGames(24, "  100% turtle_underwater  "), normalizeLibrary(legacy));
  await assert.rejects(store.publishedGames(0, "a".repeat(201)), /up to 200/);
  for (const query of ["bad\u0000query", "bad\nquery"]) assert.throws(() => libraryQuery(query), /plain text/);
  assert.equal(libraryQuery(" \t "), "");
});
