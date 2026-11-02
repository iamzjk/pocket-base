import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("automatic migrations require explicit admin credentials and never mutate previews", async t => {
  const { runMigrations } = await import("../scripts/migrate.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "pocket-base-migrations-"));
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fictional-publishable-key",
  };
  const commands: string[][] = [];
  const logs: string[] = [];
  const execute = async (_command: string, args: string[], options: { env: Record<string, string> }) => {
    assert.equal(options.env.SUPABASE_ACCESS_TOKEN, "fictional-admin-token");
    commands.push(args);
    return { stdout: "Done", stderr: "" };
  };
  const ready: typeof fetch = async (url, options) => {
    assert.equal(String(url), env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/rpc/studio_migration_versions");
    assert.equal((options?.headers as Record<string, string>).apikey, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    return Response.json(["001", "002"]);
  };
  const missing: typeof fetch = async () => Response.json({ code: "PGRST202" }, { status: 404 });
  const options = { root, env, execute, log: (message: string) => logs.push(message) };
  try {
    await mkdir(path.join(root, "supabase/migrations"), { recursive: true });
    await writeFile(path.join(root, "supabase/migrations/001_schema.sql"), "select 1;");
    await writeFile(path.join(root, "supabase/migrations/002_ready.sql"), "select 1;");
    await t.test("demo and unconfigured builds need no services", async () => {
      const fetcher: typeof fetch = async () => { throw new Error("Should not contact Supabase"); };
      assert.equal((await runMigrations({ ...options, fetcher, env: { POCKET_BASE_DEMO: "true" } })).reason, "demo");
      assert.equal((await runMigrations({ ...options, fetcher, env: {} })).reason, "unconfigured");
      assert.equal(commands.length, 0);
    });
    await t.test("an already migrated database needs no admin token or CLI", async () => {
      assert.equal((await runMigrations({ ...options, fetcher: ready })).verified, true);
      assert.equal((await runMigrations({ ...options, fetcher: ready, env: { ...env, VERCEL: "1", VERCEL_ENV: "production" } })).verified, true);
      assert.equal(commands.length, 0);
    });
    await t.test("pending migrations without an env token never consult saved CLI credentials", async () => {
      await assert.rejects(runMigrations({ ...options, fetcher: missing }), /SUPABASE_ACCESS_TOKEN.*Keychain are never used/);
      await assert.rejects(runMigrations({ ...options, fetcher: missing, mode: "migrate", env: { ...env, POCKET_BASE_DEMO: "true" } }), /SUPABASE_ACCESS_TOKEN/);
      assert.equal(commands.length, 0);
    });
    await t.test("preview builds cannot apply migrations even with a token", async () => {
      await assert.rejects(runMigrations({ ...options, fetcher: missing, env: { ...env, SUPABASE_ACCESS_TOKEN: "fictional-admin-token", VERCEL: "1", VERCEL_ENV: "preview" } }), /Preview builds won't modify/);
      assert.equal(commands.length, 0);
    });
    await t.test("pending migrations target the configured project and verify the result", async () => {
      let checks = 0;
      const fetcher: typeof fetch = (...args) => ++checks === 1 ? missing(...args) : ready(...args);
      const result = await runMigrations({ ...options, env: { ...env, SUPABASE_ACCESS_TOKEN: "fictional-admin-token" }, fetcher });
      assert.equal(result.applied, true);
      assert.deepEqual(commands.splice(0), [["link", "--project-ref", "abcdefghijklmnopqrst", "--yes"], ["db", "push", "--linked", "--yes"]]);
      assert.equal(checks, 2);
      await mkdir(path.join(root, "supabase/.temp"), { recursive: true });
      await writeFile(path.join(root, "supabase/.temp/project-ref"), "abcdefghijklmnopqrst\n");
      checks = 0;
      await runMigrations({ ...options, env: { ...env, SUPABASE_ACCESS_TOKEN: "fictional-admin-token", VERCEL: "1", VERCEL_ENV: "production" }, fetcher });
      assert.deepEqual(commands.splice(0), [["db", "push", "--linked", "--yes"]]);
    });
    await t.test("migration failure blocks startup and redacts credentials", async () => {
      await assert.rejects(runMigrations({ ...options, env: { ...env, SUPABASE_ACCESS_TOKEN: "fictional-admin-token" }, fetcher: missing,
        execute: async () => { throw Object.assign(new Error("failed"), { stderr: "Connection failed fictional-admin-token" }); },
      }), error => {
        assert.match((error as Error).message, /app was not started/);
        assert.equal((error as Error).message.includes("fictional-admin-token"), false);
        return true;
      });
      assert.equal(logs.join("\n").includes("fictional-admin-token"), false);
    });
    await t.test("invalid project URLs and rejected keys cannot trigger migrations", async () => {
      await assert.rejects(runMigrations({ ...options, env: { ...env, NEXT_PUBLIC_SUPABASE_URL: "https://other.example" }, fetcher: ready }), /hosted Supabase/);
      await assert.rejects(runMigrations({ ...options, fetcher: async () => Response.json({}, { status: 401 }) }), /publishable key/);
      assert.equal(commands.length, 0);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("migration environment uses local settings with process environment taking precedence", async () => {
  const { projectEnvironment } = await import("../scripts/migrate.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "pocket-base-env-"));
  const previous = process.env.POCKET_BASE_ENV_TEST;
  try {
    await writeFile(path.join(root, ".env"), "POCKET_BASE_ENV_TEST=base\n");
    await writeFile(path.join(root, ".env.development"), "POCKET_BASE_ENV_TEST=development\n");
    await writeFile(path.join(root, ".env.local"), "POCKET_BASE_ENV_TEST=local\n");
    await writeFile(path.join(root, ".env.development.local"), "POCKET_BASE_ENV_TEST=development-local\n");
    delete process.env.POCKET_BASE_ENV_TEST;
    assert.equal((await projectEnvironment(root)).POCKET_BASE_ENV_TEST, "development-local");
    process.env.POCKET_BASE_ENV_TEST = "process";
    assert.equal((await projectEnvironment(root)).POCKET_BASE_ENV_TEST, "process");
  } finally {
    if (previous === undefined) delete process.env.POCKET_BASE_ENV_TEST; else process.env.POCKET_BASE_ENV_TEST = previous;
    await rm(root, { recursive: true, force: true });
  }
});
