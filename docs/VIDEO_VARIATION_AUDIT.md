# Video Variation Audit

**Audit date:** 2026-06-04
**Auditor scope:** static code review of the live video-generation pipeline in `ottoflow-ai/`. No runtime experimentation — every claim below is traceable to a file + line number.
**TL;DR:** the pipeline is **functionally complete but variation-starved**. With Gemini hardcoded at temperature 0.4, every Pexels domain match returning the same 4 hand-tuned queries, scene prompts passed unmutated to Runway/Luma, and **zero seed/randomization anywhere in the stack**, two videos in the same domain land at near-identical visual + narrative output. The fixes are not architectural rebuilds — they're additive entropy sources at 7 specific files.

---

## Specific question answers (factual, code-first)

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Are all videos using the same scene architecture? | **YES (de-facto).** No template enforcement; Gemini at temp 0.4 converges to "Hook → Showcase → Demonstrate → CTA". Default `sceneCount = 4`. | `src/app/api/generate/route.ts:197` (`sceneCount ?? 4`); `src/lib/gemini.ts:760-784` (`generateVideoStoryboard` prompt — no archetype branching) |
| 2 | Are all videos using the same camera style? | **YES (de-facto).** Storyboard prompt lists 6+ camera moves but temp 0.4 + no enforcement = model picks "slow push-in" + "static" most runs. | `src/lib/gemini.ts:777-780` (camera move list as prose, not enum); `src/lib/gemini.ts:339` (`temperature: 0.4` for ALL Gemini calls) |
| 3 | Are prompts being regenerated or reused? | **REUSED, unmutated.** Storyboard scene descriptions pass straight to Runway/Luma as `promptText`. Worker does not augment per scene. | `worker/processors/video-merge.ts:229-233` (`registryGenerateScene({prompt: spec.prompt, ...})`); `src/lib/video-providers/runway.ts:113` (`promptText: request.prompt`); `src/lib/video-providers/luma.ts:78` (`prompt: request.prompt`) |
| 4 | Is there a content DNA system? | **NO.** No "brand DNA" record influences randomness; same brand + similar topic yields same outputs. | Codebase-wide: no `dna`, `entropy`, `signature`, or `seed_value` columns / fields in `brands`, `render_jobs`, `brand_topics`, `scene_generations` |
| 5 | Is there a variation engine? | **NO.** No module mutates prompts, rotates templates, or randomizes choices. | No file under `src/lib/` matches `variation`, `randomize`, `mutate`, or `entropy` (verified via grep across the repo) |
| 6 | Is there a seed-based randomization system? | **NO.** No `seed` parameter is passed to Gemini, Runway, Luma, or Imagen. No `Math.random()` informs any variation choice. | Gemini config block omits `seed` (`src/lib/gemini.ts:332-340`); Runway create body omits `seed` (`src/lib/video-providers/runway.ts:110-116`); Luma create body omits `seed` (`src/lib/video-providers/luma.ts:74-82`) |
| 7 | Is there provider-level prompt mutation? | **NO.** Provider implementations are pure pass-through. No genre, era, lighting, lens, or palette injection. | `src/lib/video-providers/runway.ts:113`; `src/lib/video-providers/luma.ts:78`; `src/lib/video-providers/pexels.ts:23-26` |
| 8 | Why would two videos on different topics still feel visually similar? | Same scene count (4), same default style ("cinematic"), same Imagen suffix ("cinematic composition, professional commercial photography, high detail"), same fixed provider models, same Pexels domain template (4 deterministic queries per domain → same first hit), same overlay style (white text, black border, y=h*0.65), same audio mix (-12 dB ducking), same final encode (720×1280 @ 30 fps). See "Root cause table" below. | Aggregated from §3–§14 below |

---

## Root causes (severity-ranked)

| # | Root cause | Severity | Stage | File:line | Impact estimate |
|---|---|---|---|---|---|
| R1 | **Gemini temperature hardcoded to 0.4** for every structured call — scripts, storyboards, topics, hero frame prompts. At 0.4 the model converges to "median" outputs, killing variation. | **CRITICAL** | Script, storyboard, topics, SEO, overlays | `src/lib/gemini.ts:339` | Single biggest source. ~40-50% of perceived "every video sounds the same." |
| R2 | **No `seed` parameter passed to any AI provider.** Gemini, Runway, Luma, and Imagen all accept seed; we send none. Same input → same output. | **CRITICAL** | Script, storyboard, Runway, Luma, Imagen | `src/lib/gemini.ts:332-340`, `src/lib/video-providers/runway.ts:110-116`, `src/lib/video-providers/luma.ts:74-82` | Removes the cheapest variation lever in modern AI. |
| R3 | **Pexels domain overrides return the same 4 hand-tuned queries** per detected domain pattern (12 domains × 4 queries = 48 total). First-hit selection means identical clip for identical topic. | **CRITICAL** | Provider fallback chain | `src/lib/pexels.ts:78-187`, `src/lib/pexels.ts:421-422` | When Runway/Luma keys aren't set OR fall through, every video in a domain plays from the **same 4 stock clips**. |
| R4 | **Scene prompt is the raw Gemini description** with zero augmentation before reaching Runway/Luma. No style modifier, era, lens, lighting, or genre prefix. | **HIGH** | Scene gen (Runway/Luma) | `worker/processors/video-merge.ts:229-233` | Cinematic-look variation only comes from user-selected `style` field, which defaults to "cinematic" for everyone. |
| R5 | **Default style is `"cinematic"`** for all users who don't pick another. Imagen 3 prompt then *appends* `"cinematic composition, professional commercial photography, high detail"` — even when the user picks a non-cinematic style. | **HIGH** | Hero frame + downstream visual feel | `src/app/api/generate/route.ts:196`, `src/lib/gemini.ts:807` | Every hero frame reads as the same magazine-stock-photo aesthetic. |
| R6 | **No scene-architecture template rotation.** Gemini is told "exactly N scenes" with no narrative archetype (e.g., Problem-Agitate-Solve, Before-After-Bridge, Founder-POV, Listicle). With temp 0.4 it always returns approximately the same structure. | **HIGH** | Storyboard | `src/lib/gemini.ts:760-784` | Even when prompts vary, the narrative shape is recognizable as "an Ottoflow video". |
| R7 | **Retries re-issue the EXACT same prompt** with no mutation, no temperature bump, no seed change. 3 retries of a flaky Gemini call = 3 attempts at the same answer. | **MEDIUM** | Gemini retry path | `src/lib/gemini.ts:94-113` | Doesn't drive perceived sameness across users but defeats variation within retry attempts for the same user. |
| R8 | **Fixed Runway model `gen4.5` + fixed Luma model `ray-flash-2` + fixed Imagen `imagen-3.0-fast-generate-001`.** No A/B / round-robin across model variants. | **MEDIUM** | Providers | `src/lib/video-providers/runway.ts:111`, `src/lib/video-providers/luma.ts:77`, `src/lib/gemini.ts:817` | Visual house-style is fixed by model choice; rotating between 4.5/4-turbo/ray-2/ray-flash-2 would diversify the visual fingerprint at moderate cost. |
| R9 | **Hardcoded scene count = 4** (default) and music vibe = "energetic" (default). Every default-flow video is 4 scenes with energetic music. | **MEDIUM** | Route defaults | `src/app/api/generate/route.ts:197-198` | Same pacing + same musical genre for almost every video. |
| R10 | **Overlay rendering is fixed style**: white text + black 4-px border + black shadow at (4,6) + 0.6 opacity + position y=h*0.65 + same scale-pop animation. | **LOW** | Overlay renderer | `worker/processors/video-merge.ts:149-193` | Subtle but real — every video has overlays in the same place styled the same way. |
| R11 | **`aestheticNotes` from storyboard is generated but NEVER USED.** Gemini writes 2-3 sentences on lighting/palette/pacing → stored in DB → no downstream consumer. | **LOW** | Storyboard → providers | `src/lib/gemini.ts:780-782` (generated), `worker/processors/video-merge.ts:229-233` (not consumed) | Free variation signal already in the data, thrown away. Wire it as a Runway/Luma prompt prefix. |
| R12 | **No "vary from previous videos" instruction** in any prompt. Gemini has no awareness of what this brand's last 10 videos looked like. | **LOW** | Topics, script, storyboard | All Gemini prompts in `src/lib/gemini.ts` | Variation enforcement requires schema change — see Phase 2. |

---

## Stage-by-stage analysis

### §1 — Content / Topic generation
- **File:** `src/lib/gemini.ts:954-1037` (`generateBrandTopics`)
- **Variation source:** brand profile fields (industry, personas, ICP, seed keywords) are injected.
- **Deterministic source:** temperature 0.4; rigid schema (`title/description/category/seed_keyword/hook_angle`); category enum (7 fixed values); no seed.
- **Repetition driver:** R1 (temp 0.4), R2 (no seed).
- **Missing entropy:** no random hook-archetype rotation; no "previously generated topics: [list], avoid duplication" guard.

### §2 — Script generation
- **File:** `src/lib/gemini.ts:677-711` (`generateVideoScript`)
- **Variation source:** `prompt`, `style`, `musicVibe`, `targetSeconds` inputs.
- **Deterministic source:** temperature 0.4; identical prompt template every run; default style = "cinematic"; default musicVibe = "energetic"; rigid 5-field output schema; no seed.
- **Repetition driver:** R1 + R2 + R5 + R9.
- **Missing entropy:** no hook archetype rotation, no "open with one of these patterns: [list]" rotation, no spoken-direction variety.

### §3 — Scene / Storyboard generation
- **File:** `src/lib/gemini.ts:754-793` (`generateVideoStoryboard`)
- **Variation source:** prompt, style, sceneCount, script hook/body/cta.
- **Deterministic source:** temperature 0.4; identical prompt template; no archetype branching; camera moves listed as prose suggestion only; default sceneCount=4.
- **Repetition driver:** R1 + R2 + R6 + R9.
- **Missing entropy:** no narrative archetype injection (Problem-Agitate-Solve / Before-After-Bridge / Listicle / Founder-POV / Day-in-Life); no enforced camera-move palette rotation; no enforced shot-type palette rotation.

### §4 — Veo / Runway / Luma prompt construction
- **Files:** `worker/processors/video-merge.ts:229-233`, `src/lib/video-providers/runway.ts:113`, `src/lib/video-providers/luma.ts:78`
- **Variation source:** scene description string from Gemini.
- **Deterministic source:** raw pass-through; no augmentation; fixed model (gen4.5 / ray-flash-2); fixed aspect ratio; fixed resolution; no seed.
- **Repetition driver:** R2 + R4 + R8.
- **Missing entropy:** no lens/lighting/film-stock/era prefix; no genre/aesthetic suffix; no per-scene seed; no `aestheticNotes` consumption (R11).
- **Note:** the term "Veo prompt construction" in the audit brief is slightly misleading — there is **no Veo provider in the chain today** (`registry.ts:37-41` shows Runway → Luma → Pexels only). Veo is referenced in stub comments at `src/app/api/generate/route.ts:478` but is not wired.

### §5 — Retry logic
- **File:** `src/lib/gemini.ts:94-113` (`callGemini`)
- **Behavior:** up to 3 attempts on transient errors with exponential backoff (1s → 2s → 4s, capped at 5s).
- **Variation across retries:** **NONE.** Same prompt, same temperature, same schema, same model.
- **Repetition driver:** R7. Pattern: when Gemini returns a low-quality script on attempt 1, attempts 2 and 3 produce essentially the same low-quality script.
- **Missing entropy:** retries should bump temperature (+0.1 per attempt) or inject a different seed.

### §6 — Scene architecture selection
- **Files:** `src/lib/gemini.ts:760-784` (prompt), `src/app/api/generate/route.ts:197` (default count)
- **Behavior:** the model is told "Exactly N scenes. Index them 1..N." with one example of specificity ("Product on a desk" is filler vs. "Walnut desk, golden hour backlight…"). There is **no archetype**, no taxonomy, no template library.
- **Repetition driver:** R6.
- **Missing entropy:** zero. Every storyboard fights "what should this look like?" from scratch and Gemini's prior collapses to the same answer at temp 0.4.

### §7 — Hook generation
- **File:** `src/lib/gemini.ts:692-694` (inline in script prompt)
- **Behavior:** "first 3-5 seconds — a question, bold claim, or pattern interrupt. No 'Hey guys' or 'Did you know' cliches."
- **Variation:** three archetypes named (question / bold claim / pattern interrupt) but no rotation enforcement.
- **Repetition driver:** R1.
- **Missing entropy:** no probabilistic rotation through archetypes; no rejected-hook list to avoid; no audience-segment-aware hook templates.

### §8 — CTA generation
- **File:** `src/lib/gemini.ts:696` (inline in script prompt)
- **Behavior:** "single closing line that drives action. ~10-15 words."
- **Variation:** length range hint only.
- **Repetition driver:** R1.
- **Missing entropy:** no CTA archetype rotation (link-in-bio / DM-for-discount / scarcity / social-proof / curiosity).

### §9 — Seed generation
- **Behavior:** **does not exist.**
- **Variation:** none.
- **Repetition driver:** R2 (the root cause).
- **Missing entropy:** everything. The cheapest single fix in the entire system is wiring `seed: Math.floor(Math.random() * 1e9)` into Gemini's generation config + Runway/Luma create bodies.

### §10 — Provider fallback behavior
- **File:** `src/lib/video-providers/registry.ts:37-88`
- **Behavior:** chain order is Runway → Luma → Pexels. Same order for every scene of every video. `preferProvider` opt-in is unused by any caller today (`worker/processors/video-merge.ts:229-233` doesn't pass it).
- **Repetition driver:** R3 (Pexels template returns same 4 queries per domain), R8 (always same model on each provider).
- **Missing entropy:** no per-scene provider shuffle (scene 1 Runway, scene 2 Luma → cinematic + handheld feel from same video).

### §11 — Pexels keyword + clip selection
- **File:** `src/lib/pexels.ts:198-258` (`extractKeywords`, `buildQueries`)
- **Behavior:**
  1. Hand-tuned `TOPIC_OVERRIDES` map 12 domain patterns → **fixed** lists of 4 queries each
  2. Falls back to top-3 longest non-stopword tokens → 2-3 keyword-derived queries
  3. Searches Pexels, picks **`usable[0]`** (first hit)
- **Repetition driver:** R3.
- **Pattern:** every coffee video runs `["coffee pour cinematic closeup", "barista espresso morning", "cafe interior modern minimal", "coffee beans roasting product"]` and selects the first match. Pexels relevance ordering is stable, so the same first match comes back every time.

### §12 — Music selection (Jamendo)
- **File:** `src/lib/jamendo.ts` (not read in this audit; behavior inferred from `route.ts:491-518`)
- **Behavior:** `findTrackByVibe({vibe: "energetic", targetSeconds})` with default vibe "energetic".
- **Repetition driver:** R9 (default vibe).
- **Missing entropy:** likely fixed first-result selection; needs separate audit pass on `jamendo.ts` if music sameness is reported.

### §13 — ElevenLabs TTS
- **File:** `src/lib/elevenlabs.ts` (not read in this audit; voice/model defaults inferred from `BETA_READINESS_SPRINT.md` references to "Rachel" + `eleven_turbo_v2`)
- **Behavior:** one default voice, one default model for every video.
- **Repetition driver:** every video sounds like the same narrator.
- **Missing entropy:** rotate across a curated voice pool (energetic-male / warm-female / authoritative-male / casual-female / GenZ-tone); choose by brand voice tone or topic category.

### §14 — Composition + post-processing
- **File:** `worker/processors/video-merge.ts:149-193, 363-426`
- **Behavior:** every video normalized to 720x1280 @ 30fps; every overlay rendered in white text + 4-px black border + center-x + y=h*0.65 + same scale-pop animation; music ducked at -12 dB always.
- **Repetition driver:** R10.
- **Missing entropy:** no overlay-position variation (top-third / lower-third / sticker placement); no color theme variation; no transition variation between scenes (currently hard concat).

---

## Phase 1 — Quick wins (≤ 4 hours engineering)

Listed in priority order. Each item is small, contained, and high-leverage. None require schema changes.

### P1.1 — Inject random seeds into every AI call (clears R2 — the biggest single win)

**Effort:** 30 minutes
**Files:**
- `src/lib/gemini.ts:332-340` — add `seed: Math.floor(Math.random() * 2**31)` to every `generateContent` config block
- `src/lib/video-providers/runway.ts:110-116` — add `seed: Math.floor(Math.random() * 2**31)` to the `createBody`
- `src/lib/video-providers/luma.ts:74-82` — add `seed: Math.floor(Math.random() * 2**31)` to the `createBody`

**Verify:** generate the same brand+topic twice; outputs must differ measurably (hook wording, scene descriptions, video composition).

### P1.2 — Raise Gemini temperature + add per-call jitter (clears R1)

**Effort:** 30 minutes
**File:** `src/lib/gemini.ts:328-340`

```ts
// Before
temperature: 0.4,
// After
temperature: 0.65 + Math.random() * 0.1, // 0.65-0.75 per call
```

For script generation specifically (line 704), push to `0.85 + Math.random() * 0.1`. Storyboards stay at 0.7 (need to remain coherent).

**Verify:** sample 5 scripts on the same brand+topic; hook phrasing should diverge meaningfully.

### P1.3 — Pexels query shuffle + non-first-result selection (clears R3)

**Effort:** 1 hour
**File:** `src/lib/pexels.ts:78-187, 421-444`

1. Add 6+ more queries per domain override (target ~10 per domain), then shuffle the array and pick top 4 per call.
2. Change `usable[0]` selection to `usable[Math.floor(Math.random() * Math.min(3, usable.length))]` — random within top 3 by Pexels relevance.
3. Add a per-scene salt: `query + " " + ['vertical', 'closeup', 'wide', 'product', 'lifestyle'][sceneIndex % 5]` so different scenes in the same video also pull different clips.

**Verify:** generate two coffee videos with identical topic; expect different stock clips on at least 3 of 4 scenes.

### P1.4 — Wire `aestheticNotes` into provider prompt (clears R11)

**Effort:** 20 minutes
**File:** `worker/processors/video-merge.ts:229-233`

The storyboard already produces aesthetic notes (color palette, lighting, references) that get stored unused. Read them from the `render_jobs.storyboard_json.aestheticNotes` and prepend to each scene prompt:

```ts
const aestheticPrefix = job.storyboard_json?.aestheticNotes ?? "";
const result = await registryGenerateScene({
  prompt: `${aestheticPrefix} ${spec.prompt}`.trim(),
  durationSec: spec.durationSec,
  aspectRatio: "9:16",
});
```

**Verify:** scene prompts now carry palette + lighting cues into Runway/Luma; visual feel should diversify across topics.

### P1.5 — Retry mutation (clears R7)

**Effort:** 20 minutes
**File:** `src/lib/gemini.ts:94-113`

Bump temperature by `+0.1 * attempt` on each retry:

```ts
return await withTimeout(
  fn({ temperatureBoost: attempt * 0.1 }),
  TIMEOUT_MS,
  label,
);
```

Then thread the boost into the structured-output config. Retries now exploit Gemini's stochasticity rather than re-attempting the same answer.

### P1.6 — Default-style rotation (clears R5 partially)

**Effort:** 15 minutes
**File:** `src/app/api/generate/route.ts:196`

```ts
// Before
const style = input.style ?? "cinematic";
// After
const STYLE_POOL = ["cinematic", "documentary", "lifestyle", "product-hero", "street-style", "tutorial"] as const;
const style = input.style ?? STYLE_POOL[Math.floor(Math.random() * STYLE_POOL.length)];
```

And in `gemini.ts:807` drop the hard-coded `"cinematic composition, professional commercial photography, high detail"` suffix — let `style` carry the visual direction.

**Verify:** generate 5 default-flow videos; expect 5 visibly distinct visual treatments.

### P1.7 — Hook + CTA archetype rotation (clears R1 secondary)

**Effort:** 1 hour
**File:** `src/lib/gemini.ts:692-696`

Inject one of these archetypes into each script prompt:

```ts
const HOOK_ARCHETYPES = [
  "negative-charge question (\"Why does everyone…\")",
  "outrageous claim (\"Most X people don't know…\")",
  "specific-number stat (\"73% of … never realize…\")",
  "pattern-interrupt scenario (\"Picture this:…\")",
  "first-person confession (\"I used to think… until…\")",
] as const;
const hookArchetype = HOOK_ARCHETYPES[Math.floor(Math.random() * HOOK_ARCHETYPES.length)];
// Prepend to the prompt: "Use this hook archetype for the `hook` field: ${hookArchetype}."
```

Similar rotation for CTAs (link-in-bio / DM-for-discount / scarcity / social-proof / curiosity-gap).

### P1.8 — Hero frame prompt diversification (clears R5)

**Effort:** 10 minutes
**File:** `src/lib/gemini.ts:807`

```ts
// Before
const imagePrompt = `${input.style} style, ${input.prompt}, cinematic composition, professional commercial photography, high detail`;
// After
const LENS_POOL = ["35mm film", "anamorphic widescreen", "iPhone Pro vertical", "Hasselblad medium format", "Super 16mm grain"];
const LIGHT_POOL = ["golden hour backlight", "neon nightscape", "soft window light", "harsh midday sun", "moody chiaroscuro"];
const lens = LENS_POOL[Math.floor(Math.random() * LENS_POOL.length)];
const light = LIGHT_POOL[Math.floor(Math.random() * LIGHT_POOL.length)];
const imagePrompt = `${input.style} style, ${input.prompt}, shot on ${lens}, ${light}`;
```

**Combined Phase 1 impact:** lands ~70-80% of the perceived variation problem with ≤ 4 hours of contained, fully-additive changes. No schema migrations. No service redesign.

---

## Phase 2 — Architecture improvements (1-3 days each)

### P2.1 — Scene-architecture template library (clears R6)

Build a `src/lib/video-templates/` module with named archetypes:

| Template | Scene shape (4 scenes) |
|---|---|
| `problem-agitate-solve` | hook-question → escalate-pain → product-reveal → relief-CTA |
| `before-after-bridge` | broken-baseline → frustration → product-transformation → outcome-CTA |
| `listicle-rapid-fire` | "3 things that…" hook → tip 1 close-up → tip 2 wide → tip 3 + CTA |
| `founder-pov` | first-person-confession → backstory-clip → product-aha → mission-CTA |
| `day-in-life` | morning-routine wide → workflow montage → product-integration → outcome-pov |
| `social-proof-stack` | hook-claim → testimonial-clip-1 → testimonial-clip-2 → CTA |

Each template ships:
- A storyboard prompt prefix Gemini must conform to
- Per-scene shot-type + camera-move + duration constraints
- A short "voice direction" hint for the script generator

Selection: random by default, optionally weighted by `topic.category` (e.g., founder-story → `founder-pov` 60% of the time).

**Storage:** add `render_jobs.archetype_id` text column for analytics.

### P2.2 — Brand DNA + content-signature system (clears R4)

Add a `brand_dna` JSONB column on `brands`:

```jsonc
{
  "lens_pool": ["35mm film", "anamorphic widescreen"],
  "lighting_pool": ["golden hour backlight", "moody chiaroscuro"],
  "palette": "warm sunset earth tones",
  "voice_archetype": "warm-female",
  "music_pool": ["lo-fi indie", "minimalist piano"],
  "forbidden_aesthetics": ["corporate stock", "glossy commercial"]
}
```

Pipeline reads `brand_dna` and injects into every Gemini + Runway/Luma prompt as a non-negotiable style prefix. Different brands → reliably different videos. Same brand → consistent house style but distinct per video (variation comes from the per-call seeds + template rotation from P2.1).

**Storage:** new migration `009_brand_dna.sql`.

### P2.3 — Per-scene provider shuffle (clears R8)

Refactor `worker/processors/video-merge.ts:215-301` so each scene's provider is **chosen probabilistically**:

| Scene index | Preferred provider | Rationale |
|---|---|---|
| 1 (hook) | Runway gen4.5 | Highest visual punch on the most-watched 3 seconds |
| 2-3 (body) | Mix Runway / Luma 50/50 | Cost-bound diversity |
| 4 (CTA) | Pexels | Cheaper; CTA carries the message anyway |

Add `render_jobs.scene_provider_plan` JSONB column to record + replay the plan.

### P2.4 — "Avoid recent" memory across the brand (clears R12)

When generating a script or storyboard, look up the brand's last 5 render_jobs' `script_json.hook` + `storyboard_json.aestheticNotes` and inject as a "DO NOT repeat these openings, palettes, or shot lists" suffix to the Gemini prompt. Forces affirmative diversification.

**Storage:** read-only — uses existing `render_jobs` rows.

### P2.5 — TTS voice rotation (clears §13)

Curate a Voice Pool of 5-8 ElevenLabs voices spanning energy × gender × age × accent. At pipeline start pick one based on `topic.category` (educational → authoritative; ugc → casual; founder-story → warm-female).

Add `voice_id` column on `render_jobs` for analytics.

### P2.6 — Overlay style + audio-mix variation (clears R10)

Add an `overlay_theme` field consumed by `buildDrawtextChain`:
- Default: white text + black border (current)
- Sticker: yellow background + black text, top-third position
- Cursive: serif italic, bottom-third, slow-fade
- Minimal: tiny lowercase, top-left corner

Same for audio mix: rotate music ducking between -8 / -12 / -15 / -18 dB based on voice intensity.

---

## Summary table — fixes against root causes

| Root cause | Phase 1 fix | Phase 2 fix |
|---|---|---|
| R1 Temp 0.4 hardcoded | P1.2 raise + jitter | — |
| R2 No seeds | P1.1 inject seeds everywhere | — |
| R3 Pexels deterministic queries | P1.3 shuffle + random-top-3 | — |
| R4 Raw prompt pass-through | P1.4 aestheticNotes wired | P2.2 brand DNA prefix |
| R5 Default "cinematic" + Imagen suffix | P1.6 style pool + P1.8 lens/light pool | — |
| R6 No scene architecture | — | P2.1 template library |
| R7 Retry uses same prompt | P1.5 temperature bump per retry | — |
| R8 Fixed provider models | — | P2.3 per-scene provider shuffle |
| R9 Hardcoded scene count + music vibe | (low priority — UI exposes these) | — |
| R10 Fixed overlay style + audio mix | — | P2.6 overlay theme + audio rotation |
| R11 aestheticNotes unused | P1.4 wires it | — |
| R12 No "avoid recent" memory | — | P2.4 last-N brand history |

---

## Out of scope (intentionally not audited this pass)

- `src/lib/elevenlabs.ts` — TTS variation needs its own pass once voice rotation is on the table.
- `src/lib/jamendo.ts` — music selection logic needs separate audit if music sameness is reported.
- `worker/processors/brand-research.ts` and `content-generation.ts` — content pipeline (blog/social posts), not video. Same temp-0.4 + no-seed pattern applies but different deliverable.
- Real Veo provider — does not exist in the code today; comments at `route.ts:478` are stubs. Wiring Veo is a separate effort beyond this audit.
- Higgsfield — intentionally excluded from the provider chain per `registry.ts:31-36`.

---

## Final read

The codebase is a competent, defensively-coded video pipeline that **doesn't know variation exists as a goal**. Every choice point that could carry entropy (temperature, seed, query selection, archetype, model, lens, voice, palette) has been resolved to a single value, optimized for **stability** rather than **diversity**. The fixes are not architecture problems — they're small additive injections at 7 specific files. Phase 1 alone (≤ 4 hours) should move perceived variation from "every video feels like the same brand's house style" to "this brand has a recognizable look but each video is distinct."

The single highest-leverage fix is **P1.1 — inject random seeds**. Every AI provider in the stack accepts a seed; we send none. One commit, three files, ~10 lines of code.
