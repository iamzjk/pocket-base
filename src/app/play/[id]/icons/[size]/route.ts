import sharp from "sharp";
import { publicStore } from "@/lib/auth";
import { errorResponse, requireId, StudioError } from "@/lib/errors";
import { sanitizeIconSvg, fallbackIconSvg } from "@/lib/icon";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; size: string }> }) {
  try {
    const { id, size } = await params;
    if (!["180.png", "192.png", "512.png"].includes(size)) throw new StudioError("Icon not found.", 404);
    const game = await (await publicStore(request)).publicGame(requireId(id));
    if (!game) throw new StudioError("This game isn't published right now.", 404);
    const fallback = fallbackIconSvg(game.title, game.theme);
    const icon = sanitizeIconSvg(game.iconSvg) || fallback;
    let png: Buffer;
    try { png = await sharp(Buffer.from(icon)).resize(parseInt(size)).png().toBuffer(); }
    catch { png = await sharp(Buffer.from(fallback)).resize(parseInt(size)).png().toBuffer(); }
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } });
  } catch (error) { return errorResponse(error); }
}
