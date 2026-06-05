# Ottoflow AI — Worker Architecture

Reference for operators and contributors. Companion to
[DEPLOYMENT.md](./DEPLOYMENT.md) (env + per-platform setup) and
[PRODUCTION_AUDIT.md](./PRODUCTION_AUDIT.md) (open risks).

---

## 1. High-level topology

```
   POST /api/brands                        ┌─────────────────────────┐
   (Next.js on Vercel)        ────────►    │   Upstash Redis (TLS)   │
                                           │   BullMQ "brand-        │
                                           │   research" queue        │
                                           └────────┬────────────────┘
                                                    │
                                                    │ (BullMQ poll/blpop)
                                                    ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  Railway service: ottoflow-worker                                │
   │  ┌─────────────────────────────────────────────────────────────┐ │
   │  │  worker/dist/index.js  (esbuild-bundled CJS, runs on node)  │ │
   │  │                                                              │ │
   │  │   ┌─ worker-env.ts ── eager Zod validation at module load    │ │
   │  │   ├─ dotenv         ── no-op on Railway, loads on local dev  │ │
   │  │   ├─ ioredis        ── singleton, lifecycle events logged    │ │
   │  │   ├─ BullMQ Worker  ── concurrency = WORKER_CONCURRENCY      │ │
   │  │   └─ processor       ── multi-step Gemini pipeline           │ │
   │  └─────────────────────────────────────────────────────────────┘ │
   └──────────────────────────────────────────────────────────────────┘
                                                    │
            service-role admin client                │ Google AI
            (bypasses RLS — see AUTH_FLOW.md)        ▼
                                          ┌──────────────────────┐
   ┌────────────────────────┐             │  Gemini Flash 2.5    │
   │  Supabase Postgres     │             │  + Google Search      │
   │  + Realtime publishes  │             │  + URL Context        │
   └────────────────────────┘             └──────────────────────┘
        ▲
        │ Realtime broker streams brand_research_jobs UPDATEs
        │ back to the browser (Step 2 / B1) — RLS-scoped per user
```

---

## 2. Queue flow

| Stage | Component | Operation |
|---|---|---|
| 1. Enqueue | `src/app/api/brands/route.ts` | After creating `brands` + `brand_research_jobs` rows, calls `brandResearchQueue().add("research", payload, { jobId: <researchJobId> })`. The `jobId` opt makes BullMQ idempotent — a duplicate POST with the same `researchJobId` is a no-op. |
| 2. Persist | BullMQ → Redis | Stores the job under `bull:brand-research:<id>` and pushes to the waiting list. Atomicity is enforced by BullMQ's bundled Lua scripts. |
| 3. Claim | Worker | Each Worker concurrent slot does a blocking pop on the waiting list (BRPOPLPUSH-style) and moves the job to the `active` list with a per-job lock (`lockDuration`, default 30 s). |
| 4. Process | `worker/processors/brand-research.ts` | Five-step pipeline. Each step writes back to Postgres for UI Realtime updates. |
| 5. Complete or fail | BullMQ | On success, job moves to `completed` (auto-removed after `removeOnComplete: { age: 3600, count: 1000 }`). On failure, BullMQ retries up to `attempts: 2` with exponential backoff (`delay: 5000` × 2ⁿ). Final failure moves to `failed` (kept 24 h for postmortem). |

Queue-level config lives in
[`src/lib/queue.ts`](../src/lib/queue.ts):
```ts
const defaultJobOpts: JobsOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
};
```

---

## 3. BullMQ flow inside the processor

```
processBrandResearch(data, reportProgress)
│
├─ Step 1 ▸ fetching_site         (10%)  marker only; site fetch happens
│                                         inside Gemini's URL-context tool
│
├─ Step 2 ▸ extracting_profile    (45%)  Gemini structured-output call
│           writes brands.profile + name + industry early so the UI can
│           preview before the slower steps finish
│
├─ Step 3 ▸ finding_competitors   (70%)  Gemini + Google Search grounding
│           INSERT batch into competitors
│
├─ Step 4 ▸ generating_seo         (90%)  Gemini structured output
│           INSERT batch into keywords + content_pillars
│
└─ Step 5 ▸ finalizing            (100%) brands.status = 'ready';
            brand_research_jobs.status = 'done'; activity insert.
```

Per-step contract:
1. **startStep** writes `current_step` and an `info` log entry, then reports
   `progressAt - 8` to BullMQ so the UI knows we're starting that step.
2. The body runs (Gemini call + DB inserts).
3. **finishStep** sets `progress = progressAt` and a `success` log entry.

Every DB write goes through the Supabase **admin** client
(`createAdminClient`) because the worker has no user session. Tenant
isolation is preserved by ALWAYS scoping inserts/updates via
`brand_id` / `researchJobId` known to belong to the user who enqueued
the job. See AUTH_FLOW.md for the trust chain.

---

## 4. Redis flow + lifecycle visibility

`src/lib/queue.ts` owns a single `IORedis` instance:

- **`maxRetriesPerRequest: null`** — required by BullMQ; suppresses
  ioredis's command-level retries that interfere with BullMQ's own.
- **`enableReadyCheck: false`** — works around Upstash latency on the
  `INFO` command used by ioredis's ready check.
- **`retryStrategy(times) => Math.min(times * 100, 5000)`** — caps the
  reconnect delay at 5 s so a long Redis outage produces visible log
  lines at a reasonable cadence.

`attachRedisLogger(log)` (called once from `worker/index.ts`) wires every
ioredis lifecycle event into the structured-log stream:

| ioredis event | Log line | Means |
|---|---|---|
| `connect` | `redis.connect` | TCP/TLS handshake done |
| `ready` | `redis.ready` | Auth + select-db done; commands accepted |
| `close` | `redis.close` | Socket dropped (network blip, restart, etc.) |
| `reconnecting` | `redis.reconnecting` (with `delay`) | About to retry; delay derived from `retryStrategy` |
| `error` | `redis.error` (with `error`) | Connection-level error (DNS, TLS, auth) |
| `end` | `redis.end` | ioredis has stopped retrying (typically only on explicit `.quit()`) |

Observation pattern: if `redis.error` repeats without `redis.ready`, the
worker is misconfigured (URL / ACL / firewall). If `redis.close` +
`redis.reconnecting` + `redis.ready` cycle within a few seconds, that's
healthy automatic recovery from a transient drop.

---

## 5. Worker lifecycle

```
boot
  ▶ Step 1  load .env files (dotenv)              ──► no-op on Railway
  ▶ Step 2  validate worker env (zod)             ──► fail-loud + exit on miss
  ▶ Step 3  import BullMQ, queue, processor       ──► may touch process.env
  ▶ Step 4  attach Redis lifecycle logger         ──► observability primed
  ▶ Step 5  construct Worker(queue, handler)      ──► registers BRPOPLPUSH loop
  ▶ Step 6  register SIGINT / SIGTERM handlers    ──► graceful shutdown
  ▶          log "worker.started"

steady state
  ▶ Worker polls Redis, claims jobs, runs processor
  ▶ Per-job events ('active' / 'completed' / 'failed' / 'stalled') log
  ▶ Redis events log on any reconnect cycle
  ▶ process.on('unhandledRejection') logs warnings
  ▶ process.on('uncaughtException') logs + exit(1) → orchestrator restart

shutdown (SIGINT / SIGTERM)
  ▶ log "worker.shutdown.start"
  ▶ start graceful Worker.close()   ──► waits for active jobs
  ▶ race graceful vs 25s deadline
       ├─ graceful wins ──► log "worker.shutdown.complete"
       └─ deadline wins ──► log "worker.shutdown.force_close"
                            then Worker.close(true) (force)
  ▶ disconnectRedis() to flush ioredis cleanly
  ▶ process.exit(0)
```

### Why bounded shutdown matters
Railway sends SIGTERM at deploy time and waits ~30 s before SIGKILL.
An unbounded `worker.close()` waits for in-flight jobs indefinitely —
which is wrong when a Gemini call hangs. We cap at 25 s (safely inside
Railway's grace window) and force-close. Active jobs are abandoned;
BullMQ's stalled-job detection (`lockDuration`) re-queues them on the
next Worker, with `attempts` retry counting properly.

---

## 6. Failure modes (current handling)

| Failure | Detection | Recovery |
|---|---|---|
| Missing/invalid env at boot | `worker-env.ts` zod | Exit non-zero; Railway restart policy retries (max 10) |
| Bad `REDIS_URL` (DNS, TLS, auth) | `redis.error` event repeats | Logs visible; operator fixes env; worker reconnects automatically on next attempt |
| Transient Redis disconnect | `redis.close` → `redis.reconnecting` → `redis.ready` cycle | Automatic; in-flight job retries on the next worker via BullMQ stalled-job detection |
| Worker process killed mid-job | BullMQ stalled-job detection (default 30 s after lock expires) | Job re-claimed; `attemptsMade` increments; Postgres row stays at `running` until the new worker overwrites it ⚠️ |
| Job throws | BullMQ catches; emits `failed` event | Retried up to `attempts: 2`; processor catches inside and writes `brand_research_jobs.status='failed'` |
| Gemini timeout / hang | Not yet bounded ⚠️ | Worker slot blocked; addressed by **H3** (Phase 4) — `GEMINI_TIMEOUT_MS` env exists for that follow-up |
| Unhandled rejection | `process.on('unhandledRejection')` | Logged; process continues. Acceptable for one-off async fire-and-forget |
| Uncaught exception | `process.on('uncaughtException')` | Logged; exit(1); Railway restart |
| Deploy mid-job | SIGTERM → bounded graceful close → force | Lost jobs re-queued via stalled detection |

⚠️ marked items are tracked in [PRODUCTION_AUDIT.md](./PRODUCTION_AUDIT.md):
**H3** (Gemini timeout), **H4** (stuck `running` rows in Postgres). Both
are scheduled for Phase 4. The B3/B4 Step 4 scope does not include them
to keep the deployable-worker bar tight.

---

## 7. Restart behavior

Railway service config (in [`railway.json`](../railway.json)):

```json
{
  "deploy": {
    "startCommand": "npm run start:worker",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "numReplicas": 1
  }
}
```

| Scenario | Behavior |
|---|---|
| Normal deploy | SIGTERM → graceful close ≤25 s → exit(0). New revision boots before traffic resumes; queue jobs wait in Redis. |
| Worker crash (uncaughtException → exit 1) | Restart policy fires (`ON_FAILURE`). Up to 10 retries; after that Railway pages the service. |
| Env validation failure (exit 1 before steady state) | Same restart policy. Loops 10× before Railway gives up — fix env, redeploy. |
| OOM | SIGKILL by kernel; Railway treats as failure; restart policy fires. Active job re-queued by BullMQ stalled detection. |
| Scaling up (numReplicas > 1) | BullMQ coordinates job ownership via Redis (BRPOPLPUSH); no duplicate processing. Each replica claims work independently. |

### Why single-replica to start
With `WORKER_CONCURRENCY=2` (default), a single replica processes 2 jobs
in parallel. Most users won't hit that with brand research alone.
Scaling out is safe — when concurrent demand grows past one replica's
capacity, bump `numReplicas`. BullMQ's distributed semantics are
production-tested.

---

## 8. How to verify in production

### Smoke test after first deploy

1. Railway dashboard → worker service → **Logs**. Expect within 10 s of
   boot:
   ```
   {"scope":"redis","msg":"redis.connect"}
   {"scope":"redis","msg":"redis.ready"}
   {"scope":"worker","msg":"started","concurrency":2,...}
   ```
2. From the deployed Next.js app, sign in and create a brand
   (`/brands/new`). Watch the worker logs for:
   ```
   {"scope":"brand-research","msg":"job.active","jobId":"<uuid>",...}
   {"scope":"brand-research","msg":"step","step":"fetching_site",...}
   {"scope":"brand-research","msg":"step","step":"extracting_profile",...}
   ...
   {"scope":"brand-research","msg":"job.completed","durationMs":~60000}
   ```
3. The brand-detail page should transition `pending` → `researching` →
   `ready` with live progress.

### Graceful-shutdown test

Trigger any redeploy of the worker service. Logs should show:
```
{"scope":"worker","msg":"shutdown.start","signal":"SIGTERM","timeoutMs":25000}
{"scope":"worker","msg":"shutdown.complete","signal":"SIGTERM"}
```
If you see `shutdown.force_close` instead, an active job exceeded 25 s
— normal under load with Gemini; the queued job will be re-claimed on
the new revision.

### Failure-mode tests

| Test | How to trigger | Expect |
|---|---|---|
| Bad Redis URL | Set `REDIS_URL=rediss://wrong-host/` in Railway | Logs cycle `redis.error` / `redis.reconnecting`. Fix URL → reconnects without restart. |
| Bad Google API key | Replace `GOOGLE_API_KEY` with garbage | Next job: `job.failed` with error from `@google/genai`. After 2 attempts, `brand_research_jobs.status='failed'`. |
| Mid-job kill | Railway → Stop service while a job is running | Worker logs `shutdown.start`. Force-close after 25 s if job hung. On restart, BullMQ stalled detection re-queues; brand status will eventually be `failed` or re-process depending on attempts remaining. |

---

## 9. Build + deploy

### Local
```bash
npm run dev:worker      # tsx watch — fast iteration, no bundling
npm run build:worker    # esbuild bundle to worker/dist/index.js
npm run start:worker    # run the bundled output (what Railway runs)
```

### Railway
- Build command: `npm ci --include=dev && npm run build:worker`
  - `--include=dev` is required because `tsx` and `esbuild` live in
    devDependencies and Railway's default install drops devDeps.
    Without this, the build step (which uses esbuild) would fail.
    Alternative: move both to `dependencies`, but devDeps is the
    semantically-correct home for build-time tools.
- Start command: `npm run start:worker`
- Restart: ON_FAILURE, max 10 retries
- Replicas: 1 (scale-out is safe; not needed yet)

### Bundle size
`worker/dist/index.js` is ~12 MB un-minified. Minification cuts it to
~5 MB but loses stack-trace legibility in logs — we prioritized ops over
size. Node start-up is sub-second either way.

---

## 10. Related docs

- [DEPLOYMENT.md](./DEPLOYMENT.md) — env vars + per-platform setup
- [AUTH_FLOW.md](./AUTH_FLOW.md) — how Clerk JWTs become RLS context
  and where the worker's service-role escape hatch fits in
- [PRODUCTION_AUDIT.md](./PRODUCTION_AUDIT.md) — full risk register with
  severity grouping
- [ADR-001-video-composition-engine.md](./ADR-001-video-composition-engine.md)
  — Hybrid Remotion+FFmpeg architecture decision
- [VIDEO_TIMELINE_AUDIT.md](./VIDEO_TIMELINE_AUDIT.md) — the audit that
  surfaced the silent-fallback failure mode

---

## 11. Video-merge processor — post-ADR-001 architecture

The `video-merge` queue is a parallel third worker spawned alongside
`brand-research` and `content-generation`. Lifecycle, env validation,
shutdown, and recovery semantics are identical to the other two — but
the processor itself runs a deeper pipeline involving AI scene-gen
providers + Remotion + FFmpeg.

### Pipeline diagram (post-ADR-001 Phase 2+3)

```
                  Vercel /api/generate enqueues VideoMergeJobData
                  { renderJobId, scenes?, sceneSpecs?, overlays?,
                    audioDataUrl?, musicUrl?, videoUrl,
                    brandIndustry?, topicTitle?, aestheticNotes? }
                                       │
                                       ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  worker/processors/video-merge.ts                               │
   │                                                                  │
   │  ┌─────────────────────────────────────────────────────────┐    │
   │  │ 1. Scene generation (if sceneSpecs && length > 1)        │    │
   │  │    Concurrency=3, for each spec call:                    │    │
   │  │       registryGenerateScene(prompt + brand context)      │    │
   │  │       → Runway → Luma → Pexels chain                     │    │
   │  │    F1: sceneFailures[] collected per scene               │    │
   │  │    F4: failed slots padded with prefetched videoUrl     │    │
   │  │    progress: 5 → 28                                       │    │
   │  └────────────┬────────────────────────────────────────────┘    │
   │               │                                                   │
   │               ▼                                                   │
   │  ┌─────────────────────────────────────────────────────────┐    │
   │  │ 2. Audio download (parallel)                             │    │
   │  │    narration MP3 from data URL + music MP3 from URL      │    │
   │  │    progress: 28                                          │    │
   │  └────────────┬────────────────────────────────────────────┘    │
   │               │                                                   │
   │               ▼                                                   │
   │  ┌─────────────────────────────────────────────────────────┐    │
   │  │ 3a. Multi-scene path (hasScenes)                         │    │
   │  │     worker/render-remotion.ts                            │    │
   │  │     ┌─────────────────────────────────────────────────┐  │    │
   │  │     │ getBundleUrl() (cached after first call)         │  │    │
   │  │     │   @remotion/bundler → compiles remotion/         │  │    │
   │  │     │   into a webpack serve URL                       │  │    │
   │  │     ├─────────────────────────────────────────────────┤  │    │
   │  │     │ getComposition() (cached after first call)       │  │    │
   │  │     │   @remotion/renderer → spins up Chrome, loads    │  │    │
   │  │     │   Root.tsx, resolves MultiSceneVideo schema      │  │    │
   │  │     ├─────────────────────────────────────────────────┤  │    │
   │  │     │ renderMedia({                                    │  │    │
   │  │     │   composition, serveUrl, inputProps={scenes,     │  │    │
   │  │     │   overlays}, pixelFormat:'yuv420p', codec:'h264',│  │    │
   │  │     │   chromiumOptions:{enableMultiProcessOnLinux:    │  │    │
   │  │     │     false},                       (Phase 3.C)    │  │    │
   │  │     │   browserExecutable: REMOTION_CHROME_EXECUTABLE  │  │    │
   │  │     │     ?? auto-downloaded shell      (Phase 3.C)    │  │    │
   │  │     │ })                                               │  │    │
   │  │     │   wrapped in Promise.race(timeout = 5min default)│  │    │
   │  │     │   onProgress maps to 28..80 milestones (Phase 3.A)│ │    │
   │  │     └─────────────────────────────────────────────────┘  │    │
   │  │     → silent.mp4 (720x1280, 30fps, H.264, yuv420p,       │    │
   │  │       NO audio track)                                    │    │
   │  │     try/catch surfaces Sentry "remotion_render_failed"   │    │
   │  │       with renderJobId + sceneCount   (Phase 3.B)        │    │
   │  │                                                          │    │
   │  │ 3b. Single-clip fallback path (!hasScenes)              │    │
   │  │     Just `mv videoIn silent.mp4` — the prefetched        │    │
   │  │     Pexels clip is the silent video. No Remotion.        │    │
   │  │                                                          │    │
   │  │     progress: 30..80 (Remotion) or 80 (single-clip)      │    │
   │  └────────────┬────────────────────────────────────────────┘    │
   │               │                                                   │
   │               ▼                                                   │
   │  ┌─────────────────────────────────────────────────────────┐    │
   │  │ 4. Audio mux via FFmpeg                                  │    │
   │  │    ffmpeg -i silent.mp4 -i narration.mp3 -i music.mp3 \  │    │
   │  │      -filter_complex                                     │    │
   │  │      "[1:a]volume=1.0[narr];                             │    │
   │  │       [2:a]volume=0.251[mus];          (10^(-12/20) dB)  │    │
   │  │       [narr][mus]amix=inputs=2:duration=first[mix]"      │    │
   │  │      -map 0:v:0 -map [mix]                               │    │
   │  │      -c:v copy                  (NO re-encode of video!) │    │
   │  │      -c:a aac -b:a 192k -shortest merged.mp4             │    │
   │  │                                                          │    │
   │  │    progress: 95                                          │    │
   │  └────────────┬────────────────────────────────────────────┘    │
   │               │                                                   │
   │               ▼                                                   │
   │  ┌─────────────────────────────────────────────────────────┐    │
   │  │ 5. Supabase Storage upload                               │    │
   │  │    bucket=merged-videos                                  │    │
   │  │    path=<userId>/<renderJobId>.mp4                       │    │
   │  │    service-role admin client (bypasses RLS)              │    │
   │  │                                                          │    │
   │  │    progress: 100, merge_status='done', merged_video_url  │    │
   │  └─────────────────────────────────────────────────────────┘    │
   └─────────────────────────────────────────────────────────────────┘
```

### Why the silent.mp4 / audio.mp4 split

Two engines, one strict responsibility boundary:

- **Remotion** owns visual composition. Multi-scene `<TransitionSeries>`,
  `<OffthreadVideo>` per scene, animated `<OverlayText>` sequences. Output:
  silent H.264 MP4. See `remotion/Root.tsx`, `remotion/compositions/*.tsx`.

- **FFmpeg** owns audio mixing + final muxing. Same `amix=duration=first`
  + ducking pipeline that's been in production since the FFmpeg-only era.
  Stream-copies the silent video (`-c:v copy`) so we don't pay a second
  encode pass.

This makes the Chrome RAM footprint predictable (it's only there for
visual composition, never for the audio path) and lets us swap either
side independently if Remotion gets too expensive or FFmpeg gets a
better filter.

### Phase 3 ops knobs

| Env var | Default | Purpose |
|---|---|---|
| `REMOTION_RENDER_TIMEOUT_MS` | `300000` (5min) | Hard cap on a single renderMedia call. Catches Chrome hangs before BullMQ stalled-job recovery misclassifies the worker as crashed. |
| `REMOTION_CHROME_EXECUTABLE` | unset (auto-download) | Point Remotion at a specific Chromium binary (e.g. nix's). Useful when Railway redeploys wipe `~/.cache/remotion`. |
| `RUNWAYML_API_SECRET` | unset | Runway Gen-4 scene generation. Requires `PEXELS_API_KEY` for seed image. |
| `LUMA_API_KEY` | unset | Luma Ray-Flash text-to-video scene generation. |
| `PEXELS_API_KEY` | unset (recommended set) | Stock-clip scene fallback + Runway seed-photo search. Without this OR Luma, every video falls back to the single-clip prefetched videoUrl path. |

Worker boot logs `scene_providers.configured` with all four states so
operators can see scene-gen capability at a glance. When all three
provider keys are unset, the worker still boots (so brand-research +
content-generation continue working) but emits a structured WARN +
Sentry event explaining the degradation.

### Progress milestone schedule (post-Phase 2)

| Progress | Event |
|---|---|
| 5 | Scene generation loop entered (multi-scene path only) |
| 10 | Asset downloads started (narration + music in parallel) |
| 28 | Audio downloads complete; about to enter render step |
| 28..80 | Remotion renderMedia progress (interpolated from its 0..1) |
| 80 | silent.mp4 written (or single-clip rename done) |
| 95 | FFmpeg audio mux complete |
| 100 | Supabase Storage upload complete, `merged_video_url` set |

UI subscribes to `render_jobs` Realtime — these milestones tick the
progress bar smoothly throughout the merge instead of jumping from
0 to 100. See [VIDEO_PIPELINE_V2.md](./VIDEO_PIPELINE_V2.md) P0 for
the original silent-progress fix that enables this.

### Failure modes specific to this processor

| Failure | Detection | Recovery |
|---|---|---|
| Every scene-gen provider throws | `sceneFailures.length === sceneSpecs.length` | F1: write `merge_error` to render_jobs, captureFallback, fall back to single-clip path |
| Some scenes fail | `sceneFailures.length > 0 && < sceneSpecs.length` | F4: pad failed slots with prefetched videoUrl, continue to Remotion render |
| Remotion render fails (Chrome crash, asset 403, timeout) | renderMedia throws or 5min timeout fires | Phase 3.B: captureFallback + write merge_error + re-throw for BullMQ retry |
| FFmpeg audio mux fails | Non-zero exit code | Throw with full stderr tail, BullMQ retries per `attempts: 2` |
| Supabase Storage upload fails | Upload returns error | Throw, BullMQ retries |

Sentry tags for video-merge events: `queue: video-merge`,
`render_job.id: <uuid>`. Filter the Sentry dashboard by these tags
to see only video pipeline failures.
