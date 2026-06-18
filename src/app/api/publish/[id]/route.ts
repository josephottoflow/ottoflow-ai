/**
 * DELETE /api/publish/[id] — cancel a non-terminal publish job.
 * Gated by PUBLISHING_ENABLED. Owner-checked.
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPublishingEnabled } from "@/lib/publishing/flags";
import { getPublishJob, cancelPublishJob } from "@/lib/publishing/jobs";
import { logIntegrationAudit } from "@/lib/integrations/accounts";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isPublishingEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const job = await getPublishJob(id, userId);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });

  const canceled = await cancelPublishJob(job);
  await logIntegrationAudit({
    userId,
    provider: job.provider,
    action: "publish_canceled",
    target: id,
    detail: { wasStatus: job.status, canceled },
    ip: req.headers.get("x-forwarded-for"),
  });
  return Response.json({ ok: canceled, status: canceled ? "canceled" : job.status });
}
