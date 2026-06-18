/**
 * GET /api/publish/health — read-only publish diagnostics (P1.3).
 *
 * Admin-only (requireAdmin, fail-closed → 404) and flag-gated. Returns global
 * publish health: counts by status, oldest queued/publishing job, scheduler
 * lock owner, and the orphan count. No mutations.
 */
import { isPublishingEnabled } from "@/lib/publishing/flags";
import { requireAdmin } from "@/lib/admin";
import { getPublishHealth } from "@/lib/publishing/jobs";
import { lockOwner, SCHEDULER_LOCK_KEY } from "@/lib/publishing/lock";

export const runtime = "nodejs";

const ORPHAN_THRESHOLD_MS = Number(process.env.PUBLISH_ORPHAN_THRESHOLD_MS ?? 900_000);

export async function GET() {
  if (!isPublishingEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const adminUserId = await requireAdmin();
  if (!adminUserId) return Response.json({ error: "Not found" }, { status: 404 }); // fail-closed

  const health = await getPublishHealth(ORPHAN_THRESHOLD_MS);
  const schedulerLockToken = await lockOwner(SCHEDULER_LOCK_KEY);
  return Response.json({
    ...health,
    orphanThresholdMs: ORPHAN_THRESHOLD_MS,
    schedulerLocked: schedulerLockToken !== null,
    schedulerLockOwner: schedulerLockToken,
  });
}
