/**
 * DELETE /api/integrations/[id] — disconnect a connected account.
 *
 * Owner-checked; revokes the token at the provider (best-effort) then deletes
 * the row, and writes an audit entry. Tokens never leave the server.
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
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
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
