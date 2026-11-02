import { parseFragment, serializeOuter, type DefaultTreeAdapterTypes } from "parse5";
import { themeColors } from "./themes";
import type { Theme } from "./types";

export const MAX_ICON_BYTES = 30_000;
const namespace = "http://www.w3.org/2000/svg";
const tags = new Set(["svg","g","path","rect","circle","ellipse","line","polyline","polygon","defs","linearGradient","radialGradient","stop","clipPath","mask","text","tspan","title","desc"]);
const attributes = new Set(["xmlns","viewBox","width","height","x","y","x1","y1","x2","y2","cx","cy","r","rx","ry","d","points","fill","fill-opacity","fill-rule","stroke","stroke-width","stroke-opacity","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-dasharray","stroke-dashoffset","opacity","transform","id","clip-path","clip-rule","mask","gradientUnits","gradientTransform","offset","stop-color","stop-opacity","spreadMethod","fx","fy","fr","maskUnits","maskContentUnits","preserveAspectRatio","font-family","font-size","font-weight","text-anchor","dominant-baseline","letter-spacing","role","aria-label","aria-labelledby","aria-describedby","focusable","version"]);

// SVG is untrusted model/user data. Accept a small vector-only subset, and
// render it to PNG; never insert it into the studio DOM or serve it as markup.
export function sanitizeIconSvg(value: unknown): string | null {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_ICON_BYTES || /<!DOCTYPE|<!ENTITY|<\?/i.test(value)) return null;
  const children = parseFragment(value).childNodes.filter(node => !(node.nodeName === "#text" && !(node as DefaultTreeAdapterTypes.TextNode).value.trim()));
  if (children.length !== 1 || !("tagName" in children[0]) || children[0].tagName !== "svg") return null;
  const root = children[0];
  let count = 0;
  function safe(node: DefaultTreeAdapterTypes.ChildNode, parent = ""): boolean {
    if (++count > 400) return false;
    if (node.nodeName === "#text") return ["text","tspan","title","desc"].includes(parent) || !(node as DefaultTreeAdapterTypes.TextNode).value.trim();
    if (!("tagName" in node) || node.namespaceURI !== namespace || !tags.has(node.tagName)) return false;
    for (const attr of node.attrs) {
      if (attr.name === "xmlns") { if (node !== root || attr.value !== namespace) return false; continue; }
      if (!attributes.has(attr.name) || attr.prefix || attr.value.includes("\\") || /[<>]|(?:https?|file|data|javascript)\s*:|@import|expression\s*\(/i.test(attr.value)) return false;
      if (/url\s*\(/i.test(attr.value) && !/^url\(#[A-Za-z][\w-]{0,63}\)$/.test(attr.value)) return false;
      if (attr.name === "id" && !/^[A-Za-z][\w-]{0,63}$/.test(attr.value)) return false;
    }
    return node.childNodes.every(child => safe(child, node.tagName));
  }
  const box = root.attrs.find(attr => attr.name === "viewBox")?.value.trim().split(/[\s,]+/).map(Number);
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || box.some(n => Math.abs(n) > 4096) || box[2] <= 0 || box[3] <= 0 || !safe(root)) return null;
  root.attrs = root.attrs.filter(attr => !["xmlns","width","height"].includes(attr.name));
  root.attrs.push({ name: "xmlns", value: namespace }, { name: "width", value: "512" }, { name: "height", value: "512" });
  const result = serializeOuter(root);
  return Buffer.byteLength(result) <= MAX_ICON_BYTES ? result : null;
}

export function fallbackIconSvg(title: string, theme: Theme): string {
  const initial = title.replace(/[^a-z]/gi, "").slice(0, 1).toUpperCase() || "P";
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="' + themeColors[theme] +
    '"/><rect x="104" y="118" width="304" height="286" rx="72" fill="#ffffff" opacity=".28"/><path d="M160 180h192v85c0 57-43 99-96 116-53-17-96-59-96-116z" fill="#fff" opacity=".95"/><text x="256" y="292" text-anchor="middle" font-family="sans-serif" font-size="110" font-weight="800" fill="#35274d">' +
    initial + '</text><path d="m364 96 9 23 24 9-24 9-9 24-9-24-24-9 24-9z" fill="#fff"/></svg>';
}
