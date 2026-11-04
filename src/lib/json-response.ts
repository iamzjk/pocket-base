// Game source and private revision history can exceed buffered hosting payload limits.
// Stream the same JSON contract; callers still validate and authorize before sending it.
export function jsonResponse(value: unknown, init: ResponseInit = {}) {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("A JSON response requires a value.");
  const bytes = new TextEncoder().encode(json);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) { controller.close(); return; }
      const end = Math.min(offset + 65_536, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-store");
  return new Response(stream, { ...init, headers });
}
