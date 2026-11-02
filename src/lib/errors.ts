import { MAX_MUTATION_BYTES } from "./limits";

export class StudioError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function errorResponse(error: unknown): Response {
  if (error instanceof StudioError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("[Pocket Base]", error instanceof Error ? error.message : "Unexpected failure");
  return Response.json({ error: "The studio couldn't finish that. Your saved games are safe. Please try again." },
    { status: 500, headers: { "Cache-Control": "no-store" } });
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new StudioError("That game or version couldn't be found.", 404);
  return value;
}
export async function readMutation(request: Request): Promise<Record<string, unknown>> {
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.slice(0, -1);
  const host = request.headers.get("host") || url.host;
  const expectedOrigin = new URL(protocol + "://" + host).origin;
  if (request.headers.get("origin") !== expectedOrigin) throw new StudioError("Please make changes from your studio.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new StudioError("Please send a JSON request.");
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_MUTATION_BYTES) throw new StudioError("That request is a little too long.", 413);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new StudioError("That request couldn't be read."); }
}
