# Ottoflow Video V1 — Seedance + FFmpeg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task once approved. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Constraint honored:** the operator asked for *"no code yet — implementation plan only."* This plan therefore gives exact file paths, the **SQL DDL** explicitly requested, TypeScript **contracts/signatures** (not full bodies), test strategy, and a ranked roadmap. Application logic is described, not written. Implementation begins only after sign-off **and** after P0–P3 + the Railway RAM bump (see §0).

**Goal:** Turn an Ottoflow content item into a brand-aligned, publish-ready LinkedIn video — Content → Video Strategy → Scene Plan → Seedance (scenes only) → FFmpeg (assemble/brand/caption/CTA) → Publish.

**Architecture:** Additive on [ADR-002](../../ADR-002-ffmpeg-multi-agent-pipeline.md) and [ADR-003](../../ADR-003-seedance-video-architecture.md). Seedance becomes a `VideoProvider` consumed in an "AI-first" orchestrator mode; a new `scene-generation` BullMQ queue runs Seedance polling off the Vercel ceiling; the existing `ffmpeg-compose` worker assembles. No rewrite of queues, composer, storage, or schema core.

**Tech Stack:** Next.js 14 (Vercel) · BullMQ + Redis · Railway worker · FFmpeg · Supabase (Postgres + Storage + Realtime) · Gemini · Seedance 2.0 (BytePlus ModelArk).

---

## 0 · Priority placement & gating (operating rules)

**Why:** completes the creative loop into video; reuses the live tension/metaphor engine.
**Higher priority than current work?** **No.** Live order: P0 Clerk prod keys → valid Basecamp headshot → P4 Phase 2 Brand Pattern Library → P5 publishing. Video is gated on the **Railway 1 GB→2 GB RAM bump** (ADR-002 §3).
**Now / Later / Defer:** this plan **now** (free); implement **later** (post P0–P3 + RAM bump); **defer** multi-shot/native-audio Seedance mode to V2.

**Two external unknowns to close before Task 3 (Seedance) ships:**
1. Confirm Seedance **commercial ToS** on BytePlus ModelArk.
2. Confirm real **720p/1080p per-second cost**.

---

## Reuse audit — exactly what is reused vs new (verified against the tree)

| Asset | Path | V1 disposition |
|---|---|---|
| `VideoProvider` interface | `src/lib/video-providers/types.ts` | **Reuse** — comment already names Veo/Higgsfield; add Seedance |
| Provider registry / chain | `src/lib/video-providers/registry.ts` | **Reuse** — insert `SeedanceProvider`, add `preferProvider:"seedance"` |
| Runway provider (template) | `src/lib/video-providers/runway.ts` | **Reuse as template** for the async create→poll→download shape |
| Scene Planner (Agent 3) | `src/lib/ffmpeg-pipeline/agents/03-scene-planner.ts` | **Reuse** — outputs 4 scenes `{sceneId,narration,visualGoal,emotion,searchIntent,visualStyle,keywords,startMs,endMs}` |
| Orchestrator | `src/lib/ffmpeg-pipeline/orchestrator.ts` | **Modify** — add AI-first branch in `runCompositionPhase` |
| Caption / Timing / Editor (Agents 8–10) | `agents/08,09,10` | **Reuse unchanged** |
| FFmpeg composer (Agent 11) | `agents/11-ffmpeg-composer.ts`, `ffmpeg.ts` | **Reuse**; extend filtergraph for brand/CTA layers |
| QC (Agent 12) | `agents/12-quality-control.ts` | **Reuse unchanged** |
| `ffmpeg-compose` worker | `worker/processors/ffmpeg-compose.ts`, `worker/index.ts` | **Reuse**; add `scene-generation` worker beside it |
| Queue helpers | `src/lib/queue.ts` | **Modify** — add `sceneGeneration` queue + payload type |
| `scene_generations` table | `supabase/migrations/007_scene_generations.sql` | **Reuse** — already stores per-scene clip + provider + Realtime; add `'seedance'` provider value + persisted-clip columns |
| `render_jobs` (composition_plan, qc_report, pipeline_version, r2_object_key, merge_status, merged_video_url, progress) | migration 009 + base | **Reuse**; add `video_strategy`, `render_kind`, `scene_provider` |
| R2 / GDrive storage | `r2.ts`, `gdrive.ts` | **Reuse unchanged** |
| Video UI | `src/app/video/{page,generate,history,[jobId]}` | **Modify** — add brand/topic-driven video flow + status |
| `asset_history`, `scene_candidates` | migration 009 | **Reuse** (AI-first writes scene_generations; candidate audit is optional in AI-first mode) |

**Not reused:** stock fan-out (Agents 4–7) is **bypassed in AI-first mode** — Seedance is the source, so search/score/diversity/consistency don't run for AI-first scenes (Pexels stays as the registry's last-resort safety net).

---

## File structure (V1)

```
src/lib/video-providers/
  seedance.ts                         ← NEW  SeedanceProvider implements VideoProvider
  registry.ts                         ← MOD  add SeedanceProvider to chain
src/lib/ffmpeg-pipeline/
  video-strategy.ts                   ← NEW  Content → VideoStrategy (Gemini, reuses tension/metaphor)
  orchestrator.ts                     ← MOD  AI-first branch in runCompositionPhase
  agents/11-ffmpeg-composer.ts        ← MOD  brand overlay + CTA end card in filtergraph
  ass-captions.ts                     ← reuse
  types.ts                            ← MOD  VideoStrategy, RenderKind, AI-first plan flags
src/lib/queue.ts                      ← MOD  sceneGeneration queue + SceneGenerationJobData
worker/
  index.ts                            ← MOD  register sceneGenerationWorker
  processors/scene-generation.ts      ← NEW  poll Seedance per scene → copy to R2 → enqueue ffmpeg-compose
src/app/api/video/
  generate/route.ts                   ← NEW/MOD  Agents1–3 + VideoStrategy, enqueue scene-generation
src/app/video/...                     ← MOD  brand/topic flow, status, player
supabase/migrations/
  022_video_v1.sql                    ← NEW  render_jobs + scene_generations columns
```

---

## Video Strategy design (reuses Topic → Visual Tension → Visual Metaphor)

**Object** (stored in `render_jobs.video_strategy` JSONB; mirrors the still-creative brief so image + video share one thesis):

```jsonc
{
  "video_concept":   "",   // one-line creative thesis (Gemini)
  "visual_tension":  "",   // REUSED from content_creatives brief, e.g. "Chaos vs Clarity"
  "visual_metaphor": "",   // REUSED, e.g. "jumbled lines converging into one hub"
  "brand_worldview": "",   // brand's recurring visual stance (calm, structured, human)
  "scenes": [
    { "role": "problem",  "sceneId": 1, "prompt": "", "seed": 0, "durationSec": 5 },
    { "role": "tension",  "sceneId": 2, "prompt": "", "seed": 0, "durationSec": 5 },
    { "role": "solution", "sceneId": 3, "prompt": "", "seed": 0, "durationSec": 5 },
    { "role": "outcome",  "sceneId": 4, "prompt": "", "seed": 0, "durationSec": 5 }
  ]
}
```

**4-scene mapping** (the metaphor's poles drive the arc):

| Scene | Role | Driven by |
|---|---|---|
| 1 | Problem | negative pole of `visual_tension` |
| 2 | Tension | the collision the metaphor dramatizes |
| 3 | Solution | the metaphor resolving |
| 4 | Outcome | positive pole + `brand_worldview` |

**Real Ottoflow example — verified live this session** (Basecamp, LinkedIn, "End the Chaos: One Place for All Your Team's Work"; tension/metaphor read directly from the live creative brief):

```jsonc
{
  "video_concept": "Fragmented work resolves into one calm, organized hub.",
  "visual_tension": "Chaos vs Clarity",
  "visual_metaphor": "Disparate, jumbled lines and shapes converging and organizing into a singular, clear, flowing pathway or central hub.",
  "brand_worldview": "Calm, structured, human — order without pressure.",
  "scenes": [
    { "role":"problem",  "sceneId":1, "durationSec":5,
      "prompt":"Vertical 9:16. Tangled, scattered abstract lines and fragments drifting chaotically across a muted slate field, restless jittery motion, no text, no logos, no people." },
    { "role":"tension",  "sceneId":2, "durationSec":5,
      "prompt":"Vertical 9:16. The scattered fragments begin straining and pulling toward an unseen center, tension building, lines bending inward, Basecamp green accents emerging." },
    { "role":"solution", "sceneId":3, "durationSec":5,
      "prompt":"Vertical 9:16. Lines smoothly converge and organize into one clean, flowing central hub, calm resolution, soft Basecamp green glow, ordered geometry." },
    { "role":"outcome",  "sceneId":4, "durationSec":5,
      "prompt":"Vertical 9:16. A single calm, structured hub gliding steadily forward, balanced composition, confident and serene, gold accent highlight." }
  ]
}
```

**Integration with current creative gen:** `visual_tension`/`visual_metaphor` are already produced per content item and rendered in the still creative (verified live). Video Strategy reads the *same* fields — zero second engine; the brand's image and video share one visual thesis.

---

## Seedance integration design

| Decision | V1 choice |
|---|---|
| **Which API** | **Official BytePlus ModelArk** task API (`Create / Retrieve / List / Cancel video generation task`). USD billing, commercial via BytePlus ToS. (Aggregators fal.ai/Segmind/PiAPI are fallback options only, not V1.) |
| **Auth** | `SEEDANCE_API_KEY` (+ base URL/region) as **worker-only** env on Railway. Never on Vercel (polling runs in the worker). Mirrors `RUNWAYML_API_SECRET`. |
| **Async flow** | POST create task → receive `task_id` → poll `GET task` until `succeeded` → read MP4 URL. Per-scene (one task per scene plan). |
| **Polling** | 4 s interval, 180 s timeout per scene (Seedance typical 30–120 s). Same shape as `runway.ts` `POLL_INTERVAL_MS`/`POLL_TIMEOUT_MS`. |
| **Retry** | BullMQ job-level `attempts: 3`, exponential backoff 5 s (override the queue default of 2). Per-scene jobs so one slow scene doesn't re-run the others. |
| **Failure handling** | Per scene: Seedance fail → registry falls through to **Runway → Luma → Pexels** (last-resort never fails). Record `fallback_reason` in `scene_generations`. A job fails only if *every* provider fails for a scene. |
| **Clip download** | **Copy to R2 immediately** — Seedance output URLs **expire ~1 h**. Worker streams the MP4 to disk then `uploadToR2` under `{userId}/{renderJobId}/scene-{n}.mp4`; store the R2 URL in `scene_generations.storage_url`. The `ffmpeg-compose` payload references the durable R2 URLs, not the ephemeral Seedance ones. |

**Where it plugs in (exact):**
1. `SeedanceProvider implements VideoProvider` in `src/lib/video-providers/seedance.ts`:
   ```ts
   export class SeedanceProvider implements VideoProvider {
     name = "seedance";
     isConfigured(): boolean;                       // !!SEEDANCE_API_KEY
     generateScene(req: SceneRequest): Promise<SceneResult>; // create→poll→{url,durationSec,width,height,provider,costUsd}
   }
   ```
2. Registry chain becomes `[SeedanceProvider, RunwayProvider, LumaProvider, PexelsFallbackProvider]`.
3. AI-first mode calls `registry.generateScene(req, { preferProvider: "seedance" })` **once per scene** — but from the **new `scene-generation` worker**, not from Agent 4 (so polling is off the Vercel 300 s ceiling).

---

## FFmpeg assembly design (2–4 clips, 4–15 s each)

| Step | Approach (reuses ADR-002 levers) |
|---|---|
| **Normalize** | Per clip: `scale=1080:1920:force_original_aspect_ratio=increase, crop=1080:1920, format, setpts=PTS-STARTPTS, fps=30` (fps **last**) + input `-r 30` (CFR for xfade). Single-decode normalize pass. |
| **Transitions** | **V1: hard cuts** via concat demuxer (single decode → fits 2 GB). xfade/dissolve enabled only at ≥4 GB (2 simultaneous decodes). Agent 10 already chooses per emotion. |
| **Captions** | Agent 8 compresses ≤22 ch/≤2 lines → ASS burn-in via libass (`ass=captions.ass`). Per-brand ASS style in V2. |
| **Logo overlay** | `overlay` bottom-right with palette-aware scrim — same placement as the still compositor. |
| **Brand overlay** | V1: optional low-opacity transparent PNG `overlay`; full Brand Pattern/LUT system is V2 (§ADR-003 Phase 6). |
| **CTA end card** | 2–3 s card (sharp-rendered still using the creative's CTA + palette) concatenated last. |
| **Export** | `libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -profile:v high -level 4.0 -c:a aac -b:a 192k -movflags +faststart`, `-threads 2 -filter_complex_threads 2`. **LinkedIn target: 1080×1920 (also accepts 1:1/16:9 — V1 ships 9:16 only).** |

**Recommended FFmpeg architecture:** keep the existing **multi-pass** model — `N × normalize(single decode)` → `concat join` → `overlay(logo+brand) + ass(captions)` → `concat CTA card` → encode. Never load all scenes in one filtergraph (the 1 GB OOM root cause). This is the validated ADR-002 path with two added overlay/concat passes.

---

## Database design (exact schema — migration 022)

Most storage already exists (`scene_generations`, `render_jobs.composition_plan/qc_report/pipeline_version/r2_object_key`). Changes are **additive, nullable, idempotent**:

```sql
-- 022_video_v1.sql
-- Ottoflow Video V1 (Seedance + FFmpeg). Additive only.

-- 1. render_jobs — video-strategy + AI-first markers (analytics + replay)
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS video_strategy JSONB;        -- frozen VideoStrategy object
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS render_kind     TEXT;         -- 'stock' | 'ai-first'
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS scene_provider  TEXT;         -- dominant provider, e.g. 'seedance'

-- 2. scene_generations — persist the durable R2 copy (provider URL expires ~1h)
ALTER TABLE scene_generations ADD COLUMN IF NOT EXISTS storage_url TEXT;       -- R2 public URL of the copied clip
ALTER TABLE scene_generations ADD COLUMN IF NOT EXISTS storage_key TEXT;       -- R2 object key
ALTER TABLE scene_generations ADD COLUMN IF NOT EXISTS seed        BIGINT;     -- generation seed (reproducibility)
-- provider column is free-text TEXT → 'seedance' needs no enum change.

CREATE INDEX IF NOT EXISTS render_jobs_render_kind_idx ON render_jobs(render_kind);
```

**New queue** (code, not SQL — `src/lib/queue.ts`):
```ts
QUEUE_NAMES.sceneGeneration = "scene-generation";
export interface SceneGenerationJobData {
  renderJobId: string;
  userId: string;
  strategy: VideoStrategy;     // the frozen 4-scene plan
  gdriveAccessToken?: string | null;
}
```

**No new table needed for V1.** A dedicated `video_strategies` table is deferred to V2 (only if strategy reuse across jobs becomes a feature).

---

## Railway design

| Dimension | Finding |
|---|---|
| **Minimum RAM** | **2 GB** — validated floor for multi-pass concat (hard cuts) at concurrency 1 (ADR-002 §3). V1 hard-cut path fits here. |
| **Recommended / production target** | **4 GB.** V1 adds overlay + CTA-concat passes; V2 wants xfade (2 simultaneous 1080×1920 decodes) + concurrent `scene-generation` and `ffmpeg-compose`. 4 GB gives headroom for transitions, brand layers, and parallelism without the non-deterministic OOM. **Ship V1 on 2 GB; set 4 GB as the production target before enabling xfade/concurrency.** |
| **CPU** | FFmpeg is the only CPU load; capped at `-threads 2`. **No GPU** — Seedance inference is offloaded to BytePlus. |
| **Queue concurrency** | `scene-generation`: 2 (mostly I/O-wait on Seedance polls). `ffmpeg-compose`: **1 at 2 GB**, raise to 2 at 4 GB. |

**Verdict:** **2 GB is sufficient for V1 launch; 4 GB is the production target** for transitions, brand layers, and concurrency.

---

## V1 Roadmap (ranked by priority)

> Each task lists files + bite-sized steps. Code bodies are intentionally omitted (operator constraint); steps state the contract + test. TDD: write the failing test, implement, verify, commit.

### P1 — Task 1: Database migration 022 (foundation)
**Files:** Create `supabase/migrations/022_video_v1.sql` (DDL above).
- [ ] Step 1: Write the migration (DDL above), idempotent (`IF NOT EXISTS`).
- [ ] Step 2: Apply via Supabase Management API (`POST …/database/query`) per the deploy playbook; verify columns via catalog query.
- [ ] Step 3: Commit `supabase/migrations/022_video_v1.sql`.

### P1 — Task 2: `scene-generation` queue + payload
**Files:** Modify `src/lib/queue.ts` (QUEUE_NAMES, `SceneGenerationJobData`, `JobPayloads`, accessor `sceneGenerationQueue()`).
- [ ] Test: `getQueue("scene-generation")` returns a typed Queue; payload type compiles.
- [ ] Implement the queue name + payload + accessor (contract above).
- [ ] `tsc --noEmit` clean; commit.

### P1 — Task 3: SeedanceProvider (gated on ToS + cost confirmation §0)
**Files:** Create `src/lib/video-providers/seedance.ts`; modify `registry.ts`.
- [ ] Test: `isConfigured()` false without `SEEDANCE_API_KEY`; `generateScene` maps a mocked succeeded task → `SceneResult{provider:"seedance",url,durationSec,width,height}`; throws on FAILED.
- [ ] Implement create→poll→download against ModelArk (mirror `runway.ts`; 4 s/180 s).
- [ ] Insert into registry chain first; add `listProviders()` coverage.
- [ ] Commit.

### P2 — Task 4: Video Strategy generator + Scene Planner reuse
**Files:** Create `src/lib/ffmpeg-pipeline/video-strategy.ts`; modify `types.ts` (`VideoStrategy`).
- [ ] Test: given a content brief with `visual_tension`/`visual_metaphor`, produces a 4-scene strategy with roles problem/tension/solution/outcome and non-empty prompts seeded by the metaphor poles.
- [ ] Implement Gemini call; reuse Agent-3 scene IDs/timestamps.
- [ ] Commit.

### P2 — Task 5: Orchestrator AI-first branch
**Files:** Modify `src/lib/ffmpeg-pipeline/orchestrator.ts`, `types.ts`.
- [ ] Test: with `renderKind:"ai-first"`, `runCompositionPhase` builds `SelectedClip`s from the scene-generation results (bypassing Agents 4–7) and still runs Agents 8–10 → valid `CompositionPlan`.
- [ ] Implement the branch (stock path unchanged).
- [ ] Commit.

### P2 — Task 6: scene-generation worker processor
**Files:** Create `worker/processors/scene-generation.ts`; modify `worker/index.ts`.
- [ ] Test: processes a `SceneGenerationJobData` → calls registry per scene, copies each clip to R2, writes `scene_generations` rows (provider, storage_url, seed, fallback_reason), then enqueues `ffmpeg-compose`; partial scene failure falls through providers, not the whole job.
- [ ] Implement; register `sceneGenerationWorker` (concurrency 2) with the same Sentry/recovery wiring as siblings.
- [ ] `npm run build:worker`; commit.

### P3 — Task 7: FFmpeg brand + CTA layers
**Files:** Modify `src/lib/ffmpeg-pipeline/agents/11-ffmpeg-composer.ts`, `ffmpeg.ts`.
- [ ] Test: filtergraph builder adds logo `overlay` + optional brand PNG + concatenated CTA card; output probes to 1080×1920, faststart, expected duration.
- [ ] Implement as additional multi-pass steps (no single-graph regression).
- [ ] Commit.

### P3 — Task 8: Vercel API route
**Files:** Create/modify `src/app/api/video/generate/route.ts`.
- [ ] Test: POST {brandId, contentItemId, platform:"linkedin"} → runs Agents 1–3 + Video Strategy, creates `render_jobs` (`render_kind:"ai-first"`), enqueues `scene-generation`, returns jobId; never polls Seedance in-request.
- [ ] Implement; commit.

### P4 — Task 9: UI — brand/topic video flow + status
**Files:** Modify `src/app/video/generate/VideoGenerateClient.tsx`, `src/app/video/[jobId]/VideoDetailClient.tsx`, `src/app/video/VideoPageClient.tsx`.
- [ ] Test (component/e2e-lite): select brand + content item → "Generate Video" → progress (scene 1–4 → compose → done) via `render_jobs.progress` + `scene_generations` Realtime; player shows final R2 MP4; "Download".
- [ ] Implement; commit.

### P5 — Task 10: Analytics
**Files:** modify analytics query layer (`src/lib/db.ts` / analytics page).
- [ ] Test: aggregates per `scene_provider` (success rate, avg generation_time_ms, cost_usd from `scene_generations`) and per `visual_tension`/metaphor (which performs best).
- [ ] Implement; commit.

**Ranking rationale:** DB + queue + provider (P1) are the load-bearing foundation; strategy + orchestrator + worker (P2) make a video actually generate; FFmpeg layers + API (P3) make it brand-ready and triggerable; UI (P4) and analytics (P5) make it usable and measurable. Items 1–6 deliver a generatable (if plain) video end-to-end; 7–10 make it publish-ready and observable.

---

## Self-review (spec coverage)

- Reuse audit ✓ · Video Strategy + 4-scene + **real Basecamp example** ✓ · Seedance integration (API/auth/async/poll/retry/failure/download/plug-in point) ✓ · FFmpeg assembly ✓ · DB schema (exact DDL) ✓ · Railway (RAM/CPU/concurrency, 2 GB vs 4 GB) ✓ · V1 roadmap (7 areas, ranked) ✓ · Final recommendation ✓.
- Placeholder scan: SQL is concrete; TS is intentionally contract-level per the "no code yet" constraint (declared up front).
- Type consistency: `VideoStrategy`, `SceneGenerationJobData`, `render_kind:'ai-first'`, provider `"seedance"`, `storage_url` used consistently across tasks.

---

## Final recommendation

1. **Is Seedance the correct provider for Ottoflow?** **Yes** — real official async API (BytePlus ModelArk), text+image-to-video, native 9:16, reference-based consistency, optional audio, cheap vs Runway/Sora, zero GPU on our infra. Keep it behind the registry so Veo/Runway/Luma remain swappable hedges.
2. **Does it fit ADR-002?** **Yes** — it slots into the `VideoProvider` seam ADR-002 already designed; the composer, QC, storage, and route-vs-worker boundary are unchanged.
3. **Can it be integrated without major rewrites?** **Yes** — additive: 1 provider file, 1 registry line, 1 new queue, 1 orchestrator branch, 1 strategy module, 1 worker processor, 1 additive migration. No core rewrite.
4. **Fastest path to production-ready Video V1:**
   - **(a)** Apply the Railway **2 GB** bump (shared ADR-002 unblock) and confirm Seedance **ToS + cost**.
   - **(b)** Ship Tasks 1–6 → first end-to-end AI-first LinkedIn video (hard cuts, 720p, logo + captions).
   - **(c)** Ship Tasks 7–8 → brand overlay + CTA + API trigger = publish-ready.
   - **(d)** Tasks 9–10 → UI + analytics.
   - **(e)** Then move to **4 GB** and enable xfade/brand-pattern (V2).

**Critical answer:** Seedance integrates cleanly into the ADR-002 FFmpeg architecture without major rewrites; the only hard prerequisite is the Railway RAM bump (already required for video regardless of Seedance), plus confirming Seedance's commercial ToS and real cost.
