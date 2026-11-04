// Defaults and database ceilings. Server environment overrides are read in config.ts.
export const MAX_PROMPT_CHARACTERS = 100_000;
export const MAX_GAME_BYTES = 5_000_000;
export const DATABASE_MAX_PROMPT_CHARACTERS = 100_000;
export const DATABASE_MAX_GAME_BYTES = 10_000_000;
export const GENERATION_LEASE_SECONDS = 360;
export const MAX_LIBRARY_QUERY_CHARACTERS = 200;
// A JSON-escaped character can occupy six bytes, plus the request's metadata.
export const MAX_MUTATION_BYTES = MAX_PROMPT_CHARACTERS * 6 + 2_048;
