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
       OPENROUTER_MODEL=openai/gpt-6.1-terra
       OPENROUTER_PLANNER_MODEL=openai/gpt-6.1-sol

3. Create the **account access token** at https://supabase.com/dashboard/account/tokens. This is separate from the project's publishable key. Keep it server-only; never prefix it with `NEXT_PUBLIC_` or commit it.
4. Run `npm run dev`. Startup checks the migration history and applies pending SQL files automatically. No SQL editor, database password, CLI login, or Keychain prompt is needed. `npm run db:migrate` applies migrations explicitly, including while playground mode is enabled.
5. Enable public signup with server-side registration limits using the steps below. `/account` provides sign-in and account creation without CAPTCHA. A public name, email, and password (at least 8 characters) are required. New accounts sign in immediately, without confirmation emails. Each account owns separate projects and revisions; there is no shared editing UI.

Existing accounts keep their games and use the part of their email before `@` as their initial public name. **Account settings** lets creators change it. Only the chosen public name is exposed in library credits; full email addresses and owner IDs remain private.

### Protected signup setup

1. Apply the numbered migrations with `npm run db:migrate`, then deploy the account page. The public header links to **Sign in / Sign up**; the account page offers both sign-in and account creation whenever Supabase is configured.
2. After deployment, run `npm run auth:configure` with the existing `SUPABASE_ACCESS_TOKEN`. This enables the PostgreSQL signup hook, public email signup, and immediate sign-in together, and disables Supabase CAPTCHA. It preserves stronger existing password requirements and built-in Auth rate limits, and refuses to overwrite another active signup hook. It never runs automatically during builds or startup.
3. Run `npm run auth:check` to inspect the email readiness flags: `signupEnabled`, `immediateSignIn`, `captchaDisabled`, and `signupHookEnabled`. All should be true. The script never prints raw auth settings or tokens.

The hook allows **3 registrations per IP per rolling hour, 10 per IP per rolling 24 hours, and 100 total per rolling 24 hours**. IPv6 addresses within one `/64` share a counter. Accepted signup requests reserve a slot, even if account creation subsequently fails. Counters are private and expire after 24 hours. The hook also checks direct Supabase signup requests and rejects registrations when it fails. Supabase's built-in Auth endpoint rate limits apply independently.

Signup and sign-in run from the browser so Supabase sees the visitor’s IP. The resulting verified session is handed to the app’s cookie-backed session endpoint. No Supabase service-role key or email service is introduced. Rate limits reduce automated abuse; they do not establish one account per person or prevent attackers from exhausting the shared allowance.

No Supabase service-role key is required by the app. PostgreSQL row-level security and ownership-checked functions protect private records. Public play access returns only the published game's title, description, theme, source, and revision identity. The public library returns published metadata across all accounts, without source, owner IDs, or full email addresses; it includes only the explicit public creator name and publication date. Drafts and prompts stay private.

Migration checks target the hosted project in `NEXT_PUBLIC_SUPABASE_URL`. An up-to-date database needs no admin token. Pending migrations without `SUPABASE_ACCESS_TOKEN` stop startup with setup instructions instead of consulting saved credentials. Failed migrations also stop startup. Disposable playground mode skips cloud setup.

When a migration is added while the development server is already running, run `npm run db:migrate`; hot reload does not rerun startup migrations. Library responses from before the play-counter migration remain readable during the transition, with an empty leaderboard and zero counts for missing fields.

### Google sign-in (release 1.3.0)

Google is optional and off by default. Email/password access continues to work. Google signup asks the creator to choose a **blank, explicit public name** before entering My studio; it never copies the Google profile name. Interrupted name setup resumes after reload. Existing creators retain their name and games. Supabase [automatically links identities with matching verified email addresses](https://supabase.com/docs/guides/auth/auth-identity-linking); Pocket Base does not merge accounts itself.

1. Create a Google Cloud project (or use the chosen existing project). In Google Auth Platform, configure branding and an **External** audience for public users. Request only `openid`, `email`, and `profile` identity scopes. Create an OAuth **Web application** client following [Supabase’s Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
2. Register `https://<your-supabase-project>.supabase.co/auth/v1/callback` as the client’s **Authorized redirect URI in Google**. This is Supabase’s callback; Google does not redirect directly to Pocket Base. Publish the consent configuration for public use after testing; a Testing audience only admits configured test users.
3. Keep `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the private setup environment alongside the existing Supabase admin token. Set `POCKET_BASE_SITE_URL` to the canonical origin, such as `https://pocket-base.example` (no path, query, or fragment). These Google credentials are used only by the setup command; they are not browser configuration and are not needed in the app runtime.
4. Apply migrations including `013_google_sign_in.sql`, and deploy release 1.3.0 through the existing Vercel Git integration with `POCKET_BASE_GOOGLE_SIGN_IN=false`. Then run `npm run auth:configure -- --google`. This explicitly enables Google, sets the Supabase Site URL, and adds the exact `<POCKET_BASE_SITE_URL>/auth/callback` to Supabase’s redirect allowlist. Existing allowlist entries, other providers, password requirements, and Auth rate limits are preserved. Builds/startup never configure providers, and preview environments cannot mutate shared settings.
5. Run `npm run auth:check`. Alongside the email readiness flags, `googleProviderEnabled`, `googleCredentialsConfigured`, `googleSiteConfigured`, and `googleCallbackAllowed` must be true. Only safe booleans are printed. `googleSignInEnabled` reports the local feature flag, not the deployment’s settings.
6. Enable `POCKET_BASE_GOOGLE_SIGN_IN=true` in **Production** only, with the canonical `POCKET_BASE_SITE_URL`, and deploy through Vercel’s integration. Leave Preview off unless using an intentionally configured isolated auth environment. Check a real Google signup, name completion, logout, and returning sign-in. For an existing email account, verify Google sign-in keeps the same user ID, public name, and games before broad launch. Routine automated tests use fictional local OAuth fixtures; they do not establish live Google or linking behavior.

For local development against a Supabase project, set `POCKET_BASE_SITE_URL=http://127.0.0.1:3000` and add the exact `http://127.0.0.1:3000/auth/callback` to **Supabase’s** redirect allowlist. Keep the hosted Supabase callback registered with Google. Use a separate development project/client to avoid changing the production Site URL. HTTP is accepted only for local loopback origins outside Vercel. Use the same hostname to start and finish sign-in because the PKCE verifier belongs to that browser’s cookies.

If Google reports `redirect_uri_mismatch`, check Google’s hosted Supabase callback registration. If sign-in returns to the wrong site, check the canonical origin and the exact Supabase app callback allowlist entry. Missing, expired, rejected, replayed, or cancelled codes return a safe, retryable account-page message. Start again from `/account` in the same browser, with cookies enabled; do not reuse a callback URL. Pending creators can complete their profile or sign out, but cannot use private studio APIs or database write RPCs. Both email and Google signups share the existing registration limits and fail closed on hook errors.

To roll back Google access, set `POCKET_BASE_GOOGLE_SIGN_IN=false` and redeploy. This hides the button and disables initiation/callback processing while email sign-in and existing sessions remain available. Keep migration 013 and existing profiles. No Google secrets, provider tokens, or raw OAuth errors should be added to app logs or client bundles.

### Models and usage

Initial creation uses **GPT-6.1 Sol to plan, then GPT-6.1 Terra to build**, both with medium reasoning. The planner returns one game-specific plan of up to 400 words. The builder receives the original idea and that plan, then returns the complete game and logo. There is no automatic refinement, repair, retry, or model fallback. A user-requested edit makes one builder call using the complete current source and the latest change request.

`OPENROUTER_MODEL` selects the builder and editor; it defaults to `openai/gpt-6.1-terra`. `OPENROUTER_PLANNER_MODEL` selects the creation-only planner; it defaults to `openai/gpt-6.1-sol`. Both use the existing OpenRouter key and account credits; no separate OpenAI key is needed.

- Terra (`openai/gpt-6.1-terra`, or `~openai/gpt-terra-latest`) defaults to caps of **$1 input and $5 output per million tokens**.
- Sol (`openai/gpt-6.1-sol`) defaults to caps of **$2 input and $10 output per million tokens**.
- DeepSeek (`~deepseek/deepseek-flash-latest`, or `deepseek/deepseek-v4.1-flash`) remains available with caps of **$0.30 input and $1.20 output per million tokens**. The leading `~` is required for the latest-model alias.
- To require free inference, set **both** model settings to `openrouter/free` or another model ID ending in `:free`. When the builder is free and no planner override is set, the planner follows the same free model. An explicitly paid planner with a free builder is rejected before any model call. Free requests always cap both prices at zero.
- Other paid model IDs require both explicit input and output price caps for their stage. Unsupported parameters and unavailable providers fail without switching models or retrying.

The app reserves each model call transactionally before contacting OpenRouter: **20 model-call attempts per account per UTC day, 40 across the app, and one active generation request per account**. Creation normally consumes two attempts and editing one. If planning fails, the builder is not called or charged against the allowance. The planning lease remains active while reserving and running the builder, so another request cannot start between stages. Failed attempts count. A six-minute lease prevents abandoned requests from locking an account indefinitely. These limits are not a monthly spending cap; use an OpenRouter key budget for a fixed account allowance.

Creation ideas and edit requests accept up to **100,000 characters** each by default; system instructions, the generated plan, and current source are added separately. The final game response includes a short inline design brief before its code. Plans stay internal to the creation request; only the original user idea is stored as the revision prompt. Edits do not include historical versions or request a new logo. Playing a finished game uses no inference.

Set the following in `.env.local` or the server/build environment. Changes require restarting the server or redeploying. The server passes only the public prompt-length limit to the UI; credentials and provider settings stay server-side.

| Setting | Default | Allowed values |
| --- | --- | --- |
| `POCKET_BASE_MAX_PROMPT_CHARACTERS` | `100000` | 1–100,000; enforced by the UI, API, and both stores |
| `POCKET_BASE_MAX_GAME_BYTES` | `5000000` | 100–10,000,000 UTF-8 bytes; enforced before and after source validation and before saving |
| `POCKET_BASE_GENERATION_TIMEOUT_MS` | `300000` | Shared planning/build deadline; 1,000–350,000 with the default hosting duration, including both response bodies |
| `POCKET_BASE_PLANNING_TIMEOUT_MS` | `60000` | 1,000–the shared deadline; the default clamps to fit a shorter deadline |
| `POCKET_BASE_MAX_PLAN_WORDS` | `400` | 1–1,000; a short game-specific plan, without code or a logo |
| `OPENROUTER_MODEL` | `openai/gpt-6.1-terra` | Builder and editor model ID |
| `OPENROUTER_PLANNER_MODEL` | `openai/gpt-6.1-sol` | Creation-only planner model ID; inherits a free builder when unset |
| `OPENROUTER_MAX_OUTPUT_TOKENS` | `100000` | 1–128,000, including reasoning; must also fit the selected model |
| `OPENROUTER_REASONING_EFFORT` | `medium` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; must be supported by the model |
| `OPENROUTER_PROVIDER_SORT` | `price` | `price`, `latency`, or `throughput`; price caps always apply |
| `OPENROUTER_MAX_INPUT_PRICE` | Model default | Non-negative USD per million input tokens |
| `OPENROUTER_MAX_OUTPUT_PRICE` | Model default | Non-negative USD per million output tokens |
| `OPENROUTER_PLANNER_MAX_OUTPUT_TOKENS` | `8000` | 1–128,000, including reasoning; must fit the planner model |
| `OPENROUTER_PLANNER_REASONING_EFFORT` | `medium` | Same reasoning values as the builder, independently configured |
| `OPENROUTER_PLANNER_PROVIDER_SORT` | `price` | `price`, `latency`, or `throughput` |
| `OPENROUTER_PLANNER_MAX_INPUT_PRICE` | Model default | Non-negative USD per million input tokens |
| `OPENROUTER_PLANNER_MAX_OUTPUT_PRICE` | Model default | Non-negative USD per million output tokens |

Free model routing always caps both prices at zero, even when paid-model caps are configured. The mutation-body limit is derived from the configured prompt length so fully JSON-escaped Unicode prompts fit, with oversized bodies rejected while reading. Database constraints independently cap prompts at 100,000 characters and source at 10MB. Runtime settings can lower these ceilings without another migration; increasing the database ceilings requires a new migration. Game-source and private revision-history endpoints stream their JSON responses so 5MB games can be delivered without the buffered response-size cap. Incoming mutation bodies remain bounded; this does not add file uploads or bypass hosting upload limits.

The 100,000-character default matches [Base44's documented chat API limit](https://docs.base44.com/api-reference/send-chat-message). Base44 does not publish a hard AI-builder timeout or an overall game-code cap in the reviewed documentation, so the requested 300-second and 5MB defaults are Pocket Base settings. External asset uploads, backend execution inside generated games, and Base44's file-storage allowances are separate capabilities and are not enabled by these settings.

Generation instructions leave each new game's art direction, layout, and mechanics to the model and the user's preferences. The five `theme` values choose library cover artwork; they do not restrict the in-game palette or visual style. Short prompts receive a focused interpretation, with no mandatory scoring, levels, or timers. Edits preserve the existing game's identity unless the requested change calls for a redesign. These instructions encourage variety; live output comparisons are needed to assess how well a model follows them.

Provider errors distinguish a rejected OpenRouter key, an upstream provider credential failure, unavailable free endpoints, and rate limits. If Google AI Studio reports an invalid key, check any Google BYOK connection in OpenRouter. A working OpenRouter API key does not guarantee that its upstream provider credentials work. No credentials or raw provider errors are shown in app responses.

## Deploy to Vercel once

1. Put this standalone project in your own Git repository.
2. Import it into Vercel as a **Next.js** project, using its root directory.
3. Add the production environment variables above. Set `POCKET_BASE_DEMO=false`; do not upload `.env.local` or playground data.
4. Deploy. Set Supabase's Site URL to your production HTTPS URL.
5. Allow anonymous visits to production play URLs at the Vercel deployment level. The app itself requires login for the builder and private APIs.

Production builds apply pending migrations automatically when `SUPABASE_ACCESS_TOKEN` is set in Vercel's **Production** environment. Without it, builds verify the database was migrated locally and stop if migrations are pending. Preview builds only verify readiness and never modify the shared database, even if an admin token is present. GitHub Actions runs checks; Vercel's Git integration handles deployment without a custom deployment workflow.

The generation function's hosting duration is configured in `vercel.json` as `functions["src/app/api/generate/route.ts"].maxDuration`, defaulting to **360 seconds**. **This duration requires Vercel Pro or Enterprise.** The complete model workflow defaults to **300 seconds shared between planning and building**, including both response bodies. Planning has a separate default cap of 60 seconds; the builder receives the remaining shared time. Its configured deadline must leave at least ten seconds before both the hosting duration and the six-minute transactional attempt lease expire. For **Vercel Hobby**, set `maxDuration` to `300` and `POCKET_BASE_GENERATION_TIMEOUT_MS=290000`; the workflow cannot receive a full five minutes and still leave cleanup time inside Hobby's five-minute request ceiling. With no explicit timeout override, lowering the hosting duration also lowers the default inference deadline to fit. Extending hosting duration alone does not extend the database lease. Timeout, interrupted-connection, and malformed-response errors are distinguished. Transport diagnostics record only the stage, duration, HTTP status, fixed error category, and restricted OpenRouter generation ID; they never record prompts, game source, keys, or raw provider errors. Use Vercel Fluid Compute. The server uses Node.js and durable data lives in Supabase; Vercel's filesystem is never the production database.

Vercel Hobby is for personal, noncommercial projects and has resource limits. Supabase Free can pause projects after a week of inactivity; restore a paused project in its dashboard. Existing downloaded games can still play offline. Provider allowances can change.

## Public game library

Anyone can browse the **Game library** view at `/library` and play published games without signing in. Sign-in is required to create, edit, or publish. Publishing makes a game discoverable across all users; unpublishing removes it from new library requests. The list reads the published revision, so subsequent private draft edits do not change the public title, description, or artwork until republished.

The header links to **My studio** and **Game library** as separate views. The library loads 24 games at a time, with **Show more games** to continue through all published games and **Refresh** to fetch the current list. **Search games** matches any part of titles, descriptions, and public creator names across the entire published catalog, ignoring case (`dod` matches `Dodge`). Search uses literal text (up to 200 characters), filters before pagination, and shows matching cards in place of the usual library sections. Clear the field or press Escape to return to browsing. `/api/library?offset=0&q=maze` provides the same public metadata and search; omit `q` for the full library. The five Pocket Base originals are public catalog games, not projects seeded into user studios. New studios receive no default projects; existing user creations are retained. Cards show the creator and the latest publication date. Private edits and account-name changes do not change that date; publishing a different revision does. Historical publication dates are backfilled from the published revision’s saved date. The home-page footer displays the version from `package.json`.

**Most played** shows the all-time top 10 above the recently updated games. Library cards also show play counts. A play means a successful online public game open, counted at most once per browser per game every rolling 30 minutes. It measures opens, not rounds completed or unique people. Studio previews, restarts, offline launches, downloads, and update checks add no plays. Counts start at zero with release 1.2.0 and carry across revisions and unpublish/republish cycles; unpublished games leave the leaderboard. Ties use publication date, then game ID. **Refresh** updates rankings and listings together; `/api/library` includes `playCount` per game and a `leaderboard` array independent of pagination.

Counting uses an anonymous random per-game browser ID in local storage and private database deduplication records, cleaned after 30 minutes on subsequent counting requests. No account identity or IP address is stored for counting. Reporting is best effort, never blocks gameplay, and is skipped when browser storage is unavailable. Offline opens are not queued for later reporting. Clearing browser storage or using another browser creates a separate counting identity; the totals are approximate popularity statistics.

## Publishing and installation

Public game URLs are `/play/<game-id>/`. Republish keeps the URL and manifest identity stable. Draft edits do not change a published game until that revision is published.

New games include a model-designed SVG logo in the same generation response. The server accepts a restricted vector-only SVG subset (up to 30KB), rejects external resources and executable markup, and renders it into PNG install icons. Studio cards and the publishing dialog show the saved logo through an owner-only PNG endpoint, including for unpublished games. Public library and install icons use the published revision. Invalid or missing logos fall back to a simple generated mark. Game edits preserve the stored logo in application and database code, even if the model returns a replacement. A one-time logo update covers the five originals and the four published legacy studio games; unpublished games retain their existing icon style. The originals' artwork is maintained in `src/content/classic-games.json` and migration `012_classic_game_logos.sql`; account-owned artwork remains only in the database.

Pocket Base itself also has a root manifest, favicon, Apple touch icon, and maskable home-screen icons. Saving `/` or `/library` installs the Pocket Base app and opens My studio. The studio remains an online app.

Each game has its own manifest, 192px/512px install icons, Apple touch icon, standalone player, and narrowly scoped service-worker registration. Multiple games can be installed separately from the same deployment.

- **iPhone/iPad:** open a game in Safari, choose Share → Add to Home Screen, and leave Open as Web App enabled if shown.
- **Android:** use Add to phone when an installation prompt is available, or the browser's Install app / Add to Home screen menu.
- **Offline:** wait for **Ready offline**. The complete game and required player files are cached. PWA support requires production HTTPS or localhost; an ordinary HTTP LAN URL is insufficient.
- **Updates:** check on launch and when returning online or to the app. Download the complete release before offering **Update & restart**. Active gameplay is not replaced mid-session. Incomplete downloads preserve the previous release.
- **Unpublish:** stops new online access and downloads. Previously downloaded copies can remain playable offline.

Scores and supported progress are device-local and isolated by game. There is no cross-device sync. Browser and installed-app storage can be separate, particularly on iOS. Users can clear downloaded data.

## Game boundary

Games use self-contained HTML/CSS/plain JavaScript. External packages, backend execution, multiplayer, integrations, and raster image generation are deferred. Games default to up to 5MB of source, configurable within the database ceiling.

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

This release is **1.2.6**. Every release must increment `package.json` and the root/package versions in `package-lock.json`; the footer reads that version automatically. Run all checks before releasing through the existing Vercel Git integration. App icon assets can be regenerated from the existing PocketMark with `node scripts/app-icons.mjs`.

The maintained originals are in `src/content/classic-games.json`, with a matching numbered database seed. Future content updates must add a new migration and change the relevant revision IDs/dates; never rewrite an applied migration. Test fixtures use different IDs.
