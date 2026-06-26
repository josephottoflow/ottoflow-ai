/**
 * Campaign Execution Engine (Sprint 25) — pure helpers.
 *
 * Turns a CampaignStrategy's package PLAN (Sprint 24) into an ordered asset
 * queue, synthesizes the per-asset content that seeds each creative brief, and
 * evaluates the finished campaign as a WHOLE (Campaign QA) — coverage,
 * consistency, diversity, readiness + an overall quality score. No I/O here; the
 * worker does the DB writes + render enqueues, the API computes QA/progress on
 * read.
 */
import type { CampaignStrategy } from "@/lib/gemini";
import { clusterKey } from "./brand-intelligence";

export interface PackageAsset {
  role: string;
  format: string;
  angle: string;
}

/** Canonical generation order — hero anchors the campaign, retargeting closes it. */
const ROLE_ORDER: Array<{ match: RegExp; rank: number }> = [
  { match: /hero/i, rank: 0 },
  { match: /support/i, rank: 1 },
  { match: /carousel/i, rank: 2 },
  { match: /quote/i, rank: 3 },
  { match: /video|reel|short/i, rank: 4 },
  { match: /follow/i, rank: 5 },
  { match: /retarget/i, rank: 6 },
];

function roleRank(role: string): number {
  return ROLE_ORDER.find((r) => r.match.test(role))?.rank ?? 3.5;
}

/** A sensible default package when the strategist returned none. */
export const DEFAULT_PACKAGE: PackageAsset[] = [
  { role: "Hero creative", format: "single image", angle: "the campaign's central promise, stated boldly" },
  { role: "Supporting creative", format: "single image", angle: "a concrete proof point that backs the promise" },
  { role: "Quote graphic", format: "single image", angle: "a punchy line distilled from the message" },
  { role: "Follow-up post", format: "single image", angle: "a next-step nudge toward the CTA" },
];

/** Order a package for dependency-aware generation (hero first). */
export function orderPackage(pkg: PackageAsset[] | undefined | null): PackageAsset[] {
  const items = (pkg ?? []).filter((a) => a && a.role);
  const base = items.length ? items : DEFAULT_PACKAGE;
  return [...base]
    .map((a, i) => ({ a, i }))
    .sort((x, y) => roleRank(x.a.role) - roleRank(y.a.role) || x.i - y.i)
    .map(({ a }) => a);
}

/** Synthesize the content that seeds an asset's creative brief from the strategy. */
export function synthesizeAssetContent(
  strategy: CampaignStrategy,
  asset: PackageAsset,
  platform: string,
): { title: string; preview: string; body: string; platform: string } {
  const title = `${asset.role}: ${(strategy.core_message || asset.angle).slice(0, 70)}`;
  const preview = asset.angle.slice(0, 160);
  const body = [
    strategy.core_message,
    "",
    `Campaign objective: ${strategy.primary_objective}.`,
    `Audience: ${strategy.audience} (${strategy.awareness_stage}).`,
    `This asset is the ${asset.role} (${asset.format}). ${asset.angle}.`,
    `Desired emotion: ${strategy.desired_emotion}. Primary CTA: ${strategy.primary_cta}.`,
    strategy.secondary_objective ? `Secondary objective: ${strategy.secondary_objective}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { title, preview, body, platform };
}

// ─── Campaign QA — evaluate the campaign as a whole ──────────────────────────

/** One asset reduced to what QA + progress need (read from its creative brief). */
export interface AssetView {
  role: string;
  status: string; // content_creatives.status
  headline: string;
  cta: string;
  world: string;
  funnel_position: string;
}

export interface CampaignQA {
  /** How fully the planned roles were realized + role variety. */
  coverage_score: number;
  /** Messaging + branding consistency across assets. */
  consistency_score: number;
  /** Visual variety — each asset contributes something different. */
  diversity_score: number;
  /** How ready the campaign is to ship (rendered assets). */
  readiness_score: number;
  /** Weighted overall quality (0-100). */
  overall_score: number;
  issues: string[];
}

const norm = (s: string) => clusterKey(s || "");

/** Evaluate a campaign's assets as a set. Deterministic; advisory. */
export function computeCampaignQA(assets: AssetView[], strategy: CampaignStrategy | null): CampaignQA {
  const n = assets.length;
  if (n === 0) {
    return { coverage_score: 0, consistency_score: 0, diversity_score: 0, readiness_score: 0, overall_score: 0, issues: ["No assets generated yet."] };
  }
  const issues: string[] = [];

  // Coverage — distinct roles realized vs planned package size.
  const distinctRoles = new Set(assets.map((a) => roleRank(a.role))).size;
  const planned = strategy?.package?.length || assets.length;
  const coverage = Math.min(100, Math.round((distinctRoles / Math.max(planned, 1)) * 100));
  if (distinctRoles < 3) issues.push("Limited role coverage — add more distinct asset types.");

  // Diversity — distinct worlds + distinct headlines.
  const worldKeys = new Set(assets.map((a) => norm(a.world)).filter(Boolean));
  const headlineKeys = assets.map((a) => norm(a.headline)).filter(Boolean);
  const dupHeadlines = headlineKeys.length - new Set(headlineKeys).size;
  const worldDiversity = assets.length ? worldKeys.size / assets.length : 1;
  let diversity = Math.round(worldDiversity * 100);
  if (dupHeadlines > 0) {
    diversity = Math.max(0, diversity - dupHeadlines * 15);
    issues.push(`${dupHeadlines} asset(s) repeat a headline — every asset should say something different.`);
  }
  if (worldKeys.size < Math.min(assets.length, 3) && assets.length >= 3) {
    issues.push("Visual worlds are too similar across assets — increase visual diversity.");
  }

  // Consistency — varied CTAs (good) but one coherent campaign. Penalize empties.
  const ctaKeys = assets.map((a) => norm(a.cta)).filter(Boolean);
  const distinctCtas = new Set(ctaKeys).size;
  const missing = assets.filter((a) => !a.headline || !a.cta).length;
  let consistency = 90;
  if (missing > 0) {
    consistency -= missing * 12;
    issues.push(`${missing} asset(s) missing a headline or CTA.`);
  }
  if (assets.length >= 3 && distinctCtas <= 1) {
    consistency -= 8;
    issues.push("CTAs are not varied across the funnel.");
  }
  consistency = Math.max(0, Math.min(100, consistency));

  // Readiness — fraction rendered.
  const ready = assets.filter((a) => a.status === "ready").length;
  const failed = assets.filter((a) => a.status === "failed").length;
  const readiness = Math.round((ready / n) * 100);
  if (failed > 0) issues.push(`${failed} asset(s) failed to generate.`);

  const overall = Math.round(coverage * 0.25 + consistency * 0.25 + diversity * 0.25 + readiness * 0.25);

  return {
    coverage_score: coverage,
    consistency_score: consistency,
    diversity_score: diversity,
    readiness_score: readiness,
    overall_score: overall,
    issues,
  };
}

export interface CampaignProgress {
  total: number;
  ready: number;
  generating: number;
  failed: number;
  percent: number;
  label: string;
  /** All assets reached a terminal state (ready or failed). */
  done: boolean;
}

export function computeProgress(assets: Array<{ status: string }>): CampaignProgress {
  const total = assets.length;
  const ready = assets.filter((a) => a.status === "ready").length;
  const failed = assets.filter((a) => a.status === "failed").length;
  const generating = total - ready - failed;
  const percent = total ? Math.round((ready / total) * 100) : 0;
  return {
    total,
    ready,
    generating,
    failed,
    percent,
    label: total ? `${ready} of ${total} assets complete` : "Planning campaign…",
    done: total > 0 && ready + failed === total,
  };
}
