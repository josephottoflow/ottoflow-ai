# Ottoflow AI — Staging Validation Results

**Subsystem:** Brand Research Engine
**Started:** _<fill in YYYY-MM-DD HH:MM>_
**Completed:** _<fill in>_
**Executor:** _<your name>_
**Vercel URL:** _<fill in after Phase 5>_
**Railway service:** _<fill in>_
**Supabase project ref:** _<fill in>_

Use this doc as a live worksheet. Mark each section with one of:
**PASS** · **FAIL** · **BLOCKED** · **SKIPPED**

For FAIL or BLOCKED: include the exact error / log / screenshot path and
a brief root-cause hypothesis. Ping me with this doc once filled.

Companion: [STAGING_TEST_PLAN.md](./STAGING_TEST_PLAN.md), [STAGING_RUNBOOK.md](./STAGING_RUNBOOK.md).

---

## Deployment phases

### Phase 1 — Supabase setup
**Status:** ⬜
- Project created: ⬜ (project ref: ____________)
- Migrations 001 + 002 applied: ⬜
- Realtime publication confirmed (4 tables): ⬜
- RLS policies visible in dashboard: ⬜
- **Notes / errors:**

### Phase 2 — Clerk setup
**Status:** ⬜
- Application created: ⬜
- API keys captured: ⬜
- **JWT template `supabase` created with HS256 + Supabase JWT secret**: ⬜
- Paths configured: ⬜
- **Notes / errors:**

### Phase 3 — Upstash Redis
**Status:** ⬜
- Database created: ⬜ (region: ____________)
- TLS Redis URL captured (starts with `rediss://`): ⬜
- **Notes / errors:**

### Phase 4 — Google AI key
**Status:** ⬜
- Key generated and captured: ⬜
- **Notes:**

### Phase 5 — Vercel deploy
**Status:** ⬜
- Project imported, root directory = `ottoflow-ai`: ⬜
- All 6 required env vars set: ⬜
- Build succeeded: ⬜
- Route table includes `/`, `/brands`, `/brands/[id]`, `/brands/new`, `/sign-in`, `/sign-up`, `/api/brands`: ⬜
- Deployed URL: ____________
- **Build log snippet (last 20 lines):**
  ```

  ```
- **Notes / errors:**

### Phase 6 — Railway worker deploy
**Status:** ⬜
- Service created, root directory = `ottoflow-ai`: ⬜
- railway.json picked up automatically: ⬜
- All 4 required env vars set: ⬜
- Build succeeded (esbuild bundle): ⬜
- Worker boot logs show `redis.ready` → `worker started`: ⬜
- **Boot log snippet (first 10 lines):**
  ```

  ```
- **Notes / errors:**

### Phase 7 — Smoke test
**Status:** ⬜
- Sign-up flow worked: ⬜
- Brand creation form submitted: ⬜
- Worker picked up the job (logs): ⬜
- ProgressCard updated within 10s (Realtime working): ⬜
- Brand transitioned to "Ready" within 90s: ⬜
- **Total time from submit → ready: _____ seconds**
- **Notes / errors:**

---

## Test plan execution

(See [STAGING_TEST_PLAN.md](./STAGING_TEST_PLAN.md) for each test's expected
behavior and what to verify.)

### Test 1 — Initial deploy & boot
**Status:** ⬜
- Vercel build clean: ⬜
- Railway worker boot clean: ⬜
- **Findings:**

### Test 2 — Single-user happy path (Linear)
**Status:** ⬜
- Sign-up worked: ⬜
- Form submitted, redirected to `/brands/<uuid>`: ⬜
- Progress streamed through all 5 steps: ⬜
- ProfileSection renders with all sub-blocks: ⬜
- CompetitorsSection: _____ entries (expect ≥3)
- KeywordsSection: _____ entries (expect ≥10)
- PillarsSection: _____ entries (expect ≥3)
- **Time from submit to "ready" status:** _____ seconds
- **Notes / unexpected behavior:**

### Test 3 — Multi-user RLS isolation ⚠️ critical
**Status:** ⬜

#### 3a — List isolation (User B sees empty `/brands`)
**Status:** ⬜
- User B's `/brands` showed empty state: ⬜
- User A's brands NOT visible to User B: ⬜
- **If FAIL:** which of User A's brands were visible? __________

#### 3b — Direct URL access (User B → User A's brand URL → 404)
**Status:** ⬜
- 404 returned: ⬜
- **If FAIL:** describe what User B saw (full data? partial? error message?)

#### 3c — Realtime cross-tenant attempt
**Status:** ⬜
- User B's tab received zero events for User A's job: ⬜
- **Method used to verify:** (e.g. left tab open, checked network panel, ran console probe)
- **Notes:**

#### 3d — API-level isolation (POST /api/brands creates as User B)
**Status:** ⬜
- HTTP 201 returned: ⬜
- New brand appears in User B's `/brands` (not User A's): ⬜
- New brand's `user_id` in Supabase row inspector = User B's Clerk ID: ⬜
- **Notes:**

#### 3e — Brand-research isolation (cross-user URL access)
**Status:** ⬜
- User A → User B's brand URL → 404: ⬜
- User B → User A's brand URL → 404: ⬜

### Test 4 — Clerk JWT template verification
**Status:** ⬜

#### 4a — Token issuance
- `window.Clerk.session.getToken({ template: "supabase" })` returned a JWT: ⬜
- **Token first 30 chars (sanity check, NOT the full token):** `eyJ...___________________`

#### 4b — Token verifies on Supabase
- `curl` against `/rest/v1/brands` with token returned JSON (200): ⬜
- **If FAIL:** error code? `JWSInvalidSignature` = wrong signing key in Clerk template

#### 4c — Claims correct
- Decoded JWT has `aud: "authenticated"`: ⬜
- Decoded JWT has `role: "authenticated"`: ⬜
- Decoded JWT has `sub: "user_..."` matching the signed-in Clerk user: ⬜

### Test 5 — Realtime under network blip
**Status:** ⬜
- Throttled to offline for 10s, set back online: ⬜
- Subscription resumed without page refresh: ⬜
- After 60s+, token refresh fired and events still arrived: ⬜
- **Notes:**

### Test 6 — Sign-out / sign-in switching
**Status:** ⬜
- A → sign out → B sign in: B sees only B's brands: ⬜
- Refresh after switch: same result: ⬜
- B → sign out → A sign in: A sees A's brands again: ⬜
- **Notes:**

### Test 7 — Queue / worker basics
**Status:** ⬜

#### 7a — Job appears in BullMQ
- Upstash data browser shows `bull:brand-research:*` keys after job creation: ⬜

#### 7b — Retry on failure (revoke Gemini key)
- Job failed with attempts: ⬜
- `brand_research_jobs.status='failed'` in DB: ⬜
- FailureCard rendered with error message: ⬜
- After re-adding key: failed job stays failed (no auto-retry — expected, audit M5): ⬜

#### 7c — Concurrency (4 brands back-to-back)
- 2 jobs active in parallel (per logs): ⬜
- 2 jobs waited in queue: ⬜
- All eventually processed: ⬜

### Test 8 — Graceful shutdown on Railway redeploy
**Status:** ⬜
- Worker logged `shutdown.start` on SIGTERM: ⬜
- Worker logged `shutdown.complete` OR `shutdown.force_close`: ⬜
- New revision booted cleanly: ⬜
- In-flight job (if any) was re-claimed (BullMQ stalled detection): ⬜
- **Time from SIGTERM to exit:** _____ seconds
- **Notes:**

### Test 9 — Browser refresh + token persistence
**Status:** ⬜
- Hard refresh mid-research: state preserved: ⬜
- Realtime resumed without flicker > 500ms: ⬜
- **Notes:**

### Test 10 — Env failure isolation
**Status:** ⬜

#### 10a — Worker missing env (deleted GOOGLE_API_KEY)
- Worker exited 1 with `[worker-env] … GOOGLE_API_KEY — Required`: ⬜
- Railway showed deployment failed after restart-policy retries: ⬜
- Re-add key + redeploy → boots cleanly: ⬜

#### 10b — Vercel missing env (skipped if low priority)
**Status:** ⬜ / SKIPPED

---

## Issues found

For each issue: severity (CRITICAL / HIGH / MEDIUM / LOW), category, root cause hypothesis, what would unblock.

### Issue #1
- **Severity:**
- **Category:** (e.g. Auth, RLS, Realtime, Worker, Build)
- **Test where surfaced:**
- **Symptom (literal log / message / behavior):**
  ```

  ```
- **Suspected root cause:**
- **Fix needed:** (config change? code change? new task?)

### Issue #2
- **Severity:**
- **Category:**
- **Test where surfaced:**
- **Symptom:**
  ```

  ```
- **Suspected root cause:**
- **Fix needed:**

_(add more issue sections as needed)_

---

## Summary metrics

- Tests executed: _____ / 10
- PASS: _____
- FAIL: _____
- BLOCKED: _____
- SKIPPED: _____
- **Critical security issues:** _____ (RLS / auth / data leak)
- **High-severity issues:** _____
- **Observed average brand-research wall time:** _____ seconds
- **Range:** _____ to _____ seconds

---

## Recommendation

(Fill this in after all tests complete. My side will propose a recommendation
based on what you record above.)

⬜ **Proceed to Phase 4 hardening** (H1, H2, H3, H4) — staging revealed
expected gaps, no surprises, ready to harden.

⬜ **Block release, fix surfaced issue(s) first** — at least one critical
issue found that must close before further work.

⬜ **Other:** ___________________________________________

**Filled by:** _<your name>_  ·  **Date:** _<YYYY-MM-DD>_
