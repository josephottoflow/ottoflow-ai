/**
 * Video-domain DB queries. Uses the per-request Clerk-authenticated
 * Supabase client so RLS scopes everything to the current user.
 *
 * /video/history reads through these. The /api/generate route writes via
 * the admin client (bypasses RLS) so this file is read-only.
 */
import "server-only";
import { createServerSupabaseClient } from "./supabase-server";
import { captureFallback } from "./observability";
import type { DbBrand, DbBrandTopic, DbRenderJob } from "./types";

async function safe<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    captureFallback(`db-video.${label}.threw`, err);
    return fallback;
  }
}

/**
 * List the current user's video generations. Default scope is everything
 * RLS exposes (worker writes `user_id` on insert). Ordered newest-first.
 */
export async function listUserVideoGenerations(
  opts: { limit?: number; brandId?: string } = {},
): Promise<DbRenderJob[]> {
  return safe(
    "listUserVideoGenerations",
    async () => {
      const sb = await createServerSupabaseClient();
      let q = sb
        .from("render_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(opts.limit ?? 50);
      if (opts.brandId) q = q.eq("brand_id", opts.brandId);
      const { data } = await q;
      return (data ?? []) as DbRenderJob[];
    },
    [],
  );
}

export async function getVideoGeneration(
  renderJobId: string,
): Promise<DbRenderJob | null> {
  return safe(
    "getVideoGeneration",
    async () => {
      const sb = await createServerSupabaseClient();
      const { data } = await sb
        .from("render_jobs")
        .select("*")
        .eq("id", renderJobId)
        .single();
      return (data as DbRenderJob | null) ?? null;
    },
    null,
  );
}

/**
 * Brands the current user owns that are READY (research finished + profile
 * landed). Used by /video/generate to populate the Brand selector. We
 * exclude `researching` and `failed` brands so the picker can't end up
 * with a brand that has no profile to generate from.
 */
export async function listReadyBrandsForUser(): Promise<DbBrand[]> {
  return safe(
    "listReadyBrandsForUser",
    async () => {
      const sb = await createServerSupabaseClient();
      const { data } = await sb
        .from("brands")
        .select("*")
        .eq("status", "ready")
        .order("updated_at", { ascending: false });
      return (data ?? []) as DbBrand[];
    },
    [],
  );
}

/**
 * Draft topics for a brand the current user owns. RLS scopes to the
 * owner via the brand_id traversal policy. Default sort: newest first.
 */
export async function listTopicsForBrand(
  brandId: string,
): Promise<DbBrandTopic[]> {
  return safe(
    "listTopicsForBrand",
    async () => {
      const sb = await createServerSupabaseClient();
      const { data } = await sb
        .from("brand_topics")
        .select("*")
        .eq("brand_id", brandId)
        .in("status", ["draft", "used"])
        .order("created_at", { ascending: false });
      return (data ?? []) as DbBrandTopic[];
    },
    [],
  );
}
