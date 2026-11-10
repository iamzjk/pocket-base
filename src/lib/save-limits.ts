import { contentLimits } from "./config";
import { StudioError } from "./errors";

export function validateSaveLimits(input: { prompt: string; html: string; notes?: string | null }) {
  if (input.notes != null && (typeof input.notes !== "string" || input.notes.length > 8000))
    throw new StudioError("The game maker returned invalid game notes. Your previous version is safe.", 502);
  const { maxPromptCharacters, maxGameBytes } = contentLimits();
  if (!input.prompt.trim() || input.prompt.length > maxPromptCharacters)
    throw new StudioError("Describe your idea in 1 to " + maxPromptCharacters.toLocaleString("en-US") + " characters.");
  if (Buffer.byteLength(input.html) > maxGameBytes)
    throw new StudioError("This game exceeds the saved-game size limit. Your previous version is safe.", 502);
}
