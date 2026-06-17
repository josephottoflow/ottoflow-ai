# Ottoflow AI-First Video — Architecture Review & Blueprint

**Status:** Review (no code). Companion to [ADR-002](ADR-002-ffmpeg-multi-agent-pipeline.md) (FFmpeg pipeline) and [ADR-003](ADR-003-seedance-video-architecture.md) (Seedance decision). Grounded in the V1 code shipped this session (`seedance.ts`, `video-strategy.ts`, `orchestrator.buildAiFirstPlan`, `ffmpeg.ts`, `branding.ts`, `scene-generation` worker).
**Date:** 2026-06-16 · **Author role:** Principal Video Architect

**Non-negotiable invariants (carried from the brief):** Seedance generates *scenes only*; FFmpeg is the *only* compositor; logo/headshot are *locked assets* never sent to any model; brand marks are added *deterministically* in FFmpeg; videos must feel like the brand *with the logo removed*; everything derives from the *same opportunity → tension → metaphor → strategy* that already powers image creatives.

---

## 1 · Video Strategy Engine

Transforms `{opportunity, topic, visual_tension, visual_metaphor, platform}` → an N-scene plan. The tension/metaphor are **reused, never re-derived** (the `VideoStrategy` object already does this in V1).

### Scene-count rules (driven by platform + target duration, not user choice)
| N | When | Beat template | Total | Platform |
|---|---|---|---|---|
| **3** | hook-first, ≤15 s | Problem → Shift → Outcome (tension+solution fused) | 12–15 s | TikTok / Reels / Shorts hook |
| **4** | **default** | Problem → Tension → Solution → Outcome | 18–24 s | **LinkedIn (V1)**, FB |
| **5** | evidence-led | Problem → Tension → **Insight** → Solution → Outcome | 25–35 s | LinkedIn long, data-led hierarchy |
| **6** | explainer | Hook → Problem → Tension → Solution → **Proof** → Outcome/CTA | 35–50 s | YouTube Shorts, demos |

**Selection rule:** `N = f(platform_default, hierarchy)`. Data-led/quote-led bias toward 5 (room for the Insight/Proof beat); founder-led and brand-led default to 4. Never expose N as a raw user knob — derive it, allow an override.

### Duration rules
- Per-scene 4–6 s (Seedance supports 4/5/6/8/10/12/15; round to nearest). Total = Σ scenes + 2–3 s CTA card.
- Hard platform caps enforced before generation (LinkedIn ≤ 30 s, Shorts ≤ 60 s).

### Pacing rules (emotion-driven, already encoded in `EditDecision`)
- `urgent`/`energetic` → shorter holds, tighter cuts, larger Ken-Burns push.
- `calm`/`confident` → longer holds, gentle drift, smaller push.
- Pacing **accelerates** problem→tension then **settles** solution→outcome (mirrors the metaphor resolving).

### Storytelling rules
The metaphor's *state machine* IS the story: negative pole → collision → resolution → positive pole. Each beat must visibly **advance** the metaphor (see §2 anti-repetition). `brand_worldview` colors only the Outcome beat (the "what it feels like after").

---

## 2 · Scene Orchestrator

`{topic, tension, metaphor, brand, platform}` → ordered beats with one abstract-safe Seedance prompt + one caption each (the V1 `buildVideoStrategy` does the 4-scene case; this generalizes it).

### How scene count changes structure
Roles are a **superset stack**; N selects a slice:
```
Hook · Problem · Tension · Insight · Solution · Proof · Outcome
 3 →            Problem ·  Tension(=Shift) ·             Outcome
 4 →            Problem ·  Tension ·          Solution · Outcome
 5 →            Problem ·  Tension · Insight· Solution · Outcome
 6 → Hook ·     Problem ·  Tension ·          Solution · Proof · Outcome
```
Insight = the data/why beat; Proof = evidence/result beat. This keeps a single role vocabulary so the FFmpeg/branding layers don't special-case N.

### How each scene prompt is generated
Per beat: `metaphor_pole(beat) + palette + brand motion-language + composition grid → abstract prompt` (geometry/structure/motion/color only; **no people/text/logos/words**). The pole mapping: Problem = scatter/chaos, Tension = strain/pull, Insight = a focal element emerging, Solution = convergence, Proof = stability tested, Outcome = ordered glide. (V1 prompts already do this for 4 beats.)

### How scenes stay coherent
1. **Shared metaphor + palette + seed family** across all N (V1: per-scene seeds from one strategy).
2. **Frame chaining (future):** pass scene *k*'s last frame as scene *k+1*'s `first_frame_url` (Seedance i2v) → visual continuity instead of 4 unrelated clips. **This is the single biggest coherence lever and is NOT in V1.**
3. **One color LUT** applied to every clip in FFmpeg → unifies mixed generations.

### How scenes avoid repetition
- Each beat = a **distinct metaphor state** (scatter ≠ strain ≠ converge ≠ glide), enforced in the prompt template.
- Per-beat **camera grammar** varies (push / drift / orbit / settle).
- Reuse the existing **Diversity Engine** concept (Agent 6) to penalize near-identical compositions across a user's recent videos.

---

## 3 · Seedance integration (fit review)

| Dimension | Assessment |
|---|---|
| Quality | Strong for abstract/motion; native 1080p + audio. Good fit for metaphor backgrounds. |
| Consistency | Medium — seed + reference images + (future) frame-chaining. Weakest axis for "4 coherent scenes." |
| Branding | **None by design** — correct; FFmpeg owns it. |
| Speed | 30–120 s async/scene → minutes/video. Acceptable (worker, off the Vercel ceiling). |
| Cost | Cheap (~$0.20–0.40/video @720p est.) vs Runway/Sora. |
| Reliability | Async task API; region/account-bound; first-call contract now aligned to Ark. |

**Verdict:** correct primary provider, kept swappable behind the registry. **Request architecture** (V1, aligned): `POST /api/v3/contents/generations/tasks`, body `{model, content:[{type:"text", text:"<prompt> --ratio 9:16 --resolution 720p --duration 5 --seed N"}]}`, Bearer auth, poll task → `content.video_url`.

**Retry / failure / fallback (V1 + recommended):**
```
per scene:  Seedance → Runway → Luma → Pexels(stock, last-resort)
            BullMQ attempts:3, backoff 5s (job-level)
            durability gate: no R2 storage_url ⇒ fail fast (no expiring URL into compose)
```
**Why this chain:** quality-first (Seedance), two AI fallbacks that share the provider contract, and a **guaranteed-success stock tail** so a scene never hard-500s — but the gate ensures we fail loudly rather than ship an expired URL. Caveat: when Seedance is down, Pexels stock breaks the "AI-first metaphor" look — fallbacks should be flagged in `scene_generations.fallback_reason` (V1 does) and surfaced to the user, not silent.

---

## 4 · Scene storage

- **`scene_generations`** (migration 007 + 022): one row/scene — `provider, clip_url (ephemeral), storage_url (R2, durable), storage_key, seed, duration/width/height, generation_time_ms, cost_usd, fallback_reason, metadata`. Realtime-published for the detail view.
- **R2 structure:** `{userId}/{renderJobId}/scene-{n}.mp4` (scenes) + `{userId}/{renderJobId}/ffmpeg-v2.mp4` (final). Provider URLs expire (~1 h) → copied to R2 immediately (V1).
- **Lifecycle:** scene clips are intermediate → apply an R2 lifecycle rule to expire `scene-*.mp4` after N days; **keep final MP4s** (referenced by `render_jobs.merged_video_url`). Not yet configured — recommend a 7–30 day scene-clip TTL.
- **Versioning:** by `renderJobId` — every regenerate is a new job/new key prefix; `render_jobs.video_strategy` freezes the inputs for reproducibility.

---

## 5 · FFmpeg composition (3/4/5/6 scenes)

The multi-pass design (V1 `composeMultiPass`) scales linearly with N — **no per-N special-casing**:

```
Order of operations (per video, any N):
1. NORMALIZE  — N× single-decode passes: scale→crop→grade(LUT)→format→setpts→fps
                (1 decode each; the 1GB-safe pattern)
2. CTA CARD   — render sharp PNG (palette+CTA+logo) → 1 looped clip
3. CONCAT     — demuxer joins [scene1..sceneN, cta] (0 extra decode; hard cuts @2GB)
4. CAPTIONS   — ASS burn-in (per-beat caption, ≤22ch/2 lines)
5. BRAND      — logo overlay (looped input, overlay:shortest=1, bottom-right)
6. COLOR      — per-scene LUT applied in (1) so mixed clips share one grade
7. EXPORT     — libx264 yuv420p +faststart, platform crop (9:16 master → 1:1/16:9 derivations)
```
- **Transitions:** hard cuts at 2 GB (single decode). `xfade`/`dissolve`/brand-signature transition require ≥4 GB (2 simultaneous decodes) — **production target**.
- 3 vs 6 scenes only changes the count in passes 1 + 3; memory peak is constant (never >1 decode at concat) → 6-scene videos are as RAM-safe as 3-scene.

---

## 6 · Branding engine (hierarchy → different videos)

The Creative Hierarchy Engine must produce **structurally different** videos, not just different overlays:

| Hierarchy | Scene structure delta | Logo | Headshot | Data | Quote | Grade/motif |
|---|---|---|---|---|---|---|
| **Founder-led** | Outcome beat → founder card (static intro/outro frame) | overlay always | **CTA/end card only** (real headshot can't ride moving AI scenes convincingly) | — | — | warmer LUT, human cadence |
| **Data-led** | add **Insight** beat = kinetic-number scene (the metaphor dramatizes the statistic) | overlay | — | **hero, animated** | — | precise, high-contrast |
| **Quote-led** | one beat = full-screen typographic quote (quotation-mark motif) | overlay | — | — | **hero typography** | calm, editorial |
| **Brand-led** | pure metaphor + pattern forward | overlay prominent | — | — | — | palette-saturated |

**Rules — when each appears:**
- **Logo:** always, deterministically, FFmpeg overlay (bottom-right) — never to a model.
- **Headshot:** only `founder_led` AND a valid (decodable) headshot asset exists → on a static card, never composited over Seedance motion.
- **Data:** when the opportunity/brief carries a statistic → it becomes the Insight beat's on-screen kinetic text (FFmpeg/ASS, not Seedance).
- **Quote:** when a testimonial exists → dedicated typographic beat.
- **Typography:** per-brand ASS style (font/weight/outline/position) = the caption equivalent of the image headline style.

**Honest gap:** V1 sets `branding` (logo overlay + CTA card + palette) but does **not** yet vary scene *structure* by hierarchy — all hierarchies currently yield the same 4-beat shape. Hierarchy-driven structure is the difference between "branded overlay" and "branded story."

---

## 7 · Brand recognition without the logo (the critical one)

Goal: logo removed, still reads as Basecamp / Stripe / HubSpot. This requires a **Brand Pattern Library** (`brand_video_identity`, per brand) — currently **absent** (P4 Phase 2). Spec:

| Layer | What it encodes | Applied |
|---|---|---|
| **Color system** | per-brand 3D LUT from palette (primary/secondary/accent) | FFmpeg `lut3d`, every clip |
| **Motion language** | the brand's verb: Basecamp=*calm convergence*, Stripe=*precise gradient flow*, HubSpot=*warm orbital* | Seedance prompt grammar + Agent-10 zoom/pan presets |
| **Transition signature** | one recurring transition (e.g. always converge-to-center) | FFmpeg xfade (≥4 GB) |
| **Composition grid** | safe-zones, weight, negative space | prompt + overlay placement |
| **Camera grammar** | push/drift/orbit cadence per brand | prompt + Ken Burns |
| **Visual motifs** | a geometry family (lattice, arcs, particles) tied to the metaphor | prompt seed + pattern overlay PNG |

**Recognition = the *combination*** of LUT + motion + transition + type + motif. No single one suffices; together they're a fingerprint. This is the only thing that moves the output from "nice AI abstract" to "unmistakably this brand." **It is the highest-leverage unbuilt piece.**

---

## 8 · User experience

After content generation, three panels appear on the content item: **Creative Strategy · Creative Image · Video Strategy**.

- **Approval flow:** Video Strategy shows the brief (tension/metaphor/4-beat scene prompts + captions + hierarchy/confidence) **before any generation spend** — approve gates Seedance, mirroring the image approval gate.
- **Generation flow:** approve → `render_jobs` (ai-first) → `scene-generation` (per-scene progress 10→70) → `ffmpeg-compose` (75→100). Status streams via `render_jobs.progress` + `scene_generations` Realtime on `/video/[jobId]`.
- **Preview flow:** inline player on the detail page once `merged_video_url` is set; per-scene thumbnails from `scene_generations`.
- **Publish flow:** P5 publisher (LinkedIn first) — manual-publish fallback as MVP.
- **Download flow:** direct R2 URL (zero-egress).
- **History flow:** `/video/history` + `/video/[jobId]` (already exist) listing render_jobs with `render_kind`, provider, scene breakdown.

**UX risk:** generation takes minutes (4 sequential Seedance polls + compose). The brief-approval-first pattern is essential so the wait is opt-in and the user isn't billed for an unreviewed concept.

---

## 9 · End-to-end architecture

```
                         ┌───────────── Vercel (Next.js) ─────────────┐
 Research ─ Opportunity ─│ Content ─ Creative Strategy ─ Creative Image│  Gemini + Imagen + sharp
 (pgvector evidence)     │            └─ Visual Tension / Metaphor ────┤
                         │ Video Strategy (buildVideoStrategy, Gemini) │
                         │ POST /api/video/generate → render_jobs      │
                         └───────────────┬─────────────────────────────┘
                                         │ enqueue  (BullMQ / Redis)
                         ┌───────────────▼──────────── Railway worker ─┐
 Scene Planning ─────────│ scene-generation:                            │
                         │   per scene → registry.generateScene         │──► Seedance (ModelArk)
                         │     Seedance→Runway→Luma→Pexels              │    (Runway/Luma/Pexels)
                         │   copy clip → R2 ; write scene_generations   │──► Cloudflare R2
                         │   buildAiFirstPlan → enqueue ffmpeg-compose  │
                         │ ffmpeg-compose:                              │
                         │   normalize→concat→captions→logo→CTA→export  │──► R2 (final MP4)
                         │   QC (Agent 12)                              │
                         └───────────────┬──────────────────────────────┘
                                         │ render_jobs.merged_video_url (Supabase + Realtime)
                         Publishing (P5) ─┴─ Analytics / Attribution (P6/P7)
```
Services: Vercel (UI/API), Gemini (strategy), BullMQ+Redis (orchestration), Railway worker (Seedance polling + FFmpeg), Seedance/ModelArk (scenes), R2 (storage), Supabase (state + Realtime), Clerk (auth).

---

## 10 · Critical review (brutal)

| Area | Current state | Future state | Risk | Priority |
|---|---|---|---|---|
| **Video Strategy** | 4-beat from tension/metaphor; build-verified, undeployed | 3/4/5/6 by platform+hierarchy | Med — N not yet variable | P1 |
| **Scene Planning** | independent clips, shared palette/seed | **frame-chained** continuity | **High — 4 disjoint clips look stitched** | **P0 for quality** |
| **Seedance** | contract aligned, never run live | proven + tuned params | High — unvalidated live; account/region/cost open | P0 (env) |
| **FFmpeg** | normalize→concat→logo→CTA, hard cuts, RAM-safe | xfade + brand transitions @4 GB | Med — runtime unproven; 1 GB still OOMs | P0 (RAM) |
| **Branding** | logo overlay + CTA + palette | hierarchy-driven *structure* | **High — all hierarchies look the same today** | **P1** |
| **Brand Recognition** | palette only | **Brand Pattern Library** (LUT+motion+transition+motif) | **Critical — absent** | **P1 (the differentiator)** |
| **Publishing** | manual P5 | LinkedIn API | Med | P2 |

### The honest answer
> *"Would this architecture generate videos that are recognizably branded and strategically aligned — or generic AI videos?"*

**Strategically aligned: genuinely yes.** The tension→metaphor→4-beat spine is real differentiation. Most competitors do prompt→clip with no narrative or brand thesis; Ottoflow derives the video from the same evidence-backed strategy as the image creative. That spine is the moat and it exists.

**Recognizably branded: not yet — today it would land as "elevated generic."** Be blunt about why:
1. **No Brand Pattern Library.** With only a palette + logo overlay, two brands with similar colors produce near-identical videos. Color alone is not identity. (§7 is unbuilt.)
2. **Abstract metaphor is a double-edged sword.** "Jumbled lines converging" is strategic, but abstract geometric motion is *exactly* what reads as "generic AI loop." Without a brand-specific motion language + transition signature, the abstraction defaults to genericness.
3. **Scenes look stitched, not authored.** Four independently-generated clips with hard cuts ≠ a directed film. Without frame-chaining (§2.2) the eye sees "AI montage," and hard cuts (the 2 GB constraint) amplify it.
4. **Hierarchy doesn't change the film.** Founder/data/quote/brand-led currently differ only in overlays, not structure or motion — so a "founder-led" video isn't recognizably founder-led.
5. **The logo overlay is the crutch.** Strip the logo today and most of the brand signal goes with it — which is precisely the test this architecture says it must pass, and currently fails.

**What flips it from elevated-generic to recognizably-branded (in priority order):**
- **(a) Brand Pattern Library** — per-brand LUT + motion grammar + transition signature + motif. *This is the difference-maker; everything else is table stakes.*
- **(b) Frame-chaining** for scene continuity (one authored arc, not four clips).
- **(c) Hierarchy-driven scene structure** (founder/data/quote produce structurally different videos).
- **(d) xfade/brand transitions** (needs the 4 GB target).

**Bottom line:** the *strategy layer* is ahead of the market; the *visual identity layer* is behind its own promise. Ship V1 to prove the pipeline, but do **not** market it as "recognizably branded" until the Brand Pattern Library (a) + frame-chaining (b) exist. Until then, honest framing is "strategy-driven AI video," not "your brand, in motion."
