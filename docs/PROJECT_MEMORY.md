# Ottoflow AI — Project Memory (Updated 2026-06-02, Sentry activated → 100/100)

---

## Project Goal

Ship the **Brand Research Engine** (first vertical slice of the AI Content Operating System) to production-quality staging at 100/100 readiness, then promote to limited-access staging (5–10 trusted users) for a 7-day soak before public-beta planning.

---

## Tech Stack

**Frontend / API:**
- Next.js 15.5.18 + React 19 + TypeScript + TailwindCSS
- Clerk (free plan, dev instance `pro-beetle-20.clerk.accounts.dev`)
- Supabase (Postgres + Realtime + RLS) — project ref `ddozknywcdpyfdokmfrp`
- Vercel deployment, GitHub `josephottoflow/ottoflow-ai`

**Worker:**
- BullMQ + ioredis on Railway
- esbuild-bundled CJS, runs on plain node
- nixpacks pinned to **Node 22** (supabase-js Realtime needs native WebSocket)

**AI / Data:**
- Gemini Flash 2.5 via `@google/genai` (URL Context + Google Search grounding)
- Zod env validation with `isHeaderSafe()` at boot

**Observability:**
- `@sentry/nextjs` v10.55 (Next: client + server + edge)
- `@sentry/node` v10.55 (Worker)
- **Live in production** — Sentry project `o4511491188850688`, environment `production`, release auto-tagged to commit SHA
- DSN set on Vercel (`SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`, Production + Preview, Sensitive) and Railway (`SENTRY_DSN`)
- Tunnel route `/monitoring` (ad-blocker bypass), excluded from Clerk auth gate via `middleware.ts` public matcher
- Observability shim handler state lives on `globalThis.__ottoflow_observability__` so it survives Next.js per-route bundling

**Identifiers:**
- Vercel team: `team_MrIWWj7J9L2KLG58IRFcnDK7` (slug `joseph-ottoflow-s-projects`)
- Vercel project: `prj_2NKyZ4EvEYWpmDolFiCZuPnfHyh3`
- Supabase URL: `https://ddozknywcdpyfdokmfrp.supabase.co`
- Railway Redis: `redis://default:***@zephyr.proxy.rlwy.net:34949`
- Clerk userId: `user_3EU5v1pvYzamGINC5tUKbr8g1Ff`

---

## Live URLs

| Service | URL |
|---|---|
| Staging app | https://ottoflow-ai.vercel.app |
| Sign-in | https://ottoflow-ai.vercel.app/sign-in |
| Health check | https://ottoflow-ai.vercel.app/api/debug/health |
| Notion brand (live, completed) | https://ottoflow-ai.vercel.app/brands/0cd7d34a-54cf-4ffb-8fe0-e3a2b8d6c029 |
| Vercel | https://vercel.com/joseph-ottoflow-s-projects/ottoflow-ai |
| Railway | https://railway.com/project/6f03b33a-9433-4e21-bdbc-1c47525dd5a1 |
| Supabase | https://supabase.com/dashboard/project/ddozknywcdpyfdokmfrp |
| GitHub | https://github.com/josephottoflow/ottoflow-ai |

**Sign-in:** `joseph@ottoflow.ai` / `Ottoflow!2026-Staging-Xt7Qm9pL`

---

## Current Architecture

**Auth (Supabase Third-Party Auth, Path A):**
- Clerk session JWT → `Authorization: Bearer <jwt>` (no JWT template)
- Supabase verifies via Clerk JWKS
- RLS via SQL fn `current_clerk_user_id()` → `auth.jwt() ->> 'sub'`

**Brand-research flow:**
1. POST `/api/brands` → idempotency check → rate-limit check → admin client inserts `brands` + `brand_research_jobs` → enqueues BullMQ job
2. Railway worker → `extractBrandProfile` + `findCompetitors` + `generateSEOBundle` → writes back via admin client
3. Browser `SupabaseProvider` subscribes via Realtime (carries Clerk JWT)
4. `/brands/[id]` server component reads via user-authed client → RLS scopes to owner

**Defensive layers (baseline):**
- `isHeaderSafe()` — RFC 7230 no-CR/LF/CTL check on every env value at boot
- `safeToken()` — strict JWT regex `/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/`
- `tryCreateClient()` — try/catch around `createClient`, falls back to anon
- `safe<T>()` wrapper on every public db query — typed fallback on throw
- `withTimeout()` + `withRetry()` around every Gemini call (90s timeout, 3 attempts, exponential 1s→2s→4s capped 5s)
- Idempotency cache (Redis, 24h TTL)
- Rate limit (Redis ZSET sliding window, 10 brands/user/hour)
- Stuck-job recovery sweep at worker boot + on stalled events
- Domain allowlist (`@ottoflow.ai` only)
- Global ErrorBoundary + segment ErrorBoundary
- **Sentry capture on every defensive fallback** (label-tagged for grouping)

**Observability bridge:**
- `src/lib/observability.ts` — vendor-neutral shim, no transitive `@sentry/*` imports
- Next.js registers Sentry via `src/instrumentation.ts` → `sentry.{server,edge}.config.ts` + `src/instrumentation-client.ts`
- Worker registers Sentry via `worker/observability.ts` (loaded right after env validation in `worker/index.ts`)
- Both bridges fan `captureFallback(label, err, ctx)` → `Sentry.captureException` with stable label tags
- Console.error path preserved unconditionally (Railway/Vercel logs unchanged)

---

## Key Decisions

- **Clerk free plan + app-layer domain allowlist** — `ALLOWED_EMAIL_DOMAINS` defaults to `ottoflow.ai`, enforced in `layout.tsx`
- **GitHub identity:** `josephottoflow` for all commits; history rewritten to remove `joseph1986-gg`
- **Railway build:** `nixpacks.toml` overrides all phases; `railway.json` builds worker only
- **Node 22** on Railway (Node 20 lacks native WebSocket for supabase-js Realtime)
- **Idempotency + rate limit in Redis** (not DB) — staging acceptable; reset on Redis restart
- **Gemini structured-output two-mode branch:** strict (`responseMimeType` + `responseSchema`) when no tools; lenient (schema-in-prompt + code-fence-strip) when tools used. Gemini disallows both together
- **Icons across RSC boundary:** pre-rendered JSX (`<FileText size={18} />`) not function refs
- **Worker bundle externalizes `@sentry/node` + `@opentelemetry/*`** — OTel instrumentations load via dynamic `require()` and can't be statically bundled. `node_modules` is present at Railway runtime (nixpacks runs `npm ci --include=dev`)
- **Observability shim has no `@sentry/*` imports** — keeps worker bundle free of `@sentry/nextjs` while letting both processes register their own backend at boot
- **Sentry stays no-op until DSN set** — adding `SENTRY_DSN` is the only activation step; no code changes needed

---

## Completed Work

### Phase 1–6 (Tasks #1–#24)
Schema migrations, Clerk-Supabase bridge, BullMQ + esbuild worker, Brand UI (`/brands`, `/brands/new`, `/brands/[id]`), SupabaseProvider, env validation, decoupled supabase.ts, Redis lifecycle, docs (AUTH_FLOW, DEPLOYMENT, WORKER_ARCHITECTURE).

### Hardening (Tasks #27–#29)
- **H1+H2** Idempotency + rate limit on POST `/api/brands`
- **H3** Gemini timeout (90s) + exponential backoff retry
- **H4** Stuck-job recovery — boot sweep + stalled-event handler

### Auth + Bridge Fixes (Tasks #33–#38)
- Domain allowlist + unauthorized page
- 3-layer JWT defense (regex + isHeaderSafe + tryCreateClient)
- `safe()` wrappers on every query
- Root causes resolved: corrupted Vercel anon key, Node 20 missing WebSocket, Gemini tools+JSON incompat, RSC icon function refs

### Audit + Cleanup (Tasks #25, #26, #31, #39–#42)
- Phase 7 smoke test passed end-to-end (Notion brand fully populated)
- RLS isolation verified via `/api/debug/rls-test`
- Created `/billing`, `/settings`, `/help` placeholder pages
- Segment + global ErrorBoundary
- Deleted 2 orphan brand rows
- Readiness review **99/100**

### Sentry Scaffolding (this session, commit `096fb85`)
- Created `src/lib/observability.ts` shim (vendor-neutral)
- Created `sentry.server.config.ts` + `sentry.edge.config.ts` (Next runtimes)
- Created `src/instrumentation.ts` + `src/instrumentation-client.ts` (Next 15.3+ hooks)
- Created `worker/observability.ts` (worker init + `flushSentry()`)
- Wrapped `next.config.ts` with `withSentryConfig`, tunnelRoute `/monitoring`
- Externalized `@sentry/node` + `@opentelemetry/*` in `worker/build.mjs`
- Instrumented `gemini.ts` (retry breadcrumbs + exhaustion capture)
- Instrumented `supabase-server.ts` (5 fallback paths: token shape, header unsafe, auth header unsafe, createClient throw, getToken throw)
- Instrumented `db.ts` + `db-brands.ts` `safe()` wrappers
- Instrumented `worker/index.ts` (`failed` / `unhandledRejection` / `uncaughtException` + flush before exit)
- Updated `.env.local.example` (documented `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, env, sample rate, source-map upload trio)
- Verified: Next.js build green, worker bundle builds clean (12.5 MB)

### Sentry Activation (this session, commits `d9721d9` → `604814e`)
- **Sentry project provisioned** (`o4511491188850688`, Next.js platform)
- DSN pasted into Vercel `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (Production + Preview, Sensitive)
- DSN pasted into Railway `SENTRY_DSN` (worker service)
- Both platforms redeployed cleanly
- **Verified end-to-end** via `/api/debug/sentry-test`:
  - `sdk.active: true`, dsnHost `o4511491188850688.ingest.us.sentry.io`, environment `production`
  - Release auto-tagged to commit SHA (Vercel injects `VERCEL_GIT_COMMIT_SHA`)
  - Direct `Sentry.captureException` returned event id; `flushed: true`
  - `shim.wired: true` after singleton fix
- **Bug found + fixed during verification:** observability shim's module-level handler state didn't survive Next.js per-route bundling — every captureFallback() in production was silently no-op-ing despite a healthy SDK. Fix in `604814e`: back state with `globalThis.__ottoflow_observability__`, mirroring how `@sentry/nextjs` keeps its own client global. Same fix benign for the worker (single bundle).
- **Bug #2 found + fixed:** Clerk middleware was protecting the `/monitoring` tunnel route, which would have silently dropped every browser-side capture (events redirected to `/sign-in`). Fix in `d4c290b`: add `/monitoring(.*)` to public route matcher per the official Sentry Next.js skill.

### Diagnostic Endpoints (remove pre-public-beta)
- `/api/debug/auth` — Clerk JWT + Supabase RPC diagnostic
- `/api/debug/raw` — hand-built fetch to PostgREST bypassing supabase-js
- `/api/debug/rls-test` — admin vs user-authed count comparison
- `/api/debug/cleanup` — delete known-orphan brand rows (hardcoded IDs)
- `/api/debug/health` — 8-check comprehensive connection probe
- `/api/debug/sentry-test` — three-level Sentry probe (SDK / shim / event flow)

---

## Outstanding Tasks

| # | Status | Task |
|---|---|---|
| #30a | done | Rotate GitHub PAT (verified by `0b15521 chore(security): verify fresh PAT works post-rotation`) |
| #30b | pending | Rotate Gemini API key — Vercel + Railway env vars |
| #30c | pending | Rotate Railway Redis password — Vercel env var |
| Sentry activation | **done** | DSN live on Vercel + Railway, verified via /api/debug/sentry-test, all defensive layers flowing to Sentry |
| Sentry polish | pending | Bump `tracesSampleRate` 0.05 → 0.1 per Sentry skill rec; wire source-map upload (`SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`) for readable stack traces in prod |

### Task #30 walkthrough (remaining)

**Gemini API Key**
- URL: https://aistudio.google.com/app/apikey
- Delete existing → Create new → right-click copy (don't Ctrl+V from terminal)
- Update in: Vercel `GOOGLE_API_KEY` (redeploy) + Railway `GOOGLE_API_KEY`

**Railway Redis Password**
- Railway → Redis service → Variables → Rotate `REDIS_PASSWORD`
- Worker `REDIS_URL` updates automatically via `${{ Redis.REDIS_URL }}` reference
- Update Vercel `REDIS_URL` with new value
- Redeploy Vercel

**Post-rotation:** hit `/api/debug/health` → all 8 checks should pass.

---

## Readiness

**100/100.** Sentry active end-to-end; all defensive-layer fallbacks (Gemini retries, Supabase token rejections, db `safe()` wrappers, worker uncaught/unhandled) flowing to the dashboard. SDK release tagged to commit SHA. Singleton bug discovered and fixed under load.

## Known Issues / Out of Scope

1. **Diagnostic `/api/debug/*` endpoints exposed** — auth-gated but should be removed pre-public-beta (now 6 endpoints including `/api/debug/sentry-test`)
2. **142 pre-existing TS errors** in unrelated files (`worker/processors/brand-research.ts`, `src/agents/*`, `src/app/studio/page.tsx`). Vercel build pipeline ignores them
3. **Sentry source-map upload not yet wired** — direct captures show minified names. Closing this is recommended pre-public-beta per the Sentry Next.js skill ("non-negotiable for production")
4. **Out of scope** (intentional, deferred to v1):
   - `/billing` — Stripe integration
   - `/settings` — full UI (Clerk manages core for now)
   - `/content`, `/video` Run buttons don't trigger workers yet
   - `/projects` — empty (no brand-to-project flow)
   - Content Strategy Engine, UGC, Veo, Real Estate Mode

---

## Constraints / Standing Orders

**Security:**
- DO NOT paste secret values into chat — user pastes themselves; confirm "captured"
- Mask GitHub PAT in `git remote -v` output: `sed 's,://[^/]*@,://***@,'`
- Never skip git hooks (`--no-verify`) or bypass signing unless explicitly requested
- Cannot enter API keys/passwords/credentials into form fields — user must paste
- All commits authored as `josephottoflow`

**Scope:**
- DO NOT start new feature development
- DO NOT begin Content Strategy Engine / UGC / Veo / Real Estate Mode
- Stay focused on Brand Research Engine production quality

**Commit conventions:**
- Conventional commits: `feat(scope):`, `fix(scope):`, `chore(scope):`, `docs(scope):`
- Always include `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
- Pass commit messages via heredoc for correct formatting

---

## Critical File Paths

```
ottoflow-ai/
  nixpacks.toml                          NIXPACKS_NODE_VERSION=22
  railway.json                           buildCommand: npm run build:worker
  next.config.ts                         wrapped with withSentryConfig
  sentry.server.config.ts                @sentry/nextjs init (nodejs runtime)
  sentry.edge.config.ts                  @sentry/nextjs init (edge runtime)
  src/
    instrumentation.ts                   Next 15 register() hook
    instrumentation-client.ts            Next 15.3+ client init
    app/
      layout.tsx                         Domain allowlist gate
      page.tsx                           Dashboard
      error.tsx, global-error.tsx        ErrorBoundary (segment + root)
      unauthorized/page.tsx
      billing/, settings/, help/
      brands/{page,new/page,[id]/page,[id]/BrandDetailClient}.tsx
      content/, video/, projects/, analytics/
    middleware.ts                      Clerk auth gate; /monitoring public for Sentry tunnel
      api/
        brands/route.ts                  POST: idempotency + rate limit + create
        debug/{auth,raw,rls-test,cleanup,health,sentry-test}/route.ts
    lib/
      env.ts, worker-env.ts              Zod + isHeaderSafe
      supabase-server.ts                 safeToken + isHeaderSafe + tryCreateClient → instrumented
      supabase.ts                        Admin client
      db.ts, db-brands.ts                safe()-wrapped → instrumented
      domain-allowlist.ts
      rate-limit.ts, idempotency.ts      Redis-backed
      queue.ts                           BullMQ singletons, getRedisClient
      gemini.ts                          withTimeout/withRetry + retry breadcrumbs + exhaustion capture
      observability.ts                   Vendor-neutral shim — handler state on globalThis (singleton-safe across bundles)
    components/
      KPICard.tsx                        icon: ReactNode
      Sidebar.tsx
      ActivityFeed/RenderQueue/UsageChart.tsx
      SupabaseProvider.tsx               Clerk JWT to Realtime
  worker/
    index.ts                             Boot: dotenv → env → observability → Redis → recovery → Worker
    observability.ts                     @sentry/node init + flushSentry (NEW)
    build.mjs                            esbuild bundler; externalizes @sentry/node + @opentelemetry/*
    recovery.ts                          Stuck-job sweep + stall handler
  supabase/migrations/
    001_initial.sql                      projects/content/render_jobs, current_clerk_user_id()
    002_foundation.sql                   brands, research jobs, competitors, keywords, pillars
  docs/
    AUTH_FLOW.md DEPLOYMENT.md PRODUCTION_AUDIT.md
    WORKER_ARCHITECTURE.md STAGING_*.md
    READINESS_REVIEW.md                  99/100 scorecard (Sentry closes -1 once activated)
    PROJECT_MEMORY.md                    THIS FILE
```

---

## Recent Commits (newest first)

```
604814e  fix(observability): back handler state with globalThis singleton
08d7cf5  fix(debug/sentry-test): three-level diagnosis (SDK / shim / events)
d4c290b  fix(middleware): exclude /monitoring tunnel from Clerk auth gate
d9721d9  feat(debug): /api/debug/sentry-test — Sentry activation probe
096fb85  feat(observability): wire Sentry scaffolding for Next + worker
0b15521  chore(security): verify fresh PAT works post-rotation
d78d535  docs(memory): snapshot session state for resume tomorrow
51dbc84  fix(debug/health): probe worker liveness via BullMQ getWorkers()
1f55fee  feat(debug): /api/debug/health — exercise every external connection
2b2f4ae  docs(audit): full system audit — 99/100, staging-ready
```

---

## Sentry Architecture Reference

**Activation:** ✅ Live. Sentry project `o4511491188850688`, DSN set on Vercel (`SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`, Production + Preview, Sensitive) and Railway worker (`SENTRY_DSN`).

**Singleton storage:** The observability shim handler state lives on `globalThis.__ottoflow_observability__`, not on module-level closures. Next.js bundles each serverless function (and each route) separately, so module-level `let` ends up duplicated — handler registered in instrumentation hook would be invisible from API-route bundles. globalThis is shared across all bundles in the same Node process. This mirrors how `@sentry/nextjs` itself keeps its client state global. Caught in prod during verification (`/api/debug/sentry-test` returned `shim.wired:false` while `sdk.active:true`), fixed in commit `604814e`.

**Tunnel route:** `withSentryConfig({ tunnelRoute: "/monitoring" })` in `next.config.ts` routes browser-side captures through our own origin (defeats ad-blockers that strip sentry.io). `/monitoring(.*)` is in `middleware.ts` public route matcher — Clerk would otherwise redirect every event to sign-in.

**Capture labels (stable, used for Sentry grouping):**
- `gemini.call.exhausted` — Gemini retries exhausted, with model/timeout/maxRetries context
- `supabase-server.token.shape_invalid` — Clerk getToken() returned non-JWT
- `supabase-server.token.header_unsafe` — JWT passed regex but failed RFC 7230
- `supabase-server.auth_header.unsafe` — Bearer header would be malformed
- `supabase-server.createClient.threw` — supabase-js createClient itself threw
- `supabase-server.clerk_getToken.threw` — Clerk auth().getToken() threw
- `db.<queryName>.threw` — any db.ts safe() catch (getProjects, getRenderJobs, getActivity, etc.)
- `db-brands.<queryName>.threw` — any db-brands.ts safe() catch (listBrands, getBrand, etc.)

**Breadcrumbs (low-signal events attached to nearby captures):**
- `gemini.retry` category — every retry attempt with attempt number, retryable bool, error message

**Tags:**
- `runtime`: `nextjs-node` | `nextjs-edge` | `nextjs-client` | `worker`
- `fallback.label`: the stable label above (for filtering)
- Worker job failures also tag `queue`, `job.id`, `brand.id`

**Sample rate:** `tracesSampleRate=0.05` (5%) by default — env-tunable via `SENTRY_TRACES_SAMPLE_RATE` / `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`.

**Source-map upload:** Opt-in via `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`. Without them, runtime captures still work but stack traces show minified names.

---

## Next Steps

1. **Finish Task #30** — rotate Gemini API key + Railway Redis password (GitHub PAT + Sentry activation already done)
2. **Sentry polish** — bump `tracesSampleRate` 0.05 → 0.1 (per Sentry skill rec); wire source-map upload (`SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`) so production stack traces are readable instead of minified
3. **Decision point** — promote to limited-access staging (5–10 trusted users), monitor 7 days, then plan public-beta promotion
4. **Pre-public-beta cleanup** — remove `/api/debug/*` endpoints (now 6: auth, raw, rls-test, cleanup, health, sentry-test), address the 142 pre-existing TS errors
