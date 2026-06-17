/**
 * Publishing data layer (PUB-1). Service-role only; callers pass the owning
 * userId and we filter/insert by it. No tokens or media bytes here — jobs carry
 * ids + a denormalized destination snapshot + a media_spec of refs.
 */
import { createAdminClient } from "@/lib/supabase";
import { publishQueue } from "@/lib/queue";
import { logIntegrationAudit } from "@/lib/integrations/accounts";
import type { MediaSpec } from "@/lib/integrations/providers/types";

export const PUBLISH_STATUSES = [
  "scheduled",
  "queued",
  "publishing",
  "published",
  "failed",
  "needs_review",
  "canceled",
] as const;

const NON_TERMINAL = ["scheduled", "queued", "publishing"] as const;
const MAX_ATTEMPTS_HISTORY = 10;

export interface DestinationInput {
  connectedAccountId: string;
  provider: string;
  destinationId: string;
  destinationType?: string | null;
  destinationName?: string | null;
}

export interface PublishJobRow {
  id: string;
  user_id: string;
  content_item_id: string | null;
  connected_account_id: string | null;
  publishing_destination_id: string | null;
  provider: string;
  destination_type: string | null;
  destination_id: string;
  destination_name: string | null;
  status: string;
  scheduled_for: string | null;
  external_post_id: string | null;
  attempts: unknown[];
  attempt_count: number;
  media_spec: MediaSpec;
  created_at: string;
}

/** Upsert a publishing_destinations row (write-through cache). Returns its id. */
export async function resolveOrCreateDestination(
  userId: string,
  d: DestinationInput,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("publishing_destinations")
    .upsert(
      {
        user_id: userId,
        connected_account_id: d.connectedAccountId,
        provider: d.provider,
        destination_type: d.destinationType ?? "unknown",
        destination_id: d.destinationId,
        destination_name: d.destinationName ?? null,
        is_active: true,
      },
      { onConflict: "connected_account_id,destination_id" },
    )
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`publishing_destinations upsert failed: ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

/** Resolve a media_spec from a creative (image) or render job (video). */
export async function buildMediaSpec(opts: {
  creativeId?: string | null;
  renderJobId?: string | null;
}): Promise<MediaSpec> {
  const admin = createAdminClient();
  if (opts.renderJobId) {
    const { data } = await admin
      .from("render_jobs")
      .select("merged_video_url")
      .eq("id", opts.renderJobId)
      .maybeSingle();
    if (data?.merged_video_url) {
      return {
        kind: "video",
        items: [
          { source: "render_job", id: opts.renderJobId, url: data.merged_video_url as string, mime: "video/mp4" },
        ],
      };
    }
  }
  if (opts.creativeId) {
    const { data } = await admin
      .from("content_creatives")
      .select("image_url")
      .eq("id", opts.creativeId)
      .maybeSingle();
    if (data?.image_url) {
      return {
        kind: "image",
        items: [
          { source: "creative", id: opts.creativeId, url: data.image_url as string, mime: "image/png" },
        ],
      };
    }
  }
  return { kind: "none", items: [] };
}

export interface CreatedJob {
  id: string;
  status: string;
  existed: boolean;
  destinationId: string;
}

/**
 * Create one publish_job per destination (fan-out), idempotently. Existing
 * in-flight job for (content_item, destination) is returned instead of a
 * duplicate. `queued` jobs are enqueued (attempts:1); `scheduled` jobs are left
 * for the sweep.
 */
export async function createPublishJobs(opts: {
  userId: string;
  contentItemId: string;
  creativeId?: string | null;
  renderJobId?: string | null;
  mediaSpec: MediaSpec;
  destinations: Array<DestinationInput & { publishingDestinationId: string }>;
  scheduledFor?: string | null;
  clientRequestId?: string | null;
}): Promise<CreatedJob[]> {
  const admin = createAdminClient();
  const scheduled = opts.scheduledFor && Date.parse(opts.scheduledFor) > Date.now();
  const status = scheduled ? "scheduled" : "queued";
  const out: CreatedJob[] = [];

  for (const d of opts.destinations) {
    // In-flight dedupe (primary; also handles HTTP retry).
    const { data: existing } = await admin
      .from("publish_jobs")
      .select("id,status")
      .eq("content_item_id", opts.contentItemId)
      .eq("publishing_destination_id", d.publishingDestinationId)
      .in("status", NON_TERMINAL as unknown as string[])
      .maybeSingle();
    if (existing) {
      out.push({ id: existing.id as string, status: existing.status as string, existed: true, destinationId: d.destinationId });
      continue;
    }

    const insertRow = {
      user_id: opts.userId,
      content_item_id: opts.contentItemId,
      creative_id: opts.creativeId ?? null,
      render_job_id: opts.renderJobId ?? null,
      publishing_destination_id: d.publishingDestinationId,
      connected_account_id: d.connectedAccountId,
      provider: d.provider,
      destination_type: d.destinationType ?? null,
      destination_id: d.destinationId,
      destination_name: d.destinationName ?? null,
      status,
      scheduled_for: scheduled ? opts.scheduledFor : null,
      media_spec: opts.mediaSpec,
      client_request_id: opts.clientRequestId
        ? `${opts.clientRequestId}#${d.publishingDestinationId}`
        : null,
    };
    const { data, error } = await admin
      .from("publish_jobs")
      .insert(insertRow)
      .select("id,status")
      .single();

    if (error) {
      // Unique-violation race (in-flight or client_request_id) → return existing.
      const { data: race } = await admin
        .from("publish_jobs")
        .select("id,status")
        .eq("content_item_id", opts.contentItemId)
        .eq("publishing_destination_id", d.publishingDestinationId)
        .in("status", NON_TERMINAL as unknown as string[])
        .maybeSingle();
      if (race) {
        out.push({ id: race.id as string, status: race.status as string, existed: true, destinationId: d.destinationId });
        continue;
      }
      throw new Error(`publish_jobs insert failed: ${error.message}`);
    }

    if (data!.status === "queued") {
      await publishQueue().add(
        "publish",
        { publishJobId: data!.id as string },
        { attempts: 1, jobId: data!.id as string },
      );
    }
    out.push({ id: data!.id as string, status: data!.status as string, existed: false, destinationId: d.destinationId });
  }

  return out;
}

/** Owner-scoped list (token-free; publish_jobs has no secrets). */
export async function listPublishJobs(
  userId: string,
  contentItemId?: string | null,
): Promise<PublishJobRow[]> {
  const admin = createAdminClient();
  let q = admin.from("publish_jobs").select("*").eq("user_id", userId);
  if (contentItemId) q = q.eq("content_item_id", contentItemId);
  const { data } = await q.order("created_at", { ascending: false }).limit(100);
  return (data as PublishJobRow[]) ?? [];
}

export async function getPublishJob(id: string, userId: string): Promise<PublishJobRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("publish_jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as PublishJobRow) ?? null;
}

/** Cancel a non-terminal job. Returns true if it transitioned. */
export async function cancelPublishJob(job: PublishJobRow): Promise<boolean> {
  if (!["scheduled", "queued", "needs_review"].includes(job.status)) return false;
  const admin = createAdminClient();
  await admin.from("publish_jobs").update({ status: "canceled" }).eq("id", job.id);
  return true;
}

/** Worker/scheduler-side id-only fetch (already trusts the job owner). */
export async function getPublishJobById(id: string): Promise<PublishJobRow | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("publish_jobs").select("*").eq("id", id).maybeSingle();
  return (data as PublishJobRow) ?? null;
}

/** Atomic claim sweep: scheduled→queued for due jobs. Returns claimed ids. */
export async function claimDueScheduledJobs(): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("publish_jobs")
    .update({ status: "queued", claimed_at: new Date().toISOString() })
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .select("id");
  return ((data as { id: string }[]) ?? []).map((r) => r.id);
}

/**
 * Reaper (P1.3): recover jobs stuck in 'publishing' (worker crashed between
 * claim and result). Candidates: status='publishing' AND external_post_id IS
 * NULL AND claimed_at older than threshold. Each is moved to needs_review via a
 * compare-and-set (so a worker that JUST finished — set external_post_id or a
 * terminal status — is never clobbered). NEVER re-posts. Returns counts.
 */
export async function reapStuckPublishingJobs(
  thresholdMs: number,
): Promise<{ found: number; reaped: number }> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - thresholdMs).toISOString();
  const { data } = await admin
    .from("publish_jobs")
    .select("*")
    .eq("status", "publishing")
    .is("external_post_id", null)
    .lte("claimed_at", cutoff)
    .limit(200);
  const candidates = (data as PublishJobRow[]) ?? [];
  let reaped = 0;
  for (const job of candidates) {
    const { data: upd } = await admin
      .from("publish_jobs")
      .update({ status: "needs_review", failure_reason: "recovered: stuck in 'publishing' beyond threshold (no external_post_id)" })
      .eq("id", job.id)
      .eq("status", "publishing")
      .is("external_post_id", null)
      .select("id");
    if (upd && upd.length) {
      reaped += 1;
      await appendAttempt(job, {
        n: (job.attempt_count ?? 0) + 1,
        status: "recovered",
        error_code: "stuck_publishing",
        error_message: "reaped: claimed_at older than threshold; moved to needs_review (never re-posted)",
        at: new Date().toISOString(),
      });
      await logIntegrationAudit({
        userId: job.user_id,
        provider: job.provider,
        action: "publish_recovered",
        target: job.id,
        detail: { claimedAt: null, thresholdMs },
      });
    }
  }
  return { found: candidates.length, reaped };
}

/** Status-count metrics across all publish_jobs. */
export async function getPublishStatusCounts(): Promise<Record<string, number>> {
  const admin = createAdminClient();
  const counts: Record<string, number> = {};
  await Promise.all(
    PUBLISH_STATUSES.map(async (s) => {
      const { count } = await admin
        .from("publish_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      counts[s] = count ?? 0;
    }),
  );
  return counts;
}

/** Health snapshot for diagnostics (read-only). */
export async function getPublishHealth(orphanThresholdMs: number): Promise<{
  counts: Record<string, number>;
  oldestQueued: { id: string; created_at: string } | null;
  oldestPublishing: { id: string; claimed_at: string | null } | null;
  orphanCount: number;
}> {
  const admin = createAdminClient();
  const counts = await getPublishStatusCounts();
  const { data: oq } = await admin
    .from("publish_jobs")
    .select("id,created_at")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: op } = await admin
    .from("publish_jobs")
    .select("id,claimed_at")
    .eq("status", "publishing")
    .order("claimed_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const cutoff = new Date(Date.now() - orphanThresholdMs).toISOString();
  const { count: orphanCount } = await admin
    .from("publish_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "publishing")
    .is("external_post_id", null)
    .lte("claimed_at", cutoff);
  return {
    counts,
    oldestQueued: (oq as { id: string; created_at: string }) ?? null,
    oldestPublishing: (op as { id: string; claimed_at: string | null }) ?? null,
    orphanCount: orphanCount ?? 0,
  };
}

/** Append a (capped) attempt entry + bump attempt_count. */
export async function appendAttempt(
  job: PublishJobRow,
  entry: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const history = Array.isArray(job.attempts) ? job.attempts : [];
  const next = [...history, entry].slice(-MAX_ATTEMPTS_HISTORY);
  await admin
    .from("publish_jobs")
    .update({ attempts: next, attempt_count: (job.attempt_count ?? 0) + 1 })
    .eq("id", job.id);
}
