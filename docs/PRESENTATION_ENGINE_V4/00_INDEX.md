# OttoFlow Presentation Engine V4 — Research & Architecture

**Status:** research + architecture only. **No code, no pipeline/worker/provider
changes.** The render pipeline (Seedance, AtlasCloud, ElevenLabs, Jamendo, BullMQ,
FFmpeg stitching/concat, scene generation) is **FROZEN**. Implementation begins
only after explicit approval.

**Thesis:** the current output is *technically* correct but still reads as
"subtitles on footage," not "a professionally edited commercial." The fix is not a
new renderer — it is a **presentation intelligence layer** (deterministic authoring
+ choreography + QA) that sits on top of the existing ASS/libass + FFmpeg surface.
Builds on [[video-quality-v2-rollout]] and the V3 docs (typography.ts, Style Guide).

## Deliverable map (the 16 requested)
| # | Deliverable | Location |
|---|---|---|
| 1 | Professional Research Report | `01_RESEARCH.md` §1 |
| 2 | Typography Research Report | `01_RESEARCH.md` §2 |
| 3 | High Retention Video Analysis | `01_RESEARCH.md` §3 |
| 4 | Text Presentation Research | `01_RESEARCH.md` §4 |
| 5 | Animation Research | `01_RESEARCH.md` §5 |
| 6 | End Screen Research | `01_RESEARCH.md` §6 |
| 7 | Audio Presentation Research | `01_RESEARCH.md` §7 |
| 8 | Open Source / GitHub Survey | `01_RESEARCH.md` §8 |
| 9 | Presentation Engine V4 Architecture | `02_ARCHITECTURE.md` §9 |
| 10 | Worker Architecture Proposal | `02_ARCHITECTURE.md` §10 |
| 11 | Validation Architecture | `02_ARCHITECTURE.md` §11 |
| 12 | Commercial QA Architecture | `02_ARCHITECTURE.md` §12 |
| 13 | Premium Video Style Guide V2 | `03_STYLE_GUIDE_V2.md` |
| 14 | Implementation Roadmap | `04_ROADMAP_ROLLOUT_RISK.md` §14 |
| 15 | Production Rollout Strategy | `04_ROADMAP_ROLLOUT_RISK.md` §15 |
| 16 | Risk Assessment | `04_ROADMAP_ROLLOUT_RISK.md` §16 |

## Design research (post-implementation-start; govern all future waves)
| Doc | Purpose |
|---|---|
| `05_PREMIUM_MOTION_TYPOGRAPHY_RESEARCH.md` | Deterministic typography/motion/emphasis rules + gap analysis + backlog P1–P8 |
| `06_CREATIVE_DIRECTION_BIBLE.md` | Attention-first reframe: the One Law + 8 systems + 37-pattern reference library |
| **`07_OTTOFLOW_PRESENTATION_DESIGN_BIBLE.md`** | **SINGLE SOURCE OF TRUTH** — consolidates 05+06+foundational science (eye-tracking/retention psych); 12 systems + deterministic-rules master table + quality checklist (release gate) + implementation mapping (waves W1–W7) |

## The one-paragraph answer to "why does it still feel generated?"
Six root causes, all **authoring**, none renderer: (1) **uniform cadence** — every
caption enters the same way at the same size for the same duration; premium editing
varies size/speed/energy per beat. (2) **flat hierarchy** — one caption size; pros
use a 5–7 step scale (a one-word hook at 130px, a read at 70px). (3) **generic
emphasis** — "longest word" ≠ what a human stresses; humans stress *emotion,
numbers, pain, transformation, contrast*. (4) **no choreography** — words appear as
a block; premium work reveals per word/phrase in rhythm with the voice. (5) **static
end card** — a slide, not a scene. (6) **no attention/overflow QA** — nothing scores
whether a frame actually reads at a thumb-scroll. V4 fixes all six as deterministic
passes over the caption/plan objects, inside the existing composer.
