import { parse } from "acorn";
import { parse as parseHTML, serialize } from "parse5";
import { StudioError } from "./errors";
import { themes, type GeneratedGame } from "./types";

// Generated source is data. It is parsed here and only executed in an opaque-origin iframe.
export function validateGame(value: unknown): GeneratedGame {
  if (!value || typeof value !== "object") throw new StudioError("The game maker returned an incomplete game. Try again.", 502);
  const game = value as Record<string, unknown>;
  if (typeof game.html !== "string" || game.html.length < 100 || Buffer.byteLength(game.html) > 200_000)
    throw new StudioError("This game is too big or incomplete. Try a smaller idea.", 502);
  if (typeof game.title !== "string" || !game.title.trim() || game.title.length > 70)
    throw new StudioError("The game maker forgot the game's name. Try again.", 502);
  const tree = parseHTML(game.html);
  const forbidden = new Set(["iframe", "frame", "frameset", "object", "embed", "base", "link", "meta"]);
  let scriptCount = 0;
  function visit(node: unknown): void {
    const n = node as { tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: unknown[]; content?: unknown; nodeName?: string; value?: string };
    if (n.tagName === "script") {
      if (n.attrs?.some(a => a.name === "src" || (a.name === "type" && !["text/javascript", "application/javascript"].includes(a.value))))
        throw new StudioError("This game needs an outside library. Try a self-contained game instead.", 502);
      const code = (n.childNodes || []).map(c => (c as { value?: string }).value || "").join("");
      try { parse(code, { ecmaVersion: "latest", sourceType: "script" }); }
      catch { throw new StudioError("The game has a code hiccup. Your previous version is safe; try again.", 502); }
      scriptCount++;
    }
    if (n.attrs) n.attrs = n.attrs.filter(a => {
      if (a.name.startsWith("on")) return false;
      if (["href", "action", "formaction", "srcset", "ping", "target"].includes(a.name)) return false;
      if (a.name === "src" && !/^data:(image|audio)\//i.test(a.value)) return false;
      return true;
    });
    if (n.childNodes) {
      n.childNodes = n.childNodes.filter(c => !forbidden.has((c as { tagName?: string }).tagName || ""));
      n.childNodes.forEach(visit);
    }
    if (n.content) visit(n.content);
  }
  visit(tree);
  if (!scriptCount) throw new StudioError("The game maker returned a picture instead of a playable game. Try again.", 502);
  return {
    title: game.title.trim(),
    description: typeof game.description === "string" ? game.description.slice(0, 200) : "A little game made in Pocket Base.",
    theme: themes.includes(game.theme as GeneratedGame["theme"]) ? game.theme as GeneratedGame["theme"] : "cosmic",
    html: serialize(tree),
  };
}
export function parseGeneration(text: string): GeneratedGame {
  const clean = text.trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  let value: unknown;
  try { value = JSON.parse(clean); } catch { throw new StudioError("The game maker didn't finish a readable game. Try again.", 502); }
  return validateGame(value);
}
