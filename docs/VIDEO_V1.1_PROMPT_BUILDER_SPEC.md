# OttoFlow Video V1.1 — Canonical Prompt Builder Specification

**Status:** Design spec (Sprint-3 reference). **Not implemented.**
**Benchmark:** Cardinal Data Sphere (frames + literal Seedance prompts, verified).
**Scope:** Prompt system design only — no code, no DB, no architecture.
**Companion docs:** `VIDEO_V1.1_ARCHITECTURE.md`, `VIDEO_V1.1_PROMPT_GAP_ANALYSIS.md`.

---

## 1. Prompt Builder Contract

### 1.1 The 10-slot grammar

Every Seedance scene prompt is assembled from exactly 10 slots in a **fixed concatenation order** (order mirrors Cardinal's proven sequence). Slots are populated by the Story Agent per beat, except where marked *constant* or *brand-sourced*.

| # | Slot | Definition | Controlled vocabulary / format | Required | Source |
|---|---|---|---|---|---|
| 1 | **Shot Type** | Framing scale | `aerial \| wide \| establishing \| medium \| medium close-up \| close-up \| extreme close-up \| over-the-shoulder` | yes | Story Agent (beat) |
| 2 | **Environment** | Real, named place | real location archetype (office, neighborhood, jobsite, clinic, storefront…) | yes | Audience persona + Story Agent |
| 3 | **Human Subject** | Protagonist, **verbatim-consistent across all scenes** | role + age range + wardrobe + defining trait | yes (every scene) | Audience Agent blueprint |
| 4 | **Action** | What the subject does this beat | active verb phrase | yes | Story Agent (beat) |
| 5 | **Emotional State** | Named mood for this beat | `overwhelmed \| frustrated \| tense \| curious \| hopeful \| focused \| confident \| decisive \| relieved \| proud` | yes | Story Agent (arc) |
| 6 | **Lighting** | Light design | `golden-hour fading to blue`, `cool screen glow`, `warm key light`, `single-source reveal`, `golden-hour aerial` | yes | Story Agent + Visual Style |
| 7 | **Render Quality** | Fidelity constant | **fixed:** `photorealistic, 4K, cinematic color grade` | yes *constant* | Builder constant |
| 8 | **Depth of Field** | Lens character | `shallow depth of field` (default) `\| deep focus` (aerial/scale only) | yes | Visual Style (default shallow) |
| 9 | **Brand Accent Treatment** | Palette as **accent lighting + grade**, never the subject's color | `[primary] and [accent] accent lighting, [mood] color grade` | yes | `brands.visual_world` palette |
| 10 | **Camera Motion** | The move | `slow push-in \| aerial descent \| slow dolly \| handheld (urgency only) \| slow reveal \| sweeping aerial \| slow motion` | yes | Story Agent (pacing) |

### 1.2 Canonical assembly order

```
Cinematic [1 Shot Type] [10 Camera Motion] of [3 Human Subject] [4 Action]
in [2 Environment], mood is [5 Emotional State], [6 Lighting],
[7 photorealistic, 4K, cinematic color grade], [8 Depth of Field],
[9 Brand Accent Treatment], [10 Camera Motion — restated as the closing move toward the focal point]
```

**Worked assembly (Cardinal Scene 1, reverse-engineered to the contract):**
> "Cinematic aerial slowly descending of a lone real-estate operator at a cluttered desk surrounded by stacked papers and multiple monitors in a lit window of a house in a dense residential neighborhood at dusk, mood is overwhelmed and isolated, golden-hour light fading to deep blue, photorealistic, 4K, cinematic color grade, shallow depth of field, deep muted tones, slow cinematic push-in toward the window."

### 1.3 NEGATIVE prompt rules

**Universal negative (appended to EVERY scene):**
```
on-screen text, captions, subtitles, letters, words, numbers, logos, brand marks,
watermarks, readable UI text, fake dashboards with legible labels, distorted or extra
hands/fingers, deformed faces, stock-footage look, generic "tech" visuals,
abstract geometric shapes, tunnels, corridors, floating structures, particle voids,
bright saturated cartoon colors, fast cuts
```

**Conditional additions:**
- Scene with empty Human Subject (slot 3) → **hard-block**; fail back to Story Agent.
- Reveal/Proof showing a screen → add `no legible text on screen, no readable menus or labels`.
- CTA beat → **no Seedance prompt at all** (deterministic FFmpeg endcard).

---

## 2. Beat Matrix

Seven beats. **CTA is rendered by the certified FFmpeg endcard — it has NO Seedance prompt** (eliminates the only fabricated-logo risk in the benchmark). Beat order follows the verified Cardinal arc (**Outcome before Proof**).

| Beat | Emotional state | Camera style | Pacing | Lighting | Motion | Subject behavior |
|---|---|---|---|---|---|---|
| **Hook** | curious / arrested | aerial or extreme CU | fastest land (≤2–3s) | high-contrast, striking | quick push-in / descent | a single striking human moment that stops the scroll |
| **Problem** | overwhelmed / isolated | wide or medium | deliberate | cool, flat, dim | slow push-in | protagonist buried in status-quo chaos |
| **Visualized Pain** | frustrated / tense | close-up / over-shoulder | rising | harsh screen glow, shadows | **handheld (only beat allowed)** | hands scrolling frantically; pain made tangible |
| **Reveal** *(keystone, longest)* | curious → hopeful → focused | medium → slow push toward screen, subject in-frame | **longest (7–8s)** | single-source / warm key entering | slow cinematic reveal | protagonist **leans forward** as the product resolves the chaos |
| **Outcome** | confident / decisive / proud | medium close-up on face | warm dwell | warm key, golden highlights | slight slow-motion | protagonist wins — nods, smiles, acts decisively |
| **Proof** | assured / awe | sweeping aerial / wide | expansive | golden-hour, epic | sweeping aerial | scale shown over a real region/city (optional human in frame) |
| **CTA** | resolved (no scene) | — *(deterministic endcard)* | shortest (3–4s) | palette gradient | — | **N/A — FFmpeg renders real logo + CTA text** |

**Duration weighting (≤8s hard cap, variable):** Hook 3–4s · Problem 4–5s · Pain 4–5s · **Reveal 7–8s** · Outcome 5s · Proof 5s · CTA card 3–4s.

---

## 3. Industry Examples

Each industry defines a **protagonist blueprint** (slot 3, reused verbatim) + environment vocabulary.

| Industry | Protagonist blueprint (slot 3) | Environment vocab (slot 2) |
|---|---|---|
| **B2B SaaS** | "a focused product manager, late 30s, smart-casual, sleeves rolled" | open-plan tech office, glass meeting room, dual-monitor desk |
| **CRM** | "a sales director, 40s, blazer, confident posture" | sales floor, glass office, late-night deal room |
| **Project Management** | "a delivery lead, 30s, casual button-down, multitasking" | busy agency bullpen, sticky-note wall, standup area |
| **Marketing Agency** | "a creative director, 30s, expressive, stylish" | studio loft, mood-board wall, edit bay |
| **Partnership Platform** | "a partnerships manager, 30s–40s, polished, relational" | modern office, video-call wall, networking lounge |
| **Real Estate** | "a real-estate operator, 40s, sharp business-casual" | home office at dusk, control-room display, regional aerial |
| **Home Services** | "a field operations owner, 40s, branded polo, hands-on" | dispatch office, work van, customer driveway/jobsite |

**B2B SaaS — full 3-beat worked example** (palette indigo `#5e6ad2` / accent `#7170ff`):

- **Hook:** "Cinematic extreme close-up slow push-in of a focused product manager, late 30s, sleeves rolled, rubbing her temples at a dual-monitor desk overflowing with overlapping windows, in an open-plan tech office at early morning, mood is overwhelmed, cool blue window light, photorealistic, 4K, cinematic color grade, shallow depth of field, subtle indigo accent lighting, deliberate slow push-in."
- **Reveal (keystone, 7–8s):** "Cinematic medium shot slow push toward the screen of the same product manager leaning forward with dawning focus in a glass meeting room at night, a sleek dark dashboard resolves the chaos into one calm view with glowing data points cascading across a clean board (no legible text), mood is hopeful turning to focused, warm key light entering from the screen, photorealistic, 4K, cinematic color grade, shallow depth of field, indigo and violet accent lighting premium SaaS aesthetic, slow cinematic push-in."
- **Outcome:** "Cinematic medium close-up slight slow-motion of the product manager, confident and relieved, closing her laptop and smiling as colleagues collaborate calmly behind her, in a tidy modern office at golden hour, mood is decisive and proud, warm golden key light, photorealistic, 4K, cinematic color grade, shallow depth of field, indigo accent highlights, gentle dolly-in."

**Reveal (keystone) for the remaining six:**

- **CRM:** "Cinematic medium shot slow push toward the screen of a sales director in a blazer leaning in with conviction in a late-night glass deal room, a dark pipeline board lights up deal-by-deal with glowing scored nodes (no legible text), mood is focused and assured, warm screen glow, photorealistic, 4K, cinematic color grade, shallow depth of field, brand red-and-gold accent lighting premium aesthetic, slow cinematic push-in."
- **Project Management:** "Cinematic medium shot slow reveal of a delivery lead exhaling with relief in a busy agency bullpen, a chaotic sticky-note wall behind dissolves into one clean glowing flow board (no legible text), mood is hopeful and focused, soft daylight plus warm key, photorealistic, 4K, cinematic color grade, shallow depth of field, brand accent lighting, slow dolly-in."
- **Marketing Agency:** "Cinematic medium shot slow push of a creative director, expressive, leaning toward a large display where scattered campaign assets converge into one organized glowing canvas (no legible text), in a studio loft at dusk, mood is curious turning confident, motivated practical lighting, photorealistic, 4K, cinematic color grade, shallow depth of field, brand accent lighting, slow cinematic push-in."
- **Partnership Platform:** "Cinematic medium shot slow reveal of a partnerships manager smiling as a video-call wall and a glowing network graph of connected partner nodes light up around her (no legible text), in a modern office at night, mood is hopeful and assured, warm key with cool rim, photorealistic, 4K, cinematic color grade, shallow depth of field, brand accent lighting, slow push-in."
- **Real Estate:** "Cinematic medium shot slow push toward the screen of a real-estate operator leaning forward with focus replacing frustration in a dark home office, a regional map lights up property-by-property in glowing scored points (no legible text), mood is decisive, rich screen glow, photorealistic, 4K, cinematic color grade, shallow depth of field, cardinal-red and gold accent lighting premium fintech aesthetic, slow cinematic push-in."
- **Home Services:** "Cinematic medium shot slow reveal of a field operations owner in a branded polo nodding with relief in a dispatch office, a wall map lights up with glowing dispatched-job markers across a city (no legible text), mood is confident, warm overhead light, photorealistic, 4K, cinematic color grade, shallow depth of field, brand accent lighting, slow dolly-in."

---

## 4. Platform Variations

The Platform Agent compresses the 6 scene-beats into the platform's scene-count, reallocates duration, sets framing/energy.

| Platform | Aspect | Scenes (beat map) | Hook lands | Pacing/energy | Framing note |
|---|---|---|---|---|---|
| **TikTok** | 9:16 | 4 — Hook+Problem · Pain · Reveal · Outcome+CTA | ≤2–3s | kinetic, punchy | subject centered in mid-60% (avoid bottom UI + right rail) |
| **Instagram Reels** | 9:16 | 4 — Hook · Pain · Reveal · Outcome+CTA | ≤3s | dynamic | tighter shots; faces upper-center |
| **YouTube Shorts** | 9:16 | 5 — Hook · Problem · Reveal · Outcome · Proof+CTA | ≤2s | retention-first | strong first frame |
| **LinkedIn** | 16:9 | 6 — full arc (Cardinal native) | ≤5s | **gravitas, slow/deliberate** | wide cinematic; room to breathe |
| **YouTube Standard** | 16:9 | 7–8 — full arc + Demonstration (+ optional Why-Now) | ≤5s | narrative, slowest | longest dwell on Reveal/Proof |

**Invariant across platforms:** the 10-slot grammar, the human subject, the negative rules, and ≤8s/scene never change — only shot scale, scene count, duration allocation, and pacing language vary.

---

## 5. Human-First Rules (hard requirements)

- **HR-1 — Every generated scene MUST contain a human subject.** Empty slot 3 → reject before generation.
- **HR-2 — Prohibited subjects:** geometric tunnels, abstract corridors, floating structures, particle voids, neural-line voids *as subject*, generic "tech" visuals, stock-footage look, data-sphere-with-no-human.
- **HR-3 — The metaphor is subtext, never the subject.**
- **HR-4 — Real, named environments only.** "Void / abstract space / digital realm" banned.
- **HR-5 — Brand palette appears only as accent lighting / color grade** (slot 9), never as the color of abstract shapes.
- **HR-6 — Camera moves must be motivated.** Generic ken-burns drift banned.

---

## 6. Product Demonstration Rules

**Three allowed techniques** (always with a human in/reacting to frame):
1. **Abstract data-visualization** — glowing data points, lit map markers, cascading nodes, a clean resolving board — read as **form, not words**.
2. **Environmental interaction** — product on a real device being **used** by the protagonist.
3. **Human reaction** — protagonist leans in / nods / smiles at the product.

**Hard prohibitions (negative on any product/screen scene):**
- Synthetic UI text (no legible menus, labels, numbers, copy).
- Synthetic logos (real logo composited later in FFmpeg).
- Fake dashboards with readable content (must read as glowing abstract data-viz).

**PD-1:** any Reveal/Proof scene showing a screen MUST keep the **human in frame reacting** — never the dashboard alone.

---

## 7. FMEA — Prompt Builder failure modes (S×O×D)

| ID | Failure mode | S | O | D | RPN | Control |
|---|---|---|---|---|---|---|
| FM-1 | Slot-3 unresolved → subjectless abstract scene | 9 | 5 | 4 | **180** | Hard-reject empty slot 3; Quality gate pre-spend |
| FM-2 | Reveal shows dashboard alone (human dropped) | 8 | 5 | 4 | **160** | PD-1: human-in-frame mandatory |
| FM-3 | Negative weakened → on-screen text/fake logo | 7 | 4 | 5 | **140** | Non-removable universal negative; gate flags text |
| FM-4 | Protagonist drifts between scenes | 6 | 6 | 3 | **108** | Slot 3 frozen + verbatim + shared seedFamily |
| FM-5 | Uniform durations (Reveal not weighted) | 5 | 6 | 3 | **90** | Beat-Matrix duration weighting; Reveal 7–8s |
| FM-6 | Palette as shape color, not accent light | 6 | 4 | 3 | **72** | Slot-9 grammar restricts palette to accent light |
| FM-7 | Scene > 8s slips through | 8 | 2 | 2 | **32** | ≤8s clamp (3 layers, already enforced) |
| FM-8 | Handheld outside Pain beat | 3 | 4 | 3 | **36** | Camera vocab restricts handheld to Pain |

Ranking: FM-1 > FM-2 > FM-3 > FM-4 > FM-5 > FM-6 > FM-8 > FM-7. Top three are abstraction/text leakage — the defect class this spec eliminates.

---

## 8. Certification Criteria — PASS/FAIL for Story Agent renders

Extends (does not replace) the V1 compose checklist (A–H). PASS only if **every** check passes.

| # | Criterion | PASS condition | Method | Hard-fail |
|---|---|---|---|---|
| C1 | Human presence | every scene has a recognizable human | frames | yes |
| C2 | No abstraction | zero tunnels/shapes/voids/generic-tech | frames | yes |
| C3 | Real environment | every scene a nameable real place | frames | yes |
| C4 | Protagonist continuity | same role/wardrobe across scenes | cross-scene | no (regen) |
| C5 | No synthetic text/logo | no legible UI text, generated logos, watermarks | frames (zoom) | yes |
| C6 | Emotional arc | mood progresses cold→warm | frames + grade | no |
| C7 | Beat completeness & order | required beats present, in order, Reveal longest | storyboard + ffprobe | no |
| C8 | ≤8s/scene | no scene exceeds 8.0s | ffprobe | yes |
| C9 | Product shown human-first | product scene keeps human in/reacting | frames | yes |
| C10 | Deterministic CTA | CTA is FFmpeg endcard, not a generated scene | compose | yes |
| C11 | Face/hand integrity | no distorted faces or extra/merged fingers | frames | no (regen) |
| C12 | Platform fit | aspect + duration within platform envelope | ffprobe + profile | yes |

**FAIL = any single criterion fails.** C2/C5/C9 are hard fails (the core defect) and may not be waived. C11/C4 are single-scene-regen remediable.

---

*Canonical Prompt Builder specification. Defines what the future Story Agent must generate and how its renders are judged. No code, no implementation.*
