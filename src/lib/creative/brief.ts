/**
 * composeCreativeBrief (Phase B) — assembles the full, Zod-validated
 * CreativeBrief for one content item.
 *
 *   1. rankHierarchies() picks the hierarchy (pure code — hierarchy.ts)
 *   2. generateCreativeConcept() composes the reviewable strategy (1 Gemini
 *      structured call; receives asset DESCRIPTIONS only, never bytes)
 *   3. background-prompt safety validation (forbidden tokens → one recompose,
 *      then a deterministic safe fallback prompt)
 *   4. if blended confidence < 0.55 and the choice isn't brand_led already,
 *      force brand_led and recompose once (design rule)
 *   5. code computes logo/headshot/company-name/founder-name usage — the
 *      approval gate displays deterministic facts, not model claims
 *
 * NO image generation happens here or anywhere in Phase B.
 */
import { generateCreativeConcept, type CreativeConcept } from "@/lib/gemini";
import { fallbackWorldPrompt } from "./creative-direction";
import {
  renderIntelligenceBlock,
  intelligenceSummary,
  type CreativeIntelligence,
} from "./brand-intelligence";
import {
  renderPerformanceBlock,
  performanceSummary,
  type PerformanceIntelligence,
} from "./performance-intelligence";
import { renderCampaignStrategyBlock, campaignSummary } from "./campaign-strategy";
import type { CampaignStrategy } from "@/lib/gemini";
import type { DbBrand, DbBrandAsset } from "@/lib/types";
import {
  rankHierarchies,
  selectAssets,
  blendConfidence,
  type CreativePreferences,
  type HierarchyScore,
} from "./hierarchy";
import {
  creativeBriefSchema,
  findForbiddenBackgroundToken,
  CONFIDENCE_FLOOR,
  type AspectRatio,
  type CreativeBrief,
  type CreativeHierarchy,
  type Placement,
} from "./types";

export interface ComposeBriefInput {
  brand: DbBrand;
  assets: DbBrandAsset[];
  content: {
    title: string;
    preview: string | null;
    body: string | null;
    platform: string;
  };
  topic: {
    title: string;
    hook_angle: string | null;
    opportunity_kind: string | null;
    category: string | null;
  } | null;
  /** Creative Memory (Sprint 19) — compact summaries of this brand's recent creative
   *  directions (most-recent first), so the concept model picks a DIFFERENT world.
   *  Optional: callers without history (or older callers) pass nothing. */
  recentDirections?: string[];
  /** Brand Intelligence (Sprint 22) — the brand's Creative Intelligence profile,
   *  computed from delivered creatives. Drives the concept at priority #4 and is
   *  recorded (compactly) on the brief for internal explainability. Optional. */
  intelligence?: CreativeIntelligence | null;
  /** Performance Intelligence (Sprint 23) — REAL engagement profile computed from
   *  measured campaigns. Drives the concept at priority #3 (above Brand
   *  Intelligence) and is recorded compactly on the brief. Optional. */
  performance?: PerformanceIntelligence | null;
  /** Campaign Strategy (Sprint 24) — the campaign that governs this creative
   *  (planned BEFORE the image). Frames the concept as the governing input and is
   *  recorded on the brief. Optional: clean creatives without a planned campaign. */
  campaign?: CampaignStrategy | null;
  /**
   * Per-creative branding overrides captured on /content/generate. Names
   * override the defaults (company = brand.name, founder = headshot label);
   * the use_logo / use_headshot toggles let the user suppress an available
   * asset (default: use when present).
   */
  branding?: {
    companyName?: string | null;
    founderName?: string | null;
    expertName?: string | null;
    useLogo?: boolean;
    useHeadshot?: boolean;
    /** Text Overlay (COS migration M2C) — the shared Creative OS control. Both
     *  absent by default → the compositor renders exactly as before. */
    textOverlay?: boolean;
    textStyle?: "premium" | "impact" | "founder" | "legacy";
  } | null;
}

// Platform → Imagen-supported aspect ratio for the BACKGROUND. Matched to the
// platform's native creative dimensions (the compositor cover-crops the
// background to the exact pixel canvas — see CANVAS_BY_PLATFORM):
//   linkedin 1200×627 · facebook 1200×630 · twitter 1600×900 → 16:9 landscape
//   instagram 1080×1350 → 3:4 portrait
const PLATFORM_ASPECT: Record<string, AspectRatio> = {
  linkedin: "16:9",
  facebook: "16:9",
  twitter: "16:9",
  instagram: "3:4",
  blog: "16:9",
  email: "16:9",
};

// Default asset placements per hierarchy (the compositor's coordinates come
// from these in Phase C). Chosen so headline space (center/upper area) stays
// clear.
const LOGO_PLACEMENT: Record<CreativeHierarchy, Placement> = {
  founder_led: "bottom_right",
  brand_led: "center",
  data_led: "bottom_right",
  quote_led: "bottom_right",
  product_led: "bottom_right",
};
const HEADSHOT_PLACEMENT: Record<CreativeHierarchy, Placement> = {
  founder_led: "right_third",
  quote_led: "bottom_left",
  brand_led: "bottom_left",
  data_led: "bottom_left",
  product_led: "bottom_left",
};

/** "Jane Doe — Founder" → "Jane Doe"; plain labels pass through. */
export function founderNameFromLabel(label: string | null): string | null {
  if (!label) return null;
  const name = label.split(/\s+[—–-]\s+/)[0].trim();
  return name || null;
}

function paletteFromBrand(brand: DbBrand): CreativeBrief["palette"] {
  const colors = brand.brand_colors ?? {};
  const hexes = Object.values(colors).filter(
    (v) => typeof v === "string" && /^#?[0-9a-f]{3,8}$/i.test(v),
  );
  return {
    primary: (colors.primary as string | undefined) ?? hexes[0],
    secondary: (colors.secondary as string | undefined) ?? hexes[1],
    accent: (colors.accent as string | undefined) ?? hexes[2],
  };
}

/**
 * Deterministic last-resort background prompt — used only if the model's
 * prompt fails the forbidden-token check twice. Always safe by construction.
 *
 * When a clean visual_metaphor is available it drives the fallback, so the
 * topic still reaches the image even when the model's own (verbose) prompt
 * tripped the guard (P4 Phase 1). The metaphor is abstract-safe by design; we
 * guard it once more before use, falling back to a plain gradient otherwise.
 */
function safeFallbackBackgroundPrompt(
  palette: CreativeBrief["palette"],
  industry: string | null,
  metaphor?: string,
): string {
  // Sprint 18b — the deterministic fallback now draws from the Creative Direction
  // engine: an INDUSTRY-SPECIFIC cinematic photographic world, brand colour only
  // as in-scene light. No geometry, no reusable overlay.
  const colors = [palette.primary, palette.secondary, palette.accent].filter(Boolean);
  const colorClause = colors.length ? ` (${colors.join(", ")} tones)` : "";
  const cleanMetaphor =
    metaphor && metaphor.trim() && !findForbiddenBackgroundToken(metaphor) ? metaphor.trim() : undefined;
  return fallbackWorldPrompt(industry, colorClause, cleanMetaphor);
}

export class BriefValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefValidationError";
  }
}

/** Sprint 29.1 — one generateCreativeConcept call's telemetry (tokens + measured latency). */
export interface ConceptUsage {
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
}

interface ConceptAttempt {
  concept: CreativeConcept;
  backgroundPromptReplaced: boolean;
  /** Token usage + latency for EACH generateCreativeConcept call made (1-2 per
   *  attempt), surfaced so callers record them in the AI usage ledger. */
  usage: ConceptUsage[];
}

async function composeConceptValidated(
  input: ComposeBriefInput,
  score: HierarchyScore,
  aspectRatio: AspectRatio,
  palette: CreativeBrief["palette"],
  founderName: string | null,
  assetSummary: string,
): Promise<ConceptAttempt> {
  const p = input.brand.profile;
  const brandCtx = {
    name: input.brand.name,
    industry: input.brand.industry,
    positioning: p?.positioning_statement ?? null,
    voiceTone: p?.brand_voice?.tone?.join(", ") || "Professional, clear, modern",
  };
  const contentCtx = {
    title: input.content.title,
    preview: input.content.preview,
    bodyExcerpt: (input.content.body ?? "").slice(0, 2500),
  };
  const topicCtx = input.topic
    ? {
        title: input.topic.title,
        hookAngle: input.topic.hook_angle,
        kind: input.topic.opportunity_kind ?? input.topic.category,
      }
    : null;

  // Up to 2 attempts at a safe background prompt, then deterministic fallback.
  let lastConcept: CreativeConcept | null = null;
  const usage: ConceptUsage[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    const { data: concept, meta } = await generateCreativeConcept({
      brand: brandCtx,
      hierarchy: score.hierarchy,
      platform: input.content.platform,
      aspectRatio,
      palette,
      content: contentCtx,
      topic: topicCtx,
      founderName,
      assetSummary,
      recentDirections: input.recentDirections,
      brandIntelligence: input.intelligence ? renderIntelligenceBlock(input.intelligence) : undefined,
      performanceIntelligence: input.performance ? renderPerformanceBlock(input.performance) : undefined,
      campaignStrategy: input.campaign ? renderCampaignStrategyBlock(input.campaign) : undefined,
    });
    lastConcept = concept;
    usage.push({ tokensInput: meta.tokensInput, tokensOutput: meta.tokensOutput, latencyMs: Date.now() - t0 });
    if (!findForbiddenBackgroundToken(concept.background_prompt)) {
      return { concept, backgroundPromptReplaced: false, usage };
    }
  }
  // Model insisted on forbidden content in the prompt — keep its strategy
  // copy but swap in the deterministic safe background.
  return {
    concept: {
      ...lastConcept!,
      background_prompt: safeFallbackBackgroundPrompt(
        palette,
        input.brand.industry,
        lastConcept!.visual_metaphor,
      ),
    },
    backgroundPromptReplaced: true,
    usage,
  };
}

export interface ComposedBrief {
  brief: CreativeBrief;
  /** Surfaced to logs: model's bg prompt was replaced by the safe fallback. */
  backgroundPromptReplaced: boolean;
  /** Sprint 29.1 — token usage + latency for every generateCreativeConcept call
   *  made while composing this brief (incl. a brand_led recompose). Callers record
   *  these in the AI usage ledger so concept calls are observable like the rest. */
  usage: ConceptUsage[];
}

export async function composeCreativeBrief(
  input: ComposeBriefInput,
): Promise<ComposedBrief> {
  const prefs = (input.brand.creative_preferences ?? {}) as CreativePreferences;
  const contentText = [input.content.title, input.content.preview, input.content.body]
    .filter(Boolean)
    .join("\n");

  const selection = rankHierarchies({
    assets: input.assets,
    platform: input.content.platform,
    opportunityKind: input.topic?.opportunity_kind ?? null,
    topicCategory: input.topic?.category ?? null,
    contentText,
    preferences: prefs,
  });

  const { logo, headshot } = selectAssets(input.assets);
  const founderName = founderNameFromLabel(headshot?.label ?? null);
  const aspectRatio = PLATFORM_ASPECT[input.content.platform] ?? "1:1";
  const palette = paletteFromBrand(input.brand);
  const assetSummary = [
    logo
      ? `logo (${logo.mime_type.replace("image/", "")}${logo.has_alpha ? ", transparent" : ""}, ${logo.width}×${logo.height})`
      : null,
    headshot
      ? `headshot ("${headshot.label ?? "unlabeled"}", ${headshot.width}×${headshot.height})`
      : null,
  ]
    .filter(Boolean)
    .join("; ");

  // ── Attempt 1: top-ranked hierarchy ────────────────────────────────────────
  let score = selection.chosen;
  let attempt = await composeConceptValidated(
    input, score, aspectRatio, palette, founderName, assetSummary,
  );
  // Accumulate concept-call token usage across attempt(s) — incl. recompose.
  const conceptUsage: ConceptUsage[] = [...attempt.usage];
  let modelConfidence = clamp01(attempt.concept.model_confidence);
  let confidence = blendConfidence(score, modelConfidence);
  let forcedBrandLed = false;

  // ── Design rule: confidence < 0.55 → force brand_led ──────────────────────
  if (confidence < CONFIDENCE_FLOOR && score.hierarchy !== "brand_led") {
    const brandLed = selection.ranked.find((r) => r.hierarchy === "brand_led");
    if (brandLed) {
      score = brandLed;
      attempt = await composeConceptValidated(
        input, score, aspectRatio, palette, founderName, assetSummary,
      );
      conceptUsage.push(...attempt.usage);
      modelConfidence = clamp01(attempt.concept.model_confidence);
      confidence = blendConfidence(score, modelConfidence);
      forcedBrandLed = true;
    }
  }

  const h = score.hierarchy;
  const concept = attempt.concept;

  // ── Branding overrides (from /content/generate) ───────────────────────────
  const companyName = input.branding?.companyName?.trim() || input.brand.name;
  const effectiveFounderName = input.branding?.founderName?.trim() || founderName;
  const expertName = input.branding?.expertName?.trim() || null;

  // ── Code-computed usage facts (what the approval gate displays) ───────────
  // A use_logo / use_headshot toggle of `false` suppresses an otherwise-
  // available asset; undefined/true means "use when present".
  const useLogo = logo != null && input.branding?.useLogo !== false;
  const useHeadshot =
    headshot != null &&
    (h === "founder_led" || h === "quote_led") &&
    input.branding?.useHeadshot !== false;

  const brief: CreativeBrief = {
    version: 1,
    hierarchy: h,
    confidence,
    confidence_components: {
      assets: round3(score.assets),
      model: round3(modelConfidence),
      opportunity: round3(score.opportunity),
      platform: round3(score.platform),
    },
    eligible_hierarchies: selection.eligible,
    forced_brand_led: forcedBrandLed,

    visual_tension: (concept.visual_tension ?? "").slice(0, 120),
    visual_metaphor: (concept.visual_metaphor ?? "").slice(0, 400),
    visual_concept: concept.visual_concept.slice(0, 800),
    visual_rationale: concept.visual_rationale.slice(0, 800),
    headline: concept.headline.slice(0, 80),
    subheadline: (concept.subheadline ?? "").slice(0, 120),
    cta: concept.cta.slice(0, 60),
    background_prompt: concept.background_prompt.slice(0, 1000),
    // Creative Memory (Sprint 19) — persist the structured art direction so future
    // creatives recall it and choose a different world.
    creative_direction: concept.creative_direction,
    // Brand Learning Engine (Sprint 22) — record the Creative Intelligence that
    // guided this generation + the internal "chosen because" rationale.
    intelligence: input.intelligence
      ? intelligenceSummary(input.intelligence, input.intelligence.delivered_count >= 1)
      : undefined,
    // Performance Intelligence (Sprint 23) — record the REAL-engagement signals
    // that guided this generation (internal explainability).
    performance: input.performance
      ? performanceSummary(input.performance, input.performance.measured_count >= 1)
      : undefined,
    // Campaign Strategy (Sprint 24) — record the campaign that governed this
    // creative + the strategist's reasoning + recommended package (internal).
    campaign: input.campaign ? campaignSummary(input.campaign, true) : undefined,

    logo_usage: useLogo
      ? {
          use: true,
          asset_id: logo.id,
          placement: LOGO_PLACEMENT[h],
          reason:
            h === "brand_led"
              ? "Brand-led: the logo is the visual anchor of the composition."
              : "Brands the composition without competing with the hero element.",
        }
      : {
          use: false,
          reason: "No logo uploaded — the company name wordmark is rendered as text instead.",
        },
    headshot_usage: useHeadshot
      ? {
          use: true,
          asset_id: headshot.id,
          placement: HEADSHOT_PLACEMENT[h],
          reason:
            h === "founder_led"
              ? "Founder-led: the real (never synthesized) headshot is the hero."
              : "Attributes the quote to a real face — credibility without synthesis.",
        }
      : {
          use: false,
          reason:
            headshot == null
              ? "No headshot uploaded."
              : `Not used in a ${h.replace("_", "-")} composition.`,
        },
    company_name_usage: {
      use: true,
      name: companyName,
      treatment: useLogo
        ? "Carried by the composited logo; name not duplicated as text."
        : "Rendered as a typographic wordmark in the bottom brand bar.",
    },
    founder_name_usage:
      useHeadshot && effectiveFounderName
        ? {
            use: true,
            name: effectiveFounderName,
            treatment: "Small attribution line next to the composited headshot.",
          }
        : {
            use: false,
            treatment:
              effectiveFounderName == null
                ? "No founder identified (label a headshot with the person's name to enable)."
                : `Not shown in a ${h.replace("_", "-")} composition.`,
          },
    expert_name_usage: expertName
      ? {
          use: true,
          name: expertName,
          treatment: "Credited as the subject-matter expert in the attribution line.",
        }
      : { use: false, treatment: "No expert credited for this creative." },

    assets_available: {
      logo: logo != null,
      founder_headshot: headshot != null,
    },

    // Text Overlay (COS migration M2C) — pass the shared Creative OS control
    // through to the compositor. Absent unless the caller set it → unchanged.
    ...(input.branding?.textOverlay !== undefined ? { text_overlay: input.branding.textOverlay } : {}),
    ...(input.branding?.textStyle ? { text_style: input.branding.textStyle } : {}),

    aspect_ratio: aspectRatio,
    palette,
    platform: input.content.platform,
    topic_title: input.topic?.title ?? null,
    opportunity_kind: input.topic?.opportunity_kind ?? null,
  };

  // ── Final hard validation — the gate never displays an invalid brief ──────
  const parsed = creativeBriefSchema.safeParse(brief);
  if (!parsed.success) {
    throw new BriefValidationError(
      `Composed brief failed validation: ${parsed.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ")}`,
    );
  }
  // Invariants the schema can't express:
  if (parsed.data.hierarchy === "founder_led" && !parsed.data.headshot_usage.use) {
    throw new BriefValidationError("founder_led brief without a headshot — engine bug");
  }
  const violation = findForbiddenBackgroundToken(parsed.data.background_prompt);
  if (violation) {
    throw new BriefValidationError(
      `background_prompt contains forbidden token "${violation}" after fallback — refusing`,
    );
  }

  return { brief: parsed.data, backgroundPromptReplaced: attempt.backgroundPromptReplaced, usage: conceptUsage };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
