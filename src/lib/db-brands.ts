/**
 * Brand-domain DB queries. Uses the per-request Clerk-authenticated Supabase
 * client so RLS scopes everything to the current user.
 *
 * Browser code that needs to mutate brands should go through server actions
 * or POST /api/brands, NOT call these directly.
 *
 * All functions are wrapped in safe() so throws (e.g. mid-flight network
 * failures, header construction crashes) return a typed fallback instead
 * of crashing the page that called them.
 */
import "server-only";
import { createServerSupabaseClient } from "./supabase-server";
import { captureFallback } from "./observability";
import type {
  DbBrand,
  DbBrandResearchJob,
  DbBrandTopic,
  DbCompetitor,
  DbKeyword,
  DbContentPillar,
  DbResearchDocument,
  DbResearchRun,
} from "./types";

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    captureFallback(`db-brands.${label}.threw`, err);
    return fallback;
  }
}

export async function listBrands(): Promise<DbBrand[]> {
  return safe("listBrands", async () => {
    const sb = await createServerSupabaseClient();
    const { data, error } = await sb
      .from("brands")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("[db-brands] listBrands:", error.message);
      return [];
    }
    return data ?? [];
  }, []);
}

export async function getBrand(brandId: string): Promise<DbBrand | null> {
  return safe("getBrand", async () => {
    const sb = await createServerSupabaseClient();
    const { data, error } = await sb
      .from("brands")
      .select("*")
      .eq("id", brandId)
      .maybeSingle();
    if (error) {
      console.error("[db-brands] getBrand:", error.message);
      return null;
    }
    return data;
  }, null);
}

export async function getLatestResearchJob(
  brandId: string
): Promise<DbBrandResearchJob | null> {
  return safe("getLatestResearchJob", async () => {
    const sb = await createServerSupabaseClient();
    const { data, error } = await sb
      .from("brand_research_jobs")
      .select("*")
      .eq("brand_id", brandId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[db-brands] getLatestResearchJob:", error.message);
      return null;
    }
    return data;
  }, null);
}

export async function getBrandCompetitors(brandId: string): Promise<DbCompetitor[]> {
  return safe("getBrandCompetitors", async () => {
    const sb = await createServerSupabaseClient();
    const { data } = await sb
      .from("competitors")
      .select("*")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: true });
    return data ?? [];
  }, []);
}

export async function getBrandKeywords(brandId: string): Promise<DbKeyword[]> {
  return safe("getBrandKeywords", async () => {
    const sb = await createServerSupabaseClient();
    const { data } = await sb
      .from("keywords")
      .select("*")
      .eq("brand_id", brandId)
      .order("opportunity_score", { ascending: false, nullsFirst: false });
    return data ?? [];
  }, []);
}

export async function getBrandPillars(brandId: string): Promise<DbContentPillar[]> {
  return safe("getBrandPillars", async () => {
    const sb = await createServerSupabaseClient();
    const { data } = await sb
      .from("content_pillars")
      .select("*")
      .eq("brand_id", brandId)
      .order("priority", { ascending: true });
    return data ?? [];
  }, []);
}

/**
 * Brand topics — Gemini-generated content ideas attached to a brand.
 * Defaults to draft status so we don't surface archived/used topics in the
 * default pickers; pass `status: "all"` for the management view.
 */
export async function getBrandTopics(
  brandId: string,
  opts: { status?: "draft" | "used" | "archived" | "all" } = {},
): Promise<DbBrandTopic[]> {
  return safe("getBrandTopics", async () => {
    const sb = await createServerSupabaseClient();
    let q = sb
      .from("brand_topics")
      .select("*")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false });
    if (opts.status && opts.status !== "all") {
      q = q.eq("status", opts.status);
    } else if (!opts.status) {
      q = q.eq("status", "draft");
    }
    const { data } = await q;
    return data ?? [];
  }, []);
}

// ─── Research Workspace (V2 Phase 2B) ────────────────────────────────────────
// Read-only views over the evidence layer (migrations 010/011). All RLS-scoped
// via the Clerk-authenticated client — no admin client, no ownership checks.

/** Evidence list row — everything except the heavy columns (content, embedding). */
export type EvidenceListRow = Pick<
  DbResearchDocument,
  | "id"
  | "source_id"
  | "source_type"
  | "url"
  | "domain"
  | "title"
  | "summary"
  | "entities"
  | "keywords"
  | "chunk_index"
  | "captured_at"
  | "run_id"
>;

export async function getBrandEvidence(brandId: string): Promise<EvidenceListRow[]> {
  return safe("getBrandEvidence", async () => {
    const sb = await createServerSupabaseClient();
    const { data, error } = await sb
      .from("research_documents")
      .select(
        "id, source_id, source_type, url, domain, title, summary, entities, keywords, chunk_index, captured_at, run_id",
      )
      .eq("brand_id", brandId)
      .eq("deleted_by_user", false)
      .order("captured_at", { ascending: false })
      .limit(800);
    if (error) {
      console.error("[db-brands] getBrandEvidence:", error.message);
      return [];
    }
    return (data ?? []) as EvidenceListRow[];
  }, []);
}

export async function getBrandResearchRuns(brandId: string): Promise<DbResearchRun[]> {
  return safe("getBrandResearchRuns", async () => {
    const sb = await createServerSupabaseClient();
    const { data, error } = await sb
      .from("research_runs")
      .select("*")
      .eq("brand_id", brandId)
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("[db-brands] getBrandResearchRuns:", error.message);
      return [];
    }
    return (data ?? []) as DbResearchRun[];
  }, []);
}

/** Artifact stubs for the Grounding Inspector — id, label, and grounded_on only. */
export interface GroundedArtifact {
  id: string;
  kind: "idea" | "post" | "video";
  label: string;
  sublabel: string | null;
  status: string | null;
  grounded_on: string[];
  created_at: string;
}

export async function getBrandGroundedArtifacts(
  brandId: string,
): Promise<GroundedArtifact[]> {
  return safe("getBrandGroundedArtifacts", async () => {
    const sb = await createServerSupabaseClient();
    const [topicsRes, postsRes, videosRes] = await Promise.all([
      sb
        .from("brand_topics")
        .select("id, title, category, status, grounded_on, created_at")
        .eq("brand_id", brandId)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(80),
      sb
        .from("content_items")
        .select("id, title, platform, status, grounded_on, created_at")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false })
        .limit(60),
      sb
        .from("render_jobs")
        .select("id, name, status, grounded_on, created_at")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

    const out: GroundedArtifact[] = [];
    for (const t of topicsRes.data ?? []) {
      out.push({
        id: t.id as string,
        kind: "idea",
        label: t.title as string,
        sublabel: (t.category as string | null) ?? null,
        status: (t.status as string | null) ?? null,
        grounded_on: (t.grounded_on as string[] | null) ?? [],
        created_at: t.created_at as string,
      });
    }
    for (const c of postsRes.data ?? []) {
      out.push({
        id: c.id as string,
        kind: "post",
        label: c.title as string,
        sublabel: (c.platform as string | null) ?? null,
        status: (c.status as string | null) ?? null,
        grounded_on: (c.grounded_on as string[] | null) ?? [],
        created_at: c.created_at as string,
      });
    }
    for (const v of videosRes.data ?? []) {
      out.push({
        id: v.id as string,
        kind: "video",
        label: v.name as string,
        sublabel: null,
        status: (v.status as string | null) ?? null,
        grounded_on: (v.grounded_on as string[] | null) ?? [],
        created_at: v.created_at as string,
      });
    }
    return out;
  }, []);
}
