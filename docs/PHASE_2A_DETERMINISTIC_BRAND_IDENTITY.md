# Phase 2A — Deterministic Brand Identity (Image Creatives)

**Status:** Implementation spec (no code). Decisions final per the deterministic-first BPL doctrine.
**Scope:** images only (no video). **Goal:** move from *palette + logo* to *deterministic brand identity*, so two brands on the same topic produce recognizably different creatives **with logo, CTA, and brand name removed**.
**Grounded in:** the live `src/lib/creative/compositor.ts` (`compositeCreative`) — current layer stack: `background(Imagen) → scrim(palette-tint) → headshot → logo → type`, hierarchy-driven layout, fixed `DejaVu/Arial` font, fixed `0.05` margins. Phase 2A adds the missing deterministic identity layers and parameterizes layout/type/spacing by brand DNA.

---

## Section 1 — Brand Pattern schema (image fields)

Stored in `brand_patterns.pattern` (versioned table, §7). Each field: **purpose · image expression (how `compositeCreative` consumes it) · future video expression (2C, noted only)**.

| Field | Purpose | Image expression | Future video |
|---|---|---|---|
| `color_dna` | exact brand color grade (not just palette) | sharp `recomb` 3×3 matrix + `modulate{saturation,hue}` + optional duotone applied **to the Imagen background**; drives scrim tint + accent + CTA | FFmpeg `lut3d` |
| `composition_dna` | spatial grammar (focal, weight, negative-space) | selects a composition template (§3) → text anchor/start-Y, asset-placement bias, focal point | scene framing + safe-zones |
| `motif_dna` | the recognition anchor — a recurring geometric mark | deterministic SVG motif overlay (§4): family id + placement + opacity + scale | motif APNG overlay |
| `typography_dna` | brand voice in type | brand font (woff2/ttf) + weight/case/tracking for headline/sub/CTA | ASS caption style |
| `energy_dna` | tempo/intensity 0–1 | scrim strength, contrast, motif opacity, type weight bias | scene durations + cut cadence |
| `spacing_dna` | margin/padding rhythm | replaces the fixed `m = 0.05`; per-brand margin ratio + inter-element gap | safe-zone padding |
| `framing_dna` | edge treatment / containment | optional border, inset frame, corner radius, or full-bleed flag | letterbox/inset rules |
| `do_not_use` | hard exclusions | forbidden colors (validator), banned placements, max opacity, "no border", etc. | negative prompt + guards |

### Final JSON
```jsonc
{
  "version": 1,
  "color_dna": {
    "recomb": [[0.95,0.03,0.02],[0.02,0.97,0.01],[0.01,0.04,0.95]],  // 3x3 brand grade
    "modulate": { "saturation": 0.92, "hue": 0 },
    "duotone": { "shadow": "#0f172a", "highlight": "#1b3a2b", "strength": 0.25 },
    "palette": { "primary": "#1b3a2b", "secondary": "#f0c419", "accent": "#2e7d32" },
    "scrim_strength": 0.5
  },
  "composition_dna": { "template": "center_convergence", "focal": "center", "negative_space": 0.55, "weight": "balanced" },
  "motif_dna": { "family": "interlocking_hub", "placement": "center_bleed", "opacity": 0.12, "scale": 0.7, "blend": "screen" },
  "typography_dna": {
    "headline": { "font_id": "inter_display", "weight": 800, "case": "sentence", "tracking": 0 },
    "cta":      { "font_id": "inter", "weight": 700, "case": "sentence" }
  },
  "energy_dna": { "level": 0.35 },
  "spacing_dna": { "margin_ratio": 0.06, "gap_ratio": 0.3 },
  "framing_dna": { "mode": "full_bleed", "border": null, "corner_radius": 0 },
  "do_not_use": { "colors": ["#7c3aed"], "placements": ["dutch"], "max_motif_opacity": 0.2, "border": false }
}
```

---

## Section 2 — Deterministic image identity (compositor changes)

**New layer stack (bottom → top, = sharp composite order = z-index). Ownership in brackets.**

| z | Layer | Source | Change |
|---|---|---|---|
| 0 | **Background content** | Imagen | **[AI — neutral only]** prompt neutralized: pure metaphor energy, *no brand color steering* (brand color now comes deterministically at z1) |
| 1 | **Brand color grade** | sharp `recomb`/`modulate`/`duotone` on the bg buffer | **[Deterministic — NEW]** applied to the background *before* it becomes the base |
| 2 | **Motif overlay** | brand SVG (palette-injected) | **[Deterministic — NEW]** opacity/scale/placement from `motif_dna` |
| 3 | **Scrim** | palette-tinted gradient | **[Deterministic — exists]** strength from `color_dna.scrim_strength`/`energy_dna` |
| 4 | **Headshot** | locked asset | **[Deterministic — exists]** hierarchy-gated, whitelist ops |
| 5 | **Logo chip + logo** | locked asset | **[Deterministic — exists]** hierarchy-gated |
| 6 | **Typography** | SVG, **brand font** | **[Deterministic — modified]** font/spacing from `typography_dna`/`spacing_dna`; layout from `composition_dna` template |

**Render order (the function):**
1. Resolve canvas (existing) + **load active `brand_patterns` for the brand** (NEW).
2. `bg = sharp(imagenBg).recomb(color_dna.recomb).modulate(...).resize(cover)` → apply **brand grade** (z0+z1 fused into the base buffer).
3. Build `layers[]` in order: **motif (z2)** → scrim (z3) → headshot (z4) → logo (z5) → type (z6).
4. Composition template (§3) supplies the coordinates the type/asset layers use (replaces the hardcoded per-hierarchy constants — now **template × hierarchy**).
5. Flatten (existing `sharp(bg).composite(layers)`).

**Ownership doctrine realized:** AI owns *only* z0 content; **every brand-identifying layer (z1–z6) is deterministic.** Removing z0 entirely and keeping z1–z6 should still read as the brand (the §6 test).

---

## Section 3 — Composition templates

A template = a parametric **spatial grammar** (focal point, negative-space ratio, text anchor/start-Y, asset-placement bias, motif placement). It is **orthogonal to hierarchy**: template = *brand's spatial signature*; hierarchy = *which element is hero*. Final layout = `template(brand) × hierarchy(content)`.

| Template | Spatial signature | When used / assigned |
|---|---|---|
| **Center Convergence** | center focal, high negative space, symmetric | calm/structured brands (Basecamp) |
| **Diagonal Precision** | 30° diagonal weight, tight grid, low negative space | precise/technical (Stripe, Linear) |
| **Orbital Growth** | off-center focal, radial weight, motion implied | warm/growth (HubSpot) |
| **Grid Authority** | strict rule-of-thirds, blocky, left-weighted | enterprise/authoritative |
| **Open Canvas** | minimal, large negative space, single focal | minimalist (Notion) |

- **Assignment (2A):** manual — set in the Brand Patterns editor (or seeded by brand archetype from research). AI-derivation is 2B.
- **How it affects layout:** the template overrides the currently-hardcoded `startY`, `anchor`, `tx`, and asset-placement defaults in `compositeCreative` with template-driven values, *then* hierarchy picks the hero element within that grammar. Two brands, same hierarchy, different template → different layouts.

---

## Section 4 — Motif system

Deterministic SVG overlays: **authored once per brand, reused forever, no AI at render, survives regeneration.**

- **SVG architecture:** a parametric SVG per *family* (`src/lib/creative/motifs/<family>.svg.ts` returning an SVG string), with **palette injected at render** (colors come from `color_dna`, geometry is fixed). Families: `interlocking_hub` (Basecamp), `diagonal_bars` (Stripe), `orbital_dots` (HubSpot), `fine_grid` (Linear), `mono_line` (Notion).
- **Overlay rules:** placed per `motif_dna.placement` (center_bleed / corner / edge / full_tile); blend per `motif_dna.blend` (screen/overlay/soft-light) so it integrates with the graded background.
- **Opacity rules:** 8–18% default (texture, not clutter); `brand_led` may go to ~20% (capped by `do_not_use.max_motif_opacity`); scaled by `energy_dna`.
- **Scaling rules:** proportional to canvas min-dimension × `motif_dna.scale`; anchored to the focal point; never enlarged past source vector (vectors are resolution-free → no quality loss).
- **Storage:** motif geometry lives in-repo (versioned, reviewable); only the *palette* varies per brand. (A brand with a bespoke motif uploads an SVG to `brand-assets` kind=`motif`.)

---

## Section 5 — Typography system

| | Current | Future (2A) |
|---|---|---|
| Fonts | fixed `DejaVu Sans, Arial` stack | per-brand uploaded fonts |

- **Upload flow:** Brand settings → upload `.woff2`/`.ttf` for roles `display` / `body` → stored in `brand-assets` bucket, `brand_assets.kind='font'` + `role`.
- **Storage model:** reuse `brand_assets` (kind=`font`, role, storage_path) — no new table; `typography_dna.font_id` references it.
- **Render materialization (critical impl detail):** sharp/librsvg resolve fonts via **fontconfig** — a font referenced in SVG must exist on disk in the render env. So the worker must, before compositing: download the brand font → write to a fonts dir → ensure `FONTCONFIG_PATH`/`fonts.conf` includes it (or use a per-render font dir). This is the fiddliest part of 2A.
- **Fallback chain:** brand font → category default (sans/serif/mono) → `DejaVu Sans` (guaranteed present on nixpacks). Never fail a render on a missing font.
- **Licensing:** only embed fonts the brand owns/licenses for digital embedding. Prefer SIL/OFL (Inter, etc.) defaults; require an explicit "I have rights" attestation on upload of commercial fonts; store provenance.

---

## Section 6 — Brand Recognition Score (image, pre-video)

**Automated (every render), 0–100:**
| Dimension | Weight | Method |
|---|---|---|
| Color adherence | 30 | mean ΔE of output vs `color_dna` grade target |
| Composition match | 20 | focal/negative-space vs template (saliency/region heuristic) |
| Motif presence | 20 | template-match the motif overlay region |
| Typography adherence | 20 | rendered font/weight vs `typography_dna` (deterministic → near-100 by construction) |
| Spacing/framing | 10 | margin/inset vs `spacing_dna`/`framing_dna` |
| `do_not_use` violations | −N | hard penalties |

**Blind attribution (the real proof, periodic):** mask logo + CTA + brand name → present to a vision-LLM (and a human panel) alongside N brands → *"which brand is this?"*. **BRS_blind = % correct vs 1/N chance.** Gate "pattern active" on BRS_blind above a threshold (e.g. >60% with N=5).

**Proving improvement:** fixed test set = same K topics × the pilot brands, rendered twice — **baseline (palette-only, today)** vs **2A (full deterministic identity)**. Report ΔBRS_blind. Target: baseline ≈ chance → 2A materially above chance. Store `recognition_score` on `brand_patterns` per version → track across versions.

---

## Section 7 — Implementation plan

**Files impacted**
- `supabase/migrations/023_brand_patterns.sql` (NEW)
- `src/lib/creative/types.ts` — `BrandPattern` type
- `src/lib/creative/compositor.ts` — color grade (z1), motif (z2), template-driven layout, brand-font materialization
- `src/lib/creative/motifs/*.ts` (NEW) — parametric motif SVGs
- `src/lib/creative/composition-templates.ts` (NEW) — template param sets
- `src/lib/gemini.ts` — neutralize the background prompt (no brand color steering)
- `worker/processors/creative-generation.ts` — load active pattern; download+register brand font
- `src/lib/db.ts` — `getActiveBrandPattern(brandId)`
- `src/components/BrandPatterns.tsx` (NEW) + route `PATCH /api/brands/[id]/pattern`
- `src/lib/brs.ts` (NEW) — automated BRS

**Database changes / migration (023, additive)**
```sql
brand_patterns(id, brand_id fk, version int, status, source, pattern jsonb,
               recognition_score numeric, created_at,
               unique(brand_id, version));
unique index brand_patterns_one_active on brand_patterns(brand_id) where status='active';
ALTER TABLE content_creatives ADD COLUMN IF NOT EXISTS brand_pattern_version int;
ALTER TABLE brand_assets … (kind already free-text → 'font'/'motif' need no DDL)
```

**Risk assessment**
| Risk | Severity | Mitigation |
|---|---|---|
| sharp font/fontconfig materialization on nixpacks | **High** | spike it first (Task 0); DejaVu fallback guarantees no hard-fail |
| Color grade muddies an already-colored Imagen bg | Med | neutralize the Imagen prompt (z0 brand-neutral); grade a near-neutral bg |
| Motif clutters / hurts legibility | Med | opacity caps + below-scrim placement (z2 < z3) |
| Template×hierarchy combinatorial layout bugs | Med | templates as pure param sets; snapshot-test layouts |
| Manual DNA authoring doesn't scale | Med | acceptable for 2A pilot (3–5 brands); 2B AI-derives |

**Acceptance criteria**
1. Two pilot brands, same topic → visibly different creatives with **logo+CTA+name removed**.
2. `tsc --noEmit` + `next build` clean; stock/no-pattern path unchanged (a brand with no active pattern renders exactly as today).
3. Brand-font renders correctly on the worker (or falls back cleanly).
4. BRS_blind for the 2A set materially > chance and > the palette-only baseline.

**Verification plan:** unit-free (project gate = tsc + build) + a render-diff harness (same topic, 2 brands, masked) + the blind-attribution run.

**Deployment sequence (playbook):** migration 023 first (Supabase) → push branch+main → wait for Railway "Deployment successful" → render the pilot set → BRS baseline-vs-2A.

---

## Section 8 — Brutal review

**Weaknesses**
1. **sharp ≠ a real color pipeline.** `recomb`/`modulate`/`duotone` is a *crude* grade vs a film `lut3d`. Image color identity will be coarser than the video LUT story implies; over-grading a colored Imagen bg can look muddy. The honest fix (neutralize z0) helps but means the background carries *less* content interest.
2. **Motifs are a human design bottleneck.** Recognition now depends on a *well-designed* motif per brand. A weak/generic motif = weak recognition. Architecture can't manufacture taste — this becomes a content-ops dependency, and it's the single likeliest reason 2A underdelivers in practice.
3. **Fonts are the fiddliest + legally riskiest piece.** Fontconfig materialization on nixpacks is error-prone; commercial-font licensing is a real liability. Many brands won't upload fonts → they fall back to defaults → one of your strongest deterministic anchors silently degrades to generic.
4. **Template×hierarchy is combinatorial.** 5 templates × 4 hierarchies × optional headshot/logo = many layout permutations to keep legible; high regression surface in one already-dense compositor file.
5. **The background is still topic-generic abstract.** Even perfectly graded + motif'd, the z0 content is an abstract metaphor shared across brands on the same topic. Deterministic layers raise the floor a lot, but the substrate is generic.

**Hidden assumptions**
- That each pilot brand *has* a codifiable, distinctive visual identity to encode (many SMBs don't — they have a logo and a color).
- That a vision-LLM blind test is a valid proxy for human recognition (it correlates, but isn't identical).
- That a human will author good motifs/templates/DNA (taste is assumed, not engineered).
- That "different" == "recognizable" — two brands looking *distinct* from each other is necessary but not sufficient for either being *identifiable*.

**Scalability limits**
- Manual DNA + motif authoring caps you at a handful of brands until 2B (AI-derive DNA) lands; motif design never fully automates well.
- One monolithic `compositor.ts` absorbing grade+motif+template+fonts will get unwieldy — plan the split.

**What still prevents true logo-free recognition after 2A**
- **The abstract-content ceiling** (z0 is generic) — unchanged by 2A.
- **Font reality** — without uploaded brand fonts (most won't), type-DNA is generic.
- **Motif quality** — recognition is only as strong as the designed motif.
- **It's images-only** — video identity (the higher-stakes, motion-based recognition) waits for 2C.

**Net:** 2A is the correct, highest-leverage first step and will move blind-attribution **materially above chance** for brands with a strong codifiable identity + a good motif + (ideally) a brand font. It will **not** make a thin-identity SMB "recognizable," and it won't fully clear the bar alone — the residual gaps are *content substrate* (abstract bg), *fonts*, and *motif design quality*, none of which are architecture problems 2A can solve. Build it, measure it with BRS_blind, and treat motif/font quality as a first-class content-ops workstream, not an afterthought.
