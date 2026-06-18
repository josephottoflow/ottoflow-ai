/**
 * drive-sync processor (Phase 3 / P1).
 *
 * Copies an already-generated artifact into the user's connected Google Drive.
 * The artifact already lives in a Supabase bucket / R2 (source of truth) —
 * Drive holds a copy. The OAuth token is fetched + decrypted HERE (worker),
 * never passed through the queue payload.
 *
 *   resolve account (by connectedAccountId, owner-checked) →
 *   resolve artifact URL (creative → content_creatives.image_url,
 *                         video → render_jobs.merged_video_url) →
 *   getValidDriveAccessToken (refresh if needed) →
 *   download bytes → uploadToGDrive into the mapped folder → audit (file id).
 *
 * P1 records the resulting Drive file id in integration_audit_log only
 * (durable per-file tracking table deferred to P1.5/P2 per the approved plan).
 */
import { createAdminClient } from "@/lib/supabase";
import { uploadToGDrive } from "@/lib/ffmpeg-pipeline/gdrive";
import {
  getAccountById,
  getValidDriveAccessToken,
  logIntegrationAudit,
} from "@/lib/integrations/accounts";
import { GOOGLE_DRIVE_PROVIDER } from "@/lib/integrations/google-drive";
import type { DriveSyncJobData } from "@/lib/queue";

type Reporter = (step: string, progress: number) => void;

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`artifact download failed ${res.status} ${res.statusText} for ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function processDriveSync(
  data: DriveSyncJobData,
  report: Reporter,
): Promise<{ ok: true; fileId: string; webViewLink: string | null }> {
  const admin = createAdminClient();
  report("drive-sync", 5);

  const account = await getAccountById(data.connectedAccountId);
  if (!account || account.user_id !== data.userId) {
    throw new Error("Drive account not found for this user");
  }
  if (account.provider !== GOOGLE_DRIVE_PROVIDER) {
    throw new Error(`connected_account ${account.id} is not ${GOOGLE_DRIVE_PROVIDER}`);
  }

  // Resolve the artifact's public URL + filename + content type.
  let url: string;
  let fileName: string;
  let contentType: string;
  if (data.artifactType === "creative") {
    const { data: c } = await admin
      .from("content_creatives")
      .select("image_url")
      .eq("id", data.artifactId)
      .maybeSingle();
    if (!c?.image_url) throw new Error(`creative ${data.artifactId} has no image_url`);
    url = c.image_url as string;
    fileName = `creative-${data.artifactId}.png`;
    contentType = "image/png";
  } else {
    const { data: r } = await admin
      .from("render_jobs")
      .select("merged_video_url")
      .eq("id", data.artifactId)
      .maybeSingle();
    if (!r?.merged_video_url) {
      throw new Error(`render job ${data.artifactId} has no merged_video_url`);
    }
    url = r.merged_video_url as string;
    fileName = `video-${data.artifactId}.mp4`;
    contentType = "video/mp4";
  }
  report("drive-sync", 30);

  const accessToken = await getValidDriveAccessToken(account);
  const folderId =
    (account.metadata?.folders as Record<string, string> | undefined)?.[data.folderKey] ??
    null;

  const bytes = await fetchBytes(url);
  report("drive-sync", 70);

  const drive = await uploadToGDrive({ accessToken, fileName, contentType, body: bytes, folderId });
  report("drive-sync", 95);

  await logIntegrationAudit({
    userId: data.userId,
    provider: GOOGLE_DRIVE_PROVIDER,
    action: "sync",
    target: `${data.artifactType}:${data.artifactId}`,
    connectedAccountId: account.id,
    detail: { driveFileId: drive.fileId, webViewLink: drive.webViewLink, folderKey: data.folderKey },
  });
  report("drive-sync", 100);
  return { ok: true, fileId: drive.fileId, webViewLink: drive.webViewLink };
}
