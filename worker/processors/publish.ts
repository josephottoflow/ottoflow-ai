/**
 * publish processor (PUB-2 — live posting via provider.publish()).
 *
 * At-most-once is enforced by:
 *   - status guard: only `queued` jobs are claimable
 *   - external_post_id guard: an already-posted job settles as published
 *   - compare-and-set claim: queued→publishing via `.eq("status","queued")`;
 *     losing the race (cancel/other worker / re-delivery of a non-queued job)
 *     → no-op, never a second post
 *   - attempts:1 (no BullMQ retry); post_send/ambiguous failures → needs_review
 *     (manual reconcile), never an automatic re-post
 *
 * Token + post text are fetched here (never in the Redis payload). Providers
 * without publish() (PUB-1 era) still resolve to needs_review.
 */
import { createAdminClient } from "@/lib/supabase";
import { getProvider } from "@/lib/integrations/providers/registry";
import { PublishError } from "@/lib/integrations/providers/types";
import { getAccountById, getValidAccessToken, logIntegrationAudit } from "@/lib/integrations/accounts";
import { getPublishJobById, appendAttempt } from "@/lib/publishing/jobs";
import type { PublishJobData } from "@/lib/queue";

type Reporter = (step: string, progress: number) => void;

function redact(s: string): string {
  return s
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, "[REDACTED_JWT]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

/** Compose post copy from the content item (body + cta + hashtags). */
function composePostText(item: { body?: string | null; engagement?: unknown } | null): string {
  if (!item) return "";
  const parts: string[] = [];
  if (item.body) parts.push(item.body);
  const eng = item.engagement as { cta?: string | null; hashtags?: string[] } | null;
  if (eng && typeof eng === "object") {
    if (eng.cta) parts.push(eng.cta);
    if (Array.isArray(eng.hashtags) && eng.hashtags.length) {
      parts.push(eng.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" "));
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

export async function processPublish(
  data: PublishJobData,
  report: Reporter,
): Promise<{ ok: true; status: string }> {
  const admin = createAdminClient();
  report("publish", 5);

  const job = await getPublishJobById(data.publishJobId);
  if (!job) throw new Error(`publish_job ${data.publishJobId} not found`);

  // Only queued jobs are claimable (canceled/terminal/already-publishing → skip).
  if (job.status !== "queued") return { ok: true, status: job.status };

  // Idempotency: already posted → settle as published.
  if (job.external_post_id) {
    await admin.from("publish_jobs").update({ status: "published" }).eq("id", job.id);
    return { ok: true, status: "published" };
  }

  // Compare-and-set claim: queued→publishing. Lost race → no-op (no double post).
  const { data: claimed } = await admin
    .from("publish_jobs")
    .update({ status: "publishing", claimed_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: true, status: "lost_claim" };
  report("publish", 25);

  const provider = getProvider(job.provider);

  // No publish() (PUB-1 providers) → needs_review, no posting.
  if (!provider?.publish) {
    const reason = `publishing not implemented for ${job.provider}`;
    await appendAttempt(job, {
      n: (job.attempt_count ?? 0) + 1,
      status: "skipped",
      error_code: "not_implemented",
      error_message: redact(reason),
      at: new Date().toISOString(),
    });
    await admin.from("publish_jobs").update({ status: "needs_review", failure_reason: reason }).eq("id", job.id);
    await logIntegrationAudit({ userId: job.user_id, provider: job.provider, action: "publish_skipped", target: job.id, detail: { reason } });
    return { ok: true, status: "needs_review" };
  }

  // ─── Token (pre_send on failure: nothing posted) ──────────────────────────
  let accessToken: string;
  try {
    if (!job.connected_account_id) throw new Error("connected account missing (disconnected)");
    const account = await getAccountById(job.connected_account_id);
    if (!account) throw new Error("connected account not found");
    if (account.user_id !== job.user_id) throw new Error("account/job owner mismatch");
    accessToken = await getValidAccessToken(account);
  } catch (e) {
    const reason = `token unavailable: ${e instanceof Error ? e.message : String(e)}`;
    await appendAttempt(job, { n: (job.attempt_count ?? 0) + 1, status: "failed", error_code: "token", error_message: redact(reason), at: new Date().toISOString() });
    await admin.from("publish_jobs").update({ status: "failed", failure_reason: redact(reason).slice(0, 1000) }).eq("id", job.id);
    await logIntegrationAudit({ userId: job.user_id, provider: job.provider, action: "publish_failed", target: job.id, detail: { phase: "pre_send", reason: redact(reason) } });
    return { ok: true, status: "failed" };
  }
  report("publish", 45);

  // ─── Post text from the content item ──────────────────────────────────────
  let text = "";
  if (job.content_item_id) {
    const { data: item } = await admin
      .from("content_items")
      .select("body,engagement")
      .eq("id", job.content_item_id)
      .maybeSingle();
    text = composePostText(item);
  }

  // ─── Publish ──────────────────────────────────────────────────────────────
  try {
    const result = await provider.publish({
      accessToken,
      destination: {
        id: job.destination_id,
        name: job.destination_name ?? job.destination_id,
        type: job.destination_type ?? "unknown",
      },
      media: job.media_spec,
      text,
      idempotencyKey: job.id,
    });
    const now = new Date().toISOString();
    await admin
      .from("publish_jobs")
      .update({
        status: "published",
        external_post_id: result.externalPostId,
        permalink_url: result.permalinkUrl ?? null,
        published_at: now,
        failure_reason: null,
      })
      .eq("id", job.id);
    // Mirror to the content_items primary-publish cache (best-effort, 015 cols).
    if (job.content_item_id) {
      await admin
        .from("content_items")
        .update({
          status: "published",
          published_at: now,
          published_url: result.permalinkUrl ?? null,
          platform_post_id: result.externalPostId,
          publishing_method: `${job.provider}_api`,
        })
        .eq("id", job.content_item_id)
        .then(() => {}, () => {});
    }
    await appendAttempt(job, { n: (job.attempt_count ?? 0) + 1, status: "succeeded", at: now });
    await logIntegrationAudit({ userId: job.user_id, provider: job.provider, action: "publish_succeeded", target: job.id, detail: { externalPostId: result.externalPostId } });
    report("publish", 100);
    return { ok: true, status: "published" };
  } catch (err) {
    const phase = err instanceof PublishError ? err.phase : "post_send";
    const status = phase === "pre_send" ? "failed" : "needs_review";
    const reason = err instanceof Error ? err.message : String(err);
    await appendAttempt(job, { n: (job.attempt_count ?? 0) + 1, status: "failed", error_code: phase, error_message: redact(reason).slice(0, 300), at: new Date().toISOString() });
    await admin.from("publish_jobs").update({ status, failure_reason: redact(reason).slice(0, 1000) }).eq("id", job.id);
    await logIntegrationAudit({ userId: job.user_id, provider: job.provider, action: "publish_failed", target: job.id, detail: { phase, reason: redact(reason).slice(0, 300) } });
    return { ok: true, status };
  }
}
