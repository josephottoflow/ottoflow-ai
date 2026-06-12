/**
 * Creative hierarchy engine (Phase B) — pure, code-computed, explainable.
 * No AI calls in this module.
 *
 * Selection pipeline:
 *   1. eligibility — which hierarchies the brand's assets + content support
 *   2. component scores per eligible hierarchy:
 *        assets       (0.40) how well the asset library backs the hierarchy
 *        opportunity  (0.20) fit with the topic's detection lens / category
 *        platform     (0.10) fit with where the post will run
 *      (the model component (0.30) arrives later, from the concept call's
 *       self-assessed fit — see brief.ts)
 *   3. rank by provisional score, nudged by brands.creative_preferences
 *      (read-only v1: preferred/platform/avoid lists shift ranking ±0.1)
 *   4. brief.ts blends in the model component; if the final confidence lands
 *      under CONFIDENCE_FLOOR (0.55) the engine forces brand_led — the
 *      hierarchy that degrades most gracefully with thin inputs.
 */
import type { DbBrandAsset } from "@/lib/types";
import {
  ACTIVE_HIERARCHIES,
  type CreativeHierarchy,
} from "./types";

export interface CreativePreferences {
  preferred_hierarchy?: string;
  platform_hierarchy?: Record<string, string>;
  avoid_hierarchies?: string[];
  notes?: string;
}

export interface HierarchyInputs {
  assets: DbBrandAsset[];
  platform: string;
  /** brand_topics lens for evidence-mined ideas (pain_point|theme|competitor_gap|trend). */
  opportunityKind: string | null;
  /** brand_topics.category (educational|founder-story|…). */
  topicCategory: string | null;
  /** Title + body text, scanned for stat signals (data_led eligibility). */
  contentText: string;
  preferences: CreativePreferences;
}

export interface HierarchyScore {
  hierarchy: CreativeHierarchy;
  assets: number;
  opportunity: number;
  platform: number;
  /** 0.40·assets + 0.20·opportunity + 0.10·platform, normalized to 0-1 over its 0.70 ceiling. */
  provisional: number;
  /** ±0.1 ranking nudge from brands.creative_preferences (read-only v1). */
  preferenceNudge: number;
}

export interface HierarchySelection {
  eligible: CreativeHierarchy[];
  ranked: HierarchyScore[];
  chosen: HierarchyScore;
}

// ── Stat signal: a number worth leading with (data_led eligibility) ─────────
// Percentages, currency, multipliers, or standalone 2+ digit figures.
const STAT_SIGNAL = /(\d+(?:\.\d+)?\s*%|[$€£]\s*\d|(?:\d+(?:\.\d+)?)\s*[x×]\b|\b\d{2,}\b)/;

export function hasStatSignal(text: string): boolean {
  return STAT_SIGNAL.test(text);
}

// ── Platform fit matrix (0-1) ────────────────────────────────────────────────
// Editorial judgment, intentionally code-owned so it's reviewable and tunable.
const PLATFORM_FIT: Record<string, Partial<Record<CreativeHierarchy, number>>> = {
  linkedin:  { founder_led: 0.9,  data_led: 0.85, quote_led: 0.7,  brand_led: 0.6 },
  twitter:   { data_led: 0.9,     quote_led: 0.8, founder_led: 0.6, brand_led: 0.55 },
  facebook:  { quote_led: 0.75,   founder_led: 0.7, brand_led: 0.7, data_led: 0.6 },
  instagram: { brand_led: 0.85,   quote_led: 0.8, founder_led: 0.7, data_led: 0.55 },
  blog:      { data_led: 0.8,     brand_led: 0.75, quote_led: 0.6, founder_led: 0.55 },
  email:     { brand_led: 0.8,    data_led: 0.7,  founder_led: 0.6, quote_led: 0.55 },
};
const PLATFORM_FIT_DEFAULT = 0.6;

// ── Opportunity fit matrix (0-1) ─────────────────────────────────────────────
// Lens → hierarchy alignment: data_led shines on trends/stats, founder_led on
// pain points (empathy from a person), quote_led on repeated themes,
// brand_led on competitor gaps (plant the flag).
const LENS_FIT: Record<string, Partial<Record<CreativeHierarchy, number>>> = {
  pain_point:     { founder_led: 0.9, quote_led: 0.75, data_led: 0.6,  brand_led: 0.6 },
  theme:          { quote_led: 0.85,  brand_led: 0.7,  founder_led: 0.65, data_led: 0.6 },
  competitor_gap: { brand_led: 0.85,  data_led: 0.75,  founder_led: 0.6, quote_led: 0.55 },
  trend:          { data_led: 0.9,    quote_led: 0.65, brand_led: 0.6,  founder_led: 0.55 },
};
// Topic category fallback when there's no mining lens.
const CATEGORY_FIT: Record<string, Partial<Record<CreativeHierarchy, number>>> = {
  "founder-story":    { founder_led: 0.95, quote_led: 0.7 },
  "educational":      { data_led: 0.8, quote_led: 0.65 },
  "problem-solution": { founder_led: 0.75, data_led: 0.7 },
  "listicle":         { data_led: 0.75, brand_led: 0.65 },
  "storytelling":     { quote_led: 0.8, founder_led: 0.7 },
  "ugc":              { quote_led: 0.75, brand_led: 0.6 },
  "product-demo":     { brand_led: 0.75, data_led: 0.6 },
};
const OPPORTUNITY_FIT_DEFAULT = 0.5;

function pickAsset(assets: DbBrandAsset[], kind: DbBrandAsset["kind"]): DbBrandAsset | null {
  // Newest upload of the kind wins (assets arrive newest-first from the API,
  // but don't rely on caller ordering).
  const matching = assets.filter((a) => a.kind === kind);
  if (matching.length === 0) return null;
  return [...matching].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function selectAssets(assets: DbBrandAsset[]): {
  logo: DbBrandAsset | null;
  headshot: DbBrandAsset | null;
} {
  return {
    logo: pickAsset(assets, "logo"),
    headshot: pickAsset(assets, "headshot"),
  };
}

function assetScore(h: CreativeHierarchy, logo: DbBrandAsset | null, headshot: DbBrandAsset | null): number {
  switch (h) {
    case "founder_led":
      // Headshot is the hero; logo completes the lockup.
      return headshot ? (logo ? 1.0 : 0.75) : 0;
    case "brand_led":
      // Works without any asset (type + palette carry it) but a logo is the point.
      return logo ? 1.0 : 0.35;
    case "data_led":
      // The stat is the hero; logo only brands the corner.
      return logo ? 0.85 : 0.55;
    case "quote_led":
      // The words are the hero; headshot attribution elevates it.
      return headshot ? (logo ? 0.95 : 0.8) : logo ? 0.7 : 0.5;
    default:
      return 0;
  }
}

function opportunityScore(
  h: CreativeHierarchy,
  opportunityKind: string | null,
  topicCategory: string | null,
): number {
  if (opportunityKind && LENS_FIT[opportunityKind]?.[h] != null) {
    return LENS_FIT[opportunityKind][h]!;
  }
  if (topicCategory && CATEGORY_FIT[topicCategory]?.[h] != null) {
    return CATEGORY_FIT[topicCategory][h]!;
  }
  return OPPORTUNITY_FIT_DEFAULT;
}

function platformScore(h: CreativeHierarchy, platform: string): number {
  return PLATFORM_FIT[platform]?.[h] ?? PLATFORM_FIT_DEFAULT;
}

function preferenceNudge(
  h: CreativeHierarchy,
  platform: string,
  prefs: CreativePreferences,
): number {
  let nudge = 0;
  if (prefs.preferred_hierarchy === h) nudge += 0.1;
  if (prefs.platform_hierarchy?.[platform] === h) nudge += 0.1;
  if (prefs.avoid_hierarchies?.includes(h)) nudge -= 0.1;
  return Math.max(-0.1, Math.min(0.2, nudge));
}

/**
 * Compute eligibility + component scores and rank the active hierarchies.
 * Throws only if nothing is eligible — impossible in practice, since
 * brand_led and quote_led have no hard asset requirements.
 */
export function rankHierarchies(input: HierarchyInputs): HierarchySelection {
  const { logo, headshot } = selectAssets(input.assets);

  const eligible = ACTIVE_HIERARCHIES.filter((h) => {
    switch (h) {
      case "founder_led":
        return headshot != null; // a real headshot is non-negotiable — faces are never synthesized
      case "data_led":
        return hasStatSignal(input.contentText);
      case "brand_led":
      case "quote_led":
        return true;
      default:
        return false;
    }
  });

  const ranked: HierarchyScore[] = eligible
    .map((h) => {
      const a = assetScore(h, logo, headshot);
      const o = opportunityScore(h, input.opportunityKind, input.topicCategory);
      const p = platformScore(h, input.platform);
      // Provisional = the three code components over their combined 0.70
      // weight ceiling, so it's comparable to the final 0-1 confidence.
      const provisional = (0.4 * a + 0.2 * o + 0.1 * p) / 0.7;
      return {
        hierarchy: h,
        assets: a,
        opportunity: o,
        platform: p,
        provisional,
        preferenceNudge: preferenceNudge(h, input.platform, input.preferences),
      };
    })
    .sort(
      (x, y) =>
        y.provisional + y.preferenceNudge - (x.provisional + x.preferenceNudge),
    );

  if (ranked.length === 0) {
    throw new Error("No eligible creative hierarchy — engine invariant broken");
  }
  return { eligible, ranked, chosen: ranked[0] };
}

/** Blend the model's self-assessed fit into the final confidence. */
export function blendConfidence(
  score: Pick<HierarchyScore, "assets" | "opportunity" | "platform">,
  modelConfidence: number,
): number {
  const c =
    0.4 * score.assets +
    0.3 * modelConfidence +
    0.2 * score.opportunity +
    0.1 * score.platform;
  return Math.round(c * 1000) / 1000;
}
