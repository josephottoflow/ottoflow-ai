/**
 * GET/PATCH /api/integrations/[provider]/folders — Drive folder mapping.
 *
 * Moved verbatim from /google_drive/folders so the URL
 * (/api/integrations/google_drive/folders) is unchanged. This is a Drive-
 * specific provider-config route; non-Drive providers get 404 (folders have no
 * meaning for them). Mapping lives in connected_accounts.metadata.folders.
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { provider } = await params;
  if (provider !== GOOGLE_DRIVE_PROVIDER) {
    return Response.json({ error: "Folders are only supported for Google Drive" }, { status: 404 });
  }

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { provider } = await params;
  if (provider !== GOOGLE_DRIVE_PROVIDER) {
    return Response.json({ error: "Folders are only supported for Google Drive" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    accountId?: string;
    folders?: Record<string, string>;
  } | null;
  if (!body?.folders || typeof body.folders !== "object") {
    return Response.json({ error: "folders map required" }, { status: 400 });
  }

  const account = await resolveAccount(userId, body.accountId ?? null);
  if (!account) return Response.json({ error: "No connected Drive account" }, { status: 404 });

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
