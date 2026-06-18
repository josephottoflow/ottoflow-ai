/**
 * POST /api/publish — fan-out publish: one publish_job per destination.
 * GET  /api/publish?contentItemId=… — list the caller's publish jobs.
 *
 * PUB-1 dark-launch: gated by PUBLISHING_ENABLED (404 when off). Resolves-or-
 * creates each publishing_destination, builds a media_spec, creates jobs
 * idempotently (in-flight dedupe), enqueues `queued` jobs (attempts:1), leaves
 * `scheduled` jobs for the sweep. No live posting (no provider publish() yet).
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { isPublishingEnabled } from "@/lib/publishing/flags";
import {
  resolveOrCreateDestination,
  buildMediaSpec,
  createPublishJobs,
  listPublishJobs,
  type DestinationInput,
} from "@/lib/publishing/jobs";
import { getAccountForUser, logIntegrationAudit } from "@/lib/integrations/accounts";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isPublishingEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    contentItemId?: string;
    creativeId?: string;
    renderJobId?: string;
    scheduledFor?: string;
    clientRequestId?: string;
    destinations?: Array<{
      connectedAccountId: string;
      destinationId: string;
      destinationType?: string;
      destinationName?: string;
      provider?: string;
    }>;
  } | null;

  if (!body?.contentItemId || !Array.isArray(body.destinations) || body.destinations.length === 0) {
    return Response.json({ error: "contentItemId and destinations[] are required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Ownership: content item → brand → user.
  const { data: item } = await admin
    .from("content_items")
    .select("brand_id")
    .eq("id", body.contentItemId)
    .maybeSingle();
  if (!item) return Response.json({ error: "Content item not found" }, { status: 404 });
  const { data: brand } = item.brand_id
    ? await admin.from("brands").select("user_id").eq("id", item.brand_id).maybeSingle()
    : { data: null };
  if (!brand || brand.user_id !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Resolve each destination (ownership of the connected account enforced).
  const resolved: Array<DestinationInput & { publishingDestinationId: string }> = [];
  for (const d of body.destinations) {
    if (!d.connectedAccountId || !d.destinationId) {
      return Response.json({ error: "each destination needs connectedAccountId + destinationId" }, { status: 400 });
    }
    const account = await getAccountForUser(d.connectedAccountId, userId);
    if (!account) {
      return Response.json({ error: `Connected account not found: ${d.connectedAccountId}` }, { status: 403 });
    }
    const provider = d.provider ?? account.provider;
    const publishingDestinationId = await resolveOrCreateDestination(userId, {
      connectedAccountId: d.connectedAccountId,
      provider,
      destinationId: d.destinationId,
      destinationType: d.destinationType,
      destinationName: d.destinationName,
    });
    resolved.push({
      connectedAccountId: d.connectedAccountId,
      provider,
      destinationId: d.destinationId,
      destinationType: d.destinationType,
      destinationName: d.destinationName,
      publishingDestinationId,
    });
  }

  const mediaSpec = await buildMediaSpec({ creativeId: body.creativeId, renderJobId: body.renderJobId });
  const jobs = await createPublishJobs({
    userId,
    contentItemId: body.contentItemId,
    creativeId: body.creativeId,
    renderJobId: body.renderJobId,
    mediaSpec,
    destinations: resolved,
    scheduledFor: body.scheduledFor,
    clientRequestId: body.clientRequestId,
  });

  await logIntegrationAudit({
    userId,
    action: "publish_enqueued",
    target: body.contentItemId,
    detail: { jobs: jobs.map((j) => ({ id: j.id, status: j.status, existed: j.existed })) },
    ip: req.headers.get("x-forwarded-for"),
  });

  return Response.json({ jobs }, { status: 202 });
}

export async function GET(req: NextRequest) {
  if (!isPublishingEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const contentItemId = req.nextUrl.searchParams.get("contentItemId");
  const jobs = await listPublishJobs(userId, contentItemId);
  return Response.json({ jobs });
}
