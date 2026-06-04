# Video Pipeline v2 — Quality + Reliability Pass

**Sprint date:** 2026-06-05
**Goal:** Every generated video has on-topic background clips, per-scene 3-word animated overlays at dynamic positions, and visible live merge progress.
**Commits shipped:** `cfd390f` (P0) → `f269daf` (P1) → `be8255e` (P2+P3) on `main`.

---

## Problems addressed

The user reported four concerns:

1. **Merging audio and video stuck** — UI showed no progress for 100–150s during the merge phase, looked frozen.
2. **Background video does not align with topic** — Pexels fallback returned off-topic clips; Runway/Luma scene generation lacked brand context.
3. **No text animation per scene** — overlays were a flat list across the whole video at one fixed position.
4. **Should be dynamic** — content-driven, varying per scene.

---

## Root causes (audited in code before any fix)

### 1. "Merging stuck" — silent progress

The `video-merge` worker called `job.updateProgress()` (BullMQ-internal only) in its `report` callback. It **never wrote to `render_jobs.progress`** during the merge. The row stayed at `merge_status='merging', progress=0` for the entire 100–150s window. UI subscribed to Realtime saw zero changes between the start update and the final `merge_status='done'`.

`worker/index.ts:248-251` — original `report` callback only logged + updated BullMQ.
`worker/processors/video-merge.ts:223,333,366,437,575,588,615` — emitted progress milestones 5/10/28/35/50/80/100 that went nowhere user-visible.

### 2. "Background doesn't align with topic" — two bugs

**2a.** `generateVideoStoryboard()` in `src/lib/gemini.ts:769` took `{prompt, style, sceneCount, script}` — **no brand industry or topic title as labeled fields**. Industry was buried as a substring inside the synthesized `prompt`. Gemini lost the signal and generated generic descriptions ("walnut desk, golden hour"), which drove off-topic Runway/Luma generation.

**2b.** `src/lib/pexels.ts` matched the prompt against **12 hardcoded `TOPIC_OVERRIDES`** regexes (coffee/standing-desk/skincare/fitness/tech/finance/food/fashion/travel/home/startup/marketing). Anything outside those patterns fell back to dumb keyword extraction (any word >3 chars, not in stopwords), with no brand context.

### 3. Overlays were per-video, not per-scene

`extractImportantWords()` took the whole narration text and returned ~8 overlays with absolute timestamps spread across the entire video. `buildDrawtextChain()` rendered them all at fixed `y=h*0.65`. No per-scene awareness, no positional variation.

---

## Changes shipped

### P0 — Live merge progress (`cfd390f`)

**File:** `worker/index.ts`
**Change:** Added a fire-and-forget `render_jobs.update({progress}).eq("id", renderJobId)` call inside the videoMerge worker's `report` callback. Reuses `recoveryAdmin` (service-role client at module scope). Failed writes are logged but don't fail the merge.

```ts
const result = await processVideoMerge(job.data, (step, progress) => {
  job.updateProgress(progress).catch(() => {});
  void recoveryAdmin
    .from("render_jobs")
    .update({ progress })
    .eq("id", job.data.renderJobId)
    .then(/* error logging */);
  log("video-merge", "step", { jobId: job.id, step, progress });
});
```

**User-visible effect:** Progress bar in `/video/generate` ticks through 5 → 10 → 28 → 35 → 50 → 80 → 100 during merge instead of being frozen at 0.

### P1 — Brand-aware storyboard + Pexels query stack (`f269daf`)

**Files:**
- `src/lib/gemini.ts` — `generateVideoStoryboard()` signature gained optional `brand: {name, industry}` and `topic: {title, category}` params. Prompt template surfaces them as labeled fields above the brief, plus a new IMPORTANT constraint at the bottom that bans generic stock aesthetics ("modern desk", "person on laptop") and explicitly requires the brand's industry to be visible from any single frame.
- `src/lib/pexels.ts` — `buildQueries()` accepts new `ctx: {brandIndustry, topicTitle, shotType}`. When present, those queries are prepended at HIGHEST priority — above the 12 hand-tuned `TOPIC_OVERRIDES` regexes. `findStockVideoByPrompt()` and `findStockPhotoByPrompt()` both accept the new fields.
- `src/app/api/generate/route.ts` — hoisted `brand`/`topic` lookups into outer scope as `brandForGen`/`topicForGen` so both the storyboard call and the Pexels fallback can pass them as labeled fields rather than relying on the synthesized `effectivePrompt` substring.

**User-visible effect:** A fitness brand gets scene descriptions like "athlete mid-stride at sunrise, breath fog visible" rather than "modern minimalist studio". When the Pexels fallback runs, the search hits `fitness closeup cinematic` before keyword extraction even runs.

### P2 — Per-scene 3-word overlay extraction (`be8255e`, part 1)

**Files:**
- `src/lib/gemini.ts` — new `extractSceneOverlays()` Gemini function. Input: structured `scenes[{index, durationSec, description, voiceLine?}]` + narration `{hook, body, cta}`. Output: `scenes[{sceneIndex, overlays:[{text, offsetSec, durationSec}]}]` with exactly 3 entries per scene. Prompt explicitly forbids brand-name overlays, requires ALL-CAPS, demands distribution across the scene (early/middle/late), and frames the 3 overlays as a "setup → hit → payoff" beat.
- `src/lib/queue.ts` — `VideoMergeOverlay` gained optional `sceneIndex` field. Backward-compatible.
- `src/app/api/generate/route.ts` — replaces the `extractImportantWords` call with `extractSceneOverlays`. Converts scene-local `offsetSec` to absolute video timestamps by cumulating `storyboard.scenes` durations. Slices `overlays.slice(0, 3)` defensively in case the model returns more.

**User-visible effect:** A 4-scene video gets 12 overlays (3 per scene) instead of ~8 spread across the timeline. Words are tied to what's actually happening in the matching scene.

### P3 — Per-scene y-position rotation (`be8255e`, part 2)

**File:** `worker/processors/video-merge.ts`
**Change:** New `OVERLAY_Y_POSITIONS` constant + `pickYForScene(sceneIndex)` helper. `buildDrawtextChain()` reads `overlay.sceneIndex` and rotates the drawtext `y=` expression through 5 presets:

| Scene index (mod 5) | y expression | Position |
|---|---|---|
| 1 | `h*0.18` | top-third |
| 2 | `(h-text_h)/2` | true vertical center |
| 3 | `h*0.65` | lower-third (legacy default) |
| 4 | `h*0.78` | very low (above TikTok UI overlay zone) |
| 5 | `h*0.40` | upper-middle |

Overlays without `sceneIndex` (legacy or free-form-prompt path) fall back to `h*0.65`. Scale-pop + fade-in/out animation unchanged.

**User-visible effect:** Different scenes show overlays at different positions — the video reads as edited rather than every overlay stamped at the same lower-third.

---

## Test recipe (smoke)

After Vercel + Railway redeploy with `be8255e` live:

1. Open `/brands` → pick (or create) a brand that has at least one `draft` topic. Note the industry.
2. Pick a topic → "Generate video".
3. Watch the SSE stream — confirm new step `"Extracting per-scene overlays"` appears at ~86%.
4. After SSE `done`, the merge enqueues. **Check the progress bar** — should tick 5 → 10 → 28 → 35 → 50 → 80 → 100 over the next ~2 min, NOT freeze at 0. (P0 success.)
5. When `merge_status='done'`, open the merged MP4. Verify:
   - Background clips read as **on-topic** for the brand's industry (P1 success).
   - Overlays appear **per scene** (3 per scene boundary, not spread evenly) (P2 success).
   - Overlay positions **rotate** between scenes — first scene at top, second center, third lower-third, etc. (P3 success).

---

## Follow-ups not addressed in this sprint

- **Brand context not threaded into `SceneRequest` / Runway provider** — only the storyboard descriptions encode brand context, which is enough because Runway's `promptText` is the scene description. But Runway's Pexels seed-image search (`findStockPhotoByPrompt`) doesn't yet receive structured context; it relies on the same scene description string. Could add explicit context passing if smoke shows seed images being off-topic.
- **Overlay animation styles still uniform** — only y-position rotates per scene. Could add per-scene animation variants (slide-down, slide-up, flash) in a future P3.1 if visual variety isn't enough.
- **Gemini-suggested style per scene (Q2 from sprint kickoff)** — defaulted to deterministic rotating presets. If the user wants the model to pick per-scene style based on content emotion, that's a single additional LLM call and a `style: string` field in the SceneOverlays schema.
- **`extractImportantWords` not removed** — left in `gemini.ts` for backward compat / future free-form-prompt paths. Dead-code cleanup deferred.
- **Pexels TOPIC_OVERRIDES still hand-maintained** — 12 regexes. With v2 P1b, the brand/topic queries get tried first so the overrides are only the fallback path. Could be removed entirely once smoke confirms the brand/topic path is sufficient.

---

## Reference: commits

```
cfd390f  fix(worker): pipe merge progress into render_jobs.progress
f269daf  feat(video-pipeline): brand-aware storyboard + Pexels query stack (v2 P1)
be8255e  feat(video-pipeline): per-scene 3-word overlays with rotating positions (v2 P2+P3)
```

All on `main`, all pushed to `origin/main`. Vercel auto-deploys the Next.js side; Railway auto-deploys the worker.
