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
  visual_concept: z.string().min(10).max(800),
  visual_rationale: z.string().min(10).max(800),
  headline: z.string().min(2).max(80),
  /** Optional supporting line under the headline (≤ 120 chars). */
  subheadline: z.string().max(120).default(""),
  cta: z.string().min(2).max(60),
  /** Imagen prompt for the BACKGROUND ONLY — validated against forbidden tokens. */
  background_prompt: z.string().min(10).max(1000),

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
 */
const FORBIDDEN_BACKGROUND_TOKENS =
  /\b(logos?|wordmarks?|brand\s*marks?|watermarks?|text|typograph\w*|letter(s|ing)?|words?|caption\w*|sign(age)?|slogan\w*|faces?|portraits?|person|people|human\w*|man|woman|founder)\b/i;

export function findForbiddenBackgroundToken(prompt: string): string | null {
  const m = prompt.match(FORBIDDEN_BACKGROUND_TOKENS);
  return m ? m[0] : null;
}

/** Below this blended confidence the engine falls back to brand_led. */
export const CONFIDENCE_FLOOR = 0.55;
