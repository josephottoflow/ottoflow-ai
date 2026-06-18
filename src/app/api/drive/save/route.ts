/**
 * POST /api/drive/save — copy a generated artifact into the user's Drive.
 *
 * Body: { artifactType: "creative" | "video", artifactId: string, accountId?: string }
 *
 * Verifies the caller owns BOTH the artifact (creative → item → brand → user;
 * video → render_jobs.user_id) and the Drive connection, then enqueues a
 * drive-sync job (the worker does the actual upload + token decrypt). Returns
 * the job id. No bytes or tokens touched here.
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase";
import { driveSyncQueue } from "@/lib/queue";
import {
  getAccountForUser,
  getAccountByProviderForUser,
  logIntegrationAudit,
} from "@/lib/integrations/accounts";
import { GOOGLE_DRIVE_PROVIDER } from "@/lib/integrations/google-drive";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    artifactType?: "creative" | "video";
    artifactId?: string;
    accountId?: string;
  } | null;
  if (!body?.artifactId || (body.artifactType !== "creative" && body.artifactType !== "video")) {
    return Response.json(
      { error: "artifactType ('creative'|'video') and artifactId required" },
      { status: 400 },
    );
  }

  const account = body.accountId
    ? await getAccountForUser(body.accountId, userId)
    : await getAccountByProviderForUser(userId, GOOGLE_DRIVE_PROVIDER);
  if (!account) return Response.json({ error: "No connected Drive account" }, { status: 404 });
  if (account.status !== "active") {
    return Response.json({ error: `Drive account status: ${account.status}` }, { status: 409 });
  }

  const admin = createAdminClient();

  // ─── Ownership + readiness check per artifact type ──────────────────────────
  if (body.artifactType === "creative") {
    const { data: creative } = await admin
      .from("content_creatives")
      .select("id, content_item_id, image_url, status")
      .eq("id", body.artifactId)
      .maybeSingle();
    if (!creative) return Response.json({ error: "Creative not found" }, { status: 404 });
    const { data: item } = await admin
      .from("content_items")
      .select("brand_id")
      .eq("id", creative.content_item_id)
      .maybeSingle();
    const { data: brand } = item?.brand_id
      ? await admin.from("brands").select("user_id").eq("id", item.brand_id).maybeSingle()
      : { data: null };
    if (!brand || brand.user_id !== userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!creative.image_url) {
      return Response.json({ error: "Creative image not ready yet" }, { status: 409 });
    }
  } else {
    const { data: job } = await admin
      .from("render_jobs")
      .select("user_id, merged_video_url")
      .eq("id", body.artifactId)
      .maybeSingle();
    if (!job) return Response.json({ error: "Video not found" }, { status: 404 });
    if (job.user_id !== userId) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (!job.merged_video_url) {
      return Response.json({ error: "Video not ready yet" }, { status: 409 });
    }
  }

  const folderKey = body.artifactType === "creative" ? "creatives" : "videos";
  const job = await driveSyncQueue().add("sync", {
    userId,
    connectedAccountId: account.id,
    artifactType: body.artifactType,
    artifactId: body.artifactId,
    folderKey,
  });

  await logIntegrationAudit({
    userId,
    provider: GOOGLE_DRIVE_PROVIDER,
    action: "sync_requested",
    target: `${body.artifactType}:${body.artifactId}`,
    connectedAccountId: account.id,
    detail: { jobId: job.id, folderKey },
    ip: req.headers.get("x-forwarded-for"),
  });

  return Response.json({ jobId: job.id, status: "queued" }, { status: 202 });
}
