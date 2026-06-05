# Video Timeline Audit

**Date:** 2026-06-05
**Audit target:** `ottoflow-ai/` end-to-end video pipeline
**Trigger:** A 25-35s generated video displaying what appears to be a single stock clip for most or all of the duration while narration and music continue playing.
**Method:** Read-only code audit. Every claim references a file and line number. No assumptions about runtime state.

---

## TL;DR

The pipeline **does** plan a multi-scene timeline at the Gemini storyboard stage. It **conditionally** attempts to generate per-scene clips in the worker. It **silently degrades to a single Pexels clip** whenever fewer than 2 scene clips come back successful — and this fallback is the most likely path in production today because (a) the worker-env schema does not declare `RUNWAYML_API_SECRET` / `LUMA_API_KEY` / `PEXELS_API_KEY` as required, so missing keys produce zero startup signal, (b) the per-scene Pexels fallback in the provider chain does NOT receive brand/topic context that the route handler has, so its queries are brittler than the route's own single-clip prefetch, and (c) when scene gen returns ≤ 1 success the worker discards the partial results and falls back to the route's single prefetched clip without any user-visible warning.

There is no timeline object, no transition support, no narration-duration measurement, and no per-scene visual variety beyond the storyboard text descriptions reaching the providers.

**Severity: P0 for the user-visible promise** ("each scene becomes a unique visual segment"). The architecture supports it; the *deployment* doesn't.

---

## Pipeline data flow (as currently implemented)

```
┌──────────────────────────────────────────────────────────────────┐
│ POST /api/generate (src/app/api/generate/route.ts)               │
└──────────────────────────────────────────────────────────────────┘
   │
   ├─ sceneCount = input.sceneCount ?? 4                  [route.ts:209]
   ├─ targetSeconds = clamp(15, sceneCount * 6, 60)       [route.ts:211]
   │
   ├──► generateVideoScript({prompt, style, musicVibe, targetSeconds})
   │      ↳ returns {hook, body, cta, estimatedDurationSec, voiceDirection}
   │      ↳ estimatedDurationSec is Gemini's WORD-COUNT GUESS  [gemini.ts:687, 712]
   │
   ├──► generateVideoStoryboard({prompt, style, sceneCount, script, brand?, topic?})
   │      ↳ Prompt says "Exactly ${sceneCount} scenes. Index them 1..N"  [gemini.ts:787]
   │      ↳ returns {scenes:[{index, durationSec, shotType, cameraMove,
   │                          description, onScreenText?, voiceLine?}],
   │                 totalDurationSec, aestheticNotes}     [gemini.ts:728-742]
   │      ↳ NO sum-to-target validation                    [no enforcement]
   │
   ├──► synthesizeNarration({text: hook+body+cta})
   │      ↳ ElevenLabs eleven_turbo_v2                     [elevenlabs.ts:41]
   │      ↳ returns {audioDataUrl, byteLength, voiceId, modelId}
   │      ↳ NO duration field returned                     [elevenlabs.ts:28-33]
   │      ↳ NO ffprobe call anywhere                       [grep ffprobe → 0]
   │
   ├──► findTrackByVibe(...)            (Jamendo music)
   ├──► generateVideoSEO(...)           (post copy)
   ├──► extractSceneOverlays(...)       (P2 — per-scene 3-word overlays)
   │
   ├─ sceneSpecs = storyboard.scenes.map(scene => ({
   │     index, prompt: scene.description, shotType,
   │     durationSec: clamp(3, scene.durationSec, 10) }))  [route.ts:700-705]
   │
   ├──► findStockVideoByPrompt(...)     (PREFETCH SINGLE-CLIP FALLBACK)
   │      ↳ Uses brandIndustry + topicTitle (after v2 P1b)  [route.ts:655-666]
   │      ↳ Result becomes `videoUrl` in the merge payload
   │
   └──► videoMergeQueue().add('merge', {
            renderJobId, userId,
            videoUrl,                              ← single-clip fallback
            audioDataUrl, musicUrl,
            overlays: sceneOverlays,
            sceneSpecs: sceneSpecs.length > 1     ← CONDITIONAL  [route.ts:808-816]
                          ? sceneSpecs.map(...)
                          : undefined,
            aestheticNotes,
          })

                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Railway worker — video-merge processor                           │
│ (worker/processors/video-merge.ts → processVideoMerge)           │
└──────────────────────────────────────────────────────────────────┘
   │
   ├─ needsSceneGeneration =
   │     !!sceneSpecs && sceneSpecs.length > 1 && (!scenes || scenes.length===0)
   │                                                       [video-merge.ts:225]
   │
   ├─ if (needsSceneGeneration):                          [video-merge.ts:243]
   │     for each spec, with CONCURRENCY=3:
   │        try registryGenerateScene({prompt: aestheticPrefix + spec.prompt,
   │                                    durationSec, aspectRatio: "9:16"})
   │        on success → completed.push({index, url, durationSec, provider})
   │        on failure → write {provider:'failed', fallback_reason} to DB
   │                   → DO NOT push to completed         [video-merge.ts:306-324]
   │     scenes = completed                                [video-merge.ts:335]
   │
   ├─ hasScenes = !!scenes && scenes.length > 1            [video-merge.ts:338]
   │
   ├─ if (hasScenes):
   │     download N scene URLs in parallel                 [video-merge.ts:365-371]
   │     per-scene normalize: scale=720:1280, -t targetDur, libx264 ultrafast
   │                                                       [video-merge.ts:402-425]
   │     concat demuxer with -c copy (STRAIGHT CUT)        [video-merge.ts:444-451]
   │
   ├─ else:
   │     download single videoUrl                          [video-merge.ts:373]
   │     (no normalization, no concat)
   │
   ├─ build audio chain: amix narration + ducked music     [video-merge.ts:484-561]
   ├─ optional drawtext overlay chain (P2/P3)              [video-merge.ts:544]
   ├─ final ffmpeg with -shortest                          [video-merge.ts:499/514/532/590]
   └─ upload merged.mp4 to Supabase Storage                [video-merge.ts:608]
```

---

## Provider chain (per-scene generation)

```
src/lib/video-providers/registry.ts
─────────────────────────────────
chain = [RunwayProvider, LumaProvider, PexelsFallbackProvider]  [registry.ts:37]

for each provider:
   if !provider.isConfigured():           [registry.ts:69]
       attempts.push({provider, error:"not configured"})
       continue                            ← silent skip, no log
   try return await provider.generateScene(request)
   catch:
       attempts.push({...})
       captureFallback(...)               [registry.ts:78]
       continue

if all fail → throw AllProvidersExhaustedError(attempts)  [registry.ts:87]

Runway   isConfigured() = !!RUNWAYML_API_SECRET && !!PEXELS_API_KEY [runway.ts:79]
Luma     isConfigured() = !!LUMA_API_KEY                            [luma.ts:58]
Pexels   isConfigured() = !!PEXELS_API_KEY                          [pexels.ts:18]
```

**CRITICAL:** `worker-env.ts` (lines 35-70) declares **only** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `GOOGLE_API_KEY` as required. **None of `RUNWAYML_API_SECRET`, `LUMA_API_KEY`, `PEXELS_API_KEY` are validated at worker boot.** A worker can come up green and successfully process merges while silently being unable to generate any per-scene clip.

---

## The 10 questions, answered with code

### 1. How many scenes are actually generated?

**Planned:** `sceneCount` (default **4**) — passed to Gemini storyboard prompt which says *"Exactly ${input.sceneCount} scenes. Index them 1..N"* at [`gemini.ts:787`]. Returned as `storyboard.scenes` array.

**No verification** that Gemini honored the count. If Gemini returns 1 scene (rare but not enforced), the pipeline silently proceeds with 1 — and the worker's `sceneSpecs.length > 1` check at [`route.ts:809`] then drops scene generation entirely.

### 2. How many scenes are actually rendered?

`completed.length` after the scene-gen loop [`video-merge.ts:335`]. Failed scenes are written to DB but **not pushed to `completed`** [`video-merge.ts:306-324`]. Then [`video-merge.ts:338`]:

```ts
const hasScenes = !!scenes && scenes.length > 1;
```

**If `completed.length` is 0 or 1, the multi-scene path is bypassed entirely.** No partial-multi-scene render: it's all-or-nothing-at-2.

### 3. How many video assets are fetched?

- **Always:** the prefetched single-clip Pexels MP4 (`videoUrl` in merge payload) — fetched in `/api/generate` regardless of scene generation outcome [`route.ts:707-735`].
- **Conditionally:** `scenes[].url` for each successful scene clip downloaded in parallel [`video-merge.ts:365-371`].

In the single-clip fallback path: **exactly 1 video asset is fetched** by the worker [`video-merge.ts:373`].

In the multi-scene path: **N video assets are fetched** (one per successful scene) plus the `videoUrl` is downloaded only if there are zero scenes — the multi-scene branch ignores `videoUrl`.

### 4. Are scene durations calculated?

Yes, but **only by Gemini**. Three layers:

1. Gemini storyboard returns `scenes[].durationSec` (an integer) [`gemini.ts:757`].
2. Route handler clamps each to 3-10s: `durationSec: Math.max(3, Math.min(10, scene.durationSec))` [`route.ts:704`].
3. Worker uses `spec.durationSec` as the `-t` cap when normalizing each scene clip [`video-merge.ts:401, 414`].

**There is no validation that `sum(scenes[].durationSec) === storyboard.totalDurationSec`** and no validation that either equals `script.estimatedDurationSec` or `targetSeconds`.

### 5. Is narration duration used to size scenes?

**No.**

- ElevenLabs `synthesizeNarration` returns `{audioDataUrl, byteLength, voiceId, modelId}` — **no duration field** [`elevenlabs.ts:28-33`].
- `grep -r "ffprobe" ottoflow-ai/` matches only `docs/BETA_READINESS_REPORT.md`. **No runtime measurement of the produced MP3.**
- `narrationDuration`, `getDuration`, `measureDuration` — **zero hits in code**.

Scene durations come exclusively from Gemini's pre-TTS word-count estimate. If the actual TTS is 30s and the storyboard summed to 24s, the merge ends at 24s (because `-t targetDur` per scene + concat = 24s of video; then `-shortest` truncates the 30s narration to match).

### 6. Is only the first successful asset being used?

**Yes, in the failure mode that the user is observing.** The merge worker handles 3 distinct branches:

| Worker state | Branch | Result |
|---|---|---|
| `needsSceneGeneration = false` (no `sceneSpecs` or `sceneSpecs.length ≤ 1`) | Single-clip path | Downloads `videoUrl` (Pexels prefetch), runs audio merge over it. **Visually 1 clip for whole video.** |
| `needsSceneGeneration = true` AND `completed.length ≤ 1` | Single-clip fallback | Falls into else branch at `hasScenes = false`. Downloads `videoUrl`. **Discards any partially successful scenes.** |
| `needsSceneGeneration = true` AND `completed.length ≥ 2` | Multi-scene path | Downloads N scene URLs, normalizes each, concats. **Visually N clips back-to-back.** |

[`video-merge.ts:225, 338, 365-374, 444-451`]

### 7. Is the renderer concatenating clips?

**Yes — only in the multi-scene path** [`video-merge.ts:444-451`]. The concat uses ffmpeg's concat demuxer with `-c copy` (stream copy) which produces **hard cuts only — no crossfades, no dissolve, no transitions**:

```ts
const cat = await runFfmpeg([
  "-y", "-f", "concat", "-safe", "0", "-i", concatManifest,
  "-c", "copy", videoIn,
]);
```

The concat manifest is built from the per-scene normalized files at [`video-merge.ts:434-441`]. In the single-clip path, no concat runs.

### 8. Is there a timeline object at all?

**No.** Closest data structures:

- `storyboard.scenes[]` — Gemini's plan (ordered by index)
- `sceneSpecs[]` — `(prompt, durationSec, shotType, index)` tuples in queue payload [`queue.ts:156-161`]
- `VideoMergeScene[]` — `(index, url, durationSec, provider?)` tuples in queue payload [`queue.ts:139-144`]
- `overlays: VideoMergeOverlay[]` with absolute `start`/`end` seconds and optional `sceneIndex` [`queue.ts:124-138`]

These are **plain arrays of tuples** consumed sequentially by ffmpeg. There is no first-class concept of:
- A track (video / audio / overlay)
- A clip with in-point and out-point
- A transition between two clips
- A timeline that can be persisted, replayed, or edited

The "timeline" is implicit in the concat-manifest file and the audio `amix` filter. It exists only for the duration of one ffmpeg invocation.

### 9. Are transitions supported?

**No.** `grep -i "xfade|crossfade|fade=t=|transition" worker/` returns **zero matches**. The only fades in the system are inside the drawtext overlay alpha envelope (text fade in/out) at [`video-merge.ts:177`]. Scene-to-scene transitions are always straight cuts via concat demuxer with stream copy.

### 10. Why does a 30-second narration result in a video that visually appears to use only one stock clip?

The most likely chain of events, ranked:

#### Mode A (highest probability — matches your observed Railway log)

Worker logs `progress: 5 → 10 → 28` in 164ms, meaning the scene-gen loop ran but every `registryGenerateScene()` call threw within ~40ms per scene. Only way this is possible:

1. Storyboard returned ≥ 2 scenes → `sceneSpecs` sent to worker [`route.ts:808-816`]
2. Worker entered scene-gen loop [`video-merge.ts:243`]
3. For each scene the registry walked the chain:
   - Runway: `isConfigured()` returned false → instant skip (~1ms) — because `RUNWAYML_API_SECRET` and/or `PEXELS_API_KEY` not set on the worker [`runway.ts:79`]
   - Luma: `isConfigured()` returned false → instant skip — because `LUMA_API_KEY` not set [`luma.ts:58`]
   - Pexels: either `isConfigured()` returned false (no `PEXELS_API_KEY` on worker) → instant skip, OR returned true but `findStockVideoByPrompt` returned null and threw [`video-providers/pexels.ts:27-30`]
4. `AllProvidersExhaustedError` thrown for every scene
5. Worker catch block wrote `provider:'failed'` rows but pushed nothing to `completed` [`video-merge.ts:306-324`]
6. `scenes = completed = []`, `hasScenes = false` [`video-merge.ts:335, 338`]
7. Worker downloaded the pre-fetched single Pexels `videoUrl` [`video-merge.ts:373`]
8. Final video = 1 Pexels clip + narration + music; **no concat, no overlays**

The user sees: one stock clip looping/static, narration + music continuing past or shorter than the clip depending on `-shortest`.

#### Mode B

Storyboard returned exactly 1 scene → `sceneSpecs.length = 1` → route sent `sceneSpecs: undefined` to worker [`route.ts:809`] → worker `needsSceneGeneration = false` from line 225 → skipped scene-gen entirely → single-clip path. Same observable result as Mode A.

#### Mode C

Storyboard returned ≥ 2 scenes, but only 1 provider call succeeded (e.g. Runway gave us scene 1, Luma timed out on scenes 2/3, Pexels not configured). `completed.length = 1`, `hasScenes = !!scenes && scenes.length > 1` returns false [`video-merge.ts:338`] → falls back to single-clip. **The one successful scene is silently discarded.**

In all three modes the merged MP4 contains exactly one Pexels stock clip stretched (via `-shortest`) over the narration. No per-scene visuals, no overlays (overlays require multi-scene to fire correctly — they get absolute timestamps but only render when drawtext runs in Path B which requires `hasOverlays && fontPath`).

---

## Root cause

**The architecture supports multi-scene composition, but the worker's "all-or-nothing-at-2" fallback policy combined with un-validated provider env vars makes the single-clip degraded mode the dominant runtime branch.** Five compounding factors:

1. `worker-env.ts:35-70` does not declare `RUNWAYML_API_SECRET` / `LUMA_API_KEY` / `PEXELS_API_KEY` as required, so the worker boots green when none are set.
2. `registry.ts:69-72` silently skips unconfigured providers — no warning log, no metric.
3. `video-providers/pexels.ts:23-26` does NOT receive `brandIndustry` / `topicTitle` from the worker — only the route's single-clip prefetch (which is on Vercel and DOES have `PEXELS_API_KEY`) was updated to pass them in v2 P1b. So even when worker Pexels IS configured, its queries are brittler.
4. `video-merge.ts:338` uses `> 1` as the threshold — a partial success (1 of 4 scenes generated) is treated as total failure.
5. `video-merge.ts:225, 338, 373` provides a "single-clip videoUrl fallback" that hides all scene-gen failures from the user. No surfaced error, no log line saying *"reverted to single-clip because N of M scenes failed"*.

Secondary: no narration measurement (Q5) means audio/video duration drift can be ±3s. The straight-cut concat (no transitions, Q9) means even when multi-scene fires, the result looks like a cheap slideshow rather than an edited video.

---

## Severity

| Concern | Severity | Notes |
|---|---|---|
| Single-clip-for-whole-video bug | **P0** | Directly contradicts product promise. User-visible. Reproducible 100% if any provider env var is missing. |
| Silent fallback (no warning to user) | **P0** | Makes the bug invisible to operators. No Sentry, no UI banner. |
| Worker env not validated | **P1** | `worker-env.ts` should fail boot when scene providers are unset (or surface a clear "scene generation disabled" log line per startup). |
| Per-scene Pexels missing brand context | **P1** | When Pexels IS the only configured provider, it should still get brand+topic — currently it doesn't (only the route prefetch does). |
| No narration duration measurement | **P2** | Causes ±3s audio/video drift. Worth fixing but not what the user is reporting. |
| No transitions support | **P2** | Aesthetic, not functional. Straight cuts are acceptable for v1; crossfades would be a polish-pass. |
| `hasScenes` requires `> 1` (not `≥ 1`) | **P2** | Partial success is rejected. A single successful AI scene + a Pexels fallback for the rest would be better than today's all-Pexels fallback. |

---

## Recommended fix (smallest blast radius first)

### F1 — Surface the silent fallback (P0, ~30 min)

In `video-merge.ts:338`, when `needsSceneGeneration` was true but `hasScenes` ends up false:
- Log structured WARN with `attempts[]` showing what each provider returned
- Write `merge_error` to `render_jobs` with a clear "scene generation produced 0 of N clips — reverted to single-clip fallback" message
- Fire a Sentry event
- Optionally update UI to show "Stock-clip fallback (scene generation unavailable)" badge

### F2 — Validate scene-provider env at worker boot (P0, ~20 min)

In `worker-env.ts`, add Zod fields:

```ts
RUNWAYML_API_SECRET: z.string().optional(),
LUMA_API_KEY:        z.string().optional(),
PEXELS_API_KEY:      z.string().optional(),
```

Then at boot, log:

```ts
log("worker", "scene_providers.configured", {
  runway: !!workerEnv.RUNWAYML_API_SECRET,
  luma:   !!workerEnv.LUMA_API_KEY,
  pexels: !!workerEnv.PEXELS_API_KEY,
});
```

If all three are false, log FATAL and refuse to boot (or boot in "merge-only mode" with explicit warning).

### F3 — Pass brand/topic context to per-scene Pexels (P1, ~25 min)

Extend `SceneRequest` in `video-providers/types.ts` with optional `brandIndustry` / `topicTitle` / `shotType` fields. Have the route pass these through `sceneSpecs[].brand` and the worker forward them in the `registryGenerateScene` call. `PexelsFallbackProvider.generateScene` already accepts the fields via my v2 P1b code on `findStockVideoByPrompt` — just needs to be wired through.

### F4 — Accept partial scene success (P1, ~15 min)

Change `video-merge.ts:338` from `> 1` to `>= 1`. When some scenes succeeded and some failed, **pad the failed slots with the prefetched Pexels `videoUrl`** rather than throwing the whole multi-scene path away. Concat then produces N segments where some are AI-generated and some are stock.

### F5 — Measure narration duration before storyboard (P2, ~45 min)

Reorder pipeline:
1. Generate script
2. Synthesize narration
3. **`ffprobe` the audio → real `narrationDurationSec`**
4. Generate storyboard with `targetDuration: narrationDurationSec` (override the Gemini word-count guess)
5. Build sceneSpecs scaled to actually fit `narrationDurationSec`

Eliminates the ±3s drift. Requires ffprobe in worker (already present) OR new helper in `/api/generate`.

### F6 — Add crossfade transitions (P2, ~30 min)

Replace concat demuxer with ffmpeg `xfade` filter. Per pair of adjacent scenes:

```
[0:v][1:v]xfade=transition=fade:duration=0.4:offset=${scene1.dur - 0.4}
```

Trades stream-copy speed (~1s) for a ~5-10s re-encode but produces an obviously-edited result.

---

## FFmpeg-only vs proper timeline renderer — decision matrix

For your targets (30-90s UGC / real estate / product / AI social), here's what the code says about each option:

### Option 1 — Stay on FFmpeg-only, fix F1-F4

**What you keep:**
- Worker pipeline already does scene normalization (720x1280 @ 30fps) [`video-merge.ts:402-425`]
- Concat demuxer is fast and zero new deps
- drawtext overlay chain with scale-pop + fade animations [`video-merge.ts:149-193`]
- Audio mixing with ducking [`video-merge.ts:484-561`]
- Production-tested on Railway with memory tuning [`video-merge.ts:417-422`]

**What you need to add (1-2 days work):**
- F1 + F2 + F3 + F4 from above
- Optional F6 for transitions
- A `Timeline` data structure in `src/lib/timeline.ts` that captures `{tracks:[{type, clips:[{src, in, out, transitions[]}]}]}` so the worker has a real object to compose against instead of ad-hoc arrays

**Verdict — RECOMMENDED for your targets.** UGC / real estate / product videos don't need keyframe animation, motion graphics, particle effects, or complex compositing. They need: per-scene cuts with optional dissolves, on-screen text overlays, audio mixing. FFmpeg does all of this and the existing code is 80% there.

### Option 2 — Remotion

**What you'd gain:**
- React component model: every scene is a `<Composition>` with declarative props
- Sequence component handles timing
- Built-in transitions (`<TransitionSeries>`)
- Easier to add Lottie, SVG, motion graphics, charts
- The root `tiktok-product-video-factory/` project already uses Remotion — your team has tribal knowledge

**What it costs:**
- Re-architect the worker: Remotion needs Chromium (~150MB) on Railway, increasing image size and memory
- `npx remotion render` is `execSync`-friendly but slower than direct ffmpeg — typical 30s video renders in ~60-90s on Railway-class hardware
- Browser environment for video composition is overkill for stock-clip cutting
- Two video stacks in one monorepo doubles maintenance

**Verdict — overkill for the stated targets.** Pick Remotion if/when you want React-driven motion graphics, animated charts, or per-frame interactivity. Today's UGC/real-estate/product spec doesn't justify the operational cost.

### Option 3 — react-video / react-video-editor / similar npm libs

Most of these are wrappers around HTML5 `<video>` with timeline UI — they're for in-browser preview/editing, not server-side rendering. **Not applicable** to your "worker generates final MP4" architecture.

### Option 4 — Custom timeline engine

A `src/lib/timeline.ts` data model (Track → Clip → Transition → Audio) + a thin compiler from `Timeline → ffmpeg filter_complex` is **the right next step** regardless of Option 1 vs 2. It's a small file (~200 LoC), turns implicit timing into reviewable code, and unlocks F4 (partial success), F6 (transitions), and future per-scene styles without bloating `video-merge.ts`.

### Recommendation

**Stay on FFmpeg + build a small Timeline IR.** Pseudocode:

```ts
// src/lib/timeline.ts
export interface TimelineClip {
  src: string;             // file path or URL
  inSec: number;           // trim from source
  outSec: number;
  transitionInMs?: number; // crossfade with previous
}
export interface TimelineOverlay { text: string; startSec: number; endSec: number; sceneIndex: number; }
export interface TimelineAudio { src: string; volume: number; duckBelow?: string; }
export interface Timeline {
  fps: number;
  width: number; height: number;
  totalDurationSec: number;
  video: TimelineClip[];
  overlays: TimelineOverlay[];
  audio: TimelineAudio[];
}

// src/lib/timeline-ffmpeg.ts
export function compileTimeline(t: Timeline): string[] { /* ffmpeg args */ }
```

Then `video-merge.ts` builds a Timeline (taking scenes + overlays + narration + music + prefetched fallback) and calls `compileTimeline`. The "single-clip fallback" becomes one explicit branch of the Timeline builder: when `scenes` is empty, build a Timeline with `video: [{src: videoUrl, inSec: 0, outSec: narrationDurationSec}]`. Same renderer, no special-cases inside the ffmpeg invocation.

This puts every behavior change in the audit (F1-F6) into a typed, testable layer above ffmpeg and keeps the deploy footprint identical.

---

## Code reference index

| File | Lines | Subject |
|---|---|---|
| `src/app/api/generate/route.ts` | 209, 211 | `sceneCount` default, `targetSeconds` calc |
| `src/app/api/generate/route.ts` | 395-420 | `generateVideoStoryboard` call |
| `src/app/api/generate/route.ts` | 700-705 | `sceneSpecs` build |
| `src/app/api/generate/route.ts` | 707-735 | Pexels prefetch single-clip fallback |
| `src/app/api/generate/route.ts` | 808-816 | Conditional `sceneSpecs` enqueue (`> 1`) |
| `src/lib/gemini.ts` | 692-726 | `generateVideoScript` |
| `src/lib/gemini.ts` | 728-742 | `StoryboardScene` / `Storyboard` types |
| `src/lib/gemini.ts` | 769-820 | `generateVideoStoryboard` |
| `src/lib/gemini.ts` | 1180-1290 | `extractSceneOverlays` (v2 P2) |
| `src/lib/elevenlabs.ts` | 28-33, 41-88 | `synthesizeNarration` (no duration field) |
| `src/lib/queue.ts` | 124-201 | `VideoMergeOverlay` / `VideoMergeScene` / `VideoMergeJobData` |
| `src/lib/worker-env.ts` | 35-70 | Worker env Zod schema (missing scene-provider keys) |
| `src/lib/video-providers/registry.ts` | 37-43, 52-87 | Chain order, scene-gen iteration |
| `src/lib/video-providers/runway.ts` | 75-80 | Runway `isConfigured()` |
| `src/lib/video-providers/luma.ts` | 57-59 | Luma `isConfigured()` |
| `src/lib/video-providers/pexels.ts` | 14-52 | `PexelsFallbackProvider` (no brand context) |
| `worker/processors/video-merge.ts` | 149-193 | `buildDrawtextChain` + position rotation (v2 P3) |
| `worker/processors/video-merge.ts` | 216-336 | `processVideoMerge` + scene-gen loop |
| `worker/processors/video-merge.ts` | 225 | `needsSceneGeneration` predicate |
| `worker/processors/video-merge.ts` | 266-271, 306-324 | Success / failure paths (asymmetric) |
| `worker/processors/video-merge.ts` | 335, 338 | `scenes = completed`, `hasScenes > 1` |
| `worker/processors/video-merge.ts` | 365-374 | Multi-scene downloads vs single-clip download |
| `worker/processors/video-merge.ts` | 394-457 | Per-scene normalize + concat demuxer |
| `worker/processors/video-merge.ts` | 444-451 | Concat with `-c copy` (no transitions) |
| `worker/processors/video-merge.ts` | 484-561, 537-595 | Audio mix paths (A/B) with `-shortest` |
| `worker/index.ts` | 234-265 | `videoMerge` worker registration |

---

## What this audit did NOT do

- Did not query Supabase to count actual `scene_generations` rows by `provider` value — that would prove vs disprove Mode A vs Mode B per real renderJobId.
- Did not query Railway env to confirm which scene-provider keys are present in production.
- Did not exercise the pipeline end-to-end with each provider enabled in isolation.

All three would be useful next-step validations of the code-grounded conclusions above.
