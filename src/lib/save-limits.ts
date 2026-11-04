import { contentLimits } from "./config";
import { StudioError } from "./errors";

export function validateSaveLimits(input: { prompt: string; html: string }) {
  const { maxPromptCharacters, maxGameBytes } = contentLimits();
  if (!input.prompt.trim() || input.prompt.length > maxPromptCharacters)
    throw new StudioError("Describe your idea in 1 to " + maxPromptCharacters.toLocaleString("en-US") + " characters.");
  if (Buffer.byteLength(input.html) > maxGameBytes)
    throw new StudioError("This game exceeds the saved-game size limit. Your previous version is safe.", 502);
}
