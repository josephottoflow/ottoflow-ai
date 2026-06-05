# ADR-001: Video Composition Engine — FFmpeg-only vs Remotion vs Hybrid

**Status:** Proposed
**Date:** 2026-06-05
**Deciders:** Joseph (joseph@ottoflow.ai)
**Supersedes:** Recommendation in `docs/VIDEO_TIMELINE_AUDIT.md` ("stay on FFmpeg + build Timeline IR") — see *Reversal* section below.

---

## Context

`ottoflow-ai/` generates short-form video (UGC, real estate, product, AI social — 30 to 90 seconds) via an SSE pipeline that:

1. Generates a script (Gemini)
2. Generates a multi-scene storyboard (Gemini, default 4 scenes)
3. Synthesizes narration (ElevenLabs)
4. Finds a music track (Jamendo)
5. Pre-fetches a fallback stock clip (Pexels)
6. Enqueues a Railway worker to generate per-scene AI clips (Runway → Luma → Pexels chain) and merge with FFmpeg

After 4 v2 fixes (P0–P3) and 3 timeline-audit fixes (F1, F2, F3, F4) shipped today, the user reports: **"I have no output video"** — the merged MP4 displays a single stock clip for the duration of the narration. The multi-scene composition the storyboard plans for never reaches the viewer.

The root cause (per `VIDEO_TIMELINE_AUDIT.md`) is architectural, not a single bug:

- The pipeline is an **imperative FFmpeg shell-script with conditional branches**, not a timeline.
- There is no first-class data structure representing the composition. Scenes, overlays, audio tracks, and transitions exist only as in-flight arrays passed to one ffmpeg invocation.
- Per-scene visuals depend on AI providers (Runway, Luma) which are expensive, slow, and often unconfigured in production — collapsing the pipeline to a single Pexels clip.
- No transition support. No preview. No way for the team to author or review a composition without running the full pipeline.

Meanwhile, the **root project** (`tiktok-product-video-factory/`) — the same monorepo — already has a fully production-tested Remotion stack:

- `@remotion/cli@4.0.455`, `@remotion/renderer`, `@remotion/player`, `@remotion/media`, `@remotion/motion-blur`, `@remotion/google-fonts`
- 11+ composition templates: `ProductVideo`, `cinematic`, `unboxing`, `before-after`, `product-demo`, `listicle`, `myth-buster`, `quote-card`, `stats-story`, `tutorial`, `v2-ugc`
- `render-agent.ts` wraps `renderMedia` programmatically — bundle URL cached, JPEG-frame compression tuned (`scale=2/3`), progress callbacks
- `Root.tsx` dynamically discovers per-product compositions from `public/content/*/video-data.json`

**The team already knows Remotion.** `ottoflow-ai` has zero Remotion dependencies; it was a clean-slate Next.js SaaS rewrite that chose FFmpeg for speed-of-implementation. That choice is now a liability.

### Forces at play

| Force | Direction |
|---|---|
| User-visible output quality | ↑ Toward a real timeline engine |
| Engineering velocity (next 90 days) | ↑ Toward Remotion (team knows it) |
| Operational cost (Railway compute, deploy size) | ↑ Toward FFmpeg-only |
| Render latency (job throughput) | ↑ Toward FFmpeg-only |
| Code maintainability / reviewability | ↑ Toward Remotion |
| Visual feature ceiling (transitions, motion text, charts) | ↑ Toward Remotion |
| Time-to-fix-current-bug | Tie (both ~2-4 days of focused work) |

---

## Decision

**Adopt Option C — Hybrid Remotion composition + FFmpeg audio mux + Storage upload.**

Render the visual stream with Remotion (per-scene `<OffthreadVideo>` + `<TransitionSeries>` + `<Sequence>` overlays). Use FFmpeg only for what it's best at: audio ducking, narration mux, final MP4 packaging, and Supabase Storage upload. Reuse the existing `worker/processors/video-merge.ts` infrastructure (font resolution, Storage upload, progress reporting) — replace only the video-composition portion.

---

## Options Considered

### Option A — FFmpeg-only + Timeline IR (my earlier recommendation)

Stay on FFmpeg. Add a typed `src/lib/timeline.ts` data structure that captures `{tracks: [{type, clips: [{src, in, out, transitions}]}]}` and a thin `compileTimeline(t) → ffmpeg args` compiler. Layer F1–F6 fixes on top.

| Dimension | Assessment |
|---|---|
| Complexity | Med — IR is ~200 LoC, FFmpeg filter_complex composition is fiddly |
| Cost (compute) | **Low** — 15-20s renders, no Chromium |
| Cost (eng time) | Med — 2-3 days IR + 1 day F5/F6 |
| Scalability | High — FFmpeg is dependency-light, fits Railway free tier |
| Team familiarity | Med — team has FFmpeg fluency but no shared mental model |
| Visual ceiling | **Low** — transitions via xfade are basic; per-frame animation is painful |
| Preview/testing | **Poor** — must run worker to see anything |
| Maintainability | Low — filter_complex strings are notoriously hard to review in PRs |
| Time to first working multi-scene video | 2-3 days |

**Pros:** Tiny deploy footprint. Fast renders. No new tech.
**Cons:** Reinvents what Remotion already gives the team. No preview. Transitions are second-class. Composition logic stays as imperative ffmpeg shell — adding scene-level interactivity (animated text, motion graphics for stats videos, animated product overlays) requires either a giant filter_complex string or yet another tool.

### Option B — Full Remotion (composition + render + audio + upload)

Replace `video-merge.ts` with a `<Composition>` that includes `<OffthreadVideo>`, `<Audio>` for narration and music, `<TransitionSeries>` for scene cuts, animated text overlays via `interpolate()`. `renderMedia()` produces the final MP4 with audio baked in. Worker uploads to Supabase Storage.

| Dimension | Assessment |
|---|---|
| Complexity | Med — Remotion has a learning curve but the team has 11 templates as reference |
| Cost (compute) | **High** — 60-90s renders for 30s video; Chromium needs ~1GB RAM |
| Cost (eng time) | 3-5 days to port + test |
| Scalability | Med — concurrent renders cap at ~2-3 on a single Railway replica due to Chrome RAM |
| Team familiarity | **High** — root project is production-tested Remotion |
| Visual ceiling | **High** — React component model; arbitrary animation, motion graphics, Lottie, charts |
| Preview/testing | **Excellent** — `<Player />` in the browser, no render needed; `npm run studio` for full preview |
| Maintainability | **High** — typed React components, reviewable in PRs, testable |
| Time to first working multi-scene video | 3-5 days |

**Pros:** One unified video stack across the monorepo. Best-in-class preview. Future-proof for animated product cards, real-estate price overlays, listicle-style cuts. Team knows it.
**Cons:** Slowest renders. Highest Railway cost. Chrome on Railway needs explicit Dockerfile setup (the root project uses Vercel, not Railway, for its Remotion renders — no production proof on Railway).

### Option C — Hybrid: Remotion composition + FFmpeg audio mux + Supabase upload

Use Remotion only for the **silent visual stream** (per-scene clips, transitions, text overlays via Remotion `<Sequence>`). Render to a temporary MP4 (no audio). Then `worker/processors/video-merge.ts` keeps its current ffmpeg invocation for:
- Audio mux (narration full + music ducked -12dB via `amix`)
- Final packaging to Storage-friendly H.264
- Supabase Storage upload (already proven)

| Dimension | Assessment |
|---|---|
| Complexity | Med — two engines but clear separation of concerns |
| Cost (compute) | Med — Remotion render ~45s for 30s video (silent, no audio encoding) + ffmpeg mux ~3s |
| Cost (eng time) | 2-3 days |
| Scalability | Med — same concurrent-render ceiling as Option B for the Remotion step |
| Team familiarity | **High** — both engines well-known on this team |
| Visual ceiling | **High** — full Remotion power for visuals |
| Preview/testing | **Excellent** — Remotion `<Player />` shows the visual track; audio preview via existing page `<audio>` elements |
| Maintainability | **High** — composition is a typed React component; audio mux is a 20-line ffmpeg arg array |
| Time to first working multi-scene video | 2-3 days |

**Pros:** Best of both worlds. Visuals get Remotion's expressive power; audio mixing stays in FFmpeg where it's a 5-line filter. Preview is real. Migration is bounded — touch only the video-composition portion, not the asset-fetching/storage layer.
**Cons:** Two engines to keep alive. The interface between them (path to silent MP4) is the only seam.

---

## Trade-off Analysis

The dominant factor in this decision is **what the user actually sees**.

- Option A produces correct multi-segment FFmpeg concat when scene-gen succeeds (we now know this works after F4). But for the next 30-60 days while you scale, scene-gen will frequently fall back to Pexels-only because Runway/Luma are expensive and the team doesn't want to enable them by default. **Option A in practice gives the user: 4 different Pexels clips back-to-back with hard cuts and one narration track.** That's noticeably better than today's "1 clip looped" — but it's still amateur-feeling.
- Option B produces **Remotion-rendered visuals with transitions, animated text overlays, brand colors applied per scene, optional motion graphics**. That's the look the parent project ships today. It's the difference between "I made this with stock footage" and "this looks like a real ad." The cost is Railway compute and longer renders.
- Option C produces the same user-visible quality as Option B at substantially lower render time and somewhat lower Railway cost, with the asset-fetching/storage/audio-mux infrastructure unchanged.

**The compute cost argument is weaker than I previously stated.** A 30s video that takes 60s to render at $0.000463/sec on Railway costs $0.028. The Gemini + ElevenLabs + Runway costs per video are already $0.40-$1.50. Render compute is a rounding error.

**The preview argument matters more than I previously stated.** Today the team cannot see what a generated video looks like without running the full SSE pipeline + worker merge (~3-5 minutes). With Remotion `<Player />`, the team can iterate on a composition in the browser in real-time. That accelerates every visual change tenfold.

**The team-familiarity argument is decisive.** The same engineers maintaining `ottoflow-ai/` already wrote and shipped `tiktok-product-video-factory/`'s 11 Remotion templates. Adding Remotion to `ottoflow-ai/` is consolidation, not new-tech adoption.

### Why hybrid (C) over full Remotion (B)

`worker/processors/video-merge.ts` is 636 lines of which ~400 are NOT video composition: scene-gen orchestration, asset downloads, audio-mux ffmpeg invocations, Supabase Storage upload, progress reporting, error handling, font resolution. Rewriting all of that in Remotion would mean redoing work that already works.

Option C keeps:
- Asset download (parallel `fetch` to local tmp files)
- Audio mux (`amix` with ducking, well-tested)
- `-shortest` flag for video/audio length matching
- Supabase Storage upload via service-role admin client
- Progress milestones (5/10/28/35/50/80/100)
- Sentry error capture
- BullMQ retry semantics

And replaces:
- Per-scene normalize (`scale=720:1280, -t targetDur, libx264`) → Remotion `<OffthreadVideo />` does this implicitly
- Concat demuxer (`-c copy`) → Remotion `<Series>` or `<TransitionSeries>`
- Drawtext overlay chain (the 130-line `buildDrawtextChain`) → Remotion `<Sequence>` + typed `<OverlayText />` component with `interpolate()` animation

Smaller blast radius. Easier to bisect when something breaks.

---

## Reversal

`docs/VIDEO_TIMELINE_AUDIT.md` recommended Option A ("FFmpeg + Timeline IR"). I'm reversing that here for three reasons that became visible after writing the audit:

1. **The team already runs Remotion in production** in the parent project. I treated `ottoflow-ai/` as a green-field rewrite, but it isn't — it's the same monorepo, same team. Choosing FFmpeg was choosing to fork the team's video stack.
2. **The user-visible output today is unacceptable.** A 30s narration over a single static stock clip is not the product. F1–F4 reduce the failure modes but don't elevate the ceiling. Even the success case (multi-Pexels concat with hard cuts) is amateur-looking. Remotion compositions raise the ceiling by an order of magnitude with the same per-scene asset budget.
3. **The cost argument I made (Chrome + render time) is dwarfed by the per-video AI costs.** $0.03 of render compute on top of $0.50-$1.50 of Gemini + ElevenLabs + scene-gen is in the noise.

The Timeline IR concept is still good — it just lives **inside the Remotion composition** as the typed props passed to the `<RootComposition />`. Nothing wasted.

---

## Why the user has no output video today (immediate diagnosis)

Before recommending the architectural fix, here is what the code does NOW that produces the user's symptom:

1. **Worker has all keys but provider chain doesn't deliver multi-scene** — Even after F1-F4, if `RUNWAYML_API_SECRET` and `LUMA_API_KEY` are unset on Railway (the most common case) and `PEXELS_API_KEY` IS set, every scene gets the Pexels fallback. With F4, those become 4 different Pexels clips concat'd hard — that **should** produce a visible multi-segment video.
2. **OR the worker has none of the keys** — F1-F4 now writes `merge_error` and Sentry-alerts on this, but the user still sees the single-clip fallback. The video DOES exist in Supabase Storage (we verified `f992f108…mp4` from Railway logs), but it's one Pexels clip stretched over 30s of narration.
3. **OR the UI Realtime subscription is missing the `merged_video_url` update** — page sees "Merging audio into MP4..." indefinitely even though Storage has the file. This is a separate UI bug, not a renderer bug.

The user's statement "I have no output video" is consistent with any of these three. **Switching to Remotion solves #1 and #2 by producing visually distinct content per scene without relying on the AI provider chain.** It does not fix #3 (UI bug) — that's a separate ticket.

---

## Consequences

### What becomes easier
- Visual feature work: text animation, motion graphics, animated charts, per-scene brand colors, transitions
- Preview: `<Player />` in the browser, no full pipeline run needed
- Testing: composition is a React component, can render in jsdom or snapshot
- Code review: PRs show declarative React, not 200-char ffmpeg filter_complex strings
- Shared idioms with the root project

### What becomes harder
- Railway Dockerfile: needs Chromium / `@sparticuz/chromium` for headless
- Render latency: 30-90s vs FFmpeg's 15s — matters for free-tier UX expectations
- Concurrent renders per worker replica: 2-3 vs FFmpeg's 5-6, due to Chrome RAM
- Cold-start: first render after worker boot pays the Remotion bundle + Chrome launch cost (~10-15s extra)

### What we'll need to revisit
- Worker scaling on Railway (probably bump to 2 replicas earlier than planned)
- Render-job concurrency cap (`WORKER_CONCURRENCY`) — drop to 2 from 4 to account for Chrome RAM
- The 5-min stuck-job recovery sweep timeout may need to grow to 8 min to accommodate slower Remotion renders
- `RUNWAYML_API_SECRET` / `LUMA_API_KEY` decision: now optional rather than urgent — Remotion + Pexels alone produces good output

---

## Action Items

### Phase 1 — Spike (4-6 hours, before committing)

1. [ ] In `ottoflow-ai/`, add Remotion deps: `npm i remotion @remotion/cli @remotion/renderer @remotion/player @remotion/media @remotion/transitions @remotion/google-fonts` (match versions to root project's `4.0.455` to share bundle cache later)
2. [ ] Create `ottoflow-ai/remotion/Root.tsx` and `ottoflow-ai/remotion/compositions/MultiSceneVideo.tsx` — a single typed composition that accepts `{scenes: TimelineScene[], narrationUrl, musicUrl, overlays, brandColors}` and renders the visual stream silently
3. [ ] Write `ottoflow-ai/scripts/remotion-spike.ts` — feed it the data from a known `render_jobs` row, render locally to MP4, verify the output has all 4 scenes visually distinct
4. [ ] Confirm Remotion bundle builds successfully alongside `next build` (no Webpack conflicts)
5. [ ] Decision gate: spike output looks at least as good as current best Pexels output → proceed to Phase 2; otherwise revert

### Phase 2 — Worker integration (1-2 days)

6. [ ] Refactor `worker/processors/video-merge.ts`:
      - Keep: download, audio mux, Storage upload, progress reporting, F1 telemetry, F2 boot-log, F4 partial-success padding
      - Replace: per-scene normalize + concat demuxer + drawtext chain
      - New: call `renderMedia()` from `@remotion/renderer` to produce silent.mp4, then ffmpeg mux audio + silent.mp4 → merged.mp4
7. [ ] Migrate `<OverlayText />` from `buildDrawtextChain` semantics (scale-pop + fade + 5 y-position rotation) into a typed Remotion component using `interpolate()` and `<Sequence>`
8. [ ] Verify `aestheticNotes` styling propagates via composition props (vs. current prompt-prefix approach)
9. [ ] Smoke test on Railway: 1 generation, verify the rendered MP4 has multi-segment visuals
10. [ ] Wire `WORKER_CONCURRENCY` default down to 2

### Phase 3 — Operational hardening (1 day)

11. [ ] Dockerfile: install Chromium via `@sparticuz/chromium` or Railway's nixpacks chromium provider
12. [ ] Add `@remotion/renderer` browser executable path env var to `worker-env.ts`
13. [ ] Memory monitoring: cap Remotion render with `--memory-limit` or worker-side timeout (8 min)
14. [ ] Update `docs/WORKER_ARCHITECTURE.md` with the new pipeline diagram
15. [ ] Update `docs/DEPLOYMENT.md` with the new Railway image requirements

### Phase 4 — Polish (1 day)

16. [ ] Add `<Player />` preview to `/video/generate` so the user sees the composition before triggering full render
17. [ ] Move the `OVERLAY_Y_POSITIONS` rotation into Remotion `<Sequence>` `staggerBy` semantics
18. [ ] Add `<TransitionSeries>` with `fade()` or `slide()` between scenes (0.4s default)
19. [ ] Wire brand colors from `brand.profile.color_palette` (if present) into composition props
20. [ ] Update `docs/VIDEO_PIPELINE_V2.md` with the architectural change + supersede the FFmpeg-only conclusion in `docs/VIDEO_TIMELINE_AUDIT.md`

### Phase 5 — Decommission (after 2 weeks of dual-running, if needed)

21. [ ] Remove `buildDrawtextChain`, per-scene normalize, concat demuxer code from `video-merge.ts`
22. [ ] Remove unused FFmpeg deps that were only for video composition (keep audio-mux deps)

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Chrome OOM on Railway free tier | Set `--single-process --no-zygote`; cap render at 60s timeout; fall back to current FFmpeg path if Remotion render fails |
| Render latency degrades user UX | Render IS background (BullMQ job); UI already shows "Merging..." — no regression. Live progress (P0 fix) tracks Remotion's own progress callback. |
| Remotion bundle bloats Next.js build | Keep Remotion in `ottoflow-ai/remotion/` directory, exclude from `next build` via `next.config.ts` |
| Two engines diverge over time | Hybrid is explicit — Remotion is composition ONLY; FFmpeg is audio/mux/upload ONLY. Documented seam at the silent.mp4 file path. |
| Cost overrun on Railway | Set a per-job timeout (8 min); cap concurrency (2); add cost alert in Sentry |

---

## Summary

The user is right to push back on "stay on FFmpeg." Today's pipeline produces one stock clip stretched over 30 seconds of narration — that is the product failing, not a bug. F1-F4 ship today reduce failure modes but cannot raise the visual ceiling because the engine itself caps out at "stitched-together stock footage with hard cuts and lower-third text."

Remotion raises the ceiling to "production-quality short-form video composition with declarative React, real-time preview, and motion-graphics support" — and the team already runs it in the parent project.

**Recommendation: adopt Option C (Hybrid Remotion + FFmpeg audio mux). Phase 1 spike before committing. Total to first multi-scene video matching the product promise: 2-3 days of engineering.**
