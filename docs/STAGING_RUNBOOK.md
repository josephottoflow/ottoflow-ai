# Ottoflow AI — Staging Deployment Runbook

Step-by-step playbook for executing the first staging deploy. Designed
for one engineer to run sequentially. Total estimated time: **35–45
minutes** if nothing breaks, plus test execution per
[STAGING_TEST_PLAN.md](./STAGING_TEST_PLAN.md).

Record outcomes in [STAGING_RESULTS.md](./STAGING_RESULTS.md) as you go.

> If you hit anything unexpected, **stop and capture the exact error /
> log**, then ping me with the artifact — don't push through. Almost all
> deploy-time issues fall into 4 categories and have known fixes:
> missing env var, JWT template misconfig, wrong Redis URL scheme, RLS
> policy not applied.

---

## Phase 0 — Pre-flight (2 min)

- [ ] On the latest `main` branch locally
- [ ] `cd ottoflow-ai && npm ci && npm run build` succeeds with placeholder env (sanity check)
- [ ] `npm run build:worker` succeeds, produces `worker/dist/index.js`
- [ ] Two real email addresses available for multi-user testing (e.g. `you+a@example.com`, `you+b@example.com`)

---

## Phase 1 — Supabase (8 min)

1. **Create project**: https://supabase.com/dashboard → **New project**
   - Name: `ottoflow-staging`
   - Region: closest to your Vercel region (typically `us-east-1`)
   - Database password: generate, save to your password manager
   - Wait for provisioning (~2 min)

2. **Capture credentials** from Settings → API:
   - `Project URL` → save as `NEXT_PUBLIC_SUPABASE_URL`
   - `anon (publishable) key` → save as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role (secret) key` → save as `SUPABASE_SERVICE_ROLE_KEY`
   - **`JWT Secret`** (further down the page) → save for Phase 2 (Clerk)

3. **Run migrations** in SQL Editor (paste each file, run, confirm "Success. No rows returned"):
   - Open `supabase/migrations/001_initial.sql` locally → paste → Run
   - Open `supabase/migrations/002_foundation.sql` locally → paste → Run

4. **Verify Realtime publication**: Database → Replication → `supabase_realtime`
   - Expect these tables marked as published:
     - `brand_research_jobs`
     - `brands`
     - `render_jobs`
     - `activity`
   - If any are missing, re-run the relevant `alter publication` block from migration 002.

5. **Sanity-check RLS**: Authentication → Policies. Confirm every table
   has policies listed (not "RLS is enabled but no policies"). Spot-check
   `brands` has `brands_owner` and child tables have `*_via_brand`.

→ Record in STAGING_RESULTS.md → Phase 1.

---

## Phase 2 — Clerk (5 min)

1. **Create application**: https://dashboard.clerk.com → **+ Create application**
   - Name: `ottoflow-staging`
   - **Sign-in options**: at minimum enable Email + Password (add Google if you want)
   - Keep test mode for now (`pk_test_…` / `sk_test_…`)

2. **Capture credentials** from API Keys:
   - `Publishable key` → save as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `Secret key` → save as `CLERK_SECRET_KEY`

3. **Create the Supabase JWT template** (this is the most error-prone step):
   - JWT Templates → **+ New template**
   - Name: **`supabase`** (lowercase exact; the code calls
     `getToken({ template: "supabase" })`)
   - **Signing algorithm: HS256**
   - **Signing key: paste the JWT Secret from Phase 1 step 2**
   - **Claims (body)**:
     ```json
     {
       "aud": "authenticated",
       "role": "authenticated"
     }
     ```
   - Save.

4. **Configure paths**: Customization → Paths
   - Sign-in URL: `/sign-in`
   - Sign-up URL: `/sign-up`
   - Home URL: `/`
   - After sign-in: `/`
   - After sign-up: `/`

→ Record in STAGING_RESULTS.md → Phase 2.

---

## Phase 3 — Upstash Redis (3 min)

1. https://console.upstash.com → **+ Create database**
   - Name: `ottoflow-staging-redis`
   - Region: closest to your Railway region
   - **TLS/SSL: enabled** (default)
   - Eviction: noeviction (BullMQ doesn't tolerate eviction)

2. **Capture credentials** from the database page:
   - "TLS Redis URL" — starts with `rediss://default:<password>@…` → save as `REDIS_URL`

→ Record in STAGING_RESULTS.md → Phase 3.

---

## Phase 4 — Google AI (1 min)

1. https://aistudio.google.com/app/apikey → **+ Create API key**
2. Copy → save as `GOOGLE_API_KEY`

→ Record in STAGING_RESULTS.md → Phase 4.

---

## Phase 5 — Vercel (web app, 8 min)

1. **Create project**: https://vercel.com/dashboard → **Add New → Project**
   - Import the GitHub repo
   - **Root Directory: `ottoflow-ai`** (very important — wrong directory means the whole monorepo gets built)
   - **Framework Preset**: Next.js (auto-detected)
   - **Node Version**: 20.x

2. **Environment Variables** (Project → Settings → Environment Variables, set for **Production** AND **Preview**):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CLERK_SECRET_KEY`
   - `REDIS_URL`
   - (optional) `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
   - (optional) `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`

3. **Deploy**: click Deploy. Build takes ~2 min.

4. **Verify the build log shows**:
   - "Compiled successfully"
   - All 15 routes in the route table (no missing pages)
   - **No** `[env]` validation errors

5. **Capture the deployed URL** (e.g. `ottoflow-staging.vercel.app`).

→ Record in STAGING_RESULTS.md → Phase 5. **Do NOT browse the deployed URL yet** — the worker isn't up. Sign-in will work, but creating a brand will queue forever.

---

## Phase 6 — Railway (worker, 8 min)

1. **Create service**: https://railway.app → New Project → Deploy from GitHub repo → pick the same repo

2. **Configure**:
   - **Root Directory: `ottoflow-ai`**
   - Verify Railway picked up `railway.json` (Build & Deploy tab should show `npm ci --include=dev && npm run build:worker` build cmd and `npm run start:worker` start cmd)
   - If not auto-picked, set those commands manually

3. **Environment Variables** (Variables tab):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `REDIS_URL`
   - `GOOGLE_API_KEY`
   - (optional) `GEMINI_MODEL=gemini-2.5-flash`
   - (optional) `WORKER_CONCURRENCY=2`
   - (optional) `LOG_LEVEL=info`

   > Worker does NOT need Clerk vars or `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

4. **Deploy** (Railway auto-deploys on push, or click Deploy).

5. **Verify boot logs within 30 s** — expect:
   ```
   {"scope":"redis","msg":"redis.connect"}
   {"scope":"redis","msg":"redis.ready"}
   {"scope":"worker","msg":"started","concurrency":2,"model":"gemini-2.5-flash",...}
   ```

6. **Common failures and fixes**:
   - `[worker-env] Worker environment validation failed` → env var missing; check the Variables tab
   - Repeated `redis.error` / `redis.reconnecting` → wrong `REDIS_URL` (likely `redis://` instead of `rediss://`, or password copied wrong)
   - `JWT verification failed` (during sign-in later, not at boot) → JWT template signing key mismatch — go fix in Clerk dashboard

→ Record in STAGING_RESULTS.md → Phase 6.

---

## Phase 7 — Smoke test (3 min)

Tiny happy-path check before the full test plan.

1. Visit the Vercel URL → should redirect to `/sign-in`.
2. Sign up with **User A's email** → complete flow → land on `/`.
3. Open Railway worker logs in a side panel.
4. Click "Brands → Research Your First Brand".
5. Submit a brand (suggest: `Linear` / `linear.app` / `Project Management Software`).
6. **Within 5 seconds**, expect to see in the worker logs:
   ```
   {"scope":"brand-research","msg":"job.active","jobId":"<uuid>",...}
   {"scope":"brand-research","msg":"step","step":"fetching_site",...}
   ```
7. **Within 10 seconds**, expect the brand-detail page's ProgressCard to
   show the "Fetching website" step with progress > 0%.
8. **Within 90 seconds**, expect the brand to transition to "Ready"
   status and the full BrandProfile to render.

If all three of those checks land, the staging deploy is **operationally
alive**. Proceed to the full test plan.

If any fail, stop and capture the exact log/UI state for triage.

→ Record in STAGING_RESULTS.md → Phase 7.

---

## After Phase 7: full test plan

Execute every test in [STAGING_TEST_PLAN.md](./STAGING_TEST_PLAN.md),
recording outcomes in the matching section of
[STAGING_RESULTS.md](./STAGING_RESULTS.md).

Tests are ordered by your priority list:

1. Authentication (test plan §2 + §4)
2. Clerk JWT Template (test plan §4)
3. Brand Creation (test plan §2)
4. Research Processing (test plan §2 + §7)
5. Realtime Progress (test plan §5 + §9)
6. Multi-user RLS Isolation (test plan §3 + §6) ← **the critical security test**
7. Worker Restart / Recovery (test plan §8 + §10)
8. Deployment Validation (test plan §1 + §10)

---

## Rollback (if anything critical breaks)

### Web
Vercel → Deployments → previous deploy → **Promote to Production**.

### Worker
Railway → Deployments → previous → **Rollback**.

### Database
Don't roll back migrations — they're forward-only. If row data is
corrupted, Supabase → Database → Backups → Point-in-Time Restore.

### Queue state (if jobs are stuck)
From local machine, with `REDIS_URL` exported:
```bash
redis-cli -u "$REDIS_URL" --tls
> KEYS bull:brand-research:*
> # nuclear option: FLUSHDB drops the entire queue state
```

---

## When to come back to me

- After Phase 6 if the worker won't boot
- After Phase 7 if smoke test fails
- After any test plan section where you record FAIL or BLOCKED
- When the full test plan is complete (PASS or otherwise)

Paste the relevant log lines, error messages, or describe the unexpected
behavior. I'll triage, root-cause, and patch.
