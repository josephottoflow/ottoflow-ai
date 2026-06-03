# Railway Worker Resilience (B1.R4)

Operational runbook for scaling the worker past one replica without
duplicate processing or queue drift. Pairs with `BETA_READINESS_REPORT.md`.

---

## Current state (verified, not assumed)

| Property | Value | Source |
|---|---|---|
| Worker replicas | **1** | Railway → ottoflow-ai → Settings |
| Worker process | `node worker/dist/index.js` | `package.json:start:worker` |
| Concurrency | **2** per replica | `worker/index.ts WORKER_CONCURRENCY` |
| BullMQ queues | `brand-research`, `content-generation`, `video-merge` | `src/lib/queue.ts QUEUE_NAMES` |
| Redis | Railway-managed, vxvBQdyMSTKDxlhvVPnJoHXeGBAKNiEs@zephyr.proxy.rlwy.net:34949 | Vercel + Railway `REDIS_URL` |
| BullMQ jobId scheme | UUID per record (research_job.id, content_job.id, render_job.id) | `*/route.ts queue.add(..., { jobId })` |
| Graceful shutdown timeout | 25s | `worker/index.ts GRACEFUL_SHUTDOWN_TIMEOUT_MS` |
| Boot-time stuck-job sweep | Yes — `recoverStuckJobsAtBoot()` | `worker/recovery.ts` |
| Periodic stuck-job sweep | Yes — every 5 min, B1.R7 | `worker/recovery.ts schedulePeriodicSweep()` |

---

## Does multi-replica work today?

**Yes, with one caveat documented below.**

### What BullMQ does for free

BullMQ's job locking is **atomic Redis SET NX**:

1. When a worker calls `worker.processJob()` it issues `SET bull:<queue>:active:<jobId> <token> NX EX <lockDuration>`.
2. Only one replica's SET succeeds. The other replicas' SET returns nil — they leave the job alone and pull the next one.
3. Worker periodically extends the lock via `EXPIRE`.
4. If a worker dies, the lock expires after `lockDuration` (default 30s) and the job becomes available again.

This is correct for our needs. Adding a second replica WILL NOT cause duplicate processing of the same job ID.

### The jobId-dedup property

Our routes call `queue.add('merge', payload, { jobId })` with the database row's UUID. BullMQ treats jobs with the same `jobId` as one job — the second `.add()` is a no-op. This is **why the brand-retry flow has to call `queue.remove(jobId)` first** (see `src/app/api/brands/[id]/retry/route.ts`).

This property holds across replicas: jobId dedup is global, not per-worker.

### Caveat — concurrent generation by the SAME user

Two replicas each running a different scene from the same render_job is FINE (different jobIds). But two replicas running TWO video-merge jobs for the same user could push them past their hard cap simultaneously because `record_ai_usage()` checks the cap AFTER the call. The current implementation:

- Pre-flight check at `/api/generate` POST sees the user's `current_month_used_usd`.
- A second concurrent POST 1 second later sees the same number.
- Both pass, both run scene generation, both increment after spending.

Mitigation: rate limit at the API layer (20/hr already enforced) bounds this to at most ~$1.50 over the cap in the worst case. Hard mitigation would require `SELECT ... FOR UPDATE` on `user_budgets` row before queueing, but the simple cap is enough for beta.

---

## Scaling to 2 replicas (recommended for beta launch)

### Railway dashboard steps

1. Open https://railway.com/project/6f03b33a-9433-4e21-bdbc-1c47525dd5a1/service/1170f8dd-d50d-4b6d-9019-a31798890fca?environmentId=03985ea3-800a-420e-bb29-e947d4f08ea7
2. **Settings** → **Replicas** → set to **2**
3. Confirm **Resources**:
   - CPU: 1 vCPU per replica (default)
   - RAM: 1GB per replica → bump to 2GB if ffmpeg OOMs return
4. **Settings** → **Healthcheck** → set TCP port to whatever the worker listens on (currently none — see "Healthcheck gap" below)
5. Save and wait for both replicas to enter `Active`

### What you should see in Railway

- 2 Deployments under the same service
- Both running the SAME commit SHA
- Each pulls its own slice of the queue via BullMQ's atomic lock

### Verifying no double processing

After 5 min of running with 2 replicas, query Supabase:

```sql
SELECT job_id, COUNT(*) AS handler_runs
FROM (
  SELECT id AS job_id FROM brand_research_jobs WHERE status='done'
    AND completed_at > now() - interval '5 min'
) sub
GROUP BY job_id HAVING COUNT(*) > 1;
```

If this returns rows, replicas are racing. **Expected: zero rows.**

---

## Dead-letter queue support

BullMQ does not have a built-in DLQ. Our pattern:

- Failed jobs land in `bull:<queue>:failed` (a Redis ZSET) automatically after retries are exhausted.
- `/admin/system-health` surfaces the count per queue (B2 — see `src/app/admin/system-health/page.tsx`).
- An operator can inspect via Redis CLI: `ZRANGE bull:video-merge:failed 0 -1 WITHSCORES`.
- Retrying a failed job is manual today: pull the payload, call `queue.add()` with a fresh jobId.

**Future work (defer past beta):** add a dedicated `bull-dlq` worker that periodically inspects `:failed` ZSETs, attempts safe retries (e.g., scene-gen failures on transient 503), and emits alerts for unrecoverable patterns.

---

## Queue health monitoring

Two layers, both already implemented:

### 1. `/admin/system-health` (B2)
Real-time queue depths via Redis LLEN / ZCARD. Admin-only. Refreshes every 15s. Per queue:
- `wait` — jobs queued waiting for a worker
- `active` — jobs currently locked by a worker
- `failed` — jobs in the DLQ (post-retry)
- `delayed` — jobs scheduled for future processing
- `completed` — jobs in the success history (capped at `removeOnComplete: 1000`)

### 2. Periodic stuck-job sweep (B1.R7)
Every 5 min the worker runs `runOneSweep()` and logs `recovery.periodic.tick` with counters:
- `brandRecovered`, `contentRecovered`, `mergeRecovered`, `permanentlyFailed`

These show in Railway logs and as Sentry breadcrumbs. **Alert when any non-zero counter persists across 3 consecutive sweeps** — that means jobs are dying faster than the sweep heals them.

---

## Healthcheck gap

**Current:** Worker has no HTTP healthcheck endpoint. Railway can only TCP-ping the process which doesn't catch a hung Redis connection.

**Mitigation for beta:** Sentry breadcrumb `recovery.periodic.tick` fires every 5 min. If Sentry hasn't seen one in 15 min, the worker is stuck — page on-call.

**Future work:** Add a tiny HTTP `/healthz` listener inside the worker process that returns `200 OK` only when the Redis connection is healthy AND the latest sweep was within 10 min. Wire to Railway healthcheck.

---

## Replica restart behavior

On Railway deploy or replica restart:

1. SIGTERM lands → worker enters graceful shutdown (worker/index.ts).
2. `periodicSweepHandle` cleared (B1.R7).
3. All 3 BullMQ workers `.close()` in parallel.
4. Race against `GRACEFUL_SHUTDOWN_TIMEOUT_MS = 25s`.
5. If exceeded, force-close: in-flight jobs are abandoned. BullMQ's stalled-job detector sees them within 30-60s and re-queues for the next available worker.
6. New replica boots → `recoverStuckJobsAtBoot()` runs.

**Net effect:** at worst, a job that was 95% complete gets re-run from scratch. The deterministic `jobId` prevents the failed attempt from creating duplicate rows.

---

## Recommended Railway settings for beta

```
Replicas: 2
Vertical: 1 vCPU / 2 GB RAM
Restart policy: ON_FAILURE
Region: US East (matches Vercel)
Health check: TCP on whatever port the worker exposes (none today — set to default)
Auto-scale: OFF (manual at 2 — auto-scale doesn't add value at our volume)
```

---

## Known limitations carrying forward

1. **No per-user cost guard under concurrency** — see "Caveat" above. Bounded by 20/hr rate limit.
2. **No HTTP healthcheck** — relies on Sentry breadcrumb gap detection.
3. **No automated DLQ retry** — operator-manual.
4. **ffmpeg memory tuning is per-Railway-replica** — if you change CPU/RAM you may need to revisit `worker/processors/video-merge.ts` x264 settings.
