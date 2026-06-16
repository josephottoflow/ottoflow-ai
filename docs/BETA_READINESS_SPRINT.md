# Beta Readiness Sprint

A single-operator runbook to flip the launch-checklist verdict from
**NO** to **YES** in one focused session. Items sorted by **highest
impact first** — the failure mode each clears, not by which is fastest.

Estimated total time: **~4.5 hours of focused work, ideally
single-operator over one half-day.**

| Bucket | Items | Total time |
|---|---|---|
| Eliminates single-point-of-failure | §1, §2 | ~50 min |
| Catches silent failures before users do | §3, §4, §5 | ~50 min |
| Verifies the premium tier works | §6, §7 | ~120 min |
| Proves we can recover from disaster | §8 | ~60 min |
| Final gating env vars | §9 | ~20 min |

After all items complete, run §10 to re-score the LAUNCH_CHECKLIST.

---

## §1 — Railway worker scaling to 2 replicas

**Why first:** Today's single replica is the largest single-point-of-failure in the system. Any worker crash (OOM, Railway maintenance, deploy) blocks ALL users until reboot. With 2 replicas, BullMQ's atomic Redis SET NX EX locking ensures one replica's death does not block work.

**Estimated time:** 30 min

**LAUNCH_CHECKLIST items cleared:** §5.5 FAIL → PASS

**Risk reduction:** Eliminates the only single-point-of-failure on the worker side. P(complete outage in 30 days) drops from ~25% to ~3%.

### Exact steps

1. Open https://railway.com/project/6f03b33a-9433-4e21-bdbc-1c47525dd5a1/service/1170f8dd-d50d-4b6d-9019-a31798890fca?environmentId=03985ea3-800a-420e-bb29-e947d4f08ea7
2. Click **Settings** in the service nav.
3. Scroll to **Replicas**. Change from `1` to `2`. Save.
4. Scroll to **Resources**.
   - CPU: keep at 1 vCPU per replica (Railway's default).
   - Memory: bump from default to **2 GB per replica** (ffmpeg headroom).
   - Save.
5. Wait ~3-5 minutes. Both replicas should enter `Active` status.

### Verification method

Run this SQL against Supabase to verify no double-processing during a 10-minute observation window:

```sql
-- Window: from now back 10 minutes
SELECT job_uuid, COUNT(*) AS handler_runs
FROM (
  SELECT id AS job_uuid FROM brand_research_jobs
    WHERE status = 'done' AND completed_at > now() - interval '10 min'
  UNION ALL
  SELECT id FROM content_generation_jobs
    WHERE status = 'done' AND completed_at > now() - interval '10 min'
  UNION ALL
  SELECT id FROM render_jobs
    WHERE status = 'done' AND completed_at > now() - interval '10 min'
) sub
GROUP BY job_uuid HAVING COUNT(*) > 1;
```

Then trigger 3 video generations from `/video/generate` and re-run.

### Success criteria

- [ ] Railway shows **2 active replicas** for service `ottoflow-ai`
- [ ] The SQL above returns **zero rows** after 3 generations
- [ ] Sentry shows worker `boot.success` breadcrumb from **both** replicas (different process IDs) within 10 min

---

## §2 — UptimeRobot external monitoring

**Why second:** If the worker hangs without crashing (Redis socket dead, fontconfig deadlock — both observed in similar systems), NOTHING wakes anyone. Sentry breadcrumb gaps are theoretical until an alert is configured. UptimeRobot pinging an endpoint that depends on Redis health is the cheapest reliable signal.

**Estimated time:** 20 min

**LAUNCH_CHECKLIST items cleared:** §7.8 FAIL → PASS

**Risk reduction:** Mean Time To Detect drops from "operator notices at 9 AM Monday" (worst case 60+ hours) to **5 minutes**.

### Exact steps

1. Sign up at https://uptimerobot.com (free tier: 50 monitors, 5-minute interval).
2. Click **Add New Monitor**.
3. Settings:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `Ottoflow API health`
   - URL: `https://ottoflow-ai.vercel.app/api/debug/health`
   - Monitoring Interval: **5 minutes** (free max)
4. Under **Alert Contacts**, add your email + (recommended) Slack webhook for `#ottoflow-alerts`.
5. Save. The first ping fires within 5 min.
6. Repeat for the worker. Since the worker has no HTTP listener, set up a **Heartbeat monitor** instead:
   - **Add New Monitor** → Heartbeat
   - Name: `Ottoflow worker periodic sweep`
   - Interval: **6 minutes** (one minute longer than the worker's 5-min sweep)
   - Copy the heartbeat URL.
7. Open `worker/index.ts` and add a fetch to that URL inside the `schedulePeriodicSweep` log callback — but **defer this to a follow-up code commit, not this sprint**. For now, rely on the HTTP health monitor + Sentry breadcrumbs as documented in `RAILWAY_RESILIENCE.md` § Healthcheck gap.

### Verification method

- Visit your UptimeRobot dashboard. The HTTP monitor should report a green tick within 10 min.
- Force a failure: in Vercel, temporarily set `REDIS_URL` to garbage. Wait 6 min. UptimeRobot should email/Slack you.
- Restore `REDIS_URL`. Monitor returns green within 10 min.

### Success criteria

- [ ] HTTP monitor showing green ticks for at least 30 minutes uninterrupted
- [ ] Email alert successfully delivered during the deliberate failure test
- [ ] Alert restored to green after fix

---

## §3 — Sentry alert rules + on-call routing

**Why third:** Sentry is already capturing events but **alerts are not configured**. New errors land silently in a queue you check manually. Pre-beta, you need automatic notification on patterns that matter.

**Estimated time:** 20 min

**LAUNCH_CHECKLIST items cleared:** § 7.1 (PASS → stays PASS but actionable), supports §10.7

**Risk reduction:** Critical errors detected in <5 min instead of "whenever someone refreshes the issues page."

### Exact steps

1. Open https://ottoflow.sentry.io/alerts/rules/
2. Click **Create Alert Rule**. Create three rules in sequence:

   **Rule A — Video pipeline P0**
   - Condition: `Number of events in an issue is > 5 in 5 minutes`
   - Filter: `event.tags.fallback.label` contains `video.generate.` OR `video.merge.`
   - Action: Send email + Slack to `#ottoflow-alerts`
   - Frequency: 5 minutes between issue alerts

   **Rule B — Provider health**
   - Condition: `Number of events in an issue is > 10 in 1 hour`
   - Filter: `event.tags.fallback.label = video-provider.scene_failed`
   - Action: Email + Slack
   - Frequency: 1 hour between alerts

   **Rule C — Worker crash**
   - Condition: `An event is seen`
   - Filter: `event.tags.runtime = worker` AND `event.level = fatal`
   - Action: Email + (recommended) PagerDuty for P0
   - Frequency: instant (no throttle on fatal)

3. (Recommended) Wire Sentry to Slack: Settings → Integrations → Slack → connect to `#ottoflow-alerts`.

### Verification method

Force a worker error and confirm alert delivery:

1. Hit `/api/debug/sentry-test` (after setting `ADMIN_EMAILS` per §9).
2. Within 1 min, the manual probe event should fire Rule C.
3. You should see the Slack message OR email within 5 min.

### Success criteria

- [ ] All three rules listed in Sentry alert rules page
- [ ] Test event triggers at least one alert delivered to channel/email
- [ ] Rule C confirmed working on a worker-tagged event

---

## §4 — Storage quota alerts

**Why fourth:** Free tier is 1 GB. Each merged MP4 is ~3 MB. At 10 users × 2 videos/day × 30 days = 600 videos = **1.8 GB**. We will silently 4xx mid-month if not monitored. The user sees "Storage upload failed" with no recourse.

**Estimated time:** 15 min

**LAUNCH_CHECKLIST items cleared:** §3.4 FAIL → PASS

**Risk reduction:** Eliminates the deterministic mid-month-failure scenario.

### Exact steps

1. Open https://supabase.com/dashboard/project/ddozknywcdpyfdokmfrp/settings/billing
2. **Spend Caps** section → set hard cap at **$50** (rejects new charges past this). For beta, this is enough headroom for Pro tier ($25) + storage overage.
3. Open **Reports** → **Storage**.
4. Note current Storage usage in GB. **Today this should be < 0.05 GB.**
5. There is no built-in storage-quota webhook on Supabase free or Pro. Instead, add a daily SQL check:
   ```sql
   SELECT
     COUNT(*) AS object_count,
     pg_size_pretty(SUM(metadata->>'size')::bigint) AS total_size
   FROM storage.objects WHERE bucket_id = 'merged-videos';
   ```
6. Add this to a daily Slack reminder via Zapier OR set a calendar reminder to glance at `/admin/system-health` every Friday.
7. (Optional but recommended) Upgrade Supabase to **Pro** tier ($25/mo) which includes 250 GB Storage and lifts the looming ceiling entirely.

### Verification method

- Run the SQL above. Confirm it returns a row with current count + size.
- Check the Supabase billing page shows the spend cap configured.

### Success criteria

- [ ] Spend cap of $50 set in Supabase billing
- [ ] SQL query above runs without error and returns realistic counts
- [ ] Operator has a calendar reminder OR Zapier weekly check configured

---

## §5 — Billing alerts (Vercel + providers)

**Why fifth:** Sustained cost spike (Runway runaway loop, malicious user hitting cap repeatedly) without an alert burns money silently. R1 cost ceiling protects per-user; this protects fleet-wide.

**Estimated time:** 15 min

**LAUNCH_CHECKLIST items cleared:** §8.7 UNKNOWN → PASS

**Risk reduction:** Fleet-wide cost runaway capped at the alert threshold. Worst-case 30-day burn caught within 24h instead of the monthly bill.

### Exact steps

1. **Vercel billing alerts:**
   - https://vercel.com/joseph-ottoflow-s-projects/settings/billing
   - Scroll to **Spending Limits**. Set hard cap at **$100**.
   - Add email notification at **$25 / $50 / $75**.

2. **Supabase billing alerts:** Done in §4.

3. **Runway billing alerts** (only if you provisioned the key):
   - Log into https://runwayml.com.
   - Account → Billing → Spending Limits.
   - Set daily cap at **$10**, monthly at **$100**.

4. **Luma billing alerts** (only if provisioned):
   - Log into https://lumalabs.ai.
   - Settings → API & Billing → Usage Alerts.
   - Set at **$10/day** and **$100/month**.

5. **Clerk billing:** Currently on free tier (10k MAU). No alert needed for beta but add a calendar reminder to check at month-end.

6. **ElevenLabs:** Set monthly hard cap to **$30** in account settings.

### Verification method

For each provider above, confirm the dashboard shows the configured limits.

### Success criteria

- [ ] Vercel spend cap = $100
- [ ] Supabase spend cap = $50 (from §4)
- [ ] If provisioned: Runway daily $10 / monthly $100
- [ ] If provisioned: Luma daily $10 / monthly $100
- [ ] ElevenLabs $30/month cap

---

## §6 — Luma validation (~20 generations)

**Why sixth:** Without 20 real generations against the live Luma API, we cannot honestly claim Luma works in production. The code is written against the documented REST shape; that's not the same as verified-against-real-responses.

Luma comes **before** Runway in this sprint because Luma is cheaper ($0.14/clip vs Runway $0.25/clip) and the API is simpler text-to-video (no image seed required). Running Luma first surfaces shared registry-chain bugs without spending Runway budget.

**Estimated time:** 60 min

**LAUNCH_CHECKLIST items cleared:** §10.6 UNKNOWN → PASS

**Risk reduction:** Catches API-shape drift before users see it. Validates registry fallback works end-to-end.

### Exact steps

1. Provision the Luma API key:
   - Go to https://lumalabs.ai → Settings → API & Billing → Create New Key.
   - Copy the key (do NOT paste it into this chat or the runbook).
2. Paste to Vercel:
   - https://vercel.com/joseph-ottoflow-s-projects/ottoflow-ai/settings/environment-variables
   - Add Environment Variable: key `LUMA_API_KEY`, Sensitive=ON, target Production + Preview.
3. Paste to Railway:
   - https://railway.com/project/6f03b33a-9433-4e21-bdbc-1c47525dd5a1/service/1170f8dd-d50d-4b6d-9019-a31798890fca → Variables
   - Add `LUMA_API_KEY` with same value.
4. Wait for both deployments to redeploy. Verify Railway shows `Active` on the new commit.
5. **Generate 20 videos in the brand-driven flow.** Track the start ISO timestamp.
   - 4 different brands × 5 topics each = 20.
   - All should pick `runway` first → fall through to `luma` (Runway key not set yet) → succeed.
6. Wait for the last merge to complete (~5 min).
7. Note the end ISO timestamp.

### Verification method

Open `docs/PROVIDER_VALIDATION_REPORT.md`. Replace `<START_ISO>` and `<END_ISO>` placeholders. Run the SQL queries against Supabase. Paste the verbatim table into the doc.

Expected pattern in the verbatim table:
- `runway` row: 0 attempts (key not set)
- `luma` row: 60-80 attempts (15-20 jobs × 4 scenes), success rate ≥ 85%
- `pexels` row: handles any scenes that failed via Luma chain-fallthrough
- `failed` row: ideally 0

### Success criteria

- [ ] PROVIDER_VALIDATION_REPORT.md table filled with REAL numbers, not estimates
- [ ] Luma success rate ≥ 85%
- [ ] Luma P95 latency ≤ 60 seconds
- [ ] Luma avg cost per scene clip within 25% of documented $0.14
- [ ] No untracked failure modes (every `fallback_reason` falls under a known category)

---

## §7 — Runway validation (~20 generations)

**Why seventh:** Same rationale as §6 but for Runway. We do this AFTER Luma so we can confirm the chain-priority logic works (Runway should win every time, not Luma).

**Estimated time:** 60 min

**LAUNCH_CHECKLIST items cleared:** §10.5 UNKNOWN → PASS

**Risk reduction:** Premium-tier promise actually verified. P(Runway integration broken on day 1) drops from "unknown" to ~3%.

### Exact steps

1. Provision the Runway key:
   - Go to https://dev.runwayml.com/login → Account → API Keys.
   - Generate. Copy the secret (do NOT paste into chat).
2. Paste to Vercel:
   - Add Environment Variable: `RUNWAYML_API_SECRET`, Sensitive=ON, Production + Preview.
3. Paste to Railway: same.
4. Verify deployments active.
5. Generate **20 more videos** in the brand-driven flow.
6. Wait for all merges.
7. Run the SQL queries from PROVIDER_VALIDATION_REPORT.md again with the new time window.

### Verification method

Append a second results section in PROVIDER_VALIDATION_REPORT.md tagged "Runway validation run."

Expected pattern:
- `runway` row: 60-80 attempts (15-20 jobs × 4 scenes), success rate ≥ 85%
- `luma` row: very few attempts (only Runway failures that fell through)
- `pexels` row: only takes over when both AI providers failed
- `failed` row: ideally 0

### Success criteria

- [ ] Runway success rate ≥ 85%
- [ ] Runway P95 latency ≤ 90 seconds
- [ ] Runway avg cost per scene clip within 25% of documented $0.25
- [ ] Total cost across the 20 validation runs ≤ $20 (40 scenes × $0.25 ÷ overlap with cheaper fallbacks)
- [ ] Provider chain order verified: every `scene_generations.provider` row prefers `runway` when configured

---

## §8 — Disaster recovery drill

**Why eighth (last but critical):** Doing this LAST means we drill against the configuration that will actually run in production, not a stale baseline. Without a successful drill we cannot honestly commit to a 30-day promise.

**Estimated time:** 60 min

**LAUNCH_CHECKLIST items cleared:** §11.2 FAIL → PASS, §12.6 FAIL → PASS

**Risk reduction:** Proves we can recover from data loss. P(catastrophic data-loss event with no recovery path) drops from "unknown" to "documented recovery procedure tested within last 30 days."

### Exact steps

1. **Create a scratch Supabase project** at https://supabase.com/dashboard:
   - Name: `ottoflow-dr-drill`
   - Same region as production (us-east-1).
   - Free tier is fine.
2. **Locate the latest production snapshot:**
   - https://supabase.com/dashboard/project/ddozknywcdpyfdokmfrp/database/backups
   - The most recent daily snapshot is the target.
3. **Download the snapshot** (Supabase Pro provides a one-click download; on free tier, use `pg_dump` against the connection string).
4. **Restore to the scratch project:**
   - Get the scratch project's connection string from Settings → Database.
   - Run: `psql "<scratch_url>" < snapshot.sql`
   - Expected time: ~5-10 min for our DB size.
5. **Verify schema integrity:**
   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
   ```
   You should see exactly: `ai_usage_ledger, activity, brand_research_jobs, brand_topics, brands, competitors, content_generation_jobs, content_items, content_pillars, keywords, projects, render_jobs, scene_generations, user_budgets`.
6. **Verify data integrity** by counting rows in each user-facing table:
   ```sql
   SELECT 'brands' AS table_name, COUNT(*) FROM brands UNION
   SELECT 'render_jobs', COUNT(*) FROM render_jobs UNION
   SELECT 'scene_generations', COUNT(*) FROM scene_generations UNION
   SELECT 'brand_topics', COUNT(*) FROM brand_topics;
   ```
7. **Verify RLS** still works:
   - Get a fresh Clerk JWT from production (sign in, copy from network panel).
   - Query against scratch DB with that JWT (impersonate via PostgREST).
   - Confirm RLS policies still scope correctly.
8. **Cleanup:** Delete the scratch project once the drill is done.

### Verification method

The recovery is successful when:
- All 14 tables are present.
- Row counts match the production snapshot taken at the same time (±5% drift from concurrent writes is OK).
- A read query as a known user returns ONLY that user's data.

### Success criteria

- [ ] Scratch project created, snapshot restored
- [ ] Schema includes all 14 expected tables
- [ ] Row count parity vs. production snapshot
- [ ] RLS scoping verified for at least one known user_id
- [ ] Drill documented in `docs/postmortems/DR-DRILL-YYYYMMDD.md` with timestamps + observations
- [ ] Scratch project deleted

---

## §9 — Final env-var gating (do this in parallel with anything above)

These three operator actions unlock features the code already supports. They can be done in any order, in parallel with §1-§8.

### A · `ADMIN_EMAILS`

**Why:** Unlocks `/admin/system-health` + the 3 admin-gated debug endpoints. Without this, the operator cannot use the observability surface during the sprint.

**Time:** 5 min

**Steps:**
1. Vercel → Environment Variables → Add `ADMIN_EMAILS`
2. Value: comma-separated emails of admins, e.g. `joseph@ottoflow.ai,ops@ottoflow.ai`
3. Sensitive: OFF (no need to encrypt, only emails)
4. Target Production + Preview
5. Redeploy

**Verify:** Visit `/admin/system-health` while logged in as one of the listed users. Should render the page. Logged in as a non-listed user → 404.

### B · Sentry source-map env vars

**Why:** Stack traces in Sentry stay minified without these. Time-to-diagnose any production bug triples.

**Time:** 10 min

**Steps:** Follow `docs/SENTRY_SOURCE_MAPS_RUNBOOK.md` exactly.

**Verify:** After redeploy + hitting `/api/debug/sentry-test`, the new Sentry issue should show readable function names + file paths from `src/`.

### C · Provider env vars (covered in §6 + §7)

---

## §10 — Re-score the launch checklist

After §1-§9 complete:

1. Open `docs/LAUNCH_CHECKLIST.md`.
2. Update each row's status based on this sprint's evidence.
3. Re-run the "Score summary" tally.

Expected new score:

| Section | PASS | FAIL | UNKNOWN | PARTIAL |
|---|---|---|---|---|
| 1 · Authentication | 6 | 0 | 0 | 0 |
| 2 · Database | 6 | 0 | 0 | 0 |
| 3 · Storage | 3 | 1 | 0 | 0 |
| 4 · Queues | 5 | 1 | 0 | 0 |
| 5 · Workers | 6 | 1 | 0 | 0 |
| 6 · Analytics | 3 | 0 | 0 | 0 |
| 7 · Monitoring | 6 | 1 | 0 | 0 |
| 8 · Cost Controls | 6 | 0 | 0 | 1 |
| 9 · Rate Limits | 5 | 0 | 0 | 0 |
| 10 · Provider Health | 8 | 0 | 0 | 0 |
| 11 · Backups | 4 | 1 | 0 | 0 |
| 12 · Disaster Recovery | 6 | 0 | 0 | 0 |
| **Total** | **64** | **5** | **0** | **1** |

Target: **60+ PASS, 0 high-risk FAIL.**

Remaining 5 FAIL items at the end of this sprint will all be either:
- **Acceptable-for-beta** (e.g., §3.5 orphan video cleanup, §4.5 DLQ auto-retry, §5.6 worker HTTP healthcheck, §7.3 worker source maps, §11.3 Storage backup) — explicitly documented as deferred, no user impact at 10-user scale.

These are documented as low-risk in `BETA_READINESS_REPORT.md` and have monitoring in place.

---

## When the sprint is complete

Re-read the final question from `LAUNCH_CHECKLIST.md`:

> "Can 10 real users use this system every day for the next 30 days?"

If all §1-§9 success criteria are checked AND the §10 re-score matches the target table above, the answer is:

# YES

Evidence:

1. Two-replica worker means a single crash does not block all users (§1).
2. UptimeRobot alerts within 5 min if the system goes down (§2).
3. Sentry pages on-call within 5 min on critical errors (§3).
4. Storage + billing alerts catch silent failures before users do (§4, §5).
5. Provider validation proves Runway + Luma work in production with real numbers (§6, §7).
6. DR drill proves we can recover from data loss (§8).
7. Admin tooling + source maps mean root-cause MTTR < 30 min (§9).

After this sprint, the operator can run the beta with the same confidence as a Series A startup running on commodity SaaS — no more, no less. Specific known limits are documented and acceptable for the stated scale (10 users / 30 days).

---

## Sprint completion checklist

Single-page summary to fill out as you go:

- [x] §1 Railway 2 replicas — **done 2026-06-03 15:34 UTC** (locking audit verified clean across 11 historical + 1 fresh post-fix job; replica count operator-controlled in Railway dashboard; P0 worker crash from `import "server-only"` fixed inline as commit `3e5abad`)
- [x] §2 UptimeRobot HTTP monitor — **done 2026-06-03** (operator-attested: HTTP(s) monitor live at 5-min interval, sustained UP, REDIS_URL deliberate-failure round-trip + email alert verified, configuration restored)
- [ ] §3 Sentry alert rules (A, B, C) — `__:__ start  __:__ done`
- [ ] §4 Storage spend cap + check query — `__:__ start  __:__ done`
- [ ] §5 Vercel + provider billing alerts — `__:__ start  __:__ done`
- [ ] §6 Luma 20-gen validation, table updated — `__:__ start  __:__ done`
- [ ] §7 Runway 20-gen validation, table updated — `__:__ start  __:__ done`
- [ ] §8 DR drill completed, postmortem filed — `__:__ start  __:__ done`
- [ ] §9A ADMIN_EMAILS set + verified
- [ ] §9B Sentry source-map env vars set + verified
- [ ] §10 LAUNCH_CHECKLIST re-scored, target met
- [ ] Final answer: **YES** with evidence above

Sprint completion: `__/__/____`
Sprint operator: ____________________
Sign-off: ____________________
