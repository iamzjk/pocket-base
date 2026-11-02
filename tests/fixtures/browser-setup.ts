import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { browserFixtureState } from "./games";

export default async function setup() {
  const directory = process.env.POCKET_BASE_E2E_DATA_DIR;
  if (!directory || ![os.tmpdir(), "/private/tmp"].some(root => path.resolve(directory).startsWith(path.resolve(root) + path.sep)))
    throw new Error("Browser fixtures require a disposable directory under the system temp folder.");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "demo.json"), JSON.stringify(browserFixtureState()), { flag: "wx", mode: 0o600 });
}
