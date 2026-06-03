/**
 * User AI budget helpers (B1.R1).
 *
 * Two responsibilities:
 *   1. CHECK whether a user is allowed to start a new generation
 *      (before `/api/generate` enqueues anything).
 *   2. RECORD spend after every paid API call. The worker + route
 *      both call recordAIUsage().
 *
 * Pre-flight checks use the admin client (we want to read the budget
 * even for users who haven't initialized one). Record happens server-
 * side; service_role bypasses RLS, but we still pass user_id explicitly.
 */
import "server-only";
import { createAdminClient } from "./supabase";
import { captureFallback } from "./observability";

const DEFAULT_HARD_CAP_USD = Number(process.env.AI_DEFAULT_HARD_CAP_USD ?? "5");
const DEFAULT_SOFT_CAP_USD = Number(process.env.AI_DEFAULT_SOFT_CAP_USD ?? "3.5");

export interface BudgetStatus {
  /** True when the user can submit a new generation. */
  allowed: boolean;
  /** True when the user is past soft cap (warn, still allow). */
  pastSoft: boolean;
  /** Stable code so callers can branch on the reason. */
  reason?: "hard_cap" | "soft_cap_warn" | "first_time_user" | "ok";
  monthlyHardCapUsd: number;
  monthlyUsedUsd: number;
  monthlyStart: string;
}

/**
 * Determine whether a user can submit a new generation. Pre-creates a
 * budget row at default caps if missing. Service_role bypasses RLS.
 */
export async function getBudgetStatus(userId: string): Promise<BudgetStatus> {
  const admin = createAdminClient();

  // Upsert at default caps so first-time users don't 5xx the route.
  // ON CONFLICT DO NOTHING preserves any custom caps an admin set later.
  await admin
    .from("user_budgets")
    .upsert(
      [
        {
          user_id: userId,
          monthly_hard_cap_usd: DEFAULT_HARD_CAP_USD,
          monthly_soft_cap_usd: DEFAULT_SOFT_CAP_USD,
        },
      ],
      { onConflict: "user_id", ignoreDuplicates: true },
    );

  const { data, error } = await admin
    .from("user_budgets")
    .select(
      "user_id, monthly_hard_cap_usd, monthly_soft_cap_usd, current_month_used_usd, current_month_start, is_capped",
    )
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    captureFallback("budget.status_failed", error, { userId });
    // Fail OPEN — if the budget service is broken, don't block users.
    // We log the breakage to Sentry so ops sees the problem.
    return {
      allowed: true,
      pastSoft: false,
      reason: "first_time_user",
      monthlyHardCapUsd: DEFAULT_HARD_CAP_USD,
      monthlyUsedUsd: 0,
      monthlyStart: new Date().toISOString().slice(0, 10),
    };
  }

  const hardCap = Number(data.monthly_hard_cap_usd);
  const softCap = Number(data.monthly_soft_cap_usd);
  const used = Number(data.current_month_used_usd);
  const start = data.current_month_start as string;

  if (data.is_capped || used >= hardCap) {
    return {
      allowed: false,
      pastSoft: true,
      reason: "hard_cap",
      monthlyHardCapUsd: hardCap,
      monthlyUsedUsd: used,
      monthlyStart: start,
    };
  }
  if (used >= softCap) {
    return {
      allowed: true,
      pastSoft: true,
      reason: "soft_cap_warn",
      monthlyHardCapUsd: hardCap,
      monthlyUsedUsd: used,
      monthlyStart: start,
    };
  }
  return {
    allowed: true,
    pastSoft: false,
    reason: "ok",
    monthlyHardCapUsd: hardCap,
    monthlyUsedUsd: used,
    monthlyStart: start,
  };
}

/**
 * Record an AI usage event. Idempotent at the SQL function level
 * (each call appends a new ledger row).
 *
 * Fire-and-forget callers should still await the promise — the call
 * resolves in <50ms and we want the cap check on the NEXT request to
 * see the updated total.
 */
export async function recordAIUsage(input: {
  userId: string;
  renderJobId?: string | null;
  provider: "gemini" | "elevenlabs" | "runway" | "luma";
  operation: string;
  costUsd: number;
  units?: number;
  unitType?: "tokens" | "chars" | "seconds" | "clips";
  metadata?: Record<string, unknown>;
}): Promise<{ currentMonthUsedUsd: number; isCapped: boolean } | null> {
  if (!input.costUsd || input.costUsd <= 0) return null; // skip free calls
  const admin = createAdminClient();
  try {
    const { data, error } = await admin.rpc(
      "record_ai_usage" as never,
      {
        p_user_id: input.userId,
        p_render_job_id: input.renderJobId ?? null,
        p_provider: input.provider,
        p_operation: input.operation,
        p_cost_usd: input.costUsd,
        p_units: input.units ?? null,
        p_unit_type: input.unitType ?? null,
        p_metadata: input.metadata ?? null,
      } as never,
    );
    if (error) {
      captureFallback("budget.record_failed", error, {
        userId: input.userId,
        provider: input.provider,
      });
      return null;
    }
    const row = (data as unknown as Array<{
      current_month_used_usd: number;
      is_capped: boolean;
    }>)?.[0];
    return row
      ? { currentMonthUsedUsd: Number(row.current_month_used_usd), isCapped: row.is_capped }
      : null;
  } catch (err) {
    captureFallback("budget.record_threw", err, {
      userId: input.userId,
      provider: input.provider,
    });
    return null;
  }
}

// ─── Cost models ─────────────────────────────────────────────────────────────
//
// Source of truth for per-call cost estimates. When a real Runway/Luma
// response carries a `cost` field, that wins. These are the fallbacks.

export const COST = {
  gemini: {
    // Gemini 2.5 Flash: $0.30 / 1M input tokens, $1.20 / 1M output tokens.
    // Estimate: ~1500 tokens per generateVideoScript call (input + output).
    // → $0.001 per call. We track 6 Gemini calls per video pipeline.
    perCallUsd: 0.001,
  },
  elevenlabs: {
    // Rachel voice eleven_turbo_v2: ~$0.18 per 1k characters. A 30s
    // narration is ~600 chars → $0.108. Round to $0.11.
    perNarrationUsd: 0.11,
  },
  runway: {
    // Gen-4.5 turbo image_to_video: $0.05/sec for 5s = $0.25/clip.
    // 10s clip = $0.50.
    perSec: 0.05,
  },
  luma: {
    // Ray Flash 2 ~$0.14 per 5s clip, $0.25 per 9s clip.
    perFiveSecClip: 0.14,
    perNineSecClip: 0.25,
  },
} as const;
