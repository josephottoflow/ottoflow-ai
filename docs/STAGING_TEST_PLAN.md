# Ottoflow AI — Staging Test Plan

Run-once test plan for the first staging deploy of the Brand Research
Engine. Executes against a real Supabase project + Clerk app + Upstash
Redis + Railway worker + Vercel web — i.e. validates everything we
verified by code-trace in Steps 1-4.

Companion to [DEPLOYMENT_READINESS.md](./DEPLOYMENT_READINESS.md),
[DEPLOYMENT.md](./DEPLOYMENT.md), [AUTH_FLOW.md](./AUTH_FLOW.md),
[WORKER_ARCHITECTURE.md](./WORKER_ARCHITECTURE.md).

---

## Pre-flight checklist

Confirm each before starting:

- [ ] **Supabase staging project** created (separate from any prod project)
- [ ] Migrations applied: `001_initial.sql` then `002_foundation.sql` in **SQL Editor**
- [ ] **Realtime** enabled in Supabase → Database → Replication: tables `brand_research_jobs`, `brands`, `render_jobs`, `activity` show "in publication"
- [ ] **Clerk staging app** created (Test mode, `pk_test_…` / `sk_test_…`)
- [ ] Clerk **JWT Template** named `supabase` created with HS256 + Supabase JWT secret (Settings → API → JWT Secret), claims `{ "aud": "authenticated", "role": "authenticated" }`
- [ ] Clerk **Paths** configured: sign-in `/sign-in`, sign-up `/sign-up`, after sign-in `/`
- [ ] **Upstash Redis** database created, TLS Redis URL copied
- [ ] **Google AI Studio** API key generated
- [ ] **Vercel** project created, Root Directory = `ottoflow-ai`, env vars set (see DEPLOYMENT.md)
- [ ] **Railway** service created, Root Directory = `ottoflow-ai`, env vars set (see DEPLOYMENT.md)
- [ ] Two test email addresses ready for multi-user tests (e.g. you+a@..., you+b@...)

When every box is ticked, proceed.

---

## Test 1 — Initial deploy & boot

**Purpose:** confirm both platforms boot cleanly with the configured env.

### Vercel

1. Trigger build.
2. **Expect:** build completes; route table shows `/`, `/brands`, `/brands/[id]`, `/brands/new`, `/sign-in/[[...sign-in]]`, `/sign-up/[[...sign-up]]`, `/api/brands`, etc.
3. **Expect:** Vercel Functions logs show no env errors.
4. **Fail if:** build errors with `[env] Public (NEXT_PUBLIC_*) environment validation failed` — env vars not set in Vercel dashboard.

### Railway (worker)

1. Trigger deploy.
2. **Expect:** logs show within 10 s of boot:
   ```
   {"scope":"redis","msg":"redis.connect"}
   {"scope":"redis","msg":"redis.ready"}
   {"scope":"worker","msg":"started","concurrency":2,"model":"gemini-2.5-flash","geminiTimeoutMs":90000,...}
   ```
3. **Fail if:**
   - `[worker-env] Worker environment validation failed` → env vars missing on Railway
   - Repeated `redis.error` / `redis.reconnecting` without `redis.ready` → wrong `REDIS_URL` or firewall
   - Process exits 1 immediately → check build output and runtime crash

**Status:** ⬜ Pass · ⬜ Fail · note: ______________

---

## Test 2 — Single-user happy path

**Purpose:** end-to-end brand research from sign-up through profile rendered.

1. Visit the Vercel URL. Should redirect to `/sign-in`.
2. Click "Sign up" → use **User A**'s test email → complete Clerk flow.
3. Redirected to dashboard (`/`). Sidebar shows "Brands" nav item; user button shows correct email.
4. Click **Brands → Research Your First Brand**.
5. Form: enter
   - Company: `Linear`
   - Website: `linear.app`
   - Industry: `Project Management Software`
6. Submit. Should redirect to `/brands/<uuid>`.

### What to verify on `/brands/<uuid>`

- Initial state: ProgressCard shows "Queued" with progress 0%.
- Within ~2-5 s: progress jumps to ~10% (`fetching_site` step) — observe via Realtime.
- Step log entries appear in real time:
  - `Started: Fetching website`
  - `Fetching linear.app`
  - `Started: Extracting brand profile`
  - `Brand profile extracted` (with metadata count)
  - `Started: Researching competitors`
  - `Found N competitors`
  - `Started: Generating SEO + pillars`
  - `Generated N keywords + M pillars`
  - `Started: Saving results`
  - `All done — brand is ready`
- Page transitions to the full Brand Profile view (header status badge: **Ready**).
- ProfileSection renders: summary, positioning, value props, services, voice, audience, personas.
- CompetitorsSection: ≥3 entries.
- KeywordsSection: ≥10 keywords with intent + opportunity scores.
- PillarsSection: ≥3 content pillars.

### Worker log expectations

```
{"scope":"brand-research","msg":"job.active","jobId":"<uuid>",...}
{"scope":"brand-research","msg":"step","step":"fetching_site","progress":2}
{"scope":"brand-research","msg":"step","step":"fetching_site","progress":10}
{"scope":"brand-research","msg":"step","step":"extracting_profile","progress":37}
{"scope":"brand-research","msg":"step","step":"extracting_profile","progress":45}
... etc.
{"scope":"brand-research","msg":"job.completed","durationMs":40000-80000}
```

**Fail if:**
- Progress never updates past "Queued" → Realtime auth broken (Clerk JWT template misconfigured? See Test 4)
- Job stays at one step → worker crashed mid-job or Gemini timed out without a timeout
- Worker logs `job.failed` → inspect `error_message` on the failure card

**Status:** ⬜ Pass · ⬜ Fail · note: ______________

---

## Test 3 — Multi-user isolation (the big one)

**Purpose:** verify RLS + Realtime + DB-level isolation. If anything in
this test leaks, it's a security incident — investigate immediately.

### Setup
1. Open one browser as **User A** (still signed in from Test 2). Note the brand ID from the URL.
2. Open a **different browser** (or incognito) as **User B**:
   - Sign up with the second test email.
   - You should land on an empty dashboard. No "Linear" brand visible.

### 3a — List isolation

- User B navigates to `/brands`.
- **Expect:** empty state ("No brands yet").
- **Fail if:** User A's "Linear" brand appears in User B's list. **Critical RLS leak.**

### 3b — Direct-URL access

- User B copies User A's brand URL (`/brands/<userA-brand-id>`) and pastes it.
- **Expect:** `notFound()` 404 page.
- **Fail if:** User B sees User A's brand data. **Critical RLS leak — RLS policy on `brands` not working.**

### 3c — Realtime cross-tenant subscription attempt

- Have User A create a SECOND brand (e.g. Notion / notion.so / Productivity).
- While User A's brand is researching, User B opens DevTools Console on their dashboard and runs:
  ```js
  // (Replace <USER_A_JOB_ID> with the brand_research_jobs.id from User A's session.
  // For this test, User A grabs their job id from their /brands/<id> page; it's in the brand_research_jobs row.)
  const sb = await import("/_next/static/.../supabase-js");
  // Or use the React DevTools to grab a reference to the SupabaseProvider's client.
  // Easier: in User B's tab, open Network → WS → see what filter is being subscribed.
  ```
- **Expect:** even if User B crafts a Postgres-changes subscription with User A's job id as filter, the Realtime broker drops events because RLS rejects the SELECT.
- **Pragmatic check:** if no events arrive in User B's tab while User A's brand actively progresses, isolation is intact.

### 3d — API-level isolation

In User B's browser DevTools Console:
```js
const res = await fetch("/api/brands", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Hijack Attempt",
    website: "https://example.com",
    industry: "Test"
  })
});
console.log(await res.json());
```
- **Expect:** Status 201; returns a `brandId` belonging to User B (verify by checking that the brand appears in User B's `/brands` list, not User A's).
- The `user_id` on the new brand row should be User B's Clerk ID even though there was no `user_id` in the request body.

### 3e — Brand-research isolation

- Have User B create a brand of their own.
- Wait for it to complete.
- User A visits User B's brand URL → 404.
- User B visits User A's brand URL → 404.

**Status:** ⬜ Pass · ⬜ Fail · note: ______________

---

## Test 4 — Clerk JWT template verification

**Purpose:** the only manual setup in the entire stack. Get it wrong
and EVERYTHING using a user JWT silently breaks.

### 4a — Token issuance succeeds

Sign in as any user. In DevTools Console:
```js
const token = await window.Clerk.session.getToken({ template: "supabase" });
console.log(token);
```
- **Expect:** a JWT string starting with `eyJ`.
- **Fail if:** `null` returned → template `supabase` doesn't exist in Clerk dashboard.

### 4b — Token verifies on Supabase

Take the token. In a terminal:
```bash
curl -X GET "https://<your-project>.supabase.co/rest/v1/brands?select=id" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <PASTE_TOKEN>"
```
- **Expect:** JSON array of the user's brands (possibly empty).
- **Fail if:** `{"code":"PGRST301","message":"JWSError JWSInvalidSignature"}` → Clerk template signed with the wrong key. Fix: copy Supabase's JWT Secret from Settings → API and paste into Clerk's `supabase` template signing key.

### 4c — Token claims correct

Decode the token at https://jwt.io. The payload should include:
- `aud: "authenticated"`
- `role: "authenticated"`
- `sub: "user_2abc…"` (Clerk user ID)

**Fail if:** claims missing or wrong → re-check the template JSON body.

**Status:** ⬜ Pass · ⬜ Fail · note: ______________

---

## Test 5 — Realtime under network blip

**Purpose:** confirm token refresh + reconnect work.

1. Sign in as User A. Open `/brands/<id>` on a brand mid-research.
2. In DevTools Network, throttle to "Offline" for 10 s.
3. Set back to "Online".
4. **Expect:** subscription resumes; progress updates appear.
5. Wait > 60 s on the page (no actions). The token refresh interval (50 s) should fire.
6. **Expect:** subsequent Realtime events still arrive — no silent drop after the original token expired.

**Status:** ⬜ Pass · ⬜ Fail · note: ______________

---

## Test 6 — Sign-out / sign-in switching

**Purpose:** confirm no cross-user data leakage across session changes.

1. Sign in as User A. Open `/brands` — see User A's brands.
2. Click avatar → **Sign out**.
3. Should redirect to `/sign-in`.
4. Sign in as User B.
5. Navigate to `/brands` → see only User B's brands; none of User A's.
6. Refresh page. Same result.
7. Sign out → sign in as User A. See User A's brands again.

**Status:** ⬜ Pass · ⬜ Fail · note: ______________

---

## Test 7 — Queue / worker basics

**Purpose:** verify the queue processes jobs and visible recovery from
transient issues.

### 7a — Job appears in BullMQ

In Upstash dashboard → Data Browser → search for `bull:brand-research:*` keys after Test 2's brand creation. Should see job state keys.

### 7b — Retry on failure

1. Temporarily revoke the Gemini API key (delete it in AI Studio).
2. Create a new brand.
3. **Expect:** worker logs `job.failed` after attempt 1, retries after ~5 s with attempt 2, fails again, then `brand_research_jobs.status = 'failed'` and the UI's FailureCard appears with the Gemini error message.
4. Re-add the API key. Existing failed jobs stay failed (no automatic re-research yet — audit M5).

### 7c — Concurrency

1. Restore the Gemini key.
2. Create 4 brands back-to-back (different companies).
3. **Expect:** worker logs show 2 jobs `active` at a time (WORKER_CONCURRENCY=2). The other 2 wait.
4. As earlier jobs `completed`, queued jobs become `active`.

**Status:** ⬜ Pass · ⬜ Fail · note: ______________

---

## Test 8 — Graceful shutdown on Railway redeploy

**Purpose:** confirm Linux SIGTERM behavior (couldn't be tested on Windows in Step 4).

1. Trigger any worker redeploy on Railway (e.g. click "Restart" or push an empty commit).
2. Watch the worker logs DURING the redeploy.
3. **Expect:**
   ```
   {"scope":"worker","msg":"shutdown.start","signal":"SIGTERM","timeoutMs":25000}
   {"scope":"worker","msg":"shutdown.complete","signal":"SIGTERM"}
   ```
   Or, if a job was active:
   ```
   {"scope":"worker","msg":"shutdown.force_close","reason":"graceful exceeded timeout"}
   ```
4. New revision boots. `redis.connect` → `redis.ready` → `worker started`.
5. Any in-flight job from before the deploy gets re-claimed (BullMQ stalled detection) → reflected in logs as `job.active` for the same job ID.

**Fail if:** shutdown logs missing → signal handler not firing. Investigate.

**Status:** ⬜ Pass · ⬜ Fail · note: ______________

---

## Test 9 — Browser refresh + token persistence

**Purpose:** confirm refresh doesn't break Realtime or session.

1. Sign in. Start a brand research. Wait until progress hits ~30%.
2. Hard refresh (Ctrl+Shift+R).
3. **Expect:**
   - Brand-detail page reloads with the current state (server fetches latest job row).
   - Realtime subscription re-establishes; progress continues updating.
   - No flicker of "Loading..." longer than ~500 ms.

**Status:** ⬜ Pass · ⬜ Fail · note: ______________

---

## Test 10 — Env failure isolation

**Purpose:** confirm a misconfigured env causes a loud, immediate failure
(not a silent runtime broken state).

### 10a — Worker missing env

1. On Railway, delete `GOOGLE_API_KEY` from env vars.
2. Redeploy.
3. **Expect:** worker exits 1 immediately with:
   ```
   Error: [worker-env] Worker environment validation failed:
     • GOOGLE_API_KEY — Required
   ```
4. Railway restart policy kicks in, fails again, fails again — after 10 retries Railway shows "deployment failed".
5. Re-add the key, redeploy. Boots cleanly.

### 10b — Vercel missing env

(Lower priority — skip if time-pressed, but confirms the validator works.)

1. Remove `CLERK_SECRET_KEY` from Vercel env (Production tab).
2. Redeploy.
3. **Expect:** runtime error on next request — function log shows
   `[env] Server environment validation failed: CLERK_SECRET_KEY — Required`.
4. Re-add and redeploy.

**Status:** ⬜ Pass · ⬜ Fail · note: ______________

---

## Rollback procedure

If any test fails critically (RLS leak, data corruption, can't sign in):

### Web (Vercel)
1. Vercel dashboard → Deployments → previous successful deploy → **Promote to Production**.
2. Investigate the broken deploy in a separate branch.

### Worker (Railway)
1. Railway → Deployments → previous successful → **Rollback**.
2. Drain the BullMQ queue if any half-processed jobs need clearing:
   ```bash
   # From local: connect to the same REDIS_URL
   redis-cli -u "$REDIS_URL" --tls
   > FLUSHDB    # nuclear option — drops ALL queue state
   ```
3. Investigate the broken deploy.

### Database (Supabase)
- We don't roll back schema changes for this checkpoint; migrations are forward-only.
- If a migration corrupted data, restore from the Supabase point-in-time backup (Settings → Database → Backups).

---

## Success criteria

The staging deploy is considered successful when:

- [ ] Tests 1, 2, 4, 6, 8, 9, 10 pass (single-user + ops basics)
- [ ] **Test 3 (multi-user isolation) passes in full**, including 3a-3e
- [ ] Test 5 passes (Realtime resilience)
- [ ] Test 7 passes (queue basics)
- [ ] All worker logs are structured JSON, parseable
- [ ] No 5xx errors in Vercel function logs during normal operation
- [ ] No unexpected `unhandledRejection` / `uncaughtException` logs

If any of the above fails, do not proceed to production planning. Triage:
- **Security failure** (Test 3) → halt all deploys, root-cause in code/RLS.
- **Auth failure** (Tests 2, 4, 6) → re-check Clerk JWT template setup.
- **Realtime failure** (Tests 5, 9) → check Supabase publication membership + Clerk token issuance.
- **Worker failure** (Tests 1, 7, 8, 10) → check env validation logs first.

---

## After staging passes

1. Document any deviations from expected behavior in `docs/STAGING_FINDINGS.md`.
2. Triage findings into the Phase 4 backlog (H1, H2, H3, H4).
3. Schedule a second readiness review after Phase 4 fixes land.
4. **Only then** evaluate production go-live.

---

## Out of scope for staging tests

These are intentionally not validated here — they need real-world traffic
volume or are explicitly Phase 4/5/6 scope:

- Per-user rate limiting (audit H2) — Phase 4
- Idempotency key (audit H1) — Phase 4
- Gemini timeout enforcement (audit H3) — Phase 4
- Stuck-job recovery (audit H4) — Phase 4
- Healthcheck endpoint (audit M4) — Phase 5
- Sentry / observability (audit M1) — Phase 5
- Load testing — separate effort
