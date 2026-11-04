# Pocket Base contributor instructions

Pocket Base is a standalone Next.js App Router application using React, TypeScript, Node.js 22+, Supabase, OpenRouter, and Vercel. Read `README.md` for setup and deployment. Read `package.json` for the current version and commands; the home-page footer derives its version from that file. Increment the version for every release and keep the root/package versions in `package-lock.json` synchronized.

## Product and access boundaries

- `/` is My studio. Creating, editing, restoring, and publishing require a signed-in account. Each account owns separate projects and revisions; public signup requires a public name and server-side registration limits. There is no shared editing UI.
- `/library` and `/api/library` are public. Anyone can browse all users' published games and open `/play/<id>/` without signing in. Publishing opts a game into discovery; unpublishing removes it from fresh listings and online play. Previously downloaded games may remain playable offline.
- Public listings must read the selected **published revision**, not the project's current draft fields. Expose only the listing metadata. Never expose private drafts, prompts, owner IDs, full emails, or private account details through the library. Only the explicit public creator name and publication timestamp are included.
- New studios start empty. The five maintained originals are public read-only catalog games in `src/content/classic-games.json` and numbered SQL seeds. Test fixtures use separate IDs and must never be imported by application code.

## Code organization

- `src/components/studio-page.tsx`: server-side loading for the studio and library views. `src/components/studio.tsx`: client UI, editor, authentication dialogs, publishing, and version history.
- `src/lib/auth.ts`: session and anonymous store selection. `src/lib/supabase-store.ts` and `src/lib/demo-store.ts`: matching storage contracts in `src/lib/types.ts`.
- `src/lib/generate.ts`: model configuration, creation/edit instructions, response budget, and provider error handling. `src/lib/game.ts`: generated-source validation. `src/lib/icon.ts`: SVG validation and fallback icons.
- `src/lib/pwa.ts`, `public/player.js`, `public/player.css`, `public/game-worker.js`, and `public/sandbox.js`: trusted PWA hosting, offline caching, startup handling, and device-save bridge.
- `supabase/migrations/`: numbered SQL migrations. `scripts/migrate.mjs`: automatic migration runner.

## Accounts and public credits

- `/account` handles signup/sign-in directly through Supabase so rate limits use the visitor’s IP. Both forms are public when Supabase is configured and do not use CAPTCHA. Optional Google sign-in uses cookie-backed PKCE through `/api/auth` and `/auth/callback`; `POCKET_BASE_GOOGLE_SIGN_IN` defaults off. New Google profiles have a pending public name and must complete it at `/account` before private studio access. The public header links to sign-in and signup. `/api/auth` validates issued session tokens before persisting SSR cookies; it never trusts a user object from the browser.
- Public names are 1–80 plain-text characters, required at email signup or after Google sign-in. Only trusted Auth provider metadata may defer name selection; never copy a Google profile name or overwrite an existing creator name. Existing names are backfilled from email local parts. Profile mutations are owner-checked. No runtime service-role key is needed.
- The PostgreSQL Before User Created hook enforces 3 registrations/IP/rolling hour, 10/IP/rolling day, and 100 total/rolling day. Group IPv6 by /64. Private atomic counters expire after 24 hours. Hook failures never bypass protection. Supabase's built-in Auth rate limits apply independently.
- `npm run auth:configure` is an explicit post-deployment setup command, never a build/startup side effect. It requires the existing admin token, enables public email signup and the registration hook together, and disables CAPTCHA. Preserve stronger existing password requirements and built-in Auth rate limits. `npm run auth:configure -- --google` explicitly configures the provider with private Google client credentials and the canonical app callback, preserving unrelated settings. `npm run auth:check` prints only safe readiness flags.
- Library `updatedAt` is the publication timestamp. Draft writes, restores, profile updates, and repeated publication of the same live revision must not move it. Original catalog games have fixed revision dates.

## Generation and game safety

- Creation and edit prompts default to 100,000 characters, with a configurable lower runtime limit and a 100,000-character database ceiling. Keep UI, request-body sizing, API, and both stores aligned through `src/lib/config.ts`. Model, reasoning effort, output budget, timeout, provider preference, and price caps are configured through the server environment; hosting duration lives in `vercel.json`. New games use GPT-6.1 Sol (`openai/gpt-6.1-sol`) for a plan of up to 400 words, then GPT-6.1 Terra (`openai/gpt-6.1-terra`) for the complete game. User-requested edits use one builder call. Both stages default to medium reasoning; planning allows 8,000 output tokens and building/editing 100,000, including reasoning. They share one 300-second timeout; planning also has a 60-second cap. Keep planner and builder models, reasoning, budgets, deadlines, provider preference, and price caps configurable. DeepSeek remains an explicit option. The default 360-second hosting window requires Vercel Pro/Enterprise; Hobby uses a 300-second hosting window and a 290-second inference deadline. Keep the timeout below the hosting duration and six-minute attempt lease with at least ten seconds for cleanup. The builder supplies a short game-specific design brief and complete game source in its response. Do not add automatic refinement or repair calls. Charge each provider request to the existing 20/account and 40/global daily attempt limits, retaining the original lease while reserving the build step. Store only the user idea as the creation revision prompt; plans remain internal. Leave creative decisions to the model and user rather than imposing shared visual templates or mandatory game mechanics.
- Edit requests include the complete current HTML/CSS/JavaScript and latest request, with a base-revision check. Do not send every historical version. Do not add automatic paid retries or model fallbacks; preserve provider price caps and transactional attempt limits unless the task changes them.
- New games may include an SVG logo. Edits must omit logo generation and keep the stored logo unchanged. Enforce this in the generation path, both stores, and the database save function, rather than relying only on prompt instructions.
- Treat SVG as untrusted input. Validate the restricted vector subset and rasterize it to PNG with Sharp. Never insert model SVG into the studio DOM or serve it as executable markup. Invalid or legacy icons use the safe fallback. Published icon endpoints must use the published revision.
- Games are self-contained HTML/CSS/plain JavaScript, defaulting to 5MB of UTF-8 source. The runtime limit is configurable up to the 10MB database ceiling. Game-source and private revision-history JSON responses are streamed to accommodate large games; incoming request bodies remain bounded. Parse and validate before saving. Execute only inside an opaque iframe with `sandbox="allow-scripts"`, without `allow-same-origin`, under the restrictive game CSP. Do not weaken network, navigation, worker, or parent-page restrictions.
- Device saves use the trusted `PocketBase` bridge for `progress`, `score`, and `settings`, limited to 16KB per key. Preserve game/channel validation and save isolation. A startup acknowledgement confirms frame loading, not gameplay quality.

## Data, migrations, and publishing

- Hosted data lives in Supabase with RLS and ownership-checked functions. Keep production writes out of Vercel's filesystem. No service-role key belongs in the app runtime.
- Add a new numbered migration for schema changes; do not rewrite applied migrations. `npm run dev` and `npm run build` check/apply pending migrations automatically. `npm run db:migrate` runs the same process explicitly. Use `SUPABASE_ACCESS_TOKEN` from the server/build environment; never require manual SQL, CLI login, or Keychain access. Preview builds verify readiness without mutating the shared database.
- Publishing selects a saved revision; it does not create a deployment. Keep game URLs and manifest identities stable across updates. Download every required asset before offering an offline update, and retain the prior release if a download fails.
- Changes to `public/player.js`, `public/player.css`, or `public/sandbox.js` require a coordinated player asset-version bump in `src/lib/pwa.ts`, `public/game-worker.js`, and `public/player.js`, including versioned imports and worker registration URLs.
- GitHub Actions runs checks. Vercel's existing Git integration deploys the app; do not add a custom deployment workflow unless requested.

## Local work and verification

Run from the repository root. Use `npm ci` for dependencies and `npm run dev` for local work. Before restarting an existing server, confirm it belongs to Pocket Base and preserve unrelated processes.

For changes that affect behavior, run the relevant checks:

- `npm run typecheck`
- `npm test` — source/model boundaries, SVG safety, storage behavior, and PostgreSQL migrations in disposable PGlite.
- `npm run build` — production build and migration readiness.
- `npm run test:browser` — an isolated server on port 3217 with explicitly seeded fictional games and disposable browser contexts. Use installed Chrome, `CHROME_PATH`, or Playwright Chromium.

Cover phone and desktop layouts, navigation, publish/unpublish, revision changes, startup failures, offline play, and update transitions when touched. Screenshots must use fictional data and temporary profiles. Browser evidence goes to `AGENT_DESK_EVIDENCE_DIR` or the system temporary directory. Browser automation does not prove physical-device home-screen installation or live-model quality.

Keep `.env.local`, `.local/`, `.vercel/`, credentials, sessions, raw private game data, and test artifacts ignored. Never print secrets or use real accounts in routine test screenshots. Routine tests stub OpenRouter; use paid live checks sparingly and only when needed to verify provider behavior. Do not discard unrelated working-tree changes or commit incidental generated type-file churn.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
