# Beta Operations Runbook

Operational procedures for running the limited beta. Covers onboarding,
support, escalation, incident response, rollback. Written for an
operator who has access to Vercel, Railway, Supabase, Sentry, and the
GitHub repo, but does not necessarily know the codebase.

---

## 1 · Onboarding flow (new beta user)

### Pre-onboarding (operator)

1. Confirm the user's email is at `@ottoflow.ai` (the `domain-allowlist.ts` enforces this; non-`@ottoflow.ai` users get 403 at layout time).
2. Decide their monthly cap (default $5; raise via SQL if they're a known heavy user):
   ```sql
   UPDATE user_budgets
      SET monthly_hard_cap_usd = 25, monthly_soft_cap_usd = 20, notes = 'Heavy beta user — ${ticket}'
    WHERE user_id = '${clerk_user_id}';
   ```
3. (Optional) If they should have admin access, add their email to `ADMIN_EMAILS` env var on Vercel + redeploy.

### User-side first run

1. Sign up at `https://ottoflow-ai.vercel.app/sign-in` using `@ottoflow.ai` email.
2. Visit `/brands/new` → fill in name + URL + industry → Submit.
3. Wait ~60s for brand research to complete (Realtime UI updates).
4. On the brand detail page, click **Generate topics** → wait ~30s for the 40-topic batch.
5. Visit `/video/generate` → pick brand → pick topic → pick style → **Generate Video**.
6. Wait ~2 min for the full pipeline (Gemini + ElevenLabs + Pexels/Runway/Luma + ffmpeg merge).
7. View result + scene breakdown at `/video/[jobId]`.

### Documented user-facing limits

- 10 brands per hour
- 20 videos per hour
- $5 of AI spend per month (Runway and Luma counted; Pexels free)

When users hit any limit, the API returns 402 (budget) or 429 (rate) with a `Retry-After` header.

---

## 2 · Support process

### Channels

| Channel | Use for | Response SLA |
|---|---|---|
| `support@ottoflow.ai` (manual triage) | User questions, feature requests | 24h on business days |
| Sentry → on-call | Production errors (auto) | 30 min P0, 4h P1, 24h P2 |
| `#ottoflow-alerts` Slack | Provider failures, queue backups | 30 min P0, 4h P1 |

### Standard triage procedure

1. Reproduce or confirm the user's claim. Visit `/admin/system-health` first — if anything is red there, the issue is likely platform-wide.
2. Pull the affected `render_jobs.id` (user can find it in `/video/history` URL).
3. Check `scene_generations` for that `render_job_id` — provider, failure_reason, generation_time_ms tell you exactly what happened.
4. Check Sentry for tagged events in the same time window.
5. If platform issue: see Incident Response below. If user issue: respond with explanation + workaround.

### Common issues + canonical resolutions

| Symptom | Likely cause | Resolution |
|---|---|---|
| "Stuck at Merging audio into MP4…" forever | ffmpeg OOM / worker crash. 5-min sweep should auto-fail it within 15 min | Wait for sweep, then user clicks Regenerate from `/video/history`. If recurring, scale Railway RAM (`RAILWAY_RESILIENCE.md`) |
| "Generation failed: budget exceeded" | Hard cap hit | Raise cap via SQL (see Onboarding §1.2) OR wait until 1st of next month |
| "No topics yet" on brand detail page after research | Topic generation Gemini call failed | User clicks **Regenerate** button (auto-built into UI) |
| Brand research stuck at "Researching..." for >15 min | Worker died, periodic sweep will flip it `failed` within 5 min | User retries via Retry Research button |
| Videos play silently on download | Pre-merge URL was served (race condition during Realtime delay) | Refresh the history page, click Download again on the now-merged URL |

---

## 3 · Escalation process

| Severity | Trigger | Action |
|---|---|---|
| **P0** | `/api/generate` 5xx > 5 in 5 min, OR worker process exit, OR Supabase Storage 4xx/5xx, OR > 50% scene gen failure rate over rolling 1h | Page on-call (eng lead); spin up incident channel `#inc-YYYYMMDD`; status page updated within 15 min |
| **P1** | Sentry new issue tagged `runtime:worker`, OR single-provider failure rate > 30% for 15 min, OR queue depth > 100 for 10 min | Slack `#ottoflow-alerts`; investigate within 4h |
| **P2** | Anomalies in `/admin/system-health` (failure tile yellow), OR daily digest shows cost above $50/day | Email digest, address within 24h |

### Incident-channel template

```
:rotating_light: Incident #INC-{date}-{short-name}
Severity: P0 | P1
Started: <utc>
Symptoms: <one line>
Sentry: <link>
Affected users: <est. count or 'all'>
Mitigation: <one line>
Owner: <@person>
Next update: <time>
```

---

## 4 · Incident response

### Step-by-step for P0

1. **Acknowledge** in `#ottoflow-alerts` within 15 min — even just "investigating."
2. **Confirm scope** — visit `/admin/system-health` (`https://ottoflow-ai.vercel.app/admin/system-health`). Note which queues are deep, which failure counts are non-zero.
3. **Check Sentry** at `https://ottoflow.sentry.io/issues/?project=4511491204907008` for any new issue spike.
4. **Check Vercel deploys** — was the last deploy in the last 30 min? If yes, **roll back** (see §5) before deep-diving.
5. **Check Railway worker** — Railway service Active? Recent crash loop visible?
6. **Mitigation FIRST** — rollback, scale down traffic via rate limit env vars, or hot-fix the specific failing provider via removing it from the chain (set its env var to empty).
7. **Investigation** — only after mitigation. Update incident channel every 30 min.

### Mitigation toolbox

| Tool | When to use |
|---|---|
| Vercel rollback | Bad deploy regression |
| Railway rollback | Worker-side regression |
| Lower rate limit env (drop to 5/hr) | Stop the bleeding while you fix |
| Empty a provider's API key | Force the registry chain to skip the broken provider |
| Pause Supabase Realtime | Realtime publication backpressure (unlikely at beta scale) |
| Drain workers, lift hard cap to $100 | If users are getting blocked while you fix a cap calculation bug |

---

## 5 · Rollback plan

### Vercel (frontend + API routes)

1. Visit https://vercel.com/joseph-ottoflow-s-projects/ottoflow-ai/deployments
2. Find the last known-good Production deployment (status: Ready, no Error badge).
3. Click •••  → **Promote to Production** (Vercel calls it Redeploy with that same commit).
4. Wait ~3 min for traffic switch.
5. Verify by visiting `/api/debug/health` (admin-gated) — JSON should respond, all 8 checks green.

### Railway (worker)

1. Open https://railway.com/project/6f03b33a-9433-4e21-bdbc-1c47525dd5a1
2. Click the `ottoflow-ai` service.
3. **Deployments** tab → find the last successful deployment from the History.
4. Click **Redeploy** on that row → confirm.
5. Wait ~5 min for worker rebuild + boot.
6. Verify by checking Sentry for a `worker.boot.success` breadcrumb in the next 5 min.

### Database (migration rollback)

⚠️ The repo follows a forward-only migration policy. There is no
automated rollback. To revert a migration:

1. Identify the bad migration (e.g. `008_user_budgets.sql`).
2. Write the reverse SQL by hand:
   ```sql
   DROP TABLE IF EXISTS ai_usage_ledger;
   DROP TABLE IF EXISTS user_budgets;
   DROP FUNCTION IF EXISTS record_ai_usage;
   ```
3. Run in Supabase SQL editor.
4. Roll back the application code so it doesn't reference the dropped objects.

In practice: prefer to roll the code FORWARD with a hot-fix that
tolerates the bad schema. Migration rollback is the absolute last
resort.

### Provider key rotation (compromised secret)

1. **Immediately** delete the env var in Vercel + Railway (this is faster than rotating; the registry will skip the unavailable provider and fall through to Pexels).
2. Rotate the key with the provider's dashboard.
3. Re-paste the new value as a new env var on Vercel + Railway (Sensitive).
4. Redeploy.

---

## 6 · Daily operational tasks

| Frequency | Task | Owner |
|---|---|---|
| Hourly | Glance at `/admin/system-health` | On-call eng |
| Daily | Review Sentry digest email | On-call eng |
| Daily | Check Vercel + Railway billing pages for cost anomalies | On-call eng |
| Weekly | Run a synthetic generation via the brand-driven flow and verify it completes < 5 min | Operations |
| Weekly | Review `/analytics` provider table; investigate any provider with success rate < 90% over the week | Operations |
| Monthly | DR drill — restore latest Supabase snapshot to a scratch project, verify schema | Eng lead |

---

## 7 · Communication templates

### Status page update — provider outage

> "We're experiencing elevated error rates with our [Runway / Luma] video generation provider. Videos are still being produced via our fallback chain (Pexels stock), but visual quality may be reduced. Investigating with vendor; will update in 30 min."

### Email to affected user — generation failure

> "Hi {name}, your video generation for "{topic title}" hit an unexpected error during the {stage} stage. We've logged the issue and our team is investigating. As a one-time courtesy, we've not deducted this from your monthly budget. You can retry from your video history page at any time. If it fails again, please reply with the URL and we'll dig in."

### Internal post-incident

After every P0/P1, file a 3-paragraph postmortem in `docs/postmortems/INC-YYYYMMDD.md`:
- Symptoms + timeline
- Root cause
- Action items (with owner + due date)

---

## 8 · Beta-day-7 checkpoint

At day 7 of the beta, run this review meeting:

1. Open `LAUNCH_CHECKLIST.md`. Update any UNKNOWN rows that have been verified during the week.
2. Open `PROVIDER_VALIDATION_REPORT.md`. Run the SQL queries. Update the table with real data.
3. Open Sentry — total error count. New issues vs resolved.
4. Open `/analytics`. Provider success rates, cost burn.
5. Make a go / no-go call on opening to 10 → 25 → 50 users.

If you can't answer YES to "Can 10 users use this every day for 30 more
days?" with the same evidence as this turn's report, you do NOT expand
the beta. Fix the FAIL items first.
