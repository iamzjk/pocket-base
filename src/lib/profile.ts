import { StudioError } from "./errors";

export function publicName(value: unknown): string {
  if (typeof value !== "string") throw new StudioError("Enter a public name.");
  const name = value.trim();
  if (!name || [...name].length > 80 || /[\u0000-\u001f\u007f<>]/u.test(name))
    throw new StudioError("Choose a public name with 1–80 characters, without markup or control characters.");
  return name;
}
