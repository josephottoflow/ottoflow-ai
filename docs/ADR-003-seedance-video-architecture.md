# ADR-003: Seedance as Scene Generator in the ADR-002 FFmpeg Pipeline

**Status:** Proposed (architecture recommendation only — no code, no migrations)
**Date:** 2026-06-16
**Deciders:** Joseph (joseph@ottoflow.ai)
**Builds on:** [ADR-002](ADR-002-ffmpeg-multi-agent-pipeline.md) (FFmpeg 12-agent pipeline). Does **not** supersede it.
**Roadmap placement:** P4 Creative Generation (video extension). See §0.

---

## 0 · Relevance gate & priority placement (operating rules)

**Why it matters:** Video is the missing creative modality in the self-improving loop (Research → … → Creatives → Publishing → Attribution). Seedance raises per-scene relevance and quality far above stock footage, and does so without touching the working image pipeline.

**Is it higher priority than current work?** **No.** Per project memory the live priority order is P0 Reliability (Clerk DEV→prod keys), re-upload valid Basecamp headshot, P4 Phase 2 Brand Pattern Library, P5 LinkedIn/X publishing. The FFmpeg **video path itself is still blocked on the Railway 1 GB→2 GB RAM bump** (ADR-002 §3 conclusion). Seedance does not remove that blocker.

**Now / Later / Defer:**
- **Now:** this recommendation (free, de-risks the decision).
- **Later (after the 2 GB bump + P5 publishing):** implement Seedance as a `VideoProvider` (V1, §7).
- **Defer:** single-generation multi-shot + native-audio mode (V2, §7) until V1 is proven.

This document is a recommendation. It does not authorize implementation ahead of P0–P3.

---

## Phase 1 — Architecture audit (verified against current code)

All findings below were read from the live tree on branch `feat/ffmpeg-multi-agent-pipeline`, not assumed.

### 1.1 What already exists

| Component | File(s) verified | State |
|---|---|---|
| **Provider abstraction** | `src/lib/video-providers/types.ts` | `VideoProvider { name; isConfigured(); generateScene(SceneRequest)→SceneResult }`. Comment already names *"Runway, Higgsfield, Veo"* as intended backends and `SceneResult.provider` enumerates `'runway'｜'higgsfield'｜'pexels'｜'veo'`. **The extension point for Seedance already exists.** |
| **Provider registry** | `src/lib/video-providers/registry.ts` | Priority chain `[Runway, Luma, PexelsFallback]`; first configured success wins; `preferProvider` bias; `AllProvidersExhaustedError`; `listProviders()` diagnostic. |
| **AI scene gen as "5th source"** | `src/lib/ffmpeg-pipeline/agents/04-multi-source-search.ts` | When `ctx.includeAiScenes`, calls `registryGenerate({prompt: scene.visualGoal, durationSec:5, aspectRatio:"9:16", …})` **once per scene** and folds the result into the candidate pool. |
| **Runway provider (reference impl)** | `src/lib/video-providers/runway.ts` | Real async REST: create task → poll `/v1/tasks/{id}` (4 s interval, 240 s timeout) → `output[0]` MP4. image-to-video (seeds via Pexels still). This is the **exact shape Seedance needs**. |
| **12-agent orchestrator** | `src/lib/ffmpeg-pipeline/orchestrator.ts`, `agents/01..10` | Agents 1–10 run in the Vercel SSE route, freeze a `CompositionPlan` into the BullMQ payload. |
| **Compose + QC worker** | `worker/processors/ffmpeg-compose.ts`, `agents/11`,`agents/12` | Multi-pass FFmpeg (`composeMultiPass`: normalize each scene → finalize), QC, bounded 1-pass regen (caption/timing/editor only), R2 upload, `asset_history` write. |
| **FFmpeg core** | `src/lib/ffmpeg-pipeline/ffmpeg.ts`, `ass-captions.ts` | Filter-graph builder; libass caption burn-in; `-threads 2`, single-decode normalize (the memory-safety levers from ADR-002). |
| **Queues** | `worker/index.ts`, `src/lib/queue.ts` | Five BullMQ workers: `brand-research`, `content-generation`, `video-merge` (legacy Remotion, deprecated), `ffmpeg-compose` (ADR-002), `creative-generation` (image). Heavy queues run at `WORKER_CONCURRENCY/2`. |
| **Storage** | `src/lib/ffmpeg-pipeline/r2.ts`, `gdrive.ts` | Cloudflare R2 primary (`{userId}/{renderJobId}/{version}.mp4`, zero egress), Google Drive fallback. Supabase Storage retired for video. |
| **Creative (image) gen** | `worker/processors/creative-generation.ts` | Two-layer: Gemini/Imagen background + deterministic **sharp** compositor (logo/headshot/CTA never AI-synthesized). The Visual Metaphor Engine (`visual_tension`→`visual_metaphor`) is live and reaches pixels. |

### 1.2 What can be reused (unchanged)

`VideoProvider` interface · registry chain · `SceneRequest`/`SceneResult` contracts · Agent-3 Scene Planner · Agent-4 source fan-out · `CompositionPlan` BullMQ payload · `ffmpeg-compose` worker · Agent 11/12 (compose/QC) · R2/GDrive storage · `render_jobs` schema (`composition_plan`, `qc_report`, `pipeline_version`, `r2_object_key`) · `scene_candidates`/`asset_history` audit tables · budget/`ai_usage_ledger`.

### 1.3 What should remain unchanged

The **two-layer creative philosophy** (AI produces content, deterministic FFmpeg/sharp applies brand) · the **queue topology** · the **route-vs-worker boundary** (Agents 1–10 in SSE, 11–12 in worker) · **R2 storage strategy** · the **OOM-mitigation levers** (single-decode normalize, `-threads 2`).

### 1.4 What new components are required

1. `src/lib/video-providers/seedance.ts` — `SeedanceProvider implements VideoProvider` (async create→poll→download, mirrors `runway.ts`).
2. Registry insertion + env (`SEEDANCE_API_KEY`, base URL/region).
3. **An "AI-first" pipeline mode** so Seedance is the *primary* scene source (one clip per scene plan) instead of one stock candidate among many — a flag on the orchestrator, not a rewrite (§3, §7).
4. *(V2)* A `video_strategy` object + Scene-Plan derivation from the existing tension/metaphor engine (§4).
5. *(V2)* Brand-layer assets for video (pattern overlays, LUTs, motion presets) — §6.

### 1.5 Current architecture (verified)

```
Vercel SSE /api/generate
  Agent 1 Strategist → 2 Script → 3 Scene Planner (4 scenes)
  Agent 4 Multi-Source Search:
      Pexels / Pixabay / Mixkit / Coverr  (stock, 4×3 queries)
      + [if includeAiScenes] registry.generateScene() ×1/scene → Runway｜Luma
  Agent 5 Vision score → 6 Diversity → 7 Consistency
  Agent 8 Caption → 9 Timing → 10 Editor
  → freeze CompositionPlan → enqueue BullMQ `ffmpeg-compose`
                                   │
Railway worker ───────────────────┘
  Agent 11 FFmpeg: download N clips + narration + music
            → multi-pass normalize → finalize → MP4   ⚠ OOMs at 1 GB
  Agent 12 QC → bounded regen
  → R2 (primary) / GDrive (fallback) → render_jobs.merged_video_url
```

### 1.6 Proposed architecture (Seedance as scene generator)

```
Vercel SSE /api/generate  (mode = "ai-first-video")
  Agent 1 Strategist → 2 Script → 3 Scene Planner (4 scenes)
  Video Strategy: tension/metaphor → per-scene Seedance prompt + brand refs   [NEW, V2]
  Agent 4' Scene Sourcing (AI-first):
      for each scene → registry.generateScene({provider:"seedance"})
          SeedanceProvider: POST create → poll task → MP4 (9:16, 4–15 s)      [NEW]
      Pexels stays as LAST-RESORT fallback (provider chain unchanged)
  (Agents 5–7 skipped or run in "trust-AI" lite mode for AI-first scenes)
  Agent 8 Caption → 9 Timing → 10 Editor
  → freeze CompositionPlan → enqueue `ffmpeg-compose`
                                   │
Railway worker ───────────────────┘  (unchanged code path)
  Agent 11 FFmpeg: normalize Seedance clips → brand layer → captions
            → CTA end card → finalize → MP4
  Agent 12 QC → R2 → render_jobs
```

### 1.7 Gap analysis

| Capability | Today | With Seedance | Gap to close |
|---|---|---|---|
| Scene visuals | stock best-effort, repeats | bespoke per-scene AI | add `SeedanceProvider` |
| AI scene role | one candidate among stock | primary source | add AI-first mode/flag |
| Character/brand consistency across scenes | none (independent clips) | reference-image seeding + seed | wire brand refs into `SceneRequest` (V2) |
| Native audio | ElevenLabs + Jamendo mixed in FFmpeg | Seedance can emit audio | optional V2 mode |
| RAM blocker | 1 GB OOM at libx264 | **unchanged** | **2 GB bump still required** |
| Brand-without-logo (video) | n/a | pattern/LUT/motion layer | §6, V2 |

---

## Phase 2 — Seedance research (with evidence)

Official ByteDance/BytePlus pages (`seed.bytedance.com`, `byteplus.com/product/seedance`) are JS-rendered and returned no extractable body via fetch; the facts below are corroborated from the **BytePlus ModelArk docs index**, the **arXiv paper**, and third-party API references (Segmind, NxCode). Confidence is flagged per row.

| Question | Answer | Evidence | Confidence |
|---|---|---|---|
| Real API? | **Yes.** Official task-based API on **BytePlus ModelArk** (international, USD) and Volcengine (China, RMB). Docs expose *Create / Retrieve / List / Cancel a video generation task*. | BytePlus ModelArk docs `ModelArk/2291680`; NxCode guide | High |
| Production-ready? | **Yes** — productized on ModelArk with token billing; also via aggregators (Segmind, fal.ai, PiAPI). | Segmind API page; NxCode | High (official), Med (aggregators) |
| Officially supported? | **Yes** by ByteDance via BytePlus/Volcengine. Aggregators are **not** official infra. | NxCode | High |
| Text-to-video? | **Yes** (core). | Segmind; NxCode; arXiv | High |
| Image-to-video? | **Yes** — `first_frame_url`/`last_frame_url` (Segmind) or `references` with `role:"subject"` (ModelArk-style). | Segmind; NxCode | High |
| Multi-scene? | **Yes — two ways:** multi-shot *inside one generation* (`"Shot 1: … Shot 2: …"`), **and** N independent generations we compose ourselves. | Segmind (multi-shot prompt syntax) | High |
| Character consistency? | **Yes** — up to **9 reference images** (Segmind) / up to **12 reference files** across roles `subject｜environment｜motion｜audio` (NxCode); seed support. | Segmind; NxCode | Med-High |
| Audio? | **Yes — native** audio-video joint generation (`generate_audio`/`audio:true`); "Dual-Branch Diffusion Transformer". | Segmind; NxCode; arXiv ("native multi-modal audio-video") | High |
| Async jobs? | **Yes** — submit → `request_id`/`job_id` → poll until `completed`. Sync blocks up to 600 s. Typical gen 30–120 s. | Segmind; NxCode | High |
| Downloadable outputs? | **Yes** — MP4 URL on completion. **Outputs expire ~1 hour** → we must copy to R2 immediately. | Segmind ("retained 1 hour") | High |
| Commercial usage? | **Yes**, subject to BytePlus/Volcengine ToS. **Verify the ToS directly before launch** — not confirmed in third-party docs. | WebSearch summary; NxCode (not addressed) | **Low — must verify** |
| Pricing | Token-based on ModelArk (~$4.7–7.7 / 1M tokens, 1080p). Per-second via aggregators: **~$0.01–0.02/s @720p**, **~$0.05–0.10/s @1080p** (NxCode); Atlas Cloud quotes **$0.247/s** standard. Wide spread → treat as estimate. | NxCode; Atlas Cloud; LumiYing | Low-Med |
| Rate limits | Not published; `429` on excess. | Segmind; NxCode | Low |
| Resolution/duration | **4–15 s**; **480p–720p** (arXiv research baseline) up to **1080p** (productized ModelArk/Segmind). Aspect incl. **9:16**. | arXiv; Segmind | Med (note the 720p↔1080p discrepancy) |

**Paper:** *"Seedance 2.0: Advancing Video Generation for World Complexity"*, Team Seedance et al., arXiv:2604.14148 (submitted 2026-04-15; model released in China early Feb 2026). Native multi-modal (text/image/audio/video in), up to 3 video + 9 image + 3 audio references, a low-latency "fast" variant.

**Net:** Seedance is a real, official, async, commercially-licensable text+image-to-video API with native audio, 9:16, and reference-based consistency — a strong fit. The two genuine unknowns to close before launch: **commercial ToS** and **real 1080p per-second cost**.

---

## Phase 3 — Ottoflow video pipeline (per-stage spec)

Queues reuse existing infra. Only `ffmpeg-compose` is touched (unchanged code); a new **`scene-generation`** queue is recommended so long Seedance polls don't sit inside the Vercel 300 s SSE ceiling.

| Stage | Inputs | Outputs | Queue / Runtime | Storage | Retry | Failure handling |
|---|---|---|---|---|---|---|
| Research → Opportunity → Content | brand, topic | content_item, brief (`visual_tension`,`visual_metaphor`) | existing | Postgres | existing | existing |
| **Video Strategy** | content + tension/metaphor | `video_strategy` (§4) | Vercel SSE (Gemini) | `render_jobs.composition_plan` | in-request | fall back to single-shot concept |
| **Scene Plan** | video_strategy | 4 `ScenePlan` (Problem/Tension/Solution/Outcome) | Vercel SSE (Agent 3) | composition_plan | in-request | reuse Agent-3 defaults |
| **Seedance Scene 1–4** | per-scene prompt + brand refs + seed | 4 MP4 (9:16, 4–15 s) | **NEW `scene-generation` queue** (Railway; async poll) | copy each to **R2** on completion (1 h expiry!) | BullMQ `attempts:3`, backoff 5 s; per-scene independent | provider chain → Runway → Luma → **Pexels** last-resort; a failed scene never fails the job |
| FFmpeg Normalize | 4 clips | CFR 9:16 30 fps, uniform codec | `ffmpeg-compose` (unchanged) | /tmp | pass-level | per ADR-002 prod gotchas (`-r` input, `setpts` order) |
| FFmpeg Branding Layer | clips + brand pattern/LUT/logo | branded scenes | `ffmpeg-compose` | /tmp | — | brand layer optional → skip on asset error |
| FFmpeg Captions | TimedCaption (Agent 8) | ASS burn-in | `ffmpeg-compose` | /tmp | — | libass fallback font |
| FFmpeg CTA End Card | CTA text + palette | 2–3 s end card | `ffmpeg-compose` | /tmp | — | omit on failure (soft) |
| FFmpeg Export | composed timeline | final MP4 per platform | `ffmpeg-compose` | **R2** | — | QC soft-fail still ships |
| Publish | MP4 + caption | platform post | existing P5 path | — | existing | manual-publish fallback |
| Attribution | post + metrics | grounded_on links | existing | Postgres | existing | existing |

**Key sequencing rule:** Seedance generation is **queued, not in-request**. Agents 1–3 + Video Strategy run in SSE (fast); the moment scene prompts are frozen, enqueue scene-generation; the worker polls Seedance, copies to R2, then enqueues `ffmpeg-compose`. This keeps everything off Vercel's 300 s ceiling and matches the existing route-vs-worker boundary.

---

## Phase 4 — Video Strategy layer

New object (denormalized into `render_jobs.composition_plan`; no new table needed for V1):

```jsonc
{
  "video_concept": "",        // one-line creative thesis (Gemini)
  "visual_tension": "",       // REUSED from the image engine, e.g. "Chaos vs Clarity"
  "visual_metaphor": "",      // REUSED, e.g. "jumbled lines converging into one hub"
  "brand_worldview": "",      // brand's recurring visual stance (calm, structured, human)
  "scenes": [
    { "role": "problem",  "prompt": "", "refs": [], "seed": 0, "durationSec": 5 },
    { "role": "tension",  "prompt": "", "refs": [], "seed": 0, "durationSec": 5 },
    { "role": "solution", "prompt": "", "refs": [], "seed": 0, "durationSec": 5 },
    { "role": "outcome",  "prompt": "", "refs": [], "seed": 0, "durationSec": 5 }
  ]
}
```

**The existing Topic→Tension→Metaphor engine drives the 4-beat arc directly:**

| Beat | Driven by | Example (Basecamp, "Chaos vs Clarity") |
|---|---|---|
| Scene 1 **Problem** | the *negative pole* of `visual_tension` | "disparate jumbled lines, scattered fragments, restless motion" |
| Scene 2 **Tension** | the *collision* the metaphor dramatizes | "fragments straining, pulling toward an unseen center" |
| Scene 3 **Solution** | the metaphor *resolving* | "lines converging into one clean flowing hub" |
| Scene 4 **Outcome** | the *positive pole* + brand worldview | "calm ordered structure, steady forward glide" |

This is the **same metaphor that already renders the still creative's background** — so a brand's video and its image creative share one visual thesis. **Integration with current creative gen:** the image compositor and the video Scene Planner consume the *same* `visual_tension`/`visual_metaphor` fields already produced per content item. Consistency is free; no second creative engine.

---

## Phase 5 — FFmpeg composition design (Seedance clips: 2–4 × 4–15 s)

| Concern | Strategy |
|---|---|
| **Clip normalization** | Per ADR-002: each clip → `scale=1080:1920:force_original_aspect_ratio=increase, crop, format, setpts=PTS-STARTPTS, fps` (fps **last**), **input `-r 30`** for CFR (xfade requirement). Seedance returns clean MP4s → normalization is cheaper than stock. |
| **Transitions** | Hard cuts (concat demuxer) at 1 GB (single decode). xfade/dissolve **only once RAM ≥ 2 GB** (needs 2 simultaneous decodes). Agent 10 already picks per-emotion. |
| **Captions** | Unchanged: Agent 8 compresses (≤22 ch/≤2 lines), ASS burn-in via libass. |
| **Logo overlay** | `overlay` filter, bottom-right, palette-aware scrim — same placement rule as the image compositor. |
| **Brand pattern overlay** | Pre-rendered transparent PNG/APNG per brand (§6) `overlay`-ed at low opacity. |
| **CTA end card** | 2–3 s generated card (sharp or a still Seedance frame) concatenated last; reuses the image-creative CTA/palette. |
| **Platform exports** | One master 1080×1920 → derive 1:1 / 16:9 via `crop`/`pad` in a cheap second pass (or at export time). |

### RAM / compute analysis

| Resource | Finding |
|---|---|
| **2 GB Railway** | Validated multi-pass compose fits (ADR-002). **This is the V1 target.** Enables re-enabling xfade. |
| **1 GB Railway (today)** | OOMs **non-deterministically** at libx264 encode of 1080×1920 — independent of clip source. **Seedance does NOT fix this.** *Exception:* a single Seedance **multi-shot clip with native audio** (Pattern B) reduces the worker to "overlay branding+captions on ONE clip" — no multi-decode, no audio mix — which **may** fit 1 GB. This is a genuine secondary argument for Pattern B. |
| **CPU** | FFmpeg is the only CPU load; `-threads 2` caps it. Seedance generation is **offloaded to BytePlus GPUs** — the worker does no inference. |
| **GPU** | **None required on our infra.** Seedance runs the diffusion model server-side. This is a major operational win vs self-hosting. |

**Can FFmpeg reliably combine 2–4 Seedance clips in Ottoflow?** **Yes — at 2 GB RAM, with high confidence.** The compose path is already validated end-to-end (QC 10/10 locally; the only prod failure mode is the 1 GB OOM). Seedance clips are *more* uniform than mixed stock, so normalization and visual-consistency work get easier, not harder. At 1 GB it remains unreliable for multi-clip joins (same ceiling as today).

---

## Phase 6 — Brand recognition without logo (video)

**Objective:** a video should read as "Basecamp" even with the logo removed. Apply the existing two-layer philosophy (AI = content, deterministic = brand) to motion.

| System | Design | Where applied |
|---|---|---|
| **Brand Pattern Library** | Per-brand transparent motion overlays (grain, geometric lattice, corner motifs) derived from the brand's `visual_metaphor` family. | FFmpeg `overlay`, low opacity, every scene |
| **Motion Language** | Brand-specific camera grammar in the Seedance prompt (Basecamp = "calm, steady, converging, no jitter") + Agent-10 zoom/pan presets per brand. | Seedance prompt + Editor |
| **Typography System** | Brand ASS style (font, weight, outline, position, animation curve) — the caption equivalent of the image headline style. | ass-captions renderer |
| **Color System** | Per-brand 3D LUT (`lut3d`) built from the palette (primary/secondary/accent) — applied to *every* Seedance clip so mixed generations share one grade. Reuses the palette pipeline that killed the #7c3aed fallback. | FFmpeg per scene |
| **Transition System** | A signature transition (e.g. always "converge-to-center" dissolve) as a brand tell. | Agent 10 + xfade (≥2 GB) |
| **Visual Worldview Layer** | `brand_worldview` string seeds both the Seedance prompt and the metaphor — the recurring emotional/structural stance. | Video Strategy |

**How "Basecamp" survives logo removal:** the Seedance prompts are seeded by Basecamp's *metaphor* (chaos→clarity convergence) and *worldview* (calm/structured), then every clip is graded through Basecamp's *LUT*, captioned in Basecamp's *type style*, and wrapped in Basecamp's *pattern + transition signature*. Color + motion + type + composition together encode the brand — exactly the principle already proven for still creatives ("recognizable even if the logo is removed"), extended into time.

---

## Phase 7 — Recommendation

### Options considered

#### Option A: Seedance via the existing `VideoProvider` interface (recommended)
| Dimension | Assessment |
|---|---|
| Complexity | **Low** — one provider file + registry entry, mirrors `runway.ts` |
| Cost | ~$0.05–0.50 per 5 s clip @1080p (estimate; verify) |
| Scalability | Async, offloaded to BytePlus GPUs; queue-bounded |
| Team familiarity | High — identical to Runway/Luma integration |

**Pros:** native audio, 9:16, reference consistency, multi-shot, cheap vs Sora/Runway, zero GPU on our side, drops into the seam designed for it. **Cons:** commercial ToS + real 1080p cost unverified; outputs expire 1 h; region/billing via BytePlus.

#### Option B: Keep Runway/Luma only (already integrated)
**Pros:** zero new work, ToS known. **Cons:** Runway image-to-video needs a Pexels seed (quality ceiling), pricier, no native audio, weaker multi-shot/consistency.

#### Option C: Google Veo (same Gemini/Google stack)
**Pros:** vendor consolidation with existing Gemini/Imagen auth, strong quality. **Cons:** cost typically higher; another provider to wire; still just a `VideoProvider`.

### Answers to the 10 questions

1. **Is Seedance the correct provider?** **Yes, as the new primary AI scene source** — best capability/price fit, and the provider seam already anticipates it. Keep it behind the registry so it's swappable.
2. **Better alternatives?** **Google Veo** is the strongest hedge (stack consolidation); Runway/Luma stay as automatic fallbacks. Recommend launching Seedance **and** keeping the chain so you can A/B without code churn.
3. **Production risks:** commercial ToS unverified (**blocker — confirm first**); 1080p per-second cost spread is wide; output 1 h expiry (must copy to R2 immediately); 30–120 s latency (async queue handles it); 720p↔1080p ambiguity; undocumented rate limits; region/billing via BytePlus.
4. **Cost estimates (per 4-scene ~20 s video, estimate):** 4×5 s @1080p ≈ **$1.00–2.00** Seedance + ~$0.07 Gemini/audio + ~$0.001 R2 ≈ **~$1–2/video**. @720p ≈ **$0.20–0.40**. (vs ADR-002 stock-only ~$0.075; AI-gen ~$0.64–1.07.) **Recommend defaulting to 720p generation, upscale optional.**
5. **V1 architecture recommendation:** `SeedanceProvider` in the chain + an **AI-first scene-sourcing mode** (one Seedance clip per scene plan, Pexels last-resort) + a dedicated **`scene-generation` BullMQ queue** that polls Seedance and copies to R2, then enqueues the **unchanged** `ffmpeg-compose`. Ship at **720p, hard cuts, 2 GB RAM**.
6. **V2 roadmap:** (a) brand-without-logo layer (§6: LUT, pattern, motion, type, transition signature); (b) reference-image consistency seeded by brand assets; (c) single multi-shot + native-audio mode (Pattern B — lighter FFmpeg, possible 1 GB fit); (d) xfade transitions once ≥2 GB; (e) per-platform exports.
7. **BullMQ queue additions:** **add `scene-generation`** (concurrency 1–2, `attempts:3`, backoff 5 s, per-scene jobs). `ffmpeg-compose` unchanged. `video-merge` (Remotion) stays deprecated.
8. **Database changes (V2, not now):** `render_jobs.scene_provider TEXT`, `scene_seeds JSONB`; extend `composition_plan` with the `video_strategy` object (no new table for V1); optional `video_strategy` columns later for analytics ("which metaphor/worldview performs best"), mirroring the P4-Phase-1 `visual_tension`/`visual_metaphor` denormalization. **No migrations until V1 is approved.**
9. **Railway responsibilities:** run the worker (`scene-generation` poll + R2 copy, `ffmpeg-compose`); **needs the 2 GB RAM bump**; **no GPU** (inference is BytePlus-side). Add `SEEDANCE_API_KEY` (+ region/base URL) to the worker service.
10. **Vercel responsibilities:** Agents 1–3 + Video Strategy in the SSE route, freeze the plan, enqueue `scene-generation`; UI/preview; never run Seedance polling in-request (300 s ceiling). No Seedance secret on Vercel (worker-only).

### The critical question

> **Can Seedance integrate cleanly into Ottoflow's existing ADR-002 FFmpeg architecture without major rewrites?**

**Yes — without major rewrites.** Seedance maps onto a seam the codebase already built for exactly this: the `VideoProvider` interface (which already names Veo/Higgsfield as future backends), the registry chain, and Agent 4's "AI scene as a source" hook. The composer, queues, storage, QC, and `render_jobs` schema are untouched. The work is **additive**:

- **1 new file** (`seedance.ts`, ~the size of `runway.ts`),
- **1 registry line** + env,
- **1 new queue** (`scene-generation`) to keep async polls off Vercel,
- **1 orchestrator mode** ("AI-first": route each scene plan to Seedance, Pexels last-resort).

**Two caveats, both pre-existing or external, not rewrites:**
1. **The 2 GB Railway RAM bump is still required** — Seedance improves clip quality, it does **not** fix the libx264 OOM. (A V2 single-clip multi-shot mode could sidestep it.)
2. **Confirm Seedance commercial ToS and real 1080p cost** before launch — the two unverified facts.

**Recommended path:** finish P0–P3 + the 2 GB bump first → ship Seedance V1 (provider + AI-first mode + `scene-generation` queue, 720p, hard cuts) → layer the brand-without-logo system and xfade in V2.

---

## Consequences

**Positive:** bespoke per-scene visuals tied to the brand's own metaphor; native audio option; zero GPU on our infra; one creative thesis shared by image + video; fully swappable provider.
**Negative:** new external vendor + cost/ToS to manage; outputs expire in 1 h (R2-copy discipline); still gated on the 2 GB bump.
**Neutral:** Runway/Luma/Pexels remain in the chain as fallbacks; no regression for the image pipeline.

## Action items (no implementation until P0–P3 + 2 GB bump)
1. [ ] Verify Seedance **commercial ToS** + real **1080p per-second** cost on BytePlus ModelArk.
2. [ ] Apply the Railway **2 GB RAM** bump (shared with ADR-002 video unblock).
3. [ ] V1: `SeedanceProvider` + registry + `scene-generation` queue + AI-first mode (720p, hard cuts).
4. [ ] V2: brand-without-logo layer, reference consistency, multi-shot+audio mode, xfade.
