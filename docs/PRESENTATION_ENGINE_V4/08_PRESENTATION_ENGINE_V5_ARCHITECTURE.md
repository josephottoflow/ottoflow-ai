# Presentation Engine V5 — Architecture & Motion Typography System

**Status:** APPROVED architectural pivot. **Design/architecture only — no code in this
document.** Topic research (typography, motion, emphasis, attention, retention, eye-
tracking, end-scene, luxury/viral editing, GitHub typography) is already delivered and
governs this design — see [05](05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH.md),
[06](06_CREATIVE_DIRECTION_BIBLE.md), [07](07_OTTOFLOW_PRESENTATION_DESIGN_BIBLE.md).
This document is the **engineering architecture** that turns those bibles into a modular
Presentation Engine + a Motion Typography style system. It does not re-run that research.

**Renderer is FROZEN.** Seedance · AtlasCloud · Gemini · ElevenLabs · Jamendo · FFmpeg
stitching/compose · scene generation · Queue · Redis · R2 · Railway worker · render
orchestration are **not touched**. Presentation sits ABOVE the renderer. No new workers
(the engine is pure, in-process, µs–ms CPU). No new providers/LLMs/generators. Legacy
byte-identical. Modern opt-in until certified. RF renders only while iterating.

---

## 0. Thesis: we already have the skeleton — V5 formalizes and completes it

The Presentation Engine already exists as a pass pipeline in `src/lib/presentation/`
(`engine.ts` runs ordered passes over a `PresentationModel`). V5 is **not a rewrite** —
it is: (a) formalize the passes into named **Engines** with clean contracts, (b) add the
two missing engines (**Layout**, **Style/Motion-Typography**), (c) move ALL presentation
decisions OUT of `ass-captions.ts` so it becomes a **pure compiler**, and (d) make the
whole thing **style-family driven** so one video can be "Luxury·Apple" and another
"Viral·Hormozi" from the same engine.

**The core inversion:** today `ass-captions.ts` still holds intelligence (MOTION_SIGNATURES,
treatment→motion mapping, keyword rendering, size decisions). V5 moves every *decision* into
the engine and leaves `ass-captions.ts` only the job of *serializing a fully-decided model
to ASS override tags*. Decisions in, ASS out — no judgement in the compiler.

---

## 1. The module pipeline (each stage: responsibility · in→out · state)

```
PlanInput (captions + timing + brand + platform + styleFamily)
        │
        ▼
1  Scene Analysis      scene roles, durations, footage hints        [exists: plan.scenes]
2  Beat Analysis       tokenise, group ≤3, thought-groups, role     [exists: passes 1-3]
3  Attention Engine    per-instant focal element; one-thing-moves;  [NEW/partial]
                       hold/pattern-interrupt schedule
4  Typography Engine   role→size/weight/tracking/leading (scale)    [partial: passes.ts]
5  Layout Engine       per-beat layout archetype + anchor + align   [NEW — #1 gap]
6  Motion Engine       per-beat motion signature (from style)       [partial: MOTION_SIGNATURES]
7  Emphasis Engine     prosody focal word + channel (size/colour)   [partial: end-focus TODO]
8  CTA Engine          the ask beat: single verb, calm treatment    [partial]
9  Final Scene Engine  the closing shot spec (footage-cont + reveal)[partial: outro builders]
        │
        ▼
   PresentationModel (fully decided IR)
        │
        ▼
10 ASS Compiler (ass-captions.ts)   IR → ASS override tags ONLY     [refactor target]
11 FFmpeg (frozen)                  ass= filter + outro clips        [FROZEN]
```

Every engine is a **pure pass** `(model) → model` (the existing `PresentationPass`
contract), guarded/fail-safe, deterministic. The Style Family (below) parameterises
engines 4–9 — it is *data*, not new control flow.

---

## 2. The Presentation IR (what flows through the engine)

Extend the existing `Beat`/`PresentationModel` into a fully-decided intermediate
representation. Every field is **decided by an engine, consumed by the compiler** — the
compiler never re-derives anything.

```
Beat {
  lines: { words: Word[] }[]            // grouped, ≤3
  role: "hook"|"statement"|...           // Beat Analysis
  treatment: TreatmentId                 // narrative identity
  emphasis: { line:int, word:int, channel:"size"|"colour"|"mono"|"none" }?  // Emphasis
  type: { baseFontPx, roleMult, trackingPx, leadingMult, weight, case }     // Typography
  layout: { archetype, anchor:{xPct,yPct}, align, maxWordsPerLine }         // Layout (NEW)
  motion: { signature, popFrom, overshoot, staggerMs, fadeInMs, hold }      // Motion
  timingMs: { start, end }               // from plan
}
PresentationModel { frame, brand{accent,logo}, styleFamily, config, beats, finalScene }
```

Compiler rule: **if a value isn't on the IR, the compiler does not invent it.** This is
what makes `ass-captions.ts` "only a compiler."

---

## 3. `ass-captions.ts` → pure ASS Compiler (the refactor)

**Move OUT of the compiler (into engines):** `MOTION_SIGNATURES`, treatment→motion
mapping, `SUPPORT_POP/KEYWORD_POP`, keyword selection, per-beat size/tracking math,
hold-rhythm, `classifyTreatment` (already in passes ✓). **Keep IN the compiler:** ASS
header build, colour/BGR conversion, time formatting, `\k`/`\kf` karaoke run math (pure
serialization of decided timings), and the mechanical emission of `\fs \fscx \t \fad \blur
\fsp \an \pos \1c \fn \N` from IR fields. The compiler becomes a ~deterministic function
`compileAss(model) → string` with **no design constants**.

**Migration is incremental & safe:** introduce the IR fields one engine at a time; the
compiler reads `beat.motion?.signature ?? <current inline>` during transition so nothing
breaks; when an engine owns a field, delete the inline fallback. Legacy path
(`renderAss` static) is untouched throughout → byte-identical.

---

## 4. Motion Typography Engine (style families)

A **StyleFamily** is a data object that parameterises engines 4–9. NOT just fonts — it
defines the whole presentation language:

```
StyleFamily {
  id, group                      // "luxury.apple", group "Luxury"
  typography { fontDisplay, fontBody, fontMono, baseFontPct, roleScale{hook,headline,
               caption,micro}, weight{support,focal}, trackingByRole, leadingByRole, case }
  layout     { archetypesByTreatment, anchorPolicy, maxWordsByRole }
  motion     { signaturesByTreatment, easing, overshoot, stagger, holdRate }
  emphasis   { maxTier, channelByTreatment, colourBehavior }
  cta        { treatment, verbChannel, energy }
  ending     { finalSceneSpec }
  colour     { accentSource, scrim, karaoke }
  rhythm     { wordsPerLine, minWordMs, patternInterruptEvery }
}
```

Registry (`src/lib/presentation/styles/`): a map `StyleFamilyId → StyleFamily`. The roster
from the brief is the **target catalogue**; we ship a few REAL families and stub the rest
as "coming soon" (they resolve to the closest shipped family until authored):

| Group | Families | Ship plan |
|---|---|---|
| Luxury | Apple, Rolex, Porsche, Editorial, Fashion | **Apple = ship first** (maps from `corporate` lineage: restraint, size hierarchy, sparse colour, calm motion) |
| Viral | MrBeast V1/V2, Hormozi, Ryan Pineda, Iman Gadzhi | **Hormozi = ship first** (maps from `bold_creator`: big uppercase, yellow active word, punchy) |
| Podcast | Modern, Minimal, Dark, Neon | later |
| Corporate · Gaming · Educational · Documentary · Anime · Cinematic · Sports · News · Custom | | later |

**Legacy is NOT a style family** — it stays the frozen, separate static path. Modern
renders pick a StyleFamily (default = Luxury·Apple, the safe premium). `renderProfile`
extends: `modern_v1 → luxury.apple`, `modern_v2 → viral.hormozi` (back-compat), plus new
explicit `styleFamily` field.

Two fully-specified families to start (Apple, Hormozi) prove the schema; the rest are
authored later as pure data — no engine changes needed to add a family. **This is the
competitive moat: a data-driven style system, not hardcoded caption presets.**

---

## 5. Layout Engine (the #1 scorecard gap — was 3/10)

Today every caption is dead-centre → the strongest "AI captions" tell. The Layout Engine
picks a **layout archetype per beat** (deterministic, from treatment + word-count + style),
emitting `\an` + `\pos`/anchor + align into the IR.

**Archetypes:** `centered` (default) · `lower-third` · `single-word-hero` (1-word screen,
huge, centred) · `large-number` (stat: figure dominant, label small) · `offset-left` /
`offset-right` (asymmetric editorial) · `stacked-kicker` (small word over big word) ·
`split` (two-line contrast). Selection e.g. Apple-family: hook→single-word-hero or
stacked-kicker; stat→large-number; statement→centered/lower-third alternating; turn→offset.

**Safe-area contract (hard):** every archetype clamps to 120px sides / clear of bottom
~20% (platform UI) / caption band per style. **Footage-dependent archetypes (offset,
lower-third over a subject) are RF-validation-gated** — shipped behind the style but
verified on a real RF render over real footage before enabling, because a subject clash
can only be judged on footage (proven workflow: claude-in-chrome existing session → RF
render $0 → download → local ffmpeg critique).

---

## 6. Final Scene Engine (static card REJECTED)

Reject the card. The closing is the **final shot of the commercial**, specified by the
style's `finalSceneSpec` and compiled to the existing outro ffmpeg builders (frozen
compose seam). Beats (extends the working footage-continuation): dissolve-in from the
film's last frame → **evolving light** (glow bloom animates in) → CTA rises inside the
scene → **underline draws on** (wipe) → **logo reveal** (natural, calm) → living hold with
continued camera push. Per-style endings (Apple = quiet/minimal; Hormozi = bolder). The
current footage-continuation outro (`buildCinematicOutroClipArgv`) is the foundation;
V5 adds glow-bloom animation, underline draw-on, and logo reveal (all inside the existing
self-contained outro pass, fail-safe → current outro → static card).

---

## 7. Rollout / migration (safety-first, incremental)

1. **Land the IR + compiler refactor** behind the existing Modern gate — output
   byte-identical to today (fields default to current inline values). Validate: Legacy
   byte-identical + Modern RF render matches current.
2. **Layout Engine** (centered + single-word-hero + large-number first — all centre-safe,
   locally validatable) → RF render → scorecard. This is the biggest visible win.
3. **Style Families**: author Luxury·Apple fully; make `modern_v1` resolve to it → RF
   render → scorecard vs current.
4. **Final Scene Engine** upgrades (glow bloom, underline draw-on, logo reveal) → RF.
5. **Emphasis Engine**: end-focus/prosody default (from 07 §B5) → RF.
6. Author **Viral·Hormozi**; then remaining families as pure data.
7. Each step: deterministic · Modern-opt-in · fail-safe→Legacy · one commit · RF-validated
   + re-scored on the 17-category card (07 §D gate) · **no renderer/stitching/worker
   changes**. Seedance certification only after RF presentation quality is approved.

**No new workers** unless proven necessary — the engine is pure in-process CPU work at the
existing `renderAss`/outro seams (per 06/07). If a future style needs heavy asset
pre-rendering, that's re-evaluated then, not now.

---

## 8. What this pivot changes vs. keeps

**Keeps (works today, proven on the RF render):** the pass pipeline, deterministic
authoring, sparse prosody emphasis, brand accent, footage-continuation ending foundation,
the RF-render→local-critique validation loop.
**Changes:** ass-captions becomes a compiler; presentation decisions centralise in engines;
a Layout Engine appears; presets become data-driven **Style Families**; the ending becomes
a per-style Final Scene.

**Recommended first implementation (when we proceed): the Layout Engine (§5)** — it targets
the lowest score (layout variety 3/10) and is largely locally-validatable, so it moves the
"looks like subtitles" needle most per unit risk, then RF-validate.

---

## Sources
Architecture derives from the committed research bibles (no new topic research here):
[05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH](05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH.md) ·
[06_CREATIVE_DIRECTION_BIBLE](06_CREATIVE_DIRECTION_BIBLE.md) ·
[07_OTTOFLOW_PRESENTATION_DESIGN_BIBLE](07_OTTOFLOW_PRESENTATION_DESIGN_BIBLE.md).
Current engine: `src/lib/presentation/` (engine.ts, passes.ts, grouping.ts, lexicon.ts,
types.ts) + `src/lib/ffmpeg-pipeline/ass-captions.ts` (compiler target) + outro builders in
`ffmpeg.ts`/`branding.ts` (Final Scene seam).
