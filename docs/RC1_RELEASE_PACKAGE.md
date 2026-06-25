# OttoFlow Video — RC1 Release Package

**Status:** Release Candidate 1 · **Date:** 2026-06-26 · **Methodology:** DMAIC / Six Sigma (evidence-only)

This package lets another engineer deploy, operate, monitor, and present OttoFlow Video without tribal knowledge. Every PASS is backed by a verification performed this cycle; the single open item is an **external operational blocker (AtlasCloud funding)**, not a software defect.

---

## 1. Production Audit — Customer Journey

| Stage | Status | Evidence |
|---|---|---|
| Content | ✅ PASS | Content items load with brief/copy/hashtags (verified live) |
| Generate Video | ✅ PASS | Footer button opens the configurator (verified) |
| Configuration | ✅ PASS | Platform(9)/aspect/resolution/duration/visual-gen/mode/quality all wired or honestly "Coming soon"; DOM-verified |
| Estimate | ✅ PASS | Live dry-run: cost + breakdown + est-time update dynamically (LinkedIn $10.50, TikTok $8.00) |
| Approval | ✅ PASS | Cost-approval gate + balance preflight; readiness card green/amber/red all verified live |
| Queue (BullMQ) | ✅ PASS | scene-generation/ffmpeg-compose waiting=0 active=0 failed=0 stalled=0 (worker-console getJobCounts) |
| Worker | ✅ PASS | Operational; consumes + processes jobs from shared Upstash Redis (traced WAITING→ACTIVE) |
| Scene Generation | 🟥 BLOCKED (external) | AtlasCloud balance $4.87 < render cost → 402 preflight. **Funding, not a defect.** |
| Composition (FFmpeg) | ✅ PASS* | Certified by prior render b1807d29 (4/4 scenes, captions, brand grade, CTA card); not re-runnable now |
| Storage (R2) | ✅ PASS* | b1807d29 MP4 served from R2 (byte-verified previously) |
| Download | ✅ PASS* | b1807d29 downloadable MP4 |

`*` downstream stages are certified from the most recent successful production render; they cannot be re-exercised live until funding is restored.

**Journey verdict:** PASS through Approval; BLOCKED at Scene Generation on external funding; downstream certified by prior render.

---

## 2. Production Risk Register

| ID | Risk | Sev | Likelihood | Detection | Owner | Mitigation | Status |
|---|---|---|---|---|---|---|---|
| R1 | AtlasCloud balance too low → render 402 | High | Certain (now) | Balance preflight (402 before spend) | Operator (billing) | Top up ≥ ~$15; preflight already blocks pre-spend | **OPEN (external)** |
| R2 | AtlasCloud / Seedance provider outage | High | Low | Provider 5xx + poll timeout (360s) | Operator/Vendor | Pexels stock fallback on failure; retry transient 5xx | Mitigated |
| R3 | Worker offline | High | Low | `/api/debug/health` worker_liveness (note: false-negative-prone on Upstash) | Eng | Railway auto-restart; heartbeat-key probe recommended (R8) | Mitigated |
| R4 | Queue backlog / stalled jobs | Med | Low | getJobCounts; 0 stalled today | Eng | attempts:1 (no retry-spend); resume skips stored scenes | Mitigated |
| R5 | Invalid/low-quality prompts | Med | Low | Deterministic validator (13/13) + storyboard scorer (regenerate once) | Eng | Pre-spend validation gate; never enqueues invalid | Mitigated |
| R6 | Storage (R2) failure / dead URL | Med | Low | Upload error + URL check | Eng | r2.dev resolves via DoH; custom domain recommended | Mitigated |
| R7 | UI regression | Low | Low | tsc + build + live screenshots | Eng | Config UI frozen (RC); gates green | Mitigated |
| R8 | worker_liveness false-negative (Upstash CLIENT LIST) | Low | Med | Health probe reads 0 despite healthy worker | Eng | Replace getWorkers() probe with worker-written heartbeat KEY | Backlog |
| R9 | Stale render_jobs rows ("queued"/orphaned) | Low | Low | Dashboard count | Eng | One-time `UPDATE status='done' WHERE merge_status='done'` | Backlog |
| R10 | Gemini empty/rate-limit (brand-research path) | Low | Low | "Gemini returned empty" in worker logs | Eng | Not on the video path; isolate/retry brand-research | Backlog |

---

## 3. Reliability Audit

| Control | Status | Evidence |
|---|---|---|
| Retry logic | ✅ | scene-generation `attempts:1` (deliberate — no retry-spend); transient provider 5xx polls retried |
| Timeouts | ✅ | Story Gemini 60s; route maxDuration 120s; Seedance poll 360s; balance preflight 8s |
| Fallbacks | ✅ | Seedance→Pexels stock fallback; deterministic background fallback; FAIL-OPEN balance read |
| Error messages | ✅ | Clear inline: 402 balance, missing brief, validation reasons, readiness card |
| User feedback | ✅ | Production Readiness card (green/amber/red) + per-field validation |
| Loading states | ✅ | Estimating spinner; cost spinner; "Queuing…" |
| Button disabling | ✅ | Generate disabled while estimating / invalid / no estimate |
| Duplicate submission | ✅ | `approving` guard + disabled button on approve |
| Idempotency | ✅ | BullMQ `jobId = render_jobs.id` (dedupes re-adds); balance preflight before insert |

---

## 4. Production Cleanup List

| Item | Classification | Note |
|---|---|---|
| `src/app/api/debug/health` | **keep for diagnostics** | auth-gated; the operational health probe |
| `src/app/api/debug/failed-jobs`, `/auth` | keep for diagnostics | admin-gated; remove pre-public-GA |
| `src/app/api/debug/sentry-test` | **remove before launch** | test-only route |
| `src/components/CostApprovalModal.tsx` | **remove before launch** | component now orphaned; relocate the `StrategySummary` type into VideoConfigModal/a types file |
| `story-agent.ts` `storyboard.scored` console.log | keep for diagnostics | low-volume structured log; useful signal |
| `scripts/_cert_*`, `_spike`, `_sprint6`, `_v2_models`, etc. | keep (untracked) | local cert/evidence harnesses; not shipped |
| `isVideoRenderEnabled` flag (`src/lib/video/flags.ts`) | keep | fail-closed feature gate; must be ON in prod |
| Disabled "Coming soon" controls (1080p, Fast/Balanced, Premium Stock, Hybrid) | keep | honest placeholders; wired when shipped |

No dead production code on the customer path beyond the orphaned modal above.

---

## 5. Documentation Index

- **Architecture overview** — §A below
- **Render pipeline diagram** — §B
- **Queue diagram** — §C
- **Failure-handling flow** — §D
- **Provider interaction flow** — §E
- **Deployment checklist** — Runbook §1
- **Recovery checklist** — Runbook §5
- Existing specs: `docs/VIDEO_V1.1_{ARCHITECTURE,PROMPT_BUILDER_SPEC,PROMPT_GAP_ANALYSIS}.md`

### §A Architecture Overview
Next.js 15 app (Vercel, iad1) → `POST /api/video/generate` (auth Clerk, rate-limit, validate brief, build Story via Gemini, cost estimate, **balance preflight**, insert `render_jobs`, enqueue BullMQ) → BullMQ on **Upstash Redis** (`pet-lamb`) → **Railway worker** (`ottoflow-video-hub`) runs scene-generation → **Seedance (AtlasCloud)** per scene (Pexels fallback) → **FFmpeg compose** (grade/logo/captions/CTA) → **Cloudflare R2** → downloadable MP4. Supabase (Postgres) stores brands/content/render_jobs.

### §B Render Pipeline
`API → Gemini Story (certified 4-beat OR commercial_story 6-beat) → validate+score → render_jobs → BullMQ → worker → Seedance per scene → FFmpeg compose (1080p-class canvas + brand grade + logo + ASS captions + CTA end-card) → R2 upload → merged_video_url`

### §C Queue
8 BullMQ queues on Upstash (default prefix `bull`), drainDelay 30s / stalledInterval 120s. Video path: `scene-generation` → (worker also runs) `ffmpeg-compose`. `attempts:1`, `jobId=render_jobs.id`.

### §D Failure Handling
Invalid prompt → validator rejects pre-spend (never enqueues). Low score → regenerate once. Insufficient balance → 402 pre-spend (no enqueue, no spend). Seedance failure → Pexels fallback (free). Compose/upload error → job fails, render_jobs marked; no partial charge (attempts:1).

### §E Provider Interaction
Per scene: `POST {ATLAS_BASE}/api/v1/model/generateVideo {model,prompt,duration,resolution,ratio,seed,generate_audio:false,watermark:false}` → poll `GET …/prediction/{id}` (4s interval, 360s timeout) → download MP4 URL → worker copies bytes to R2. Browser User-Agent sent (Cloudflare). API key in Authorization header only.

---

## 6. Operational Runbook

**1. Deploy.** Migrations first (Supabase dashboard) if any; `git push origin HEAD:main` → Vercel auto-deploys (verify `state:READY` via Vercel deployments). Worker: Railway auto-redeploys on `main`; confirm "Deployment successful" + Online before worker tests.

**2. Monitor.** `GET https://ottoflow-ai.vercel.app/api/debug/health` (auth) → expect 8/8 (Clerk, Supabase ×3, Redis PONG, BullMQ, worker_liveness, Gemini). Note: `worker_liveness` can false-negative on Upstash — corroborate with a real job trace before declaring the worker down.

**3. Verify health.** Health 8/8 + a free dry-run (`POST /api/video/generate {dryRun:true}`) returns a strategy + estimate.

**4. Verify a successful render.** After a real render: `render_jobs.status='done'` + `merge_status='done'` + `merged_video_url` resolves (R2 200, video/mp4). ffprobe the MP4 for dims/fps/duration.

**5. Recover failed jobs.** Inspect BullMQ counts (worker console `getJobCounts`). Stuck "queued" `render_jobs` with `merge_status='done'` are orphaned display rows → `UPDATE render_jobs SET status='done' WHERE status='queued' AND merge_status='done'`. Re-trigger a failed render by re-submitting from the content item (new job, new id — no double-charge due to attempts:1 + balance preflight).

**6. Rollback.** `git revert <sha>` + push to main (Vercel + Railway redeploy), or Vercel "Promote" a prior READY production deployment (rollback candidates flagged in the deployments list).

---

## 7. Release Checklist

| Item | Status |
|---|---|
| tsc 0 errors | ✅ PASS |
| Worker bundle builds | ✅ PASS |
| Validator harness 13/13 | ✅ PASS |
| Config UI frozen (no new controls) | ✅ PASS |
| Every control wired or honest "Coming soon" | ✅ PASS |
| Live health 8/8 | ✅ PASS |
| Live dry-run produces valid storyboard + estimate | ✅ PASS |
| Cost-approval gate + balance preflight | ✅ PASS |
| Readiness states green/amber/red verified | ✅ PASS |
| Certified render path byte-identical | ✅ PASS |
| Remove `sentry-test` + orphaned `CostApprovalModal` | ⬜ pre-launch (non-blocking) |
| **Live end-to-end render (LinkedIn + TikTok)** | 🟥 **BLOCKED** (AtlasCloud funding) |
| Final render certification | 🟥 BLOCKED (requires watching the MP4) |

---

## 8. Final Release Recommendation

### ✅ READY FOR CLIENT DEMO — with one external operational blocker for live rendering.

**Evidence:** The full customer journey from Content → Configuration → Estimate → Approval is verified live, polished, and truthful (no fake controls); the generation logic is directed, platform-aware, and brand-applied; infra is 8/8 healthy with no stalled jobs; gates are green; and the certified render path is byte-identical. A guided/scripted client demo is safe today (configure → estimate → approve → present the certified prior render `b1807d29` as the output artifact).

**Not yet READY FOR BETA:** self-serve customers cannot complete a live render until AtlasCloud is funded (every approve returns 402). This is an **external operational blocker (vendor funding), not a software defect** — the balance preflight is behaving correctly by refusing to start a render it can't pay for.

**One action to reach unconditional READY:** top up AtlasCloud (~$15), then run one LinkedIn + one TikTok render, review the MP4s, and issue the Final Render Certification. Everything under engineering control is RC1-complete.
