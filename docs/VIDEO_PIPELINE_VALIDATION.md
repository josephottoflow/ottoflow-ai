# VIDEO_PIPELINE_VALIDATION.md

**Date:** 2026-06-13
**Author:** automated audit (Claude)
**Subject:** Empirical audit of the current FFmpeg composition path (ADR-002 12-agent pipeline), post-F1/F2/F3/F4.
**Verdict:** The pipeline runs end-to-end and produces a correctly-muxed 30s vertical MP4, **but the visual track is effectively a repeated clip** — 4 storyboard scenes collapsed to **2 unique source clips** (3 of 4 segments are byte-identical footage). Root cause is architectural, not a transient bug, and is present on current HEAD.

---

## 1. Methodology & honest caveat

**A truly fresh render could not be produced in this environment.** Both available execution paths are blocked:

| Path | Blocker |
|---|---|
| Local harness (`scripts/ffmpeg-e2e.local.ts`) | No `GOOGLE_API_KEY` / `PEXELS_API_KEY` / `ELEVENLABS_API_KEY` present. Root `../.env` does not exist; `ottoflow-ai/.env.local` contains only R2 keys. No local Redis. |
| Production worker | Render is RAM-blocked per `ADR-002` (Railway worker hard-capped ~1 GB; ffmpeg compose OOMs). Railway trial credit ~$0.25 — worker may already be down. |

**Instead, this audit examines the most recent *real* render artifact on disk:** `.e2e-work/e2e-1781122606315/` (2026-06-11 04:17). This run was produced by `scripts/ffmpeg-e2e.local.ts`, which the harness header documents as *"the exact agent chain the route + worker use"* — i.e. the ADR-002 12-agent pipeline (`runScriptPhase → runCompositionPhase → runFfmpegComposer`), against live Gemini/Pexels/ElevenLabs.

**Representativeness of HEAD:** the two agents responsible for clip selection — `04-multi-source-search.ts` and `06-diversity.ts` — last changed at `dc71072` (2026-06-06) and are **unchanged on current HEAD**. The Jun-12 "Phase 1A/1B variation" fixes (entropy, hook archetypes, *Pexels shuffle*) landed in the **separate video-merge path** (`worker/processors/video-merge.ts` + the registry), **not** in this ADR-002 agent pipeline. Therefore the duplication measured below reflects current HEAD behavior of the FFmpeg composition path.

All numbers below are from `ffprobe` / `md5sum` on the real artifacts.

---

## 2. Audit answers

Topic of the render: *"How AI agents save small businesses 10 hours a week"* (harness default).

### How many storyboard scenes were generated?
**4 scenes.** (`scene-1.mp4`…`scene-4.mp4` exist; the pipeline default is 4 — confirmed by ADR-001 §Context and the 4 normalized concat inputs.)

### How many scene assets were created?
**4 scene clips were downloaded, but only 2 are unique.** MD5 of the raw provider downloads:

| Clip | MD5 | Size | Unique? |
|---|---|---|---|
| scene-1.mp4 | `e64031ac8e4d1fe1a4870f1e8bb1170a` | 6,226,659 B | — |
| scene-2.mp4 | `e64031ac8e4d1fe1a4870f1e8bb1170a` | 6,226,659 B | **dup of scene-1** |
| scene-3.mp4 | `502d9d670af6b3e8e43e2b06b1563ef9` | 1,863,698 B | unique |
| scene-4.mp4 | `e64031ac8e4d1fe1a4870f1e8bb1170a` | 6,226,659 B | **dup of scene-1** |

→ **2 distinct visuals across 4 scenes.** Scenes 1, 2, and 4 are the *same Pexels clip*.

### How many clips reached the final concat step?
**4** (`concat-list.txt` lists `norm-0…norm-3`). All four normalized clips were concatenated — but three of them carry the same underlying footage (differing only in trim length and on-screen caption overlay).

### What is the duration of each clip?

| Raw scene (downloaded) | Duration | Resolution |
|---|---|---|
| scene-1 / scene-2 / scene-4 (identical) | 14.00 s | 1080×1920 |
| scene-3 | 8.08 s | 720×1280 |

| Normalized clip (concat input) | Duration | Resolution | Frames |
|---|---|---|---|
| norm-0 (←scene-1) | 5.47 s | 1080×1920 | 164 |
| norm-1 (←scene-2) | 7.27 s | 1080×1920 | 218 |
| norm-2 (←scene-3) | 6.73 s | 1080×1920 | 202 |
| norm-3 (←scene-4) | 9.53 s | 1080×1920 | 286 |

(Normalized clips are trimmed to each scene's storyboard target duration; sum ≈ 29.0 s.)

### What is the final MP4 duration?
**30.00 s** (`out.mp4`, 1080×1920, H.264 video + AAC audio, 37.3 MB). Length is driven by the narration track; the ~29 s video concat is matched to the 30 s narration.

### Is the output visually multi-scene or effectively a repeated clip?
**Effectively a repeated clip.** Of four segments, three (norm-0, norm-1, norm-3 ← scenes 1/2/4) are the *same footage*. A viewer sees the same stock clip return three times with different lower-third caption text, plus one genuinely different clip (scene-3). This is the "amateur-feeling / one clip looped" symptom ADR-001 was written to address — only partially mitigated by F1–F4: the pipeline did concatenate *distinct segments with caption variation*, but the underlying **footage** is not distinct.

---

## 3. Root cause

The duplication is **not** a download bug — it is missing **intra-video** deduplication:

- **`06-diversity.ts`** penalizes only clips used in **prior jobs** (it queries `asset_history` for the user's last *N* jobs and applies a recency-weighted soft penalty). It operates per-scene independently and has **no constraint preventing the same clip from being selected across multiple scenes of the *current* video**. (Verified by reading the agent: `fetchHistory` reads `asset_history`; `buildPenaltyMap` keys on prior `source:source_id`; there is no within-render uniqueness pass.)
- **`04-multi-source-search.ts`** searches stock sources per scene from Gemini-planned `searchIntent`/`keywords`. When the storyboard's scenes share similar intent (common for a single-topic 30 s ad), the candidate pools overlap, and the same highest-scoring Pexels clip wins multiple scenes.

Net: **the highest-relevance clip wins every scene whose search intent resembles its neighbors**, because nothing in the pipeline says "don't reuse a clip you already placed in this same video."

This is consistent with ADR-001 §"Why the user has no output video" item 1 ("every scene gets the Pexels fallback") — but sharper: even with Pexels configured and F4 active, **diversity is cross-video only**, so a single video can still collapse to near-duplicate footage.

---

## 4. What works vs. what doesn't

**Works (post-F1–F4):**
- Full agent chain runs to a real MP4 without manual intervention (script → storyboard → narration → music → per-scene search → normalize → concat → caption overlay → audio mux).
- Correct vertical format (1080×1920), correct duration matching to narration (30.0 s), AAC audio muxed, captions burned (`captions.ass` present), music + narration present.
- Per-scene trim to storyboard target durations works (norm-0…3 durations differ as planned).
- Distinct caption overlays per segment (the F-series drawtext work is functioning).

**Doesn't (visual ceiling):**
- **No intra-video footage uniqueness** → 3/4 segments are the same clip. *(This specific gap is fixable in the FFmpeg path — see §5.)*
- Hard cuts only; no transitions (xfade not wired in this path).
- Source clips are raw stock at mixed native resolution (scene-3 was 720×1280 upscaled to 1080×1920 → quality loss on that segment).
- No motion graphics / animated text / per-scene brand treatment — the ceiling ADR-001 flags.

---

## 5. Two fixes implied (independent of the Remotion decision)

1. **Cheap, in-path:** add an **intra-video dedup pass** — after Agent 5/6 scoring, enforce that each scene picks a *distinct* `source:source_id` (greedy assignment: best-available unused clip per scene). This alone would turn this render from "2 unique / 4 scenes" into "4 unique / 4 scenes" with no new dependency. Recommended regardless of A vs B.
2. **Architectural:** the visual ceiling (transitions, motion text, brand treatment, no upscale artifacts) is what `ADR-001` proposes Remotion for — evaluated in `REMOTION_SPIKE_REPORT.md`.

---

## 6. Status of the requested sequence

| Requested step | Status |
|---|---|
| 1. Apply migrations 017 & 018 | **Not done.** No Supabase DDL path available here (no `SUPABASE_ACCESS_TOKEN` / DB password / authenticated CLI; dashboard SQL-editor route is operator/browser-gated per the session handoff). Also orthogonal to video validation, and applying prod DDL conflicts with the "hold deployment" instruction. Recommend the operator apply these via the dashboard when ready to ship the Creative Orchestrator. |
| 2. Generate a fresh video | **Not possible here** (no AI keys locally; prod render RAM-blocked). Audited the most recent real render instead (§1 caveat). |
| 3. Audit the render | **Done** (§2–§4), on real artifacts. |

---

## 7. Bottom line

The FFmpeg path is **functional but visually weak**: it ships a correctly-muxed 30 s vertical video, yet the most recent real render shows **4 scenes → 2 unique clips → effectively a repeated background**. The proximate cause (no intra-video dedup) is cheaply fixable *within* FFmpeg; the deeper ceiling (transitions, motion, brand treatment, no upscaling artifacts) is the question `REMOTION_SPIKE_REPORT.md` exists to answer.
