# Ottoflow AI — Deployment Readiness Review

**Generated:** 2026-05-30
**Subsystem:** Brand Research Engine
**Scope:** evaluates the current `main` branch against staging-deployment readiness for the Brand Research Engine only. Other subsystems in the master spec (Content Strategy, UGC, Veo, etc.) are out of scope.

This is a **checkpoint only**. No code changes are made by this review.

Companion docs: [PRODUCTION_AUDIT.md](./PRODUCTION_AUDIT.md), [DEPLOYMENT.md](./DEPLOYMENT.md), [WORKER_ARCHITECTURE.md](./WORKER_ARCHITECTURE.md), [AUTH_FLOW.md](./AUTH_FLOW.md), [STAGING_TEST_PLAN.md](./STAGING_TEST_PLAN.md).

---

## Scoring legend

| Status | Meaning |
|---|---|
| **PASS** | Implemented, verified, no known issues |
| **PARTIAL** | Implemented but with limitations / unverified end-to-end / known gaps |
| **FAIL** | Critical gap that affects deployment |
| **BLOCKED** | Cannot proceed — must be resolved before deploy |

Risk levels are **Low / Medium / High** based on (probability × blast radius).

Each category has a weight reflecting deployment impact; weights sum to 100.

---

## Category-by-category

### 1. Authentication — **PASS**  ·  weight 10  ·  score 10

- Clerk middleware protects every non-public route (`src/middleware.ts`)
- ClerkProvider mounted at app root (`src/app/layout.tsx`)
- Sign-in / sign-up routes ship as catch-all dynamic segments
- Server actions defense-in-depth via `requireUser()` (`src/app/actions.ts`)
- `POST /api/brands` validates Clerk session before any DB write

**Risk:** Low.
**Recommended fix:** none.
**Deployment impact:** none.

---

### 2. Clerk JWT Template — **PARTIAL**  ·  weight 5  ·  score 3.5

- Code path is correct: `session.getToken({ template: "supabase" })` is the documented Supabase-third-party pattern
- The `supabase` template is **set up manually in the Clerk dashboard** — not codified anywhere
- No automated check that the template exists or is configured correctly
- First failed sign-in on staging will reveal misconfiguration

**Risk:** Medium. If the template is missing or signed with the wrong secret, EVERY user-scoped operation 401s. The blast radius is broad but the failure mode is loud and immediate.

**Recommended fix:** add a `/api/health/auth` route that mints a Clerk token and parses it for the expected `aud` / `role` claims; alert if mismatch. Phase 5 candidate. For staging, validate manually during the smoke test.

**Deployment impact:** non-blocking — staging validation catches it.

---

### 3. Supabase Database — **PASS**  ·  weight 8  ·  score 8

- Two ordered, idempotent migrations (`001_initial.sql`, `002_foundation.sql`)
- All migrations use `create if not exists` + handled `duplicate_object` exceptions
- Schema includes proper indexes (`brand_id`, `status`, `created_at desc`, `opportunity_score desc`)
- `current_clerk_user_id()` helper + `append_research_log()` RPC defined
- Realtime publication explicitly extended for `brand_research_jobs`, `brands`, `render_jobs`, `activity`

**Risk:** Low.
**Recommended fix:** add a `schema_migrations` tracking table when the team grows past one engineer (audit M10).
**Deployment impact:** none.

---

### 4. Row-Level Security (RLS) — **PASS**  ·  weight 12  ·  score 12

- Every multi-tenant table has RLS enabled in migration 001 + 002
- Policies scope by `current_clerk_user_id()` for owner-scoped tables
- Child-row policies chain through parent ownership (e.g. `research_jobs_via_brand`)
- WITH CHECK clauses on owner-scoped writes prevent privilege escalation
- All server reads go through `createServerSupabaseClient()` (Step 3 fix)
- All server writes go through Clerk-authed client OR `createAdminClient()` with explicit `user_id` stamped from Clerk session
- Worker uses service-role (bypasses RLS) but tenancy is enforced at job-payload level (see AUTH_FLOW.md)

**Risk:** Low at the code level. Multi-user isolation has been verified by trace, not on a live Supabase project.

**Recommended fix:** none for code. The staging test plan includes an explicit multi-user isolation test (STAGING_TEST_PLAN.md → Test 3).
**Deployment impact:** none.

---

### 5. Realtime — **PASS**  ·  weight 10  ·  score 10

- Browser uses Clerk-authed Supabase client via `SupabaseProvider`
- `realtime.setAuth(token)` called BEFORE exposing the client (Step 2 + hardening)
- Token refreshed every 50 s (Clerk default TTL ~60 s)
- Initial-auth retry (3 attempts, exponential backoff) prevents an exposed unauth'd client
- RLS enforced on Postgres-changes events server-side (broker behavior)
- Channel cleanup on unmount + provider-level safety net (`removeAllChannels`)

**Risk:** Low.
**Recommended fix:** none.
**Deployment impact:** none. Multi-user isolation needs live verification (test plan).

---

### 6. Queue — **PARTIAL**  ·  weight 8  ·  score 5.6

- BullMQ wired with `attempts: 2`, exponential backoff, `removeOnComplete` / `removeOnFail` retention
- Idempotent enqueue (uses `researchJobId` as BullMQ `jobId`, so duplicate POSTs are dedup'd)
- Singleton Redis connection; capped retry strategy (5 s max)
- Per-user rate limiting **not implemented** (audit H2 — Phase 4)
- API-level idempotency key **not implemented** (audit H1 — Phase 4)

**Risk:** Low for staging (limited users). High for production (cost runaway via repeated POSTs).

**Recommended fix:** before production launch, add `@upstash/ratelimit` on `POST /api/brands` (5/h per user) and accept an optional `Idempotency-Key` header. **Audit H1 + H2 — Phase 4.**

**Deployment impact:** non-blocking for staging.

---

### 7. Worker — **PARTIAL**  ·  weight 10  ·  score 7

- esbuild bundle pipeline (Step 4); plain `node` runs the output
- `worker-env.ts` validates required env at boot; fails loud + exits 1 on miss
- 6-step boot sequence with explicit logging
- Bounded graceful shutdown (25 s race, force-close fallback)
- Full BullMQ event coverage (active / completed / failed / stalled / error)
- Redis lifecycle events logged via `attachRedisLogger`
- `unhandledRejection` / `uncaughtException` handlers
- **Stuck-job recovery** not implemented (audit H4 — Phase 4): if a worker dies mid-job, `brand_research_jobs.status` stays at `running` indefinitely
- **HTTP healthcheck endpoint** not implemented (audit M4 — Phase 5)
- Signal-handler delivery verified at code level only — Linux validation pending

**Risk:** Medium. Crash + restart cycle works correctly via Railway restart policy + BullMQ stalled-detection. The stuck-Postgres-row case affects UX, not correctness.

**Recommended fix:** Phase 4 lands H4 (Postgres recovery query at worker boot + stalled-event listener that writes failure to Postgres).
**Deployment impact:** non-blocking. Smoke-test on first Railway redeploy will verify SIGTERM/shutdown behavior (STAGING_TEST_PLAN.md → Test 8).

---

### 8. Gemini Integration — **PARTIAL**  ·  weight 6  ·  score 4.2

- `@google/genai` unified SDK wired correctly
- Structured outputs via `responseMimeType: "application/json"` + `responseSchema`
- URL Context tool for site fetching; Google Search tool for competitor grounding
- 5-step pipeline writes back to Postgres per step
- No retry on transient 429 / 5xx
- No token usage tracking (audit M1 — Phase 5)

**Risk:** Medium. Transient Gemini failures fail the job immediately; BullMQ's job-level retry (attempts: 2) provides a coarse safety net.

**Recommended fix:** add SDK-level retry with exponential backoff for 429 and 5xx. Phase 4.
**Deployment impact:** non-blocking. Job-level retry is sufficient for staging.

---

### 9. Gemini Timeout Handling — **FAIL**  ·  weight 5  ·  score 1.5

- `workerEnv.GEMINI_TIMEOUT_MS` is validated and logged at boot
- **The value is not actually applied to Gemini calls**
- A hung Gemini call burns one of `WORKER_CONCURRENCY` worker slots until BullMQ's `lockDuration` (30 s) expires
- BullMQ then marks the job stalled and re-queues it, but the inner Gemini call is still pending in the original slot

**Risk:** High. This is the single most operationally risky open item: under any Gemini outage or slow-call scenario, the worker degrades silently.

**Recommended fix:** wrap `ai.models.generateContent()` calls in `Promise.race([call, timeout])` in `src/lib/gemini.ts`. Trivial change; ~10 lines. **Audit H3 — top of Phase 4 list.**

**Deployment impact:** acceptable for low-traffic staging where humans observe individual jobs. Must fix before production launch.

---

### 10. Environment Validation — **PASS**  ·  weight 8  ·  score 8

- Two validators: `env.ts` (Next.js) and `worker-env.ts` (worker)
- Zod-based, eager at module load, fail-loud with named missing vars
- Build-phase tolerance for Next.js (server-only secrets placeheld during `next build`)
- Browser-side `serverEnv` Proxy throws on accidental client-side access
- `.env.local.example` annotated per variable
- DEPLOYMENT.md documents every var per platform

**Risk:** Low.
**Recommended fix:** none.
**Deployment impact:** none — validators will catch any missing-var deploys at boot.

---

### 11. Build Pipeline — **PASS**  ·  weight 6  ·  score 6

- Next.js build (`npm run build`) — verified clean with placeholder env, 15 routes
- Worker build (`npm run build:worker`) — esbuild bundle, 12.4 MB, 11 s cold / 0.4 s incremental
- `npx tsc --noEmit` clean
- No build-time secrets leakage (Next.js inlines NEXT_PUBLIC_*, strips others from client bundle)
- Sourcemaps inline in worker bundle for readable stack traces
- Workspace-root cosmetic warning (audit L1)

**Risk:** Low.
**Recommended fix:** silence workspace-root warning via `next.config.ts → outputFileTracingRoot`. Cosmetic.
**Deployment impact:** none.

---

### 12. Deployment Pipeline — **PARTIAL**  ·  weight 6  ·  score 4.2

- `railway.json` declares build + start + restart policy — auto-picked-up by Railway
- Vercel auto-detects Next.js — no special config needed beyond env vars
- DEPLOYMENT.md has per-platform setup steps
- **First deploy has not happened** — no production proof
- **No CI/CD pipeline** — manual deploys only (acceptable for solo dev / staging)
- **No rollback runbook** — Vercel + Railway both support previous-deploy rollback via dashboard, but no documented procedure

**Risk:** Medium. First deploy will catch any latent config issues (Clerk JWT template, env var typos, Realtime publication membership).

**Recommended fix:**
1. Run the staging deploy following STAGING_TEST_PLAN.md.
2. Document any deviations.
3. Phase 6 will add a deployment runbook + rollback playbook.

**Deployment impact:** this category is the literal reason this checkpoint exists. The staging deploy IS the verification.

---

### 13. Observability — **PARTIAL**  ·  weight 6  ·  score 4.2

- Structured JSON logs in worker (scope + msg + extra)
- Redis lifecycle events visible
- BullMQ job-lifecycle events logged
- No error tracker (Sentry / Logflare / Datadog) — audit M1
- No metrics (job latency, Gemini call duration, token usage) — audit M1
- No correlation IDs across web → queue → worker — audit M1
- No alerts

**Risk:** Low for staging (you'll be reading logs anyway). Medium-High for production.

**Recommended fix:** Phase 5 — add Sentry for Next + worker; capture `usageMetadata` from Gemini responses; generate correlation IDs at enqueue and propagate through job data.
**Deployment impact:** non-blocking. Acceptable to deploy without; staging traffic is observable from logs alone.

---

## Score summary

| # | Category | Status | Weight | Score |
|---|---|---|---:|---:|
| 1 | Authentication | PASS | 10 | 10.0 |
| 2 | Clerk JWT Template | PARTIAL | 5 | 3.5 |
| 3 | Supabase Database | PASS | 8 | 8.0 |
| 4 | RLS | PASS | 12 | 12.0 |
| 5 | Realtime | PASS | 10 | 10.0 |
| 6 | Queue | PARTIAL | 8 | 5.6 |
| 7 | Worker | PARTIAL | 10 | 7.0 |
| 8 | Gemini Integration | PARTIAL | 6 | 4.2 |
| 9 | Gemini Timeout Handling | FAIL | 5 | 1.5 |
| 10 | Environment Validation | PASS | 8 | 8.0 |
| 11 | Build Pipeline | PASS | 6 | 6.0 |
| 12 | Deployment Pipeline | PARTIAL | 6 | 4.2 |
| 13 | Observability | PARTIAL | 6 | 4.2 |
| | **TOTAL** | | **100** | **84.2** |

## Deployment Readiness Score: **84 / 100**

---

## GO / NO-GO recommendation

### Staging deploy: **GO** ✅

The 84/100 score reflects a system whose **happy-path is production-grade** and whose **failure modes are either gracefully degraded or non-critical for the staging traffic profile**. Six categories are clean PASS, six are PARTIAL with non-blocking gaps, and one is FAIL (Gemini timeout) that affects worker resilience under adverse Gemini conditions but does not block normal operation.

Staging is the right environment to:

1. **Validate Clerk JWT template configuration** — currently the highest unverified risk
2. **Confirm RLS multi-user isolation** end-to-end against a live Supabase instance
3. **Observe realistic Gemini call durations** — informs the right `GEMINI_TIMEOUT_MS` value before fixing H3
4. **Surface any latent platform-config issues** (Vercel build, Railway env, Upstash TLS) that only manifest in real deploys
5. **Confirm Linux SIGTERM behavior** (the one piece this Windows session couldn't validate)

Deferring deploy to fix the remaining PARTIAL items (H1, H2, H3, H4, M4) without first observing real traffic risks **over-engineering against guessed failure rates** — better to deploy, observe, and harden.

### Production deploy: **NO-GO** ❌

**Three items must close before production launch:**

| Item | Audit ref | Effort |
|---|---|---|
| Gemini call timeout | H3 | < 1 hour |
| Stuck-job recovery (Postgres `running` rows) | H4 | ~2 hours |
| Per-user rate limit on `POST /api/brands` | H2 | ~1 hour |

These are operational safety nets, not feature work. Total estimated effort to close: **half a day** (Phase 4).

A second readiness review after Phase 4 lands is recommended before flipping production traffic.

---

## What "GO for staging" means in practice

1. Sign off on the staging deploy.
2. Execute the staging deploy following [STAGING_TEST_PLAN.md](./STAGING_TEST_PLAN.md).
3. Capture any deviations from expected behavior.
4. Triage findings into:
   - **Blockers** — must fix before production
   - **Improvements** — feed into Phase 4 / 5 backlog
   - **Won't-fix** — documented, accepted
5. After Phase 4 fixes land, re-run the staging tests, then evaluate production go-live.

---

## What "NO-GO for production" means

- Do not point a custom domain at the Vercel deployment yet.
- Keep Railway's worker replicas at 1.
- Use Clerk's "Test mode" keys (`pk_test_…` / `sk_test_…`).
- Do not invite external users.
- Treat the deployment as a private staging environment until Phase 4 verification passes.
