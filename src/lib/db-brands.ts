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
  DbCompetitor,
  DbKeyword,
  DbContentPillar,
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
