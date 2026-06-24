# Video V1 → V1.1 Prompt Builder — Gap Analysis & Migration Design

**Status:** Design review (pre-Sprint-3). **Not implemented — no code, no DB.**
**Canonical source of truth:** `VIDEO_V1.1_PROMPT_BUILDER_SPEC.md`.
**Verified against production code (this audit):** `src/lib/ffmpeg-pipeline/video-strategy.ts`, `src/lib/brand/visual-world.ts`, `worker/processors/scene-generation.ts`, `src/lib/gemini.ts`, `src/lib/creative/brief.ts`.

---

## A. Prompt Gap Analysis

### A1. Every prompt field currently generated — current vs required

| Current field (file:line) | Current behavior | V1.1 required | Verdict |
|---|---|---|---|
| `scene.prompt` (video-strategy.ts:116-120) | "abstract-safe… geometry, composition, motion, COLOR ONLY. NO people, faces" | 10-slot human-first grammar | **REPLACE** |
| `scene.role` (problem/tension/solution/outcome) | 4 fixed roles | 6 scene-beats (Hook·Problem·Pain·Reveal·Outcome·Proof) + CTA endcard | **EXTEND/REPLACE** |
| `scene.durationSec` (video-strategy.ts:140) | **uniform** perScene (5s) | **variable** per beat (Reveal 7–8s, CTA 3–4s) | **CHANGE** |
| `scene.caption` | short on-screen line | unchanged (compose layer) | **KEEP** |
| `scene.seed` | per-scene random | shared seedFamily for continuity | **KEEP (already shared at worker)** |
| `video_concept`, `brand_worldview` (video-strategy.ts:109) | thesis + "calm, structured, human" | reframe → human commercial tone | **KEEP, RE-CONTEXT** |
| `visual_tension` (reused from brief) | drives dramatized opposition | demoted to **emotional subtext only** | **DEMOTE** |
| `visual_metaphor` (reused from brief) | **literalized into geometry** (:120, fallback :171) | **NOT consumed by video** | **OBSOLETE** |
| `styleBlock` (scene-generation.ts:118-120) | "architectural motion" + "no people, faces" | story-mode preamble + human-safe negative | **REPLACE** |

### A2. The 10 spec slots vs current presence

| Spec slot | Present today? | Gap |
|---|---|---|
| 1 Shot Type | no | MISSING |
| 2 Environment | no (abstract void) | MISSING — must name real place |
| 3 Human Subject | no (banned) | MISSING + INVERTED |
| 4 Action | no | MISSING |
| 5 Emotional State | partial (role→ROLE_EMOTION, not in prompt) | MISSING in prompt |
| 6 Lighting | generic ("soft volumetric key light") | WEAK — per-beat design needed |
| 7 Render Quality | no | MISSING ("photorealistic, 4K") |
| 8 Depth of Field | no | MISSING |
| 9 Brand Accent | palette as fill/geometry color | MISREAD — re-target to accent lighting |
| 10 Camera Motion | generic ("slow steady camera") | WEAK — motivated per-beat move |

**Missing:** Shot Type, Environment, Human Subject, Action, Emotion-in-prompt, Render Quality, Depth of Field, Product-Demo directive, variable duration.
**Obsolete:** `visual_metaphor` consumption (:171, :120); "abstract-safe/geometry-only" (:116-117); "no people, faces" negative (visual-world.ts:82, video-strategy.ts:118); "architectural motion" preamble (visual-world.ts:104).

---

## B. Human-First Migration Plan

| Element | Current | V1.1 target | Transition mechanism |
|---|---|---|---|
| Human Subject | banned (:118, visual-world.ts:82) | recurring protagonist verbatim (slot 3) | Audience Agent blueprint → every scene; remove ban |
| Environment | abstract geometry | named real place (slot 2) | Story Agent from persona + industry env-vocab |
| Action | none | active verb per beat (slot 4) | Beat-Matrix subject-behavior column |
| Emotion | grade-only (ROLE_EMOTION) | explicit mood token (slot 5) | promote ROLE_EMOTION arc into prompt text |
| Lighting | generic "soft volumetric" | per-beat design (slot 6) | Beat-Matrix lighting + Visual Style |
| Camera Motion | "slow steady" | motivated per-beat (slot 10) | Beat-Matrix camera/motion |
| Brand Accent | palette as fill color | accent lighting + grade (slot 9) | visual_world palette → accent-light grammar |
| Product Demonstration | absent | data-viz / interaction / reaction (§6) | Product-Demo directive on Reveal/Proof beats |

---

## C. Abstract-Visual Elimination Plan

| # | Instruction (file:line) | Produces | Disposition |
|---|---|---|---|
| 1 | "abstract-safe Seedance prompt" (video-strategy.ts:116) | the whole abstract frame | REMOVE → 10-slot grammar |
| 2 | "geometry, composition, structure, motion, COLOR ONLY" (:117) | tunnels, corridors, shapes | REMOVE → "real human in real environment" |
| 3 | "NO people, faces, text, letters, logos…" (:118) | subjectless scenes | SPLIT → keep no-text/logo, drop no-people/faces |
| 4 | "metaphor must be visually recognizable" (:120) | literal labyrinth/maze | REMOVE → metaphor = subtext |
| 5 | fallback `prompt = ${role}: ${visualMetaphor}` (:171) | pure-metaphor abstract scene | REPLACE → persona-grounded fallback |
| 6 | `DEFAULT_NEGATIVE = "no people, faces…"` (visual-world.ts:82) | suppresses humans | REPLACE → bans text/logos/abstract-shapes/tunnels, allows humans |
| 7 | "calm, structured, architectural motion" (visual-world.ts:104) | floating structures, geometric motion | REPLACE → "authentic people, real environments, cinematic commercial motion" |
| 8 | buildStyleBlock "steady slow cinematic camera motion" (scene-generation.ts:54) | generic-tech feel | REPLACE → story-mode preamble; add "no generic tech / stock look" to negative |
| 9 | **upstream:** visual_metaphor born abstract (gemini.ts:2143) | seeds all abstraction | DECOUPLE — video stops consuming it; gemini.ts unchanged (stills keep it) |

Net: 1,2,4,5 removed; 3,6,7,8 replaced; 9 decoupled. Universal negative now bans abstract subjects by name.

---

## D. Story Agent Implementation Mapping (slot ownership)

| Slot | Owner | Secondary input |
|---|---|---|
| 1 Shot Type | Story Agent (Beat Matrix) | Platform Agent (shot scale per aspect) |
| 2 Environment | Audience Agent (persona) | Brand Research (industry) |
| 3 Human Subject | Audience Agent (protagonist blueprint) | Brand Research (industry role) |
| 4 Action | Story Agent (beat) | — |
| 5 Emotional State | Story Agent (arc) | Audience Agent (emotional drivers) |
| 6 Lighting | Story Agent (Beat Matrix) | Visual Style Agent |
| 7 Render Quality | Prompt Builder constant | — |
| 8 Depth of Field | Visual Style Agent | Story Agent (beat override) |
| 9 Brand Accent | Visual Style Agent (visual_world palette) | Brand Research (colors) |
| 10 Camera Motion | Story Agent (pacing) | Platform Agent (energy) |
| Negative | Prompt Builder constant + Product-Demo conditional | — |
| Per-scene duration | Story Agent | Platform Agent (target/scene caps, ≤8s) |
| Caption | Story Agent | (compose renders) |
| **Creative Brief** | **CONTEXT ONLY** (brand voice, CTA hint) | owns no slot |

Ownership principle: *who* = Audience Agent; *how it looks* = Visual Style Agent; *what happens & how shot* = Story Agent; *the envelope* = Platform Agent; *fidelity* = Builder constant. Creative Brief owns no slot.

---

## E. Seedance Validation Strategy (design)

A **pre-spend Prompt Validator** runs in the existing dryRun, after Prompt Builder, before enqueue — mirroring the still pipeline's `findForbiddenBackgroundToken` + 2-attempt-then-fallback (creative/brief.ts:192-221). Deterministic token checks, per scene:

| Rule | PASS requires | REJECT trigger |
|---|---|---|
| Human Presence | a human noun (person/operator/manager/woman/man/owner/team/hands) | none present |
| Real Environment | env token from allowlist (office/desk/room/jobsite/home/store/neighborhood/clinic…) | absent, or "void/abstract space/digital realm/black void" present |
| No Abstract Subject | no banned subject token as scene subject | tunnel/corridor/labyrinth/maze/geometric/floating/particle/data-sphere/neural-lines-as-subject |
| No Synthetic Text | universal negative present; no affirmative text/label/logo/UI request | prompt requests readable text/logo/menu |
| Product Demonstration | screen scene has a human-reaction token + "no legible text" negative | screen with no human reaction, or missing no-text guard |

**On reject:** (1) return the violated rule → one repair regeneration of that scene; (2) still failing → mark scene `invalid`, surface to Quality Engine (advisory block, no spend). Two attempts then hard-fail. Pre-spend + deterministic → cannot regress the certified compose path, costs nothing.

---

## F. Certification Update — extended checklist

V1 compose checklist **A–H remains mandatory and unchanged**. V1.1 adds five human-first criteria (spec C1–C12):

| New | Criterion | PASS condition | Hard-fail? |
|---|---|---|---|
| I | Human Presence | every generated scene has a recognizable human (C1) | yes |
| J | Environment Authenticity | every scene a nameable real place; zero abstract voids (C2/C3) | yes |
| K | Emotional Progression | mood arcs cold→warm across beats (C6) | no (advisory) |
| L | Product Visibility | product shown human-first; no fake UI text (C5/C9) | yes (C5) |
| M | Protagonist Continuity | same role/wardrobe archetype across scenes (C4) | no (regen-fixable) |

FAIL on I, J, or L-text = hard fail (core defect). K, M remediable via single-scene regeneration. Deterministic CTA (C10) + ≤8s/scene (C8) carry over from the certified V1.1 compose path.

---

## FACTS (verified from code/spec)
1. video-strategy.ts:116-120 instructs "abstract-safe… geometry only… NO people, faces."
2. visual-world.ts:82 DEFAULT_NEGATIVE includes "no people, faces"; :104 preamble "architectural motion."
3. Final Seedance prompt = `styleBlock + scene.prompt` (scene-generation.ts:177); styleBlock = stylePreamble + "Avoid: " + negativePrompt (:118-120).
4. visual_metaphor born abstract-safe in the still-image engine (gemini.ts:2143), reused verbatim by video (video-strategy.ts:103,171).
5. Current scene duration is uniform perScene (video-strategy.ts:140).
6. Still pipeline already uses a deterministic forbidden-token validator + 2-attempt fallback (creative/brief.ts:192-221) — proven pattern for §E.
7. V1.1 compose path (9:16/1:1/16:9) is certified; CTA endcard + logo are deterministic.

## ASSUMPTIONS
- Story Agent will be opt-in (mode-gated); certified 4-beat remains default until §F passes.
- Audience Agent output is sufficient to ground slot 3 (depends on brand data depth).
- Seedance renders believable humans at production volume (supported by the RPN-60 spike, one sample).
- Token-based deterministic validation (§E) is sufficient; frame-vision validation is post-render (deferred).

## UNKNOWNS
- Cost delta of variable durations + 6 scenes per platform (estimate only).
- Whether brands.visual_world is stored vs derived per brand (changes which negative/preamble applies).
- Seedance face/hand failure rate at 720p across industries (no multi-render sample).
- Whether any still-pipeline code path is affected by the negative change (read suggests no; gemini.ts concept engine must stay untouched — re-verify at implementation).

## RISKS
- R1 (high): residual visual_metaphor coupling re-introduces abstraction → full decouple + §E No-Abstract-Subject gate (FM-1/FM-2).
- R2 (high): editing shared DEFAULT_NEGATIVE/styleFromPalette globally regresses certified 4-beat → mode-gate, never change defaults in place.
- R3 (med): thin brand data → generic protagonist → Audience confidence flag + industry archetype fallback.
- R4 (med): validator false-rejects valid scenes → 2-attempt-then-advisory, tunable token lists.
- R5 (med): cost increase on human path → storyboard gate + balance preflight + platform scene caps contain it.
