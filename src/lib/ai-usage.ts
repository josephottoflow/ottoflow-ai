/**
 * Unified AI Usage Ledger (Sprint 29) — the ONE telemetry pipeline.
 *
 * Every AI call (Gemini text/vision, Imagen, video) records exactly one row in
 * the EXISTING ai_usage_ledger table (migration 008) — no new table, no
 * duplicated telemetry. Token usage is REUSED from Gemini's usageMetadata (via
 * GenerationMeta), latency is measured at the call site, cost is estimated from a
 * central pricing table. The rich Sprint-29 fields (campaign/creative id,
 * latency, token split, success, retry, revision, customer cost) live in the
 * existing `metadata` jsonb so no migration is required.
 *
 * recordAIUsage is BEST-EFFORT: a telemetry failure must NEVER break an AI call
 * or a render. getOpsMetrics aggregates the ledger for the internal ops
 * dashboard + billing-readiness measurements — all from MEASURED data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Pricing (ASSUMPTION — public list prices, override via env) ─────────────
// These are the ONLY estimates in the pipeline; everything else is measured.
// Update as provider pricing changes; per-call cost is computed from real units.
function num(env: string | undefined, dflt: number): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
const PRICING = {
  // Gemini 2.x Flash class, USD per 1M tokens.
  geminiInputPerM: num(process.env.GEMINI_INPUT_PER_M, 0.075),
  geminiOutputPerM: num(process.env.GEMINI_OUTPUT_PER_M, 0.3),
  // Imagen 4 fast, USD per generated image.
  imagenPerImage: num(process.env.IMAGEN_PER_IMAGE, 0.02),
  // Video (Seedance etc.), USD per generated second.
  videoPerSecond: num(process.env.VIDEO_PER_SECOND, 0.05),
  // Customer-facing multiple over raw provider cost (1.0 = pass-through). The
  // sprint exposes measurements for billing; it does NOT implement billing.
  customerMarkup: num(process.env.AI_COST_MARKUP, 1.0),
};

export type AIProvider = "gemini" | "imagen" | "video";

export interface CostEstimate {
  provider_usd: number;
  customer_usd: number;
}

/** Estimate provider + customer cost from MEASURED units. */
export function estimateCost(
  provider: AIProvider,
  units: { tokensInput?: number; tokensOutput?: number; images?: number; videoSeconds?: number },
): CostEstimate {
  let provider_usd = 0;
  if (provider === "gemini") {
    provider_usd =
      ((units.tokensInput ?? 0) / 1_000_000) * PRICING.geminiInputPerM +
      ((units.tokensOutput ?? 0) / 1_000_000) * PRICING.geminiOutputPerM;
  } else if (provider === "imagen") {
    provider_usd = (units.images ?? 0) * PRICING.imagenPerImage;
  } else if (provider === "video") {
    provider_usd = (units.videoSeconds ?? 0) * PRICING.videoPerSecond;
  }
  provider_usd = Math.round(provider_usd * 1e6) / 1e6;
  const customer_usd = Math.round(provider_usd * PRICING.customerMarkup * 1e6) / 1e6;
  return { provider_usd, customer_usd };
}

export interface AIUsageRecord {
  userId: string;
  provider: AIProvider;
  /** The function called, e.g. generateCreativeConcept / reviewCreativeImage. */
  operation: string;
  /** Coarse bucket for cost-by-feature, e.g. 'creative' | 'campaign' | 'review' | 'improvement'. */
  purpose?: string;
  model?: string;
  campaignId?: string | null;
  creativeId?: string | null;
  contentItemId?: string | null;
  /** Date.now() at call start / end → latency is measured, not estimated. */
  startedAt: number;
  completedAt: number;
  success: boolean;
  failureReason?: string | null;
  tokensInput?: number;
  tokensOutput?: number;
  images?: number;
  videoSeconds?: number;
  retryCount?: number;
  cacheHit?: boolean;
  /** Self-improvement revision attempt (0 = first generation). */
  revisionAttempt?: number;
  requestId?: string;
}

/**
 * Record ONE AI call. Best-effort: never throws, never blocks the caller. Writes
 * the existing typed columns + the rich Sprint-29 fields into `metadata` jsonb.
 */
export async function recordAIUsage(admin: SupabaseClient, r: AIUsageRecord): Promise<void> {
  try {
    const cost = estimateCost(r.provider, r);
    const latency_ms = Math.max(0, r.completedAt - r.startedAt);
    const units =
      r.provider === "imagen"
        ? r.images ?? 0
        : r.provider === "video"
          ? r.videoSeconds ?? 0
          : (r.tokensInput ?? 0) + (r.tokensOutput ?? 0);
    const unit_type = r.provider === "imagen" ? "images" : r.provider === "video" ? "seconds" : "tokens";

    await admin.from("ai_usage_ledger").insert({
      user_id: r.userId,
      provider: r.provider,
      operation: r.operation,
      cost_usd: cost.provider_usd,
      units,
      unit_type,
      metadata: {
        purpose: r.purpose ?? null,
        model: r.model ?? null,
        campaign_id: r.campaignId ?? null,
        creative_id: r.creativeId ?? null,
        content_item_id: r.contentItemId ?? null,
        latency_ms,
        success: r.success,
        failure_reason: r.failureReason ?? null,
        tokens_input: r.tokensInput ?? null,
        tokens_output: r.tokensOutput ?? null,
        images_generated: r.images ?? null,
        video_seconds: r.videoSeconds ?? null,
        est_provider_cost_usd: cost.provider_usd,
        est_customer_cost_usd: cost.customer_usd,
        retry_count: r.retryCount ?? 0,
        cache_hit: r.cacheHit ?? false,
        revision_attempt: r.revisionAttempt ?? 0,
        request_id: r.requestId ?? null,
      },
    });
  } catch (err) {
    // Telemetry must never break the pipeline. Quiet — don't spam Sentry.
    console.warn("[ai-usage] record failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

// ─── Operational metrics (Phase 3/4/5) — all from MEASURED ledger data ───────

interface LedgerRow {
  provider: string;
  operation: string;
  cost_usd: number;
  user_id: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface OpsMetrics {
  window_days: number;
  generated_at: string;
  total_calls: number;
  total_provider_cost_usd: number;
  total_customer_cost_usd: number;
  failure_rate: number;
  retry_rate: number;
  avg_latency_ms: number;
  by_provider: Array<{ provider: string; calls: number; cost_usd: number; avg_latency_ms: number; failures: number; failure_rate: number }>;
  by_operation: Array<{ operation: string; calls: number; cost_usd: number; avg_latency_ms: number }>;
  by_day: Array<{ day: string; cost_usd: number; calls: number }>;
  /** Billing readiness — spend per customer / campaign / creative. */
  by_user: Array<{ user_id: string; calls: number; cost_usd: number }>;
  by_campaign: Array<{ campaign_id: string; calls: number; cost_usd: number }>;
  by_creative: Array<{ creative_id: string; calls: number; cost_usd: number }>;
  /** Derived unit economics. */
  cost_per_creative_usd: number | null;
  cost_per_campaign_usd: number | null;
  distinct_creatives: number;
  distinct_campaigns: number;
}

const round = (n: number, p = 6) => Math.round(n * 10 ** p) / 10 ** p;

/** Aggregate the ledger over a window. Reads MEASURED rows; no estimates added. */
export async function getOpsMetrics(admin: SupabaseClient, windowDays = 30): Promise<OpsMetrics> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const empty: OpsMetrics = {
    window_days: windowDays, generated_at: new Date().toISOString(),
    total_calls: 0, total_provider_cost_usd: 0, total_customer_cost_usd: 0,
    failure_rate: 0, retry_rate: 0, avg_latency_ms: 0,
    by_provider: [], by_operation: [], by_day: [], by_user: [], by_campaign: [], by_creative: [],
    cost_per_creative_usd: null, cost_per_campaign_usd: null, distinct_creatives: 0, distinct_campaigns: 0,
  };
  let rows: LedgerRow[] = [];
  try {
    const { data } = await admin
      .from("ai_usage_ledger")
      .select("provider, operation, cost_usd, user_id, created_at, metadata")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20000);
    rows = (data ?? []) as LedgerRow[];
  } catch {
    return empty;
  }
  if (rows.length === 0) return empty;

  const md = (r: LedgerRow) => (r.metadata ?? {}) as Record<string, unknown>;
  const numf = (v: unknown) => (typeof v === "number" ? v : 0);
  const customerOf = (r: LedgerRow) => numf(md(r).est_customer_cost_usd) || r.cost_usd;

  let totalProvider = 0, totalCustomer = 0, latencySum = 0, latencyN = 0, failures = 0, retries = 0;
  const prov = new Map<string, { calls: number; cost: number; lat: number; latN: number; fail: number }>();
  const op = new Map<string, { calls: number; cost: number; lat: number; latN: number }>();
  const day = new Map<string, { cost: number; calls: number }>();
  const user = new Map<string, { calls: number; cost: number }>();
  const camp = new Map<string, { calls: number; cost: number }>();
  const crea = new Map<string, { calls: number; cost: number }>();

  for (const r of rows) {
    const m = md(r);
    const cost = r.cost_usd ?? 0;
    totalProvider += cost;
    totalCustomer += customerOf(r);
    const lat = numf(m.latency_ms);
    if (lat > 0) { latencySum += lat; latencyN++; }
    if (m.success === false) failures++;
    if (numf(m.retry_count) > 0) retries++;

    const p = prov.get(r.provider) ?? { calls: 0, cost: 0, lat: 0, latN: 0, fail: 0 };
    p.calls++; p.cost += cost; if (lat > 0) { p.lat += lat; p.latN++; } if (m.success === false) p.fail++;
    prov.set(r.provider, p);

    const o = op.get(r.operation) ?? { calls: 0, cost: 0, lat: 0, latN: 0 };
    o.calls++; o.cost += cost; if (lat > 0) { o.lat += lat; o.latN++; }
    op.set(r.operation, o);

    const d = r.created_at.slice(0, 10);
    const dd = day.get(d) ?? { cost: 0, calls: 0 }; dd.cost += cost; dd.calls++; day.set(d, dd);

    const u = user.get(r.user_id) ?? { calls: 0, cost: 0 }; u.calls++; u.cost += cost; user.set(r.user_id, u);

    const cid = m.campaign_id as string | null;
    if (cid) { const c = camp.get(cid) ?? { calls: 0, cost: 0 }; c.calls++; c.cost += cost; camp.set(cid, c); }
    const rid = m.creative_id as string | null;
    if (rid) { const c = crea.get(rid) ?? { calls: 0, cost: 0 }; c.calls++; c.cost += cost; crea.set(rid, c); }
  }

  const sortCost = <T extends { cost_usd: number }>(a: T[]) => a.sort((x, y) => y.cost_usd - x.cost_usd);
  return {
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    total_calls: rows.length,
    total_provider_cost_usd: round(totalProvider),
    total_customer_cost_usd: round(totalCustomer),
    failure_rate: round(failures / rows.length, 4),
    retry_rate: round(retries / rows.length, 4),
    avg_latency_ms: latencyN ? Math.round(latencySum / latencyN) : 0,
    by_provider: [...prov.entries()].map(([provider, v]) => ({
      provider, calls: v.calls, cost_usd: round(v.cost), avg_latency_ms: v.latN ? Math.round(v.lat / v.latN) : 0,
      failures: v.fail, failure_rate: round(v.fail / v.calls, 4),
    })).sort((a, b) => b.cost_usd - a.cost_usd),
    by_operation: [...op.entries()].map(([operation, v]) => ({
      operation, calls: v.calls, cost_usd: round(v.cost), avg_latency_ms: v.latN ? Math.round(v.lat / v.latN) : 0,
    })).sort((a, b) => b.cost_usd - a.cost_usd),
    by_day: [...day.entries()].map(([d, v]) => ({ day: d, cost_usd: round(v.cost), calls: v.calls })).sort((a, b) => a.day.localeCompare(b.day)),
    by_user: sortCost([...user.entries()].map(([user_id, v]) => ({ user_id, calls: v.calls, cost_usd: round(v.cost) }))).slice(0, 50),
    by_campaign: sortCost([...camp.entries()].map(([campaign_id, v]) => ({ campaign_id, calls: v.calls, cost_usd: round(v.cost) }))).slice(0, 50),
    by_creative: sortCost([...crea.entries()].map(([creative_id, v]) => ({ creative_id, calls: v.calls, cost_usd: round(v.cost) }))).slice(0, 50),
    cost_per_creative_usd: crea.size ? round(totalProvider / crea.size) : null,
    cost_per_campaign_usd: camp.size ? round(totalProvider / camp.size) : null,
    distinct_creatives: crea.size,
    distinct_campaigns: camp.size,
  };
}
