# P4 Phase 2 — Brand Pattern Library: Architecture & Implementation Blueprint

**Status:** Design (no code). Builds on [ADR-003](ADR-003-seedance-video-architecture.md) + [VIDEO_ARCHITECTURE_REVIEW](VIDEO_ARCHITECTURE_REVIEW.md) §7.
**Date:** 2026-06-16 · **Role:** Principal Creative Systems Architect
**Thesis:** brand identity in Ottoflow is currently encoded as *palette + logo* — the thinnest possible signal. The Brand Pattern Library (BPL) adds the missing **brand DNA** layer so identity survives logo removal.

---

## Section 1 — Problem analysis (brutal)

Verified against the live engines: `visual_tension`/`visual_metaphor` (gemini.ts → brief), the deterministic `compositeCreative` (sharp), `buildVideoStrategy` + `buildAiFirstPlan`, `ffmpeg.ts`.

**Why creative images feel generic.** The image is: Imagen *abstract background* (driven by `visual_metaphor`) + deterministic sharp overlay of palette scrim + logo + headshot + CTA + headline on a **fixed layout template**. Decompose the brand signal:
- Background = **topic-driven, not brand-driven.** Two brands posting about "team chaos → clarity" get the *same metaphor* → near-identical backgrounds. The metaphor engine differentiates by **topic**, never by **brand**.
- Layout/composition = **one template for all brands.** Headline top, CTA bottom, logo corner — identical regardless of brand.
- Typography = **generic system fonts**, same weight/treatment for everyone.
- The only truly brand-specific bits: **palette + logo + headshot.**

→ Strip the logo and you have: a topic-generic abstract background + a universal layout + system type + a color palette. **Palette is the sole surviving brand signal, and color alone is not identity.**

**Why videos feel generic.** Same disease, worse: abstract Seedance clips (topic metaphor) + generic Ken-Burns motion + hard cuts + (not-yet-built) LUT + logo overlay + CTA card. There is **no brand motion, no brand composition, no brand transition, no brand camera grammar, no recurring motif.** Four independent clips hard-cut together read as "AI montage."

**Root cause (one sentence):** Ottoflow differentiates creatives by **topic** (metaphor engine) and by **evidence type** (hierarchy engine) but has **no axis that differentiates by brand** beyond palette + logo. The BPL is that missing axis.

---

## Section 2 — Brand Pattern Library design

One BPL per brand = the **source of truth** for *how this brand expresses any concept*. Every DNA dimension specifies both an **image expression** (Imagen prompt fragment / sharp compositor directive) and a **video expression** (Seedance prompt fragment / FFmpeg directive), so the same DNA drives both pipelines.

| DNA dimension | What it encodes | Image expression | Video expression |
|---|---|---|---|
| **Worldview** | the brand's stance on the world (e.g. "order without pressure") | seeds metaphor *resolution* tone | seeds the Outcome beat |
| **Personality** | adjectives (calm, precise, bold, warm) | prompt adjectives | prompt + pacing |
| **Tone** | emotional register (reassuring vs urgent) | scrim intensity, contrast | grade + cut cadence |
| **Color DNA** | palette + *roles* (dominant/accent/forbidden) + grade | scrim + accents + Imagen palette | **`lut3d` on every clip** |
| **Motion DNA** | the brand's "verb": converge / flow / orbit / pulse | n/a (still) | Seedance motion grammar + Ken-Burns preset |
| **Composition DNA** | grid, weight, negative space, focal placement | sharp layout variant + Imagen composition | safe-zones + overlay placement |
| **Typography DNA** | font family, weight, case, treatment | sharp SVG type | ASS caption style |
| **Transition DNA** | the signature cut (e.g. always converge-to-center) | n/a | FFmpeg xfade signature (≥4 GB) |
| **Metaphor DNA** | the brand's *recurring* metaphor family (constrains topic metaphors) | biases `visual_metaphor` generation | biases scene prompts |
| **Camera DNA** | push/drift/orbit/lock cadence | n/a | Seedance + Agent-10 presets |
| **Visual motifs** | geometry family (lattice/arcs/particles/grid) | Imagen prompt + sharp motif overlay | Seedance prompt + FFmpeg motif PNG overlay |
| **Energy profile** | tempo 0–1 (calm→kinetic) | n/a | scene durations + transition speed |
| **Emotional signature** | the feeling to leave (trust, momentum, delight) | overall grade | Outcome beat + audio (later) |
| **Do-Nots** | hard exclusions (no neon, no clutter, no fast cuts) | negative prompt + validator | negative prompt + pacing guard |

### Schema (JSONB, the `pattern` payload)
```jsonc
{
  "worldview": "Order without pressure — work made calm.",
  "personality": ["calm", "structured", "human"],
  "tone": "reassuring",
  "color_dna": {
    "dominant": "#1b3a2b", "secondary": "#f0c419", "accent": "#2e7d32",
    "neutral": "#0f172a", "forbidden": ["#7c3aed"],
    "grade": "natural", "lut_ref": "basecamp_natural.cube"
  },
  "motion_dna": { "verb": "converge", "magnitude": "gentle", "jitter": "none" },
  "composition_dna": { "grid": "center-weighted", "negative_space": "high", "focal": "center" },
  "typography_dna": { "family": "Inter", "weight": 700, "case": "sentence", "treatment": "clean" },
  "transition_dna": { "signature": "dissolve-to-center", "duration_ms": 400 },
  "metaphor_dna": { "family": ["convergence", "structure", "flow"], "avoid": ["explosion", "chaos-as-endstate"] },
  "camera_dna": { "default": "slow-push", "cadence": "steady" },
  "motifs": ["interlocking-lines", "single-hub", "soft-grid"],
  "energy_profile": 0.35,
  "emotional_signature": "trust",
  "do_nots": ["neon", "fast-cuts", "glitch", "harsh-contrast", "clutter"]
}
```
Two queryable typed columns are denormalized out of this (`energy_profile numeric`, `tone text`) for analytics; the rest lives in `pattern`.

---

## Section 3 — Data model

A **versioned, 1:1-active** table (mirrors the existing `brand_intelligence_versions` pattern), not a column on `brands` (the payload is large, frequently re-derived, and we want history + attribution).

```sql
-- brand_patterns (P4 Phase 2)
brand_patterns(
  id                uuid pk,
  brand_id          uuid not null references brands(id) on delete cascade,
  version           int  not null,              -- monotonic per brand
  status            text not null,              -- 'draft' | 'active' | 'archived'
  source            text not null,              -- 'ai_derived' | 'manual' | 'hybrid'
  pattern           jsonb not null,             -- the DNA payload (Section 2)
  energy_profile    numeric,                    -- denormalized for analytics
  tone              text,                        -- denormalized
  recognition_score numeric,                    -- latest BRS (Section 7), nullable
  created_at        timestamptz default now(),
  unique(brand_id, version)
)
-- one active row per brand:
unique index brand_patterns_one_active on brand_patterns(brand_id) where status='active';
```

**Relationships & snapshotting (for reproducibility + attribution):**
- `brands 1—N brand_patterns` (exactly one `active`). Derived from `brands.profile` (research) + `brand_colors` + assets.
- `content_creatives` += `brand_pattern_version int` — snapshot which DNA produced the creative.
- `render_jobs` += `brand_pattern_version int` — same for video.
- `scene_generations` already records provider/seed; the plan's `branding` block (V1) extends to carry the resolved `motif`/`lut_ref`/`motion` so each scene is traceable to the DNA.
- This lets P6/P7 answer *"which Brand DNA version converts best?"* — the same evidence→artifact→performance loop, now extended to brand identity.

No change to `brands`/`content_items` core; everything is additive.

---

## Section 4 — Creative (image) integration

```
Opportunity → Visual Tension → Visual Metaphor → [Brand Pattern Library] → Creative Concept
                (topic axis)        (topic axis)      (BRAND axis)
```
The BPL is the **constraint layer** the topic metaphor flows through:
- `metaphor_dna.family` **biases** the metaphor generation (a Basecamp "chaos→clarity" resolves via *convergence/structure*; a different brand's same topic resolves via *its* metaphor family).
- `color_dna` → Imagen palette + sharp scrim/accents + grade.
- `composition_dna` → which sharp **layout variant** + Imagen composition directive (not one universal template).
- `typography_dna` → sharp SVG type treatment.
- `motifs` → Imagen prompt vocabulary + an optional deterministic motif overlay.
- `do_nots` → negative prompt + validator.

**Why this makes images recognizably Basecamp vs Stripe vs HubSpot without logos:** same topic, same metaphor *concept*, but rendered through different **metaphor family + composition grid + LUT + type + motif**. Basecamp = soft center-weighted convergence, calm green grade, generous negative space; Stripe = precise diagonal gradient geometry, high-contrast, tight grid; HubSpot = warm orbital motion, rounded forms, coral grade. The recognition lives in the *combination*, and crucially the **deterministic** parts (LUT, composition, type, motif overlay) carry it even when the stochastic Imagen background varies.

---

## Section 5 — Video integration

BPL rewrites every video knob:
| Knob | Driven by | Basecamp | Stripe |
|---|---|---|---|
| Scene planning | `metaphor_dna` + `energy_profile` | calm 4-beat, longer holds | precise 4-beat, tighter |
| Seedance prompts | `motion_dna` + `motifs` + `camera_dna` + `color_dna` | "lines gently converging into one hub, soft grid, slow push" | "precise diagonal gradients aligning, tight grid, locked camera" |
| Motion style | `motion_dna.verb` | converge | flow/align |
| Camera style | `camera_dna` | slow-push, steady | locked, exact |
| Transitions | `transition_dna` | dissolve-to-center | hard precise cut |
| Pacing | `energy_profile` | 0.35 → longer scenes | 0.55 → tighter |
| Grade | `color_dna.lut_ref` | natural green LUT | high-contrast LUT |

**Two brands, same topic, completely different videos:** the topic/metaphor concept is identical, but motion verb + camera + transition signature + LUT + motif + pacing all differ → the films share a narrative spine and share *nothing* visually. That is the proof the BPL works.

---

## Section 6 — Hierarchy integration (different films)

Hierarchy chooses **structure**; BPL chooses **style**. They compose:

| Hierarchy | Structure | Timing | Scene design | Branding strategy |
|---|---|---|---|---|
| **Founder-led** | metaphor arc + founder card (open/close, static) | warmer, slower | human-scale outcome beat | headshot on card only (never over motion); founder name caption |
| **Data-led** | + **Insight beat** = kinetic statistic | crisp | the number dramatizes the metaphor | data motif forward, logo secondary |
| **Quote-led** | one beat = full-screen typographic quote | editorial pauses | quotation-mark motif | type DNA hero, palette restrained |
| **Brand-led** | pure metaphor + motif | DNA-default energy | motif + LUT forward | logo + pattern prominent |

All four pass through the *same* BPL → they look like the same brand, but tell different stories. Without BPL they'd differ only in overlays (today's gap).

---

## Section 7 — Brand Recognition Score (BRS)

Measurable, logo-masked. Two tiers:

**Automated (cheap, every render):** weighted 0–100
- Color adherence 25 — histogram/ΔE of output vs `color_dna` (sharp/ffprobe).
- Composition match 15 — focal/grid vs `composition_dna`.
- Motion signature 20 *(video)* — cut cadence + optical-flow direction vs `motion_dna`/`transition_dna`.
- Motif presence 15 — template-match the motif overlay.
- Type adherence 10 — style vs `typography_dna`.
- Do-Not violations −N — hard penalties.

**Gold standard (periodic, the real test):** **blind attribution** — feed the logo-masked creative to a vision LLM (and a human panel) with the prompt *"which of these N brands is this?"* BRS_blind = % correct vs chance. **This is the metric that actually answers the core goal.** Store `recognition_score` on `brand_patterns`; gate "DNA active" on BRS_blind ≥ threshold (e.g. >60% vs 1/N chance).

Feedback loop: low BRS → flag the DNA dimension that scored worst → refine (manual or AI). Ties into P6/P7 (does higher BRS correlate with engagement?).

---

## Section 8 — Orchestration (where BPL lives)

```
Research → [DERIVE Brand Pattern Library] → (stored, source of truth, versioned)
                         │ read on every generation
Opportunity → Content → Creative(image)  ── reads active BPL ──┐
                       → Video(scenes)    ── reads active BPL ──┤→ snapshot pattern_version
                                                                 │
Publishing → Analytics → BRS + performance ── feeds back ──► refine BPL (next version)
```
- **Derivation:** once per brand after research (and on demand), a *Brand DNA agent* turns `brands.profile` + `brand_colors` + uploaded assets into a draft BPL → human approves → `active`.
- **Consumption:** the brief composer (image) and `buildVideoStrategy`/`buildAiFirstPlan` (video) **read the active BPL** and inject its expressions. BPL is upstream of both creative pipelines and downstream of research — the single source of truth, exactly as the objective requires.

---

## Section 9 — Implementation roadmap

| Phase | Goal | Files impacted | Risk | Dependencies | Complexity | Impact |
|---|---|---|---|---|---|---|
| **2A — Schema + manual BPL** | `brand_patterns` table + manual DNA editor; read `color_dna`/`composition_dna`/`typography_dna`/`motifs` into the **image** pipeline | migration; `db.ts`; brief composer (`creative/brief.ts`, `gemini.ts` prompt); a `BrandPatterns.tsx` editor; `types.ts` | Low — additive, image-only | none (uses live image pipeline) | **M** | **High** — images stop being topic-generic; recognition without logo starts here |
| **2B — AI-derived DNA** | a Brand-DNA agent: `brands.profile` + assets → draft BPL | new agent; research worker hook; review UI | Med — extraction quality | 2A | **M–L** | High — scales BPL to all brands without manual work |
| **2C — Video DNA** | wire BPL into `buildVideoStrategy`/`buildAiFirstPlan` (motion/camera/motif/pacing) + FFmpeg `lut3d` + transition signature | `video-strategy.ts`, `orchestrator.ts`, `ffmpeg.ts`, `branding.ts`, `scene-generation` | Med — FFmpeg LUT/transition runtime (needs ≥4 GB for xfade) | 2A + Video V1 live (Seedance+RAM) | **L** | High — videos gain brand motion identity |
| **2D — BRS + loop** | automated BRS + blind-attribution test + feedback into DNA + attribution columns | scoring module; `brand_patterns.recognition_score`; analytics | Med — scoring calibration | 2A–2C | **M** | Medium-High — proves and improves recognition; closes the loop |

Sequencing rationale: 2A delivers the 80/20 on **images** (live today, no Seedance/RAM dependency) — fastest path to visible brand recognition. 2C is gated on Video V1 going live. 2D makes it measurable.

---

## Section 10 — Final verdict (brutal)

**If implemented correctly, does BPL finally achieve "recognizable with the logo removed"?**

**Directionally yes, and it is the single highest-leverage missing layer — but it is necessary, not sufficient.** Honest remaining gaps:

1. **Stochastic vs deterministic control.** Prompt-injected DNA (motion/composition/metaphor into Imagen/Seedance) is *soft* — the models won't reliably honor it. The recognition that actually survives logo removal will come disproportionately from the **deterministic** layers (FFmpeg `lut3d`, composition templates, type treatment, motif overlays, transition signature). **Invest the DNA budget in the deterministic expressions; treat prompt DNA as a bonus, not the backbone.** A BPL that lives mostly in prompts will under-deliver.

2. **Typography ceiling.** Real brands are recognizable largely by **custom fonts**. System fonts (Inter/Arial in sharp/ASS) cap type-DNA recognition. Without brand-font upload/licensing, `typography_dna` is approximate. (Fixable: support brand font uploads — a clean 2A+ add.)

3. **Abstract-imagery ceiling.** Abstract metaphor backgrounds have an inherently lower recognition ceiling than branded product/scene imagery. A house style can be *coherent and distinct*; matching an established brand's exact felt-sense from a palette + research is aspirational.

4. **"Recognizable as Stripe" ≠ "recognizable as a consistent brand."** Stripe/Basecamp recognition is the product of years of consistent exposure + proprietary systems. Ottoflow can realistically deliver **"a coherent, distinct, blind-test-passable house style per brand"** — which is a genuine, defensible, market-leading outcome — but should not promise pixel-faithful replication of a famous brand's identity.

**Bottom line:** BPL moves Ottoflow from *"logo-dependent generic"* to *"a real per-brand house style that plausibly passes a blind attribution test"* — the correct and highest-value next investment, and it closes most of the gap the prior review flagged. To actually *clear* the bar, weight the implementation toward **deterministic expressions** (2A/2C LUT+composition+motif+transition) over prompt strings, and add **brand-font support**. With those, "recognizable with the logo removed" becomes a measurable, achievable claim (validated by the §7 blind BRS) rather than a slogan. Without them — if BPL ships as mostly prompt adjectives — it will improve things but still feel like nicer generic AI.
