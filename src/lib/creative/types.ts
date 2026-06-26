/**
 * Brand Creative Orchestrator — domain types (Phase B).
 *
 * The CreativeBrief is the SOURCE OF TRUTH for a creative: everything the
 * approval gate displays and everything the Phase C worker executes lives
 * here, Zod-validated at compose time and re-validated by the worker before
 * generation. The model contributes ONLY concept/rationale/copy/prompt —
 * asset usage, placements, and confidence are code-computed so the gate
 * shows deterministic, trustworthy facts.
 *
 * Safety invariants encoded in this shape:
 *  - asset usage references asset IDS, never bytes — uploaded assets are
 *    composited deterministically and never reach an AI model
 *  - background_prompt describes a background ONLY; the worker appends
 *    negative prompts and validates the brief's prompt against forbidden
 *    tokens (logos / text / faces) before any Imagen spend
 */
import { z } from "zod";

export const CREATIVE_HIERARCHIES = [
  "founder_led",
  "brand_led",
  "data_led",
  "quote_led",
  // product_led is deferred (design v1) — kept in the enum so stored rows
  // stay valid when it lands.
  "product_led",
] as const;
export type CreativeHierarchy = (typeof CREATIVE_HIERARCHIES)[number];

/** Hierarchies the v1 engine actually selects from. */
export const ACTIVE_HIERARCHIES: CreativeHierarchy[] = [
  "founder_led",
  "brand_led",
  "data_led",
  "quote_led",
];

export const PLACEMENTS = [
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
  "center",
  "left_third",
  "right_third",
  "bottom_bar",
] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** Imagen-supported ratios we use, chosen from the platform. */
export const ASPECT_RATIOS = ["1:1", "3:4", "16:9", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

// ─── P4 Phase 2A — Brand Pattern Library (deterministic brand identity) ──────
// The DNA the sharp compositor consumes to stamp brand identity (color grade,
// motif overlay, composition template, typography, spacing). NEVER sent to a
// model. Every field is optional → a brand with no pattern (or partial DNA)
// renders exactly as today; the compositor only applies what is present.

export const MOTIF_FAMILIES = [
  "interlocking_hub", "diagonal_bars", "orbital_dots", "fine_grid", "mono_line",
] as const;
export type MotifFamily = (typeof MOTIF_FAMILIES)[number];

export const COMPOSITION_TEMPLATES = [
  "center_convergence", "diagonal_precision", "orbital_growth", "grid_authority", "open_canvas",
] as const;
export type CompositionTemplate = (typeof COMPOSITION_TEMPLATES)[number];

export const MOTIF_PLACEMENTS = ["center_bleed", "corner", "edge", "full_tile"] as const;
export type MotifPlacement = (typeof MOTIF_PLACEMENTS)[number];

export const brandPatternSchema = z
  .object({
    color_dna: z
      .object({
        // sharp recomb 3×3 brand grade applied to the background buffer.
        recomb: z.array(z.array(z.number()).length(3)).length(3).optional(),
        modulate: z
          .object({
            saturation: z.number().min(0).max(3).optional(),
            hue: z.number().optional(),
            brightness: z.number().min(0).max(3).optional(),
          })
          .optional(),
        duotone: z
          .object({ shadow: z.string(), highlight: z.string(), strength: z.number().min(0).max(1) })
          .optional(),
        scrim_strength: z.number().min(0).max(1).optional(),
      })
      .optional(),
    composition_dna: z
      .object({
        template: z.enum(COMPOSITION_TEMPLATES),
        focal: z.string().optional(),
        negative_space: z.number().min(0).max(1).optional(),
      })
      .optional(),
    motif_dna: z
      .object({
        family: z.enum(MOTIF_FAMILIES),
        placement: z.enum(MOTIF_PLACEMENTS).default("center_bleed"),
        opacity: z.number().min(0).max(1).default(0.12),
        scale: z.number().min(0.1).max(2).default(0.7),
        blend: z.enum(["screen", "overlay", "soft-light", "over"]).default("screen"),
      })
      .optional(),
    typography_dna: z
      .object({
        headline: z
          .object({
            font_id: z.string().optional(),
            weight: z.number().optional(),
            case: z.enum(["sentence", "upper", "title"]).optional(),
            tracking: z.number().optional(),
          })
          .optional(),
        cta: z
          .object({
            font_id: z.string().optional(),
            weight: z.number().optional(),
            case: z.enum(["sentence", "upper", "title"]).optional(),
          })
          .optional(),
      })
      .optional(),
    energy_dna: z.object({ level: z.number().min(0).max(1) }).optional(),
    spacing_dna: z
      .object({
        margin_ratio: z.number().min(0.01).max(0.2).optional(),
        gap_ratio: z.number().min(0).max(2).optional(),
      })
      .optional(),
    framing_dna: z
      .object({
        mode: z.enum(["full_bleed", "inset", "border"]).optional(),
        border: z.string().nullable().optional(),
        corner_radius: z.number().optional(),
      })
      .optional(),
    do_not_use: z
      .object({
        colors: z.array(z.string()).optional(),
        placements: z.array(z.string()).optional(),
        max_motif_opacity: z.number().min(0).max(1).optional(),
        border: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();
export type BrandPattern = z.infer<typeof brandPatternSchema>;

const assetUsageSchema = z.object({
  use: z.boolean(),
  /** brand_assets.id — present iff use=true and an asset backs the usage. */
  asset_id: z.string().uuid().optional(),
  placement: z.enum(PLACEMENTS).optional(),
  /** Code-generated explanation shown in the approval gate. */
  reason: z.string().max(300),
});
export type AssetUsage = z.infer<typeof assetUsageSchema>;

const nameUsageSchema = z.object({
  use: z.boolean(),
  /** Display name (company name / founder name) when use=true. */
  name: z.string().max(120).optional(),
  /** How it appears, e.g. "wordmark in the bottom brand bar". */
  treatment: z.string().max(300),
});
export type NameUsage = z.infer<typeof nameUsageSchema>;

export const creativeBriefSchema = z.object({
  version: z.literal(1),
  hierarchy: z.enum(CREATIVE_HIERARCHIES),
  /** Final blended confidence: 0.40 assets + 0.30 model + 0.20 opportunity + 0.10 platform. */
  confidence: z.number().min(0).max(1),
  confidence_components: z.object({
    assets: z.number().min(0).max(1),
    model: z.number().min(0).max(1),
    opportunity: z.number().min(0).max(1),
    platform: z.number().min(0).max(1),
  }),
  eligible_hierarchies: z.array(z.enum(CREATIVE_HIERARCHIES)).min(1),
  /** True when confidence fell below 0.55 and the engine forced brand_led. */
  forced_brand_led: z.boolean(),

  // ── Model-composed strategy (the reviewable creative thinking) ──────────
  /** Topic → Visual Metaphor Engine (P4 Phase 1). The opposition the topic
   *  dramatizes (e.g. "Complexity vs Simplicity"). Defaulted for older briefs. */
  visual_tension: z.string().max(120).default(""),
  /** The abstract-safe visual that depicts the tension resolving; the
   *  background_prompt renders it. Defaulted for briefs predating this field. */
  visual_metaphor: z.string().max(400).default(""),
  visual_concept: z.string().min(10).max(800),
  visual_rationale: z.string().min(10).max(800),
  headline: z.string().min(2).max(80),
  /** Optional supporting line under the headline (≤ 120 chars). */
  subheadline: z.string().max(120).default(""),
  cta: z.string().min(2).max(60),
  /** Imagen prompt for the BACKGROUND ONLY — validated against forbidden tokens. */
  background_prompt: z.string().min(10).max(1000),
  /** Creative Memory (Sprint 19) — the structured art direction this creative used,
   *  persisted so future generations recall recent directions and pick a DIFFERENT
   *  valid world (controlled variety). Defaulted for briefs predating this field. */
  creative_direction: z
    .object({
      world: z.string().default(""),
      environment: z.string().default(""),
      lighting: z.string().default(""),
      lens: z.string().default(""),
      composition: z.string().default(""),
      mood: z.string().default(""),
      color_grade: z.string().default(""),
      emotional_tone: z.string().default(""),
    })
    .default({ world: "", environment: "", lighting: "", lens: "", composition: "", mood: "", color_grade: "", emotional_tone: "" }),

  /** AI Creative Review (Sprint 20) — the vision QC verdict on the RENDERED creative,
   *  written by the worker after compositing. Absent on briefs at the gate (no image yet)
   *  and on briefs predating this field. Stored here (jsonb) so no migration is needed. */
  review: z
    .object({
      overall_score: z.number(),
      brand_score: z.number(),
      commercial_score: z.number(),
      story_score: z.number(),
      composition_score: z.number(),
      readability_score: z.number(),
      originality_score: z.number(),
      platform_score: z.number(),
      confidence: z.number(),
      recommendation: z.enum(["approve", "improve", "reject"]),
      issues: z.array(z.string()),
      suggestions: z.array(z.string()),
      threshold: z.number(),
      reviewed_at: z.string(),
    })
    .optional(),

  /** AI Self-Improvement Loop (Sprint 21) — every generate→review attempt for this
   *  creative, in order. The last entry is the DELIVERED version. Future training
   *  data: which directions consistently produce higher-quality work. jsonb. */
  revision_history: z
    .array(
      z
        .object({
          attempt: z.number(),
          overall_score: z.number().nullable(),
          recommendation: z.enum(["approve", "improve", "reject"]).nullable(),
          scores: z
            .object({
              brand: z.number(),
              commercial: z.number(),
              story: z.number(),
              composition: z.number(),
              readability: z.number(),
              originality: z.number(),
              platform: z.number(),
            })
            .partial()
            .optional(),
          issues: z.array(z.string()).default([]),
          /** The planner notes that produced THIS attempt (empty on attempt 1). */
          applied_changes: z.array(z.string()).default([]),
          direction: z.record(z.string()).optional(),
          background_source: z.string().optional(),
          reviewed_at: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
  /** True when the loop exhausted its attempts still below threshold — the best
   *  version is delivered, but flagged for human review (never exposed to the
   *  customer). */
  needs_human_review: z.boolean().optional(),
  /** Number of improvement cycles performed (0 = approved on first generation). */
  revision_count: z.number().optional(),

  // ── Code-computed asset + identity usage (deterministic, trustworthy) ───
  logo_usage: assetUsageSchema,
  headshot_usage: assetUsageSchema,
  company_name_usage: nameUsageSchema,
  founder_name_usage: nameUsageSchema,
  /** Optional credited subject-matter expert (distinct from the founder). */
  expert_name_usage: nameUsageSchema.default({ use: false, treatment: "" }),

  // ── Asset readiness (code-computed snapshot at compose time) ──────────────
  // What the brand actually has on file, independent of whether the chosen
  // hierarchy uses it. Powers the "Logo ✓ / Founder Headshot ✓" readiness row
  // at the gate. Defaulted so briefs stored before this field stay valid.
  assets_available: z
    .object({
      logo: z.boolean(),
      founder_headshot: z.boolean(),
    })
    .default({ logo: false, founder_headshot: false }),

  // ── Layout + context ─────────────────────────────────────────────────────
  aspect_ratio: z.enum(ASPECT_RATIOS),
  palette: z.object({
    primary: z.string().optional(),
    secondary: z.string().optional(),
    accent: z.string().optional(),
  }),
  platform: z.string(),
  topic_title: z.string().nullable(),
  opportunity_kind: z.string().nullable(),
});

export type CreativeBrief = z.infer<typeof creativeBriefSchema>;

export type CreativeStatus =
  | "brief_ready"
  | "approved"
  | "generating"
  | "ready"
  | "failed"
  | "rejected";

/**
 * Forbidden-token guard for background prompts. Imagen backgrounds must not
 * contain logos, brand marks, readable text, or synthesized faces — if the
 * model's prompt asks for any of those, the brief fails validation and is
 * recomposed (compose-time) or refused (worker re-validation, Phase C).
 *
 * Sprint 18 (de-templating): also forbid GEOMETRIC/template language so the
 * generated background reads as cinematic photography, not a Canva template.
 * An AI prompt requesting bars/rectangles/grids/blocks/stripes is caught and
 * replaced by the clean cinematic fallback.
 */
const FORBIDDEN_BACKGROUND_TOKENS =
  /\b(logos?|wordmarks?|brand\s*marks?|watermarks?|text|typograph\w*|letter(s|ing)?|words?|caption\w*|sign(age)?|slogan\w*|faces?|portraits?|person|people|human\w*|man|woman|founder|geometric|rectangles?|rectangular|bars?|grids?|blocks?|stripes?|polygons?|hexagons?|chevrons?|diagonal)\b/i;

export function findForbiddenBackgroundToken(prompt: string): string | null {
  const m = prompt.match(FORBIDDEN_BACKGROUND_TOKENS);
  return m ? m[0] : null;
}

/** Below this blended confidence the engine falls back to brand_led. */
export const CONFIDENCE_FLOOR = 0.55;
