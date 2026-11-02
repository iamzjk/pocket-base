import sharp from "sharp";
import { fallbackIconSvg, sanitizeIconSvg } from "./icon";
import type { GameIcon } from "./types";

export async function renderIconPng(game: GameIcon, size: number): Promise<Buffer> {
  const fallback = fallbackIconSvg(game.title, game.theme);
  const icon = sanitizeIconSvg(game.iconSvg) || fallback;
  try { return await sharp(Buffer.from(icon)).resize(size).png().toBuffer(); }
  catch { return sharp(Buffer.from(fallback)).resize(size).png().toBuffer(); }
}
