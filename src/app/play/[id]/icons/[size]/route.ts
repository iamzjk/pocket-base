import sharp from "sharp";
import { publicStore } from "@/lib/auth";
import { errorResponse, requireId, StudioError } from "@/lib/errors";
import { themeColors } from "@/lib/starters";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; size: string }> }) {
  try {
    const { id, size } = await params;
    if (!["180.png", "192.png", "512.png"].includes(size)) throw new StudioError("Icon not found.", 404);
    const game = await (await publicStore(request)).publicGame(requireId(id));
    if (!game) throw new StudioError("This game isn't published right now.", 404);
    const initial = game.title.replace(/[^a-z]/gi, "").slice(0, 1).toUpperCase() || "P";
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="' + themeColors[game.theme] +
      '"/><rect x="104" y="118" width="304" height="286" rx="72" fill="#ffffff" opacity=".28"/><path d="M160 180h192v85c0 57-43 99-96 116-53-17-96-59-96-116z" fill="#fff" opacity=".95"/><text x="256" y="292" text-anchor="middle" font-family="sans-serif" font-size="110" font-weight="800" fill="#35274d">' +
      initial + '</text><path d="m364 96 9 23 24 9-24 9-9 24-9-24-24-9 24-9z" fill="#fff"/></svg>';
    const png = await sharp(Buffer.from(svg)).resize(parseInt(size)).png().toBuffer();
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } });
  } catch (error) { return errorResponse(error); }
}
