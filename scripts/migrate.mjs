import { readFile, readdir, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify, parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** @returns {Promise<Record<string, string | undefined>>} */
export async function projectEnvironment(root, mode = "dev") {
  const kind = mode === "build" ? "production" : "development";
  const values = {};
  for (const name of [".env", ".env." + kind, ".env.local", ".env." + kind + ".local"]) {
    try { Object.assign(values, parseEnv(await readFile(path.join(root, name), "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { ...values, ...process.env };
}
function safeMessage(text, env) {
  let result = String(text || "");
  for (const name of ["OPENROUTER_API_KEY", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_DB_URL", "DATABASE_URL"]) {
    if (env[name] && env[name].length > 4) result = result.replaceAll(env[name], "[redacted]");
  }
  return result;
}
async function execute(command, args, options) {
  return promisify(execFile)(command, args, { ...options, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
}

/**
 * @param {{root?:string, mode?:string, env?:Record<string,string|undefined>,
 * execute?:Function, fetcher?:typeof fetch, log?:Function}} options
 */
export async function runMigrations(options = {}) {
  const root = options.root || fileURLToPath(new URL("../", import.meta.url));
  const mode = options.mode || "dev";
  const env = options.env || await projectEnvironment(root, mode);
  const log = options.log || console.log;
  if (mode !== "migrate" && env.POCKET_BASE_DEMO === "true" && !env.VERCEL) {
    log("Database: local playground; cloud migrations skipped.");
    return { skipped: true, reason: "demo" };
  }
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    log("Database: Supabase isn't configured; building or opening setup screens.");
    return { skipped: true, reason: "unconfigured" };
  }
  let url;
  try { url = new URL(env.NEXT_PUBLIC_SUPABASE_URL); } catch { throw new Error("NEXT_PUBLIC_SUPABASE_URL must be your Supabase project URL."); }
  const match = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !match)
    throw new Error("Automatic migrations require the HTTPS URL of your hosted Supabase project.");
  const ref = match[1];
  const files = await readdir(path.join(root, "supabase/migrations"));
  const versions = files.filter(file => /^\d+_.+\.sql$/.test(file)).map(file => file.split("_")[0]).sort();
  if (!versions.length || new Set(versions).size !== versions.length) throw new Error("Migration filenames must have unique numeric versions.");
  const fetcher = options.fetcher || fetch;
  async function ready() {
    const response = await fetcher(url.origin + "/rest/v1/rpc/studio_migration_versions", {
      method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: "{}", signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json();
    if (response.status === 404 && data.code === "PGRST202") return false;
    if (!response.ok) throw new Error("Supabase rejected the database readiness check. Verify the project URL and publishable key.");
    if (!Array.isArray(data) || !data.every(value => typeof value === "string")) throw new Error("Supabase returned an unreadable migration status.");
    return versions.every(version => data.includes(version));
  }
  const isVercel = env.VERCEL === "1";
  const isPreview = isVercel && env.VERCEL_ENV !== "production";
  // Check without administration credentials first. Never consult saved CLI logins
  // or macOS Keychain: pending migrations require an explicit environment token.
  if (await ready()) {
    log("Database: all " + versions.length + " migrations verified.");
    return { verified: true, versions };
  }
  if (isPreview) throw new Error("Database migrations are pending. Preview builds won't modify the shared database. Apply them from the local app or a production build first.");
  if (!env.SUPABASE_ACCESS_TOKEN?.trim()) throw new Error(
    "Database migrations are pending. Add SUPABASE_ACCESS_TOKEN to .env.local (or the production build environment), then restart. Create this account access token at https://supabase.com/dashboard/account/tokens. The publishable key cannot apply migrations; saved logins and Keychain are never used."
  );
  const cli = path.join(root, "node_modules", ".bin", "supabase");
  if (!options.execute) {
    try { await access(cli); } catch { throw new Error("Run npm ci to install Pocket Base's migration tooling."); }
  }
  const run = options.execute || execute;
  async function command(args) {
    try {
      const result = await run(cli, args, { cwd: root, env });
      if (result.stdout?.trim()) log(safeMessage(result.stdout.trim(), env));
    } catch (error) {
      const details = String(error.stderr || error.message || "");
      if (/access token|not authenticated|supabase login/i.test(details))
        throw new Error("Supabase migration access needs authentication. Check SUPABASE_ACCESS_TOKEN in .env.local or your production build environment. Saved logins and Keychain are never used.");
      throw new Error("Database migrations failed; the app was not started. " + safeMessage(details, env));
    }
  }
  let linked = "";
  try { linked = (await readFile(path.join(root, "supabase/.temp/project-ref"), "utf8")).trim(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (linked !== ref) await command(["link", "--project-ref", ref, "--yes"]);
  log("Database: checking and applying pending migrations…");
  await command(["db", "push", "--linked", "--yes"]);
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await ready()) {
      log("Database: all " + versions.length + " migrations are ready.");
      return { applied: true, versions };
    }
    if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error("Migration commands finished, but the database API isn't ready yet. Restart the app to retry.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runMigrations({ mode: process.argv[2] || "dev" }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
