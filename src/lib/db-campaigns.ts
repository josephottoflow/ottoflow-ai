/**
 * Campaign Workspace V1 — data service.
 *
 * The Campaign is the PARENT organizational entity. This module derives its
 * live state from RELATIONSHIPS (content_items / content_creatives / brand_topics
 * all carry campaign_id) — it never duplicates that data. Pure helpers (metrics,
 * filtering, sorting, timeline) are separated from the thin Supabase read wrappers
 * so the logic is unit-testable without a database.
 *
 * Reuses the existing clients: pass a createServerSupabaseClient() (RLS, from a
 * server component) or a createAdminClient() with an explicit user filter (API).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbCampaign, CampaignStatus } from "./types";

// ─── Live metrics (all relationship-derived) ────────────────────────────────

export interface CampaignMetrics {
  researchIdeas: number;
  drafts: number;
  approved: number;
  scheduled: number;
  published: number;
  /** Creative assets linked to the campaign (content_creatives). */
  creatives: number;
  /** Total content_items linked to the campaign. */
  totalContent: number;
  /** 0–100, share of content that has shipped (published / total). */
  completionPct: number;
}

/** Raw relationship rows a campaign rolls up from. */
export interface CampaignRelations {
  researchIdeaCount: number;
  /** One entry per linked content_item (its status). */
  contentStatuses: string[];
  creativeCount: number;
}

/** Content statuses that count as "in progress / drafts". */
const DRAFT_STATUSES = new Set(["draft", "in_review", "brief_ready", "generating"]);

/**
 * Derive the campaign's live metrics from its relationship rows. Pure — the
 * status→bucket mapping is explicit and unit-tested.
 */
export function deriveCampaignMetrics(r: CampaignRelations): CampaignMetrics {
  const s = r.contentStatuses;
  const drafts = s.filter((x) => DRAFT_STATUSES.has(x)).length;
  const approved = s.filter((x) => x === "approved" || x === "ready").length;
  const scheduled = s.filter((x) => x === "scheduled").length;
  const published = s.filter((x) => x === "published").length;
  const totalContent = s.length;
  const completionPct = totalContent === 0 ? 0 : Math.round((published / totalContent) * 100);
  return {
    researchIdeas: r.researchIdeaCount,
    drafts,
    approved,
    scheduled,
    published,
    creatives: r.creativeCount,
    totalContent,
    completionPct,
  };
}

// ─── Display / library helpers (pure) ───────────────────────────────────────

/** Operator-facing name: name → title → prompt → fallback. Pure. */
export function campaignDisplayName(c: Pick<DbCampaign, "name" | "title" | "prompt">): string {
  return c.name?.trim() || c.title?.trim() || c.prompt?.trim() || "Untitled campaign";
}

export interface CampaignFilter {
  q?: string;
  status?: CampaignStatus | "all";
  owner?: string;
  channel?: string;
  tag?: string;
  favorite?: boolean;
  /** When true, show ONLY archived; when false/undefined, EXCLUDE archived. */
  archived?: boolean;
}

export type CampaignSort = "recent" | "created" | "name" | "priority" | "status";

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Filter a campaign list. Archived campaigns are hidden unless explicitly asked
 * for. Pure — usable on client or server. */
export function filterCampaigns(list: DbCampaign[], f: CampaignFilter = {}): DbCampaign[] {
  const q = f.q?.trim().toLowerCase();
  return list.filter((c) => {
    const archived = c.is_archived ?? false;
    if (f.archived === true) {
      if (!archived) return false;
    } else if (archived) {
      return false;
    }
    if (f.favorite && !(c.is_favorite ?? false)) return false;
    if (f.status && f.status !== "all" && c.status !== f.status) return false;
    if (f.owner && (c.owner ?? "") !== f.owner) return false;
    if (f.channel && !(c.channels ?? []).includes(f.channel)) return false;
    if (f.tag && !(c.tags ?? []).includes(f.tag)) return false;
    if (q) {
      const hay = [campaignDisplayName(c), c.description ?? "", c.objective ?? "", (c.tags ?? []).join(" ")]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Sort a campaign list (returns a new array). Pure. */
export function sortCampaigns(list: DbCampaign[], sort: CampaignSort = "recent"): DbCampaign[] {
  const a = [...list];
  switch (sort) {
    case "name":
      return a.sort((x, y) => campaignDisplayName(x).localeCompare(campaignDisplayName(y)));
    case "created":
      return a.sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
    case "priority":
      return a.sort(
        (x, y) => (PRIORITY_ORDER[x.priority ?? "medium"] ?? 2) - (PRIORITY_ORDER[y.priority ?? "medium"] ?? 2),
      );
    case "status":
      return a.sort((x, y) => x.status.localeCompare(y.status));
    case "recent":
    default:
      return a.sort((x, y) => (x.updated_at < y.updated_at ? 1 : -1));
  }
}

// ─── Lifecycle timeline (derived) ───────────────────────────────────────────

export const CAMPAIGN_LIFECYCLE = [
  "planning", "research", "in_progress", "review", "scheduled", "live", "completed",
] as const;
export type CampaignLifecycleStage = (typeof CAMPAIGN_LIFECYCLE)[number];

/** Map any campaign status (execution OR workspace) to a lifecycle index. */
const STATUS_STAGE: Record<string, number> = {
  planning: 0, failed: 0,
  generating: 1, research: 1,
  in_progress: 2,
  review: 3, ready: 3,
  scheduled: 4,
  live: 5,
  completed: 6, archived: 6,
};

export interface TimelineStep {
  stage: CampaignLifecycleStage;
  done: boolean;
  active: boolean;
}

/**
 * Derive the lifecycle timeline from the status AND the relationship metrics, so
 * the timeline reflects real work (research done, drafts made, content published)
 * rather than the status field alone. Pure.
 */
export function campaignTimeline(status: CampaignStatus, m: CampaignMetrics): TimelineStep[] {
  let reached = STATUS_STAGE[status] ?? 0;
  if (m.researchIdeas > 0) reached = Math.max(reached, 1);
  if (m.drafts > 0) reached = Math.max(reached, 2);
  if (m.approved > 0) reached = Math.max(reached, 3);
  if (m.scheduled > 0) reached = Math.max(reached, 4);
  if (m.published > 0) reached = Math.max(reached, 6);
  return CAMPAIGN_LIFECYCLE.map((stage, i) => ({ stage, done: i < reached, active: i === reached }));
}

// ─── Thin Supabase read wrappers ────────────────────────────────────────────

export async function listCampaigns(sb: SupabaseClient, opts?: { limit?: number }): Promise<DbCampaign[]> {
  const { data } = await sb
    .from("campaigns")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  return (data ?? []) as DbCampaign[];
}

export async function getCampaignById(sb: SupabaseClient, id: string): Promise<DbCampaign | null> {
  const { data } = await sb.from("campaigns").select("*").eq("id", id).maybeSingle();
  return (data as DbCampaign | null) ?? null;
}

/** Fetch the raw relationship rows for a campaign (for metrics). Never duplicates
 * data — reads the child tables by their campaign_id pointer. */
export async function getCampaignRelations(sb: SupabaseClient, campaignId: string): Promise<CampaignRelations> {
  const [topics, content, creatives] = await Promise.all([
    sb.from("brand_topics").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId),
    sb.from("content_items").select("status").eq("campaign_id", campaignId).limit(1000),
    sb.from("content_creatives").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId),
  ]);
  return {
    researchIdeaCount: topics.count ?? 0,
    contentStatuses: ((content.data ?? []) as { status: string }[]).map((r) => r.status),
    creativeCount: creatives.count ?? 0,
  };
}

export async function getCampaignMetrics(sb: SupabaseClient, campaignId: string): Promise<CampaignMetrics> {
  return deriveCampaignMetrics(await getCampaignRelations(sb, campaignId));
}
