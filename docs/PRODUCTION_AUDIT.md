# Ottoflow AI — Production Readiness Audit

**Subsystem under review:** Brand Research Engine
**Audit date:** 2026-05-30
**Verdict:** Not yet production-ready. **6 deployment blockers** + **10 high-severity** issues must be addressed before going live.

This audit is grounded in actual code, with file:line references. Each finding lists what's wrong, the impact, and the recommended fix. Findings are grouped by severity.

---

## Executive summary

The Brand Research Engine **works in local single-user development** because RLS is permissive when there's only one user and Realtime is bypassed by the local Supabase emulator. In production, **three classes of bugs will surface immediately:**

1. **RLS will silently break Realtime subscriptions** — live progress won't update; the UI freezes at "queued" until manual refresh.
2. **RLS will silently break the dashboard / projects / analytics pages** — they query through the anonymous client and will return empty data.
3. **The worker can't deploy to Railway as-configured** — `tsx` is in `devDependencies`; `npm install --omit=dev` (Railway default) won't install it.

Additionally, the system has **no observability, no env validation, no rate limiting, no Gemini timeouts, no idempotency, and no stuck-job recovery.** Each of these is a real-world incident waiting to happen.

The good news: the data model is sound, the worker pattern is correct, the Clerk-Supabase bridge is wired correctly, and most fixes are small and contained.

---

## 🟥 BLOCKERS — cannot deploy to production until fixed

### B1. Realtime subscriptions don't carry the Clerk JWT — live progress will silently break under RLS
**File:** `src/app/brands/[id]/BrandDetailClient.tsx:22, 66-93`
**Status:** Critical. The whole "live progress" feature is broken in prod.

The client imports the anonymous `supabase` browser client and subscribes to `brand_research_jobs` via Postgres Changes. With RLS enabled on that table (which we do enable in `002_foundation.sql:122`), Supabase Realtime drops change notifications the anon user can't `SELECT`. Result: subscription stays open, `subscribe()` succeeds, but no events ever arrive. The UI shows "Queued" forever and the user has to manually refresh.

**Fix:** Use the browser Clerk session to obtain a Supabase token, then call `supabase.realtime.setAuth(token)` on the client BEFORE subscribing. Refresh the token when Clerk rotates it. Pattern:

```ts
// In a "use client" file
import { useSession } from "@clerk/nextjs";
const { session } = useSession();
useEffect(() => {
  if (!session) return;
  (async () => {
    const token = await session.getToken({ template: "supabase" });
    if (token) supabase.realtime.setAuth(token);
  })();
}, [session]);
```

Same fix applies to the post-completion reads on lines 107-115 (those also go via anon client).

---

### B2. Dashboard / projects / analytics pages query as anonymous → empty data in prod
**Files:**
- `src/lib/db.ts:21-26` (`hasSupabase()` mock fallback + anon client used for every read)
- `src/app/page.tsx:25-30` (calls `getProjects`, `getActivity`, `getRenderJobs`, `getKPISummary`)
- `src/app/projects/page.tsx`, `src/app/analytics/page.tsx`, `src/app/projects/[id]/page.tsx`

The functions in `db.ts` use the anonymous `supabase` export from `src/lib/supabase.ts`. With RLS on `projects`, `content_items`, `render_jobs`, `activity`, every query returns `[]`. The dashboard will show all zeros for every signed-in user. CLAUDE.md already flags this as the active sprint, but it's a deployment blocker — users will sign up, see an empty app, and bounce.

**Fix:** Convert these reads to use `createServerSupabaseClient()` (from `supabase-server.ts`) inside server components. Delete `hasSupabase()` and the mock fallback. (Already spawned as a separate task; promote to "must complete before deploy.")

---

### B3. `tsx` is in `devDependencies` — Railway worker won't start with default `npm install`
**File:** `package.json:38` (`"tsx": "^4.19.2"` under `devDependencies`)

The worker is started with `npm run start:worker` → `tsx worker/index.ts`. Railway's default install is production-only (`NPM_CONFIG_PRODUCTION=true`) which skips devDependencies. The worker process will fail to launch with `command not found: tsx`.

**Fix:** Either:
- Move `tsx` to `dependencies`, OR
- Pre-compile the worker to JavaScript (`tsc --project worker/tsconfig.json`) and run `node worker/dist/index.js`, OR
- Set `NPM_CONFIG_PRODUCTION=false` on Railway (less standard, makes worker image bigger).

Recommend the compile-to-JS approach for production. Less surface area, faster startup.

---

### B4. Worker imports paths via `@/*` alias — only resolved by `tsx` / Next, not by plain Node
**File:** `worker/index.ts:18-19`, `worker/processors/brand-research.ts:13-19`

The worker imports `@/lib/queue` and `@/lib/supabase`. `tsx` resolves these via tsconfig paths; a compiled Node build does not unless you ship `tsconfig-paths` and register it (`-r tsconfig-paths/register`), or rewrite imports relative, or use a bundler.

**Fix:** Same as B3 — either keep `tsx` in deps with paths registration, or bundle the worker with `esbuild` / `tsup`. Bundling is recommended (single-file output, deterministic deploys, no node_modules surprises).

---

### B5. `process.env.NEXT_PUBLIC_SUPABASE_URL` falls back to a placeholder — app boots in misconfigured prod, silently 500s every request
**File:** `src/lib/supabase.ts:6-7`, `src/lib/supabase-server.ts:5-6`

To unblock `next build` (added under deadline), we fall back to `"https://placeholder.supabase.co"` when the env var is missing. In production, if the Vercel env var is misnamed or missing, the app boots, the build succeeds, and the first user request returns a confusing DNS error from Supabase — not "Misconfigured."

**Fix:** Add an env validator (`src/lib/env.ts` using zod) that runs at module-load and throws immediately if required vars are missing. Keep the placeholder ONLY for the build phase by detecting `process.env.NEXT_PHASE === "phase-production-build"`. Same fix needed in the worker.

Required vars per process:
- **Next.js (Vercel):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `REDIS_URL`
- **Worker (Railway):** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `GOOGLE_API_KEY`

---

### B6. `dotenv` order in worker is fragile — `getRedis()` evaluates at first import, before env is guaranteed
**File:** `worker/index.ts:13-19`

Currently:
```ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { Worker } from "bullmq";
import { getRedis, ... } from "@/lib/queue";
```

This works because of ESM hoisting — the imports execute AFTER the `loadEnv` calls at runtime. But the order is non-obvious and easy to break. Worse, on Railway there's no `.env.local` — env comes from the platform. dotenv silently fails (correct) but means the first `npm run start:worker` developer who tests locally with missing env gets a Redis error from inside getRedis() with no helpful prefix.

**Fix:** Make env loading explicit (`src/lib/env.ts` first import) and have `getRedis()` throw a typed `MissingEnvError("REDIS_URL")` with a remediation hint.

---

## 🟧 HIGH-SEVERITY — production stability / security

### H1. No idempotency on `POST /api/brands` — double-clicks create duplicate brands
**File:** `src/app/api/brands/route.ts:15-109`

Two rapid POSTs (network retry, user double-click) create two brand rows + two research jobs + two BullMQ jobs. The user pays for two Gemini runs and sees one brand listed twice with race-condition mid-states.

**Fix:** Accept an optional `Idempotency-Key` header. Store it on the brand row with a unique index `(user_id, idempotency_key)`. Return `200` with the existing brand on collision. Alternatively, server-side: hash `{userId, name, website}` and reject if a brand with that hash exists within the last 60s.

---

### H2. No rate limiting anywhere — Gemini cost runaway risk
**Files:** `src/app/api/brands/route.ts` and all other route handlers

A signed-in user can POST `/api/brands` in a tight loop. Each fired job costs ~3-5 Gemini calls. At Flash 2.5 pricing × Google Search grounding × URL Context, an attacker (or buggy client) can rack up hundreds of dollars in minutes.

**Fix:** Add per-user rate limit on `POST /api/brands`: 5 brands per hour, 30 per day. Use Upstash Ratelimit (free tier, same Redis you already have):
```ts
import { Ratelimit } from "@upstash/ratelimit";
const rl = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "1 h") });
const { success } = await rl.limit(`brands:${userId}`);
if (!success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
```

---

### H3. No Gemini call timeout — hung calls eat worker slots indefinitely
**File:** `src/lib/gemini.ts:155-179` (`generateStructured`)

`ai.models.generateContent()` has no timeout. A Gemini hang or slow-response burns one of `WORKER_CONCURRENCY` (default 2) worker slots forever. BullMQ's `lockDuration` (default 30s) only protects against worker crashes, not slow callees.

**Fix:** Wrap with explicit timeout:
```ts
const timeout = Number(process.env.GEMINI_TIMEOUT_MS ?? 90_000);
const resp = await Promise.race([
  ai.models.generateContent({...}),
  new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Gemini timeout after ${timeout}ms`)), timeout)),
]);
```
Plus a retry with exponential backoff on 429 / 5xx errors.

---

### H4. No DLQ / stuck-job recovery — jobs in `running` state stay stuck if worker dies mid-flight
**Files:** `src/lib/queue.ts:43-48`, `worker/index.ts`

When a worker process is killed mid-job (Railway redeploy, OOM, network blip), the `brand_research_jobs` row stays at `status='running'` indefinitely. The UI shows "Researching" forever. BullMQ does handle the BullMQ-side job state (stalled-job detection) but our Postgres state is independent.

**Fix:** Two parts:
1. On worker startup, run a recovery query: `UPDATE brand_research_jobs SET status='failed', error_message='Worker restarted while processing' WHERE status='running' AND started_at < now() - interval '15 minutes'`.
2. Listen for BullMQ's `stalled` event in `worker/index.ts` and write the failure to Postgres.

---

### H5. No per-job timeout on BullMQ — combined with H3, a single bad website can block the queue
**File:** `src/lib/queue.ts:43-48`

`defaultJobOpts` sets `attempts: 2` but no overall timeout. Combined with H3, a poison-pill website can be retried twice, each taking unbounded time.

**Fix:** Add a watchdog inside `processBrandResearch`. Per-step soft timeouts (60s fetch, 90s extraction, etc.) with a hard ceiling of 5 min total. Mark as failed and don't retry on timeout.

---

### H6. `/api/generate` route has no Clerk auth check + depends on a separate parent app running
**File:** `src/app/api/generate/route.ts:22-46`

This is the legacy SSE proxy to the root TikTok-factory app on port 3000. In production it'll either 404 (parent not deployed) or proxy to an arbitrary URL controlled by `PIPELINE_API_URL`. While `middleware.ts` protects the route, the route itself doesn't check `userId` and stores `projectId` from the request body without verifying ownership.

**Fix (for prod):** Either gate the route behind a feature flag (return 503 until the video pipeline lands), or remove it entirely from the Vercel deployment. Don't ship a route that depends on a process we're not deploying.

---

### H7. Service-role key is held in every API route process — broad RLS-bypass blast radius
**Files:** `src/app/api/brands/route.ts:37`, `worker/processors/brand-research.ts:42`

`createAdminClient()` uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS for everything in the schema. The route uses admin only to insert a brand row keyed to the authenticated `userId` (which is fine), but a future code-injection bug (or careless `select('*').from('brands')`) would leak across tenants.

**Fix:** Inserts that set `user_id` from Clerk JWT can use the user-scoped server client (`createServerSupabaseClient`) — RLS will reject if `user_id` doesn't match `auth.jwt() ->> 'sub'`. Reserve the admin client for the worker only. For the API route, the only operations needing admin are setting `bull_job_id` after enqueue — that can also go through the user-scoped client since RLS allows the user to update their own brand's research jobs.

---

### H8. `brand_research_jobs.logs` jsonb grows unbounded — every Realtime UPDATE ships the full row
**File:** `supabase/migrations/002_foundation.sql:42-58` + `append_research_log` SQL function

Each research run currently appends ~10-15 log entries. Fine. But:
1. The whole row (including the `logs` array) is sent on every Realtime UPDATE. With longer runs or retries, payload size grows quadratically.
2. There's no cap. A worker bug that loops would fill the column.

**Fix:** Cap `logs` at the last 100 entries inside the SQL function:
```sql
update brand_research_jobs
   set logs = (logs || jsonb_build_array(entry))
              #> '{}' /* trim if needed */
 where id = job_id;
```
Or move logs to a separate `brand_research_logs` table with one row per entry, and subscribe to inserts via Realtime. Cleaner long-term.

---

### H9. Placeholder Supabase URL allows app to "succeed" in misconfigured production (same root cause as B5, called out separately because of its security impact)
**File:** `src/lib/supabase.ts:6-7`

If the `NEXT_PUBLIC_SUPABASE_*` env vars aren't set in Vercel, the app boots and sends requests to `placeholder.supabase.co`. That domain is currently NXDOMAIN, but if anyone registers it, **every misconfigured deployment would leak request data including JWTs to a third party.** Low probability but high blast radius.

**Fix:** Same as B5 + add a deploy-time check: in `next.config.ts`, throw if `NEXT_PUBLIC_SUPABASE_URL` matches the placeholder.

---

### H10. No webhook for Clerk user lifecycle — orphaned brand rows when a user is deleted
**Files:** none yet (middleware allows `/api/webhooks(.*)` already but no handler exists)

When a user is deleted from Clerk, their brand rows stay in Postgres forever (no FK to a `users` table). Storage bloat, GDPR liability, and potential data leakage if user IDs are ever recycled (Clerk doesn't, but still).

**Fix:** Add `/api/webhooks/clerk/route.ts` to handle `user.deleted` events. Use `svix` for signature verification. Cascade-delete the user's brands.

---

## 🟨 MEDIUM-SEVERITY — operational quality

### M1. No observability — zero metrics, no error tracker, no cost tracking
**Files:** none

- No Sentry / Logflare / Datadog wiring.
- Worker logs go to `console.log(JSON.stringify(...))` — fine for `railway logs` but no aggregation, no alerts.
- Gemini calls don't capture `usageMetadata` (token counts), so we can't track per-brand cost.
- No request IDs / correlation IDs across web → queue → worker.

**Fix (Phase 5):** Add Sentry to both Next.js and the worker (`@sentry/nextjs`, `@sentry/node`). Capture token usage from each Gemini response and write to `brand_research_jobs.meta.usage`. Generate a correlation ID per `POST /api/brands` and propagate through job data → log lines.

---

### M2. Status enum is inconsistent with spec
**Files:** `supabase/migrations/002_foundation.sql:13, 33`, `src/lib/types.ts`

Spec calls for: `pending | queued | running | completed | failed`.
We have: `brand.status: pending | researching | ready | failed` + `brand_research_jobs.status: queued | running | done | failed`.

**Fix (Phase 3):** Rename `done` → `completed`, `ready` → `completed`, drop `researching` (derive from job status). Migration + type updates + UI labels.

---

### M3. No structured logger
**File:** `worker/index.ts:23-26`

`function log(scope, msg, extra)` is fine but has no levels, no request IDs, no easy way to filter. Should use `pino` (fast, structured) and add request-id propagation.

---

### M4. No worker healthcheck endpoint
**File:** `worker/index.ts`

Railway's default health check is "process is alive." If the worker process is alive but BullMQ is disconnected from Redis, jobs pile up unnoticed.

**Fix:** Add a tiny HTTP server in the worker exposing `/health` that returns 200 only if `getRedis().status === "ready"`. Configure Railway's healthcheck to hit it.

---

### M5. No retry-from-UI on failed jobs
**Files:** `src/app/brands/[id]/BrandDetailClient.tsx:240-256` (FailureCard has no action)

Users see "Research failed" with the error message but no way to retry. Only option is delete + recreate.

**Fix (Phase 4):** `POST /api/brands/:id/retry` that creates a new `brand_research_jobs` row and enqueues. Add a "Retry" button to FailureCard.

---

### M6. No cancellation flow
**Files:** none

Once a job is running, the user can't stop it. They might realize the website is wrong or they fat-fingered the name and want to abort.

**Fix:** `POST /api/brands/:id/cancel` that calls `bullJob.remove()` and updates the job to `cancelled` status. Add a "Cancel" button to ProgressCard.

---

### M7. PII / secret scrubbing in error messages
**Files:** `src/lib/gemini.ts:174-178` (raw text in error), `worker/processors/brand-research.ts:184-205` (error.message persisted)

`error.message` from Gemini can include the prompt (which is safe) but stack traces from SDK errors might include auth headers. We persist these to `brand_research_jobs.error_message` and display them to users.

**Fix:** Sanitize errors via a `scrubError(err)` helper before persistence: strip Authorization headers, redact API key patterns, truncate.

---

### M8. No CSP / security headers
**File:** `next.config.ts`

No Content-Security-Policy, X-Frame-Options, Strict-Transport-Security. Vercel adds some defaults; we should explicitly set them.

**Fix:** Add `headers()` to `next.config.ts` with at minimum CSP, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy.

---

### M9. Centralized env module missing
**Files:** scattered `process.env.X` access across `gemini.ts:14, 18`, `queue.ts:11`, `supabase.ts:5-7`, `supabase-server.ts:4-5`, `worker/index.ts:21`, `api/brands/route.ts` (none directly, fine)

Easy to miss a var in `.env.local.example` when adding new ones. No single source of truth.

**Fix:** `src/lib/env.ts` with zod schema; export `env` object; replace all `process.env.X` reads with `env.X`. Worker imports the same file.

---

### M10. Migration tracking missing
**Files:** `supabase/migrations/001_initial.sql`, `002_foundation.sql`

No `schema_migrations` table tracks which migrations have been applied. Re-running `002` against an already-migrated database is mostly idempotent (we used `create table if not exists`) but the `alter publication add table` block will fail noisily on `duplicate_object` (we catch this, but it's fragile).

**Fix:** Use Supabase CLI's `db push` workflow (it tracks history via `_supabase_migrations`), or add a simple tracking table + a runner script.

---

## 🟦 LOW / POLISH

- **L1.** `next.config.ts` build warning about workspace root — set `outputFileTracingRoot`.
- **L2.** `eslint@8` is end-of-life (warned during install). Bump to v9 after the rest stabilizes.
- **L3.** `recharts@2.15` is deprecated (warned during install). Defer; analytics page isn't on the critical path.
- **L4.** Build is collecting `/api/generate` page data even when not deployed — gate it behind an env flag or remove from the route tree.
- **L5.** `BrandDetailClient.tsx:106-117` re-fetches related data on `job.status === "done"` via the anon client; same RLS issue as B1.
- **L6.** Brand name not slugified / validated for uniqueness within a user's namespace (low — purely UX).
- **L7.** No timezone awareness in `formatRelative()` (in `src/lib/utils.ts`) — could show "in 3 hours" if the user's clock is off.
- **L8.** No optimistic locking on `brands.status` writes — concurrent worker + API updates can race (low — current flow is sequential).

---

## Mapping to your phase plan

| Phase | Items covered |
|---|---|
| **Phase 2 — Deployment Prep** | B3, B4, B5, B6, H6, H10, M9 + the new env / config guides |
| **Phase 3 — Status System UX** | B1 (must precede), M2, M5, M6, plus the per-step status UI you described |
| **Phase 4 — Error Handling** | H3, H5, H7, M5, M6, M7 |
| **Phase 5 — Observability** | M1, M3, M4 + cost tracking on Gemini |
| **Phase 6 — Deployment** | All blockers + an actual deployment checklist + runbook |
| **Phase 7 — Production Testing** | RLS multi-user tests (B1, B2, H7), failure-mode tests (H3, H4), load test for H2 / H8 |

---

## Recommended sequencing

Hard blockers in this order (each one unblocks the next):

1. **B5 + B6 + M9** — env validation (3-hour task; without this, the rest is debugging in the dark).
2. **B1** — Realtime RLS auth. Without this, Phase 3 is meaningless.
3. **B2** — Dashboard/projects/analytics RLS. Without this, the deploy looks broken.
4. **B3 + B4** — Worker build/deploy. Without this, Railway can't run the worker.
5. **H10** — Clerk webhook for user-delete (orphan cleanup; pair with B1/B2 since you're already in auth).

Then the high-severity batch:

6. **H1 + H2** — idempotency + rate limit (cost protection BEFORE first real user touches prod).
7. **H3 + H5** — Gemini timeout + per-job timeout.
8. **H4** — DLQ / stuck-job recovery.
9. **H7** — Tighten service-role usage.
10. **H8** — Cap log size / move to separate table.
11. **H6 + H9** — Decide what to do with `/api/generate` (recommend: remove from Vercel build).

Then Phase 5 observability (M1, M3, M4), then Phase 3 polish (M2, M5, M6), then Phase 7 test suite.

**Estimated effort to reach "deployable":** 2-3 focused days for the 6 blockers; another 2-3 days for the 10 high-severity items. Total ~1 week of focused work to ship a stable production Brand Research Engine.
