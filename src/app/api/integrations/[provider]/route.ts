/**
 * DELETE /api/integrations/[provider] — disconnect a connected account.
 *
 * Moved from /api/integrations/[id]. Next.js App Router allows only ONE slug
 * name per dynamic level; OAuth sub-routes key this segment by provider, so to
 * keep a single slug we name it `provider` — but for this account-scoped route
 * the value is the connected-account id (URL /api/integrations/<id> unchanged).
 * Owner-checked; revokes at the provider (best-effort, via registry override or
 * generic) then deletes the row + audit.
 */
import { type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAccountForUser,
  disconnectAccount,
  logIntegrationAudit,
} from "@/lib/integrations/accounts";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // `provider` carries the connected-account id for this account-scoped route.
  const { provider: id } = await params;
  const account = await getAccountForUser(id, userId);
  if (!account) return Response.json({ error: "Not found" }, { status: 404 });

  await disconnectAccount(account);
  await logIntegrationAudit({
    userId,
    provider: account.provider,
    action: "disconnect",
    target: account.account_name,
    connectedAccountId: account.id,
    ip: req.headers.get("x-forwarded-for"),
  });
  return Response.json({ ok: true });
}
