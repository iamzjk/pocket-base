import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
const dataDir = process.env.POCKET_BASE_E2E_DATA_DIR || path.join(os.tmpdir(), "pocket-base-browser-" + process.pid);
process.env.POCKET_BASE_E2E_DATA_DIR = dataDir;
const chrome = process.env.CHROME_PATH || (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
export default defineConfig({
  testDir: "./tests/browser", timeout: 60_000, expect: { timeout: 15_000 }, fullyParallel: false, workers: 1,
  use: { baseURL: "http://127.0.0.1:3217", headless: true,
    launchOptions: chrome ? { executablePath: chrome } : {},
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npm run start -- --port 3217", url: "http://127.0.0.1:3217", reuseExistingServer: false,
    env: { POCKET_BASE_DEMO: "true", POCKET_BASE_DATA_DIR: dataDir,
      OPENROUTER_API_KEY: "fictional-browser-test-key", POCKET_BASE_E2E_MODEL: "true", NODE_OPTIONS: "--import=" + path.join(process.cwd(), "tests/fixtures/openrouter.mjs"), NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" }, timeout: 60_000 },
});
