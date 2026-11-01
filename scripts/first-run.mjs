import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Pocket Base requires Node.js 22 or newer.");
try {
  await writeFile(path.join(root, ".env.local"), await readFile(path.join(root, ".env.example")), { flag: "wx", mode: 0o600 });
  console.log("Created .env.local for the local starter playground.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Kept your existing .env.local settings.");
}
console.log("Run npm run dev, then open http://127.0.0.1:3000.");
