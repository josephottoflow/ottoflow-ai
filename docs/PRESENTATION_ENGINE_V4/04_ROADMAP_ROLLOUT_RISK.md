# V4 Roadmap · Rollout · Risk (Deliverables 14–16)

Implementation begins only after explicit approval. Everything below is
presentation-layer, flag-gated, Legacy-byte-identical, RF-validated first.

## §14 Implementation Roadmap
Small commits; each = `next build` + `build:worker` + scope check + Legacy
byte-identical + unit tests; **no** frozen-system edits. Order chosen so value lands
early and risk stays isolated. (Builds on shipped V3: typography.ts, fonts, caption
intelligence, per-render profiles.)

| Phase | Deliverable | New pure files | Validation |
|---|---|---|---|
| **V4-1 Segmenter+Hierarchy** | per-beat chunking + role assignment | `presentation/segmenter.ts`, `hierarchy.ts` | unit: 1–3 words, role bounds; RF render |
| **V4-2 Emphasis intelligence** | priority-lexicon keyword + mono numbers | `presentation/emphasis.ts` (+ lexicon tables) | unit vs a labeled emphasis set; RF |
| **V4-3 Layout + fit/overflow** | safe-area fit, auto-shrink, wrap | `presentation/layout.ts` | unit: no overflow, safe-area; RF |
| **V4-4 Choreographer + ASS compiler** | stagger/ease motion → ASS `\t` | `presentation/choreographer.ts`, `ass-compiler.ts` | unit: valid ASS, curve bounds; RF |
| **V4-5 End Scene clip** | pre-composed animated outro | `presentation/outro.ts` | RF: outro renders, ≤4s, fallback |
| **V4-6 Audio V3** | acompressor+EQ, music rise/fall, per-platform LUFS | (extends ffmpeg audio filter) | measure LUFS; RF |
| **V4-7 Validation gates** | safe-area/overflow/contrast/timing/ASS-valid | `presentation/qa/*.ts` | fault-injection tests |
| **V4-8 Commercial QA scorer** | advisory Presentation Score + checklist | `presentation/qa/score.ts` | synthetic; surfaced in studio |
| **V4-9 Studio preview (optional)** | browser ASS preview (JASSUB-style), author-time | frontend only | no render-path change |

Each phase is independently shippable and flag-gated; Modern profiles adopt passes
as they land; Legacy never changes.

## §15 Production Rollout Strategy
1. **Build behind the existing per-render profiles** — Modern opt-in only; Legacy
   stays the production default. Never set a global `RENDER_PROFILE_DEFAULT`.
2. **RF-first validation every phase** — the proven $0 Royalty-Free pipeline, using
   the download→local-ffmpeg frame-inspection method (the media proxy can't be
   trusted for in-browser capture). One Legacy vs Modern A/B per phase.
3. **One Seedance render only after RF certifies a phase** — Legacy vs Modern
   comparison report; exactly one paid render per certified phase.
4. **Advisory scores first, gates second** — ship QA scoring as advisory; only after
   it correlates with human judgment do we let validation gates auto-fix.
5. **Gradual default shift** — only after John approves a full A/B + the QA checklist
   passes across ≥5 brand categories do we *consider* making a Modern profile the
   default. Until then: Legacy = default, Modern = opt-in.
6. **Instant rollback** — unset the profile / flag → next render byte-identical Legacy.
7. **Observability** — reuse the existing AI-usage/creative-review telemetry pattern
   to log Presentation Scores; no new infra.

## §16 Risk Assessment (RPN-ranked, FMEA-style)
| # | Risk | Sev | Occ | Det | RPN | Mitigation |
|---|---|---|---|---|---|---|
| 1 | A pass throws mid-render → broken caption/render | 9 | 3 | 2 | 54 | every pass in try/catch → V3 → Legacy; ASS validity gate before render |
| 2 | Font not loaded on worker → silent DejaVu fallback | 5 | 3 | 4 | 60 | already validated on worker (V3 cert); fontsdir + ASS-embed fallback documented; readable regardless |
| 3 | Emphasis picks the "wrong" word (subjective) | 4 | 5 | 5 | 100 | priority lexicon + curated tables; advisory QA flags; per-brand tuning later; human-legible rules |
| 4 | Overflow / cramped text on long captions | 6 | 4 | 3 | 72 | overflow checker auto-shrinks/re-chunks; unit tests on long inputs |
| 5 | Motion feels "too much" / gaming | 6 | 3 | 4 | 72 | restraint budget (≤1 loud beat/5s, ≤4% overshoot, one curve); QA "premium" score |
| 6 | Outro clip step slows or breaks compose | 7 | 2 | 3 | 42 | isolated ffmpeg pass BEFORE concat; timeout + fallback to V3 static card; concat untouched |
| 7 | Accidental Legacy drift (byte-identity broken) | 9 | 2 | 2 | 36 | Legacy path literally unchanged; byte-identity unit test each commit |
| 8 | Scope creep into frozen systems | 9 | 3 | 3 | 81 | hard rule: presentation lib only; if a change needs the pipeline, STOP + ask |
| 9 | Audio over-processing (pumping/artifacts) | 6 | 3 | 4 | 72 | conservative params; measure LUFS/TP; A/B vs Legacy; profile-gated |
| 10 | Per-platform LUFS mismatch | 3 | 3 | 4 | 36 | platform table from plan.output; measured post-render |

Top attention items by RPN: **#3 emphasis subjectivity** (mitigate with lexicons +
advisory scoring + brand tuning), **#8 scope creep** (hard stop rule), **#4 overflow**
(auto-fit), **#5 over-motion** (restraint budget). None are pipeline/infra risks —
the frozen surface is protected by construction (pure lib, gated, fail-safe).

## Success criteria
A first-time viewer says "this looks professionally edited" without knowing OttoFlow:
varied hierarchy, human-accurate emphasis, choreographed motion, an animated end
scene, broadcast audio — all while the certified render pipeline stays **frozen,
Legacy stays default, and Modern stays opt-in until you approve otherwise.**
