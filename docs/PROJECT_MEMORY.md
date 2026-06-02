# Ottoflow AI — Project Memory (Updated 2026-06-02, post Content-Pipeline MVP + detail view)

---

## Project Goal

Ship the **AI Content Operating System** vertical-slice-by-vertical-slice to production-quality staging. Brand Research Engine is 100/100 + verified end-to-end (happy path + failure-recovery path). Content Pipeline MVP is live (pick brand + platform → publish-ready draft in ~20s). Video Pipeline + Project flows remain v1 scope.

---

## Tech Stack

**Frontend / API**
- Next.js 15.1.6 + React 19 + TypeScript + TailwindCSS + Shadcn/ui
- Clerk (free plan, dev instance `pro-beetle-20.clerk.accounts.dev`)
- Supabase (Postgres + Realtime + RLS, project `ddozknywcdpyfdokmfrp`)
- Vercel deployment, GitHub `josephottoflow/ottoflow-ai`

**Worker**
- BullMQ + ioredis on Railway
- esbuild-bundled CJS, plain node
- nixpacks pinned to Node 22 (supabase-js Realtime needs native WebSocket)
- Two BullMQ Worker instances: `brand-research` + `content-generation` (separate queues, shared Redis + shutdown sequence)

**AI / Data**
- Gemini Flash 2.5 via `@google/genai` (URL Context + Google Search grounding)
- Zod env validation with `isHeaderSafe()` at boot

**Observability**
- `@sentry/nextjs` v10.55 (Next: client + server + edge)
- `@sentry/node` v10.55 (Worker)
- Live in production, environment `production`, release auto-tagged to commit SHA
- `tracesSampleRate=0.1` default (env-tunable)

**Identifiers**
- Vercel team `team_MrIWWj7J9L2KLG58IRFcnDK7` / slug `joseph-ottoflow-s-projects`
- Vercel project `prj_2NKyZ4EvEYWpmDolFiCZuPnfHyh3`
- Supabase URL `https://ddozknywcdpyfdokmfrp.supabase.co`
- Railway Redis `redis://default:***@zephyr.proxy.rlwy.net:34949`
- Railway project `6f03b33a-9433-4e21-bdbc-1c47525dd5a1`
- Sentry org `ottoflow`, project `javascript-nextjs`, org id `o4511491188850688`
- Clerk userId `user_3EU5v1pvYzamGINC5tUKbr8g1Ff`

---

## Live URLs & Credentials

| Service | URL |
|---|---|
| Staging | https://ottoflow-ai.vercel.app |
| Sign-in | https://ottoflow-ai.vercel.app/sign-in |
| Health probe | https://ottoflow-ai.vercel.app/api/debug/health |
| Linear brand (live, complete) | https://ottoflow-ai.vercel.app/brands/455e4f6a-113f-4504-8aac-e4f3442db6ff |
| Notion brand (live, complete) | https://ottoflow-ai.vercel.app/brands/0cd7d34a-54cf-4ffb-8fe0-e3a2b8d6c029 |
| Content generation (entry) | https://ottoflow-ai.vercel.app/content/generate |
| Vercel project | https://vercel.com/joseph-ottoflow-s-projects/ottoflow-ai |
| Railway project | https://railway.com/project/6f03b33a-9433-4e21-bdbc-1c47525dd5a1 |
| Supabase dashboard | https://supabase.com/dashboard/project/ddozknywcdpyfdokmfrp |
| Sentry Issues | https://ottoflow.sentry.io/issues/?project=4511491204907008 |
| GitHub | https://github.com/josephottoflow/ottoflow-ai |

**Sign-in:** `joseph@ottoflow.ai` / `Ottoflow!2026-Staging-Xt7Qm9pL`

---

## Current Architecture

**Auth (Supabase Third-Party Auth, Path A)**
- Clerk session JWT → `Authorization: Bearer <jwt>` (no JWT template)
- Supabase verifies via Clerk JWKS
- RLS via SQL fn `current_clerk_user_id()` → `auth.jwt() ->> 'sub'`

**Brand-research flow (full create)**
1. POST `/api/brands` → idempotency check → rate-limit check → admin client inserts `brands` + `brand_research_jobs` → enqueues BullMQ job
2. Railway worker → `extractBrandProfile` + `findCompetitors` + `generateSEOBundle` → writes back via admin client (stages: fetching_site → extracting_profile → finding_competitors → generating_seo → finalizing)
3. Browser `SupabaseProvider` subscribes via Realtime (carries Clerk JWT)
4. `/brands/[id]` server component reads via user-authed client → RLS scopes to owner

**Brand-research retry flow**
1. POST `/api/brands/[id]/retry` → auth + ownership check (404 on non-owner, no existence leak) → refuse if `status === 'researching'` (409) → shared rate-limit bucket with create (10/hr)
2. Reset latest `brand_research_jobs` row in place (status=queued, progress=0, error_message=null, completed_at=null; logs preserved)
3. Flip `brand.status` → pending so UI swaps out of failure card before Realtime fires
4. **`queue.remove(researchJobId)` BEFORE `queue.add(..., { jobId: researchJobId })`** — required because BullMQ dedupes by jobId and would return the prior failed-set entry instead of enqueueing
5. On client success: `onRetried()` callback updates parent `brand` + `job` state immediately

**Content-generation flow**
1. POST `/api/content/generate` → auth + 20/hr rate-limit + verify brand owned + brand.profile not null (409 if missing) + optional pillar-belongs-to-brand check → inserts placeholder `content_items` row (body=null, status=draft) + `content_generation_jobs` row → enqueues BullMQ `content-generation` job
2. Railway worker (separate Worker instance, same process) → 3-step pipeline (preparing_prompt → generating → finalizing) → calls `generateContentPiece()` with brand profile + voice + audience + optional pillar + optional userPrompt → writes `title`/`preview`/`body` back to `content_items`, `engagement` jsonb carries `hashtags`/`cta`
3. Browser `/content/generate` subscribes via Realtime to BOTH `content_generation_jobs` AND `content_items` (separate channel) → live progress + log feed + inline output display + copy button
4. `/content/[id]` server component reads via user-authed client → RLS via brand_id traversal scopes to owner

**Defensive layers**
- `isHeaderSafe()` — RFC 7230 no-CR/LF/CTL check on every env value at boot
- `safeToken()` — strict JWT regex
- `tryCreateClient()` — try/catch around `createClient`, falls back to anon
- `safe<T>()` wrapper on every public db query
- `withTimeout()` + `withRetry()` around every Gemini call (90s timeout, 3 attempts, exponential 1s→2s→4s capped 5s)
- Idempotency cache (Redis, 24h TTL)
- Rate limit (Redis ZSET sliding window) — separate buckets per route
- Stuck-job recovery sweep at worker boot + on stalled events
- Domain allowlist (`@ottoflow.ai` only)
- Global ErrorBoundary + segment ErrorBoundary
- **Root layout `auth()` wrapped in try/catch** — favicon and other static paths bypass middleware and would otherwise throw Clerk's "no middleware detected" on every request

**Observability bridge**
- `src/lib/observability.ts` — vendor-neutral shim; handler state on `globalThis.__ottoflow_observability__` so it survives Next.js per-route bundling
- Console.error path preserved unconditionally

---

## Key Decisions

- **Clerk free plan + app-layer domain allowlist** — `ALLOWED_EMAIL_DOMAINS` defaults to `ottoflow.ai`, enforced in `layout.tsx`
- **GitHub identity** — `josephottoflow` for all commits
- **Railway build** — `nixpacks.toml` overrides all phases; `railway.json` builds worker only
- **Node 22** on Railway (Node 20 lacks native WebSocket)
- **Idempotency + rate limit in Redis** (not DB) — staging acceptable
- **Gemini structured-output two-mode branch** — strict (responseMimeType + responseSchema) when no tools; lenient (schema-in-prompt + code-fence-strip) when tools used. Gemini disallows both
- **Icons across RSC boundary** — pre-rendered JSX, not function refs
- **Worker bundle externalizes `@sentry/node` + `@opentelemetry/*`** — OTel instrumentations load via dynamic require()
- **Observability shim has no `@sentry/*` imports** — keeps worker bundle free of `@sentry/nextjs`
- **Handler state on globalThis** — Next.js per-route bundling duplicates module-level `let`; verified bug in prod
- **One Sentry DSN for all three runtimes** (Next server / Next client / Edge / worker) — each tagged via `runtime:` so filterable
- **Sensitive env vars are runtime-only on Vercel** — `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`/`GOOGLE_API_KEY`/etc are Sensitive (read at runtime). `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` MUST be non-Sensitive because `withSentryConfig`'s webpack plugin reads them at build time
- **Sensitive vars can't be toggled or rotated** in Vercel — delete + recreate is the reliable path. Vercel's Rotate dialog has been buggy in our experience
- **`/monitoring` tunnel route added to middleware public matcher** — Clerk would otherwise redirect browser Sentry POSTs to `/sign-in`
- **BullMQ jobId = research-job UUID** for brand research, content_generation_jobs UUID for content — for tracing consistency. Means retry MUST call `queue.remove()` before `queue.add()`
- **Brand profile written early in brand pipeline** — preserved even if later stages (competitors, SEO) fail
- **Two BullMQ Worker instances** rather than job-name multiplexing — independent scaling, one stuck queue doesn't stall the other
- **Content can be generated direct-against-brand** (no Project required) — migration 003 added `content_items.brand_id` direct link; RLS policy accepts either brand_id or project_id traversal
- **`content_items.engagement` jsonb is a union** — legacy `{likes, shares, comments}` OR AI-generated `{hashtags?, cta?}`. Detail client uses `'in'` narrowing per item

---

## Completed Work — This Session

### Sentry Activation (commits `096fb85` → `604814e`)
- Vendor-neutral observability shim with `globalThis` singleton fix
- DSN deployed: Vercel `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (Sensitive, Production+Preview), Railway `SENTRY_DSN`
- Verified end-to-end via `/api/debug/sentry-test`: SDK active, shim wired, events flushed, release auto-tagged

### Bugs caught + fixed via Sentry-driven discovery
- **`d4c290b`** — middleware was protecting `/monitoring` tunnel; every browser-side capture would have redirected to sign-in
- **`604814e`** — observability shim's module-level handler state didn't survive Next.js bundling; backed with `globalThis.__ottoflow_observability__`
- **`84d3697`** — root layout `auth()` threw on favicon requests (~1 event/fetch, 12 unhandled in Sentry). Wrapped in try/catch

### Sentry skill audit
- `instrumentation.ts` exports `onRequestError = Sentry.captureRequestError` ✓
- `tracesSampleRate` bumped 0.05 → 0.1 (`58e3afc`)
- Source-map upload still pending (env vars need Sensitive=OFF — paused)

### Full UI button audit + wiring (commits `e6b73f7`, `63f6263`)
11 dead buttons surfaced via JS DOM enumeration; all now navigate or surface honest disabled state.

### Brand retry flow (commits `de3457f`, `7e77ccb`, `76b440e`)
- POST `/api/brands/[id]/retry` — full implementation
- Retry Research button on FailureCard with loading + inline error states
- `onRetried` callback so client state mirrors DB mutation immediately
- **BullMQ remove-before-add fix** — without this the worker silently skipped the retry

### Google API key rotation
- Vercel `GOOGLE_API_KEY` delete + recreate (Rotate dialog wasn't accepting values; pivoted)
- Railway `GOOGLE_API_KEY` in-place edit
- Verified live: `/api/debug/health` 8/8 in 955ms, Gemini "pong" in 586ms

### End-to-end brand-pipeline validation
- Linear brand → Failed (503) → retry with new key → Researching → **Ready**
- Full Gemini output: profile, positioning, 6 value props, 4 pricing tiers, competitors (7), audience/ICP, personas, voice (TONE/DO/DON'T), pains, channels

### Content Pipeline MVP (commits `ad23ca2`, `ab2d3dd`, `4e9ee9f`)
- **Migration `003_content_pipeline.sql`** — `content_generation_jobs` table (mirrors `brand_research_jobs` schema), `append_content_log()` SQL helper, `content_items.brand_id` + `user_prompt` columns, RLS policies on both
- **`src/lib/queue.ts`** — new `content-generation` queue + `ContentGenerationJobData` payload + `contentGenerationQueue()` helper
- **`src/lib/gemini.ts`** — `generateContentPiece()`: platform-aware prompt builder (LinkedIn 1500-2200 chars, Twitter 240-280, Blog 2500-4000, etc.), pulls brand profile + voice + audience as context, optional content_pillar steering, optional user prompt override
- **`worker/processors/content-generation.ts`** — 3-step processor (preparing_prompt → generating → finalizing)
- **`worker/index.ts`** — second BullMQ Worker instance, full lifecycle (active/completed/failed/stalled/error handlers, Sentry capture). Shutdown closes both workers in parallel
- **`POST /api/content/generate`** — auth + 20/hr rate limit + ownership + pillar-belongs-to-brand check + creates placeholder content_item + content_generation_jobs row + enqueues BullMQ. Returns IDs for client subscription. `captureFallback` on enqueue failure
- **`/content/generate` page** — gated on at least one ready brand; otherwise helpful empty state with deep link to /brands/new
- **`ContentGenerateClient`** — brand dropdown with industry hint, 6 platform cards (icon + length hint), optional topic textarea (500-char cap), live progress with Realtime subscription on both job AND item rows, inline output display with copy button, failure card with Try again, "Generate another" reset
- **`/content` list page wired** — Run Pipeline (was disabled+Soon) → Link to `/content/generate`; Continue Pipeline → same; empty state CTA "Generate your first piece"
- **`/content/[id]` detail page** — SSR fetch via user-authed Supabase client (RLS via brand_id), `ContentItemDetailClient` with header (platform + status + brand link + timestamp), user prompt block, preview with left-border accent, full body whitespace-preserved, Copy all (assembles title + preview + body + hashtags + CTA), hashtag chips, suggested CTA, "Generate another →" footer
- **`/content` cards now clickable** — wrapped in `<Link href={`/content/${item.id}`}>`. Verified two drafts open detail view with full body

### End-to-end content-pipeline validation
- Two pieces of brand-authentic content generated for Linear in production:
  - LinkedIn (open-ended): *"Engineered for Velocity: Reclaim Your Team's Focus"*
  - Blog (user-prompted): *"Unlock Engineering Velocity: The Async-First Playbook"* — preview explicitly names async standups, decision logs, focused communication
- Worker completed first job in 18.184s; second job similar
- Both visible in `/content` list, both clickable → full body renders on `/content/[id]`

### Diagnostic endpoints (remove pre-public-beta)
- `/api/debug/auth` — Clerk JWT + Supabase RPC
- `/api/debug/raw` — hand-built fetch to PostgREST bypassing supabase-js
- `/api/debug/rls-test` — admin vs user-authed count comparison
- `/api/debug/cleanup` — delete known-orphan brand rows (hardcoded IDs)
- `/api/debug/health` — 8-check comprehensive connection probe
- `/api/debug/sentry-test` — three-level Sentry probe (SDK / shim / event flow)
- `/api/debug/failed-jobs` — read DB record of non-completed jobs

---

## Outstanding Tasks

| # | Status | Task |
|---|---|---|
| #30c | pending | Rotate Railway Redis password — Vercel env var still old |
| #11/#13 | pending | Wire Sentry source-map upload: paste `SENTRY_AUTH_TOKEN` + `SENTRY_ORG=ottoflow` + `SENTRY_PROJECT=javascript-nextjs` to Vercel with **Sensitive=OFF** (build-time access required), redeploy |
| #18 | pending | Wire Analytics page to real DB — `getAnalyticsData()` is mock |
| #21 | pending | Build `/api/generate` SSE route + video worker — currently 404 (client handles gracefully via captureFallback) |
| #34 | pending | Polish: Gemini blog output mixes HTML tags (`<ul><li>`) with markdown (`##`) — tighten prompt to "markdown only" OR render body via markdown parser |

---

## Known Issues / Out of Scope

1. **`/api/debug/*` endpoints exposed** — auth-gated but remove pre-public-beta (7 endpoints)
2. **142 pre-existing TS errors** in `worker/processors/brand-research.ts`, `src/agents/*`, `src/app/studio/page.tsx`. Vercel build pipeline ignores them
3. **Source-map upload not wired** — stack traces show minified code; Sentry "Unminify Code" button shown on every frame
4. **Blog body has literal `<ul><li>` HTML tags** in production output — content readable but visually messy until prompt or renderer fix lands
5. **`/content` Pipeline Workflow diagram is static** — steps 5–7 always grey regardless of actual content state. Cosmetic
6. **Out of scope (deferred to v1)**:
   - `/billing` — Stripe integration
   - `/settings` — full UI (Clerk manages core)
   - `/video` Run buttons (workers not yet wired)
   - `/projects` — no brand-to-project flow
   - Content Strategy Engine, UGC, Veo, Real Estate Mode
   - Content retry endpoint (POST /api/content/[id]/retry) — not yet built
   - Content edit / approve / publish workflow stages
   - "Send to Video Pipeline" CTA on video-script content

---

## Constraints / Standing Orders

**Security**
- DO NOT paste secret values into chat — user pastes themselves; confirm "captured"
- Mask GitHub PAT in `git remote -v` output: `sed 's,://[^/]*@,://***@,'`
- Never skip git hooks (`--no-verify`) or bypass signing unless explicitly requested
- Cannot enter API keys/passwords/credentials into form fields — user must paste
- All commits authored as `josephottoflow`
- Exception: Sentry DSN is semi-public (NEXT_PUBLIC_ inlined into browser); can be handled inline

**Scope**
- DO NOT start new feature development beyond agreed scope without explicit /goal direction
- UI polish + ops endpoints (retry, debug) are in scope under "production quality"
- Content + Video pipelines are now active scopes (user explicitly directed Content Pipeline build via /goal)

**Commit conventions**
- Conventional commits: `feat(scope):`, `fix(scope):`, `chore(scope):`, `docs(scope):`
- Always include `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
- Pass commit messages via heredoc

---

## Critical File Paths

```
ottoflow-ai/
  nixpacks.toml                          NIXPACKS_NODE_VERSION=22
  railway.json                           buildCommand: npm run build:worker
  next.config.ts                         withSentryConfig, tunnelRoute "/monitoring"
  sentry.server.config.ts                @sentry/nextjs (nodejs runtime)
  sentry.edge.config.ts                  @sentry/nextjs (edge runtime)
  src/
    instrumentation.ts                   Next 15 register() + onRequestError export
    instrumentation-client.ts            Next 15.3+ client init
    middleware.ts                        Clerk auth gate; /monitoring + favicon in public matcher
    app/
      layout.tsx                         try/catch around auth() for static-asset paths
      page.tsx                           Dashboard, Reports + New Project linked
      error.tsx, global-error.tsx        ErrorBoundary
      unauthorized/page.tsx
      billing/, settings/, help/         Placeholder
      brands/
        page.tsx                         List
        new/page.tsx                     Form → POST /api/brands
        [id]/page.tsx                    SSR fetch
        [id]/BrandDetailClient.tsx       Realtime + FailureCard with Retry Research
      content/
        page.tsx                         SSR fetch list
        ContentPageClient.tsx            Configure→/settings, Run Pipeline→/content/generate, item cards linked
        generate/page.tsx                Server: list ready brands
        generate/ContentGenerateClient   Form + live progress + inline output + copy
        [id]/page.tsx                    SSR fetch single item (RLS by brand_id)
        [id]/ContentItemDetailClient     Full body + copy-all + brand link + user prompt
      video/VideoPageClient.tsx          Configure + Generate Video links
      video/generate/page.tsx            SSE consumer, captureFallback in catch
      projects/ProjectsPageClient.tsx    + New Project disabled
      analytics/page.tsx                 Read-only (mock data still)
      api/
        brands/route.ts                  POST: idempotency + rate limit + create
        brands/[id]/retry/route.ts       POST: auth + own + reset + queue.remove + queue.add (202)
        content/generate/route.ts        POST: auth + rate limit + brand-profile-required + enqueue (202)
        debug/{auth,raw,rls-test,cleanup,health,sentry-test,failed-jobs}/route.ts
    lib/
      env.ts, worker-env.ts              Zod + isHeaderSafe
      supabase-server.ts                 safeToken + isHeaderSafe + tryCreateClient → instrumented
      supabase.ts                        Admin client
      db.ts, db-brands.ts                safe()-wrapped → instrumented
      domain-allowlist.ts
      rate-limit.ts, idempotency.ts      Redis-backed
      queue.ts                           BullMQ singletons + 2 queues + getRedisClient
      gemini.ts                          withTimeout/withRetry + breadcrumbs + exhaustion capture + generateContentPiece()
      observability.ts                   Vendor-neutral shim, globalThis singleton
    components/
      Sidebar.tsx                        Clerk UserButton bottom-left
      SupabaseProvider.tsx               Clerk JWT to Realtime
  worker/
    index.ts                             Boot: dotenv → env → observability → Redis → recovery → 2 Workers (brand-research + content-generation)
    observability.ts                     @sentry/node init + flushSentry
    build.mjs                            esbuild bundler; externalizes @sentry/node + @opentelemetry/*
    recovery.ts                          Stuck-job sweep + stall handler
    processors/
      brand-research.ts                  5-step pipeline → brands.profile + competitors + keywords + pillars
      content-generation.ts              3-step pipeline → content_items.title/preview/body + engagement(hashtags,cta)
  supabase/migrations/
    001_initial.sql                      projects/content/render_jobs, current_clerk_user_id()
    002_foundation.sql                   brands(user_id), brand_research_jobs(status check + logs jsonb)
    003_content_pipeline.sql             content_generation_jobs, append_content_log(), content_items.brand_id/user_prompt, RLS via brand_id traversal
  docs/
    PROJECT_MEMORY.md                    THIS FILE
```

---

## Recent Commits (newest first)

```
4e9ee9f  feat(content): clickable content-item detail page
ab2d3dd  fix(gemini): correct BrandProfile field names in generateContentPiece
ad23ca2  feat(content): MVP content pipeline — pick brand + platform → ready draft
76b440e  fix(brands/retry): remove existing BullMQ job before re-adding
7e77ccb  fix(brands): update local state immediately on retry success
de3457f  feat(brands): add /api/brands/[id]/retry + Retry Research button
63f6263  fix(ui): wire the four remaining dead buttons surfaced by click-test
e6b73f7  fix(ui): wire 7 dead buttons across all routes
84d3697  fix(layout): guard root auth() so favicon requests stop throwing
58e3afc  chore(sentry): bump default tracesSampleRate 0.05 → 0.1
39b1ccc  fix(debug/failed-jobs): correct brand column name (user_id)
2eba4e2  feat(debug): /api/debug/failed-jobs — read DB record of failed jobs
be407b8  docs(memory): Sentry activated → 100/100 readiness
604814e  fix(observability): back handler state with globalThis singleton
08d7cf5  fix(debug/sentry-test): three-level diagnosis (SDK / shim / events)
d4c290b  fix(middleware): exclude /monitoring tunnel from Clerk auth gate
d9721d9  feat(debug): /api/debug/sentry-test — Sentry activation probe
096fb85  feat(observability): wire Sentry scaffolding for Next + worker
```

---

## Sentry Architecture Reference

**Activation status:** ✅ Live. DSN set on Vercel + Railway.

**Singleton storage:** Handler state on `globalThis.__ottoflow_observability__`, not closures. Mirrors how `@sentry/nextjs` keeps its own client global.

**Tunnel route:** `/monitoring` via `withSentryConfig`; `middleware.ts` public matcher includes `/monitoring(.*)`.

**Capture labels (stable, used for Sentry grouping)**
- `gemini.call.exhausted` — Gemini retries exhausted (model/timeout/maxRetries context)
- `supabase-server.token.shape_invalid` — Clerk getToken() returned non-JWT
- `supabase-server.token.header_unsafe` — JWT passed regex but failed RFC 7230
- `supabase-server.auth_header.unsafe`
- `supabase-server.createClient.threw`
- `supabase-server.clerk_getToken.threw`
- `db.<queryName>.threw` — any db.ts safe() catch
- `db-brands.<queryName>.threw` — any db-brands.ts safe() catch
- `brands.retry.enqueue_failed` — server-side BullMQ enqueue throw during retry
- `brands.retry.client_failed` — client-side fetch error during retry
- `content.generate.enqueue_failed` — server-side BullMQ enqueue throw during content generation
- `content.generate.client_submit_failed` — client-side fetch error during content submit
- `video.generate.failed` — /video/generate catch (provider, sceneCount, style, vibe, promptLength)
- `sentry.activation.test` / `.direct` — manual probe

**Breadcrumbs**
- `gemini.retry` — every retry attempt with attempt number, retryable bool, error message

**Tags**
- `runtime`: `nextjs-node` | `nextjs-edge` | `nextjs-client` | `worker`
- `fallback.label` — stable label above
- Worker job failures also tag `queue`, `job.id`, `brand.id`

**Sample rate** — `0.1` default, env-tunable

**Source-map upload** — Opt-in via `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`. Must be **non-Sensitive** on Vercel (Sensitive = runtime-only, build can't see them). Token already generated from "Vercel Source Maps" internal integration with Project:Read&Write + Release:Admin + CI scopes

---

## Sentry Issue Reference

| ID | Title | Status |
|---|---|---|
| JAVASCRIPT-NEXTJS-1 | TypeError in sentry/scripts/views.js | 1 event, SDK glitch |
| JAVASCRIPT-NEXTJS-2 | Clerk: auth() was called but Clerk can't detect | **Fixed by `84d3697`**, stuck at 12 events (no growth) |
| JAVASCRIPT-NEXTJS-3 | Sentry activation probe — direct path | Intentional probes |
| JAVASCRIPT-NEXTJS-4 | ServerError 503 (Gemini) from worker | `fallback.label:gemini.call.exhausted`, `runtime.name:node` — validates worker bridge |

---

## Next Steps

1. **Polish content body rendering** (#34) — tighten Gemini blog prompt to "markdown only, no HTML" OR pipe body through markdown parser
2. **Finish secret rotations** — Task #30c (Railway Redis password → update Vercel REDIS_URL)
3. **Wire source-map upload** — paste `SENTRY_AUTH_TOKEN` + `SENTRY_ORG=ottoflow` + `SENTRY_PROJECT=javascript-nextjs` to Vercel with **Sensitive=OFF**, redeploy
4. **Optional polish on Content Pipeline**
   - Content retry endpoint POST `/api/content/[id]/retry` (mirror brand retry pattern)
   - Approve / Publish workflow stages
   - "Send to Video Pipeline" CTA when platform is video-script-like
5. **Decision point** — promote to limited-access staging (5–10 users), monitor Sentry + retry flows + Gemini availability for 7 days
6. **Pre-public-beta cleanup** — remove 7 `/api/debug/*` endpoints, address 142 pre-existing TS errors
7. **v1 work (out of current scope but tracked)** — `/api/generate` SSE route + video worker (#21), Analytics real DB (#18), Stripe billing, project creation flow
