# OttoFlow Video V1.1 — Architecture & Implementation Plan

**Status:** Final design, pre-engineering. **Design only — no code/migrations in this doc.**
**Benchmark:** Cardinal Data Sphere example scripts (premium directed commercial).
**Authors:** Principal Architect / CTO review.
**Baseline:** Video V1 certified (cert render `b1807d29`, 4/4 Seedance, clamped duration, branded compose).

---

## 0. Thesis (read this first)

The certification proved **Seedance is not the bottleneck — the brief is.** V1 produces beautiful but *abstract* B‑roll (the Linear cert rendered labyrinths, light beams, a maze — zero humans). Cardinal produces a *directed mini‑film* with a human protagonist, real environments, a demonstration, and a conversion close.

**Every V1.1 improvement lives in the PLANNING LAYER that decides _what_ Seedance renders.** The 12 "agents" below are **not** services or queues — they are composable modules that run inside the **existing dryRun** of `POST /api/video/generate` and emit **one richer `video_strategy` jsonb**, which is consumed by the **unchanged** scene‑generation → Seedance → ffmpeg‑compose → R2 pipeline.

```
[ALL PRE-SPEND — inside the existing dryRun; no new queue/route/engine]
 Platform · Resolution (config)
 Journey · Conversion (intent)
 Research → Evidence (real proof)
 Visual Style (→ brands.visual_world)  ·  Industry Persona (→ protagonist)
 Story Template (select) → Story Agent (8-beat, metaphor→human) + Product-Demo directives
        ▼
 STORYBOARD (the enriched video_strategy)
        ▼
 Quality Engine (score 0–100, pre-render) → Storyboard Approval (user, no spend yet)
        ▼ approve
 [EXISTING] scene-generation queue → Seedance → ffmpeg-compose → R2 → MP4   (UNCHANGED)
```

### Hard constraints honored
Do NOT replace Seedance / Redis / BullMQ / Railway / Vercel. No new queues, render workflows, or engines. No broken V1 renders or cert path. All gains happen pre-render; the output remains a richer `video_strategy`.

---

## 1. Cardinal benchmark analysis

### Story structure (8 beats)
Hook → Problem → Visualized Pain → Reveal → Demonstration → Proof → Outcome → CTA.
V1's 4 beats (Problem/Tension/Solution/Outcome) **omit** the four that drive conversion: Hook, Visualized Pain, Demonstration, and a directed CTA.

### Prompt architecture (per scene)
`[shot type] [camera move] of [human subject] [subject action] in [real environment], [emotional state], [lighting], [color grade], photorealistic 4K, [motion pacing]`. V1 sends a one‑line abstract prompt → the model defaults to geometry.

- **Subject:** a recurring human (the operator), emotional arc overwhelmed → frustrated → focused → confident → decisive. V1 has **no subject**.
- **Environment:** neighborhood at dusk, cluttered desk, modern office, regional landscape — real, relatable. V1 = abstract.
- **Camera:** slow push‑ins, aerial descents, deliberate reveals. V1 = generic ken‑burns.
- **Lighting:** golden‑hour→blue, screen glow, single‑source reveals. V1 = none specified.
- **Motion:** "slow and deliberate — operator audience responds to gravitas." V1 = uniform 5s.
- **Color:** "cardinal red + gold, cream text" — brand‑coded mood. V1 = `grade:"natural"`.

### Conversion psychology — why Cardinal outperforms V1
- **Retention:** hook by 0:03 (pattern interrupt); Visualized Pain opens a curiosity gap; pacing varies by beat weight; each scene is a micro‑cliffhanger.
- **Emotional progression:** the viewer rides a single protagonist's arc (empathy / mirror‑neuron effect).
- **Persuasion structure:** extended PAS — Hook·Problem·Pain (agitate) → Reveal·Demo·Proof (solve + substantiate) → Outcome (future‑pace) → CTA.
- **Proof mechanics:** three stacked proofs — demonstration (show it work) + vicarious (protagonist wins) + evidence (real stats/outcomes).
- **CTA mechanics:** one ask, scarcity/urgency ("Pioneer Access — 10 spots"), brand reveal framing the ask, matched to buyer stage.

Viewer can answer *who / what‑problem / what‑changed / why‑care / what‑proof / what‑next* **without narration.** V1's abstract metaphors answer none.

---

## 2. Implementation plan (A–U)

### A. Architecture diagram
See §0. Platform is the root; everything from the dryRun onward is the certified path, untouched.

### B. Platform Agent (root, deterministic config)
Runs first; emits **four bundles**: Video, Content, Story, and a Research lens.

| Platform | Aspect | Default res | Target dur | Scenes | Max scene | Pacing / hook |
|---|---|---|---|---|---|---|
| TikTok | 9:16 | 720p | 15–34s | 4–6 | 7s | punchy, hook ≤3s |
| Instagram Reels | 9:16 | 720p | 15–30s | 4–6 | 7s | dynamic, hook ≤3s |
| YouTube Shorts | 9:16 | 720p | 20–40s | 5–7 | 8s | retention, hook ≤2s |
| YouTube Standard | 16:9 | 720p (1080p rec.) | 30–90s | 5–8 | 8s | slower, narrative |
| Instagram Feed | 1:1 | 720p | 15–30s | 4–6 | 7s | moderate |
| Facebook Feed | 1:1 / 16:9 | 720p | 15–45s | 4–6 | 7s | moderate |
| LinkedIn | 1:1 / 16:9 | 720p | 30–60s | 5–7 | 8s | gravitas (Cardinal) |
| X | 16:9 | 720p | 15–45s | 4–6 | 6s | hook ≤2s |

**Content constraints** (drive content gen so nothing truncates): per‑platform caption/post caps, hashtag count, CTA style, word count, reading time (TikTok ~100 visible/3–5 tags; LinkedIn ~140 before "see more"/3–5 tags; X 280/1–2 tags; etc.).
**Story constraints:** hook style, proof style, CTA style, emotional style per platform.
**Safe text area:** 9:16 → central 60–70% height (avoid bottom ~15% UI + TikTok right ~12% rail); 1:1/16:9 → central ~90%. On‑screen caption ≤~24 chars/line, ≤2 lines.
**Hard rule:** no scene > 8s; prefer 3–7s.

### C. Resolution Agent
| Choice | Pixels | Production | Cost | Storage |
|---|---|---|---|---|
| **720p** (default) | 1280×720 / 720×1280 | native Seedance | ~$0.24/s (calibrated) | ~20 MB/render |
| 1080p | 1920×1080 / 1080×1920 | native Seedance | ~2× | ~2× |
| 4K UHD | 3840×2160 | 1080p **+ upscale** (experimental) | 1080p + upscale step | ~4× |

720p stays default: native, lowest cost, highest throughput, cert‑proven, and story/conversion quality is resolution‑independent. Resolution flows to Seedance `resolution`, compose dims, and the cost model.

### D. Research Agent (unchanged)
Brand‑level scrape → evidence corpus → profile (cached, platform‑agnostic). Feeds: Topics (angles via platform lens), Content (substance), Story (situation), Video (via Evidence Agent). Note: research is NOT re‑run per platform; the platform lens applies downstream at topic/content/story.

### E. Evidence Agent (NEW) — anti‑generic safeguard
Input: research corpus. Output: structured `evidence` = Facts · Statistics · Proof Points · Customer Outcomes · Case Studies, **each tied to a source**. The Story Agent's Proof/Demonstration/Outcome beats consume it.
**Integrity rule:** never fabricates stats — only surfaces what research found; flags low‑evidence; the Quality Engine penalizes unsubstantiated claims. Stored brand‑level (derived/cached from research).

### F. Visual Style Agent (NEW) — persists via existing `brands.visual_world`
Output: reusable visual language — Cinematic / Camera / Lighting / Color / Motion — from a preset library (Apple‑minimal, Nike‑kinetic, Tesla‑premium‑dark, + SaaS/Construction/Healthcare/Real‑Estate), brand‑tuned. **Persistence solved:** this agent generates/refines `brands.visual_world` (migration 029, already exists), which already threads grade/typography/stylePreamble/negativePrompt/seedFamily into every scene prompt. No new storage; style persists across all of a brand's videos.

### G. Industry Persona Agent (NEW) — the protagonist source
Input: `brands.industry`. Output: an industry‑correct protagonist (Construction→Superintendent, SaaS→Product Manager, Real Estate→Agent, Healthcare→Practice Owner) with Role/Age/Appearance/Wardrobe/Environment/Behavior. This **is** the Character Blueprint (§L), industry‑aware so you never get a random generic person. Industry→role = config; Gemini fills specifics. Stored in `video_strategy.protagonist`.

### H. Journey Agent (NEW)
Input: brand, topic, platform. Output: buyer stage → modulates beat emphasis + CTA intent + tone:
| Stage | Emphasis | CTA intent | Tone |
|---|---|---|---|
| Awareness | Hook + Visualized Pain | soft ("follow/learn") | relatable, emotional |
| Consideration | Reveal + Demonstration | "see how it works" | informative |
| Decision | Proof + Outcome (ROI) | "book demo / start trial" | confident, evidence‑heavy |
| Purchase/Retention | Outcome + urgency | "get started / claim" | direct, scarcity |
Same topic → different video per stage. User choice (default "auto" = tiny classification).

### I. Conversion Agent (NEW)
Input: objective. Output: CTA type · copy · strategy · CTA scene structure (owns the 8th beat), capped by Platform CTA length. Objectives → mapping: Lead Gen (lead‑magnet), Newsletter (subscribe), Demo Booking (book), Webinar (register), Product Launch (get now), Waitlist (join/scarcity), Brand Awareness (soft follow). Composes with Journey (how hard the ask) + Platform (length/style).

### J. Story Template Agent (NEW)
Library of beat‑arcs; selected before populating scenes: Founder Story · Customer Success · Industry Insight · Product Launch · Educational · Thought Leadership · default 8‑beat. Selection = topic type × journey stage × objective. Templates = code config (no DB table for V1.1).

### K. Story Agent (NEW core)
Replaces 4‑beat with the **8‑beat human arc**: Hook · Problem · Visualized Pain · Reveal · Product Demonstration · Proof · Outcome · CTA. **Hard rule: translate `visual_metaphor` → a human situation** (no abstract geometry / floating shapes / metaphor‑only scenes). Per scene outputs: **Goal · Subject · Environment · Camera · Motion · Lighting · Emotion · Caption · Duration.** Inputs: brand + topic + brief + template + journey + conversion + platform bundle + evidence. Cardinal scripts as few‑shot exemplars.

### L. Character Continuity
- **V1.1 (text‑to‑video):** one Protagonist Blueprint (from Industry Persona Agent) used **verbatim** as `subject` in every scene + shared `seedFamily` + medium/wide shots over face close‑ups → archetype‑level continuity.
- **V1.2 (still Seedance):** generate protagonist once as a still (existing Imagen path) → drive scenes via `bytedance/seedance-2.0/reference-to-video` for face‑lock. Same engine, different mode.

### M. Product Demonstration Agent (NEW)
- Real assets (screenshots / dashboard images / screen recordings) → composite/overlay at compose, or Seedance `image-to-video` to animate → real demo.
- No assets → over‑the‑shoulder of a brand‑colored UI glow + protagonist reacting (no readable fake text / hallucinated dashboards).
Shows interaction · transformation · before‑vs‑after; placed on Reveal · Demo · Proof beats.

### N. Storyboard Approval
Reuses the existing dryRun (builds full plan, **zero spend**). Persists the `render_job` in status `storyboard`. Displays per scene: Goal · Subject · Environment · Camera · Caption · Duration; plus Platform · Resolution · Estimated Cost · Estimated Duration · **Quality Score**. Actions: Approve · Regenerate Scene · Edit Caption · Cancel. **No Seedance spend before approval.**

### O. Scene‑Level Costing (NEW — mostly in the data model already)
`estimateRenderCost` already returns `perScene: SceneCostLine[]`. V1.1 (a) **calibrates the rate** to the measured ~$1.22/scene (cert: estimate $0.56 vs actual $1.22) and (b) surfaces per‑scene cost on each storyboard card + total + balance preflight. Example: Scene1 5s ~$1.22 · Scene2 5s ~$1.22 · Scene3 7s ~$1.71 · Scene4 3s ~$0.73 → Total ~$4.88 (Balance ✓).

### P. Scene‑Level Regeneration (NEW — via existing resume mechanism, no infra change)
The scene‑generation worker already loads `scene_generations` rows with a `storage_url` and skips them (resume support). To regenerate only scene 3: clear scene 3's `storage_url` (and optionally edit its prompt in `video_strategy`), re‑enqueue the same scene‑generation job → only scene 3 regenerates, 1/2/4 reused from R2, then re‑compose. **Cost = one scene. Zero queue/workflow changes.**

### Q. Video Quality Engine (NEW) — pre‑render gate
Scores the storyboard (cheap, before spend): Story · Branding · Continuity · Product Visibility · CTA Visibility · Platform Compliance · Caption Safety · Conversion Strength → **0–100**. Checks: all beats present/ordered · human subject in every scene (no abstract) · demo beat exists · CTA present + ≤ length · captions in safe area · duration/aspect within platform · protagonist consistent · hook ≤Ns · proof backed by Evidence. Below threshold → flag weak dimensions + recommend regenerate **before any spend**. Advisory + tunable threshold (don't hard‑block). Post‑render frame‑vision scoring = V1.2.

### R. Database Impact
| Item | Change | Migration? |
|---|---|---|
| `video_strategy` jsonb | carrier: `platform, resolution, journeyStage, conversionObjective, template, protagonist, evidenceRefs, qualityScore` + per‑scene `{beat, shot, camera, environment, subject, subjectAction, emotion, lighting, grade, motion, demoDirective, caption, durationSec}` | **none** (jsonb) |
| `brands.visual_world` jsonb | populated by Visual Style Agent (**exists**, mig 029) | none |
| `render_jobs` | + `platform`, `resolution` (default linkedin/720p) · `status` += `storyboard` · optional `quality_score`, `journey_stage`, `conversion_objective` | optional cols only |
| `scene_generations` | regen clears `storage_url` (existing column) | none |
| `brand_assets.type` | + `product_screenshot`, `screen_recording`, `protagonist_reference` | enum widen (data) |
| `brand_evidence`, `brand_personas`, `story_templates` | derive‑from‑research / config‑in‑code / **future tables** | deferred |

### S. Migration Strategy
All new strategy/scene fields are **optional**; the prompt assembler falls back to the legacy prompt when absent. Missing platform/resolution → linkedin/720p. Storyboard status is additive (text). Evidence/Style/Persona read existing data. **The certified V1 render (`b1807d29`) and in‑flight V1 jobs render unchanged. No breaking migration.**

### T. Risks
- **Character identity:** Tier A is archetype‑only; validate Seedance reference‑to‑video (Tier B) before promising face‑lock.
- **Fake‑UI** in asset‑less demos → over‑shoulder/reaction framing + real‑asset overlays.
- **Non‑9:16 compose uncertified** (5 of 8 platforms) → cert each aspect (Sprint 1/3).
- **Cost** (8 beats × longer) → storyboard gate + 720p default + balance preflight + Quality gate contain it.
- **Evidence fabrication** → hard rule: never invent stats; Quality penalizes.
- **Story variance** → Cardinal few‑shot + Quality gate.
- **Quality‑Engine false negatives** → advisory (recommend, not block) + tunable threshold.
- **Taxonomy refactor** (content‑platform ↔ 8 video‑platforms) touches the content pipeline → scope in Sprint 1.

### U. Sprint Plan
**Sprint 1 — Foundation & cost safety** (highest ROI, near‑zero render risk; all pre‑spend/config)
Platform Agent · Resolution Agent · Evidence Agent · Storyboard Approval · Quality Engine (pre‑render) · cost calibration + scene‑level costing + balance preflight.
*Dependencies:* none (reuses dryRun + existing cost.perScene + research corpus). *DoD:* storyboard shows per‑scene cost + quality score; no spend before approval; calibrated cost within ±15% of actual; cert path (linkedin/720p) re‑verified unchanged.

**Sprint 2 — Story quality leap** (the commercial transformation)
Story Agent (8‑beat, metaphor→human) · Story Templates · Journey Agent · Conversion Agent · Visual Style Agent (→ visual_world) · Industry Persona Agent (→ blueprint).
*Dependencies:* Sprint 1 (platform constraints + Evidence feed the Story Agent; Quality gate validates new beats). *DoD:* a new‑brand render shows a human protagonist in real environments, 8 beats, real evidence in Proof, Quality ≥ threshold; non‑9:16 compose certified.

**Sprint 3 — Continuity, demo, premium**
Product Demonstration Agent · Character Continuity Tier B (reference‑to‑video) · 1080p / gated 4K‑upscale · scene‑level regeneration · post‑render Quality scoring.
*Dependencies:* Sprint 2 (persona → reference image; story beats → demo placement). *DoD:* face‑locked protagonist; real/believable demo; regenerate‑single‑scene at one‑scene cost; 1080p certified.

---

## 3. Certification guarantee

| Requirement | How honored |
|---|---|
| Preserve V1 cert / no broken renders | additive‑optional fields + assembler fallback; `b1807d29` unchanged |
| Seedance only | t2v now; image/reference‑to‑video later — same engine, no other providers |
| No new queue / workflow / engine | 12 agents = one planning layer in the existing dryRun; scene‑regen reuses existing resume |
| Keep Redis / BullMQ / Railway / Vercel | untouched |
| Improve quality/conversion/continuity/demo/platform/cost/approval | platform‑first + Evidence‑backed 8‑beat human story + Visual‑Style/Persona consistency + Demo agent + Storyboard+Quality gate + scene‑level cost/regen |

**Start with Sprint 1.** Within it, the **Storyboard Approval + Quality Engine + scene‑level costing** trio is the highest‑ROI, lowest‑risk increment: it reuses the existing dryRun, spends nothing, and structurally prevents the exact failures certification exposed (abstract visuals, no demo, missing CTA, budget surprise).

---

*Companion docs: `VIDEO_V1_CERTIFICATION.md`, `VIDEO_V1_CERT_EXECUTION.md`. Cert evidence: render `b1807d29` (4/4 Seedance, 19.13s, 1080×1920).*
