# ADR-002: FFmpeg Multi-Agent Pipeline (Pictory/InVideo-class quality)

**Status:** Proposed
**Date:** 2026-06-06
**Deciders:** Joseph (joseph@ottoflow.ai)
**Supersedes:** ADR-001 (Hybrid Remotion + FFmpeg) — Remotion path retained as dead code until §10 rollback window expires.

---

## Context

ADR-001 chose Remotion + Chrome Headless for visual composition. After six commits hardening the path (Chromium auto-discovery, `chromeMode=chrome-for-testing`, GL swangle, parallel-encoding off, jpeg frames, transitions disabled) the Railway worker still OOMs at ~800 MB on every render. The 1 GB worker replica is the binding constraint — not a code defect we can squeeze further. Upgrading RAM unblocks the existing path but does not address the deeper problems:

1. **Stock footage is often irrelevant** to the narration — Pexels keyword extraction is shallow.
2. **The same clips repeat** — no per-user asset history; popular queries collapse to the same top results.
3. **Captions overflow** — drawtext chains use raw narration text with no compression layer.
4. **Pacing feels robotic** — every scene is a fixed duration with the same Ken Burns curve.
5. **Sources look inconsistent** — Pexels is the only stock source; AI generations (Runway/Luma) clash visually with stock when chained.
6. **The pipeline cannot self-correct** — no QC loop; bad outputs ship and the user sees them.

The goal of ADR-002 is not to fix render OOM. It is to rebuild the composition layer as a **multi-agent pipeline that selects, compresses, paces, edits, and validates** before it ever invokes FFmpeg — so the FFmpeg step is the cheap, mechanical end of a much smarter chain.

### Forces

| Force | Direction |
|---|---|
| Output relevance (caption ↔ visual ↔ narration) | ↑ Toward semantic agents |
| Asset uniqueness across user history | ↑ Toward dedup ledger |
| Mobile readability of captions | ↑ Toward compression agent |
| Visual consistency across mixed sources | ↑ Toward style filters at compose-time |
| Render cost / latency | ↑ Toward pure FFmpeg (no Chrome) |
| Engineering complexity | ↑ Toward Remotion (single render call) |
| Time to fix the current OOM | Tie (RAM bump = days, FFmpeg rewrite = days) |
| Vendor lock-in | ↑ Toward FFmpeg (commodity binary) |

---

## Decision

**Adopt pure FFmpeg composition driven by a 12-agent orchestrator. Drop Remotion + Chrome from the worker entirely.** Keep Runway + Luma as opt-in 5th-tier candidate sources behind a per-request toggle. Add Pixabay, Mixkit, Coverr alongside Pexels for stock breadth. Add an `asset_history` ledger so the same video is never reused inside a 100-job window per user.

### Why this is reversible

Every agent is a pure async function with a typed contract. The orchestrator is a single TypeScript file. If any agent regresses, swapping its implementation is a one-file change. The Remotion code (`worker/render-remotion.ts`, `remotion/`) stays in the tree for one release as a feature-flagged fallback (`USE_REMOTION=1` env override).

---

## Architecture overview

```
┌──────────────── /api/generate (Vercel SSE) ───────────────────┐
│  Agent 1: Content Strategist                                  │
│    Gemini → { hookStrategy, narrativeStrategy, ctaStrategy }  │
│  Agent 2: Script Writer                                       │
│    Gemini → { hook, problem, value, conclusion, cta, timing } │
│  Agent 3: Scene Planner                                       │
│    Gemini → 4× { narration, visual_goal, emotion,             │
│                  search_intent, visual_style, keywords[] }    │
│  Agent 4: Multi-Source Search                                 │
│    Gemini query expansion → Pexels/Pixabay/Mixkit/Coverr      │
│                            (+ optional Runway/Luma)           │
│    → 20-50 candidates/scene                                   │
│  Agent 5: Video Analysis                                      │
│    Gemini Vision OR cheap heuristic → score 0-10/candidate    │
│  Agent 6: Diversity                                           │
│    asset_history dedup → penalise frequently-used assets      │
│  Agent 7: Visual Consistency                                  │
│    color profile + grain + aspect filter → reject misfits     │
│  Agent 8: Caption Compression                                 │
│    Gemini → ≤2 lines, ≤22ch, ≤8 words, timed                  │
│  Agent 9: Timing                                              │
│    voiceover.duration → scene/caption/transition envelope     │
│  Agent 10: Video Editor                                       │
│    pick zoom/pan/xfade/pacing per scene & emotion             │
│  → enqueue BullMQ `ffmpeg-compose` job                        │
└────────────────────────────────────────────────────────────────┘
                                ↓
┌────────────── Railway worker (BullMQ consumer) ────────────────┐
│  Agent 11: FFmpeg Composition                                 │
│    download N clips + narration + music                       │
│    → single FFmpeg filter graph (scale/crop/zoompan/xfade/    │
│       ass-burn/amix/duck) → MP4                               │
│  Agent 12: Quality Control                                    │
│    parse ffprobe + frame-sample → score; if <8.5 → regen      │
│  Upload: Cloudflare R2 (primary) → Google Drive (fallback)   │
│  → mark render_jobs.merged_video_url + webhook                │
└────────────────────────────────────────────────────────────────┘
```

### Agent placement: route vs worker

Agents 1-10 run in the SSE handler so the user sees streaming progress. Agents 11-12 run in the BullMQ worker because they touch the filesystem (downloads, FFmpeg, R2 upload) and must survive Vercel's 300 s function ceiling. The boundary is the queue payload: agents 1-10 produce a fully-resolved `CompositionPlan`, the worker consumes that plan with zero further LLM calls except QC regen.

---

## Agent contracts (TypeScript shapes — full IO in `src/lib/ffmpeg-pipeline/types.ts`)

```ts
// Agent 1
StrategistOutput = { hookStrategy: string; narrativeStrategy: string;
                     ctaStrategy: string; audienceProfile: string;
                     emotionalArc: EmotionalBeat[] };

// Agent 2
ScriptOutput = { hook: ScriptSection; problem: ScriptSection;
                 value: ScriptSection; conclusion: ScriptSection;
                 cta: ScriptSection; totalDurationSec: number };
ScriptSection = { text: string; startMs: number; endMs: number };

// Agent 3
ScenePlan = { sceneId: number; narration: string; visualGoal: string;
              emotion: Emotion; searchIntent: string;
              visualStyle: VisualStyle; keywords: string[];
              startMs: number; endMs: number };

// Agent 4
ClipCandidate = { source: 'pexels'|'pixabay'|'mixkit'|'coverr'|'runway'|'luma';
                  sourceId: string; url: string; previewUrl: string;
                  width: number; height: number; durationSec: number;
                  query: string; attribution: string };

// Agent 5
AnalyzedCandidate = ClipCandidate & {
  score: number;        // 0-10
  reason: string;
  relevance: number;    // 0-1
  quality: number;      // 0-1
  framing: number;      // 0-1 (vertical-crop suitability)
  motion: number;       // 0-1
};

// Agent 6+7
SelectedClip = AnalyzedCandidate & {
  diversityPenalty: number;
  consistencyScore: number;
  finalScore: number;
};

// Agent 8
TimedCaption = { text: string; startMs: number; endMs: number;
                 lineBreaks: string[];  // pre-split for ASS renderer
                 sceneId: number };

// Agent 9
TimingPlan = { sceneId: number; videoStartMs: number; videoEndMs: number;
               transitionInMs: number; transitionOutMs: number;
               kenBurnsMs: number };

// Agent 10
EditDecision = { sceneId: number;
                 zoom: { from: number; to: number };
                 pan: { fromX: number; fromY: number;
                        toX: number; toY: number };
                 transition: 'fade'|'fadeblack'|'dissolve'|'wiperight'|'cut';
                 transitionDurationMs: number;
                 grade: 'cinematic'|'warm'|'punchy'|'natural' };

// Agents 1-10 output (BullMQ payload):
CompositionPlan = {
  renderJobId: string;
  userId: string;
  scenes: { plan: ScenePlan; clip: SelectedClip;
            caption: TimedCaption; timing: TimingPlan;
            edit: EditDecision }[];
  audio: { narrationUrl: string; musicUrl: string;
           musicDuckingDb: number };
  output: { width: 1080; height: 1920; fps: 30 };
};

// Agent 11
CompositionResult = { localPath: string; durationSec: number;
                      width: number; height: number;
                      ffmpegStderr: string };

// Agent 12
QCReport = { score: number; passed: boolean;
             issues: { agent: AgentName; severity: 'warn'|'fail';
                       message: string }[];
             regenerateRequested: AgentName[] };
```

---

## FFmpeg filter graph (Agent 11 reference)

One invocation. No intermediate files. Per-scene chain → xfade → drawtext-replacement via `ass` burn-in (libass handles wrapping, kerning, multi-line, fade-in/out far better than `drawtext`).

```
ffmpeg \
  -i scene1.mp4 -i scene2.mp4 -i scene3.mp4 -i scene4.mp4 \
  -i narration.mp3 -i music.mp3 \
  -filter_complex "
    [0:v]scale=1080:1920:force_original_aspect_ratio=increase,
         crop=1080:1920,
         zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=180:s=1080x1920:fps=30,
         eq=saturation=1.05:contrast=1.05,
         setpts=PTS-STARTPTS[v0];
    [1:v]scale=...,crop=...,zoompan=...[v1];
    [2:v]scale=...,crop=...,zoompan=...[v2];
    [3:v]scale=...,crop=...,zoompan=...[v3];
    [v0][v1]xfade=transition=fade:duration=0.4:offset=5.6[x01];
    [x01][v2]xfade=transition=fade:duration=0.4:offset=11.2[x012];
    [x012][v3]xfade=transition=fade:duration=0.4:offset=16.8[vbase];
    [vbase]ass=captions.ass[vout];
    [4:a]volume=1.0[narr];
    [5:a]volume=0.28,aloop=loop=-1:size=2e+09[mus];
    [mus]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[ducked];
    [narr][ducked]amix=inputs=2:duration=first[aout]" \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -profile:v high -level 4.0 \
  -c:a aac -b:a 192k -movflags +faststart \
  -t 22.4 \
  out.mp4
```

Key choices:
- **`zoompan` per scene** for Ken Burns. `z='min(zoom+0.0015,1.15)'` gives a slow 15% push; Agent 10 can swap to `max(zoom-0.0015,1.0)` for a pull-out.
- **`xfade`** for cinematic transitions. `cut` skips the filter for hard cuts.
- **`ass`** filter (libass) for captions — proper word-wrap, outline, drop shadow, fade-in/out, Unicode, no per-character `drawtext` hell. The captions file is generated by Agent 8 + Agent 9.
- **`sidechaincompress`** on music keyed to narration — ducks dynamically (drops only when she's speaking) instead of static `-12 dB`. Far more professional.
- **`eq=saturation=1.05:contrast=1.05`** is the Agent 10 "warm" grade. Other grades swap LUTs via `lut3d=file=...`.
- **`-preset veryfast -crf 22`** — quality bias. ADR-002 explicitly prioritises quality over speed per the spec.

---

## Database schema deltas (migration `009_ffmpeg_pipeline.sql`)

```sql
-- Asset history ledger — Agent 6 reads this to penalise repeats.
CREATE TABLE asset_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  source        TEXT NOT NULL,            -- 'pexels'|'pixabay'|'mixkit'|'coverr'|'runway'|'luma'
  source_id     TEXT NOT NULL,            -- provider's native id
  asset_url     TEXT NOT NULL,
  render_job_id UUID REFERENCES render_jobs(id) ON DELETE SET NULL,
  topic         TEXT,                     -- denormalised search context
  used_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX asset_history_user_recent_idx
  ON asset_history(user_id, used_at DESC);
CREATE UNIQUE INDEX asset_history_uniq_per_job_asset
  ON asset_history(render_job_id, source, source_id)
  WHERE render_job_id IS NOT NULL;

-- Candidate audit trail — every video the search agent considered.
-- Lets us debug "why did the agent pick THIS clip" weeks later.
CREATE TABLE scene_candidates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  render_job_id  UUID NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  scene_number   INTEGER NOT NULL,
  source         TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  url            TEXT NOT NULL,
  query          TEXT,
  raw_score      NUMERIC,                 -- Agent 5
  relevance      NUMERIC,
  quality        NUMERIC,
  framing        NUMERIC,
  motion         NUMERIC,
  diversity_pen  NUMERIC,                 -- Agent 6
  consistency    NUMERIC,                 -- Agent 7
  final_score    NUMERIC,
  was_selected   BOOLEAN NOT NULL DEFAULT false,
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scene_candidates_render_idx
  ON scene_candidates(render_job_id, scene_number);

-- Extend render_jobs with the new pipeline's columns.
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS composition_plan JSONB,     -- frozen Agent 1-10 output
  ADD COLUMN IF NOT EXISTS qc_report        JSONB,     -- Agent 12 output
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT,      -- 'remotion-v1' | 'ffmpeg-v2'
  ADD COLUMN IF NOT EXISTS r2_object_key    TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_file_id   TEXT;

CREATE INDEX render_jobs_pipeline_version_idx
  ON render_jobs(pipeline_version);

-- RLS: scoped via render_jobs.user_id traversal (same pattern as scene_generations).
ALTER TABLE asset_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scene_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asset_history_owner"
  ON asset_history FOR SELECT
  USING (user_id = current_clerk_user_id());

CREATE POLICY "scene_candidates_owner"
  ON scene_candidates FOR SELECT
  USING (render_job_id IN (
    SELECT id FROM render_jobs WHERE user_id = current_clerk_user_id()
  ));
```

---

## Queue architecture

| Queue | Concurrency | Purpose | Status |
|---|---|---|---|
| `brand-research` | 1 | existing | unchanged |
| `content-generation` | 4 | existing | unchanged |
| `video-merge` | 1 | existing — Remotion path | DEPRECATED in 30 days |
| `ffmpeg-compose` | 1 → 4 once stable | NEW — runs Agents 11 + 12 | added in this ADR |

BullMQ job options: `attempts: 3`, exponential backoff 5 s base, `removeOnComplete: { age: 3600, count: 1000 }`. Webhook on completion → Next.js POST `/api/internal/render-webhook` → updates `render_jobs` + emits Realtime row update to the client.

---

## Folder structure

```
ottoflow-ai/
  src/lib/
    ffmpeg-pipeline/
      types.ts                   ← all 12 agent IO contracts
      orchestrator.ts            ← runs Agents 1-10 in /api/generate
      ffmpeg.ts                  ← filter-graph builder (Agent 11 core)
      ass-captions.ts            ← Agent 8 ASS renderer
      r2.ts                      ← Cloudflare R2 client
      gdrive.ts                  ← Google Drive fallback
      agents/
        01-content-strategist.ts
        02-script-writer.ts
        03-scene-planner.ts
        04-multi-source-search.ts
        05-video-analysis.ts
        06-diversity.ts
        07-visual-consistency.ts
        08-caption-compression.ts
        09-timing.ts
        10-video-editor.ts
        11-ffmpeg-composer.ts
        12-quality-control.ts
    video-providers/
      pexels.ts                  ← existing
      pixabay.ts                 ← NEW
      mixkit.ts                  ← NEW (RSS/scrape — Mixkit has no public API)
      coverr.ts                  ← NEW
      runway.ts                  ← existing (now opt-in 5th source)
      luma.ts                    ← existing (now opt-in 5th source)
      registry.ts                ← updated to expose getAllSources()
      types.ts                   ← unchanged
  worker/processors/
    ffmpeg-compose.ts            ← NEW — runs Agents 11 + 12
    video-merge.ts               ← unchanged but no longer routed to by default
  supabase/migrations/
    009_ffmpeg_pipeline.sql      ← NEW
```

---

## API endpoints

| Method | Path | Purpose | Status |
|---|---|---|---|
| POST | `/api/generate` (SSE) | Runs Agents 1-10, enqueues `ffmpeg-compose`, streams progress | reuses existing route — switches `pipeline_version` to `ffmpeg-v2` when `USE_REMOTION` not set |
| GET | `/api/render-jobs/[id]` | Job detail incl. `composition_plan` + `qc_report` | NEW |
| GET | `/api/scene-candidates/[renderJobId]` | Audit trail per job | NEW |
| POST | `/api/internal/render-webhook` | Worker → Next webhook on completion | NEW |
| POST | `/api/internal/regenerate` | Trigger partial regen from `qc_report.regenerateRequested` | NEW |

---

## Storage strategy

Primary: **Cloudflare R2**.
- Bucket: `ottoflow-renders`.
- Object key: `{userId}/{renderJobId}/{pipelineVersion}.mp4`.
- Public URL: custom domain `cdn.ottoflow.ai` → R2 public bucket.
- Why R2: $0.015/GB stored, **zero egress** vs Supabase Storage's bandwidth tier; matches Pictory/InVideo cost profile.

Fallback: **Google Drive** for the user's own account (paid users only). The Drive helper uploads to `ottoflow-ai/exports/` in their personal Drive — they own the file, we keep an `gdrive_file_id` reference. Used when R2 quota hits or for "Save to my Drive" CTA. Requires user OAuth scope `drive.file` already wired in `src/lib/google-drive.ts` (to be created).

Supabase Storage is retired for video output (still used for narration/music caches).

---

## Cost model (per 30-second video)

| Line item | Vendor | Unit | Cost |
|---|---|---|---|
| Strategist + Script + Scene plan + Caption + Search expansion | Gemini 2.5 Flash Lite | ~12 K input + 4 K output tokens | $0.0007 |
| Vision analysis (Agent 5 — optional) | Gemini 2.5 Flash Lite vision, 4 candidates × 4 scenes | 16 image tokens | $0.002 |
| Narration | ElevenLabs Turbo v2 | ~80 chars/sec × 30 s = 2400 chars | $0.072 |
| Music | Jamendo | streaming MP3 | $0 |
| Stock clips | Pexels + Pixabay + Mixkit + Coverr | free tier | $0 |
| AI scene gen (only when user toggles) | Runway gen-4.5 or Luma ray-flash, 4 × 5 s | premium | $0.56–1.00 |
| FFmpeg compute | Railway Hobby | ~25 s of 1 vCPU | $0.0006 |
| R2 storage | Cloudflare | 25 MB × $0.015/GB-mo | $0.0004 |
| R2 egress | Cloudflare | free | $0 |
| **Total stock-only** | | | **~$0.075/video** |
| **Total with AI scene gen** | | | **~$0.64–1.07/video** |

Pictory charges ~$0.40/min of generated video. We sit at ~$0.15/min stock-only; ~$2/min with AI gen. Headroom exists.

### Budget guardrails (already in `src/lib/budget.ts`)
- `user_budgets.monthly_hard_cap_usd` — block render at hard cap.
- `ai_usage_ledger` row per provider call → analytics for the dashboard.

---

## Scalability plan

| Bottleneck | Mitigation |
|---|---|
| Vercel function 300 s ceiling on SSE | Agents 1-10 must complete < 240 s; Agent 5 vision calls capped at 16/scene, parallelised |
| Gemini RPM | already retried with backoff in `gemini.ts`; Agents 1-3 are sequential, 4-8 can fan out |
| Stock provider rate limits | Pexels 200/h, Pixabay 100/min, Mixkit + Coverr scrape with 2 s polite delay; per-provider token bucket in `src/lib/rate-limit.ts` |
| Railway worker concurrency | start at 1 (no race on `asset_history` insert), raise to 4 once we add a Redis lock around the dedup check |
| R2 hot keys | path includes `{userId}/{renderJobId}` so no two writes share a key |
| Cold start of `ffmpeg` binary | nixpacks already bundles `ffmpeg-full`; no warmup needed |
| Concurrent renders per user | enforce 2 per user in `/api/generate` via Redis SET NX |

When traffic > 10 jobs/min sustained: shard the worker replica (Railway → "Replicas" slider) and add a per-asset BullMQ rate limiter (`limiter: { max: 5, duration: 1000 }`).

---

## Quality strategy (per spec §"Prioritize video quality")

1. **CRF 22, preset veryfast** — high quality, deterministic file size.
2. **Per-scene Ken Burns** — random direction × random magnitude per scene; Agent 10 picks within constraints. Eliminates the "every video moves left-to-right" tell.
3. **xfade transitions** chosen by Agent 10 based on `emotion` — `fadeblack` for sombre, `dissolve` for calm, `wiperight` for energetic. Hard cut allowed only when both scenes share dominant colour.
4. **`sidechaincompress`** ducking — dynamic, sounds professional.
5. **`ass` captions** — kerning + outline + drop shadow + 60 fps fade. Compression agent caps at 22 chars/line so they never overflow vertical-safe area.
6. **Colour grading per video** — Agent 10 picks one grade (`cinematic|warm|punchy|natural`) and applies it to every scene → consistency across mixed sources (per spec §Agent 7).
7. **QC regen loop** — if Agent 12 scores < 8.5, the failed agent's output is regenerated with `temperature += 0.1` and the chain re-runs from that point. Max 1 regen per agent per job (safety cap on cost).

---

## Migration plan

Three releases over ~10 days.

### Release A (day 1-2) — Foundations
- Migration `009_ffmpeg_pipeline.sql`.
- `src/lib/ffmpeg-pipeline/types.ts` + orchestrator skeleton.
- Three providers (Pixabay, Mixkit, Coverr).
- Scene Planner, Multi-Source Search, FFmpeg Composer agents fully wired.
- New worker processor `ffmpeg-compose.ts` reachable via `pipeline_version: 'ffmpeg-v2'` in payload. Default still `'remotion-v1'`.

### Release B (day 3-7) — Remaining agents
- Caption Compression, Timing, Editor agents.
- Video Analysis (vision) + Diversity + Consistency.
- QC loop with single-regen budget.
- Cloudflare R2 upload + Google Drive fallback.

### Release C (day 8-10) — Flip the default
- `/api/generate` defaults to `ffmpeg-v2` for new users; existing users gated behind a Clerk metadata flag.
- 7-day observation window with `pipeline_version` filter in Sentry + Supabase queries.
- If error rate < 1% and QC pass rate > 85%: delete `worker/render-remotion.ts` and `remotion/`, drop `@remotion/*` packages.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mixkit/Coverr have no public API | Certain | Medium | RSS feed + sitemap scrape; 2 s polite delay; cache results 24 h |
| Gemini vision (Agent 5) doubles cost | Medium | Low | Make Agent 5 optional; fall back to heuristic scoring (`durationSec ∈ [5,30] ∧ height ≥ 1080`) when budget mode is on |
| FFmpeg filter graph becomes unmaintainable | Medium | Medium | Build as composable string functions per agent decision; commit the generated graph string to `composition_plan` for debugging |
| `asset_history` dedup overly restrictive | Medium | Low | TTL of 100 jobs is soft — Agent 6 applies a penalty, not a hard reject; a single highly-relevant clip can still win |
| R2 egress migration breaks Realtime previews | Low | Low | R2 public bucket + `cdn.ottoflow.ai` CNAME tested with hls.js in staging before flip |
| `ass` captions misrender on some fonts | Medium | Low | bundle `DejaVu Sans Bold` via nixpacks (already done); fall back to drawtext if libass missing at boot |
| User toggles AI scene gen, hits budget cap | Low | Medium | Pre-flight cost estimate in `/api/generate` returned to client BEFORE enqueue |

---

## Open questions

1. Do we keep Supabase Storage for narration/music caches, or move those to R2 too? Recommend **keep on Supabase** — these are tiny (< 200 KB) and Storage's metadata is convenient.
2. Should Agent 5 vision be on by default for paying users only? Recommend **yes** — gates the $0.002/job cost behind a paid tier.
3. Should we expose the `composition_plan` JSONB to the user as a "Re-render with edits" UI? Out of scope this ADR; tracked in Phase 2 backlog.

---

## Consequences

**Positive**
- No Chrome in the worker → boot time ~600 ms instead of ~7 s; RAM ceiling drops back to ~250 MB peak.
- Per-scene relevance lifts from "Pexels best-effort" to "Gemini-scored across 4 sources × 8 query variations".
- Captions stop overflowing because compression is a first-class agent, not a side effect of drawtext.
- Asset history kills the "same yacht clip in every video" failure mode.
- Pure FFmpeg pipeline ports cleanly to any Node runtime (Render, Fly, Cloud Run, bare VPS).

**Negative**
- Two pipelines exist for 30 days. Two code paths to maintain; risk of drift.
- Agent 5 vision is an extra Gemini hop adding ~3 s to each request.
- Mixkit + Coverr scraping is brittle to their site changes.

**Neutral**
- Runway + Luma stay in code, gated by `request.includeAiScenes: true`. No regression for users who like AI gen; no cost for users who don't.
