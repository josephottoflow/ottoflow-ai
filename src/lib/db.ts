/**
 * Database query layer for the legacy projects/content/render-jobs/activity
 * tables. Every call goes through createServerSupabaseClient(), which forwards
 * the current Clerk session JWT to Supabase so RLS scopes every row to the
 * authenticated user.
 *
 * Multi-tenant guarantee:
 *   - SELECT: RLS policies on each table filter by current_clerk_user_id()
 *     (see supabase/migrations/001_initial.sql). The Clerk JWT's `sub` claim
 *     drives that function. A different user's JWT gets a different set of
 *     rows — no application-level filtering needed.
 *   - INSERT/UPDATE: RLS WITH CHECK clauses reject writes that would create
 *     rows belonging to another user. createProject explicitly stamps
 *     user_id from the current Clerk session so we never trust client input
 *     for ownership.
 *
 * The previous "mock fallback" (hasSupabase + mock-data.ts) was removed —
 * it returned shared mock rows for every user, silently hiding the RLS bug.
 * mock-data.ts itself has now been deleted; this module is strictly real data.
 */
import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "./supabase-server";
import { captureFallback } from "./observability";

/**
 * Guard rail: wrap a DB query so any THROWN exception (not just supabase's
 * { error } shape) returns a fallback instead of 500'ing the page.
 * Examples that throw rather than return error:
 *   - Headers.set TypeError from a malformed Clerk token (audit incident)
 *   - Network failure mid-fetch
 *   - JSON parse failure on response body
 * Without this, any one of these crashes the whole server-rendered page.
 *
 * Every fallback is reported via captureFallback so we can spot DB layer
 * problems even though the page kept rendering.
 */
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    captureFallback(`db.${label}.threw`, err);
    return fallback;
  }
}
import type {
  DbProject,
  DbContentItem,
  DbRenderJob,
  DbActivityItem,
  KPISummary,
  ChartPoint,
} from "./types";

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<DbProject[]> {
  return safe("getProjects", async () => {
    const sb = await createServerSupabaseClient();
    const { data, error } = await sb
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[db] getProjects:", error.message);
      return [];
    }
    return (data ?? []) as DbProject[];
  }, []);
}

export async function getProject(id: string): Promise<DbProject | null> {
  return safe("getProject", async () => {
    const sb = await createServerSupabaseClient();
    const { data, error } = await sb
      .from("projects")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[db] getProject:", error.message);
      return null;
    }
    return (data ?? null) as DbProject | null;
  }, null);
}

/**
 * Create a project owned by the current Clerk user. user_id is injected
 * server-side — callers cannot spoof ownership.
 */
export async function createProject(
  payload: Omit<DbProject, "id" | "created_at" | "updated_at" | "user_id">
): Promise<DbProject | null> {
  const { userId } = await auth();
  if (!userId) {
    console.error("[db] createProject: no Clerk user in context");
    return null;
  }

  const sb = await createServerSupabaseClient();
  const { data, error } = await sb
    .from("projects")
    .insert({ ...payload, user_id: userId })
    .select()
    .single();

  if (error) {
    console.error("[db] createProject:", error.message);
    return null;
  }
  return data as DbProject;
}

export async function updateProject(
  id: string,
  payload: Partial<DbProject>
): Promise<void> {
  const sb = await createServerSupabaseClient();
  const { error } = await sb
    .from("projects")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) console.error("[db] updateProject:", error.message);
}

// ─── Content ──────────────────────────────────────────────────────────────────

export async function getContentItems(
  projectId?: string
): Promise<DbContentItem[]> {
  return safe("getContentItems", async () => {
    const sb = await createServerSupabaseClient();
    let q = sb
      .from("content_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (projectId) q = q.eq("project_id", projectId);

    const { data, error } = await q;
    if (error) {
      console.error("[db] getContentItems:", error.message);
      return [];
    }
    return (data ?? []) as DbContentItem[];
  }, []);
}

export async function upsertContentItem(
  item: Omit<DbContentItem, "id" | "created_at">
): Promise<DbContentItem | null> {
  const sb = await createServerSupabaseClient();
  const { data, error } = await sb
    .from("content_items")
    .insert(item)
    .select()
    .single();

  if (error) {
    console.error("[db] upsertContentItem:", error.message);
    return null;
  }
  return data as DbContentItem;
}

// ─── Render Jobs ──────────────────────────────────────────────────────────────

export async function getRenderJobs(
  projectId?: string,
  limit = 20
): Promise<DbRenderJob[]> {
  return safe("getRenderJobs", async () => {
    const sb = await createServerSupabaseClient();
    let q = sb
      .from("render_jobs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);

    if (projectId) q = q.eq("project_id", projectId);

    const { data, error } = await q;
    if (error) {
      console.error("[db] getRenderJobs:", error.message);
      return [];
    }
    return (data ?? []) as DbRenderJob[];
  }, []);
}

export async function createRenderJob(
  payload: Omit<DbRenderJob, "id" | "started_at">
): Promise<DbRenderJob | null> {
  const sb = await createServerSupabaseClient();
  const { data, error } = await sb
    .from("render_jobs")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("[db] createRenderJob:", error.message);
    return null;
  }
  return data as DbRenderJob;
}

export async function updateRenderJob(
  id: string,
  payload: Partial<DbRenderJob>
): Promise<void> {
  const sb = await createServerSupabaseClient();
  const { error } = await sb
    .from("render_jobs")
    .update(payload)
    .eq("id", id);

  if (error) console.error("[db] updateRenderJob:", error.message);
}

// ─── Activity ─────────────────────────────────────────────────────────────────

export async function getActivity(limit = 20): Promise<DbActivityItem[]> {
  return safe("getActivity", async () => {
    const sb = await createServerSupabaseClient();
    const { data, error } = await sb
      .from("activity")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[db] getActivity:", error.message);
      return [];
    }
    return (data ?? []) as DbActivityItem[];
  }, []);
}

export async function logActivity(
  payload: Omit<DbActivityItem, "id" | "created_at">
): Promise<void> {
  const sb = await createServerSupabaseClient();
  const { error } = await sb.from("activity").insert(payload);
  if (error) console.error("[db] logActivity:", error.message);
}

// ─── KPI summary ──────────────────────────────────────────────────────────────

/**
 * Per-user KPI snapshot. Every count flows through RLS so each user sees
 * only their own data. The `creditsTotal` is a plan-level constant for now.
 */
const EMPTY_KPI: KPISummary = {
  totalContent: 0,
  totalVideos: 0,
  creditsUsed: 0,
  creditsTotal: 5000,
  activeProjects: 0,
  publishedToday: 0,
  renderQueue: 0,
};

export async function getKPISummary(): Promise<KPISummary> {
  return safe("getKPISummary", async () => {
    const sb = await createServerSupabaseClient();

    // Run aggregates in parallel
    const [contentRes, videoRes, projectRes, publishedRes, queueRes] =
      await Promise.all([
        sb.from("content_items").select("id", { count: "exact", head: true }),
        // "Videos Rendered" = jobs that produced a REAL downloadable video.
        // status="done" is set after the (cheap) planning phase even when the
        // async worker render later fails, so it over-counts. merged_video_url
        // is only set on a successful compose + upload — the honest signal.
        sb
          .from("render_jobs")
          .select("id", { count: "exact", head: true })
          .not("merged_video_url", "is", null),
        sb
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        sb
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("status", "published")
          .gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
        sb
          .from("render_jobs")
          .select("id", { count: "exact", head: true })
          .in("status", ["queued", "rendering"]),
      ]);

    // Credits: sum from the user's own projects (RLS filters)
    const { data: creditsData } = await sb.from("projects").select("credits_used");

    const creditsUsed = ((creditsData ?? []) as Array<{ credits_used: number | null }>).reduce(
      (acc, r) => acc + (r.credits_used ?? 0),
      0
    );

    return {
      totalContent: contentRes.count ?? 0,
      totalVideos: videoRes.count ?? 0,
      creditsUsed,
      creditsTotal: 5000,
      activeProjects: projectRes.count ?? 0,
      publishedToday: publishedRes.count ?? 0,
      renderQueue: queueRes.count ?? 0,
    };
  }, EMPTY_KPI);
}

/**
 * Creative Orchestrator dashboard counts — total composed creatives and how
 * many have a finished (ready) image. RLS scopes to the user via brand.
 */
export async function getCreativeCount(): Promise<{ total: number; ready: number }> {
  return safe("getCreativeCount", async () => {
    const sb = await createServerSupabaseClient();
    const [{ count: total }, { count: ready }] = await Promise.all([
      sb.from("content_creatives").select("id", { count: "exact", head: true }),
      sb
        .from("content_creatives")
        .select("id", { count: "exact", head: true })
        .eq("status", "ready"),
    ]);
    return { total: total ?? 0, ready: ready ?? 0 };
  }, { total: 0, ready: 0 });
}

// ─── Analytics ────────────────────────────────────────────────────────────────

/**
 * Daily series for the last 14 days, bucketed by UTC date.
 * - `content` = content_items created that day
 * - `videos`  = render_jobs that completed that day (status='done')
 * - `credits` = approximated as videos * 50 (per-job credit cost is not stored
 *   yet — once render_jobs gains a credits column this can sum it directly).
 *
 * RLS scopes both tables to the current Clerk user.
 */
export async function getAnalyticsData(days = 14): Promise<ChartPoint[]> {
  return safe("getAnalyticsData", async () => {
    const sb = await createServerSupabaseClient();
  const since = new Date(Date.now() - days * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const [contentRes, renderRes] = await Promise.all([
    sb
      .from("content_items")
      .select("created_at")
      .gte("created_at", sinceIso),
    // Count only jobs that produced a real video (merged_video_url set), not
    // planning-completions — keeps the chart honest. See getKPISummary.
    sb
      .from("render_jobs")
      .select("completed_at")
      .not("merged_video_url", "is", null)
      .gte("completed_at", sinceIso),
  ]);

  if (contentRes.error) console.error("[db] getAnalyticsData content:", contentRes.error.message);
  if (renderRes.error)  console.error("[db] getAnalyticsData render:",  renderRes.error.message);

  const contentRows = (contentRes.data ?? []) as Array<{ created_at: string }>;
  const renderRows  = (renderRes.data  ?? []) as Array<{ completed_at: string | null }>;

  const dayKey = (iso: string) => iso.slice(0, 10);     // YYYY-MM-DD (UTC)
  const contentByDay = new Map<string, number>();
  const videosByDay  = new Map<string, number>();

  for (const r of contentRows) {
    const k = dayKey(r.created_at);
    contentByDay.set(k, (contentByDay.get(k) ?? 0) + 1);
  }
  for (const r of renderRows) {
    if (!r.completed_at) continue;
    const k = dayKey(r.completed_at);
    videosByDay.set(k, (videosByDay.get(k) ?? 0) + 1);
  }

  const points: ChartPoint[] = [];
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    d.setUTCHours(0, 0, 0, 0);
    const k = d.toISOString().slice(0, 10);
    const videos = videosByDay.get(k) ?? 0;
    points.push({
      date: fmt.format(d),
      content: contentByDay.get(k) ?? 0,
      videos,
      credits: videos * 50,
    });
  }
    return points;
  }, []);
}

// ─── Provider analytics (Beta-readiness, Phase C) ────────────────────────────
//
// Aggregates over scene_generations so we can monitor provider health,
// generation latency, and AI spend. RLS scopes everything to the user
// via render_jobs.user_id traversal (see migration 007). Numbers are
// per-user — Sentry covers fleet-wide signal.

export interface ProviderAnalyticsRow {
  provider: string;
  attempts: number;
  successes: number;
  successRatePct: number;       // 0-100
  avgGenMs: number | null;
  p50GenMs: number | null;
  p95GenMs: number | null;
  totalCostUsd: number;
  fallbackCount: number;        // scenes that ended up at this provider after a failure
}

export interface AIBurnDayPoint {
  date: string;                 // formatted like ChartPoint
  costUsd: number;
  sceneCount: number;
}

/** Percentile from an unsorted number array. p in [0, 100]. */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length)),
  );
  return sorted[idx];
}

/**
 * Per-provider performance metrics for the last N days.
 *
 * Joins via the RLS-aware client. fallback_count counts scenes where
 * `fallback_reason IS NOT NULL` — useful for catching providers that
 * chain-fall to backup providers.
 */
export async function getProviderAnalytics(
  days = 14,
): Promise<ProviderAnalyticsRow[]> {
  return safe(
    "getProviderAnalytics",
    async () => {
      const sb = await createServerSupabaseClient();
      const since = new Date(Date.now() - days * 86_400_000);
      since.setUTCHours(0, 0, 0, 0);
      const { data } = await sb
        .from("scene_generations")
        .select("provider, clip_url, generation_time_ms, cost_usd, fallback_reason, created_at")
        .gte("created_at", since.toISOString());

      const rows = (data ?? []) as Array<{
        provider: string;
        clip_url: string | null;
        generation_time_ms: number | null;
        cost_usd: number | null;
        fallback_reason: string | null;
      }>;

      const buckets = new Map<string, {
        attempts: number;
        successes: number;
        times: number[];
        cost: number;
        fallbackCount: number;
      }>();

      for (const r of rows) {
        const key = r.provider;
        let b = buckets.get(key);
        if (!b) {
          b = { attempts: 0, successes: 0, times: [], cost: 0, fallbackCount: 0 };
          buckets.set(key, b);
        }
        b.attempts += 1;
        if (r.clip_url) b.successes += 1;
        if (r.generation_time_ms != null) b.times.push(r.generation_time_ms);
        if (r.cost_usd != null) b.cost += r.cost_usd;
        if (r.fallback_reason) b.fallbackCount += 1;
      }

      const out: ProviderAnalyticsRow[] = [];
      for (const [provider, b] of buckets.entries()) {
        const avg =
          b.times.length > 0
            ? Math.round(b.times.reduce((a, x) => a + x, 0) / b.times.length)
            : null;
        out.push({
          provider,
          attempts: b.attempts,
          successes: b.successes,
          successRatePct: b.attempts > 0 ? Math.round((b.successes / b.attempts) * 1000) / 10 : 0,
          avgGenMs: avg,
          p50GenMs: percentile(b.times, 50),
          p95GenMs: percentile(b.times, 95),
          totalCostUsd: Math.round(b.cost * 100) / 100,
          fallbackCount: b.fallbackCount,
        });
      }
      // Order: most-used providers first
      out.sort((a, b) => b.attempts - a.attempts);
      return out;
    },
    [],
  );
}

/**
 * Daily AI spend for the last N days. Sums scene_generations.cost_usd
 * per UTC day. Pexels rows have cost=0 so they don't inflate the line.
 */
export async function getAIBurnSeries(
  days = 14,
): Promise<AIBurnDayPoint[]> {
  return safe(
    "getAIBurnSeries",
    async () => {
      const sb = await createServerSupabaseClient();
      const since = new Date(Date.now() - days * 86_400_000);
      since.setUTCHours(0, 0, 0, 0);
      const { data } = await sb
        .from("scene_generations")
        .select("cost_usd, created_at")
        .gte("created_at", since.toISOString());

      const rows = (data ?? []) as Array<{
        cost_usd: number | null;
        created_at: string;
      }>;

      const cost = new Map<string, number>();
      const count = new Map<string, number>();
      for (const r of rows) {
        const k = r.created_at.slice(0, 10);
        cost.set(k, (cost.get(k) ?? 0) + (r.cost_usd ?? 0));
        count.set(k, (count.get(k) ?? 0) + 1);
      }

      const fmt = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      const out: AIBurnDayPoint[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000);
        d.setUTCHours(0, 0, 0, 0);
        const k = d.toISOString().slice(0, 10);
        out.push({
          date: fmt.format(d),
          costUsd: Math.round((cost.get(k) ?? 0) * 100) / 100,
          sceneCount: count.get(k) ?? 0,
        });
      }
      return out;
    },
    [],
  );
}

// ─── Content Performance (Analytics Ingestion v1) ────────────────────────────
// Published items + latest metric snapshots, joined to the intelligence graph
// (topics → lenses, grounded_on → evidence domains). Aggregation happens in
// JS — at current volumes (≤200 published items) this beats adding SQL
// surface. RLS scopes everything via the Clerk-authenticated client.

export interface PerfItem {
  id: string;
  title: string;
  platform: string;
  brandName: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  impressions: number | null;
  engagementRate: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  topicTitle: string | null;
  opportunityKind: string | null;
}

export interface PerfGroup {
  key: string;
  posts: number;
  withMetrics: number;
  totalImpressions: number;
  avgER: number | null;
}

export interface ContentPerformanceData {
  items: PerfItem[];
  byBrand: PerfGroup[];
  byPlatform: PerfGroup[];
  byTopic: PerfGroup[];
  byLens: PerfGroup[];
  byEvidenceDomain: PerfGroup[];
}

const EMPTY_PERF: ContentPerformanceData = {
  items: [],
  byBrand: [],
  byPlatform: [],
  byTopic: [],
  byLens: [],
  byEvidenceDomain: [],
};

export async function getContentPerformance(): Promise<ContentPerformanceData> {
  return safe("getContentPerformance", async () => {
    const sb = await createServerSupabaseClient();

    const [{ data: items }, { data: brands }, { data: metrics }] = await Promise.all([
      sb
        .from("content_items")
        .select("id, title, platform, brand_id, topic_id, grounded_on, published_at, published_url")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(200),
      sb.from("brands").select("id, name"),
      sb.from("content_latest_metrics").select("*"),
    ]);
    if (!items || items.length === 0) return EMPTY_PERF;

    const brandName = new Map((brands ?? []).map((b) => [b.id as string, b.name as string]));
    const metric = new Map(
      ((metrics ?? []) as Array<Record<string, unknown>>).map((m) => [
        m.content_item_id as string,
        m,
      ]),
    );

    // Topic + lens lookups for the published set
    const topicIds = [...new Set(items.map((i) => i.topic_id).filter(Boolean))] as string[];
    const topicById = new Map<string, { title: string; kind: string | null }>();
    if (topicIds.length > 0) {
      const { data: topics } = await sb
        .from("brand_topics")
        .select("id, title, opportunity_kind")
        .in("id", topicIds);
      for (const t of topics ?? []) {
        topicById.set(t.id as string, {
          title: t.title as string,
          kind: (t.opportunity_kind as string | null) ?? null,
        });
      }
    }

    // Evidence domains for the union of grounded_on ids (capped)
    const evidenceIds = [
      ...new Set(items.flatMap((i) => ((i.grounded_on as string[] | null) ?? []))),
    ].slice(0, 400);
    const domainByDoc = new Map<string, string>();
    if (evidenceIds.length > 0) {
      const { data: docs } = await sb
        .from("research_documents")
        .select("id, domain")
        .in("id", evidenceIds);
      for (const d of docs ?? []) {
        if (d.domain) domainByDoc.set(d.id as string, d.domain as string);
      }
    }

    const perf: PerfItem[] = items.map((i) => {
      const m = metric.get(i.id as string);
      const topic = i.topic_id ? topicById.get(i.topic_id as string) : undefined;
      return {
        id: i.id as string,
        title: i.title as string,
        platform: (i.platform as string) ?? "unknown",
        brandName: i.brand_id ? (brandName.get(i.brand_id as string) ?? null) : null,
        publishedAt: (i.published_at as string | null) ?? null,
        publishedUrl: (i.published_url as string | null) ?? null,
        impressions: (m?.impressions as number | null) ?? null,
        engagementRate: m?.engagement_rate != null ? Number(m.engagement_rate) : null,
        likes: (m?.likes as number | null) ?? null,
        comments: (m?.comments as number | null) ?? null,
        shares: (m?.shares as number | null) ?? null,
        clicks: (m?.clicks as number | null) ?? null,
        topicTitle: topic?.title ?? null,
        opportunityKind: topic?.kind ?? null,
      };
    });

    function rollup(keyFn: (p: PerfItem) => Array<string | null>): PerfGroup[] {
      const groups = new Map<string, { posts: number; withMetrics: number; imp: number; ers: number[] }>();
      for (const p of perf) {
        for (const key of keyFn(p)) {
          if (!key) continue;
          const g = groups.get(key) ?? { posts: 0, withMetrics: 0, imp: 0, ers: [] };
          g.posts++;
          if (p.engagementRate != null || p.impressions != null) g.withMetrics++;
          g.imp += p.impressions ?? 0;
          if (p.engagementRate != null) g.ers.push(p.engagementRate);
          groups.set(key, g);
        }
      }
      return [...groups.entries()]
        .map(([key, g]) => ({
          key,
          posts: g.posts,
          withMetrics: g.withMetrics,
          totalImpressions: g.imp,
          avgER: g.ers.length
            ? Number((g.ers.reduce((a, b) => a + b, 0) / g.ers.length).toFixed(4))
            : null,
        }))
        .sort((a, b) => (b.avgER ?? -1) - (a.avgER ?? -1));
    }

    return {
      items: perf,
      byBrand: rollup((p) => [p.brandName]),
      byPlatform: rollup((p) => [p.platform]),
      byTopic: rollup((p) => [p.topicTitle]),
      byLens: rollup((p) => [p.opportunityKind]),
      byEvidenceDomain: rollup((p) => {
        const item = items.find((i) => i.id === p.id);
        const ids = (item?.grounded_on as string[] | null) ?? [];
        return [...new Set(ids.map((id) => domainByDoc.get(id) ?? null))];
      }),
    };
  }, EMPTY_PERF);
}

// ─── Lens inventory (Optimization Recommendations v1) ────────────────────────
// Mined-opportunity pool by detection lens: how many ideas exist per lens and
// how many are still unused — feeds the "underused high-performing lens" rule.

import type { LensInventoryRow } from "./recommendations";

export async function getLensInventory(): Promise<LensInventoryRow[]> {
  return safe("getLensInventory", async () => {
    const sb = await createServerSupabaseClient();
    const { data: topics } = await sb
      .from("brand_topics")
      .select("title, opportunity_kind, status, use_count")
      .eq("source", "evidence-mined")
      .neq("status", "archived")
      .limit(500);

    const byKind = new Map<string, LensInventoryRow>();
    for (const t of topics ?? []) {
      const kind = (t.opportunity_kind as string | null) ?? "theme";
      const row =
        byKind.get(kind) ?? { kind, total: 0, used: 0, unused: 0, unusedSamples: [] };
      row.total++;
      const used = (t.use_count as number | null ?? 0) > 0 || t.status === "used";
      if (used) row.used++;
      else {
        row.unused++;
        if (row.unusedSamples.length < 3) row.unusedSamples.push(t.title as string);
      }
      byKind.set(kind, row);
    }
    return [...byKind.values()];
  }, []);
}

// ─── Creative hierarchy performance (Creative Orchestrator Phase D) ───────────
// Attribution for the intelligence loop: join READY creatives to their
// published content item's engagement, then roll up by hierarchy — overall,
// per platform, and per brand. Answers the design's three questions:
//   which creative hierarchy performs best? per brand? per platform?
// Same RLS-scoped, JS-aggregated approach as getContentPerformance.

export interface HierarchyGroup {
  key: string;            // hierarchy, e.g. "founder_led"
  posts: number;          // ready creatives on published items
  withMetrics: number;    // of those, how many have an engagement rate
  avgER: number | null;   // mean engagement rate across measured posts
}

export interface HierarchyDimGroup {
  /** Dimension value (platform name or brand name). */
  dim: string;
  rows: HierarchyGroup[]; // hierarchies within this dimension, best-first
}

export interface CreativeHierarchyPerformance {
  overall: HierarchyGroup[];
  byPlatform: HierarchyDimGroup[];
  byBrand: HierarchyDimGroup[];
  /** Total ready creatives considered (published items only). */
  totalCreatives: number;
}

const EMPTY_HIERARCHY_PERF: CreativeHierarchyPerformance = {
  overall: [],
  byPlatform: [],
  byBrand: [],
  totalCreatives: 0,
};

export async function getCreativeHierarchyPerformance(): Promise<CreativeHierarchyPerformance> {
  return safe("getCreativeHierarchyPerformance", async () => {
    const sb = await createServerSupabaseClient();

    const [{ data: creatives }, { data: publishedItems }, { data: metrics }, { data: brands }] =
      await Promise.all([
        sb
          .from("content_creatives")
          .select("content_item_id, creative_hierarchy, platform, brand_id, created_at")
          .eq("status", "ready")
          .order("created_at", { ascending: false })
          .limit(500),
        sb.from("content_items").select("id").eq("status", "published").limit(500),
        sb.from("content_latest_metrics").select("content_item_id, engagement_rate"),
        sb.from("brands").select("id, name"),
      ]);

    if (!creatives || creatives.length === 0) return EMPTY_HIERARCHY_PERF;

    const publishedIds = new Set((publishedItems ?? []).map((i) => i.id as string));
    const erByItem = new Map(
      ((metrics ?? []) as Array<Record<string, unknown>>).map((m) => [
        m.content_item_id as string,
        m.engagement_rate != null ? Number(m.engagement_rate) : null,
      ]),
    );
    const brandName = new Map((brands ?? []).map((b) => [b.id as string, b.name as string]));

    // One record per published item — latest ready creative wins (creatives
    // arrive newest-first, so first-seen per item is the most recent).
    interface Rec {
      hierarchy: string;
      platform: string;
      brand: string;
      er: number | null;
    }
    const seen = new Set<string>();
    const records: Rec[] = [];
    for (const c of creatives) {
      const itemId = c.content_item_id as string;
      if (!publishedIds.has(itemId) || seen.has(itemId)) continue;
      seen.add(itemId);
      records.push({
        hierarchy: c.creative_hierarchy as string,
        platform: (c.platform as string) ?? "unknown",
        brand: c.brand_id ? (brandName.get(c.brand_id as string) ?? "—") : "—",
        er: erByItem.get(itemId) ?? null,
      });
    }
    if (records.length === 0) return EMPTY_HIERARCHY_PERF;

    function rollup(recs: Rec[]): HierarchyGroup[] {
      const groups = new Map<string, { posts: number; ers: number[] }>();
      for (const r of recs) {
        const g = groups.get(r.hierarchy) ?? { posts: 0, ers: [] };
        g.posts++;
        if (r.er != null) g.ers.push(r.er);
        groups.set(r.hierarchy, g);
      }
      return [...groups.entries()]
        .map(([key, g]) => ({
          key,
          posts: g.posts,
          withMetrics: g.ers.length,
          avgER: g.ers.length
            ? Number((g.ers.reduce((a, b) => a + b, 0) / g.ers.length).toFixed(4))
            : null,
        }))
        .sort((a, b) => (b.avgER ?? -1) - (a.avgER ?? -1));
    }

    function rollupByDim(recs: Rec[], dimKey: (r: Rec) => string): HierarchyDimGroup[] {
      const byDim = new Map<string, Rec[]>();
      for (const r of recs) {
        const k = dimKey(r);
        const arr = byDim.get(k) ?? [];
        arr.push(r);
        byDim.set(k, arr);
      }
      return [...byDim.entries()]
        .map(([dim, rs]) => ({ dim, rows: rollup(rs) }))
        .sort((a, b) => (b.rows[0]?.avgER ?? -1) - (a.rows[0]?.avgER ?? -1));
    }

    return {
      overall: rollup(records),
      byPlatform: rollupByDim(records, (r) => r.platform),
      byBrand: rollupByDim(records, (r) => r.brand),
      totalCreatives: records.length,
    };
  }, EMPTY_HIERARCHY_PERF);
}
