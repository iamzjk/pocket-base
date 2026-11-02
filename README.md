# Pocket Base

A creative workshop for making touch-friendly browser games. Describe an idea, try the game, ask for changes, and publish a link. Every published game is an installable PWA with offline play and its own home-screen identity.

**Deploy Pocket Base once. Publishing a game does not create a Vercel project or run a deployment.** It selects a saved version in the database; the existing app serves its URL, manifest, icons, and offline player automatically.

## Run locally

Requires Node.js 22+ and npm. The entire application uses TypeScript/JavaScript; Python is not required.

1. Run `npm ci`.
2. Run `npm run setup` to create a local playground configuration (keeps any existing settings).
3. Run `npm run dev`.
4. Open http://127.0.0.1:3000.

New local studios start empty. Connect the game maker to create games; publishing, version history, installation, and offline play use local storage in playground mode. The public library includes five Pocket Base originals; they are independent of each user’s private studio.

Playground data is stored in ignored `.local/demo.json`. Set `POCKET_BASE_DATA_DIR` to use disposable state. Playground access requires `POCKET_BASE_DEMO=true`, a loopback hostname, and no Vercel runtime. It cannot enable anonymous builder access on Vercel.

## Connect your family studio

1. Create a free Supabase project.
2. Set these in your ignored `.env.local`:

       POCKET_BASE_DEMO=false
       NEXT_PUBLIC_SUPABASE_URL=your-project-url
       NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-legacy-anon-key
       SUPABASE_ACCESS_TOKEN=your-server-only-account-access-token
       OPENROUTER_API_KEY=your-server-only-key
       OPENROUTER_MODEL=~deepseek/deepseek-flash-latest

3. Create the **account access token** at https://supabase.com/dashboard/account/tokens. This is separate from the project's publishable key. Keep it server-only; never prefix it with `NEXT_PUBLIC_` or commit it.
4. Run `npm run dev`. Startup checks the migration history and applies pending SQL files automatically. No SQL editor, database password, CLI login, or Keychain prompt is needed. `npm run db:migrate` applies migrations explicitly, including while playground mode is enabled.
5. Configure hCaptcha and enable protected public signup using the steps below. `/account` provides sign-in and account creation. A public name, email, and password (at least 8 characters) are required. New accounts sign in immediately, without confirmation emails. Each account owns separate projects and revisions; there is no shared editing UI.

Existing accounts keep their games and use the part of their email before `@` as their initial public name. **Account settings** lets creators change it. Only the chosen public name is exposed in library credits; full email addresses and owner IDs remain private.

### Protected signup setup

1. Create an [hCaptcha sitekey and secret](https://dashboard.hcaptcha.com/). Enable its domain allowlist for your production hostname. For local testing with real hCaptcha, use a supported development hostname; routine browser tests use a local CAPTCHA double.
2. Set `NEXT_PUBLIC_HCAPTCHA_SITEKEY` in `.env.local` and Vercel. Keep `HCAPTCHA_SECRET_KEY` only in the private environment used by the setup command; the app runtime does not need it. Never use official hCaptcha test keys in production.
3. Apply the numbered migrations with `npm run db:migrate`, then deploy the new account page **before** enabling CAPTCHA. Until a sitekey is configured, existing users can sign in and the registration tab stays hidden. Once enabled, Supabase independently enforces CAPTCHA even for direct authentication requests.
4. After deployment, run `npm run auth:configure` with the existing `SUPABASE_ACCESS_TOKEN` and hCaptcha settings. This enables hCaptcha, the PostgreSQL signup hook, public email signup, and immediate sign-in together. It preserves stronger existing password requirements and refuses to overwrite another active signup hook. It never runs automatically during builds or startup.
5. Run `npm run auth:check` to inspect only the four public readiness flags. The script never prints raw auth settings, tokens, or CAPTCHA secrets.

The hook allows **3 registrations per IP per hour, 10 per IP per rolling 24 hours, and 100 total per rolling 24 hours**. IPv6 addresses within one `/64` share a counter. Accepted signup requests reserve a slot, even if account creation subsequently fails. Counters are private and expire after 24 hours; CAPTCHA and the hook apply to direct Supabase requests too. CAPTCHA failures and outages do not bypass protection.

Signup and sign-in run from the browser so Supabase sees the visitor’s IP. The resulting verified session is handed to the app’s cookie-backed session endpoint. No Supabase service-role key or email service is introduced. CAPTCHA and rate limits reduce automated abuse; they do not establish one account per person.

No Supabase service-role key is required by the app. PostgreSQL row-level security and ownership-checked functions protect private records. Public play access returns only the published game's title, description, theme, source, and revision identity. The public library returns published metadata across all accounts, without source, owner IDs, or full email addresses; it includes only the explicit public creator name and publication date. Drafts and prompts stay private.

Migration checks target the hosted project in `NEXT_PUBLIC_SUPABASE_URL`. An up-to-date database needs no admin token. Pending migrations without `SUPABASE_ACCESS_TOKEN` stop startup with setup instructions instead of consulting saved credentials. Failed migrations also stop startup. Disposable playground mode skips cloud setup.

### Models and usage

`OPENROUTER_MODEL` supports these explicit choices:

- `openrouter/free`, or a model ID ending in `:free`: provider prompt and completion prices are capped at zero.
- `~deepseek/deepseek-flash-latest` (default; the leading `~` is required): a paid coding option, capped at **$0.30 input and $1.20 output per million tokens**. Requests prefer cheaper eligible providers, use medium reasoning, and allow at most 100,000 output tokens (including reasoning). If no provider fits those caps, the request stops. The alias follows the latest Flash release, including future versions beyond 4.1. `deepseek/deepseek-v4.1-flash` remains supported as an explicit pin, also with medium reasoning.

No model automatically falls back to a different or more expensive model. Select a model through `OPENROUTER_MODEL` in `.env.local` or Vercel; DeepSeek uses the existing OpenRouter key and account credits. At the rate caps, an illustrative 2,000-input / 5,000-output token request costs $0.0066. Longer games and revision prompts use more tokens. Playing a finished game uses no inference. Rate caps and attempt limits are not a monthly spending cap; use an OpenRouter key budget for a fixed account spending allowance.

The app reserves attempts transactionally in PostgreSQL before calling OpenRouter: **20 attempts per account per UTC day, 40 across the app, and one active generation per account**. Failed attempts count. A five-minute lease prevents abandoned requests from locking an account indefinitely. These conservative limits do not replace OpenRouter's own account/provider limits.

Creation ideas and edit requests accept up to **5,000 characters** each; the system instructions and current game source are added separately. Initial creation and edits use separate, concise instructions. Each request asks for a short game-specific design brief before the code and uses medium reasoning on DeepSeek. Edits include the complete current HTML/CSS/JavaScript; they do not include all historical versions or ask for a new logo. Each create/edit uses a single model request, with no automatic retry loop. Finished games run locally in the browser and use no inference.

Generation instructions leave each new game's art direction, layout, and mechanics to the model and the user's preferences. The five `theme` values choose library cover artwork; they do not restrict the in-game palette or visual style. Short prompts receive a focused interpretation, with no mandatory scoring, levels, or timers. Edits preserve the existing game's identity unless the requested change calls for a redesign. These instructions encourage variety; live output comparisons are needed to assess how well a model follows them.

Provider errors distinguish a rejected OpenRouter key, an upstream provider credential failure, unavailable free endpoints, and rate limits. If Google AI Studio reports an invalid key, check any Google BYOK connection in OpenRouter. A working OpenRouter API key does not guarantee that its upstream provider credentials work. No credentials or raw provider errors are shown in app responses.

## Deploy to Vercel once

1. Put this standalone project in your own Git repository.
2. Import it into Vercel as a **Next.js** project, using its root directory.
3. Add the production environment variables above. Set `POCKET_BASE_DEMO=false`; do not upload `.env.local` or playground data.
4. Deploy. Set Supabase's Site URL to your production HTTPS URL.
5. Allow anonymous visits to production play URLs at the Vercel deployment level. The app itself requires login for the builder and private APIs.

Production builds apply pending migrations automatically when `SUPABASE_ACCESS_TOKEN` is set in Vercel's **Production** environment. Without it, builds verify the database was migrated locally and stop if migrations are pending. Preview builds only verify readiness and never modify the shared database, even if an admin token is present. GitHub Actions runs checks; Vercel's Git integration handles deployment without a custom deployment workflow.

The generation route configures `maxDuration=300` and times out inference after 250 seconds (4 minutes 10 seconds), including reading the response body after headers arrive. Timeout, interrupted-connection, and malformed-response errors are distinguished. Transport diagnostics record only the stage, duration, HTTP status, fixed error category, and restricted OpenRouter generation ID; they never record prompts, game source, keys, or raw provider errors. Use Vercel Fluid Compute. The server uses Node.js and durable data lives in Supabase; Vercel's filesystem is never the production database.

Vercel Hobby is for personal, noncommercial projects and has resource limits. Supabase Free can pause projects after a week of inactivity; restore a paused project in its dashboard. Existing downloaded games can still play offline. Provider allowances can change.

## Public game library

Anyone can browse the **Game library** view at `/library` and play published games without signing in. Sign-in is required to create, edit, or publish. Publishing makes a game discoverable across all users; unpublishing removes it from new library requests. The list reads the published revision, so subsequent private draft edits do not change the public title, description, or artwork until republished.

The header links to **My studio** and **Game library** as separate views. The library loads 24 games at a time, with **Show more games** to continue through all published games and **Refresh** to fetch the current list. `/api/library?offset=0` provides the same public metadata. The five Pocket Base originals are public catalog games, not projects seeded into user studios. New studios receive no default projects; existing user creations are retained. Cards show the creator and the latest publication date. Private edits and account-name changes do not change that date; publishing a different revision does. Historical publication dates are backfilled from the published revision’s saved date. The home-page footer displays the version from `package.json`.

## Publishing and installation

Public game URLs are `/play/<game-id>/`. Republish keeps the URL and manifest identity stable. Draft edits do not change a published game until that revision is published.

New games include a model-designed SVG logo in the same generation response. The server accepts a restricted vector-only SVG subset (up to 30KB), rejects external resources and executable markup, and renders it into PNG install icons. Invalid icons fall back to a simple generated mark. Game edits preserve the stored logo in application and database code, even if the model returns a replacement. Legacy games retain their existing icon style.

Pocket Base itself also has a root manifest, favicon, Apple touch icon, and maskable home-screen icons. Saving `/` or `/library` installs the Pocket Base app and opens My studio. The studio remains an online app.

Each game has its own manifest, 192px/512px install icons, Apple touch icon, standalone player, and narrowly scoped service-worker registration. Multiple games can be installed separately from the same deployment.

- **iPhone/iPad:** open a game in Safari, choose Share → Add to Home Screen, and leave Open as Web App enabled if shown.
- **Android:** use Add to phone when an installation prompt is available, or the browser's Install app / Add to Home screen menu.
- **Offline:** wait for **Ready offline**. The complete game and required player files are cached. PWA support requires production HTTPS or localhost; an ordinary HTTP LAN URL is insufficient.
- **Updates:** check on launch and when returning online or to the app. Download the complete release before offering **Update & restart**. Active gameplay is not replaced mid-session. Incomplete downloads preserve the previous release.
- **Unpublish:** stops new online access and downloads. Previously downloaded copies can remain playable offline.

Scores and supported progress are device-local and isolated by game. There is no cross-device sync. Browser and installed-app storage can be separate, particularly on iOS. Users can clear downloaded data.

## Game boundary

Games use self-contained HTML/CSS/plain JavaScript. External packages, backend execution, multiplayer, integrations, and raster image generation are deferred. Games may contain up to 1MB of source.

The trusted player runs generated code in an iframe with only `allow-scripts`, without `allow-same-origin`. A restrictive content security policy blocks fetch, workers, nested frames, and outside resources. Source is parsed and script syntax checked before saving. Game source is served as JSON and never inserted into the top-level builder or player document.

The studio preview and public player wait for a visible frame before starting the game and listen for a startup acknowledgement. A failed start or a 12-second startup timeout shows a retry action. Time spent in a hidden tab or panel does not trigger the timeout. Runtime failure messages stay visible independently of offline download status. Startup acknowledgement confirms the frame loaded; it does not prove that the generated game is bug-free or fun.

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

## Releases

This release is **1.1.0**. Every release must increment `package.json` and the root/package versions in `package-lock.json`; the footer reads that version automatically. Run all checks before releasing through the existing Vercel Git integration. App icon assets can be regenerated from the existing PocketMark with `node scripts/app-icons.mjs`.

The maintained originals are in `src/content/classic-games.json`, with a matching numbered database seed. Future content updates must add a new migration and change the relevant revision IDs/dates; never rewrite an applied migration. Test fixtures use different IDs.
