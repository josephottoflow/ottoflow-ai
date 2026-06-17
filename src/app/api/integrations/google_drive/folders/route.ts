/**
 * GET  /api/integrations/google_drive/folders — current folder mapping +
 *      available app folders. Ensures the default Ottoflow/{…} tree exists.
 * PATCH /api/integrations/google_drive/folders — set chosen folder ids.
 *
 * Mapping lives in connected_accounts.metadata.folders (no migration). Folder
 * ids are non-secret, so they may be returned to the client.
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAccountForUser,
  getAccountByProviderForUser,
  getValidDriveAccessToken,
  patchAccountMetadata,
  logIntegrationAudit,
  type ConnectedAccountRow,
} from "@/lib/integrations/accounts";
import {
  ensureOttoflowFolders,
  listAppFolders,
  GOOGLE_DRIVE_PROVIDER,
  DRIVE_FOLDER_LAYOUT,
} from "@/lib/integrations/google-drive";

export const runtime = "nodejs";

async function resolveAccount(
  userId: string,
  accountId: string | null,
): Promise<ConnectedAccountRow | null> {
  return accountId
    ? getAccountForUser(accountId, userId)
    : getAccountByProviderForUser(userId, GOOGLE_DRIVE_PROVIDER);
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const account = await resolveAccount(userId, req.nextUrl.searchParams.get("accountId"));
  if (!account) return Response.json({ error: "No connected Drive account" }, { status: 404 });

  try {
    const token = await getValidDriveAccessToken(account);
    const existing = (account.metadata?.folders as Record<string, string> | undefined) ?? null;
    const folders = existing ?? (await ensureOttoflowFolders(token));
    if (!existing) await patchAccountMetadata(account.id, { folders });
    const available = await listAppFolders(token);
    return Response.json({ folders, available, layout: DRIVE_FOLDER_LAYOUT });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Drive folder lookup failed" },
      { status: 502 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    accountId?: string;
    folders?: Record<string, string>;
  } | null;
  if (!body?.folders || typeof body.folders !== "object") {
    return Response.json({ error: "folders map required" }, { status: 400 });
  }

  const account = await resolveAccount(userId, body.accountId ?? null);
  if (!account) return Response.json({ error: "No connected Drive account" }, { status: 404 });

  // Only accept known mapping keys; ignore anything else.
  const allowed = new Set(Object.keys(DRIVE_FOLDER_LAYOUT));
  const current = (account.metadata?.folders as Record<string, string> | undefined) ?? {};
  const next = { ...current };
  for (const [k, v] of Object.entries(body.folders)) {
    if (allowed.has(k) && typeof v === "string" && v.length > 0) next[k] = v;
  }

  await patchAccountMetadata(account.id, { folders: next });
  await logIntegrationAudit({
    userId,
    provider: GOOGLE_DRIVE_PROVIDER,
    action: "folder_mapping_updated",
    connectedAccountId: account.id,
    detail: { folders: next },
    ip: req.headers.get("x-forwarded-for"),
  });
  return Response.json({ folders: next });
}
