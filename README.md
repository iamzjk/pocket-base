# Pocket Base

A creative workshop for making touch-friendly browser games. Describe an idea, try the game, ask for changes, and publish a link. Every published game is an installable PWA with offline play and its own home-screen identity.

**Deploy Pocket Base once. Publishing a game does not create a Vercel project or run a deployment.** It selects a saved version in the database; the existing app serves its URL, manifest, icons, and offline player automatically.

## Run locally

Requires Node.js 22+ and npm. The entire application uses TypeScript/JavaScript; Python is not required.

1. Run `npm ci`.
2. Run `npm run setup` to create a local playground configuration (keeps any existing settings).
3. Run `npm run dev`.
4. Open http://127.0.0.1:3000.

The explicit local playground has five fictional, playable starter games. It supports saving starters, publishing, version history, installation, and offline play without cloud credentials. AI requests report that the game maker needs connecting; sample games are never passed off as AI-generated output.

Playground data is stored in ignored `.local/demo.json`. Set `POCKET_BASE_DATA_DIR` to use disposable state. Playground access requires `POCKET_BASE_DEMO=true`, a loopback hostname, and no Vercel runtime. It cannot enable anonymous builder access on Vercel.

## Connect your family studio

1. Create a free Supabase project.
2. Set these in your ignored `.env.local`:

       POCKET_BASE_DEMO=false
       NEXT_PUBLIC_SUPABASE_URL=your-project-url
       NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-legacy-anon-key
       SUPABASE_ACCESS_TOKEN=your-server-only-account-access-token
       OPENROUTER_API_KEY=your-server-only-key
       OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash

3. Create the **account access token** at https://supabase.com/dashboard/account/tokens. This is separate from the project's publishable key. Keep it server-only; never prefix it with `NEXT_PUBLIC_` or commit it.
4. Run `npm run dev`. Startup checks the migration history and applies pending SQL files automatically. No SQL editor, database password, CLI login, or Keychain prompt is needed. `npm run db:migrate` applies migrations explicitly, including while playground mode is enabled.
5. In **Authentication → Providers / Sign In settings**, disable new public user signups. Create your family's account from **Authentication → Users → Add user**, with an email and password. Mark the account confirmed when creating it, then sign in locally. Children can use the parent-managed family account.

For separate private accounts, create more users in that dashboard. Each account owns separate projects and revisions. There is no public signup or team collaboration UI.

No Supabase service-role key is required by the app. PostgreSQL row-level security and ownership-checked functions protect private records. Public access returns only the published game's title, description, theme, source, and revision identity. Drafts and prompts stay private.

Migration checks target the hosted project in `NEXT_PUBLIC_SUPABASE_URL`. An up-to-date database needs no admin token. Pending migrations without `SUPABASE_ACCESS_TOKEN` stop startup with setup instructions instead of consulting saved credentials. Failed migrations also stop startup. Disposable playground mode skips cloud setup.

### Models and usage

`OPENROUTER_MODEL` supports these explicit choices:

- `openrouter/free`, or a model ID ending in `:free`: provider prompt and completion prices are capped at zero.
- `deepseek/deepseek-v4.1-flash` (default): a paid coding option, capped at **$0.30 input and $1.20 output per million tokens**. Requests prefer cheaper eligible providers, disable optional reasoning, and allow at most 10,000 generated tokens. If no provider fits those caps, the request stops.

No model automatically falls back to a different or more expensive model. Select a model through `OPENROUTER_MODEL` in `.env.local` or Vercel; DeepSeek uses the existing OpenRouter key and account credits. At the rate caps, an illustrative 2,000-input / 5,000-output token request costs $0.0066. Longer games and revision prompts use more tokens. Playing a finished game uses no inference. Rate caps and attempt limits are not a monthly spending cap; use an OpenRouter key budget for a fixed account spending allowance.

The app reserves attempts transactionally in PostgreSQL before calling OpenRouter: **20 attempts per account per UTC day, 40 across the app, and one active generation per account**. Failed attempts count. A five-minute lease prevents abandoned requests from locking an account indefinitely. These conservative limits do not replace OpenRouter's own account/provider limits.

Each create/edit uses a single model request, with no automatic retry loop. Finished games run locally in the browser and use no inference.

Provider errors distinguish a rejected OpenRouter key, an upstream provider credential failure, unavailable free endpoints, and rate limits. If Google AI Studio reports an invalid key, check any Google BYOK connection in OpenRouter. A working OpenRouter API key does not guarantee that its upstream provider credentials work. No credentials or raw provider errors are shown in app responses.

## Deploy to Vercel once

1. Put this standalone project in your own Git repository.
2. Import it into Vercel as a **Next.js** project, using its root directory.
3. Add the production environment variables above. Set `POCKET_BASE_DEMO=false`; do not upload `.env.local` or playground data.
4. Deploy. Set Supabase's Site URL to your production HTTPS URL.
5. Allow anonymous visits to production play URLs at the Vercel deployment level. The app itself requires login for the builder and private APIs.

Production builds apply pending migrations automatically when `SUPABASE_ACCESS_TOKEN` is set in Vercel's **Production** environment. Without it, builds verify the database was migrated locally and stop if migrations are pending. Preview builds only verify readiness and never modify the shared database, even if an admin token is present. GitHub Actions runs checks; Vercel's Git integration handles deployment without a custom deployment workflow.

The generation route configures `maxDuration=300` and times out inference after 250 seconds. Use Vercel Fluid Compute. The server uses Node.js and durable data lives in Supabase; Vercel's filesystem is never the production database.

Vercel Hobby is for personal, noncommercial projects and has resource limits. Supabase Free can pause projects after a week of inactivity; restore a paused project in its dashboard. Existing downloaded games can still play offline. Provider allowances can change.

## Publishing and installation

Public game URLs are `/play/<game-id>/`. Republish keeps the URL and manifest identity stable. Draft edits do not change a published game until that revision is published.

Each game has its own manifest, 192px/512px install icons, Apple touch icon, standalone player, and narrowly scoped service-worker registration. Multiple games can be installed separately from the same deployment.

- **iPhone/iPad:** open a game in Safari, choose Share → Add to Home Screen, and leave Open as Web App enabled if shown.
- **Android:** use Add to phone when an installation prompt is available, or the browser's Install app / Add to Home screen menu.
- **Offline:** wait for **Ready offline**. The complete game and required player files are cached. PWA support requires production HTTPS or localhost; an ordinary HTTP LAN URL is insufficient.
- **Updates:** check on launch and when returning online or to the app. Download the complete release before offering **Update & restart**. Active gameplay is not replaced mid-session. Incomplete downloads preserve the previous release.
- **Unpublish:** stops new online access and downloads. Previously downloaded copies can remain playable offline.

Scores and supported progress are device-local and isolated by game. There is no cross-device sync. Browser and installed-app storage can be separate, particularly on iOS. Users can clear downloaded data.

## Game boundary

Games use self-contained HTML/CSS/plain JavaScript. External packages, backend execution, multiplayer, integrations, and image generation are deferred.

The trusted player runs generated code in an iframe with only `allow-scripts`, without `allow-same-origin`. A restrictive content security policy blocks fetch, workers, nested frames, and outside resources. Source is parsed and script syntax checked before saving. Game source is served as JSON and never inserted into the top-level builder or player document.

Games receive an asynchronous save bridge:

    const saved = await PocketBase.load("progress");
    await PocketBase.save("progress", { level: 2 });

Keys are `progress`, `score`, and `settings`, each limited to 16KB. The bridge validates the sending frame and per-run channel. Games cannot choose another game's save namespace.

The player dispatches a `pocket:visibility` event with `event.detail.hidden` for pausing timers/audio. Games should handle storage errors and start audio only after a touch.

## Checks

- `npm run typecheck`
- `npm test` — model boundaries, source validation, ownership/versioning, and the actual PostgreSQL migration in disposable PGlite.
- `npm run build`
- `npm run test:browser` — a production server on isolated port 3217, fictional data, and a disposable browser profile.

Browser checks use installed Chrome on macOS, `CHROME_PATH` if provided, or Playwright Chromium (`npx playwright install chromium`). Evidence goes to `AGENT_DESK_EVIDENCE_DIR` or the system temporary directory under `pocket-base-evidence`. Tests make no live AI calls and use no personal sessions.

Chromium automation does not substitute for home-screen installation and app switching tests on physical iPhone and Android devices. Live model quality and hosted Supabase authentication require real environment settings.
