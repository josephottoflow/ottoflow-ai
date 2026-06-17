/**
 * publish processor (PUB-1 — dark-launch, NO live posting).
 *
 * Loads the job by id (token/media never travel through Redis), guards
 * idempotency, then: since NO provider implements publish() in PUB-1, marks the
 * job needs_review with a sanitized attempt entry and audits publish_skipped.
 * The live-posting path (provider.publish + error classification) lands in
 * PUB-2 — guarded here so it can never fire in PUB-1.
 */
import { createAdminClient } from "@/lib/supabase";
import { getProvider } from "@/lib/integrations/providers/registry";
import { logIntegrationAudit } from "@/lib/integrations/accounts";
import { getPublishJobById, appendAttempt } from "@/lib/publishing/jobs";
import type { PublishJobData } from "@/lib/queue";

type Reporter = (step: string, progress: number) => void;

function redact(s: string): string {
  return s
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, "[REDACTED_JWT]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

export async function processPublish(
  data: PublishJobData,
  report: Reporter,
): Promise<{ ok: true; status: string }> {
  const admin = createAdminClient();
  report("publish", 5);

  const job = await getPublishJobById(data.publishJobId);
  if (!job) throw new Error(`publish_job ${data.publishJobId} not found`);

  // Only process queued jobs; canceled/terminal → no-op.
  if (job.status !== "queued") return { ok: true, status: job.status };

  // Idempotency guard: already posted at the provider → settle as published.
  if (job.external_post_id) {
    await admin.from("publish_jobs").update({ status: "published" }).eq("id", job.id);
    return { ok: true, status: "published" };
  }

  await admin
    .from("publish_jobs")
    .update({ status: "publishing", claimed_at: new Date().toISOString() })
    .eq("id", job.id);
  report("publish", 30);

  const provider = getProvider(job.provider);

  if (!provider?.publish) {
    // PUB-1: no provider implements publish() → needs_review, no live posting.
    const reason = `publishing not implemented for ${job.provider} (PUB-1 framework)`;
    await appendAttempt(job, {
      n: (job.attempt_count ?? 0) + 1,
      status: "skipped",
      error_code: "not_implemented",
      error_message: redact(reason),
      at: new Date().toISOString(),
    });
    await admin
      .from("publish_jobs")
      .update({ status: "needs_review", failure_reason: reason })
      .eq("id", job.id);
    await logIntegrationAudit({
      userId: job.user_id,
      provider: job.provider,
      action: "publish_skipped",
      target: job.id,
      detail: { reason },
    });
    report("publish", 100);
    return { ok: true, status: "needs_review" };
  }

  // Live-posting path is intentionally unreachable in PUB-1.
  throw new Error("PUB-1 has no live-posting path; provider.publish must not run yet");
}
