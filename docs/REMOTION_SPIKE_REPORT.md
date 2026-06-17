# REMOTION_SPIKE_REPORT.md

**Date:** 2026-06-13
**Author:** automated spike assessment (Claude)
**Question (ADR-001 goal):** Does Remotion materially improve visual storytelling vs. the current FFmpeg composition path — enough to justify moving to a Hybrid Remotion + FFmpeg architecture?
**Answer:** **No — not now.** The Remotion spike was effectively *already executed in production* and OOM-failed on the same RAM ceiling that blocks FFmpeg today; meanwhile the FFmpeg path (ADR-002) has since absorbed the motion/transition features ADR-001 wanted Remotion for. **Recommendation: Option A — push/keep the FFmpeg architecture**, after a small in-path dedup fix and the Railway RAM bump that both engines require anyway. Re-open the Hybrid question only if the smarter-FFmpeg ceiling proves insufficient against real audience feedback.

---

## 1. Honest scope of this spike

A *fresh* local Remotion render was **not** performed, for three reasons — none of which weaken the conclusion:

1. **The spike already ran, in production, with a real verdict.** Per `ADR-002` (its opening paragraph): *"ADR-001 chose Remotion + Chrome Headless for visual composition. After six commits hardening the path (Chromium auto-discovery, chromeMode=chrome-for-testing, GL swangle, parallel-encoding off, jpeg frames, transitions disabled) the Railway worker still OOMs at ~800 MB on every render. The 1 GB worker replica is the binding constraint — not a code defect we can squeeze further."* The Remotion path was built, hardened across six commits, and failed on RAM in the real target environment. ADR-002 (the FFmpeg pivot) exists *because* of that failed spike.
2. **A local re-render would not produce decision-grade data.** The operational gate is the **Railway container's** peak RSS, not this Windows box's. Peak RSS for Chrome headless on a dev machine does not transfer to the nixpacks container. The number that matters is already known: **~800 MB on Railway, OOM on the 1 GB cap.**
3. **No inputs to feed a faithful spike.** ADR-001 Phase-1 specifies rendering *a real `render_jobs` row* and checking the 4 scenes are visually distinct. There is no Supabase access here to pull a `render_jobs` row, no AI keys to generate one, no composition props (`public/content` is empty), and no cached Chrome shell. A demo render with synthetic props would not be the apples-to-apples comparison ADR-001 asks for.

What *was* measured empirically: the **FFmpeg baseline** (see `VIDEO_PIPELINE_VALIDATION.md`) — a real 30 s render audited frame-by-frame. That is the honest other half of the comparison.

Confirmed available: the root project's Remotion CLI (`remotion@4.0.455`) is installed and the 11-template stack referenced in ADR-001 exists. The blocker to *re-running* the spike is environmental (Chrome shell + props + a Railway box), not missing tooling.

---

## 2. What changed since ADR-001 was written (2026-06-05)

ADR-001 recommended Hybrid Remotion (Option C) on the premise that **FFmpeg's ceiling is "stitched stock footage with hard cuts and lower-third text."** That premise is now partly outdated:

| ADR-001 assumption about FFmpeg | Reality on current HEAD (ADR-002 pipeline) |
|---|---|
| "Hard cuts only; transitions are second-class" | ADR-002 FFmpeg filter graph applies **per-scene `xfade` transitions** and **`zoompan`** (Ken Burns motion) chosen per scene & emotion. Motion + transitions are *in the path*. |
| "Best case = 4 different Pexels clips back-to-back" | Measured best case today is **worse** (2 unique clips / 4 scenes — see validation report) **but** the cause is a missing 1-line-of-logic intra-video dedup, not an engine limit. Fixable in-path. |
| "Composition is an imperative shell script" | ADR-002 reframed it as a **12-agent pipeline** (strategist → scene-planner → multi-source search → analysis → diversity → consistency → caption → timing → editor → composer → QC) that *selects, paces, edits, and validates* before FFmpeg runs. |
| "No QC / no review" | Agent 12 (quality-control) parses ffprobe + frame-samples and regenerates scenes scoring < 8.5. |

So the gap ADR-001 was trying to close has narrowed from the FFmpeg side. The remaining genuine Remotion advantages are: arbitrary motion-graphics/animated charts, `<Player/>` browser preview, and React-component reviewability — real, but no longer "order-of-magnitude," and not free.

---

## 3. The decision actually hinges on one shared constraint: RAM

Both engines are blocked on the **same 1 GB Railway worker cap** today:

| | FFmpeg (ADR-002) | Remotion / Hybrid (ADR-001) |
|---|---|---|
| Renders locally today? | **Yes** — produced a real 30 s 1080×1920 MP4 (validation report) | Not attempted locally; needs Chrome shell + bundle |
| On 1 GB Railway | OOMs (minimal decode pass) | **OOMs at ~800 MB — already proven** |
| RAM headroom on a 2 GB box | Comfortable (ffmpeg single-decode) | Marginal — Chrome was at ~800 MB *with transitions disabled & parallel-encode off*; real compositions cost more |
| Concurrency / replica | 5–6 | 2–3 (Chrome RAM) |
| Render time (30 s video) | ~15–60 s | ~45–90 s + ~10–15 s cold-start bundle/Chrome |
| Extra infra to ship | Railway 2 GB bump | Railway 2 GB bump **+ Chromium Dockerfile/nixpacks + executable-path env + 8-min timeouts + concurrency drop** |
| Production proof on Railway | Renders locally; RAM-gated only | **Negative proof** — the prior spike OOMed |

**Neither ships without the Railway Hobby/2 GB upgrade.** That upgrade is already the #1 open item for unrelated reasons (worker credit + the existing render block). Once it lands:
- FFmpeg renders **immediately** (it works locally today; it only needs the RAM).
- Remotion still needs a Chromium Dockerfile, an env wiring pass, a concurrency drop to 2–3, longer stuck-job timeouts — *and* it re-enters the exact RAM regime it already OOMed in, now with only ~2× headroom that real (transition-enabled) compositions will eat into.

---

## 4. Does Remotion "materially improve visual storytelling"?

**Ceiling (yes, but narrowed):** Remotion still wins on animated motion-graphics, data-driven charts (valuable for "stats-story" style content), per-scene brand treatment via React, and real-time `<Player/>` preview. For OttoFlow's near-term content (UGC/product/AI-social 30–90 s), the highest-leverage visual defect today is **footage repetition**, not lack of motion graphics — and that defect is a **free fix in FFmpeg** (§5).

**Floor / risk (Remotion loses):** it is the heavier, slower, RAM-marginal path with *negative* Railway production proof, and adopting it now would partially reverse the team's own 8-days-old ADR-002 decision — without new evidence that the smarter-FFmpeg ceiling is actually insufficient.

**Net:** Remotion improves the *ceiling*, but does **not** materially improve the storytelling problem that is actually hurting output today (repeated clips), which FFmpeg can fix cheaply. The marginal visual upside does not currently justify the operational cost, the RAM risk, and the architectural reversal.

---

## 5. The cheaper win, independent of A/B

The validation audit found the real defect: **no intra-video dedup** (`06-diversity.ts` penalizes only *cross-job* reuse via `asset_history`; nothing stops one clip from winning 3 scenes of the *same* video). A greedy "distinct `source:source_id` per scene" assignment after scoring turns the current "2 unique / 4 scenes" into "4 unique / 4 scenes" with **zero new dependencies, zero infra change, ~30 lines**. This is the single highest-ROI visual improvement available and should ship regardless of A vs B.

---

## 6. Recommendation

**Option A — push / keep the FFmpeg architecture.** Specifically:

1. **Ship the intra-video dedup fix** (§5) — the actual storytelling defect, fixable in-path now.
2. **Apply the Railway Hobby / 2 GB upgrade** — unblocks the existing FFmpeg render (it works locally today) *and* every other worker function. This is needed no matter what.
3. **Re-run a real generation on the 2 GB box** and re-audit (the validation report's 6 questions) to confirm 4 unique scenes + zoompan/xfade reach the viewer.
4. **Defer Hybrid Remotion (Option B)** to a *future* decision, re-opened only if — after the above — real audience/engagement data shows the motion-graphics ceiling is the binding constraint on performance. At that point the spike must be re-run **on a ≥2 GB Railway box with a Chromium image**, since that, not a local render, is the gate that has already failed once.

**Do not** adopt Hybrid Remotion now: it re-enters a proven-OOM RAM regime, adds the most infra surface, is the slowest path, and reverses ADR-002 without new evidence — while the visible problem (repeated footage) has a free FFmpeg fix.

---

## 7. One-line answer to the brief

> **A) Push current FFmpeg architecture** (after the dedup fix + the Railway 2 GB bump). The Remotion spike already happened in production and OOM-failed on the 1 GB cap; the FFmpeg path has since absorbed the motion/transition features that motivated ADR-001, and the real output defect today is footage repetition — which FFmpeg fixes for ~30 lines and no new infra.
