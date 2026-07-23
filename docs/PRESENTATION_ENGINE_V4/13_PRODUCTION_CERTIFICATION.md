# 13 · Production Certification — Motion Typography Engine

> **Status: pre-render gates GREEN; real-render gates operator-blocked. NOT yet promoted to
> production.** The engine is feature-frozen and integrated on `feat/caption-engine-v1`.
> Legacy stays the byte-identical default; Modern is opt-in per render; rollback is one env var.

## Gate matrix

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | Presentation Validation Suite (synthetic legibility) | ✅ PASS | `scripts/presentation-qa.mjs`: Premium (outline 4) + Impact (outline 7) survive all 8 hard backgrounds (black/white/gradients/noise/fractal/overexposed) |
| 4 | Legacy byte-identical | ✅ PASS | `Legacy(static) === Legacy(no-profile)`; static branch untouched; classic/minimal core presets unchanged |
| 5 | Worker stability | ✅ PASS | `tsc --noEmit` 0 errors; `npm run build:worker` green |
| — | Rollback lever | ✅ LIVE | env `PRESENTATION_ENGINE=classic-modern` OR per-render `profile.presentationEngine` → previous per-word Modern engine, no code change. Default `motion`. |
| — | Local varied-content validation | ✅ PASS | `production-qa.mjs` on a 6-beat multi-intent render (hook/stat/quote/contrast/statement/CTA) over a mid-brightness MOVING gradient: intelligence composed each beat correctly & distinctly, legibility held, zero failures |
| 2 | Production Validation Suite (REAL renders) | ⛔ BLOCKED | needs cloud RF/Seedance renders on the deployed worker |
| 3 | Regression vs previous approved (real) | ⛔ BLOCKED | needs a real render baseline |
| 6 | No production render failures introduced | ⛔ BLOCKED | needs real renders on the worker |

## Why the ⛔ gates are operator-blocked (genuine, not skipped)
- **Credentials** — triggering an RF/Seedance render needs the signed-in app (browser); the session is signed out and entering credentials is out of scope.
- **Paid resource** — each Seedance render costs ~$7 (explicit approval gate).
- **Infra** — the render WORKER deploys from `main` (Railway); a separate staging worker would touch rendering orchestration (frozen) / infra (credentials).

## Tooling ready to close the gates (built, permanent)
- `scripts/presentation-qa.mjs <philosophy> ["caption"] ["#accent"]` — synthetic legibility envelope.
- `scripts/production-qa.mjs <render.mp4> [previous.mp4]` — key frames, contact sheets,
  objective caption-band metrics (flags weak moments), Bible scorecard, SSIM regression.

## Recorded, non-blocking finding (confirm on real footage before acting)
The **accent word** is the lowest-contrast element over bright/colorful areas (it should be the
most legible). It stays legible via its outline, is **brand-colored** (not the engine's choice),
and only shows on synthetic bright gradients — over real footage the accent often sits on
darker/subject areas. Per "the footage wins / no change without a proven failure," this is
recorded, not fixed. First thing to check on the first real render.

## Operator steps to complete certification
1. Deploy `feat/caption-engine-v1` (or approve merge → `main`). Legacy default unchanged; Modern opt-in; rollback env available.
2. Generate a spread of renders — RF ($0) and Seedance (~$7 each) — varied duration / pacing /
   narration / brightness / scene complexity / indoor-outdoor / people-product-landscape.
3. For each: `node scripts/production-qa.mjs <render.mp4> <previous.mp4>` → score against the
   Bible, regression-compare, Creative-Director loop (one weakest moment → fix → re-render).
4. Promote to default Modern only after gates 2/3/6 pass AND multiple RF + Seedance renders are approved.

## Rollback (always one change)
- Whole-way: `CAPTION_ENGINE=static` → Legacy static captions.
- Modern only: `PRESENTATION_ENGINE=classic-modern` → previous per-word Modern engine.
