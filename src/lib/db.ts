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

/**
 * Guard rail: wrap a DB query so any THROWN exception (not just supabase's
 * { error } shape) returns a fallback instead of 500'ing the page.
 * Examples that throw rather than return error:
 *   - Headers.set TypeError from a malformed Clerk token (audit incident)
 *   - Network failure mid-fetch
 *   - JSON parse failure on response body
 * Without this, any one of these crashes the whole server-rendered page.
 */
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(
      `[db] ${label} threw:`,
      err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    );
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
        sb
          .from("render_jobs")
          .select("id", { count: "exact", head: true })
          .eq("status", "done"),
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
    sb
      .from("render_jobs")
      .select("completed_at,status")
      .eq("status", "done")
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
