# V4 Architecture (Deliverables 9–12)

Design constraint above all: the render pipeline is **FROZEN**. Nothing here adds/
changes a BullMQ worker, Redis, Railway, Seedance, ElevenLabs, FFmpeg stitching/
concat, scene generation, retries, or R2. Everything is a **pure, in-process,
deterministic library** consumed inside the *existing* single compose step, gated by
the *existing* per-render profile system, with graceful fallback to Legacy.

---

## §9 Presentation Engine V4 — Architecture

**One engine, many pure passes, zero new workers.** The engine is a deterministic
pipeline that transforms the (already-produced) caption + plan objects into a
**richer ASS script + a pre-composed outro clip spec**, then hands them to the
existing composer exactly where `renderAss()` / `renderCtaCard()` are called today.

```
CompositionPlan (frozen, from Agents 1–10)
      │
      ▼   [runs INSIDE the existing compose step, Modern profiles only]
┌─────────────────────── Presentation Engine V4 (pure lib) ───────────────────────┐
│ 1. Segmenter      caption text/spans → beats (1–3 word chunks, speech-paused)    │
│ 2. Emphasis       per-beat: choose the stressed word (emotion/number/pain/…)     │
│ 3. Hierarchy      per-beat: assign a typography ROLE (Display-XL…Caption)        │
│ 4. Layout         safe-area fit, max-width, line-break, overflow resolve         │
│ 5. Choreographer  per-beat entrance/emphasis motion (stagger, ease, pop) as data │
│ 6. ASS Compiler   choreography-data → ASS override tags (\t,\k,\fad,\move,…)     │
│ 7. Outro Composer builds the animated end-scene CLIP SPEC (ffmpeg args)          │
│ 8. QA passes      attention / overflow / safe-area / contrast / readability score│
└──────────────────────────────────────────────────────────────────────────────────┘
      │ ASS string           │ outro clip spec        │ QA report (advisory)
      ▼                       ▼                        ▼
  existing renderAss ⟶  existing concat (unchanged)   stored on brief (advisory)
```

**Design rules:**
- **Pure & deterministic** — same input → same output; no AI, no network, no state.
  (Emphasis/segmentation are heuristic rules, not ML.)
- **Additive & gated** — only runs for Modern profiles; Legacy path byte-identical.
- **Fail-safe** — any pass throws → fall back to the current V3 behaviour, then to
  Legacy. Presentation can never break a render.
- **Same call sites** — output plugs into the *existing* `renderAss` and the
  *existing* CTA-clip append point; the composer/concat/stitching are untouched.
- **Config-as-data** — roles, curves, emphasis lexicons, timing live in typed
  tables (extending today's `typography.ts` / `render-profile.ts`), tunable without
  touching logic.

**Module layout (new pure files, no infra):**
`src/lib/presentation/` — `segmenter.ts`, `emphasis.ts`, `hierarchy.ts`,
`layout.ts`, `choreographer.ts`, `ass-compiler.ts`, `outro.ts`, `qa/*.ts`,
`engine.ts` (orchestrates the passes). Consumed by `ass-captions.ts` (already the
integration seam) + the composer's CTA-clip step.

## §10 Worker Architecture Proposal — **recommendation: DO NOT add workers**

The prompt lists ~20 candidate workers (Typography, Layout, Animation, Highlight,
Attention-Score, Retention-Score, Safe-Area, Overflow, Brand-Compliance, …).

**Verdict: build them as PURE PASSES inside the existing compose worker, NOT as new
BullMQ workers.** Rationale:
- **They're CPU-bound microseconds-to-milliseconds transforms** on a single in-memory
  object (a caption list / ASS string). Distributing them adds Redis round-trips,
  queue coordination, serialization, and new failure modes for **zero** throughput
  or latency benefit — the opposite of premium reliability.
- **New workers = touching worker orchestration / queue / infra**, which is
  explicitly **frozen**. A pure library does not.
- **Ordering matters** (segment → emphasis → hierarchy → layout → choreograph →
  compile); that's a function pipeline, not a fan-out.
- **Testability & determinism** are higher as pure functions (unit-testable offline,
  as we already do for typography/caption-intelligence).

So every "worker" becomes a **pass** with a crisp contract:

| Pass | Input | Output | Validation | Failure mode |
|---|---|---|---|---|
| Segmenter | caption text + [start,end]ms | beats[] (words, timing) | 1–3 words/line; no dangling stop-word | throw → V3 grouping |
| Emphasis | beat words (+ POS-ish tags) | keyword index + reason | exactly ≤1/line; never stop-word | throw → longest-nonstop |
| Hierarchy | beat + role hints | typography role per beat | role ∈ scale; size ≤ safe | throw → Caption role |
| Layout | beat + role + frame | positioned lines, wrapped | fits safe area; no overflow | throw → center/clamp |
| Choreographer | beat + role + energy | motion spec (enter/emph) | durations in bounds; ease-out | throw → simple fade |
| ASS Compiler | motion spec + style | ASS override string | valid tags; parses | throw → static ASS |
| Outro Composer | brand + CTA + palette | ffmpeg clip args | clip renders; ≤4s | throw → V3 static card |
| **QA (advisory)** | final ASS + frames-model | scores 0–100 + flags | non-blocking | log only |

**If workers were ever justified** (they're not here): only for *heavy async* work —
e.g. real vision-model scoring of rendered frames, or ASR. Both are **out of scope**
(no new providers; deterministic timing). Revisit only if a future feature is
genuinely IO/GPU-bound and parallelizable.

## §11 Validation Architecture (correctness gates — pure, blocking-safe)

Deterministic checks that run in-process and **degrade, never crash**:
- **Safe-area checker** — every line's bbox ∈ {120 side, 220 top, 320 bottom};
  captions ∈ 55–78% H band. Violation → Layout re-fits (shrink role / re-wrap).
- **Overflow checker** — measured text width ≤ max-width for the role; else shrink
  one role step or re-chunk. (Fixes today's "text doesn't fit / cramped.")
- **Contrast checker** — sample the footage luma behind the caption band; if low
  contrast, auto-raise stroke/shadow or enable a subtle scrim (deterministic).
- **Timing checker** — each beat 0.8–2.0 s, no beat past scenes-end (reuses the
  existing caption-clamp), no two beats overlapping unintentionally.
- **ASS validity** — the compiled ASS parses (dry libass parse / structural check)
  before it reaches the render; invalid → fall back.
These are **correctness** gates (block a bad frame by fixing it), distinct from QA
scoring (advisory).

## §12 Commercial QA Architecture (advisory scoring — never blocks a render)

A **best-effort, non-blocking** scorer that grades the composed result and stores an
advisory report (like the existing creative-review pattern — on the brief jsonb, no
migration). Purely deterministic + heuristic (no vision model unless later approved):
- **Attention score** — hook size/speed in 0–3 s, emphasis presence, motion cadence.
- **Readability score** — chars/sec, words/line, contrast, safe-area compliance.
- **Retention proxy** — beat cadence (change every 1–3 s?), pattern-interrupt spacing.
- **Brand-compliance** — accent = brand accent (not marigold unless fallback), fonts
  correct per role, logo only-if-real.
- **Premium score** — composite; plus a pass/fail against the QA checklist (§13).
Output: `{scores, flags, recommendation}` stored advisory; surfaced in the studio as
a "Presentation Score" (like the existing Commercial Score). **Never** changes render
status. A future, explicitly-approved step could add real frame vision-scoring — but
that would be the *only* thing meriting a separate async worker.

**Net architecture statement:** V4 is a deterministic **presentation-intelligence
library** + advisory QA, consumed at the two existing seams (`renderAss`, CTA-clip
append), gated per-render, fail-safe to Legacy. **No new workers. No infra. No
pipeline change.**
