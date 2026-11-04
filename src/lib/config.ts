import deployment from "../../vercel.json";
import { DATABASE_MAX_GAME_BYTES, DATABASE_MAX_PROMPT_CHARACTERS, GENERATION_LEASE_SECONDS, MAX_GAME_BYTES, MAX_PROMPT_CHARACTERS } from "./limits";

export const DEFAULT_MAX_GENERATION_TOKENS = 100_000;
export const DEFAULT_GENERATION_TIMEOUT_MS = 300_000;
export const DEFAULT_PLANNING_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_PLAN_WORDS = 400;

function reasoningSetting(name: string) {
  const value = process.env[name] || "medium";
  if (!["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value))
    throw new Error(name + " must be none, minimal, low, medium, high, xhigh, or max.");
  return value;
}

function providerSortSetting(name: string) {
  const value = process.env[name] || "price";
  if (!["price", "latency", "throughput"].includes(value))
    throw new Error(name + " must be price, latency, or throughput.");
  return value;
}

// Only non-secret settings are returned. Never pass provider settings to the client.
export function integerSetting(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(name + " must be an integer between " + minimum + " and " + maximum + ".");
  return value;
}

export function contentLimits() {
  const maxPromptCharacters = integerSetting("POCKET_BASE_MAX_PROMPT_CHARACTERS", MAX_PROMPT_CHARACTERS, 1, DATABASE_MAX_PROMPT_CHARACTERS);
  const maxGameBytes = integerSetting("POCKET_BASE_MAX_GAME_BYTES", MAX_GAME_BYTES, 100, DATABASE_MAX_GAME_BYTES);
  return { maxPromptCharacters, maxGameBytes, maxMutationBytes: maxPromptCharacters * 6 + 2_048 };
}

export function generationSettings() {
  const routeSeconds = deployment.functions["src/app/api/generate/route.ts"].maxDuration;
  if (!Number.isSafeInteger(routeSeconds) || routeSeconds < 11)
    throw new Error("The generation function maxDuration in vercel.json must be at least 11 seconds.");
  // Leave ten seconds for validation, persistence, and releasing the attempt.
  const maximumTimeout = Math.min(routeSeconds, GENERATION_LEASE_SECONDS) * 1_000 - 10_000;
  const timeoutMs = integerSetting("POCKET_BASE_GENERATION_TIMEOUT_MS", Math.min(DEFAULT_GENERATION_TIMEOUT_MS, maximumTimeout), 1_000, maximumTimeout);
  const maxTokens = integerSetting("OPENROUTER_MAX_OUTPUT_TOKENS", DEFAULT_MAX_GENERATION_TOKENS, 1, 128_000);
  const reasoningEffort = reasoningSetting("OPENROUTER_REASONING_EFFORT");
  const providerSort = providerSortSetting("OPENROUTER_PROVIDER_SORT");
  return { timeoutMs, maxTokens, reasoningEffort, providerSort };
}

export function planningSettings(totalTimeoutMs = generationSettings().timeoutMs) {
  return {
    timeoutMs: integerSetting("POCKET_BASE_PLANNING_TIMEOUT_MS", Math.min(DEFAULT_PLANNING_TIMEOUT_MS, totalTimeoutMs), 1_000, totalTimeoutMs),
    maxTokens: integerSetting("OPENROUTER_PLANNER_MAX_OUTPUT_TOKENS", 8_000, 1, 128_000),
    maxPlanWords: integerSetting("POCKET_BASE_MAX_PLAN_WORDS", DEFAULT_MAX_PLAN_WORDS, 1, 1_000),
    reasoningEffort: reasoningSetting("OPENROUTER_PLANNER_REASONING_EFFORT"),
    providerSort: providerSortSetting("OPENROUTER_PLANNER_PROVIDER_SORT"),
  };
}

export function priceSetting(name: string, fallback?: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < 0) throw new Error(name + " must be a non-negative USD price per million tokens.");
  return value;
}
